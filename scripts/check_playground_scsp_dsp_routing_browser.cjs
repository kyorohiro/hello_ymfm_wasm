// SPDX-License-Identifier: BSD-3-Clause
// Real Playground Main/Worker two-input / two-output hardware DSP routing. All physical output stays at gain zero.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const config={root:path.resolve(__dirname,'../docs'),entry:'/playground/index.html?mode=scsp',engines:'chromium,webkit',rates:'44100,48000',out:path.join(os.tmpdir(),'playground-scsp-dsp-routing-browser.json')};
for(let i=2;i<process.argv.length;i++){
 const match=/^--(root|entry|engines|rates|out)(?:=(.+))?$/.exec(process.argv[i]);assert(match,'Unknown argument');
 config[match[1]]=match[2]??process.argv[++i];assert(config[match[1]],'Missing argument');
}
config.root=path.resolve(config.root);config.out=path.resolve(config.out);
const engines=config.engines.split(','),rates=config.rates.split(',').map(Number);
assert(engines.every(n=>['chromium','webkit'].includes(n)));assert(rates.every(n=>[44100,48000].includes(n)));
const served=new Map(),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let scspMixerGain;
let scspMixerGainSource;
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
  const split=this.context.createChannelSplitter(2),left=this.context.createAnalyser(),right=this.context.createAnalyser(),mute=this.context.createGain();
  left.fftSize=right.fftSize=2048;mute.gain.value=0;
  connect.call(this,split);connect.call(split,left,0);connect.call(split,right,1);
  connect.call(left,mute);connect.call(right,mute);connect.call(mute,target);
  audit.routes.push({left,right,mute});return target;
 };
 audit.level=()=>{
  const channel=key=>{let square=0,acSquare=0,count=0,peak=0,dc=0,nonFinite=0;
   for(const route of audit.routes){const analyser=route[key];if(analyser.context.state==='closed')continue;
    const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);
    const mean=data.reduce((sum,value)=>sum+value,0)/data.length;dc=Math.max(dc,Math.abs(mean));
    for(const value of data){if(!Number.isFinite(value))nonFinite++;square+=value*value;acSquare+=(value-mean)**2;peak=Math.max(peak,Math.abs(value));count++;}}
   return{rms:Math.sqrt(square/Math.max(1,count)),acRms:Math.sqrt(acSquare/Math.max(1,count)),peak,dc,nonFinite};};
  const left=channel('left'),right=channel('right');
  return{left,right,rms:Math.sqrt((left.rms**2+right.rms**2)/2),peak:Math.max(left.peak,right.peak),nonFinite:left.nonFinite+right.nonFinite};
 };
}
function probeSource(execution){return `
const chip=await useSoundChip('scsp');setBpm(120);
const words=assembleScspDsp(\`000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0
001: EWT=1 EWA=0 ZERO=1
002: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
003: XSEL=1 YSEL=1 IRA=33 BSEL=1 COEF=2
004: TWT=1 TWA=0 EWT=1 EWA=1 ZERO=1\`);
await chip.applyDspProgram(words,{coefficients:{0:4095,1:3840,2:256}});
const pcm=Int16Array.from({length:64},(_,i)=>Math.round(4096*(2*i/64-1)));
const pcmHandle=await chip.loadPCM(pcm,{baseFrequencyHz:44100/64,loopStartSamples:0});
for(const channel of [0,1])chip.setPreset(channel,{sample:pcmHandle,totalLevel:0,directLevel:0,dspSend:7,dspInput:channel,envelope:{attackRate:31,releaseRate:31}});
await chip.setDspReturn(0,{level:7,pan:31});await chip.setDspReturn(1,{level:7,pan:15});
chip.noteOn(0,'A3');chip.noteOn(1,'A3');await beat(1);
console.log('ROUTING_BOTH_${execution}');await beat(1);
await chip.setDspReturn(1,{level:0});console.log('ROUTING_LEFT_${execution}');await beat(1);
await chip.setDspReturn(1,{level:7});await chip.setDspReturn(0,{level:0});console.log('ROUTING_RIGHT_${execution}');await beat(1);
await chip.setDspCoefficients({1:3072,2:1024});console.log('ROUTING_FILTER_${execution}');await beat(1);
// Worker immediate controls retain their 0.5s performance lead; wait past it.
await chip.setMix(1,{dspInput:0});await beat(1.5);
const noInputState=await chip.getState();
console.log('ROUTING_NO_INPUT_STATE_${execution} '+JSON.stringify(noInputState.slots.slice(0,2).map(slot=>({dspInput:slot.dspInput,dspSend:slot.dspSend,gate:slot.gate}))));
console.log('ROUTING_NO_INPUT_${execution}');await beat(1);
await chip.setMix(1,{dspInput:1});await chip.setDspReturn(0,{level:7});await beat(1.5);
const retained=await chip.getDspProgram();let rejected=0;
for(const action of [()=>chip.setMix(0,{dspInput:2}),()=>chip.setDspReturn(2,{level:7}),()=>chip.applyDspProgram(assembleScspDsp('001: EWT=1 EWA=2'))]){try{await action();}catch{rejected++;}}
if(rejected!==3||JSON.stringify(await chip.getDspProgram())!==JSON.stringify(retained))throw Error('Invalid routing edit changed DSP setup');
const state=await chip.getState();
if(!state.slots[0].gate||!state.slots[1].gate||state.slots.some((slot,index)=>index<2&&slot.sample.id!==pcmHandle.id))throw Error('Routing retriggered or changed held PCM');
const other=await createSoundChip('scsp');try{const separate=await other.getDspProgram();if(separate.configured||separate.returns)throw Error('Returns leaked across instances');}finally{other.dispose();}
console.log('ROUTING_RESULT '+JSON.stringify({execution:'${execution}',rejected,returns:retained.returns,legacyReturn:retained.return,sampleId:pcmHandle.id,slots:state.slots.slice(0,2).map(slot=>({gate:slot.gate,dspInput:slot.dspInput??0,dspSend:slot.dspSend})),ramUsedBytes:state.ramUsedBytes}));
console.log('ROUTING_DONE_${execution}');
`;}
const level=page=>page.evaluate(()=>__scspDspExecutionAudit.level());
async function marker(page,text){await page.waitForFunction(text=>{const output=document.getElementById('consoleOutput').textContent;return output.includes(text)||/^(?:TypeError|ReferenceError|RangeError|Error):/m.test(output);},text,{timeout:15000});const output=await page.locator('#consoleOutput').textContent();assert(output.includes(text),output);}
const examples=[
 {name:'scsp-dsp-routing.js',marker:'SCSP DSP routing: MIXS0 → Gain → left; MIXS1 → IIR → right'},
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
 assert.equal(stopped.peak,0,JSON.stringify({stopped}));assert.equal(stopped.nonFinite,0);
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
   await marker(page,'ROUTING_BOTH_'+execution);await page.waitForTimeout(120);const both=await level(page);
   assert(both.left.rms>.00005&&both.right.rms>.00005,JSON.stringify({both}));assert(both.left.rms>both.right.rms*1.1,'IIR must smooth the equal saw input');
   await marker(page,'ROUTING_LEFT_'+execution);await page.waitForTimeout(120);const leftOnly=await level(page);
   assert(leftOnly.left.rms>.00005&&leftOnly.right.peak<1e-6,JSON.stringify({leftOnly}));
   await marker(page,'ROUTING_RIGHT_'+execution);await page.waitForTimeout(120);const rightOnly=await level(page);
   assert(rightOnly.right.rms>.00005&&rightOnly.left.peak<1e-6,JSON.stringify({rightOnly}));
   await marker(page,'ROUTING_FILTER_'+execution);await page.waitForTimeout(120);const filter=await level(page);
   assert(filter.right.rms>rightOnly.right.rms*1.1&&filter.left.peak<1e-6,JSON.stringify({filter,rightOnly}));
   await marker(page,'ROUTING_NO_INPUT_'+execution);await page.waitForTimeout(120);const noInput=await level(page);
   // A recursive fixed-point IIR may retain one DAC LSB of DC with zero input.
   // This limit includes the actual SCSP factory Mixer gain, separately from AC silence.
   const dacLsb=scspMixerGain/32768;
   assert(noInput.peak<=dacLsb*1.00001&&noInput.right.acRms<dacLsb*.02&&noInput.left.peak===0,JSON.stringify({noInput,rightOnly,dacLsb}));
   await marker(page,'ROUTING_DONE_'+execution);const log=await page.locator('#consoleOutput').textContent(),line=log.split('\n').find(line=>line.includes('ROUTING_RESULT '));assert(line,log);
   const result=JSON.parse(line.split('ROUTING_RESULT ')[1]);assert.equal(result.rejected,3);assert.equal(result.returns.length,2);assert.deepEqual(result.legacyReturn,result.returns[0]);
   assert(result.slots.every(slot=>slot.gate));assert.deepEqual(result.slots.map(slot=>slot.dspInput),[0,1]);
   const stopped=await stopAndMeasure(page),exampleResults=[];
   for(const example of examples)exampleResults.push(await runFilesExample(page,execution,example));
   results.push({...result,both,leftOnly,rightOnly,filter,noInput,stopped,examples:exampleResults});
  }
  const audit=await page.evaluate(()=>({rates:__scspDspExecutionAudit.contexts.map(c=>c.sampleRate),physicalOutputMuted:__scspDspExecutionAudit.routes.length>0&&__scspDspExecutionAudit.routes.every(r=>r.mute.gain.value===0)}));
  assert(audit.physicalOutputMuted);assert(audit.rates.every(actual=>actual===rate));assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  return{browser:browserName,rate,passed:true,results,audit,errors,missing,optionalExternalRequestsBlocked:blocked.length};
 }catch(error){console.error(JSON.stringify({browser:browserName,rate,errors,missing,console:await page.locator('#consoleOutput').textContent(),body:(await page.locator('body').innerText()).slice(0,5500),audit:await page.evaluate(()=>({contexts:__scspDspExecutionAudit.contexts.map(c=>({state:c.state,rate:c.sampleRate})),routes:__scspDspExecutionAudit.routes.length})),lastAssets:[...served.keys()].slice(-18)},null,2));throw error;}finally{await context.close();await browser.close();}
}
(async()=>{
 const authoredGainModule=path.resolve(__dirname,'../docs/playground/playground_mixer_defaults.js');
 let gainModule=path.join(config.root,'playground/playground_mixer_defaults.js');
 const flattened=!(await fs.stat(gainModule).catch(error=>{if(error.code!=='ENOENT')throw error;return null;}));
 if(flattened)gainModule=authoredGainModule;
 const {createPlaygroundSoundChipMixer}=await import(pathToFileURL(gainModule).href);
 scspMixerGain=createPlaygroundSoundChipMixer('scsp').defaults('scsp','scsp').volume;
 assert(scspMixerGain>0&&scspMixerGain<=2,'Expected the measured SCSP source gain');
 scspMixerGainSource={path:gainModule,sha256:sha(await fs.readFile(gainModule)),flattenedBundleVerified:false};
 if(flattened){
  // ZIP flattens this module into playground.js; require its exact calibrated entry.
  const bundle=await fs.readFile(path.join(config.root,'playground.js'),'utf8');
  assert(bundle.includes(`id:"scsp",name:"scsp",settings:{volume:${String(scspMixerGain).replace(/^0\./,'.')}}`),'Flattened ZIP must retain the exact SCSP factory gain');
  scspMixerGainSource.flattenedBundleVerified=true;
 }
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  const results=[];for(const name of engines)for(const rate of rates)results.push(await exercise(name,rate,base));
  for(const [name,record]of served){const bytes=await fs.readFile(path.join(config.root,name));assert.equal(sha(bytes),record.sha256,'Source changed after run: '+name);}
  const report={passed:true,root:config.root,entry:config.entry,scspMixerGain,scspMixerGainSource,physicalOutputMuted:true,listeningPerformed:false,uiBundleModified:false,results,assets:Object.fromEntries(served)};
  await fs.mkdir(path.dirname(config.out),{recursive:true});
  await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('SCSP DSP routing browser PASS:',config.out);
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
