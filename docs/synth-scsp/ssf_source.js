// SPDX-License-Identifier: BSD-3-Clause
// Local SSF / MiniSSF container and dependency loading, before audio startup.
// https://gist.github.com/SaxxonPike/11618bd321a45a70c01febae43ff564e

export const SCSP_SSF_FILES = /\.(?:ssf|minissf|ssflib)$/i;
export const SCSP_SSF_RAM_BYTES = 512 * 1024;
export const MAX_SCSP_SSF_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SET_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_PROGRAM_BYTES = SCSP_SSF_RAM_BYTES + 4;
const MAX_FILES = 512;
const MAX_TAG_BYTES = 50000;
const preparedSets = new WeakSet();
const check = (signal) => signal?.throwIfAborted();
const fail = (message) => {
	throw new Error(`SSF: ${message}`);
};

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
	for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
	return value >>> 0;
});

export function scspSsfCrc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function bytesOf(input) {
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	if (ArrayBuffer.isView(input))
		return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	throw new TypeError('Expected SSF binary data');
}

function signature(bytes, offset, value) {
	return [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}

// Project Files paths may start with one slash. Internal paths are relative to
// the supplied set, and every library remains inside that set.
function filePath(value, base = '', allowProjectRoot = false) {
	if (typeof value !== 'string' || !value || value.length > 1024 || /[\x00-\x1f:]/.test(value))
		fail('expected a relative file or library path');
	if (allowProjectRoot && value.startsWith('/') && !value.startsWith('//'))
		value = value.slice(1);
	if (/^[\\/]/.test(value)) fail('library paths must be relative to their SSF file');
	const parts = base ? base.split('/') : [];
	for (const part of value.replaceAll('\\', '/').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			if (!parts.length) fail('library path escapes the selected file set');
			parts.pop();
		} else parts.push(part);
	}
	if (!parts.length) fail('empty file path');
	return parts.join('/');
}

/** Check the PSF container and compressed CRC before inflating its program. */
export function readScspSsfFile(input) {
	const bytes = bytesOf(input);
	if (bytes.length < 16 || bytes.length > MAX_SCSP_SSF_FILE_BYTES || !signature(bytes, 0, 'PSF'))
		fail('expected an SSF file of 16 bytes–4 MiB');
	if (bytes[3] !== 0x11) fail(`unsupported PSF version ${bytes[3]} (Saturn SSF requires 0x11)`);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const reservedBytes = view.getUint32(4, true);
	const programBytes = view.getUint32(8, true);
	const start = 16 + reservedBytes;
	const end = start + programBytes;
	if (end > bytes.length) fail('truncated reserved or compressed program section');
	const compressed = bytes.slice(start, end);
	if (scspSsfCrc32(compressed) !== view.getUint32(12, true))
		fail('compressed program CRC-32 mismatch');

	const tags = new Map();
	if (signature(bytes, end, '[TAG]')) {
		if (bytes.length - end - 5 > MAX_TAG_BYTES) fail('tags exceed 50,000 bytes');
		const raw = new TextDecoder().decode(bytes.subarray(end + 5));
		if (raw.includes('\0')) fail('NUL in tags');
		const trim = (value) => value.replace(/^[\x01-\x20]+|[\x01-\x20]+$/g, '');
		for (const line of raw.split('\n')) {
			const equal = line.indexOf('=');
			if (equal < 0) continue;
			const name = trim(line.slice(0, equal)).toLowerCase();
			const value = trim(line.slice(equal + 1));
			if (!/^[a-z_][a-z_0-9]*$/.test(name)) continue;
			if (/^_lib(?:\d+)?$/.test(name) && tags.has(name)) fail(`duplicate ${name} tag`);
			tags.set(name, tags.has(name) ? `${tags.get(name)}\n${value}` : value);
		}
	}
	return { compressed, tags, reservedBytes };
}

/** Accept portable {path,data} entries or browser Files retaining folder paths. */
export async function readScspSsfSet(entries, { signal } = {}) {
	if (
		!entries ||
		!Number.isInteger(entries.length) ||
		entries.length < 1 ||
		entries.length > MAX_FILES
	)
		fail('select 1–512 SSF / library files');
	const records = new Map();
	const folded = new Map();
	let totalBytes = 0;
	for (const entry of entries) {
		check(signal);
		const inputPath = entry.path || entry.webkitRelativePath || entry.name;
		const path = filePath(inputPath, '', true);
		const publicPath = inputPath.startsWith('/') ? '/' + path : path;
		if (records.has(path))
			fail(`duplicate path: ${path}. Use folder selection to retain subdirectories.`);
		let bytes;
		if (entry.data !== undefined) bytes = bytesOf(entry.data);
		else {
			if (
				!Number.isSafeInteger(entry.size) ||
				entry.size < 0 ||
				entry.size > MAX_SCSP_SSF_FILE_BYTES
			)
				fail(`file must be 0 bytes–4 MiB: ${path}`);
			if (totalBytes + entry.size > MAX_SET_BYTES) fail('selected files exceed 64 MiB');
			if (typeof entry.arrayBuffer !== 'function') fail(`file has no binary data: ${path}`);
			bytes = new Uint8Array(await entry.arrayBuffer());
			check(signal);
			if (bytes.length !== entry.size) fail(`file size changed: ${path}`);
		}
		if (bytes.length > MAX_SCSP_SSF_FILE_BYTES)
			fail(`file must be 0 bytes–4 MiB: ${path}`);
		totalBytes += bytes.length;
		if (totalBytes > MAX_SET_BYTES) fail('selected files exceed 64 MiB');
		// Folder sets can contain a broken, unrelated song. Remember its error
		// so selecting it fails, while valid entries keep their own dependencies.
		let container;
		try {
			container = readScspSsfFile(bytes);
		} catch (error) {
			container = { error, tags: new Map() };
		}
		records.set(path, { path, publicPath, ...container });
		const key = path.toLowerCase();
		folded.set(key, folded.has(key) ? null : path);
	}
	const set = { records, folded, totalBytes };
	preparedSets.add(set);
	return set;
}

export function listScspSsfEntries(set) {
	if (!preparedSets.has(set)) throw new TypeError('Expected a prepared SSF file set');
	return [...set.records.values()]
		.filter((record) => /\.(?:ssf|minissf)$/i.test(record.path))
		.map((record) => ({ path: record.publicPath, title: record.tags.get('title') ?? '' }));
}

async function inflateProgram(compressed, signal) {
	check(signal);
	if (!compressed.length) return new Uint8Array();
	if (typeof DecompressionStream !== 'function')
		fail('this browser requires zlib DecompressionStream support');
	const reader = new Blob([compressed])
		.stream()
		.pipeThrough(new DecompressionStream('deflate'))
		.getReader();
	const chunks = [];
	let size = 0;
	const cancel = () => {
		void reader.cancel(signal.reason).catch(() => {});
	};
	signal?.addEventListener('abort', cancel, { once: true });
	try {
		for (;;) {
			check(signal);
			const { value, done } = await reader.read();
			check(signal);
			if (done) break;
			size += value.length;
			if (size > MAX_PROGRAM_BYTES)
				fail('expanded program exceeds the 524,292-byte SSF limit');
			chunks.push(value);
		}
	} catch (error) {
		check(signal);
		fail(`zlib decompression failed: ${error.message}`);
	} finally {
		signal?.removeEventListener('abort', cancel);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

/** PSF time tags allow seconds, minutes:seconds or hours:minutes:seconds. */
export function parseScspSsfTime(value) {
	if (typeof value !== 'string' || /[\r\n]/.test(value)) return null;
	const parts = value.trim().replace(',', '.').split(':');
	if (
		parts.length > 3 ||
		!/^\d+(?:\.\d+)?$/.test(parts.at(-1)) ||
		parts.slice(0, -1).some((part) => !/^\d+$/.test(part))
	)
		return null;
	const numbers = parts.map(Number);
	if ((parts.length > 1 && numbers.at(-1) >= 60) || (parts.length === 3 && numbers[1] >= 60))
		return null;
	const seconds = numbers.reduce((sum, part) => sum * 60 + part, 0);
	return Number.isFinite(seconds) && seconds >= 0 && seconds <= Number.MAX_SAFE_INTEGER / 44100
		? seconds
		: null;
}

/** Compose _lib -> own program -> _lib2, _lib3... into one native RAM image.
 * The resulting image has Motorola big-endian bytes. Only each segment's
 * four-byte load address is little-endian. Missing duration stays explicit.
 */
export async function prepareScspSsfSource(entries, entryPath, { signal } = {}) {
	check(signal);
	const set = preparedSets.has(entries) ? entries : await readScspSsfSet(entries, { signal });
	const selectedPath = filePath(entryPath, '', true);
	const entry = set.records.get(selectedPath);
	if (!entry || /\.ssflib$/i.test(entry.path)) fail('choose an SSF or MiniSSF song entry');
	const ram = new Uint8Array(SCSP_SSF_RAM_BYTES);
	const coverage = new Uint8Array(SCSP_SSF_RAM_BYTES);
	const cache = new Map();
	const loadedFiles = [];
	let expandedBytes = 0;
	let visits = 0;

	function dependency(record, name) {
		const requested = filePath(name, record.path.split('/').slice(0, -1).join('/'));
		if (set.records.has(requested)) return set.records.get(requested);
		const match = set.folded.get(requested.toLowerCase());
		if (match) return set.records.get(match);
		if (set.folded.has(requested.toLowerCase())) fail(`ambiguous library path: ${requested}`);
		fail(
			`missing SSFLib ${requested} (from ${record.path}). Select the related files or open their folder.`,
		);
	}

	async function program(record) {
		if (cache.has(record.path)) return cache.get(record.path);
		const bytes = await inflateProgram(record.compressed, signal);
		expandedBytes += bytes.length;
		if (expandedBytes > MAX_EXPANDED_BYTES)
			fail('dependency programs exceed the 32 MiB expanded budget');
		if (bytes.length && bytes.length < 4)
			fail(`truncated program load address: ${record.path}`);
		const address = bytes.length ? new DataView(bytes.buffer).getUint32(0, true) : 0;
		const data = bytes.subarray(Math.min(4, bytes.length));
		if (address > SCSP_SSF_RAM_BYTES || data.length > SCSP_SSF_RAM_BYTES - address)
			fail(`program lies outside 512 KiB sound RAM: ${record.path}`);
		const result = { address, data };
		cache.set(record.path, result);
		return result;
	}

	async function load(record, stack = []) {
		check(signal);
		if (record.error) throw record.error;
		if (stack.includes(record.path))
			fail(`cyclic library reference: ${[...stack, record.path].join(' → ')}`);
		if (stack.length >= 10 || ++visits > 256) fail('library depth / visit limit exceeded');
		const next = [...stack, record.path];
		if (record.tags.has('_lib')) await load(dependency(record, record.tags.get('_lib')), next);
		const { address, data } = await program(record);
		check(signal);
		ram.set(data, address);
		coverage.fill(1, address, address + data.length);
		loadedFiles.push(record.publicPath);
		for (let index = 2; record.tags.has(`_lib${index}`); index++)
			await load(dependency(record, record.tags.get(`_lib${index}`)), next);
	}

	await load(entry);
	check(signal);
	const tags = new Map(entry.tags);
	const lengthSeconds = parseScspSsfTime(tags.get('length'));
	const fadeSeconds = parseScspSsfTime(tags.get('fade')) ?? 0;
	const durationSeconds = lengthSeconds === null ? null : lengthSeconds + fadeSeconds;
	if (durationSeconds !== null && durationSeconds > Number.MAX_SAFE_INTEGER / 44100)
		fail('length plus fade is too large');
	const rawVolume = tags.get('volume');
	const volume = rawVolume === undefined ? 1 : Number(rawVolume);
	const warnings = [];
	if (tags.has('length') && lengthSeconds === null)
		warnings.push('Invalid length tag; duration is unknown.');
	if (tags.has('fade') && parseScspSsfTime(tags.get('fade')) === null)
		warnings.push('Invalid fade tag; fade is zero.');
	if (rawVolume !== undefined && (!rawVolume.trim() || !Number.isFinite(volume)))
		warnings.push('Invalid volume tag; relative volume is 1.');
	const metadata = Object.fromEntries(
		['title', 'game', 'artist', 'copyright', 'year', 'genre', 'comment'].map((name) => [
			name,
			tags.get(name) ?? '',
		]),
	);
	return {
		kind: 'ssf',
		format: tags.has('_lib') || tags.has('_lib2') ? 'MiniSSF' : 'SSF',
		entryPath: entry.publicPath,
		ram,
		coverage,
		tags,
		metadata,
		loadedFiles,
		expandedBytes,
		sampleRate: 44100,
		lengthSeconds,
		fadeSeconds,
		durationSeconds,
		totalSamples: durationSeconds === null ? null : Math.round(durationSeconds * 44100),
		volume:
			rawVolume !== undefined && (!rawVolume.trim() || !Number.isFinite(volume)) ? 1 : volume,
		warnings,
	};
}
