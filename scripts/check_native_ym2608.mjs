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
const rom=new Uint8Array(await fs.readFile(path.join(root,'web/tetorica_ym2608_adpcm_rom.bin')));
const wasmBinary=await fs.readFile(path.join(root,'docs/generated/ym2608_wasm.wasm'));
const module=await factory({wasmBinary});
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
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:'Actual deployed YM2608 WASM plus Ym2608AudioEngine',
  wasmSha256:createHash('sha256').update(wasmBinary).digest('hex'),rhythmRomSha256:createHash('sha256').update(rom).digest('hex'),
  rates,cases:[],maximumDifference:0,totalStereoFrames:0,
  limits:'Offline core/output-rate comparison; Native bus scheduling, ownership, cancellation and UI/Keyboard IPC are validated separately. Stop gating/retained controls and zero callback allocations are covered by the fixture self-test.'};
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-ym2608-'));fixture=path.join(temporary,'fixture');
    execFileSync('clang++',['-std=c++14','-O2','-I'+path.join(project,'native-genesis'),
      path.join(project,'src/native_genesis_ym2608.cpp'),path.join(project,'src/native_genesis_ym2608_fixture.cpp'),
      ...['ymfm_opn.cpp','ymfm_ssg.cpp','ymfm_adpcm.cpp'].map(name=>path.join(project,'native-genesis',name)),'-o',fixture],{stdio:'pipe'});}
  report.selfTest=execFileSync(fixture,['--self-test'],{encoding:'utf8'}).trim();
  for(const rate of rates)for(const scenario of scenarios){
    const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    const input=events.map(({frame,op,args})=>`${frame} ${op}${args.length?' '+(['rom','memory'].includes(op)?args[0]+' '+Buffer.from(args[1]).toString('hex'):args.join(' ')):''}`).join('\n')+'\n';
    const bytes=execFileSync(fixture,[String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*8+1048576,timeout:30000});
    assert.equal(bytes.length,scenario.frames*8);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
    const engine=await Ym2608AudioEngine.create({ym2608ModuleFactory:async()=>module,outputSampleRate:rate});
    let next=0,maximumDifference=0,peak=0,first;
    const left=new Float32Array(1),right=new Float32Array(1);
    const off=voice=>{if(voice<6)engine.writeYm2608(0,0x28,voice<3?voice:voice+1);else if(voice<9)engine.writeYm2608(0,8+voice-6,0);else if(voice<15)engine.writeYm2608(0,0x10,0x80|(1<<(voice-9)));else engine.writeYm2608(1,0,1);};
    try{for(let frame=0;frame<scenario.frames;frame++){
      while(next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
        if(op==='write')engine.writeYm2608(...args);
        else if(op==='rom')engine.loadAdpcmARom(args[1],args[0]);
        else if(op==='memory')engine.loadAdpcmBMemory(args[1],args[0]);
        else if(op==='clear')engine.clearAdpcmBMemory();
        else if(op==='mute'){engine.ym2608.setSourceMuteMask(args[0]);engine._sourceMuteMask=args[0];}
        else if(op==='clock')engine._chipSampleRate=engine.ym2608.sampleRate(args[0]);
        else if(op==='reset'||op==='stop'){engine.ym2608.reset();engine._resampleRemainder=0;engine._lastLeft=engine._lastRight=0;}
        else if(op==='off')off(args[0]);else throw Error(op);
      }
      engine.process(left,right,1);
      for(let ch=0;ch<2;ch++){const expected=ch?right[0]:left[0],value=actual[frame*2+ch];assert(Number.isFinite(value));const difference=Math.abs(value-expected);
        if(difference&&!first)first={frame,ch,native:value,wasm:expected};maximumDifference=Math.max(maximumDifference,difference);peak=Math.max(peak,Math.abs(value));}
    }
    assert(maximumDifference<=1e-7,`${scenario.name} at ${rate}: difference ${maximumDifference}, ${JSON.stringify(first)}`);
    assert(peak>1e-4,scenario.name+' must sound');
    report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference,peak});
    report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
    }finally{engine.dispose();}
  }
  report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`Native YM2608: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum difference ${report.maximumDifference}`);
  console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
