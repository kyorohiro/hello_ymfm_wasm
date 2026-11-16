// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { packageYm2149StSynth, validateYm2149StSynthVersion } from './package_itch_ym2149_st_synth.mjs';
import {copyAtariAudioSources, ATARI_AUDIO_PLAYER_OUTPUTS} from './copy_atari_audio_sources.mjs';
import {ATARI_AUDIO_PLAYER_BUILD_INPUTS, checkAtariAudioPlayerBuild} from './atari_audio_player_artifacts.mjs';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
test('YM2149 ST package version cannot escape its release directory', () => {
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
		assert.throws(() => validateYm2149StSynthVersion(value));
	for (const value of ['dev', 'v1+test', '2026-11-04'])
		assert.equal(validateYm2149StSynthVersion(value), value);
});
test('YM2149 ST ZIP runs original editable modules with standalone deterministic runtime and authenticated sources', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'ym2149-st-synth-package-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const a = await packageYm2149StSynth({ version: 'test', releaseDir: join(directory, 'a') });
	const b = await packageYm2149StSynth({ version: 'test', releaseDir: join(directory, 'b') });
	assert.deepEqual(await readFile(a.archive), await readFile(b.archive));
	assert(a.files < 1000);
	assert.equal(a.bundles, 5);
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
 receipt=json.loads(z.read('sources/ym2149-st-synth-browser.json'))
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
	assert.equal(info.receipt.product, 'Tetorica YM2149 ST Synth');
	assert.equal(info.receipt.productId, 'tetorica-ym2149-st-synth');
	assert.match(a.archive, /tetorica_ym2149_st_synth_test_itch\.zip$/);
	const icon = await readFile(new URL('../docs/tetorica_ym2149_st_synth.webp', import.meta.url));
	assert.deepEqual(await readFile(join(a.stage, 'tetorica_ym2149_st_synth.webp')), icon);
	assert(info.names.includes('tetorica_ym2149_st_synth.webp'));
	assert.deepEqual(
		info.receipt.originalInputs.find(
			(input) => input.path === 'docs/tetorica_ym2149_st_synth.webp',
		),
		{ path: 'docs/tetorica_ym2149_st_synth.webp', bytes: icon.length, sha256: sha(icon) },
	);

	for (const name of ['ay8910_wasm.js', 'ay8910_wasm.wasm'])
		assert.deepEqual(
			await readFile(join(a.stage, 'generated', name)),
			await readFile(new URL('../tetorica_src/runtime/generated/' + name, import.meta.url)),
		);
	assert.deepEqual(
		info.names.filter((name) => name.endsWith('.wasm')).sort(),
		['generated/atari-audio-player/atari-audio-player.wasm', 'generated/ay8910_wasm.wasm', 'js/native_audio_effect.wasm'],
		'ship the AY instrument, independent Atari reference player and host effects binaries',
	);
	assert.deepEqual(
		await readFile(join(a.stage, 'js/native_audio_effect.wasm')),
		await readFile(
			new URL('../tetorica_src/runtime/generated/effects/gain.wasm', import.meta.url),
		),
	);
	for (const name of [
		'tetorica-playground-globals.d.ts',
		'tetorica-playground-atari-st.d.ts',
		'tetorica-shell.d.ts',
	])
		assert.deepEqual(
			await readFile(join(a.stage, 'playground', name)),
			await readFile(new URL('../docs/playground/' + name, import.meta.url)),
		);
	for (const name of ['playground_code_runtime.js', 'native-fx-worklet.js'])
		assert(info.names.some((path) => path.endsWith(name)));
	for (const name of [
		'synth-ym2149-st/audio.js',
		'synth-ym2149-st/instrument.js',
		'js/playground_ay8910_audio.js',
		'js/playground_ay8910_worklet.js',
		'synth-ym2149-st/code_host.js',
		'synth-ym2149-st/code_examples.js',
		'synth-ym2149-st/music_files.js',
		'synth-ym2149-st/song_live.js',
		'synth-ym2149-st/song_player.js',
		'synth-ym2149-st/vgm_source.js',
		'synth-ym2149-st/vgm_engine.js',
		'synth-ym2149-st/atari_engine.js',
		'synth-ym2149-st/atari_worker.js',
		'js/ym2612vgm.js',
		'js/ay8910synth.js',
	])
		assert(info.names.includes(name), `standalone YM2149 dependency: ${name}`);
	assert(!info.names.includes('synth-ym2149-st/processor.js'), 'use the existing AY Worklet');
	assert(!info.names.some(name => /third_party\/atari-audio\/.*\.(?:sndh|ym\d?|vgm|vgz)$/i.test(name)), 'upstream example music is omitted');
	assert(info.names.includes('licenses/tetorica-virtual-files/LICENSE'));
	assert(info.names.includes('playground/vendor/fflate-LICENSE'));
	assert(info.names.includes('sources/code-effects/scripts/build_native_audio_effect.sh'));
	const atari = JSON.parse(await readFile(join(a.stage, 'sources/ATARI-AUDIO.json')));
	assert.equal(atari.component, 'ym2149-atari-audio-reference-player');
	assert.equal(atari.upstream.repository, 'https://github.com/arnaud-carre/AtariAudio');
	assert.equal(atari.upstream.revision, '1dd9fca810a4f00b4b5e6a5348872ac0a21d88fb');
	assert.deepEqual(atari.build, await checkAtariAudioPlayerBuild());
	assert.deepEqual(atari.build, await checkAtariAudioPlayerBuild({
		root: join(a.stage, 'sources/atari-audio-player'),
		directory: join(a.stage, 'generated/atari-audio-player'),
	}), 'the complete extracted source kit verifies its shipped native output');
	assert.equal(atari.inputs.length, ATARI_AUDIO_PLAYER_BUILD_INPUTS.length);
	for (const entry of [...atari.inputs, ...atari.generated]) {
		const bytes = await readFile(join(a.stage, entry.path));
		assert.equal(bytes.length, entry.bytes); assert.equal(sha(bytes), entry.sha256);
	}
	for (const name of ATARI_AUDIO_PLAYER_OUTPUTS)
		assert.deepEqual(await readFile(join(a.stage, 'generated/atari-audio-player', name)), await readFile(new URL('../docs/generated/atari-audio-player/' + name, import.meta.url)));
	for (const path of [
		'scripts/build_atari_audio_player_wasm.sh', 'scripts/atari_audio_player_artifacts.mjs',
		'tetorica_src/wasm/atari_audio_player_wasm.cpp', 'third_party/atari-audio/upstream.json',
		'third_party/atari-audio/PATCHES.md', 'third_party/atari-audio/local.patch',
		'third_party/atari-audio/src/external/Musashi/m68k.cpp',
		'third_party/atari-audio/src/external/ice_24.cpp', 'third_party/atari-audio/src/external/lzh.cpp',
	]) {
		assert(info.names.includes('sources/atari-audio-player/' + path), `native rebuild input: ${path}`);
		assert(info.receipt.originalInputs.some(input => input.path === path), `browser source archive includes native input: ${path}`);
	}
	assert.match(await readFile(join(a.stage, 'licenses/atari-audio/LICENSE'), 'utf8'), /Arnaud Carr/);
	assert.match(await readFile(join(a.stage, 'licenses/musashi/readme.txt'), 'utf8'), /Permission is hereby granted/);
	assert.match(await readFile(join(a.stage, 'licenses/ice/ice_24.cpp'), 'utf8'), /public domain 2007 by Hans Wessels/);
	assert.match(await readFile(join(a.stage, 'licenses/lzh/lzh.cpp'), 'utf8'), /Haruhiko Okumura.*Kerwin F. Medina/);
	assert.match(await readFile(join(a.stage, 'sources/ATARI-AUDIO.md'), 'utf8'), /build_atari_audio_player_wasm\.sh/);
	assert.deepEqual(info.receipt.referenceArtifacts, atari.generated);
	const native = JSON.parse(await readFile(join(a.stage, 'sources/AY8910.json')));
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
	const main = await readFile(join(a.stage, 'synth-ym2149-st/synth.js'), 'utf8');
	assert(main.split('\n').length > 100);
	assert.match(main, /^\/\/ SPDX-License-Identifier: BSD-3-Clause\n/);
	assert.match(main, /import\s*\{\s*createAudio\s*\}\s*from '\.\/audio\.js(?:\?[^']*)?'/);
	assert.match(
		await readFile(join(a.stage, 'synth-ym2149-st/synth.css'), 'utf8'),
		/@import url\('\.\.\/synth-spu\/synth\.css(?:\?[^']*)?'\)/,
	);
	assert(info.receipt.modules.some((module) => module.path === 'synth-spu/synth.css'));
	for (const path of [
		'scripts/copy_readable_modules.mjs',
		'scripts/copy_atari_audio_sources.mjs',
		'scripts/runtime_artifacts.mjs',
		'scripts/wasm_sdk_inventory.mjs',
	])
		assert(info.receipt.originalInputs.some((input) => input.path === path));
	for (const entry of ['index.html', 'synth-ym2149-st/index.html']) {
		const html = await readFile(join(a.stage, entry), 'utf8');
		const iconPath =
			entry === 'index.html' ? './tetorica_ym2149_st_synth.webp' : '../tetorica_ym2149_st_synth.webp';
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

		assert.match(html, /<title>Tetorica YM2149 ST Synth<\/title>/);
		assert.match(html, /<meta name="application-name" content="Tetorica YM2149 ST Synth"\s*\/?>/);
		for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
			const url = new URL(match[1], new URL(entry, 'https://zip.invalid/'));
			if (url.origin === 'https://zip.invalid')
				assert(info.names.includes(url.pathname.slice(1)), `${entry}: ${match[1]}`);
		}
	}
	assert.match(
		await readFile(join(a.stage, 'licenses/mame-ay8910/LICENSE'), 'utf8'),
		/Redistribution/,
	);

	assert.equal(native.component, 'ay8910');
	assert.equal(native.build.id, 'ay8910');
	assert(info.names.includes('sources/ay8910-sdk/scripts/build_ay8910_wasm.sh'));
	assert.match(await readFile(join(a.stage, 'sources/AY8910.md'), 'utf8'), /build_ay8910_wasm\.sh/);
	assert(info.receipt.originalInputs.some(input => input.path === 'scripts/copy_ay8910_sources.mjs'));
	for(const artifact of info.receipt.runtimeArtifacts) {
		const bytes = await readFile(join(a.stage, artifact.path));
		assert.equal(bytes.length, artifact.bytes);
		assert.equal(sha(bytes), artifact.sha256);
	}
	const audio = await readFile(join(a.stage, 'synth-ym2149-st/audio.js'), 'utf8');
	assert.match(audio, /type: 0x10/);
	assert.match(audio, /new URL\('\.\.\/js\/playground_ay8910_worklet\.js', import\.meta\.url\)/);
	assert.deepEqual(await readFile(join(a.stage, 'js/playground_ay8910_worklet.js')), await readFile(new URL('../docs/js/playground_ay8910_worklet.js', import.meta.url)));
	assert.match(await readFile(join(a.stage, 'js/playground_ay8910_worklet.js'), 'utf8'), /import factory from '\.\.\/generated\/ay8910_wasm\.js'/);
	assert.deepEqual(await readFile(join(a.stage, 'synth-ym2149-st/atari_worker.js')), await readFile(new URL('../docs/synth-ym2149-st/atari_worker.js', import.meta.url)));
	assert.match(await readFile(join(a.stage, 'synth-ym2149-st/atari_worker.js'), 'utf8'), /new URL\('\.\.\/generated\/atari-audio-player\/atari-audio-player\.wasm', import\.meta\.url\)/);
	assert.match(await readFile(join(a.stage, 'synth-ym2149-st/atari_engine.js'), 'utf8'), /new Worker\(new URL\('\.\/atari_worker\.js', import\.meta\.url\)/);
	const original = await readFile(a.archive);
	await assert.rejects(
		packageYm2149StSynth({ version: 'test', releaseDir: join(directory, 'a') }),
		/already exists/,
	);
	assert.deepEqual(await readFile(a.archive), original);
});

test('native reference source copier rejects changed inputs and WASM against the shipped build receipt', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'ym2149-atari-source-check-'));
	t.after(() => rm(directory, {recursive: true, force: true}));
	const mirror = join(directory, 'repository');
	for (const path of [...ATARI_AUDIO_PLAYER_BUILD_INPUTS, ...ATARI_AUDIO_PLAYER_OUTPUTS.map(name => 'docs/generated/atari-audio-player/' + name)]) {
		await mkdir(dirname(join(mirror, path)), {recursive: true});
		await writeFile(join(mirror, path), await readFile(new URL('../' + path, import.meta.url)));
	}
	const wrapper = 'tetorica_src/wasm/atari_audio_player_wasm.cpp';
	const original = await readFile(join(mirror, wrapper));
	await writeFile(join(mirror, wrapper), Buffer.concat([original, Buffer.from('\n// stale build\n')]));
	await assert.rejects(copyAtariAudioSources(join(directory, 'stale-source'), {root: mirror}), /receipt differs/);
	await writeFile(join(mirror, wrapper), original);
	const vendorPath = join(mirror, 'third_party/atari-audio/src/YmRenderer.cpp');
	const vendor = await readFile(vendorPath);
	await writeFile(vendorPath, Buffer.concat([vendor, Buffer.from('\n// changed vendor source\n')]));
	await assert.rejects(copyAtariAudioSources(join(directory, 'stale-vendor'), {root: mirror}), /vendored source differs/);
	await writeFile(vendorPath, vendor);
	const wasmPath = join(mirror, 'docs/generated/atari-audio-player/atari-audio-player.wasm');
	const wasm = await readFile(wasmPath); wasm[wasm.length - 1] ^= 1; await writeFile(wasmPath, wasm);
	await assert.rejects(copyAtariAudioSources(join(directory, 'stale-output'), {root: mirror}), /receipt differs/);
});
