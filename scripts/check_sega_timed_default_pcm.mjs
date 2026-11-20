// Offline default-path PCM comparison. No AudioContext, callbacks or audio device.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {createSegaPsgApi} from '../tetorica_src/runtime/segapsg_api.js';
import {YM2413Synth} from '../tetorica_src/runtime/ym2413synth.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2), option=(name,fallback)=>args.find(x=>x.startsWith(name+'='))?.slice(name.length+1)??fallback;
const base=option('--base','24bbdeaf7eb03a44766f291d6998818213c18dc5');
const out=resolve(root,option('--out','build/sega-timed-promotion/default-pcm.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const saved=new Map(['AudioWorkletProcessor','registerProcessor','sampleRate','currentFrame'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
class Port {messages=[];postMessage(m){this.messages.push(m);}start(){}close(){}}
globalThis.AudioWorkletProcessor=class{constructor(){this.port=new Port();}};
const sources={},classes={};
try {
 for(const chip of ['segapsg','ym2413']){
  const path=`tetorica_src/runtime/playground_${chip}_worklet.js`,after=await readFile(resolve(root,path));
  const before=execFileSync('git',['show',`${base}:${path}`],{cwd:root,maxBuffer:4*1024*1024});
  sources[path]={before:{bytes:before.length,sha256:sha(before)},after:{bytes:after.length,sha256:sha(after)}};
  for(const [kind,bytes] of [['before',before],['after',after]]){
   let Type;globalThis.registerProcessor=(_name,type)=>{Type=type;};
   const text=bytes.toString().replace(/(from\s*["'])(\.[^"']+)(["'])/g,(_all,a,p,b)=>a+new URL(p,new URL('../'+path,import.meta.url)).href+b);
   await import('data:text/javascript;base64,'+Buffer.from(text+`\n// comparison ${chip} ${kind}\n`).toString('base64'));
   assert(Type,'Worklet registers its processor');classes[chip+':'+kind]=Type;
  }
 }
 const binaries=Object.fromEntries(await Promise.all(['segapsg','ym2413'].map(async chip=>[chip,new Uint8Array(await readFile(resolve(root,`docs/generated/${chip}_wasm.wasm`)))])));
 function scenarios(chip,clock){
  const scenes=[];
  if(chip==='segapsg'){
   for(const stereo of [255,0x96]){
    for(let ch=0;ch<3;ch++)scenes.push({name:`tone-${ch}-${stereo}`,setup:a=>{a.setStereo(stereo);a.tone(ch,{period:127+ch*91,attenuation:ch+2});},edit:a=>a.setFrequency(ch,330),release:a=>a.off(ch)});
    for(const type of ['white','periodic'])for(const rate of ['low','medium','high','tone3'])scenes.push({name:`noise-${type}-${rate}-${stereo}`,setup:a=>{a.setStereo(stereo);a.setPeriod(2,213);a.noise({type,rate,attenuation:4});},edit:a=>a.noiseVolume(0.4),release:a=>a.noiseOff()});
   }
  }else{
   for(let ch=0;ch<9;ch++)for(const instrument of [0,1,15])scenes.push({name:`voice-${ch}-${instrument}`,setup:a=>{a.setUserPatch({feedback:3,operators:[{multi:2,tl:18,ar:15,dr:5,sl:7,rr:5,egt:true},{multi:1,ar:15,dr:5,sl:6,rr:6,egt:true}]});a.setVoice(ch,{instrument,attenuation:4,sustain:false});a.noteOn(ch,48+ch);},edit:a=>{a.setAttenuation(ch,8);a.setUserOperator(0,{tl:8});a.setFrequency(ch,330);},release:a=>a.noteOff(ch)});
   const names=['bassDrum','snare','tom','cymbal','hiHat'];
   for(const mask of [1,2,4,8,16,9,6,31])scenes.push({name:`rhythm-${mask}`,setup:a=>{for(let ch=6;ch<9;ch++)a.setPitch(ch,150+ch*8,4);a.setRhythmLevels(Object.fromEntries(names.map(n=>[n,4])));a.setRhythm({enabled:true,...Object.fromEntries(names.map((n,i)=>[n,!!(mask&(16>>i))]))});},edit:a=>a.setRhythmLevel('snare',8),release:a=>a.setRhythm(Object.fromEntries(names.map(n=>[n,false])))});
  }
  return scenes.map(scene=>{
   const commands=[],send=cmd=>commands.push(cmd);
   const api=chip==='segapsg'?createSegaPsgApi({clock,write:v=>send({method:'write',args:[v]}),setStereo:v=>send({method:'setStereo',args:[v]})}):new YM2413Synth({clock,transport:{writeRegister:(r,v)=>send({method:'writeRegister',args:[r,v]})}});
   scene.setup(api);const start=commands.splice(0);scene.edit(api);const edit=commands.splice(0);scene.release(api);const release=commands.splice(0);
   return {name:scene.name,start,edit,release};
  });
 }
 const cases=[];let totalStereoFrames=0;
 for(const chip of ['segapsg','ym2413'])for(const rate of [22050,44100,48000,96000])for(const clock of [3579545,4000000]){
  globalThis.sampleRate=rate;globalThis.currentFrame=0;
  for(const scene of scenarios(chip,clock)){
   const processors=[];
   try{
    for(const kind of ['before','after']){
     const p=new classes[chip+':'+kind]({processorOptions:{clock,wasmBinary:binaries[chip],stereoEnabled:true}});processors.push(p);
     for(let tries=0;!p.port.messages.some(m=>m.ready);tries++){
      const failure=p.port.messages.find(m=>m.error);if(failure)throw Error(failure.error);
      assert(tries<1000,'offline chip initialized');await new Promise(r=>setTimeout(r,0));
     }
    }
    const hash=createHash('sha256');let frame=0,maximumDifference=0;
    const send=commands=>{for(const command of commands)for(const p of processors)p.receive(structuredClone(command),p.port);};
    send(scene.start);
    for(const [until,commands] of [[257,scene.edit],[1024,scene.release],[4096,[]]]){
     let block=0;while(frame<until){
      const size=Math.min([1,7,31,64,127,128][block++%6],until-frame);globalThis.currentFrame=frame;
      const data=processors.map(p=>{const left=new Float32Array(size),right=new Float32Array(size);assert.equal(p.process([],[[left,right]]),true);return{left,right};});
      for(const side of ['left','right']){
       for(let i=0;i<size;i++)maximumDifference=Math.max(maximumDifference,Math.abs(data[0][side][i]-data[1][side][i]));
       assert.deepEqual(data[1][side],data[0][side],`${chip}/${scene.name}/${rate}/${clock} PCM at ${frame}`);
       hash.update(Buffer.from(data[1][side].buffer));
      }
      frame+=size;
     }
     send(commands);
    }
    totalStereoFrames+=frame;cases.push({chip,rate,clock,scene:scene.name,frames:frame,maximumDifference,pcmSha256:hash.digest('hex')});
   }finally{for(const p of processors)p.dispose();}
  }
 }
 const report={schemaVersion:1,scope:'sega-timed-api-default-worklet-pcm',baseCommit:base,passed:true,physicalAudio:false,audioContextCreated:false,sources,cases,totalStereoFrames,maximumDifference:Math.max(...cases.map(c=>c.maximumDifference))};
 await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
 console.log(`Default Worklet PCM: ${cases.length} cases / ${totalStereoFrames} stereo frames, exact; ${out}`);
}finally{for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
