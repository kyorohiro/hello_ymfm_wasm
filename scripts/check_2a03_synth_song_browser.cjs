// SPDX-License-Identifier: BSD-3-Clause
// Exercise NES/FDS reference songs behind zero-gain physical output routes.
// node scripts/check_2a03_synth_song_browser.cjs --engines=chromium,webkit
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {tmpdir}=require('node:os');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

const repo=path.resolve(__dirname,'..');
const config={root:path.join(repo,'docs'),entry:'/synth-2a03/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'2a03-synth-song-browser.json'),screenshots:path.join(tmpdir(),'2a03-synth-song-browser')};
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

function fixture(){
  const w=(r,v)=>[0xb4,r,v],commands=[...w(0x15,3),...w(0,0x79),...w(1,8),...w(2,0x40),...w(3,9),
    ...w(4,0x3a),...w(5,8),...w(6,0x60),...w(7,9),...w(0x3f,2),...w(0x23,0x80),...w(0x29,0x80),
    ...Array.from({length:64},(_,i)=>w(0x40+i,Math.round(31.5+31.5*Math.sin(i*Math.PI/32)))).flat(),...w(0x29,0),
    ...w(0x27,0x80),...Array.from({length:32},()=>w(0x28,0)).flat(),...w(0x24,0x80),...w(0x20,0x90),...w(0x22,0x90),...w(0x23,1)];
  for(let second=0;second<8;second++)commands.push(0x61,0x44,0xac,...w(0,second%2?0x79:0xf9),...w(2,second%2?0x40:0x70),...w(3,9));
  commands.push(0x66);const bytes=Buffer.alloc(256+commands.length);bytes.set([86,103,109,32]);bytes.writeUInt32LE(bytes.length-4,4);
  bytes.writeUInt32LE(0x171,8);bytes.writeUInt32LE(0xcc,0x34);bytes.writeUInt32LE((1789773|0x80000000)>>>0,0x84);bytes.writeUInt32LE(8*44100,0x18);bytes.set(commands,256);return bytes;
}
const songState=page=>page.evaluate(()=>({position:Number(document.querySelector('#nesSongSeek').value),status:document.querySelector('#nesSongStatus').textContent,
  pause:document.querySelector('#nesSongPause').textContent,selected:document.querySelector('#nesChannelTabs [aria-selected=true]')?.dataset.nesChannel,
  duty:document.querySelector('#pulseDuty [aria-checked=true]')?.dataset.choiceValue,
  source:document.querySelector('#source [aria-checked=true]')?.dataset.choiceValue,channel:document.querySelector('#nesChannelStatus').textContent}));
async function pauseSong(page){await page.locator('#nesSongPause').click();await until(()=>songState(page).then(s=>s.pause==='Resume'&&/^Paused/.test(s.status)),'song paused');}
async function resumeSong(page){await page.locator('#nesSongPause').click();await until(()=>songState(page).then(s=>s.pause==='Pause'&&/^Playing/.test(s.status)),'song resumed');}
async function stopSong(page){await page.locator('#nesSongStop').click();await until(()=>songState(page).then(s=>s.position===0&&/^Ready/.test(s.status)),'song stopped');await pcm(page,false);}
async function seekSong(page,seconds){await page.locator('#nesSongSeek').evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},seconds);await until(()=>songState(page).then(s=>!/^Seeking|Preparing/.test(s.status)&&Math.abs(s.position-seconds)<.08),'seek '+seconds);}
async function check(browser,name,origin,loadCassette){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),errors=[],missing=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.stack??e.message));
  page.on('response',r=>{if(r.url().startsWith(origin)&&r.status()>=400)missing.push(r.url());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
  await page.addInitScript(installSilentAudit);
  const step=value=>{stage=value;checks.push(value);console.log(name+': '+value);};
  try{
    await page.goto(origin+config.entry);await page.waitForFunction(()=>!document.querySelector('.nes-main').inert);await showFiles(page);
    step('Self-authored NES/FDS VGM imports into Files and presets without audio');
    const bytes=fixture();await page.locator('#vgmFileInput').setInputFiles({name:'reference.vgm',mimeType:'application/octet-stream',buffer:bytes});
    await until(()=>page.locator('#nesSongSelect').inputValue().then(v=>v==='/vgm/reference.vgm'),'selected imported source');
    const archive=await loadCassette(new Uint8Array(await exportProject(page)));
    assert.deepEqual(Buffer.from(archive.files.get('vgm/reference.vgm')),bytes);
    assert([...archive.files.keys()].some(p=>p.startsWith('presets/')&&p.endsWith('.json')));
    assert.equal((await page.evaluate(()=>__nesCodeAudit.graph())).contexts,0);
    // Close the menu opened by Export before operating the reference controls.
    if(await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
    await page.locator('#nesFilesToggle').click();

    step('Live updates the existing Pulse controls at the audible song position');
    await page.locator('[data-nes-channel="0"]').click();await page.locator('#nesSongPlay').click();
    await until(()=>songState(page).then(s=>s.position>.15&&/^Playing/.test(s.status)),'playing');await pcm(page);
    const early=await songState(page);assert.equal(early.duty,'0.25');
    await until(()=>songState(page).then(s=>s.position>1.2&&s.duty==='0.75'),'timed Duty update');measurements.live={early,late:await songState(page)};
    assert.equal((await read(page)).codeActive,false);

    step('Pause becomes Resume, keeps the position and is silent until a selected-channel audition');
    await pauseSong(page);const frozen=await songState(page);await wait(180);assert.equal((await songState(page)).position,frozen.position);await pcm(page,false);
    await page.locator('[data-nes-channel="5"]').click();assert.equal((await songState(page)).source,'fds');
    await page.keyboard.down('z');await pcm(page);assert.equal((await songState(page)).position,frozen.position);assert.match((await songState(page)).status,/Paused/);
    await page.keyboard.up('z');await pcm(page,false);
    await page.locator('[data-nes-channel="1"]').click();assert.equal((await songState(page)).duty,'0.125');
    await resumeSong(page);await until(()=>songState(page).then(s=>s.position>frozen.position+.12),'Resume advances original position');await pcm(page);

    step('Capture to Auto retains Pause and original channel differences');
    await pauseSong(page);const capturePosition=(await songState(page)).position;
    await page.locator('#nesSongCapture').click();await until(()=>songState(page).then(s=>s.selected==='auto'),'captured Auto');
    assert.match((await songState(page)).status,/Paused/);assert.equal((await songState(page)).position,capturePosition);await pcm(page,false);
    await page.locator('[data-nes-channel="0"]').click();const ch1=await songState(page);
    await page.locator('[data-nes-channel="1"]').click();assert.equal((await songState(page)).duty,'0.125');assert.notEqual(ch1.duty,'0.125');

    step('Physical channel edits and keyboard performance leave the reference song running');
    await resumeSong(page);const before=(await songState(page)).position;
    await page.locator('#pulseVolume').evaluate(node=>{for(let p=node.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
    await page.locator('[data-stepper-for="pulseVolume"][data-stepper-delta="-1"]').click();
    await page.keyboard.down('z');await wait(110);assert.match((await songState(page)).status,/Playing/);await page.keyboard.up('z');
    await until(()=>songState(page).then(s=>s.position>before+.12),'song continues after edits');await pcm(page);
    const graph=await page.evaluate(()=>__nesCodeAudit.graph());assert.equal(graph.contexts,1);assert.equal(graph.editorWorklets,1);assert.equal(graph.destinationConnections,1);assert(graph.muted);measurements.graph=graph;

    step('Seek preserves Playing or Pause, and unsupported replacement keeps the selected song');
    await pauseSong(page);await seekSong(page,3);assert.equal((await songState(page)).pause,'Resume');await pcm(page,false);
    const unsupported=Buffer.from(bytes);unsupported.writeUInt32LE(7670454,0x2c);
    await page.locator('#vgmFileInput').setInputFiles({name:'unsupported.vgm',mimeType:'application/octet-stream',buffer:unsupported});
    await until(()=>page.locator('#audioStatus').textContent().then(v=>/Unsupported chip/i.test(v)),'unsupported chip error');
    assert.equal(await page.locator('#nesSongSelect').inputValue(),'/vgm/reference.vgm');assert.equal((await songState(page)).pause,'Resume');assert.equal((await songState(page)).position,3);
    await resumeSong(page);await seekSong(page,4);assert.equal((await songState(page)).pause,'Pause');await pcm(page);

    step('Code and reference playback are exclusive while keeping a single Master output');
    await source(page,"const nes=await useSoundChip('nes');await nes.pulse.setVoice(CH1,{duty:.5,volume:4});await nes.noteOn(CH1,'C4');");await execute(page);
    await until(async()=>(await read(page)).codeActive,'Code lease');await until(()=>songState(page).then(s=>s.position===0&&/^Ready/.test(s.status)),'Code stops song');await pcm(page);
    await page.locator('#nesSongPlay').click();await until(()=>songState(page).then(s=>/^Playing/.test(s.status)),'song replaces Code');
    await until(async()=>!(await read(page)).codeActive,'song closes Code lease');await pcm(page);await stopSong(page);
    assert.equal((await page.evaluate(()=>__nesCodeAudit.graph())).contexts,1);assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    await fs.mkdir(config.screenshots,{recursive:true});await page.locator('#nesSongPlayer').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(config.screenshots,name+'-reference.png'),fullPage:true});
    return{browser:name,passed:true,checks,measurements,pageErrors:errors,missing};
  }catch(error){
    error.receipt={browser:name,passed:false,error:error.stack,stage,checks,measurements,state:await songState(page).catch(()=>null),audioStatus:await page.locator('#audioStatus').textContent().catch(()=>''),codeError:await page.locator('#synthCodeError').textContent().catch(()=>''),output:await page.evaluate(()=>__nesCodeAudit.output()).catch(()=>null),fdsVolume:await page.locator('#fdsVolume').textContent().catch(()=>''),pageErrors:errors,missing};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});throw error;
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
