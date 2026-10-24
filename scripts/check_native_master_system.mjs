/** Native Master System versus the actual shipped PSG/OPLL WASM Worklets, offline. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {YM2413Synth,YM2413_USER_PRESETS} from '../web/ym2413synth.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const option=name=>{const i=process.argv.indexOf(name);assert(i<0||process.argv[i+1],`${name} needs a value`);return i<0?null:process.argv[i+1];};
const out=option('--out');let fixture=option('--fixture'),temporary;
const binaries=Object.fromEntries(await Promise.all(['segapsg','ym2413'].map(async name=>[name,await fs.readFile(path.join(root,`docs/generated/${name}_wasm.wasm`))])));
const processors=new Map();globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{
  constructor(){this.testReady=new Promise((resolve,reject)=>{this.port={postMessage:data=>{if(data.ready)resolve();else if(data.error)reject(new Error(data.error));},close(){}};});}
};
globalThis.registerProcessor=(name,processor)=>processors.set(name,processor);
await import('../docs/js/playground_segapsg_worklet.js');
await import('../docs/js/playground_ym2413_worklet.js');
const rates=[44100,48000,96000],scenarios=[];
function scenario(name,build,{frames=6144}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
  const synth=new YM2413Synth({transport:{writeRegister:(r,v)=>add('write',1,r,v),reset:()=>add('reset',1)}});
  const psg=value=>add('write',0,0,value),tone=(ch,period,level=5)=>{psg(0x80|(ch<<5)|(period&15));psg(period>>4);psg(0x90|(ch<<5)|level);};
  build({synth,add,at:value=>{frame=value;},psg,tone});scenarios.push({name,frames,events});
}
const fm=(synth,ch=0,note=69,instrument=1)=>{synth.setVoice(ch,{instrument,attenuation:3,sustain:false});synth.noteOn(ch,note);};
scenario('PSG three tones, data latch changes, zero/one period DC and mono output',({tone,psg,at})=>{
  tone(0,127,3);tone(1,211,5);tone(2,319,7);at(701);psg(0x81);psg(0);at(1703);psg(0xa0);psg(0);
  at(2801);psg(0xc7);psg(0x1b);at(3901);psg(0xb2);psg(9);at(5101);psg(0x9f);
});
for(let mode=0;mode<8;mode++)scenario(`PSG ${mode&4?'white':'periodic'} noise mode ${mode&3}, tone-3 coupling and noise data latch`,({tone,psg,at})=>{
  tone(2,71,15);psg(0xe0|mode);psg(0xf3);at(701);psg(0xc3);psg(4);at(1703);psg(0xe0|mode);psg(mode^4);
  at(2801);psg(0xf7);psg(2);at(3901);psg(0xe0|(mode^3));at(5101);psg(0xff);
});
scenario('PSG clock edits preserve original core counters, LFSR and fractional resampling phase',({tone,psg,add,at})=>{
  tone(0,71,6);tone(2,103,8);psg(0xe7);psg(0xf4);
  for(const [frame,clock]of[[701,4000000],[1703,100000],[2801,100000000],[3901,3546893],[5101,3579545]]){at(frame);add('clock',0,clock);}
});
scenario('PSG immediate Stop retains periods, noise mode and remembered attenuation without LFSR reset',({tone,psg,add,at})=>{
  tone(0,191,6);psg(0xe6);psg(0xf4);at(701);add('stop',0);at(1703);add('audition',0);add('audition',3);
  at(2801);add('off',3);at(3301);psg(0xf9);at(3901);add('stop',0);at(4501);add('audition',3);
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
  at(701);add('off',14);at(1703);add('off',16);at(2801);synth.setRhythmLevels({snare:8,hiHat:2});
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
  for(let frame=701;frame<3300;frame+=601){at(frame);add('audition',4);add('audition',12);}
  at(3301);add('audition',4);add('off',4);at(3901);add('audition',12);add('stop',1);
  at(4501);synth.noteOn(0,69);add('audition',4);add('reset',1);at(5101);fm(synth,3,72,1);
});
scenario('OPLL deferred rhythm preview, shared physical replacement and cancellation',({synth,add,at})=>{
  for(let ch=6;ch<9;ch++)synth.setNote(ch,60+ch);synth.setRhythmLevels({bassDrum:2,snare:3,tom:4,cymbal:5,hiHat:6});
  synth.setRhythm({enabled:true,bassDrum:true,snare:true,tom:true,cymbal:true,hiHat:true});
  at(701);add('off',14);add('off',17);add('audition',17);at(1703);add('off',15);add('off',16);add('audition',15);
  at(2801);add('audition',13);at(3901);add('audition',13);add('off',13);at(5101);add('audition',15);add('stop',1);
});
scenario('OPLL clock edits include source averaging, upsample holds and retained phase',({synth,add,at})=>{
  fm(synth);fm(synth,8,76,14);
  for(const [frame,clock]of[[701,4000000],[1703,100000],[2801,100000000],[3901,3546893],[5101,3579545]]){at(frame);add('clock',1,clock);}
});
scenario('independent PSG/OPLL channel mutes preserve internal phase and masked voices',({synth,tone,psg,add,at})=>{
  fm(synth);fm(synth,8,76,14);tone(0,131);tone(2,379);psg(0xe7);psg(0xf7);
  for(const [frame,a,b]of[[701,1,1],[1703,8,256],[2801,15,511],[3901,0,0]]){at(frame);add('mute',0,a);add('mute',1,b);}
  at(4501);synth.noteOn(8,80);at(5101);add('mute',1,256);at(5501);add('mute',1,0);
});
scenario('mixed PSG plus OPLL separate mono planes, independent reset Stop clocks and replay',({synth,tone,psg,add,at})=>{
  fm(synth);tone(0,173,5);psg(0xe5);psg(0xf8);at(701);add('clock',0,4000000);add('clock',1,8000000);
  at(1703);add('reset',0);at(2201);tone(1,257,4);at(2801);add('reset',1);at(3301);fm(synth,7,76,8);
  at(3901);add('stop',2);at(4501);add('audition',1);synth.noteOn(7,69);at(5101);add('reset',2);at(5501);tone(2,103,5);fm(synth,3,64,12);
});
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:'Actual deployed Sega PSG / YM2413 WASM running the shipped Worklet renderSegment and control implementation',
  wasmSha256:Object.fromEntries(Object.entries(binaries).map(([name,data])=>[name,createHash('sha256').update(data).digest('hex')])),rates,cases:[],maximumDifference:0,totalStereoFrames:0,
  limits:'Offline comparison of independent mono PSG and OPLL output planes. Native ownership/scheduling/IPC/UI verified separately. External channel mute calls the real WASM mute API and merges the Worklet force-mute mask. Native Stop explicitly clears held PSG PCM for immediate silence. The fixture asserts state/level retention, shared rhythm gates, deferred retriggers, cancellation and zero callback allocations/frees. No real audio device or cross-platform compiler was used.'};
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-master-system-'));fixture=path.join(temporary,'fixture');
    execFileSync('clang++',['-std=c++14','-O2',...['native-genesis','native-master-system/snapshot/src'].map(p=>'-I'+path.join(project,p)),
      ...['src/native_genesis_master_system.cpp','src/native_genesis_master_system_fixture.cpp','src/native_genesis_ymfm_opl.cpp','native-master-system/snapshot/src/ymfm_pcm.cpp','native-genesis/ymfm_adpcm.cpp','native-genesis/segapsg.cpp'].map(p=>path.join(project,p)),'-o',fixture],{stdio:'pipe'});}
  report.selfTest=execFileSync(fixture,['--self-test'],{encoding:'utf8'}).trim();
  for(const rate of rates)for(const scenario of scenarios){
    globalThis.sampleRate=rate;const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    const input=events.map(({frame,op,args})=>`${frame} ${op} ${args.join(' ')}`).join('\n')+'\n';
    const bytes=execFileSync(fixture,[String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*16+1048576,timeout:30000});
    assert.equal(bytes.length,scenario.frames*16);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
    const psg=new (processors.get('tetorica-segapsg'))({processorOptions:{wasmBinary:binaries.segapsg,clock:3579545,stereoEnabled:false}});
    const opll=new (processors.get('tetorica-ym2413'))({processorOptions:{wasmBinary:binaries.ym2413,clock:3579545}});
    await Promise.all([psg.testReady,opll.testReady]);let externalOpllMute=0;
    const updateMute=opll.updateMuteMask.bind(opll);opll.updateMuteMask=()=>{updateMute();opll.chip.setMuteMask(opll.chip.muteMask|externalOpllMute);};
    const forceOff=voice=>{
      if(voice<4)psg.apply({method:'write',args:[0x9f|(voice<<5)]},psg.port);
      else opll.apply({method:voice<13?'forceKeyOff':'forceRhythmOff',args:[voice<13?voice-4:voice-13]},opll.port);
    };
    const audition=voice=>{
      if(voice<4){psg.apply({method:'write',args:[0x90|(voice<<5)|psg.inspector.lastVolumes[voice]]},psg.port);return;}
      const key=voice<13?voice-4:`rhythm:${voice-13}`;forceOff(voice);
      opll.inspector.auditions.set(key,'fixture');opll.auditionStarts.set(key,'voice-editor:fixture');
    };
    let next=0,maximumDifference=0,peak=0,first;
    const pl=new Float32Array(1),pr=new Float32Array(1),fl=new Float32Array(1),fr=new Float32Array(1);
    try{for(let frame=0;frame<scenario.frames;frame++){
      globalThis.currentFrame=frame;
      while(next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
        if(op==='write'){const [chip,r,v]=args;if(chip)opll.apply({method:'writeRegister',args:[r,v]},opll.port);else psg.apply({method:'write',args:[v]},psg.port);}
        else if(op==='clock'){const target=args[0]?opll:psg;target.apply({method:'clock',args:[args[1]]},target.port);}
        else if(op==='off')forceOff(args[0]);else if(op==='audition')audition(args[0]);
        else if(op==='stop'){if(args[0]!==1){psg.stopVoices();if(psg.clockResampler)psg.clockResampler.left=psg.clockResampler.right=0;}if(args[0]!==0)opll.stopVoices();}
        else if(op==='reset'){if(args[0]!==1)psg.apply({method:'reset'},psg.port);if(args[0]!==0)opll.apply({method:'reset'},opll.port);}
        else if(op==='mute'){if(args[0]){externalOpllMute=args[1];opll.updateMuteMask();opll.left=opll.right=0;}else{for(let ch=0;ch<4;ch++)psg.chip.setChannelMuted(ch,!!(args[1]&(1<<ch)));if(psg.clockResampler)psg.clockResampler.left=psg.clockResampler.right=0;}}
        else throw Error(op);
      }
      psg.renderSegment(pl,pr);opll.renderSegment(fl,fr);const expected=[pl[0],pr[0],fl[0],fr[0]];
      assert.equal(actual[frame*4],actual[frame*4+1]);assert.equal(actual[frame*4+2],actual[frame*4+3]);
      for(let ch=0;ch<4;ch++){const value=actual[frame*4+ch];assert(Number.isFinite(value));const difference=Math.abs(value-expected[ch]);
        if(difference&&!first)first={frame,ch,native:value,wasm:expected[ch]};maximumDifference=Math.max(maximumDifference,difference);peak=Math.max(peak,Math.abs(value));}
    }
    assert(maximumDifference<=1e-7,`${scenario.name} at ${rate}: difference ${maximumDifference}, ${JSON.stringify(first)}`);assert(peak>1e-4,scenario.name+' must sound');
    report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference,peak});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
    }finally{psg.dispose();opll.dispose();}
  }
  report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`Native Master System: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frame pairs, maximum difference ${report.maximumDifference}`);console.log(report.selfTest);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
