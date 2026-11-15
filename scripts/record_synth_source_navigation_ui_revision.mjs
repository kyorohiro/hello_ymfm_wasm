/** Review-time provenance for passive source navigation. */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {diffLines} from 'diff';
import {
  SYNTH_SOURCE_NAVIGATION_BASE_COMMIT as baseCommit,
  SYNTH_SOURCE_NAVIGATION_RECEIPT_PATH as destination,
  SYNTH_SOURCE_NAVIGATION_SOURCE_PATHS as paths,
  SYNTH_SOURCE_NAVIGATION_REPORT_PATHS as reports,
} from './mixer_calibration_synth_source_navigation_revision.mjs';
import {HUC6280_UI_REVISION_RECEIPT_PATH} from './mixer_calibration_huc6280_ui_revision.mjs';
import {restoreMixerCalibrationFm2608NavigationRevision} from './mixer_calibration_fm2608_navigation_revision.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const record = bytes => ({bytes:bytes.length, sha256:sha(bytes)});
const historical = path => execFileSync('git', ['show', `${baseCommit}:${path}`], {
  cwd:root, maxBuffer:4 * 1024 * 1024, stdio:['ignore', 'pipe', 'pipe'],
});
function reverseHunks(before, after) {
  const hunks = [];
  let offset = 0, pending;
  function flush() {
    if (!pending) return;
    hunks.push({afterOffset:pending.offset, afterBytes:Buffer.byteLength(pending.after), beforeText:pending.before});
    pending = undefined;
  }
  for (const part of diffLines(before.toString('utf8'), after.toString('utf8'))) {
    if (!part.added && !part.removed) { flush(); offset += Buffer.byteLength(part.value); continue; }
    pending ??= {offset, before:'', after:''};
    if (part.removed) pending.before += part.value;
    else { pending.after += part.value; offset += Buffer.byteLength(part.value); }
  }
  flush();
  const parts = [];
  let cursor = 0;
  for (const hunk of hunks) {
    parts.push(after.subarray(cursor, hunk.afterOffset), Buffer.from(hunk.beforeText));
    cursor = hunk.afterOffset + hunk.afterBytes;
  }
  parts.push(after.subarray(cursor));
  if (!Buffer.concat(parts).equals(before)) throw Error('Source reconstruction failed');
  return hunks;
}
export async function createSynthSourceNavigationReceipt() {
  const sources = {}, reportRecords = {};
  const prior = JSON.parse(await readFile(resolve(root, HUC6280_UI_REVISION_RECEIPT_PATH), 'utf8'));
  for (const path of reports) {
    const bytes = await readFile(resolve(root, path));
    if (!bytes.equals(historical(path))) throw Error('Original measurement changed: ' + path);
    reportRecords[path] = record(bytes);
  }
  for (const path of paths) {
    const before = historical('docs/' + path), after = restoreMixerCalibrationFm2608NavigationRevision(path,await readFile(resolve(root, 'docs/' + path)));
    if (JSON.stringify(record(before)) !== JSON.stringify(prior.sources[path].after)) throw Error('Detached passive UI predecessor: ' + path);
    if (before.equals(after) || !Buffer.from(after.toString('utf8')).equals(after)) throw Error('Expected one exact UTF-8 viewer revision: ' + path);
    sources[path] = {before:record(before), after:record(after), reverseHunks:reverseHunks(before, after)};
  }
  return {schemaVersion:1, scope:'synth-passive-implementation-source-navigation', baseCommit,
    review:'Exact passive S-DSP / FM2608 Code implementation targets, class-qualified source locations and one viewer cache query. Existing audio code, WASM, gain settings and historical captures retain their original bytes.',
    reports:reportRecords, sources};
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--write', '--check'].includes(args[0])) throw Error('Usage: node scripts/record_synth_source_navigation_ui_revision.mjs --write | --check');
  const receipt = await createSynthSourceNavigationReceipt(), text = JSON.stringify(receipt, null, 2) + '\n';
  if (args[0] === '--write') await writeFile(resolve(root, destination), text);
  else if (await readFile(resolve(root, destination), 'utf8') !== text) throw Error('Synth source-navigation receipt differs');
  console.log(`${args[0]}: ${Object.keys(receipt.sources).length} passive source pairs; object SHA256 ${sha(JSON.stringify(receipt))}`);
}
