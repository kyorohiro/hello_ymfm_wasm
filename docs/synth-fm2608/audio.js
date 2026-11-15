// SPDX-License-Identifier: BSD-3-Clause
import {YM2608RuntimeSynth} from '../js/ym2608synth.js';
import {readSamplePCM,encodeAdpcmB} from '../js/adpcm_b_sample.js';
import {noteToHz,opnPitchFromHz} from '../js/soundchip_pitch.js';
import {createSynthCodeOutput} from '../synth/synth_code_output.js';
import {createYm2612RegisterState} from '../synth/synth_song_state.js';
import {createDefaultPreset,readPreset,encodeBase64,decodeBase64,MAX_ADPCM_BYTES} from './preset.js';

const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
const FM_SLOT_OFFSETS = [0,8,4,12];
const KEY_CHANNELS = [0,1,2,-1,3,4,5,-1];
const LIMITS = {fm:6,ssg:3,rhythm:6,adpcm:1};
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const cancelled = () => new DOMException('OPNA sample operation was superseded','AbortError');

function channelIndex(section, channel) {
  if (!Object.hasOwn(LIMITS,section) || !Number.isInteger(channel) || channel < 0 || channel >= LIMITS[section]) {
    throw new RangeError('Invalid OPNA section/channel');
  }
  return channel;
}
function checkVolume(volume) {
  if (!Number.isFinite(volume) || volume < 0 || volume > 3.8) throw new RangeError('Master must be 0–3.8');
}

/** Host software monitor mutes retain every original register write, including
 * Code writes. The chip client's own shadows keep the unmuted parameter values.
 */
export function installMonitorMutes(chip) {
  const transport = chip.transport, registers = [new Uint8Array(256),new Uint8Array(256)];
  const fmState = createYm2612RegisterState(chip.clock);
  const muted = {fm:Array(6).fill(false),ssg:Array(3).fill(false),rhythm:Array(6).fill(false),adpcm:[false]};
  const stopped = Array(6).fill(false);
  const write = transport.write.bind(transport), reset = transport.reset?.bind(transport);
  const batch = transport.writeBatch?.bind(transport);
  const fmLevel = (port,register) => register >= 0x40 && register <= 0x4e && (register & 3) < 3
    ? (register & 3) + port * 3 : -1;

  function levelRegisters(channel) {
    return FM_SLOT_OFFSETS.map(offset => ({port:channel >= 3 ? 1 : 0,register:0x40 + channel % 3 + offset}));
  }
  function restoreFm(channel) {
    for (const {port,register} of levelRegisters(channel)) write(port,register,
      muted.fm[channel] || stopped[channel] ? 127 : registers[port][register]);
  }
  function filter(port,register,value) {
    registers[port][register] = value;
    fmState.write(port,register,value);
    if (port === 0 && register === 0x28 && value & 0xf0) {
      const channel = KEY_CHANNELS[value & 7];
      if (channel >= 0 && stopped[channel]) { stopped[channel] = false; restoreFm(channel); }
    }
    const fm = fmLevel(port,register);
    if (fm >= 0 && (muted.fm[fm] || stopped[fm])) return 127;
    if (port === 0 && register >= 8 && register <= 10 && muted.ssg[register - 8]) return 0;
    if (port === 0 && register >= 0x18 && register <= 0x1d && muted.rhythm[register - 0x18]) return value & 0x3f;
    if (port === 1 && register === 11 && muted.adpcm[0]) return 0;
    return value;
  }
  transport.write = (port,register,value) => write(port,register,filter(port,register,value));
  if (batch) transport.writeBatch = writes => batch(writes.map(item => ({...item,value:filter(item.port,item.register,item.value)})));
  transport.reset = () => { registers.forEach(values => values.fill(0)); stopped.fill(false); fmState.reset(); return reset?.(); };

  function setMute(section,channel,value) {
    channelIndex(section,channel);
    if (typeof value !== 'boolean') throw new TypeError('Mute must be boolean');
    muted[section][channel] = value;
    if (section === 'fm') restoreFm(channel);
    else {
      const port = section === 'adpcm' ? 1 : 0;
      const register = section === 'ssg' ? 8 + channel : section === 'rhythm' ? 0x18 + channel : 11;
      write(port,register,filter(port,register,registers[port][register]));
    }
    return getState();
  }
  function stopFm() {
    for (let channel = 0; channel < 6; channel++) {
      chip.keyOff(channel); stopped[channel] = true; restoreFm(channel);
    }
  }
  function getState() { return structuredClone(muted); }
  return {setMute,getState,stopFm,registers,getFmState:() => fmState.snapshot()};
}

/** One OPNA feeds the Code FX insertion point, Stop fade and final Master. */
export async function createFm2608Audio({volume = .7,onError = () => {},
  createRuntime = options => new YM2608RuntimeSynth(options),
  createContext = () => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)({latencyHint:'interactive'})} = {}) {
  checkVolume(volume);
  const context = createContext(), codeInputNode = context.createGain(), codeFadeNode = context.createGain();
  const outputNode = context.createGain();
  codeInputNode.connect(codeFadeNode); codeFadeNode.connect(outputNode); outputNode.connect(context.destination);
  outputNode.gain.value = volume;
  const runtime = createRuntime({audioContext:context,outputNode:codeInputNode,masterVolume:1,
    workletUrl:new URL('../js/ym2608-worklet.js',import.meta.url).href,
    wasmUrl:new URL('../generated/ym2608_wasm.wasm',import.meta.url).href});
  const fade = createSynthCodeOutput({getContext:() => context,getGain:() => codeFadeNode});
  let chip, monitor, disposed = false, closing = null, stopping = null, queue = Promise.resolve();
  let preset = createDefaultPreset(), accepted = null, pitch = 0, sampleEpoch = 0;
  let gateEpoch = 0;
  const held = new Map(), gateVersions = new Map();
  const assertOpen = () => { if (disposed || context.state === 'closed') throw new Error('OPNA audio is closed. Enable audio to restart.'); };
  const report = error => { try { onError(error); } catch {} };
  async function bounded(task,label) {
    let timer;
    try { return await Promise.race([task,new Promise((_resolve,reject) => { timer = nativeSetTimeout(() => reject(new Error(label)),15000); })]); }
    finally { nativeClearTimeout(timer); }
  }

  function fmPitch(channel,hz) {
    const value = opnPitchFromHz(hz,chip.clock,144,{clamp:true});
    chip.setBlockFnum(channel,value.block,value.fnum);
  }
  function adpcmPitch(hz,settings = preset.adpcm) {
    const rate = settings.sampleRate * hz / noteToHz(settings.rootNote);
    chip.adpcm.setDeltaN(Math.max(1,Math.min(65535,Math.round(rate * 144 * 65536 / chip.clock))));
  }
  function retune(section,channel,hz) {
    const frequency = hz * 2 ** (pitch / 12);
    if (section === 'fm') fmPitch(channel,frequency);
    else if (section === 'ssg') chip.ssg.setFrequency(channel,frequency);
    else if (section === 'adpcm') adpcmPitch(frequency);
  }

  async function installPreset(next) {
    assertOpen();
    const previous = accepted;
    const replaceSample = !previous || previous.adpcm.data !== next.adpcm.data;
    const wasPlaying = replaceSample && Boolean(chip.adpcm.registers[0] & 0x80);
    if (replaceSample) {
      const bytes = decodeBase64(next.adpcm.data);
      chip.adpcm.keyOff();
      try { await bounded(chip.adpcm.loadMemory(bytes,0),'ADPCM-B memory transfer timed out'); }
      catch (error) {
        if (previous && !disposed && context.state !== 'closed') {
          try {
            await bounded(chip.adpcm.loadMemory(decodeBase64(previous.adpcm.data),0),'ADPCM-B recovery timed out');
            chip.adpcm.setSample({start:0,end:decodeBase64(previous.adpcm.data).length});
            if (wasPlaying) chip.adpcm.keyOn({repeat:previous.adpcm.repeat});
          } catch (recoveryError) { report(recoveryError); }
        }
        throw error;
      }
      assertOpen();
      chip.adpcm.setSample({start:0,end:bytes.length});
    }
    for (let channel = 0; channel < 6; channel++) {
      if (!previous || !same(previous.fm[channel],next.fm[channel])) chip.setPreset(channel,next.fm[channel]);
    }
    if (!previous || !same(previous.lfo,next.lfo)) chip.setLfo(next.lfo.enabled,next.lfo.frequency);
    for (let channel = 0; channel < 3; channel++) {
      const value = next.ssg.channels[channel], old = previous?.ssg.channels[channel];
      if (old && same(old,value)) continue;
      const active = Boolean(chip.ssg.registers[8 + channel] & 31);
      if (!old || old.tone !== value.tone || old.noise !== value.noise) chip.ssg.setMixer(channel,value);
      if (!old || old.volume !== value.volume || old.envelope !== value.envelope) {
        chip.ssg.setVolume(channel,value.volume,value.envelope);
        if (!active) chip.ssg.keyOff(channel);
      }
    }
    if (!previous || previous.ssg.noisePeriod !== next.ssg.noisePeriod) chip.ssg.write(6,next.ssg.noisePeriod);
    if (!previous || previous.ssg.envelopePeriod !== next.ssg.envelopePeriod) {
      chip.ssg.write(11,next.ssg.envelopePeriod & 255); chip.ssg.write(12,next.ssg.envelopePeriod >> 8);
    }
    if (!previous || previous.ssg.envelopeShape !== next.ssg.envelopeShape) chip.ssg.write(13,next.ssg.envelopeShape);
    if (!previous || previous.rhythm.volume !== next.rhythm.volume) chip.rhythm.setVolume(next.rhythm.volume);
    for (let channel = 0; channel < 6; channel++) {
      if (!previous || !same(previous.rhythm.voices[channel],next.rhythm.voices[channel])) chip.rhythm.setVoice(channel,next.rhythm.voices[channel]);
    }
    const adpcm = next.adpcm, oldAdpcm = previous?.adpcm;
    if (!oldAdpcm || oldAdpcm.volume !== adpcm.volume) chip.adpcm.setVolume(adpcm.volume);
    if (!oldAdpcm || oldAdpcm.left !== adpcm.left || oldAdpcm.right !== adpcm.right) chip.adpcm.setPan(adpcm.left,adpcm.right);
    if (replaceSample || !oldAdpcm || oldAdpcm.sampleRate !== adpcm.sampleRate || oldAdpcm.rootNote !== adpcm.rootNote) {
      const note = held.get('adpcm:0');
      if (note) adpcmPitch(note * 2 ** (pitch / 12),adpcm);
      else chip.adpcm.setPlaybackRate(adpcm.sampleRate);
    }
    preset = next; accepted = next;
    if (wasPlaying) chip.adpcm.keyOn({repeat:adpcm.repeat});
    return readPreset(preset);
  }

  function applyPreset(value) {
    const next = readPreset(value);
    sampleEpoch++;
    const task = queue.then(() => installPreset(next));
    queue = task.catch(() => {});
    return task;
  }
  async function noteOn(section,channel,note) {
    channelIndex(section,channel); const hz = noteToHz(note);
    const key = `${section}:${channel}`, epoch = gateEpoch, version = (gateVersions.get(key) ?? 0) + 1;
    gateVersions.set(key,version);
    if (stopping) await stopping;
    await queue; assertOpen();
    if (epoch !== gateEpoch || gateVersions.get(key) !== version) return false;
    held.set(key,hz);
    fade.open();
    if (section === 'rhythm') { chip.rhythm.keyOn(channel); return; }
    retune(section,channel,hz);
    if (section === 'fm') { chip.keyOff(channel); chip.keyOn(channel); }
    else if (section === 'ssg') {
      const value = preset.ssg.channels[channel];
      chip.ssg.setMixer(channel,value); chip.ssg.setVolume(channel,value.volume,value.envelope);
    } else chip.adpcm.keyOn({repeat:preset.adpcm.repeat});
  }
  function noteOff(section,channel) {
    channelIndex(section,channel); assertOpen();
    const key = `${section}:${channel}`;
    gateVersions.set(key,(gateVersions.get(key) ?? 0) + 1); held.delete(key);
    if (section === 'fm') chip.keyOff(channel);
    else if (section === 'ssg') chip.ssg.keyOff(channel);
    else if (section === 'rhythm') chip.rhythm.keyOff(channel);
    else chip.adpcm.keyOff();
  }
  function setPitch(value) {
    if (!Number.isFinite(value) || value < -2 || value > 2) throw new RangeError('Pitch bend must be −2 to +2 semitones');
    assertOpen(); pitch = value;
    for (const [key,hz] of held) {
      const [section,index] = key.split(':');
      if (section !== 'rhythm') retune(section,Number(index),hz);
    }
  }
  function stopAll() {
    if (disposed) return Promise.resolve();
    if (stopping) return stopping;
    sampleEpoch++; gateEpoch++;
    const task = (async () => {
      await fade.fadeOut();
      await queue;
      if (disposed) return;
      held.clear(); monitor.stopFm();
      for (let channel = 0; channel < 3; channel++) chip.ssg.keyOff(channel);
      chip.rhythm.keyOff([0,1,2,3,4,5]); chip.adpcm.keyOff();
      fade.open();
    })();
    const result = task.finally(() => { if (stopping === result) stopping = null; });
    stopping = result;
    return result;
  }
  async function loadAudio(source,{rootNote = preset.adpcm.rootNote,sampleRate,signal} = {}) {
    const token = ++sampleEpoch;
    const pcm = await readSamplePCM(source,{signal,decodeAudio:bytes => context.decodeAudioData(bytes.slice(0))});
    signal?.throwIfAborted(); if (token !== sampleEpoch) throw cancelled(); assertOpen();
    const requested = sampleRate ?? Math.min(pcm.sampleRate,Math.floor(chip.clock / 144));
    if (!Number.isFinite(requested) || requested <= 0) throw new RangeError('Invalid sample rate');
    const deltaN = Math.round(requested * 144 * 65536 / chip.clock);
    if (deltaN < 1 || deltaN > 65535) throw new RangeError('Sample rate exceeds YM2608 range');
    const actualRate = deltaN * chip.clock / (144 * 65536);
    const encoded = encodeAdpcmB(pcm,actualRate,MAX_ADPCM_BYTES);
    await queue;
    if (token !== sampleEpoch) throw cancelled();
    const next = readPreset(preset);
    next.adpcm = {...next.adpcm,data:encodeBase64(encoded.bytes),sampleRate:actualRate,rootNote};
    return applyPreset(next);
  }
  function setWave(samples,{rootNote = preset.adpcm.rootNote,sampleRate} = {}) {
    if (!samples || !Number.isSafeInteger(samples.length) || !samples.length) throw new TypeError('Wave requires normalized PCM samples');
    const rate = sampleRate ?? noteToHz(rootNote) * samples.length;
    return loadAudio({channels:[Float32Array.from(samples)],sampleRate:rate},{rootNote,sampleRate:Math.min(rate,Math.floor(chip.clock / 144))});
  }
  function setMasterVolume(value) { checkVolume(value); assertOpen(); outputNode.gain.value = value; }
  async function dispose() {
    if (closing) return closing;
    disposed = true; sampleEpoch++; gateEpoch++; held.clear(); fade.dispose();
    closing = (async () => {
      try { await runtime.close(); }
      finally {
        codeInputNode.disconnect(); codeFadeNode.disconnect(); outputNode.disconnect();
        if (context.state !== 'closed') await context.close();
      }
    })();
    return closing;
  }

  try {
    await bounded(runtime.start(),'OPNA audio initialization timed out');
    chip = runtime.fm; monitor = installMonitorMutes(chip);
    await applyPreset(preset);
    runtime.node?.addEventListener?.('processorerror',() => { report(new Error('OPNA audio processor failed. Enable audio to restart.')); void dispose(); });
    return {context,outputNode,codeInputNode,codeOutputNode:codeFadeNode,codeFadeNode,
      getChip() { assertOpen(); return chip; },getPreset:() => readPreset(preset),applyPreset,setMasterVolume,
      noteOn,noteOff,setPitch,stopAll,loadAudio,setWave,
      getRegisterState() { assertOpen(); return monitor.registers.map(registers => Array.from(registers)); },
      getFmState() { assertOpen(); return monitor.getFmState(); },
      setMute(section,channel,value) { assertOpen(); return monitor.setMute(section,channel,value); },
      getMuteState:() => monitor.getState(),dispose};
  } catch (error) { await dispose(); throw error; }
}
