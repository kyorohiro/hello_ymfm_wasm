// Historical calibration tests exercise their original exact source pairs.
// Reconstruct the independently reviewed AY predecessor before earlier layers;
// the strict production proof still rejects changed bodies or dependencies.
import {relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {historicalCalibrationModule} from './historical_calibration_modules.mjs';
import {readPreHucTimedInput} from './historical_huc_timed_calibration_inputs.mjs';
const {restoreMixerCalibrationAyTimedRevision}=await historicalCalibrationModule('mixer_calibration_ay_timed_revision.mjs');
import {createHistoricalYm2608SourceMixReader} from './historical_ym2608_source_mix_fixture.mjs';
import {createHistoricalFm2612ApplicationReader} from './historical_fm2612_application_source_fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const reviewed = createHistoricalYm2608SourceMixReader(createHistoricalFm2612ApplicationReader(readPreHucTimedInput));
function predecessor(path) {
  const filename = path instanceof URL ? fileURLToPath(path) : resolve(String(path));
  const location = path instanceof URL ? path : new URL('file://' + filename);
  const prior = reviewed(location);
  return restoreMixerCalibrationAyTimedRevision(relative(root, filename).replaceAll('\\', '/'), prior, {readSource: reviewed});
}
const encoding = options => typeof options === 'string' ? options : options?.encoding;

export function readHistoricalAyTimedFileSync(path, options) {
  const bytes = predecessor(path);
  return encoding(options) ? bytes.toString(encoding(options)) : bytes;
}

export async function readHistoricalAyTimedFile(path, options) {
  const bytes = predecessor(path);
  return encoding(options) ? bytes.toString(encoding(options)) : bytes;
}
