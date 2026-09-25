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

test('all 37 bundled examples match editable categorized source files', async () => {
  assert.equal(EXAMPLE_FILES.length,37);
  assert.equal(await buildExampleBundle(), await readFile(new URL('./playground_examples.js',import.meta.url),'utf8'));
  for(const file of EXAMPLE_FILES){
    assert.match(file.path,/^\/examples\/(basic|fm|midi|psg|dac|noise|samples|fx)\/[\w-]+\.js$/);
    assert.equal(file.data,await readFile(new URL('.'+file.path,import.meta.url),'utf8'));
    assert.equal(EXAMPLES[file.name],file.data);
  }
});

test('examples appear in the folder tree and edited source survives cassette export', async () => {
  const fs=createVirtualFileSystem(EXAMPLE_FILES);
  const tree=buildFileTree(fs.list());
  assert.equal(tree[0].name,'examples');
  assert.equal(tree[0].children.length,8);
  const path='/examples/midi/midi-auto-chord.js';
  fs.writeText(path,'// user edited\n'+fs.get(path).data);
  const zip=createPlaygroundCassetteZip(fs.list());
  const cassette=await loadPlaygroundCassette(zip);
  assert.equal(new TextDecoder().decode(cassette.files.get(path.slice(1))),fs.get(path).data);
});
