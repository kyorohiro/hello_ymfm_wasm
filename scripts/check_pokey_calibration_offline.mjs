/** Actual pinned native POKEY, shipped WASM and unchanged speaker Worklet.
 * This proof opens no AudioContext, Browser or physical audio device.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import factory from '../docs/generated/pokey_wasm.js';
import {Pokey} from '../web/pokey.js';
import {PokeySynth} from '../web/pokeysynth.js';
import {PokeyAudioEngine} from '../web/pokeyaudioengine.js';
import {PokeyVoiceInspector} from '../web/playground_pokey_inspector.js';
import {createProcessorPerformance,performanceNoteRelease} from '../web/playground_performance_processor.js';
import {receiveChipInspector} from '../web/playground_chip_inspector_state.js';
import {POKEY_TIMELINE_CHUNK_BYTES,POKEY_TIMELINE_VALIDATE_WRITES_PER_QUANTUM,createPokeyTimelineUpload,createPokeyChunkTimelineCursor} from '../web/pokey_timeline_upload.js';
import {buildPokeyCalibrationReference} from './soundchip_calibration_pokey.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const hash=value=>createHash('sha256').update(value).digest('hex');
// Text protocol shared by the mandatory standalone oracle and optional actual
// application bridge. The latter is never required by a clean SDK checkout.
// Two pairs are alive simultaneously; each pair owns separate raw/speaker
// handles so all four output floats compare at the same source time.
const nativeFixture=`#include "native_genesis_pokey.h"
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
static void sample(float value){uint32_t bits;std::memcpy(&bits,&value,4);for(unsigned shift=0;shift<32;shift+=8)std::cout.put(char(bits>>shift));}
int main(int argc,char**argv){if(argc!=3)return 2;const auto clock=uint32_t(std::strtoul(argv[1],nullptr,10)),rate=uint32_t(std::strtoul(argv[2],nullptr,10));
#ifdef _WIN32
_setmode(_fileno(stdout),_O_BINARY);
#endif
void*raw[2]={nullptr,nullptr};void*speaker[2]={nullptr,nullptr};for(int i=0;i<2;i++){raw[i]=native_pokey_create(rate,clock);speaker[i]=native_pokey_create(rate,clock);if(!raw[i]||!speaker[i])return 3;}
char command;unsigned index,a,b;while(std::cin>>command>>index){if(index>1)return 4;if(command=='d'){native_pokey_destroy(raw[index]);native_pokey_destroy(speaker[index]);raw[index]=speaker[index]=nullptr;continue;}if(command=='c'){if(raw[index]||speaker[index])return 5;raw[index]=native_pokey_create(rate,clock);speaker[index]=native_pokey_create(rate,clock);continue;}if(!raw[index]||!speaker[index])return 6;
if(command=='r'){native_pokey_reset(raw[index]);native_pokey_reset(speaker[index]);}else if(command=='w'){if(!(std::cin>>a>>b))return 7;native_pokey_write(raw[index],a,uint8_t(b));native_pokey_write(speaker[index],a,uint8_t(b));}else if(command=='g'){if(!(std::cin>>a)||a>10000000)return 8;for(unsigned i=0;i<a;i++){float rl,rr,sl,sr;native_pokey_raw_sample(raw[index],&rl,&rr);native_pokey_sample(speaker[index],&sl,&sr);sample(rl);sample(rr);sample(sl);sample(sr);}}else return 9;}
for(int i=0;i<2;i++){native_pokey_destroy(raw[i]);native_pokey_destroy(speaker[i]);}std::cout.flush();return std::cin.eof()&&std::cout.good()?0:10;}
`;
// Independent implementation of the documented10Hz recurrence, not a copied
// application bridge. Raw output comes directly from the fixed SDK core.
// This mandatory proof is self-contained even when no Tauri repo is present.
const speakerOracle=`#include "pokey.h"
#include <cmath>
#include <cstdint>
#include <cstring>
struct SpeakerOracle {
  Pokey chip;
  uint8_t registers[16]{};
  const double coefficient;
  double previousInput=0,previousOutput=0;
  SpeakerOracle(uint32_t rate,uint32_t clock):chip(clock,rate),coefficient(std::exp(-2*3.14159265358979323846*10/rate)){}
};
static void* oracle_pokey_create(uint32_t rate,uint32_t clock){return Pokey::validConfiguration(clock,rate)?new SpeakerOracle(rate,clock):nullptr;}
static void oracle_pokey_destroy(void*handle){delete static_cast<SpeakerOracle*>(handle);}
static void oracle_pokey_reset(void*handle){auto&voice=*static_cast<SpeakerOracle*>(handle);voice.chip.reset();std::memset(voice.registers,0,sizeof voice.registers);voice.previousInput=voice.previousOutput=0;}
static void oracle_pokey_write(void*handle,uint32_t reg,uint8_t value){auto&voice=*static_cast<SpeakerOracle*>(handle);voice.chip.writeRegister(reg,value);if(reg<16)voice.registers[reg]=value;}
static void oracle_pokey_raw_sample(void*handle,float*left,float*right){static_cast<SpeakerOracle*>(handle)->chip.generate(left,right,1);}
static void oracle_pokey_sample(void*handle,float*left,float*right){auto&voice=*static_cast<SpeakerOracle*>(handle);float rawLeft=0,rawRight=0;voice.chip.generate(&rawLeft,&rawRight,1);bool active=false;for(unsigned ch=0;ch<4;ch++)active|=(voice.registers[ch*2+1]&15)!=0;if(!active){voice.previousInput=voice.previousOutput=0;*left=*right=0;return;}voice.previousOutput=double(rawLeft)-voice.previousInput+voice.coefficient*voice.previousOutput;voice.previousInput=rawLeft;*left=*right=float(voice.previousOutput);}
`;
const standaloneFixture=nativeFixture.replace('#include "native_genesis_pokey.h"',speakerOracle).replaceAll('native_pokey_','oracle_pokey_');

function pcmBytes(pcm){
  const bytes=Buffer.alloc(pcm.left.length*16);
  for(let i=0;i<pcm.left.length;i++){bytes.writeFloatLE(pcm.rawLeft[i],i*16);bytes.writeFloatLE(pcm.rawRight[i],i*16+4);bytes.writeFloatLE(pcm.left[i],i*16+8);bytes.writeFloatLE(pcm.right[i],i*16+12);}
  return bytes;
}
function statistics(values,rate,threshold=0){
  let minimum=Infinity,maximum=-Infinity,sum=0,squares=0,nonfinite=0;
  const crossings=[];
  for(let i=0;i<values.length;i++){
    const value=values[i];if(!Number.isFinite(value))nonfinite++;
    minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);sum+=value;squares+=value*value;
    if(i&&values[i-1]<=threshold&&value>threshold)crossings.push(i-1+(threshold-values[i-1])/(value-values[i-1]));
  }
  const dc=sum/values.length,rms=Math.sqrt(squares/values.length);
  return {frames:values.length,minimum,maximum,amplitude:(maximum-minimum)/2,dc,rms,acRms:Math.sqrt(Math.max(0,rms*rms-dc*dc)),nonfinite,
    measuredFrequencyHz:crossings.length>1?(crossings.length-1)*rate/(crossings.at(-1)-crossings[0]):null,
    pcmSha256:hash(Buffer.from(values.buffer,values.byteOffset,values.byteLength))};
}
async function createProcessor(module,binary,source,rate,clock){
  let Type,readyResolve,frame=0;
  const ready=new Promise(resolve=>readyResolve=resolve),messages=[];
  const port={postMessage:value=>{messages.push(value);if(value.ready||value.error)readyResolve(value);}};
  vm.runInNewContext(source.replace(/^import .*;$/gm,''),{
    Pokey,PokeyAudioEngine,PokeyVoiceInspector,performanceNoteRelease,receiveChipInspector,
    POKEY_TIMELINE_CHUNK_BYTES,POKEY_TIMELINE_VALIDATE_WRITES_PER_QUANTUM,createPokeyTimelineUpload,createPokeyChunkTimelineCursor,
    factory:async()=>module,sampleRate:rate,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>frame}),
    AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(_name,constructor)=>Type=constructor,
  });
  const processor=new Type({processorOptions:{clock,wasmBinary:binary}}),status=await ready;
  assert.equal(status.ready,true,JSON.stringify(status));
  return {processor,messages,advance:frames=>{frame+=frames;}};
}
async function createRoute({module,wasmBinary,workletSource,rate,program,index=0,commands=[],expected=[]}){
  const raw=await Pokey.create({moduleFactory:async()=>module,clock:program.clock,sampleRate:rate});
  const harness=await createProcessor(module,wasmBinary,workletSource,rate,program.clock);
  const {processor,messages}=harness;let created=0,pending=0;
  const transport={clock:program.clock,
    reset(){processor.receive({method:'reset'});raw.reset();commands.push(`r ${index}`);},
    writeRegister(address,value,channel){processor.receive({method:'writeRegister',args:[address,value],channel});raw.writeRegister(address,value);commands.push(`w ${index} ${address} ${value}`);},
  };
  const synth=new PokeySynth({transport});
  const source=new Proxy(synth,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?async(...args)=>{pending++;try{await new Promise(resolve=>setImmediate(resolve));return value.apply(target,args);}finally{pending--;}}:value;}});
  const context={};
  const execute=code=>new AsyncFunction('createSoundChip','pokey','pokey2','context',code)(async(kind,options)=>{assert.equal(kind,'pokey');assert.deepEqual(options,{id:'calibration-source'});created++;return source;},source,source,context);
  return {raw,processor,messages,context,synth,source,execute,commands,expected,
    async setup(){await execute(program.setup);assert.equal(pending,0);assert.equal(created,program.role==='extra'?1:0);assert.equal(context.calibrationSource,source);},
    async stop(){await execute(program.stop);assert.equal(pending,0);},
    render(frames){
      const pcm={left:new Float32Array(frames),right:new Float32Array(frames),rawLeft:new Float32Array(frames),rawRight:new Float32Array(frames)};
      for(let offset=0;offset<frames;offset+=128){
        const count=Math.min(128,frames-offset),left=pcm.left.subarray(offset,offset+count),right=pcm.right.subarray(offset,offset+count);
        assert.equal(processor.process([],[[left,right]]),true);harness.advance(count);
        const chunk=raw.generateStereo(count);pcm.rawLeft.set(chunk.left,offset);pcm.rawRight.set(chunk.right,offset);
        commands.push(`g ${index} ${count}`);
        expected.push(pcmBytes({left,right,rawLeft:chunk.left,rawRight:chunk.right}));
      }
      return pcm;
    },
    dispose(){processor.dispose();raw.dispose();synth.dispose();},
  };
}

export async function measurePokeyCalibrationOffline({nativeBridgeDirectory='w/tetorica-fm2612-playground-tauri/src-tauri/src'}={}){
  const vendor='third_party/tetorica-soundchip-native/vendor/libvgm-pokey';
  const compiler=process.env.CXX||'c++';
  const probe=spawnSync(compiler,['--version'],{encoding:'utf8'});assert.equal(probe.status,0,probe.stderr||probe.error?.message);
  const temp=await mkdtemp(join(tmpdir(),'pokey-calibration-native-'));
  try{
    const fixture=join(temp,'fixture.cpp'),binary=join(temp,'pokey-reference');await writeFile(fixture,standaloneFixture);
    const compile=(args)=>{const built=spawnSync(compiler,['-std=c++17','-O2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off','-I'+join(root,vendor),...args],{encoding:'utf8',maxBuffer:4*1024*1024});assert.equal(built.status,0,built.stderr||built.error?.message);};
    compile([fixture,join(root,vendor,'pokey.cpp'),'-o',binary]);
    let actualBridgeBinary=null;
    const actualNativeBridge={performed:false,reason:nativeBridgeDirectory===null?'explicitly disabled; standalone SDK proof still mandatory':'local Tauri bridge is absent; standalone SDK proof is self-contained',sampleComparisons:0,maximumDifference:null,sources:[]};
    if(nativeBridgeDirectory!==null){
      const directory=resolve(root,nativeBridgeDirectory),source=join(directory,'native_genesis_pokey.cpp'),header=join(directory,'native_genesis_pokey.h');
      let bytes;try{bytes=await readFile(source);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(bytes){
        const headerBytes=await readFile(header),bridgeFixture=join(temp,'bridge-fixture.cpp');await writeFile(bridgeFixture,nativeFixture);
        actualBridgeBinary=join(temp,'pokey-actual-bridge');compile(['-I'+directory,bridgeFixture,source,join(root,vendor,'pokey.cpp'),'-o',actualBridgeBinary]);
        Object.assign(actualNativeBridge,{performed:true,reason:'actual local Tauri application speaker bridge compiled against the fixed SDK core',maximumDifference:0,
          sources:[{path:source,bytes:bytes.length,sha256:hash(bytes)},{path:header,bytes:headerBytes.length,sha256:hash(headerBytes)}]});
      }
    }
    const wasmBinary=await readFile(join(root,'docs/generated/pokey_wasm.wasm')),module=await factory({wasmBinary});
    const workletSource=await readFile(join(root,'docs/js/playground_pokey_worklet.js'),'utf8');
    const reference=buildPokeyCalibrationReference();
    const report={schemaVersion:1,passed:false,audioContextCreated:false,physicalAudio:false,listeningPerformed:false,
      method:'Original distortion5 full-volume square; awaited public PokeySynth API, actual shipped WASM and unchanged speaker Worklet against the independently compiled fixed SDK raw core plus an independent C++10Hz speaker recurrence oracle. Separate raw/speaker handles, unity source gains, no Mixer. Optional actual Tauri bridge comparison is reported separately.',
      nativeComparisonTolerance:0,compiler:probe.stdout.split('\n')[0],decodedReference:reference.decodedReference,nativeFixtureSha256:hash(standaloneFixture),standaloneSdkProof:true,speakerOracle:{independent:true,cutoffHz:10,coefficient:'exp(-2*pi*10/outputRate)',maximumDifference:0},actualNativeBridge,sources:[],routes:[],dualIsolation:[],
      limits:['This is an explicitly declared square, not a sine or perceived-loudness test. Native raw DAC is unipolar; application speaker output includes the existing10Hz blocker.',
        'No Browser transport, real-time deadline, physical driver or listening test is performed. Joined pair0 consumes two timers but only upper channel1 is audible.',
        'The mandatory speaker oracle checks the stated recurrence independently; it is not the Tauri bridge. Actual application bridge parity is claimed only when actualNativeBridge.performed is true and its exact source hashes are recorded.']};
    const checkNative=(clock,rate,commands,expected)=>{
      const result=spawnSync(binary,[String(clock),String(rate)],{input:commands.join('\n')+'\n',maxBuffer:8*1024*1024});
      assert.equal(result.status,0,result.stderr?.toString()||result.error?.message);
      const bytes=Buffer.concat(expected);assert.deepEqual(result.stdout,bytes,'native raw and independent speaker oracle PCM are bit-identical to WASM and actual Worklet');
      if(actualBridgeBinary){
        const actual=spawnSync(actualBridgeBinary,[String(clock),String(rate)],{input:commands.join('\n')+'\n',maxBuffer:8*1024*1024});
        assert.equal(actual.status,0,actual.stderr?.toString()||actual.error?.message);assert.deepEqual(actual.stdout,bytes,'optional actual Tauri speaker bridge is bit-identical to the shipped Worklet');
        actualNativeBridge.sampleComparisons+=actual.stdout.length/4;
      }
      return {nativePcmSha256:hash(result.stdout),comparedSamples:result.stdout.length/4,nativeMaximumDifference:0};
    };
    for(const role of ['primary','dual-first','dual-second','extra'])for(const frequencyHz of [220,440,880])for(const rate of [44100,48000]){
      const program=buildPokeyCalibrationReference(frequencyHz,{role}),route=await createRoute({module,wasmBinary,workletSource,rate,program});
      try{
        await route.setup();const r=route.synth.getRegisterSnapshot();
        assert.equal(r[8],0x50);assert.equal(r[15],3);assert.equal(r[3],0xaf);assert.equal(r[1]&15,0);assert.equal(r[5]&15,0);assert.equal(r[7]&15,0);
        assert.equal(r[0]|r[2]<<8,program.period);assert.equal(r[9],0);
        route.render(Math.round(rate*.2));const pcm=route.render(rate);
        assert.deepEqual(pcm.left,pcm.right);assert.deepEqual(pcm.rawLeft,pcm.rawRight);
        const left=statistics(pcm.left,rate),right=statistics(pcm.right,rate),rawLeft=statistics(pcm.rawLeft,rate,reference.decodedReference.expectedRawDc);
        assert.equal(rawLeft.minimum,0);assert.equal(rawLeft.maximum,reference.decodedReference.expectedRawMaximum);
        assert.equal(left.nonfinite,0);assert.ok(left.minimum<0&&left.maximum>0);assert.ok(Math.abs(left.dc)<left.amplitude*.005);
        assert.ok(Math.abs(left.measuredFrequencyHz-program.effectiveFrequencyHz)<.1);
        assert.ok(Math.abs(rawLeft.measuredFrequencyHz-program.effectiveFrequencyHz)<.1);
        assert.ok(left.acRms/left.amplitude>.88&&left.acRms/left.amplitude<1,'sample-integrated high-pass square stays explicitly square');
        const firstHalf=statistics(pcm.left.slice(0,rate/2),rate),secondHalf=statistics(pcm.left.slice(rate/2),rate);
        assert.ok(Math.abs(firstHalf.acRms/secondHalf.acRms-1)<.005,'held voice does not decay');
        await route.stop();const off=route.render(512);for(const key of Object.keys(off))assert.ok(off[key].every(value=>value===0),'key-off is exact silence');
        assert.ok(route.messages.every(message=>!message.error),'actual Worklet accepts every public command');
        const parity=checkNative(program.clock,rate,route.commands,route.expected);
        report.routes.push({role,frequencyHz,outputRate:rate,clock:program.clock,period:program.period,effectiveFrequencyHz:program.effectiveFrequencyHz,left,right,rawLeft,
          firstHalfAcRms:firstHalf.acRms,secondHalfAcRms:secondHalf.acRms,publicApiAwaited:true,keyOffSilence:true,workletSpeakerComparedFrames:rate,
          nativeSampleComparisons:parity.comparedSamples,nativeMaximumDifference:0,nativePcmSha256:parity.nativePcmSha256,passed:true});
      }finally{route.dispose();}
    }
    for(const rate of [44100,48000]){
      const commands=[],expected=[];
      const options={module,wasmBinary,workletSource,rate};
      const first=await createRoute({...options,program:buildPokeyCalibrationReference(220,{role:'dual-first'}),index:0,commands,expected});
      const second=await createRoute({...options,program:buildPokeyCalibrationReference(880,{role:'dual-second'}),index:1,commands,expected});
      const isolated=await createRoute({...options,program:buildPokeyCalibrationReference(880,{role:'dual-second'})});
      let firstDisposed=false;
      try{
        await first.setup();await second.setup();await isolated.setup();let comparedFrames=0;
        for(let block=0;block<12;block++){
          if(block===3)await first.stop();if(block===5)await first.setup();
          if(block===7){first.dispose();firstDisposed=true;commands.push('d 0');}
          if(!firstDisposed)first.render(97+block*17);
          const count=151+block*31,actual=second.render(count),control=isolated.render(count);
          for(const key of Object.keys(actual))assert.deepEqual(actual[key],control[key],'other chip writes, stop, reset and disposal cannot affect this core or speaker');
          comparedFrames+=count;
        }
        await second.stop();const off=second.render(512);assert.ok(off.left.every(value=>value===0));
        const parity=checkNative(1789773,rate,commands,expected);
        report.dualIsolation.push({outputRate:rate,comparedFrames,nativeSampleComparisons:parity.comparedSamples,nativeMaximumDifference:0,nativePcmSha256:parity.nativePcmSha256,
          sourceFrequenciesHz:[220,880],independentRegisterState:true,independentPcmContinuation:true,otherChipStopResetDispose:true,passed:true});
      }finally{if(!firstDisposed)first.dispose();second.dispose();isolated.dispose();}
    }
    for(const path of ['scripts/soundchip_calibration_pokey.mjs','scripts/check_pokey_calibration_offline.mjs','web/pokey.js','web/pokeysynth.js','web/pokeyaudioengine.js','web/playground_pokey_inspector.js',
      'web/playground_performance_processor.js','web/playground_chip_inspector_state.js','web/pokey_timeline_upload.js','web/pokey_timeline.js',
      'docs/js/playground_pokey_worklet.js','docs/generated/pokey_wasm.js','docs/generated/pokey_wasm.wasm',vendor+'/pokey.cpp',vendor+'/pokey.h']){
      const bytes=await readFile(join(root,path));report.sources.push({path,bytes:bytes.length,sha256:hash(bytes)});
    }
    report.nativeSampleComparisons=[...report.routes,...report.dualIsolation].reduce((sum,row)=>sum+row.nativeSampleComparisons,0);
    report.workletSpeakerComparedFrames=report.routes.reduce((sum,row)=>sum+row.workletSpeakerComparedFrames,0);
    report.nativeMaximumDifference=0;report.passed=true;return report;
  }finally{await rm(temp,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let out=null,bridge=true;for(let i=2;i<process.argv.length;i++){if(process.argv[i]==='--out'&&process.argv[i+1])out=resolve(process.argv[++i]);else if(process.argv[i]==='--no-native-bridge')bridge=false;else throw new Error('Usage: node scripts/check_pokey_calibration_offline.mjs [--out REPORT.json] [--no-native-bridge]');}
  const report=await measurePokeyCalibrationOffline(bridge?{}:{nativeBridgeDirectory:null});if(out)await writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`POKEY offline calibration: ${report.routes.length} routes, ${report.dualIsolation.length} dual isolation cases passed; ${report.nativeSampleComparisons} native SDK/WASM raw and independent speaker-oracle sample comparisons, maximum difference0; actual Tauri bridge ${report.actualNativeBridge.performed?'also compared '+report.actualNativeBridge.sampleComparisons+' samples':'not tested'}.`);
}
