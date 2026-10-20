import test from 'node:test';
import assert from 'node:assert/strict';
import {OpnKeyboardInspector} from './playground_opn_inspector.js';
import {createOpnAuditionGuard} from './playground_audition_guard.js';
import {opnPitchFromHz} from './soundchip_pitch.js';

function setup(kind,initialClock=kind==='ym2203'?4000000:kind==='ym2612'?7670454:8000000){
  const writes=[];let clock=initialClock;
  const chip={writeRegister:(register,value,port=0)=>writes.push([register,value,port]),reset(){writes.push(['reset']);}};
  const guard=createOpnAuditionGuard(chip,kind==='ym2203'?3:6);
  const inspector=new OpnKeyboardInspector(chip,{kind,guard,clock:()=>clock,sampleRate:48000});
  return {chip,guard,inspector,writes,setClock:value=>clock=value};
}

for(const kind of ['ym2612','ym2203','ym2608','ym2610','ym2610b'])test(`${kind}: selected logical FM voice uses its actual clock and ignores stale releases`,()=>{
  const f=setup(kind),channel=kind==='ym2203'?2:kind==='ym2610'?3:5,physical=kind==='ym2610'?5:channel;
  for(const clock of [5000000,9000000]){
    f.setClock(clock);f.inspector.invoke('auditionOn',[`fm:${channel}`,69,'first']);
    const pitch=opnPitchFromHz(440,clock,kind==='ym2203'?72:144,{clamp:true}),port=physical<3?0:1,offset=physical%3,key=physical<3?physical:physical+1;
    assert.deepEqual(f.writes.slice(-4),[[0x28,key,0],[0xa4+offset,pitch.block<<3|pitch.fnum>>8,port],[0xa0+offset,pitch.fnum&255,port],[0x28,0xf0|key,0]]);
  }
  f.inspector.invoke('auditionOn',[`fm:${channel}`,72,'replacement']);f.writes.length=0;
  f.inspector.invoke('auditionOff',[`fm:${channel}`,'first']);
  f.chip.writeRegister(0x28,physical<3?physical:physical+1,0);
  assert.deepEqual(f.writes,[],'old admin release and program key-off cannot kill current manual voice');
  f.chip.writeRegister(0x40+physical%3,17,physical<3?0:1);
  assert.equal(f.writes.length,1,'live operator changes remain available');
  f.inspector.invoke('auditionOff',[`fm:${channel}`,'replacement']);
  f.chip.writeRegister(0x28,physical<3?physical:physical+1,0);
  assert.equal(f.writes.length,3,'program plays normally after release');
});

for(const kind of ['ym2203','ym2608','ym2610','ym2610b'])test(`${kind}: SSG protects one tone and its mixer bits while other channels remain live`,()=>{
  const f=setup(kind),effective=(kind==='ym2203'?4000000/2:8000000/4),period=Math.round(effective/(16*440));
  f.chip.writeRegister(7,0x3f);f.chip.writeRegister(9,10);
  f.inspector.invoke('auditionOn',['ssg:1',69,'tone']);
  assert.deepEqual(f.writes.slice(-5),[[9,0,0],[2,period&255,0],[3,period>>8,0],[7,0x3d,0],[9,10,0]]);
  f.writes.length=0;
  f.chip.writeRegister(2,0);f.chip.writeRegister(3,0);f.chip.writeRegister(9,0);
  f.chip.writeRegister(7,0);f.chip.writeRegister(0,100);f.chip.writeRegister(8,11);
  assert.deepEqual(f.writes,[[7,16,0],[0,100,0],[8,11,0]],'shared mixer merges held channel bits and leaves the other SSG channels writable');
  f.inspector.invoke('auditionOn',['ssg:1',72,'new']);f.writes.length=0;
  f.inspector.invoke('auditionOff',['ssg:1','tone']);assert.deepEqual(f.writes,[]);
  f.inspector.clear();assert.deepEqual(f.writes,[[9,0,0]]);
  f.chip.writeRegister(9,8);assert.equal(f.writes.length,2);
});

for(const kind of ['ym2608','ym2610','ym2610b'])test(`${kind}: rhythm/ADPCM triggers keep sample/rate settings and mask only held voices`,()=>{
  const f=setup(kind),rhythm=kind==='ym2608',section=rhythm?'rhythm':'adpcm-a',port=rhythm?0:1,register=rhythm?0x10:0;
  f.inspector.invoke('auditionOn',[`${section}:2`,69,'sample']);f.writes.length=0;
  f.chip.writeRegister(register,0x84,port);f.chip.writeRegister(register,0x8c,port);
  assert.deepEqual(f.writes,[[register,0x88,port]],'another sample voice can still stop');
  const bPort=rhythm?1:0,base=rhythm?0:0x10;
  f.chip.writeRegister(base+9,0x56,bPort);f.chip.writeRegister(base+10,0x34,bPort);f.chip.writeRegister(base,0xb0,bPort);
  f.writes.length=0;f.inspector.invoke('auditionOn',['adpcm-b:0',60,'b']);
  assert.deepEqual(f.writes,[[base,1,bPort],[base,0xb0,bPort]],'B retriggers the existing sample/rate and preserves repeat');
  f.writes.length=0;f.chip.writeRegister(base,1,bPort);f.chip.writeRegister(base+9,0,bPort);f.chip.writeRegister(base+10,0,bPort);
  f.chip.writeRegister(base+11,90,bPort);
  assert.deepEqual(f.writes,[[base+11,90,bPort]],'a script cannot release or detune the held sample but level edits remain live');
  f.inspector.clear();assert.deepEqual(f.writes.slice(-2),[[register,0x84,port],[base,1,bPort]]);
});

test('OPN admin reads and invalid requests are nonmutating; clear/reset release leases without resetting presets',()=>{
  const f=setup('ym2203');f.inspector.invoke('auditionOn',['fm:2',60,'valid']);f.writes.length=0;
  for(const args of [['fm:3',60,'x'],['ssg:3',60,'x'],['rhythm:0',60,'x'],['fm:0',NaN,'x'],['fm:0',60,''],['fm:0',60,'x',128]])assert.throws(()=>f.inspector.invoke('auditionOn',args));
  assert.deepEqual(f.writes,[]);
  const state=f.inspector.read();state.held.length=0;state.keyboardChannels.length=0;
  assert.deepEqual(f.inspector.read().held,['fm:2']);assert.equal(f.inspector.read().keyboardChannels.length,6);assert.deepEqual(f.writes,[]);
  f.inspector.clear();assert.deepEqual(f.writes,[[0x28,2,0]]);
  f.inspector.invoke('auditionOn',['ssg:0',60,'next']);f.chip.reset();f.writes.length=0;
  f.inspector.invoke('auditionOff',['ssg:0','next']);f.chip.writeRegister(8,5);
  assert.deepEqual(f.writes,[[8,5,0]],'reset retires old inspector identities');
});

test('a configured noise-only SSG voice keeps its tone/noise gates during Keyboard audition',()=>{
  const f=setup('ym2608');
  f.chip.writeRegister(7,0x37); // Channel A: tone disabled, shared noise enabled.
  f.chip.writeRegister(8,9);
  f.inspector.invoke('auditionOn',['ssg:0',69,'noise']);
  assert.deepEqual(f.writes.slice(-2),[[7,0x37,0],[8,9,0]]);
  f.inspector.invoke('auditionOff',['ssg:0','noise']);
  f.inspector.invoke('auditionOn',['ssg:0',72,'noise-again']);
  assert.deepEqual(f.writes.slice(-2),[[7,0x37,0],[8,9,0]]);
});
