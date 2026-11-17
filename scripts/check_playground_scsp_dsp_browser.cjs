// SPDX-License-Identifier: BSD-3-Clause
// Real Playground Main / Worker helpers. Every physical output is permanently muted.
// Flat package: --root /path/to/unzipped-site --entry '/index.html?mode=scsp'.
// Optional CDN assets are blocked so this also exercises the local editor fallback.
// Bundled browser ZIP: add --dom-only to leave its UI bundle untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {chromium, webkit} = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {root:path.join(repository,'docs'), entry:'/playground/index.html?mode=scsp',
  engines:'chromium,webkit', out:path.join(os.tmpdir(),'playground-scsp-dsp-browser.json')};
const args = process.argv.slice(2);
for (let index=0; index<args.length; index++) {
  if(args[index]==='--dom-only'){config.domOnly=true;continue;}
  const match = /^--(root|entry|engines|out)(?:=(.+))?$/.exec(args[index]);
  assert(match, 'Unknown argument '+args[index]);
  config[match[1]] = match[2] ?? args[++index];
  assert(config[match[1]], 'Missing value for '+match[1]);
}
config.root = path.resolve(config.root);
config.out = path.resolve(config.out);
assert(config.entry.startsWith('/'));
const engines = config.engines.split(',');
assert(engines.length && engines.every(name=>['chromium','webkit'].includes(name)));
const hash = bytes=>createHash('sha256').update(bytes).digest('hex');
const served = new Map();
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
  '.wasm':'application/wasm','.json':'application/json','.ts':'text/plain','.svg':'image/svg+xml','.webp':'image/webp'};
const examplePath = '/examples/scsp/scsp-dsp-roundtrip.js';
const sentinel = '// Human file retained by DSP inspection.\n';
const appHook = `\nwindow.__scspDspPlayground={runtime,megaDrive,virtualFiles,openVirtualFile,
  setSource:value=>editorAdapter.setValue(value),getSource:()=>editorAdapter.getValue(),
  save:saveActiveVirtualFile,setBottomTab};\n`;
const workerAudit = `
(()=>{
 const audit=globalThis.__playgroundDspAudit={messageCount:0,portCount:0};
 const post=globalThis.postMessage.bind(globalThis),port=MessagePort.prototype.postMessage;
 globalThis.postMessage=(data,...args)=>{
  if(data?.type==='command'||data?.type==='request'||data?.type?.startsWith('performance-'))audit.messageCount++;
  return post(data,...args);
 };
 MessagePort.prototype.postMessage=function(data,...args){audit.portCount++;return port.call(this,data,...args);};
 audit.pureState=()=>({messages:audit.messageCount,ports:audit.portCount});
})();
`;
const server = http.createServer(async(request,response)=>{
  try {
    let name=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(name==='/favicon.ico'){response.writeHead(204).end();return;}
    if(name.endsWith('/'))name+='index.html';
    const file=path.resolve(config.root,'.'+name);
    assert(file.startsWith(config.root+path.sep),'Request must stay inside the isolated static site');
    const bytes=await fs.readFile(file),relative=path.relative(config.root,file).split(path.sep).join('/');
    const item={bytes:bytes.length,sha256:hash(bytes)};
    assert(!served.has(relative)||served.get(relative).sha256===item.sha256,'Source changed during browser verification: '+relative);
    served.set(relative,item);
    const body=path.basename(file)==='playground.js'&&!config.domOnly?Buffer.concat([bytes,Buffer.from(appHook)]):
      path.basename(file)==='playground_logic_worker.js'?Buffer.concat([Buffer.from(workerAudit),bytes]):bytes;
    response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(body);
  } catch(error) {response.writeHead(404).end(error.message);}
});

function installSilentAudit() {
  const Context=window.AudioContext??window.webkitAudioContext, Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const audit=window.__playgroundDspAudit={contexts:[],nodes:[],routes:[],traffic:[],portCount:0};
  window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,options){super(context,name,options);audit.nodes.push({name,node:this});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();
    analyser.fftSize=2048;mute.gain.value=0;
    connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);
    audit.routes.push({analyser,mute,context:this.context});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){
    audit.portCount++;
    if(data?.method||data?.type)audit.traffic.push({type:data.type,method:data.method,action:data.action});
    return post.call(this,data,...args);
  };
  audit.pureState=()=>({ports:audit.portCount,contexts:audit.contexts.length,nodes:audit.nodes.length,routes:audit.routes.length});
  audit.level=()=>{
    let peak=0,nonFinite=0;
    for(const {analyser,context} of audit.routes){
      if(context.state==='closed')continue;
      const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);
      for(const value of values){if(!Number.isFinite(value))nonFinite++;peak=Math.max(peak,Math.abs(value));}
    }
    return {peak,nonFinite};
  };
}

function helperSource(execution) {
  return String.raw`
const audit=globalThis.__playgroundDspAudit;
if(!audit)throw Error('Browser helper audit not installed');
const before=audit.pureState();
if(assembleScspDsp!==pg.assembleScspDsp||disassembleScspDsp!==pg.disassembleScspDsp)throw Error('Global/pg helpers differ');
const words=assembleScspDsp('; Preserve physical positions\n002:\n003: XSEL=1 YSEL=1 EWT=1 ZERO=1 COEF=1');
if(!(words instanceof Uint16Array)||words.length!==512)throw Error('Expected owned 512-word image');
const vector=Array.from(words.slice(12,16));
if(JSON.stringify(vector)!==JSON.stringify([0,0xa000,0x1002,0x200]))throw Error('Unexpected independent instruction vector');
const canonical=pg.disassembleScspDsp(words),full=disassembleScspDsp(words,{includeTrailingZeros:true});
if(!/^000:\n001:\n002:\n003:/.test(canonical)||full.trimEnd().split('\n').length!==128)throw Error('Physical positions lost');
if(!pg.assembleScspDsp(canonical).every((word,index)=>word===words[index]))throw Error('Round trip lost words');
const owned=assembleScspDsp('127: NXADR=1');const second=assembleScspDsp('127: NXADR=1');owned[511]=0;
if(second[511]!==1)throw Error('Output array was shared');
const raw=assembleScspDsp('000: RAW0=0x8000 RAW1=0x1000 RAW3=0x180');
const frozen=Object.freeze(Array.from(raw));
if(!assembleScspDsp(disassembleScspDsp(frozen)).every((word,index)=>word===raw[index]))throw Error('RAW bits lost');
let lineError='';try{assembleScspDsp('; line\n\n004: COEF=64');}catch(error){lineError=error.message;}
if(!lineError.includes('Line 3:')||!lineError.includes('COEF'))throw Error('Missing line diagnostic');
let optionRejected=false;try{disassembleScspDsp(raw,{includeTrailingZeros:'yes'});}catch{optionRejected=true;}
if(!optionRejected)throw Error('Invalid option accepted');
const after=audit.pureState();
if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Pure helper attempted audio/transport activity');
console.table([{step:3,word0:vector[0],word1:vector[1],word2:vector[2],word3:vector[3]}]);
console.log('PG_SCSP_DSP_METRICS '+JSON.stringify({execution:${JSON.stringify(execution)},typed:true,wordCount:words.length,fullLines:128,vector,owned:true,raw:true,lineError,optionRejected,before,after}));
console.log('PG_SCSP_DSP_READY_${execution}');
`;
}
async function ready(page) {
  await page.waitForFunction(domOnly=>(domOnly||window.__scspDspPlayground)&&!document.getElementById('editor').readOnly&&
    document.getElementById('fileExplorerList').getAttribute('aria-busy')==='false',!!config.domOnly);
  await page.locator('#startupNotice').waitFor({state:'hidden'});
}
async function stop(page) {
  await page.locator('#stopButton').evaluate(button=>button.click());
  await page.waitForFunction(()=>__scspDspPlayground.runtime.getState().playback==='stopped'&&!document.getElementById('runButton').disabled);
}
async function run(page,execution,marker) {
  await page.locator('#workerExecution').setChecked(execution==='worker');
  await page.locator('#runButton').click();
  await page.waitForFunction(marker=>document.getElementById('consoleOutput').textContent.includes(marker),marker);
  await page.waitForFunction(()=>!document.getElementById('runButton').disabled);
}
async function openExample(page) {
  await page.locator('#codeTab').evaluate(button=>button.click());
  for(const name of ['/examples','/examples/scsp']){
    const summary=page.locator(`#fileExplorerList summary[data-file-path="${name}"]`);
    if(await summary.count()&&!await summary.evaluate(node=>node.parentElement.open))await summary.click();
  }
  await page.locator(`#fileExplorerList button[data-file-path="${examplePath}"]`).click();
}
async function exerciseDomPage(page,name,errors,missing,blocked) {
  const cases=[],metrics=[],exampleLogs=[];
  assert.equal(await page.evaluate(()=>__playgroundDspAudit.contexts.length),0);
  await openExample(page);
  const authored=await fs.readFile(path.join(repository,'docs/playground/examples/scsp/scsp-dsp-roundtrip.js'),'utf8');
  assert.equal(await page.locator('#editor').inputValue(),authored,'Bundled Files exposes the exact readable example');
  cases.push('unmodified UI bundle cold-loads the real SCSP Files example without audio or execution');
  for(const execution of ['main','worker']){
    await page.locator('#editor').fill(authored+`\nconsole.log('PG_SCSP_DSP_EXAMPLE_DONE_${execution}');\n`);
    await run(page,execution,'PG_SCSP_DSP_EXAMPLE_DONE_'+execution);
    const log=await page.locator('#consoleOutput').textContent();
    for(const marker of ['SCSP DSP: 512 words / 128 physical steps','SCSP DSP round trip: PASS','Full listing: 128 physical steps'])assert(log.includes(marker),marker);
    exampleLogs.push({execution,log});
    await page.locator('#stopButton').click();
    await page.waitForFunction(()=>!document.getElementById('runButton').disabled);
    await page.locator('#editor').fill(helperSource(execution));
    await run(page,execution,'PG_SCSP_DSP_READY_'+execution);
    const output=await page.locator('#consoleOutput').textContent();
    const line=output.split('\n').find(line=>line.includes('PG_SCSP_DSP_METRICS '));
    assert(line,'Bundled helper marker '+execution);
    const result=JSON.parse(line.split('PG_SCSP_DSP_METRICS ')[1]);
    assert.equal(result.execution,execution);assert.equal(result.wordCount,512);assert.deepEqual(result.vector,[0,0xa000,0x1002,0x200]);
    assert.deepEqual(result.before,result.after);assert.equal(result.fullLines,128);metrics.push(result);
    assert(output.includes('word1')&&output.includes('40960'));
    cases.push(execution+': actual Files example and global/pg helpers execute via DOM with typed/RAW/full/error/no-transport assertions');
    await page.locator('#stopButton').click();
    await page.waitForFunction(()=>!document.getElementById('runButton').disabled);
  }
  await page.locator('#consoleTab').click();
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(80);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  assert(overflow<=1,'390px horizontal overflow '+overflow);
  await page.screenshot({path:config.out.replace(/\.json$/,'')+'-'+name+'-mobile.png',fullPage:true});
  const audit=await page.evaluate(()=>({contexts:__playgroundDspAudit.contexts.length,
    contextStates:__playgroundDspAudit.contexts.map(context=>context.state),
    nodes:__playgroundDspAudit.nodes.map(entry=>entry.name),routes:__playgroundDspAudit.routes.length,
    physicalOutputMuted:__playgroundDspAudit.routes.every(route=>route.mute.gain.value===0),level:__playgroundDspAudit.level()}));
  assert(audit.routes>0&&audit.physicalOutputMuted);assert.equal(audit.level.nonFinite,0);assert.equal(audit.level.peak,0);
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  cases.push('bundled browser site remains silent with no missing local assets or browser errors');
  return {browser:name,passed:true,domOnly:true,cases,metrics,exampleLogs,audit,mobileOverflow:overflow,
    optionalExternalRequestsBlocked:[...new Set(blocked)],errors,missing};
}
async function exercise(name,origin) {
  const browser=await {chromium,webkit}[name].launch({headless:true});
  const context=await browser.newContext({viewport:{width:1380,height:1000},serviceWorkers:'block'});
  const cases=[],errors=[],missing=[],blocked=[];let page;
  try {
    await context.addInitScript(installSilentAudit);
    await context.route('**/*',route=>{
      const url=route.request().url();
      if(url.startsWith(origin))return route.continue();
      blocked.push(url);return route.abort();
    });
    page=await context.newPage();page.setDefaultTimeout(25000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{if(response.url().startsWith(origin)&&response.status()>=400)missing.push(response.url());});
    const entry=new URL(config.entry,origin);entry.searchParams.set('no-sw','1');
    await page.goto(entry.href);await ready(page);
    if(config.domOnly)return await exerciseDomPage(page,name,errors,missing,blocked);
    const cold=await page.evaluate(examplePath=>{
      const p=__scspDspPlayground;
      return {contexts:__playgroundDspAudit.contexts.length,example:p.virtualFiles.get(examplePath)?.data,
        index:p.virtualFiles.get('/index.js')?.data,playback:p.runtime.getState().playback};
    },examplePath);
    assert.equal(cold.contexts,0);assert.equal(cold.playback,'stopped');
    const authored=await fs.readFile(path.join(repository,'docs/playground/examples/scsp/scsp-dsp-roundtrip.js'),'utf8');
    assert.equal(cold.example,authored,'Fresh mode Files expose exact readable example without executing it');
    assert(!/noteOn\s*\(|useSoundChip\s*\(/.test(authored),'Inspection example performs no chip operations');
    cases.push('cold SCSP mode exposes the exact Files inspection example without audio or automatic execution');

    const metrics=[],exampleLogs=[];
    for(const execution of ['main','worker']){
      const filename=`/dsp-browser-${execution}.js`,source=helperSource(execution);
      await page.evaluate(({filename,source,sentinel})=>{
        const p=__scspDspPlayground;p.virtualFiles.writeText('/keep-human.js',sentinel);
        p.virtualFiles.writeText(filename,source);p.openVirtualFile(filename);
      },{filename,source,sentinel});
      await run(page,execution,'PG_SCSP_DSP_READY_'+execution);
      const output=await page.locator('#consoleOutput').textContent();
      const line=output.split('\n').find(line=>line.includes('PG_SCSP_DSP_METRICS '));
      assert(line,'Metrics marker '+execution);const result=JSON.parse(line.split('PG_SCSP_DSP_METRICS ')[1]);
      assert.equal(result.execution,execution);assert.equal(result.wordCount,512);assert.deepEqual(result.vector,[0,0xa000,0x1002,0x200]);
      assert.deepEqual(result.before,result.after);assert.equal(result.fullLines,128);metrics.push(result);
      assert(output.includes('word1')&&output.includes('40960'),'console.table exposes actual word fields');
      cases.push(execution+': globals and pg aliases preserve typed words, physical positions, RAW data, ownership and diagnostics without any synchronous transport activity');
      await stop(page);

      await openExample(page);
      const edited=authored+`\n// Keep this ${execution} edit when selecting and running the example.\nconsole.log('PG_SCSP_DSP_EXAMPLE_DONE_${execution}');\n`;
      await page.evaluate(source=>__scspDspPlayground.setSource(source),edited);
      await run(page,execution,'PG_SCSP_DSP_EXAMPLE_DONE_'+execution);
      const log=await page.locator('#consoleOutput').textContent();
      assert(log.includes('SCSP DSP: 512 words / 128 physical steps'));assert(log.includes('SCSP DSP round trip: PASS'));
      assert(log.includes('Full listing: 128 physical steps'));exampleLogs.push({execution,log});
      const preserved=await page.evaluate(examplePath=>({
        example:__scspDspPlayground.virtualFiles.get(examplePath).data,
        index:__scspDspPlayground.virtualFiles.get('/index.js').data,
        sentinel:__scspDspPlayground.virtualFiles.get('/keep-human.js').data,
      }),examplePath);
      assert.equal(preserved.example,edited);assert.equal(preserved.index,cold.index);assert.equal(preserved.sentinel,sentinel);
      cases.push(execution+': the real Files example runs through the Run toolbar with table/canonical output while preserving user edits and the current starter');
      await stop(page);
    }

    const definition=Array.from(served.keys()).find(name=>name.endsWith('/playground_monaco_definitions.js')||name==='playground_monaco_definitions.js');
    const declaration=Array.from(served.keys()).find(name=>name.endsWith('/tetorica-playground-globals.d.ts')||name==='tetorica-playground-globals.d.ts');
    assert(definition,'The definition viewer module is served');
    const pageDirectory=new URL('.',entry.href).pathname;
    const declarationsPath=declaration?'/'+declaration:pageDirectory+'tetorica-playground-globals.d.ts';
    const navigation=await page.evaluate(async({definition,declarationsPath})=>{
      const module=await import('/'+definition),text=await(await fetch(declarationsPath)).text();
      return ['assembleScspDsp','disassembleScspDsp'].map(symbol=>{
        const lines=text.split('\n'),index=lines.findIndex(line=>line.startsWith('declare function '+symbol+'('));
        if(index<0)throw Error('Global declaration not found: '+symbol);
        return module.definitionSource(text,{lineNumber:index+1,column:lines[index].indexOf(symbol)+1},'scsp');
      });
    },{definition,declarationsPath});
    assert.deepEqual(navigation,[{file:'scsp_dsp_assembler.js',symbol:'assembleScspDsp'},{file:'scsp_dsp_assembler.js',symbol:'disassembleScspDsp'}]);
    cases.push('served declarations navigate both helpers to the real public assembler implementation');

    await page.locator('#consoleTab').click();
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(80);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert(overflow<=1,'390px horizontal overflow '+overflow);
    await page.screenshot({path:config.out.replace(/\.json$/,'')+'-'+name+'-mobile.png',fullPage:true});
    const audit=await page.evaluate(()=>({contexts:__playgroundDspAudit.contexts.length,
      contextStates:__playgroundDspAudit.contexts.map(context=>context.state),
      nodes:__playgroundDspAudit.nodes.map(entry=>entry.name),routes:__playgroundDspAudit.routes.length,
      physicalOutputMuted:__playgroundDspAudit.routes.every(route=>route.mute.gain.value===0),level:__playgroundDspAudit.level(),
      playback:__scspDspPlayground.runtime.getState().playback}));
    assert(audit.routes>0&&audit.physicalOutputMuted);assert.equal(audit.level.nonFinite,0);assert.equal(audit.level.peak,0);
    assert.equal(audit.playback,'stopped');assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    cases.push('Main/Worker inspection sends no notes and Stop leaves exact silent PCM through permanently muted speaker routes');
    await page.evaluate(()=>__scspDspPlayground.runtime.finalize());
    return {browser:name,passed:true,cases,metrics,exampleLogs,navigation,audit,mobileOverflow:overflow,
      optionalExternalRequestsBlocked:[...new Set(blocked)],errors,missing};
  } catch(error) {
    if(page)error.browserResult={browser:name,passed:false,cases,error:error.stack,errors,missing,
      diagnostics:await page.evaluate(()=>({status:document.getElementById('status')?.textContent,
        console:document.getElementById('consoleOutput')?.textContent,source:document.getElementById('editor')?.value})).catch(()=>null)};
    throw error;
  } finally {await context.close();await browser.close();}
}
(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const results=[];
  try {
    const origin=`http://127.0.0.1:${server.address().port}`;
    for(const name of engines){results.push(await exercise(name,origin));console.log('PASS '+name+' Playground SCSP DSP helpers (physical gain zero)');}
    const report={passed:true,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,
      isolatedStaticSite:true,instrumentation:{appLexicalHook:!config.domOnly,workerTransportCounters:true},results,assets:Object.fromEntries(served)};
    await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');
  } catch(error) {
    if(error.browserResult)results.push(error.browserResult);
    await fs.writeFile(config.out,JSON.stringify({passed:false,root:config.root,entry:config.entry,physicalOutputMuted:true,results,assets:Object.fromEntries(served)},null,2)+'\n');
    throw error;
  } finally {await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
