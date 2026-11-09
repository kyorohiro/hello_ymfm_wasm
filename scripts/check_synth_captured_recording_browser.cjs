// Exercise copied OP masks / CH3 pitches through the published Synth controls.
// Self-authored music only. Every speaker edge is metered and physically muted.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');

const repository=path.resolve(__dirname,'..');
const config={root:path.join(repository,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',
  out:'/private/tmp/fm2612-synth-captured-recording-browser.json',screenshots:null};
for(const argument of process.argv.slice(2)) {
  const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(argument);
  assert(match,'Unknown option '+argument);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/'));
const engines=config.engines.split(',');assert(engines.every(name=>['chromium','webkit'].includes(name)));
const CLOCK=7670454,RATE=53267;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(task,label,ms=25000) {
  let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timed out: '+label)),ms);})]);}
  finally{clearTimeout(timer);}
}
const evaluate=(page,callback,arg)=>bounded(page.evaluate(callback,arg),'page evaluation');
const write=(commands,register,value,port=0)=>commands.push(port?0x53:0x52,register,value);
function wait(commands,seconds) {
  let frames=Math.round(seconds*44100);
  while(frames){const count=Math.min(frames,65535);commands.push(0x61,count&255,count>>8);frames-=count;}
}
function vgm(commands,seconds) {
  const bytes=Buffer.alloc(256+commands.length),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,204,true);view.setUint32(0x18,Math.round(seconds*44100),true);view.setUint32(0x2c,CLOCK,true);
  bytes.set(commands,256);return bytes;
}
function program(commands,channel,{special=false,mask=8,multi=2}={}) {
  const port=channel>=3?1:0,index=channel%3;
  write(commands,0x22,0);write(commands,0x27,special?0x40:0);write(commands,0x2b,0);
  write(commands,0xb0+index,7,port);write(commands,0xb4+index,0xc0,port);
  for(const [operator,offset]of[0,8,4,12].entries()) {
    // Inactive operators are deliberately audible if a recorder loses the mask.
    write(commands,0x30+offset+index,special?1:[3,5,7,multi][operator],port);
    write(commands,0x40+offset+index,44,port);write(commands,0x50+offset+index,31,port);
    write(commands,0x60+offset+index,0,port);write(commands,0x70+offset+index,0,port);
    write(commands,0x80+offset+index,15,port);write(commands,0x90+offset+index,0,port);
  }
  write(commands,0xa4+index,(4<<3)|(1000>>8),port);write(commands,0xa0+index,1000&255,port);
  if(special)for(const [low,high,block,fnum]of[[0xa9,0xad,3,1000],[0xaa,0xae,4,1500],[0xa8,0xac,5,1000],[0xa2,0xa6,4,1000]]) {
    write(commands,high,(block<<3)|(fnum>>8));write(commands,low,fnum&255);
  }
  const code=channel%3|(channel>=3?4:0);
  write(commands,0x28,(mask<<4)|code);wait(commands,.05);write(commands,0x28,code);
}
function copiedSong({special=false,mask=8}={}) {
  const commands=[];program(commands,special?2:3,{special,mask});wait(commands,60);commands.push(0x66);return vgm(commands,60.05);
}
function referenceSong() {
  const commands=[];program(commands,0,{multi:1});
  const hz=480,block=4,fnum=Math.round(hz*144*2**20/(CLOCK*2**(block-1)));
  write(commands,0xa4,(block<<3)|(fnum>>8));write(commands,0xa0,fnum&255);write(commands,0x28,0x80);
  wait(commands,60);write(commands,0x28,0);commands.push(0x66);
  return {bytes:vgm(commands,60.05),hz:fnum*CLOCK*2**(block-1)/(144*2**20)};
}

function installAudit() {
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const meters=[],writes=[];
  window.AudioContext=new Proxy(Context,{construct(Target,args){return Reflect.construct(Target,args);}});
  if(window.webkitAudioContext===Context)window.webkitAudioContext=window.AudioContext;
  MessagePort.prototype.postMessage=function(message,...args) {
    for(const command of Array.isArray(message)?message:[message])if(command?.type==='write')writes.push({time:performance.now(),port:command.port,register:command.register,value:command.value});
    if(writes.length>10000)writes.splice(0,writes.length-10000);
    return post.call(this,message,...args);
  };
  AudioNode.prototype.connect=function(destination,...args) {
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=8192;mute.gain.value=0;
    connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);
    meters.push({context:this.context,analyser,mute,bases:new Map()});return destination;
  };
  window.__recordAudit={drainWrites(){return writes.splice(0);},read(targets=[]){return meters.map(({context,analyser,mute,bases})=>{
    const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);
    let mean=0;for(const value of pcm)mean+=value;mean/=pcm.length;
    let squares=0,peak=0;for(const value of pcm){squares+=(value-mean)**2;peak=Math.max(peak,Math.abs(value));}
    const tones={};
    for(const hz of targets) {
      const key=String(hz);if(!bases.has(key)) {
        const hann=Float32Array.from(pcm,(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(pcm.length-1)));
        bases.set(key,{cosine:Float32Array.from(hann,(w,i)=>w*Math.cos(2*Math.PI*hz*i/context.sampleRate)),
          sine:Float32Array.from(hann,(w,i)=>w*Math.sin(2*Math.PI*hz*i/context.sampleRate)),weight:hann.reduce((a,b)=>a+b,0)});
      }
      const {cosine,sine,weight}=bases.get(key);let re=0,im=0;
      for(let i=0;i<pcm.length;i++){re+=(pcm[i]-mean)*cosine[i];im+=(pcm[i]-mean)*sine[i];}
      tones[key]=2*Math.hypot(re,im)/weight;
    }
    return {muted:mute.gain.value===0,finite:pcm.every(Number.isFinite),acRms:Math.sqrt(squares/pcm.length),peak,tones};
  });}};
}
const audit=(page,targets=[])=>evaluate(page,targets=>__recordAudit.read(targets),targets);
const drainWrites=page=>evaluate(page,()=>__recordAudit.drainWrites());
const transport=page=>evaluate(page,()=>({state:document.getElementById('synthSongStatus').dataset.state,
  frame:Number(document.getElementById('synthSongPlayer').dataset.consumedFrames),target:document.getElementById('synthSongChannelSelect').value,
  status:document.getElementById('status').textContent,looper:document.getElementById('looperState').textContent,event:document.getElementById('eventRecordState').textContent}));
const ui=page=>evaluate(page,()=>({path:document.getElementById('synthActiveFilePath').textContent,preset:document.getElementById('presetSelect').value,
  common:[...document.querySelectorAll('#commonControls .param-value')].map(node=>[node.getAttribute('aria-label'),node.textContent]),
  operators:[...document.querySelectorAll('#operatorControls .operator-row')].map(row=>[...row.querySelectorAll('.param-value')].map(node=>[node.getAttribute('aria-label'),node.textContent])),
  special:[...document.querySelectorAll('#channel3SpecialControls .param-value')].map(node=>[node.getAttribute('aria-label'),node.textContent])}));
async function until(page,predicate,label,ms=20000) {
  const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await pause(30);}
  throw new Error(label+'; '+JSON.stringify({transport:await transport(page).catch(()=>null),audit:await audit(page).catch(()=>null)}));
}
const ready=page=>page.waitForFunction(()=>!document.getElementById('importPresetButton').disabled);
const state=(page,value)=>until(page,async()=>(await transport(page)).state===value,'Expected reference '+value);
const keyState=(page,key,pressed)=>until(page,()=>evaluate(page,({key,pressed})=>document.querySelector(`#keyboard .key[data-key="${key}"]`).classList.contains('is-active')===pressed,{key,pressed}),`Keyboard ${key} ${pressed}`);
async function silence(page) {await pause(240);await until(page,async()=>(await audit(page)).every(meter=>meter.acRms<1e-7),'No remaining audible signal');}
async function toneLevel(page,hz) {return Math.max(0,...(await audit(page,[hz])).map(meter=>meter.tones[String(hz)]));}
async function sounding(page,hz) {await until(page,async()=>(await toneLevel(page,hz))>.0002,'Actual '+hz+' Hz signal');}
async function keyboardHz(page,key='a') {
  const label=await page.locator(`#keyboard .key[data-key="${key}"] small`).textContent(),match=/b(\d+)\s*\/\s*f(\d+)/.exec(label);
  assert(match,'Keyboard publishes raw BLOCK/FNUM');return Number(match[2])*CLOCK*2**(Number(match[1])-1)/(144*2**20);
}
async function fingerprint(page,hz,{special=false,full=false}={}) {
  const ratios=special?[.5,1,1.5,2]:[2,3,5,7],targets=ratios.map(ratio=>ratio*hz),samples=[];
  for(let count=0;count<4;count++){samples.push(await audit(page,targets));await pause(25);}
  const levels=targets.map(target=>samples.reduce((sum,meters)=>sum+Math.max(0,...meters.map(meter=>meter.tones[String(target)])),0)/samples.length);
  return validateFingerprint(ratios,levels,{special,full});
}
function validateFingerprint(ratios,levels,{special=false,full=false}={}) {
  const carrier=levels[special?1:0];assert(carrier>.0002,'The captured carrier is present');
  if(!full)for(const [index,level]of levels.entries())if(index!==(special?1:0))assert(level<carrier*.08,'Inactive OP remains quiet at ratio '+ratios[index]);
  if(full)assert(levels.every(value=>value>carrier*.25),'All four CH3 operators are represented in the actual PCM');
  return {ratios,levels};
}
async function replayFingerprint(page,hz,{special=false,full=false}={}) {
  // Loop/event playback includes the intentional key-off gap. Select a stable
  // sounding window across a complete short cycle rather than measuring a gap.
  const ratios=special?[.5,1,1.5,2]:[2,3,5,7],targets=ratios.map(ratio=>ratio*hz),carrier=special?1:0;
  let best=null;const end=Date.now()+1800;
  while(Date.now()<end) {
    const readings=await audit(page,targets),levels=targets.map(target=>Math.max(0,...readings.map(meter=>meter.tones[String(target)])));
    if(!best||levels[carrier]>best[carrier])best=levels;
    await pause(45);
  }
  return validateFingerprint(ratios,best,{special,full});
}
function assertKeys(writes,{special=false,mask=8,minimum=1}={}) {
  const ons=writes.filter(write=>write.port===0&&write.register===0x28&&(write.value&0xf0));
  assert(ons.length>=minimum,'Actual keyboard chip receives fresh KON commands');
  assert(ons.every(write=>(write.value>>4)===mask),'Recorded operator mask survives without all-OP retriggers');
  if(special)assert(ons.every(write=>write.value===(mask<<4|2)),'CH3 special always uses actual hardware CH3');
  return ons;
}
function assertSpecialPitches(writes) {
  const registers=new Map(writes.filter(write=>write.port===0).map(write=>[write.register,write.value]));
  const weights=[[0xa9,0xad],[0xaa,0xae],[0xa8,0xac],[0xa2,0xa6]].map(([low,high])=>(((registers.get(high)&7)<<8)|registers.get(low))*2**((registers.get(high)>>3)&7));
  assert(weights.every(value=>Number.isFinite(value)&&value>0),'All four hardware frequencies were written');
  for(const [index,ratio]of[.5,1.5,2,1].entries())assert(Math.abs(weights[index]/weights[3]-ratio)<.003,'Preserved CH3 OP'+(index+1)+' ratio');
}
async function files(page) {return evaluate(page,()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('tetorica-fm2612-synth-drafts',1);request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,get=db.transaction('projects','readonly').objectStore('projects').get('current');get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=async()=>{
    const entries=get.result.project.files;db.close();
    try {resolve(await Promise.all(entries.map(async file=>{
      const bytes=typeof file.data==='string'?new TextEncoder().encode(file.data):file.data,digest=await crypto.subtle.digest('SHA-256',bytes);
      return {path:file.path,bytes:bytes.byteLength,sha256:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')};
    })));}catch(error){reject(error);}
  };};
}));}
async function copySong(page,name,channel) {
  if(['loading','playing','paused'].includes((await transport(page)).state))await page.locator('#synthSongStopButton').click();
  await page.locator('#synthSongSelect').selectOption('/vgm/'+name);
  await page.locator('#synthSongChannelSelect').selectOption(String(channel));
  await page.locator('#synthSongPlayButton').click();await state(page,'playing');await pause(220);
  await page.locator('#synthSongPlayButton').click();await state(page,'paused');
  await until(page,async()=>!await page.locator('#synthSongCopyButton').isDisabled(),'Copy becomes available');
  await page.locator('#synthSongCopyButton').click();await ready(page);
  await until(page,async()=>(await transport(page)).target==='synth','Copy selects Synth');
  assert.equal(await page.locator('#looperStartButton').isDisabled(),false,'Copied tone supports Looper');
  assert.equal(await page.locator('#eventRecordStartButton').isDisabled(),false,'Copied tone supports Event Rec');
  await silence(page);return (await ui(page)).path;
}
async function selectTone(page,path) {await page.locator('#presetSelect').selectOption(path.startsWith('/')?'vfs:'+path:path);await ready(page);}
async function stopEvent(page) {
  if((await page.locator('#eventRecordPlayButton').textContent()).includes('Stop'))await page.locator('#eventRecordPlayButton').click();
  if((await page.locator('#eventRecordStartButton').textContent()).includes('Stop'))await page.locator('#eventRecordStartButton').click();
  await silence(page);
}
async function exportEvent(page) {
  if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
  const downloadPromise=page.waitForEvent('download');await page.locator('#eventRecordExportButton').click();
  const download=await downloadPromise,stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function checkKeyboard(page,{special=false,full=false}={}) {
  const hz=await keyboardHz(page),before=await ui(page);await drainWrites(page);
  await page.keyboard.down('a');await keyState(page,'a',true);await sounding(page,hz*(special?1:2));
  const measured=await fingerprint(page,hz,{special,full});
  await page.keyboard.down('s');await keyState(page,'s',true);
  const writes=await drainWrites(page),ons=assertKeys(writes,{special,mask:full?15:8,minimum:2});
  if(special){assertSpecialPitches(writes);await keyState(page,'a',false);}
  else {assert(new Set(ons.map(write=>write.value&7)).size>=2,'Partial OP voices retain normal round robin');await keyState(page,'a',true);}
  await page.keyboard.up('a');await pause(40);await sounding(page,(await keyboardHz(page,'s'))*(special?1:2));
  await page.keyboard.up('s');await keyState(page,'s',false);await silence(page);
  assert.deepEqual(await ui(page),before,'Keyboard performance preserves canonical edited settings');
  return measured;
}
async function checkLooper(page,tonePath,{special=false}={}) {
  const hz=await keyboardHz(page),before=await ui(page);await page.locator('#looperStartButton').click();
  await until(page,async()=>(await page.locator('#looperStartButton').textContent()).includes('Stop'),'Looper starts');
  await page.locator('#looperRecordButton').click();await until(page,async()=>(await transport(page)).looper.includes('Recording'),'Looper records');
  await drainWrites(page);await page.keyboard.down('a');await keyState(page,'a',true);await sounding(page,hz*(special?1:2));
  // A threshold crossing can precede a full analyser window. Compare the
  // recorded loop against a fully sounding live window, not attack + silence.
  await pause(200);
  const live=await fingerprint(page,hz,{special});const writes=await drainWrites(page);assertKeys(writes,{special});if(special)assertSpecialPitches(writes);
  await pause(150);await page.keyboard.up('a');await pause(180);
  await page.locator('#looperRecordButton').click();
  await until(page,async()=>(await transport(page)).looper.includes('Loop(1)'),'One recorded loop unit');
  await sounding(page,hz*(special?1:2));const replay=await replayFingerprint(page,hz,{special});
  const carrier=special?1:0;assert(replay.levels[carrier]>live.levels[carrier]*.65&&replay.levels[carrier]<live.levels[carrier]*1.4,
    `Recorded PCM keeps the same carrier amplitude: live=${live.levels[carrier]}, replay=${replay.levels[carrier]}, ratio=${replay.levels[carrier]/live.levels[carrier]}`);
  await selectTone(page,'sine');await sounding(page,hz*(special?1:2));await replayFingerprint(page,hz,{special});
  await page.locator('#looperStartButton').click();await until(page,async()=>(await page.locator('#looperStartButton').textContent()).includes('Start'),'Looper stops');await silence(page);
  await page.locator('#looperClearButton').click();await until(page,async()=>(await transport(page)).looper==='Looper idle.','Looper clears');
  await selectTone(page,tonePath);assert.deepEqual(await ui(page),before,'Returning to copied tone restores its complete settings');
  return {live,replay};
}
async function recordEvent(page,{special=false}={}) {
  const hz=await keyboardHz(page);await page.locator('#eventRecordIgnoreOperators').uncheck();
  await page.locator('#eventRecordStartButton').click();await until(page,async()=>(await page.locator('#eventRecordStartButton').textContent()).includes('Stop'),'Event session starts');
  await page.locator('#eventRecordStopButton').click();await until(page,async()=>(await transport(page)).event.includes('REC'),'Event take records');
  await drainWrites(page);
  for(const key of ['a','s']){await page.keyboard.down(key);await keyState(page,key,true);await sounding(page,(await keyboardHz(page,key))*(special?1:2));await pause(180);await page.keyboard.up(key);await pause(100);}
  const recordedWrites=await drainWrites(page);assertKeys(recordedWrites,{special,minimum:2});if(special)assertSpecialPitches(recordedWrites);
  await page.locator('#eventRecordStopButton').click();await until(page,async()=>(await page.locator('#eventRecordPlayButton').textContent()).includes('Stop'),'Completed event take loops');
  await drainWrites(page);await sounding(page,hz*(special?1:2));await replayFingerprint(page,hz,{special});
  await pause(500);const replayWrites=await drainWrites(page);assertKeys(replayWrites,{special});if(special)assertSpecialPitches(replayWrites);
  const recording=await exportEvent(page);assert.equal(recording.format,'tetorica-fm2612-synth-recording-v1');
  const notes=recording.commands.filter(command=>command.type==='capturedNoteOn');assert.equal(notes.length,2,'Exactly two performed captured attacks are recorded');
  assert(notes.every(command=>command.voice.keyMask===8&&command.voice.specialMode===special));
  if(special)assert(notes.every(command=>command.channel===2&&command.voice.specialFrequencies.length===4));
  else assert(new Set(notes.map(command=>command.channel)).size>=2,'Event recording retains normal round-robin channels');
  await stopEvent(page);return recording;
}

const served=new Map(),missing=[],external=[],mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer(async(request,response)=>{try{
  const pathname=new URL(request.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
  const name=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(name.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(name),key=path.relative(config.root,name).split(path.sep).join('/'),info={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  if(served.has(key))assert.deepEqual(served.get(key),info,'Asset changed during validation');served.set(key,info);
  response.setHeader('Content-Type',mime[path.extname(name)]??'application/octet-stream');response.end(bytes);
}catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}});
async function openPage(browser,origin) {
  const page=await browser.newPage({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1240,height:1100}});page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installAudit);await page.goto(origin+config.entry);await ready(page);return {page,errors};
}
async function importAndReplay(browser,origin,recording,{special=false}={}) {
  const {page,errors}=await openPage(browser,origin);
  try {
    await selectTone(page,'sine');await page.locator('#eventRecordIgnoreOperators').uncheck();
    // Establish a trusted audio gesture before setting a hidden import input.
    await page.locator('#eventRecordStartButton').click();await page.locator('#eventRecordStartButton').click();
    const original=await ui(page),hz=await keyboardHz(page);
    await page.locator('#eventRecordImportInput').setInputFiles({name:'captured.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recording))});
    await until(page,async()=>(await transport(page)).status.includes('Imported event recording'),'Imported event JSON');
    const importedBefore=await exportEvent(page);
    await drainWrites(page);await page.locator('#eventRecordPlayButton').click();await sounding(page,hz*(special?1:2));await replayFingerprint(page,hz,{special});
    await pause(550);const writes=await drainWrites(page);assertKeys(writes,{special});if(special)assertSpecialPitches(writes);
    const malformed=structuredClone(recording);malformed.commands.find(command=>command.type==='capturedNoteOn').voice.keyMask=0;
    await page.locator('#eventRecordImportInput').setInputFiles({name:'bad-captured.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(malformed))});
    await until(page,async()=>(await transport(page)).status.includes('Failed to import'),'Malformed captured JSON rejects');
    // The previous valid imported take remains playable/exportable.
    assert.deepEqual(await exportEvent(page),importedBefore,'Invalid import retains the valid recording');
    await stopEvent(page);assert.deepEqual(await ui(page),original,'Playback stopping restores the edited Synth UI');
    await drainWrites(page);await page.keyboard.down('a');await keyState(page,'a',true);await sounding(page,hz);
    const after=await drainWrites(page),ons=after.filter(item=>item.port===0&&item.register===0x28&&(item.value&0xf0));
    assert(ons.some(item=>(item.value&0xf0)===0xf0),'Normal Synth keyboard restores all-OP attack after recorded playback');
    assert(!after.some(item=>item.port===0&&item.register===0x27&&(item.value&0x40)),'Normal Synth keyboard does not retain recorded CH3 mode');
    await page.keyboard.up('a');await silence(page);assert.deepEqual(errors,[]);
    return {special,commands:recording.commands.length,notes:recording.commands.filter(command=>command.type==='capturedNoteOn').length};
  } finally {await bounded(page.close(),'close imported recording page');}
}
async function assertReferenceLock(page,playing=true) {
  for(const id of ['looperStartButton','eventRecordStartButton','eventRecordPlayButton'])assert.equal(await page.locator('#'+id).isDisabled(),playing,id+' follows VGM transport lock');
}
async function checkExclusivity(page,reference) {
  await selectTone(page,'sine');await page.locator('#synthSongSelect').selectOption('/vgm/Reference.vgm');await page.locator('#synthSongChannelSelect').selectOption('synth');
  await page.locator('#looperStartButton').click();await page.locator('#looperRecordButton').click();
  await page.keyboard.down('a');await keyState(page,'a',true);await pause(200);
  await page.locator('#synthSongPlayButton').click();await state(page,'playing');await assertReferenceLock(page);
  await keyState(page,'a',false);await page.keyboard.up('a');await sounding(page,reference.hz);
  assert((await page.locator('#looperStartButton').textContent()).includes('Start'),'VGM start stops the running/recording looper');
  await drainWrites(page);await pause(1100);assert.equal((await drainWrites(page)).filter(item=>item.register===0x28&&(item.value&0xf0)).length,0,'No stale loop or record playback retriggers while the VGM runs');
  await page.locator('#synthSongPlayButton').click();await state(page,'paused');await silence(page);
  assert.equal(await page.locator('#looperStartButton').isDisabled(),false);assert.equal(await page.locator('#eventRecordStartButton').isDisabled(),false);
  assert((await page.locator('#looperStartButton').textContent()).includes('Start'),'Pause does not auto-restart the loop');
  // Resuming also stops an explicitly restarted loop, without losing its unit.
  await page.locator('#looperStartButton').click();await until(page,async()=>(await page.locator('#looperStartButton').textContent()).includes('Stop'),'Retained loop manually restarts');
  const position=(await transport(page)).frame;await page.locator('#synthSongPlayButton').click();await state(page,'playing');await assertReferenceLock(page);await sounding(page,reference.hz);
  assert((await transport(page)).frame>=position,'Resume keeps the original VGM position');
  await page.locator('#synthSongStopButton').click();await state(page,'stopped');await silence(page);
  if(!await page.locator('#looperClearButton').isDisabled())await page.locator('#looperClearButton').click();
  // An active event take must stop, remain saved, and never auto-play on VGM start.
  await page.locator('#eventRecordStartButton').click();await page.locator('#eventRecordStopButton').click();await page.keyboard.down('a');await keyState(page,'a',true);await pause(180);
  await page.locator('#synthSongPlayButton').click();await state(page,'playing');await assertReferenceLock(page);await keyState(page,'a',false);await page.keyboard.up('a');
  assert((await page.locator('#eventRecordStartButton').textContent()).includes('Start'),'VGM start exits Event Rec mode');
  assert(!(await transport(page)).event.includes('REC')&&!(await transport(page)).event.includes('LOOP'),'VGM start leaves recorded commands without active recording or playback');
  await drainWrites(page);await pause(700);assert.equal((await drainWrites(page)).filter(item=>item.register===0x28&&(item.value&0xf0)).length,0,'No auto-play from the take stopped by VGM');
  await page.locator('#synthSongPlayButton').click();await state(page,'paused');await silence(page);
  await page.locator('#eventRecordPlayButton').click();await until(page,async()=>(await page.locator('#eventRecordPlayButton').textContent()).includes('Stop'),'Saved take can be manually replayed after Pause');
  await page.locator('#synthSongPlayButton').click();await state(page,'playing');await assertReferenceLock(page);await sounding(page,reference.hz);
  await drainWrites(page);await pause(1000);assert.equal((await drainWrites(page)).filter(item=>item.register===0x28&&(item.value&0xf0)).length,0,'Resume cancels outstanding event-playback timers');
  await page.locator('#synthSongStopButton').click();await state(page,'stopped');await silence(page);
  assert.equal(await page.locator('#looperStartButton').isDisabled(),false);assert.equal(await page.locator('#eventRecordStartButton').isDisabled(),false);
}
async function checkPendingStart(browser,origin,reference) {
  const {page,errors}=await openPage(browser,origin);let release,heldResolve,held=false;
  const released=new Promise(resolve=>{release=resolve;}),captured=new Promise(resolve=>{heldResolve=resolve;});
  try {
    await page.locator('#tfiFile').setInputFiles({name:'Reference.vgm',mimeType:'application/octet-stream',buffer:reference.bytes});await ready(page);
    await page.locator('#synthSongChannelSelect').selectOption('synth');
    await page.route('**/*ym2612_wasm.wasm*',async route=>{
      if(!held){held=true;heldResolve();await released;}await route.continue();
    });
    await page.locator('#looperStartButton').click();await bounded(captured,'held first audio preparation',10000);
    await page.locator('#synthSongPlayButton').click();await state(page,'loading');assert.equal(await page.locator('#looperStartButton').isDisabled(),true);
    release();await state(page,'playing');await assertReferenceLock(page);await sounding(page,reference.hz);await pause(300);
    assert((await page.locator('#looperStartButton').textContent()).includes('Start'),'A stale pending Looper Start cannot complete after VGM started');
    assert(!(await transport(page)).looper.includes('REC'));assert.deepEqual(errors,[]);return true;
  } finally {release();await bounded(page.close(),'close pending-start page');}
}
async function checkBrowser(browser,name,origin) {
  const {page,errors}=await openPage(browser,origin),steps=[],reference=referenceSong();
  try {
    await page.locator('#tfiFile').setInputFiles([
      {name:'Partial.vgm',mimeType:'application/octet-stream',buffer:copiedSong()},
      {name:'Special.vgm',mimeType:'application/octet-stream',buffer:copiedSong({special:true})},
      {name:'Full.vgm',mimeType:'application/octet-stream',buffer:copiedSong({special:true,mask:15})},
      {name:'Reference.vgm',mimeType:'application/octet-stream',buffer:reference.bytes},
    ]);await ready(page);
    const partial=await copySong(page,'Partial.vgm',3);await pause(650);const originalFiles=await files(page);
    const partialKeyboard=await checkKeyboard(page);const partialLoop=await checkLooper(page,partial);
    const partialRecording=await recordEvent(page);steps.push('partial OP copy stays round-robin, records and replays actual PCM with the same isolated carrier, and Event Rec captures the exact key mask');
    await pause(650);assert.deepEqual(await files(page),originalFiles,'Performance recording does not rewrite tone or VGM files');
    const special=await copySong(page,'Special.vgm',2);await pause(650);const specialFiles=await files(page);
    const specialKeyboard=await checkKeyboard(page,{special:true});const specialLoop=await checkLooper(page,special,{special:true});
    const specialRecording=await recordEvent(page,{special:true});steps.push('copied CH3 uses hardware CH3 monophonically and preserves all four pitch ratios through Looper and Event Rec');
    await pause(650);assert.deepEqual(await files(page),specialFiles,'CH3 performance recording preserves canonical tone metadata');
    await copySong(page,'Full.vgm',2);await checkKeyboard(page,{special:true,full:true});
    steps.push('all four special-mode operators appear in real keyboard PCM at their recorded relative pitches');
    const imports=[await importAndReplay(browser,origin,partialRecording),await importAndReplay(browser,origin,specialRecording,{special:true})];
    steps.push('exported recordings import and reproduce actual partial/CH3 sound in clean pages; invalid import retains previous valid take and Stop restores the edited Synth');
    await checkExclusivity(page,reference);steps.push('VGM Play and Resume stop Looper, active takes and event playback for Synth target too; Pause/Stop only re-enable manual controls');
    if(config.screenshots) {
      await fs.mkdir(config.screenshots,{recursive:true});for(const width of [1240,390]){
        await page.setViewportSize({width,height:1100});await page.screenshot({path:path.join(config.screenshots,`${name}-captured-recording-${width}.png`)});
      }
    }
    assert.deepEqual(errors,[]);assert((await audit(page)).every(meter=>meter.muted));
    return {browser:name,steps,partialKeyboard,partialLoop,specialKeyboard,specialLoop,imports,pendingStart:await checkPendingStart(browser,origin,reference),physicalOutputMuted:true};
  } catch(error) {console.error(JSON.stringify({browser:name,steps,transport:await transport(page).catch(()=>null),ui:await ui(page).catch(()=>null),errors}));throw error;}
  finally {await bounded(page.close(),'close captured recording page');}
}

if(require.main===module)(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  try {
    for(const name of engines){const browser=await bounded(({chromium,webkit})[name].launch({headless:true}),'launch '+name);
      try{results.push(await checkBrowser(browser,name,origin));console.log('PASS '+name+': copied OP / CH3 Looper and Event Rec, actual audio, export/import and VGM exclusion');}
      finally{await bounded(browser.close(),'close '+name);}}
  } finally {server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
  const report={passed:true,physicalOutputMuted:true,listeningPerformed:false,results,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');
  console.log('PASS '+results.length+' browsers; receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});

module.exports={copiedSong,referenceSong};
