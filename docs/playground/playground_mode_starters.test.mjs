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

test('an explicit initial choice opens the target starter and organizes untouched bundled examples', () => {
  const snapshot = project([], {activePath: genesisExample.path, runPath: genesisExample.path});
  const original = structuredClone(snapshot);
  const result = reconcileModeProject(snapshot, {...options,codeChoice:'initial'});
  assert.deepEqual(snapshot, original, 'reconciliation does not mutate the original snapshot');
  assert.equal(result.modeId, 'gameboy');
  assert.equal(fileAt(result, '/index.js').data, defaults.gameboy);
  assert.equal(fileAt(result, genesisExample.path), undefined);
  assert.deepEqual(gameboyExamples.map(file => fileAt(result, file.path)), gameboyExamples);
  assert.equal(result.activePath, '/index.js');
  assert.equal(result.runPath, '/index.js');
  assert.equal(fileAt(result,'/index-genesis.js'),undefined,'an unchanged known starter needs no backup');
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

test('initial replaces code but only its source mode’s current and historical starters avoid backups', () => {
  const copiedDefault = project([], {files: [{path: '/index.js', data: defaults.gameboy}]});
  const reverse = {...options, sourceModeId:'genesis',targetModeId:'genesis',codeChoice:'initial'};
  const replaced = reconcileModeProject(copiedDefault,reverse);
  assert.equal(fileAt(replaced,'/index.js').data,defaults.genesis);
  assert.equal(fileAt(replaced,'/index-genesis.js').data,defaults.gameboy,'a copied foreign starter is preserved as current code');
  const oldSource = 'old genesis starter';
  const oldProject = project([], {files: [{path: '/index.js', data: oldSource}]});
  const result = reconcileModeProject(oldProject, {
    ...options, codeChoice:'initial',defaults: {...defaults, genesis: [defaults.genesis, oldSource]},
  });
  assert.equal(fileAt(result, '/index.js').data, defaults.gameboy);
  assert.equal(fileAt(result,'/index-genesis.js'),undefined);
});

test('legacy projects without a recorded mode recognize canonical and explicitly supplied old starters', () => {
  for (const source of [defaults.genesis, defaults.gameboy, 'legacy gameboy starter']) {
    const snapshot = project([], {modeId: undefined, files: [{path: '/index.js', data: source}]});
    const result = reconcileModeProject(snapshot, {
      ...options, sourceModeId:undefined,targetModeId:'genesis',codeChoice:'initial',legacyDefaults:['legacy gameboy starter'],
    });
    assert.equal(fileAt(result, '/index.js').data, defaults.genesis);
  }
  const custom = project([], {modeId: undefined, files: [{path: '/index.js', data: 'my custom old song'}]});
  assert.equal(fileAt(reconcileModeProject(custom, {...options, sourceModeId: undefined}), '/index.js').data,
    'my custom old song');
});

test('keep retains current code through forward and backward switches and same-mode reloads', () => {
  const first = reconcileModeProject(project(), options);
  assert.equal(fileAt(first,'/index.js').data,defaults.genesis);
  const restored = reconcileModeProject(first,{targetModeId:'gameboy',defaults,allExampleFiles,targetExampleFiles:gameboyExamples});
  assert.deepEqual(restored,first,'restoring a chosen Keep project cannot silently apply initial code');
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
  assert.deepEqual(Object.keys(history).sort(),['dx7','genesis-full','genesis-full-nuked','master-system','mega-cd','msx','neogeo','pc-engine','pc98','pc98-26','snes']);
  for (const [id, sources] of Object.entries(history)) {
    assert.ok(Object.hasOwn(MODE_DEFAULT_CODES,id),id);
    assert.equal(sources.length,id === 'mega-cd' ? 2 : 1,`${id} records its previous starters`);
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

test('keep preserves exact old starters on restore and mode switches without changing assets', () => {
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
      assert.equal(fileAt(result,'/index.js').data,oldSource,`${id} -> ${targetModeId}`);
      for (const asset of snapshot.files.slice(1)) assert.deepEqual(fileAt(result,asset.path),asset);
      assert.deepEqual(result.metadata,snapshot.metadata);
      assert.deepEqual(result.directories,snapshot.directories);
    }
    assert.deepEqual(snapshot,original);
  }
});

test('initial explicitly selects current starters from historical code without unnecessary backups', () => {
  for (const [id,sources] of Object.entries(MODE_DEFAULT_HISTORY)) for (const oldSource of sources) {
    const snapshot=project([],{modeId:id,files:[{path:'/index.js',type:'text',data:oldSource}]});
    const result=reconcileModeProject(snapshot,{targetModeId:'genesis',codeChoice:'initial',defaults:bundledDefaults});
    assert.equal(fileAt(result,'/index.js').data,MODE_DEFAULT_CODES.genesis);
    assert.equal(fileAt(result,`/index-${id}.js`),undefined);
    assert.equal(result.activePath,'/index.js');assert.equal(result.runPath,'/index.js');
    const restored=reconcileModeProject(result,{targetModeId:'genesis',defaults:bundledDefaults});
    assert.deepEqual(restored,result,'subsequent default Keep reconciliation preserves explicit initial selection');
  }
});

test('a one-character edit to a historical starter remains user data on restore and mode switches', () => {
  for (const [id, sources] of Object.entries(MODE_DEFAULT_HISTORY)) for (const oldSource of sources) {
    const edited = oldSource + ' ';
    const snapshot = project([],{modeId:id,files:[{path:'/index.js',type:'text',data:edited}]});
    for (const targetModeId of [id,'genesis']) {
      const result = reconcileModeProject(snapshot,{targetModeId,defaults:bundledDefaults});
      assert.equal(fileAt(result,'/index.js').data,edited,`${id} edit survives ${targetModeId}`);
      const initial=reconcileModeProject(snapshot,{targetModeId,codeChoice:'initial',defaults:bundledDefaults});
      assert.equal(fileAt(initial,'/index.js').data,MODE_DEFAULT_CODES[targetModeId]);
      assert.equal(fileAt(initial,`/index-${id}.js`).data,edited,'even a single added space requires preserving the old code');
    }
  }
});

test('keep protects selected bundled entries while removing other untouched old examples', () => {
  const another={path:'/examples/fm/another.js',type:'text',data:'another untouched example'};
  const unused={path:'/examples/fm/unused.js',type:'text',data:'unused example'};
  const snapshot=project([another,unused],{activePath:genesisExample.path,runPath:another.path});
  const original=structuredClone(snapshot);
  const result=reconcileModeProject(snapshot,{...options,allExampleFiles:[...allExampleFiles,another,unused]});
  assert.equal(fileAt(result,'/index.js').data,defaults.genesis);
  assert.deepEqual(fileAt(result,genesisExample.path),genesisExample);
  assert.deepEqual(fileAt(result,another.path),another);
  assert.equal(fileAt(result,unused.path),undefined);
  assert.equal(result.activePath,genesisExample.path);assert.equal(result.runPath,another.path);
  assert.equal(result.directories.includes('/examples/fm'),true);
  assert.deepEqual(snapshot,original);
  const restored=reconcileModeProject(result,{...options,sourceModeId:'gameboy',allExampleFiles:[...allExampleFiles,another,unused]});
  assert.deepEqual(restored,result,'reload keeps selected source and paths');
});

test('initial backs up edited index code while retaining other current entries, assets and metadata', () => {
  const customIndex={path:'/index.js',type:'text',data:defaults.genesis+'// my note\n'};
  const customEntry={path:'/songs/current.js',type:'text',data:'// current song\n'};
  const asset={path:'/samples/voice.bin',type:'binary',data:new Uint8Array([0,255,128])};
  const checkpoint={path:'/.tet.ss/index.js',type:'text',data:'// saved checkpoint\n'};
  const snapshot=project([],{
    files:[customIndex,customEntry,asset,checkpoint],activePath:customEntry.path,runPath:customEntry.path,
    metadata:{title:'My song'},hasMetadataFile:true,cassetteState:{id:'my-song'},
    directories:['/','/songs','/samples','/.tet.ss','/empty'],
  });
  const original=structuredClone(snapshot);
  const result=reconcileModeProject(snapshot,{...options,codeChoice:'initial'});
  assert.equal(fileAt(result,'/index.js').data,defaults.gameboy);
  assert.deepEqual(fileAt(result,'/index-genesis.js'),{...customIndex,path:'/index-genesis.js'});
  for(const file of [customEntry,asset,checkpoint])assert.deepEqual(fileAt(result,file.path),file);
  assert.deepEqual(result.metadata,snapshot.metadata);assert.equal(result.hasMetadataFile,true);
  assert.deepEqual(result.cassetteState,snapshot.cassetteState);assert(result.directories.includes('/empty'));
  assert.equal(result.activePath,'/index.js');assert.equal(result.runPath,'/index.js');
  assert.deepEqual(snapshot,original);
  assert.doesNotThrow(()=>createVirtualFileSystem().replace(result.files,result.directories));
});

test('initial backup names avoid file, explicit directory and implicit directory collisions', () => {
  const extras=[
    {path:'/index-genesis.js',type:'binary',data:new Uint8Array([7,8])},
    {path:'/index-genesis-3.js/nested.bin',type:'binary',data:new Uint8Array([9])},
    {path:'/index-genesis-4.js',type:'text',data:'// an existing backup\n'},
  ];
  const snapshot=project([],{
    files:[{path:'/index.js',type:'text',data:'// current custom code\n'},...extras],
    directories:['/','/index-genesis-2.js'],
  });
  const result=reconcileModeProject(snapshot,{...options,codeChoice:'initial'});
  assert.equal(fileAt(result,'/index-genesis-5.js').data,'// current custom code\n');
  for(const file of extras)assert.deepEqual(fileAt(result,file.path),file);
  assert(result.directories.includes('/index-genesis-2.js'));
  assert.doesNotThrow(()=>createVirtualFileSystem().replace(result.files,result.directories));
});

test('initial preserves a binary index as a backup and never replaces an index directory', () => {
  const binary={path:'/index.js',type:'binary',data:new Uint8Array([0,255,1])};
  const result=reconcileModeProject(project([],{files:[binary]}),{...options,codeChoice:'initial'});
  assert.deepEqual(fileAt(result,'/index-genesis.js'),{...binary,path:'/index-genesis.js'});
  assert.equal(fileAt(result,'/index.js').type,'text');
  for(const snapshot of [project([],{files:[],directories:['/','/index.js']}),
    project([],{files:[{path:'/index.js/asset.bin',type:'binary',data:new Uint8Array([2])}],directories:['/']})]) {
    const original=structuredClone(snapshot);
    assert.throws(()=>reconcileModeProject(snapshot,{...options,codeChoice:'initial'}),/index.js is a directory/);
    assert.deepEqual(snapshot,original);
  }
});

test('invalid choices and missing target starters fail without changing the project', () => {
  const snapshot=project(),original=structuredClone(snapshot);
  for(const codeChoice of ['cancel','unknown',null,false]) {
    assert.throws(()=>reconcileModeProject(snapshot,{...options,codeChoice}),/Unsupported mode code choice/);
    assert.deepEqual(snapshot,original);
  }
  for(const codeChoice of ['keep','initial'])for(const missing of [{}, {gameboy:[]}, {gameboy:[null]}]) {
    assert.throws(()=>reconcileModeProject(snapshot,{...options,codeChoice,defaults:missing}),/Missing starter source/);
    assert.deepEqual(snapshot,original);
  }
});
