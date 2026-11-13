// Live parameter highlighting on the published FM2612 UI. Self-authored VGM
// writes drive the real chips. Every physical speaker edge is metered/muted.
const {selectSynthChannel,setSynthLive}=require('./synth_channel_browser_helpers.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');

const repository=path.resolve(__dirname,'..');
const config={root:path.join(repository,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',
  out:'/private/tmp/fm2612-synth-live-highlight-browser.json',screenshots:null};
for(const argument of process.argv.slice(2)) {
  const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(argument);
  assert(match,'Unknown option '+argument);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/'));
const engines=config.engines.split(',');assert(engines.every(name=>['chromium','webkit'].includes(name)));
const CLOCK=7670454,RATE=53267,SETTING='tetorica-fm2612-synth-live-highlight';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(task,label,ms=25000) {
  let timer;
  try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timed out: '+label)),ms);})]);}
  finally{clearTimeout(timer);}
}
const evaluate=(page,fn,arg)=>bounded(page.evaluate(fn,arg),'browser evaluation');
const write=(commands,register,value,port=0)=>commands.push(port?0x53:0x52,register,value);
function wait(commands,seconds) {
  let frames=Math.round(seconds*44100);
  while(frames){const count=Math.min(frames,65535);commands.push(0x61,count&255,count>>8);frames-=count;}
}
function buildVgm(commands,seconds) {
  const bytes=Buffer.alloc(256+commands.length),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
  bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,204,true);view.setUint32(0x18,Math.round(seconds*44100),true);view.setUint32(0x2c,CLOCK,true);
  bytes.set(commands,256);return bytes;
}
function pitch(commands,channel,hz) {
  let block=4,raw=hz*144*2**20/(CLOCK*2**(block-1));
  while(raw>2047&&block<7){raw/=2;block++;}
  const fnum=Math.round(raw),port=channel>=3?1:0,index=channel%3;
  write(commands,0xa4+index,(block<<3)|(fnum>>8),port);write(commands,0xa0+index,fnum&255,port);
}
function channel(commands,number,{algorithm=7,feedback=0,tl=48,pan=0xc0}={}) {
  const port=number>=3?1:0,index=number%3;
  write(commands,0xb0+index,(feedback<<3)|algorithm,port);write(commands,0xb4+index,pan,port);
  for(const [operator,slot]of[0,8,4,12].entries()) {
    write(commands,0x30+slot+index,1,port);write(commands,0x40+slot+index,operator===3?tl:127,port);
    write(commands,0x50+slot+index,31,port);write(commands,0x60+slot+index,0,port);
    write(commands,0x70+slot+index,0,port);write(commands,0x80+slot+index,15,port);write(commands,0x90+slot+index,0,port);
  }
}
function timedSong() {
  const commands=[];write(commands,0x22,0);write(commands,0x27,0);write(commands,0x2b,0);
  channel(commands,0);channel(commands,1,{algorithm:4,feedback:2,tl:57,pan:0});
  channel(commands,2,{pan:0});pitch(commands,0,440);pitch(commands,1,330);
  for(const [low,high]of[[0xa9,0xad],[0xaa,0xae],[0xa8,0xac],[0xa2,0xa6]]) {
    write(commands,high,(4<<3)|(1000>>8));write(commands,low,1000&255);
  }
  write(commands,0x28,0xf0);write(commands,0x28,0xf1);
  wait(commands,1.5);
  write(commands,0xb0,(6<<3)|5);write(commands,0x4c,40);write(commands,0x5c,25);write(commands,0x22,0x0b);
  write(commands,0x27,0x40);write(commands,0xad,(4<<3)|(1100>>8));write(commands,0xa9,1100&255);
  wait(commands,1.5);write(commands,0xb0,(4<<3)|5);write(commands,0x48,90);
  wait(commands,1);
  for(let index=0;index<48;index++){write(commands,0x4c,40+(index&1));wait(commands,.025);}
  wait(commands,1.3);write(commands,0x5c,22); // 6.5 s, after re-enabling highlight.
  wait(commands,.9);
  // Pitch-only changes exercise existing UI refresh without rewriting any
  // unchanged parameter text or starting additional highlight animations.
  for(let index=0;index<40;index++){pitch(commands,0,index&1?440:442);wait(commands,.025);}
  wait(commands,21.6);write(commands,0x28,0);commands.push(0x66);
  return buildVgm(commands,30);
}
function steadySong(seconds=5) {
  const commands=[];channel(commands,0,{algorithm:6,feedback:1,tl:52});pitch(commands,0,330);write(commands,0x28,0xf0);
  wait(commands,seconds);commands.push(0x66);return buildVgm(commands,seconds);
}

function installAudit() {
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect;
  const intervals=window.setInterval,meters=[],events=[],textWrites=[];
  let intervalCalls=0;
  window.setInterval=function(...args){intervalCalls++;return intervals.apply(this,args);};
  function key(node) {
    const label=node.getAttribute('aria-label');
    if(node.closest('#commonControls'))return 'common:'+label;
    if(node.closest('#channel3SpecialControls'))return 'special:'+label;
    const row=node.closest('.operator-row');
    if(row)return 'op'+([...row.parentElement.querySelectorAll('.operator-row')].indexOf(row)+1)+':'+label;
    return 'other:'+label;
  }
  const frame=()=>Number(document.getElementById('synthSongPlayer')?.dataset.consumedFrames??0);
  const add=(kind,node)=>{events.push({kind,key:key(node),time:performance.now(),frame:frame()});if(events.length>3000)events.splice(0,events.length-3000);};
  const observer=new MutationObserver(records=>{
    for(const record of records) {
      if(record.type==='attributes'&&record.target.matches('.param-value')) {
        const before=(record.oldValue??'').split(/\s+/).includes('is-live-changed');
        const after=record.target.classList.contains('is-live-changed');
        if(before!==after)add(after?'add':'remove',record.target);
      } else if(record.type==='childList') {
        const node=record.target.nodeType===1?record.target:record.target.parentElement;
        if(node?.matches('.param-value'))textWrites.push({key:key(node),time:performance.now(),frame:frame()});
      }
    }
  });
  observer.observe(document,{subtree:true,attributes:true,attributeFilter:['class'],attributeOldValue:true,childList:true});
  for(const type of ['animationstart','animationend'])document.addEventListener(type,event=>{
    if(event.animationName==='synth-live-change'&&event.target.matches('.param-value'))add(type,event.target);
  });
  AudioNode.prototype.connect=function(destination,...args) {
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);meters.push({analyser,mute,context:this.context});return destination;
  };
  window.__highlightAudit={events:()=>events.slice(),textWrites:()=>textWrites.slice(),intervalCalls:()=>intervalCalls,
    clear(){events.length=0;textWrites.length=0;},read(){return meters.map(({analyser,mute,context})=>{
      const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);
      const mean=data.reduce((sum,value)=>sum+value,0)/data.length;
      const rms=Math.sqrt(data.reduce((sum,value)=>sum+(value-mean)**2,0)/data.length);
      return {finite:data.every(Number.isFinite),muted:mute.gain.value===0,rms,rate:context.sampleRate};
    });}};
}
const audit=page=>evaluate(page,()=>__highlightAudit.read());
const transport=page=>evaluate(page,()=>({state:document.getElementById('synthSongStatus').dataset.state,
  frame:Number(document.getElementById('synthSongPlayer').dataset.consumedFrames),time:performance.now(),
  channel:document.getElementById('synthSongChannelSelect').value}));
const highlighted=page=>page.locator('.param-value.is-live-changed').count();
const ready=page=>page.waitForFunction(()=>!document.getElementById('importPresetButton').disabled);
async function until(page,predicate,label,ms=25000) {
  const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await pause(20);}
  throw new Error(label+'; '+JSON.stringify({transport:await transport(page),highlighted:await highlighted(page),audit:await audit(page)}));
}
const state=(page,value)=>until(page,async()=>(await transport(page)).state===value,'Expected '+value);
const at=(page,seconds)=>until(page,async()=>(await transport(page)).frame>=seconds*RATE,'Audible frame '+seconds+'s');
const common=(page,label)=>page.locator(`#commonControls .param-value[aria-label="${label}"]`);
const operator=(page,number,label)=>page.locator(`#operatorControls .param-value[aria-label="${label}"]`).nth(number-1);
async function openMix(page) {
  if(!await page.locator('#synthSongMixPanel').isVisible())await page.locator('#synthSongMixButton').click();
  await page.locator('#synthSongMixPanel').waitFor({state:'visible'});
}
async function toggleHighlight(page,enabled) {
  await openMix(page);
  if(enabled)await page.locator('#synthSongHighlightToggle').check();
  else await page.locator('#synthSongHighlightToggle').uncheck();
  assert.notEqual(await page.evaluate(()=>document.activeElement?.id),'synthSongHighlightToggle','Display setting releases keyboard focus');
}
async function noAnimations(page) {
  assert.equal(await highlighted(page),0);
  assert.equal(await evaluate(page,()=>document.getAnimations().filter(animation=>animation.animationName==='synth-live-change').length),0);
}
async function files(page) {return evaluate(page,()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('tetorica-fm2612-synth-drafts',1);request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,get=db.transaction('projects','readonly').objectStore('projects').get('current');get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=async()=>{
    const records=get.result.project.files;db.close();
    try{resolve((await Promise.all(records.map(async record=>{
      const bytes=typeof record.data==='string'?new TextEncoder().encode(record.data):record.data;
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      return {path:record.path,bytes:bytes.byteLength,sha256:[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')};
    }))).sort((a,b)=>a.path.localeCompare(b.path)));}catch(error){reject(error);}
  };};
}));}

const served=new Map(),missing=[],external=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer(async(request,response)=>{try {
  const pathname=new URL(request.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
  const name=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(name.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(name),key=path.relative(config.root,name).split(path.sep).join('/');
  const info={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  if(served.has(key))assert.deepEqual(served.get(key),info,'Source changed during validation');served.set(key,info);
  response.setHeader('Content-Type',mime[path.extname(name)]??'application/octet-stream');response.end(bytes);
}catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}});

async function checkBrowser(browser,name,origin) {
  const page=await browser.newPage({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1240,height:1000},reducedMotion:'no-preference'}),errors=[],steps=[];
  page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installAudit);
  let firstEvents=[],burstEvents=[];
  try {
    await page.goto(origin+config.entry);await ready(page);
    assert.equal(await page.locator('#synthSongHighlightToggle').isChecked(),true,'Highlight defaults On in a fresh context');
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),SETTING),null);
    await page.locator('#tfiFile').setInputFiles([
      {name:'Highlight.vgm',mimeType:'application/octet-stream',buffer:timedSong()},
      {name:'Other.vgm',mimeType:'application/octet-stream',buffer:steadySong()},
      {name:'Short.vgm',mimeType:'application/octet-stream',buffer:steadySong(.3)},
    ]);await ready(page);await pause(650);
    const originalFiles=await files(page);
    await page.locator('#synthSongSelect').selectOption('/vgm/Highlight.vgm');
    await selectSynthChannel(page,'0');
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await at(page,.15);
    await noAnimations(page);
    assert.equal(await common(page,'ALGO').textContent(),'7');
    await until(page,async()=>(await audit(page)).some(meter=>meter.finite&&meter.rms>.0001),'Real FM is audible through a muted physical output');
    const boundary=await evaluate(page,async rate=>{
      const rows=[];
      while(Number(document.getElementById('synthSongPlayer').dataset.consumedFrames)<2.15*rate) {
        const frame=Number(document.getElementById('synthSongPlayer').dataset.consumedFrames);
        if(frame>1.2*rate)rows.push({frame,keys:[...document.querySelectorAll('.param-value.is-live-changed')].map(node=>node.getAttribute('aria-label'))});
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      return rows;
    },RATE);
    const before=boundary.filter(row=>row.frame>1.28*RATE&&row.frame<1.45*RATE),during=boundary.filter(row=>row.frame>1.54*RATE&&row.frame<1.8*RATE);
    assert(before.length>2&&before.every(row=>row.keys.length===0),'A prefetched future register write must not highlight early');
    assert(during.some(row=>row.keys.includes('ALGO')&&row.keys.includes('TL')),'Changed ALGO and TL light at the audible position');
    firstEvents=await evaluate(page,()=>__highlightAudit.events());
    const added=firstEvents.filter(event=>event.kind==='add'),addedKeys=new Set(added.map(event=>event.key));
    for(const key of ['common:ALGO','common:FB','common:LFO','common:LFOF','op4:TL','op4:AR','special:MODE','special:OP1F'])assert(addedKeys.has(key),'Expected changed value '+key);
    assert(!addedKeys.has('op1:TL')&&!addedKeys.has('op2:TL'),'Unchanged operators do not highlight');
    assert(added.every(event=>event.frame>=1.46*RATE),'Initial controls and source setup never all flash');
    await noAnimations(page);
    assert.equal(await operator(page,4,'AR').textContent(),'25');
    steps.push('default On, value-only changes and CH3/LFO highlights follow consumed audio; first render and unchanged operators stay quiet');

    await at(page,3.04);
    await until(page,()=>common(page,'FB').evaluate(node=>node.classList.contains('is-live-changed')),'A second change is visibly active before disabling');
    const intervalsBefore=await evaluate(page,()=>__highlightAudit.intervalCalls());
    await toggleHighlight(page,false);await noAnimations(page);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),SETTING),'off');
    await evaluate(page,()=>__highlightAudit.clear());
    const offStart=await transport(page);await at(page,5.55);
    assert.equal((await evaluate(page,()=>__highlightAudit.events())).filter(event=>event.kind==='add'||event.kind==='animationstart').length,0,'Off does not start highlights even during fast register changes');
    await noAnimations(page);const offEnd=await transport(page);
    assert(Math.abs((offEnd.frame-offStart.frame)/RATE-(offEnd.time-offStart.time)/1000)<.15,'Changing the display setting neither skips nor replays song time');
    assert.equal(await evaluate(page,()=>__highlightAudit.intervalCalls()),intervalsBefore,'Highlight does not add a polling interval');
    await toggleHighlight(page,true);await noAnimations(page);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),SETTING),'on');
    await at(page,6.53);
    await until(page,()=>operator(page,4,'AR').evaluate(node=>node.classList.contains('is-live-changed')),'A new change after re-enabling highlights');
    await page.locator('#synthSongPlayButton').click();await state(page,'paused');await noAnimations(page);
    const paused=await transport(page);await pause(120);assert.equal((await transport(page)).frame,paused.frame);
    await selectSynthChannel(page,'1');await noAnimations(page);
    await selectSynthChannel(page,'0');await noAnimations(page);
    await setSynthLive(page,false);await noAnimations(page);
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await noAnimations(page);
    await at(page,8.7);await noAnimations(page);
    await setSynthLive(page,true);await noAnimations(page);
    await selectSynthChannel(page,'synth');await noAnimations(page);
    await page.locator('#synthSongStopButton').click();await state(page,'stopped');await noAnimations(page);
    await pause(650);assert.deepEqual(await files(page),originalFiles,'Display changes do not write the project or any tone sidecar');
    steps.push('Off immediately cancels effects, persists locally and creates no interval; On re-baselines; Pause/CH/frozen Live/Synth/Stop clear highlights without affecting audio or files');

    await selectSynthChannel(page,'0');
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await at(page,3.7);
    await evaluate(page,()=>__highlightAudit.clear());await at(page,5.85);
    burstEvents=await evaluate(page,()=>__highlightAudit.events());
    const bursts=burstEvents.filter(event=>event.kind==='add'&&event.key==='op4:TL');
    assert(bursts.length>=1&&bursts.length<=4,'Rapid TL changes share a bounded existing pulse instead of restarting one per write: '+bursts.length);
    const burstStarts=burstEvents.filter(event=>event.kind==='animationstart'&&event.key==='op4:TL');
    assert(burstStarts.length>=1&&burstStarts.length<=4,'Browser CSS animation count is bounded during 48 rapid writes');
    await noAnimations(page);
    await at(page,7.27);await evaluate(page,()=>__highlightAudit.clear());
    await at(page,8.75);
    assert.deepEqual(await evaluate(page,()=>__highlightAudit.textWrites()),[],'Pitch-only refreshes do not rewrite unchanged parameter text');
    assert.equal((await evaluate(page,()=>__highlightAudit.events())).filter(event=>event.kind==='add').length,0,'Pitch-only changes do not highlight unrelated values');
    await page.locator('#synthSongSelect').selectOption('/vgm/Other.vgm');await state(page,'stopped');await noAnimations(page);
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await at(page,.3);await noAnimations(page);
    await page.locator('#synthSongSelect').selectOption('/vgm/Short.vgm');await state(page,'stopped');await noAnimations(page);
    await page.locator('#synthSongPlayButton').click();await state(page,'ended');await noAnimations(page);
    steps.push('48 rapid changes coalesce into at most four pulses; pitch-only refreshes do not rewrite value text; source switches and natural completion leave no effects');

    await selectSynthChannel(page,'synth');
    await toggleHighlight(page,false);
    await page.keyboard.down('a');await until(page,()=>page.locator('#keyboard .key[data-key="a"]').evaluate(node=>node.classList.contains('is-active')),'Keyboard works immediately after toggling the setting');
    await page.keyboard.up('a');await noAnimations(page);
    if(config.screenshots) {
      await fs.mkdir(config.screenshots,{recursive:true});
      for(const width of [1240,390]) {
        await page.setViewportSize({width,height:1000});
        if(await page.locator('#synthSongMixPanel').isVisible())await page.locator('#synthSongMixButton').click();
        const closed=await page.locator('.synth-editor').boundingBox();
        await page.screenshot({path:path.join(config.screenshots,`${name}-highlight-closed-${width}.png`)});
        await openMix(page);const opened=await page.locator('.synth-editor').boundingBox();
        assert(Math.abs(opened.y-closed.y)<1&&Math.abs(opened.height-closed.height)<1,'Highlight setting stays inside the popup without moving the editor');
        const bounds=await page.locator('#synthSongMixPanel').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
        await page.locator('#synthSongHighlightToggle').scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(config.screenshots,`${name}-highlight-open-${width}.png`)});
      }
    }
    const measured=await audit(page);assert(measured.length>0&&measured.every(meter=>meter.muted&&meter.finite),'Every actual physical output was metered and muted');
    await page.reload();await ready(page);
    assert.equal(await page.locator('#synthSongHighlightToggle').isChecked(),false,'Off survives a same-origin reload');
    await noAnimations(page);assert.deepEqual(await files(page),originalFiles);
    const fresh=await browser.newPage({serviceWorkers:'block'});
    await fresh.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
    try {await fresh.goto(origin+config.entry);await ready(fresh);assert.equal(await fresh.locator('#synthSongHighlightToggle').isChecked(),true,'A separate fresh context still defaults On');}
    finally {await fresh.close();}
    assert.deepEqual(errors,[]);assert((await audit(page)).every(meter=>meter.muted));
    steps.push('keyboard focus, compact desktop/mobile setting and Off persistence work; a fresh context remains On');
    return {browser:name,steps,firstChangedKeys:[...addedKeys].sort(),rapidPulseCount:bursts.length,rapidAnimationStarts:burstStarts.length,
      originalFileCount:originalFiles.length,physicalOutputMuted:true};
  } catch(error) {
    console.error(JSON.stringify({browser:name,steps,transport:await transport(page).catch(()=>null),highlighted:await highlighted(page).catch(()=>null),errors}));throw error;
  } finally {await bounded(page.close(),'close highlight page');}
}

async function main() {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  try {for(const name of engines) {
    const browser=await bounded(({chromium,webkit})[name].launch({headless:true}),'launch '+name);
    try {results.push(await checkBrowser(browser,name,origin));console.log('PASS '+name+': Live highlight effects, Off cost controls and editor preservation');}
    finally {await bounded(browser.close(),'close '+name);}
  }} finally {server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
  const report={passed:true,physicalOutputMuted:true,listeningPerformed:false,results,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');
  console.log('PASS '+results.length+' browsers; receipt '+config.out);
}
module.exports={timedSong,steadySong};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
