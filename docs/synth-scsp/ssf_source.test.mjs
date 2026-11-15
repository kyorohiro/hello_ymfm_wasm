// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	MAX_SCSP_SSF_FILE_BYTES,
	SCSP_SSF_RAM_BYTES,
	readScspSsfFile,
	readScspSsfSet,
	listScspSsfEntries,
	prepareScspSsfSource,
	parseScspSsfTime,
	scspSsfCrc32,
} from './ssf_source.js';
import { psfFromExe, fixtureCrc32 } from '../../test/helpers/spu_psf_fixture.mjs';
import {
	ssfFromProgram,
	createScspSsfContainerFixture,
	createScspSsfPlaybackFixture,
} from '../../test/helpers/scsp_ssf_fixture.mjs';

const entry = (path, data) => ({ path, data });

test('standalone SSF composes big-endian program bytes and preserves source paths and tags', async () => {
	const fixture = createScspSsfContainerFixture();
	const original = fixture.standalone.slice();
	const set = await readScspSsfSet([entry('/ssf/standalone.ssf', fixture.standalone)]);
	assert.deepEqual(listScspSsfEntries(set), [
		{ path: '/ssf/standalone.ssf', title: 'Original SSF container' },
	]);
	const source = await prepareScspSsfSource(set, '/ssf/standalone.ssf');
	assert.equal(source.kind, 'ssf');
	assert.equal(source.format, 'SSF');
	assert.equal(source.entryPath, '/ssf/standalone.ssf');
	assert.deepEqual(source.loadedFiles, ['/ssf/standalone.ssf']);
	assert.equal(source.ram.length, SCSP_SSF_RAM_BYTES);
	assert.deepEqual(source.ram.subarray(0, fixture.image.length), fixture.image);
	assert.equal(new DataView(source.ram.buffer).getUint32(4, false), 0x20);
	assert(source.coverage.subarray(0, fixture.image.length).every((value) => value === 1));
	assert(source.coverage.subarray(fixture.image.length).every((value) => value === 0));
	assert.equal(source.lengthSeconds, 2);
	assert.equal(source.fadeSeconds, 0.5);
	assert.equal(source.durationSeconds, 2.5);
	assert.equal(source.totalSamples, 110250);
	assert.equal(source.metadata.title, 'Original SSF container');
	assert.deepEqual(fixture.standalone, original);
	source.ram[0] = 99;
	const again = await prepareScspSsfSource(set, '/ssf/standalone.ssf');
	assert.equal(again.ram[0], fixture.image[0]);
});

test('a .ssf with library tags uses recursive primary then main then ordered auxiliary overlays', async () => {
	const fixture = createScspSsfContainerFixture();
	const source = await prepareScspSsfSource(fixture.files, 'Demo/track.ssf');
	assert.equal(source.format, 'MiniSSF');
	assert.deepEqual(source.loadedFiles, [
		'Demo/lib/Driver.ssflib',
		'Demo/track.ssf',
		'Demo/patch.ssflib',
	]);
	assert.deepEqual([...source.ram.subarray(0x30, 0x32)], [1, 3]);
	const files = [
		entry(
			'song.ssf',
			ssfFromProgram(
				Uint8Array.of(1),
				50,
				'_lib=base.ssflib\n_lib2=aux.ssflib\n_lib4=absent.ssflib\n',
			),
		),
		entry('base.ssflib', ssfFromProgram(Uint8Array.of(2, 3), 49, '_lib=deep.ssflib\n')),
		entry('deep.ssflib', ssfFromProgram(Uint8Array.of(4, 5), 48)),
		entry('aux.ssflib', ssfFromProgram(Uint8Array.of(6), 50)),
	];
	const nested = await prepareScspSsfSource(files, 'song.ssf');
	assert.deepEqual(nested.loadedFiles, ['deep.ssflib', 'base.ssflib', 'song.ssf', 'aux.ssflib']);
	assert.deepEqual([...nested.ram.subarray(48, 51)], [4, 2, 6]);
});

test('relative library paths normalize separators, parent paths and unambiguous case fallback', async () => {
	const files = [
		entry(
			'/ssf/Demo/tracks/tune.minissf',
			ssfFromProgram(Uint8Array.of(9), 7, '_lib=..\\LIB\\driver.ssflib\n'),
		),
		entry('/ssf/Demo/lib/Driver.ssflib', ssfFromProgram(Uint8Array.of(5, 6), 6)),
	];
	const source = await prepareScspSsfSource(files, '/ssf/Demo/tracks/tune.minissf');
	assert.deepEqual(source.loadedFiles, [
		'/ssf/Demo/lib/Driver.ssflib',
		'/ssf/Demo/tracks/tune.minissf',
	]);
	assert.deepEqual([...source.ram.subarray(6, 8)], [5, 9]);
	const ambiguous = [
		entry('tune.ssf', ssfFromProgram(new Uint8Array(), 0, '_lib=DRIVER.ssflib\n')),
		entry('Driver.ssflib', ssfFromProgram(Uint8Array.of(1))),
		entry('driver.ssflib', ssfFromProgram(Uint8Array.of(2))),
	];
	await assert.rejects(prepareScspSsfSource(ambiguous, 'tune.ssf'), /ambiguous library path/);
	const exact = [
		entry('tune.ssf', ssfFromProgram(new Uint8Array(), 0, '_lib=driver.ssflib\n')),
		...ambiguous.slice(1),
	];
	assert.equal((await prepareScspSsfSource(exact, 'tune.ssf')).ram[0], 2);
});

test('missing, cyclic and escaping dependencies fail before a source can be committed', async () => {
	await assert.rejects(
		prepareScspSsfSource(
			[entry('tune.ssf', ssfFromProgram(new Uint8Array(), 0, '_lib=Missing.ssflib\n'))],
			'tune.ssf',
		),
		/missing SSFLib Missing.ssflib.*from tune.ssf/,
	);
	await assert.rejects(
		prepareScspSsfSource(
			[
				entry('tune.ssf', ssfFromProgram(new Uint8Array(), 0, '_lib=other.ssflib\n')),
				entry('other.ssflib', ssfFromProgram(new Uint8Array(), 0, '_lib=tune.ssf\n')),
			],
			'tune.ssf',
		),
		/cyclic library reference/,
	);
	for (const path of [
		'../outside.ssflib',
		'/outside.ssflib',
		'https://example.test/file.ssflib',
		'\\server\\bank.ssflib',
	]) {
		await assert.rejects(
			prepareScspSsfSource(
				[entry('tune.ssf', ssfFromProgram(new Uint8Array(), 0, '_lib=' + path + '\n'))],
				'tune.ssf',
			),
			/SSF:/,
		);
	}
	const deep = Array.from({ length: 11 }, (_, index) =>
		entry(
			index ? `${index}.ssflib` : 'tune.ssf',
			ssfFromProgram(new Uint8Array(), 0, index < 10 ? `_lib=${index + 1}.ssflib\n` : ''),
		),
	);
	await assert.rejects(prepareScspSsfSource(deep, 'tune.ssf'), /depth \/ visit limit/);
});

test('container magic, version, lengths and compressed CRC are checked before decompression', () => {
	assert.equal(scspSsfCrc32(new TextEncoder().encode('123456789')), 0xcbf43926);
	const fixture = createScspSsfContainerFixture().standalone;
	const brokenCrc = fixture.slice();
	brokenCrc[16] ^= 0x80;
	assert.throws(() => readScspSsfFile(brokenCrc), /CRC-32 mismatch/);
	const brokenVersion = fixture.slice();
	brokenVersion[3] = 1;
	assert.throws(() => readScspSsfFile(brokenVersion), /requires 0x11/);
	const brokenLength = fixture.slice();
	new DataView(brokenLength.buffer).setUint32(4, 0xffffffff, true);
	assert.throws(() => readScspSsfFile(brokenLength), /truncated reserved/);
	for (const bytes of [
		new Uint8Array(),
		new Uint8Array(15),
		new Uint8Array(16),
		new Uint8Array(MAX_SCSP_SSF_FILE_BYTES + 1),
	])
		assert.throws(() => readScspSsfFile(bytes), /expected an SSF file/);
	const reserved = psfFromExe(Uint8Array.of(0, 0, 0, 0, 7), 'title=Reserved\n', {
		version: 0x11,
		reserved: Uint8Array.of(9, 8, 7),
	});
	assert.equal(readScspSsfFile(reserved).reservedBytes, 3);
});

test('a rejected unrelated song stays isolated from valid songs and reached libraries', async () => {
	const fixture = createScspSsfContainerFixture();
	const invalid = fixture.standalone.slice();
	invalid[16] ^= 0x80;
	const files = [...fixture.files, entry('bad.ssf', invalid), entry('bad.ssflib', invalid),
		entry('empty.ssf', new Uint8Array()), entry('truncated.ssf', Uint8Array.of(0x50,0x53,0x46,0x11))];
	const set = await readScspSsfSet(files);
	const source = await prepareScspSsfSource(set, 'Demo/track.ssf');
	assert.deepEqual([...source.ram.subarray(0x30, 0x32)], [1, 3]);
	await assert.rejects(prepareScspSsfSource(set, 'bad.ssf'), /CRC-32 mismatch/);
	for (const path of ['empty.ssf', 'truncated.ssf'])
		await assert.rejects(prepareScspSsfSource(set, path), /expected an SSF file/);
	await assert.rejects(
		prepareScspSsfSource(
			[
				entry('needs-bad.ssf', ssfFromProgram(new Uint8Array(), 0, '_lib=bad.ssflib\n')),
				entry('bad.ssflib', invalid),
			],
			'needs-bad.ssf',
		),
		/CRC-32 mismatch/,
	);
});

test('inflated programs, RAM segments and corrupt zlib streams are bounded', async () => {
	const source = (bytes) => prepareScspSsfSource([entry('tune.ssf', bytes)], 'tune.ssf');
	await assert.rejects(
		source(psfFromExe(Uint8Array.of(1, 2, 3), '', { version: 0x11 })),
		/truncated program load address/,
	);
	await assert.rejects(
		source(ssfFromProgram(Uint8Array.of(1), SCSP_SSF_RAM_BYTES)),
		/outside 512 KiB/,
	);
	await assert.rejects(
		source(ssfFromProgram(new Uint8Array(), SCSP_SSF_RAM_BYTES + 1)),
		/outside 512 KiB/,
	);
	await assert.rejects(
		source(ssfFromProgram(new Uint8Array(SCSP_SSF_RAM_BYTES + 1))),
		/524,292-byte SSF limit/,
	);
	const full = await source(ssfFromProgram(new Uint8Array(SCSP_SSF_RAM_BYTES)));
	assert(full.coverage.every((value) => value === 1));
	const compressed = Uint8Array.of(3, 4, 5, 6);
	const malformed = new Uint8Array(20);
	malformed.set([0x50, 0x53, 0x46, 0x11]);
	const view = new DataView(malformed.buffer);
	view.setUint32(8, compressed.length, true);
	view.setUint32(12, fixtureCrc32(compressed), true);
	malformed.set(compressed, 16);
	await assert.rejects(source(malformed), /zlib decompression failed/);
});

test('folder input retains original paths, guards changed file sizes and rejects duplicate records', async () => {
	const data = createScspSsfContainerFixture().standalone;
	const file = {
		name: 'track.ssf',
		webkitRelativePath: 'Folder/track.ssf',
		size: data.length,
		arrayBuffer: async () => data.slice().buffer,
	};
	const set = await readScspSsfSet([file]);
	assert.deepEqual(
		listScspSsfEntries(set).map((song) => song.path),
		['Folder/track.ssf'],
	);
	await assert.rejects(readScspSsfSet([{ ...file, size: data.length + 1 }]), /file size changed/);
	await assert.rejects(
		readScspSsfSet([{ ...file, size: MAX_SCSP_SSF_FILE_BYTES + 1 }]),
		/0 bytes–4 MiB/,
	);
	await assert.rejects(
		readScspSsfSet([entry('same.ssf', data), entry('/same.ssf', data)]),
		/duplicate path/,
	);
	await assert.rejects(readScspSsfSet([]), /1–512/);
	await assert.rejects(readScspSsfSet(new Array(513)), /1–512/);
	assert.throws(() => listScspSsfEntries({ records: new Map() }), /prepared SSF file set/);
	const libraries = await readScspSsfSet([entry('driver.ssflib', data)]);
	assert.deepEqual(listScspSsfEntries(libraries), []);
	await assert.rejects(prepareScspSsfSource(libraries, 'driver.ssflib'), /choose an SSF/);
});

test('aggregate source budget and tag length stop oversized sets before playback', async () => {
	const large = new Uint8Array(MAX_SCSP_SSF_FILE_BYTES);
	large.set([0x50, 0x53, 0x46, 0x11]); // Empty compressed program with a zero CRC.
	await assert.rejects(
		readScspSsfSet(Array.from({ length: 17 }, (_, index) => entry(`${index}.ssf`, large))),
		/selected files exceed 64 MiB/,
	);
	assert.throws(
		() => readScspSsfFile(ssfFromProgram(new Uint8Array(), 0, 'comment=' + 'x'.repeat(50001))),
		/tags exceed 50,000/,
	);
	assert.throws(
		() => readScspSsfFile(ssfFromProgram(new Uint8Array(), 0, 'title=a\0b\n')),
		/NUL in tags/,
	);
});

test('tags expose finite timing and relative volume while unknown duration stays null', async () => {
	const timeCases = [
		['62.5', 62.5],
		['1:02,5', 62.5],
		['1:02:03.25', 3723.25],
		['0', 0],
	];
	for (const [text, expected] of timeCases) assert.equal(parseScspSsfTime(text), expected);
	for (const value of [undefined, '', '-1', '1e4', '0:60', '1:60:00', '2::03', '2.1.2', '1\n2'])
		assert.equal(parseScspSsfTime(value), null, String(value));
	const invalid = await prepareScspSsfSource(
		[
			entry(
				'song.ssf',
				ssfFromProgram(Uint8Array.of(1), 20, 'length=nope\nfade=bad\nvolume=Infinity\n'),
			),
		],
		'song.ssf',
	);
	assert.equal(invalid.lengthSeconds, null);
	assert.equal(invalid.durationSeconds, null);
	assert.equal(invalid.totalSamples, null);
	assert.equal(invalid.fadeSeconds, 0);
	assert.equal(invalid.volume, 1);
	assert.equal(invalid.warnings.length, 3);
	const negative = await prepareScspSsfSource(
		[entry('song.ssf', ssfFromProgram(Uint8Array.of(1), 20, 'volume=-0.5\n'))],
		'song.ssf',
	);
	assert.equal(negative.volume, -0.5);
	assert.throws(
		() => readScspSsfFile(ssfFromProgram(new Uint8Array(), 0, '_lib=a\n_LIB=b\n')),
		/duplicate _lib/,
	);
});

test('aborted folder reads and dependency compositions never return a partial RAM image', async () => {
	const fixture = createScspSsfContainerFixture();
	const already = new AbortController();
	already.abort();
	await assert.rejects(
		prepareScspSsfSource(fixture.files, 'Demo/track.ssf', { signal: already.signal }),
		{ name: 'AbortError' },
	);
	const controller = new AbortController();
	const data = fixture.standalone;
	const file = {
		name: 'tune.ssf',
		size: data.length,
		arrayBuffer: async () => {
			controller.abort();
			return data.slice().buffer;
		},
	};
	await assert.rejects(readScspSsfSet([file], { signal: controller.signal }), {
		name: 'AbortError',
	});
	const duringInflate = new AbortController();
	const set = await readScspSsfSet(fixture.files);
	const task = prepareScspSsfSource(set, 'Demo/track.ssf', { signal: duringInflate.signal });
	queueMicrotask(() => duringInflate.abort());
	await assert.rejects(task, { name: 'AbortError' });
});

test('original audible fixture places the MiniSSF pitch patch inside its 68000 immediate', async () => {
	const fixture = createScspSsfPlaybackFixture();
	const source = await prepareScspSsfSource(fixture.files, '/ssf/Demo/track.minissf');
	const view = new DataView(source.ram.buffer);
	assert.equal(view.getUint32(0, false), 0x7fff0);
	assert.equal(view.getUint32(4, false), 0x100);
	assert.equal(view.getUint16(fixture.pitchImmediateAddress, false), 0x7800);
	assert.deepEqual(source.ram.subarray(0x1000, 0x1080), fixture.pcm);
	assert(source.ram.subarray(0x100, 0x200).some((value) => value !== 0));
});
