import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpmState,observeOpmEngine,mountOpmMonitor} from './opm_monitor.js';
test('OPM register fields and slot/channel isolation',()=>{
 const state=createOpmState();
 for(const [r,v] of [[0x27,0xdd],[0x2f,0x53],[0x37,0xac],[0x3f,0x62],[0x5f,0x73],[0x7f,0x65],[0x9f,0xd5],[0xbf,0x99],[0xdf,0x9a],[0xff,0xb7],[8,0x47]])state.write(r,v);
 const ch=state.snapshot().channels[7];
 assert.deepEqual(ch,{channel:8,algorithm:5,feedback:3,left:true,right:true,kc:83,kf:43,pms:6,ams:2,operators:[
 ...Array.from({length:3},(_,i)=>({slot:i+1,key:false,dt1:0,mul:0,tl:0,ks:0,ar:0,am:0,d1r:0,dt2:0,d2r:0,d1l:0,rr:0})),
 {slot:4,key:true,dt1:7,mul:3,tl:101,ks:3,ar:21,am:1,d1r:25,dt2:2,d2r:26,d1l:11,rr:7}]});
 assert.equal(state.snapshot().channels[0].operators[3].tl,0);
 state.write(8,7);assert(ch.operators[3].key);assert(!state.snapshot().channels[7].operators[3].key);
});
test('OPM AMD and PMD share an address without overwriting each other; reset clears',()=>{
 const s=createOpmState();s.write(0x19,45);s.write(0x19,0xd6);s.write(0x1a,0);s.write(0x18,123);s.write(0x1b,3);s.write(15,0x95);
 assert.deepEqual(s.snapshot().lfo,{rate:123,waveform:3,amd:45,pmd:86});
 assert.deepEqual(s.snapshot().noise,{enabled:true,rate:21});s.reset();assert.deepEqual(s.snapshot(),createOpmState().snapshot());
});
test('OPM observation preserves writes and resets, and renders eight channel tables',()=>{
 const state=createOpmState(),calls=[];
 const engine={writeYm2151:(...a)=>calls.push(a),reset:()=>calls.push('reset')};
 observeOpmEngine(engine,state,()=>calls.push('changed'));
 engine.writeYm2151(0x20,7);assert.equal(state.snapshot().channels[0].algorithm,7);engine.reset();
 assert.deepEqual(calls,[[0x20,7],'changed','reset','changed']);assert.equal(state.snapshot().channels[0].algorithm,0);
 const old=globalThis.document,tags=[];
 globalThis.document={createElement(tag){const el={style:{},children:[],append(...a){this.children.push(...a);}};tags.push([tag,el]);return el;}};
 try{const m=mountOpmMonitor({append(){}});m.write(0x20,7);m.render();assert.equal(tags.filter(([tag])=>tag==='table').length,8);assert(tags.some(([tag,el])=>tag==='span' && el.textContent==='ALG 7'));}finally{globalThis.document=old;}
});

test('OPM changes track individual fields, transient changes, fade and reset',()=>{
 let time=0;const s=createOpmState(()=>time);
 s.write(0x40,0x12);assert.equal(s.opacity('ch0.op0.dt1'),1);assert.equal(s.opacity('ch0.op0.mul'),1);
 time=900;s.write(0x40,0x12);assert.equal(s.opacity('ch0.op0.dt1'),0.5);
 s.write(0x40,0x13);assert.equal(s.opacity('ch0.op0.dt1'),0.5);assert.equal(s.opacity('ch0.op0.mul'),1);
 s.write(0x40,0x12);assert.equal(s.opacity('ch0.op0.mul'),1);
 assert.equal(s.opacity('ch1.op0.mul'),0);
 s.write(0x19,3);s.write(0x19,0x85);time=1000;s.write(0x19,0x86);
 assert(s.opacity('lfo.amd')<1);assert.equal(s.opacity('lfo.pmd'),1);
 s.write(8,0x47);assert.equal(s.opacity('ch7.op3.key'),1);assert.equal(s.opacity('ch7.op2.key'),0);
 s.write(0x27,0x40);assert.equal(s.opacity('ch7.left'),1);assert.equal(s.opacity('ch7.algorithm'),0);
 time=2800;assert.equal(s.hasRecentChanges(),false);assert.equal(s.opacity('lfo.pmd'),0);
 s.write(0xff,3);assert(s.hasRecentChanges());s.reset();assert(!s.hasRecentChanges());assert.equal(s.opacity('ch7.op3.rr'),0);
});

test('OPM cell highlight disappears after idle time and reset',()=>{
 let time=0;const tags=[],old=globalThis.document;
 globalThis.document={createElement(tag){const el={style:{},append(){}};tags.push([tag,el]);return el;}};
 try{
  const m=mountOpmMonitor({append(){}},()=>time);const cells=tags.filter(([tag])=>tag==='td').map(([,el])=>el);
  assert(cells.every(cell=>cell.style.background===''));
  m.write(0x60,42);m.render();assert.match(cells[4].style.background,/255 224 138/);assert.equal(cells[3].style.background,'');
  time=1800;m.render();assert.equal(cells[4].style.background,'');
  m.write(0x60,43);m.render();assert(cells[4].style.background);m.reset();m.render();assert.equal(cells[4].style.background,'');
 }finally{globalThis.document=old;}
});
