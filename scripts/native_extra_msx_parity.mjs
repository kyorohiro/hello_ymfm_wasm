/** Actual deployed additional Worklet parity. Shared only by two offline checks. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createYm2413RegisterClient} from '../web/playground_ym2413.js';
import {createAy8910RegisterClient} from '../web/playground_ay8910.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const sdk=path.join(project,'vendor/tetorica-soundchip-native');
export async function run(chip){
  const ay=chip==='ay8910',planes=ay?22:71,clock=ay?1789773:3579545;
  const option=name=>{const i=process.argv.indexOf(name);assert(i<0||process.argv[i+1],`${name} needs a value`);return i<0?null:process.argv[i+1];};
  const out=option('--out');let fixture=option('--fixture'),temporary;
  const binary=await fs.readFile(path.join(root,`docs/generated/${chip}_wasm.wasm`));
  let Processor,resolveReady,rejectReady;globalThis.sampleRate=48000;globalThis.currentFrame=0;
  globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(data){if(data.ready)resolveReady();if(data.error)rejectReady(Error(data.error));},close(){}};}};
  globalThis.registerProcessor=(name,processor)=>{if(name===`tetorica-${chip}`)Processor=processor;};
  await import(`../docs/js/playground_${chip}_worklet.js`);
  const rates=[44100,48000,96000],scenarios=[];
  function scenario(name,build,{frames=4096,initialize=true,allowSilent=false}={}){
    let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
    const synth=(ay?createAy8910RegisterClient:createYm2413RegisterClient)((method,args)=>{
      const op={writeRegister:'write',reset:'reset',setRetainedLevel:'retained'}[method];assert(op,method);add(op,...args);
    });
    if(initialize)synth.initialize();
    const voice=(ch=0,note=69,instrument=1)=>{if(ay)synth.tone(ch,{note,volume:12});else{synth.setVoice(ch,{instrument,attenuation:3});synth.setNote(ch,note);synth.keyOn(ch);}};
    build({synth,voice,add,write:(r,v)=>add('write',r,v),at:value=>{frame=value;}});scenarios.push({name,frames,events,allowSilent});
  }
  scenario('cold default creates no authored registers and exact silence',()=>{},{initialize:false,allowSilent:true});
  scenario('public initialize installs defaults and leaves exact silence',()=>{},{allowSilent:true});
  scenario('public initialize repeated during sound then note resumes',({synth,voice,at})=>{voice();at(701);synth.initialize();at(1703);voice(ay?2:8,72);at(2801);synth.initialize();at(3501);voice();});
  if(!ay){
    for(let ch=0;ch<9;ch++)for(let instrument=0;instrument<16;instrument++)scenario(`FM${ch} instrument${instrument}, sustain/pitch/key release`,({synth,voice,at})=>{
      voice(ch,48+ch*4,instrument);at(701);synth.setSustain(ch,true);at(1703);synth.setPitch(ch,253,5);at(2801);synth.keyOff(ch);at(3501);synth.keyOn(ch);
    });
    scenario('shared instrument0 patch edits affect all9 voices',({synth,voice,at})=>{
      for(let ch=0;ch<9;ch++)voice(ch,48+ch*4,0);
      at(701);synth.setUserPatch({feedback:7,operators:[{am:true,vibrato:true,multi:7,tl:23,ar:15,dr:5,sl:3,rr:9,waveform:1},{am:true,vibrato:true,egt:true,multi:2,ar:12,dr:8,sl:4,rr:12,waveform:1}]});
      at(1703);synth.setUserOperator(0,{multi:3,ksr:true,ksl:3});at(2801);synth.setUserOperator(1,{multi:5,ar:9,dr:13,rr:15});at(3501);synth.setUserPatch([0x21,0x21,0,7,0xff,0xff,0,0]);
    });
    scenario('all5 rhythm instruments with shared volume nibbles and mode transitions',({synth,voice,at})=>{
      for(let ch=0;ch<9;ch++)voice(ch,48+ch*3);at(701);synth.setRhythmLevels({bassDrum:2,snare:3,tom:4,cymbal:5,hiHat:6});synth.setRhythm({enabled:true,bassDrum:true,snare:true,tom:true,cymbal:true,hiHat:true});
      at(1703);synth.setRhythmLevel('snare',9);synth.setRhythmLevel('hiHat',1);synth.setRhythm({snare:false,cymbal:false});
      at(2801);synth.setRhythm({snare:true,cymbal:true,hiHat:false,tom:false});at(3501);synth.setRhythm({enabled:false});voice(7,76);voice(8,79);
    });
    for(let mask=0;mask<32;mask++)scenario(`rhythm key bits mask${mask}, all6 melody channels retained`,({synth,voice,write,at})=>{
      for(let ch=0;ch<6;ch++)voice(ch,48+ch*4);synth.setRhythmLevels({bassDrum:2,snare:3,tom:4,cymbal:5,hiHat:6});write(0x0e,32|mask);
      at(701);write(0x0e,32);at(1703);write(0x0e,63);at(2801);write(0x0e,32|mask);at(3501);write(0x0e,32);
    });
    scenario('ordinary OPLL preview consumes one source interval, simultaneous drums',({synth,voice,at,add})=>{
      voice(0,60);voice(5,67);synth.setRhythmLevels({bassDrum:2,snare:3,tom:4,cymbal:5,hiHat:6});synth.setRhythm({enabled:true,bassDrum:true,snare:true,tom:true,cymbal:true,hiHat:true});
      for(const frame of[701,1703,2801,3501]){at(frame);add('audition',0);add('audition',9);add('audition',10);add('audition',13);}
    });
  }else{
    for(let ch=0;ch<3;ch++)for(let mode=0;mode<4;mode++)scenario(`AY${ch} tone/noise mixer${mode} and all16fixed DAC levels`,({synth,write,at})=>{
      synth.setVoice(ch,{period:127+ch*83,tone:!!(mode&1),noise:!!(mode&2),volume:15});synth.setNoisePeriod(7);
      for(let volume=0;volume<16;volume++){at(volume*241);synth.setVolume(ch,volume);}at(3901);write(14,0xaa);write(15,0x55);
    });
    for(let shape=0;shape<16;shape++)scenario(`shared envelope shape${shape}, 3 independent mixer gates`,({synth,at})=>{
      for(let ch=0;ch<3;ch++)synth.setVoice(ch,{period:71+ch*97,tone:ch!==1,noise:ch!==0,volume:ch*4,envelope:true});synth.setNoisePeriod(5);synth.setEnvelope({period:3,shape});
      at(701);synth.setEnvelope({period:1});at(1703);synth.setEnvelope({period:41,shape:shape^6});at(2801);synth.setNoisePeriod(17);at(3501);synth.setEnvelope({period:0,shape});
    });
    scenario('tone/noise zero periods, widest periods and raw register masks',({write,at})=>{
      for(let ch=0;ch<3;ch++){write(ch*2,0);write(ch*2+1,0xf0);write(ch+8,0x8f);}write(7,0);write(6,0);write(11,0);write(12,0);write(13,0xff);
      at(701);write(0,255);write(1,255);at(1703);write(6,255);at(2801);write(7,0xff);at(3501);write(8,16);write(9,0x90);
    });
    scenario('explicit zero retained volume, keyOff metadata and envelope audition',({synth,voice,at,add})=>{
      voice(0,60);synth.setVolume(1,0);synth.keyOff(1);synth.keyOn(1);at(701);synth.keyOff(0);at(1703);synth.keyOn(0);
      at(2801);synth.setVoice(2,{noise:true,tone:false,volume:1,envelope:true});synth.setEnvelope({period:5,shape:10});at(3501);add('retained',2,0);add('audition',2);
    });
    scenario('shared noise all32periods and envelope retains foreign tones',({synth,voice,at})=>{
      voice(0,60);voice(1,67);synth.noise(2,{volume:13});for(let period=0;period<32;period++){at(period*113);synth.setNoisePeriod(period);}at(3801);synth.allNotesOff();
    });
  }
  scenario('clock full bounds preserves synthesis phases and raw gates',({synth,voice,add,at})=>{
    voice(0,60);voice(ay?2:5,67);for(const [frame,hz]of[[701,100000],[1703,100000000],[2801,clock],[3501,2000000]]){at(frame);add('clock',hz);}
  });
  scenario('reset restores full power-on noise LFO envelope and outer phase',({synth,voice,add,at})=>{
    voice(0,60);voice(ay?2:5,67);for(const frame of[701,1703,2801,3501]){at(frame);add('reset');voice(0,60);voice(ay?2:5,67);}
  });
  scenario('public allNotesOff retains patch and subsequent raw key-on resumes',({synth,voice,at})=>{voice(0,60);voice(ay?2:5,67);at(701);synth.allNotesOff();at(1703);synth.keyOn(0);at(2801);synth.allNotesOff();at(3501);synth.keyOn(ay?2:5);});
  scenario('public direct allNotesOff and preview keyOff keep low-clock resampler history',({voice,add,at})=>{
    voice(0,60,0);voice(ay?2:5,67,0);at(701);add('clock',100000);at(911);add('off',0);at(1703);add('all-off');
    at(2801);add('audition',0);at(3501);add('audition',ay?2:5);
  });
  const report={schemaVersion:1,deviceOpened:false,reference:`Actual deployed additional playground_${chip}_worklet.js plus ${chip} WASM`,wasmSha256:createHash('sha256').update(binary).digest('hex'),rates,cases:[],totalStereoFrames:0,maximumDifference:0,
    limits:'Offline standalone additional chip. Every output frame compares stereo PCM and authored register/clock/retained-level or status/IRQ/read-port snapshot. Native forced-release helpers additionally remove only cancelled voice contributions from held PCM; raw write/reset/profile parity is unchanged. Source-scoped cancellation, aliased rhythm cache isolation, and callback allocation/free are checked in C++. No machine-level sibling chips, audio devices or realtime deadline guarantee.'};
  try{
    if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-extra-msx-'));fixture=path.join(temporary,'fixture');
      const files=[path.join(sdk,'native/reference/tauri/native_genesis_ym2413.cpp'),path.join(project,'src/native_genesis_ay8910.cpp'),
        path.join(project,'src/native_genesis_extra_msx_fixture.cpp'),path.join(sdk,'native/src/ymfm_opl_provider.cpp'),
        path.join(sdk,'vendor/ymfm/ymfm_pcm.cpp'),path.join(sdk,'vendor/ymfm/ymfm_adpcm.cpp'),
        path.join(project,'native-msx/snapshot/third_party/mame-ay8910/ay8910.cpp')];
      report.nativeSources=await Promise.all(files.map(async file=>({file:path.relative(root,file),
        sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')})));
      execFileSync('clang++',['-std=c++14','-O2','-I'+path.join(sdk,'vendor/ymfm'),'-I'+path.join(sdk,'wasm'),
        ...['native-genesis','native-msx/snapshot/third_party/mame-ay8910'].map(p=>'-I'+path.join(project,p)),
        ...files,'-o',fixture],{stdio:'pipe'});}
    report.selfTest=execFileSync(fixture,['--self-test'],{encoding:'utf8'}).trim();
    for(const rate of rates)for(const scenario of scenarios){
      const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame),input=events.map(({frame,op,args})=>`${frame} ${op} ${args.join(' ')}`).join('\n')+'\n';
      const bytes=execFileSync(fixture,[chip,String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*planes*4+1048576,timeout:30000});assert.equal(bytes.length,scenario.frames*planes*4);
      const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
      globalThis.sampleRate=rate;const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});const reference=new Processor({processorOptions:{wasmBinary:binary}});await ready;
      let next=0,max=0,peak=0,first;const l=new Float32Array(1),r=new Float32Array(1);
      try{for(let frame=0;frame<scenario.frames;frame++){
        globalThis.currentFrame=frame;
        while(next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
          if(op==='write')reference.apply({method:'writeRegister',args},reference.port);
          else if(['clock','reset'].includes(op))reference.apply({method:op,args},reference.port);
          else if(op==='retained')reference.apply({method:'setRetainedLevel',args},reference.port);
          else if(op==='all-off'||op==='stop')reference.apply({method:'allNotesOff'},reference.port);
          else if(op==='off')reference.apply({method:ay||args[0]<9?'forceKeyOff':'forceRhythmOff',args:[ay||args[0]<9?args[0]:args[0]-9]},reference.port);
          else if(op==='audition'){
            if(ay)reference.apply({method:'writeRegister',args:[8+args[0],reference.inspector.levels[args[0]]]},reference.port);
            else{const voice=args[0],key=voice<9?voice:`rhythm:${voice-9}`,id='fixture'+voice,owner='voice-editor:'+id;
              reference.inspector.auditions.set(key,id);reference.apply({method:voice<9?'forceKeyOff':'forceRhythmOff',args:[voice<9?voice:voice-9]},reference.port);
              reference.apply({method:voice<9?'auditionKeyOn':'auditionRhythmOn',args:[voice<9?voice:voice-9]},reference.port,frame,{owner});}
          }else throw Error(op);
        }
        reference.process([],[[l,r]]);
        const expected=ay?[l[0],r[0],...reference.registers,...reference.inspector.levels,reference.clock]:[l[0],r[0],...reference.registers,reference.clock,reference.chip.readStatus(),Number(reference.chip.getIrq()),reference.chip.read(0),reference.chip.read(1)];
        for(let field=0;field<planes;field++){const value=actual[frame*planes+field];assert(Number.isFinite(value));const diff=Math.abs(value-Math.fround(expected[field]));if(diff&&!first)first={frame,field,native:value,wasm:expected[field]};max=Math.max(max,diff);if(field<2)peak=Math.max(peak,Math.abs(value));}
      }
      assert(max<=1e-7,`${scenario.name} at${rate}: diff${max}, ${JSON.stringify(first)}`);if(!scenario.allowSilent)assert(peak>1e-4,scenario.name+' must sound');
      report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference:max,peak});report.totalStereoFrames+=scenario.frames;report.maximumDifference=Math.max(report.maximumDifference,max);
      }finally{reference.dispose();}
    }
    report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(`Native additional${chip}:${report.cases.length} cases,${report.totalStereoFrames} stereo frames,maxdiff${report.maximumDifference}`);console.log(report.selfTest);
  }finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
}
