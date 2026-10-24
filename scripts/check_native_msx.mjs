/** Native MSX versus the actual shipped AY/OPLL WASM Worklets, offline. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AY8910Synth} from '../web/ay8910synth.js';
import {YM2413Synth,YM2413_USER_PRESETS} from '../web/ym2413synth.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const option=name=>{const i=process.argv.indexOf(name);assert(i<0||process.argv[i+1],`${name} needs a value`);return i<0?null:process.argv[i+1];};
const out=option('--out');let fixture=option('--fixture'),temporary;
const binaries=Object.fromEntries(await Promise.all(['ay8910','ym2413'].map(async name=>[name,await fs.readFile(path.join(root,`docs/generated/${name}_wasm.wasm`))])));
const processors=new Map();globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{
  constructor(){this.testReady=new Promise((resolve,reject)=>{this.port={postMessage:data=>{if(data.ready)resolve();else if(data.error)reject(new Error(data.error));},close(){}};});}
};
globalThis.registerProcessor=(name,processor)=>processors.set(name,processor);
await import('../docs/js/playground_ay8910_worklet.js');
await import('../docs/js/playground_ym2413_worklet.js');
const rates=[44100,48000,96000],scenarios=[];
function scenario(name,build,{frames=6144}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
  const synth=new YM2413Synth({transport:{writeRegister:(r,v)=>add('write',1,r,v),reset:()=>add('reset',1)}});
  const ay=new AY8910Synth({transport:{writeRegister:(r,v)=>add('write',0,r,v),reset:()=>add('reset',0)}});
  const tone=(ch,period,volume=9)=>ay.tone(ch,{period,volume});
  build({synth,ay,add,at:value=>{frame=value;},tone});scenarios.push({name,frames,events});
}
const fm=(synth,ch=0,note=69,instrument=1)=>{synth.setVoice(ch,{instrument,attenuation:3,sustain:false});synth.noteOn(ch,note);};
scenario('AY all three tones, zero/one periods, ignored coarse bits and independent volumes',({ay,tone,at})=>{
  ay.writeRegister(7,0x38);tone(0,127,13);tone(1,233,11);tone(2,391,9);
  at(701);ay.writeRegister(0,0);ay.writeRegister(1,0xf0);at(1703);ay.setTonePeriod(1,1);
  at(2801);ay.setTonePeriod(2,4095);at(3901);ay.setVolume(0,3);at(5101);ay.setVolume(2,15);
});
scenario('AY shared noise all zero/one/31 periods, tone+noise combinations and mixer I/O direction bits',({ay,tone,at})=>{
  tone(0,127,13);tone(1,233,11);tone(2,391,9);ay.setNoisePeriod(0);ay.writeRegister(7,0);
  at(701);ay.setNoisePeriod(1);at(1703);ay.writeRegister(7,0x2a);at(2801);ay.setNoisePeriod(31);
  at(3901);ay.writeRegister(7,0xd5);at(5101);ay.writeRegister(7,0x38);
});
for(let shape=0;shape<16;shape++)scenario(`AY envelope shape ${shape}, all channels, period-only change and repeated-shape retrigger`,({ay,tone,at})=>{
  tone(0,127,15);tone(1,233,13);tone(2,391,11);for(let ch=0;ch<3;ch++)ay.setVolume(ch,15,true);
  ay.setEnvelope({period:23,shape});at(1703);ay.setEnvelope({period:53});at(3301);ay.setEnvelope({shape});
  at(5101);ay.setEnvelope({period:0,shape:shape^4});
});
scenario('AY all eight per-voice tone/noise gate combinations with exact zero-volume DC suppression',({ay,tone,at})=>{
  tone(0,127,15);tone(1,233,13);tone(2,391,11);ay.setNoisePeriod(13);
  for(let i=0;i<8;i++){at(i*701);ay.writeRegister(7,(i|(i<<3))^0x15);}
  at(5701);for(let ch=0;ch<3;ch++)ay.writeRegister(8+ch,0);
});
scenario('AY external channel mute preserves oscillator noise envelope counters',({ay,tone,at,add})=>{
  tone(0,127,13);tone(1,233,11);tone(2,391,9);ay.setEnvelope({period:31,shape:10});ay.setVolume(2,15,true);ay.setNoisePeriod(11);ay.writeRegister(7,0);
  for(const [frame,mask]of[[701,1],[1703,6],[2801,7],[3901,0],[5101,3]]){at(frame);add('mute',0,mask);}
});
scenario('AY clocks preserve base core and tone/noise/envelope phase through slow holds and fast averaging',({ay,tone,at,add})=>{
  tone(0,127,13);tone(1,233,11);tone(2,391,9);ay.setEnvelope({period:31,shape:10});ay.setVolume(2,15,true);ay.setNoisePeriod(11);ay.writeRegister(7,0);
  for(const [frame,clock]of[[701,2000000],[1703,100000],[2801,100000000],[3901,1773447],[5101,1789773]]){at(frame);add('clock',0,clock);}
});
scenario('AY Stop retains configured fixed/envelope levels and all shared source state; intentional zero retained',({ay,tone,at,add})=>{
  tone(0,127,13);tone(1,233,11);tone(2,391,9);ay.setEnvelope({period:31,shape:10});ay.setVolume(1,15,true);ay.setNoisePeriod(11);ay.writeRegister(7,0);
  at(701);add('clock',0,100000);at(1703);add('stop',0);at(2801);add('audition',0);add('audition',1);
  at(3901);add('off',0);add('retained',0,0);add('audition',0);at(5101);add('retained',0,9);add('audition',0);
});
scenario('AY raw I/O port latches, coarse masks, independent reset at retained clock and no hidden tone',({ay,tone,at,add})=>{
  tone(0,127,13);ay.writeRegister(14,0xaa);ay.writeRegister(15,0x55);ay.writeRegister(7,0xf8);
  at(701);ay.writeRegister(14,0x55);ay.writeRegister(15,0xaa);at(1703);add('clock',0,2000000);
  at(2801);add('reset',0);at(3901);tone(2,351,11);at(5101);ay.setEnvelope({period:31,shape:14});ay.setVolume(2,15,true);
});
scenario('mixed AY and OPLL independent mono planes, reset Stop source clocks and replay',({synth,ay,tone,at,add})=>{
  fm(synth);tone(0,173,11);ay.setNoisePeriod(17);ay.noise(2,{volume:7});at(701);add('clock',0,2000000);add('clock',1,8000000);
  at(1703);add('reset',0);at(2201);tone(1,257,13);at(2801);add('reset',1);at(3301);fm(synth,7,76,8);
  at(3901);add('stop',2);at(4501);add('audition',1);synth.noteOn(7,69);at(5101);add('reset',2);at(5501);tone(2,103,11);fm(synth,3,64,12);
});
scenario('OPLL all nine ROM voices, distinct pitches, sustain and mono melody bus',({synth,at})=>{
  for(let ch=0;ch<9;ch++)fm(synth,ch,48+ch*3,ch+1);
  at(701);synth.setVoice(0,{instrument:15,attenuation:1,sustain:true});at(1703);synth.setPitch(8,391,5);
  at(2801);synth.keyOff(4);at(3901);synth.noteOn(4,79);at(5101);synth.keyOff(8);
});
scenario('OPLL shared user patch, both operators, waveform feedback, vibrato AM and channel edits',({synth,at})=>{
  synth.setUserPatch(YM2413_USER_PRESETS.sine);for(let ch=0;ch<3;ch++)fm(synth,ch,57+ch*7,0);
  at(701);synth.setUserOperator(0,{am:true,vibrato:true,multi:5,tl:27,ksl:2});
  at(1703);synth.setUserOperator(1,{egt:false,ar:12,dr:4,sl:9,rr:6,waveform:1});
  at(2801);synth.setUserPatch({feedback:7,operators:[{waveform:1},{vibrato:true,ksr:true}]});
  at(3901);synth.setAttenuation(1,9);at(5101);synth.setSustain(2,true);
});
scenario('OPLL all five rhythm voices, shared SD/HH and TOM/CYM volume nibbles',({synth,at,add})=>{
  for(let ch=0;ch<6;ch++)fm(synth,ch,45+ch*4,ch+3);
  for(let ch=6;ch<9;ch++)synth.setNote(ch,48+(ch-6)*7);
  synth.setRhythmLevels({bassDrum:2,snare:3,tom:4,cymbal:5,hiHat:6});
  synth.setRhythm({enabled:true,bassDrum:true,snare:true,tom:true,cymbal:true,hiHat:true});
  at(701);add('off',13);at(1703);add('off',15);at(2801);synth.setRhythmLevels({snare:8,hiHat:2});
  at(3901);synth.setRhythm({snare:true,cymbal:true});at(5101);synth.setRhythm({bassDrum:false,tom:false});
});
scenario('OPLL rhythm layout switches restore authored ROM instruments and user patch volumes',({synth,at})=>{
  synth.setUserPatch(YM2413_USER_PRESETS.sine);for(let ch=6;ch<9;ch++)fm(synth,ch,60+ch*2,ch===7?0:ch+3);
  at(701);synth.setRhythm({enabled:true,bassDrum:true,hiHat:true,tom:true});at(1703);synth.setRhythm({enabled:false});
  for(let ch=6;ch<9;ch++)synth.noteOn(ch,55+ch);at(2801);synth.setRhythm({enabled:true,snare:true,cymbal:true});
  at(3901);synth.setRhythmLevels({snare:4,hiHat:1});at(5101);synth.setRhythm({enabled:false});synth.noteOn(8,77);
});
scenario('OPLL deferred manual melody retrigger and pending on cancellation by off Stop reset',({synth,add,at})=>{
  synth.setUserPatch({operators:[{multi:1,ar:15,dr:15,sl:15,rr:15},{multi:1,ar:15,dr:15,sl:15,rr:15}]});fm(synth,0,69,0);fm(synth,8,76,0);
  for(let frame=701;frame<3300;frame+=601){at(frame);add('audition',3);add('audition',11);}
  at(3301);add('audition',3);add('off',3);at(3901);add('audition',11);add('stop',1);
  at(4501);synth.noteOn(0,69);add('audition',3);add('reset',1);at(5101);fm(synth,3,72,1);
});
scenario('OPLL deferred rhythm preview, shared physical replacement and cancellation',({synth,add,at})=>{
  for(let ch=6;ch<9;ch++)synth.setNote(ch,60+ch);synth.setRhythmLevels({bassDrum:2,snare:3,tom:4,cymbal:5,hiHat:6});
  synth.setRhythm({enabled:true,bassDrum:true,snare:true,tom:true,cymbal:true,hiHat:true});
  at(701);add('off',13);add('off',16);add('audition',16);at(1703);add('off',14);add('off',15);add('audition',14);
  at(2801);add('audition',12);at(3901);add('audition',12);add('off',12);at(5101);add('audition',14);add('stop',1);
});
scenario('OPLL clock edits include source averaging, upsample holds and retained phase',({synth,add,at})=>{
  fm(synth);fm(synth,8,76,14);
  for(const [frame,clock]of[[701,4000000],[1703,100000],[2801,100000000],[3901,3546893],[5101,3579545]]){at(frame);add('clock',1,clock);}
});
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:'Actual deployed AY-3-8910 / YM2413 WASM running shipped Worklet renderSegment and controls',
  wasmSha256:Object.fromEntries(Object.entries(binaries).map(([name,data])=>[name,createHash('sha256').update(data).digest('hex')])),rates,cases:[],maximumDifference:0,totalStereoFrames:0,
  limits:'Offline comparison of independent mono AY and OPLL output planes. Native ownership/scheduling/IPC/UI verified separately. External mutes call real WASM mute APIs merged with volume-zero/force-mute masks. Native Stop clears held AY PCM for immediate silence. State fixture checks retained levels including intentionally zero, all pitch/noise/envelope/I/O state, shared rhythm, deferred retriggers and zero callback allocations/frees. No real audio device or cross-platform compiler was used.'};
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-msx-'));fixture=path.join(temporary,'fixture');
    execFileSync('clang++',['-std=c++14','-O2',...['native-genesis','native-master-system/snapshot/src','native-msx/snapshot/third_party/mame-ay8910'].map(p=>'-I'+path.join(project,p)),
      ...['src/native_genesis_msx.cpp','src/native_genesis_msx_fixture.cpp','src/native_genesis_ymfm_opl.cpp','native-master-system/snapshot/src/ymfm_pcm.cpp','native-genesis/ymfm_adpcm.cpp','native-msx/snapshot/third_party/mame-ay8910/ay8910.cpp'].map(p=>path.join(project,p)),'-o',fixture],{stdio:'pipe'});}
  report.selfTest=execFileSync(fixture,['--self-test'],{encoding:'utf8'}).trim();
  for(const rate of rates)for(const scenario of scenarios){
    globalThis.sampleRate=rate;const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    const input=events.map(({frame,op,args})=>`${frame} ${op} ${args.join(' ')}`).join('\n')+'\n';
    const bytes=execFileSync(fixture,[String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*16+1048576,timeout:30000});
    assert.equal(bytes.length,scenario.frames*16);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
    const ay=new (processors.get('tetorica-ay8910'))({processorOptions:{wasmBinary:binaries.ay8910,clock:1789773}});
    const opll=new (processors.get('tetorica-ym2413'))({processorOptions:{wasmBinary:binaries.ym2413,clock:3579545}});
    await Promise.all([ay.testReady,opll.testReady]);let externalOpllMute=0,externalAyMute=0;
    const updateAyMute=ay.updateMuteMask.bind(ay);ay.updateMuteMask=()=>{updateAyMute();let mask=externalAyMute;for(const ch of ay.mutedChannels)mask|=1<<ch;ay.chip.setMuteMask(mask);};
    const updateMute=opll.updateMuteMask.bind(opll);opll.updateMuteMask=()=>{updateMute();opll.chip.setMuteMask(opll.chip.muteMask|externalOpllMute);};
    const forceOff=voice=>{
      if(voice<3)ay.apply({method:'forceKeyOff',args:[voice]},ay.port);
      else opll.apply({method:voice<12?'forceKeyOff':'forceRhythmOff',args:[voice<12?voice-3:voice-12]},opll.port);
    };
    const audition=voice=>{
      if(voice<3){ay.apply({method:'writeRegister',args:[8+voice,ay.inspector.levels[voice]]},ay.port);return;}
      const key=voice<12?voice-3:`rhythm:${voice-12}`;forceOff(voice);
      opll.inspector.auditions.set(key,'fixture');opll.auditionStarts.set(key,'voice-editor:fixture');
    };
    let next=0,maximumDifference=0,peak=0,first;
    const pl=new Float32Array(1),pr=new Float32Array(1),fl=new Float32Array(1),fr=new Float32Array(1);
    try{for(let frame=0;frame<scenario.frames;frame++){
      globalThis.currentFrame=frame;
      while(next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
        if(op==='write'){const [chip,r,v]=args;if(chip)opll.apply({method:'writeRegister',args:[r,v]},opll.port);else ay.apply({method:'writeRegister',args:[r,v]},ay.port);}
        else if(op==='clock'){const target=args[0]?opll:ay;target.apply({method:'clock',args:[args[1]]},target.port);}
        else if(op==='retained')ay.apply({method:'setRetainedLevel',args},ay.port);
        else if(op==='off')forceOff(args[0]);else if(op==='audition')audition(args[0]);
        else if(op==='stop'){if(args[0]!==1){ay.stopVoices();ay.resampler.left=ay.resampler.right=0;}if(args[0]!==0)opll.stopVoices();}
        else if(op==='reset'){if(args[0]!==1)ay.apply({method:'reset'},ay.port);if(args[0]!==0)opll.apply({method:'reset'},opll.port);}
        else if(op==='mute'){if(args[0]){externalOpllMute=args[1];opll.updateMuteMask();opll.left=opll.right=0;}else{externalAyMute=args[1];ay.updateMuteMask();ay.resampler.left=ay.resampler.right=0;}}
        else throw Error(op);
      }
      ay.renderSegment(pl,pr);opll.renderSegment(fl,fr);const expected=[pl[0],pr[0],fl[0],fr[0]];
      assert.equal(actual[frame*4],actual[frame*4+1]);assert.equal(actual[frame*4+2],actual[frame*4+3]);
      for(let ch=0;ch<4;ch++){const value=actual[frame*4+ch];assert(Number.isFinite(value));const difference=Math.abs(value-expected[ch]);
        if(difference&&!first)first={frame,ch,native:value,wasm:expected[ch]};maximumDifference=Math.max(maximumDifference,difference);peak=Math.max(peak,Math.abs(value));}
    }
    assert(maximumDifference<=1e-7,`${scenario.name} at ${rate}: difference ${maximumDifference}, ${JSON.stringify(first)}`);assert(peak>1e-4,scenario.name+' must sound');
    report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference,peak});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
    }finally{ay.dispose();opll.dispose();}
  }
  report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`Native MSX: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frame pairs, maximum difference ${report.maximumDifference}`);console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
