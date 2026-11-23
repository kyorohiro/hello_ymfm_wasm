// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, posix } from 'node:path';
import test from 'node:test';
import { unzipSync } from '../docs/playground/vendor/fflate.js';
import { packageVsuSynth } from './package_itch_vsu_synth.mjs';

const root = new URL('../', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const text = bytes => new TextDecoder().decode(bytes);

test('VSU playable and source ZIPs contain the same editable browser assets', async t => {
	const releaseDir = await mkdtemp(join(tmpdir(), 'tetorica-vsu-itch-test-'));
	t.after(() => rm(releaseDir, { recursive: true, force: true }));
	const options = { releaseDir, version: 'test' };
	const artifacts = await packageVsuSynth(options);
	const [htmlBytes, sourceBytes, checksums] = await Promise.all([
		readFile(artifacts.html), readFile(artifacts.source), readFile(artifacts.checksums, 'utf8'),
	]);
	assert.equal(basename(artifacts.html), 'tetorica-vsu-synth-html.zip');
	assert.equal(basename(artifacts.source), 'tetorica-vsu-synth-source.zip');
	assert.equal(checksums, `${hash(htmlBytes)}  ${basename(artifacts.html)}\n${hash(sourceBytes)}  ${basename(artifacts.source)}\n`);
	await assert.rejects(packageVsuSynth(options), /already exists/);
	await assert.rejects(packageVsuSynth({ ...options, version: '../outside' }), /Invalid package version/);
	assert.deepEqual(await readFile(artifacts.html), htmlBytes);
	assert.deepEqual(await readFile(artifacts.source), sourceBytes);

	const html = unzipSync(htmlBytes), source = unzipSync(sourceBytes);
	assert(Object.keys(html).length <= 1000);
	for (const path of ['index.html', 'synth-vsu/index.html']) {
		const page = text(html[path]);
		assert.match(page, /<title>Tetorica VSU Synth<\/title>/);
		assert.match(page, /href="https:\/\/kyorohiro\.github\.io\/hello_ymfm_wasm\/"/);
		for (const [, link] of page.matchAll(/\b(?:src|href)="(\.[^"]+)"/g)) {
			const member = posix.join(posix.dirname(path), link.split(/[?#]/)[0]);
			assert(html[member], `${path} references ${member}`);
		}
	}
	for (const [path, bytes] of Object.entries(html)) {
		if (/\.(?:css|js|wasm|webp)$/.test(path)) assert.deepEqual(bytes, source[`docs/${path}`], path);
	}
	for (const path of [
		'synth-vsu/worklet.js', 'synth-vsu/vgm-presets-worker.js', 'synth-vsu/vgm-seek-worker.js',
		'synth-vsu/vsu.wasm', 'synth-vsu/files.css', 'playground/vendor/fflate.js', 'tetorica_vsu_synth.webp',
		'LICENSE', 'licenses/tetorica-virtual-files/LICENSE', 'playground/vendor/fflate-LICENSE',
	]) assert(html[path], path);
	for (const path of [
		'LICENSE', 'packages/virtual-files/LICENSE', 'docs/playground/vendor/fflate-LICENSE',
		'docs/synth-vsu/index.html', 'docs/synth-vsu/README.md', 'scripts/build_vsu.sh',
		'tetorica_src/native/vsu/vsu.cpp', 'tetorica_src/native/vsu/vsu.h', 'test/runtime/vsu-native.test.mjs',
	]) assert.deepEqual(Buffer.from(source[path]), await readFile(new URL(path, root)), path);
	assert(Object.keys({ ...html, ...source }).every(path => !/\.(?:vgm|vgz|vb)$/i.test(path) && !path.startsWith('ww/')));
	const browser = join(releaseDir, 'verified-browser');
	execFileSync('python3', ['-m', 'zipfile', '-e', artifacts.html, browser]);
	const check = execFileSync(process.execPath, [
		'--experimental-vm-modules', 'scripts/check_synth_package.mjs', browser,
	], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	assert.match(check, /PASS: \d+ local Synth module\/asset references/);
});
