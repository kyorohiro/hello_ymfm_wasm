// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.

const FORMAT = 'tetorica-gameboy-voice';
const SOURCES = ['pulse', 'wave', 'noise'];
const own = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label}: expected an object`);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError(`${label}: unexpected or missing property`);
  }
};
const integer = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${label}: expected an integer ${min}–${max}`);
  return value;
};
const choice = (value, values, label) => {
  if (!values.includes(value)) throw new RangeError(`${label}: expected ${values.join(' / ')}`);
  return value;
};
const boolean = (value, label) => {
  if (typeof value !== 'boolean') throw new TypeError(`${label}: expected a boolean`);
  return value;
};
function envelope(value, label) {
  own(value, ['direction', 'period'], label);
  return {direction: choice(value.direction, ['down', 'up'], `${label} direction`), period: integer(value.period, 0, 7, `${label} pace`)};
}

/** Software preparation of one 32-sample, four-bit Game Boy Wave RAM cycle. */
export function waveShape(name) {
  choice(name, ['sine', 'triangle', 'saw', 'square'], 'Wave shape');
  return Array.from({length: 32}, (_, index) => {
    const phase = index / 32;
    const value = name === 'sine' ? (Math.sin(2 * Math.PI * phase) + 1) / 2
      : name === 'triangle' ? 1 - Math.abs(phase * 2 - 1)
      : name === 'saw' ? phase : index < 16 ? 1 : 0;
    return Math.round(value * 15);
  });
}

export function createDefaultPreset() {
  return {
    format: FORMAT, version: 1, name: 'Pulse', source: 'pulse',
    pulse: {duty: 0.5, volume: 10, envelope: {direction: 'down', period: 0}, sweep: {enabled: false, direction: 'down', period: 3, shift: 3}},
    wave: {samples: waveShape('sine'), level: 0.5},
    noise: {volume: 10, envelope: {direction: 'down', period: 0}, divisor: 3, shift: 4, width: 15},
    pan: {left: true, right: true},
  };
}

/** Validate the complete portable format before touching an instrument.
 * Returns a detached JSON-safe copy; thread snapshots are not preset files. */
export function readPreset(value) {
  own(value, ['format', 'version', 'name', 'source', 'pulse', 'wave', 'noise', 'pan'], 'Game Boy preset');
  if (value.format !== FORMAT || value.version !== 1) throw new TypeError('Unsupported Game Boy preset format/version');
  if (typeof value.name !== 'string' || value.name.length > 80 || /[\u0000-\u001f\u007f\u2028\u2029]/.test(value.name)) throw new TypeError('Instrument name must be at most 80 characters without control characters');
  choice(value.source, SOURCES, 'Sound source');
  own(value.pulse, ['duty', 'volume', 'envelope', 'sweep'], 'Pulse');
  own(value.pulse.sweep, ['enabled', 'direction', 'period', 'shift'], 'Sweep');
  own(value.wave, ['samples', 'level'], 'Wave');
  if (!Array.isArray(value.wave.samples) || value.wave.samples.length !== 32 ||
      Reflect.ownKeys(value.wave.samples).length !== 33) throw new RangeError('Wave requires exactly 32 four-bit samples');
  // Array.from also visits holes; a sparse array must not pass validation.
  const samples = Array.from(value.wave.samples, sample => integer(sample, 0, 15, 'Wave sample'));
  own(value.noise, ['volume', 'envelope', 'divisor', 'shift', 'width'], 'Noise');
  own(value.pan, ['left', 'right'], 'Pan');
  return {
    format: FORMAT, version: 1, name: value.name.trim(), source: value.source,
    pulse: {
      duty: choice(value.pulse.duty, [0.125, 0.25, 0.5, 0.75], 'Pulse duty'),
      volume: integer(value.pulse.volume, 0, 15, 'Pulse volume'),
      envelope: envelope(value.pulse.envelope, 'Pulse envelope'),
      sweep: {
        enabled: boolean(value.pulse.sweep.enabled, 'Sweep enabled'),
        direction: choice(value.pulse.sweep.direction, ['up', 'down'], 'Sweep direction'),
        period: integer(value.pulse.sweep.period, 0, 7, 'Sweep pace'),
        shift: integer(value.pulse.sweep.shift, 0, 7, 'Sweep shift'),
      },
    },
    wave: {samples, level: choice(value.wave.level, [0, 0.25, 0.5, 1], 'Wave level')},
    noise: {
      volume: integer(value.noise.volume, 0, 15, 'Noise volume'),
      envelope: envelope(value.noise.envelope, 'Noise envelope'),
      divisor: integer(value.noise.divisor, 0, 7, 'Noise divisor'),
      shift: integer(value.noise.shift, 0, 15, 'Noise clock shift'),
      width: choice(value.noise.width, [7, 15], 'Noise LFSR width'),
    },
    pan: {left: boolean(value.pan.left, 'Left output'), right: boolean(value.pan.right, 'Right output')},
  };
}

/** A self-contained voice setup for Playground's initialized `gameboy` API.
 * Keyboard round robin is a host feature, so this snippet auditions one channel. */
export function presetToCode(value) {
  const preset = readPreset(value), lines = ['// Select Mode: Game Boy in the Playground, then Run.', `// ${preset.name || 'Untitled Game Boy voice'}`];
  const channel = preset.source === 'pulse' ? 0 : preset.source === 'wave' ? 2 : 3;
  if (preset.source === 'pulse') {
    const {duty, volume, envelope: env, sweep} = preset.pulse;
    for (const ch of [0, 1]) lines.push(`gameboy.pulse.setVoice(${ch}, ${JSON.stringify({duty, volume, envelope: env})});`);
    const settings = sweep.enabled ? {direction: sweep.direction, period: sweep.period, shift: sweep.shift} : {direction: 'up', period: 0, shift: 0};
    lines.push(`gameboy.pulse.setSweep(${JSON.stringify(settings)});`);
  } else if (preset.source === 'wave') {
    lines.push(`gameboy.wave.stopAndSetWaveform(${JSON.stringify(preset.wave.samples)});`, `gameboy.wave.setLevel(${preset.wave.level});`);
  } else lines.push(`gameboy.noise.setVoice(${JSON.stringify(preset.noise)});`);
  lines.push(`gameboy.setPan(${channel}, ${preset.pan.left}, ${preset.pan.right});`);
  lines.push(preset.source === 'noise' ? 'gameboy.noise.keyOn(); // Noise clock sets texture; keyboard note does not change pitch.' : `gameboy.noteOn(${channel}, 'C4');`);
  lines.push(`// Release with gameboy.keyOff(${channel});`);
  return lines.join('\n');
}
