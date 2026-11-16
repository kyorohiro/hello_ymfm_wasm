// Historical calibration tests exercise their original exact source pairs.
// Reconstruct the independently reviewed AY predecessor before earlier layers;
// the strict production proof still rejects changed bodies or dependencies.
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {restoreMixerCalibrationAyTimedRevision} from '../../scripts/mixer_calibration_ay_timed_revision.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
function predecessor(path, bytes) {
  const filename = path instanceof URL ? fileURLToPath(path) : resolve(String(path));
  return restoreMixerCalibrationAyTimedRevision(relative(root, filename).replaceAll('\\', '/'), bytes);
}
const encoding = options => typeof options === 'string' ? options : options?.encoding;
const binaryOptions = options => typeof options === 'object' && options ? {...options, encoding: null} : undefined;

export function readHistoricalAyTimedFileSync(path, options) {
  const bytes = predecessor(path, readFileSync(path, binaryOptions(options)));
  return encoding(options) ? bytes.toString(encoding(options)) : bytes;
}

export async function readHistoricalAyTimedFile(path, options) {
  const bytes = predecessor(path, await readFile(path, binaryOptions(options)));
  return encoding(options) ? bytes.toString(encoding(options)) : bytes;
}
