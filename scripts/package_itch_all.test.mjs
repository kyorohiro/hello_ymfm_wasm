// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm, appendFile, unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, basename, dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createItchBatchPlan, packageAllItch} from './package_itch_all.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const absent = async path => assert.rejects(stat(path), {code:'ENOENT'});
const scripts = ['2a03_synth','dmg_synth','huc6280_synth','scsp_synth','sid_synth',
  'snes_synth','spu_synth','synth','vgm_analyzer','playground']
  .map(name => `package_itch_${name}.sh`).sort();

function tinyZip(product, version, name, extraName=null) {
  return execFileSync('python3', ['-c', String.raw`
import io,json,sys,zipfile
value=json.load(sys.stdin);out=io.BytesIO()
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
 z.writestr('index.html','<!doctype html><title>'+value['product']+'</title>'+value['version']+value['name'])
 z.writestr('LICENSE','Synthetic packaging regression fixture; no game data.')
 if value['extraName'] is not None:z.writestr(value['extraName'],'Additional fixture member.')
sys.stdout.buffer.write(out.getvalue())
`], {input:JSON.stringify({product,version,name,extraName})});
}

async function fixture(t, version='v1.2.3+fixture') {
  const root = await mkdtemp(join(tmpdir(), 'itch batch fixture '));
  t.after(() => rm(root, {recursive:true,force:true}));
  const plan = createItchBatchPlan({root,version}), calls=[];
  for (const product of plan.products) {
    const path = join(root,product.script);
    await mkdir(dirname(path), {recursive:true});
    await writeFile(path, '#!/bin/sh\n# Injected runner owns this fixture.\nexit 0\n');
  }
  const runner = async call => {
    calls.push(call);
    assert.equal(call.root,root);assert.equal(call.version,version);
    const product = plan.products.find(value => value.id===call.product);
    assert(product, 'Only planned canonical products are run');
    assert.equal(call.script,join(root,product.script));
    await mkdir(join(root,'release'), {recursive:true});
    for (const archive of product.archives) {
      await writeFile(join(root,'release',archive.name),tinyZip(product.id,version,archive.name));
    }
  };
  return {root,version,plan,calls,runner};
}

async function verifyCollection(result, plan) {
  const names = plan.selected.map(value=>value.name);
  assert.deepEqual((await readdir(result.collection)).sort(),
    [...names,'manifest.json','SHA256SUMS','README.txt'].sort());
  const manifest = JSON.parse(await readFile(join(result.collection,'manifest.json'),'utf8'));
  assert.equal(manifest.version,plan.version);
  const checksums = new Map((await readFile(join(result.collection,'SHA256SUMS'),'utf8')).trim().split('\n')
    .map(line=>{const match=/^([a-f0-9]{64})\s+(.+)$/.exec(line);assert(match,'A valid checksum line');return[match[2],match[1]];}));
  assert.equal(checksums.size,10);
  for (const name of names) {
    const bytes = await readFile(join(result.collection,name));
    assert.deepEqual(bytes,await readFile(join(plan.root,'release',name)));
    assert.equal(checksums.get(name),sha(bytes));
    assert(JSON.stringify(manifest).includes(name),'Collection manifest identifies '+name);
  }
}

test('batch VERSION is explicit and rejects unsafe paths before running or creating outputs',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'itch-invalid-version-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const root=join(directory,'untouched-root');let calls=0;
  for (const version of [undefined,'','../escape','/tmp/escape','.hidden','a/b','a\\b','a b','a;echo x','x'.repeat(81),42]) {
    assert.throws(()=>createItchBatchPlan({root,version}));
    await assert.rejects(packageAllItch({root,version,runCommand:async()=>{calls++;}}));
  }
  assert.equal(calls,0);await absent(root);
  for (const version of ['dev','2026-11-14','v1.2.3+preview','x'.repeat(80)]) {
    assert.equal(createItchBatchPlan({root,version}).version,version);
  }
});

test('one VERSION selects ten canonical products and switches only Playground for browser collection',()=>{
  const normal=createItchBatchPlan({version:'v2.0.0'}), run=createItchBatchPlan({version:'v2.0.0',forRun:true});
  assert.equal(normal.products.length,10);assert.equal(normal.archives.length,11);
  assert.deepEqual(normal.products.map(p=>basename(p.script)).sort(),scripts);
  assert.equal(normal.selected.length,10);assert.equal(run.selected.length,10);
  assert(normal.archives.every(value=>value.name.includes('_v2.0.0_')));
  const normalNames=new Set(normal.selected.map(value=>value.name)), runNames=new Set(run.selected.map(value=>value.name));
  assert.deepEqual([...normalNames].filter(name=>!runNames.has(name)),['hello_ymfm_wasm_v2.0.0_itch_playground.zip']);
  assert.deepEqual([...runNames].filter(name=>!normalNames.has(name)),['hello_ymfm_wasm_v2.0.0_itch_playground_for_run.zip']);
});

test('a late output collision prevents all children and preserves existing ZIP bytes',async t=>{
  const f=await fixture(t), target=join(f.root,'release',f.plan.archives.at(-1).name), sentinel=Buffer.from('Prior release must remain unchanged.');
  await mkdir(dirname(target),{recursive:true});await writeFile(target,sentinel);
  await assert.rejects(packageAllItch({...f,runCommand:f.runner}));
  assert.equal(f.calls.length,0);assert.deepEqual(await readFile(target),sentinel);
  await absent(join(f.root,'release',`itch_all_${f.version}.json`));
});

test('normal and browser collections share verified builds and preserve the exact ZIPs and checksums',async t=>{
  const f=await fixture(t);
  const normal=await packageAllItch({...f,runCommand:f.runner});
  assert.equal(normal.reused,false);assert.equal(normal.version,f.version);assert.equal(normal.artifacts.length,10);
  assert.equal(f.calls.length,10);assert.deepEqual(new Set(f.calls.map(call=>call.product)),new Set(f.plan.products.map(p=>p.id)));
  await verifyCollection(normal,f.plan);
  const runPlan=createItchBatchPlan({root:f.root,version:f.version,forRun:true});
  const run=await packageAllItch({...f,forRun:true,runCommand:f.runner});
  assert.equal(run.reused,true);assert.equal(run.artifacts.length,10);assert.equal(f.calls.length,10);
  assert.notEqual(run.collection,normal.collection);await verifyCollection(run,runPlan);
  const receipt=JSON.parse(await readFile(join(f.root,'release',`itch_all_${f.version}.json`),'utf8'));
  assert.equal(receipt.version,f.version);
  for(const archive of f.plan.archives)assert(JSON.stringify(receipt).includes(archive.name),'Shared receipt includes '+archive.name);
});

test('a failed middle child reports its product and stops before later products or success receipts',async t=>{
  const f=await fixture(t), fail=f.plan.products[4].id;
  await assert.rejects(packageAllItch({...f,runCommand:async call=>{
    if(call.product===fail){f.calls.push(call);throw Error('fixture build failed');}
    await f.runner(call);
  }}),error=>{assert(error.message.includes(fail));return true;});
  assert.deepEqual(f.calls.map(call=>call.product),f.plan.products.slice(0,5).map(p=>p.id));
  await absent(join(f.root,'release',`itch_all_${f.version}.json`));
  await absent(join(f.root,'release',`itch_all_${f.version}`));
});

test('a child claiming success without its expected archive cannot publish an incomplete batch',async t=>{
  const f=await fixture(t);
  await assert.rejects(packageAllItch({...f,runCommand:async call=>{f.calls.push(call);}}));
  assert(f.calls.length>0);
  await absent(join(f.root,'release',`itch_all_${f.version}.json`));
  await absent(join(f.root,'release',`itch_all_${f.version}`));
});

test('reuse checks even the unselected full Playground ZIP and never overwrites a collection after corruption',async t=>{
  const f=await fixture(t);
  const first=await packageAllItch({...f,forRun:true,runCommand:f.runner});
  const manifest=await readFile(join(first.collection,'manifest.json'));
  const full=f.plan.archives.find(a=>a.name.endsWith('_itch_playground.zip'));
  await appendFile(join(f.root,'release',full.name),'changed after packaging');
  await assert.rejects(packageAllItch({...f,forRun:true,runCommand:f.runner}));
  assert.equal(f.calls.length,10);assert.deepEqual(await readFile(join(first.collection,'manifest.json')),manifest);
});

test('collection reuse refuses changed or missing checksums and guide instead of advertising an incomplete set',async t=>{
  const f=await fixture(t), first=await packageAllItch({...f,runCommand:f.runner});
  const manifest=await readFile(join(first.collection,'manifest.json'));
  for(const name of ['SHA256SUMS','README.txt']) {
    const path=join(first.collection,name), original=await readFile(path);
    await appendFile(path,'edited after collection');
    await assert.rejects(packageAllItch({...f,runCommand:f.runner}));
    assert.deepEqual(await readFile(path),Buffer.concat([original,Buffer.from('edited after collection')]));
    await writeFile(path,original);
  }
  await unlink(join(first.collection,'SHA256SUMS'));
  await assert.rejects(packageAllItch({...f,runCommand:f.runner}));
  assert.equal(f.calls.length,10);
  await absent(join(first.collection,'SHA256SUMS'));
  assert.deepEqual(await readFile(join(first.collection,'manifest.json')),manifest);
});

test('a CRC-valid ZIP with a single-backslash member cannot create a success receipt',async t=>{
  const f=await fixture(t), target=f.plan.products[0];
  await assert.rejects(packageAllItch({...f,runCommand:async call=>{
    await f.runner(call);
    if(call.product===target.id){
      const name=target.archives[0].name;
      await writeFile(join(f.root,'release',name),tinyZip(target.id,f.version,name,'bad\\entry'));
    }
  }}),error=>{assert.match(String(error.stderr??error.message),/Unsafe ZIP name/);return true;});
  assert.equal(f.calls.length,10);
  await absent(join(f.root,'release',`itch_all_${f.version}.json`));
  await absent(join(f.root,'release',`itch_all_${f.version}`));
});

test('concurrent normal and browser requests for one VERSION share an exclusive build lock',async t=>{
  const f=await fixture(t);let began,release,secondCalls=0;
  const started=new Promise(resolve=>{began=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const first=packageAllItch({...f,runCommand:async call=>{
    if(call.product===f.plan.products[0].id){began();await gate;}
    await f.runner(call);
  }});
  try{
    await Promise.race([started,first.then(()=>{throw Error('First build completed without reaching its held child.');})]);
    await assert.rejects(packageAllItch({...f,forRun:true,runCommand:async()=>{secondCalls++;}}),/already being packaged|lock/i);
    assert.equal(secondCalls,0);assert.equal(f.calls.length,0);
    release();const result=await first;
    assert.equal(result.reused,false);assert.equal(f.calls.length,10);
    await verifyCollection(result,f.plan);
  }finally{release();await first.catch(()=>{});}
});
