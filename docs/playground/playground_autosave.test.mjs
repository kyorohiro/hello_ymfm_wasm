import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectAutosave} from './playground_autosave.js';
import {createVirtualFileSystem} from './playground_virtual_files.js';

test('slow saves coalesce newer edits and commit the latest binary project last', async () => {
  let source='first', finish;
  const saved=[], status=[];
  const autosave=createProjectAutosave({capture:()=>({source,bytes:new Uint8Array([0,255])}),onStatus:text=>status.push(text),
    store:{async save(snapshot){saved.push(snapshot);if(saved.length===1)await new Promise(resolve=>finish=resolve);}}});
  autosave.changed();source='second';autosave.changed();source='last';autosave.changed();
  finish();await autosave.flush();
  assert.deepEqual(saved.map(snapshot=>snapshot.source),['first','last']);
  assert.deepEqual(saved[1].bytes,new Uint8Array([0,255]));
  assert.equal(status.at(-1),'Saved automatically');
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
