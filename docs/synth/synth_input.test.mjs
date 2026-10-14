import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthInputController} from './synth_input.js';

test('native shortcuts pass through and output switching does not start new notes', async t => {
  const previousWindow=globalThis.window, handlers=new Map(), notes=[];
  globalThis.window={addEventListener:(type,handler)=>handlers.set(type,handler),removeEventListener:()=>{}};
  t.after(()=>{globalThis.window=previousWindow;});
  let enabled=true;
  const voice={channel:0,held:false,key:null}, heldKeys=new Set(), activeKeys=new Map();
  const controller=createSynthInputController({
    getKeyLayout:()=>[],findLayoutEntry:()=>({pitch:{block:4,fnum:553},noteName:'D4'}),hasLayoutKey:()=>true,
    heldKeys,activePointers:new Map(),activeKeys,voices:[voice],getAudioReadyPromise:()=>null,
    getSynth:()=>({noteOn:(...args)=>notes.push(args),noteOff:()=>{}}),
    ensureAudioReady:async()=>{},chooseVoice:()=>voice,isInputEnabled:()=>enabled,
    updateKeyboardVisuals:()=>{},setStatus:()=>{},stopAllNotes:()=>{},
  });
  controller.attachWindowInput();
  for (const modifier of ['metaKey','ctrlKey','altKey']) {
    handlers.get('keydown')({key:'q',[modifier]:true,preventDefault:()=>assert.fail('Host shortcut was intercepted')});
  }
  assert.equal(heldKeys.size,0);
  enabled=false;await controller.pressKey('a');assert.equal(notes.length,0);
  enabled=true;await controller.pressKey('a');
  assert.deepEqual(notes,[[0,4,553]]);
  controller.releaseKey('a');assert.equal(activeKeys.size,0);
});
