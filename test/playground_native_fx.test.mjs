import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createNativeFXController,FX_TYPES,FX_PARAMS} from '../web/native_fx.js';
import {setChain} from '../web/native_fx_graph.js';
const module=await WebAssembly.compile(readFileSync(new URL('../web/native_audio_effect.wasm',import.meta.url)));
function harness(){
 let Processor;const errors=[];
 const scope={WebAssembly,Float32Array,Map,Math,Number,Error,sampleRate:48000,setChain,FX_TYPES,
  AudioWorkletProcessor:class{constructor(){this.port={postMessage:d=>errors.push(d)};}},registerProcessor:(name,p)=>Processor=p};
 vm.runInNewContext(readFileSync(new URL('../web/native-fx-worklet.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export class','class'),scope);
 const p=new Processor({processorOptions:{module}});
 const messages=[];let beat=.5;
 const fx=createNativeFXController(d=>{messages.push(d);p.command(structuredClone(d));},{getBeatSeconds:()=>beat});
 function render(blocks=1,value=.1){let out;for(let i=0;i<blocks;i++){out=[new Float32Array(128),new Float32Array(128)];p.process([[new Float32Array(128).fill(value)]],[out]);}return out[0];}
 return {p,fx,messages,errors,render,setBeat:v=>beat=v};
}
test('native Playground runs every supported effect, removes unsupported constructors',()=>{
 const h=harness();for(const type of Object.keys(FX_TYPES)){const u=h.fx[type]();h.fx.setChain([u]);assert.ok(h.render(30).every(Number.isFinite));h.fx.clear();u.dispose();}
 for(const name of ['lofi','radioTone','tapeSaturation','stereoWidth'])assert.equal(h.fx[name],undefined);
 assert.deepEqual(h.errors,[]);
});
test('parallel sums in WASM; ramps progress on audio thread and stop clears reverb tails',()=>{
 const h=harness();const a=h.fx.gain({gain:.25}),b=h.fx.gain({gain:.5});
 h.fx.setChain([h.fx.parallel(h.fx.branch(a),h.fx.branch(b))]);assert.ok(Math.abs(h.render(30)[100]-.075)<1e-5);
 a.gain.rampTo(.5,.2);h.render(80);assert.ok(Math.abs(h.render()[100]-.1)<1e-5);
 const r=h.fx.reverb({mix:1});h.fx.setChain([r]);h.render(100,1);
 h.fx.clear();assert.ok(h.render(100,0).every(x=>x===0));h.fx.setChain([r]);assert.ok(h.render(100,0).every(x=>x===0));
});
test('descriptor validation is atomic; disposed and foreign nodes rejected, slot reused safely',()=>{
 const h=harness();const a=h.fx.gain();h.fx.setChain([a]);
 assert.throws(()=>h.fx.setChain([a,a]),/reused/);assert.throws(()=>h.fx.setChain([h.fx.parallel()]),/Empty/);
 assert.throws(()=>h.fx.setChain([createNativeFXController(()=>{}).gain()]),/another/);
 assert.throws(()=>a.dispose(),/Detach/);h.fx.clear();a.dispose();assert.throws(()=>a.gain.set(1),/disposed/);
 const next=h.fx.gain();assert.equal(next.slot,0);
});
test('parameter endpoints accepted by native setters; tempo changes modulator Hz',()=>{
 const h=harness();for(const [type,params]of Object.entries(FX_PARAMS)){
  const u=h.fx[type]();for(const [key,[,lo,hi]]of Object.entries(params)){u[key].set(lo);u[key].set(hi);}h.fx.setChain([u]);assert.ok(h.render().every(Number.isFinite));h.fx.clear();u.dispose();
 }
 const wobble=h.fx.wobble();h.fx.setChain([wobble]);h.setBeat(1);h.fx.syncTempo();assert.equal(h.p.beatSeconds,1);
});
test('Worker port owns FX; returning to main closes it, discards tails and resets slots',()=>{
 const h=harness();let closed=false;const port={start(){},close(){closed=true;}};
 h.p.port.onmessage({data:{op:'attach',port}});
 const worker=createNativeFXController(d=>port.onmessage({data:structuredClone(d)}));
 const gain=worker.gain({gain:.5});worker.setChain([gain]);assert.ok(Math.abs(h.render(30)[0]-.05)<1e-5);
 h.p.port.onmessage({data:{op:'parameter',unit:{type:'gain',slot:0},key:'gain',value:0,seconds:0}});
 assert.ok(Math.abs(h.render(30)[0]-.05)<1e-5);
 h.p.port.onmessage({data:{op:'main'}});assert.equal(closed,true);assert.ok(Math.abs(h.render()[0]-.1)<1e-5);
 port.onmessage({data:{op:'chain',children:[{type:'gain',slot:0}],units:[{type:'gain',slot:0,values:{gain:0}}]}});
 assert.ok(Math.abs(h.render(30)[0]-.1)<1e-5);
});
test('packaged DSP and source DSP are identical',()=>{
 const bytes=readFileSync(new URL('../web/native_audio_effect.wasm',import.meta.url));
 assert.deepEqual(bytes,readFileSync(new URL('../docs/js/native_audio_effect.wasm',import.meta.url)));
 assert.deepEqual(bytes,readFileSync(new URL('../docs/native_audio_effect/gain.wasm',import.meta.url)));
});

test('browser rack loads local WASM, routes all sources through one Worklet and transfers a direct port',async t=>{
 const {TetoricaAudioRuntime}=await import('../web/tetorica_audio_runtime.js');
 const saved={fetch:globalThis.fetch,AudioWorkletNode:globalThis.AudioWorkletNode};
 t.after(()=>Object.assign(globalThis,saved));
 const modules=[],loads=[],sent=[];
 class Node{constructor(){this.connections=[];this.gain={value:1};}connect(n){this.connections.push(n);}disconnect(){this.connections=[];}}
 globalThis.fetch=async url=>{loads.push(String(url));return {ok:true,arrayBuffer:async()=>readFileSync(new URL('../web/native_audio_effect.wasm',import.meta.url))};};
 globalThis.AudioWorkletNode=class extends Node{constructor(context,name,options){super();assert.equal(name,'tetorica-native-fx');assert.ok(options.processorOptions.module instanceof WebAssembly.Module);this.port={postMessage:(d,transfer)=>sent.push({d,transfer}),close(){}};}};
 const context={destination:new Node(),createGain:()=>new Node(),audioWorklet:{addModule:async url=>modules.push(String(url))}};
 const audio=new TetoricaAudioRuntime({audioContext:context});audio.ensureRouting(context);
 await audio.prepareNativeFX();const rack=audio.nativeFX;
 assert.deepEqual(audio.masterInputNode.connections,[rack.node]);assert.deepEqual(rack.node.connections,[audio.masterOutputNode]);
 assert.match(loads[0],/native_audio_effect.wasm$/);assert.match(modules[0],/native-fx-worklet.js$/);
 const fx=audio.createFXApi();const gain=fx.gain({gain:.5});fx.setChain([gain]);assert.deepEqual(audio.getFXChain(),[gain]);
 const port=rack.workerPort();const attach=sent.at(-1);assert.equal(attach.d.op,'attach');assert.deepEqual(attach.transfer,[attach.d.port]);port.close();attach.d.port.close();
 rack.useMain();assert.ok(sent.some(({d})=>d.op==='main'));audio.disposeFXChain();assert.equal(audio.nativeFX,null);
});
