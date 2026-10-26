/** Standalone Native Game Gear versus the actual shipped PSG WASM Worklet. */
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
const option=name=>{const i=process.argv.indexOf(name);assert(i<0||process.argv[i+1],`${name} needs a value`);return i<0?null:process.argv[i+1];};
const out=option('--out');let fixture=option('--fixture'),temporary;
const binary=await fs.readFile(path.join(root,'docs/generated/segapsg_wasm.wasm'));
let Processor;globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.testReady=new Promise((resolve,reject)=>{this.port={postMessage:data=>{if(data.ready)resolve();else if(data.error)reject(new Error(data.error));},close(){}};});}};
globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-segapsg')Processor=processor;};
await import('../docs/js/playground_segapsg_worklet.js');
const rates=[44100,48000,96000],scenarios=[];
function scenario(name,build,{frames=6144,stereo=true}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
  const write=value=>add('write',value),tone=(ch,period,level=5)=>{write(0x80|(ch<<5)|(period&15));write(period>>4);write(0x90|(ch<<5)|level);};
  build({add,at:value=>{frame=value;},write,tone});scenarios.push({name,frames,events,stereo});
}
scenario('all 256 stereo masks across three tones plus noise: low nibble right, high nibble left',({tone,write,at,add})=>{
  tone(0,127,3);tone(1,211,5);tone(2,319,7);write(0xe7);write(0xf6);
  for(let mask=0;mask<256;mask++){at(mask*61);add('stereo',mask);}
},{frames:16384});
for(let ch=0;ch<4;ch++)scenario(`individual channel ${ch} left/right/both/disconnected and unrelated channel masks`,({tone,write,at,add})=>{
  if(ch<3)tone(ch,127+ch*71,4);else{tone(2,137,15);write(0xe7);write(0xf4);}
  for(const [frame,mask]of[[0,0x10<<ch],[701,1<<ch],[1703,0x11<<ch],[2801,0],[3901,0x11<<((ch+1)%4)],[5101,255]]){at(frame);add('stereo',mask);}
});
for(let mode=0;mode<8;mode++)scenario(`${mode&4?'white':'periodic'} noise rate ${mode&3}, tone-3 coupling, latch continuation and stereo`,({tone,write,at,add})=>{
  tone(2,71,15);write(0xe0|mode);write(0xf3);add('stereo',0x80);
  at(701);write(0xc3);write(4);add('stereo',0x08);at(1703);write(0xe0|mode);write(mode^4);add('stereo',0x88);
  at(2801);write(0xf7);write(2);add('stereo',0x80);at(3901);write(0xe0|(mode^3));add('stereo',0x08);at(5101);write(0xff);
});
scenario('three tone latches, zero/one period DC and volume data bytes route independently',({tone,write,at,add})=>{
  tone(0,127,3);tone(1,211,5);tone(2,319,7);add('stereo',0xa5);
  at(701);write(0x81);write(0);at(1703);write(0xa0);write(0);at(2801);write(0xc7);write(0x1b);
  at(3901);write(0xb2);write(9);at(5101);write(0x9f);
});
scenario('all sixteen tone and noise attenuation values preserve stereo source amplitudes',({tone,write,at,add})=>{
  tone(0,113,0);tone(1,257,0);tone(2,449,0);write(0xe5);write(0xf0);add('stereo',0x96);
  for(let level=0;level<16;level++){at(level*347);for(let ch=0;ch<4;ch++)write(0x90|(ch<<5)|level);}
});
scenario('clock edits preserve original core counters LFSR and fractional average/hold stereo phase',({tone,write,add,at})=>{
  tone(0,71,6);tone(2,103,8);write(0xe7);write(0xf4);add('stereo',0xa5);
  for(const [frame,clock,mask]of[[701,4000000,0x5a],[1703,100000,0xa5],[2801,100000000,0x96],[3901,3546893,0x69],[5101,3579545,0xff]]){at(frame);add('clock',clock);add('stereo',mask);}
});
scenario('stereo changes during very slow source holds match the shipped Worklet boundary',({tone,write,add,at})=>{
  tone(0,101,4);tone(1,211,7);write(0xe5);write(0xf8);add('clock',100000);
  for(let i=0;i<200;i++){at(i*19+17);add('stereo',[0xf0,0x0f,0x55,0xaa,0][i%5]);}
  at(5101);add('clock',4000000);add('stereo',255);
});
scenario('Stop retains stereo periods noise mode and remembered attenuation without LFSR reset',({tone,write,add,at})=>{
  tone(0,191,6);write(0xe6);write(0xf4);add('stereo',0x81);
  at(701);add('stop');at(1703);add('audition',0);add('audition',3);at(2801);add('off',3);
  at(3301);write(0xf9);at(3901);add('stop');at(4501);add('audition',3);
});
scenario('authored zero attenuation survives Stop, key-off and audition with independent tone/noise stereo',({tone,write,add,at})=>{
  tone(0,191,0);tone(2,137,15);write(0xe7);write(0xf0);add('stereo',0x81);
  at(701);add('stop');at(1703);add('audition',0);add('audition',3);at(2801);add('off',0);add('off',3);
  at(3901);add('audition',0);at(4501);add('audition',3);at(5101);add('stop');
});
scenario('slow-clock Stop clears held stereo PCM immediately and retains routing for replay',({tone,write,add,at})=>{
  tone(0,113,3);tone(2,181,5);write(0xe7);write(0xf4);add('stereo',0x96);add('clock',100000);
  at(701);add('stop');at(1703);add('audition',0);add('audition',3);at(2801);add('stop');
  at(3901);add('clock',4000000);add('audition',2);at(5101);add('stereo',0xff);
});
scenario('reset restores stereo ff and phase while retaining selected clock and external source mute',({tone,write,add,at})=>{
  tone(0,173,5);tone(2,257,3);write(0xe5);write(0xf8);add('stereo',0x96);
  at(701);add('clock',4000000);add('mute',5);at(1703);add('reset');at(2201);tone(1,257,4);tone(2,127,5);
  at(2801);add('mute',0);at(3301);add('stereo',0x81);at(3901);add('reset');at(4501);tone(0,113,6);at(5101);write(0xe7);write(0xf3);
});
scenario('independent four-channel source mute preserves oscillators LFSR stereo mask and clock phase',({tone,write,add,at})=>{
  tone(0,131,3);tone(1,257,5);tone(2,379,7);write(0xe7);write(0xf7);add('stereo',0xa5);
  for(const [frame,mask]of[[701,1],[1703,8],[2801,15],[3901,0],[5101,6]]){at(frame);add('mute',mask);}
});
scenario('reset and Stop do not revive silent voices until a new explicit volume or audition',({tone,write,add,at})=>{
  tone(0,113,4);tone(1,257,6);tone(2,449,8);write(0xe5);write(0xf7);add('stereo',0x69);
  at(701);add('stop');at(1703);tone(2,173,3);at(2801);add('reset');at(3901);add('audition',0);at(5101);tone(1,271,4);add('stereo',0x22);
});
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:'Actual deployed Sega PSG WASM running the shipped stereo-enabled Game Gear Worklet',
  wasmSha256:createHash('sha256').update(binary).digest('hex'),rates,cases:[],maximumDifference:0,totalStereoFrames:0,
  limits:'Offline standalone Sega PSG output only; fixture links solely the Game Gear wrapper and common SegaPSG synthesis, without any OPLL/Genesis source. Native IPC/ownership/UI verified separately. Source mutes use the real WASM channel mute API. Native Stop explicitly clears held PCM for immediate silence. State fixture checks 28-byte FFI layout, retained stereo/clock/periods/noise/levels, reset semantics, observational snapshots and zero callback allocations/frees. No real audio device or cross-platform compiler was used.'};
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-game-gear-'));fixture=path.join(temporary,'fixture');
    const files=[path.join(project,'src/native_genesis_game_gear.cpp'),path.join(project,'src/native_genesis_game_gear_fixture.cpp'),
      path.join(sdk,'vendor/tetorica_sega_psg/segapsg.cpp')];
    report.nativeSources=await Promise.all(files.map(async file=>({file:path.relative(root,file),
      sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')})));
    execFileSync('clang++',['-std=c++14','-O2','-I'+path.join(sdk,'vendor/tetorica_sega_psg'),'-I'+path.join(sdk,'vendor/ymfm'),...files,'-o',fixture],{stdio:'pipe'});}
  report.selfTest=execFileSync(fixture,['--self-test'],{encoding:'utf8'}).trim();
  for(const rate of rates)for(const scenario of scenarios){
    globalThis.sampleRate=rate;const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    const input=events.map(({frame,op,args})=>`${frame} ${op} ${args.join(' ')}`).join('\n')+'\n';
    const bytes=execFileSync(fixture,[String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*8+1048576,timeout:30000});
    assert.equal(bytes.length,scenario.frames*8);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
    const reference=new Processor({processorOptions:{wasmBinary:binary,clock:3579545,stereoEnabled:true}});await reference.testReady;
    let next=0,maximumDifference=0,peak=0,stereoDifference=0,first;const l=new Float32Array(1),r=new Float32Array(1);
    try{for(let frame=0;frame<scenario.frames;frame++){
      globalThis.currentFrame=frame;
      while(next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
        if(op==='write')reference.apply({method:'write',args},reference.port);
        else if(op==='stereo')reference.apply({method:'setStereo',args},reference.port);
        else if(op==='clock')reference.apply({method:'clock',args},reference.port);
        else if(op==='off')reference.apply({method:'write',args:[0x9f|(args[0]<<5)]},reference.port);
        else if(op==='audition')reference.apply({method:'write',args:[0x90|(args[0]<<5)|reference.inspector.lastVolumes[args[0]]]},reference.port);
        else if(op==='stop'){reference.stopVoices();if(reference.clockResampler)reference.clockResampler.left=reference.clockResampler.right=0;}
        else if(op==='reset')reference.apply({method:'reset'},reference.port);
        else if(op==='mute'){for(let ch=0;ch<4;ch++)reference.chip.setChannelMuted(ch,!!(args[0]&(1<<ch)));if(reference.clockResampler)reference.clockResampler.left=reference.clockResampler.right=0;}
        else throw Error(op);
      }
      reference.renderSegment(l,r);stereoDifference=Math.max(stereoDifference,Math.abs(actual[frame*2]-actual[frame*2+1]));
      for(let ch=0;ch<2;ch++){const value=actual[frame*2+ch],expected=ch?r[0]:l[0];assert(Number.isFinite(value));const difference=Math.abs(value-expected);
        if(difference&&!first)first={frame,ch,native:value,wasm:expected};maximumDifference=Math.max(maximumDifference,difference);peak=Math.max(peak,Math.abs(value));}
    }
    assert(maximumDifference<=1e-7,`${scenario.name} at ${rate}: difference ${maximumDifference}, ${JSON.stringify(first)}`);assert(peak>1e-4,scenario.name+' must sound');
    if(scenario.stereo)assert(stereoDifference>1e-4,scenario.name+' must exercise different left/right samples');
    report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference,peak,stereoDifference});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
    }finally{reference.dispose();}
  }
  report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`Native Game Gear: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum difference ${report.maximumDifference}`);console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
