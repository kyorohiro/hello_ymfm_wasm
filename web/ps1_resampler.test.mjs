import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ps1Resampler} from './ps1_resampler.js';
import {Ps1Spu} from './ps1_spu.js';
import {Ps1Synth,createPs1InitSample} from './ps1synth.js';
function source(){let position=0,silent=false;return {sampleRate:44100,get nativeFrames(){return position;},set silent(value){silent=value;},renderInto(left,right,count,offset=0){for(let at=0;at<count;at++){const value=silent?0:Math.sin(2*Math.PI*440*(position++)/44100);left[offset+at]=value;right[offset+at]=-value;}if(silent)position+=count;},reset(){position=0;}};}
function output(resampler,frames,parts){const left=new Float32Array(frames),right=new Float32Array(frames);let at=0,index=0;while(at<frames){const n=Math.min(parts[index++%parts.length],frames-at);resampler.render(left,right,n,at);at+=n;}return {left,right};}
function frequency(values,rate){let edges=0,first=-1,last=-1;for(let i=1;i<values.length;i++)if(values[i-1]<=0&&values[i]>0){if(first<0)first=i;last=i;edges++;}return (edges-1)*rate/(last-first);}

test('PS1 host resampling preserves phase across irregular partitions at 44100, 48000 and 96000 Hz',()=>{
  for(const rate of [44100,48000,96000])for(const sourceFrames of [1,128]) {
    const a=new Ps1Resampler(source(),rate,{sourceFrames}),b=new Ps1Resampler(source(),rate,{sourceFrames});
    assert.deepEqual(output(a,12001,[12001]),output(b,12001,[1,127,53,1024]));
    assert.equal(a.playbackNativeFrames,12001*44100/rate);assert.equal(a.renderedNativeFrames,b.renderedNativeFrames);
    assert.ok(Math.abs(frequency(output(a,rate/4,[128]).left,rate)-440)<0.2);
  }
});

test('PS1 source-rate output has no render-ahead; conversion holds only bounded endpoint frames',()=>{
  for(const rate of [44100,48000,96000]) {
    const core=source(),resampler=new Ps1Resampler(core,rate),left=resampler.left,right=resampler.right;
    resampler.render(new Float32Array(128),new Float32Array(128));
    const expected=128*44100/rate;
    if(rate===44100)assert.equal(core.nativeFrames,128);else assert.ok(core.nativeFrames>=Math.floor(expected)&&core.nativeFrames<=Math.floor(expected)+2);
    assert.equal(resampler.left,left);assert.equal(resampler.right,right);
    core.silent=true;core.reset();resampler.reset();const audio=output(resampler,1024,[1,127]);assert.ok(audio.left.every(x=>x===0));assert.ok(audio.right.every(x=>x===0));
  }
});

test('PS1 demand batches avoid per-native-frame calls without adding render-ahead',()=>{
  for(const rate of [44100,48000,96000]) {
    const core=source(),render=core.renderInto.bind(core),calls=[];
    core.renderInto=(...args)=>{calls.push(args[2]);render(...args);};
    const resampler=new Ps1Resampler(core,rate),left=new Float32Array(128),right=new Float32Array(128);
    for(let quantum=0;quantum<100;quantum++)resampler.render(left,right);
    assert.equal(calls.length,100,'one source call per 128-frame host quantum');
    assert.ok(calls.every(count=>count>0&&count<=128));
    const consumed=12800*44100/rate;
    assert.ok(core.nativeFrames>=Math.floor(consumed)&&core.nativeFrames<=Math.floor(consumed)+2);
  }
});

test('PS1 resampler validates complete destination ranges before advancing its source',()=>{
  const core=source(),resampler=new Ps1Resampler(core,48000),a=new Float32Array(32);a.fill(8);
  for(const run of [()=>resampler.render(a,a),()=>resampler.render(a,new Float32Array(31),32),()=>resampler.render(a,new Float32Array(32),1,-1),()=>resampler.render(a,new Float32Array(32),NaN),()=>resampler.render([],[])])assert.throws(run);
  assert.equal(core.nativeFrames,0);assert.ok(a.every(x=>x===8));
  resampler.render(a,a,0);assert.equal(core.nativeFrames,0);
  const shared=new Float32Array(64);resampler.render(shared.subarray(0,32),shared.subarray(32),32);assert.ok(core.nativeFrames>0);
  assert.throws(()=>new Ps1Resampler(core,0));assert.throws(()=>new Ps1Resampler(core,48000,{sourceFrames:0}));assert.throws(()=>new Ps1Resampler({...core,sampleRate:32000},48000));
});

let sharedModule;
async function synth(t) {
  sharedModule??=Promise.all([import('../docs/generated/ps1_spu_wasm.js'),readFile(new URL('../docs/generated/ps1_spu_wasm.wasm',import.meta.url))]).then(([{default:factory},wasmBinary])=>factory({wasmBinary}));
  const core=await Ps1Spu.create({moduleFactory:()=>sharedModule}),instrument=new Ps1Synth({core});t.after(()=>instrument.dispose());
  const {adpcm,...options}=createPs1InitSample(),sample=instrument.loadADPCM(adpcm,options);instrument.setPreset(0,{sample});instrument.noteOn(0,'A4');return instrument;
}
test('real WASM SPU instrument keeps A4 tuning and exact partitioned PCM at all three host rates',async t=>{
  for(const rate of [44100,48000,96000]) {
    const a=await synth(t),b=await synth(t),ra=new Ps1Resampler(a,rate),rb=new Ps1Resampler(b,rate),count=Math.floor(rate/4);
    const audio=output(ra,count,[count]);assert.deepEqual(audio,output(rb,count,[1,53,128,1024]));
    assert.ok(Math.abs(frequency(audio.left.subarray(1024),rate)-440)<0.2);
    a.stopVoices();ra.reset();assert.ok(output(ra,1024,[128]).left.every(value=>value===0),'Stop discards held interpolation and native output');
  }
});
