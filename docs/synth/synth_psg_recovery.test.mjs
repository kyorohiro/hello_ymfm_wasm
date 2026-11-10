import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthProject,synthStatePath} from './synth_project.js';
import {createPsgPreset,serializePsgPreset} from './synth_psg_preset.js';
import {createToneRecovery,parseToneRecovery} from './synth_recovery.js';

const tone=createPsgPreset(),noise=createPsgPreset({source:'noise',noiseType:'periodic',noiseRate:'tone3',attenuation:4});
const path='/presets/Recovery.psg.json';
function setup(saved=true) {
  const project=createSynthProject();project.writeTone(path,tone);
  if(saved){project.syncTone(path);project.writeTone(path,noise);}
  return project;
}

test('PSG recovery version1 stores one current document and only its optional single checkpoint',()=>{
  const fresh=setup(false),single=JSON.parse(createToneRecovery(fresh,path,'workspace-psg',0));
  assert.equal(single.version,1);assert.equal(single.entries.length,1);assert.equal(single.entries[0].path,path);
  const project=setup();project.fs.writeBinary('/samples/large.wav',new Uint8Array(1024*1024));
  project.fs.writeText(synthStatePath(path),'opaque neighbor');
  const before=project.snapshot(),raw=createToneRecovery(project,path,'workspace-psg',3),parsed=parseToneRecovery(raw);
  assert.deepEqual(parsed.entries.map(entry=>entry.path),[path,'/.tet.ss'+path,'/.gitignore']);
  assert(!raw.includes('large.wav'));assert(!raw.includes('opaque neighbor'));assert.deepEqual(project.snapshot(),before);
  const restored=createSynthProject();restored.fs.writeFiles(parsed.entries,{checkpointChanges:false});
  assert.deepEqual(restored.readTone(path).preset,noise);assert.deepEqual(restored.revertTone(path).preset,tone);
});

test('PSG recovery accepts validated UTF-8 bytes from Cassette while retaining detached current and saved documents',async()=>{
  const project=setup(),imported=createSynthProject();await imported.importCassette(project.exportCassette());
  assert.equal(imported.fs.get(path).type,'binary');
  const raw=createToneRecovery(imported,path,'workspace-psg',4),parsed=parseToneRecovery(raw);
  const restored=createSynthProject();restored.fs.writeFiles(parsed.entries,{checkpointChanges:false});
  assert.deepEqual(restored.readTone(path).preset,noise);assert.deepEqual(restored.revertTone(path).preset,tone);
  parsed.entries.find(entry=>entry.path===path).data.fill(0);
  assert.deepEqual(imported.readTone(path).preset,noise,'recovery bytes are detached from the live project');
});

test('PSG recovery rejects sidecar injection, missing documents, invalid checkpoints and foreign chip/version settings',()=>{
  const raw=createToneRecovery(setup(),path,'workspace-psg',1),good=JSON.parse(raw);
  const reject=value=>assert.throws(()=>parseToneRecovery(JSON.stringify(value)));
  for(const mutation of [
    value=>{value.entries=value.entries.filter(entry=>entry.path!==path);},
    value=>{value.entries.push({path:synthStatePath(path),type:'text',data:'{}'});},
    value=>{value.entries.push({path:'/.tet.ss'+synthStatePath(path),type:'text',data:'{}'});},
    value=>{value.entries[0].data=serializePsgPreset(tone).replace('"version": 1','"version": 2');},
    value=>{value.entries[0].data='{"version":1,"kind":"tetorica-fm2612"}';},
    value=>{value.entries.find(entry=>entry.path==='/.tet.ss'+path).data='{}';},
    value=>{value.entries[0]={...value.entries[0],type:'binary',data:[255,254]};},
    value=>{value.activeTonePath='/.git/refs/heads/Recovery.psg.json';},
    value=>{value.activeTonePath='/sys/Recovery.psg.json';},
  ]){const bad=structuredClone(good);mutation(bad);reject(bad);}
  const noCheckpoint=structuredClone(good);noCheckpoint.entries=noCheckpoint.entries.filter(entry=>entry.path!=='/.tet.ss'+path);
  assert.deepEqual(parseToneRecovery(JSON.stringify(noCheckpoint)).activeTonePath,path,'the single PSG checkpoint is optional');
  const project=setup(),before=project.snapshot();project.fs.writeText('/.tet.ss'+path,'{}');
  const invalid=project.snapshot();assert.throws(()=>createToneRecovery(project,path,'workspace-psg',1));
  assert.deepEqual(project.snapshot(),invalid,'producing a rejected journal does not modify the current project');
  assert.notDeepEqual(invalid,before);
});

test('adding single-file PSG journals does not accept incomplete legacy FM pairs',()=>{
  const project=createSynthProject(),fmPath='/presets/Legacy.vgi';
  project.writeTone(fmPath,{algorithm:7,operators:{4:{tl:24}}});project.syncTone(fmPath);
  const value=JSON.parse(createToneRecovery(project,fmPath,'workspace-fm',1));
  for(const removed of [synthStatePath(fmPath),'/.tet.ss'+synthStatePath(fmPath)]) {
    const bad=structuredClone(value);bad.entries=bad.entries.filter(entry=>entry.path!==removed);
    assert.throws(()=>parseToneRecovery(JSON.stringify(bad)),/pair/);
  }
});
