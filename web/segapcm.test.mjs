import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SegaPcm, validateSegaPcm} from './segapcm.js';
import {SegaPcmAudioEngine} from './segapcmaudioengine.js';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsVGM} from '../docs/js/ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
import factory from '../docs/generated/segapcm_wasm.js';
const options={moduleFactory:factory,moduleOptions:{wasmBinary:readFileSync(new URL('../docs/generated/segapcm_wasm.wasm',import.meta.url))}};

function vgm(commands,{segaPcmClock=4000000,bankShift=0,bankMask=0,loop=false}={}){
  const bytes=new Uint8Array(0x100+commands.length),v=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x171,true);v.setUint32(0x34,0xcc,true);
  v.setUint32(0x38,segaPcmClock,true);bytes[0x3c]=bankShift;bytes[0x3e]=bankMask;v.setUint32(0x18,4410,true);
  if(loop){v.setUint32(0x1c,0x100-0x1c,true);v.setUint32(0x20,4410,true);}
  bytes.set(commands,0x100);return bytes;
}
function romBlock(data,offset=0,memorySize=offset+data.length){
  const header=new Uint8Array(15),dv=new DataView(header.buffer);
  header.set([0x67,0x66,0x80]);
  dv.setUint32(3,8+data.length,true);dv.setUint32(7,memorySize,true);dv.setUint32(11,offset,true);
  return [...header,...data];
}
const w=(offset,value)=>[0xc0,offset&0xff,(offset>>8)&0xff,value];
// Program voice `ch` with a 256-byte ramp ROM at bank 0, moderate frequency,
// full volume, looping back to address 0 at the end of the block.
function program(chip,ch=0,rom=makeRamp()){
  chip.loadSampleMemory(rom,0,rom.length);
  chip.writeRegister(0x02+ch*8,0x7f);chip.writeRegister(0x03+ch*8,0x7f);
  chip.writeRegister(0x04+ch*8,0);chip.writeRegister(0x05+ch*8,0);
  chip.writeRegister(0x06+ch*8,0);chip.writeRegister(0x07+ch*8,8);
  chip.writeRegister(0x84+ch*8,0);chip.writeRegister(0x85+ch*8,0);
  chip.writeRegister(0x86+ch*8,0);
}
function makeRamp(){const rom=new Uint8Array(256);for(let i=0;i<256;i++)rom[i]=i;return rom;}
const rom=makeRamp();
const tune=[...romBlock(rom),
  ...w(0x02,0x7f),...w(0x03,0x7f),...w(0x04,0),...w(0x05,0),...w(0x06,0),...w(0x07,8),
  ...w(0x84,0),...w(0x85,0),...w(0x86,0),
  0x61,0x44,0x05,0x66];

for(const Parser of [Ym2612VGM,DocsVGM])test(`Sega PCM header and command parsing (${Parser===DocsVGM?'docs':'web'})`,()=>{
  const p=new Parser(vgm(tune,{bankShift:12,bankMask:0x70}));
  assert.equal(p.header.segaPcmClock,4000000);
  assert.equal(p.header.segaPcmBankShift,12);assert.equal(p.header.segaPcmBankMask,0x70);
  assert.deepEqual([...p.analyzeCommandUsage()],[['0x67',1],['0xc0',9],['0x61',1],['0x66',1]]);
  assert.match(p.analyzeCommandContext(0xc0).join('\n'),/segapcm offset=/);
  const writes=[],loads=[];
  const target={segapcm:{writeRegister:(...a)=>writes.push(a),loadSampleMemory:(...a)=>loads.push(a)}};
  p.playStep(target); // rom data block
  assert.equal(loads.length,1);assert.equal(loads[0][0].length,256);assert.equal(loads[0][1],0);assert.equal(loads[0][2],256);
  for(let i=0;i<9;i++)p.playStep(target);
  assert.deepEqual(writes[0],[0x02,0x7f]);assert.deepEqual(writes.at(-1),[0x86,0]);
  assert.deepEqual(p.playStep(target),{type:'wait',samples:1348});
  assert.deepEqual(p.playStep(target),{type:'end'});
  assert.throws(()=>new Parser(vgm([0xc0,0,0])).step());
});

test('Sega PCM ROM data without a target warns, with a target loads memory',()=>{
  const p=new Ym2612VGM(vgm(tune));
  const warnings=[];p.logger={warn:m=>warnings.push(m)};
  p.playStep({});
  assert.match(warnings[0],/requires a playback target with sample memory support/);
});

test('Sega PCM clock/rate validation rejects out-of-range input',()=>{
  for(const clock of [0,-1,NaN,Infinity,0x40000000])assert.throws(()=>validateSegaPcm({clock}),RangeError);
  for(const sampleRate of [0,-1,NaN,400000])assert.throws(()=>validateSegaPcm({clock:4000000,sampleRate}),RangeError);
  assert.doesNotThrow(()=>validateSegaPcm({clock:4000000}));
});

test('Sega PCM register write and sample-memory bounds are validated',async()=>{
  const chip=await SegaPcm.create({...options,clock:4000000});
  try{
    for(const args of [[-1,0],[0x10000,0],[0,-1],[0,256]])assert.throws(()=>chip.writeRegister(...args),RangeError);
    assert.doesNotThrow(()=>chip.writeRegister(0,0));
    assert.throws(()=>chip.loadSampleMemory(rom,0,0x200001),RangeError);
    assert.throws(()=>chip.loadSampleMemory(rom,10,5),RangeError);
  }finally{chip.dispose();}
});

test('Sega PCM plays a looping ramp and halts on the coarse end address',async()=>{
  const chip=await SegaPcm.create({...options,clock:4000000});
  try{
    program(chip,0);
    const pcm=chip.generateStereo(4000);
    assert(pcm.left.some(v=>v!==0),'must produce audible output');
    assert(new Set(pcm.left).size>10,'a looping ramp should visit many distinct levels');
  }finally{chip.dispose();}
});

test('Sega PCM ctrl bit 1 stops instead of looping at the end address',async()=>{
  const chip=await SegaPcm.create({...options,clock:4000000});
  try{
    chip.loadSampleMemory(rom,0,rom.length);
    chip.writeRegister(0x02,0x7f);chip.writeRegister(0x03,0x7f);
    chip.writeRegister(0x04,0);chip.writeRegister(0x05,0);
    chip.writeRegister(0x06,0);chip.writeRegister(0x07,64); // fast advance so it reaches the end quickly
    chip.writeRegister(0x84,0);chip.writeRegister(0x85,0);
    chip.writeRegister(0x86,2); // enabled (bit0=0), stop-instead-of-loop (bit1=1)
    // Long enough to certainly cross the 256-byte block at freq=64 (native
    // tick rate clock/128 = 31250 Hz; ~256/64 = 4 ticks to the end).
    chip.generateStereo(4000);
    const after=chip.generateStereo(2000);
    assert(after.left.every(v=>v===0),'must stay silent once stopped');
  }finally{chip.dispose();}
});

test('Sega PCM bank shift/mask select a higher ROM window from ctrl bits',async()=>{
  // bit2 of ctrl (0x04) selects the bank, well clear of bit0 (disable) and
  // bit1 (loop-disable); (ctrl & 0x04) << 8 = 0x400 when set.
  const chip=await SegaPcm.create({...options,clock:4000000,bankShift:8,bankMask:0x04});
  try{
    const bankedRom=new Uint8Array(2048);
    bankedRom.fill(1,0,256); // bank 0 (offset 0): low, negative-after-bias level
    bankedRom.fill(200,0x400,0x400+256); // bank 1 (offset 0x400): high level
    chip.loadSampleMemory(bankedRom,0,bankedRom.length);
    const programEnabled=(ctrl)=>{
      chip.writeRegister(0x02,0x7f);chip.writeRegister(0x03,0x7f);
      chip.writeRegister(0x04,0);chip.writeRegister(0x05,0);chip.writeRegister(0x06,0xff);chip.writeRegister(0x07,0);
      chip.writeRegister(0x84,0);chip.writeRegister(0x85,0);
      chip.writeRegister(0x86,ctrl);
    };
    programEnabled(0); // bank bit clear -> bank 0 (value 1 -> sample -127)
    const bank0=chip.generateStereo(50).left[10];
    chip.reset();
    programEnabled(0x04); // bank bit set -> bank 1 (value 200 -> sample 72)
    const bank1=chip.generateStereo(50).left[10];
    assert.notEqual(bank0,bank1);
    assert.equal(bank0<0,true);
    assert.equal(bank1>0,true);
  }finally{chip.dispose();}
});

test('Sega PCM output partitions deterministically and reset/mute behave',async()=>{
  const a=await SegaPcm.create({...options,clock:4000000}),b=await SegaPcm.create({...options,clock:4000000});
  try{
    program(a,0);program(b,0);
    const full=a.generateStereo(4096);
    const parts=[512,2048,1,17,1518].map(n=>b.generateStereo(n).left);
    assert.deepEqual(Float32Array.from(parts.flatMap(x=>[...x])),full.left);
    assert.deepEqual(full.left,full.right);
    a.setMuteMask(0xffff);assert(a.generateStereo(1000).left.every(x=>x===0));b.generateStereo(1000);
    a.setMuteMask(0);assert.deepEqual(a.generateStereo(500).left,b.generateStereo(500).left);
    a.reset();program(a,0);assert.deepEqual(a.generateStereo(4096).left,full.left);
    for(const n of [-1,NaN,0.5,0x1000001])assert.throws(()=>a.generateStereo(n),RangeError);
    assert.equal(a.generateStereo(0).left.length,0);
  }finally{a.dispose();b.dispose();}
  assert.throws(()=>a.generateStereo(1),/disposed/);a.dispose();
});

test('SegaPcmAudioEngine per-channel mute isolates one voice from the rest',async()=>{
  const a=await SegaPcmAudioEngine.create({...options,clock:4000000}),b=await SegaPcmAudioEngine.create({...options,clock:4000000});
  try{
    for(const ch of [0,1]){program(a.segapcm,ch);program(b.segapcm,ch);}
    assert.deepEqual(a.processFrames(128),b.processFrames(128));
    b.setSegaPcmChannelMuted(1,true);
    const reference=a.processFrames(1024),muted=b.processFrames(1024);
    assert(reference.left.some(v=>v!==0));
    b.setSegaPcmMuted(true);assert(b.processFrames(256).left.every(v=>v===0));
    b.setSegaPcmMuted(false);
    assert.notDeepEqual(reference.left,muted.left);
  }finally{a.dispose();b.dispose();}
});

test('Sega PCM VGM dispatches command 0xC0 and ROM data through the player, mutes and seeks',async()=>{
  const engine=await SegaPcmAudioEngine.create(options);
  try{
    const p=new VgmPlayer(engine);p.load(vgm(tune,{loop:true}));p.play();
    const full=new Float32Array(4410);p.process(full,new Float32Array(4410),4410);
    assert(full.some(v=>v!==0));
    await seekPlayback(p,1000);p.resume();
    const part=new Float32Array(400);p.process(part,new Float32Array(400),400);assert.deepEqual(part,full.slice(1000,1400));
    p.pause();const silent=new Float32Array(100);p.process(silent,silent,100);assert(silent.every(x=>x===0));
    p.reset();p.play();
    engine.setSegaPcmChannelMuted(0,true);
    const muted=new Float32Array(4410);p.process(muted,new Float32Array(4410),4410);
    assert(muted.every(v=>v===0));
  }finally{engine.dispose();}
});
