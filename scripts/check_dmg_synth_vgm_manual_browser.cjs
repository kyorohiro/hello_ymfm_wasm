// VGM and manual DMG controls share one reference APU, without stopping the song.
// Headless only: every destination is intercepted before app JS at gain zero,
// and Chromium additionally runs with --mute-audio. No OS audio is changed.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-dmg/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'dmg-synth-vgm-manual-browser.json'),screenshots:path.join(tmpdir(),'dmg-synth-vgm-manual-browser')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map(),missing=[],external=[],httpErrors=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function until(predicate,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(30);}throw Error('Timeout: '+label);}

function installSilentAudit(){
  const nativeConnect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const contexts=[],nodes=[],meters=[],commands=[];let sequence=0,lastWave=null;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return nativeConnect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=2048;mute.gain.value=0;
    nativeConnect.call(this,analyser,...args);nativeConnect.call(analyser,mute);nativeConnect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){if(data?.method){commands.push({method:data.method,args:data.args});if(commands.length>10000)commands.shift();}return post.call(this,data,...args);};
  const paths=new WeakMap(),begin=CanvasRenderingContext2D.prototype.beginPath,move=CanvasRenderingContext2D.prototype.moveTo,line=CanvasRenderingContext2D.prototype.lineTo,stroke=CanvasRenderingContext2D.prototype.stroke;
  CanvasRenderingContext2D.prototype.beginPath=function(...args){if(this.canvas.id==='waveCanvas')paths.set(this,[]);return begin.apply(this,args);};
  for(const [key,original]of [['moveTo',move],['lineTo',line]])CanvasRenderingContext2D.prototype[key]=function(x,y){paths.get(this)?.push([x,y]);return original.call(this,x,y);};
  CanvasRenderingContext2D.prototype.stroke=function(...args){const points=paths.get(this);if(this.canvas.id==='waveCanvas'&&this.strokeStyle==='#c6dd95'&&points?.length===64)
    lastWave=Array.from({length:32},(_,i)=>Math.round((this.canvas.height-25-points[i*2][1])/(this.canvas.height-43)*15));return stroke.apply(this,args);};
  async function read(method='read'){
    const node=nodes.findLast(item=>item.name==='tetorica-gameboy-synth')?.node;if(!node)throw Error('DMG editor Worklet missing');const id=--sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('DMG audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args:[]});});
  }
  function output(){const values=meters.filter(item=>item.source.context.state==='running').map(item=>{
    const pcm=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(pcm);let square=0,peak=0;for(const value of pcm){square+=value*value;peak=Math.max(peak,Math.abs(value));}
    return{rms:Math.sqrt(square/pcm.length),peak,finite:pcm.every(Number.isFinite)};
  }).sort((a,b)=>b.rms-a.rms);return{...(values[0]??{rms:0,peak:0,finite:true}),muted:meters.every(item=>item.mute.gain.value===0)};}
  window.__dmgManualAudit={read,output,wave:()=>lastWave?.slice(),drain:()=>commands.splice(0),graph:()=>({contexts:contexts.length,
    editorWorklets:nodes.filter(item=>item.name==='tetorica-gameboy-synth').length,destinationConnections:meters.length,muted:meters.every(item=>item.mute.gain.value===0)})};
}
const read=(page,method='read')=>page.evaluate(method=>__dmgManualAudit.read(method),method);
const view=page=>page.evaluate(()=>({target:document.getElementById('dmgChannelSelect').value,auto:document.getElementById('dmgAutoUpdate').checked,
  status:document.getElementById('dmgChannelStatus').textContent,readout:document.getElementById('dmgChannelReadout').textContent,
  source:document.querySelector('#source [aria-checked=true]')?.dataset.choiceValue,duty:document.querySelector('#pulseDuty [aria-checked=true]')?.dataset.choiceValue,
  inputMode:document.getElementById('synthInputSection').dataset.inputMode,readonly:document.getElementById('voiceEditor').dataset.readonly,song:document.getElementById('dmgSongPlayer').dataset.state,
  frame:Number(document.getElementById('dmgSongPlayer').dataset.positionFrames),rendered:Number(document.getElementById('dmgSongPlayer').dataset.renderedFrames)}));
async function select(page,target){await page.locator('#dmgChannelSelect').selectOption(String(target));await until(()=>view(page).then(state=>state.target===String(target)),'target '+target);}
async function pcm(page,audible=true){let value;await until(async()=>{value=await page.evaluate(()=>__dmgManualAudit.output());return value.muted&&value.finite&&(audible?value.rms>.0001:value.peak<1e-7);},audible?'actual finite PCM':'output silence');return value;}
// Deliberately fast, like a real spinbutton gesture: Live must not rewind its
// just-edited field between these events. Do not await a native ACK per step.
async function number(page,id,value){await page.locator('#'+id).focus();await page.keyboard.press('Home');for(let i=0;i<value;i++)await page.keyboard.press('ArrowRight');await page.locator('#'+id).evaluate(node=>node.blur());await until(()=>page.locator('#'+id).textContent().then(text=>Number(text)===value),id+'='+value);}
const choice=(page,id,value)=>page.locator(`[data-choice-for="${id}"][data-choice-value="${value}"]`).click();
async function files(page){if(await page.locator('#dmgFilesPanel').isHidden())await page.locator('#dmgFilesToggle').click();await until(()=>page.locator('#dmgFileImportButton').isEnabled(),'Files ready');}
async function source(page,text){await files(page);for(let i=0;i<10;i++){const closed=page.locator('#dmgFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}await page.locator('#dmgFilesTree button.file-entry').locator('xpath=self::*[@data-file-path="/index.js"]').click();
  await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(text);}
async function run(page){await page.locator('#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());},'Code running');}
const period=(raw,ch)=>raw.registers[ch*5+3]|((raw.registers[ch*5+4]&7)<<8);

// The application already imports this exact class. Observe the existing factory
// rather than making another APU, asking the chip for extra PCM, or changing RAM.
async function installReferenceAudit(page){await page.evaluate(async()=>{
  const url=performance.getEntriesByType('resource').map(item=>item.name).find(name=>/\/gameboyapuaudioengine\.js(?:\?|$)/.test(name));
  if(!url)throw Error('Reference engine module was not imported');
  const {GameboyApuAudioEngine}=await import(url),create=GameboyApuAudioEngine.create,records=[];let next=0;
  GameboyApuAudioEngine.create=async function(...args){
    const engine=await create.apply(this,args),record={id:++next,closed:false,resets:0,frames:0,processCalls:0,finite:true,registers:Array(48).fill(0),writes:[]};records.push(record);
    const write=engine.writeGameboyApu,reset=engine.reset,process=engine.processFrames,dispose=engine.dispose;
    engine.writeGameboyApu=function(register,value){const result=write.call(this,register,value);
      record.writes.push({frame:record.frames,register,value});if(record.writes.length>20000)record.writes.shift();
      if(register>=0&&register<48){if(register===22&&!(value&128))record.registers.fill(0,0,23);record.registers[register]=[4,9,14,19].includes(register)?value&127:value;}
      return result;};
    engine.reset=function(...values){const result=reset.apply(this,values);record.resets++;record.frames=0;record.registers.fill(0);return result;};
    engine.processFrames=function(frames){const pcm=process.call(this,frames);record.frames+=frames;record.processCalls++;for(const values of [pcm.left,pcm.right])for(const sample of values)if(!Number.isFinite(sample))record.finite=false;return pcm;};
    engine.dispose=function(...values){record.closed=true;return dispose.apply(this,values);};return engine;
  };
  window.__dmgReferenceAudit={read:()=>structuredClone(records),current:()=>structuredClone(records.findLast(item=>!item.closed)??null)};
});}
const reference=page=>page.evaluate(()=>__dmgReferenceAudit.current());
const manualView=page=>page.evaluate(()=>{const root=document.getElementById('dmgSongPlayer');return{
  state:root.dataset.state,frame:Number(root.dataset.positionFrames),rendered:Number(root.dataset.renderedFrames),canInteract:root.dataset.canInteract==='true',held:Number(root.dataset.manualHeld),run:root.dataset.interactionRun,
  target:document.getElementById('dmgChannelSelect').value,auto:document.getElementById('dmgAutoUpdate').checked,readonly:document.getElementById('voiceEditor').dataset.readonly,
  duty:document.querySelector('#pulseDuty [aria-checked=true]')?.dataset.choiceValue,volume:document.getElementById('pulseVolume').textContent,inputMode:document.getElementById('synthInputSection').dataset.inputMode,
  status:document.getElementById('dmgChannelStatus').textContent};});
async function keyboard(page){await page.locator('#synthInputKeyboardTab').click();await until(()=>manualView(page).then(value=>value.inputMode==='keyboard'),'Keyboard view ready');}
async function seek(page,seconds,state='playing'){
  await page.locator('#dmgSongSeek').evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},seconds);
  await until(()=>manualView(page).then(value=>value.state===state&&value.frame>=Math.round(seconds*44100)&&value.frame<Math.round(seconds*44100)+8820),'seek '+seconds+' to '+state);
}
async function fileRow(page,name){await files(page);for(let i=0;i<12;i++){const closed=page.locator('#dmgFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}return page.locator('#dmgFilesTree button.file-entry').filter({hasText:name}).first();}
const packed=wave=>Array.from({length:16},(_,i)=>(wave[i*2]<<4)|wave[i*2+1]);
async function check(browser,name,origin,fixture){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installSilentAudit);const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await installReferenceAudit(page);
    step('Import remains passive; Play creates one reference APU and exposes editable playing CH1');
    await files(page);await page.locator('#dmgFilesInput').setInputFiles([
      {name:'manual-reference.vgm',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)},
      {name:'Manual Wave.dmg.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.preset))}]);
    await until(()=>page.locator('#dmgSongSelect option').evaluateAll(nodes=>nodes.some(node=>node.value==='/vgm/manual-reference.vgm')),'raw source stored');
    assert.equal((await page.evaluate(()=>__dmgManualAudit.graph())).contexts,0);assert.equal((await page.evaluate(()=>__dmgReferenceAudit.read())).length,0);
    await page.locator('#dmgSongSelect').selectOption('/vgm/manual-reference.vgm');await select(page,0);await keyboard(page);
    await until(()=>page.locator('#dmgSongPlayButton').isEnabled(),'source validated');await page.locator('#dmgSongPlayButton').click();
    await until(()=>manualView(page).then(value=>value.state==='playing'&&value.canInteract&&value.frame>4410),'playing reference');
    assert.equal((await manualView(page)).readonly,'false');assert.match((await manualView(page)).status,/VGM/);measurements.initial=await pcm(page);
    let native=await reference(page);assert(native?.finite);assert.equal(native.id,1);const identity={id:native.id,resets:native.resets};
    await wait(150);const ahead=await manualView(page);measurements.lookaheadSeconds=(ahead.rendered-ahead.frame)/44100;
    assert(measurements.lookaheadSeconds>=0&&measurements.lookaheadSeconds<.09,'bounded interactive PCM lookahead');

    step('Sweep, Duty, envelope and pan edit the playing physical CH without reinitializing its reference APU');
    assert.equal((await reference(page)).registers[0],0);await page.locator('#sweepEnabled').check();
    await until(()=>reference(page).then(value=>(value.registers[0]&0x77)!==0),'zero NR10 Sweep enabled with usable pace/shift');
    assert.equal(await page.locator('#sweepPeriod').textContent(),'3','coupled pending Sweep pace stays visible');assert.equal(await page.locator('#sweepShift').textContent(),'3','coupled pending Sweep shift stays visible');
    await page.locator('#sweepEnabled').uncheck();await until(()=>reference(page).then(value=>(value.registers[0]&0x77)===0),'Sweep disabled again');
    await choice(page,'pulseDuty','0.5');await number(page,'pulseVolume',10);await page.locator('#panLeft').uncheck();
    await until(()=>reference(page).then(value=>(value.registers[1]>>6)===2&&(value.registers[2]>>4)===10&&(value.registers[21]&0x11)===1),'touched playing fields committed');
    native=await reference(page);assert.equal(native.id,identity.id);assert.equal(native.resets,identity.resets);assert.equal((await manualView(page)).state,'playing');

    step('Auto Off keeps untouched frozen fields while a later VGM write and a sparse manual Duty edit share the same APU');
    await seek(page,2.8);await select(page,0);await until(()=>manualView(page).then(value=>value.duty==='0.25'&&value.volume==='8'),'pre-event observed fields');
    await page.locator('#dmgAutoUpdate').uncheck();const frozen=await manualView(page),authorBefore=await read(page);
    await until(()=>manualView(page).then(value=>value.frame>Math.round(4.12*44100)),'future song parameter write audible');
    assert.equal((await manualView(page)).duty,frozen.duty);assert.equal((await manualView(page)).volume,frozen.volume);
    native=await reference(page);assert.equal(native.registers[1]>>6,3);assert.equal(native.registers[2]>>4,12);
    const currentPeriod=period(native,0);await choice(page,'pulseDuty','0.125');await until(()=>reference(page).then(value=>(value.registers[1]>>6)===0),'manual Duty overrides latest song Duty');
    native=await reference(page);assert.equal(native.registers[2]>>4,12);assert.equal(period(native,0),currentPeriod);assert.equal((await manualView(page)).volume,'8');
    assert.equal((await read(page)).channelPresets[0].pulse.volume,authorBefore.channelPresets[0].pulse.volume,'recorded volume is not adopted as an author edit');
    await page.locator('#dmgAutoUpdate').check();await until(()=>manualView(page).then(value=>value.volume==='12'),'Auto On catches up');

    step('Keyboard uses that same reference CH; later VGM KeyOn owns it and ignores the older key-up');
    await seek(page,7);await select(page,0);await keyboard(page);await page.evaluate(()=>__dmgManualAudit.drain());
    const beforeKey=await reference(page);await page.keyboard.down('z');await until(()=>manualView(page).then(value=>value.held===1),'manual CH1 key held');
    native=await reference(page);assert.equal(native.id,beforeKey.id);assert.equal(native.resets,beforeKey.resets);assert(native.writes.slice(beforeKey.writes.length).some(write=>write.register===4&&(write.value&128)),'manual key dispatches a physical CH1 trigger');assert.equal((await read(page,'observeCode')),null);assert.equal((await read(page)).voices.length,0);await wait(90);measurements.keyboard=await pcm(page);
    await until(()=>manualView(page).then(value=>value.frame>Math.round(8.1*44100)&&value.held===0),'new recorded CH1 trigger takes ownership');
    const songNote=await reference(page);assert.equal(period(songNote,0),0x706);assert.equal(songNote.registers[2]>>4,9);
    await page.keyboard.up('z');await wait(100);native=await reference(page);assert.equal(period(native,0),0x706);assert.equal(native.registers[2]>>4,9);measurements.afterStaleKeyUp=await pcm(page);
    const beforeReplacement=await reference(page);await page.keyboard.down('x');await until(()=>manualView(page).then(value=>value.held===1),'replacement manual key');const replacement=await reference(page);assert.notEqual(period(replacement,0),0x706,'replacement manual pitch overrides the recorded C5');assert(replacement.writes.slice(beforeReplacement.writes.length).some(write=>write.register===4&&(write.value&128)),'replacement manual key retriggers that same CH1');await wait(90);measurements.replacementKeyboard=await pcm(page);await page.keyboard.up('x');
    await until(()=>manualView(page).then(value=>value.held===0),'manual own key release');await pcm(page,false);
    const editorCommands=await page.evaluate(()=>__dmgManualAudit.drain());assert(!editorCommands.some(item=>item.method==='noteOn'),'reference keyboard must not start an editor Worklet voice');

    step('Loading a Files Wave preset and playing Synth source-pool keys preserves VGM transport and reference identity');
    await select(page,'synth');const beforeLoad=await reference(page),frameBeforeLoad=(await manualView(page)).frame;
    const row=await fileRow(page,'Manual Wave.dmg.json');await row.click();await until(async()=> (await read(page)).preset.name===fixture.preset.name,'explicit Files preset loaded');
    await until(()=>reference(page).then(value=>JSON.stringify(value.registers.slice(32,48))===JSON.stringify(packed(fixture.preset.wave.samples))),'preset Wave RAM reflected into playing APU');
    native=await reference(page);assert.equal(native.id,beforeLoad.id);assert.equal(native.resets,beforeLoad.resets);assert((await manualView(page)).frame>=frameBeforeLoad);assert.equal((await manualView(page)).state,'playing');
    await keyboard(page);await page.keyboard.down('z');await until(()=>manualView(page).then(value=>value.held===1),'Synth Wave source-pool key');
    native=await reference(page);assert(native.registers[10]&128);assert.equal(native.registers[12]&0x60,0x40);measurements.wave=await pcm(page);await page.keyboard.up('z');await pcm(page,false);
    await select(page,2);assert.equal((await manualView(page)).readonly,'false');await page.locator('[data-wave-shape="triangle"]').click();
    await until(()=>reference(page).then(value=>JSON.stringify(value.registers.slice(32,48))===JSON.stringify(packed(fixture.triangle))),'playing Wave RAM drawing reflected');
    await select(page,3);await number(page,'noiseVolume',5);await number(page,'noiseShift',3);await page.locator('#panLeft').check();await page.locator('#panRight').check();
    const noiseClock=(await reference(page)).registers[18];await keyboard(page);await page.keyboard.down('z');await until(()=>manualView(page).then(value=>value.held===1),'Noise key');measurements.noise=await pcm(page);await page.keyboard.up('z');
    await page.keyboard.down('x');await until(()=>manualView(page).then(value=>value.held===1),'second Noise key');assert.equal((await reference(page)).registers[18],noiseClock,'Noise keys keep configured clock');await page.keyboard.up('x');await pcm(page,false);

    step('Pause, seek and Stop retire manual gates; paused audition and Code exclusivity retain their separate ownership');
    await select(page,0);await seek(page,.3);await keyboard(page);await page.keyboard.down('z');await until(()=>manualView(page).then(value=>value.held===1),'held before Pause');
    await page.locator('#dmgSongPlayButton').click();await until(()=>manualView(page).then(value=>value.state==='paused'&&value.held===0),'Pause releases manual keyboard');await page.keyboard.up('z');
    assert.equal((await manualView(page)).readonly,'true');assert(!((await manualView(page)).canInteract));
    await page.locator('#dmgSongPlayButton').click();await until(()=>manualView(page).then(value=>value.state==='playing'&&value.canInteract),'Resume');
    await page.keyboard.down('z');await until(()=>manualView(page).then(value=>value.held===1),'held before seek');await seek(page,.4);assert.equal((await manualView(page)).held,0);await page.keyboard.up('z');await pcm(page);
    await source(page,`const gb=await useSoundChip('gameboy');await gb.initialize();await gb.pulse.setVoice(0,{duty:.5,volume:8,envelope:{direction:'down',period:0}});await gb.setPan(0,true,true);await gb.pulse.noteOn(0,'E3');globalThis.__manualExclusive={gb,ticks:0};liveLoop('clock',async()=>{__manualExclusive.ticks++;await sleep(.05);});`);
    await run(page);await until(()=>manualView(page).then(value=>value.state==='stopped'),'Code Run stops reference song');assert.equal(await reference(page),null);assert(await page.evaluate(()=>__manualExclusive.gb.isCurrent()));await pcm(page);
    await page.locator('#dmgSongPlayButton').click();await until(()=>manualView(page).then(value=>value.state==='playing'&&value.canInteract),'VGM Play stops Code');assert(!await page.evaluate(()=>{try{return __manualExclusive.gb.isCurrent();}catch{return false;}}));
    await keyboard(page);await page.keyboard.down('z');await until(()=>manualView(page).then(value=>value.held===1),'held before Stop');await page.locator('#dmgSongStopButton').click();await until(()=>manualView(page).then(value=>value.state==='stopped'&&value.held===0),'Stop releases reference');await page.keyboard.up('z');await pcm(page,false);
    assert.equal(await reference(page),null);assert((await page.evaluate(()=>__dmgReferenceAudit.read())).every(item=>item.closed));
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await page.locator('#dmgChannelTools').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-${width}.png`),fullPage:true});}
    await page.locator('#dmgSongPlayButton').click();await until(()=>manualView(page).then(value=>value.state==='playing'),'last Play');await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
    await until(()=>page.evaluate(()=>__dmgReferenceAudit.read().every(item=>item.closed)),'pagehide disposes reference');await wait(100);assert.equal(await reference(page),null);
    assert.equal(await page.locator('#synthCodeError').textContent(),'');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    return{browser:name,passed:true,checks,measurements,graph:await page.evaluate(()=>__dmgManualAudit.graph()),references:await page.evaluate(()=>__dmgReferenceAudit.read().map(({writes,...item})=>({...item,writeCount:writes.length}))),errors,consoleErrors};
  }catch(error){const diagnostic={stage,view:await manualView(page).catch(()=>null),read:await read(page).catch(()=>null),references:await page.evaluate(()=>__dmgReferenceAudit?.read()).catch(()=>null),commands:await page.evaluate(()=>__dmgManualAudit.drain()).catch(()=>[])};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-failure.png`),fullPage:true}).catch(()=>{});error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,errors,consoleErrors};throw error;
  }finally{await page.close();}
}
function createManualFixture(preset,triangle){
  const write=(register,value)=>[0xb3,register,value],writes=(values)=>values.flatMap(([register,value])=>write(register,value));
  const waitFrames=frames=>{const bytes=[];while(frames){const n=Math.min(65535,frames);bytes.push(0x61,n&255,n>>8);frames-=n;}return bytes;};
  const wave=Array.from({length:32},(_,i)=>i<16?i:31-i);
  const initial=writes([[22,0x80],[20,0x77],[21,0x11],[0,0],[1,0x40],[2,0x80],[3,0x0b],[4,0x86],[7,0],[10,0],[12,0x40],[17,0],[18,0x43],...packed(wave).map((value,index)=>[32+index,value])]);
  const commands=Uint8Array.from([...initial,...waitFrames(4*44100),...writes([[1,0xc0],[2,0xc0]]),...waitFrames(4*44100),...writes([[2,0x90],[3,0x06],[4,0x87]]),...waitFrames(22*44100),0x66]);
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);view.setUint32(0x18,30*44100,true);view.setUint32(0x34,0xcc,true);view.setUint32(0x80,4194304,true);bytes.set(commands,256);return{bytes,preset,triangle};
}
const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),meta={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),meta,'Asset changed while checking');served.set(key,meta);res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const {createDefaultPreset,waveShape}=await import(pathToFileURL(path.join(repo,'docs/synth-dmg/preset.js')).href);
  const preset=createDefaultPreset();preset.name='Manual Wave';preset.source='wave';preset.wave.samples=waveShape('saw');
  const fixture=createManualFixture(preset,waveShape('triangle'));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
    try{results.push(await check(browser,name,origin,fixture));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);assert(blockedMonaco.length);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,missing,external,httpErrors,
    expectedBlockedMonaco:blockedMonaco,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
