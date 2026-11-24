// SPDX-License-Identifier: BSD-3-Clause
import { attachChipClock } from '../js/playground_chip_clock.js';
import { midiToOpnPitch } from '../js/soundchip_pitch.js';
import { NeoGeoSynth, YM2610BRuntimeSynth } from '../js/ym2610bsynth.js';
import { normalizeYm2610BSourceGains } from '../js/ym2610b.js?v=ym2610-source-mix-1';
import { setSynthSongVoiceFrequency } from '../synth/synth_song_voice.js';

const workletUrl = new URL('../js/ym2610b-worklet.js?v=ym2610-source-mix-1', import.meta.url).href;
const wasmUrl = new URL('../generated/ym2610b_wasm.wasm?v=ym2610-source-mix-1', import.meta.url).href;

/** An isolated chip connected to the reference output bus. */
export function createFm2610SongAuditionChip() {
  let session;
  let sourceGains = [1, 1, 1, 1];

  function close() {
    if (!session) return;
    const current = session;
    session = null;
    current.output.disconnect();
    current.clock?.dispose();
    return current.runtime.close();
  }

  async function load({context, connectSongOutput}, {variant, clockHz}) {
    if (session?.context !== context || session.variant !== variant || session.clockHz !== clockHz) {
      void close()?.catch(() => {});
      const output = context.createGain();
      connectSongOutput(output);
      const Runtime = variant === 'ym2610' ? NeoGeoSynth : YM2610BRuntimeSynth;
      const runtime = new Runtime({audioContext: context, outputNode: output, workletUrl, wasmUrl});
      const current = {runtime, context, variant, clockHz, output};
      session = current;
      current.ready = runtime.start().then(async () => {
        if (session !== current) throw new DOMException('Reference audition stopped.', 'AbortError');
        runtime.node.port.postMessage({type: 'source-gains', gains: sourceGains});
        if (clockHz !== runtime.fm.clock) {
          current.clock = attachChipClock({dispose() {}}, runtime.node.port, runtime.fm.clock, {primary: true});
          await current.clock.setClock(clockHz);
          runtime.fm.clock = clockHz;
        }
        return runtime;
      }).catch(async error => {
        if (session === current) await close();
        else throw new DOMException('Reference audition stopped.', 'AbortError');
        throw error;
      });
    }
    const current = session;
    const runtime = await current.ready;
    if (session !== current) throw new DOMException('Reference audition stopped.', 'AbortError');
    return runtime;
  }

  function setSourceGains(gains) {
    sourceGains = normalizeYm2610BSourceGains(gains);
    session?.runtime.node?.port.postMessage({type: 'source-gains', gains: sourceGains});
  }

  return {load, close, setSourceGains, current: () => session?.runtime};
}

/** A keyboard chip with the reference clock and its own registers and gates. */
export function createFm2610SongAudition() {
  const {load, close, setSourceGains} = createFm2610SongAuditionChip();

  async function prepare(endpoint, snapshot, voice, preset) {
    const {fm} = await load(endpoint, snapshot);
    const channel = snapshot.channels.indexOf(voice);
    return {
      play(midi) {
        const {block, fnum} = midiToOpnPitch(midi, snapshot.clockHz);
        fm.keyOff(channel);
        fm.setPreset(channel, preset);
        fm.setLfo(snapshot.lfo.enabled, snapshot.lfo.frequency);
        fm.setChannel3SpecialMode(voice.specialMode);
        setSynthSongVoiceFrequency(fm, channel, block, fnum, preset.specialFrequencies);
        fm.keyOn(channel, [0, 1, 2, 3].filter(operator => preset.keyMask & (1 << operator)));
      },
      stop() { fm.keyOff(channel); },
    };
  }

  return {prepare, close, setSourceGains};
}
