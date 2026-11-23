// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { unzipSync } from '../docs/playground/vendor/fflate.js';
import { packageSm5xxSynth } from './package_itch_sm5xx_synth.mjs';

const root = new URL('../', import.meta.url);
const app = 'synth-lcd-buzzer';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('SM5xx itch.io HTML and editable source archives use the same browser resources', async t => {
	const releaseDir = await mkdtemp(join(tmpdir(), 'tetorica-sm5xx-itch-test-'));
	t.after(() => rm(releaseDir, { recursive: true, force: true }));
	const options = { releaseDir, version: 'test' };
	const archives = await packageSm5xxSynth(options);
	const [htmlBytes, sourceBytes, checksums] = await Promise.all([
		readFile(archives.html), readFile(archives.source), readFile(archives.checksums, 'utf8'),
	]);
	assert.equal(checksums, `${hash(htmlBytes)}  ${basename(archives.html)}\n${hash(sourceBytes)}  ${basename(archives.source)}\n`);
	assert.equal(basename(archives.html), 'tetorica-sm5xx-synth-html.zip');
	assert.equal(basename(archives.source), 'tetorica-sm5xx-synth-source.zip');
	await assert.rejects(packageSm5xxSynth(options), /already exists/);
	await assert.rejects(packageSm5xxSynth({ ...options, version: '../outside' }), /Invalid package version/);
	assert.deepEqual(await readFile(archives.html), htmlBytes);
	assert.deepEqual(await readFile(archives.source), sourceBytes);
	const html = unzipSync(htmlBytes), source = unzipSync(sourceBytes);
	assert(Object.keys(html).length <= 1000);
	assert(Object.keys(html).every(path => !path.endsWith('/')));
	const entry = new TextDecoder().decode(html['index.html']);
	assert(entry.includes(`href="./${app}/icon.png"`));
	assert(entry.includes(`href="./${app}/synth.css"`));
	assert(entry.includes(`src="./${app}/synth.js"`));
	assert(html[`${app}/index.html`]);
	for (const [path, bytes] of Object.entries(html)) {
		if (/\.(?:css|js|wasm|png|d\.ts)$/.test(path)) assert.deepEqual(bytes, source[`docs/${path}`], path);
	}
	for (const path of [
		'LICENSE', 'packages/virtual-files/LICENSE', 'docs/playground/vendor/fflate-LICENSE',
		`docs/${app}/index.html`, `docs/${app}/README.md`, 'scripts/build_sm510.sh',
		'tetorica_src/native/sm510/sm510.cpp', 'tetorica_src/native/sm510/sm510.h', 'tetorica_src/native/sm510/sm511.cpp',
	]) assert.deepEqual(Buffer.from(source[path]), await readFile(new URL(path, root)), path);
	const browser = join(releaseDir, 'verified-browser');
	execFileSync('python3', ['-m', 'zipfile', '-e', archives.html, browser]);
	const dependencyCheck = execFileSync(process.execPath, [
		'--experimental-vm-modules', 'scripts/check_synth_package.mjs', browser,
	], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	assert.match(dependencyCheck, /PASS: \d+ local Synth module\/asset references/);
});
