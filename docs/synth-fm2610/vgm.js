// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {maybeDecodeVgmFile,parseVgmMetadata} from '../js/vgm_file.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {Ym2610BAudioEngine} from '../js/ym2610baudioengine.js?v=ym2610-source-mix-1';
import {createYm2612RegisterState,isYm2612ViewRegister} from '../synth/synth_song_state.js';
import {channel3PitchRatios} from '../synth/synth_song_voice.js';
import {isFm2610Channel3Special,readFm2610VoicePatch} from './fm_patch.js';
import {createFm2610SongAdpcmState,isFm2610SongAdpcmRegister} from './song_adpcm_state.js';
import {createFm2610SongSsgState,isFm2610SongSsgRegister} from './song_ssg_state.js';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_SAMPLES = 44100 * 3600;
const MAX_PRESETS = 4096;
const NEO_GEO_FM_CHANNELS = [1,2,4,5];
const YM2610B_FM_CHANNELS = [0,1,2,3,4,5];
const COMMANDS = new Set([0x58,0x59,0x61,0x62,0x63,0x66,0x67]);
const parserOptions = {logger:{warn:message => {throw new Error(message);}}};

function resetFmState(state) {
  state.reset();
  // ymfm initializes the OPN stereo outputs enabled.
  for (let port = 0; port < 2; port++) {
    for (let channel = 0; channel < 3; channel++) state.write(port,0xb4 + channel,0xc0);
  }
}

function collectFmPresets(clock, variant, warnings) {
  const state = createYm2612RegisterState(clock);
  resetFmState(state);
  const keyedChannels = new Set();
  const seen = new Map();
  const presets = [];

  return {
    presets,
    write({port,register,value}) {
      state.write(port,register,value);
      if (port !== 0 || register !== 0x28 || (value & 3) === 3 || (value & 0xf0) === 0) return;
      const channel = (value & 3) + (value & 4 ? 3 : 0);
      if (variant === 'ym2610b' || NEO_GEO_FM_CHANNELS.includes(channel)) keyedChannels.add(channel);
    },
    capture(firstSample) {
      if (!keyedChannels.size) return;
      const {channels,lfo} = state.snapshot(firstSample);
      for (const physicalChannel of keyedChannels) {
        const voice = channels[physicalChannel];
        const {pan,ams,pms,operators} = voice.preset;
        if (!voice.gate || !(pan.left || pan.right)) continue;
        // Only patches that use modulation need to override the chip-wide LFO.
        const usesLfo = pms > 0 || (ams > 0 && Object.values(operators).some(operator => operator.am));
        const preset = readFm2610VoicePatch(voice, {lfo:usesLfo ? lfo : undefined});
        const special = isFm2610Channel3Special(preset);
        // Keep the first attack's raw pitches. A transposition of all four OPs is still the same playable patch.
        const signature = JSON.stringify([physicalChannel, special
          ? {...preset,specialFrequencies:channel3PitchRatios(preset.specialFrequencies)} : preset]);
        const previous = seen.get(signature);
        if (previous) {
          previous.occurrences++;
        } else if (presets.length >= MAX_PRESETS) {
          warnings.add('Only the first 4,096 distinct FM presets were extracted.');
        } else {
          const label = variant === 'ym2610b' ? 'YM2610B' : 'YM2610';
          const name = `${label} CH${physicalChannel + 1}${special ? ' Special' : ''} · ${String(presets.length + 1).padStart(3,'0')}`;
          const entry = {name,variant,physicalChannel,preset,firstSample,occurrences:1};
          seen.set(signature,entry);
          presets.push(entry);
        }
      }
      keyedChannels.clear();
    },
  };
}

/** Trace register and ROM writes at the frames rendered by the existing player.
 * Only expose writes whose frames the caller has reached in the output.
 */
export function createFm2610SongTimeline(engine,{variant,clock}) {
  const shadow = createYm2612RegisterState(clock);
  const renderShadow = createYm2612RegisterState(clock);
  const adpcm = createFm2610SongAdpcmState({clock,outputSampleRate:engine.sampleRate?.()});
  const ssg = createFm2610SongSsgState();
  resetFmState(shadow);
  resetFmState(renderShadow);
  const slots = variant === 'ym2610b' ? YM2610B_FM_CHANNELS : NEO_GEO_FM_CHANNELS;
  const originalWrite = engine.writeYm2610B;
  const originalLoadRom = engine.loadAdpcmRom;
  const originalClearRom = engine.clearAdpcmRoms;
  const originalProcess = engine.processFrames;
  const originalReset = engine.reset;
  let generatedFrames = 0, lastFrame = -1, events = [], head = 0, normalized, normalizedRender;

  function write(port,register,value) {
    const result = originalWrite.call(this,port,register,value);
    // YM2610 does not expose the YM2612 DAC register.
    if (!(port === 0 && register === 0x2b) && isYm2612ViewRegister(port,register)) {
      renderShadow.write(port,register,value);
      events.push({frame:generatedFrames,kind:'fm',port,register,value});
    } else if (isFm2610SongAdpcmRegister(port,register)) {
      events.push({frame:generatedFrames,kind:'adpcm',port,register,value});
    } else if (isFm2610SongSsgRegister(port,register)) {
      events.push({frame:generatedFrames,kind:'ssg',register,value});
    }
    return result;
  }
  function loadRom(type,bytes,offset,size) {
    const result = originalLoadRom.call(this,type,bytes,offset,size);
    // The VGM parser owns each ROM block. Retain it until its frame is audible.
    events.push({frame:generatedFrames,kind:'rom',type,bytes,offset,size});
    return result;
  }
  function clearRom() {
    const result = originalClearRom.call(this);
    events.push({frame:generatedFrames,kind:'clear-rom'});
    return result;
  }
  function process(frames) {
    const result = originalProcess.call(this,frames);
    generatedFrames += frames;
    return result;
  }
  function reset() {
    const result = originalReset.call(this);
    generatedFrames = 0;
    lastFrame = -1;
    events = [];
    head = 0;
    normalized = normalizedRender = undefined;
    resetFmState(shadow);
    resetFmState(renderShadow);
    adpcm.reset();
    ssg.reset();
    return result;
  }
  engine.writeYm2610B = write;
  if (typeof originalLoadRom === 'function') engine.loadAdpcmRom = loadRom;
  if (typeof originalClearRom === 'function') engine.clearAdpcmRoms = clearRom;
  engine.processFrames = process;
  engine.reset = reset;

  function advance(frame) {
    // Writes at the render cursor have not necessarily produced any PCM yet.
    const next = Math.max(-1,Math.min(generatedFrames - 1,frame));
    if (next < lastFrame) throw new RangeError('The VGM register timeline can only advance.');
    while (head < events.length && events[head].frame <= next) {
      const event = events[head++];
      switch (event.kind) {
        case 'fm': shadow.write(event.port,event.register,event.value); break;
        case 'adpcm': adpcm.write(event.port,event.register,event.value,event.frame); break;
        case 'ssg': ssg.write(event.register,event.value); break;
        case 'rom': adpcm.loadRom(event.type,event.bytes,event.offset,event.size); break;
        case 'clear-rom': adpcm.clearRom(); break;
      }
    }
    lastFrame = next;
    if (head === events.length) {
      events = [];
      head = 0;
    } else if (head > 512) {
      events = events.slice(head);
      head = 0;
    }
  }

  function adpcmReader(state) {
    const {getAdpcmAWindow,readAdpcmABytes,readAdpcmBBytes,retainAdpcmARom} = state;
    return {getAdpcmAWindow,readAdpcmABytes,readAdpcmBBytes,retainAdpcmARom};
  }

  function normalizeFm(raw, cached) {
    if (cached?.revision === raw.revision) return cached;
    const {clockHz,revision,lfo,modeRegister,csmEnabled} = raw;
    const channels = slots.map(physicalChannel => {
      const {preset,...voice} = raw.channels[physicalChannel];
      const operators = Object.freeze(Object.values(preset.operators));
      const patch = Object.freeze({...preset,operators,keyMask:voice.keyMask});
      return Object.freeze({...voice,physicalChannel,preset:patch});
    });
    return {variant,clockHz,revision,lfo,modeRegister,csmEnabled,channels:Object.freeze(channels)};
  }

  function writeFm(writes) {
    if (!Array.isArray(writes) || writes.length > 256) throw new RangeError('Provide up to 256 FM register writes.');
    const batch = Array.from(writes, command => {
      const {port,register,value} = command ?? {};
      if ((port !== 0 && port !== 1) || !Number.isInteger(register) || !Number.isInteger(value) ||
          value < 0 || value > 255 || !isYm2612ViewRegister(port,register) ||
          (port === 0 && (register === 0x28 || register === 0x2b))) {
        throw new RangeError('Choose a valid YM2610 FM parameter register and byte value.');
      }
      const shared = port === 0 && (register === 0x22 || register === 0x27 ||
        (register >= 0xa8 && register <= 0xae));
      if (!shared && !slots.includes(port * 3 + (register & 3))) {
        throw new RangeError('That FM channel is unavailable on this VGM chip.');
      }
      return {port,register,value};
    });
    for (const {port,register,value} of batch) {
      // A keyboard Special switch owns bit 6 only. Keep the song's timers
      // and CSM bit, and do not resubmit any flag-reset strobes.
      const data = port === 0 && register === 0x27
        ? (renderShadow.snapshot().modeRegister & 0x8f) | (value & 0x40) : value;
      engine.writeYm2610B(port,register,data);
    }
    return batch.length > 0;
  }

  function detach() {
    // Discard future writes and remove every reference installed on the renderer.
    events = [];
    head = 0;
    if (engine.writeYm2610B === write) engine.writeYm2610B = originalWrite;
    if (engine.loadAdpcmRom === loadRom) engine.loadAdpcmRom = originalLoadRom;
    if (engine.clearAdpcmRoms === clearRom) engine.clearAdpcmRoms = originalClearRom;
    if (engine.processFrames === process) engine.processFrames = originalProcess;
    if (engine.reset === reset) engine.reset = originalReset;
  }

  return {
    advance, writeFm,
    read(frame) {
      advance(frame);
      normalized = normalizeFm(shadow.snapshot(lastFrame),normalized);
      return Object.freeze({...normalized,adpcm:adpcm.snapshot(),ssg:ssg.snapshot(),frame:lastFrame});
    },
    readFmAtRenderFront() {
      normalizedRender = normalizeFm(renderShadow.snapshot(),normalizedRender);
      return Object.freeze({...normalizedRender,frame:generatedFrames});
    },
    saveState() {
      return {generatedFrames,lastFrame,events:events.slice(head),fm:shadow.saveState(),renderFm:renderShadow.saveState(),
        adpcm:adpcm.saveState(),ssg:ssg.saveState()};
    },
    loadState(state) {
      shadow.loadState(state.fm);
      renderShadow.loadState(state.renderFm);
      adpcm.loadState(state.adpcm);
      ssg.loadState(state.ssg);
      ({generatedFrames,lastFrame,events} = state);
      events = events.slice();
      head = 0;
      normalized = normalizedRender = undefined;
    },
    ...adpcmReader(adpcm),
    retainAdpcm() {
      const retained = createFm2610SongAdpcmState({clock,outputSampleRate:engine.sampleRate?.()});
      retained.loadState(adpcm.saveState());
      return adpcmReader(retained);
    },
    dispose() {
      detach();
      adpcm.reset();
    },
  };
}

/** Validate a single-chip VGM/VGZ and capture static FM settings at note attacks. */
export async function prepareFm2610Vgm(source,{name = '',signal} = {}) {
  signal?.throwIfAborted();
  if (!(source instanceof Uint8Array) && !(source instanceof ArrayBuffer)) throw new TypeError('Choose a binary VGM or VGZ file.');
  if (source.byteLength > MAX_BYTES) throw new RangeError('VGM file exceeds 64 MiB.');
  let bytes = new Uint8Array(await maybeDecodeVgmFile(source,{maxBytes:MAX_BYTES}));
  signal?.throwIfAborted();
  if (bytes.length < 0x50) throw new Error('VGM header is too short for a YM2610 clock.');
  const eof = new DataView(bytes.buffer).getUint32(4,true);
  if (eof && eof + 4 > bytes.length) throw new Error('VGM is shorter than the size in its header.');
  if (eof) bytes = bytes.subarray(0,eof + 4);
  if (bytes.length < 0x50) throw new Error('VGM header is too short for a YM2610 clock.');

  const parser = new Ym2612VGM(bytes,parserOptions);
  const {version,ym2610Clock,dataOffset,loopOffset} = parser.header;
  if (version < 0x151 || dataOffset < 0x50 || dataOffset >= bytes.length) throw new Error('Invalid YM2610 VGM version or data offset.');
  if (ym2610Clock & 0x40000000) throw new Error('VGM playback supports one YM2610 or YM2610B.');
  const clock = ym2610Clock & 0x3fffffff;
  if (!clock) throw new Error('VGM header specifies no YM2610 or YM2610B clock.');
  if (clock > 24000000) throw new RangeError('YM2610 clock exceeds the 24 MHz playback limit.');
  const variant = ym2610Clock & 0x80000000 ? 'ym2610b' : 'ym2610';
  const warnings = new Set();
  if (loopOffset) warnings.add('Playback runs once through the song.');
  const fm = collectFmPresets(clock,variant,warnings);
  const metadata = parseVgmMetadata(bytes);
  let commands = 0;
  let burst = 0;
  let writes = 0;
  let totalSamples = 0;
  let ended = false;
  while (parser.position < bytes.length) {
    signal?.throwIfAborted();
    if (++commands > 4000000) throw new RangeError('VGM exceeds four million commands.');
    if (++burst > 65536) throw new RangeError('VGM exceeds 65,536 commands without advancing time.');
    const position = parser.position;
    const command = bytes[position];
    if (!COMMANDS.has(command) && !(command >= 0x70 && command <= 0x7f)) {
      throw new Error(`Unsupported YM2610 VGM command 0x${command.toString(16).padStart(2,'0')}.`);
    }
    // Other data block types are skipped recursively by the generic parser.
    // Limit this input to the two ROM types used by the playback engine.
    if (command === 0x67 && bytes[position + 2] !== 0x82 && bytes[position + 2] !== 0x83) {
      throw new Error('YM2610 playback supports ADPCM-A and ADPCM-B ROM blocks.');
    }
    const event = parser.step();
    if (event.type === 'wait' && event.samples > 0) {
      fm.capture(totalSamples);
      totalSamples += event.samples;
      if (totalSamples > MAX_SAMPLES) throw new RangeError('VGM exceeds one hour of playback.');
      burst = 0;
    } else if (event.type === 'ym2610-write') {
      writes++;
      fm.write(event);
    } else if (event.type === 'ym2610-rom-data' && event.chipIndex) {
      throw new Error('VGM contains ROM data for a second YM2610 chip.');
    } else if (event.type === 'end') {
      ended = true;
      break;
    }
    if (commands % 4096 === 0) await new Promise(resolve => setTimeout(resolve,0));
  }
  if (!ended) throw new Error('VGM command stream has no end command.');
  if (!writes || !totalSamples) throw new Error('VGM contains no timed YM2610 or YM2610B writes.');
  if (fm.presets.length) warnings.add('FM presets capture static settings at note attacks. The song retains its automation.');
  return {name:String(name),bytes,variant,clock,totalSamples,metadata,presets:fm.presets,warnings:[...warnings]};
}

/** Make a song engine at the VGM's recorded chip clock and the host output rate. */
export async function createFm2610VgmEngine(prepared,{outputSampleRate,masterVolume,signal,moduleFactory,moduleOptions} = {}) {
  signal?.throwIfAborted();
  if (!moduleFactory) {
    const [module,response] = await Promise.all([
      import('../generated/ym2610b_wasm.js?v=ym2610-source-mix-1'),
      fetch(new URL('../generated/ym2610b_wasm.wasm?v=ym2610-source-mix-1',import.meta.url),{signal}),
    ]);
    if (!response.ok) throw new Error(`YM2610 audio processor could not be loaded (${response.status}).`);
    moduleFactory = module.default;
    moduleOptions = {...moduleOptions,wasmBinary:await response.arrayBuffer()};
  }
  signal?.throwIfAborted();
  const engine = await Ym2610BAudioEngine.create({
    moduleFactory,moduleOptions,outputSampleRate,masterVolume,
    clock:prepared.clock,variant:prepared.variant === 'ym2610b',
  });
  if (signal?.aborted) {
    engine.dispose();
    signal.throwIfAborted();
  }
  return engine;
}

/** Playback retains the original write order and both ROM block streams. */
export function createFm2610VgmPlayer(engine,prepared,options = parserOptions) {
  const player = new VgmPlayer(engine);
  player.load(prepared.bytes,options);
  player.setLoopEnabled(false);
  return player;
}
