// SPDX-License-Identifier: BSD-3-Clause
// Exercise only an isolated installed npm payload. No repository runtime imports
// or speaker output: permanent zero-gain routes are installed before startup.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const config={root:path.resolve(__dirname,'../dist/fm2612'),out:path.resolve(__dirname,'../build/npm-dmg-sid-timed-release-20261121/browser.json'),engines:'chromium,webkit',examples:'true',chips:'gameboy,sid',rates:'44100,48000',execution:'main,worker'};
for(const arg of process.argv.slice(2)){
  const match=/^--(root|out|engines|examples|chips|rates|execution)=(.+)$/.exec(arg);assert(match,'Unknown option '+arg);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);const engines=config.engines.split(',');assert(engines.every(name=>['chromium','webkit'].includes(name)));
const chips=config.chips.split(','),rates=config.rates.split(',').map(Number),executions=config.execution.split(',');
assert(chips.every(chip=>['gameboy','sid'].includes(chip)));assert(rates.every(rate=>[44100,48000].includes(rate)));assert(executions.every(execution=>['main','worker'].includes(execution)));
// A real installed URL depth catches accidental document-/parent-relative
// asset paths which serving a package directly at the origin would conceal.
const packagePrefix='/installed/node_modules/tetorica-fm2612';
const hash=value=>createHash('sha256').update(value).digest('hex');
const served=new Map(),missing=[],external=[];
let failedCase=null;
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
    if(pathname==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><meta charset="utf-8"><button id="start">Muted installed timed API check</button>');return;}
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    assert(pathname.startsWith(packagePrefix+'/'),'Request escaped installed package mount');
    const name=path.resolve(config.root,'.'+pathname.slice(packagePrefix.length));assert(name.startsWith(config.root+path.sep));
    const body=await fs.readFile(name),relative=path.relative(config.root,name),record={bytes:body.length,sha256:hash(body)};
    if(served.has(relative))assert.deepEqual(served.get(relative),record,'Installed asset changed during verification');served.set(relative,record);
    res.writeHead(200,{'Content-Type':mime[path.extname(name)]??'application/octet-stream','Cache-Control':'no-store'}).end(body);
  }catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}
});
function installAudit(){
  const connect=AudioNode.prototype.connect,Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,post=MessagePort.prototype.postMessage;
  const meters=[],contexts=[],nodes=[],commands=[],workers=[],errors=[];let serial=0;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,options){super(context,name,options);nodes.push({node:this,name,model:options?.processorOptions?.model??null});}};
  const WorkerClass=window.Worker;window.Worker=class extends WorkerClass{constructor(url,options){super(url,options);workers.push(String(url));}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(message,...args){commands.push({node:nodes.findIndex(item=>item.node.port===this),method:message?.method,type:message?.type,args:message?.args});return post.call(this,message,...args);};
  window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason?.stack??event.reason)));
  const target=(chip,model)=>nodes.findLast(item=>item.name===(chip==='gameboy'?'tetorica-gameboy':'tetorica-sid')&&(chip==='gameboy'||(item.model??'6581')===model));
  async function capture(chip,model){
    const item=target(chip,model);if(!item)throw Error('Missing actual Worklet '+chip+'/'+model);
    const id=--serial;return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{item.node.port.removeEventListener('message',receive);reject(Error('Native capture timeout'));},7000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);item.node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      item.node.port.addEventListener('message',receive);item.node.port.start();item.node.port.postMessage({id,method:chip==='gameboy'?'gameboyTimed':'sidTimed',args:[{action:'capture'}]});
    });
  }
  function output(){return meters.map(({analyser,mute})=>{const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);let square=0,peak=0;for(const v of values){square+=v*v;peak=Math.max(peak,Math.abs(v));}return{sampleRate:analyser.context.sampleRate,rms:Math.sqrt(square/values.length),peak,finite:values.every(Number.isFinite),physicallyMuted:mute.gain.value===0};});}
  window.__installedTimedAudit={capture,output,state:()=>({contexts:contexts.length,nodes:nodes.map(({name,model})=>({name,model})),commands:commands.slice(),workers:workers.slice(),errors:errors.slice(),physicallyMuted:meters.length>0&&meters.every(({mute})=>mute.gain.value===0)})};
}
const acquire=(chip,model)=>chip==='sid'&&model==='8580'?"await createSoundChip('sid',{model:'8580'})":`await useSoundChip('${chip}')`;
function program(chip,model){
  const setup=chip==='gameboy'?`chip.pulse.setVoice(0,{duty:.25,volume:9,envelope:{direction:'down',period:0}});`:`await chip.setVoice(0,{waveform:'saw',attack:0,decay:0,sustain:12,release:4,sync:false,ring:false});`;
  const calls=chip==='gameboy'?`b.pulse.noteOn(0,'E4');b.pulse.keyOn(0);b.atSample(4410).pulse.setDuty(0,.5);`:`b.noteOn(0,'E4');b.keyOn(0);b.atSample(4410).setVoice(0,{pulseWidth:1234});`;
  const rawRegister=chip==='gameboy'?2:4,rawValue=chip==='gameboy'?0:0x20;
  return `const chip=${acquire(chip,model)};
    context.chip=chip;globalThis.__installedHandle=chip;await chip.initialize();${setup}
    // Let immediate Worker lookahead writes reach the renderer before capture.
    await sleep(.35);
    const snapshot=await chip.captureState();let builds=0;
    const plan=chip.build(b=>{builds++;${calls}});
    const current=await chip.compile(plan),reused=await chip.compile(plan,{initialState:snapshot});
    const again=await chip.compile(plan,{initialState:snapshot}),client=await chip.compile(plan,{initialState:'client'});
    const reset=await chip.compile(chip.build(b=>{b.writeRegister(${rawRegister},${rawValue});b.writeRegister(${rawRegister},${rawValue});}),{initialState:'reset'});
    const receipt=await chip.schedule(plan,{name:'installed-entry',repeatSeconds:20});
    console.log('INSTALLED_REPORT:'+JSON.stringify({builds,plan,current,reused,again,client,reset,snapshot,receipt}));`;
}
async function runCase(browser,browserName,origin,chip,model,rate,execution){
  const context=await browser.newContext({serviceWorkers:'block'});await context.addInitScript(installAudit);const page=await context.newPage(),errors=[],consoleErrors=[];
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();external.push(url.href);return route.abort();});
  try{
    await page.goto(origin+'/');await page.locator('#start').click();
    const result=await page.evaluate(async({chip,model,rate,execution,source,packagePrefix})=>{
      const {createTetoricaSynth}=await import(packagePrefix+'/tetorica_synth.js'),{createPlaygroundRuntime}=await import(packagePrefix+'/playground_runtime.js');
      const ctx=new AudioContext({sampleRate:rate}),synth=createTetoricaSynth({chip,audioContext:ctx,masterVolume:.6});
      const logs=[];let runtime;
      const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const capture=()=>__installedTimedAudit.capture(chip,model);
      try{
        await ctx.resume();await synth.start();
        runtime=createPlaygroundRuntime({megaDrive:synth,guardExecution:false,execution,workerLookaheadSeconds:.1,onLog:line=>logs.push(line)});
        await runtime.playSource(source,{execution});await pause(450);
        const reportLine=logs.find(line=>line.startsWith('INSTALLED_REPORT:'));if(!reportLine)throw Error('Missing evaluation report: '+logs.join('\n'));
        const report=JSON.parse(reportLine.slice('INSTALLED_REPORT:'.length)),applied=await capture(),activeOutput=__installedTimedAudit.output();
        const bad=`const chip=context.chip;await chip.schedule(chip.build(b=>b.writeRegister(${chip==='gameboy'?2:4},0)),{name:'installed-entry',repeatSeconds:20});throw Error('intentional failed installed Apply');`;
        let rejected=false;try{await runtime.playSource(bad,{execution});}catch(error){rejected=/intentional failed installed Apply/.test(error.message);}
        if(!rejected)throw Error('Failed Apply unexpectedly accepted');await pause(250);const retained=await capture();
        await runtime.playSource(`const chip=context.chip;await chip.clearSchedule('installed-entry');console.log('INSTALLED_CLEARED');`,{execution});
        await pause(300);const cleared=await capture(),output=__installedTimedAudit.output();
        const stopNote=chip==='gameboy'?"b.pulse.noteOn(0,'G4')":"b.noteOn(0,'G4')";
        await runtime.playSource(`const chip=context.chip;await chip.schedule(chip.build(b=>${stopNote}),{name:'stop-owned',repeatSeconds:20});`,{execution});
        await pause(350);const beforeStop=await capture();
        await runtime.stop();await pause(150);
        let afterStop=null,staleHandleRejected=null;
        if(!(chip==='sid'&&model==='8580'))afterStop=await capture();
        if(execution==='main'){
          try{globalThis.__installedHandle.build(()=>{});staleHandleRejected=false;}
          catch(error){staleHandleRejected=error.name==='AbortError';}
        }
        const audit=__installedTimedAudit.state();
        if(!audit.physicallyMuted)throw Error('Physical output was not permanently muted');
        return{chip,model,requestedRate:rate,execution,...report,applied,retained,cleared,beforeStop,afterStop,staleHandleRejected,activeOutput,output,audit,failedApplyKept:true,logs};
      }finally{try{await runtime?.finalize();}finally{await synth.close();if(ctx.state!=='closed')await ctx.close();}}
    },{chip,model,rate,execution,source:program(chip,model),packagePrefix});
    failedCase={browser:browserName,...result};
    assert.equal(result.builds,1);assert.equal(result.snapshot.sampleRate,rate);assert.equal(result.applied.sampleRate,rate);
    assert.deepEqual(result.current,result.reused);assert.deepEqual(result.current,result.again);assert.deepEqual(result.current,result.client);
    assert.equal(result.reset.length,2);assert.equal(result.reset[0].value,result.reset[1].value);
    assert(result.applied.frame>result.snapshot.frame);assert(result.failedApplyKept);assert(result.audit.physicallyMuted);assert.deepEqual(result.audit.errors,[]);
    if(chip==='gameboy'){
      assert(result.applied.state.registers[2]>0);assert(result.retained.state.registers[2]>0);assert.equal(result.cleared.state.registers[2],0);
      assert.equal((result.applied.state.registers[1]>>6)&3,2);
      assert(result.beforeStop.state.registers[2]>0);assert.equal(result.afterStop.state.registers[2],0);
    }else{
      assert.equal(result.applied.state.model,model);assert(result.applied.state.registers[4]&1);assert(result.retained.state.registers[4]&1);assert.equal(result.cleared.state.registers[4]&1,0);
      assert.equal(result.applied.state.registers[2]|(result.applied.state.registers[3]&15)<<8,1234);
      assert(result.beforeStop.state.registers[4]&1);
      if(model==='6581')assert.equal(result.afterStop.state.registers[4]&1,0);
      else assert(result.audit.commands.some(command=>command.node>=0&&command.method==='dispose'),'Stop disposes the independent 8580 endpoint');
    }
    if(execution==='main')assert.equal(result.staleHandleRejected,true,'Host Stop retires the old timed facade');
    assert.equal(result.receipt.staged,true,'Entry reservation uses atomic evaluation transaction');
    if(execution==='worker')assert(result.audit.workers.some(url=>url.includes('playground_logic_worker.js')),'Actual logic Worker is used');
    assert(result.output.every(value=>value.finite&&value.physicallyMuted));assert(result.activeOutput.some(value=>value.rms>1e-5),'Actual installed core produces PCM before cancellation');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    result.cleanupAudit=await page.evaluate(async()=>{await new Promise(resolve=>setTimeout(resolve,30));return __installedTimedAudit.state();});assert.deepEqual(result.cleanupAudit.errors,[]);
    console.log(`${browserName} ${chip}/${model} ${execution} ${rate}: passed (muted)`);
    failedCase=null;
    return{browser:browserName,passed:true,...result};
  }finally{await context.close();}
}
async function exampleCases(browser,browserName,origin){
  const context=await browser.newContext({serviceWorkers:'block'});await context.addInitScript(installAudit);const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();external.push(url.href);return route.abort();});
  try{
    await page.goto(origin+packagePrefix+'/examples/timed-registers/dmg-sid.html');await page.locator('body').click({position:{x:4,y:4}});
    const rows=[];
    for(const mode of ['gameboy','6581','8580']){
      const row=await page.evaluate(async({mode,packagePrefix})=>{
        const {startDmgSidTimedExample}=await import(packagePrefix+'/examples/timed-registers/dmg-sid.js');
        const owner=await startDmgSidTimedExample(mode);await new Promise(resolve=>setTimeout(resolve,300));
        try{return{mode,audit:__installedTimedAudit.state(),output:__installedTimedAudit.output(),keys:Object.keys(owner??{})};}
        finally{await owner?.stop?.();await owner?.close?.();await owner?.dispose?.();}
      },{mode,packagePrefix});
      assert(row.audit.physicallyMuted);assert(row.output.every(value=>value.finite&&value.physicallyMuted));rows.push(row);
    }
    assert.deepEqual(errors,[]);return{browser:browserName,passed:true,modes:rows};
  }finally{await context.close();}
}
(async()=>{
  const packageBytes=await fs.readFile(path.join(config.root,'package.json')),metadata=JSON.parse(packageBytes);
  assert.equal(metadata.name,'tetorica-fm2612');
  const packageIdentity={name:metadata.name,version:metadata.version,packageJsonSha256:hash(packageBytes)};
  const results=[],examples=[],started=Date.now();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;let passed=false;
  try{
    for(const browserName of engines){
      const browser=await({chromium,webkit}[browserName]).launch({headless:true,...(browserName==='chromium'?{args:['--autoplay-policy=no-user-gesture-required','--mute-audio']}:{})});
      try{for(const rate of rates)for(const [chip,model]of [['gameboy','dmg'],['sid','6581'],['sid','8580']].filter(([chip])=>chips.includes(chip)))for(const execution of executions)results.push(await runCase(browser,browserName,origin,chip,model,rate,execution));if(config.examples==='true')examples.push(await exampleCases(browser,browserName,origin));}
      finally{await browser.close();}
    }
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
    for(const [name,record]of served)assert.deepEqual({bytes:(await fs.readFile(path.join(config.root,name))).length,sha256:hash(await fs.readFile(path.join(config.root,name)))},record,'Final payload identity '+name);
    passed=true;
  }finally{
    await new Promise(resolve=>server.close(resolve));await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify({passed,root:config.root,packagePrefix,packageIdentity,elapsedMs:Date.now()-started,cases:results,examples,failedCase,missing,external,served:Object.fromEntries(served)},null,2)+'\n');
  }
  console.log(`PASS ${results.length} installed timed cases; ${examples.length} example browser checks. ${config.out}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
