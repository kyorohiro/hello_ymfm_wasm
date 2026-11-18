// SPDX-License-Identifier: BSD-3-Clause
// Verify the read-only SSF DSP observation with permanently muted physical output.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {
  root: path.join(repository, 'docs'), entry: '/synth-scsp/index.html',
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-synth-ssf-dsp-browser.json'),
};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const match = /^--(root|entry|engines|out)(?:=(.+))?$/.exec(args[index]);
  assert(match, 'Unknown argument ' + args[index]);
  config[match[1]] = match[2] ?? args[++index];
  assert(config[match[1]], 'Missing value for ' + match[1]);
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry));
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.md': 'text/plain', '.scspasm': 'text/plain',
};
const served = new Map();
const server = http.createServer(async (request, response) => {
  try {
    let relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (relative === '/favicon.ico') {response.writeHead(204).end(); return;}
    if (relative.endsWith('/')) relative += 'index.html';
    const file = path.resolve(config.root, '.' + relative);
    assert(file.startsWith(config.root + path.sep), 'Request stays inside the isolated static site');
    const bytes = await fs.readFile(file);
    const asset=path.relative(config.root,file).split(path.sep).join('/'),record={bytes:bytes.length,sha256:sha(bytes)};
    assert(!served.has(asset)||served.get(asset).sha256===record.sha256,'Source changed during verification: '+asset);
    served.set(asset, record);
    response.writeHead(200, {'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'}).end(bytes);
  } catch {response.writeHead(404).end();}
});

// All real output reaches an analyser followed by a gain fixed at zero. The
// view cannot make a speaker route, and does not receive any test hooks.
function installSilentAudit() {
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const audit=window.__scspSsfDspAudit={contexts:[],nodes:[],meters:[],commands:[],sequence:0};
  window.AudioContext=class extends Context{constructor(options={}){super({...options,sampleRate:48000});audit.contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,options){super(context,name,options);audit.nodes.push({name,node:this});}};
  AudioNode.prototype.connect=function(destination,...rest){
    if(destination!==this.context.destination)return connect.call(this,destination,...rest);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=2048;mute.gain.value=0;
    connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);
    audit.meters.push({analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...rest){
    if(data?.method||data?.type==='chip-inspector')audit.commands.push(structuredClone(data));
    return post.call(this,data,...rest);
  };
  const reads=new Set(['readAuthoring','readPhysical','readDspProgram','readDspSetup','readDspCoefficients','getState','exportPatch']);
  audit.mutations=()=>audit.commands.filter(data=>{
    if(data.type==='chip-inspector')return data.action!=='read'&&data.method!=='getPCM';
    const method=data.method==='code'?data.args?.[1]:data.method;
    return !reads.has(method);
  }).length;
  audit.graph=()=>({contexts:audit.contexts.length,worklets:audit.nodes.map(value=>value.name),
    rates:audit.contexts.map(value=>value.sampleRate),routes:audit.meters.length,
    physicalOutputMuted:audit.meters.every(value=>value.mute.gain.value===0)});
  audit.level=()=>{
    let peak=0;for(const {analyser}of audit.meters){if(analyser.context.state==='closed')continue;
      const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);
      for(const value of samples){if(!Number.isFinite(value))throw Error('Non-finite output');peak=Math.max(peak,Math.abs(value));}}
    return {peak};
  };
  audit.request=command=>new Promise((resolve,reject)=>{
    const node=audit.nodes.findLast(value=>value.name==='tetorica-scsp-synth')?.node;
    if(!node){reject(Error('Primary Synth is unavailable'));return;}
    const id='ssf-dsp-audit-'+ ++audit.sequence;
    const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Primary Synth request timed out'));},5000);
    function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);
      if(data.error){const error=Error(data.error);error.name=data.name??'Error';reject(error);}else resolve(data.value);}
    node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({...command,id});
  });
  audit.inspect=()=>audit.request({type:'chip-inspector',action:'read'});
}

async function until(read,label){
  for(let attempt=0;attempt<200;attempt++){
    const value=await read();if(value)return value;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw Error('Timed out: '+label);
}
const inspect=page=>page.evaluate(()=>__scspSsfDspAudit.inspect());
const graph=page=>page.evaluate(()=>__scspSsfDspAudit.graph());
const mutations=page=>page.evaluate(()=>__scspSsfDspAudit.mutations());
const level=page=>page.evaluate(()=>__scspSsfDspAudit.level());
const waitState=(page,predicate,label)=>until(async()=>{const state=await inspect(page);return predicate(state)?state:false;},label);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function selectOperator(page,index){
  await page.locator(`[data-operator="${index}"]`).click();
  await page.waitForFunction(value=>document.querySelector(`[data-operator="${value}"]`).getAttribute('aria-pressed')==='true',index);
}
async function selectChannel(page,slot){
  await page.locator(`[data-scsp-channel="${slot??'auto'}"]`).click();
  await page.waitForFunction(value=>document.getElementById('scspChannelTabs').dataset.selected===String(value),slot??'auto');
}
async function number(page,id,value){
  await page.locator('#'+id).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));},value);
}
async function saveInstrument(page){
  if(!await page.locator('#synthMenu').evaluate(menu=>menu.open))await page.locator('#synthMenuButton').click();
  const download=page.waitForEvent('download');await page.locator('#save').click();
  return JSON.parse(await fs.readFile(await(await download).path(),'utf8'));
}
async function loadInstrument(page,preset,name){
  await page.setInputFiles('#open',{name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(preset))});
}
async function exportProject(page){
  if(!await page.locator('#synthMenu').evaluate(menu=>menu.open))await page.locator('#synthMenuButton').click();
  const pending=page.waitForEvent('download');await page.locator('#scspProjectExportButton').click();
  return fs.readFile(await(await pending).path());
}
const request=(page,command)=>page.evaluate(command=>__scspSsfDspAudit.request(command),command);
const authoringWrites=page=>page.evaluate(()=>__scspSsfDspAudit.commands.filter(command=>{
  if(command.type==='chip-inspector')return command.action!=='read'&&command.method!=='getPCM';
  if(command.method==='invokePhysical'&&command.args?.[0]==='getPCM')return false;
  return ['setConfig','setEffect','setDspSend','setDspSourceSend','setDspReturn','applyDspProgram','setDspCoefficients','loadPatch','invokePhysical','write','reset'].includes(command.method);
}).length);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function view(page){
  return page.evaluate(()=>{
    const root=document.getElementById('scspSsfDspView'),table=name=>[...document.querySelectorAll('#scspSsfDsp'+name+'Rows tr')].map(row=>[...row.children].map(cell=>cell.textContent));
    return {available:root.dataset.available,frame:root.dataset.frame,slot:root.dataset.slot,playback:root.dataset.playback,
      chFrame:document.getElementById('scspSsfLive').dataset.frame,source:document.getElementById('scspDspPanel').dataset.source,
      badge:document.getElementById('scspSsfDspBadge').textContent,status:document.getElementById('scspSsfDspStatus').textContent,
      selected:document.getElementById('scspSsfDspSelected').textContent,references:document.getElementById('scspSsfDspReferences').textContent,
      program:table('Program'),coefficients:table('Coefficient'),addresses:table('Address'),returns:table('Return'),
      writable:root.querySelectorAll('input,button,textarea,select').length,
      tab:document.getElementById('scspDspTab').getAttribute('aria-selected'),
      pause:document.getElementById('scspSongPause').textContent};
  });
}
const waitView=(page,predicate,label)=>until(async()=>{const value=await view(page);return predicate(value)?value:false;},label);
const frameAligned=value=>value.available==='true'&&value.frame===value.chFrame;
async function disclosure(page,name,open){
  const target=page.locator('#scspSsfDsp'+name);
  if(await target.evaluate(value=>value.open)!==open)await target.locator(':scope > summary').click();
}
async function exercise(name,origin,fixture,bytes){
  const browser=await({chromium,webkit}[name]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage();
  const errors=[],missing=[],external=[],cases=[],screenshots={};
  const imageBase=path.join(path.dirname(path.resolve(config.out)),path.basename(config.out,'.json')+'-'+name);
  await context.addInitScript(installSilentAudit);
  await context.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort();}return route.continue();});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
  try{
    await page.goto(origin+config.entry);await page.waitForFunction(()=>!document.getElementById('start').disabled&&document.querySelectorAll('[data-scsp-channel]').length===33);
    await page.locator('#scspDspTab').click();
    const draft='; My unapplied DSP draft remains mine.\n000: ZERO=1\n';
    await page.locator('#scspDspProgramEditor').fill(draft);
    const coldGraph=await graph(page);assert.equal(coldGraph.contexts,0);
    await page.locator('#ssfFileInput').setInputFiles({name:'original-dsp-motion.ssf',mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});
    assert.equal((await graph(page)).contexts,0);assert.equal(await page.locator('#scspDspTab').getAttribute('aria-selected'),'true');
    await page.locator('#start').click();await page.waitForFunction(()=>__scspSsfDspAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);
    const authorPatch=await request(page,{method:'exportPatch',args:[]}),authorDsp=await request(page,{method:'readDspSetup',args:[]});
    cases.push('Loading SSF and editing a Synth draft stay silent and separate before song playback');
    await page.locator('#scspSongPlay').click();let current=await waitView(page,frameAligned,'DSP snapshot aligned with audible CH frame');
    assert.equal(current.source,'ssf');assert.equal(current.tab,'true');assert.equal(current.badge,'Live');assert.equal(current.writable,0);
    assert(await page.locator('#scspSynthDspView').isHidden());assert(await page.locator('#scspSsfDspView').isVisible());
    const writes=await authoringWrites(page);
    for(const name of ['Program','Coefficient','Address','Return'])await disclosure(page,name,true);
    current=await waitView(page,value=>frameAligned(value)&&value.program.length===128&&value.coefficients.length===64&&value.addresses.length===32&&value.returns.length===16,'complete raw DSP tables');
    assert.equal(current.coefficients[0][1],String(fixture.coefficients[0]));assert.equal(current.coefficients[1][2],String(Number(current.coefficients[1][1])/4096));
    assert.match(current.program[32][2],/Opaque bits retained/);assert.match(current.program[32][1],/8000 1000/);
    assert(current.returns.every((row,index)=>row[0]===String(index)&&row[1]==='EWT selector'));
    assert.match(current.selected,/CH1.*Direct 0.*MIXS0.*IMXL 7.*program-defined/);assert.match(current.references,/MIXS0.*EFREG0/);
    assert.equal(await authoringWrites(page),writes,'Viewing DSP cannot apply or write Synth');
    const audible=await until(async()=>{const value=await level(page);return value.peak>.00005?value:false;},'finite native DSP output');
    cases.push('Real native DSP shows 128 raw/decode rows, opaque game fields, all 64 COEF / 32 MADRS / 16 returns without the Synth execution-profile restriction');
    const observed={coefficients:new Set(),programWords:new Set(),addresses:new Set()};
    const region=page.locator('#scspSsfDspProgram [role="region"]');await region.focus();
    await until(async()=>{
      const value=await view(page);assert(frameAligned(value));observed.coefficients.add(Number(value.coefficients[fixture.motion.coefficient][1]));
      observed.programWords.add(parseInt(value.program[fixture.motion.programWord>>2][1].split(' ')[fixture.motion.programWord%4],16));
      observed.addresses.add(Number(value.addresses[fixture.motion.address][2]));
      return observed.coefficients.size===2&&observed.programWords.size===2&&observed.addresses.size===2;
    },'live COEF / MPRO / MADRS changes');
    assert.deepEqual([...observed.coefficients].sort((a,b)=>a-b),fixture.motion.coefficientValues.toSorted((a,b)=>a-b));
    assert.deepEqual([...observed.programWords].sort((a,b)=>a-b),fixture.motion.programValues.toSorted((a,b)=>a-b));
    assert.deepEqual([...observed.addresses].sort((a,b)=>a-b),fixture.motion.addressValues.toSorted((a,b)=>a-b));
    assert(await region.evaluate(node=>node===document.activeElement),'Polling must not steal focus from the user scroll region');
    cases.push('Live program / coefficient / address changes follow audible snapshots without stealing focus or deriving audio meters');
    await page.locator('#scspSongPause').click();const paused=await waitView(page,value=>frameAligned(value)&&value.badge==='Paused'&&value.pause==='Resume','frozen paused DSP');
    const frozen=value=>JSON.stringify({frame:value.frame,program:value.program,coefficients:value.coefficients,addresses:value.addresses,returns:value.returns});
    await page.waitForTimeout(180);assert.equal(frozen(await view(page)),frozen(paused));
    for(const slot of [1,15,31,0]){
      await selectChannel(page,slot);current=await waitView(page,value=>value.slot===String(slot)&&frameAligned(value),'same paused DSP for CH '+slot);
      assert.equal(current.tab,'true');assert.equal(current.frame,paused.frame);assert.equal(frozen(current),frozen(paused));assert.match(current.selected,new RegExp('^CH'+(slot+1)+' '));
    }
    assert.equal(await authoringWrites(page),writes,'CH selection and frozen observation cannot write Synth DSP');
    cases.push('Pause freezes all DSP arrays; CH1/2/16/32 share the same frame and returns while the DSP tab stays selected');
    const seek=Number(paused.frame)/44100+1.5;
    await page.locator('#scspSongSeek').evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));},seek);
    const sought=await waitView(page,value=>frameAligned(value)&&value.badge==='Paused'&&value.pause==='Resume'&&Number(value.frame)>Number(paused.frame)+44100,'new paused seek frame');
    await page.waitForTimeout(160);assert.equal(frozen(await view(page)),frozen(sought));
    assert.equal(sought.tab,'true');assert.equal(await authoringWrites(page),writes);
    cases.push('Seek replaces the aligned DSP/CH snapshot, then remains frozen while paused');
    await disclosure(page,'Coefficient',false);await disclosure(page,'Address',false);
    screenshots.desktop=imageBase+'-desktop.png';await page.locator('#scspSsfDspView').screenshot({path:screenshots.desktop});
    await page.setViewportSize({width:390,height:844});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1,'Mobile overflow '+overflow);
    screenshots.mobile=imageBase+'-mobile.png';await page.locator('#scspSsfDspView').screenshot({path:screenshots.mobile});
    await page.setViewportSize({width:1400,height:1000});
    await page.locator('#scspSsfLiveEnabled').uncheck();await page.waitForFunction(()=>document.getElementById('scspDspPanel').dataset.source==='synth');
    assert(await page.locator('#scspSsfDspView').isHidden());assert(await page.locator('#scspSynthDspView').isVisible());
    assert.equal(await page.locator('#scspDspProgramEditor').inputValue(),draft);assert.deepEqual(await request(page,{method:'readDspSetup',args:[]}),authorDsp);assert.deepEqual(await request(page,{method:'exportPatch',args:[]}),authorPatch);
    await page.locator('#scspSsfLiveEnabled').check();await waitView(page,value=>frameAligned(value)&&value.badge==='Paused','restored paused DSP view');
    await page.locator('#scspSongStop').click();await page.waitForFunction(()=>document.getElementById('scspDspPanel').dataset.source==='synth');
    assert.equal(await page.locator('#scspDspProgramEditor').inputValue(),draft);assert.deepEqual(await request(page,{method:'readDspSetup',args:[]}),authorDsp);assert.deepEqual(await request(page,{method:'exportPatch',args:[]}),authorPatch);
    assert.equal(await authoringWrites(page),writes);const stopped=await until(async()=>{const value=await level(page);return value.peak===0?value:false;},'zero song output after Stop');
    cases.push('Live Off and Stop restore the existing Synth draft / applied program / instrument without automatic copy or Apply');
    const missingCapture=await page.evaluate(async()=>{
      const script=document.querySelector('script[type="module"][src*="synth.js"]');
      const {setupScspSsfDspView}=await import(new URL('./ssf_dsp_view.js',script.src));
      const section=document.createElement('section');document.body.append(section);const view=setupScspSsfDspView({root:section});
      view.update({frame:7,slots:[{voice:{directLevel:7,pan:0},dsp:{input:3,send:4}}]},{slot:0,playback:'paused'});
      const result={available:section.dataset.available,text:section.textContent,rows:section.querySelectorAll('tbody tr').length,writable:section.querySelectorAll('input,button,textarea,select').length};view.dispose();section.remove();return result;
    });
    assert.equal(missingCapture.available,'false');assert.match(missingCapture.text,/Unavailable/);assert.equal(missingCapture.rows,0);assert.equal(missingCapture.writable,0);
    cases.push('Legacy missing DSP capture explicitly shows Unavailable with no invented zero rows or edit controls');
    const audited=await graph(page);assert(audited.physicalOutputMuted&&audited.routes>0);assert(audited.rates.every(rate=>rate===48000));assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    return{browser:name,rate:48000,passed:true,cases,fixtureImageSha256:hash(fixture.image),audible,stopped,pausedFrame:Number(paused.frame),seekFrame:Number(sought.frame),
      observed:Object.fromEntries(Object.entries(observed).map(([key,values])=>[key,[...values].sort((a,b)=>a-b)])),authoringWrites:writes,graph:audited,mobileOverflow:overflow,screenshots,errors,missing,externalRequestsBlocked:external.length};
  }catch(error){console.error(JSON.stringify({name,errors,missing,status:await page.locator('#status').textContent(),view:await view(page).catch(()=>null),commands:await page.evaluate(()=>__scspSsfDspAudit.commands.filter(command=>command.method&&command.method!=='readAuthoring').slice(-15)),body:(await page.locator('body').innerText()).slice(0,5000)},null,2));throw error;}
  finally{await context.close();await browser.close();}
}

(async()=>{
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    const {createScspSsfDspMotionFixture}=await import(pathToFileURL(path.join(repository,'test/helpers/scsp_ssf_dsp_fixture.mjs')).href);
    const {ssfFromProgram}=await import(pathToFileURL(path.join(repository,'test/helpers/scsp_ssf_fixture.mjs')).href);
    const fixture=createScspSsfDspMotionFixture(),bytes=ssfFromProgram(fixture.image,0,'title=Tetorica original DSP observation browser fixture\nlength=0:30\nfade=0\n');
    const results=[];for(const name of engines)results.push(await exercise(name,origin,fixture,bytes));
    for(const [name,record]of served)assert.equal(sha(await fs.readFile(path.join(config.root,name))),record.sha256,'Source changed '+name);
    const report={passed:true,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,assets:Object.fromEntries(served)};
    await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('SCSP read-only SSF DSP browser PASS:',config.out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

