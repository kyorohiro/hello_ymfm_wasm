import test from 'node:test';
import assert from 'node:assert/strict';
import {DMG_TIMED_EXAMPLES} from './code_examples.js';
import {createGameboyCodeProject,GAMEBOY_PROJECT_FILE_BYTES} from './code_project.js';
import {GameboySynth} from '../../tetorica_src/runtime/gameboysynth.js';
import {buildGameboyOperations,compileGameboyOperations} from '../../tetorica_src/runtime/gameboy_operations.js';
import {createGameboyTimedSnapshot} from '../../tetorica_src/runtime/gameboy_timed_state.js';

test('bundled timed examples build and compile actual APU writes without touching the live Synth',async()=>{
  const writes=[],synth=new GameboySynth({transport:{writeRegister:(...args)=>writes.push(args),reset(){}}});
  synth.initialize();const state=synth._getState(),before=structuredClone(state);writes.length=0;
  for(const [path,source]of Object.entries(DMG_TIMED_EXAMPLES)){
    const traces=[],scheduled=[];
    const gb={build:buildGameboyOperations,captureState:async()=>createGameboyTimedSnapshot(state,{instanceId:'example',frame:0,sampleRate:48000}),
      compile:async(plan,options={})=>{const result=compileGameboyOperations(plan,options.initialState?.state??state,{clock:state.clock});traces.push(result);return result;},
      schedule:async(plan,options)=>{scheduled.push({plan,options});compileGameboyOperations(plan,state,{clock:state.clock});}};
    await new (Object.getPrototypeOf(async function(){}).constructor)('useSoundChip','console','CH1',source)(async()=>gb,{table(){}},0);
    assert.equal(traces.length,1,path);assert(traces[0].length>0,path);assert.equal(scheduled.length,1,path);
    assert(scheduled[0].options.repeatSeconds>traces[0].at(-1).offsetSeconds,path);
    assert.deepEqual(synth._getState(),before);assert.deepEqual(writes,[],'record/compile never writes the live APU');
    if(path.includes('wave'))assert.equal(traces[0].filter(row=>row.register>=32&&row.register<=47).length,32,'both packed Wave uploads retained');
    if(path.includes('pulse'))assert.equal(traces[0].filter(row=>row.register===4&&(row.value&128)).length,2,'both repeated triggers retained');
  }
});

test('default and New Cassette include accepted examples without replacing the starter melody',()=>{
  const project=createGameboyCodeProject({starterCode:'// starter\n',starterFiles:DMG_TIMED_EXAMPLES});
  for(const [path,source]of Object.entries(DMG_TIMED_EXAMPLES)){
    assert.equal(project.fs.get(path).data,source);assert.equal(project.savedFs.get(path).data,source);
  }
  project.setAutoApply(false);project.writeEditorText('/index.js','// working\n');
  const fresh=createGameboyCodeProject({snapshot:project.prepareNew()});
  assert.equal(fresh.fs.get('/index.js').data,'// starter\n');assert.equal(fresh.autoApply,false);
  assert.equal(fresh.fs.get('/examples/timed-wave.js').data,DMG_TIMED_EXAMPLES['/examples/timed-wave.js']);
});

test('adding missing examples retains edited source, pending deletions and both existing versions',()=>{
  const project=createGameboyCodeProject({starterCode:'// original\n',starterFiles:DMG_TIMED_EXAMPLES});
  project.setAutoApply(false);project.writeEditorText('/examples/timed-pulse.js','// custom pulse\n');
  project.fs.remove('/examples/timed-wave.js');
  project.fs.remove('/examples/timed-noise.js');project.saveFiles(['/examples/timed-noise.js']);
  const before=project.snapshot();assert.deepEqual(project.ensureStarterFiles(),['/examples/timed-noise.js']);
  assert.equal(project.fs.get('/examples/timed-pulse.js').data,'// custom pulse\n');
  assert.equal(project.savedFs.get('/examples/timed-pulse.js').data,DMG_TIMED_EXAMPLES['/examples/timed-pulse.js']);
  assert(!project.fs.has('/examples/timed-wave.js'));assert(project.savedFs.has('/examples/timed-wave.js'));
  assert.equal(project.fs.get('/index.js').data,before.filesystem.files.find(file=>file.path==='/index.js').data);
});

test('full existing projects refuse default example additions atomically',()=>{
  const existing=createGameboyCodeProject();existing.importFiles([{path:'/keep.bin',type:'binary',data:new Uint8Array(GAMEBOY_PROJECT_FILE_BYTES)}]);
  const project=createGameboyCodeProject({snapshot:existing.snapshot(),starterFiles:DMG_TIMED_EXAMPLES}),before=project.snapshot();
  assert.throws(()=>project.ensureStarterFiles(),/limit|exceed/i);assert.deepEqual(project.snapshot(),before);
});
