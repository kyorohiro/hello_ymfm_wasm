import test from 'node:test';
import assert from 'node:assert/strict';
import {Ym2612VGM} from './ym2612vgm.js';
import {VgmPlayer, createVgmTargets} from './vgmplayer.js';
import {vgmBytes} from './test-support/vgm-mock.js';
import {createPokeyVgm} from '../test/helpers/pokey_vgm_fixture.mjs';

function pokeyBytes(commands, {dual=false, clock=1789790}={}) {
  const bytes=vgmBytes(commands);
  new DataView(bytes.buffer).setUint32(0xb0, (clock|(dual?0x40000000:0))>>>0, true);
  return bytes;
}

test('POKEY header retains dual flag and obeys VGM1.61 and full clock-field boundaries',()=>{
  const bytes=pokeyBytes([0x66],{dual:true}), view=new DataView(bytes.buffer);
  assert.equal(new Ym2612VGM(bytes).header.pokeyClock,0x40000000|1789790);
  view.setUint32(8,0x161,true);
  assert.equal(new Ym2612VGM(bytes).header.pokeyClock,0x40000000|1789790);
  view.setUint32(8,0x160,true);
  assert.equal(new Ym2612VGM(bytes).header.pokeyClock,0);
  view.setUint32(8,0x161,true);view.setUint32(0x34,0xb4-0x34,true);
  assert.equal(new Ym2612VGM(bytes).header.pokeyClock,0x40000000|1789790);
  view.setUint32(0x34,0xb3-0x34,true);
  assert.equal(new Ym2612VGM(bytes).header.pokeyClock,0,'partial clock bytes belong to commands');
  view.setUint32(0x34,12,true);
  assert.equal(new Ym2612VGM(bytes).header.pokeyClock,0,'short headers cannot claim command bytes as clocks');
});

for(const dual of [false,true])test(`original synthetic ${dual?'dual':'single'} fixture addresses only declared POKEYs`,()=>{
  const bytes=createPokeyVgm({dual,chip:dual?1:0,channel:3,clock:1789773,seconds:0.02,loop:false});
  const parser=new Ym2612VGM(bytes), registers=[new Uint8Array(16),new Uint8Array(16)];
  const indices=new Set();
  while(!parser.ended)parser.playStep({resolveChip:(kind,index)=>{
    assert.equal(kind,'pokey');assert.ok(index<(dual?2:1));indices.add(index);
    return {writeRegister:(r,v)=>registers[index][r]=v};
  }});
  assert.deepEqual([...indices],dual?[0,1]:[0]);
  assert.equal(parser.header.pokeyClock&0x3fffffff,1789773);
  assert.equal(Boolean(parser.header.pokeyClock&0x40000000),dual);
  assert.equal(registers[dual?1:0][7],0xac);
  assert.equal(registers[0][1],0xa0);
});

test('BB routes chip-select separately and describes the unmodified seven-bit register',()=>{
  const parser=new Ym2612VGM(pokeyBytes([0xbb,0x01,0xac,0xbb,0x8f,3,0xbb,0x7f,0x5a,0x66],{dual:true}));
  const trace=[], targets={resolveChip:(kind,index)=>{
    assert.equal(kind,'pokey');return {writeRegister:(...args)=>trace.push([index,...args])};
  },ym2612:{writeRegister:()=>assert.fail('POKEY must not write FM')}};
  assert.deepEqual(parser.playStep(targets),{type:'pokey-write',register:1,value:0xac,chipIndex:0});
  while(!parser.ended)parser.playStep(targets);
  assert.deepEqual(trace,[[0,1,0xac],[1,15,3],[0,0x7f,0x5a]]);
  assert.match(parser.describeCommandAt(0x100),/cmd=0xbb pokey chip=0 register=0x01 value=0xac/);
  assert.match(parser.describeCommandAt(0x103),/chip=1 register=0x0f value=0x03/);
});

test('POKEY refuses missing or aliased second playback targets and truncated commands are atomic',()=>{
  for(const command of [[0xbb],[0xbb,1]]){
    const parser=new Ym2612VGM(pokeyBytes(command));
    assert.throws(()=>parser.playStep({pokey:{writeRegister:()=>assert.fail()}}),/Unexpected end/);
    assert.equal(parser.position,0x100);
    assert.throws(()=>parser.describeCommandAt(0x100),/Truncated command/);
  }
  const writes=[];
  new Ym2612VGM(pokeyBytes([0xbb,1,2])).playStep({pokey:{writeRegister:(...v)=>writes.push(v)}});
  assert.deepEqual(writes,[[1,2]]);
  assert.throws(()=>new Ym2612VGM(pokeyBytes([0xbb,0x81,2])).playStep({pokey:{writeRegister:()=>assert.fail()}}),/Second POKEY/);
  assert.throws(()=>new Ym2612VGM(pokeyBytes([0xbb,1,2])).playStep({}),/playback target/);
  assert.throws(()=>new Ym2612VGM(pokeyBytes([0xbb,1,2])).playStep({resolveChip:()=>undefined}),/playback target/);
});

// The standard generic data bank supplies one byte per POKEY register write.
// Setup's unused port byte is deliberately nonzero; it must not affect routing.
function streamCommands(index=0,flags=0) {
  return [0x67,0x66,0,4,0,0,0,0xa1,0xa2,0xa3,0xa4,
    0x90,0,0x1e|(index<<7),0x17,1,0x91,0,0,1,0,
    0x92,0,0x22,0x56,0,0,0x95,0,0,0,flags];
}
function driveParser(parser,partition=Infinity) {
  const trace=[];let sample=0;
  const targets={resolveChip:(kind,index)=>{
    assert.equal(kind,'pokey');return {writeRegister:(r,v)=>trace.push([sample,index,r,v])};
  }};
  for(let steps=0;!parser.ended;steps++){
    assert.ok(steps<100,'test command stream must terminate');
    const event=parser.playStep(targets);
    if(event.type==='wait')for(let left=event.samples;left>0;){
      const count=Math.min(left,partition);
      parser.consumeWait(targets,count,n=>sample+=n);left-=count;
    }
  }
  return trace;
}

test('POKEY DAC streams preserve first-write and period boundaries for either chip, reverse and wait partition',()=>{
  for(const index of [0,1])for(const flags of [0,0x10])for(const partition of [1,3,8]){
    const parser=new Ym2612VGM(pokeyBytes([...streamCommands(index,flags),0x61,8,0,0x66],{dual:index===1}));
    const expected=flags?[0xa4,0xa3,0xa2,0xa1]:[0xa1,0xa2,0xa3,0xa4];
    assert.deepEqual(driveParser(parser,partition),expected.map((v,i)=>[i*2,index,1,v]));
  }
});

test('POKEY looping stream stops at the recorded sample and never reaches another chip',()=>{
  const parser=new Ym2612VGM(pokeyBytes([...streamCommands(1,1),0x61,11,0,0x94,0,0x61,8,0,0x66],{dual:true}));
  assert.deepEqual(driveParser(parser,3),[0xa1,0xa2,0xa3,0xa4,0xa1,0xa2].map((v,i)=>[i*2,1,1,v]));
});

test('POKEY DAC stream parser snapshot preserves cursor, reverse flag and fractional phase',()=>{
  const parser=new Ym2612VGM(pokeyBytes([...streamCommands(1,0x10),0x61,8,0,0x66],{dual:true}));
  const trace=[];let sample=0;
  const targets={resolveChip:(kind,index)=>({writeRegister:(r,v)=>trace.push([sample,index,r,v])})};
  const wait=parser.playStep(targets);assert.equal(wait.type,'wait');
  parser.consumeWait(targets,3,n=>sample+=n);
  assert.deepEqual(trace,[[0,1,1,0xa4],[2,1,1,0xa3]]);
  const state=parser.savePlaybackState();trace.length=0;
  parser.consumeWait(targets,5,n=>sample+=n);
  const expected=structuredClone(trace);
  parser.reset();parser.loadPlaybackState(state);sample=3;trace.length=0;
  parser.consumeWait(targets,5,n=>sample+=n);
  assert.deepEqual(trace,expected);
  assert.deepEqual(trace,[[4,1,1,0xa2],[6,1,1,0xa1]]);
});

test('POKEY DAC streams require a second-instance target and do not fall through to YM2612',()=>{
  const parser=new Ym2612VGM(pokeyBytes([...streamCommands(1),0x70,0x66],{dual:true}));
  const targets={pokey:{writeRegister:()=>assert.fail()},ym2612:{writeRegister:()=>assert.fail()}};
  const wait=parser.playStep(targets);
  assert.throws(()=>parser.consumeWait(targets,wait.samples,()=>{}),/Second POKEY stream/);
});

function registerEngine(rate=44100) {
  const registers=[new Uint8Array(16),new Uint8Array(16)];
  let frame=0,resets=0;
  const trace=[];
  const write=(index,r,v)=>{registers[index][r]=v;trace.push([frame,index,r,v]);};
  return {trace,registers,get frame(){return frame;},get resets(){return resets;},
    sampleRate:()=>rate,reset:()=>{frame=0;resets++;for(const r of registers)r.fill(0);},
    getVgmTarget:(kind,index)=>{assert.equal(kind,'pokey');return {writeRegister:(r,v)=>write(index,r,v)};},
    writePokey:(r,v)=>write(0,r,v),
    processFrames:count=>{frame+=count;return {
      left:new Float32Array(count).fill(registers[0][1]&15),
      right:new Float32Array(count).fill(registers[1][1]&15),
    };},
    supportsState:()=>true,stateSettingsKey:()=>String(rate),
    saveState:()=>({byteLength:40,frame,registers:registers.map(r=>r.slice())}),
    validateState:state=>assert.equal(state.registers.length,2),
    loadState:state=>{frame=state.frame;state.registers.forEach((r,i)=>registers[i].set(r));},
  };
}
function render(player,frames) {
  const left=new Float32Array(frames),right=new Float32Array(frames);
  player.process(left,right,frames);return {left:[...left],right:[...right]};
}

test('VgmPlayer routes independent POKEYs at exact output boundaries and offers first-chip fallback',()=>{
  const engine=registerEngine(),player=new VgmPlayer(engine);
  const commands=[0xbb,1,0xa1,0xbb,0x81,0xa2,0x61,3,0,
    0xbb,1,0xa4,0x61,2,0,0xbb,0x81,0xa8,0x61,3,0,0x66];
  player.load(pokeyBytes(commands,{dual:true}));player.play();
  assert.deepEqual(render(player,8),{left:[1,1,1,4,4,4,4,4],right:[2,2,2,2,2,8,8,8]});
  assert.deepEqual(engine.trace,[[0,0,1,0xa1],[0,1,1,0xa2],[3,0,1,0xa4],[5,1,1,0xa8]]);
  assert.deepEqual(render(player,3),{left:[0,0,0],right:[0,0,0]});
  const fallback=[];
  const targets=createVgmTargets({writePokey:(...args)=>fallback.push(args)});
  targets.pokey.writeRegister(3,0xa7);assert.deepEqual(fallback,[[3,0xa7]]);
});

test('VgmPlayer POKEY stop/replay and saved checkpoints reproduce both chips and queued audio',()=>{
  const engine=registerEngine(),player=new VgmPlayer(engine);
  player.setPrefetchFactor(1);player.checkpointIntervalSeconds=3/44100;
  const bytes=pokeyBytes([...streamCommands(1,1),0xbb,1,0xa9,0x61,24,0,0x66],{dual:true});
  player.load(bytes);player.play();
  const head=render(player,3);
  const state=player.saveState();
  assert.equal(player.checkpointStats().count,1);
  const expected=render(player,9);
  assert.equal(player.restoreCheckpoint(5),3);
  assert.deepEqual(render(player,9),expected,'seek checkpoint restores queued POKEY output');
  player.loadState(state);
  assert.deepEqual(render(player,9),expected,'checkpoint restores separate chip registers and stream timing');
  player.stop();
  assert.equal(player.parser.position,0x100);assert.equal(player.parser.streams.size,0);
  assert.deepEqual(engine.registers.map(r=>[...r]),[Array(16).fill(0),Array(16).fill(0)]);
  assert.deepEqual(render(player,3),{left:[0,0,0],right:[0,0,0]});
  player.play();assert.deepEqual(render(player,3),head);
  assert.ok(engine.resets>0);
});

test('POKEY direct write timing rescales VGM waits independently of output block size',()=>{
  for(const rate of [44100,48000])for(const block of [1,3,8]){
    const engine=registerEngine(rate),player=new VgmPlayer(engine);
    player.load(pokeyBytes([0xbb,1,0xa1,0x61,0xb9,1,0xbb,0x81,0xa2,0x61,0xb9,1,0x66],{dual:true}));
    // Each 0x01b9 wait is441samples, exactly10ms at the VGM timeline rate.
    player.play();for(let n=0;n<2000&&(player.playing||player.queuedFrames);n++)render(player,block);
    assert.deepEqual(engine.trace,[[0,0,1,0xa1],[rate/100,1,1,0xa2]]);
    assert.equal(player.processedWaitSamples,882);
  }
});
