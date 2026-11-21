#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
    listScspSsfEntries, prepareScspSsfSource, readScspSsfSet, SCSP_SSF_FILES,
} from '../docs/synth-scsp/ssf_source.js';
import { createScspSsfWasmRenderer, SSF_RENDER_FRAMES } from '../docs/synth-scsp/scsp_ssf_wasm.js';
import { createScspSsfPlaybackFixture } from '../test/helpers/scsp_ssf_fixture.mjs';
import { createScspSsfTimerFixture } from '../test/helpers/scsp_ssf_timer_fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const board = resolve(root, 'tetorica_src/native/scsp_ssf');
const scsp = resolve(root, 'third_party/tetorica-soundchip-native/vendor/mame-scsp');
const musashi = resolve(root, 'third_party/atari-audio/src/external/Musashi');
const sampleRate = 44_100;
const frames = 8192;
const partition = 257;
const compiler = process.env.CXX || 'c++';
const { values: options } = parseArgs({
    options: { wasm: { type: 'string' }, 'real-dir': { type: 'string' } },
});
assert(!options['real-dir'] || options.wasm, '--real-dir requires --wasm FILE');

function run(executable, args, timeout = 10_000) {
    const result = spawnSync(executable, args, { encoding: 'utf8', timeout });
    if (result.error) throw result.error;
    return result;
}

function measureSine(pcm, expectedHz) {
    assert.equal(pcm.length, frames * 8);
    let peak = 0, previous = 0;
    const crossings = [];
    for (let frame = 0; frame < frames; frame++) {
        const left = pcm.readFloatLE(frame * 8), right = pcm.readFloatLE(frame * 8 + 4);
        assert(Number.isFinite(left), `Nonfinite output at frame ${frame}`);
        assert.equal(left, right, `Sine fixture should be centered at frame ${frame}`);
        peak = Math.max(peak, Math.abs(left));
        if (frame >= 512 && previous <= 0 && left > 0) {
            crossings.push(frame - 1 - previous / (left - previous));
        }
        previous = left;
    }
    assert(peak > 0.02 && peak <= 1, `Expected audible unclipped PCM, peak was ${peak}`);
    assert(crossings.length >= 10, 'The PCM did not contain enough sine periods');
    const measuredHz = sampleRate * (crossings.length - 1) / (crossings.at(-1) - crossings[0]);
    assert(Math.abs(measuredHz - expectedHz) < 1, `Expected ${expectedHz} Hz, measured ${measuredHz} Hz`);
    return { expectedHz, measuredHz, peak, pcmSha256: createHash('sha256').update(pcm).digest('hex') };
}

function timerEdges(pcm) {
    assert.equal(pcm.length, frames * 8);
    const edges = [];
    let audible = false;
    for (let frame = 0; frame < frames; frame++) {
        const left = pcm.readFloatLE(frame * 8), right = pcm.readFloatLE(frame * 8 + 4);
        assert.equal(left, right, `Timer fixture should be centered at frame ${frame}`);
        assert(left === 0 || (left >= 0.1 && left <= 1), `Unexpected timer PCM at frame ${frame}`);
        if ((left > 0) !== audible) {
            audible = left > 0;
            edges.push(frame);
        }
    }
    return edges;
}

async function renderWasm(wasm, ram, frameCount, blockSize) {
    const renderer = await createScspSsfWasmRenderer(wasm, {
        ram, totalSamples: frameCount, volume: 1, fadeSeconds: 0,
    });
    try {
        const pcm = Buffer.allocUnsafe(frameCount * 8);
        for (let offset = 0; offset < frameCount; offset += blockSize) {
            const count = Math.min(frameCount - offset, blockSize);
            const block = renderer.process(blockSize);
            assert.equal(block.frames, count);
            assert.equal(block.left.length, count);
            assert.equal(block.right.length, count);
            assert.equal(block.ended, offset + count === frameCount);
            for (let index = 0; index < count; index++) {
                const output = (offset + index) * 8;
                pcm.writeFloatLE(block.left[index], output);
                pcm.writeFloatLE(block.right[index], output + 4);
            }
        }
        return pcm;
    } finally {
        renderer.dispose();
    }
}

async function realFileEntries(directory, prefix = '') {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const location = join(directory, entry.name);
        const path = prefix + entry.name;
        if (entry.isDirectory()) {
            files.push(...await realFileEntries(location, path + '/'));
        } else if (entry.isFile() && SCSP_SSF_FILES.test(entry.name)) {
            files.push({
                path, size: (await stat(location)).size,
                async arrayBuffer() {
                    const bytes = await readFile(location);
                    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
                },
            });
        }
    }
    return files;
}

function firstSignalFrame(pcm) {
    let firstFrame = null;
    for (let offset = 0; offset < pcm.length; offset += 4) {
        const sample = pcm.readFloatLE(offset);
        assert(Number.isFinite(sample), 'Nonfinite real-song PCM');
        if (firstFrame === null && Math.abs(sample) >= 0.0001)
            firstFrame = Math.floor(offset / 8);
    }
    return firstFrame;
}

async function compareRealSongs(directory, compare) {
    const entries = await realFileEntries(directory);
    const set = await readScspSsfSet(entries);
    const songs = listScspSsfEntries(set).sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    assert(songs.length, 'Selected real directory contains no SSF / MiniSSF songs');
    const result = { sourceFiles: entries.length, songs: songs.length, SSF: 0, MiniSSF: 0,
        signalWithinTwoSeconds: 0, signalAfterTwoSeconds: 0, noSignalAfterFifteenSeconds: 0,
        latestFirstSignalFrame: 0, stereoFramesCompared: 0 };
    const digest = createHash('sha256');
    for (const song of songs) {
        const source = await prepareScspSsfSource(set, song.path);
        result[source.format]++;
        let count = sampleRate * 2;
        let pcm = await compare(source.ram, count, song.path);
        result.stereoFramesCompared += count;
        let firstFrame = firstSignalFrame(pcm);
        if (firstFrame === null) {
            count = sampleRate * 15;
            const extended = await compare(source.ram, count, song.path);
            assert(extended.subarray(0, pcm.length).equals(pcm), `${song.path}: extended PCM changed its prefix`);
            pcm = extended;
            result.stereoFramesCompared += count;
            firstFrame = firstSignalFrame(pcm);
            if (firstFrame === null) result.noSignalAfterFifteenSeconds++;
            else result.signalAfterTwoSeconds++;
        } else result.signalWithinTwoSeconds++;
        if (firstFrame !== null)
            result.latestFirstSignalFrame = Math.max(result.latestFirstSignalFrame, firstFrame);
        digest.update(pcm);
    }
    return { ...result, pcmSha256: digest.digest('hex') };
}

const tmp = await mkdtemp(join(tmpdir(), 'tetorica-scsp-ssf-native-'));
try {
    const executable = join(tmp, process.platform === 'win32' ? 'fixture.exe' : 'fixture');
    const sources = [
        resolve(root, 'test/helpers/scsp_ssf_native_fixture.cpp'),
        join(board, 'scsp_ssf.cpp'),
        ...['scsp_instrument.cpp', 'scsp.cpp', 'scspdsp.cpp'].map(name => join(scsp, name)),
        ...['m68k.cpp', 'm68kcpu.cpp', 'm68kops.cpp'].map(name => join(musashi, name)),
    ];
    const build = run(compiler, [
        '-std=c++17', '-O2', '-fwrapv', '-fno-strict-aliasing', '-ffp-contract=off',
        '-I', board, '-I', scsp, '-I', musashi, ...sources, '-o', executable,
    ], 120_000);
    assert.equal(build.status, 0, build.stderr);

    const fixture = createScspSsfPlaybackFixture();
    const wasm = options.wasm ? await readFile(options.wasm) : null;
    let fixturesCompared = 0;
    const compareWasmFixture = async (label, ram, nativePcm) => {
        if (!wasm) return;
        const wasmPcm = await renderWasm(wasm, ram, frames, SSF_RENDER_FRAMES);
        assert(wasmPcm.equals(nativePcm), `${label}: Native and WASM PCM differ`);
        assert(wasmPcm.equals(await renderWasm(wasm, ram, frames, partition)),
            `${label}: WASM PCM differs with a different block size`);
        fixturesCompared++;
    };
    const standalone = await prepareScspSsfSource(fixture.standaloneFiles, fixture.standaloneFiles[0].path);
    const mini = await prepareScspSsfSource(fixture.files, fixture.files[0].path);
    const cases = [
        { source: standalone, format: 'SSF', expectedHz: sampleRate / 64 },
        { source: mini, format: 'MiniSSF', expectedHz: sampleRate / 128 },
    ];
    const results = [];
    const output = join(tmp, 'output.f32');
    const render = async (input, blockSize, frameCount = frames) => {
        const result = run(executable, [input, output, String(frameCount), String(blockSize)]);
        assert.equal(result.status, 0, result.stderr);
        return readFile(output);
    };
    for (const { source, format, expectedHz } of cases) {
        assert.equal(source.format, format);
        const input = join(tmp, `${format}.ram`);
        await writeFile(input, source.ram);
        const pcm = await render(input, frames);
        const splitPcm = await render(input, partition);
        assert(pcm.equals(splitPcm), `${format} PCM differs when split into blocks of ${partition}`);
        await compareWasmFixture(format, source.ram, pcm);
        results.push({ format, ...measureSine(pcm, expectedHz) });
    }

    const modifiedSample = standalone.ram.slice();
    const program = new DataView(modifiedSample.buffer);
    const keyOn = fixture.pitchImmediateAddress + 6;
    // Move the final MOVE.W (Key On) and BRA.S to make room for a CPU RAM write.
    modifiedSample.copyWithin(keyOn + 8, keyOn, keyOn + 10);
    program.setUint16(keyOn, 0x33fc, false); // MOVE.W #$4000, $00001000
    program.setUint16(keyOn + 2, 0x4000, false);
    program.setUint32(keyOn + 4, 0x1000, false);
    const sampleWriteInput = join(tmp, 'cpu-sample-write.ram');
    await writeFile(sampleWriteInput, modifiedSample);
    const sampleWritePcm = await render(sampleWriteInput, partition);
    await compareWasmFixture('CPU sample write', modifiedSample, sampleWritePcm);
    const sampleWrite = measureSine(sampleWritePcm, sampleRate / 64);
    assert(sampleWrite.peak > results[0].peak + 0.1, 'The SCSP did not render the CPU-written sample word');

    const timerIrqs = [];
    for (const timer of ['A', 'B', 'C']) {
        const fixture = createScspSsfTimerFixture(timer);
        const source = await prepareScspSsfSource(fixture.files, fixture.path);
        const input = join(tmp, `timer-${timer}.ram`);
        await writeFile(input, source.ram);
        const block = await render(input, frames);
        assert(block.equals(await render(input, partition)), `Timer ${timer} depends on render block size`);
        await compareWasmFixture(`Timer ${timer}`, source.ram, block);
        const edges = timerEdges(block);
        assert(edges.length >= 8, `Timer ${timer} did not repeatedly wake the CPU`);
        const firstEdge = edges[0];
        const expected = fixture.expectedPeriod;
        assert(firstEdge >= expected - 1 && firstEdge <= expected + 6,
            `Timer ${timer} first transition at frame ${firstEdge}, expected near ${expected}`);
        const intervals = edges.slice(1).map((frame, index) => frame - edges[index]);
        assert(intervals.every(interval => Math.abs(interval - expected) <= 1),
            `Timer ${timer} gate intervals ${[...new Set(intervals)].join(', ')}, expected ${expected} frames`);
        timerIrqs.push({
            timer, level: fixture.level, firstEdge, expectedIntervalFrames: expected,
            intervalFrames: [...new Set(intervals)], transitions: edges.length,
        });
    }
    const maskedTimer = createScspSsfTimerFixture('A', { enabled: false });
    const maskedSource = await prepareScspSsfSource(maskedTimer.files, maskedTimer.path);
    const maskedInput = join(tmp, 'masked-timer.ram');
    await writeFile(maskedInput, maskedSource.ram);
    const maskedPcm = await render(maskedInput, partition);
    await compareWasmFixture('Masked timer', maskedSource.ram, maskedPcm);
    assert.deepEqual(timerEdges(maskedPcm), [], 'A masked timer woke the CPU');

    const invalid = join(tmp, 'invalid.ram');
    for (const size of [standalone.ram.length - 1, standalone.ram.length + 1]) {
        const invalidImage = Buffer.alloc(size);
        Buffer.from(standalone.ram).copy(invalidImage);
        await writeFile(invalid, invalidImage);
        const result = run(executable, [invalid, output, '16', '16']);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, new RegExp(`SCSP rejected the ${size}-byte sound RAM image`));
    }

    for (const [address, value] of [[0x200000, 0], [0x100c00, 1]]) {
        const unsupportedBus = standalone.ram.slice();
        // Replace the pitch instruction with an unmapped write or a nonzero DSP TEMP write.
        const program = new DataView(unsupportedBus.buffer);
        program.setUint16(fixture.pitchImmediateAddress, value, false);
        program.setUint32(fixture.pitchImmediateAddress + 2, address, false);
        await writeFile(invalid, unsupportedBus);
        const failed = run(executable, [invalid, output, '16', '16']);
        assert.equal(failed.status, 1, failed.stderr);
        assert.match(failed.stderr, new RegExp(`unsupported sound board access at 0x${address.toString(16)}`));
    }

    let realSongs;
    if (options['real-dir']) {
        const input = join(tmp, 'real.ram');
        realSongs = await compareRealSongs(options['real-dir'], async (ram, count, label) => {
            await writeFile(input, ram);
            const nativePcm = await render(input, 8192, count);
            const wasmPcm = await renderWasm(wasm, ram, count, partition);
            assert(wasmPcm.equals(nativePcm), `${label}: Native and WASM PCM differ`);
            return nativePcm;
        });
    }
    console.log(JSON.stringify({
        passed: true, sampleRate, frames, blockSizes: [frames, partition],
        blockPartitionInvariant: true, rejectedInvalidImageSizes: true,
        reportedUnsupportedBusAddress: true, rejectedNonzeroDspWorkWrite: true, deviceOpened: false, results,
        cpuSampleRamWrite: { originalPeak: results[0].peak, ...sampleWrite },
        timerIrqs, maskedTimerSilent: true,
        ...(wasm ? { wasm: {
            sha256: createHash('sha256').update(wasm).digest('hex'),
            fixturesCompared, blockSizes: [SSF_RENDER_FRAMES, partition], pcmBitExact: true, realSongs,
        } } : {}),
    }, null, 2));
} finally {
    await rm(tmp, { recursive: true, force: true });
}
