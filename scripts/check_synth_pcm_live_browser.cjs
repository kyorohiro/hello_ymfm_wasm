// Exercise public PCM VGM Live / Pause / Copy controls with self-authored data.
// Every physical speaker edge is intercepted before the application runs and
// goes through gain zero. Actual native PCM is inspected as numeric arrays.
// No listening test, native application or system volume control is used.
// node scripts/check_synth_pcm_live_browser.cjs [--root=docs]
//   [--entry=/synth/index.html] [--engines=chromium,webkit]
//   [--out=/tmp/pcm-live.json] [--screenshots=/tmp/pcm-live]
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {tmpdir}=require('node:os'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const repository=path.resolve(__dirname,'..');
const config={root:path.join(repository,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'fm2612-pcm-live-browser.json'),screenshots:path.join(tmpdir(),'fm2612-pcm-live-browser')};
for(const arg of process.argv.slice(2)) {
  const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);
  assert(match,'Unknown argument '+arg);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/'));
const engines=config.engines.split(',');assert(engines.every(name=>['chromium','webkit'].includes(name)));
const RATE=53267,RF_CLOCK=12500000,YM_CLOCK=7670454;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(task,label,ms=25000) {
  let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timeout '+label)),ms);})]);}
  finally{clearTimeout(timer);}
}
const evaluate=(page,fn,arg)=>bounded(page.evaluate(fn,arg),'page evaluation');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const encode=value=>Math.min(126,Math.round(Math.abs(value)*126))|(value>=0?128:0);
const sample1=Buffer.from(Array.from({length:256},(_,i)=>encode(Math.sin((i-16)*2*Math.PI/60))));
const sample2=Buffer.from(Array.from({length:512},(_,i)=>encode(Math.sin(i*2*Math.PI/64))));
function wait(commands,seconds) {
  let frames=Math.round(seconds*44100);
  while(frames){const count=Math.min(frames,65535);commands.push(0x61,count&255,count>>8);frames-=count;}
}
const register=(commands,r,v)=>commands.push(0xb1,r,v);
function ramBlock(commands,address,sample) {
  const bytes=Buffer.concat([sample,Buffer.alloc(33,255)]),length=bytes.length+2;
  commands.push(0x67,0x66,0xc1,length&255,length>>8&255,length>>16&255,length>>24,address&255,address>>8,...bytes);
}
function rfChannel(commands,ch,{start,loopStart,step,volume,pan}) {
  register(commands,7,0xc0|ch);
  for(const [r,v]of [[0,volume],[1,pan],[2,step&255],[3,step>>8],[4,loopStart&255],[5,loopStart>>8],[6,start>>8]])register(commands,r,v);
}
function buildVgm(commands,seconds,{rf=true}={}) {
  const bytes=Buffer.alloc(256+commands.length),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  bytes.write('Vgm ');view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);view.setUint32(0x34,204,true);
  view.setUint32(0x2c,YM_CLOCK,true);view.setUint32(0x0c,3579545,true);view.setUint32(0x6c,rf?RF_CLOCK:0,true);
  view.setUint32(0x18,Math.round(seconds*44100),true);bytes.set(commands,256);return bytes;
}
function silentOtherChips(commands) {
  // Include a valid, muted FM instrument for the public VGM importer and PSG
  // source snapshots. Only RF5C164 contributes to the reference audio.
  commands.push(0x52,0xb0,7,0x52,0xb4,0,0x52,0xa4,0x22,0x52,0xa0,0x44);
  for(const slot of [0,4,8,12])for(const [base,value]of [[0x30,1],[0x40,127],[0x50,31],[0x60,0],[0x70,0],[0x80,15]])commands.push(0x52,base+slot,value);
  commands.push(0x52,0x28,0,0x50,0x84,0x50,0x1a,0x50,0x9f);
}
function timedSong() {
  const c=[];silentOtherChips(c);register(c,7,0x80);
  ramBlock(c,0x100,sample1);ramBlock(c,0x400,sample2);
  rfChannel(c,7,{start:0x400,loopStart:0x400,step:2048,volume:80,pan:0xf0});
  rfChannel(c,0,{start:0x100,loopStart:0x110,step:1024,volume:64,pan:0xff});register(c,8,0xfe);
  wait(c,2);register(c,0,96);register(c,1,0xf0);
  wait(c,2);c.push(0xc2,0x30,1,0x81); // Patch sample frame 48 through bank zero.
  wait(c,2);register(c,8,0x7f);
  wait(c,14);c.push(0x66);return buildVgm(c,20);
}
function unsafeSong() {
  const c=[];silentOtherChips(c);register(c,7,0x80);
  const data=Buffer.from([0x90,0xa0,0xb0,0xc0,0x50,0x40,0x30,0x20]);
  const length=data.length+2;c.push(0x67,0x66,0xc1,length,0,0,0,0,1,...data);
  rfChannel(c,0,{start:0x100,loopStart:0x100,step:1024,volume:64,pan:0xff});register(c,8,0xfe);
  wait(c,20);c.push(0x66);return buildVgm(c,20);
}
function noPcmSong(){const c=[];silentOtherChips(c);wait(c,20);c.push(0x66);return buildVgm(c,20,{rf:false});}

function installAudit() {
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,Worklet=window.AudioWorkletNode,Channel=window.MessageChannel;
  const meters=[],events=[],ports=new WeakMap(),peers=new WeakMap(),ackPorts=new WeakSet(),owners=[],canvasLabels=new Map();let nextOwner=1;
  // The shared RF setup transfers port1 into the worklet and exposes port2 to
  // the Synth. Associate that endpoint with its owner before the transfer.
  window.MessageChannel=new Proxy(Channel,{construct(Target,args,newTarget){
    const channel=Reflect.construct(Target,args,newTarget);peers.set(channel.port1,channel.port2);peers.set(channel.port2,channel.port1);return channel;
  }});
  function bindPort(port,owner) {
    ports.set(port,owner);
    if(ackPorts.has(port))return;
    ackPorts.add(port);
    port.addEventListener('message',({data})=>{if(data?.id)events.push({kind:'ack',owner:owner.id,id:data.id,error:data.error??null});});port.start();
  }
  const label=CanvasRenderingContext2D.prototype.fillText,clear=CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){
    if(this.canvas.id==='synthPcmCanvas'){const labels=canvasLabels.get(this.canvas)??[];labels.push(String(text));canvasLabels.set(this.canvas,labels);}
    return label.call(this,text,...args);
  };
  CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){if(this.canvas.id==='synthPcmCanvas'&&x===0&&y===0&&w>=this.canvas.width&&h>=this.canvas.height)canvasLabels.set(this.canvas,[]);return clear.call(this,x,y,w,h);};
  function meter(source,kind,owner=null,destination=source.context.destination) {
    const split=source.context.createChannelSplitter(2),left=source.context.createAnalyser(),right=source.context.createAnalyser(),mute=source.context.createGain();
    left.fftSize=right.fftSize=8192;mute.gain.value=0;
    connect.call(source,split);connect.call(split,left,0);connect.call(split,right,1);connect.call(left,mute);connect.call(right,mute);connect.call(mute,destination);
    meters.push({kind,owner,left,right,mute});
  }
  window.AudioWorkletNode=new Proxy(Worklet,{construct(Target,args,newTarget){
    const node=Reflect.construct(Target,args,newTarget);
    if(args[1]==='tetorica-synth-pcm') {
      const owner={id:nextOwner++,mask:255,selected:0,steps:Array(8).fill(0),context:node.context};owners.push(owner);bindPort(node.port,owner);node.__pcmLiveOwner=owner.id;
    }
    return node;
  }});
  AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination){meter(this,'output',null,destination);return destination;}
    const result=connect.call(this,destination,...args);
    if(this.__pcmLiveOwner&&!this.__pcmLiveMeter){this.__pcmLiveMeter=true;meter(this,'rf',this.__pcmLiveOwner);}
    return result;
  };
  MessagePort.prototype.postMessage=function(message,...args){
    const owner=ports.get(this);
    if(owner)for(const command of Array.isArray(message)?message:[message]) {
      if(command?.port&&peers.has(command.port))bindPort(peers.get(command.port),owner);
      if(command?.method==='writeRegister') {
        const [r,v]=command.args;events.push({kind:'register',owner:owner.id,r,v});
        if(r===7&&(v&64))owner.selected=v&7;
        if(r===2)owner.steps[owner.selected]=(owner.steps[owner.selected]&0xff00)|v;
        if(r===3)owner.steps[owner.selected]=(owner.steps[owner.selected]&255)|(v<<8);
        if(r===8){for(let ch=0;ch<8;ch++)if((owner.mask&(1<<ch))&&!(v&(1<<ch)))events.push({kind:'keyOn',owner:owner.id,ch,step:owner.steps[ch]});owner.mask=v;}
      } else if(['keyOn','keyOff','releaseNote'].includes(command?.method)) {
        const ch=command.args[0];events.push({kind:command.method,owner:owner.id,ch,step:owner.steps[ch]});
        if(command.method==='keyOn')owner.mask&=~(1<<ch);else owner.mask|=1<<ch;
      } else if(command?.method==='reset'){owner.mask=255;events.push({kind:'reset',owner:owner.id});}
      else if(command?.method==='loadMemory')events.push({kind:'memory',owner:owner.id,id:command.id,address:command.args?.[1],length:command.args?.[0]?.length});
    }
    if(events.length>20000)events.splice(0,events.length-20000);
    return post.call(this,message,...args);
  };
  function sample(analyser) {
    const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);
    let sum=0,squares=0,min=Infinity,max=-Infinity;for(const value of pcm){sum+=value;squares+=value*value;min=Math.min(min,value);max=Math.max(max,value);}
    const mean=sum/pcm.length,edges=[];
    for(let i=1;i<pcm.length;i++)if(pcm[i-1]<mean&&pcm[i]>=mean)edges.push(i-1+(mean-pcm[i-1])/(pcm[i]-pcm[i-1]));
    return {rms:Math.sqrt(Math.max(0,squares/pcm.length-mean*mean)),peak:Math.max(Math.abs(min),Math.abs(max)),
      frequency:edges.length>4?analyser.context.sampleRate*(edges.length-1)/(edges.at(-1)-edges[0]):0,finite:pcm.every(Number.isFinite)};
  }
  window.__pcmLiveAudit={drain:()=>events.splice(0),read:()=>({
    owners:owners.map(({id,mask,selected,steps})=>({id,mask,selected,steps:[...steps]})),
    meters:meters.map(({kind,owner,left,right,mute})=>({kind,owner,left:sample(left),right:sample(right),muted:mute.gain.value===0})),
    canvasLabels:[...(canvasLabels.get(document.getElementById('synthPcmCanvas'))??[])],
  })};
}
const audit=page=>evaluate(page,()=>__pcmLiveAudit.read());
const drain=page=>evaluate(page,()=>__pcmLiveAudit.drain());
const transport=page=>evaluate(page,()=>({
  state:document.getElementById('synthSongStatus').dataset.state,target:document.getElementById('synthSongChannelSelect').value,
  frame:Number(document.getElementById('synthSongPlayer').dataset.consumedFrames),
  status:document.getElementById('synthSongLiveStatus').textContent,path:document.getElementById('synthActiveFilePath').textContent,
  chip:document.querySelector('[data-synth-chip][aria-selected="true"]')?.dataset.synthChip,
  keyboard:document.getElementById('keyboard').dataset.songAudition,
  live:document.getElementById('synthSongPlayer').dataset.live,
  cache:{count:Number(document.getElementById('synthSongPlayer').dataset.cacheCount),supported:document.getElementById('synthSongPlayer').dataset.cacheSupported},
}));
async function until(page,test,label,ms=20000) {
  const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await pause(25);}
  throw Error(label+'; '+JSON.stringify({transport:await transport(page).catch(()=>null),audit:await audit(page).catch(()=>null)}));
}
const state=(page,value)=>until(page,async()=>(await transport(page)).state===value,'Transport '+value);
const ready=page=>page.waitForFunction(()=>!document.getElementById('importPresetButton').disabled&&document.querySelector('.synth-editor').getAttribute('aria-busy')!=='true');
const keyState=(page,key,active)=>until(page,()=>evaluate(page,({key,active})=>document.querySelector(`#keyboard .key[data-key="${key}"]`).classList.contains('is-active')===active,{key,active}),'Key state '+key+' '+active);
const auditionReady=page=>until(page,async()=>(await transport(page)).keyboard==='ready','Selected PCM memory acknowledged');
const ui=page=>evaluate(page,()=>({
  volume:Number(document.getElementById('synthPcmVolume').textContent),panLeft:Number(document.getElementById('synthPcmPanLeft').textContent),panRight:Number(document.getElementById('synthPcmPanRight').textContent),
  step:Number(document.getElementById('synthPcmStep').textContent),loopStart:document.getElementById('synthPcmLoopStart').textContent,loopEnd:document.getElementById('synthPcmLoopEnd').textContent,
  sample:document.getElementById('synthPcmSampleInfo').textContent,rootHidden:document.getElementById('synthPcmRootField').hidden,stepHidden:document.getElementById('synthPcmStepField').hidden,
  settingsInert:document.getElementById('synthPcmSettings').inert,canvasInert:document.getElementById('synthPcmCanvas').inert,
}));
async function canvasHash(page) {
  return evaluate(page,async()=>{const canvas=document.getElementById('synthPcmCanvas'),bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');});
}
async function checkbox(page,id,value) {await page.locator('#'+id).evaluate((node,value)=>{node.checked=value;node.dispatchEvent(new Event('change',{bubbles:true}));},value);}
async function seek(page,seconds,playback='paused') {
  await page.locator('#synthSongSeek').evaluate((node,seconds)=>{node.value=String(seconds);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},seconds);
  await until(page,async()=>{const t=await transport(page);return t.state===playback&&Math.abs(t.frame-seconds*RATE)<RATE*(playback==='playing'?.4:.005);},'Seek to '+seconds+' '+playback);
}
async function level(page,kind='output'){return Math.max(0,...(await audit(page)).meters.filter(m=>m.kind===kind).flatMap(m=>[m.left.rms,m.right.rms]));}
async function silence(page,kind='output'){await pause(350);await until(page,async()=>(await level(page,kind))<1e-7,'Silence '+kind);}
async function sounding(page,kind='output'){await until(page,async()=>(await level(page,kind))>.0001,'Signal '+kind);}
async function chip(page,id){await page.locator(`[data-synth-chip="${id}"]`).click();await until(page,async()=>(await transport(page)).chip===id,'Chip '+id);await ready(page);}
async function down(page,key){await evaluate(page,()=>document.activeElement?.blur?.());await page.keyboard.down(key);}
async function c4Key(page) {
  return evaluate(page,clock=>{let best=null;for(const node of document.querySelectorAll('#keyboard .key[data-key]')){
    const match=/b(\d+)\s*\/\s*f(\d+)/.exec(node.querySelector('small')?.textContent??'');if(!match||node.dataset.key.length!==1)continue;
    const hz=Number(match[2])*clock*2**(Number(match[1])-1)/(144*2**20),distance=Math.abs(Math.log2(hz/(440*2**((60-69)/12))));
    if(!best||distance<best.distance)best={key:node.dataset.key,hz,distance};
  }if(!best||best.distance>.02)throw Error('C4 key not found');return best;},YM_CLOCK);
}
async function menu(page){if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();}
async function download(page,id){await menu(page);const pending=page.waitForEvent('download');await page.locator(id).click();const item=await pending,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);}
const exportPcm=async page=>JSON.parse((await download(page,'#exportPcmButton')).toString());
let loadCassette;
async function cassette(page){return loadCassette(await download(page,'#exportCassetteButton'));}
function archiveBytes(archive,name){const bytes=archive.files.get(name.replace(/^\//,''));assert(bytes,'Missing archive file '+name);return Buffer.from(bytes);}
async function sync(page){await page.locator('#synthFileSaveButton').click();await ready(page);await until(page,()=>page.locator('#synthFileSaveButton').getAttribute('data-feedback').then(value=>value==='success'),'Synced instrument');}
async function chooseFile(page,p) {
  if(!await page.locator('#synthFilesPanel').isVisible())await page.locator('#synthFilesToggle').click();
  for(let i=0;i<20;i++){const closed=page.locator('#synthFilesTree details:not([open]) > summary[data-file-path]');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#synthFilesTree button.file-entry').locator(`xpath=self::*[@data-file-path=${JSON.stringify(p)}]`).click();
  await until(page,async()=>(await transport(page)).path===p,'Choose '+p);await ready(page);
}
async function field(page,name,value){
  const node=page.locator('#synthPcm'+name),before=Number(await node.textContent()),max={Volume:255,LoopStart:65502,LoopEnd:65502}[name];
  const box=await node.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+(value-before)/max*160,box.y+box.height/2,{steps:3});await page.mouse.up();
  for(let i=0;i<100&&Number(await node.textContent())!==value;i++){const current=Number(await node.textContent());await page.locator(`[data-pcm-field="${name[0].toLowerCase()+name.slice(1)}"][data-pcm-step="${value>current?1:-1}"]`).click();}
  assert.equal(Number(await node.textContent()),value);
}

const served=new Map(),missing=[],external=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp'};
const server=http.createServer(async(request,response)=>{try{
  const pathname=new URL(request.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),name=path.relative(config.root,filename).split(path.sep).join('/'),meta={bytes:bytes.length,sha256:digest(bytes)};
  if(served.has(name))assert.deepEqual(served.get(name),meta,'Asset changed during test');served.set(name,meta);
  response.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');response.end(bytes);
}catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}});

async function run(browser,name,origin) {
  const page=await browser.newPage({viewport:{width:1240,height:1100},serviceWorkers:'block',acceptDownloads:true});
  const errors=[],steps=[];page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installAudit);
  try {
    await page.goto(origin+config.entry);await ready(page);
    await chip(page,'ym2612');await page.locator('#presetSelect').selectOption('sine');await ready(page);await sync(page);const fmPath=(await transport(page)).path;
    await chip(page,'psg');await sync(page);const psgPath=(await transport(page)).path;
    await chip(page,'pcm');await page.locator('[data-pcm-builtin="triangle"]').click();await field(page,'Volume',75);await field(page,'LoopStart',12);await field(page,'LoopEnd',200);await sync(page);
    const pcmPath=(await transport(page)).path,originalPcm=await exportPcm(page);
    const originalNodes=await evaluate(page,()=>{window.__originalPcmNodes=[document.getElementById('synthPcmCanvas'),document.getElementById('synthPcmSettings'),document.getElementById('synthPcmVolume')];return true;});assert(originalNodes);
    const timed=timedSong(),unsafe=unsafeSong(),noPcm=noPcmSong();
    await page.locator('#tfiFile').setInputFiles([
      {name:'PCM Timed.vgm',mimeType:'application/octet-stream',buffer:timed},
      {name:'PCM Unsafe.vgm',mimeType:'application/octet-stream',buffer:unsafe},
      {name:'No PCM.vgm',mimeType:'application/octet-stream',buffer:noPcm},
    ]);await ready(page);
    await chooseFile(page,pcmPath);await page.locator('#synthSongChannelSelect').selectOption('synth');
    const before=await cassette(page),retained=new Map([fmPath,psgPath,pcmPath,'/vgm/PCM Timed.vgm','/vgm/PCM Unsafe.vgm','/vgm/No PCM.vgm'].map(p=>[p,archiveBytes(before,p)]));
    assert.equal(digest(retained.get('/vgm/PCM Timed.vgm')),digest(timed),'Original VGM source bytes retained');
    await page.locator('#synthSongSelect').selectOption('/vgm/PCM Timed.vgm');await page.locator('#synthSongChannelSelect').selectOption('pcm:0');
    assert(await page.locator('#synthSongLiveToggle').isChecked(),'Live defaults On');
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');
    await until(page,async()=>{const s=await ui(page);return s.volume===64&&s.step===1024;},'Initial PCM CH1 source values');await sounding(page);
    const first=await ui(page),initialCanvas=await canvasHash(page);assert.equal(first.loopStart,'272');assert.equal(first.loopEnd,'512');assert(first.rootHidden&&!first.stepHidden&&!first.settingsInert&&first.canvasInert);
    assert(await evaluate(page,()=>__originalPcmNodes.every((node,i)=>node===[document.getElementById('synthPcmCanvas'),document.getElementById('synthPcmSettings'),document.getElementById('synthPcmVolume')][i])),'Live reuses the same editor controls and canvas');
    assert.deepEqual(await page.locator('#synthSongChannelSelect option').evaluateAll(nodes=>nodes.map(n=>n.value)),['synth','pcm:0','pcm:1','pcm:2','pcm:3','pcm:4','pcm:5','pcm:6','pcm:7']);
    const key=await c4Key(page);assert.equal((await transport(page)).keyboard,'live','Playing reference channels accept direct native keyboard input');
    const timing=await evaluate(page,async rate=>{const rows=[];for(let i=0;i<500;i++){
      const frame=Number(document.getElementById('synthSongPlayer').dataset.consumedFrames);
      rows.push({frame,volume:Number(document.getElementById('synthPcmVolume').textContent),left:Number(document.getElementById('synthPcmPanLeft').textContent),changed:document.getElementById('synthPcmVolume').classList.contains('is-live-changed')});
      if(frame>2.2*rate)break;await new Promise(resolve=>setTimeout(resolve,10));
    }return rows;},RATE);
    const early=timing.filter(row=>row.frame>=1.7*RATE&&row.frame<1.95*RATE),late=timing.filter(row=>row.frame>2.08*RATE);
    assert(early.length>1&&early.every(row=>row.volume===64&&row.left===15),'No prefetched future PCM settings');
    assert(late.length>1&&late.every(row=>row.volume===96&&row.left===0),'PCM follows the consumed register write');
    assert(timing.some(row=>row.changed),'Live highlight pulses at the actual register transition');
    steps.push('Same PCM UI with editable live hardware values and read-only sample RAM, eight reference targets, consumed-time settings and optional highlights');

    await page.locator('#synthSongPlayButton').click();await state(page,'paused');await silence(page);
    const paused=(await transport(page)).frame;await pause(120);assert.equal((await transport(page)).frame,paused);
    await seek(page,.5);await auditionReady(page);assert.equal((await ui(page)).volume,64);assert.equal(await canvasHash(page),initialCanvas);
    await checkbox(page,'synthSongLiveToggle',false);const frozen=await ui(page);
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');
    await until(page,async()=>(await transport(page)).frame>2.2*RATE,'Transport advances with Live Off');const resumedFrozen=await ui(page);assert.equal(resumedFrozen.settingsInert,false);assert.deepEqual({...resumedFrozen,settingsInert:frozen.settingsInert,sample:resumedFrozen.sample.replace(/ · C4 reference step \d+$/,'')},frozen);assert.match((await transport(page)).status,/Frozen PCM CH1/);
    await checkbox(page,'synthSongLiveToggle',true);await until(page,async()=>(await ui(page)).volume===96,'Live On catches up');
    await checkbox(page,'synthSongHighlightToggle',false);
    const patchTiming=await evaluate(page,async rate=>{const rows=[];for(let i=0;i<500;i++){
      const frame=Number(document.getElementById('synthSongPlayer').dataset.consumedFrames);rows.push({frame,changed:document.getElementById('synthPcmCanvas').classList.contains('is-live-changed')});
      if(frame>4.2*rate)break;await new Promise(resolve=>setTimeout(resolve,10));
    }return rows;},RATE);
    assert(patchTiming.every(row=>!row.changed),'Highlight Off performs no change animation');const patchedCanvas=await canvasHash(page);assert.notEqual(patchedCanvas,initialCanvas,'Source RAM writes update the same Sample canvas');
    await page.locator('#synthSongPlayButton').click();await state(page,'paused');await auditionReady(page);await silence(page);
    const frozenPatchFrame=(await transport(page)).frame,prepared=await drain(page);await down(page,key.key);await keyState(page,key.key,true);await sounding(page,'rf');await pause(250);
    const on=(await drain(page)).filter(e=>e.kind==='keyOn');assert(on.length&&on.every(e=>e.ch===0),'Paused CH1 auditions only physical CH1');
    assert(on.every(e=>Math.abs(e.step-1024)<=2),'C4 retains the source playback speed');
    const owner=on.at(-1).owner,memory=prepared.filter(e=>e.kind==='memory'&&e.owner===owner).at(-1);
    assert(memory&&prepared.some(e=>e.kind==='ack'&&e.owner===owner&&e.id===memory.id&&!e.error),'Memory RPC acknowledged before audition becomes ready');
    const actual=(await audit(page)).meters.find(m=>m.kind==='rf'&&m.owner===owner);assert(actual.left.rms<1e-7&&actual.right.rms>.001,'Paused audition preserves native right-only Pan');
    assert.equal((await transport(page)).frame,frozenPatchFrame,'Audition never advances the song');
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await keyState(page,key.key,false);await silence(page,'rf');await page.keyboard.up(key.key);
    await page.locator('#synthSongPlayButton').click();await state(page,'paused');await auditionReady(page);await down(page,key.key);await keyState(page,key.key,true);await sounding(page,'rf');
    await seek(page,2.5);await keyState(page,key.key,false);await silence(page,'rf');await page.keyboard.up(key.key);await auditionReady(page);
    assert.equal(await canvasHash(page),initialCanvas,'Backward seek restores pre-patch source RAM');
    await seek(page,6.5);await auditionReady(page);assert.equal(await canvasHash(page),patchedCanvas,'Forward cached replay restores the patched RAM');
    await checkbox(page,'synthSongHighlightToggle',true);
    steps.push('Live Off freezes / Live On catches up; RAM patch visibility, selected-channel RAM-ACK audition, recorded speed/Pan and Resume/Seek cancellation');

    await page.locator('#synthSongChannelSelect').selectOption('pcm:7');await auditionReady(page);await silence(page);
    const ch8=await ui(page);assert.equal(ch8.volume,80);assert.equal(ch8.step,2048);assert.match(ch8.sample,/512 frames.*Start \$0400.*Loop \$0400/);
    await drain(page);await down(page,key.key);await keyState(page,key.key,true);await sounding(page,'rf');const ch8On=(await drain(page)).filter(e=>e.kind==='keyOn');assert(ch8On.length&&ch8On.every(e=>e.ch===7),'CH8 is auditioned on physical channel 7 only');
    await page.keyboard.up(key.key);await keyState(page,key.key,false);await silence(page);
    const ch8Release=await drain(page);assert(ch8Release.some(event=>event.kind==='releaseNote'&&event.ch===7),'Paused CH8 uses the same sample-clock software release as the editor');assert(!ch8Release.some(event=>event.kind==='keyOff'),'An ordinary audition release does not hard-cut the hardware voice');
    assert(!await page.locator('#synthSongCopyButton').isDisabled());await page.locator('#synthSongCopyButton').click();await ready(page);
    await until(page,async()=>(await transport(page)).target==='synth'&&/-PCM-CH8\.pcm\.json$/.test((await transport(page)).path),'PCM Copy saves a new editable instrument');
    const copied=await exportPcm(page),copyPath=(await transport(page)).path;
    assert.equal(copied.kind,'tetorica-rf5c164');assert.equal(copied.settings.volume,80);assert.equal(copied.settings.panLeft,0);assert.equal(copied.settings.panRight,15);
    assert.equal(copied.settings.rootNote,60);assert.equal(copied.settings.loopEnabled,true);assert.equal(copied.settings.loopStart,0);assert.equal(copied.settings.loopEnd,512);
    assert.equal(copied.sample.sampleRate,RF_CLOCK/384);assert.deepEqual(Buffer.from(copied.sample.data,'base64'),sample2);
    const afterCopy=await cassette(page);assert.deepEqual(JSON.parse(archiveBytes(afterCopy,copyPath).toString()),copied);
    for(const [p,bytes]of retained)assert.deepEqual(archiveBytes(afterCopy,p),bytes,'Copy keeps original bytes '+p);
    await chooseFile(page,pcmPath);assert.deepEqual(await exportPcm(page),originalPcm,'Opening original PCM restores its editor sound');
    await chooseFile(page,fmPath);assert.equal((await transport(page)).chip,'ym2612');assert.equal(await page.locator('#presetSelect').inputValue(),'vfs:'+fmPath);
    await chooseFile(page,psgPath);assert.equal((await transport(page)).chip,'psg');assert.equal(await page.locator('#synthPsgPresetSelect').inputValue(),'vfs:'+psgPath);
    await chooseFile(page,pcmPath);assert.deepEqual(await exportPcm(page),originalPcm);
    steps.push('CH8 physical audition and Copy preserve 512 source bytes/settings in self-contained PCM JSON; all source/editor/FM/PSG files remain intact');

    await page.locator('#synthSongStopButton').click();await state(page,'stopped');
    await page.locator('#synthSongSelect').selectOption('/vgm/PCM Unsafe.vgm');await page.locator('#synthSongChannelSelect').selectOption('pcm:0');await page.locator('#synthSongPlayButton').click();await state(page,'playing');
    await until(page,async()=>/incomplete|not prepared/i.test((await transport(page)).status),'Unknown source RAM is explained');await page.locator('#synthSongPlayButton').click();await state(page,'paused');
    assert(await page.locator('#synthSongCopyButton').isDisabled());assert.match((await ui(page)).sample,/Sample unavailable|waveform unavailable/);
    assert.match((await audit(page)).canvasLabels.join(' '),/incomplete/,'Unsafe capture clears the old sample instead of showing stale waveform');
    await drain(page);await down(page,key.key);await pause(70);await keyState(page,key.key,false);await page.keyboard.up(key.key);assert.equal((await drain(page)).filter(e=>e.kind==='keyOn').length,0);
    await page.locator('#synthSongStopButton').click();await state(page,'stopped');await page.locator('#synthSongChannelSelect').selectOption('synth');assert.deepEqual(await exportPcm(page),originalPcm);
    // A song without PCM must still let the user select PCM reference targets,
    // then restore the actual prior FM editor when Synth is chosen.
    await chooseFile(page,fmPath);await page.locator('#synthSongSelect').selectOption('/vgm/No PCM.vgm');await page.locator('#synthSongChannelSelect').selectOption('0');
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await chip(page,'pcm');assert.equal((await transport(page)).target,'pcm:0');
    assert.match((await transport(page)).status,/No Mega CD PCM/);await page.locator('#synthSongChannelSelect').selectOption('synth');
    await until(page,async()=>(await transport(page)).chip==='ym2612','Missing PCM view restores actual FM editor');assert.equal((await transport(page)).path,fmPath);
    await page.locator('#synthSongStopButton').click();await state(page,'stopped');await chooseFile(page,pcmPath);assert.deepEqual(await exportPcm(page),originalPcm);await silence(page);
    steps.push('Unknown / missing source RAM and absent PCM chip show explicit reasons, disable audition/Copy, clear stale wave and restore the prior editor');

    await page.locator('#synthSongSelect').selectOption('/vgm/PCM Timed.vgm');await page.locator('#synthSongChannelSelect').selectOption('pcm:7');await page.locator('#synthSongPlayButton').click();await state(page,'playing');
    await until(page,async()=>(await ui(page)).step===2048,'CH8 live layout ready');await page.locator('#synthSongPlayButton').click();await state(page,'paused');await auditionReady(page);
    const layouts=[];await fs.mkdir(config.screenshots,{recursive:true});for(const width of [1240,390]) {
      await page.setViewportSize({width,height:1100});await page.locator('#synthPcmSettings').scrollIntoViewIfNeeded();const box=await page.locator('#synthPcmSettings').boundingBox();
      assert(box&&box.x>=-1&&box.x+box.width<=width+1);assert(await evaluate(page,()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
      await page.screenshot({path:path.join(config.screenshots,`${name}-pcm-live-${width}.png`)});layouts.push({width,box});
    }
    await page.locator('#synthSongStopButton').click();await state(page,'stopped');await silence(page);
    const final=await audit(page);assert(final.meters.length&&final.meters.every(m=>m.muted&&m.left.finite&&m.right.finite));assert.deepEqual(errors,[]);
    const archive=await cassette(page);for(const [p,bytes]of retained)assert.deepEqual(archiveBytes(archive,p),bytes,'Final original bytes '+p);
    return {browser:name,steps,boundarySamples:{early,late},pausedFrame:frozenPatchFrame,sourceSha256:digest(timed),copyPath,copySampleSha256:digest(sample2),layouts,physicalOutputMuted:true,listeningPerformed:false};
  } catch(error) {
    console.error(JSON.stringify({browser:name,steps,transport:await transport(page).catch(()=>null),ui:await ui(page).catch(()=>null),audit:await audit(page).catch(()=>null),events:await drain(page).catch(()=>null),errors}));throw error;
  } finally {await bounded(page.close(),'close PCM Live page');}
}
(async()=>{
  ({loadPlaygroundCassette:loadCassette}=await import(pathToFileURL(path.join(repository,'docs/playground/playground_cassette.js')).href));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  try {for(const name of engines){const browser=await bounded(({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})}),'launch '+name);try{results.push(await run(browser,name,origin));console.log('PASS '+name+': PCM Live, audible-time RAM, Pause audition, Copy and editor preservation');}finally{await bounded(browser.close(),'close '+name);}}}
  finally {server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  assert.deepEqual(missing,[]);assert.deepEqual(external,[]);await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});
  await fs.writeFile(config.out,JSON.stringify({passed:true,physicalOutputMuted:true,listeningPerformed:false,results,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))},null,2)+'\n');
  console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
