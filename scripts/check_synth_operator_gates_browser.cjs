// Exercise editable OP1–OP4 key gates through the published Synth controls.
// Self-authored music only. Every speaker edge is metered and physically muted.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');

const repository=path.resolve(__dirname,'..');
const config={root:path.join(repository,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',
  out:'/private/tmp/fm2612-synth-operator-gates-browser.json',screenshots:null};
for(const argument of process.argv.slice(2)) {
  const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(argument);
  assert(match,'Unknown option '+argument);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/'));
const engines=config.engines.split(',');assert(engines.every(name=>['chromium','webkit'].includes(name)));
const CLOCK=7670454;
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
async function files(page) {return evaluate(page,()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('tetorica-fm2612-synth-drafts',1);request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,get=db.transaction('projects','readonly').objectStore('projects').get('current');get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=async()=>{
    const entries=get.result.project.files;db.close();
    try {resolve(await Promise.all(entries.map(async file=>{
      const bytes=typeof file.data==='string'?new TextEncoder().encode(file.data):file.data,digest=await crypto.subtle.digest('SHA-256',bytes);
      return {path:file.path,bytes:bytes.byteLength,...(file.path.endsWith('.synth.json')?{extra:JSON.parse(typeof file.data==='string'?file.data:new TextDecoder().decode(bytes))}:{}),sha256:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')};
    })));}catch(error){reject(error);}
  };};
}));}
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

// An ordinary VGI, with four independent carriers at distinct frequencies.
// Removing lower carriers leaves a power-of-two fundamental, so native YM2612
// DAC intermodulation cannot masquerade as one of the removed lower carriers.
// No captured metadata is imported: the OP controls must work on normal tones.
function diagnosticVgi() {
  const bytes=Buffer.alloc(43);bytes[0]=7;bytes[2]=0xc0;
  const multiples=[1,2,4,8];
  for(const [block,op]of[1,3,2,4].entries())bytes.set([multiples[op-1],3,44,0,31,0,0,15,0,0],3+block*10);
  return bytes;
}
function gateSong() {
  const commands=[];program(commands,0,{mask:8});
  write(commands,0x28,0x80);wait(commands,2);write(commands,0x28,0);wait(commands,3);
  write(commands,0x28,0x10);wait(commands,10);commands.push(0x66);return vgm(commands,15.05);
}
const gate=(page,op)=>page.locator(`[data-operator-gate="${op}"]`);
async function gateMask(page) {
  return evaluate(page,()=>[...document.querySelectorAll('[data-operator-gate]')].reduce((mask,node)=>mask|(node.getAttribute('aria-pressed')==='true'?1<<(Number(node.dataset.operatorGate)-1):0),0));
}
async function setMask(page,mask) {
  for(let op=1;op<=4;op++)if((await gate(page,op).getAttribute('aria-pressed')==='true')!==Boolean(mask&(1<<(op-1))))await gate(page,op).click();
  assert.equal(await gateMask(page),mask,'All four visible OP gate states match the requested mask');
}
async function selectEditableSynth(page) {
  await page.locator('#synthSongChannelSelect').selectOption('synth');
  await evaluate(page,()=>document.activeElement?.blur?.());
}
const operatorUi=page=>evaluate(page,()=>[...document.querySelectorAll('#operatorControls .operator-row')].map(row=>[...row.querySelectorAll('.param-value')].map(node=>[node.getAttribute('aria-label'),node.textContent])));
async function carrierLevels(page,hz) {
  const readings=await audit(page,[1,2,4,8].map(r=>r*hz));
  return [1,2,4,8].map(r=>Math.max(0,...readings.map(meter=>meter.tones[String(r*hz)])));
}
async function actualMask(page,hz,mask) {
  // The worklet schedules audio ahead and the 8192-frame analyser includes
  // older release samples. Keep the same spectral thresholds, but wait for
  // the post-edit window instead of interpreting a fixed delay as silence.
  await pause(230);let levels;
  try {
    await until(page,async()=>{levels=await carrierLevels(page,hz);return levels.every((level,op)=>mask&(1<<op)?level>.0002:level<.00004);},
      'Actual PCM reaches OP mask '+mask,3000);
  } catch(error) {
    throw new Error(`Actual OP PCM mismatch: mask=${mask}, fundamentalHz=${hz}, multiples=1/2/4/8, levels=${JSON.stringify(levels)}; ${error.message}`);
  }
  return levels;
}
async function downloadBytes(page,selector) {
  if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
  const promise=page.waitForEvent('download');await page.locator(selector).click();const download=await promise;
  const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);return Buffer.concat(chunks);
}
async function sidecarMask(page,tonePath,mask) {
  await until(page,async()=>(await files(page)).find(file=>file.path===tonePath+'.synth.json')?.extra?.capturedVoice?.keyMask===mask,'Persisted operator mask '+mask);
}
async function checkHeldGates(page) {
  assert.equal(await page.locator('[data-operator-gate]').count(),4,'Four small OP controls reuse the existing rows');
  assert.equal(await gateMask(page),15,'An ordinary VGI defaults to all OPs On');
  const original=await operatorUi(page),hz=await keyboardHz(page),measurements=[];
  await drainWrites(page);await page.keyboard.down('a');await keyState(page,'a',true);await sounding(page,hz*2);
  await page.keyboard.down('s');await keyState(page,'s',true);
  const attacks=(await drainWrites(page)).filter(item=>item.register===0x28&&(item.value&0xf0));
  assert(attacks.length>=2&&attacks.every(item=>(item.value>>4)===15),'Normal notes use all four OPs');
  assert(new Set(attacks.map(item=>item.value&7)).size>=2,'Normal tones remain round robin');
  await page.keyboard.up('s');await page.keyboard.up('a');await silence(page);
  await page.keyboard.down('a');await keyState(page,'a',true);await actualMask(page,hz,15);
  const writes=await drainWrites(page),attack=writes.filter(item=>item.register===0x28&&(item.value&0xf0)).at(-1);assert(attack);
  const channel=attack.value&7;
  for(const [op,mask]of[[1,14],[2,12],[3,8],[4,0],[4,8]]) {
    await drainWrites(page);await gate(page,op).click();await keyState(page,'a',true);
    const commands=await drainWrites(page),keys=commands.filter(item=>item.port===0&&item.register===0x28);
    assert.deepEqual(keys.map(item=>item.value),[(mask<<4)|channel],'Held edit writes one mask, without an all-Off/retrigger prelude');
    assert(!commands.some(item=>item.register>=0xa0&&item.register<=0xae),'Held gate changes do not rewrite pitch');
    assert.equal(await gateMask(page),mask);measurements.push({mask,levels:await actualMask(page,hz,mask)});
  }
  await page.keyboard.up('a');await silence(page);
  assert.deepEqual(await operatorUi(page),original,'Gate controls leave TL, algorithm and envelope parameters intact');
  // A zero mask is still a logically held note and can be enabled afterward.
  await setMask(page,0);await drainWrites(page);await page.keyboard.down('a');await keyState(page,'a',true);await silence(page);
  assert.equal((await drainWrites(page)).filter(item=>item.register===0x28&&(item.value&0xf0)).length,0,'Silent Note On never sends an all-OP fallback');
  await gate(page,4).click();await keyState(page,'a',true);await actualMask(page,hz,8);await page.keyboard.up('a');await silence(page);
  return measurements;
}
async function checkPersistence(page) {
  const tonePath=(await ui(page)).path;assert(tonePath.endsWith('.vgi'));
  await setMask(page,8);await page.locator('#synthFileSaveButton').click();await ready(page);await sidecarMask(page,tonePath,8);
  await setMask(page,0);await sidecarMask(page,tonePath,0);
  const dac=page.locator('#commonControls .param-value[aria-label="DAC"]');await dac.click();assert.equal(await dac.textContent(),'ON');
  await page.locator('#synthFileRevertButton').click();await ready(page);
  assert.equal(await gateMask(page),8,'Revert restores the synced mask');
  assert.equal(await dac.textContent(),'ON','Restoring an authored OP mask preserves the independent session DAC switch');
  await dac.click();assert.equal(await dac.textContent(),'OFF');
  await setMask(page,0);await sidecarMask(page,tonePath,0);
  const cassette=await downloadBytes(page,'#exportCassetteButton');
  await page.reload();await ready(page);assert.equal(await gateMask(page),0,'Reload recovers all-Off without falling back to all-On');
  await selectTone(page,'sine');assert.equal(await gateMask(page),15,'Old/built-in presets retain the legacy all-On default');
  await page.locator('#cassetteImportInput').setInputFiles({name:'Gate.cassette.zip',mimeType:'application/zip',buffer:cassette});await ready(page);
  await until(page,async()=>(await transport(page)).status.includes('Imported Gate.cassette.zip'),'Cassette imported');
  await selectTone(page,tonePath);assert.equal(await gateMask(page),0,'Cassette preserves all-Off');
  await selectEditableSynth(page);await setMask(page,15);return {tonePath,cassetteBytes:cassette.length};
}
async function checkEventRecord(page) {
  await setMask(page,15);await page.locator('#eventRecordIgnoreOperators').uncheck();
  await page.locator('#eventRecordStartButton').click();await until(page,async()=>(await page.locator('#eventRecordStartButton').textContent()).includes('Stop'),'Event session starts');
  await page.locator('#eventRecordStopButton').click();await until(page,async()=>(await transport(page)).event.includes('REC'),'Event take records');
  await page.keyboard.down('a');await keyState(page,'a',true);await pause(250);
  for(const mask of [14,12,8,0,8,15]){await setMask(page,mask);await keyState(page,'a',true);await pause(170);}
  await page.keyboard.up('a');await pause(200);await page.locator('#eventRecordStopButton').click();
  await until(page,async()=>(await page.locator('#eventRecordPlayButton').textContent()).includes('Stop'),'Event recording loops');
  const recording=await exportEvent(page);assert.equal(recording.format,'tetorica-fm2612-synth-recording-v1');
  const toggles=recording.commands.filter(command=>command.type==='capturedKeyMask');
  assert.deepEqual(toggles.map(command=>command.voice.keyMask),[14,12,8,0,8,9,11,15],'Each OP gesture is recorded, including all-Off and return to all-On');
  assert(toggles.every(command=>!('block'in command)&&!('fnum'in command)),'Recorded mask changes contain no pitch reset');
  await stopEvent(page);return recording;
}
async function checkImportedEvent(browser,origin,recording) {
  const {page,errors}=await openPage(browser,origin);
  try {
    await page.locator('#eventRecordIgnoreOperators').uncheck();await page.locator('#eventRecordStartButton').click();await page.locator('#eventRecordStartButton').click();
    await page.locator('#eventRecordImportInput').setInputFiles({name:'Gate.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recording))});
    await until(page,async()=>(await transport(page)).status.includes('Imported event recording'),'Event import');
    assert.deepEqual(await exportEvent(page),recording,'Export/import retains each OP gate command exactly');
    await drainWrites(page);await page.locator('#eventRecordPlayButton').click();await pause((recording.durationSeconds+.3)*1000);
    const writes=await drainWrites(page),keys=writes.filter(item=>item.port===0&&item.register===0x28).map(item=>item.value>>4);
    for(const mask of [14,12,8,0,9,11,15])assert(keys.includes(mask),'Imported playback reaches hardware mask '+mask);
    assert((await audit(page)).every(meter=>meter.finite&&meter.muted),'Playback remains finite and physical output muted');
    const invalid=structuredClone(recording);invalid.commands.find(command=>command.type==='capturedKeyMask').voice.keyMask=16;
    await page.locator('#eventRecordImportInput').setInputFiles({name:'Invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
    await until(page,async()=>(await transport(page)).status.includes('Failed to import'),'Invalid mask rejects');
    assert.deepEqual(await exportEvent(page),recording,'A bad mask preserves the valid recording');
    await stopEvent(page);assert.equal(await gateMask(page),15,'Playback stops at the original editable all-On state');assert.deepEqual(errors,[]);
    return {commands:recording.commands.length,keyMasks:keys};
  } finally {await bounded(page.close(),'close imported gates');}
}
async function checkLoop(page) {
  const hz=await keyboardHz(page);await setMask(page,15);
  await page.locator('#looperStartButton').click();await until(page,async()=>(await page.locator('#looperStartButton').textContent()).includes('Stop'),'Looper starts');
  await page.locator('#looperRecordButton').click();await until(page,async()=>(await transport(page)).looper.includes('Recording'),'Loop capture starts');
  await page.keyboard.down('a');await keyState(page,'a',true);await actualMask(page,hz,15);await pause(100);
  await setMask(page,0);await keyState(page,'a',true);await actualMask(page,hz,0);await pause(100);
  await setMask(page,8);await keyState(page,'a',true);await actualMask(page,hz,8);await pause(150);
  await page.keyboard.up('a');await pause(200);await page.locator('#looperRecordButton').click();
  await until(page,async()=>(await transport(page)).looper.includes('Loop(1)'),'Loop saved');
  const snapshots=[];for(let index=0;index<45;index++){snapshots.push(await carrierLevels(page,hz));await pause(60);}
  assert(snapshots.some(levels=>levels.every(level=>level>.0002)),'Recorded loop contains the initial all-OP sound');
  assert(snapshots.some(levels=>levels.every(level=>level<.00004)),'Recorded loop contains the all-Off section');
  assert(snapshots.some(levels=>levels[3]>.0002&&levels.slice(0,3).every(level=>level<.00004)),'Recorded loop contains the re-enabled OP4-only section');
  await page.locator('#looperStartButton').click();await silence(page);await page.locator('#looperClearButton').click();await setMask(page,15);
  return {sampleWindows:snapshots.length};
}
async function checkLive(page) {
  await page.locator('#synthSongSelect').selectOption('/vgm/Gates.vgm');await page.locator('#synthSongChannelSelect').selectOption('0');
  await page.locator('#synthSongPlayButton').click();await state(page,'playing');
  await until(page,async()=>(await gateMask(page))===8,'Live shows source OP4 only');
  for(let op=1;op<=4;op++)assert.equal(await gate(page,op).isDisabled(),true,'Live OP mask is read-only');
  await until(page,async()=>(await gateMask(page))===0,'Live shows the actual all-Off gate, rather than its last nonzero mask');
  await page.locator('#synthSongPlayButton').click();await state(page,'paused');
  assert.equal(await gateMask(page),0,'Pause freezes the actual source gate state');
  await page.locator('#synthSongCopyButton').click();await ready(page);await until(page,async()=>(await transport(page)).target==='synth','Copy selects Synth');
  assert.equal(await gateMask(page),8,'Copy between notes uses the last sounding OP mask for audition');
  await gate(page,1).click();assert.equal(await gateMask(page),9,'Copied gate masks are editable through the same controls');
  await page.locator('#synthSongStopButton').click();await selectTone(page,'sine');assert.equal(await gateMask(page),15);
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
async function checkBrowser(browser,name,origin) {
  const {page,errors}=await openPage(browser,origin),steps=[];
  try {
    assert.equal(await gateMask(page),15,'Initial built-in tone enables all four operators');
    await page.locator('#tfiFile').setInputFiles([{name:'Gate.vgi',mimeType:'application/octet-stream',buffer:diagnosticVgi()},
      {name:'Gates.vgm',mimeType:'application/octet-stream',buffer:gateSong()}]);await ready(page);
    await until(page,async()=>(await ui(page)).path.endsWith('Gate.vgi'),'Ordinary diagnostic VGI imported');
    // Importing a reference also exposes its default CH1 observation target.
    // Normal instrument tests explicitly choose the editable Synth, as a user
    // does before playing their imported VGI; the hidden file input must not
    // retain keyboard focus after a synthetic file-selection event either.
    await selectEditableSynth(page);
    if(await page.locator('#synthFilesPanel').isVisible())await page.locator('#synthFilesToggle').click();
    // The first trusted key prepares WASM/worklet asynchronously; the input
    // controller deliberately asks for a fresh key afterward rather than
    // leaving a note held across initialization.
    await page.keyboard.press('a');
    await until(page,async()=>(await transport(page)).status.includes('Audio ready'),'Audio prepared by the first gesture');
    await page.keyboard.up('a');
    const held=await checkHeldGates(page);steps.push('normal instruments expose all OP gates, keep round robin, edit held voices using mask-only writes, and re-enable a silently held note');
    const persistence=await checkPersistence(page);steps.push('all-Off survives auto-save, Reload and Cassette; Sync/Revert restore gate masks; legacy instruments default to all-On');
    const loop=await checkLoop(page);steps.push('actual recorded loop PCM retains full, silent, and OP4-only sections after held gate edits');
    const recording=await checkEventRecord(page),imported=await checkImportedEvent(browser,origin,recording);steps.push('Event Rec preserves in-note gate changes, 0 and 15, exports/imports exactly, replays chip writes, and rejects invalid masks atomically');
    await checkLive(page);steps.push('source Live shows the actual current mask, including all-Off, with disabled controls; copied sounds edit through the same buttons');
    const layouts=[];
    if(config.screenshots)await fs.mkdir(config.screenshots,{recursive:true});
    for(const width of [1240,390]){
      await page.setViewportSize({width,height:1100});const layout=await evaluate(page,()=>({viewport:innerWidth,
        rows:[...document.querySelectorAll('#operatorControls .operator-row')].map(row=>{const rect=row.getBoundingClientRect(),button=row.querySelector('[data-operator-gate]'),b=button.getBoundingClientRect();
          return {height:rect.height,buttonHeight:b.height,buttonWidth:b.width,buttonLeft:b.left,rowLeft:rect.left,first:row.firstElementChild===button};})}));
      assert.equal(layout.rows.length,4);assert(layout.rows.every(row=>row.first&&row.buttonHeight<=32&&row.height<=45&&row.buttonLeft>=0),'Numeric gate buttons occupy the existing small row label');
      layouts.push(layout);if(config.screenshots)await page.screenshot({path:path.join(config.screenshots,`${name}-operator-gates-${width}.png`)});
    }
    assert.deepEqual(errors,[]);assert((await audit(page)).every(meter=>meter.muted&&meter.finite));
    return {browser:name,steps,held,persistence,loop,imported,layouts,physicalOutputMuted:true};
  }catch(error){console.error(JSON.stringify({browser:name,steps,transport:await transport(page).catch(()=>null),mask:await gateMask(page).catch(()=>null),ui:await ui(page).catch(()=>null),errors}));throw error;}
  finally{await bounded(page.close(),'close OP gates');}
}

if(require.main===module)(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  try{for(const name of engines){const browser=await bounded(({chromium,webkit})[name].launch({headless:true}),'launch '+name);
    try{results.push(await checkBrowser(browser,name,origin));console.log('PASS '+name+': editable OP gates, actual audio, persistence, recording and Live');}
    finally{await bounded(browser.close(),'close '+name);}}}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  assert.deepEqual(missing,[]);assert.deepEqual(external,[]);const report={passed:true,physicalOutputMuted:true,listeningPerformed:false,results,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');
  console.log('PASS '+results.length+' browsers; receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
