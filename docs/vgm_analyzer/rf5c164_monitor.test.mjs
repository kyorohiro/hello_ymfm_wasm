import test from 'node:test';
import assert from 'node:assert/strict';
import { createRf5c164Monitor, applyRf5c164Write, describeRf5c164Monitor, observeRf5c164Engine } from './rf5c164_monitor.js';
import { createPsgMonitor, observePsgEngine } from './psg_monitor.js';
import { Ym2612VGM } from '../js/ym2612vgm.js';

test('channel selection and RAM bank selection are independent; settings decode per channel',()=>{
  const s=createRf5c164Monitor();
  for(const [r,v] of [[7,0xc3],[0,200],[1,0xa5],[2,0x34],[3,0x12],[4,0x78],[5,0x56],[6,0xab],[7,0x82],[8,0xf7]]) applyRf5c164Write(s,r,v,100);
  const d=describeRf5c164Monitor(s,true,12500000,false);
  assert.equal(d.enabled,true);assert.equal(d.selectedChannel,4);assert.equal(d.ramBank,2);
  assert.deepEqual(d.channels[3],{name:'PCM 4',enabled:true,volume:200,panLeft:5,panRight:10,step:0x1234,loopAddress:0x5678,startAddress:0xab00,registers:[200,0xa5,0x34,0x12,0x78,0x56,0xab]});
  assert.equal(d.channels.filter(c=>c.enabled).length,1);assert.equal(d.channels[0].volume,0);
  applyRf5c164Write(s,7,0x43,200);
  const muted=describeRf5c164Monitor(s,true,12500000,true);
  assert.equal(muted.enabled,false);assert.equal(muted.channels[3].enabled,true);assert.equal(muted.muted,true);
  d.channels[3].registers[0]=0;assert.equal(s.channels[3].registers[0],200);
  assert.equal(describeRf5c164Monitor(createRf5c164Monitor(),false,0,false).used,false);
});

test('VGM writes and RAM transfers are forwarded once; reset clears display and wrappers do not accumulate',()=>{
  let state=createRf5c164Monitor();let changes=0;const calls=[];
  const engine={reset(){calls.push('reset');},writeRf5c164(...a){calls.push(['reg',...a]);},
    writeRf5c164Memory(...a){calls.push(['byte',...a]);},loadRf5c164Memory(...a){calls.push(['data',...a]);}};
  observePsgEngine(engine,()=>createPsgMonitor('ym2612'),()=>{},()=>{state=createRf5c164Monitor();});
  for(let i=0;i<2;i++) observeRf5c164Engine(engine,()=>state,()=>changes++,()=>100);
  const commands=[0xb1,7,0xc1,0xb1,0,123,0xb1,8,0xfd,0xc2,0,0,128,0x67,0x66,0xc1,4,0,0,0,0,0,128,255,0x66];
  const b=new Uint8Array(256+commands.length);b.set([86,103,109,32]);const v=new DataView(b.buffer);
  v.setUint32(8,0x171,true);v.setUint32(0x34,0xcc,true);v.setUint32(0x6c,12500000,true);b.set(commands,256);
  const parser=new Ym2612VGM(b);
  const target={rf5c164:{writeRegister:(...a)=>engine.writeRf5c164(...a),writeMemory:(...a)=>engine.writeRf5c164Memory(...a),loadBankedMemory:(...a)=>engine.loadRf5c164Memory(...a)}};
  while(parser.playStep(target).type!=='end'){}
  assert.equal(calls.length,5);assert.equal(changes,5);assert.equal(state.channels[1].registers[0],123);
  assert.equal(state.memoryWrites,2);assert.equal(state.transferredBytes,3);
  parser.position=parser.header.dataOffset;parser.ended=false; // a partial loop keeps state
  while(parser.playStep(target).type!=='end'){}
  assert.equal(state.writes,6);assert.equal(state.transferredBytes,6);
  engine.reset();assert.deepEqual(state,createRf5c164Monitor());
  engine.writeRf5c164(7,0xc7);assert.equal(state.selectedChannel,7);assert.equal(state.writes,1);
});

test('failed memory writes do not report a successful transfer',()=>{
  const state=createRf5c164Monitor();
  const engine={loadRf5c164Memory(){throw new RangeError('range');}};
  observeRf5c164Engine(engine,()=>state,()=>assert.fail('must not change'));
  assert.throws(()=>engine.loadRf5c164Memory(new Uint8Array(2),65535));
  assert.equal(state.memoryWrites,0);
});
