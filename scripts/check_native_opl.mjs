/** Selected Native OPL core versus actual deployed OPL WASM Worklet; no device. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {OPLSynth, OPL_PRESETS} from '../web/opl_synth.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const sdk=path.join(project,'vendor/tetorica-soundchip-native');
const option=name=>{const i=process.argv.indexOf(name);assert(i<0||process.argv[i+1],`${name} needs a value`);return i<0?null:process.argv[i+1];};
const out=option('--out');let fixture=option('--fixture'),temporary;
const profiles=['ym3526','ym3812','ymf262'],rates=[44100,48000,96000],scenarios=[];
const binaries=Object.fromEntries(await Promise.all(profiles.map(async name=>[name,await fs.readFile(path.join(root,`docs/generated/${name}_wasm.wasm`))])));
let Processor;globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.testReady=new Promise((resolve,reject)=>{this.port={postMessage:data=>{if(data.ready)resolve();else if(data.error)reject(new Error(data.error));},close(){}};});}};
globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-opl')Processor=processor;};
await import('../docs/js/playground_opl_worklet.js');
function scenario(chip,name,build,{frames=6144}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
  const api=new OPLSynth({chip,transport:{writeRegister:(reg,value,bank=0)=>add('write',(bank<<8)|reg,value),reset:()=>add('reset')}});
  api.initialize();build({api,add,at:value=>{frame=value;},chip});scenarios.push({chip,name,frames,events});
}
const note=(api,ch=0,midi=69,preset=OPL_PRESETS.organ)=>{api.setPreset(ch,preset);api.noteOn(ch,midi);};
for(const chip of profiles){
  scenario(chip,'all melodic physical voices, both algorithms and ordinary gate release',({api,at})=>{
    for(let ch=0;ch<api.channels;ch++)note(api,ch,45+ch*2,ch&1?OPL_PRESETS.bell:OPL_PRESETS.organ);
    at(701);api.setOperator(0,0,{tl:27,ksl:2,multi:7});at(1703);api.keyOff(0);
    at(2801);api.noteOn(0,76);at(3901);api.setAlgo(api.channels-1,1,7);at(5101);api.keyOff(api.channels-1);
  });
  const waves=chip==='ym3526'?1:chip==='ym3812'?4:8;
  for(let wave=0;wave<waves;wave++)scenario(chip,`waveform ${wave}, both operators, TL/KSL/multiplier/envelope/vibrato/AM`,({api,at})=>{
    note(api);for(let op=0;op<2;op++)api.setOperator(0,op,{waveform:wave,am:true,vibrato:true,ksr:true,ksl:1,ar:13,dr:5,sl:7,rr:3,multi:op?1:3});
    at(701);api.setLFO({amDepth:true,pmDepth:true});at(1703);api.setOperator(0,0,{tl:35,ksl:3,multi:9});
    at(2801);api.setOperator(0,1,{sustain:false,ar:15,dr:12,sl:13,rr:15});at(3901);api.keyOff(0);at(5101);api.noteOn(0,81);
  });
  scenario(chip,'all five rhythm voices, shared physical channels and independent gate releases',({api,at,add})=>{
    for(let ch=6;ch<9;ch++)note(api,ch,57+ch,OPL_PRESETS.organ);
    api.setRhythm({enabled:true,bassDrum:true,snare:true,tom:true,cymbal:true,hiHat:true});
    at(701);add('off',19);at(1703);add('off',21);at(2801);api.setRhythm({snare:true,cymbal:true});
    at(3901);api.setLFO({amDepth:true,pmDepth:true});at(5101);api.setRhythm({bassDrum:false,tom:false});
  });
  scenario(chip,'rhythm layout changes retain operators and release old melodic ownership',({api,at})=>{
    for(let ch=6;ch<9;ch++)note(api,ch,57+ch,OPL_PRESETS.organ);
    at(701);api.setRhythm({enabled:true,bassDrum:true,tom:true,hiHat:true});at(1703);api.setRhythm({enabled:false});
    for(let ch=6;ch<9;ch++)api.noteOn(ch,45+ch*2);at(2801);api.setRhythm({enabled:true,snare:true,cymbal:true});
    at(3901);api.setRhythm({enabled:false});api.noteOn(7,77);at(5101);api.setOperator(7,1,{tl:19});
  });
  scenario(chip,'clock edits preserve source phase through slow holds and fast sample averaging',({api,at,add})=>{
    note(api);note(api,api.channels-1,76,OPL_PRESETS.bell);
    for(const [frame,clock]of[[701,4000000],[1703,100000],[2801,100000000],[3901,3546893],[5101,chip==='ymf262'?14318180:3579545]]){at(frame);add('clock',clock);}
  });
  scenario(chip,'forced off and Stop preserve authored TL routing rhythm LFO and clock settings',({api,at,add})=>{
    note(api);note(api,api.channels-1,76);api.setLFO({amDepth:true,pmDepth:true});
    at(701);add('off',0);api.setOperator(0,1,{tl:19});at(1703);api.noteOn(0,79);
    at(2801);add('clock',100000);add('stop');at(3901);add('audition',0);at(5101);add('off',0);add('clock',chip==='ymf262'?14318180:3579545);api.noteOn(0,79);
  });
  scenario(chip,'deferred same-frame preview retrigger and cancellation by force off Stop reset',({api,at,add})=>{
    note(api,0,69,{algorithm:1,operators:[{multi:1,tl:9,ar:15,dr:15,sl:15,rr:15,sustain:false},{multi:1,tl:12,ar:15,dr:15,sl:15,rr:15,sustain:false}]});
    for(const frame of[701,1301,1901,2501]){at(frame);add('audition',0);}
    at(3301);add('audition',0);add('off',0);at(3901);add('audition',0);add('stop');
    at(4501);api.noteOn(0,76);add('audition',0);add('reset');at(5101);api.initialize();note(api,api.channels-1,72);
  });
  scenario(chip,'external mute masks preserve operator oscillator envelope and source clocks',({api,at,add})=>{
    for(let ch=0;ch<api.channels;ch++)note(api,ch,48+ch*2,ch&1?OPL_PRESETS.bell:OPL_PRESETS.organ);
    for(const [frame,mask]of[[701,1],[1703,0x15555],[2801,0x3ffff],[3901,0],[5101,0x2aaaa]]){at(frame);add('mute',mask);}
  });
  scenario(chip,'independent resets, retained clock and subsequent initialization',({api,at,add})=>{
    note(api);at(701);add('clock',4000000);at(1703);add('reset');at(2801);api.initialize();note(api,api.channels-1,76);
    at(3901);add('reset');at(5101);api.initialize();note(api,0,60);
  });
  scenario(chip,'timer A B expiration status and reset flags during melodic synthesis',({api,at})=>{
    note(api);api.writeRegister(2,255);api.writeRegister(3,253);api.writeRegister(4,3);
    at(701);api.writeRegister(4,128);at(1703);api.writeRegister(4,0x63);at(2801);api.writeRegister(4,128);
    at(3901);api.writeRegister(2,249);api.writeRegister(4,1);at(5101);api.writeRegister(4,0);
  });
}
for(const primary of[0,1,2,9,10,11])for(let algorithm=0;algorithm<4;algorithm++)scenario('ymf262',`four-operator pair ${primary}+${primary+3}, algorithm ${algorithm}, feedback and pan`,({api,at,add})=>{
  note(api,primary,57+primary,{fourOp:true,algorithm,feedback:5,pan:{left:true,right:true},operators:Array.from({length:4},(_,i)=>({multi:i+1,tl:12+i*5,ar:15,dr:4,sl:6,rr:8,sustain:true,waveform:i}))});
  at(701);api.setPan(primary,true,false);at(1703);api.setPan(primary,false,true);
  at(2801);api.setOperator(primary,2,{multi:7,tl:19,waveform:7});at(3901);add('off',primary);at(5101);add('audition',primary);
});
scenario('ymf262','all four OPL3 hardware buses fold A+C left B+D right with per-bus saturation',({api,at})=>{
  for(let ch=0;ch<18;ch++)note(api,ch,40+ch*3,OPL_PRESETS.organ);
  for(const [frame,value]of[[701,0x10],[1703,0x20],[2801,0x40],[3901,0x80],[5101,0xf0]]){at(frame);for(let ch=0;ch<18;ch++)api.writeRegister((ch>=9?256:0)+0xc0+ch%9,value|1);}
});
scenario('ymf262','pair maps and OPL3 compatibility routing change without hidden secondary gates',({api,at})=>{
  for(const ch of[0,1,2,9,10,11])note(api,ch,45+ch,{...OPL_PRESETS['four-op-bell']});
  at(701);api.setFourOp(0,false);note(api,3,77);at(1703);api.setFourOp(9,false);note(api,12,81);
  at(2801);api.writeRegister(0x105,0);at(3901);api.writeRegister(0x105,1);at(5101);api.setFourOp(0,true);api.noteOn(0,69);
});
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:'Actual deployed OPL WASM running shipped Worklet renderSegment and controls',
  wasmSha256:Object.fromEntries(Object.entries(binaries).map(([name,data])=>[name,createHash('sha256').update(data).digest('hex')])),rates,cases:[],maximumDifference:0,totalStereoFrames:0,
  limits:'Offline selected YM3526/YM3812/YMF262 output comparison. Native ownership/scheduling/IPC/UI verified separately. Worklet external mute merges authoring forced mute with real WASM mute API. Deferred manual previews use the shipped FM inspector semantics. Status/timer/IRQ retention and zero callback allocations/frees verified by the C++ fixture. No real audio device or cross-platform compiler was used.'};
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-opl-'));fixture=path.join(temporary,'fixture');
    const files=[path.join(sdk,'native/reference/tauri/native_genesis_opl.cpp'),path.join(project,'src/native_genesis_opl_fixture.cpp'),
      path.join(sdk,'native/src/ymfm_opl_provider.cpp'),path.join(sdk,'vendor/ymfm/ymfm_pcm.cpp'),path.join(sdk,'vendor/ymfm/ymfm_adpcm.cpp')];
    report.nativeSources=await Promise.all(files.map(async file=>({file:path.relative(root,file),
      sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')})));
    execFileSync('clang++',['-std=c++14','-O2','-I'+path.join(sdk,'vendor/ymfm'),'-I'+path.join(sdk,'wasm'),
      '-I'+path.join(project,'native-genesis'),...files,'-o',fixture],{stdio:'pipe'});}
  report.selfTest=execFileSync(fixture,['--self-test'],{encoding:'utf8'}).trim();
  for(const rate of rates)for(const scenario of scenarios){
    globalThis.sampleRate=rate;const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    const input=events.map(({frame,op,args})=>`${frame} ${op} ${args.join(' ')}`).join('\n')+'\n';
    const bytes=execFileSync(fixture,[String(profiles.indexOf(scenario.chip)),String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*8+1048576,timeout:30000});
    assert.equal(bytes.length,scenario.frames*8);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
    const reference=new Processor({processorOptions:{chip:scenario.chip,wasmBinary:binaries[scenario.chip]}});await reference.testReady;
    let externalMute=0;const update=reference.updateMuteMask.bind(reference);
    reference.updateMuteMask=()=>{update();let mask=externalMute;for(const ch of reference.mutedChannels)mask|=1<<ch;reference.chip.setMuteMask(mask);};
    let next=0,maximumDifference=0,peak=0,first;const l=new Float32Array(1),r=new Float32Array(1);
    try{for(let frame=0;frame<scenario.frames;frame++){
      globalThis.currentFrame=frame;
      while(next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
        if(op==='write')reference.apply({method:'writeRegister',args},reference.port);
        else if(op==='clock')reference.apply({method:'clock',args},reference.port);
        else if(op==='off'){reference.inspector.auditions.delete(args[0]);reference.apply({method:args[0]<18?'forceKeyOff':'forceRhythmOff',args:[args[0]<18?args[0]:args[0]-18]},reference.port);}
        else if(op==='audition'){
          assert(args[0]<18);reference.forceKeyOff(args[0]);reference.inspector.auditions.set(args[0],'fixture');reference.auditionStarts.set(args[0],'voice-editor:fixture');
        }else if(op==='stop')reference.apply({method:'stopVoices'},reference.port);
        else if(op==='reset')reference.apply({method:'reset'},reference.port);
        else if(op==='mute'){externalMute=args[0]&((1<<reference.channels)-1);reference.updateMuteMask();reference.left=reference.right=0;}
        else throw Error(op);
      }
      reference.renderSegment(l,r);if(scenario.chip!=='ymf262')assert.equal(actual[frame*2],actual[frame*2+1]);
      for(let ch=0;ch<2;ch++){const value=actual[frame*2+ch],expected=ch?r[0]:l[0];assert(Number.isFinite(value));const difference=Math.abs(value-expected);
        if(difference&&!first)first={frame,ch,native:value,wasm:expected};maximumDifference=Math.max(maximumDifference,difference);peak=Math.max(peak,Math.abs(value));}
    }
    assert(maximumDifference<=1e-7,`${scenario.chip} ${scenario.name} at ${rate}: difference ${maximumDifference}, ${JSON.stringify(first)}`);assert(peak>1e-4,scenario.name+' must sound');
    report.cases.push({chip:scenario.chip,name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference,peak});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
    }finally{reference.dispose();}
  }
  report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`Native DOS OPL: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum difference ${report.maximumDifference}`);console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
