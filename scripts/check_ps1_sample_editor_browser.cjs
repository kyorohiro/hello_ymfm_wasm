// Public Playground Main/Worker UI → Sample Editor → actual PS1 SPU AudioWorklet.
// The capture's physical output is always zero; this is not a listening test.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const config={host:null,zip:null,out:null,screenshots:null,engines:[],execution:null};
const usage='Usage: node scripts/check_ps1_sample_editor_browser.cjs [--chromium-only | --webkit-only] [--host DIR | --zip ARCHIVE] [--out REPORT.json] [--screenshots DIR]';
for(let i=2;i<process.argv.length;i++){
  const arg=process.argv[i];
  if(arg==='--help'){console.log(usage);process.exit(0);}
  if(['--chromium-only','--webkit-only'].includes(arg)){config.engines.push(arg.slice(2,-5));continue;}
  const match=arg.match(/^--(host|zip|out|screenshots|execution)(?:=(.*))?$/);assert(match,usage);
  const value=match[2]??process.argv[++i];assert(value&&!value.startsWith('--'),usage);config[match[1]]=match[1]==='execution'?value:path.resolve(value);
}
assert(config.execution===null||['main','worker'].includes(config.execution),'--execution must be main or worker');
assert(!(config.host&&config.zip),'Choose --host or --zip');
assert(config.engines.length<=1,'Choose one browser flag or neither for both');
if(!config.engines.length)config.engines=['chromium','webkit'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),served=new Map();
const captureSource=`class Ps1SampleCapture extends AudioWorkletProcessor {
 constructor(){super();this.pending=null;this.port.onmessage=({data})=>{if(this.pending)throw Error('Concurrent PS1 ADPCM capture');this.pending={id:data.id,left:new Float32Array(data.frames),right:new Float32Array(data.frames),offset:0,firstFrame:null,lastFrame:null,frameGaps:0,quantumFrames:[]};};}
 process(inputs,outputs){for(const channel of outputs[0])channel.fill(0);const p=this.pending;if(!p)return true;
  if(p.firstFrame===null)p.firstFrame=currentFrame;if(currentFrame!==p.firstFrame+p.offset)p.frameGaps++;p.lastFrame=currentFrame;
  const quantum=outputs[0][0].length;if(!p.quantumFrames.includes(quantum))p.quantumFrames.push(quantum);
  const count=Math.min(quantum,p.left.length-p.offset),input=inputs[0];for(let i=0;i<count;i++){p.left[p.offset+i]=input[0]?.[i]??0;p.right[p.offset+i]=input[1]?.[i]??input[0]?.[i]??0;}p.offset+=count;
  if(p.offset===p.left.length){this.pending=null;this.port.postMessage(p,[p.left.buffer,p.right.buffer]);}return true;
 }
}registerProcessor('ps1-sample-editor-capture',Ps1SampleCapture);`;

async function selectHost(){
  let temporary=null,archive=null,directory=config.host??path.resolve(__dirname,'../docs');
  if(config.zip){
    const bytes=await fs.readFile(config.zip);temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ps1-sample-browser-'));directory=temporary;
    const unpack=String.raw`import sys,zipfile
from pathlib import Path
root=Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 for entry in z.infolist():
  if not (root/entry.filename).resolve().is_relative_to(root):raise ValueError('Unsafe ZIP member')
 z.extractall(root)`;
    execFileSync('python3',['-c',unpack,config.zip,directory],{stdio:'pipe'});archive={path:config.zip,bytes:bytes.length,sha256:sha(bytes)};
  }
  const candidates=[directory,path.join(directory,'docs')];
  for(const entry of await fs.readdir(directory,{withFileTypes:true}))if(entry.isDirectory())candidates.push(path.join(directory,entry.name));
  for(const candidate of new Set(candidates))for(const prefix of ['playground/','']){
    const entry='/'+prefix+'index.html',example='/'+prefix+'examples/ps1/ps1-sampler.js';
    try{await fs.access(path.join(candidate,entry));const source=await fs.readFile(path.join(candidate,example),'utf8');return {directory:candidate,entry,example,source,temporary,archive};}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(temporary)await fs.rm(temporary,{recursive:true,force:true});
  throw Error('Selected host must contain Playground index.html and examples/ps1/ps1-sampler.js');
}
function instrumentation(){
  const audit=window.__ps1SampleAudit={contexts:[],workers:[],worklets:[],sinks:new Map(),processorErrors:[],snapshots:[],jobs:[],requests:[],starts:[],stops:0,held:[],holdCommand:null,microphoneTracks:[]};
  const Context=window.AudioContext,OriginalWorker=window.Worker,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect;audit.connect=connect;
  window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
  if(window.webkitAudioContext===Context)window.webkitAudioContext=window.AudioContext;
  // Generate a real MediaStream for the real MediaRecorder. No device permission
  // or microphone is used, and the oscillator never connects to physical output.
  if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{
    const existing=[...audit.contexts].reverse().find(context=>context.state!=='closed'&&audit.sinks.has(context));
    const context=existing??new AudioContext(),oscillator=context.createOscillator(),gain=context.createGain(),destination=context.createMediaStreamDestination();
    oscillator.frequency.value=440;gain.gain.value=.35;oscillator.connect(gain);gain.connect(destination);await context.resume();oscillator.start();
    for(const track of destination.stream.getTracks()){
      audit.microphoneTracks.push(track);const stop=track.stop.bind(track);let stopped=false;
      track.stop=()=>{stop();if(!stopped){stopped=true;try{oscillator.stop();}catch{}oscillator.disconnect();gain.disconnect();if(!existing)void context.close();}};
    }
    return destination.stream;
  };
  window.Worker=class extends OriginalWorker{constructor(url,...args){
    super(url,...args);audit.workers.push(String(url));
    if(!String(url).includes('playground_sample_editor_worker'))return;
    const requests=new Map(),post=this.postMessage.bind(this);let receive=null;
    this.postMessage=(data,...rest)=>{requests.set(data.id,data);audit.requests.push({id:data.id,command:data.command,options:data.options});return post(data,...rest);};
    Object.defineProperty(this,'onmessage',{configurable:true,get:()=>receive,set:value=>{receive=value;}});
    this.addEventListener('message',event=>{
      const request=requests.get(event.data.id),value=event.data.value;
      if(request)audit.jobs.push({command:request.command,settings:request.settings,error:event.data.error,
        value:ArrayBuffer.isView(value)?{byteLength:value.byteLength}:value&&typeof value==='object'?{...value,channels:undefined,decodedChannels:undefined,adpcm:value.adpcm?Array.from(value.adpcm):undefined}:value});
      const deliver=()=>receive?.call(this,event);
      if(request?.command===audit.holdCommand)audit.held.push(deliver);else deliver();
    });
  }};
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);audit.worklets.push(name);this.addEventListener('processorerror',()=>audit.processorErrors.push(name));
    // Observe replies to public SPU-tab reads, without injecting audio commands.
    if(name==='tetorica-playground-ps1')this.port.addEventListener('message',({data})=>{const state=data?.state??data?.value;if(Array.isArray(state?.samples)&&state?.channels?.length===24)audit.snapshots.push({samples:state.samples.length,time:performance.now()});});
  }};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination){let sink=audit.sinks.get(this.context);
      if(!sink){const sum=this.context.createGain(),gate=this.context.createGain();gate.gain.value=0;connect.call(sum,gate);connect.call(gate,destination);sink={sum,gate};audit.sinks.set(this.context,sink);}
      connect.call(this,sink.sum,...args);return destination;
    }return connect.call(this,destination,...args);
  };
  AudioNode.prototype.disconnect=function(...args){if(args[0]===this.context.destination&&audit.sinks.has(this.context))args[0]=audit.sinks.get(this.context).sum;return disconnect.apply(this,args);};
  const start=AudioBufferSourceNode.prototype.start,stop=AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start=function(...args){
    let peak=0,finite=true;const frames=this.buffer?.length??0;
    for(let ch=0;ch<(this.buffer?.numberOfChannels??0);ch++)for(const value of this.buffer.getChannelData(ch)){finite&&=Number.isFinite(value);peak=Math.max(peak,Math.abs(value));}
    audit.starts.push({peak,finite,frames,rate:this.buffer?.sampleRate,loop:this.loop});return start.apply(this,args);
  };
  AudioBufferSourceNode.prototype.stop=function(...args){audit.stops++;return stop.apply(this,args);};
}
async function capture(page,frames=16384){return page.evaluate(async frames=>{
  const audit=window.__ps1SampleAudit,context=[...audit.contexts].reverse().find(context=>context.state!=='closed'&&audit.sinks.has(context));
  if(!context)throw Error('No live Playground output graph');const sink=audit.sinks.get(context);
  if(!sink.capture){
    await context.audioWorklet.addModule('/__ps1_sample_capture.js');const node=new AudioWorkletNode(context,'ps1-sample-editor-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
    audit.connect.call(sink.sum,node);audit.connect.call(node,sink.gate);sink.capture=node;sink.sequence=0;sink.pending=null;
    node.port.onmessage=({data})=>{if(sink.pending?.id===data.id){const p=sink.pending;sink.pending=null;clearTimeout(p.timer);p.resolve(data);}};
  }
  const data=await new Promise((resolve,reject)=>{if(sink.pending)throw Error('Concurrent SPU capture');const id=++sink.sequence;
    const timer=setTimeout(()=>{sink.pending=null;reject(Error('SPU output capture timed out'));},10000);sink.pending={id,resolve,timer};sink.capture.port.postMessage({id,frames});});
  const channels=[data.left,data.right].map(values=>{let peak=0,energy=0,nonFinite=0,nonZero=0;const crossings=[],mean=values.reduce((sum,value)=>sum+value,0)/values.length;
    for(let i=0;i<values.length;i++){const value=values[i];if(!Number.isFinite(value))nonFinite++;peak=Math.max(peak,Math.abs(value));energy+=(value-mean)**2;if(value!==0)nonZero++;if(i&&values[i-1]<mean&&value>=mean)crossings.push(i-1+(mean-values[i-1])/(value-values[i-1]));}
    return {peak,rms:Math.sqrt(energy/values.length),nonFinite,nonZero,hz:crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0};});
  if(sink.gate.gain.value!==0)throw Error('Physical output must remain zero');
  return {sampleRate:context.sampleRate,frames:data.left.length,frameGaps:data.frameGaps,firstFrame:data.firstFrame,lastFrame:data.lastFrame,quantumFrames:data.quantumFrames,channels,physicalOutputMuted:true};
},frames);}
async function audible(page,label,hz){let pcm;const valid=ch=>!ch.nonFinite&&ch.rms>.0001&&ch.peak<1&&(hz===undefined||Math.abs(ch.hz-hz)<Math.max(2,hz*.025));
  for(let attempt=0;attempt<6;attempt++){pcm=await capture(page);if(pcm.channels.every(valid))break;}
  assert(pcm.channels.every(valid),label+': finite nonzero unclipped SPU audio '+JSON.stringify(pcm));assert.equal(pcm.frameGaps,0,label+': continuous output quanta');return pcm;}
async function silent(page,label){let pcm;for(let attempt=0;attempt<8;attempt++){pcm=await capture(page,4096);if(pcm.channels.every(ch=>!ch.nonFinite&&!ch.nonZero)){assert.equal(pcm.frameGaps,0,label+': continuous zero-output quanta '+JSON.stringify(pcm));return pcm;}}throw Error(label+': expected exact-zero output '+JSON.stringify(pcm));}
async function setSource(page,source,execution){await page.locator('#codeTab').click();await page.evaluate(({source,execution})=>{monaco.editor.getEditors()[0].setValue(source);document.getElementById('workerExecution').checked=execution==='worker';},{source,execution});}
async function run(page,source,execution){await setSource(page,source,execution);await page.locator('#runButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);}
async function waitLog(page,marker){await page.waitForFunction(marker=>document.getElementById('consoleOutput').textContent.includes(marker)||/^Error:|^Playback failed:/i.test(document.getElementById('status').textContent),marker);const text=await page.locator('#consoleOutput').textContent();assert(text.includes(marker),'Runtime failed before '+marker+': '+text);return text;}
async function healthy(page,label){const state=await page.evaluate(()=>({status:document.getElementById('status').textContent,processors:__ps1SampleAudit.processorErrors}));assert(!/^Error:|failed|error:/i.test(state.status),label+': '+state.status);assert.deepEqual(state.processors,[],label+': no AudioWorklet processor errors');}
async function stop(page,label){await page.locator('#stopButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);await capture(page,4096);const stopped=await silent(page,label);await healthy(page,label);return stopped;}
const dialogSelector='dialog[data-audio-input]';
const selector=key=>`${dialogSelector} [data-field="${key}"]`;
const action=key=>`${dialogSelector} [data-action="${key}"]`;
const audioAction=key=>`${dialogSelector} [data-audio-action="${key}"]`;
async function field(page,key,value){await page.locator(selector(key)).evaluate((element,value)=>{if(element.type==='checkbox')element.checked=Boolean(value);else element.value=String(value);element.dispatchEvent(new Event('change',{bubbles:true}));element.blur();},value);}
async function openEditor(page){
  if(!await page.locator('#sampleEditorButton').isVisible())await page.locator('#mainMenu > summary').click();
  await page.locator('#sampleEditorButton').click();await page.locator(dialogSelector).waitFor({state:'visible'});
}
async function comparison(page){
  // Let edit-driven rendering invalidate the old preview before awaiting the new one.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.waitForFunction(()=>{
    const button=document.querySelector('[data-action="preview-ps1"]'),error=document.querySelector('[data-ps1-status]');
    return button&&!button.disabled||error?.dataset.error==='true';
  });
  const error=await page.locator('[data-ps1-status]').getAttribute('data-error');
  assert.notEqual(error,'true',await page.locator('[data-ps1-status]').textContent());
  return page.evaluate(()=>__ps1SampleAudit.jobs.filter(job=>job.command==='ps1-comparison'&&!job.error).at(-1));
}
async function idleComparisons(page,hidden=false){
  const before=await page.evaluate(()=>__ps1SampleAudit.requests.filter(request=>request.command==='ps1-comparison').length);
  if(hidden)await field(page,'target','rf5c164');
  await page.waitForTimeout(280);
  const after=await page.evaluate(()=>__ps1SampleAudit.requests.filter(request=>request.command==='ps1-comparison').length);
  assert.equal(after,before,hidden?'A hidden PS1 target adds no polling jobs':'An idle PS1 comparison adds no polling jobs');
  if(hidden){await field(page,'target','ps1');await comparison(page);}
  return {durationMs:280,requests:after-before};
}
async function recordMicrophone(page){
  await page.locator(audioAction('record')).click();await page.locator(audioAction('stop')).waitFor({state:'visible'});
  await page.waitForTimeout(450);await page.locator(audioAction('stop')).click();const converted=await comparison(page);
  assert(converted.value.byteLength>0&&converted.value.metrics.signalRms>.01,'Real MediaRecorder audio reaches the PS1 converter');
  await field(page,'asset','/samples/ps1-recording.sample.json');await page.locator(audioAction('use')).click();await page.locator(dialogSelector).waitFor({state:'detached'});
  assert(await page.evaluate(()=>__ps1SampleAudit.microphoneTracks.length>0&&__ps1SampleAudit.microphoneTracks.every(track=>track.readyState==='ended')),'Recording tracks released');
  await openEditor(page);return {generatedMediaStream:true,realMediaRecorder:true,recordedFrames:converted.value.sourceFrameCount,bytes:converted.value.byteLength,tracksReleased:true};
}
function waveFile(){
  const rate=44100,frames=4410,bytes=Buffer.alloc(44+frames*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
  for(let i=0;i<frames;i++)bytes.writeInt16LE(Math.round(32767*.6*Math.sin(2*Math.PI*440*i/rate)),44+i*2);return bytes;
}
async function preview(page){
  const before=await page.evaluate(()=>__ps1SampleAudit.starts.length);
  await page.locator(action('preview-ps1')).click();await page.waitForFunction(before=>__ps1SampleAudit.starts.length>before,before);
  const source=await page.evaluate(()=>__ps1SampleAudit.starts.at(-1));
  assert(source.finite&&source.peak>.001&&source.peak<1,'Preview uses finite nonzero unclipped real SPU PCM');
  assert.equal(source.rate,44100);assert.equal(source.frames,37485);assert.equal(source.loop,false);
  const pcm=await audible(page,'Real SPU converted preview',440*2**((60-69)/12));
  await page.locator(action('silence-ps1')).click();await silent(page,'Preview Stop');return {source,pcm};
}
async function stalePreview(page,close){
  const before=await page.evaluate(()=>{__ps1SampleAudit.holdCommand='ps1-preview';return __ps1SampleAudit.starts.length;});
  await page.locator(action('preview-ps1')).click();await page.waitForFunction(()=>__ps1SampleAudit.held.length===1);
  if(close)await page.locator(audioAction('cancel')).click();else await field(page,'gainDb',-3);
  await page.evaluate(()=>{__ps1SampleAudit.holdCommand=null;for(const deliver of __ps1SampleAudit.held.splice(0))deliver();});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>__ps1SampleAudit.starts.length),before,'A retired conversion must not start late audio');
  await silent(page,close?'Closed preview stays silent':'Edited preview stays silent');
}
async function screenshots(page,name,execution){
  if(!config.screenshots||execution!=='main')return [];
  await fs.mkdir(config.screenshots,{recursive:true});const results=[];
  for(const [label,width,height]of [['desktop',1440,1100],['mobile',390,844]]){
    await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    const overflow=await page.evaluate(()=>{const d=document.querySelector('dialog[data-audio-input]');return {viewport:innerWidth,document:document.documentElement.scrollWidth,dialogWidth:d.getBoundingClientRect().width,dialogScroll:d.scrollWidth,dialogClient:d.clientWidth};});
    assert(overflow.document<=overflow.viewport+1&&overflow.dialogScroll<=overflow.dialogClient+1,'Sample Editor fits at '+width+'px: '+JSON.stringify(overflow));
    const output=path.join(config.screenshots,`${name}-ps1-sample-${label}.png`);await page.screenshot({path:output,fullPage:true});results.push({path:output,label,...overflow});
  }
  await page.setViewportSize({width:1440,height:1100});return results;
}
async function keyboard(page){
  if(!await page.locator('#keyboardTab').isVisible())await page.locator('.dock-toggle').click();await page.locator('#keyboardTab').click();await page.locator('#keyboardPanel').waitFor({state:'visible'});
  await page.locator('#operatorKeyboardRoot button').filter({hasText:/^Guitar$/}).click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('#playgroundKeyboardChip option')).some(option=>/ps1-sampler/i.test(option.textContent)));
  const target=await page.locator('#playgroundKeyboardChip option').evaluateAll(options=>options.find(option=>/ps1-sampler/i.test(option.textContent)).value);
  await page.locator('#playgroundKeyboardChip').selectOption(target);
  const key=page.locator('#operatorKeyboardRoot .key').first(),letter=await key.getAttribute('data-key');assert(letter);
  const note=(await key.textContent()).match(/([A-G])([#♯b]?)(-?\d+)/);assert(note,'Guitar key exposes its musical note');
  const midi=(Number(note[3])+1)*12+({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[note[1]])+(note[2]==='b'?-1:note[2]?1:0),hz=440*2**((midi-69)/12);
  await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down(letter);
  let pc;try{pc=await audible(page,'Saved PS1 sampler Guitar PC key',hz);}finally{await page.keyboard.up(letter);}await silent(page,'Sampler PC release');
  const box=await key.boundingBox();assert(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  let pointer;try{pointer=await audible(page,'Saved PS1 sampler pointer',hz);}finally{await page.mouse.move(1,1);await page.mouse.up();}await silent(page,'Sampler pointer release');
  assert(pc.channels.every(ch=>Math.abs(ch.hz-pointer.channels[0].hz)<2),'PC and pointer use the same pitched instrument');
  return {target,letter,midi,expectedHz:hz,pc,pointer};
}
async function sampleCount(page){
  const before=await page.evaluate(()=>__ps1SampleAudit.snapshots.length);await page.locator('#ps1Tab').click();
  await page.locator('#ps1Panel button').filter({hasText:/^Refresh$/}).click();
  await page.waitForFunction(before=>__ps1SampleAudit.snapshots.length>before,before);
  const count=await page.evaluate(()=>__ps1SampleAudit.snapshots.at(-1).samples);await page.locator('#codeTab').click();return count;
}
async function selectedExample(page,execution){
  await page.evaluate(execution=>{document.getElementById('workerExecution').checked=execution==='worker';},execution);
  await page.locator('#runButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('#playgroundKeyboardChip option')).some(option=>/ps1-sampler/i.test(option.textContent)));
}
function probeSource(marker){return `const manifest=JSON.parse(await file('/samples/sampler.sample.json',{type:'text'}));
const microphone=JSON.parse(await file('/samples/ps1-recording.sample.json',{type:'text'}));if(microphone.source!=='microphone')throw Error('Recording source metadata lost');
const sourceBytes=await file(manifest.sourcePath,{type:'arrayBuffer'}),header=new DataView(sourceBytes);
let dataSize=0;for(let offset=12;offset+8<=sourceBytes.byteLength;){const length=header.getUint32(offset+4,true);if(header.getUint32(offset,true)===0x61746164){dataSize=length;break;}offset+=8+length+(length%2);}
const saved=await inputAudio({asset:'/samples/sampler.sample.json',edit:false,target:'ps1'});
const encoded=encodePs1Adpcm(saved.channels[0],{...(saved.loopEnabled?{loopStartSamples:saved.loopStartFrame}:{})});
if(encoded.adpcm.length!==saved.adpcm.length||!encoded.adpcm.every((value,i)=>value===saved.adpcm[i]))throw Error('Canonical conversion differs');
const instrument=await createSampleInstrument(saved,{target:'ps1',volume:10});
for(let voice=0;voice<24;voice++)await instrument.noteOn({id:'voice-'+voice,midi:60,velocity:100});
// Worker playback prepares commands ahead of the device; allow its default
// 300 ms lookahead to reach the output before reading actual native gates.
await sleep(1);
const state=await spu.snapshot(),last=state.samples.at(-1);
if(state.channels.filter(channel=>channel.gate).length!==24)throw Error('Not all 24 voices active: '+state.channels.filter(channel=>channel.gate).length);
if(!encoded.adpcm.every((value,i)=>value===state.ram[last.startAddress+i]))throw Error('Uploaded SPU RAM differs from conversion');
log(${JSON.stringify(marker)}+JSON.stringify({manifest,microphoneSource:microphone.source,sourceBytes:sourceBytes.byteLength,sourceRate:header.getUint32(24,true),sourceFrames:dataSize/header.getUint16(32,true),bytes:encoded.adpcm.length,loopStart:saved.loopStartFrame,loopEnd:saved.loopEndFrame,rootMidi:saved.rootMidi,tuneCents:saved.tuneCents,active:state.channels.filter(channel=>channel.gate).length,ramMatches:true,metrics:encoded.metrics}));
liveLoop('sampler-check',async()=>{await sleep(60);});`;}
async function runCase(browser,name,origin,host,execution){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1100}});await context.addInitScript(instrumentation);
  const page=await context.newPage();page.setDefaultTimeout(40000);const errors=[],badResponses=[];
  page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
  try{
    console.log(`CHECK ${name}/${execution}: ${host.archive?'Run ZIP':'source'}`);
    await page.goto(origin+host.entry+'?mode=ps1&no-sw=1',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('startupNotice')?.hidden||document.getElementById('status')?.textContent==='Startup failed.');
    assert.equal(await page.locator('#startupNotice').isVisible(),false,await page.locator('#startupMessage').textContent());await page.waitForFunction(()=>window.monaco?.editor?.getEditors().length===1);
    await openEditor(page);assert.equal(await page.locator(selector('target')).inputValue(),'ps1');assert.equal(await page.locator(selector('rate')).inputValue(),'44100');assert(await page.locator(selector('rate')).isDisabled());
    await field(page,'target','rf5c164');await field(page,'rate','22050');await field(page,'target','ps1');assert.equal(await page.locator(selector('rate')).inputValue(),'44100');
    await field(page,'target','rf5c164');assert.equal(await page.locator(selector('rate')).inputValue(),'22050');await field(page,'target','ps1');
    const microphone=await recordMicrophone(page);
    await page.locator(`${dialogSelector} [data-audio-file]`).setInputFiles({name:'ps1-a4.wav',mimeType:'audio/wav',buffer:waveFile()});const imported=await comparison(page);assert(imported.value.byteLength>0);
    await page.locator(action('new-wave')).click();await comparison(page);
    await field(page,'loopStartFrame',.0002);await field(page,'loopEndFrame',.0007);
    await page.waitForFunction(()=>document.querySelector('[data-ps1-status]')?.dataset.error==='true');
    await page.locator(audioAction('use')).click();await page.waitForFunction(()=>document.querySelector('[data-audio-input-status]')?.dataset.error==='true');
    assert(await page.locator(dialogSelector).isVisible(),'Save-only mode refuses invalid loop packets');
    assert.match(await page.locator('[data-audio-input-status]').textContent(),/28|loop|packet/i);
    // A fresh drawn cycle restores a valid full range without reusing any error cache.
    await page.locator(action('new-wave')).click();await comparison(page);
    // Draw through the existing public canvas; converter must retain these raw edits.
    await page.locator(action('zoom')).click();const canvas=page.locator(`${dialogSelector} [data-wave]`),box=await canvas.boundingBox();assert(box);
    await page.mouse.move(box.x+box.width*.4,box.y+box.height*.35);await page.mouse.down();await page.mouse.move(box.x+box.width*.45,box.y+box.height*.4,{steps:3});await page.mouse.up();
    await field(page,'gainDb',-1);await field(page,'rootMidi',60);await field(page,'tuneCents',17);const edited=await comparison(page);
    assert(edited.settings.drawStrokes?.length>0);assert.equal(edited.value.rootMidi,60);assert.equal(edited.value.tuneCents,17);assert(edited.value.metrics.snrDb>5);assert(edited.value.alignment.applied.startFrame%28===0&&edited.value.alignment.applied.endFrame%28===0);
    assert((await page.locator('[data-ps1-metrics]').textContent()).includes('SNR'));assert((await page.locator('[data-ps1-alignment]').textContent()).includes('requested'));
    const noPolling=await idleComparisons(page),hiddenNoPolling=await idleComparisons(page,true),views=await screenshots(page,name,execution),played=await preview(page);
    await stalePreview(page,false);const finalComparison=await comparison(page);
    const settings=finalComparison.settings;await page.locator(audioAction('use')).click();await page.locator(dialogSelector).waitFor({state:'detached'});
    await openEditor(page);const reopened=await comparison(page);assert.deepEqual(reopened.settings,settings,'Save/reopen preserves raw edit markers and drawn points');
    await stalePreview(page,true);await page.locator(dialogSelector).waitFor({state:'detached'});
    // Run the exact shipped example through the public file selector.
    const samplesBefore=await sampleCount(page);await page.locator('#runFileSelect').selectOption('/examples/ps1/ps1-sampler.js');await selectedExample(page,execution);
    const samplesAfter=await sampleCount(page);assert.equal(samplesAfter,samplesBefore+1,'The first sampler Run uploads one instrument');
    const input=await keyboard(page);await healthy(page,'Exact saved sampler Example');
    await selectedExample(page,execution);assert.equal(await sampleCount(page),samplesAfter,'A live rerun reuses byte-identical SPU sample RAM');
    const hotInput=await keyboard(page),exampleStop=await stop(page,'Sampler Stop');
    await selectedExample(page,execution);assert.equal(await sampleCount(page),samplesAfter,'Fresh Stop/Run does not leak another sample allocation');
    const secondInput=await keyboard(page);await stop(page,'Repeated sampler Stop');
    if(execution==='worker')assert(await page.evaluate(()=>__ps1SampleAudit.workers.some(url=>url.includes('playground_logic_worker'))),'Sampler executes in the real logic Worker');
    await page.locator('#runFileSelect').selectOption('/index.js');const marker=`__PS1_SAMPLE_${name}_${execution}__`;
    await run(page,probeSource(marker),execution);const text=await waitLog(page,marker),probe=JSON.parse(text.slice(text.lastIndexOf(marker)+marker.length).split('\n')[0]);
    assert.equal(probe.sourceFrames,256);assert.equal(probe.rootMidi,60);assert.equal(probe.tuneCents,17);assert.equal(probe.active,24);assert(probe.ramMatches);assert.equal(probe.manifest.settings.conversionTargets.ps1,'ps1');assert.equal(probe.manifest.settings.outputSampleRate,44100);assert.deepEqual(probe.manifest.settings.drawStrokes,settings.drawStrokes);
    // Independently started voices have different phases; cancellation can
    // emphasize harmonics. Fundamental pitch is checked on single voices above.
    const polyphony=await audible(page,'24-voice PS1 sample instrument'),probeStop=await stop(page,'Polyphony Stop');
    assert.deepEqual(errors,[],'Browser exceptions');assert.deepEqual(badResponses,[],'Missing runtime assets');await healthy(page,'Finished');
    const audit=await page.evaluate(()=>({worklets:__ps1SampleAudit.worklets,workers:__ps1SampleAudit.workers,previewStarts:__ps1SampleAudit.starts,previewStops:__ps1SampleAudit.stops,physicalOutputMuted:[...__ps1SampleAudit.sinks.values()].every(({gate})=>gate.gain.value===0)}));assert(audit.physicalOutputMuted);
    return {browser:name,version:browser.version(),execution,defaultPs1:true,fixedRate:44100,variableRateRestored:true,fileInput:true,microphone,drawnEdits:true,invalidLoopSaveRejected:true,noPolling,hiddenNoPolling,comparison:{bytes:edited.value.byteLength,metrics:edited.value.metrics,alignment:edited.value.alignment},played,views,staleEditCancelled:true,closedPreviewCancelled:true,saveReopen:true,exactSamplerExample:true,input,hotInput,secondInput,sampleReuse:{samplesBefore,samplesAfter,hotRerun:true,freshStopRun:true},exampleStop,probe,polyphony,probeStop,...audit};
  }catch(error){const state=await page.evaluate(()=>({status:document.getElementById('status')?.textContent,log:document.getElementById('consoleOutput')?.textContent,dialog:document.querySelector('dialog[data-audio-input]')?.innerText,jobs:window.__ps1SampleAudit?.jobs.map(job=>({command:job.command,error:job.error,settings:job.settings}))})).catch(()=>null);throw Error(`${name}/${execution}: ${error.message}\n${JSON.stringify({state,errors,badResponses})}`,{cause:error});}
  finally{await context.close();}
}
(async()=>{
  const host=await selectHost();let server;
  try{
    server=http.createServer(async(request,response)=>{
      try{
        const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
        if(pathname==='/__ps1_sample_capture.js'){response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(captureSource);return;}
        let file=path.resolve(host.directory,'.'+pathname);assert(file===host.directory||file.startsWith(host.directory+path.sep),'Outside selected host');if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
        const bytes=await fs.readFile(file),name=path.relative(host.directory,file),hash=sha(bytes);if(served.has(name))assert.equal(served.get(name).sha256,hash,'Served source changed during check: '+name);served.set(name,{bytes:bytes.length,sha256:hash});
        const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'};
        response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
      }catch(error){response.writeHead(404).end(error.message);}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const results=[];
    for(const name of config.engines){
      const browser=await ({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
      try{for(const execution of config.execution?[config.execution]:['main','worker']){results.push(await runCase(browser,name,`http://127.0.0.1:${server.address().port}`,host,execution));console.log(`PASS ${name}/${execution}: Sample Editor conversion, saved asset, real SPU preview, Guitar Keyboard, stale cancellation and Stop; physical output muted.`);}}
      finally{await browser.close();}
    }
    for(const [name,entry]of served)assert.equal(sha(await fs.readFile(path.join(host.directory,name))),entry.sha256,'Source remained frozen: '+name);
    const report={schemaVersion:1,passed:true,physicalOutputMuted:true,listeningPerformed:false,publicUiOnly:true,repositoryFallback:false,host:host.directory,archive:host.archive,example:{path:host.example,bytes:Buffer.byteLength(host.source),sha256:sha(host.source)},results,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),checkerSha256:sha(await fs.readFile(__filename))};
    if(config.out)await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`PS1 Sample Editor browser check passed: ${results.length} routes${config.out?'; '+config.out:''}.`);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));if(host.temporary)await fs.rm(host.temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
