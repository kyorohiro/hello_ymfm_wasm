/** Compare the current SDK state layout using the reviewed YM2608 checker. */
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {ym2608OutputGainDefaultChecker} from './check_ym2608_output_gain_defaults.mjs';

/** Both current builds carry the two serialized output gains at unity.
 * Reuse the existing state adaptation, including its exact gain assertions,
 * then compare the complete current export lists with each other.
 * @param {string} source Original YM2608 differential checker.
 */
export function currentYm2608SdkChecker(source) {
  const adapted = ym2608OutputGainDefaultChecker(source);
  const previous = "assert.equal(sdk.metadata.exports.filter(entry=>entry.name==='ym2608_set_output_gains').length,1);assert.deepEqual(sdk.metadata.exports.filter(entry=>entry.name!=='ym2608_set_output_gains'),legacy.metadata.exports,'Only the output-gain setter is added');";
  if (!adapted.includes(previous) || adapted.indexOf(previous) !== adapted.lastIndexOf(previous)) {
    throw new Error('YM2608 default-gain checker export comparison changed');
  }
  const current = `for(const build of [legacy,sdk]) {
    assert.equal(build.metadata.exports.filter(entry=>entry.name==='ym2608_set_output_gains').length,1,'Current YM2608 output-gain export');
  }
  assert.deepEqual(sdk.metadata.exports,legacy.metadata.exports,'Current YM2608 export surface unchanged');`;
  return adapted.replace(previous, current);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = resolve(root, 'build', `ym2608-current-checker-${randomUUID()}.mjs`);
  await mkdir(dirname(output), {recursive: true});
  try {
    const source = await readFile(new URL('./check_ym2608_wasm_sdk.mjs', import.meta.url), 'utf8');
    await writeFile(output, currentYm2608SdkChecker(source), {flag: 'wx'});
    execFileSync(process.execPath, [output, ...process.argv.slice(2)], {cwd: root, stdio: 'inherit'});
  } finally {
    await rm(output, {force: true});
  }
}
