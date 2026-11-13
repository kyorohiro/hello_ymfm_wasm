// SPDX-License-Identifier: BSD-3-Clause
// Same-machine PSF/manual UI checks with self-authored CPU instructions/sample.
// Every physical destination passes through gain zero before app JavaScript.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-spu/index.html',engines:'chromium,webkit',out:path.join(tmpdir(),'spu-psf-manual-browser.json'),screenshots:path.join(tmpdir(),'spu-psf-manual-browser')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown option '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=b=>createHash('sha256').update(b).digest('hex');
async function until(test,label,ms=25000){const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await wait(25);}throw Error('Timeout: '+label);}
const served=new Map(),missing=[],external=[],httpErrors=[],expectedBlockedMonaco=[],results=[];

function installAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,
    connect=AudioNode.prototype.connect,start=AudioBufferSourceNode.prototype.start,stop=AudioBufferSourceNode.prototype.stop,post=MessagePort.prototype.postMessage;
  const contexts=[],nodes=[],meters=[],commands=[],starts=[],stops=[],cores=[],manual=[];let request=0;
  const digest=bytes=>{let n=2166136261;for(const v of bytes)n=Math.imul(n^v,16777619)>>>0;return n.toString(16);};
  const summarize=value=>{
    if(ArrayBuffer.isView(value))return {type:value.constructor.name,length:value.length};
    if(Array.isArray(value))return value.map(summarize);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,summarize(v)]));
    return value;
  };
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...ports){
    if(destination!==this.context.destination)return connect.call(this,destination,...ports);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...ports);connect.call(analyser,mute);connect.call(mute,destination);meters.push({context:this.context,analyser,mute});return destination;
  };
  AudioBufferSourceNode.prototype.start=function(...args){starts.push({when:args[0],offset:args[1],at:this.context.currentTime,frames:this.buffer?.length});return start.apply(this,args);};
  AudioBufferSourceNode.prototype.stop=function(...args){stops.push({at:this.context.currentTime});return stop.apply(this,args);};
  MessagePort.prototype.postMessage=function(message,...args){if(message?.method){commands.push({method:message.method,args:summarize(message.args??[])});if(commands.length>10000)commands.shift();}return post.call(this,message,...args);};
  const latest=()=>cores.findLast(item=>!item.closed);
  function native(item=latest()){
    if(!item||item.closed)return null;const snapshot=item.core.observe();
    return {id:item.id,frame:snapshot.nativeFrames,snapshot,sampleRam:digest(item.core.copySpuRam().subarray(0x1000)),renders:item.renders};
  }
  function track(core){
    const item={id:cores.length,core,closed:false,renders:0,frames:0,finite:true};cores.push(item);
    const manualProxy=core.manual&&new Proxy(core.manual,{get(target,key){const fn=Reflect.get(target,key,target);if(typeof fn!=='function')return fn;
      if(!['edit','noteOn','noteOff','setPitchBend','releaseAll'].includes(key))return fn.bind(target);
      return(...args)=>{if(manual.length>=500)manual.shift();const before=native(item);try{const result=fn.apply(target,args);manual.push({core:item.id,method:key,args:summarize(args),before,after:native(item),result:summarize(result)});return result;}
        catch(error){manual.push({core:item.id,method:key,args:summarize(args),before,error:error.message});throw error;}};
    }});
    return new Proxy(core,{get(target,key){if(key==='manual')return manualProxy;const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      if(key==='dispose')return(...args)=>{item.closed=true;return value.apply(target,args);};
      if(key==='render'||key==='renderWithVoices')return(...args)=>{const result=value.apply(target,args),pcm=result?.pcm??result;item.renders++;item.frames+=args[0];item.finite&&=pcm.every(Number.isFinite);return result;};
      return value.bind(target);
    }});
  }
  async function read(method='inspect',args=[]){
    const node=nodes.findLast(item=>item.name==='tetorica-spu-synth')?.node;if(!node)throw Error('Editor Worklet missing');const id=--request;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Editor audit timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});});
  }
  const levels=()=>meters.map(({context,analyser,mute})=>{const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);let sum=0,square=0,peak=0;for(const v of values){sum+=v;square+=v*v;peak=Math.max(peak,Math.abs(v));}return{state:context.state,muted:mute.gain.value===0,finite:values.every(Number.isFinite),peak,rms:Math.sqrt(square/values.length),acRms:Math.sqrt(Math.max(0,square/values.length-(sum/values.length)**2))};});
  globalThis.__psfManualAudit={track,native,read,instrument:()=>read('getInstrument',[0]),manual:()=>manual.slice(),commands:()=>commands.slice(),levels,
    graph:()=>({contexts:contexts.length,editorWorklets:nodes.filter(item=>item.name==='tetorica-spu-synth').length,coreCount:cores.length,openCores:cores.filter(item=>!item.closed).map(item=>item.id),finite:cores.every(item=>item.finite),muted:meters.every(item=>item.mute.gain.value===0),destinations:meters.length,starts:starts.length,stops:stops.length})};
}

function instrumentCore(source){
  const anchor='export async function createPsfPlaybackCore(';assert.equal(source.split(anchor).length,2,'Core factory instrumentation anchor');
  return source.replace(anchor,'async function createAuditedPsfPlaybackCore(')+'\nexport async function createPsfPlaybackCore(options) { return globalThis.__psfManualAudit.track(await createAuditedPsfPlaybackCore(options)); }\n';
}
async function fixture(){
  const h=await import(pathToFileURL(path.join(repo,'test/helpers/spu_psf_playback_fixture.mjs')).href),p=await import(pathToFileURL(path.join(repo,'test/helpers/spu_psf_fixture.mjs')).href);
  const extra=[];for(const [ch,left,right,pitch]of[[1,0x1000,0x1800,0x900],[2,0,0,0],[3,0,0,0x1800],[4,0,0,0x800]])
    for(const[offset,value]of[[0,left],[2,right],[4,pitch],[6,0x2000/8],[8,15],[10,0x1fc0],[14,0x2000/8]])extra.push([ch*16+offset,value]);
  extra.push([0x190,16],[0x194,4],[0x188,31]);
  const base=h.createPsfSpuFeatureFixture({pitch:0x1000,reverb:true,noiseClock:37,steps:[{delay:4096,writes:extra}]});
  const words=Array.from({length:base.text.length/4},(_,i)=>new DataView(base.text.buffer).getUint32(i*4,true));
  // Replace only the terminal hold branch with an original periodic CPU driver.
  assert.equal(words.at(-4),0x1000ffff);words[words.length-4]=0x10000003;
  const code=[],emit=v=>code.push(v>>>0),ori=(r,s,v)=>emit(0x34000000|(s<<21)|(r<<16)|(v&65535));
  const outer=0;ori(11,0,384);const outerLoop=code.length;ori(10,0,65535);const inner=code.length;
  emit(0x254affff);emit(0x15400000|((inner-code.length-1)&65535));emit(0);
  emit(0x256bffff);emit(0x15600000|((outerLoop-code.length-1)&65535));emit(0);
  const write=(offset,value)=>{ori(9,0,value);emit(0xa5000000|(9<<16)|offset);};
  write(4,0x1000);write(0x188,1);emit(0x10000000|((outer-code.length-1)&65535));emit(0);
  words.push(...code);const text=new Uint8Array(words.length*4),view=new DataView(text.buffer);words.forEach((word,i)=>view.setUint32(i*4,word,true));
  const bytes=p.psfFromExe(h.playbackExe(text),'title=Tetorica original PSF manual fixture\nartist=Tetorica\nlength=30:00\nfade=0:00\n');
  // Calibrate actual CPU write frames, independent of browser scheduling.
  const {readPsfFileSet}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_ps1_psf.js')).href),{preparePsfSongSource}=await import(pathToFileURL(path.join(repo,'docs/synth-spu/psf_song_source.js')).href);
  const image=await preparePsfSongSource(await readPsfFileSet([p.psfFile('manual.psf',bytes)]),'manual.psf');
  const factory=(await import(pathToFileURL(path.join(repo,'docs/generated/psf-player/psf_player.js')).href)).default;
  const module=await factory({wasmBinary:await fs.readFile(path.join(repo,'docs/generated/psf-player/psf_player.wasm')),print(){},printErr(){}});
  const ram=module._malloc(0x200000),mask=module._malloc(0x200000),output=module._malloc(44100*8),event=module._malloc(16);let machine=0;
  try{module.HEAPU8.set(image.ram,ram);module.HEAPU8.set(image.coverage,mask);machine=module._psf_create(ram,mask,image.pc,image.gp,image.sp,60);assert(machine);assert(module._psf_trace_start(machine,10000));
    for(let seconds=0;seconds<10;seconds++){assert.equal(module._psf_render(machine,output,44100),44100);const gates=[];for(let i=0;i<module._psf_trace_count(machine);i++){assert(module._psf_trace_read(machine,i,event));const v=new DataView(module.HEAPU8.buffer,event,16);if(v.getUint32(4,true)===1&&v.getUint32(8,true)===0x188&&v.getUint32(12,true)===1&&v.getUint32(0,true)>1000)gates.push(v.getUint32(0,true));}if(gates.length>=3){const period=gates[2]-gates[1];assert(Math.abs(period-(gates[1]-gates[0]))<=1);assert(period>44100&&period<44100*4);return{bytes,adpcm:base.adpcm,first:gates[0],period,gateFrames:gates.slice(0,3)};}}
    throw Error('Original fixture periodic CPU gate calibration did not finish');
  }finally{if(machine)module._psf_destroy(machine);for(const pointer of[ram,mask,output,event])module._free(pointer);}
}

const native=page=>page.evaluate(()=>__psfManualAudit.native()),manual=page=>page.evaluate(()=>__psfManualAudit.manual()),graph=page=>page.evaluate(()=>__psfManualAudit.graph());
const view=page=>page.evaluate(()=>({position:Number(document.getElementById('psfSongPosition').dataset.seconds),pause:document.getElementById('psfPauseSong').textContent,
  target:document.getElementById('spuLiveChannel').value,panel:{...document.getElementById('spuVoicePanel').dataset},inert:document.getElementById('spuVoicePanel').inert,status:document.getElementById('spuLiveStatus').textContent,
  psfStatus:document.getElementById('psfPlaybackStatus').textContent,psfError:document.getElementById('psfPlaybackStatus').dataset.error,audioStatus:document.getElementById('audioStatus').textContent,codeState:document.getElementById('synthCodeState').textContent,codeError:document.getElementById('synthCodeError').textContent,playDisabled:document.getElementById('psfPlaySong').disabled}));
const authored=page=>page.evaluate(()=>__psfManualAudit.instrument());
const input=(page,name)=>page.locator(`[data-chip-control="${name}"]`);
async function setRange(page,name,value){const control=input(page,name);assert(await control.isEnabled(),name+' enabled');await control.evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},value);}
async function dragRange(page,name,value){const control=input(page,name);await control.scrollIntoViewIfNeeded();assert(await control.isEnabled());const bounds=await control.evaluate(node=>({min:Number(node.min),max:Number(node.max),value:Number(node.value)})),box=await control.boundingBox();assert(box);const x=v=>box.x+7+(box.width-14)*(v-bounds.min)/(bounds.max-bounds.min);await page.mouse.move(x(bounds.value),box.y+box.height/2);await page.mouse.down();await page.mouse.move(x(value),box.y+box.height/2,{steps:5});await page.mouse.up();}
async function setNumber(page,name,value){const control=input(page,name);assert(await control.isEnabled(),name+' enabled');await control.fill(String(value));await control.dispatchEvent('change');await page.evaluate(()=>document.activeElement?.blur());}
async function bend(page,value){const control=page.locator('#keyboardPitchBend');assert(await control.isEnabled());await control.evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function key(page,key,down){await page.locator('#synthInputKeyboardTab').click();await until(()=>page.locator('#synthInputSection').getAttribute('data-input-mode').then(v=>v==='keyboard'),'Keyboard ready');await page.evaluate(()=>document.activeElement?.blur());await page.keyboard[down?'down':'up'](key);await until(()=>page.locator(`#keyboardKeys .key[data-key="${key}"]`).evaluate((node,on)=>node.classList.contains('is-active')===on,down),'manual key '+key+' '+down);}
async function signal(page){let values;await until(async()=>{values=await page.evaluate(()=>__psfManualAudit.levels());return values.length&&values.every(v=>v.muted&&v.finite)&&values.some(v=>v.acRms>.00001);},'finite internally rendered PSF audio');return values;}
const stableVoice=voice=>({...voice,gate:undefined,active:undefined,envelope:undefined,ended:undefined,waveform:undefined,rawRegisters:voice.rawRegisters.filter((_,i)=>i!==6)});
const stableBus=s=>({main:s.main,reverb:s.reverb,noise:s.noise,pmon:s.pmon,control:s.observation.control,noiseMask:s.observation.noiseMask,pmonMask:s.observation.pmonMask,reverbMask:s.observation.reverbMask});
function assertSparse(event,channel,allowed){
  assert(event.before&&event.after&&!event.error);assert.equal(event.before.frame,event.after.frame,'manual write does not clock CPU/SPU');assert.equal(event.before.sampleRam,event.after.sampleRam,'manual controls never replace sample RAM');
  assert.deepEqual(stableBus(event.after.snapshot),stableBus(event.before.snapshot));
  for(let ch=0;ch<24;ch++)if(ch!==channel)assert.deepEqual(stableVoice(event.after.snapshot.channels[ch]),stableVoice(event.before.snapshot.channels[ch]),'other CH '+ch+' unchanged');
  const before=event.before.snapshot.channels[channel],after=event.after.snapshot.channels[channel];
  if(event.method==='edit')assert.equal(after.envelope,before.envelope,'scalar edit retains the current ENV without clocking or retriggering');
  for(let register=0;register<8;register++)if(register!==6&&!allowed.includes(register))assert.equal(after.rawRegisters[register],before.rawRegisters[register],'untouched selected register '+register);
}
async function seek(page,seconds){const before=(await native(page))?.id;await page.locator('#psfSongSeek').evaluate((node,seconds)=>{node.value=String(seconds);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},seconds);await until(async()=>{const value=await native(page);return value&&value.id!==before&&value.frame>=Math.round(seconds*44100)&&await page.locator('#psfSongPlayer').getAttribute('data-seeking')==='false';},'Seek committed a new machine at the native destination');}
async function load(page,bytes){await page.locator('#synthMenuButton').click();const waiting=page.waitForEvent('filechooser');await page.locator('#loadPsf').click();await(await waiting).setFiles(['manual.psf','other-manual.psf'].map(name=>({name,mimeType:'application/octet-stream',buffer:Buffer.from(bytes)})));await until(()=>page.locator('#psfPlaySong').isEnabled(),'PSF set loaded');}

async function check(browser,name,origin,fixture){
  const page=await browser.newPage({viewport:{width:1240,height:1000},serviceWorkers:'block'}),errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(25000);page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('console',message=>{if(message.type()==='error'&&!/Failed to load resource|cdnjs/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){expectedBlockedMonaco.push(url.href);return route.abort();}if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installAudit);const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await until(()=>page.locator('#spuFileImportButton').isEnabled(),'Files ready');await page.locator('#startAudio').click();await until(()=>page.locator('#startAudio').textContent().then(value=>value==='Audio ready'),'audio ready');
    const original=await authored(page);let authorBaseline=original;await load(page,fixture.bytes);await page.locator('[data-spu-editor-tab="pcm"]').click();await page.locator('#psfPlaySong').click();
    await until(async()=>{const v=await native(page),ui=await view(page);return v&&v.frame>2205&&Number(ui.panel.observationFrame)>=2205&&ui.panel.observationKind==='psf'&&!ui.inert;},'editable audible PSF observation');
    const first=await native(page),identity=first.id,c4=await page.locator('#keyboardKeys .key').filter({hasText:/\bC4\b/}).first().getAttribute('data-key'),e4=await page.locator('#keyboardKeys .key').filter({hasText:/\bE4\b/}).first().getAttribute('data-key');assert(c4&&e4);measurements.start=await signal(page);
    step('Playing PSF exposes selected-CH controls without replacing the authored bank, core or shared effects');
    assert.equal((await graph(page)).openCores.length,1);assert.deepEqual(await authored(page),original);assert.equal((await view(page)).target,'0');
    assert.equal(await page.locator('[data-chip-action^="ps1-wave-"]').count(),4);for(const control of await page.locator('[data-chip-action^="ps1-wave-"]').all())assert(await control.isDisabled(),'all four selected-CH waveform actions are disabled');
    for(const selector of ['[data-morph="enabled"]','[data-noise="source"]','[data-pmon="enabled"]','[data-chip-control="ps1-reverb-preset"]']){const control=page.locator(selector);if(await control.count()&&await control.isVisible())assert(await control.isDisabled()||await control.evaluate(node=>Boolean(node.closest('[inert]'))),'unsupported control disabled '+selector);}
    assert(await input(page,'ps1-waveform').evaluate(node=>node.inert),'selected source PCM remains a read-only preview');
    const before=await view(page),stops=(await graph(page)).stops;
    await dragRange(page,'ps1-volume-left',.25);await until(()=>native(page).then(v=>Math.abs(v.snapshot.channels[0].volumeLeft-.25)<.025),'pointer volume edit');
    await setRange(page,'ps1-volume-left',.31);await until(()=>native(page).then(v=>Math.abs(v.snapshot.channels[0].volumeLeft-.31)<.0002),'selected left volume');
    let edits=(await manual(page)).filter(event=>event.method==='edit');assert(edits.length);assertSparse(edits.at(-1),0,[0]);
    await page.locator('[data-spu-editor-tab="adsr"]').click();
    await setNumber(page,'ps1-attack-rate',3);await until(()=>native(page).then(v=>v.snapshot.channels[0].envelopeParameters.attackRate===3),'selected ADSR');edits=(await manual(page)).filter(event=>event.method==='edit');assertSparse(edits.at(-1),0,[4]);
    await setRange(page,'ps1-pitch',0x1100);edits=(await manual(page)).filter(event=>event.method==='edit');assertSparse(edits.at(-1),0,[2]);assert.equal(edits.at(-1).after.snapshot.channels[0].pitch,0x1100);assert.equal(edits.at(-1).after.snapshot.channels[0].gate,edits.at(-1).before.snapshot.channels[0].gate,'direct Pitch keeps the source Gate');await setRange(page,'ps1-pitch',0x1000);
    await page.locator('[data-spu-editor-tab="fx"]').click();for(const name of['ps1-reverb-preset','ps1-reverb-send','ps1-reverb-left','ps1-reverb-right'])assert(await input(page,name).isDisabled(),'shared effect editing stays explicit/read-only: '+name);await page.locator('[data-spu-editor-tab="adsr"]').click();
    assert.equal((await native(page)).id,identity);assert((await view(page)).position>=before.position);assert.equal((await graph(page)).stops,stops,'supported edits retain every already scheduled buffer');assert.deepEqual(await authored(page),original);

    step('Keyboard and Pitch write the same selected PSF voice, with later same-value CPU KON/PITCH winning old releases');
    await until(async()=>{const v=await native(page);const next=fixture.first+Math.max(0,Math.ceil((v.frame-fixture.first)/fixture.period))*fixture.period;return next-v.frame>50000&&next-v.frame<85000;},'CPU ownership window');
    const at=await native(page),next=fixture.first+Math.max(0,Math.ceil((at.frame-fixture.first)/fixture.period))*fixture.period;
    await key(page,e4,true);await until(()=>manual(page).then(events=>events.some(event=>event.method==='noteOn'&&event.core===identity)),'native manual On');
    const on=(await manual(page)).filter(event=>event.method==='noteOn').at(-1);assertSparse(on,0,[2]);assert(on.after.snapshot.channels[0].gate);
    assert.equal(on.after.snapshot.channels[0].pitch,Math.round(0x1000*2**(4/12)),'E4 has an unbent hand pitch distinct from the later CPU C4 pitch');
    await bend(page,1.5);await until(()=>native(page).then(v=>v.snapshot.channels[0].pitch>Math.round(0x1000*2**(4/12))),'manual Pitch bend reaches the held E4');
    await until(()=>native(page).then(v=>v.frame>=next+4096),'actual later CPU gate');assert.equal((await native(page)).snapshot.channels[0].pitch,0x1000);
    await key(page,e4,false);await bend(page,0);await wait(80);
    const afterSource=await native(page);assert.equal(afterSource.snapshot.channels[0].gate,true,'old key-up cannot stop a newer same-value CPU KON');assert.equal(afterSource.snapshot.channels[0].pitch,0x1000,'old Pitch reset cannot overwrite later source pitch');assert.equal(afterSource.id,identity);measurements.ownership={next,frame:afterSource.frame};

    step('CH changes and blur retire only manual owners while keeping the source machine and dependencies');
    await key(page,c4,true);await key(page,e4,true);await page.keyboard.up(c4);assert((await native(page)).snapshot.channels[0].gate,'an older hand key-up keeps the newer hand note on the same CH');await page.locator('#spuLiveChannel').selectOption('1');await page.keyboard.up(e4);await until(()=>view(page).then(v=>v.target==='1'),'CH2 selected');
    await key(page,c4,true);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up(c4);await until(()=>page.locator('#keyboardKeys .key.is-active').count().then(n=>n===0),'blur clears hand keys');assert.equal((await native(page)).id,identity);assert.deepEqual(await authored(page),original);measurements.manual=await signal(page);

    step('Synth view keeps authored edits and keyboard separate while the PSF machine continues playing');
    await page.locator('#spuLiveChannel').selectOption('synth');assert.equal((await view(page)).inert,false);await page.locator('[data-spu-editor-tab="pcm"]').click();for(const control of await page.locator('[data-chip-action^="ps1-wave-"]').all())assert(await control.isEnabled(),'authored Synth waveform actions are restored');await page.locator('[data-spu-editor-tab="adsr"]').click();const authorAttack=(original.preset.adsr1>>8)&127;
    await setNumber(page,'ps1-attack-rate',authorAttack===127?126:authorAttack+1);await until(()=>authored(page).then(value=>((value.preset.adsr1>>8)&127)!==authorAttack),'authored ADSR edit');
    assert.equal((await native(page)).id,identity);assert.equal((await native(page)).snapshot.channels[0].envelopeParameters.attackRate,3,'the original PSF CH retains its independent manual ADSR');
    await setNumber(page,'ps1-attack-rate',authorAttack);await until(()=>authored(page).then(value=>value.preset.adsr1===original.preset.adsr1),'authored ADSR restored');
    await key(page,c4,true);await key(page,c4,false);assert.equal((await native(page)).id,identity);authorBaseline=await authored(page);assert.deepEqual({...authorBaseline,preset:{...authorBaseline.preset,pitch:original.preset.pitch}},original,'authored keys retain instrument data while updating their actual last-note pitch');

    step('Pause retains exact frozen source state and independent audition, then Resume continues the same core');
    await page.locator('#spuLiveChannel').selectOption('0');await page.locator('#psfPauseSong').click();await until(()=>page.locator('#psfPauseSong').textContent().then(value=>value==='Resume'),'paused');
    const paused=await view(page),pausedNative=await native(page);await key(page,c4,true);await wait(100);assert.equal((await view(page)).position,paused.position);assert.deepEqual(await native(page),pausedNative,'paused independent audition never advances or edits the source');await key(page,c4,false);
    await page.locator('#psfPauseSong').click();await until(()=>page.locator('#psfPauseSong').textContent().then(value=>value==='Pause'),'resumed');assert.equal((await native(page)).id,identity);await until(()=>view(page).then(v=>v.position>paused.position),'resumed source position');

    step('Seek reconstructs the source and invalidates manual leases; later source selection retires that machine');
    await setRange(page,'ps1-volume-left',.22);await until(()=>native(page).then(v=>Math.abs(v.snapshot.channels[0].volumeLeft-.22)<.0002),'temporary pre-seek edit');
    await key(page,c4,true);await seek(page,.7);await page.keyboard.up(c4);const sought=await native(page);assert.notEqual(sought.id,identity);assert.equal(sought.snapshot.channels[0].rawRegisters[0],0x2000);assert.equal(sought.snapshot.channels[0].adsr1,15);assert(sought.snapshot.channels[0].gate);assert.deepEqual(await authored(page),authorBaseline);
    await page.locator('#psfEntry').selectOption('other-manual.psf');await until(()=>page.locator('#psfPlaySong').isEnabled(),'replacement source ready');assert.equal((await graph(page)).openCores.length,0);await page.locator('#psfPlaySong').click();await until(()=>native(page).then(v=>v&&v.frame>2205),'replacement source playing');assert((await native(page)).snapshot.channels[0].gate);

    step('Capture remains paused and explicit; starting Code stops PSF and starting PSF stops Code');
    await until(()=>view(page).then(value=>Number(value.panel.observationFrame)>=2205),'replacement source audible initialized snapshot');await page.locator('#psfPauseSong').click();await until(()=>page.locator('#psfPauseSong').textContent().then(value=>value==='Resume'),'Capture pause');const capturedAt=(await view(page)).position;await until(()=>page.locator('#spuPsfCapture').isEnabled(),'Capture available');await page.locator('#spuPsfCapture').click();await until(()=>page.locator('#audioStatus').textContent().then(value=>/^Captured CH/.test(value)),'Capture result');assert.equal((await view(page)).position,capturedAt);assert.equal((await view(page)).target,'synth');
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(`const ps1=await useSoundChip('ps1');\ncontext.starts=(context.starts??0)+1;\nliveLoop('proof',async()=>{await beat(.1);});\n`);await page.locator('#synthCodeRunButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Running|Playing/.test(value)),'Code playing');assert.equal((await graph(page)).openCores.length,0);await page.locator('#psfPlaySong').click();await until(async()=>{const ui=await view(page);if(ui.psfError==='true')throw Error(ui.psfStatus);return native(page).then(v=>v&&v.frame>2205);},'PSF supersedes Code');assert.match(await page.locator('#synthCodeState').textContent(),/Stopped|Idle/);

    step('Cold Code-to-PSF handoff loads its own WASM without weakening the running Code network guard');
    await page.locator('#psfStopSong').click();await page.reload();await until(()=>page.locator('#spuFileImportButton').isEnabled(),'cold Files ready');
    await load(page,fixture.bytes);assert.equal((await graph(page)).coreCount,0,'file selection does not initialize a PSF core');
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(`const ps1=await useSoundChip('ps1');\ntry { await fetch('/__psf_manual_code_guard__'); globalThis.__coldFetchGuard='allowed'; } catch(error) { globalThis.__coldFetchGuard=String(error.message); }\nliveLoop('cold-handoff',async()=>{await beat(.1);});\n`);await page.locator('#synthCodeRunButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Running|Playing/.test(value)),'cold Code playing');assert.equal((await graph(page)).coreCount,0);assert.match(await page.evaluate(()=>__coldFetchGuard),/fetch|network|disabled|not.*allow/i,'user Code fetch remains blocked');assert.notEqual(await page.evaluate(()=>__coldFetchGuard),'allowed');
    await page.locator('#psfPlaySong').click();await until(async()=>{const ui=await view(page);if(ui.psfError==='true')throw Error(ui.psfStatus);return native(page).then(value=>value&&value.frame>2205);},'cold PSF supersedes Code');assert.match(await page.locator('#synthCodeState').textContent(),/Stopped|Idle/);measurements.cold=await signal(page);

    step('Manual controls remain compact at desktop/phone widths and physical output stays muted');
    await page.locator('#synthInputKeyboardTab').click();await page.locator('[data-spu-editor-tab="pcm"]').click();await page.locator('#spuLiveChannel').selectOption('0');
    for(const width of[1240,390]){await page.setViewportSize({width,height:1000});await page.locator('#spuCodeLiveTools').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-${width}.png`)});}
    const final=await graph(page);assert(final.muted&&final.finite);assert.equal(final.contexts,1);assert.equal(final.editorWorklets,1);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);await page.locator('#psfStopSong').click();
    return{browser:name,passed:true,checks,measurements,graph:final,errors,consoleErrors};
  }catch(error){await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-failure.png`)}).catch(()=>{});error.receipt={browser:name,passed:false,stage,error:error.stack,checks,view:await view(page).catch(()=>null),native:await native(page).catch(()=>null),manual:(await manual(page).catch(()=>[])).slice(-15),graph:await graph(page).catch(()=>null),errors,consoleErrors};throw error;}
  finally{await page.close();}
}

const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}const file=path.resolve(config.root,'.'+decodeURIComponent(url.pathname));assert(file.startsWith(config.root+path.sep));const bytes=await fs.readFile(file),name=path.relative(config.root,file).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};if(served.has(name))assert.deepEqual(served.get(name),metadata,'Asset changed during check');served.set(name,metadata);const body=name.endsWith('/psf_playback_core.js')?instrumentCore(bytes.toString()):bytes;res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(body);}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{const authored=await fixture();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin,authored));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);}
  catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const report={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,selfAuthoredFixture:{firstCpuGateFrame:authored.first,periodFrames:authored.period,gateFrames:authored.gateFrames},testOnlyFactoryAudit:true,checkerSha256:hash(await fs.readFile(__filename)),results,missing,external,httpErrors,expectedBlockedMonaco,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
