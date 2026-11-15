// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {prepareFm2608SongSource} from './song_source.js';
import {createFm2608RegisterState,captureFm2608SongPreset} from './song_state.js';
import {createDefaultPreset,readPreset,RHYTHM_NAMES} from './preset.js';

export const MAX_FM2608_IMPORTED_PRESETS = 4096;
const MAX_PRESET_BYTES = 12 * 1024 * 1024;
const later = () => new Promise(resolve => globalThis.setTimeout(resolve,0));
const clone = value => structuredClone(value);
const check = signal => {
  if (signal?.aborted) throw new DOMException('OPNA preset extraction cancelled','AbortError');
};

function presetSelection(section,channel,preset) {
  if (section === 'fm') return {section,channel:channel === 2 && preset.channel3.mode !== 'normal' ? 2 : 'auto'};
  return {section,channel:section === 'ssg' ? 'auto' : channel};
}

function soundSignature(section,channel,preset) {
  if (section === 'fm') return JSON.stringify([section,preset.fm[0],preset.lfo,
    preset.channel3.mode === 'normal' ? null : preset.channel3]);
  if (section === 'ssg') {
    const voice = preset.ssg.channels[0];
    return JSON.stringify([section,voice,voice.noise ? preset.ssg.noisePeriod : null,
      voice.envelope ? [preset.ssg.envelopePeriod,preset.ssg.envelopeShape] : null]);
  }
  if (section === 'rhythm') return JSON.stringify([section,channel,preset.rhythm.volume,preset.rhythm.voices[channel]]);
  const {data,sampleRate,volume,left,right,repeat} = preset.adpcm;
  return JSON.stringify([section,data,sampleRate,volume,left,right,repeat]);
}

/** Extract recorded static instruments without opening audio or changing a Synth.
 * Events at one timestamp settle before capture, matching the next audible wait.
 * Ordinary note pitch and subsequent software automation stay with the song.
 * Imported melodic voices populate every compatible channel for Auto audition.
 */
export async function extractFm2608VgmPresets(source,{name='',signal,yieldTask=later} = {}) {
  check(signal);
  const prepared = await prepareFm2608SongSource(source,{signal,yieldTask});
  const parser = new Ym2612VGM(prepared.bytes,{logger:null});
  const shadow = createFm2608RegisterState(prepared.header.ym2608Clock);
  // ymfm's OPNA reset enables both stereo sides before any recorded pan write.
  for (let port=0; port<2; port++) for (let channel=0; channel<3; channel++) shadow.write(port,0xb4+channel,0xc0);
  // The native ADPCM-B reset leaves its address limit fully open.
  shadow.write(1,12,255);shadow.write(1,13,255);
  const basePreset = createDefaultPreset(), presets = [], seen = new Map();
  const warnings = new Set(prepared.warnings);
  const pendingFm = new Set(), pendingRhythm = new Set();
  let time = 0, commands = 0, presetBytes = 0, ssgDirty = false, csmDirty = false, adpcmPending = false;

  function record(section,channel,snapshot) {
    let preset;
    if (section === 'adpcm') {
      const {start,end,limit} = snapshot.adpcm;
      if (start < limit && limit < end) {
        warnings.add('ADPCM-B preset omitted. Its limit address wraps playback to address 0 inside the recorded sample range.');
        return;
      }
    }
    try {
      preset = captureFm2608SongPreset(snapshot,{section,channel,referenceNote:60,basePreset});
    } catch (error) {
      if (section !== 'adpcm') throw error;
      warnings.add('ADPCM-B preset omitted. ' + error.message);
      return;
    }
    if (section === 'fm') preset.fm = Array.from({length:6},() => clone(preset.fm[channel]));
    else if (section === 'ssg') preset.ssg.channels = Array.from({length:3},() => clone(preset.ssg.channels[channel]));
    const signature = soundSignature(section,channel,preset), previous = seen.get(signature);
    if (previous) {
      previous.source.occurrences++;
      if (!previous.source.channels.includes(channel)) previous.source.channels.push(channel);
      return;
    }
    if (presets.length >= MAX_FM2608_IMPORTED_PRESETS) throw new RangeError('VGM contains more than 4,096 different OPNA presets');
    const id = presets.length + 1;
    const title = section === 'rhythm' ? 'Rhythm ' + RHYTHM_NAMES[channel] : section === 'adpcm' ? 'ADPCM-B' : section.toUpperCase() + ' CH' + (channel + 1);
    preset.name = title + ' · ' + String(id).padStart(3,'0');
    preset = readPreset(preset);
    presetBytes += new TextEncoder().encode(JSON.stringify(preset)).length;
    if (presetBytes > MAX_PRESET_BYTES) throw new RangeError('Extracted OPNA presets exceed the 12 MiB project limit. Import a shorter song or split the project.');
    const entry = {section,channel,preset,selection:presetSelection(section,channel,preset),
      source:{chip:prepared.sourceChip,clock:prepared.sourceClock,firstSample:time,occurrences:1,channels:[channel]}};
    seen.set(signature,entry);
    presets.push(entry);
  }

  function flush() {
    if (!pendingFm.size && !pendingRhythm.size && !ssgDirty && !csmDirty && !adpcmPending) return;
    const snapshot = shadow.snapshot(time);
    const csm = snapshot.channel3.mode === 'csm' && snapshot.channel3.running;
    if (csm && csmDirty) pendingFm.add(2);
    for (const channel of pendingFm) {
      const voice = snapshot.fm.channels[channel];
      if (voice.enabled && (voice.gate || channel === 2 && csm) && (voice.preset.pan.left || voice.preset.pan.right)) record('fm',channel,snapshot);
    }
    if (ssgDirty) for (const voice of snapshot.ssg.channels) {
      if (voice.gate && (voice.tone || voice.noise)) record('ssg',voice.channel,snapshot);
    }
    for (const channel of pendingRhythm) {
      const voice = snapshot.rhythm.voices[channel];
      if (voice.gate && (voice.left || voice.right)) record('rhythm',channel,snapshot);
    }
    if (adpcmPending && snapshot.adpcm.playing) record('adpcm',0,snapshot);
    pendingFm.clear(); pendingRhythm.clear();
    ssgDirty = csmDirty = adpcmPending = false;
  }

  for (;;) {
    check(signal);
    const event = parser.step();
    if (event.type === 'end') {flush(); break;}
    if (event.type === 'wait') {
      if (event.samples > 0) {flush(); time += event.samples;}
    } else if (event.type === 'ym2608-adpcm-b-data') {
      shadow.loadMemory(event.data,event.offset,event.memorySize);
    } else if (event.type === 'ym2608-write') {
      const {port,register,value} = event;
      shadow.write(port,register,value);
      if (port === 0) {
        if (register === 0x28 && (value & 3) < 3 && value & 0xf0) pendingFm.add((value & 3) + (value & 4 ? 3 : 0));
        if (register < 14) ssgDirty = true;
        if (register === 0x10 && !(value & 128)) {
          for (let channel=0; channel<6; channel++) if (value & 1 << channel) pendingRhythm.add(channel);
        }
        if ([0x24,0x25,0x27,0x2d,0x2e,0x2f].includes(register) ||
          register >= 0x30 && register <= 0xb6 && (register & 3) === 2 ||
          register >= 0xa8 && register <= 0xae) csmDirty = true;
      } else if (register === 0 && value & 128 && !(value & 1)) adpcmPending = true;
    }
    if (++commands % 4096 === 0) await yieldTask();
  }
  check(signal);
  warnings.add('Presets retain recorded static settings. Later note, volume and parameter automation remains in the song.');
  return {presets,source:{name:String(name),format:prepared.format,chip:prepared.sourceChip,clock:prepared.sourceClock,
    playbackClock:prepared.header.ym2608Clock,metadata:prepared.metadata},warnings:[...warnings]};
}
