#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareScspSsfSource } from '../docs/synth-scsp/ssf_source.js';
import { createScspSsfPlaybackFixture } from '../test/helpers/scsp_ssf_fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const board = resolve(root, 'tetorica_src/native/scsp_ssf');
const scsp = resolve(root, 'third_party/tetorica-soundchip-native/vendor/mame-scsp');
const musashi = resolve(root, 'third_party/atari-audio/src/external/Musashi');
const sampleRate = 44_100;
const frames = 8192;
const partition = 257;
const compiler = process.env.CXX || 'c++';

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
    const standalone = await prepareScspSsfSource(fixture.standaloneFiles, fixture.standaloneFiles[0].path);
    const mini = await prepareScspSsfSource(fixture.files, fixture.files[0].path);
    const cases = [
        { source: standalone, format: 'SSF', expectedHz: sampleRate / 64 },
        { source: mini, format: 'MiniSSF', expectedHz: sampleRate / 128 },
    ];
    const results = [];
    const output = join(tmp, 'output.f32');
    const render = async (input, blockSize) => {
        const result = run(executable, [input, output, String(frames), String(blockSize)]);
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
    const sampleWrite = measureSine(await render(sampleWriteInput, partition), sampleRate / 64);
    assert(sampleWrite.peak > results[0].peak + 0.1, 'The SCSP did not render the CPU-written sample word');

    const invalid = join(tmp, 'invalid.ram');
    for (const size of [standalone.ram.length - 1, standalone.ram.length + 1]) {
        const invalidImage = Buffer.alloc(size);
        Buffer.from(standalone.ram).copy(invalidImage);
        await writeFile(invalid, invalidImage);
        const result = run(executable, [invalid, output, '16', '16']);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, new RegExp(`SCSP rejected the ${size}-byte sound RAM image`));
    }

    const unsupportedBus = standalone.ram.slice();
    // The absolute address follows the immediate operand in the fixture's pitch instruction.
    new DataView(unsupportedBus.buffer).setUint32(fixture.pitchImmediateAddress + 2, 0x200000, false);
    await writeFile(invalid, unsupportedBus);
    const failed = run(executable, [invalid, output, '16', '16']);
    assert.equal(failed.status, 1, failed.stderr);
    assert.match(failed.stderr, /unsupported sound board access at 0x200000/);

    console.log(JSON.stringify({
        passed: true, sampleRate, frames, blockSizes: [frames, partition],
        blockPartitionInvariant: true, rejectedInvalidImageSizes: true,
        reportedUnsupportedBusAddress: true, deviceOpened: false, results,
        cpuSampleRamWrite: { originalPeak: results[0].peak, ...sampleWrite },
    }, null, 2));
} finally {
    await rm(tmp, { recursive: true, force: true });
}
