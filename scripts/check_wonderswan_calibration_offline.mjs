/** Actual shipped WASM, unchanged Playground speaker Worklet and an
 * independently compiled pinned native core. No AudioContext/device opens.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import factory from '../docs/generated/wonderswan_wasm.js';
import {WonderSwan,WONDERSWAN_CLOCK} from '../web/wonderswan.js';
import {WonderSwanSynth} from '../web/wonderswansynth.js';
import {WonderSwanVoiceInspector} from '../web/playground_wonderswan_inspector.js';
import {ChipClockResampler,validateChipClock} from '../web/playground_chip_clock.js';
import {createProcessorPerformance} from '../web/playground_performance_processor.js';
import {receiveChipInspector} from '../web/playground_chip_inspector_state.js';
import {prepareWonderSwanTimeline,createWonderSwanTimelineCursor} from '../web/wonderswan_timeline.js';
import {buildWonderSwanCalibrationReference} from './soundchip_calibration_wonderswan.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const hash=value=>createHash('sha256').update(value).digest('hex');
function stereoBytes(left,right){
  const bytes=Buffer.alloc(left.length*8);
  for(let i=0;i<left.length;i++){bytes.writeFloatLE(left[i],i*8);bytes.writeFloatLE(right[i],i*8+4);}
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
async function createProcessor(module,binary,source,rate){
  let Type,readyResolve,frame=0;
  const ready=new Promise(resolve=>readyResolve=resolve);
  const messages=[],port={postMessage:value=>{messages.push(value);if(value.ready||value.error)readyResolve(value);}};
  vm.runInNewContext(source.replace(/^import .*;$/gm,''),{
    WonderSwan,WONDERSWAN_CLOCK,factory:async()=>module,WonderSwanVoiceInspector,
    ChipClockResampler,validateChipClock,receiveChipInspector,prepareWonderSwanTimeline,createWonderSwanTimelineCursor,sampleRate:rate,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>frame}),
    AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(_name,constructor)=>Type=constructor,
  });
  const processor=new Type({processorOptions:{clock:WONDERSWAN_CLOCK,wasmBinary:binary}});
  const status=await ready;assert.equal(status.ready,true,JSON.stringify(status));
  return {processor,messages,advance:frames=>{frame+=frames;}};
}

export async function measureWonderSwanCalibrationOffline(){
  const vendor='third_party/tetorica-soundchip-native/vendor/mame-wonderswan';
  const directory=join(root,vendor),compiler=process.env.CXX||'c++';
  const probe=spawnSync(compiler,['--version'],{encoding:'utf8'});
  assert.equal(probe.status,0,probe.stderr||probe.error?.message||'C++ compiler unavailable');
  const temp=await mkdtemp(join(tmpdir(),'wonderswan-calibration-native-'));
  try{
    const binary=join(temp,'wonderswan-reference');
    const built=spawnSync(compiler,['-std=c++14','-O2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off','-I'+directory,
      join(root,'test/helpers/wonderswan_core_fixture.cpp'),join(directory,'wonderswan.cpp'),'-o',binary],{encoding:'utf8',maxBuffer:4*1024*1024});
    assert.equal(built.status,0,built.stderr||built.error?.message);
    const wasmBinary=await readFile(join(root,'docs/generated/wonderswan_wasm.wasm'));
    const module=await factory({wasmBinary});
    const workletSource=await readFile(join(root,'docs/js/playground_wonderswan_worklet.js'),'utf8');
    const reference=buildWonderSwanCalibrationReference();
    const report={schemaVersion:1,passed:false,audioContextCreated:false,physicalAudio:false,listeningPerformed:false,
      method:'Original full-range symmetric four-bit sine, awaited public WonderSwanSynth API, actual shipped WASM and unchanged Playground speaker Worklet versus independently compiled pinned native core; unity source gains, no Mixer.',
      nativeTickRate:24000,nativeComparisonTolerance:0,compiler:probe.stdout.split('\n')[0],
      decodedReference:reference.decodedReference,sources:[],routes:[],
      limits:['Output units and deterministic PCM, not perceived loudness or hardware accuracy.',
        'Native parity compares the raw unipolar DAC PCM. Speaker centering executes the actual shipped Playground Worklet; steady output must equal raw DAC minus its specified waveform mean.',
        'No Browser transport, realtime deadline, physical driver or listening test is performed.']};
    for(const role of ['primary','extra'])for(const frequencyHz of [220,440,880])for(const outputRate of [44100,48000]){
      const raw=await WonderSwan.create({moduleFactory:async()=>module,sampleRate:outputRate});
      const harness=await createProcessor(module,wasmBinary,workletSource,outputRate);
      const {processor,messages}=harness,commands=[],expected=[],registers=new Uint8Array(32);
      let comparisons=0,pending=0,created=0,borrowed=0;
      const transport={
        reset(){processor.receive({method:'reset'});raw.reset();registers.fill(0);commands.push('r');},
        writeRegister(address,value,channel,controlMask){
          processor.receive({method:'writeRegister',args:[address,value],channel,controlMask});
          if(address===0x90&&controlMask!==undefined)value=(registers[16]&~controlMask)|(value&controlMask);
          registers[address-0x80]=value;raw.writeRegister(address,value);commands.push(`w ${address} ${value}`);
        },
        writeMemory(address,value,channel){processor.receive({method:'writeMemory',args:[address,value],channel});raw.writeMemory(address,value);commands.push(`m ${address} ${value}`);},
      };
      const synth=new WonderSwanSynth({transport});
      const source=new Proxy(synth,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?async(...args)=>{pending++;try{await new Promise(resolve=>setImmediate(resolve));return value.apply(target,args);}finally{pending--;}}:value;}});
      const context={},program=buildWonderSwanCalibrationReference(frequencyHz,{role});
      const execute=code=>new AsyncFunction('createSoundChip','useSoundChip','context',code)(async(kind,options)=>{assert.equal(kind,'wonderswan');assert.deepEqual(options,{id:'calibration-source'});created++;return source;},async kind=>{assert.equal(kind,'wonderswan');borrowed++;return source;},context);
      const render=frames=>{
        const left=new Float32Array(frames),right=new Float32Array(frames),rawLeft=new Float32Array(frames),rawRight=new Float32Array(frames);
        for(let offset=0;offset<frames;offset+=128){
          const count=Math.min(128,frames-offset),l=left.subarray(offset,offset+count),r=right.subarray(offset,offset+count);
          assert.equal(processor.process([],[[l,r]]),true);harness.advance(count);
          const pcm=raw.generateStereo(count);rawLeft.set(pcm.left,offset);rawRight.set(pcm.right,offset);
          commands.push(`g ${count}`);expected.push(stereoBytes(pcm.left,pcm.right));comparisons+=count*2;
        }
        return {left,right,rawLeft,rawRight};
      };
      try{
        await execute(program.setup);assert.equal(pending,0);assert.equal(created,role==='extra'?1:0);assert.equal(borrowed,role==='primary'?1:0);assert.equal(context.calibrationSource,source);
        assert.equal(registers[16],1,'only physical channel0 is keyed on');assert.equal(registers[17],8,'headphone output is enabled');assert.equal(registers[8],255,'both hardware levels are15');
        const ram=Array.from({length:16},(_,i)=>raw.readMemory(i));assert.deepEqual(ram,reference.decodedReference.packedBytes,'actual packed RAM is low-nibble-first full-range reference');
        render(Math.round(outputRate*.2));
        const pcm=render(outputRate),left=statistics(pcm.left,outputRate),right=statistics(pcm.right,outputRate),rawStats=statistics(pcm.rawLeft,outputRate);
        assert.deepEqual(pcm.left,pcm.right,'speaker output is exactly centered in stereo');assert.deepEqual(pcm.rawLeft,pcm.rawRight);
        for(let i=0;i<outputRate;i++)assert.equal(pcm.left[i],pcm.rawLeft[i]-reference.decodedReference.expectedRawDc,'speaker changes only the specified DAC midpoint');
        assert.equal(rawStats.minimum,0);assert.equal(rawStats.maximum,225/1024);assert.equal(left.amplitude,reference.decodedReference.expectedSpeakerAmplitude);
        assert.equal(left.nonfinite,0);assert.ok(Math.abs(left.dc)<left.amplitude*.01,'one-second reference is approximately DC free');
        assert.ok(Math.abs(left.measuredFrequencyHz-program.effectiveFrequencyHz)<.3,'actual wave period follows the hardware register');
        assert.ok(Math.abs(left.acRms/left.amplitude-reference.decodedReference.decodedRms)<.02,'actual RMS preserves the quantized sine shape');
        const firstHalf=statistics(pcm.left.slice(0,outputRate/2),outputRate),secondHalf=statistics(pcm.left.slice(outputRate/2),outputRate);
        assert.ok(Math.abs(firstHalf.acRms/secondHalf.acRms-1)<.005,'held volume stays steady');
        await execute(program.stop);assert.equal(pending,0);const release=render(512);
        assert.ok(release.left.every(value=>value===0)&&release.right.every(value=>value===0),'speaker key-off is immediate silence');
        assert.ok(messages.every(message=>!message.error),'actual Worklet accepts every public command');
        const native=spawnSync(binary,[String(WONDERSWAN_CLOCK),String(outputRate)],{input:commands.join('\n')+'\n',maxBuffer:4*1024*1024});
        assert.equal(native.status,0,native.stderr?.toString()||native.error?.message);
        const expectedBytes=Buffer.concat(expected);assert.deepEqual(native.stdout,expectedBytes,'all raw native/WASM stereo frames are bit-identical');
        report.routes.push({role,frequencyHz,outputRate,effectiveFrequencyHz:program.effectiveFrequencyHz,period:2048-(registers[0]|registers[1]<<8),
          left,right,rawLeft:rawStats,firstHalfAcRms:firstHalf.acRms,secondHalfAcRms:secondHalf.acRms,
          nativeSampleComparisons:comparisons,nativeMaximumDifference:0,nativePcmSha256:hash(native.stdout),
          workletSpeakerComparedFrames:outputRate,publicApiAwaited:true,keyOffSilence:true,passed:true});
      }finally{processor.dispose();raw.dispose();synth.dispose();}
    }
    for(const path of ['scripts/soundchip_calibration_wonderswan.mjs','scripts/check_wonderswan_calibration_offline.mjs','test/helpers/wonderswan_core_fixture.cpp',
      'web/wonderswan.js','web/wonderswansynth.js','web/playground_wonderswan_inspector.js','web/playground_chip_clock.js','web/playground_performance_processor.js','web/playground_chip_inspector_state.js','web/wonderswan_timeline.js',
      'docs/js/playground_wonderswan_worklet.js','docs/generated/wonderswan_wasm.js','docs/generated/wonderswan_wasm.wasm',vendor+'/wonderswan.cpp',vendor+'/wonderswan.h']){
      const bytes=await readFile(join(root,path));report.sources.push({path,bytes:bytes.length,sha256:hash(bytes)});
    }
    report.nativeSampleComparisons=report.routes.reduce((sum,route)=>sum+route.nativeSampleComparisons,0);
    report.workletSpeakerComparedFrames=report.routes.reduce((sum,route)=>sum+route.workletSpeakerComparedFrames,0);
    report.nativeMaximumDifference=0;report.passed=true;return report;
  }finally{await rm(temp,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let out=null;
  for(let i=2;i<process.argv.length;i++){
    if(process.argv[i]==='--out'&&process.argv[i+1])out=resolve(process.argv[++i]);
    else throw new Error('Usage: node scripts/check_wonderswan_calibration_offline.mjs [--out REPORT.json]');
  }
  const report=await measureWonderSwanCalibrationOffline();
  if(out)await writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`WonderSwan offline calibration: ${report.routes.length} routes passed; native/WASM maximum difference0, speaker halfP2P${report.decodedReference.expectedSpeakerAmplitude}.`);
}
