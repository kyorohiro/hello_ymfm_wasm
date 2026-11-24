// SPDX-License-Identifier: BSD-3-Clause
import { loadPlaygroundCassette } from '../playground/playground_cassette.js';
import { crc32, createStoredZipBytes } from '../vgm_analyzer/stored_zip.js';
import { FM2610_ADPCM_B_ROM_BYTES, normalizeFm2610AdpcmBSample } from './adpcm_b.js';

export const ADPCM_B_SAMPLE_SUFFIX = '.adpcm-b-sample.zip';
const FORMAT = 'tetorica-fm2610-adpcm-b-sample';
const MANIFEST = 'sample.json';
const PAYLOAD = 'sample.adpcm-b';
const MAX_MANIFEST_BYTES = 8192;
const MAX_DOCUMENT_BYTES = FM2610_ADPCM_B_ROM_BYTES;

export function isAdpcmBSamplePath(path) {
  return typeof path === 'string' && path.toLowerCase().endsWith(ADPCM_B_SAMPLE_SUFFIX);
}

/** Store the encoded ROM bytes and playback settings together. */
export function writeAdpcmBSample(sample) {
  const {bytes, ...settings} = normalizeFm2610AdpcmBSample(sample);
  const manifest = {format: FORMAT, version: 1, ...settings};
  const document = createStoredZipBytes([
    {name: MANIFEST, data: new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n')},
    {name: PAYLOAD, data: bytes},
  ]);
  if (document.byteLength > MAX_DOCUMENT_BYTES) throw new RangeError('ADPCM-B sample ZIP exceeds the 16 MiB Files limit.');
  return document;
}

export async function readAdpcmBSample(source) {
  const bytes = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_DOCUMENT_BYTES) {
    throw new RangeError('Invalid ADPCM-B sample document size.');
  }
  const {files, directories} = await loadPlaygroundCassette(bytes, {crc32});
  const manifestBytes = files.get(MANIFEST);
  if (!manifestBytes || manifestBytes.length > MAX_MANIFEST_BYTES || directories.length ||
      files.size !== 2 || !files.has(PAYLOAD)) {
    throw new Error('Invalid ADPCM-B sample document.');
  }
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(manifestBytes));
  } catch (error) {
    throw new Error('Invalid ADPCM-B sample manifest.', {cause: error});
  }
  if (manifest?.format !== FORMAT || manifest.version !== 1) {
    throw new Error('Choose a Tetorica FM2610 ADPCM-B sample.');
  }
  return normalizeFm2610AdpcmBSample({...manifest, bytes: files.get(PAYLOAD)});
}
