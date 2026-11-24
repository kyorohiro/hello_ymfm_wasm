// SPDX-License-Identifier: BSD-3-Clause
import {createFm2610SongAuditionChip} from './song_audition.js';
import {normalizeFm2610AdpcmAWindow} from './song_adpcm_state.js';

const CHANNEL_COUNT = 6;
const SLOT_BYTES = 0x100000;
const adpcmAFor = runtime => (runtime.rawFm ?? runtime.fm).adpcmA;
const validChannel = channel => Number.isInteger(channel) && channel >= 0 && channel < CHANNEL_COUNT;

function level(value, max) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError('ADPCM-A level must be 0–' + max + '.');
  }
  return value;
}

function voiceSettings(voice, changes) {
  const {volume = voice.volume, left = voice.left, right = voice.right} = changes;
  if (typeof left !== 'boolean' || typeof right !== 'boolean') {
    throw new TypeError('ADPCM-A pan requires left and right switches.');
  }
  return {volume: level(volume, 31), left, right};
}

/** Play paused VGM samples on independent voices without editing the song or the author kit. */
export function createFm2610SongAdpcmAAudition({chip = createFm2610SongAuditionChip()} = {}) {
  const requests = Array(CHANNEL_COUNT).fill(null);
  let totalVolume = 0;

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

  function setVoice(channel, changes) {
    const request = validChannel(channel) ? requests[channel] : null;
    if (!request) return;
    request.voice = voiceSettings(request.voice, changes);
    if (request.started && request.runtime === chip.current()) {
      adpcmAFor(request.runtime).setVoice(channel, request.voice);
    }
  }

  function setVolume(volume) {
    const next = level(volume, 63);
    if (next === totalVolume) return;
    totalVolume = next;
    const runtime = chip.current();
    if (runtime && requests.some(request => request?.started && request.runtime === runtime)) {
      adpcmAFor(runtime).setVolume(totalVolume);
    }
  }

  async function audition(endpoint, snapshot, channel, bytes, overrides = {}) {
    if (!validChannel(channel)) {
      throw new RangeError('Choose ADPCM-A voice A1–A6.');
    }
    const state = snapshot?.adpcm?.adpcmA;
    const voice = state?.voices?.[channel];
    const {start: windowStart = voice?.start, end: windowEnd = voice?.end ?? voice?.playbackEnd,
      totalVolume: requestedVolume = state?.volume} = overrides;
    const customWindow = overrides.start !== undefined || overrides.end !== undefined;
    const window = customWindow && voice ? normalizeFm2610AdpcmAWindow({
      start: windowStart, end: windowEnd,
    }) : voice;
    if (!window || (customWindow ? !window.rangeValid : !voice.available) ||
        !(bytes instanceof Uint8Array) || bytes.length !== window.playbackEnd - window.start ||
        !bytes.length || bytes.length % 256 || bytes.length >= SLOT_BYTES) {
      throw new RangeError('The paused VGM does not contain a complete sample for this voice.');
    }

    const settings = voiceSettings(voice, overrides);
    level(requestedVolume, 63);
    stop(channel);
    const request = {runtime: null, voice: settings, started: false};
    requests[channel] = request;
    try {
      setVolume(requestedVolume);
      const runtime = await chip.load(endpoint, snapshot);
      if (requests[channel] !== request) return false;
      request.runtime = runtime;
      const adpcmA = adpcmAFor(runtime);
      const start = channel * SLOT_BYTES;
      await adpcmA.loadMemory(bytes, start);
      if (requests[channel] !== request || runtime !== chip.current()) return false;

      adpcmA.setVolume(totalVolume);
      adpcmA.setSample(channel, {start, end: start + bytes.length});
      adpcmA.setVoice(channel, request.voice);
      adpcmA.keyOn(channel);
      request.started = true;
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

  return {audition, stop, close, setVoice, setVolume, setSourceGains: chip.setSourceGains};
}
