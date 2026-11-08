#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Freeze metadata and run order before the optional local-music experiment.
// This module never starts a browser/CPU, clocks a SID or writes music/PCM.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateResearchSid} from '../docs/sid8580-lab/parser.js';
import {validateBrowserPsid} from '../docs/js/sid_psid.js';
import {createSidPairFixture} from '../test/helpers/sid_voice_pair_fixtures.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const ownPath = 'scripts/sid_worklet_perf_plan.mjs';
const oldPlanPath = 'docs/issues/sid8580_worklet_cases_plan_01.json';
const fixturePath = 'test/helpers/sid_voice_pair_fixtures.mjs';
const groupOrder = ['psid-vbi', 'psid-cia', 'rsid'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = bytes => ({bytes: bytes.length, sha256: sha256(bytes)});
const portable = pathname => pathname.split(sep).join('/');
const detached = value => JSON.parse(JSON.stringify(value));
const headerFields = ['format', 'version', 'flags', 'clock', 'model', 'sidCount', 'songs', 'startSong', 'speed',
  'loadAddress', 'initAddress', 'playAddress'];

function paths(options) {
  assert(options && typeof options === 'object' && !Array.isArray(options), 'Performance-plan options must be an object');
  const root = resolve(options.root ?? repositoryRoot);
  return {root, corpusRoot: resolve(options.corpusRoot ?? resolve(root, 'ww/C64Music')),
    legacyPlanPath: resolve(options.legacyPlanPath ?? resolve(root, oldPlanPath))};
}
function repositoryPath(root, pathname) {
  const value = relative(root, pathname);
  assert(value && value !== '..' && !value.startsWith('..' + sep) && !isAbsolute(value), 'A plan source must be inside its repository');
  return portable(value);
}
function canonicalHeader(parsed) {
  return {...Object.fromEntries(headerFields.map(name => [name, parsed[name]])),
    basic: Boolean(parsed.basic), relocation: parsed.relocation ?? null};
}
async function localMusic(corpusRoot, name) {
  assert(typeof name === 'string' && name && !name.includes('\\') && !name.startsWith('/') &&
    name.split('/').every(part => part && part !== '.' && part !== '..'), 'Noncanonical local SID path');
  const file = resolve(corpusRoot, name), boundary = await realpath(corpusRoot);
  const info = await lstat(file);
  assert(info.isFile() && !info.isSymbolicLink() && info.size <= 65660, 'SID input must be a bounded regular file');
  const actual = await realpath(file);
  assert(actual.startsWith(boundary + sep), 'SID input escapes the selected local corpus');
  const bytes = await readFile(file);assert.equal(bytes.length, info.size, 'Local SID changed while reading');
  return bytes;
}

/** Create a metadata-only, deterministic plan. Only the three already selected
 * local files are read; the corpus is never rescanned and no program executes.
 * @param {{root?:string,corpusRoot?:string,legacyPlanPath?:string}} [options]
 */
export async function createSidWorkletPerfPlan(options = {}) {
  const {root, corpusRoot, legacyPlanPath} = paths(options);
  const legacyBytes = await readFile(legacyPlanPath), legacy = JSON.parse(legacyBytes);
  assert.equal(legacy.format, 'tetorica-sid8580-worklet-cases-plan');assert.equal(legacy.version, 1);
  assert.deepEqual(legacy.target, {clock: 'pal', model: '8580', environment: 'minimal'});
  assert.deepEqual(legacy.profiles, {resonance: false, cutoff: false});
  assert.equal(legacy.files.length, 3);assert.equal(legacy.cases.length, 6);assert.deepEqual(legacy.unavailable, []);
  assert.equal(legacy.selection.metadataOnly, true);assert.equal(legacy.selection.runtimeExecution, false);
  for (const [name, expected] of Object.entries(legacy.inputs)) {
    assert.equal(repositoryPath(root, resolve(root, name)), name, 'Noncanonical historical source path');
    assert.deepEqual(digest(await readFile(resolve(root, name))), expected, 'Frozen selection source changed: ' + name);
  }

  const cases = [], generated = [];
  for (const model of ['6581', '8580']) {
    const fixtureOptions = {model, sync: true, ring: true, voice3off: true};
    const fixture = createSidPairFixture(fixtureOptions), parsed = model === '6581'
      ? validateBrowserPsid(fixture.bytes, {model, clock: 'pal', subtune: 1, vbiBackend: 'c64'})
      : validateResearchSid(fixture.bytes, {model, clock: 'pal', environment: 'minimal', subtune: 1});
    assert.equal(parsed.model, model);assert.equal(parsed.clock, 'pal');assert.equal(parsed.format, 'PSID');assert.equal(parsed.timing, 'vbi');
    assert(Buffer.from(parsed.program).equals(Buffer.from(fixture.program)), 'Generated program differs from its authored payload');
    generated.push(fixture);
    cases.push({id: 'synthetic-pair-filter-' + model, source: 'generated', model, declaredModel: model,
      clock: 'pal', environment: 'minimal', format: 'PSID', timing: 'vbi', subtune: 1,
      input: digest(fixture.bytes), metadata: detached(parsed.metadata), header: canonicalHeader(parsed),
      generated: {module: fixturePath, export: 'createSidPairFixture', options: fixtureOptions, program: digest(fixture.program)}});
  }
  assert(Buffer.from(generated[0].program).equals(Buffer.from(generated[1].program)), 'Model comparison must use the exact same authored program payload');

  for (const group of groupOrder) {
    const files = legacy.files.filter(file => file.group === group);assert.equal(files.length, 1);
    const file = files[0], selected = file.cases[0];
    assert(selected);assert.deepEqual(legacy.cases.find(item => item.id === selected.id), selected);
    assert.equal(selected.fileId, file.id);assert.equal(selected.path, file.path);
    const bytes = await localMusic(corpusRoot, file.path);assert.deepEqual(digest(bytes), file.input, 'Frozen local music changed: ' + file.path);
    const parsed = validateResearchSid(bytes, {clock: 'pal', model: '8580', environment: 'minimal', subtune: selected.subtune});
    assert.deepEqual(canonicalHeader(parsed), file.header, 'Original SID header changed: ' + file.path);
    assert.deepEqual(parsed.metadata, file.metadata);assert.equal(parsed.model, '8580');assert.equal(parsed.clock, 'pal');
    assert.equal(parsed.sidCount, 1);assert.equal(parsed.version, 2);assert.equal(parsed.subtune, selected.subtune);
    assert.equal(parsed.timing, selected.timing);assert.equal(Boolean(parsed.basic), false);
    cases.push({id: selected.id, source: 'corpus', fileId: file.id, path: file.path, model: '8580', declaredModel: '8580',
      clock: 'pal', environment: 'minimal', format: parsed.format, timing: selected.timing, subtune: selected.subtune,
      input: digest(bytes), metadata: detached(file.metadata), header: detached(file.header),
      origin: {plan: repositoryPath(root, legacyPlanPath), caseId: selected.id, selectionRole: selected.selectionRole,
        rule: 'First already-frozen case for each group; no new selection or execution-based replacement.'}});
  }
  assert.equal(cases.length, 5);assert.equal(new Set(cases.map(item => item.id)).size, 5);
  assert.deepEqual(cases.filter(item => item.source === 'corpus').map(item => item.subtune), [1, 1, 4]);
  const engines = ['webkit', 'chromium'], modeOrder = ['ordinary', 'timed', 'capture', 'quiet-ui'], repetitions = 2;
  const runs = [];
  for (const engine of engines) for (const testCase of cases) for (let repetition = 0; repetition < repetitions; repetition++) {
    for (const mode of repetition === 0 ? modeOrder : [...modeOrder].reverse()) {
      runs.push({index: runs.length + 1, engine, caseId: testCase.id, model: testCase.model, repetition, mode});
    }
  }
  assert.equal(runs.length, 80);
  const sources = {};
  for (const name of [ownPath, repositoryPath(root, legacyPlanPath), fixturePath]) sources[name] = digest(await readFile(resolve(root, name)));
  const sampleRate = 44100, quantumFrames = 128, warmupBlocks = Math.ceil(sampleRate / quantumFrames),
    windowBlocks = Math.ceil(sampleRate * 5 / quantumFrames), warmupFrames = warmupBlocks * quantumFrames, windowFrames = windowBlocks * quantumFrames;
  assert.equal(warmupBlocks, 345);assert.equal(windowBlocks, 1723);
  return {format: 'tetorica-sid-worklet-performance-plan', version: 2, frozenOn: '2026-11-08',
    scope: 'Metadata-only pre-execution plan for optional local SID performance comparisons. No browser, CPU or SID is executed while creating or checking this plan.',
    corpus: {root: portable(relative(root, corpusRoot))}, sources,
    historicalPlan: {path: repositoryPath(root, legacyPlanPath), ...digest(legacyBytes),
      frozenInputHashesValidated: true, selectedLocalFilesValidated: true, fullCorpusRescanned: false},
    measurement: {sampleRate, quantumFrames, requestedWarmupSeconds: 1, requestedWindowSeconds: 5,
      rounding: 'Round each interval up independently to complete 128-frame producer blocks.',
      warmupBlocks, windowBlocks, warmupFrames, windowFrames, windowStartFrame: warmupFrames,
      windowEndFrame: warmupFrames + windowFrames, actualWarmupSeconds: warmupFrames / sampleRate,
      actualWindowSeconds: windowFrames / sampleRate,
      exactLogicalWindowModes: ['timed', 'capture', 'quiet-ui'],
      instrumentedArmBeforeStart: true,
      ordinaryBaseline: {exactLogicalWindow: false, warmupWaitMs: 1000, windowWaitMs: 5000,
        boundaryMethod: 'Approximate main-thread wall waits with RPC bookends after Play; record actual producer position and main-thread monotonic times at every boundary.',
        interpretation: 'Untimed progress control only. Its RPC boundaries do not identify the same logical PCM or processing-cost window as the three instrumented modes.'},
      ordinaryTiming: 'Unmodified product processor. No per-block elapsed metrics or full PCM scan: unavailable is not zero.',
      captureScan: {modes: ['capture'], includesWarmup: true, frames: warmupFrames + windowFrames,
        scope: 'Every emitted stereo frame during warmup plus the measured window; scalar finite/stereo/RMS/peak aggregates only.',
        distinction: 'Scan aggregates cover 264704 frames, while render/total timing histograms cover only the 220544-frame measured window. Ordinary, timed and quiet-ui do not compute full PCM aggregates.'},
      interpretation: 'Wall-clock render spans include scheduling. Date.now quantization is reported, not interpreted as an audible underrun. Audio currentTime/currentFrame are logical progress, not elapsed CPU time.'},
    modes: [
      {id: 'ordinary', workletTiming: false, fullPcmScan: false, normalUi: true, productProcessorUnchanged: true},
      {id: 'timed', workletTiming: true, fullPcmScan: false, normalUi: true, productProcessorUnchanged: false},
      {id: 'capture', workletTiming: true, fullPcmScan: true, normalUi: true, productProcessorUnchanged: false},
      {id: 'quiet-ui', workletTiming: true, fullPcmScan: false, normalUi: false, productProcessorUnchanged: false},
    ],
    controls: {ordinaryUiPollHz: 5, ordinaryVisualizerMaxHz: 30, quietUiSuppression: 'HTTP-only test instrumentation suppresses normal read polling and rAF; no product file edit.',
      timingAndCaptureInjection: 'HTTP-only test instrumentation; product runtime hashes belong in the execution report.',
      sampleWindow: 'Only timed, capture and quiet-ui use the identical complete logical producer-frame window, pre-armed before Start. Ordinary uses approximate wall waits and records actual RPC bookend positions; no identical PCM/cost-window comparison is claimed. Init PCM remains in the original core queue.',
      contexts: 'Fresh context per run; exactly one running page and one audio context; engines execute sequentially.',
      modelComparison: 'Both synthetic files are authored with their original model declaration and byte-identical program payloads. Original real-file headers are never rewritten.',
      profiles: {resonance: false, cutoff: false}},
    cases, order: {engines, caseIds: cases.map(item => item.id), repetitions,
      nesting: ['engine', 'case', 'repetition', 'mode'], repetitionModeOrders: [modeOrder, [...modeOrder].reverse()]},
    runs, summary: {inputs: cases.length, generatedInputs: 2, originalLocalInputs: 3, runsPerEngine: 40, totalRuns: runs.length,
      instrumentedRuns: runs.filter(run => run.mode !== 'ordinary').length, ordinaryUntimedRuns: runs.filter(run => run.mode === 'ordinary').length,
      framesPerInstrumentedRunIncludingWarmup: warmupFrames + windowFrames,
      totalInstrumentedProducerFrames: runs.filter(run => run.mode !== 'ordinary').length * (warmupFrames + windowFrames),
      ordinaryApproximateWaitMsPerRun: 6000},
    dataPolicy: {musicCopiedOrWritten: false, pcmSaved: false, firmwareUsed: false, syntheticProgramPersisted: false,
      savedData: 'Metadata, source/input hashes, execution order and later scalar measurements only.'},
    interpretation: 'A frozen plan is not playback success, real-time or glitch-free approval, listening, whole-song compatibility or hardware fidelity. Failed or silent runs are retained; no execution-based substitution.'};
}

/** Rebuild and compare the complete plan against current frozen sources and
 * the three selected local files; no full-corpus scan or program execution.
 * @param {object|string} planOrPath
 * @param {{root?:string,corpusRoot?:string,legacyPlanPath?:string}} [options]
 */
export async function validateSidWorkletPerfPlan(planOrPath, options = {}) {
  const candidate = typeof planOrPath === 'string' ? JSON.parse(await readFile(resolve(planOrPath), 'utf8')) : planOrPath;
  assert(candidate && typeof candidate === 'object' && !Array.isArray(candidate), 'Expected a frozen performance plan');
  const expected = await createSidWorkletPerfPlan(options);
  assert.deepEqual(candidate, expected, 'Performance plan differs from its frozen controls, sources or selected file hashes');
  return candidate;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};let mode, target;
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i], value = process.argv[++i];assert(value && !value.startsWith('--'), 'Missing performance-plan argument');
    if (flag === '--write' || flag === '--check') {assert(!mode, 'Choose --write or --check');mode = flag;target = resolve(value);}
    else {const key = {'--corpus-root': 'corpusRoot', '--legacy-plan': 'legacyPlanPath'}[flag];assert(key, 'Unknown performance-plan argument ' + flag);options[key] = resolve(value);}
  }
  assert(mode, 'Usage: --write OUT | --check PLAN [--corpus-root DIR --legacy-plan FILE]');
  const plan = mode === '--check' ? await validateSidWorkletPerfPlan(target, options) : await createSidWorkletPerfPlan(options);
  if (mode === '--write') {await mkdir(dirname(target), {recursive: true});await writeFile(target, JSON.stringify(plan, null, 2) + '\n', {flag: 'wx'});}
  console.log(JSON.stringify({passed: true, mode, path: target, ...plan.summary}));
}
