// FM2612 authored CD-DA integration: real UI, Code, PCM and Cassette files.
// Every physical speaker connection passes gain zero before application load.
// No listening. --root/--entry also accept a safely extracted standalone ZIP.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright'),{wav}=require('./check_huc6280_synth_cdda_browser.cjs');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',out:path.join(tmpdir(),'fm2612-cdda-browser.json'),screenshots:path.join(tmpdir(),'fm2612-cdda-browser')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await wait(30);}throw Error('Timeout: '+label);}
const served=new Map(),missing=[],external=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon'};
const server=http.createServer(async(request,response)=>{try{
  const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+pathname);assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),name=path.relative(config.root,filename),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(name))assert.deepEqual(served.get(name),metadata,'Asset changed during browser verification');served.set(name,metadata);
  response.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
}catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}});
const HZ=[100,220,330,440,660,784,880];
function installAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect;
  const contexts=[],nodes=[],meters=[],ramps=[],parameters=new WeakMap(),info=new WeakMap(),errors=[];
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);const item={node:this,name,connected:false};nodes.push(item);info.set(this,item);}};
  AudioNode.prototype.connect=function(destination,...ports){
    if(info.has(this))info.get(this).connected=true;
    if(destination!==this.context.destination)return connect.call(this,destination,...ports);
    const split=this.context.createChannelSplitter(2),left=this.context.createAnalyser(),right=this.context.createAnalyser(),mute=this.context.createGain();left.fftSize=right.fftSize=8192;mute.gain.value=0;
    connect.call(this,split,...ports);connect.call(split,left,0);connect.call(split,right,1);connect.call(left,mute);connect.call(right,mute);connect.call(mute,destination);meters.push({left,right,mute});return destination;
  };
  AudioNode.prototype.disconnect=function(...ports){if(info.has(this))info.get(this).connected=false;return disconnect.apply(this,ports);};
  const set=AudioParam.prototype.setValueAtTime,ramp=AudioParam.prototype.linearRampToValueAtTime;
  AudioParam.prototype.setValueAtTime=function(value,time){parameters.set(this,{value,time});return set.call(this,value,time);};
  AudioParam.prototype.linearRampToValueAtTime=function(value,time){const from=parameters.get(this);if(from)ramps.push({from:from.value,to:value,start:from.time,end:time,seconds:time-from.time});return ramp.call(this,value,time);};
  window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason?.stack??event.reason)));
  function channel(analyser){const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);let sum=0,peak=0,finite=true;
    for(const value of data){sum+=value*value;peak=Math.max(peak,Math.abs(value));finite&&=Number.isFinite(value);}
    const hz=[100,220,330,440,660,784,880],amplitudes=Object.fromEntries(hz.map(h=>{let sine=0,cosine=0;for(let i=0;i<data.length;i++){const angle=i*2*Math.PI*h/analyser.context.sampleRate;sine+=data[i]*Math.sin(angle);cosine+=data[i]*Math.cos(angle);}return[h,2*Math.hypot(sine,cosine)/data.length];}));
    return{rms:Math.sqrt(sum/data.length),peak,finite,amplitudes};
  }
  function read(){const rows=meters.map(({left,right,mute})=>({left:channel(left),right:channel(right),muted:mute.gain.value===0}));return rows.sort((a,b)=>b.left.rms+b.right.rms-a.left.rms-a.right.rms)[0]??{left:{rms:0,peak:0,finite:true,amplitudes:{}},right:{rms:0,peak:0,finite:true,amplitudes:{}},muted:true};}
  window.__fmCddaAudit={read,ramps:()=>ramps.slice(),graph:()=>({contexts:contexts.length,destinations:meters.length,muted:meters.every(m=>m.mute.gain.value===0),worklets:nodes.map(({name,connected})=>({name,connected})),errors:errors.slice()})};
}
const ui=page=>page.locator('#cddaControls').evaluate(node=>({...node.dataset})),frame=value=>Number(value.positionFrames),phase=value=>value.sourceState??value.state;
const settled=value=>value.busy!=='true'&&value.playPending!=='true'&&value.transportPending!=='true';
async function audio(page){await wait(200);const data=await page.evaluate(()=>__fmCddaAudit.read());assert(data.muted&&data.left.finite&&data.right.finite,'Finite PCM with physical gain zero');return data;}
const rms=data=>Math.sqrt((data.left.rms**2+data.right.rms**2)/2);
async function silence(page){await until(async()=>rms(await audio(page))<1e-7,'All selected CD audio is silent');}
async function state(page,wanted){await until(()=>ui(page).then(value=>phase(value)===wanted&&settled(value)),'CD-DA '+wanted);}
async function chooseSource(page,name){const selected=await page.locator('#cddaSourceSelect option').evaluateAll((nodes,name)=>nodes.find(node=>node.value===name||node.value.endsWith('/'+name)||node.textContent.includes(name))?.value,name);assert(selected,'Source option '+name);await page.locator('#cddaSourceSelect').selectOption(selected);return selected;}
async function load(page,name){await chooseSource(page,name);const before=(await ui(page)).revision;await page.locator('#cddaLoadSource').click();await until(()=>ui(page).then(value=>value.revision!==before&&settled(value)),'Load '+name);return ui(page);}
async function seek(page,seconds){await page.locator('#cddaSeek').evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},seconds);await until(()=>ui(page).then(value=>Math.abs(frame(value)-Math.round(seconds*44100))<=1),'Ready Seek '+seconds);}
async function track(page,number){await page.locator('#cddaTrackSelect').selectOption(String(number));await until(()=>ui(page).then(value=>Number(value.selectedTrack)===number&&settled(value)),'Track '+number);}
async function stop(page){if(await page.locator('#cddaStop').isEnabled())await page.locator('#cddaStop').click();await until(()=>ui(page).then(value=>phase(value)!=='playing'&&frame(value)===0&&settled(value)),'CD-DA stopped');}
async function range(page,selector,value,change=false){await page.locator(selector).evaluate((node,{value,change})=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));if(change)node.dispatchEvent(new Event('change',{bubbles:true}));},{value,change});}
function stereo(pcm,which='a'){const hz=which==='a'?[440,660]:[330,880];assert(pcm.left.amplitudes[hz[0]]>0.003&&pcm.right.amplitudes[hz[1]]>0.003,'Original-rate stereo '+which+' '+JSON.stringify(pcm));}
async function draft(page){return page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('tetorica-fm2612-synth-drafts',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('projects','readonly'),read=tx.objectStore('projects').get('current');tx.oncomplete=()=>{const value=read.result;db.close();if(value?.project?.files)value.project.files=value.project.files.map(file=>({...file,data:typeof file.data==='string'?file.data:Array.from(file.data)}));resolve(value??null);};tx.onabort=()=>{db.close();reject(tx.error??read.error);};};}));}
const file=(snapshot,name)=>snapshot?.project?.files.find(file=>file.path===name)?.data;
const CODE=`const c = await useSoundChip('cdda');
globalThis.__fmCdda = {c, ticks: 0, ready: true};
liveLoop('cdda-observer', async () => { globalThis.__fmCdda.ticks++; await sleep(0.05); });
`;
const SHARED_CODE=`const c=await useSoundChip('cdda');
if(c.id!==globalThis.__fmCdda.c.id)throw Error('Apply replaced the CD-DA client');
liveLoop('cdda-observer',async()=>{globalThis.__fmCdda.ticks++;await sleep(.05);});
`;
const COEXIST=`const c=await useSoundChip('cdda');
const fm=await useSoundChip('ym2612');fm.setPreset(CH2,FM_PRESETS.sine);fm.noteOn(CH2,'C4');
const psg=await useSoundChip('segapsg');psg.tone(0,{note:'G4'});
const pcm=await useSoundChip('rf5c164');const sample=await pcm.loadSample({sampleRate:44100,channels:[Float32Array.from({length:441},(_,i)=>.2*Math.sin(i*Math.PI*2/441))]},{loopStart:0});
pcm.setChannel(0,{...sample,volume:64,pan:{left:15,right:15}});pcm.keyOn(0);
globalThis.__fmCdda.coexist={c,fm,psg,pcm};
liveLoop('cdda-observer',async()=>{globalThis.__fmCdda.ticks++;await sleep(.05);});
`;
function vgm(){const commands=[0x50,0x8f,0x50,0x1f,0x50,0x95];for(let i=0;i<30;i++)commands.push(0x61,0x44,0xac);commands.push(0x66);const bytes=Buffer.alloc(256+commands.length),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);bytes.write('Vgm ');view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);view.setUint32(12,3579545,true);view.setUint32(0x34,204,true);view.setUint32(0x18,30*44100,true);bytes.set(commands,256);return bytes;}
async function check(browser,name,origin,fixtures,loadCassette){
  const context=await browser.newContext({viewport:{width:1360,height:1050},serviceWorkers:'block',acceptDownloads:true}),page=await context.newPage(),checks=[],measurements={},errors=[],consoleErrors=[];page.setDefaultTimeout(25000);
  await context.addInitScript(installAudit);page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource|net::ERR_FAILED|Load failed/i.test(message.text()))consoleErrors.push(message.text());});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  const ready=()=>until(()=>page.locator('.synth-editor').getAttribute('aria-busy').then(value=>value==='false'),'Files ready');
  const tab=async(id='synthChipTabCdda')=>{await page.locator('#'+id).click();await until(()=>page.locator('#'+id).getAttribute('aria-selected').then(value=>value==='true'),'Tab '+id);};
  const menu=async()=>{if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();};
  const step=text=>{checks.push(text);console.log('CHECK '+name+': '+text);};
  const codeState=()=>page.evaluate(async()=>{const p=__fmCdda,s=await p.c.getState();return{...s,ticks:p.ticks,id:p.c.id};});
  const edit=async text=>{await tab('synthInputCodeTab');const editor=page.locator('#synthCodeEditor');await editor.waitFor({state:'visible'});await until(()=>editor.isEditable(),'Code editor writable');await editor.fill(text);};
  const run=async(apply=false)=>{await page.locator(apply?'#synthCodeApplyButton':'#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return page.locator('#synthCodeState').textContent().then(value=>/Running|Playing/.test(value));},'Code running');};
  const exportCassette=async()=>{await menu();const waiting=page.waitForEvent('download');await page.locator('#exportCassetteButton').click();const download=await waiting;assert.equal(await download.failure(),null);const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);return loadCassette(Buffer.concat(chunks));};
  const portable=async()=>{const exported=await exportCassette();for(const [name,bytes]of fixtures.files)assert.equal(hash(exported.files.get(name.replace(/^\//,''))),hash(bytes),'Cassette preserves '+name);assert(![...exported.files.keys()].some(name=>name.startsWith('session-cdda/')||name.includes('temporary-session')));return exported;};
  const assertQuiet=async()=>{await wait(150);assert.notEqual(phase(await ui(page)),'playing');assert.doesNotMatch(await page.locator('#synthCodeState').textContent(),/Running|Playing/);await silence(page);};
  try{
    await page.goto(origin+config.entry);await ready();await tab();
    await until(()=>ui(page).then(value=>Number(value.trackFrames)===44100&&settled(value)),'Default Sine ready');
    assert.equal(await page.locator('#cddaTestFrequency').inputValue(),'440');assert.equal(await page.locator('#cddaTestLevel').inputValue(),'0.5');assert.equal(await page.locator('#cddaTestDuration').inputValue(),'1');assert(await page.locator('#cddaTestSmooth').isChecked());
    assert.equal((await page.evaluate(()=>__fmCddaAudit.graph())).contexts,0,'Default authoring is passive');
    assert.deepEqual(await page.locator('#cddaTestPcm [data-test-shape]').evaluateAll(nodes=>nodes.map(node=>node.dataset.testShape)),['sine','triangle','saw','square']);
    for(const width of [1360,390]){await page.setViewportSize({width,height:1050});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Default CD-DA fits '+width);await page.screenshot({path:path.join(config.screenshots,`${name}-cdda-normal-${width}.png`),fullPage:true});}
    await page.setViewportSize({width:1360,height:1050});
    for(const key of ['a','h']){await page.locator('#synthChipTabCdda').focus();const count=await page.evaluate(()=>__fmCddaAudit.ramps().length);await page.keyboard.down(key);await state(page,'playing');const pcm=await audio(page);assert(pcm.left.amplitudes[440]>.01&&pcm.right.amplitudes[440]>.01,'Keyboard retains the original 440 Hz rate');await page.keyboard.up(key);await until(()=>ui(page).then(value=>phase(value)!=='playing'&&frame(value)===0),'Keyboard release rewinds');await silence(page);const ramps=await page.evaluate(count=>__fmCddaAudit.ramps().slice(count),count);assert(ramps.some(value=>value.to===0&&Math.abs(value.seconds-.008)<1e-6),'Keyboard release applies an 8 ms output fade '+JSON.stringify(ramps));}
    await range(page,'#cddaTestFrequency',880,true);await range(page,'#cddaTestLevel',.25,true);await range(page,'#cddaTestDuration',4,true);
    await until(()=>page.locator('#cddaTestStatus').textContent().then(value=>/Saved in Files|Loaded samples/i.test(value)),'Generated WAV saved');await until(()=>ui(page).then(value=>Number(value.trackFrames)===176400&&settled(value)),'Edited generated track ready');
    await page.locator('#synthChipTabCdda').focus();await page.keyboard.down('a');await state(page,'playing');measurements.generated=await audio(page);assert(measurements.generated.left.amplitudes[880]>.005);await page.keyboard.up('a');await silence(page);
    step('Passive default Sine, live author controls and two Keyboard notes use the original audio rate with numeric 8 ms release fades');

    await page.locator('#cassetteImportInput').setInputFiles({name:'cdda-fixture.cassette.zip',mimeType:'application/zip',buffer:fixtures.cassette});await ready();await tab();
    await load(page,'album/a.wav');assert.equal(Number((await ui(page)).trackFrames),352800);await load(page,'album/tracks.cdda.json');assert.deepEqual(await page.locator('#cddaTrackSelect option').evaluateAll(nodes=>nodes.map(node=>Number(node.value))),[3,7]);await track(page,7);await seek(page,1.25);
    await page.locator('#cddaPlay').click();await state(page,'playing');measurements.stereo=await audio(page);stereo(measurements.stereo,'b');await page.locator('#cddaPlay').click();await state(page,'paused');const paused=frame(await ui(page));await wait(130);assert.equal(frame(await ui(page)),paused);await silence(page);assert.match(await page.locator('#cddaPlay').textContent(),/Resume/);await seek(page,2);await page.locator('#cddaPlay').click();await state(page,'playing');assert(frame(await ui(page))>=88200);await stop(page);await silence(page);
    step('Files WAV and relative manifests load/select tracks; Play, Pause, Resume, Seek and Stop share the stereo PCM cursor');

    const add=page.waitForEvent('filechooser');await page.locator('#cddaAddFiles').click();await(await add).setFiles({name:'added.wav',mimeType:'audio/wav',buffer:fixtures.a});await ready();await until(()=>page.locator('#cddaSourceSelect option').evaluateAll(nodes=>nodes.some(node=>node.value.endsWith('/added.wav'))),'Add to Files WAV available');
    await page.locator('#cddaSessionInput').setInputFiles({name:'temporary-session.wav',mimeType:'audio/wav',buffer:fixtures.b});await until(()=>ui(page).then(value=>Number(value.sessionCount)===1&&value.sourceKind==='session'&&settled(value)),'Session WAV loaded');await portable();await page.locator('#cddaPlay').click();await state(page,'playing');stereo(await audio(page),'b');await page.locator('#cddaClearSession').click();await until(()=>ui(page).then(value=>Number(value.sessionCount)===0&&settled(value)),'Session cleared');await silence(page);await load(page,'album/tracks.cdda.json');await track(page,3);
    step('Add to Files persists WAV bytes; session WAVs play without entering Cassette export and Clear stops their transport');

    await edit(CODE);await run();await until(()=>page.evaluate(()=>Boolean(globalThis.__fmCdda?.ready)),'Shared Code client exposed');await page.locator('#synthWorkspaceCodeButton').click();await tab();const shared=await codeState();assert.equal(shared.sourceId,(await ui(page)).sourceId);assert.deepEqual(shared.tracks.map(item=>item.number),[3,7]);
    await seek(page,1.5);assert.equal((await codeState()).positionFrames,66150);await page.evaluate(()=>__fmCdda.c.play(3,{offset:.5}));await state(page,'playing');stereo(await audio(page));await page.evaluate(()=>__fmCdda.c.pause());await state(page,'paused');assert.equal((await codeState()).positionFrames,frame(await ui(page)));await page.evaluate(()=>__fmCdda.c.resume());await state(page,'playing');
    await tab('synthSongMixButton');await range(page,'#synthSongGroupVolume-cdda',100);measurements.full=await audio(page);await range(page,'#synthSongGroupVolume-cdda',50);measurements.half=await audio(page);assert(Math.abs(rms(measurements.half)/rms(measurements.full)-.5)<.07);
    const beforeGainZero=await codeState();await range(page,'#synthSongGroupVolume-cdda',0);await silence(page);assert((await codeState()).positionFrames>beforeGainZero.positionFrames,'Zero source gain continues advancing');await range(page,'#synthSongGroupVolume-cdda',100);
    const beforeMute=await codeState();await page.locator('[data-song-mute="cdda:0"]').click();await silence(page);const muted=await codeState();assert(muted.positionFrames>beforeMute.positionFrames&&muted.ticks>beforeMute.ticks,'Muted CD-DA continues advancing');await page.locator('[data-song-mute="cdda:0"]').click();await range(page,'#synthSongGroupVolume-cdda',100);
    await range(page,'#masterVolumeRange',50);measurements.masterHalf=await audio(page);assert(Math.abs(rms(measurements.masterHalf)/rms(measurements.full)-.5)<.07);const beforeMasterZero=await codeState();await range(page,'#masterVolumeRange',0);await silence(page);assert((await codeState()).positionFrames>beforeMasterZero.positionFrames,'Zero Master continues advancing');await range(page,'#masterVolumeRange',100);stereo(await audio(page));
    step('UI and Code use one source and cursor; Master, source gain and stereo mute affect PCM while transport and Code keep advancing');

    await page.evaluate(()=>__fmCdda.c.seek(0));const beforeFx=await codeState();measurements.fxDry=await audio(page);
    await edit(SHARED_CODE+"liveFx('cdda-half',{process(input,output){for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*.5;}});\n");await run(true);
    measurements.fxHalf=await audio(page);assert(Math.abs(rms(measurements.fxHalf)/rms(measurements.fxDry)-.5)<.07,'CD-DA passes through Code liveFx exactly once');
    const withFx=await codeState();assert.equal(withFx.id,beforeFx.id);assert.equal(withFx.sourceId,beforeFx.sourceId);assert.equal(withFx.revision,beforeFx.revision);assert(withFx.positionFrames>beforeFx.positionFrames,'FX Apply retains the playing cursor');
    await edit(SHARED_CODE);await run(true);measurements.fxRestored=await audio(page);assert(Math.abs(rms(measurements.fxRestored)/rms(measurements.fxDry)-1)<.07,'Removing liveFx restores the direct CD-DA route');assert.equal((await codeState()).id,beforeFx.id);
    step('Code liveFx Apply halves actual CD-DA PCM and removal restores it while preserving the client, source and advancing cursor');

    await edit(COEXIST);await run(true);await tab();await page.evaluate(()=>__fmCdda.c.play(3,{offset:0}));await state(page,'playing');
    for(const id of ['synthChipTabYm2612','synthChipTabPsg','synthChipTabPcm','synthChipTabCdda','synthChipTabPwm','synthSongMixButton','synthInputKeyboardTab','synthInputCodeTab']){await tab(id);assert.equal(await page.locator('#synthCodeExpandButton').getAttribute('aria-pressed'),'true');assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);assert((await codeState()).positionFrames>=0);}
    await tab('synthSongMixButton');for(const id of ['ym2612:1','psg:0','pcm:0'])await page.locator(`[data-song-mute="${id}"]`).click();stereo(await audio(page));for(const id of ['ym2612:1','psg:0','pcm:0'])await page.locator(`[data-song-mute="${id}"]`).click();
    measurements.sharedGraph=await page.evaluate(()=>__fmCddaAudit.graph());assert.equal(measurements.sharedGraph.contexts,1,'UI, Code and chips share one AudioContext');assert.equal(measurements.sharedGraph.worklets.filter(node=>node.name==='tetorica-cdda'&&node.connected).length,1,'One active CD-DA endpoint');
    const retained=await codeState();await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped/.test(value)),'Code Stop');await silence(page);assert.equal(frame(await ui(page)),0);assert.equal((await ui(page)).revision,String(retained.revision));assert.equal(await page.evaluate(async()=>{try{await __fmCdda.c.play();return'allowed';}catch(error){return error.name;}}),'AbortError');await tab();await page.locator('#cddaPlay').click();await state(page,'playing');stereo(await audio(page));await stop(page);
    step('FM, PSG and PCM coexist with CD-DA through all eight tabs; Code Stop rewinds the shared source and revokes stale clients while UI can replay');

    await page.locator('#tfiFile').setInputFiles({name:'parallel.vgm',mimeType:'application/octet-stream',buffer:vgm()});await ready();await tab('synthChipTabPsg');await page.locator('#synthSongPlayButton').click();await until(()=>page.locator('#synthSongStatus').getAttribute('data-state').then(value=>value==='playing'),'Reference VGM playing');await tab();await load(page,'album/tracks.cdda.json');await page.locator('#cddaPlay').click();await state(page,'playing');stereo(await audio(page));await tab('synthChipTabPsg');assert.equal(await page.locator('#synthSongStatus').getAttribute('data-state'),'playing');await page.locator('#synthSongStopButton').click();await tab();assert.equal(phase(await ui(page)),'playing');await stop(page);await portable();
    step('Authored CD-DA plays beside VGM reference audio; stopping VGM keeps the independent CD transport and source files');

    for(const width of [1360,390]){await page.setViewportSize({width,height:1050});await tab();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'CD-DA fits '+width);await page.screenshot({path:path.join(config.screenshots,`${name}-cdda-expanded-${width}.png`),fullPage:true});await tab('synthSongMixButton');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mixer fits '+width);await page.screenshot({path:path.join(config.screenshots,`${name}-mixer-expanded-${width}.png`),fullPage:true});}
    await page.setViewportSize({width:1360,height:1050});await tab();await page.locator('#cddaSessionInput').setInputFiles({name:'temporary-session.wav',mimeType:'audio/wav',buffer:fixtures.b});await until(()=>ui(page).then(value=>Number(value.sessionCount)===1&&settled(value)),'Session before New');await page.locator('#cddaPlay').click();await state(page,'playing');await menu();await page.locator('#newCassetteButton').click();await page.locator('#synthNewCassetteCreate').click();await page.locator('#synthNewCassetteDialog').waitFor({state:'hidden'});await ready();await tab();await assertQuiet();assert.equal(Number((await ui(page)).sessionCount),0);await until(async()=>!file(await draft(page),'/album/a.wav'),'New clears old CD files');await page.locator('#synthFileUndoButton').click();await ready();await tab();await assertQuiet();await portable();
    await load(page,'album/tracks.cdda.json');await page.locator('#cddaPlay').click();await state(page,'playing');await page.locator('#cassetteImportInput').setInputFiles({name:'clean.cassette.zip',mimeType:'application/zip',buffer:fixtures.clean});await ready();await tab();await assertQuiet();assert.equal(Number((await ui(page)).sessionCount),0);await page.locator('#synthFileUndoButton').click();await ready();await tab();await assertQuiet();await portable();
    await until(async()=>Boolean(file(await draft(page),'/album/a.wav')),'CD file draft durable');await page.reload();await ready();await tab();await assertQuiet();assert.equal(Number((await ui(page)).sessionCount),0);await portable();await load(page,'album/tracks.cdda.json');assert.deepEqual(await page.locator('#cddaTrackSelect option').evaluateAll(nodes=>nodes.map(node=>Number(node.value))),[3,7]);
    step('New, Cassette import, Undo and reload retire CD playback/session references while exported and restored WAV/manifest bytes stay exact');
    await page.reload();await ready();assert.equal((await page.evaluate(()=>__fmCddaAudit.graph())).contexts,0);
    await edit(CODE+"\nawait c.load('/album/tracks.cdda.json');\nawait c.play(3);\n");await run();await state(page,'playing');stereo(await audio(page));
    measurements.coldCodeGraph=await page.evaluate(()=>__fmCddaAudit.graph());assert.equal(measurements.coldCodeGraph.contexts,1,'Cold Code CD-DA uses the single host context');
    await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped/.test(value)),'Cold Code Stop');await silence(page);
    measurements.graph=await page.evaluate(()=>__fmCddaAudit.graph());assert(measurements.graph.muted);assert.deepEqual(measurements.graph.errors,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    step('Fresh-page Code loads and plays CD-DA under runtime guards without any prior CD audio UI action');
    return{browser:name,passed:true,checks,measurements,errors,consoleErrors};
  }catch(error){error.caseResult={browser:name,passed:false,checks,measurements,error:error.stack??String(error),ui:await ui(page).catch(()=>null),status:await page.locator('#status').textContent().catch(()=>null),cddaError:await page.locator('#cddaSourceStatus').textContent().catch(()=>null),codeError:await page.locator('#synthCodeError').textContent().catch(()=>null),graph:await page.evaluate(()=>__fmCddaAudit.graph()).catch(()=>null),errors,consoleErrors};await page.screenshot({path:path.join(config.screenshots,name+'-failed.png'),fullPage:true}).catch(()=>{});throw error;}
  finally{await context.close();}
}
(async()=>{
  const {createPlaygroundCassetteZip,loadPlaygroundCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')));
  const a=wav(8),b=wav(8,330,880),manifest=Buffer.from(JSON.stringify({tracks:[{number:3,file:'a.wav',startFrame:11025,endFrame:330750,title:'Stereo A'},{number:7,file:'b.wav',startFrame:0,endFrame:308700,title:'Stereo B'}]},null,2)+'\n');
  const files=[['/album/a.wav',a],['/album/b.wav',b],['/album/tracks.cdda.json',manifest],['/opaque/keep.bin',Buffer.from([0,255,128,13,10])]];
  const cassette=Buffer.from(createPlaygroundCassetteZip([{path:'/index.js',type:'text',data:CODE},...files.map(([path,data])=>({path,type:'binary',data}))],{metadata:{title:'FM2612 CDDA browser fixture'}}));
  const clean=Buffer.from(createPlaygroundCassetteZip([{path:'/index.js',type:'text',data:'// Clean replacement, never execute automatically.\n'}],{metadata:{title:'Clean CDDA replacement'}}));
  await fs.mkdir(config.screenshots,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;
  const report={schemaVersion:1,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results};
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin,{a,b,manifest,files,cassette,clean},loadPlaygroundCassette));}finally{await browser.close();}}assert.deepEqual(missing,[]);assert.deepEqual(external,[]);report.passed=true;}
  catch(error){report.passed=false;if(error.caseResult)results.push(error.caseResult);report.error=error.stack??String(error);console.error(report.error);process.exitCode=1;}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));Object.assign(report,{missing,external,blockedMonaco,checkerSha256:hash(await fs.readFile(__filename)),servedFiles:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),fixtureFiles:files.map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)}))});await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`${report.passed?'PASS':'FAIL'} ${config.out}`);}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
