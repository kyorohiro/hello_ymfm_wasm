// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.

const FORMAT = 'tetorica-huc6280-voice';
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label}: expected an object`);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || actual.some(key => !keys.includes(key))) {
    throw new TypeError(`${label}: unexpected or missing property`);
  }
}
function number(value, min, max, label, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) {
    throw new RangeError(`${label}: expected ${integer ? 'an integer' : 'a number'} ${min}–${max}`);
  }
  return value;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label}: expected a boolean`);
  return value;
}
function wave(value, label) {
  if (!Array.isArray(value) || value.length !== 32 || Reflect.ownKeys(value).length !== 33) throw new RangeError(`${label}: expected exactly 32 samples`);
  return Array.from(value, sample => number(sample, 0, 31, `${label} sample`, true));
}

/** Prepare one quantized 32-sample, five-bit HuC6280 waveform in software. */
export function waveShape(name) {
  if (!['sine', 'triangle', 'saw', 'square'].includes(name)) throw new RangeError('Expected Sine, Triangle, Saw or Square');
  return Array.from({length:32}, (_, index) => {
    const phase = index / 32;
    const value = name === 'sine' ? (1 + Math.sin(phase * Math.PI * 2)) / 2
      : name === 'triangle' ? 1 - Math.abs(2 * phase - 1)
      : name === 'saw' ? phase : index < 16 ? 1 : 0;
    return Math.round(31 * value);
  });
}

export function createDefaultPreset() {
  return {format:FORMAT, version:1, name:'Sine', source:'wave', wave:waveShape('sine'), volume:24,
    pan:{left:15, right:15}, noise:{frequency:16},
    lfo:{enabled:false, frequency:32, depth:1, wave:waveShape('sine')},
    envelope:{enabled:true, attack:.005, decay:0, sustain:1, release:.025}};
}

/** Validate a complete portable preset atomically and detach all nested data.
 * Envelope timing is host software, not a HuC6280 hardware envelope unit. */
export function readPreset(value) {
  object(value, ['format','version','name','source','wave','volume','pan','noise','lfo','envelope'], 'HuC6280 preset');
  if (value.format !== FORMAT || value.version !== 1) throw new TypeError('Unsupported HuC6280 preset format/version');
  if (typeof value.name !== 'string' || value.name.length > 80 || /[\u0000-\u001f\u007f\u2028\u2029]/.test(value.name)) throw new TypeError('Instrument name must be at most 80 characters without control characters');
  if (!['wave','noise'].includes(value.source)) throw new RangeError('Expected Wave or Noise source');
  object(value.pan, ['left','right'], 'Pan');
  object(value.noise, ['frequency'], 'Noise');
  object(value.lfo, ['enabled','frequency','depth','wave'], 'Hardware LFO');
  object(value.envelope, ['enabled','attack','decay','sustain','release'], 'Software envelope');
  return {format:FORMAT, version:1, name:value.name.trim(), source:value.source, wave:wave(value.wave, 'Main wave'),
    volume:number(value.volume, 0, 31, 'Channel volume', true),
    pan:{left:number(value.pan.left, 0, 15, 'Left balance', true), right:number(value.pan.right, 0, 15, 'Right balance', true)},
    noise:{frequency:number(value.noise.frequency, 0, 31, 'Noise clock', true)},
    lfo:{enabled:boolean(value.lfo.enabled, 'LFO enabled'), frequency:number(value.lfo.frequency, 0, 255, 'LFO frequency register', true),
      depth:number(value.lfo.depth, 1, 3, 'LFO depth', true), wave:wave(value.lfo.wave, 'LFO wave')},
    envelope:{enabled:boolean(value.envelope.enabled, 'Envelope enabled'),
      attack:number(value.envelope.attack, 0, 10, 'Attack seconds'), decay:number(value.envelope.decay, 0, 10, 'Decay seconds'),
      sustain:number(value.envelope.sustain, 0, 1, 'Sustain level'), release:number(value.envelope.release, 0, 10, 'Release seconds')}};
}

/** Self-contained setup for the Playground's initialized `pce` chip API.
 * Keyboard allocation and software ADSR belong to the standalone host. */
export function presetToCode(value) {
  const preset = readPreset(value), channel = preset.source === 'noise' ? 4 : 0;
  const lfo = preset.source === 'wave' && preset.lfo.enabled;
  const lines = ['// Select Mode: HuC6280 / PC Engine in Playground, then Run.', `// ${preset.name || 'Untitled HuC6280 voice'}`,
    '// Raw hardware audition; keyboard round robin and Software envelope are host features.',
    `// Software envelope: ${JSON.stringify(preset.envelope)}`, 'pce.allNotesOff();', 'pce.setMasterVolume(15, 15);',
    'pce.setLfo({frequency:0, depth:0});'];
  for (let ch = 0; ch < 6; ch++) {
    lines.push(`pce.setDda(${ch}, false);`);
    if (ch >= 4) lines.push(`pce.setNoise(${ch}, {enabled:false});`);
  }
  lines.push(`pce.setWaveform(${channel}, ${JSON.stringify(preset.wave)});`, `pce.setVolume(${channel}, ${preset.volume});`,
    `pce.setPan(${channel}, ${preset.pan.left}, ${preset.pan.right});`);
  if (preset.source === 'noise') {
    lines.push(`pce.setNoise(4, {enabled:true, frequency:${preset.noise.frequency}});`, 'pce.keyOn(4); // Keys do not assign a chromatic pitch to noise.');
  } else {
    if (lfo) lines.push(`pce.setWaveform(1, ${JSON.stringify(preset.lfo.wave)});`, 'pce.setVolume(1, 0); // CH2 modulates CH1 without audible CH2 output.',
      "pce.setNote(1, 'C4'); // Modulator period follows this carrier note in the standalone Synth.",
      `pce.setLfo({frequency:${preset.lfo.frequency}, depth:${preset.lfo.depth}});`);
    lines.push("pce.noteOn(0, 'C4');");
  }
  lines.push(`// Release with pce.keyOff(${channel});`);
  return lines.join('\n');
}
