// Unified DMG channel selection against the real packaged editor and APU.
// Headless only: every destination is intercepted before app JS at gain zero,
// and Chromium additionally runs with --mute-audio. No OS audio is changed.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-dmg/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'dmg-synth-channel-browser.json'),screenshots:path.join(tmpdir(),'dmg-synth-channel-browser')};
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
  window.__dmgChannelAudit={read,output,wave:()=>lastWave?.slice(),drain:()=>commands.splice(0),graph:()=>({contexts:contexts.length,
    editorWorklets:nodes.filter(item=>item.name==='tetorica-gameboy-synth').length,destinationConnections:meters.length,muted:meters.every(item=>item.mute.gain.value===0)})};
}
const read=(page,method='read')=>page.evaluate(method=>__dmgChannelAudit.read(method),method);
const view=page=>page.evaluate(()=>({target:document.getElementById('dmgChannelSelect').value,auto:document.getElementById('dmgAutoUpdate').checked,
  status:document.getElementById('dmgChannelStatus').textContent,readout:document.getElementById('dmgChannelReadout').textContent,
  source:document.querySelector('#source [aria-checked=true]')?.dataset.choiceValue,duty:document.querySelector('#pulseDuty [aria-checked=true]')?.dataset.choiceValue,
  inputMode:document.getElementById('synthInputSection').dataset.inputMode,readonly:document.getElementById('voiceEditor').dataset.readonly,song:document.getElementById('dmgSongPlayer').dataset.state,
  frame:Number(document.getElementById('dmgSongPlayer').dataset.positionFrames),rendered:Number(document.getElementById('dmgSongPlayer').dataset.renderedFrames)}));
async function select(page,target){await page.locator('#dmgChannelSelect').selectOption(String(target));await until(()=>view(page).then(state=>state.target===String(target)),'target '+target);}
async function pcm(page,audible=true){let value;await until(async()=>{value=await page.evaluate(()=>__dmgChannelAudit.output());return value.muted&&value.finite&&(audible?value.rms>.0001:value.peak<1e-7);},audible?'actual finite PCM':'output silence');return value;}
async function number(page,id,value){await page.locator('#'+id).focus();await page.keyboard.press('Home');for(let i=0;i<value;i++)await page.keyboard.press('ArrowRight');await page.locator('#'+id).evaluate(node=>node.blur());await until(()=>page.locator('#'+id).textContent().then(text=>Number(text)===value),id+'='+value);}
const choice=(page,id,value)=>page.locator(`[data-choice-for="${id}"][data-choice-value="${value}"]`).click();
async function files(page){if(await page.locator('#dmgFilesPanel').isHidden())await page.locator('#dmgFilesToggle').click();await until(()=>page.locator('#dmgFileImportButton').isEnabled(),'Files ready');}
async function source(page,text){await files(page);for(let i=0;i<10;i++){const closed=page.locator('#dmgFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}await page.locator('#dmgFilesTree button.file-entry').locator('xpath=self::*[@data-file-path="/index.js"]').click();
  await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(text);}
async function run(page){await page.locator('#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());},'Code running');}
async function stopCode(page){await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(text=>/Idle|Stopped/.test(text)),'Code Stop');await pcm(page,false);}
async function saveSound(page){await files(page);const previous=await page.locator('#dmgFilesStatus').textContent();await page.locator('#dmgFileSaveSoundButton').click();
  await until(()=>page.locator('#dmgFilesStatus').textContent().then(text=>text!==previous&&/Current DMG instrument saved/.test(text)),'fixed channel JSON saved');return JSON.parse(await page.locator('#synthCodeEditor').inputValue());}
const period=(raw,ch)=>raw.registers[ch*5+3]|((raw.registers[ch*5+4]&7)<<8);
const stable=state=>({registers:state.registers,voice:state.voice});
const allowedSelection=new Set(['read','observeCode','observeEditor','releaseKeyboard']);
function passive(commands){assert(!commands.some(item=>!allowedSelection.has(item.method)),'selection must not mutate or reinitialize audio: '+JSON.stringify(commands));}

async function check(browser,name,origin,fixture){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installSilentAudit);const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);
    step('One shared selector is passive before audio, with no old hidden channel states');
    assert.equal(await page.locator('#dmgChannelSelect').count(),1);assert.equal(await page.locator('#dmgAutoUpdate').count(),1);
    assert.equal(await page.locator('#dmgLiveChannel,#dmgSongChannelSelect,#dmgLiveEnabled,#dmgSongLiveEnabled').count(),0);
    assert.deepEqual(await page.locator('#dmgChannelSelect option').evaluateAll(nodes=>nodes.map(node=>node.value)),['synth','0','1','2','3']);
    assert.equal((await view(page)).target,'synth');assert((await view(page)).auto);
    for(const [target,kind]of [[0,'pulse'],[1,'pulse'],[2,'wave'],[3,'noise']]){await select(page,target);assert.equal((await view(page)).source,kind);}await select(page,'synth');
    assert.equal((await page.evaluate(()=>__dmgChannelAudit.graph())).contexts,0);

    step('Idle CH patches stay independent; returning to Round robin does not unify them, while a touched RR field broadcasts alone');
    await select(page,0);await choice(page,'pulseDuty','0.125');await number(page,'pulseVolume',9);await page.locator('#panLeft').uncheck();
    await select(page,1);await choice(page,'pulseDuty','0.75');await number(page,'pulseVolume',5);await page.locator('#panRight').uncheck();
    assert(await page.locator('#sweepEnabled').isDisabled());
    await select(page,2);await page.locator('[data-wave-shape="saw"]').click();
    await select(page,3);await number(page,'noiseShift',3);
    await select(page,'synth');await select(page,0);assert.equal((await view(page)).duty,'0.125');assert.equal(await page.locator('#pulseVolume').textContent(),'9');
    await select(page,1);assert.equal((await view(page)).duty,'0.75');assert.equal(await page.locator('#pulseVolume').textContent(),'5');
    await select(page,'synth');await number(page,'pulseVolume',7);
    await select(page,0);assert.equal((await view(page)).duty,'0.125');assert.equal(await page.locator('#pulseVolume').textContent(),'7');assert(!await page.locator('#panLeft').isChecked());
    await select(page,1);assert.equal((await view(page)).duty,'0.75');assert.equal(await page.locator('#pulseVolume').textContent(),'7');assert(!await page.locator('#panRight').isChecked());
    assert.equal((await page.evaluate(()=>__dmgChannelAudit.graph())).contexts,0);
    const saved=await saveSound(page);assert.equal(saved.source,'pulse');assert.equal(saved.pulse.duty,.75);assert.equal(saved.pulse.volume,7);assert.equal(saved.pan.right,false);assert.equal((await page.evaluate(()=>__dmgChannelAudit.graph())).contexts,0,'saving a fixed channel is passive');

    step('Fixed idle keyboard uses the chosen physical CH; selecting and Auto Off write no native registers or Wave RAM');
    await page.locator('#startAudio').click();await until(async()=>{try{return Array.isArray((await read(page)).channelPresets);}catch{return false;}},'four-channel author bank');
    let authored=await read(page);assert.equal(authored.channelPresets.length,4);assert.equal(authored.channelPresets[0].pulse.duty,.125);assert.equal(authored.channelPresets[1].pulse.duty,.75);assert.deepEqual(authored.channelPresets[2].wave.samples,fixture.sawWave);assert.equal(authored.channelPresets[3].noise.shift,3);
    const beforeSelect=authored.registers;await page.evaluate(()=>__dmgChannelAudit.drain());
    for(const target of [0,2,3,'synth',1])await select(page,target);
    assert.deepEqual((await read(page)).registers,beforeSelect);passive(await page.evaluate(()=>__dmgChannelAudit.drain()));
    const idleAuto=await page.locator('#dmgAutoUpdate').isEnabled();if(idleAuto)await page.locator('#dmgAutoUpdate').uncheck();assert.equal((await view(page)).target,'1');
    await page.keyboard.down('z');await until(async()=> (await read(page)).voices.some(voice=>voice.channel===1),'idle keyboard fixed CH2');measurements.idlePcm=await pcm(page);
    await page.keyboard.up('z');await until(async()=>!(await read(page)).voices.length,'idle key-up');await pcm(page,false);if(idleAuto)await page.locator('#dmgAutoUpdate').check();

    step('Code view changes preserve raw per-CH settings, context, preparation, FX and the same live client');
    await select(page,'synth');await source(page,`const gb=await useSoundChip('gameboy');await gb.initialize();
await gb.pulse.setVoice(0,{duty:.25,volume:8,envelope:{direction:'down',period:0}});await gb.pulse.setVoice(1,{duty:.75,volume:6,envelope:{direction:'down',period:0}});
await gb.wave.stopAndSetWaveform(Array.from({length:32},(_,i)=>i%16));await gb.wave.setLevel(.5);
await gb.noise.setVoice({volume:4,envelope:{direction:'down',period:0},divisor:3,shift:4,width:7});
for(let ch=0;ch<4;ch++)await gb.setPan(ch,true,true);
await gb.pulse.noteOn(0,'A3');await gb.pulse.noteOn(1,'E4');await gb.wave.noteOn('G4');await gb.noise.keyOn();
const prepared=await livePrepare('channels',()=>({ticks:0}));context.marker??={id:'same'};globalThis.__dmgChannelProbe={gb,context,prepared};
liveFx('half',{process(input,output){for(let ch=0;ch<output.length;ch++)for(let i=0;i<output[ch].length;i++)output[ch][i]=(input[ch]?.[i]??0)*.5;}});
liveLoop('heartbeat',async()=>{prepared.ticks++;await sleep(.04);});`);
    await run(page);await pcm(page);const rawBefore=await read(page,'observeCode'),authorBefore=await read(page);await page.evaluate(()=>{window.__dmgChannelIdentity=__dmgChannelProbe;__dmgChannelAudit.drain();});
    for(const target of [0,1,2,3,'synth',1])await select(page,target);
    passive(await page.evaluate(()=>__dmgChannelAudit.drain()));assert.deepEqual(stable(await read(page,'observeCode')),stable(rawBefore));
    assert.deepEqual((await read(page)).channelPresets,authorBefore.channelPresets);assert(await page.evaluate(()=>__dmgChannelProbe===__dmgChannelIdentity&&__dmgChannelProbe.gb.isCurrent()));
    assert.equal((await view(page)).duty,'0.75');assert.match((await view(page)).status,/Code/i);

    step('Auto Off freezes observation without changing CH routing; editing a frozen field preserves untouched current hardware fields');
    await page.locator('#dmgAutoUpdate').uncheck();const frozen=await view(page);
    await page.evaluate(async()=>{await __dmgChannelProbe.gb.pulse.setVoice(1,{duty:.5,volume:9});await __dmgChannelProbe.gb.setPan(1,false,true);});await wait(130);
    assert.equal((await view(page)).target,'1');assert.equal((await view(page)).duty,frozen.duty);assert.equal(await page.locator('#pulseVolume').textContent(),'6');
    await select(page,0);await select(page,'synth');await select(page,1);assert.equal((await view(page)).duty,'0.75');
    const current=await read(page,'observeCode');await choice(page,'pulseDuty','0.125');await until(async()=>((await read(page,'observeCode')).voice[6]>>6)===0,'frozen CH2 Duty edit');
    const after=await read(page,'observeCode');assert.equal(after.voice[7]>>4,9);assert.equal(after.registers[21]&0x22,2);assert.equal(period(after,1),period(current,1));assert.equal(await page.locator('#pulseVolume').textContent(),'6','Auto Off retains untouched observed fields after editing Duty');assert.equal((await view(page)).target,'1');
    assert.equal((await read(page)).channelPresets[1].pulse.volume,7,'raw Code volume was not adopted with the touched Duty');
    await page.locator('#synthInputKeyboardTab').click();await until(()=>page.locator('#synthInputSection').getAttribute('data-input-mode').then(value=>value==='keyboard'),'Keyboard view ready');await page.keyboard.down('z');await until(async()=> (await read(page)).voices.some(voice=>voice.channel===1),'Auto Off keyboard keeps fixed CH2');await page.keyboard.up('z');
    const tick=await page.evaluate(()=>__dmgChannelProbe.prepared.ticks);await until(()=>page.evaluate(previous=>__dmgChannelProbe.prepared.ticks>previous,tick),'Code keeps its loop');
    await stopCode(page);assert.equal((await view(page)).target,'1');assert.equal((await view(page)).auto,false);assert.equal((await view(page)).duty,'0.125');
    await page.locator('#synthInputCodeTab').click();await until(()=>page.locator('#synthInputSection').getAttribute('data-input-mode').then(value=>value==='code'),'Code view ready');await run(page);
    await until(()=>view(page).then(value=>value.target==='1'&&value.readonly==='false'&&/CH 2/.test(value.readout)),'a fresh Run supplies one initial CH snapshot even with Auto Off');
    assert.equal((await view(page)).auto,false);await stopCode(page);await page.locator('#dmgAutoUpdate').check();await select(page,1);assert.equal((await view(page)).duty,'0.125');

    step('VGM uses the same selector; paused Capture returns to Synth and same-CH comparison preserves the edited author');
    await files(page);await page.locator('#dmgFilesInput').setInputFiles({name:'unified-reference.vgm',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)});
    await until(()=>page.locator('#dmgSongSelect option').evaluateAll(nodes=>nodes.some(node=>node.value==='/vgm/unified-reference.vgm')),'saved VGM source');
    await page.locator('#dmgSongSelect').selectOption('/vgm/unified-reference.vgm');await select(page,2);await until(()=>page.locator('#dmgSongPlayButton').isEnabled(),'VGM source validated');assert.equal((await view(page)).target,'2');await page.locator('#dmgSongPlayButton').click();
    await until(()=>view(page).then(value=>value.song==='playing'&&value.frame>7000),'VGM advances');await pcm(page);assert.match((await view(page)).status,/VGM/i);
    await page.locator('#dmgSongPlayButton').click();await until(()=>view(page).then(value=>value.song==='paused'),'Pause');
    await page.locator('#dmgSongSeek').evaluate(node=>{node.value='.2';node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));});
    await until(()=>view(page).then(value=>value.song==='paused'&&value.frame===8820),'paused initial-state position');const paused=await view(page);
    assert.equal(paused.readonly,'true');await page.locator('#dmgAutoUpdate').uncheck();
    for(const target of [0,1,3,2]){await select(page,target);assert.equal((await view(page)).frame,paused.frame);assert.equal((await view(page)).readonly,'true');}
    assert.deepEqual(await page.evaluate(()=>__dmgChannelAudit.wave()),fixture.initialWave);
    await page.locator('#synthInputKeyboardTab').click();await until(()=>view(page).then(value=>value.inputMode==='keyboard'),'Keyboard view before paused audition');
    await page.keyboard.down('z');await until(()=>page.locator('#dmgSongPlayer').getAttribute('data-audition-sounding').then(value=>value==='1'),'paused selected CH3 audition');measurements.trialPcm=await pcm(page);
    const trial=await read(page,'observeCode');assert.deepEqual(trial.registers.slice(32,48),Array.from({length:16},(_,i)=>(fixture.initialWave[i*2]<<4)|fixture.initialWave[i*2+1]));
    await page.keyboard.up('z');await until(()=>page.locator('#dmgSongPlayer').getAttribute('data-audition-sounding').then(value=>value==='0'),'paused trial release');await pcm(page,false);
    await page.locator('#dmgSongCaptureButton').click();await until(()=>view(page).then(value=>value.target==='synth'&&value.song==='paused'&&value.readonly==='false'),'Capture selects Synth');
    assert.equal((await view(page)).frame,paused.frame);assert.equal((await view(page)).auto,false);
    await page.locator('[data-wave-shape="saw"]').click();await until(async()=>JSON.stringify((await read(page)).preset.wave.samples)===JSON.stringify(fixture.sawWave),'captured author edited');
    await select(page,2);assert.equal((await view(page)).frame,paused.frame);assert.deepEqual(await page.evaluate(()=>__dmgChannelAudit.wave()),fixture.initialWave);
    await select(page,'synth');assert.deepEqual(await page.evaluate(()=>__dmgChannelAudit.wave()),fixture.sawWave);
    await fs.mkdir(config.screenshots,{recursive:true});for(const width of [1240,390]){
      await page.setViewportSize({width,height:1050});await page.locator('#dmgChannelTools').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.screenshot({path:path.join(config.screenshots,`${name}-${width}.png`),fullPage:true});
    }
    await page.locator('#dmgSongPlayButton').click();await until(()=>view(page).then(value=>value.song==='playing'&&value.frame>paused.frame),'Resume original VGM');
    await page.locator('#dmgSongStopButton').click();await until(()=>view(page).then(value=>value.song==='stopped'),'VGM Stop');await pcm(page,false);
    assert.deepEqual((await read(page)).preset.wave.samples,fixture.sawWave);assert.equal((await page.evaluate(()=>__dmgChannelAudit.graph())).contexts,1);
    assert.equal(await page.locator('#synthCodeError').textContent(),'');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    return{browser:name,passed:true,checks,measurements,graph:await page.evaluate(()=>__dmgChannelAudit.graph()),errors,consoleErrors};
  }catch(error){
    const diagnostic={stage,view:await view(page).catch(()=>null),read:await read(page).catch(()=>null),commands:await page.evaluate(()=>__dmgChannelAudit.drain()).catch(()=>[])};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-failure.png`),fullPage:true}).catch(()=>{});
    error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,errors,consoleErrors};throw error;
  }finally{await page.close();}
}
const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),meta={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),meta,'Asset changed while checking');served.set(key,meta);res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const {createDmgSongFixture,DMG_SONG_INITIAL_WAVE}=await import(pathToFileURL(path.join(repo,'test/helpers/dmg_synth_song_fixture.mjs')).href);
  const {waveShape}=await import(pathToFileURL(path.join(repo,'docs/synth-dmg/preset.js')).href),fixture={...createDmgSongFixture(),initialWave:DMG_SONG_INITIAL_WAVE,sawWave:waveShape('saw')};
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
    try{results.push(await check(browser,name,origin,fixture));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);assert(blockedMonaco.length);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,missing,external,httpErrors,
    expectedBlockedMonaco:blockedMonaco,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
