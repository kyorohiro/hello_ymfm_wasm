// SPDX-License-Identifier: BSD-3-Clause
// Exercise real NES/FDS WASM behind zero-gain physical output routes.
// node scripts/check_2a03_synth_code_browser.cjs --engines=chromium,webkit
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {tmpdir}=require('node:os');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

const repo=path.resolve(__dirname,'..');
const config={root:path.join(repo,'docs'),entry:'/synth-2a03/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'2a03-synth-code-browser.json'),screenshots:path.join(tmpdir(),'2a03-synth-code-browser')};
for(const argument of process.argv.slice(2)){
  const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(argument);
  assert(match,'Unknown argument '+argument);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);
assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');
assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function until(predicate,label,timeout=20000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await predicate())return;await wait(30);}
  throw Error('Timeout: '+label);
}

function installSilentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext;
  const Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const audit=window.__nesCodeAudit={contexts:[],nodes:[],meters:[],commands:[],databases:[],sequence:0};
  const open=indexedDB.open.bind(indexedDB);
  indexedDB.open=(...args)=>{
    const request=open(...args);request.addEventListener('success',()=>audit.databases.push(request.result));return request;
  };
  window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{
    constructor(context,name,...args){super(context,name,...args);audit.nodes.push({node:this,name});}
  };
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();
    analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);
    audit.meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){
    if(data?.method){audit.commands.push({time:performance.now(),method:data.method,args:data.args});if(audit.commands.length>10000)audit.commands.shift();}
    return post.call(this,data,...args);
  };
  audit.read=(method='read',args=[])=>new Promise((resolve,reject)=>{
    const node=audit.nodes.findLast(item=>item.name==='tetorica-nes-fds-synth')?.node;
    if(!node){reject(Error('NES/FDS editor Worklet missing'));return;}
    const id=--audit.sequence;
    const timeout=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('NES audit read timed out'));},5000);
    function receive({data}){
      if(data?.id!==id)return;
      clearTimeout(timeout);node.port.removeEventListener('message',receive);
      data.error?reject(Error(data.error)):resolve(data.value);
    }
    node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});
  });
  audit.output=()=>{
    const values=audit.meters.filter(item=>item.source.context.state==='running').map(item=>{
      const samples=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(samples);
      let peak=0,square=0;for(const value of samples){peak=Math.max(peak,Math.abs(value));square+=value*value;}
      return{peak,rms:Math.sqrt(square/samples.length),finite:samples.every(Number.isFinite)};
    }).sort((a,b)=>b.rms-a.rms);
    return{...(values[0]??{peak:0,rms:0,finite:true}),muted:audit.meters.every(item=>item.mute.gain.value===0)};
  };
  audit.graph=()=>({contexts:audit.contexts.length,editorWorklets:audit.nodes.filter(item=>item.name==='tetorica-nes-fds-synth').length,
    destinationConnections:audit.meters.length,muted:audit.meters.every(item=>item.mute.gain.value===0)});
  audit.drain=()=>audit.commands.splice(0);
}
const read=page=>page.evaluate(()=>__nesCodeAudit.read());
async function pcm(page,nonzero=true){
  let value;
  await until(async()=>{value=await page.evaluate(()=>__nesCodeAudit.output());return value.finite&&value.muted&&(nonzero?value.rms>.0001:value.peak<1e-7);},nonzero?'actual NES PCM':'output silence');
  return value;
}
async function showFiles(page){
  if(await page.locator('#nesFilesPanel').isHidden())await page.locator('#nesFilesToggle').click();
  await until(()=>page.locator('#nesFileImportButton').isEnabled(),'Files ready');
}
async function selectFile(page,filename){
  await showFiles(page);
  for(let index=0;index<12;index++){
    const closed=page.locator('#nesFilesTree details:not([open]) > summary');
    if(!await closed.count())break;await closed.first().click();
  }
  await page.locator('#nesFilesTree button[data-file-path]').locator(`xpath=self::*[@data-file-path=${JSON.stringify(filename)}]`).click();
  await until(()=>page.locator('#nesFilesSelected').textContent().then(value=>value===filename),'selected '+filename);
}
async function source(page,value){
  await selectFile(page,'/index.js');await page.locator('#synthInputCodeTab').click();
  await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(value);
}
async function execute(page,apply=false){
  await page.locator(apply?'#synthCodeApplyButton':'#synthCodeRunButton').click();
  await until(async()=>{
    const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);
    return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());
  },apply?'Apply':'Run');
}
async function stop(page){
  await page.locator('#synthCodeStopButton').click();
  await until(async()=>!/Running|Playing|Stopping/.test(await page.locator('#synthCodeState').textContent()),'Code stopped');
  await until(async()=>!(await read(page)).codeActive,'physical Code session released');
  await wait(150);await pcm(page,false);
}
async function exportProject(page){
  if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
  const pending=page.waitForEvent('download');await page.locator('#nesProjectExportButton').click();
  const download=await pending,chunks=[];
  for await(const chunk of await download.createReadStream())chunks.push(chunk);
  return Buffer.concat(chunks);
}

const HOLD=`const nes=await useSoundChip('nes');
const {notes}=await import('./notes.mjs');
await livePrepare('all-channels',async()=>{
  await nes.pulse.setVoice(CH1,{duty:.25,volume:5});
  await nes.pulse.noteOn(CH1,notes[0]);await nes.noteOn(CH2,notes[1]);await nes.noteOn(CH3,notes[2]);
  await nes.noise.setVoice({volume:2,period:6});await nes.noise.noteOn();
  await nes.dmc.loadSample(new Uint8Array(257).fill(0xaa));await nes.dmc.play({rate:15,loop:true,level:64});
  await nes.fds.setWave(Array.from({length:64},(_,i)=>Math.round(31.5+31.5*Math.sin(i*Math.PI/32))));
  await nes.fds.setVolume(8);await nes.fds.noteOn('A3');return{ready:true};
});
context.runs=(context.runs??0)+1;globalThis.__nesProbe={nes,context};log('apply-count',context.runs);
`;
const MOTION=`const nes=await useSoundChip('nes');setBpm(120);
const motion=await livePrepare('motion',()=>({ticks:0}));
context.runs=(context.runs??0)+1;globalThis.__nesMotion={nes,motion,context};
liveLoop('melody',async()=>{
  motion.ticks++;await nes.noteOn(CH1,motion.ticks%2?'C4':'E4');
  await beat(.5);await nes.noteOff(CH1);await beat(.25);
});
`;

async function check(browser,name,origin,loadCassette){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'});
  const errors=[],missing=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('response',response=>{if(response.url().startsWith(origin)&&response.status()>=400)missing.push(response.url());});
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());return url.origin===origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();
  });
  await page.addInitScript(installSilentAudit);
  const step=value=>{stage=value;checks.push(value);console.log(name+': '+value);};
  try{
    await page.goto(origin+config.entry);
    await page.waitForFunction(()=>document.querySelector('#synthInputCodeTab')&&!document.querySelector('#synthInputCodeTab').disabled&&!document.querySelector('.nes-main').inert);
    await showFiles(page);
    step('Files and Code mount silently, with local modules and plain JSON');
    assert.equal((await page.evaluate(()=>__nesCodeAudit.graph())).contexts,0);
    await page.locator('#nesFilesInput').setInputFiles([
      {name:'notes.mjs',mimeType:'text/javascript',buffer:Buffer.from('export const notes=["A3","C4","E4"];\n')},
      {name:'data.json',mimeType:'application/json',buffer:Buffer.from('{"marker":"nes-code-files"}\n')},
    ]);
    await until(()=>page.locator('#nesFilesStatus').textContent().then(value=>/Added 2/.test(value)),'module and JSON imports');
    await selectFile(page,'/data.json');
    assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard');
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    assert.match(await page.locator('#synthCodeEditor').inputValue(),/nes-code-files/);
    assert(await page.locator('#synthCodeRunButton').isDisabled());
    assert.equal((await page.evaluate(()=>__nesCodeAudit.graph())).contexts,0);

    step('All six physical channels use the existing APU and produce finite PCM');
    await source(page,HOLD);await execute(page);await pcm(page);
    await until(async()=>{const state=await read(page);return state.codeActive&&state.owners.every(owner=>owner?.kind==='code');},'six Code channel owners');
    const originalSession=(await read(page)).codeSession;
    const graph=await page.evaluate(()=>__nesCodeAudit.graph());
    assert.equal(graph.contexts,1);assert.equal(graph.editorWorklets,1);assert.equal(graph.destinationConnections,1);assert(graph.muted);
    measurements.allChannels=await pcm(page);
    await execute(page,true);
    await until(()=>page.locator('#synthCodeLog').textContent().then(value=>/apply-count 2/.test(value)),'Apply kept context');
    assert.equal((await read(page)).codeSession,originalSession);
    await stop(page);

    step('A beat-based melody keeps running across view changes and manual parameter edits');
    await source(page,MOTION);await execute(page);
    await until(()=>page.evaluate(()=>__nesMotion.motion.ticks>=3),'three timed notes');
    const starts=await page.evaluate(()=>__nesCodeAudit.commands.filter(item=>item.method==='code'&&item.args[1]==='noteOn').slice(-3).map(item=>item.time));
    const intervals=starts.slice(1).map((value,index)=>value-starts[index]);
    assert(intervals.every(value=>value>200&&value<750),'120 BPM notes preserve beat timing');measurements.beatIntervalsMs=intervals;
    const before=(await read(page)).codeSession,ticks=await page.evaluate(()=>__nesMotion.motion.ticks);
    await page.locator('#synthInputKeyboardTab').click();
    assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
    await page.locator('[data-nes-channel="0"]').click();
    await page.locator('#pulseVolume').evaluate(node=>{for(let p=node.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
    await page.locator('[data-stepper-for="pulseVolume"][data-stepper-delta="-1"]').click();
    await until(()=>page.evaluate(previous=>__nesMotion.motion.ticks>previous,ticks),'melody after direct knob edit');
    assert.equal((await read(page)).codeSession,before);
    await page.locator('#synthInputCodeTab').click();
    assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
    await stop(page);

    step('Code automation and manual keyboard share the APU in both input views');
    await source(page,`const nes=await useSoundChip('nes');const motion=await livePrepare('knobs',()=>({ticks:0}));globalThis.__nesMotion={nes,motion};liveLoop('knobs',async()=>{motion.ticks++;await nes.pulse.setVoice(CH1,{duty:motion.ticks%2?.25:.5,volume:7});await beat(.125);});`);
    await execute(page);await pcm(page,false);
    await page.locator('#synthInputKeyboardTab').click();await page.keyboard.down('z');await pcm(page);
    await until(async()=>(await read(page)).voices.length===1,'manual key owner');
    const held=(await read(page)).voices[0].id;
    await page.locator('#synthInputCodeTab').click();assert.equal((await read(page)).voices[0].id,held);
    await page.keyboard.up('z');await pcm(page,false);
    await page.locator('#synthCodeEditor').focus();await page.keyboard.press('z');
    assert.equal((await read(page)).voices.length,0,'typing in Code stays outside keyboard notes');
    await page.locator('#synthInputCodeTab').click();await page.keyboard.down('z');await pcm(page);await page.keyboard.up('z');await pcm(page,false);

    step('Files preset selection keeps Code and hidden JSON keeps Keyboard mode');
    const preset=await page.evaluate(async()=>{
      const entry=document.querySelector('script[type="module"][src]').src;
      const {createDefaultPreset}=await import(new URL('preset.js',entry));
      const value=createDefaultPreset();value.name='Browser preset';value.pulse.volume=4;return value;
    });
    await page.locator('#nesFilesInput').setInputFiles({name:'Browser.nes.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(preset))});
    await until(()=>page.locator('#nesFilesStatus').textContent().then(value=>/Added 1/.test(value)),'preset imported');
    const previous=(await read(page)).codeSession,previousTicks=await page.evaluate(()=>__nesMotion.motion.ticks);
    await page.locator('#synthInputKeyboardTab').click();await selectFile(page,'/Browser.nes.json');
    await until(async()=>(await read(page)).preset.name==='Browser preset','selected portable preset');
    assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard');
    assert.equal((await read(page)).codeSession,previous);
    await until(()=>page.evaluate(value=>__nesMotion.motion.ticks>value,previousTicks),'Code after preset selection');
    await page.locator('#synthInputCodeTab').click();assert.match(await page.locator('#synthCodeEditor').inputValue(),/tetorica-nes-fds-voice/);
    await stop(page);

    step('Cassette restores local modules, sound and text without running Code');
    await source(page,HOLD);await page.keyboard.press('ControlOrMeta+s');await wait(200);
    const archive=await exportProject(page),cassette=await loadCassette(new Uint8Array(archive));
    assert.match(new TextDecoder().decode(cassette.files.get('notes.mjs')),/export const notes/);
    assert.equal(JSON.parse(new TextDecoder().decode(cassette.files.get('2a03-synth.project.json'))).settings.name,'Browser preset');
    await source(page,'// changed');
    await page.locator('#nesProjectFileInput').setInputFiles({name:'saved.cassette.zip',mimeType:'application/zip',buffer:archive});
    await until(()=>page.locator('#nesFilesStatus').textContent().then(value=>/project imported/.test(value)),'Cassette imported');
    await selectFile(page,'/index.js');assert.equal(await page.locator('#synthCodeEditor').inputValue(),HOLD);
    assert.equal((await read(page)).codeActive,false);await pcm(page,false);
    await page.evaluate(()=>__nesCodeAudit.databases.forEach(database=>database.close()));
    await page.locator('#synthCodeEditor').fill(HOLD+'// after reconnect\n');await page.keyboard.press('ControlOrMeta+s');await wait(250);
    await page.reload();await page.waitForFunction(()=>!document.querySelector('.nes-main').inert);
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    assert.match(await page.locator('#synthCodeEditor').inputValue(),/after reconnect/);
    assert.equal((await page.evaluate(()=>__nesCodeAudit.graph())).contexts,0,'saved projects restore without audio');

    step('Expanded Code stays visible beside Files at desktop and narrow widths');
    for(const width of [1240,390]){
      await page.setViewportSize({width,height:1050});await page.locator('#synthCodeExpandButton').click();
      assert(await page.locator('#synthExpandedCodeSlot #synthCodeEditor').isVisible());
      assert(await page.locator('#nesFilesPanel').isVisible());
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'expanded width '+width);
      await fs.mkdir(config.screenshots,{recursive:true});
      await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});
      await page.locator('#synthCodeExpandButton').click();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    return{browser:name,passed:true,checks,measurements,graph:await page.evaluate(()=>__nesCodeAudit.graph()),pageErrors:errors,missing};
  }catch(error){
    const diagnostic={stage,codeState:await page.locator('#synthCodeState').textContent().catch(()=>''),
      codeError:await page.locator('#synthCodeError').textContent().catch(()=>''),status:await page.locator('#audioStatus').textContent().catch(()=>''),
      commands:await page.evaluate(()=>__nesCodeAudit.drain()).catch(()=>[])};
    await fs.mkdir(config.screenshots,{recursive:true});
    await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});
    error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors:errors,missing};throw error;
  }finally{await page.close();}
}

const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json',
  '.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=new URL(request.url,'http://localhost').pathname;
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
    response.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');response.end(await fs.readFile(filename));
  }catch{response.writeHead(404).end('not found');}
});
(async()=>{
  const {loadPlaygroundCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port,results=[];let failure=null;
  try{
    for(const name of engines){
      const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
      try{results.push(await check(browser,name,origin,loadPlaygroundCassette));}
      catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}
      finally{await browser.close();}
    }
  }catch(error){failure=error;}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');
  if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
