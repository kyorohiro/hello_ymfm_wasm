import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GameboyApu, validateGameboyApu} from './gameboyapu.js';
import {GameboyApuAudioEngine} from './gameboyapuaudioengine.js';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsVGM} from '../docs/js/ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
import factory from '../docs/generated/gameboy_apu_wasm.js';
const options={moduleFactory:factory,moduleOptions:{wasmBinary:readFileSync(new URL('../docs/generated/gameboy_apu_wasm.wasm',import.meta.url))}};
const CLOCK = 4194304;

function vgm(commands,{gameBoyDmgClock=CLOCK,loop=false}={}){
  const bytes=new Uint8Array(0x100+commands.length),v=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x171,true);v.setUint32(0x34,0xcc,true);
  v.setUint32(0x80,gameBoyDmgClock,true);v.setUint32(0x18,4410,true);
  if(loop){v.setUint32(0x1c,0x100-0x1c,true);v.setUint32(0x20,4410,true);}
  bytes.set(commands,0x100);return bytes;
}
const w=(register,value)=>[0xb3,register,value];

// Program square channel 1 (no sweep) with a fixed volume and no length limit.
function programSquare1(chip,freqReg=1750,duty=2,volume=15){
  chip.writeRegister(0x16,0x80); // NR52 power on (idempotent)
  chip.writeRegister(0x14,0x77); // NR50 master volume, both sides max
  chip.writeRegister(0x15,0x11); // NR51 pan CH1 both sides
  chip.writeRegister(0x00,0x00); // NR10 no sweep
  chip.writeRegister(0x01,(duty<<6));
  chip.writeRegister(0x02,(volume<<4)); // NR12: volume, direction=decrease, period=0 (constant)
  chip.writeRegister(0x03,freqReg&0xff);
  chip.writeRegister(0x04,0x80|((freqReg>>8)&7)); // trigger, length disabled
}
function estimateHz(samples,sampleRate){
  let crossings=0;
  for(let i=1;i<samples.length;i++) if((samples[i-1]<=0)!==(samples[i]<=0)) crossings++;
  return (crossings/2)*(sampleRate/samples.length);
}
const tune=[...programCommands()];
function programCommands(){
  const cmds=[];
  const push=(r,v)=>cmds.push(...w(r,v));
  push(0x16,0x80);push(0x14,0x77);push(0x15,0x11);push(0x00,0x00);push(0x01,2<<6);
  push(0x02,15<<4);push(0x03,1750&0xff);push(0x04,0x80|((1750>>8)&7));
  return cmds;
}

for(const Parser of [Ym2612VGM,DocsVGM])test(`Game Boy DMG header and command parsing (${Parser===DocsVGM?'docs':'web'})`,()=>{
  const commands=[...tune,0x61,0x44,0x05,0x66];
  const p=new Parser(vgm(commands));
  assert.equal(p.header.gameBoyDmgClock,CLOCK);
  assert.deepEqual([...p.analyzeCommandUsage()],[['0xb3',8],['0x61',1],['0x66',1]]);
  assert.match(p.analyzeCommandContext(0xb3).join('\n'),/gameboy-dmg register=/);
  const writes=[];const target={gameboyDmg:{writeRegister:(...a)=>writes.push(a)}};
  for(let i=0;i<8;i++)p.playStep(target);
  assert.deepEqual(writes[0],[0x16,0x80]);assert.deepEqual(writes.at(-1),[0x04,0x86]);
  assert.deepEqual(p.playStep(target),{type:'wait',samples:1348});
  assert.deepEqual(p.playStep(target),{type:'end'});
  assert.throws(()=>new Parser(vgm([0xb3,0x80,0,1,0x66])).playStep(target),/Second Game Boy APU/);
  assert.throws(()=>new Parser(vgm([0xb3,0])).step());
});

test('Game Boy DMG clock/rate validation rejects out-of-range input',()=>{
  for(const clock of [0,-1,NaN,Infinity,0x40000000])assert.throws(()=>validateGameboyApu({clock}),RangeError);
  for(const sampleRate of [0,-1,NaN,400000])assert.throws(()=>validateGameboyApu({clock:CLOCK,sampleRate}),RangeError);
  assert.doesNotThrow(()=>validateGameboyApu({clock:CLOCK}));
});

test('Game Boy DMG register write bounds are validated',async()=>{
  const chip=await GameboyApu.create({...options,clock:CLOCK});
  try{
    for(const args of [[-1,0],[256,0],[0,-1],[0,256],[0.5,0]])assert.throws(()=>chip.writeRegister(...args),RangeError);
    assert.doesNotThrow(()=>chip.writeRegister(0,0));
  }finally{chip.dispose();}
});

test('square channel 1 matches the documented Hz = 131072/(2048-x) formula',async()=>{
  const chip=await GameboyApu.create({...options,clock:CLOCK});
  try{
    programSquare1(chip,1750);
    const {left}=chip.generateStereo(4410);
    assert(left.some(v=>v!==0));
    const hz=estimateHz(left,44100);
    assert(Math.abs(hz-439.8)<10,`expected ~439.8Hz, got ${hz}`);
  }finally{chip.dispose();}
});

test('square channel 2 (no sweep) matches the same Hz formula',async()=>{
  const chip=await GameboyApu.create({...options,clock:CLOCK});
  try{
    chip.writeRegister(0x16,0x80);chip.writeRegister(0x14,0x77);chip.writeRegister(0x15,0x22); // pan CH2
    chip.writeRegister(0x06,2<<6);chip.writeRegister(0x07,15<<4);
    chip.writeRegister(0x08,900&0xff);chip.writeRegister(0x09,0x80|((900>>8)&7));
    const {left}=chip.generateStereo(4410);
    assert(left.some(v=>v!==0));
    const hz=estimateHz(left,44100);
    const expected=131072/(2048-900);
    assert(Math.abs(hz-expected)<expected*0.05,`expected ~${expected}Hz, got ${hz}`);
  }finally{chip.dispose();}
});

test('wave channel matches the documented Hz = 65536/(2048-x) formula and plays wave RAM',async()=>{
  const chip=await GameboyApu.create({...options,clock:CLOCK});
  try{
    chip.writeRegister(0x16,0x80);chip.writeRegister(0x14,0x77);chip.writeRegister(0x15,0x44); // pan CH3
    // Single up/down transition across the 32-nibble wave (first half high,
    // second half low), so zero-crossings measure the fundamental period
    // instead of an embedded sub-pattern ripple.
    for(let i=0;i<16;i++)chip.writeRegister(0x20+i,i<8?0xff:0x00);
    chip.writeRegister(0x0a,0x80); // NR30 DAC on
    chip.writeRegister(0x0c,0x20); // NR32 level = 1 (100%)
    const freqReg=1948;
    chip.writeRegister(0x0d,freqReg&0xff);chip.writeRegister(0x0e,0x80|((freqReg>>8)&7));
    const {left}=chip.generateStereo(4410);
    assert(left.some(v=>v!==0));
    const hz=estimateHz(left,44100);
    const expected=65536/(2048-freqReg);
    assert(Math.abs(hz-expected)<expected*0.15,`expected ~${expected}Hz, got ${hz}`);
  }finally{chip.dispose();}
});

test('noise channel sounds and short mode differs from long mode',async()=>{
  const long=await GameboyApu.create({...options,clock:CLOCK}), short=await GameboyApu.create({...options,clock:CLOCK});
  try{
    for(const [chip,shortMode] of [[long,0],[short,1]]){
      chip.writeRegister(0x16,0x80);chip.writeRegister(0x14,0x77);chip.writeRegister(0x15,0x88); // pan CH4
      chip.writeRegister(0x11,15<<4); // NR42 volume
      chip.writeRegister(0x12,(shortMode<<3)|1); // NR43: shift=0, width, divisor=16
      chip.writeRegister(0x13,0x80); // NR44 trigger
    }
    const a=long.generateStereo(2000),b=short.generateStereo(2000);
    assert(a.left.some(v=>v!==0));assert(b.left.some(v=>v!==0));
    assert.notDeepEqual([...a.left],[...b.left]);
  }finally{long.dispose();short.dispose();}
});

test('DAC-disabled channels stay silent even when triggered',async()=>{
  const chip=await GameboyApu.create({...options,clock:CLOCK});
  try{
    chip.writeRegister(0x16,0x80);chip.writeRegister(0x14,0x77);chip.writeRegister(0x15,0x11);
    chip.writeRegister(0x00,0x00);chip.writeRegister(0x01,2<<6);
    chip.writeRegister(0x02,0x00); // NR12: volume 0, direction decrease -> DAC disabled (reg&0xf8==0)
    chip.writeRegister(0x03,1750&0xff);chip.writeRegister(0x04,0x80|((1750>>8)&7));
    assert(chip.generateStereo(2000).left.every(v=>v===0));
  }finally{chip.dispose();}
});

test('length counter silences the channel after the programmed duration',async()=>{
  const chip=await GameboyApu.create({...options,clock:CLOCK});
  try{
    programSquare1(chip,1750);
    chip.writeRegister(0x01,(2<<6)|0x3e); // length = 0x3e -> 2 steps until (length&0x3f)==0
    chip.writeRegister(0x04,0xc0|((1750>>8)&7)); // trigger + length enabled
    // Frame sequencer clocks length every 8192 cycles at steps 0/2/4/6; two
    // clocks happen within roughly two 8192-cycle windows.
    const early=chip.generateStereo(100);
    assert(early.left.some(v=>v!==0),'must sound immediately after trigger');
    const framesFor3Steps=Math.ceil((44100*(3*8192))/CLOCK)+100;
    const later=chip.generateStereo(framesFor3Steps);
    assert(later.left.slice(-100).every(v=>v===0),'must be silent once length reaches zero');
  }finally{chip.dispose();}
});

test('sweep overflow (increase past 0x7FF) disables channel 1',async()=>{
  const chip=await GameboyApu.create({...options,clock:CLOCK});
  try{
    chip.writeRegister(0x16,0x80);chip.writeRegister(0x14,0x77);chip.writeRegister(0x15,0x11);
    chip.writeRegister(0x00,0x13); // NR10: time=1 (fastest), direction=increase, shift=3
    chip.writeRegister(0x01,2<<6);
    chip.writeRegister(0x02,15<<4);
    const startFreq=1800; // first overflow check on trigger (1800+225=2025) stays on; a real tick then overflows
    chip.writeRegister(0x03,startFreq&0xff);
    chip.writeRegister(0x04,0x80|((startFreq>>8)&7));
    assert(chip.generateStereo(200).left.some(v=>v!==0),'must sound right after trigger');
    // Sweep ticks at 128 Hz (every 4 frame-sequencer steps = 32768 cycles);
    // run well past the first couple of ticks.
    const framesForSweepTicks=Math.ceil((44100*(3*32768))/CLOCK);
    chip.generateStereo(framesForSweepTicks);
    assert(chip.generateStereo(200).left.every(v=>v===0),'sweep overflow must silence the channel');
  }finally{chip.dispose();}
});

test('NR51 panning and NR50 master volume scale left/right independently',async()=>{
  const chip=await GameboyApu.create({...options,clock:CLOCK});
  try{
    chip.writeRegister(0x16,0x80);
    chip.writeRegister(0x15,0x01); // CH1 right only
    chip.writeRegister(0x14,0x07); // left vol 0(+1), right vol 7(+1) -> right louder
    chip.writeRegister(0x00,0x00);chip.writeRegister(0x01,2<<6);chip.writeRegister(0x02,15<<4);
    chip.writeRegister(0x03,1750&0xff);chip.writeRegister(0x04,0x80|((1750>>8)&7));
    const {left,right}=chip.generateStereo(2000);
    assert(left.every(v=>v===0),'panned away from left');
    assert(right.some(v=>v!==0));
  }finally{chip.dispose();}
});

test('Game Boy DMG output partitions deterministically and reset/mute behave',async()=>{
  const a=await GameboyApu.create({...options,clock:CLOCK}),b=await GameboyApu.create({...options,clock:CLOCK});
  try{
    programSquare1(a);programSquare1(b);
    const full=a.generateStereo(4096);
    const parts=[512,2048,1,17,1518].map(n=>b.generateStereo(n).left);
    assert.deepEqual(Float32Array.from(parts.flatMap(x=>[...x])),full.left);
    assert.deepEqual(full.left,full.right);
    a.setMuteMask(0xf);assert(a.generateStereo(1000).left.every(x=>x===0));b.generateStereo(1000);
    a.setMuteMask(0);assert.deepEqual(a.generateStereo(500).left,b.generateStereo(500).left);
    a.reset();programSquare1(a);assert.deepEqual(a.generateStereo(4096).left,full.left);
    for(const n of [-1,NaN,0.5,0x1000001])assert.throws(()=>a.generateStereo(n),RangeError);
    assert.equal(a.generateStereo(0).left.length,0);
  }finally{a.dispose();b.dispose();}
  assert.throws(()=>a.generateStereo(1),/disposed/);a.dispose();
});

test('GameboyApuAudioEngine per-channel mute isolates one channel from the rest',async()=>{
  const a=await GameboyApuAudioEngine.create({...options,clock:CLOCK}),b=await GameboyApuAudioEngine.create({...options,clock:CLOCK});
  try{
    for(const engine of [a,b]){
      programSquare1(engine.gameboy,1750);
      engine.gameboy.writeRegister(0x15,0x33); // also route CH2 both sides
      engine.gameboy.writeRegister(0x06,2<<6);engine.gameboy.writeRegister(0x07,15<<4);
      engine.gameboy.writeRegister(0x08,900&0xff);engine.gameboy.writeRegister(0x09,0x80|((900>>8)&7));
    }
    assert.deepEqual(a.processFrames(128),b.processFrames(128));
    b.setGameboyApuChannelMuted(1,true);
    const reference=a.processFrames(1024),muted=b.processFrames(1024);
    assert(reference.left.some(v=>v!==0));
    b.setGameboyApuMuted(true);assert(b.processFrames(256).left.every(v=>v===0));
    b.setGameboyApuMuted(false);
    assert.notDeepEqual(reference.left,muted.left);
  }finally{a.dispose();b.dispose();}
});

test('Game Boy DMG VGM dispatches command 0xB3 through the player, mutes and seeks',async()=>{
  const engine=await GameboyApuAudioEngine.create(options);
  try{
    const commands=[...tune,0x61,0x44,0x05,0x66];
    const p=new VgmPlayer(engine);p.load(vgm(commands,{loop:true}));p.play();
    const full=new Float32Array(4410);p.process(full,new Float32Array(4410),4410);
    assert(full.some(v=>v!==0));
    await seekPlayback(p,1000);p.resume();
    const part=new Float32Array(400);p.process(part,new Float32Array(400),400);assert.deepEqual(part,full.slice(1000,1400));
    p.pause();const silent=new Float32Array(100);p.process(silent,silent,100);assert(silent.every(x=>x===0));
    p.reset();p.play();
    engine.setGameboyApuChannelMuted(0,true);
    const muted=new Float32Array(4410);p.process(muted,new Float32Array(4410),4410);
    assert(muted.every(v=>v===0));
  }finally{engine.dispose();}
});
