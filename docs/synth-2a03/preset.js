// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
const FORMAT = 'tetorica-nes-fds-voice';
const SOURCES = ['pulse', 'triangle', 'noise', 'dmc', 'fds'];
export const MAX_DPCM_BYTES = 4081;
export const LENGTH_TABLE = Object.freeze([10,254,20,2,40,4,80,6,160,8,60,10,14,12,26,14,12,16,24,18,48,20,96,22,192,24,72,26,16,28,32,30]);
export const TRIANGLE_LENGTHS = LENGTH_TABLE;
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
    format: FORMAT, version: 7, name: 'Pulse', source: 'pulse',
    pulse: {duty: .5, volume: 10, lengthHalt: true, lengthIndex: 1, envelope: {enabled: false, period: 8, loop: false},
      sweep: {enabled: false, period: 2, negate: false, shift: 1}},
    triangle: {control: true, linearReload: 127, lengthIndex: 1},
    noise: {volume: 8, period: 6, shortMode: false, lengthHalt: true, lengthIndex: 1, envelope: {enabled: false, period: 8, loop: false}},
    dmc: {data: [], rate: 15, loop: false, level: 64},
    fds: {wave: waveShape('sine'), volume: 24, master: 0,
      envelope: {enabled: false, increase: false, period: 8, initialGain: 32},
      envelopeClock: {masterSpeed: 232, halt: false},
      modulation: {enabled: false, table: [...Array(8).fill(1), ...Array(16).fill(7), ...Array(8).fill(1)], rate: 256, depth: 16, bias: 0,
        envelope: {enabled: false, increase: true, period: 8, initialGain: 0}}},
  };
}

/** Validate fully before sending a preset to the chip. */
export function readPreset(value) {
  const legacy = value?.version === 1;
  const legacyNoise = value?.version === 1 || value?.version === 2;
  const legacyFds = [1, 2, 3].includes(value?.version);
  const legacyFdsClock = value?.version === 4;
  const legacyModulation = [1, 2, 3, 4].includes(value?.version);
  const legacyTriangle = [1, 2, 3, 4, 5].includes(value?.version);
  const legacyLength = [1, 2, 3, 4, 5, 6].includes(value?.version);
  own(value, ['format', 'version', 'name', 'source', 'pulse', 'noise', 'fds', ...(legacy ? [] : ['dmc']), ...(legacyTriangle ? [] : ['triangle'])], 'NES + FDS preset');
  if (value.format !== FORMAT || ![1, 2, 3, 4, 5, 6, 7].includes(value.version)) throw new TypeError('Unsupported NES + FDS preset format/version');
  if (typeof value.name !== 'string' || value.name.length > 80 || /[\u0000-\u001f\u007f\u2028\u2029]/.test(value.name)) throw new TypeError('Instrument name must be at most 80 characters without control characters');
  own(value.pulse, ['duty', 'volume', 'envelope', 'sweep', ...(legacyLength ? [] : ['lengthHalt', 'lengthIndex'])], 'Pulse');
  own(value.pulse.envelope, ['enabled', 'period', 'loop'], 'Pulse envelope');
  own(value.pulse.sweep, ['enabled', 'period', 'negate', 'shift'], 'Pulse sweep');
  if (!legacyTriangle) own(value.triangle, ['control', 'linearReload', 'lengthIndex'], 'Triangle');
  own(value.noise, ['volume', 'period', 'shortMode', ...(legacyNoise ? [] : ['envelope']), ...(legacyLength ? [] : ['lengthHalt', 'lengthIndex'])], 'Noise');
  if (!legacyNoise) own(value.noise.envelope, ['enabled', 'period', 'loop'], 'Noise envelope');
  if (!legacy) own(value.dmc, ['data', 'rate', 'loop', 'level'], 'DMC');
  own(value.fds, ['wave', 'volume', 'master', 'modulation', ...(legacyFds ? [] : ['envelope']), ...(legacyModulation ? [] : ['envelopeClock'])], 'FDS');
  if (!legacyFds) own(value.fds.envelope, ['enabled', 'increase', 'period', 'initialGain', ...(legacyFdsClock ? ['masterSpeed', 'halt'] : [])], 'FDS envelope');
  if (!legacyModulation) own(value.fds.envelopeClock, ['masterSpeed', 'halt'], 'FDS envelope clock');
  own(value.fds.modulation, ['enabled', 'table', 'rate', 'depth', 'bias', ...(legacyModulation ? [] : ['envelope'])], 'FDS modulation');
  if (!legacyModulation) own(value.fds.modulation.envelope, ['enabled', 'increase', 'period', 'initialGain'], 'FDS modulation envelope');
  return {
    format: FORMAT, version: 7, name: value.name.trim(), source: choice(value.source, legacy ? SOURCES.filter(source => source !== 'dmc') : SOURCES, 'Sound source'),
    pulse: {duty: choice(value.pulse.duty, [.125, .25, .5, .75], 'Pulse duty'), volume: integer(value.pulse.volume, 0, 15, 'Pulse volume'),
      lengthHalt: legacyLength ? true : boolean(value.pulse.lengthHalt, 'Pulse length halt'), lengthIndex: legacyLength ? 1 : integer(value.pulse.lengthIndex, 0, 31, 'Pulse length index'),
      envelope: {enabled: boolean(value.pulse.envelope.enabled, 'Envelope enabled'), period: integer(value.pulse.envelope.period, 0, 15, 'Envelope period'), loop: boolean(value.pulse.envelope.loop, 'Envelope loop')},
      sweep: {enabled: boolean(value.pulse.sweep.enabled, 'Sweep enabled'), period: integer(value.pulse.sweep.period, 0, 7, 'Sweep period'), negate: boolean(value.pulse.sweep.negate, 'Sweep negate'), shift: integer(value.pulse.sweep.shift, 0, 7, 'Sweep shift')}},
    triangle: legacyTriangle ? {control:true, linearReload:127, lengthIndex:1} : {
      control: boolean(value.triangle.control, 'Triangle control'), linearReload: integer(value.triangle.linearReload, 0, 127, 'Triangle linear reload'),
      lengthIndex: integer(value.triangle.lengthIndex, 0, 31, 'Triangle length index'),
    },
    noise: {volume: integer(value.noise.volume, 0, 15, 'Noise volume'), period: integer(value.noise.period, 0, 15, 'Noise period'), shortMode: boolean(value.noise.shortMode, 'Noise short mode'),
      lengthHalt: legacyLength ? true : boolean(value.noise.lengthHalt, 'Noise length halt'), lengthIndex: legacyLength ? 1 : integer(value.noise.lengthIndex, 0, 31, 'Noise length index'),
      envelope: legacyNoise ? {enabled: false, period: 8, loop: false} : {
        enabled: boolean(value.noise.envelope.enabled, 'Noise envelope enabled'), period: integer(value.noise.envelope.period, 0, 15, 'Noise envelope period'), loop: boolean(value.noise.envelope.loop, 'Noise envelope loop'),
      }},
    dmc: legacy ? {data: [], rate: 15, loop: false, level: 64} : {
      data: dpcm(value.dmc.data), rate: integer(value.dmc.rate, 0, 15, 'DMC rate'),
      loop: boolean(value.dmc.loop, 'DMC loop'), level: integer(value.dmc.level, 0, 127, 'DMC initial level'),
    },
    fds: {wave: samples(value.fds.wave, 64, 63, 'FDS wave'), volume: integer(value.fds.volume, 0, 32, 'FDS volume'), master: integer(value.fds.master, 0, 3, 'FDS master scale'),
      envelope: legacyFds ? {enabled: false, increase: false, period: 8, initialGain: 32} : {
        enabled: boolean(value.fds.envelope.enabled, 'FDS envelope enabled'), increase: boolean(value.fds.envelope.increase, 'FDS envelope increase'),
        period: integer(value.fds.envelope.period, 0, 63, 'FDS envelope period'), initialGain: integer(value.fds.envelope.initialGain, 0, 63, 'FDS envelope initial gain'),
      },
      envelopeClock: legacyFds ? {masterSpeed: 232, halt: false} : {
        masterSpeed: integer((legacyFdsClock ? value.fds.envelope : value.fds.envelopeClock).masterSpeed, 0, 255, 'FDS master envelope speed'),
        halt: boolean((legacyFdsClock ? value.fds.envelope : value.fds.envelopeClock).halt, 'FDS envelope halt'),
      },
      modulation: {enabled: boolean(value.fds.modulation.enabled, 'Modulation enabled'), table: samples(value.fds.modulation.table, 32, 7, 'FDS modulation table'),
        rate: integer(value.fds.modulation.rate, 0, 4095, 'Modulation rate'), depth: integer(value.fds.modulation.depth, 0, 63, 'Modulation depth'), bias: integer(value.fds.modulation.bias, -64, 63, 'Modulation bias'),
        envelope: legacyModulation ? {enabled: false, increase: true, period: 8, initialGain: 0} : {
          enabled: boolean(value.fds.modulation.envelope.enabled, 'FDS modulation envelope enabled'), increase: boolean(value.fds.modulation.envelope.increase, 'FDS modulation envelope increase'),
          period: integer(value.fds.modulation.envelope.period, 0, 63, 'FDS modulation envelope period'), initialGain: integer(value.fds.modulation.envelope.initialGain, 0, 63, 'FDS modulation envelope initial gain'),
        }}},
  };
}

/** A single-channel audition using Playground's initialized NES API. */
export function presetToCode(value) {
  const preset = readPreset(value), channel = preset.source === 'pulse' ? 0 : preset.source === 'triangle' ? 2 : preset.source === 'noise' ? 3 : preset.source === 'dmc' ? 4 : 5;
  const lines = ['// Select Mode: NES + FDS in the Playground, then Run.', `// ${preset.name || 'Untitled NES + FDS voice'}`];
  if (preset.source === 'pulse') {
    const {duty, volume, envelope, sweep, lengthHalt, lengthIndex} = preset.pulse;
    const voice = {duty, ...(envelope.enabled ? {envelope: {period: envelope.period, loop: envelope.loop}} : {volume}),
      sweep: sweep.enabled ? sweep : {enabled: false, period: 0, negate: true, shift: 0}};
    for (const ch of [0, 1]) lines.push(`nes.pulse.setVoice(${ch}, ${JSON.stringify(voice)});`);
    if (!envelope.enabled) {
      const dutyBits = [.125, .25, .5, .75].indexOf(duty) << 6;
      for (const ch of [0, 1]) lines.push(`nes.writeRegister(0x${(0x4000 + ch * 4).toString(16)}, ${dutyBits | 16 | (lengthHalt ? 32 : 0) | volume}); // Fixed volume / hardware length halt.`);
    }
    lines.push('const pulsePeriod = nes.pulse.setFrequency(0, 440 * 2 ** ((60 - 69) / 12)); // C4.',
      `nes.writeRegister(0x4003, ${lengthIndex << 3} | (pulsePeriod >> 8)); // Authored length-table index, including zero.`,
      'nes.pulse.keyOn(0);', '// Release with nes.noteOff(0);');
    return lines.join('\n');
  } else if (preset.source === 'triangle') {
    const {control, linearReload, lengthIndex} = preset.triangle;
    lines.push('const trianglePeriod = nes.triangle.setFrequency(440 * 2 ** ((60 - 69) / 12)); // C4.',
      `nes.writeRegister(0x4008, ${(control ? 128 : 0) | linearReload}); // Linear reload / shared length halt.`,
      `nes.writeRegister(0x400b, ${lengthIndex << 3} | (trianglePeriod >> 8)); // Authored length-table index, including zero.`,
      'nes.triangle.keyOn();', '// Release with nes.noteOff(2);');
    return lines.join('\n');
  }
  else if (preset.source === 'noise') {
    const {volume, period, shortMode, envelope, lengthHalt, lengthIndex} = preset.noise;
    lines.push(`nes.noise.setVoice(${JSON.stringify({volume, period, shortMode})});`);
    if (envelope.enabled) lines.push(`nes.writeRegister(0x400c, ${(envelope.loop ? 32 : 0) | envelope.period}); // Hardware Noise volume envelope.`);
    else lines.push(`nes.writeRegister(0x400c, ${16 | (lengthHalt ? 32 : 0) | volume}); // Fixed volume / hardware length halt.`);
    lines.push('nes.noise.noteOn(); // Enable Noise; its clock sets texture, not note pitch.',
      `nes.writeRegister(0x400f, ${lengthIndex << 3}); // Replace the helper default with the authored length index.`,
      '// Release with nes.noteOff(3);');
    return lines.join('\n');
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
    const {enabled, table, rate, depth, bias, envelope: modulationEnvelope} = preset.fds.modulation;
    lines.push(`nes.fds.setWave(${JSON.stringify(preset.fds.wave)});`, `nes.fds.setVolume(${preset.fds.volume}, ${preset.fds.master});`, `nes.fds.setModulation(${JSON.stringify({enabled, table, rate, depth, bias})});`);
    const envelope = preset.fds.envelope, clock = preset.fds.envelopeClock;
    if (envelope.enabled || modulationEnvelope.enabled) {
      lines.push('const fdsPeriod = nes.fds.setFrequency(440 * 2 ** ((60 - 69) / 12)); // C4.', 'nes.fds.keyOn();');
      if (envelope.enabled) lines.push(`nes.writeRegister(0x4080, ${128 | envelope.initialGain}); // Seed the hardware volume gain after keyOn.`);
      if (modulationEnvelope.enabled) lines.push(`nes.writeRegister(0x4084, ${128 | modulationEnvelope.initialGain}); // Seed the hardware modulation gain.`);
      lines.push(`nes.writeRegister(0x408a, ${clock.masterSpeed});`);
      if (envelope.enabled) lines.push(`nes.writeRegister(0x4080, ${(envelope.increase ? 64 : 0) | envelope.period}); // Hardware volume envelope.`);
      if (modulationEnvelope.enabled) lines.push(`nes.writeRegister(0x4084, ${(modulationEnvelope.increase ? 64 : 0) | modulationEnvelope.period}); // Hardware modulation depth envelope.`);
      lines.push(`nes.writeRegister(0x4083, (fdsPeriod >> 8) | ${clock.halt ? 64 : 0}); // Keep pitch and set the shared envelope clock.`);
      lines.push('// Release with nes.noteOff(5);');
      return lines.join('\n');
    }
  }
  lines.push(preset.source === 'noise' ? 'nes.noise.noteOn(); // Noise period sets texture; keys do not tune it.' : `nes.noteOn(${channel}, 'C4');`);
  lines.push(`// Release with nes.noteOff(${channel});`);
  return lines.join('\n');
}
