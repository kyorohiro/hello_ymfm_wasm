#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Summarize only a complete frozen experiment. No browser, music or PCM needed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const MODES = ['ordinary', 'timed', 'capture', 'quiet-ui'];
const TIMED = MODES.slice(1);
const count = (value, label) => assert(Number.isSafeInteger(value) && value >= 0, label);
const finite = (value, label) => assert(Number.isFinite(value), label);
const identity = value => Object.fromEntries(['index','engine','caseId','model','repetition','mode'].map(key => [key,value[key]]));
const digest = bytes => ({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const range = values => ({minimum:Math.min(...values),maximum:Math.max(...values)});

function checkSpan(span, blocks, label) {
  assert(span && typeof span === 'object', label);
  assert.equal(span.validBlocks, blocks, label + ': all observed blocks must have valid elapsed durations');
  assert.equal(span.invalidBlocks, 0, label + ': invalid durations cannot be dropped from means');
  finite(span.totalMs, label + ': totalMs'); finite(span.meanMs, label + ': meanMs'); finite(span.maxMs, label + ': maxMs');
  assert(span.totalMs >= 0 && span.meanMs >= 0 && span.maxMs >= 0, label + ': nonnegative elapsed');
  assert.equal(span.meanMs, span.totalMs / blocks, label + ': mean must retain the raw sum');
  const sumRoundingAllowance = 32 * Number.EPSILON * blocks * Math.max(1,span.maxMs);
  assert(span.meanMs <= span.maxMs + sumRoundingAllowance, label + ': maximum cannot be below the mean');
  for (const key of ['rawOverBudgetBlocks','quantizationSensitiveOverBudgetBlocks','beyondQuantumOverBudgetBlocks']) count(span[key], label + ': ' + key);
  assert.equal(span.rawOverBudgetBlocks, span.quantizationSensitiveOverBudgetBlocks + span.beyondQuantumOverBudgetBlocks, label + ': conditional counts partition raw threshold observations');
  assert(span.rawOverBudgetBlocks <= blocks, label + ': threshold count');
  assert.equal(span.histogram.binWidthMs, .1); assert.equal(span.histogram.upperLimitMs, 20);
  assert.equal(span.histogram.bins.length, 200);
  for (const value of span.histogram.bins) count(value, label + ': histogram count');
  count(span.histogram.overflowCount, label + ': overflow count');
  assert.equal(span.histogram.bins.reduce((sum,n) => sum+n, span.histogram.overflowCount), blocks, label + ': every valid block must remain in the histogram');
}

function checkWindow(window, blocks, frames, measurement, label) {
  assert(window && typeof window === 'object', label);
  assert.equal(window.blocks, blocks); assert.equal(window.frames, frames); assert.equal(window.invalidFrameBlocks, 0);
  assert.equal(window.sampleRate, measurement.sampleRate); assert.equal(window.quantumMs, 1);
  assert.equal(typeof window.timerSource, 'string'); assert(window.timerSource.length > 0);
  checkSpan(window.render, blocks, label + '/render'); checkSpan(window.total, blocks, label + '/total');
  count(window.inconsistentSpans, label + ': inconsistent spans');
  count(window.clock.starts, label + ': clock starts');
  count(window.clock.negativeStartDeltas, label + ': negative start deltas');
  count(window.clock.nonfiniteStarts, label + ': nonfinite starts');
  if (window.clock.minPositiveStartDeltaMs !== null) assert(Number.isFinite(window.clock.minPositiveStartDeltaMs) && window.clock.minPositiveStartDeltaMs > 0);
}

function quantile(bins, overflow, blocks, probability) {
  const rank = Math.ceil(blocks * probability); let total = 0;
  for (let i = 0; i < bins.length; i++) {
    total += bins[i];
    if (total >= rank) return {lowerMs:i/10,upperMs:(i+1)/10,upperExclusive:true,overflow:false};
  }
  assert(total + overflow >= rank);
  return {lowerMs:20,upperMs:null,upperExclusive:false,overflow:true};
}

function mergeSpan(rows, key) {
  let blocks = 0, totalMs = 0, maxMs = 0, raw = 0, sensitive = 0, beyond = 0, overflow = 0;
  const bins = Array(200).fill(0);
  for (const row of rows) {
    const span = row.metrics.window[key]; blocks += span.validBlocks; totalMs += span.totalMs;
    maxMs = Math.max(maxMs, span.maxMs); raw += span.rawOverBudgetBlocks;
    sensitive += span.quantizationSensitiveOverBudgetBlocks; beyond += span.beyondQuantumOverBudgetBlocks;
    overflow += span.histogram.overflowCount;
    span.histogram.bins.forEach((count,i) => {bins[i] += count;});
  }
  return {blocks,totalMs,meanMs:totalMs/blocks,maxMs,rawOverBudgetBlocks:raw,
    rawOverBudgetPercent:raw/blocks*100,quantizationSensitiveOverBudgetBlocks:sensitive,
    beyondNominal1msOverBudgetBlocks:beyond,beyondNominal1msOverBudgetPercent:beyond/blocks*100,
    observedHistogramQuantiles:{p50:quantile(bins,overflow,blocks,.5),p95:quantile(bins,overflow,blocks,.95),p99:quantile(bins,overflow,blocks,.99)}};
}

function aggregate(rows) {
  assert(rows.length);
  const untimed = rows[0].mode === 'ordinary'; assert(rows.every(row => (row.mode === 'ordinary') === untimed));
  return {runs:rows.length,indices:rows.map(row => row.index),
    producerFramesPerWallSecond:range(rows.map(row => row.producerFramesPerWallSecond)),
    timing:untimed ? null : {availability:'instrumented observed wall spans',
      blocks:rows.reduce((sum,row) => sum+row.metrics.window.blocks,0),
      frames:rows.reduce((sum,row) => sum+row.metrics.window.frames,0),
      timerSources:[...new Set(rows.map(row => row.metrics.timerSource))],
      render:mergeSpan(rows,'render'),total:mergeSpan(rows,'total'),
      clockWarnings:{negativeStartDeltas:rows.reduce((sum,row) => sum+row.metrics.window.clock.negativeStartDeltas,0),
        nonfiniteStarts:rows.reduce((sum,row) => sum+row.metrics.window.clock.nonfiniteStarts,0),
        inconsistentSpans:rows.reduce((sum,row) => sum+row.metrics.window.inconsistentSpans,0)}},
    ordinaryTimingAvailability:untimed ? 'unavailable; not zero or an observed no-overrun result' : null};
}

function delta(variant, reference) {
  const a = variant.metrics.window, b = reference.metrics.window;
  assert.equal(a.blocks,b.blocks); assert.equal(a.frames,b.frames);
  return {variantIndex:variant.index,referenceIndex:reference.index,
    renderMeanMs:a.render.meanMs-b.render.meanMs,totalMeanMs:a.total.meanMs-b.total.meanMs,
    renderRawOverBudgetBlocks:a.render.rawOverBudgetBlocks-b.render.rawOverBudgetBlocks,
    totalRawOverBudgetBlocks:a.total.rawOverBudgetBlocks-b.total.rawOverBudgetBlocks,
    renderBeyondNominal1msBlocks:a.render.beyondQuantumOverBudgetBlocks-b.render.beyondQuantumOverBudgetBlocks,
    totalBeyondNominal1msBlocks:a.total.beyondQuantumOverBudgetBlocks-b.total.beyondQuantumOverBudgetBlocks,
    renderMaxMs:a.render.maxMs-b.render.maxMs,totalMaxMs:a.total.maxMs-b.total.maxMs};
}

function describeDeltas(rows) {
  const keys = Object.keys(rows[0]).filter(key => !['variantIndex','referenceIndex'].includes(key));
  return Object.fromEntries(keys.map(key => {
    const values = rows.map(row => row[key]);
    return [key,{...range(values),positive:values.filter(v => v > 0).length,
      zero:values.filter(v => v === 0).length,negative:values.filter(v => v < 0).length}];
  }));
}

function bookendProgress(start,end,sampleRate) {
  const frames = end.state.positionFrames-start.state.positionFrames;
  const midpointSeconds = (end.wallBeforeMs+end.wallAfterMs-start.wallBeforeMs-start.wallAfterMs)/2000;
  assert(frames > 0 && midpointSeconds > 0,'Progress bookends must advance');
  const point = value => ({positionFrames:value.state.positionFrames,cycles:value.state.cycles,
    contextTime:value.contextTime,wallBeforeMs:value.wallBeforeMs,wallAfterMs:value.wallAfterMs});
  return {start:point(start),end:point(end),producerFramesDelta:frames,
    producerLogicalSeconds:frames/sampleRate,contextTimeDeltaSeconds:end.contextTime-start.contextTime,
    mainWallMidpointDeltaMs:midpointSeconds*1000,
    mainWallIntervalBoundsMs:{minimum:end.wallBeforeMs-start.wallAfterMs,maximum:end.wallAfterMs-start.wallBeforeMs},
    producerFramesPerWallSecond:frames/midpointSeconds};
}

/** Strict, pure summary of the entire predeclared 80-run comparison. */
export function summarizeSidWorkletPerformance(report, plan) {
  assert.equal(plan.format,'tetorica-sid-worklet-performance-plan'); assert.equal(plan.version,2);
  assert.equal(report.format,'tetorica-sid-worklet-performance'); assert.equal(report.version,1);
  assert.equal(report.completed,true,'An unfinished report cannot produce a completed summary');
  assert.equal(report.allPlannedRunsExecuted,true,'A pilot or subset is not the full experiment'); assert.equal(report.passed,true);
  assert.equal(report.interrupted,false); assert.equal(report.activeRun,null);
  assert.equal(report.physicalOutputMuted,true); assert.equal(report.listeningPerformed,false); assert.equal(report.gameOrFirmwareOrPcmSaved,false);
  assert.equal(plan.runs.length,80); assert.equal(report.results.length,80);
  assert.deepEqual(report.selection.indices,plan.runs.map(row => row.index));
  assert.deepEqual(report.measurement,plan.measurement);
  for (const value of [report.processorResponses.ordinary,report.inputs['docs/sid-player/processor.js']]) {
    assert(value && Number.isSafeInteger(value.bytes) && value.bytes > 0 && /^[0-9a-f]{64}$/.test(value.sha256),'Product processor byte evidence is required');
  }
  assert.deepEqual(report.processorResponses.ordinary,report.inputs['docs/sid-player/processor.js'],'Untimed baseline must use the original product processor bytes');
  const modes = plan.modes.map(mode => mode.id); assert.deepEqual(modes,MODES);
  const engines = plan.order.engines; assert.deepEqual(engines,['webkit','chromium']);
  assert.equal(plan.order.repetitions,2); assert.equal(plan.cases.length,5);
  assert.equal(new Set(plan.runs.map(row => row.index)).size,80);
  assert.equal(new Set(report.results.map(row => row.index)).size,80,'Duplicate report indices');
  const items = new Map(plan.cases.map(item => [item.id,item]));
  const m = plan.measurement;
  assert.equal(m.sampleRate,44100); assert.equal(m.quantumFrames,128);
  assert.equal(m.warmupBlocks,345); assert.equal(m.windowBlocks,1723);
  assert.equal(m.warmupFrames,44160); assert.equal(m.windowFrames,220544); assert.equal(m.captureScan.frames,264704);
  assert.equal(m.windowStartFrame,m.warmupFrames); assert.equal(m.windowEndFrame,m.warmupFrames+m.windowFrames);
  const exactWindows = new Map(), progressByRun = []; let rawRuns = 0, timedRuns = 0, scanFrames = 0;
  for (let i = 0; i < plan.runs.length; i++) {
    const row = report.results[i], expected = plan.runs[i], item = items.get(row.caseId);
    assert.deepEqual(identity(row),identity(expected),'Run identity/order differs from frozen plan at index '+expected.index);
    assert(item); assert.equal(row.status,'passed'); assert.equal(row.nonzeroBoundaryObserved,true);
    for (const key of ['errors','consoleErrors','httpFailures','external']) assert.deepEqual(row[key],[]);
    assert.deepEqual(row.audit.fatal,[]); assert.deepEqual(row.closedContexts,['closed']);
    if (row.mode === 'quiet-ui') {assert(row.audit.suppressedRaf>0); assert.equal(row.audit.suppressedPoll,1);}
    else {assert.equal(row.audit.suppressedRaf,0); assert.equal(row.audit.suppressedPoll,0);}
    finite(row.producerFramesPerWallSecond,'Progress rate'); assert(row.producerFramesPerWallSecond > 0);
    for (const boundary of [row.initial,row.windowEnd,...(row.mode === 'ordinary' ? [row.windowStart] : [])]) {
      assert(boundary); assert.equal(boundary.sampleRate,m.sampleRate); assert.equal(boundary.muted,true);
      assert.equal(boundary.visibility,'visible'); assert.equal(boundary.output.finite,true);
      assert.equal(boundary.state.model,item.model); assert.equal(boundary.state.subtune,item.subtune);
      assert.equal(boundary.state.format,item.format); assert.equal(boundary.state.timing,item.timing); assert.equal(boundary.state.playing,true);
      count(boundary.state.positionFrames,'Producer position'); finite(boundary.wallBeforeMs,'Boundary wall clock'); finite(boundary.wallAfterMs,'Boundary wall clock');
      count(boundary.state.cycles,'Boundary CPU cycles'); finite(boundary.contextTime,'AudioContext logical time');
      assert(boundary.wallAfterMs >= boundary.wallBeforeMs);
    }
    assert(row.windowEnd.state.positionFrames > row.initial.state.positionFrames);
    const initialToEndIncludingWarmup = bookendProgress(row.initial,row.windowEnd,m.sampleRate);
    const rate = initialToEndIncludingWarmup.producerFramesPerWallSecond;
    assert(Math.abs(rate-row.producerFramesPerWallSecond) <= 64*Number.EPSILON*Math.max(1,Math.abs(rate)),'Recorded progress rate differs from its raw RPC bookends');
    progressByRun.push({...identity(row),recordedProducerFramesPerWallSecond:row.producerFramesPerWallSecond,
      initialToEndIncludingWarmup,
      ordinaryApproximateWindow:row.mode==='ordinary'?bookendProgress(row.windowStart,row.windowEnd,m.sampleRate):null});
    if (row.mode === 'ordinary') {
      rawRuns++; assert.equal(row.metrics,null,'Ordinary timing must remain unavailable, not zero');
      assert(row.windowEnd.state.positionFrames > row.windowStart.state.positionFrames); continue;
    }
    timedRuns++; const observed = row.metrics; assert(observed); assert.equal(observed.complete,true);
    checkWindow(observed.warmup,m.warmupBlocks,m.warmupFrames,m,'Warmup '+row.index);
    checkWindow(observed.window,m.windowBlocks,m.windowFrames,m,'Window '+row.index);
    assert.equal(observed.timerSource,observed.window.timerSource); assert.equal(observed.timerSource,observed.warmup.timerSource);
    assert.equal(observed.start.positionFrames,m.windowStartFrame); assert.equal(observed.end.positionFrames,m.windowEndFrame);
    for (const boundary of [observed.start,observed.end]) {
      assert.equal(boundary.model,row.model); assert.equal(boundary.format,item.format); assert.equal(boundary.timing,item.timing);
      count(boundary.cycles,'CPU cycles');
      if (boundary.sidCycles !== undefined) assert.equal(boundary.sidCycles,boundary.cycles);
    }
    assert(observed.end.cycles > observed.start.cycles);
    const key = row.engine+'/'+row.caseId, point = {start:observed.start,end:observed.end};
    if (!exactWindows.has(key)) exactWindows.set(key,{indices:[row.index],...point});
    else {
      const reference = exactWindows.get(key);
      assert.deepEqual(point,{start:reference.start,end:reference.end},'Exact logical window/CPU state drift: '+key+' run '+row.index);
      reference.indices.push(row.index);
    }
    if (row.mode === 'capture') {
      assert.equal(observed.scan.frames,m.captureScan.frames); scanFrames += observed.scan.frames;
      for (const key of ['nonfiniteSamples','stereoMismatches','missingChannelFrames']) assert.equal(observed.scan[key],0);
      assert(observed.scan.nonzeroFrames > 0);
    } else assert.equal(observed.scan.frames,0);
  }
  assert.equal(rawRuns,20); assert.equal(timedRuns,60);
  const browserVersions = Object.fromEntries(engines.map(engine => {
    const values = [...new Set(report.results.filter(row=>row.engine===engine).map(row=>row.browserVersion))];
    assert.equal(values.length,1,'One browser version is required per sequential engine');
    assert.equal(typeof values[0],'string'); assert(values[0].length>0);
    return [engine,values[0]];
  }));
  const byEngineMode = [], byEngineCaseMode = [], pairs = [];
  for (const engine of engines) {
    for (const mode of modes) {
      const rows = report.results.filter(row => row.engine === engine && row.mode === mode);
      assert.equal(rows.length,10); byEngineMode.push({engine,mode,...aggregate(rows)});
    }
    for (const item of plan.cases) {
      const rows = report.results.filter(row => row.engine === engine && row.caseId === item.id);
      for (const mode of modes) {
        const selected = rows.filter(row => row.mode === mode); assert.equal(selected.length,2);
        byEngineCaseMode.push({engine,caseId:item.id,model:item.model,mode,...aggregate(selected)});
      }
      for (const mode of ['capture','quiet-ui']) {
        const paired = [0,1].map(repetition => {
          const variant = rows.find(row => row.mode === mode && row.repetition === repetition), reference = rows.find(row => row.mode === 'timed' && row.repetition === repetition);
          return {repetition,...delta(variant,reference)};
        });
        pairs.push({engine,caseId:item.id,model:item.model,comparison:mode+' minus timed',repetitions:2,
          samples:paired,rangesAndSigns:describeDeltas(paired.map(({repetition,...row}) => row))});
      }
    }
  }
  for (const value of exactWindows.values()) assert.equal(value.indices.length,6);
  return {format:'tetorica-sid-worklet-performance-summary',version:1,passed:true,
    inventory:{runs:80,ordinaryUntimedRuns:rawRuns,instrumentedRuns:timedRuns,engines,browserVersions,cases:plan.cases.length,repetitions:2,
      measuredWindowFramesPerInstrumentedRun:m.windowFrames,measuredWindowBlocksPerInstrumentedRun:m.windowBlocks,
      totalMeasuredWindowFrames:timedRuns*m.windowFrames,captureScannedFramesIncludingWarmup:scanFrames},
    measurement:{sampleRate:m.sampleRate,quantumFrames:m.quantumFrames,quantumBudgetMs:m.quantumFrames/m.sampleRate*1000,
      warmupFrames:m.warmupFrames,windowFrames:m.windowFrames,scanFramesPerCapture:m.captureScan.frames,
      clockQuantizationAllowanceMs:1},
    byEngineMode,byEngineCaseMode,pairedComparisons:pairs,progressByRun,
    exactLogicalWindows:{allInstrumentedModeAndRepetitionPointsMatch:true,groups:[...exactWindows].map(([key,value]) => ({key,...value}))},
    abandonedRunsRetained:report.abandonedRuns ?? [],
    interpretation:{ordinary:'No Worklet time metrics exist for ordinary runs. Null timing is preserved and is not a zero-cost or no-overrun result.',
      means:'Render and total means are weighted by valid measured-window blocks; warmup is excluded. Quantile intervals are from merged histograms, never averaged per-run quantiles.',
      clocks:'Observed wall-clock spans include possible OS/browser descheduling and timer effects. Date.now is non-monotonic; the 1ms subtraction is a declared assumption, not a proven precision guarantee or CPU-time measurement.',
      quantiles:'Intervals bound observed timer-delta histogram bins only; a narrow bin does not remove timer quantization from the underlying elapsed duration.',
      conditionalCounts:'Raw threshold counts and beyond-nominal-1ms counts do not establish actual device underruns or audible glitches.',
      comparisons:'Two reversed-order repetitions give descriptive paired differences, ranges and sign counts only. They do not isolate causation, establish statistical significance or prove timer/UI/PCM-scan overhead.',
      progress:'Initial/end RPC bookends include warmup and approximate message timing. Producer positions, AudioContext logical time and main-thread performance.now wall deltas are retained separately; their differences do not establish dropped device frames, CPU time or an identical measured PCM/cost window. Ordinary approximate window bookends are separate again.',
      scan:'Capture scalar scans include warmup plus the measured window. Timing aggregates include only the measured window; their frame counts must not be conflated.',
      limits:'No listening, whole-song compatibility, long-term/background/device stability or hardware fidelity conclusion.'}};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = {'--report':'report','--plan':'plan','--out':'out'}[process.argv[i]], value = process.argv[++i];
    assert(key && value && !value.startsWith('--'),'Usage: --report COMPLETE_JSON --plan FROZEN_PLAN --out NEW_SUMMARY');
    assert(!options[key],'Duplicate '+key); options[key] = resolve(value);
  }
  assert(options.report && options.plan && options.out,'All three paths are required');
  const [reportBytes,planBytes] = await Promise.all([readFile(options.report),readFile(options.plan)]);
  const report = JSON.parse(reportBytes), plan = JSON.parse(planBytes);
  assert.deepEqual({bytes:report.plan.bytes,sha256:report.plan.sha256},digest(planBytes),'Report does not name this exact frozen plan');
  const summary = summarizeSidWorkletPerformance(report,plan);
  summary.provenance = {report:{path:options.report,...digest(reportBytes)},plan:{path:options.plan,...digest(planBytes)},
    summarizer:{path:'scripts/summarize_sid_worklet_performance.mjs',...digest(await readFile(fileURLToPath(import.meta.url)))}};
  await mkdir(dirname(options.out),{recursive:true});
  await writeFile(options.out,JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({passed:true,runs:summary.inventory.runs,instrumentedRuns:summary.inventory.instrumentedRuns,out:options.out}));
}
