import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthProject} from './synth_project.js';
import {createSynthCodeProject} from './synth_code_project.js';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;

test('Code reads current Files relatively as text, JSON and detached binary without changing instruments',async()=>{
  const project=createSynthProject(),bridge=createSynthCodeProject(project);
  project.fs.writeText('/code/data.json','{"note":"C4"}');project.fs.writeFile('/code/sample.bin',Uint8Array.of(3,7,255));
  const before=project.snapshot();
  assert.deepEqual(await bridge.readFile('./data.json',{type:'json'},{path:'/code/index.js'}),{note:'C4'});
  const bytes=new Uint8Array(await bridge.readFile('sample.bin',{type:'arrayBuffer'},{path:'/code/index.js'}));bytes.fill(0);
  assert.deepEqual(new Uint8Array(await bridge.readFile('sample.bin',{type:'arrayBuffer'},{path:'/code/index.js'})),Uint8Array.of(3,7,255));
  await assert.rejects(bridge.readFile('../../missing',{}, {path:'/code/index.js'}));assert.deepEqual(project.snapshot(),before);
});

test('Code entry and nested dynamic modules use the shared Playground Files resolver and snapshot',async()=>{
  const project=createSynthProject(),bridge=createSynthCodeProject(project),context={};
  project.fs.writeText('/index.js','kept');project.fs.writeText('/lib/note.json','{"note":"E4"}');
  project.fs.writeText('/lib/note.js','export const note=(await file("./note.json",{type:"json"})).note;');
  project.fs.writeText('/lib/melody.js','export const note=(await import("./note.js")).note;');
  const source=bridge.prepareSource('context.note=(await import("./lib/melody.js")).note; context.entry=await file("./index.js");');
  await new AsyncFunction('context','file',source)(context,()=>{throw Error('entry must use captured Files');});
  assert.deepEqual(context,{note:'E4',entry:'kept'});assert.equal(project.fs.get('/index.js').data,'kept');
  delete globalThis.__tetoricaVirtualFiles;
});

test('Missing or circular modules reject before execution and do not mutate Files',()=>{
  const project=createSynthProject(),bridge=createSynthCodeProject(project),before=project.snapshot();
  assert.throws(()=>bridge.prepareSource('await import("./missing.js")'),/not found/);assert.deepEqual(project.snapshot(),before);
  project.fs.writeText('/a.js','await import("./b.js")');project.fs.writeText('/b.js','await import("./a.js")');
  assert.throws(()=>bridge.prepareSource('await import("./a.js")'),/Circular/);
});
