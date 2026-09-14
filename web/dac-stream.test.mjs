import test from 'node:test';
import assert from 'node:assert/strict';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsParser} from '../docs/js/ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {VgmPlayer as DocsPlayer} from '../docs/js/vgmplayer.js';
import {vgmBytes,mockChips} from './test-support/vgm-mock.js';
import {MockSoundEngine,drainPlayer} from './test-support/vgm-engine-mock.js';
// VGM 1.71 DAC Stream Control; explicit timing in 44100 Hz ticks.
// The msec mode follows dimensional time (frequency * msec / 1000),
// not libvgm's currently inverted calculation in daccontrol_start.
const u32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
const block=(bank,data)=>[0x67,0x66,bank,...u32(data.length),...data];
const setup=(id=0,bank=0,step=1,base=0,freq=22050)=>
  [0x90,id,2,0,0x2a,0x91,id,bank,step,base,0x92,id,...u32(freq)];
const start=(pos=0,mode=1,len=2,id=0)=>[0x93,id,...u32(pos),mode,...u32(len)];
const wait=n=>[0x61,n&255,n>>>8];
const cases=[
 ['step base and command count',[...block(0,[9,10,9,20,9,30]),...setup(0,0,2,1),...start(0,1,3),...wait(7),0x66],[[0,10],[2,20],[4,30]]],
 ['end mode',[...block(0,[10,20,30]),...setup(),...start(1,3,0),...wait(7),0x66],[[0,20],[2,30]]],
 ['millisecond mode',[...block(0,[10,20,30,40]),...setup(0,0,1,0,2000),...start(0,2,1),...wait(100),0x66],[[0,10],[23,20]]],
 ['reverse',[...block(0,[10,20,30]),...setup(),...start(0,0x11,3),...wait(7),0x66],[[0,30],[2,20],[4,10]]],
 ['keep length and start',[...block(0,[10,20,30]),...setup(),...start(1,1,2),...wait(5),...start(0xffffffff,0,999),...wait(5),0x66],[[0,20],[2,30],[5,20],[7,30]]],
 ['bank local fast loop reverse',[...block(1,[99]),...block(0,[10]),...block(0,[20,30]),...setup(),0x95,0,1,0,0x11,...wait(5),0x94,0,...wait(3),0x66],[[0,30],[2,20],[4,30]]],
 ['fast start followed by preserved bank position',[...block(0,[10]),...block(0,[20,30]),...setup(),0x95,0,1,0,0,...wait(5),...start(0xffffffff,0,0),...wait(5),0x66],[[0,20],[2,30],[5,20],[7,30]]],
 ['concatenated bank',[...block(0,[10]),...block(0,[20]),...setup(),...start(0,3,0),...wait(5),0x66],[[0,10],[2,20]]],
 ['zero commands',[...block(0,[10]),...setup(),...start(0,1,0),...wait(5),0x66],[]],
 ['reserved id',[...block(0,[10]),...setup(255),...start(0,1,1,255),...wait(5),0x66],[]],
 ['stop all',[...block(0,[10,20,30]),...setup(),...start(),...wait(1),0x94,255,...wait(5),0x66],[[0,10]]],
 ['frequency change retains fractional phase',[...block(0,[10,20,30]),...setup(),...start(0,1,3),...wait(1),0x92,0,...u32(11025),...wait(7),0x66],[[0,10],[3,20],[7,30]]],
];
for(const [label,Parser,Player] of [['web',Ym2612VGM,VgmPlayer],['docs',DocsParser,DocsPlayer]]) {
 for(const [name,commands,expected] of cases) test(`${label}: DAC ${name} through parser and player`,()=>{
   for(const partition of [1,3,128]) {
     const mock=mockChips(), parser=new Parser(vgmBytes(commands));
     const trace=expected.map(([sample,value])=>({sample,chip:'ym2612',instance:0,method:'register',args:[0,0x2a,value]}));
     mock.run(parser,{splitWait:partition}); assert.deepEqual(mock.trace,trace);
     parser.reset();mock.clear();mock.run(parser,{splitWait:partition});assert.deepEqual(mock.trace,trace);
     const engine=new MockSoundEngine(), player=new Player(engine);
     player.load(vgmBytes(commands));player.play();drainPlayer(player,partition);
     assert.deepEqual(engine.trace,trace.map(({sample,...entry})=>({frame:sample,...entry})));
   }
 });
}

// Playback operations use the Analyzer's actual seek helper, not a test reimplementation.
const {seekPlayback}=await import('../docs/vgm_analyzer/seek_playback.js');
for(const [label,Parser,Player] of [['web',Ym2612VGM,VgmPlayer],['docs',DocsParser,DocsPlayer]]) {
 test(`${label}: DAC seek preserves already-rendered queue and future writes`,async()=>{
   const bytes=vgmBytes([...block(0,[10,20,30,40]),...setup(),...start(0,1,4),...wait(5),
     0x52,0x22,8,...wait(5),0x66]);
   for(const position of [0,1,2,5,7]) {
     const engine=new MockSoundEngine(),player=new Player(engine);player.load(bytes);
     assert.equal(await seekPlayback(player,position),position);
     // Seek can generate ahead into the queue. Preserve that prefix separately.
     const prefix=engine.trace.slice();engine.trace.length=0;
     player.resume();drainPlayer(player,1);
     assert.deepEqual([...prefix,...engine.trace],[
       {frame:0,chip:'ym2612',instance:0,method:'register',args:[0,0x2a,10]},
       {frame:2,chip:'ym2612',instance:0,method:'register',args:[0,0x2a,20]},
       {frame:4,chip:'ym2612',instance:0,method:'register',args:[0,0x2a,30]},
       {frame:5,chip:'ym2612',instance:0,method:'register',args:[0,0x22,8]},
       {frame:6,chip:'ym2612',instance:0,method:'register',args:[0,0x2a,40]},
     ]);
   }
 });
 test(`${label}: stop, pause and reset while DAC is active`,()=>{
   const bytes=vgmBytes([...block(0,[10,20,30]),...setup(),...start(0,1,3),
     ...wait(1),...wait(7),0x66]);
   for(const action of ['pause','stop','reset']) {
     const engine=new MockSoundEngine(),player=new Player(engine);player.load(bytes);player.setPrefetchFactor(1);
     player.play();player.process(new Float32Array(1),new Float32Array(1),1);
     const before=engine.trace.slice();player[action]();
     if(action==='pause') {player.process(new Float32Array(5),new Float32Array(5),5);assert.deepEqual(engine.trace,before);player.resume();}
     else player.play();
     drainPlayer(player,1);
     assert.deepEqual(engine.trace.map(e=>[e.frame,e.args[2]]),[[0,10],[2,20],[4,30]]);
   }
 });
 test(`${label}: two streams keep independent phases and stop all`,()=>{
   const commands=[...block(0,[10,20,30]),...block(1,[40,50,60]),...setup(),...setup(1,1,1,0,11025),
     ...start(0,1,3),...start(0,1,3,1),...wait(3),0x94,0,...wait(2),0x94,255,...wait(4),0x66];
   const mock=mockChips();mock.run(new Parser(vgmBytes(commands)));
   assert.deepEqual(mock.trace.map(e=>[e.sample,e.args[2]]),[[0,10],[0,40],[2,20],[4,50]]);
   const engine=new MockSoundEngine(),player=new Player(engine);player.load(vgmBytes(commands));player.play();drainPlayer(player);
   assert.deepEqual(engine.trace.map(e=>[e.frame,e.args[2]]),[[0,10],[0,40],[2,20],[4,50]]);
 });
 test(`${label}: fractional DAC period is independent of wait partition`,()=>{
   // ceil(n * 44100 / 8000) for n=0..7, with an immediate first write.
   const commands=[...block(0,[10,20,30,40,50,60,70,80]),...setup(0,0,1,0,8000),...start(0,1,8),...wait(45),0x66];
   for(const splitWait of [1,5,6,7,45]) {
     const mock=mockChips();mock.run(new Parser(vgmBytes(commands)),{splitWait});
     assert.deepEqual(mock.trace.map(e=>e.sample),[0,6,12,17,23,28,34,39]);
   }
 });
 test(`${label}: malformed DAC commands and memory blocks never dispatch partial writes`,()=>{
   for(const bytes of [[0x90,0,2,0,0x2a],[0x91,0,0,1,0],[0x92,0,...u32(44100)],start(),
     [0x94,0],[0x95,0,0,0,0],block(0,[10,20]),[0x67,0x66,0x88,9,0,0,0,16,0,0,0,4,0,0,0,18]]) {
     for(let n=1;n<bytes.length;n++) {
       const engine=new MockSoundEngine(),player=new Player(engine);
       player.load(vgmBytes(bytes.slice(0,n)));player.play();
       assert.throws(()=>drainPlayer(player),/Unexpected end/);assert.deepEqual(engine.trace,[]);
     }
   }
 });
 test(`${label}: empty, out-of-range, zero frequency and zero stride policy`,()=>{
   for(const [data,frequency,offset,length,step,expected] of [
     [[],22050,0,1,1,[]],[[10],22050,99,1,1,[]],[[10],0,0,1,1,[]],
     [[10,20],22050,0,2,0,[[0,10],[2,20]]]]) {
     const mock=mockChips();mock.run(new Parser(vgmBytes([...block(0,data),...setup(0,0,step,0,frequency),
       ...start(offset,1,length),...wait(5),0x66]),{logger:mock.logger}));
     assert.deepEqual(mock.trace.map(e=>[e.sample,e.args[2]]),expected);
   }
 });
 test(`${label}: track change clears stream setup and data`,()=>{
   const engine=new MockSoundEngine(),player=new Player(engine);
   player.load(vgmBytes([...block(0,[10,20]),...setup(),...start(0,0x81,2),...wait(5),0x66]));
   player.play();drainPlayer(player);engine.trace.length=0;
   player.load(vgmBytes([...wait(5),0x66]));player.play();drainPlayer(player);assert.deepEqual(engine.trace,[]);
 });
}
for(const [label,Parser,Player] of [['web',Ym2612VGM,VgmPlayer],['docs',DocsParser,DocsPlayer]]) {
 test(`${label}: DAC direct equivalent and output below VGM sample rate`,()=>{
   for(const commands of [[...block(0,[10,20,30]),...setup(),...start(0,1,3),...wait(5),0x66],
     [0x52,0x2a,10,0x71,0x52,0x2a,20,0x71,0x52,0x2a,30,0x70,0x66]]) {
     for(const rate of [22050,44100,48000]) {
       const engine=new MockSoundEngine(rate),player=new Player(engine);player.load(vgmBytes(commands));player.play();drainPlayer(player,1);
       assert.deepEqual(engine.trace.map(e=>[e.frame,e.args[2]]),rate===22050?[[0,10],[1,20],[2,30]]:[[0,10],[2,20],[4,30]]);
     }
   }
   const engine=new MockSoundEngine(22050),player=new Player(engine);
   player.load(vgmBytes([0x70,0x52,0x2a,10,0x70,0x52,0x2a,20,0x66]));player.play();drainPlayer(player,1);
   assert.deepEqual(engine.trace.map(e=>[e.frame,e.args[2]]),[[0,10],[1,20]]);
 });
 test(`${label}: DAC loops preserve bank IDs with and without a VGM loop point`,()=>{
   for(const hasLoop of [false,true]) {
     const bytes=vgmBytes([...block(0,[10,20]),...setup(),...start(),...wait(4),0x66]);
     if(hasLoop)new DataView(bytes.buffer).setUint32(0x1c,0x100-0x1c,true);
     const engine=new MockSoundEngine(),player=new Player(engine);const all=[];
     const record=engine.record.bind(engine);engine.record=(...args)=>{if(args[1]==='register')all.push(args[2][2]);record(...args);};
     player.load(bytes);player.setLoopEnabled(true);player.setPrefetchFactor(1);player.play();
     player.process(new Float32Array(12),new Float32Array(12),12);player.pause();
     assert.deepEqual(all,[10,20,10,20,10,20]);
     assert.equal(player.parser.bankBlocks.get(0).length,1);
   }
 });
 test(`${label}: unsupported stream coexists with supported DAC`,()=>{
   const engine=new MockSoundEngine(),player=new Player(engine),warnings=[];
   player.load(vgmBytes([...block(0,[10,20]),...setup(),0x90,1,0x12,0,0x2a,...start(0,1,2,1),
     ...start(),...wait(5),0x66]),{logger:{warn:m=>warnings.push(m)}});
   player.play();drainPlayer(player);assert.equal(warnings.length,1);
   assert.deepEqual(engine.trace.map(e=>[e.frame,e.args[2]]),[[0,10],[2,20]]);
 });
}
