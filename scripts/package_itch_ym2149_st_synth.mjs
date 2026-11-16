// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, writeFile, copyFile, cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { version as esbuildVersion } from 'esbuild';
import { checkRuntimeArtifacts, copyRuntimeArtifacts } from './runtime_artifacts.mjs';
import { copyAy8910Sources } from './copy_ay8910_sources.mjs';
import { copyAtariAudioSources } from './copy_atari_audio_sources.mjs';
import { copyReadableModules } from './copy_readable_modules.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const record = (bytes) => ({
	bytes: bytes.length,
	sha256: createHash('sha256').update(bytes).digest('hex'),
});
async function filesIn(base, prefix = '') {
	const result = [];
	for (const entry of await readdir(join(base, prefix), { withFileTypes: true })) {
		const name = prefix + entry.name;
		if (entry.isDirectory()) result.push(...(await filesIn(base, name + '/')));
		else {
			assert(entry.isFile(), `Unsupported archive entry: ${name}`);
			result.push(name);
		}
	}
	return result.sort();
}
function zip(base, path, names) {
	execFileSync(
		'python3',
		[
			'-c',
			String.raw`
import json,sys,zipfile
from pathlib import Path
base=Path(sys.argv[1]); names=json.load(sys.stdin)
with zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name in names:
  info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.create_system=3;info.external_attr=0o100644<<16
  z.writestr(info,(base/name).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(sys.argv[2]) as z: assert z.testzip() is None
`,
			base,
			path,
		],
		{ input: JSON.stringify(names) },
	);
}
export function validateYm2149StSynthVersion(value) {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(value))
		throw new Error('Invalid package version');
	return value;
}
export async function packageYm2149StSynth({
	version = 'dev',
	releaseDir = join(root, 'release'),
} = {}) {
	validateYm2149StSynthVersion(version);
	await checkRuntimeArtifacts({
		root,
		ids: ['ay8910', 'native_audio_effect'],
		mirrors: true,
	});
	releaseDir = resolve(releaseDir);
	await mkdir(releaseDir, { recursive: true });
	const archive = join(releaseDir, `tetorica_ym2149_st_synth_${version}_itch.zip`);
	try {
		await readFile(archive);
		throw new Error(`Archive already exists: ${archive}`);
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
	const stage = await mkdtemp(join(releaseDir, `itch_ym2149_st_synth_${version}-`));
	const browser = await copyReadableModules({
		root,
		stage,
		entries: [
			'docs/synth-ym2149-st/synth.js',
			'docs/synth-ym2149-st/atari_worker.js',
			'docs/js/playground_ay8910_worklet.js',
			'docs/synth-ym2149-st/synth.css',
			'docs/js/native-fx-worklet.js',
		],
		factories: ['docs/generated/ay8910_wasm.js'],
	});
	const inputs = new Set(browser.inputs),
		bundles = browser.entries;
	// These named Monaco resources and the software FX binary are not static
	// import edges. Keep them local and readable without adding other chip WASM.
	for (const name of [
		'tetorica-playground-globals.d.ts',
		'tetorica-playground-atari-st.d.ts',
		'tetorica-shell.d.ts',
	]) {
		const source = 'docs/playground/' + name;
		await mkdir(join(stage, 'playground'), { recursive: true });
		await copyFile(join(root, source), join(stage, 'playground', name));
		inputs.add(source);
	}
	for (const [source, destination] of [
		['docs/playground/vendor/fflate-LICENSE', 'playground/vendor/fflate-LICENSE'],
		['packages/virtual-files/LICENSE', 'licenses/tetorica-virtual-files/LICENSE'],
	]) {
		await mkdir(join(stage, destination.slice(0, destination.lastIndexOf('/'))), {
			recursive: true,
		});
		await copyFile(join(root, source), join(stage, destination));
		inputs.add(source);
	}
	const effectSource = 'tetorica_src/runtime/generated/effects/gain.wasm',
		effectPath = 'js/native_audio_effect.wasm';
	await copyFile(join(root, effectSource), join(stage, effectPath));
	inputs.add(effectSource);
	const effectKit = 'sources/code-effects';
	await mkdir(join(stage, effectKit, 'scripts'), { recursive: true });
	await mkdir(join(stage, effectKit, 'tetorica_src/native'), { recursive: true });
	await cp(
		join(root, 'tetorica_src/native/audio_effect'),
		join(stage, effectKit, 'tetorica_src/native/audio_effect'),
		{ recursive: true },
	);
	await copyFile(
		join(root, 'scripts/build_native_audio_effect.sh'),
		join(stage, effectKit, 'scripts/build_native_audio_effect.sh'),
	);
	await copyFile(join(root, 'LICENSE'), join(stage, effectKit, 'LICENSE'));
	for (const file of await filesIn(join(root, 'tetorica_src/native/audio_effect')))
		inputs.add('tetorica_src/native/audio_effect/' + file);
	inputs.add('scripts/build_native_audio_effect.sh');
	await writeFile(
		join(stage, effectKit, 'README.md'),
		`# Code software effects

This original Tetorica C effect rack is BSD-3-Clause; see LICENSE. It runs after
the YM2149 chip as host software, separately from its hardware sound controls.
The readable browser host is js/native_fx_rack.js; its binary is
js/native_audio_effect.wasm. With Emscripten installed, run here:

\`\`\`sh
sh scripts/build_native_audio_effect.sh /tmp/tetorica-ym2149-st-code-effects
cp /tmp/tetorica-ym2149-st-code-effects/gain.wasm ../../js/native_audio_effect.wasm
\`\`\`

An explicit output directory keeps this rebuild independent of artifact-sync tools.
`,
	);
	const home = 'https://kyorohiro.github.io/hello_ymfm_wasm/';
	let html = await readFile(join(root, 'docs/synth-ym2149-st/index.html'), 'utf8');
	html = html.replace(/href="(\.\.\/[^"#]+)"/g, (_match, path) => {
		if (path === '../tetorica_ym2149_st_synth.webp') return `href="${path}"`;
		if (path === '../js/ay8910synth.js')
			return 'href="https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/tetorica_src/runtime/ay8910synth.js"';
		return `href="${new URL(path, home + 'synth-ym2149-st/').href}"`;
	});
	await writeFile(join(stage, 'synth-ym2149-st/index.html'), html);
	await writeFile(
		join(stage, 'index.html'),
		html
			.replaceAll('../tetorica_ym2149_st_synth.webp', './tetorica_ym2149_st_synth.webp')
			.replace(
				/\b(href|src)="\.\/(synth\.(?:css|js)(?:\?[^"#]*)?)"/g,
				'$1="./synth-ym2149-st/$2"',
			),
	);
	const runtime = await copyRuntimeArtifacts({
		root,
		destination: join(stage, 'generated'),
		ids: ['ay8910'],
		includeMetadata: false,
	});
	const sourceCheck = await copyAy8910Sources(stage);
	const atariSourceCheck = await copyAtariAudioSources(stage);
	for (const path of atariSourceCheck.inputPaths) inputs.add(path);
	// This generated guide describes only the instrument core. The standalone
	// product also contains the independent AtariAudio reference component.
	const ayGuide = join(stage, 'sources/AY8910.md');
	await writeFile(ayGuide, (await readFile(ayGuide, 'utf8')).replace(
		'This package does not include YM / SNDH song playback,\nSTE DMA, an Atari ST CPU or commercial music.',
		'This instrument core is independent of the AtariAudio YM / SNDH reference\nplayer described in ATARI-AUDIO.md. No commercial music is included.',
	));
	await copyFile(join(root, 'LICENSE'), join(stage, 'LICENSE'));
	await copyFile(
		join(root, 'docs/tetorica_ym2149_st_synth.webp'),
		join(stage, 'tetorica_ym2149_st_synth.webp'),
	);
	const guide = (await readFile(join(root, 'docs/synth-ym2149-st/README.md'), 'utf8')).replace(
		/\]\(([^)]+)\)/g,
		(match, target) => {
			if (/^(?:https?:|#)/.test(target) || target === 'index.html') return match;
			return `](${new URL(target, 'https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/docs/synth-ym2149-st/').href})`;
		},
	);
	await writeFile(join(stage, 'synth-ym2149-st/README.md'), guide);
	await writeFile(
		join(stage, 'README.md'),
		guide +
			'\n## Included sources\n\nSee [AY/YM instrument sources and rebuilding](sources/AY8910.md), [AtariAudio reference sources and rebuilding](sources/ATARI-AUDIO.md), [browser build inputs](sources/ym2149-st-synth-browser-inputs.zip) and their [hash receipt](sources/ym2149-st-synth-browser.json). All browser modules and the Worker retain their authored source.\n',
	);
	for (const path of [
		'docs/synth-ym2149-st/index.html',
		'docs/synth-ym2149-st/README.md',
		'docs/tetorica_ym2149_st_synth.webp',
		'LICENSE',
		'package.json',
		'package-lock.json',
		'scripts/package_itch_ym2149_st_synth.mjs',
		'scripts/package_itch_ym2149_st_synth.sh',
		'scripts/copy_ay8910_sources.mjs',
		'scripts/copy_atari_audio_sources.mjs',
		'scripts/copy_readable_modules.mjs',
		'scripts/runtime_artifacts.mjs',
		'scripts/wasm_sdk_inventory.mjs',
		'tetorica_src/runtime/generated/ay8910_wasm.js',
	])
		inputs.add(path);
	const names = [...inputs].sort(),
		sourceArchive = 'sources/ym2149-st-synth-browser-inputs.zip';
	zip(root, join(stage, sourceArchive), names);
	const receipt = {
		schemaVersion: 1,
		product: 'Tetorica YM2149 ST Synth',
		productId: 'tetorica-ym2149-st-synth',
		version,
		builder: {
			name: 'source-copy',
			minify: false,
			bundle: false,
			dependencyAnalyzer: { name: 'esbuild', version: esbuildVersion },
		},
		bundles,
		modules: browser.modules,
		originalInputs: await Promise.all(
			names.map(async (path) => ({ path, ...record(await readFile(join(root, path))) })),
		),
		sourceArchive: {
			path: sourceArchive,
			...record(await readFile(join(stage, sourceArchive))),
		},
		sourceCheck,
		atariSourceCheck,
		referenceArtifacts: atariSourceCheck.generated,
		runtimeArtifacts: await Promise.all(runtime.files.map(async (path) => ({
			path: `generated/${path}`, ...record(await readFile(join(stage, 'generated', path))),
		}))),
	};
	await writeFile(
		join(stage, 'sources/ym2149-st-synth-browser.json'),
		JSON.stringify(receipt, null, 2) + '\n',
	);
	const namesInStage = await filesIn(stage);
	assert(namesInStage.length <= 1000, 'itch.io file limit exceeded');
	const temporary = stage + '.zip';
	try {
		zip(stage, temporary, namesInStage);
		await copyFile(temporary, archive, constants.COPYFILE_EXCL);
		await rm(temporary);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
	return {
		passed: true,
		stage,
		archive,
		files: namesInStage.length,
		bundles: bundles.length,
		archiveRecord: record(await readFile(archive)),
		sourceCheck,
		atariSourceCheck,
	};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.length > 3)
		throw new Error('Usage: node scripts/package_itch_ym2149_st_synth.mjs [VERSION]');
	console.log(
		JSON.stringify(await packageYm2149StSynth({ version: process.argv[2] ?? 'dev' }), null, 2),
	);
}
