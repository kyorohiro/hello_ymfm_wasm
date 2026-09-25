import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createChipPortReceiver} from './playground_chip_port.js';

function processor(tree, file, rate, imports = {}) {
  let Type;
  const messages = [];
  const context = { createChipPortReceiver: apply => createChipPortReceiver(apply, () => context.currentFrame / rate), ...imports, sampleRate: rate, currentFrame: 0, Float32Array, Uint8Array, Error,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: x => messages.push(x) }; } },
    registerProcessor: (_, value) => { Type = value; },
  };
  vm.runInNewContext(fs.readFileSync(new URL(`../${tree}/${file}`, import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''), context);
  return { p: new Type(), messages, context };
}
function chip(rate) {
  return { frames: 0, value: 1,
    sampleRate: () => rate,
    reset() { this.frames = 0; this.value = 0; },
    writeRegister(_register, value) { this.value = value; },
    generateStereo(n) {
      this.frames += n;
      return { left: new Float32Array(n).fill(this.value), right: new Float32Array(n).fill(-this.value) };
    },
  };
}
function render(p, frames) {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  p.process([], [[left, right]]);
  return { left, right };
}
for (const tree of ['web', 'docs/js']) {
  for (const [name, klass] of [['ym2203', 'Ym2203'], ['ym2608', 'Ym2608'], ['ym2610b', 'Ym2610B']]) {
    test(`${tree} ${name}: failed initialization reports an error to the runtime`, async () => {
      const { p, messages } = processor(tree, `${name}-worklet.js`, 48000, {
        [klass]: { create: async () => { throw new Error('invalid WASM'); } },
        [`${name}ModuleFactory`]: () => {},
      });
      await assert.doesNotReject(p.initialize(new ArrayBuffer(1)));
      assert.equal(messages.length, 1);
      assert.equal(messages[0].type, 'error');
      assert.equal(messages[0].message, 'invalid WASM');
      assert.ok(render(p, 128).left.every(x => x === 0));
    });
  }
  for (const file of ['ym2612-worklet.js', 'ym2612-worklet-nuked.js']) {
    for (const outputRate of [44100, 48000, 53267, 96000]) {
      test(`${tree} ${file}: one second at ${outputRate} advances FM and PSG by one second`, () => {
        const { p } = processor(tree, file, outputRate);
        p.ym2612 = chip(53267); p.psg = chip(53267);
        for (let left = outputRate; left > 0; left -= 127) render(p, Math.min(left, 127));
        assert.equal(p.ym2612.frames, 53267);
        assert.equal(p.psg.frames, 53267);
      });
    }
    test(`${tree} ${file}: upsampling holds stereo samples and reset clears history`, () => {
      const { p } = processor(tree, file, 96000);
      p.ym2612 = chip(48000);
      assert.deepEqual([...render(p, 3).left], [0,1,1]);
      assert.deepEqual([...render(p, 1).right], [-1]);
      p.applyCommand({ type: 'reset' });
      assert.deepEqual([...render(p, 1).left], [0]);
      assert.equal(p.ym2612.frames, 0);
    });
    test(`${tree} ${file}: capture retains the output rate and stereo mix`, () => {
      const { p, messages } = processor(tree, file, 48000);
      p.ym2612 = chip(53267); p.ym2612.value = 0.5;
      p.psg = chip(53267); p.psg.value = 0.25;
      p.applyCommand({ type: 'start-capture', captureId: 7 });
      const pcm = render(p, 128);
      p.applyCommand({ type: 'stop-capture' });
      const capture = messages.find(x => x.type === 'capture-stopped');
      assert.equal(capture.frameCount, 128);
      assert.deepEqual(capture.left, pcm.left);
      assert.deepEqual(capture.right, pcm.right);
      assert.ok(pcm.left.every(x => Math.abs(x - 0.5375) < 1e-6));
    });
  }
  test(`${tree}: scheduled writes keep their output timestamp during conversion`, () => {
    const { p } = processor(tree, 'ym2612-worklet.js', 48000);
    p.ym2612 = chip(53267); p.ym2612.value = 0;
    p.applyCommand({ type: 'schedule-writes', entries: [{ time: 64 / 48000, port: 0, register: 0x2a, value: 1 }] });
    const pcm = render(p, 128);
    assert.ok(pcm.left.slice(0, 64).every(x => x === 0));
    assert.ok(pcm.left.slice(64).every(x => x === 1));
    assert.equal(p.ym2612.frames, Math.floor(128 * 53267 / 48000));
  });
}

test('real YM2612 WASM advances one chip second for one second of 48 kHz output', async () => {
  const { default: factory } = await import('../docs/generated/ym2612_wasm.js');
  const { Ym2612 } = await import('./ym2612.js');
  const ym = await Ym2612.create({ moduleFactory: factory });
  try {
    let generated = 0;
    const generate = ym.generateStereo.bind(ym);
    ym.generateStereo = n => { generated += n; return generate(n); };
    const { p } = processor('web', 'ym2612-worklet.js', 48000);
    p.ym2612 = ym;
    for (let i = 0; i < 375; i++) render(p, 128);
    assert.equal(generated, ym.sampleRate());
  } finally { ym.dispose(); }
});

test('MIDI PSG writes share the sample-accurate FM scheduling queue', () => {
 const {p,context}=processor('web','ym2612-worklet.js',48000);
 p.ym2612=chip(48000);p.psg=chip(48000);
 const writes=[];p.psg.write=value=>{writes.push({value,frames:p.psg.frames});};
 p.applyCommand({type:'schedule-writes',entries:[{time:64/48000,type:'psg-write',value:0x9f}]});
 render(p,128);assert.deepEqual(writes,[{value:0x9f,frames:64}]);
});

for(const tree of ['web','docs/js']) for(const file of ['ym2612-worklet.js','ym2612-worklet-nuked.js']) test(`${tree} ${file}: direct DAC bank and writes use the output clock at 48 kHz`,()=>{
 const {p}=processor(tree,file,48000);
 p.ym2612=chip(48000);
 const writes=[];
 p.ym2612.writeRegister=(r,v)=>writes.push({r,v,frame:p.ym2612.frames});
 const port={start(){},close(){}};
 p.port.onmessage({data:{type:'attach-chip-port',port}});
 const data=new Uint8Array(10),view=new DataView(data.buffer);
 data[4]=128;view.setUint32(5,441,true);data[9]=200;
 port.onmessage({data:[
  {type:'load-dac-bank',name:'tone',data:data.buffer},
  {type:'begin-sample-schedule',lookaheadSeconds:0},
  {type:'sample-dac-bank',name:'tone',sample:0},
  {type:'sample-writes',entries:[{sample:882,port:0,register:0x2b,value:0}]},
 ]});
 render(p,1024);
 assert.deepEqual(writes,[{r:42,v:128,frame:0},{r:42,v:200,frame:480},{r:43,v:0,frame:960}]);
 port.onmessage({data:[{type:'sample-dac-bank',name:'tone',sample:44100},{type:'clear-dac-playback'}]});
 assert.equal(p.dacStreams.length,0);
});

for (const [file, wasm] of [['ym2612-worklet.js','ym2612_wasm.js'],['ym2612-worklet-nuked.js','nuked_opn2_wasm.js']]) {
 test(`${file}: direct DAC sine bank produces non-silent PCM with real WASM`,async()=>{
  const {default:factory}=await import(`../docs/generated/${wasm}`);
  const {Ym2612}=await import('./ym2612.js');
  const ym=await Ym2612.create({moduleFactory:factory});
  try {
   const {p}=processor('web',file,48000);p.ym2612=ym;
   const port={start(){},close(){}};
   p.port.onmessage({data:{type:'attach-chip-port',port}});
   const data=new Uint8Array(2205*5),view=new DataView(data.buffer);
   for(let i=0;i<2205;i++){view.setUint32(i*5,i,true);data[i*5+4]=Math.round(128+60*Math.sin(2*Math.PI*440*i/44100));}
   port.onmessage({data:[
    {type:'write',port:1,register:0xb6,value:0xc0},
    {type:'write',port:0,register:0x2b,value:0x80},
    {type:'load-dac-bank',name:'sine',data:data.buffer},
    {type:'begin-sample-schedule',lookaheadSeconds:0},
    {type:'sample-dac-bank',name:'sine',sample:0},
   ]});
   const {left}=render(p,2400);
   assert.ok(left.every(Number.isFinite));
   const mean=left.reduce((a,b)=>a+b,0)/left.length;
   const rms=Math.sqrt(left.reduce((a,b)=>a+(b-mean)**2,0)/left.length);
   assert.ok(rms>0.001,`DAC sine must have audible AC energy (RMS ${rms})`);
  } finally {ym.dispose();}
 });
}
