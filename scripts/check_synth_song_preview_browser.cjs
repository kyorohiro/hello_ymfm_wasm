// Real FM2612 Synth source selection and reference-song playback. No engine mocks.
// Every final speaker edge is metered and muted; no human listening is claimed.
const {selectSynthChannel}=require('./synth_channel_browser_helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {gzipSync} = require('node:zlib');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {root:path.join(repository, 'docs'), entry:'/synth/index.html',
  out:'/private/tmp/fm2612-synth-song-preview-browser.json', engines:'chromium,webkit', screenshots:null};
const realFiles=[];
for (const argument of process.argv.slice(2)) {
  if(argument.startsWith('--real-file=')){realFiles.push(path.resolve(argument.slice(12)));continue;}
  const match = /^--(root|entry|out|engines|screenshots)=(.+)$/.exec(argument);
  assert(match, 'Unknown option: ' + argument);
  config[match[1]] = match[2];
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/'), '--entry must start with /');
const engines = config.engines.split(',');
assert(engines.every(name => ['chromium','webkit'].includes(name)), 'Unknown browser engine');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function bounded(task, label, milliseconds=25000) {
  let timer;
  try { return await Promise.race([task,new Promise((_,reject) => {timer=setTimeout(() => reject(new Error('Timed out: '+label)), milliseconds);})]); }
  finally { clearTimeout(timer); }
}
const evaluate = (page, callback, argument) => bounded(page.evaluate(callback, argument), 'browser evaluation');
// RF step 1107 repeats this 32-point loop in 60 native frames. The loop marker
// resets the fractional position, so the audible pitch is not exactly 550 Hz.
const RF_TONE_HZ=12500000/(384*Math.ceil(32*2048/1107));

function buildVgm(commands, {fm=false, psg=false, rf=false, pwm=false, seconds=0}={}) {
  const bytes = Buffer.alloc(0x100 + commands.length), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  bytes.set([0x56,0x67,0x6d,0x20]);
  view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,0xcc,true);view.setUint32(0x18,Math.round(seconds*44100),true);
  if(fm)view.setUint32(0x2c,7670454,true);
  if(psg)view.setUint32(0x0c,3579545,true);
  if(rf)view.setUint32(0x6c,12500000,true);
  if(pwm)view.setUint32(0x70,23011361,true);
  bytes.set(commands,0x100);return bytes;
}
function wait(commands, seconds) {
  let frames=Math.round(seconds*44100);
  while(frames){const count=Math.min(65535,frames);commands.push(0x61,count&255,count>>8);frames-=count;}
}
function fmSong({short=false}={}) {
  const commands=[], write=(register,value)=>commands.push(0x52,register,value);
  write(0x22,0);write(0x27,0);write(0x2b,0);write(0xb0,7);write(0xb4,0xc0);
  for(const offset of [0,4,8,12]) {
    write(0x30+offset,1);write(0x40+offset,offset===12?48:127);
    write(0x50+offset,31);write(0x60+offset,0);write(0x70+offset,0);write(0x80+offset,15);
  }
  const pitch = hz => {
    const block=4,fnum=Math.round(hz*144*2**20/(7670454*2**(block-1)));
    write(0xa4,(block<<3)|(fnum>>8));write(0xa0,fnum&255);
  };
  pitch(440);write(0x28,0xf0);wait(commands,short ? .25 : 2);
  if(!short){pitch(220);wait(commands,12);}
  write(0x28,0);commands.push(0x66);
  return buildVgm(commands,{fm:true,seconds:short ? .25 : 14});
}
function psgSong() {
  const commands=[],period=Math.round(3579545/(32*330));
  commands.push(0x50,0x80|(period&15),0x50,(period>>4)&63,0x50,0x98);
  wait(commands,12);commands.push(0x50,0x9f,0x66);
  return buildVgm(commands,{psg:true,seconds:12});
}
function dacSong() {
  const rate=11025,length=rate*2,commands=[0x52,0x2b,0x80,0x53,0xb6,0xc0];
  commands.push(0x67,0x66,0,length&255,(length>>8)&255,(length>>16)&255,(length>>24)&255);
  for(let frame=0;frame<length;frame++)commands.push(128+Math.round(24*Math.sin(2*Math.PI*220*frame/rate)));
  commands.push(0xe0,0,0,0,0); // Original PCM bank, starting at byte zero.
  for(let frame=0;frame<length;frame++)commands.push(0x84); // DAC byte + four 44.1k ticks.
  commands.push(0x52,0x2b,0,0x66);
  return buildVgm(commands,{fm:true,seconds:2});
}

const u32 = value => [value&255,(value>>8)&255,(value>>16)&255,(value>>>24)&255];
const rfWrite = (commands,register,value) => commands.push(0xb1,register,value);
const pwmWrite = (commands,register,value) => commands.push(0xb2,(register<<4)|((value>>8)&15),value&255);
function appendRfSetup(commands,hz=550) {
  const clock=12500000,length=32,step=Math.round(hz*length*2048*384/clock);
  rfWrite(commands,7,0x80); // Enable RF5C164, RAM bank 0.
  // The C1 upload supplies the loop marker, and C2 writes create the waveform.
  // Ignoring either route leaves no sustained periodic sample to pass the test.
  const initial=Array(length).fill(0x80);initial.push(0xff);
  commands.push(0x67,0x66,0xc1,...u32(initial.length+2),0,0,...initial);
  for(let frame=0;frame<length;frame++) {
    const sample=Math.sin(2*Math.PI*frame/length);
    const encoded=Math.round(Math.abs(sample)*28)|(sample>=0?128:0);
    commands.push(0xc2,frame&255,frame>>8,encoded);
  }
  rfWrite(commands,7,0xc0); // Physical voice 0; no new waveform allocation.
  for(const [register,value] of [[0,80],[1,0xff],[2,step&255],[3,step>>8],[4,0],[5,0],[6,0],[8,0xff]])rfWrite(commands,register,value);
}
function rfSong() {
  const commands=[];appendRfSetup(commands);rfWrite(commands,8,0xfe);
  wait(commands,8);rfWrite(commands,8,0xff);commands.push(0x66);
  return buildVgm(commands,{rf:true,seconds:8});
}
function appendPwmSetup(commands) {
  const words=Array.from({length:100},(_,index)=>522+Math.round(110*Math.sin(2*Math.PI*index/100)));
  const data=words.flatMap(value=>[value&255,value>>8]);
  commands.push(0x67,0x66,3,...u32(data.length),...data);
  pwmWrite(commands,0,0x305);pwmWrite(commands,1,1045);
  pwmWrite(commands,4,522); // Timer duty midpoint: silence before the stream.
  commands.push(0x90,1,0x11,0,4,0x91,1,3,1,0,0x92,1,...u32(22050));
}
function startPwm(commands) {commands.push(0x93,1,...u32(0),0x81,...u32(100));}
function stopPwm(commands) {commands.push(0x94,1);pwmWrite(commands,4,522);}
function pwmSong() {
  const commands=[];appendPwmSetup(commands);startPwm(commands);
  wait(commands,8);stopPwm(commands);commands.push(0x66);
  return buildVgm(commands,{pwm:true,seconds:8});
}
function mixedSong() {
  // One declared MD + Mega CD + 32X song: solo sections make every source
  // independently audible, then the final section combines all four engines.
  const commands=[],fm=fmSong({short:true}).subarray(0x100);
  commands.push(...fm.subarray(0,fm.length-7)); // Setup + A4 key-on; remove wait/key-off/end.
  appendRfSetup(commands);appendPwmSetup(commands);
  wait(commands,.9);commands.push(0x52,0x28,0);wait(commands,.1);
  const period=Math.round(3579545/(32*330));
  commands.push(0x50,0x80|(period&15),0x50,(period>>4)&63,0x50,0x98);
  wait(commands,.9);commands.push(0x50,0x9f);wait(commands,.1);
  rfWrite(commands,8,0xfe);wait(commands,.9);rfWrite(commands,8,0xff);wait(commands,.1);
  startPwm(commands);wait(commands,.9);stopPwm(commands);wait(commands,.1);
  commands.push(0x52,0x28,0xf0,0x50,0x98);rfWrite(commands,8,0xfe);startPwm(commands);
  wait(commands,4);commands.push(0x52,0x28,0,0x50,0x9f);rfWrite(commands,8,0xff);stopPwm(commands);commands.push(0x66);
  return buildVgm(commands,{fm:true,psg:true,rf:true,pwm:true,seconds:8});
}

function installMutedAudit({toneTargets}) {
  const Context=window.AudioContext??window.webkitAudioContext, connect=AudioNode.prototype.connect;
  const start=AudioBufferSourceNode.prototype.start, stop=AudioBufferSourceNode.prototype.stop;
  const contexts=[],meters=[],sources=[],sourceRecords=new WeakMap();
  window.AudioContext=new Proxy(Context,{construct(Target,args){const context=Reflect.construct(Target,args);contexts.push(context);return context;}});
  if(window.webkitAudioContext===Context)window.webkitAudioContext=window.AudioContext;
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);
    const hann=Float32Array.from({length:analyser.fftSize},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(analyser.fftSize-1)));
    const bases=toneTargets.map(hz=>({hz,
      cosine:Float32Array.from(hann,(_,i)=>Math.cos(2*Math.PI*hz*i/this.context.sampleRate)),
      sine:Float32Array.from(hann,(_,i)=>Math.sin(2*Math.PI*hz*i/this.context.sampleRate))}));
    meters.push({analyser,mute,context:this.context,hann,bases,hannWeight:hann.reduce((sum,value)=>sum+value,0)});return destination;
  };
  AudioBufferSourceNode.prototype.start=function(when=0,offset=0,duration){
    const record={when,offset,duration:duration??null,frames:this.buffer?.length??0,
      sampleRate:this.buffer?.sampleRate??0,stopped:false,ended:false};
    sources.push(record);sourceRecords.set(this,record);this.addEventListener('ended',()=>{record.ended=true;});
    return start.apply(this,arguments);
  };
  AudioBufferSourceNode.prototype.stop=function(){const record=sourceRecords.get(this);if(record)record.stopped=true;return stop.apply(this,arguments);};
  window.__songAudit={read(){
    const readings=meters.map(({analyser,mute,context,hann,bases,hannWeight})=>{
      const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);
      let sum=0,squares=0,peak=0,finite=true;const crossings=[];
      for(let index=0;index<pcm.length;index++){
        const value=pcm[index];finite&&=Number.isFinite(value);sum+=value;squares+=value*value;peak=Math.max(peak,Math.abs(value));
      }
      const mean=sum/pcm.length;
      // The actual YM2612/PSG output includes its chip offset. Estimate pitch
      // around the measured mean; a positive DC level is not a missing tone.
      for(let index=1;index<pcm.length;index++){
        const before=pcm[index-1]-mean,value=pcm[index]-mean;
        if(before<=0&&value>0)crossings.push(index-1-before/(value-before));
      }
      const tones=Object.fromEntries(bases.map(({hz,cosine,sine})=>{
        let re=0,im=0;for(let i=0;i<pcm.length;i++){const value=(pcm[i]-mean)*hann[i];re+=value*cosine[i];im+=value*sine[i];}
        return [String(hz),2*Math.hypot(re,im)/hannWeight];
      }));
      return {state:context.state,muted:mute.gain.value===0,finite,peak,mean,tones,
        acRms:Math.sqrt(Math.max(0,squares/pcm.length-mean*mean)),
        frequency:crossings.length>5?context.sampleRate*(crossings.length-1)/(crossings.at(-1)-crossings[0]):0};
    });
    return {contexts:contexts.map(context=>context.state),sources:sources.map(record=>({...record})),
      activeSources:sources.filter(record=>!record.stopped&&!record.ended).length,readings};
  }};
}
const audit = page => evaluate(page,()=>window.__songAudit.read());
async function briefAudit(page){
  const observed=await audit(page);
  return {...observed,sourceCount:observed.sources.length,sources:observed.sources.slice(-5)};
}
const state = page => evaluate(page,()=>{
  const root=document.getElementById('synthSongPlayer'),status=document.getElementById('synthSongStatus');
  return {state:status?.dataset.state??root?.dataset.state??'',frames:Number(root?.dataset.consumedFrames??0),
    text:status?.textContent??'',button:document.getElementById('synthSongPlayButton')?.textContent.trim()??''};
});
async function until(page,predicate,label,milliseconds=25000){
  const deadline=Date.now()+milliseconds;
  while(Date.now()<deadline){if(await predicate())return;await pause(35);}
  throw new Error(label+'; '+JSON.stringify(await state(page))+'; '+JSON.stringify(await briefAudit(page)));
}
const waitState=(page,value)=>until(page,async()=>(await state(page)).state===value,'Expected '+value);
const ready=page=>page.waitForFunction(()=>!document.getElementById('importPresetButton').disabled);
async function sound(page,hz){
  await until(page,async()=>(await audit(page)).readings.some(value=>value.finite&&value.acRms>.0001&&Math.abs(value.frequency-hz)<8),'Actual sustained '+hz+' Hz PCM');
}
async function silence(page){
  await pause(180);
  await until(page,async()=>(await audit(page)).readings.every(value=>value.acRms<1e-8&&value.peak<1e-7),'Actual silent final output');
}
async function measure(page){
  const values=[];for(let count=0;count<8;count++){await pause(25);values.push(Math.max(0,...(await audit(page)).readings.map(value=>value.acRms)));}
  return values.reduce((sum,value)=>sum+value,0)/values.length;
}
async function setVolume(page,percent){await page.locator('#masterVolumeRange').evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},percent);await pause(150);}
async function importFiles(page,files){
  await page.locator('#tfiFile').setInputFiles(files);await ready(page);
  // This suite checks playback alongside the unchanged editing UI. The
  // separate Live suite exercises the default-on observation overlay.
  await selectSynthChannel(page,'synth');
}
const file=(name,bytes)=>({name,mimeType:'application/octet-stream',buffer:bytes});
async function openMenu(page){if(!await page.locator('#synthMenu').evaluate(element=>element.open))await page.locator('#synthMenuButton').click();}
const snapshot=page=>evaluate(page,()=>({path:document.getElementById('synthActiveFilePath').textContent,
  preset:document.getElementById('presetSelect').value,
  controls:[...document.querySelectorAll('#commonControls .param-value,#operatorControls .param-value')].map(element=>element.textContent)}));

const served=new Map(),missing=[],external=[],mime={'.html':'text/html','.js':'text/javascript','.css':'text/css',
  '.wasm':'application/wasm','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=new URL(request.url,'http://localhost').pathname;
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
    const bytes=await fs.readFile(filename),name=path.relative(config.root,filename).split(path.sep).join('/');
    const record={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    if(served.has(name))assert.deepEqual(served.get(name),record,'Static source changed during verification');served.set(name,record);
    response.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');response.end(bytes);
  }catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}
});
async function newPage(browser,origin){
  const page=await browser.newPage({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1240,height:1000}}),errors=[];
  page.setDefaultTimeout(25000);page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installMutedAudit,{toneTargets:[440,330,RF_TONE_HZ,220.5]});await page.goto(origin+config.entry);await ready(page);
  return {page,errors};
}
async function checkBrowser(browser,name,origin,emptyCassette){
  const {page,errors}=await newPage(browser,origin),steps=[];
  try{
    assert.equal(await page.locator('#synthSongPlayer').isVisible(),false);
    assert.deepEqual((await audit(page)).contexts,[],'Loading an empty project starts no audio');
    await importFiles(page,[file('Reference.vgm',fmSong()),file('Square.vgz',gzipSync(psgSong())),file('Dac.vgm',dacSong())]);
    assert.equal(await page.locator('#synthSongPlayer').isVisible(),true);
    assert.deepEqual(await page.locator('#synthSongSelect option').evaluateAll(options=>options.map(option=>option.value).sort()),['/vgm/Dac.vgm','/vgm/Reference.vgm','/vgm/Square.vgz']);
    assert.deepEqual((await audit(page)).contexts,[],'Import does not auto-play');
    await page.locator('#synthSongSelect').selectOption('/vgm/Reference.vgm');
    const patch=await snapshot(page);
    for(const width of [1240,390]){
      await page.setViewportSize({width,height:1000});
      for(const files of [false,true]){
        if((await page.locator('#synthFilesToggle').getAttribute('aria-expanded')==='true')!==files)await page.locator('#synthFilesToggle').click();
        for(const mode of ['envelope','waveform','spectrum']){
          await page.locator(`[data-visual-mode="${mode}"]`).click();
          const bounds=await page.locator('#synthSongPlayer').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1,'Reference player fits the viewport');
          assert(await page.locator('#synthSongSelect').isVisible());
        }
      }
      if(config.screenshots){
        await fs.mkdir(config.screenshots,{recursive:true});
        await page.screenshot({path:path.join(config.screenshots,`${name}-song-preview-${width}.png`)});
      }
    }
    await page.setViewportSize({width:1240,height:1000});
    steps.push('source dropdown, no autoplay, all visualization modes and responsive Files layouts');
    await page.locator('#synthSongPlayButton').click();await waitState(page,'playing');await sound(page,440);
    const actual=await audit(page);assert(actual.readings.every(value=>value.muted&&value.finite));
    await sound(page,220);await page.locator('#synthSongPlayButton').click();await waitState(page,'paused');
    assert.match((await state(page)).button,/Resume/i);await silence(page);
    const paused=await state(page);await pause(250);const held=await state(page);assert.equal(held.frames,paused.frames,'Paused position stays frozen');
    await page.locator('#synthSongPlayButton').click();await waitState(page,'playing');await sound(page,220);
    await until(page,async()=>(await state(page)).frames>paused.frames,'Resume advances from the held position');
    assert.deepEqual(await snapshot(page),patch,'Reference register writes never change the editable patch');
    steps.push('actual A4 then A3 PCM, Pause silences and freezes position, Resume stays at A3');
    const at100=await measure(page);assert(at100>.0001);
    const ratios={};
    for(const percent of [50,200,380]){await setVolume(page,percent);const rms=await measure(page),ratio=rms/at100;assert(Math.abs(ratio-percent/100)<percent/100*.12,`Master ${percent}% ratio ${ratio}`);ratios[percent]=ratio;}
    await setVolume(page,0);await silence(page);await setVolume(page,100);await sound(page,220);
    await page.locator('#synthSongStopButton').click();await waitState(page,'stopped');await silence(page);assert.equal((await state(page)).frames,0);
    assert.equal((await audit(page)).activeSources,0,'Stop cancels every queued reference buffer');
    await page.locator('#synthSongPlayButton').click();await waitState(page,'playing');await sound(page,440);
    steps.push('Master 0/50/100/200/380%, queued buffers cancelled on Stop, replay starts at A4');
    await page.locator('#synthSongSelect').selectOption('/vgm/Square.vgz');await silence(page);
    assert.notEqual((await state(page)).state,'playing');assert.deepEqual(await snapshot(page),patch);
    await page.locator('#synthSongPlayButton').click();await waitState(page,'playing');await sound(page,330);
    await page.locator('#synthSongSelect').selectOption('/vgm/Dac.vgm');await silence(page);
    await page.locator('#synthSongPlayButton').click();await waitState(page,'playing');await sound(page,220);
    if(await page.locator('#synthFilesToggle').getAttribute('aria-expanded')!=='true')await page.locator('#synthFilesToggle').click();
    const sourceFolder=page.locator('#synthFilesTree summary[data-file-path="/vgm"]');
    if(!await sourceFolder.locator('..').evaluate(element=>element.open))await sourceFolder.click();
    await page.locator('#synthFilesTree button[data-file-path="/vgm/Reference.vgm"]').click();
    assert.equal(await page.locator('#synthSongSelect').inputValue(),'/vgm/Reference.vgm');await silence(page);
    assert.deepEqual(await snapshot(page),patch,'Files source selection preserves the instrument');
    await page.locator('#synthSongPlayButton').click();await waitState(page,'playing');await sound(page,440);
    await page.locator('#synthFileDeleteButton').click();await ready(page);await silence(page);
    assert.equal(await page.locator('#synthSongSelect option[value="/vgm/Reference.vgm"]').count(),0);
    steps.push('VGZ PSG audio, original PCM-bank DAC audio, source selection/Files synchronization, deleting an active source stops it');
    await importFiles(page,[file('Short.vgm',fmSong({short:true}))]);
    await page.locator('#synthSongSelect').selectOption('/vgm/Short.vgm');await page.locator('#synthSongPlayButton').click();
    await waitState(page,'ended');await silence(page);assert.equal((await state(page)).button,'Play');assert.equal((await audit(page)).activeSources,0);
    await page.locator('#synthSongSelect').selectOption('/vgm/Square.vgz');await page.locator('#synthSongPlayButton').click();await waitState(page,'playing');await sound(page,330);
    await page.locator('#cassetteImportInput').setInputFiles({name:'Empty.cassette.zip',mimeType:'application/zip',buffer:emptyCassette});await ready(page);await silence(page);
    assert.equal(await page.locator('#synthSongPlayer').isVisible(),false);assert.equal((await audit(page)).activeSources,0);
    steps.push('natural completion drains audio, replacing Cassette retires active playback and hides empty UI');
    if(config.screenshots){await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-song-preview.png`)});}
    assert.deepEqual(errors,[]);
    return {browser:name,steps,masterRatios:ratios,pausedFrames:paused.frames,physicalOutputMuted:true};
  }catch(error){console.error(JSON.stringify({browser:name,steps,state:await state(page).catch(()=>null),audit:await briefAudit(page).catch(()=>null),errors}));throw error;}
  finally{await bounded(page.close(),'close song preview page');}
}
async function cancelledLoad(browser,name,origin){
  const {page,errors}=await newPage(browser,origin);let release,requested;
  const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{requested=resolve;});let intercepted=false;
  try{
    await importFiles(page,[file('Loading.vgm',fmSong())]);
    await page.route('**/*.wasm',async route=>{if(!intercepted&&new URL(route.request().url()).pathname.endsWith('/ym2612_wasm.wasm')){intercepted=true;requested();await held;}try{return await route.continue();}catch{return;}});
    await page.locator('#synthSongPlayButton').click();await bounded(started,'held YM2612 WASM request');
    await page.locator('#synthSongStopButton').click();release();await waitState(page,'stopped');await pause(350);await silence(page);
    assert.equal((await audit(page)).activeSources,0,'Late engine initialization must not start a cancelled song');assert.deepEqual(errors,[]);
    return {browser:name,cancelledPreparation:true,latePlaybackPrevented:true};
  }finally{release();await bounded(page.close(),'close cancelled loading page');}
}
async function megaCd32x(browser,name,origin){
  const {page,errors}=await newPage(browser,origin),steps=[];
  try{
    await importFiles(page,[file('MegaCD.vgm',rfSong()),file('32X.vgz',gzipSync(pwmSong())),file('Combined.vgm',mixedSong())]);
    assert.deepEqual((await audit(page)).contexts,[],'Extended-chip imports also stay silent');
    const patch=await snapshot(page),isolated=[];
    for(const [source,hz]of[['/vgm/MegaCD.vgm',RF_TONE_HZ],['/vgm/32X.vgz',220.5]]){
      await page.locator('#synthSongSelect').selectOption(source);
      await page.locator('#synthSongPlayButton').click();await waitState(page,'playing');await sound(page,hz);
      const before=(await audit(page)).readings.find(value=>value.acRms>.001&&Math.abs(value.frequency-hz)<8);
      assert(before&&before.muted&&before.finite&&before.peak<.95,'Actual isolated chip output is finite and unclipped');
      await page.locator('#synthSongPlayButton').click();await waitState(page,'paused');await silence(page);
      const frozen=(await state(page)).frames;await pause(120);assert.equal((await state(page)).frames,frozen);
      await page.locator('#synthSongPlayButton').click();await waitState(page,'playing');await sound(page,hz);
      await until(page,async()=>(await state(page)).frames>frozen,'Extended chip Resume advances');
      await page.locator('#synthSongStopButton').click();await waitState(page,'stopped');await silence(page);
      assert.equal((await audit(page)).activeSources,0);
      isolated.push({source,hz,observedHz:before.frequency,acRms:before.acRms,pauseResumeStop:true});
    }
    steps.push('RF5C164 C1 loop marker/C2 waveform/register playback, MAME PWM bank stream, isolated Pause/Resume/Stop');
    await page.locator('#synthSongSelect').selectOption('/vgm/Combined.vgm');
    await page.locator('#synthSongPlayButton').click();await waitState(page,'playing');
    const mixedSoloTones={};
    for(const hz of[440,330,RF_TONE_HZ,220.5]){
      await sound(page,hz);await pause(100);
      mixedSoloTones[String(hz)]=Math.max(0,...(await audit(page)).readings.map(reading=>reading.tones[String(hz)]));
      assert(mixedSoloTones[String(hz)]>.0001,'Each calibrated source has an independently measured positive spectral baseline: '+hz);
    }
    await until(page,async()=>(await state(page)).frames>4.15*53267,'Combined section is actually consumed');
    // Preserve the app's calibrated source levels. In particular PWM's shared
    // System gain is well below unity; compare each mixed component with its
    // own earlier solo in this same log instead of assuming an old fixed gain.
    const minima=Object.fromEntries(Object.entries(mixedSoloTones).map(([hz,level])=>[hz,level*.6]));
    await until(page,async()=>(await audit(page)).readings.some(reading=>Object.entries(minima).every(([hz,minimum])=>reading.tones[hz]>minimum)),'Every actual source frequency survives the mixed output');
    const combined=(await audit(page)).readings.find(reading=>Object.entries(minima).every(([hz,minimum])=>reading.tones[hz]>minimum));
    assert.deepEqual(await snapshot(page),patch,'Extended playback leaves the editable patch unchanged');
    await page.locator('#synthSongStopButton').click();await waitState(page,'stopped');await silence(page);
    assert.equal((await audit(page)).activeSources,0);assert.deepEqual(errors,[]);
    steps.push('FM, Sega PSG, RF5C164 and 32X PWM individually audible in one log, then all four measured together');
    return {browser:name,extendedChips:true,steps,isolated,mixedSoloTones,mixedToneMinima:minima,combinedTones:combined.tones,physicalOutputMuted:true};
  }catch(error){console.error(JSON.stringify({browser:name,steps,state:await state(page).catch(()=>null),audit:await briefAudit(page).catch(()=>null),errors}));throw error;}
  finally{await bounded(page.close(),'close Mega CD / 32X page');}
}
async function realFile(browser,name,origin,filename){
  const bytes=await fs.readFile(filename),basename=path.basename(filename),digest=createHash('sha256').update(bytes).digest('hex');
  const {page,errors}=await newPage(browser,origin);
  try{
    await importFiles(page,[file(basename,bytes)]);
    const source='/vgm/'+basename;await page.locator('#synthSongSelect').selectOption(source);
    const saved=await evaluate(page,source=>new Promise((resolve,reject)=>{
      const request=indexedDB.open('tetorica-fm2612-synth-drafts',1);request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const db=request.result,read=db.transaction('projects','readonly').objectStore('projects').get('current');
        read.onerror=()=>{db.close();reject(read.error);};read.onsuccess=async()=>{try{
          const data=read.result.project.files.find(file=>file.path===source)?.data;db.close();if(!data)throw Error('Missing saved original');
          const hash=await crypto.subtle.digest('SHA-256',data);resolve({bytes:data.byteLength,sha256:[...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('')});
        }catch(error){reject(error);}};};
    }),source);
    assert.deepEqual(saved,{bytes:bytes.length,sha256:digest});const patch=await snapshot(page);
    await page.locator('#synthSongPlayButton').click();await waitState(page,'playing');
    const audible=async()=>(await audit(page)).readings.some(value=>value.finite&&value.muted&&value.acRms>.0001&&value.peak<.99);
    await until(page,audible,'Real-file sustained AC output');await pause(100);await until(page,audible,'Real-file sustained output after startup');
    const before=(await audit(page)).readings;
    await page.locator('#synthSongPlayButton').click();await waitState(page,'paused');await silence(page);
    const frozen=(await state(page)).frames;await pause(150);assert.equal((await state(page)).frames,frozen);
    await page.locator('#synthSongPlayButton').click();await waitState(page,'playing');await until(page,audible,'Real-file Resume output');
    await until(page,async()=>(await state(page)).frames>frozen,'Real-file resumed position');
    assert.deepEqual(await snapshot(page),patch);
    await page.locator('#synthSongStopButton').click();await waitState(page,'stopped');await silence(page);assert.equal((await audit(page)).activeSources,0);assert.deepEqual(errors,[]);
    return {browser:name,realFile:filename,name:basename,bytes:bytes.length,sha256:digest,readings:before,pauseResumeStop:true,originalBytesPreserved:true,editablePatchPreserved:true,physicalOutputMuted:true};
  }catch(error){console.error(JSON.stringify({browser:name,realFile:filename,state:await state(page).catch(()=>null),audit:await briefAudit(page).catch(()=>null),errors}));throw error;}
  finally{await bounded(page.close(),'close real-file page');}
}
(async()=>{
  const {createPlaygroundCassetteZip}=await import(pathToFileURL(path.join(repository,'docs/playground/playground_cassette.js')));
  const emptyCassette=Buffer.from(createPlaygroundCassetteZip([],{directories:['/presets']}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  try{for(const name of engines){const browser=await bounded(({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})}),'launch '+name);try{
    results.push(await checkBrowser(browser,name,origin,emptyCassette));results.push(await cancelledLoad(browser,name,origin));
    results.push(await megaCd32x(browser,name,origin));for(const filename of realFiles)results.push(await realFile(browser,name,origin,filename));
    console.log('PASS '+name+': reference song playback, actual PCM, lifecycle, Mega CD / 32X and storage UI');
  }finally{await bounded(browser.close(),'close '+name);}}}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
  const report={passed:true,physicalOutputMuted:true,listeningPerformed:false,root:config.root,entry:config.entry,results,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');
  console.log('PASS '+engines.length+' browser engines; receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
