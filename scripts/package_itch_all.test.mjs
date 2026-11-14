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
  for (const selected of plan.selected) {
    const {name}=selected, sourceName=selected.sourceName??name;
    const bytes = await readFile(join(result.collection,name));
    assert.deepEqual(bytes,await readFile(join(plan.root,'release',sourceName)));
    assert.equal(checksums.get(name),sha(bytes));
    const item=manifest.artifacts.find(value=>value.name===name);
    assert(item,'Collection manifest identifies '+name);
    if(plan.forRun)assert.equal(item.sourceName,sourceName,'Browser filename retains its original ZIP provenance');
  }
}

// Compatibility fixture written in the released schema-1 layout: nine plain
// names and only Playground suffixed. Keep its historical metadata verbatim.
async function legacyBrowserCollection(f) {
  const plan=createItchBatchPlan({root:f.root,version:f.version,forRun:true});
  const receipt=JSON.parse(await readFile(plan.receipt,'utf8'));
  const artifacts=f.plan.products.map(product=>receipt.artifacts.find(value=>
    value.name===product.archives[product.id==='playground'?1:0].name));
  await mkdir(plan.collection);
  for(const artifact of artifacts)
    await writeFile(join(plan.collection,artifact.name),await readFile(join(plan.release,artifact.name)));
  await writeFile(join(plan.collection,'manifest.json'),JSON.stringify({schemaVersion:1,
    kind:'itch-batch-collection',version:f.version,variant:'for_run',artifacts},null,2)+'\n');
  await writeFile(join(plan.collection,'SHA256SUMS'),artifacts.map(a=>`${a.sha256}  ${a.name}\n`).join(''));
  await writeFile(join(plan.collection,'README.txt'),`Tetorica itch packages — ${f.version}\n\n`+
    'Variant: browser upload\n'+
    'Upload each product ZIP to its own itch project. This folder is not an app ZIP.\n'+
    'The Playground ZIP is the browser-playable _for_run build.\n'+
    'Other products use the same ZIP bytes in both collections.\n'+
    'manifest.json and SHA256SUMS identify this immutable shared version.\n');
  return plan;
}

async function collectionBytes(directory) {
  return await Promise.all((await readdir(directory)).sort().map(async name=>
    [name,await readFile(join(directory,name))]));
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

test('one VERSION gives all ten browser ZIPs distinct for_run names while keeping normal names',()=>{
  const normal=createItchBatchPlan({version:'v2.0.0'}), run=createItchBatchPlan({version:'v2.0.0',forRun:true});
  assert.equal(normal.products.length,10);assert.equal(normal.archives.length,11);
  assert.deepEqual(normal.products.map(p=>basename(p.script)).sort(),scripts);
  assert.equal(normal.selected.length,10);assert.equal(run.selected.length,10);
  assert(normal.archives.every(value=>value.name.includes('_v2.0.0_')));
  const normalNames=new Set(normal.selected.map(value=>value.name)), runNames=new Set(run.selected.map(value=>value.name));
  assert.equal(normalNames.size,10);assert.equal(runNames.size,10);
  assert(normal.selected.every(value=>!value.name.endsWith('_for_run.zip')));
  assert(run.selected.every(value=>value.name.includes('_v2.0.0_')&&value.name.endsWith('_for_run.zip')));
  assert(run.selected.every(value=>!value.name.endsWith('_for_run_for_run.zip')));
  assert.deepEqual([...normalNames].filter(name=>runNames.has(name)),[]);
  for(const selected of run.selected){
    assert(normal.archives.some(value=>value.name===selected.sourceName),'Browser copy points to one generated source ZIP');
    if(selected.product==='playground')assert.equal(selected.sourceName,selected.name,'Playground keeps its existing browser ZIP name');
    else assert.equal(selected.name,selected.sourceName.replace(/\.zip$/,'_for_run.zip'));
  }
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
  const manifest=JSON.parse(await readFile(join(run.collection,'manifest.json'),'utf8'));
  assert.equal(manifest.schemaVersion,2);
  const reused=await packageAllItch({...f,forRun:true,runCommand:f.runner});
  assert.equal(reused.reused,true);assert.equal(f.calls.length,10);
  await verifyCollection(reused,runPlan);
  const receipt=JSON.parse(await readFile(join(f.root,'release',`itch_all_${f.version}.json`),'utf8'));
  assert.equal(receipt.version,f.version);
  for(const archive of f.plan.archives)assert(JSON.stringify(receipt).includes(archive.name),'Shared receipt includes '+archive.name);
});

test('collection copies use canonical ZIPs even when a receipt injects an unrelated sourceName',async t=>{
  const f=await fixture(t);
  await packageAllItch({...f,forRun:true,runCommand:f.runner});
  const outside=join(f.root,'outside.zip'), sentinel=Buffer.from('Unrelated local file; never a package source.');
  await writeFile(outside,sentinel);
  const receipt=JSON.parse(await readFile(f.plan.receipt,'utf8'));
  receipt.artifacts[0].sourceName='../outside.zip';
  await writeFile(f.plan.receipt,JSON.stringify(receipt,null,2)+'\n');
  const normal=await packageAllItch({...f,runCommand:f.runner});
  assert.equal(normal.reused,true);assert.equal(f.calls.length,10);
  await verifyCollection(normal,f.plan);
  const manifest=JSON.parse(await readFile(join(normal.collection,'manifest.json'),'utf8'));
  assert(manifest.artifacts.every(artifact=>!Object.hasOwn(artifact,'sourceName')),'Normal manifest contains only canonical provenance');
  assert.deepEqual(await readFile(outside),sentinel);
});

test('an intact schema-1 browser collection migrates without rebuilding and keeps an exact backup',async t=>{
  const f=await fixture(t), normal=await packageAllItch({...f,runCommand:f.runner});
  const normalBefore=await collectionBytes(normal.collection), receiptBefore=await readFile(f.plan.receipt);
  const runPlan=await legacyBrowserCollection(f), legacyBefore=await collectionBytes(runPlan.collection);
  const migrated=await packageAllItch({...f,forRun:true,runCommand:f.runner});
  assert.equal(migrated.reused,true);assert.equal(f.calls.length,10);
  await verifyCollection(migrated,runPlan);
  assert.deepEqual(await collectionBytes(runPlan.collection+'.before-for-run-names'),legacyBefore);
  assert.deepEqual(await collectionBytes(normal.collection),normalBefore);
  assert.deepEqual(await readFile(f.plan.receipt),receiptBefore);
  const manifest=JSON.parse(await readFile(join(migrated.collection,'manifest.json'),'utf8'));
  assert.equal(manifest.schemaVersion,2);
  const again=await packageAllItch({...f,forRun:true,runCommand:f.runner});
  assert.equal(again.reused,true);assert.equal(f.calls.length,10);
  await verifyCollection(again,runPlan);
  assert.deepEqual(await collectionBytes(runPlan.collection+'.before-for-run-names'),legacyBefore);
});

test('an edited legacy browser ZIP is left intact instead of being renamed or replaced',async t=>{
  const f=await fixture(t);await packageAllItch({...f,runCommand:f.runner});
  const runPlan=await legacyBrowserCollection(f);
  const oldName=f.plan.selected[0].name;
  await appendFile(join(runPlan.collection,oldName),'local edit to legacy browser ZIP');
  const oldBytes=await collectionBytes(runPlan.collection), rootBefore=(await readdir(f.plan.release)).sort();
  await assert.rejects(packageAllItch({...f,forRun:true,runCommand:f.runner}));
  assert.equal(f.calls.length,10);
  assert.deepEqual(await collectionBytes(runPlan.collection),oldBytes);
  assert.deepEqual((await readdir(f.plan.release)).sort(),rootBefore);
  await absent(runPlan.collection+'.before-for-run-names');
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
