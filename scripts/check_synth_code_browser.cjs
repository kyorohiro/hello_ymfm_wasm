// Public Synth Keyboard / Code integration. All speaker connections are
// intercepted before the app loads and physically pass through gain zero.
// Actual worklet output is measured only as numeric arrays; no listening.
// node scripts/check_synth_code_browser.cjs --root=release/itch_synth_dev --entry=/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',checks:'all',out:path.join(tmpdir(),'fm2612-synth-code-browser.json'),screenshots:path.join(tmpdir(),'fm2612-synth-code-browser')};
for(const arg of process.argv.slice(2)){const m=/^--(root|entry|engines|checks|out|screenshots)=(.+)$/.exec(arg);assert(m,'Unknown argument '+arg);config[m[1]]=m[2];}config.root=path.resolve(config.root);
assert(['all','stop','baseline-stop','mixer','pcm-notes','live-presets','keyboard'].includes(config.checks));
assert(config.entry.startsWith('/'));assert(config.engines.split(',').every(name=>['chromium','webkit'].includes(name)));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=b=>createHash('sha256').update(b).digest('hex');
async function bounded(task,label,ms=30000){let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timeout '+label)),ms);})]);}finally{clearTimeout(timer);}}
const evaluate=(page,fn,arg)=>bounded(page.evaluate(fn,arg),'page evaluation');
async function until(test,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await pause(40);}throw Error(label);}
function installAudit(){
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,meters=[],commands=[],contexts=[],worklets=[];
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);worklets.push({node:this,name});}};
  let capture=null,captureSerial=0;
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const context=this.context,split=context.createChannelSplitter(2),left=context.createAnalyser(),right=context.createAnalyser(),mute=context.createGain();
    left.fftSize=right.fftSize=8192;mute.gain.value=0;
    connect.call(this,split);connect.call(split,left,0);connect.call(split,right,1);connect.call(left,mute);connect.call(right,mute);connect.call(mute,destination);
    meters.push({source:this,left,right,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(message,...args){
    for(const item of Array.isArray(message)?message:[message])if(item&&typeof item==='object'){
      if(item.method)commands.push({method:item.method,args:item.method==='loadMemory'?[item.args?.[0]?.byteLength,item.args?.[1]]:item.args});
      else if(item.type==='write')commands.push({type:item.type,register:item.register,value:item.value});
      else if(item.op==='live-fx')commands.push({op:item.op,action:item.action,name:item.name});
    }
    if(commands.length>30000)commands.splice(0,commands.length-30000);return post.call(this,message,...args);
  };
  function channel(analyser){const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);let sum=0,peak=0,finite=true;const crossings=[];
    for(let i=0;i<values.length;i++){const value=values[i];sum+=value*value;peak=Math.max(peak,Math.abs(value));finite&&=Number.isFinite(value);if(i&&values[i-1]<=0&&value>0)crossings.push(i);}
    return {rms:Math.sqrt(sum/values.length),peak,finite,frequency:crossings.length>2?analyser.context.sampleRate*(crossings.length-1)/(crossings.at(-1)-crossings[0]):0};
  }
  async function beginCapture() {
    assertCapture(!capture,'Capture already running');
    const source=meters.map(meter=>({source:meter.source,level:channel(meter.left).rms+channel(meter.right).rms}))
      .sort((a,b)=>b.level-a.level)[0]?.source;assertCapture(source,'No output bus');
    const name='tetorica-code-stop-audit-'+(++captureSerial),url=URL.createObjectURL(new Blob([
      `class Capture extends AudioWorkletProcessor {process(inputs){const x=inputs[0];if(x?.[0])this.port.postMessage({frame:currentFrame,left:x[0].slice(),right:(x[1]??x[0]).slice()});return true;}}registerProcessor('${name}',Capture);`
    ],{type:'text/javascript'}));
    try{await source.context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    const collector=new AudioWorkletNode(source.context,name,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]}),mute=source.context.createGain();mute.gain.value=0;
    const current=capture={source,collector,mute,blocks:[],mark:null};
    collector.port.onmessage=({data})=>{if(current.blocks.length<4096)current.blocks.push(data);};
    connect.call(source,collector);connect.call(collector,mute);connect.call(mute,source.context.destination);
  }
  function assertCapture(value,message){if(!value)throw Error(message);}
  function finishCapture() {
    const current=capture;assertCapture(current,'Capture missing');capture=null;
    current.source.disconnect(current.collector);current.collector.disconnect();current.mute.disconnect();current.collector.port.close();
    const blocks=current.blocks.sort((a,b)=>a.frame-b.frame),rate=current.source.context.sampleRate;
    assertCapture(blocks.length>20&&current.mark!==null,'Stop capture incomplete');
    const origin=blocks[0].frame,end=blocks.at(-1).frame+blocks.at(-1).left.length,left=new Float32Array(end-origin),right=new Float32Array(left.length);
    let expected=origin;for(const block of blocks){assertCapture(block.frame===expected,'Capture render gap');left.set(block.left,block.frame-origin);right.set(block.right,block.frame-origin);expected+=block.left.length;}
    let beforePeak=0,beforeJump=0,maxJump=0,tailPeak=0,lastNonzero=null;
    const at=current.mark-origin;
    for(let i=Math.max(1,at-Math.round(.04*rate));i<Math.min(left.length,at+Math.round(.12*rate));i++){
      const peak=Math.max(Math.abs(left[i]),Math.abs(right[i]));
      if(i<at-128){beforePeak=Math.max(beforePeak,peak);beforeJump=Math.max(beforeJump,Math.abs(left[i]-left[i-1]),Math.abs(right[i]-right[i-1]));}
      if(i>=at-256&&i<at+Math.round(.04*rate))maxJump=Math.max(maxJump,Math.abs(left[i]-left[i-1]),Math.abs(right[i]-right[i-1]));
      if(i>at+Math.round(.05*rate))tailPeak=Math.max(tailPeak,peak);
      if(peak>1e-8)lastNonzero=origin+i;
    }
    return{sampleRate:rate,frames:left.length,blocks:blocks.length,markFrame:current.mark,beforePeak,beforeJump,maxJump,normalizedJump:maxJump/beforePeak,tailPeak,
      lastNonzeroAfterStopMs:lastNonzero===null?null:1000*(lastNonzero-current.mark)/rate,physicalBranchMuted:current.mute.gain.value===0};
  }
  window.__synthCodeAudit={beginCapture,markStop(){assertCapture(capture,'No capture');capture.mark=Math.round(capture.source.context.currentTime*capture.source.context.sampleRate);},finishCapture,
    read(){const rows=meters.map(({left,right,mute})=>({left:channel(left),right:channel(right),muted:mute.gain.value===0}));
      return rows.sort((a,b)=>(b.left.rms+b.right.rms)-(a.left.rms+a.right.rms))[0]??null;},
    graph(){return {contexts:contexts.length,openContexts:contexts.filter(context=>context.state!=='closed').length,worklets:worklets.map(item=>item.name),destinations:meters.length};},
    drain(){return commands.splice(0);},muted:()=>meters.every(m=>m.mute.gain.value===0),meterCount:()=>meters.length};
}
const served=new Map(),missing=[],external=[],expectedCdn=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));const bytes=await fs.readFile(filename),name=path.relative(config.root,filename).split(path.sep).join('/'),meta={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(name))assert.deepEqual(served.get(name),meta,'Asset changed during browser check');served.set(name,meta);res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
async function ready(page){await until(()=>page.locator('.synth-editor').getAttribute('aria-busy').then(v=>v==='false'),'Synth ready');}
async function open(browser,origin){const page=await browser.newPage({viewport:{width:1240,height:1100},serviceWorkers:'block',acceptDownloads:true}),errors=[];page.setDefaultTimeout(25000);
  page.on('pageerror',e=>errors.push(e.stack??e.message));page.on('console',m=>{if(m.type()!=='error')return;const text=m.text(),url=m.location().url;
    if(url.includes('cdnjs.cloudflare.com')||text.includes('cdnjs.cloudflare.com')||/^Failed to load resource/.test(text)&&expectedCdn.length)return;errors.push(text);});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){expectedCdn.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installAudit);await page.goto(origin+config.entry);await ready(page);return {page,errors};
}
async function reading(page){await pause(220);const data=await evaluate(page,()=>__synthCodeAudit.read());assert(data&&data.muted&&data.left.finite&&data.right.finite,'finite, physically muted output');return data;}
async function sounding(page){await until(async()=>{const data=await evaluate(page,()=>__synthCodeAudit.read());return data&&Math.max(data.left.rms,data.right.rms)>.001;},'Code produces actual PCM');return reading(page);}
async function silence(page){await pause(250);await until(async()=>{const d=await evaluate(page,()=>__synthCodeAudit.read());return !d||Math.max(d.left.rms,d.right.rms)<1e-7;},'All Code audio stops');}
async function code(page,source){await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(source);}
async function execute(page,apply=false){await page.locator(apply?'#synthCodeApplyButton':'#synthCodeRunButton').click();await until(async()=>{
  const error=await page.locator('#synthCodeError').textContent();if(error)throw Error('Code execution failed: '+error);
  return page.locator('#synthCodeState').textContent().then(v=>/Running|Playing/.test(v));},apply?'Code applies':'Code runs');}
async function stop(page){await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(v=>/Stopped/i.test(v)),'Code stopped');await silence(page);}
async function range(page,selector,value){await page.locator(selector).first().evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function field(page,id,value){const node=page.locator('#'+id),map={synthPsgAttenuation:'[data-psg-param="attenuation"]'};await node.scrollIntoViewIfNeeded();
  for(let i=0;i<512;i++){const current=Number(await node.textContent());if(current===value)return;const parent=node.locator('..');const buttons=parent.locator('.param-button');assert.equal(await buttons.count(),2,'Numeric field has +/- controls: '+id);await buttons.nth(value>current?1:0).click();}
  assert.equal(Number(await node.textContent()),value,'Numeric field '+id);
}
async function chip(page,name){const id={fm:'synthChipTabYm2612',psg:'synthChipTabPsg',pcm:'synthChipTabPcm',pwm:'synthChipTabPwm'}[name];await page.locator('#'+id).click();await ready(page);}
async function menu(page){if(!await page.locator('#synthMenu').evaluate(n=>n.open))await page.locator('#synthMenuButton').click();}
async function download(page,id){await menu(page);const waiting=page.waitForEvent('download');await page.locator(id).click();const item=await waiting,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return {bytes:Buffer.concat(chunks),name:item.suggestedFilename()};}
async function choose(page,file){if(!await page.locator('#synthFilesPanel').isVisible())await page.locator('#synthFilesToggle').click();
  for(let i=0;i<20;i++){const closed=page.locator('#synthFilesTree details:not([open]) > summary[data-file-path]');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#synthFilesTree button.file-entry').locator(`xpath=self::*[@data-file-path=${JSON.stringify(file)}]`).click();await ready(page);
  await until(async()=>await page.locator('#synthActiveFilePath').textContent()===file||await page.locator('#synthFileSelectionInfo').textContent()===file,'Files selects '+file);
}
function authoredVgm(){const c=[0x52,0xb0,7,0x52,0xb4,0xc0,0x52,0xa4,0x22,0x52,0xa0,0x44];for(let i=0;i<8;i++)c.push(0x61,0x44,0xac);c.push(0x66);const b=Buffer.alloc(256+c.length),v=new DataView(b.buffer,b.byteOffset,b.byteLength);b.write('Vgm ');v.setUint32(4,b.length-4,true);v.setUint32(8,0x171,true);v.setUint32(0x34,204,true);v.setUint32(0x18,8*44100,true);v.setUint32(0x2c,7670454,true);b.set(c,256);return b;}
const KEEP_FM=`const fm = await useSoundChip('ym2612');\nfm.noteOn(2, 5, 644);\nliveLoop('hold', async () => { await sleep(1); });\n`;
const fxSource=gain=>KEEP_FM+(gain===null?'':`liveFx('level', { context:{gain:${gain}}, process(input,output,state,context){for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*context.gain;} });\n`);
const LOOP_SOURCE=`const fm=await useSoundChip('ym2612');
context.applies=(context.applies??0)+1;
log('apply-count',context.applies);
globalThis.__codeProbe ??= {active:0,max:0,ticks:0};
liveLoop('melody',async()=>{const p=globalThis.__codeProbe;p.active++;p.max=Math.max(p.max,p.active);try{fm.noteOn(CH1,'C4');await sleep(.04);fm.noteOff(CH1);p.ticks++;await beat(.25);}finally{p.active--;}});
`;
const PWM_SOURCE=`const pwm=await useSoundChip('pwm');
const {sampleRate,clock}=await pwm.getState();
const cycle=1047,seconds=1,rate=clock/(cycle-1);
const entries=[{frame:0,register:0,value:5},{frame:0,register:1,value:cycle}];
for(let i=0;i<Math.ceil(seconds*rate);i++){const t=i/rate,fade=Math.min(1,t/.02,(seconds-t)/.02);entries.push({frame:Math.round(t*sampleRate),register:4,value:Math.round(cycle/2+cycle*.12*fade*Math.sin(2*Math.PI*440*t))});}
entries.push({frame:Math.round(seconds*sampleRate),register:4,value:Math.round(cycle/2)});
liveLoop('pwm',async()=>{await pwm.scheduleWrites(entries);await sleep(1.1);await pwm.reset();});
`;
let loadCassette,mixerDefaults,livePresetFiles;
async function mixerVolume(page,id,value) {
  await range(page,`#synthSongGroupVolume-${id}`,value);
  assert.equal(Number(await page.locator(`#synthSongGroupVolume-${id}`).inputValue()),value);
}
function mixerPsgVgm(){
  const commands=[0x50,0x85,0x50,0x12,0x50,0x94];for(let i=0;i<12;i++)commands.push(0x61,0x44,0xac);commands.push(0x66);
  const bytes=Buffer.alloc(256+commands.length),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
  bytes.write('Vgm ');view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);view.setUint32(12,3579545,true);view.setUint32(0x34,204,true);view.setUint32(0x18,12*44100,true);bytes.set(commands,256);return bytes;
}
function mixerFmVgm(){
  const c=[],write=(r,v)=>c.push(0x52,r,v);
  write(0x22,0);write(0x27,0);write(0x2b,0);write(0xb0,7);write(0xb4,0xc0);
  for(const [op,slot]of [0,8,4,12].entries()){
    write(0x30+slot,1);write(0x40+slot,op===3?42:127);write(0x50+slot,31);
    write(0x60+slot,0);write(0x70+slot,0);write(0x80+slot,15);write(0x90+slot,0);
  }
  write(0xa4,0x22);write(0xa0,0x44);write(0x28,0x80);
  for(let i=0;i<12;i++)c.push(0x61,0x44,0xac);c.push(0x66);
  const b=Buffer.alloc(256+c.length),v=new DataView(b.buffer,b.byteOffset,b.length);
  b.write('Vgm ');v.setUint32(4,b.length-4,true);v.setUint32(8,0x171,true);v.setUint32(0x34,204,true);
  v.setUint32(0x18,12*44100,true);v.setUint32(0x2c,7670454,true);b.set(c,256);return b;
}
async function mixerChecks(page,name){
  const result={browser:name,steps:[],sources:[]};
  const toggle=id=>page.locator(`[data-song-mute="${id}"]`);
  const openMixer=async()=>{await page.locator('#synthSongMixButton').click();await page.locator('#synthChipMixer').waitFor({state:'visible'});};
  assert(await page.locator('#synthSongPlayer').isHidden());await openMixer();
  assert.equal(await page.locator('#synthSongMixButton').getAttribute('role'),'tab');
  assert.deepEqual(await page.locator('[data-synth-chip]').evaluateAll(nodes=>nodes.map(n=>n.textContent.trim())),['YM2612','PSG','RF5C164','32X PWM','Mixer']);
  assert.equal(await page.locator('[data-song-group-volume]').count(),4);assert.equal(await page.locator('[data-song-mute]').count(),20);
  assert(await page.locator('#synthSongMixReferenceOptions').isHidden());
  for(const [id,gain]of Object.entries(mixerDefaults))assert(Math.abs(Number(await page.locator('#synthSongGroupVolume-'+id).inputValue())/100-gain)<1e-6,'Initial System source gain '+id);
  for(const button of await page.locator('[data-song-mute]').all())assert.equal(await button.getAttribute('aria-pressed'),'true','Every CH starts On');
  await fs.mkdir(config.screenshots,{recursive:true});
  for(const width of [1240,390]){await page.setViewportSize({width,height:1100});await pause(100);assert(await evaluate(page,()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('#synthSongMixButton').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(config.screenshots,`${name}-mixer-tab-${width}.png`)});}
  await page.setViewportSize({width:1240,height:1100});result.steps.push('Mixer is the fifth tab after 32X PWM; all 20 On/Off switches and four calibrated source volumes are available before a VGM');
  const probes=[
    {id:'ym2612',chip:'fm',channel:2,source:KEEP_FM},
    {id:'psg',chip:'psg',channel:0,source:`const psg=await useSoundChip('segapsg');psg.tone(0,{note:'C4'});liveLoop('hold',async()=>{await sleep(1);});`},
    {id:'pcm',chip:'pcm',channel:0,source:`const pcm=await useSoundChip('rf5c164');pcm.keyOn(0);liveLoop('hold',async()=>{await sleep(1);});`},
    {id:'pwm',chip:'pwm',channel:0,source:PWM_SOURCE.replace('seconds=1,','seconds=8,').replace('sleep(1.1)','sleep(8.1)')},
  ];
  for(const probe of probes){
    await chip(page,probe.chip);if(probe.id==='ym2612'){await page.locator('#presetSelect').selectOption('sine');await ready(page);}
    if(probe.id==='psg')await field(page,'synthPsgAttenuation',6);
    if(probe.id==='pcm'){await page.locator('[data-pcm-builtin="sine"]').click();await field(page,'synthPcmVolume',64);}
    await code(page,probe.source);await execute(page);await sounding(page);
    await page.locator('#synthCodeExpandButton').click();await page.locator('#synthCodeMixerButton').click();
    assert.equal(await page.locator('#synthSongMixButton').getAttribute('aria-selected'),'true');assert(await page.locator('#synthChipMixer').isVisible());
    assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/,'Entering Mixer never stops Code');
    await mixerVolume(page,probe.id,100);const full=await reading(page);
    const control=toggle(probe.id+':'+probe.channel);await control.click();assert.equal(await control.getAttribute('aria-pressed'),'false');
    if(probe.id==='pwm'){const right=await reading(page);assert(right.left.rms<1e-7&&right.right.rms>.001,'PWM left Off keeps right output');}else await silence(page);
    await control.click();assert.equal(await control.getAttribute('aria-pressed'),'true');await sounding(page);
    await mixerVolume(page,probe.id,50);const half=await reading(page);assert(Math.abs(half.left.rms/full.left.rms-.5)<.06,'Absolute source volume applies once '+JSON.stringify({probe:probe.id,full,half}));
    await mixerVolume(page,probe.id,0);await silence(page);await mixerVolume(page,probe.id,100);await sounding(page);
    if(probe.id==='ym2612'){await range(page,'#masterVolumeRange',200);const twice=await reading(page);assert(Math.abs(twice.left.rms/full.left.rms-2)<.1);await range(page,'#masterVolumeRange',100);}
    await mixerVolume(page,probe.id,380);assert.equal(await page.locator('#synthSongGroupVolume-'+probe.id).getAttribute('data-boosted'),'true');await mixerVolume(page,probe.id,100);await stop(page);
    result.sources.push({id:probe.id,full,half});
  }
  result.steps.push('FM / PSG / PCM live CH On/Off and PWM L/R operate without stopping held voices; all source gains and Master stay independent');
  await page.locator('#synthInputKeyboardTab').click();await chip(page,'fm');await openMixer();
  await toggle('ym2612:0').click();
  await page.locator('#tfiFile').setInputFiles({name:'First paused FM.vgm',mimeType:'application/octet-stream',buffer:mixerFmVgm()});await ready(page);
  await page.locator('#synthSongChannelSelect').selectOption('0');await page.locator('#synthSongPlayButton').click();
  await until(()=>page.locator('#synthSongStatus').getAttribute('data-state').then(v=>v==='playing'),'FM reference starts');
  await page.locator('#synthSongPlayButton').click();
  await until(()=>page.locator('#keyboard').getAttribute('data-song-audition').then(v=>v==='ready'),'First paused FM audition is ready');
  await openMixer();await toggle('ym2612:0').focus();await evaluate(page,()=>__synthCodeAudit.drain());
  await page.keyboard.down('a');await silence(page);
  assert((await evaluate(page,()=>__synthCodeAudit.drain())).some(item=>item.type==='write'&&item.register===0x28&&(item.value&0xf0)),'Muted lazy audition still advances a real keyed voice');
  await toggle('ym2612:0').click();await sounding(page);await toggle('ym2612:0').click();await silence(page);
  await page.keyboard.up('a');await toggle('ym2612:0').click();await page.locator('#synthSongStopButton').click();
  result.steps.push('A newly created paused FM audition inherits CH Off and restores the same held voice when switched On');
  await chip(page,'psg');await openMixer();await mixerVolume(page,'psg',35);
  const fixture=mixerPsgVgm();await page.locator('#tfiFile').setInputFiles({name:'Shared mixer PSG.vgm',mimeType:'application/octet-stream',buffer:fixture});await ready(page);await openMixer();
  assert.equal(Number(await page.locator('#synthSongGroupVolume-psg').inputValue()),35);
  await page.locator('#synthSongPlayButton').click();await until(()=>page.locator('#synthSongStatus').getAttribute('data-state').then(v=>v==='playing'),'Reference starts');const song=await sounding(page);
  await openMixer();await mixerVolume(page,'psg',17.5);await pause(550);const softer=await reading(page);assert(Math.abs(softer.left.rms/song.left.rms-.5)<.07);
  await toggle('psg:0').click();await pause(550);await silence(page);assert.equal(await toggle('psg:0').getAttribute('aria-pressed'),'false');
  await page.locator('#synthSongStopButton').click();await page.locator('#synthSongChannelSelect').selectOption('synth');
  await toggle('psg:0').focus();await page.keyboard.down('a');await silence(page);await toggle('psg:0').click();await sounding(page);await page.keyboard.up('a');await silence(page);
  await toggle('psg:0').click();await page.locator('#tfiFile').setInputFiles({name:'Shared mixer second.vgm',mimeType:'application/octet-stream',buffer:fixture});await ready(page);await openMixer();
  assert.equal(Number(await page.locator('#synthSongGroupVolume-psg').inputValue()),17.5);assert.equal(await toggle('psg:0').getAttribute('aria-pressed'),'false','New song retains shared CH Off');
  await page.locator('#synthSongMixReset').click();for(const[id,gain]of Object.entries(mixerDefaults))assert(Math.abs(Number(await page.locator('#synthSongGroupVolume-'+id).inputValue())/100-gain)<1e-6);
  assert.equal(await toggle('psg:0').getAttribute('aria-pressed'),'true');
  result.steps.push('VGM / Keyboard share the same CH switches, new songs keep switches and volumes, and Reset restores System gains plus all On');
  return result;
}
async function stopSignalChecks(page,{baseline=false}={}) {
  await chip(page,'fm');await page.locator('#presetSelect').selectOption('sine');await ready(page);
  const probes=[{name:'FM E1',master:100,source:`const fm=await useSoundChip('ym2612');fm.noteOn(CH1,'E1');liveLoop('hold',async()=>{await sleep(1);});`},
    {name:'FX DC output',master:100,source:`liveFx('dc',{process(input,output){for(const ch of output)ch.fill(.2);}});liveLoop('hold',async()=>{await sleep(1);});`},
    {name:'FX DC output at 380% Master',master:380,source:`liveFx('dc',{process(input,output){for(const ch of output)ch.fill(.2);}});liveLoop('hold',async()=>{await sleep(1);});`}];
  const results=[];
  for(const probe of probes){
    await range(page,'#masterVolumeRange',probe.master);await code(page,probe.source);await execute(page);await sounding(page);
    await evaluate(page,()=>__synthCodeAudit.beginCapture());await pause(100);
    await evaluate(page,()=>{__synthCodeAudit.markStop();document.getElementById('synthCodeStopButton').click();});
    await pause(180);const signal=await evaluate(page,()=>__synthCodeAudit.finishCapture());await silence(page);
    assert(signal.physicalBranchMuted&&signal.beforePeak>.05&&signal.tailPeak<1e-7,JSON.stringify({probe,signal}));
    results.push({name:probe.name,...signal});
    // A chip's own sample steps remain. Stop may add only the smooth ramp's
    // per-sample slope, never an instantaneous signal-sized reset or FX cut.
    if(!baseline)assert(signal.maxJump<=signal.beforeJump+2*signal.beforePeak/(signal.sampleRate*.008)+1e-5,
      'Stop is a short continuous fade before physical cleanup: '+JSON.stringify({probe:probe.name,signal}));
  }
  await range(page,'#masterVolumeRange',100);
  if(!baseline){
    await code(page,KEEP_FM);await execute(page);await sounding(page);
    await evaluate(page,()=>{document.getElementById('synthCodeStopButton').click();document.getElementById('synthCodeRunButton').click();});
    await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Running|Playing/.test(value)),'Rapid Stop / Run retires the old program');
    await sounding(page);await pause(150);await sounding(page);await stop(page);
  }
  return results;
}
function authoredPcmWav(frequency,{sampleRate=32000,seconds=.25}={}) {
  const frames=Math.round(sampleRate*seconds),bytes=Buffer.alloc(44+frames*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVE',8);bytes.write('fmt ',12);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(sampleRate,24);bytes.writeUInt32LE(sampleRate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
  for(let frame=0;frame<frames;frame++)bytes.writeInt16LE(Math.round(.65*32767*Math.sin(2*Math.PI*frequency*frame/sampleRate)),44+frame*2);
  return bytes;
}
async function pcmNoteChecks(page,name) {
  const result={browser:name,steps:[],builtin:{},rootOverride:{},wav:[]};
  const hold=action=>`const pcm=await useSoundChip('rf5c164');\n${action}\nliveLoop('pcm-note-hold',async()=>{await sleep(1);});\n`;
  const drain=()=>evaluate(page,()=>__synthCodeAudit.drain());
  const apply=async source=>{await page.locator('#synthCodeEditor').fill(source);await execute(page,true);};
  const frequency=async(expected,label)=>{
    const measured=await sounding(page),actual=measured.left.frequency;
    assert(Math.abs(actual-expected)<Math.max(3,expected*.035),label+': '+JSON.stringify({expected,measured}));return measured;
  };
  const exportedPcm=async()=>JSON.parse((await download(page,'#exportPcmButton')).bytes.toString());
  const noPcmWrites=(commands,label)=>assert(!commands.some(command=>['writeRegister','keyOn','keyOff','releaseNote','loadMemory'].includes(command.method)),label+': '+JSON.stringify(commands));
  await chip(page,'pcm');await page.locator('[data-pcm-builtin="sine"]').click();await ready(page);
  await field(page,'synthPcmVolume',64);await field(page,'synthPcmPanLeft',15);await field(page,'synthPcmPanRight',15);
  await field(page,'synthPcmRootNote',60);await range(page,'#masterVolumeRange',100);
  await code(page,hold(`await pcm.noteOn(0,'C4');`));await drain();await execute(page);
  result.builtin.c4=await frequency(261.625565,'Builtin Sine noteOn C4');
  assert.equal((await drain()).filter(command=>command.method==='keyOn'&&command.args?.[0]===0).length,1);
  await apply(hold(`const step=pcm.setNote(0,'A4');if(!Number.isInteger(step)||step<1||step>65535)throw Error('setNote must return a raw step');log('pcm-note-step',step);`));
  result.builtin.heldA4=await frequency(440,'setNote changes the existing held note to A4');
  const retune=await drain();assert(!retune.some(command=>command.method==='keyOn'),'setNote cannot retrigger a held PCM channel');
  assert(retune.some(command=>command.method==='writeRegister'&&[2,3].includes(command.args?.[0])),'setNote updates physical step registers');
  assert.match(await page.locator('#synthCodeLog').textContent(),/pcm-note-step \d+/);
  await apply(hold('pcm.noteOff(0);'));await silence(page);
  assert((await drain()).some(command=>command.method==='releaseNote'&&command.args?.[0]===0),'noteOff uses the private software release');
  await apply(hold(`await pcm.noteOn(0,'A4');`));result.builtin.a4=await frequency(440,'A4 can be keyed again after semantic noteOff');
  await drain();await field(page,'synthPcmRootNote',72);
  assert.equal(await page.locator('#synthPcmRootName').textContent(),'C5');
  await apply(hold(`pcm.setNote(0,'A4');`));result.builtin.rootPlus12=await frequency(220,'Root C5 makes the same requested A4 play at half sample speed');
  assert(Math.abs(result.builtin.rootPlus12.left.frequency/result.builtin.a4.left.frequency-.5)<.025);
  assert(!(await drain()).some(command=>command.method==='keyOn'),'Root and setNote changes keep the existing physical playback position');
  await stop(page);result.steps.push('Builtin Sine C4/A4, numeric step result, setNote held retune without keyOn, noteOff release, and upper Root +12 at half speed');

  await field(page,'synthPcmRootNote',60);const savedBefore=await exportedPcm();
  await code(page,hold(`await pcm.noteOn(0,'C4');`));await execute(page);result.rootOverride.before=await frequency(261.625565,'Code root declaration starts from the author C4 tuning');await drain();
  await apply(hold(`if(pcm.setRootNote('A4')!==69)throw Error('setRootNote must return its effective MIDI root');`));
  result.rootOverride.declared=await frequency(261.625565,'setRootNote alone leaves the held waveform speed unchanged');
  noPcmWrites(await drain(),'Declaring the Code root must not write or retrigger the physical chip');
  assert.equal(Number(await page.locator('#synthPcmRootNote').textContent()),60);assert.equal(await page.locator('#synthPcmRootName').textContent(),'C4');
  await apply(hold(`pcm.setNote(0,'A5');`));result.rootOverride.a5=await frequency(523.25113,'Code root A4 makes A5 twice the original sample speed, not an inferred 880 Hz');
  assert(Math.abs(result.rootOverride.a5.left.frequency/result.rootOverride.before.left.frequency-2)<.05);
  assert(!(await drain()).some(command=>command.method==='keyOn'),'Code root survives Apply and retunes through setNote without a new keyOn');
  assert.deepEqual(await exportedPcm(),savedBefore,'Code root and note helpers cannot change the exported author PCM instrument');
  await field(page,'synthPcmRootNote',72);result.rootOverride.uiChanged=await frequency(523.25113,'Changing the editor Root cannot apply a second root adjustment to a Code override');
  assert(!(await drain()).some(command=>command.method==='keyOn'));
  await apply(hold(`if(pcm.setRootNote(null)!==72)throw Error('Cleared Code root must return the current editor root');`));
  result.rootOverride.clearedHeld=await frequency(523.25113,'Clearing the Code root also leaves the held speed unchanged');
  noPcmWrites(await drain(),'Clearing Code root is metadata only');
  await apply(hold(`pcm.setNote(0,'A5');`));result.rootOverride.editorRoot=await frequency(440,'The next setNote uses editor Root C5 after clearing the override');
  assert(!(await drain()).some(command=>command.method==='keyOn'));
  await apply(hold(`if(pcm.setRootNote(69)!==69)throw Error('Numeric Code root must be accepted');pcm.setNote(0,'A5');`));
  result.rootOverride.numeric=await frequency(523.25113,'Numeric MIDI root has the same tuning as its note name');await stop(page);
  await code(page,hold(`await pcm.noteOn(0,'A5');`));await execute(page);result.rootOverride.afterStop=await frequency(440,'Stop followed by Run clears the override and uses the unchanged editor Root');
  await apply(hold(`pcm.setRootNote('A4');`));await page.locator('[data-pcm-builtin="sine"]').click();await ready(page);
  assert.equal(Number(await page.locator('#synthPcmRootNote').textContent()),60);
  await apply(hold(`await pcm.noteOn(0,'A5');`));result.rootOverride.afterSource=await frequency(880,'Installing an author sample clears the Code root declaration');await stop(page);
  result.steps.push('Code root name/MIDI/null is metadata only, persists Apply, preserves exported instrument and held notes, bypasses duplicate UI-root tuning, and clears on author source or Stop');

  // These WAVs have different authored fundamentals. With Root C4, note C4
  // plays each at its original speed: the helper must not infer a new pitch.
  for(const hz of [200,400]) {
    const filename=`Authored ${hz} Hz PCM.wav`;
    await page.locator('#synthPcmAudioFile').setInputFiles({name:filename,mimeType:'audio/wav',buffer:authoredPcmWav(hz)});
    await until(()=>page.locator('#synthPcmSampleInfo').textContent().then(text=>text.includes(filename)),'PCM author WAV loads '+hz);await ready(page);
    if(await page.locator('#synthPcmLoopEnabled').getAttribute('aria-pressed')!=='true')await page.locator('#synthPcmLoopEnabled').click();
    await field(page,'synthPcmRootNote',60);await field(page,'synthPcmVolume',64);
    await code(page,hold(`await pcm.noteOn(0,'C4');`));await execute(page);const original=await frequency(hz,'WAV C4 retains its authored sample speed '+hz);
    await apply(hold(`pcm.setNote(0,'C5');`));const octave=await frequency(hz*2,'WAV C5 doubles its sample speed '+hz);
    assert(Math.abs(octave.left.frequency/original.left.frequency-2)<.05);result.wav.push({authoredFrequency:hz,original,octave});await stop(page);
  }
  assert(Math.abs(result.wav[1].original.left.frequency/result.wav[0].original.left.frequency-2)<.05);
  result.steps.push('Generated 200/400 Hz WAVs retain their different fundamentals at Root C4 and double at C5; no automatic fundamental estimation');

  await page.locator('[data-pcm-builtin="sine"]').click();await ready(page);
  const melody=`const pcm=await useSoundChip('rf5c164');setBpm(120);liveLoop('melody',async()=>{const notes=scale('E1','minorPentatonic',3);await pcm.noteOn(CH1,choose(notes));await sleep(.1);pcm.noteOff(CH1);await beat(.025);});`;
  await code(page,melody);await drain();await execute(page);result.melody=await sounding(page);await pause(550);
  const commands=await drain();result.melodyCommands={noteOns:commands.filter(command=>command.method==='keyOn').length,releases:commands.filter(command=>command.method==='releaseNote').length};
  assert(result.melodyCommands.noteOns>=3&&result.melodyCommands.releases>=2,'The requested PCM minor-pentatonic melody repeats real notes');
  assert(commands.filter(command=>command.method==='keyOn').every(command=>command.args?.[0]===0),'CH1 remains the requested physical PCM channel');
  assert.match(await page.locator('#synthCodeState').textContent(),/1 loop/);await stop(page);
  assert(await evaluate(page,()=>__synthCodeAudit.muted()));result.steps.push('The requested scale/choose melody runs on RF5C164 CH1 and Stop produces silence');
  return result;
}
async function livePresetChecks(page,name){
  const result={browser:name,steps:[],signals:[]};
  await page.locator('#tfiFile').setInputFiles(livePresetFiles);await ready(page);
  await chip(page,'fm');await page.locator('#presetSelect').selectOption('sine');await ready(page);
  await code(page,`const fm=await useSoundChip('ym2612'),psg=await useSoundChip('segapsg'),pcm=await useSoundChip('rf5c164');
context.boots=(context.boots??0)+1;const prepared=await livePrepare('preset-check',()=>({visits:0}));
globalThis.__livePreset={context,prepared,ticks:0,fm,psg,pcm};
liveFx('preset-level',{context:{gain:.25},process(input,output,state,context){for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*context.gain;}});
liveLoop('preset-melody',async()=>{const p=__livePreset;p.ticks++;prepared.visits++;fm.noteOn(0,'A3');psg.tone(0,{note:'C4'});pcm.noteOn(0,'E4');await sleep(.12);fm.noteOff(0);psg.keyOff(0);pcm.noteOff(0);await sleep(.04);});`);
  await execute(page);await sounding(page);await evaluate(page,()=>{window.__liveIdentity=__livePreset;__synthCodeAudit.drain();});
  for(const file of livePresetFiles){
    const before=await evaluate(page,()=>__livePreset.ticks);
    await choose(page,`/presets/${file.name.replace(/\.(vgi|psg\.json|pcm\.json)$/i,'')}/${file.name}`);
    await until(()=>evaluate(page,before=>__livePreset.ticks>before,before),'Code keeps playing after '+file.name);
    assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
    assert(await evaluate(page,()=>__livePreset===__liveIdentity&&__livePreset.context.boots===1&&__livePreset.prepared.visits===__livePreset.ticks));
    result.signals.push({file:file.name,signal:await sounding(page)});
  }
  await chip(page,'fm');await page.locator('#presetSelect').selectOption('sine');await ready(page);await sounding(page);
  assert(await evaluate(page,()=>__livePreset===__liveIdentity&&__livePreset.context.boots===1));
  const commands=await evaluate(page,()=>__synthCodeAudit.drain());
  assert(!commands.some(command=>command.op==='live-fx'&&command.action==='dispose'),'Presets keep the same FX graph');
  await stop(page);result.steps.push('FM / PSG / PCM Files presets and the FM preset dropdown preserve Run, context, livePrepare and software FX; explicit Stop still silences output');
  assert(await evaluate(page,()=>__synthCodeAudit.muted()));return result;
}
function keyboardSource(kind,{held=false}={}) {
  const chip={fm:'ym2612',psg:'segapsg',pcm:'rf5c164'}[kind];
  // A PSG level is also its gate. Keep its parameter-only loop on a muted
  // tone's period instead of accidentally starting a fourth test melody.
  const parameter={fm:'sound.write(0,0x4c,16+(prepared.ticks%2));',psg:'sound.setFrequency(2,500+prepared.ticks%7);',pcm:'sound.setChannel(0,{volume:64+(prepared.ticks%2)});'}[kind];
  return `const sound=await useSoundChip('${chip}');
context.boots=(context.boots??0)+1;
const prepared=await livePrepare('keyboard-proof',()=>({ticks:0}));
globalThis.__keyboardProbe={context,prepared,sound,on:(channel,note)=>sound.noteOn(channel,note),off:channel=>sound.noteOff(channel)};
liveFx('keyboard-level',{context:{gain:.5},process(input,output,state,context){for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*context.gain;}});
${held?"sound.noteOn(0,'A4');":''}
liveLoop('parameters',async()=>{prepared.ticks++;${parameter}await sleep(.07);});
`;
}
async function keyboardChecks(page,name) {
  const result={browser:name,steps:[],chips:[]};
  const running=async()=>{
    assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/,'Tabs and keyboard keep Code running');
    assert.equal(await page.locator('#synthCodeError').textContent(),'');
    assert(await evaluate(page,()=>__keyboardProbe===__keyboardIdentity&&__keyboardProbe.context.boots===1),'One Run, context, prepared value and chip facade survive');
  };
  const keyboard=async()=>{
    await page.locator('#synthInputKeyboardTab').click();
    await until(()=>page.locator('#synthInputKeyboardTab').getAttribute('aria-selected').then(value=>value==='true'),'Keyboard view flushes without stopping');
    assert(await page.locator('#synthCodeStopButton').isVisible(),'The shared Code Stop is reachable from Keyboard');
    await page.locator('#synthInputKeyboardTab').focus();
  };
  const press=async()=>{
    await page.keyboard.down('a');
    await until(()=>page.locator('#keyboard .key[data-key="a"]').getAttribute('class').then(value=>value.includes('is-active')),'A genuine keyboard press owns a note');
    const status=await page.locator('#status').textContent(),match=/channel (\d+)/i.exec(status);
    assert(match,'Keyboard reports its physical channel: '+status);
    return Number(match[1])-1;
  };
  const sameFrequency=(a,b,label)=>assert(Math.abs(a.left.frequency-b.left.frequency)<Math.max(3,a.left.frequency*.025),label+': '+JSON.stringify({before:a,after:b}));
  const begin=async(kind,held=false)=>{
    await code(page,keyboardSource(kind,{held}));await execute(page);
    await until(()=>evaluate(page,()=>__keyboardProbe.prepared.ticks>=2),'Parameter loop starts');
    await evaluate(page,()=>{window.__keyboardIdentity=__keyboardProbe;__synthCodeAudit.drain();});
    await keyboard();await running();
    return evaluate(page,()=>__synthCodeAudit.graph());
  };
  await range(page,'#masterVolumeRange',100);
  for(const kind of ['fm','psg','pcm']) {
    await chip(page,kind);
    if(kind==='fm'){await page.locator('#presetSelect').selectOption('sine');await ready(page);}
    if(kind==='psg'){
      if(await page.locator('#synthPsgEnvelopeEnabled').getAttribute('aria-pressed')==='true')await page.locator('#synthPsgEnvelopeEnabled').click();
      await field(page,'synthPsgAttenuation',6);
    }
    if(kind==='pcm'){
      await page.locator('[data-pcm-builtin="sine"]').click();await ready(page);
      for(const[id,value]of [['synthPcmVolume',64],['synthPcmPanLeft',15],['synthPcmPanRight',15],['synthPcmRootNote',60]])await field(page,id,value);
    }
    const row={chip:kind},graph=await begin(kind);
    assert.equal(graph.contexts,1,'All Code chips and Keyboard borrow one AudioContext');
    await silence(page);
    const before=await evaluate(page,()=>__keyboardProbe.prepared.ticks),channel=await press();
    assert.equal(channel,0,'A fresh performance starts its keyboard allocator at physical CH1');
    row.keyboard=await sounding(page);
    await until(()=>evaluate(page,before=>__keyboardProbe.prepared.ticks>=before+3,before),'Code parameter loop advances while Keyboard holds a note');
    await range(page,'#pitchBendWheel',1000);row.bent=await sounding(page);
    assert(Math.abs(row.bent.left.frequency/row.keyboard.left.frequency-2**(2/12))<.035,'Keyboard Pitch remains usable alongside Code '+kind+': '+JSON.stringify(row));
    await range(page,'#pitchBendWheel',0);sameFrequency(row.keyboard,await sounding(page),'Keyboard Pitch returns without restarting Code');
    await page.keyboard.up('a');await silence(page);await running();
    const commands=await evaluate(page,()=>__synthCodeAudit.drain());
    assert(!commands.some(item=>item.op==='live-fx'&&item.action==='dispose'),'Keyboard never disposes liveFx');
    assert(kind==='fm'?commands.some(item=>item.type==='write'&&item.register===0x4c):kind==='psg'?commands.some(item=>item.method==='write'&&(item.args?.[0]&0xf0)===0xc0):commands.some(item=>item.method==='writeRegister'&&item.args?.[0]===0&&[64,65].includes(item.args?.[1])),'The Code loop sends real non-gate hardware parameters '+kind);
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await running();
    await keyboard();await running();
    assert.deepEqual(await evaluate(page,()=>__synthCodeAudit.graph()),graph,'Code / Keyboard round trips do not create another graph or context');
    await stop(page);

    // Code owns CH1 first. Keyboard takes that very channel, then an old
    // Code Note Off must not release the newer physical keyboard note.
    await begin(kind,true);row.codeFirst=await sounding(page);
    assert.equal(await press(),0);row.keyboardTakeover=await sounding(page);
    assert(Math.abs(row.codeFirst.left.frequency-row.keyboardTakeover.left.frequency)>20,'The keyboard actually replaces the Code pitch on the same channel');
    await evaluate(page,()=>__keyboardProbe.off(0));row.afterOldCodeOff=await sounding(page);
    sameFrequency(row.keyboardTakeover,row.afterOldCodeOff,'Old Code Off cannot release or retune a Keyboard owner');
    await page.keyboard.up('a');await silence(page);await running();await stop(page);

    // The reverse direction: Code's new key owns the physical gate. A late
    // key-up, Pitch reset and window blur may clean only keyboard-owned gates.
    await begin(kind);assert.equal(await press(),0);await sounding(page);
    await evaluate(page,()=>__keyboardProbe.on(0,'G4'));row.codeTakeover=await sounding(page);
    assert(Math.abs(row.codeTakeover.left.frequency-391.9954)<12,'Code really retakes the selected physical voice '+kind);
    await page.keyboard.up('a');row.afterOldKeyUp=await sounding(page);sameFrequency(row.codeTakeover,row.afterOldKeyUp,'Old key-up cannot release a newer Code gate');
    row.blurKeyboardChannel=await press();
    assert.notEqual(row.blurKeyboardChannel,0,'Blur also has a separate real keyboard-owned gate to clean');
    await sounding(page);
    await range(page,'#pitchBendWheel',1000);await range(page,'#pitchBendWheel',0);
    await evaluate(page,()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('a');row.afterBlur=await sounding(page);
    sameFrequency(row.codeTakeover,row.afterBlur,'Keyboard Pitch and blur cleanup do not affect a Code-owned note');
    await running();await stop(page);row.stopped=true;
    assert.equal(await evaluate(page,()=>{try{__keyboardProbe.on(0,'A4');return 'accepted';}catch(error){return error.name;}}),'AbortError','Stopped Code handles cannot resurrect a note');
    await silence(page);result.chips.push(row);console.log('PASS '+name+' keyboard '+kind+': parameter loop, both gate-owner directions, Pitch / blur and shared Stop');
  }
  result.steps.push('FM / PSG / RF5C164 parameter loops and liveFx continue through Keyboard melody, Pitch and Code / Keyboard tab changes with one context and unchanged prepared state');
  result.steps.push('Both same-channel takeover directions honor the newest gate; old Code Off, key-up and blur cannot silence another owner; Keyboard-side Stop ends Run and real PCM');
  assert(await evaluate(page,()=>__synthCodeAudit.muted()));return result;
}
async function run(browser,name,origin){const {page,errors}=await open(browser,origin),steps=[],result={browser:name,steps};
  try{
    if(config.checks==='keyboard'){const checked=await keyboardChecks(page,name);assert.deepEqual(errors,[]);return checked;}
    if(config.checks==='live-presets'){const checked=await livePresetChecks(page,name);assert.deepEqual(errors,[]);return checked;}
    if(config.checks==='mixer'){const checked=await mixerChecks(page,name);assert.deepEqual(errors,[]);return checked;}
    if(config.checks==='pcm-notes'){const checked=await pcmNoteChecks(page,name);assert.deepEqual(errors,[]);return checked;}
    if(config.checks!=='all'){
      result.stopSignals=await stopSignalChecks(page,{baseline:config.checks==='baseline-stop'});assert.deepEqual(errors,[]);return result;
    }
    assert.equal(await page.locator('#synthInputKeyboardTab').getAttribute('aria-selected'),'true');assert(await page.locator('#synthCodePanel').isHidden());
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    const starter=await page.locator('#synthCodeEditor').inputValue();
    assert.match(starter,/const fm = await useSoundChip\("ym2612"\)/);assert.match(starter,/scale\("E1", "minorPentatonic", 3\)/);
    assert.match(starter,/fm\.noteOn\(CH1, choose\(notes\)\)/);assert.match(starter,/sleep\(0\.1\)/);assert.match(starter,/beat\(0\.025\)/);assert.doesNotMatch(starter,/\bplay\(/);
    await execute(page);await sounding(page);await stop(page);steps.push('The newly seeded index.js plays through its explicitly acquired FM client');
    await code(page,LOOP_SOURCE);await until(()=>page.locator('#synthCodeEditorNote').textContent().then(v=>/Fallback|Plain text|could not load/i.test(v)),'Monaco failure leaves textarea fallback');
    assert.equal(await page.locator('#synthActiveFilePath').textContent(),'/index.js');
    await page.locator('#synthCodeEditor').press('a');assert.equal(await page.locator('#keyboard .key.is-active').count(),0,'Typing never plays keyboard notes');await page.locator('#synthCodeEditor').fill(LOOP_SOURCE);
    await chip(page,'fm');await page.locator('#presetSelect').selectOption('sine');await ready(page);await range(page,'#masterVolumeRange',100);await execute(page);await sounding(page);
    await until(()=>page.locator('#synthCodeLog').textContent().then(v=>v.includes('apply-count 1')),'Run has fresh context');await pause(450);
    await page.locator('#synthCodeEditor').fill(LOOP_SOURCE);await execute(page,true);await until(()=>page.locator('#synthCodeLog').textContent().then(v=>v.includes('apply-count 2')),'Apply keeps context');await pause(500);
    const loops=await evaluate(page,()=>({...__codeProbe}));assert(loops.ticks>=3);assert.equal(loops.max,1,'Named Apply does not duplicate an existing loop');assert.match(await page.locator('#synthCodeState').textContent(),/1 loop/);
    await page.locator('#synthCodeEditor').fill(`context.applies++;log('removed-loop',context.applies);`);await execute(page,true);await silence(page);await until(()=>evaluate(page,()=>__codeProbe.active===0),'Removed loop releases its note');
    await stop(page);result.loops=loops;steps.push('Keyboard / Code tabs, lazy Monaco failure fallback, fresh Run / preserved Apply context, named-loop replacement / removal and Stop');

    await code(page,fxSource(null));await execute(page);const dry=await sounding(page);await range(page,'#masterVolumeRange',200);const twice=await reading(page);assert(Math.abs(twice.left.rms/dry.left.rms-2)<.15,'Master applies once');
    await range(page,'#masterVolumeRange',0);await silence(page);await range(page,'#masterVolumeRange',100);await sounding(page);
    await page.locator('#synthCodeEditor').fill(fxSource(.25));await execute(page,true);const quarter=await reading(page);assert(Math.abs(quarter.left.rms/dry.left.rms-.25)<.04,'liveFx has one wet route');
    await page.locator('#synthCodeEditor').fill(fxSource(.5));await execute(page,true);const half=await reading(page);assert(Math.abs(half.left.rms/dry.left.rms-.5)<.05);
    await page.locator('#synthCodeEditor').fill(fxSource(null));await execute(page,true);const restored=await reading(page);assert(Math.abs(restored.left.rms/dry.left.rms-1)<.08,'Removing effect restores one dry route');
    await page.locator('#synthCodeEditor').fill(`context.heldApply=(context.heldApply??0)+1;log('held-apply',context.heldApply);liveLoop('hold',async()=>{await sleep(1);});`);
    await execute(page,true);const heldApply=await sounding(page);assert(Math.abs(heldApply.left.rms/restored.left.rms-1)<.08,'Apply without another Note On keeps an existing held FM voice: '+JSON.stringify({restored,heldApply,commands:await evaluate(page,()=>__synthCodeAudit.drain())}));
    const originalCode=await page.locator('#synthCodeEditor').inputValue();
    await evaluate(page,()=>{window.__sameCodeEditor=document.getElementById('synthCodeEditor');});
    await page.locator('#synthCodeExpandButton').click();assert.equal(await page.locator('#synthCodeExpandButton').getAttribute('aria-pressed'),'true');
    assert(await page.locator('.synth-editor').isHidden());assert(await page.locator('#synthFilesPanel').isVisible());
    assert.equal(await page.locator('#synthExpandedCodeSlot #synthCodeEditor').inputValue(),originalCode);
    assert(await evaluate(page,()=>window.__sameCodeEditor===document.getElementById('synthCodeEditor')),'Expansion keeps the same editor node');
    const fileBox=await page.locator('#synthFilesPanel').boundingBox(),codeBox=await page.locator('#synthExpandedCodeSlot').boundingBox();
    assert(fileBox.x+fileBox.width<codeBox.x,'Expanded Code is next to Files');
    const expandedSound=await sounding(page);assert(Math.abs(expandedSound.left.rms/heldApply.left.rms-1)<.08,'Expansion keeps held audio');
    await fs.mkdir(config.screenshots,{recursive:true});
    for(const width of [1240,390]){
      await page.setViewportSize({width,height:1100});await page.locator('#synthCodeExpandButton').scrollIntoViewIfNeeded();await pause(120);
      assert(await evaluate(page,()=>document.documentElement.scrollWidth<=innerWidth+1),'Expanded layout fits viewport '+width);
      await page.screenshot({path:path.join(config.screenshots,`${name}-synth-code-expanded-${width}.png`)});
    }
    await page.setViewportSize({width:1240,height:1100});await page.locator('#synthCodeExpandButton').click();
    assert(await page.locator('.synth-editor').isVisible());assert.equal(await page.locator('#synthCodeExpandButton').getAttribute('aria-pressed'),'false');
    assert(await evaluate(page,()=>window.__sameCodeEditor===document.getElementById('synthCodeEditor')));await sounding(page);
    steps.push('Maximize / Restore keeps the same source, editor and live audio beside Files with desktop and mobile layouts');
    const upperTabs=[];
    for(const name of ['psg','pcm','fm']) {
      await chip(page,name);assert.equal(await page.locator('#synthInputCodeTab').getAttribute('aria-selected'),'true','Upper chip selection preserves Code input mode');
      assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/,'Upper chip selection preserves the Code session');
      const signal=await sounding(page);assert(Math.abs(signal.left.rms/heldApply.left.rms-1)<.1,'Changing the viewed editor does not cut or alter the held FM voice');upperTabs.push({chip:name,signal});
      assert(Math.abs(signal.left.frequency-heldApply.left.frequency)<2,'Returning to FM does not replace the held physical CH3 pitch with the authoring base frequency');
    }
    await stop(page);result.fx={dry,twice,quarter,half,restored};result.heldApply={signal:heldApply,upperTabs};
    await code(page,KEEP_FM+`liveFx('drive',{process(input,output){for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=Math.tanh(input[ch][i]*12)*0.2;}});`);
    await execute(page);const drive=await reading(page);await range(page,'#masterVolumeRange',200);const driveTwice=await reading(page);
    assert(Math.abs(driveTwice.left.rms/drive.left.rms-2)<.12,'Master is applied after nonlinear Code FX');
    await range(page,'#masterVolumeRange',100);await stop(page);result.fx.masterAfterFx={drive,driveTwice};
    steps.push('One System/Master path for shared editor audio; liveFx Apply updates context, removing effects restores the direct route, and held FM survives Apply plus upper editor tab changes');

    await chip(page,'psg');await field(page,'synthPsgAttenuation',6);await code(page,`const psg=await useSoundChip('segapsg');psg.tone(0,{note:'C4'});liveLoop('hold',async()=>{await sleep(1);});`);await execute(page);const psg=await sounding(page);
    await field(page,'synthPsgAttenuation',12);const attenuated=await reading(page);assert(Math.abs(attenuated.left.rms/psg.left.rms-Math.pow(10,-12/20))<.04,'Upper PSG attenuation updates Code tone');await stop(page);result.psg={psg,attenuated};
    await chip(page,'pcm');await page.locator('[data-pcm-builtin="sine"]').click();await field(page,'synthPcmVolume',64);await field(page,'synthPcmPanLeft',15);await field(page,'synthPcmPanRight',15);
    await code(page,`const pcm=await useSoundChip('rf5c164');pcm.keyOn(0);liveLoop('hold',async()=>{await sleep(1);});`);await execute(page);const pcm=await sounding(page);
    await field(page,'synthPcmVolume',32);const pcmHalf=await reading(page);assert(Math.abs(pcmHalf.left.rms/pcm.left.rms-.5)<.06,'Upper PCM Volume updates the same Code voice');
    await field(page,'synthPcmPanLeft',0);const right=await reading(page);assert(right.left.rms<1e-7&&right.right.rms>.001);
    await field(page,'synthPcmLoopEnd',180);const edited=await sounding(page);assert(edited.left.rms<1e-7&&edited.right.rms>.001,'End RAM edit keeps Code voice sounding');await stop(page);result.pcm={pcm,pcmHalf,right,edited};
    steps.push('PSG / PCM use the same authoring chips; upper attenuation, volume, pan and End controls alter the actual Code output');

    await chip(page,'pwm');assert.match(await page.locator('#synthChipPwm').textContent(),/Under construction/);await code(page,PWM_SOURCE);await execute(page);const pwm=await sounding(page);assert(pwm.left.rms>.001&&pwm.right.rms>.001);await stop(page);result.pwm=pwm;steps.push('PWM remains a placeholder editor while Code schedules real stereo PWM FIFO output');

    await chip(page,'fm');await code(page,`const fm=await useSoundChip('ym2612');globalThis.__oldCodeHandle=()=>fm.noteOn(0,4,644);fm.noteOn(0,4,644);liveLoop('hold',async()=>{await sleep(1);});`);await execute(page);await sounding(page);await stop(page);
    assert.equal(await evaluate(page,()=>{try{__oldCodeHandle();return 'accepted';}catch(error){return error.name;}}),'AbortError');await silence(page);
    await code(page,`const fm=await useSoundChip('ym2612');fm.noteOn(0,4,644);await new Promise(resolve=>{globalThis.__finishCode=resolve;});fm.noteOn(0,4,700);`);await page.locator('#synthCodeRunButton').click();await until(()=>evaluate(page,()=>typeof __finishCode==='function'),'Pending Code promise');await sounding(page);await stop(page);await evaluate(page,()=>__finishCode());await pause(200);await silence(page);assert.match(await page.locator('#synthCodeState').textContent(),/Stopped/);
    await code(page,KEEP_FM);await execute(page);await sounding(page);assert(await page.locator('#eventRecordStartButton').isDisabled(),'Event recording disabled while Code owns chips');assert(await page.locator('#looperStartButton').isDisabled(),'Looper disabled while Code owns chips');
    await page.locator('#synthCodeExpandButton').click();await page.locator('#synthInputKeyboardTab').click();await until(()=>page.locator('#synthInputKeyboardTab').getAttribute('aria-selected').then(v=>v==='true'),'Keyboard tab');await sounding(page);assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/,'Keyboard is another view of the running performance');
    assert(await page.locator('.synth-editor').isVisible());assert(await page.locator('#synthExpandedCodeSlot').isHidden(),'Keyboard restores the original layout');
    const keyboardKey=page.locator('#keyboard .key[data-key="a"]');await keyboardKey.scrollIntoViewIfNeeded();const keyBox=await keyboardKey.boundingBox();
    await page.mouse.move(keyBox.x+keyBox.width/2,keyBox.y+keyBox.height*.8);await page.mouse.down();await sounding(page);await page.mouse.up();await sounding(page);await stop(page);
    await code(page,KEEP_FM);await execute(page);await sounding(page);
    await page.locator('#tfiFile').setInputFiles({name:'Authored Code reference.vgm',mimeType:'application/octet-stream',buffer:authoredVgm()});await ready(page);await page.locator('#synthSongPlayButton').click();await until(()=>page.locator('#synthSongStatus').getAttribute('data-state').then(v=>v==='playing'),'VGM starts');assert.match(await page.locator('#synthCodeState').textContent(),/Stopped/);await page.locator('#synthSongStopButton').click();await page.locator('#synthSongChannelSelect').selectOption('synth');await silence(page);
    steps.push('Stopped handles and delayed promises cannot restart audio; Keyboard shares the running Code session; VGM still takes ownership and recording cannot collide with Code');

    await page.locator('#tfiFile').setInputFiles({name:'notes.js',mimeType:'text/javascript',buffer:Buffer.from(`export const pitch='D4';\n`)});await ready(page);await choose(page,'/index.js');
    const moduleSource=`const {pitch}=await import('./notes.js');const text=await file('./notes.js');log('module-note',pitch,text.includes('D4'));const fm=await useSoundChip('ym2612');fm.noteOn(0,pitch);liveLoop('module',async()=>{await sleep(1);});`;
    await page.locator('#synthCodeEditor').fill(moduleSource);await execute(page);await sounding(page);assert.match(await page.locator('#synthCodeLog').textContent(),/module-note D4 true/);await stop(page);
    await page.locator('#synthCodeEditor').fill(moduleSource+'\n// recovery-marker\n');await page.locator('#synthCodeEditor').press(process.platform==='darwin'?'Meta+s':'Control+s');await pause(650);await page.reload();await ready(page);await page.locator('#synthCodeEditor').waitFor({state:'visible'});assert((await page.locator('#synthCodeEditor').inputValue()).includes('recovery-marker'),'Code draft and path recover without automatic execution');assert.match(await page.locator('#synthCodeState').textContent(),/Idle|Stopped/);
    const archive=await download(page,'#exportCassetteButton'),contents=await loadCassette(archive.bytes),bytes=p=>contents.files.get(p.replace(/^\//,''));assert(Buffer.from(bytes('/index.js')).toString().includes('recovery-marker'));assert(Buffer.from(bytes('/notes.js')).toString().includes("'D4'"));
    await code(page,KEEP_FM);await execute(page);await sounding(page);
    await page.locator('#cassetteImportInput').setInputFiles({name:'Code roundtrip.cassette.zip',mimeType:'application/zip',buffer:archive.bytes});await ready(page);await silence(page);
    assert.equal(await page.locator('#synthInputKeyboardTab').getAttribute('aria-selected'),'true','Import retires Code before returning Keyboard ownership');
    await choose(page,'/index.js');assert((await page.locator('#synthCodeEditor').inputValue()).includes('recovery-marker'),'Cassette import keeps its index.js instead of seeding the starter');
    await page.locator('#synthFileRenameButton').click();await page.locator('#synthFileNameInput').fill('main.js');await page.locator('[data-file-name-confirm]').click();await ready(page);assert.equal(await page.locator('#synthActiveFilePath').textContent(),'/main.js');assert((await page.locator('#synthCodeEditor').inputValue()).includes('recovery-marker'));
    steps.push('Files JS import / selection, dynamic modules / file(), Cmd/Ctrl+S, local draft recovery, Cassette round trip and code rename preserve independent text and tone state');
    result.livePresets=await livePresetChecks(page,name);
    result.keyboard=await keyboardChecks(page,name);
    await fs.mkdir(config.screenshots,{recursive:true});
    for(const width of [1240,390]){await page.setViewportSize({width,height:1100});await page.locator('#synthInputCodeTab').scrollIntoViewIfNeeded();await pause(120);assert(await evaluate(page,()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow '+width);await page.screenshot({path:path.join(config.screenshots,`${name}-synth-code-${width}.png`)});}
    assert(await evaluate(page,()=>__synthCodeAudit.muted()));assert.deepEqual(errors,[]);result.expectedCdnFallback=true;return result;
  }finally{await page.close();}
}
(async()=>{({loadPlaygroundCassette:loadCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href));
  const {createSynthProject}=await import(pathToFileURL(path.join(repo,'docs/synth/synth_project.js')).href);
  const {createPsgPreset}=await import(pathToFileURL(path.join(repo,'docs/synth/synth_psg_preset.js')).href);
  const {createPcmBuiltinPreset}=await import(pathToFileURL(path.join(repo,'docs/synth/synth_pcm.js')).href);
  const project=createSynthProject(),fm={algorithm:7,feedback:2,operators:Array.from({length:4},(_,i)=>({dt:0,multi:1,tl:i===3?16:127,rs:0,ar:31,am:false,d1r:0,d2r:0,sl:0,rr:15,ssg:0}))};
  project.writeTone('/Live FM.vgi',fm);project.writeTone('/Live PSG.psg.json',createPsgPreset({attenuation:5}));project.writeTone('/Live PCM.pcm.json',createPcmBuiltinPreset('triangle'));
  livePresetFiles=project.fs.list().filter(file=>/^\/Live .+\.(vgi|psg\.json|pcm\.json)$/.test(file.path)).map(file=>({name:path.basename(file.path),mimeType:'application/octet-stream',buffer:Buffer.from(file.data)}));
  ({SYNTH_SONG_MIX_DEFAULTS:mixerDefaults}=await import(pathToFileURL(path.join(repo,'docs/synth/synth_song_mix_defaults.js')).href));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  try{for(const name of config.engines.split(',')){const browser=await bounded(({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})}),'launch '+name);try{results.push(await run(browser,name,origin));console.log('PASS '+name+': Synth Code, actual muted PCM, shared UI chips, FX, files and lifecycle');}finally{await browser.close();}}}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert(expectedCdn.length>0,'Monaco CDN fallback exercised');await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify({passed:true,root:config.root,entry:config.entry,checks:config.checks,checkerSha256:hash(await fs.readFile(__filename)),physicalOutputMuted:true,listeningPerformed:false,results,expectedBlockedMonacoCdn:expectedCdn,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))},null,2)+'\n');console.log('PASS receipt '+config.out);
})().catch(async error=>{console.error(error);process.exitCode=1;await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify({passed:false,root:config.root,entry:config.entry,checks:config.checks,checkerSha256:hash(await fs.readFile(__filename)),physicalOutputMuted:true,listeningPerformed:false,error:error.stack??String(error),assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))},null,2)+'\n');});
