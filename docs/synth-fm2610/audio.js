// SPDX-License-Identifier: BSD-3-Clause
import { NeoGeoSynth, YM2610BRuntimeSynth } from '../js/ym2610bsynth.js';
import { normalizeYm2610BSourceGains } from '../js/ym2610b.js?v=ym2610-source-mix-1';
import { attachYm2612TimedClient } from '../js/ym2612_timed_client.js?v=audio-stability-2';
import { ym2610Timing } from '../js/ym2610_timed.js';
import { createYm2612RegisterState } from '../synth/synth_song_state.js';
import { createFm2610CodeRoute } from './code_fx.js';
import { createFm2610SongAdpcmState, isFm2610SongAdpcmRegister } from './song_adpcm_state.js';
import { createFm2610SongSsgState, isFm2610SongSsgRegister } from './song_ssg_state.js';

const workletUrl = new URL('../js/ym2610b-worklet.js?v=opnb-timed-1', import.meta.url).href;
const wasmUrl = new URL('../generated/ym2610b_wasm.wasm?v=ym2610-source-mix-1', import.meta.url).href;

// Monitor the commands accepted by the shared Worklet transport. Observing at
// the transport includes raw writes and the high/low frequency write batches.
export function observeFm2610Writes(transport, variant, clock, context, rawFm) {
  const slots = variant === 'ym2610' ? [1, 2, 4, 5] : [0, 1, 2, 3, 4, 5];
  const shadow = createYm2612RegisterState(clock);
  const romShadow = createFm2610SongAdpcmState({clock, outputSampleRate: context.sampleRate});
  const adpcmRegisters = new Map();
  const ssgRegisters = new Map();
  const codeOwned = Array(6).fill(false), codeKeyOnOrder = Array(6).fill(0);
  let revision = 0, codeScope = false, keyOrder = 0, cached = null, recording = null;

  function invalidate() {
    revision++;
    cached = null;
  }

  function resetCodeFmActivity() {
    codeOwned.fill(false);
    codeKeyOnOrder.fill(0);
    invalidate();
  }

  function resetShadow() {
    shadow.reset();
    // OPNB reset enables both stereo outputs on every FM slot.
    for (let port = 0; port < 2; port++) {
      for (let channel = 0; channel < 3; channel++) shadow.write(port, 0xb4 + channel, 0xc0);
    }
    resetCodeFmActivity();
    if (recording && codeScope) {
      const { adpcm, ssg } = recording;
      adpcm.resetRegisters();
      ssg.reset();
    }
    adpcmRegisters.clear();
    ssgRegisters.clear();
  }

  function observe(port, register, value) {
    if (isFm2610SongAdpcmRegister(port, register)) {
      const triggerA = port === 1 && register === 0;
      if (!triggerA) adpcmRegisters.set((port << 8) | register, value);
      if (recording && codeScope) {
        const frame = triggerA ? Math.round((context.currentTime - recording.startTime) * context.sampleRate) : 0;
        recording.adpcm.write(port, register, value, frame);
        if (port === 1 || register === 0x1c) recording.sources.a = true;
        if (port === 0) recording.sources.b = true;
      }
    } else if (isFm2610SongSsgRegister(port, register)) {
      ssgRegisters.set(register, value);
      if (recording && codeScope) {
        recording.ssg.write(register, value);
        recording.ssgTouched = true;
      }
    }
    // OPNB does not route the OPN2 DAC register into the FM signal.
    if (port === 0 && register === 0x2b || !shadow.write(port, register, value)) return;
    if (port === 0 && register === 0x28 && (value & 3) !== 3) {
      const physical = (value & 3) + (value & 4 ? 3 : 0);
      codeOwned[physical] = codeScope && Boolean(value & 0xf0);
      if (codeOwned[physical]) codeKeyOnOrder[physical] = ++keyOrder;
    }
    invalidate();
  }

  const write = transport.write.bind(transport);
  transport.write = (port, register, value) => {
    write(port, register, value);
    observe(port, register, value);
  };
  if (typeof transport.writeBatch === 'function') {
    const writeBatch = transport.writeBatch.bind(transport);
    transport.writeBatch = commands => {
      writeBatch(commands);
      for (const { port, register, value } of commands) observe(port, register, value);
    };
  }
  const reset = transport.reset.bind(transport);
  transport.reset = () => {
    reset();
    resetShadow();
  };
  if (typeof transport.loadAdpcmMemory === 'function') {
    const loadMemory = transport.loadAdpcmMemory.bind(transport);
    transport.loadAdpcmMemory = (type, bytes, address = 0) => {
      const upload = loadMemory(type, bytes, address);
      if ((type === 0 || type === 1) && bytes instanceof Uint8Array &&
          Number.isInteger(address) && address >= 0 && bytes.length <= 0x1000000 - address) {
        const active = codeScope ? recording : null;
        // postMessage has already cloned the upload; keep matching bytes even
        // if user Code reuses its buffer before the Worklet acknowledges it.
        const data = new Uint8Array(bytes);
        Promise.resolve(upload).then(() => {
          romShadow.loadRom(type, data, address, 0x1000000);
          if (active && recording === active) active.sources[type === 0 ? 'a' : 'b'] = true;
        }, () => {});
      }
      return upload;
    };
  }
  resetShadow();

  function getFmSnapshot() {
    if (cached) return cached;
    const { clockHz, lfo, modeRegister, channels } = shadow.snapshot();
    const compact = slots.map((physicalChannel, channel) => {
      const state = channels[physicalChannel];
      const codeGate = codeOwned[physicalChannel] && state.gate;
      return Object.freeze({
        ...state, channel, physicalChannel, codeGate,
        codeKeyMask: codeGate ? state.keyMask : 0,
        codeKeyOnOrder: codeKeyOnOrder[physicalChannel],
        preset: Object.freeze({
          ...state.preset, keyMask: state.keyMask,
          operators: Object.freeze(Object.values(state.preset.operators)),
        }),
      });
    });
    cached = Object.freeze({ variant, revision, clockHz, lfo, modeRegister, channels: Object.freeze(compact) });
    return cached;
  }

  function syncFmControls() {
    if (!rawFm) return;
    const state = shadow.snapshot();
    rawFm._modeRegister = state.modeRegister & ~0x30;
    Object.assign(rawFm.lfo, state.lfo);
    state.channels.forEach(({preset, block, fnum, specialFrequencies}, channel) => {
      const controls = rawFm.channels[channel];
      const {algorithm, feedback, ams, pms, pan} = preset;
      Object.assign(controls, {algorithm, feedback, ams, pms, ...pan, block, fnum});
      Object.values(preset.operators).forEach((params, operator) => Object.assign(controls.operators[operator], params));
      controls.specialFrequencies = specialFrequencies.map(pitch => ({block:pitch.block, fnum:pitch.fnum}));
    });
  }

  function beginCodeObservation() {
    resetCodeFmActivity();
    const adpcm = romShadow.observeSharedRom();
    const ssg = createFm2610SongSsgState();
    for (const [address, value] of adpcmRegisters) {
      // ADPCM-B control issues a playback command rather than setting the
      // sample, so a previous source's active trigger is outside this run.
      if (address !== 0x10) adpcm.write(address >> 8, address & 255, value);
    }
    for (const [register, value] of ssgRegisters) ssg.write(register, value);
    const observation = {startTime: context.currentTime, adpcm, ssg, sources: {a: false, b: false}, ssgTouched: false};
    recording = observation;
    let previousFm, snapshot;
    function getSnapshot() {
      if (recording !== observation) return snapshot;
      const fm = getFmSnapshot();
      const adpcmState = adpcm.snapshot();
      const ssgState = observation.ssgTouched ? ssg.snapshot() : null;
      const {a, b} = observation.sources;
      if (!snapshot || previousFm !== fm || snapshot.adpcm !== adpcmState || snapshot.ssg !== ssgState ||
          snapshot.adpcmSources.a !== a || snapshot.adpcmSources.b !== b) {
        previousFm = fm;
        snapshot = Object.freeze({...fm, adpcm: adpcmState, ssg: ssgState, adpcmSources: Object.freeze({a, b})});
      }
      return snapshot;
    }
    return {
      getSnapshot,
      finish() {
        if (recording !== observation) return;
        getSnapshot();
        adpcm.freezeSharedRom();
        recording = null;
      },
      getAdpcmAWindow: adpcm.getAdpcmAWindow,
      readAdpcmABytes: adpcm.readAdpcmABytes,
      readAdpcmBBytes: adpcm.readAdpcmBBytes,
      retainAdpcmARom: adpcm.retainAdpcmARom,
    };
  }

  return {
    beginCodeObservation,
    applyManualFmWrites(writes) {
      transport.writeBatch(writes);
      syncFmControls();
    },
    receiveTimedWrites(writes) {
      if (!recording) return;
      const previous = codeScope;
      codeScope = true;
      try {
        for (const {port, register, value} of writes) observe(port, register, value);
        syncFmControls();
      } finally {
        codeScope = previous;
      }
    },
    withCodeWrites(action) {
      const previous = codeScope;
      codeScope = true;
      try { return action(); }
      finally { codeScope = previous; }
    },
  };
}

export function createFm2610Audio() {
  let session = null;
  let closing = null;
  let closeRevision = 0;
  let masterVolume = 0.7;
  let muted = false;
  let sourceGains = [1, 1, 1, 1];

  function close() {
    closeRevision++;
    if (closing) return closing;
    if (!session) return Promise.resolve();
    const { synth, timed, removeTimedListener, codeRoute } = session;
    session = null;
    removeTimedListener?.();
    timed?.dispose();
    codeRoute?.dispose();
    closing = synth.close().finally(() => { closing = null; });
    return closing;
  }

  async function start(variant) {
    if (variant !== 'ym2610' && variant !== 'ym2610b') throw new RangeError('Choose YM2610 or YM2610B.');
    if (closing) {
      const revision = closeRevision;
      await closing;
      if (revision !== closeRevision) throw new DOMException('YM2610 audio was closed.', 'AbortError');
    }
    if (session) {
      if (session.variant !== variant) throw new Error('Close the active YM2610 audio before switching chips.');
      const current = session;
      const result = await current.ready;
      if (session !== current) throw new DOMException('YM2610 audio was closed.', 'AbortError');
      await current.synth.resume();
      if (session !== current) throw new DOMException('YM2610 audio was closed.', 'AbortError');
      return result;
    }

    const Runtime = variant === 'ym2610' ? NeoGeoSynth : YM2610BRuntimeSynth;
    const synth = new Runtime({ workletUrl, wasmUrl, masterVolume });
    synth.mixer.set(variant, { muted });
    const current = { synth, variant, ready: null, timed: null, removeTimedListener: null };
    session = current;
    current.ready = synth.start().then(() => {
      if (session !== current) throw new DOMException('YM2610 audio was closed.', 'AbortError');
      synth.node.port.postMessage({type: 'source-gains', gains: sourceGains});
      const context = synth.audioContext;
      // Keep the audio effect before the chip mixer so Mute also silences its tails.
      const mixerInput = context.createGain();
      synth.mixerRelease();
      synth.mixerRelease = synth.mixer.connect(variant, variant, mixerInput, synth.audio.masterInputNode, context);
      const codeRoute = current.codeRoute = createFm2610CodeRoute(synth.node, mixerInput);
      const analyser = context.createAnalyser();
      synth.audio.connectOutputMonitor(analyser);
      const songOutput = context.createGain();
      songOutput.gain.value = muted ? 0 : 1;
      synth.audio.connectChipOutput(songOutput);
      current.songOutput = songOutput;
      const rawFm = synth.rawFm ?? synth.fm;
      const { ssg, adpcmA, adpcmB } = rawFm;
      const port = synth.node.port;
      const instanceId = globalThis.crypto.randomUUID();
      current.timed = attachYm2612TimedClient(synth.fm, {variant, instanceId}, port, ym2610Timing);
      const observation = observeFm2610Writes(rawFm.transport, variant, rawFm.clock, context, rawFm);
      let sequence = 0, activeObserver = null;
      const acceptTimed = ({data}) => {
        if (data?.type === 'opnb-timed-writes' && data.observerId === activeObserver) {
          observation.receiveTimedWrites(data.writes);
        }
      };
      port.addEventListener('message', acceptTimed);
      current.removeTimedListener = () => port.removeEventListener('message', acceptTimed);
      port.postMessage({type:'observe-timed-writes', enabled:false, instanceId});
      return {
        fm: synth.fm, ssg, adpcmA, adpcmB, context, analyser,
        setCodeEffect: codeRoute.setEffect,
        connectSongOutput: node => node.connect(songOutput),
        applyManualFmWrites: observation.applyManualFmWrites,
        withCodeWrites: observation.withCodeWrites,
        beginCodeObservation() {
          const codeObservation = observation.beginCodeObservation();
          const id = activeObserver = ++sequence;
          port.postMessage({type:'observe-timed-writes', enabled:true, observerId:id});
          return {...codeObservation, finish() {
            if (activeObserver === id) {
              activeObserver = null;
              port.postMessage({type:'observe-timed-writes', enabled:false});
            }
            codeObservation.finish();
          }};
        },
      };
    }).catch(async error => {
      if (session === current) await close().catch(() => {});
      throw error;
    });
    return current.ready;
  }

  return {
    start,
    setMasterVolume(value) {
      if (!Number.isFinite(value) || value < 0 || value > 3.8) throw new RangeError('Master volume must be from 0 to 3.8.');
      masterVolume = value;
      session?.synth.setMasterVolume(value);
    },
    setSourceGains(gains) {
      sourceGains = normalizeYm2610BSourceGains(gains);
      session?.synth.node?.port.postMessage({type: 'source-gains', gains: sourceGains});
    },
    setMuted(source, value) {
      if (source !== 'chip' || typeof value !== 'boolean') throw new TypeError('Choose the chip output and a boolean mute state.');
      muted = value;
      if (session) session.synth.mixer.set(session.variant, { muted });
      const output = session?.songOutput;
      if (output) output.gain.setTargetAtTime(muted ? 0 : 1, output.context.currentTime, 0.005);
    },
    close,
  };
}
