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
const option=name=>{const i=process.argv.indexOf(name);assert(i<0||process.argv[i+1],`${name} needs a value`);return i<0?null:process.argv[i+1];};
const out=option('--out');let fixture=option('--fixture'),temporary;
const profiles=['ym3526','ym3812','y8950','ymf262'],rates=[44100,48000,96000],scenarios=[];
const binaries=Object.fromEntries(await Promise.all(profiles.map(async name=>[name,await fs.readFile(path.join(root,`docs/generated/${name}_wasm.wasm`))])));
let Processor;globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.testReady=new Promise((resolve,reject)=>{this.port={postMessage:data=>{if(data.ready)resolve();else if(data.error)reject(new Error(data.error));},close(){}};});}};
globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-opl')Processor=processor;};
await import('../docs/js/playground_opl_worklet.js');
function scenario(chip,name,build,{frames=6144,initialize=true,allowSilent=false}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
  const api=new OPLSynth({chip,transport:{writeRegister:(reg,value,bank=0)=>add('write',(bank<<8)|reg,value),reset:()=>add('reset')}});
  if(initialize)api.initialize();build({api,add,at:value=>{frame=value;},chip});scenarios.push({chip,name,frames,events,allowSilent});
}
const note=(api,ch=0,midi=69,preset=OPL_PRESETS.organ)=>{api.setPreset(ch,preset);api.noteOn(ch,midi);};
for(const chip of profiles){
  scenario(chip,'all melodic physical voices, both algorithms and ordinary gate release',({api,at})=>{
    for(let ch=0;ch<api.channels;ch++)note(api,ch,45+ch*2,ch&1?OPL_PRESETS.bell:OPL_PRESETS.organ);
    at(701);api.setOperator(0,0,{tl:27,ksl:2,multi:7});at(1703);api.keyOff(0);
    at(2801);api.noteOn(0,76);at(3901);api.setAlgo(api.channels-1,1,7);at(5101);api.keyOff(api.channels-1);
  });
  const waves=chip==='ymf262'?8:chip==='ym3812'?4:1;
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
for(const chip of profiles){
  scenario(chip,'cold default silence with untouched authored state',()=>{},{initialize:false,allowSilent:true});
  scenario(chip,'public initialize silence defaults',()=>{},{allowSilent:true});
  for(let ch=0;ch<9;ch++)for(let algorithm=0;algorithm<2;algorithm++)scenario(chip,`FM${ch} algorithm${algorithm} feedback/operator register order`,({api,at})=>{
    note(api,ch,48+ch*3,OPL_PRESETS.organ);api.setAlgo(ch,algorithm,7);at(701);api.setOperator(ch,0,{multi:7,tl:31,ksl:3});at(1703);api.setOperator(ch,1,{waveform:chip==='ym3812'||chip==='ymf262'?3:0,sl:9,rr:12});at(2801);api.keyOff(ch);at(3901);api.keyOn(ch);at(5101);api.setFrequency(ch,440);
  });
  scenario(chip,'public allNotesOff retains release tails, timer/CSM and normal-key resume',({api,at,add})=>{
    for(let ch=0;ch<9;ch++)note(api,ch,48+ch*3,OPL_PRESETS.organ);api.writeRegister(2,255);api.writeRegister(8,128);api.writeRegister(4,1);
    at(701);add('public-off');at(1703);api.keyOn(0);at(2801);add('public-off');at(3901);api.keyOn(7);at(5101);api.writeRegister(4,128);
  });
  for(const mode of chip==='ymf262'?[]:[1,3,0x21,0x41])scenario(chip,`global CSM all9 timer control${mode} statusIRQ`,({api,at})=>{
    for(let ch=0;ch<9;ch++){note(api,ch,48+ch*3);api.keyOff(ch);}api.writeRegister(2,255);api.writeRegister(3,253);api.writeRegister(8,128);api.writeRegister(4,mode);
    at(701);api.writeRegister(4,128);at(1703);api.writeRegister(4,mode);at(2801);api.writeRegister(8,0);at(3901);api.writeRegister(8,128);at(5101);api.writeRegister(2,249);
  });
  scenario(chip,'power-on reset restores free-running LFO/rhythm phase exactly',({api,at})=>{
    for(const frame of[0,701,1703,2801,3901,5101]){at(frame);api.initialize();for(let ch=0;ch<9;ch++)note(api,ch,48+ch*3);api.setLFO({amDepth:true,pmDepth:true});api.setRhythm({enabled:true,snare:true,cymbal:true,hiHat:true});}
  });
  scenario(chip,'direct Worklet allNotesOff host silence preserves CSM behind gate',({api,at,add})=>{
    for(let ch=0;ch<9;ch++)note(api,ch,48+ch*3);api.writeRegister(2,255);api.writeRegister(8,128);api.writeRegister(4,1);at(701);add('all-off');at(1703);api.keyOn(0);at(2801);add('all-off');at(3901);api.keyOn(8);at(5101);api.writeRegister(8,0);
  });
  scenario(chip,'manual preview retains low-clock held mixed PCM until ordinary interval',({api,at,add})=>{
    note(api,0,60);note(api,5,67);at(701);add('clock',100000);at(911);add('off',0);at(1703);add('audition',0);at(2801);add('all-off');at(3901);add('audition',5);at(5101);add('off',0);add('off',5);add('clock',3579545);
  });
}
for(const control of[0x80,0x90,0xa0,0xb0])scenario('y8950',`raw ADPCM zero-memory and CPUdata control${control}`,({api,at})=>{
  note(api,0,60);api.writeRegister(8,0x0f);api.writeRegister(9,0);api.writeRegister(10,0);api.writeRegister(11,31);api.writeRegister(12,0);api.writeRegister(16,255);api.writeRegister(17,255);api.writeRegister(18,220);api.writeRegister(7,control);
  for(let i=1;i<20;i++){at(i*263);api.writeRegister(15,(i*53+17)&255);}at(5501);api.writeRegister(7,1);
});
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
  limits:'Offline selected YM3526/YM3812/YMF262 output comparison. Standalone additional native ownership/scheduling/IPC/UI verified separately. Reset restores captured power-on state without callback allocation; no PCM sample memory is provided. Worklet external mute merges authoring forced mute with real WASM mute API. Deferred manual previews use the shipped FM inspector semantics. Status/timer/IRQ retention and zero callback allocations/frees verified by the C++ fixture. No real audio device or cross-platform compiler was used.'};
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-opl-'));fixture=path.join(temporary,'fixture');
    execFileSync('clang++',['-std=c++14','-O2',...['native-genesis','native-master-system/snapshot/src'].map(p=>'-I'+path.join(project,p)),
      ...['src/native_genesis_extra_opl.cpp','src/native_genesis_extra_opl_fixture.cpp','src/native_genesis_ymfm_opl.cpp','native-master-system/snapshot/src/ymfm_pcm.cpp','native-genesis/ymfm_adpcm.cpp'].map(p=>path.join(project,p)),'-o',fixture],{stdio:'pipe'});}
  report.selfTest=execFileSync(fixture,['--self-test'],{encoding:'utf8'}).trim();
  for(const rate of rates)for(const scenario of scenarios){
    globalThis.sampleRate=rate;const planes=(scenario.chip==='ymf262'?512:256)+7;const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    const input=events.map(({frame,op,args})=>`${frame} ${op} ${args.join(' ')}`).join('\n')+'\n';
    const bytes=execFileSync(fixture,[String({ym3526:0,ym3812:1,ymf262:2,y8950:3}[scenario.chip]),String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*planes*4+1048576,timeout:30000});
    assert.equal(bytes.length,scenario.frames*planes*4);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
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
        }else if(op==='public-off'){if(scenario.chip==='y8950')reference.apply({method:'writeRegister',args:[7,1]},reference.port);for(let ch=0;ch<9;ch++)reference.apply({method:'writeRegister',args:[0xb0+ch,reference.registers[0xb0+ch]&~32]},reference.port);reference.apply({method:'writeRegister',args:[0xbd,reference.registers[0xbd]&224]},reference.port);}
        else if(op==='stop'||op==='all-off')reference.apply({method:'allNotesOff'},reference.port);
        else if(op==='reset')reference.apply({method:'reset'},reference.port);
        else if(op==='mute'){externalMute=args[0]&((1<<reference.channels)-1);reference.updateMuteMask();reference.left=reference.right=0;}
        else throw Error(op);
      }
      reference.renderSegment(l,r);
      const expected=[l[0],r[0],...reference.registers,reference.clock,reference.chip.readStatus(),Number(reference.chip.getIrq()),reference.chip.readStatus(),Number(reference.chip.getIrq())];
      for(let ch=0;ch<planes;ch++){const value=actual[frame*planes+ch],want=Math.fround(expected[ch]);assert(Number.isFinite(value));const difference=Math.abs(value-want);
        if(difference&&!first)first={frame,ch,native:value,wasm:want};maximumDifference=Math.max(maximumDifference,difference);if(ch<2)peak=Math.max(peak,Math.abs(value));}
    }
    assert(maximumDifference<=1e-7,`${scenario.chip} ${scenario.name} at ${rate}: difference ${maximumDifference}, ${JSON.stringify(first)}`);if(!scenario.allowSilent)assert(peak>1e-4,scenario.name+' must sound');
    report.cases.push({chip:scenario.chip,name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference,peak});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
    }finally{reference.dispose();}
  }
  report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`Native additional OPL: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum difference ${report.maximumDifference}`);console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
