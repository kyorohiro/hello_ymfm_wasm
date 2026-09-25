import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { setChain,preset,effect,parallel,types } from '../docs/native_audio_effect/graph.js';
const module=await WebAssembly.compile(await readFile(new URL('../docs/native_audio_effect/gain.wasm',import.meta.url)));
const imports={env:{emscripten_notify_memory_growth(){}}};
function harness(name,rate=48000) {
  const api=new WebAssembly.Instance(module,imports).exports;
  api._initialize();api.graph_reset(rate);
  setChain(api,[effect(name)]);
  const kind=types[name], cap=api.gain_capacity();
  function parameter(p,value,slot=0) {assert.equal(api.extra_set(kind,slot,p,value),1);}
  function render(frames,signal=()=>0,block=128) {
    // Views are acquired after configuration because preparation may grow memory.
    const input=new Float32Array(api.memory.buffer,api.gain_input(),cap*2);
    const output=new Float32Array(api.memory.buffer,api.gain_output(),cap*2);
    const l=new Float32Array(frames),r=new Float32Array(frames);
    for(let t=0;t<frames;t+=block) {
      const n=Math.min(block,frames-t);
      for(let i=0;i<n;i++) {input[i]=signal(t+i,0);input[cap+i]=signal(t+i,1);}
      api.graph_process(n);l.set(output.subarray(0,n),t);r.set(output.subarray(cap,cap+n),t);
    }
    return [l,r];
  }
  parameter(6,1);parameter(7,0);
  return {api,kind,rate,parameter,render};
}
const energy=x=>x.reduce((sum,v)=>sum+v*v,0)/x.length;
for(const rate of [44100,48000,96000]) {
  test(`all eight FX process, bypass and clear at ${rate} Hz`,()=>{
    for(const name of ['filter','delay','distortion','bitcrusher','wobble','flanger','slicer','chorus']) {
      const h=harness(name,rate);
      h.render(Math.round(rate*0.3));
      const [l,r]=h.render(Math.round(rate*0.3),(i,c)=>0.2*Math.sin(i*2*Math.PI*(c?523:440)/rate));
      assert.ok(l.every(Number.isFinite)&&r.every(Number.isFinite),name);
      assert.ok(energy(l)>1e-7,`${name} produces audio`);
      h.parameter(7,1);h.render(Math.round(rate*0.5));
      const [dry]=h.render(128,()=>0.123);
      assert.ok(dry.every(v=>Math.abs(v-0.123)<1e-6),`${name} bypass`);
      h.api.graph_clear(); const [silent]=h.render(512);
      assert.ok(silent.every(v=>Math.abs(v)<1e-12),`${name} clear`);
      assert.equal(h.api.extra_set(h.kind,0,0,NaN),0);
      assert.equal(h.api.extra_set(h.kind,8,0,1),0);
    }
  });
  test(`filter LP/HP/BP frequency response at ${rate}`,()=>{
    function response(kind,hz) {
      const h=harness('filter',rate);h.parameter(0,1000);h.parameter(2,kind);
      h.render(Math.round(rate*0.3));
      const [out]=h.render(Math.round(rate*0.5),i=>0.1*Math.sin(i*2*Math.PI*hz/rate));
      return energy(out.subarray(Math.round(out.length/2)));
    }
    assert.ok(response(0,100)>response(0,10000)*100);
    assert.ok(response(1,10000)>response(1,100)*100);
    assert.ok(response(2,1000)>response(2,100)*20);
  });
}
test('delay impulse timing, feedback decay and independent slots',()=>{
  const h=harness('delay');h.parameter(0,100);h.parameter(1,0.5);h.render(48000);
  h.api.graph_clear();
  const [l,r]=h.render(16000,(i,c)=>i===0&&!c?1:0);
  assert.ok(Math.abs(l[4800]-1)<1e-4);
  assert.ok(Math.abs(l[9600]-0.5)<1e-4);
  assert.ok(Math.abs(l[14400]-0.25)<1e-4);
  assert.ok(r.every(v=>v===0));
  h.parameter(0,200,1);h.parameter(1,0,1);h.parameter(6,1,1);h.parameter(7,0,1);
  setChain(h.api,[parallel(effect('delay',0),effect('delay',1))]);h.render(48000);h.api.graph_clear();
  const [two]=h.render(11000,i=>i===0?1:0);
  assert.ok(Math.abs(two[4800]-1)<1e-4);
  assert.ok(Math.abs(two[9600]-1.5)<1e-4);
});
test('bitcrusher quantizes and holds samples',()=>{
  const h=harness('bitcrusher');h.parameter(0,3);h.parameter(1,1000);h.render(48000);h.api.graph_clear();
  const [out]=h.render(4800,i=>0.75*Math.sin(i*0.1));
  assert.ok(out.every(v=>Math.abs(v*4-Math.round(v*4))<1e-5));
  let changes=0;for(let i=1;i<out.length;i++) if(Math.abs(out[i]-out[i-1])>1e-5) changes++;
  assert.ok(changes<110);assert.ok(changes>10);
});
test('distortion soft clips and generates harmonics with bounded output',()=>{
  const h=harness('distortion');h.parameter(0,20);h.render(48000);
  const [out]=h.render(48000,i=>0.5*Math.sin(2*Math.PI*300*i/48000));
  assert.ok(out.every(v=>Math.abs(v)<=1));
  function harmonic(k) {let s=0,c=0;for(let i=24000;i<48000;i++){s+=out[i]*Math.sin(2*Math.PI*300*k*i/48000);c+=out[i]*Math.cos(2*Math.PI*300*k*i/48000);}return Math.hypot(s,c);}
  assert.ok(harmonic(3)>harmonic(1)*0.1);
});
test('slicer follows duty/min gain and wobble changes the spectrum periodically',()=>{
  const h=harness('slicer');h.parameter(0,2);h.parameter(1,0.5);h.parameter(2,0);h.render(48000);h.api.graph_clear();
  const [out]=h.render(48000,()=>0.5);
  assert.ok(out[5000]>0.49);assert.ok(out[18000]<1e-6);assert.ok(out[29000]>0.49);
  const w=harness('wobble');w.parameter(0,1000);w.parameter(1,3);w.parameter(2,2);w.render(48000);w.api.graph_clear();
  const [wave]=w.render(48000,i=>0.2*Math.sin(2*Math.PI*2000*i/48000));
  assert.ok(energy(wave.subarray(4000,8000))>energy(wave.subarray(16000,20000))*10);
});
test('flanger and chorus delay wet sound; chorus spreads stereo',()=>{
  for(const name of ['flanger','chorus']) {
    const h=harness(name);h.render(48000);h.api.graph_clear();
    const [l,r]=h.render(48000,i=>i===0?1:0);
    assert.ok(Math.abs(l[0])<1e-8);assert.ok(energy(l)>1e-7);
    if(name==='chorus') assert.ok(l.some((v,i)=>Math.abs(v-r[i])>1e-4));
  }
});
test('all-FX chain stays finite under repeated setting changes and is block-size independent',()=>{
  const a=harness('filter'),b=harness('filter');
  for(const h of [a,b]) {
    setChain(h.api,preset('extended'));
    for(let kind=7;kind<=14;kind++){assert.equal(h.api.extra_set(kind,0,7,0),1);assert.equal(h.api.extra_set(kind,0,6,0.3),1);}
  }
  const signal=i=>0.1*Math.sin(i*0.034);
  const [left]=a.render(12000,signal,128),[right]=b.render(12000,signal,37);
  assert.deepEqual(left,right);
  for(let j=0;j<30;j++) {
    a.parameter(0,j%2?20:20000);a.parameter(1,j%2?12:0.2);
    const [out]=a.render(512,signal);
    assert.ok(out.every(v=>Number.isFinite(v)&&Math.abs(v)<10));
  }
});
test('Worklet refreshes PCM views after delay allocation grows WASM memory',async()=>{
  let Processor;
  const scope=vm.createContext({WebAssembly,Float32Array,setChain,preset,sampleRate:96000,
    AudioWorkletProcessor:class {constructor(){this.port={postMessage(){}};}},
    registerProcessor(_name,type){Processor=type;},
  });
  const source=await readFile(new URL('../docs/native_audio_effect/effect-worklet.js',import.meta.url),'utf8');
  vm.runInContext(source.replace(/^import .*\n/,''),scope);
  const p=new Processor({processorOptions:{module}});
  const before=p.input.buffer;
  // Force growth with independent long delay instances.
  for(let slot=0;slot<8;slot++) p.port.onmessage({data:{type:'extra',kind:8,slot,parameter:0,value:2000}});
  // Ensure the refresh branch executes even on allocators with spare memory.
  if(before===p.api.memory.buffer) p.api.memory.grow(1);
  const output=[new Float32Array(128),new Float32Array(128)];
  p.process([[new Float32Array(128).fill(0.1)]],[output]);
  assert.notEqual(p.input.buffer,before);
  assert.ok(output[0].every(v=>Math.abs(v-0.1)<1e-6));
});
