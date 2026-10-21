import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {createPlaygroundKeyboardRouting} from './playground_mode_keyboard.js';
import {createChipInspector} from '../../web/playground_chip_inspector.js';

function setup(primaryChips=[{id:'ym2612',kind:'ym2612',label:'YM2612'}]) {
  let entries=[],observer,connection=1;const calls=[],targets=[];
  const inspector={list:()=>entries,subscribe(fn){observer=fn;return()=>{observer=null;};},getConnectionToken:()=>connection,invoke(...args){calls.push(args);return Promise.resolve(true);}};
  const routing=createPlaygroundKeyboardRouting({getInspector:()=>inspector,primaryChips,onTargetChange:target=>targets.push(target)});
  return {routing,inspector,calls,targets,connect(next){entries=next;observer?.();},replace(){connection++;}};
}
test('metadata and Chip/CH changes are silent; first preparation keeps the pending target',async()=>{
  const x=setup(),before=x.routing.getTarget();
  assert.equal(x.routing.getState().chipId,'chip:ym2612');
  x.connect([{id:'ym2612',kind:'ym2612',label:'YM2612 (primary)'},{id:'segapsg',kind:'segapsg',label:'PSG'}]);
  assert.equal(x.routing.getTarget(),before,'preparation does not invalidate the first pressed key');
  x.routing.selectChannel('fm:5');assert.equal(x.calls.length,0);
  await x.routing.getTarget().noteOn({id:'press',midi:69});assert.deepEqual(x.calls[0].slice(0,2),['ym2612','auditionOn']);assert.equal(x.calls[0][2][0],'fm:5');
  x.routing.selectChip('chip:segapsg');assert.equal(x.calls.at(-1)[1],'auditionOff','switching releases the owned note');
  const count=x.calls.length;x.routing.selectChannel('3');x.routing.selectChip('chip:ym2612');assert.equal(x.calls.length,count);
  assert.equal(x.routing.getState().channelId,'fm:5','each chip remembers its selected channel');x.routing.dispose();
});
test('additional same-kind chips route by instance, use native channel numbers, and cannot receive stale releases',async()=>{
  const x=setup([{id:'gameboy',kind:'gameboy',label:'Game Boy'}]);
  x.connect([{id:'gameboy',kind:'gameboy',label:'Game Boy'},{id:'extra',kind:'gameboy',label:'Game Boy · extra'}]);
  x.routing.selectChip('chip:extra');x.routing.selectChannel('2');const target=x.routing.getTarget();
  await target.noteOn({id:'wave',midi:60});assert.equal(x.calls[0][0],'extra');assert.equal(x.calls[0][2][0],2);
  x.replace();await target.noteOff({id:'wave'});assert.equal(x.calls.length,1,'a replaced port does not receive an old key-off');
  x.connect([{id:'gameboy',kind:'gameboy',label:'Game Boy'}]);assert.equal(x.routing.getState().chipId,'chip:gameboy');x.routing.dispose();
});
test('editor audition follows its instance and voice without changing or releasing the bottom Keyboard route',async()=>{
  const x=setup([{id:'gameboy',kind:'gameboy',label:'Game Boy'}]);
  x.connect([{id:'gameboy',kind:'gameboy',label:'Game Boy'},{id:'extra',kind:'gameboy',label:'Game Boy extra'}]);
  const keyboard=x.routing.getTarget();
  await keyboard.noteOn({id:'normal',midi:60});
  const before=x.routing.getState(), editor=x.routing.getEditorTarget('extra',2);
  assert.equal(x.routing.getEditorTarget('extra','2'),editor);
  assert.deepEqual(x.routing.getState(),before);
  assert.equal(x.calls.length,1,'selecting an editor target is silent');
  await editor.noteOn({id:'editor',midi:69});
  assert.deepEqual(x.calls.at(-1).slice(0,2),['extra','auditionOn']);
  assert.equal(x.calls.at(-1)[2][0],2);
  await editor.allNotesOff();
  assert.equal(x.calls.filter(([,method])=>method==='auditionOff').length,1);
  assert.equal(x.calls.at(-1)[0],'extra','editor release leaves the normal Keyboard note owned');
  await keyboard.noteOff({id:'normal'});assert.equal(x.calls.at(-1)[0],'gameboy');
  x.routing.dispose();
});
test('editor preparation keeps the first key target stable and rejects unsupported or missing channels',async()=>{
  const x=setup([{id:'gameboy',kind:'gameboy',label:'Game Boy'}]), editor=x.routing.getEditorTarget('gameboy',0);
  assert(editor);assert.notEqual(editor,x.routing.getTarget(),'the same hardware has independent Keyboard ownership');
  x.connect([{id:'gameboy',kind:'gameboy',label:'Game Boy (primary)'},{id:'stream',kind:'pwm',label:'PWM'}]);
  assert.equal(x.routing.getEditorTarget('gameboy',0),editor);
  assert.equal(x.routing.getEditorTarget('gameboy',4),null);
  assert.equal(x.routing.getEditorTarget('missing',0),null);
  assert.equal(x.routing.getEditorTarget('stream',0),null);
  assert.deepEqual(x.calls,[]);
  await editor.noteOn({id:'editor',midi:69});
  x.routing.selectChannel('1');assert.equal(x.calls.length,1,'changing the bottom route does not release an editor note');
  await editor.noteOff({id:'editor'});assert.equal(x.calls.at(-1)[1],'auditionOff');
  x.routing.dispose();
});
test('script/panel instruments are selectable, hardware can override them, and clearing restores the last hardware CH',()=>{
  const x=setup(),events=[],target={name:'Sampler',noteOn(){},noteOff(){},allNotesOff(){events.push('panic');}};
  x.routing.selectChannel('fm:2');x.routing.setCustomTarget('script',target);
  assert.equal(x.routing.getState().chipId,'instrument:script');assert.equal(x.routing.getTarget(),target);
  assert.equal(x.routing.getState().channelId,'instrument');
  x.routing.selectChip('chip:ym2612');assert.equal(x.routing.getState().channelId,'fm:2');
  assert(x.routing.getState().chips.some(chip=>chip.id==='instrument:script'));
  x.routing.selectChip('instrument:script');x.routing.setCustomTarget('script',null);
  assert.equal(x.routing.getState().chipId,'chip:ym2612');assert.equal(x.routing.getState().channelId,'fm:2');
  assert.deepEqual(events,[],'metadata never sends a custom global panic');x.routing.dispose();
});
test('unsupported streams stay selectable with an explanation and never fall back to FM',()=>{
  const x=setup();x.connect([{id:'stream',kind:'pwm',label:'32X PWM'}]);x.routing.selectChip('chip:stream');
  const state=x.routing.getState(),chip=state.chips.find(chip=>chip.id===state.chipId);
  assert.equal(chip.disabled,true);assert.match(chip.hint,/stream/);assert.equal(x.routing.getTarget(),null);assert.deepEqual(x.calls,[]);x.routing.dispose();
});
test('round robin allocates only FM voices and releases the actual voice acquired by each key',async()=>{
  const x=setup([{id:'ym2203',kind:'ym2203',label:'OPN'}]);x.connect([{id:'ym2203',kind:'ym2203',label:'OPN'}]);x.routing.selectChannel('fm:all');
  const target=x.routing.getTarget();for(let i=0;i<4;i++)await target.noteOn({id:String(i),midi:60+i});
  assert.deepEqual(x.calls.map(call=>call[2][0]),['fm:0','fm:1','fm:2','fm:0']);
  await target.noteOff({id:'1'});assert.equal(x.calls.at(-1)[2][0],'fm:1');x.routing.dispose();
});
test('NES FDS capability and DX7 polyphony do not invent physical channels',()=>{
  const x=setup();x.connect([{id:'nes',kind:'nes',label:'NES',fdsEnabled:false},{id:'dx7',kind:'dx7',label:'DX7'}]);
  const state=x.routing.getState();assert.equal(state.chips.find(chip=>chip.id==='chip:nes').channels.length,5);
  assert.deepEqual(state.chips.find(chip=>chip.id==='chip:dx7').channels,[{id:'0',label:'16 voices'}]);x.routing.dispose();
});

test('actual inspector applied layout events update the Master System Keyboard without audio polling',async () => {
  const {port1,port2} = new MessageChannel(), requests = [];
  port1.on('message',message => requests.push(message));
  const inspector = createChipInspector({endpoints:() => [
    {id:'segapsg',kind:'segapsg',label:'Sega PSG',port:port2},
    {id:'ym2413',kind:'ym2413',label:'YM2413 OPLL',port:port2},
  ],decode:async () => {throw new Error('metadata does not decode samples');}});
  const routing = createPlaygroundKeyboardRouting({getInspector:() => inspector,primaryChips:[
    {id:'segapsg',kind:'segapsg',label:'Sega PSG'},
    {id:'ym2413',kind:'ym2413',label:'YM2413 OPLL'},
  ]});
  const updates = []; routing.subscribe(state => updates.push(state));
  const chip = () => routing.getState().chips.find(chip => chip.id === 'chip:ym2413');
  async function appliedLayout(rhythmEnabled) {
    // Mirrors the Worklet's notification after its register write is applied,
    // rather than the script's ahead-of-time register authoring state.
    const delivered = new Promise(resolve => {
      const listener = ({data}) => {if (data?.type !== 'chip-layout') return; port2.removeEventListener('message',listener); resolve();};
      port2.addEventListener('message',listener); port2.start();
    });
    port1.postMessage({type:'chip-layout',kind:'ym2413',rhythmEnabled});
    await delivered;
  }
  try {
    routing.selectChip('chip:ym2413'); routing.selectChannel('8');
    assert.deepEqual(chip().channels.map(channel => channel.id),['0','1','2','3','4','5','6','7','8']);
    await appliedLayout(true);
    assert.deepEqual(chip().channels.map(channel => channel.id),['0','1','2','3','4','5','rhythm:0','rhythm:1','rhythm:2','rhythm:3','rhythm:4']);
    assert.equal(routing.getState().channelId,'0','an unavailable melodic CH8 is retired');
    assert.equal(inspector.list().find(entry => entry.id === 'ym2413').rhythmEnabled,true);
    assert.equal(routing.getState().chips.find(chip => chip.id === 'chip:segapsg').channels.length,4,'OPLL layout does not alter the shared-port PSG metadata');
    const updateCount = updates.length; await appliedLayout(true); assert.equal(updates.length,updateCount,'unchanged layout does not repeatedly refresh the Keyboard');
    routing.selectChannel('rhythm:4'); assert.equal(routing.getState().channelId,'rhythm:4');
    await appliedLayout(false);
    assert.deepEqual(chip().channels.map(channel => channel.id),['0','1','2','3','4','5','6','7','8']);
    assert.equal(routing.getState().channelId,'0','a removed percussion target returns to a melodic voice');
    assert.equal(inspector.list().find(entry => entry.id === 'ym2413').rhythmEnabled,false);
    assert.deepEqual(requests,[],'layout and selection changes send no read/invoke commands to audio');
  } finally {routing.dispose(); inspector.dispose(); port1.close(); port2.close();}
});
