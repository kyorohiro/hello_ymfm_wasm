// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {copySidModelSources} from './sid_model_artifacts.mjs';
import {packagedRuntimeModule} from './runtime_module_layout.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));

test('SID runtime URLs adapt both CPU-free models only at the flat distribution boundary',async()=>{
  for(const name of ['sid.js','sid8580.js','playground_sid_audio.js']){
    const source=await readFile(join(root,'tetorica_src/runtime',name),'utf8');
    assert.equal(packagedRuntimeModule(source,name,{nested:true}),source,'Nested source retains its published URL');
    const flat=packagedRuntimeModule(source,name);
    assert.equal(flat,source.replaceAll('../generated/sid/','./generated/sid/')
      .replaceAll('../generated/sid8580-machine/','./generated/sid8580-machine/'),'Only asset paths change');
    assert(!flat.includes('../generated/sid/'));
    assert(!flat.includes('../generated/sid8580-machine/'));
    assert(flat.includes(name==='sid.js'?'./generated/sid/sid.wasm':'./generated/sid8580-machine/sid8580-endpoint.wasm'));
  }
});

test('SID source copier preserves default nested layout and authenticates a flat copy',async t=>{
  const temporary=await mkdtemp(join(tmpdir(),'tetorica-sid-model-layout-'));
  t.after(()=>rm(temporary,{recursive:true,force:true}));
  const nested=join(temporary,'nested'),flat=join(temporary,'flat');
  await mkdir(nested);await mkdir(flat);
  const nestedKit=await copySidModelSources(nested);
  const flatKit=await copySidModelSources(flat,{layout:'flat'});
  const declaration=await readFile(join(root,'tetorica_src/runtime/sid8580.d.ts'));
  assert(declaration.equals(await readFile(join(nested,'js/sid8580.d.ts'))));
  assert(declaration.equals(await readFile(join(flat,'sid8580.d.ts'))));
  await assert.rejects(stat(join(flat,'js')), {code:'ENOENT'});
  assert.deepEqual(flatKit.artifacts,nestedKit.artifacts,'Layout does not change artifact provenance');
  assert.deepEqual(flatKit.sourceKit,nestedKit.sourceKit,'Original build receipt is retained');
  assert(flatKit.inputPaths.includes('scripts/restore_sid_npm_sources.mjs'));
  for(const [stage,prefix]of [[nested,'../js/'],[flat,'../']]){
    const guide=await readFile(join(stage,'sources/SID8580.md'),'utf8');
    assert(guide.includes(`(${prefix}sid8580.js)`));assert(guide.includes(`(${prefix}sid8580.d.ts)`));
    assert(!guide.includes('in both distributions'));
    const manifest=JSON.parse(await readFile(join(stage,'sources/sid8580-machine/source-kit.json')));
    assert.equal(manifest.compiledInputCount,99);
    if(stage===flat){
      assert.equal(manifest.npmStorage.version,1);
      assert.equal(Object.keys(manifest.npmStorage.aliases).length,2);
      for(const[logical,stored]of Object.entries(manifest.npmStorage.aliases)){
        const bytes=await readFile(join(stage,'sources/sid8580-machine',stored));
        assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sources[logical].sha256);
        await assert.rejects(stat(join(stage,'sources/sid8580-machine',logical)),{code:'ENOENT'});
      }
    }else assert.equal(manifest.npmStorage,undefined,'Nested source layout remains unchanged');
    assert.deepEqual(manifest.artifacts.map(item=>item.path),[
      'generated/sid8580-machine/sid8580-endpoint.wasm','generated/sid8580-machine/sid8580-machine.wasm']);
    for(const artifact of manifest.artifacts){
      const bytes=await readFile(join(stage,artifact.path));
      assert.equal(bytes.length,artifact.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);
    }
    assert.equal(manifest.compilerInvocationPerformed,false);
    assert(manifest.noticeRoots.includes('third_party/sidera/toolchain-notices'));
    assert(manifest.noticeRoots.includes('third_party/sid8580-machine-toolchain-notices'));
    // The adapter URL must resolve within either distribution's actual assets.
    const moduleUrl=pathToFileURL(join(stage,prefix==='../'?'sid8580.js':'js/sid8580.js'));
    const source=await readFile(join(root,'tetorica_src/runtime/sid8580.js'),'utf8');
    const packaged=packagedRuntimeModule(source,'sid8580.js',{nested:prefix!=='../'});
    const relative=packaged.match(/new URL\('([^']+sid8580-endpoint\.wasm)'/)[1];
    assert((await readFile(new URL(relative,moduleUrl))).equals(
      await readFile(join(root,'docs/generated/sid8580-machine/sid8580-endpoint.wasm'))));
  }
  await assert.rejects(copySidModelSources(join(temporary,'invalid'),{layout:'other'}),/Unknown SID runtime layout/);
  await assert.rejects(stat(join(temporary,'invalid')),{code:'ENOENT'});
});
