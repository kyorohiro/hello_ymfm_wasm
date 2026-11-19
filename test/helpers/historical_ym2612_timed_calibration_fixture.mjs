// Older proof tests exercise their immutable source inventories before the new
// YM2612 layer. Authenticate and reconstruct only the exact reviewed revision;
// production freshness additionally tests current bodies and all dependencies.
import {relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {historicalCalibrationModule} from './historical_calibration_modules.mjs';
import {readFileSync as historicalRead} from './historical_huc_timed_calibration_inputs.mjs';
const {restoreMixerCalibrationYm2612TimedRevision}=await historicalCalibrationModule('mixer_calibration_ym2612_timed_revision.mjs');

const root = fileURLToPath(new URL('../../', import.meta.url));
const encoding = options => typeof options === 'string' ? options : options?.encoding;
const binaryOptions = options => typeof options === 'object' && options ? {...options, encoding: null} : undefined;
function predecessor(path, bytes) {
  const filename = path instanceof URL ? fileURLToPath(path) : resolve(String(path));
  return restoreMixerCalibrationYm2612TimedRevision(relative(root, filename).replaceAll('\\', '/'), bytes);
}
export function readHistoricalYm2612TimedFileSync(path, options) {
  const bytes = predecessor(path, historicalRead(path, binaryOptions(options)));
  return encoding(options) ? bytes.toString(encoding(options)) : bytes;
}
export async function readHistoricalYm2612TimedFile(path, options) {
  const bytes = predecessor(path, historicalRead(path, binaryOptions(options)));
  return encoding(options) ? bytes.toString(encoding(options)) : bytes;
}
