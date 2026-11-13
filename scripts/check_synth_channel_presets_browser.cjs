// Non-destructive physical-channel preset capture and PCM preset loading.
// Only self-authored test programs are used. Every destination is intercepted
// before application JavaScript at gain zero; Chromium also uses --mute-audio.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{tmpdir}=require('node:os'),{pathToFileURL}=require('node:url'),{chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'synth-channel-presets-browser.json'),screenshots:path.join(tmpdir(),'synth-channel-presets-browser')};
for(const arg of process.argv.slice(2)){const m=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(m,'Unknown argument '+arg);config[m[1]]=m[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=b=>createHash('sha256').update(b).digest('hex');
const served=new Map(),missing=[],external=[],httpErrors=[],expectedCdn=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'};
async function until(predicate,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await wait(30);}throw Error('Timeout: '+label);}
const ready=page=>until(()=>page.locator('.synth-editor').getAttribute('aria-busy').then(v=>v==='false'),'Synth ready');

function installAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,Channel=window.MessageChannel;
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const contexts=[],nodes=[],meters=[],commands=[],ports=new WeakMap(),peers=new WeakMap();
  const fm=()=>({registers:[Array(256).fill(0),Array(256).fill(0)],gates:Array(6).fill(0)});
  const psg=()=>({periods:[0,0,0],levels:[15,15,15,15],latch:0,noise:0});
  const pcm=()=>({selected:0,bank:0,enabled:false,mask:255,control:0,channels:Array.from({length:8},()=>Array(7).fill(0)),ram:new Uint8Array(65536),loads:0});
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.MessageChannel=class extends Channel{constructor(){super();peers.set(this.port1,this.port2);peers.set(this.port2,this.port1);}};
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);const item={id:nodes.length,name,node:this,context,fm:fm(),psg:psg(),pcm:pcm(),closed:false};nodes.push(item);ports.set(this.port,item);}};
  function decode(item,message){
    if(!item)return;
    if(message?.method==='dispose'){item.closed=true;return;}
    if(item.name==='ym2612-processor'){
      if(message.type==='reset')item.fm=fm();
      if(message.type==='write'){
        const port=message.port??0,register=message.register,value=message.value;item.fm.registers[port][register]=value;
        if(port===0&&register===0x28){const encoded=value&7;if(encoded!==3&&encoded!==7)item.fm.gates[encoded>=4?encoded-1:encoded]=value>>4;}
      }
    }
    if(item.name==='tetorica-segapsg'){
      if(message.method==='reset')item.psg=psg();
      if(message.method==='write'){
        const value=message.args[0],s=item.psg;if(value&128)s.latch=value>>4&7;const ch=s.latch>>1;
        if(s.latch&1)s.levels[ch]=value&15;else if(ch===3)s.noise=value&7;else s.periods[ch]=value&128?(s.periods[ch]&0x3f0)|(value&15):(s.periods[ch]&15)|((value&63)<<4);
      }
    }
    if(item.name==='tetorica-synth-pcm'){
      const s=item.pcm,a=message.args??[];
      if(message.method==='reset'){const keep=s.ram;item.pcm=pcm();item.pcm.ram=keep;}
      if(message.method==='writeRegister'){
        const[r,v]=a;if(r<7)s.channels[s.selected][r]=v;else if(r===7){s.enabled=Boolean(v&128);s.control=v;if(v&64)s.selected=v&7;else s.bank=(v&15)<<12;}else if(r===8)s.mask=v;
      }
      if(message.method==='keyOn')s.mask&=~(1<<a[0]);
      if(message.method==='keyOff'||message.method==='releaseNote')s.mask|=1<<a[0];
      if(message.method==='loadMemory'){s.ram.set(a[0],a[1]??0);s.loads++;}
    }
  }
  MessagePort.prototype.postMessage=function(message,...args){
    const item=ports.get(this);
    if(item&&typeof message?.port?.postMessage==='function'){ports.set(message.port,item);const peer=peers.get(message.port);if(peer)ports.set(peer,item);}
    for(const m of Array.isArray(message)?message:[message])if(m&&typeof m==='object'){
      decode(item,m);
      if(m.type==='write'||m.method||m.op==='live-fx')commands.push({node:item?.id??null,name:item?.name??null,type:m.type,port:m.port,register:m.register,value:m.value,
        method:m.method,args:m.method==='loadMemory'?[m.args[0].length,m.args[1]]:m.args,op:m.op,action:m.action});
    }
    if(commands.length>40000)commands.splice(0,commands.length-40000);return post.call(this,message,...args);
  };
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=8192;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({context:this.context,analyser,mute});return destination;
  };
  const digest=bytes=>{let n=2166136261;for(const v of bytes)n=Math.imul(n^v,16777619)>>>0;return n.toString(16);};
  const snapshot=item=>{if(!item)return null;const s=item.pcm;return {id:item.id,name:item.name,closed:item.closed,fm:structuredClone(item.fm),psg:structuredClone(item.psg),
    pcm:{selected:s.selected,bank:s.bank,enabled:s.enabled,mask:s.mask,control:s.control,loads:s.loads,ramHash:digest(s.ram),channels:s.channels.map((r,ch)=>({channel:ch,volume:r[0],panLeft:r[1]&15,panRight:r[1]>>4,step:r[2]|r[3]<<8,loopStart:r[4]|r[5]<<8,start:r[6]<<8,keyOn:!(s.mask&(1<<ch))}))}};};
  window.__channelAudit={drain:()=>commands.splice(0),state:name=>snapshot(nodes.find(item=>item.name===name&&!item.closed&&item.context.state!=='closed')),
    graph:()=>({contexts:contexts.length,worklets:nodes.map(item=>item.name),destinations:meters.length,muted:meters.every(item=>item.mute.gain.value===0)}),
    pcm:()=>meters.map(({context,analyser,mute})=>{const a=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(a);let sum=0,square=0,peak=0;for(const v of a){sum+=v;square+=v*v;peak=Math.max(peak,Math.abs(v));}return{state:context.state,muted:mute.gain.value===0,finite:a.every(Number.isFinite),peak,acRms:Math.sqrt(Math.max(0,square/a.length-(sum/a.length)**2))};})};
}
const audit=(page,name)=>page.evaluate(name=>__channelAudit.state(name),name);
const drain=page=>page.evaluate(()=>__channelAudit.drain());
const view=page=>page.evaluate(()=>({source:document.getElementById('synthChannelSource').textContent,target:document.getElementById('synthSongChannelSelect').value,
  chip:document.querySelector('[data-synth-chip][aria-selected="true"]')?.dataset.synthChip,song:document.getElementById('synthSongPlayer').dataset.state,
  frame:Number(document.getElementById('synthSongPlayer').dataset.consumedFrames),status:document.getElementById('synthSongLiveStatus').textContent,
  code:document.getElementById('synthCodeState').textContent,input:document.getElementById('synthInputSection').dataset.inputMode}));
const common=(page,label)=>page.locator(`#commonControls .param-value[aria-label="${label}"]`);
const op=(page,n,label)=>page.locator(`#operatorControls .param-value[aria-label="${label}"]`).nth(n-1);
async function change(node,direction,count=1){await node.scrollIntoViewIfNeeded();await node.locator('..').locator('.param-button').nth(direction>0?1:0).evaluate((button,count)=>{for(let i=0;i<count;i++)button.click();},count);}
async function chip(page,id){await page.locator('#'+{ym2612:'synthChipTabYm2612',psg:'synthChipTabPsg',pcm:'synthChipTabPcm'}[id]).click();await ready(page);}
async function target(page,value){await page.locator(`[data-synth-channel-target="${value}"]`).click();await until(()=>view(page).then(s=>s.target===String(value)),'target '+value);}
async function keyboard(page){await page.locator('#synthInputKeyboardTab').click();await until(()=>view(page).then(s=>s.input==='keyboard'),'Keyboard view');await page.evaluate(()=>document.activeElement?.blur());}
async function key(page,key='a',down=true){await page.keyboard[down?'down':'up'](key);await until(()=>page.locator(`#keyboard .key[data-key="${key}"]`).evaluate((n,on)=>n.classList.contains('is-active')===on,down),'key '+key+' '+down);}
async function signal(page,wanted=true){let result;await until(async()=>{result=await page.evaluate(()=>__channelAudit.pcm());return result.length&&result.every(x=>x.finite&&x.muted)&&(wanted?result.some(x=>x.acRms>.0001):result.every(x=>x.acRms<1e-7));},wanted?'finite nonzero muted PCM':'silence');return result;}
async function source(page,text){await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(text);}
async function run(page){await page.locator('#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());},'Code Run');}
async function stopCode(page){await page.locator('#synthCodeStopButton').click();await until(()=>view(page).then(s=>/Stopped/i.test(s.code)),'Code Stop');}
function vgm(){
  const c=[],fm=(r,v,p=0)=>c.push(p?0x53:0x52,r,v),rf=(r,v)=>c.push(0xb1,r,v),u32=n=>[n&255,n>>8&255,n>>16&255,n>>>24&255];
  for(let ch=0;ch<6;ch++){const p=ch>2?1:0,n=ch%3;fm(0xb0+n,ch,p);fm(0xb4+n,0xc0,p);for(const slot of[0,8,4,12])for(const[r,v]of[[0x30,1],[0x40,slot===12?42:127],[0x50,31],[0x60,0],[0x80,15]])fm(r+slot+n,v,p);fm(0xa4+n,0x22,p);fm(0xa0+n,0x40,p);fm(0x28,0x80|(ch%3)|(ch>2?4:0));}
  for(const v of[0x85,0x12,0x95,0xa6,0x15,0xb7,0xc7,0x18,0xd9,0xe5,0xfa])c.push(0x50,v);
  const sample=Buffer.from(Array.from({length:161},(_,i)=>i>=128?255:(Math.round(Math.abs(Math.sin(i*Math.PI*2/32))*30)|(Math.sin(i*Math.PI*2/32)>=0?128:0))));
  rf(7,0x80);c.push(0x67,0x66,0xc1,...u32(sample.length+2),0,0,...sample);
  for(let ch=0;ch<8;ch++){rf(7,0xc0|ch);for(const[r,v]of[[0,50+ch],[1,0xff],[2,ch],[3,8],[4,0],[5,0],[6,0]])rf(r,v);}rf(8,0xfe);
  let n=24*44100;while(n){const take=Math.min(n,65535);c.push(0x61,take&255,take>>8);n-=take;}c.push(0x66);
  const bytes=Buffer.alloc(256+c.length),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);bytes.write('Vgm ');v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x171,true);v.setUint32(0x34,204,true);v.setUint32(0x18,24*44100,true);v.setUint32(0x2c,7670454,true);v.setUint32(0xc,3579545,true);v.setUint32(0x6c,12500000,true);bytes.set(c,256);return bytes;
}


let createSynthProject;
const CODE=`const fm=await useSoundChip('ym2612'),psg=await useSoundChip('segapsg'),pcm=await useSoundChip('rf5c164');
context.boots=(context.boots??0)+1;
const prepared=await livePrepare('channel-preset-proof',()=>({ticks:0}));
globalThis.__presetProbe={fm,psg,pcm,context,prepared};
for(let ch=0;ch<6;ch++){fm.setAlgo(ch,ch%8,(ch+2)%8);fm.setPan(ch,true,true);}
fm.noteOn(CH2,'A3');
fm.setChannel3SpecialMode(true);
for(let op=0;op<4;op++)fm.setChannel3SpecialFrequency(op,3,700+op*100);
fm.keyOn(CH3,[OP1,OP3]);
psg.tone(CH1,{period:140,attenuation:5});psg.tone(CH2,{period:251,attenuation:7});psg.tone(CH3,{period:351,attenuation:9});
psg.noise({type:'periodic',rate:'tone3',attenuation:10});
pcm.noteOn(CH1,'C4');
const memory=Uint8Array.from({length:161},(_,i)=>i>=128?255:(Math.round(Math.abs(Math.sin(i*Math.PI*2/32))*44)|(Math.sin(i*Math.PI*2/32)>=0?128:0)));
await pcm.loadMemory(memory,8192);
pcm.setChannel(7,{start:8192,loopStart:8208,step:4321,volume:89,pan:{left:6,right:10}});pcm.keyOn(7);
liveFx('channel-preset-level',{context:{gain:.35},process(input,output,state,context){for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*context.gain;}});
liveLoop('channel-preset-proof',async()=>{prepared.ticks++;await sleep(.05);});
`;
const customSample=()=>Buffer.from(Array.from({length:128},(_,i)=>(Math.round(Math.abs(Math.sin(i*Math.PI*2/32))*44)|(Math.sin(i*Math.PI*2/32)>=0?128:0))));
async function paths(page){return page.locator('#synthFilesTree button.file-entry').evaluateAll(nodes=>nodes.map(n=>n.dataset.filePath).filter(p=>/^\/presets\/.+\.(?:vgi|tfi|psg\.json|pcm\.json)$/i.test(p)).sort());}
async function editorIdentity(page){return page.evaluate(()=>({target:document.getElementById('synthSongChannelSelect').value,
  chip:document.querySelector('[data-synth-chip][aria-selected="true"]')?.dataset.synthChip,
  active:document.getElementById('synthActiveFilePath').textContent,
  selected:[...document.querySelectorAll('#synthFilesTree [aria-current="true"][data-file-path]')].map(n=>n.dataset.filePath),
  presets:['presetSelect','synthPsgPresetSelect','synthPcmPresetSelect'].map(id=>document.getElementById(id).value),
  input:document.getElementById('synthInputSection').dataset.inputMode,
  live:document.getElementById('synthSongLiveToggle').checked}));}
async function allAudio(page){return page.evaluate(()=>({fm:__channelAudit.state('ym2612-processor'),psg:__channelAudit.state('tetorica-segapsg'),pcm:__channelAudit.state('tetorica-synth-pcm'),graph:__channelAudit.graph()}));}
async function running(page){
  assert.match((await view(page)).code,/Running|Playing/);assert.equal(await page.locator('#synthCodeError').textContent(),'');
  assert(await page.evaluate(()=>__presetProbe===__presetIdentity&&__presetProbe.context.boots===1));
}
// Export is a readback probe. A DOM click avoids moving focus or releasing a
// manually held key just to inspect the saved bytes after the actual UI action.
async function download(page,selector){const waiting=page.waitForEvent('download');await page.locator(selector).evaluate(n=>n.click());const file=await waiting,chunks=[];for await(const chunk of await file.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);}
async function cassette(page){const project=createSynthProject();await project.importCassette(await download(page,'#exportCassetteButton'));return project;}
async function exportedPcm(page){return JSON.parse((await download(page,'#exportPcmButton')).toString());}
async function choose(page,file){
  if(!await page.locator('#synthFilesPanel').isVisible())await page.locator('#synthFilesToggle').click();
  for(let i=0;i<20;i++){const closed=page.locator('#synthFilesTree details:not([open]) > summary[data-file-path]');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#synthFilesTree button.file-entry').locator(`xpath=self::*[@data-file-path=${JSON.stringify(file)}]`).click();await ready(page);
  await until(()=>page.evaluate(file=>document.getElementById('synthActiveFilePath').textContent===file||document.getElementById('synthFileSelectionInfo').textContent===file,file),'Files selects '+file);
}
const mutates=command=>command.type==='write'||command.type==='reset'||command.op==='live-fx'||
  ['dispose','reset','write','writeRegister','keyOn','keyOff','releaseNote','loadMemory'].includes(command.method);
async function pcmSettingsReachAudio(page,preset){
  const active=(await audit(page,'tetorica-synth-pcm')).pcm.channels.filter(ch=>ch.keyOn);
  const settings=preset.settings;
  assert(active.some(ch=>ch.volume===settings.volume&&ch.panLeft===settings.panLeft&&ch.panRight===settings.panRight&&ch.loopStart===(settings.loopEnabled?settings.loopStart:settings.loopEnd+1)),
    'An audible hardware channel uses the selected preset volume, stereo pan and loop');
}
async function save(page,{code=false,held=false}={}){
  const before=await paths(page),identity=await editorIdentity(page),audio=await allAudio(page),tick=code?await page.evaluate(()=>__presetProbe.prepared.ticks):null;
  await until(()=>page.locator('#synthSongCopyButton').isEnabled(),'Physical channel capture ready: '+await page.locator('#synthSongCopyButton').getAttribute('title'));await drain(page);
  await page.locator('#synthSongCopyButton').click();
  await until(()=>paths(page).then(p=>p.length===before.length+1),'one new Files preset');await ready(page);
  await until(()=>page.locator('#synthSongCopyButton').isEnabled(),'Copy finished');
  const after=await paths(page),added=after.filter(p=>!before.includes(p));assert.equal(added.length,1);
  assert.deepEqual(await editorIdentity(page),identity,'Save does not select, apply, change Auto/CH, Live or the input tab');
  assert.deepEqual(await allAudio(page),audio,'Save leaves written registers, gates, sample RAM and the audio/FX graph untouched');
  const commands=await drain(page);assert.deepEqual(commands.filter(mutates),[],'Save does not emit audio, key, reset or FX mutation commands');
  if(held)assert(await page.locator('#keyboard .key[data-key="a"]').evaluate(n=>n.classList.contains('is-active')),'held manual key survives Copy');
  if(code){await running(page);await until(()=>page.evaluate(t=>__presetProbe.prepared.ticks>t,tick),'Code loop keeps ticking through Copy');}
  const project=await cassette(page),tone=project.readTone(added[0]);
  assert.deepEqual((await paths(page)).filter(p=>!before.includes(p)),added,'Export does not create another instrument');
  return{path:added[0],preset:tone.preset,format:tone.format};
}
async function check(browser,name,origin){
  const page=await browser.newPage({viewport:{width:1240,height:1050},serviceWorkers:'block',acceptDownloads:true}),errors=[],consoleErrors=[],checks=[],saved=[],measurements={};let stage='startup';
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.stack??e.message));page.on('console',m=>{if(m.type()==='error'&&!/cdnjs|Failed to load resource/.test(m.text()+' '+m.location().url))consoleErrors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)httpErrors.push({url:r.url(),status:r.status()});});
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='cdnjs.cloudflare.com'){expectedCdn.push(u.href);return route.abort();}if(u.origin!==origin&&!['blob:','data:'].includes(u.protocol)){external.push(u.href);return route.abort();}return route.continue();});
  await page.addInitScript(installAudit);const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await ready(page);
    step('Normal physical FM Copy saves uniquely named Files presets without applying them or releasing a held manual key');
    assert(await page.locator('#synthSongCopyButton').isDisabled(),'Auto has no physical-channel capture');
    await keyboard(page);await page.keyboard.press('a');await until(()=>page.locator('#status').textContent().then(v=>/Audio ready/.test(v)),'audio ready');await page.keyboard.up('a');
    await target(page,1);await change(common(page,'ALGO'),1);const normalAlgo=Number(await common(page,'ALGO').textContent());
    await key(page);measurements.normalHeld=await signal(page);const normal=await save(page,{held:true});saved.push(normal.path);assert.equal(normal.format,'vgi');assert.equal(normal.preset.algorithm,normalAlgo);await key(page,'a',false);
    const duplicate=await save(page);saved.push(duplicate.path);assert.notEqual(duplicate.path,normal.path);assert.deepEqual(duplicate.preset,normal.preset);

    step('Normal PSG and PCM physical channels save new presets while the authored Auto instrument and current channel remain untouched');
    await chip(page,'psg');await target(page,'psg:1');await keyboard(page);await key(page);const normalPsg=await save(page,{held:true});saved.push(normalPsg.path);assert.equal(normalPsg.format,'psg');assert.equal(normalPsg.preset.settings.source,'tone');await key(page,'a',false);
    await chip(page,'pcm');await target(page,'pcm:5');await keyboard(page);await key(page);const normalPcm=await save(page,{held:true});saved.push(normalPcm.path);assert.equal(normalPcm.format,'pcm');assert(normalPcm.preset.settings.volume>0);assert(Buffer.from(normalPcm.preset.sample.data,'base64').length>0);await key(page,'a',false);
    await chip(page,'ym2612');

    step('Code Live Off copies the visible frozen FM sound plus manual fields; Live On copies the latest written sound without stopping loops or FX');
    await source(page,CODE);await run(page);await until(()=>page.evaluate(()=>__presetProbe.prepared.ticks>=2),'Code loop starts');await page.evaluate(()=>{window.__presetIdentity=__presetProbe;});
    await target(page,1);await until(()=>common(page,'ALGO').textContent().then(v=>v==='1'),'Code CH2 algorithm');await page.locator('#synthSongLiveToggle').uncheck();
    await page.evaluate(()=>__presetProbe.fm.setAlgo(1,6,5));await until(()=>audit(page,'ym2612-processor').then(s=>(s.fm.registers[0][0xb1]&7)===6),'Code changed behind frozen view');
    assert.equal(await common(page,'ALGO').textContent(),'1');await change(common(page,'FB'),1);await until(()=>common(page,'FB').textContent().then(v=>v==='4'),'manual frozen feedback visible');
    const frozen=await save(page,{code:true});saved.push(frozen.path);assert.equal(frozen.preset.algorithm,1);assert.equal(frozen.preset.feedback,4);
    await page.locator('#synthSongLiveToggle').check();await until(()=>common(page,'ALGO').textContent().then(v=>v==='6'),'Live catches up');
    const fresh=await save(page,{code:true});saved.push(fresh.path);assert.equal(fresh.preset.algorithm,6);assert.equal(fresh.preset.feedback,4);

    step('FM CH3 partial operators and four special-mode frequencies survive VGI plus Synth-sidecar serialization');
    await target(page,2);const special=await save(page,{code:true});saved.push(special.path);
    assert.equal(special.format,'vgi');assert.deepEqual(special.preset.capturedVoice,{keyMask:5,specialMode:true,specialFrequencies:Array.from({length:4},(_,i)=>({block:3,fnum:700+i*100}))});

    step('PSG Tone and Noise save detached standard PSG presets with the hardware identity and software envelope disabled');
    await chip(page,'psg');await target(page,'psg:1');await until(()=>page.locator('#synthPsgAttenuation').textContent().then(v=>v==='7'),'Tone2 view');
    const tone=await save(page,{code:true});saved.push(tone.path);assert.equal(tone.format,'psg');assert.equal(tone.preset.kind,'tetorica-sega-psg');assert.equal(tone.preset.settings.source,'tone');assert.equal(tone.preset.settings.attenuation,7);assert.equal(tone.preset.settings.envelope.enabled,false);
    await target(page,'psg:3');const noise=await save(page,{code:true});saved.push(noise.path);assert.equal(noise.preset.settings.source,'noise');assert.equal(noise.preset.settings.noiseType,'periodic');assert.equal(noise.preset.settings.noiseRate,'tone3');assert.equal(noise.preset.settings.attenuation,10);assert.equal(noise.preset.settings.envelope.enabled,false);

    step('PCM custom Code RAM, recorded speed and nonzero loop offset are detached into a standalone preset without rewriting the running source');
    await chip(page,'pcm');await target(page,'pcm:7');await until(()=>page.locator('#synthPcmStep').textContent().then(v=>v==='4321'),'custom PCM view');
    const pcm=await save(page,{code:true});saved.push(pcm.path);assert.equal(pcm.format,'pcm');assert.equal(pcm.preset.kind,'tetorica-rf5c164');
    assert.deepEqual(Buffer.from(pcm.preset.sample.data,'base64'),customSample());
    assert.deepEqual(pcm.preset.settings,{volume:89,panLeft:6,panRight:10,rootNote:60,loopEnabled:true,loopStart:16,loopEnd:128});
    assert(Math.abs(pcm.preset.sample.sampleRate-12500000/384*4321/2048)<1e-7);
    await page.evaluate(()=>__presetProbe.pcm.loadMemory(Uint8Array.of(128),8192));const detached=(await cassette(page)).readTone(pcm.path).preset;
    assert.deepEqual(detached,pcm.preset,'Later source RAM writes cannot modify the saved sample');await running(page);

    step('Choosing a Files PCM preset from a Code physical CH explicitly returns to Auto and applies its sample/settings while retaining Code and FX');
    await page.evaluate(()=>{for(let ch=0;ch<6;ch++){__presetProbe.fm.noteOff(ch);for(let op=0;op<4;op++)__presetProbe.fm.setOperator(ch,op,{tl:127});}for(let ch=0;ch<4;ch++)__presetProbe.psg.setAttenuation(ch,15);for(let ch=0;ch<8;ch++)__presetProbe.pcm.keyOff(ch);});
    await signal(page,false);
    await choose(page,pcm.path);await until(()=>view(page).then(s=>s.target==='synth'&&s.chip==='pcm'),'Files PCM returns to Auto');await running(page);
    assert.deepEqual(await exportedPcm(page),pcm.preset);await until(()=>page.locator('#synthPcmVolume').textContent().then(v=>v==='89'),'Files PCM volume applied');
    await keyboard(page);await key(page);measurements.codeFilesPcm=await signal(page);await pcmSettingsReachAudio(page,pcm.preset);await key(page,'a',false);await running(page);

    step('Reselecting the same PCM Files preset reinstalls its sample after Code overwrites RAM without losing execution state');
    const installedRam=(await audit(page,'tetorica-synth-pcm')).pcm.ramHash;
    await page.evaluate(()=>__presetProbe.pcm.loadMemory(Uint8Array.of(129,130,131),0));assert.notEqual((await audit(page,'tetorica-synth-pcm')).pcm.ramHash,installedRam);
    await target(page,'pcm:7');await page.locator('#synthPcmPresetSelect').selectOption('vfs:'+pcm.path);await ready(page);
    await until(()=>view(page).then(s=>s.target==='synth'),'same PCM preset returns Auto');await until(()=>audit(page,'tetorica-synth-pcm').then(s=>s.pcm.ramHash===installedRam),'same PCM preset restores sample RAM');await running(page);
    await page.evaluate(()=>__presetProbe.pcm.loadMemory(Uint8Array.of(129,130,131),0));assert.notEqual((await audit(page,'tetorica-synth-pcm')).pcm.ramHash,installedRam);
    await choose(page,pcm.path);await until(()=>audit(page,'tetorica-synth-pcm').then(s=>s.pcm.ramHash===installedRam),'same Files item in Code Auto restores its sample RAM');await running(page);

    step('The PCM built-in dropdown applies from a Code physical CH; Auto shape editing preserves the active execution');
    await target(page,'pcm:7');await page.locator('#synthPcmPresetSelect').selectOption('pcm-sine');await ready(page);await until(()=>view(page).then(s=>s.target==='synth'),'PCM built-in dropdown returns Auto');await running(page);
    const builtin=await exportedPcm(page);assert.equal(builtin.settings.volume,64);assert.equal(Buffer.from(builtin.sample.data,'base64').length,256);assert.notEqual(builtin.sample.data,pcm.preset.sample.data);
    await page.locator('[data-pcm-builtin="triangle"]').click();await ready(page);assert.equal((await view(page)).target,'synth');await running(page);const triangle=await exportedPcm(page);assert.notEqual(triangle.sample.data,builtin.sample.data);

    step('PCM Files and built-in presets also replace a Normal physical-channel view, update visible settings and produce finite nonzero internal audio');
    await stopCode(page);await target(page,'pcm:7');await choose(page,pcm.path);await until(()=>view(page).then(s=>s.target==='synth'),'Normal Files PCM returns Auto');assert.deepEqual(await exportedPcm(page),pcm.preset);
    await keyboard(page);await key(page);measurements.normalFilesPcm=await signal(page);await pcmSettingsReachAudio(page,pcm.preset);await key(page,'a',false);
    await target(page,'pcm:7');await page.locator('#synthPcmPresetSelect').selectOption('pcm-sine');await ready(page);await until(()=>view(page).then(s=>s.target==='synth'),'Normal PCM dropdown returns Auto');assert.deepEqual(await exportedPcm(page),builtin);
    await keyboard(page);await key(page);measurements.normalBuiltinPcm=await signal(page);await pcmSettingsReachAudio(page,builtin);await key(page,'a',false);

    step('Paused VGM Copy keeps the existing load-to-Auto behavior while the reference remains paused at the same frame');
    await page.locator('#tfiFile').setInputFiles({name:'Preset reference.vgm',mimeType:'application/octet-stream',buffer:vgm()});await ready(page);await chip(page,'ym2612');await target(page,2);
    await page.locator('#synthSongPlayButton').click();await until(()=>view(page).then(s=>s.song==='playing'&&s.frame>0),'VGM starts');await page.locator('#synthSongPlayButton').click();await until(()=>view(page).then(s=>s.song==='paused'),'VGM paused');
    const frame=(await view(page)).frame,before=await paths(page);await page.locator('#synthSongCopyButton').click();await until(()=>view(page).then(s=>s.target==='synth'),'paused VGM Copy loads Auto');await ready(page);
    assert.equal((await view(page)).song,'paused');assert.equal((await view(page)).frame,frame);assert.equal((await paths(page)).length,before.length+1);assert.equal(await common(page,'ALGO').textContent(),'2');
    await page.locator('#synthSongStopButton').click();

    step('Preset controls remain compact at desktop and phone widths and every physical speaker path stays muted');
    for(const width of[1240,390]){await page.setViewportSize({width,height:1000});await chip(page,'pcm');await target(page,'pcm:7');await page.locator('#synthChannelControls').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-${width}.png`)});}
    assert.equal(await page.locator('#synthCodeError').textContent(),'');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert((await page.evaluate(()=>__channelAudit.graph())).muted);
    return{browser:name,passed:true,checks,saved,measurements,graph:await page.evaluate(()=>__channelAudit.graph()),errors,consoleErrors};
  }catch(error){await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-failure.png`)}).catch(()=>{});error.receipt={browser:name,passed:false,stage,checks,error:error.stack,view:await view(page).catch(()=>null),audit:await page.evaluate(()=>({graph:__channelAudit.graph(),fm:__channelAudit.state('ym2612-processor'),psg:__channelAudit.state('tetorica-segapsg'),pcm:__channelAudit.state('tetorica-synth-pcm'),commands:__channelAudit.drain().slice(-80)})).catch(()=>null),errors,consoleErrors};throw error;
  }finally{await page.close();}
}

const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const file=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(file.startsWith(config.root+path.sep));const bytes=await fs.readFile(file),name=path.relative(config.root,file).split(path.sep).join('/'),meta={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(name))assert.deepEqual(served.get(name),meta,'Asset changed during browser check');served.set(name,meta);res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{({createSynthProject}=await import(pathToFileURL(path.join(repo,'docs/synth/synth_project.js')).href));await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,checkerSha256:hash(await fs.readFile(__filename)),results,missing,external,httpErrors,expectedBlockedMonaco:expectedCdn,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack}:{} )};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
