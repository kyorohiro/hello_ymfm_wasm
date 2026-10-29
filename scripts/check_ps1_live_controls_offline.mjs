// Actual shipped WASM and the production Synth/Inspector path. No browser,
// AudioContext, timers, physical audio output, or replacement audio arithmetic.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import factory from '../docs/generated/ps1_spu_wasm.js';
import {Ps1Spu} from '../web/ps1_spu.js';
import {Ps1Synth} from '../web/ps1synth.js';
import {Ps1VoiceInspector} from '../web/playground_ps1_inspector.js';

const args=process.argv.slice(2);assert(args.length===0||args.length===2&&args[0]==='--out','Usage: node scripts/check_ps1_live_controls_offline.mjs [--out REPORT.json]');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const wasmBinary=await readFile(new URL('../docs/generated/ps1_spu_wasm.wasm',import.meta.url));
const module=await factory({wasmBinary}),owned=[];
async function create(sine=false){
  const core=await Ps1Spu.create({moduleFactory:async()=>module});owned.push(core);
  assert.equal(typeof core.api.auditionKey,'function','The deployed WASM really exports smooth audition');
  assert.equal(typeof core.api.refreshEnvelope,'function','The deployed WASM really exports live ADSR refresh');
  const synth=new Ps1Synth({core}),adpcm=new Uint8Array(64);
  for(let block=0;block<4;block++){
    adpcm[block*16+1]=block===3?3:block===0?6:0;
    const nibble=index=>(sine?Math.round(5*Math.sin(2*Math.PI*index/112)):5)&15;
    for(let pair=0;pair<14;pair++){const i=block*28+pair*2;adpcm[block*16+2+pair]=nibble(i)|(nibble(i+1)<<4);}
  }
  const sample=synth.loadADPCM(adpcm,{baseFrequencyHz:44100/112,loopStartSamples:0});
  synth.setPreset(0,{sample,volumeLeft:.5,volumeRight:0,adsr1:15,adsr2:0});
  return {core,synth,inspector:new Ps1VoiceInspector(synth)};
}
const render=(voice,frames)=>voice.core.generateStereo(frames);
function rms(values){return Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);}
function maximumStep(values,previous){let value=0;for(const sample of values){assert(Number.isFinite(sample));value=Math.max(value,Math.abs(sample-previous));previous=sample;}return value;}
function pcmHash(pcm){const bytes=Buffer.alloc(pcm.left.length*8);for(let i=0;i<pcm.left.length;i++){bytes.writeFloatLE(pcm.left[i],i*8);bytes.writeFloatLE(pcm.right[i],i*8+4);}return hash(bytes);}
try{
  const transitions={};
  for(const event of ['release','retrigger']){
    const raw=await create(),manual=await create();
    for(const voice of [raw,manual]){voice.synth.keyOn(0);render(voice,1024);}
    const previous=render(raw,1).left[0];render(manual,1);
    if(event==='release'){raw.synth.keyOff(0);manual.synth._auditionKeyOff(0);}else{raw.synth.keyOn(0);manual.synth._auditionKeyOn(0);}
    const reference=render(raw,512),audition=render(manual,512);
    const rawStep=maximumStep(reference.left,previous),auditionStep=maximumStep(audition.left,previous);
    assert(rawStep>auditionStep*16,event+' is smoothed in the actual deployed WASM');
    transitions[event]={rawMaximumAdjacentStep:rawStep,auditionMaximumAdjacentStep:auditionStep,reductionFactor:rawStep/auditionStep,pcmSha256:pcmHash(audition)};
  }
  const edited=await create(true),deferred=await create(true);
  for(const voice of [edited,deferred]){voice.inspector.invoke('auditionOn',[0,69,'held']);render(voice,2048);}
  const phaseBefore=edited.core.nativeFrames,envelopeBefore=edited.core.read(12);
  edited.inspector.invoke('setEnvelope',[0,{attackRate:61},{live:true}]);
  deferred.inspector.invoke('setEnvelope',[0,{attackRate:61},{live:false}]);
  assert.equal(edited.core.nativeFrames,phaseBefore,'Editing does not render or advance sample time');
  assert.equal(edited.core.read(12),envelopeBefore,'Live attack edit does not reset the current envelope level');
  const attackEdited=render(edited,8192),attackDeferred=render(deferred,8192);
  assert.deepEqual(attackEdited,attackDeferred,'An attack edit during sustain preserves every subsequent PCM sample, including sample phase');
  const sustain={sustainRate:60,sustainDecrease:true,sustainExponential:false};
  edited.inspector.invoke('setEnvelope',[0,sustain,{live:true}]);
  deferred.inspector.invoke('setEnvelope',[0,sustain,{live:false}]);
  assert.equal(edited.core.read(12),0x7fff,'Changing the live slope keeps its starting level');
  const decreasing=render(edited,16384),holding=render(deferred,16384);
  assert.equal(decreasing.left[0],holding.left[0],'The first edited sample retains waveform phase and amplitude');
  const firstRms=rms(decreasing.left.subarray(0,1024)),lastRms=rms(decreasing.left.subarray(-1024));
  assert(lastRms>0&&lastRms<firstRms*.85,'Live SR60 produces an audible gradual decay');
  assert.equal(deferred.core.read(12),0x7fff,'With live disabled, the current sustain remains unchanged');
  assert(edited.core.read(12)>0&&edited.core.read(12)<0x7fff);
  assert.deepEqual(edited.synth.samples,deferred.synth.samples,'ADSR editing retains all sample descriptors');
  const publicEnvelope={};
  for(const method of ['setEnvelope','setPreset','setChannel']){
    const live=await create(true),latched=await create(true);
    for(const voice of [live,latched]){voice.synth.noteOn(0,'A4');render(voice,2048);}
    const before=live.core.nativeFrames,level=live.core.read(12);
    live.synth.setEnvelope(0,{attackRate:61});
    latched.synth.setEnvelope(0,{attackRate:61},{live:false});
    assert.equal(live.core.read(12),level);assert.equal(live.core.nativeFrames,before);
    const attack=render(live,8192),sameAttack=render(latched,8192);
    assert.deepEqual(attack,sameAttack,'Public AR during Sustain preserves phase and level');
    const patch=method==='setEnvelope'?{sustainRate:60,sustainDecrease:true}:{adsr2:0x4000|(60<<6)};
    live.synth[method](0,patch);
    latched.synth[method](0,patch,{live:false});
    // A non-envelope edit and a same-value ADSR write must not flush the deferred slope.
    latched.synth.setPreset(0,{volumeRight:0});
    latched.synth[method](0,patch);
    assert.equal(live.core.nativeFrames,before+8192);
    assert.equal(live.core.read(12),level,'Public setters retain the starting envelope level');
    const pcm=render(live,16384),deferredPcm=render(latched,16384);
    assert.equal(pcm.left[0],deferredPcm.left[0],'Public edit keeps the first sample and phase');
    const first=rms(pcm.left.subarray(0,1024)),last=rms(pcm.left.subarray(-1024));
    assert(last>0&&last<first*.85,'Ordinary public '+method+' applies a live Sustain slope');
    assert.equal(latched.core.read(12),0x7fff,'Explicit deferred, volume-only and unchanged edits stay latched');
    publicEnvelope[method]={firstSustainRms:first,lastSustainRms:last,ratio:last/first,attackDuringSustainPcmBitExact:true,phasePreserved:true,explicitDeferredAndUnrelatedEditsStayLatched:true,pcmSha256:pcmHash(pcm)};
  }
  const oldRelease=await create(true),control=await create(true);
  for(const voice of [oldRelease,control]){voice.inspector.invoke('auditionOn',[0,69,'old']);render(voice,512);voice.inspector.invoke('auditionOn',[0,72,'new']);render(voice,7);}
  assert.equal(oldRelease.inspector.invoke('auditionOff',[0,'old']),false,'A delayed release cannot cancel a replacement note');
  const replacement=render(oldRelease,1024),expectedReplacement=render(control,1024);
  assert.deepEqual(replacement,expectedReplacement,'A stale note ID changes neither the pending restart nor any PCM sample');
  assert(rms(replacement.left)>.01);
  for(const voice of [oldRelease,control])assert.equal(voice.inspector.invoke('auditionOff',[0,'new']),true);
  const released=render(oldRelease,512),expectedReleased=render(control,512);
  assert.deepEqual(released,expectedReleased);assert(released.left.subarray(256).every(value=>value===0));
  const report={schemaVersion:1,passed:true,browserUsed:false,physicalAudio:false,timersUsed:false,core:'actual deployed PS1 SPU WASM',wasmSha256:hash(wasmBinary),transitions,
    liveEnvelope:{attackDuringSustainPcmBitExact:true,comparedStereoFrames:8192,pcmSha256:pcmHash(attackEdited),firstSustainRms:firstRms,lastSustainRms:lastRms,sustainRatio:lastRms/firstRms,liveDisabledDefersSustain:true,initialPcmSampleUnchanged:true,sampleBankUnchanged:true},
    publicEnvelope,
    noteOwnership:{staleReleaseIgnored:true,replacementPcmBitExact:true,comparedStereoFrames:1024,pcmSha256:pcmHash(replacement),finalOwnerReleases:true}};
  if(args.length)await writeFile(resolve(args[1]),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{for(const core of owned)core.dispose();}
