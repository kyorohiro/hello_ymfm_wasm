// SPDX-License-Identifier: BSD-3-Clause
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRuntimeArtifacts, listRuntimeArtifactFiles } from './runtime_artifacts.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Retain the fixed SDK layout so the included build recipe works unchanged. */
export async function copyAy8910Sources(stage) {
	await checkRuntimeArtifacts({ root, ids: ['ay8910'], mirrors: true });
	const sdk = join(root, 'third_party/tetorica-soundchip-native');
	const pinBytes = await readFile(join(root, 'third_party/soundchip-sdk.json'));
	const pin = JSON.parse(pinBytes),
		manifestBytes = await readFile(join(sdk, 'RELEASE-MANIFEST.json'));
	if (sha(manifestBytes) !== pin.manifestSha256)
		throw new Error('AY8910 SDK manifest does not match the fixed pin');
	const manifest = JSON.parse(manifestBytes);
	const buildInfo = JSON.parse(
		await readFile(join(root, 'tetorica_src/runtime/generated/build-info.json')),
	);
	const build = buildInfo.artifacts?.find((item) => item.id === 'ay8910');
	if (!build) throw new Error('AY8910 build provenance is missing');
	const names = [
		...new Set([
			...build.sourceFiles.map((item) => item.path),
			'LICENSE',
			'sdk.json',
			'vendor/mame-ay8910/LICENSE',
			'vendor/mame-ay8910/README.md',
		]),
	].sort();
	const payload = new Map(),
		inputs = [];
	for (const name of names) {
		const bytes = await readFile(join(sdk, name)),
			expected = manifest.files[name];
		if (!expected || bytes.length !== expected.size || sha(bytes) !== expected.sha256)
			throw new Error(`AY8910 SDK source mismatch: ${name}`);
		const compiled = build.sourceFiles.find((item) => item.path === name);
		if (compiled && (compiled.size !== bytes.length || compiled.sha256 !== sha(bytes)))
			throw new Error(`AY8910 build input mismatch: ${name}`);
		const path = `sources/ay8910-sdk/${name}`;
		payload.set(path, bytes);
		inputs.push({ path, bytes: bytes.length, sha256: sha(bytes) });
	}
	payload.set('sources/ay8910-sdk/RELEASE-MANIFEST.json', manifestBytes);
	payload.set('sources/ay8910-sdk/soundchip-sdk.json', pinBytes);
	payload.set(
		'licenses/mame-ay8910/LICENSE',
		payload.get('sources/ay8910-sdk/vendor/mame-ay8910/LICENSE'),
	);
	payload.set(
		'licenses/mame-ay8910/README.md',
		payload.get('sources/ay8910-sdk/vendor/mame-ay8910/README.md'),
	);
	const generated = {};
	for (const file of await listRuntimeArtifactFiles({
		root,
		ids: ['ay8910'],
		includeMetadata: false,
	})) {
		const bytes = await readFile(file.source),
			output = build.outputs.find((item) => item.path === file.path);
		if (!output || bytes.length !== output.size || sha(bytes) !== output.sha256)
			throw new Error(`AY8910 output mismatch: ${file.path}`);
		generated[file.path] = { bytes: bytes.length, sha256: sha(bytes) };
	}
	payload.set(
		'sources/AY8910.json',
		Buffer.from(
			JSON.stringify(
				{ schemaVersion: 1, component: 'ay8910', sdk: pin, build, inputs, generated },
				null,
				2,
			) + '\n',
		),
	);
	payload.set(
		'sources/AY8910.md',
		Buffer.from(`# AY-3-8910 / YM2149 source and rebuilding

The shared MAME-derived AY-3-8910 / YM2149 core and Tetorica adaptation use
BSD-3-Clause. Copyright Couriersud. Original upstream sources, attribution and
adaptation notes are retained under
[ay8910-sdk/vendor/mame-ay8910/](ay8910-sdk/vendor/mame-ay8910/README.md).
These are byte-exact files from the pinned native SDK.
[AY8910.json](AY8910.json) records their provenance and shipped outputs.

From this sources directory, with Emscripten available:

\`sh ay8910-sdk/scripts/build_ay8910_wasm.sh ../../generated\`

No game files, BIOS, full MAME checkout or network are needed. This is a sound
core, not an Atari ST CPU or machine emulator. Native hosts compile
vendor/mame-ay8910/ay8910.cpp and include ay8910.h.

The same core supports AY-3-8910 and YM2149. Tetorica YM2149 ST Synth selects
the YM2149 at 2,000,000 Hz, type 0x10, flags 1. Three tone voices share one
noise generator and one hardware envelope. The YM2149 envelope has 32 levels;
writing its shape retriggers that shared generator. Keyboard allocation,
JavaScript performance timing, output gain and AudioWorklet output centering
belong to the Synth host. This package does not include YM / SNDH song playback,
STE DMA, an Atari ST CPU or commercial music.
`),
	);
	for (const [name, bytes] of payload) {
		const target = join(stage, name);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, bytes);
	}
	return { inputs: inputs.length, files: payload.size, sdkVersion: pin.version };
}
