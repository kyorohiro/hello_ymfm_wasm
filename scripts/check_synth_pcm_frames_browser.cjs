// Variable-length RF5C164 presets and actual numeric pointer dragging.
// Every speaker destination is intercepted before application JavaScript at
// gain zero. Chromium also receives --mute-audio. Fixtures are self-authored.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{tmpdir}=require('node:os'),{pathToFileURL}=require('node:url'),{chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'synth-pcm-frames-browser.json'),screenshots:path.join(tmpdir(),'synth-pcm-frames-browser')};
for(const arg of process.argv.slice(2)){const m=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(m,'Unknown argument '+arg);config[m[1]]=m[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(n=>['chromium','webkit'].includes(n)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=b=>createHash('sha256').update(b).digest('hex');
const served=new Map(),missing=[],external=[],httpErrors=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'};
async function until(predicate,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await wait(30);}throw Error('Timeout: '+label);}
const ready=page=>until(()=>page.locator('.synth-editor').getAttribute('aria-busy').then(v=>v==='false'),'Synth ready');

function installAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,Channel=window.MessageChannel;
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,ports=new WeakMap(),peers=new WeakMap(),nodes=[],meters=[];
  const pcm=()=>({selected:0,mask:255,enabled:false,loads:0,ram:new Uint8Array(65536),channels:Array.from({length:8},()=>Array(7).fill(0))});
  window.AudioContext=class extends Context{};if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.MessageChannel=class extends Channel{constructor(){super();peers.set(this.port1,this.port2);peers.set(this.port2,this.port1);}};
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);const item={name,context,state:pcm(),disposed:false};nodes.push(item);ports.set(this.port,item);}};
  MessagePort.prototype.postMessage=function(message,...args){
    const item=ports.get(this);
    if(item&&typeof message?.port?.postMessage==='function'){ports.set(message.port,item);const peer=peers.get(message.port);if(peer)ports.set(peer,item);}
    for(const m of Array.isArray(message)?message:[message])if(item?.name==='tetorica-synth-pcm'&&m&&typeof m==='object'){
      const s=item.state,a=m.args??[];
      if(m.method==='dispose')item.disposed=true;
      if(m.method==='reset'){const ram=s.ram;item.state=pcm();item.state.ram=ram;}
      if(m.method==='loadMemory'){s.ram.set(a[0],a[1]??0);s.loads++;}
      if(m.method==='writeRegister'){const [r,v]=a;if(r<7)s.channels[s.selected][r]=v;else if(r===7){s.enabled=Boolean(v&128);if(v&64)s.selected=v&7;}else if(r===8)s.mask=v;}
      if(m.method==='keyOn')s.mask&=~(1<<a[0]);
      if(m.method==='keyOff'||m.method==='releaseNote')s.mask|=1<<a[0];
    }
    return post.call(this,message,...args);
  };
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=8192;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({analyser,mute});return destination;
  };
  const current=()=>nodes.find(n=>n.name==='tetorica-synth-pcm'&&!n.disposed&&n.context.state!=='closed')?.state;
  window.__pcmFrameAudit={
    memory:()=>{const s=current();return s?{loads:s.loads,bytes:Array.from(s.ram)}:null;},
    state:()=>{const s=current();return s?{loads:s.loads,mask:s.mask,enabled:s.enabled,channels:s.channels.map((r,ch)=>({channel:ch,volume:r[0],panLeft:r[1]&15,panRight:r[1]>>4,step:r[2]|r[3]<<8,loop:r[4]|r[5]<<8,start:r[6]<<8,keyOn:!(s.mask&(1<<ch))}))}:null;},
    levels:()=>meters.map(({analyser,mute})=>{const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);let sum=0,squares=0,peak=0;for(const v of values){sum+=v;squares+=v*v;peak=Math.max(peak,Math.abs(v));}return{finite:values.every(Number.isFinite),peak,acRms:Math.sqrt(Math.max(0,squares/values.length-(sum/values.length)**2)),muted:mute.gain.value===0};}),
    graph:()=>({worklets:nodes.map(n=>n.name),destinations:meters.length,muted:meters.every(n=>n.mute.gain.value===0)})
  };
}
function fixture(frames){
  const bytes=Buffer.from(Array.from({length:frames},(_,i)=>{const value=Math.sin(i*Math.PI*2/32);return Math.round(Math.abs(value)*42)|(value>=0?128:0);}));
  const end=frames===9215?9215:frames===1?1:frames-Math.max(7,Math.floor(frames/50)),start=frames===9215?8960:frames===1?0:Math.floor(frames/8);
  return{version:1,kind:'tetorica-rf5c164',settings:{volume:49,panLeft:9,panRight:12,rootNote:57,loopEnabled:true,loopStart:start,loopEnd:end},
    sample:{name:'PCM '+frames+' frames',sampleRate:22050,encoding:'rf5c164-sign-magnitude',data:bytes.toString('base64')}};
}
const presets=new Map([1,128,256,1024,4096,9215].map(frames=>[frames,fixture(frames)]));
const filename=frames=>'Frames-'+String(frames).padStart(4,'0')+'.pcm.json';
const control=(page,field)=>page.locator('#synthPcm'+field);
async function value(page,field){return Number(await control(page,field).textContent());}
async function download(page,selector){const pending=page.waitForEvent('download');await page.locator(selector).evaluate(node=>node.click());const file=await pending,chunks=[];for await(const chunk of await file.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);}
const exported=async page=>JSON.parse((await download(page,'#exportPcmButton')).toString());
let createSynthProject;
async function cassette(page){const project=createSynthProject();await project.importCassette(await download(page,'#exportCassetteButton'));return project;}
async function choose(page,frames){
  const options=await page.locator('#synthPcmPresetSelect option').evaluateAll(nodes=>nodes.map(n=>({value:n.value,text:n.textContent})));
  const option=options.find(n=>n.value.startsWith('vfs:')&&n.value.endsWith('/'+filename(frames)));assert(option,'preset option '+frames);
  await page.locator('#synthPcmPresetSelect').selectOption(option.value);await ready(page);
  await until(()=>page.locator('#synthPcmSampleInfo').textContent().then(v=>v.includes('· '+frames+' frames ·')),'sample info '+frames);
  assert.equal(await page.locator('#synthSongChannelSelect').inputValue(),'synth','Explicit preset selection chooses Auto');
  return option.value;
}
async function chooseFile(page,file){
  if(!await page.locator('#synthFilesPanel').isVisible())await page.locator('#synthFilesToggle').click();
  for(let i=0;i<20;i++){const closed=page.locator('#synthFilesTree details:not([open]) > summary[data-file-path]');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#synthFilesTree button.file-entry').locator('xpath=self::*[@data-file-path='+JSON.stringify(file)+']').click();await ready(page);
}
async function pointerDrag(page,field,dx){
  const node=control(page,field);await node.scrollIntoViewIfNeeded();const before=await value(page,field),box=await node.boundingBox();assert(box);
  const x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y,{steps:6});await page.mouse.up();await wait(50);
  assert(!await node.evaluate(n=>n.classList.contains('is-dragging')),'Pointer drag finishes cleanly');return{before,after:await value(page,field)};
}
async function stepValue(page,field,direction){
  const before=await value(page,field),node=page.locator('[data-pcm-field="'+{LoopStart:'loopStart',LoopEnd:'loopEnd'}[field]+'"][data-pcm-step="'+direction+'"]');
  await node.click();assert.equal(await value(page,field),before+direction,'+/- moves exactly one frame');
}
async function checkPreset(page,preset,{settings=true}={}){
  const current=await exported(page);assert.equal(current.sample.data,preset.sample.data);assert.equal(current.sample.sampleRate,preset.sample.sampleRate);
  assert.equal(current.settings.rootNote,preset.settings.rootNote);if(settings)assert.deepEqual(current,preset);
  assert.equal(await value(page,'LoopStart'),current.settings.loopStart);assert.equal(await value(page,'LoopEnd'),current.settings.loopEnd);
  const frames=Buffer.from(current.sample.data,'base64').length;assert(current.settings.loopStart>=0&&current.settings.loopStart<current.settings.loopEnd&&current.settings.loopEnd<=frames);
  return current;
}
async function checkRam(page,preset){
  const expected=Buffer.alloc(65536,255),bytes=Buffer.from(preset.sample.data,'base64');bytes.copy(expected,0,0,preset.settings.loopEnd);
  await until(()=>page.evaluate(expected=>{const m=__pcmFrameAudit.memory();return m&&m.bytes.length===expected.length&&m.bytes.every((v,i)=>v===expected[i]);},Array.from(expected)),'chosen sample and marker RAM reach actual worklet');
  return {frames:bytes.length,loopStart:preset.settings.loopStart,loopEnd:preset.settings.loopEnd,ramSha256:hash(expected)};
}
async function key(page,down){
  await page.locator('#synthInputKeyboardTab').click();
  await until(()=>page.locator('#synthInputSection').getAttribute('data-input-mode').then(mode=>mode==='keyboard'),'Keyboard view ready');
  await page.evaluate(()=>document.activeElement?.blur());
  await page.keyboard[down?'down':'up']('a');
  await until(()=>page.locator('#keyboard .key[data-key="a"]').evaluate((n,wanted)=>n.classList.contains('is-active')===wanted,down),'keyboard '+down);
}
async function prepareAudio(page){
  await page.locator('#synthInputKeyboardTab').click();await page.evaluate(()=>document.activeElement?.blur());
  // A cold key is also the user gesture that prepares audio. Release it before
  // checking a held performance key, as in the ordinary Synth smoke check.
  await page.keyboard.press('a');
  await until(()=>page.locator('#status').textContent().then(value=>/Audio ready/.test(value)),'audio ready');
  await page.keyboard.up('a');
}
async function beginCode(page){
  await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
  await page.locator('#synthCodeEditor').fill("const pcm=await useSoundChip('rf5c164');\ncontext.boots=(context.boots??0)+1;\nconst prepared=await livePrepare('pcm-frame-proof',()=>({ticks:0}));\nglobalThis.__frameProbe={pcm,context,prepared};\nliveLoop('pcm-frame-proof',async()=>{prepared.ticks++;await sleep(.05);});");
  await page.locator('#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return page.evaluate(()=>globalThis.__frameProbe?.prepared.ticks>1);},'Code running');
  await page.evaluate(()=>{globalThis.__frameIdentity=__frameProbe;});
}
async function codeKept(page){
  assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);
  assert(await page.evaluate(()=>__frameProbe===__frameIdentity&&__frameProbe.context.boots===1));assert.equal(await page.locator('#synthCodeError').textContent(),'');
}
async function check(browser,name,origin){
  const page=await browser.newPage({viewport:{width:1240,height:1050},serviceWorkers:'block',acceptDownloads:true}),errors=[],consoleErrors=[],checks=[],measurements=[];let stage='startup';
  const step=label=>{stage=label;checks.push(label);console.log('CHECK '+name+': '+label);};page.setDefaultTimeout(20000);
  page.on('pageerror',e=>errors.push(e.stack??e.message));page.on('console',m=>{if(m.type()==='error'&&!/cdnjs|Failed to load resource/.test(m.text()+' '+m.location().url))consoleErrors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)httpErrors.push({url:r.url(),status:r.status()});});
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(u.href);return route.abort();}if(u.origin!==origin&&!['blob:','data:'].includes(u.protocol)){external.push(u.href);return route.abort();}return route.continue();});
  await page.addInitScript(installAudit);
  try{
    await page.goto(origin+config.entry);await ready(page);
    step('Files presets retain 1, 128, 256, 1024, 4096 and 9215 frames with their actual loop and sample settings');
    await page.locator('#tfiFile').setInputFiles([...presets].map(([frames,preset])=>({name:filename(frames),mimeType:'application/json',buffer:Buffer.from(JSON.stringify(preset))})));await ready(page);
    await until(()=>page.locator('#synthPcmPresetSelect option').count().then(n=>n>=7),'six imported PCM presets');
    for(const frames of [1,128,256,1024,4096,9215,128,4096,256]){await choose(page,frames);await checkPreset(page,presets.get(frames));}
    await prepareAudio(page);await key(page,true);await key(page,false);await checkRam(page,presets.get(256));

    step('Small real drags on Loop Start and End yield interior frame values rather than jumping to 0 or 255');
    for(const frames of [256,128,1024]){
      await choose(page,frames);
      const start=await pointerDrag(page,'LoopStart',12);assert(start.after>start.before&&start.after<frames-1,'Loop Start small right drag is interior at '+frames);
      assert(start.after-start.before<=Math.ceil(frames*.2),'Loop Start sensitivity uses current sample length');
      const back=await pointerDrag(page,'LoopStart',-6);assert(back.after<back.before&&back.after>0,'Loop Start left drag stays interior');
      const end=await pointerDrag(page,'LoopEnd',-12);assert(end.after<end.before&&end.after>await value(page,'LoopStart')+1,'End small left drag is interior');
      assert(end.before-end.after<=Math.ceil(frames*.2),'End sensitivity uses current sample length');
      await stepValue(page,'LoopStart',1);await stepValue(page,'LoopStart',-1);await stepValue(page,'LoopEnd',1);await stepValue(page,'LoopEnd',-1);
      const changed=await checkPreset(page,presets.get(frames),{settings:false});await checkRam(page,changed);measurements.push({frames,start,back,end,settings:changed.settings});
    }

    step('Frame limits follow the current loop interval and update when a long preset is replaced by a single-frame or short sample');
    await choose(page,4096);const high=await pointerDrag(page,'LoopStart',300);assert.equal(high.after,(await value(page,'LoopEnd'))-1);
    await pointerDrag(page,'LoopEnd',-300);assert.equal(await value(page,'LoopEnd'),(await value(page,'LoopStart'))+1);
    await choose(page,1);assert.equal(await value(page,'LoopStart'),0);assert.equal(await value(page,'LoopEnd'),1);
    for(const field of ['loopStart','loopEnd'])for(const direction of [-1,1])assert(await page.locator('[data-pcm-field="'+field+'"][data-pcm-step="'+direction+'"]').isDisabled());
    const one=await pointerDrag(page,'LoopStart',12);assert.equal(one.after,0);assert.deepEqual(await checkPreset(page,presets.get(1)),presets.get(1));
    await choose(page,256);const resized=await pointerDrag(page,'LoopStart',12);assert(resized.after>resized.before&&resized.after<255);
    const edited256=await exported(page);

    step('Choosing a 256-frame built-in shape leaves a captured 9215-frame preset and its checkpoint unchanged and selectable');
    const capturedId=await choose(page,9215),capturedPath=capturedId.slice(4);
    // One ordinary file edit supplies a real baseline checkpoint. Recovery must
    // remain available independently from selecting a different built-in sound.
    await page.locator('[data-pcm-field="volume"][data-pcm-step="1"]').click();
    await until(()=>value(page,'Volume').then(n=>n===50),'captured preset edited');
    const captured=await exported(page),prior=await cassette(page);
    const originalBytes=prior.fs.get(capturedPath).data,checkpoint=prior.fs.get('/.tet.ss'+capturedPath)?.data;
    assert(checkpoint,'Edited source has a retained baseline checkpoint');
    await page.locator('[data-pcm-builtin="saw"]').click();await ready(page);
    await until(()=>page.locator('#synthPcmPresetSelect').inputValue().then(value=>value==='pcm-saw'),'separate Saw author preset');
    const saw=await exported(page);assert.equal(Buffer.from(saw.sample.data,'base64').length,256);assert.equal(saw.settings.loopStart,0);assert.equal(saw.settings.loopEnd,256);
    const afterSaw=await cassette(page);assert.deepEqual(afterSaw.fs.get(capturedPath).data,originalBytes,'Built-in selection cannot overwrite the source file');
    assert.deepEqual(afterSaw.fs.get('/.tet.ss'+capturedPath)?.data,checkpoint,'Built-in selection cannot replace the source checkpoint');
    assert.deepEqual(afterSaw.readTone(capturedPath).preset,captured);
    await chooseFile(page,capturedPath);await until(()=>page.locator('#synthPcmSampleInfo').textContent().then(value=>value.includes('· 9215 frames ·')),'captured source reload');
    await checkPreset(page,captured);await checkRam(page,captured);
    assert(await page.locator('#synthFileRevertButton').isEnabled(),'Original checkpoint remains recoverable after reselecting the source');
    await page.locator('#synthFileRevertButton').click();await ready(page);await checkPreset(page,presets.get(9215));await checkRam(page,presets.get(9215));

    step('Selecting a longer preset during Code physical-CH viewing applies all frames and preserves Code context and its loop');
    await beginCode(page);await page.locator('[data-synth-channel-target="pcm:7"]').click();
    await until(()=>page.locator('#synthSongChannelSelect').inputValue().then(v=>v==='pcm:7'),'Code CH8');
    const selectedId=await choose(page,1024);await checkPreset(page,presets.get(1024),{settings:false});await codeKept(page);
    const beforeTick=await page.evaluate(()=>__frameProbe.prepared.ticks),codeDrag=await pointerDrag(page,'LoopStart',8);
    assert(codeDrag.after>codeDrag.before&&codeDrag.after<1023);await codeKept(page);
    await until(()=>page.evaluate(n=>__frameProbe.prepared.ticks>n,beforeTick),'Code loop survives frame drag');
    const edited1024=await exported(page);await checkRam(page,edited1024);
    await page.locator('[data-pcm-builtin="square"]').click();await ready(page);await codeKept(page);
    assert.equal(await page.locator('#synthPcmPresetSelect').inputValue(),'pcm-square');assert.equal(Buffer.from((await exported(page)).sample.data,'base64').length,256);
    await choose(page,1024);await checkPreset(page,edited1024);await checkRam(page,edited1024);await codeKept(page);
    await key(page,true);await until(()=>page.evaluate(()=>{const s=__pcmFrameAudit.state();return s&&s.channels.some(c=>c.keyOn);}), 'PCM keyed');
    await until(()=>page.evaluate(()=>{const levels=__pcmFrameAudit.levels();return levels.length&&levels.every(x=>x.muted&&x.finite)&&levels.some(x=>x.acRms>.00001);}), 'finite nonzero internal PCM');
    measurements.push({codeDrag,signal:await page.evaluate(()=>__pcmFrameAudit.levels())});await key(page,false);await codeKept(page);
    await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(v=>/Stopped/.test(v)),'Code stopped');
    assert.equal(await page.locator('#synthPcmPresetSelect').inputValue(),selectedId);await checkPreset(page,edited1024);

    step('Edited frame settings persist in Files and reload without losing variable-length sample data');
    await choose(page,256);await checkPreset(page,edited256);await choose(page,1024);await checkPreset(page,edited1024);
    await page.reload();await ready(page);await until(()=>page.locator('#synthPcmSampleInfo').textContent().then(v=>v.includes('· 1024 frames ·')),'restored variable sample');
    await checkPreset(page,edited1024);assert.match(await page.locator('#synthCodeState').textContent(),/Idle|Stopped/);

    step('Variable frame controls remain usable and compact on desktop and phone widths; all destinations stay muted');
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await control(page,'LoopStart').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png')});}
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert((await page.evaluate(()=>__pcmFrameAudit.graph())).muted);
    return{browser:name,passed:true,checks,measurements,graph:await page.evaluate(()=>__pcmFrameAudit.graph()),errors,consoleErrors};
  }catch(error){await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png')}).catch(()=>{});error.receipt={browser:name,passed:false,stage,checks,error:error.stack,diagnostic:await page.evaluate(()=>({info:document.getElementById('synthPcmSampleInfo').textContent,start:document.getElementById('synthPcmLoopStart').textContent,end:document.getElementById('synthPcmLoopEnd').textContent,target:document.getElementById('synthSongChannelSelect').value,code:document.getElementById('synthCodeState').textContent,status:document.getElementById('status').textContent,audio:__pcmFrameAudit.state()})).catch(()=>null),errors,consoleErrors};throw error;
  }finally{await page.close();}
}
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const file=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(file.startsWith(config.root+path.sep));const bytes=await fs.readFile(file),name=path.relative(config.root,file).split(path.sep).join('/'),meta={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(name))assert.deepEqual(served.get(name),meta,'Asset changed during browser check');served.set(name,meta);res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{({createSynthProject}=await import(pathToFileURL(path.join(repo,'docs/synth/synth_project.js')).href));await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,checkerSha256:hash(await fs.readFile(__filename)),results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack}:{} )};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
