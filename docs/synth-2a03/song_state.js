// SPDX-License-Identifier: BSD-3-Clause
import {createDefaultPreset,readPreset} from './preset.js';

export const NES_SONG_SOURCES = Object.freeze(['pulse','pulse','triangle','noise','dmc','fds']);
const DUTIES = [.125,.25,.5,.75];
const midi = hz => hz > 0 ? 69 + 12 * Math.log2(hz / 440) : null;
const signed7 = value => ((value & 127) ^ 64) - 64;
const copy = value => structuredClone(value);
const channelIndex = channel => {
  if (!Number.isInteger(channel) || channel < 0 || channel > 5) throw new RangeError('NES channel must be 0..5');
  return channel;
};

/** Convert observed controls into the existing portable preset format. This
 * also accepts the Synth / Code read() response. Hardware counters remain in
 * coreState; a captured preset restarts their authored settings on a new key. */
export function createNesSongSnapshot(state,{frame=0,clockHz=state?.coreState?.clock ?? 1789773} = {}) {
  const core = state?.coreState ?? null, registers = Uint8Array.from(state?.registers ?? core?.registers ?? []);
  if (registers.length < 0x8b) throw new Error('NES register observation is unavailable');
  const known = state.knownRegisters ?? new Uint8Array(registers.length).fill(1);
  const wave = Array.from(state.wave ?? core?.wave ?? state.preset?.fds?.wave ?? Array(64).fill(0));
  const modulation = Array.from(state.modulation ?? core?.modulation ?? state.preset?.fds?.modulation?.table ?? Array(32).fill(0));
  const waveComplete = state.waveComplete ?? Boolean(core?.wave);
  const modulationComplete = state.modulationComplete ?? Boolean(core?.modulation);
  const dmcAddress = 0xc000 + registers[0x12] * 64, dmcLength = registers[0x13] * 16 + 1;
  let dmcSample = state.dmcSample ?? null;
  if (!dmcSample && dmcAddress === 0xc000) {
    const data = state.channelPresets?.[4]?.dmc?.data ?? (state.preset?.source === 'dmc' ? state.preset.dmc.data : null);
    if (data?.length && Math.ceil((data.length-1)/16)*16+1 === dmcLength) {
      const padded = new Uint8Array(dmcLength).fill(0xaa); padded.set(data);
      dmcSample = {available:true,data:padded,address:dmcAddress,length:dmcLength};
    }
  }
  const channels = NES_SONG_SOURCES.map((source,channel) => {
    const preset = readPreset(state.channelPresets?.[channel] ?? state.preset ?? createDefaultPreset());
    preset.source = source;
    let period = 0, frequencyHz = 0, gate = false, captureError = '', notes = [];
    const base = channel * 4, control = registers[base], length = core?.lengths?.[channel] ?? null;
    if (channel < 2) {
      const sweep = registers[base+1];
      period = registers[base+2] | (registers[base+3] & 7) << 8;
      frequencyHz = clockHz / (16 * (period+1));
      preset.pulse = {duty:DUTIES[control>>6],volume:control & 16 ? control & 15 : 15,
        lengthHalt:Boolean(control & 32),lengthIndex:registers[base+3]>>3,
        envelope:{enabled:!(control & 16),period:control & 15,loop:Boolean(control & 32)},
        sweep:{enabled:Boolean(sweep & 128),period:sweep>>4 & 7,negate:Boolean(sweep & 8),shift:sweep & 7}};
      gate = Boolean(registers[0x15] & 1 << channel) && (length === null || length > 0);
      if (![base,base+3].every(index => known[index])) captureError = 'The complete Pulse controls have not been recorded yet.';
      notes.push('Pulse envelope, sweep and length counters restart on keyboard attack.');
    } else if (channel === 2) {
      period = registers[10] | (registers[11] & 7) << 8; frequencyHz = clockHz / (32 * (period+1));
      preset.triangle = {control:Boolean(registers[8]&128),linearReload:registers[8]&127,lengthIndex:registers[11]>>3};
      gate = Boolean(registers[0x15]&4) && (length === null || length > 0) && Boolean(registers[8]&127);
      if (!known[8] || !known[11]) captureError = 'The complete Triangle counter controls have not been recorded yet.';
      notes.push('Triangle linear and length counters restart on keyboard attack.');
    } else if (channel === 3) {
      const c = registers[12];
      preset.noise = {volume:c & 16 ? c & 15 : 15,period:registers[14]&15,shortMode:Boolean(registers[14]&128),
        lengthHalt:Boolean(c&32),lengthIndex:registers[15]>>3,
        envelope:{enabled:!(c&16),period:c&15,loop:Boolean(c&32)}};
      gate = Boolean(registers[0x15]&8) && (length === null || length > 0);
      if (![12,14,15].every(index => known[index])) captureError = 'The complete Noise controls have not been recorded yet.';
      notes.push('Noise envelope, LFSR and length phase restart on keyboard attack.');
    } else if (channel === 4) {
      const available = Boolean(dmcSample && dmcSample.available !== false && dmcSample.data?.length === dmcLength);
      preset.dmc = {data:available ? Array.from(dmcSample.data) : [],rate:registers[16]&15,loop:Boolean(registers[16]&64),
        level:Math.min(127,core?.dmcOutput ?? registers[17]&127)};
      gate = Boolean(registers[0x15]&16) && (core?.dmcRemaining ?? 1) > 0;
      if (!available || ![16,18,19].every(index => known[index])) captureError = 'The complete DMC sample range and playback controls have not been recorded yet.';
      notes.push('DMC restarts the recorded sample, using the observed DAC level; DMA and output-byte phase restart.');
    } else {
      const r = registers, gain = Math.min(32,core?.fdsGain ?? r[0x80]&63), depth = Math.min(63,core?.fdsSweepGain ?? r[0x84]&63);
      period = r[0x82] | (r[0x83]&15)<<8; frequencyHz = period * clockHz / 4194304;
      preset.fds = {wave,volume:gain,master:r[0x89]&3,
        envelope:{enabled:!(r[0x80]&128),increase:Boolean(r[0x80]&64),period:r[0x80]&63,initialGain:Math.min(63,core?.fdsGain ?? r[0x80]&63)},
        envelopeClock:{masterSpeed:r[0x8a],halt:Boolean(r[0x83]&64)},
        modulation:{enabled:!(r[0x87]&128),table:modulation,rate:r[0x86]|(r[0x87]&15)<<8,depth,
          bias:Math.max(-64,Math.min(63,core?.fdsModCounter ?? signed7(r[0x85]))),
          envelope:{enabled:!(r[0x84]&128),increase:Boolean(r[0x84]&64),period:r[0x84]&63,initialGain:depth}}};
      gate = Boolean(r[0x23]&2) && !(r[0x83]&128) && !(r[0x89]&128) && period > 0;
      if (!waveComplete) captureError = 'The complete FDS Wave RAM has not been recorded yet.';
      else if (preset.fds.modulation.enabled && !modulationComplete) captureError = 'The complete enabled FDS modulation table has not been recorded yet.';
      else if (![0x80,0x82,0x83].every(index => known[index])) captureError = 'The complete FDS playback controls have not been recorded yet.';
      notes.push('FDS envelopes start from the observed gain; oscillator, modulation and envelope divider phases restart.');
    }
    preset.name = `VGM CH${channel+1} ${source === 'fds' ? 'FDS' : source === 'dmc' ? 'DMC' : source[0].toUpperCase()+source.slice(1)}`;
    return {channel,source,period,frequencyHz,midi:midi(frequencyHz),gate,enabled:channel===5 ? Boolean(registers[0x23]&2) : Boolean(registers[0x15]&1<<channel),
      volume:channel===5 ? core?.fdsGain ?? preset.fds.volume : channel===4 ? core?.dmcOutput ?? preset.dmc.level : core?.volumes?.[channel] ?? null,
      length,preset:readPreset(preset),captureError,canCapture:!captureError,warnings:notes};
  });
  return {kind:'nes',present:true,frame,clockHz,registers,knownRegisters:Uint8Array.from(known),coreState:core ? copy(core) : null,
    waveComplete,modulationComplete,dmcSample:dmcSample ? {...dmcSample,data:dmcSample.data?.slice()} : null,channels};
}

export function captureNesSongPreset(snapshot,{channel=0,basePreset=createDefaultPreset()} = {}) {
  channelIndex(channel);
  if (snapshot?.kind !== 'nes') snapshot = createNesSongSnapshot(snapshot);
  const voice = snapshot.channels[channel];
  if (!voice?.canCapture) throw new Error(voice?.captureError ?? 'Choose a recorded NES channel first');
  const preset = readPreset(basePreset), captured = readPreset(voice.preset);
  preset.source = captured.source; preset.name = captured.name; preset[captured.source] = captured[captured.source];
  return readPreset(preset);
}

/** Raw written controls and known-memory tracking. Reads never clock the APU. */
export function createNesRegisterState(clockHz=1789773) {
  const registers = new Uint8Array(0x90), knownRegisters = new Uint8Array(0x90);
  const wave = new Uint8Array(64), waveKnown = new Uint8Array(64), modulation = new Uint8Array(32), modulationKnown = new Uint8Array(32);
  const memory = new Uint8Array(65536), knownMemory = new Uint8Array(65536);
  let revision = 0, coreState = null, modulationWrites = 0, modIndex = 0;
  let memoryRevision = 0, sampleKey = '', dmcSample = null;
  function reset() {
    registers.fill(0); knownRegisters.fill(0); wave.fill(0); waveKnown.fill(0); modulation.fill(0);modulationKnown.fill(0);
    memory.fill(0); knownMemory.fill(0); revision++; memoryRevision++; coreState = null; modulationWrites = modIndex = 0; sampleKey = '';
  }
  function write(address,value,{modulationIndex}={}) {
    const index = address-0x4000;
    if (address >= 0x4040 && address <= 0x407f) {
      if (registers[0x23]&2 && registers[0x89]&128) {wave[index-0x40] = value&63; waveKnown[index-0x40] = 1;}
    } else if (address === 0x4088) {
      if (registers[0x23]&2 && registers[0x87]&128) {
        if(Number.isInteger(modulationIndex))modIndex=(modulationIndex>>1)&31;
        modulation[modIndex] = value&7;modulationKnown[modIndex]=1;
        modIndex = (modIndex+1)%32; modulationWrites = modulationKnown.reduce((sum,value)=>sum+value,0);
      }
    } else if (index>=0 && index<registers.length) {
      registers[index] = value; knownRegisters[index] = 1;
    }
    revision++;
  }
  function loadMemory(data,address=0) {memory.set(data,address); knownMemory.fill(1,address,address+data.length); memoryRevision++; sampleKey = '';}
  function hardware(state) {
    coreState = state ? copy(state) : null;
    if(Number.isInteger(state?.fdsModIndex))modIndex=(state.fdsModIndex>>1)&31;
    if (state?.modulation && modulationWrites===32) modulation.set(state.modulation);
  }
  function snapshot(frame=0) {
    const address = 0xc000+registers[18]*64, length = registers[19]*16+1, key = `${memoryRevision}:${address}:${length}`;
    if (sampleKey !== key) {
      const data = new Uint8Array(length); let available = true, current = address;
      for (let index=0;index<length;index++) {data[index]=memory[current]; available &&= Boolean(knownMemory[current]); current = current===65535 ? 0x8000 : current+1;}
      dmcSample = {address,length,available,data:available ? data : null}; sampleKey = key;
    }
    const result = createNesSongSnapshot({registers,knownRegisters,wave,modulation,waveComplete:waveKnown.every(Boolean),
      modulationComplete:modulationWrites===32,dmcSample,coreState},{frame,clockHz});
    result.revision = revision; return result;
  }
  reset();
  return {write,loadMemory,hardware,reset,snapshot,getMemory:() => memory.slice()};
}

/** Retain the audible frame's controls rather than the renderer's short
 * lookahead. Original song controls stay available after manual overrides. */
export function createNesSongTimeline(engine,clockHz=1789773) {
  const shadow = createNesRegisterState(clockHz), songShadow = createNesRegisterState(clockHz);
  const original = {write:engine.writeRegister,load:engine.loadMemory,reset:engine.reset,process:engine.processFrames};
  let generatedFrames = 0, lastReadFrame = 0, events = [], head = 0, disposed = false;
  const push = event => {if (!disposed) events.push({frame:generatedFrames,manual:Boolean(engine.manualWrite),...event});};
  function write(address,value) {
    const modulationIndex=address===0x4088?engine.getCoreState()?.fdsModIndex:undefined;
    const result = original.write.call(this,address,value); push({type:'write',address,value,modulationIndex}); return result;
  }
  function load(data,address=0) {const result = original.load.call(this,data,address); push({type:'load',data:data.slice(),address}); return result;}
  function process(frames) {
    const result = original.process.call(this,frames); generatedFrames += frames;
    push({type:'hardware',state:engine.getCoreState()}); return result;
  }
  function reset(...args) {const result = original.reset.apply(this,args); generatedFrames=lastReadFrame=head=0; events=[]; shadow.reset(); songShadow.reset(); return result;}
  engine.writeRegister=write; engine.loadMemory=load; engine.processFrames=process; engine.reset=reset;
  function read(frame) {
    const next = Math.max(0,Math.min(generatedFrames,Math.floor(frame)));
    if (next<lastReadFrame) throw new Error('NES observation cannot move backwards without resetting');
    while (head<events.length && events[head].frame<=next) {
      const event = events[head++];
      for (const target of event.manual ? [shadow] : [shadow,songShadow]) {
        if (event.type==='write') target.write(event.address,event.value,event);
        else if (event.type==='load') target.loadMemory(event.data,event.address);
        else target.hardware(event.state);
      }
    }
    lastReadFrame=next;
    if (head===events.length) {events=[];head=0;}
    else if (head>256) {events=events.slice(head);head=0;}
    return shadow.snapshot(next);
  }
  return {read,readSong(frame) {read(frame);return songShadow.snapshot(lastReadFrame);},getMemory:() => shadow.getMemory(),
    get generatedFrames() {return generatedFrames;},dispose() {
      disposed=true;events=[];
      for (const [key,installed] of [['writeRegister',write],['loadMemory',load],['reset',reset],['processFrames',process]]) {
        const saved = key==='writeRegister' ? original.write : key==='loadMemory' ? original.load : key==='processFrames' ? original.process : original.reset;
        if (engine[key]===installed) engine[key]=saved;
      }
    }};
}
