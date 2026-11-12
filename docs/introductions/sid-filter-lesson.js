// SPDX-License-Identifier: BSD-3-Clause
// The lesson uses one original Saw patch, not music or data from a game.
export const SID_FILTER_DEFAULTS = Object.freeze({
  mode: 'bypass', cutoff: 500, resonance: 5, routing: 7, chord: false,
});
export const SID_FILTER_NOTES = Object.freeze(['C3', 'E3', 'G3']);
export const SID_FILTER_VOICE = Object.freeze({
  waveform: 'saw', pulseWidth: 2048, attack: 2, decay: 6, sustain: 9,
  release: 4, sync: false, ring: false, test: false,
});
// A fixed host level for this comparison. It never normalizes individual modes
// or changes the SID model's gain. The hardware master is separately set to 8.
export const SID_FILTER_OUTPUT_GAIN = 0.35;

/** @param {{mode?:string,cutoff?:number,resonance?:number,routing?:number,chord?:boolean}} [value] */
export function readSidFilterSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected SID lesson settings');
  for (const key of Object.keys(value)) if (!Object.hasOwn(SID_FILTER_DEFAULTS, key)) throw new TypeError(`Unknown SID lesson setting: ${key}`);
  const next = {...SID_FILTER_DEFAULTS, ...value};
  if (!['bypass', 'lowpass', 'bandpass', 'highpass'].includes(next.mode)) throw new RangeError('Expected bypass, lowpass, bandpass or highpass');
  for (const [key, max] of [['cutoff', 2047], ['resonance', 15], ['routing', 7]]) {
    if (!Number.isInteger(next[key]) || next[key] < 0 || next[key] > max) throw new RangeError(`${key} must be an integer 0..${max}`);
  }
  if (typeof next.chord !== 'boolean') throw new TypeError('chord must be boolean');
  return next;
}

/** Bypass is a UI convenience: off + routing 0. Off + routed voices would
 * silence those voices on SID. Unchecked voices always retain their dry path. */
export function sidFilterConfiguration(value) {
  const settings = readSidFilterSettings(value);
  return {mode: settings.mode === 'bypass' ? 'off' : settings.mode,
    cutoff: settings.cutoff, resonance: settings.resonance,
    routing: settings.mode === 'bypass' ? 0 : settings.routing,
    volume: 8, voice3off: false};
}

/** Configure every inherited voice/filter field before the first Gate edge.
 * Await setters so the same recipe also works with asynchronous clients. */
export async function initializeSidFilterLesson(sid, value) {
  const settings = readSidFilterSettings(value);
  await sid.initialize();
  for (let channel = 0; channel < 3; channel++) {
    await sid.setVoice(channel, {...SID_FILTER_VOICE});
    await sid.setNote(channel, SID_FILTER_NOTES[channel]);
  }
  await applySidFilterLesson(sid, settings);
  await sid.keyOn(0);
  if (settings.chord) await setSidFilterChord(sid, true);
  return settings;
}

/** Live filter edits deliberately never write a voice register or Gate. */
export async function applySidFilterLesson(sid, value) {
  const filter = sidFilterConfiguration(value);
  await sid.setFilter(filter);
  return filter;
}

/** Only the optional extra voices change Gate; CH1 keeps its held C3. */
export async function setSidFilterChord(sid, enabled) {
  if (typeof enabled !== 'boolean') throw new TypeError('chord must be boolean');
  for (const channel of [1, 2]) {
    if (enabled) await sid.keyOn(channel);
    else await sid.keyOff(channel);
  }
}

/** Transport Stop, after the UI's short host fade: discard oscillator/filter
 * and DC-blocker tails. Ordinary musical noteOff would instead release Gate. */
export async function stopSidFilterLesson(sid) {
  await sid.allNotesOff();
  await sid.reset();
}

/** Readable, standalone Playground source. The page and copied source share
 * settings and the exact original patch, without executing edited page text. */
export function sidFilterLessonCode(value) {
  const settings = readSidFilterSettings(value), filter = sidFilterConfiguration(settings);
  return `const sid = await useSoundChip('sid');
try {
  await sid.initialize();
  const notes = ['C3', 'E3', 'G3'];
  for (let ch = 0; ch < 3; ch++) {
    await sid.setVoice(ch, {
      waveform: 'saw', pulseWidth: 2048,
      attack: 2, decay: 6, sustain: 9, release: 4,
      sync: false, ring: false, test: false,
    });
    await sid.setNote(ch, notes[ch]);
  }

  // One shared hardware filter. Unrouted voices remain dry.
  // Bypass uses mode 'off' AND routing 0 to keep the voices audible.
  await sid.setFilter({
    mode: '${filter.mode}', cutoff: ${filter.cutoff}, resonance: ${filter.resonance},
    routing: ${filter.routing}, volume: 8, voice3off: false,
  });
  for (const ch of ${settings.chord ? '[0, 1, 2]' : '[0]'}) await sid.keyOn(ch);

  // JavaScript waiting controls the performance; the SID clock runs in audio.
  await sleep(4);
  await sid.allNotesOff();
  await sleep(0.4);
} finally {
  sid.dispose();
}`;
}
