// SPDX-License-Identifier: BSD-3-Clause
// Original VGM / VGZ, actual DMG APU, headless only. Intercept every speaker
// destination before app JS and force gain zero; Chromium is muted as well.
// node scripts/check_dmg_synth_song_capture_browser.cjs --root=docs --entry=/synth-dmg/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os'),{gzipSync}=require('node:zlib');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-dmg/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'dmg-synth-song-capture-browser.json'),screenshots:path.join(tmpdir(),'dmg-synth-song-capture-browser')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map(),missing=[],external=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function until(predicate,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(25);}throw Error('Timeout: '+label);}

function installSilentAudit(){
  const nativeConnect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const contexts=[],nodes=[],meters=[],commands=[],sources=[];let sequence=0,lastWave=null;
  window.AudioContext=class extends Context{
    constructor(...args){super(...args);contexts.push(this);}
    createBufferSource(){const source=super.createBufferSource(),item={node:source,started:false,stopped:false,ended:false};sources.push(item);
      const start=source.start,stop=source.stop;source.start=function(...args){item.started=true;return start.apply(this,args);};
      source.stop=function(...args){item.stopped=true;return stop.apply(this,args);};source.addEventListener('ended',()=>{item.ended=true;});return source;}
  };
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return nativeConnect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=2048;mute.gain.value=0;
    nativeConnect.call(this,analyser,...args);nativeConnect.call(analyser,mute);nativeConnect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){if(data?.method){commands.push({method:data.method,args:data.args});if(commands.length>10000)commands.shift();}return post.call(this,data,...args);};
  // Record the existing Wave RAM path without adding an app observation API.
  const begin=CanvasRenderingContext2D.prototype.beginPath,move=CanvasRenderingContext2D.prototype.moveTo,line=CanvasRenderingContext2D.prototype.lineTo,stroke=CanvasRenderingContext2D.prototype.stroke;
  const paths=new WeakMap();CanvasRenderingContext2D.prototype.beginPath=function(...args){if(this.canvas.id==='waveCanvas')paths.set(this,[]);return begin.apply(this,args);};
  for(const [name,original]of [['moveTo',move],['lineTo',line]])CanvasRenderingContext2D.prototype[name]=function(x,y){paths.get(this)?.push([x,y]);return original.call(this,x,y);};
  CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.canvas.id==='waveCanvas'&&this.strokeStyle==='#c6dd95'){
    const points=paths.get(this);if(points?.length===64)lastWave=Array.from({length:32},(_,i)=>Math.round((this.canvas.height-25-points[i*2][1])/(this.canvas.height-43)*15));
  }return stroke.apply(this,args);};
  const arrayBuffer=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){if(this.name==='slow.vgm')await new Promise(resolve=>setTimeout(resolve,500));return arrayBuffer.call(this);};
  async function read(method='read'){
    const node=nodes.findLast(item=>item.name==='tetorica-gameboy-synth')?.node;if(!node)throw Error('DMG editor Worklet missing');const id=--sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('DMG audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args:[]});});
  }
  function output(){const samples=meters.filter(item=>item.source.context.state==='running').map(item=>{
    const pcm=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(pcm);let square=0,peak=0;for(const value of pcm){square+=value*value;peak=Math.max(peak,Math.abs(value));}
    return{rms:Math.sqrt(square/pcm.length),peak,finite:pcm.every(Number.isFinite)};
  }).sort((a,b)=>b.rms-a.rms);return{...(samples[0]??{rms:0,peak:0,finite:true}),muted:meters.every(item=>item.mute.gain.value===0)};}
  window.__dmgSongAudit={read,output,wave:()=>lastWave?.slice(),drain:()=>commands.splice(0),
    graph:()=>({contexts:contexts.length,runningContexts:contexts.filter(item=>item.state==='running').length,editorWorklets:nodes.filter(item=>item.name==='tetorica-gameboy-synth').length,
      destinationConnections:meters.length,muted:meters.every(item=>item.mute.gain.value===0),bufferSources:sources.length,liveSources:sources.filter(item=>item.started&&!item.stopped&&!item.ended).length})};
}
const read=(page,method='read')=>page.evaluate(method=>__dmgSongAudit.read(method),method);
const state=page=>page.evaluate(()=>({phase:document.querySelector('#dmgSongPlayer').dataset.state,frame:Number(document.querySelector('#dmgSongPlayer').dataset.positionFrames),
  rendered:Number(document.querySelector('#dmgSongPlayer').dataset.renderedFrames),
  duty:document.querySelector('#pulseDuty [aria-checked=true]')?.dataset.choiceValue,source:document.querySelector('#source [aria-checked=true]')?.dataset.choiceValue,
  status:document.querySelector('#dmgSongStatus').textContent,live:document.querySelector('#dmgChannelStatus').textContent,readonly:document.querySelector('#voiceEditor').dataset.readonly}));
async function phase(page,expected){await until(()=>state(page).then(value=>value.phase===expected),'song '+expected);}
async function pcm(page,audible=true){let value;await until(async()=>{value=await page.evaluate(()=>__dmgSongAudit.output());return value.muted&&value.finite&&(audible?value.rms>.0001:value.peak<1e-7);},audible?'real song PCM':'output silence');return value;}
async function files(page){if(await page.locator('#dmgFilesPanel').isHidden())await page.locator('#dmgFilesToggle').click();await until(()=>page.locator('#dmgFileImportButton').isEnabled(),'Files ready');}
async function play(page){await page.locator('#dmgSongPlayButton').click();await phase(page,'playing');}
async function pause(page){await page.locator('#dmgSongPlayButton').click();await phase(page,'paused');}
async function stop(page){await page.locator('#dmgSongStopButton').click();await phase(page,'stopped');await pcm(page,false);}
async function choose(page,value){await page.locator('#dmgSongSelect').selectOption(value);await until(async()=>!await page.locator('#dmgSongPlayButton').isDisabled()&&await page.locator('#dmgSongSelect').inputValue()===value,'song selected');}
async function download(page,selector){if(await page.locator(selector).evaluate(node=>Boolean(node.closest('#synthMenu')))&&!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();const event=page.waitForEvent('download');await page.locator(selector).click();const item=await event,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);}


const trialState=page=>page.evaluate(()=>{const node=document.querySelector('#dmgSongPlayer');return{
  phase:node.dataset.state,frame:Number(node.dataset.positionFrames),rendered:Number(node.dataset.renderedFrames),view:node.dataset.view,
  state:node.dataset.auditionState,held:Number(node.dataset.auditionHeld),sounding:Number(node.dataset.auditionSounding),
  channel:document.querySelector('#dmgChannelSelect').value,status:document.querySelector('#dmgSongStatus').textContent};});
async function view(page,channel){await page.locator('#dmgChannelSelect').selectOption(String(channel));await until(()=>trialState(page).then(value=>value.view===(channel==='synth'?'synth':'song')),'selected view');}
async function paused(page,path='/vgm/reference.vgm',minimum=7000){
  await choose(page,path);await view(page,0);await play(page);await until(()=>trialState(page).then(value=>value.frame>=minimum),'song reaches paused test position');
  await pause(page);return trialState(page);
}
function noteMidi(note){const match=/^([A-G])(#?)(-?\d+)$/.exec(note);assert(match,'Keyboard note '+note);return(Number(match[3])+1)*12+({C:0,D:2,E:4,F:5,G:7,A:9,B:11})[match[1]]+(match[2]?1:0);}
function fixed(actual,expected){assert.equal(actual.phase,'paused');assert.equal(actual.frame,expected.frame);assert.equal(actual.rendered,expected.rendered);}
const CODE_HOLD=`const gb=await useSoundChip('gameboy');\nawait gb.initialize();\nawait gb.pulse.setVoice(0,{duty:.5,volume:5,envelope:{direction:'down',period:0}});\nawait gb.pulse.noteOn(0,'C4');\n`;
async function trial(page,key='z'){
  const midi=noteMidi(await page.locator(`#keyboard .key[data-key="${key}"] span`).textContent());
  await page.keyboard.down(key);await until(async()=>{
    const value=await trialState(page);if(value.state!=='ready'||value.sounding!==1)return false;
    const raw=await read(page,'observeCode');if(!raw)return false;const channel=Number(value.channel);
    if(channel===3)return true;
    const period=Math.round(2048-4194304/((channel===2?64:32)*(440*2**((midi-69)/12))));
    return(raw.registers[channel*5+3]|((raw.registers[channel*5+4]&7)<<8))===period;
  },'paused trial KON');await pcm(page);return read(page,'observeCode');
}
async function releaseTrial(page,key='z'){await page.keyboard.up(key);await until(()=>trialState(page).then(value=>value.held===0&&value.sounding===0),'paused trial key-up');await pcm(page,false);}

async function check(browser,name,origin,fixture,loadCassette){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),pageErrors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(20000);page.on('pageerror',error=>pageErrors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installSilentAudit);
  // Delay one genuine outgoing checkpoint acquisition; released using the
  // original MessagePort function, never by synthetic keyboard events.
  await page.addInitScript(()=>{const post=MessagePort.prototype.postMessage;let holding=false,method='beginCode',held=[];
    MessagePort.prototype.postMessage=function(data,...args){if(holding&&data?.method===method){held.push({port:this,data,args});return;}return post.call(this,data,...args);};
    window.__trialDelay={begin(){method='beginCode';holding=true;},capture(){method='loadPreset';holding=true;},count:()=>held.length,
      release(holdNext=false){holding=holdNext;for(const item of held.splice(0))post.call(item.port,item.data,...item.args);}};
  });
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await files(page);
    const sweep=Buffer.from(fixture.bytes);for(let index=256;index<sweep.length&&sweep[index]===0xb3;index+=3)if(sweep[index+1]===0){sweep[index+2]=0x19;break;}
    await page.locator('#dmgFilesInput').setInputFiles([
      {name:'reference.vgm',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)},
      {name:'sweep.vgm',mimeType:'application/octet-stream',buffer:sweep},
    ]);
    await until(()=>page.locator('#dmgSongSelect option[value="/vgm/reference.vgm"]').count().then(Boolean),'original VGM imported');
    assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0);assert(await page.locator('#dmgSongCaptureButton').isHidden()||await page.locator('#dmgSongCaptureButton').isDisabled());
    await page.locator('#startAudio').click();await until(async()=>{try{return Boolean((await read(page)).preset);}catch{return false;}},'author APU');const author=await read(page);
    await page.locator('#dmgFilesToggle').click();

    step('Paused physical CH1–4 audition the configured song sound on the existing editor APU');
    const frozen=await paused(page),beforeGraph=await page.evaluate(()=>__dmgSongAudit.graph());
    const keyMidi=noteMidi(await page.locator('#keyboard .key[data-key="z"] span').textContent());
    for(let channel=0;channel<4;channel++){
      await view(page,channel);const raw=await trial(page);assert(raw);fixed(await trialState(page),frozen);
      if(channel<2){assert.equal(raw.voice[channel*5+1]>>6,channel===0?1:2);assert.equal(raw.voice[channel*5+2]>>4,channel===0?7:5);}
      if(channel===2)assert.deepEqual(raw.registers.slice(32,48),Array.from({length:16},(_,i)=>(fixture.initialWave[i*2]<<4)|fixture.initialWave[i*2+1]));
      if(channel===3)assert.equal(raw.voice[18],0x43);
      else{const period=Math.round(2048-4194304/((channel===2?64:32)*(440*2**((keyMidi-69)/12))));assert.equal(raw.registers[channel*5+3]|((raw.registers[channel*5+4]&7)<<8),period);}
      assert.deepEqual((await read(page)).preset,author.preset);assert.deepEqual((await read(page)).registers.slice(32,48),author.registers.slice(32,48));
      await releaseTrial(page);fixed(await trialState(page),frozen);
    }
    const graph=await page.evaluate(()=>__dmgSongAudit.graph());assert.equal(graph.contexts,1);assert.equal(graph.editorWorklets,1);assert.equal(graph.destinationConnections,1);assert.equal(graph.bufferSources,beforeGraph.bufferSources,'trials never schedule reference-song buffers');assert(graph.muted);
    measurements.graph=graph;

    step('Noise ignores keyboard pitch; pointer and overlapping key releases retain one selected-channel owner');
    await view(page,3);const low=await trial(page,'z');await releaseTrial(page,'z');const high=await trial(page,'q');
    assert.equal(low.voice[18],high.voice[18]);assert.deepEqual([3,4,8,9,13,14].map(i=>low.registers[i]),[3,4,8,9,13,14].map(i=>high.registers[i]));await releaseTrial(page,'q');
    await view(page,2);const button=page.locator('#keyboard .key[data-key="z"]');await button.hover();await page.mouse.down();
    await until(()=>trialState(page).then(value=>value.sounding===1),'pointer trial');await pcm(page);await page.mouse.up();await until(()=>trialState(page).then(value=>value.sounding===0),'pointer release');await pcm(page,false);
    await trial(page,'z');await trial(page,'x');await page.keyboard.up('z');await pcm(page);
    assert.equal((await trialState(page)).sounding,1,'a stolen key-up must not stop the newer note');await releaseTrial(page,'x');
    await page.locator('#octaveDown').click();await page.locator('#octaveDown').click();
    assert.equal(await page.locator('#keyboard .key[data-key="f"] span').textContent(),'C1');
    const lowest=await trial(page,'f'),periodBefore=lowest.registers[13]|((lowest.registers[14]&7)<<8);
    await page.locator('#keyboardPitchBend').evaluate(input=>{input.value='-2';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await until(()=>page.locator('#audioStatus').textContent().then(value=>/frequency range/i.test(value)),'out-of-range low Wave pitch reported');
    assert.equal(await page.locator('#keyboardPitchBend').inputValue(),'0');assert.equal((await trialState(page)).sounding,1);
    const afterInvalid=await read(page,'observeCode');assert.equal(afterInvalid.registers[13]|((afterInvalid.registers[14]&7)<<8),periodBefore);await pcm(page);
    await releaseTrial(page,'f');await page.locator('#octaveUp').click();await page.locator('#octaveUp').click();
    fixed(await trialState(page),frozen);

    step('Early key-up cannot leak a late trigger; CH1 alone retains hardware Sweep');
    await view(page,0);await until(async()=>await read(page,'observeCode')===null,'previous trial checkpoint restored');
    await page.evaluate(()=>__trialDelay.begin());await page.keyboard.down('z');await until(()=>page.evaluate(()=>__trialDelay.count()).then(value=>value===1),'deferred trial lease');
    await page.keyboard.up('z');await page.evaluate(()=>__trialDelay.release());
    await until(()=>trialState(page).then(value=>value.held===0&&value.sounding===0&&!['preparing','stopping'].includes(value.state)),'cancelled early key');await pcm(page,false);
    assert.equal(await read(page,'observeCode'),null);fixed(await trialState(page),frozen);assert.deepEqual((await read(page)).preset,author.preset);
    await stop(page);const sweepFrame=await paused(page,'/vgm/sweep.vgm');await view(page,0);assert.equal((await trial(page)).voice[0],0x19);await releaseTrial(page);
    await view(page,1);assert.equal((await trial(page)).voice[0]&0x77,0);await releaseTrial(page);fixed(await trialState(page),sweepFrame);await stop(page);

    step('Cancelled Capture rollback finishes before a later Code owner and leaves no partially saved presets');
    await paused(page);await view(page,2);await page.evaluate(()=>__trialDelay.capture());
    await page.locator('#dmgSongCaptureButton').click();await until(()=>page.evaluate(()=>__trialDelay.count()).then(value=>value===1),'deferred captured instrument write');
    await stop(page);assert(await page.locator('#dmgSongCaptureButton').isHidden()||await page.locator('#dmgSongCaptureButton').isDisabled());
    await page.evaluate(()=>__trialDelay.release(true));
    await until(async()=>await page.evaluate(()=>__trialDelay.count())===1&&await page.locator('#dmgFilesPanel').getAttribute('aria-busy')==='false','deferred rollback after Files unlock');
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(CODE_HOLD);
    await page.locator('#synthCodeRunButton').click();await wait(120);
    assert.equal(await read(page,'observeCode'),null,'Code cannot borrow the APU until old Capture rollback completes');
    assert.equal((await trialState(page)).phase,'stopped');await pcm(page,false);
    await page.evaluate(()=>__trialDelay.release());await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Running|Playing/.test(value)),'Code after cancelled Capture rollback');
    assert(await read(page,'observeCode'));await pcm(page);assert.deepEqual((await read(page)).preset,author.preset);
    await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'post-cancel Code Stop');await pcm(page,false);
    await files(page);const cancelledProject=await loadCassette(await download(page,'#dmgProjectExportButton'));
    assert.equal([...cancelledProject.files.keys()].filter(filename=>/^presets\/.*\.json$/.test(filename)).length,0,'cancelled Capture saves neither candidate preset');
    measurements.cancelledCapture={authorRestored:true,presetsCommitted:0,codeWaitedForRollback:true};await page.locator('#synthInputKeyboardTab').click();

    step('Capture preserves Pause and saves both original and captured portable presets without changing song bytes');
    const captureFrame=await paused(page);await view(page,2);await trial(page);await releaseTrial(page);
    await page.locator('#dmgSongCaptureButton').click();await until(()=>trialState(page).then(value=>value.view==='synth'&&value.phase==='paused'),'captured Synth view');
    await until(()=>page.locator('#voiceEditor').getAttribute('data-readonly').then(value=>value==='false'),'captured editor enabled');
    fixed(await trialState(page),captureFrame);assert.equal(await page.locator('#dmgChannelSelect').inputValue(),'synth');assert(await page.locator('#dmgAutoUpdate').isChecked());
    const captured=(await read(page)).preset;assert.equal(captured.source,'wave');assert.deepEqual(captured.wave.samples,fixture.initialWave);assert.equal(captured.wave.level,.5);
    assert.equal(await read(page,'observeCode'),null);assert(await page.locator('#dmgSongCaptureButton').isHidden()||await page.locator('#dmgSongCaptureButton').isDisabled());
    await files(page);const projectBytes=await download(page,'#dmgProjectExportButton'),project=await loadCassette(projectBytes),json=[];
    for(const [filename,bytes]of project.files)if(/^presets\/.*\.json$/.test(filename))json.push({filename,value:JSON.parse(Buffer.from(bytes).toString('utf8'))});
    assert.equal(json.length,2);assert(json.some(item=>JSON.stringify(item.value)===JSON.stringify(author.preset)));const saved=json.find(item=>JSON.stringify(item.value)===JSON.stringify(captured));assert(saved);measurements.savedPresets=json.map(item=>item.filename);
    assert.deepEqual(Buffer.from(project.files.get('vgm/reference.vgm')),Buffer.from(fixture.bytes));assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard');
    await page.locator('#dmgSongPlayer').scrollIntoViewIfNeeded();await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-capture-synth.png'),fullPage:true});

    step('Editing the captured Synth preserves the original frozen CH view and Resume continues the original song');
    await page.locator('[data-wave-shape="saw"]').click();await until(async()=>JSON.stringify((await read(page)).preset.wave.samples)===JSON.stringify(fixture.sawWave),'captured Wave edited');
    const edited=(await read(page)).preset;fixed(await trialState(page),captureFrame);
    await page.keyboard.down('z');await until(async()=>Boolean((await read(page)).voices.length),'captured author keyboard note');await pcm(page);
    await view(page,2);await until(async()=>(await read(page)).voices.length===0,'Synth held owner cleared before song channel');await pcm(page,false);await page.keyboard.up('z');
    assert.deepEqual(await page.evaluate(()=>__dmgSongAudit.wave()),fixture.initialWave);fixed(await trialState(page),captureFrame);
    await trial(page);await releaseTrial(page);assert.deepEqual((await read(page)).preset,edited);
    await view(page,'synth');assert.deepEqual(await page.evaluate(()=>__dmgSongAudit.wave()),fixture.sawWave);
    await play(page);await until(()=>trialState(page).then(value=>value.frame>captureFrame.frame+2205),'Resume after Capture');assert.deepEqual((await read(page)).preset,edited);await pcm(page);await stop(page);

    step('Resume and Code start retire paused trials; old key releases cannot stop the next owner');
    await paused(page);await view(page,2);await trial(page);await play(page);await page.keyboard.up('z');await phase(page,'playing');await pcm(page);assert.equal(await read(page,'observeCode'),null);await stop(page);
    await paused(page);await view(page,0);await trial(page);await files(page);await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    // Capture prepared a JSON path without changing mode. Select JS explicitly.
    for(let i=0;i<8;i++){const closed=page.locator('#dmgFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
    await page.locator('#dmgFilesTree button[data-file-path="/index.js"]').click();
    await page.locator('#synthCodeEditor').fill(CODE_HOLD);
    await page.locator('#synthCodeRunButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Running|Playing/.test(value)),'Code after trial');
    await page.keyboard.up('z');assert.equal((await trialState(page)).phase,'stopped');assert(await read(page,'observeCode'));await pcm(page);
    await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Code stopped');await pcm(page,false);
    assert.deepEqual((await read(page)).preset,edited);

    step('Captured JSON round-trips without autoplay; 390px views fit and pagehide disposes a held trial');
    await page.locator('#dmgProjectFileInput').setInputFiles({name:'capture-project.zip',mimeType:'application/zip',buffer:projectBytes});
    await until(()=>page.locator('#dmgFilesStatus').textContent().then(value=>/imported|loaded/i.test(value)),'project JSON roundtrip');
    await until(()=>page.evaluate(expected=>new Promise(resolve=>{const open=indexedDB.open('tetorica-dmg-synth-files',1);open.onerror=()=>resolve(false);open.onsuccess=()=>{
      const db=open.result,request=db.transaction('projects','readonly').objectStore('projects').get('current');request.onerror=()=>{db.close();resolve(false);};request.onsuccess=()=>{db.close();resolve(request.result?.codeState?.path===expected&&request.result?.codeState?.mode==='keyboard');};
    };}),'/'+saved.filename),'persisted captured JSON selection');await page.reload();await files(page);
    assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0);assert.notEqual((await trialState(page)).phase,'playing');
    for(let i=0;i<8;i++){const closed=page.locator('#dmgFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
    await page.locator('#dmgFilesTree button[data-file-path]').locator(`xpath=self::*[@data-file-path=${JSON.stringify('/'+saved.filename)}]`).click();
    await page.locator('#startAudio').click();await until(async()=>{try{return JSON.stringify((await read(page)).preset)===JSON.stringify(captured);}catch{return false;}},'saved captured preset explicitly restored');
    assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard');
    await paused(page);await view(page,2);
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await page.locator('#dmgSongPlayer').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'captured song layout '+width);await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});}
    await trial(page);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await until(()=>page.evaluate(()=>__dmgSongAudit.graph()).then(value=>value.runningContexts===0&&value.liveSources===0),'pagehide closes paused trial output');
    const finalGraph=await page.evaluate(()=>__dmgSongAudit.graph());assert(finalGraph.muted);assert.deepEqual(pageErrors,[]);assert.deepEqual(consoleErrors,[]);
    return{browser:name,passed:true,checks,measurements,graph:finalGraph,pageErrors,consoleErrors};
  }catch(error){const diagnostic={stage,state:await trialState(page).catch(()=>null),audio:await page.locator('#audioStatus').textContent().catch(()=>''),audition:await page.locator('#dmgSongAuditionStatus').textContent().catch(()=>''),files:await page.locator('#dmgFilesStatus').textContent().catch(()=>''),code:await page.locator('#synthCodeState').textContent().catch(()=>''),codeError:await page.locator('#synthCodeError').textContent().catch(()=>''),commands:await page.evaluate(()=>__dmgSongAudit.drain()).catch(()=>[])};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});
    error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors,consoleErrors};throw error;
  }finally{await page.evaluate(()=>__trialDelay.release()).catch(()=>{});await page.close();}
}
const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const {createDmgSongFixture,DMG_SONG_INITIAL_WAVE}=await import(pathToFileURL(path.join(repo,'test/helpers/dmg_synth_song_fixture.mjs')).href);
  const {loadPlaygroundCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href);
  const {waveShape}=await import(pathToFileURL(path.join(repo,'docs/synth-dmg/preset.js')).href),fixture={...createDmgSongFixture(),initialWave:DMG_SONG_INITIAL_WAVE,sawWave:waveShape('saw')};
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
    try{results.push(await check(browser,name,origin,fixture,loadPlaygroundCassette));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,missing,external,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');
  if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
