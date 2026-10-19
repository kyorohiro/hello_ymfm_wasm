import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem} from './playground_virtual_files.js';
import {createPlaygroundSampleAssets, validateSampleAssetPath} from './playground_sample_assets.js';

function fixture(files = []) {
  let project = 1;
  const fs = createVirtualFileSystem(files), changed = [];
  return {fs,changed,context:{projectIdentity:1},
    replaceProject: () => {project++;fs.replace([{path:'/index.js',data:'new project'}]);},
    store:createPlaygroundSampleAssets({fs,getProjectIdentity:() => project,onChanged:path => changed.push(path)}),
  };
}
function wav() {
  const bytes = new Uint8Array(48);
  bytes.set(new TextEncoder().encode('RIFF'));bytes.set(new TextEncoder().encode('WAVE'),8);
  return bytes;
}
const asset = () => ({path:'/samples/voice.sample.json',wav:wav(),settings:{startFrame:0,rootMidi:60,gainDb:0},name:'voice.wav',source:'file'});

test('sample WAV and neutral settings commit together and load as owned data', async () => {
  const t = fixture(); let commits = 0;
  t.fs.onDidChange(() => {commits++;assert(t.fs.get('/samples/voice.wav'));assert(t.fs.get('/samples/voice.sample.json'));});
  await t.store.saveAsset(asset(),t.context);
  assert.equal(commits,1); assert.deepEqual(t.changed,['/samples/voice.sample.json']);
  const value = await t.store.loadAsset('/samples/voice.sample.json',t.context);
  assert.deepEqual(value.settings,{startFrame:0,rootMidi:60,gainDb:0});
  value.wav[0] = 0; value.settings.rootMidi = 80;
  const reload = await t.store.loadAsset('/samples/voice.sample.json',t.context);
  assert.equal(reload.wav[0],82); assert.equal(reload.settings.rootMidi,60);
  assert.equal(await t.store.loadAsset('/samples/missing.sample.json',t.context),null);
});

test('reserved paths, traversal and non-manifest extensions are rejected', () => {
  for (const path of ['/sys/voice.sample.json','/.tet.ss/samples/voice.sample.json','/.git/voice.sample.json','/samples/../voice.sample.json','/voice.json','relative.sample.json']) {
    assert.throws(() => validateSampleAssetPath(path));
  }
});

test('saving cannot overwrite another format or partially commit when a directory blocks a path', async () => {
  for (const files of [
    [{path:'/samples/voice.sample.json',data:'{"format":"unrelated"}'}],
    [{path:'/samples/voice.wav',data:'notes about a sound'}],
    [{path:'/samples/voice.wav',data:new Uint8Array([1,2,3])}],
    [{path:'/samples/voice.sample.json/child.js',data:'directory'}],
  ]) {
    const t = fixture(files), before = t.fs.snapshot();
    await assert.rejects(t.store.saveAsset(asset(),t.context));
    assert.deepEqual(t.fs.snapshot(),before);
  }
});

test('project replacement and aborted sessions reject late reads and writes', async () => {
  const t = fixture(); t.replaceProject();
  await assert.rejects(t.store.saveAsset(asset(),t.context),{name:'AbortError'});
  await assert.rejects(t.store.loadAsset('/samples/voice.sample.json',t.context),{name:'AbortError'});
  assert.deepEqual(t.fs.list().map(file => file.path),['/index.js']);
  const active = fixture(), controller = new AbortController();controller.abort();
  await assert.rejects(active.store.saveAsset(asset(),{...active.context,signal:controller.signal}),{name:'AbortError'});
  assert.equal(active.fs.list().length,0);
});

test('a project change during settings serialization cannot commit old audio', async () => {
  const t = fixture(), data = asset();
  data.settings = {get rootMidi() {t.replaceProject();return 60;}};
  await assert.rejects(t.store.saveAsset(data,t.context),{name:'AbortError'});
  assert.deepEqual(t.fs.list().map(file => file.path),['/index.js']);
});
