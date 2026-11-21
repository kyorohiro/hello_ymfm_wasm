// SPDX-License-Identifier: BSD-3-Clause
// Assemble only ROM-boot 2SF sets. See docs/issues/todo_nds_synth_20261121.md.
import { constants } from 'node:fs';
import { mkdtemp, open, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { composeTwoSf, isTwoSfPath } from '../../docs/synth-nitro-ds/2sf_source.js';

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

async function readSource(path, remainingCompressed) {
	// A verified path is still opened without following a swapped final symlink.
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const info = await handle.stat();
		if (!info.isFile()) fail('entry or library is not a regular file');
		if (info.size < 16) fail('truncated 16-byte PSF header');
		if (info.size > remainingCompressed) fail('set exceeds the 128 MiB source budget');
		const bytes = Buffer.alloc(info.size);
		let offset = 0;
		while (offset < bytes.length) {
			const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
			if (bytesRead === 0) fail('entry or library was truncated during load');
			offset += bytesRead;
		}
		return bytes;
	} finally {
		await handle.close();
	}
}

function inflate(compressed, remainingExpanded) {
	const { buffer, engine } = inflateSync(compressed, {
		maxOutputLength: Math.max(1, remainingExpanded),
		info: true,
	});
	if (engine.bytesWritten !== compressed.length) throw new Error('trailing bytes after the zlib stream');
	return buffer;
}

/** Read one .2sf or .mini2sf from disk and apply its library overlays in PSF order. */
export async function assembleTwoSf(entry, { setRoot = dirname(resolve(entry)) } = {}) {
	const rootPath = resolve(setRoot);
	const root = await realpath(rootPath);
	if (!(await stat(root)).isDirectory()) fail('set root must be a directory');
	const entryPath = resolve(entry);
	if (!isTwoSfPath(entryPath)) fail('choose a .2sf or .mini2sf song entry');
	if (!inside(rootPath, entryPath)) fail('entry is outside the selected set');
	const canonicalEntryPath = resolve(root, relative(rootPath, entryPath));
	const main = await resolveWithin(root, canonicalEntryPath);
	// Match psflib's entry-directory convention for all nested libraries.
	const libraryBase = dirname(canonicalEntryPath);
	const { rom, files, tags } = await composeTwoSf(main, {
		readSource,
		inflate,
		displayPath: (path) => relative(root, path),
		async resolveLibrary(name) {
			try {
				return await resolveWithin(root, resolve(libraryBase, name));
			} catch (error) {
				if (error.code !== 'ENOENT') throw error;
			}
		},
	});
	return { rom: Buffer.from(rom.buffer, rom.byteOffset, rom.byteLength), files, tags };
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
