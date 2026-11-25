import test from 'node:test';
import assert from 'node:assert/strict';
import {createNoteOutput} from './midi_output.js';

test('coincident gates share a channel/pitch; switching device releases the old notes once',()=>{
  const a=[],b=[],output=createNoteOutput(assert.fail);
  output.on(2,0,61,127);output.select({send:m=>a.push(m)});
  output.on(0,1,60,90);output.on(1,1,60,80);output.on(2,2,60,99);
  output.off(0);output.select({send:m=>b.push(m)});output.off(1);output.off(2);
  assert.deepEqual(a,[[145,60,90],[146,60,99],[129,60,0],[130,60,0]]);
  assert.deepEqual(b,[]);
  output.on(0,15,127,1);output.on(0,15,126,2);output.select(null);
  assert.deepEqual(b,[[159,127,1],[143,127,0],[159,126,2],[143,126,0]]);
});

test('MSFA shares local pitch but preserves distinct external logical channels',async()=>{
  const {createMsfaNotes}=await import('./msfa_notes.js');
  const local=[],external=[];
  const output=createNoteOutput(assert.fail);output.select({send:m=>external.push(m)});
  const keys=createMsfaNotes({noteOn:n=>local.push(n),noteOff:n=>local.push(-n)},{
    on:(token,owner,n,v)=>output.on(token,owner.channel,n,v),off:token=>output.off(token),
  });
  const first={channel:0},second={channel:1};
  keys.noteOn(69,80,first);keys.noteOn(69,75,second);keys.noteOff(69,first);keys.noteOff(69,second);
  assert.deepEqual(local,[69,-69]);
  assert.deepEqual(external,[[144,69,80],[145,69,75],[128,69,0],[129,69,0]]);
});

test('a stopped liveLoop releases its MIDI IDs without releasing another loop on the same channel',async()=>{
  const {createPlaygroundCodeRuntime}=await import('../js/playground_code_runtime.js');
  const {createMidiApi}=await import('../js/playground_midi.js');
  const held=new Map();let nextId=0;
  const runtime=createPlaygroundCodeRuntime({
    ensureReady(){},useSoundChip(){},now:()=>performance.now()/1000,guardExecution:false,
    createMidi:clock=>createMidiApi((method,[destination,channel,note,value])=>{
      if(method==='noteOn'){held.set(++nextId,note);return nextId;}
      if(method==='release')held.delete(value);
    },{...clock,outputs:['tetorica-fm21290']}),
    stopSoundChips:()=>held.clear()
  });
  try{
    await runtime.run(`const port=midi.output('tetorica-fm21290',{channel:CH1});
      liveLoop('low',async()=>{await port.play('C4',{duration:16});});
      liveLoop('high',async()=>{await port.play('G4',{duration:16});});
      liveLoop('control',async()=>{await beat(.25);stopLoop('low');await beat(16);});`);
    for(let i=0;i<50 && held.size<2;i++)await new Promise(done=>setTimeout(done,10));
    assert.deepEqual([...held.values()].sort(),[60,67]);
    for(let i=0;i<50 && held.size===2;i++)await new Promise(done=>setTimeout(done,10));
    assert.deepEqual([...held.values()],[67]);
  }finally{await runtime.stop();}
  assert.equal(held.size,0);
});
