import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createVirtualFileSystem} from './playground_virtual_files.js';
import {reconcileModeProject} from './playground_mode_starters.js';
import {MODE_DEFAULT_CODES, MODE_DEFAULT_HISTORY} from './playground_examples.js';

const defaults = {genesis: 'fm.noteOn(0, "C4");\n', gameboy: 'gameboy.pulse.noteOn(0, "C4");\n'};
const genesisExample = {path: '/examples/fm/lead.js', data: 'await play("C4");\n'};
const gameboyExamples = [
  {path: '/examples/gameboy/pulse.js', data: 'gameboy.pulse.noteOn(0, "E4");\n'},
  {path: '/examples/gameboy/noise.js', data: 'gameboy.noise.keyOn();\n'},
];
const allExampleFiles = [genesisExample, ...gameboyExamples];
const options = {
  sourceModeId: 'genesis', targetModeId: 'gameboy', defaults,
  allExampleFiles, targetExampleFiles: gameboyExamples,
};
const project = (files = [], extra = {}) => ({
  version: 1, modeId: 'genesis', activePath: '/index.js', runPath: '/index.js',
  files: [{path: '/index.js', data: defaults.genesis}, genesisExample, ...files],
  directories: ['/', '/examples', '/examples/fm'],
  ...extra,
});
const fileAt = (snapshot, path) => snapshot.files.find(file => file.path === path);

test('a pristine starter changes with its mode and only that mode’s bundled examples remain', () => {
  const snapshot = project([], {activePath: genesisExample.path, runPath: genesisExample.path});
  const original = structuredClone(snapshot);
  const result = reconcileModeProject(snapshot, options);
  assert.deepEqual(snapshot, original, 'reconciliation does not mutate the original snapshot');
  assert.equal(result.modeId, 'gameboy');
  assert.equal(fileAt(result, '/index.js').data, defaults.gameboy);
  assert.equal(fileAt(result, genesisExample.path), undefined);
  assert.deepEqual(gameboyExamples.map(file => fileAt(result, file.path)), gameboyExamples);
  assert.equal(result.activePath, '/index.js');
  assert.equal(result.runPath, '/index.js');
  assert.equal(result.directories.includes('/examples/fm'), false);
  assert.equal(result.directories.includes('/examples/gameboy'), true);
  assert.doesNotThrow(() => createVirtualFileSystem().replace(result.files, result.directories));
});

test('edited index and examples survive and keep their editor and Run selections', () => {
  const snapshot = project([], {
    files: [
      {path: '/index.js', type: 'text', data: defaults.genesis + '// my song\n'},
      {...genesisExample, type: 'text', data: genesisExample.data + '// my lead\n'},
      {...gameboyExamples[0], data: '// my pulse version\n'},
    ],
    activePath: genesisExample.path, runPath: genesisExample.path,
  });
  const result = reconcileModeProject(snapshot, options);
  for (const file of snapshot.files) assert.deepEqual(fileAt(result, file.path), file);
  assert.equal(result.activePath, genesisExample.path);
  assert.equal(result.runPath, genesisExample.path);
  assert.equal(result.directories.includes('/examples/fm'), true);
  assert.equal(fileAt(result, gameboyExamples[1].path).data, gameboyExamples[1].data);
});

test('recognition requires exact text at the original path and preserves binaries and checkpoints', () => {
  const extras = [
    {path: '/my-lead.js', data: genesisExample.data},
    {path: '/.tet.ss' + genesisExample.path, data: genesisExample.data},
    {path: '/.tet.ss/index.js', data: defaults.genesis},
    {path: '/samples/rom.bin', type: 'binary', data: new Uint8Array([0, 255, 128])},
    {path: gameboyExamples[0].path, type: 'binary', data: new Uint8Array([1, 2])},
  ];
  const snapshot = project(extras, {
    metadata: {title: 'My track', license: 'CC BY 4.0'}, hasMetadataFile: true,
    cassetteState: {id: 'my-track'}, activePath: '/my-lead.js', runPath: '/my-lead.js',
  });
  const result = reconcileModeProject(snapshot, options);
  for (const file of extras) assert.deepEqual(fileAt(result, file.path), file);
  assert.deepEqual(result.metadata, snapshot.metadata);
  assert.equal(result.hasMetadataFile, true);
  assert.deepEqual(result.cassetteState, snapshot.cassetteState);
  assert.equal(result.activePath, '/my-lead.js');
  assert.equal(result.runPath, '/my-lead.js');
  const indexWithDifferentLineEndings = project([], {
    files: [{path: '/index.js', data: defaults.genesis.replaceAll('\n', '\r\n')}],
  });
  assert.equal(fileAt(reconcileModeProject(indexWithDifferentLineEndings, options), '/index.js').data,
    indexWithDifferentLineEndings.files[0].data);
});

test('a known source mode only recognizes its own default, including its explicit historical starters', () => {
  const copiedDefault = project([], {files: [{path: '/index.js', data: defaults.gameboy}]});
  const reverse = {...options, sourceModeId: 'genesis', targetModeId: 'genesis'};
  assert.equal(fileAt(reconcileModeProject(copiedDefault, reverse), '/index.js').data, defaults.gameboy);
  const oldSource = 'old genesis starter';
  const oldProject = project([], {files: [{path: '/index.js', data: oldSource}]});
  const result = reconcileModeProject(oldProject, {
    ...options, defaults: {...defaults, genesis: [defaults.genesis, oldSource]},
  });
  assert.equal(fileAt(result, '/index.js').data, defaults.gameboy);
});

test('legacy projects without a recorded mode recognize canonical and explicitly supplied old starters', () => {
  for (const source of [defaults.genesis, defaults.gameboy, 'legacy gameboy starter']) {
    const snapshot = project([], {modeId: undefined, files: [{path: '/index.js', data: source}]});
    const result = reconcileModeProject(snapshot, {
      ...options, sourceModeId: undefined, targetModeId: 'genesis', legacyDefaults: ['legacy gameboy starter'],
    });
    assert.equal(fileAt(result, '/index.js').data, defaults.genesis);
  }
  const custom = project([], {modeId: undefined, files: [{path: '/index.js', data: 'my custom old song'}]});
  assert.equal(fileAt(reconcileModeProject(custom, {...options, sourceModeId: undefined}), '/index.js').data,
    'my custom old song');
});

test('the recorded target mode makes repeated forward and backward switches use the right starter', () => {
  const first = reconcileModeProject(project(), options);
  const back = reconcileModeProject(first, {
    targetModeId: 'genesis', defaults, allExampleFiles, targetExampleFiles: [genesisExample],
  });
  assert.equal(back.modeId, 'genesis');
  assert.equal(fileAt(back, '/index.js').data, defaults.genesis);
  assert.equal(back.files.some(file => file.path.startsWith('/examples/gameboy/')), false);
  assert.equal(fileAt(back, genesisExample.path).data, genesisExample.data);
});

test('only newly emptied bundled directory branches are pruned; custom empty directories remain', () => {
  const snapshot = project([], {directories: [
    '/', '/examples', '/examples/fm', '/examples/fm/my-empty-folder',
    '/examples/user-empty', '/examples/gameboy', '/my-empty-folder',
  ]});
  const result = reconcileModeProject(snapshot, options);
  for (const path of snapshot.directories) assert.equal(result.directories.includes(path), true, path);
});

test('a preexisting empty bundled folder without a removed file is preserved', () => {
  const snapshot = project([], {files: [{path: '/index.js', data: defaults.genesis}]});
  const result = reconcileModeProject(snapshot, options);
  assert.equal(result.directories.includes('/examples/fm'), true);
});

test('existing file and directory paths take precedence over target example additions', () => {
  const cases = [
    {files: [{path: '/examples', data: 'a user file'}], directories: ['/']},
    {files: [{path: '/examples/gameboy', data: 'a user file'}], directories: ['/', '/examples']},
    {files: [{path: gameboyExamples[0].path + '/nested.js', data: 'a nested user file'}], directories: []},
    {files: [], directories: [gameboyExamples[0].path]},
  ];
  for (const existing of cases) {
    const snapshot = project([], existing);
    const result = reconcileModeProject(snapshot, options);
    for (const file of existing.files) assert.deepEqual(fileAt(result, file.path), file);
    assert.equal(fileAt(result, gameboyExamples[0].path), undefined);
    assert.doesNotThrow(() => createVirtualFileSystem().replace(result.files, result.directories));
  }
});

test('a missing index gets the target starter without replacing a directory occupying that path', () => {
  const result = reconcileModeProject(project([], {files: []}), options);
  assert.equal(fileAt(result, '/index.js').data, defaults.gameboy);
  const directory = reconcileModeProject(project([], {files: [], directories: ['/index.js']}), options);
  assert.equal(fileAt(directory, '/index.js'), undefined);
  assert.equal(directory.directories.includes('/index.js'), true);
});

const bundledDefaults = Object.fromEntries(Object.entries(MODE_DEFAULT_CODES).map(([id, source]) =>
  [id, [source, ...(MODE_DEFAULT_HISTORY[id] ?? [])]]));

test('canonical historical starters are bundled only for supported modes and current sources stay first', async () => {
  const history = JSON.parse(await readFile(new URL('./defaults/history.json', import.meta.url), 'utf8'));
  assert.deepEqual(MODE_DEFAULT_HISTORY,history);
  assert.deepEqual(Object.keys(history).sort(),['neogeo','pc-engine','pc98','pc98-26','snes']);
  for (const [id, sources] of Object.entries(history)) {
    assert.ok(Object.hasOwn(MODE_DEFAULT_CODES,id),id);
    assert.equal(sources.length,1,`${id} records its pre-noise-fix starter`);
    assert.notEqual(sources[0],MODE_DEFAULT_CODES[id]);
    assert.equal(bundledDefaults[id][0],MODE_DEFAULT_CODES[id]);
    const result = reconcileModeProject(project([], {modeId:id,files:[]}),{
      targetModeId:id,defaults:bundledDefaults,
    });
    assert.equal(fileAt(result,'/index.js').data,MODE_DEFAULT_CODES[id],'new files use current source');
  }
  for (const id of ['pc98','pc98-26','neogeo']) {
    assert.doesNotMatch(history[id][0],/ssg\.setMixer\(/,'old sources retain the exact former SSG recipe');
    assert.match(MODE_DEFAULT_CODES[id],/ssg\.setMixer\(0, \{tone: true, noise: false\}\)/);
  }
});

test('exact old starters receive the current source on restore and mode switches without changing assets', () => {
  const assets = [
    {path:'/samples/custom.bin',type:'binary',data:new Uint8Array([0,255,128])},
    {path:'/my-song.js',type:'text',data:'// my song\n'},
  ];
  for (const [id, sources] of Object.entries(MODE_DEFAULT_HISTORY)) for (const oldSource of sources) {
    const snapshot = project([],{
      modeId:id,files:[{path:'/index.js',type:'text',data:oldSource},...assets,
        {path:'/.tet.ss/index.js',type:'text',data:oldSource}],
      metadata:{title:'My saved project'},directories:['/','/my-empty-folder'],
    });
    const original = structuredClone(snapshot);
    for (const targetModeId of [id,'genesis']) {
      const result = reconcileModeProject(snapshot,{targetModeId,defaults:bundledDefaults});
      assert.equal(fileAt(result,'/index.js').data,MODE_DEFAULT_CODES[targetModeId],`${id} -> ${targetModeId}`);
      for (const asset of snapshot.files.slice(1)) assert.deepEqual(fileAt(result,asset.path),asset);
      assert.deepEqual(result.metadata,snapshot.metadata);
      assert.deepEqual(result.directories,snapshot.directories);
    }
    assert.deepEqual(snapshot,original);
  }
});

test('a one-character edit to a historical starter remains user data on restore and mode switches', () => {
  for (const [id, sources] of Object.entries(MODE_DEFAULT_HISTORY)) for (const oldSource of sources) {
    const edited = oldSource + ' ';
    const snapshot = project([],{modeId:id,files:[{path:'/index.js',type:'text',data:edited}]});
    for (const targetModeId of [id,'genesis']) {
      const result = reconcileModeProject(snapshot,{targetModeId,defaults:bundledDefaults});
      assert.equal(fileAt(result,'/index.js').data,edited,`${id} edit survives ${targetModeId}`);
    }
  }
});
