// SPDX-License-Identifier: BSD-3-Clause
import { NeoGeoSynth, YM2610BRuntimeSynth } from '../js/ym2610bsynth.js';
import { createYm2612RegisterState } from '../synth/synth_song_state.js';

const workletUrl = new URL('../js/ym2610b-worklet.js', import.meta.url).href;
const wasmUrl = new URL('../generated/ym2610b_wasm.wasm', import.meta.url).href;

// Monitor the commands accepted by the shared Worklet transport. Observing at
// the transport includes raw writes and the high/low frequency write batches.
function observeFmWrites(transport, variant, clock) {
  const slots = variant === 'ym2610' ? [1, 2, 4, 5] : [0, 1, 2, 3, 4, 5];
  const shadow = createYm2612RegisterState(clock);
  const codeOwned = Array(6).fill(false), codeKeyOnOrder = Array(6).fill(0);
  let revision = 0, codeScope = false, keyOrder = 0, cached = null;

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
  }

  function observe(port, register, value) {
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
  resetShadow();

  return {
    getFmSnapshot() {
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
    },
    resetCodeFmActivity,
    withCodeFmWrites(action) {
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

  function close() {
    closeRevision++;
    if (closing) return closing;
    if (!session) return Promise.resolve();
    const { synth } = session;
    session = null;
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
    const current = { synth, variant, ready: null };
    session = current;
    current.ready = synth.start().then(() => {
      if (session !== current) throw new DOMException('YM2610 audio was closed.', 'AbortError');
      const context = synth.audioContext;
      const analyser = context.createAnalyser();
      synth.audio.connectOutputMonitor(analyser);
      const songOutput = context.createGain();
      songOutput.gain.value = muted ? 0 : 1;
      synth.audio.connectChipOutput(songOutput);
      current.songOutput = songOutput;
      const rawFm = synth.rawFm ?? synth.fm;
      const { ssg, adpcmA, adpcmB } = rawFm;
      return {
        fm: synth.fm, ssg, adpcmA, adpcmB, context, analyser,
        connectSongOutput: node => node.connect(songOutput),
        ...observeFmWrites(rawFm.transport, variant, rawFm.clock),
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
