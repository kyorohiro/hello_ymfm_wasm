import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundKeyboardRouting} from './playground_mode_keyboard.js';

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
