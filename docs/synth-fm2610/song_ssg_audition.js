// SPDX-License-Identifier: BSD-3-Clause
import {noteToHz} from '../js/soundchip_pitch.js';
import {createFm2610SongAuditionChip} from './song_audition.js';

export function createFm2610SongSsgAudition() {
  const chip = createFm2610SongAuditionChip();
  const notes = Array(3).fill(null);
  let configured;

  function stop(channel) {
    const note = notes[channel];
    notes[channel] = null;
    note?.ssg?.keyOff(channel);
  }

  async function audition(endpoint, snapshot, channel, midi) {
    const state = snapshot.ssg;
    const voice = state?.channels[channel];
    if (!voice || !(voice.tone || voice.noise) || !(voice.level || voice.envelope)) return false;
    stop(channel);
    const note = {};
    notes[channel] = note;
    try {
      const runtime = await chip.load(endpoint, snapshot);
      if (notes[channel] !== note) return false;
      const {ssg} = runtime.rawFm ?? runtime.fm;
      if (configured?.runtime !== runtime || configured.snapshot !== snapshot) {
        ssg.write(6, state.noisePeriod);
        ssg.setEnvelope({period: state.envelopePeriod, shape: state.envelopeShape});
        configured = {runtime, snapshot};
      }
      const period = Math.round(snapshot.clockHz / (64 * noteToHz(midi)));
      ssg.setTonePeriod(channel, Math.max(1, Math.min(4095, period)));
      ssg.setMixer(channel, {tone: voice.tone, noise: voice.noise});
      ssg.setVolume(channel, voice.level, voice.envelope);
      note.ssg = ssg;
      return true;
    } catch (error) {
      if (notes[channel] !== note) return false;
      notes[channel] = null;
      if (error?.name === 'AbortError') return false;
      throw error;
    }
  }

  function close() {
    notes.fill(null);
    configured = undefined;
    return chip.close();
  }

  return {audition, stop, close, setSourceGains: chip.setSourceGains};
}
