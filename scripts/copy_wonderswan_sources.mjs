// SPDX-License-Identifier: BSD-3-Clause
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRuntimeArtifacts, listRuntimeArtifactFiles } from './runtime_artifacts.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Retain the fixed SDK layout so the included build recipe works unchanged. */
export async function copyWonderSwanSources(stage) {
	await checkRuntimeArtifacts({ root, ids: ['wonderswan'], mirrors: true });
	const sdk = join(root, 'third_party/tetorica-soundchip-native');
	const pinBytes = await readFile(join(root, 'third_party/soundchip-sdk.json'));
	const pin = JSON.parse(pinBytes),
		manifestBytes = await readFile(join(sdk, 'RELEASE-MANIFEST.json'));
	if (sha(manifestBytes) !== pin.manifestSha256)
		throw new Error('WonderSwan SDK manifest does not match the fixed pin');
	const manifest = JSON.parse(manifestBytes);
	const buildInfo = JSON.parse(
		await readFile(join(root, 'tetorica_src/runtime/generated/build-info.json')),
	);
	const build = buildInfo.artifacts?.find((item) => item.id === 'wonderswan');
	if (!build) throw new Error('WonderSwan build provenance is missing');
	const names = [
		...new Set([
			...build.sourceFiles.map((item) => item.path),
			'LICENSE',
			'sdk.json',
			'vendor/mame-wonderswan/LICENSE',
			'vendor/mame-wonderswan/README.md',
		]),
	].sort();
	const payload = new Map(),
		inputs = [];
	for (const name of names) {
		const bytes = await readFile(join(sdk, name)),
			expected = manifest.files[name];
		if (!expected || bytes.length !== expected.size || sha(bytes) !== expected.sha256)
			throw new Error(`WonderSwan SDK source mismatch: ${name}`);
		const compiled = build.sourceFiles.find((item) => item.path === name);
		if (compiled && (compiled.size !== bytes.length || compiled.sha256 !== sha(bytes)))
			throw new Error(`WonderSwan build input mismatch: ${name}`);
		const path = `sources/wonderswan-sdk/${name}`;
		payload.set(path, bytes);
		inputs.push({ path, bytes: bytes.length, sha256: sha(bytes) });
	}
	payload.set('sources/wonderswan-sdk/RELEASE-MANIFEST.json', manifestBytes);
	payload.set('sources/wonderswan-sdk/soundchip-sdk.json', pinBytes);
	payload.set(
		'licenses/mame-wonderswan/LICENSE',
		payload.get('sources/wonderswan-sdk/vendor/mame-wonderswan/LICENSE'),
	);
	payload.set(
		'licenses/mame-wonderswan/README.md',
		payload.get('sources/wonderswan-sdk/vendor/mame-wonderswan/README.md'),
	);
	const generated = {};
	for (const file of await listRuntimeArtifactFiles({
		root,
		ids: ['wonderswan'],
		includeMetadata: false,
	})) {
		const bytes = await readFile(file.source),
			output = build.outputs.find((item) => item.path === file.path);
		if (!output || bytes.length !== output.size || sha(bytes) !== output.sha256)
			throw new Error(`WonderSwan output mismatch: ${file.path}`);
		generated[file.path] = { bytes: bytes.length, sha256: sha(bytes) };
	}
	payload.set(
		'sources/WonderSwan.json',
		Buffer.from(
			JSON.stringify(
				{ schemaVersion: 1, component: 'wonderswan', sdk: pin, build, inputs, generated },
				null,
				2,
			) + '\n',
		),
	);
	payload.set(
		'sources/WonderSwan.md',
		Buffer.from(`# WonderSwan ASWAN source and rebuilding

The MAME-derived WonderSwan sound core and Tetorica adaptation use BSD-3-Clause.
Original upstream sources, attribution and adaptation notes are retained under
[wonderswan-sdk/vendor/mame-wonderswan/](wonderswan-sdk/vendor/mame-wonderswan/README.md).
These are byte-exact files from the pinned native SDK.
[WonderSwan.json](WonderSwan.json) records their provenance and shipped outputs.

From this sources directory, with Emscripten available:

\`sh wonderswan-sdk/scripts/build_wonderswan_wasm.sh ../../generated\`

No game files, BIOS, full MAME checkout or network are needed. This is a sound
core, not a WonderSwan CPU or game emulator. Native hosts compile
vendor/mame-wonderswan/wonderswan.cpp and include wonderswan.h.
Each instance has four packed 32-point, four-bit Wave channels; CH2 can be a
PCM DAC, CH3 has hardware Sweep and CH4 Noise. Presets, keyboard allocation,
software envelopes and audio-thread PCM streaming belong to the Synth host.
`),
	);
	for (const [name, bytes] of payload) {
		const target = join(stage, name);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, bytes);
	}
	return { inputs: inputs.length, files: payload.size, sdkVersion: pin.version };
}
