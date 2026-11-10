// Public Synth Keyboard / Code integration. All speaker connections are
// intercepted before the app loads and physically pass through gain zero.
// Actual worklet output is measured only as numeric arrays; no listening.
// node scripts/check_synth_code_browser.cjs --root=release/itch_synth_dev --entry=/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',checks:'all',out:path.join(tmpdir(),'fm2612-synth-code-browser.json'),screenshots:path.join(tmpdir(),'fm2612-synth-code-browser')};
for(const arg of process.argv.slice(2)){const m=/^--(root|entry|engines|checks|out|screenshots)=(.+)$/.exec(arg);assert(m,'Unknown argument '+arg);config[m[1]]=m[2];}config.root=path.resolve(config.root);
assert(['all','stop','baseline-stop'].includes(config.checks));
assert(config.entry.startsWith('/'));assert(config.engines.split(',').every(name=>['chromium','webkit'].includes(name)));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=b=>createHash('sha256').update(b).digest('hex');
async function bounded(task,label,ms=30000){let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timeout '+label)),ms);})]);}finally{clearTimeout(timer);}}
const evaluate=(page,fn,arg)=>bounded(page.evaluate(fn,arg),'page evaluation');
async function until(test,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await pause(40);}throw Error(label);}
function installAudit(){
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,meters=[],commands=[];
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
  await until(()=>page.locator('#synthActiveFilePath').textContent().then(v=>v===file),'Files selects '+file);
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
let loadCassette;
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
async function run(browser,name,origin){const {page,errors}=await open(browser,origin),steps=[],result={browser:name,steps};
  try{
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
    await page.locator('#synthCodeExpandButton').click();await page.locator('#synthInputKeyboardTab').click();await until(()=>page.locator('#synthInputKeyboardTab').getAttribute('aria-selected').then(v=>v==='true'),'Keyboard tab');await silence(page);
    assert(await page.locator('.synth-editor').isVisible());assert(await page.locator('#synthExpandedCodeSlot').isHidden(),'Keyboard restores the original layout');
    const keyboardKey=page.locator('#keyboard .key[data-key="a"]');await keyboardKey.scrollIntoViewIfNeeded();const keyBox=await keyboardKey.boundingBox();
    await page.mouse.move(keyBox.x+keyBox.width/2,keyBox.y+keyBox.height*.8);await page.mouse.down();await sounding(page);await page.mouse.up();await silence(page);
    await code(page,KEEP_FM);await execute(page);await sounding(page);
    await page.locator('#tfiFile').setInputFiles({name:'Authored Code reference.vgm',mimeType:'application/octet-stream',buffer:authoredVgm()});await ready(page);await page.locator('#synthSongPlayButton').click();await until(()=>page.locator('#synthSongStatus').getAttribute('data-state').then(v=>v==='playing'),'VGM starts');assert.match(await page.locator('#synthCodeState').textContent(),/Stopped/);await page.locator('#synthSongStopButton').click();await page.locator('#synthSongChannelSelect').selectOption('synth');await silence(page);
    steps.push('Stopped handles and delayed promises cannot restart audio; Keyboard / VGM take ownership and recording cannot collide with Code');

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
    await fs.mkdir(config.screenshots,{recursive:true});
    for(const width of [1240,390]){await page.setViewportSize({width,height:1100});await page.locator('#synthInputCodeTab').scrollIntoViewIfNeeded();await pause(120);assert(await evaluate(page,()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow '+width);await page.screenshot({path:path.join(config.screenshots,`${name}-synth-code-${width}.png`)});}
    assert(await evaluate(page,()=>__synthCodeAudit.muted()));assert.deepEqual(errors,[]);result.expectedCdnFallback=true;return result;
  }finally{await page.close();}
}
(async()=>{({loadPlaygroundCassette:loadCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  try{for(const name of config.engines.split(',')){const browser=await bounded(({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})}),'launch '+name);try{results.push(await run(browser,name,origin));console.log('PASS '+name+': Synth Code, actual muted PCM, shared UI chips, FX, files and lifecycle');}finally{await browser.close();}}}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert(expectedCdn.length>0,'Monaco CDN fallback exercised');await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify({passed:true,physicalOutputMuted:true,listeningPerformed:false,results,expectedBlockedMonacoCdn:expectedCdn,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))},null,2)+'\n');console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
