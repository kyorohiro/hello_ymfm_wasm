import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import spcFactory from '../docs/generated/spc_wasm.js';
import {SnesDspCore} from '../web/spc.js';
import {PCM_CALIBRATION_KINDS,buildPcmCalibrationReference,createPcmCalibrationPrograms} from './soundchip_calibration_pcm.mjs';
import {SegaPSGSynth} from '../web/segapsgsynth.js';
import {AY8910Synth} from '../web/ay8910synth.js';
import {createRf5c164Client} from '../web/playground_rf5c164.js';
import {RF5C164Synth} from '../web/rf5c164synth.js';
import {Oki6258Synth,summarizeOki6258} from '../web/okim6258synth.js';
import {GameboySynth} from '../web/gameboysynth.js';
import {NesApuSynth} from '../web/nesapusynth.js';
import {Huc6280Synth} from '../web/huc6280synth.js';
import {PWM32XPlayback} from '../web/pwm32x_playback.js';
import {SnesSynth} from '../web/snessynth.js';
import {decodeBrr} from '../web/snes_brr.js';
import {parseSpcFile} from '../web/spc_file.js';

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
// Exercise actual authoring APIs/codecs without an audio device. Methods are
// deliberately asynchronous, including nested pulse/wave methods, so setup
// completion cannot accidentally depend on a synchronous transport facade.
function fixture(kind){
  const registers=kind==='segapsg'?new Uint16Array(8):new Uint8Array(0x5000),ram=new Uint8Array(65536),calls=[];
  let synth,playing=false,loaded=null,pending=0,creations=0,latch=0;
  const write=(register,value)=>{registers[register]=value;calls.push([register,value]);};
  const transport={writeRegister:write,reset(){registers.fill(0);},
    async loadMemory(bytes,address){ram.set(bytes,typeof address==='number'?address:0);loaded={bytes:bytes.slice(),metadata:address};},
    play(){playing=true;},stop(){playing=false;},
  };
  if(kind==='segapsg')synth=new SegaPSGSynth({transport:{...transport,write(value){
    if(value&128)latch=(value>>4)&7;
    if(latch&1)registers[latch]=value&15;
    else registers[latch]=value&128?(registers[latch]&0x3f0)|(value&15):(registers[latch]&15)|((value&63)<<4);
  }}});
  else if(kind==='ay8910')synth=new AY8910Synth({transport});
  else if(kind==='rf5c164'){
    const hardware=new RF5C164Synth({transport:{...transport,write}});
    const port={start(){},close(){},postMessage({id,method,args}){queueMicrotask(async()=>{
      try{port.onmessage({data:{id,value:await hardware[method](...args)}});}
      catch(error){port.onmessage({data:{id,error:error.message}});}
    });}};
    synth=createRf5c164Client(port,()=>{throw new Error('Reference must supply original PCM directly');});
  }
  else if(kind==='okim6258')synth=new Oki6258Synth({transport});
  else if(kind==='gameboy')synth=new GameboySynth({transport});
  else if(kind==='nes')synth=new NesApuSynth({transport});
  else if(kind==='huc6280')synth=new Huc6280Synth({transport});
  else if(kind==='pwm')synth=new PWM32XPlayback({sampleRate:48000});
  else if(kind==='snes')synth=new SnesSynth({core:{reset(){registers.fill(0);},writeDsp:write,loadRam(bytes,address){ram.set(bytes,address);}}});
  else synth={loadSPC(bytes){loaded=parseSpcFile(bytes);},play(){assert.ok(loaded);playing=true;},stop(){playing=false;}};
  const wrapped=new WeakMap();
  function facade(target){
    if(wrapped.has(target))return wrapped.get(target);
    const result=new Proxy({}, {get(_target,key){
      const value=Reflect.get(target,key,target);
      if(typeof value==='function')return async(...args)=>{pending++;try{await new Promise(resolve=>setImmediate(resolve));return await value.apply(target,args);}finally{pending--;}};
      return ['wave','pulse'].includes(key)&&value?facade(value):value;
    }});wrapped.set(target,result);return result;
  }
  const source=facade(synth),context={};
  return {registers,ram,calls,synth,source,context,get loaded(){return loaded;},get playing(){return playing;},get pending(){return pending;},get creations(){return creations;},
    async run(program){await new AsyncFunction('createSoundChip','context',program)(async(name,options)=>{
      assert.equal(name,kind);assert.deepEqual(options,{id:'calibration-source'});creations++;return source;
    },context);assert.equal(pending,0,'setup/stop must await every asynchronous client method');},
  };
}

function assertPitch(actual,expected,tolerance=0.006){assert.ok(Math.abs(actual-expected)/expected<tolerance,`${actual} Hz differs from ${expected} Hz`);}
function assertSineCodes(codes,max){assert.equal(codes.length,32);assert.equal(Math.min(...codes),0);assert.equal(Math.max(...codes),max);assert.deepEqual(codes,Array.from({length:32},(_,i)=>Math.round(max/2+max/2*Math.sin(2*Math.PI*i/32))));}

for(const frequency of [220,440,880])for(const kind of PCM_CALIBRATION_KINDS){
  test(`${kind} ${frequency} Hz reference validates public setup, original sample and release`,async()=>{
    const reference=buildPcmCalibrationReference(kind,frequency),f=fixture(kind);
    await f.run(reference.setup);assert.equal(f.creations,1);assert.equal(f.context.calibrationSource,f.source);
    const r=f.registers;
    if(kind==='segapsg'){
      assert.equal(r[1],0);assert.deepEqual([r[3],r[5],r[7]],[15,15,15]);assertPitch(3579545/(32*r[0]),frequency);
    }else if(kind==='ay8910'){
      assert.equal(r[8],15);assert.equal(r[9],0);assert.equal(r[10],0);assert.equal(r[7]&9,8);assertPitch(f.synth.clock/(16*(r[0]|r[1]<<8)),frequency);
    }else if(kind==='rf5c164'){
      assert.equal(f.loaded.bytes.length,259);assert.deepEqual([...f.loaded.bytes.slice(256)],[255,128,255]);
      assert.equal(Math.max(...f.loaded.bytes.slice(0,256).map(value=>value&127)),126);
      const channel=f.calls.filter(([reg])=>reg===8).at(-1);assert.deepEqual(channel,[8,254]);assert.equal(r[0],255);assert.equal(r[1],255);
      assertPitch((r[2]|r[3]<<8)*12500000/(384*2048*256),frequency);
    }else if(kind==='okim6258'){
      assert.equal(f.playing,true);assert.equal(f.synth.divider,512);assert.equal(f.synth.pan,0);assert.equal(f.loaded.bytes.length,31250);
      const preview=summarizeOki6258(f.loaded.bytes);assert.equal(preview.frames,62500);assert.ok(Math.max(...preview.waveform.map(Math.abs))>0.95);
      assert.equal(f.synth.sample.durationSeconds,4);
    }else if(kind==='gameboy'){
      assert.equal(r[20],0x77);assert.ok((r[21]&0x44)===0x44);assert.equal(r[10]&128,128);assert.equal(r[12]&0x60,0x20);
      assertSineCodes([...r.slice(32,48)].flatMap(byte=>[byte>>4,byte&15]),15);
      assert.equal(r[2],0);assert.equal(r[7],0);assert.equal(r[17],0);
      assertPitch(f.synth.clock/(64*(2048-(r[13]|(r[14]&7)<<8))),frequency,0.012);
    }else if(kind==='nes'){
      assert.equal(r[0x4015],1);assert.equal(r[0x4000],0xbf);assert.equal(r[0x4001]&128,0);assert.equal(f.synth.fdsEnabled,false);
      assertPitch(f.synth.clock/(16*(1+(r[0x4002]|(r[0x4003]&7)<<8))),frequency);
    }else if(kind==='huc6280'){
      const s=f.synth._getState();assert.equal(s.globals[1],255);assert.equal(s.globals[9]&3,0);assert.equal(s.registers[0][4],159);assert.equal(s.registers[0][5],255);
      assertSineCodes(s.waveforms[0],31);assert.ok(s.registers.slice(1,6).every(values=>(values[4]&128)===0));
      assertPitch(f.synth.clock/(32*(s.registers[0][2]|(s.registers[0][3]&15)<<8)),frequency,0.012);
    }else if(kind==='pwm'){
      assert.equal(f.synth.getState().outputMode,'duty');assert.equal(f.synth.chip.gain,1);assert.ok(f.synth.queue.length<1000000);assert.ok(f.synth.queue.length>80000);
      const pcm=f.synth.generateStereo(48000/4),steady=pcm.left.slice(9600);assert.deepEqual(pcm.left,pcm.right);
      const peak=Math.max(...steady),trough=Math.min(...steady),rms=Math.sqrt(steady.reduce((sum,value)=>sum+value*value,0)/steady.length);
      assert.ok(peak>0.98&&trough<-.98,`PWM steady limits ${trough}..${peak}`);assert.ok(rms>.69&&rms<.72);
    }else if(kind==='snes'){
      assert.equal(f.synth.samples.length,1);assert.equal(r[0x4c],1);assert.equal(r[0x5c],254);assert.equal(r[0x6c],0x20);
      for(const address of [0,1,7,0x0c,0x1c])assert.equal(r[address],127);
      const sample=f.synth.samples[0],decoded=decodeBrr(f.ram.slice(sample.startAddress,sample.startAddress+sample.byteLength));
      assert.equal(decoded.loop,true);assert.equal(decoded.pcm.length,64);assert.equal(Math.min(...decoded.pcm),-.875);assert.equal(Math.max(...decoded.pcm),.875);
      assertPitch((r[2]|r[3]<<8)*32000/(4096*64),frequency);
    }else{
      assert.equal(reference.defaultCalibration,true);assert.equal(f.playing,true);assert.equal(f.loaded.cpu.pc,0x200);assert.deepEqual([...f.loaded.ram.slice(0x200,0x202)],[0x2f,0xfe]);
      const d=f.loaded.dsp;assert.equal(d[0x4c],1);assert.equal(d[0x5d],16);assert.equal(d[0x6c],32);
      assert.equal(decodeBrr(f.loaded.ram.slice(0x2000,0x2024)).loop,true);assertPitch((d[2]|d[3]<<8)*32000/(4096*64),frequency);
    }
    await f.run(reference.stop);assert.equal(f.creations,1);
    if(kind==='segapsg')assert.equal(r[1],15);
    else if(kind==='ay8910')assert.equal(r[8],0);
    else if(kind==='rf5c164')assert.equal(r[8],255);
    else if(kind==='okim6258'||kind==='spc')assert.equal(f.playing,false);
    else if(kind==='gameboy')assert.equal(r[10]&128,0);
    else if(kind==='nes')assert.equal(r[0x4015],0);
    else if(kind==='huc6280')assert.equal(f.synth._getState().registers[0][4]&128,0);
    else if(kind==='pwm'){assert.equal(f.synth.queue.length,0);const pcm=f.synth.generateStereo(16);assert.ok(pcm.left.every(value=>value===0));}
    else assert.equal(r[0x5c],255);
    if(kind==='pwm')f.synth.dispose();
  });
}

test('PCM inventory, codec metadata and frequency validation are deterministic',()=>{
  assert.equal(new Set(PCM_CALIBRATION_KINDS).size,10);assert.deepEqual(createPcmCalibrationPrograms().map(({kind})=>kind),PCM_CALIBRATION_KINDS);
  assert.throws(()=>buildPcmCalibrationReference('unknown'),/Unsupported/);
  for(const frequency of [0,-1,Infinity,NaN,'440'])assert.throws(()=>buildPcmCalibrationReference('nes',frequency),/220, 440 or 880/);
  assert.equal(buildPcmCalibrationReference('snes').decodedReference.decodedPeak,.875);
  assert.equal(buildPcmCalibrationReference('spc').defaultCalibration,true);
});

// Accurate S-DSP Gaussian interpolation can wrap if three decoded samples are
// -32768. Exercise the deployed WASM so a future reference-codec change cannot
// calibrate from that artificial positive spike instead of the sine amplitude.
test('SNES reference stays symmetric and avoids Gaussian overflow in deployed WASM',async()=>{
  const wasmBinary=await readFile(new URL('../docs/generated/spc_wasm.wasm',import.meta.url));
  for(const frequency of [220,440,880]){
    const core=await SnesDspCore.create({moduleFactory:spcFactory,moduleOptions:{wasmBinary}}),synth=new SnesSynth({core});
    try{
      await new AsyncFunction('createSoundChip','context',buildPcmCalibrationReference('snes',frequency).setup)(async()=>synth,{});
      const left=new Float32Array(16000),right=new Float32Array(16000);synth.renderInto(left,right);assert.deepEqual(left,right);
      const steady=left.slice(6400),peak=Math.max(...steady),trough=Math.min(...steady);
      const mean=steady.reduce((sum,value)=>sum+value,0)/steady.length;let jump=0;
      for(let i=1;i<steady.length;i++)jump=Math.max(jump,Math.abs(steady[i]-steady[i-1]));
      assert.ok(peak>.84&&peak<.87&&trough<-.84&&trough>-.87,`reference limits ${trough}..${peak}`);
      assert.ok(Math.abs(mean)<.005,`reference DC ${mean}`);assert.ok(jump<.25,`Gaussian overflow or waveform discontinuity: ${jump}`);
    }finally{synth.dispose();}
  }
});
