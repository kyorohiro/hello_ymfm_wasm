// SPDX-License-Identifier: BSD-3-Clause
// Compose ROM-boot 2SF files in PSF library order without changing the source set.
import { scspSsfCrc32 as crc32 } from '../synth-scsp/ssf_source.js';

const MIB = 1024 * 1024;
const MAX_COMPRESSED = 128 * MIB;
const MAX_ROM = 256 * MIB;
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
const decode = new TextDecoder();

export const isTwoSfPath = (path) => typeof path === 'string' && /\.(?:2sf|mini2sf)$/i.test(path);
export const isTwoSfSourcePath = (path) =>
	typeof path === 'string' && /\.(?:2sf|mini2sf|2sflib)$/i.test(path);

function fail(message) {
	throw new Error(`2SF: ${message}`);
}

function signature(bytes, offset, ascii) {
	return [...ascii].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}

function readTags(bytes) {
	if (bytes.length === 0) return new Map();
	if (!signature(bytes, 0, '[TAG]')) fail('unexpected data after the program');
	if (bytes.length - 5 > MAX_TAG_BYTES) fail('tags exceed 50,000 bytes');
	const content = decode.decode(bytes.subarray(5));
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
			if (!value || value.length > 1024 || /[\x00-\x1f:]/.test(value) || /^[\\/]/.test(value))
				fail(`invalid relative library path in ${name}`);
			libraries.set(number, value.replaceAll('\\', '/'));
		} else if (name.startsWith('_') && !DEFAULT_OPTIONS.get(name)?.has(value)) {
			fail(`unsupported required tag ${name}=${value}. This prototype only plays ROM-boot sets at default timing.`);
		}
	}
	const after = [...libraries].filter(([number]) => number > 1).sort(([a], [b]) => a - b);
	for (let index = 0; index < after.length; index++) {
		if (after[index][0] !== index + 2) fail('numbered library tags must be consecutive from _lib2');
	}
	return { before: libraries.get(1), after: after.map(([, value]) => value) };
}

async function readContainer(bytes, maxRomBytes, expandedBudget, inflate, signal) {
	if (bytes.length < 16) fail('truncated 16-byte PSF header');
	if (!signature(bytes, 0, 'PSF') || bytes[3] !== 0x24) fail('expected PSF version 0x24');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const reservedLength = view.getUint32(4, true);
	const programStart = 16 + reservedLength;
	const programEnd = programStart + view.getUint32(8, true);
	if (programEnd > bytes.length) fail('truncated reserved or compressed program');
	if (reservedLength) {
		if (signature(bytes, 16, 'SAVE')) fail('SAVE blocks require legacy emulator save states');
		fail('unsupported reserved data. This prototype only plays ROM-boot sets.');
	}
	const compressed = bytes.subarray(programStart, programEnd);
	if (crc32(compressed) !== view.getUint32(12, true)) fail('compressed program CRC-32 mismatch');
	const tags = readTags(bytes.subarray(programEnd));
	const libraries = readLibraries(tags);
	if (!compressed.length)
		return { tags, libraries, offset: 0, data: new Uint8Array(), expandedSize: 0 };

	let inflated;
	try {
		inflated = await inflate(compressed, expandedBudget, signal);
	} catch (error) {
		signal?.throwIfAborted();
		fail(`invalid zlib program or expanded budget exceeded: ${error.message}`);
	}
	if (inflated.length > expandedBudget) fail('dependency programs exceed the expanded budget');
	if (inflated.length < 8) fail('truncated ROM overlay header');
	const overlay = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
	const offset = overlay.getUint32(0, true);
	const length = overlay.getUint32(4, true);
	if (inflated.length !== 8 + length) fail('ROM overlay length does not match the decompressed program');
	if (offset + length > maxRomBytes) fail(`ROM overlay exceeds the ${maxRomBytes}-byte ROM limit`);
	return { tags, libraries, offset, data: inflated.subarray(8), expandedSize: inflated.length };
}

async function inflateProgram(compressed, limit, signal) {
	if (typeof DecompressionStream !== 'function')
		throw new Error('this browser requires zlib DecompressionStream support');
	// Small input chunks bound the amount of expanded data emitted in one step.
	let offset = 0;
	const input = new ReadableStream({ pull(controller) {
		const next = Math.min(offset + 16 * 1024, compressed.length);
		controller.enqueue(compressed.subarray(offset, next));
		offset = next;
		if (offset === compressed.length) controller.close();
	} });
	const reader = input.pipeThrough(new DecompressionStream('deflate')).getReader();
	const chunks = [];
	let size = 0;
	const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
	signal?.addEventListener('abort', cancel, { once: true });
	try {
		for (;;) {
			signal?.throwIfAborted();
			const { value, done } = await reader.read();
			signal?.throwIfAborted();
			if (done) break;
			size += value.length;
			if (size > limit) throw new Error('dependency programs exceed the expanded budget');
			chunks.push(value);
		}
	} finally {
		signal?.removeEventListener('abort', cancel);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	const output = new Uint8Array(size);
	offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

/** Apply the common PSF loader to a set backed by portable Files or the Node CLI. */
export async function composeTwoSf(main, {
	readSource, resolveLibrary, displayPath, inflate = inflateProgram, maxRomBytes = MAX_ROM, signal,
}) {
	if (!Number.isSafeInteger(maxRomBytes) || maxRomBytes < 1 || maxRomBytes > MAX_ROM)
		throw new RangeError('2SF ROM limit must be an integer from 1 to 256 MiB in bytes');
	const maxExpanded = maxRomBytes + 8;
	const overlays = [];
	const containers = new Map();
	const files = [];
	let visits = 0;
	let sourceBytes = 0;
	let expandedBytes = 0;
	let appliedBytes = 0;
	let romLength = 0;

	async function load(path, stack) {
		signal?.throwIfAborted();
		const local = displayPath(path);
		if (stack.includes(path)) fail(`cyclic library reference: ${[...stack, path].map(displayPath).join(' → ')}`);
		if (stack.length >= MAX_DEPTH || ++visits > MAX_VISITS) fail('library depth or visit limit exceeded');
		let record = containers.get(path);
		if (!record) {
			try {
				const remaining = MAX_COMPRESSED - sourceBytes;
				const bytes = await readSource(path, remaining);
				signal?.throwIfAborted();
				if (bytes.length > remaining) fail(`set exceeds the ${MAX_COMPRESSED / MIB} MiB source budget`);
				record = await readContainer(bytes, maxRomBytes, maxExpanded - expandedBytes, inflate, signal);
				sourceBytes += bytes.length;
			} catch (error) {
				signal?.throwIfAborted();
				throw new Error(`${local}: ${error.message}`, { cause: error });
			}
			expandedBytes += record.expandedSize;
			containers.set(path, record);
		}

		const next = [...stack, path];
		async function loadLibrary(name) {
			const dependency = await resolveLibrary(name);
			if (dependency === undefined) fail(`missing library ${name} (from ${local})`);
			await load(dependency, next);
		}

		const { before, after } = record.libraries;
		if (before) await loadLibrary(before);
		if (record.data.length) {
			appliedBytes += record.data.length;
			if (appliedBytes > maxExpanded) fail('combined ROM overlay size exceeds the expanded budget');
			overlays.push(record);
			romLength = Math.max(romLength, record.offset + record.data.length);
		}
		files.push(local);
		for (const name of after) await loadLibrary(name);
	}

	await load(main, []);
	signal?.throwIfAborted();
	if (romLength === 0) fail('the set contains no ROM data');
	// DS cartridge reads mirror at a power-of-two boundary.
	const cartridgeBytes = 2 ** Math.ceil(Math.log2(romLength));
	if (cartridgeBytes > maxRomBytes) fail(`cartridge image exceeds the ${maxRomBytes}-byte ROM limit`);
	const rom = new Uint8Array(cartridgeBytes);
	for (const { offset, data } of overlays) rom.set(data, offset);
	return { rom, files, tags: containers.get(main).tags };
}

function normalizePath(value, base = '') {
	if (typeof value !== 'string' || !value || /[\x00-\x1f:]/.test(value) || /^[\\/]{2}|^\\/.test(value))
		fail('invalid relative set path');
	const parts = base ? base.split('/') : [];
	for (const part of value.replaceAll('\\', '/').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			if (!parts.length) fail('library path escapes the selected set');
			parts.pop();
		} else parts.push(part);
	}
	return parts.join('/');
}

/** Read one song from portable {path,data} entries or browser Files. */
export async function assembleTwoSf(entryPath, entries, { setRoot = '', maxRomBytes, signal } = {}) {
	signal?.throwIfAborted();
	if (!isTwoSfPath(entryPath)) fail('choose a .2sf or .mini2sf song entry');
	const main = normalizePath(entryPath);
	const base = main.split('/').slice(0, -1).join('/');
	const root = setRoot ? normalizePath(setRoot) : '';
	const inside = (path) => !root || path.startsWith(`${root}/`);
	if (!inside(main)) fail('entry is outside the selected set');
	const records = new Map();
	const folded = new Map();
	for (const entry of entries) {
		signal?.throwIfAborted();
		const displayPath = entry.path || entry.webkitRelativePath || entry.name;
		if (!isTwoSfSourcePath(displayPath)) continue;
		const path = normalizePath(displayPath);
		if (!inside(path)) continue;
		if (records.has(path)) fail(`duplicate file path: ${displayPath}`);
		records.set(path, { entry, displayPath });
		const key = path.toLowerCase();
		folded.set(key, folded.has(key) ? null : path);
	}
	if (!records.has(main)) fail(`song entry is absent from the selected set: ${entryPath}`);

	return composeTwoSf(main, {
		maxRomBytes,
		signal,
		displayPath: (path) => records.get(path).displayPath,
		resolveLibrary(name) {
			const requested = normalizePath(name, base);
			if (!inside(requested)) fail('library path escapes the selected set');
			if (records.has(requested)) return requested;
			const match = folded.get(requested.toLowerCase());
			if (match === null) fail(`ambiguous library filename: ${name}`);
			return match;
		},
		async readSource(path, remaining) {
			const { entry } = records.get(path);
			if ((entry.data?.byteLength ?? entry.size) > remaining)
				fail(`set exceeds the ${MAX_COMPRESSED / MIB} MiB source budget`);
			const data = entry.data ?? await entry.arrayBuffer();
			if (data instanceof Uint8Array) return data;
			if (data instanceof ArrayBuffer) return new Uint8Array(data);
			throw new TypeError('expected 2SF binary data');
		},
	});
}
