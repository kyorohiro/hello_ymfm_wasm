import {validateChipClock} from './playground_chip_clock.js?v=pokey-prepare-1';

export const WONDERSWAN_TIMELINE_MAX_BYTES = 8 * 1024 * 1024;
export const WONDERSWAN_TIMELINE_MAX_WRITES_PER_QUANTUM = 512;
const integer = (value, maximum, label) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError(`WonderSwan timeline ${label} is out of range`);
  return value;
};
const fail = message => { throw new Error(`WonderSwan timeline: ${message}`); };

// This decoder is shared by preflight and the compact playback cursor. A run
// owns its packed byte range; no array of expanded PCM events is constructed.
function readPoint(data, state) {
  let delta = 0, multiplier = 1, byte;
  for (let index = 0; index < 5; index++) {
    if (state.position >= state.end) fail('truncated PCM delta');
    byte = data[state.position++];
    if (index === 4 && byte > 15) fail('PCM delta exceeds unsigned 32-bit range');
    delta += (byte & 127) * multiplier;
    if (!(byte & 128)) {
      if (index && !(byte & 127)) fail('noncanonical PCM delta');
      break;
    }
    multiplier *= 128;
  }
  if (byte & 128 || state.position >= state.end) fail('truncated PCM byte');
  state.sample += delta;
  state.value = data[state.position++];
  state.remaining--;
  return delta;
}

/** Validate and own an exact, one-pass WonderSwan register/RAM/Voice PCM trace.
 * Authored times are unsigned 44100-Hz sample positions, independent of clock.
 * @param {any} trace
 * @param {{sampleRate?:number}} [options] Actual output rate enables callback density validation.
 */
export function prepareWonderSwanTimeline(trace, {sampleRate} = {}) {
  if (!trace || typeof trace !== 'object' || Array.isArray(trace) || trace.version !== 1) fail('expected version 1');
  const clock = validateChipClock(trace.clock);
  const durationSamples = integer(trace.durationSamples, 0xffffffff, 'duration');
  if (!Array.isArray(trace.events) || !(trace.pcmData instanceof Uint8Array)) fail('expected events and Uint8Array PCM data');
  if (trace.events.length * 32 + trace.pcmData.byteLength > WONDERSWAN_TIMELINE_MAX_BYTES) fail('data exceeds the 8 MiB limit');
  if (sampleRate !== undefined && (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000)) fail('invalid output sample rate');
  // Copy all caller-owned storage before inspecting its content. Failed
  // preparation cannot mutate an existing playable trace or retain a view.
  const pcmData = new Uint8Array(trace.pcmData), events = trace.events.map(event => {
    if (!Array.isArray(event) || (event.length !== 4 && event.length !== 6)) fail('event must have four or six fields');
    return Array.from(event);
  });
  let previous = 0, control = 0, sameSample = -1, sameCount = 0, writeCount = 0, workBytes = events.length * 32;
  const writeWindow = sampleRate === undefined ? null : new Float64Array(WONDERSWAN_TIMELINE_MAX_WRITES_PER_QUANTUM);
  const countWrite = sample => {
    if (sample !== sameSample) { sameSample = sample; sameCount = 0; }
    if (++sameCount > WONDERSWAN_TIMELINE_MAX_WRITES_PER_QUANTUM) fail('too many writes at one sample');
    if (sampleRate !== undefined) {
      const frame = Math.ceil(sample * sampleRate / 44100), slot = writeCount % WONDERSWAN_TIMELINE_MAX_WRITES_PER_QUANTUM;
      // A start reservation may land anywhere in the device's quantum. Bound
      // every rolling 128-frame interval, including a nominal bucket boundary.
      if (writeCount >= WONDERSWAN_TIMELINE_MAX_WRITES_PER_QUANTUM && frame - writeWindow[slot] < 128) fail('too many writes in one output quantum');
      writeWindow[slot] = frame; writeCount++;
    }
  };
  for (let index = 0; index < events.length; index++) {
    const event = events[index], [sample, kind, address, value] = event;
    integer(sample, durationSamples, 'event sample');
    if (sample < previous) fail('events overlap or are out of order');
    if (kind === 0 || kind === 1) {
      if (event.length !== 4) fail('register/RAM event must have four fields');
      integer(address, kind === 0 ? 0x9f : 0x3fff, 'address');
      if (kind === 0 && address < 0x80) fail('register must be 0x80..0x9f');
      integer(value, 255, 'byte');
      countWrite(sample);
      if (kind === 0 && address === 0x90) control = value;
      previous = sample;
    } else if (kind === 2) {
      if (event.length !== 6) fail('PCM event must have six fields');
      if (!(control & 32)) fail('PCM run requires Voice PCM mode');
      const offset = integer(address, pcmData.length, 'PCM offset'), length = integer(value, pcmData.length, 'PCM length');
      const count = integer(event[4], 0xffffffff, 'PCM count'), endSample = integer(event[5], durationSamples, 'PCM end sample');
      if (!count || length < count * 2 || offset + length > pcmData.length || endSample < sample) fail('invalid PCM run bounds');
      workBytes += length;
      if (workBytes > WONDERSWAN_TIMELINE_MAX_BYTES) fail('referenced PCM playback work exceeds the 8 MiB limit');
      const state = {position:offset, end:offset + length, remaining:count, sample};
      for (let point = 0; point < count; point++) {
        const delta = readPoint(pcmData, state);
        if (!point && delta) fail('first PCM delta must be zero');
        if (state.sample > endSample) fail('PCM delta exceeds run end');
        countWrite(state.sample);
      }
      if (state.position !== state.end || state.sample !== endSample) fail('PCM byte count or end sample mismatch');
      previous = endSample;
    } else fail('unknown event kind');
  }
  return {version:1, clock, durationSamples, events, pcmData};
}

/** Compact, allocation-free playback traversal of an already prepared trace.
 * advance() applies every write due at the requested output frame in source
 * order; values at a fractional boundary take effect on the following frame.
 */
export function createWonderSwanTimelineCursor(prepared, sampleRate) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) fail('invalid output sample rate');
  const {events, pcmData} = prepared, frameAt = sample => Math.ceil(sample * sampleRate / 44100);
  let index = 0, next = Infinity, run = null;
  function select() {
    const event = events[index];
    if (!event) { next = Infinity; return; }
    if (event[1] !== 2) { run = null; next = frameAt(event[0]); return; }
    run = {position:event[2], end:event[2] + event[3], remaining:event[4], sample:event[0]};
    readPoint(pcmData, run); next = frameAt(run.sample);
  }
  select();
  return {
    durationFrames:frameAt(prepared.durationSamples),
    nextFrame:() => next,
    advance(frame, apply) {
      while (next <= frame) {
        if (run) {
          apply(0, 0x89, run.value);
          if (run.remaining) { readPoint(pcmData, run); next = frameAt(run.sample); continue; }
        } else { const event = events[index]; apply(event[1], event[2], event[3]); }
        index++; select();
      }
    },
  };
}
