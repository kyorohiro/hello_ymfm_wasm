// SPDX-License-Identifier: BSD-3-Clause
// Assemble only ROM-boot 2SF sets. See docs/issues/todo_nds_synth_20261121.md.
import { constants } from 'node:fs';
import { mkdtemp, open, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { scspSsfCrc32 as crc32 } from '../../docs/synth-scsp/ssf_source.js';

const MIB = 1024 * 1024;
const MAX_COMPRESSED = 128 * MIB;
const MAX_ROM = 256 * MIB;
const MAX_EXPANDED = MAX_ROM + 8;
const MAX_TAG_BYTES = 50_000;
const MAX_DEPTH = 10;
const MAX_VISITS = 128;
const DEFAULT_OPTIONS = new Map([
	['_frames', new Set(['-1', '0'])],
	['_clockdown', new Set(['0'])],
	['_vio2sf_sync_type', new Set(['0'])],
	['_vio2sf_arm7_clockdown_level', new Set(['0'])],
	['_vio2sf_arm9_clockdown_level', new Set(['0'])],
]);

function fail(message) {
	throw new Error(`2SF: ${message}`);
}

function inside(root, path) {
	const local = relative(root, path);
	return local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}

async function resolveWithin(root, path) {
	if (!inside(root, path)) fail('library path escapes the selected set');
	let current = root;
	for (const name of relative(root, path).split(sep).filter(Boolean)) {
		try {
			current = await realpath(join(current, name));
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
			const folded = name.toLowerCase();
			const matches = (await readdir(current)).filter(part => part.toLowerCase() === folded);
			if (matches.length > 1) fail(`ambiguous library filename: ${name}`);
			if (!matches.length) throw error;
			current = await realpath(join(current, matches[0]));
		}
		if (!inside(root, current)) fail(`library path escapes the selected set: ${name}`);
	}
	return current;
}

function readTags(bytes) {
	if (bytes.length === 0) return new Map();
	if (bytes.length < 5 || bytes.toString('ascii', 0, 5) !== '[TAG]') fail('unexpected data after the program');
	if (bytes.length - 5 > MAX_TAG_BYTES) fail('tags exceed 50,000 bytes');
	const content = bytes.toString('utf8', 5);
	if (content.includes('\0')) fail('NUL in tags');

	const tags = new Map();
	for (const line of content.split(/\r\n?|\n/)) {
		const delimiter = line.indexOf('=');
		if (delimiter === -1) continue;
		const name = line.slice(0, delimiter).trim().toLowerCase();
		if (!name) continue;
		const value = line.slice(delimiter + 1).trim();
		if (name.startsWith('_') && tags.has(name)) fail(`duplicate required tag ${name}`);
		tags.set(name, tags.has(name) ? `${tags.get(name)}\n${value}` : value);
	}
	return tags;
}

function libraryNumber(name) {
	if (name === '_lib') return 1;
	const suffix = /^_lib([1-9]\d*)$/.exec(name);
	if (suffix && Number(suffix[1]) >= 2) return Number(suffix[1]);
	return 0;
}

function readLibraries(tags) {
	const libraries = new Map();
	for (const [name, value] of tags) {
		const number = libraryNumber(name);
		if (number) {
			if (number > MAX_VISITS) fail(`library number exceeds ${MAX_VISITS}: ${name}`);
			if (!value || value.length > 1024 || /[\x00-\x1f:]/.test(value) || /^[\\/]/.test(value)) {
				fail(`invalid relative library path in ${name}`);
			}
			libraries.set(number, value.replaceAll('\\', '/'));
		} else if (name.startsWith('_') && !DEFAULT_OPTIONS.get(name)?.has(value)) {
			fail(`unsupported required tag ${name}=${value}. This prototype only plays ROM-boot sets at default timing.`);
		}
	}
	const after = [...libraries].filter(([number]) => number > 1).sort(([a], [b]) => a - b);
	for (let index = 0; index < after.length; index++) {
		if (after[index][0] !== index + 2) fail(`numbered library tags must be consecutive from _lib2`);
	}
	return { before: libraries.get(1), after: after.map(([, value]) => value) };
}

async function readContainer(path, remainingCompressed, remainingExpanded) {
	// A verified path is still opened without following a swapped final symlink.
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	let bytes;
	try {
		const info = await handle.stat();
		if (!info.isFile()) fail('entry or library is not a regular file');
		if (info.size < 16) fail('truncated 16-byte PSF header');
		if (info.size > remainingCompressed) fail(`set exceeds the ${MAX_COMPRESSED / MIB} MiB source budget`);
		bytes = Buffer.alloc(info.size);
		let offset = 0;
		while (offset < bytes.length) {
			const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
			if (bytesRead === 0) fail('entry or library was truncated during load');
			offset += bytesRead;
		}
	} finally {
		await handle.close();
	}

	if (!bytes.subarray(0, 3).equals(Buffer.from('PSF')) || bytes[3] !== 0x24) fail('expected PSF version 0x24');
	const reservedLength = bytes.readUInt32LE(4);
	const programStart = 16 + reservedLength;
	const programEnd = programStart + bytes.readUInt32LE(8);
	if (programEnd > bytes.length) fail('truncated reserved or compressed program');
	if (reservedLength) {
		if (bytes.toString('ascii', 16, 20) === 'SAVE') fail('SAVE blocks require legacy emulator save states');
		fail('unsupported reserved data. This prototype only plays ROM-boot sets.');
	}
	const compressed = bytes.subarray(programStart, programEnd);
	if (crc32(compressed) !== bytes.readUInt32LE(12)) fail('compressed program CRC-32 mismatch');
	const tags = readTags(bytes.subarray(programEnd));
	const libraries = readLibraries(tags);

	let offset = 0;
	let data = Buffer.alloc(0);
	let expandedSize = 0;
	if (compressed.length) {
		let inflated;
		try {
			const { buffer, engine } = inflateSync(compressed, {
				maxOutputLength: Math.max(1, remainingExpanded),
				info: true,
			});
			if (engine.bytesWritten !== compressed.length) throw new Error('trailing bytes after the zlib stream');
			inflated = buffer;
		} catch (error) {
			fail(`invalid zlib program or expanded budget exceeded: ${error.message}`);
		}
		if (inflated.length < 8) fail('truncated ROM overlay header');
		expandedSize = inflated.length;
		offset = inflated.readUInt32LE(0);
		const length = inflated.readUInt32LE(4);
		if (inflated.length !== 8 + length) fail('ROM overlay length does not match the decompressed program');
		if (offset + length > MAX_ROM) fail(`ROM overlay exceeds ${MAX_ROM / MIB} MiB`);
		data = inflated.subarray(8);
	}
	return { tags, libraries, offset, data, expandedSize, sourceSize: bytes.length };
}

/** Read one .2sf or .mini2sf and apply its library overlays in PSF order. */
export async function assembleTwoSf(entry, { setRoot = dirname(resolve(entry)) } = {}) {
	const rootPath = resolve(setRoot);
	const root = await realpath(rootPath);
	if (!(await stat(root)).isDirectory()) fail('set root must be a directory');
	const entryPath = resolve(entry);
	if (!/\.(?:2sf|mini2sf)$/i.test(entryPath)) fail('choose a .2sf or .mini2sf song entry');
	if (!inside(rootPath, entryPath)) fail('entry is outside the selected set');
	const canonicalEntryPath = resolve(root, relative(rootPath, entryPath));
	const main = await resolveWithin(root, canonicalEntryPath);
	// Match psflib's entry-directory convention for all nested libraries.
	const libraryBase = dirname(canonicalEntryPath);

	const overlays = [];
	const containers = new Map();
	const files = [];
	let visits = 0;
	let sourceBytes = 0;
	let expandedBytes = 0;
	let appliedBytes = 0;
	let romLength = 0;

	async function load(path, stack) {
		const local = relative(root, path);
		if (stack.includes(path)) fail(`cyclic library reference: ${[...stack, path].map(file => relative(root, file)).join(' → ')}`);
		if (stack.length >= MAX_DEPTH || ++visits > MAX_VISITS) fail('library depth or visit limit exceeded');
		let record = containers.get(path);
		if (!record) {
			try {
				record = await readContainer(path, MAX_COMPRESSED - sourceBytes, MAX_EXPANDED - expandedBytes);
			} catch (error) {
				throw new Error(`${local}: ${error.message}`, { cause: error });
			}
			sourceBytes += record.sourceSize;
			expandedBytes += record.expandedSize;
			containers.set(path, record);
		}

		const next = [...stack, path];
		async function loadLibrary(name) {
			let dependency;
			try {
				dependency = await resolveWithin(root, resolve(libraryBase, name));
			} catch (error) {
				if (error.code === 'ENOENT') fail(`missing library ${name} (from ${local})`);
				throw error;
			}
			await load(dependency, next);
		}

		const { before, after } = record.libraries;
		if (before) await loadLibrary(before);
		if (record.data.length) {
			appliedBytes += record.data.length;
			if (appliedBytes > MAX_EXPANDED) fail('combined ROM overlay size exceeds the expanded budget');
			overlays.push(record);
			romLength = Math.max(romLength, record.offset + record.data.length);
		}
		files.push(local);
		for (const name of after) await loadLibrary(name);
	}

	await load(main, []);
	if (romLength === 0) fail('the set contains no ROM data');
	// DS cartridge reads mirror at a power-of-two boundary. Preserve that size
	// even when sparse 2SF programs end inside the cartridge image.
	const rom = Buffer.alloc(2 ** Math.ceil(Math.log2(romLength)));
	for (const { offset, data } of overlays) data.copy(rom, offset);
	return { rom, files, tags: containers.get(main).tags };
}

async function runCli(args) {
	if (args.length < 2 || args.length > 3 || args.includes('--help')) {
		console.log('Usage: node scripts/nds-2sf/assemble.mjs ENTRY OUTPUT.nds [SET_ROOT]');
		if (!args.includes('--help')) process.exitCode = 1;
		return;
	}
	const [entry, destination, setRoot] = args;
	const output = resolve(destination);
	if (!/\.nds$/i.test(output)) fail('output must have a .nds extension');
	const { rom, files, tags } = await assembleTwoSf(entry, { setRoot });
	const root = await realpath(setRoot ?? dirname(resolve(entry)));
	const outputDirectory = await realpath(dirname(output));
	const target = join(outputDirectory, basename(output));
	const canonicalTarget = await realpath(target).catch(error => {
		if (error.code !== 'ENOENT') throw error;
		return target;
	});
	if (files.some(path => resolve(root, path) === canonicalTarget)) fail('output would replace a source file');

	const tempDirectory = await mkdtemp(join(outputDirectory, '.2sf-output-'));
	try {
		const temp = join(tempDirectory, 'image.nds');
		await writeFile(temp, rom);
		await rename(temp, target);
	} finally {
		await rm(tempDirectory, { recursive: true, force: true });
	}
	console.log(JSON.stringify({ title: tags.get('title') ?? '', bytes: rom.length, files }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		await runCli(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
