#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro
// Compile the shared source as C and C++, compare actual Native/WASM PCM,
// and exercise windowed loading without an AudioContext or synthetic mock.
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createCDDAPCM, CDDA_PCM_MAX_BYTES} from '../web/cdda_pcm.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'tetorica-cdda-core-'));
const run = (program, args) => {
  const result = spawnSync(program, args, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  assert.equal(result.status, 0, `${program} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
const source = String.raw`
#include "cdda_pcm.h"
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <iterator>
#include <vector>
int main(int argc, char **argv) {
  assert(argc == 6);
  std::ifstream input(argv[1], std::ios::binary);
  std::vector<uint8_t> pcm((std::istreambuf_iterator<char>(input)), {});
  std::ifstream commands(argv[2]);
  std::ofstream output(argv[3], std::ios::binary);
  const uint32_t rate = (uint32_t)std::strtoul(argv[4], 0, 10);
  const bool windowed = std::atoi(argv[5]) != 0;
  cdda_pcm_state s;
  assert(!cdda_pcm_init(0, rate));
  assert(cdda_pcm_init(&s, rate));
  assert(!cdda_pcm_init(&s, 0));
  assert(s.output_rate == rate && s.gain == 1 && s.state == CDDA_PCM_READY);
  assert(!cdda_pcm_play(&s) && !cdda_pcm_pause(&s) && !cdda_pcm_resume(&s));
  assert(!cdda_pcm_seek(&s, 0));
  assert(!cdda_pcm_prepare(&s, 0, 4));
  assert(!cdda_pcm_prepare(&s, pcm.data(), 0));
  assert(!cdda_pcm_prepare(&s, pcm.data(), 3));
  assert(!cdda_pcm_prepare(&s, pcm.data(), CDDA_PCM_MAX_BYTES + 4));
  assert(!cdda_pcm_prepare_windowed(&s, 0));
  assert(!cdda_pcm_prepare_windowed(&s, CDDA_PCM_MAX_BYTES / 4 + 1));
  assert(!cdda_pcm_set_gain(&s, NAN) && !cdda_pcm_set_gain(&s, INFINITY));
  assert(!cdda_pcm_set_gain(&s, -1) && !cdda_pcm_set_gain(&s, 17));
  assert(!cdda_pcm_set_muted(&s, 2) && !cdda_pcm_set_muted(&s, -1));
  assert(cdda_pcm_prepare(&s, pcm.data(), (uint32_t)pcm.size()));
  assert(!cdda_pcm_prepare(&s, pcm.data(), 5));
  assert(s.frames == pcm.size() / 4 && s.pcm == pcm.data());
  if (windowed) {
    assert(cdda_pcm_prepare_windowed(&s, pcm.size() / 4));
    assert(cdda_pcm_play(&s));
    float l = 123, r = 456;
    assert(!cdda_pcm_render(&s, &l, &r, 1));
    assert(l == 123 && r == 456 && s.frame == 0 && s.output_frames == 0);
    assert(!cdda_pcm_set_window(&s, pcm.data(), s.frames, 1));
    assert(!cdda_pcm_set_window(&s, pcm.data(), 0, (uint32_t)s.frames + 1));
    assert(cdda_pcm_stop(&s));
  }
  assert(!cdda_pcm_seek(&s, s.frames + 1));
  assert(!cdda_pcm_render(&s, 0, 0, 1));
  assert(cdda_pcm_render(&s, 0, 0, 0));
  char command;
  while (commands >> command) {
    unsigned long long n = 0;
    if (command == 'r' || command == 's' || command == 'g' || command == 'm') commands >> n;
    if (command == 'p') assert(cdda_pcm_play(&s));
    if (command == 'a') assert(cdda_pcm_pause(&s));
    if (command == 'u') assert(cdda_pcm_resume(&s));
    if (command == 't') assert(cdda_pcm_stop(&s));
    if (command == 's') assert(cdda_pcm_seek(&s, n));
    if (command == 'g') assert(cdda_pcm_set_gain(&s, (double)n / 10));
    if (command == 'm') assert(cdda_pcm_set_muted(&s, (int)n));
    if (command == 'r') {
      std::vector<float> left((size_t)n), right((size_t)n);
      if (windowed && s.frame < s.frames) {
        assert(cdda_pcm_set_window(&s, pcm.data() + s.frame * 4,
          s.frame, (uint32_t)(s.frames - s.frame)));
      }
      assert(cdda_pcm_render(&s, left.data(), right.data(), (uint32_t)n));
      for (size_t i = 0; i < n; ++i) {
        output.write((char *)&left[i], sizeof(float));
        output.write((char *)&right[i], sizeof(float));
      }
    }
    std::cout << s.state << ' ' << s.frame << ' ' << s.phase << ' '
      << s.output_frames << ' ' << s.gain << ' ' << s.muted << '\n';
  }
}
`;
await writeFile(join(temp, 'native.cpp'), source);
run(process.env.CXX || 'clang++', ['-std=c++14', '-O2', '-ffp-contract=off', '-x', 'c++',
  join(temp, 'native.cpp'), join(root, 'native/cdda/cdda_pcm.c'),
  '-I', join(root, 'native/cdda'), '-o', join(temp, 'native')]);
run(process.env.CC || 'clang', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-c',
  join(root, 'native/cdda/cdda_pcm.c'), '-o', join(temp, 'cdda-c11.o')]);
const sourceFrames = 131072;
const pcm = new Uint8Array(sourceFrames * 4);
const pcmView = new DataView(pcm.buffer);
for (let i = 0; i < sourceFrames; i++) {
  pcmView.setInt16(i * 4, ((i * 73 + 32768) % 65536) - 32768, true);
  pcmView.setInt16(i * 4 + 2, ((i * 137 + 65535) % 65536) - 32768, true);
}
await writeFile(join(temp, 'source.pcm'), pcm);
const wasmBinary = await readFile(join(root, 'web/generated/cdda_wasm.wasm'));
const module = new WebAssembly.Module(wasmBinary);
assert.deepEqual(WebAssembly.Module.imports(module), [], 'Real-time renderer has no host imports.');
const {instance} = await WebAssembly.instantiate(wasmBinary, {});
const memoryBytes = instance.exports.memory.buffer.byteLength;
assert.equal(memoryBytes, 131072, 'Fixed small WASM memory, independent of track length.');

const results = [];
for (const rate of [8000, 44100, 48000, 384000]) {
  const commands = [['r', 17], ['p'], ['r', 31], ['r', 1], ['r', 127], ['a'], ['r', 13],
    ['u'], ['r', 83], ['m', 1], ['r', 19], ['m', 0], ['g', 5], ['r', 29],
    ['s', 100], ['r', 11], ['t'], ['r', 7], ['s', sourceFrames], ['r', 13], ['p'],
    ['r', Math.ceil(sourceFrames * rate / 44100) + 19], ['g', 10], ['p'], ['r', 441]];
  const commandPath = join(temp, `commands-${rate}`);
  await writeFile(commandPath, commands.map(c => c.join(' ')).join('\n'));
  const nativePath = join(temp, `native-${rate}.f32`);
  const nativeTrace = run(join(temp, 'native'), [join(temp, 'source.pcm'), commandPath, nativePath, String(rate), '0']);
  const windowPath = join(temp, `native-window-${rate}.f32`);
  const windowTrace = run(join(temp, 'native'), [join(temp, 'source.pcm'), commandPath, windowPath, String(rate), '1']);
  assert.equal(windowTrace, nativeTrace, `Native borrowed windows status @${rate}`);
  assert.deepEqual(await readFile(windowPath), await readFile(nativePath), `Native borrowed windows audio @${rate}`);
  const core = await createCDDAPCM({sampleRate: rate, wasmBinary});
  assert.throws(() => core.play());
  core.prepare(pcm);
  for (const bad of [new Uint8Array(0), new Uint8Array(3), {}, null]) {
    assert.throws(() => core.prepare(bad));
    assert.equal(core.status().durationFrames, sourceFrames);
  }
  assert.throws(() => core.seek(sourceFrames + 1));
  assert.throws(() => core.seek(0.5));
  assert.throws(() => core.setGain(NaN));
  assert.throws(() => core.setGain(Infinity));
  assert.throws(() => core.setGain(-1));
  assert.throws(() => core.setGain(17));
  assert.throws(() => core.setMuted(1));
  const records = [];
  const traces = [];
  let expectedFrame = 0, expectedPhase = 0, expectedOutput = 0, state = 0, gain = 1, muted = false;
  for (const [command, n] of commands) {
    if (command === 'p') {
      core.play(); state = 1; expectedFrame = expectedPhase = 0;
      const beforeInvalidReplacement = core.status();
      assert.throws(() => core.prepare(new Uint8Array(5)));
      assert.deepEqual(core.status(), beforeInvalidReplacement, 'Invalid replacement preserves active playback.');
    }
    if (command === 'a') { core.pause(); state = 2; }
    if (command === 'u') { core.resume(); state = 1; }
    if (command === 't') { core.stop(); state = 0; expectedFrame = expectedPhase = 0; }
    if (command === 's') {
      core.seek(n); expectedFrame = n; expectedPhase = 0;
      if (n === sourceFrames) state = 3; else if (state === 3) state = 0;
    }
    if (command === 'g') { core.setGain(n / 10); gain = n / 10; }
    if (command === 'm') { core.setMuted(!!n); muted = !!n; }
    if (command === 'r') {
      const left = new Float32Array(n), right = new Float32Array(n);
      core.render(left, right);
      const packed = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        let l = 0, r = 0;
        if (state === 1 && expectedFrame < sourceFrames) {
          if (!muted && gain) {
            const next = Math.min(sourceFrames - 1, expectedFrame + 1);
            const f = expectedPhase / rate;
            const a = pcmView.getInt16(expectedFrame * 4, true) / 32768;
            const b = pcmView.getInt16(expectedFrame * 4 + 2, true) / 32768;
            l = Math.fround((a + (pcmView.getInt16(next * 4, true) / 32768 - a) * f) * gain);
            r = Math.fround((b + (pcmView.getInt16(next * 4 + 2, true) / 32768 - b) * f) * gain);
          }
          expectedPhase += 44100;
          expectedFrame += Math.floor(expectedPhase / rate);
          expectedPhase %= rate;
          if (expectedFrame >= sourceFrames) { expectedFrame = sourceFrames; expectedPhase = 0; state = 3; }
        }
        assert.equal(left[i], l, `Independent left PCM reference @${rate} frame${i}`);
        assert.equal(right[i], r, `Independent right PCM reference @${rate} frame${i}`);
        packed[i * 2] = left[i]; packed[i * 2 + 1] = right[i];
      }
      expectedOutput += n;
      records.push(Buffer.from(packed.buffer));
    }
    const status = core.status();
    assert.equal(status.positionFrames, expectedFrame);
    assert.equal(status.phase, expectedPhase);
    assert.equal(status.outputFrames, expectedOutput);
    traces.push([['ready', 'playing', 'paused', 'ended'].indexOf(status.state), status.positionFrames,
      status.phase, status.outputFrames, status.gain, +status.muted].join(' '));
  }
  assert.equal(traces.join('\n') + '\n', nativeTrace, `Native/WASM complete status @${rate}`);
  assert.deepEqual(Buffer.concat(records), await readFile(nativePath), `Native/WASM exact PCM @${rate}`);
  core.dispose();
  assert.equal(core.status().durationFrames, 0);
  assert.throws(() => core.play());
  results.push({rate, renderedFrames: expectedOutput, nativeWasmExact: true, independentReferenceExact: true});
}

// Fixed scratch copying must not depend on host block partitioning.
for (const rate of [44100, 48000]) {
  const a = await createCDDAPCM({sampleRate: rate, wasmBinary});
  const b = await createCDDAPCM({sampleRate: rate, wasmBinary});
  a.prepare(pcm); b.prepare(pcm); a.play(); b.play();
  const count = 8191;
  const left = new Float32Array(count), right = new Float32Array(count);
  a.render(left, right);
  const chunksL = new Float32Array(count), chunksR = new Float32Array(count);
  let position = 0, iteration = 0;
  while (position < count) {
    const n = Math.min([1, 3, 127, 128, 129, 257][iteration++ % 6], count - position);
    b.render(chunksL.subarray(position, position + n), chunksR.subarray(position, position + n));
    position += n;
  }
  assert.deepEqual(chunksL, left); assert.deepEqual(chunksR, right);
  assert.deepEqual(b.status(), a.status());
}
assert.equal(CDDA_PCM_MAX_BYTES, 268435456);
console.log(JSON.stringify({status: 'PASS', sourceFrames, wasmBytes: wasmBinary.byteLength,
  wasmMemoryBytes: memoryBytes, sourceCapBytes: CDDA_PCM_MAX_BYTES,
  c11: true, cpp14: true, blockPartitionExact: true, results, evidenceDirectory: temp}, null, 2));
