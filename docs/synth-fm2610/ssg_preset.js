// SPDX-License-Identifier: BSD-3-Clause

const FORMAT = 'tetorica-fm2610-ssg';
export const SSG_PRESET_SUFFIX = '.ssg.json';

export function isSsgPresetPath(path) {
  return typeof path === 'string' && path.toLowerCase().endsWith(SSG_PRESET_SUFFIX);
}

export function createDefaultSsgPreset() {
  return {
    format: FORMAT, version: 1,
    channels: Array.from({length: 3}, () => ({tone: true, noise: false, level: 10, envelope: false, period: 0})),
    noisePeriod: 16, envelopePeriod: 512, envelopeShape: 10,
  };
}

function integer(value, maximum, name) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 0 to ${maximum}.`);
  }
  return value;
}

function flag(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
  return value;
}

export function readSsgPreset(source) {
  const preset = typeof source === 'string' ? JSON.parse(source) : source;
  if (preset?.format !== FORMAT || preset.version !== 1) throw new Error('Choose a Tetorica FM2610 SSG preset.');
  if (!Array.isArray(preset.channels) || preset.channels.length !== 3) throw new Error('An SSG preset needs three channels.');
  return {
    format: FORMAT, version: 1,
    channels: Array.from(preset.channels, (voice, channel) => {
      const label = `SSG CH${channel + 1}`;
      return {
        tone: flag(voice?.tone, `${label} Tone`),
        noise: flag(voice?.noise, `${label} Noise`),
        level: integer(voice?.level, 15, `${label} Level`),
        envelope: flag(voice?.envelope, `${label} Envelope`),
        period: integer(voice?.period, 4095, `${label} Tone period`),
      };
    }),
    noisePeriod: integer(preset.noisePeriod, 31, 'SSG Noise period'),
    envelopePeriod: integer(preset.envelopePeriod, 65535, 'SSG Envelope period'),
    envelopeShape: integer(preset.envelopeShape, 15, 'SSG Envelope shape'),
  };
}

export function writeSsgPreset(preset) {
  return JSON.stringify(readSsgPreset(preset), null, 2) + '\n';
}
