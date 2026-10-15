import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthProject,synthStatePath,isSynthStatePath} from './synth_project.js';
import {createTfiFromPreset} from '../js/tfi.js';
import {createVgiFromPreset} from '../js/vgi.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';

const preset={algorithm:4,feedback:2,pan:{left:false,right:true},ams:2,pms:5,lfo:{enabled:false,frequency:0},operators:{1:{tl:12,ar:31,am:false},2:{tl:22},3:{tl:32},4:{tl:42}}};
const readState=(project,path,checkpoint=false)=>{
  const file=checkpoint?project.fs.checkpoints.get(synthStatePath(path)):project.fs.get(synthStatePath(path));
  return JSON.parse(typeof file.data==='string'?file.data:new TextDecoder().decode(file.data));
};
const edited=base=>({...base,lfo:{enabled:true,frequency:6},operators:{...base.operators,1:{...base.operators[1],am:true}}});

test('Synth first LFO/AM-only edit captures both original files and Sync/Revert preserve the full sound',()=>{
  const project=createSynthProject(),path='/presets/lead.tfi',bytes=createTfiFromPreset(preset);
  project.fs.writeBinary(path,bytes);
  assert.equal(project.fs.checkpoints.auto,true);assert.equal(project.fs.has(synthStatePath(path)),false);
  const base=project.readTone(path).preset;
  project.writeTone(path,edited(base),{baselinePreset:base});
  assert.deepEqual(project.fs.get(path).data,bytes,'metadata-only changes keep portable bytes');
  assert.deepEqual(project.fs.checkpoints.get(path).data,bytes);
  assert.equal(readState(project,path).lfo.enabled,true);assert.equal(readState(project,path,true).lfo.enabled,false);
  assert.equal(readState(project,path).operatorAM[0],true);assert.equal(readState(project,path,true).operatorAM[0],false);
  assert.equal(project.isToneModified(path),true);
  const synced=project.syncTone(path);assert.equal(synced.preset.lfo.frequency,6);assert.equal(project.isToneModified(path),false);
  project.writeTone(path,{...synced.preset,lfo:{enabled:false,frequency:1}});
  const restored=project.revertTone(path);assert.equal(restored.preset.lfo.enabled,true);assert.equal(restored.preset.lfo.frequency,6);
  assert.equal(restored.preset.operators[1].am,true);assert.equal(project.isToneModified(path),false);
});

test('TFI metadata retains pan/AMS/PMS/B4 while VGI keeps those fields in the portable binary',()=>{
  for(const format of ['tfi','vgi']){
    const project=createSynthProject(),path='/presets/tone.'+format;
    project.writeTone(path,{...edited(preset),b4:0x6d});
    const state=readState(project,path),tone=project.readTone(path);
    assert.equal(isSynthStatePath(synthStatePath(path)),true);
    assert.equal(state.kind,'tetorica-fm2612-synth');assert.equal(state.version,1);
    assert.deepEqual(tone.preset.pan,{left:false,right:true});assert.equal(tone.preset.ams,2);assert.equal(tone.preset.pms,5);
    assert.equal(tone.preset.b4&8,8);assert.equal(tone.preset.lfo.enabled,true);assert.equal(tone.preset.operators[1].am,true);
    assert.equal(Object.hasOwn(state,'pan'),format==='tfi');
  }
});

test('sidecar and both checkpoints follow duplicate, rename, move and deletion; collisions are validated first',()=>{
  const project=createSynthProject(),path='/presets/lead.vgi';
  project.writeTone(path,preset);project.syncTone(path);project.writeTone(path,edited(preset));
  const copy=project.duplicate(path),renamed=project.rename(copy,'choir');
  assert.equal(project.fs.has(synthStatePath(copy)),false);
  assert.equal(project.readTone(renamed).preset.lfo.enabled,true);
  assert.equal(project.fs.checkpoints.has(synthStatePath(renamed)),true);
  project.mkdir('/presets/set');project.move(renamed,'/presets/set/choir.vgi');
  project.move('/presets/set','/presets/album');
  assert.equal(project.readTone('/presets/album/choir.vgi').preset.operators[1].am,true);
  project.fs.writeText('/presets/blocked.vgi.synth.json','do not overwrite');
  const before=project.snapshot();assert.throws(()=>project.move(path,'/presets/blocked.vgi'));assert.deepEqual(project.snapshot(),before);
  project.delete('/presets/album/choir.vgi');
  assert.equal(project.fs.has('/presets/album/choir.vgi.synth.json'),false);
  assert.equal(project.fs.has('/.tet.ss/presets/album/choir.vgi.synth.json'),false);
  assert.equal(project.fs.has('/.tet.ss/presets/album/choir.vgi'),false);
  assert.equal(project.readTone(path).preset.lfo.enabled,true,'the original remains independent');
});

test('Cassette and snapshot restore both current and saved extra parameters without materializing untouched imports',async()=>{
  const untouched=createSynthProject(),path='/presets/lead.vgi';
  const zip=createPlaygroundCassetteZip([{path,type:'binary',data:createVgiFromPreset(preset)}]);
  await untouched.importCassette(zip);assert.equal(untouched.fs.has(synthStatePath(path)),false);
  const base=untouched.readTone(path).preset;untouched.writeTone(path,edited(base),{baselinePreset:base});
  const restored=createSynthProject({snapshot:untouched.snapshot()});
  assert.equal(restored.readTone(path).preset.lfo.frequency,6);
  const exported=await loadPlaygroundCassette(untouched.exportCassette());
  assert(exported.files.has('presets/lead.vgi.synth.json'));assert(exported.files.has('.tet.ss/presets/lead.vgi.synth.json'));
  const imported=createSynthProject();await imported.importCassette(untouched.exportCassette());
  assert.equal(imported.readTone(path).preset.operators[1].am,true);
  assert.equal(imported.revertTone(path).preset.operators[1].am,false);
});

test('invalid sidecars and presets fail safely, while legacy binary-only checkpoints use deterministic extra defaults',async()=>{
  const project=createSynthProject(),path='/presets/lead.tfi';
  project.fs.writeBinary(path,createTfiFromPreset(preset));
  const before=project.snapshot();assert.throws(()=>project.writeTone(path,{...preset,lfo:{enabled:'wrong',frequency:2}}));assert.deepEqual(project.snapshot(),before);
  project.fs.checkpoints.set(path);
  project.writeTone(path,edited(project.readTone(path).preset));
  assert.equal(project.revertTone(path).preset.lfo.enabled,false);
  const stable=project.snapshot();
  const bad=createPlaygroundCassetteZip([{path,type:'binary',data:createTfiFromPreset(preset)},{path:synthStatePath(path),type:'text',data:'{"version":99}'}]);
  await assert.rejects(project.importCassette(bad),/Synth state/);assert.deepEqual(project.snapshot(),stable);
});
