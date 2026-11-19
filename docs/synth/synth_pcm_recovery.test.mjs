import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthProject,synthStatePath} from './synth_project.js';
import {createPcmBuiltinPreset,normalizePcmPreset,PCM_MAX_FRAMES} from './synth_pcm.js';
import {createPsgPreset} from './synth_psg_preset.js';
import {createToneRecovery,parseToneRecovery} from './synth_recovery.js';


function restoreRecovery(value){const project=createSynthProject();project.restore({version:2,workspace:{version:1,working:{version:1,files:value.entries,directories:[]},saved:{version:1,files:value.savedEntries,directories:[]},autoSave:false}});return project;}
const path='/presets/Full.pcm.json';
function full() {
  const preset=createPcmBuiltinPreset('sine');preset.sample.data=Buffer.alloc(PCM_MAX_FRAMES,128).toString('base64');
  preset.settings.loopEnd=PCM_MAX_FRAMES;return normalizePcmPreset(preset);
}
function setup(){const preset=full(),project=createSynthProject();project.writeTone(path,preset);project.syncTone(path);project.setAutoApply(false);
  const changed=structuredClone(preset);changed.settings.volume=51;project.writeTone(path,changed);return {preset,changed,project};}

test('full-size PCM journals retain current and checkpoint documents within the PCM-only 384 KiB allowance',()=>{
  const {preset,changed,project}=setup(),before=project.snapshot();
  project.fs.writeBinary('/audio/large.wav',new Uint8Array(1024*1024));
  const withOpaque=project.snapshot(),raw=createToneRecovery(project,path,'pcm-workspace',5);
  assert(Buffer.byteLength(raw)>128*1024);assert(Buffer.byteLength(raw)<384*1024);assert(!raw.includes('large.wav'));
  const value=parseToneRecovery(raw);assert.deepEqual(project.snapshot(),withOpaque);
  assert.deepEqual(value.entries.map(entry=>entry.path),[path]);
  const restored=restoreRecovery(value);
  assert.deepEqual(restored.readTone(path).preset,changed);assert.deepEqual(restored.revertTone(path).preset,preset);
  assert(before.files.length>0);
});

test('PCM Cassette binary documents compact to byte-equivalent UTF-8 journal text without mutating the source VFS',async()=>{
  const {project,preset,changed}=setup(),imported=createSynthProject();await imported.importCassette(project.exportCassette({version:'saved'}));imported.setAutoApply(false);imported.writeTone(path,changed);
  assert.equal(imported.savedFs.get(path).type,'binary');assert.equal(imported.savedFs.get(path).type,'binary');
  const before=imported.snapshot(),raw=createToneRecovery(imported,path,'pcm-cassette',7),parsed=parseToneRecovery(raw);
  assert(Buffer.byteLength(raw)<384*1024);assert.deepEqual(imported.snapshot(),before);
  for(const [entries,store]of [[parsed.entries,imported.fs],[parsed.savedEntries,imported.savedFs]]) {
    const entry=entries.find(file=>file.path===path);assert.equal(entry.type,'text');
    const data=store.get(path).data;assert.deepEqual(new TextEncoder().encode(entry.data),typeof data==='string'?new TextEncoder().encode(data):data);
  }
  const restored=restoreRecovery(parsed);
  assert.deepEqual(restored.readTone(path).preset,changed);assert.deepEqual(restored.revertTone(path).preset,preset);
});

test('PCM journal limit does not weaken legacy FM/PSG limits or permit foreign paths and incomplete data',()=>{
  const {project}=setup(),good=JSON.parse(createToneRecovery(project,path,'pcm-bad',1));
  for(const mutate of [
    value=>value.entries.push({path:synthStatePath(path),type:'text',data:'{}'}),
    value=>{value.entries=value.entries.filter(entry=>entry.path!==path);},
    value=>{value.entries[0].data='{}';},
    value=>{value.savedEntries.find(entry=>entry.path===path).data='{}';},
    value=>{value.activeTonePath='/sys/Full.pcm.json';},
    value=>{value.activeTonePath='/.git/refs/heads/Full.pcm.json';},
    value=>{value.entries.push({path:'/.gitignore',type:'text',data:'x'.repeat(384*1024)});},
  ]) {const bad=structuredClone(good);mutate(bad);assert.throws(()=>parseToneRecovery(JSON.stringify(bad)));}
  assert.throws(()=>parseToneRecovery(' '.repeat(384*1024+1)),/384 KiB/);
  for(const [legacy,preset]of [['/presets/Old.psg.json',createPsgPreset()],['/presets/Old.vgi',{algorithm:7,operators:{4:{tl:24}}}]]) {
    const old=createSynthProject();old.writeTone(legacy,preset);old.fs.writeText('/.gitignore','x'.repeat(130*1024));
    assert.throws(()=>createToneRecovery(old,legacy,'legacy-size',1),/128 KiB/);
  }
});
