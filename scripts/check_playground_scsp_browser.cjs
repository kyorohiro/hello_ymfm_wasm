// Public Playground -> real SCSP AudioWorklet. Physical destination stays muted.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium,webkit}=require('playwright');
const option=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];};
const directory=path.resolve(option('--host')??path.resolve(__dirname,'../docs'));
const report={schemaVersion:1,passed:false,physicalOutputMuted:true,listeningPerformed:false,results:[],captures:[]};
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
async function sound(page,on){for(let n=0;n<40;n++){const rows=await measure(page);assert(rows.every(r=>r.finite&&r.muted));if(rows.length&&(on?rows.some(r=>r.peak>.005):rows.every(r=>r.peak===0))){report.captures.push({audible:on,rows});return rows;}await page.waitForTimeout(50);}throw Error(`Expected ${on?'sound':'silence'}: ${JSON.stringify(await measure(page))}; ${await page.locator('#status').textContent()}`);}
(async()=>{
 const nested=await fs.access(path.join(directory,'playground/index.html')).then(()=>true,()=>false);const prefix=nested?'playground/':'';
 const server=http.createServer(async(req,res)=>{try{const file=path.resolve(directory,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(directory+path.sep))throw Error();const bytes=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/html');res.end(bytes);}catch{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{for(const [name,engine]of (process.argv.includes('--chromium-only')?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]])){
  const browser=await engine.launch({headless:true});try{for(const execution of ['main','worker']){
   const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1100}});await context.addInitScript(instrumentation);const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
   try{
    console.log(`CHECK ${name}/${execution}`);await page.goto(`http://127.0.0.1:${server.address().port}/${prefix}index.html?mode=scsp&layout=full&no-sw=1`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('startupNotice')?.hidden);await page.waitForFunction(()=>window.monaco?.editor?.getEditors().length===1);
    assert.equal(await page.locator('#playgroundMode').inputValue(),'scsp');assert.equal(await page.evaluate(()=>__scspAudit.worklets.length),0);
    await page.locator('#scspTab').click();
    for(const width of [1440,686]) {
      await page.setViewportSize({width,height:1100});
      const layout=await page.evaluate(()=>{
        const panel=document.getElementById('scspPanel'),files=document.getElementById('fileExplorer'),code=document.getElementById('codePanel');
        const p=panel.getBoundingClientRect(),f=files.getBoundingClientRect();
        return {sameHost:panel.parentElement===code.parentElement,host:panel.parentElement.className,panelLeft:p.left,filesRight:f.right,filesVisible:f.width>0,tabInEditor:!!document.getElementById('scspTab').closest('.workbench-editor')};
      });
      assert.equal(layout.sameHost,true,JSON.stringify(layout));assert.equal(layout.host,'workbench-primary-panels');assert.equal(layout.tabInEditor,true);
      if(layout.filesVisible)assert(layout.panelLeft>=layout.filesRight,`SCSP overlaps Files at ${width}px: ${JSON.stringify(layout)}`);
    }
    await page.setViewportSize({width:1440,height:1100});
    await page.locator('#scspPanel [data-chip-action="prepare"]').click();await page.waitForFunction(()=>document.querySelectorAll('#scspPanel [data-scsp-slot]').length===32);
    const hold=page.locator('#scspPanel [data-chip-action="scsp-hold"]');await hold.waitFor();await page.waitForFunction(()=>!document.querySelector('[data-chip-action="scsp-hold"]').disabled);
    console.log('  Hold');await hold.scrollIntoViewIfNeeded();const box=await hold.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await sound(page,true);await page.mouse.up();await sound(page,false);
    console.log('  Keyboard');if(!await page.locator('#keyboardTab').isVisible())await page.locator('.dock-toggle').click();await page.locator('#keyboardTab').click();await page.locator('#operatorKeyboardRoot button').filter({hasText:/^Guitar$/}).click();
    await page.selectOption('#playgroundKeyboardChip','chip:scsp');await page.selectOption('#playgroundKeyboardTargetChannel','31');assert.equal(await page.locator('#playgroundKeyboardTargetChannel option').count(),32);
    const key=await page.locator('#operatorKeyboardRoot .key').first().getAttribute('data-key');await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down(key);await sound(page,true);await page.keyboard.up(key);await sound(page,false);
    const starter=await fs.readFile(path.join(directory,prefix,'defaults/scsp/index.js'),'utf8'),example=await fs.readFile(path.join(directory,prefix,'examples/scsp/scsp-stereo-pcm.js'),'utf8');
    for(const source of [starter,example]){console.log('  Run '+(source===starter?'starter':'PCM'));
     await page.locator('#codeTab').click();await page.evaluate(({source,execution})=>{monaco.editor.getEditors()[0].setValue(source);document.getElementById('workerExecution').checked=execution==='worker';},{source,execution});await page.locator('#runButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);await sound(page,true);await page.locator('#stopButton').click();await sound(page,false);
    }
    if(execution==='worker')assert(await page.evaluate(()=>__scspAudit.workers.some(url=>/playground_logic_worker\.js/.test(url))),'Worker mode uses the actual logic Worker');
    assert.equal(await page.evaluate(()=>__scspAudit.worklets.filter(n=>n==='tetorica-playground-scsp').length),1);
    await page.locator('#codeTab').click();await page.evaluate(execution=>{
      monaco.editor.getEditors()[0].setValue("const extra = await createSoundChip('scsp', {id:'saturn-extra'}); extra.noteOn(31, 'A4'); liveLoop('extra-held', async()=>{await sleep(60);});");
      document.getElementById('workerExecution').checked=execution==='worker';
    },execution);await page.locator('#runButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);await sound(page,true);await page.locator('#stopButton').click();await sound(page,false);
    assert.deepEqual(errors.filter(e=>e!=='ResizeObserver loop completed with undelivered notifications.'),[]);if(errors.length)console.log('  Layout observer notifications: '+errors.length);assert.deepEqual(await page.evaluate(()=>__scspAudit.errors),[]);assert.equal(await page.evaluate(()=>__scspAudit.worklets.filter(n=>n==='tetorica-playground-scsp').length),2);
    report.results.push({browser:name,version:browser.version(),execution,checks:['Files/editor separation at 1440/686px','lazy mode','Prepare audio','Hold/release','32-slot PC Keyboard','starter','PCM16 upload example','independent instance','Stop'],layoutNotifications:errors,output:await measure(page)});
    console.log(`PASS ${name}/${execution}: Prepare, Hold, 32-slot Keyboard, starter, PCM upload example, independent instance, Stop; output muted.`);
   }catch(error){throw Error(`${name}/${execution}: ${error.message}; page errors=${JSON.stringify(errors)}; state=${await page.locator('#status').textContent()}; startup=${await page.locator('#startupMessage').textContent()}`,{cause:error});}finally{await context.close();}
  }}finally{await browser.close();}
 }report.passed=true;}finally{await new Promise(resolve=>server.close(resolve));if(option('--out'))await fs.writeFile(option('--out'),JSON.stringify(report,null,2)+'\n');}
})().catch(error=>{console.error(error);process.exitCode=1;});
