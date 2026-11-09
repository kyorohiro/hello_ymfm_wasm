// This file is copied into a temporary project and resolves only its installed npm tarball.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,cp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSoundChip} from 'tetorica-fm2612';
import {SidCore,SID_PAL_CLOCK} from 'tetorica-fm2612/sid.js';
import {SidCore as Extensionless6581} from 'tetorica-fm2612/sid';
import {Sid8580Core} from 'tetorica-fm2612/sid8580.js';
import {Sid8580Core as Extensionless8580} from 'tetorica-fm2612/sid8580';
import {SidSynth,sidWaveformBits,sidWaveformFromBits} from 'tetorica-fm2612/sidsynth.js';
import {SidSynth as ExtensionlessSynth} from 'tetorica-fm2612/sidsynth';
import {runtimeAssetUrl} from 'tetorica-fm2612/assets';
assert.equal(SidCore,Extensionless6581);assert.equal(Sid8580Core,Extensionless8580);assert.equal(SidSynth,ExtensionlessSynth);
assert.equal(typeof globalThis.AudioContext,'undefined');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const checkedFile=async(path,record)=>{const bytes=await readFile(runtimeAssetUrl(path));assert.equal(bytes.length,record.bytes,path+' bytes');assert.equal(sha(bytes),record.sha256,path+' SHA256');return bytes;};
const receipt6581=JSON.parse(await readFile(runtimeAssetUrl('generated/sid/sid-build.json'),'utf8'));
assert.equal(receipt6581.model,'6581');assert.equal(Object.keys(receipt6581.inputs).length,13);
for(const[path,record]of Object.entries(receipt6581.inputs))await checkedFile('sources/sid/'+path,record);
await checkedFile('generated/sid/sid.wasm',receipt6581.output);
const kit=JSON.parse(await readFile(runtimeAssetUrl('sources/sid8580-machine/source-kit.json'),'utf8'));
assert.equal(kit.model,'8580');assert.equal(kit.preview,true);assert.equal(kit.compiledInputCount,99);
assert.equal(Object.keys(kit.compiledInputs).length,99);assert.equal(kit.compilerInvocationPerformed,false);
assert.equal(kit.npmStorage.version,1);
assert.deepEqual(Object.keys(kit.npmStorage.aliases).sort(),[
  'third_party/sidera/upstream/.gitignore','third_party/sidera/upstream/Cargo.toml.orig'].sort());
for(const[path,record]of Object.entries(kit.sources))await checkedFile('sources/sid8580-machine/'+(kit.npmStorage.aliases[path]??path),record);
for(const[path,record]of Object.entries(kit.compiledInputs))assert.deepEqual(kit.sources[path],record,'compiled input retained '+path);
await checkedFile('sources/sid8580-machine/'+kit.npmStorage.restore.path,kit.npmStorage.restore);
const restored=await mkdtemp(join(tmpdir(),'npm-sid-restored-'));
try{
  await cp(runtimeAssetUrl('sources/sid8580-machine/'),restored,{recursive:true});
  for(let pass=0;pass<2;pass++)execFileSync(process.execPath,[join(restored,kit.npmStorage.restore.path)],{cwd:restored,stdio:'inherit'});
  for(const[path,record]of Object.entries(kit.compiledInputs)){
    const bytes=await readFile(join(restored,path));
    assert.equal(bytes.length,record.bytes);assert.equal(sha(bytes),record.sha256,'restored original '+path);
  }
}finally{await rm(restored,{recursive:true,force:true});}
const receiptBytes=await checkedFile('sources/sid8580-machine/'+kit.buildReceipt.path,kit.buildReceipt);
assert.equal(sha(receiptBytes),sha(await readFile(runtimeAssetUrl('generated/sid8580-machine/sid8580-machine-build.json'))));
const receipt8580=JSON.parse(receiptBytes);
for(const artifact of kit.artifacts)await checkedFile(artifact.path,artifact);
for(const name of ['sid8580-endpoint.wasm','sid8580-machine.wasm'])await checkedFile('generated/sid8580-machine/'+name,receipt8580.outputs[name]);
assert(kit.noticeRoots.includes('third_party/sidera/toolchain-notices'));
assert(kit.noticeRoots.includes('third_party/sid8580-machine-toolchain-notices'));
const report={models:[],sourceInputs6581:13,compiledInputs8580:99,sourceAndNoticeFiles8580:Object.keys(kit.sources).length};
const originalFetch=globalThis.fetch;let fetches=0;globalThis.fetch=()=>{fetches++;throw Error('Explicit wasmBinary must not fetch');};
try{
  for(const[model,Core,path]of [['6581',SidCore,'generated/sid/sid.wasm'],['8580',Sid8580Core,'generated/sid8580-machine/sid8580-endpoint.wasm']]){
    const wasmBinary=await readFile(runtimeAssetUrl(path)),core=await Core.create({wasmBinary,sampleRate:48000,clockHz:SID_PAL_CLOCK}),peer=await Core.create({wasmBinary,sampleRate:48000,clockHz:SID_PAL_CLOCK});
    const synth=new SidSynth({core});
    try{
      assert.equal(core.model,model);assert.equal(synth.model,model);assert.equal(synth.clock,SID_PAL_CLOCK);assert.equal(synth.channels,3);
      synth.initialize();synth.setVoice(0,{waveform:'saw',attack:0,decay:0,sustain:12,release:3});synth.noteOn(0,'A4');
      const pcm=core.render(8192);assert(pcm.every(Number.isFinite));const steady=pcm.subarray(4096),peak=Math.max(...steady.map(Math.abs)),span=Math.max(...steady)-Math.min(...steady);let crossings=0;for(let i=1;i<steady.length;i++)if((steady[i-1]<0)!==(steady[i]<0))crossings++;assert(peak>.00001&&span>.0001&&crossings>2,model+' steady oscillating PCM');
      assert(peer.render(1024).every(value=>value===0),'independent '+model+' handle remains silent');
      synth.setVoice(0,{waveform:'saw+triangle'});assert.equal(synth.getRegisterSnapshot()[4]>>4,3);
      for(let mask=0;mask<16;mask++)assert.equal(sidWaveformBits(sidWaveformFromBits(mask)),mask);
      synth.setFilter({mode:'notch',cutoff:700,resonance:5,routing:1,volume:8});assert.equal((synth.getRegisterSnapshot()[24]>>4)&7,5);
      synth.keyOff(0);assert.equal(synth.getRegisterSnapshot()[4]&1,0);assert(core.render(4096).every(Number.isFinite));
      synth.reset();assert(core.render(8192).every(value=>value===0),'reset clears queued PCM '+model);
      peer.dispose();synth.initialize();synth.noteOn(0,'C4');assert(core.render(4096).some(value=>Math.abs(value)>.00001),'peer disposal leaves '+model+' usable');
      report.models.push({model,peak,span,crossings,finite:true,frames:8192,combinedWaveforms:true,independentHandles:true});
    }finally{synth.dispose();core.dispose();peer.dispose();}
    assert.throws(()=>core.render(1),/disposed/);
  }
  assert.equal(fetches,0);
}finally{globalThis.fetch=originalFetch;}
await assert.rejects(()=>createSoundChip('sid'),/Unsupported|Unknown/i);
assert.equal(typeof globalThis.AudioContext,'undefined');
console.log('Installed SID npm source/notice integrity and real 6581/8580 WASM PCM verified: '+JSON.stringify(report));
