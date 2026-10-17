// Real Playground Worker transport, settings, cancellation and cross-chip timing.
// Diagnostic tracing is injected while serving; production files are unchanged.
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const docs=path.resolve(__dirname,'../docs');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
function replace(source,anchor,body){assert(source.includes(anchor),'Diagnostic anchor changed: '+anchor);return source.replace(anchor,body);}
const server=http.createServer(async(request,response)=>{
 try{
  const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  let file=path.resolve(docs,'.'+pathname);if(!file.startsWith(docs+path.sep))throw Error('Invalid path');
  if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
  let body=await fs.readFile(file);
  if(pathname.endsWith('/playground.js'))body=Buffer.from(body.toString()+'\nwindow.__lookahead={runtime,megaDrive,get editor(){return editorAdapter;}};');
  if(pathname.endsWith('/playground_runtime.js')){
   const anchor='pcmDevices.add(device); chipInspector.notify(); return device;';
   body=Buffer.from(replace(body.toString(),anchor,`device.node.port.addEventListener('message',({data})=>{
    if(data.type==='lookahead-trace')(globalThis.__lookaheadDeviceTraces??=[]).push(data);
   });${anchor}`));
  }
  if(pathname.endsWith('/ym2612-worklet.js')){
   const anchor='  applyCommand(command, reply = message => this.port.postMessage(message), commandFrame = currentFrame, performance) {';
   body=Buffer.from(replace(body.toString(),anchor,anchor+`
    if(command.type==='lookahead-stats'){this.port.postMessage({type:'lookahead-stats',id:command.id,...this.performanceQueue.getStats()});return;}
    if((command.type==='write'&&command.register===0x28)||command.type==='audition-note-on'||command.type==='audition-note-off')
     this.port.postMessage({type:'lookahead-trace',chip:'fm',frame:commandFrame,command,performance});`));
  }
  if(pathname.endsWith('/native-fx-worklet.js')){
   const anchor='apply:(command,reply,_frame,performance)=>this.applyCommand(command,reply,performance),';
   body=Buffer.from(replace(body.toString(),anchor,`apply:(command,reply,_frame,performance)=>{
    this.port.postMessage({type:'lookahead-trace',chip:'fx',frame:_frame,command,performance});
    this.applyCommand(command,reply,performance);
   },`));
  }
  if(pathname.endsWith('/playground_performance_processor.js')){
   const anchor='if(note(command,port,metadata))apply(command,port,frame,metadata);';
   body=Buffer.from(replace(body.toString(),anchor,'if(note(command,port,metadata)){command._lookaheadFrame=frame;command._lookaheadPerformance=metadata;apply(command,port,frame,metadata);}'));
  }
  if(pathname.endsWith('/playground_nes_worklet.js')){
   const anchor='  apply(data, port) {';
   body=Buffer.from(replace(body.toString(),anchor,anchor+`
    if(data.method==='setChannelEnabled')this.port.postMessage({type:'lookahead-trace',chip:'nes',frame:data._lookaheadFrame??currentFrame,command:data,performance:data._lookaheadPerformance});`));
  }
  response.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');response.end(body);
 }catch(error){console.error('SERVE',request.url,error.message);response.writeHead(404).end(error.message);}
});
const source=`
fm.setPreset(CH1,FM_PRESETS['one-op-basic']);
const nes=await useSoundChip('nes');nes.pulse.setVoice(0,{duty:.5,volume:8});
await sample.play('alignment-hit',{gain:0});
liveFx('alignment',{context:{level:1},process(input,output,state,context){
 for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*context.level;
}});
liveLoop('alignment',async()=>{
 fm.noteOn(CH1,'E4');nes.pulse.noteOn(0,'E4');
 await sample.play('alignment-hit',{pan:-1});fx.updateContext('alignment',{level:.5});
 await sleep(.08);fm.noteOff(CH1);nes.pulse.noteOff(0);await sleep(.12);
});`;
const captureModule=`class LookaheadCapture extends AudioWorkletProcessor{
 constructor(){super();this.pcm=new Float32Array(Math.ceil(sampleRate*4));this.offset=0;this.first=null;
  this.port.onmessage=()=>{this.port.postMessage({pcm:this.pcm.slice(0,this.offset),first:this.first,rate:sampleRate});};}
 process(inputs){const data=inputs[0]?.[0];if(data&&this.offset+data.length<=this.pcm.length){if(this.first===null)this.first=currentFrame;this.pcm.set(data,this.offset);this.offset+=data.length;}return true;}
}registerProcessor('lookahead-capture',LookaheadCapture);`;
async function check(engine,name,url){
 const browser=await engine.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{} )});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'}),errors=[];
  page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
  // Protocol coverage is independent of the externally hosted editor. Exercise
  // the supported textarea fallback so both engines run without a CDN worker.
  await page.route('https://cdnjs.cloudflare.com/**',route=>route.abort());
  await page.goto(url);await page.waitForFunction(()=>window.__lookahead?.editor.kind==='textarea'&&!document.getElementById('runButton').disabled);
  assert.equal(await page.locator('#workerLookaheadMs').inputValue(),'150');
  assert.equal(await page.evaluate(()=>window.__lookahead.runtime.getTiming().workerLookaheadSeconds),.15);
  await page.locator('#mainMenu > summary').click();await page.locator('#workerLookaheadButton').click();
  await page.locator('#workerLookaheadMs').fill('0');await page.locator('#applyWorkerLookaheadButton').click();
  assert.equal(await page.evaluate(()=>window.__lookahead.runtime.getTiming().workerLookaheadSeconds),0);
  await page.reload();await page.waitForFunction(()=>window.__lookahead?.editor.kind==='textarea'&&!document.getElementById('runButton').disabled);
  assert.equal(await page.locator('#workerLookaheadMs').inputValue(),'0');
  await page.locator('#mainMenu > summary').click();await page.locator('#workerLookaheadButton').click();
  await page.locator('#workerLookaheadMs').fill('150');await page.locator('#applyWorkerLookaheadButton').click();
  await page.evaluate(()=>{document.getElementById('workerExecution').checked=false;window.__lookahead.editor.setValue('// Initialize audio.');});
  await page.click('#runButton');await page.waitForFunction(()=>window.__lookahead.megaDrive.node&&!document.getElementById('runButton').disabled);
  await page.evaluate(async captureModule=>{
   const p=window.__lookahead,c=p.megaDrive.audioContext;
   const pcm=c.createBuffer(1,Math.round(c.sampleRate*.01),c.sampleRate);pcm.getChannelData(0).fill(.15);p.megaDrive.audio.storeSample('alignment-hit',pcm);
   p.traces=[];const trace=({data})=>{if(data.type==='lookahead-trace')p.traces.push(data);};
   p.megaDrive.node.port.addEventListener('message',trace);p.megaDrive.audio.nativeFX.node.port.addEventListener('message',trace);
   const url=URL.createObjectURL(new Blob([captureModule],{type:'text/javascript'}));try{await c.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
   p.tap=new AudioWorkletNode(c,'lookahead-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
   p.detach=p.megaDrive.audio.connectOutputMonitor(p.tap);p.tap.connect(c.destination);
   p.stats=()=>new Promise(resolve=>{
    const id='stats:'+Math.random();const listener=({data})=>{if(data.type==='lookahead-stats'&&data.id===id){p.megaDrive.node.port.removeEventListener('message',listener);resolve(data);}};
    p.megaDrive.node.port.addEventListener('message',listener);p.megaDrive.node.port.postMessage({type:'lookahead-stats',id});
   });
  },captureModule);
  await page.evaluate(async source=>{const p=window.__lookahead;await p.runtime.playSource(source,{execution:'worker'});},source);
  await page.waitForTimeout(650);
  const first=await page.evaluate(async()=>({stats:await window.__lookahead.stats(),disabled:document.getElementById('workerLookaheadMs').disabled}));
  assert.equal(first.disabled,true,'lookahead is fixed while a performance is playing');assert(first.stats.activeSession>0);
  await page.click('#operatorTabButton');await page.locator('#operatorKeyboardRoot button').filter({hasText:'Ukulele'}).click();
  const key=await page.evaluate(()=>[...document.querySelectorAll('#operatorKeyboardRoot .key')].find(button=>button.querySelector('span')?.textContent==='A4')?.dataset.key);assert(key);
  await page.evaluate(()=>{window.__lookahead.keyboardBefore=window.__lookahead.megaDrive.audioContext.currentTime;});
  await page.keyboard.down(key);await page.waitForTimeout(40);await page.keyboard.up(key);
  const keyboard=await page.evaluate(()=>{const p=window.__lookahead,e=p.traces.find(event=>event.command.type==='audition-note-on');return {event:e,delay:e?e.frame/p.megaDrive.audioContext.sampleRate-p.keyboardBefore:null};});
  assert(keyboard.event,'real keyboard audition reached the Worklet');assert(keyboard.delay>=-.01&&keyboard.delay<.12,'keyboard must bypass 150 ms script lead: '+JSON.stringify(keyboard));
  await page.evaluate(async source=>window.__lookahead.runtime.playSource(source,{execution:'worker'}),source);
  await page.waitForTimeout(450);const hot=await page.evaluate(()=>window.__lookahead.stats());assert.equal(hot.activeSession,first.stats.activeSession,'hot Run preserves its clock');
  const result=await page.evaluate(async()=>{
   const p=window.__lookahead;await p.runtime.stop();await new Promise(resolve=>setTimeout(resolve,40));
   const stopped=await p.stats(),boundary=p.megaDrive.audioContext.currentTime;await new Promise(resolve=>setTimeout(resolve,230));
   const late=p.traces.filter(event=>event.performance&&event.frame/p.megaDrive.audioContext.sampleRate>boundary+.01);
   const captured=new Promise(resolve=>{p.tap.port.onmessage=({data})=>resolve(data);});p.tap.port.postMessage('end');const pcm=await captured;
   return {traces:p.traces,devices:window.__lookaheadDeviceTraces??[],stopped,late,pcm:Array.from(pcm.pcm),rate:pcm.rate,keyboardDelay: p.traces.find(event=>event.command.type==='audition-note-on').frame/pcm.rate-p.keyboardBefore};
  });
  assert.equal(result.stopped.activeSession,0);assert.equal(result.stopped.queuedCommands,0);assert.equal(result.late.length,0,'Stop leaves no future old-session notes');
  const loopNotes=result.traces.filter(event=>event.chip==='fm'&&event.performance&&event.performance.owner.startsWith('loop:')&&event.command.type==='write'&&(event.command.value&0xf0));
  const samples=result.traces.filter(event=>event.chip==='fx'&&event.performance&&event.performance.owner.startsWith('loop:')&&event.command.op==='sample'&&event.command.action==='startReserved');
  const contexts=result.traces.filter(event=>event.chip==='fx'&&event.performance&&event.performance.owner.startsWith('loop:')&&event.command.op==='live-fx'&&event.command.action==='context');
  const nes=result.devices.filter(event=>event.chip==='nes'&&event.performance&&event.command.method==='setChannelEnabled'&&event.command.args[1]);
  assert(loopNotes.length>=3&&samples.length>=3&&contexts.length>=3&&nes.length>=3,'all production sources must participate: '+JSON.stringify({fm:loopNotes.length,samples:samples.length,fx:contexts.length,nes:nes.length}));
  for(const event of [...loopNotes,...samples,...contexts,...nes])assert.equal(event.frame,Math.round(event.performance.time*result.rate),'applies on the declared absolute frame: '+JSON.stringify(event));
  for(const event of loopNotes.slice(0,3)){
   for(const events of [samples,contexts,nes]){
    const distance=Math.min(...events.filter(other=>other.performance.owner===event.performance.owner).map(other=>Math.abs(other.frame-event.frame)/result.rate));
    assert(distance<.04,'sample/FX/NES must share the FM lead rather than wait another 150 ms: '+distance);
   }
  }
  assert(result.pcm.every(Number.isFinite));assert(result.pcm.some(value=>Math.abs(value)>.001),'real final PCM is audible');
  await page.evaluate(async()=>{await window.__lookahead.runtime.playSource("fm.setPreset(CH1,FM_PRESETS['one-op-basic']);liveLoop('fresh',async()=>{await play('C4',{seconds:.02});await sleep(.2);});",{execution:'worker'});});
  const fresh=await page.evaluate(()=>window.__lookahead.stats());assert(fresh.activeSession>first.stats.activeSession,'Stop then Run uses a fresh session');
  await page.evaluate(async()=>{await window.__lookahead.runtime.stop();window.__lookahead.detach();window.__lookahead.tap.disconnect();});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,browser:name,defaultLeadMs:150,zeroSettingPersists:true,keyboardDelayMs:result.keyboardDelay*1000,fmNotes:loopNotes.length,sampleStarts:samples.length,fxChanges:contexts.length,nesStarts:nes.length,lateAfterStop:result.late.length,session:first.stats.activeSession,freshSession:fresh.activeSession}));
 }finally{await browser.close();}
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const url=`http://127.0.0.1:${server.address().port}/playground/index.html`;
  const engines=process.argv.includes('--webkit')?[[webkit,'webkit']]:process.argv.includes('--chromium')?[[chromium,'chromium']]:[[chromium,'chromium'],[webkit,'webkit']];
  for(const [engine,name]of engines)await check(engine,name,url);
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
