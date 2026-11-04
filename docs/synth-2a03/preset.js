// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
const FORMAT = 'tetorica-nes-fds-voice';
const SOURCES = ['pulse', 'triangle', 'noise', 'fds'];
const own = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label}: expected an object`);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError(`${label}: unexpected or missing property`);
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
const samples = (value, length, max, label) => {
  if (!Array.isArray(value) || value.length !== length || Reflect.ownKeys(value).length !== length + 1) throw new RangeError(`${label}: expected exactly ${length} samples`);
  return Array.from(value, item => integer(item, 0, max, label));
};

/** Software preparation of one 64-sample, six-bit FDS wave cycle. */
export function waveShape(name) {
  choice(name, ['sine', 'triangle', 'saw', 'square'], 'Wave shape');
  return Array.from({length: 64}, (_, index) => {
    const phase = index / 64;
    const value = name === 'sine' ? (Math.sin(2 * Math.PI * phase) + 1) / 2
      : name === 'triangle' ? 1 - Math.abs(phase * 2 - 1) : name === 'saw' ? phase : index < 32 ? 1 : 0;
    return Math.round(value * 63);
  });
}

export function createDefaultPreset() {
  return {
    format: FORMAT, version: 1, name: 'Pulse', source: 'pulse',
    pulse: {duty: .5, volume: 10, envelope: {enabled: false, period: 8, loop: false},
      sweep: {enabled: false, period: 2, negate: false, shift: 1}},
    noise: {volume: 8, period: 6, shortMode: false},
    fds: {wave: waveShape('sine'), volume: 24, master: 0,
      modulation: {enabled: false, table: [...Array(8).fill(1), ...Array(16).fill(7), ...Array(8).fill(1)], rate: 256, depth: 16, bias: 0}},
  };
}

/** Validate fully before sending a preset to the chip. */
export function readPreset(value) {
  own(value, ['format', 'version', 'name', 'source', 'pulse', 'noise', 'fds'], 'NES + FDS preset');
  if (value.format !== FORMAT || value.version !== 1) throw new TypeError('Unsupported NES + FDS preset format/version');
  if (typeof value.name !== 'string' || value.name.length > 80 || /[\u0000-\u001f\u007f\u2028\u2029]/.test(value.name)) throw new TypeError('Instrument name must be at most 80 characters without control characters');
  own(value.pulse, ['duty', 'volume', 'envelope', 'sweep'], 'Pulse');
  own(value.pulse.envelope, ['enabled', 'period', 'loop'], 'Pulse envelope');
  own(value.pulse.sweep, ['enabled', 'period', 'negate', 'shift'], 'Pulse sweep');
  own(value.noise, ['volume', 'period', 'shortMode'], 'Noise');
  own(value.fds, ['wave', 'volume', 'master', 'modulation'], 'FDS');
  own(value.fds.modulation, ['enabled', 'table', 'rate', 'depth', 'bias'], 'FDS modulation');
  return {
    format: FORMAT, version: 1, name: value.name.trim(), source: choice(value.source, SOURCES, 'Sound source'),
    pulse: {duty: choice(value.pulse.duty, [.125, .25, .5, .75], 'Pulse duty'), volume: integer(value.pulse.volume, 0, 15, 'Pulse volume'),
      envelope: {enabled: boolean(value.pulse.envelope.enabled, 'Envelope enabled'), period: integer(value.pulse.envelope.period, 0, 15, 'Envelope period'), loop: boolean(value.pulse.envelope.loop, 'Envelope loop')},
      sweep: {enabled: boolean(value.pulse.sweep.enabled, 'Sweep enabled'), period: integer(value.pulse.sweep.period, 0, 7, 'Sweep period'), negate: boolean(value.pulse.sweep.negate, 'Sweep negate'), shift: integer(value.pulse.sweep.shift, 0, 7, 'Sweep shift')}},
    noise: {volume: integer(value.noise.volume, 0, 15, 'Noise volume'), period: integer(value.noise.period, 0, 15, 'Noise period'), shortMode: boolean(value.noise.shortMode, 'Noise short mode')},
    fds: {wave: samples(value.fds.wave, 64, 63, 'FDS wave'), volume: integer(value.fds.volume, 0, 32, 'FDS volume'), master: integer(value.fds.master, 0, 3, 'FDS master scale'),
      modulation: {enabled: boolean(value.fds.modulation.enabled, 'Modulation enabled'), table: samples(value.fds.modulation.table, 32, 7, 'FDS modulation table'),
        rate: integer(value.fds.modulation.rate, 0, 4095, 'Modulation rate'), depth: integer(value.fds.modulation.depth, 0, 63, 'Modulation depth'), bias: integer(value.fds.modulation.bias, -64, 63, 'Modulation bias')}},
  };
}

/** A single-channel audition using Playground's initialized NES API. */
export function presetToCode(value) {
  const preset = readPreset(value), channel = preset.source === 'pulse' ? 0 : preset.source === 'triangle' ? 2 : preset.source === 'noise' ? 3 : 5;
  const lines = ['// Select Mode: NES + FDS in the Playground, then Run.', `// ${preset.name || 'Untitled NES + FDS voice'}`];
  if (preset.source === 'pulse') {
    const {duty, volume, envelope, sweep} = preset.pulse;
    const voice = {duty, ...(envelope.enabled ? {envelope: {period: envelope.period, loop: envelope.loop}} : {volume}),
      sweep: sweep.enabled ? sweep : {enabled: false, period: 0, negate: true, shift: 0}};
    for (const ch of [0, 1]) lines.push(`nes.pulse.setVoice(${ch}, ${JSON.stringify(voice)});`);
  } else if (preset.source === 'triangle') lines.push('nes.writeRegister(0x4008, 0xff); // Hold the triangle linear counter.');
  else if (preset.source === 'noise') lines.push(`nes.noise.setVoice(${JSON.stringify(preset.noise)});`);
  else {
    lines.push('// FDS must be enabled: createSoundChip("nes", {fds: true}) for an extra chip.');
    lines.push(`nes.fds.setWave(${JSON.stringify(preset.fds.wave)});`, `nes.fds.setVolume(${preset.fds.volume}, ${preset.fds.master});`, `nes.fds.setModulation(${JSON.stringify(preset.fds.modulation)});`);
  }
  lines.push(preset.source === 'noise' ? 'nes.noise.noteOn(); // Noise period sets texture; keys do not tune it.' : `nes.noteOn(${channel}, 'C4');`);
  lines.push(`// Release with nes.noteOff(${channel});`);
  return lines.join('\n');
}
