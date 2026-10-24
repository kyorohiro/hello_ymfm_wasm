/** Actual Native primary/additional Y8950 ADPCM output versus deployed Worklet/WASM. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {OPLSynth,OPL_PRESETS} from '../web/opl_synth.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),native=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const out=arg('--out'),sanitize=process.argv.includes('--sanitize'),temp=await fs.mkdtemp(path.join(os.tmpdir(),'native-y8950-adpcm-')),fixture=path.join(temp,'fixture');
const flags=sanitize?['-O1','-g','-fsanitize=address,undefined','-fno-omit-frame-pointer']:['-O2'];
if(sanitize){process.env.ASAN_OPTIONS='detect_leaks=0';process.env.UBSAN_OPTIONS='halt_on_error=1:print_stacktrace=1';}
let Processor;globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.ready=new Promise((resolve,reject)=>{this.port={postMessage(m){if(m.ready)resolve();else if(m.error)reject(Error(m.error));},close(){}};});}};
globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-opl')Processor=processor;};
await import('../docs/js/playground_opl_worklet.js');
const binary=await fs.readFile(path.join(root,'docs/generated/y8950_wasm.wasm')),rates=[44100,48000,96000],cases=[];
const waveform=Uint8Array.from({length:8192},(_,i)=>[0x77,0x77,0xff,0xff][i%4]);
function scenario(name,build){let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args}),write=(r,v)=>add('write',r,v),at=n=>{frame=n;};
 const api=new OPLSynth({chip:'y8950',transport:{writeRegister:(r,v)=>write(r,v),reset:()=>add('reset')}});api.initialize();
 const fm=()=>{api.setPreset(0,OPL_PRESETS.organ);api.noteOn(0,69);};
 const load=(address=0,bytes=waveform)=>add('load',address,Buffer.from(bytes).toString('hex'));
 const start=({start=0,end=8192,delta=10546,repeat=true}={})=>{const first=start/32,last=end/32-1;for(const[r,v]of[[8,2],[9,first&255],[10,first>>8],[11,last&255],[12,last>>8],[16,delta&255],[17,delta>>8],[18,220],[7,repeat?0xb0:0xa0]])write(r,v);};
 build({add,write,at,api,fm,load,start});cases.push({name,events,frames:8192});}
for(const delta of[2048,10546,65535])scenario(`ADPCM-only mono, Delta-N ${delta}, ordinary reset and retrigger`,({load,start,write,at,add})=>{load();start({delta});at(1703);write(7,1);at(2801);start({delta,repeat:false});at(3901);add('reset');start({delta});at(6101);write(18,80);});
scenario('FM coexistence, upload stops only ADPCM and preserves unrelated bytes',({fm,load,start,at,write})=>{fm();load();start();at(701);load(4095,waveform.subarray(0,3));at(1703);start();at(2801);load(1,new Uint8Array([0x12,0x34]));at(3901);start({start:4096,end:8192});at(6101);write(7,1);});
scenario('clear stops ADPCM while FM phase continues, reset retains new memory',({fm,load,start,at,add})=>{fm();load();start();at(701);add('clear');at(1703);load(4096,waveform.subarray(0,4096));start({start:4096,end:8192});at(2801);add('reset');fm();start({start:4096,end:8192});at(6101);add('clear');});
scenario('last two 32-byte blocks in the 2 MiB RAM, gaps and small no-shrink patches',({load,start,at,write})=>{load(2097088,waveform.subarray(0,64));start({start:2097088,end:2097152});at(701);load(0,new Uint8Array([7]));at(1703);start({start:2097088,end:2097152});at(2801);load(2097151,new Uint8Array([0x77]));at(3901);start({start:2097088,end:2097152});at(6101);write(7,1);});
scenario('variable master clocks, low-clock holds, fast averaging and FM coexistence',({fm,load,start,at,add})=>{fm();load();start();for(const[f,hz]of[[701,100000],[1703,100000000],[2801,4000000],[3901,3579545],[6101,8000000]]){at(f);add('clock',hz);} });
scenario('CPU external RAM recording and a later partial upload preserve neighboring writes',({load,start,write,at})=>{load();for(const[r,v]of[[8,2],[9,0],[10,0],[11,255],[12,0],[7,0x60]])write(r,v);for(let i=0;i<64;i++)write(15,(i*53)&255);at(701);load(31,new Uint8Array([0x77,0xff]));at(1703);start();at(3901);write(7,0);at(6101);write(7,1);});
scenario('Stop silences FM and ADPCM, preserves RAM and allows later independent retrigger',({fm,load,start,at,add})=>{fm();load();start();at(701);add('stop');at(1703);start();at(2801);add('stop');at(3901);fm();start();at(6101);add('stop');});
const report={schemaVersion:1,deviceOpened:false,rates,cases:[],maximumDifference:0,totalStereoFrames:0,sanitizer:sanitize?'ASan+UBSan':'none',limits:'Real C++ primary/additional synthesis versus deployed Worklet/WASM. C++ fixture owns preallocated RAM to exercise page-pointer ABI and detects callback C++ new/delete. Production Rust page COW, writable boundary preservation, aggregate pending/applied/retiring budget, callback Rust allocations/frees and owner/lifecycle fences are separately tested by cargo tests. No physical device was opened.'};
try{
 execFileSync('clang++',['-std=c++14',...flags,...['native-genesis','native-master-system/snapshot/src'].map(p=>'-I'+path.join(native,p)),...['src/native_genesis_opl.cpp','src/native_genesis_extra_opl.cpp','src/native_genesis_y8950_memory_fixture.cpp','native-master-system/snapshot/src/ymfm_opl.cpp','native-master-system/snapshot/src/ymfm_pcm.cpp','native-genesis/ymfm_adpcm.cpp'].map(p=>path.join(native,p)),'-o',fixture],{stdio:'pipe'});
 for(const kind of['primary','extra'])for(const rate of rates)for(const scenario of cases){
  globalThis.sampleRate=rate;const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame),input=events.map(e=>`${e.frame} ${e.op} ${e.args.join(' ')}`).join('\n')+'\n';
  const bytes=execFileSync(fixture,[kind,String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*40+1048576});assert.equal(bytes.length,scenario.frames*40);const pcm=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
  const processor=new Processor({processorOptions:{chip:'y8950',wasmBinary:binary}});await processor.ready;
  let size=0,next=0,maximumDifference=0,peak=0,first;const left=new Float32Array(1),right=new Float32Array(1);
  try{for(let frame=0;frame<scenario.frames;frame++){
   globalThis.currentFrame=frame;while(next<events.length&&events[next].frame===frame){const{op,args}=events[next++];
    if(op==='write')processor.apply({method:'writeRegister',args},processor.port);
    else if(op==='clock')processor.apply({method:'clock',args},processor.port);
    else if(op==='reset')processor.apply({method:'reset'},processor.port);
    else if(op==='stop')processor.apply({method:'allNotesOff'},processor.port);
    else if(op==='load'){const data=new Uint8Array(Buffer.from(args[1],'hex'));processor.apply({method:'loadAdpcmMemory',args:[data,args[0]]},processor.port);size=Math.max(size,args[0]+data.length);}
    else if(op==='clear'){processor.apply({method:'clearAdpcmMemory',args:[]},processor.port);size=0;}else throw Error(op);
   }
   processor.renderSegment(left,right);
   const expected=[left[0],right[0],processor.chip.readStatus(),Number(processor.chip.getIrq()),...Array.from({length:4},(_,p)=>processor.chip.read(p)),size,processor.clock];
   for(let channel=0;channel<10;channel++){const actual=pcm[frame*10+channel],want=Math.fround(expected[channel]);assert(Number.isFinite(actual));const diff=Math.abs(actual-want);if(diff&&!first)first={frame,channel,actual,want};maximumDifference=Math.max(maximumDifference,diff);if(channel<2)peak=Math.max(peak,Math.abs(actual));}
  }
  assert(maximumDifference<=1e-7,`${kind} ${rate} ${scenario.name}: diff ${maximumDifference}, ${JSON.stringify(first)}`);assert(peak>1e-4,scenario.name+' must produce PCM');report.cases.push({kind,sampleRate:rate,name:scenario.name,frames:scenario.frames,maximumDifference,peak});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
  }finally{processor.dispose();}
 }
 report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(`Native Y8950 ADPCM: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum difference ${report.maximumDifference}`);
}finally{await fs.rm(temp,{recursive:true,force:true});}
