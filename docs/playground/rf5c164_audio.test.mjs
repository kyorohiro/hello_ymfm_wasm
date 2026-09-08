import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Rf5c164 } from '../js/rf5c164.js';
import { GenesisAudioEngine } from '../js/genesisaudioengine.js';
import { Ym2612VGM } from '../js/ym2612vgm.js';
import { VgmPlayer } from '../js/vgmplayer.js';
import { sourcesForChip, allSourcesMuted } from '../vgm_analyzer/source_mutes.js';
function wasm(chip) {
  const url = new URL(`../generated/${chip}_wasm.js`, import.meta.url);
  const source = readFileSync(url, 'utf8').replaceAll('import.meta.url', JSON.stringify(url.href)).replace('export default Module;', 'Module;');
  return { moduleFactory: vm.runInNewContext(source, {console, WebAssembly, Uint8Array, setTimeout, clearTimeout, performance, URL}),
    moduleOptions: {wasmBinary: new Uint8Array(readFileSync(new URL(`../generated/${chip}_wasm.wasm`, import.meta.url)))}};
}
const create = (options = {}) => Rf5c164.create({...wasm('rf5c164'), ...options});
const u32 = n => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24];
const u24 = n => u32(n).slice(0, 3);
const block = (type, data) => [0x67, 0x66, type, ...u32(data.length), ...data];
const ram = (offset, data) => block(0xc1, [offset & 255, offset >>> 8, ...data]);
const transfer = (from, to, size) => [0x68, 0x66, 2, ...u24(from), ...u24(to), ...u24(size)];
const registers = [[7, 0xc0], [0, 255], [1, 0x0f], [2, 0], [3, 8], [4, 0], [5, 0], [6, 0], [8, 0xfe]];
const writes = registers.flatMap(([r,v]) => [0xb1,r,v]);
const wait = n => [0x61,n & 255,n >>> 8];
function vgm(commands, loop = null) {
  const b = new Uint8Array(0x100 + commands.length); b.set([86,103,109,32]);
  const v = new DataView(b.buffer); v.setUint32(4,b.length-4,true); v.setUint32(8,0x171,true);
  v.setUint32(0x34,0xcc,true); v.setUint32(0x6c,16934400,true);
  if (loop !== null) v.setUint32(0x1c,0x100+loop-0x1c,true);
  b.set(commands,0x100); return b;
}
const peak = a => a.reduce((p,v) => Math.max(p,Math.abs(v)),0);
function pcmEngine(chip) {
  return { reset(){chip.reset();chip.clearMemory();}, clearRf5c164Memory(){chip.clearMemory();}, sampleRate(){return chip.sampleRate();},
    writePsg(){}, writeRf5c164(r,v){chip.writeRegister(r,v);}, writeRf5c164Memory(o,v){chip.writeMemory(o,v);},
    loadRf5c164Memory(d,o){chip.loadBankedMemory(d,o);}, processFrames(n){return chip.generateStereo(n);} };
}
function render(player,n) { const left=new Float32Array(n),right=new Float32Array(n); player.process(left,right,n);return {left,right}; }

test('WASM signed samples, pan, loop and phase preservation across chunks', async()=>{
  const c=await create({clock:16934400});
  try {
    c.loadMemory(Uint8Array.of(0xfe,0x7e,0xff)); registers.forEach(([r,v])=>c.writeRegister(r,v));
    const a=c.generateStereo(8);
    const expected=(126*15*255 >> 5)/32768;
    assert.deepEqual([...a.left], [expected,-expected,expected,-expected,expected,-expected,expected,-expected]);
    assert.equal(peak(a.right),0);
    c.reset(); assert.equal(c.readMemory(0),0xfe);
    registers.forEach(([r,v])=>c.writeRegister(r,v));
    assert.deepEqual([...c.generateStereo(3).left,...c.generateStereo(5).left],[...a.left]);
    c.clearMemory(); assert.equal(c.readMemory(0),0);
  } finally {c.dispose();}
  const a=await create(),b=await create();
  try {
    for(const c of [a,b]) {c.loadMemory(Uint8Array.of(0xfe,0x7e,0xff));registers.forEach(([r,v])=>c.writeRegister(r,v));}
    assert.deepEqual([...a.generateStereo(10000).left], [...b.generateStereo(1).left,...b.generateStereo(499).left,...b.generateStereo(9500).left]);
  } finally {a.dispose();b.dispose();}
});

test('VGM banked C1 blocks, C2 bytes and 68 transfers use bank OR and preserve order',async()=>{
  const c=await create({clock:16934400});
  try {
    const p=new Ym2612VGM(vgm([
      0xb1,7,0x81,...ram(0x1000,[0xfe,0xff]), // OR, not addition: stays at 0x1000
      0xc2,2,0,0x55,...block(2,[10,20]),...block(2,[30,40]),...transfer(1,4,3),0x66
    ]));
    while(p.playStep({rf5c164:c}).type!=='end'){}
    assert.deepEqual([0,1,2,4,5,6].map(o=>c.readMemory(0x1000+o)),[0xfe,0xff,0x55,20,30,40]);
    assert.equal(c.readMemory(0x2000),0);
    p.position=p.header.dataOffset;p.ended=false;
    while(p.playStep({rf5c164:c}).type!=='end'){}
    assert.equal(p.dataBanks.get(2).length,4);
    p.reset();while(p.playStep({rf5c164:c}).type!=='end'){}
    assert.equal(p.dataBanks.get(2).length,4);
  } finally {c.dispose();}
});

test('Player applies mid-song RAM writes at waits, pauses, restarts and clears new songs',async()=>{
  const c=await create({clock:16934400});
  try {
    const p=new VgmPlayer(pcmEngine(c));p.setPrefetchFactor(1);
    p.load(vgm([...ram(0,[0xfe,0xff]),...writes,...wait(16),...ram(0,[0x7e]),...wait(16),0x66]));p.reset();p.play();
    const a=render(p,32);assert.ok(a.left[0]>0);assert.ok(a.left[16]<0);assert.equal(peak(a.right),0);
    p.reset();p.play(); assert.deepEqual(render(p,32),a);
    p.reset();p.play();const first=render(p,8);p.pause();assert.equal(p.isPaused(),true);assert.equal(p.isPlaying(),false);p.resume();assert.deepEqual(render(p,8),first);
    p.load(vgm([0x66]));assert.equal(c.readMemory(0),0);
  }finally{c.dispose();}
});

test('Player loop retains initial RAM and has no gap',async()=>{
  const c=await create({clock:16934400});
  try {
    const init=[...ram(0,[0xfe,0xff]),...writes];
    const p=new VgmPlayer(pcmEngine(c));p.load(vgm([...init,...wait(16),0x66],init.length));p.reset();p.setLoopEnabled(true);p.play();
    const a=render(p,128);assert.ok(a.left.every(v=>v>0));
  }finally{c.dispose();}
});

test('Malformed RF5 blocks, transfer ranges, second chip, short headers and unsupported streams',()=>{
  for(const commands of [block(0xc1,[0]),ram(65535,[1,2]),transfer(0,0,1),[0xc2,0,16,1], [0x68,0,2,...new Array(9).fill(0)], [...block(2,[1]),...transfer(0,0,0)]]) {
    const p=new Ym2612VGM(vgm([...commands,0x66]));assert.throws(()=>{while(p.step().type!=='end'){};});
  }
  const warnings=[];const p=new Ym2612VGM(vgm([0xb1,0x80,1,0x90,0,0x10,0,0,0x66]),{logger:{warn:v=>warnings.push(v)}});
  while(p.playStep({}).type!=='end'){}
  assert.ok(warnings.some(w=>w.includes('second RF5C164')));assert.ok(warnings.some(w=>w.includes('DAC stream')));
  const b=new Uint8Array(65);b.set([86,103,109,32]);new DataView(b.buffer).setUint32(8,0x150,true);b[64]=0x66;
  const short=new Ym2612VGM(b);assert.equal(short.header.rf5c164Clock,0);assert.equal(short.header.ym2608Clock,0);
});

test('Genesis actual WASMs mix PCM, mute without stopping it, and reset',async()=>{
  const ym=wasm('ym2612'),psg=wasm('segapsg'),pcm=wasm('rf5c164');
  const e=await GenesisAudioEngine.create({ym2612ModuleFactory:ym.moduleFactory,ym2612ModuleOptions:ym.moduleOptions,
    segaPsgModuleFactory:psg.moduleFactory,segaPsgModuleOptions:psg.moduleOptions,
    rf5c164ModuleFactory:pcm.moduleFactory,rf5c164ModuleOptions:pcm.moduleOptions,rf5c164Clock:12500000});
  try {
    const baseline=peak(e.processFrames(100).left);
    e.pcm.loadMemory(Uint8Array.of(0xfe,0x7e,0xff));registers.forEach(([r,v])=>e.writeRf5c164(r,v));
    assert.ok(peak(e.processFrames(100).left)>0);
    e.setPcmMuted(true);assert.equal(peak(e.processFrames(101).left),baseline);
    e.setPcmMuted(false);assert.ok(peak(e.processFrames(100).left)>0);
    e.reset();assert.equal(e.pcm.readMemory(0),0);assert.equal(peak(e.processFrames(100).left),baseline);
    e.writeYm2612(0,0x2b,0x80);e.writeYm2612(0,0x2a,0xff);e.writeYm2612(1,0xb6,0xc0);
    e.writePsg(0x81);e.writePsg(0x00);e.writePsg(0x90);
    assert.ok(peak(e.processFrames(200).left)>0,'FM DAC and PSG still produce audio');
  } finally {e.dispose();}
  assert.deepEqual(sourcesForChip('megacd').map(s=>s.key),['psg','pcm']);
  assert.equal(allSourcesMuted('megacd',[{muted:true}],{psg:true,pcm:false}),false);
});

test('PCM output mute keeps the exact continuously running phase',async()=>{
  const a=await create(),b=await create();
  const silence={generateStereo:n=>({left:new Float32Array(n),right:new Float32Array(n)}),reset(){},dispose(){}};
  const engine=new GenesisAudioEngine(silence,silence,44100,1,a);
  try {
    for(const c of [a,b]) {c.loadMemory(Uint8Array.of(0xfe,0x7e,0xff));registers.forEach(([r,v])=>c.writeRegister(r,v));}
    assert.deepEqual(engine.processFrames(17),b.generateStereo(17));
    engine.setPcmMuted(true);assert.equal(peak(engine.processFrames(101).left),0);b.generateStereo(101);
    engine.setPcmMuted(false);assert.deepEqual(engine.processFrames(333),b.generateStereo(333));
  }finally{engine.dispose();b.dispose();}
});

test('Unsupported RF5 DAC streams do not get routed to YM2612',()=>{
  const p=new Ym2612VGM(vgm([...block(2,[1,2]),0x90,0,0x10,0,0x2a,0x91,0,2,1,0,
    0x92,0,...u32(44100),0x93,0,...u32(0),1,...u32(2),...wait(4),0x66]),{logger:null});
  const writes=[];const target={ym2612:{writeRegister:(...a)=>writes.push(a)}};
  for(let e=p.playStep(target);e.type!=='end';e=p.playStep(target)) if(e.type==='wait')p.consumeWait(target,e.samples,()=>{});
  assert.deepEqual(writes,[]);
});
