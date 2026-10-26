import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {WonderSwan,WONDERSWAN_CLOCK} from './wonderswan.js';
import {WonderSwanSynth} from './wonderswansynth.js';
import factory from '../docs/generated/wonderswan_wasm.js';
import {WonderSwanVoiceInspector} from './playground_wonderswan_inspector.js';
import {ChipClockResampler,validateChipClock} from './playground_chip_clock.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';

const binary=await readFile(new URL('../docs/generated/wonderswan_wasm.wasm',import.meta.url));
const source=(await readFile(new URL('./playground_wonderswan_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
const peak=values=>values.reduce((result,value)=>Math.max(result,Math.abs(value)),0);
const step=values=>values.reduce((result,value,index)=>index?Math.max(result,Math.abs(value-values[index-1])):result,0);

async function setup({rate=48000,clock=WONDERSWAN_CLOCK}={}){
  let Processor,resolveReady,frame=0;const ready=new Promise(resolve=>resolveReady=resolve),messages=[],port={postMessage:data=>{messages.push(data);if(data.ready||data.error)resolveReady(data);}};
  vm.runInNewContext(source,{WonderSwan,WONDERSWAN_CLOCK,factory,WonderSwanVoiceInspector,ChipClockResampler,validateChipClock,receiveChipInspector,sampleRate:rate,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>frame}),AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(_name,Value)=>Processor=Value});
  const processor=new Processor({processorOptions:{clock,wasmBinary:binary}});assert.equal((await ready).ready,true);
  const raw=await WonderSwan.create({moduleFactory:factory,moduleOptions:{wasmBinary:binary},clock,sampleRate:rate}),registers=new Uint8Array(32);
  const synth=new WonderSwanSynth({clock,transport:{reset(){processor.receive({method:'reset'});raw.reset();registers.fill(0);},writeRegister(address,value,channel,controlMask){processor.receive({method:'writeRegister',args:[address,value],channel,controlMask});if(address===0x90&&controlMask!==undefined)value=(registers[16]&~controlMask)|(value&controlMask);registers[address-0x80]=value;raw.writeRegister(address,value);},writeMemory(address,value,channel){processor.receive({method:'writeMemory',args:[address,value],channel});raw.writeMemory(address,value);}}});
  synth.initialize();
  return {processor,raw,synth,render(frames){const pcm=[new Float32Array(frames),new Float32Array(frames)];processor.process([],[pcm]);frame+=frames;return {speaker:pcm,raw:raw.generateStereo(frames)};},dispose(){processor.dispose();raw.dispose();}};
}

for(const rate of [44100,48000])test(`WonderSwan ${rate}Hz cold wave fetch never turns a constant DAC midpoint into a startup pulse`,async()=>{
  const p=await setup({rate});try{
    for(let ch=0;ch<4;ch++){p.synth.setWaveform(ch,Array(32).fill(8));p.synth.setVolume(ch,10);p.synth.setFrequency(ch,[523.25,329.63,130.81,196][ch]);p.synth.keyOn(ch);}
    const pcm=p.render(256);assert(peak(pcm.raw.left)>.3,'the raw unipolar core must still expose its DAC baseline');assert.equal(peak(pcm.speaker[0]),0,'speaker centering starts only when the core emits a fetched wave sample');assert.equal(peak(pcm.speaker[1]),0);
    p.synth.allNotesOff();assert.equal(peak(p.render(128).speaker[0]),0);
    p.synth.initialize();for(let ch=0;ch<4;ch++){p.synth.setWaveform(ch,Array(32).fill(8));p.synth.keyOn(ch);}assert.equal(peak(p.render(256).speaker[0]),0,'reset reinstates the cold-fetch fence');
  }finally{p.dispose();}
});

test('WonderSwan starter sine onset has no four-channel negative DC pulse, while natural note-off remains immediate',async t=>{
  const p=await setup(),legacy=await setup();try{
    // Reproduce the previous speaker policy over a second real WASM instance.
    // That policy subtracted every enabled voice's mean on the first tick,
    // before the core had emitted its initial fetched wavetable samples.
    legacy.processor.speakerTick=function(){this.speakerLeft=this.targetLeft;this.speakerRight=this.targetRight;};
    const wave=Array.from({length:32},(_,i)=>Math.round(7.5+7.5*Math.sin(2*Math.PI*i/32)));
    for(const fixture of [p,legacy])for(let ch=0;ch<4;ch++){fixture.synth.setWaveform(ch,wave);fixture.synth.setVolume(ch,10);fixture.synth.noteOn(ch,['C5','E4','C3','G3'][ch]);}
    const onset=p.render(32),oldOnset=legacy.render(32);assert.deepEqual(onset.raw.left,oldOnset.raw.left,'raw core PCM is identical');assert.equal(step(oldOnset.speaker[0]),.294189453125);assert.equal(onset.speaker[0][0],0);assert.equal(onset.speaker[0][1],0);assert(step(onset.speaker[0])<.04,'cold onset must not introduce the old 0.294189453125 DC step');assert(onset.speaker[0].every(value=>value>=0),'the starter begins near its sine midpoint, without a fabricated negative pulse');
    t.diagnostic(JSON.stringify({sampleRate:48000,onsetFrames:32,stepBefore:step(oldOnset.speaker[0]),stepAfter:step(onset.speaker[0]),rawPcmDifference:0}));
    // Once every wave has been fetched, centering keeps precisely the existing
    // mean subtraction and original gain. No envelope/fade changes the note.
    const steady=p.render(4096),offset=4*10*wave.reduce((sum,value)=>sum+value,0)/32/1024;
    for(let i=0;i<steady.speaker[0].length;i++)assert.equal(steady.speaker[0][i],steady.raw.left[i]-offset);
    p.synth.allNotesOff();assert.equal(peak(p.render(128).speaker[0]),0,'hard key-off is preserved rather than hidden by a release fade');
  }finally{p.dispose();legacy.dispose();}
});

test('WonderSwan a fetch fence survives short blocks, paused gates and direct PCM mode without changing raw timing',async()=>{
  const a=await setup(),b=await setup();try{
    for(const p of [a,b]){p.synth.setWaveform(0,Array(32).fill(11));p.synth.setFrequency(0,60);p.synth.keyOn(0);}
    const whole=a.render(80),parts=[];for(const frames of [1,2,3,7,11,23,33])parts.push(...b.render(frames).speaker[0]);assert.deepEqual(Float32Array.from(parts),whole.speaker[0]);assert.equal(peak(whole.speaker[0]),0);
    a.synth.initialize();a.synth.setWaveform(1,Array(32).fill(8));a.synth.setFrequency(1,60);a.synth.setVoiceMode(true);a.synth.writeVoice(128);a.synth.keyOn(1);const pcm=a.render(64);assert.equal(peak(pcm.speaker[0]),.5/1024,'PCM centers immediately, without waiting for a wavetable fetch');assert.equal(a.processor.waveReady[1],0,'direct PCM never advances the wave position');
    a.synth.setVoiceMode(false);const switched=a.render(256).speaker[0];assert(peak(switched)<=.5/1024,'the old held PCM sample may remain only until the next native tick');assert.equal(peak(switched.subarray(2)),0,'switching from PCM to a cold constant waveform introduces no pulse');
    a.synth.initialize();a.synth.setWaveform(0,Array(32).fill(11));a.synth.setFrequency(0,60);a.synth.keyOn(0);a.render(8);a.synth.keyOff(0);a.render(64);a.synth.keyOn(0);assert.equal(peak(a.render(8).speaker[0]),0);assert.equal(a.processor.waveReady[0],0,'disabled gates pause the cold wave counter');assert.equal(peak(a.render(128).speaker[0]),0);assert.equal(a.processor.waveReady[0],1);
  }finally{a.dispose();b.dispose();}
});
