import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthProject,synthStatePath} from './synth_project.js';
import {createToneRecovery,parseToneRecovery} from './synth_recovery.js';

const path='/presets/recovery.vgi';
const preset={algorithm:7,feedback:0,lfo:{enabled:false,frequency:0},operators:{1:{tl:0,am:false}}};
function setup(){
  const project=createSynthProject();project.writeTone(path,preset);project.syncTone(path);
  project.writeTone(path,{...preset,lfo:{enabled:true,frequency:6}});
  project.fs.writeBinary('/samples/large.wav',new Uint8Array(1024*1024));
  return project;
}
const json=()=>JSON.parse(createToneRecovery(setup(),path,'workspace-1',2));
const reject=value=>assert.throws(()=>parseToneRecovery(JSON.stringify(value)));

test('recovery contains only the complete small current and checkpoint pairs and never mutates the project',()=>{
  const project=setup(),before=project.snapshot(),raw=createToneRecovery(project,path,'workspace-1',2);
  const restored=parseToneRecovery(raw);
  assert.equal(restored.workspaceId,'workspace-1');assert.equal(restored.generation,2);assert.equal(restored.activeTonePath,path);
  assert.equal(restored.entries.length,5);assert(!raw.includes('large.wav'));
  assert.deepEqual(project.snapshot(),before);
  const target=createSynthProject();target.fs.writeFiles(restored.entries,{checkpointChanges:false});
  assert.equal(target.readTone(path).preset.lfo.enabled,true);
  assert.equal(target.revertTone(path).preset.lfo.enabled,false);
  restored.entries.find(entry=>entry.path===path).data[0]=0;
  assert.equal(project.readTone(path).preset.algorithm,7);
});

test('a newly materialized tone without checkpoints can be recovered as a complete current pair',()=>{
  const project=createSynthProject();project.writeTone(path,preset);
  const result=parseToneRecovery(createToneRecovery(project,path,'workspace:initial',0));
  assert.equal(result.entries.length,2);
});

test('malicious, duplicate, noncanonical and reserved paths are refused before replay',()=>{
  for(const invalid of ['/../escape.vgi','presets/tone.vgi','/presets/./tone.vgi','/.git/tone.vgi','/.tet.ss/tone.vgi','/sys/tone.vgi','app-storage://~/tone.vgi']){
    const value=json();value.activeTonePath=invalid;reject(value);
  }
  let value=json();value.entries.push({...value.entries[0],path:'/index.js'});reject(value);
  value=json();value.entries[0]={...value.entries[0],path:'/../../escape'};reject(value);
  value=json();value.entries[4]=value.entries[0];reject(value);
});

test('incomplete pairs and malformed current or checkpoint data never become a valid recovery',()=>{
  for(const missing of [path,synthStatePath(path),'/.tet.ss'+path,'/.tet.ss'+synthStatePath(path)]){
    const value=json();value.entries=value.entries.filter(entry=>entry.path!==missing);reject(value);
  }
  for(const bytes of [[-1],[256],[0.5],[null],['1']]){const value=json();value.entries[0].data=bytes;reject(value);}
  let value=json();value.entries[0]={...value.entries[0],type:'text',data:'not binary'};reject(value);
  value=json();value.entries[1].data='{"version":99}';reject(value);
  value=json();const saved=value.entries.find(entry=>entry.path==='/.tet.ss'+synthStatePath(path));saved.type='text';saved.data='{}';reject(value);
});

test('workspace identity, generation and total encoded size are bounded',()=>{
  for(const workspaceId of ['',null,'../other','a'.repeat(129)]){const value=json();value.workspaceId=workspaceId;reject(value);}
  for(const generation of [-1,1.5,'2',Number.MAX_SAFE_INTEGER+1]){const value=json();value.generation=generation;reject(value);}
  assert.throws(()=>parseToneRecovery('{'));
  assert.throws(()=>parseToneRecovery(' '.repeat(128*1024+1)));
  const project=setup();project.fs.writeText('/.gitignore','字'.repeat(128*1024));
  assert.throws(()=>createToneRecovery(project,path,'workspace-1',2),/128 KiB/);
});
