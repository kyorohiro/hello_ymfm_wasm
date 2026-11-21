// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { scspSsfCrc32 as crc32 } from '../../docs/synth-scsp/ssf_source.js';
import { assembleTwoSf } from './assemble.mjs';

function container({ offset = 0, data, tags = '', reserved = '', version = 0x24, encoded } = {}) {
	const header = Buffer.alloc(16);
	header.write('PSF');
	header[3] = version;
	let program = Buffer.alloc(0);
	if (data !== undefined) {
		const bytes = Buffer.from(data);
		const overlay = Buffer.alloc(8 + bytes.length);
		overlay.writeUInt32LE(offset);
		overlay.writeUInt32LE(bytes.length, 4);
		bytes.copy(overlay, 8);
		program = deflateSync(overlay);
	}
	if (encoded !== undefined) program = encoded;
	header.writeUInt32LE(Buffer.byteLength(reserved), 4);
	header.writeUInt32LE(program.length, 8);
	header.writeUInt32LE(crc32(program), 12);
	return Buffer.concat([header, Buffer.from(reserved), program, Buffer.from(tags ? `[TAG]${tags}` : '')]);
}

async function tempSet(t) {
	const root = await mkdtemp(join(tmpdir(), 'tetorica-2sf-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

test('nested references use the entry directory and numbered libraries apply after the song', async t => {
	const root = await tempSet(t);
	await mkdir(join(root, 'songs', 'library'), { recursive: true });
	await writeFile(join(root, 'Base.2sflib'), container({ data: [1, 2, 3, 4] }));
	await writeFile(join(root, 'songs', 'library', 'chain.2sflib'),
		container({ offset: 1, data: [5], tags: '_lib=../base.2sflib' }));
	await writeFile(join(root, 'songs', 'post.2sflib'), container({ offset: 2, data: [6] }));
	const song = join(root, 'songs', 'Track.mini2sf');
	await writeFile(song, container({ offset: 2, data: [7], tags: 'Title=Track\r\n_LIB=library\\chain.2sflib\r\n_lib2=post.2sflib' }));
	const result = await assembleTwoSf(song, { setRoot: root });
	assert.deepEqual(result.rom, Buffer.from([1, 5, 6, 4]));
	assert.equal(result.tags.get('title'), 'Track');
	assert.deepEqual(result.files.map(path => path.split(/[\\/]/).at(-1).toLowerCase()),
		['base.2sflib', 'chain.2sflib', 'track.mini2sf', 'post.2sflib']);
});

test('standalone overlays zero-fill gaps and round the cartridge size to a power of two', async t => {
	const root = await tempSet(t);
	const song = join(root, 'Standalone.2sf');
	await writeFile(song, container({ offset: 3, data: [6, 7], tags: '_frames=0' }));
	const { rom } = await assembleTwoSf(song);
	assert.deepEqual(rom, Buffer.from([0, 0, 0, 6, 7, 0, 0, 0]));
});

test('refuses bad integrity, out-of-bounds overlays and unsupported 2SF variants', async t => {
	const root = await tempSet(t);
	const song = join(root, 'Invalid.2sf');
	const badCrc = container({ data: [0] });
	badCrc[12] ^= 1;
	const invalidLength = Buffer.alloc(8);
	invalidLength.writeUInt32LE(4, 4);
	const cases = [
		[badCrc, /CRC-32 mismatch/],
		[container({ data: [0], version: 1 }), /expected PSF version 0x24/],
		[container({ data: [0], offset: 0xffffffff }), /ROM overlay exceeds/],
		[container({ encoded: deflateSync(invalidLength) }), /ROM overlay length does not match/],
		[container({ encoded: Buffer.concat([deflateSync(Buffer.alloc(8)), Buffer.of(1)]) }), /trailing bytes after the zlib stream/],
		[container({ reserved: 'SAVE' }), /SAVE blocks require legacy emulator save states/],
		[container({ tags: '_frames=1' }), /unsupported required tag _frames=1/],
		[container({ tags: '_lib3=x.2sflib' }), /must be consecutive from _lib2/],
	];
	for (const [bytes, error] of cases) {
		await writeFile(song, bytes);
		await assert.rejects(assembleTwoSf(song), error);
	}
});

test('rejects missing, cyclic and out-of-set dependencies including symlinks', async t => {
	const root = await tempSet(t);
	const song = join(root, 'Track.mini2sf');
	await writeFile(song, container({ tags: '_lib=missing.2sflib' }));
	await assert.rejects(assembleTwoSf(song), /missing library missing.2sflib/);

	await writeFile(song, container({ tags: '_lib=cycle.2sflib' }));
	await writeFile(join(root, 'cycle.2sflib'), container({ tags: '_lib=Track.mini2sf' }));
	await assert.rejects(assembleTwoSf(song), /cyclic library reference/);

	await writeFile(song, container({ tags: '_lib=../escape.2sflib' }));
	await assert.rejects(assembleTwoSf(song), /library path escapes the selected set/);

	const other = await tempSet(t);
	const external = join(other, 'external.2sflib');
	await writeFile(external, container({ data: [1] }));
	await symlink(external, join(root, 'escape.2sflib'), 'file');
	await writeFile(song, container({ tags: '_lib=escape.2sflib' }));
	await assert.rejects(assembleTwoSf(song), /library path escapes the selected set/);
});

test('CLI leaves existing output untouched on invalid input', async t => {
	const root = await tempSet(t);
	const song = join(root, 'Broken.2sf');
	const output = join(root, 'output.nds');
	await writeFile(song, container({ tags: '_lib=missing.2sflib' }));
	await writeFile(output, 'previous output');
	const script = fileURLToPath(new URL('./assemble.mjs', import.meta.url));
	const result = spawnSync(process.execPath, [script, song, output], { encoding: 'utf8' });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /missing library missing\.2sflib/);
	assert.equal(await readFile(output, 'utf8'), 'previous output');
});
