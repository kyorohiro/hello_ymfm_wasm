// Actual Mega-CD Main/Worker audio and read-only CD-DA UI in Chromium/WebKit.
// Original arithmetic fixtures only. The measurement Worklet outputs zeros;
// an independent destination gate also prevents physical sound output.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2),served=new Map();
const selected=args.includes('--chromium')?['chromium']:args.includes('--webkit')?['webkit']:['chromium','webkit'];
const out=args.find(arg=>arg.startsWith('--out='))?.slice(6)??'/private/tmp/megacd-cdda-browser.json';
const images=args.find(arg=>arg.startsWith('--images='))?.slice(9)??'/private/tmp/megacd-cdda-visual';
if(args.some(arg=>!['--chromium','--webkit'].includes(arg)&&!arg.startsWith('--out=')&&!arg.startsWith('--images=')))throw Error('Usage: node scripts/check_megacd_cdda_browser.cjs [--chromium|--webkit] [--out=REPORT.json] [--images=DIRECTORY]');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const captureSource=`class Capture extends AudioWorkletProcessor {
 constructor(){super();this.pending=null;this.port.onmessage=({data})=>{if(this.pending)throw Error('Concurrent capture');this.pending={id:data.id,left:new Float32Array(data.frames),right:new Float32Array(data.frames),offset:0};};}
 process(inputs,outputs){for(const channel of outputs[0])channel.fill(0);const p=this.pending;if(!p)return true;const count=Math.min(128,p.left.length-p.offset),input=inputs[0];for(let i=0;i<count;i++){p.left[p.offset+i]=input[0]?.[i]??0;p.right[p.offset+i]=input[1]?.[i]??0;}p.offset+=count;if(p.offset===p.left.length){this.pending=null;this.port.postMessage(p,[p.left.buffer,p.right.buffer]);}return true;}
}registerProcessor('megacd-cdda-capture',Capture);`;
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(pathname==='/__megacd_capture.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(captureSource);return;}
  const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep))throw Error('Invalid path');
  let bytes=await fs.readFile(file);const name=path.relative(root,file),hash=sha(bytes);
  if(served.has(name)&&served.get(name).sha256!==hash)throw Error('Source changed during Browser check: '+name);
  served.set(name,{bytes:bytes.length,sha256:hash});
  if(pathname==='/docs/playground/playground.js')bytes=Buffer.from(bytes.toString()+'\nwindow.__megaCD4={runtime,megaDrive,virtualFiles,setSource:value=>editorAdapter.setValue(value)};');
  const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'};
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
 }catch(error){res.writeHead(404).end(error.message);}
});
const waitLog=(page,marker)=>page.waitForFunction(marker=>document.getElementById('consoleOutput')?.textContent.includes(marker),marker);
async function installAudit(page){
 await page.addInitScript(()=>{
  const audit=window.__megaCD4Audit={contexts:[],worklets:[],messages:[],reads:[]};
  const Context=window.AudioContext,Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect,gates=new WeakMap();
  window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);audit.worklets.push(name);const post=this.port.postMessage.bind(this.port);this.port.postMessage=(data,...rest)=>{audit.messages.push({node:name,type:data?.action?.type??data?.type??data?.method??'other'});return post(data,...rest);};}};
  AudioNode.prototype.connect=function(destination,...rest){if(destination===this.context.destination){let gate=gates.get(this.context);if(!gate){gate=this.context.createGain();gate.gain.value=0;gates.set(this.context,gate);connect.call(gate,destination);}return connect.call(this,gate,...rest);}return connect.call(this,destination,...rest);};
 });
}
async function ready(page,origin,mode){
 await installAudit(page);await page.goto(`${origin}/docs/playground/index.html?mode=${mode}&no-sw=1`);
 await page.waitForFunction(()=>window.__megaCD4&&window.monaco?.editor?.getEditors().length||document.getElementById('status')?.textContent==='Startup failed.');
 assert(await page.evaluate(()=>!!window.__megaCD4),'Playground initializes');await page.locator('#startupNotice').waitFor({state:'hidden'});
 await page.evaluate(()=>{const api=window.__megaCD4.runtime,read=api.getSystemAudioState.bind(api);api.getSystemAudioState=kind=>{window.__megaCD4Audit.reads.push(kind);return read(kind);};});
}
const tabs=page=>page.evaluate(()=>Object.fromEntries(['operatorTabButton','segapsgTab','rf5c164Tab','pwmTab','huc6280Tab','msm5205Tab','cddaTab'].map(id=>[id,{hidden:document.getElementById(id).hidden,label:document.getElementById(id).textContent.trim()}])));
async function panel(page){
 await page.locator('#cddaTab').click();await page.waitForFunction(()=>!document.getElementById('cddaPanel').hidden&&document.querySelector('#cddaPanel [data-cdrom2-audio]')?.getAttribute('aria-busy')==='false');
 return page.evaluate(()=>{const root=document.getElementById('cddaPanel');return {fields:Object.fromEntries([...root.querySelectorAll('[data-cdrom2-output]')].map(node=>[node.dataset.cdrom2Output,node.textContent])),controls:root.querySelectorAll('input,select,textarea,canvas').length,buttons:[...root.querySelectorAll('button')].map(node=>node.textContent),keyboardHidden:document.getElementById('keyboardPanel').hidden};});
}
async function compactPanelScreenshot(page,file){
 await page.setViewportSize({width:390,height:844});
 await page.locator('#operatorTabButton').click();await panel(page);
 const tab=await page.evaluate(()=>{const node=document.getElementById('cddaTab'),box=node.getBoundingClientRect();return {left:box.left,right:box.right,width:innerWidth,selected:node.getAttribute('aria-selected')};});
 assert.equal(tab.selected,'true');assert(tab.left>=-1&&tab.right<=tab.width+1,'Compact CD-DA tab is reachable and scrolled into view');
 await page.screenshot({path:file});await page.setViewportSize({width:1440,height:1000});return {file,tab};
}
async function checkTypes(page){
 const result=await page.evaluate(async()=>{
  const selected=monaco.editor.getModels().find(model=>model.uri.path.endsWith('/tetorica-playground-mega-cd.d.ts'));
  const valid=`async function megaCDTypes(){\nawait cdda.load('/cdda/test.wav');\nawait cdda.play(1,{offset:0,at:0});\nawait cdda.pause();await cdda.resume();await cdda.seek(.25);await cdda.stop();\nconst state=await pg.cdda.getState();\nconst pcm=await useSoundChip('rf5c164');await pcm.keyOn(7);\nfm.setPreset(CH6,FM_PRESETS.sine);psg.tone(PSG1,{note:'A4',attenuation:10});\n`;
  const source=valid+`await cdda.play(1,{offset:'invalid'});\n}\n`,model=monaco.editor.createModel(source,'javascript',monaco.Uri.parse('file:///megacd-cdda-browser-types.js'));
  try{const worker=await(await monaco.languages.typescript.getJavaScriptWorker())(model.uri);return {selected:!!selected,validLength:valid.length,diagnostics:(await worker.getSemanticDiagnostics(model.uri.toString())).map(({start,code,messageText})=>({start,code,messageText}))};}finally{model.dispose();}
 });
 assert(result.selected,'Mega-CD declarations selected before Run');assert.deepEqual(result.diagnostics.filter(item=>item.start<result.validLength),[],'Four source APIs type-check before audio initialization');
 assert(result.diagnostics.some(item=>item.start>=result.validLength),'CD-DA options reject an invalid offset');return result;
}
async function configure(page,execution){
 await page.evaluate(execution=>{
  const shared=window.__megaCD4,rate=44100,frames=rate*20,bytes=new Uint8Array(44+frames*4),view=new DataView(bytes.buffer),enc=new TextEncoder();
  for(const[offset,tag]of [[0,'RIFF'],[8,'WAVEfmt '],[36,'data']])bytes.set(enc.encode(tag),offset);
  view.setUint32(4,bytes.length-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,rate,true);view.setUint32(28,rate*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);view.setUint32(40,frames*4,true);
  for(let i=0;i<frames;i++){view.setInt16(44+i*4,Math.round(6000*Math.sin(i*2*Math.PI*660/rate)),true);view.setInt16(46+i*4,Math.round(6000*Math.sin(i*2*Math.PI*880/rate)),true);}
  shared.virtualFiles.writeBinary('/cdda/megacd-browser.wav',bytes);
  shared.source=`
const pcm=await useSoundChip('rf5c164');
const input=Float32Array.from({length:32768},(_,i)=>.4*Math.sin(2*Math.PI*330*i/32768));
const pcmWave=await pcm.loadSample({channels:[input],sampleRate:32768},{loopStart:0});
await pcm.setChannel(0,{...pcmWave,volume:160,pan:{left:15,right:15}});await pcm.keyOn(0);
fm.setPreset(CH1,FM_PRESETS.sine);fm.noteOn(CH1,'A3');
psg.tone(PSG1,{note:'A4',attenuation:8});
await cdda.load('/cdda/megacd-browser.wav');await cdda.play();
for(const id of ['ym2612','segapsg','rf5c164','cdda'])await mixer.set(id,{volume:.25,pan:0,muted:false});
console.log('__MEGACD_FOUR_READY__');
await sleep(8);
await cdda.pause();console.log('__MEGACD_CONTROL__1');await sleep(.8);
await cdda.seek(.25);console.log('__MEGACD_CONTROL__2');await sleep(.8);
await cdda.resume();console.log('__MEGACD_CONTROL__3');await sleep(.8);
await cdda.stop();console.log('__MEGACD_CONTROL__4');await sleep(.8);
await cdda.play();console.log('__MEGACD_CONTROL__5');
liveLoop('megacd-browser-hold',async()=>{await sleep(.1);});`;
  shared.setSource(shared.source);document.getElementById('workerExecution').checked=execution==='worker';
 },execution);
 await page.click('#runButton');await waitLog(page,'__MEGACD_FOUR_READY__');
 await page.evaluate(async()=>{
  const shared=window.__megaCD4,context=shared.megaDrive.audioContext;await context.audioWorklet.addModule('/__megacd_capture.js');
  const node=new AudioWorkletNode(context,'megacd-cdda-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});node.connect(context.destination);
  const detach=shared.megaDrive.audio.connectOutputMonitor(node);let pending=null,id=0;
  node.port.onmessage=({data})=>{if(pending?.id===data.id){const old=pending;pending=null;clearTimeout(old.timer);old.resolve(data);}};
  shared.take=(frames=10240)=>new Promise((resolve,reject)=>{if(pending)throw Error('Concurrent host capture');const token=++id,timer=setTimeout(()=>reject(Error('Mega-CD capture timeout')),10000);pending={id:token,resolve,timer};node.port.postMessage({id:token,frames});});
  shared.closeCapture=()=>{detach();node.disconnect();node.port.close();};
 });
 if(execution==='worker')await page.evaluate(()=>window.__megaCD4.take(Math.ceil(window.__megaCD4.megaDrive.audioContext.sampleRate*.65)));
}
async function capture(page,preview=false){
 const result=await page.evaluate(async preview=>{
  const shared=window.__megaCD4,rate=shared.megaDrive.audioContext.sampleRate,data=await shared.take(preview?rate*4+2048:10240),left=data.left.subarray(2048),right=data.right.subarray(2048);
  let peak=0,energy=0,leftPeak=0,rightPeak=0;
  for(let i=0;i<left.length;i++){if(!Number.isFinite(left[i])||!Number.isFinite(right[i]))throw Error('Nonfinite actual host PCM');leftPeak=Math.max(leftPeak,Math.abs(left[i]));rightPeak=Math.max(rightPeak,Math.abs(right[i]));energy+=left[i]*left[i]+right[i]*right[i];}peak=Math.max(leftPeak,rightPeak);
  const amplitude=(channel,hz)=>{let s=0,c=0;for(let i=0;i<channel.length;i++){const phase=2*Math.PI*hz*i/rate;s+=channel[i]*Math.sin(phase);c+=channel[i]*Math.cos(phase);}return 2*Math.hypot(s,c)/channel.length;};
  let wav=null;
  if(preview){
   const bytes=new Uint8Array(44+left.length*8),view=new DataView(bytes.buffer),tag=(offset,text)=>{for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i);};
   tag(0,'RIFF');view.setUint32(4,bytes.length-8,true);tag(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,3,true);view.setUint16(22,2,true);view.setUint32(24,rate,true);view.setUint32(28,rate*8,true);view.setUint16(32,8,true);view.setUint16(34,32,true);tag(36,'data');view.setUint32(40,left.length*8,true);
   for(let i=0;i<left.length;i++){view.setFloat32(44+i*8,left[i],true);view.setFloat32(48+i*8,right[i],true);}let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));wav=btoa(text);
  }
  return {sampleRate:rate,frames:left.length,peak,leftPeak,rightPeak,rms:Math.sqrt(energy/left.length/2),frequencies:[220,330,440,660,880],left:[220,330,440,660,880].map(hz=>amplitude(left,hz)),right:[220,330,440,660,880].map(hz=>amplitude(right,hz)),strips:shared.megaDrive.mixer.list().filter(({id})=>['ym2612','segapsg','rf5c164','cdda'].includes(id)).map(({id,volume,muted,pan})=>({id,volume,muted,pan})),wav};
 },preview);
 if(result.wav){const bytes=Buffer.from(result.wav,'base64'),file='/private/tmp/megacd-cdda-preview.wav';await fs.writeFile(file,bytes);result.preview={file,bytes:bytes.length,sha256:sha(bytes),format:'stereo Float32 RIFF WAV',normalized:false};}delete result.wav;return result;
}
async function isolate(page,id){await page.evaluate(id=>{for(const source of ['ym2612','segapsg','rf5c164','cdda'])window.__megaCD4.megaDrive.mixer.set(source,{muted:id!=='all'&&source!==id});},id);}
async function command(page,seq){
 await waitLog(page,'__MEGACD_CONTROL__'+seq);return page.evaluate(()=>window.__megaCD4.runtime.getSystemAudioState('cdda'));
}
async function stop(page){await page.click('#stopButton');await page.waitForFunction(()=>window.__megaCD4.runtime.getState().playback==='stopped');}
async function check(page,origin,browser,execution){
 await ready(page,origin,'mega-cd');const initialTabs=await tabs(page);
 for(const id of ['operatorTabButton','segapsgTab','rf5c164Tab','cddaTab'])assert(!initialTabs[id].hidden,'Mega-CD four device tabs before Run');
 for(const id of ['pwmTab','huc6280Tab','msm5205Tab'])assert(initialTabs[id].hidden,'No unrelated Mega-CD tab '+id);
 const idle=await panel(page);assert.equal(idle.fields.state,'Not initialized');assert.equal(idle.controls,0);assert.deepEqual(idle.buttons,['Refresh']);assert(idle.keyboardHidden);
 await page.locator('#cddaPanel [data-cdrom2-action="refresh"]').click();await page.waitForFunction(()=>document.querySelector('#cddaPanel [data-cdrom2-audio]')?.getAttribute('aria-busy')==='false');
 const types=await checkTypes(page),before=await page.evaluate(()=>({contexts:window.__megaCD4Audit.contexts.length,worklets:window.__megaCD4Audit.worklets.length,messages:window.__megaCD4Audit.messages.length}));
 assert.deepEqual(before,{contexts:0,worklets:0,messages:0},'Tabs, refresh and type checking do not initialize or command audio');
 const idleScreenshot=path.join(images,`${browser}-${execution}-idle-desktop.png`);await page.screenshot({path:idleScreenshot});
 const idleCompactScreenshot=await compactPanelScreenshot(page,path.join(images,`${browser}-${execution}-idle-compact.png`));
 await page.locator('#codeTab').click();await configure(page,execution);
 const all=await capture(page);assert(all.peak<1&&all.rms>.002,'Four-source host mix is finite and unclipped');
 for(const[index,label]of [[0,'FM'],[1,'PCM'],[2,'PSG'],[3,'CD-DA left']])assert(all.left[index]>.002,execution+': actual mixed '+label+' contribution '+JSON.stringify(all));
 assert(all.right[4]>.002,'CD-DA independent right contribution');assert.equal(all.strips.length,4);
 const stripBefore=all.strips,index=await page.evaluate(()=>window.__megaCD4Audit.messages.length),playing=await panel(page);
 assert.equal(playing.fields.state,'Playing');assert.equal(playing.controls,0);assert.deepEqual(playing.buttons,['Refresh']);assert(playing.keyboardHidden);
 await page.locator('#cddaPanel [data-cdrom2-action="refresh"]').click();await page.waitForFunction(()=>document.querySelector('#cddaPanel [data-cdrom2-audio]')?.getAttribute('aria-busy')==='false');
 const inspection=await page.evaluate(index=>({messages:window.__megaCD4Audit.messages.slice(index).filter(({node})=>node==='tetorica-cdda'),reads:window.__megaCD4Audit.reads.length}),index);
 assert(inspection.messages.length>=2&&inspection.messages.every(({type})=>type==='state'),'Inspection sends only state reads');
 assert.deepEqual((await capture(page)).strips,stripBefore,'Inspection leaves all four Mixer settings intact');
 await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.__megaCD4Audit.reads.length),inspection.reads,'Read-only snapshot has no view polling');
 const screenshot=path.join(images,`${browser}-${execution}-four-tabs-cdda.png`);await page.screenshot({path:screenshot,fullPage:false});
 const compactScreenshot=await compactPanelScreenshot(page,path.join(images,`${browser}-${execution}-running-compact.png`));
 const isolated={};
 for(const[id,index]of [['ym2612',0],['segapsg',2],['rf5c164',1],['cdda',3]]){
  await isolate(page,id);const value=isolated[id]=await capture(page);assert(value.peak<1&&value.left[index]>.002,execution+': isolated real '+id);
  for(const other of [0,1,2,3].filter(x=>x!==index))assert(value.left[other]<value.left[index]*.12,execution+': independent '+id+' isolation '+JSON.stringify(value));
  assert(value.strips.every(({volume})=>volume===.25),'Partial mute preserves authored gains');
 }
 assert(isolated.cdda.right[4]>.002,'Independent stereo CD-DA survives isolation');
 await isolate(page,'none');const muted=await capture(page);assert.equal(muted.peak,0,'Four independent mutes produce exact silence');
 await isolate(page,'cdda');const paused=await command(page,1,'pause');assert.equal(paused.state,'paused');const pausePCM=await capture(page);assert.equal(pausePCM.peak,0,'CD-DA pause leaves no sibling or CD-DA PCM');
 const stable=await page.evaluate(()=>window.__megaCD4.runtime.getSystemAudioState('cdda'));assert.equal(stable.positionFrames,paused.positionFrames,'Paused source cursor stays fixed');
 const sought=await command(page,2,'seek',[.25]);assert.equal(sought.positionFrames,11025);assert.equal(sought.state,'paused');
 const resumed=await command(page,3,'resume');assert.equal(resumed.state,'playing');const resumePCM=await capture(page);assert(resumePCM.left[3]>.002&&resumePCM.right[4]>.002,'Resume restores both original CD-DA channels');
 const stoppedSource=await command(page,4,'stop');assert.equal(stoppedSource.state,'ready');assert.equal(stoppedSource.positionFrames,0);assert.equal((await capture(page)).peak,0,'Source Stop is silent');
 await command(page,5,'play');const replay=await capture(page);assert(replay.left[3]>.002&&replay.right[4]>.002,'Source replay restores stereo CD-DA');
 await stop(page);const globalStop=await capture(page);assert.equal(globalStop.peak,0,'Global Stop clears actual four-source audio');assert(!globalStop.strips.some(({id})=>id==='cdda'),'Global Stop retires lazy CD-DA strip');
 await page.evaluate(()=>{const shared=window.__megaCD4;shared.setSource(shared.source);});
 await page.click('#runButton');await waitLog(page,'__MEGACD_FOUR_READY__');if(execution==='worker')await page.evaluate(()=>window.__megaCD4.take(Math.ceil(window.__megaCD4.megaDrive.audioContext.sampleRate*.65)));
 const rerun=await capture(page);assert(rerun.left[0]>.002&&rerun.left[1]>.002&&rerun.left[2]>.002&&rerun.left[3]>.002,'Rerun recreates every actual source');assert.equal(rerun.strips.filter(({id})=>id==='cdda').length,1,'No duplicate lazy CD-DA strip');await stop(page);
 // Reset through the real Mixer UI before measuring the actual starter. The
 // fixture's diagnostic .25 gains must not replace the current System values.
 await page.click('#mixerTab');await page.locator('#mixerPanel select[aria-label="Mixer preset"]').selectOption('/sys/mixer/default.json');
 const systemMix=await page.evaluate(async()=>{
  const {createPlaygroundSoundChipMixer}=await import('./playground_mixer_defaults.js'),factory=createPlaygroundSoundChipMixer('mega-cd');
  return ['ym2612','segapsg','rf5c164','cdda'].map(id=>({id,expected:factory.get(id),actual:window.__megaCD4.megaDrive.mixer.get(id)}));
 });
 for(const {id,expected,actual}of systemMix)assert.deepEqual(actual,expected,'True System settings before starter: '+id);
 await page.evaluate(async()=>{const source=await(await fetch('/docs/playground/defaults/mega-cd/index.js')).text();window.__megaCD4.setSource(source+"\nconsole.log('__MEGACD_STARTER_READY__');");});
 await page.click('#runButton');await waitLog(page,'__MEGACD_STARTER_READY__');if(execution==='worker')await page.evaluate(()=>window.__megaCD4.take(Math.ceil(window.__megaCD4.megaDrive.audioContext.sampleRate*.65)));
 const starter=await capture(page,browser==='chromium'&&execution==='main'),starterState=await page.evaluate(()=>window.__megaCD4.runtime.getSystemAudioState('cdda'));assert(starter.peak>.001&&starter.peak<1,'Actual new mode starter produces finite output at true System defaults');assert.equal(starterState?.state,'playing');assert.equal(starter.strips.length,4);
 for(const {id,expected}of systemMix){const actual=starter.strips.find(strip=>strip.id===id);for(const key of ['volume','pan','muted'])assert.equal(actual[key],expected[key],'Starter retains System '+id+'/'+key);}
 await panel(page);await page.locator('#cddaPanel [data-cdrom2-action="refresh"]').click();
 await page.waitForFunction(()=>document.querySelector('#cddaPanel [data-cdrom2-audio]')?.getAttribute('aria-busy')==='false'&&document.querySelector('#cddaPanel [data-cdrom2-output="frames"]')?.textContent.includes('176,400'));
 const starterPanel=await panel(page);
 assert.match(starterPanel.fields.frames,/176,400/,'Actual starter has its four-second CD-DA track');
 const starterDesktopScreenshot=path.join(images,`${browser}-${execution}-starter-desktop.png`);await page.screenshot({path:starterDesktopScreenshot});
 const starterCompactScreenshot=await compactPanelScreenshot(page,path.join(images,`${browser}-${execution}-starter-compact.png`));
 const worklets=await page.evaluate(()=>window.__megaCD4Audit.worklets);assert(!worklets.includes('tetorica-msm5205'),'Mega-CD never creates a PC Engine ADPCM endpoint');
 await stop(page);await page.evaluate(()=>window.__megaCD4.closeCapture());
 return {execution,initialTabs,idle,types,before,idleScreenshot,idleCompactScreenshot,all,playing,inspection,screenshot,compactScreenshot,isolated,muted,paused,stable,sought,resumed,pausePCM,resumePCM,stoppedSource,replay,globalStop,rerun,systemMix,starter,starterState,starterPanel,starterDesktopScreenshot,starterCompactScreenshot,worklets,physicalOutputMuted:true};
}
async function checkOtherMode(page,origin,mode){
 await ready(page,origin,mode);const actual=await tabs(page),want=mode==='pc-engine-cd'?['huc6280Tab','msm5205Tab','cddaTab']:['operatorTabButton','segapsgTab',...(mode==='genesis'?[]:['rf5c164Tab','pwmTab'])];
 assert.deepEqual(Object.keys(actual).filter(id=>!actual[id].hidden).sort(),want.sort(),mode+': unchanged visible device tabs');
 assert.equal(await page.evaluate(()=>window.__megaCD4Audit.contexts.length),0,'Mode tabs do not initialize audio');return {mode,tabs:actual};
}
(async()=>{
 await fs.mkdir(images,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin=`http://127.0.0.1:${server.address().port}`,results=[],regressions=[];
 try{
  for(const name of selected){
   const browser=await(name==='chromium'?chromium:webkit).launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
   try{
    for(const execution of ['main','worker']){
     const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1440,height:1000}}),errors=[],bad=[];page.setDefaultTimeout(30000);
     page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)bad.push({url:response.url(),status:response.status()});});
     try{const result=await check(page,origin,name,execution);assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);results.push({browser:name,version:browser.version(),...result});console.log(`PASS ${name}/${execution}: real four-source mix/isolation, CD-DA lifecycle, read-only tab and types`);}
     catch(error){console.error({browser:name,execution,errors,bad,page:await page.evaluate(()=>({status:document.getElementById('status')?.textContent,console:document.getElementById('consoleOutput')?.textContent,runtime:window.__megaCD4?.runtime.getState()})).catch(()=>null)});await page.screenshot({path:path.join(images,`${name}-${execution}-failure.png`)}).catch(()=>{});throw error;}
     finally{await page.close();}
    }
    for(const mode of ['pc-engine-cd','genesis','genesis-full','genesis-full-nuked']){const page=await browser.newPage({serviceWorkers:'block'});try{regressions.push({browser:name,...await checkOtherMode(page,origin,mode)});}finally{await page.close();}}
   }finally{await browser.close();}
  }
  await fs.writeFile(out,JSON.stringify({schemaVersion:1,passed:true,physicalOutputMuted:true,results,regressions,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),checkerSha256:sha(await fs.readFile(__filename))},null,2)+'\n');
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
