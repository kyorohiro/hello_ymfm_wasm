import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createNativeFXController,FX_TYPES,FX_PARAMS} from '../web/native_fx.js';
import {createSampleProcessor} from "../web/native_sample_processor.js";
import {setChain} from '../web/native_fx_graph.js';
const module=await WebAssembly.compile(readFileSync(new URL('../web/native_audio_effect.wasm',import.meta.url)));
function harness(){
 let Processor;const errors=[];
 const scope={createSampleProcessor,WebAssembly,Float32Array,Map,Math,Number,Error,sampleRate:48000,setChain,FX_TYPES,
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
 const voice=audio.createNoiseVoice({type:'brown'});voice.gain.set(.2);
 assert.ok(sent.some(({d})=>d.op==='noise'&&d.action==='create'));
 const port=rack.workerPort();const attach=sent.at(-1);assert.equal(attach.d.op,'attach');assert.deepEqual(attach.transfer,[attach.d.port]);port.close();attach.d.port.close();
 rack.useMain();assert.ok(sent.some(({d})=>d.op==='main'));audio.disposeFXChain();assert.equal(audio.nativeFX,null);
});

test('native noise colors are deterministic, finite and distinct; gain, envelopes and FX work',async()=>{
 const {createNativeNoiseController}=await import('../web/native_noise.js');
 const colors=[];
 for(const type of ['white','pink','brown','gray','clip']){
  const h=harness(),noise=createNativeNoiseController(d=>h.p.command(d));
  const voice=noise.create({type,seed:123,autoStart:false,attack:.01,release:.01});
  assert.ok(h.render(1,0).every(x=>x===0));
  voice.start();const data=h.render(10,0);assert.ok(data.every(Number.isFinite));assert.ok(data.some(x=>Math.abs(x)>.001));colors.push([...data]);
  voice.stop();assert.ok(h.render(10,0).every(x=>x===0));
  voice.start();const gain=h.fx.gain({gain:0});h.fx.setChain([gain]);assert.ok(h.render(10,0).every(x=>x===0));
  h.fx.clear();voice.gain.rampTo(0,.01);assert.ok(h.render(10,0).every(x=>x===0));voice.dispose();
 }
 for(let i=1;i<colors.length;i++)assert.notDeepEqual(colors[0],colors[i]);
 const renderSeed=()=>{const h=harness();createNativeNoiseController(d=>h.p.command(d)).create({seed:42});return [...h.render(2,0)];};
 assert.deepEqual(renderSeed(),renderSeed());
});

test('noise filters, pan, voice reuse and port ownership remain independent',async()=>{
 const {createNativeNoiseController}=await import('../web/native_noise.js');
 const h=harness(),port={start(){},close(){}};
 h.p.port.onmessage({data:{op:'attach',port}});
 const messages=[],noise=createNativeNoiseController(d=>{messages.push(d);port.onmessage({data:d});});
 const voice=noise.create({pan:1});assert.ok(h.render(2,0).every(x=>Math.abs(x)<1e-12));
 voice.pan.set(-1);
 for(const mode of ['lowpass','highpass','bandpass','notch','allpass','peaking','lowshelf','highshelf']){voice.filter.set(mode,1000,.7);assert.ok(h.render(10,0).every(Number.isFinite));}
 const old=messages.at(-1);voice.dispose();const next=noise.create();
 port.onmessage({data:{...old,action:'dispose'}});assert.ok(h.render(2,0).some(x=>x!==0));
 h.p.port.onmessage({data:{op:'main'}});assert.ok(h.render(2,0).every(x=>x===0));next.start();assert.ok(h.render(2,0).every(x=>x===0));
});

test('native noise allocation is bounded and disposed slots can be reused',async()=>{
 const {createNativeNoiseController}=await import('../web/native_noise.js');
 const h=harness(),noise=createNativeNoiseController(d=>h.p.command(d));
 const voices=Array.from({length:32},()=>noise.create({autoStart:false}));
 assert.throws(()=>noise.create(),/32 voices/);
 voices[0].dispose();const replacement=noise.create({seed:10});
 assert.throws(()=>voices[0].start(),/disposed/);
 assert.ok(h.render(2,0).some(x=>x!==0));
 noise.disposeAll();assert.ok(h.render(2,0).every(x=>x===0));
 assert.throws(()=>replacement.start(),/disposed/);
});

async function sampleHarness(){
 const h=harness();const {createNativeSampleController}=await import('../web/native_sample.js');
 const player=createNativeSampleController(d=>h.p.receive(d));
 h.p.port.postMessage=d=>player.accept(d);
 return {...h,player};
}
test('native PCM mixer preserves stereo, rate/offset/duration and loops',async()=>{
 const h=await sampleHarness();
 await h.player.load('stereo',{sampleRate:48000,channels:[Float32Array.from([.1,.2,.3,.4]),Float32Array.from([.5,.6,.7,.8])]});
 await h.player.play('stereo',{offset:1/48000,playbackRate:.5,duration:1/48000});
 let out=h.render(1,0);assert.ok(Math.abs(out[0]-.2)<1e-6);assert.ok(Math.abs(out[1]-.25)<1e-6);assert.equal(out[2],0);
 await h.player.play('stereo',{loop:true,loopStart:1/48000,loopEnd:3/48000});
 out=h.render(1,0);assert.ok(Math.abs(out[0]-.1)<1e-6);assert.ok(Math.abs(out[3]-.2)<1e-6);
 h.player.stopAll();assert.ok(h.render(1,0).every(x=>x===0));
 await h.player.play('stereo',{pan:1});out=h.render(1,0);assert.ok(out.every(x=>Math.abs(x)<1e-10));
});
test('native PCM fades, FX, stale handles and bank unloading',async()=>{
 const h=await sampleHarness();await h.player.load('tone',{sampleRate:24000,channels:[new Float32Array(100).fill(.5)]});
 const old=await h.player.play('tone',{pan:-1,fadeIn:4/48000});
 let out=h.render(1,0);assert.equal(out[0],0);assert.ok(Math.abs(out[4]-.5)<1e-6);
 h.render(1,0);const next=await h.player.play('tone',{pan:-1,loop:true,fadeOut:4/48000});old.stop();
 assert.ok(h.render(1,0).some(x=>x===.5));next.stop();out=h.render(1,0);assert.ok(out[0]===.5&&out[4]===0);
 await h.player.play('tone',{loop:true});const mute=h.fx.gain({gain:0});h.fx.setChain([mute]);assert.ok(h.render(10,0).every(x=>x===0));
 h.player.unload('tone');assert.equal(h.player.isLoaded('tone'),false);await assert.rejects(h.player.play('tone'),/Unknown/);
});
test('native PCM allocation errors and Stop during preparation reject directly',async()=>{
 const h=await sampleHarness();await assert.rejects(h.player.load('bad',{sampleRate:48000,channels:[Float32Array.of(NaN)]}),/Invalid/);
 const {createNativeSampleController}=await import('../web/native_sample.js');const messages=[];
 const player=createNativeSampleController(d=>messages.push(d));const loading=player.load('late',{sampleRate:48000,channels:[Float32Array.of(1)]});
 player.stopAll();await assert.rejects(loading,/stopped/);player.accept({op:'sample-response',id:messages[0].id});assert.equal(player.isLoaded('late'),false);
});

test('main runtime uses native PCM without allocating BufferSource nodes',async()=>{
 const h=await sampleHarness();const {TetoricaAudioRuntime}=await import('../web/tetorica_audio_runtime.js');
 const audio=new TetoricaAudioRuntime({audioContext:{createBufferSource(){throw new Error('legacy source used');}}});
 audio.nativeFX={sample:h.player,mainActive:true};
 audio.storeSample('hit',{sampleRate:48000,numberOfChannels:1,getChannelData:()=>new Float32Array(16).fill(.4)});
 await audio.playSample('hit',{loop:true,pan:-1});assert.ok(h.render(1,0).some(x=>x>.3));
 audio.stopSample();assert.ok(h.render(1,0).every(x=>x===0));
 audio.unloadSample('hit');assert.equal(audio.hasSample('hit'),false);
});
test('PCM bank/voice capacity errors arrive through direct acknowledgements',async()=>{
 const h=await sampleHarness(),pcm={sampleRate:48000,channels:[Float32Array.of(.2)]};
 for(let i=0;i<64;i++)await h.player.load(String(i),pcm);
 await assert.rejects(h.player.load('overflow',pcm),/bank limit/);
 for(let i=0;i<64;i++)await h.player.play('0',{loop:true});
 await assert.rejects(h.player.play('0'),/voice limit/);
 h.player.stopAll();await h.player.play('0');
 h.player.unload('1');await h.player.load('overflow',pcm);
});
