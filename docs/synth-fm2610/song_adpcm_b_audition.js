// SPDX-License-Identifier: BSD-3-Clause
import {createFm2610SongAuditionChip} from './song_audition.js';

const MAX_ROM_BYTES = 0x1000000;
const adpcmBFor = runtime => (runtime.rawFm ?? runtime.fm).adpcmB;

/** Audition the selected paused VGM sample on a chip separate from the song and author instrument. */
export function createFm2610SongAdpcmBAudition({chip = createFm2610SongAuditionChip()} = {}) {
  let request = null;
  let bank = null;

  function stop() {
    const runtime = request?.runtime;
    request = null;
    if (runtime && runtime === chip.current()) adpcmBFor(runtime).keyOff();
  }

  function validateRate(deltaN) {
    if (!Number.isInteger(deltaN) || deltaN < 1 || deltaN > 65535) {
      throw new RangeError('The paused ADPCM-B sample needs a positive Delta-N to play.');
    }
  }

  function setDeltaN(deltaN) {
    validateRate(deltaN);
    if (!request) return;
    request.deltaN = deltaN;
    if (request.runtime && request.runtime === chip.current()) adpcmBFor(request.runtime).setDeltaN(deltaN);
  }

  function prepare(endpoint, snapshot, source) {
    const sample = snapshot?.adpcm?.adpcmB;
    const size = sample ? sample.end - sample.start : 0;
    const missingSample = () => new RangeError('The paused VGM does not contain a complete ADPCM-B sample.');
    if (!sample?.available || !Number.isInteger(size) || size < 256 || size % 256 || size > MAX_ROM_BYTES) throw missingSample();
    const deferred = typeof source === 'function';
    function validateBytes(bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.length !== size) throw missingSample();
    }
    if (!deferred) validateBytes(source);

    const rom = sample.rom ?? snapshot;
    if (bank?.endpoint === endpoint && bank.rom === rom && bank.start === sample.start && bank.end === sample.end &&
        bank.variant === snapshot.variant && bank.clockHz === snapshot.clockHz) {
      return bank.ready;
    }

    const {variant, clockHz} = snapshot;
    const current = {endpoint, rom, variant, clockHz, start: sample.start, end: sample.end, ready: null};
    bank = current;
    current.ready = chip.load(endpoint, snapshot).then(async runtime => {
      if (bank !== current || runtime !== chip.current()) return null;
      const bytes = deferred ? source() : source;
      if (deferred && bytes === null) {
        bank = null;
        return null;
      }
      validateBytes(bytes);
      // The isolated ROM has room for the recorded address window at zero.
      await adpcmBFor(runtime).loadMemory(bytes, 0);
      return bank === current && runtime === chip.current() ? {runtime, size} : null;
    }).catch(error => {
      if (bank === current) bank = null;
      throw error;
    });
    return current.ready;
  }

  async function audition(endpoint, snapshot, source, {deltaN = snapshot?.adpcm?.adpcmB?.deltaN} = {}) {
    validateRate(deltaN);

    stop();
    const current = {runtime: null, deltaN};
    request = current;
    try {
      const ready = await prepare(endpoint, snapshot, source);
      if (request !== current) return false;
      if (!ready) {
        request = null;
        return false;
      }
      const {runtime, size} = ready;
      current.runtime = runtime;
      const adpcmB = adpcmBFor(runtime);
      const sample = snapshot.adpcm.adpcmB;
      adpcmB.setSample({start: 0, end: size});
      adpcmB.setDeltaN(current.deltaN);
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
    bank = null;
    return chip.close();
  }

  return {prepare, audition, setDeltaN, stop, close, setSourceGains: chip.setSourceGains};
}
