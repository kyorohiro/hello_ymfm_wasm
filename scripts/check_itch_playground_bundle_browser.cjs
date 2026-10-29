// Exercise an isolated, already packaged Playground through its public UI.
// No private app hooks or repository asset fallbacks: safe after minification.
// Actual final PCM is captured by a test-only Worklet; physical output is zero.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const args=process.argv.slice(2),option=name=>args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
const help='Usage: node scripts/check_itch_playground_bundle_browser.cjs (--root=STAGE | --zip=ARCHIVE) [--out=REPORT] [--images=DIR] [--chromium|--webkit] [--modes=genesis,mega-cd,gameboy,nes,wonderswan,pokey,pokey-dual]';
if(args.includes('--help')){console.log(help);process.exit(0);}
for(const arg of args)assert(['--chromium','--webkit'].includes(arg)||/^--(?:root|zip|out|images|modes)=/.test(arg),help);
assert(!!option('root')!==!!option('zip'),help);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const out=path.resolve(option('out')??'/private/tmp/itch-playground-bundle-browser.json');
const images=path.resolve(option('images')??'/private/tmp/itch-playground-bundle-browser-images');
const modes=(option('modes')??'genesis,mega-cd,gameboy,nes,wonderswan').split(',');
assert(modes.length&&new Set(modes).size===modes.length&&modes.every(mode=>['genesis','mega-cd','gameboy','nes','wonderswan','pokey','pokey-dual'].includes(mode)),'Unknown or repeated mode');
// Read-only numerical expectations, never a Browser runtime asset fallback.
let pokeyCalibration=null;
function pokeyRoutes(mode){return (mode==='pokey'?['primary']:['dual-first','dual-second']).map(role=>{
 const route=pokeyCalibration?.calibration.routes.find(route=>route.role===role);assert(route&&route.mode===mode&&Number.isFinite(route.volume)&&route.volume>0&&route.volume<=2,'Measured POKEY System source gain');return route;
});}
const browsers=args.includes('--chromium')?[['chromium',chromium]]:args.includes('--webkit')?[['webkit',webkit]]:[['chromium',chromium],['webkit',webkit]];
const nested='/html/9876543/playground';
const captureSource=`class BundleCapture extends AudioWorkletProcessor{
 constructor(){super();this.pending=null;this.port.onmessage=({data})=>{if(this.pending)throw Error('Concurrent capture');this.pending={id:data.id,left:new Float32Array(data.frames),right:new Float32Array(data.frames),offset:0};};}
 process(inputs,outputs){for(const ch of outputs[0])ch.fill(0);const p=this.pending;if(!p)return true;const count=Math.min(128,p.left.length-p.offset),input=inputs[0];for(let i=0;i<count;i++){p.left[p.offset+i]=input[0]?.[i]??0;p.right[p.offset+i]=input[1]?.[i]??input[0]?.[i]??0;}p.offset+=count;if(p.offset===p.left.length){this.pending=null;this.port.postMessage(p,[p.left.buffer,p.right.buffer]);}return true;}
}registerProcessor('itch-bundle-capture',BundleCapture);`;

async function unpack(){
 if(option('root'))return {root:path.resolve(option('root'))};
 const archive=path.resolve(option('zip')),bytes=await fs.readFile(archive),root=await fs.mkdtemp(path.join(os.tmpdir(),'itch-playground-bundle-'));
 const inspect=String.raw`import json,sys,zipfile
from pathlib import Path
root=Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 for i in z.infolist():
  if not (root/i.filename).resolve().is_relative_to(root):raise ValueError('Unsafe ZIP member')
 z.extractall(root)
 print(json.dumps({'entries':len(z.infolist()),'directories':sum(i.is_dir() for i in z.infolist())}))`;
 const counts=JSON.parse(execFileSync('python3',['-c',inspect,archive,root],{encoding:'utf8'}));
 return {root,archive,bytes:bytes.length,sha256:sha(bytes),...counts};
}
function instrumentation(){
 const audit=window.__itchBundleAudit={contexts:[],worklets:[],workers:[],modules:[],sinks:new Map()};
 const Context=window.AudioContext,Worklet=window.AudioWorkletNode,WorkerOriginal=window.Worker;
 const connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect;
 audit.connect=connect;
 window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
 if(window.webkitAudioContext===Context)window.webkitAudioContext=window.AudioContext;
 window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);audit.worklets.push(name);}};
 window.Worker=class extends WorkerOriginal{constructor(url,...args){super(url,...args);audit.workers.push(String(url));}};
 AudioNode.prototype.connect=function(destination,...args){
  if(destination===this.context.destination){
   let sink=audit.sinks.get(this.context);
   if(!sink){const sum=this.context.createGain(),gate=this.context.createGain();gate.gain.value=0;connect.call(sum,gate);connect.call(gate,destination);sink={sum,gate};audit.sinks.set(this.context,sink);}
   connect.call(this,sink.sum,...args);return destination;
  }
  return connect.call(this,destination,...args);
 };
 AudioNode.prototype.disconnect=function(...args){
  if(args[0]===this.context.destination&&audit.sinks.has(this.context))args[0]=audit.sinks.get(this.context).sum;
  return disconnect.apply(this,args);
 };
 const original=AudioWorklet.prototype.addModule;
 AudioWorklet.prototype.addModule=function(url,...rest){audit.modules.push(String(url));return original.call(this,url,...rest);};
}
async function ready(page,url){
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('startupNotice')?.hidden||document.getElementById('status')?.textContent==='Startup failed.');
 assert.equal(await page.locator('#startupNotice').isVisible(),false,await page.locator('#startupMessage').textContent());
 await page.waitForFunction(()=>window.monaco?.editor?.getEditors().length===1);
 assert.equal(await page.locator('#runButton').isEnabled(),true);
 return page.evaluate(()=>({status:document.getElementById('status').textContent,mode:document.getElementById('playgroundMode').value,modeCount:document.getElementById('playgroundMode').options.length,audioContexts:window.__itchBundleAudit.contexts.length}));
}
async function setSource(page,source,execution){
 await page.locator('#codeTab').click();
 await page.evaluate(({source,execution})=>{monaco.editor.getEditors()[0].setValue(source);document.getElementById('workerExecution').checked=execution==='worker';},{source,execution});
}
const waitLog=(page,marker)=>page.waitForFunction(marker=>document.getElementById('consoleOutput').textContent.includes(marker),marker);
async function shell(page,command,marker){
 await page.locator('#shellTab').click();
 await page.locator('#shellInput').fill(command);await page.locator('#shellInput').press('Enter');
 await page.waitForFunction(marker=>document.getElementById('shellOutput').textContent.includes(marker)&&document.getElementById('shellStopButton').disabled,marker);
 assert(!/Exit [1-9]/.test(await page.locator('#shellState').textContent()),'Shell command failed');
}
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function seedFiles(page){
 const program=`const {fs}=await import('tetorica:shell');
await fs.writeText('/bundle-probe.js',"export const note='A3'; export const token=42;");
await fs.writeText('/bundle-note.txt','bundle-file-ok');
const rate=44100,frames=rate*24,bytes=new Uint8Array(44+frames*4),v=new DataView(bytes.buffer),e=new TextEncoder();
for(const [p,t]of [[0,'RIFF'],[8,'WAVEfmt '],[36,'data']])bytes.set(e.encode(t),p);
v.setUint32(4,bytes.length-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,rate,true);v.setUint32(28,rate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);v.setUint32(40,frames*4,true);
for(let i=0;i<frames;i++){v.setInt16(44+i*4,Math.round(5000*Math.sin(2*Math.PI*660*i/rate)),true);v.setInt16(46+i*4,Math.round(5000*Math.sin(2*Math.PI*880*i/rate)),true);}
await fs.writeBinary('/bundle-track.wav',bytes);const p=await import('./bundle-probe.js');console.log('__BUNDLE_SHELL__'+p.token);`;
 await shell(page,`echo ${quote(program)} > /bundle-seed.js`,'/bundle-seed.js');
 await shell(page,'js /bundle-seed.js','__BUNDLE_SHELL__42');
 assert(await page.evaluate(()=>window.__itchBundleAudit.workers.some(url=>/shell/.test(url))),'Shell used a real Worker');
}
async function typesAndInspector(page,mode){
 const before=await page.evaluate(()=>({contexts:window.__itchBundleAudit.contexts.length,worklets:window.__itchBundleAudit.worklets.length}));
 if(mode==='mega-cd'){
  await page.locator('#cddaTab').click();await page.waitForFunction(()=>document.querySelector('#cddaPanel [data-cdrom2-audio]')?.getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#cddaPanel [data-cdrom2-output="state"]').textContent(),'Not initialized');
  await page.locator('#cddaPanel [data-cdrom2-action="refresh"]').click();
  await page.waitForFunction(()=>document.querySelector('#cddaPanel [data-cdrom2-audio]')?.getAttribute('aria-busy')==='false');
 }
 const result=await page.evaluate(async mode=>{
  const good=mode==='mega-cd'?"async function t(){await cdda.load('/a.wav');await cdda.play(1,{offset:0});fm.noteOn(CH1,'A3');}":"fm.noteOn(CH1,'A3');";
  const source=good+"\nfm.noteOn('invalid','A3');",model=monaco.editor.createModel(source,'javascript',monaco.Uri.parse('file:///bundle-types.js'));
  try{const worker=await(await monaco.languages.typescript.getJavaScriptWorker())(model.uri);return {validLength:good.length,diagnostics:(await worker.getSemanticDiagnostics(model.uri.toString())).map(({start,code,messageText})=>({start,code,messageText}))};}finally{model.dispose();}
 },mode);
 assert.deepEqual(result.diagnostics.filter(x=>x.start<result.validLength),[],'Selected mode declarations remain available');
 assert(result.diagnostics.some(x=>x.start>=result.validLength),'Monaco semantic Worker rejects invalid channel');
 assert.deepEqual(await page.evaluate(()=>({contexts:window.__itchBundleAudit.contexts.length,worklets:window.__itchBundleAudit.worklets.length})),before,'Inspector/types do not create audio');
 return result;
}
function sourceFor(mode,token){
 const fileProbe="const mod=await import('./bundle-probe.js');if(mod.token!==42||await file('./bundle-note.txt')!=='bundle-file-ok')throw Error('VFS import/read failed');";
 const hold="liveLoop('bundle-hold',async()=>{await sleep(.1);});";
 const marker=`console.log('__BUNDLE_READY__${token}');`;
 if(mode==='genesis')return `${fileProbe}fm.setPreset(CH1,FM_PRESETS.sine);fm.noteOn(CH1,mod.note);psg.tone(PSG1,{note:'A4',attenuation:8});${marker}${hold}`;
 if(mode==='gameboy')return `${fileProbe}gameboy.pulse.setVoice(0,{duty:.25,volume:8,envelope:{direction:'down',period:0}});gameboy.pulse.noteOn(0,'A4');${marker}${hold}`;
 if(mode==='nes')return `${fileProbe}nes.pulse.setVoice(0,{duty:.25,volume:8});nes.pulse.noteOn(0,'A4');${marker}${hold}`;
 if(mode==='wonderswan')return `${fileProbe}ws.setWaveform(0,Array.from({length:32},(_,i)=>Math.round(7.5+7.5*Math.sin(2*Math.PI*i/32))));ws.setVolume(0,10,10);ws.noteOn(0,'A4');${marker}${hold}`;
 if(mode==='pokey'||mode==='pokey-dual'){
  const entries=pokeyRoutes(mode).map((route,index)=>`{source:${index?'pokey2':'pokey'},id:${JSON.stringify(route.name)},expectedGain:${route.volume},frequency:${index?880:440},pan:${mode==='pokey-dual'?(index?1:-1):0}}`).join(',');
  return `${fileProbe}
const settings=[];
for(const {source,id,expectedGain,frequency,pan} of [${entries}]){
 const initial=await mixer.get(id);if(initial.volume!==expectedGain||initial.pan!==0||initial.muted)throw Error('Incorrect System POKEY Mixer defaults: '+id+' '+JSON.stringify(initial));settings.push({id,...initial});
 await source.initialize();await source.allNotesOff();await source.setHighClock(0,true);await source.setJoined(0,true);await source.setDistortion(1,5);await source.setVolumeOnly(1,false);await source.setVolume(1,15);await source.setFrequency(1,frequency);await source.writeRegister(9,0);await source.keyOn(1);
 await mixer.set(id,{pan});
}
console.log('__BUNDLE_MIXER_SYSTEM__${token}'+JSON.stringify(settings));
${marker}${hold}`;
 }
 return `${fileProbe}
const pcm=await useSoundChip('rf5c164');
const samples=Float32Array.from({length:32768},(_,i)=>.4*Math.sin(2*Math.PI*330*i/32768));
const wave=await pcm.loadSample({channels:[samples],sampleRate:32768},{loopStart:0});
await pcm.setChannel(0,{...wave,volume:160,pan:{left:15,right:15}});await pcm.keyOn(0);
fm.setPreset(CH1,FM_PRESETS.sine);fm.noteOn(CH1,mod.note);psg.tone(PSG1,{note:'A4',attenuation:8});
await cdda.load('/bundle-track.wav');await cdda.play();
for(const id of ['ym2612','segapsg','rf5c164','cdda'])await mixer.set(id,{volume:.25,pan:0,muted:false});
${marker}
await sleep(3);
for(const source of ['ym2612','segapsg','rf5c164','cdda']){
 for(const id of ['ym2612','segapsg','rf5c164','cdda'])await mixer.set(id,{muted:id!==source});
 console.log('__BUNDLE_ISOLATE__${token}'+source);await sleep(2);
}
for(const id of ['ym2612','segapsg','rf5c164','cdda'])await mixer.set(id,{muted:false});
console.log('__BUNDLE_ALL__${token}');${hold}`;
}
async function capture(page){
 return page.evaluate(async()=>{
  const audit=window.__itchBundleAudit,context=[...audit.contexts].reverse().find(context=>context.state!=='closed'&&audit.sinks.has(context));
  if(!context)throw Error('No live output graph');
  const sink=audit.sinks.get(context);
  if(!sink.capture){
   await context.audioWorklet.addModule(new URL('/__bundle_capture.js',location.href).href);
   const node=new AudioWorkletNode(context,'itch-bundle-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
   audit.connect.call(sink.sum,node);audit.connect.call(node,sink.gate);sink.capture=node;sink.id=0;sink.pending=null;
   node.port.onmessage=({data})=>{if(sink.pending?.id===data.id){const p=sink.pending;sink.pending=null;clearTimeout(p.timer);p.resolve(data);}};
  }
  const data=await new Promise((resolve,reject)=>{if(sink.pending)throw Error('Concurrent host capture');const id=++sink.id,timer=setTimeout(()=>reject(Error('Output capture timeout')),10000);sink.pending={id,resolve,timer};sink.capture.port.postMessage({id,frames:16384});});
  const left=data.left.subarray(1024),right=data.right.subarray(1024),frequencies=[220,330,440,660,880];let peak=0,sum=0;
  for(const ch of[left,right])for(const value of ch){if(!Number.isFinite(value))throw Error('Nonfinite PCM');peak=Math.max(peak,Math.abs(value));sum+=value*value;}
  const spectrum=ch=>frequencies.map(hz=>{let s=0,c=0;for(let i=0;i<ch.length;i++){const p=2*Math.PI*hz*i/context.sampleRate;s+=ch[i]*Math.sin(p);c+=ch[i]*Math.cos(p);}return 2*Math.hypot(s,c)/ch.length;});
  const channelStats=[left,right].map(ch=>{let sum=0,squares=0,peak=0;for(const value of ch){sum+=value;squares+=value*value;peak=Math.max(peak,Math.abs(value));}const dc=sum/ch.length,rms=Math.sqrt(squares/ch.length);return{dc,rms,acRms:Math.sqrt(Math.max(0,rms*rms-dc*dc)),peak};});
  return {sampleRate:context.sampleRate,frames:left.length,peak,rms:Math.sqrt(sum/left.length/2),channelStats,frequencies,left:spectrum(left),right:spectrum(right)};
 });
}
async function stop(page){
 await page.locator('#stopButton').click();
 await page.waitForFunction(()=>!document.getElementById('runButton').disabled);
 await page.waitForTimeout(250);
 const pcm=await capture(page);assert.equal(pcm.peak,0,'Global Stop produces exact zero PCM');return pcm;
}
async function checkPokeySystemMixer(page,mode,playing,token){
 const routes=pokeyRoutes(mode),ids=routes.map(route=>route.name),expectedGains=routes.map(route=>route.volume);
 await waitLog(page,'__BUNDLE_MIXER_SYSTEM__'+token);
 await page.locator('#mixerTab').click();
 const preset=page.getByRole('combobox',{name:'Mixer preset'}),system='/sys/mixer/default.json';
 const volumeFor=id=>page.locator(`#mixerPanel .playground-mixer-strip[data-chip-id="${id}"] input[data-setting="volume"]`);
 const panFor=id=>page.locator(`#mixerPanel .playground-mixer-strip[data-chip-id="${id}"] input[data-setting="pan"]`);
 for(let index=0;index<ids.length;index++)assert.equal(await volumeFor(ids[index]).inputValue(),String(Math.round(expectedGains[index]*100)),'Public Mixer displays the generated POKEY System gain');
 const input=async(locator,value)=>locator.evaluate((element,value)=>{element.value=String(value);element.dispatchEvent(new Event('input',{bubbles:true}));},value);
 for(const id of ids)await input(volumeFor(id),100);
 await page.waitForTimeout(150);const unity=await capture(page);
 const gainRelativeErrors=routes.map((route,index)=>{const channel=mode==='pokey-dual'?index:0;return Math.abs(playing.channelStats[channel].acRms/unity.channelStats[channel].acRms/route.volume-1);});
 assert(gainRelativeErrors.every(error=>error<.025),'Packaged POKEY source gain applies exactly once through actual PCM');
 await preset.selectOption(system);
 for(let index=0;index<ids.length;index++)assert.equal(await volumeFor(ids[index]).inputValue(),String(Math.round(expectedGains[index]*100)),'Selecting System restores each POKEY chip gain');
 // The System preset also restores pan. Repeat the same public pan controls
 // used by this test's user code to compare the restored output directly.
 if(mode==='pokey-dual'){await input(panFor(ids[0]),-100);await input(panFor(ids[1]),100);}
 await page.waitForTimeout(150);const restored=await capture(page);
 const restoreRmsRelativeErrors=routes.map((route,index)=>{const channel=mode==='pokey-dual'?index:0;return Math.abs(restored.channelStats[channel].acRms/playing.channelStats[channel].acRms-1);});
 assert(restoreRmsRelativeErrors.every(error=>error<.025),'Public System selection restores the measured POKEY output');
 await preset.selectOption(system);
 return {ids,expectedGains,unity,gainRelativeErrors,restored,restoreRmsRelativeErrors,privateProductionHooks:false};
}
async function runCase(browser,typeName,origin,mode,execution,sequence){
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage();
 await context.addInitScript(instrumentation);page.setDefaultTimeout(40000);
 const errors=[],failed=[],bad=[],consoleErrors=[];
 page.on('pageerror',e=>errors.push(e.stack??e.message));page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText}));
 page.on('response',r=>{if(r.status()>=400)bad.push({url:r.url(),status:r.status()});});page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
 const prefix=execution==='worker'?nested:'',started=Date.now(),result={browser:typeName,version:browser.version(),mode,execution,path:prefix||'/'};
 try{
  result.startup=await ready(page,`${origin}${prefix}/index.html?mode=${mode}&no-sw=1`);
  assert.equal(result.startup.mode,mode);assert.equal(result.startup.audioContexts,0,'Startup is lazy');
  if(mode==='genesis'||mode==='mega-cd')result.types=await typesAndInspector(page,mode);
  await seedFiles(page);result.shellWorkerAndRelativeImport=true;
  const token=`${typeName}-${mode}-${execution}-${sequence}`,source=sourceFor(mode,token);
  await setSource(page,source,execution);await page.locator('#runButton').click();await waitLog(page,'__BUNDLE_READY__'+token);
  await page.waitForTimeout(execution==='worker'?650:100);result.playing=await capture(page);
  assert(result.playing.rms>.0002&&result.playing.peak<1,'Actual finite audible PCM');
  if(mode==='genesis'||mode==='mega-cd'){
   assert(result.playing.left[0]>.001,'YM2612 sine contribution');assert(result.playing.left[2]>.001,'Sega PSG contribution');
  }
  if(mode==='pokey'||mode==='pokey-dual'){
   assert(result.playing.left[2]>.001,'POKEY1 actual440Hz square contribution');
   if(mode==='pokey-dual')assert(result.playing.right[4]>.001&&result.playing.right[2]<result.playing.left[2]*.15&&result.playing.left[4]<result.playing.right[4]*.15,'Independent POKEY2 actual880Hz square contribution and stereo separation');
   result.mixerSystem=await checkPokeySystemMixer(page,mode,result.playing,token);
  }
  if(mode==='mega-cd'){
   assert(result.playing.left[1]>.001,'RF5C164 contribution');assert(result.playing.left[3]>.001&&result.playing.right[4]>.001,'Independent CDDA stereo contribution');
   result.isolated={};
   for(const [id,index]of[['ym2612',0],['segapsg',2],['rf5c164',1],['cdda',3]]){
    await waitLog(page,'__BUNDLE_ISOLATE__'+token+id);await page.waitForTimeout(execution==='worker'?650:100);const value=result.isolated[id]=await capture(page);
    assert(value.left[index]>.001,'Isolated '+id+' audible');
    for(const other of[0,1,2,3].filter(x=>x!==index))assert(value.left[other]<value.left[index]*.15,'Isolation leaves no '+other+' in '+id);
    if(id==='cdda')assert(value.right[4]>.001,'CDDA right channel survives isolation');
   }
   await waitLog(page,'__BUNDLE_ALL__'+token);
  }
  result.stopped=await stop(page);
  const rerunToken=token+'-rerun';
  // The second run only needs the same live graph. Do not interrupt an awaited
  // top-level isolation sequence: that intentionally reports "Run stopped".
  const rerunSource=(mode==='mega-cd'?source.slice(0,source.indexOf('await sleep(3);'))+"liveLoop('bundle-hold',async()=>{await sleep(.1);});":source).replaceAll(token,rerunToken);
  await setSource(page,rerunSource,execution);await page.locator('#runButton').click();await waitLog(page,'__BUNDLE_READY__'+rerunToken);
  await page.waitForTimeout(execution==='worker'?650:100);result.rerun=await capture(page);assert(result.rerun.rms>.0002,'Rerun audible');
  result.finalStop=await stop(page);
  if(mode==='mega-cd'){
   await page.locator('#cddaTab').click();await page.locator('#cddaPanel [data-cdrom2-action="refresh"]').click();
   await page.waitForFunction(()=>document.querySelector('#cddaPanel [data-cdrom2-audio]')?.getAttribute('aria-busy')==='false');
   assert.equal(await page.locator('#cddaPanel [data-cdrom2-output="state"]').textContent(),'Not initialized');
  }
  if(mode==='mega-cd'&&execution==='main'){
   result.screenshot=path.join(images,`${typeName}-mega-cd.png`);await page.screenshot({path:result.screenshot});
  }
  const audit=await page.evaluate(()=>({worklets:window.__itchBundleAudit.worklets,workers:window.__itchBundleAudit.workers,modules:window.__itchBundleAudit.modules}));
  assert(audit.worklets.length>1,'Real audio Worklets plus measurement Worklet ran');
  if(execution==='worker')assert(audit.workers.some(url=>/logic|worker/i.test(url)&&!/shell|ts.worker/.test(url)),'Real logic Worker ran');
  result.audit=audit;assert.deepEqual(errors,[],'Page errors');assert.deepEqual(bad,[],'HTTP errors');assert.deepEqual(failed,[],'Network failures');assert.deepEqual(consoleErrors,[],'Browser console errors');
  result.passed=true;return result;
 }catch(error){result.failure=String(error.stack??error);result.page=await page.evaluate(()=>({status:document.getElementById('status')?.textContent,startup:document.getElementById('startupMessage')?.textContent,console:document.getElementById('consoleOutput')?.textContent,shell:document.getElementById('shellOutput')?.textContent})).catch(()=>null);throw Object.assign(error,{caseResult:result});}
 finally{Object.assign(result,{seconds:(Date.now()-started)/1000,errors,failed,bad,consoleErrors});await context.close();}
}
(async()=>{
 let calibrationExpectation=null;
 if(modes.some(mode=>mode==='pokey'||mode==='pokey-dual')){
  const file=path.resolve(__dirname,'../docs/issues/pokey_chip_levels_live_api_01.json'),bytes=await fs.readFile(file);pokeyCalibration=JSON.parse(bytes);
  assert(pokeyCalibration.passed&&pokeyCalibration.completeCoverage&&!pokeyCalibration.verify,'Complete POKEY calibration expected values');
  calibrationExpectation={path:'docs/issues/pokey_chip_levels_live_api_01.json',sha256:sha(bytes),measurementMetric:pokeyCalibration.calibration.measurementMetric};
 }
 const artifact=await unpack();await fs.access(path.join(artifact.root,'index.html'));await fs.mkdir(images,{recursive:true});
 let bundle=null;
 try{bundle=JSON.parse(await fs.readFile(path.join(artifact.root,'sources/browser-bundle.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(bundle){
  assert.equal(bundle.entry.path,'playground.js');
  assert.equal(bundle.entry.importURL,`./playground.js?v=run-bundle-${bundle.entry.sha256.slice(0,16)}`,'Content-derived bundle cache URL');
  assert((await fs.readFile(path.join(artifact.root,'index.html'),'utf8')).includes(bundle.entry.importURL),'HTML imports the receipted content hash');
  const bytes=await fs.readFile(path.join(artifact.root,bundle.entry.path));assert.equal(sha(bytes),bundle.entry.sha256);assert.equal(bytes.length,bundle.entry.bytes);
  for(const removed of bundle.removed){try{await fs.access(path.join(artifact.root,removed));throw Error('Removed module still present: '+removed);}catch(error){if(error.code!=='ENOENT')throw error;}}
 }
 const served=new Map(),requested=new Set(),report={artifact,bundle:bundle?{entry:bundle.entry,removedModules:bundle.removed.length}:null,calibrationExpectation,physicalOutputMuted:true,privateProductionHooks:false,repositoryFallback:false,cases:[]};
 const server=http.createServer(async(req,res)=>{
  try{
   let pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
   if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
   if(pathname==='/__bundle_capture.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(captureSource);return;}
   if(pathname===nested||pathname.startsWith(nested+'/'))pathname=pathname.slice(nested.length)||'/';requested.add(pathname.slice(1));
   let file=path.resolve(artifact.root,'.'+pathname);if(file!==artifact.root&&!file.startsWith(artifact.root+path.sep))throw Error('Outside artifact');
   if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');const bytes=await fs.readFile(file),relative=path.relative(artifact.root,file),record={bytes:bytes.length,sha256:sha(bytes)};
   if(served.has(relative))assert.deepEqual(record,served.get(relative),'Served artifact changed');served.set(relative,record);
   const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'};
   res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
  }catch(error){res.writeHead(404).end(String(error));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const[name,type]of browsers){const browser=await type.launch({headless:true});try{for(const mode of modes)for(const execution of['main','worker']){const result=await runCase(browser,name,origin,mode,execution,report.cases.length);report.cases.push(result);console.log(`PASS ${name}/${mode}/${execution}${result.path}: startup, VFS/Shell, real PCM, Stop/Rerun`);}}finally{await browser.close();}}
  if(bundle){assert.equal(served.get(bundle.entry.path)?.sha256,bundle.entry.sha256,'Browser loaded the exact receipted bundle');for(const removed of bundle.removed)assert(!requested.has(removed),'Browser must not request a removed root UI module: '+removed);report.bundle.noRemovedModuleRequests=true;}
  report.passed=true;
 }catch(error){report.passed=false;if(error.caseResult)report.cases.push(error.caseResult);report.failure=String(error.stack??error);console.error(report.failure);process.exitCode=1;}
 finally{await new Promise(resolve=>server.close(resolve));report.servedFiles=Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)));await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:out,passed:report.passed,cases:report.cases.length,servedFiles:served.size,sha256:sha(await fs.readFile(out))}));}
})().catch(error=>{console.error(error);process.exitCode=1;});
