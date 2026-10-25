/** Actual Native/Web WASM PC Engine PCM comparison. No audio output device. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import factory from '../docs/generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../web/huc6280audioengine.js';
import {Huc6280Synth} from '../web/huc6280synth.js';
import {ChipClockResampler} from '../web/playground_chip_clock.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri/src');
const sdk=path.resolve(project,'../vendor/tetorica-soundchip-native');
const option=name=>{const equal=process.argv.find(value=>value.startsWith(name+'=')),index=process.argv.indexOf(name);if(equal===undefined&&index<0)return null;const value=equal===undefined?process.argv[index+1]:equal.slice(name.length+1);assert(value&&!value.startsWith('--'),`${name} needs a value`);return value;};
const reportPath=option('--out');let fixture=option('--fixture'),temporary;
const rates=[44100,48000,96000],cases=[];
function scenario(name,build,{frames=6144}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
  const synth=new Huc6280Synth({transport:{reset:()=>add('reset'),writeRegister:(r,v,ch)=>add('write',r,v,ch)}});
  synth.initialize();build({synth,add,at:value=>{frame=value;}});cases.push({name,frames,events});
}
scenario('six voices, independent waveform/period/volume/balance and key gates',({synth,at})=>{
  for(let ch=0;ch<6;ch++){synth.setWaveform(ch,Array.from({length:32},(_,i)=>(i*(ch+1))&31));synth.setVolume(ch,16+ch*2);synth.setPan(ch,15-ch*2,ch*3);synth.noteOn(ch,48+ch*4);}
  at(701);synth.keyOff(1);synth.setVolume(0,4);at(2303);synth.noteOn(1,'G4');synth.setMasterVolume(12,8);at(4501);synth.allNotesOff();
});
for(const ch of [4,5])scenario(`noise channel ${ch}, all frequency codes and stateful LFSR`,({synth,at})=>{
  synth.setVolume(ch,31);synth.setNoise(ch,{enabled:true,frequency:0});synth.keyOn(ch);
  for(let code=0;code<32;code++){at(code*181+1);synth.setNoise(ch,{enabled:true,frequency:code});}
});
for(const depth of [1,2,3])scenario(`LFO depth ${depth}, source voice audible, reset, frequency and period zero`,({synth,at})=>{
  synth.setWaveform(0,Array.from({length:32},(_,i)=>i));synth.setWaveform(1,Array.from({length:32},(_,i)=>i<16?24:8));
  synth.setFrequency(0,440);synth.setFrequency(1,2000);synth.setLfo({frequency:31,depth});synth.keyOn(0);synth.keyOn(1);
  at(901);synth.setLfo({frequency:7,depth,reset:true});at(1901);synth.setLfo({frequency:11,depth});
  at(3301);synth.writeRegister(0,0);synth.writeRegister(2,0);synth.writeRegister(3,0);
});
scenario('DDA sample writes, waveform pointer reset and simultaneous wavetable',({synth,add,at})=>{
  synth.setDda(2,true);synth.keyOn(2);synth.noteOn(0,'E4');
  for(let i=0;i<400;i++){at(i*11+1);synth.writeDda(2,(i*7)&31);}
  at(4601);synth.setDda(2,false);synth.noteOn(2,'G3');at(5103);add('waveform',2,Array.from({length:32},(_,i)=>31-i));
});
scenario('inspector waveform replacement retains active key/DDA sample and raw latch',({synth,add,at})=>{
  synth.noteOn(0,'C4');synth.setDda(3,true);synth.writeDda(3,27);synth.keyOn(3);synth.writeRegister(0,7);
  at(901);add('waveform',0,Array.from({length:32},(_,i)=>i<16?31:0));
  at(1901);add('waveform',3,Array.from({length:32},(_,i)=>i));
  at(3301);add('write',4,159,1);add('write',2,177,1);add('write',5,255,1);
});
scenario('raw selected slots 6/7 and explicit channel writes do not alter selection',({synth,add,at})=>{
  synth.noteOn(1,'A3');synth.writeRegister(0,7);synth.writeRegister(4,159);synth.writeRegister(6,7);
  at(901);add('write',2,77,1);add('write',3,1,1);add('write',5,0x8f,1);
  at(1901);add('write',0,6,-1);add('write',4,95,-1);add('write',6,29,-1);
  at(2501);add('write',4,31,1);at(3601);add('write',4,159,1);
});
scenario('active waveform raw writes use the real advanced oscillator pointer',({synth,add,at})=>{
  synth.noteOn(0,'A4');for(let i=0;i<48;i++){at(i*101+1);add('write',6,(i*13)&31,0);}
});
scenario('Stop retains waves, DDA, master balance, LFO, clock and selection',({synth,add,at})=>{
  synth.setMasterVolume(14,11);synth.setWaveform(0,Array.from({length:32},(_,i)=>(i*3)&31));synth.noteOn(0,'C4');
  synth.setDda(3,true);synth.writeDda(3,25);synth.keyOn(3);synth.writeRegister(0,7);
  at(701);add('clock',4474431);at(1701);add('stop');at(2801);add('write',4,152,0);add('write',4,216,3);
});
scenario('outer clock changes include fractional hold, reset, min and max rates',({synth,add,at})=>{
  synth.noteOn(0,'A4');at(701);add('clock',1789772);at(1403);add('clock',4474431);at(2101);add('clock',7159090);
  at(2803);add('reset');at(2901);synth.initialize();synth.noteOn(1,'E4');at(3301);add('clock',100000);
  at(3401);add('clock',100000000);at(3501);add('clock',3579545);
});
scenario('deterministic raw writes, all modes and cold reset',({synth,add,at})=>{
  let seed=0x6280;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  for(let i=0;i<600;i++){at(i*9+1);const r=random()%10;add('write',r,random()&255,r>=2&&r<=7?random()%6:-1);}
  at(5601);synth.initialize();synth.noteOn(0,'G4');
});

const wasmBinary=await fs.readFile(path.join(root,'docs/generated/huc6280_wasm.wasm'));
const module=await factory({wasmBinary});
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:'Actual deployed HuC6280 Web WASM plus ChipClockResampler',wasmSha256:createHash('sha256').update(wasmBinary).digest('hex'),rates,cases:[],maximumDifference:0,totalStereoFrames:0};
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-huc6280-'));fixture=path.join(temporary,'fixture');
    const sources=[path.join(sdk,'native/reference/tauri/native_genesis_huc6280.cpp'),path.join(project,'native_genesis_huc6280_fixture.cpp')];
    const inputs=[...sources,path.join(sdk,'native/reference/tauri/native_genesis_huc6280.h'),path.join(sdk,'vendor/mame-huc6280/huc6280.cpp'),path.join(sdk,'vendor/mame-huc6280/huc6280.h'),path.join(project,'native_genesis_huc6280.h')];
    report.nativeSources=await Promise.all(inputs.map(async file=>({file:path.relative(root,file),sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')})));
    execFileSync('clang++',['-std=c++17','-O2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off','-I'+path.join(sdk,'vendor/mame-huc6280'),...sources,'-o',fixture],{stdio:'pipe'});}
  report.selfTest=execFileSync(fixture,['--self-test'],{encoding:'utf8'}).trim();
  for(const rate of rates)for(const scenario of cases){
    const sorted=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    const input=sorted.map(({frame,op,args})=>`${frame} ${op}${args.length?' '+(op==='waveform'?args[0]+' '+Buffer.from(args[1]).toString('hex'):args.join(' ')):''}`).join('\n')+'\n';
    const bytes=execFileSync(fixture,[String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*8+1048576,timeout:30000});
    assert.equal(bytes.length,scenario.frames*8);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
    const chip=await Huc6280AudioEngine.create({moduleFactory:async()=>module,clock:3579545,outputSampleRate:rate});
    const registers=Array.from({length:8},()=>new Uint8Array(8));let selected=0,resampler,next=0,max=0,peak=0,first;
    const write=(r,v,ch=-1)=>{if(r===0){selected=v&7;chip.writeHuc6280(r,v);}else if([1,8,9].includes(r))chip.writeHuc6280(r,v);else{const target=ch>=0?ch:selected;if(target!==selected)chip.writeHuc6280(0,target);registers[target][r]=v;chip.writeHuc6280(r,v);if(target!==selected)chip.writeHuc6280(0,selected);}};
    const source={generateStereo:n=>chip.processFrames(n)},left=new Float32Array(1),right=new Float32Array(1);
    try{for(let frame=0;frame<scenario.frames;frame++){
      while(next<sorted.length&&sorted[next].frame===frame){const {op,args}=sorted[next++];
        if(op==='write')write(...args);
        else if(op==='waveform'){const [ch,wave]=args,control=registers[ch][4],dda=registers[ch][6]&31;write(4,(control&63)|64,ch);write(4,control&63,ch);for(const v of wave)write(6,v,ch);write(4,control,ch);if(control&64)write(6,dda,ch);}
        else if(op==='off')write(4,registers[args[0]][4]&127,args[0]);
        else if(op==='stop'){for(let ch=0;ch<8;ch++)write(4,registers[ch][4]&127,ch);}
        else if(op==='reset'){chip.reset();selected=0;for(const r of registers)r.fill(0);resampler?.resetPhase();}
        else if(op==='clock')(resampler??=new ChipClockResampler()).setClock(args[0],3579545);
        else throw Error(op);
      }
      const expected=resampler?(resampler.render(source,left,right),[left[0],right[0]]):(()=>{const p=chip.processFrames(1);return[p.left[0],p.right[0]];})();
      for(let ch=0;ch<2;ch++){const value=actual[frame*2+ch];assert(Number.isFinite(value));const d=Math.abs(value-expected[ch]);if(d&&!first)first={frame,ch,native:value,wasm:expected[ch]};max=Math.max(max,d);peak=Math.max(peak,Math.abs(value));}
    }
    assert(max<=1e-7,`${scenario.name} at ${rate}: difference ${max}, ${JSON.stringify(first)}`);assert(peak>1e-4,scenario.name+' must sound');
    report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference:max,peak});report.maximumDifference=Math.max(report.maximumDifference,max);report.totalStereoFrames+=scenario.frames;
    }finally{chip.dispose();}
  }
  report.status='passed';if(reportPath)await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(`Native HuC6280: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum difference ${report.maximumDifference}`);
  console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
