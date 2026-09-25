import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const module = await WebAssembly.compile(await readFile(new URL('../docs/native_audio_effect/gain.wasm', import.meta.url)));
test('C gain scales stereo PCM, ramps and rejects invalid values', () => {
  const a = new WebAssembly.Instance(module).exports;
  a._initialize(); a.gain_reset();
  const n = a.gain_capacity();
  const input = new Float32Array(a.memory.buffer,a.gain_input(),n*2);
  const output = new Float32Array(a.memory.buffer,a.gain_output(),n*2);
  input.fill(0.5,0,n); input.fill(-0.25,n);
  a.gain_set(2,0); a.gain_process(128);
  assert.equal(output[127],1); assert.equal(output[n+127],-0.5);
  a.gain_set(0,4); a.gain_process(4);
  assert.deepEqual([...output.slice(0,4)],[0.75,0.5,0.25,0]);
  a.gain_set(NaN,0); a.gain_process(4); assert.equal(output[0],0);
});
test('Worklet passes stereo through real WASM and supports gain / bypass / disconnected input', async () => {
  let Processor;
  const scope = vm.createContext({WebAssembly,Float32Array,sampleRate:48000,
    AudioWorkletProcessor:class {constructor(){this.port={};}},
    registerProcessor(_name,type){Processor=type;},
  });
  vm.runInContext(await readFile(new URL('../docs/native_audio_effect/effect-worklet.js',import.meta.url),'utf8'),scope);
  const p=new Processor({processorOptions:{module}});
  const input=[new Float32Array(128).fill(0.5),new Float32Array(128).fill(-0.25)];
  const output=[new Float32Array(128),new Float32Array(128)];
  p.process([input],[output]); assert.equal(output[0][0],0.5); assert.equal(output[1][0],-0.25);
  p.port.onmessage({data:{type:'gain',value:0,bypass:false}});
  p.process([input],[output]); p.process([input],[output]); assert.equal(output[0][127],0);
  p.port.onmessage({data:{type:'gain',value:0,bypass:true}});
  p.process([input],[output]); p.process([input],[output]); assert.equal(output[0][127],0.5);
  p.process([[]],[output]); assert.ok(output.every(ch=>ch.every(v=>v===0)));
});

function measure(band, db, hz, rate) {
  const a = new WebAssembly.Instance(module).exports;
  a._initialize(); a.gain_reset(); a.eq_reset(rate);
  if (band !== null) a.eq_set(band, db);
  const size=a.gain_capacity();
  const input=new Float32Array(a.memory.buffer,a.gain_input(),size*2);
  const output=new Float32Array(a.memory.buffer,a.gain_output(),size*2);
  let before=0,after=0;
  for(let t=0;t<rate;t+=128) {
    for(let i=0;i<128;i++) input[i]=0.1*Math.sin(2*Math.PI*hz*(t+i)/rate);
    a.gain_process(128);
    for(let i=0;i<128;i++) {
      assert.ok(Number.isFinite(output[i]));
      assert.equal(output[size+i],0); // No leakage into the silent right channel.
      if(t>rate/2) {before+=input[i]**2;after+=output[i]**2;}
    }
  }
  return 10*Math.log10(after/before);
}
for(const rate of [44100,48000,96000]) {
  test(`EQ frequency response and stereo separation at ${rate} Hz`,()=>{
    assert.ok(Math.abs(measure(null,0,1000,rate))<0.001);
    for(const [band,hz] of [[0,40],[1,1000],[2,12000]]) {
      assert.ok(Math.abs(measure(band,12,hz,rate)-12)<0.4);
      assert.ok(Math.abs(measure(band,-12,hz,rate)+12)<0.4);
    }
    assert.ok(Math.abs(measure(0,12,10000,rate))<0.1);
    assert.ok(Math.abs(measure(2,12,50,rate))<0.1);
  });
}
test('EQ repeated extreme changes remain finite and return to unity',()=>{
  const a=new WebAssembly.Instance(module).exports;
  a._initialize();a.gain_reset();a.eq_reset(48000);
  const size=a.gain_capacity();
  const input=new Float32Array(a.memory.buffer,a.gain_input(),size*2);
  const output=new Float32Array(a.memory.buffer,a.gain_output(),size*2);
  input.fill(0.1);
  for(let t=0;t<300;t++) {
    for(let b=0;b<3;b++) a.eq_set(b,t%2 ? 12 : -12);
    a.gain_process(128);
    assert.ok(output.slice(0,128).every(v=>Number.isFinite(v)&&Math.abs(v)<10));
  }
  for(let b=0;b<3;b++) a.eq_set(b,0);
  for(let t=0;t<200;t++) a.gain_process(128);
  assert.ok(Math.abs(output[127]-0.1)<1e-5);
});

for (const rate of [44100, 48000, 96000]) {
  test(`algorithmic reverb tail, decay and clear at ${rate} Hz`, () => {
    const a = new WebAssembly.Instance(module).exports;
    a._initialize(); a.gain_reset(); a.eq_reset(rate); a.reverb_reset(rate);
    const n = a.gain_capacity();
    const input = new Float32Array(a.memory.buffer,a.gain_input(),n*2);
    const out = new Float32Array(a.memory.buffer,a.gain_output(),n*2);
    a.reverb_set(1,0.6,0.4);
    for(let t=0;t<rate;t+=128) a.gain_process(128); // Settle parameter smoothing.
    let early=0, late=0, difference=0;
    for(let t=0;t<rate*6;t+=128) {
      input.fill(0); if(t===0) input[0]=input[n]=0.5;
      a.gain_process(128);
      for(let i=0;i<128;i++) {
        assert.ok(Number.isFinite(out[i]) && Math.abs(out[i])<2);
        assert.ok(Number.isFinite(out[n+i]) && Math.abs(out[n+i])<2);
        if(t<rate) early+=out[i]**2;
        if(t>rate*5) late+=out[i]**2;
        difference+=Math.abs(out[i]-out[n+i]);
      }
    }
    assert.ok(early>0.001, 'audible tail');
    assert.ok(late<early*0.001, 'tail decays');
    assert.ok(difference>0.01, 'stereo spread');
    a.reverb_clear(); input.fill(0); a.gain_process(128);
    assert.ok(out.slice(0,128).every(v=>v===0));
    assert.ok(out.slice(n,n+128).every(v=>v===0));
  });
}
