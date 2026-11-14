// SPDX-License-Identifier: BSD-3-Clause
// Original HuC6280 VGM / VGZ fixtures and the real WASM/audio route. No speaker
// receives audio: intercept every destination before application JS, use gain 0,
// and also launch Chromium with --mute-audio. This is not a listening test.
// node scripts/check_huc6280_synth_live_browser.cjs --root=docs --entry=/synth-huc6280/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-huc6280/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'huc6280-synth-live-browser.json'),screenshots:path.join(tmpdir(),'huc6280-synth-live-images')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map(),missing=[],external=[],httpErrors=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function until(predicate,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(25);}throw Error('Timeout: '+label);}

const wave=Array.from({length:32},(_,i)=>Math.round(15.5+15.5*Math.sin(i*Math.PI/16)));
const futureWave=Array.from({length:32},(_,i)=>(i*7)%32),thirdWave=Array.from({length:32},(_,i)=>i<16?31:0),write=(register,value)=>[0xb9,register,value];
function upload(channel,values,{volume=23,balance=255,period=428}={}){
  return [...write(0,channel),...write(4,64),...write(4,0),...values.flatMap(value=>write(6,value)),
    ...write(5,balance),...write(2,period&255),...write(3,period>>8),...write(7,0),...write(4,128|volume)];
}
function makeFixture(){
  const commands=[];let samples=0;
  const sleep=frames=>{while(frames){const count=Math.min(65535,frames);commands.push(0x61,count&255,count>>8);samples+=count;frames-=count;}};
  commands.push(...write(1,255),...write(9,0),...upload(0,wave,{period:500,volume:19,balance:0xe7}),
    ...upload(1,futureWave,{period:713,volume:0}),...upload(2,thirdWave,{period:360,volume:21,balance:0xbd}),
    ...write(0,3),...write(2,444&255),...write(3,444>>8),...write(5,0xcb),...write(4,0xc0|20),...write(6,9),
    ...write(0,4),...write(5,0xf8),...write(7,0x8d),...write(4,0x80|17),
    ...write(0,5),...write(2,666&255),...write(3,666>>8),...write(5,0x9f),...write(4,0x80|12));
  sleep(44100);commands.push(
    ...upload(0,futureWave,{period:250,volume:7,balance:0x6c}),
    ...write(0,2),...write(2,1000&255),...write(3,1000>>8),...write(5,255),...write(4,128|22),
    ...write(0,3),...write(6,27),...write(0,4),...write(5,0x8f),...write(7,0x83),...write(4,128|11),...write(8,7),...write(9,2));
  sleep(66150);commands.push(
    ...write(0,0),...write(2,333&255),...write(3,333>>8),...write(5,0xab),...write(4,128|20),
    ...write(0,2),...write(4,128|13));sleep(242550);commands.push(0x66);
  const bytes=Buffer.alloc(256+commands.length);bytes.write('Vgm ');bytes.writeUInt32LE(bytes.length-4,4);bytes.writeUInt32LE(0x171,8);
  bytes.writeUInt32LE(samples,0x18);bytes.writeUInt32LE(0xcc,0x34);bytes.writeUInt32LE(3579545,0xa4);bytes.set(commands,256);return{bytes,samples,segments:[]};
}

function installSilentAudit(){
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const contexts=[],nodes=[],meters=[],sources=[],commands=[];let request=0,lastWave=null;
  const begin=CanvasRenderingContext2D.prototype.beginPath,move=CanvasRenderingContext2D.prototype.moveTo,line=CanvasRenderingContext2D.prototype.lineTo,stroke=CanvasRenderingContext2D.prototype.stroke,fill=CanvasRenderingContext2D.prototype.fillRect,paths=new WeakMap();
  CanvasRenderingContext2D.prototype.fillRect=function(...args){if(this.canvas.id==='waveCanvas')lastWave=null;return fill.apply(this,args);};
  CanvasRenderingContext2D.prototype.beginPath=function(...args){if(this.canvas.id==='waveCanvas')paths.set(this,[]);return begin.apply(this,args);};
  for(const[name,original]of[['moveTo',move],['lineTo',line]])CanvasRenderingContext2D.prototype[name]=function(x,y){paths.get(this)?.push([x,y]);return original.call(this,x,y);};
  CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.canvas.id==='waveCanvas'&&this.strokeStyle==='#ffb04f'){
    const points=paths.get(this);if(points?.length===64)lastWave=Array.from({length:32},(_,i)=>Math.round((this.canvas.height-25-points[i*2][1])/(this.canvas.height-43)*31));
  }return stroke.apply(this,args);};
  window.AudioContext=class extends Context{
    constructor(...args){super(...args);contexts.push(this);}
    createBufferSource(){const source=super.createBufferSource(),item={started:false,stopped:false,ended:false};sources.push(item);
      const start=source.start,stop=source.stop;source.start=function(...args){item.started=true;return start.apply(this,args);};source.stop=function(...args){item.stopped=true;return stop.apply(this,args);};
      source.addEventListener('ended',()=>{item.ended=true;});return source;}
  };
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){if(data?.method){commands.push({method:data.method,args:data.method==='code'?data.args?.slice(0,2):[]});if(commands.length>1500)commands.shift();}return post.call(this,data,...args);};
  function output(){const active=meters.filter(item=>item.source.context.state==='running').map(item=>{
    const values=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(values);let sum=0,square=0,peak=0;
    for(const value of values){sum+=value;square+=value*value;peak=Math.max(peak,Math.abs(value));}
    return{rms:Math.sqrt(square/values.length),acRms:Math.sqrt(Math.max(0,square/values.length-(sum/values.length)**2)),peak,finite:values.every(Number.isFinite)};
  }).sort((a,b)=>b.acRms-a.acRms);return{...(active[0]??{rms:0,acRms:0,peak:0,finite:true}),muted:meters.every(item=>item.mute.gain.value===0)};}
  async function read(method='read'){
    const node=nodes.findLast(item=>item.name==='tetorica-huc6280-synth')?.node;if(!node)throw Error('HuC6280 author Worklet missing');const id=--request;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('HuC6280 audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Object.assign(Error(data.error),{name:data.name??'Error'})):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args:[]});});
  }
  window.__hucSongAudit={read,output,wave:()=>lastWave?.slice()??null,drain:()=>commands.splice(0),graph:()=>({contexts:contexts.length,runningContexts:contexts.filter(item=>item.state==='running').length,
    editorWorklets:nodes.filter(item=>item.name==='tetorica-huc6280-synth').length,destinationConnections:meters.length,muted:meters.every(item=>item.mute.gain.value===0),
    bufferSources:sources.length,liveSources:sources.filter(item=>item.started&&!item.stopped&&!item.ended).length})};
}
const graph=page=>page.evaluate(()=>__hucSongAudit.graph()),read=(page,method='read')=>page.evaluate(method=>__hucSongAudit.read(method),method);
const state=page=>page.evaluate(()=>{const node=document.querySelector('#hucSongPlayer');return{...node.dataset,phase:node.dataset.state,frame:Number(node.dataset.positionFrames),
  rendered:Number(node.dataset.renderedFrames),status:document.querySelector('#hucSongStatus').textContent,position:document.querySelector('#hucSongPosition').textContent,source:document.querySelector('#hucSongSelect').value};});
async function phase(page,expected){await until(()=>state(page).then(value=>value.phase===expected),'song '+expected);}
async function pcm(page,audible=true){let value;await until(async()=>{value=await page.evaluate(()=>__hucSongAudit.output());return value.muted&&value.finite&&(audible?value.acRms>.00005:value.peak<1e-7);},audible?'actual song PCM':'output silence');return value;}
async function files(page){if(await page.locator('#hucFilesPanel').isHidden())await page.locator('#hucFilesToggle').click();await until(()=>page.locator('#hucFileImportButton').isEnabled(),'Files ready');}
async function choose(page,value){await page.locator('#hucSongSelect').selectOption(value);await until(async()=>await page.locator('#hucSongSelect').inputValue()===value&&!await page.locator('#hucSongPlayButton').isDisabled(),'song selected');}
async function play(page){await page.locator('#hucSongPlayButton').click();await phase(page,'playing');}
async function pause(page){await page.locator('#hucSongPlayButton').click();await phase(page,'paused');await pcm(page,false);}
async function stop(page){await page.locator('#hucSongStopButton').click();await phase(page,'stopped');await pcm(page,false);assert.equal((await state(page)).frame,0);}
async function selectIndex(page){await files(page);for(let i=0;i<12;i++){const closed=page.locator('#hucFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#hucFilesTree [data-file-path="/index.js"]').click();await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});}
async function runCode(page){await page.locator('#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());},'Code running');}


const observe=page=>read(page,'observeEditor');
const view=page=>page.evaluate(()=>({tools:{...document.querySelector('#hucCodeLiveTools').dataset},editor:{...document.querySelector('#voiceEditor').dataset},
  channel:document.querySelector('#hucChannelSelect').value,auto:document.querySelector('#hucLiveEnabled').checked,inert:document.querySelector('#voiceEditor').inert,
  source:document.querySelector('#source [aria-checked=true]')?.dataset.choiceValue,volume:Number(document.querySelector('#volume').textContent),
  left:Number(document.querySelector('#panLeft').textContent),right:Number(document.querySelector('#panRight').textContent),noise:Number(document.querySelector('#noiseFrequency').textContent),
  lfo:document.querySelector('#lfoEnabled').checked,lfoRate:Number(document.querySelector('#lfoFrequency').textContent),
  status:document.querySelector('#hucChannelStatus').textContent,readout:document.querySelector('#hucChannelReadout').textContent,wave:__hucSongAudit.wave()}));
async function channel(page,value){await page.locator('#hucChannelSelect').selectOption(String(value));await until(()=>view(page).then(v=>v.channel===String(value)&&v.tools.channel===String(value)),'view '+value);}
async function releaseCode(page){await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(text=>/Stopped|Idle/.test(text)),'Code Stop');await pcm(page,false);}

async function check(browser,name,origin,fixture){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(25000);await page.addInitScript(installSilentAudit);
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await files(page);
    step('One always-visible Synth / CH1–6 selector defaults to the lazy common instrument and Auto update');
    assert(await page.locator('#hucCodeLiveTools').isVisible());assert.equal(await page.locator('#hucChannelSelect').inputValue(),'synth');
    assert(await page.locator('#hucLiveEnabled').isChecked());assert.equal(await page.locator('#hucChannelSelect option').count(),7);assert.equal((await graph(page)).contexts,0);
    assert.equal((await view(page)).tools.context,'synth');assert.match(await page.locator('#lfoCarrierPeriodLabel').textContent(),/CH1 period at C4/);
    await page.locator('#startAudio').click();await until(async()=>{try{return Boolean((await read(page)).preset);}catch{return false;}},'author Worklet ready');
    const original=(await read(page)).preset;

    step('Normal physical channel edits stay independent; choosing Synth and returning never unifies their values');
    await channel(page,0);await until(()=>view(page).then(v=>v.volume===original.volume),'normal CH1 settings');
    await page.locator('[data-stepper-for="volume"][data-stepper-delta="1"]').click();await until(async()=>(await observe(page)).registers[0][4]%32===25,'CH1 volume25');
    await channel(page,2);await until(()=>view(page).then(v=>v.volume===24),'normal CH3 untouched');await page.locator('[data-stepper-for="volume"][data-stepper-delta="-1"]').click();
    await until(async()=>(await observe(page)).registers[2][4]%32===23,'CH3 volume23');
    let normal=await observe(page);assert.equal(normal.registers[0][4]%32,25);assert.deepEqual((await read(page)).preset,original);
    await channel(page,'synth');await until(()=>view(page).then(v=>v.volume===original.volume),'common instrument view');
    assert.match(await page.locator('#lfoCarrierPeriodLabel').textContent(),/CH1 period at C4/);
    const afterSynth=await observe(page);assert.deepEqual(afterSynth.registers,normal.registers,'view-only Synth selection never folds physical settings');
    for(const[ch,volume]of[[0,25],[2,23],[0,25]]){await channel(page,ch);await until(()=>view(page).then(v=>v.volume===volume),'retained CH '+ch);}
    assert.deepEqual((await read(page)).preset,original);measurements.normalIndependent={ch1:25,ch3:23};

    step('Normal selected-CH keyboard and waveform drawing share the same voice; global Stop preserves its independent settings');
    const key=await page.locator('#keyboard .key:not([disabled])').first().getAttribute('data-key');assert(key);await page.locator('#synthTitle').click();await page.keyboard.down(key);
    await until(async()=>Boolean((await observe(page)).registers[0][4]&128),'normal keyboard uses CH1');await pcm(page);normal=await observe(page);
    assert(!(normal.registers[2][4]&128),'CH3 remains off');const canvas=page.locator('#waveCanvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();assert(box);
    await page.mouse.move(box.x+box.width*.2,box.y+box.height*.25);await page.mouse.down();await page.mouse.move(box.x+box.width*.55,box.y+box.height*.7,{steps:8});await page.mouse.up();
    await until(async()=>JSON.stringify((await observe(page)).waveforms[0])!==JSON.stringify(normal.waveforms[0]),'selected CH waveform drawing');
    const drawn=await observe(page);assert(drawn.registers[0][4]&128);assert.deepEqual(drawn.waveforms[2],normal.waveforms[2]);assert.deepEqual((await read(page)).preset,original);
    await page.keyboard.up(key);await pcm(page,false);await page.locator('#stopAudio').click();await pcm(page,false);const stopped=await observe(page);
    assert.equal(stopped.registers[0][4]%32,25);assert.equal(stopped.registers[2][4]%32,23);assert.deepEqual(stopped.waveforms[0],drawn.waveforms[0]);
    await channel(page,2);await until(()=>view(page).then(v=>v.volume===23),'CH3 survived global Stop');

    step('Code keeps the unified selected-CH editor and continues through keyboard-tab changes and sparse manual edits');
    await selectIndex(page);await page.locator('#synthCodeEditor').fill(`const pce=await useSoundChip('huc6280');\nawait pce.noteOn(CH3,'A3');\nawait pce.setVolume(CH3,11);\nglobalThis.__hucLiveCode=pce;\n`);
    await runCode(page);await channel(page,2);await until(()=>view(page).then(v=>v.tools.context==='code'&&v.volume===11),'Code CH3 view');await pcm(page);
    await page.locator('[data-stepper-for="volume"][data-stepper-delta="1"]').click();await until(async()=>(await read(page,'observeCode')).registers[2][4]%32===12,'manual Code CH3 volume');
    assert.equal((await read(page)).preset.volume,12);assert.equal((await view(page)).editor.readonly,'false');
    await page.locator('#synthInputKeyboardTab').click();assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);await pcm(page);
    await page.locator('#synthInputCodeTab').click();await releaseCode(page);assert.equal(await read(page,'observeCode'),null);
    const author=(await read(page)).preset;

    step('VGM Live follows the heard frame through one existing editor, never the prefetched future register changes');
    await page.locator('#vgmFileInput').setInputFiles({name:'six-channel-live.vgm',mimeType:'application/octet-stream',buffer:fixture.bytes});
    await until(()=>page.locator('#hucSongSelect option[value="/vgm/six-channel-live.vgm"]').count().then(Boolean),'Live VGM source');await choose(page,'/vgm/six-channel-live.vgm');
    await channel(page,0);await play(page);await pcm(page);const history=[];
    await until(async()=>{const song=await state(page),shown=await view(page);history.push({frame:song.frame,rendered:song.rendered,volume:shown.volume,period:shown.editor.period,wave:shown.wave,lfo:shown.lfo});return song.frame>50715;},'audible one-second boundary');
    const early=history.filter(v=>v.frame>4410&&v.frame<38367);assert(early.length>=2);assert(early.every(v=>v.volume===19&&Number(v.period)===500&&!v.lfo));assert(early.every(v=>JSON.stringify(v.wave)===JSON.stringify(wave)));
    const late=history.filter(v=>v.frame>48510);assert(late.length);assert(late.every(v=>v.volume===7&&Number(v.period)===250&&v.lfo));assert(late.every(v=>JSON.stringify(v.wave)===JSON.stringify(futureWave)));
    assert.match(await page.locator('#lfoCarrierPeriodLabel').textContent(),/CH1 period.*register/);assert.match(await page.locator('#lfoModulatorPeriodLabel').textContent(),/CH2 period.*register/);
    assert(history.some(v=>v.rendered>v.frame),'audible observation is tested against real render-ahead');measurements.heardBoundary=history;
    assert.deepEqual((await read(page)).preset,author);await pause(page);const frozenFrame=(await state(page)).frame;assert(frozenFrame<110250);

    step('Paused VGM CH1–6 preserve read-only source settings; configured Wave/Noise/LFO permit audition while DDA, unknown RAM and reserved CH2 remain blocked');
    const expected=[{ch:0,source:'wave',volume:7,left:6,right:12,period:250,wave:futureWave},{ch:1,source:'wave',volume:0,left:15,right:15,period:713,wave:futureWave},
      {ch:2,source:'wave',volume:22,left:15,right:15,period:1000,wave:thirdWave},{ch:3,source:'dda',volume:20,left:12,right:11,period:444,dac:27},
      {ch:4,source:'noise',volume:11,left:8,right:15,noise:3},{ch:5,source:'unknown',volume:12,left:9,right:15,period:666,unknown:true}];
    await page.evaluate(()=>__hucSongAudit.drain());measurements.pausedViews=[];
    for(const item of expected){await channel(page,item.ch);await until(()=>view(page).then(v=>v.tools.context==='vgm'&&v.volume===item.volume),'paused VGM CH'+item.ch);const shown=await view(page);
      assert.equal(shown.editor.readonly,'true');assert(await page.locator('[data-stepper-for="volume"][data-stepper-delta="1"]').isDisabled());
      assert(await page.locator('#lfoEnabled').isDisabled());assert.equal(shown.editor.source,item.source);assert.equal(shown.source,item.unknown?undefined:item.source);assert.equal(shown.left,item.left);assert.equal(shown.right,item.right);
      if(item.period)assert.equal(Number(shown.editor.period),item.period);if(item.noise!==undefined)assert.equal(shown.noise,item.noise);
      if(item.wave)assert.deepEqual(shown.wave,item.wave);if(item.dac!==undefined){assert.equal(Number(shown.editor.ddaValue),item.dac);assert.match(shown.readout,/DAC|DDA/);}
      if(item.unknown){assert.equal(shown.editor.waveKnown,'false');assert.equal(shown.wave,null,'unknown RAM has no invented waveform');assert.match(shown.readout,/unknown/i);}
      else if(item.wave)assert.equal(shown.editor.waveKnown,'true');
      assert.equal((await state(page)).frame,frozenFrame);const playable=[0,2,4].includes(item.ch),availableKeys=await page.locator('#keyboard .key:not([disabled])').count();
      assert.equal(availableKeys>0,playable,'paused configured audition eligibility CH'+(item.ch+1));
      assert.equal(await page.locator('#hucSongCaptureButton').isEnabled(),playable,'paused capture eligibility CH'+(item.ch+1));measurements.pausedViews.push(shown);
    }
    await page.locator('#synthTitle').click();await page.keyboard.down(key);await wait(80);await page.keyboard.up(key);await pcm(page,false);
    assert(!(await page.evaluate(()=>__hucSongAudit.drain())).some(cmd=>['noteOn','noteOff','setPreset','loadPreset','applyEditorEdit','applyCodeEdit'].includes(cmd.method)),'VGM observation never writes author chip');assert.deepEqual((await read(page)).preset,author);

    step('Auto Off freezes the entire six-CH snapshot across channel changes; On catches up, and Synth can audition while source stays paused');
    await channel(page,0);await page.locator('#hucLiveEnabled').uncheck();const frozenView=await view(page);await play(page);
    await until(()=>state(page).then(v=>v.frame>132300),'song advances past later changes');await channel(page,2);await until(()=>view(page).then(v=>v.volume===22),'frozen CH3 snapshot');
    await channel(page,0);assert.equal((await view(page)).volume,7);assert.equal(Number((await view(page)).editor.positionFrames),Number(frozenView.editor.positionFrames));
    await page.locator('#hucLiveEnabled').check();await until(()=>view(page).then(v=>v.volume===20&&Number(v.editor.period)===333),'Auto catches up');await channel(page,2);await until(()=>view(page).then(v=>v.volume===13),'Auto catches current CH3');
    await pause(page);const auditionFrame=(await state(page)).frame;await channel(page,'synth');await until(()=>view(page).then(v=>v.editor.readonly==='false'),'paused common editor');
    assert.equal((await view(page)).volume,author.volume);await page.locator('#synthInputKeyboardTab').click();await page.locator('#synthTitle').click();await page.keyboard.down(key);await pcm(page);await page.keyboard.up(key);await pcm(page,false);
    assert.equal((await state(page)).frame,auditionFrame);assert.deepEqual((await read(page)).preset,author);await channel(page,5);assert.equal((await view(page)).editor.readonly,'true');
    await stop(page);await until(()=>view(page).then(v=>v.tools.context==='synth'&&v.editor.readonly==='false'),'Stop returns to normal channel editing');assert.deepEqual((await read(page)).preset,author);

    step('Unified channel controls remain usable at desktop and 390px, and pagehide retires the only audio route');
    await channel(page,0);await play(page);await until(()=>state(page).then(v=>v.frame>48510),'screenshot live source');await pause(page);await channel(page,5);
    for(const width of[1240,390]){await page.setViewportSize({width,height:1050});await page.locator('#hucCodeLiveTools').scrollIntoViewIfNeeded();
      const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('#hucCodeLiveTools select,#hucCodeLiveTools input,#hucSongPlayer select,#hucSongPlayer button')].map(node=>({id:node.id,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}))}));
      assert(bounds.scroll<=width+1,'Live layout fits '+width);assert(bounds.controls.every(item=>item.left>=-1&&item.right<=width+1));measurements['layout'+width]=bounds;
      await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});}
    measurements.graph=await graph(page);assert.equal(measurements.graph.contexts,1);assert.equal(measurements.graph.editorWorklets,1);assert.equal(measurements.graph.destinationConnections,1);assert(measurements.graph.muted);
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await until(()=>graph(page).then(v=>v.runningContexts===0&&v.liveSources===0),'pagehide retires route');
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);return{browser:name,passed:true,checks,measurements,graph:await graph(page),pageErrors:errors,consoleErrors};
  }catch(error){const diagnostic={stage,song:await state(page).catch(()=>null),view:await view(page).catch(()=>null),audio:await page.locator('#audioStatus').textContent().catch(()=>''),
    code:await page.locator('#synthCodeState').textContent().catch(()=>''),codeError:await page.locator('#synthCodeError').textContent().catch(()=>''),graph:await graph(page).catch(()=>null),commands:await page.evaluate(()=>__hucSongAudit.drain()).catch(()=>[])};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});
    error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors:errors,consoleErrors};throw error;
  }finally{await page.close();}
}

const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);res.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const fixture=makeFixture();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
    try{results.push(await check(browser,name,origin,fixture));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,checkerSha256:hash(await fs.readFile(__filename)),
    fixture:{bytes:fixture.bytes.length,sha256:hash(fixture.bytes),samples:fixture.samples,segments:fixture.segments},results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
