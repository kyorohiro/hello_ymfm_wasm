// Public Playground -> real SCSP AudioWorklet. Physical destination stays muted.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium,webkit}=require('playwright');
const option=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];};
const directory=path.resolve(option('--host')??path.resolve(__dirname,'../docs'));
const report={schemaVersion:1,passed:false,compressedInputRequested:!!option('--compressed'),physicalOutputMuted:true,listeningPerformed:false,results:[],captures:[]};
function instrumentation(){
 const audit=window.__scspAudit={contexts:[],worklets:[],workers:[],errors:[],sinks:[]};
 const Context=window.AudioContext,Worklet=window.AudioWorkletNode,WorkerClass=window.Worker,connect=AudioNode.prototype.connect;
 window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
 window.Worker=class extends WorkerClass{constructor(url,...args){super(url,...args);audit.workers.push(String(url));}};
 window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);audit.worklets.push(name);this.addEventListener('processorerror',()=>audit.errors.push(name));}};
 AudioNode.prototype.connect=function(destination,...args){
  if(destination===this.context.destination){let sink=audit.sinks.find(s=>s.context===this.context);
   if(!sink){const analyser=this.context.createAnalyser(),gate=this.context.createGain();analyser.fftSize=2048;gate.gain.value=0;connect.call(analyser,gate);connect.call(gate,destination);sink={context:this.context,analyser,gate};audit.sinks.push(sink);}
   connect.call(this,sink.analyser,...args);return destination;
  }return connect.call(this,destination,...args);
 };
}
async function measure(page){return page.evaluate(()=>__scspAudit.sinks.map(s=>{const pcm=new Float32Array(s.analyser.fftSize);s.analyser.getFloatTimeDomainData(pcm);return {sampleRate:s.context.sampleRate,peak:pcm.reduce((p,v)=>Math.max(p,Math.abs(v)),0),finite:pcm.every(Number.isFinite),muted:s.gate.gain.value===0};}));}
async function sound(page,on){for(let n=0;n<40;n++){const rows=await measure(page);assert(rows.every(r=>r.finite&&r.muted));if(rows.length&&(on?rows.some(r=>r.peak>.0001):rows.every(r=>r.peak===0))){report.captures.push({audible:on,rows});return rows;}await page.waitForTimeout(50);}throw Error(`Expected ${on?'sound':'silence'}: ${JSON.stringify(await measure(page))}; ${await page.locator('#status').textContent()}`);}

(async()=>{
 const nested=await fs.access(path.join(directory,'playground/index.html')).then(()=>true,()=>false),prefix=nested?'playground/':'';
 const server=http.createServer(async(req,res)=>{try{const file=path.resolve(directory,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(directory+path.sep))throw Error();let data=await fs.readFile(file);if(path.basename(file)==='playground.js'){const text=data.toString(),names=[...new Set([...text.matchAll(/([A-Za-z_$][\w$]*)\.getTiming\(\)\.workerLookaheadSeconds/g)].map(m=>m[1]))];assert.equal(names.length,1);data=Buffer.from(text+'\nwindow.__scspCheck={runtime:'+names[0]+'};\n');}res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{for(const [name,engine]of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true});try{for(const execution of ['main','worker']){
   const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1100}});await context.addInitScript(instrumentation);const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
   try{
    console.log(`FM ${name}/${execution}`);await page.goto(`http://127.0.0.1:${server.address().port}/${prefix}index.html?mode=scsp&layout=full&no-sw=1`);
    await page.waitForFunction(()=>document.getElementById('startupNotice')?.hidden);await page.waitForFunction(()=>window.__scspCheck);
    await page.click('#scspTab');await page.click('#scspPanel [data-chip-action="prepare"]');await page.waitForFunction(()=>!document.querySelector('[data-chip-action="scsp-hold"]')?.disabled);
    let source=await fs.readFile(path.join(directory,prefix,'examples/scsp/scsp-two-slot-fm.js'),'utf8');assert(source.includes('modulationDepth:12'));
    source=source.slice(0,source.indexOf('setBpm('))+"saturn.noteOn(0,57);saturn.noteOn(1,69);liveLoop('fm-held',async()=>{await sleep(60);});";
    await page.evaluate(({source,execution})=>__scspCheck.runtime.playSource(source,{execution}),{source,execution});
    const read=()=>page.evaluate(()=>__scspCheck.runtime.chipInspector.read('scsp'));
    for(let n=0;n<100;n++){const s=await read();if(s.channels[1].gate&&s.channels[1].modulation.depth===9)break;await page.waitForTimeout(30);}
    assert.equal((await read()).channels[1].modulation.depth,9);await sound(page,true);
    await page.click('#scspTab');const panel=page.locator('#scspPanel');await panel.locator('[data-scsp-slot="1"]').click();
    const depth=panel.locator('[data-chip-control="scsp-modulation-depth"]');await depth.fill('8');await depth.dispatchEvent('change');
    await page.waitForFunction(()=>document.activeElement?.type!=='number');
    for(let n=0;n<100&&(await read()).channels[1].modulation.depth!==8;n++)await page.waitForTimeout(20);
    let s=await read();assert.equal(s.channels[1].modulation.depth,8);assert.equal(s.channels[0].directLevel,0);assert.equal(s.channels[0].gate,true);assert.equal(s.channels[1].gate,true);assert.equal(s.channels[1].sample.modulationDepth,12);await sound(page,true);
    const inhibit=panel.locator('[data-chip-control="scsp-modulation-writeInhibit"]');await inhibit.check();await panel.locator('[data-chip-control="scsp-totalLevel"]').fill('18');await panel.locator('[data-chip-control="scsp-totalLevel"]').dispatchEvent('change');await inhibit.uncheck();
    const x=panel.locator('[data-chip-control="scsp-modulation-xOffset"]');await x.fill('31');await x.dispatchEvent('change');
    for(let n=0;n<100&&(await read()).channels[1].modulation.xOffset!==31;n++)await page.waitForTimeout(20);
    assert.equal((await read()).channels[1].modulation.xOffset,31);
    await panel.locator('[data-chip-action="scsp-copy"]').click();await panel.locator('[data-chip-output="scsp-code"]').waitFor({state:'visible'});const code=await panel.locator('[data-chip-output="scsp-code"]').inputValue();assert(code.includes('"modulationDepth":12'));assert(code.includes('"xOffset":31'));
    if(option('--screenshot')&&name==='chromium'&&execution==='main')await panel.screenshot({path:option('--screenshot')});
    await depth.fill('0');await depth.dispatchEvent('change');for(let n=0;n<100&&(await read()).channels[1].modulation.depth!==0;n++)await page.waitForTimeout(20);assert.equal((await read()).channels[1].modulation.depth,0);
    await page.click('#stopButton');await sound(page,false);
    // Editor's guarded allocation is a real upload, not metadata alone.
    await page.click('#scspTab');await panel.locator('[data-chip-action="scsp-sine"]').click();await panel.locator('[data-chip-control="scsp-modulation-padding"]').fill('10');await panel.locator('[data-chip-control="scsp-modulation-padding"]').dispatchEvent('change');await panel.locator('[data-chip-control="scsp-bits"]').selectOption('8');await panel.locator('[data-chip-action="scsp-apply"]').click();await page.waitForFunction(()=>document.querySelector('[data-chip-action="scsp-apply"]').disabled);
    s=await read();assert.equal(s.channels[1].sample.bits,8);assert.equal(s.channels[1].sample.modulationDepth,10);assert.equal(await panel.locator('canvas').count(),1);
    assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>__scspAudit.errors),[]);
    report.results.push({engine:name,execution,liveModulation:true,mutedModulator:true,stackOffsets:true,stwinhAndMix:true,copyWithGuards:true,pcm8EditorGuards:true,focus:true,stop:true});
   }finally{await context.close();}
  }}finally{await browser.close();}
 }report.passed=true;}finally{await new Promise(resolve=>server.close(resolve));if(option('--out'))await fs.writeFile(option('--out'),JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});
