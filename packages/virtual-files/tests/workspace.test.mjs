import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileWorkspace,createVirtualFileSystem,transferVirtualFiles} from '../src/index.js';
import {fileStores} from '../src/filesystem_internal.js';

const entries=()=>[{path:'/tone.bin',data:new Uint8Array([0,128,255])},{path:'/tone.json',data:'{"level":1}'},{path:'/index.js',data:'original'}];
const revisions=fs=>fs.list().map(({path,revision})=>[path,revision]);

test('Auto defaults on and saved is a copied-read view of accepted working contents',()=>{
  const ws=createVirtualFileWorkspace(entries());let events=0;ws.onDidChange(()=>events++);
  assert.equal(ws.autoSave,true);assert.equal(ws.isDirty(),false);
  assert.equal(ws.saved.writeFile,undefined);assert.equal(ws.saved.restore,undefined);assert.equal(ws.saved.checkpoints,undefined);
  ws.working.writeText('/index.js','edited');ws.working.writeBinary('/new.bin',new Uint8Array([3]));
  assert.equal(ws.saved.get('/index.js').data,'edited');assert.deepEqual(ws.saved.get('/new.bin').data,new Uint8Array([3]));
  assert.equal(events,2);assert.equal(ws.isDirty(),false);
  ws.working.remove('/new.bin');assert.equal(ws.saved.has('/new.bin'),false);
  assert.equal(ws.working.checkpoints.auto,false);assert.equal(ws.working.has('/.gitignore'),false);
});

test('manual mode retains independent bytes, creates and deletes files and empty directories',()=>{
  const ws=createVirtualFileWorkspace(entries(),{autoSave:false});
  ws.working.writeText('/index.js','unsaved');ws.working.writeText('/new.txt','new');ws.working.mkdir('/empty');ws.working.delete('/tone.bin');
  assert.deepEqual(ws.getDirtyPaths(),['/empty','/index.js','/new.txt','/tone.bin']);
  assert.equal(ws.saved.get('/index.js').data,'original');assert.equal(ws.saved.has('/new.txt'),false);
  assert.deepEqual(ws.saved.get('/tone.bin').data,new Uint8Array([0,128,255]));
  assert.equal(ws.discard('/tone.bin'),true);assert(ws.working.has('/tone.bin'));
  assert.equal(ws.discard('/new.txt'),true);assert.equal(ws.working.has('/new.txt'),false);
  assert.equal(ws.save('/empty'),true);assert.equal(ws.saved.stat('/empty').type,'directory');
  ws.working.remove('/empty');ws.save('/empty');assert.throws(()=>ws.saved.stat('/empty'),/not found/);
  ws.working.delete('/tone.bin');ws.save('/tone.bin');assert.equal(ws.saved.has('/tone.bin'),false);
  assert.deepEqual(ws.getDirtyPaths(),['/index.js']);
});

test('Save many publishes binary plus sidecar atomically and a later invalid path changes nothing',()=>{
  const ws=createVirtualFileWorkspace(entries(),{autoSave:false});let savedEvents=0;ws.saved.onDidChange(()=>savedEvents++);
  ws.working.writeFiles([{path:'/tone.bin',data:new Uint8Array([7,8])},{path:'/tone.json',data:'{"level":2}'}]);
  const before=ws.saved.snapshot(),beforeRevisions=revisions(ws.saved),workingRevisions=revisions(ws.working);
  assert.throws(()=>ws.saveMany(['/tone.bin','/missing']),/not found/);
  assert.deepEqual(ws.saved.snapshot(),before);assert.deepEqual(revisions(ws.saved),beforeRevisions);assert.equal(savedEvents,0);
  assert.throws(()=>ws.saveMany(['/tone.bin','tone.bin']),/unique/);
  ws.saved.onDidChange(()=>{assert.deepEqual(ws.saved.get('/tone.bin').data,new Uint8Array([7,8]));assert.equal(ws.saved.get('/tone.json').data,'{"level":2}');});
  assert.equal(ws.saveMany(['/tone.bin','/tone.json']),true);assert.equal(savedEvents,1);
  assert.deepEqual(revisions(ws.working),workingRevisions,'accepting contents never bumps the working revision');
});

test('discard groups validate before mutation and restore complete saved directory subtrees',()=>{
  const ws=createVirtualFileWorkspace([{path:'/dir/a',data:'saved'}],{autoSave:false});
  ws.working.mkdir('/dir/empty');ws.working.writeText('/dir/a','changed');ws.working.writeText('/dir/new','new');
  const before=ws.working.snapshot(),rev=revisions(ws.working);let events=0;ws.onDidChange(()=>events++);
  assert.throws(()=>ws.discardMany(['/dir/a','/unknown']),/not found/);
  assert.deepEqual(ws.working.snapshot(),before);assert.deepEqual(revisions(ws.working),rev);assert.equal(events,0);
  ws.discardMany(['/dir','/dir/a']);assert.equal(events,1);assert.equal(ws.working.get('/dir/a').data,'saved');
  assert.equal(ws.working.has('/dir/new'),false);assert.throws(()=>ws.working.stat('/dir/empty'),/not found/);assert.equal(ws.isDirty('/dir'),false);
});

test('file-directory replacement validates parent blockers and supports saved deletions and rename paths',()=>{
  const ws=createVirtualFileWorkspace([{path:'/node',data:'file'}],{autoSave:false});
  ws.working.remove('/node');ws.working.mkdir('/node');ws.working.writeText('/node/child','value');
  const before=ws.saved.snapshot(),rev=revisions(ws.saved);
  assert.throws(()=>ws.save('/node/child'),/File blocks directory/);assert.deepEqual(ws.saved.snapshot(),before);assert.deepEqual(revisions(ws.saved),rev);
  ws.save('/node');assert.equal(ws.saved.stat('/node').type,'directory');assert.equal(ws.saved.get('/node/child').data,'value');
  transferVirtualFiles(ws.working,'/node','/moved');
  assert(ws.saved.has('/node/child'));assert.equal(ws.saved.has('/moved/child'),false);
  assert.deepEqual(ws.getDirtyPaths(),['/moved','/moved/child','/node','/node/child']);
  ws.saveMany(['/node','/moved']);assert.equal(ws.saved.has('/node/child'),false);assert.equal(ws.saved.get('/moved/child').data,'value');assert.equal(ws.isDirty(),false);
  ws.working.remove('/moved',{recursive:true});ws.working.writeText('/moved','replaced');ws.discard('/moved');assert.equal(ws.working.get('/moved/child').data,'value');
});

test('enabling Auto accepts outstanding contents before notifying observers, without an external storage API',()=>{
  const ws=createVirtualFileWorkspace(entries(),{autoSave:false});ws.working.writeText('/index.js','pending');
  let events=0,savedEvents=0;
  ws.onDidChange(()=>{events++;assert.equal(ws.autoSave,true);assert.equal(ws.isDirty(),false);});
  ws.saved.onDidChange(()=>{savedEvents++;assert.equal(ws.autoSave,true);assert.equal(ws.saved.get('/index.js').data,'pending');});
  assert.equal(ws.setAutoSave(true),true);assert.equal(events,1);assert.equal(savedEvents,1);
  assert.equal(ws.setAutoSave(true),false);assert.equal(events,1);
  for(const value of [null,1,'true',undefined])assert.throws(()=>ws.setAutoSave(value),/boolean/);
});

test('equal writes and redundant Save/discard/restore do not notify the workspace or saved view or bump revisions',()=>{
  const ws=createVirtualFileWorkspace(entries());let events=0,savedEvents=0;ws.onDidChange(()=>events++);ws.saved.onDidChange(()=>savedEvents++);
  const workingRev=revisions(ws.working),savedRev=revisions(ws.saved);
  ws.working.writeText('/index.js','original');ws.working.writeBinary('/tone.bin',new Uint8Array([0,128,255]));
  assert.equal(ws.save('/index.js'),false);assert.equal(ws.saveAll(),false);assert.equal(ws.discard('/index.js'),false);assert.equal(ws.restore(ws.snapshot()),false);
  assert.equal(events,0);assert.equal(savedEvents,0);assert.deepEqual(revisions(ws.working),workingRev);assert.deepEqual(revisions(ws.saved),savedRev);
});

test('stale working revisions fail before changing either version and discard creates fresh session revisions',()=>{
  const ws=createVirtualFileWorkspace(entries());const rev=ws.working.getRevision('/index.js');
  ws.working.writeText('/index.js','accepted');const before=ws.snapshot(),savedRev=ws.saved.getRevision('/index.js');
  assert.throws(()=>ws.working.writeFiles([{path:'/tone.json',data:'bad'},{path:'/index.js',data:'stale',expectedRevision:rev}]),/Revision conflict/);
  assert.deepEqual(ws.snapshot(),before);
  ws.setAutoSave(false);ws.working.writeText('/index.js','draft');const draftRev=ws.working.getRevision('/index.js');
  ws.discard('/index.js');assert(ws.working.getRevision('/index.js')>draftRev);assert.equal(ws.saved.getRevision('/index.js'),savedRev);
  assert.equal('revision' in ws.snapshot().working.files[0],false);
});

test('snapshot recovery retains both versions and preference with independent copies and atomic observer state',()=>{
  const original=createVirtualFileWorkspace(entries(),{autoSave:false});original.working.writeBinary('/tone.bin',new Uint8Array([4]));original.working.mkdir('/new-empty');original.working.delete('/index.js');
  const state=original.snapshot(),ws=createVirtualFileWorkspace();let events=0;
  const observe=()=>{assert.equal(ws.autoSave,false);assert.equal(ws.working.has('/index.js'),false);assert.equal(ws.saved.get('/index.js').data,'original');};
  ws.working.onDidChange(observe);ws.saved.onDidChange(observe);ws.onDidChange(()=>{observe();events++;});
  ws.restore(state);assert.equal(events,1);assert.deepEqual(ws.getDirtyPaths(),['/index.js','/new-empty','/tone.bin']);
  state.working.files.find(file=>file.path==='/tone.bin').data[0]=99;assert.deepEqual(ws.working.get('/tone.bin').data,new Uint8Array([4]));
  const returned=ws.saved.get('/tone.bin');returned.data[0]=77;assert.deepEqual(ws.saved.get('/tone.bin').data,new Uint8Array([0,128,255]));
  const second=ws.snapshot();second.saved.files.find(file=>file.path==='/tone.bin').data[0]=55;assert.equal(ws.saved.get('/tone.bin').data[0],0);
});

test('invalid working or saved recovery and contradictory Auto mode preserve both stores and revisions',()=>{
  const ws=createVirtualFileWorkspace(entries(),{autoSave:false}),before=ws.snapshot(),wrev=revisions(ws.working),srev=revisions(ws.saved);let events=0;ws.onDidChange(()=>events++);
  const invalid=[];
  let state=ws.snapshot();state.saved.files.push({path:'/bad',type:'binary',data:null});invalid.push(state);
  state=ws.snapshot();state.saved.files.push({path:'/tone.json',type:'text',data:'duplicate'});invalid.push(state);
  state=ws.snapshot();state.working.files[0].type='text';invalid.push(state);
  state=ws.snapshot();state.autoSave=true;state.working.files.find(file=>file.path==='/index.js').data='different';invalid.push(state);
  for(const snapshot of invalid){assert.throws(()=>ws.restore(snapshot));assert.deepEqual(ws.snapshot(),before);assert.deepEqual(revisions(ws.working),wrev);assert.deepEqual(revisions(ws.saved),srev);}
  assert.equal(events,0);
});

test('small edits and saving share private immutable audio records while every public byte read remains independent',()=>{
  const ws=createVirtualFileWorkspace([{path:'/audio.wav',data:new Uint8Array(1024*1024)},{path:'/code.js',data:'A'}]);
  const workingState=()=>fileStores.get(ws.working).read(),audio=workingState().files.get('/audio.wav');
  ws.working.writeText('/code.js','B');assert.equal(workingState().files.get('/audio.wav'),audio);
  const copy=ws.saved.get('/audio.wav');copy.data[0]=42;assert.equal(ws.working.get('/audio.wav').data[0],0);assert.equal(ws.saved.get('/audio.wav').data[0],0);
  ws.restore(ws.snapshot());const afterLoad=workingState().files.get('/audio.wav');ws.working.writeText('/code.js','C');assert.equal(workingState().files.get('/audio.wav'),afterLoad);
  assert.equal(ws.isDirty(),false);
});

test('legacy standalone checkpoints keep their original API and the new factory is opt-in',()=>{
  const fs=createVirtualFileSystem([{path:'/a',data:'A'}],{autoCheckpoint:true});fs.writeText('/a','B');assert.equal(fs.checkpoints.get('/a').data,'A');fs.checkpoints.revert('/a');assert.equal(fs.get('/a').data,'A');
  const ws=createVirtualFileWorkspace(entries(),{autoSave:false});ws.working.checkpoints.set('/index.js');assert.equal(ws.saved.has('/.tet.ss/index.js'),false);
  ws.saveAll();assert.equal(ws.saved.get('/.tet.ss/index.js').data,'original');
  assert.throws(()=>ws.save('https://example.invalid/file'),/Unsupported sync location/);
  assert.throws(()=>ws.saveMany([]),/nonempty/);assert.throws(()=>createVirtualFileWorkspace([],{autoSave:1}),/boolean/);
});
