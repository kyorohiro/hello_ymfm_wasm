/** Standalone additional Native YM2612 versus the deployed additional OPN WASM Worklet. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {opnPitchFromHz} from '../web/soundchip_pitch.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const option=name=>{const found=process.argv.find(value=>value.startsWith(name+'='));if(found)return found.slice(name.length+1);const i=process.argv.indexOf(name);assert(i<0||process.argv[i+1],`${name} needs a value`);return i<0?null:process.argv[i+1];};
const out=option('--out');let fixture=option('--fixture'),temporary;
const binary=await fs.readFile(path.join(root,'docs/generated/ym2612_wasm.wasm'));
let Processor,resolveReady,rejectReady;globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(data){if(data.ready)resolveReady();if(data.error)rejectReady(Error(data.error));},close(){}};}};
globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-opn')Processor=processor;};
await import('../docs/js/playground_opn_worklet.js');
const rates=[44100,48000,96000],scenarios=[],keyCode=ch=>ch<3?ch:ch+1;
function scenario(name,build,{frames=6144}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args}),write=(reg,value,port=0)=>add('write',port,reg,value);
  const pitch=(ch,midi)=>{const p=opnPitchFromHz(440*2**((midi-69)/12),7670454,144);write(0xa4+ch%3,(p.block<<3)|(p.fnum>>8),Math.floor(ch/3));write(0xa0+ch%3,p.fnum&255,Math.floor(ch/3));};
  const fm=(ch=0,midi=69,algorithm=7,feedback=0,key=true)=>{
    const port=Math.floor(ch/3),offset=ch%3;
    for(let op=0;op<4;op++){const o=offset+op*4;write(0x30+o,1+op,port);write(0x40+o,12+op*5,port);write(0x50+o,31,port);write(0x60+o,4,port);write(0x70+o,0,port);write(0x80+o,0x2f,port);write(0x90+o,0,port);}
    write(0xb0+offset,algorithm|(feedback<<3),port);write(0xb4+offset,0xc0,port);pitch(ch,midi);if(key)write(0x28,0xf0|keyCode(ch));
  };
  build({add,write,at:value=>{frame=value;},fm,pitch});scenarios.push({name,frames,events});
}
for(let ch=0;ch<6;ch++)for(let algorithm=0;algorithm<8;algorithm++)scenario(`FM physical channel ${ch}, algorithm ${algorithm}, feedback ${algorithm}`,({fm,write,pitch,at})=>{
  const port=Math.floor(ch/3),offset=ch%3;fm(ch,48+ch*5,algorithm,algorithm);
  at(701);write(0x40+offset,35,port);at(1703);write(0x34+offset,7,port);at(2801);pitch(ch,79);
  at(3901);write(0x28,keyCode(ch));at(5101);write(0x28,0xf0|keyCode(ch));
});
scenario('all six channels, LFO, panning and AM/PM depth',({fm,write,at})=>{
  for(let ch=0;ch<6;ch++)fm(ch,43+ch*7,ch%8,ch%8);write(0x22,15);
  for(let i=0;i<8;i++){at(101+i*701);for(let ch=0;ch<6;ch++){write(0xb4+ch%3,((ch+i)%3+1)<<6|(i<<4)|i,Math.floor(ch/3));for(let op=0;op<4;op++)write(0x60+ch%3+op*4,0x84,Math.floor(ch/3));}}
});
scenario('all operator SSG-EG shapes with key edges',({fm,write,at})=>{
  for(let ch=0;ch<6;ch++)fm(ch,43+ch*7,7,3);
  for(let i=0;i<16;i++){at(i*347);for(let op=0;op<4;op++)write(0x90+op*4+i%3,i,Math.floor((i%6)/3));write(0x28,0xf0|keyCode(i%6));}
});
scenario('operator key masks on both ports, invalid key codes leave six voices intact',({fm,write,at})=>{
  for(let ch=0;ch<6;ch++)fm(ch,43+ch*7,7,0);
  for(let i=0;i<16;i++){at(i*347);write(0x28,(i<<4)|keyCode(i%6));write(0x28,0xf3);write(0x28,0xf7);}
});
scenario('shared cross-port normal/special high frequency latches',({fm,write,at})=>{
  for(let ch=0;ch<6;ch++)fm(ch,43+ch*7,7,3);write(0x27,0x40);
  for(let ch=0;ch<3;ch++){write(0xac+ch,0x20+ch*3);write(0xa8+ch,0x31+ch*71);}
  at(701);write(0xa4,0x21);write(0xa1,0x91,1);at(1703);write(0xa6,0x2a,1);write(0xa0,0x41);
  at(2801);write(0xad,0x29,1);write(0xa8,0x69);at(3901);write(0x27,0);at(5101);write(0x27,0x40);
});
for(const mode of[5,10,15,0x45,0x85])scenario(`timer A/B and CSM status/IRQ mode ${mode}`,({fm,write,at})=>{
  fm(2,60,7,3);write(0x24,255);write(0x25,3);write(0x26,253);write(0x27,mode);
  at(701);write(0x27,0x30);at(1703);write(0x27,mode);at(2801);write(0x27,0x30);
  at(3901);write(0x24,249);write(0x27,mode);at(5101);write(0x27,0);
});
scenario('cold CSM starts after Stop without register-28 key-on',({fm,write,at,add})=>{
  fm(2,60,7,3,false);write(0x24,255);write(0x25,3);write(0x27,0x85);
  at(701);add('stop');at(1703);write(0x27,0x85);at(2801);add('off',2);at(3901);write(0x27,0x85);
  at(5101);add('reset');fm(2,69,7,1,false);write(0x24,255);write(0x25,3);write(0x27,0x85);
});
scenario('raw DAC all 256 codes with FM coexistence and test-bit resolution',({fm,write,at})=>{
  for(let ch=0;ch<6;ch++)fm(ch,43+ch*7,7,1);write(0x2b,0x80);
  for(let i=0;i<256;i++){at(i*23);write(0x2a,i);write(0x2c,i&1?8:0);}
});
scenario('raw DAC channel-6 pan, DAC enable toggles and FM gate',({fm,write,at})=>{
  fm(5,60,7,3);write(0x2a,0xe0);write(0x2b,0x80);
  at(701);write(0xb6,0x80,1);at(1703);write(0xb6,0x40,1);at(2801);write(0xb6,0,1);
  at(3901);write(0x2b,0);at(5101);write(0xb6,0xc0,1);write(0x2b,0x80);write(0x2a,0x20);
});
scenario('master clock range and averaging/holding preserve chip phase',({fm,write,at,add})=>{
  fm(0,69,7,2);fm(4,60,3,5);
  for(const [frame,clock]of[[701,3579545],[1703,100000],[2801,100000000],[3901,3993600],[5101,7670454]]){at(frame);add('clock',clock);}
  at(5751);write(0x28,0);
});
scenario('reset clears output remainder and hold at slow clock, retains raw ymfm DAC latch',({fm,write,at,add})=>{
  fm();add('clock',100000);write(0x2a,255);write(0x2b,128);at(701);add('reset');
  at(1703);write(0xb6,0xc0,1);at(2801);add('reset');at(3901);add('clock',7670454);fm(1,76,7);at(5101);write(0x2b,0);
});
scenario('forced off retains patch TL and delayed masked previews across both ports',({fm,write,at,add})=>{
  fm(0);fm(4,60,7,3);at(701);add('off',0);add('off',4);write(0x4d,19,1);
  at(1703);add('audition',0,5);add('audition',4,10);at(2801);add('off',0);add('off',4);
  at(3901);add('audition',0,10);add('audition',4,5);at(5101);add('audition',4,15);
});
scenario('pending previews at slow clock cancel on off/Stop/reset',({fm,at,add})=>{
  fm(0);fm(5,60,7,3);add('clock',100000);at(701);add('audition',0,15);at(1703);add('audition',5,9);
  at(2801);add('audition',0,15);add('off',0);at(3901);add('audition',5,15);add('stop');
  at(4501);add('audition',5,15);add('reset');at(5101);fm(4,72,7);
});
scenario('Stop clears DAC and timers but retains patch and next FM/DAC restart',({fm,write,at,add})=>{
  fm(2,60,7,3);fm(5,48,7,2);write(0x2a,255);write(0x2b,128);write(0x24,255);write(0x25,3);write(0x27,0x85);
  at(701);add('stop');at(1703);add('audition',2,15);at(2801);add('stop');at(3901);write(0x2b,128);write(0x2a,0x20);
  at(5101);add('stop');
});
scenario('external six-channel mutes preserve patch, phase, timers and raw DAC',({fm,write,at,add})=>{
  for(let ch=0;ch<6;ch++)fm(ch,43+ch*7,ch%8,ch%8);write(0x2a,0xe0);write(0x2b,128);
  for(const [frame,mask]of[[701,9],[1703,32],[2801,63],[3901,0],[5101,21]]){at(frame);add('mute',mask);}
});
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:'Actual deployed additional playground_opn_worklet.js with YM2612 WASM: raw gain 1, no primary Genesis DC subtraction/gain/PSG',
  wasmSha256:createHash('sha256').update(binary).digest('hex'),rates,cases:[],maximumDifference:0,totalStereoFrames:0,
  limits:'Offline independent ymfm YM2612 only. Ownership/IPC/Mixer/UI are tested separately. Cancellation/Stop/preview policy is modeled using real WASM key/TL/pan controls; every output frame compares PCM, status, IRQ and four reads. External mute keeps the real WASM channels advancing with pan bits cleared; its authored pan/TL remain retained. Reset matches the additional Worklet remainder/held clearing and ymfm retained DAC latch. C++ fixture separately checks independent instances, observational snapshots, FFI layout and zero callback allocations/frees. No physical audio device or cross-platform compiler was used.'};
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-ym2612-'));fixture=path.join(temporary,'fixture');
    execFileSync('clang++',['-std=c++14','-O2','-I'+path.join(project,'native-genesis'),...['src/native_genesis_ym2612.cpp','src/native_genesis_ym2612_fixture.cpp','native-genesis/ymfm_opn.cpp','native-genesis/ymfm_ssg.cpp','native-genesis/ymfm_adpcm.cpp'].map(p=>path.join(project,p)),'-o',fixture],{stdio:'pipe'});}
  report.selfTest=execFileSync(fixture,['--self-test'],{encoding:'utf8'}).trim();
  for(const rate of rates)for(const scenario of scenarios){
    globalThis.sampleRate=rate;const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    const input=events.map(({frame,op,args})=>`${frame} ${op} ${args.join(' ')}`).join('\n')+'\n';
    const bytes=execFileSync(fixture,[String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*32+1048576,timeout:30000});
    assert.equal(bytes.length,scenario.frames*32);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
    const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
    const reference=new Processor({processorOptions:{name:'ym2612',wasmBinary:binary}});await ready;
    let forced=0,external=0,stopped=false;const regs=new Uint8Array(512),pending=new Map();
    const raw=(p,r,v)=>reference.apply({method:'write',args:[p,r,v]},reference.port);
    const pan=ch=>{const p=Math.floor(ch/3),r=0xb4+ch%3;raw(p,r,regs[p*256+r]&((forced|external)&(1<<ch)?63:255));};
    const restore=ch=>{if(forced&(1<<ch)){forced&=~(1<<ch);const p=Math.floor(ch/3);for(let op=0;op<4;op++){const r=0x40+ch%3+op*4;raw(p,r,regs[p*256+r]);}pan(ch);}};
    const write=(p,r,v)=>{
      regs[p*256+r]=v;
      if(!p&&r===0x28&&(v&3)<3){const ch=(v&3)+(v&4?3:0);pending.delete(ch);if(v&0xf0){restore(ch);stopped=false;}}
      if(!p&&r===0x27&&(v&0x81)===0x81){restore(2);stopped=false;}
      if(!p&&((r===0x2b&&(v&128))||(r===0x2a&&(regs[0x2b]&128)))){restore(5);stopped=false;}
      const ch=p*3+(r&3);
      if(r>=0x40&&r<=0x4e&&(r&3)<3&&(forced&(1<<ch)))v|=127;
      if(r>=0xb4&&r<=0xb6&&((forced|external)&(1<<ch)))v&=63;
      raw(p,r,v);
    };
    const off=ch=>{pending.delete(ch);regs[0x28]=keyCode(ch);raw(0,0x28,keyCode(ch));forced|=1<<ch;const p=Math.floor(ch/3);for(let op=0;op<4;op++){const r=0x40+ch%3+op*4;raw(p,r,regs[p*256+r]|127);}pan(ch);if(ch===2)write(0,0x27,regs[0x27]&~0x81);if(ch===5)write(0,0x2b,regs[0x2b]&127);reference.left=reference.right=0;};
    const audition=(ch,mask)=>{off(ch);if(mask)pending.set(ch,mask);};
    let next=0,maximumDifference=0,peak=0,first;const l=new Float32Array(1),r=new Float32Array(1);
    try{for(let frame=0;frame<scenario.frames;frame++){
      globalThis.currentFrame=frame;
      while(next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
        if(op==='write')write(...args);else if(op==='clock')reference.apply({method:'clock',args},reference.port);
        else if(op==='off')off(args[0]);else if(op==='audition')audition(...args);
        else if(op==='stop'){for(let ch=0;ch<6;ch++)off(ch);write(0,0x27,regs[0x27]&0xc0);write(0,0x2b,regs[0x2b]&127);pending.clear();stopped=true;reference.left=reference.right=0;}
        else if(op==='reset'){reference.apply({method:'reset'},reference.port);regs.fill(0);forced=0;pending.clear();stopped=false;}
        else if(op==='mute'){external=args[0];for(let ch=0;ch<6;ch++)pan(ch);reference.left=reference.right=0;}
        else throw Error(op);
      }
      const count=Math.floor((reference.remainder+reference.rate)/rate);
      reference.process([],[[l,r]]);if(stopped)l[0]=r[0]=0;
      if(count&&pending.size){const starts=[...pending];pending.clear();for(const [ch,mask]of starts)write(0,0x28,(mask<<4)|keyCode(ch));}
      const expected=[l[0],r[0],reference.chip.readStatus(),Number(reference.chip.getIrq()),...Array.from({length:4},(_,port)=>reference.chip.read(port))];
      for(let ch=0;ch<8;ch++){const value=actual[frame*8+ch];assert(Number.isFinite(value));const difference=Math.abs(value-expected[ch]);
        if(difference&&!first)first={frame,ch,native:value,wasm:expected[ch]};maximumDifference=Math.max(maximumDifference,difference);if(ch<2)peak=Math.max(peak,Math.abs(value));}
    }
    assert(maximumDifference<=1e-7,`${scenario.name} at ${rate}: difference ${maximumDifference}, ${JSON.stringify(first)}`);assert(peak>1e-4,scenario.name+' must sound');
    report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference,peak});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
    }finally{reference.dispose();}
  }
  report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`Native additional YM2612: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames with status/IRQ/read ports, maximum difference ${report.maximumDifference}`);console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
