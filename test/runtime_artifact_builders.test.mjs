// Exercise application build wrappers with recording compilers in a disposable
// checkout. These tests verify routing and isolation, not sound synthesis.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';

const root = resolve(import.meta.dirname, '..');
const wrappers = (await readdir(join(root, 'scripts')))
  .filter(name => /^build_.*_wasm\.sh$/.test(name) && name !== 'build_opn_variant_wasm.sh');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const nativeEffectSources = ['sample', 'noise', 'gain', 'reverb', 'compressor', 'noise_gate', 'eq', 'graph', 'extra_fx']
  .map(name => 'tetorica_src/native/audio_effect/' + name + '.c');
const comparisonSources = ['tetorica_src/wasm/opn_variant_wasm.cpp',
  'src/ymfm_opn.cpp', 'src/ymfm_adpcm.cpp', 'src/ymfm_ssg.cpp'];

async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'tetorica builder contract '));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const checkout = join(temporary, 'checkout with spaces');
  const sdk = join(checkout, 'third_party/tetorica-soundchip-native');
  const caller = join(temporary, 'external caller');
  const tools = join(temporary, 'tools');
  for (const path of ['scripts', 'third_party/tetorica-soundchip-native/scripts'])
    await mkdir(join(checkout, path), {recursive: true});
  await mkdir(caller); await mkdir(tools);
  for (const name of [...wrappers, 'build_native_audio_effect.sh', 'build_opn_variant_wasm.sh'])
    await copyFile(join(root, 'scripts', name), join(checkout, 'scripts', name));
  await writeFile(join(checkout, 'scripts/import_soundchip_sdk.py'), '# Stub: real pinned-source validation has separate offline SDK tests.\n');
  const sdkBuild = `#!/bin/sh
set -eu
if [ "\${FAIL_COMPILER:-0}" = 1 ]; then exit 23; fi
# Match the immutable SDK dispatcher: resolve outputs after changing to its
# own root. Application wrappers must normalize caller-relative paths first.
cd "$(dirname "$0")/.."
mkdir -p "$2"
if [ "$1" = dx7 ]; then
  printf '%s' "$1" > "$2/msfa.wasm"
else
  printf '%s' "$1" > "$2/\${1}_wasm.js"
  printf '%s' "$1" > "$2/\${1}_wasm.wasm"
fi
printf '%s' "$1" > "$2/build-info.json"
`;
  await writeFile(join(sdk, 'scripts/build-wasm.sh'), sdkBuild);
  await writeFile(join(checkout, 'scripts/sync_runtime_artifacts.mjs'), `
import {readFile, appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
assert.equal(process.argv[2], '--only');
const id = process.argv[3];
const output = id === 'native_audio_effect' ? 'effects/gain.wasm' : id === 'dx7' ? 'msfa.wasm' : id + '_wasm.wasm';
await readFile(resolve(root, 'tetorica_src/runtime/generated', output));
if(id === 'ps1_spu') {
  const receipt = JSON.parse(await readFile(resolve(root, 'tetorica_src/runtime/generated/ps1_spu_build.json')));
  assert.equal(receipt.fixedSdkArtifact, true);
}
await appendFile(resolve(root, 'sync-calls.jsonl'), JSON.stringify({id, args:process.argv.slice(2)}) + '\\n');
if(process.env.FAIL_SYNC === '1') process.exit(24);
`);
  const compiler = `#!/usr/bin/env node
import {appendFileSync, accessSync, writeFileSync} from 'node:fs';
if(process.env.FAIL_COMPILER === '1') process.exit(23);
const args = process.argv.slice(2);
for (const arg of args) if (/\\.(c|cpp)$/.test(arg)) accessSync(arg);
appendFileSync(process.env.BUILDER_COMPILER_LOG, JSON.stringify({cwd: process.cwd(), args}) + '\\n');
writeFileSync(args[args.indexOf('-o') + 1], 'recorded standalone output');
`;
  // .mjs makes this independent of the disposable checkout's package type.
  await writeFile(join(tools, 'compiler.mjs'), compiler);
  await writeFile(join(tools, 'emcc'), '#!/bin/sh\nexec node "$(dirname "$0")/compiler.mjs" "$@"\n');
  await writeFile(join(tools, 'em++'), '#!/bin/sh\nexec node "$(dirname "$0")/compiler.mjs" "$@"\n');
  for (const name of ['emcc', 'em++']) await chmod(join(tools, name), 0o755);
  // The application sources move; ymfm's upstream src/ stays at the root.
  // Require real paths in the recording compiler so a stale build route fails.
  for (const path of [...nativeEffectSources, ...comparisonSources]) {
    await mkdir(resolve(checkout, path, '..'), {recursive: true});
    await writeFile(join(checkout, path), '// source routing fixture');
  }
  // Minimal authenticated input closure for the application-specific PS1
  // receipt. No fixed SDK files or generated assets in the real repo are used.
  const files = {
    LICENSE: 'test license', 'sdk.json': '{}',
    'catalog/source_inventory.json': '{}',
    'native/include/tetorica/ps1_spu.h': '// test header',
    'scripts/build_ps1_spu_wasm.sh': '// test recipe',
    'scripts/build-wasm.sh': sdkBuild,
    'scripts/record_wasm_build.mjs': '// test recorder',
    'vendor/mame-ps1-spu/upstream/REVISION': 'recorded-test-revision',
  };
  const records = {};
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(resolve(sdk, path, '..'), {recursive: true});
    await writeFile(join(sdk, path), bytes);
    records[path] = {size: Buffer.byteLength(bytes), sha256: sha(bytes)};
  }
  const manifest = JSON.stringify({files: records});
  await writeFile(join(sdk, 'RELEASE-MANIFEST.json'), manifest);
  await writeFile(join(checkout, 'third_party/soundchip-sdk.json'), JSON.stringify({version: 'test', manifestSha256: sha(manifest)}));
  return {
    checkout, caller,
    run(name, args = [], env = {}) {
      return spawnSync('sh', [join(checkout, 'scripts', name), ...args], {
        cwd: caller, encoding: 'utf8',
        env: {...process.env, PATH: tools + ':' + process.env.PATH,
          BUILDER_COMPILER_LOG: join(checkout, 'compiler-calls.jsonl'), ...env},
      });
    },
    async calls() {
      return (await readFile(join(checkout, 'sync-calls.jsonl'), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return ''; throw error;
      })).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    },
    async compilerCalls() {
      return (await readFile(join(checkout, 'compiler-calls.jsonl'), 'utf8'))
        .trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    },
  };
}

test('all normal chip builders publish from canonical assets, after receipts are ready', async t => {
  const f = await fixture(t);
  for (const name of [...wrappers, 'build_native_audio_effect.sh']) {
    const result = f.run(name);
    assert.equal(result.status, 0, name + '\n' + result.stdout + result.stderr);
  }
  const expected = [...wrappers.map(name => name.slice(6, -8)), 'native_audio_effect'];
  assert.deepEqual((await f.calls()).map(call => call.id), expected);
  assert.equal((await readFile(join(f.checkout, 'tetorica_src/runtime/generated/effects/gain.wasm'), 'utf8')), 'recorded standalone output');
  assert.deepEqual((await f.compilerCalls())[0].args.filter(arg => arg.endsWith('.c')),
    nativeEffectSources.map(path => join(f.checkout, path)));
  await assert.rejects(readdir(join(f.checkout, 'native')), {code: 'ENOENT'});
});

test('every explicit custom output remains outside canonical artifacts and mirrors', async t => {
  const f = await fixture(t);
  for (const name of [...wrappers, 'build_native_audio_effect.sh']) {
    const result = f.run(name, ['relative custom output/' + name]);
    assert.equal(result.status, 0, name + '\n' + result.stdout + result.stderr);
    const id = name.slice(6, -8);
    const output = name === 'build_native_audio_effect.sh' ? 'gain.wasm'
      : id === 'dx7' ? 'msfa.wasm' : id + '_wasm.wasm';
    await readFile(join(f.caller, 'relative custom output', name, output));
  }
  assert.deepEqual(await f.calls(), []);
  await assert.rejects(readdir(join(f.checkout, 'tetorica_src/runtime')), {code: 'ENOENT'});
  await assert.rejects(readdir(join(f.checkout, 'docs')), {code: 'ENOENT'});
  await assert.rejects(readdir(join(f.checkout, 'third_party/tetorica-soundchip-native/relative custom output')), {code: 'ENOENT'});
});

test('failed builds skip publication and publication failures fail the wrapper', async t => {
  const f = await fixture(t);
  for (const name of [...wrappers, 'build_native_audio_effect.sh']) {
    const failed = f.run(name, [], {FAIL_COMPILER: '1'});
    assert.equal(failed.status, 23, name + '\n' + failed.stdout + failed.stderr);
  }
  assert.deepEqual(await f.calls(), []);
  const failed = f.run('build_ym2612_wasm.sh', [], {FAIL_SYNC: '1'});
  assert.equal(failed.status, 24, failed.stdout + failed.stderr);
  assert.deepEqual((await f.calls()).map(call => call.id), ['ym2612']);
});

test('legacy OPN default delegates to SDK; local comparisons cannot overwrite canonical assets', async t => {
  const f = await fixture(t);
  for (const id of ['ym3438', 'ymf276', 'ymf288']) {
    const result = f.run('build_opn_variant_wasm.sh', [id]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  assert.deepEqual((await f.calls()).map(call => call.id), ['ym3438', 'ymf276', 'ymf288']);
  for (const path of ['tetorica_src/runtime/generated', 'docs/generated']) {
    const result = f.run('build_opn_variant_wasm.sh', ['ym3438', join(f.checkout, path)]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot overwrite published SDK artifacts/);
  }
  const alias = join(f.caller, 'canonical alias');
  await symlink(join(f.checkout, 'tetorica_src/runtime/generated'), alias, 'dir');
  const aliased = f.run('build_opn_variant_wasm.sh', ['ym3438', alias]);
  assert.notEqual(aliased.status, 0);
  assert.match(aliased.stderr, /cannot overwrite published SDK artifacts/);
  const local = f.run('build_opn_variant_wasm.sh', ['ym3438', 'isolated local comparison']);
  assert.equal(local.status, 0, local.stdout + local.stderr);
  assert.equal(await readFile(join(f.caller, 'isolated local comparison/ym3438_wasm.js'), 'utf8'), 'recorded standalone output');
  assert.equal((await f.calls()).length, 3);
  const compilerCall = (await f.compilerCalls())[0];
  assert.equal(compilerCall.cwd, await realpath(f.checkout));
  assert.ok(compilerCall.args.includes('-Isrc'));
  assert.deepEqual(compilerCall.args.filter(arg => arg.endsWith('.cpp')), comparisonSources);
  await assert.rejects(readdir(join(f.checkout, 'wasm')), {code: 'ENOENT'});
});
