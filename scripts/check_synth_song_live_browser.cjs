// Exercise the published FM2612 controls as an audible-time VGM view.
// The real chip engines run; every physical output is metered and muted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {root:path.join(repository, 'docs'), entry:'/synth/index.html', engines:'chromium,webkit',
  out:'/private/tmp/fm2612-synth-song-live-browser.json', screenshots:null};
for (const argument of process.argv.slice(2)) {
  const match = /^--(root|entry|engines|out|screenshots)=(.+)$/.exec(argument);
  assert(match, 'Unknown option ' + argument); config[match[1]] = match[2];
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/'));
const engines = config.engines.split(',');
assert(engines.every(name => ['chromium','webkit'].includes(name)));
const RATE = 53267, CLOCK = 7670454;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(task, label, ms=25000) {
  let timer;
  try { return await Promise.race([task, new Promise((_,reject) => {timer=setTimeout(() => reject(new Error('Timed out: '+label)), ms);})]); }
  finally { clearTimeout(timer); }
}
const evaluate = (page, callback, arg) => bounded(page.evaluate(callback, arg), 'page evaluation');

function buildVgm(commands, seconds) {
  const bytes=Buffer.alloc(256+commands.length),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,204,true);view.setUint32(0x18,Math.round(seconds*44100),true);view.setUint32(0x2c,CLOCK,true);
  bytes.set(commands,256);return bytes;
}
function wait(commands,seconds) {
  let frames=Math.round(seconds*44100);
  while(frames){const count=Math.min(frames,65535);commands.push(0x61,count&255,count>>8);frames-=count;}
}
const write=(commands,register,value,port=0)=>commands.push(port?0x53:0x52,register,value);
function pitch(commands,channel,hz) {
  const block=4,fnum=Math.round(hz*144*2**20/(CLOCK*2**(block-1))),port=channel>2?1:0,index=channel%3;
  write(commands,0xa4+index,(block<<3)|(fnum>>8),port);write(commands,0xa0+index,fnum&255,port);
}
function channel(commands,number,{algorithm=7,feedback=0,tl=[127,125,123,48],ar=[31,29,27,25],pan=0xc0}={}) {
  const port=number>2?1:0,index=number%3;
  write(commands,0xb0+index,(feedback<<3)|algorithm,port);write(commands,0xb4+index,pan,port);
  // Logical OP1/OP2/OP3/OP4 order differs from the physical register slots.
  for(const[operator,offset]of[0,8,4,12].entries()) {
    write(commands,0x30+offset+index,operator+1,port);
    write(commands,0x40+offset+index,tl[operator],port);
    write(commands,0x50+offset+index,ar[operator],port);
    write(commands,0x60+offset+index,0,port);write(commands,0x70+offset+index,0,port);
    write(commands,0x80+offset+index,15,port);write(commands,0x90+offset+index,0,port);
  }
}
function timedSong() {
  const commands=[];
  write(commands,0x22,0);write(commands,0x27,0);write(commands,0x2b,0);
  channel(commands,0);channel(commands,1,{algorithm:4,feedback:2,tl:[126,124,122,54],ar:[24,22,20,18],pan:0});
  // CH4 is a distinct, single-carrier MULTI2 tone. Remember its partial KON
  // mask even though it is released before any song audio is generated.
  channel(commands,3,{algorithm:7,feedback:0,tl:[127,127,127,32],ar:[31,31,31,31]});
  write(commands,0x3c,2,1);pitch(commands,3,330);write(commands,0x28,0x84);write(commands,0x28,4);
  // One audible carrier, with multiplier1 for an unambiguous A4/A3 reference.
  write(commands,0x3c,1);pitch(commands,0,440);pitch(commands,1,660);
  write(commands,0x28,0xf0);write(commands,0x28,0xf1);
  wait(commands,2);
  write(commands,0xb0,(6<<3)|5);write(commands,0x4c,40);write(commands,0x5c,20);write(commands,0x22,0x0b);
  pitch(commands,0,220);
  wait(commands,12);write(commands,0x28,0);write(commands,0x28,1);commands.push(0x66);
  return buildVgm(commands,14);
}
function otherSong({short=false,special=false,csm=false}={}) {
  const commands=[];write(commands,0x22,0);write(commands,0x27,csm?0x80:special?0x40:0);write(commands,0x2b,special?0x80:0);
  channel(commands,0,{algorithm:6,feedback:3,tl:[127,126,125,60],ar:[30,28,26,24]});write(commands,0x3c,1);
  pitch(commands,0,330);write(commands,0x28,0xf0);
  if(special||csm){
    channel(commands,2,{algorithm:7,feedback:1,tl:[127,127,127,64],ar:[31,30,29,28]});
    for(const[low,high,block,fnum]of[[0xa9,0xad,2,321],[0xaa,0xae,3,654],[0xa8,0xac,4,987],[0xa2,0xa6,5,1111]]){
      write(commands,high,(block<<3)|(fnum>>8));write(commands,low,fnum&255);
    }
    write(commands,0x28,0xf2);
  }
  wait(commands,short ? .25 : 8);write(commands,0x28,0);commands.push(0x66);
  return buildVgm(commands,short ? .25 : 8);
}

function installAudit() {
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect;
  const getTime=AnalyserNode.prototype.getFloatTimeDomainData,getSpectrum=AnalyserNode.prototype.getFloatFrequencyData;
  const own=new WeakSet(),contexts=[],meters=[],writes=[],monitor={waveReads:0,waveAcRms:0,spectrumReads:0,spectrumPeakDb:-Infinity};
  // Observe actual main-thread -> AudioWorklet commands without exposing app
  // internals. Reference playback uses a separate direct chip engine.
  const post=MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage=function(message,...args){
    for(const command of Array.isArray(message)?message:[message]){
      if(command?.type==='write')writes.push({port:command.port,register:command.register,value:command.value});
      else if(command?.type==='reset')writes.push({reset:true});
    }
    if(writes.length>6000)writes.splice(0,writes.length-6000);
    return post.call(this,message,...args);
  };
  window.AudioContext=new Proxy(Context,{construct(Target,args){const value=Reflect.construct(Target,args);contexts.push(value);return value;}});
  if(window.webkitAudioContext===Context)window.webkitAudioContext=window.AudioContext;
  const acRms=data=>{let sum=0,squares=0;for(const value of data){sum+=value;squares+=value*value;}return Math.sqrt(Math.max(0,squares/data.length-(sum/data.length)**2));};
  AnalyserNode.prototype.getFloatTimeDomainData=function(data){const value=getTime.call(this,data);if(!own.has(this)){monitor.waveReads++;monitor.waveAcRms=acRms(data);}return value;};
  AnalyserNode.prototype.getFloatFrequencyData=function(data){const value=getSpectrum.call(this,data);if(!own.has(this)){monitor.spectrumReads++;monitor.spectrumPeakDb=Math.max(...data);}return value;};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();own.add(analyser);analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);meters.push({context:this.context,analyser,mute});return destination;
  };
  window.__liveAudit={drainWrites(){return writes.splice(0);},read(){return {contexts:contexts.map(context=>context.state),monitor:{...monitor},meters:meters.map(({context,analyser,mute})=>{
    const pcm=new Float32Array(analyser.fftSize);getTime.call(analyser,pcm);let mean=0,peak=0;for(const value of pcm){mean+=value;peak=Math.max(peak,Math.abs(value));}mean/=pcm.length;
    const crossings=[];for(let i=1;i<pcm.length;i++){const a=pcm[i-1]-mean,b=pcm[i]-mean;if(a<=0&&b>0)crossings.push(i-1-a/(b-a));}
    return {muted:mute.gain.value===0,finite:pcm.every(Number.isFinite),peak,acRms:acRms(pcm),frequency:crossings.length>5?context.sampleRate*(crossings.length-1)/(crossings.at(-1)-crossings[0]):0};
  })};}};
}
const audit=page=>evaluate(page,()=>__liveAudit.read());
const drainWrites=page=>evaluate(page,()=>__liveAudit.drainWrites());
const transport=page=>evaluate(page,()=>({state:document.getElementById('synthSongStatus').dataset.state,
  live:document.getElementById('synthSongPlayer').dataset.live,frames:Number(document.getElementById('synthSongPlayer').dataset.consumedFrames),
  channel:document.getElementById('synthSongChannelSelect').value,status:document.getElementById('synthSongLiveStatus')?.textContent??''}));
const controls=page=>evaluate(page,()=>({path:document.getElementById('synthActiveFilePath').textContent,preset:document.getElementById('presetSelect').value,
  common:[...document.querySelectorAll('#commonControls .param-value')].map(node=>[node.getAttribute('aria-label'),node.textContent]),
  operators:[...document.querySelectorAll('#operatorControls .operator-row')].map(row=>[...row.querySelectorAll('.param-value')].map(node=>[node.getAttribute('aria-label'),node.textContent]))}));
const common=(page,label)=>page.locator(`#commonControls .param-value[aria-label="${label}"]`).textContent();
const operator=(page,number,label)=>page.locator(`#operatorControls .param-value[aria-label="${label}"]`).nth(number-1).textContent();
async function until(page,predicate,label,ms=25000){const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await pause(25);}throw new Error(label+'; '+JSON.stringify({transport:await transport(page),controls:await controls(page),audit:await audit(page)}));}
const state=(page,value)=>until(page,async()=>(await transport(page)).state===value,'Expected '+value);
const live=(page,value)=>until(page,async()=>(await transport(page)).live===String(value),'Expected live '+value);
const ready=page=>page.waitForFunction(()=>!document.getElementById('importPresetButton').disabled);
const sound=(page,hz)=>until(page,async()=>(await audit(page)).meters.some(value=>value.finite&&value.acRms>.0001&&Math.abs(value.frequency-hz)<8),'Actual '+hz+' Hz audio');
const keyActive=(page,key,value)=>page.waitForFunction(({key,value})=>document.querySelector(`#keyboard .key[data-key="${key}"]`)?.classList.contains('is-active')===value,{key,value});
const auditionReady=page=>page.waitForFunction(()=>document.getElementById('keyboard').dataset.songAudition==='ready');
async function keyboardFrequency(page,key='a'){
  const pitch=await page.locator(`#keyboard .key[data-key="${key}"] small`).textContent(),match=/b(\d+)\s*\/\s*f(\d+)/.exec(pitch);
  assert(match,'Keyboard exposes its normal BLOCK/FNUM');return Number(match[2])*CLOCK*2**(Number(match[1])-1)/(144*2**20);
}
async function silence(page){await pause(180);await until(page,async()=>(await audit(page)).meters.every(value=>value.acRms<1e-8),'Actual pause/stop silence');}
async function auditionVolume(page,percent){
  await page.locator('#masterVolumeRange').evaluate((range,value)=>{range.value=String(value);range.dispatchEvent(new Event('input',{bubbles:true}));},percent);
  await pause(100);
  const samples=[];for(let i=0;i<6;i++){samples.push(Math.max(0,...(await audit(page)).meters.map(meter=>meter.acRms)));await pause(15);}
  return samples.reduce((sum,value)=>sum+value,0)/samples.length;
}
async function draftFiles(page){return evaluate(page,()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('tetorica-fm2612-synth-drafts',1);request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,get=db.transaction('projects','readonly').objectStore('projects').get('current');get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=async()=>{
    const files=get.result.project.files;db.close();try{const output=await Promise.all(files.map(async file=>{
      const bytes=typeof file.data==='string'?new TextEncoder().encode(file.data):file.data,hash=await crypto.subtle.digest('SHA-256',bytes);
      return {path:file.path,bytes:bytes.byteLength,sha256:[...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('')};
    }));resolve(output.sort((a,b)=>a.path.localeCompare(b.path)));}catch(error){reject(error);}
  };};
}));}
const file=(name,bytes)=>({name,mimeType:'application/octet-stream',buffer:bytes});
async function importFiles(page,files){await page.locator('#tfiFile').setInputFiles(files);await ready(page);}

const served=new Map(),missing=[],external=[],mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer(async(request,response)=>{try{
  const pathname=new URL(request.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
  const name=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(name.startsWith(config.root+path.sep));const bytes=await fs.readFile(name),key=path.relative(config.root,name).split(path.sep).join('/');
  const record={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};if(served.has(key))assert.deepEqual(served.get(key),record,'Source changed during validation');served.set(key,record);
  response.setHeader('Content-Type',mime[path.extname(name)]??'application/octet-stream');response.end(bytes);
}catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}});

async function checkBrowser(browser,name,origin,emptyCassette){
  const page=await browser.newPage({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1240,height:1000}}),errors=[],steps=[];
  page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installAudit);
  try{
    await page.goto(origin+config.entry);await ready(page);
    await importFiles(page,[file('Timed.vgm',timedSong()),file('Other.vgm',otherSong()),file('Special.vgm',otherSong({special:true})),file('CSM.vgm',otherSong({csm:true})),file('Short.vgm',otherSong({short:true}))]);
    assert.equal(await page.locator('#synthSongLiveToggle').isChecked(),true,'Live defaults On');
    assert.deepEqual(await page.locator('#synthSongChannelSelect option').evaluateAll(options=>options.map(option=>option.value)).then(values=>values.sort()),['0','1','2','3','4','5','synth']);
    assert.deepEqual((await audit(page)).contexts,[],'Import and channel controls do not auto-play');
    await page.locator('#synthSongSelect').selectOption('/vgm/Timed.vgm');
    await page.locator('#presetSelect').selectOption('sine');await ready(page);
    const feedback=page.locator('#commonControls .param-value[aria-label="FB"]');
    await feedback.locator('..').locator('.param-button').last().click();await ready(page);
    await until(page,async()=>(await controls(page)).path.startsWith('/presets/'),'Edited working tone materialized');
    await pause(650);const original=await controls(page),originalFiles=await draftFiles(page);
    assert.equal(original.operators.length,4,'The same four operator rows are present');
    await page.locator('[data-visual-mode="waveform"]').click();
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await live(page,true);
    await until(page,async()=>await common(page,'ALGO')==='7'&&await operator(page,4,'TL')==='48','Initial live CH1 parameters');
    assert.equal(await operator(page,2,'TL'),'125');assert.equal(await operator(page,3,'TL'),'123');
    assert.equal(await operator(page,4,'AR'),'25');await sound(page,440);
    await until(page,async()=>(await audit(page)).monitor.waveReads>0&&(await audit(page)).monitor.waveAcRms>.0001,'Reference PCM reaches the visible waveform analyser');
    const timing=await evaluate(page,async rate=>{
      const rows=[];let attempts=0;
      while(attempts++<500){const frame=Number(document.getElementById('synthSongPlayer').dataset.consumedFrames);
        if(frame>=1.7*rate)rows.push({frame,algorithm:document.querySelector('#commonControls .param-value[aria-label="ALGO"]').textContent,tl:[...document.querySelectorAll('#operatorControls .param-value[aria-label="TL"]')][3].textContent});
        if(frame>2.16*rate)break;await new Promise(resolve=>setTimeout(resolve,10));
      }
      return rows;
    },RATE);
    const before=timing.filter(row=>row.frame>=1.8*RATE&&row.frame<1.96*RATE),after=timing.filter(row=>row.frame>2.08*RATE);
    assert(before.length>1&&before.every(row=>row.algorithm==='7'&&row.tl==='48'),'UI must not expose a prefetched future write');
    assert(after.length>1&&after.every(row=>row.algorithm==='5'&&row.tl==='40'),'UI follows the actual consumed transition');
    await sound(page,220);assert.equal(await common(page,'FB'),'6');assert.equal(await common(page,'LFO'),'ON');assert.equal(await common(page,'LFOF'),'3');
    // Playing-channel interaction is verified against the real reference
    // engine by check_synth_song_manual_browser.cjs. Do not replace the song's
    // currently held A3 here: the checks below deliberately retain that note.
    assert.equal(await page.locator('#keyboard').getAttribute('data-song-audition'),'live','Playing YM2612 channels allow manual intervention on the same chip');
    steps.push('actual A4→A3 audio and live ALGO/TL/AR/LFO changes at consumed time, not render-ahead');

    await page.locator('#synthSongPlayButton').click();await state(page,'paused');await silence(page);
    const paused=await transport(page),frozen=await controls(page);await pause(180);assert.equal((await transport(page)).frames,paused.frames);assert.deepEqual(await controls(page),frozen);
    const keyboardHz=await keyboardFrequency(page);
    await drainWrites(page);await page.locator('#synthSongChannelSelect').selectOption('3');
    await until(page,async()=>await common(page,'ALGO')==='7'&&await operator(page,4,'TL')==='32','Paused CH4 tone');
    assert.equal(await operator(page,4,'MULTI'),'2');
    await auditionReady(page);const configuredWrites=await drainWrites(page);
    assert(configuredWrites.some(write=>write.port===1&&write.register===0x3c&&write.value===2),'CH4 patch writes reach the actual keyboard chip');
    await page.keyboard.down('a');await keyActive(page,'a',true);await sound(page,keyboardHz*2);
    const auditionWrites=await drainWrites(page);
    assert(auditionWrites.some(write=>write.port===0&&write.register===0x28&&write.value===0x84),'Released CH4 retriggers only its remembered OP4 KON mask on hardware CH4');
    const auditionTone=await controls(page),auditionGain={};
    auditionGain[100]=await auditionVolume(page,100);assert(auditionGain[100]>.0001,'Audition baseline is audible before testing volume');
    auditionGain[0]=await auditionVolume(page,0);await silence(page);assert(auditionGain[0]<1e-8,'Master zero mutes the dedicated audition output');
    for(const percent of[200,380]){
      auditionGain[percent]=await auditionVolume(page,percent);
      assert(Math.abs(auditionGain[percent]/auditionGain[100]-percent/100)<.10,'Master applies once to paused audition at '+percent+'%');
    }
    await auditionVolume(page,100);await sound(page,keyboardHz*2);await keyActive(page,'a',true);
    assert.deepEqual(await controls(page),auditionTone,'Master gain does not change the frozen tone');
    assert.equal((await transport(page)).frames,paused.frames,'Audition never advances song transport');
    await page.locator('#synthSongChannelSelect').selectOption('0');await keyActive(page,'a',false);await silence(page);await page.keyboard.up('a');
    steps.push('paused keyboard uses the selected hardware channel, actual MULTI2 PCM and remembered partial KON mask; Master 0/100/200/380 applies once; switching target silences held notes');

    await page.locator('#synthSongChannelSelect').selectOption('1');
    await until(page,async()=>await common(page,'ALGO')==='4'&&await operator(page,4,'TL')==='54','CH2 live view');
    assert.equal(await common(page,'FB'),'2');assert.equal(await operator(page,4,'AR'),'18');
    assert.notEqual(await page.evaluate(()=>document.activeElement.id),'synthSongChannelSelect','Channel selection releases performance focus');
    const frozenCh2=await controls(page);
    await page.locator('#synthSongLiveToggle').uncheck();await live(page,true);assert.deepEqual(await controls(page),frozenCh2,'Live Off holds the observed channel rather than replacing it with the editor');
    await pause(650);assert.deepEqual(await draftFiles(page),originalFiles,'Live display never writes edited tone or sidecar bytes');
    await page.locator('#synthSongChannelSelect').selectOption('synth');await live(page,false);assert.deepEqual(await controls(page),original);
    await page.keyboard.down('a');await keyActive(page,'a',true);await sound(page,keyboardHz);
    await page.locator('#synthSongChannelSelect').selectOption('3');await keyActive(page,'a',false);await silence(page);await page.keyboard.up('a');
    await auditionReady(page);
    assert.equal(await operator(page,4,'MULTI'),'2','Paused CH switching still reads the frozen instant with Live Off');
    await page.locator('#synthSongLiveToggle').check();await live(page,true);
    await page.locator('#synthSongChannelSelect').selectOption('0');await until(page,async()=>await common(page,'ALGO')==='5','Frozen CH1 returns without re-rendering the song');
    await page.locator('#synthSongChannelSelect').selectOption('3');await auditionReady(page);await page.keyboard.down('a');await keyActive(page,'a',true);await sound(page,keyboardHz*2);
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await sound(page,220);
    await keyActive(page,'a',false);await page.keyboard.up('a');
    await until(page,async()=>(await transport(page)).frames>paused.frames,'Resume advances live playback');
    await page.locator('#synthSongChannelSelect').selectOption('0');
    await page.locator('[data-visual-mode="spectrum"]').click();
    await until(page,async()=>(await audit(page)).monitor.spectrumReads>0&&(await audit(page)).monitor.spectrumPeakDb>-70,'Reference PCM reaches the visible spectrum analyser');
    steps.push('Synth restores original editor and real keyboard audio; Live Off freezes the observation; Resume stops audition and continues the original song without VFS writes');

    await page.locator('#synthSongSelect').selectOption('/vgm/Other.vgm');await state(page,'stopped');await live(page,false);await silence(page);assert.deepEqual(await controls(page),original);
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await live(page,true);
    await until(page,async()=>await common(page,'ALGO')==='6'&&await operator(page,4,'TL')==='60','New source live view');
    await page.locator('#synthSongPlayButton').click();await state(page,'paused');await auditionReady(page);
    await page.keyboard.down('a');await keyActive(page,'a',true);await sound(page,keyboardHz);
    await page.locator('#synthSongStopButton').click();await state(page,'stopped');await live(page,false);await keyActive(page,'a',false);await silence(page);await page.keyboard.up('a');assert.deepEqual(await controls(page),original);
    await page.locator('#synthSongSelect').selectOption('/vgm/Special.vgm');await page.locator('#synthSongChannelSelect').selectOption('2');
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await live(page,true);
    await until(page,async()=>await common(page,'DAC')==='ON'&&(await page.locator('#channel3SpecialControls .param-value[aria-label="MODE"]').textContent())==='ON','Global DAC and CH3 special mode in the existing controls');
    for(const[index,fnum]of[321,654,987,1111].entries())assert.equal(await page.locator(`#channel3SpecialControls .param-value[aria-label="OP${index+1}F"]`).textContent(),String(fnum));
    await page.locator('#synthSongPlayButton').click();await state(page,'paused');await auditionReady(page);await silence(page);await drainWrites(page);
    await page.keyboard.down('a');await keyActive(page,'a',true);await sound(page,keyboardHz*4);
    const specialWrites=await drainWrites(page),registers={};for(const write of specialWrites)if(write.port===0)registers[write.register]=write.value;
    const specialPitch=[[0xa9,0xad],[0xaa,0xae],[0xa8,0xac],[0xa2,0xa6]].map(([lo,hi])=>{
      assert(Number.isInteger(registers[lo])&&Number.isInteger(registers[hi]),'All four special pitches are written when a key is pressed');
      return (((registers[hi]&7)<<8)|registers[lo])*2**((registers[hi]>>3)&7);
    });
    for(const[index,unit]of[321*4,654*8,987*16,1111*32].entries())assert(Math.abs(specialPitch[index]/specialPitch[3]-unit/(1111*32))<.004,'CH3 retains all operator frequency ratios');
    await page.locator('#synthSongChannelSelect').selectOption('5');await keyActive(page,'a',false);await silence(page);await page.keyboard.up('a');
    await until(page,async()=>/DAC.*unavailable/i.test((await transport(page)).status),'DAC snapshot explains unavailable FM audition');
    await drainWrites(page);await page.keyboard.down('a');await pause(80);assert.equal(await page.locator('#keyboard .key[data-key="a"]').evaluate(node=>node.classList.contains('is-active')),false);await page.keyboard.up('a');
    assert.equal((await drainWrites(page)).filter(write=>write.register===0x28&&(write.value&0xf0)).length,0,'DAC view must not secretly audition an FM patch');
    await page.locator('#synthSongStopButton').click();await state(page,'stopped');await live(page,false);assert.deepEqual(await controls(page),original);
    assert.equal(await page.locator('#channel3SpecialControls .param-value[aria-label="MODE"]').textContent(),'OFF','Live CH3 mode is not adopted by the editable instrument');
    await page.locator('#synthSongSelect').selectOption('/vgm/CSM.vgm');await page.locator('#synthSongChannelSelect').selectOption('2');
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await live(page,true);await page.locator('#synthSongPlayButton').click();await state(page,'paused');
    await until(page,async()=>/CSM.*unavailable/i.test((await transport(page)).status),'CSM snapshot explains unavailable timer-based keyboard audition');
    await drainWrites(page);await page.keyboard.down('a');await pause(80);await page.keyboard.up('a');await silence(page);
    assert.equal((await drainWrites(page)).filter(write=>write.register===0x28&&(write.value&0xf0)).length,0,'CSM timing is not replaced by a fabricated manual KON');
    await page.locator('#synthSongStopButton').click();await state(page,'stopped');await live(page,false);assert.deepEqual(await controls(page),original);
    steps.push('Stop kills paused audition, CH3 special keyboard preserves four frequency ratios, and DAC/CSM explain unavailable auditions');

    await page.locator('#synthSongChannelSelect').selectOption('0');await page.locator('#synthSongSelect').selectOption('/vgm/Short.vgm');
    await page.locator('#synthSongPlayButton').click();await state(page,'ended');await live(page,false);await silence(page);assert.deepEqual(await controls(page),original);
    await pause(650);assert.deepEqual(await draftFiles(page),originalFiles,'Completion still leaves all stored files unchanged');
    await page.locator('#synthSongChannelSelect').selectOption('1');assert.notEqual(await page.evaluate(()=>document.activeElement.id),'synthSongChannelSelect');
    await page.keyboard.down('a');await page.waitForFunction(()=>document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
    await page.keyboard.up('a');await page.waitForFunction(()=>!document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
    await page.locator('#synthSongChannelSelect').selectOption('0');await page.locator('#synthSongSelect').selectOption('/vgm/Timed.vgm');await page.locator('#synthSongPlayButton').click();await state(page,'playing');await live(page,true);
    await until(page,async()=>await common(page,'ALGO')==='7','Fresh playback begins with the initial tone');
    await page.locator('#synthSongLiveToggle').uncheck();await live(page,true);const heldView=await controls(page);
    await until(page,async()=>(await transport(page)).frames>2.2*RATE,'Song advances past the programmed tone change with automatic following Off');await sound(page,220);
    assert.deepEqual(await controls(page),heldView,'Automatic following Off freezes the last observed settings while the song advances');
    assert.match((await transport(page)).status,/Frozen/);
    await page.locator('#synthSongChannelSelect').selectOption('synth');await live(page,false);assert.deepEqual(await controls(page),original);
    await drainWrites(page);await page.keyboard.down('a');await keyActive(page,'a',true);await page.keyboard.up('a');await keyActive(page,'a',false);
    assert.equal((await transport(page)).state,'playing','Synth keyboard does not stop the reference song');
    await page.locator('#synthSongLiveToggle').check();await page.locator('#synthSongChannelSelect').selectOption('0');await live(page,true);
    await until(page,async()=>await common(page,'ALGO')==='5','Automatic following resumes at the actual current song state');
    await pause(650);assert.deepEqual(await draftFiles(page),originalFiles,'Auditions and target changes preserve all original VFS bytes');
    steps.push('Live Off freezes during actual song changes, Synth remains playable, and Live On catches up without rewriting files');
    if(config.screenshots){await fs.mkdir(config.screenshots,{recursive:true});for(const width of[1240,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(config.screenshots,`${name}-live-${width}.png`)});}}
    await page.locator('#cassetteImportInput').setInputFiles({name:'Empty.cassette.zip',mimeType:'application/zip',buffer:emptyCassette});await ready(page);await live(page,false);
    assert.equal(await page.locator('#synthSongPlayer').isVisible(),false);assert.match((await controls(page)).path,/Built-in/);assert.equal(await page.locator('#synthSongLiveToggle').isChecked(),true);
    assert.deepEqual(errors,[]);assert((await audit(page)).meters.every(value=>value.muted));
    steps.push('natural completion, keyboard focus, responsive view and Cassette replacement cleanup');
    return {browser:name,steps,boundarySamples:{before,after},pausedFrames:paused.frames,auditionGain,storedFileCount:originalFiles.length,physicalOutputMuted:true};
  }catch(error){console.error(JSON.stringify({browser:name,steps,transport:await transport(page).catch(()=>null),controls:await controls(page).catch(()=>null),audit:await audit(page).catch(()=>null),errors}));throw error;}
  finally{await bounded(page.close(),'close live-view page');}
}

(async()=>{
  const {createPlaygroundCassetteZip}=await import(pathToFileURL(path.join(repository,'docs/playground/playground_cassette.js')));
  const emptyCassette=Buffer.from(createPlaygroundCassetteZip([],{directories:['/presets']}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  try{for(const name of engines){const browser=await bounded(({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})}),'launch '+name);try{results.push(await checkBrowser(browser,name,origin,emptyCassette));console.log('PASS '+name+': audible-time live controls, channel changes and editor/VFS preservation');}finally{await bounded(browser.close(),'close '+name);}}}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
  const report={passed:true,physicalOutputMuted:true,listeningPerformed:false,results,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');
  console.log('PASS '+results.length+' live-view browsers; receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
