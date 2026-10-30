// PS1 Operators sound design through public UI, actual SPU AudioWorklet and Run ZIP.
// Capture before a permanently zeroed destination; no physical audio is played.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const {PROCESSOR_NAMES,processorSource,analyzePilotPcm,analyzeClockRows}=require('./audio_clock_audit.cjs');
const config={host:null,zip:null,out:null,screenshots:null,engines:[],executions:['main','worker'],vabOnly:false,psfOnly:false,psfSet:null,psfEntry:null};
const usage='Usage: node scripts/check_ps1_voice_editor_browser.cjs [--vab-only | --psf-only] [--psf-set DIR --psf-entry NAME] [--chromium-only | --webkit-only] [--execution main|worker] [--host DIR | --zip ARCHIVE] [--out REPORT.json] [--screenshots DIR]';
for(let i=2;i<process.argv.length;i++){
  const arg=process.argv[i];
  if(arg==='--help'){console.log(usage);process.exit(0);}
  if(arg==='--vab-only'){config.vabOnly=true;continue;}
  if(arg==='--psf-only'){config.psfOnly=true;continue;}
  if(arg==='--psf-set'){config.psfSet=path.resolve(process.argv[++i]);continue;}
  if(arg==='--psf-entry'){config.psfEntry=process.argv[++i];continue;}
  if(['--chromium-only','--webkit-only'].includes(arg)){config.engines.push(arg.slice(2,-5));continue;}
  if(arg==='--execution'){const value=process.argv[++i];assert(['main','worker'].includes(value),usage);config.executions=[value];continue;}
  const match=arg.match(/^--(host|zip|out|screenshots)(?:=(.*))?$/);assert(match,usage);
  const value=match[2]??process.argv[++i];assert(value&&!value.startsWith('--'),usage);config[match[1]]=path.resolve(value);
}
assert(!(config.host&&config.zip),'Choose --host or --zip');
assert(config.engines.length<=1,'Choose one browser flag or neither for both');
if(!config.engines.length)config.engines=['chromium','webkit'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),served=new Map();
const root='#ps1Panel',control=name=>`${root} [data-chip-control="ps1-${name}"]`,action=name=>`${root} [data-chip-action="ps1-${name}"]`;
const captureSource=processorSource;

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
  const audit=window.__ps1Audit={contexts:[],workers:[],worklets:[],sinks:new Map(),processorErrors:[],commands:[],states:[],gains:[],captures:[]};
  const Context=window.AudioContext,OriginalWorker=window.Worker,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect,post=MessagePort.prototype.postMessage;
  const labels=new WeakMap();audit.connect=connect;
  const createGain=BaseAudioContext.prototype.createGain;BaseAudioContext.prototype.createGain=function(...args){const node=createGain.apply(this,args);audit.gains.push(node);return node;};
  window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
  if(window.webkitAudioContext===Context)window.webkitAudioContext=window.AudioContext;
  window.Worker=class extends OriginalWorker{constructor(url,...args){super(url,...args);audit.workers.push(String(url));}};
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){
    super(context,name,...args);const entry={name,state:null};audit.worklets.push(entry);labels.set(this.port,name);
    this.addEventListener('processorerror',()=>audit.processorErrors.push(name));
    if(name.includes('ps1'))this.port.addEventListener('message',({data})=>{
      const state=data?.state??data?.value;if(Array.isArray(state?.channels)&&state.channels.length===24&&Array.isArray(state.samples)){entry.state=state;audit.states.push({name,state,time:performance.now()});}
    });
  }};
  // Observe existing requests, never inject a read or instrument production JS.
  MessagePort.prototype.postMessage=function(data,...args){
    if(data&&typeof data==='object'&&!ArrayBuffer.isView(data)&&!Array.isArray(data)&&
       (typeof data.method==='string'||data.type==='chip-inspector')){
      audit.commands.push({name:labels.get(this)??null,type:data.type,action:data.action,method:data.method,
        channel:typeof data.args?.[0]==='number'?data.args[0]:null,args:data.args?structuredClone(data.args):undefined,time:performance.now()});
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

async function capture(page,frames=16384,frequency=null){return page.evaluate(async({frames,frequency,captureName,pilotName})=>{
  const audit=window.__ps1Audit,context=[...audit.contexts].reverse().find(value=>value.state!=='closed'&&audit.sinks.has(value));
  if(!context)throw Error('No live Playground output graph');const sink=audit.sinks.get(context);
  if(!sink.capture){
    await context.audioWorklet.addModule('/__ps1_voice_capture.js');const node=new AudioWorkletNode(context,captureName,{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{pilotInput:1}});
    // The independent sample counter reaches only capture input1. The capture
    // outputs zero, so the pilot never enters the instrument mix or speakers.
    const pilot=new AudioWorkletNode(context,pilotName,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
    audit.connect.call(pilot,node,0,1);sink.pilot=pilot;
    audit.connect.call(sink.sum,node);audit.connect.call(node,sink.gate);sink.capture=node;sink.sequence=0;sink.pending=null;
    node.port.onmessage=({data})=>{if(sink.pending?.id===data.id){const p=sink.pending;sink.pending=null;clearTimeout(p.timer);p.resolve(data);}};
  }
  const data=await new Promise((resolve,reject)=>{if(sink.pending)throw Error('Concurrent SPU capture');const id=++sink.sequence;
    const timer=setTimeout(()=>{sink.pending=null;reject(Error('SPU output capture timed out'));},10000);sink.pending={id,resolve,timer};sink.capture.port.postMessage({id,frames});});
  const pilot=window.__ps1ClockAnalysis.pilot(data.pilot,{expectedFrames:frames,pilotInputFrames:data.pilotInputFrames});
  const clock=window.__ps1ClockAnalysis.clock(data.rows);
  audit.captures.push({id:data.id,frames:data.left.length,pilot,clock});
  const channels=[data.left,data.right].map(values=>{let peak=0,energy=0,nonFinite=0,nonZero=0;const crossings=[];
    const mean=values.reduce((sum,value)=>sum+value,0)/values.length;
    for(let i=0;i<values.length;i++){const value=values[i];if(!Number.isFinite(value))nonFinite++;peak=Math.max(peak,Math.abs(value));energy+=(value-mean)**2;if(value!==0)nonZero++;if(i&&values[i-1]<mean&&value>=mean)crossings.push(i-1+(mean-values[i-1])/(value-values[i-1]));}
    const blockRms=[];for(let at=0;at<values.length;at+=1024){let e=0;const end=Math.min(values.length,at+1024);for(let i=at;i<end;i++)e+=values[i]*values[i];blockRms.push(Math.sqrt(e/(end-at)));}
    const harmonics=frequency===null?undefined:[1,2,3,4,5].map(harmonic=>{let real=0,imaginary=0;const step=2*Math.PI*frequency*harmonic/context.sampleRate;for(let i=0;i<values.length;i++){const value=values[i]-mean;real+=value*Math.cos(step*i);imaginary-=value*Math.sin(step*i);}return 2*Math.hypot(real,imaginary)/values.length;});
    return {peak,rms:Math.sqrt(energy/values.length),nonFinite,nonZero,blockRms,harmonics,hz:crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0};});
  if(sink.gate.gain.value!==0)throw Error('Physical output gate must remain zero');
  return {sampleRate:context.sampleRate,frames:data.left.length,frameGaps:data.frameGaps,gaps:data.gaps,firstFrame:data.firstFrame,lastFrame:data.lastFrame,quantumFrames:data.quantumFrames,pilot,clock,channels,physicalOutputMuted:true};
},{frames,frequency,captureName:PROCESSOR_NAMES.capture,pilotName:PROCESSOR_NAMES.pilot});}
// A global currentFrame observation is not a PCM sequence number. Chromium
// can repeat one clock value while an independently generated sample stream
// remains exact. Assert the actual capture sequence and preserve clock anomalies
// separately; never retry/discard a capture because its clock looks different.
function assertCapturePcm(pcm,label){
  assert.equal(pcm.pilot.continuous,true,label+': independent captured PCM continuity '+JSON.stringify(pcm.pilot));
  assert.equal(pcm.clock.measurementValid,true,label+': complete capture callback sequence '+JSON.stringify(pcm.clock));
  assert.equal(pcm.clock.frames,pcm.frames,label+': every capture quantum accounted for');
  assert.equal(pcm.clock.gapCount,pcm.frameGaps,label+': all observed clock anomalies retained');
}
async function audible(page,label,hz){let pcm;for(let attempt=0;attempt<6;attempt++){
  pcm=await capture(page);if(pcm.channels.every(ch=>!ch.nonFinite&&ch.rms>.0001&&ch.peak<1&&(hz===undefined||Math.abs(ch.hz-hz)<Math.max(2,hz*.015))))break;
}assert(pcm.channels.every(ch=>!ch.nonFinite&&ch.rms>.0001&&ch.peak<1&&(hz===undefined||Math.abs(ch.hz-hz)<Math.max(2,hz*.015))),`${label}: ${JSON.stringify(pcm)}`);assertCapturePcm(pcm,label);return pcm;}
async function silent(page,label){let pcm;for(let attempt=0;attempt<8;attempt++){
  pcm=await capture(page,4096);if(pcm.channels.every(ch=>!ch.nonFinite&&!ch.nonZero)){assertCapturePcm(pcm,label);return pcm;}
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
async function field(page,name,value){await page.locator(control(name)).evaluate((node,value)=>{if(node.type==='checkbox')node.checked=Boolean(value);else node.value=String(value);node.dispatchEvent(new Event('change',{bubbles:true}));node.blur();},value);}
const instance=`${root} [data-chip-control="instance"]`;
const settings=state=>state.channels.map(({sample,volumeLeft,volumeRight,adsr1,adsr2,reverb})=>({sample,volumeLeft,volumeRight,adsr1,adsr2,reverb}));
const current=page=>page.evaluate(()=>__ps1Audit.states.at(-1)?.state);
async function refresh(page){
  const before=await page.evaluate(()=>__ps1Audit.states.length);
  await page.locator(root).getByRole('button',{name:'Refresh',exact:true}).click();
  await page.waitForFunction(before=>__ps1Audit.states.length>before,before);
  return current(page);
}
async function applied(page,source,label){
  await page.waitForFunction(source=>{
    const state=__ps1Audit.states.at(-1)?.state;
    return Boolean(state&&new Function('state',`return (${source})`)(state));
  },source,{timeout:10000}).catch(error=>{throw Error(label+': '+error.message);});
  return current(page);
}
const commandsSince=(page,from)=>page.evaluate(from=>__ps1Audit.commands.slice(from),from);
async function startHold(page){
  const button=page.locator(action('hold'));await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert(box);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
}
async function releaseOutside(page){await page.mouse.move(2,2);await page.mouse.up();}
async function latch(page,label='Latched PS1 note',expectedHz=440){
  await page.locator(action('sustain')).click();assert.equal(await page.locator(action('sustain')).getAttribute('aria-pressed'),'true');
  return audible(page,label,expectedHz===false?undefined:expectedHz);
}
async function fastEnvelope(page){
  for(const [key,value]of Object.entries({'attack-rate':0,'attack-exponential':false,'decay-rate':0,'sustain-level':15,'sustain-rate':0,'sustain-decrease':false,'sustain-exponential':false,'release-rate':0,'release-exponential':false}))await field(page,key,value);
  await applied(page,'state.channels[23].adsr1===15&&(state.channels[23].adsr2&~0x2000)===0','Fast hold envelope');
}
const waveSettings=state=>settings(state).map((value,index)=>({...value,waveform:state.channels[index].waveform??null}));
const waveWrites=(page,from)=>page.evaluate(from=>__ps1Audit.commands.slice(from).filter(command=>command.type==='chip-inspector'&&command.method==='setWaveform').map(command=>({channel:command.channel,pcm:command.args[1]?.pcm,adpcm:Array.from(command.args[1]?.adpcm??[]),options:command.args[2]})),from);
async function waveformState(page,label){
  const state=await refresh(page),wave=state.channels[23].waveform;
  assert(wave&&Array.isArray(wave.pcm)&&wave.pcm.length===112,label+': applied 112-sample PCM source');
  assert(wave.pcm.every(value=>Number.isFinite(value)&&value>=-1&&value<=1),label+': finite normalized PCM');
  assert.equal(wave.sample,state.channels[23].sample,label+': source metadata matches assigned private sample');return state;
}
async function shape(page,name){
  const from=await page.evaluate(()=>__ps1Audit.commands.length);await page.locator(action('wave-'+name)).click();
  await page.waitForFunction(from=>__ps1Audit.commands.slice(from).some(command=>command.type==='chip-inspector'&&command.method==='setWaveform'),from);
  const state=await waveformState(page,name+' waveform'),writes=await waveWrites(page,from);
  assert.equal(writes.length,1,'One shape button uploads one prepared waveform');assert.equal(writes[0].channel,23);assert.equal(writes[0].pcm.length,112);assert.equal(writes[0].adpcm.length,64,'ADPCM encoding completes before crossing the AudioWorklet port');
  return state;
}
async function checkWaveform(page){
  console.log('  Direct PCM drawing / private voice RAM / live timbre');
  const before=await refresh(page),untouched=waveSettings(before).slice(0,23),oldSamples=before.samples.map(sample=>({...sample}));
  assert.equal(before.channels[23].waveform,null,'An external/default sample is not falsely presented as known editable PCM');
  assert(await page.locator(control('wave-value')).isDisabled(),'Unknown sample point editor is disabled');
  let state=await shape(page,'triangle'),sample=state.samples.find(value=>value.id===state.channels[23].sample);
  assert.equal(sample.editorChannel,23);assert.equal(sample.byteLength,64);assert.equal(state.samples.length,before.samples.length+1);assert.equal(state.nextAddress,before.nextAddress+64);
  assert.deepEqual(state.samples.slice(0,oldSamples.length),oldSamples,'Original shared samples retain their descriptors');
  const privateSample={...sample},assertStable=state=>{
    assert.equal(state.samples.length,before.samples.length+1,'Repeated edits do not consume new sample IDs');assert.equal(state.nextAddress,before.nextAddress+64,'Repeated edits reuse the same 64 RAM bytes');
    assert.deepEqual(state.samples.find(value=>value.id===privateSample.id),privateSample,'Private sample ID, address and tuning stay fixed');
    assert.deepEqual(waveSettings(state).slice(0,23),untouched,'Editing CH24 leaves the other 23 voices and PCM sources untouched');assert.deepEqual(state.samples.slice(0,oldSamples.length),oldSamples,'The shared default sample is never overwritten');
  };
  assertStable(state);
  for(const name of ['saw','square','sine','triangle','sine']){state=await shape(page,name);assertStable(state);}
  const numericBefore=state.channels[23].waveform.pcm.slice(),numericFrom=await page.evaluate(()=>__ps1Audit.commands.length);
  await field(page,'wave-index',7);assert.equal((await waveWrites(page,numericFrom)).length,0,'Selecting a PCM index sends no audio update');
  await field(page,'wave-value',.25);await applied(page,'state.channels[23].waveform?.pcm[7]===.25','Numerical PCM point edit');
  state=await waveformState(page,'Numerical edit');assertStable(state);assert.equal((await waveWrites(page,numericFrom)).length,1);
  assert.deepEqual(state.channels[23].waveform.pcm.filter((_,index)=>index!==7),numericBefore.filter((_,index)=>index!==7),'Numeric edit preserves every other PCM point');

  const canvas=page.locator(control('waveform'));await canvas.evaluate(node=>node.scrollIntoView({block:'center'}));let box=await canvas.boundingBox();assert(box);
  const canceledBefore=state.channels[23].waveform.pcm.slice(),cancelFrom=await page.evaluate(()=>__ps1Audit.commands.length);
  await canvas.evaluate(node=>node.addEventListener('pointerdown',event=>{__ps1Audit.lastWavePointer=event.pointerId;},{once:true}));
  await page.mouse.move(box.x+2,box.y+box.height-2);await page.mouse.down();await page.mouse.move(box.x+box.width-3,box.y+2,{steps:16});
  assert.equal((await waveWrites(page,cancelFrom)).length,0,'Dragging only modifies a local draft');
  const pointerId=await page.evaluate(()=>__ps1Audit.lastWavePointer);assert(Number.isInteger(pointerId));
  await canvas.dispatchEvent('pointercancel',{pointerId});await page.mouse.up();state=await waveformState(page,'Canceled drawing');
  assert.equal((await waveWrites(page,cancelFrom)).length,0,'Canceled stroke never uploads an audio waveform');assert.deepEqual(state.channels[23].waveform.pcm,canceledBefore,'Canceled stroke restores applied PCM');assertStable(state);

  await canvas.evaluate(node=>node.scrollIntoView({block:'center'}));box=await canvas.boundingBox();const drawFrom=await page.evaluate(()=>__ps1Audit.commands.length);
  await page.mouse.move(box.x+2,box.y+box.height-2);await page.mouse.down();await page.mouse.move(box.x+box.width-3,box.y+2,{steps:20});
  assert.equal((await waveWrites(page,drawFrom)).length,0,'An unfinished stroke does not enter the audio thread');await page.mouse.up();
  state=await waveformState(page,'Completed drawing');const drawn=state.channels[23].waveform.pcm;
  assert.equal((await waveWrites(page,drawFrom)).length,1,'One completed stroke produces one prepared upload');assert(drawn.filter((value,index)=>value!==canceledBefore[index]).length>70,'Interpolation changes the full drawn section');assert(Math.min(...drawn)<-.7&&Math.max(...drawn)>.7,'Canvas controls both normalized PCM polarities');assertStable(state);

  await shape(page,'sine');await field(page,'reverb-send',false);await field(page,'reverb-preset','off');await field(page,'retrigger',true);await field(page,'audition-midi',69);await fastEnvelope(page);
  await latch(page,'Drawn instrument sine at A4');const sine=await capture(page,16384,440);state=await shape(page,'square');assertStable(state);await audible(page,'Live square edit retains A4 pitch',440);const square=await capture(page,16384,440);
  for(const pcm of [sine,square]){assertCapturePcm(pcm,'Edited sustained waveform');assert(pcm.channels.every(channel=>!channel.nonFinite&&channel.rms>.0001&&channel.peak<1&&Math.abs(channel.hz-440)<3),'Sustained edited waveform remains finite, unclipped and tuned');}
  const harmonicRatios={sine:sine.channels.map(channel=>channel.harmonics[2]/channel.harmonics[0]),square:square.channels.map(channel=>channel.harmonics[2]/channel.harmonics[0])};
  assert(harmonicRatios.square.every((ratio,index)=>ratio>harmonicRatios.sine[index]+.08),'Sine-to-square editing changes the actual third-harmonic content while held: '+JSON.stringify(harmonicRatios));
  await shape(page,'sine');await page.locator(action('release')).click();await silent(page,'Waveform audition release');state=await waveformState(page,'Final sine');assertStable(state);
  const copyCode=await page.locator(`${root} [data-chip-output="ps1-code"]`).textContent();assert(copyCode.includes('encodePs1Adpcm(')&&copyCode.includes('spu.loadADPCM('),'Generated voice code carries its PCM conversion and portable public upload');
  return {privateSample,sampleCount:state.samples.length,nextAddress:state.nextAddress,sharedDefaultPreserved:true,otherVoicesPreserved:true,canceledStrokeWrites:0,completedStrokeWrites:1,stableRamAcrossEdits:true,preparedBytesCrossPort:true,drawnRange:[Math.min(...drawn),Math.max(...drawn)],sine,square,harmonicRatios,pcm:state.channels[23].waveform.pcm.slice(),copyCode};
}
async function checkPortableWaveform(page,execution,waveform){
  console.log('  Public upload after editor allocation / portable copied voice');
  const marker='__PS1_PCM_PORTABLE__';
  await run(page,`const beforeUpload=await spu.getState();
const packets=new Uint8Array(64);for(let block=0;block<4;block++){packets[block*16]=4;packets[block*16+1]=block===0?6:block===3?3:0;for(let i=0;i<28;i++){const value=Math.round(7*Math.sin(2*Math.PI*(block*28+i)/112));packets[block*16+2+(i>>1)]|=(value&15)<<((i&1)*4);}}
const publicUpload=await spu.loadADPCM(packets,{baseFrequencyHz:44100/112,loopStartSamples:0});const allocated=await spu.getState();
spu.reset({clearRam:true});
${waveform.copyCode}
spu.noteOn(23,'A4');await sleep(1);
const snapshot=await spu.snapshot(),voice=snapshot.channels[23],bank=snapshot.samples.find(sample=>sample.id===voice.sample);
const expected=encodePs1Adpcm(new Float32Array(${JSON.stringify(waveform.pcm)}),{loopStartSamples:0});
log('${marker}'+JSON.stringify({beforeUpload,publicUpload,allocated,voice,bank,sampleCount:snapshot.samples.length,nextAddress:snapshot.nextAddress,bytes:Array.from(snapshot.ram.slice(bank.startAddress,bank.startAddress+bank.byteLength)),expected:Array.from(expected.adpcm)}));
liveLoop('portable-waveform',async()=>{await sleep(60);});`,execution);
  const result=await readLog(page,marker),lastId=Math.max(...result.beforeUpload.samples.map(sample=>sample.id));
  assert.equal(result.publicUpload.id,lastId+1,'A public upload after UI allocation gets the correct next ID in Main and Worker');assert.equal(result.publicUpload.startAddress,result.beforeUpload.nextAddress);assert.equal(result.allocated.samples.length,result.beforeUpload.samples.length+1);assert.equal(result.allocated.nextAddress,result.beforeUpload.nextAddress+64);
  assert.equal(result.bank.id,0,'Copied code works in a freshly cleared bank with different sample IDs');assert.equal(result.bank.startAddress,4096);assert.equal(result.bank.byteLength,64);assert.equal(result.sampleCount,1);assert.equal(result.nextAddress,4160);assert.equal(result.bank.editorChannel,undefined,'Copied code uses the ordinary portable sample API');assert.deepEqual(result.bytes,result.expected,'Copied PCM and public encoder reproduce the exact audible ADPCM bytes');
  const pcm=await audible(page,'Portable copied PCM voice at A4',440),stopped=await stop(page,'Portable waveform Stop');await healthy(page,'Portable waveform');return {...result,pcm,stopped};
}
async function checkPublicLiveEnvelope(page,execution){
  console.log('  Ordinary public ADSR APIs / primary and additional SPU');
  // Worker controls are deliberately reserved 0.5 s ahead; readback is immediate.
  // Wait beyond that lead before checking applied registers or capturing decay.
  const prefix='__PS1_PUBLIC_ADSR_',from=await page.evaluate(()=>__ps1Audit.commands.length);
  await run(page,`const primary=await useSoundChip('ps1');
const additional=await createSoundChip('ps1',{id:'ps1:public-adsr'});
const targets=[['primary',primary],['additional',additional]];
const encoded=encodePs1Adpcm(Float32Array.from({length:112},(_,i)=>.5*Math.sin(2*Math.PI*i/112)),{loopStartSamples:0});
for(const [,voice]of targets){const sample=await voice.loadADPCM(encoded.adpcm,{baseFrequencyHz:44100/112,loopStartSamples:0});voice.setPreset(23,{sample,volumeLeft:.2,volumeRight:.2,adsr1:15,adsr2:0x2000},{live:false});voice.setReverb({preset:'off'});}
async function report(kind,phase,voice){const state=await voice.getState(),ch=state.channels[23];log('${prefix}'+kind+'_'+phase+'__'+JSON.stringify({envelope:ch.envelope,gate:ch.gate,sample:ch.sample,adsr1:ch.adsr1,adsr2:ch.adsr2,volumeLeft:ch.volumeLeft,nativeFrames:state.nativeFrames,sampleCount:state.samples.length}));}
liveLoop('public-adsr-check',async()=>{
 for(const [kind,voice]of targets){
  voice.noteOn(23,'A4');await sleep(.6);await report(kind,'held',voice);await sleep(2);
  voice.setEnvelope(23,{attackRate:61});await sleep(1);await report(kind,'attack',voice);await sleep(2);
  voice.setEnvelope(23,{sustainRate:60,sustainDecrease:true},{live:false});voice.setPreset(23,{volumeLeft:.18,volumeRight:.18});await sleep(1);await report(kind,'deferred',voice);await sleep(2);
  for(const method of ['setEnvelope','setPreset','setChannel']){
   voice.setPreset(23,{adsr1:15,adsr2:0x2000},{live:false});voice.noteOn(23,'A4');await sleep(1);
   if(method==='setEnvelope')voice.setEnvelope(23,{sustainRate:60,sustainDecrease:true});else voice[method](23,{adsr2:0x6f00});
   await sleep(1);await report(kind,method,voice);await sleep(2);
  }
  voice.setEnvelope(23,{releaseRate:0});voice.keyOff(23);await sleep(1);await report(kind,'done',voice);
 }
 await sleep(60);
});`,execution);
  const results=[];
  for(const kind of ['primary','additional']){
    const marker=phase=>prefix+kind+'_'+phase+'__';
    const held=await readLog(page,marker('held')),initial=await audible(page,kind+' ordinary public held voice',440);
    assert.equal(held.envelope,32767,kind+': initial sustain reaches full level');assert.equal(held.gate,true);
    const attack=await readLog(page,marker('attack')),afterAttack=await capture(page,8192);assertCapturePcm(afterAttack,kind+' public attack during sustain');
    assert.equal(attack.envelope,32767,kind+': ordinary AR edit preserves the held level');assert.equal(attack.sample,held.sample);
    assert(afterAttack.channels.every((ch,index)=>!ch.nonFinite&&Math.abs(ch.rms/initial.channels[index].rms-1)<.1),kind+': AR alone does not restart or change a sustained note');
    const deferred=await readLog(page,marker('deferred')),afterDeferred=await capture(page,16384);assertCapturePcm(afterDeferred,kind+' public deferred envelope and volume patch');
    assert.equal(deferred.envelope,32767,kind+': explicit live false keeps the old envelope');assert.equal(deferred.adsr2&0x4fc0,0x4f00);
    assert(afterDeferred.channels.every((ch,index)=>!ch.nonFinite&&Math.abs(ch.rms/initial.channels[index].rms-.9)<.1),kind+': volume-only preset edits do not flush a deferred sustain slope');
    const setters=[];
    for(const method of ['setEnvelope','setPreset','setChannel']){
      const state=await readLog(page,marker(method)),pcm=await capture(page,16384);assertCapturePcm(pcm,kind+' public '+method);
      assert(state.envelope>0&&state.envelope<32767,kind+' '+method+': active ENVX changes without KON');assert.equal(state.gate,true);assert.equal(state.sample,held.sample);assert.equal(state.sampleCount,held.sampleCount);
      assert(pcm.channels.every(ch=>!ch.nonFinite&&ch.peak<1&&ch.rms>.0001&&ch.blockRms.at(-1)>0&&ch.blockRms.at(-1)<ch.blockRms[0]*.9),kind+' '+method+': the existing voice has a gradual audible sustain decay: '+JSON.stringify(pcm));
      setters.push({method,state,pcm});
    }
    const done=await readLog(page,marker('done'));assert.equal(done.gate,false);results.push({kind,held,initial,attack,afterAttack,deferred,afterDeferred,setters,done});
  }
  const commands=await commandsSince(page,from);assert(!commands.some(command=>command.type==='chip-inspector'),'Public API comparison sends no operator-inspector requests');
  const stopped=await stop(page,'Public live ADSR final Stop');await healthy(page,'Ordinary public live ADSR');return {publicCodeOnly:true,results,stopped};
}
async function checkEnvelope(page){
  console.log('  Decoded ADSR, reserved bit and channel isolation');
  const before=await refresh(page),untouched=settings(before).slice(0,23);
  assert.equal(before.channels[23].adsr2&0x2000,0x2000,'Authored reserved ADSR2 bit 13 is present');
  const changes=[['attack-rate','attackRate',33],['decay-rate','decayRate',7],['sustain-level','sustainLevel',10],['sustain-rate','sustainRate',88],['release-rate','releaseRate',12],['attack-exponential','attackExponential',true],['sustain-decrease','sustainDecrease',true],['sustain-exponential','sustainExponential',true],['release-exponential','releaseExponential',true]];
  const expected={...before.channels[23].envelopeParameters},results=[];
  for(const [controlName,key,value]of changes){
    expected[key]=value;await field(page,controlName,value);
    const state=await applied(page,`state.channels[23].envelopeParameters.${key}===${JSON.stringify(value)}`,'Applied '+key),voice=state.channels[23];
    assert.deepEqual(voice.envelopeParameters,expected,'Only the selected envelope field changes');
    const adsr1=(expected.attackExponential?0x8000:0)|(expected.attackRate<<8)|(expected.decayRate<<4)|expected.sustainLevel;
    const adsr2=0x2000|(expected.sustainExponential?0x8000:0)|(expected.sustainDecrease?0x4000:0)|(expected.sustainRate<<6)|(expected.releaseExponential?0x20:0)|expected.releaseRate;
    assert.equal(voice.adsr1,adsr1);assert.equal(voice.adsr2,adsr2,'Partial edits retain reserved ADSR2 bit 13');
    assert.deepEqual(settings(state).slice(0,23),untouched,'ADSR edits preserve the other 23 voices');results.push({key,value,adsr1,adsr2});
  }
  const from=await page.evaluate(()=>__ps1Audit.commands.length),old=await current(page);
  await field(page,'attack-rate',128);await page.waitForTimeout(80);
  assert(await page.locator(control('attack-rate')).evaluate(node=>!node.validity.valid),'Out-of-range UI value is rejected');
  assert(!(await commandsSince(page,from)).some(command=>command.type==='chip-inspector'&&command.action==='invoke'),'Invalid input sends no audio update');
  assert.equal((await current(page)).channels[23].adsr1,old.channels[23].adsr1);
  await field(page,'attack-rate',33);
  await page.locator(root).getByText('Raw ADSR words and voice JavaScript',{exact:true}).click();
  await field(page,'adsr1',0x822a);await applied(page,'state.channels[23].adsr1===0x822a','Advanced raw ADSR1');
  assert.equal(await page.locator(control('attack-rate')).inputValue(),'2','Raw ADSR updates its decoded rate');assert(await page.locator(control('attack-exponential')).isChecked());
  await field(page,'adsr2',0xe161);const raw=await applied(page,'state.channels[23].adsr2===0xe161','Advanced raw ADSR2');
  assert.equal(raw.channels[23].envelopeParameters.sustainRate,5);assert.equal(raw.channels[23].envelopeParameters.releaseRate,1);
  assert((await page.locator(`${root} [data-chip-output="ps1-code"]`).textContent()).includes('spu.setReverb('),'Generated voice JavaScript includes global reverb');
  await page.locator(root).getByText('Raw ADSR words and voice JavaScript',{exact:true}).click();
  const graph=await checkEnvelopeGraph(page);
  await field(page,'retrigger',true);await fastEnvelope(page);
  return {fields:results,graph,reservedBit13Preserved:true,otherVoicesPreserved:true,invalidInputRejected:true,rawWordsUpdateDecodedControls:true};
}
async function checkEnvelopeGraph(page){
  console.log('  Direct ADSR handles / keyboard steps / focus and idle safety');
  const editor=page.locator(control('envelope-editor')),canvas=page.locator(control('envelope'));
  const handle=name=>editor.locator(`[data-chip-envelope-handle="${name}"]`);
  assert.equal(await editor.locator('button[data-chip-envelope-handle]').count(),4,'All four ADSR stages have focusable graph handles');
  for(const name of ['attack','decay','sustain','release']){
    assert.equal(await handle(name).evaluate(node=>node.tabIndex),0,name+' handle is available from the keyboard');
    assert((await handle(name).getAttribute('aria-label'))?.length>0,name+' handle has an accessible name');
  }
  for(const [key,value]of Object.entries({'attack-rate':32,'decay-rate':4,'sustain-level':8,'sustain-rate':32,'release-rate':8}))await field(page,key,value);
  const before=await applied(page,'state.channels[23].envelopeParameters.attackRate===32&&state.channels[23].envelopeParameters.decayRate===4&&state.channels[23].envelopeParameters.sustainLevel===8&&state.channels[23].envelopeParameters.sustainRate===32&&state.channels[23].envelopeParameters.releaseRate===8','Graph starting envelope');
  const expected={...before.channels[23].envelopeParameters},untouched=settings(before).slice(0,23),selected=settings(before)[23],results=[];
  function assertApplied(state,label){
    const voice=state.channels[23];assert.deepEqual(voice.envelopeParameters,expected,label+': only the requested native ADSR fields change');
    assert.equal(voice.adsr2&0x2000,0x2000,label+': reserved ADSR2 bit 13 survives');
    assert.deepEqual(settings(state).slice(0,23),untouched,label+': the other 23 voices stay unchanged');
    for(const key of ['sample','volumeLeft','volumeRight','reverb'])assert.equal(voice[key],selected[key],label+': selected voice '+key+' stays unchanged');
  }
  await canvas.scrollIntoViewIfNeeded();
  const clickFrom=await page.evaluate(()=>__ps1Audit.commands.length);
  await handle('attack').click();await page.waitForTimeout(100);
  assert.deepEqual((await commandsSince(page,clickFrom)).filter(command=>command.type==='chip-inspector'),[],'A plain handle click neither rewrites quantized values nor polls the SPU');
  assertApplied(await current(page),'Plain handle click');
  for(const [name,key,value,min,max,limit,level]of [
    ['attack','attackRate',64,.07,.23,127],
    ['decay','decayRate',10,.30,.46,15,5],
    ['sustain','sustainRate',76,.55,.71,127],
    ['release','releaseRate',19,.80,.96,31],
  ]){
    await canvas.scrollIntoViewIfNeeded();await handle(name).scrollIntoViewIfNeeded();
    const point=await handle(name).boundingBox(),box=await canvas.boundingBox(),height=await canvas.evaluate(node=>node.height);assert(point&&box);
    const start={x:point.x+point.width/2,y:point.y+point.height/2};
    const target={x:box.x+box.width*(min+(max-min)*value/limit),y:level===undefined?start.y:box.y+box.height*(148-(level+1)/16*(148-18))/height};
    await page.evaluate(()=>{document.activeElement?.blur();__ps1Audit.graphFocus=document.activeElement;});
    const from=await page.evaluate(()=>__ps1Audit.commands.length);
    await page.mouse.move(start.x,start.y);await page.mouse.down();
    try{
      await page.mouse.move(target.x,target.y,{steps:5});
      if(name==='attack')await applied(page,`state.channels[23].envelopeParameters.${key}===${value}`,'Live ADSR edit reaches the SPU while the mouse remains held');
    }finally{await page.mouse.up();}
    expected[key]=value;if(level!==undefined)expected.sustainLevel=level;
    const predicate=Object.entries(expected).map(([key,value])=>`state.channels[23].envelopeParameters.${key}===${JSON.stringify(value)}`).join('&&');
    const state=await applied(page,predicate,'Dragged '+name+' handle');assertApplied(state,'Dragged '+name);
    assert.equal(await page.evaluate(()=>document.activeElement===__ps1Audit.graphFocus),true,'Mouse '+name+' drag preserves computer-keyboard focus');
    const writes=(await commandsSince(page,from)).filter(command=>command.type==='chip-inspector'&&command.method==='setEnvelope');
    assert(writes.length>0,name+' drag reaches the actual SPU inspector');
    const allowed=level===undefined?[key]:[key,'sustainLevel'];
    assert(writes.every(command=>command.channel===23&&command.args[2]?.live===true&&!Object.hasOwn(command.args[2],'retrigger')&&Object.keys(command.args[1]).every(key=>allowed.includes(key))),name+' drag sends only its native fields and the owned-note live option');
    results.push({handle:name,values:Object.fromEntries(allowed.map(key=>[key,expected[key]])),writes:writes.length});
  }
  for(const [name,key,arrow,delta]of [['attack','attackRate','ArrowRight',1],['decay','decayRate','ArrowLeft',-1],['decay','sustainLevel','ArrowUp',1],['sustain','sustainRate','ArrowRight',1],['release','releaseRate','ArrowLeft',-1]]){
    await handle(name).focus();await page.keyboard.press(arrow);expected[key]+=delta;
    const state=await applied(page,`state.channels[23].envelopeParameters.${key}===${expected[key]}`,'Keyboard '+name+' '+arrow);assertApplied(state,'Keyboard '+name+' '+arrow);
  }
  await page.waitForTimeout(100);const idleFrom=await page.evaluate(()=>__ps1Audit.commands.length);await page.waitForTimeout(300);
  assert.deepEqual((await commandsSince(page,idleFrom)).filter(command=>command.type==='chip-inspector'),[],'An idle graph neither redraws through audio requests nor polls the SPU');
  return {drags:results,keyboardSteps:5,plainClickWrites:0,idleInspectorRequests:0,liveMouseEdit:true,focusPreserved:true,reservedBit13Preserved:true,otherVoicesPreserved:true};
}
async function checkDeferredReleaseBeforeKeyOff(page){
  console.log('  Unchecked RR edits before key-off retain the old latch until the next note');
  const results=[];
  for(const [initialRate,deferredRate]of [[31,0],[0,31]]){
    await field(page,'retrigger',true);await fastEnvelope(page);await field(page,'release-rate',initialRate);
    await applied(page,`state.channels[23].envelopeParameters.releaseRate===${initialRate}`,'Initial release rate before the note');
    const original=await refresh(page),from=await page.evaluate(()=>__ps1Audit.commands.length);
    const initial=await latch(page,`RR${initialRate} note before deferred edit`,440);
    await field(page,'retrigger',false);await field(page,'release-rate',deferredRate);
    await applied(page,`state.channels[23].envelopeParameters.releaseRate===${deferredRate}`,'Unchecked release-rate edit while held');
    const held=await refresh(page);assert.equal(held.channels[23].gate,true);assert.equal(held.channels[23].envelope,0x7fff,'RR changes alone keep the old held sustain');
    await page.locator(action('release')).click();
    const firstRelease=initialRate===31?await audible(page,'Deferred RR0 must not silence the original RR31 release',440):await silent(page,'Deferred RR31 must not prolong the original RR0 release');
    const afterFirst=await refresh(page);assert.equal(afterFirst.channels[23].gate,false);assert.equal(afterFirst.channels[23].envelope,initialRate===31?0x7fff:0,'Manual key-off retains the original latched release rate');assert.deepEqual(afterFirst.auditions,[],'The released note does not keep an audition lease');
    assert.equal(await page.locator(control('retrigger')).isChecked(),false,'Apply edits remains unchecked until the next note-on');
    const nextNote=await latch(page,`Next note adopts deferred RR${deferredRate}`,440);
    await page.locator(action('release')).click();
    const nextRelease=deferredRate===31?await audible(page,'Next note uses the deferred RR31 release',440):await silent(page,'Next note uses the deferred RR0 release');
    const afterNext=await refresh(page);assert.equal(afterNext.channels[23].gate,false);assert.equal(afterNext.channels[23].envelope,deferredRate===31?0x7fff:0);assert.deepEqual(afterNext.auditions,[]);
    assert.equal(await page.locator(control('retrigger')).isChecked(),false,'Adopting deferred ADSR does not need the Apply edits checkbox');
    assert.deepEqual(settings(afterNext).slice(0,23),settings(original).slice(0,23),'Deferred release tests leave other voices unchanged');assert.deepEqual(afterNext.samples,original.samples,'Deferred release tests preserve the sample bank');
    const commands=(await commandsSince(page,from)).filter(command=>command.type==='chip-inspector');
    assert.equal(commands.filter(command=>command.method==='auditionOn').length,2,'Only the two deliberate UI key-ons acquire a voice');assert.equal(commands.filter(command=>command.method==='auditionOff').length,2,'Each deliberate note is released once');
    const edits=commands.filter(command=>command.method==='setEnvelope');assert.equal(edits.length,1,'The one deliberate RR edit sends one envelope patch');assert.equal(edits[0].args[1].releaseRate,deferredRate);
    assert(edits.every(command=>command.args[2]?.live===false&&!Object.hasOwn(command.args[2],'retrigger')),'The held RR edit explicitly stays deferred without rekeying');
    assert(!commands.some(command=>['noteOn','keyOn','_auditionKeyOn','_refreshEnvelope'].includes(command.method)),'Deferred edits never request an extra key-on or live refresh');
    // The last case deliberately leaves an RR31 tail. Clear it with the
    // already-supported explicit live edit, after both deferred-note checks.
    let cleanup=null;if(deferredRate===31){await field(page,'retrigger',true);await field(page,'release-rate',0);cleanup=await silent(page,'Explicit live RR0 cleanup after deferred-release test');}
    results.push({initialRate,deferredRate,initial,held,firstRelease,afterFirst,nextNote,nextRelease,afterNext,cleanup,checkboxUncheckedUntilNextNote:true,noExtraKeyOn:true,leasesReleased:true});
  }
  return results;
}
async function checkLiveEnvelope(page){
  console.log('  Latched audition / live levels and phase-preserving ADSR edits');
  await field(page,'reverb-send',false);await field(page,'reverb-preset','off');
  await field(page,'volume-left',.2);await field(page,'volume-right',.2);await field(page,'audition-midi',69);await fastEnvelope(page);
  assert.match(await page.locator(control('retrigger')).evaluate(node=>node.closest('label')?.textContent??node.parentElement.textContent),/Apply ADSR\s*\/\s*PCM edits/,'The option describes live editing, rather than re-keying every ADSR change');
  const initial=await latch(page),from=await page.evaluate(()=>__ps1Audit.commands.length);
  const original=await refresh(page),untouched=settings(original).slice(0,23),sample=original.channels[23].sample;
  await field(page,'volume-left',.1);await applied(page,'state.channels[23].volumeLeft===.1','Live left gain');const lower=await audible(page,'Live lower left gain',440);
  assert(lower.channels[0].rms<initial.channels[0].rms*.6&&lower.channels[0].rms>initial.channels[0].rms*.4,'Gain changes reach the sounding SPU voice');
  assert(Math.abs(lower.channels[1].rms/initial.channels[1].rms-1)<.1,'Left edit preserves right volume');
  await field(page,'volume-left',.2);await field(page,'retrigger',false);await field(page,'attack-rate',60);
  await field(page,'sustain-rate',60);await field(page,'sustain-decrease',true);
  await applied(page,'state.channels[23].envelopeParameters.attackRate===60&&state.channels[23].envelopeParameters.sustainRate===60&&state.channels[23].envelopeParameters.sustainDecrease','Queued next-note attack and decreasing sustain');
  const deferred=await audible(page,'Apply edits disabled retains the held envelope',440);
  assert(deferred.channels.every((channel,index)=>Math.abs(channel.rms/initial.channels[index].rms-1)<.1),'With live editing disabled, a decreasing sustain edit is deferred rather than applied to the held voice');
  // Restore a holding sustain while updates remain deferred. Enabling live
  // editing and changing AR during sustain must not return to the attack stage.
  await field(page,'sustain-rate',0);await field(page,'sustain-decrease',false);
  await field(page,'retrigger',true);await field(page,'attack-rate',61);
  await applied(page,'state.channels[23].envelopeParameters.attackRate===61','Owned held voice live attack setting');
  const heldAfterAttackEdit=await capture(page,8192);
  assert(heldAfterAttackEdit.channels.every((channel,index)=>!channel.nonFinite&&Math.abs(channel.rms/initial.channels[index].rms-1)<.1),'Changing AR during sustain retains the sounding level instead of restarting its two-second attack: '+JSON.stringify(heldAfterAttackEdit));assertCapturePcm(heldAfterAttackEdit,'Sustain-preserving attack edit');
  const afterAttack=await refresh(page);
  assert.equal(afterAttack.channels[23].envelope,0x7fff,'An attack edit leaves the held sustain level intact');
  assert.equal(afterAttack.channels[23].sample,sample,'Live ADSR keeps the assigned sample');
  // A decreasing linear SR60 takes about 1.7 s in this core, allowing a
  // bounded capture to distinguish an actual gradual slope from a KON reset.
  await field(page,'sustain-rate',60);await field(page,'sustain-decrease',true);
  await applied(page,'state.channels[23].envelopeParameters.sustainRate===60&&state.channels[23].envelopeParameters.sustainDecrease','Live decreasing sustain');
  const decreasing=await capture(page,16384);
  assert(decreasing.channels.every((channel,index)=>!channel.nonFinite&&channel.rms>initial.channels[index].rms*.4&&channel.blockRms.at(-1)<channel.blockRms[0]*.9&&channel.blockRms.at(-1)>0),'Live sustain editing changes the existing voice into a gradual audible decay: '+JSON.stringify(decreasing));assertCapturePcm(decreasing,'Live decreasing sustain');
  const afterDecay=await refresh(page);
  assert(afterDecay.channels[23].envelope>0&&afterDecay.channels[23].envelope<0x7fff,'The live ENVX level decays without an immediate zero reset');
  assert.equal(afterDecay.channels[23].sample,sample);assert.equal(afterDecay.channels[23].gate,true);
  assert.deepEqual(settings(afterDecay).slice(0,23),untouched,'Live ADSR edits leave all other voice settings intact');
  assert.deepEqual(afterDecay.samples,original.samples,'Live ADSR never reallocates or replaces sample RAM');
  const commands=await commandsSince(page,from),envelopes=commands.filter(command=>command.method==='setEnvelope');
  assert(envelopes.some(command=>command.args[0]===23&&command.args[1].attackRate===60&&command.args[2]?.live===false),'Deferred edit has explicit live false');
  assert(envelopes.some(command=>command.args[0]===23&&command.args[1].attackRate===61&&command.args[2]?.live===true),'Owned audition edit requests a live envelope refresh');
  assert(envelopes.every(command=>!Object.hasOwn(command.args[2]??{},'retrigger')),'ADSR changes never request a new key-on');
  await field(page,'sustain-decrease',false);await fastEnvelope(page);
  const heldWithFastRelease=await audible(page,'RR0 does not mute a voice before key-off',440),heldState=await refresh(page);
  assert.equal(heldState.channels[23].gate,true,'Changing RR alone does not release a held note');assert.equal(heldState.channels[23].envelope,0x7fff);
  await field(page,'release-rate',31);await applied(page,'state.channels[23].envelopeParameters.releaseRate===31','Slowest linear release before key-off');
  await page.locator(action('release')).click();assert.equal(await page.locator(action('sustain')).getAttribute('aria-pressed'),'false');
  const slowRelease=await audible(page,'RR31 remains audible after releasing the audition',440),slowState=await refresh(page);
  assert.equal(slowState.channels[23].gate,false,'The audition key is already off while its release tail sounds');assert(slowState.channels[23].envelope>0,'The release tail retains a nonzero live envelope');
  const tailFrom=await page.evaluate(()=>__ps1Audit.commands.length);
  await field(page,'retrigger',false);await field(page,'release-rate',0);await applied(page,'state.channels[23].envelopeParameters.releaseRate===0','Deferred RR0 register edit after key-off');
  const deferredRelease=await audible(page,'Unchecked live editing preserves the existing slow release',440),deferredState=await refresh(page);
  assert.equal(deferredState.channels[23].gate,false);assert(deferredState.channels[23].envelope>0,'A deferred release edit must not silently refresh the old slope');
  assert(deferredRelease.channels.every((ch,index)=>Math.abs(ch.rms/slowRelease.channels[index].rms-1)<.1),'The unchecked RR0 edit leaves the audible RR31 tail intact');
  // Restore the authored slow rate before enabling live edits, so RR0 is an
  // actual changed word rather than an unchanged deferred value being flushed.
  await field(page,'release-rate',31);await applied(page,'state.channels[23].envelopeParameters.releaseRate===31','Restore deferred RR31 before the live edit');
  await field(page,'retrigger',true);await field(page,'release-rate',0);await applied(page,'state.channels[23].envelopeParameters.releaseRate===0','Live RR0 edit after key-off');
  const released=await silent(page,'Live RR31 to RR0 edit stops the already-released audition'),releasedState=await refresh(page);
  assert.equal(releasedState.channels[23].envelope,0,'The actual SPU envelope reaches zero after the live release edit');assert.equal(releasedState.channels[23].gate,false);
  assert.equal(releasedState.channels[23].sample,sample);assert.deepEqual(releasedState.samples,original.samples,'Release-tail ADSR edits preserve sample RAM allocation');
  assert.deepEqual(settings(releasedState).slice(0,23),untouched,'Release-tail editing leaves the other voices unchanged');
  const tailCommands=(await commandsSince(page,tailFrom)).filter(command=>command.type==='chip-inspector');
  assert(tailCommands.some(command=>command.method==='setEnvelope'&&command.args[1].releaseRate===0&&command.args[2]?.live===false),'Unchecked release-tail edit explicitly defers live refresh');
  assert(tailCommands.some(command=>command.method==='setEnvelope'&&command.args[1].releaseRate===0&&command.args[2]?.live===true),'Checked release-tail edit requests live refresh even after audition key-off');
  assert(!tailCommands.some(command=>['auditionOn','noteOn','keyOn','_auditionKeyOn'].includes(command.method)||Object.hasOwn(command.args?.[2]??{},'retrigger')),'Release-tail edits never start a new note');
  const deferredBeforeKeyOff=await checkDeferredReleaseBeforeKeyOff(page);
  return {initial,lower,deferred,heldAfterAttackEdit,decreasing,released,releaseTail:{heldWithFastRelease,slowRelease,slowState,deferredRelease,deferredState,releasedState,heldReleaseRateDoesNotMute:true,deferredReleasePreserved:true,liveReleaseAfterKeyOff:true,noRetrigger:true},deferredBeforeKeyOff,liveGain:true,ownedLiveEnvelope:true,attackDuringSustainPreservesLevel:true,deferredSustain:true,otherVoicesPreserved:true,sampleBankPreserved:true};
}
async function checkReverb(page){
  console.log('  Per-voice send and global SPU reverb / wet tails');
  await fastEnvelope(page);await field(page,'volume-left',.2);await field(page,'volume-right',.2);
  const options=await page.locator(control('reverb-preset')+' option').evaluateAll(nodes=>nodes.map(node=>node.value));
  assert.deepEqual(options,['off','room','studio-small','studio-medium','studio-large','hall','space-echo','half-echo'],'All eight supported SPU reverb presets are exposed');
  await field(page,'reverb-left',.75);await field(page,'reverb-right',.75);await field(page,'reverb-preset','room');await field(page,'reverb-send',false);
  await applied(page,'state.reverb.preset==="room"&&state.reverb.volumeLeft===.75&&state.reverb.volumeRight===.75&&!state.channels[23].reverb','Global room / voice send off');
  await latch(page,'Room preset with selected voice dry');await page.locator(action('release')).click();const dryTail=await silent(page,'A dry voice has no reverb tail');
  const untouched=settings(await current(page)).slice(0,23);await field(page,'reverb-send',true);await applied(page,'state.channels[23].reverb','CH24 reverb send');
  assert.deepEqual(settings(await current(page)).slice(0,23),untouched,'Reverb send changes preserve the other 23 voices');
  const wet=await latch(page,'Selected voice feeds actual SPU room reverb',false);
  // Let the room delay fill before releasing its fast dry envelope.
  await capture(page,16384);await page.locator(action('release')).click();const wetTail=await capture(page,4096);
  assert(wetTail.channels.every(channel=>!channel.nonFinite&&channel.rms>.00001&&channel.peak<1),'Room has actual nonzero finite wet PCM after dry key-off: '+JSON.stringify(wetTail));assertCapturePcm(wetTail,'Wet tail');
  await field(page,'reverb-left',0);await field(page,'reverb-right',0);await applied(page,'state.reverb.volumeLeft===0&&state.reverb.volumeRight===0','Global return mute');
  const mutedReturn=await silent(page,'Zero reverb return mutes the remaining wet tail');
  await field(page,'reverb-left',.75);await field(page,'reverb-right',.5);await field(page,'reverb-preset','hall');
  await applied(page,'state.reverb.preset==="hall"&&state.reverb.volumeLeft===.75&&state.reverb.volumeRight===.5&&state.channels[23].reverb','Preset edit retains return levels and voice send');
  await latch(page,'Hall preset audition',false);await capture(page,16384);const beforeStop=await refresh(page),stopped=await stop(page,'Stop clears dry voices and wet tails');
  await page.locator('#ps1Tab').click();const retained=await refresh(page);
  assert.deepEqual(retained.reverb,beforeStop.reverb,'Stop retains chosen global reverb');assert.deepEqual(settings(retained),settings(beforeStop),'Stop retains voice/sample/envelope/send parameters');assert.deepEqual(retained.samples,beforeStop.samples,'Stop retains the sample bank');
  await field(page,'reverb-preset','off');await field(page,'reverb-send',false);await fastEnvelope(page);
  const afterStop=await latch(page,'Direct Sustain audition after normal transport Stop');await page.locator(action('release')).click();await silent(page,'Direct post-Stop Sustain release');
  return {options,dryTail,wet,wetTail,mutedReturn,stopped,afterStop,stopRetainsParameters:true,directAuditionAfterStop:true};
}
async function checkKeyboardAndLifecycle(page){
  console.log('  Operator Keyboard / pointer / channel change / hidden tab releases');
  await field(page,'audition-midi',69);await fastEnvelope(page);await page.locator(action('keyboard')).click();
  if(await page.locator('#bottomDock').evaluate(node=>!node.classList.contains('is-closed')&&node.getBoundingClientRect().height>1)){
    const close=page.locator('#bottomDock .dock-close');if(await close.isVisible())await close.click();
  }
  await page.locator('#keyboardPanel').waitFor({state:'visible'});
  assert(await page.locator('#keyboardPanel').evaluate(node=>node.classList.contains('is-floating-keyboard')),'Operators expose the shared floating Keyboard dialog');
  await page.locator('#operatorKeyboardRoot button').filter({hasText:/^Guitar$/}).click();
  const key=page.locator('#operatorKeyboardRoot .key').first(),letter=await key.getAttribute('data-key');assert(letter);
  const from=await page.evaluate(()=>__ps1Audit.commands.length);await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down(letter);
  let pc;try{pc=await audible(page,'Floating Guitar PC key on selected CH24');}finally{await page.keyboard.up(letter);}await silent(page,'Operator PC key release');
  assert((await commandsSince(page,from)).some(command=>command.method==='auditionOn'&&command.channel===23),'Operator PC key targets physical CH24');
  // The compact floating dialog intentionally shows target / layout controls,
  // not the large Guitar grid. Open the full Keyboard dock for pointer keys.
  if(!await page.locator('#keyboardTab').isVisible())await page.locator('.dock-toggle').click();
  await page.locator('#keyboardTab').click();await key.waitFor({state:'visible'});
  const rect=await key.boundingBox();assert(rect);await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();let pointer;
  try{pointer=await audible(page,'Floating Guitar pointer on CH24');}finally{await releaseOutside(page);}await silent(page,'Operator pointer release');
  await page.locator('#ps1Tab').click();
  await page.locator(action('sustain')).click();await audible(page,'Latched note before channel change');await page.locator(`${root} [data-chip-channel="22"]`).click();await silent(page,'Selecting a different voice releases the old latched voice');
  await page.locator(`${root} [data-chip-channel="23"]`).click();await page.locator(action('sustain')).click();await audible(page,'Latched note before hidden tab');
  await page.locator('#codeTab').click();await silent(page,'Hiding the Operators tab releases its latched note');
  const hiddenAt=await page.evaluate(()=>__ps1Audit.commands.length);await page.waitForTimeout(450);
  assert.deepEqual((await commandsSince(page,hiddenAt)).filter(command=>command.type==='chip-inspector'),[],'Hidden panel adds no inspector polling');
  await page.locator('#ps1Tab').click();await refresh(page);const idleAt=await page.evaluate(()=>__ps1Audit.commands.length);await page.waitForTimeout(500);
  const idle=(await commandsSince(page,idleAt)).filter(command=>command.type==='chip-inspector');assert.deepEqual(idle,[],'An idle visible panel never polls or writes audio');
  await startHold(page);await audible(page,'Hold before window blur');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await silent(page,'Window blur releases panel Hold');await releaseOutside(page);
  return {channel:23,pc,pointer,floatingKeyboard:true,hiddenInspectorRequests:0,idleInspectorRequests:0,channelChangeRelease:true,hideRelease:true,windowBlurRelease:true};
}
async function checkDisconnect(page,execution){
  console.log('  Additional SPU disconnect releases its latched audition');
  const marker='__PS1_EDITOR_EXTRA_DISPOSED__';
  await run(page,`const extra=await createSoundChip('ps1',{id:'ps1:operators-disconnect'});
log('__PS1_EDITOR_EXTRA_READY__');
liveLoop('dispose-editor-target',async()=>{await sleep(4);await extra.dispose();log('${marker}');await sleep(60);});`,execution);
  await waitLog(page,'__PS1_EDITOR_EXTRA_READY__');await page.locator('#ps1Tab').click();
  await page.locator(instance).selectOption('ps1:operators-disconnect');await refresh(page);await page.locator(`${root} [data-chip-channel="23"]`).click();await field(page,'audition-midi',69);
  const sounding=await latch(page,'Additional SPU target before disconnect');await waitLog(page,marker);const released=await silent(page,'Disconnected SPU cannot keep an audition sounding');
  await page.waitForFunction(selector=>!Array.from(document.querySelector(selector)?.options??[]).some(option=>option.value==='ps1:operators-disconnect'),instance);
  await stop(page,'Disconnect Stop');return {sounding,released,disposedTargetRemoved:true};
}
async function screenshots(page,name,execution){
  if(!config.screenshots||execution!=='main')return [];
  await fs.mkdir(config.screenshots,{recursive:true});await page.locator('#ps1Tab').click();const results=[];
  for(const [label,width,height]of [['desktop',1600,1150],['mobile',390,844]]){
    await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    if(config.psfOnly)await page.locator(action('psf-open')).evaluate(node=>node.scrollIntoView({block:'center'}));
    const size=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,panel:document.getElementById('ps1Panel').getBoundingClientRect().width}));
    assert(size.document<=size.viewport+1,'SPU sound design fits the viewport: '+JSON.stringify(size));
    const file=path.join(config.screenshots,`${name}-ps1-voice-${label}.png`);await page.screenshot({path:file,fullPage:true});results.push({label,path:file,...size});
  }
  if(config.psfOnly)return results;
  await page.setViewportSize({width:1600,height:1150});
  if(await page.locator('#bottomDock .dock-close').isVisible())await page.locator('#bottomDock .dock-close').click();
  await page.locator(control('waveform')).evaluate(node=>node.scrollIntoView({block:'center'}));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const file=path.join(config.screenshots,`${name}-ps1-pcm-desktop.png`);await page.screenshot({path:file});results.push({label:'pcm-desktop',path:file});
  await page.locator(control('envelope-editor')).evaluate(node=>node.scrollIntoView({block:'center'}));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const envelope=path.join(config.screenshots,`${name}-ps1-envelope-desktop.png`);await page.screenshot({path:envelope});results.push({label:'envelope-desktop',path:envelope});return results;
}
async function checkVab(page,execution){
  console.log('  VAB combined/split import / physical voice / original bytes / actual PCM / Keyboard / malformed file');
  const {createVabFixture}=await import('../test/helpers/spu_vab_fixture.mjs'),{vab,vh,vb}=createVabFixture();
  const marker='__VAB_PLAYGROUND_READY__';await run(page,`await sleep(.01);log('${marker}');`,execution);await waitLog(page,marker);await stop(page,'VAB initial Stop');
  if(execution==='worker')assert(await page.evaluate(()=>__ps1Audit.workers.some(url=>/\/playground_logic_worker\.js(?:\?|$)/.test(url))));
  await page.locator('#ps1Tab').click();await refresh(page);await page.locator(`${root} [data-chip-channel="23"]`).click();
  const before=await refresh(page),file=page.locator(control('vab-file')),status=page.locator(`${root} [data-chip-output="ps1-vab-status"]`);
  await file.setInputFiles({name:'original.vab',mimeType:'application/octet-stream',buffer:Buffer.from(vab)});
  await page.waitForFunction(()=>document.querySelector('[data-chip-output="ps1-vab-status"]').textContent.startsWith('original.vab:'));
  assert.equal(await page.locator(`${control('vab-tone')} option`).count(),3);
  assert.equal((await refresh(page)).nextAddress,before.nextAddress,'Opening a VAB does not upload any sample');
  await page.locator(control('vab-tone')).selectOption('1');await page.locator(action('vab-load')).click();
  await page.waitForFunction(()=>document.querySelector('[data-chip-output="ps1-vab-status"]').textContent.includes('into Voice 24'));
  const imported=await refresh(page),sample=imported.samples.find(item=>item.id===imported.channels[23].sample);
  assert.deepEqual(settings(imported).slice(0,23),settings(before).slice(0,23),'Other physical voices retain their instruments');
  assert.equal(sample.byteLength,64);assert.equal(sample.rootFrequencyHz,440*2**((59.5-69)/12));assert.equal(imported.channels[23].adsr1,15);assert.equal(imported.channels[23].adsr2,0);
  const uploads=await page.evaluate(()=>__ps1Audit.commands.filter(c=>c.method==='loadTone').map(c=>c.args));
  const {createPs1InitSample}=await import('../web/ps1synth.js');assert.deepEqual(Object.values(uploads.at(-1)[1]),Array.from(createPs1InitSample().adpcm));
  await field(page,'audition-midi',60);const hz=44100/112*2**(.5/12);
  const pcm=await latch(page,'Imported VAB fine-tuned Tone',hz);await page.locator(action('release')).click();await silent(page,'Imported VAB release');
  await page.locator(action('vab-load')).click();await page.waitForFunction(()=>!document.querySelector('[data-chip-action="ps1-vab-load"]').disabled);
  assert.equal((await refresh(page)).nextAddress,imported.nextAddress,'Repeated Tone loads reuse current RAM');
  await page.locator(action('keyboard')).click();await page.locator('#keyboardPanel').waitFor({state:'visible'});
  const key=page.locator('#operatorKeyboardRoot .key').first(),letter=await key.getAttribute('data-key');assert(letter);
  await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down(letter);const keyboard=await audible(page,'Imported VAB through Operator Keyboard');await page.keyboard.up(letter);await silent(page,'VAB Keyboard release');
  await page.locator('#ps1Tab').click();
  await file.setInputFiles([{name:'pair.vb',mimeType:'application/octet-stream',buffer:Buffer.from(vb)},{name:'pair.vh',mimeType:'application/octet-stream',buffer:Buffer.from(vh)}]);
  await page.waitForFunction(()=>document.querySelector('[data-chip-output="ps1-vab-status"]').textContent.startsWith('pair.vh:'));
  await page.locator(action('vab-load')).click();await page.waitForFunction(()=>document.querySelector('[data-chip-output="ps1-vab-status"]').textContent.startsWith('Loaded pair.vh'));
  const split=await refresh(page);assert.equal(split.samples.find(item=>item.id===split.channels[23].sample).rootFrequencyHz,440*2**((60-69)/12));
  await latch(page,'Split VAB Tone',44100/112);const held=await refresh(page);
  await file.setInputFiles({name:'bad.vab',mimeType:'application/octet-stream',buffer:Buffer.from(vab.slice(0,-1))});
  await page.waitForFunction(()=>document.querySelector('[data-chip-output="ps1-vab-status"]').dataset.error==='true');
  assert.deepEqual((await refresh(page)).auditions,held.auditions);await audible(page,'Rejected VAB keeps held voice',44100/112);
  assert.match(await status.textContent(),/Previous bank is kept/);await page.locator(action('release')).click();await silent(page,'VAB rejected file release');
  // Reset replaces the bank; a repeated upload must not reuse a stale sample ID.
  await run(page,`spu.reset({clearRam:true});log('${marker}');`,execution);await waitLog(page,marker);await stop(page,'VAB reset Stop');
  await page.locator('#ps1Tab').click();await refresh(page);
  await file.setInputFiles({name:'after-reset.vab',mimeType:'application/octet-stream',buffer:Buffer.from(vab)});
  await page.waitForFunction(()=>document.querySelector('[data-chip-output="ps1-vab-status"]').textContent.startsWith('after-reset.vab:'));
  await page.locator(control('vab-tone')).selectOption('1');await page.locator(action('vab-load')).click();await page.waitForFunction(()=>document.querySelector('[data-chip-output="ps1-vab-status"]').textContent.startsWith('Loaded after-reset.vab'));
  const afterReset=await refresh(page);assert.equal(afterReset.samples.length,1);assert.equal(afterReset.samples[0].id,0);
  await latch(page,'VAB after clear RAM',hz);await page.locator(action('release')).click();await silent(page,'Final VAB release');
  const layouts=[];
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const size=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,panel:document.getElementById('ps1Panel').scrollWidth}));assert(size.document<=size.viewport+1,JSON.stringify(size));layouts.push(size);}
  return {combined:true,split:true,physicalVoice:23,otherVoicesPreserved:true,originalBytes:true,ramReused:true,resetSafe:true,invalidBankKeepsHeldNote:true,pcm,keyboard,layouts};
}

async function checkPsf(page,execution){
  console.log('  PSF static extraction / MiniPSF libraries / folder paths / bank switching / SPU PCM');
  const {createPsfFixture,createPsfConflictFixture,makePsf}=await import('../test/helpers/spu_psf_fixture.mjs');
  const fixture=createPsfFixture(),mimeType='application/octet-stream';
  const marker='__PSF_UI_READY__';await run(page,`await sleep(.01);log('${marker}');`,execution);await waitLog(page,marker);await stop(page,'PSF initial Stop');
  if(execution==='worker')assert(await page.evaluate(()=>__ps1Audit.workers.some(url=>/\/playground_logic_worker\.js(?:\?|$)/.test(url))));
  await page.locator('#ps1Tab').click();await refresh(page);await page.locator(`${root} [data-chip-channel="23"]`).click();
  const file=page.locator(control('psf-file')),status=page.locator(`${root} [data-chip-output="ps1-vab-status"]`);
  const waitOpened=()=>page.waitForFunction(()=>document.querySelector('[data-chip-output="ps1-vab-status"]').textContent.startsWith('Opened '));
  const waitExtracted=()=>page.waitForFunction(()=>document.querySelector('[data-chip-output="ps1-vab-status"]').textContent.startsWith('Extracted '));
  const waitLoaded=()=>page.waitForFunction(()=>document.querySelector('[data-chip-output="ps1-vab-status"]').textContent.startsWith('Loaded '));
  const before=await refresh(page);
  await file.setInputFiles({name:'original.psf',mimeType,buffer:Buffer.from(fixture.standalone)});await waitOpened();
  await page.locator(action('psf-extract')).click();await waitExtracted();
  assert.equal(await page.locator(`${control('vab-bank')} option`).count(),2);assert.equal((await refresh(page)).nextAddress,before.nextAddress,'PSF extraction never uploads to live RAM');
  await page.locator(control('vab-bank')).selectOption('1');await page.locator(control('vab-tone')).selectOption('1');await page.locator(action('vab-load')).click();await waitLoaded();
  const imported=await refresh(page);assert.deepEqual(settings(imported).slice(0,23),settings(before).slice(0,23));
  await field(page,'audition-midi',60);const pcm=await latch(page,'PSF-extracted fine tuned Tone',44100/112*2**(.5/12));await page.locator(action('release')).click();await silent(page,'PSF Tone release');
  const flatMini=makePsf(Uint8Array.of(0),0x80010845,'_lib=Bank.psflib\n_lib2=patch.psflib');
  await file.setInputFiles([{name:'track.minipsf',mimeType,buffer:Buffer.from(flatMini)},{name:'Bank.psflib',mimeType,buffer:Buffer.from(fixture.library)},{name:'patch.psflib',mimeType,buffer:Buffer.from(fixture.patch)}]);await waitOpened();
  assert.equal(await page.locator(`${control('psf-entry')} option`).count(),1);
  await page.locator(action('psf-extract')).click();await waitExtracted();assert.match(await status.textContent(),/3 program overlays/);
  // Missing dependencies and successful scans with no supported bank are distinct.
  await file.setInputFiles({name:'missing.minipsf',mimeType,buffer:Buffer.from(flatMini)});await waitOpened();await page.locator(action('psf-extract')).click();
  await page.waitForFunction(()=>document.querySelector('[data-chip-output="ps1-vab-status"]').dataset.error==='true');assert.match(await status.textContent(),/missing PSFLib/);
  assert.equal((await refresh(page)).channels[23].sample,imported.channels[23].sample);
  await file.setInputFiles({name:'plain.psf',mimeType,buffer:Buffer.from(makePsf(new Uint8Array(2048)))});await waitOpened();await page.locator(action('psf-extract')).click();
  await page.waitForFunction(()=>document.querySelector('[data-chip-output="ps1-vab-status"]').textContent.startsWith('No standard VAB'));
  assert.equal(await status.getAttribute('data-error'),'false');assert.equal(await page.locator(`${control('vab-bank')} option`).count(),2);
  const conflictDiagnostics=[];
  for(const kind of ['vab','seq']) {
    const conflict=createPsfConflictFixture(kind);
    await file.setInputFiles({name:`ambiguous-${kind}.psf`,mimeType,buffer:Buffer.from(conflict.psf)});await waitOpened();
    await page.locator(action('psf-extract')).click();
    await page.waitForFunction(()=>document.querySelector('[data-chip-output="ps1-vab-status"]').textContent.includes('VH/VB mapping is uncertain'));
    const text=await status.textContent();assert.match(text,/Skipped 1 VAB candidate/);
    assert.equal((await refresh(page)).channels[23].sample,imported.channels[23].sample,'Conflict scan never changes the live instrument');
    assert.equal(await page.locator(`${control('vab-bank')} option`).count(),1);
    conflictDiagnostics.push({kind,status:text});
  }
  // Use a real directory upload, rather than inventing webkitRelativePath.
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'spu-psf-folder-'));
  try {
    for(const entry of fixture.files){const target=path.join(directory,entry.webkitRelativePath);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,Buffer.from(await entry.arrayBuffer()));}
    await fs.writeFile(path.join(directory,'readme.txt'),'Not a PSF');
    await page.locator(control('psf-folder')).setInputFiles(directory);await waitOpened();await page.locator(action('psf-extract')).click();await waitExtracted();
    assert.equal(await page.locator(`${control('vab-bank')} option`).count(),2);
    await page.locator(control('vab-tone')).selectOption('1');await page.locator(action('vab-load')).click();await waitLoaded();
    await latch(page,'Folder MiniPSF extracted Tone',44100/112*2**(.5/12));await page.locator(action('release')).click();await silent(page,'Folder PSF release');
  }finally{await fs.rm(directory,{recursive:true,force:true});}
  let realSet=null;
  if(config.psfSet){
    const files=(await fs.readdir(config.psfSet)).filter(name=>/\.(?:psf1?|minipsf1?|psflib|psf1lib)$/i.test(name)).map(name=>path.join(config.psfSet,name));
    await file.setInputFiles(files);await waitOpened();
    if(config.psfEntry)await page.locator(control('psf-entry')).selectOption(config.psfEntry);
    await page.locator(action('psf-extract')).click();await waitExtracted();
    const tone=await page.locator(control('vab-tone')).inputValue();assert(tone!=='','Real set has a playable Tone');
    const unavailable=await page.locator(`${control('vab-tone')} option:disabled`).count();
    await page.locator(action('vab-load')).click();await waitLoaded();
    const state=await refresh(page),voice=state.channels[23],sample=state.samples.find(item=>item.id===voice.sample);
    await field(page,'audition-midi',55);const realPcm=await latch(page,'Real PSF extracted Tone',false);await page.locator(action('release')).click();await stop(page,'Real PSF final Stop');
    realSet={entry:config.psfEntry,toneIndex:Number(tone),unavailableTones:unavailable,sample,adsr1:voice.adsr1,adsr2:voice.adsr2,pcm:realPcm};
  }
  return {standalone:true,mini:true,folder:true,twoBanks:true,noCpuExecution:true,extractionDoesNotUpload:true,missingLibraryDiagnostic:true,noBankDiagnostic:true,conflictDiagnostics,pcm,realSet};
}

async function runCase(browser,name,origin,host,execution){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1600,height:1150}});
  await context.addInitScript({content:`globalThis.__ps1ClockAnalysis={pilot:${analyzePilotPcm.toString()},clock:${analyzeClockRows.toString()}};`});
  await context.addInitScript(instrumentation);
  const page=await context.newPage();page.setDefaultTimeout(40000);const errors=[],badResponses=[],consoleErrors=[];
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));
  page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
  try{
    console.log(`CHECK ${name}/${execution}: ${host.archive?'Run ZIP':'source'}`);
    await page.goto(origin+host.entry+'?mode=ps1&no-sw=1',{waitUntil:'domcontentloaded'});await ready(page);
    await page.locator('#ps1Tab').click();assert.equal(await page.evaluate(()=>__ps1Audit.contexts.length),0,'Opening Operators remains audio-lazy');
    await page.locator(`${root} [data-chip-action="prepare"]`).click();await page.locator(control('attack-rate')).waitFor({state:'visible'});
    assert.equal(await page.locator(`${root} [data-chip-channel]`).count(),24,'All 24 hardware voices can be selected');
    if(config.vabOnly||config.psfOnly){
      const vab=config.vabOnly?await checkVab(page,execution):undefined,psf=config.psfOnly?await checkPsf(page,execution):undefined,images=await screenshots(page,name,execution);
      await healthy(page,'VAB final state');assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);
      const muted=await page.evaluate(()=>[...__ps1Audit.sinks.values()].every(sink=>sink.gate.gain.value===0));assert(muted);
      const captureContinuity=await page.evaluate(()=>({captures:__ps1Audit.captures.length,frames:__ps1Audit.captures.reduce((n,c)=>n+c.frames,0),pcmContinuous:__ps1Audit.captures.every(c=>c.pilot.continuous&&c.clock.measurementValid&&c.clock.frames===c.frames),clockContinuous:__ps1Audit.captures.every(c=>c.clock.continuous),clockAnomalies:__ps1Audit.captures.filter(c=>!c.clock.continuous)}));
      assert(captureContinuity.pcmContinuous);
      return {browser:name,version:browser.version(),execution,vab,psf,screenshots:images,physicalOutputMuted:muted,listeningPerformed:false,captureContinuity};
    }
    // The muted authored CH2 continues changing independently while edits and
    // auditions claim CH24. A real logic Worker is used for the Worker route.
    const marker='__PS1_EDITOR_PROGRAM_READY__';
    await run(page,`spu.setPreset(23,{sample:0,volumeLeft:.2,volumeRight:.2,adsr1:15,adsr2:0x2000});
spu.setPreset(1,{sample:0,volumeLeft:0,volumeRight:0});
liveLoop('other-voice',async()=>{spu.noteOn(1,'C3');await sleep(.2);spu.noteOn(1,'C5');await sleep(.2);});
await sleep(1);log('${marker}');`,execution);await waitLog(page,marker);
    if(execution==='worker')assert(await page.evaluate(()=>__ps1Audit.workers.some(url=>/\/playground_logic_worker\.js(?:\?|$)/.test(url))),'Actual logic Worker was used');
    await page.locator('#ps1Tab').click();await page.locator(`${root} [data-chip-channel="23"]`).click();await field(page,'audition-midi',69);await refresh(page);
    const waveform=await checkWaveform(page),envelope=await checkEnvelope(page),liveEnvelope=await checkLiveEnvelope(page);
    const otherPitches=[];for(let i=0;i<6;i++){otherPitches.push((await refresh(page)).channels[1].pitch);await page.waitForTimeout(90);}
    assert(new Set(otherPitches).size>1,'Muted CH2 keeps progressing while CH24 is edited and auditioned');
    const reverb=await checkReverb(page),keyboard=await checkKeyboardAndLifecycle(page),images=await screenshots(page,name,execution),disconnect=await checkDisconnect(page,execution);
    console.log('  Authored error / next audition recovery');
    await run(page,"spu.setReverb({preset:'not-a-preset'});",execution);await page.waitForFunction(()=>document.getElementById('consoleOutput').textContent.includes('preset'));
    await stop(page,'Authored error Stop');
    await page.locator('#ps1Tab').click();await refresh(page);await page.locator(`${root} [data-chip-channel="23"]`).click();await field(page,'audition-midi',69);
    const recovery=await latch(page,'Operators audition recovers after an authored API error');await stop(page,'Final Stop');await healthy(page,'Final state');
    const portableWaveform=await checkPortableWaveform(page,execution,waveform),publicLiveEnvelope=await checkPublicLiveEnvelope(page,execution);
    const audit=await page.evaluate(()=>({worklets:__ps1Audit.worklets.map(entry=>entry.name),workers:__ps1Audit.workers,processorErrors:__ps1Audit.processorErrors,physicalOutputMuted:[...__ps1Audit.sinks.values()].every(sink=>sink.gate.gain.value===0),
      captureContinuity:{captures:__ps1Audit.captures.length,frames:__ps1Audit.captures.reduce((n,c)=>n+c.frames,0),
        pcmContinuous:__ps1Audit.captures.every(c=>c.pilot.continuous&&c.clock.measurementValid&&c.clock.frames===c.frames),
        clockContinuous:__ps1Audit.captures.every(c=>c.clock.continuous),
        clockAnomalies:__ps1Audit.captures.filter(c=>!c.clock.continuous)}}));
    assert(audit.worklets.includes('tetorica-playground-ps1'),'Actual SPU Worklet is used');assert.deepEqual(audit.processorErrors,[]);assert(audit.physicalOutputMuted);assert(audit.captureContinuity.pcmContinuous);
    assert.deepEqual(errors,[],'No browser exceptions');assert.deepEqual(badResponses,[],'No missing runtime assets');
    return {browser:name,version:browser.version(),execution,waveform,portableWaveform,envelope,liveEnvelope,publicLiveEnvelope,otherVoiceProgress:{channel:1,pitches:otherPitches},reverb,keyboard,screenshots:images,disconnect,recovery,...audit};
  }catch(error){
    const state=await page.evaluate(()=>({status:document.getElementById('status')?.textContent,log:document.getElementById('consoleOutput')?.textContent,instance:document.querySelector('#ps1Panel [data-chip-control="instance"]')?.value,panel:document.getElementById('ps1Panel')?.textContent,contexts:__ps1Audit?.contexts.map(value=>({state:value.state,sampleRate:value.sampleRate})),gains:__ps1Audit?.gains.map(value=>({value:value.gain.value,contextState:value.context.state})),worklets:__ps1Audit?.worklets,captures:__ps1Audit?.captures.slice(-5),commands:__ps1Audit?.commands.slice(-20)})).catch(()=>null);
    throw Error(`${name}/${execution}: ${error.message}\n${JSON.stringify({state,errors,badResponses,consoleErrors})}`,{cause:error});
  }finally{await context.close();}
}

(async()=>{
  const helperPath=require.resolve('./audio_clock_audit.cjs');
  const checkerSha256=hash(await fs.readFile(__filename)),captureHelperSha256=hash(await fs.readFile(helperPath)),host=await selectHost();let server;
  try{
    server=http.createServer(async(request,response)=>{
      try{
        const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
        if(pathname==='/__ps1_voice_capture.js'){response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(captureSource);return;}
        let file=path.resolve(host.directory,'.'+pathname);assert(file===host.directory||file.startsWith(host.directory+path.sep),'Outside selected host');if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
        const bytes=await fs.readFile(file),name=path.relative(host.directory,file),sha256=hash(bytes);if(served.has(name))assert.equal(served.get(name).sha256,sha256,'Source changed during browser check: '+name);served.set(name,{bytes:bytes.length,sha256});
        const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'};
        response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
      }catch(error){response.writeHead(404).end(error.message);}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const results=[];
    for(const name of config.engines){
      const browser=await ({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
      try{for(const execution of config.executions){results.push(await runCase(browser,name,`http://127.0.0.1:${server.address().port}`,host,execution));console.log(`PASS ${name}/${execution}: live ADSR, CH24, Keyboard, SPU reverb, wet tail, Stop, disconnect and recovery; physical output muted.`);}}
      finally{await browser.close();}
    }
    for(const [name,entry]of served)assert.equal(hash(await fs.readFile(path.join(host.directory,name))),entry.sha256,'Source remained frozen: '+name);
    assert.equal(hash(await fs.readFile(__filename)),checkerSha256,'Checker bytes remained frozen throughout execution');
    assert.equal(hash(await fs.readFile(helperPath)),captureHelperSha256,'Capture helper remained frozen throughout execution');
    const report={schemaVersion:3,passed:true,clockContinuous:results.every(r=>r.captureContinuity.clockContinuous),continuityOracle:'independent-24-bit-pilot-PCM',physicalOutputMuted:true,listeningPerformed:false,publicUiOnly:true,repositoryFallback:false,host:host.directory,archive:host.archive,results,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),checkerSha256,captureHelperSha256};
    if(config.out)await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`PS1 Operators browser check passed: ${results.length} routes${config.out?'; '+config.out:''}.`);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));if(host.temporary)await fs.rm(host.temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
