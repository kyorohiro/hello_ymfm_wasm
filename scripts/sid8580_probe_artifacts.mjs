// SPDX-License-Identifier: BSD-3-Clause
// Isolated research artifacts. Never sync this candidate into a product/SDK.
import assert from 'node:assert/strict';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,realpathSync} from 'node:fs';
import {resolve, relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export const probeRoot = fileURLToPath(new URL('../', import.meta.url));
export const digest = b => ({bytes:b.length, sha256:createHash('sha256').update(b).digest('hex')});
export function probeWasmCCompiler(){
  const explicit=process.env.SID8_WASM_CC;
  const candidates=[explicit||'clang'];
  if(!explicit){
    // Apple's clang omits the WebAssembly backend. Reuse the actual LLVM
    // compiler installed with Emscripten, without invoking its runtime/cache.
    try{
      const emcc=realpathSync(execFileSync('which',['emcc'],{encoding:'utf8'}).trim());
      candidates.push(resolve(dirname(emcc),'../libexec/llvm/bin/clang'),resolve(dirname(emcc),'../bin/clang'));
    }catch{}
  }
  for(const command of candidates){
    if(command.includes('/')&&!existsSync(command))continue;
    try{if(/\bwasm32\b/.test(execFileSync(command,['--print-targets'],{encoding:'utf8'})))return command;}catch{}
  }
  throw Error('A clang with a WebAssembly backend is required; set SID8_WASM_CC to its executable');
}
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
    'tetorica_src/wasm/sid8580-probe/cpu_bridge.c', 'tetorica_src/wasm/sid8580-probe/cpu.rs',
    'tetorica_src/wasm/sid8580-probe/cpu_native.rs',
    'third_party/chips-m6502/upstream/m6502.h', 'third_party/chips-m6502/LICENSE', 'third_party/chips-m6502/README.md',
    'scripts/build_sid8580_probe.sh', 'scripts/sid8580_probe_artifacts.mjs'];
  for (const name of files) records[name] = digest(await readFile(resolve(probeRoot, name)));
  assert.equal(records['third_party/chips-m6502/upstream/m6502.h'].sha256,'b3fc32a01f1f7cdc62f919ccba06cc20c2a333e7ca30c38189e31aa65868d46e','Pinned CPU changed');
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
  for (const name of ['sid8580-probe.wasm', 'sid8580-probe','sid8580-cpu.wasm','sid8580-cpu']) outputs[name] = digest(await readFile(resolve(workDir,name)));
  const cCompilers={};
  for(const [name,command] of [['native',process.env.CC||'clang'],['wasm',probeWasmCCompiler()]])
    cCompilers[name]={command,version:execFileSync(command,['--version'],{encoding:'utf8'}).trim()};
  const current = {format:'tetorica-sid8580-research-build',version:2,
    production:false,upstream:'sidera 1.1.1',license:'MIT upstream; BSD-3-Clause wrapper',
    compiler,cCompilers,profile:{edition:'2021',optimization:3,panic:'abort',codegenUnits:1,remappedSourceRoot:'tetorica',cFlags:['-std=c11','-O2','-ffreestanding'],wasmCTarget:'wasm32-unknown-unknown'},
    wasmTarget:'wasm32-unknown-unknown',runtimeDependencies:[],inputs,outputs};
  const receiptPath=resolve(workDir,'sid8580-probe-build.json');
  if (check) assert.deepEqual(JSON.parse(await readFile(receiptPath)),current,'Stale probe build');
  else await writeFile(receiptPath,JSON.stringify(current,null,2)+'\n');
  return current;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, dir] = process.argv.slice(2);
  assert(['--wasm-cc','--sources','--record','--check'].includes(mode),'Expected --wasm-cc, --sources or --record/--check WORK_DIR');
  if(mode==='--wasm-cc')console.log(probeWasmCCompiler());
  else if (mode === '--sources') console.log(`SID8580 source inputs verified: ${Object.keys(await probeSourceRecords()).length}`);
  else {assert(dir); await probeReceipt(resolve(dir),{check:mode==='--check'}); console.log(`SID8580 isolated probe ${mode.slice(2)} passed: ${relative(probeRoot,resolve(dir))}`);}
}
