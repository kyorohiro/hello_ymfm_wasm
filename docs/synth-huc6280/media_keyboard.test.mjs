import test from 'node:test';
import assert from 'node:assert/strict';
import {createPceMediaKeyboard,MEDIA_KEYBOARD_RELEASE_SECONDS} from './media_keyboard.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(kind='msm5205',{pending=false,empty=false}={}){
  const listeners=new Set(),plays=[],stops=[],stopOptions=[],updates=[];
  const value={sourceId:'shared:'+kind,playbackGeneration:0,asset:empty?null:{name:'Authored'},
    defaults:{rate:11,loop:true},selectedTrack:7,track:{number:7,sampleRate:44100},position:.4,state:'ready'};
  const emit=()=>{for(const listener of listeners)listener();};
  const source={read:()=>({...value,defaults:{...value.defaults}}),subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    play(...args){
      const item={args,defaults:{...value.defaults},generation:++value.playbackGeneration,gate:pending?deferred():null,cancelled:false};plays.push(item);value.state=pending?'preparing':'playing';emit();
      const done=()=>{if(value.playbackGeneration===item.generation){value.state='playing';emit();}return{state:'playing'};};
      return item.gate?item.gate.promise.then(done):Promise.resolve(done());
    },
    stopIfPlaybackGeneration(expected,options){
      if(expected!==value.playbackGeneration)return Promise.resolve(false);
      const item=plays.find(item=>item.generation===expected);if(item)item.cancelled=true;
      stops.push(expected);stopOptions.push(options);value.playbackGeneration++;value.state='ready';emit();return Promise.resolve(true);
    },
  };
  const keyboard=createPceMediaKeyboard({kind,source,onUpdate:state=>updates.push(state)});
  return{keyboard,source,value,plays,stops,stopOptions,updates,listeners,emit};
}

for(const kind of ['msm5205','cdda'])test(`${kind} only key release requests a short software tail; cancel and takeover remain immediate`,async()=>{
  const f=fixture(kind);await f.keyboard.press('release',60);await f.keyboard.release('release');
  assert.deepEqual(f.stopOptions,[{releaseSeconds:MEDIA_KEYBOARD_RELEASE_SECONDS}]);
  assert.equal(MEDIA_KEYBOARD_RELEASE_SECONDS,.008);
  await f.keyboard.press('cancel',60);await f.keyboard.cancel();assert.equal(f.stopOptions.at(-1),undefined);
  await f.keyboard.press('old',60);await f.keyboard.press('new',64);assert.equal(f.stopOptions.at(-1),undefined);
  await f.keyboard.dispose();assert.equal(f.stopOptions.at(-1),undefined);
});

test('constructing/loading a shared media keyboard remains silent and unavailable material never starts playback',async()=>{
  const f=fixture('msm5205',{empty:true});assert.equal(f.plays.length,0);assert.deepEqual(f.keyboard.read().heldNotes,[]);
  await assert.rejects(f.keyboard.press('A',60),/Load.*sample/);assert.equal(f.plays.length,0);
  f.value.asset={name:'Loaded'};f.value.playbackGeneration++;f.emit();assert.equal(f.plays.length,0);
  await f.keyboard.dispose();
});

test('MSM keyboard triggers the existing source with its current Rate/Loop and ignores pitch',async()=>{
  const f=fixture();assert(await f.keyboard.press('screen',20));
  assert.deepEqual(f.plays[0].args,[]);assert.deepEqual(f.plays[0].defaults,{rate:11,loop:true});
  assert.deepEqual(f.keyboard.read().heldNotes,['screen']);assert.equal(f.keyboard.read().pending,false);
  f.value.defaults={rate:4,loop:false};f.emit();assert.equal(f.keyboard.read().activeId,'screen');
  assert(await f.keyboard.release('screen'));assert(await f.keyboard.press('computer',100));
  assert.deepEqual(f.plays[1].args,[]);assert.deepEqual(f.plays[1].defaults,{rate:4,loop:false});
  await f.keyboard.dispose();
});

test('CD-DA keyboard restarts the selected track at zero without altering its 44100 Hz rate',async()=>{
  const f=fixture('cdda');assert(await f.keyboard.press('C',84));
  assert.deepEqual(f.plays[0].args,[7,{offset:0}]);assert.equal(f.value.track.sampleRate,44100);
  assert(await f.keyboard.release('C'));assert.equal(f.stops.length,1);
  await f.keyboard.dispose();
});

test('monotrigger retrigger retires the old key and old key-up cannot stop the newer key',async()=>{
  const f=fixture();assert(await f.keyboard.press('A',60));assert(await f.keyboard.press('B',64));
  assert.deepEqual(f.keyboard.read().heldNotes,['B']);assert.equal(f.stops.length,1);
  assert.equal(await f.keyboard.release('A'),false);assert.equal(f.stops.length,1);assert.equal(f.value.state,'playing');
  assert(await f.keyboard.release('B'));assert.equal(f.stops.length,2);assert.equal(f.value.state,'ready');
  await f.keyboard.dispose();
});

test('key repeat does not retrigger and release before readiness cancels a late start',async()=>{
  const f=fixture('msm5205',{pending:true}),pressed=f.keyboard.press('A',60);
  assert.equal(f.keyboard.press('A',60),pressed);assert.equal(f.plays.length,1);assert(f.keyboard.read().pending);
  assert(await f.keyboard.release('A'));f.plays[0].gate.resolve();assert.equal(await pressed,false);
  assert.equal(f.value.state,'ready');assert.equal(f.stops.length,1);assert.deepEqual(f.keyboard.read().heldNotes,[]);
  await f.keyboard.dispose();
});

for(const kind of ['msm5205','cdda'])test(`${kind} UI/Code takeover survives an old key-up and late old Play acknowledgement`,async()=>{
  const f=fixture(kind,{pending:true}),old=f.keyboard.press('old',60);
  const external=f.source.play(...(kind==='cdda'?[7,{offset:.2}]:[{rate:6,loop:false}]));
  assert.deepEqual(f.keyboard.read().heldNotes,[]);assert.equal(await f.keyboard.release('old'),false);assert.equal(f.stops.length,0);
  f.plays[1].gate.resolve();await external;f.plays[0].gate.resolve();assert.equal(await old,false);
  assert.equal(f.value.state,'playing');assert.equal(f.stops.length,0);assert.equal(f.keyboard.read().ownsPlayback,false);
  await f.keyboard.dispose();assert.equal(f.stops.length,0,'disposal never stops external playback');
});

test('cancel/relinquish and disposal fence pending starts and detach source observation',async()=>{
  const f=fixture('cdda',{pending:true});
  for(const method of ['cancel','relinquish']){
    const pressed=f.keyboard.press(method,60);assert(await f.keyboard[method]());
    f.plays.at(-1).gate.resolve();assert.equal(await pressed,false);assert.deepEqual(f.keyboard.read().heldNotes,[]);
  }
  const pressed=f.keyboard.press('dispose',60);await f.keyboard.dispose();const updates=f.updates.length;
  assert.equal(f.listeners.size,0);f.plays.at(-1).gate.resolve();assert.equal(await pressed,false);
  await f.keyboard.dispose();await assert.rejects(f.keyboard.press('late',60),/disposed/);
  f.emit();assert.equal(f.updates.length,updates);
});

test('current playback failures clear held state while obsolete failures cannot replace a newer result',async()=>{
  const f=fixture('msm5205',{pending:true}),failed=f.keyboard.press('fail',60);
  f.plays[0].gate.reject(Error('Audio denied'));await assert.rejects(failed,/Audio denied/);
  assert.equal(f.keyboard.read().error,'Audio denied');assert.deepEqual(f.keyboard.read().heldNotes,[]);
  const old=f.keyboard.press('old',60),newer=f.keyboard.press('new',64);
  f.plays[2].gate.resolve();assert(await newer);f.plays[1].gate.reject(Error('Obsolete'));
  assert.equal(await old,false);assert.equal(f.keyboard.read().error,'');assert.equal(f.keyboard.read().activeId,'new');
  await f.keyboard.dispose();
});

test('invalid controller/key requests never invoke source playback',async()=>{
  assert.throws(()=>createPceMediaKeyboard({kind:'huc6280',source:{}}),/media kind/);
  const f=fixture();for(const id of ['',null,'x'.repeat(129)])assert.throws(()=>f.keyboard.press(id,60),/identity/);
  for(const midi of [-1,128,60.5,NaN])assert.throws(()=>f.keyboard.press('valid',midi),/MIDI/);
  assert.equal(f.plays.length,0);await f.keyboard.dispose();
});
