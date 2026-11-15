// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {createYm2612RegisterState} from '../synth/synth_song_state.js';
import {createDefaultPreset,readPreset,encodeBase64,MAX_ADPCM_BYTES} from './preset.js';

const integer = (value,max,label) => {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${label} must be 0..${max}`);
  return value;
};
const hzMidi = hz => hz > 0 ? 69 + 12 * Math.log2(hz / 440) : null;
const clone = value => structuredClone(value);

/** Written-register observation. Gate fields describe register requests, not
 * hardware envelope/readback. ADPCM memory is retained separately from PCM. */
export function createFm2608RegisterState(clockHz = 8000000) {
  if (!Number.isFinite(clockHz) || clockHz <= 0) throw new RangeError('YM2608 clock must be positive');
  const fm = createYm2612RegisterState(clockHz);
  const registers = [new Uint8Array(256),new Uint8Array(256)];
  const memory = new Uint8Array(MAX_ADPCM_BYTES), known = new Uint8Array(MAX_ADPCM_BYTES);
  let revision = 0, memoryRevision = 0, prescale = 6, transferAddress = 0, dummy = false;
  let sampleCache = null, sampleKey = '', rhythmGates = 0;
  const addressShift = () => registers[1][1] & 3 ? 5 : 2;
  const range = () => {
    const r = registers[1], shift = addressShift();
    return {start:(r[2] | r[3] << 8) * 2 ** shift,end:((r[4] | r[5] << 8) + 1) * 2 ** shift};
  };
  function reset() {
    registers.forEach(values => values.fill(0)); fm.reset(); memory.fill(0); known.fill(0);
    revision++; memoryRevision++; prescale = 6; transferAddress = 0; dummy = false;
    sampleCache = null; sampleKey = ''; rhythmGates = 0;
  }
  function clearMemory() {memory.fill(0); known.fill(0); memoryRevision++; sampleCache = null;}
  function loadMemory(bytes,offset = 0,memorySize = MAX_ADPCM_BYTES) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected ADPCM-B bytes');
    integer(offset,MAX_ADPCM_BYTES,'ADPCM offset'); integer(memorySize,MAX_ADPCM_BYTES,'ADPCM memory size');
    if (offset + bytes.length > memorySize) throw new RangeError('ADPCM data exceeds its memory range');
    memory.set(bytes,offset); known.fill(1,offset,offset + bytes.length); memoryRevision++;
  }
  function write(port,register,value) {
    integer(port,1,'OPNA port'); integer(register,255,'OPNA register'); integer(value,255,'OPNA value');
    registers[port][register] = value;
    fm.write(port,register,value);
    if (!port) {
      if (register === 0x2d) prescale = 6;
      else if (register === 0x2e && prescale === 6) prescale = 3;
      else if (register === 0x2f) prescale = 2;
      else if (register === 0x10) rhythmGates = value & 128 ? rhythmGates & ~(value & 63) : rhythmGates | (value & 63);
    } else if (register === 0) {
      if (value & 0x80) transferAddress = range().start;
      dummy = Boolean(value & 0x20);
    } else if (register === 8 && (registers[1][0] & 0xe0) === 0x60) {
      // ymfm consumes the pending dummy-read state at the first CPU write.
      // Its end test is performed before writing, including the last byte.
      if (dummy) {transferAddress = range().start; dummy = false;}
      if (transferAddress !== range().end - 1 && transferAddress < memory.length) {
        memory[transferAddress] = value; known[transferAddress++] = 1; memoryRevision++;
      }
    }
    revision++;
  }
  function sample() {
    const {start,end} = range(), key = `${memoryRevision}:${start}:${end}`;
    if (key !== sampleKey) {
      const available = end > start && end <= memory.length && known.subarray(start,end).every(Boolean);
      const data = available ? memory.slice(start,end) : null;
      sampleCache = {available,data,bytes:data,error:available ? '' : 'The complete ADPCM sample range has not been recorded in this song.'}; sampleKey = key;
    }
    return sampleCache;
  }
  function snapshot(frame = 0) {
    const raw = fm.snapshot(frame), factor = 6 / prescale, ssgClock = clockHz / (prescale === 6 ? 4 : prescale === 3 ? 2 : 1);
    const scalePitch = pitch => ({...pitch,frequencyHz:pitch.frequencyHz * factor,midi:hzMidi(pitch.frequencyHz * factor)});
    const channels = raw.channels.map(voice => ({...voice,...scalePitch(voice),
      specialFrequencies:voice.specialFrequencies.map(scalePitch),
      enabled:voice.channel < 3 || Boolean(registers[0][0x29] & 128)}));
    const a = registers[1], r = registers[0], bounds = range(), stored = sample();
    const deltaN = a[9] | a[10] << 8;
    return {kind:'ym2608',present:true,clockHz,frame,revision,prescale,registers:registers.map(values => values.slice()),
      fm:{...raw,kind:'ym2608-fm',channels},lfo:raw.lfo,
      channel3:{mode:(raw.modeRegister & 0xc0) === 0x80 ? 'csm' : raw.modeRegister & 0x40 ? 'special' : 'normal',
        running:Boolean(r[0x27] & 1),timerA:r[0x24] << 2 | r[0x25] & 3,frequencies:channels[2].specialFrequencies.map(({block,fnum}) => ({block,fnum}))},
      ssg:{channels:Array.from({length:3},(_,channel) => {
        const period = r[channel * 2] | (r[channel * 2 + 1] & 15) << 8;
        const frequencyHz = ssgClock / (16 * (period || 1));
        return {channel,period,frequencyHz,midi:hzMidi(frequencyHz),tone:!(r[7] & 1 << channel),noise:!(r[7] & 8 << channel),
          volume:r[8+channel] & 15,envelope:Boolean(r[8+channel] & 16),gate:Boolean(r[8+channel] & 31)};
      }),noisePeriod:r[6] & 31,envelopePeriod:r[11] | r[12] << 8,envelopeShape:r[13] & 15},
      rhythm:{volume:r[0x11] & 63,voices:Array.from({length:6},(_,channel) => ({channel,volume:r[0x18+channel] & 31,
        left:Boolean(r[0x18+channel] & 128),right:Boolean(r[0x18+channel] & 64),gate:Boolean(rhythmGates & 1 << channel)}))},
      adpcm:{...bounds,...stored,address:bounds.start,deltaN,sampleRate:deltaN * clockHz * factor / (144 * 65536),
        repeat:Boolean(a[0] & 16),playing:Boolean(a[0] & 128) && !(a[0] & 1),external:Boolean(a[0] & 32),
        addressShift:addressShift(),volume:a[11],left:Boolean(a[1] & 128),right:Boolean(a[1] & 64),
        control:a[0],memoryMode:a[1] & 3,limit:((a[12] | a[13] << 8) + 1) * 2 ** addressShift(),memoryRevision},
    };
  }
  reset();
  return {write,reset,clearMemory,loadMemory,snapshot,getMemory:() => memory.slice(),getRegisters:() => registers.map(values => values.slice())};
}

/** Attach before rendering. Reads apply writes at the audible frame, including
 * memory uploads, rather than exposing the native renderer's lookahead. */
export function createFm2608SongTimeline(engine,clockHz = 8000000) {
  const shadow = createFm2608RegisterState(clockHz);
  const songShadow = createFm2608RegisterState(clockHz);
  const original = {write:engine.writeYm2608,process:engine.processFrames,reset:engine.reset,
    load:engine.loadAdpcmBMemory,clear:engine.clearAdpcmBMemory};
  let generatedFrames = 0, lastReadFrame = 0, events = [], head = 0, disposed = false;
  const push = event => {if (!disposed) events.push({frame:generatedFrames,manual:Boolean(engine.fm2608ManualWrite),...event});};
  function write(port,register,value) {const result = original.write.call(this,port,register,value); push({type:'write',port,register,value}); return result;}
  function process(frames) {const result = original.process.call(this,frames); generatedFrames += frames; return result;}
  function reset(...args) {
    const result = original.reset.apply(this,args); generatedFrames = lastReadFrame = head = 0; events = []; shadow.reset(); songShadow.reset(); return result;
  }
  function load(bytes,offset = 0,memorySize = MAX_ADPCM_BYTES) {
    const result = original.load.call(this,bytes,offset,memorySize); push({type:'load',bytes:bytes.slice(),offset,memorySize}); return result;
  }
  function clear() {const result = original.clear?.call(this); push({type:'clear'}); return result;}
  engine.writeYm2608 = write; engine.processFrames = process; engine.reset = reset;
  engine.loadAdpcmBMemory = load; engine.clearAdpcmBMemory = clear;
  function read(frame) {
    const next = Math.max(0,Math.min(generatedFrames,Math.floor(frame)));
    if (next < lastReadFrame) throw new Error('OPNA state cannot move backwards without resetting');
    while (head < events.length && events[head].frame <= next) {
      const event = events[head++];
      for (const target of event.manual ? [shadow] : [shadow,songShadow]) {
        if (event.type === 'write') target.write(event.port,event.register,event.value);
        else if (event.type === 'load') target.loadMemory(event.bytes,event.offset,event.memorySize);
        else target.clearMemory();
      }
    }
    lastReadFrame = next;
    if (head === events.length) {events = []; head = 0;}
    else if (head > 256) {events = events.slice(head); head = 0;}
    return shadow.snapshot(next);
  }
  return {read,readSong(frame) {read(frame); return songShadow.snapshot(lastReadFrame);},getMemory:() => shadow.getMemory(),get generatedFrames() {return generatedFrames;},dispose() {
    if (disposed) return; disposed = true; events = [];
    for (const [key,value,installed] of [['writeYm2608',original.write,write],['processFrames',original.process,process],
      ['reset',original.reset,reset],['loadAdpcmBMemory',original.load,load],['clearAdpcmBMemory',original.clear,clear]]) {
      if (engine[key] === installed) engine[key] = value;
    }
  }};
}

/** Copy one selected physical channel into an authored portable instrument.
 * Capturing ADPCM requires all bytes in the selected range to be known. */
export function captureFm2608SongPreset(snapshot,{section='fm',channel=0,referenceNote=60,basePreset=createDefaultPreset()} = {}) {
  if (snapshot?.kind !== 'ym2608') throw new Error('Choose a recorded OPNA channel first');
  const limits = {fm:6,ssg:3,rhythm:6,adpcm:1};
  if (!Object.hasOwn(limits,section)) throw new TypeError('Unknown OPNA section');
  integer(channel,limits[section]-1,'OPNA channel'); integer(referenceNote,127,'Reference note');
  const preset = readPreset(basePreset);
  if (section === 'fm') {
    const voice = snapshot.fm.channels[channel], p = voice.preset;
    preset.fm[channel] = {...clone(p),operators:[1,2,3,4].map(index => clone(p.operators[index])),
      keyMask:voice.selectedKeyMask ?? (voice.keyMask || voice.lastKeyMask || 15)};
    preset.lfo = clone(snapshot.lfo);
    if (channel === 2) preset.channel3 = clone(snapshot.channel3);
  } else if (section === 'ssg') {
    const voice = snapshot.ssg.channels[channel];
    preset.ssg.channels[channel] = {tone:voice.tone,noise:voice.noise,volume:voice.volume,envelope:voice.envelope};
    for (const key of ['noisePeriod','envelopePeriod','envelopeShape']) preset.ssg[key] = snapshot.ssg[key];
  } else if (section === 'rhythm') {
    preset.rhythm.volume = snapshot.rhythm.volume;
    const voice = snapshot.rhythm.voices[channel];
    preset.rhythm.voices[channel] = {volume:voice.volume,left:voice.left,right:voice.right};
  } else {
    const a = snapshot.adpcm;
    if (!a.external) throw new Error('ADPCM capture requires external sample memory; CPU-driven live streams have no complete sample');
    if (a.addressShift !== 5) throw new Error('ADPCM capture requires 32-byte-addressed ROM or 8-bit DRAM mode');
    if (!a.available || !(a.data instanceof Uint8Array)) throw new Error('The complete ADPCM sample range has not been recorded in this song');
    if (!a.deltaN) throw new Error('ADPCM capture requires a nonzero playback rate');
    preset.adpcm = {...preset.adpcm,data:encodeBase64(a.data),address:a.start,start:a.start,end:a.end,
      sampleRate:a.sampleRate,rootNote:referenceNote,volume:a.volume,left:a.left,right:a.right,repeat:a.repeat};
  }
  return readPreset(preset);
}
