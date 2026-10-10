import {GameboyApu} from '../js/gameboyapu.js';
import {GameboySynth, GameboyDirectTransport} from '../js/gameboysynth.js';
import moduleFactory from '../generated/gameboy_apu_wasm.js';
import {lessonText} from './introduction-locale.js';

export const ENVELOPE_DEFAULTS = Object.freeze({volume: 12, direction: 'down', period: 2});
export const WAVE_DEFAULTS = Object.freeze({note: 'A3', level: 0.5});
export const LESSON_SECONDS = {envelope: 2, wave: 1.5};
export function wavePreset(name) {
  if (name === 'triangle') return Array.from({length: 32}, (_, i) => i < 16 ? i : 31 - i);
  if (name === 'saw') return Array.from({length: 32}, (_, i) => i >> 1);
  if (name === 'pulse') return Array.from({length: 32}, (_, i) => i < 16 ? 15 : 0);
  if (name === 'double') return Array.from({length: 32}, (_, i) => i % 16 < 8 ? (i % 16) * 2 : (15 - i % 16) * 2);
  throw new RangeError('Unknown waveform');
}
export function validateSamples(samples) {
  if (!Array.isArray(samples) || samples.length !== 32 ||
      !Array.from(samples).every(value => Number.isInteger(value) && value >= 0 && value <= 15)) {
    throw new RangeError(lessonText('32点すべてを、0〜15の整数にしてください。', 'Use exactly 32 integers from 0 to 15.'));
  }
  return samples.slice();
}
export function parseWave(text) {
  if (typeof text !== 'string' || text.length > 2048) throw new RangeError(lessonText('波形配列が長すぎます。', 'The waveform array is too long.'));
  return validateSamples(JSON.parse(text));
}
export function validateLesson(kind, s) {
  if (kind === 'envelope') {
    if (!Number.isInteger(s.volume) || s.volume < 0 || s.volume > 15 ||
        !['up', 'down'].includes(s.direction) || !Number.isInteger(s.period) || s.period < 0 || s.period > 7)
      throw new RangeError('Invalid envelope');
  } else if (kind === 'wave') {
    validateSamples(s.samples);
    if (!['A3', 'C4', 'A4'].includes(s.note) || ![0, 0.25, 0.5, 1].includes(s.level)) throw new RangeError('Invalid wave settings');
  } else throw new RangeError('Unknown lesson');
}
export function lessonCode(kind, s) {
  validateLesson(kind, s);
  const setup = kind === 'envelope' ? `gb.pulse.setVoice(0, {duty: 0.5, volume: ${s.volume},
    envelope: {direction: '${s.direction}', period: ${s.period}}});
  gb.pulse.setNote(0, 'A4');
  gb.pulse.keyOn(0);` : `const samples = ${JSON.stringify(s.samples)};
  // ${lessonText('転送前にWaveのDACを停止する。発音はkeyOnから。', 'Stop the Wave DAC before transfer. keyOn starts playback.')}
  gb.wave.stopAndSetWaveform(samples);
  gb.wave.setLevel(${s.level});
  gb.wave.setNote('${s.note}');
  gb.wave.keyOn();`;
  const off = kind === 'envelope' ? 'gb.pulse.keyOff(0);' : 'gb.wave.keyOff();';
  return `const gb = await useSoundChip('gameboy');
try {
  gb.initialize();
  gb.setMasterVolume(3, 3);
  ${setup}
  // ${lessonText('JavaScript側の発音時間。', 'Note duration is controlled by JavaScript. ')}${kind === 'envelope' ? lessonText('EnvelopeはAPU自身が進める。', 'The APU advances the envelope itself.') : lessonText('波形はAPU自身が繰り返し読む。', 'The APU repeats the waveform itself.')}
  await sleep(${LESSON_SECONDS[kind]});
  ${off}
} finally {
  gb.dispose();
}`;
}
export async function renderLesson(kind, s, {sampleRate = 48000, moduleOptions} = {}) {
  validateLesson(kind, s);
  // Snapshot editable arrays before asynchronous module loading.
  s = {...s, ...(kind === 'wave' ? {samples: s.samples.slice()} : {})};
  const chip = await GameboyApu.create({moduleFactory, moduleOptions, sampleRate});
  const gb = new GameboySynth({transport: new GameboyDirectTransport(chip)});
  try {
    gb.initialize(); gb.setMasterVolume(3, 3);
    if (kind === 'envelope') {
      gb.pulse.setVoice(0, {duty: 0.5, volume: s.volume, envelope: {direction: s.direction, period: s.period}});
      gb.pulse.setNote(0, 'A4'); gb.pulse.keyOn(0);
    } else {
      gb.wave.stopAndSetWaveform(s.samples); gb.wave.setLevel(s.level);
      gb.wave.setNote(s.note); gb.wave.keyOn();
    }
    const pcm = chip.generateStereo(Math.round(sampleRate * LESSON_SECONDS[kind]));
    if (kind === 'envelope') gb.pulse.keyOff(0); else gb.wave.keyOff();
    return {...pcm, sampleRate};
  } finally { gb.dispose(); chip.dispose(); }
}
/** Peak-to-peak amplitude of generated PCM in 10 ms windows; removes DC offsets. */
export function amplitudeTrace(input, sampleRate) {
  const step = Math.round(sampleRate * 0.01), values = [];
  for (let start = 0; start < input.length; start += step) {
    let lo = Infinity, hi = -Infinity;
    for (let i = start; i < Math.min(start + step, input.length); i++) { lo = Math.min(lo, input[i]); hi = Math.max(hi, input[i]); }
    values.push(hi - lo);
  }
  return values;
}
