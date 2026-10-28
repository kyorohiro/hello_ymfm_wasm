// Public PS1 Playground UI -> real SPU AudioWorklet, including the actual Run ZIP.
// Capture before a permanently zeroed destination; no physical audio is played.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const config={host:null,zip:null,out:null,screenshots:null,engines:[]};
const usage='Usage: node scripts/check_playground_ps1_browser.cjs [--chromium-only | --webkit-only] [--host DIR | --zip ARCHIVE] [--out REPORT.json] [--screenshots DIR]';
for(let i=2;i<process.argv.length;i++){
  const arg=process.argv[i];
  if(arg==='--help'){console.log(usage);process.exit(0);}
  if(['--chromium-only','--webkit-only'].includes(arg)){config.engines.push(arg.slice(2,-5));continue;}
  const match=arg.match(/^--(host|zip|out|screenshots)(?:=(.*))?$/);assert(match,usage);
  const value=match[2]??process.argv[++i];assert(value&&!value.startsWith('--'),usage);config[match[1]]=path.resolve(value);
}
assert(!(config.host&&config.zip),'Choose --host or --zip');
assert(config.engines.length<=1,'Choose one browser flag or neither for both');
if(!config.engines.length)config.engines=['chromium','webkit'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),served=new Map();
const root='#ps1Panel',control=name=>`${root} [data-chip-control="ps1-${name}"]`,action=name=>`${root} [data-chip-action="ps1-${name}"]`;
const captureSource=`class Ps1Capture extends AudioWorkletProcessor {
 constructor(){super();this.pending=null;this.port.onmessage=({data})=>{if(this.pending)throw Error('Concurrent SPU capture');this.pending={id:data.id,left:new Float32Array(data.frames),right:new Float32Array(data.frames),offset:0,firstFrame:null,lastFrame:null,frameGaps:0,quantumFrames:[]};};}
 process(inputs,outputs){for(const channel of outputs[0])channel.fill(0);const p=this.pending;if(!p)return true;
  if(p.firstFrame===null)p.firstFrame=currentFrame;if(currentFrame!==p.firstFrame+p.offset)p.frameGaps++;p.lastFrame=currentFrame;
  const quantum=outputs[0][0].length;if(!p.quantumFrames.includes(quantum))p.quantumFrames.push(quantum);
  const count=Math.min(quantum,p.left.length-p.offset),input=inputs[0];for(let i=0;i<count;i++){p.left[p.offset+i]=input[0]?.[i]??0;p.right[p.offset+i]=input[1]?.[i]??input[0]?.[i]??0;}p.offset+=count;
  if(p.offset===p.left.length){this.pending=null;this.port.postMessage(p,[p.left.buffer,p.right.buffer]);}return true;
 }
}registerProcessor('ps1-playground-capture',Ps1Capture);`;

async function selectHost(){
  let temporary=null,archive=null,directory=config.host??path.resolve(__dirname,'../docs');
  if(config.zip){
    const bytes=await fs.readFile(config.zip);temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ps1-playground-browser-'));directory=temporary;
    const unpack=String.raw`import sys,zipfile
from pathlib import Path
root=Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 for entry in z.infolist():
  if not (root/entry.filename).resolve().is_relative_to(root):raise ValueError('Unsafe ZIP member')
 z.extractall(root)`;
    execFileSync('python3',['-c',unpack,config.zip,directory],{stdio:'pipe'});archive={path:config.zip,bytes:bytes.length,sha256:hash(bytes)};
  }
  const candidates=[directory,path.join(directory,'docs')];
  for(const entry of await fs.readdir(directory,{withFileTypes:true}))if(entry.isDirectory())candidates.push(path.join(directory,entry.name));
  for(const candidate of new Set(candidates))for(const prefix of ['playground/','']){
    try{
      const entry='/'+prefix+'index.html',starter='/'+prefix+'defaults/ps1/index.js';
      await fs.access(path.join(candidate,entry));const source=await fs.readFile(path.join(candidate,starter),'utf8');
      const examples=await Promise.all(['ps1-stereo-voices.js','ps1-adpcm-wave.js'].map(async name=>{const entry='/'+prefix+'examples/ps1/'+name,source=await fs.readFile(path.join(candidate,entry),'utf8');return {path:entry,source};}));
      return {directory:candidate,entry,starter,source,examples,temporary,archive};
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(temporary)await fs.rm(temporary,{recursive:true,force:true});
  throw Error('Selected host must contain Playground index.html and defaults/ps1/index.js');
}

function instrumentation(){
  const audit=window.__ps1Audit={contexts:[],workers:[],worklets:[],sinks:new Map(),processorErrors:[],commands:[]};
  const Context=window.AudioContext,OriginalWorker=window.Worker,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect,post=MessagePort.prototype.postMessage;
  const labels=new WeakMap();audit.connect=connect;
  window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
  if(window.webkitAudioContext===Context)window.webkitAudioContext=window.AudioContext;
  window.Worker=class extends OriginalWorker{constructor(url,...args){super(url,...args);audit.workers.push(String(url));}};
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){
    super(context,name,...args);const entry={name,state:null};audit.worklets.push(entry);labels.set(this.port,name);
    this.addEventListener('processorerror',()=>audit.processorErrors.push(name));
    if(name.includes('ps1'))this.port.addEventListener('message',({data})=>{
      const state=data?.state??data?.value;if(Array.isArray(state?.channels)&&state.channels.length===24&&Array.isArray(state.samples))entry.state=state;
    });
  }};
  // Observe existing requests, never inject a read or instrument production JS.
  MessagePort.prototype.postMessage=function(data,...args){
    if(data&&typeof data==='object'&&!ArrayBuffer.isView(data)&&!Array.isArray(data)&&
       (typeof data.method==='string'||data.type==='chip-inspector')){
      audit.commands.push({name:labels.get(this)??null,type:data.type,action:data.action,method:data.method,
        channel:typeof data.args?.[0]==='number'?data.args[0]:null,time:performance.now()});
    }
    return post.call(this,data,...args);
  };
  AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination){let sink=audit.sinks.get(this.context);
      if(!sink){const sum=this.context.createGain(),gate=this.context.createGain();gate.gain.value=0;connect.call(sum,gate);connect.call(gate,destination);sink={sum,gate};audit.sinks.set(this.context,sink);}
      connect.call(this,sink.sum,...args);return destination;
    }return connect.call(this,destination,...args);
  };
  AudioNode.prototype.disconnect=function(...args){if(args[0]===this.context.destination&&audit.sinks.has(this.context))args[0]=audit.sinks.get(this.context).sum;return disconnect.apply(this,args);};
}

async function capture(page,frames=16384){return page.evaluate(async frames=>{
  const audit=window.__ps1Audit,context=[...audit.contexts].reverse().find(value=>value.state!=='closed'&&audit.sinks.has(value));
  if(!context)throw Error('No live Playground output graph');const sink=audit.sinks.get(context);
  if(!sink.capture){
    await context.audioWorklet.addModule('/__ps1_capture.js');const node=new AudioWorkletNode(context,'ps1-playground-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
    audit.connect.call(sink.sum,node);audit.connect.call(node,sink.gate);sink.capture=node;sink.sequence=0;sink.pending=null;
    node.port.onmessage=({data})=>{if(sink.pending?.id===data.id){const p=sink.pending;sink.pending=null;clearTimeout(p.timer);p.resolve(data);}};
  }
  const data=await new Promise((resolve,reject)=>{if(sink.pending)throw Error('Concurrent SPU capture');const id=++sink.sequence;
    const timer=setTimeout(()=>{sink.pending=null;reject(Error('SPU output capture timed out'));},10000);sink.pending={id,resolve,timer};sink.capture.port.postMessage({id,frames});});
  const channels=[data.left,data.right].map(values=>{let peak=0,energy=0,nonFinite=0,nonZero=0;const crossings=[];
    const mean=values.reduce((sum,value)=>sum+value,0)/values.length;
    for(let i=0;i<values.length;i++){const value=values[i];if(!Number.isFinite(value))nonFinite++;peak=Math.max(peak,Math.abs(value));energy+=(value-mean)**2;if(value!==0)nonZero++;if(i&&values[i-1]<mean&&value>=mean)crossings.push(i-1+(mean-values[i-1])/(value-values[i-1]));}
    return {peak,rms:Math.sqrt(energy/values.length),nonFinite,nonZero,hz:crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0};});
  if(sink.gate.gain.value!==0)throw Error('Physical output gate must remain zero');
  return {sampleRate:context.sampleRate,frames:data.left.length,frameGaps:data.frameGaps,firstFrame:data.firstFrame,lastFrame:data.lastFrame,quantumFrames:data.quantumFrames,channels,physicalOutputMuted:true};
},frames);}
async function audible(page,label,hz){let pcm;for(let attempt=0;attempt<6;attempt++){
  pcm=await capture(page);if(pcm.channels.every(ch=>!ch.nonFinite&&ch.rms>.0001&&ch.peak<1&&(hz===undefined||Math.abs(ch.hz-hz)<Math.max(2,hz*.015))))break;
}assert(pcm.channels.every(ch=>!ch.nonFinite&&ch.rms>.0001&&ch.peak<1&&(hz===undefined||Math.abs(ch.hz-hz)<Math.max(2,hz*.015))),`${label}: ${JSON.stringify(pcm)}`);assert.equal(pcm.frameGaps,0,label+': continuous rendering quanta '+JSON.stringify(pcm));return pcm;}
async function silent(page,label){let pcm;for(let attempt=0;attempt<8;attempt++){
  pcm=await capture(page,4096);if(pcm.channels.every(ch=>!ch.nonFinite&&!ch.nonZero)){assert.equal(pcm.frameGaps,0);return pcm;}
}throw Error(label+': expected exact zero SPU output: '+JSON.stringify(pcm));}
async function ready(page){
  await page.waitForFunction(()=>document.getElementById('startupNotice')?.hidden||document.getElementById('status')?.textContent==='Startup failed.');
  assert.equal(await page.locator('#startupNotice').isVisible(),false,await page.locator('#startupMessage').textContent());await page.waitForFunction(()=>window.monaco?.editor?.getEditors().length===1);
}
async function setSource(page,source,execution){
  await page.locator('#codeTab').click();await page.evaluate(({source,execution})=>{monaco.editor.getEditors()[0].setValue(source);document.getElementById('workerExecution').checked=execution==='worker';},{source,execution});
}
async function run(page,source,execution){await setSource(page,source,execution);await page.locator('#runButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);}
async function stop(page,label){await page.locator('#stopButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);await capture(page,4096);return silent(page,label);}
async function waitLog(page,marker){
  await page.waitForFunction(marker=>document.getElementById('consoleOutput').textContent.includes(marker)||/^Error:|^Playback failed:/i.test(document.getElementById('status').textContent),marker);
  const text=await page.locator('#consoleOutput').textContent();assert(text.includes(marker),'Runtime failed before '+marker+': '+text);return text;
}
async function readLog(page,marker){const text=await waitLog(page,marker);return JSON.parse(text.slice(text.lastIndexOf(marker)+marker.length).split('\n')[0]);}
async function healthy(page,label){const state=await page.evaluate(()=>({status:document.getElementById('status').textContent,processors:__ps1Audit.processorErrors}));assert(!/^Error:|failed|error:/i.test(state.status),label+': '+state.status);assert.deepEqual(state.processors,[],label+': no AudioWorklet processor errors');}
async function field(page,name,value){await page.locator(control(name)).evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('change',{bubbles:true}));node.blur();},value);}
async function hold(page,label){const button=page.locator(action('hold'));await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();try{return await audible(page,label,440);}finally{await page.mouse.move(2,2);await page.mouse.up();}}
async function commandsSince(page,from){return page.evaluate(from=>__ps1Audit.commands.slice(from),from);}
async function keyboard(page){
  if(!await page.locator('#keyboardTab').isVisible())await page.locator('.dock-toggle').click();
  await page.locator('#keyboardTab').click();await page.locator('#keyboardPanel').waitFor({state:'visible'});
  await page.locator('#operatorKeyboardRoot button').filter({hasText:/^Guitar$/}).click();
  await page.selectOption('#playgroundKeyboardChip','chip:ps1');await page.selectOption('#playgroundKeyboardTargetChannel','23');
  assert.deepEqual(await page.locator('#playgroundKeyboardTargetChannel option').evaluateAll(nodes=>nodes.map(node=>node.value)),Array.from({length:24},(_,i)=>String(i)),'24 physical Keyboard channel targets');
  const key=page.locator('#operatorKeyboardRoot .key').first(),letter=await key.getAttribute('data-key');assert(letter,'Guitar Keyboard has a PC key mapping');
  await page.evaluate(()=>document.activeElement?.blur());const before=await page.evaluate(()=>__ps1Audit.commands.length);await page.keyboard.down(letter);
  let pc;try{pc=await audible(page,'Guitar PC key on physical CH24');}finally{await page.keyboard.up(letter);}const pcRelease=await silent(page,'Guitar PC key release');
  const commands=await commandsSince(page,before);assert(commands.some(entry=>['auditionOn','noteOn','keyOn'].includes(entry.method)&&entry.channel===23),'PC key addresses physical CH24');
  const box=await key.boundingBox();assert(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  let pointer;try{pointer=await audible(page,'Guitar pointer on physical CH24');}finally{await page.mouse.move(2,2);await page.mouse.up();}const pointerRelease=await silent(page,'Guitar pointer release');
  await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down(letter);await audible(page,'Guitar key before blur');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));const blurRelease=await silent(page,'Window blur releases Keyboard');await page.keyboard.up(letter);
  return {channel:23,pc,pcRelease,pointer,pointerRelease,blurRelease};
}
async function checkPanel(page){
  console.log('  SPU Prepare / CH24 Hold');
  await page.locator('#ps1Tab').click();await page.locator(`${root} [data-chip-action="prepare"]`).click();
  await page.waitForFunction(()=>document.querySelector('#ps1Panel [data-chip-control="ps1-pitch"]')||document.getElementById('status').textContent.startsWith('Sound chip:'));
  assert(await page.locator(control('pitch')).isVisible(),'Prepare audio failed: '+await page.locator('#status').textContent());
  assert.equal(await page.locator(`${root} [data-chip-channel]`).count(),24,'SPU editor exposes 24 physical voices');
  await page.locator(`${root} [data-chip-channel="23"]`).click();await field(page,'audition-midi',69);
  const pcm=await hold(page,'SPU editor CH24 Hold'),released=await silent(page,'SPU editor Hold release');
  const before=await page.evaluate(()=>__ps1Audit.commands.length);await page.waitForTimeout(1050);
  const visible=await commandsSince(page,before),visibleReads=visible.filter(entry=>entry.type==='chip-inspector'&&entry.action==='read');
  assert(visibleReads.length<=6,'SPU editor must not read every animation/audio frame');
  assert(!visible.some(entry=>entry.type==='chip-inspector'&&entry.action==='invoke'),'Idle SPU editor sends no audio updates');
  await page.locator(action('keyboard')).click();await page.locator('#bottomDock .dock-close').click();
  assert(await page.locator('#keyboardPanel').evaluate(node=>node.classList.contains('is-floating-keyboard')),'SPU editor has the shared floating Keyboard while the dock is closed');
  const key=page.locator('#operatorKeyboardRoot .key').first(),letter=await key.getAttribute('data-key');await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down(letter);
  let editorKeyboard;try{editorKeyboard=await audible(page,'SPU tab floating Keyboard');}finally{await page.keyboard.up(letter);}await silent(page,'SPU tab Keyboard release');
  await page.locator('#codeTab').click();await page.waitForTimeout(100);const hiddenAt=await page.evaluate(()=>__ps1Audit.commands.length);await page.waitForTimeout(750);
  const hidden=await commandsSince(page,hiddenAt);assert.deepEqual(hidden.filter(entry=>entry.type==='chip-inspector'),[],'Hidden SPU panel sends no read/invoke polling');
  return {channel:23,pcm,released,editorKeyboard,visibleReadRequests:visibleReads.length,hiddenReadRequests:0,idleInvokes:0};
}
async function screenshots(page,name,execution){
  if(!config.screenshots||execution!=='main')return null;
  await fs.mkdir(config.screenshots,{recursive:true});await page.locator('#ps1Tab').click();
  const outputs=[];
  for(const [label,width,height]of [['desktop',1600,1150],['mobile',390,844]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(150);
    const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,panel:document.getElementById('ps1Panel').getBoundingClientRect().width}));
    assert(overflow.document<=overflow.viewport+1,'SPU editor page must not overflow the viewport: '+JSON.stringify(overflow));
    const file=path.join(config.screenshots,`${name}-ps1-${label}.png`);await page.screenshot({path:file,fullPage:true});outputs.push({label,path:file,...overflow});
  }
  await page.setViewportSize({width:1600,height:1150});return outputs;
}
async function changeMode(page,mode){
  if(!await page.locator('#playgroundMode').isVisible())await page.locator('#mainMenu > summary').click();await page.selectOption('#playgroundMode',mode);
  await page.locator('#changeModeDialog').waitFor({state:'visible'});await page.locator('#modeChoiceInitial').click();await page.waitForURL(url=>url.searchParams.get('mode')===mode);await ready(page);
}

async function runCase(browser,name,origin,host,execution){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1600,height:1150}});await context.addInitScript(instrumentation);
  const page=await context.newPage();page.setDefaultTimeout(40000);const errors=[],badResponses=[],consoleErrors=[];
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
  try{
    console.log(`CHECK ${name}/${execution}: ${host.archive?'Run ZIP':'source'}`);
    await page.goto(origin+host.entry+'?mode=ps1&no-sw=1',{waitUntil:'domcontentloaded'});await ready(page);console.log('  Startup ready');
    assert.equal(await page.locator('#playgroundMode').inputValue(),'ps1');assert(await page.locator('#ps1Tab').isVisible(),'PS1 mode has an SPU tab');assert(await page.locator('#operatorTabButton').isHidden(),'PS1 mode has no implicit FM editor');
    assert.equal(await page.evaluate(()=>monaco.editor.getEditors()[0].getValue()),host.source,'PS1 mode opens the exact selected artifact starter');
    await page.locator('#ps1Tab').click();assert.equal(await page.evaluate(()=>__ps1Audit.contexts.length),0,'Opening SPU editor is audio-lazy');assert.equal(await page.evaluate(()=>__ps1Audit.worklets.length),0,'Opening SPU editor does not create a core');
    const panel=await checkPanel(page);const prepared=await page.evaluate(()=>__ps1Audit.worklets.filter(entry=>entry.name==='tetorica-playground-ps1').map(entry=>entry.state));
    assert.equal(prepared.length,1,'Prepare and auditions reuse one primary SPU');assert(prepared[0]?.samples?.length>=1,'Prepare uploads an original instrument');assert.equal(prepared[0].channels.length,24);
    console.log('  Guitar / PC Keyboard CH24');const input=await keyboard(page);await stop(page,'Stop after Keyboard');const runs=[];
    for(let pass=0;pass<2;pass++){
      console.log('  Exact starter pass '+(pass+1));
      await run(page,host.source,execution);
      if(execution==='worker')assert(await page.evaluate(()=>__ps1Audit.workers.some(url=>/\/playground_logic_worker\.js(?:\?|$)/.test(url))),'Worker execution uses the actual Playground logic Worker, which may be reused after Stop');
      const pcm=await audible(page,`Exact ${execution} starter pass ${pass+1}`);await healthy(page,'Starter');const stopped=await stop(page,'Starter Stop');runs.push({pass:pass+1,pcm,stopped});
    }
    const examples=[];
    for(const example of host.examples){
      console.log('  Exact example '+example.path);
      const runPath='/examples/ps1/'+path.basename(example.path);await page.locator('#runFileSelect').selectOption(runPath);
      await page.evaluate(execution=>{document.getElementById('workerExecution').checked=execution==='worker';},execution);await page.locator('#runButton').click();
      await page.waitForFunction(()=>!document.getElementById('runButton').disabled);
      const pcm=await audible(page,example.path);await healthy(page,example.path);const stopped=await stop(page,example.path+' Stop');examples.push({path:runPath,sha256:hash(example.source),pcm,stopped});
    }
    await page.locator('#runFileSelect').selectOption('/index.js');
    console.log('  Borrowed-primary state probe / authored error recovery');
    const marker=`__PS1_STATE_${name}_${execution}__`;
    await run(page,`if(typeof fm!=='undefined'||typeof play!=='undefined')throw Error('Unexpected implicit FM');
if(spu!==await useSoundChip('ps1'))throw Error('useSoundChip must borrow the primary SPU');
const state=await spu.getState();log(${JSON.stringify(marker)}+JSON.stringify(state));`,execution);
    const state=await readLog(page,marker);assert.equal(state.channels.length,24);assert.equal(state.sampleRate,44100);assert(state.samples.length>=1);await stop(page,'Probe Stop');
    console.log('  ADPCM upload overlapping a RAM-retaining reset');
    const bankMarker=`__PS1_RETAIN_BANK_${name}_${execution}__`;
    await run(page,`const packets=new Uint8Array(64);
for(let block=0;block<4;block++){const at=block*16;packets[at]=4;packets[at+1]=block===0?6:block===3?3:0;
 for(let i=0;i<28;i++){const value=Math.round(7*Math.sin(2*Math.PI*(block*28+i)/112));packets[at+2+(i>>1)]|=(value&15)<<((i&1)*4);}}
const before=await spu.getState(),options={baseFrequencyHz:44100/112,loopStartSamples:0};
const pending=spu.loadADPCM(packets,options);spu.reset();
const rejected=await pending.then(()=>null,error=>error.name);if(rejected!=='AbortError')throw Error('Reset must cancel the pending caller');
const retained=await spu.getState();if(retained.samples.length!==before.samples.length+1)throw Error('Retaining reset lost the uploaded bank');
const uploaded=await spu.loadADPCM(packets,options);if(uploaded.id!==retained.samples.length)throw Error('Client and audio bank IDs diverged');
spu.setPreset(23,{sample:uploaded,volumeLeft:.6,volumeRight:.6});spu.noteOn(23,'A4');
log(${JSON.stringify(bankMarker)}+JSON.stringify({sample:uploaded,retainedSamples:retained.samples.length,rejected,state:await spu.getState()}));
liveLoop('retain-uploaded-bank',async()=>{await sleep(60);});`,execution);
    const bank=await readLog(page,bankMarker);assert(bank.state.samples.some(sample=>sample.id===bank.sample.id),'RAM-retaining reset preserves the uploaded bank');
    const bankPcm=await audible(page,'New bank remains playable after overlapping reset',440);await stop(page,'Retained-bank Stop');
    const overlappingReset={sample:bank.sample,retainedSamples:bank.retainedSamples,rejected:bank.rejected,pcm:bankPcm};
    console.log('  Additional SPU / independent disposal');
    const extraMarker=`__PS1_EXTRA_${name}_${execution}__`,disposedMarker=extraMarker+'DISPOSED';
    await run(page,`const extra=await createSoundChip('ps1',{id:'ps1:browser-extra'});
spu.setPreset(0,{sample:0,volumeLeft:.5,volumeRight:0});spu.noteOn(0,'A3');
extra.setPreset(23,{sample:0,volumeLeft:0,volumeRight:.5});extra.noteOn(23,'A4');
log(${JSON.stringify(extraMarker)}+JSON.stringify(await extra.getState()));
liveLoop('dispose-extra',async()=>{await sleep(1.6);await extra.dispose();log(${JSON.stringify(disposedMarker)});await sleep(60);});`,execution);
    const extraState=await readLog(page,extraMarker);assert.equal(extraState.channels.length,24);
    // Worker commands can be scheduled ahead of this immediate state read. The
    // stereo PCM below, rather than that read, proves their audible application.
    if(execution==='main')assert(extraState.channels[23].gate,'Additional SPU CH24 sounds');
    const mixed=await audible(page,'Primary + additional SPU');await waitLog(page,disposedMarker);
    let survivor;for(let attempt=0;attempt<6;attempt++){survivor=await capture(page);if(survivor.channels[0].rms>.0001&&survivor.channels[1].peak===0)break;}
    assert(survivor.channels[0].rms>.0001&&!survivor.channels[0].nonFinite,'Primary survives additional SPU disposal');assert.equal(survivor.channels[1].peak,0,'Disposing the additional SPU silences only its right channel');await stop(page,'Additional SPU Stop');
    const additional={state:extraState,mixed,survivor,independentDisposal:true};
    // A normal authored error must not poison the next performance or the core.
    await run(page,"spu.noteOn(0,'A4');throw Error('PS1_EXPECTED_RECOVERY_CHECK');",execution);
    await page.waitForFunction(()=>document.getElementById('consoleOutput').textContent.includes('PS1_EXPECTED_RECOVERY_CHECK'));await stop(page,'Error recovery Stop');
    await run(page,host.source,execution);const recovery=await audible(page,'Rerun after authored error');await healthy(page,'Rerun after authored error');await stop(page,'Recovery Stop');
    const images=await screenshots(page,name,execution);console.log('  Mode round trip');
    const beforeSwitch=await page.evaluate(()=>__ps1Audit.contexts.map(value=>value.state));await changeMode(page,'genesis');assert(await page.locator('#ps1Tab').isHidden(),'Switching mode hides SPU tab');
    await changeMode(page,'ps1');assert.equal(await page.evaluate(()=>__ps1Audit.contexts.length),0,'Mode round trip creates a lazy fresh page');assert.equal(await page.evaluate(()=>monaco.editor.getEditors()[0].getValue()),host.source,'Initial code restored after mode round trip');
    await run(page,host.source,execution);const recreated=await audible(page,'Mode round trip recreated SPU');await stop(page,'Mode round trip Stop');
    const audit=await page.evaluate(()=>({worklets:__ps1Audit.worklets.map(entry=>entry.name),workers:__ps1Audit.workers,processorErrors:__ps1Audit.processorErrors,physicalOutputMuted:[...__ps1Audit.sinks.values()].every(sink=>sink.gate.gain.value===0)}));
    assert(audit.worklets.includes('tetorica-playground-ps1'),'A real PS1 AudioWorklet was created');assert.deepEqual(audit.processorErrors,[]);assert(audit.physicalOutputMuted);
    // Monaco can cancel an in-flight worker request while the mode page unloads.
    const known=error=>['Canceled','Canceled: Canceled'].includes(error.message)&&error.stack?.includes('monaco-editor');
    assert.deepEqual(errors.filter(error=>!known(error)),[],'Browser exceptions');assert.deepEqual(badResponses,[],'Missing runtime assets');
    return {browser:name,version:browser.version(),execution,openingIsLazy:true,primaryReused:true,panel,keyboard:input,runs,examples,state,overlappingReset,additional,screenshots:images,authoredErrorRecovery:recovery,modeRoundTrip:{beforeSwitch,recreated},...audit};
  }catch(error){
    const state=await page.evaluate(()=>({status:document.getElementById('status')?.textContent,log:document.getElementById('consoleOutput')?.textContent,worklets:__ps1Audit?.worklets,commands:__ps1Audit?.commands.slice(-20)})).catch(()=>null);
    throw Error(`${name}/${execution}: ${error.message}\n${JSON.stringify({state,errors,badResponses,consoleErrors})}`,{cause:error});
  }finally{await context.close();}
}

(async()=>{
  const host=await selectHost();let server;
  try{
    server=http.createServer(async(request,response)=>{
      try{
        const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
        if(pathname==='/__ps1_capture.js'){response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(captureSource);return;}
        let file=path.resolve(host.directory,'.'+pathname);assert(file===host.directory||file.startsWith(host.directory+path.sep),'Outside selected host');if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
        const bytes=await fs.readFile(file),name=path.relative(host.directory,file),sha256=hash(bytes);if(served.has(name))assert.equal(served.get(name).sha256,sha256,'Source changed during browser check: '+name);served.set(name,{bytes:bytes.length,sha256});
        const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'};
        response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
      }catch(error){response.writeHead(404).end(error.message);}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const results=[];
    for(const name of config.engines){
      const browser=await ({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
      try{for(const execution of ['main','worker']){results.push(await runCase(browser,name,`http://127.0.0.1:${server.address().port}`,host,execution));console.log(`PASS ${name}/${execution}: PS1 starter twice, CH24 Guitar/PC keys, SPU editor audition, Stop, error recovery and mode round trip; physical output muted.`);}}
      finally{await browser.close();}
    }
    for(const [name,entry]of served)assert.equal(hash(await fs.readFile(path.join(host.directory,name))),entry.sha256,'Source remained frozen: '+name);
    const report={schemaVersion:1,passed:true,physicalOutputMuted:true,listeningPerformed:false,publicUiOnly:true,repositoryFallback:false,host:host.directory,archive:host.archive,starter:{path:host.starter,bytes:Buffer.byteLength(host.source),sha256:hash(host.source)},results,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),checkerSha256:hash(await fs.readFile(__filename))};
    if(config.out)await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`PS1 Playground browser check passed: ${results.length} routes${config.out?'; '+config.out:''}.`);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));if(host.temporary)await fs.rm(host.temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
