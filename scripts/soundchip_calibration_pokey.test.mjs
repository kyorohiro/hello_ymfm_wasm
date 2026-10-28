import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPokeyCalibrationReference,buildPokeyPsgBalanceReference} from './soundchip_calibration_pokey.mjs';
import {measurePokeyCalibrationOffline} from './check_pokey_calibration_offline.mjs';

test('POKEY reference declares a full-volume square and the existing raw/speaker units',()=>{
  const reference=buildPokeyCalibrationReference(),metadata=reference.decodedReference;
  assert.equal(reference.kind,'pokey');assert.equal(reference.waveform,'square');assert.equal(reference.sourceId,'calibration-source');
  assert.equal(reference.warmupSeconds,.2);assert.equal(reference.captureSeconds,1);
  assert.equal(metadata.codecHeadroom,1);assert.equal(metadata.decodedPeak,1);assert.equal(metadata.decodedMean,0);assert.equal(metadata.decodedRms,1);
  assert.deepEqual(metadata.decodedSamples,[-1,1]);assert.equal(metadata.hardwareVolume,15);assert.equal(metadata.distortion,5);
  assert.equal(metadata.channel,1);assert.equal(metadata.helperChannel,0);assert.equal(metadata.highClock,true);assert.equal(metadata.audctl,0x50);assert.equal(metadata.skctl,3);
  assert.equal(metadata.expectedRawMinimum,0);assert.equal(metadata.expectedRawMaximum,11160/32768);assert.equal(metadata.expectedRawDc,11160/65536);
  assert.equal(metadata.speakerDcBlockerHz,10);
  assert.ok(!/mixer|setMasterVolume|gain|Math\.sqrt/.test(reference.setup),'reference cannot silently normalize playback or apply a sine RMS correction');
  assert.match(reference.limitations.join(' '),/not a sine/);
});

test('POKEY primary, two dual instances and additional source have explicit clocks and identities',()=>{
  for(const frequencyHz of [220,440,880])for(const role of ['primary','dual-first','dual-second','extra']){
    const reference=buildPokeyCalibrationReference(frequencyHz,{role}),dual=role.startsWith('dual-');
    assert.deepEqual(reference,buildPokeyCalibrationReference(frequencyHz,{role}));
    assert.equal(reference.sourceId,role==='extra'?'calibration-source':role==='dual-second'?'pokey:2':'pokey');
    assert.equal(reference.mode,dual?'pokey-dual':role==='primary'?'pokey':'genesis');assert.equal(reference.clock,dual?1789773:1789790);
    assert.equal(reference.setup.includes('createSoundChip'),role==='extra');assert.equal(reference.setup.includes('const source=pokey2;'),role==='dual-second');
    assert.equal(reference.period,Math.round(reference.clock/(2*frequencyHz)-7));assert.equal(reference.effectiveFrequencyHz,reference.clock/(2*(reference.period+7)));
    assert.ok(Math.abs(reference.effectiveFrequencyHz/frequencyHz-1)<.0005);
    assert.match(reference.setup,/await source\.initialize\(\)/);assert.match(reference.setup,/await source\.allNotesOff\(\)/);
    assert.match(reference.setup,/await source\.setJoined\(0,true\)/);assert.match(reference.setup,/await source\.setVolume\(1,15\)/);
    assert.match(reference.setup,/await source\.writeRegister\(9,0\)/);assert.match(reference.stop,/await .*keyOff\(1\)/);
  }
  for(const frequencyHz of [0,-1,NaN,Infinity,'440',221])assert.throws(()=>buildPokeyCalibrationReference(frequencyHz),/220, 440 or 880/);
  for(const role of [null,0,'default','POKEY','pokey2'])assert.throws(()=>buildPokeyCalibrationReference(440,{role}),/primary, dual-first, dual-second or extra/);
  assert.throws(()=>buildPokeyCalibrationReference(440,null),TypeError);
});

test('square-family anchor borrows the actual Genesis PSG without installing a gain',()=>{
  const reference=buildPokeyPsgBalanceReference();
  assert.equal(reference.kind,'segapsg');assert.equal(reference.waveform,'square');assert.equal(reference.sourceId,'segapsg');
  assert.equal(reference.role,'primary');assert.equal(reference.mode,'genesis');assert.equal(reference.frequencyHz,440);
  assert.equal(reference.period,254);assert.equal(reference.effectiveFrequencyHz,3579545/(32*254));
  assert.match(reference.setup,/const source=psg;/);assert.match(reference.setup,/await source\.allNotesOff\(\)/);
  assert.match(reference.setup,/tone\(0,\{frequency:440,attenuation:0\}\)/);
  assert.doesNotMatch(reference.setup,/useSoundChip|createSoundChip|mixer|gain|volume/);
  assert.match(reference.stop,/allNotesOff\(\)/);
});

test('self-contained native SDK, independent speaker oracle and actual Worklet prove pure-tone and dual output',async t=>{
  // Deliberately disable the optional application bridge even on a developer
  // machine: this must pass with only files tracked by the main repository.
  const report=await measurePokeyCalibrationOffline({nativeBridgeDirectory:null});
  assert.equal(report.passed,true);assert.equal(report.audioContextCreated,false);assert.equal(report.physicalAudio,false);
  assert.equal(report.routes.length,24);assert.equal(report.dualIsolation.length,2);assert.equal(report.nativeComparisonTolerance,0);assert.equal(report.nativeMaximumDifference,0);
  assert.equal(report.standaloneSdkProof,true);assert.equal(report.speakerOracle.independent,true);assert.equal(report.speakerOracle.maximumDifference,0);
  assert.equal(report.actualNativeBridge.performed,false);assert.equal(report.actualNativeBridge.sampleComparisons,0);assert.deepEqual(report.actualNativeBridge.sources,[]);
  assert.ok(report.sources.every(row=>!row.path.startsWith('w/')),'mandatory native proof has no local application repository dependency');
  assert.ok(report.sources.find(row=>row.path.endsWith('pokey_wasm.wasm'))?.sha256.match(/^[0-9a-f]{64}$/));
  for(const route of report.routes)await t.test(`${route.role}/${route.outputRate}/${route.frequencyHz}`,()=>{
    assert.equal(route.passed,true);assert.equal(route.nativeMaximumDifference,0);assert.ok(route.nativeSampleComparisons>200000);
    assert.equal(route.publicApiAwaited,true);assert.equal(route.keyOffSilence,true);assert.equal(route.workletSpeakerComparedFrames,route.outputRate);
    assert.deepEqual(route.left,route.right);assert.equal(route.left.frames,route.outputRate);assert.equal(route.left.nonfinite,0);
    assert.equal(route.rawLeft.minimum,0);assert.equal(route.rawLeft.maximum,11160/32768);
    assert.ok(route.left.minimum<0&&route.left.maximum>0);assert.ok(Math.abs(route.left.dc)<route.left.amplitude*.005);
    assert.ok(Math.abs(route.left.measuredFrequencyHz-route.effectiveFrequencyHz)<.1);
    assert.ok(Math.abs(route.rawLeft.measuredFrequencyHz-route.effectiveFrequencyHz)<.1);
    assert.ok(Math.abs(route.firstHalfAcRms/route.secondHalfAcRms-1)<.005);
  });
  for(const row of report.dualIsolation){assert.equal(row.passed,true);assert.equal(row.nativeMaximumDifference,0);assert.equal(row.independentPcmContinuation,true);assert.equal(row.otherChipStopResetDispose,true);}
  for(const frequencyHz of [220,440,880])for(const outputRate of [44100,48000]){
    const rows=report.routes.filter(row=>row.frequencyHz===frequencyHz&&row.outputRate===outputRate);
    assert.equal(rows.find(row=>row.role==='primary').left.pcmSha256,rows.find(row=>row.role==='extra').left.pcmSha256,'primary/additional source units match at identical clock');
    assert.equal(rows.find(row=>row.role==='dual-first').left.pcmSha256,rows.find(row=>row.role==='dual-second').left.pcmSha256,'two independent dual instances have identical output when authored identically');
  }
});
