// SPDX-License-Identifier: BSD-3-Clause
import { loadPlaygroundCassette } from '../playground/playground_cassette.js';
import { crc32, createStoredZipBytes } from '../vgm_analyzer/stored_zip.js';

export const ADPCM_A_KIT_SUFFIX = '.adpcm-a-kit.zip';
export const ADPCM_A_KIT_MAX_SAMPLE_BYTES = 0xfff00;
const FORMAT = 'tetorica-fm2610-adpcm-a-kit';
const PAD_COUNT = 6;
const MANIFEST = 'kit.json';
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_KIT_BYTES = PAD_COUNT * ADPCM_A_KIT_MAX_SAMPLE_BYTES + 128 * 1024;
const samplePath = index => 'pads/a' + (index + 1) + '.adpcm-a';

export function isAdpcmAKitPath(path) {
  return typeof path === 'string' && path.toLowerCase().endsWith(ADPCM_A_KIT_SUFFIX);
}

export function createDefaultAdpcmAKit() {
  return {level: 56, pads: Array(PAD_COUNT).fill(null)};
}

/** Validate a complete kit and give its owner independent copies of the ROM bytes. */
export function normalizeAdpcmAKit(kit) {
  const {level, pads} = kit ?? {};
  if (!Number.isInteger(level) || level < 0 || level > 63) {
    throw new RangeError('ADPCM-A kit level must be 0–63.');
  }
  if (!Array.isArray(pads) || pads.length !== PAD_COUNT) {
    throw new TypeError('The ADPCM-A kit must have six pad assignments.');
  }
  return {
    level,
    pads: Array.from(pads, (sample, index) => {
      if (sample === null) return null;
      const {name, bytes} = sample ?? {};
      if (typeof name !== 'string' || !name.trim() || name.length > 1024) {
        throw new TypeError('Invalid sample name for ADPCM-A pad A' + (index + 1) + '.');
      }
      if (!(bytes instanceof Uint8Array) || !bytes.length ||
          bytes.length % 256 || bytes.length > ADPCM_A_KIT_MAX_SAMPLE_BYTES) {
        throw new RangeError('Invalid ADPCM-A sample size for pad A' + (index + 1) + '.');
      }
      const {address, voice} = sample;
      const normalized = {name, bytes: new Uint8Array(bytes)};
      if (address !== undefined) {
        if (!Number.isInteger(address) || address < 0 || address % 256 || address + bytes.length > 0x1000000) {
          throw new RangeError('Invalid ADPCM-A ROM address for pad A' + (index + 1) + '.');
        }
        normalized.address = address;
      }
      if (voice !== undefined) {
        const {volume, left, right} = voice ?? {};
        if (!Number.isInteger(volume) || volume < 0 || volume > 31 ||
            typeof left !== 'boolean' || typeof right !== 'boolean') {
          throw new TypeError('Invalid ADPCM-A voice settings for pad A' + (index + 1) + '.');
        }
        normalized.voice = {volume, left, right};
      }
      return normalized;
    }),
  };
}

/** Keep the per-pad data binary. The six slots fit under one Cassette's capacity. */
export function writeAdpcmAKit(kit) {
  const {level, pads} = normalizeAdpcmAKit(kit);
  const manifest = {
    format: FORMAT, version: 1, level,
    pads: pads.map(sample => sample ? {name: sample.name, address: sample.address, voice: sample.voice} : null),
  };
  const files = [{name: MANIFEST, data: new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n')}];
  for (const [index, sample] of pads.entries()) {
    if (sample) files.push({name: samplePath(index), data: sample.bytes});
  }
  return createStoredZipBytes(files);
}

export async function readAdpcmAKit(source) {
  const bytes = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_KIT_BYTES) {
    throw new RangeError('Invalid ADPCM-A kit size.');
  }
  const {files, directories} = await loadPlaygroundCassette(bytes, {crc32});
  const manifestBytes = files.get(MANIFEST);
  if (!manifestBytes || manifestBytes.length > MAX_MANIFEST_BYTES ||
      directories.some(path => path !== '/pads')) {
    throw new Error('Invalid ADPCM-A kit manifest.');
  }
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(manifestBytes));
  } catch (error) {
    throw new Error('Invalid ADPCM-A kit manifest.', {cause: error});
  }
  if (manifest?.format !== FORMAT || manifest.version !== 1 ||
      !Array.isArray(manifest.pads) || manifest.pads.length !== PAD_COUNT) {
    throw new Error('Choose a Tetorica FM2610 ADPCM-A kit.');
  }
  const expectedFiles = new Set([MANIFEST]);
  const pads = manifest.pads.map((sample, index) => {
    if (sample === null) return null;
    const path = samplePath(index);
    expectedFiles.add(path);
    return {name: sample?.name, address: sample?.address, voice: sample?.voice, bytes: files.get(path)};
  });
  if ([...files.keys()].some(path => !expectedFiles.has(path))) {
    throw new Error('ADPCM-A kit contains an unassigned file.');
  }
  return normalizeAdpcmAKit({level: manifest.level, pads});
}
