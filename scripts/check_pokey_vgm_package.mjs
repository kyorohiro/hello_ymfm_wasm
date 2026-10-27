// Exercise an already-packed VGM candidate in an isolated offline consumer.
// This checker neither rebuilds nor publishes a package or opens an audio device.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,realpath,stat,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {createPokeyVgm,createPokeyStreamVgm} from '../test/helpers/pokey_vgm_fixture.mjs';

assert(process.argv[2],'Pass an existing tetorica-vgm .tgz; this check does not rebuild or publish it.');
const options=process.argv.slice(3);
for(const option of options)assert(option.startsWith('--out=')||option.startsWith('--stage='),'Unknown option: '+option);
assert(options.length<=2,'Usage: node scripts/check_pokey_vgm_package.mjs package.tgz [--out=report.json] [--stage=directory]');
const reportPath=options.find(value=>value.startsWith('--out='))?.slice(6);
const stageOption=options.find(value=>value.startsWith('--stage='))?.slice(8),stage=stageOption?resolve(stageOption):null;
const tarball=resolve(process.argv[2]);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const directory=await mkdtemp(join(tmpdir(),'tetorica-pokey-vgm-package-'));
const run=(command,args)=>execFileSync(command,args,{cwd:directory,encoding:'utf8',maxBuffer:8*1024*1024});
const evidence=[];
function wavPcm(bytes) {
  assert.equal(new TextDecoder().decode(bytes.subarray(0,4)),'RIFF');
  assert.equal(new TextDecoder().decode(bytes.subarray(8,12)),'WAVE');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  assert.equal(v.getUint16(20,true),1);assert.equal(v.getUint16(22,true),2);
  assert.equal(v.getUint32(24,true),44100);assert.equal(v.getUint16(34,true),16);
  assert.equal(v.getUint32(40,true),bytes.length-44);
  return bytes.subarray(44);
}
function audible(bytes,label) {assert(wavPcm(bytes).some(Boolean),'Silent installed '+label);}
function silent(bytes,label) {assert(wavPcm(bytes).every(v=>v===0),'Installed mute leaked '+label);}
function pcmDigest(pcm) {return sha256(Buffer.concat([Buffer.from(pcm.left.buffer,pcm.left.byteOffset,pcm.left.byteLength),Buffer.from(pcm.right.buffer,pcm.right.byteOffset,pcm.right.byteLength)]));}
function readPlayer(player,frames) {const left=new Float32Array(frames),right=new Float32Array(frames);player.process(left,right,frames);return {left,right};}

try {
  const archiveBytes=await readFile(tarball),archiveEntries=new Set(run('tar',['-tzf',tarball]).trim().split('\n'));
  for(const name of archiveEntries)assert(name.startsWith('package/')&&!name.split('/').includes('..'),'Unsafe package archive path '+name);
  const unpacked=join(directory,'archive');await mkdir(unpacked);
  run('tar',['-xzf',tarball,'-C',unpacked]);
  await writeFile(join(directory,'package.json'),'{"private":true,"type":"module"}\n');
  run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false','--cache',join(directory,'npm-cache'),tarball]);
  const require=createRequire(join(directory,'package.json'));
  const entry=require.resolve('tetorica-vgm'),installed=await realpath(join(directory,'node_modules/tetorica-vgm'));
  assert(entry.startsWith(installed+'/'),'Consumer must load the installed package');
  const api=await import(pathToFileURL(entry).href);
  const core=await import(pathToFileURL(require.resolve('tetorica-vgm/core')).href);
  const manifest=JSON.parse(await readFile(join(installed,'package.json'),'utf8'));
  assert.equal(manifest.name,'tetorica-vgm');assert.equal(manifest.license,'BSD-3-Clause');
  assert.equal(Object.keys(manifest.dependencies??{}).length,0,'Offline consumer should need no npm runtime dependencies');
  const cli=join(installed,manifest.bin['tetorica-vgm']);
  assert.equal(run(process.execPath,[cli,'--version']).trim(),manifest.version);
  for(const method of ['analyzeSource','inspectSourceSupport','renderSource','vgmToJson','jsonToVgm','createPlaybackEngine','createPlaybackPlayer','applyPlaybackMutes'])assert.equal(typeof api[method],'function','Public export '+method);
  assert.equal(api.analyzeSource,core.analyzeSource,'The public Core subpath uses the same analysis');

  const packedFiles={};
  for(const archivePath of [...archiveEntries].sort()){
    const name=archivePath.slice('package/'.length),archived=join(unpacked,archivePath);
    if(!(await stat(archived)).isFile())continue;
    const bytes=await readFile(archived),installedBytes=await readFile(join(installed,name));
    assert.deepEqual(installedBytes,bytes,'Installed package bytes differ from the archive: '+name);
    if(stage)assert.deepEqual(await readFile(join(stage,name)),bytes,'Tarball differs from the supplied staging tree: '+name);
    packedFiles[name]={bytes:bytes.length,sha256:sha256(bytes)};
  }

  const sourceFiles={};
  const required=['cli/index.js','cli/main.js','cli/render.js','README.md','CLI.md',
    'docs/vgm_analyzer/analyzer_core.js','docs/vgm_analyzer/playback_core.js','docs/vgm_analyzer/playback_mixer.js',
    'docs/vgm_analyzer/pokey_playback.js','docs/vgm_analyzer/mixer_defaults.js',
    'docs/vgm_analyzer/mixer_calibration_data.js','docs/js/ym2612vgm.js','docs/js/vgmplayer.js',
    'docs/js/pokey.js','docs/js/pokeyaudioengine.js',
    'docs/generated/pokey_wasm.js','docs/generated/pokey_wasm.wasm',
    'licenses/libvgm-pokey/LICENSE','licenses/libvgm-pokey/README.md','sources/LICENSE','sources/POKEY.md','sources/POKEY-SDK.json',
    'sources/wasm/pokey_wasm.cpp','sources/scripts/build_pokey_wasm.sh',
    ...['pokey.cpp','pokey.h','LICENSE','README.md','upstream/pokey.c','upstream/snapshot-manifest.json'].map(name=>'sources/third_party/libvgm-pokey/'+name)];
  for(const name of required){
    assert(archiveEntries.has('package/'+name),'Missing tarball entry: '+name);
    const bytes=await readFile(join(installed,name));assert(bytes.length,'Empty installed asset '+name);
    const archived=await readFile(join(unpacked,'package',name));
    assert.deepEqual(bytes,archived,'Installed bytes must match the supplied tarball: '+name);
    sourceFiles[name]={bytes:bytes.length,sha256:sha256(bytes),tarballBytesExactlyEqual:true};
  }
  for(const name of ['README.md','CLI.md']){
    const text=await readFile(join(installed,name),'utf8');
    assert.match(text,/POKEY/);assert.match(text,/unreleased/i,'Do not imply the development build is already published');
  }
  const notice=await readFile(join(installed,'licenses/libvgm-pokey/LICENSE'),'utf8');
  assert.match(notice,/Redistribution and use/);assert.match(notice,/Brad Oliver/);
  const sdk=JSON.parse(await readFile(join(installed,'sources/POKEY-SDK.json'),'utf8'));
  assert.equal(sdk.schemaVersion,1);assert.match(sdk.sdk.manifestSha256,/^[a-f0-9]{64}$/);
  for(const input of sdk.inputs){
    let path,bytes;
    if(input.path.startsWith('vendor/libvgm-pokey/'))path='sources/third_party/libvgm-pokey/'+input.path.slice('vendor/libvgm-pokey/'.length);
    else if(input.path==='LICENSE')path='sources/LICENSE';
    else path='sources/'+input.path;
    bytes=await readFile(join(installed,path));
    if(input.path==='scripts/build_pokey_wasm.sh')bytes=Buffer.from(bytes.toString('utf8').replace('-Ithird_party/libvgm-pokey','-Ivendor/libvgm-pokey').replace('third_party/libvgm-pokey/pokey.cpp','vendor/libvgm-pokey/pokey.cpp'));
    assert.equal(bytes.length,input.size,'SDK source size '+input.path);
    assert.equal(sha256(bytes),input.sha256,'SDK source hash '+input.path);
  }
  const snapshot=JSON.parse(await readFile(join(installed,'sources/third_party/libvgm-pokey/upstream/snapshot-manifest.json'),'utf8'));
  const upstream=await readFile(join(installed,'sources/third_party/libvgm-pokey/upstream/pokey.c'));
  assert.equal(snapshot.files.length,1);assert.equal(snapshot.files[0].license,'BSD-3-Clause');
  assert.equal(sha256(upstream),snapshot.files[0].sha256,'Exact explicitly licensed upstream core is included');

  let checkedModules=0;
  async function checkImports(directoryPath){
    for(const item of await readdir(directoryPath,{withFileTypes:true})){
      const path=join(directoryPath,item.name);
      if(item.isDirectory())await checkImports(path);
      else if(/\.[cm]?js$/.test(item.name)){
        checkedModules++;
        const text=await readFile(path,'utf8');
        for(const match of text.matchAll(/(?:^|\n)\s*(?:import\s+(?:[^;\n]*?\s+from\s*)?|export\s+[^;\n]*?\s+from\s*)["'](\.[^"']+)["']/g))await stat(resolve(dirname(path),match[1].split(/[?#]/)[0]));
      }
    }
  }
  for(const name of ['cli','docs','web'])await checkImports(join(installed,name));

  const channelRows=[];
  for(const dual of [false,true])for(let chip=0;chip<(dual?2:1);chip++)for(let channel=0;channel<4;channel++){
    const bytes=createPokeyVgm({dual,chip,channel,seconds:.25,loop:false});
    const analysis=api.analyzeSource(bytes),support=await api.inspectSourceSupport(bytes);
    assert.equal(analysis.chips.length,1);assert.equal(analysis.chips[0].id,'pokey');
    assert.equal(analysis.chips[0].clockHz,1789790);assert.equal(Boolean(analysis.chips[0].rawClock&0x40000000),dual);
    assert.equal(support.render.status,'configuration-supported');assert.equal(support.render.engine,'pokey');
    assert.deepEqual(support.render.muteIds,Array.from({length:dual?8:4},(_,i)=>`pokey-ch-${i+1}`));
    for(const format of ['midi','musicxml','lilypond','tfi','vgi','opm'])assert.equal(support.exports[format].status,'unavailable','Do not advertise unsupported POKEY export '+format);
    const roundtrip=api.vgmToJson(bytes,{comments:true});
    assert(roundtrip.commands.some(command=>/pokey chip=/.test(command.comment)),'Readable POKEY lossless-JSON comments');
    assert.deepEqual(api.jsonToVgm(roundtrip),bytes,'Lossless dual-bit and register routing roundtrip');
    const wav=await api.renderSource(bytes,{maxSeconds:.08});assert.deepEqual(wav.warnings,[]);audible(wav.bytes,`chip${chip}/channel${channel}`);
    const muteId=`pokey-ch-${chip*4+channel+1}`;
    const muted=await api.renderSource(bytes,{maxSeconds:.08,mute:[muteId]});silent(muted.bytes,muteId);
    channelRows.push({dual,chip,channel,muteId,wavSha256:sha256(wav.bytes),muteExactSilence:true,losslessJson:true});
  }

  const intervalStart=.083,intervalLength=.117,startFrame=Math.round(intervalStart*44100),intervalFrames=Math.round(intervalLength*44100);
  const scenarios=[
    {name:'dual-noise-and-tone',bytes:createPokeyVgm({dual:true,seconds:.5,loop:false,voices:[{chip:0,channel:0,frequency:440,distortion:0},{chip:1,channel:3,frequency:330}]})},
    {name:'dual-second-volume-stream',bytes:createPokeyStreamVgm({dual:true,chip:1,channel:3,seconds:.5,loop:false})},
  ];
  for(const scenario of scenarios){
    const whole=await api.renderSource(scenario.bytes,{maxSeconds:.25}),interval=await api.renderSource(scenario.bytes,{startSeconds:intervalStart,maxSeconds:intervalLength});
    audible(whole.bytes,scenario.name);assert.deepEqual(whole.warnings,[]);assert.deepEqual(interval.warnings,[]);
    assert.deepEqual(wavPcm(interval.bytes),wavPcm(whole.bytes).subarray(startFrame*4,(startFrame+intervalFrames)*4),'WAV seek must match exact continuous noise/stream phase: '+scenario.name);
    if(scenario.name.includes('stream'))silent((await api.renderSource(scenario.bytes,{maxSeconds:.08,mute:['pokey-ch-8']})).bytes,scenario.name);
    evidence.push({scenario:scenario.name,wavSha256:sha256(whole.bytes),intervalSha256:sha256(interval.bytes),startFrame,intervalFrames,seekExactlyMatchesWholePcm:true});
  }

  for(const dual of [false,true]){
    const bytes=createPokeyVgm({dual,chip:dual?1:0,channel:dual?3:0,seconds:.5,loop:false});
    const input=join(directory,dual?'original-dual-pokey.vgz':'original-single-pokey.vgz');
    await writeFile(input,gzipSync(bytes));assert.deepEqual(await api.readSource(input),bytes);
    assert.deepEqual(JSON.parse(run(process.execPath,[cli,'analyze',input,'--json'])),JSON.parse(JSON.stringify(api.analyzeSource(bytes))));
    assert.deepEqual(JSON.parse(run(process.execPath,[cli,'support',input,'--json'])),JSON.parse(JSON.stringify(await api.inspectSourceSupport(bytes))));
    const json=join(directory,`lossless-${dual}.json`),restored=join(directory,`restored-${dual}.vgm`);
    run(process.execPath,[cli,'to-json',input,'--comments','--output',json]);
    run(process.execPath,[cli,'from-json',json,'--output',restored]);assert.deepEqual(new Uint8Array(await readFile(restored)),bytes);
    const output=join(directory,`interval-${dual}.wav`),mutedOutput=join(directory,`muted-${dual}.wav`);
    run(process.execPath,[cli,'render',input,'--start',String(intervalStart),'--max-seconds',String(intervalLength),'--output',output]);
    const reference=await api.renderSource(bytes,{startSeconds:intervalStart,maxSeconds:intervalLength});
    assert.deepEqual(new Uint8Array(await readFile(output)),reference.bytes,'CLI/API interval WAV bytes');
    run(process.execPath,[cli,'render',input,'--max-seconds','.08','--mute',dual?'pokey-ch-8':'pokey-ch-1','--output',mutedOutput]);
    silent(new Uint8Array(await readFile(mutedOutput)),'CLI '+(dual?'dual':'single'));
  }

  // Public engine factory + installed parser/factory prove shared-WASM handles,
  // independent Mixer strips, cold replay and disposal without any source imports.
  const {Ym2612VGM}=await import(pathToFileURL(join(installed,'docs/js/ym2612vgm.js')).href);
  const {getNodePlaybackFactory}=await import(pathToFileURL(join(installed,'cli/render.js')).href);
  const dualSource=createPokeyVgm({dual:true,seconds:.5,loop:false,voices:[{chip:0,channel:0,frequency:440,volume:8},{chip:1,channel:3,frequency:330,volume:8}]});
  const engine=await api.createPlaybackEngine(new Ym2612VGM(dualSource),{getFactory:getNodePlaybackFactory});
  const reference=await api.createPlaybackEngine(new Ym2612VGM(dualSource),{getFactory:getNodePlaybackFactory});
  let lifecycle;
  try{
    assert.deepEqual([...engine.playbackMixer.strips.keys()],['pokey','pokey:2']);
    for(const id of ['pokey','pokey:2'])assert.deepEqual(engine.playbackMixer.get(id),{gain:1,pan:0,muted:false});
    const player=api.createPlaybackPlayer(engine,dualSource),other=api.createPlaybackPlayer(reference,dualSource);
    for(const p of [player,other]){p.setPrefetchFactor(1);p.play();}
    const first=readPlayer(player,1024);assert.deepEqual(first,readPlayer(other,1024));
    player.stop();player.play();assert.deepEqual(readPlayer(player,1024),first,'Cold replay of both POKEY cores');
    engine.playbackMixer.set('pokey:2',{gain:.25,pan:1,muted:true});
    assert.deepEqual(engine.playbackMixer.get('pokey'),{gain:1,pan:0,muted:false},'Second-strip edits must not affect first strip');
    assert.deepEqual(engine.playbackMixer.get('pokey:2'),{gain:.25,pan:1,muted:true});
    engine.playbackMixer.set('pokey:2',{gain:1,pan:0,muted:false});engine.playbackMixer.reset();
    const firstCore=engine.entries.get('pokey:0').engine,secondCore=engine.entries.get('pokey:1').engine;
    const referenceSecond=reference.entries.get('pokey:1').engine;
    assert.notEqual(firstCore,secondCore);firstCore.dispose();
    const continuation=secondCore.processFrames(1024);
    assert.deepEqual(continuation,referenceSecond.processFrames(1024),'Disposing POKEY1 must not alter POKEY2 state');
    assert(continuation.left.some(v=>v!==0));
    lifecycle={independentMixerIds:true,explicitUnity:true,coldReplayExactlyEqual:true,secondCoreSurvivesFirstDisposal:true,continuationPcmSha256:pcmDigest(continuation)};
  }finally{engine.dispose();reference.dispose();}
  const variant=createPokeyVgm({seconds:.1,loop:false});new DataView(variant.buffer).setUint32(0xb0,0x80000000|1789790,true);
  assert.equal((await api.inspectSourceSupport(variant)).render.status,'unsupported');
  await assert.rejects(api.renderSource(variant,{maxSeconds:.05}),/POKEY|variant/i);
  const report={schemaVersion:1,passed:true,scope:'Unpublished local POKEY VGM package candidate; no build/publication/device',
    package:{name:manifest.name,version:manifest.version,license:manifest.license},tarball:{name:basename(tarball),bytes:archiveBytes.length,sha256:sha256(archiveBytes)},
    offlineInstall:true,ignoreInstallScripts:true,publicApi:true,cli:true,checkedModules,channelRows,scenarios:evidence,lifecycle,
    sourceFiles,archiveProof:{files:Object.keys(packedFiles).length,everyInstalledFileExactlyMatchesTarball:true,...(stage?{stagingTree:stage,everyTarballFileExactlyMatchesStage:true}:{}),packedFiles},
    sdk:{version:sdk.sdk.version,manifestSha256:sdk.sdk.manifestSha256,inputs:sdk.inputs.length,upstreamCoreExactHash:true,originalBsdNotice:true},
    checkerSha256:sha256(await readFile(fileURLToPath(import.meta.url))),fixtureSha256:sha256(await readFile(new URL('../test/helpers/pokey_vgm_fixture.mjs',import.meta.url))),
    physicalAudioTested:false,hardwareCompared:false,published:false};
  if(reportPath)await writeFile(resolve(reportPath),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:true,package:report.package,tarball:report.tarball,
    offlineInstall:true,checkedModules,channelCases:channelRows.length,seekCases:evidence.length,
    packedFiles:report.archiveProof.files,allInstalledBytesMatchArchive:true,allStagedBytesMatchArchive:Boolean(stage),
    lifecycle,...(reportPath?{report:resolve(reportPath)}:{})}));
}finally{await rm(directory,{recursive:true,force:true});}
