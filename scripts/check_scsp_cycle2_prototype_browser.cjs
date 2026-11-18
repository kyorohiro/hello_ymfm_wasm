// SPDX-License-Identifier: BSD-3-Clause
// Real Playground Main/Worker bounded cycle2 research prototype. All physical output stays at gain zero.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const config={root:path.resolve(__dirname,'../docs'),entry:'/playground/index.html?mode=scsp',engines:'chromium,webkit',rates:'44100,48000',out:path.join(os.tmpdir(),'scsp-cycle2-prototype-browser.json')};
for(let i=2;i<process.argv.length;i++){
 const match=/^--(root|entry|engines|rates|out)(?:=(.+))?$/.exec(process.argv[i]);assert(match,'Unknown argument');
 config[match[1]]=match[2]??process.argv[++i];assert(config[match[1]],'Missing argument');
}
config.root=path.resolve(config.root);config.out=path.resolve(config.out);
const engines=config.engines.split(','),rates=config.rates.split(',').map(Number);
assert(engines.every(n=>['chromium','webkit'].includes(n)));assert(rates.every(n=>[44100,48000].includes(n)));
const served=new Map(),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.ts':'text/plain','.svg':'image/svg+xml','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{
 try{
  let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/favicon.ico'){res.writeHead(204).end();return;}if(name.endsWith('/'))name+='index.html';
  const file=path.resolve(config.root,'.'+name);assert(file.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(file),relative=path.relative(config.root,file).split(path.sep).join('/'),record={bytes:bytes.length,sha256:sha(bytes)};
  assert(!served.has(relative)||served.get(relative).sha256===record.sha256,'Source changed during verification: '+relative);served.set(relative,record);
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
 }catch(error){res.writeHead(404).end(String(error.message));}
});
const repository=path.resolve(__dirname,'..');
const exampleRelative='playground/examples/scsp/scsp-cycle2-prototype.js';
const virtualFile='/examples/scsp/scsp-cycle2-prototype.js';
async function protectedInputs(){
 const files=[];
 const walk=async relative=>{for(const entry of await fs.readdir(path.join(repository,relative),{withFileTypes:true})){
  const next=relative+'/'+entry.name;if(entry.isDirectory())await walk(next);else if(entry.isFile())files.push(next);
 }};
 await walk('docs/synth-scsp');await walk('third_party/tetorica-soundchip-native/vendor/mame-scsp');
 for(const name of await fs.readdir(path.join(repository,'docs/js')))
  if(/^(?:playground_.*|scsp.*|pcm_44100_resampler)\.js$/.test(name))files.push('docs/js/'+name);
 for(const name of ['docs/playground/index.html','docs/playground/playground.js','docs/generated/scsp_wasm.js','docs/generated/scsp_wasm.wasm'])files.push(name);
 const result={};for(const name of [...new Set(files)].sort()){
  const bytes=await fs.readFile(path.join(repository,name));result[name]={bytes:bytes.length,sha256:sha(bytes)};
 }return result;
}
function installAudit(rate){
 const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,WorkerClass=window.Worker;
 const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
 const audit=window.__cycle2Audit={contexts:[],nodes:[],workers:[],routes:[],commands:[],processorErrors:[],sequence:0};
 const ports=new WeakMap();
 window.AudioContext=class extends Context{constructor(options={}){super({...options,sampleRate:rate});audit.contexts.push(this);}};
 if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
 window.AudioWorkletNode=class extends Worklet{constructor(context,name,options){super(context,name,options);const row={node:this,name,index:audit.nodes.length,disposed:false};audit.nodes.push(row);ports.set(this.port,row);this.addEventListener('processorerror',()=>audit.processorErrors.push(name));}};
 window.Worker=class extends WorkerClass{constructor(url,...rest){super(url,...rest);audit.workers.push(String(url));}};
 MessagePort.prototype.postMessage=function(data,...rest){
  if(data?.method){const node=ports.get(this);audit.commands.push({method:data.method,args:structuredClone(data.args??[]),node:node?.index??null});if(node&&data.method==='dispose')node.disposed=true;}
  return post.call(this,data,...rest);
 };
 AudioNode.prototype.connect=function(destination,...rest){
  if(destination!==this.context.destination)return connect.call(this,destination,...rest);
  const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=2048;mute.gain.value=0;
  connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);audit.routes.push({analyser,mute});return destination;
 };
 audit.level=()=>{let square=0,count=0,peak=0,nonFinite=0;
  for(const {analyser}of audit.routes){if(analyser.context.state==='closed')continue;const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);
   for(const value of data){if(!Number.isFinite(value))nonFinite++;square+=value*value;peak=Math.max(peak,Math.abs(value));count++;}}
  return{rms:Math.sqrt(square/Math.max(1,count)),peak,nonFinite};
 };
 audit.graph=()=>({rates:audit.contexts.map(value=>value.sampleRate),nodes:audit.nodes.map(({index,name,disposed})=>({index,name,disposed})),workers:audit.workers,
  physicalOutputMuted:audit.routes.length>0&&audit.routes.every(value=>value.mute.gain.value===0),routes:audit.routes.length,processorErrors:audit.processorErrors});
 audit.request=(index,method='getState',args=[])=>new Promise((resolve,reject)=>{
  const row=audit.nodes[index];if(!row||row.disposed){reject(Error('Node is unavailable'));return;}
  const id='cycle2-browser-read-'+ ++audit.sequence,port=row.node.port;
  const timer=setTimeout(()=>{port.removeEventListener('message',receive);reject(Error('Cycle2 state read timed out'));},10000);
  function receive({data}){if(data?.id!==id)return;clearTimeout(timer);port.removeEventListener('message',receive);if(data.error)reject(Error(data.error));else resolve(data.value);}
  port.addEventListener('message',receive);port.start();port.postMessage({id,method,args});
 });
}
async function until(read,label){for(let i=0;i<160;i++){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Timed out: '+label);}
const graph=page=>page.evaluate(()=>__cycle2Audit.graph());
const level=page=>page.evaluate(()=>__cycle2Audit.level());
const read=async(page,index)=>page.evaluate(index=>__cycle2Audit.request(index),index);
const signatures=state=>({bankId:state.bankId,ramUsedBytes:state.ramUsedBytes,samples:state.samples,
 slots:state.slots.map(({frequencyHz,gate,...slot})=>slot)});
async function source(page,code){await page.locator('#codeTab').evaluate(button=>button.click());await page.locator('#editor').fill(code);assert.equal(await page.locator('#editor').inputValue(),code);}
function assertLogSucceeded(text){assert(!/^(?:TypeError|ReferenceError|RangeError|Error|NotSupportedError):/m.test(text),text);}
async function run(page){
 await page.locator('#runButton').click();
 await page.waitForFunction(()=>!document.getElementById('runButton').disabled&&(/SCSP cycle2 prototype ready/.test(document.getElementById('consoleOutput').textContent)||/^(?:TypeError|ReferenceError|RangeError|Error):/m.test(document.getElementById('consoleOutput').textContent)),null,{timeout:20000});
 const text=await page.locator('#consoleOutput').textContent();assertLogSucceeded(text);assert.match(text,/SCSP cycle2 prototype ready/);return text;
}
function checkPair(state,feedbackDepth=8){
 const a=state.slots[6],b=state.slots[7];assert(a.gate&&b.gate,'Both physical slots remain active');
 assert.equal(a.directLevel,0);assert.equal(b.directLevel,5);assert.equal(a.totalLevel,12);assert.equal(b.totalLevel,16);
 assert.equal(a.sample.id,b.sample.id);assert.equal(a.sample.bankId,b.sample.bankId);assert.equal(a.sample.length,64);assert.equal(a.sample.loopStartSamples,0);
 assert.deepEqual(a.modulation,{depth:feedbackDepth,xOffset:33,yOffset:1,writeInhibit:false});
 assert.deepEqual(b.modulation,{depth:8,xOffset:63,yOffset:63,writeInhibit:false});
 assert(state.slots.every((slot,index)=>index===6||index===7||!slot.gate),'No third slot is triggered');
 return{bankId:state.bankId,sample:a.sample,ramUsedBytes:state.ramUsedBytes,a:{slot:6,modulation:a.modulation,directLevel:a.directLevel},b:{slot:7,modulation:b.modulation,directLevel:b.directLevel}};
}
async function activePair(page,index,depth=8){return until(async()=>{const state=await read(page,index);return state.slots[6].gate&&state.slots[7].gate&&state.slots[6].modulation.depth===depth?state:false;},'active cycle2 pair');}
async function sound(page){return until(async()=>{const value=await level(page);assert.equal(value.nonFinite,0);return value.rms>.00001?value:false;},'finite nonzero pre-mute signal');}
async function stop(page,extra){
 await page.locator('#stopButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled&&!document.getElementById('stopButton').disabled&&document.getElementById('runtimeState').textContent.trim()==='Audio ready');
 await until(async()=>(await graph(page)).nodes[extra].disposed,'dedicated instance disposed');
 return until(async()=>{const value=await level(page);assert.equal(value.nonFinite,0);return value.peak<1e-6?value:false;},'Stop silence');
}
async function exercise(browserName,rate,execution,origin,authored){
 const browser=await({chromium,webkit}[browserName]).launch({headless:true}),context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage();
 const errors=[],missing=[],blocked=[],cases=[],screenshots={};
 await context.addInitScript(installAudit,rate);
 await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():(blocked.push(route.request().url()),route.abort()));
 page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
 try{
  await page.goto(origin+config.entry);await page.waitForFunction(()=>!document.getElementById('editor').readOnly&&document.getElementById('fileExplorerList').getAttribute('aria-busy')==='false');await page.locator('#startupNotice').waitFor({state:'hidden'});
  assert.equal((await graph(page)).rates.length,0);
  await page.locator('#codeTab').evaluate(button=>button.click());
  for(const folder of ['/examples','/examples/scsp']){
   const summary=page.locator(`#fileExplorerList summary[data-file-path="${folder}"]`);
   assert.equal(await summary.count(),1,'Bundled Examples folder exists: '+folder);
   if(!await summary.evaluate(node=>node.parentElement.open))await summary.click();
  }
  const bundled=page.locator(`#fileExplorerList button[data-file-path="${virtualFile}"]`);
  assert.equal(await bundled.count(),1,'Fresh project exposes the bundled cycle2 example');
  await bundled.click();await until(async()=>await page.locator('#editor').inputValue()===authored,'exact bundled cycle2 source opens');
  assert.equal(await page.locator('#editor').inputValue(),authored,'Files exposes the exact authored source without pasting or import');
  assert.equal(await page.locator('#editor').isEditable(),true);
  await page.locator('#runFileSelect').selectOption(virtualFile);await page.locator('#workerExecution').setChecked(execution==='worker');
  assert.equal(await page.locator('#runFileSelect').inputValue(),virtualFile);assert.equal((await graph(page)).rates.length,0);assert.equal((await graph(page)).nodes.length,0);
  cases.push('Fresh SCSP Playground opens its bundled Examples/scsp cycle2 file with exact editable source and Run path, without starting audio or executing code');
  let log=await run(page),g=await graph(page),scsp=g.nodes.filter(value=>value.name==='tetorica-playground-scsp');assert.equal(scsp.length,2,'Shared primary plus one dedicated chip');
  const primary=scsp[0].index,extra=scsp[1].index,primaryInitial=await read(page,primary);
  let state=await activePair(page,extra);const first=checkPair(state),firstSignature=signatures(state),audible=await sound(page);
  assert.match(log,/scsp-cycle2-prototype/);assert.match(log,/current-forward-average12/);
  if(execution==='worker')assert(g.workers.some(url=>/playground_logic_worker\.js/.test(url)),'Uses the actual logic Worker');
  cases.push('The unchanged example executes through the selected Main/Worker route on an independently owned SCSP, leaving primary gates and PCM intact');
  assert(primaryInitial.slots.every(slot=>!slot.gate));
  assert.match(log,/\(index\).*slot/);assert.match(log,/33.*1/);assert.match(log,/63.*63/);assert.match(log,/8841/i);assert.match(log,/8fff/i);
  cases.push('Public Worklet state matches A6/B7 current-forward63/63 and avg-return33/1, separate direct/TL levels and the visible register table');
  const ratios=[];
  for(let i=0;i<8;i++){const s=await read(page,extra);if(s.playingFrequencies[6]&&s.playingFrequencies[7])ratios.push(s.playingFrequencies[7]/s.playingFrequencies[6]);await page.waitForTimeout(35);}
  // getState keeps requested A Hz; setNote returns realized hardware-quantized Hz.
  assert(ratios.some(ratio=>Math.abs(ratio-1.5)<.002),JSON.stringify({ratios}));assert((await level(page)).nonFinite===0);
  cases.push('Legato melody retains both gates with the intended 1.5 ratio within pitch quantization and finite nonzero pre-mute output');
  const commandStart=await page.evaluate(()=>__cycle2Audit.commands.length);log=await run(page);state=await activePair(page,extra);checkPair(state);
  assert.deepEqual(signatures(state),firstSignature);assert.equal(state.bankId,first.bankId);
  assert.deepEqual(state.slots[6].sample,first.sample);assert.equal(state.ramUsedBytes,first.ramUsedBytes);assert.equal((await graph(page)).nodes.filter(value=>value.name==='tetorica-playground-scsp').length,2);
  const repeatedCommands=await page.evaluate(start=>__cycle2Audit.commands.slice(start).map(({method})=>method),commandStart);
  if(execution==='main')assert(repeatedCommands.every(method=>!['reset','loadPCM','keyOn','noteOn'].includes(method)),'Reevaluation does not prepare or retrigger the dedicated pair');
  assert.deepEqual(signatures(await read(page,primary)),signatures(primaryInitial));
  cases.push('Run reevaluation (Apply equivalent) retains the same dedicated node/bank/PCM and phase/history owner without another setup; Main sends no reset/load/keyOn');
  const offSource=authored.replace('const feedbackDepth = 8;','const feedbackDepth = 0;');assert.notEqual(offSource,authored);
  await source(page,offSource);await run(page);state=await activePair(page,extra,0);checkPair(state,0);assert.equal(state.bankId,first.bankId);assert.deepEqual(state.slots[6].sample,first.sample);
  await source(page,authored);await run(page);state=await activePair(page,extra);checkPair(state);assert.equal(state.bankId,first.bankId);await sound(page);
  cases.push('Depth-only Off/On reevaluation retains node and PCM, keeps the other edge at MDL8 and uses adapter Off without a new attack');
  const imageBase=path.join(path.dirname(config.out),path.basename(config.out,'.json')+'-'+browserName+'-'+rate+'-'+execution);
  screenshots.code=imageBase+'-code.png';await page.screenshot({path:screenshots.code});
  const stopped=await stop(page,extra);assert.deepEqual(signatures(await read(page,primary)),signatures(primaryInitial));assert.equal((await graph(page)).nodes[primary].disposed,false);
  cases.push('Stop disposes the dedicated instance and silences output while preserving the shared primary sample/configuration');
  await source(page,authored);await run(page);g=await graph(page);scsp=g.nodes.filter(value=>value.name==='tetorica-playground-scsp');assert.equal(scsp.length,3);const next=scsp.at(-1).index;
  const fresh=checkPair(await activePair(page,next));assert.notEqual(fresh.bankId,first.bankId,'Fresh native instance after Stop');await sound(page);await stop(page,next);
  const audited=await graph(page);assert(audited.physicalOutputMuted&&audited.rates.every(actual=>actual===rate));assert.deepEqual(audited.processorErrors,[]);assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  assert.equal(await page.locator('#editor').inputValue(),authored);
  cases.push('Stop -> Run creates fresh dedicated core/PCM ownership with the same recipe; all physical routes stay muted and served app assets remain unmodified');
  return{browser:browserName,rate,execution,passed:true,cases,sourceSha256:sha(Buffer.from(authored)),virtualFile,first,fresh,audible,stopped,ratios,repeatedCommands,audit:audited,screenshots,errors,missing,optionalExternalRequestsBlocked:blocked.length,historyEvidence:'Browser confirms retained/fresh ownership; direct ring history ages/clears are established by the separate native experiment, not exposed by getState.'};
 }catch(error){console.error(JSON.stringify({browserName,rate,execution,errors,missing,console:await page.locator('#consoleOutput').textContent(),status:await page.locator('#status').textContent(),audit:await graph(page)},null,2));throw error;}
 finally{await context.close();await browser.close();}
}
(async()=>{
 const before=await protectedInputs(),authored=await fs.readFile(path.join(config.root,exampleRelative),'utf8');
 await fs.mkdir(path.dirname(config.out),{recursive:true});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
 try{
  const results=[];for(const name of engines)for(const rate of rates)for(const execution of ['main','worker'])results.push(await exercise(name,rate,execution,origin,authored));
  for(const [name,record]of served)assert.equal(sha(await fs.readFile(path.join(config.root,name))),record.sha256,'Served source changed after verification: '+name);
  assert.deepEqual(await protectedInputs(),before,'Protected primary/runtime/Synth/core/WASM source bytes stay unchanged');
  const report={passed:true,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,appSourceInjected:false,uiBundleModified:false,results,assets:Object.fromEntries(served),protectedInputs:before};
  await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('SCSP cycle2 Code prototype browser PASS:',config.out);
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
