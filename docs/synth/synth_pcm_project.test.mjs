import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthProject,isSynthTonePath,isPcmTonePath,synthStatePath,synthToneExtension} from './synth_project.js';
import {createPcmBuiltinPreset,normalizePcmPreset,serializePcmPreset,PCM_MAX_FRAMES} from './synth_pcm.js';
import {createPsgPreset} from './synth_psg_preset.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';

const fm={algorithm:7,feedback:0,operators:{4:{tl:24}}};
const file=(name,text)=>({name,data:new TextEncoder().encode(text)});
const sample=()=>createPcmBuiltinPreset('sine');
function fullSample() {
  const preset=sample();preset.sample.name='Full RAM bank';preset.sample.data=Buffer.alloc(PCM_MAX_FRAMES,128).toString('base64');
  preset.settings.loopEnd=PCM_MAX_FRAMES;return normalizePcmPreset(preset);
}

test('PCM instruments are complete single text files, detached from their authoring data and FM sidecars',()=>{
  const project=createSynthProject(),preset=sample(),tone=project.createTone(preset,'Piano');
  assert.equal(tone.path,'/presets/Piano.pcm.json');assert.equal(tone.format,'pcm');
  assert.equal(project.fs.get(tone.path).type,'text');assert.deepEqual(tone.preset,preset);
  assert.deepEqual(tone.bytes,new TextEncoder().encode(serializePcmPreset(preset)));
  assert.equal(project.fs.has(synthStatePath(tone.path)),false);
  assert.equal(project.autoApply,true);assert.equal(project.isToneModified(tone.path),false);
  assert.deepEqual(project.readTone(tone.path,{version:'saved'}).preset,preset);
  assert(isPcmTonePath(tone.path));assert.equal(synthToneExtension(tone.path),'.pcm.json');
  for(const path of ['/.git/refs/heads/Piano.pcm.json','/.tet.ss/presets/Piano.pcm.json','/opaque.json'])assert(!isSynthTonePath(path));
  tone.preset.settings.volume=0;tone.bytes.fill(0);assert.deepEqual(project.readTone(tone.path).preset,preset);
  const before=project.snapshot();
  for(const bad of [{...preset,version:99},{...preset,kind:'other'},
    {...preset,sample:{...preset.sample,data:'/w=='}},
    {...preset,settings:{...preset.settings,loopEnd:PCM_MAX_FRAMES+1}}]) {
    assert.throws(()=>project.writeTone(tone.path,bad));assert.throws(()=>project.createTone(bad,'Rejected'));
    assert.deepEqual(project.snapshot(),before);
  }
  assert.throws(()=>project.writeTone(tone.path,createPsgPreset()));
  assert.throws(()=>project.writeTone(tone.path,fm));assert.throws(()=>project.writeTone('/presets/Wrong.vgi',preset));
  assert.throws(()=>project.writeTone(tone.path,preset,{format:'psg'}));
  assert.throws(()=>project.writeTone(tone.path,preset,{expectedRevision:999}),/Revision conflict/);
  assert.deepEqual(project.snapshot(),before);
});

test('manual PCM Save/discard and compound CRUD retain a full sample without touching unrelated metadata',()=>{
  const project=createSynthProject(),preset=fullSample(),tone=project.createTone(preset,'Full'),path=tone.path;
  project.setAutoApply(false);const edited=structuredClone(preset);edited.settings.volume=73;edited.settings.panLeft=4;
  project.writeTone(path,edited);assert(project.isToneModified(path));
  assert.deepEqual(project.readTone(path,{version:'saved'}).preset,preset);
  const recovered=createSynthProject({snapshot:project.snapshot()});
  assert.equal(recovered.autoApply,false);assert.deepEqual(recovered.readTone(path).preset,edited);
  assert.deepEqual(recovered.readTone(path,{version:'saved'}).preset,preset);
  const copy=project.duplicate(path);assert.equal(copy,'/presets/Full copy.pcm.json');
  assert.equal(project.duplicate(path),'/presets/Full copy-2.pcm.json');
  const renamed=project.rename(copy,'Kit');assert.equal(renamed,'/presets/Kit.pcm.json');
  project.mkdir('/presets/Bank');project.move(renamed,'/presets/Bank/Kit.pcm.json');
  assert.deepEqual(project.readTone('/presets/Bank/Kit.pcm.json').preset,edited);
  assert.equal(project.savedFs.has('/presets/Bank/Kit.pcm.json'),false,'new unsaved copies have no accepted version');
  project.saveTone('/presets/Bank/Kit.pcm.json');
  const next=structuredClone(edited);next.settings.volume=12;project.writeTone('/presets/Bank/Kit.pcm.json',next);
  assert.deepEqual(project.discardTone('/presets/Bank/Kit.pcm.json').preset,edited);
  project.fs.writeText(synthStatePath(path),'opaque neighboring file');
  const before=project.snapshot();assert.throws(()=>project.move(path,'/presets/Wrong.psg.json'));assert.deepEqual(project.snapshot(),before);
  project.delete(path);assert(!project.fs.has(path));assert(project.savedFs.has(path),'manual deletion remains pending until Save');
  project.saveFiles([path]);assert.equal(project.savedFs.has(path),false);
  assert.equal(project.fs.get(synthStatePath(path)).data,'opaque neighboring file');
  assert(!project.isToneModified('/presets/Bank/Kit.pcm.json'));
});

test('standalone PCM import and mixed FM/PSG/PCM Cassette preserve exact bytes, opaque files and empty folders',async()=>{
  const project=createSynthProject(),preset=sample(),original=' \n'+JSON.stringify(preset)+'\n\n';
  project.writeTone('/presets/FM.vgi',fm);project.writeTone('/presets/Noise.psg.json',createPsgPreset({source:'noise'}));
  project.fs.writeBinary('/.git/objects/aa/sample.pcm.json',new Uint8Array([255,0,13]));
  project.fs.writeText('/opaque/other.json','not JSON');project.mkdir('/empty');
  const result=await project.importInstrumentFiles([file('Sample.pcm.json',original),file('broken.pcm.json','{}')],{directory:'/presets'});
  assert.deepEqual(result.paths,['/presets/Sample.pcm.json']);assert.equal(result.failures.length,1);
  assert.equal(project.fs.get(result.paths[0]).data,original);assert.deepEqual(project.readTone(result.paths[0]).preset,preset);
  const archive=project.exportCassette(),loaded=await loadPlaygroundCassette(archive),restored=createSynthProject();
  assert.deepEqual(loaded.files.get('presets/Sample.pcm.json'),new TextEncoder().encode(original));
  await restored.importCassette(archive);assert.deepEqual(restored.readTone(result.paths[0]).preset,preset);
  assert.equal(restored.readTone('/presets/Noise.psg.json').format,'psg');assert.equal(restored.readTone('/presets/FM.vgi').format,'vgi');
  assert.deepEqual(restored.fs.get('/.git/objects/aa/sample.pcm.json').data,new Uint8Array([255,0,13]));
  assert(restored.fs.listDirectories().includes('/empty'));
  const before=project.snapshot();await project.importInstrumentFiles([file('bad.pcm.json',JSON.stringify({...preset,sample:{...preset.sample,data:'!'}}))]);
  assert.deepEqual(project.snapshot(),before);
});

test('malformed PCM in either version rejects snapshot and recovery Cassette replacement atomically',async()=>{
  const project=createSynthProject(),preset=sample(),path=project.createTone(preset,'Saved').path;project.syncTone(path);
  project.setAutoApply(false);project.writeTone(path,{...preset,settings:{...preset.settings,volume:33}});
  const snapshot=project.snapshot();
  for(const version of ['working','saved'])for(const invalid of [
    {...preset,version:2},{...preset,settings:{...preset.settings,panRight:16}},
    {...preset,sample:{...preset.sample,data:Buffer.alloc(PCM_MAX_FRAMES+1,128).toString('base64')}},
  ]) {
    const data=JSON.stringify(invalid),candidate=structuredClone(snapshot);
    candidate.workspace[version].files.find(entry=>entry.path===path).data=data;
    if(version==='working')candidate.files.find(entry=>entry.path===path).data=data;
    assert.throws(()=>project.restore(candidate));assert.deepEqual(project.snapshot(),snapshot);
    const cassette=await loadPlaygroundCassette(project.exportCassette({includeWorkingState:true})),metadata=structuredClone(cassette.metadata),files=project.savedFs.list();
    if(version==='saved')files.find(entry=>entry.path===path).data=data;
    else {const delta=metadata.tetoricaWorkingState;delta.files=delta.files.filter(entry=>entry.path!==path);delta.files.push({path,type:'text',data});}
    await assert.rejects(project.importCassette(createPlaygroundCassetteZip(files,{directories:project.savedFs.listDirectories(),metadata})));
    assert.deepEqual(project.snapshot(),snapshot);
  }
});
