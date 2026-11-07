// SPDX-License-Identifier: BSD-3-Clause
// Analytic transfer functions, not SID implementation or reference data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cutoffCrossing} from '../scripts/sid8580_cutoff_metrics.mjs';
import {deriveCutoffFit} from '../scripts/analyze_sid8580_cutoff.mjs';
import {CUTOFF_MATRIX,sid8580CutoffFixtures} from './helpers/sid8580_cutoff_fixtures.mjs';

function near(actual, expected, relative = 1e-12) {
  assert(Number.isFinite(actual), `Nonfinite estimate: ${actual}`);
  assert(Math.abs(actual / expected - 1) < relative, `${actual} differs from ${expected}`);
}
function ideal({f0 = 1375, q = 0.707, gain = 0.2, rcLow = 16000, rcHigh = 16,
  level = 1, factors = [0.6, 0.72, 0.84, 0.96, 1.08, 1.2, 1.32, 1.44, 1.6]} = {}) {
  return factors.map(factor => {
    const hz = f0 * factor, r = hz / f0;
    const denominator = Math.hypot(1 - r * r, r / q);
    const commonRc = (hz / Math.hypot(hz, rcHigh)) / Math.hypot(1, hz / rcLow);
    const common = gain * level * commonRc / denominator;
    return {hz, lp: common, hp: common * r * r, valid: true};
  });
}

test('recovers ideal crossover independently of Q, common RC, output gain and drive level', () => {
  for (const f0 of [420, 1375, 12700]) for (const q of [0.5, 0.707, 1.4, 2.6]) {
    for (const [gain, level, rcLow, rcHigh] of [[0.2, 1, 16000, 16], [0.1, 0.25, 12000, 1.6], [0.35, 0.5, 22000, 40]]) {
      const result = cutoffCrossing(ideal({f0, q, gain, level, rcLow, rcHigh}));
      assert.equal(result.reason, null); near(result.estimatedHz, f0);
      near(result.bracketSlopeDbPerOctave, -40 * Math.log10(2));
    }
  }
});

test('recognizes exact interior equality with two-sided support', () => {
  const result = cutoffCrossing(ideal({f0: 800, factors: [0.5, 0.8, 1, 1.3, 2]}));
  assert.equal(result.reason, null); assert.equal(result.estimatedHz, 800);
  assert.deepEqual(result.bracketHz, [640, 1040]);
});

test('operational crossover includes mode gain imbalance and is not an arbitrary-Q -3dB frequency', () => {
  const f0 = 1000, lpGain = 1.21;
  for (const q of [0.5, 2.6]) {
    const rows = ideal({f0, q}).map(row => ({...row, lp: row.lp * lpGain}));
    const result = cutoffCrossing(rows);
    near(result.estimatedHz, f0 * Math.sqrt(lpGain));
    assert.notEqual(result.estimatedHz, f0);
  }
});

test('sorting is nonmutating and invalid tails remain explicit', () => {
  const rows = ideal(); rows[0].valid = false; rows.at(-1).clipped = 1;
  rows.reverse(); const original = structuredClone(rows);
  const result = cutoffCrossing(rows);
  near(result.estimatedHz, 1375); assert.deepEqual(rows, original);
  assert.equal(result.excludedPoints.length, 2);
  assert.deepEqual(result.excludedPoints.map(p => p.reason), ['rejected-by-caller', 'clipped']);
});

test('rejects weak or unobserved data inside the crossing bracket', () => {
  for (const change of [row => {row.valid = false;}, row => {row.lp = 1 / 32768;}, row => {row.hp = 0;}, row => {row.stable = false;}]) {
    const rows = ideal({factors: [0.6, 0.8, 1, 1.2, 1.5]}); change(rows[2]);
    const result = cutoffCrossing(rows);
    assert.equal(result.estimatedHz, null); assert.equal(result.reason, 'invalid-data-inside-bracket');
  }
});

test('does not invent an estimate when a crossing or two-sided support is absent', () => {
  for (const factors of [[0.5, 0.7, 0.9], [1.1, 1.3, 1.7]]) {
    const result = cutoffCrossing(ideal({factors}));
    assert.equal(result.estimatedHz, null); assert.equal(result.reason, 'no-crossing');
  }
  assert.equal(cutoffCrossing(ideal({factors: [1, 1.3, 1.7]})).reason, 'unbracketed-equality');
});

test('rejects duplicate frequencies, multiple crossings and the wrong crossing direction', () => {
  const rows = ideal(); rows[1].hz = rows[0].hz;
  assert.equal(cutoffCrossing(rows).reason, 'duplicate-frequency');
  const fromRatio = ratios => ratios.map((r, i) => ({hz: 400 + i * 200, lp: r * 0.05, hp: 0.05, valid: true}));
  assert.equal(cutoffCrossing(fromRatio([2, 0.8, 1.2, 0.5])).reason, 'multiple-crossings');
  assert.equal(cutoffCrossing(fromRatio([0.3, 0.7, 1.4])).reason, 'wrong-crossing-direction');
  assert.equal(cutoffCrossing(fromRatio([2, 1, 1, 0.5])).reason, 'multiple-crossings');
});

test('rejects nonmonotonic excursions rather than smoothing measurements into a crossing', () => {
  const rows = [3, 1.1, 1.25, 0.7, 0.3].map((r, i) => ({hz: 400 + i * 200, lp: r * 0.05, hp: 0.05, valid: true}));
  const result = cutoffCrossing(rows);
  assert.equal(result.estimatedHz, null); assert.equal(result.reason, 'nonmonotonic-ratio');
  assert.equal(result.thresholds.monotonicToleranceDb, 0.5);
});

test('rejects invalid frequency grids/options and reports wholly weak captures', () => {
  for (const hz of [0, -1, NaN, Infinity]) {
    const rows = ideal(); rows[2].hz = hz;
    assert.equal(cutoffCrossing(rows).reason, 'invalid-frequency');
  }
  assert.equal(cutoffCrossing(null).reason, 'invalid-rows');
  assert.equal(cutoffCrossing([null]).reason, 'invalid-row');
  for (const options of [{minAmplitude: -1}, {monotonicToleranceDb: NaN}, {minPoints: 2}])
    assert.equal(cutoffCrossing(ideal(), options).reason, 'invalid-options');
  const weak = ideal().map(row => ({...row, lp: row.lp * 1e-8, hp: row.hp * 1e-8}));
  const result = cutoffCrossing(weak);
  assert.equal(result.reason, 'insufficient-valid-points'); assert.equal(result.excludedPoints.length, weak.length);
});

test('log-ratio arithmetic avoids avoidable overflow without altering amplitude data', () => {
  const rows = [{hz: 1, lp: 1e300, hp: 1e-300, valid: true},
    {hz: 2, lp: 1e200, hp: 1e-200, valid: true}, {hz: 4, lp: 1e-300, hp: 1e300, valid: true}];
  const result = cutoffCrossing(rows, {minAmplitude: 0});
  assert.equal(result.reason, null); assert(Number.isFinite(result.estimatedHz));
  assert(result.points.every(p => Number.isFinite(p.logRatioDb)));
});

function syntheticTraining() {
  const scenes=sid8580CutoffFixtures(),matrix=structuredClone(CUTOFF_MATRIX);
  const fixture={path:'test/helpers/sid8580_cutoff_fixtures.mjs',bytes:1,sha256:'0'.repeat(64)};
  const plan={format:'tetorica-sid8580-cutoff-predeclared-plan',version:1,matrix,fixture,retuningFromHoldout:false,
    training:scenes.map(s=>Object.fromEntries(Object.entries({name:s.name,curveKey:s.curveKey,fc:s.fc,res:s.res,
      rate:s.rate,sustain:s.sustain,volume:s.volume,analysisHz:s.analysisHz,harmonic:s.harmonic,kind:s.kind}).filter(([,v])=>v!==undefined)))};
  const cases=scenes.map(s=>{
    const measured=scale=>{
      const f0=(6.2*s.fc+30)*scale,r=s.analysisHz/f0;
      const lp=.1/Math.hypot(1-r*r,r/.707),amplitude=s.kind==='dry'?.1:s.mode===0x10?lp:lp*r*r;
      return {measurement:{amplitude,clipped:0,halfWindowRelativeAmplitudeChange:0,valid:true}};
    };
    return {...s,candidate:measured(1),reference:measured(1.1),nativeWasm:true,chunked:true};
  });
  const curves=matrix.trainingFc.map(fc=>{
    const group=cases.filter(c=>c.fc===fc&&c.curveKey),lp=group.filter(c=>c.mode===0x10);
    const points=lp.map(l=>{
      const h=group.find(c=>c.mode===0x40&&c.frequencyIndex===l.frequencyIndex);
      const d=cases.find(c=>c.kind==='dry'&&c.dryKey===l.dryKey&&c.harmonic===l.harmonic);
      const p={hz:l.analysisHz,harmonic:l.harmonic,frequencyIndex:l.frequencyIndex};
      for(const engine of ['candidate','reference'])p[engine]={lp:l[engine].measurement.amplitude,hp:h[engine].measurement.amplitude,valid:true,
        lpMagnitude:l[engine].measurement.amplitude/d[engine].measurement.amplitude,hpMagnitude:h[engine].measurement.amplitude/d[engine].measurement.amplitude,
        lpClipped:0,hpClipped:0,dryClipped:0,lpStability:0,hpStability:0,dryStability:0};
      return p;
    });
    return {key:lp[0].curveKey,fc,res:0,rate:48000,sustain:4,volume:12,group:'training',points,
      candidate:cutoffCrossing(points.map(p=>({hz:p.hz,...p.candidate}))),reference:cutoffCrossing(points.map(p=>({hz:p.hz,...p.reference})))};
  });
  return {plan,report:{format:'tetorica-sid8580-cutoff-crossover',version:1,dataset:'training',passed:true,
    productionAdopted:false,clockHz:985248,profiles:{resonance:false,cutoff:false},matrix,
    guards:{minimumAmplitude:8/32768,maximumHalfWindowRelativeAmplitudeChange:.1,clippedSamples:0},
    inputs:{[fixture.path]:{bytes:fixture.bytes,sha256:fixture.sha256}},
    referenceExecutable:{sha256:'1'.repeat(64)},cases,curves,
    checks:{nativeWasmAndChunkCases:cases.length,matchedObservableSetup:true,commonExactSampleTicks:true,
      noPcmGainOrPhaseCorrection:true,validCandidateCrossings:7,validReferenceCrossings:7}}};
}

test('training-only fit reproduces a known analytic frequency scaling and preserves the unmeasured anchor', () => {
  const {report,plan}=syntheticTraining(),fit=deriveCutoffFit(report,plan);
  assert.equal(report.cases.length,189);assert.equal(fit.knots.length,8);assert.deepEqual(fit.knots[0],[0,30]);
  for(const row of fit.training){near(row.scale,1.1);assert(Math.abs(row.coefficientHz-row.originalCoefficientHz*1.1)<=.500001);}
});

test('fit refuses holdout data, pre-enabled profiles and a missing declared endpoint', () => {
  for(const mutate of [({report})=>{report.dataset='holdout';},({report})=>{report.profiles.cutoff=true;},
    ({plan})=>{plan.matrix.trainingFc.pop();},({report})=>{report.curves.pop();}]) {
    const input=syntheticTraining();mutate(input);assert.throws(()=>deriveCutoffFit(input.report,input.plan));
  }
});

test('fit rejects falsified curve data even when its stored crossover is recomputed', () => {
  for(const mutate of [p=>{p.hz*=1.01;},p=>{p.harmonic++;},p=>{p.candidate.lp*=1.01;},p=>{p.candidate.valid=false;}]){
    const {report,plan}=syntheticTraining(),curve=report.curves[1];mutate(curve.points[0]);
    curve.candidate=cutoffCrossing(curve.points.map(p=>({hz:p.hz,...p.candidate})));
    curve.reference=cutoffCrossing(curve.points.map(p=>({hz:p.hz,...p.reference})));
    assert.throws(()=>deriveCutoffFit(report,plan),/Curve/);
  }
});
