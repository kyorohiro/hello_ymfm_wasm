/** Standalone Native OPM versus the actual deployed additional Worklet. No device. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {YM2151Synth} from '../web/ym2151synth.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const option=name=>{const i=process.argv.indexOf(name);assert(i<0||process.argv[i+1],`${name} needs a value`);return i<0?null:process.argv[i+1];};
const out=option('--out');let fixture=option('--fixture'),temporary;
const binary=await fs.readFile(path.join(root,'docs/generated/ym2151_wasm.wasm'));
let Processor,resolveReady,rejectReady;globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(data){if(data.ready)resolveReady();if(data.error)rejectReady(Error(data.error));},close(){}};}};
globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-ym2151')Processor=processor;};
await import('../docs/js/playground_ym2151_worklet.js');
const rates=[44100,48000,96000],scenarios=[];
const preset={algorithm:7,feedback:0,pan:{left:true,right:true},ams:0,pms:0,operators:Array.from({length:4},(_,op)=>({multi:op+1,tl:24+op*5,ar:31,am:false,d1r:4,dt2:0,d2r:0,sl:2,rr:15}))};
function scenario(name,build,{frames=6144,cold=false}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
  const synth=new YM2151Synth({clock:3579545,transport:{writeRegister:(reg,value)=>add('write',reg,value),reset:()=>add('reset')}});
  if(cold)events.length=0;
  const voice=(ch=0,note=69,algorithm=7,feedback=0,key=true)=>{synth.setPreset(ch,{...preset,algorithm,feedback});synth.setNote(ch,note);if(key)synth.keyOn(ch);};
  build({synth,voice,add,write:(r,v)=>add('write',r,v),at:value=>{frame=value;}});scenarios.push({name,frames,events});
}
for(let ch=0;ch<8;ch++)for(let algorithm=0;algorithm<8;algorithm++)scenario(`physical FM${ch} algorithm${algorithm}, four operator register slots`,({synth,voice,at})=>{
  voice(ch,48+ch*4,algorithm,algorithm);at(701);synth.setOperator(ch,1,{dt1:6,dt2:3,multi:7});at(1703);synth.setOperator(ch,2,{tl:31,ar:23});
  at(2801);synth.setPitch(ch,0x35+ch*3,7+ch*7);at(3901);synth.keyOff(ch);at(5101);synth.keyOn(ch);
});
scenario('eight channels independent stereo gates and all logical operator key masks',({synth,voice,at})=>{
  for(let ch=0;ch<8;ch++){voice(ch,48+ch*4,7,ch%8);synth.setPan(ch,ch<5,ch>=3);}
  for(let mask=0;mask<16;mask++){at(mask*347);synth.keyOn(mask%8,mask);}
});
for(let waveform=0;waveform<4;waveform++)scenario(`shared LFO waveform${waveform} independent AMD/PMD and sensitivity`,({synth,voice,at})=>{
  for(const ch of[0,3,7]){voice(ch,48+ch*4,5,5);synth.setPreset(ch,{ams:3,pms:7,operators:Array.from({length:4},()=>({am:true}))});}
  synth.setLFO({frequency:237,amDepth:67,pmDepth:93,waveform});at(701);synth.setLFO({amDepth:13});at(1703);synth.setLFO({pmDepth:27});
  at(2801);synth.setLFO({frequency:255});at(3901);synth.setLFO({amDepth:127,pmDepth:127});at(5101);synth.setLFO({frequency:7});
});
scenario('channel eight noise all32frequencies preserves other operators',({synth,voice,at})=>{
  voice(0,60);voice(7,67,7,5);for(let n=0;n<32;n++){at(n*173);synth.setNoise(true,n);}at(5701);synth.setNoise(false);
});
for(const mode of[5,10,15,0x85,0x8f])scenario(`timer A/B mode${mode} statusIRQ and raw mode clearing`,({voice,write,at})=>{
  voice(2,60);write(0x10,255);write(0x11,3);write(0x12,253);write(0x14,mode);at(701);write(0x14,0x30);
  at(1703);write(0x14,mode);at(2801);write(0x10,249);at(3901);write(0x14,0x30);at(5101);write(0x14,mode);
});
scenario('cold constructor CSM triggers all8 without any normal key-on',({voice,write,at})=>{
  for(let ch=0;ch<8;ch++)voice(ch,48+ch*4,7,ch%8,false);write(0x10,255);write(0x11,3);write(0x14,0x85);
  at(701);write(0x10,249);at(1703);write(0x14,0x95);at(2801);write(0x14,0);at(3901);write(0x14,0x85);
},{cold:true});
scenario('reset CSM-only retains Worklet silent gate until ordinary key-on',({voice,synth,write,at,add})=>{
  voice(0,60);at(701);add('reset');voice(0,60,7,3,false);write(0x10,255);write(0x11,3);write(0x14,0x85);
  at(1703);write(0x10,249);at(2801);write(0x14,0x95);at(3901);synth.keyOn(0);at(5101);write(0x14,0x30);
});
for(const mode of[5,15,0x85,0x8f])scenario(`public allNotesOff retains timer/CSMmode${mode} and normal-key resume`,({voice,synth,write,at,add})=>{
  for(let ch=0;ch<8;ch++)voice(ch,48+ch*4,7,ch%8,!(mode&128));write(0x10,255);write(0x11,3);write(0x12,253);write(0x14,mode);
  at(701);add('all-off');at(1703);synth.keyOn(0);at(2801);add('all-off');at(3901);synth.keyOn(7);at(5101);synth.keyOn(3);
},{cold:true});
scenario('reset recreates random LFO noise and envelope phase at later offsets',({voice,synth,at,add})=>{
  voice(7,67);synth.setNoise(true,17);synth.setLFO({frequency:237,amDepth:67,pmDepth:93,waveform:3});
  for(const frame of[701,1703,2801,3901]){at(frame);add('reset');voice(7,67);synth.setNoise(true,17);synth.setLFO({frequency:237,amDepth:67,pmDepth:93,waveform:3});}
});
scenario('clock accumulation full bounds and upsample holds with reset',({voice,synth,at,add})=>{
  voice(0,60);voice(7,67);synth.setNoise(true,17);
  for(const [frame,clock]of[[701,100000],[1703,100000000],[2801,4000000],[3901,3579545],[5101,100000]]){at(frame);add('clock',clock);}
  at(5501);add('reset');voice(2,72);
});
scenario('percussive audition waits one ordinary source interval with no hidden render',({voice,synth,at,add})=>{
  for(const ch of[0,7]){voice(ch,60+ch);for(let op=0;op<4;op++)synth.setOperator(ch,op,{d1r:31,d2r:31,sl:15,rr:15});}
  for(const frame of[701,1703,2801,3901,5101]){at(frame);add('audition',0,15);add('audition',7,5);}
});
const report={schemaVersion:1,deviceOpened:false,reference:'Actual deployed playground_ym2151_worklet.js and YM2151 WASM at default3579545Hz',
  wasmSha256:createHash('sha256').update(binary).digest('hex'),rates,cases:[],totalStereoFrames:0,maximumDifference:0,
  limits:'Offline standalone OPM only; no OKI/PCM banks. PCM plus status/IRQ/read ports,8normal keymasks,independent AMD/PMD compare. Control-captured power-on state is restored without callback allocation. Strong cancellation/cache isolation and independent globalCSM helpers are validated in the C++ self-test. Native Stop additionally closes timers/globalCSM to prevent owned-source resurrection; Browser Stop only forces TL and host silence. Public allNotesOff retains timers/globalCSM and normal-key resume exactly like Browser. Raw Browser write/reset/CSM silent-gate behavior remains unchanged. No audio device or deadline guarantee.'};
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-ym2151-'));fixture=path.join(temporary,'fixture');
    execFileSync('clang++',['-std=c++14','-O2',...['native-genesis','native-x68000/snapshot/src'].map(p=>'-I'+path.join(project,p)),
      ...['src/native_genesis_ym2151.cpp','src/native_genesis_ym2151_fixture.cpp','native-x68000/snapshot/src/ymfm_opm.cpp'].map(p=>path.join(project,p)),'-o',fixture],{stdio:'pipe'});}
  report.selfTest=execFileSync(fixture,['--self-test'],{encoding:'utf8'}).trim();
  for(const rate of rates)for(const scenario of scenarios){
    const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame),input=events.map(({frame,op,args})=>`${frame} ${op} ${args.join(' ')}`).join('\n')+'\n';
    const bytes=execFileSync(fixture,[String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*64+1048576,timeout:30000});assert.equal(bytes.length,scenario.frames*64);
    const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
    globalThis.sampleRate=rate;const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});const reference=new Processor({processorOptions:{wasmBinary:binary}});await ready;
    let next=0,max=0,peak=0,first;const l=new Float32Array(1),r=new Float32Array(1);
    try{for(let frame=0;frame<scenario.frames;frame++){
      globalThis.currentFrame=frame;
      while(next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
        if(op==='write')reference.apply({method:'writeRegister',args},reference.port);
        else if(op==='clock'||op==='reset')reference.apply({method:op,args},reference.port);
        else if(op==='all-off')reference.apply({method:'allNotesOff'},reference.port);
        else if(op==='audition'){
          const ch=args[0],id='fixture'+ch,owner='voice-editor:'+id;reference.inspector.auditions.set(ch,id);reference.performance.beginAudition(ch,owner);
          reference.apply({method:'forceKeyOff',args:[ch]},reference.port);reference.apply({method:'auditionKeyOn',args},reference.port,frame,{owner});
        }else throw Error(op);
      }
      reference.process([],[[l,r]]);
      const chip=reference.chip,inspector=reference.inspector,expected=[l[0],r[0],chip.readStatus(),Number(chip.getIrq()),chip.read(0),chip.read(1),...inspector.keyMasks,inspector.amDepth,inspector.pmDepth];
      for(let ch=0;ch<16;ch++){const value=actual[frame*16+ch];assert(Number.isFinite(value));const diff=Math.abs(value-expected[ch]);if(diff&&!first)first={frame,ch,native:value,wasm:expected[ch]};max=Math.max(max,diff);if(ch<2)peak=Math.max(peak,Math.abs(value));}
    }
    assert(max<=1e-7,`${scenario.name} at${rate}: difference${max}, ${JSON.stringify(first)}`);assert(peak>1e-4,scenario.name+' must sound');
    report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference:max,peak});report.totalStereoFrames+=scenario.frames;report.maximumDifference=Math.max(report.maximumDifference,max);
    }finally{reference.dispose();}
  }
  report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(`Native additionalYM2151:${report.cases.length} cases,${report.totalStereoFrames} stereo frames,maxdiff${report.maximumDifference}`);console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
