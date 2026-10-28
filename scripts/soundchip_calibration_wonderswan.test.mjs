import assert from 'node:assert/strict';
import test from 'node:test';
import {buildWonderSwanCalibrationReference} from './soundchip_calibration_wonderswan.mjs';
import {measureWonderSwanCalibrationOffline} from './check_wonderswan_calibration_offline.mjs';

test('WonderSwan reference is a full-range original sine with exact unsigned midpoint',()=>{
  const reference=buildWonderSwanCalibrationReference(),metadata=reference.decodedReference;
  assert.equal(reference.kind,'wonderswan');assert.equal(reference.waveform,'sine');assert.equal(reference.sourceId,'calibration-source');
  assert.equal(reference.warmupSeconds,.2);assert.equal(reference.captureSeconds,1);
  assert.equal(metadata.codecHeadroom,1);assert.equal(metadata.decodedPeak,1);assert.ok(Math.abs(metadata.decodedMean)<1e-15);
  assert.equal(metadata.samples,32);assert.equal(metadata.waveSamples.length,32);assert.equal(metadata.packedBytes.length,16);
  assert.equal(Math.max(...metadata.waveSamples),15);assert.equal(Math.min(...metadata.waveSamples),0);
  assert.equal(metadata.waveSamples.reduce((sum,value)=>sum+value,0)/32,7.5);
  for(let index=0;index<16;index++)assert.equal(metadata.waveSamples[index]+metadata.waveSamples[index+16],15,'opposite samples have exact half-wave symmetry');
  assert.deepEqual(metadata.packedBytes.flatMap(value=>[value&15,value>>4]),metadata.waveSamples,'low nibble is the earlier sample');
  assert.ok(metadata.decodedRms>.69&&metadata.decodedRms<.75);
  assert.ok(metadata.decodedSamples.every((value,index)=>Math.abs(value-Math.sin(2*Math.PI*index/32))<=1/15+1e-15),'reference preserves sine within half a quantization code');
  assert.equal(metadata.expectedRawDc,112.5/1024);assert.equal(metadata.expectedSpeakerAmplitude,112.5/1024);
  assert.ok(!/mixer|setMasterVolume|setReverb|gain/.test(reference.setup),'reference authoring cannot silently normalize playback');
});

test('WonderSwan roles and quantized frequencies are explicit and reproducible',()=>{
  for(const frequencyHz of [220,440,880])for(const role of ['primary','extra']){
    const reference=buildWonderSwanCalibrationReference(frequencyHz,{role});
    assert.deepEqual(reference,buildWonderSwanCalibrationReference(frequencyHz,{role}));
    assert.equal(reference.frequencyHz,frequencyHz);assert.equal(reference.role,role);
    assert.equal(reference.sourceId,role==='primary'?'wonderswan':'calibration-source');
    assert.equal(reference.setup.includes('createSoundChip'),role==='extra');
    assert.equal(reference.setup.includes("useSoundChip('wonderswan')"),role==='primary');
    assert.equal(reference.effectiveFrequencyHz,96000/Math.round(96000/frequencyHz));
    assert.ok(Math.abs(reference.effectiveFrequencyHz-frequencyHz)/frequencyHz<.005);
    assert.match(reference.setup,/await source\.allNotesOff\(\)/);assert.match(reference.stop,/await .*keyOff\(0\)/);
  }
  for(const frequencyHz of [0,-1,NaN,Infinity,'440',221])assert.throws(()=>buildWonderSwanCalibrationReference(frequencyHz),/220, 440 or 880/);
  for(const role of [null,0,'default','WonderSwan'])assert.throws(()=>buildWonderSwanCalibrationReference(440,{role}),/primary or extra/);
  assert.throws(()=>buildWonderSwanCalibrationReference(440,null),TypeError);
});

test('actual native core, shipped WASM and unchanged speaker Worklet establish reference units',async t=>{
  const report=await measureWonderSwanCalibrationOffline();
  assert.equal(report.passed,true);assert.equal(report.audioContextCreated,false);assert.equal(report.physicalAudio,false);
  assert.equal(report.routes.length,12);assert.equal(report.nativeComparisonTolerance,0);assert.equal(report.nativeMaximumDifference,0);
  assert.ok(report.sources.find(row=>row.path.endsWith('wonderswan_wasm.wasm'))?.sha256.match(/^[0-9a-f]{64}$/));
  for(const route of report.routes)await t.test(`${route.role}/${route.outputRate}/${route.frequencyHz}`,()=>{
    assert.equal(route.passed,true);assert.equal(route.nativeMaximumDifference,0);assert.ok(route.nativeSampleComparisons>100000);
    assert.equal(route.publicApiAwaited,true);assert.equal(route.keyOffSilence,true);assert.equal(route.workletSpeakerComparedFrames,route.outputRate);
    assert.deepEqual(route.left,route.right,'both sides have identical PCM and metrics');
    const pcm=route.left;
    assert.equal(pcm.frames,route.outputRate);assert.equal(pcm.nonfinite,0);assert.equal(pcm.amplitude,112.5/1024);
    assert.equal(pcm.minimum,-112.5/1024);assert.equal(pcm.maximum,112.5/1024);
    assert.equal(route.rawLeft.minimum,0);assert.equal(route.rawLeft.maximum,225/1024);
    assert.ok(Math.abs(pcm.dc)<pcm.amplitude*.01,`DC ${pcm.dc}`);
    assert.ok(Math.abs(pcm.acRms/pcm.amplitude-report.decodedReference.decodedRms)<.02);
    assert.ok(Math.abs(pcm.measuredFrequencyHz-route.effectiveFrequencyHz)<.3,`actual pitch ${pcm.measuredFrequencyHz}`);
    assert.ok(Math.abs(route.firstHalfAcRms/route.secondHalfAcRms-1)<.005,'held reference does not decay');
    assert.ok(pcm.maximumAdjacentJump<=3*15/1024,'the loop has no jump beyond valid quantized sine steps');
  });
  for(const frequencyHz of [220,440,880])for(const outputRate of [44100,48000]){
    const routes=report.routes.filter(route=>route.frequencyHz===frequencyHz&&route.outputRate===outputRate);
    assert.equal(routes[0].left.pcmSha256,routes[1].left.pcmSha256,'primary and extra use the same source output unit');
  }
});
