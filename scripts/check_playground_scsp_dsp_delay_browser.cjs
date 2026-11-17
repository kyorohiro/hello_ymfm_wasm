// SPDX-License-Identifier: BSD-3-Clause
// Real Playground Main/Worker managed hardware Delay. All physical output stays at gain zero.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const config={root:path.resolve(__dirname,'../docs'),entry:'/playground/index.html?mode=scsp',engines:'chromium,webkit',rates:'44100,48000',out:path.join(os.tmpdir(),'playground-scsp-dsp-delay-browser.json')};
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
function mutePhysicalOutput(rate){
 const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect;
 const audit=window.__scspDspExecutionAudit={contexts:[],routes:[]};
 window.AudioContext=class extends Context{constructor(options={}){super({...options,sampleRate:rate});audit.contexts.push(this);}};
 if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
 AudioNode.prototype.connect=function(target,...rest){
  if(target!==this.context.destination)return connect.call(this,target,...rest);
  const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=2048;mute.gain.value=0;
  connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,target);audit.routes.push({analyser,mute});return target;
 };
 audit.level=()=>{
  let square=0,count=0,peak=0,nonFinite=0;
  for(const {analyser}of audit.routes){const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);for(const v of data){if(!Number.isFinite(v))nonFinite++;square+=v*v;peak=Math.max(peak,Math.abs(v));count++;}}
  return{rms:Math.sqrt(square/Math.max(1,count)),peak,nonFinite};
 };
}
function probeSource(execution){return `
const chip=await useSoundChip('scsp');setBpm(120);
const pcm=Int16Array.from({length:64},(_,i)=>Math.round(4096*Math.sin(2*Math.PI*i/64)));
const pcmHandle=await chip.loadPCM(pcm,{baseFrequencyHz:44100/64,loopStartSamples:0});
chip.setPreset(0,{sample:pcmHandle,totalLevel:0,directLevel:0,dspSend:7,envelope:{attackRate:31,releaseRate:31}});
const before=await chip.getState();
await chip.setDspDelay({enabled:true,timeMs:100,feedback:0.5});
await chip.setDspReturn({level:7,pan:0});
const setup=await chip.getDspProgram();
if(setup.profile!=='delay-ring'||setup.ram.byteLength!==65536||setup.delay.timeMs!==100)throw Error('Managed Delay setup missing');
chip.noteOn(0,'A3');await chip.getState();await beat(1);
console.log('DELAY_HELD_${execution}');await beat(1);
await chip.setDspDelay({feedback:0.25});
const feedback=await chip.getDspProgram(),held=await chip.getState();
if(feedback.ram.address!==setup.ram.address||feedback.ram.byteLength!==setup.ram.byteLength)throw Error('Feedback moved the Delay ring');
if(!held.slots[0].gate||held.slots[0].sample.id!==pcmHandle.id||held.samples.length!==before.samples.length)throw Error('Delay changed PCM ownership or released the voice');
console.log('DELAY_FEEDBACK_${execution}');await beat(1);
chip.noteOff(0);await chip.getState();
console.log('DELAY_RELEASED_${execution}');await beat(1);
const retained=await chip.getDspProgram();let rejected=0;
for(const patch of [{timeMs:19},{feedback:1}]){try{await chip.setDspDelay(patch);}catch{rejected++;}}
if(rejected!==2||JSON.stringify(await chip.getDspProgram())!==JSON.stringify(retained))throw Error('Invalid Delay edit changed setup');
const other=await createSoundChip('scsp');
try{const separate=await other.getDspProgram();if(separate.configured||separate.ram)throw Error('Delay reservation leaked into another instance');}finally{other.dispose();}
const state=await chip.getState();
console.log('DELAY_RESULT '+JSON.stringify({execution:'${execution}',profile:retained.profile,rejected,ram:retained.ram,delay:retained.delay,heldGate:held.slots[0].gate,sampleId:pcmHandle.id,bankId:state.bankId,ramUsedBytes:state.ramUsedBytes}));
console.log('DELAY_DONE_${execution}');
`;}
const level=page=>page.evaluate(()=>__scspDspExecutionAudit.level());
async function marker(page,text){await page.waitForFunction(text=>{const output=document.getElementById('consoleOutput').textContent;return output.includes(text)||/^(?:TypeError|ReferenceError|RangeError|Error):/m.test(output);},text,{timeout:15000});const output=await page.locator('#consoleOutput').textContent();assert(output.includes(text),output);}
const examples=[
 {name:'scsp-dsp-delay.js',marker:'SCSP DSP Delay: MIXS0 → managed RAM ring → EFREG0'},
];
function assertCodeSucceeded(output){assert(!/^(?:TypeError|ReferenceError|RangeError|Error|NotSupportedError|ScspDsp\w*Error):/m.test(output),output);}
async function stopAndMeasure(page){
 await page.locator('#stopButton').click();
 // Run's earlier finally can enable Run before Stop finishes retiring its Worker.
 // Stop owns both controls until its awaited cleanup has completed.
 await page.waitForFunction(()=>!document.getElementById('runButton').disabled&&
  !document.getElementById('stopButton').disabled&&
  document.getElementById('runtimeState').textContent.trim()==='Audio ready');
 await page.waitForTimeout(120);
 const stopped=await level(page);
 assert(stopped.peak<1e-6,JSON.stringify({stopped}));assert.equal(stopped.nonFinite,0);
 return stopped;
}
async function runFilesExample(page,execution,example){
 await page.locator('#codeTab').evaluate(button=>button.click());
 for(const folder of ['/examples','/examples/scsp']){
  const summary=page.locator(`#fileExplorerList summary[data-file-path="${folder}"]`);
  if(await summary.count()&&!await summary.evaluate(node=>node.parentElement.open))await summary.click();
 }
 const file='/examples/scsp/'+example.name;
 await page.locator(`#fileExplorerList button[data-file-path="${file}"]`).click();
 const authored=await fs.readFile(path.join(__dirname,'../docs/playground/examples/scsp',example.name),'utf8');
 assert.equal(await page.locator('#editor').inputValue(),authored,'Files must expose the exact editable example: '+file);
 await page.locator('#workerExecution').setChecked(execution==='worker');
 await page.locator('#runButton').click();
 await marker(page,example.marker);
 const audibleHandle=await page.waitForFunction(()=>{
  const value=__scspDspExecutionAudit.level();
  return value.rms>.00005?value:false;
 },null,{timeout:15000});
 const audible=await audibleHandle.jsonValue();await audibleHandle.dispose();
 assert.equal(audible.nonFinite,0);
 assertCodeSucceeded(await page.locator('#consoleOutput').textContent());
 const stopped=await stopAndMeasure(page);
 assertCodeSucceeded(await page.locator('#consoleOutput').textContent());
 assert.equal(await page.locator('#editor').inputValue(),authored,'Run / Stop must retain the authored example');
 return{path:file,sourceSha256:sha(Buffer.from(authored)),marker:example.marker,audible,stopped};
}
async function exercise(browserName,rate,base){
 const browser=await({chromium,webkit}[browserName]).launch({headless:true}),context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage();
 const errors=[],missing=[],blocked=[];
 await context.addInitScript(mutePhysicalOutput,rate);
 await context.route('**/*',route=>{if(!route.request().url().startsWith(base)){blocked.push(route.request().url());return route.abort();}return route.continue();});
 page.on('console',message=>{if(message.type()==='error')console.error('browser console:',message.text());});page.on('pageerror',error=>errors.push(error.message));page.on('response',res=>{if(res.status()>=400)missing.push({url:res.url(),status:res.status()});});
 const results=[];
 try{
  await page.goto(base+config.entry);await page.waitForFunction(()=>!document.getElementById('editor').readOnly&&document.getElementById('fileExplorerList').getAttribute('aria-busy')==='false');
  await page.locator('#startupNotice').waitFor({state:'hidden'});await page.locator('#codeTab').evaluate(b=>b.click());
  assert.equal(await page.evaluate(()=>__scspDspExecutionAudit.contexts.length),0,'Cold Playground starts no audio context');
  for(const execution of ['main','worker']){
   await page.locator('#fileExplorerList button[data-file-path="/index.js"]').click();
   await page.locator('#workerExecution').setChecked(execution==='worker');await page.locator('#editor').fill(probeSource(execution));await page.locator('#runButton').click();
   await marker(page,'DELAY_HELD_'+execution);await page.waitForTimeout(120);const held=await level(page);assert(held.rms>.00005,JSON.stringify({browserName,rate,execution,held}));
   await marker(page,'DELAY_FEEDBACK_'+execution);await page.waitForTimeout(120);const feedback=await level(page);assert(feedback.rms>.00005,JSON.stringify({feedback}));
   await marker(page,'DELAY_RELEASED_'+execution);await page.waitForTimeout(120);const tail=await level(page);assert(tail.peak>.000001,JSON.stringify({tail}));assert.equal(tail.nonFinite,0);
   await marker(page,'DELAY_DONE_'+execution);const log=await page.locator('#consoleOutput').textContent(),line=log.split('\n').find(line=>line.includes('DELAY_RESULT '));assert(line,log);
   const result=JSON.parse(line.split('DELAY_RESULT ')[1]);assert.equal(result.rejected,2);assert.equal(result.ram.byteLength,65536);assert(result.heldGate);
   const stopped=await stopAndMeasure(page),exampleResults=[];
   for(const example of examples)exampleResults.push(await runFilesExample(page,execution,example));
   results.push({...result,held,feedback,tail,stopped,examples:exampleResults});
  }
  const audit=await page.evaluate(()=>({rates:__scspDspExecutionAudit.contexts.map(c=>c.sampleRate),physicalOutputMuted:__scspDspExecutionAudit.routes.length>0&&__scspDspExecutionAudit.routes.every(r=>r.mute.gain.value===0)}));
  assert(audit.physicalOutputMuted);assert(audit.rates.every(actual=>actual===rate));assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  return{browser:browserName,rate,passed:true,results,audit,errors,missing,optionalExternalRequestsBlocked:blocked.length};
 }catch(error){console.error(JSON.stringify({browser:browserName,rate,errors,missing,console:await page.locator('#consoleOutput').textContent(),body:(await page.locator('body').innerText()).slice(0,5500),audit:await page.evaluate(()=>({contexts:__scspDspExecutionAudit.contexts.map(c=>({state:c.state,rate:c.sampleRate})),routes:__scspDspExecutionAudit.routes.length})),lastAssets:[...served.keys()].slice(-18)},null,2));throw error;}finally{await context.close();await browser.close();}
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  const results=[];for(const name of engines)for(const rate of rates)results.push(await exercise(name,rate,base));
  for(const [name,record]of served){const bytes=await fs.readFile(path.join(config.root,name));assert.equal(sha(bytes),record.sha256,'Source changed after run: '+name);}
  const report={passed:true,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,uiBundleModified:false,results,assets:Object.fromEntries(served)};
  await fs.mkdir(path.dirname(config.out),{recursive:true});
  await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('SCSP DSP managed Delay browser PASS:',config.out);
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
