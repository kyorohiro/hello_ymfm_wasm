#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro
// Build only the SDK vendor C/H as strict C11 and C++14, then compare actual
// Native and standalone WASM output/status. MSM5205 is also checked against
// the separately retained unchanged JavaScript decoder, not a mock.
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createCDDAPCM, CDDA_PCM_MAX_BYTES, createMSM5205PCM, MSM5205_PCM_MAX_BYTES}
  from './application_audio_wasm_smoke.mjs';
import {Msm5205AudioEngine} from '../reference/javascript/msm5205audioengine.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
let directory = resolve(root, 'dist/wasm'), artifact = 'all';
for (let index = 2; index < process.argv.length; ++index) {
  const option = process.argv[index], value = process.argv[++index];
  assert(value, `Missing value for ${option}`);
  if (option === '--wasm-dir') directory = resolve(value);
  else if (option === '--artifact') artifact = value;
  else throw new Error(`Unknown option: ${option}`);
}
assert(['all', 'cdda', 'msm5205'].includes(artifact),
  'Usage: node tests/check_application_audio_core.mjs --wasm-dir <dir> --artifact <cdda|msm5205|all>');

async function checkCDDA() {
const temp = await mkdtemp(join(tmpdir(), 'tetorica-sdk-cdda-core-'));
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
  join(temp, 'native.cpp'), join(root, 'vendor/tetorica-cdda/cdda_pcm.c'),
  '-I', join(root, 'vendor/tetorica-cdda'), '-o', join(temp, 'native')]);
run(process.env.CC || 'clang', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-c',
  join(root, 'vendor/tetorica-cdda/cdda_pcm.c'), '-o', join(temp, 'cdda-c11.o')]);
const sourceFrames = 131072;
const pcm = new Uint8Array(sourceFrames * 4);
const pcmView = new DataView(pcm.buffer);
for (let i = 0; i < sourceFrames; i++) {
  pcmView.setInt16(i * 4, ((i * 73 + 32768) % 65536) - 32768, true);
  pcmView.setInt16(i * 4 + 2, ((i * 137 + 65535) % 65536) - 32768, true);
}
await writeFile(join(temp, 'source.pcm'), pcm);
const wasmBinary = await readFile(join(directory, 'cdda_wasm.wasm'));
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
return {status: 'PASS', sourceFrames, wasmBytes: wasmBinary.byteLength,
  wasmMemoryBytes: memoryBytes, sourceCapBytes: CDDA_PCM_MAX_BYTES,
  c11: true, cpp14: true, blockPartitionExact: true, results, evidenceDirectory: temp};
}

async function checkMSM5205() {
const temp = await mkdtemp(join(tmpdir(), 'tetorica-sdk-msm5205-core-'));
const run = (program, args) => {
  const r = spawnSync(program, args, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  assert.equal(r.status, 0, `${program} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
await writeFile(join(temp, 'native.cpp'), String.raw`
#include "msm5205_pcm.h"
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <iterator>
#include <vector>
int main(int argc,char **argv) {
 assert(argc==6);
 std::ifstream input(argv[1],std::ios::binary), commands(argv[2]);
 std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(input)),{});
 std::ofstream output(argv[3],std::ios::binary);
 msm5205_pcm_state s;
 const uint32_t sr=(uint32_t)std::strtoul(argv[4],0,10), clock=(uint32_t)std::strtoul(argv[5],0,10);
 assert(!msm5205_pcm_init(0,sr,clock));
 assert(msm5205_pcm_init(&s,sr,clock));
 assert(!msm5205_pcm_init(&s,0,clock)); assert(s.output_rate==sr);
 assert(!msm5205_pcm_prepare(&s,0,1));
 assert(!msm5205_pcm_prepare(&s,bytes.data(),0));
 assert(!msm5205_pcm_prepare(&s,bytes.data(),65537));
 assert(!msm5205_pcm_play(&s,0,1,0,15));
 assert(!msm5205_pcm_set_gain(&s,NAN));
 assert(!msm5205_pcm_set_gain(&s,INFINITY));
 assert(!msm5205_pcm_set_gain(&s,-1)); assert(!msm5205_pcm_set_gain(&s,17));
 assert(!msm5205_pcm_set_muted(&s,2));
 assert(!msm5205_pcm_write_register(&s,8,0)); assert(!msm5205_pcm_write_register(&s,0,16));
 assert(!msm5205_pcm_render(&s,0,0,1));
 assert(msm5205_pcm_render(&s,0,0,0));
 char cmd;
 while(commands>>cmd) {
  unsigned n=0,a=0,b=0,c=0;
  if(cmd=='r'||cmd=='m'||cmd=='g')commands>>n;
  if(cmd=='w')commands>>a>>b;
  if(cmd=='p')commands>>a>>b>>c>>n;
  if(cmd=='b')assert(msm5205_pcm_prepare(&s,bytes.data(),(uint32_t)bytes.size()));
  if(cmd=='w')assert(msm5205_pcm_write_register(&s,a,b));
  if(cmd=='p')assert(msm5205_pcm_play(&s,a,b,(int)c,n));
  if(cmd=='t')assert(msm5205_pcm_stop(&s));
  if(cmd=='x')assert(msm5205_pcm_reset(&s));
  if(cmd=='m')assert(msm5205_pcm_set_muted(&s,(int)n));
  if(cmd=='g')assert(msm5205_pcm_set_gain(&s,(double)n/10));
  if(cmd=='r'){
   std::vector<float> l(n),r(n);
   assert(msm5205_pcm_render(&s,l.data(),r.data(),n));
   for(unsigned i=0;i<n;++i){output.write((char*)&l[i],4);output.write((char*)&r[i],4);}
  }
  std::cout<<s.mode<<' '<<s.state<<' '<<s.source_bytes<<' '<<s.offset<<' '<<s.length<<' '
   <<s.cursor<<' '<<s.loop<<' '<<s.rate<<' '<<s.phase<<' '<<s.output_frames<<' '
   <<s.gain<<' '<<s.muted<<' '<<s.signal<<' '<<s.step<<' '<<s.reset_line<<' '
   <<s.vclk<<' '<<s.prescaler<<' '<<s.bits<<' '<<s.fifo_count<<'\n';
 }
}
`);
run(process.env.CXX || 'clang++', ['-std=c++14', '-O2', '-ffp-contract=off', '-x', 'c++',
  join(temp, 'native.cpp'), join(root, 'vendor/tetorica-msm5205/msm5205_pcm.c'),
  '-I', join(root, 'vendor/tetorica-msm5205'), '-o', join(temp, 'native')]);
run(process.env.CC || 'clang', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-c',
  join(root, 'vendor/tetorica-msm5205/msm5205_pcm.c'), '-o', join(temp, 'c11.o')]);

const bytes = Uint8Array.from({length: 65536}, (_, i) => (i * 73 + (i >> 3) + 0x37) & 255);
await writeFile(join(temp, 'ram.adpcm'), bytes);
const wasmBinary = await readFile(join(directory, 'msm5205_wasm.wasm'));
const module = new WebAssembly.Module(wasmBinary);
assert.deepEqual(WebAssembly.Module.imports(module), []);
const {instance} = await WebAssembly.instantiate(wasmBinary, {});
assert.equal(instance.exports.memory.buffer.byteLength, 131072);
assert.equal(MSM5205_PCM_MAX_BYTES, 65536);
const statusFields = s => [s.mode === 'pce' ? 1 : 0, ['ready','playing','ended'].indexOf(s.state),
  s.sourceBytes, s.offset, s.length, s.cursor, +s.loop, s.rate, s.phase, s.outputFrames,
  s.gain, +s.muted, s.signal, s.step, s.resetLine, s.vclk, s.prescaler, s.bits, s.fifoCount];
const nibbleAt = n => (n & 1) ? bytes[n >> 1] & 15 : bytes[n >> 1] >> 4;
let sequence = 0;
const results = [];
async function compare(commands, sampleRate, clock, kind) {
  const id = `${kind}-${sampleRate}-${clock}-${sequence++}`;
  const commandPath = join(temp, id + '.txt'), nativePath = join(temp, id + '.f32');
  await writeFile(commandPath, commands.map(c => c.join(' ')).join('\n'));
  const nativeTrace = run(join(temp, 'native'), [join(temp,'ram.adpcm'),commandPath,nativePath,String(sampleRate),String(clock)])
    .trim().split('\n').map(line => line.split(' ').map(Number));
  const core = await createMSM5205PCM({sampleRate, clock, wasmBinary});
  const legacy = new Msm5205AudioEngine({clock, outputSampleRate: sampleRate});
  let mode = 'raw', state = 'ready', offset = 0, length = 0, cursor = 0, phase = 0, loop = false, rate = 15;
  let gain = 1, muted = false, renderedFrames = 0;
  const feed = () => { legacy.writeMsm5205(1, nibbleAt(cursor)); legacy.writeMsm5205(2,0); legacy.writeMsm5205(2,1); };
  const records = [];
  for (let index = 0; index < commands.length; ++index) {
    const [command,a,b,c,d] = commands[index];
    if (command === 'b') { core.prepare(bytes); mode='pce'; state='ready'; cursor=offset=phase=0; length=bytes.length*2; loop=false; rate=15; }
    if (command === 'p') {
      core.play({offset:a,length:b,loop:!!c,rate:d});
      mode='pce';state='playing';offset=cursor=a;length=b;loop=!!c;rate=d;phase=0;
      legacy.reset();legacy.writeMsm5205(0,1);legacy.writeMsm5205(0,0);legacy.writeMsm5205(4,3);feed();
    }
    if (command === 'w') { core.writeRegister(a,b); legacy.writeMsm5205(a,b); }
    if (command === 'm') { core.setMuted(!!a);legacy.setMsm5205Muted(!!a);muted=!!a; }
    if (command === 'g') { core.setGain(a/10);legacy.setMasterVolume(a/10);gain=a/10; }
    if (command === 't') { core.stop();state='ready';phase=0;cursor=offset; }
    if (command === 'x') { core.reset();legacy.reset();state='ready';phase=cursor=offset=0;loop=false;rate=15; }
    if (command === 'r') {
      const left = new Float32Array(a), right = new Float32Array(a);
      core.render(left,right);
      let expected;
      if (mode === 'raw') expected = legacy.processFrames(a).left;
      else {
        expected = new Float32Array(a);
        const threshold = sampleRate * 48 * (16-rate);
        for (let i=0;i<a;++i) {
          if (state !== 'playing') continue;
          expected[i] = muted ? 0 : legacy.signal/2048*gain;
          phase+=clock;
          while (phase>=threshold) {
            phase-=threshold;++cursor;
            if(cursor===offset+length) {
              if(loop)cursor=offset;
              else {state='ended';phase=0;legacy.signal=0;break;}
            }
            feed();
          }
        }
      }
      assert.deepEqual(left,expected,`${id} independent legacy PCM command ${index}`);
      assert.deepEqual(right,left,`${id} mono duplicated`);
      const packed = new Float32Array(a*2);
      for(let i=0;i<a;++i){packed[i*2]=left[i];packed[i*2+1]=right[i];}
      records.push(Buffer.from(packed.buffer));renderedFrames+=a;
    }
    const status=core.readState();
    assert.deepEqual(statusFields(status),nativeTrace[index],`${id} complete Native/WASM status ${index}`);
    if(mode==='raw') {
      assert.equal(status.signal,legacy.signal);assert.equal(status.step,legacy.step);
      assert.equal(status.phase,legacy.phase);assert.equal(status.fifoCount,legacy.fifo.length);
    } else {
      assert.equal(status.cursor,cursor);assert.equal(status.phase,phase);assert.equal(status.state,state);
      if(state==='playing') {assert.equal(status.signal,legacy.signal);assert.equal(status.step,legacy.step);}
    }
    assert.equal(status.outputFrames,renderedFrames);
  }
  assert.deepEqual(Buffer.concat(records),await readFile(nativePath),`${id} Native/WASM bit-exact PCM`);
  results.push({kind,sampleRate,clock,commands:commands.length,renderedFrames,nativeWasmExact:true,legacyReferenceExact:true});
  core.dispose();
}

for (const sampleRate of [44100,48000]) {
  const commands=[['r',17],['w',0,1],['w',0,0],['w',1,0],['w',1,7],['w',1,8],['r',3]];
  for(let k=0;k<4;++k) {
    commands.push(['w',4,k],['w',5,k&1]);
    for(let n=0;n<20;++n)commands.push(['w',1,n&15]);
    commands.push(['r',1],['r',127],['w',2,0],['w',2,1],['w',2,1],['r',129]);
  }
  let seed=0x12345678;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  for(let i=0;i<1200;++i) {
    const n=random();
    if(i%91===0)commands.push(['x']);
    else if(i%47===0)commands.push(['m',n&1]);
    else if(i%43===0)commands.push(['g',n%38]);
    else if(i%7===0)commands.push(['w',4,n&3]);
    else if(i%11===0)commands.push(['w',5,n&1]);
    else if(i%5===0)commands.push(['w',2,n&1]);
    else if(i%3===0)commands.push(['r',n%257]);
    else commands.push(['w',1,n&15]);
  }
  commands.push(['w',0,1],['r',511],['w',0,0],['r',31]);
  await compare(commands,sampleRate,1536000,'raw');
  const pce=[['b'],['r',17]];
  for(let rate=0;rate<16;++rate) {
    const n=rate+1;
    pce.push(['p',rate&1,n,0,rate],['r',Math.ceil(n*sampleRate*48*(16-rate)/1536000)+17]);
    pce.push(['p',rate&1,n,1,rate],['r',137],['m',1],['r',129],['m',0],['g',17],['r',173],['t'],['r',31]);
  }
  pce.push(['x'],['r',19],['p',131071,1,0,15],['r',17]);
  await compare(pce,sampleRate,1536000,'pce-all-rates');
  await compare([['b'],['p',3,7,1,12],['r',8191],['t'],['r',17]],sampleRate,1540200,'pce-alternate-clock');

  const a=await createMSM5205PCM({sampleRate,wasmBinary}),b=await createMSM5205PCM({sampleRate,wasmBinary});
  a.prepare(bytes);b.prepare(bytes);a.play({offset:1,length:131071,loop:true,rate:13});b.play({offset:1,length:131071,loop:true,rate:13});
  const left=new Float32Array(8191),right=new Float32Array(8191),chunkL=new Float32Array(8191),chunkR=new Float32Array(8191);
  a.render(left,right);
  let position=0,k=0;
  while(position<left.length){const n=Math.min([1,3,127,128,129,257][k++%6],left.length-position);
    b.render(chunkL.subarray(position,position+n),chunkR.subarray(position,position+n));position+=n;}
  assert.deepEqual(chunkL,left);assert.deepEqual(chunkR,right);assert.deepEqual(a.readState(),b.readState());
  const snapshot=a.readState();
  for(const bad of [new Uint8Array(),new Uint8Array(65537),{},null])assert.throws(()=>a.prepare(bad));
  for(const opts of [{offset:-1},{offset:131072},{length:0},{length:131073},{rate:16},{loop:1},{offset:131071,length:2}])assert.throws(()=>a.play(opts));
  assert.throws(()=>a.setGain(NaN));assert.throws(()=>a.setGain(Infinity));assert.throws(()=>a.setGain(-1));assert.throws(()=>a.setGain(17));
  assert.throws(()=>a.setMuted(1));assert.throws(()=>a.writeRegister(8,0));assert.throws(()=>a.writeRegister(0,16));
  assert.deepEqual(a.readState(),snapshot,'Rejected commands preserve active source/playback');
  a.setGain(0.5);a.setMuted(true);a.prepare(bytes);assert.equal(a.readState().gain,0.5);assert.equal(a.readState().muted,true);
  a.reset();assert.equal(a.readState().sourceBytes,65536);assert.equal(a.readState().gain,0.5);assert.equal(a.readState().muted,true);
  a.stop();a.render(left,right);assert(left.every(v=>v===0));a.dispose();assert.equal(a.readState().sourceBytes,0);assert.throws(()=>a.play());
}
return {status:'PASS',wasmBytes:wasmBinary.byteLength,wasmMemoryBytes:131072,
  noHostImports:true,c11:true,cpp14:true,sourceCapBytes:65536,blockPartitionExact:true,
  all16RateRegisters:true,rawReference:'unchanged reference/javascript/msm5205audioengine.js',results,evidenceDirectory:temp};
}

const results = [];
if (artifact === 'all' || artifact === 'cdda') results.push({artifact: 'cdda', ...await checkCDDA()});
if (artifact === 'all' || artifact === 'msm5205') results.push({artifact: 'msm5205', ...await checkMSM5205()});
console.log(JSON.stringify({status: 'PASS', standaloneSDK: true, format: 'standalone-audio-wasm', results}, null, 2));
