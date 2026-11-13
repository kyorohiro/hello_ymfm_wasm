import test from 'node:test';
import assert from 'node:assert/strict';
import {createHuc6280CodeProject,createHuc6280ProjectStore,readHuc6280ProjectSound,
  HUC6280_PROJECT_FORMAT,HUC6280_PROJECT_MANIFEST,HUC6280_PROJECT_FILE_BYTES,HUC6280_PROJECT_STORAGE_KEY} from './code_project.js';
import {createDefaultPreset,readPreset} from './preset.js';
import {encodeDdaData} from './dda_pcm.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';

function sound(){const preset=createDefaultPreset();preset.name='DDA and LFO drafts';preset.source='dda';
  preset.wave[3]=2;preset.lfo.enabled=true;preset.lfo.wave[9]=29;preset.lfo.mode='recorded';
  preset.lfo.carrierPeriod=710;preset.lfo.modulatorPeriod=211;preset.lfo.output.volume=12;
  preset.dda={name:'tiny DAC',data:encodeDdaData(Uint8Array.of(0,7,16,31,16,7)),sampleRate:8000,rootNote:57,loop:true,speed:.75};return preset;}

test('HuC6280 project ZIP preserves Wave/Noise/LFO/DDA settings, exact text and binary without executing',async()=>{
  const preset=sound(),project=createHuc6280CodeProject({settings:preset,starterCode:'globalThis.hucMustNotRun=true;'}),json=JSON.stringify(preset,null,2)+'\n';
  project.importFiles([{path:'/presets/Own.huc6280.json',data:json},{path:'/data/raw.bin',type:'binary',data:Uint8Array.of(0,255,17)}]);
  project.select('/presets/Own.huc6280.json');project.setCodeState({mode:'keyboard',path:'/presets/Own.huc6280.json'});
  const detached=project.snapshot();detached.settings.wave[3]=31;assert.equal(project.settings.wave[3],2);
  const copy=createHuc6280CodeProject(),prepared=await copy.prepareImport(project.exportProject());assert.equal(copy.fs.list().length,0);copy.restore(prepared);
  assert.deepEqual(copy.settings,preset);assert.deepEqual(copy.getCodeState(),{mode:'keyboard',path:'/presets/Own.huc6280.json'});
  assert.equal(copy.fs.get('/presets/Own.huc6280.json').data,json);assert.deepEqual(copy.fs.get('/data/raw.bin').data,Uint8Array.of(0,255,17));
  assert.equal(globalThis.hucMustNotRun,undefined);assert.deepEqual(readHuc6280ProjectSound(json),preset);
  const archive=await loadPlaygroundCassette(copy.exportProject());assert(archive.files.has(HUC6280_PROJECT_MANIFEST.slice(1)));
});

test('legacy voice JSON is validated without rewriting its editable source document',async()=>{
  const legacy=createDefaultPreset();legacy.version=1;delete legacy.dda;legacy.source='wave';
  for(const key of ['mode','carrierPeriod','modulatorPeriod','reset','output'])delete legacy.lfo[key];
  const json=JSON.stringify(legacy,null,3)+'\n',project=createHuc6280CodeProject();project.importFiles([{path:'/presets/legacy.json',data:json}]);
  const sound=readHuc6280ProjectSound(json);assert.equal(sound.version,3);assert.deepEqual(sound,readPreset(legacy));
  const copy=createHuc6280CodeProject({snapshot:await project.prepareImport(project.exportProject())});assert.equal(copy.fs.get('/presets/legacy.json').data,json);
  assert.equal(readHuc6280ProjectSound('{"notes":true}'),null);assert.throws(()=>readHuc6280ProjectSound('{unfinished'));
});

test('HuC6280 virtual modules and binary file reads remain detached',async()=>{
  const project=createHuc6280CodeProject({starterCode:'// starter'});
  project.importFiles([{path:'/lib/notes.js',data:'export const note=(await file("../data/note.json",{type:"json"})).note;'},
    {path:'/data/note.json',data:'{"note":"E4"}'},{path:'/data/raw.bin',type:'binary',data:Uint8Array.of(4,255)}]);
  const context={};
  try{await new(Object.getPrototypeOf(async function(){}).constructor)('context',project.prepareSource('context.note=(await import("./lib/notes.js")).note;'))(context);}
  finally{delete globalThis.__tetoricaVirtualFiles;}
  assert.deepEqual(context,{note:'E4'});new Uint8Array(await project.readFile('/data/raw.bin',{type:'arrayBuffer'})).fill(0);
  assert.deepEqual(new Uint8Array(await project.readFile('/data/raw.bin',{type:'arrayBuffer'})),Uint8Array.of(4,255));
});

test('invalid project/settings/path imports fail atomically while unfinished JSON remains editable',async()=>{
  const project=createHuc6280CodeProject({starterCode:'kept'}),before=project.snapshot();
  assert.throws(()=>project.restore({...before,settings:{...before.settings,source:'pulse'}}));assert.deepEqual(project.snapshot(),before);
  assert.throws(()=>project.restore({...before,codeState:{mode:'code',path:'/missing.json'}}),/selection/);assert.deepEqual(project.snapshot(),before);
  assert.throws(()=>project.importFiles([{path:HUC6280_PROJECT_MANIFEST,data:'reserved'}]),/reserved/);assert.deepEqual(project.snapshot(),before);
  assert.throws(()=>project.importFiles([{path:'/large.js',data:'x'.repeat(2*1024*1024+1)}]),/2 MiB/);assert.deepEqual(project.snapshot(),before);
  project.importFiles([{path:'/unfinished.json',data:'{unfinished'},{path:'/raw.bin',type:'binary',data:Uint8Array.of(1)}]);
  project.writeEditorText('/unfinished.json','{"draft":');assert.equal(project.fs.get('/unfinished.json').data,'{"draft":');
  assert.throws(()=>project.setCodeState({mode:'code',path:'/raw.bin'}),/selection/);
  const invalid=createPlaygroundCassetteZip([{path:HUC6280_PROJECT_MANIFEST,type:'text',data:JSON.stringify({...before,format:'other'})}]);
  await assert.rejects(project.prepareImport(invalid),/format\/version/);
});

test('full JSON editor size and DDA manifest capacity stay separate from JavaScript limits',()=>{
  const project=createHuc6280CodeProject({starterCode:'kept'}),large='{"draft":"'+'a'.repeat(2*1024*1024)+'"}';
  project.importFiles([{path:'/presets/large.json',data:large}]);project.writeEditorText('/presets/large.json',large+'\n');assert.equal(project.fs.get('/presets/large.json').data,large+'\n');
  assert.throws(()=>project.writeEditorText('/index.js','x'.repeat(2*1024*1024+1)),/2 MiB/);assert.equal(project.fs.get('/index.js').data,'kept');
  const preset=sound();preset.dda.data=encodeDdaData(new Uint8Array(100000).fill(16));
  const full=createHuc6280CodeProject({settings:preset});full.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(HUC6280_PROJECT_FILE_BYTES)}]);
  assert.throws(()=>full.exportProject(),/16 MiB.*Save preset/);assert.equal(full.settings.dda.data,preset.dda.data,'oversized Cassette rejection never truncates the current instrument');
});

test('manifest-free Cassette imports remain passive and retain current settings',async()=>{
  const settings=sound(),project=createHuc6280CodeProject({settings}),bytes=createPlaygroundCassetteZip([{path:'/notes.txt',type:'text',data:'plain file'}]);
  const prepared=await project.prepareImport(bytes);assert.deepEqual(prepared.settings,settings);assert.equal(prepared.codeState.mode,'keyboard');assert.equal(prepared.codeState.path,null);
  assert.equal(project.fs.has('/notes.txt'),false);project.restore(prepared);assert.equal(project.fs.get('/notes.txt').data,'plain file');
});

test('HuC6280 fallback storage preserves its own binary marker and does not touch another Synth',async()=>{
  const values=new Map([['tetorica-dmg-synth-project-v1','keep DMG']]),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const store=createHuc6280ProjectStore({indexedDB:null,storage}),project=createHuc6280CodeProject({settings:sound(),starterCode:'// kept'});
  project.importFiles([{path:'/data/raw.bin',type:'binary',data:Uint8Array.of(0,255,17)}]);assert.equal(await store.read(),null);assert.equal(await store.write(project.snapshot()),true);
  assert.match(values.get(HUC6280_PROJECT_STORAGE_KEY),/\$huc6280Bytes/);const reopened=createHuc6280ProjectStore({indexedDB:null,storage});
  assert.deepEqual(createHuc6280CodeProject({snapshot:await reopened.read()}).snapshot(),project.snapshot());assert.equal(values.get('tetorica-dmg-synth-project-v1'),'keep DMG');
  await store.close();await reopened.close();
});

test('HuC6280 IndexedDB uses an independent unchanged schema and recovers a silently closed connection',async()=>{
  let saved=null,opens=0;const connections=[];
  const indexedDB={open(name,version){assert.equal(name,'tetorica-huc6280-synth-files');assert.equal(version,1);opens++;
    const db={closed:false,objectStoreNames:{contains:()=>true},close(){this.closed=true;},transaction(store,mode){assert.equal(store,'projects');if(this.closed)throw new DOMException('connection is closing','InvalidStateError');
      const tx={};tx.objectStore=()=>({get(key){assert.equal(key,'current');const request={result:structuredClone(saved)};queueMicrotask(()=>{request.onsuccess?.();tx.oncomplete?.();});return request;},
        put(value,key){assert.equal(key,'current');const request={result:key};queueMicrotask(()=>{saved=structuredClone(value);tx.oncomplete?.();});return request;}});return tx;}};
    connections.push(db);const request={result:db};queueMicrotask(()=>request.onsuccess?.());return request;}};
  const store=createHuc6280ProjectStore({indexedDB,storage:null}),project=createHuc6280CodeProject({settings:sound(),starterCode:'// before'});
  assert.equal(await store.read(),null);await store.write(project.snapshot());connections[0].close();
  project.writeEditorText('/index.js','// after reconnect');await store.write(project.snapshot());assert.equal(opens,2);
  const loaded=await store.read();assert.equal(loaded.format,HUC6280_PROJECT_FORMAT);assert.deepEqual(loaded,project.snapshot());await store.close();
});
