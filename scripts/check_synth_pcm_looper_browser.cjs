// Public PCM Software Looper verification using self-authored instruments.
// All AudioNode -> destination edges are physically gain-zero before app code;
// native PCM is inspected as arrays only. Never run this as a listening test.
// node scripts/check_synth_pcm_looper_browser.cjs [--root=docs]
//   [--entry=/synth/index.html] [--engines=chromium,webkit]
//   [--out=/tmp/pcm-looper.json] [--screenshots=/tmp/pcm-looper]
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repository=path.resolve(__dirname,'..');
const config={root:path.join(repository,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'fm2612-pcm-looper-browser.json'),screenshots:path.join(tmpdir(),'fm2612-pcm-looper-browser')};
for(const argument of process.argv.slice(2)) {const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(argument);assert(match,'Unknown argument '+argument);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/'));
const engines=config.engines.split(',');assert(engines.every(name=>['chromium','webkit'].includes(name)));
const LOOP='tetorica-synth-pcm-looper',EVENT='tetorica-synth-pcm-recording';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function bounded(task,label,ms=30000){let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timeout '+label)),ms);})]);}finally{clearTimeout(timer);}}
const evaluate=(page,fn,arg)=>bounded(page.evaluate(fn,arg),'page evaluation');

function installAudit() {
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,Worklet=window.AudioWorkletNode,Channel=window.MessageChannel;
  const owners=[],ports=new WeakMap(),peers=new WeakMap(),meters=[],events=[];let serial=0,holdNextMemory=false,heldMemory=null,probeTimes=[];
  const describeUnit=(unit,sampleRate)=>{
    const {left,right}=unit;let l=0,r=0,lp=0,rp=0,signature=0;
    if(left instanceof Float32Array&&right instanceof Float32Array) {
      for(let i=0;i<left.length;i++){l+=left[i]*left[i];r+=right[i]*right[i];lp=Math.max(lp,Math.abs(left[i]));rp=Math.max(rp,Math.abs(right[i]));}
      for(let i=0;i<left.length;i+=Math.max(1,Math.floor(left.length/97)))signature+=left[i]*(i+1)+right[i]*(i+3);
    }
    const probes=probeTimes.map(time=>{const begin=Math.round(time*sampleRate),end=Math.min(left?.length??0,begin+Math.round(.025*sampleRate));let ls=0,rs=0;
      for(let index=begin;index<end;index++){ls+=left[index]*left[index];rs+=right[index]*right[index];}
      return{time,leftRms:Math.sqrt(ls/Math.max(1,end-begin)),rightRms:Math.sqrt(rs/Math.max(1,end-begin))};});
    return {id:unit.id,frames:left?.length,offsetSeconds:unit.offsetSeconds,frameCount:unit.frameCount,prefixCount:unit.prefixCount,
      leftRms:Math.sqrt(l/(left?.length||1)),rightRms:Math.sqrt(r/(right?.length||1)),leftPeak:lp,rightPeak:rp,signature,probes};
  };
  function accepted(owner,operation) {
    const a=operation.args;
    if(operation.method==='prepareLooperUnit')owner.tokens.set(a[0],operation.unit);
    else if(operation.method==='startLooper') {
      if(a[0]<owner.session)return;
      owner.session=a[0];owner.configuration={...a[1]};owner.running=true;owner.units.clear();
      for(const token of a[2]??[]) {const unit=owner.tokens.get(token);if(unit)owner.units.set(unit.id,{...unit,token});}
    } else if(operation.method==='addPreparedLooperUnit'&&owner.session===a[0]&&owner.running) {
      const unit=owner.tokens.get(a[1]);if(unit)owner.units.set(unit.id,{...unit,token:a[1]});
    } else if(operation.method==='removeLooperUnit'&&owner.session===a[0])owner.units.delete(a[1]);
  }
  function bind(port,owner) {
    ports.set(port,owner);port.addEventListener('message',({data})=>{
      if(data?.ready)owner.ready=true;
      if(data?.id!==undefined) {
        const operation=owner.pending.get(data.id);owner.pending.delete(data.id);
        events.push({kind:'ack',owner:owner.id,id:data.id,value:data.value,error:data.error??null,method:operation?.method});
        if(operation&&!data.error&&data.value!==false)accepted(owner,operation);
      }
    });port.start();
  }
  window.MessageChannel=new Proxy(Channel,{construct(Target,args,newTarget){
    const channel=Reflect.construct(Target,args,newTarget);peers.set(channel.port1,channel.port2);peers.set(channel.port2,channel.port1);return channel;
  }});
  window.AudioWorkletNode=new Proxy(Worklet,{construct(Target,args,newTarget){
    const node=Reflect.construct(Target,args,newTarget);
    if(['tetorica-synth-pcm-looper','tetorica-synth-pcm-recording','tetorica-synth-pcm'].includes(args[1])) {
      const owner={id:++serial,name:args[1],context:node.context,tokens:new Map(),units:new Map(),pending:new Map(),
        ready:false,running:false,session:0,configuration:null,starts:0,adds:0,removes:0,stops:0,eventPlays:0};
      owners.push(owner);bind(node.port,owner);node.__pcmLooperOwner=owner;
    }
    return node;
  }});
  function meter(source,kind,owner=null,destination=source.context.destination) {
    const split=source.context.createChannelSplitter(2),left=source.context.createAnalyser(),right=source.context.createAnalyser(),mute=source.context.createGain();
    left.fftSize=right.fftSize=4096;mute.gain.value=0;
    connect.call(source,split);connect.call(split,left,0);connect.call(split,right,1);connect.call(left,mute);connect.call(right,mute);connect.call(mute,destination);
    meters.push({kind,owner,left,right,mute});
  }
  AudioNode.prototype.connect=function(destination,...args) {
    if(destination===this.context.destination){meter(this,'output',null,destination);return destination;}
    const result=connect.call(this,destination,...args);
    if(this.__pcmLooperOwner&&!this.__pcmLooperMeter) {
      this.__pcmLooperMeter=true;const owner=this.__pcmLooperOwner;
      meter(this,owner.name==='tetorica-synth-pcm-looper'?'loop':owner.name==='tetorica-synth-pcm-recording'?'event':'editor',owner.id);
    }
    return result;
  };
  MessagePort.prototype.postMessage=function(message,...args) {
    const owner=ports.get(this);
    if(owner&&message?.port&&peers.has(message.port))bind(peers.get(message.port),owner);
    if(owner)for(const command of Array.isArray(message)?message:[message]) {
      const a=command?.args??[],method=command?.method;
      if(!method)continue;
      const operation={method,args:a.slice(0,3)};
      if(method==='prepareLooperUnit') {
        operation.unit=describeUnit(a[1]?.unit??{},owner.context.sampleRate);
        events.push({kind:'prepare',owner:owner.id,id:command.id,token:a[0],loopLength:a[1]?.loopLength,unit:operation.unit});
      } else if(method==='startLooper') {owner.starts++;events.push({kind:'start',owner:owner.id,id:command.id,session:a[0],configuration:a[1],tokens:a[2]??[]});}
      else if(method==='addPreparedLooperUnit'){owner.adds++;events.push({kind:'add',owner:owner.id,id:command.id,session:a[0],token:a[1]});}
      else if(method==='removeLooperUnit'){owner.removes++;events.push({kind:'remove',owner:owner.id,id:command.id,session:a[0],unitId:a[1]});}
      else if(method==='stopLooper') {
        owner.stops++;owner.session=Math.max(owner.session,a[0]??0);owner.running=false;owner.units.clear();
        events.push({kind:'stop',owner:owner.id,session:a[0]});
      } else if(method==='discardLooperUnit')owner.tokens.delete(a[0]);
      else if(method==='playRecording'){owner.eventPlays++;events.push({kind:'event-play',owner:owner.id});}
      else if(method==='writeRegister')events.push({kind:'register',owner:owner.id,r:a[0],v:a[1]});
      else if(['keyOn','keyOff','releaseNote','reset'].includes(method))events.push({kind:method,owner:owner.id,ch:a[0]});
      else if(method==='dispose'){owner.running=false;owner.units.clear();}
      if(command.id!==undefined)owner.pending.set(command.id,operation);
      else if(['startLooper','addPreparedLooperUnit','removeLooperUnit','prepareLooperUnit'].includes(method))accepted(owner,operation);
    }
    if(events.length>20000)events.splice(0,events.length-20000);
    if(owner?.name==='tetorica-synth-pcm'&&holdNextMemory&&message?.method==='loadMemory') {
      holdNextMemory=false;heldMemory=()=>post.call(this,message,...args);
      events.push({kind:'held-editor-memory',owner:owner.id,id:message.id});return;
    }
    return post.call(this,message,...args);
  };
  function sample(analyser) {
    const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);
    let sum=0,squares=0,peak=0;for(const value of values){sum+=value;squares+=value*value;peak=Math.max(peak,Math.abs(value));}
    const mean=sum/values.length,edges=[];
    for(let i=1;i<values.length;i++)if(values[i-1]<mean&&values[i]>=mean)edges.push(i-1+(mean-values[i-1])/(values[i]-values[i-1]));
    return {rms:Math.sqrt(Math.max(0,squares/values.length-mean*mean)),peak,
      frequency:edges.length>4?analyser.context.sampleRate*(edges.length-1)/(edges.at(-1)-edges[0]):0,finite:values.every(Number.isFinite)};
  }
  window.__pcmLooperAudit={
    setSampleProbeTimes(times){probeTimes=times.slice();},
    holdMemory(){if(heldMemory)throw Error('Editor memory is already held');holdNextMemory=true;},
    hasHeldMemory:()=>Boolean(heldMemory),
    releaseMemory(){const release=heldMemory;heldMemory=null;holdNextMemory=false;release?.();},
    drain:()=>events.splice(0),read:()=>({
    owners:owners.map(({context,tokens,units,pending,...owner})=>({...owner,units:[...units.values()],tokens:[...tokens.values()],
      phase:owner.configuration?((context.currentTime-owner.configuration.startTime)%owner.configuration.loopLength+owner.configuration.loopLength)%owner.configuration.loopLength:null,
      time:context.currentTime})),
    meters:meters.map(({kind,owner,left,right,mute})=>({kind,owner,left:sample(left),right:sample(right),muted:mute.gain.value===0})),
  })};
}
const audit=page=>evaluate(page,()=>__pcmLooperAudit.read()),drain=page=>evaluate(page,()=>__pcmLooperAudit.drain());
const ui=page=>evaluate(page,()=>({
  chip:document.querySelector('[data-synth-chip][aria-selected="true"]')?.dataset.synthChip,
  loop:document.getElementById('looperState').textContent,loopStart:document.getElementById('looperStartButton').textContent,
  record:document.getElementById('looperRecordButton').textContent,recordHidden:document.getElementById('looperRecordButton').hidden,
  loopBlocked:document.getElementById('looperStartButton').disabled,recordBlocked:document.getElementById('looperRecordButton').disabled,
  undoBlocked:document.getElementById('looperStopButton').disabled,clearBlocked:document.getElementById('looperClearButton').disabled,
  event:document.getElementById('eventRecordState').textContent,eventPlay:document.getElementById('eventRecordPlayButton').textContent,
  eventMode:!document.getElementById('eventRecordStopButton').hidden,
  active:document.querySelectorAll('#keyboard .key.is-active').length,status:document.getElementById('status').textContent,
  song:document.getElementById('synthSongStatus').dataset.state,songFrame:Number(document.getElementById('synthSongPlayer').dataset.consumedFrames),target:document.getElementById('synthSongChannelSelect').value,
}));
async function until(page,test,label,ms=25000) {
  const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await pause(30);}
  throw Error(label+'; '+JSON.stringify({ui:await ui(page).catch(()=>null),audit:await audit(page).catch(()=>null)}));
}
const ready=page=>page.waitForFunction(()=>!document.getElementById('importPresetButton').disabled&&document.querySelector('.synth-editor').getAttribute('aria-busy')!=='true');
async function pcmReady(page){await until(page,()=>evaluate(page,()=>!document.getElementById('keyboard').classList.contains('is-loading')&&document.getElementById('keyboard').getAttribute('aria-disabled')!=='true'),'PCM bank ready');}
async function chip(page,value){await page.locator('[data-synth-chip="'+value+'"]').click();await until(page,async()=>(await ui(page)).chip===value,'Chip '+value);await ready(page);}
async function down(page,key){await evaluate(page,()=>document.activeElement?.blur?.());await page.keyboard.down(key);}
async function up(page,key){await page.keyboard.up(key);}
async function keyState(page,key,active){await until(page,()=>evaluate(page,({key,active})=>document.querySelector('#keyboard .key[data-key="'+key+'"]').classList.contains('is-active')===active,{key,active}),'Keyboard '+key+' '+active);}
async function keyFor(page,note=60) {
  return evaluate(page,note=>{
    let best=null;const expected=440*2**((note-69)/12);
    for(const node of document.querySelectorAll('#keyboard .key[data-key]')) {
      if(!/^[a-z0-9]$/i.test(node.dataset.key))continue;
      const match=/b(\d+)\s*\/\s*f(\d+)/.exec(node.querySelector('small')?.textContent??'');if(!match)continue;
      const hz=Number(match[2])*7670454*2**(Number(match[1])-1)/(144*2**20),distance=Math.abs(Math.log2(hz/expected));
      if(!best||distance<best.distance)best={key:node.dataset.key,hz,distance};
    }
    if(!best||best.distance>.02)throw Error('Keyboard note unavailable '+note);return best;
  },note);
}
async function field(page,name,value) {
  const id='#synthPcm'+name,node=page.locator(id),before=Number(await node.textContent()),field=name[0].toLowerCase()+name.slice(1);
  if(before===value)return;
  const span={Volume:255,PanLeft:15,PanRight:15,RootNote:127,LoopStart:65502,LoopEnd:65502}[name];
  await node.scrollIntoViewIfNeeded();const box=await node.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+(value-before)/span*160,box.y+box.height/2,{steps:3});await page.mouse.up();
  // A subpixel RAM-wide drag can round to zero in WebKit. Use bounded real
  // +/- corrections, while retaining the exact final-value assertion.
  for(let i=0;i<512;i++){const current=Number(await node.textContent());if(current===value)return;await page.locator('[data-pcm-field="'+field+'"][data-pcm-step="'+(value>current?1:-1)+'"]').click();}
  assert.equal(Number(await node.textContent()),value);
}
async function builtin(page,name){await page.locator('[data-pcm-builtin="'+name+'"]').click();await pcmReady(page);}
async function range(page,selector,value){await page.locator(selector).first().evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function menu(page){if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();}
async function download(page,id){await menu(page);const pending=page.waitForEvent('download');await page.locator(id).click();const item=await pending,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return{bytes:Buffer.concat(chunks),name:item.suggestedFilename()};}
const exportPcm=async page=>JSON.parse((await download(page,'#exportPcmButton')).bytes.toString());
const exportEvent=async page=>JSON.parse((await download(page,'#eventRecordExportButton')).bytes.toString());
async function importEvent(page,recording,name='PCM Looper backing.json') {
  await page.locator('#eventRecordImportInput').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recording))});
  await until(page,async()=>(await ui(page)).status.includes('Imported event recording: '+name),'Import event take');
}
async function prime(page){await page.keyboard.press('a');await pcmReady(page);await until(page,async()=>(await ui(page)).status.includes('Audio ready'),'Audio primed');await page.keyboard.up('a');}
const running=state=>state.loopStart.includes('Stop');
const recording=state=>state.record.includes('Stop')&&!state.recordHidden;
async function startLoop(page){if(!running(await ui(page)))await page.locator('#looperStartButton').click();await until(page,async()=>running(await ui(page))&&!((await ui(page)).loop.includes('Preparing')),'Looper running');}
async function stopLoop(page){if(running(await ui(page)))await page.locator('#looperStartButton').click();await until(page,async()=>!running(await ui(page)),'Looper stopped');}
async function beginLayer(page){await page.locator('#looperRecordButton').click();await until(page,async()=>recording(await ui(page)),'Layer recording');}
async function finishLayer(page){if(recording(await ui(page)))await page.locator('#looperRecordButton').click();await until(page,async()=>!recording(await ui(page))&&!(await ui(page)).loop.includes('Preparing'),'Layer finalization');}
async function clearLoop(page){await page.locator('#looperClearButton').click();await until(page,async()=>!(await ui(page)).loop.includes('Preparing')&&(await ui(page)).clearBlocked,'Loop cleared');}
async function owner(page){return(await audit(page)).owners.filter(o=>o.name===LOOP).at(-1);}
async function count(page,n){await until(page,async()=>{const o=await owner(page);return o?.running&&o.units.length===n&&(await ui(page)).loop.includes('Loop('+n+')');},'Looper has '+n+' independent layers');}
async function phase(page,min=.18,max=.32){await until(page,async()=>{const o=await owner(page);return o?.running&&o.phase>min*o.configuration.loopLength&&o.phase<max*o.configuration.loopLength;},'Nonzero loop phase');}
async function silence(page,kind='output'){await pause(250);await until(page,async()=>(await audit(page)).meters.filter(m=>m.kind===kind).every(m=>m.left.rms<1e-7&&m.right.rms<1e-7),'Silence '+kind);}
async function collect(page,seconds=1,kind='loop') {
  const end=Date.now()+seconds*1000,rows=[];
  while(Date.now()<end){const a=await audit(page);const meters=a.meters.filter(m=>m.kind===kind);if(meters.length)rows.push(meters.sort((a,b)=>b.left.rms+b.right.rms-a.left.rms-a.right.rms)[0]);await pause(25);}
  assert(rows.length>2,'Meter produced numeric samples');return rows;
}
const loudest=(rows,side)=>rows.reduce((best,row)=>!best||row[side].rms>best[side].rms?row:best,null);
const near=(actual,expected,tolerance,label)=>assert(Math.abs(actual/expected-1)<tolerance,label+': '+actual+' vs '+expected);
const signal=side=>assert(side.rms>.001&&side.frequency>20&&side.finite,'Expected finite AC PCM');
let defaultPreset,systemGain;
function eventTake() {return{format:'tetorica-rf5c164-recording-v1',version:1,durationSeconds:.7,initialState:{preset:structuredClone(defaultPreset),pitchClock:7670454},commands:[{time:0,type:'noteOn',channel:0,block:4,fnum:644},{time:.6,type:'noteOff',channel:0}]};}
function authoredReference() {
  const commands=[0x52,0xb0,7,0x52,0xb4,0,0x52,0xa4,0x22,0x52,0xa0,0x44];for(let i=0;i<12;i++)commands.push(0x61,0x44,0xac);commands.push(0x66);
  const bytes=Buffer.alloc(256+commands.length),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);bytes.write('Vgm ');
  view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);view.setUint32(0x34,204,true);view.setUint32(0x18,12*44100,true);view.setUint32(0x2c,7670454,true);bytes.set(commands,256);return bytes;
}
const served=new Map(),missing=[],external=[];
let resourceGate=null;
function holdResource(suffix){assert.equal(resourceGate,null);let release;const gate={suffix,seen:false,promise:new Promise(resolve=>{release=resolve;})};gate.release=()=>release();resourceGate=gate;return gate;}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const gate=resourceGate;if(pathname.endsWith('/synth_pcm_loop_worklet.js')||pathname.endsWith('/generated/rf5c164_wasm.wasm'))res.setHeader('Cache-Control','no-store');
  if(gate&&pathname.endsWith(gate.suffix)){gate.seen=true;await gate.promise;if(res.destroyed||res.writableEnded)return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),name=path.relative(config.root,filename).split(path.sep).join('/'),meta={bytes:bytes.length,sha256:digest(bytes)};
  if(served.has(name))assert.deepEqual(served.get(name),meta,'Asset changed during test');served.set(name,meta);
  res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){if(res.destroyed)return;missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
async function open(browser,origin) {
  const page=await browser.newPage({viewport:{width:1240,height:1100},serviceWorkers:'block',acceptDownloads:true}),errors=[];page.setDefaultTimeout(25000);
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installAudit);await page.goto(origin+config.entry);await ready(page);return{page,errors};
}

async function shortOtherLoop(page,kind) {
  await chip(page,kind);
  if(kind==='ym2612'){await page.locator('#presetSelect').selectOption('sine');await ready(page);}
  await startLoop(page);await beginLayer(page);await down(page,'a');await keyState(page,'a',true);await pause(280);
  await finishLayer(page);await up(page,'a');
  await until(page,async()=>(await ui(page)).loop.includes('Loop(1)'),'Independent '+kind+' layer');
  await stopLoop(page);await silence(page);
}
async function run(browser,name,origin) {
  const {page,errors}=await open(browser,origin),steps=[],result={browser:name,steps};
  try {
    await chip(page,'pcm');await prime(page);
    assert(!await page.locator('#looperStartButton').isDisabled());
    assert.match(await page.locator('#synthPcmHelp').textContent(),/software.*looper/i);
    await importEvent(page,eventTake());const retainedEvent=await exportEvent(page);
    await builtin(page,'sine');await field(page,'Volume',64);await field(page,'PanLeft',15);await field(page,'PanRight',0);await field(page,'RootNote',60);
    const initial=await exportPcm(page),lowKey=await keyFor(page,48),highKey=await keyFor(page,60);
    await startLoop(page);await beginLayer(page);await pause(90);await finishLayer(page);
    assert(!(await ui(page)).loop.includes('Loop('),'An empty take does not choose a period');
    assert.equal((await owner(page))?.units.length??0,0);assert.equal((await owner(page))?.starts??0,0);
    await silence(page);assert.deepEqual(await exportEvent(page),retainedEvent,'Empty Looper capture keeps Event Rec take');
    steps.push('Existing Looper controls mark software layering and an empty first capture remains silent');

    await beginLayer(page);await down(page,lowKey.key);await keyState(page,lowKey.key,true);await pause(1550);
    await finishLayer(page);await keyState(page,lowKey.key,false);await up(page,lowKey.key);await count(page,1);
    const firstOwner=await owner(page),period=firstOwner.configuration.loopLength;
    assert(period>1.3&&period<6,'First performed interval chooses a bounded loop period');
    const firstRows=await collect(page,period*1.2+.25),first=loudest(firstRows,'left');
    signal(first.left);assert(firstRows.every(row=>row.right.rms<1e-7),'First layer preserves left-only Pan');
    near(first.left.frequency,lowKey.hz,.07,'First sample is pitched at the performed key');
    const firstUnit=firstOwner.units[0];assert(firstUnit.leftRms>.001&&firstUnit.rightRms===0);
    assert.deepEqual(await exportPcm(page),initial,'Rendering does not edit the current PCM instrument');

    await builtin(page,'triangle');await field(page,'PanLeft',0);await field(page,'PanRight',15);
    await phase(page);await beginLayer(page);await down(page,highKey.key);await keyState(page,highKey.key,true);
    await until(page,async()=>!recording(await ui(page))&&!(await ui(page)).loop.includes('Preparing'),'Overdub automatically closes at the loop boundary',15000);
    await keyState(page,highKey.key,false);await up(page,highKey.key);await count(page,2);
    const secondOwner=await owner(page),secondUnit=secondOwner.units.find(unit=>unit.id!==firstUnit.id);
    assert(secondUnit&&secondUnit.offsetSeconds>.02&&secondUnit.offsetSeconds<period,'Second layer retains a nonzero start phase');
    assert(secondUnit.rightRms>.001&&secondUnit.leftRms===0);
    const twoRows=await collect(page,period*2+.25),left=loudest(twoRows,'left'),right=loudest(twoRows,'right');
    signal(left.left);signal(right.right);assert(twoRows.some(row=>row.left.rms>.001&&row.right.rms>.001),'Two differently panned layers really play together');
    near(left.left.rms,first.left.rms,.15,'Adding a layer retains the first layer amplitude');
    near(left.left.frequency,first.left.frequency,.07,'Changing to Triangle does not replace the existing Sine layer');
    near(right.right.frequency/highKey.hz,1,.07,'Second layer retains its distinct octave');
    result.layers={period,first:firstUnit,second:secondUnit,left:left.left,right:right.right};
    steps.push('Held-note first capture chooses the period; a later-phase Triangle octave overdub auto-stops while the original Sine layer keeps playing');

    await builtin(page,'square');await field(page,'Volume',73);await field(page,'PanLeft',7);await field(page,'PanRight',7);await field(page,'LoopStart',8);await field(page,'LoopEnd',150);await pcmReady(page);
    const edited=await exportPcm(page),afterEdit=await collect(page,period*1.2+.25);
    near(loudest(afterEdit,'left').left.rms,first.left.rms,.15,'Later PCM editing does not rewrite the first layer');
    near(loudest(afterEdit,'right').right.frequency,right.right.frequency,.07,'Later sample / End edits do not rewrite the second layer');
    assert.deepEqual(await exportEvent(page),retainedEvent,'Looper never overwrites the separate Event Rec take');
    await stopLoop(page);await silence(page);assert.deepEqual(await exportPcm(page),edited);
    const ids=[firstUnit.id,secondUnit.id].sort();await startLoop(page);await count(page,2);
    assert.deepEqual((await owner(page)).units.map(unit=>unit.id).sort(),ids,'Stop / Resume retains the original layer identities');
    const resumed=await collect(page,period*1.2+.25);
    near(loudest(resumed,'left').left.rms,first.left.rms,.15,'Resume does not duplicate the first layer');
    near(loudest(resumed,'right').right.rms,right.right.rms,.15,'Resume does not duplicate the second layer');
    steps.push('Each layer keeps its captured sample/settings through later editing and Stop / Resume restores exactly two layers');

    // Delay the next editing-bank command before it reaches the native editor.
    // Backing playback must stop without waiting for that unrelated RAM ACK.
    await evaluate(page,()=>__pcmLooperAudit.holdMemory());
    let stopLatencyMs;
    try {
      await page.locator('[data-pcm-builtin="saw"]').click();
      await until(page,()=>evaluate(page,()=>__pcmLooperAudit.hasHeldMemory()),'Editing RAM transfer is held');
      assert(await page.locator('#keyboard').evaluate(node=>node.classList.contains('is-loading')),'Held editor bank disables only the editing keyboard');
      const stoppedAt=Date.now();await page.locator('#looperStartButton').click();
      await until(page,async()=>!running(await ui(page))&&!((await owner(page))?.running),'Backing Stop bypasses pending editor RAM',1500);
      stopLatencyMs=Date.now()-stoppedAt;await silence(page,'loop');
      assert(await evaluate(page,()=>__pcmLooperAudit.hasHeldMemory()),'Stop completed before the editor transfer was released');
    } finally {await evaluate(page,()=>__pcmLooperAudit.releaseMemory());}
    await pcmReady(page);await pause(100);assert(!running(await ui(page))&&!((await owner(page))?.running),'Late editor RAM ACK does not restart the stopped backing');
    await builtin(page,'square');await field(page,'Volume',73);await field(page,'PanLeft',7);await field(page,'PanRight',7);await field(page,'LoopStart',8);await field(page,'LoopEnd',150);await pcmReady(page);
    assert.deepEqual(await exportPcm(page),edited);await startLoop(page);await count(page,2);
    assert.deepEqual((await owner(page)).units.map(unit=>unit.id).sort(),ids);
    result.pendingEditorStop={stopLatencyMs,stoppedBeforeMemoryRelease:true,resumedLayerCount:2};
    steps.push('Backing Stop bypasses a held editor RAM transfer; its late ACK cannot resurrect playback and both layers remain resumable');

    const measured=await evaluate(page,async()=>{
      const end=performance.now()+900,rows=[];
      while(performance.now()<end) {const a=__pcmLooperAudit.read(),raw=a.meters.filter(m=>m.kind==='loop').at(-1),out=a.meters.filter(m=>m.kind==='output').sort((a,b)=>b.left.rms+b.right.rms-a.left.rms-a.right.rms)[0];
        if(raw?.left.rms>.01&&out?.left.rms>.001)rows.push({raw:raw.left.rms,out:out.left.rms,ratio:out.left.rms/raw.left.rms});
        await new Promise(resolve=>setTimeout(resolve,25));}
      return rows;
    });
    assert(measured.length>3);const ratios=measured.map(row=>row.ratio).sort((a,b)=>a-b),ratio=ratios[ratios.length>>1];
    assert(Math.abs(ratio-systemGain)<.025,'System PCM calibration is applied once to all layers');
    const out100=loudest(await collect(page,period+.2,'output'),'left').left.rms;
    await range(page,'#masterVolumeRange',200);await pause(150);const out200=loudest(await collect(page,period+.2,'output'),'left').left.rms;
    near(out200/out100,2,.15,'Master 200% doubles layer output');await range(page,'#masterVolumeRange',0);await silence(page);
    signal(loudest(await collect(page,.25),'left').left);await range(page,'#masterVolumeRange',100);
    result.gain={ratio,systemGain,out100,out200};
    await page.locator('#looperStopButton').click();await count(page,1);
    // The ACK changes the mixer immediately, while an AnalyserNode still holds
    // its preceding FFT window. Flush that history before testing a full cycle.
    await pause(250);const undone=await collect(page,period*1.4+.25);
    assert(undone.every(row=>row.right.rms<1e-7),'Undo removes only the latest right-panned layer');signal(loudest(undone,'left').left);
    assert.equal((await owner(page)).units[0].id,firstUnit.id);assert.deepEqual(await exportPcm(page),edited);
    await clearLoop(page);await silence(page);assert.equal((await owner(page)).units.length,0);assert.deepEqual(await exportEvent(page),retainedEvent);
    steps.push('System correction × Master is applied once; Master mute retains the raw loop, Undo removes only the latest layer, and Clear removes all audio');

    // Record a layer whose sound changes inside the take. The uploaded stereo
    // packet should retain both sides rather than using the final editor only.
    await builtin(page,'sine');await field(page,'PanLeft',15);await field(page,'PanRight',0);await startLoop(page);await beginLayer(page);
    const capturedFrom=(await owner(page)).time;
    await down(page,lowKey.key);await keyState(page,lowKey.key,true);await pause(200);await drain(page);
    await field(page,'LoopEnd',180);await pcmReady(page);await keyState(page,lowKey.key,true);
    await field(page,'LoopEnd',240);await pcmReady(page);await keyState(page,lowKey.key,true);await field(page,'LoopStart',16);await keyState(page,lowKey.key,true);
    const continuousWrites=await drain(page);assert(!continuousWrites.some(event=>['keyOn','keyOff','releaseNote','reset'].includes(event.kind)||event.kind==='register'&&(event.r===8||event.r===6)),'Looper End / Start edits preserve the held live voice without release or retrigger');
    const probeTime=(await owner(page)).time-capturedFrom+.15;await evaluate(page,time=>__pcmLooperAudit.setSampleProbeTimes([time]),probeTime);
    await pause(450);await up(page,lowKey.key);
    await builtin(page,'triangle');await field(page,'PanLeft',0);await field(page,'PanRight',15);await field(page,'LoopEnd',180);await pcmReady(page);
    await down(page,highKey.key);await keyState(page,highKey.key,true);await pause(200);await finishLayer(page);await up(page,highKey.key);await count(page,1);
    const changing=(await owner(page)).units[0];assert(changing.leftRms>.001&&changing.rightRms>.001,'A layer preserves sample/Pan/End changes recorded inside it');assert(changing.probes.length===1&&changing.probes[0].leftRms>.001,'Offline Looper PCM sustains the originally held note after End shrink / growth and Start edits');await evaluate(page,()=>__pcmLooperAudit.setSampleProbeTimes([]));
    const changingRows=await collect(page,(await owner(page)).configuration.loopLength*1.6+.25);
    assert(changingRows.some(row=>row.left.rms>.001));assert(changingRows.some(row=>row.right.rms>.001));
    await stopLoop(page);await silence(page);await clearLoop(page);
    steps.push('A single rendered layer sustains held notes through End shrink / growth, retains source / Pan / Start changes and the final key closure');

    // A live marker edit may wait for its RAM acknowledgement, but an already
    // held input still owns a playable voice and must be able to release it.
    await builtin(page,'sine');await down(page,lowKey.key);await keyState(page,lowKey.key,true);
    await until(page,async()=>(await audit(page)).meters.some(m=>m.kind==='editor'&&(m.left.rms>.001||m.right.rms>.001)),'Held editor PCM sounds before the gated End edit');await drain(page);
    const endBefore=Number(await page.locator('#synthPcmLoopEnd').textContent());
    await evaluate(page,()=>__pcmLooperAudit.holdMemory());
    let pendingEndRelease;
    try {
      await page.locator('[data-pcm-field="loopEnd"][data-pcm-step="-1"]').click();
      assert.equal(Number(await page.locator('#synthPcmLoopEnd').textContent()),endBefore-1,'One End decrement queues exactly one RAM edit');
      await until(page,()=>evaluate(page,()=>__pcmLooperAudit.hasHeldMemory()),'Loop End RAM acknowledgement is pending');
      assert(await page.locator('#keyboard').evaluate(node=>node.classList.contains('is-loading')),'The edited bank is awaiting its RAM ACK');
      await up(page,lowKey.key);await keyState(page,lowKey.key,false);
      pendingEndRelease=await drain(page);assert(pendingEndRelease.some(event=>event.kind==='releaseNote'),'Key-up reaches the existing PCM voice while End RAM is pending');
      await silence(page,'editor');await silence(page);
      assert(await evaluate(page,()=>__pcmLooperAudit.hasHeldMemory()),'The native voice becomes silent before the delayed RAM command is released');
    } finally {await evaluate(page,()=>__pcmLooperAudit.releaseMemory());await up(page,lowKey.key);}
    await pcmReady(page);await pause(100);await keyState(page,lowKey.key,false);await silence(page,'editor');await silence(page);
    assert(!running(await ui(page))&&!((await owner(page))?.running),'A late End RAM ACK cannot restart stopped playback');
    result.pendingEndRelease={endBefore,endAfter:endBefore-1,releasedBeforeMemoryAck:true,commands:pendingEndRelease};
    steps.push('Key-up releases a held native voice while a single End RAM edit is awaiting ACK; the late ACK cannot revive the input or its sound');

    // Rebuild two simple independent layers for exclusion and cross-chip state.
    await builtin(page,'sine');await field(page,'PanLeft',15);await field(page,'PanRight',0);await startLoop(page);await beginLayer(page);
    await down(page,lowKey.key);await keyState(page,lowKey.key,true);await pause(850);await finishLayer(page);await up(page,lowKey.key);await count(page,1);
    await field(page,'PanLeft',0);await field(page,'PanRight',15);await phase(page);await beginLayer(page);await down(page,highKey.key);await keyState(page,highKey.key,true);
    await until(page,async()=>!recording(await ui(page))&&!(await ui(page)).loop.includes('Preparing'),'Second retained layer finishes');await up(page,highKey.key);await count(page,2);
    const retainedIds=(await owner(page)).units.map(unit=>unit.id).sort(),retainedPcm=await exportPcm(page);
    await page.locator('#eventRecordPlayButton').click();await until(page,async()=>(await ui(page)).eventPlay.includes('Stop'),'Event Rec playback starts');
    await until(page,async()=>!running(await ui(page)),'Event Rec stops Looper playback');await silence(page,'loop');
    await startLoop(page);await count(page,2);assert(!(await ui(page)).eventPlay.includes('Stop'),'Looper Start stops Event Rec playback');
    assert.deepEqual(await exportEvent(page),retainedEvent);assert.deepEqual(await exportPcm(page),retainedPcm);
    await stopLoop(page);await shortOtherLoop(page,'ym2612');await shortOtherLoop(page,'psg');
    await chip(page,'pcm');await startLoop(page);await count(page,2);assert.deepEqual((await owner(page)).units.map(unit=>unit.id).sort(),retainedIds);
    await stopLoop(page);await chip(page,'ym2612');await startLoop(page);await until(page,async()=>(await ui(page)).loop.includes('Loop(1)'),'FM retains its own layer');await stopLoop(page);
    await chip(page,'psg');await startLoop(page);await until(page,async()=>(await ui(page)).loop.includes('Loop(1)'),'PSG retains its own layer');await stopLoop(page);
    await chip(page,'pcm');assert.deepEqual(await exportEvent(page),retainedEvent);assert.deepEqual(await exportPcm(page),retainedPcm);await startLoop(page);await count(page,2);
    steps.push('Event Rec and Looper stop one another while retaining their data; FM, PSG and PCM resume independent layer collections');

    const vgm=authoredReference();await page.locator('#tfiFile').setInputFiles({name:'PCM Looper reference.vgm',mimeType:'application/octet-stream',buffer:vgm});await ready(page);
    await page.locator('#synthSongChannelSelect').selectOption('synth');await page.locator('#synthSongPlayButton').click();
    await until(page,async()=>(await ui(page)).song==='playing','Reference VGM starts');assert((await ui(page)).loopBlocked);assert(!running(await ui(page)));await silence(page,'loop');
    await page.locator('#synthSongChannelSelect').selectOption('pcm:0');assert((await ui(page)).loopBlocked);
    await page.locator('#synthSongPlayButton').click();await until(page,async()=>(await ui(page)).song==='paused','Reference pauses');assert((await ui(page)).loopBlocked);
    await page.locator('#synthSongSeek').evaluate(node=>{node.value='2.5';node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));});
    await until(page,async()=>{const state=await ui(page);return state.song==='paused'&&Math.abs(state.songFrame-2.5*53267)<500;},'Reference seek finishes');
    assert((await ui(page)).loopBlocked);await page.locator('#synthSongStopButton').click();await page.locator('#synthSongChannelSelect').selectOption('synth');await chip(page,'pcm');
    await startLoop(page);await count(page,2);assert.deepEqual((await owner(page)).units.map(unit=>unit.id).sort(),retainedIds);await stopLoop(page);await silence(page);
    assert.deepEqual(await exportPcm(page),retainedPcm);assert.deepEqual(await exportEvent(page),retainedEvent);
    steps.push('VGM Play / Live / Pause CH / Seek stop layers and exclude capture, then Synth resumes the retained PCM layers');

    const layouts=[];await fs.mkdir(config.screenshots,{recursive:true});
    for(const width of [1240,390]) {
      await page.setViewportSize({width,height:1100});await page.locator('#looperState').scrollIntoViewIfNeeded();
      assert(await evaluate(page,()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal page overflow');
      const box=await page.locator('#looperState').boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width+1);
      await page.screenshot({path:path.join(config.screenshots,name+'-pcm-looper-'+width+'.png')});layouts.push({width,box});
    }
    const final=await audit(page);assert(final.meters.length&&final.meters.every(m=>m.muted&&m.left.finite&&m.right.finite));assert.deepEqual(errors,[]);
    return {...result,layouts,physicalOutputMuted:true,listeningPerformed:false};
  } catch(error) {
    console.error(JSON.stringify({browser:name,steps,ui:await ui(page).catch(()=>null),audit:await audit(page).catch(()=>null),events:(await drain(page).catch(()=>[])).slice(-40),errors}));throw error;
  } finally {await bounded(page.close(),'close PCM Looper page');}
}

async function canceledPreparation(browser,name,origin,action='chip') {
  const gate=holdResource('/synth_pcm_loop_worklet.js');let page,errors;
  try {
    ({page,errors}=await open(browser,origin));await chip(page,'pcm');await prime(page);
    await page.locator('#looperStartButton').click();await until(page,async()=>gate.seen,'Looper Worklet HTTP response held');
    if(action==='event') {await page.locator('#eventRecordStartButton').click();await until(page,async()=>(await ui(page)).eventMode,'Event Rec intent cancels pending Looper');}
    else await chip(page,'psg');
    gate.release();if(resourceGate===gate)resourceGate=null;
    await until(page,async()=>(await audit(page)).owners.some(owner=>owner.name===LOOP&&owner.ready),'Late canceled loop endpoint reaches ready');
    await pause(150);await silence(page);const events=await drain(page);
    assert(!events.some(event=>['start','add','prepare'].includes(event.kind)),'Canceled preparation does not upload or start old layers');
    if(action==='event')assert((await ui(page)).eventMode&&!running(await ui(page)),'Old Looper preparation cannot override newer Event Rec mode');
    assert.deepEqual(errors,[]);assert((await audit(page)).meters.every(m=>m.muted));
    return{browser:name,action,workletPreparationCanceled:true,physicalOutputMuted:true};
  } finally {gate.release();if(resourceGate===gate)resourceGate=null;if(page)await bounded(page.close(),'close canceled preparation page');}
}
async function canceledRender(browser,name,origin) {
  let gate,page,errors;
  try {
    ({page,errors}=await open(browser,origin));await chip(page,'pcm');await prime(page);await startLoop(page);await beginLayer(page);
    await down(page,'a');await keyState(page,'a',true);await pause(140);
    gate=holdResource('/generated/rf5c164_wasm.wasm');await page.locator('#looperRecordButton').click();
    await until(page,async()=>gate.seen,'Offline render WASM HTTP response held');await up(page,'a');
    await page.locator('#looperClearButton').click();gate.release();if(resourceGate===gate)resourceGate=null;
    await until(page,async()=>(await ui(page)).clearBlocked&&!running(await ui(page)),'Clear cancels pending layer render');
    await pause(200);await silence(page);const events=await drain(page);
    assert(!events.some(event=>['start','add','prepare'].includes(event.kind)),'Canceled offline render cannot later add a layer');
    assert.deepEqual(errors,[]);assert((await audit(page)).meters.every(m=>m.muted));
    return{browser:name,offlineRenderCanceled:true,physicalOutputMuted:true};
  } finally {gate?.release();if(resourceGate===gate)resourceGate=null;if(page)await bounded(page.close(),'close canceled render page');}
}
async function resourceLimits(browser,name,origin) {
  const {page,errors}=await open(browser,origin);
  try {
    await chip(page,'pcm');
    const limits=await evaluate(page,async()=>{
      const {createSynthPcmLoopAudio}=await import(new URL('./synth_pcm_loop_audio.js?v=pcm-looper-1',location.href).href);
      const context=new AudioContext(),output=context.createGain();output.connect(context.destination);await context.resume();
      const endpoint=createSynthPcmLoopAudio(),tokens=[],originals=[];let extra=null;
      try {
        const api=await endpoint.prepare(context,output),loopLength=.05;
        for(let i=0;i<16;i++) {
          const left=new Float32Array(64).fill(.01),right=new Float32Array(64).fill(-.005);originals.push(left,right);
          tokens.push(await api.prepareLooperUnit({id:'limit-'+i,left,right,offsetSeconds:0},{loopLength}));
        }
        endpoint.setEnabled(true);const session=await api.startLooper({loopLength,startTime:context.currentTime+.03},{units:tokens});
        const before=__pcmLooperAudit.read().owners.filter(o=>o.name==='tetorica-synth-pcm-looper').at(-1).units.length;
        let rejected=false,reason='';try {
          extra=await api.prepareLooperUnit({id:'limit-extra',left:new Float32Array(64),right:new Float32Array(64),offsetSeconds:0},{loopLength});
          await api.addPreparedLooperUnit(session,extra);
        } catch(error){rejected=true;reason=error.message;}
        if(!rejected)throw Error('A seventeenth PCM loop layer was accepted');
        for(const invalid of [
          ()=>api.startLooper({loopLength:121,startTime:context.currentTime},{units:tokens}),
          ()=>api.prepareLooperUnit({id:'bad',left:Float32Array.of(NaN),right:Float32Array.of(0),offsetSeconds:0},{loopLength}),
        ]) {let failed=false;try{await invalid();}catch{failed=true;}if(!failed)throw Error('Invalid loop resource accepted');}
        const after=__pcmLooperAudit.read().owners.filter(o=>o.name==='tetorica-synth-pcm-looper').at(-1).units.length;
        if(before!==16||after!==16)throw Error('Failed resource requests changed active layers');
        if(originals.some(array=>array.length!==64||Math.abs(array[0])<.001))throw Error('Preparing layers detached or changed controller PCM');
        api.stopLooperPlayback();endpoint.dispose();if(context.state==='closed')throw Error('Endpoint closed borrowed context');
        return{before,after,seventeenthRejected:rejected,reason,borrowedContextKeptOpen:true,originalBuffersRetained:true};
      } finally {endpoint.dispose();output.disconnect();await context.close();}
    });
    assert.deepEqual(errors,[]);assert((await audit(page)).meters.every(m=>m.muted));return{browser:name,...limits,physicalOutputMuted:true};
  } finally {await bounded(page.close(),'close resource-limit page');}
}
(async()=>{
  const {createPcmBuiltinPreset}=await import(pathToFileURL(path.join(repository,'docs/synth/synth_pcm.js')).href);
  defaultPreset=createPcmBuiltinPreset('sine');
  ({SYNTH_SONG_MIX_DEFAULTS:{pcm:systemGain}}=await import(pathToFileURL(path.join(repository,'docs/synth/synth_song_mix_defaults.js')).href));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port,results=[],cancellations=[],limits=[];
  try {
    for(const name of engines) {
      const browser=await bounded(({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})}),'launch '+name);
      try {
        results.push(await run(browser,name,origin));cancellations.push(await canceledPreparation(browser,name,origin));
        cancellations.push(await canceledPreparation(browser,name,origin,'event'));
        cancellations.push(await canceledRender(browser,name,origin));limits.push(await resourceLimits(browser,name,origin));
        console.log('PASS '+name+': PCM layered overdubs, actual muted output, Undo/resume, source preservation and cancellation');
      } finally {await bounded(browser.close(),'close '+name);}
    }
  } finally {resourceGate?.release();resourceGate=null;server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  assert.deepEqual(missing,[]);assert.deepEqual(external,[]);await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});
  await fs.writeFile(config.out,JSON.stringify({passed:true,physicalOutputMuted:true,listeningPerformed:false,results,cancellations,limits,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))},null,2)+'\n');
  console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
