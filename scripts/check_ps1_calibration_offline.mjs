/** Actual shipped WASM versus an independently compiled pinned native SPU.
 * Offline PCM measurement only: no Browser, AudioContext or physical output.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import factory from '../docs/generated/ps1_spu_wasm.js';
import {Ps1Spu} from '../web/ps1_spu.js';
import {Ps1Synth} from '../web/ps1synth.js';
import {Ps1Resampler} from '../web/ps1_resampler.js';
import {buildPs1CalibrationReference} from './soundchip_calibration_ps1.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const hash=value=>createHash('sha256').update(value).digest('hex');
const u32=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
function stereoBytes(left,right,frames=left.length,offset=0){
  const bytes=Buffer.alloc(frames*8);
  for(let i=0;i<frames;i++){bytes.writeFloatLE(left[offset+i],i*8);bytes.writeFloatLE(right[offset+i],i*8+4);}
  return bytes;
}
function statistics(values,rate){
  let minimum=Infinity,maximum=-Infinity,sum=0,squares=0,nonfinite=0,jump=0;
  const crossings=[];
  for(let i=0;i<values.length;i++){
    const value=values[i];if(!Number.isFinite(value))nonfinite++;
    minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);sum+=value;squares+=value*value;
    if(i){jump=Math.max(jump,Math.abs(value-values[i-1]));if(values[i-1]<=0&&value>0)crossings.push(i-1-values[i-1]/(value-values[i-1]));}
  }
  const dc=sum/values.length,rms=Math.sqrt(squares/values.length);
  return {frames:values.length,minimum,maximum,amplitude:(maximum-minimum)/2,dc,rms,acRms:Math.sqrt(Math.max(0,rms*rms-dc*dc)),nonfinite,maximumAdjacentJump:jump,
    measuredFrequencyHz:crossings.length>1?(crossings.length-1)*rate/(crossings.at(-1)-crossings[0]):null,
    pcmSha256:hash(Buffer.from(values.buffer,values.byteOffset,values.byteLength))};
}
function runNative(binary,commands){
  const result=spawnSync(binary,[],{input:Buffer.concat([u32(commands.length),...commands]),maxBuffer:32*1024*1024});
  assert.equal(result.status,0,result.stderr?.toString()||result.error?.message);return result.stdout;
}

export async function measurePs1CalibrationOffline(){
  const directory=join(root,'third_party/tetorica-soundchip-native/vendor/mame-ps1-spu');
  const compiler=process.env.CXX||'c++';
  const probe=spawnSync(compiler,['--version'],{encoding:'utf8'});
  assert.equal(probe.status,0,probe.stderr||probe.error?.message||'C++ compiler unavailable');
  const temp=await mkdtemp(join(tmpdir(),'ps1-calibration-native-'));
  try{
    const common=['-std=c++17','-O2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off','-I'+directory];
    const binaries={};
    for(const [name,helper,sources] of [
      ['core','ps1_spu_reference.cpp',['ps1_spu.cpp','spu.cpp','spu_tables.cpp','spureverb.cpp']],
      ['decoder','ps1_adpcm_decode_reference.cpp',['spu_tables.cpp','spureverb.cpp']],
    ]){
      const binary=join(temp,name),built=spawnSync(compiler,[...common,join(root,'test/helpers',helper),...sources.map(value=>join(directory,value)),'-o',binary],{encoding:'utf8',maxBuffer:4*1024*1024});
      assert.equal(built.status,0,built.stderr||built.error?.message);binaries[name]=binary;
    }
    const reference=buildPs1CalibrationReference(),bytes=Buffer.from(reference.decodedReference.adpcmBytes);
    const raw=spawnSync(binaries.decoder,[],{input:Buffer.concat([u32(1),u32(bytes.length),bytes])});
    assert.equal(raw.status,0,raw.stderr?.toString());assert.equal(raw.stdout.length,112*2);
    const decoded=Array.from({length:112},(_,i)=>raw.stdout.readInt16LE(i*2)/32768);
    assert.deepEqual(decoded,reference.decodedReference.decodedSamples,'metadata must match the actual pinned ADPCM decoder');
    const wasmBinary=await readFile(join(root,'docs/generated/ps1_spu_wasm.wasm'));
    const module=await factory({wasmBinary});
    const report={schemaVersion:1,passed:false,audioContextCreated:false,physicalAudio:false,listeningPerformed:false,
      method:'Original filter0/shift0 ADPCM, public Ps1Synth API, actual shipped WASM versus independently compiled pinned native SPU; unity source gains, no Mixer.',
      nativeSampleRate:44100,nativeComparisonTolerance:0,compiler:probe.stdout.split('\n')[0],
      decodedReference:{...reference.decodedReference,decodedPcm16Sha256:hash(raw.stdout),adpcmSha256:hash(bytes)},
      sources:[],routes:[],
      limits:['Output units and deterministic PCM, not perceived loudness or hardware accuracy.',
        'Native parity compares underlying native-rate Float32 PCM and register reads; host-rate PCM uses the existing JavaScript linear resampler.',
        'No Browser transport, realtime deadline, physical driver, or listening test is performed.']};
    for(const role of ['primary','extra'])for(const frequencyHz of [220,440,880])for(const outputRate of [44100,48000]){
      const core=await Ps1Spu.create({moduleFactory:async()=>module}),commands=[],expected=[];let comparisons=0;
      const recorded={sampleRate:44100,get nativeFrames(){return core.nativeFrames;},
        reset(options={}){commands.push(Buffer.concat([u32(0),u32(Number(options.clearRam??false))]));core.reset(options);},
        write(offset,value){commands.push(Buffer.concat([u32(1),u32(offset),u32(value)]));core.write(offset,value);},
        read(offset){commands.push(Buffer.concat([u32(2),u32(offset)]));const value=core.read(offset);expected.push(u32(value));return value;},
        loadRam(data,address){commands.push(Buffer.concat([u32(3),u32(address),u32(data.length),data]));core.loadRam(data,address);},
        readRam(address,length){return core.readRam(address,length);},
        renderInto(left,right,frames,offset=0){commands.push(Buffer.concat([u32(5),u32(frames)]));core.renderInto(left,right,frames,offset);expected.push(stereoBytes(left,right,frames,offset));comparisons+=frames*2;},
        dispose(){core.dispose();},
      };
      const synth=new Ps1Synth({core:recorded});
      // Real public authoring methods behind an asynchronous transport facade.
      // Pending work must finish before the first capture or stop returns.
      let pending=0,created=0;
      const source=new Proxy(synth,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?async(...args)=>{pending++;try{await new Promise(resolve=>setImmediate(resolve));return value.apply(target,args);}finally{pending--;}}:value;}});
      const context={},program=buildPs1CalibrationReference(frequencyHz,{role});
      const execute=code=>new AsyncFunction('createSoundChip','ps1','context',code)(async(kind,options)=>{assert.equal(kind,'ps1');assert.deepEqual(options,{id:'calibration-source'});created++;return source;},source,context);
      try{
        await execute(program.setup);assert.equal(pending,0);assert.equal(created,role==='extra'?1:0);assert.equal(context.calibrationSource,source);
        const resampler=new Ps1Resampler(recorded,outputRate);
        const render=frames=>{const left=new Float32Array(frames),right=new Float32Array(frames);resampler.render(left,right,frames);return {left,right};};
        render(Math.round(outputRate*.2));
        const pcm=render(outputRate),left=statistics(pcm.left,outputRate),right=statistics(pcm.right,outputRate);
        assert.deepEqual(pcm.left,pcm.right,'unity left/right reference is exactly centered');
        const firstHalf=statistics(pcm.left.slice(0,outputRate/2),outputRate),secondHalf=statistics(pcm.left.slice(outputRate/2),outputRate);
        assert.equal(left.nonfinite,0,'reference PCM is finite');
        assert.ok(left.amplitude>.8&&left.amplitude<.9,'reference uses the held full-unit codec range, not the tiny starter');
        assert.ok(Math.abs(left.measuredFrequencyHz-program.effectiveFrequencyHz)<.3,'actual reference pitch matches the hardware pitch register');
        assert.ok(Math.abs(firstHalf.acRms/secondHalf.acRms-1)<.005,'held envelope does not decay during the capture');
        const envelope=recorded.read(12),pitch=recorded.read(4),master=[recorded.read(0x180),recorded.read(0x182)];
        assert.equal(envelope,0x7fff,'actual held envelope reaches the core maximum');assert.deepEqual(master,[0x3fff,0x3fff]);
        await execute(program.stop);assert.equal(pending,0);const release=render(2048);
        assert.ok(release.left.slice(-256).every(value=>value===0),'fast key-off reaches real silence');
        const actual=runNative(binaries.core,commands),expectedBytes=Buffer.concat(expected);
        assert.deepEqual(actual,expectedBytes,'actual native and shipped WASM PCM/register results must be bit-identical');
        report.routes.push({role,frequencyHz,outputRate,effectiveFrequencyHz:program.effectiveFrequencyHz,pitch,master,envelope,
          left,right,firstHalfAcRms:firstHalf.acRms,secondHalfAcRms:secondHalf.acRms,
          nativeSampleComparisons:comparisons,nativeMaximumDifference:0,nativePcmAndRegistersSha256:hash(actual),
          publicApiAwaited:true,keyOffSilence:true,passed:true});
      }finally{synth.dispose();}
    }
    for(const path of ['scripts/soundchip_calibration_ps1.mjs','scripts/check_ps1_calibration_offline.mjs','test/helpers/ps1_spu_reference.cpp','test/helpers/ps1_adpcm_decode_reference.cpp',
      'web/ps1synth.js','web/ps1_spu.js','web/ps1_resampler.js','docs/generated/ps1_spu_wasm.js','docs/generated/ps1_spu_wasm.wasm',
      ...['ps1_spu.h','spu.h','spureverb.h','ps1_spu.cpp','spu.cpp','spu_tables.cpp','spureverb.cpp'].map(name=>'third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/'+name)]){
      const bytes=await readFile(join(root,path));report.sources.push({path,bytes:bytes.length,sha256:hash(bytes)});
    }
    report.nativeSampleComparisons=report.routes.reduce((sum,route)=>sum+route.nativeSampleComparisons,0);
    report.nativeMaximumDifference=0;report.passed=true;return report;
  }finally{await rm(temp,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let out=null;
  for(let i=2;i<process.argv.length;i++){
    if(process.argv[i]==='--out'&&process.argv[i+1])out=resolve(process.argv[++i]);
    else throw new Error('Usage: node scripts/check_ps1_calibration_offline.mjs [--out REPORT.json]');
  }
  const report=await measurePs1CalibrationOffline();
  if(out)await writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`PS1 offline calibration: ${report.routes.length} routes passed; native/WASM maximum difference0, decoded peak${report.decodedReference.decodedPeak}.`);
}
