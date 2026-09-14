import test from 'node:test';
import assert from 'node:assert/strict';
import {VgmPlayer} from './vgmplayer.js';
import {VgmPlayer as DocsPlayer} from '../docs/js/vgmplayer.js';
import {vgmBytes} from './test-support/vgm-mock.js';
import {MockSoundEngine,drainPlayer} from './test-support/vgm-engine-mock.js';
import {registerCases} from './test-support/vgm-register-cases.js';
const entry=(chip,method,args,frame=0)=>({frame,chip,instance:0,method,args});
for(const [label,Player] of [['web',VgmPlayer],['docs',DocsPlayer]]) {
 test(`${label}: all 20 register formats and PSG pass real Player adapters`,()=>{
   for(const [chip,bytes,port,address,value] of registerCases) {
     const engine=new MockSoundEngine(),player=new Player(engine);
     player.load(vgmBytes([...bytes,0x50,0x9f,0x66]));player.play();drainPlayer(player);
     assert.deepEqual(engine.trace,[entry(chip,'register',[port,address,value]),entry('psg','write',[0x9f])]);
   }
 });
 test(`${label}: memory load routing, reset reload and track change clearing`,()=>{
   for(const [type,chip,args] of [[0x88,'samples',[4,16,[18,52]]],[0x84,'samples',[4,16,[18,52]]],
     [0x87,'samples',[4,16,[18,52]]],[0x81,'ym2608',[4,16,[18,52]]],
     [0x82,'ym2610',[0,4,16,[18,52]]],[0x83,'ym2610',[1,4,16,[18,52]]]]) {
     const engine=new MockSoundEngine(),player=new Player(engine);
     const bytes=vgmBytes([0x67,0x66,type,10,0,0,0,16,0,0,0,4,0,0,0,18,52,0x66]);
     player.load(bytes);player.play();drainPlayer(player);
     assert.deepEqual(engine.trace,[entry(chip,'load',args)]);
     player.reset();player.play();drainPlayer(player);assert.deepEqual(engine.trace,[entry(chip,'load',args)]);
     engine.lifecycle.length=0;player.load(vgmBytes([0x66]));
     assert.deepEqual(engine.lifecycle,['samples','ym2608','ym2610','rf5c164'].map(c=>entry(c,'clear',[])));
   }
   const engine=new MockSoundEngine(),player=new Player(engine);
   player.load(vgmBytes([0x67,0x66,0xc1,4,0,0,0,4,0,18,52,0xc2,6,0,86,0x66]));
   player.play();drainPlayer(player);
   assert.deepEqual(engine.trace,[entry('rf5c164','load',[4,[18,52]]),entry('rf5c164','memory-write',[6,86])]);
 });
 test(`${label}: registered MSX targets receive writes and ADPCM without legacy fallback`,()=>{
   const engine=new MockSoundEngine(), player=new Player(engine),resolved=[];
   engine.getVgmTarget=(chip,index)=>{
     assert.equal(index,0,'unregistered instance');resolved.push([chip,index]);
     return {writeRegister:(r,v,p)=>engine.record(chip,'register',[p,r,v]),
       loadSampleMemory:(data,offset,size)=>engine.record(chip,'load',[offset,size,[...data]])};
   };
   for(const method of ['writeAy8910','writeYm2413','writeY8950']) engine[method]=()=>assert.fail('legacy fallback');
   player.load(vgmBytes([0xa0,8,15,0x51,0x20,0x17,0x5c,7,0xb0,
     0x67,0x66,0x88,9,0,0,0,16,0,0,0,4,0,0,0,18,0x66]));
   player.play();drainPlayer(player);
   assert.deepEqual(resolved,[['ay8910',0],['ym2413',0],['y8950',0],['y8950',0]]);
   assert.deepEqual(engine.trace,[entry('ay8910','register',[0,8,15]),entry('ym2413','register',[0,0x20,0x17]),
     entry('y8950','register',[0,7,0xb0]),entry('y8950','load',[4,16,[18]])]);
   player.load(vgmBytes([0xa1,0x20,0x17,0x66]));player.play();
   assert.throws(()=>drainPlayer(player),/unregistered instance/);
 });
}
for(const [label,Player] of [['web',VgmPlayer],['docs',DocsPlayer]]) {
 test(`${label}: distinguishable stereo frames survive split output and padding`,()=>{
   for(const size of [1,3,8]) {
     const engine=new MockSoundEngine();
     engine.processFrames=n=>{const start=engine.frames;engine.frames+=n;
       return {left:Float32Array.from({length:n},(_,i)=>start+i+1),right:Float32Array.from({length:n},(_,i)=>-(start+i+1))};};
     const player=new Player(engine);player.load(vgmBytes([0x71,0x72,0x66]));player.play();
     const left=[],right=[];
     for(let n=0;n<8;n++) {const l=new Float32Array(size),r=new Float32Array(size);player.process(l,r,size);left.push(...l);right.push(...r);}
     assert.deepEqual(left.slice(0,5),[1,2,3,4,5]);assert.deepEqual(right.slice(0,5),[-1,-2,-3,-4,-5]);
     assert.ok(left.slice(5).every(v=>v===0)&&right.slice(5).every(v=>v===0));
   }
 });
}
