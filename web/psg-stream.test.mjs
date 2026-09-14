import test from 'node:test';
import assert from 'node:assert/strict';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsParser} from '../docs/js/ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {VgmPlayer as DocsPlayer} from '../docs/js/vgmplayer.js';
import {vgmBytes,mockChips} from './test-support/vgm-mock.js';
import {MockSoundEngine,drainPlayer} from './test-support/vgm-engine-mock.js';
// PSG command conversion follows libvgm dac_control.c: volume consumes one
// byte; tone consumes a little-endian 10-bit value and emits latch then data.
const block=data=>[0x67,0x66,0,data.length,0,0,0,...data];
const setup=(reg,step=1,base=0)=>[0x90,0,0,0,reg,0x91,0,0,step,base,0x92,0,0x22,0x56,0,0];
const cases=[
 ['volume',[...block([0x1f,0x08]),...setup(0x90),0x95,0,0,0,0,0x61,5,0,0x66],[[0,0x9f],[2,0x98]]],
 ['tone',[...block([0x23,0x01,0xff,0xff]),...setup(0xa0),0x95,0,0,0,0,0x61,5,0,0x66],[[0,0xa3],[0,0x12],[2,0xaf],[2,0x3f]]],
 ['interleaved reverse loop',[...block([0,0,0x23,1,0,0,0x56,2]),...setup(0xc0,2,1),0x95,0,0,0,0x11,0x61,5,0,0x94,0,0x61,3,0,0x66],[[0,0xc6],[0,0x25],[2,0xc3],[2,0x12],[4,0xc6],[4,0x25]]],
 ['incomplete tone unit',[...block([0x23,1,0xff]),...setup(0x80),0x95,0,0,0,0,0x61,5,0,0x66],[[0,0x83],[0,0x12]]],
 ['command count',[...block([0x23,1,0x56,2]),...setup(0x80),0x93,0,0,0,0,0,1,1,0,0,0,0x61,5,0,0x66],[[0,0x83],[0,0x12]]],
];
for(const [label,Parser,Player] of [['web',Ym2612VGM,VgmPlayer],['docs',DocsParser,DocsPlayer]]) {
 for(const [name,commands,expected] of cases)test(`${label}: PSG stream ${name}`,()=>{
   const direct=[];let time=0;
   for(const [sample,value] of expected){if(sample>time)direct.push(0x61,sample-time,0);direct.push(0x50,value);time=sample;}
   direct.push(0x66);
   for(const size of [1,3,128]) {
     const mock=mockChips(),parser=new Parser(vgmBytes(commands),{logger:mock.logger});
     mock.run(parser,{splitWait:size});assert.deepEqual(mock.warnings,[]);
     assert.deepEqual(mock.trace,expected.map(([sample,value])=>({sample,chip:'psg',instance:0,method:'write',args:[value]})));
     for(const input of [commands,direct]) {
       const engine=new MockSoundEngine(),player=new Player(engine);player.load(vgmBytes(input));player.play();drainPlayer(player,size);
       const trace=expected.map(([frame,value])=>({frame,chip:'psg',instance:0,method:'write',args:[value]}));
       assert.deepEqual(engine.trace,trace);player.reset();player.play();drainPlayer(player,size);assert.deepEqual(engine.trace,trace);
     }
   }
 });
}
for(const [label,Parser] of [['web',Ym2612VGM],['docs',DocsParser]]) {
 test(`${label}: PSG setup required and missing target cannot corrupt YM2612`,()=>{
   const start=[0x91,0,0,1,0,0x92,0,0x22,0x56,0,0,0x95,0,0,0,0,0x61,5,0,0x66];
   const mock=mockChips();mock.run(new Parser(vgmBytes([...block([1,2]),...start])));assert.deepEqual(mock.trace,[]);
   const missing=mockChips();delete missing.targets.psg;
   missing.run(new Parser(vgmBytes([...block([1,2]),0x90,0,0,0,0x90,...start]),{logger:missing.logger}));
   assert.deepEqual(missing.trace,[]);assert.equal(missing.warnings.length,1);assert.match(missing.warnings[0],/PSG playback target/);
 });
}
