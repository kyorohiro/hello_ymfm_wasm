// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { unzipSync } from '../docs/playground/vendor/fflate.js';
import { packageFm2610Synth } from './package_itch_fm2610_synth.mjs';

const root = new URL('../', import.meta.url);
const text = value => new TextDecoder().decode(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const app = 'synth-fm2610';
const sdk = 'third_party/tetorica-soundchip-native';

test('FM2610 produces self-contained HTML and matching source ZIPs', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'fm2610-package-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await assert.rejects(packageFm2610Synth({ version: '../invalid', releaseDir: temporary }), /Invalid package version/);
  const artifacts = await packageFm2610Synth({ version: 'test', releaseDir: temporary });
  await assert.rejects(packageFm2610Synth({ version: 'test', releaseDir: temporary }), /already exists/);
  const again = await packageFm2610Synth({ version: 'test', releaseDir: join(temporary, 'again') });
  const [htmlBytes, sourceBytes, checksums] = await Promise.all([
    readFile(artifacts.html), readFile(artifacts.source), readFile(artifacts.checksums, 'utf8'),
  ]);
  assert.equal(basename(artifacts.html), 'tetorica-fm2610-synth-html.zip');
  assert.equal(basename(artifacts.source), 'tetorica-fm2610-synth-source.zip');
  assert.equal(checksums, `${hash(htmlBytes)}  ${basename(artifacts.html)}\n${hash(sourceBytes)}  ${basename(artifacts.source)}\n`);
  assert.deepEqual(await readFile(again.html), htmlBytes);
  assert.deepEqual(await readFile(again.source), sourceBytes);

  const html = unzipSync(htmlBytes), source = unzipSync(sourceBytes);
  assert.match(text(html['index.html']), /src="\.\/synth-fm2610\/synth\.js"/);
  assert.match(text(html['index.html']), /href="\.\/synth-fm2610\/synth\.css"/);
  assert.match(text(html['index.html']), /src="\.\/tetorica_fm2610_synth\.webp"/);
  assert.match(text(html[`${app}/index.html`]), /src="\.\/synth\.js"/);
  for (const [path, bytes] of Object.entries(html)) {
    if (/\.(?:css|js|d\.ts|wasm|webp)$/.test(path)) assert.deepEqual(bytes, source[`docs/${path}`], path);
  }

  const appFiles = await readdir(new URL(`docs/${app}/`, root));
  const workers = appFiles.filter(name => /[-_]worker\.js$/.test(name));
  for (const path of [
    ...workers.map(name => `${app}/${name}`),
    'js/ym2610b-worklet.js', 'js/vgm-output-worklet.js', 'js/native-fx-worklet.js',
    'generated/ym2610b_wasm.js', 'generated/ym2610b_wasm.wasm', 'js/native_audio_effect.wasm',
    'tetorica_fm2610_synth.webp', 'LICENSE', 'licenses/ymfm/LICENSE', 'licenses/tetorica-soundchip-native/LICENSE',
    'playground/vendor/fflate-LICENSE', 'licenses/tetorica-virtual-files/LICENSE',
    'synth-fm2610/code_declarations.js', 'synth-fm2610/code_editor.js',
    'playground/playground_monaco.js', 'playground/tetorica-playground-globals.d.ts',
  ]) assert(html[path], path);
  for (const path of [
    `docs/${app}/index.html`, `${sdk}/wasm/ym2610b_wasm.cpp`, `${sdk}/wasm/opn_state.h`,
    ...appFiles.filter(name => name.endsWith('.test.mjs')).map(name => `docs/${app}/${name}`),
    `${sdk}/vendor/ymfm/ymfm_opn.cpp`, `${sdk}/vendor/ymfm/LICENSE`, `${sdk}/scripts/build_ym2610b_wasm.sh`,
    'tetorica_src/native/audio_effect/graph.c', 'scripts/build_native_audio_effect.sh',
  ]) assert.deepEqual(Buffer.from(source[path]), await readFile(new URL(path, root)), path);
  for (const path of [...Object.keys(html), ...Object.keys(source)]) {
    assert(!/\.(?:vgm|vgz)$/i.test(path) && !path.startsWith('ww/'), path);
  }

  const browser = join(temporary, 'browser');
  execFileSync('python3', ['-m', 'zipfile', '-e', artifacts.html, browser]);
  const check = execFileSync(process.execPath, [
    '--experimental-vm-modules', fileURLToPath(new URL('./check_synth_package.mjs', import.meta.url)), browser,
  ], { encoding: 'utf8' });
  assert.match(check, /PASS: \d+ local Synth module\/asset references/);
});
