/** Actual Native Neo Geo YM2610/YM2610B versus deployed WASM; no audio device. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import factory from '../docs/generated/ym2610b_wasm.js';
import {Ym2610BAudioEngine} from '../web/ym2610baudioengine.js';
import {YM2610BSynth} from '../web/ym2610bsynth.js';
import {encodeAdpcmB} from '../web/adpcm_b_sample.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const option=name=>{const i=process.argv.indexOf(name);assert(i<0||process.argv[i+1],`${name} needs a value`);return i<0?null:process.argv[i+1];};
const out=option('--out');let fixture=option('--fixture'),temporary;
const extra=process.argv.includes('--extra'),fixtureProfile=extra?['--extra']:[],planes=extra?9:2;
const wasmBinary=await fs.readFile(path.join(root,'docs/generated/ym2610b_wasm.wasm'));
const module=await factory({wasmBinary});
let Processor,resolveReady,rejectReady;
if(extra){
  globalThis.sampleRate=48000;globalThis.currentFrame=0;
  globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(data){if(data.ready)resolveReady();if(data.error)rejectReady(Error(data.error));},close(){}};}};
  globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-opn')Processor=processor;};
  await import('../docs/js/playground_opn_worklet.js');
}
const rates=[44100,48000,96000],scenarios=[];
const preset={algorithm:7,feedback:0,pan:{left:true,right:true},operators:Array.from({length:4},(_,i)=>({multi:i+1,tl:36+i*4,ar:31,d1r:0,d2r:0,sl:0,rr:15}))};
const encoded=encodeAdpcmB({channels:[Float32Array.from({length:2048},(_,i)=>Math.sin(i*Math.PI*2/41)*.6)],sampleRate:16000},16000,0x1000000).bytes;
// ADPCM-A and B use different codecs. Deterministic arbitrary A nibbles exercise
// the real A decoder without borrowing a B encoder or any copyrighted sample.
const encodedA=Uint8Array.from({length:1536},(_,i)=>(i*13+(i>>4)*17)^0xa5);
function scenario(name,build,{frames=6144,silentWithoutB=false}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
  const synth=new YM2610BSynth({transport:{write:(p,r,v)=>add('write',p,r,v),reset:()=>add('reset'),loadAdpcmMemory:(type,bytes,offset)=>add('rom',type,offset,bytes.slice())}});
  build({synth,add,at:value=>{frame=value;}});scenarios.push({name,frames,events,silentWithoutB});
}
const fm=(synth,ch=1,note=69)=>{synth.setPreset(ch,preset);synth.noteOn(ch,note);};
function a(synth,address=0){synth.adpcmA.loadMemory(encodedA,address);synth.adpcmA.setVolume(52);for(let ch=0;ch<6;ch++){
  synth.adpcmA.setSample(ch,{start:address+ch*256,end:address+(ch+1)*256});synth.adpcmA.setVoice(ch,{volume:27-ch,left:true,right:true});
}synth.adpcmA.keyOn([0,1,2,3,4,5]);}
function b(synth,address=0){synth.adpcmB.loadMemory(encoded,address);synth.adpcmB.setSample({start:address,end:address+encoded.length});synth.adpcmB.setPlaybackRate(16000);synth.adpcmB.setVolume(180);synth.adpcmB.setPan(true,true);synth.adpcmB.keyOn({repeat:true});}
scenario('all six physical FM slots, YM2610 mask, stereo, LFO and independent gates',({synth,at})=>{
  for(let ch=0;ch<6;ch++){fm(synth,ch,48+ch*5);synth.setPan(ch,ch<4,ch>=2);}
  at(701);synth.setLfo(true,4);synth.setModulation(2,2,5);at(1703);synth.keyOff(1);synth.keyOff(4);
  at(2501);synth.noteOn(1,77);at(4003);for(let ch=0;ch<6;ch++)synth.keyOff(ch);
});
scenario('B-only physical FM slots are silent on original YM2610',({synth,at})=>{
  fm(synth,0,60);fm(synth,3,67);at(1703);synth.setPan(0,true,false);at(2801);synth.setPan(3,false,true);at(4301);synth.keyOff(0);synth.keyOff(3);
},{silentWithoutB:true});
scenario('CH3 special-mode frequency latches including cross-port latch reuse',({synth,at})=>{
  fm(synth,2,60);synth.write(0,0x27,0x40);
  for(let ch=0;ch<3;ch++){synth.write(0,0xac+ch,0x21+ch);synth.write(0,0xa8+ch,0x37+ch*41);}
  at(701);synth.write(0,0xa4,0x23);synth.write(1,0xa1,0x89);
  at(1703);synth.write(1,0xac,0x19);synth.write(0,0xa8,0x46);at(4301);synth.write(0,0x27,0);
});
scenario('SSG tones, noise, all envelope shapes and targeted key-off',({synth,at,add})=>{
  synth.ssg.tone(0,{frequency:440,volume:11});synth.ssg.tone(1,{frequency:659,volume:9});synth.ssg.noise(2,{period:7,volume:10,envelope:true});
  for(let shape=0;shape<16;shape++){at(shape*307+1);synth.ssg.setEnvelope({period:17+shape*7,shape});}
  at(5101);add('off',6);at(5401);synth.ssg.noteOn(0,72);at(5701);add('off',8);
});
scenario('six independently addressed ADPCM-A voices, level, pan and retrigger',({synth,at,add})=>{
  a(synth);at(701);synth.adpcmA.setVoice(0,{left:false,right:true});synth.adpcmA.keyOn(0);
  at(1703);synth.adpcmA.setVolume(36);synth.adpcmA.keyOff([2,3]);at(2801);synth.adpcmA.keyOn([1,4,5]);
  at(3901);add('rom',0,0,new Uint8Array(encodedA.length));synth.adpcmA.keyOn([0,1]);at(4601);synth.adpcmA.loadMemory(encodedA);synth.adpcmA.keyOn([0,1]);
});
scenario('ADPCM-B encoded sample, looping, Delta-N, pan and retrigger',({synth,at,add})=>{
  b(synth);at(701);synth.adpcmB.setPlaybackRate(22050);synth.adpcmB.setPan(true,false);
  at(1703);synth.adpcmB.setVolume(73);at(2501);add('off',15);at(2901);synth.adpcmB.setPan(false,true);synth.adpcmB.keyOn();
  at(4201);synth.adpcmB.setDeltaN(65535);at(4701);synth.adpcmB.keyOff();
});
scenario('independent overlapping A/B ROM addresses, partial replacement and per-bank clear',({synth,at,add})=>{
  a(synth);b(synth);at(701);add('rom',0,0,encodedA.map(v=>v^0x88));synth.adpcmA.keyOn([0,1]);
  at(1703);add('clear',0);synth.adpcmA.keyOn([0,1]);at(2501);add('rom',1,0,encoded.map(v=>v^0x88));
  at(3501);add('clear',1);at(4501);b(synth);a(synth);
});
scenario('ADPCM-A and B final 16 MiB ROM ranges and independent end flags',({synth,at})=>{
  a(synth,0x1000000-encodedA.length);b(synth,0x1000000-encoded.length);
  at(1703);synth.adpcmB.keyOn();at(2801);synth.adpcmA.keyOn([0,1,2,3,4,5]);
  at(4301);synth.write(0,0x1c,0x85);at(4701);synth.write(0,0x1c,0);
});
scenario('all sections and every source mute combination preserve running phase',({synth,at,add})=>{
  fm(synth);synth.ssg.tone(0,{frequency:330,volume:12});a(synth);b(synth);
  for(let mask=0;mask<8;mask++){at(mask*601+1);add('mute',mask);if(mask%2===0)synth.adpcmA.keyOn([0,1,4]);}
  at(5101);add('mute',0);
});
scenario('clock changes and integer resampling including upsample sample holds',({synth,at,add})=>{
  fm(synth);synth.ssg.tone(0,{frequency:330,volume:10});b(synth);
  at(701);add('clock',4000000);at(1403);add('clock',7987200);at(2101);add('clock',10000000);
  at(2803);add('clock',100000);at(3101);add('clock',100000000);at(3401);add('clock',8000000);
});
scenario('chip reset preserves both ROM banks, source mute and edited clock',({synth,at,add})=>{
  a(synth);b(synth);add('clock',7987200);add('mute',1);
  at(1403);synth.reset();at(1701);synth.adpcmA.setVolume(52);synth.adpcmA.keyOn([0,1]);
  synth.adpcmB.setSample({start:0,end:encoded.length});synth.adpcmB.setPlaybackRate(16000);synth.adpcmB.setVolume(180);synth.adpcmB.setPan(true,true);synth.adpcmB.keyOn({repeat:true});
  at(3101);add('mute',0);fm(synth,4,67);
});
scenario('Stop retains preloaded independent ROM banks for later retrigger',({synth,add,at})=>{
  synth.adpcmA.loadMemory(encodedA);synth.adpcmB.loadMemory(encoded);add('stop');
  at(101);synth.adpcmA.setVolume(52);synth.adpcmA.keyOn([0,1]);
  synth.adpcmB.setSample({start:0,end:encoded.length});synth.adpcmB.setPlaybackRate(16000);synth.adpcmB.setVolume(180);synth.adpcmB.setPan(true,true);synth.adpcmB.keyOn({repeat:true});
});
if(extra){
  for(const ch of[0,1,2,3,4,5])for(let algorithm=0;algorithm<8;algorithm++)scenario(`additional physical FM ${ch}, algorithm ${algorithm}, operator masks`,({synth,at})=>{
    synth.setPreset(ch,{...preset,algorithm,feedback:algorithm});synth.noteOn(ch,48+ch*5);
    at(701);synth.setOperator(ch,0,{multi:7,tl:35});at(1703);synth.setOperator(ch,3,{ssg:8+algorithm});
    at(2801);synth.noteOn(ch,79);at(3901);synth.keyOff(ch);at(5101);synth.noteOn(ch,60);
  },{silentWithoutB:ch===0||ch===3});
  for(let shape=0;shape<16;shape++)scenario(`additional SSG envelope ${shape} shared noise and retrigger`,({synth,at})=>{
    for(let ch=0;ch<3;ch++)synth.ssg.tone(ch,{frequency:233+ch*157,volume:15,envelope:true});
    synth.ssg.setEnvelope({period:23,shape});synth.ssg.noise(1,{period:7,volume:15,envelope:true});
    at(1703);synth.ssg.setEnvelope({period:53,shape});at(3301);synth.ssg.setEnvelope({period:0,shape:shape^4});at(5101);synth.ssg.setEnvelope({period:11,shape});
  });
  for(const mode of[5,10,15,0x45,0x85,0xcf])scenario(`additional timer/status/IRQ and CH3 mode ${mode}`,({synth,at})=>{
    fm(synth,2,60);synth.write(0,0x24,255);synth.write(0,0x25,3);synth.write(0,0x26,253);synth.write(0,0x27,mode);
    at(701);synth.write(0,0x27,0x30);at(1703);synth.write(0,0x27,mode);at(2801);synth.write(0,0x1c,0x80);at(3901);synth.write(0,0x24,249);at(5101);synth.write(0,0x27,0);
  });
  scenario('additional sparse ROM cross-page transfers and two banks at high addresses',({synth,at,add})=>{
    a(synth,0xff00);b(synth,0x1ff00);at(701);add('rom',0,0x10000,encodedA);synth.adpcmA.keyOn([0,1,2]);
    at(1703);add('rom',1,0x20000,encoded.map(v=>v^0x88));at(2801);a(synth,0xfefe00);b(synth,0xfeff00);
    at(3901);synth.adpcmB.setPan(false,true);at(5101);synth.adpcmA.keyOn([4,5]);
  });
  scenario('additional reset clears held stereo and fractional phase at slow clock while retaining sparse banks',({synth,at,add})=>{
    fm(synth);synth.ssg.tone(1,{frequency:330,volume:13});a(synth);b(synth);add('clock',100000);
    at(701);add('reset');at(702);synth.ssg.tone(2,{frequency:440,volume:15});at(1703);add('reset');at(2801);fm(synth,5,72);
    at(3901);add('reset');at(5101);add('clock',8000000);a(synth);b(synth);
  });
}
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:extra?'Actual deployed additional playground_opn_worklet.js YM2610 four-FM / YM2610B six-FM variants with WASM, status/IRQ/four read ports':'Actual deployed YM2610/YM2610B WASM plus Ym2610BAudioEngine',
  wasmSha256:createHash('sha256').update(wasmBinary).digest('hex'),rates,variants:['YM2610','YM2610B'],cases:[],maximumDifference:0,totalStereoFrames:0,
  limits:'Offline core/output-rate comparison. Native scheduling, ownership, cancellation and UI IPC are validated separately. Stop gate/control retention, status/IRQ/end flags and zero callback allocations are asserted in the C++ fixture self-test. Chip reset preserves ROM like Synth.reset(), whereas the VGM AudioEngine.reset() explicitly clears ROM.'};
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-ym2610b-'));fixture=path.join(temporary,'fixture');
    execFileSync('clang++',['-std=c++14','-O2','-I'+path.join(project,'native-genesis'),
      path.join(project,'src/native_genesis_ym2610b.cpp'),path.join(project,'src/native_genesis_ym2610b_fixture.cpp'),
      path.join(project,'src/native_genesis_ymfm_opn.cpp'),
      ...['ymfm_ssg.cpp','ymfm_adpcm.cpp'].map(n=>path.join(project,'native-genesis',n)),'-o',fixture],{stdio:'pipe'});}
  report.selfTest=execFileSync(fixture,[...fixtureProfile,'--self-test'],{encoding:'utf8'}).trim();
  for(const variant of [false,true])for(const rate of rates)for(const scenario of scenarios){
    const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    const input=events.map(({frame,op,args})=>`${frame} ${op}${args.length?' '+(op==='rom'?args[0]+' '+args[1]+' '+Buffer.from(args[2]).toString('hex'):args.join(' ')):''}`).join('\n')+'\n';
    const bytes=execFileSync(fixture,[...fixtureProfile,String(rate),String(scenario.frames),String(Number(variant))],{input,maxBuffer:scenario.frames*planes*4+1048576,timeout:30000});
    assert.equal(bytes.length,scenario.frames*planes*4);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
    let reference,engine;
    if(extra){
      globalThis.sampleRate=rate;const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
      reference=new Processor({processorOptions:{name:variant?'ym2610b':'ym2610',wasmBinary}});await ready;
      engine={chip:reference.chip,
        writeYm2610B:(...args)=>reference.apply({method:'write',args},reference.port),
        loadAdpcmRom:(type,bytes,offset,size)=>bytes.length?reference.apply({method:'memory',args:[type,bytes,offset]},reference.port):reference.chip.loadAdpcmRom(type,bytes,offset,size),
        process:(left,right)=>reference.process([],[[left,right]]),
        set chipSampleRate(value){reference.rate=value;},set remainder(value){reference.remainder=value;},set lastLeft(value){reference.left=value;},set lastRight(value){reference.right=value;},
        dispose:()=>reference.dispose()};
    }else engine=await Ym2610BAudioEngine.create({moduleFactory:async()=>module,outputSampleRate:rate,variant});
    let next=0,maximumDifference=0,peak=0,first;
    const left=new Float32Array(1),right=new Float32Array(1);
    const off=voice=>{if(voice<6)engine.writeYm2610B(0,0x28,voice<3?voice:voice+1);else if(voice<9)engine.writeYm2610B(0,8+voice-6,0);else if(voice<15)engine.writeYm2610B(1,0,0x80|(1<<(voice-9)));else engine.writeYm2610B(0,0x10,1);};
    try{for(let frame=0;frame<scenario.frames;frame++){
      while(next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
        if(op==='write')engine.writeYm2610B(...args);
        else if(op==='rom')engine.loadAdpcmRom(args[0],args[2],args[1],0x1000000);
        else if(op==='clear')engine.loadAdpcmRom(args[0],new Uint8Array(),0,0);
        else if(op==='mute'){engine.chip.setSourceMuteMask(args[0]);engine.sourceMuteMask=args[0];}
        else if(op==='clock')engine.chipSampleRate=engine.chip.sampleRate(args[0]);
        else if(op==='reset'||op==='stop'){engine.chip.reset();engine.remainder=0;engine.lastLeft=engine.lastRight=0;}
        else if(op==='off')off(args[0]);else throw Error(op);
      }
      if(extra)globalThis.currentFrame=frame;
      engine.process(left,right,1);
      const expectedValues=[left[0],right[0]];
      if(extra){expectedValues.push(engine.chip.readStatus(),engine.chip.readStatusHi(),Number(engine.chip.getIrq()));for(let port=0;port<4;port++)expectedValues.push(engine.chip.read(port));}
      for(let ch=0;ch<planes;ch++){const expected=expectedValues[ch],value=actual[frame*planes+ch];assert(Number.isFinite(value));const difference=Math.abs(value-expected);
        if(difference&&!first)first={frame,ch,native:value,wasm:expected};maximumDifference=Math.max(maximumDifference,difference);if(ch<2)peak=Math.max(peak,Math.abs(value));}
    }
    assert(maximumDifference<=1e-7,`${scenario.name} (${variant?'YM2610B':'YM2610'}) at ${rate}: difference ${maximumDifference}, ${JSON.stringify(first)}`);
    if(scenario.silentWithoutB&&!variant)assert.equal(peak,0);else assert(peak>1e-4,scenario.name+' must sound');
    report.cases.push({name:scenario.name,variant:variant?'YM2610B':'YM2610',sampleRate:rate,frames:scenario.frames,maximumDifference,peak});
    report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
    }finally{engine.dispose();}
  }
  report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`Native ${extra?'additional YM2610/YM2610B':'YM2610/YM2610B'}: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum difference ${report.maximumDifference}`);
  console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
