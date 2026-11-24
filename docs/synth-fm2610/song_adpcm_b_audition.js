// SPDX-License-Identifier: BSD-3-Clause
import {createFm2610SongAuditionChip} from './song_audition.js';

const MAX_ROM_BYTES = 0x1000000;
const adpcmBFor = runtime => (runtime.rawFm ?? runtime.fm).adpcmB;

/** Audition the selected paused VGM sample on a chip separate from the song and author instrument. */
export function createFm2610SongAdpcmBAudition({chip = createFm2610SongAuditionChip()} = {}) {
  let request = null;

  function stop() {
    const runtime = request?.runtime;
    request = null;
    if (runtime && runtime === chip.current()) adpcmBFor(runtime).keyOff();
  }

  async function audition(endpoint, snapshot, bytes, {deltaN = snapshot?.adpcm?.adpcmB?.deltaN} = {}) {
    const sample = snapshot?.adpcm?.adpcmB;
    if (!sample?.available || !(bytes instanceof Uint8Array) || bytes.length !== sample.end - sample.start ||
        !bytes.length || bytes.length % 256 || bytes.length > MAX_ROM_BYTES) {
      throw new RangeError('The paused VGM does not contain a complete ADPCM-B sample.');
    }
    if (!Number.isInteger(deltaN) || deltaN < 1 || deltaN > 65535) {
      throw new RangeError('The paused ADPCM-B sample needs a positive Delta-N to play.');
    }

    stop();
    const current = {runtime: null};
    request = current;
    try {
      const runtime = await chip.load(endpoint, snapshot);
      if (request !== current) return false;
      current.runtime = runtime;
      const adpcmB = adpcmBFor(runtime);
      // This isolated ROM can fit the entire recorded address window at zero.
      await adpcmB.loadMemory(bytes, 0);
      if (request !== current || runtime !== chip.current()) return false;

      adpcmB.setSample({start: 0, end: bytes.length});
      adpcmB.setDeltaN(deltaN);
      adpcmB.setVolume(sample.volume);
      adpcmB.setPan(sample.left, sample.right);
      adpcmB.keyOn({repeat: sample.repeat});
      return true;
    } catch (error) {
      if (request !== current) return false;
      request = null;
      if (error?.name === 'AbortError') return false;
      throw error;
    }
  }

  function close() {
    request = null;
    return chip.close();
  }

  return {audition, stop, close, setSourceGains: chip.setSourceGains};
}
