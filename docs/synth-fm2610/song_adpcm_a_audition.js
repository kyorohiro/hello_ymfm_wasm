// SPDX-License-Identifier: BSD-3-Clause
import {createFm2610SongAuditionChip} from './song_audition.js';

const CHANNEL_COUNT = 6;
const SLOT_BYTES = 0x100000;
const adpcmAFor = runtime => (runtime.rawFm ?? runtime.fm).adpcmA;
const validChannel = channel => Number.isInteger(channel) && channel >= 0 && channel < CHANNEL_COUNT;

/** Play paused VGM samples on independent voices without editing the song or the author kit. */
export function createFm2610SongAdpcmAAudition({chip = createFm2610SongAuditionChip()} = {}) {
  const requests = Array(CHANNEL_COUNT).fill(null);

  function stop(channel) {
    if (channel === undefined) {
      for (let index = 0; index < CHANNEL_COUNT; index++) stop(index);
      return;
    }
    if (!validChannel(channel)) return;
    const current = requests[channel];
    requests[channel] = null;
    if (current?.runtime && current.runtime === chip.current()) adpcmAFor(current.runtime).keyOff(channel);
  }

  async function audition(endpoint, snapshot, channel, bytes) {
    if (!validChannel(channel)) {
      throw new RangeError('Choose ADPCM-A voice A1–A6.');
    }
    const state = snapshot?.adpcm?.adpcmA;
    const voice = state?.voices?.[channel];
    if (!voice?.available || !(bytes instanceof Uint8Array) || bytes.length !== voice.playbackEnd - voice.start ||
        !bytes.length || bytes.length % 256 || bytes.length >= SLOT_BYTES) {
      throw new RangeError('The paused VGM does not contain a complete sample for this voice.');
    }

    stop(channel);
    const request = {runtime: null};
    requests[channel] = request;
    try {
      const runtime = await chip.load(endpoint, snapshot);
      if (requests[channel] !== request) return false;
      request.runtime = runtime;
      const adpcmA = adpcmAFor(runtime);
      const start = channel * SLOT_BYTES;
      await adpcmA.loadMemory(bytes, start);
      if (requests[channel] !== request || runtime !== chip.current()) return false;

      adpcmA.setVolume(state.volume);
      adpcmA.setSample(channel, {start, end: start + bytes.length});
      adpcmA.setVoice(channel, {volume: voice.volume, left: voice.left, right: voice.right});
      adpcmA.keyOn(channel);
      return true;
    } catch (error) {
      if (requests[channel] !== request) return false;
      requests[channel] = null;
      if (error?.name === 'AbortError') return false;
      throw error;
    }
  }

  function close() {
    requests.fill(null);
    return chip.close();
  }

  return {audition, stop, close, setSourceGains: chip.setSourceGains};
}
