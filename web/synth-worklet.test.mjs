import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {YM2612DacPlayer, receiveDacCommand} from './ym2612_dac.js';
import {createChipPortReceiver} from './playground_chip_port.js';

function processor(tree, file, rate, imports = {}) {
  let Type;
  const messages = [];
  const context = { YM2612DacPlayer, receiveDacCommand, createChipPortReceiver: apply => createChipPortReceiver(apply, () => context.currentFrame / rate), ...imports, sampleRate: rate, currentFrame: 0, Float32Array, Uint8Array, Error,
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
    reserveStereoFrames() {},
    generateStereoView(n) { return this.generateStereo(n); },
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
    const generate = ym.generateStereoView.bind(ym);
    ym.generateStereoView = n => { generated += n; return generate(n); };
    const { p } = processor('web', 'ym2612-worklet.js', 48000);
    p.ym2612 = ym;
    for (let i = 0; i < 375; i++) render(p, 128);
    assert.equal(generated, ym.sampleRate());
  } finally { ym.dispose(); }
});

for (const tree of ['web', 'docs/js']) {
  test(`${tree}: YM2612 idle DAC level is silent in browser output, including reset`, async () => {
    const {default: factory} = await import('../docs/generated/ym2612_wasm.js');
    const {createYm2612} = await import('./ym2612.js');
    const {p, messages} = processor(tree, 'ym2612-worklet.js', 48000, {ym2612ModuleFactory: factory, createYm2612});
    await p.init(fs.readFileSync(new URL('../docs/generated/ym2612_wasm.wasm', import.meta.url)));
    try {
      assert.ok(messages.some(message => message.type === 'ready'));
      assert.ok(p.idleLeft > 0.01); // Real core models the DAC ladder offset.
      for (let i = 0; i < 10; i++) {
        const pcm = render(p, 128);
        assert.ok(pcm.left.every(sample => sample === 0));
        assert.ok(pcm.right.every(sample => sample === 0));
      }
      p.applyCommand({type: 'reset'});
      assert.ok(render(p, 128).left.every(sample => sample === 0));
      // A programmed signal still passes through; the chip API is untouched.
      p.ym2612.writeRegister(0xb6, 0xc0, 1);
      p.ym2612.writeRegister(0x2b, 0x80, 0);
      p.ym2612.writeRegister(0x2a, 200, 0);
      assert.ok(render(p, 128).left.some(sample => Math.abs(sample) > 0.01));
    } finally { p.ym2612?.dispose(); }
  });
  test(`${tree}: a partially initialized YM2612/PSG pair stays silent until ready`, () => {
    const {p} = processor(tree, 'ym2612-worklet.js', 48000);
    p.ym2612 = chip(48000);
    p.initializing = true;
    assert.ok(render(p, 128).left.every(sample => sample === 0));
    assert.equal(p.ym2612.frames, 0);
  });
}

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

for(const tree of ['web','docs/js']) for(const file of ['ym2612-worklet.js','ym2612-worklet-nuked.js']) test(`${tree} ${file}: mixed PSG/FM sample writes keep order at output-frame boundaries`,()=>{
 const {p}=processor(tree,file,48000),writes=[];
 p.ym2612=chip(48000);p.psg=chip(48000);
 p.ym2612.writeRegister=(r,v)=>writes.push(['fm',r,v,p.ym2612.frames]);
 p.psg.write=v=>writes.push(['psg',v,p.ym2612.frames]);
 const port={start(){},close(){}};p.port.onmessage({data:{type:'attach-chip-port',port}});
 port.onmessage({data:[{type:'begin-sample-schedule',lookaheadSeconds:0},{type:'sample-writes',entries:[
  {sample:441,port:0,register:0x22,value:8},
  {sample:441,type:'psg-write',value:0x85},
  {sample:441,type:'psg-write',value:0x12},
  {sample:882,type:'psg-write',value:0x9f},
 ]}]});
 render(p,1024);
 assert.deepEqual(writes,[['fm',0x22,8,480],['psg',0x85,480],['psg',0x12,480],['psg',0x9f,960]]);
});

for (const tree of ['web', 'docs/js']) for (const file of ['ym2612-worklet.js', 'ym2612-worklet-nuked.js']) {
 test(`${tree} ${file}: PCM API agrees with Node rendering, including a reserved start and end`, async () => {
  const {YM2612Synth, YM2612DirectTransport} = await import('./ym2612synth.js');
  const rate = 48000, native = chip(rate), expected = [];
  native.writeRegister = (r,v,p) => expected.push([native.frames,p,r,v]);
  const transport = new YM2612DirectTransport(native), synth = new YM2612Synth({transport});
  await synth.dac.setSample('voice', [100,180,140], {sampleRate:11025});
  await synth.dac.playFromSample('voice', {when:64/rate});
  transport.generateStereo(128);
  const {p,messages} = processor(tree,file,rate), actual=[];
  p.ym2612 = chip(rate);
  p.ym2612.writeRegister = (r,v,port) => actual.push([p.ym2612.frames,port,r,v]);
  p.applyCommand({type:'pcm-dac',id:1,command:{action:'load',name:'voice',data:Uint8Array.of(100,180,140),sampleRate:11025}});
  assert.equal(messages.at(-1).id,1);
  assert.equal(messages.at(-1).error,undefined);
  p.applyCommand({type:'pcm-dac',id:2,command:{action:'play',name:'voice',when:64/rate}});
  render(p,128);
  assert.deepEqual(actual,expected);
 });
 test(`${tree} ${file}: stopping PCM clears future starts and registered PCM survives reset`, () => {
  const {p,context,messages}=processor(tree,file,48000),writes=[];
  p.ym2612=chip(48000);
  p.ym2612.writeRegister=(r,v)=>writes.push([r,v]);
  const command=c=>p.applyCommand({type:'pcm-dac',id:1,command:c});
  command({action:'load',name:'x',data:Uint8Array.of(200),sampleRate:1});
  command({action:'play',name:'x',when:1});
  command({action:'stop'});
  context.currentFrame=48000;
  render(p,128);
  assert.equal(writes.length,0);
  p.applyCommand({type:'reset'});
  command({action:'play',name:'x'});
  render(p,128);
  assert.ok(writes.some(([r,v])=>r===0x2a&&v===200));
  command({action:'play',name:'missing'});
  assert.match(messages.at(-1).error,/Unknown/);
 });
}

for(const [file,wasm] of [['ym2612-worklet.js','ym2612_wasm.js'],['ym2612-worklet-nuked.js','nuked_opn2_wasm.js']]) {
 test(`${file}: high-level PCM produces audio through real WASM`,async()=>{
  const {default:factory}=await import(`../docs/generated/${wasm}`);
  const {Ym2612}=await import('./ym2612.js');
  const ym=await Ym2612.create({moduleFactory:factory});
  try {
   const {p}=processor('web',file,48000);p.ym2612=ym;
   const data=Uint8Array.from({length:551},(_,i)=>Math.round(128+60*Math.sin(2*Math.PI*440*i/11025)));
   p.applyCommand({type:'pcm-dac',id:1,command:{action:'load',name:'sine',data,sampleRate:11025}});
   p.applyCommand({type:'pcm-dac',id:2,command:{action:'play',name:'sine'}});
   const {left,right}=render(p,2400);
   assert.ok(left.every(Number.isFinite));
   const mean=left.reduce((a,b)=>a+b,0)/left.length;
   const rms=Math.sqrt(left.reduce((a,b)=>a+(b-mean)**2,0)/left.length);
   assert.ok(rms>0.001,`PCM must have audible AC energy (RMS ${rms})`);
   assert.deepEqual(left,right);
  }finally{ym.dispose();}
 });
}

for(const file of ['ym2612-worklet.js','ym2612-worklet-nuked.js'])test(`${file}: PCM registration acknowledges on the requesting Worker port`,()=>{
 const {p,messages}=processor('web',file,48000),replies=[];
 p.ym2612=chip(48000);
 const port={start(){},close(){},postMessage:reply=>replies.push(reply)};
 p.port.onmessage({data:{type:'attach-chip-port',port}});
 port.onmessage({data:[{type:'pcm-dac',id:23,command:{action:'load',name:'x',data:Uint8Array.of(128,200),sampleRate:11025}}]});
 assert.equal(replies.length,1);assert.equal(replies[0].id,23);assert.equal(replies[0].error,undefined);
 assert.equal(messages.length,0);
});

for(const tree of ['web','docs/js'])for(const file of ['ym2612-worklet.js','ym2612-worklet-nuked.js'])test(`${tree} ${file}: consumed reservations do not replay; interleaved batches preserve equal-time order and clear`,()=>{
 const {p,context}=processor(tree,file,48000),writes=[];
 p.ym2612=chip(48000);p.ym2612.writeRegister=(r,v)=>writes.push(v);
 const send=entries=>p.applyCommand({type:'schedule-writes',entries:entries.map(([frame,value])=>({time:frame/48000,port:0,register:42,value}))});
 send([[0,1],[64,4],[96,7]]);render(p,32);context.currentFrame=32;
 send([[32,2],[64,5],[80,6],[32,3]]);render(p,96);context.currentFrame=128;
 assert.deepEqual(writes,[1,2,3,4,5,6,7]);assert.equal(p.scheduledCommands.length,0);
 send([[128,8],[256,9]]);render(p,32);context.currentFrame=160;
 p.applyCommand({type:'clear-scheduled-writes'});send([[160,10]]);render(p,128);
 assert.deepEqual(writes,[1,2,3,4,5,6,7,8,10]);assert.equal(p.scheduledCommands.length,0);
});
