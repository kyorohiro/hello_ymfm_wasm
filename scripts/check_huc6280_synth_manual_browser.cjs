// SPDX-License-Identifier: BSD-3-Clause
const {selectHucChannel}=require('./huc6280_channel_browser_helpers.cjs');
// Focused one-chip HuC6280 Code/manual checks, with all destinations muted before JS.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-huc6280/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'huc6280-synth-manual-browser.json'),screenshots:path.join(tmpdir(),'huc6280-synth-manual-images')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map(),missing=[],external=[],httpErrors=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function until(check,label,ms=25000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await wait(30);}throw Error('Timeout: '+label);}

function installSilentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const contexts=[],nodes=[],meters=[],commands=[];let request=0;
  const compact=value=>{
    if(typeof value==='string'&&value.length>512)return{stringLength:value.length};
    if(ArrayBuffer.isView(value))return{type:value.constructor.name,length:value.length};
    if(Array.isArray(value))return value.length>128?{arrayLength:value.length}:value.map(compact);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,compact(item)]));
    return value;
  };
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(message,...args){
    if(message?.method){commands.push({method:message.method,args:compact(message.args??[])});if(commands.length>1500)commands.shift();}
    return post.call(this,message,...args);
  };
  const muted=()=>meters.every(item=>item.mute.gain.value===0);
  function sample(item){
    const values=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(values);
    let sum=0,square=0,peak=0;for(const value of values){sum+=value;square+=value*value;peak=Math.max(peak,Math.abs(value));}
    return{rms:Math.sqrt(square/values.length),acRms:Math.sqrt(Math.max(0,square/values.length-(sum/values.length)**2)),peak,finite:values.every(Number.isFinite)};
  }
  const output=()=>{
    const active=meters.filter(item=>item.source.context.state==='running').map(sample).sort((a,b)=>b.acRms-a.acRms);
    return{...(active[0]??{rms:0,acRms:0,peak:0,finite:true}),muted:muted()};
  };
  async function read(method='read',args=[]){
    const node=nodes.findLast(item=>item.name==='tetorica-huc6280-synth')?.node;if(!node)throw Error('HuC6280 editor Worklet missing');
    const id=--request;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('HuC6280 audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Object.assign(Error(data.error),{name:data.name??'Error'})):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});
    });
  }
  window.__hucCodeAudit={read,output,graph:()=>({contexts:contexts.length,editorWorklets:nodes.filter(item=>item.name==='tetorica-huc6280-synth').length,destinationConnections:meters.length,muted:muted()}),drain:()=>commands.splice(0)};
}
const read=(page,method='read',args=[])=>page.evaluate(({method,args})=>__hucCodeAudit.read(method,args),{method,args});
const observe=page=>read(page,'observeCode'),graph=page=>page.evaluate(()=>__hucCodeAudit.graph());
async function pcm(page,nonzero=true){let value;await until(async()=>{value=await page.evaluate(()=>__hucCodeAudit.output());return value.finite&&value.muted&&(nonzero?value.acRms>.00005:value.peak<1e-7);},nonzero?'actual HuC6280 PCM':'muted source silence');return value;}
async function files(page){if(await page.locator('#hucFilesPanel').isHidden())await page.locator('#hucFilesToggle').click();await until(()=>page.locator('#hucFileImportButton').isEnabled(),'Files ready');}
async function selectFile(page,filename,{code=false}={}){
  await files(page);for(let n=0;n<16;n++){const closed=page.locator('#hucFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#hucFilesTree button[data-file-path]').locator(`xpath=self::*[@data-file-path=${JSON.stringify(filename)}]`).click();
  await until(()=>page.locator('#hucFilesSelected').textContent().then(text=>text===filename),'selected '+filename);
  if(code)await page.locator('#synthInputCodeTab').click();
}
async function source(page,text){await selectFile(page,'/index.js',{code:true});await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(text);}
async function execute(page,apply=false){await page.locator(apply?'#synthCodeApplyButton':'#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());},apply?'Apply':'Run');}
async function stop(page){await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(text=>/Stopped|Idle/.test(text)),'Code stopped');await wait(130);await pcm(page,false);}
const sine=Array.from({length:32},(_,i)=>Math.round(15.5+15.5*Math.sin(i*Math.PI/16)));
const LOOP=`const pce=await useSoundChip('huc6280');
setBpm(120);
const motion=await livePrepare('manual-browser',async()=>{
  await pce.initialize();await pce.setMasterVolume(15,15);
  for(const ch of [CH1,CH3,CH5]){
    await pce.setWaveform(ch,${JSON.stringify(sine)});
    await pce.setVolume(ch,20);await pce.setPan(ch,15,15);
  }
  return {ticks:0};
});
context.starts=(context.starts??0)+1;
globalThis.__hucManual={pce,motion,context};
liveLoop('melody',async()=>{
  motion.ticks++;await pce.noteOn(CH3,motion.ticks%2?'E3':'B3');
  await sleep(.08);await pce.noteOff(CH3);await beat(.125);
});
`;
const period=registers=>(registers[2]|(registers[3]&15)<<8)||4096;
const ticks=page=>page.evaluate(()=>__hucManual.motion.ticks);
const commands=page=>page.evaluate(()=>__hucCodeAudit.drain());
const channel=async(page,value)=>{await selectHucChannel(page,String(value));await until(()=>page.locator('#hucCodeLiveTools').getAttribute('data-channel').then(v=>v===String(value)),'selected CH');};
async function progressing(page,before=0){await until(()=>ticks(page).then(n=>n>before),'independent melody keeps ticking');assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);}
async function idleHand(page){await until(async()=>!(await read(page)).voices.some(v=>String(v.id).startsWith('huc6280-synth:')),'hand note retired');}
async function computerDown(page,key='a'){
  await page.locator('#synthTitle').click();await page.keyboard.down(key);
  await until(async()=>(await read(page)).voices.some(v=>String(v.id).startsWith('huc6280-synth:')),'computer-key voice');
}
async function bend(page,value){await page.locator('#pitchBend').evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function check(browser,name,origin,fixture){
  const page=await browser.newPage({viewport:{width:1240,height:1050},serviceWorkers:'block'}),errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(25000);await page.addInitScript(installSilentAudit);
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  const step=text=>{stage=text;checks.push(text);console.log(`CHECK ${name}: ${text}`);};
  try{
    await page.goto(origin+config.entry);await files(page);
    await page.locator('#presetFileInput').setInputFiles({name:'manual-wave.huc6280.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.wave))});
    await source(page,LOOP);await execute(page);await progressing(page);await pcm(page);
    await page.evaluate(()=>{globalThis.__manualMotionBefore=__hucManual.motion;globalThis.__manualContextBefore=__hucManual.context;});

    step('Code keeps one loop/context/Worklet through repeated Keyboard/Code and physical/common view switches');
    let count=await ticks(page),frame=(await observe(page)).positionFrames;await commands(page);
    for(const value of ['0','synth','4','0']){
      await page.locator('#synthInputKeyboardTab').click();await channel(page,value);await page.locator('#synthInputCodeTab').click();
    }
    await progressing(page,count);assert((await observe(page)).positionFrames>frame);
    assert(await page.evaluate(()=>__manualMotionBefore===__hucManual.motion&&__manualContextBefore===__hucManual.context&&__hucManual.context.starts===1));
    assert(!(await commands(page)).some(c=>['stop','beginCode','loadPreset','setPreset'].includes(c.method)));
    assert.deepEqual(await graph(page),{contexts:1,editorWorklets:1,destinationConnections:1,muted:true});

    step('In Code view, selected-CH knobs and body computer keys play while editor text keeps its keystrokes');
    await channel(page,0);const before=await observe(page);await page.locator('[data-stepper-for="volume"][data-stepper-delta="1"]').click();
    await until(async()=>((await observe(page)).registers[0][4]&31)===21,'manual volume CH1');
    assert.equal((await observe(page)).registers[4][4]&31,before.registers[4][4]&31);
    count=await ticks(page);await computerDown(page);assert.equal((await read(page)).voices.find(v=>String(v.id).startsWith('huc6280-synth:')).channel,0);
    await page.keyboard.up('a');await idleHand(page);await progressing(page,count);
    const editor=page.locator('#synthCodeEditor');await editor.focus();await editor.press('End');await commands(page);await page.keyboard.type(' // asdf');await wait(100);
    assert.match(await editor.inputValue(),/\/\/ asdf/);assert(!(await commands(page)).some(c=>c.method==='noteOn'),'typing source never creates a hand voice');
    assert(!(await read(page)).voices.some(v=>String(v.id).startsWith('huc6280-synth:')));
    await page.locator('#instrumentName').focus();await commands(page);await page.keyboard.press('a');assert(!(await commands(page)).some(c=>c.method==='noteOn'),'instrument text is not a key');
    await page.locator('#synthTitle').click();

    step('A later Code note or frequency wins over old hand keyup and Pitch recenter without stopping the loop');
    await computerDown(page);await bend(page,1);await page.evaluate(()=>__hucManual.pce.noteOn(0,'A4'));
    const replacement=await observe(page);await page.keyboard.up('a');await bend(page,0);await wait(100);
    let state=await observe(page);assert(state.registers[0][4]&128);assert.equal(period(state.registers[0]),period(replacement.registers[0]));
    await computerDown(page);await bend(page,1);await page.evaluate(()=>__hucManual.pce.setFrequency(0,330));const changed=await observe(page);
    await bend(page,0);assert.equal(period((await observe(page)).registers[0]),period(changed.registers[0]),'manual Pitch reset cannot undo Code frequency');
    await page.keyboard.up('a');await page.evaluate(()=>__hucManual.pce.noteOn(0,'E4'));await progressing(page);

    step('Noise, hardware LFO and loaded DDA hand voices share the running Code chip');
    await page.evaluate(()=>__hucManual.pce.setNoise(4,{enabled:true,frequency:11}));await channel(page,4);await computerDown(page);state=await observe(page);assert(state.registers[4][7]&128);assert(state.registers[4][4]&128);
    await page.keyboard.up('a');await page.evaluate(async()=>{const p=__hucManual.pce;await p.setWaveform(1,Array.from({length:32},(_,i)=>i));await p.setVolume(1,0);await p.setFrequency(1,110);await p.setLfo({frequency:8,depth:2,reset:false});});
    await channel(page,0);await computerDown(page);const lfoBefore=await observe(page);assert.equal(lfoBefore.globals[9]&3,2);await page.keyboard.up('a');assert.equal((await observe(page)).globals[8],8);
    await page.evaluate(()=>__hucManual.pce.setLfo({frequency:0,depth:0,reset:false}));count=await ticks(page);
    await page.locator('#presetFileInput').setInputFiles({name:'manual-dda.huc6280.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.dda))});
    await until(async()=>(await read(page)).preset.source==='dda','DDA preset keeps Code');await progressing(page,count);await channel(page,0);await computerDown(page);
    state=await observe(page);assert(state.registers[0][4]&64);assert(state.ddaVoices[0]);measurements.dda=await pcm(page);
    await page.evaluate(()=>__hucManual.pce.noteOn(0,'G4'));const ddaCode=await observe(page);await page.keyboard.up('a');await bend(page,0);assert((await observe(page)).ddaVoices[0]);assert.equal((await observe(page)).ddaVoices[0].sampleRate,ddaCode.ddaVoices[0].sampleRate);
    assert(await page.evaluate(()=>__manualMotionBefore===__hucManual.motion&&__manualContextBefore===__hucManual.context),'source changes keep the original context and prepared loop state');

    step('Octave and blur remove released hand tails while retaining later Code gates and the active loop');
    await page.locator('#presetFileInput').setInputFiles({name:'manual-tail.huc6280.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.tail))});
    await until(async()=>(await read(page)).preset.source==='wave','release preset');await channel(page,0);await page.locator('#synthInputKeyboardTab').click();
    const pointer=page.locator('#keyboard .key:not([disabled])').first();await pointer.scrollIntoViewIfNeeded();let box=await pointer.boundingBox();assert(box);
    await page.mouse.move(box.x+box.width/2,box.y+box.height*.7);await page.mouse.down();await until(async()=>(await read(page)).voices.some(v=>String(v.id).startsWith('huc6280-synth:')),'pointer hand');await page.mouse.up();
    await until(async()=>(await read(page)).tails.some(v=>v.channel===0),'long release tail');count=await ticks(page);await page.locator('#octaveUp').click();
    assert(!(await read(page)).tails.some(v=>v.channel===0),'Octave clears already-released hand tail');await progressing(page,count);
    await computerDown(page);await page.evaluate(()=>__hucManual.pce.noteOn(0,'B4'));const newer=await observe(page);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('a');await wait(100);
    state=await observe(page);assert(state.registers[0][4]&128);assert.equal(period(state.registers[0]),period(newer.registers[0]));await progressing(page);

    step('Explicit Stop fences old Code clients and fits Code/manual controls at1240/390 without new audio routes');
    await page.locator('#synthInputCodeTab').click();await stop(page);assert.equal(await observe(page),null);
    assert.equal(await page.evaluate(async()=>{try{await __hucManual.pce.noteOn(0,'C5');return'allowed';}catch(e){return e.name;}}),'AbortError');
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});}
    measurements.graph=await graph(page);assert.deepEqual(measurements.graph,{contexts:1,editorWorklets:1,destinationConnections:1,muted:true});assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    return{browser:name,passed:true,checks,measurements,graph:measurements.graph,pageErrors:errors,consoleErrors};
  }catch(error){
    const diagnostic={stage,codeState:await page.locator('#synthCodeState').textContent().catch(()=>''),codeError:await page.locator('#synthCodeError').textContent().catch(()=>''),status:await page.locator('#audioStatus').textContent().catch(()=>''),commands:await commands(page).catch(()=>[])};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});
    error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors:errors,consoleErrors};throw error;
  }finally{await page.close();}
}
const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);res.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const[{createDefaultPreset},{encodeDdaData}]=await Promise.all([import(pathToFileURL(path.join(repo,'docs/synth-huc6280/preset.js')).href),import(pathToFileURL(path.join(repo,'docs/synth-huc6280/dda_pcm.js')).href)]);
  const wave=createDefaultPreset();wave.name='Manual original Wave';wave.envelope.enabled=false;
  const dda=structuredClone(wave);dda.name='Manual original DDA';dda.source='dda';dda.dda={name:'manual-five-bit.pcm',data:encodeDdaData(Uint8Array.from({length:1024},(_,i)=>sine[i%32])),sampleRate:8192,rootNote:60,loop:true,speed:1};
  const tail=structuredClone(wave);tail.name='Manual release';tail.envelope={enabled:true,attack:0,decay:0,sustain:1,release:2};
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
      try{results.push(await check(browser,name,origin,{wave,dda,tail}));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);assert(blockedMonaco.length,'fallback editor exercised');
  }catch(error){failure=error;}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,checkerSha256:hash(await fs.readFile(__filename)),results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
