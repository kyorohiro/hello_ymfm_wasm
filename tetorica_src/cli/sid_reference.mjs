#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Repository-only comparison tool. The external GPL reference executable is a
// separate process; it is not linked into the browser, npm runtime or Synth.
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, open, readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {prepareSidReference, SID_REFERENCE_PINS} from '../../scripts/prepare_sid_reference.mjs';
import {parsePsid, PSID_MAX_FILE_BYTES} from './sid_psid.mjs';
import {validateSidTrace, encodeSidTraceCommands, SID_TRACE_LIMITS} from './sid_trace.mjs';
import {measurePcm, comparePcm, floatWave, readFloatPcm} from './sid_reference_metrics.mjs';
import {createSidReferenceFixture, SID_REFERENCE_FIXTURES} from '../../test/fixtures/sid-reference/fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const buildFlags = ['-std=c++17', '-O2', '-ffp-contract=off'];

/** Hold one descriptor and read at most limit+1 bytes even if a file grows. */
export async function readBoundedReferenceFile(path, limit, label = 'Reference input') {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32 * 1024 * 1024) throw new RangeError('Invalid reference file limit');
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) throw new RangeError(`${label} exceeds its bounded file size`);
    const chunks = []; let length = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(65536, limit + 1 - length));
      const {bytesRead} = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > limit) throw new RangeError(`${label} exceeds its bounded file size`);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, length);
  } finally { await file.close(); }
}

function execute(binary, args, {input, maxBuffer = 4 * 1024 * 1024, timeout = 150000} = {}) {
  const result = spawnSync(binary, args, {input, maxBuffer, timeout, windowsHide: true});
  if (result.error) throw new Error(`${binary}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${binary} failed (${result.status}): ${result.stderr.toString().slice(-8000)}`);
  return result;
}

export async function prepareSidTraceRenderer(workDir = join(root, 'build/sid-reference')) {
  const sources = ['test/helpers/sid_trace_render.cpp', 'tetorica_src/wasm/sid_core.h', 'third_party/chips-m6581/m6581.h'];
  const inputs = await Promise.all(sources.map(async path => ({path, sha256: sha(await readFile(join(root, path)))})));
  const compiler = process.env.CXX || 'c++';
  const compilerVersion = execute(compiler, ['--version']).stdout.toString().trim();
  const build = {compiler, compilerVersion, flags: buildFlags, platform: process.platform, arch: process.arch};
  const fingerprint = sha(JSON.stringify({inputs, build})).slice(0, 20);
  await mkdir(workDir, {recursive: true});
  const binary = join(workDir, `tetorica-sid-trace-${fingerprint}${process.platform === 'win32' ? '.exe' : ''}`);
  let receipt;
  try {
    receipt = JSON.parse(await readFile(binary + '.json'));
    assert.equal(receipt.binarySha256, sha(await readFile(binary)));
    assert.deepEqual(receipt.inputs, inputs);
    assert.deepEqual(receipt.build, build);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Trace renderer cache is invalid: ${error.message}`);
    execute(compiler, [...buildFlags, join(root, sources[0]), '-o', binary], {timeout: 120000});
    receipt = {inputs, build, binarySha256: sha(await readFile(binary))};
    await writeFile(binary + '.json', JSON.stringify(receipt, null, 2) + '\n');
  }
  return {binary, receipt};
}

export function renderSidTrace(trace, binary, {chunkFrames = 4096, dcBlock = true} = {}) {
  trace = validateSidTrace(trace);
  const expectedFrames = Math.floor(trace.durationCycles * trace.sampleRate / trace.clockHz);
  const result = execute(binary, [], {input: encodeSidTraceCommands(trace, {chunkFrames, dcBlock}), maxBuffer: expectedFrames * 4 + 1048576});
  const state = JSON.parse(result.stderr.toString()), pcm = readFloatPcm(result.stdout);
  assert.equal(pcm.length, expectedFrames, 'Tetorica sample clock must match the trace duration');
  assert.equal(state.cycles, trace.durationCycles);
  return {pcm, bytes: result.stdout, state, dcBlock};
}

function expectedFixtureWrites(fixture, writes) {
  const same = (a, b) => a.register === b.register && a.value === b.value;
  const initial = fixture.expectedInitWrites;
  const offset = writes.findIndex((_, i) => initial.every((value, j) => writes[i + j] && same(value, writes[i + j])));
  assert(offset >= 0, `${fixture.profile}: C64 execution did not produce the authored init writes`);
  let cursor = offset + initial.length, calls = 0;
  while (cursor < writes.length) {
    const expected = fixture.expectedPlayWrites(calls++);
    assert(expected.length > 0, 'Fixture play routine must have an observable write');
    for (const value of expected) {
      if (cursor === writes.length) return {initialDriverWrites: offset, completePlayCalls: calls - 1, partialFinalPlay: true};
      assert(same(value, writes[cursor]), `${fixture.profile}: unexpected C64 play write ${cursor}`);
      ++cursor;
    }
  }
  return {initialDriverWrites: offset, completePlayCalls: calls, partialFinalPlay: false};
}

/** Execute a PSID in the pinned external player, then replay its bus writes in
 * the unchanged Tetorica core. Each run has its own directory: never overwrite
 * a tune, earlier WAV, report or trace. No audio device is opened. */
export async function runSidReference({inputPath, fixture: profile, outDir = join(root, 'release/sid-reference'),
  engineWorkDir = join(root, 'build/sid-reference'), seconds = 2, sampleRate = 48000,
  subtune, offline = false, eventChunk = 4096, renderChunk = 4096} = {}) {
  if (Boolean(inputPath) === Boolean(profile)) throw new TypeError('Choose one PSID file or one self-authored fixture');
  if (!Number.isFinite(seconds) || seconds < .25 || seconds > 60) throw new RangeError('Duration must be 0.25..60 seconds');
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new RangeError('Sample rate must be 8000..96000');
  if (!Number.isInteger(eventChunk) || eventChunk < 1 || eventChunk > 4096) throw new RangeError('Event chunk must be 1..4096');
  if (!Number.isInteger(renderChunk) || renderChunk < 1 || renderChunk > 8192) throw new RangeError('Render chunk must be 1..8192');
  let fixture, bytes;
  if (profile) { fixture = createSidReferenceFixture(profile); bytes = Buffer.from(fixture.bytes); }
  else {
    bytes = await readBoundedReferenceFile(inputPath, PSID_MAX_FILE_BYTES, 'PSID input');
  }
  const psid = parsePsid(bytes);
  subtune ??= psid.startSong;
  if (!Number.isInteger(subtune) || subtune < 1 || subtune > psid.songs) throw new RangeError('Subtune is outside the PSID song range');
  if (psid.version !== 2) throw new Error('The first reference runner supports PSID v2 only');
  if (psid.speed !== 0) throw new Error('The first reference runner supports VBI timing only; files with CIA-speed bits are not enabled');
  if (psid.relocation.startPage !== 0 || psid.relocation.pageLength !== 0) throw new Error('The first reference runner supports only unspecified relocation (0/0)');
  if (psid.loadAddress < 0x0800 || psid.loadAddress + psid.program.length > 0xd000) throw new Error('The first reference runner supports program RAM $0800..$CFFF only');
  const durationCycles = Math.round(seconds * 985248);
  const provider = await prepareSidReference({workDir: resolve(engineWorkDir), offline});
  const renderer = await prepareSidTraceRenderer(resolve(engineWorkDir));
  await mkdir(outDir, {recursive: true});
  const directory = await mkdtemp(join(resolve(outDir), 'comparison-'));
  const source = join(directory, 'input.psid'), captureFile = join(directory, 'capture.json'), referenceFile = join(directory, 'reference.f32le');
  await writeFile(source, bytes, {flag: 'wx'});
  const captured = execute(provider.binary, [source, captureFile, referenceFile, String(durationCycles), String(sampleRate), String(subtune), String(eventChunk)]);
  const capture = JSON.parse(await readBoundedReferenceFile(captureFile, 32 * 1024 * 1024, 'Reference trace'));
  assert.equal(capture.capture?.endCycle, durationCycles, 'Reference SID clock must stop at the exclusive trace end');
  assert.equal(capture.capture?.referenceResetVolume, 0, 'Reference and Tetorica must both start with volume zero');
  const trace = validateSidTrace({format: 'tetorica-sid-trace', version: 1, clockHz: 985248, model: '6581',
    cyclePhase: 'phi2', writeTiming: 'tick-then-commit', durationCycles, sampleRate,
    engine: {...capture.engine, pins: SID_REFERENCE_PINS, buildManifestSha256: sha(await readFile(provider.manifestPath)), capture: capture.capture ?? {},
      sidReadCount: capture.reads?.length ?? 0, sidReadExamples: capture.reads?.slice(0, 8) ?? []},
    input: {sha256: sha(bytes), subtune}, writes: capture.writes});
  // Keep the exact serialized file within the same limit enforced on reading.
  const traceBytes = Buffer.from(JSON.stringify(trace));
  assert(traceBytes.length <= SID_TRACE_LIMITS.maximumBytes);
  await writeFile(join(directory, 'trace.json'), traceBytes, {flag: 'wx'});
  const referenceBytes = await readBoundedReferenceFile(referenceFile, sampleRate * 61 * 4, 'Reference PCM'), reference = readFloatPcm(referenceBytes);
  if (reference.length > sampleRate * 61 || reference.length === 0) throw new RangeError('Reference produced an invalid PCM duration');
  const actual = renderSidTrace(trace, renderer.binary, {chunkFrames: renderChunk});
  const raw = renderSidTrace(trace, renderer.binary, {chunkFrames: renderChunk, dcBlock: false});
  const streams = {reference, tetorica: actual.pcm, tetoricaRaw: raw.pcm}, outputs = {};
  for (const [name, pcm] of Object.entries(streams)) {
    const wav = floatWave(pcm, sampleRate);
    await writeFile(join(directory, name + '.wav'), wav, {flag: 'wx'});
    outputs[name] = {file: name + '.wav', sha256: sha(wav), encoding: 'IEEE float32 mono, no gain or normalization', ...measurePcm(pcm, sampleRate)};
  }
  await writeFile(join(directory, 'tetorica.f32le'), actual.bytes, {flag: 'wx'});
  await writeFile(join(directory, 'tetorica-raw.f32le'), raw.bytes, {flag: 'wx'});
  const report = {schemaVersion: 1, purpose: 'Independent C64 program execution, timed SID writes and diagnostic renderer comparison',
    passed: true, deviceOpened: false, listeningPerformed: false, hardwareFidelityVerified: false,
    limits: 'The m6581 6581 approximation and reSIDfp differ in analog/filter/sampling/DC/gain models. PCM differences are diagnostics, not a pass/fail fidelity claim. No time stretching, phase alignment or gain fitting is applied.',
    input: {file: 'input.psid', sha256: sha(bytes), fixture: profile ?? null, version: psid.version, subtune, metadata: psid.metadata},
    timing: {clockHz: trace.clockHz, durationCycles, sampleRate, requestedSeconds: seconds, cyclePhase: trace.cyclePhase, writeTiming: trace.writeTiming,
      referenceEngine: capture.engine, referenceCapture: capture.capture ?? {}, retainedSidReads: capture.reads?.length ?? 0},
    provenance: {referencePins: SID_REFERENCE_PINS, referenceManifestSha256: sha(await readFile(provider.manifestPath)), tetoricaRenderer: renderer.receipt},
    trace: {file: 'trace.json', sha256: sha(traceBytes), writes: trace.writes.length, firstCycle: trace.writes[0]?.cycle ?? null, lastCycle: trace.writes.at(-1)?.cycle ?? null},
    fixtureWrites: fixture ? expectedFixtureWrites(fixture, trace.writes) : null,
    outputs, comparisons: {production: comparePcm(reference, actual.pcm), rawChip: comparePcm(reference, raw.pcm)},
    warnings: [
      ...(trace.writes.length ? [] : ['No SID writes were captured in this interval; a silent intro or unsupported program dependency may be involved.']),
      ...(capture.reads?.length ? ['SID reads follow the reference model. Replaying the captured writes is an open-loop test, not C64 execution with Tetorica feedback.'] : []),
      ...(outputs.reference.nonzero && outputs.tetorica.nonzero ? [] : ['One or both captured streams are silent in this interval.']),
    ],
    tetoricaFinalState: actual.state, referenceSummary: JSON.parse(captured.stdout.toString())};
  await writeFile(join(directory, 'comparison.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  return {directory, report, trace, pcm: {reference: referenceBytes, tetorica: actual.bytes, raw: raw.bytes}};
}

export function parseSidReferenceArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; ++i) {
    const arg = args[i];
    if (arg === '--help') { options.help = true; continue; }
    if (arg === '--offline') { if (options.offline) throw new Error('Duplicate --offline'); options.offline = true; continue; }
    if (!arg.startsWith('--')) { if (options.inputPath) throw new Error('Only one PSID file is accepted'); options.inputPath = resolve(arg); continue; }
    const key = {'--fixture': 'fixture', '--out-dir': 'outDir', '--engine-work-dir': 'engineWorkDir', '--seconds': 'seconds', '--sample-rate': 'sampleRate', '--subtune': 'subtune'}[arg];
    if (!key || Object.hasOwn(options, key)) throw new Error(`Unknown or duplicate option: ${arg}`);
    const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    options[key] = ['seconds', 'sampleRate', 'subtune'].includes(key) ? Number(value) : value;
  }
  return options;
}

async function main(args) {
  const options = parseSidReferenceArgs(args);
  if (options.help) {
    console.log('Usage: node tetorica_src/cli/sid_reference.mjs FILE.psid | --fixture ' + SID_REFERENCE_FIXTURES.join('|') + '\n  [--seconds 2] [--sample-rate 48000] [--subtune 1] [--out-dir release/sid-reference] [--engine-work-dir build/sid-reference] [--offline]\nNo audio device is opened. Output: original input, trace JSON, reference/Tetorica float WAV and comparison JSON.');
    return;
  }
  const result = await runSidReference(options);
  console.log(`SID reference comparison: ${result.directory}\n${result.trace.writes.length} cycle-timed writes; ${result.report.outputs.tetorica.frames} Tetorica mono frames. Diagnostic comparison only; no device opened.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(`SID reference failed: ${error.message}`); process.exitCode = 1; });
}
