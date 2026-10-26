import test from 'node:test';
import assert from 'node:assert/strict';
import {Ym2612VGM} from './ym2612vgm.js';
import {VgmPlayer,createVgmTargets} from './vgmplayer.js';
import {vgmBytes} from './test-support/vgm-mock.js';

test('WonderSwan clock respects version and actual header boundary',()=>{
  const bytes=vgmBytes([0x66]),view=new DataView(bytes.buffer);view.setUint32(0xc0,0x402ee000,true);
  assert.equal(new Ym2612VGM(bytes).header.wonderswanClock,0x402ee000);
  view.setUint32(8,0x170,true);assert.equal(new Ym2612VGM(bytes).header.wonderswanClock,0);
  view.setUint32(8,0x171,true);view.setUint32(0x34,12,true);
  assert.equal(new Ym2612VGM(bytes).header.wonderswanClock,0,'command bytes must not become clock bytes');
});
test('WonderSwan BC relative registers and C6 big-endian RAM independently route both chip indices',()=>{
  const parser=new Ym2612VGM(vgmBytes([0xbc,9,0x45,0xbc,0x90,2,0xc6,0x12,0x34,0xa5,0xc6,0xbf,0xff,0x5a,0x66]));
  const trace=[],targets={resolveChip:(kind,index)=>{
    assert.equal(kind,'wonderswan');return {writeRegister:(...args)=>trace.push([index,'register',...args]),writeMemory:(...args)=>trace.push([index,'memory',...args])};
  }};
  while(!parser.ended)parser.playStep(targets);
  assert.deepEqual(trace,[[0,'register',9,0x45],[1,'register',0x10,2],[0,'memory',0x1234,0xa5],[1,'memory',0x3fff,0x5a]]);
  assert.match(parser.describeCommandAt(256),/wonderswan.*chip=0.*register=0x09/);
  assert.match(parser.describeCommandAt(262),/offset=0x1234/);
});
test('WonderSwan truncation, out-of-core RAM and missing second target fail without partial writes',()=>{
  for(const command of [[0xbc,9,1],[0xc6,0x12,0x34,1]])for(let n=1;n<command.length;n++){
    const p=new Ym2612VGM(vgmBytes(command.slice(0,n)));
    assert.throws(()=>p.playStep({wonderswan:{writeRegister:()=>assert.fail(),writeMemory:()=>assert.fail()}}),/Unexpected end/);
    assert.equal(p.position,256);
  }
  assert.throws(()=>new Ym2612VGM(vgmBytes([0xc6,0x40,0,1])).step(),/16 KiB/);
  assert.throws(()=>new Ym2612VGM(vgmBytes([0xbc,0x80,1])).playStep({wonderswan:{writeRegister:()=>assert.fail()}}),/Second WonderSwan/);
  assert.throws(()=>new Ym2612VGM(vgmBytes([0xbc,0,1])).playStep({}),/playback target/);
});
function streamCommands(type=0x21,flags=0) {
  // WonderSwan has no dedicated VGM1.71 RAM block; generic stream bank0x0a
  // carries PCM bytes to relative register9 (I/O0x89).
  return [0x67,0x66,0x0a,4,0,0,0,0x11,0x22,0x33,0x44,
    0x90,0,type,0,9,0x91,0,0x0a,1,0,0x92,0,0x22,0x56,0,0,
    0x95,0,0,0,flags,0x61,8,0,0x66];
}
test('WonderSwan PCM streams preserve start/period/reverse timing across wait partitions and snapshots',()=>{
  for(const index of [0,1])for(const flags of [0,0x10])for(const partition of [1,3,8]){
    const parser=new Ym2612VGM(vgmBytes(streamCommands(0x21|(index<<7),flags))),trace=[];let sample=0;
    const targets={resolveChip:(kind,chip)=>{assert.equal(kind,'wonderswan');assert.equal(chip,index);return {writeRegister:(...args)=>trace.push([sample,...args])};}};
    while(!parser.ended){const event=parser.playStep(targets);if(event.type==='wait')for(let left=event.samples;left>0;){const n=Math.min(left,partition);parser.consumeWait(targets,n,elapsed=>sample+=elapsed);left-=n;}}
    const values=flags?[0x44,0x33,0x22,0x11]:[0x11,0x22,0x33,0x44];
    assert.deepEqual(trace,values.map((value,i)=>[i*2,9,value]));
    const state=parser.savePlaybackState();parser.reset();parser.loadPlaybackState(state);assert.equal(parser.ended,true);
  }
});
test('WonderSwan unknown data block type remains skipped and cannot overwrite RAM',()=>{
  const parser=new Ym2612VGM(vgmBytes([0x67,0x66,0xc3,3,0,0,0,0,0,99,0xbc,0x10,1,0x66]));
  assert.deepEqual(parser.step(),{type:'wonderswan-write',register:0x10,value:1,chipIndex:0});
});
test('VgmPlayer exposes the WonderSwan engine target and routes direct/stream commands',()=>{
  const trace=[];let frame=0;
  const engine={sampleRate:()=>44100,clearWonderSwanMemory:()=>trace.push(['clear']),reset:()=>{frame=0;},
    writeWonderSwan:(...args)=>trace.push([frame,'register',...args]),writeWonderSwanMemory:(...args)=>trace.push([frame,'memory',...args]),
    loadWonderSwanMemory:(...args)=>trace.push(['load',...args]),processFrames:n=>{frame+=n;return {left:new Float32Array(n),right:new Float32Array(n)};}};
  assert.equal(typeof createVgmTargets(engine).wonderswan.writeRegister,'function');
  const player=new VgmPlayer(engine);player.load(vgmBytes([0xc6,0x12,0x34,0x99,...streamCommands()]));player.play();
  for(let n=0;player.playing&&n<20;n++)player.process(new Float32Array(3),new Float32Array(3),3);
  assert.deepEqual(trace,[['clear'],[0,'memory',0x1234,0x99],[0,'register',9,0x11],[2,'register',9,0x22],[4,'register',9,0x33],[6,'register',9,0x44]]);
});
