// SPDX-License-Identifier: BSD-3-Clause
// Focused actual New Cassette UI checks. Every speaker route passes through a
// permanent zero-gain gate installed before application code; no listening.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{chromium,webkit}=require('playwright');
const repository=path.resolve(__dirname,'..'),started=Date.now();
const config={app:'huc6280',root:path.join(repository,'docs'),entry:'',engines:'chromium,webkit',out:'',screenshots:'',compare:''};
const args=process.argv.slice(2);
for(let index=0;index<args.length;index++){
  const match=/^--(app|root|entry|engines|out|screenshots|compare)(?:=(.+))?$/.exec(args[index]);
  assert(match,'Unknown argument '+args[index]);config[match[1]]=match[2]??args[++index];assert(config[match[1]]);
}
assert(['huc6280','fm2608'].includes(config.app));
const pce=config.app==='huc6280',prefix=pce?'huc':'opna',appDirectory='synth-'+config.app;
config.root=path.resolve(config.root);config.entry||='/'+appDirectory+'/index.html';
config.out||=path.join(repository,'build/pce-opna-refinement-20261118',config.app+'-new-source.json');
config.screenshots||=path.join(path.dirname(config.out),config.app+'-new-images');
assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(value=>['chromium','webkit'].includes(value)));
const sha=value=>createHash('sha256').update(value).digest('hex'),served=new Map(),sourceErrors=[],results=[];
let activeNetwork=null;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer(async(request,response)=>{
  try{
    let name=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(name==='/favicon.ico'){response.writeHead(204).end();return;}
    if(name.endsWith('/'))name+='index.html';
    const file=path.resolve(config.root,'.'+name);assert(file.startsWith(config.root+path.sep));
    const bytes=await fs.readFile(file),key=path.relative(config.root,file).split(path.sep).join('/'),record={bytes:bytes.length,sha256:sha(bytes)};
    if(served.has(key)&&served.get(key).sha256!==record.sha256){sourceErrors.push('Asset changed while served: '+key);throw Error(sourceErrors.at(-1));}
    served.set(key,record);const finish=()=>{if(!response.destroyed)response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);};
    if(activeNetwork?.holdWorklet&&path.basename(file)===activeNetwork.holdWorklet){activeNetwork.held.push(finish);return;}finish();
  }catch{response.writeHead(404).end();}
});
function installSilentAudit({database}){
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,open=indexedDB.open.bind(indexedDB);
  const audit=window.__newCassetteAudit={contexts:[],gates:[],meters:[],databases:[],traffic:[]};
  window.AudioContext=class extends Context{constructor(options={}){super({...options,sampleRate:48000});audit.contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  AudioNode.prototype.connect=function(destination,...rest){
    if(destination!==this.context.destination)return connect.call(this,destination,...rest);
    const mute=this.context.createGain(),analyser=this.context.createAnalyser();mute.gain.value=0;analyser.fftSize=8192;
    connect.call(this,analyser);connect.call(this,mute);connect.call(mute,destination);audit.gates.push(mute);audit.meters.push(analyser);return destination;
  };
  MessagePort.prototype.postMessage=function(data,...rest){if(data?.method)audit.traffic.push({method:data.method,time:performance.now()});return post.call(this,data,...rest);};
  indexedDB.open=(...args)=>{const request=open(...args);request.addEventListener('success',()=>audit.databases.push(request.result));return request;};
  audit.graph=()=>({contexts:audit.contexts.length,rates:audit.contexts.map(value=>value.sampleRate),speakerRoutes:audit.gates.length,physicalOutputMuted:audit.gates.every(value=>value.gain.value===0)});
  audit.audio=()=>audit.meters.map(analyser=>{
    const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);let peak=0,square=0;
    for(const value of pcm){if(!Number.isFinite(value))throw Error('Non-finite media PCM');peak=Math.max(peak,Math.abs(value));square+=value*value;}
    const amplitude=frequency=>{let sine=0,cosine=0;for(let index=0;index<pcm.length;index++){const phase=index*2*Math.PI*frequency/analyser.context.sampleRate;sine+=pcm[index]*Math.sin(phase);cosine+=pcm[index]*Math.cos(phase);}return 2*Math.hypot(sine,cosine)/pcm.length;};
    return{peak,rms:Math.sqrt(square/pcm.length),hz440:amplitude(440),hz880:amplitude(880),rate:analyser.context.sampleRate,physicalOutputMuted:audit.gates.every(value=>value.gain.value===0)};
  }).sort((a,b)=>b.rms-a.rms)[0]??{peak:0,rms:0,hz440:0,hz880:0,physicalOutputMuted:true};
  audit.snapshot=async()=>{
    const db=audit.databases.findLast(value=>value.name===database);if(!db)return null;
    const value=await new Promise((resolve,reject)=>{const request=db.transaction('projects','readonly').objectStore('projects').get('current');request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);});
    return JSON.parse(JSON.stringify(value,(_key,item)=>item instanceof Uint8Array?{$bytes:Array.from(item)}:item));
  };
}
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function until(read,label,timeout=20000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await read();if(value)return value;await wait(25);}throw Error('Timed out: '+label);}
const graph=page=>page.evaluate(()=>__newCassetteAudit.graph()),snapshot=page=>page.evaluate(()=>__newCassetteAudit.snapshot());
const id=name=>'#'+prefix+name;
const fileIn=(value,name)=>value?.filesystem.files.find(file=>file.path===name);
async function ready(page){await until(()=>page.locator(id('FilesPanel')).getAttribute('aria-busy').then(value=>value==='false'),'Files ready');}
async function menu(page,button){if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenu summary').first().click();await page.locator(button).click();}
async function openNew(page){await menu(page,id('ProjectNewButton'));await page.locator(id('NewCassetteDialog')).waitFor({state:'visible'});assert(await page.locator(id('NewCassetteCancel')).evaluate(node=>node===document.activeElement));assert(!await page.locator('#synthMenu').evaluate(node=>node.open));}
async function newDone(page){await page.locator(id('NewCassetteDialog')).waitFor({state:'hidden'});await ready(page);await until(()=>page.locator(id('FilesStatus')).textContent().then(value=>/^New .* Cassette created\./.test(value)),'new project success');}
async function files(page){if(await page.locator(id('FilesPanel')).isHidden())await page.locator(id('FilesToggle')).click();}
async function addFile(page,name,bytes){await files(page);await page.locator(id('FilesInput')).setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(bytes)});await until(()=>page.locator(id('FilesTree')+' [data-file-path="/'+name+'"]').count(),'added '+name);}
async function source(page,text){await files(page);await page.locator(id('FilesTree')+' [data-file-path="/index.js"]').click();await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await until(()=>page.locator('#synthCodeEditor').isEditable(),'fallback editor ready');await page.locator('#synthCodeEditor').fill(text);}
async function importCassette(page,bytes){const chooser=page.waitForEvent('filechooser');await menu(page,id('ProjectImportButton'));await(await chooser).setFiles({name:'preserved.cassette.zip',mimeType:'application/zip',buffer:bytes});}
function fixtureSong(){
  const write=(register,value)=>[pce?0xb9:0x56,register,value];let commands=[];
  if(pce){commands=[...write(1,255),...write(0,0),...write(4,64),...write(4,0),...Array.from({length:32},(_,index)=>write(6,Math.round(15.5+15.5*Math.sin(index*Math.PI/16)))).flat(),...write(5,255),...write(2,172),...write(3,1),...write(7,0),...write(4,151)];}
  else commands=[...write(0,56),...write(1,2),...write(7,0x3e),...write(8,10)];
  for(let second=0;second<60;second++)commands.push(0x61,0x44,0xac);commands.push(0x66);
  const bytes=Buffer.alloc(256+commands.length);bytes.write('Vgm ');bytes.writeUInt32LE(bytes.length-4,4);bytes.writeUInt32LE(0x171,8);bytes.writeUInt32LE(60*44100,0x18);bytes.writeUInt32LE(0xcc,0x34);bytes.writeUInt32LE(pce?3579545:8000000,pce?0xa4:0x48);bytes.set(commands,256);return bytes;
}
function sessionWav(){const frames=4410,bytes=Buffer.alloc(44+frames*4);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(44100,24);bytes.writeUInt32LE(176400,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*4,40);for(let index=0;index<frames;index++){const value=Math.round(Math.sin(index*Math.PI*660/44100)*4000);bytes.writeInt16LE(value,44+index*4);bytes.writeInt16LE(value,46+index*4);}return bytes;}
const mediaDefinitions=[{key:'msm5205',tab:'#msm5205ChipTab',mount:'#msmTestPcm',source:'#msm5205Controls',play:'#msmPlay',stop:'#msmStop',stem:'MSM5205 test wave'},
  {key:'cdda',tab:'#cddaChipTab',mount:'#cddaTestPcm',source:'#cddaControls',play:'#cddaPlay',stop:'#cddaStop',stem:'CD-DA test wave'}];
const pcmControl=(media,name)=>'#'+media.key+'Test'+name;
const fileBytes=entry=>Buffer.from(entry.data.$bytes??entry.data);
function waveStats(bytes){
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');assert.equal(bytes.readUInt16LE(20),1);assert.equal(bytes.readUInt16LE(22),2);assert.equal(bytes.readUInt32LE(24),44100);assert.equal(bytes.readUInt16LE(34),16);
  const frames=bytes.readUInt32LE(40)/4;assert.equal(bytes.length,44+frames*4);let peak=0,square=0,crossings=0,previous=0;
  for(let index=0;index<frames;index++){const value=bytes.readInt16LE(44+index*4);assert.equal(value,bytes.readInt16LE(46+index*4));peak=Math.max(peak,Math.abs(value));square+=value*value;if(previous<0&&value>=0)crossings++;previous=value;}
  return{bytes:bytes.length,sha256:sha(bytes),frames,rate:44100,channels:2,bits:16,peak:peak/32767,rms:Math.sqrt(square/frames)/32767,cycles:crossings};
}
async function mediaLoaded(page,media){await until(()=>page.locator(media.mount).evaluate(node=>node.dataset.loading==='false'&&node.dataset.dirty==='false'),'loaded '+media.key+' test wave');assert.notEqual(await page.locator(media.source).getAttribute('data-source-state'),'playing');assert.equal(await page.locator(pcmControl(media,'Status')).getAttribute('data-error'),'false');}
async function mediaFile(page,media){return until(async()=>{const value=await snapshot(page),entry=value?.filesystem.files.find(file=>file.type==='binary'&&file.path.startsWith('/samples/'+media.stem));return entry?{entry,value}:false;},'persisted '+media.key+' WAV');}
async function range(page,media,name,value,{commit=true}={}){await page.locator(pcmControl(media,name)).evaluate((input,{value,commit})=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));if(commit)input.dispatchEvent(new Event('change',{bubbles:true}));},{value,commit});}
async function mediaCold(page,measurements,checks){
  measurements.media={};
  for(const media of mediaDefinitions){
    await page.locator(media.tab).click();await page.locator(media.mount+' [data-test-shape="sine"]').click();await mediaLoaded(page,media);
    const {entry}=await mediaFile(page,media),initial=waveStats(fileBytes(entry));assert.equal(initial.frames,44100);assert(Math.abs(initial.peak-.5)<.001);assert(Math.abs(initial.cycles-440)<=2);assert.equal((await graph(page)).contexts,0);
    assert.equal(await page.locator(pcmControl(media,'Auto')).count(),0);assert.equal(await page.locator(pcmControl(media,'Load')).count(),0);
    const box=await page.locator(pcmControl(media,'Cycle')).boundingBox();assert(box);
    await page.mouse.move(box.x+15,box.y+box.height*.75);await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.15,{steps:7});
    assert.equal(await page.locator(pcmControl(media,'Cycle')).getAttribute('data-shape'),'drawn');assert.equal(sha(fileBytes((await mediaFile(page,media)).entry)),initial.sha256,'Pointer movement must not write WAV data');
    await page.mouse.up();await range(page,media,'Frequency',880);await range(page,media,'Level',.25);await range(page,media,'Duration',.5);
    await mediaLoaded(page,media);const drawn=await until(async()=>{const stats=waveStats(fileBytes((await mediaFile(page,media)).entry));return stats.peak<=.251&&stats.frames===22050?stats:false;},'automatic drawn WAV commit');
    assert.equal((await graph(page)).contexts,0);
    const autoBox=await page.locator(pcmControl(media,'Cycle')).boundingBox();
    await page.mouse.move(autoBox.x+autoBox.width*.4,autoBox.y+autoBox.height*.9);await page.mouse.down();await page.mouse.move(autoBox.x+autoBox.width*.65,autoBox.y+autoBox.height*.9,{steps:4});
    assert.equal(sha(fileBytes((await mediaFile(page,media)).entry)),drawn.sha256,'WAV persistence stays deferred until pointerup');await page.mouse.up();await mediaLoaded(page,media);
    await until(async()=>sha(fileBytes((await mediaFile(page,media)).entry))!==drawn.sha256,'automatic final gesture save');
    await range(page,media,'Frequency',440);await range(page,media,'Level',.5);await range(page,media,'Duration',1);await page.locator(media.mount+' [data-test-shape="sine"]').click();await mediaLoaded(page,media);
    await until(async()=>waveStats(fileBytes((await mediaFile(page,media)).entry)).sha256===initial.sha256,'restored Sine without extra files');
    await page.locator(pcmControl(media,'Smooth')).uncheck();await mediaLoaded(page,media);const unsmoothed=await until(async()=>{const bytes=fileBytes((await mediaFile(page,media)).entry);return sha(bytes)!==initial.sha256?bytes:false;},'edge smoothing disabled');assert.notEqual(unsmoothed.readInt16LE(unsmoothed.length-4),0);
    await page.locator(pcmControl(media,'Smooth')).check();await mediaLoaded(page,media);await until(async()=>sha(fileBytes((await mediaFile(page,media)).entry))===initial.sha256,'five-millisecond smoothing restored');
    measurements.media[media.key]={path:entry.path,initial,drawn};
  }
  checks.push('Both software helpers generate cold 44.1 kHz stereo PCM16 WAVs at 440 Hz/50% with no AudioContext or autoplay');
  checks.push('All edits apply automatically without Load controls; canvas drags defer WAV saves until pointerup; length/level/frequency and Smooth edges produce the expected PCM data');
}
async function mediaPlay(page,measurements,checks){
  for(const media of mediaDefinitions){
    const record=measurements.media[media.key];await page.locator(media.tab).click();await page.locator(media.mount+' [data-test-shape="sine"]').click();await mediaLoaded(page,media);
    const play=async()=>{await page.locator(media.play).click();await until(()=>page.locator(media.source).getAttribute('data-source-state').then(value=>value==='playing'),'actual '+media.key+' Play');await wait(230);const audio=await page.evaluate(()=>__newCassetteAudit.audio());assert(audio.physicalOutputMuted&&audio.rms>.005&&audio.peak<1);return audio;};
    record.sineAudio=await play();assert(record.sineAudio.hz440>record.sineAudio.hz880*5);await page.locator(media.stop).click();
    await page.locator(media.mount+' [data-test-shape="square"]').click();await mediaLoaded(page,media);const square=await until(async()=>{const stats=waveStats(fileBytes((await mediaFile(page,media)).entry));return stats.sha256!==record.initial.sha256?stats:false;},'Square WAV data');assert(square.rms>record.initial.rms*1.3);record.square=square;
    record.squareAudio=await play();assert(record.squareAudio.hz440>record.squareAudio.hz880*3);await page.locator(media.stop).click();
    await range(page,media,'Frequency',880);await range(page,media,'Level',.25);await page.locator(media.mount+' [data-test-shape="sine"]').click();await mediaLoaded(page,media);
    record.changed=await until(async()=>{const stats=waveStats(fileBytes((await mediaFile(page,media)).entry));return Math.abs(stats.peak-.25)<.001&&Math.abs(stats.cycles-880)<=2?stats:false;},'880 Hz quarter-level WAV');
    record.changedAudio=await play();assert(record.changedAudio.hz880>record.changedAudio.hz440*5);assert(record.changedAudio.rms<record.sineAudio.rms*.8);await page.locator(media.stop).click();
    const saved=await mediaFile(page,media),matching=saved.value.filesystem.files.filter(file=>file.path.startsWith('/samples/'+media.stem));assert.equal(matching.length,1,'Unchanged owned WAV must be reused');assert.equal(saved.entry.path,record.path);record.finalSha256=sha(fileBytes(saved.entry));
  }
  checks.push('Real Play emits finite nonzero muted MSM5205/CD-DA PCM; Sine/Square and 440→880 Hz/50→25% changes alter WAVs, measured frequency and output RMS while each owned WAV path is reused');
}
const mediaState=(page,media)=>page.locator(media.source).evaluate(node=>({...node.dataset}));
const mediaPlaying=(page,media)=>until(()=>mediaState(page,media).then(value=>value.sourceState==='playing'&&value.playPending!=='true'),'keyboard '+media.key+' playing');
const mediaStopped=(page,media)=>until(()=>mediaState(page,media).then(value=>value.sourceState!=='playing'&&value.playPending!=='true'),'keyboard '+media.key+' stopped');
const keyNode=(page,key)=>page.locator('#keyboard .key[data-key="'+key+'"]');
async function blurInput(page){await page.locator('#synthTitle').click();await page.evaluate(()=>document.activeElement?.blur());}
async function mediaDefaultKeys(page,checks){
  for(const media of mediaDefinitions){await page.locator(media.tab).click();await page.locator('#synthInputKeyboardTab').click();await until(()=>mediaState(page,media).then(value=>value.sourceState==='ready'&&Number(value.assetFrames??value.trackFrames)>0),'default '+media.key+' ready');assert(await page.locator('#keyboard').isVisible());assert(await page.locator('#pitchBend').isDisabled());assert(await page.locator('#keyboardPitchBend').isDisabled());assert(await keyNode(page,'a').isEnabled());assert.equal((await graph(page)).contexts,0);assert.equal(await page.locator('#keyboard .key.is-active').count(),0);}
  checks.push('Default Sines are ready for keyboard input with Pitch disabled, without an AudioContext or autoplay');
}
async function mediaPendingKey(page,network,measurements,checks){
  const media=mediaDefinitions[0];await page.locator(media.tab).click();await page.locator('#synthInputKeyboardTab').click();await blurInput(page);
  network.holdWorklet='msm5205_worklet.js';await page.keyboard.down('a');await until(()=>network.held.length,'first media readiness held by network');
  const beforeStop=await graph(page);assert(await keyNode(page,'a').evaluate(node=>node.classList.contains('is-active')));await page.keyboard.up('a');await page.locator('#stopAudio').click();
  network.holdWorklet=null;for(const finish of network.held.splice(0))finish();await mediaStopped(page,media);await wait(250);
  assert.equal(await page.locator('#keyboard .key.is-active').count(),0);const audio=await page.evaluate(()=>__newCassetteAudit.audio());assert(audio.peak<1e-7&&audio.physicalOutputMuted);assert.equal((await graph(page)).contexts,beforeStop.contexts);assert(beforeStop.contexts<=1);
  measurements.quickKey={audio,graph:await graph(page)};
  checks.push('Keyup and Stop during held first-worklet readiness retire the pending trigger; late readiness cannot create orphan playback or a second context');
}
async function mediaKeyboard(page,measurements,checks){
  measurements.mediaKeyboard={};
  for(const media of mediaDefinitions){
    await page.locator(media.tab).click();await page.locator('#synthInputKeyboardTab').click();await blurInput(page);
    assert(await keyNode(page,'a').isEnabled());assert(await page.locator('#keyboard').isVisible());assert.match(await page.locator('#hucKeyboardHint').textContent(),media.key==='cdda'?/original rate/:/selected Rate/);assert(await page.locator('#pitchBend').isDisabled());assert(await page.locator('#keyboardPitchBend').isDisabled());
    const beforeKeys=await mediaState(page,media);await page.keyboard.down('a');await mediaPlaying(page,media);assert(await keyNode(page,'a').evaluate(node=>node.classList.contains('is-active')));const firstKey=await mediaState(page,media);if(media.key==='msm5205')assert.equal(firstKey.activeRate,beforeKeys.defaultRate);else assert.equal(firstKey.selectedTrack,beforeKeys.selectedTrack);await page.keyboard.up('a');await mediaStopped(page,media);
    await keyNode(page,'w').scrollIntoViewIfNeeded();const box=await keyNode(page,'w').boundingBox();assert(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await mediaPlaying(page,media);await page.mouse.up();await mediaStopped(page,media);
    await blurInput(page);await page.keyboard.down('a');await mediaPlaying(page,media);await page.keyboard.down('w');await mediaPlaying(page,media);await page.keyboard.up('a');await wait(60);assert.equal((await mediaState(page,media)).sourceState,'playing');assert(await keyNode(page,'w').evaluate(node=>node.classList.contains('is-active')));assert(!await keyNode(page,'a').evaluate(node=>node.classList.contains('is-active')));await page.keyboard.up('w');await mediaStopped(page,media);
    await blurInput(page);await page.keyboard.down('a');await mediaPlaying(page,media);await page.locator(media.play).click();
    if(media.key==='cdda'){await until(()=>mediaState(page,media).then(value=>value.sourceState==='paused'),'UI Pause takes CD-DA ownership');await page.locator(media.play).click();}
    await mediaPlaying(page,media);await page.keyboard.up('a');await wait(60);assert.equal((await mediaState(page,media)).sourceState,'playing');assert.equal(await page.locator('#keyboard .key.is-active').count(),0);await page.locator(media.stop).click();await mediaStopped(page,media);
    const waiting='media-keyboard-waiting:'+media.key,takeover='media-Code-takeover:'+media.key;
    const code=`const media=await useSoundChip('${media.key}');log('${waiting}');await beat(2);await media.play(${media.key==='cdda'?'1':'{loop:true}'});log('${takeover}');liveLoop('media-owner',async()=>{await beat(1);});`;
    await source(page,code);await page.locator('#synthCodeRunButton').click();await until(()=>page.locator('#synthCodeLog').textContent().then(value=>value.includes(waiting)),'Code waiting before media takeover');await blurInput(page);await page.keyboard.down('a');await mediaPlaying(page,media);
    await until(()=>page.locator('#synthCodeLog').textContent().then(value=>value.includes(takeover)),'documented Code Play takes ownership');await page.keyboard.up('a');await wait(60);assert.equal((await mediaState(page,media)).sourceState,'playing');assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);assert.equal(await page.locator('#keyboard .key.is-active').count(),0);await page.locator('#synthCodeStopButton').click();await mediaStopped(page,media);
    await page.locator('#synthInputKeyboardTab').click();await blurInput(page);await page.keyboard.down('a');await mediaPlaying(page,media);await page.locator('#huc6280ChipTab').click();await mediaStopped(page,media);await page.keyboard.up('a');assert.equal(await page.locator('#keyboard .key.is-active').count(),0);
    measurements.mediaKeyboard[media.key]=await mediaState(page,media);
  }
  const [msm,cdda]=mediaDefinitions;await page.locator(msm.tab).click();await page.locator('#msmLoop').check();await page.locator(msm.play).click();await mediaPlaying(page,msm);await page.locator(cdda.tab).click();assert.equal((await mediaState(page,msm)).sourceState,'playing');
  await blurInput(page);await page.keyboard.down('a');await mediaPlaying(page,cdda);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await mediaStopped(page,cdda);await page.keyboard.up('a');assert.equal((await mediaState(page,msm)).sourceState,'playing','Blur retires only keyboard-owned playback');
  await blurInput(page);await page.keyboard.down('a');await mediaPlaying(page,cdda);await page.locator('#huc6280ChipTab').click();await mediaStopped(page,cdda);await page.keyboard.up('a');assert.equal((await mediaState(page,msm)).sourceState,'playing','Tab change keeps unrelated UI playback');
  await page.locator('#stopAudio').click();await mediaStopped(page,msm);assert.equal(await page.locator('#keyboard .key.is-active').count(),0);await page.locator(msm.tab).click();await page.locator('#msmLoop').uncheck();await page.locator('#huc6280ChipTab').click();
  checks.push('Loaded media computer/screen keys start and keyup stops at original Rate/track; overlapping A→W releases only the latest key and Pitch stays disabled');
  checks.push('UI Replay/Pause/Resume and documented Code Play take ownership; an older keyup cannot stop the newer performance');
  checks.push('Tab/blur cleanup clears owned media keys while unrelated UI playback continues; global Stop clears playback and held highlights');
}
async function screenshot(page,engine,label,images){await fs.mkdir(config.screenshots,{recursive:true});const file=path.join(config.screenshots,engine+'-'+label+'.png');await page.screenshot({path:file,fullPage:false});images[label]={file,sha256:sha(await fs.readFile(file))};}
async function run(browser,engine,origin,{defaultSound,starter,loadCassette}){
  const context=await browser.newContext({viewport:{width:1400,height:1000},acceptDownloads:true,serviceWorkers:'block'});
  await context.addInitScript(installSilentAudit,{database:'tetorica-'+(pce?'huc6280':'fm2608')+'-synth-files'});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  const errors=[],missing=[],external=[],blockedMonaco=[],checks=[],images={},measurements={},network={holdWorklet:null,held:[]};activeNetwork=network;let stage='load';
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['data:','blob:'].includes(url.protocol))return route.continue();(/monaco|jsdelivr/.test(url.href)?blockedMonaco:external).push(url.href);return route.abort();});
  page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
  const step=label=>{stage=label;console.log('CHECK '+config.app+'/'+engine+': '+label);};
  async function fresh(previous){const value=await until(async()=>{const saved=await snapshot(page);return saved?.workspaceId&&saved.workspaceId!==previous?saved:false;},'fresh persisted identity');assert.deepEqual(value.settings,defaultSound);assert.equal(fileIn(value,'/index.js').data,starter);assert.deepEqual(value.codeState,{mode:'keyboard',path:'/index.js'});assert.equal(value.selectedPath,'/index.js');assert(!fileIn(value,'/preserved-notes.txt'));assert(!/Running|Playing/i.test(await page.locator('#synthCodeState').textContent()));const paths=value.filesystem.files.map(file=>file.path).sort();assert.deepEqual(paths,pce?['/examples/cdda.js','/examples/huc6280.js','/examples/msm5205.js','/index.js']:['/index.js']);if(pce)for(const media of mediaDefinitions){assert.equal(await page.locator(pcmControl(media,'Frequency')).inputValue(),'440');assert.equal(Number(await page.locator(pcmControl(media,'Level')).inputValue()),.5);assert.equal(await page.locator(pcmControl(media,'Duration')).inputValue(),'1');assert.equal(await page.locator(pcmControl(media,'Auto')).count(),0);assert.equal(await page.locator(pcmControl(media,'Load')).count(),0);assert.equal(await page.locator(pcmControl(media,'Cycle')).getAttribute('data-shape'),'sine');assert.equal(await page.locator(media.mount).getAttribute('data-loading'),'false');}return value;}
  try{
    await page.goto(origin+config.entry);await ready(page);assert.equal((await graph(page)).contexts,0);
    step('cold New, menu ordering and Cancel');
    await openNew(page);await page.locator(id('NewCassetteCancel')).click();assert.equal((await graph(page)).contexts,0);
    await page.locator('#synthMenu summary').first().click();const headings=await page.locator('#synthMenu h2').allTextContents();assert(headings.indexOf('New')>=0&&headings.indexOf('New')<headings.indexOf('Import'));
    assert.equal(await page.locator(id('ProjectNewButton')).textContent(),'Cassette…');assert.equal(await page.locator(id('ProjectExportButton')).textContent(),'Cassette · ZIP');assert.equal(await page.locator(id('ProjectImportButton')).textContent(),pce?'Cassette · ZIP…':'Cassette…');assert(!/Project\s*(?:·\s*)?ZIP/.test(await page.locator('#synthMenu').innerText()));await page.locator('#synthMenu summary').first().click();
    checks.push('New precedes Import; separate Cassette actions and Cassette · ZIP labels; cold Cancel creates no AudioContext');
    if(pce){step('default media keyboard is ready and silent');await mediaDefaultKeys(page,checks);}
    if(pce){step('cold software test WAV generation and deferred drawing');await mediaCold(page,measurements,checks);}
    if(pce){step('external CD-DA session omission');await page.locator('#cddaChipTab').click();await page.locator('#cddaSessionInput').setInputFiles({name:'temporary.wav',mimeType:'audio/wav',buffer:sessionWav()});await until(()=>page.locator('#cddaControls').getAttribute('data-session-count').then(value=>value==='1'),'external CD-DA session');await openNew(page);assert.match(await page.locator(id('NewCassetteDialog')).innerText(),/Session WAVs are not included/);await page.locator(id('NewCassetteCancel')).click();assert.equal(await page.locator('#cddaControls').getAttribute('data-session-count'),'1');assert.equal((await graph(page)).contexts,0);await page.locator('#huc6280ChipTab').click();checks.push('External CD-DA session omission is explicit before confirmation; Cancel preserves its source without creating audio');}
    if(pce){step('media keyup during first asynchronous readiness');await mediaPendingKey(page,network,measurements,checks);}
    if(pce){step('actual muted test-wave playback and editing');await mediaPlay(page,measurements,checks);await page.setViewportSize({width:390,height:844});for(const media of mediaDefinitions){await page.locator(media.tab).click();await page.locator(media.mount).evaluate(node=>node.scrollIntoView({block:'start'}));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await screenshot(page,engine,media.key+'-test-wave-390',images);}await page.setViewportSize({width:1400,height:1000});await page.locator('#huc6280ChipTab').click();checks.push('Both software PCM editors fit at 390px; New resets the cycle/parameters and leaves no generated files or autoplay');}
    if(pce){step('media keyboard ownership and UI/Code handoffs');await mediaKeyboard(page,measurements,checks);}
    step('running Code and unexecuted editor changes survive Cancel/Escape');
    await addFile(page,'preserved-notes.txt','Old Cassette user file\n');
    await page.locator('#instrumentName').fill('Preserved Cassette sound');await page.locator('#instrumentName').dispatchEvent('change');
    await until(async()=>(await snapshot(page))?.settings.name==='Preserved Cassette sound','edited instrument name persisted');
    const running=`const chip=await useSoundChip('${pce?'huc6280':'ym2608'}');await chip.noteOn(CH1,'E3');let ticks=0;liveLoop('keep',async()=>{log('cassette-tick '+ ++ticks);await beat(.25);});\n`;
    await source(page,running);await page.locator('#synthCodeRunButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Playing|Running/.test(value)),'Code running');assert.equal(await page.locator('#synthCodeError').textContent(),'');
    const draft=running+'// Current unscheduled editor change: retain this exact text.\n';await page.locator('#synthCodeEditor').fill(draft);
    const old=await until(async()=>{const value=await snapshot(page);return fileIn(value,'/index.js')?.data===draft?value:false;},'dirty editor persisted');
    measurements.codeGraph=await graph(page);assert(measurements.codeGraph.contexts>0&&measurements.codeGraph.speakerRoutes>0&&measurements.codeGraph.physicalOutputMuted);assert(measurements.codeGraph.rates.every(rate=>rate===48000));
    for(const cancel of ['button','escape']){const beforeLog=await page.locator('#synthCodeLog').textContent();await openNew(page);if(cancel==='button')await page.locator(id('NewCassetteCancel')).click();else await page.keyboard.press('Escape');assert.equal(await page.locator('#synthCodeEditor').inputValue(),draft);assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);assert.equal((await snapshot(page)).workspaceId,old.workspaceId);await until(()=>page.locator('#synthCodeLog').textContent().then(value=>value!==beforeLog),'original Code loop continues');}
    checks.push('Confirm-dialog Cancel and Escape preserve running Code, original loop progress, exact unexecuted editor text and workspace');
    step('real backup before new default Cassette');
    if(pce){await page.locator(mediaDefinitions[0].tab).click();await blurInput(page);await page.keyboard.down('a');await mediaPlaying(page,mediaDefinitions[0]);assert(await keyNode(page,'a').evaluate(node=>node.classList.contains('is-active')));}
    await openNew(page);for(const width of [1400,390]){await page.setViewportSize({width,height:width===390?844:1000});assert(await page.locator(id('NewCassetteDialog')).evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));await screenshot(page,engine,'dialog-'+width,images);}await page.setViewportSize({width:1400,height:1000});
    const downloaded=page.waitForEvent('download');await page.locator(id('NewCassetteExport')).click();const download=await downloaded,archive=await fs.readFile(await download.path());await newDone(page);const created=await fresh(old.workspaceId);
    if(pce){assert.equal(await page.locator('#keyboard .key.is-active').count(),0);for(const media of mediaDefinitions)assert.notEqual((await mediaState(page,media)).sourceState,'playing');await page.keyboard.up('a');await wait(80);assert.equal(await page.locator('#keyboard .key.is-active').count(),0);measurements.keyboardNew={graph:await graph(page),sources:await Promise.all(mediaDefinitions.map(media=>mediaState(page,media)))};checks.push('New Cassette retires a held media keyboard trigger and Code, clears highlights and sources, and ignores the later stale keyup');}
    assert.match(download.suggestedFilename(),/\.cassette\.zip$/);const cassette=await loadCassette(archive),manifest=JSON.parse(new TextDecoder().decode(cassette.files.get((pce?'huc6280':'fm2608')+'-synth.project.json')));
    assert.equal(new TextDecoder().decode(cassette.files.get('index.js')),draft);assert.equal(new TextDecoder().decode(cassette.files.get('preserved-notes.txt')),'Old Cassette user file\n');assert.deepEqual(manifest.settings,old.settings);assert.equal(manifest.settings.name,'Preserved Cassette sound');assert.deepEqual(manifest.codeState,{mode:'code',path:'/index.js'});
    if(pce)for(const media of mediaDefinitions){const record=measurements.media[media.key],bytes=Buffer.from(cassette.files.get(record.path.slice(1)));assert.equal(sha(bytes),record.finalSha256,'Backup retains the exact generated '+media.key+' WAV');}
    measurements.backup={filename:download.suggestedFilename(),bytes:archive.length,sha256:sha(archive),workspaceBefore:old.workspaceId,workspaceAfter:created.workspaceId,files:[...cassette.files.keys()]};await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(path.join(path.dirname(config.out),config.app+'-'+engine+'-preserved.cassette.zip'),archive);
    checks.push('Real download preserves old sound, Files and editor state before a fresh identity/default sound/original starter/examples; no autoplay; desktop/390px dialog fits');
    step('playing song survives confirmation Cancel/Escape');
    const song=fixtureSong();await page.locator(pce?'#vgmFileInput':'#songFileInput').setInputFiles({name:'New Cassette original.vgm',mimeType:'application/octet-stream',buffer:song});
    const play=pce?'#hucSongPlayButton':'#songPlay',select=pce?'#hucSongSelect':'#songSelect',transport=pce?'#hucSongPlayer':'#referenceSong';await until(()=>page.locator(select+' option').evaluateAll(nodes=>nodes.some(node=>node.value==='/vgm/New Cassette original.vgm')),'song archived');await page.locator(select).selectOption('/vgm/New Cassette original.vgm');await until(()=>page.locator(play).isEnabled(),'song ready');await page.locator(play).click();await until(()=>page.locator(transport).getAttribute(pce?'data-state':'data-playback').then(value=>value==='playing'),'song playing');const songWorkspace=(await snapshot(page)).workspaceId;
    const songPosition=()=>pce?page.locator(transport).getAttribute('data-position-frames').then(Number):page.locator('#songSeek').inputValue().then(Number),beforePosition=await songPosition();
    for(const cancel of ['button','escape']){await openNew(page);await wait(150);if(cancel==='button')await page.locator(id('NewCassetteCancel')).click();else await page.keyboard.press('Escape');assert.equal(await page.locator(transport).getAttribute(pce?'data-state':'data-playback'),'playing');assert.equal((await snapshot(page)).workspaceId,songWorkspace);}
    measurements.song={positionBefore:beforePosition,positionAfter:await songPosition(),graph:await graph(page)};assert(measurements.song.positionAfter>beforePosition);assert(measurements.song.graph.physicalOutputMuted);
    await openNew(page);await page.locator(id('NewCassetteCreate')).click();await newDone(page);await fresh(songWorkspace);assert.notEqual(await page.locator(transport).getAttribute(pce?'data-state':'data-playback'),'playing');checks.push('Cancel/Escape preserve the playing song and project; Create without export retires transport and commits fresh defaults without execution');
    step('existing Import, invalid retention and reload');
    await importCassette(page,archive);await until(()=>page.locator(id('FilesTree')+' [data-file-path="/preserved-notes.txt"]').count(),'old Cassette restored');await ready(page);const imported=await until(async()=>{const value=await snapshot(page);return fileIn(value,'/index.js')?.data===draft?value:false;},'import persisted');assert.deepEqual(imported.settings,manifest.settings);assert(!/Running|Playing/.test(await page.locator('#synthCodeState').textContent()));
    await importCassette(page,Buffer.from('Invalid Cassette ZIP'));await until(()=>page.locator(id('FilesStatus')).textContent().then(value=>/zip|archive|cassette|invalid/i.test(value)),'invalid Import report');await ready(page);assert.deepEqual(await snapshot(page),imported);
    await page.reload();await ready(page);assert.equal((await graph(page)).contexts,0);assert.equal((await snapshot(page)).workspaceId,imported.workspaceId);await files(page);await page.locator(id('FilesTree')+' [data-file-path="/index.js"]').click();await page.locator('#synthInputCodeTab').click();await until(()=>page.locator('#synthCodeEditor').inputValue().then(value=>value===draft),'reloaded original editor');assert(!/Running|Playing/.test(await page.locator('#synthCodeState').textContent()));checks.push('Existing Import restores the exported old Cassette without execution; invalid Import preserves it; reload retains identity/files/sound/editor with no audio');
    if(pce){step('generated WAV reload persistence and imported-file ownership');for(const media of mediaDefinitions){const record=measurements.media[media.key];assert.equal(sha(fileBytes(fileIn(await snapshot(page),record.path))),record.finalSha256);await page.locator(media.tab).click();await page.locator(media.mount+' [data-test-shape="sine"]').click();await mediaLoaded(page,media);const saved=await until(async()=>{const value=await snapshot(page),paths=value.filesystem.files.filter(file=>file.path.startsWith('/samples/'+media.stem));return paths.length===2?{value,paths}:false;},'preserved imported WAV and new owned path');assert.equal(sha(fileBytes(fileIn(saved.value,record.path))),record.finalSha256);record.afterImportPaths=saved.paths.map(file=>file.path);assert.equal((await graph(page)).contexts,0);}checks.push('Generated WAV bytes survive real backup, Import and reload; imported/user-owned collisions receive a new path while original data is retained, with no autoplay');}
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert((await graph(page)).physicalOutputMuted);
    return{browser:engine,app:config.app,passed:true,checks,measurements,images,errors,missing,external,expectedBlockedMonaco:blockedMonaco,physicalOutputMuted:true,listeningPerformed:false};
  }catch(error){await screenshot(page,engine,'failure',images).catch(()=>{});error.receipt={browser:engine,app:config.app,passed:false,stage,error:error.stack,checks,measurements,images,errors,missing,external,expectedBlockedMonaco:blockedMonaco,filesStatus:await page.locator(id('FilesStatus')).textContent().catch(()=>null),codeError:await page.locator('#synthCodeError').textContent().catch(()=>null),graph:await graph(page).catch(()=>null)};throw error;}
  finally{network.holdWorklet=null;for(const finish of network.held.splice(0))finish();activeNetwork=null;await context.close();}
}
(async()=>{
  const moduleUrl=file=>pathToFileURL(path.join(repository,'docs',file));
  const [{createDefaultPreset},host,{loadPlaygroundCassette}]=await Promise.all([import(moduleUrl(appDirectory+'/preset.js')),import(moduleUrl(appDirectory+'/code_host.js')),import(moduleUrl('playground/playground_cassette.js'))]);
  let failure=null,comparison=null;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
    for(const engine of engines){const browser=await{chromium,webkit}[engine].launch({headless:true,...engine==='chromium'?{args:['--mute-audio']}:{}});try{results.push(await run(browser,engine,origin,{defaultSound:createDefaultPreset(),starter:host[pce?'HUC6280_STARTER_CODE':'FM2608_STARTER_CODE'],loadCassette:loadPlaygroundCassette}));}catch(error){results.push(error.receipt??{browser:engine,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(sourceErrors,[]);
    if(config.compare){const previous=JSON.parse(await fs.readFile(config.compare,'utf8')),canonical=key=>key.startsWith(appDirectory+'/')?key.slice(appDirectory.length+1):key;
      const old=new Map(Object.entries(previous.servedAssets).map(([key,value])=>[canonical(key),value])),matched=[];
      for(const[key,value]of served){const name=canonical(key);if(!name.endsWith('.html')&&old.has(name)){assert.equal(value.sha256,old.get(name).sha256,'Served source/package parity '+name);matched.push(name);}}
      for(const name of ['synth.js','synth.css','code_files.js','code_project.js','code_host.js',...pce?['test_pcm.js','test_pcm_controls.js','media_keyboard.js','msm5205_source.js','cdda_source.js']:[]])assert(matched.includes(name),'Application asset parity '+name);
      comparison={file:config.compare,matchedAssets:matched.sort(),excluded:'HTML entry links are intentionally rewritten by standalone packaging; actual entry behavior is exercised separately.'};}
  }catch(error){failure=error;}finally{server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,app:config.app,root:config.root,entry:config.entry,elapsedSeconds:(Date.now()-started)/1000,physicalOutputMuted:true,listeningPerformed:false,
    checker:{file:path.relative(repository,__filename),sha256:sha(await fs.readFile(__filename))},servedAssets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),sourceErrors,comparison,results,...failure?{error:failure.stack}:{}};
  await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
