import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EXAMPLES, EXAMPLE_FILES} from './playground_examples.js';
import {buildExampleBundle} from '../../scripts/build_playground_examples.mjs';
import {createVirtualFileSystem} from './playground_virtual_files.js';
import {buildFileTree} from './playground_file_tree.js';
import {createPlaygroundCassetteZip, loadPlaygroundCassette} from './playground_cassette.js';

test('wobble sample loop plays only samples loaded during preparation', async () => {
  const loaded = new Set();
  const played = [];
  const loops = [];
  const sample = {
    async load(name) { loaded.add(name); },
    async play(name) {
      assert.ok(loaded.has(name), `Unknown sample: ${name}`);
      played.push(name);
    },
  };
  const fx = { wobble() {}, delay() {}, reverb() {}, setChain() {} };
  const api = {
    setBpm() {}, setMasterVolume() {}, fx, sample,
    livePrepare: async (_name, prepare) => prepare({ fx, sample }),
    liveLoop: (_name, loop) => loops.push(loop),
    async sleep() {},
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(api), EXAMPLES['wobble-kick-bass-sample'])(...Object.values(api));
  assert.equal(loops.length, 1);
  await loops[0]();
  assert.deepEqual(played, ['sonic-pi/drum-heavy-kick', 'sonic-pi/bass-hit-c']);
});

test('bundled examples match editable categorized source files', async () => {
  assert.deepEqual(EXAMPLE_FILES.filter(file => file.path.startsWith('/examples/livefx/')).map(file => file.name), ['live-fx-distortion']);
  assert.equal(await buildExampleBundle(), await readFile(new URL('./playground_examples.js',import.meta.url),'utf8'));
  for(const file of EXAMPLE_FILES){
    assert.match(file.path,/^\/examples\/(basic|fm|midi|psg|dac|noise|samples|fx|pcm|livefx)\/[\w-]+\.js$/);
    assert.equal(file.data,await readFile(new URL('.'+file.path,import.meta.url),'utf8'));
    assert.equal(EXAMPLES[file.name],file.data);
  }
});

test('examples appear in the folder tree and edited source survives cassette export', async () => {
  const fs=createVirtualFileSystem(EXAMPLE_FILES);
  const tree=buildFileTree(fs.list());
  assert.equal(tree[0].name,'examples');
  assert.equal(tree[0].children.length,new Set(EXAMPLE_FILES.map(file=>file.path.split('/')[2])).size);
  const path='/examples/midi/midi-auto-chord.js';
  fs.writeText(path,'// user edited\n'+fs.get(path).data);
  const zip=createPlaygroundCassetteZip(fs.list());
  const cassette=await loadPlaygroundCassette(zip);
  assert.equal(new TextDecoder().decode(cassette.files.get(path.slice(1))),fs.get(path).data);
});

test('initial editor source uses the independent index demo; URL source still takes priority', async () => {
  const {DEFAULT_CODE}=await import('./playground_examples.js');
  const {resolveInitialSourceFromQuery}=await import('./playground_query.js');
  const defaults={'index.js':DEFAULT_CODE};
  const initial=resolveInitialSourceFromQuery('',defaults,'index.js');
  assert.equal(initial.source,DEFAULT_CODE);
  assert.match(initial.source,/liveFx\("distortion"/);
  assert.doesNotMatch(EXAMPLES['live-loop'],/liveFx\(/);
  const source='// shared source';
  const encoded=encodeURIComponent(Buffer.from(source).toString('base64'));
  assert.equal(resolveInitialSourceFromQuery('?src='+encoded,defaults,'index.js').source,source);
  const app=await readFile(new URL('./playground.js',import.meta.url),'utf8');
  assert.match(app,/resolveInitialSourceFromQuery\(\s*window\.location\.search,\s*\{ "index.js": DEFAULT_CODE \},\s*"index.js"/);
});
