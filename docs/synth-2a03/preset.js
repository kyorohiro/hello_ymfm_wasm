// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
const FORMAT = 'tetorica-nes-fds-voice';
const SOURCES = ['pulse', 'triangle', 'noise', 'dmc', 'fds'];
export const MAX_DPCM_BYTES = 4081;
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
const dpcm = value => {
  if (!Array.isArray(value) || value.length > MAX_DPCM_BYTES || Reflect.ownKeys(value).length !== value.length + 1) throw new RangeError(`DPCM: expected 0–${MAX_DPCM_BYTES} bytes`);
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) throw new RangeError('DPCM: expected a dense byte array');
  return Array.from({length: value.length}, (_, index) => integer(value[index], 0, 255, 'DPCM byte'));
};

/** Software-generated DPCM demo, encoded for the standard initial level 64.
 * Sixteen low-amplitude cycles fit the complete hardware-length sample, so
 * looping returns to its initial level without clipping or an extra up byte.
 * This prepares only the built-in demo; it is not a general PCM encoder. */
export function createDemoDpcm() {
  const bytes = Array(257).fill(0), bits = bytes.length * 8;
  let level = 64;
  for (let index = 0; index < bits; index++) {
    const target = 64 + 24 * Math.sin(2 * Math.PI * 16 * (index + 1) / bits);
    const up = target > level;
    if (up) bytes[index >> 3] |= 1 << (index & 7);
    level += up ? 2 : -2;
  }
  return bytes;
}

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
    format: FORMAT, version: 4, name: 'Pulse', source: 'pulse',
    pulse: {duty: .5, volume: 10, envelope: {enabled: false, period: 8, loop: false},
      sweep: {enabled: false, period: 2, negate: false, shift: 1}},
    noise: {volume: 8, period: 6, shortMode: false, envelope: {enabled: false, period: 8, loop: false}},
    dmc: {data: [], rate: 15, loop: false, level: 64},
    fds: {wave: waveShape('sine'), volume: 24, master: 0,
      envelope: {enabled: false, increase: false, period: 8, masterSpeed: 232, initialGain: 32, halt: false},
      modulation: {enabled: false, table: [...Array(8).fill(1), ...Array(16).fill(7), ...Array(8).fill(1)], rate: 256, depth: 16, bias: 0}},
  };
}

/** Validate fully before sending a preset to the chip. */
export function readPreset(value) {
  const legacy = value?.version === 1;
  const legacyNoise = value?.version === 1 || value?.version === 2;
  const legacyFds = [1, 2, 3].includes(value?.version);
  own(value, ['format', 'version', 'name', 'source', 'pulse', 'noise', 'fds', ...(legacy ? [] : ['dmc'])], 'NES + FDS preset');
  if (value.format !== FORMAT || ![1, 2, 3, 4].includes(value.version)) throw new TypeError('Unsupported NES + FDS preset format/version');
  if (typeof value.name !== 'string' || value.name.length > 80 || /[\u0000-\u001f\u007f\u2028\u2029]/.test(value.name)) throw new TypeError('Instrument name must be at most 80 characters without control characters');
  own(value.pulse, ['duty', 'volume', 'envelope', 'sweep'], 'Pulse');
  own(value.pulse.envelope, ['enabled', 'period', 'loop'], 'Pulse envelope');
  own(value.pulse.sweep, ['enabled', 'period', 'negate', 'shift'], 'Pulse sweep');
  own(value.noise, ['volume', 'period', 'shortMode', ...(legacyNoise ? [] : ['envelope'])], 'Noise');
  if (!legacyNoise) own(value.noise.envelope, ['enabled', 'period', 'loop'], 'Noise envelope');
  if (!legacy) own(value.dmc, ['data', 'rate', 'loop', 'level'], 'DMC');
  own(value.fds, ['wave', 'volume', 'master', 'modulation', ...(legacyFds ? [] : ['envelope'])], 'FDS');
  if (!legacyFds) own(value.fds.envelope, ['enabled', 'increase', 'period', 'masterSpeed', 'initialGain', 'halt'], 'FDS envelope');
  own(value.fds.modulation, ['enabled', 'table', 'rate', 'depth', 'bias'], 'FDS modulation');
  return {
    format: FORMAT, version: 4, name: value.name.trim(), source: choice(value.source, legacy ? SOURCES.filter(source => source !== 'dmc') : SOURCES, 'Sound source'),
    pulse: {duty: choice(value.pulse.duty, [.125, .25, .5, .75], 'Pulse duty'), volume: integer(value.pulse.volume, 0, 15, 'Pulse volume'),
      envelope: {enabled: boolean(value.pulse.envelope.enabled, 'Envelope enabled'), period: integer(value.pulse.envelope.period, 0, 15, 'Envelope period'), loop: boolean(value.pulse.envelope.loop, 'Envelope loop')},
      sweep: {enabled: boolean(value.pulse.sweep.enabled, 'Sweep enabled'), period: integer(value.pulse.sweep.period, 0, 7, 'Sweep period'), negate: boolean(value.pulse.sweep.negate, 'Sweep negate'), shift: integer(value.pulse.sweep.shift, 0, 7, 'Sweep shift')}},
    noise: {volume: integer(value.noise.volume, 0, 15, 'Noise volume'), period: integer(value.noise.period, 0, 15, 'Noise period'), shortMode: boolean(value.noise.shortMode, 'Noise short mode'),
      envelope: legacyNoise ? {enabled: false, period: 8, loop: false} : {
        enabled: boolean(value.noise.envelope.enabled, 'Noise envelope enabled'), period: integer(value.noise.envelope.period, 0, 15, 'Noise envelope period'), loop: boolean(value.noise.envelope.loop, 'Noise envelope loop'),
      }},
    dmc: legacy ? {data: [], rate: 15, loop: false, level: 64} : {
      data: dpcm(value.dmc.data), rate: integer(value.dmc.rate, 0, 15, 'DMC rate'),
      loop: boolean(value.dmc.loop, 'DMC loop'), level: integer(value.dmc.level, 0, 127, 'DMC initial level'),
    },
    fds: {wave: samples(value.fds.wave, 64, 63, 'FDS wave'), volume: integer(value.fds.volume, 0, 32, 'FDS volume'), master: integer(value.fds.master, 0, 3, 'FDS master scale'),
      envelope: legacyFds ? {enabled: false, increase: false, period: 8, masterSpeed: 232, initialGain: 32, halt: false} : {
        enabled: boolean(value.fds.envelope.enabled, 'FDS envelope enabled'), increase: boolean(value.fds.envelope.increase, 'FDS envelope increase'),
        period: integer(value.fds.envelope.period, 0, 63, 'FDS envelope period'), masterSpeed: integer(value.fds.envelope.masterSpeed, 0, 255, 'FDS master envelope speed'),
        initialGain: integer(value.fds.envelope.initialGain, 0, 63, 'FDS envelope initial gain'), halt: boolean(value.fds.envelope.halt, 'FDS envelope halt'),
      },
      modulation: {enabled: boolean(value.fds.modulation.enabled, 'Modulation enabled'), table: samples(value.fds.modulation.table, 32, 7, 'FDS modulation table'),
        rate: integer(value.fds.modulation.rate, 0, 4095, 'Modulation rate'), depth: integer(value.fds.modulation.depth, 0, 63, 'Modulation depth'), bias: integer(value.fds.modulation.bias, -64, 63, 'Modulation bias')}},
  };
}

/** A single-channel audition using Playground's initialized NES API. */
export function presetToCode(value) {
  const preset = readPreset(value), channel = preset.source === 'pulse' ? 0 : preset.source === 'triangle' ? 2 : preset.source === 'noise' ? 3 : preset.source === 'dmc' ? 4 : 5;
  const lines = ['// Select Mode: NES + FDS in the Playground, then Run.', `// ${preset.name || 'Untitled NES + FDS voice'}`];
  if (preset.source === 'pulse') {
    const {duty, volume, envelope, sweep} = preset.pulse;
    const voice = {duty, ...(envelope.enabled ? {envelope: {period: envelope.period, loop: envelope.loop}} : {volume}),
      sweep: sweep.enabled ? sweep : {enabled: false, period: 0, negate: true, shift: 0}};
    for (const ch of [0, 1]) lines.push(`nes.pulse.setVoice(${ch}, ${JSON.stringify(voice)});`);
  } else if (preset.source === 'triangle') lines.push('nes.writeRegister(0x4008, 0xff); // Hold the triangle linear counter.');
  else if (preset.source === 'noise') {
    const {volume, period, shortMode, envelope} = preset.noise;
    lines.push(`nes.noise.setVoice(${JSON.stringify({volume, period, shortMode})});`);
    if (envelope.enabled) lines.push(`nes.writeRegister(0x400c, ${(envelope.loop ? 32 : 0) | envelope.period}); // Hardware Noise volume envelope.`);
  }
  else if (preset.source === 'dmc') {
    lines.push('// Encoded 1-bit DPCM bytes; each key uses the selected rate, not a musical note.');
    if (!preset.dmc.data.length) return [...lines, '// Load a DPCM sample in the Synth before copying this source.'].join('\n');
    const {rate, loop, level} = preset.dmc;
    lines.push(`await nes.dmc.loadSample(Uint8Array.from(${JSON.stringify(preset.dmc.data)}));`, `nes.dmc.play(${JSON.stringify({rate, loop, level})});`);
    lines.push('// Release with nes.dmc.stop(); nes.writeRegister(0x4011, 0);');
    return lines.join('\n');
  }
  else {
    lines.push('// FDS must be enabled: createSoundChip("nes", {fds: true}) for an extra chip.');
    lines.push(`nes.fds.setWave(${JSON.stringify(preset.fds.wave)});`, `nes.fds.setVolume(${preset.fds.volume}, ${preset.fds.master});`, `nes.fds.setModulation(${JSON.stringify(preset.fds.modulation)});`);
    const envelope = preset.fds.envelope;
    if (envelope.enabled) {
      lines.push('const fdsPeriod = nes.fds.setFrequency(440 * 2 ** ((60 - 69) / 12)); // C4.', 'nes.fds.keyOn();');
      lines.push(`nes.writeRegister(0x4080, ${128 | envelope.initialGain}); // Seed the hardware gain after keyOn.`,
        `nes.writeRegister(0x408a, ${envelope.masterSpeed});`,
        `nes.writeRegister(0x4080, ${(envelope.increase ? 64 : 0) | envelope.period}); // Hardware volume envelope.`,
        `nes.writeRegister(0x4083, (fdsPeriod >> 8) | ${envelope.halt ? 64 : 0}); // Keep pitch and set the envelope clock.`);
      lines.push('// Release with nes.noteOff(5);');
      return lines.join('\n');
    }
  }
  lines.push(preset.source === 'noise' ? 'nes.noise.noteOn(); // Noise period sets texture; keys do not tune it.' : `nes.noteOn(${channel}, 'C4');`);
  lines.push(`// Release with nes.noteOff(${channel});`);
  return lines.join('\n');
}
