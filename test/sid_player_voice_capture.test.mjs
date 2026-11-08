import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceCapture} from '../docs/sid-player/voice_capture.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(){
  const updates=[],reads=[],converted=[];let current=null;
  const control=createVoiceCapture({getSource:()=>current,isCurrent:source=>current===source,
    capture(value,metadata){converted.push({value,metadata});if(value.bad)throw Error('Invalid snapshot');return {model:value.model,voices:[0,1,2].map(voice=>({voice,available:true,preset:{voice,model:value.model}}))};},
    onUpdate:state=>updates.push(state)});
  const start=(model='6581')=>{const wait=deferred(),source={name:'Test tune',subtune:2,engine:{read(){reads.push(source);return wait.promise;}}};current=source;return {...wait,source,model};};
  return {control,updates,reads,converted,start,retire(){current=null;control.invalidate();}};
}

test('capture performs one explicit audio read, converts all voices coherently and keeps voice selection independent',async()=>{
  const f=fixture();assert.equal(await f.control.capture(),false);assert.match(f.control.read().message,/Start playback/);assert.equal(f.reads.length,0);
  const one=f.start();f.control.selectVoice(2);const pending=f.control.capture();assert.equal(f.reads.length,1);assert.equal(f.control.read().busy,true);
  assert.equal(await f.control.capture(),false,'double capture cannot create another read');f.control.selectVoice(1);
  const state={model:'6581',registers:[1,2,3]};one.resolve(state);assert.equal(await pending,true);
  assert.equal(f.converted[0].value,state);assert.deepEqual(f.converted[0].metadata,{name:'Test tune',subtune:2});
  assert.equal(f.control.read().selected.voice,1);assert.equal(f.control.read().snapshot.model,'6581');assert.equal(f.control.read().busy,false);
  const saved=f.control.read().snapshot;f.retire();assert.equal(f.control.read().snapshot,saved,'Stop preserves an accepted snapshot');
});

test('Stop and a new tune invalidate pending reads without erasing the saved instrument or accepting a late model',async()=>{
  const f=fixture(),first=f.start();let pending=f.control.capture();first.resolve({model:'6581'});await pending;const saved=f.control.read().snapshot;
  const old=f.start();pending=f.control.capture();f.retire();assert.equal(f.control.read().busy,false);
  const next=f.start('8580'),fresh=f.control.capture();old.resolve({model:'6581'});assert.equal(await pending,false);
  assert.equal(f.control.read().busy,true);assert.equal(f.control.read().snapshot,saved);
  next.resolve({model:'8580'});assert.equal(await fresh,true);assert.equal(f.control.read().snapshot.model,'8580');
});

test('changed source identity, failed read and invalid conversion keep the accepted snapshot and report their cause',async()=>{
  const f=fixture(),first=f.start();let pending=f.control.capture();first.resolve({model:'6581'});await pending;const saved=f.control.read().snapshot;
  const stale=f.start();pending=f.control.capture();f.start('8580');stale.resolve({model:'8580'});assert.equal(await pending,false);assert.equal(f.control.read().snapshot,saved);
  const failed=f.start();pending=f.control.capture();failed.reject(Error('Endpoint unavailable'));assert.equal(await pending,false);assert.match(f.control.read().message,/Endpoint unavailable.*Previous snapshot kept/);
  const bad=f.start();pending=f.control.capture();bad.resolve({bad:true});assert.equal(await pending,false);assert.match(f.control.read().message,/Invalid snapshot/);assert.equal(f.control.read().snapshot,saved);
  assert.throws(()=>f.control.selectVoice(3),RangeError);assert.throws(()=>f.control.selectVoice('1'),RangeError);
});

test('disposal retires its read and no late success, failure or selection can publish UI updates',async()=>{
  for(const fails of [false,true]){
    const f=fixture(),start=f.start(),pending=f.control.capture();f.control.dispose();const count=f.updates.length;
    if(fails)start.reject(Error('late error'));else start.resolve({model:'8580'});
    assert.equal(await pending,false);f.control.selectVoice(1);f.control.notify('late');f.control.invalidate();assert.equal(await f.control.capture(),false);assert.equal(f.updates.length,count);
  }
});
