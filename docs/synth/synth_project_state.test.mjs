import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthProject,synthStatePath,isSynthStatePath} from './synth_project.js';
import {createTfiFromPreset} from '../js/tfi.js';
import {createVgiFromPreset} from '../js/vgi.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';

const preset={algorithm:4,feedback:2,pan:{left:false,right:true},ams:2,pms:5,lfo:{enabled:false,frequency:0},operators:{1:{tl:12,ar:31,am:false},2:{tl:22},3:{tl:32},4:{tl:42}}};
const readState=(project,path,saved=false)=>{
  const file=(saved?project.savedFs:project.fs).get(synthStatePath(path));
  return JSON.parse(typeof file.data==='string'?file.data:new TextDecoder().decode(file.data));
};
const edited=base=>({...base,lfo:{enabled:true,frequency:6},operators:{...base.operators,1:{...base.operators[1],am:true}}});

test('Auto apply accepts FM binary and metadata together while manual Save/discard preserve the full sound',()=>{
  const project=createSynthProject(),path='/presets/lead.tfi',bytes=createTfiFromPreset(preset);
  project.fs.writeBinary(path,bytes);
  assert.equal(project.autoApply,true);assert.equal(project.fs.checkpoints.auto,false);assert.equal(project.fs.has(synthStatePath(path)),false);
  const base=project.readTone(path).preset;
  project.writeTone(path,edited(base),{baselinePreset:base});
  assert.deepEqual(project.fs.get(path).data,bytes,'metadata-only changes keep portable bytes');
  assert.deepEqual(project.savedFs.get(path).data,bytes);
  assert.equal(readState(project,path).lfo.enabled,true);assert.equal(readState(project,path,true).lfo.enabled,true);
  assert.equal(readState(project,path).operatorAM[0],true);assert.equal(readState(project,path,true).operatorAM[0],true);
  assert.equal(project.isToneModified(path),false);
  project.setAutoApply(false);project.writeTone(path,{...base,feedback:5,lfo:{enabled:false,frequency:1}});
  assert.equal(project.isToneModified(path),true);assert.equal(project.readTone(path,{version:'saved'}).preset.feedback,base.feedback);
  const saved=project.saveTone(path);assert.equal(saved.preset.feedback,5);assert.equal(saved.preset.lfo.frequency,1);assert.equal(project.isToneModified(path),false);
  project.writeTone(path,edited(saved.preset));
  const restored=project.discardTone(path);assert.equal(restored.preset.lfo.enabled,false);assert.equal(restored.preset.lfo.frequency,1);
  assert.equal(restored.preset.operators[1].am,false);assert.equal(project.isToneModified(path),false);
});

test('manual first edit of an untouched TFI retains a binary-only saved version until Save',()=>{
  const project=createSynthProject(),path='/presets/imported.tfi',bytes=createTfiFromPreset(preset);
  project.fs.writeBinary(path,bytes);project.setAutoApply(false);
  const base=project.readTone(path).preset;project.writeTone(path,edited(base));
  assert.equal(project.savedFs.has(synthStatePath(path)),false);
  assert.equal(project.readTone(path,{version:'saved'}).preset.lfo.enabled,false);
  assert.equal(project.readTone(path).preset.lfo.enabled,true);assert.equal(project.isToneModified(path),true);
  project.discardTone(path);assert.equal(project.fs.has(synthStatePath(path)),false);assert.deepEqual(project.fs.get(path).data,bytes);
  project.writeTone(path,edited(base));project.saveTone(path);
  assert.equal(project.savedFs.has(synthStatePath(path)),true);assert.equal(project.readTone(path,{version:'saved'}).preset.operators[1].am,true);
  project.writeTone(path,base);const restored=project.discardTone(path);
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

test('Auto apply keeps saved sidecars aligned through duplicate, rename, move and deletion; collisions validate first',()=>{
  const project=createSynthProject(),path='/presets/lead.vgi';
  project.writeTone(path,preset);project.writeTone(path,edited(preset));
  const copy=project.duplicate(path),renamed=project.rename(copy,'choir');
  assert.equal(project.fs.has(synthStatePath(copy)),false);
  assert.equal(project.readTone(renamed).preset.lfo.enabled,true);
  assert.equal(project.savedFs.has(synthStatePath(renamed)),true);
  project.mkdir('/presets/set');project.move(renamed,'/presets/set/choir.vgi');
  project.move('/presets/set','/presets/album');
  assert.equal(project.readTone('/presets/album/choir.vgi').preset.operators[1].am,true);
  assert.equal(project.readTone('/presets/album/choir.vgi',{version:'saved'}).preset.operators[1].am,true);
  project.fs.writeText('/presets/blocked.vgi.synth.json','do not overwrite');
  const before=project.snapshot();assert.throws(()=>project.move(path,'/presets/blocked.vgi'));assert.deepEqual(project.snapshot(),before);
  project.delete('/presets/album/choir.vgi');
  assert.equal(project.fs.has('/presets/album/choir.vgi.synth.json'),false);
  assert.equal(project.savedFs.has('/presets/album/choir.vgi.synth.json'),false);
  assert.equal(project.savedFs.has('/presets/album/choir.vgi'),false);
  assert.equal(project.readTone(path).preset.lfo.enabled,true,'the original remains independent');
});

test('v2 snapshot and recovery Cassette retain independent FM versions without materializing untouched saved imports',async()=>{
  const untouched=createSynthProject(),path='/presets/lead.vgi';
  const zip=createPlaygroundCassetteZip([{path,type:'binary',data:createVgiFromPreset(preset)}]);
  await untouched.importCassette(zip);assert.equal(untouched.fs.has(synthStatePath(path)),false);
  untouched.setAutoApply(false);const base=untouched.readTone(path).preset;untouched.writeTone(path,edited(base),{baselinePreset:base});
  const restored=createSynthProject({snapshot:untouched.snapshot()});
  assert.equal(restored.readTone(path).preset.lfo.frequency,6);assert.equal(restored.autoApply,false);
  assert.equal(restored.readTone(path,{version:'saved'}).preset.lfo.enabled,false);
  const bytes=untouched.exportCassette({includeWorkingState:true}),exported=await loadPlaygroundCassette(bytes);
  assert.equal(exported.files.has('presets/lead.vgi.synth.json'),false,'the ordinary ZIP files are the accepted version');
  assert.equal(exported.files.has('.tet.ss/presets/lead.vgi.synth.json'),false);
  assert(exported.metadata.tetoricaWorkingState.files.some(file=>file.path===synthStatePath(path)));
  const imported=createSynthProject();await imported.importCassette(bytes);
  assert.equal(imported.readTone(path).preset.operators[1].am,true);
  assert.equal(imported.readTone(path,{version:'saved'}).preset.operators[1].am,false);assert.equal(imported.autoApply,false);
  assert.equal(imported.discardTone(path).preset.operators[1].am,false);assert.equal(imported.fs.has(synthStatePath(path)),false);
});

test('invalid sidecars, stale revisions and sidecar collisions leave both FM versions unchanged',async()=>{
  const project=createSynthProject(),path='/presets/lead.tfi';
  project.fs.writeBinary(path,createTfiFromPreset(preset));
  const before=project.snapshot();assert.throws(()=>project.writeTone(path,{...preset,lfo:{enabled:'wrong',frequency:2}}));assert.deepEqual(project.snapshot(),before);
  project.setAutoApply(false);
  assert.throws(()=>project.writeTone(path,edited(project.readTone(path).preset),{expectedRevision:999}),/Revision conflict/);
  assert.equal(project.fs.has(synthStatePath(path)),false);assert.equal(project.savedFs.has(synthStatePath(path)),false);
  project.mkdir(synthStatePath(path));const blocked=project.snapshot();
  assert.throws(()=>project.writeTone(path,edited(project.readTone(path).preset)));assert.deepEqual(project.snapshot(),blocked);
  project.fs.remove(synthStatePath(path));
  const stable=project.snapshot();
  const bad=createPlaygroundCassetteZip([{path,type:'binary',data:createTfiFromPreset(preset)},{path:synthStatePath(path),type:'text',data:'{"version":99}'}]);
  await assert.rejects(project.importCassette(bad),/Synth state/);assert.deepEqual(project.snapshot(),stable);
});

test('manual FM Save validates its sidecar before accepting either half of the binary/metadata pair',()=>{
  const project=createSynthProject(),path='/presets/atomic.vgi';project.writeTone(path,preset);project.setAutoApply(false);
  project.writeTone(path,{...edited(preset),feedback:6});
  project.fs.writeText(synthStatePath(path),'{"version":99}');
  const before=project.snapshot(),revisions=project.savedFs.list().map(file=>[file.path,file.revision]);let commits=0;
  project.onDidChange(()=>commits++);
  assert.throws(()=>project.saveTone(path),/Synth state/);
  assert.deepEqual(project.snapshot(),before);assert.deepEqual(project.savedFs.list().map(file=>[file.path,file.revision]),revisions);assert.equal(commits,0);
  assert.equal(project.readTone(path,{version:'saved'}).preset.feedback,preset.feedback);
});

test('legacy v1 projects seed saved from current while v2 restores both layers and validates each layer atomically',()=>{
  const path='/presets/legacy.tfi',bytes=createTfiFromPreset(preset);
  const legacy={version:1,files:[{path,type:'binary',data:bytes},{path:'/.tet.ss'+path,type:'binary',data:createTfiFromPreset({...preset,feedback:6})}],directories:['/','/presets','/.tet.ss','/.tet.ss/presets']};
  const project=createSynthProject({snapshot:legacy});assert.equal(project.autoApply,true);assert.equal(project.isToneModified(path),false);
  assert.deepEqual(project.readTone(path,{version:'saved'}).preset,project.readTone(path).preset);
  assert.equal(project.readTone(path,{version:'saved'}).preset.feedback,preset.feedback,'legacy hidden checkpoints do not replace accepted current contents');
  assert(project.fs.has('/.tet.ss'+path));
  project.setAutoApply(false);project.writeTone(path,edited(project.readTone(path).preset));const stable=project.snapshot();assert.equal(stable.version,2);
  const restored=createSynthProject({snapshot:stable});assert.equal(restored.isToneModified(path),true);
  for(const version of ['working','saved']) {
    const bad=structuredClone(stable),files=bad.workspace[version].files;
    if(!files.some(file=>file.path===synthStatePath(path)))files.push({path:synthStatePath(path),type:'text',data:'{"version":99}'});
    else files.find(file=>file.path===synthStatePath(path)).data='{"version":99}';
    if(version==='working')bad.files=structuredClone(files);
    assert.throws(()=>project.restore(bad),/Synth state/);assert.deepEqual(project.snapshot(),stable);
  }
});
