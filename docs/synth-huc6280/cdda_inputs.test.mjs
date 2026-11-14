import test from 'node:test';
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {createCddaSessionFiles} from './cdda_session_files.js';
import {createCddaInputReader,resolveCddaInputPath,isCddaProjectEntry} from './cdda_inputs.js';

test('CD-DA inputs resolve Code-relative and root paths through Project while session IDs stay private and exclusive',async()=>{
  const session=createCddaSessionFiles(),[path]=session.addFiles([new File([Uint8Array.of(7,8,9)],'external.wav')]),calls=[];
  let executionPath='/code/album/main.js';
  const project={async readFile(...args){calls.push(args);return Uint8Array.of(1,2,3).buffer;}};
  const read=createCddaInputReader({project,session,getExecutionPath:()=>executionPath});
  assert.deepEqual(await read('../tracks/one.wav'),Uint8Array.of(1,2,3));
  assert.deepEqual(calls[0],['/code/tracks/one.wav',{type:'arrayBuffer'},{path:executionPath}]);
  assert.deepEqual(await read(path),Uint8Array.of(7,8,9));assert.equal(calls.length,1);
  executionPath='/new/song.js';await read('./list.cdda.json');assert.equal(calls[1][0],'/new/list.cdda.json');
  await read('./one.wav',{}, {path:'/explicit/player.js'});assert.equal(calls[2][0],'/explicit/one.wav');
  session.clear();await assert.rejects(read(path),/no longer available/);assert.equal(calls.length,3,'missing session IDs never read a colliding Project file');
  assert.equal(resolveCddaInputPath('/folder/../track.wav'),'/track.wav');
  for(const invalid of ['https://example.test/song.wav','file:///song.wav','blob:x','../outside.wav','bad\\name.wav','bad\0name.wav'])await assert.rejects(read(invalid,{}, {path:'/index.js'}),/virtual|escapes/);
  await assert.rejects(read('/track.wav',{type:'text'}),/bytes only/);session.dispose();
});

test('Project media cancellation and returned typed views preserve byte ownership',async()=>{
  const session=createCddaSessionFiles(),bytes=Uint8Array.of(255,1,2,3,255),controller=new AbortController();
  const read=createCddaInputReader({session,project:{async readFile(){return bytes.subarray(1,4);}}});
  const result=await read('/small.wav');assert.deepEqual(result,Uint8Array.of(1,2,3));result.fill(0);assert.deepEqual(bytes,Uint8Array.of(255,1,2,3,255));
  const cancelled=createCddaInputReader({session,project:{async readFile(){controller.abort();return new ArrayBuffer(4);}}});
  await assert.rejects(cancelled('/small.wav',{signal:controller.signal}),{name:'AbortError'});session.dispose();
});

test('Project picker shows binary WAV and named/valid manifests, excluding session namespace and unrelated JSON',()=>{
  const track={tracks:[{number:1,file:'track.wav'}]},valid=JSON.stringify(track);
  assert(isCddaProjectEntry({path:'/audio/track.WAV',fileType:'binary'}));
  assert(!isCddaProjectEntry({path:'/audio/track.wav',fileType:'text'}));
  assert(isCddaProjectEntry({path:'/album/list.cdda.json',fileType:'text'}));
  assert(isCddaProjectEntry({path:'/album/list.json',fileType:'text'},valid));
  assert(isCddaProjectEntry({path:'/album/list.json',fileType:'binary'},new TextEncoder().encode(valid)));
  assert(!isCddaProjectEntry({path:'/presets/tone.json',fileType:'text'},'{}'));
  assert(!isCddaProjectEntry({path:'/bad.json',fileType:'text'},'{"tracks":[]}'));
  assert(!isCddaProjectEntry({path:'/session-cdda/collision.wav',fileType:'binary'}));
  assert(!isCddaProjectEntry({path:'/audio/file.wav',fileType:'binary',session:true}));
  assert(!isCddaProjectEntry({path:'/not-a-file.wav',type:'directory'}));
});
