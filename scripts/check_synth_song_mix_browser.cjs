// Published Synth UI: source-only mute/solo and explicit VGM -> new instrument.
// All source music is generated here. Real chip PCM is metered and muted at
// every speaker edge; no human listening or copyrighted fixture is implied.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {chromium, webkit} = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {root:path.join(repository,'docs'), entry:'/synth/index.html', engines:'chromium,webkit',
  out:'/private/tmp/fm2612-synth-song-mix-browser.json', screenshots:null};
for (const argument of process.argv.slice(2)) {
  const match = /^--(root|entry|engines|out|screenshots)=(.+)$/.exec(argument);
  assert(match, 'Unknown option '+argument); config[match[1]] = match[2];
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/'));
const engines = config.engines.split(',');
assert(engines.every(name => ['chromium','webkit'].includes(name)));
const CLOCK=7670454, RATE=53267, PSG_CLOCK=3579545, RF_CLOCK=12500000;
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
async function bounded(task,label,ms=25000) {
  let timer;
  try {return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timed out: '+label)),ms);})]);}
  finally {clearTimeout(timer);}
}
const evaluate = (page,callback,arg) => bounded(page.evaluate(callback,arg),'browser evaluation');
const u32 = value => [value&255,(value>>8)&255,(value>>16)&255,(value>>>24)&255];
const write = (commands,register,value,port=0) => commands.push(port?0x53:0x52,register,value);
const rfWrite = (commands,register,value) => commands.push(0xb1,register,value);
const pwmWrite = (commands,register,value) => commands.push(0xb2,(register<<4)|((value>>8)&15),value&255);
function wait(commands,seconds) {
  let frames=Math.round(seconds*44100);
  while(frames) {const count=Math.min(frames,65535);commands.push(0x61,count&255,count>>8);frames-=count;}
}
function vgm(commands,{psg=false,rf=false,pwm=false,seconds=90}={}) {
  const bytes=Buffer.alloc(256+commands.length),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,204,true);view.setUint32(0x18,Math.round(seconds*44100),true);view.setUint32(0x2c,CLOCK,true);
  if(psg)view.setUint32(0x0c,PSG_CLOCK,true);
  if(rf)view.setUint32(0x6c,RF_CLOCK,true);
  if(pwm)view.setUint32(0x70,23011361,true);
  bytes.set(commands,256);return bytes;
}
function fmChannel(commands,channel,hz,{multi=1,tl=42,algorithm=7,feedback=0,mask=8,pan=0xc0}={}) {
  const port=channel>=3?1:0,offset=channel%3;
  write(commands,0xb0+offset,(feedback<<3)|algorithm,port);write(commands,0xb4+offset,pan,port);
  for(const [operator,slot] of [0,8,4,12].entries()) {
    write(commands,0x30+slot+offset,operator===3?multi:1,port);
    write(commands,0x40+slot+offset,operator===3?tl:127,port);
    write(commands,0x50+slot+offset,31,port);write(commands,0x60+slot+offset,0,port);
    write(commands,0x70+slot+offset,0,port);write(commands,0x80+slot+offset,15,port);
    write(commands,0x90+slot+offset,0,port);
  }
  let block=4,rawFnum=hz*144*2**20/(CLOCK*2**(block-1));
  while(rawFnum>2047&&block<7){rawFnum/=2;block++;}
  const fnum=Math.round(rawFnum);
  assert(fnum>=0&&fnum<=2047,'Fixture pitch fits the physical FNUM field');
  write(commands,0xa4+offset,(block<<3)|(fnum>>8),port);write(commands,0xa0+offset,fnum&255,port);
  write(commands,0x28,(mask<<4)|(channel%3)|(channel>=3?4:0));
  return fnum*CLOCK*2**(block-1)/(144*2**20)*multi;
}

function mixedSong() {
  const commands=[],tones=[];
  write(commands,0x22,0);write(commands,0x27,0);write(commands,0x2b,0);
  [261,391,587,879,1318,1568].forEach((hz,channel)=>tones.push({id:`ym2612:${channel}`,hz:fmChannel(commands,channel,hz)}));
  [181,311,457].forEach((hz,channel)=>{
    const period=Math.round(PSG_CLOCK/(32*hz));
    commands.push(0x50,0x80|(channel<<5)|(period&15),0x50,(period>>4)&63,0x50,0x90|(channel<<5)|12);
    tones.push({id:`psg:${channel}`,hz:PSG_CLOCK/(32*period)});
  });
  commands.push(0x50,0xe4,0x50,0xfc); // White noise, explicit audible level.
  tones.push({id:'psg:3',noise:true});
  rfWrite(commands,7,0x80);
  const wave=Array.from({length:32},(_,i)=>{const value=Math.sin(2*Math.PI*i/32);return Math.round(Math.abs(value)*18)|(value>=0?128:0);});
  // Steps above one source sample can jump over a one-byte loop marker.
  // Pad the marker region so every voice reaches 0xff before leaving the bank.
  const guardedWave=[...wave,...Array(8).fill(0xff)];
  commands.push(0x67,0x66,0xc1,...u32(guardedWave.length+2),0,0,...guardedWave);
  [533,679,821,953,1093,1237,1381,1543].forEach((hz,channel)=>{
    const step=Math.round(hz*32*2048*384/RF_CLOCK);
    rfWrite(commands,7,0xc0|channel);
    for(const [register,value] of [[0,48],[1,0xff],[2,step&255],[3,step>>8],[4,0],[5,0],[6,0]])rfWrite(commands,register,value);
    tones.push({id:`pcm:${channel}`,hz:RF_CLOCK/(384*Math.ceil(32*2048/step))});
  });
  rfWrite(commands,8,0);
  const length=200;
  const words=[...Array.from({length},(_,i)=>522+Math.round(75*Math.sin(2*Math.PI*2*i/length))),
    ...Array.from({length},(_,i)=>522+Math.round(65*Math.sin(2*Math.PI*3*i/length)))];
  const data=words.flatMap(value=>[value&255,value>>8]);
  commands.push(0x67,0x66,3,...u32(data.length),...data);pwmWrite(commands,0,0x305);pwmWrite(commands,1,1045);pwmWrite(commands,4,522);
  for(const [stream,register,start] of [[1,2,0],[2,3,length*2]]) {
    commands.push(0x90,stream,0x11,0,register,0x91,stream,3,1,0,0x92,stream,...u32(22050));
    commands.push(0x93,stream,...u32(start),0x81,...u32(length));
  }
  tones.push({id:'pwm:0',hz:220.5,side:0},{id:'pwm:1',hz:330.75,side:1});
  wait(commands,90);commands.push(0x66);
  return {bytes:vgm(commands,{psg:true,rf:true,pwm:true}),tones};
}
function copySong({special=false,csm=false}={}) {
  const commands=[];write(commands,0x22,0x0b);write(commands,0x27,csm?0x80:special?0x40:0);write(commands,0x2b,0);
  fmChannel(commands,3,330,{multi:2,tl:29,algorithm:7,feedback:3});
  write(commands,0x28,4); // Release before pause; partial OP4 mask must survive.
  if(special||csm) {
    fmChannel(commands,2,330,{multi:1,tl:34});
    for(const [low,high,block,fnum] of [[0xa9,0xad,3,1000],[0xaa,0xae,4,1500],[0xa8,0xac,5,1000],[0xa2,0xa6,4,1000]]) {
      write(commands,high,(block<<3)|(fnum>>8));write(commands,low,fnum&255);
    }
    write(commands,0x28,2);
  }
  wait(commands,30);commands.push(0x66);return vgm(commands,{seconds:30});
}
function dacSong() {
  const commands=[0x52,0x2b,0x80,0x53,0xb6,0xc0],length=50;
  const wave=Array.from({length},(_,i)=>128+Math.round(24*Math.sin(2*Math.PI*i/length)));
  commands.push(0x67,0x66,0,...u32(wave.length),...wave);
  commands.push(0x90,3,0x02,0,0x2a,0x91,3,0,1,0,0x92,3,...u32(11025),0x93,3,...u32(0),0x81,...u32(length));
  wait(commands,30);commands.push(0x66);return vgm(commands,{seconds:30});
}

function installAudit({targets}) {
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,meters=[],writes=[];
  window.AudioContext=new Proxy(Context,{construct(Target,args){return Reflect.construct(Target,args);}});
  if(window.webkitAudioContext===Context)window.webkitAudioContext=window.AudioContext;
  MessagePort.prototype.postMessage=function(message,...args) {
    for(const command of Array.isArray(message)?message:[message]) {
      if(command?.type==='write')writes.push({port:command.port,register:command.register,value:command.value});
    }
    if(writes.length>6000)writes.splice(0,writes.length-6000);
    return post.call(this,message,...args);
  };
  AudioNode.prototype.connect=function(destination,...args) {
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const splitter=this.context.createChannelSplitter(2),mute=this.context.createGain();mute.gain.value=0;connect.call(this,splitter);
    const analyses=[0,1].map(side=>{
      const analyser=this.context.createAnalyser();analyser.fftSize=8192;
      connect.call(splitter,analyser,side);connect.call(analyser,mute);
      return analyser;
    });
    const hann=Float32Array.from({length:8192},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/8191));
    const weight=hann.reduce((sum,value)=>sum+value,0),rate=this.context.sampleRate;
    const bases=targets.map(hz=>({hz,cosine:Float32Array.from(hann,(_,i)=>Math.cos(2*Math.PI*hz*i/rate)),sine:Float32Array.from(hann,(_,i)=>Math.sin(2*Math.PI*hz*i/rate))}));
    connect.call(mute,destination);meters.push({analyses,mute,context:this.context,hann,weight,bases});return destination;
  };
  window.__mixAudit={drainWrites(){return writes.splice(0);},read(){return meters.map(({analyses,mute,context,hann,weight,bases})=>({muted:mute.gain.value===0,rate:context.sampleRate,
    sides:analyses.map(analyser=>{
      const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);
      const mean=pcm.reduce((sum,value)=>sum+value,0)/pcm.length;
      let square=0,peak=0;const re=targets.map(()=>0),im=targets.map(()=>0);
      for(let i=0;i<pcm.length;i++) {
        const sample=pcm[i]-mean,w=hann[i];square+=sample*sample;peak=Math.max(peak,Math.abs(pcm[i]));
        bases.forEach(({cosine,sine},j)=>{re[j]+=sample*w*cosine[i];im[j]+=sample*w*sine[i];});
      }
      return {finite:pcm.every(Number.isFinite),rms:Math.sqrt(square/pcm.length),peak,
        tones:Object.fromEntries(targets.map((hz,j)=>[String(hz),2*Math.hypot(re[j],im[j])/weight]))};
    })}));}};
}
const audit=page=>evaluate(page,()=>__mixAudit.read());
const briefAudit=async page=>(await audit(page)).map(meter=>({...meter,sides:meter.sides.map(side=>({finite:side.finite,rms:side.rms,peak:side.peak,
  strongest:Object.entries(side.tones).sort((a,b)=>b[1]-a[1]).slice(0,3)}))}));
const drainWrites=page=>evaluate(page,()=>__mixAudit.drainWrites());
const transport=page=>evaluate(page,()=>({state:document.getElementById('synthSongStatus').dataset.state,
  frame:Number(document.getElementById('synthSongPlayer').dataset.consumedFrames),time:performance.now(),
  target:document.getElementById('synthSongChannelSelect').value,status:document.getElementById('synthSongLiveStatus').textContent}));
const ui=page=>evaluate(page,()=>({path:document.getElementById('synthActiveFilePath').textContent,preset:document.getElementById('presetSelect').value,
  common:[...document.querySelectorAll('#commonControls .param-value')].map(node=>[node.getAttribute('aria-label'),node.textContent]),
  operators:[...document.querySelectorAll('#operatorControls .operator-row')].map(row=>[...row.querySelectorAll('.param-value')].map(node=>[node.getAttribute('aria-label'),node.textContent]))}));
async function until(page,predicate,label,ms=20000) {
  const end=Date.now()+ms;while(Date.now()<end) {if(await predicate())return;await pause(35);}
  throw new Error(label+'; '+JSON.stringify({transport:await transport(page),audit:await briefAudit(page)}));
}
const state=(page,value)=>until(page,async()=>(await transport(page)).state===value,'Expected '+value);
const ready=page=>page.waitForFunction(()=>!document.getElementById('importPresetButton').disabled);
const muteButton=(page,id)=>page.locator(`[data-song-mute="${id}"]`);
const soloButton=(page,id)=>page.locator(`[data-song-solo="${id}"]`);
const documentKeyActive=(page,key)=>evaluate(page,key=>document.querySelector(`#keyboard .key[data-key="${key}"]`)?.classList.contains('is-active')===true,key);
async function openMix(page) {
  if(!await page.locator('#synthSongMixPanel').isVisible())await page.locator('#synthSongMixButton').click();
  await page.locator('#synthSongMixPanel').waitFor({state:'visible'});
}
const allMuted=readings=>readings.every(meter=>meter.sides.every(side=>side.rms<1e-8&&side.peak<1e-7));
async function silence(page) {await pause(350);await until(page,async()=>allMuted(await audit(page)),'Actual all-output silence');}
async function acSilence(page) {await pause(350);await until(page,async()=>(await audit(page)).every(meter=>meter.sides.every(side=>side.rms<1e-8)),'No audible AC signal (idle chip DC is retained)');}
async function level(page,tone) {
  const values=[];
  for(let count=0;count<4;count++) {
    const meters=await audit(page);
    values.push(Math.max(0,...meters.flatMap(meter=>tone.side===undefined
      ? meter.sides.map(side=>side.tones[String(tone.hz)]??side.rms)
      : [meter.sides[tone.side].tones[String(tone.hz)]??meter.sides[tone.side].rms])));
    await pause(20);
  }
  return values.reduce((sum,value)=>sum+value,0)/values.length;
}
async function hasSound(page,tone) {
  await until(page,async()=>(await level(page,tone))>.00005,'Audible '+tone.id+' '+(tone.hz??'noise'));
}
async function files(page) {return evaluate(page,()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('tetorica-fm2612-synth-drafts',1);request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,get=db.transaction('projects','readonly').objectStore('projects').get('current');get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=async()=>{
    const entries=get.result.project.files;db.close();
    try {resolve(await Promise.all(entries.map(async item=>{
      const data=typeof item.data==='string'?new TextEncoder().encode(item.data):item.data;
      const digest=await crypto.subtle.digest('SHA-256',data);
      return {path:item.path,sha256:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join(''),bytes:data.byteLength,
        ...(item.path.endsWith('.synth.json')?{extra:JSON.parse(typeof item.data==='string'?item.data:new TextDecoder().decode(item.data))}:{})};
    })));}catch(error){reject(error);}
  };};
}));}

const served=new Map(),missing=[],external=[],mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer(async(request,response)=>{try {
  const pathname=new URL(request.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
  const name=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(name.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(name),key=path.relative(config.root,name).split(path.sep).join('/');
  const info={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  if(served.has(key))assert.deepEqual(served.get(key),info,'Asset changed during validation');served.set(key,info);
  response.setHeader('Content-Type',mime[path.extname(name)]??'application/octet-stream');response.end(bytes);
}catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}});

async function checkBrowser(browser,name,origin) {
  const mixed=mixedSong(),page=await browser.newPage({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1240,height:1000}}),errors=[],steps=[];
  page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installAudit,{targets:[...new Set([...mixed.tones.filter(tone=>tone.hz).map(tone=>tone.hz),220.5])]});
  try {
    await page.goto(origin+config.entry);await ready(page);
    await page.locator('#tfiFile').setInputFiles([
      {name:'Mix.vgm',mimeType:'application/octet-stream',buffer:mixed.bytes},
      {name:'Copy.vgm',mimeType:'application/octet-stream',buffer:copySong()},
      {name:'Special.vgm',mimeType:'application/octet-stream',buffer:copySong({special:true})},
      {name:'CSM.vgm',mimeType:'application/octet-stream',buffer:copySong({csm:true})},
      {name:'DAC.vgm',mimeType:'application/octet-stream',buffer:dacSong()},
    ]);await ready(page);
    await page.locator('#presetSelect').selectOption('sine');await ready(page);
    assert.equal(await page.locator('#looperStartButton').isDisabled(),false,'Ordinary Synth tones retain Looper support');
    assert.equal(await page.locator('#eventRecordStartButton').isDisabled(),false,'Ordinary Synth tones retain Event Rec support');
    await page.locator('#commonControls .param-value[aria-label="FB"]').locator('..').locator('.param-button').last().click();await ready(page);
    await pause(650);const original=await ui(page),originalFiles=await files(page);
    await page.locator('#synthSongSelect').selectOption('/vgm/Mix.vgm');
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');
    await page.locator('#synthSongMixButton').click();await page.locator('#synthSongMixPanel').waitFor({state:'visible'});
    const ids=await page.locator('[data-song-mute]').evaluateAll(nodes=>nodes.map(node=>node.dataset.songMute));
    assert.deepEqual(ids.slice().sort(),mixed.tones.map(tone=>tone.id).sort(),'Exactly six FM, four PSG, eight PCM and two stereo PWM outputs');
    const baselineView=await ui(page);
    const measured=[];
    for(const tone of mixed.tones) {
      await soloButton(page,tone.id).click();assert.equal(await soloButton(page,tone.id).getAttribute('aria-pressed'),'true');
      await pause(400);await hasSound(page,tone);const amplitude=await level(page,tone);
      if(tone.side!==undefined) {
        assert((await audit(page)).every(meter=>meter.sides[1-tone.side].rms<1e-8&&meter.sides[1-tone.side].peak<1e-7),
          'Solo '+tone.id+' silences the opposite stereo output');
      }
      await muteButton(page,tone.id).click();await silence(page);
      assert.equal(await muteButton(page,tone.id).getAttribute('aria-pressed'),'true','Explicit mute wins over solo');
      await muteButton(page,tone.id).click();await pause(400);await hasSound(page,tone);
      const resumed=await level(page,tone);assert(resumed>amplitude*.7&&resumed<amplitude*1.3,
        `Unmute retains ${tone.id} ongoing voice: baseline=${amplitude}, resumed=${resumed}, ratio=${resumed/amplitude}`);
      measured.push({id:tone.id,hz:tone.hz??null,amplitude,resumed});
      await soloButton(page,tone.id).click();
    }
    assert.deepEqual(await ui(page),baselineView,'Mixing never changes observed chip settings');
    await pause(650);assert.deepEqual(await files(page),originalFiles,'Mixing does not write VFS or edited presets');
    steps.push('all 20 hardware channels/outputs solo to actual PCM; explicit mute wins and ongoing voices return after unmute');

    await soloButton(page,'ym2612:0').click();await soloButton(page,'psg:0').click();await pause(400);
    await hasSound(page,mixed.tones.find(tone=>tone.id==='ym2612:0'));await hasSound(page,mixed.tones.find(tone=>tone.id==='psg:0'));
    const before=await transport(page);await muteButton(page,'ym2612:0').click();await pause(450);const after=await transport(page);
    assert(Math.abs((after.frame-before.frame)/RATE-(after.time-before.time)/1000)<.12,'Live mix does not skip or replay source time');
    await page.locator('#synthSongPlayButton').click();await state(page,'paused');await silence(page);
    const paused=await transport(page);await openMix(page);await page.locator('#synthSongMixReset').click();await pause(150);
    assert.equal((await transport(page)).frame,paused.frame,'Paused mixer leaves source position fixed');
    assert.equal(await page.locator('[data-song-mute][aria-pressed="true"],[data-song-solo][aria-pressed="true"]').count(),0,'Reset clears explicit mutes and solos');
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await hasSound(page,mixed.tones[0]);
    await page.locator('#synthSongStopButton').click();await state(page,'stopped');await silence(page);
    steps.push('multiple global solos, reset, audible-position continuity and paused mix changes');

    if(config.screenshots) {
      await fs.mkdir(config.screenshots,{recursive:true});
      for(const width of [1240,390]) {
        await page.setViewportSize({width,height:1000});
        if(await page.locator('#synthSongMixPanel').isVisible())await page.locator('#synthSongMixButton').click();
        const closed=await page.locator('.synth-editor').boundingBox();
        await page.screenshot({path:path.join(config.screenshots,`${name}-mix-closed-${width}.png`)});
        await openMix(page);const opened=await page.locator('.synth-editor').boundingBox();
        assert(Math.abs(opened.y-closed.y)<1&&Math.abs(opened.height-closed.height)<1,'Opening Mix does not expand the editor layout');
        const panel=await page.locator('#synthSongMixPanel').boundingBox();
        assert(panel.x>=0&&panel.x+panel.width<=width+1,'All-20-channel Mix panel fits '+width+'px');
        await page.screenshot({path:path.join(config.screenshots,`${name}-mix-open-${width}.png`)});
      }
      await page.setViewportSize({width:1240,height:1000});
    }

    await page.locator('#synthSongSelect').selectOption('/vgm/DAC.vgm');await page.locator('#synthSongChannelSelect').selectOption('5');
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');
    await hasSound(page,{id:'DAC',hz:220.5});
    if(!await page.locator('#synthSongMixPanel').isVisible())await page.locator('#synthSongMixButton').click();
    assert.equal(await page.locator('[data-song-mute]').count(),6,'New file only shows present hardware');
    await muteButton(page,'ym2612:5').click();await acSilence(page);
    await muteButton(page,'ym2612:5').click();await pause(400);await hasSound(page,{id:'DAC',hz:220.5});
    await page.locator('#synthSongPlayButton').click();await state(page,'paused');assert.equal(await page.locator('#synthSongCopyButton').isDisabled(),true,'DAC is not copied as an FM instrument');
    await page.locator('#synthSongStopButton').click();await state(page,'stopped');
    steps.push('YM2612 CH6 mute includes live DAC; new source resets unavailable mixer groups');

    // Explicit copy is tested last: it is the only operation allowed to add a
    // new instrument. Every original edited file must remain byte-identical.
    await page.locator('#synthSongSelect').selectOption('/vgm/Copy.vgm');await page.locator('#synthSongChannelSelect').selectOption('3');
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');assert.equal(await page.locator('#synthSongCopyButton').isDisabled(),true);
    await page.locator('#synthSongPlayButton').click();await state(page,'paused');
    await until(page,async()=>!await page.locator('#synthSongCopyButton').isDisabled(),'Paused FM copy becomes available');
    await page.locator('#synthSongCopyButton').click();await ready(page);
    await until(page,async()=>(await transport(page)).target==='synth'&&(await ui(page)).path!==original.path,'Copy switches to a new editable Synth tone');
    const copied=await ui(page);assert.notEqual(copied.path,original.path);assert.notEqual(copied.preset,original.preset);
    assert.equal(await page.locator('#looperStartButton').isDisabled(),false,'A captured partial OP mask supports Looper with its recorded mask');
    assert.equal(await page.locator('#eventRecordStartButton').isDisabled(),false,'Event Rec retains the captured OP mask');
    assert.equal(copied.common.find(([label])=>label==='ALGO')[1],'7');assert.equal(copied.common.find(([label])=>label==='FB')[1],'3');
    assert.equal(copied.operators[3].find(([label])=>label==='MULTI')[1],'2');assert.equal(copied.operators[3].find(([label])=>label==='TL')[1],'29');
    await pause(650);const copiedFiles=await files(page),byPath=new Map(copiedFiles.map(item=>[item.path,item]));
    for(const item of originalFiles)assert.deepEqual(byPath.get(item.path),item,'Copy keeps original '+item.path);
    assert(copiedFiles.length>originalFiles.length,'Explicit Copy materializes a new instrument');
    assert.equal(byPath.get(copied.path+'.synth.json')?.extra.capturedVoice.keyMask,8,'Sidecar persists the captured operator key mask');
    assert.equal((await transport(page)).state,'paused','Copy does not resume or replace the reference performance');
    await drainWrites(page);await page.keyboard.down('a');
    await until(page,async()=>documentKeyActive(page,'a'),'Copied Synth is playable after the button releases focus');
    const copiedWrites=await drainWrites(page);
    assert(copiedWrites.some(item=>item.register===0x28&&(item.value&0xf0)===0x80),'Copied partial OP4 instrument retains its observed KON mask');
    await page.keyboard.up('a');
    await page.locator('#operatorControls .param-value[aria-label="TL"]').nth(3).locator('..').locator('.param-button').last().click();
    await ready(page);assert.equal((await ui(page)).operators[3].find(([label])=>label==='TL')[1],'30','Copied tone uses the normal editable controls');
    steps.push('paused FM Copy creates a new editable tone while preserving all previous VFS bytes');

    await pause(650);const beforeSpecialFiles=await files(page);
    await page.locator('#synthSongSelect').selectOption('/vgm/Special.vgm');await page.locator('#synthSongChannelSelect').selectOption('2');
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await page.locator('#synthSongPlayButton').click();await state(page,'paused');
    await until(page,async()=>!await page.locator('#synthSongCopyButton').isDisabled(),'Manual CH3 special copy is available');
    await page.locator('#synthSongCopyButton').click();await ready(page);
    await until(page,async()=>(await transport(page)).target==='synth'&&(await ui(page)).path!==copied.path,'Special copy becomes a second new Synth instrument');
    const special=await ui(page);await pause(650);const specialFiles=await files(page),specialByPath=new Map(specialFiles.map(item=>[item.path,item]));
    for(const item of beforeSpecialFiles)assert.deepEqual(specialByPath.get(item.path),item,'CH3 copy keeps earlier file '+item.path);
    const captured=specialByPath.get(special.path+'.synth.json')?.extra.capturedVoice;
    assert.equal(captured?.specialMode,true);assert.equal(captured.keyMask,8);
    assert.deepEqual(captured.specialFrequencies,[{block:3,fnum:1000},{block:4,fnum:1500},{block:5,fnum:1000},{block:4,fnum:1000}]);
    await drainWrites(page);await page.keyboard.down('a');await until(page,async()=>documentKeyActive(page,'a'),'Copied CH3 keyboard note');
    const specialWrites=await drainWrites(page),registers=new Map(specialWrites.filter(item=>item.port===0).map(item=>[item.register,item.value]));
    assert(specialWrites.some(item=>item.register===0x28&&item.value===0x82),'Copied CH3 uses hardware CH3 and its partial KON mask');
    const pitchWeight=(low,high)=>(((registers.get(high)&7)<<8)|registers.get(low))*2**((registers.get(high)>>3)&7);
    const weights=[[0xa9,0xad],[0xaa,0xae],[0xa8,0xac],[0xa2,0xa6]].map(([low,high])=>pitchWeight(low,high));
    assert(weights.every(value=>Number.isFinite(value)&&value>0));
    for(const [index,ratio] of [.5,1.5,2,1].entries())assert(Math.abs(weights[index]/weights[3]-ratio)<.002,'Copied CH3 keyboard keeps OP'+(index+1)+' pitch ratio');
    await page.keyboard.up('a');
    const op1Block=page.locator('#channel3SpecialControls .param-value[aria-label="OP1B"]');
    assert.equal(await op1Block.textContent(),'3','Keyboard transposition does not overwrite the canonical copied pitch');
    await op1Block.locator('..').locator('.param-button').last().click();
    assert.equal(await op1Block.textContent(),'4');await pause(650);
    const changedSpecial=(await files(page)).find(item=>item.path===special.path+'.synth.json')?.extra.capturedVoice;
    assert.deepEqual(changedSpecial.specialFrequencies,[{block:4,fnum:1000},{block:4,fnum:1500},{block:5,fnum:1000},{block:4,fnum:1000}],
      'Editing a captured CH3 block persists the new canonical pitch ratios');
    const mode=page.locator('#channel3SpecialControls .param-value[aria-label="MODE"]');
    await mode.click();assert.equal(await mode.textContent(),'OFF');await pause(650);
    assert.equal((await files(page)).find(item=>item.path===special.path+'.synth.json')?.extra.capturedVoice.specialMode,false,'Mode Off is saved');
    await mode.click();assert.equal(await mode.textContent(),'ON');await pause(650);
    const reenabled=(await files(page)).find(item=>item.path===special.path+'.synth.json')?.extra.capturedVoice;
    assert.deepEqual(reenabled,changedSpecial,'Mode On restores and saves the edited canonical ratios');
    await drainWrites(page);await page.keyboard.down('a');await until(page,async()=>documentKeyActive(page,'a'),'Edited CH3 retrigger');
    const editedWrites=await drainWrites(page),editedRegisters=new Map(editedWrites.filter(item=>item.port===0).map(item=>[item.register,item.value]));
    const editedWeight=(low,high)=>(((editedRegisters.get(high)&7)<<8)|editedRegisters.get(low))*2**((editedRegisters.get(high)>>3)&7);
    const editedWeights=[[0xa9,0xad],[0xaa,0xae],[0xa8,0xac],[0xa2,0xa6]].map(([low,high])=>editedWeight(low,high));
    for(const [index,ratio] of [1,1.5,2,1].entries())assert(Math.abs(editedWeights[index]/editedWeights[3]-ratio)<.002,'Edited CH3 Note On keeps OP'+(index+1)+' canonical ratio');
    await page.keyboard.up('a');assert.equal(await op1Block.textContent(),'4');
    await page.locator('#synthSongSelect').selectOption('/vgm/CSM.vgm');await page.locator('#synthSongChannelSelect').selectOption('2');
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await page.locator('#synthSongPlayButton').click();await state(page,'paused');
    assert.equal(await page.locator('#synthSongCopyButton').isDisabled(),true,'Timer CSM is not silently converted into a normal FM preset');
    await page.locator('#synthSongChannelSelect').selectOption('synth');await page.locator('#presetSelect').selectOption(original.preset);await ready(page);
    assert.equal(await page.locator('#looperStartButton').isDisabled(),false,'Returning to an ordinary tone restores Looper');
    assert.equal(await page.locator('#eventRecordStartButton').isDisabled(),false,'Returning to an ordinary tone restores Event Rec');
    steps.push('CH3 partial mask, canonical ratios and edits survive Mode Off/On; captured recording is available and timer CSM copy stays unavailable');
    assert.deepEqual(errors,[]);assert((await audit(page)).every(meter=>meter.muted));
    return {browser:name,steps,measured,originalFileCount:originalFiles.length,copiedFileCount:copiedFiles.length,physicalOutputMuted:true};
  } catch(error) {
    console.error(JSON.stringify({browser:name,steps,transport:await transport(page).catch(()=>null),ui:await ui(page).catch(()=>null),errors}));throw error;
  } finally {await bounded(page.close(),'close mix page');}
}

(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  try {
    for(const name of engines) {
      const browser=await bounded(({chromium,webkit})[name].launch({headless:true}),'launch '+name);
      try {results.push(await checkBrowser(browser,name,origin));console.log('PASS '+name+': source mixer, real individual PCM and copy to new Synth');}
      finally {await bounded(browser.close(),'close '+name);}
    }
  } finally {server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
  const report={passed:true,physicalOutputMuted:true,listeningPerformed:false,results,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');
  console.log('PASS '+results.length+' browsers; receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
