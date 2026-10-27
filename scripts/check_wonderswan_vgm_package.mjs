// Verify an already-packed VGM package in an isolated offline consumer.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createWonderSwanVgm} from '../test/helpers/wonderswan_vgm_fixture.mjs';
import {createWonderSwanSampleVgm} from '../test/helpers/wonderswan_sample_vgm_fixture.mjs';

assert(process.argv[2],'Pass an existing tetorica-vgm .tgz; this check does not rebuild or publish it.');
const options=process.argv.slice(3);
for(const option of options)assert(option.startsWith('--out=')||option.startsWith('--large-file='),'Unknown option: '+option);
const largeFile=options.find(option=>option.startsWith('--large-file='))?.slice(13);
const reportPath=options.find(option=>option.startsWith('--out='))?.slice(6);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function unzip(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=new Map();let at=0;
  while(view.getUint32(at,true)===0x04034b50){
    assert.equal(view.getUint16(at+8,true),0,'Expected stored sample ZIP');
    const size=view.getUint32(at+18,true),length=view.getUint16(at+26,true),extra=view.getUint16(at+28,true);
    const name=new TextDecoder().decode(bytes.subarray(at+30,at+30+length));
    const start=at+30+length+extra;files.set(name,bytes.slice(start,start+size));at=start+size;
  }return files;
}
const tarball=resolve(process.argv[2]),directory=await mkdtemp(join(tmpdir(),'tetorica-wonderswan-package-'));
const run=(command,args)=>execFileSync(command,args,{cwd:directory,encoding:'utf8',maxBuffer:4*1024*1024});
try {
  await writeFile(join(directory,'package.json'),'{"private":true,"type":"module"}\n');
  run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--cache',join(directory,'npm-cache'),tarball]);
  const require=createRequire(join(directory,'package.json'));
  const api=await import(pathToFileURL(require.resolve('tetorica-vgm')).href);
  const installed=join(directory,'node_modules/tetorica-vgm');
  const sourceFiles={};
  for(const name of ['cli/index.js','cli/main.js','cli/render.js','docs/vgm_analyzer/analyzer_core.js',
    'docs/vgm_analyzer/sample_core.js','docs/vgm_analyzer/sample_render.js','docs/vgm_analyzer/wonderswan_waves.js',
    'docs/vgm_analyzer/mixer_defaults.js','docs/vgm_analyzer/mixer_calibration_data.js','docs/js/soundchip_mixer_presets.js',
    'docs/vgm_analyzer/wonderswan_voice_samples.js','docs/vgm_analyzer/wonderswan_voice_render.js',
    'docs/js/wonderswanaudioengine.js','docs/generated/wonderswan_wasm.js','docs/generated/wonderswan_wasm.wasm']) {
    const bytes=await readFile(join(installed,name));sourceFiles[name]={bytes:bytes.length,sha256:sha256(bytes)};
  }
  for(const [name,sourcePath] of [['README.md','packages/vgm/README.md'],['CLI.md','CLI.md']]) {
    const bytes=await readFile(join(installed,name));sourceFiles[name]={bytes:bytes.length,sha256:sha256(bytes),sourcePath};
    assert.match(new TextDecoder().decode(bytes),/Voice PCM/,'Missing Voice PCM documentation: '+name);
  }
  for(const name of ['docs/generated/wonderswan_wasm.js','docs/generated/wonderswan_wasm.wasm',
    'docs/js/wonderswanaudioengine.js','docs/vgm_analyzer/wonderswan_notes.js',
    'docs/vgm_analyzer/wonderswan_waves.js','docs/vgm_analyzer/wonderswan_voice_samples.js',
    'docs/vgm_analyzer/wonderswan_voice_render.js','licenses/mame-wonderswan.txt']) {
    assert((await stat(join(installed,name))).size>0,'Missing packed WonderSwan asset: '+name);
  }
  assert.match(await readFile(join(installed,'licenses/mame-wonderswan.txt'),'utf8'),/Redistribution and use/);
  const rows=[];
  for(const mode of ['wave','noise','sweep','voice']) {
    const bytes=createWonderSwanVgm({mode,seconds:.2,loop:false});
    const report=api.analyzeSource(bytes);assert.equal(report.chips[0].id,'wonderswan');
    const wav=await api.renderSource(bytes,{maxSeconds:.1});assert.deepEqual(wav.warnings,[]);
    assert(wav.bytes.subarray(44).some(Boolean),'Silent installed '+mode);
    const channel={wave:1,noise:4,sweep:3,voice:2}[mode];
    const muted=await api.renderSource(bytes,{maxSeconds:.1,mute:['wonderswan-ch-'+channel]});
    assert(muted.bytes.subarray(44).every(v=>v===0),'Installed mute leaked '+mode);
    rows.push({mode,wavBytes:wav.bytes.length,muted:true});
  }
  const source=createWonderSwanVgm({seconds:.2,loop:false});
  assert.equal((await api.inspectSourceSupport(source)).render.status,'configuration-supported');
  for(const format of ['midi','musicxml','lilypond']) {
    const result=api.exportSource(source,{format,bpm:120});
    assert((result.bytes??result.text).length>0,'Empty installed '+format);
  }
  const input=join(directory,'original-wonderswan.vgm'),output=join(directory,'original.wav');
  await writeFile(input,source);
  const cli=join(installed,'cli/main.js');
  const support=JSON.parse(run(process.execPath,[cli,'support',input,'--json']));
  assert.equal(support.render.engine,'wonderswan');
  run(process.execPath,[cli,'render',input,'--max-seconds','.1','--output',output]);
  assert((await readFile(output)).subarray(44).some(Boolean));
  const waveSource=createWonderSwanSampleVgm(),inventory=await api.listSourceSamples(waveSource);
  assert.equal(inventory.samples.length,2);assert(inventory.samples.every(s=>s.representation==='written-wave-ram'));
  const exported=await api.exportSourceSamples(waveSource,{id:1});
  const wave=JSON.parse(new TextDecoder().decode(exported.bytes));assert.deepEqual(wave.waveform.slice(0,6),[1,2,3,4,5,6]);
  assert.equal(wave.packedBytes[0],0x21);assert(wave.observations.some(e=>e.channel===2));
  const preview=await api.exportNodeSamples(waveSource,{id:1,format:'wav',occurrence:2});
  assert.equal(preview.seconds,1);assert.equal(preview.bytes.length,176444);assert(preview.bytes.subarray(44).some(Boolean));
  const waveInput=join(directory,'wave-source.vgm'),waveOutput=join(directory,'wave.json');await writeFile(waveInput,waveSource);
  run(process.execPath,[cli,'samples',waveInput,'--id','1','--output',waveOutput]);
  assert.deepEqual(new Uint8Array(await readFile(waveOutput)),exported.bytes);
  // The original synthetic Voice stream crosses two ten-second boundaries.
  // Compare the middle exported capture against an independently rendered
  // segment of the complete VGM, preserving the source's native-tick phase.
  const voiceSource=createWonderSwanVgm({mode:'voice',seconds:21,loop:false});
  const voiceInventory=await api.listSourceSamples(voiceSource),voiceSamples=voiceInventory.samples.filter(s=>s.kind==='voice-pcm');
  assert.equal(voiceSamples.length,3);assert(voiceSamples.every(s=>s.representation==='timed-voice-pcm'&&s.exportable));
  assert.deepEqual(voiceSamples.map(s=>s.durationSamples),[441000,441000,44100]);
  for(const sample of voiceSamples){
    assert(Array.isArray(sample.initial.registers)&&sample.initial.registers.length===32);
    assert(Array.isArray(sample.initial.heldRegisters)&&sample.initial.heldRegisters.length===32);
  }
  const voiceSample=voiceSamples[1],voiceNative=await api.exportSourceSamples(voiceSource,{id:voiceSample.id});
  const voiceJson=JSON.parse(new TextDecoder().decode(voiceNative.bytes));
  assert.equal(voiceJson.format,'tetorica-wonderswan-voice-pcm');assert.equal(voiceJson.timebase,44100);
  assert.equal(voiceJson.sourceStartSample,441000);assert.equal(voiceJson.phase.periodSamples,147);
  assert.equal(voiceJson.times.length,voiceJson.registers.length);assert.equal(voiceJson.times.length,voiceJson.values.length);
  assert.equal(voiceJson.pcmBytes.length,voiceSample.size);assert(voiceJson.registers.every(r=>[9,16,17,20,30].includes(r)));
  const voiceWav=await api.exportNodeSamples(voiceSource,{id:voiceSample.id,format:'wav'});
  assert.equal(voiceWav.seconds,10);assert.equal(voiceWav.bytes.length,1764044);assert(voiceWav.bytes.subarray(44).some(Boolean));
  const voiceReference=await api.renderSource(voiceSource,{startSeconds:10,maxSeconds:10,mute:['wonderswan-ch-1','wonderswan-ch-3','wonderswan-ch-4']});
  assert.deepEqual(voiceWav.bytes,voiceReference.bytes,'Installed Voice PCM WAV differs from the original isolated VGM segment');
  const voiceZip=await api.exportSourceSamples(voiceSource,{all:true}),voiceFiles=unzip(voiceZip.bytes);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(voiceFiles.get('manifest.json'))),voiceInventory);
  assert.deepEqual(voiceFiles.get(voiceNative.name),voiceNative.bytes);assert.equal(voiceZip.count,voiceInventory.samples.length);
  const voiceInput=join(directory,'original-voice.vgm'),voiceOutput=join(directory,'voice.json'),voiceWavOutput=join(directory,'voice.wav'),voiceZipOutput=join(directory,'voice.zip');
  await writeFile(voiceInput,voiceSource);
  assert.deepEqual(JSON.parse(run(process.execPath,[cli,'samples',voiceInput,'--json'])),voiceInventory);
  run(process.execPath,[cli,'samples',voiceInput,'--id',String(voiceSample.id),'--output',voiceOutput]);
  assert.deepEqual(new Uint8Array(await readFile(voiceOutput)),voiceNative.bytes);
  run(process.execPath,[cli,'samples',voiceInput,'--id',String(voiceSample.id),'--format','wav','--output',voiceWavOutput]);
  assert.deepEqual(new Uint8Array(await readFile(voiceWavOutput)),voiceWav.bytes);
  run(process.execPath,[cli,'samples',voiceInput,'--all','--output',voiceZipOutput]);
  assert.deepEqual(new Uint8Array(await readFile(voiceZipOutput)),voiceZip.bytes);
  let largeFileReport;
  if(largeFile){
    const largeSource=await api.readSource(resolve(largeFile));
    const listing=JSON.parse(run(process.execPath,[cli,'samples',resolve(largeFile),'--json']));
    const voices=listing.samples.filter(s=>s.kind==='voice-pcm'),waves=listing.samples.filter(s=>s.kind==='wave');
    assert.equal(voices.length,10);assert.equal(waves.length,6);assert(waves.every(s=>s.usedInPlayback===false));
    const native=await api.exportSourceSamples(largeSource,{id:voices[0].id}),json=JSON.parse(new TextDecoder().decode(native.bytes));
    const output=join(directory,'local-voice.json');run(process.execPath,[cli,'samples',resolve(largeFile),'--id',String(voices[0].id),'--output',output]);
    assert.deepEqual(new Uint8Array(await readFile(output)),native.bytes);
    assert.equal(json.pcmBytes.length,119702);assert.equal(json.times.length,json.values.length);assert.equal(json.initial.registers.length,32);assert.equal(json.initial.heldRegisters.length,32);
    largeFileReport={sourceSha256:sha256(largeSource),durationSamples:listing.time,voiceCaptures:voices.length,unplayedWaves:waves.length,pcmBytes:voices.reduce((n,s)=>n+s.size,0),firstVoice:{id:voices[0].id,pcmBytes:json.pcmBytes.length,jsonBytes:native.bytes.length,jsonSha256:sha256(native.bytes)},cliListing:true,cliNativeJson:true};
  }
  const tarballBytes=await readFile(tarball),manifest=JSON.parse(await readFile(join(installed,'package.json'),'utf8'));
  const report={passed:true,package:{name:manifest.name,version:manifest.version,license:manifest.license},tarball:{name:tarball.split('/').at(-1),bytes:tarballBytes.length,sha256:sha256(tarballBytes)},sourceFiles,checkerSha256:sha256(await readFile(new URL(import.meta.url))),offlineInstall:true,cli:true,exports:['midi','musicxml','lilypond'],waveSamples:{count:2,json:true,previewWav:true,cli:true},
    voiceSamples:{count:3,metadataArrays:true,nativeJson:true,allZip:true,cliListing:true,cliJson:true,cliWav:true,cliZip:true,wavMatchesOriginalSegment:true,wavSha256:sha256(voiceWav.bytes)},...(largeFileReport?{largeFile:largeFileReport}:{}),modes:rows,physicalAudioTested:false};
  if(reportPath)await writeFile(resolve(reportPath),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {await rm(directory,{recursive:true,force:true});}
