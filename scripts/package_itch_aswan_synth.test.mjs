// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { packageAswanSynth, validateAswanSynthVersion } from './package_itch_aswan_synth.mjs';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
test('ASWAN package version cannot escape its release directory', () => {
	for (const value of [
		'../escape',
		'/tmp/a',
		'',
		'.hidden',
		'a/b',
		'a\\b',
		'a b',
		'a;echo',
		'x'.repeat(81),
	])
		assert.throws(() => validateAswanSynthVersion(value));
	for (const value of ['dev', 'v1+test', '2026-11-04'])
		assert.equal(validateAswanSynthVersion(value), value);
});
test('ASWAN ZIP runs original editable modules with standalone deterministic runtime and authenticated sources', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'aswan-synth-package-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const a = await packageAswanSynth({ version: 'test', releaseDir: join(directory, 'a') });
	const b = await packageAswanSynth({ version: 'test', releaseDir: join(directory, 'b') });
	assert.deepEqual(await readFile(a.archive), await readFile(b.archive));
	assert(a.files < 1000);
	assert.equal(a.bundles, 4);
	const info = JSON.parse(
		execFileSync(
			'python3',
			[
				'-c',
				String.raw`
import json,sys,zipfile,io,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert all(not name.startswith('/') and '..' not in name.split('/') for name in z.namelist())
 receipt=json.loads(z.read('sources/aswan-synth-browser.json'))
 src=z.read(receipt['sourceArchive']['path'])
 assert hashlib.sha256(src).hexdigest()==receipt['sourceArchive']['sha256']
 with zipfile.ZipFile(io.BytesIO(src)) as source:
  assert set(source.namelist())==set(item['path'] for item in receipt['originalInputs'])
  for item in receipt['originalInputs']:
   data=source.read(item['path']);assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256']
 print(json.dumps({'names':z.namelist(),'receipt':receipt}))
`,
				a.archive,
			],
			{ encoding: 'utf8' },
		),
	);
	assert.equal(info.names.length, a.files);
	assert(!JSON.stringify(info.receipt).includes('/Users/'));
	assert.equal(info.receipt.product, 'Tetorica ASWAN Synth');
	assert.equal(info.receipt.productId, 'tetorica-aswan-synth');
	assert.match(a.archive, /tetorica_aswan_synth_test_itch\.zip$/);
	const icon = await readFile(new URL('../docs/tetorica_aswan_synth.webp', import.meta.url));
	assert.deepEqual(await readFile(join(a.stage, 'tetorica_aswan_synth.webp')), icon);
	assert(info.names.includes('tetorica_aswan_synth.webp'));
	assert.deepEqual(
		info.receipt.originalInputs.find(
			(input) => input.path === 'docs/tetorica_aswan_synth.webp',
		),
		{ path: 'docs/tetorica_aswan_synth.webp', bytes: icon.length, sha256: sha(icon) },
	);

	for (const name of ['wonderswan_wasm.js', 'wonderswan_wasm.wasm'])
		assert.deepEqual(
			await readFile(join(a.stage, 'generated', name)),
			await readFile(new URL('../tetorica_src/runtime/generated/' + name, import.meta.url)),
		);
	assert.deepEqual(
		info.names.filter((name) => name.endsWith('.wasm')).sort(),
		['generated/wonderswan_wasm.wasm', 'js/native_audio_effect.wasm'],
		'ship only the APU and host effects binaries',
	);
	assert.deepEqual(
		await readFile(join(a.stage, 'js/native_audio_effect.wasm')),
		await readFile(
			new URL('../tetorica_src/runtime/generated/effects/gain.wasm', import.meta.url),
		),
	);
	for (const name of [
		'tetorica-playground-globals.d.ts',
		'tetorica-playground-wonderswan.d.ts',
		'tetorica-shell.d.ts',
	])
		assert.deepEqual(
			await readFile(join(a.stage, 'playground', name)),
			await readFile(new URL('../docs/playground/' + name, import.meta.url)),
		);
	for (const name of ['playground_code_runtime.js', 'native-fx-worklet.js'])
		assert(info.names.some((path) => path.endsWith(name)));
	for (const name of [
		'synth-aswan/song_player.js',
		'synth-aswan/song_live.js',
		'synth-aswan/song_engine.js',
		'synth-aswan/vgm_import.js',
		'synth-aswan/code_host.js',
		'js/wonderswansynth.js',
	])
		assert(info.names.includes(name), `standalone reference-song dependency: ${name}`);
	assert(info.names.includes('licenses/tetorica-virtual-files/LICENSE'));
	assert(info.names.includes('playground/vendor/fflate-LICENSE'));
	assert(info.names.includes('sources/code-effects/scripts/build_native_audio_effect.sh'));
	const native = JSON.parse(await readFile(join(a.stage, 'sources/WonderSwan.json')));
	for (const entry of native.inputs) {
		const bytes = await readFile(join(a.stage, entry.path));
		assert.equal(bytes.length, entry.bytes);
		assert.equal(sha(bytes), entry.sha256);
	}
	for (const [name, entry] of Object.entries(native.generated))
		assert.equal(sha(await readFile(join(a.stage, 'generated', name))), entry.sha256);
	assert.equal(info.receipt.builder.name, 'source-copy');
	assert.equal(info.receipt.builder.minify, false);
	assert.equal(info.receipt.builder.bundle, false);
	assert.equal(info.receipt.builder.dependencyAnalyzer.name, 'esbuild');
	assert.equal(typeof info.receipt.builder.dependencyAnalyzer.version, 'string');
	assert(info.receipt.modules.length > info.receipt.bundles.length);
	let staticAssets = 0;
	for (const module of info.receipt.modules) {
		assert.equal(module.path, module.sourcePath.slice('docs/'.length));
		const bytes = await readFile(join(a.stage, module.path));
		assert.deepEqual(
			bytes,
			await readFile(new URL('../' + module.sourcePath, import.meta.url)),
			`${module.path}: preserve comments, identifiers, imports and original bytes`,
		);
		assert.equal(bytes.length, module.bytes);
		assert.equal(sha(bytes), module.sha256);
		for (const specifier of module.localImports) {
			assert.match(
				specifier,
				/^\.\.?\//,
				'localImports retain the original relative specifiers',
			);
			const url = new URL(specifier, new URL(module.path, 'https://zip.invalid/'));
			assert(
				info.names.includes(decodeURIComponent(url.pathname.slice(1))),
				`${module.path}: ${specifier}`,
			);
		}
		for (const match of bytes
			.toString()
			.matchAll(/new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g)) {
			const url = new URL(match[2], new URL(module.path, 'https://zip.invalid/'));
			if (url.origin !== 'https://zip.invalid') continue;
			assert(
				info.names.includes(decodeURIComponent(url.pathname.slice(1))),
				`${module.path}: ${match[2]}`,
			);
			staticAssets++;
		}
	}
	assert(
		staticAssets >= 2,
		'original audio module references local WASM and AudioWorklet assets',
	);
	for (const entry of info.receipt.bundles)
		assert.deepEqual(
			entry,
			info.receipt.modules.find((module) => module.path === entry.path),
		);
	const main = await readFile(join(a.stage, 'synth-aswan/synth.js'), 'utf8');
	assert(main.split('\n').length > 100);
	assert.match(main, /^\/\/ SPDX-License-Identifier: BSD-3-Clause\n/);
	assert.match(main, /import\s*\{\s*createAudio\s*\}\s*from '\.\/audio\.js(?:\?[^']*)?'/);
	assert.match(
		await readFile(join(a.stage, 'synth-aswan/synth.css'), 'utf8'),
		/@import url\('\.\.\/synth-spu\/synth\.css(?:\?[^']*)?'\)/,
	);
	assert(info.receipt.modules.some((module) => module.path === 'synth-spu/synth.css'));
	for (const path of [
		'scripts/copy_readable_modules.mjs',
		'scripts/runtime_artifacts.mjs',
		'scripts/wasm_sdk_inventory.mjs',
	])
		assert(info.receipt.originalInputs.some((input) => input.path === path));
	for (const entry of ['index.html', 'synth-aswan/index.html']) {
		const html = await readFile(join(a.stage, entry), 'utf8');
		const iconPath =
			entry === 'index.html' ? './tetorica_aswan_synth.webp' : '../tetorica_aswan_synth.webp';
		for (const rel of ['icon', 'apple-touch-icon']) {
			const link = [...html.matchAll(/<link\b[^>]*>/g)]
				.map((match) => match[0])
				.find((tag) => tag.includes(`rel="${rel}"`));
			assert(link, `${entry}: ${rel} link`);
			assert(link.includes(`href="${iconPath}"`), `${entry}: ${rel} uses its local image`);
		}
		const image = [...html.matchAll(/<img\b[^>]*>/g)]
			.map((match) => match[0])
			.find((tag) => /class="[^"]*\bproduct-icon\b[^"]*"/.test(tag));
		assert(image?.includes(`src="${iconPath}"`), `${entry}: header uses the same local icon`);

		assert.match(html, /<title>Tetorica ASWAN Synth<\/title>/);
		assert.match(html, /<meta name="application-name" content="Tetorica ASWAN Synth"\s*\/?>/);
		for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
			const url = new URL(match[1], new URL(entry, 'https://zip.invalid/'));
			if (url.origin === 'https://zip.invalid')
				assert(info.names.includes(url.pathname.slice(1)), `${entry}: ${match[1]}`);
		}
	}
	assert.match(
		await readFile(join(a.stage, 'licenses/mame-wonderswan/LICENSE'), 'utf8'),
		/Redistribution/,
	);
	const original = await readFile(a.archive);
	await assert.rejects(
		packageAswanSynth({ version: 'test', releaseDir: join(directory, 'a') }),
		/already exists/,
	);
	assert.deepEqual(await readFile(a.archive), original);
});
