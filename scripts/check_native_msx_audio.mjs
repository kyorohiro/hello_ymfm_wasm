/** Native MSX Audio Y8950 against actual deployed WASM/Worklet, no device. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {OPLSynth,OPL_PRESETS} from '../web/opl_synth.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const sdk=path.join(project,'vendor/tetorica-soundchip-native');
const option=name=>{const i=process.argv.indexOf(name);assert(i<0||process.argv[i+1],`${name} needs a value`);return i<0?null:process.argv[i+1];};
const out=option('--out');let fixture=option('--fixture'),temporary;
const binary=await fs.readFile(path.join(root,'docs/generated/y8950_wasm.wasm'));
let Processor;globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.testReady=new Promise((resolve,reject)=>{this.port={postMessage:data=>{if(data.ready)resolve();else if(data.error)reject(new Error(data.error));},close(){}};});}};
globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-opl')Processor=processor;};
await import('../docs/js/playground_opl_worklet.js');
const rates=[44100,48000,96000],scenarios=[];
function scenario(name,build,{frames=6144}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
  const api=new OPLSynth({chip:'y8950',transport:{writeRegister:(reg,value)=>add('write',reg,value),reset:()=>add('reset')}});
  api.initialize();build({api,add,at:value=>{frame=value;}});scenarios.push({name,frames,events});
}
const note=(api,ch=0,midi=69,preset=OPL_PRESETS.organ)=>{api.setPreset(ch,preset);api.noteOn(ch,midi);};
scenario('all nine mono FM channels, both algorithms, ordinary key release and partial operators',({api,at})=>{
  for(let ch=0;ch<9;ch++)note(api,ch,45+ch*3,ch&1?OPL_PRESETS.bell:OPL_PRESETS.organ);
  at(701);api.setOperator(0,0,{tl:27,ksl:2,multi:7});at(1703);api.keyOff(0);at(2801);api.noteOn(0,76);
  at(3901);api.setAlgo(8,1,7);at(5101);api.keyOff(8);
});
for(let ch=0;ch<9;ch++)scenario(`independent sine voice ${ch} with pitch blocks and retained TL`,({api,at,add})=>{
  note(api,ch,48+ch*3,OPL_PRESETS.sine);at(701);api.setPitch(ch,1023,5);at(1703);api.setOperator(ch,1,{tl:19});
  at(2801);add('off',ch);at(3901);add('audition',ch);at(5101);api.keyOff(ch);
});
for(let algorithm=0;algorithm<2;algorithm++)for(let feedback=0;feedback<8;feedback++)scenario(`two-operator algorithm ${algorithm}, feedback ${feedback}, AM/vibrato/envelope edits`,({api,at})=>{
  note(api,0,69,{algorithm,feedback,operators:[{multi:3,tl:21,ar:15,dr:5,sl:7,rr:3,am:true,vibrato:true,sustain:true,ksr:true,ksl:1},{multi:1,tl:12,ar:15,dr:3,sl:9,rr:7,sustain:true,am:true,vibrato:true}]});
  at(701);api.setLFO({amDepth:true,pmDepth:true});at(1703);api.setOperator(0,0,{multi:9,tl:35,ksl:3});
  at(2801);api.setOperator(0,1,{sustain:false,ar:15,dr:12,sl:13,rr:15});at(3901);api.keyOff(0);at(5101);api.noteOn(0,81);
});
const drumNames=['bassDrum','snare','tom','cymbal','hiHat'];
for(let drum=0;drum<5;drum++)scenario(`rhythm ${drumNames[drum]} and shared physical channel gate release`,({api,at,add})=>{
  for(let ch=6;ch<9;ch++)note(api,ch,57+ch,OPL_PRESETS.organ);
  api.setRhythm({enabled:true,[drumNames[drum]]:true});at(701);api.setLFO({amDepth:true,pmDepth:true});
  at(1703);add('off',18+drum);at(2801);api.setRhythm({[drumNames[drum]]:true});
  at(3901);api.setOperator(6+(drum%3),1,{tl:19});at(5101);api.setRhythm({[drumNames[drum]]:false});
});
scenario('all five rhythm sources and melody/rhythm layout transitions',({api,at})=>{
  for(let ch=0;ch<9;ch++)note(api,ch,45+ch*3);
  at(701);api.setRhythm({enabled:true,bassDrum:true,snare:true,tom:true,cymbal:true,hiHat:true});
  at(1703);api.setRhythm({snare:false,hiHat:false});at(2801);api.setRhythm({enabled:false});
  for(let ch=6;ch<9;ch++)api.noteOn(ch,55+ch*2);at(3901);api.setRhythm({enabled:true,snare:true,cymbal:true});at(5101);api.setRhythm({enabled:false});
});
scenario('clock edits preserve integer source rate average/hold and all operator phases',({api,at,add})=>{
  note(api);note(api,8,76,OPL_PRESETS.bell);
  for(const [frame,clock]of[[701,4000000],[1703,100000],[2801,100000000],[3901,3546893],[5101,3579545]]){at(frame);add('clock',clock);}
});
scenario('Stop preserves authored TL pitch routing LFO and clock, then replay at slow source rate',({api,at,add})=>{
  note(api);note(api,8,76);api.setLFO({amDepth:true,pmDepth:true});at(701);add('off',0);api.setOperator(0,1,{tl:19});
  at(1703);api.noteOn(0,79);at(2801);add('clock',100000);add('stop');at(3901);add('audition',0);
  at(5101);add('off',0);add('clock',3579545);api.noteOn(0,79);
});
scenario('deferred preview retrigger and pending cancellation by force off Stop and reset',({api,at,add})=>{
  note(api,0,69,{algorithm:1,operators:[{multi:1,tl:9,ar:15,dr:15,sl:15,rr:15,sustain:false},{multi:1,tl:12,ar:15,dr:15,sl:15,rr:15,sustain:false}]});
  for(const frame of[701,1301,1901,2501]){at(frame);add('audition',0);}
  at(3301);add('audition',0);add('off',0);at(3901);add('audition',0);add('stop');
  at(4501);api.noteOn(0,76);add('audition',0);add('reset');at(5101);api.initialize();note(api,8,72);
});
scenario('all nine external source mute bits preserve oscillator envelope feedback and timer phases',({api,at,add})=>{
  for(let ch=0;ch<9;ch++)note(api,ch,48+ch*2,ch&1?OPL_PRESETS.bell:OPL_PRESETS.organ);
  for(const [frame,mask]of[[701,1],[1703,0x155],[2801,0x1ff],[3901,0],[5101,0xaa]]){at(frame);add('mute',mask);}
});
scenario('reset retains selected clock and requires explicit voices before subsequent audio',({api,at,add})=>{
  note(api);at(701);add('clock',4000000);at(1703);add('reset');at(2801);api.initialize();note(api,8,76);
  at(3901);add('reset');at(5101);api.initialize();note(api,0,60);
});
for(const control of[1,2,3,0x61,0x62,0x63])scenario(`timer A/B start mask ${control}, status IRQ and repeated reset flags`,({api,at})=>{
  note(api);api.writeRegister(2,255);api.writeRegister(3,253);api.writeRegister(4,control);
  at(701);api.writeRegister(4,128);at(1703);api.writeRegister(4,control);at(2801);api.writeRegister(4,128);
  at(3901);api.writeRegister(2,249);api.writeRegister(4,control);at(5101);api.writeRegister(4,0);
});
scenario('raw keyboard and I/O direction/data latches retain zero-input default bus reads',({api,at})=>{
  note(api);api.writeRegister(0x18,15);api.writeRegister(0x19,0xaa);at(701);api.writeRegister(6,0x55);
  at(1703);api.writeRegister(5,0xff);at(2801);api.writeRegister(0x18,3);api.writeRegister(0x19,0x55);
  at(3901);api.writeRegister(9,0);at(5101);api.writeRegister(0x1a,0);
});
scenario('raw Delta-T external empty RAM play repeat stop and reset retain WASM status flags',({api,at})=>{
  note(api);for(const [r,v]of[[8,0x80],[9,0],[10,0],[11,1],[12,0],[16,0xff],[17,0xff],[18,0xff]])api.writeRegister(r,v);
  api.writeRegister(7,0xa0);at(701);api.writeRegister(7,0xb0);at(1703);api.writeRegister(0x1a,0);
  at(2801);api.writeRegister(7,1);at(3901);api.writeRegister(7,0xa0);at(5101);api.writeRegister(4,128);
});
scenario('raw Delta-T CPU streaming data and record writes keep zero-memory compatibility without RAM API',({api,at})=>{
  note(api);for(const [r,v]of[[8,0x80],[9,0],[10,0],[11,1],[12,0],[16,0xff],[17,0xff],[18,0xd0]])api.writeRegister(r,v);
  api.writeRegister(7,0x80);for(let i=0;i<24;i++){at(53+i*173);api.writeRegister(15,(i*37)&255);}
  at(4501);api.writeRegister(7,0x60);api.writeRegister(15,0xaa);at(5101);api.writeRegister(7,1);
});
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:'Actual deployed Y8950 WASM running shipped OPL Worklet, including per-frame status/IRQ and four raw read ports',
  wasmSha256:createHash('sha256').update(binary).digest('hex'),rates,cases:[],maximumDifference:0,totalStereoFrames:0,
  limits:'Offline Y8950 selected core only; existing MSX AY/OPLL PCM was validated separately and Native combination/ownership/IPC/UI is verified independently. Empty ADPCM RAM/I/O default compatibility is preserved without adding a new public RAM/upload API. Per-frame readStatus/getIrq and raw ports0..3 follow the same order in both native and WASM. The 524-byte state ABI, retained settings, deferred preview cancellation and zero callback allocations/frees are also fixture-tested. No real audio device or cross-platform compiler was used.'};
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-msx-audio-'));fixture=path.join(temporary,'fixture');
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
    const bytes=execFileSync(fixture,['3',String(rate),String(scenario.frames),'--state-trace'],{input,maxBuffer:scenario.frames*32+1048576,timeout:30000});
    assert.equal(bytes.length,scenario.frames*32);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
    const reference=new Processor({processorOptions:{chip:'y8950',wasmBinary:binary}});await reference.testReady;
    let externalMute=0;const update=reference.updateMuteMask.bind(reference);
    reference.updateMuteMask=()=>{update();let mask=externalMute;for(const ch of reference.mutedChannels)mask|=1<<ch;reference.chip.setMuteMask(mask);};
    let next=0,maximumDifference=0,peak=0,first,statusTransitions=0,lastStatus;
    const l=new Float32Array(1),r=new Float32Array(1);
    try{for(let frame=0;frame<scenario.frames;frame++){
      globalThis.currentFrame=frame;
      while(next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
        if(op==='write')reference.apply({method:'writeRegister',args},reference.port);
        else if(op==='clock')reference.apply({method:'clock',args},reference.port);
        else if(op==='off'){reference.inspector.auditions.delete(args[0]);reference.apply({method:args[0]<18?'forceKeyOff':'forceRhythmOff',args:[args[0]<18?args[0]:args[0]-18]},reference.port);}
        else if(op==='audition'){reference.forceKeyOff(args[0]);reference.inspector.auditions.set(args[0],'fixture');reference.auditionStarts.set(args[0],'voice-editor:fixture');}
        else if(op==='stop')reference.apply({method:'stopVoices'},reference.port);
        else if(op==='reset')reference.apply({method:'reset'},reference.port);
        else if(op==='mute'){externalMute=args[0]&511;reference.updateMuteMask();reference.left=reference.right=0;}
        else throw Error(op);
      }
      reference.renderSegment(l,r);assert.equal(actual[frame*8],actual[frame*8+1]);
      const expected=[l[0],r[0],reference.chip.readStatus(),Number(reference.chip.getIrq()),...Array.from({length:4},(_,port)=>reference.chip.read(port))];
      if(expected[2]!==lastStatus){statusTransitions++;lastStatus=expected[2];}
      for(let ch=0;ch<8;ch++){const value=actual[frame*8+ch];assert(Number.isFinite(value));const difference=Math.abs(value-expected[ch]);
        if(difference&&!first)first={frame,ch,native:value,wasm:expected[ch]};maximumDifference=Math.max(maximumDifference,difference);if(ch<2)peak=Math.max(peak,Math.abs(value));}
    }
    assert(maximumDifference<=1e-7,`${scenario.name} at ${rate}: difference ${maximumDifference}, ${JSON.stringify(first)}`);assert(peak>1e-4,scenario.name+' must sound');
    report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference,peak,statusTransitions});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
    }finally{reference.dispose();}
  }
  report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`Native MSX Audio Y8950: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames with status/IRQ/read ports, maximum difference ${report.maximumDifference}`);console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
