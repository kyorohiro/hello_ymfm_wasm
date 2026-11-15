#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Build the separately licensed, pinned SSF playback component.
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'third_party/ssfplay');

export async function checkSsfPlayerSources() {
	const source = JSON.parse(await readFile(path.join(vendor, 'UPSTREAM.json'), 'utf8'));
	const records = [
		...source.files,
		...source.dependencies.flatMap((dependency) => dependency.files),
	];
	for (const record of records) {
		const bytes = await readFile(path.join(vendor, record.path));
		const hash = createHash('sha256').update(bytes).digest('hex');
		if (bytes.length !== record.bytes || hash !== record.sha256) {
			throw new Error(`Pinned SSF source changed: ${record.path}`);
		}
	}
	return source;
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

export async function buildSsfPlayer({ outDir, buildDir, cacheDir } = {}) {
	await checkSsfPlayerSources();
	const output = path.resolve(outDir ?? path.join(root, 'docs/generated/ssf-player'));
	const build = path.resolve(buildDir ?? path.join(root, 'build/ssf-player'));
	const env = {
		...process.env,
		EM_CACHE: cacheDir ?? process.env.EM_CACHE ?? path.join(root, '.emcache/ssf-player'),
	};
	await mkdir(output, { recursive: true });
	const observer = path.join(build, 'observer');
	await mkdir(observer, { recursive: true });
	const upstream = await readFile(path.join(vendor, 'src/ssfplay.cpp'), 'utf8');
	const header = await readFile(path.join(vendor, 'mednafen/src/ss/scsp.h'), 'utf8');
	const includeAnchor = '#include "../mednafen/src/ss/sound.cpp"';
	const accessAnchor = ' private:';
	if (upstream.split(includeAnchor).length !== 2 || header.split(accessAnchor).length !== 2)
		throw new Error('Pinned SSF observation insertion anchors changed');
	const observation = await readFile(
		path.join(root, 'tetorica_src/wasm/ssf_player/ssf_observer.inc'),
		'utf8',
	);
	await writeFile(
		path.join(observer, 'ssfplay_observer.cpp'),
		upstream.replace(includeAnchor, '#include "sound.cpp"') + '\n' + observation,
	);
	await writeFile(
		path.join(observer, 'scsp.h'),
		header.replace(
			accessAnchor,
			' // Build-only observation and bounded host parameter edit members.\n void TetoricaReadSnapshot(uint32* words, uint8* ram) const;\n bool TetoricaEditVoice(uint32 slot, const uint32* edits, uint32 count);\n\n' +
				accessAnchor,
		),
	);
	await cp(path.join(vendor, 'mednafen/src/ss/sound.cpp'), path.join(observer, 'sound.cpp'));
	const temporary = await mkdtemp(path.join(path.dirname(output), '.ssf-player-'));
	await cp(output, temporary, { recursive: true });
	try {
		run(
			process.env.EMCMAKE ?? 'emcmake',
			[
				process.env.CMAKE ?? 'cmake',
				'-S',
				path.join(root, 'tetorica_src/wasm/ssf_player'),
				'-B',
				build,
				'-DCMAKE_BUILD_TYPE=Release',
			],
			{ env },
		);
		run(process.env.CMAKE ?? 'cmake', ['--build', build, '--target', 'ssfplay', '-j', '3'], {
			env,
		});
		const functions = [
			'_malloc',
			'_free',
			'_ssf_abi_version',
			'_ssf_create',
			'_ssf_render',
			'_ssf_ended',
			'_ssf_destroy',
			'_ssf_last_error',
			'_ssf_native_frame',
			'_ssf_read_snapshot',
			'_ssf_edit_voice',
		];
		run(
			process.env.EMXX ?? 'em++',
			[
				path.join(root, 'tetorica_src/wasm/ssf_player/ssf_player.cpp'),
				path.join(build, 'libssfplay.a'),
				path.join(build, 'libssf_zlib.a'),
				'-I' + path.join(vendor, 'include'),
				'-std=c++17',
				'-O2',
				'-g2',
				'-fexceptions',
				'-fwrapv',
				'-ffp-contract=off',
				'-sDISABLE_EXCEPTION_CATCHING=0',
				'-sMODULARIZE=1',
				'-sEXPORT_ES6=1',
				'-sEXPORT_NAME=createSsfPlayerModule',
				'-sENVIRONMENT=web,worker,node',
				// Emscripten 6 no longer accepts wasmBinary in its default incoming
				// Module API. Preserve the standard hooks plus the renderer's buffer.
				'-sINCOMING_MODULE_JS_API=' +
					JSON.stringify([
						'ENVIRONMENT',
						'arguments',
						'canvas',
						'dynamicLibraries',
						'elementPointerLock',
						'instantiateWasm',
						'locateFile',
						'monitorRunDependencies',
						'noExitRuntime',
						'noInitialRun',
						'onAbort',
						'onExit',
						'onRuntimeInitialized',
						'postRun',
						'preInit',
						'preRun',
						'print',
						'printErr',
						'setStatus',
						'statusMessage',
						'stderr',
						'stdin',
						'stdout',
						'thisProgram',
						'wasm',
						'websocket',
						'wasmBinary',
					]),
				'-sALLOW_MEMORY_GROWTH=1',
				'-sINITIAL_MEMORY=33554432',
				'-sMAXIMUM_MEMORY=134217728',
				'-sSTACK_SIZE=1048576',
				'-sEXPORTED_FUNCTIONS=' + JSON.stringify(functions),
				'-sEXPORTED_RUNTIME_METHODS=' +
					JSON.stringify(['UTF8ToString', 'HEAPU8', 'HEAPF32']),
				'-o',
				path.join(temporary, 'ssf_player.js'),
			],
			{ env },
		);
		// Install a complete generated directory after the linker and reads succeed.
		const files = await Promise.all(
			['ssf_player.js', 'ssf_player.wasm'].map(async (name) => {
				const bytes = await readFile(path.join(temporary, name));
				return {
					path: name,
					bytes: bytes.length,
					sha256: createHash('sha256').update(bytes).digest('hex'),
				};
			}),
		);
		const backup = temporary + '.previous';
		await rename(output, backup);
		try {
			await rename(temporary, output);
		} catch (error) {
			await rename(backup, output);
			throw error;
		}
		await rm(backup, { recursive: true, force: true });
		return { output, build, files };
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const options = {};
	for (const arg of process.argv.slice(2)) {
		const match = /^--(out-dir|build-dir|cache-dir)=(.+)$/.exec(arg);
		if (!match)
			throw new Error(
				'Usage: node scripts/build_ssf_player.mjs [--out-dir=DIR] [--build-dir=DIR] [--cache-dir=DIR]',
			);
		options[
			{ 'out-dir': 'outDir', 'build-dir': 'buildDir', 'cache-dir': 'cacheDir' }[match[1]]
		] = match[2];
	}
	console.log(JSON.stringify(await buildSsfPlayer(options), null, 2));
}
