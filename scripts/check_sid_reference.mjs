#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Original diagnostics only. Explicitly builds the external GPL verifier; it
// never opens an audio device or adds that engine to an application package.
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {resolve, relative, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runSidReference} from '../tetorica_src/cli/sid_reference.mjs';
import {SID_REFERENCE_FIXTURES, createSidReferenceFixture} from '../test/fixtures/sid-reference/fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), options = {};
for (let i = 2; i < process.argv.length; ++i) {
  const key = process.argv[i];
  if (key === '--offline') { options.offline = true; continue; }
  const name = {'--work-dir': 'outDir', '--engine-work-dir': 'engineWorkDir', '--out': 'out'}[key];
  assert(name && !Object.hasOwn(options, name), `Unknown or duplicate option: ${key}`);
  const value = process.argv[++i]; assert(value && !value.startsWith('--'), `Missing ${key}`);
  options[name] = resolve(value);
}
options.outDir ??= join(root, 'release/sid-reference-validation');
options.engineWorkDir ??= join(root, 'build/sid-reference');
const output = options.out ?? join(options.outDir, 'sid-reference-comparison.json');
delete options.out;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {schemaVersion: 1, passed: false, deviceOpened: false, listeningPerformed: false,
  hardwareFidelityVerified: false,
  scope: 'Self-authored PAL/6581 single-SID PSID v2, external C64 execution and cycle-timed replay in the unchanged Tetorica chip. No real game or ROM dump.',
  exactChecks: ['authored init/play writes', 'strict PHI2 write order', 'exclusive end and Tetorica frame clock', 'same-backend repeat and buffering invariance'],
  diagnosticOnly: ['different engine PCM, gain/DC/filter models', 'nominal versus effective reference sample rate', 'waveform and frequency-band differences'],
  cases: []};

let repeated, tone;
for (const fixture of SID_REFERENCE_FIXTURES) {
  const rates = fixture === 'tone' ? [44100, 48000, 96000] : [48000];
  for (const sampleRate of rates) {
    const result = await runSidReference({...options, fixture, sampleRate, seconds: 1});
    assert(result.report.fixtureWrites.completePlayCalls >= 5);
    assert.equal(result.report.timing.retainedSidReads, 0, 'Authored program never reads the SID');
    for (const stream of Object.values(result.report.outputs)) { assert(stream.finite); assert(stream.nonzero > 0); assert(stream.peak > .0001); }
    assert.equal(result.report.outputs.tetorica.frames, sampleRate);
    if (fixture === 'tone') {
      for (const name of ['reference', 'tetorica']) {
        const spectrum = result.report.outputs[name].spectrum;
        assert(Math.abs(spectrum.dominantBinHz - 440) < spectrum.binWidthHz * 2, `${name}: known A4 must remain close to its expected frequency`);
      }
    }
    report.cases.push({fixture, sampleRate, directory: relative(root, result.directory), comparison: relative(root, join(result.directory, 'comparison.json')),
      writes: result.trace.writes.length, writesSha256: sha(JSON.stringify(result.trace.writes)),
      fixtureChecks: result.report.fixtureWrites,
      referencePcmSha256: sha(result.pcm.reference), tetoricaPcmSha256: sha(result.pcm.tetorica), rawChipPcmSha256: sha(result.pcm.raw),
      referenceFrames: result.report.outputs.reference.frames, tetoricaFrames: result.report.outputs.tetorica.frames,
      comparisons: result.report.comparisons});
    if (fixture === 'melody-filter') repeated = result;
    if (fixture === 'tone' && sampleRate === 48000) tone = result;
    console.log(`SID reference: ${fixture} ${sampleRate} Hz, ${result.trace.writes.length} CPU writes; both renderers produced finite PCM.`);
  }
}
const repeat = await runSidReference({...options, fixture: 'melody-filter', sampleRate: 48000, seconds: 1, eventChunk: 1, renderChunk: 1});
assert.deepEqual(repeat.trace.writes, repeated.trace.writes, 'Reference scheduling chunks must retain every CPU write and its cycle');
for (const key of ['reference', 'tetorica', 'raw']) assert.deepEqual(repeat.pcm[key], repeated.pcm[key], `${key}: exact repeat/buffer invariance`);
report.repeat = {fixture: 'melody-filter', firstEventChunk: 4096, repeatedEventChunk: 1, firstRenderChunk: 4096, repeatedRenderChunk: 1,
  directory: relative(root, repeat.directory), writesExact: true, referencePcmExact: true, tetoricaPcmExact: true, rawChipPcmExact: true};
// initAddress=0 is a legal shorthand for the effective load address, with both
// PSID load-address layouts. Exercise the actual external CPU, not only metadata.
const variants = await mkdtemp(join(options.outDir, 'init-zero-'));
report.initAddressZero = [];
for (const embeddedLoadAddress of [true, false]) {
  const bytes = Uint8Array.from(createSidReferenceFixture('tone', {embeddedLoadAddress}).bytes);
  bytes[0x0a] = 0; bytes[0x0b] = 0;
  const inputPath = join(variants, embeddedLoadAddress ? 'embedded.psid' : 'explicit.psid');
  await writeFile(inputPath, bytes, {flag: 'wx'});
  const result = await runSidReference({...options, inputPath, sampleRate: 48000, seconds: 1});
  assert.deepEqual(result.trace.writes, tone.trace.writes);
  for (const key of ['reference', 'tetorica', 'raw']) assert.deepEqual(result.pcm[key], tone.pcm[key], `init=0 ${key}: load layout must retain exact CPU playback`);
  report.initAddressZero.push({embeddedLoadAddress, directory: relative(root, result.directory), writesExact: true, pcmExact: true});
}
report.reference = repeated.report.provenance;
report.referenceTiming = repeated.report.timing;
const sources = ['scripts/check_sid_reference.mjs', 'scripts/prepare_sid_reference.mjs',
  'tetorica_src/cli/sid_reference.mjs', 'tetorica_src/cli/sid_reference_metrics.mjs', 'tetorica_src/cli/sid_psid.mjs', 'tetorica_src/runtime/sid_psid.js', 'tetorica_src/cli/sid_trace.mjs',
  'test/fixtures/sid-reference/fixture.mjs', 'test/helpers/sid_player_reference.cpp', 'test/helpers/sid_trace_render.cpp',
  'third_party/sid-reference/serial-filter-tables.patch', 'third_party/sid-reference/serial-filter-tables.json',
  'third_party/sid-reference/COPYING.libsidplayfp', 'third_party/sid-reference/COPYING.libresidfp',
  'tetorica_src/wasm/sid_core.h', 'third_party/chips-m6581/m6581.h', 'tetorica_src/runtime/sid.js', 'tetorica_src/runtime/generated/sid/sid.wasm'];
report.sources = await Promise.all(sources.map(async path => { const bytes = await readFile(join(root, path)); return {path, bytes: bytes.length, sha256: sha(bytes)}; }));
report.passed = true;
await mkdir(dirname(output), {recursive: true}); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`SID reference checks passed: ${report.cases.length} cases, exact repeat and two init=0 load layouts; no device opened. Report: ${output}`);
