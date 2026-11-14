import test from 'node:test';
import assert from 'node:assert/strict';
import {createHuc6280CodeProject} from './code_project.js';
import {addPcEngineCodeExamples,PC_ENGINE_CODE_EXAMPLES} from './cdrom2_examples.js';

test('adding media examples preserves user edits, selection, mode and portable project restore',()=>{
  const project=createHuc6280CodeProject({starterCode:'// user melody'});
  project.importFiles([{path:'/examples/cdda.js',type:'text',data:'// user track'}]);
  project.select('/index.js');project.setCodeState({mode:'keyboard',path:'/index.js'});
  assert.deepEqual(addPcEngineCodeExamples(project),['/examples/huc6280.js','/examples/msm5205.js']);
  assert.equal(project.fs.get('/examples/cdda.js').data,'// user track');
  assert.equal(project.fs.get('/index.js').data,'// user melody');
  assert.equal(project.selectedPath,'/index.js');assert.equal(project.getCodeState().mode,'keyboard');
  assert.deepEqual(addPcEngineCodeExamples(project),[]);
  const restored=createHuc6280CodeProject({snapshot:project.snapshot()});
  assert.equal(restored.fs.get('/examples/msm5205.js').data,PC_ENGINE_CODE_EXAMPLES['/examples/msm5205.js']);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  for(const code of Object.values(PC_ENGINE_CODE_EXAMPLES))assert.doesNotThrow(()=>new AsyncFunction(code));
});

test('example insertion respects case-insensitive user files and directory collisions',()=>{
  const project=createHuc6280CodeProject();
  project.importFiles([{path:'/examples/HUC6280.js',data:'// user melody'}]);
  project.fs.mkdir('/examples/msm5205.js');
  assert.deepEqual(addPcEngineCodeExamples(project),['/examples/cdda.js']);
  assert.equal(project.fs.get('/examples/HUC6280.js').data,'// user melody');assert(!project.fs.has('/examples/huc6280.js'));
  assert.equal(project.fs.stat('/examples/msm5205.js').type,'directory');
});
