// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {packageSidSynth, validateSidSynthVersion} from './package_itch_sid_synth.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
test('SID package version is confined to its selected release directory', () => {
  for (const value of ['', '../escape', '/tmp/a', '.hidden', 'a/b', 'a\\b', 'a b', 'a;echo', 'x'.repeat(81)]) assert.throws(() => validateSidSynthVersion(value));
  for (const value of ['dev', 'v0.0.1', 'local+test']) assert.equal(validateSidSynthVersion(value), value);
});

test('SID ZIP preserves editable modules, independent entry points and matching source provenance', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sid-synth-package-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const a = await packageSidSynth({version:'test', releaseDir:join(directory, 'a')});
  const b = await packageSidSynth({version:'test', releaseDir:join(directory, 'b')});
  assert.deepEqual(await readFile(a.archive), await readFile(b.archive));
  assert(a.files < 1000); assert.equal(a.bundles, 3);
  const info = JSON.parse(execFileSync('python3', ['-c', String.raw`
import json,sys,zipfile,io,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert all(not name.startswith('/') and '..' not in name.split('/') for name in z.namelist())
 r=json.loads(z.read('sources/sid-synth-browser.json'));src=z.read(r['sourceArchive']['path'])
 assert hashlib.sha256(src).hexdigest()==r['sourceArchive']['sha256']
 with zipfile.ZipFile(io.BytesIO(src)) as s:
  assert set(s.namelist())==set(i['path'] for i in r['originalInputs'])
  for i in r['originalInputs']:
   b=s.read(i['path']);assert len(b)==i['bytes'] and hashlib.sha256(b).hexdigest()==i['sha256']
 print(json.dumps({'names':z.namelist(),'receipt':r}))
`, a.archive], {encoding:'utf8'}));
  assert.equal(info.names.length, a.files);
  assert(!JSON.stringify(info.receipt).includes('/Users/'));
  assert.equal(info.receipt.product, 'Tetorica SID Synth');
  assert.equal(info.receipt.productId, 'tetorica-sid-synth');
  assert.deepEqual(await readFile(join(a.stage, 'generated/sid/sid.wasm')), await readFile(new URL('../tetorica_src/runtime/generated/sid/sid.wasm', import.meta.url)));
  const native = JSON.parse(await readFile(join(a.stage, 'generated/sid/sid-build.json')));
  for (const [path, input] of Object.entries(native.inputs)) {
    const bytes = await readFile(join(a.stage, 'sources/sid', path));
    assert.equal(bytes.length, input.bytes); assert.equal(sha(bytes), input.sha256, path);
  }
  assert.equal(sha(await readFile(join(a.stage, 'generated/sid/sid.wasm'))), native.output.sha256);
  assert.equal(info.receipt.builder.minify, false); assert.equal(info.receipt.builder.bundle, false);
  assert(info.receipt.modules.length > info.receipt.bundles.length);
  for (const module of info.receipt.modules) {
    const bytes = await readFile(join(a.stage, module.path));
    assert.deepEqual(bytes, await readFile(new URL('../' + module.sourcePath, import.meta.url)));
    assert.equal(bytes.length, module.bytes); assert.equal(sha(bytes), module.sha256);
    for (const spec of module.localImports) {
      const url = new URL(spec, new URL(module.path, 'https://zip.invalid/'));
      assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))), `${module.path}: ${spec}`);
    }
    for (const match of bytes.toString().matchAll(/new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g)) {
      const url = new URL(match[2], new URL(module.path, 'https://zip.invalid/'));
      if (url.origin === 'https://zip.invalid') assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))), `${module.path}: ${match[2]}`);
    }
  }
  for (const entry of ['index.html', 'synth-sid/index.html']) {
    const html = await readFile(join(a.stage, entry), 'utf8');
    assert.match(html, /<title>Tetorica SID Synth<\/title>/);
    assert.match(html, /rel="icon" href="(?:\.\.\/|\.\/)playground-favicon\.ico"/);
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = new URL(match[1], new URL(entry, 'https://zip.invalid/'));
      if (url.origin === 'https://zip.invalid') assert(info.names.includes(url.pathname.slice(1)), `${entry}: ${match[1]}`);
    }
  }
  assert.match(await readFile(join(a.stage, 'licenses/chips-m6581/LICENSE'), 'utf8'), /zlib\/libpng/);
  const original = await readFile(a.archive);
  await assert.rejects(packageSidSynth({version:'test', releaseDir:join(directory, 'a')}), /already exists/);
  assert.deepEqual(await readFile(a.archive), original);
});
