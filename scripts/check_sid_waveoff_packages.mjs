// SPDX-License-Identifier: BSD-3-Clause
// Rebuild the native source kits from actual distributed ZIP bytes. All compiler
// outputs stay in fresh isolated copies; explicit output arguments avoid sync.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp,lstat,mkdir,mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,dirname,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyReadableModules} from './copy_readable_modules.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const options={playerRoot:join(root,'build/validation/sid-waveoff-player-zip'),synthRoot:join(root,'build/validation/sid-waveoff-synth-zip'),
  playerZip:join(root,'release/tetorica_sid_player_waveoff-20261108_itch.zip'),synthZip:join(root,'release/tetorica_sid_synth_waveoff-20261108_itch.zip'),
  workDir:join(root,'build/validation'),out:join(root,'docs/issues/sid_waveoff_packages_01.json')};
for(let i=2;i<process.argv.length;i++){
  const key={'--player-root':'playerRoot','--synth-root':'synthRoot','--player-zip':'playerZip','--synth-zip':'synthZip','--work-dir':'workDir','--out':'out','--reuse-rebuild-proof':'reuseProof'}[process.argv[i]],value=process.argv[++i];
  assert(key&&value&&!value.startsWith('--'),'Usage: --player-root DIR --synth-root DIR --player-zip ZIP --synth-zip ZIP --work-dir DIR --out JSON [--reuse-rebuild-proof PREVIOUS_JSON]');options[key]=resolve(value);
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const recordFile=async path=>record(await readFile(path));
async function inventory(directory,prefix=''){
  const names=[];
  for(const item of await readdir(join(directory,prefix),{withFileTypes:true})){
    const name=prefix+item.name,info=await lstat(join(directory,name));assert(!info.isSymbolicLink(),'Symlink source entry '+name);
    if(info.isDirectory())names.push(...await inventory(directory,name+'/'));
    else {assert(info.isFile());names.push(name);}
  }
  return names.sort();
}
function inspectZip(file){
  return JSON.parse(execFileSync('python3',['-c',String.raw`
import hashlib,json,stat,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 out=[]; seen=set()
 for i in z.infolist():
  assert i.filename not in seen; seen.add(i.filename)
  assert not i.filename.startswith('/') and '..' not in i.filename.split('/')
  assert not stat.S_ISLNK(i.external_attr>>16)
  if not i.is_dir():out.append({'path':i.filename,'bytes':i.file_size,'sha256':hashlib.sha256(z.read(i)).hexdigest()})
 print(json.dumps(out))
`,file],{encoding:'utf8',maxBuffer:8*1024*1024}));
}
// A metadata-only repackage may reuse a reviewed independent build only after
// comparing actual ZIP bytes. Native source kits, WASMs and their build receipts
// are protected too; only the product guides and browser provenance may differ.
function compareValidatedZip(current,previous,kind){
  return JSON.parse(execFileSync('python3',['-c',String.raw`
import io,json,sys,zipfile
kind=sys.argv[3];receipt='sources/sid-'+kind+'-browser.json'
with zipfile.ZipFile(sys.argv[1]) as a,zipfile.ZipFile(sys.argv[2]) as b:
 assert a.testzip() is None and b.testzip() is None
 names=a.namelist();assert set(names)==set(b.namelist())
 ra=json.loads(a.read(receipt));rb=json.loads(b.read(receipt))
 assert ra['sourceArchive']['path']==rb['sourceArchive']['path']
 source=ra['sourceArchive']['path'];allowed={'README.md',kind.join(['sid-','/README.md']),source,receipt}
 changed=[];protected=[];kits={}
 for name in names:
  same=a.read(name)==b.read(name)
  if not same:assert name in allowed,'Changed protected runtime/source byte: '+name;changed.append(name)
  if name not in allowed:protected.append(name)
  for component in ['sid','sid-player','sid-rsid','sid8580-machine']:
   if name.startswith('sources/'+component+'/'):kits[component]=kits.get(component,0)+1
 with zipfile.ZipFile(io.BytesIO(a.read(source))) as sa,zipfile.ZipFile(io.BytesIO(b.read(source))) as sb:
  assert sa.testzip() is None and sb.testzip() is None
  assert set(sa.namelist())==set(sb.namelist())
  inputs=[name for name in sa.namelist() if sa.read(name)!=sb.read(name)]
 print(json.dumps({'samePathSet':True,'protectedFiles':len(protected),'allProtectedFileBytesIdentical':True,'changedMetadataPaths':changed,'nativeSourceKitFileCounts':kits,'allNativeSourceKitBytesIdentical':True,'changedOriginalInputs':inputs}))
`,current,previous,kind],{encoding:'utf8',maxBuffer:8*1024*1024}));
}
const reusedBytes=options.reuseProof?await readFile(options.reuseProof):null,reused=reusedBytes?JSON.parse(reusedBytes):null;
if(reused){assert(options.out!==options.reuseProof,'Never overwrite historical rebuild evidence');assert.equal(reused.passed,true);assert.equal(reused.rebuilds.length,3);}
await mkdir(options.workDir,{recursive:true});const directory=await mkdtemp(join(options.workDir,'sid-waveoff-sourcekits-'));
const result={schemaVersion:reused?2:1,passed:false,purpose:reused?'Repackage integrity and current-source freshness; exact runtime/native-kit equality reuses reviewed independent builds':'Actual ZIP integrity, authored browser-module preservation and isolated13/14/29-input WASM rebuilds',
  compiler:reused?null:execFileSync('em++',['--version'],{encoding:'utf8'}).trim(),packages:[],rebuilds:[],sdkOrApplicationArtifactsWritten:false};
if(reused)result.reusedIndependentBuildProof={path:relative(root,options.reuseProof),...record(reusedBytes),independentBuildPerformedThisRun:false};
for(const [kind,packageRoot,archive]of [['player',options.playerRoot,options.playerZip],['synth',options.synthRoot,options.synthZip]]){
  const entries=inspectZip(archive);assert(entries.length<=1000);
  assert.deepEqual(entries.map(entry=>entry.path).sort(),await inventory(packageRoot),'Extracted actualZIP path set differs');
  for(const entry of entries)assert.deepEqual(await recordFile(join(packageRoot,entry.path)),{bytes:entry.bytes,sha256:entry.sha256},'ActualZIP extraction byte differs: '+entry.path);
  const forbidden=entries.filter(({path})=>/(?:^|\/)(?:C64Music|hvsc|sid-reference|libsidplayfp|libresidfp)(?:\/|$)|\.(?:rom|bin|wav|pcm|f32le|mp3|m4a|ogg|a|o|exe|dylib)$/i.test(path));
  assert.deepEqual(forbidden,[],'A verification engine, native binary, firmware or user audio was packaged');
  const receiptPath=`sources/sid-${kind}-browser.json`,receipt=JSON.parse(await readFile(join(packageRoot,receiptPath)));
  assert.equal(receipt.builder.name,'source-copy');assert.equal(receipt.builder.minify,false);assert.equal(receipt.builder.bundle,false);
  assert.deepEqual(await recordFile(join(packageRoot,receipt.sourceArchive.path)),{bytes:receipt.sourceArchive.bytes,sha256:receipt.sourceArchive.sha256});
  const originals=inspectZip(join(packageRoot,receipt.sourceArchive.path));assert.equal(originals.length,receipt.originalInputs.length);
  const originalMap=new Map(originals.map(item=>[item.path,item]));
  for(const item of receipt.originalInputs){assert.deepEqual(originalMap.get(item.path),item);assert.deepEqual(await recordFile(join(root,item.path)),{bytes:item.bytes,sha256:item.sha256},'Original browser/source input changed: '+item.path);}
  // Re-run only the source-copy dependency walker, never a runtime bundler.
  // This independently checks any permitted relative-import rewriting against
  // the package metadata while preserving all authored non-import text.
  const expectedDir=join(directory,'readable-'+kind),entrySources=(receipt.entries??receipt.bundles).map(item=>item.sourcePath);
  const expected=await copyReadableModules({root,stage:expectedDir,entries:entrySources,factories:[]});
  assert.deepEqual(expected.modules,receipt.modules,'Readable module source-copy metadata differs');
  for(const item of expected.modules){
    assert((await readFile(join(packageRoot,item.path))).equals(await readFile(join(expectedDir,item.path))),'A runtime module was minified or changed beyond its authored import remapping: '+item.path);
  }
  const sidData=entries.filter(({path})=>/\.sid$/i.test(path)).map(item=>item.path);
  assert(sidData.every(path=>kind==='player'&&/^sid-player\/demos\/(?:tone|pulse|noise|melody-filter|rsid\/irq)\.sid$/.test(path)),'Unexpected SID music in package');
  let comparison;
  if(reused){
    const previous=reused.packages.find(item=>item.kind===kind);assert(previous?.crcAndAllExtractedBytesVerified&&previous.authoredBytesAndImportRemappingExact);
    const previousZip=resolve(root,previous.archive);assert.deepEqual(await recordFile(previousZip),{bytes:previous.bytes,sha256:previous.sha256},'Historical validated ZIP changed');
    comparison={previousArchive:previous.archive,previousArchiveRecord:{bytes:previous.bytes,sha256:previous.sha256},...compareValidatedZip(archive,previousZip,kind)};
  }
  result.packages.push({kind,archive:relative(root,archive),...await recordFile(archive),files:entries.length,crcAndAllExtractedBytesVerified:true,
    readableModules:expected.modules.length,authoredBytesAndImportRemappingExact:true,originalInputs:originals.length,allOriginalInputHashesMatchCurrentSource:true,
    sourceArchiveCrc:true,nativeOrGplReferenceOrUserAudioIncluded:false,sidData:'Self-authored demo programs only',sourceCopy:receipt.builder,...(comparison?{validatedZipComparison:comparison}:{})});
}
for(const [component,packageRoot,count,script,wasmName]of [
  ['sid',options.synthRoot,13,'build_sid_wasm.sh','sid.wasm'],
  ['sid-player',options.playerRoot,14,'build_sid_player_wasm.sh','sid-player.wasm'],
  ['sid-rsid',options.playerRoot,29,'build_sid_rsid_wasm.sh','sid-rsid.wasm'],
]){
  const source=join(packageRoot,'sources',component),copy=join(directory,component),output=join(copy,'isolated-output');
  await cp(source,copy,{recursive:true,errorOnExist:true,force:false});
  const before=await inventory(copy),beforeHashes=Object.fromEntries(await Promise.all(before.map(async path=>[path,await recordFile(join(copy,path))])));
  const receiptName=wasmName.replace(/\.wasm$/,'-build.json'),packagedReceiptBytes=await readFile(join(packageRoot,'generated',component,receiptName)),packagedReceipt=JSON.parse(packagedReceiptBytes);
  assert.equal(Object.keys(packagedReceipt.inputs).length,count);
  for(const [path,expected]of Object.entries(packagedReceipt.inputs))assert.deepEqual(beforeHashes[path],expected,'Source kit input differs before rebuild: '+path);
  if(reused){
    const previous=reused.rebuilds.find(item=>item.component===component);assert.equal(previous?.compiledInputs,count);
    assert(previous.matchesActualZipWasm&&previous.matchesActualZipEntireReceipt&&previous.originalCopiedInputsUnchanged&&previous.explicitOutputSkippedPublicSync);
    const packagedWasm=await recordFile(join(packageRoot,'generated',component,wasmName));
    assert.deepEqual(packagedWasm,previous.wasm);assert.deepEqual(record(packagedReceiptBytes),previous.completeBuildReceipt);
    result.rebuilds.push({component,compiledInputs:count,sourceKit:relative(root,source),sourceKitFiles:before.length,
      sourceKitBytesExactlyEqualToPreviouslyBuiltKit:true,independentBuildPerformedThisRun:false,
      reusedProof:relative(root,options.reuseProof),previousIndependentRebuild:previous,
      wasm:packagedWasm,completeBuildReceipt:record(packagedReceiptBytes),matchesActualZipWasm:true,matchesActualZipEntireReceipt:true});
    continue;
  }
  const started=Date.now();
  const log=execFileSync('sh',['scripts/'+script,output],{cwd:copy,encoding:'utf8',maxBuffer:8*1024*1024,timeout:180000});
  const rebuiltWasm=await readFile(join(output,wasmName)),rebuiltReceipt=await readFile(join(output,receiptName));
  assert(rebuiltWasm.equals(await readFile(join(packageRoot,'generated',component,wasmName))),component+' isolated WASM is not byte-identical');
  assert(rebuiltReceipt.equals(packagedReceiptBytes),component+' isolated complete build receipt is not byte-identical');
  for(const path of before)assert.deepEqual(await recordFile(join(copy,path)),beforeHashes[path],'The build modified a copied original input: '+path);
  result.rebuilds.push({component,compiledInputs:count,sourceKit:relative(root,source),isolatedCopy:relative(root,copy),output:relative(root,output),
    command:['sh','scripts/'+script,'<isolated-copy>/isolated-output'],elapsedMilliseconds:Date.now()-started,
    wasm:record(rebuiltWasm),completeBuildReceipt:record(rebuiltReceipt),matchesActualZipWasm:true,matchesActualZipEntireReceipt:true,
    originalCopiedInputsUnchanged:true,explicitOutputSkippedPublicSync:true,log:log.trim()});
}
result.passed=true;result.checker={path:'scripts/check_sid_waveoff_packages.mjs',...await recordFile(fileURLToPath(import.meta.url))};
if(reused){assert((await readFile(options.reuseProof)).equals(reusedBytes),'Historical rebuild proof changed');result.historicalBuildProofUnchanged=true;}
await mkdir(dirname(options.out),{recursive:true});await writeFile(options.out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:true,packages:result.packages.map(item=>({kind:item.kind,files:item.files,sha256:item.sha256})),rebuilds:result.rebuilds.map(item=>({component:item.component,compiledInputs:item.compiledInputs,wasm:item.wasm})),out:options.out},null,2));
