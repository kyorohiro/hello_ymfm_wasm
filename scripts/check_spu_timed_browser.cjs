// Muted real AudioWorklet checks. No audio connection reaches speakers directly.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const root=path.resolve(process.env.SPU_TEST_ROOT||path.resolve(__dirname,'../docs')),synthOnly=process.env.SPU_TEST_SYNTH_ONLY==='1',engines=(process.env.SPU_TEST_ENGINES||'chromium,webkit').split(',');
const mime={'.js':'text/javascript','.wasm':'application/wasm','.json':'application/json'};
const server=http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/'){res.setHeader('Content-Type','text/html');res.end('<button id="start">start silent test</button>');return;}const file=path.resolve(root,'.'+name);assert(file.startsWith(root+path.sep));res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));}catch(e){res.writeHead(404).end(e.message);}});
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{
 for(const engine of engines){const browser=await({chromium,webkit}[engine]).launch({headless:true});try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.evaluate(synthOnly=>{
  window.__synthOnly=synthOnly;
  const connect=AudioNode.prototype.connect;window.__mutes=[];
  AudioNode.prototype.connect=function(target,...args){if(target!==this.context.destination)return connect.call(this,target,...args);const mute=this.context.createGain();mute.gain.value=0;window.__mutes.push(mute);connect.call(this,mute);connect.call(mute,target);return target;};
  document.querySelector('#start').onclick=()=>window.__result=(async()=>{
   const {createSpuAudio}=await import('/synth-spu/spu_synth_audio.js');
   const {createPlaygroundCodeRuntime}=await import('/js/playground_code_runtime.js');
   const audio=await createSpuAudio();await audio.resume();const client=await audio.getPs1Client();
   const runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>audio.context.currentTime,
    supportedSoundChips:['ps1'],useSoundChip:async()=>client,guardExecution:false});
   const source=pitch=>`const ps1=await useSoundChip('ps1');const phrase=ps1.build(b=>{b.setPitch(0,${pitch});b.keyOn(0);b.atSeconds(.02).noteOff(0);});await ps1.schedule(phrase,{name:'browser',repeatSeconds:.04});`;
   await runtime.run(source(800));await new Promise(r=>setTimeout(r,110));const first=await client.captureState();
   await runtime.apply(source(900));await new Promise(r=>setTimeout(r,90));const second=await client.captureState();
   let rejected=false;try{await runtime.apply(source(99999));}catch{rejected=true;}
   await new Promise(r=>setTimeout(r,70));const kept=await client.captureState();
   await runtime.stop();await client.setPitch(0,1234);await new Promise(r=>setTimeout(r,100));const stopped=await client.captureState();
   const compiled=await client.compile(client.build(b=>b.setPitch(0,100)),{initialState:first});
   const result={sampleRate:audio.context.sampleRate,first:first.state.channels[0].pitch,second:second.state.channels[0].pitch,
    kept:kept.state.channels[0].pitch,stopped:stopped.state.channels[0].pitch,rejected,compiled:compiled[0].value,muted:window.__mutes.length>0&&window.__mutes.every(m=>m.gain.value===0)};
   const flagsSource=`const ps1=await useSoundChip('ps1');const plan=ps1.build(b=>{b.setNoiseEnabled(23,true).setPmonEnabled(1,true).setNoiseClock(37);});await ps1.schedule(plan,{name:'flags',repeatSeconds:.03});`;
   await runtime.run(flagsSource);await new Promise(r=>setTimeout(r,80));const flags=await client.captureState();
   await client.setPreset(23,{volumeLeft:.1});await client.setReverb({preset:'room'});const afterEdit=await client.getState();
   let invalidFlag=false;try{await runtime.apply(`const ps1=await useSoundChip('ps1');await ps1.schedule(ps1.build(b=>b.setNoiseClock(64)),{name:'flags'});`);}catch{invalidFlag=true;}
   await runtime.stop();await audio.command('stop');const next=await audio.getPs1Client(),restored=await next.captureState();
   result.flags={noise:flags.state.registers[0x196/2]&128,pmon:flags.state.registers[0x190/2]&2,clock:(flags.state.registers[0x1aa/2]>>8)&63,
    observedNoise:afterEdit.channels[23].noise,observedPmon:afterEdit.channels[1].pmon,invalidFlag,
    restored:restored.state.registers[0x190/2]|restored.state.registers[0x192/2]|restored.state.registers[0x194/2]|restored.state.registers[0x196/2]};
   await audio.dispose();if(window.__synthOnly)return result;
   // Independent Main / logic-Worker clients over one Playground Worklet.
   const {createPs1Audio}=await import('/js/playground_ps1_audio.js');
   const {createPs1Client}=await import('/js/playground_ps1.js');
   const context=new AudioContext({sampleRate:44100});const endpoint=await createPs1Audio(context,context.destination);await context.resume();
   const main=createPs1Client(endpoint.port,endpoint),channel=new MessageChannel();endpoint.node.port.postMessage({type:'performance-start',session:1});await main.captureState();
   endpoint.node.port.postMessage({primaryWorker:true,port:channel.port1},[channel.port1]);
   const workerSource=`import {createPs1Client} from '${location.origin}/js/playground_ps1.js';import {createPerformanceSender} from '${location.origin}/js/playground_performance_sender.js';self.onmessage=async({data})=>{try{const sender=createPerformanceSender({now:()=>performance.now(),getLoop:()=>null});sender.configure({session:1,audioSeconds:data.audioSeconds,performanceEpochMs:performance.now(),lookaheadSeconds:.5});const chip=createPs1Client(sender.port(data.port,'independent'),data.initial);const base=await chip.captureState();const plan=chip.build(b=>b.setNoiseEnabled(23,true).setPmonEnabled(17,true).setNoiseClock(35).setPitch(1,4321).keyOn(1));await chip.schedule(plan,{name:'worker',repeatSeconds:.03});await new Promise(r=>setTimeout(r,750));const current=await chip.captureState();await chip.clearSchedule('worker');self.postMessage({pitch:current.state.channels[1].pitch,noise:current.state.registers[0x196/2]&128,pmon:current.state.registers[0x192/2]&2,clock:(current.state.registers[0x1aa/2]>>8)&63,instance:base.instanceId});}catch(e){self.postMessage({error:String(e.stack||e)});}};`;
   const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),worker=new Worker(url,{type:'module'});
   const workerResult=await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=reject;worker.postMessage({audioSeconds:context.currentTime,port:channel.port2,initial:{sampleRate:context.sampleRate,state:endpoint.state}},[channel.port2]);});
   const shared=await main.captureState();result.worker=workerResult;result.sharedInstance=shared.instanceId;result.mainRate=context.sampleRate;
   worker.terminate();URL.revokeObjectURL(url);main.dispose();endpoint.dispose();await context.close();return result;
  })();
 },synthOnly);
 await page.click('#start');const result=await page.evaluate(()=>window.__result);
 assert.equal(result.first,800);assert.equal(result.second,900);assert.equal(result.kept,900);assert.equal(result.stopped,1234);assert(result.rejected);assert(result.muted);assert.equal(result.compiled,100);
 assert.deepEqual(result.flags,{noise:128,pmon:2,clock:37,observedNoise:true,observedPmon:true,invalidFlag:true,restored:0});
 if(!synthOnly){assert.equal(result.worker.noise,128);assert.equal(result.worker.pmon,2);assert.equal(result.worker.clock,35);assert.equal(result.worker.error,undefined);assert.equal(result.worker.pitch,4321);assert.equal(result.worker.instance,result.sharedInstance);}assert.deepEqual(errors,[]);
 console.log(JSON.stringify({engine,...result}));
 }finally{await browser.close();}}
 }finally{await new Promise(resolve=>server.close(resolve));}})().catch(e=>{console.error(e);process.exitCode=1;});
