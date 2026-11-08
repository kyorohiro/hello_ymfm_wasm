// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SidWorkletMetrics} from '../scripts/sid_worklet_metrics.mjs';
import {summarizeSidWorkletPerformance} from '../scripts/summarize_sid_worklet_performance.mjs';

const plan = JSON.parse(await readFile(new URL('../docs/issues/sid_worklet_perf_plan_02.json',import.meta.url)));
const m = plan.measurement;
const cache = new Map();
function metric(blocks,renderMs,totalMs) {
  const key = [blocks,renderMs,totalMs].join('/');
  if (!cache.has(key)) {
    const value = new SidWorkletMetrics({sampleRate:m.sampleRate});
    for (let i=0;i<blocks;i++) value.record(renderMs,totalMs,128,i*3);
    cache.set(key,value.snapshot());
  }
  return structuredClone(cache.get(key));
}
function fixture() {
  const original = {bytes:100,sha256:'a'.repeat(64)};
  const report = {format:'tetorica-sid-worklet-performance',version:1,completed:true,allPlannedRunsExecuted:true,
    passed:true,interrupted:false,activeRun:null,physicalOutputMuted:true,listeningPerformed:false,gameOrFirmwareOrPcmSaved:false,
    inputs:{'docs/sid-player/processor.js':original},processorResponses:{ordinary:{...original}},
    selection:{indices:plan.runs.map(run => run.index)},measurement:structuredClone(m),results:[],abandonedRuns:[]};
  for (const run of plan.runs) {
    const item = plan.cases.find(item => item.id===run.caseId),caseNumber=plan.cases.indexOf(item);
    const state = positionFrames => ({model:item.model,format:item.format,timing:item.timing,subtune:item.subtune,playing:true,positionFrames,cycles:positionFrames*20});
    const boundary = positionFrames => ({sampleRate:m.sampleRate,muted:true,visibility:'visible',output:{finite:true},
      wallBeforeMs:positionFrames/m.sampleRate*1000,wallAfterMs:positionFrames/m.sampleRate*1000,contextTime:positionFrames/m.sampleRate,state:state(positionFrames)});
    const point = positionFrames => ({model:item.model,format:item.format,timing:item.timing,positionFrames,
      cycles:1000000+positionFrames*20+caseNumber,irqCount:15,nmiCount:0,playCalls:16});
    const row = {...run,status:'passed',browserVersion:'test',errors:[],consoleErrors:[],httpFailures:[],external:[],
      initial:boundary(128),windowEnd:boundary(270000),nonzeroBoundaryObserved:true,producerFramesPerWallSecond:m.sampleRate,
      audit:{fatal:[],suppressedRaf:run.mode==='quiet-ui'?1:0,suppressedPoll:run.mode==='quiet-ui'?1:0},closedContexts:['closed']};
    if (run.mode==='ordinary') {row.metrics=null; row.windowStart=boundary(50000);}
    else {
      const renderMs=run.mode==='timed'?1:run.mode==='capture'?(run.repetition===0?2:.5):.5;
      const totalMs=run.mode==='capture'?renderMs+1:renderMs;
      row.metrics={complete:true,timerSource:'Date.now',warmup:metric(m.warmupBlocks,4,5),window:metric(m.windowBlocks,renderMs,totalMs),
        start:point(m.windowStartFrame),end:point(m.windowEndFrame),scan:{frames:run.mode==='capture'?m.captureScan.frames:0,
          nonfiniteSamples:0,stereoMismatches:0,missingChannelFrames:0,nonzeroFrames:run.mode==='capture'?m.captureScan.frames:0}};
    }
    report.results.push(row);
  }
  return report;
}

test('complete 80-run summary keeps 20 ordinary timing values unavailable and excludes warmup from the 60 timed means', () => {
  const report=fixture(),summary=summarizeSidWorkletPerformance(report,plan);
  assert.equal(summary.inventory.runs,80); assert.equal(summary.inventory.ordinaryUntimedRuns,20); assert.equal(summary.inventory.instrumentedRuns,60);
  assert.equal(summary.inventory.totalMeasuredWindowFrames,60*220544); assert.equal(summary.inventory.captureScannedFramesIncludingWarmup,20*264704);
  assert.equal(summary.byEngineMode.length,8); assert.equal(summary.byEngineCaseMode.length,40);
  for (const row of summary.byEngineMode.filter(row => row.mode==='ordinary')) {
    assert.equal(row.timing,null); assert.match(row.ordinaryTimingAvailability,/not zero/);
  }
  const timed=summary.byEngineMode.find(row => row.engine==='webkit'&&row.mode==='timed');
  assert.equal(timed.timing.render.meanMs,1); assert.equal(timed.timing.render.maxMs,1);
  assert.equal(timed.timing.blocks,10*1723); assert.equal(timed.timing.render.rawOverBudgetBlocks,0);
  assert.equal(summary.exactLogicalWindows.groups.length,10);
  assert(summary.exactLogicalWindows.groups.every(group => group.indices.length===6));
  assert.equal(summary.progressByRun.length,80);
  const ordinary = summary.progressByRun.find(row=>row.mode==='ordinary');
  assert.equal(ordinary.initialToEndIncludingWarmup.producerFramesDelta,270000-128);
  assert.equal(ordinary.ordinaryApproximateWindow.producerFramesDelta,220000);
  assert.equal(summary.progressByRun.find(row=>row.mode==='timed').ordinaryApproximateWindow,null);
});

test('paired two-repetition differences retain both signs rather than declaring a causal capture slowdown', () => {
  const summary=summarizeSidWorkletPerformance(fixture(),plan);
  const pair=summary.pairedComparisons.find(row => row.engine==='webkit'&&row.caseId===plan.cases[0].id&&row.comparison==='capture minus timed');
  assert.equal(pair.repetitions,2); assert.deepEqual(pair.samples.map(row=>row.renderMeanMs),[1,-.5]);
  assert.deepEqual(pair.rangesAndSigns.renderMeanMs,{minimum:-.5,maximum:1,positive:1,zero:0,negative:1});
  assert.match(summary.interpretation.comparisons,/do not isolate causation/);
});

test('missing, duplicate or failed runs and pilot flags are rejected instead of summarized as a full comparison', () => {
  for (const change of [
    report=>{report.results.pop();},
    report=>{report.results[1]=structuredClone(report.results[0]);},
    report=>{report.results[5].status='failed';},
    report=>{report.completed=false;},
    report=>{report.allPlannedRunsExecuted=false;},
    report=>{report.results[0].repetition=1;},
  ]) {const report=fixture();change(report);assert.throws(()=>summarizeSidWorkletPerformance(report,plan));}
});

test('cross-mode or cross-repetition logical CPU drift is rejected without normalizing away changed states', () => {
  for (const field of ['cycles','irqCount','positionFrames']) {
    const report=fixture(); const changed=report.results.find(row=>row.mode==='capture'&&row.repetition===1);
    changed.metrics.end[field]++;
    assert.throws(()=>summarizeSidWorkletPerformance(report,plan),/drift|Expected values/);
  }
});

test('ordinary metrics, missing histogram blocks, wrong scan scope or failed quiet-UI suppression cannot borrow passing flags', () => {
  for (const change of [
    report=>{report.results[0].metrics=report.results[1].metrics;},
    report=>{report.results[1].metrics.window.render.histogram.bins[10]--;},
    report=>{report.results[2].metrics.scan.frames=220544;},
    report=>{report.results[3].audit.suppressedPoll=0;},
    report=>{report.processorResponses.ordinary.sha256='b'.repeat(64);},
    report=>{delete report.processorResponses.ordinary;delete report.inputs['docs/sid-player/processor.js'];},
  ]) {const report=fixture();change(report);assert.throws(()=>summarizeSidWorkletPerformance(report,plan));}
});
