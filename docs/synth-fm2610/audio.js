// SPDX-License-Identifier: BSD-3-Clause
import { NeoGeoSynth, YM2610BRuntimeSynth } from '../js/ym2610bsynth.js';

const workletUrl = new URL('../js/ym2610b-worklet.js', import.meta.url).href;
const wasmUrl = new URL('../generated/ym2610b_wasm.wasm', import.meta.url).href;

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
      const { ssg, adpcmA, adpcmB } = synth.rawFm ?? synth.fm;
      return { fm: synth.fm, ssg, adpcmA, adpcmB, context, analyser };
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
    },
    close,
  };
}
