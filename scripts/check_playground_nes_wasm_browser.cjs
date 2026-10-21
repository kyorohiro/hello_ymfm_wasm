// Real Playground Main/Worker -> NES/FDS WASM Worklet -> final Web Audio PCM.
// Native IPC is not used. Headless browser output is measured; no microphone.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const os=require('node:os');
const {chromium,webkit}=require('playwright');
const rootOption=process.argv.find(value=>value.startsWith('--root='));
const packageOption=process.argv.find(value=>value.startsWith('--package='));
if(rootOption&&packageOption)throw Error('Choose --root or --package');
const servedRoot=packageOption?path.resolve(packageOption.slice(10)):rootOption?path.resolve(rootOption.slice(7)):path.resolve(__dirname,'../docs');
const entry=packageOption?'/nested/consumer/index.html':rootOption?'/index.html':'/playground/index.html';
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml'};
const accessor='\nwindow.__nesWasmTest={runtime,megaDrive,setSource:value=>editorAdapter.setValue(value)};';
const audit=`
const originalRegisterProcessor=globalThis.registerProcessor;
globalThis.registerProcessor=(name,Type)=>{
  if(name==='tetorica-nes'||name==='tetorica-soundchip'){
    const process=Type.prototype.process;
    Type.prototype.process=function(...args){
      if(this.chip&&!this.__nesWasmAudit&&(name==='tetorica-nes'||this.name==='nes')){this.__nesWasmAudit=true;this.port.postMessage({type:'nes-wasm-audit',processor:name,backend:this.chip.backend,clock:this.chip.clock});}
      return process.apply(this,args);
    };
  }
  return originalRegisterProcessor(name,Type);
};
`;
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(packageOption&&pathname===entry){response.setHeader('Content-Type','text/html');response.end(packageHtml);return;}
    if(packageOption&&pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    if(packageOption&&!pathname.startsWith('/vendor/'))throw Error('Only packaged files are served');
    let file=path.resolve(servedRoot,packageOption?pathname.slice('/vendor/'.length):'.'+pathname);
    if(!file.startsWith(servedRoot+path.sep))throw Error('Invalid path');
    if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
    let body=await fs.readFile(file);
    if(pathname.endsWith('/playground.js'))body=Buffer.from(body.toString()+accessor);
    if(pathname.endsWith('/playground_nes_worklet.js')||pathname.endsWith('/soundchip-output-worklet.js'))body=Buffer.from(audit+body.toString());
    response.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');response.end(body);
  }catch(error){response.writeHead(404).end(String(error));}
});
function observeWorklets(){
  globalThis.__nesWasmNodes=[];globalThis.__nesWasmAudits=[];
  const Type=globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode=new Proxy(Type,{construct(Type,args,Target){
    const node=Reflect.construct(Type,args,Target);
    globalThis.__nesWasmNodes.push(args[1]);
    if(args[1]==='tetorica-nes'||args[1]==='tetorica-soundchip'){
      node.port.addEventListener('message',({data})=>{if(data?.type==='nes-wasm-audit')globalThis.__nesWasmAudits.push(data);});
      node.port.start();
    }
    return node;
  }});
}
const packageHtml=`<!doctype html><meta charset="utf-8"><button id="start">Initialize NES WASM</button>
<script type="module">
import {Playground} from '/vendor/playground_runtime.js';
import {createSoundChip} from '/vendor/soundchip.js';
import {NesApuSynth,NesApuDirectTransport,NesApuWorkletTransport} from '/vendor/nesapusynth.js';
const logs=[],runtime=Playground({chip:'nes',guardExecution:true,onLog:line=>logs.push(line)});
window.test={runtime,logs};
document.getElementById('start').onclick=async()=>{
  try{
    await runtime.initialize();
    const direct=await createSoundChip('nes',{fds:true,sampleRate:48000});
    try{
      const synth=new NesApuSynth({transport:new NesApuDirectTransport(direct)});synth.fds.noteOn('A4');
      const pcm=direct.generateStereo(4096);window.test.direct={backend:direct.backend,frames:pcm.left.length,peak:pcm.left.reduce((peak,value)=>Math.max(peak,Math.abs(value)),0)};
    }finally{direct.dispose();}
    const mega=runtime.megaDrive,context=mega.audioContext,splitter=context.createChannelSplitter(2),sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);
    const meters=[context.createAnalyser(),context.createAnalyser()];meters.forEach((meter,index)=>{meter.fftSize=8192;splitter.connect(meter,index);meter.connect(sink);});
    mega.audio.connectOutputMonitor(splitter);window.__nesWasmMeters=meters;
    window.test.generic=async()=>{
      const meter=context.createAnalyser();meter.fftSize=4096;meter.connect(sink);
      const endpoint=await createSoundChip('nes',{execution:'worklet',audioContext:context,outputNode:meter,fds:true,gain:1});
      const transport=new NesApuWorkletTransport(endpoint),synth=new NesApuSynth({transport});
      try{
        synth.fds.noteOn('A4');await transport.start();await new Promise(resolve=>setTimeout(resolve,250));
        const samples=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(samples);
        return {rms:Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length),state:await endpoint.request('getState')};
      }finally{await endpoint.dispose();meter.disconnect();}
    };
    window.test.ready=true;
  }catch(error){window.test.error=String(error.stack||error);}
};
</script>`;
async function checkPackageBrowser(name,type,url,out){
  const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
  try{
    const page=await browser.newPage({serviceWorkers:'block'}),errors=[],missing=[],requests=[];
    await page.addInitScript(observeWorklets);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
    page.on('request',request=>{if(request.url().includes('nesapu_wasm'))requests.push(request.url());});
    await page.goto(url);await page.waitForFunction(()=>window.test);
    await page.click('#start');await page.waitForFunction(()=>window.test.ready||window.test.error);
    assert.equal(await page.evaluate(()=>window.test.error),undefined);
    const direct=await page.evaluate(()=>window.test.direct);assert.equal(direct.backend,'wasm');assert.equal(direct.frames,4096);assert(direct.peak>.001);
    const results=[];
    for(const execution of ['main','worker']){
      const token='NPM_NES_'+execution;
      await page.evaluate(async({execution,token})=>window.test.runtime.playSource(`nes.reset();nes.pulse.setVoice(0,{volume:10,duty:0.5});nes.pulse.noteOn(0,'A4');console.log(${JSON.stringify(token)});`,{execution}),{execution,token});
      await page.waitForFunction(token=>window.test.logs.some(line=>line.includes(token)),token);
      const lead=execution==='worker'?await page.evaluate(()=>window.test.runtime.getTiming().workerLookaheadSeconds*1000):0;
      await page.waitForTimeout(lead);
      results.push({execution,pulse:await audible(page,'npm '+execution+' pulse',440)});
      await page.evaluate(()=>window.test.runtime.stopWithFade());
    }
    const generic=await page.evaluate(()=>window.test.generic());
    assert(generic.rms>.0002,'Installed generic NES Worklet must generate PCM');assert.equal(generic.state.backend,'wasm');
    const auditResult=await page.evaluate(()=>({nodes:window.__nesWasmNodes,audits:window.__nesWasmAudits}));
    assert(auditResult.audits.some(value=>value.processor==='tetorica-nes'&&value.backend==='wasm'));
    assert(auditResult.audits.some(value=>value.processor==='tetorica-soundchip'&&value.backend==='wasm'));
    assert(requests.every(value=>{const pathname=new URL(value).pathname;return pathname==='/vendor/nesapu_wasm.js'||pathname.startsWith('/vendor/generated/');}),'Default WASM asset URLs must stay inside the flat installed package: '+JSON.stringify(requests));
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    await page.evaluate(()=>window.test.runtime.finalize());
    await fs.writeFile(path.join(out,name+'-npm-nes-wasm.json'),JSON.stringify({passed:true,installedRoot:servedRoot,direct,generic,results,...auditResult,requests},null,2)+'\n');
    console.log(name+': PASS flat packaged NES WASM Direct, generic Worklet and Playground Main/Worker PCM/default asset URLs');
  }finally{await browser.close();}
}
async function runSource(page,source,execution){
  const marker='NES_WASM_RESULT_'+ ++runSource.sequence;
  await page.selectOption('#runFileSelect','/index.js');
  await page.evaluate(({source,execution,marker})=>{
    window.__nesWasmTest.setSource(source+'\nconsole.log('+JSON.stringify(marker)+');');
    document.getElementById('workerExecution').checked=execution==='worker';
  },{source,execution,marker});
  await page.click('#runButton');
  try {
    await page.waitForFunction(marker=>document.getElementById('consoleOutput').textContent.includes(marker)||window.__nesWasmTest.runtime.getState().audio==='error',marker);
    assert(await page.evaluate(marker=>document.getElementById('consoleOutput').textContent.includes(marker),marker),'Playback entered an error state');
  }
  catch(error){throw Error('Run failed ('+execution+'): '+JSON.stringify(await page.evaluate(()=>({console:document.getElementById('consoleOutput')?.textContent,status:[...document.querySelectorAll('[role=status]')].map(node=>node.textContent),body:document.body.innerText.slice(0,7000),state:window.__nesWasmTest.runtime.getState()}))),{cause:error});}
}
runSource.sequence=0;
const read=page=>page.evaluate(()=>window.__nesWasmTest.runtime.chipInspector.read('nes'));
async function untilState(page,predicate,label){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){const state=await read(page);if(predicate(state))return state;await page.waitForTimeout(20);}
  throw Error(label+' did not reach the applied NES snapshot: '+JSON.stringify(await read(page)));
}
async function installMeter(page){
  await page.evaluate(()=>{
    const synth=window.__nesWasmTest.runtime.megaDrive,context=synth.audioContext;
    const splitter=context.createChannelSplitter(2),sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);
    const meters=[context.createAnalyser(),context.createAnalyser()];
    meters.forEach((meter,index)=>{meter.fftSize=8192;splitter.connect(meter,index);meter.connect(sink);});
    synth.audio.connectOutputMonitor(splitter);
    window.__nesWasmMeters=meters;
  });
}
async function measure(page,wait=250){
  await page.waitForTimeout(wait);
  return page.evaluate(()=>window.__nesWasmMeters.map(meter=>{
    const pcm=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(pcm);
    const mean=pcm.reduce((sum,value)=>sum+value,0)/pcm.length;
    let square=0,peak=0;const crossings=[];
    for(let index=0;index<pcm.length;index++){
      square+=pcm[index]*pcm[index];peak=Math.max(peak,Math.abs(pcm[index]));
      if(index&&pcm[index-1]<mean&&pcm[index]>=mean)crossings.push(index-1+(mean-pcm[index-1])/(pcm[index]-pcm[index-1]));
    }
    return {rms:Math.sqrt(square/pcm.length),peak,hz:crossings.length>2?(crossings.length-1)*meter.context.sampleRate/(crossings.at(-1)-crossings[0]):0};
  }));
}
async function audible(page,label,hz){
  const values=await measure(page);
  assert(values.every(value=>Number.isFinite(value.rms)&&value.rms>.0002),label+': silent final PCM '+JSON.stringify(values));
  if(hz)assert(values.every(value=>Math.abs(value.hz-hz)<4),label+': wrong pitch '+JSON.stringify(values));
  return values;
}
async function stop(page){await page.evaluate(()=>window.__nesWasmTest.runtime.stopWithFade());await page.waitForFunction(()=>window.__nesWasmTest.runtime.getState().playback==='stopped');}
async function checkBrowser(name,type,url,out){
  const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
  try{
    const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1380,height:1100}});
    const errors=[],requests=[],missing=[];
    await page.addInitScript(observeWorklets);
    await page.route('**/vs/loader*.js',route=>route.abort());
    page.on('pageerror',error=>{errors.push(error.message);console.error(name+' page error: '+error.message);});
    page.on('request',request=>{if(request.url().includes('nesapu_wasm'))requests.push(request.url());});
    page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
    page.setDefaultTimeout(25000);
    await page.goto(url+'?mode=nes&no-sw=1');
    await page.waitForFunction(()=>window.__nesWasmTest);
    await page.locator('#startupNotice').waitFor({state:'hidden'});
    const wave=Array.from({length:64},(_,index)=>Math.round(31.5+31.5*Math.sin(index*Math.PI/32)));
    const results=[];
    for(const execution of ['main','worker']){
      await runSource(page,`nes.reset();nes.pulse.setVoice(0,{duty:0.5,volume:10});nes.pulse.noteOn(0,'A4');`,execution);
      if(!results.length)await installMeter(page);
      const lead=execution==='worker'?await page.evaluate(()=>window.__nesWasmTest.runtime.getTiming().workerLookaheadSeconds*1000):0;
      if(lead)await page.waitForTimeout(lead);
      const pulse=await audible(page,execution+' pulse',440);
      const prepared=await untilState(page,state=>state.channels[0].active,'pulse applied');
      assert.equal(prepared.channels.length,6);assert.equal(prepared.channels[0].volume,10);
      await runSource(page,`nes.pulse.keyOff(0);nes.fds.setWave(${JSON.stringify(wave)});nes.fds.setVolume(24,1);nes.fds.noteOn('A4');`,execution);
      if(lead)await page.waitForTimeout(lead);
      const fds=await audible(page,execution+' FDS',440);
      const state=await untilState(page,state=>state.fds.active&&state.fds.gain===24,'FDS applied');
      assert.deepEqual(state.fds.wave,wave);
      await runSource(page,`nes.fds.keyOff();await nes.dmc.loadSample(new Uint8Array(65).fill(0x96));nes.dmc.play({rate:15,loop:true,level:64});`,execution);
      if(lead)await page.waitForTimeout(lead);
      await audible(page,execution+' DMC');
      const dmc=await untilState(page,state=>state.dmc.active&&state.dmc.loaded,'DMC applied');
      assert.equal(dmc.dmc.length,65);
      await stop(page);
      const stopped=await untilState(page,state=>state.channels.every(channel=>!channel.active),'Stop all channels');
      assert.deepEqual(stopped.fds.wave,wave);assert(stopped.dmc.loaded,'Stop must retain uploaded DMC RAM');
      await runSource(page,`nes.pulse.noteOn(0,'C4');nes.pulse.keyOff(0);`,execution);
      await stop(page);
      results.push({execution,pulse,fds,workerLookaheadMs:lead});
    }
    // All six physical channels use the same WASM processor for Keyboard.
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:nes');
    const keyboard=[];
    for(const channel of [0,1,2,3,4,5]){
      await page.selectOption('#playgroundKeyboardTargetChannel',String(channel));await page.locator('#keyboardTab').focus();
      // D3 is within the pulse sweep unit's usable timer range with its default sweep register.
      await page.keyboard.down('q');await untilState(page,state=>state.channels[channel].active,'Keyboard channel '+channel);
      try{keyboard.push({channel,pcm:await audible(page,'Keyboard channel '+channel)});}
      catch(error){console.error('Keyboard PCM diagnostics: '+JSON.stringify(await page.evaluate(async()=>({applied:await window.__nesWasmTest.runtime.chipInspector.read('nes'),body:document.body.innerText.slice(-3000),audio:{master:window.__nesWasmTest.runtime.megaDrive.audio.masterOutputNode?.gain.value,input:window.__nesWasmTest.runtime.megaDrive.audio.masterInputNode?.gain?.value,output:window.__nesWasmTest.runtime.megaDrive.audio.outputNode?.gain?.value}}))));throw error;}
      await page.keyboard.up('q');await untilState(page,state=>!state.channels[channel].active,'Keyboard release '+channel);
    }
    await page.click('#nesTab');await page.locator('#nesPanel [data-nes-control="pulse-0-volume"]').waitFor();
    await page.locator('#nesPanel [data-nes-control="pulse-0-volume"]').evaluate(node=>{node.value='13';node.dispatchEvent(new Event('change',{bubbles:true}));});
    await untilState(page,state=>state.channels[0].volume===13,'Operators pulse edit');
    await page.click('#nesPanel [data-nes-channel="5"]');
    await page.locator('#nesPanel [data-nes-control="fds-gain"]').evaluate(node=>{node.value='19';node.dispatchEvent(new Event('change',{bubbles:true}));});
    await untilState(page,state=>state.fds.gain===19,'Operators FDS edit');
    const hold=page.locator('#nesPanel [data-nes-action="audition"]');await hold.scrollIntoViewIfNeeded();const rect=await hold.boundingBox();
    await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
    const operators=await audible(page,'Operators FDS Hold');
    await page.mouse.move(5,5);await page.mouse.up();await untilState(page,state=>!state.fds.active,'Operators release outside');
    await stop(page);
    const auditResult=await page.evaluate(()=>({nodes:window.__nesWasmNodes,audits:window.__nesWasmAudits}));
    assert(auditResult.audits.length>0,'The real NES Worklet must report its actual renderer');
    assert(auditResult.audits.every(value=>value.backend==='wasm'),'Every real NES Worklet must use the WASM backend');
    assert.equal(auditResult.nodes.filter(value=>value==='tetorica-nes').length,1,'Main, Worker, Keyboard and Operators must share one primary WASM chip');
    assert(!auditResult.nodes.some(value=>/ym2612|segapsg/.test(value)),'NES mode must not render hidden Genesis chips');
    assert(requests.some(value=>value.includes('/generated/nesapu_wasm.wasm')),'Real generated NES binary must be fetched');
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    await fs.writeFile(path.join(out,name+'-nes-wasm.json'),JSON.stringify({passed:true,nativeIpc:false,execution:['main','worker'],requests,...auditResult,results,keyboard,operators},null,2)+'\n');
    console.log(name+': PASS actual NES/FDS WASM Main/Worker pulse/FDS pitch and DMC PCM, six-channel Keyboard, Operators edits/audition, Stop/RAM retention; no Native IPC');
  }finally{await browser.close();}
}
(async()=>{
  const option=process.argv.find(value=>value.startsWith('--out='));
  const out=option?path.resolve(option.slice(6)):await fs.mkdtemp(path.join(os.tmpdir(),'playground-nes-wasm-'));
  await fs.mkdir(out,{recursive:true});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    const url='http://127.0.0.1:'+server.address().port+entry;
    for(const [name,type]of [['chromium',chromium],['webkit',webkit]])if(!process.argv.includes('--chromium')&&!process.argv.includes('--webkit')||process.argv.includes('--'+name))await (packageOption?checkPackageBrowser:checkBrowser)(name,type,url,out);
    console.log('Artifacts: '+out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
