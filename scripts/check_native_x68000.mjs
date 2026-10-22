/** Actual Native X68000 versus deployed YM2151 / OKIM6258 WASM; no audio device. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fmFactory from '../docs/generated/ym2151_wasm.js';
import okiFactory from '../docs/generated/okim6258_wasm.js';
import {Ym2151AudioEngine} from '../web/ym2151audioengine.js';
import {Oki6258AudioEngine} from '../web/okim6258audioengine.js';
import {YM2151Synth} from '../web/ym2151synth.js';
import {Oki6258Stream,encodeOki6258} from '../web/okim6258synth.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const option=name=>{const i=process.argv.indexOf(name);assert(i<0||process.argv[i+1],`${name} needs a value`);return i<0?null:process.argv[i+1];};
const out=option('--out');let fixture=option('--fixture'),temporary;
const fmBinary=await fs.readFile(path.join(root,'docs/generated/ym2151_wasm.wasm'));
const okiBinary=await fs.readFile(path.join(root,'docs/generated/okim6258_wasm.wasm'));
const fmModule=await fmFactory({wasmBinary:fmBinary}),okiModule=await okiFactory({wasmBinary:okiBinary});
const rates=[44100,48000,96000],scenarios=[];
const preset={algorithm:7,feedback:1,pan:{left:true,right:true},operators:Array.from({length:4},(_,i)=>({multi:i+1,tl:38+i*4,ar:31,d1r:0,d2r:0,sl:0,rr:15}))};
const encoded=encodeOki6258({channels:[Float32Array.from({length:701},(_,i)=>Math.sin(i*Math.PI*2/31)*.7)],sampleRate:15625},15625).bytes;
function scenario(name,build,{frames=6144}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
  const synth=new YM2151Synth({clock:4000000,transport:{writeRegister:(r,v)=>add('write',0,r,v),reset:()=>add('reset',0)}});
  build({synth,add,at:value=>{frame=value;},ow:(r,v)=>add('write',1,r,v)});scenarios.push({name,frames,events});
}
const fm=(synth,ch=0,note=69)=>{synth.setPreset(ch,preset);synth.noteOn(ch,note);};
scenario('eight FM channels, stereo, key codes and key fractions',({synth,at})=>{
  for(let ch=0;ch<8;ch++){fm(synth,ch,48+ch*4);synth.setPan(ch,ch<5,ch>=3);synth.setPitch(ch,0x30+ch*3,7+ch*8);}
  at(701);synth.keyOff(2);at(1703);synth.setOperator(3,2,{dt1:6,dt2:3,multi:7});at(2801);synth.noteOn(2,77);at(4301);for(let ch=0;ch<8;ch++)synth.keyOff(ch);
});
scenario('independent LFO AM and PM depths, all waveforms and channel-seven noise',({synth,at})=>{
  fm(synth,0,60);fm(synth,7,67);synth.setPreset(0,{ams:3,pms:7,operators:[{am:true},{am:true},{am:true},{am:true}]});
  synth.setLFO({frequency:235,amDepth:67,pmDepth:93});
  for(let wave=0;wave<4;wave++){at(wave*1201+1);synth.setLFO({waveform:wave});}
  at(701);synth.setNoise(true,17);at(1703);synth.setLFO({amDepth:13});at(2801);synth.setLFO({pmDepth:27});at(5101);synth.setNoise(false);
});
scenario('immediate force-key-off, Stop and authored total-level restoration',({synth,add,at})=>{
  fm(synth);fm(synth,7,67);at(701);add('off',0);at(1703);synth.keyOn(0);at(2801);add('stop',0);
  at(3301);synth.setOperator(0,3,{tl:21});at(3701);synth.keyOn(0);at(4501);synth.keyOn(7);
});
scenario('FM channel mute preserves clocks, LFO and envelopes',({synth,at,add})=>{
  fm(synth);fm(synth,7,67);for(const [frame,mask]of[[701,1],[1703,128],[2801,255],[3901,0]]){at(frame);add('mute',mask);}
});
scenario('percussive manual audition retrigger waits for a real FM interval and cancellation wins',({synth,add,at})=>{
  for(const ch of [0,7]){fm(synth,ch,60+ch);for(let op=0;op<4;op++)synth.setOperator(ch,op,{d1r:31,d2r:31,sl:15,rr:15});}
  for(let frame=701;frame<4500;frame+=601){at(frame);add('audition',0,15);add('audition',7,15);}
  at(4501);add('audition',0,15);add('off',0);at(5101);add('audition',7,15);add('stop',0);
});
scenario('FM clock changes including upsample holds and core reset',({synth,at,add})=>{
  fm(synth);for(const [frame,clock]of[[701,3579545],[1703,8000000],[2801,100000],[3301,100000000],[3901,4000000]]){at(frame);add('clock',0,clock);}
  at(4501);synth.reset();fm(synth,3,72);
});
for(const [index,divider]of[1024,768,512].entries())scenario(`OKI encoded 12-bit sample, divider ${divider}, finite end and retrigger`,({add,ow,at})=>{
  ow(12,index);add('memory',encoded);add('play',0);at(701);ow(2,2);at(1703);add('play',0);at(2501);ow(2,1);at(3301);ow(2,3);at(3901);ow(2,0);at(4501);add('play',0);
});
scenario('OKI repeat restarts predictor, sample replacement and retained sample after Stop',({add,ow,at})=>{
  add('memory',encoded.subarray(0,63));add('play',1);at(701);ow(12,1);at(1703);add('memory',encoded.subarray(7,71));add('play',1);
  at(2801);add('stop',1);at(3301);add('play',1);at(4501);add('repeat',0);
});
scenario('OKI single-byte samples, fractional clocks and VCLK faster than output',({add,ow,at})=>{
  add('memory',Uint8Array.of(0x7f));add('clock',1,100000);add('play',1);at(701);add('clock',1,24000000);
  at(1703);ow(12,0);at(2801);add('clock',1,100000000);at(3901);ow(12,2);at(4501);add('repeat',0);
});
scenario('OKI raw FIFO writes, low nibble first, raw play/stop and clock registers',({add,ow,at})=>{
  ow(0,2);for(let frame=0;frame<1700;frame+=7){at(frame);ow(1,((frame*11)^0xa5)&255);}
  at(1801);ow(0,1);at(2101);for(let i=0;i<4;i++)ow(8+i,(7680000>>>(i*8))&255);ow(12,1);ow(0,2);
  for(let frame=2101;frame<4700;frame+=9){at(frame);ow(1,frame&255);}at(5101);ow(0,1);
});
scenario('OKI clock/divider/pan edits while streaming preserve fractional phase',({add,ow,at})=>{
  add('memory',encoded);add('play',1);
  for(const [frame,clock]of[[701,7680000],[1703,4000000],[2801,16000000],[3901,8000000]]){at(frame);add('clock',1,clock);}
  at(1201);ow(12,0);at(2201);ow(12,1);at(3401);ow(2,1);at(4401);ow(2,2);at(5101);ow(12,2);
});
scenario('independent FM and OKI clocks, resets, Stop and retained uploaded sample',({synth,add,ow,at})=>{
  fm(synth);add('memory',encoded);add('play',1);ow(12,1);ow(2,1);
  at(701);add('reset',0);at(1201);fm(synth,7,72);at(1703);add('reset',1);
  at(2201);add('play',1);at(2801);add('stop',2);at(3301);synth.keyOn(7);add('play',1);at(4501);add('reset',2);at(5101);fm(synth,2,64);add('play',0);
});
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:'Actual deployed YM2151 / OKIM6258 WASM, Ym2151AudioEngine and Oki6258Stream (flags 12)',
  wasmSha256:{ym2151:createHash('sha256').update(fmBinary).digest('hex'),okim6258:createHash('sha256').update(okiBinary).digest('hex')},rates,cases:[],maximumDifference:0,totalStereoFrames:0,
  limits:'Offline synthesis/output-rate/stream comparison with independent FM and OKI outputs. Native ownership, scheduling, IPC and UI are verified separately. Browser Worklet immediate force-key-off and authored total-level restoration are reproduced over the real WASM. C++ fixture asserts retained samples, atomic 16 MiB uploads, observational IRQ/status and zero callback allocations.'};
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-x68000-'));fixture=path.join(temporary,'fixture');
    execFileSync('clang++',['-std=c++14','-O2',...['native-genesis','native-x68000/snapshot/src','native-x68000/snapshot/third_party/mame-okim6258'].map(p=>'-I'+path.join(project,p)),
      ...['src/native_genesis_x68000.cpp','src/native_genesis_x68000_fixture.cpp','native-x68000/snapshot/src/ymfm_opm.cpp','native-x68000/okim6258.cpp'].map(p=>path.join(project,p)),'-o',fixture],{stdio:'pipe'});}
  report.selfTest=execFileSync(fixture,['--self-test'],{encoding:'utf8'}).trim();
  for(const rate of rates)for(const scenario of scenarios){
    const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    const input=events.map(({frame,op,args})=>`${frame} ${op} ${op==='memory'?Buffer.from(args[0]).toString('hex'):args.join(' ')}`).join('\n')+'\n';
    const bytes=execFileSync(fixture,[String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*16+1048576,timeout:30000});
    assert.equal(bytes.length,scenario.frames*16);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
    const fmEngine=await Ym2151AudioEngine.create({ym2151ModuleFactory:async()=>fmModule,ym2151Clock:4000000,outputSampleRate:rate});
    const okiEngine=await Oki6258AudioEngine.create({moduleFactory:async()=>okiModule,clock:8000000,flags:12,outputSampleRate:rate});
    const stream=new Oki6258Stream(okiEngine);const registers=new Uint8Array(256),pending=new Map();let forced=0,silent=false;
    const raw=(r,v)=>fmEngine.writeYm2151(r,v);
    const fmWrite=(r,v)=>{registers[r]=v;if(r===8)pending.delete(v&7);if(r===8&&(v&0x78)){const ch=v&7;if(forced&(1<<ch)){forced&=~(1<<ch);for(let op=0;op<4;op++)raw(0x60+op*8+ch,registers[0x60+op*8+ch]);}silent=false;}raw(r,r>=0x60&&r<0x80&&(forced&(1<<(r&7)))?127:v);};
    const off=ch=>{if(ch===8){stream.stop();return;}pending.delete(ch);raw(8,ch);forced|=1<<ch;for(let op=0;op<4;op++)raw(0x60+op*8+ch,127);};
    const reset=chip=>{if(chip===0||chip===2){fmEngine.reset();registers.fill(0);pending.clear();forced=0;silent=true;}if(chip===1||chip===2)stream.reset();};
    const stop=chip=>{if(chip===0||chip===2){for(let ch=0;ch<8;ch++)off(ch);silent=true;}if(chip===1||chip===2)stream.stop();};
    let next=0,maximumDifference=0,peak=0,first;
    const fl=new Float32Array(1),fr=new Float32Array(1),ol=new Float32Array(1),orr=new Float32Array(1);
    try{for(let frame=0;frame<scenario.frames;frame++){
      while(next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
        if(op==='write'){const [chip,r,v]=args;if(chip)stream.writeRegister(r,v);else fmWrite(r,v);}
        else if(op==='audition'){off(args[0]);pending.set(...args);}
        else if(op==='clock'){if(args[0])stream.setClock(args[1]);else fmEngine.chipRate=fmEngine.ym2151.sampleRate(args[1]);}
        else if(op==='memory')stream.loadMemory(args[0]);else if(op==='play')stream.play({repeat:!!args[0]});
        else if(op==='repeat')stream.repeat=!!args[0];else if(op==='reset')reset(args[0]);else if(op==='stop')stop(args[0]);
        else if(op==='off')off(args[0]);else if(op==='mute'){fmEngine.ym2151.setMuteMask(args[0]);fmEngine.lastLeft=fmEngine.lastRight=0;}else throw Error(op);
      }
      const hadSource=Math.floor((fmEngine.remainder+fmEngine.chipRate)/rate)>0;
      fmEngine.process(fl,fr,1);stream.process(ol,orr);const expected=[silent?0:fl[0],silent?0:fr[0],ol[0],orr[0]];
      if(hadSource)for(const [ch,mask]of pending)fmWrite(8,ch|(mask<<3));
      for(let ch=0;ch<4;ch++){const value=actual[frame*4+ch];assert(Number.isFinite(value));const difference=Math.abs(value-expected[ch]);
        if(difference&&!first)first={frame,ch,native:value,wasm:expected[ch]};maximumDifference=Math.max(maximumDifference,difference);peak=Math.max(peak,Math.abs(value));}
    }
    assert(maximumDifference<=1e-7,`${scenario.name} at ${rate}: difference ${maximumDifference}, ${JSON.stringify(first)}`);assert(peak>1e-4,scenario.name+' must sound');
    report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference,peak});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
    }finally{fmEngine.dispose();okiEngine.dispose();}
  }
  report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`Native X68000: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frame pairs, maximum difference ${report.maximumDifference}`);console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
