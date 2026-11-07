// SPDX-License-Identifier: BSD-3-Clause
// Isolated research artifacts. Never sync this candidate into a product/SDK.
import assert from 'node:assert/strict';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
export const probeRoot = fileURLToPath(new URL('../', import.meta.url));
export const digest = b => ({bytes:b.length, sha256:createHash('sha256').update(b).digest('hex')});
export async function probeSourceRecords() {
  const vendor = resolve(probeRoot, 'third_party/sidera');
  const pin = JSON.parse(await readFile(resolve(vendor, 'SOURCES.json')));
  const patches = JSON.parse(await readFile(resolve(vendor, 'PATCHES.json')));
  const records = {};
  for (const [name, expected] of Object.entries(pin.files)) {
    const path = `third_party/sidera/upstream/${name}`;
    records[path] = digest(await readFile(resolve(probeRoot, path)));
    assert.deepEqual(records[path], expected, `Original sidera source changed: ${name}`);
    if (!name.startsWith('src/')) continue;
    const adapted = `third_party/sidera/adapted/${name}`;
    records[adapted] = digest(await readFile(resolve(probeRoot, adapted)));
    assert.deepEqual(records[adapted], patches.files[name]?.after ?? expected, `Unrecorded adaptation: ${name}`);
    if (patches.files[name]) assert.deepEqual(patches.files[name].before, expected);
  }
  const files = ['LICENSE', 'third_party/sidera/LICENSE', 'third_party/sidera/SOURCES.json',
    'third_party/sidera/PATCHES.json', 'third_party/sidera/README.md',
    'tetorica_src/wasm/sid8580-probe/lib.rs', 'tetorica_src/wasm/sid8580-probe/native.rs',
    'scripts/build_sid8580_probe.sh', 'scripts/sid8580_probe_artifacts.mjs'];
  for (const name of files) records[name] = digest(await readFile(resolve(probeRoot, name)));
  // Include Rust's complete adapted module tree; unexpected sources cannot be
  // silently added to the compilation outside the original/patched inventory.
  async function walk(directory, prefix = '') {
    for (const e of await readdir(directory, {withFileTypes:true})) {
      const name = prefix + e.name;
      if (e.isDirectory()) await walk(resolve(directory,e.name),name+'/');
      else {assert(e.isFile()); assert(Object.hasOwn(pin.files,'src/'+name),`Unexpected adapted file ${name}`);}
    }
  }
  await walk(resolve(vendor,'adapted/src'));
  return Object.fromEntries(Object.entries(records).sort(([a],[b]) => a.localeCompare(b)));
}
export async function probeReceipt(workDir, {check = false} = {}) {
  const inputs = await probeSourceRecords();
  const compiler = execFileSync(process.env.RUSTC || 'rustc',['--version','--verbose'],{encoding:'utf8'}).trim();
  const outputs = {};
  for (const name of ['sid8580-probe.wasm', 'sid8580-probe']) outputs[name] = digest(await readFile(resolve(workDir,name)));
  const current = {format:'tetorica-sid8580-research-build',version:1,
    production:false,upstream:'sidera 1.1.1',license:'MIT upstream; BSD-3-Clause wrapper',
    compiler,profile:{edition:'2021',optimization:3,panic:'abort',codegenUnits:1,remappedSourceRoot:'tetorica'},
    wasmTarget:'wasm32-unknown-unknown',runtimeDependencies:[],inputs,outputs};
  const receiptPath=resolve(workDir,'sid8580-probe-build.json');
  if (check) assert.deepEqual(JSON.parse(await readFile(receiptPath)),current,'Stale probe build');
  else await writeFile(receiptPath,JSON.stringify(current,null,2)+'\n');
  return current;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, dir] = process.argv.slice(2);
  assert(['--sources','--record','--check'].includes(mode),'Expected --sources or --record/--check WORK_DIR');
  if (mode === '--sources') console.log(`SID8580 source inputs verified: ${Object.keys(await probeSourceRecords()).length}`);
  else {assert(dir); await probeReceipt(resolve(dir),{check:mode==='--check'}); console.log(`SID8580 isolated probe ${mode.slice(2)} passed: ${relative(probeRoot,resolve(dir))}`);}
}
