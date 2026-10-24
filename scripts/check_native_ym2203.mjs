/** Selected Native PC-98 YM2203 versus actual primary Browser WASM Worklet. */
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
const option=name=>{const value=process.argv.find(arg=>arg.startsWith(name+'='));if(value)return value.slice(name.length+1);const i=process.argv.indexOf(name);assert(i<0||process.argv[i+1],`${name} needs a value`);return i<0?null:process.argv[i+1];};
const out=option('--out');let fixture=option('--fixture'),temporary;
const extra=process.argv.includes('--extra'),fixtureProfile=extra?['--extra']:[];
const binary=await fs.readFile(path.join(root,'docs/generated/ym2203_wasm.wasm'));
let Processor,resolveReady,rejectReady;globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(data){if(data.type==='error')throw Error(data.message);if(extra&&data.ready)resolveReady();if(extra&&data.error)rejectReady(Error(data.error));},close(){}};}};
globalThis.registerProcessor=(name,processor)=>{if(name===(extra?'tetorica-opn':'ym2203-processor'))Processor=processor;};
await import(extra?'../docs/js/playground_opn_worklet.js':'../docs/js/ym2203-worklet.js');
const rates=[44100,48000,96000],scenarios=[];
function scenario(name,build,{frames=6144}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args}),write=(r,v)=>add('write',r,v);
  const pitch=(ch,midi)=>{const p=opnPitchFromHz(440*2**((midi-69)/12),4000000,72);write(0xa4+ch,(p.block<<3)|(p.fnum>>8));write(0xa0+ch,p.fnum&255);};
  const fm=(ch=0,midi=69,algorithm=7,feedback=0,key=true)=>{
    for(let op=0;op<4;op++){const o=ch+op*4;write(0x30+o,1+op);write(0x40+o,12+op*5);write(0x50+o,31);write(0x60+o,4);write(0x70+o,0);write(0x80+o,0x2f);write(0x90+o,0);}
    write(0xb0+ch,algorithm|(feedback<<3));pitch(ch,midi);if(key)write(0x28,0xf0|ch);
  };
  const ssg=(ch=0,period=127,level=11)=>{write(ch*2,period&255);write(ch*2+1,period>>8);write(8+ch,level);};
  build({add,write,at:value=>{frame=value;},fm,pitch,ssg});scenarios.push({name,frames,events});
}
for(let ch=0;ch<3;ch++)for(let algorithm=0;algorithm<8;algorithm++)scenario(`FM channel ${ch}, four operators and algorithm ${algorithm}`,({fm,write,pitch,at})=>{
  fm(ch,57+ch*7,algorithm,algorithm);at(701);write(0x40+ch,35);at(1703);write(0x34+ch,7);at(2801);pitch(ch,79);
  at(3901);write(0x28,ch);at(5101);write(0x28,0xf0|ch);
});
scenario('FM three channels and all operator SSG-EG modes with ordinary release',({fm,write,at})=>{
  for(let ch=0;ch<3;ch++)fm(ch,48+ch*7,7,5);
  for(let i=0;i<8;i++){at(101+i*701);for(let op=0;op<4;op++)write(0x90+op*4+(i%3),8+i);}
});
scenario('FM operator key masks and independent physical key gates',({fm,write,at})=>{
  for(let ch=0;ch<3;ch++)fm(ch,48+ch*7,7,0);
  for(let i=0;i<16;i++){at(i*347);write(0x28,(i<<4)|(i%3));}
});
scenario('FM frequency high-byte shared latch and channel-3 supplementary pitches',({fm,write,at})=>{
  for(let ch=0;ch<3;ch++)fm(ch,48+ch*7,7,3);write(0x27,0x40);
  for(let ch=0;ch<3;ch++){write(0xac+ch,0x20+ch*3);write(0xa8+ch,0x31+ch*71);}
  at(701);write(0xa4,0x21);write(0xa1,0x91);at(1703);write(0xa6,0x2a);write(0xa0,0x41);
  at(2801);write(0xad,0x29);write(0xa8,0x69);at(3901);write(0x27,0);at(5101);write(0x27,0x40);
});
scenario('FM channel-3 CSM timer mode status IRQ and ordinary pitch coexist',({fm,write,at})=>{
  fm(2,60,7,3);write(0x24,0xff);write(0x25,3);write(0x27,0x85);
  at(701);write(0x24,0xf1);at(1703);write(0x27,0x95);at(2801);write(0x27,0x40);
  at(3901);write(0x27,0x85);at(5101);write(0x27,0x30);
});
scenario('cold channel-3 CSM starts without register-28 key-on and resumes after Stop',({fm,write,at,add})=>{
  fm(2,60,7,3,false);write(0x24,255);write(0x25,3);write(0x27,0x85);
  at(701);add('stop');at(1703);write(0x27,0x85);at(2801);add('off',2);at(3901);write(0x27,0x85);
  at(5101);add('reset');fm(2,69,7,1,false);write(0x24,255);write(0x25,3);write(0x27,0x85);
});
scenario('SSG three tone voices zero/one period and coarse register masks',({ssg,write,at})=>{
  write(7,0x38);ssg(0,127,13);ssg(1,233,11);ssg(2,391,9);
  at(701);write(0,0);write(1,0xf0);at(1703);write(2,1);write(3,0);at(2801);write(4,255);write(5,15);
  at(3901);write(8,3);at(5101);write(10,15);
});
scenario('SSG shared noise all periods and per-channel tone/noise gates',({ssg,write,at})=>{
  for(let ch=0;ch<3;ch++)ssg(ch,127+ch*103,15-ch*2);
  for(let i=0;i<32;i++){at(i*173);write(6,i);write(7,(i&7)|((i&7)<<3)^0x15);}
});
for(let shape=0;shape<16;shape++)scenario(`SSG shared envelope shape ${shape}, three voices and repeated-shape retrigger`,({ssg,write,at})=>{
  write(7,0x38);for(let ch=0;ch<3;ch++)ssg(ch,127+ch*103,16);
  write(11,23);write(12,0);write(13,shape);at(1703);write(11,53);at(3301);write(13,shape);at(5101);write(11,0);write(13,shape^4);
});
scenario('mixed FM and SSG mono summation clips before resampling with source gain intact',({fm,ssg,write,at})=>{
  for(let ch=0;ch<3;ch++){fm(ch,48+ch*7,7);for(let op=0;op<4;op++)write(0x40+ch+op*4,0);ssg(ch,1+ch,15);}
  write(7,0);write(6,1);at(1703);write(7,0x38);at(2801);write(6,31);at(3901);write(7,0);at(5101);write(13,14);
});
scenario('prescaler 6/3/2 address commands change FM and SSG divisors without output-rate changes',({fm,ssg,write,at})=>{
  for(let ch=0;ch<3;ch++){fm(ch,48+ch*7,7);ssg(ch,127+ch*103,11);}write(7,0x38);
  for(const [frame,reg]of[[701,0x2e],[1703,0x2f],[2801,0x2e],[3901,0x2d],[5101,0x2e]]){at(frame);write(reg,0);}
});
scenario('master clock edits preserve source phase and average/hold across FM and SSG',({fm,ssg,write,at,add})=>{
  fm();ssg();write(7,0x38);
  for(const [frame,clock]of[[701,3579545],[1703,100000],[2801,12000000],[3901,3993600],[5101,4000000]]){at(frame);add('clock',clock);}
});
scenario('FM force off retains all authored operator TL and masked delayed audition',({fm,ssg,write,at,add})=>{
  fm();ssg(1,233,9);write(7,0x38);at(701);add('off',0);write(0x4c,19);at(1703);add('audition-mask',0,5);
  at(2801);add('off',0);at(3901);add('audition-mask',0,10);at(5101);add('audition',0);
});
scenario('deferred preview waits for real FM intervals at slow clock and all prescalers',({fm,write,at,add})=>{
  fm();add('clock',100000);at(701);add('audition',0);at(1703);write(0x2e,0);add('audition-mask',0,9);
  at(2801);write(0x2f,0);add('audition',0);at(3901);add('audition',0);add('off',0);
  at(4501);add('audition',0);add('stop');at(5101);add('audition',0);add('reset');at(5501);fm(1,72,7);
});
scenario('SSG Stop retains authored fixed/envelope levels including explicit retained zero',({ssg,write,at,add})=>{
  write(7,0);write(6,11);write(11,31);write(13,10);ssg(0,127,13);ssg(1,233,16);ssg(2,391,9);
  at(701);add('stop');at(1703);add('audition',3);add('audition',4);at(2801);add('off',3);add('level',0,0);add('audition',3);
  at(3901);add('stop');at(5101);add('level',0,11);add('audition',3);
});
scenario('Stop retains prescaler channel3 special frequencies shared noise/envelope and clock',({fm,ssg,write,at,add})=>{
  fm(2,60,7);write(0x27,0x40);write(0xac,0x24);write(0xa8,0x69);ssg(0,127,11);write(7,0);write(6,13);write(11,31);write(13,10);write(0x2e,0);
  at(701);add('clock',100000);at(1703);add('stop');at(2801);add('audition',2);add('audition',3);
  at(3901);add('stop');at(5101);add('clock',4000000);add('audition',2);add('audition',3);
});
scenario('independent FM physical masks and FM/SSG source mutes preserve source phase',({fm,ssg,write,at,add})=>{
  for(let ch=0;ch<3;ch++){fm(ch,48+ch*7,7);ssg(ch,127+ch*103,11);}write(7,0x38);
  for(const [frame,source,mask]of[[701,1,1],[1703,2,0],[2801,3,7],[3901,0,0],[5101,1,2]]){at(frame);add('source',source);add('mute',mask);}
});
scenario('reset follows primary Worklet held phase and subsequent FM/SSG setup',({fm,ssg,write,at,add})=>{
  fm();ssg();write(7,0x38);at(701);add('clock',100000);at(1703);add('reset');at(2801);fm(1,76,7);ssg(2,233,13);write(7,0x38);
  at(3901);add('reset');at(5101);add('clock',4000000);fm(2,60,7);ssg(0,127,11);write(7,0x38);
});
for(const mode of[5,10,15,0x45,0x85])scenario(`timer A/B start and IRQ mode ${mode} with flags cleared during audio`,({fm,write,at})=>{
  fm();write(0x24,255);write(0x25,3);write(0x26,253);write(0x27,mode);
  at(701);write(0x27,0x30);at(1703);write(0x27,mode);at(2801);write(0x27,0x30);at(3901);write(0x24,249);write(0x27,mode);at(5101);write(0x27,0);
});
scenario('SSG raw input/output direction and coarse bits match data read ports without side effects',({fm,ssg,write,at})=>{
  fm();ssg();write(7,0xf8);write(14,0xaa);write(15,0x55);at(701);write(7,0x38);write(14,0x55);
  at(1703);write(15,0xaa);at(2801);write(7,0xf8);write(14,0x33);at(3901);write(15,0xcc);at(5101);write(1,0xf1);
});
if(extra){
  scenario('additional reset clears held mono PCM and fractional remainder at 100 kHz without resetting source phase',({fm,ssg,write,at,add})=>{
    fm();ssg();write(7,0x38);add('clock',100000);at(701);add('reset');at(702);ssg(1,127,15);write(7,0x38);
    at(1703);add('reset');at(2801);write(0x2f,0);fm(2,72,7);at(3901);add('reset');at(5101);ssg(2,233,11);write(7,0x38);
  });
  scenario('additional full clock bounds and mixed FM/SSG mono rendering',({fm,ssg,write,at,add})=>{
    for(let ch=0;ch<3;ch++){fm(ch,48+ch*7,7);ssg(ch,127+ch*103,11);}write(7,0x38);
    at(701);add('clock',100000);at(1703);add('clock',100000000);at(2801);add('clock',4000000);at(3901);add('clock',100000);at(5101);add('clock',4000000);
  });
  scenario('additional normal CH3 and CSM cancel separately while SSG and Timer B continue',({fm,ssg,write,at,add})=>{
    fm(2,60,7,3);ssg(1,233,11);write(7,0x38);write(0x24,255);write(0x25,3);write(0x26,253);write(0x27,0xcf);
    at(701);add('cancel-csm');at(1703);write(0x27,0xcf);at(2801);add('off-fm',2);at(3901);add('cancel-csm');at(5101);add('audition',2);
  });
}
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:extra?'Actual deployed additional playground_opn_worklet.js with mono YM2203 WASM, status/IRQ and four raw read ports':'Actual deployed primary YM2203 WASM Worklet with mono mixed clamp, status/IRQ and four raw read ports',
  wasmSha256:createHash('sha256').update(binary).digest('hex'),rates,cases:[],maximumDifference:0,totalStereoFrames:0,
  limits:'Offline isolated YM2203 only; ownership/IPC/UI verified independently. Forced voice-off and Stop use real WASM FM mute/TL and SSG volume controls. Deferred FM preview waits for an actual FM clock interval, tracked from the unchanged source resampler index and prescaler. Source mutes clear held output. All six voices, SSG noise/envelope, shared frequency latches, special/CSM modes, prescalers and timer/status/IRQ/data reads are exercised. No audio device or cross-platform compiler was used. '+(extra?'Additional Worklet reset clears output remainder and held PCM; force cancellation clears held PCM immediately and closes a cancelled CSM source while preserving independently keyed normal CH3.':'Primary Worklet reset retains output remainder/hold; existing primary behavior is retained.')};
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-ym2203-'));fixture=path.join(temporary,'fixture');
    execFileSync('clang++',['-std=c++14','-O2','-I'+path.join(project,'native-genesis'),...['src/native_genesis_ym2203.cpp','src/native_genesis_ym2203_fixture.cpp','src/native_genesis_ymfm_opn.cpp','native-genesis/ymfm_ssg.cpp','native-genesis/ymfm_adpcm.cpp'].map(p=>path.join(project,p)),'-o',fixture],{stdio:'pipe'});}
  report.selfTest=execFileSync(fixture,[...fixtureProfile,'--self-test'],{encoding:'utf8'}).trim();
  for(const rate of rates)for(const scenario of scenarios){
    globalThis.sampleRate=rate;const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    const input=events.map(({frame,op,args})=>`${frame} ${op} ${args.join(' ')}`).join('\n')+'\n';
    const bytes=execFileSync(fixture,[...fixtureProfile,String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*32+1048576,timeout:30000});
    assert.equal(bytes.length,scenario.frames*32);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
    let reference;
    if(extra){const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});reference=new Processor({processorOptions:{name:'ym2203',wasmBinary:binary}});await ready;}
    else {reference=new Processor();await reference.initialize(binary);}
    const clearHold=()=>{if(extra)reference.left=reference.right=0;else reference.lastLeft=reference.lastRight=0;};
    const chipRate=()=>extra?reference.rate:reference.chipRate;
    let forced=0,external=0,source=0,stopped=false,prescaler=6,sourceIndex=0;const regs=new Uint8Array(256),levels=new Uint8Array(3),keys=new Uint8Array(3),pending=new Map();
    const updateMute=()=>reference.chip.setMuteMask(forced|external|(source&2?7:0));updateMute();
    const raw=(r,v)=>extra?reference.apply({method:'write',args:[0,r,v]},reference.port):reference.write(r,v);
    const restore=ch=>{if(forced&(1<<ch)){forced&=~(1<<ch);for(let op=0;op<4;op++)raw(0x40+ch+op*4,regs[0x40+ch+op*4]);updateMute();}};
    const write=(r,v,author=true)=>{
      regs[r]=v;
      if(r===0x28&&(v&7)<3){const ch=v&7;keys[ch]=v>>4;pending.delete(ch);if(v&0xf0){restore(ch);stopped=false;}}
      if(r===0x27&&(v&0x81)===0x81){restore(2);stopped=false;}
      if(r>=8&&r<=10){if(author&&(v&31))levels[r-8]=v&31;if(v&31)stopped=false;}
      if(r===0x2d)prescaler=6;else if(r===0x2e&&prescaler===6)prescaler=3;else if(r===0x2f)prescaler=2;
      raw(r,r>=0x40&&r<=0x4e&&(r&3)<3&&(forced&(1<<(r&3)))?v|127:v);
    };
    const off=voice=>{if(voice<3){pending.delete(voice);keys[voice]=0;regs[0x28]=voice;raw(0x28,voice);forced|=1<<voice;for(let op=0;op<4;op++)raw(0x40+voice+op*4,regs[0x40+voice+op*4]|127);updateMute();}else write(8+voice-3,0,false);if(extra){if(voice===2)write(0x27,regs[0x27]&~0x81);clearHold();}};
    const audition=(voice,mask=15)=>{if(voice<3){off(voice);if(mask)pending.set(voice,mask);}else write(8+voice-3,levels[voice-3],false);};
    let next=0,maximumDifference=0,peak=0,first;const l=new Float32Array(1),r=new Float32Array(1);
    try{for(let frame=0;frame<scenario.frames;frame++){
      globalThis.currentFrame=frame;
      while(next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
        if(op==='write')write(...args);else if(op==='level')levels[args[0]]=args[1];
        else if(op==='clock'){if(extra)reference.apply({method:'clock',args},reference.port);else {reference.clock=args[0];reference.chipRate=reference.chip.sampleRate(args[0]);}}
        else if(op==='off')off(args[0]);else if(op==='audition'||op==='audition-mask')audition(...args);
        else if(op==='off-fm'){const ch=args[0];if(ch===2&&(regs[0x27]&0x81)===0x81){pending.delete(ch);keys[ch]=0;regs[0x28]=ch;raw(0x28,ch);}else off(ch);}
        else if(op==='cancel-csm'){write(0x27,regs[0x27]&~0x81);if(!keys[2]&&!pending.has(2))off(2);}
        else if(op==='stop'){for(let voice=0;voice<6;voice++)off(voice);write(0x27,regs[0x27]&0xc0);pending.clear();stopped=true;clearHold();}
        else if(op==='reset'){if(extra)reference.apply({method:'reset'},reference.port);else reference.chip.reset();regs.fill(0);levels.fill(0);keys.fill(0);forced=0;pending.clear();stopped=false;updateMute();}
        else if(op==='source'){source=args[0];reference.chip.setSourceMuteMask(source&1);updateMute();clearHold();}
        else if(op==='mute'){external=args[0];updateMute();clearHold();}
        else throw Error(op);
      }
      const count=Math.floor((reference.remainder+chipRate())/rate),divisor=prescaler*3;
      let fmTick=false;for(let i=0;i<count;i++)if((sourceIndex+i)%divisor===0)fmTick=true;
      reference.process([],[[l,r]]);sourceIndex+=count;
      if(stopped)l[0]=r[0]=0;
      if(fmTick&&pending.size){const starts=[...pending];pending.clear();for(const [ch,mask]of starts)write(0x28,(mask<<4)|ch);}
      assert.equal(actual[frame*8],actual[frame*8+1]);
      const expected=[l[0],r[0],reference.chip.readStatus(),Number(reference.chip.getIrq()),...Array.from({length:4},(_,port)=>reference.chip.read(port))];
      for(let ch=0;ch<8;ch++){const value=actual[frame*8+ch];assert(Number.isFinite(value));const difference=Math.abs(value-expected[ch]);
        if(difference&&!first)first={frame,ch,native:value,wasm:expected[ch]};maximumDifference=Math.max(maximumDifference,difference);if(ch<2)peak=Math.max(peak,Math.abs(value));}
    }
    assert(maximumDifference<=1e-7,`${scenario.name} at ${rate}: difference ${maximumDifference}, ${JSON.stringify(first)}`);assert(peak>1e-4,scenario.name+' must sound');
    report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference,peak});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
    }finally{if(extra)reference.dispose();else reference.chip.dispose();}
  }
  report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`Native ${extra?'additional ':''}YM2203: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames with status/IRQ/read ports, maximum difference ${report.maximumDifference}`);console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
