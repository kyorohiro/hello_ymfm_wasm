import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem} from '../src/filesystem.js';

test('writeFiles publishes a validated group once, creates first checkpoints, and retains independent bytes',()=>{
  const fs=createVirtualFileSystem([{path:'/a',data:'old'},{path:'/b',data:new Uint8Array([1])}],{autoCheckpoint:true});
  let events=0;fs.onDidChange(()=>events++);
  const bytes=new Uint8Array([2]);
  fs.writeFiles([{path:'/a',data:'new'},{path:'/b',data:bytes}]);bytes[0]=9;
  assert.equal(events,1);assert.equal(fs.get('/a').data,'new');assert.equal(fs.checkpoints.get('/a').data,'old');
  assert.deepEqual(fs.get('/b').data,new Uint8Array([2]));assert.deepEqual(fs.checkpoints.get('/b').data,new Uint8Array([1]));
  fs.writeFiles([{path:'/a',data:'restored'},{path:'/b',data:new Uint8Array([3])}],{checkpointChanges:false});
  assert.equal(fs.checkpoints.get('/a').data,'old');
});

test('writeFiles conflicts, invalid data, duplicate paths and later checkpoint collisions are atomic',()=>{
  for(const entries of [
    [{path:'/a',data:'new'},{path:'/b',data:'new',expectedRevision:999}],
    [{path:'/a',data:'new'},{path:'/b',data:null}],
    [{path:'/a',data:'new'},{path:'/a',data:'again'}],
    [{path:'/a',data:'new'},{path:'/b',data:'new'}],
  ]){
    const fs=createVirtualFileSystem([{path:'/a',data:'old'},{path:'/b',data:'old'}],{autoCheckpoint:true});
    fs.mkdir('/.tet.ss/b',{recursive:true});const before=fs.snapshot(),revisions=fs.checkpoint().revisions;
    let events=0;fs.onDidChange(()=>events++);
    assert.throws(()=>fs.writeFiles(entries));assert.deepEqual(fs.snapshot(),before);assert.deepEqual(fs.checkpoint().revisions,revisions);assert.equal(events,0);
  }
});

test('setMany advances paired checkpoints atomically and normalizes gitignore only once',()=>{
  const fs=createVirtualFileSystem([{path:'/a',data:'A'},{path:'/a.synth.json',data:'state'}]);
  let events=0;fs.onDidChange(()=>events++);fs.checkpoints.setMany(['/a','/a.synth.json']);
  assert.equal(events,1);assert.equal(fs.checkpoints.get('/a').data,'A');assert.equal(fs.checkpoints.get('/a.synth.json').data,'state');
  fs.writeText('/a','B');fs.writeText('/a.synth.json','next');fs.checkpoints.setMany(['/a','/a.synth.json']);
  assert.equal(fs.checkpoints.isModified('/a'),false);assert.equal(fs.checkpoints.isModified('/a.synth.json'),false);
  assert.equal(fs.get('/.gitignore').data,'/.tet.ss/\n');
  const before=fs.snapshot();assert.throws(()=>fs.checkpoints.setMany(['/a','/missing']));assert.deepEqual(fs.snapshot(),before);
  fs.remove('/.tet.ss/a.synth.json');fs.mkdir('/.tet.ss/a.synth.json');const blocked=fs.snapshot();
  assert.throws(()=>fs.checkpoints.setMany(['/a','/a.synth.json']));assert.deepEqual(fs.snapshot(),blocked);
});
