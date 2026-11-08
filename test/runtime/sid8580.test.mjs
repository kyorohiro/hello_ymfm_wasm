import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Sid8580Core} from '../../tetorica_src/runtime/sid8580.js';
import {SidSynth} from '../../tetorica_src/runtime/sidsynth.js';

const wasmBinary = await readFile(new URL('../../docs/generated/sid8580-machine/sid8580-endpoint.wasm', import.meta.url));
const CLOCK = 985248;
const peak = pcm => pcm.reduce((p, x) => Math.max(p, Math.abs(x)), 0);
async function core(t, sampleRate = 48000) {
  const chip = await Sid8580Core.create({sampleRate, wasmBinary}); t.after(() => chip.dispose()); return chip;
}
function patch(write) {
  for (const [r,v] of [[24,15],[0,0x42],[1,0x1d],[5,0],[6,0xf9],[4,0x21],[14,0x81],[15,0x0e],[19,0],[20,0xf8],[18,0x11]]) write(r,v);
}
// Independent comparison through the C64 endpoint's single-PHI2 ABI, rather
// than the standalone batch ABI used by Sid8580Core. The loop is test-only.
async function endpointReference(t, rate) {
  const {instance:{exports:a}} = await WebAssembly.instantiate(wasmBinary, {}), h = a.sid8e_create(rate,0);
  assert(h); t.after(() => a.sid8e_destroy(h));
  const queued=[]; let previousInput=0, previousOutput=0;
  const pole=Math.exp(-2*Math.PI*12/rate);
  function tick(access=0,r=0,v=0) {
    const result=a.sid8e_tick(h,access,r,v)>>>0;assert.equal((result>>>10)&63,0);
    if(result&256){const n=result>>>16,input=(n>=32768?n-65536:n)/32768;
      const out=input-previousInput+pole*previousOutput;previousInput=input;previousOutput=out;queued.push(Math.fround(out));}
    return result&255;
  }
  return {write:(r,v)=>tick(1,r,v),read:r=>tick(2,r),render(n){while(queued.length<n)tick();return Float32Array.from(queued.splice(0,n));}};
}

test('8580 batch output and tick-before-access match the real C64 endpoint at three rates',async t=>{
  for(const rate of [44100,48000,96000]){
    const chip=await core(t,rate),ref=await endpointReference(t,rate);
    patch((r,v)=>{chip.writeRegister(r,v);ref.write(r,v);});
    for(let i=0;i<90;i++){chip.writeRegister(2,i);ref.write(2,i);}
    const actual=chip.render(6000);assert(peak(actual)>.01);assert.deepEqual(actual,ref.render(6000));
    for(const register of [27,28,0])assert.equal(chip.readRegister(register),ref.read(register));
    chip.writeRegister(4,0x41);ref.write(4,0x41);assert.deepEqual(chip.render(2500),ref.render(2500));
    const before=chip.getState();for(let i=0;i<3;i++)chip.getState();assert.deepEqual(chip.getState(),before);
    assert.deepEqual(before.voices,Array.from({length:3},()=>({envelope:null,phase:null})));
    assert.deepEqual(before.profiles,{resonance:false,cutoff:false});assert.equal(before.cpuFree,true);
  }
});

test('8580 render partitioning, queued register samples and reset are deterministic with batch calls',async t=>{
  for(const rate of [44100,48000,96000]){
    const a=await core(t,rate),b=await core(t,rate);patch(a.writeRegister.bind(a));patch(b.writeRegister.bind(b));
    let batches=0;const native=a.exports;
    a.exports={...native,sid8p_run(...args){batches++;return native.sid8p_run(...args);}};
    const expected=a.render(12000),actual=new Float32Array(12000);
    for(let at=0;at<actual.length;){const n=Math.min(actual.length-at,at%997+1);b.renderInto(actual.subarray(at,at+n));at+=n;}
    assert.deepEqual(actual,expected);assert(batches<=4,'render calls must batch PHI2 work, not call JS once per chip tick');
    assert.deepEqual(a.getState(),b.getState());a.reset();b.reset();assert.deepEqual(a.render(1000),new Float32Array(1000));
    assert.deepEqual(b.render(1000),new Float32Array(1000));assert.deepEqual(a.getState(),b.getState());
  }
});

test('8580 validation, access queue overflow, unsupported POT and disposal stay bounded',async t=>{
  for(const options of [{clockHz:1022727},{model:'6581'},{sampleRate:7999}])await assert.rejects(Sid8580Core.create({wasmBinary,...options}));
  const controller=new AbortController();controller.abort();await assert.rejects(Sid8580Core.create({wasmBinary,signal:controller.signal}),{name:'AbortError'});
  const chip=await core(t,96000),before=chip.getState();
  for(const invoke of [()=>chip.writeRegister(32,0),()=>chip.writeRegister(0,256),()=>chip.readRegister(-1),()=>chip.render(-1),()=>chip.renderInto(new Float64Array(2))]){
    assert.throws(invoke);assert.deepEqual(chip.getState(),before);
  }
  assert.throws(()=>chip.readRegister(25),error=>error.code===5&&/POT/.test(error.message));
  assert.equal(chip.getState().cycles,before.cycles+1);
  chip.reset();let accepted=0;
  for(;accepted<50000;accepted++){try{chip.writeRegister(31,accepted&255);}catch(error){assert.match(error.message,/queue is full/);break;}}
  assert(accepted<50000&&accepted>4096);const full=chip.getState();assert.equal(full.frames,4096);
  assert.throws(()=>chip.writeRegister(31,0),/queue is full/);assert.deepEqual(chip.getState(),full);
  assert.doesNotThrow(()=>chip.render(128));assert.doesNotThrow(()=>chip.writeRegister(31,0));
  chip.reset();assert.equal(peak(chip.render(256)),0);chip.dispose();chip.dispose();assert.equal(chip.handle,0);
  assert.throws(()=>chip.getState(),/disposed/);assert.throws(()=>chip.render(1),/disposed/);
});

test('SID high-level API retains the chosen model and nullable observations without cross-model adoption',async t=>{
  const chip=await core(t),synth=new SidSynth({core:chip});t.after(()=>synth.dispose());
  assert.equal(synth.model,'8580');synth.initialize();synth.noteOn(0,'C4');assert(peak(chip.render(4096))>.01);
  const state=synth._getState();assert.equal(state.model,'8580');assert.equal(state.channels[0].envelope,null);
  assert.equal(state.channels[0].phase,null);assert.throws(()=>synth._adoptState({...state,model:'6581'}),/model/);
  assert.throws(()=>new SidSynth({core:chip,model:'6581'}),/match/);
  assert.throws(()=>new SidSynth({model:'8580',clock:1022727,transport:{writeRegister(){},reset(){}}}),/PAL/);
  const shadow=new SidSynth({model:'8580',transport:{writeRegister(){},reset(){}}});shadow.initialize();assert.equal(shadow._getState().model,'8580');shadow.dispose();
});

test('8580 split native counters treat WASM i32 halves as unsigned past the sign boundary',async t=>{
  const chip=await core(t),native=chip.exports;
  chip.exports={...native,sid8p_cycles_lo:()=>-1,sid8p_cycles_hi:()=>1,sid8p_frames_lo:()=>-2147483648,sid8p_frames_hi:()=>2};
  assert.equal(chip.getState().cycles,8589934591);assert.equal(chip.getState().frames,10737418240);
});
