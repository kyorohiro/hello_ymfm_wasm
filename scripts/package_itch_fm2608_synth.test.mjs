// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {packageFm2608Synth, validateFm2608SynthVersion, verifyFm2608SourceReceipt} from './package_itch_fm2608_synth.mjs';

const root = new URL('../', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('FM2608 package versions stay within the requested release directory', () => {
  for (const value of ['', '../escape', '/tmp/a', '.hidden', 'a/b', 'a\\b', 'a b', 'a;echo', 'x'.repeat(81)]) {
    assert.throws(() => validateFm2608SynthVersion(value));
  }
  for (const value of ['dev', '0.0.1', 'v1+test', '2026-11-15']) assert.equal(validateFm2608SynthVersion(value), value);
});

test('FM2608 package keeps readable modules, local assets and complete verified YM2608 sources', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'fm2608-synth-package-'));
  t.after(() => rm(temporary, {recursive:true, force:true}));
  const result = await packageFm2608Synth({version:'test', releaseDir:temporary});
  assert.match(result.archive, /tetorica_fm2608_synth_test_itch\.zip$/);
  assert(result.files < 1000);
  const archive = await readFile(result.archive);
  const info = JSON.parse(execFileSync('python3', ['-c', String.raw`
import hashlib,io,json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 names=z.namelist()
 assert all(not name.startswith('/') and '..' not in name.split('/') for name in names)
 receipt=json.loads(z.read('sources/fm2608-synth-browser.json'))
 source_bytes=z.read(receipt['sourceArchive']['path'])
 assert hashlib.sha256(source_bytes).hexdigest()==receipt['sourceArchive']['sha256']
 with zipfile.ZipFile(io.BytesIO(source_bytes)) as source:
  assert set(source.namelist())==set(item['path'] for item in receipt['originalInputs'])
  for item in receipt['originalInputs']:
   data=source.read(item['path'])
   assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256']
 print(json.dumps({'names':names,'receipt':receipt}))
`, result.archive], {encoding:'utf8'}));
  assert.equal(info.names.length, result.files);
  assert.equal(info.receipt.product, 'Tetorica FM2608 Synth');
  assert.equal(info.receipt.productId, 'tetorica-fm2608-synth');
  assert.equal(info.receipt.builder.name, 'source-copy');
  assert.equal(info.receipt.builder.minify, false);
  assert.equal(info.receipt.builder.bundle, false);
  assert.equal(info.receipt.builder.dependencyAnalyzer.name, 'esbuild');
  assert(!JSON.stringify(info.receipt).includes('/Users/'));
  for (const module of info.receipt.modules) {
    const bytes = await readFile(join(result.stage, module.path));
    assert.deepEqual(bytes, await readFile(new URL(module.sourcePath, root)), `${module.path} retains its authored source`);
    assert.equal(bytes.length, module.bytes);
    assert.equal(sha(bytes), module.sha256);
    for (const specifier of module.localImports) {
      const url = new URL(specifier, new URL(module.path, 'https://zip.invalid/'));
      assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))), `${module.path}: ${specifier}`);
    }
    for (const match of bytes.toString().matchAll(/new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g)) {
      const url = new URL(match[2], new URL(module.path, 'https://zip.invalid/'));
      if (url.origin === 'https://zip.invalid') {
        assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))), `${module.path}: ${match[2]}`);
      }
    }
  }
  for (const path of [
    'synth-fm2608/synth.js', 'synth-fm2608/audio.js', 'synth-fm2608/preset.js',
    'synth-fm2608/adpcm_encoder.js', 'synth-fm2608/adpcm_noteoff_guard.js',
    'synth-fm2608/code_host.js', 'synth-fm2608/song_compatibility.js',
    'synth-fm2608/code_files.js', 'synth-fm2608/vgm_presets.js',
    'synth-fm2608/output_mix.js',
    'synth/synth_code_controls.js', 'js/ym2608-worklet.js',
    'js/native-fx-worklet.js', 'js/native_audio_effect.wasm', 'js/tetorica_ym2608_adpcm_rom.bin',
    'playground/tetorica-playground-globals.d.ts', 'playground/tetorica-playground-ym2608.d.ts',
    'assets/opna-rhythm/LICENSE', 'assets/opna-rhythm/generate.mjs', 'assets/opna-rhythm/synthesis.mjs',
    'licenses/ymfm/LICENSE', 'licenses/tetorica-virtual-files/LICENSE',
    'sources/YM2608.json', 'sources/YM2608.md', 'sources/code-effects/README.md',
  ]) assert(info.names.includes(path), path);
  assert(info.receipt.modules.some(module => module.sourcePath === 'docs/synth-fm2608/song_compatibility.js'),
    'YM2203 compatibility is included through the readable application dependency graph');
  assert(!info.names.some(name => /(?:^|\/)ym2203_wasm\.(?:js|wasm)$/.test(name)),
    'Compatibility playback reuses YM2608 and adds no dedicated YM2203 loader or WASM');
  assert(!info.names.some(name => /\.(?:vgm|vgz|s98)$/i.test(name)),
    'Local game music used for verification stays outside the distribution');
  for (const name of ['ym2608_wasm.js', 'ym2608_wasm.wasm']) {
    assert.deepEqual(await readFile(join(result.stage, 'generated', name)),
      await readFile(new URL('tetorica_src/runtime/generated/' + name, root)));
  }
  const wasm = new WebAssembly.Module(await readFile(join(result.stage, 'generated/ym2608_wasm.wasm')));
  assert(WebAssembly.Module.exports(wasm).some(entry => entry.name === 'ym2608_set_output_gains' && entry.kind === 'function'),
    'The packaged WASM exposes the native output-gain setter used by Mixer');
  assert.deepEqual(await readFile(join(result.stage, 'tetorica_fm2608_synth.webp')),
    await readFile(new URL('docs/tetorica_fm2608_synth.webp', root)));
  const native = JSON.parse(await readFile(join(result.stage, 'sources/YM2608.json')));
  await verifyFm2608SourceReceipt(result.stage, native);
  const recipe = await readFile(join(result.stage, 'sources/ym2608-sdk/scripts/build_ym2608_wasm.sh'));
  assert.deepEqual(recipe, await readFile(new URL('third_party/tetorica-soundchip-native/scripts/build_ym2608_wasm.sh', root)));
  for (const name of ['index.html', 'synth-fm2608/index.html']) {
    const html = await readFile(join(result.stage, name), 'utf8');
    assert.match(html, /<title>Tetorica FM2608 Synth<\/title>/);
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = new URL(match[1], new URL(name, 'https://zip.invalid/'));
      if (url.origin === 'https://zip.invalid') assert(info.names.includes(url.pathname.slice(1)), `${name}: ${match[1]}`);
    }
  }
  const target = join(result.stage, 'sources/ym2608-sdk/wasm/ym2608_wasm.cpp');
  const original = await readFile(target);
  await writeFile(target, Buffer.concat([original, Buffer.from('\n// changed\n')]));
  await assert.rejects(verifyFm2608SourceReceipt(result.stage, native), /receipt mismatch/);
  await writeFile(target, original);
  const missing = structuredClone(native);
  missing.inputs = missing.inputs.filter(input => input.path !== 'sources/ym2608-sdk/wasm/ym2608_wasm.cpp');
  await assert.rejects(verifyFm2608SourceReceipt(result.stage, missing), /Incomplete/);
  const unsafe = structuredClone(native);
  unsafe.inputs[0].path = '../outside';
  await assert.rejects(verifyFm2608SourceReceipt(result.stage, unsafe), /Unsafe/);
  await assert.rejects(packageFm2608Synth({version:'test', releaseDir:temporary}), /already exists/);
  assert.deepEqual(await readFile(result.archive), archive);
});
