import assert from 'node:assert/strict';
import test from 'node:test';
import {createPs1InitSample,preparePs1ADPCM} from '../web/ps1synth.js';
import {buildPs1CalibrationReference} from './soundchip_calibration_ps1.mjs';
import {measurePs1CalibrationOffline} from './check_ps1_calibration_offline.mjs';

test('PS1 reference has explicit decoded headroom, loop, tuning and no Mixer edits',()=>{
  const reference=buildPs1CalibrationReference(),metadata=reference.decodedReference;
  assert.equal(reference.kind,'ps1');assert.equal(reference.waveform,'sine');assert.equal(reference.sourceId,'calibration-source');
  assert.equal(reference.warmupSeconds,.2);assert.equal(reference.captureSeconds,1);
  assert.equal(metadata.codecHeadroom,.875);assert.equal(metadata.decodedPeak,.875);assert.equal(metadata.decodedMean,0);
  assert.equal(metadata.decodedSamples.length,112);assert.equal(metadata.adpcmBytes.length,64);
  const prepared=preparePs1ADPCM(new Uint8Array(metadata.adpcmBytes),{baseFrequencyHz:44100/112,loopStartSamples:0});
  assert.equal(prepared.loop,true);assert.equal(prepared.decodedFrames,112);assert.equal(prepared.loopStartSamples,0);
  assert.equal(Math.max(...metadata.decodedSamples),.875);assert.equal(Math.min(...metadata.decodedSamples),-.875);
  assert.ok(metadata.decodedRms>.6&&metadata.decodedRms<.65);
  assert.equal(metadata.decodedSamples[0],metadata.decodedSamples.at(-1),'the quantized loop closes at zero');
  assert.ok(metadata.decodedSamples.every((value,index)=>Math.abs(value-Math.sin(2*Math.PI*index/112)*.875)<=1/16),'decode is a quantized original sine');
  assert.ok(!/mixer|setVolume|masterVolume/.test(reference.setup),'source setup must not silently install a Mixer correction');
  // The authored starter intentionally has a smaller codec input. Calibrating
  // it as a full-scale waveform would inflate every musical sample sixteenfold.
  const starter=createPs1InitSample();
  assert.equal(starter.adpcm[0],4);assert.equal(metadata.adpcmBytes[0],0);
  assert.deepEqual([...starter.adpcm].filter((_,i)=>i%16!==0),metadata.adpcmBytes.filter((_,i)=>i%16!==0));
});

test('PS1 reference roles and supported pitches are explicit and deterministic',()=>{
  for(const frequencyHz of [220,440,880])for(const role of ['primary','extra']){
    const reference=buildPs1CalibrationReference(frequencyHz,{role});
    assert.deepEqual(reference,buildPs1CalibrationReference(frequencyHz,{role}));
    assert.equal(reference.frequencyHz,frequencyHz);assert.equal(reference.role,role);
    assert.equal(reference.sourceId,role==='primary'?'ps1':'calibration-source');
    assert.equal(reference.setup.includes('createSoundChip'),role==='extra');
    assert.equal(reference.setup.includes("useSoundChip('ps1')"),role==='primary');
    assert.ok(Math.abs(reference.effectiveFrequencyHz-frequencyHz)/frequencyHz<.0003);
  }
  for(const frequencyHz of [0,-1,NaN,Infinity,'440',221])assert.throws(()=>buildPs1CalibrationReference(frequencyHz),/220, 440 or 880/);
  for(const role of [null,0,'default','PS1'])assert.throws(()=>buildPs1CalibrationReference(440,{role}),/primary or extra/);
  assert.throws(()=>buildPs1CalibrationReference(440,null),TypeError);
});

test('real native decoder and shipped WASM prove held unit output, stereo, tuning and release',async t=>{
  const report=await measurePs1CalibrationOffline();
  assert.equal(report.passed,true);assert.equal(report.audioContextCreated,false);assert.equal(report.physicalAudio,false);
  assert.equal(report.routes.length,12);assert.equal(report.nativeComparisonTolerance,0);
  assert.ok(report.sources.find(row=>row.path.endsWith('ps1_spu_wasm.wasm'))?.sha256.match(/^[0-9a-f]{64}$/));
  for(const route of report.routes)await t.test(`${route.role}/${route.outputRate}/${route.frequencyHz}`,()=>{
    assert.equal(route.passed,true);assert.equal(route.nativeMaximumDifference,0);assert.ok(route.nativeSampleComparisons>100000);
    assert.equal(route.publicApiAwaited,true);assert.equal(route.keyOffSilence,true);assert.deepEqual(route.master,[0x3fff,0x3fff]);
    assert.equal(route.envelope,0x7fff);assert.deepEqual(route.left,route.right,'both output sides have the same PCM and metrics');
    const pcm=route.left;
    assert.equal(pcm.frames,route.outputRate);assert.equal(pcm.nonfinite,0);
    assert.ok(pcm.amplitude>.8&&pcm.amplitude<.9,`decoded .875 reference must not be the quiet starter: ${pcm.amplitude}`);
    assert.ok(Math.abs(pcm.dc)<.003,`DC ${pcm.dc}`);
    assert.ok(pcm.acRms>.58&&pcm.acRms<.65,`RMS ${pcm.acRms}`);
    assert.ok(Math.abs(pcm.measuredFrequencyHz-route.effectiveFrequencyHz)<.3,`actual pitch ${pcm.measuredFrequencyHz}`);
    assert.ok(Math.abs(route.firstHalfAcRms/route.secondHalfAcRms-1)<.005,'held envelope must not decay during capture');
    // At880Hz one output frame advances more than two source samples. Bound
    // the jump by the maximum decoded nibble step times that advancement;
    // an arbitrary low fixed bound would reject legitimate high notes.
    assert.ok(pcm.maximumAdjacentJump<=.125*Math.ceil(route.pitch/4096)+.0001,'loop must not insert a jump beyond decoded source steps');
  });
  for(const frequencyHz of [220,440,880])for(const outputRate of [44100,48000]){
    const routes=report.routes.filter(route=>route.frequencyHz===frequencyHz&&route.outputRate===outputRate);
    assert.equal(routes[0].left.pcmSha256,routes[1].left.pcmSha256,'primary and additional SPU share exactly the same output unit');
  }
});
