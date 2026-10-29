// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {readMorph, morphPcm} from './spu_synth_morph.js';
import {readNoise} from './spu_synth_noise.js';
import {readPmon} from './spu_synth_pmon.js';
import {preparePs1ADPCM} from '../js/ps1synth.js?v=ps1-cyclic-1';
import {encodePs1Adpcm} from '../js/ps1_adpcm_encoder.js?v=ps1-cyclic-1';
import {preparePs1Waveform} from '../js/ps1_waveform.js?v=ps1-cyclic-1';
import {PS1_REVERB_PRESETS} from '../js/ps1_parameters.js?v=ps1-voice-editor-1';

import {MAX_HOST_PRESET_BYTES, encodeHostPcm, decodeHostPcm} from './spu_synth_long_audio.js';

export const INSTRUMENT_SCHEMA = 'tetorica-spu-synth.instrument';
export const MAX_INSTRUMENT_BYTES = MAX_HOST_PRESET_BYTES;
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${label}`);
  return value;
}
function number(value, min, max, label, integral = false) {
  if (!Number.isFinite(value) || integral && !Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`Invalid ${label}`);
  return value;
}
function keys(value, allowed, label) {
  object(value, label);
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError(`Unknown ${label} field`);
}
/** Validate the entire file before changing any live voice or sample RAM. */
export function readSpuInstrument(value) {
  keys(value, ['schema', 'version', 'name', 'preset', 'sample', 'reverb', 'waveform', 'pmon', 'noise', 'morph'], 'instrument');
  if (value.schema !== INSTRUMENT_SCHEMA || ![1,2].includes(value.version)) throw new TypeError('Expected a Tetorica SPU Synth instrument (version 1 or 2)');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80) throw new TypeError('Instrument name must contain 1–80 characters');
  keys(value.preset, ['volumeLeft', 'volumeRight', 'adsr1', 'adsr2', 'pitch', 'reverb'], 'voice');
  const preset = {};
  for (const key of ['volumeLeft', 'volumeRight']) preset[key] = number(value.preset[key], -1, 1, key);
  for (const key of ['adsr1', 'adsr2']) preset[key] = number(value.preset[key], 0, 65535, key, true);
  preset.pitch = number(value.preset.pitch, 0, 16383, 'pitch', true);
  if (typeof value.preset.reverb !== 'boolean') throw new TypeError('Invalid voice reverb switch');
  preset.reverb = value.preset.reverb;
  keys(value.reverb, ['preset', 'volumeLeft', 'volumeRight'], 'reverb');
  if (!PS1_REVERB_PRESETS.some(item => item.id === value.reverb.preset)) throw new TypeError('Unknown SPU reverb preset');
  const reverb = {preset:value.reverb.preset};
  for (const key of ['volumeLeft', 'volumeRight']) reverb[key] = number(value.reverb[key], 0, 1, `reverb ${key}`);
  let adpcm,options,hostSample;
  if (value.version === 2) {
    keys(value.sample, ['pcm16Base64','baseFrequencyHz','loop'], 'software sample');
    const baseFrequencyHz=number(value.sample.baseFrequencyHz, .000001, 1000000, 'baseFrequencyHz');
    if (typeof value.sample.loop !== 'boolean') throw new TypeError('Invalid software audio loop switch');
    hostSample={pcm:decodeHostPcm(value.sample.pcm16Base64),baseFrequencyHz,loop:value.sample.loop};
    if (hostSample.loop && hostSample.pcm.length<4) throw new RangeError('Software audio loops require at least 4 frames');
    if (value.waveform != null || value.morph?.enabled) throw new TypeError('Software audio cannot contain a PCM cycle or enabled morph');
  } else {
    keys(value.sample, ['adpcm', 'baseFrequencyHz', 'loopStartSamples'], 'sample');
    const bytes = value.sample.adpcm;
    if (!Array.isArray(bytes) || !bytes.length || bytes.length > 520192 || bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new TypeError('Invalid SPU ADPCM sample bytes');
    options = {baseFrequencyHz:value.sample.baseFrequencyHz};
    if (value.sample.loopStartSamples !== undefined) options.loopStartSamples = value.sample.loopStartSamples;
    adpcm = Uint8Array.from(bytes);
    preparePs1ADPCM(adpcm, options);
  }
  let waveform = null;
  if (value.waveform !== undefined && value.waveform !== null) {
    const prepared = preparePs1Waveform(value.waveform);
    const matches=bytes=>bytes.length===adpcm.length && bytes.every((byte,index)=>byte===adpcm[index]);
    const legacy=()=>encodePs1Adpcm(Float32Array.from(prepared.pcm),{loopStartSamples:0,maxBytes:64}).adpcm;
    if (options.baseFrequencyHz !== 44100 / 112 || options.loopStartSamples !== 0 || !matches(prepared.adpcm) && !matches(legacy())) throw new TypeError('PCM cycle and encoded ADPCM do not match');
    waveform = prepared.pcm;
  }
  const pmon=readPmon(value.pmon),noise=readNoise(value.noise),morph=readMorph(value.morph);
  if(morph.enabled && (!waveform || morphPcm(morph).some((x,i)=>x!==waveform[i])))throw new TypeError('Software morph and PCM cycle do not match');
  if (pmon.enabled && noise.enabled) throw new TypeError('Noise and PMON cannot both be enabled');
  return {schema:INSTRUMENT_SCHEMA, version:value.version, name:value.name.trim(), preset, sample:hostSample ?? {adpcm, ...options}, reverb, waveform, pmon, noise, morph};
}

export function writeSpuInstrument(name, source) {
  if (!source?.sample) throw new Error('Assign a sample before saving an instrument');
  const {sample:ignored, ...preset} = source.preset;
  const host=source.sample.pcm instanceof Int16Array;
  const sample=host ? {pcm16Base64:encodeHostPcm(source.sample.pcm),baseFrequencyHz:source.sample.baseFrequencyHz,loop:source.sample.loop} : {...source.sample,adpcm:Array.from(source.sample.adpcm)};
  const checked = readSpuInstrument({schema:INSTRUMENT_SCHEMA, version:host ? 2 : 1, name, preset,
    sample, reverb:source.reverb, pmon:source.pmon, noise:source.noise, morph:source.morph, waveform:source.waveform ?? null});
  return {...checked, sample:host ? sample : {...checked.sample, adpcm:Array.from(checked.sample.adpcm)}};
}

/** Mono conversion; the decoder has already resampled to 44.1 kHz. */
export function prepareAudioPcm(buffer, {loop = false, maxBytes} = {}) {
  number(maxBytes, 0, 520192, 'free sample RAM', true);
  if (buffer.sampleRate !== 44100 || !Number.isSafeInteger(buffer.length) || buffer.length < 1 || !Number.isSafeInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1) throw new TypeError('Expected decoded 44,100 Hz audio');
  const frames = loop ? Math.floor(buffer.length / 28) * 28 : buffer.length;
  if (!frames) throw new RangeError('Audio is too short for a 28-sample SPU loop');
  if (Math.ceil(frames / 28) * 16 > maxBytes) throw new RangeError('Audio exceeds free SPU sample RAM. Use a shorter recording or reload for a fresh bank.');
  const pcm = new Float32Array(frames);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const input = buffer.getChannelData(channel);
    for (let i = 0; i < frames; i++) {
      if (!Number.isFinite(input[i])) throw new TypeError('Audio contains a non-finite sample');
      pcm[i] += input[i] / buffer.numberOfChannels;
    }
  }
  for (let i = 0; i < frames; i++) pcm[i] = Math.max(-1, Math.min(1, pcm[i]));
  return {pcm, loopStartSamples:loop ? 0 : null, trimmedFrames:buffer.length - frames};
}
