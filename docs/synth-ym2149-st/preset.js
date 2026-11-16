// SPDX-License-Identifier: BSD-3-Clause
export const YM2149_ST_PRESET_FORMAT = 'tetorica-ym2149-st-voice';

const object = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))
    throw new TypeError(`Invalid ${label} properties`);
};
const integer = (value, max, label) => {
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new RangeError(`${label} must be an integer 0..${max}`);
  return value;
};
const boolean = (value, label) => {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
};

/** A complete chip patch: three independent mixers and one shared noise/envelope. */
export function createDefaultPreset() {
  return {
    format: YM2149_ST_PRESET_FORMAT, version: 1, name: 'ST Square',
    voices: [478, 379, 319].map(period => ({tone: true, noise: false, volume: 9, envelope: false, period})),
    noisePeriod: 16, envelope: {period: 1600, shape: 10},
  };
}

/** Validate before touching hardware and return an independent, normalized copy. */
export function readPreset(value) {
  if (typeof value === 'string') value = JSON.parse(value);
  object(value, ['format', 'version', 'name', 'voices', 'noisePeriod', 'envelope'], 'YM2149 ST preset');
  if (value.format !== YM2149_ST_PRESET_FORMAT || value.version !== 1)
    throw new TypeError('Unsupported YM2149 ST preset format or version');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 || /[\u0000-\u001f\u007f]/u.test(value.name))
    throw new TypeError('Preset name must contain 1..120 printable characters');
  if (!Array.isArray(value.voices) || value.voices.length !== 3)
    throw new TypeError('YM2149 ST presets need exactly three voices');
  const voices = value.voices.map((voice, channel) => {
    object(voice, ['tone', 'noise', 'volume', 'envelope', 'period'], `CH${channel + 1} voice`);
    return {
      tone: boolean(voice.tone, 'Tone gate'), noise: boolean(voice.noise, 'Noise gate'),
      volume: integer(voice.volume, 15, 'Volume'), envelope: boolean(voice.envelope, 'Envelope selection'),
      period: integer(voice.period, 4095, 'Tone period'),
    };
  });
  object(value.envelope, ['period', 'shape'], 'shared envelope');
  return {
    format: YM2149_ST_PRESET_FORMAT, version: 1, name: value.name.trim(), voices,
    noisePeriod: integer(value.noisePeriod, 31, 'Noise period'),
    envelope: {period: integer(value.envelope.period, 65535, 'Envelope period'), shape: integer(value.envelope.shape, 15, 'Envelope shape')},
  };
}

/** Readable JSON for preset files and their text editor. */
export function presetToCode(value) { return JSON.stringify(readPreset(value), null, 2) + '\n'; }
