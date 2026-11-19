// Test-only CLI for immutable historical SCSP receipts. Production reads stay live.
import {fileURLToPath} from 'node:url';
import {historicalCalibrationModule} from './historical_calibration_modules.mjs';
const [script,mode,...extra]=process.argv.slice(2);
if(!/^scripts\/(?:record_scsp_[a-z0-9_]+|record_playground_scsp_cycle2_examples_revision)\.mjs$/.test(script??'')||mode!=='--check'||extra.length)
 throw Error('Usage: node test/helpers/check_historical_calibration_receipt.mjs scripts/record_scsp_*.mjs --check');
process.argv=[process.argv[0],fileURLToPath(new URL('../../'+script,import.meta.url)),'--check'];
await historicalCalibrationModule(script.slice('scripts/'.length));
