import test from 'node:test';
import assert from 'node:assert/strict';
import {createMusicalKeyboard, keyboardBinding, musicalKeyboardEvent} from './playground_keyboard.js';

test('musical input validates bindings and MIDI values without sharing caller event objects',()=>{
  assert.throws(()=>keyboardBinding(' ',{noteOn(){},noteOff(){},allNotesOff(){}}),/name/);
  assert.throws(()=>keyboardBinding('x',{noteOn(){}}),/callbacks/);
  for(const event of [{id:'',midi:60},{id:'a',midi:-1},{id:'a',midi:128},{id:'a',midi:60.5},{id:'a',midi:60,velocity:128},{id:'a',midi:60,velocity:.5}]) {
    assert.throws(()=>musicalKeyboardEvent(event),/Keyboard events/);
  }
  const source={id:'a',midi:60};assert.deepEqual(musicalKeyboardEvent(source),{id:'a',midi:60,velocity:100});
  assert.deepEqual(source,{id:'a',midi:60});
});

test('all-notes-off keeps the target but waits for release completion before another note can start',async()=>{
  let context=null,finish;const events=[];
  const keyboard=createMusicalKeyboard({getContext:()=>context,setContext:value=>{context=value;}});
  await keyboard.commit(keyboardBinding('sample',{noteOn:event=>events.push(['on',event.id]),noteOff(){},
    allNotesOff(){events.push(['release-start']);return new Promise(resolve=>{finish=()=>{events.push(['release-end']);resolve();};});}}));
  const target=keyboard.target;await target.noteOn({id:'a',midi:60});
  const releasing=target.allNotesOff(),next=target.noteOn({id:'a',midi:60});
  await Promise.resolve();assert.equal(events.filter(([method])=>method==='on').length,1);
  finish();await releasing;await next;
  assert.deepEqual(events.map(([method])=>method),['on','release-start','release-end','on']);
  assert.notEqual(events[0][1],events[3][1]);assert.equal(keyboard.target,target);
});
