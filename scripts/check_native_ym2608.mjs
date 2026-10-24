/** Actual Native PC-98/YM2608 versus deployed WASM. Never opens an audio device. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import factory from '../docs/generated/ym2608_wasm.js';
import {Ym2608AudioEngine} from '../web/ym2608audioengine.js';
import {YM2608Synth} from '../web/ym2608synth.js';
import {encodeAdpcmB} from '../web/adpcm_b_sample.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const option=name=>{const index=process.argv.indexOf(name);assert(index<0||process.argv[index+1],`${name} needs a value`);return index<0?null:process.argv[index+1];};
const out=option('--out');let fixture=option('--fixture'),temporary;
const extra=process.argv.includes('--extra'),fixtureProfile=extra?['--extra']:[],planes=extra?9:2;
const rom=new Uint8Array(await fs.readFile(path.join(root,'web/tetorica_ym2608_adpcm_rom.bin')));
const wasmBinary=await fs.readFile(path.join(root,'docs/generated/ym2608_wasm.wasm'));
const module=await factory({wasmBinary});
let Processor,resolveReady,rejectReady;
if(extra){
  globalThis.sampleRate=48000;globalThis.currentFrame=0;
  globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(data){if(data.ready)resolveReady();if(data.error)rejectReady(Error(data.error));},close(){}};}};
  globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-ym2608')Processor=processor;};
  await import('../docs/js/playground_ym2608_worklet.js');
}
const rates=[44100,48000,96000],scenarios=[];
const preset={algorithm:7,feedback:0,pan:{left:true,right:true},operators:Array.from({length:4},(_,i)=>({multi:i+1,tl:36+i*4,ar:31,d1r:0,d2r:0,sl:0,rr:15}))};
const encoded=encodeAdpcmB({channels:[Float32Array.from({length:2048},(_,i)=>Math.sin(i*Math.PI*2/41)*.6)],sampleRate:16000},16000,0x200000).bytes;
function scenario(name,build,{frames=6144,checks={}}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
  const synth=new YM2608Synth({transport:{write:(port,reg,value)=>add('write',port,reg,value),reset:()=>add('reset'),
    loadRhythmRom:bytes=>add('rom',0,bytes.slice()),loadAdpcmMemory:(bytes,offset)=>add('memory',offset,bytes.slice())}});
  build({synth,add,at:value=>{frame=value;}});scenarios.push({name,frames,events,checks});
}
const fm=(synth,ch=0,note=69)=>{synth.setPreset(ch,preset);synth.noteOn(ch,note);};
function rhythm(synth){synth.rhythm.loadRom(rom);synth.rhythm.setVolume(52);for(let ch=0;ch<6;ch++)synth.rhythm.setVoice(ch,{volume:27-ch,left:true,right:true});synth.rhythm.keyOn([0,1,2,3,4,5]);}
function adpcm(synth,address=0){synth.adpcm.loadMemory(encoded,address);synth.adpcm.setSample({start:address,end:address+encoded.length});synth.adpcm.setPlaybackRate(16000);synth.adpcm.setVolume(180);synth.adpcm.setPan(true,true);synth.adpcm.keyOn({repeat:true});}
scenario('six FM voices, stereo gates, independent frequencies, LFO and key gates',({synth,at})=>{
  for(let ch=0;ch<6;ch++){fm(synth,ch,48+ch*5);synth.setPan(ch,ch<4,ch>=2);}
  at(701);synth.setLfo(true,4);synth.setModulation(2,2,5);at(1703);synth.keyOff(1);synth.keyOff(4);
  at(2501);synth.noteOn(1,77);at(4003);for(let ch=0;ch<6;ch++)synth.keyOff(ch);
});
scenario('FM special CH3 frequencies and prescaler changes',({synth,at})=>{
  fm(synth,2,60);synth.write(0,0x27,0x40);
  for(let ch=0;ch<3;ch++){synth.write(0,0xac+ch,0x21+ch);synth.write(0,0xa8+ch,0x37+ch*41);}
  at(701);synth.write(0,0x2e,0);at(1703);synth.write(0,0x2f,0);at(2901);synth.write(0,0x2d,0);at(4301);synth.write(0,0x27,0);
});
scenario('three SSG tones, noise, all shared envelope shapes and targeted key-off',({synth,at,add})=>{
  synth.ssg.tone(0,{frequency:440,volume:11});synth.ssg.tone(1,{frequency:659,volume:9});synth.ssg.noise(2,{period:7,volume:10,envelope:true});
  for(let shape=0;shape<16;shape++){at(shape*307+1);synth.ssg.setEnvelope({period:17+shape*7,shape});}
  at(5101);add('off',6);at(5401);synth.ssg.noteOn(0,72);at(5701);add('off',8);
});
scenario('all six fixed rhythm voices, ROM reload, retrigger, pan and hardware levels',({synth,at,add})=>{
  rhythm(synth);at(701);synth.rhythm.setVoice(0,{left:false,right:true});synth.rhythm.keyOn(0);
  at(1703);synth.rhythm.setVolume(36);synth.rhythm.keyOff([2,3]);at(2801);synth.rhythm.keyOn([1,4,5]);
  at(3901);add('rom',0,new Uint8Array(rom.length));synth.rhythm.keyOn([0,1]);at(4601);synth.rhythm.loadRom(rom);synth.rhythm.keyOn([0,1]);
});
scenario('ADPCM-B encoded sample, repeat, Delta-N, stereo gates, volume and retrigger',({synth,at,add})=>{
  adpcm(synth);at(701);synth.adpcm.setPlaybackRate(22050);synth.adpcm.setPan(true,false);
  at(1703);synth.adpcm.setVolume(73);at(2501);add('off',15);at(2901);synth.adpcm.setPan(false,true);synth.adpcm.keyOn();
  at(4201);synth.adpcm.setDeltaN(65535);at(4701);synth.adpcm.keyOff();
});
scenario('ADPCM-B final RAM range and in-flight memory replacement/clear',({synth,at,add})=>{
  const address=0x200000-encoded.length;adpcm(synth,address);
  at(701);add('memory',address,encoded.map(value=>value^0x88));at(2501);add('clear');at(3501);synth.adpcm.loadMemory(encoded,address);synth.adpcm.keyOn({repeat:true});
});
scenario('all sections together and every source mute combination preserve running phase',({synth,at,add})=>{
  fm(synth);synth.ssg.tone(0,{frequency:330,volume:12});rhythm(synth);adpcm(synth);
  for(let mask=0;mask<8;mask++){at(mask*601+1);add('mute',mask);if(mask%2===0)synth.rhythm.keyOn([0,1,4]);}
  at(5101);add('mute',0);
});
scenario('clock edits use exact integer sample-rate accumulation including upsample holds',({synth,at,add})=>{
  fm(synth);synth.ssg.tone(0,{frequency:330,volume:10});adpcm(synth);
  at(701);add('clock',4000000);at(1403);add('clock',7987200);at(2101);add('clock',10000000);
  at(2803);add('clock',100000);at(3101);add('clock',100000000);at(3401);add('clock',8000000);
});
scenario('reset retains uploaded rhythm/ADPCM memory, edited clock and source mute',({synth,at,add})=>{
  rhythm(synth);adpcm(synth);add('clock',7987200);add('mute',1);
  at(1403);synth.reset();at(1701);synth.rhythm.setVolume(52);synth.rhythm.keyOn([0,1]);
  synth.adpcm.setSample({start:0,end:encoded.length});synth.adpcm.setPlaybackRate(16000);synth.adpcm.setVolume(180);synth.adpcm.setPan(true,true);synth.adpcm.keyOn({repeat:true});
  at(3101);add('mute',0);fm(synth,4,67);
});
// Stop's immediate gate removal, patched-state retention and callback allocation
// behavior are asserted in the C++ self-test. This differential case exercises
// uploaded-memory retention through a quiet Stop and subsequent Web-equivalent
// rhythm/ADPCM programming, without relying on a second host's Stop algorithm.
scenario('Stop retains preloaded ROM/RAM for later rhythm and ADPCM retrigger',({synth,add,at})=>{
  synth.rhythm.loadRom(rom);synth.adpcm.loadMemory(encoded,0);add('stop');
  at(101);synth.rhythm.setVolume(52);synth.rhythm.keyOn([0,1]);
  synth.adpcm.setSample({start:0,end:encoded.length});synth.adpcm.setPlaybackRate(16000);synth.adpcm.setVolume(180);synth.adpcm.setPan(true,true);synth.adpcm.keyOn({repeat:true});
});
if(extra){
  for(let ch=0;ch<6;ch++)for(let algorithm=0;algorithm<8;algorithm++)scenario(`additional FM channel ${ch} algorithm ${algorithm} operator envelopes and masks`,({synth,at})=>{
    synth.setPreset(ch,{...preset,algorithm,feedback:algorithm});synth.noteOn(ch,48+ch*5);
    at(701);synth.setOperator(ch,0,{tl:35,multi:7});at(1703);synth.setOperator(ch,3,{ssg:8+(algorithm%8)});
    at(2801);synth.noteOn(ch,79);at(3901);synth.keyOff(ch);at(5101);synth.noteOn(ch,60);
  });
  for(let shape=0;shape<16;shape++)scenario(`additional SSG envelope shape ${shape} noise and shared retrigger`,({synth,at})=>{
    for(let ch=0;ch<3;ch++)synth.ssg.tone(ch,{frequency:233+ch*157,volume:15,envelope:true});
    synth.ssg.setEnvelope({period:23,shape});synth.ssg.noise(1,{period:7,volume:15,envelope:true});
    at(1703);synth.ssg.setEnvelope({period:53,shape});at(3301);synth.ssg.setEnvelope({period:0,shape:shape^4});at(5101);synth.ssg.setEnvelope({period:11,shape});
  });
  for(const mode of[5,10,15,0x45,0x85,0xcf])scenario(`additional timers/status/IRQ and CH3 mode ${mode}`,({synth,at})=>{
    fm(synth,2,60);synth.write(0,0x24,255);synth.write(0,0x25,3);synth.write(0,0x26,253);synth.write(0,0x27,mode);
    at(701);synth.write(0,0x27,0x30);at(1703);synth.write(0,0x27,mode);at(2801);synth.write(1,0x10,0x80);at(3901);synth.write(0,0x24,249);at(5101);synth.write(0,0x27,0);
  });
  scenario('additional reset preserves fractional output remainder and held stereo at 100 kHz',({synth,at,add})=>{
    fm(synth);synth.ssg.tone(1,{frequency:330,volume:13});add('clock',100000);
    at(701);add('reset');at(702);synth.ssg.tone(2,{frequency:440,volume:15});at(1703);add('reset');at(2801);synth.write(0,0x2f,0);fm(synth,5,72);
    at(3901);add('reset');at(5101);add('clock',8000000);fm(synth,3,60);
  });
  for(const address of[0,0x200000-encoded.length]){
    scenario(`additional timeline exact 44100-Hz boundaries and immutable ADPCM transfers at ${address}`,({synth,at,add})=>{
      fm(synth,3,60);rhythm(synth);adpcm(synth,address);
      at(1);synth.ssg.tone(1,{frequency:330,volume:13});at(147);synth.rhythm.keyOn([0,2,5]);
      at(511);add('memory',address,encoded.map(value=>value^0x88));at(901);synth.adpcm.setPan(false,true);
      at(1301);add('memory',address,encoded);at(1703);synth.noteOn(3,72);at(2207);synth.write(0,0x2e,0);
      at(3301);synth.adpcm.setPlaybackRate(22050);at(3901);synth.rhythm.keyOff([0,2]);
    },{frames:12288});scenarios.at(-1).timeline=4410;
  }
  scenario('additional CPU ADPCM RAM upload and raw data-port dummy/download reads',({synth,at})=>{
    fm(synth);synth.write(1,1,2);synth.write(1,2,0x10);synth.write(1,3,0);synth.write(1,4,0x11);synth.write(1,5,0);synth.write(1,0,0x60);
    for(let n=0;n<64;n++)synth.write(1,8,(n*7)&255);
    at(701);synth.write(1,0,0x20);synth.write(1,8,0);at(1703);synth.write(1,0,1);at(2801);synth.write(0,7,0xf8);synth.write(0,14,0xaa);
    at(3901);synth.write(0,7,0x38);synth.write(0,15,0x55);at(5101);synth.write(1,0x10,0);
  });
}
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:extra?'Actual deployed additional playground_ym2608_worklet.js and YM2608 WASM, with status/IRQ/four raw ports':'Actual deployed YM2608 WASM plus Ym2608AudioEngine',
  wasmSha256:createHash('sha256').update(wasmBinary).digest('hex'),rhythmRomSha256:createHash('sha256').update(rom).digest('hex'),
  rates,cases:[],maximumDifference:0,totalStereoFrames:0,
  limits:'Offline core/output-rate comparison; Native bus scheduling, ownership, cancellation and UI/Keyboard IPC are validated separately. Stop gating/retained controls and zero callback allocations are covered by the fixture self-test.'};
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-ym2608-'));fixture=path.join(temporary,'fixture');
    execFileSync('clang++',['-std=c++14','-O2','-I'+path.join(project,'native-genesis'),
      path.join(project,'src/native_genesis_ym2608.cpp'),path.join(project,'src/native_genesis_ym2608_fixture.cpp'),
      path.join(project,'src/native_genesis_ymfm_opn.cpp'),
      ...['ymfm_ssg.cpp','ymfm_adpcm.cpp'].map(name=>path.join(project,'native-genesis',name)),'-o',fixture],{stdio:'pipe'});}
  report.selfTest=execFileSync(fixture,[...fixtureProfile,'--self-test'],{encoding:'utf8'}).trim();
  for(const rate of rates)for(const scenario of scenarios){
    const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    const nativeEvents=scenario.timeline?[{frame:0,op:'rom',args:[0,rom]},{frame:0,op:'reset',args:[]},...events.filter(e=>e.op!=='rom'&&e.op!=='reset').map(e=>({...e,frame:Math.ceil(e.frame*rate/44100)}))]:events;
    const input=nativeEvents.map(({frame,op,args})=>`${frame} ${op}${args.length?' '+(['rom','memory'].includes(op)?args[0]+' '+Buffer.from(args[1]).toString('hex'):args.join(' ')):''}`).join('\n')+'\n';
    const bytes=execFileSync(fixture,[...fixtureProfile,String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*planes*4+1048576,timeout:30000});
    assert.equal(bytes.length,scenario.frames*planes*4);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
    let reference,engine;
    if(extra){globalThis.sampleRate=rate;const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});reference=new Processor({processorOptions:{wasmBinary,rom}});await ready;engine=reference.engine;}
    else engine=await Ym2608AudioEngine.create({ym2608ModuleFactory:async()=>module,outputSampleRate:rate});
    if(scenario.timeline){
      const blocks=[],timelineEvents=[];
      for(const {frame,op,args}of events){
        if(op==='write')timelineEvents.push([frame,...args]);
        else if(op==='memory'){const n=blocks.push(args[1].slice())-1;timelineEvents.push([frame,2,n,args[0]]);}
        else assert(['reset','rom'].includes(op),'Unexpected timeline command '+op);
      }
      reference.apply({method:'prepareTimeline',args:[timelineEvents,blocks,scenario.timeline]},reference.port);
      // Worklet prepares its own event/block copies; mutate caller buffers to
      // verify later transfers do not reference mutable producer data.
      for(const block of blocks)block.fill(0x55);
      reference.apply({method:'playTimeline',id:71},reference.port);
    }
    let next=0,maximumDifference=0,peak=0,first;
    const left=new Float32Array(1),right=new Float32Array(1);
    const off=voice=>{if(voice<6)engine.writeYm2608(0,0x28,voice<3?voice:voice+1);else if(voice<9)engine.writeYm2608(0,8+voice-6,0);else if(voice<15)engine.writeYm2608(0,0x10,0x80|(1<<(voice-9)));else engine.writeYm2608(1,0,1);};
    try{for(let frame=0;frame<scenario.frames;frame++){
      while(!scenario.timeline&&next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
        if(op==='write') { if(extra)reference.apply({method:'write',args},reference.port);else engine.writeYm2608(...args); }
        else if(op==='rom')engine.loadAdpcmARom(args[1],args[0]);
        else if(op==='memory')engine.loadAdpcmBMemory(args[1],args[0]);
        else if(op==='clear')engine.clearAdpcmBMemory();
        else if(op==='mute'){engine.ym2608.setSourceMuteMask(args[0]);engine._sourceMuteMask=args[0];}
        else if(op==='clock')engine._chipSampleRate=engine.ym2608.sampleRate(args[0]);
        else if(op==='reset'||op==='stop'){if(extra)reference.apply({method:'reset'},reference.port);else {engine.ym2608.reset();engine._resampleRemainder=0;engine._lastLeft=engine._lastRight=0;}}
        else if(op==='off'){off(args[0]);if(extra)engine._lastLeft=engine._lastRight=0;}else throw Error(op);
      }
      if(extra){globalThis.currentFrame=frame;reference.process([],[[left,right]]);}else engine.process(left,right,1);
      const expectedValues=[left[0],right[0]];
      if(extra){expectedValues.push(engine.ym2608.readStatus(),engine.ym2608.readStatusHi(),Number(engine.ym2608.getIrq()));for(let port=0;port<4;port++)expectedValues.push(engine.ym2608.read(port));}
      for(let ch=0;ch<planes;ch++){const expected=expectedValues[ch],value=actual[frame*planes+ch];assert(Number.isFinite(value));const difference=Math.abs(value-expected);
        if(difference&&!first)first={frame,ch,native:value,wasm:expected};maximumDifference=Math.max(maximumDifference,difference);if(ch<2)peak=Math.max(peak,Math.abs(value));}
    }
    if(scenario.timeline)assert.equal(reference.timeline.active,null,'Timeline completes at the exact duration boundary');
    assert(maximumDifference<=1e-7,`${scenario.name} at ${rate}: difference ${maximumDifference}, ${JSON.stringify(first)}`);
    assert(peak>1e-4,scenario.name+' must sound');
    report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference,peak});
    report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
    }finally{if(extra)reference.dispose();else engine.dispose();}
  }
  report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`Native ${extra?'additional ':''}YM2608: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum difference ${report.maximumDifference}`);
  console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
