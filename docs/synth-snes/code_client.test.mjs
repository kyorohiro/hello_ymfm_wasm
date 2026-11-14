import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/spc_wasm.js';
import {SnesDspCore} from '../js/spc.js';
import {SnesInstrument} from './instrument.js';
import {encodeBrr} from '../js/snes_brr_encoder.js';
import {encodeBase64} from './sample.js';
import {createDefaultPreset} from './preset.js';
import {createSnesCodeClient} from './code_client.js';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {SNES_STARTER_CODE} from './code_host.js';
const wasmBinary=await readFile(new URL('../generated/spc_wasm.wasm',import.meta.url));
async function setup(t){const core=await SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary}}),instrument=new SnesInstrument(core);t.after(()=>instrument.dispose());return instrument;}
const render=instrument=>{const left=new Float32Array(4096),right=new Float32Array(4096);instrument.renderInto(left,right);assert(left.every(Number.isFinite));return Math.max(...left.map(Math.abs));};
const client=instrument=>createSnesCodeClient({command:async(method,args=[])=>instrument[method](...args)});

test('Code shares real BRR/Noise/PMON/Echo and leaves manual owners and the authored preset intact',async t=>{
  const instrument=await setup(t);
  for(const kind of ['wave','brr','noise','pmon','pmon-brr']){
    const preset=createDefaultPreset();preset.echo.enabled=true;if(kind==='noise')preset.source='noise';if(kind.startsWith('pmon'))preset.pmon.enabled=true;
    if(kind==='brr'||kind==='pmon-brr'){const data=encodeBase64(encodeBrr(Float32Array.from(preset.wave),{loopStartSamples:0}).brr);preset.source='brr';preset.brr={name:'sample',data,rootNote:60,basePitch:4096,loopStartSamples:0};if(kind==='pmon-brr'){preset.pmon.source='brr';preset.pmon.brr={...preset.brr};}}
    instrument.loadPreset(preset);instrument.noteOn('manual',60);const code=client(instrument);
    await code.noteOn(0,'E4');assert.equal(instrument.read().voices.length,2);assert(render(instrument)>.0001);
    const state=await code.getState();assert.equal(state.capacity,kind.startsWith('pmon')?4:8);assert.equal(state.echo.enabled,true);
    await code.dispose();assert.deepEqual(instrument.read().voices.map(v=>v.id),['manual']);assert.deepEqual(instrument.read().preset,preset);
    assert.throws(()=>code.noteOn(0,'C4'),{name:'AbortError'});instrument.stop();
  }
});
test('eight logical lanes steal safely across clients and reject malformed notes before hardware writes',async t=>{
  const instrument=await setup(t),a=client(instrument),b=client(instrument);
  for(let i=0;i<8;i++)await a.noteOn(i,60+i);
  const replacement=await b.noteOn(0,72);assert(replacement.stolenId);const newOwner=instrument.read().voices.find(v=>v.midi===72);
  await a.noteOff(0);assert(instrument.read().voices.some(v=>v.id===newOwner.id));
  const before=instrument.read();for(const bad of [-1,8,1.5])assert.throws(()=>b.noteOn(bad,60),/lane/);
  for(const bad of [-1,128,60.2,'bad',true])assert.throws(()=>b.noteOn(0,bad));assert.deepEqual(instrument.read(),before);
  await a.dispose();assert.deepEqual(instrument.read().voices.map(v=>v.id),[newOwner.id]);await b.dispose();
});
test('Stop during an in-flight KON acknowledgement releases that note and rejects pending old calls',async()=>{
  let resolve;const gate=new Promise(r=>resolve=r),events=[];
  const code=createSnesCodeClient({command:async(method,args)=>{events.push([method,...args]);if(method==='noteOn')await gate;return {};}});
  const on=code.noteOn(0,'C4');await Promise.resolve();const later=code.noteOn(1,'D4');const off=code.dispose();
  resolve();await assert.rejects(on,{name:'AbortError'});await assert.rejects(later,{name:'AbortError'});await off;
  assert.deepEqual(events.map(e=>e[0]),['noteOn','noteOff']);assert.equal(events[0][1],events[1][1]);
});
test('starter executes on real WASM and named-loop cancellation releases its lanes without manual key loss',async t=>{
  const instrument=await setup(t);let code=null;instrument.noteOn('manual',55);
  const runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>performance.now()/1000,supportedSoundChips:['snes'],useSoundChip:()=>code??=client(instrument),stopSoundChips:async()=>{await code?.dispose();code=null;},guardExecution:false});
  t.after(()=>runtime.stop());await runtime.run(SNES_STARTER_CODE);
  for(let i=0;i<20&&instrument.read().voices.length===1;i++)await new Promise(r=>setTimeout(r,5));
  assert(instrument.read().voices.length>1);assert(render(instrument)>0);
  await runtime.apply('stopLoop("melody");');
  assert.deepEqual(instrument.read().voices.map(v=>v.id),['manual']);await runtime.stop();assert.equal(instrument.read().voices[0].id,'manual');
});
