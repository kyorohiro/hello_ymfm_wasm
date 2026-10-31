import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';import {Scsp} from '../js/scsp.js';import {ScspSynth} from '../js/scspsynth.js';
import {DspDelay,reserveDspRam,DSP_RAM_BYTES} from './dsp.js';import {SynthInstrument} from './instrument.js';
let module;async function core(t){module??=factory({wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))});const c=await Scsp.create({moduleFactory:()=>module});t.after(()=>c.dispose());return c;}
const peak=values=>values.reduce((p,v)=>Math.max(p,Math.abs(v)),0);
async function impulse(t,feedback){const c=await core(t),s=new ScspSynth(c);reserveDspRam(s);const effect=new DspDelay(c,{enabled:true,timeMs:20,feedback,send:7,returnLevel:7});const pcm=new Int16Array(64);pcm[1]=4096;const wave=s.loadPCM(pcm,{baseFrequencyHz:44100/64});s.setPreset(6,{sample:wave,directLevel:0});s.keyOn(6);effect.route([6]);return {c,s,effect};}
test('actual SCSP DSP impulse: silence before 20ms, one echo at zero feedback, six repeats decay by half',async t=>{
 const single=await impulse(t,0),out=single.s.generateStereo(882*7).left;
 assert(out.slice(0,882).every(x=>x===0));assert(peak(out.slice(882,1764))>.001);assert(out.slice(1764).every(x=>x===0));
 const loop=await impulse(t,.5),echoes=loop.s.generateStereo(882*7).left;
 for(let n=1;n<=6;n++){const p=peak(echoes.slice(882*n,882*(n+1)));assert(p>0);if(n>1){const prev=peak(echoes.slice(882*(n-1),882*n));assert(Math.abs(p/prev-.5)<.01);}}
});
test('DSP packed silence has no DC, ring writes stay inside reservation, time changes and bypass clear tail',async t=>{
 const {c,s,effect}=await impulse(t,.7),pcmBefore=c.readRam(DSP_RAM_BYTES,256);
 s.generateStereo(100000);assert.deepEqual(c.readRam(DSP_RAM_BYTES,256),pcmBefore);
 effect.configure({timeMs:30});assert(s.generateStereo(44100).left.every(x=>x===0));
 effect.configure({enabled:false});effect.route([6]);assert(s.generateStereo(256).left.every(x=>x===0));
 const fresh=await core(t),d=new DspDelay(fresh,{enabled:true,timeMs:20,feedback:.85,send:7,returnLevel:7});fresh.write(0x400,0x020f);const left=new Float32Array(44100),right=left.slice();fresh.renderInto(left,right);assert(left.every(x=>x===0)&&right.every(x=>x===0));assert.equal(d.settings.enabled,true);
});
test('Synth routes only output operators, preserves live voice identity, and Stop clears DSP completely',async t=>{
 const c=await core(t),i=new SynthInstrument(c);i.setConfig({mode:'fm6',fm:{algorithm:'pairs'}});i.noteOn('held',69);const before=i.read();i.setEffect({enabled:true,timeMs:20,feedback:.5,send:7,returnLevel:7});
 const state=i.read();assert.deepEqual(state.voiceGroups,before.voiceGroups);for(const slot of [7,9,11])assert.equal(c.read(slot*32+20),7);for(const slot of [6,8,10])assert.equal(c.read(slot*32+20),0);
 i.invoke('setMix',[0,{totalLevel:24}]);assert.equal(c.read(22)&0xff,7<<5);assert(i.synth.generateStereo(8192).left.some(x=>x!==0));
 assert.equal(state.dspRamBytes,65536);assert(state.samples.every(s=>s.address>=65536));
 const saved=i.read();for(const patch of [{timeMs:19},{feedback:1},{returnLevel:8},{enabled:1},{other:true},null]){assert.throws(()=>i.setEffect(patch));assert.deepEqual(i.read(),saved);}
 i.stopVoices();assert(i.synth.generateStereo(44100).left.every(x=>x===0));assert.equal(i.read().config.effect.enabled,true);
});
test('DSP v4 preset restores exact audio, old v3 bypasses DSP, invalid effect is atomic',async t=>{
 const a=new SynthInstrument(await core(t)),b=new SynthInstrument(await core(t));a.setEffect({enabled:true,timeMs:20,feedback:.5,send:7,returnLevel:6});const patch=a.exportPatch();assert.equal(patch.version,4);b.loadPatch(JSON.parse(JSON.stringify(patch)));
 for(const i of [a,b])i.noteOn('held',69);assert.deepEqual(a.synth.generateStereo(16384),b.synth.generateStereo(16384));
 const before=b.read(),invalid=structuredClone(patch);invalid.effect.feedback=1;assert.throws(()=>b.loadPatch(invalid));assert.deepEqual(b.read(),before);
 b.loadPatch({...patch,version:3});assert.equal(b.read().config.effect.enabled,false);
});
