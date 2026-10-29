// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {readNoise} from './spu_synth_noise.js';
import {readPmon} from './spu_synth_pmon.js';
import {preparePs1ADPCM} from '../js/ps1synth.js?v=ps1-deferred-release-1';
import {preparePs1Waveform} from '../js/ps1_waveform.js?v=ps1-pcm-waveform-1';
import {PS1_REVERB_PRESETS} from '../js/ps1_parameters.js?v=ps1-voice-editor-1';

export const INSTRUMENT_SCHEMA = 'tetorica-spu-synth.instrument';
export const MAX_INSTRUMENT_BYTES = 4 * 1024 * 1024;
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
  keys(value, ['schema', 'version', 'name', 'preset', 'sample', 'reverb', 'waveform', 'pmon', 'noise'], 'instrument');
  if (value.schema !== INSTRUMENT_SCHEMA || value.version !== 1) throw new TypeError('Expected a Tetorica SPU Synth instrument (version 1)');
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
  keys(value.sample, ['adpcm', 'baseFrequencyHz', 'loopStartSamples'], 'sample');
  const bytes = value.sample.adpcm;
  if (!Array.isArray(bytes) || !bytes.length || bytes.length > 520192 || bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new TypeError('Invalid SPU ADPCM sample bytes');
  const options = {baseFrequencyHz:value.sample.baseFrequencyHz};
  if (value.sample.loopStartSamples !== undefined) options.loopStartSamples = value.sample.loopStartSamples;
  const adpcm = Uint8Array.from(bytes);
  preparePs1ADPCM(adpcm, options);
  let waveform = null;
  if (value.waveform !== undefined && value.waveform !== null) {
    const prepared = preparePs1Waveform(value.waveform);
    if (options.baseFrequencyHz !== 44100 / 112 || options.loopStartSamples !== 0 || prepared.adpcm.length !== adpcm.length || prepared.adpcm.some((byte, index) => byte !== adpcm[index])) throw new TypeError('PCM cycle and encoded ADPCM do not match');
    waveform = prepared.pcm;
  }
  const pmon=readPmon(value.pmon),noise=readNoise(value.noise);
  if (pmon.enabled && noise.enabled) throw new TypeError('Noise and PMON cannot both be enabled');
  return {schema:INSTRUMENT_SCHEMA, version:1, name:value.name.trim(), preset, sample:{adpcm, ...options}, reverb, waveform, pmon, noise};
}

export function writeSpuInstrument(name, source) {
  if (!source?.sample) throw new Error('Assign a sample before saving an instrument');
  const {sample:ignored, ...preset} = source.preset;
  const checked = readSpuInstrument({schema:INSTRUMENT_SCHEMA, version:1, name, preset,
    sample:{...source.sample, adpcm:Array.from(source.sample.adpcm)}, reverb:source.reverb, pmon:source.pmon, noise:source.noise, waveform:source.waveform ?? null});
  return {...checked, sample:{...checked.sample, adpcm:Array.from(checked.sample.adpcm)}};
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
