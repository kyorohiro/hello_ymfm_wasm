import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectAutosave} from './playground_autosave.js';
import {createVirtualFileSystem} from './playground_virtual_files.js';

test('slow saves coalesce newer edits and commit the latest binary project last', async () => {
  let source='first', finish;
  const saved=[], status=[];
  const autosave=createProjectAutosave({capture:()=>({source,bytes:new Uint8Array([0,255])}),onStatus:text=>status.push(text),
    store:{async save(snapshot){saved.push(snapshot);if(saved.length===1)await new Promise(resolve=>finish=resolve);}}});
  autosave.changed();const flushed=autosave.flush();source='second';autosave.changed();source='last';autosave.changed();
  assert.equal(saved.length,1,'no eager snapshots while the first save is pending');
  finish();await autosave.flush();
  await flushed;
  assert.deepEqual(saved.map(snapshot=>snapshot.source),['first','last']);
  assert.deepEqual(saved[1].bytes,new Uint8Array([0,255]));
  assert.equal(status.at(-1),'Saved automatically');
});

function clock() {
  let time=0, next=0;
  const tasks=new Map();
  return {
    now:()=>time,
    setTimer(fn,delay){const id=++next;tasks.set(id,{fn,at:time+delay});return id;},
    clearTimer(id){tasks.delete(id);},
    advance(ms){
      const end=time+ms;
      while(true){
        const first=[...tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!first)break;
        time=first[1].at;tasks.delete(first[0]);first[1].fn();
      }
      time=end;
    },
    get count(){return tasks.size;},
  };
}

test('typing captures the latest project once after idle, never once per keypress', async()=>{
  const timer=clock(), saved=[], status=[];let source='', captures=0;
  const autosave=createProjectAutosave({...timer,capture:()=>{captures++;return {source,bytes:new Uint8Array([0,255])};},
    onStatus:text=>status.push(text),store:{save:snapshot=>saved.push(snapshot)}});
  for(let i=0;i<400;i++){source+=String(i%10);autosave.changed();timer.advance(5);}
  assert.equal(captures,0);assert.equal(saved.length,0);
  assert.deepEqual(status,['Unsaved changes']);assert.equal(timer.count,1);
  timer.advance(749);
  await autosave.flush();
  assert.equal(captures,1);assert.equal(saved.length,1);assert.equal(saved[0].source,source);
  assert.deepEqual(saved[0].bytes,new Uint8Array([0,255]));
  assert.equal(timer.count,0);assert.equal(status.at(-1),'Saved automatically');
});

test('continuous typing has a bounded save delay',async()=>{
  const timer=clock(), saved=[];let source=0;
  const autosave=createProjectAutosave({...timer,capture:()=>({source}),store:{save:snapshot=>saved.push(snapshot)}});
  for(let i=0;i<10;i++){source=i;autosave.changed();timer.advance(500);}
  assert.deepEqual(saved,[{source:9}],'save occurs at maxWait even without an idle gap');
  await autosave.flush();
  source=10;autosave.changed();timer.advance(750);await autosave.flush();
  assert.deepEqual(saved,[{source:9},{source:10}]);
});

test('flush bypasses the delay and includes edits arriving during an asynchronous save',async()=>{
  const timer=clock(), saved=[];let source='first', release, captures=0;
  const autosave=createProjectAutosave({...timer,capture:()=>{captures++;return {source};},store:{async save(snapshot){
    saved.push(snapshot);if(saved.length===1)await new Promise(resolve=>release=resolve);
  }}});
  autosave.changed();const complete=autosave.flush();
  assert.equal(captures,1);assert.equal(timer.count,0);
  source='middle';autosave.changed();source='latest';autosave.changed();
  assert.equal(captures,1,'capture waits for the preceding write');
  release();await complete;
  assert.deepEqual(saved,[{source:'first'},{source:'latest'}]);assert.equal(timer.count,0);
});

test('snapshot errors reach flush and subsequent changes can retry',async()=>{
  const timer=clock(), saved=[];let fail=true;
  const autosave=createProjectAutosave({...timer,capture:()=>{if(fail)throw Error('capture failed');return {source:'retry'};},
    store:{save:snapshot=>saved.push(snapshot)}});
  autosave.changed();await assert.rejects(autosave.flush(),/capture failed/);
  fail=false;autosave.changed();await autosave.flush();
  assert.deepEqual(saved,[{source:'retry'}]);assert.equal(timer.count,0);
});

test('dispose cancels deferred captures and settles outstanding notifications',async()=>{
  const timer=clock();let captures=0;
  const autosave=createProjectAutosave({...timer,capture:()=>{captures++;return {};},store:{save(){}}});
  const done=autosave.changed();autosave.dispose();timer.advance(10000);await done;
  await autosave.changed();assert.equal(captures,0);assert.equal(timer.count,0);
});

test('disposing after a navigation flush closes storage once and prevents a pagehide write',async()=>{
  const timer=clock(), events=[];let source='latest edit';
  const autosave=createProjectAutosave({...timer,capture:()=>({source}),store:{
    async save(snapshot){events.push(['save',snapshot.source]);},
    close(){events.push(['close']);},
  }});
  autosave.changed();await autosave.flush();
  autosave.dispose();autosave.dispose();
  // pagehide runs the same hooks as ordinary navigation, after disposal.
  source='pagehide';await autosave.changed();await autosave.flush();timer.advance(10000);
  assert.deepEqual(events,[['save','latest edit'],['close']]);
  assert.equal(timer.count,0);
});

test('failed saves remain visible and retry on the next edit', async () => {
  let fail=true;const status=[];
  const autosave=createProjectAutosave({capture:()=>({source:'edit'}),onStatus:text=>status.push(text),store:{async save(){if(fail)throw Error('disk full');}}});
  autosave.changed();await assert.rejects(autosave.flush(),/disk full/);
  assert.equal(status.at(-1),'Autosave failed: disk full');
  fail=false;autosave.changed();await autosave.flush();
  assert.equal(status.at(-1),'Saved automatically');
});

test('file changes include binary imports, deletions and cassette replacement', () => {
  const files=createVirtualFileSystem();let changes=0;
  const unsubscribe=files.onDidChange(()=>changes++);
  files.writeText('/index.js','source');files.writeBinary('/sample.bin',new Uint8Array([1]));
  files.delete('/sample.bin');files.delete('/missing.bin');files.replace([{path:'/index.js',data:'new'}]);
  assert.equal(changes,4);
  unsubscribe();files.writeText('/index.js','other');assert.equal(changes,4);
});
