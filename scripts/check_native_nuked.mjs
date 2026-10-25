/** Native selected Nuked versus the actually shipped Browser WASM/Worklet. No device. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const sdk=path.join(project,'vendor/tetorica-soundchip-native');
const option=name=>{const equal=process.argv.find(value=>value.startsWith(name+'=')),index=process.argv.indexOf(name);if(equal===undefined&&index<0)return null;const value=equal===undefined?process.argv[index+1]:equal.slice(name.length+1);assert(value&&!value.startsWith('--'),`${name} requires a value`);return value;};
const out=option('--out'),sanitize=process.argv.includes('--sanitize');let fixture=option('--fixture'),temporary;
const [fmBinary,psgBinary]=await Promise.all(['nuked_opn2_wasm.wasm','segapsg_wasm.wasm'].map(name=>fs.readFile(path.join(root,'docs/generated',name))));
let Processor;globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(data){if(data.type==='error')throw Error(data.message);},close(){}};}};
globalThis.registerProcessor=(name,processor)=>{if(name==='ym2612-processor')Processor=processor;};
await import('../docs/js/ym2612-worklet-nuked.js');
const rates=[44100,48000,96000],scenarios=[];
function scenario(name,build,{frames=6144}={}){
 let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args}),write=(port,r,v)=>add('write',port,r,v);
 const pitch=(voice,midi)=>{const ch=voice%3,port=Math.floor(voice/3),hz=440*2**((midi-69)/12);let block=0,fnum=0;for(;block<7;block++){fnum=Math.round(hz*144*2**20/7670454/2**(block-1));if(fnum<2048)break;}write(port,0xa4+ch,(block<<3)|(fnum>>8));write(port,0xa0+ch,fnum&255);};
 const fm=(voice=0,midi=69,algorithm=7,feedback=0,key=true)=>{const ch=voice%3,port=Math.floor(voice/3);
  for(let op=0;op<4;op++){const o=ch+op*4;write(port,0x30+o,1+op);write(port,0x40+o,12+op*5);write(port,0x50+o,31);write(port,0x60+o,4);write(port,0x70+o,0);write(port,0x80+o,0x2f);write(port,0x90+o,0);}
  write(port,0xb0+ch,algorithm|(feedback<<3));write(port,0xb4+ch,0xc0);pitch(voice,midi);if(key)write(0,0x28,0xf0|ch|(port?4:0));
 };
 const psg=(ch=0,period=127,attenuation=5)=>{add('psg',0x80|(ch<<5)|(period&15));add('psg',period>>4);add('psg',0x90|(ch<<5)|attenuation);};
 build({add,write,at:value=>{frame=value;},fm,pitch,psg});scenarios.push({name,frames,events});
}
scenario('natural reset idle ladder DC matches uncentered shipped Worklet',()=>{});
for(let voice=0;voice<6;voice++)for(let algorithm=0;algorithm<8;algorithm++)scenario(`FM physical channel ${voice}, all four operators and algorithm ${algorithm}`,({fm,write,pitch,at})=>{
 const ch=voice%3,port=Math.floor(voice/3);fm(voice,48+voice*4,algorithm,algorithm);at(701);write(port,0x40+ch,35);at(1703);write(port,0x34+ch,7);at(2801);pitch(voice,79);at(3901);write(0,0x28,ch|(port?4:0));at(5101);write(0,0x28,0xf0|ch|(port?4:0));
});
scenario('six simultaneous channels, shared raw write latch and exact pan routing',({fm,write,at})=>{
 for(let ch=0;ch<6;ch++)fm(ch,45+ch*5,ch%8,ch);for(const [frame,pan]of[[701,0x80],[1703,0x40],[2801,0],[3901,0xc0]]){at(frame);for(let ch=0;ch<6;ch++)write(Math.floor(ch/3),0xb4+ch%3,pan);}at(5101);for(let ch=0;ch<6;ch++)write(Math.floor(ch/3),0xb4+ch%3,ch&1?0x40:0x80);
});
scenario('all operator key masks and SSG-EG modes with ordinary release',({fm,write,at})=>{
 fm();for(let i=0;i<16;i++){at(i*359);write(0,0x28,i<<4);for(let op=0;op<4;op++)write(0,0x90+op*4,8+(i&7));}
});
scenario('operator detune multiplication total level rates key scaling and amplitude modulation',({fm,write,at})=>{
 fm(0,57,0,7);write(0,0x22,0x0f);for(let i=0;i<8;i++){at(i*701);for(let op=0;op<4;op++){const o=op*4;write(0,0x30+o,((i&7)<<4)|((i+op)&15));write(0,0x50+o,0x1f|(i&3)<<6);write(0,0x60+o,0x80|i);write(0,0x70+o,i*3);write(0,0x80+o,0x2f);}write(0,0xb4,0xc0|(i&3)<<4|(i&7));}
});
scenario('normal and special frequency high bytes are shared across bank latches',({fm,write,at})=>{
 for(let ch=0;ch<6;ch++)fm(ch,45+ch*5,7);write(0,0x27,0x40);for(let ch=0;ch<3;ch++){write(0,0xac+ch,0x20+ch*3);write(0,0xa8+ch,0x31+ch*71);}at(701);write(0,0xa4,0x21);write(1,0xa1,0x91);at(1703);write(1,0xa6,0x2a);write(0,0xa0,0x41);at(2801);write(1,0xad,0x29);write(0,0xa8,0x69);at(3901);write(0,0x27,0);at(5101);write(0,0x27,0x40);
});
scenario('LFO all eight frequencies and independent AMS PMS routing',({fm,write,at})=>{
 for(let ch=0;ch<6;ch++){fm(ch,48+ch*5,4,4);for(let op=0;op<4;op++)write(Math.floor(ch/3),0x60+ch%3+op*4,0x84);write(Math.floor(ch/3),0xb4+ch%3,0xf7);}for(let i=0;i<8;i++){at(i*701);write(0,0x22,8+i);}
});
for(const mode of[5,10,15,0x45,0x85])scenario(`timers A/B flags IRQ CSM and channel3 mode ${mode}`,({fm,write,at})=>{
 fm(2,60,7,3);write(0,0x24,255);write(0,0x25,3);write(0,0x26,253);write(0,0x27,mode);at(701);write(0,0x27,0x30);at(1703);write(0,0x27,mode);at(2801);write(0,0x27,0x30);at(3901);write(0,0x24,249);write(0,0x27,mode);at(5101);write(0,0x27,0);
});
scenario('cold channel-3 special mode and timers without register28 keying',({fm,write,at})=>{
 fm(2,60,7,3,false);for(let ch=0;ch<3;ch++){write(0,0xac+ch,0x20+ch*3);write(0,0xa8+ch,0x31+ch*71);}write(0,0x24,255);write(0,0x25,3);write(0,0x27,0xc5);at(1703);write(0,0x27,0x30);at(2801);write(0,0x27,0xc5);at(3901);write(0,0x27,0x40);at(5101);write(0,0x27,0xc5);
});
scenario('DAC full unsigned range and FM6 handover independent stereo pan',({fm,write,at})=>{
 fm(5,60,7);write(0,0x2b,0x80);for(let i=0;i<64;i++){at(i*89);write(0,0x2a,(i*37)&255);if(i%13===0)write(1,0xb6,[0xc0,0x80,0x40,0][Math.floor(i/13)%4]);}at(5801);write(0,0x2b,0);write(0,0x28,0xf6);
});
for(let channel=0;channel<4;channel++)scenario(`PSG physical voice ${channel}, noise and exact stereo mask`,({add,psg,at})=>{
 if(channel<3)psg(channel,127+channel*103,4);else{psg(2,97,15);add('psg',0xe7);add('psg',0xf3);}for(const [frame,mask]of[[701,0x10<<channel],[1703,1<<channel],[2801,0],[3901,255]]){at(frame);add('stereo',mask);}at(5101);add('psg-off',channel);
});
scenario('PSG all noise feedback rates and tone3 dependency with data-only latch writes',({add,psg,at})=>{
 psg(2,97,15);add('psg',0xf4);for(let i=0;i<8;i++){at(i*701);add('psg',0xe0|i);add('psg',i^3);if(i&1)psg(2,3+i*17,15);}
});
scenario('mixed FM and PSG clipping, source gain ramps and held upsampling',({fm,psg,add,at})=>{
 for(let ch=0;ch<6;ch++)fm(ch,45+ch*5,7);for(let ch=0;ch<3;ch++)psg(ch,53+ch*97,0);add('psg',0xe7);add('psg',0xf0);at(701);add('mix',.25,.75,.5,.25,1);at(1703);add('mix',2,1.5,1.75,2,1);at(2801);add('mix',0,0,0,0,1);at(3901);add('mix',1,1,1,1,1);at(5101);add('stereo',0x91);
});
scenario('independent FM and PSG gain ramps overlap without restarting the other source',({fm,psg,add,at})=>{
 fm();psg();at(701);add('mix',.25,.75,1,1,1);at(730);add('mix',.25,.75,.125,.875,1);at(750);add('mix',.25,.75,.125,.875,.5);at(781);add('mix',.75,.25,.125,.875,.5);at(1703);add('mix',1,1,1,1,1);
});
scenario('reset clears retained held PCM and write latches at arbitrary source phase',({fm,psg,add,write,at})=>{
 fm(0,60);psg(1,127,4);at(701);add('reset');at(1703);fm(5,76);psg(2,233,3);at(2801);add('reset');at(3901);fm(2,69);write(0,0x27,0x40);at(5101);add('psg-reset');
});
scenario('Stop is immediately silent and retains normal/special latches, patch and pan',({fm,psg,write,add,at})=>{
 for(let ch=0;ch<6;ch++)fm(ch,45+ch*5,7,ch);psg(1,127,4);write(0,0x27,0x40);write(0,0xac,0x22);write(0,0xa8,0x69);write(1,0xb6,0x80);write(1,0xa4,0x29);add('stereo',0x21);at(701);add('stop');at(1703);write(0,0xb0,6);write(0,0x28,0xf3);write(0,0x28,0xf7);write(0,0x27,0xc5);at(2801);write(0,0xa2,0x41);write(0,0x28,0xf2);at(3901);add('stop');at(5101);write(0,0x28,0xf6);add('psg',0xb4);
});
for(const kind of['FM','DAC','PSG','CSM'])scenario(`Stop remains silent through edits and ${kind} trigger resumes`,({fm,psg,write,add,at})=>{
 fm(2,60,7,3,kind!=='CSM');psg(0,127,4);write(0,0x24,255);write(0,0x25,3);at(701);add('stop');at(1703);write(0,0xb2,7);write(0,0x40,31);add('stereo',0x91);at(2801);
 if(kind==='FM')write(0,0x28,0xf2);else if(kind==='DAC'){write(0,0x2b,128);write(0,0x2a,220);}else if(kind==='PSG')add('psg',0x94);else write(0,0x27,0x85);at(3901);add('stop');at(5101);add('reset');
});
const report={schemaVersion:1,checker:path.relative(root,fileURLToPath(import.meta.url)),checkerSha256:createHash('sha256').update(await fs.readFile(fileURLToPath(import.meta.url))).digest('hex'),deviceOpened:false,startedAt:new Date().toISOString(),reference:'Actual deployed docs/js/ym2612-worklet-nuked.js and Nuked/PSG WASM; raw reset DC preserved; explicit Native Stop modeled separately with real WASM reset and authored-register replay',wasmSha256:createHash('sha256').update(fmBinary).digest('hex'),psgWasmSha256:createHash('sha256').update(psgBinary).digest('hex'),rates,cases:[],maximumDifference:0,totalStereoFrames:0,sanitizer:sanitize?'AddressSanitizer + UndefinedBehaviorSanitizer (macOS LeakSanitizer unsupported)':'none',limits:'Offline selected Nuked plus SegaPSG, no device or cross-platform compiler. Native legacy fixed clocks 7,670,454 / 3,579,545 Hz; runtime clock switching is not added. Stop retains the existing Native authored-patch replay policy and suppresses emitted PCM until a voice trigger; natural reset matches Browser raw idle. Status, IRQ and all four read ports are compared after every output frame. Callback C++ new/delete and Nuked C malloc/free are counted; the alternate ymfm API links to fail-fast stubs to prove no hidden ymfm calls. The combined gain transport preserves independent ramps for FM/PSG targets that did not change; overlapping source edits are compared.'};
try{
 if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-nuked-'));fixture=path.join(temporary,'fixture');
  const include=path.join(sdk,'vendor/nuked-opn2'),provider=path.join(temporary,'nuked.o'),symbols=['Reset','SetChipType','Clock','Write','SetTestPin','ReadTestPin','ReadIRQPin','Read'];
  const flags=sanitize?['-O1','-g','-fsanitize=address,undefined','-fno-omit-frame-pointer','-fwrapv']:['-O2','-fwrapv'];
  if(sanitize){process.env.ASAN_OPTIONS='detect_leaks=0';process.env.UBSAN_OPTIONS='halt_on_error=1:print_stacktrace=1';}
  execFileSync('clang',['-std=c11',...flags,...symbols.map(s=>`-DOPN2_${s}=tetorica_nuked_OPN2_${s}`),'-I'+include,'-c',path.join(include,'ym3438.c'),'-o',provider],{stdio:'pipe'});
  // Machine mixing remains host-owned; the fixed SDK provides the prefixed
  // Nuked adapter, its included C wrapper/additional API, and one C provider.
  const files=[path.join(project,'src/native_genesis_core.cpp'),path.join(sdk,'native/reference/tauri/native_genesis_nuked.cpp'),path.join(project,'src/native_genesis_nuked_fixture.cpp'),
   path.join(sdk,'wasm/segapsg_wasm.cpp'),path.join(sdk,'vendor/ymfm/segapsg.cpp')];
  const inputs=[...files,path.join(include,'ym3438.c'),path.join(include,'ym3438.h'),path.join(sdk,'wasm/nuked_opn2_wasm.c'),path.join(sdk,'native/reference/tauri/native_genesis_nuked_ym2612.inc'),path.join(sdk,'native/reference/tauri/native_genesis_ym2612.h'),path.join(sdk,'vendor/ymfm/segapsg.h'),path.join(sdk,'vendor/ymfm/chip_state.h')];
  report.nativeSources=await Promise.all(inputs.map(async file=>({file:path.relative(root,file),
   sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')})));
  execFileSync('clang++',['-std=c++14',...flags,'-DTETORICA_NUKED_ISOLATED_FIXTURE','-DTETORICA_NUKED_AUDIT_ALLOCATIONS','-I'+include,
   '-I'+path.join(sdk,'vendor/ymfm'),'-I'+path.join(sdk,'wasm'),...files,provider,'-o',fixture],{stdio:'pipe'});
 }
 report.fixtureSha256=createHash('sha256').update(await fs.readFile(fixture)).digest('hex');
 report.selfTest=execFileSync(fixture,['--self-test'],{encoding:'utf8'}).trim();
 for(const rate of rates)for(const scenario of scenarios){
  globalThis.sampleRate=rate;const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame),input=events.map(({frame,op,args})=>`${frame} ${op} ${args.join(' ')}`).join('\n')+'\n';
  const bytes=execFileSync(fixture,[String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*32+1048576,timeout:30000});assert.equal(bytes.length,scenario.frames*32);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
  const reference=new Processor();await reference.init(fmBinary,psgBinary);assert(reference.ym2612&&reference.psg);
  let regs,written,latches,periods,levels,latch,noise,stereo,stopped;
  const clear=()=>{regs=[new Uint8Array(256),new Uint8Array(256)];written=[new Uint8Array(256),new Uint8Array(256)];latches=new Uint8Array(2);periods=new Uint16Array(3);levels=new Uint8Array([15,15,15,15]);latch=0;noise=0;stereo=255;stopped=false;};clear();
  const reset=()=>{reference.applyCommand({type:'reset'});clear();};
  const write=(port,r,v)=>{
   if(port===0&&((r===0x28&&(v&240)&&(v&3)<3)||(r===0x2b&&(v&128))||(r===0x2a&&(regs[0][0x2b]&128))||(r===0x27&&(v&0xc1)===0x81)))stopped=false;
   if((r&240)===0xa0){if((r&3)!==3){const i=(r>>3)&1;if(r&4)latches[i]=v&63;else{regs[port][r]=v;regs[port][r|4]=latches[i];written[port][r]=written[port][r|4]=1;}}}else{regs[port][r]=v;written[port][r]=1;}
   reference.ym2612.writeRegister(r,v,port);
  };
  const psg=v=>{if(v&128)latch=v&0x70;const ch=latch>>5;if((latch&16)&&(v&15)!==15)stopped=false;if(latch&16)levels[ch]=v&15;else if(ch===3)noise=v&7;else if(v&128)periods[ch]=(periods[ch]&0x3f0)|(v&15);else periods[ch]=(periods[ch]&15)|((v&63)<<4);reference.psg.write(v);};
  const stop=()=>{const saved=regs.map(a=>a.slice()),valid=written.map(a=>a.slice()),last=latches.slice(),tone=periods.slice(),ns=noise,pan=stereo;reset();
   for(let port=0;port<2;port++){for(let r=0;r<256;r++){if(!valid[port][r]||(r>=0xa0&&r<=0xaf)||(port===0&&(r===0x28||r===0x2a)))continue;write(port,r,port===0&&r===0x27?saved[port][r]&0xc0:port===0&&r===0x2b?saved[port][r]&0x7f:saved[port][r]);}for(const base of[0xa0,0xa8])for(let ch=0;ch<3;ch++){const low=base+ch,high=low+4;if(valid[port][high])write(port,high,saved[port][high]);if(valid[port][low])write(port,low,saved[port][low]);}}
   write(0,0xa4,last[0]);write(0,0xac,last[1]);for(let ch=0;ch<3;ch++){psg(0x80|(ch<<5)|(tone[ch]&15));psg(tone[ch]>>4);}psg(0xe0|ns);for(let ch=0;ch<4;ch++)psg(0x9f|(ch<<5));psg(0x80|(tone[0]&15));stereo=pan;reference.psg.setStereo(pan);stopped=true;
  };
  let next=0,maximumDifference=0,peak=0,first;const left=new Float32Array(1),right=new Float32Array(1);
  try{for(let frame=0;frame<scenario.frames;frame++){
   globalThis.currentFrame=frame;while(next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
    if(op==='write')write(...args);else if(op==='psg')psg(args[0]);else if(op==='stereo'){stereo=args[0];reference.psg.setStereo(stereo);}else if(op==='reset')reset();else if(op==='stop')stop();
    else if(op==='psg-reset'){reference.psg.reset();periods.fill(0);levels.fill(15);latch=noise=0;stereo=255;}
    else if(op==='psg-off'){const saved=latch;psg(0x9f|(args[0]<<5));const ch=saved>>5;psg(0x80|saved|(saved&16?levels[ch]:ch===3?noise:periods[ch]&15));}
    else if(op==='mix'){const gains=args.map(Math.fround);for(const [name,first]of[['ym2612',0],['segapsg',2]]){const pair=gains.slice(first,first+2);if(pair.some((g,i)=>g!==reference.mixTargets[name][i]))reference.applyCommand({type:'mixer-settings',name,gains:pair});}}else throw Error(op);
   }
   reference.renderFrames(left,right,0,1);if(stopped)left[0]=right[0]=0;
   const expected=[left[0],right[0],reference.ym2612.readStatus(),Number(reference.ym2612.getIrq()),...Array.from({length:4},(_,port)=>reference.ym2612.read(port))];
   for(let channel=0;channel<8;channel++){const value=actual[frame*8+channel];assert(Number.isFinite(value));const difference=Math.abs(value-expected[channel]);if(difference&&!first)first={frame,channel,native:value,wasm:expected[channel]};maximumDifference=Math.max(maximumDifference,difference);if(channel<2)peak=Math.max(peak,Math.abs(value));}
  }
  assert(maximumDifference<=1e-7,`${scenario.name} at ${rate}: difference ${maximumDifference}, ${JSON.stringify(first)}`);assert(peak>1e-4,scenario.name+' must produce emitted PCM');
  report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference,peak});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
  }finally{reference.ym2612.dispose();reference.psg.dispose();}
 }
 report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(`Native Nuked: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames with status/IRQ/read ports, maximum difference ${report.maximumDifference}`);console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
