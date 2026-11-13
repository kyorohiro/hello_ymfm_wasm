// Persistent Auto / physical-channel tabs for the FM2612 Synth.
// Only self-authored test programs are used. Every destination is intercepted
// before application JavaScript at gain zero; Chromium also uses --mute-audio.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{tmpdir}=require('node:os'),{chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'synth-channel-view-browser.json'),screenshots:path.join(tmpdir(),'synth-channel-view-browser')};
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
const CODE=`const fm=await useSoundChip('ym2612'),psg=await useSoundChip('segapsg'),pcm=await useSoundChip('rf5c164');
context.boots=(context.boots??0)+1;
const prepared=await livePrepare('channel-tabs-proof',()=>({ticks:0}));
globalThis.__channelProbe={fm,psg,pcm,context,prepared,pending:null};
for(let ch=0;ch<6;ch++){fm.setAlgo(ch,ch%8,(ch+2)%8);fm.setPan(ch,true,true);fm.setOperator(ch,0,{dt:6,multi:4,rs:2,ar:23});}
fm.noteOn(CH2,'A3');
psg.tone(CH1,{period:140,attenuation:5});psg.tone(CH2,{period:251,attenuation:7});psg.tone(CH3,{period:351,attenuation:9});
psg.noise({type:'periodic',rate:'tone3',attenuation:10});
pcm.noteOn(CH1,'C4');
const memory=Uint8Array.from({length:129},(_,i)=>i===128?255:(Math.round(Math.abs(Math.sin(i*Math.PI*2/32))*44)|(Math.sin(i*Math.PI*2/32)>=0?128:0)));
await pcm.loadMemory(memory,8192);
pcm.setChannel(7,{start:8192,loopStart:8192,step:4321,volume:89,pan:{left:6,right:10}});pcm.keyOn(7);
liveFx('channel-proof-level',{context:{gain:.35},process(input,output,state,context){for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*context.gain;}});
liveLoop('channel-proof',async()=>{prepared.ticks++;const p=__channelProbe.pending;if(p){__channelProbe.pending=null;if(p.kind==='fm')fm.setAlgo(CH2,p.algorithm,p.feedback);if(p.kind==='pcm')pcm.setChannel(7,p.settings);if(p.kind==='psg')psg.setNoise(p.settings);}await sleep(.05);});
`;
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

async function check(browser,name,origin){
  const page=await browser.newPage({viewport:{width:1240,height:1050},serviceWorkers:'block',acceptDownloads:true}),errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.stack??e.message));page.on('console',m=>{if(m.type()==='error'&&!/cdnjs|Failed to load resource/.test(m.text()+' '+m.location().url))consoleErrors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)httpErrors.push({url:r.url(),status:r.status()});});
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='cdnjs.cloudflare.com'){expectedCdn.push(u.href);return route.abort();}if(u.origin!==origin&&!['blob:','data:'].includes(u.protocol)){external.push(u.href);return route.abort();}return route.continue();});
  await page.addInitScript(installAudit);const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await ready(page);
    step('Auto and physical child tabs are visible without VGM or an AudioContext, and do not program presets merely by selection');
    assert(await page.locator('#synthChannelControls').isVisible());assert(await page.locator('#synthSongPlayer').isHidden());assert.equal((await view(page)).target,'synth');
    assert.deepEqual(await page.locator('#synthChannelTabs [role="tab"]').allTextContents(),['Auto','CH1','CH2','CH3','CH4','CH5','CH6']);
    await target(page,4);await target(page,'synth');assert.equal((await page.evaluate(()=>__channelAudit.graph())).contexts,0);
    for(const [kind,expected]of[['psg',['Auto','Tone 1','Tone 2','Tone 3','Noise']],['pcm',['Auto','CH1','CH2','CH3','CH4','CH5','CH6','CH7','CH8']]]){await chip(page,kind);assert.deepEqual(await page.locator('#synthChannelTabs [role="tab"]').allTextContents(),expected);assert(await page.locator('#synthChannelControls').isVisible());}
    await chip(page,'ym2612');await target(page,'synth');await keyboard(page);await page.keyboard.press('a');await until(()=>page.locator('#status').textContent().then(x=>/Audio ready/.test(x)),'audio initialization');await page.keyboard.up('a');

    step('Normal FM channel controls and keyboard address the selected physical channel while Auto broadcasts authored edits');
    await target(page,3);await drain(page);await key(page);let commands=await drain(page);assert(commands.some(x=>x.type==='write'&&x.register===0x28&&(x.value&7)===4&&(x.value>>4)),'CH4 keyboard Gate');await key(page,'a',false);
    const before=await audit(page,'ym2612-processor');await target(page,1);await drain(page);await change(op(page,1,'MULTI'),1);commands=await drain(page);
    assert(commands.some(x=>x.type==='write'&&x.port===0&&x.register===0x31),'CH2 operator edit reaches CH2');assert(!commands.some(x=>x.type==='write'&&x.register>=0x30&&x.register<=0x9f&&x.register%4===0),'CH2 edit does not overwrite CH1');
    const after=await audit(page,'ym2612-processor');assert.equal(after.fm.registers[0][0x30],before.fm.registers[0][0x30]);
    await target(page,'synth');await drain(page);await change(common(page,'FB'),1);commands=await drain(page);for(const port of[0,1])for(const reg of[0xb0,0xb1,0xb2])assert(commands.some(x=>x.type==='write'&&x.port===port&&x.register===reg),'Auto broadcasts feedback');

    step('Normal PSG Noise selection has its own hardware identity even when the authored Auto source is Tone');
    await chip(page,'psg');await target(page,'psg:3');await keyboard(page);await drain(page);await key(page);commands=await drain(page);assert(commands.some(x=>x.name==='tetorica-segapsg'&&x.method==='write'&&x.args[0]>=0xf0&&x.args[0]<0xff),'Noise CH4 keyboard unmutes Noise');await key(page,'a',false);
    await target(page,'psg:1');await drain(page);await change(page.locator('#synthPsgAttenuation'),-1);const psgWrites=(await drain(page)).filter(x=>x.name==='tetorica-segapsg'&&x.method==='write');assert(psgWrites.some(x=>(x.args[0]&0xf0)===0xb0),'Tone2 attenuation');assert(psgWrites.every(x=>(x.args[0]&0xf0)===0xb0),'Tone2 level edit touches no other PSG channel');

    step('Normal PCM fixed-channel keys initialize fresh tuning from the authored sample without losing the selected physical channel');
    await chip(page,'pcm');await target(page,'pcm:5');await keyboard(page);await key(page);let normalPcm=await audit(page,'tetorica-synth-pcm');assert.equal(normalPcm.pcm.channels[5].keyOn,true);assert(normalPcm.pcm.channels[5].step>0&&normalPcm.pcm.channels[5].volume>0);measurements.normalPcm=await signal(page);await key(page,'a',false);

    step('A single Code run prepares all chips and keeps its context, named loop and FX while child tabs inspect physical channels');
    await source(page,CODE);await run(page);await until(()=>page.evaluate(()=>__channelProbe.prepared.ticks>=2),'Code loop ticks');await page.evaluate(()=>{globalThis.__channelIdentity=__channelProbe;});await keyboard(page);measurements.code=await signal(page);
    const running=async()=>{assert.match((await view(page)).code,/Running|Playing/);assert(await page.evaluate(()=>__channelProbe===__channelIdentity&&__channelProbe.context.boots===1));assert.equal(await page.locator('#synthCodeError').textContent(),'');};
    await chip(page,'ym2612');await target(page,1);await until(()=>common(page,'ALGO').textContent().then(v=>v==='1'),'Code CH2 algorithm');assert.match((await view(page)).source,/Code/i);
    await target(page,4);await until(()=>common(page,'ALGO').textContent().then(v=>v==='4'),'Code CH5 algorithm');await target(page,1);await until(()=>common(page,'FB').textContent().then(v=>v==='3'),'Code CH2 feedback');await running();

    step('Live Off freezes FM display; a sparse physical-channel edit merges with later Code packed fields and leaves other channels intact');
    await page.locator('#synthSongLiveToggle').uncheck();await page.evaluate(()=>{__channelProbe.pending={kind:'fm',algorithm:6,feedback:5};});await until(()=>audit(page,'ym2612-processor').then(s=>(s.fm.registers[0][0xb1]&7)===6),'later Code algorithm');
    assert.equal(await common(page,'ALGO').textContent(),'1');const tick=await page.evaluate(()=>__channelProbe.prepared.ticks);await change(common(page,'FB'),1);await until(()=>audit(page,'ym2612-processor').then(s=>s.fm.registers[0][0xb1]===(4<<3|6)),'manual feedback preserves latest ALGO6');
    assert.equal((await audit(page,'ym2612-processor')).fm.registers[0][0xb0]&7,0);await until(()=>common(page,'FB').textContent().then(v=>v==='4'),'Live Off manual feedback is displayed');assert.equal(await common(page,'ALGO').textContent(),'1','untouched frozen algorithm stays frozen');await page.locator('#synthSongLiveToggle').check();await until(()=>common(page,'ALGO').textContent().then(v=>v==='6'),'FM Live catch-up');assert(await page.evaluate(()=>__channelProbe.prepared.ticks)>tick);await running();

    step('Code PSG and PCM physical fields are visible and edits preserve unrelated fields and custom sample RAM');
    await chip(page,'psg');await target(page,'psg:1');await until(()=>page.locator('#synthPsgPeriod').textContent().then(v=>v==='251'),'Code Tone2 period');await until(()=>page.locator('#synthPsgAttenuation').textContent().then(v=>v==='7'),'Code Tone2 attenuation');
    await change(page.locator('#synthPsgAttenuation'),1);await until(()=>audit(page,'tetorica-segapsg').then(s=>s.psg.levels[1]===8),'only Tone2 level');assert.equal((await audit(page,'tetorica-segapsg')).psg.levels[0],5);
    await chip(page,'pcm');await target(page,'pcm:7');await until(()=>page.locator('#synthPcmStep').textContent().then(v=>v==='4321'),'Code PCM CH8 Step');await until(()=>page.locator('#synthPcmVolume').textContent().then(v=>v==='89'),'Code PCM CH8 Volume');
    let pcmState=await audit(page,'tetorica-synth-pcm'),ramHash=pcmState.pcm.ramHash,loads=pcmState.pcm.loads;
    assert.equal(pcmState.pcm.channels[7].start,8192);assert.equal(pcmState.pcm.channels[7].loopStart,8192);
    await page.locator('#synthSongLiveToggle').uncheck();await page.evaluate(()=>{__channelProbe.pending={kind:'pcm',settings:{volume:101,step:8765,pan:{left:6,right:2}}};});await until(()=>audit(page,'tetorica-synth-pcm').then(s=>s.pcm.channels[7].step===8765),'later Code PCM settings');
    await change(page.locator('#synthPcmPanLeft'),-1);await until(()=>audit(page,'tetorica-synth-pcm').then(s=>s.pcm.channels[7].panLeft===5),'manual PCM left Pan');pcmState=await audit(page,'tetorica-synth-pcm');assert.equal(pcmState.pcm.channels[7].panRight,2);assert.equal(pcmState.pcm.channels[7].step,8765);assert.equal(pcmState.pcm.channels[7].volume,101);assert.equal(pcmState.pcm.ramHash,ramHash);assert.equal(pcmState.pcm.loads,loads);
    await until(()=>page.locator('#synthPcmPanLeft').textContent().then(v=>v==='5'),'Live Off manual PCM Pan is displayed');assert.equal(await page.locator('#synthPcmPanRight').textContent(),'10','untouched frozen Pan stays frozen');await page.locator('#synthSongLiveToggle').check();await until(()=>page.locator('#synthPcmStep').textContent().then(v=>v==='8765'),'PCM Live catch-up');await keyboard(page);await drain(page);await key(page);commands=await drain(page);assert(commands.some(x=>x.name==='tetorica-synth-pcm'&&(x.method==='keyOn'&&x.args[0]===7||x.method==='writeRegister'&&x.args[0]===8&&!(x.args[1]&128))),'physical PCM CH8 Gate');assert.equal((await audit(page,'tetorica-synth-pcm')).pcm.channels[7].keyOn,true);assert(!commands.some(x=>x.method==='loadMemory'),'selected Code PCM keyboard keeps its current RAM');
    await page.evaluate(()=>{__channelProbe.pcm.keyOn(0);__channelProbe.pcm.noteOff(7);});
    let simultaneous=await audit(page,'tetorica-synth-pcm');assert.equal(simultaneous.pcm.channels[0].keyOn,true,'Code can key CH1 while the hand holds CH8');assert.equal(simultaneous.pcm.channels[7].keyOn,true,'a stale Code Note Off cannot clear the hand-owned CH8');
    assert(!(await drain(page)).some(x=>x.name==='tetorica-synth-pcm'&&['keyOff','releaseNote'].includes(x.method)&&x.args[0]===7),'stale Code release sends no physical CH8 release');await key(page,'a',false);
    pcmState=await audit(page,'tetorica-synth-pcm');assert.equal(pcmState.pcm.channels[7].start,8192);assert.equal(pcmState.pcm.channels[7].loopStart,8192);assert.equal(pcmState.pcm.ramHash,ramHash);assert.equal(pcmState.pcm.channels[0].keyOn,true,'manual CH8 release preserves the Code-owned CH1 gate');await running();

    step('Auto still edits the authored instrument; selecting physical tabs does not collapse independent written channel patches');
    await chip(page,'ym2612');assert.equal((await view(page)).chip,'ym2612','PCM CH8 to FM changes channel domains atomically');const bank=await audit(page,'ym2612-processor');await target(page,'synth');await target(page,1);await target(page,4);await target(page,1);
    const selected=await audit(page,'ym2612-processor');for(const port of[0,1])for(let r=0x30;r<0xc0;r++)assert.equal(selected.fm.registers[port][r],bank.fm.registers[port][r],'tab selection retains register '+r);await running();
    await target(page,'synth');await drain(page);await change(common(page,'FB'),1);commands=await drain(page);for(const port of[0,1])for(const reg of[0xb0,0xb1,0xb2])assert(commands.some(x=>x.type==='write'&&x.port===port&&x.register===reg),'Auto Code edit reaches all FM channels');await running();

    step('VGM playback uses the same child tabs for FM, PSG and PCM, while Pause and Auto keep existing Copy behavior');
    await page.locator('#tfiFile').setInputFiles({name:'Channel tabs reference.vgm',mimeType:'application/octet-stream',buffer:vgm()});await ready(page);await target(page,2);await page.locator('#synthSongPlayButton').click();
    await until(()=>view(page).then(s=>s.song==='playing'&&s.frame>0),'VGM playing');assert.match((await view(page)).code,/Stopped/i);assert.match((await view(page)).source,/VGM/i);await until(()=>common(page,'ALGO').textContent().then(v=>v==='2'),'VGM CH3 settings');
    await chip(page,'psg');await target(page,'psg:1');await until(()=>page.locator('#synthPsgAttenuation').textContent().then(v=>v==='7'),'VGM PSG Tone2');assert.equal((await view(page)).song,'playing');
    await chip(page,'pcm');await target(page,'pcm:7');await until(()=>page.locator('#synthPcmVolume').textContent().then(v=>v==='57'),'VGM PCM CH8');assert.equal((await view(page)).song,'playing');
    await page.locator('#synthSongPlayButton').click();await until(()=>view(page).then(s=>s.song==='paused'),'VGM paused');const frame=(await view(page)).frame;assert(await page.locator('#synthSongCopyButton').isEnabled());await wait(120);assert.equal((await view(page)).frame,frame);
    await target(page,'synth');assert(await page.locator('#synthSongCopyButton').isDisabled());await page.locator('#synthSongStopButton').click();await until(()=>view(page).then(s=>s.song==='stopped'),'VGM stopped');assert(await page.locator('#synthChannelControls').isVisible());assert.match((await view(page)).source,/Normal/i);

    step('Persistent child tabs remain compact, scrollable and keyboard-accessible at desktop and phone widths');
    for(const width of[1240,390]){await page.setViewportSize({width,height:1000});await chip(page,'pcm');await target(page,'pcm:7');await page.locator('#synthChannelControls').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-${width}.png`)});}
    await page.locator('[data-synth-channel-target="pcm:7"]').focus();await page.keyboard.press('Home');assert.equal((await view(page)).target,'synth');await page.keyboard.press('End');assert.equal((await view(page)).target,'pcm:7');
    assert.equal(await page.locator('#synthCodeError').textContent(),'');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert((await page.evaluate(()=>__channelAudit.graph())).muted);
    return{browser:name,passed:true,checks,measurements,graph:await page.evaluate(()=>__channelAudit.graph()),errors,consoleErrors};
  }catch(error){await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-failure.png`)}).catch(()=>{});error.receipt={browser:name,passed:false,stage,checks,error:error.stack,view:await view(page).catch(()=>null),audit:await page.evaluate(()=>({graph:__channelAudit.graph(),fm:__channelAudit.state('ym2612-processor'),psg:__channelAudit.state('tetorica-segapsg'),pcm:__channelAudit.state('tetorica-synth-pcm'),commands:__channelAudit.drain().slice(-80)})).catch(()=>null),errors,consoleErrors};throw error;
  }finally{await page.close();}
}
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const file=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(file.startsWith(config.root+path.sep));const bytes=await fs.readFile(file),name=path.relative(config.root,file).split(path.sep).join('/'),meta={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(name))assert.deepEqual(served.get(name),meta,'Asset changed during browser check');served.set(name,meta);res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,checkerSha256:hash(await fs.readFile(__filename)),results,missing,external,httpErrors,expectedBlockedMonaco:expectedCdn,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack}:{} )};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
