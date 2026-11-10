import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthProject,isSynthTonePath,isPsgTonePath,synthStatePath,synthToneExtension} from './synth_project.js';
import {createPsgPreset,serializePsgPreset} from './synth_psg_preset.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';

const tone=createPsgPreset(),noise=createPsgPreset({source:'noise',noiseType:'periodic',noiseRate:'tone3',attenuation:4,
  envelope:{enabled:true,attackMs:40,decayMs:250,sustain:35,releaseMs:420}});
const fm={algorithm:7,feedback:0,operators:{1:{tl:127},4:{tl:24}}};
const text=data=>typeof data==='string'?data:new TextDecoder().decode(data);
const file=(name,data)=>({name,data:typeof data==='string'?new TextEncoder().encode(data):data});

test('PSG create/read/write uses a single text file with complete settings and no FM sidecar',()=>{
  const project=createSynthProject(),created=project.createTone(tone,'Square');
  assert.equal(created.path,'/presets/Square.psg.json');assert.equal(created.format,'psg');
  assert.deepEqual(created.preset,tone);assert.equal(project.fs.get(created.path).type,'text');
  assert.equal(project.fs.has(synthStatePath(created.path)),false);
  assert.deepEqual(created.bytes,new TextEncoder().encode(serializePsgPreset(tone)));
  created.preset.settings.attenuation=0;created.bytes.fill(0);
  assert.deepEqual(project.readTone(created.path).preset,tone);
  assert.equal(synthToneExtension(created.path),'.psg.json');assert(isPsgTonePath(created.path));
  for(const path of ['/.git/refs/heads/tone.psg.json','/.tet.ss/presets/tone.psg.json','/data.json'])assert(!isSynthTonePath(path));
  const before=project.snapshot();
  for(const bad of [{...tone,version:3},{...tone,kind:'other'},{...tone,settings:{source:'tone'}},
    {...tone,settings:{...tone.settings,envelope:{...tone.settings.envelope,releaseMs:-1}}}]) {
    assert.throws(()=>project.writeTone(created.path,bad));assert.throws(()=>project.createTone(bad,'Rejected'));
    assert.deepEqual(project.snapshot(),before);
  }
  assert.throws(()=>project.writeTone(created.path,noise,{expectedRevision:999}),/Revision conflict/);
  assert.throws(()=>project.writeTone(created.path,noise,{overwrite:false}),/already exists/);
  assert.throws(()=>project.writeTone(created.path,noise,{format:'vgi'}));
  assert.throws(()=>project.writeTone('/presets/wrong.vgi',tone));
  assert.throws(()=>project.writeTone(created.path,fm));
  assert.deepEqual(project.snapshot(),before);
});

test('PSG edits, Sync/Revert and snapshots keep one complete checkpoint and leave FM pairs untouched',()=>{
  const project=createSynthProject(),path=project.createTone(tone,'Square').path;
  project.writeTone('/presets/FM.vgi',fm);project.syncTone('/presets/FM.vgi');
  const fmFiles=[project.fs.get('/presets/FM.vgi'),project.fs.get(synthStatePath('/presets/FM.vgi'))];
  project.writeTone(path,noise);
  assert.deepEqual(JSON.parse(text(project.fs.checkpoints.get(path).data)),tone);
  assert(project.isToneModified(path));assert(!project.fs.has('/.tet.ss'+synthStatePath(path)));
  assert.deepEqual(project.revertTone(path).preset,tone);assert(!project.isToneModified(path));
  project.writeTone(path,noise);project.syncTone(path);assert(!project.isToneModified(path));
  project.writeTone(path,tone);assert(project.isToneModified(path));
  const restored=createSynthProject({snapshot:project.snapshot()});
  assert.deepEqual(restored.readTone(path).preset,tone);assert.deepEqual(restored.revertTone(path).preset,noise);
  assert.deepEqual(fmFiles,[project.fs.get('/presets/FM.vgi'),project.fs.get(synthStatePath('/presets/FM.vgi'))]);
});

test('PSG compound extensions and checkpoints follow duplicate/rename/move/delete without treating opaque files as sidecars',()=>{
  const project=createSynthProject(),path=project.createTone(tone,'Square').path;
  project.syncTone(path);project.writeTone(path,noise);
  project.fs.writeText(synthStatePath(path),'opaque neighbor');
  const copy=project.duplicate(path);assert.equal(copy,'/presets/Square copy.psg.json');
  assert.equal(project.duplicate(path),'/presets/Square copy-2.psg.json');
  const renamed=project.rename(copy,'Percussion');assert.equal(renamed,'/presets/Percussion.psg.json');
  project.mkdir('/presets/Kit');project.move(renamed,'/presets/Kit/Percussion.psg.json');
  assert.deepEqual(project.readTone('/presets/Kit/Percussion.psg.json').preset,noise);
  assert.deepEqual(project.revertTone('/presets/Kit/Percussion.psg.json').preset,tone);
  assert.equal(project.fs.has('/presets/Kit/Percussion.psg.json.synth.json'),false);
  project.delete(path);assert.equal(project.fs.has(path),false);assert.equal(project.fs.checkpoints.has(path),false);
  assert.equal(project.fs.get(synthStatePath(path)).data,'opaque neighbor');
  const before=project.snapshot();
  assert.throws(()=>project.move('/presets/Kit/Percussion.psg.json','/presets/wrong.vgi'));
  project.writeTone('/presets/FM.vgi',fm);const withFm=project.snapshot();
  assert.throws(()=>project.move('/presets/FM.vgi','/presets/wrong.psg.json'));
  assert.deepEqual(project.snapshot(),withFm);assert(before.files.length>0);
  project.fs.writeText('/.tet.ss/presets/Fresh.psg.json',serializePsgPreset(tone));
  assert.equal(project.createTone(tone,'Fresh').path,'/presets/Fresh-2.psg.json','orphan checkpoint names are not reused');
});

test('standalone PSG imports validate before a single append and retain original UTF-8 text',async()=>{
  const project=createSynthProject();project.mkdir('/presets/Drop');
  const original='  '+JSON.stringify(noise)+'\n\n';let commits=0;project.onDidChange(()=>commits++);
  const result=await project.importInstrumentFiles([file('Snare.psg.json',original),file('Snare.psg.json',original),file('broken.psg.json','{}')],{directory:'/presets/Drop'});
  assert.equal(commits,1);assert.deepEqual(result.paths,['/presets/Drop/Snare.psg.json','/presets/Drop/Snare-2.psg.json']);
  assert.equal(result.failures.length,1);assert.equal(project.fs.get(result.paths[0]).data,original);
  assert.deepEqual(project.readTone(result.paths[0]).preset,noise);
  const before=project.snapshot();
  await project.importInstrumentFiles([file('bad.psg.json',new Uint8Array([255])),file('unknown.psg.json',JSON.stringify({...tone,settings:{...tone.settings,voices:[]}}))]);
  assert.deepEqual(project.snapshot(),before);
  const folderImport=await project.importInstrumentFiles([file('Bass.psg.json',serializePsgPreset(tone))]);
  assert.deepEqual(folderImport.paths,['/presets/Bass/Bass.psg.json']);
});

test('mixed FM/PSG Cassettes preserve original bytes, Git and unknown data; invalid current or saved PSG documents reject atomically',async()=>{
  const project=createSynthProject(),path=project.createTone(tone,'Square').path;
  project.syncTone(path);project.writeTone(path,noise);project.writeTone('/presets/FM.vgi',fm);
  project.fs.writeBinary('/.git/objects/aa/tone.psg.json',new Uint8Array([255,0,128]));
  project.fs.writeText('/misc/unknown.json','not JSON');project.mkdir('/empty');
  const snapshot=project.snapshot(),archive=project.exportCassette(),cassette=await loadPlaygroundCassette(archive),restored=createSynthProject();
  await restored.importCassette(archive);
  assert.deepEqual(restored.readTone(path).preset,noise);assert.deepEqual(restored.revertTone(path).preset,tone);
  assert.deepEqual(cassette.files.get(path.slice(1)),new TextEncoder().encode(project.fs.get(path).data));
  assert.deepEqual(restored.fs.get('/.git/objects/aa/tone.psg.json').data,new Uint8Array([255,0,128]));
  assert(restored.fs.listDirectories().includes('/empty'));
  for(const badPath of [path,'/.tet.ss'+path]) {
    const bad=structuredClone(snapshot);bad.files.find(file=>file.path===badPath).data='{"version":99}';
    const before=project.snapshot();assert.throws(()=>project.restore(bad));assert.deepEqual(project.snapshot(),before);
    const badZip=createPlaygroundCassetteZip(bad.files,{directories:bad.directories});
    await assert.rejects(project.importCassette(badZip));assert.deepEqual(project.snapshot(),before);
  }
});

test('legacy PSG imports and saved checkpoints keep exact v1 bytes until an explicit v2 envelope edit',async()=>{
  const project=createSynthProject(),legacy={version:1,kind:'tetorica-sega-psg',settings:{source:'noise',attenuation:5,noiseType:'white',noiseRate:'low'}};
  const original='  '+JSON.stringify(legacy)+'\n\n';
  const imported=await project.importInstrumentFiles([file('Legacy.psg.json',original)],{directory:'/presets'}),path=imported.paths[0];
  const migrated=createPsgPreset(legacy.settings);
  assert.equal(project.fs.get(path).data,original);assert.deepEqual(project.readTone(path).preset,migrated);
  assert.equal(project.fs.get(path).data,original,'read does not silently rewrite an old document');
  const archive=await loadPlaygroundCassette(project.exportCassette());
  assert.deepEqual(archive.files.get(path.slice(1)),new TextEncoder().encode(original));
  project.syncTone(path);
  assert.equal(project.fs.checkpoints.get(path).data,original,'Sync retains the actual legacy bytes as the saved point');
  project.writeTone(path,noise);
  assert.equal(JSON.parse(project.fs.get(path).data).version,2);assert.deepEqual(project.readTone(path).preset,noise);
  assert.equal(project.fs.checkpoints.get(path).data,original,'an edit never retrofits the old checkpoint');
  const restored=createSynthProject();await restored.importCassette(project.exportCassette());
  assert.deepEqual(restored.readTone(path).preset,noise);
  assert.deepEqual(restored.revertTone(path).preset,migrated);assert.equal(restored.readTone(path).preset.settings.envelope.enabled,false);
  assert.deepEqual(restored.fs.get(path).data,new TextEncoder().encode(original),'Revert restores original bytes as well as Envelope Off');
  project.syncTone(path);assert.equal(JSON.parse(project.fs.checkpoints.get(path).data).version,2);
  project.writeTone(path,tone);assert.deepEqual(project.revertTone(path).preset,noise,'new version 2 checkpoints retain the full envelope');
});

test('malformed software envelopes in current or saved v2 documents reject snapshot and Cassette restoration atomically',async()=>{
  const project=createSynthProject(),path=project.createTone(noise,'Envelope').path;project.syncTone(path);
  const snapshot=project.snapshot();
  for(const badPath of [path,'/.tet.ss'+path])for(const envelope of [
    {...noise.settings.envelope,sustain:-1},{...noise.settings.envelope,attackMs:0.5},{enabled:true},
  ]) {
    const bad=structuredClone(snapshot),document=structuredClone(noise);document.settings.envelope=envelope;
    bad.files.find(file=>file.path===badPath).data=JSON.stringify(document);
    assert.throws(()=>project.restore(bad));assert.deepEqual(project.snapshot(),snapshot);
    await assert.rejects(project.importCassette(createPlaygroundCassetteZip(bad.files,{directories:bad.directories})));
    assert.deepEqual(project.snapshot(),snapshot);
  }
});
