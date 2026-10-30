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

function longWav(){
 const rate=44100,frames=120*rate,bytes=Buffer.alloc(44+frames*4);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*4,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*4,40);
 for(let i=0;i<frames;i++){const v=Math.round(8192*Math.sin(i*2*Math.PI*440/rate));bytes.writeInt16LE(v,44+i*4);bytes.writeInt16LE(v,46+i*4);}return bytes;
}
(async()=>{
 const nested=await fs.access(path.join(directory,'playground/index.html')).then(()=>true,()=>false);const prefix=nested?'playground/':'';
 const server=http.createServer(async(req,res)=>{try{const file=path.resolve(directory,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(directory+path.sep))throw Error();let bytes=await fs.readFile(file);if(path.basename(file)==='playground.js'){
 const source=bytes.toString(),names=[...new Set([...source.matchAll(/([A-Za-z_$][\w$]*)\.getTiming\(\)\.workerLookaheadSeconds/g)].map(m=>m[1]))];
 assert.equal(names.length,1,'Exactly one raw/bundled runtime owns the Worker timing UI');
 bytes=Buffer.from(source+'\nwindow.__scspCheck={runtime:'+names[0]+'};\n');
 }res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/html');res.end(bytes);}catch{res.statusCode=404;res.end();}});
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
    await page.mouse.down();await sound(page,true);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await sound(page,false);await page.mouse.up();
    console.log('  PCM / EG editor');
    const panel=page.locator('#scspPanel');
    await page.waitForFunction(()=>!!document.querySelector('[data-chip-control="scsp-root"]')?.value);
    await panel.locator('[data-chip-action="scsp-triangle"]').click();
    await panel.locator('[data-chip-control="scsp-lfo-frequencyCode"]').selectOption('20');
    await panel.locator('[data-chip-control="scsp-lfo-pitchWave"]').selectOption('2');
    await panel.locator('[data-chip-control="scsp-lfo-pitchDepth"]').selectOption('3');
    await panel.locator('[data-chip-control="scsp-lfo-amplitudeDepth"]').selectOption('4');
    await panel.locator('[data-chip-control="scsp-bits"]').selectOption('8');
    await panel.locator('[data-chip-action="scsp-apply"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-chip-control="scsp-sample"]')?.selectedOptions[0]?.textContent.includes('8-bit'));
    await panel.locator('[data-chip-control="scsp-attackRate"]').fill('25');
    await panel.locator('[data-chip-control="scsp-attackRate"]').dispatchEvent('change');
    await page.waitForTimeout(300);
    assert.equal(await panel.locator('[data-chip-control="scsp-attackRate"]').inputValue(),'25');
    assert(await panel.locator('[data-chip-control="scsp-attackRate"]').evaluate(node=>node.ownerDocument.activeElement!==node),'EG edit returns keyboard focus');
    const wave=panel.locator('[data-chip-control="scsp-waveform"]');await wave.scrollIntoViewIfNeeded();const wb=await wave.boundingBox();
    await page.mouse.move(wb.x+wb.width*.2,wb.y+wb.height*.4);await page.mouse.down();await page.mouse.move(wb.x+wb.width*.4,wb.y+wb.height*.6,{steps:8});await page.mouse.up();
    assert.equal(await panel.locator('[data-chip-action="scsp-apply"]').isEnabled(),true);
    await panel.locator('[data-chip-action="scsp-apply"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-chip-action="scsp-apply"]').disabled);
    await panel.locator('[data-chip-action="scsp-copy"]').click();await panel.locator('[data-chip-output="scsp-code"]').waitFor();
    const voiceCode=await panel.locator('[data-chip-output="scsp-code"]').inputValue();assert(voiceCode.includes('new Int8Array'));assert(voiceCode.includes('"attackRate":25'));
    await hold.scrollIntoViewIfNeeded();const editedBox=await hold.boundingBox();await page.mouse.move(editedBox.x+editedBox.width/2,editedBox.y+editedBox.height/2);await page.mouse.down();await sound(page,true);await page.mouse.up();await sound(page,false);
    console.log('  Long audio / bounded editor RAM');
    const bytes=longWav();assert(bytes.length>20*1024*1024);
    const ram=()=>page.evaluate(()=>__scspCheck.runtime.chipInspector.read('scsp').then(s=>s.ramUsedBytes));
    const usedBeforeFile=await ram();
    await panel.locator('[data-chip-control="scsp-audio-file"]').setInputFiles({name:'original-120s.wav',mimeType:'audio/wav',buffer:bytes});
    await page.waitForFunction(()=>document.querySelector('[data-chip-output="scsp-file-status"]')?.textContent.includes('Loaded original-120s.wav'));
    assert.equal(await ram(),usedBeforeFile,'decoding a long recording never uploads it to chip RAM');
    await panel.locator('[data-chip-control="scsp-file-start"]').fill('5');await panel.locator('[data-chip-control="scsp-file-end"]').fill('5.25');
    await panel.locator('[data-chip-action="scsp-use-selection"]').click();assert.equal(await ram(),usedBeforeFile,'selection is a host-only draft');
    await panel.locator('[data-chip-action="scsp-apply"]').click();await page.waitForFunction(()=>document.querySelector('[data-chip-action="scsp-apply"]').disabled);
    const usedAfterFile=await ram();assert(usedAfterFile-usedBeforeFile<65536);
    for(let n=0;n<12;n++){
      await panel.locator('[data-chip-action="scsp-use-selection"]').click();await panel.locator('[data-chip-action="scsp-apply"]').click();await page.waitForFunction(()=>document.querySelector('[data-chip-action="scsp-apply"]').disabled);
    }
    assert.equal(await ram(),usedAfterFile,'repeated Apply reuses idle editor allocation');
    report.captures.push({browser:name,execution,check:'long WAV selection / idle editor RAM reuse',fileBytes:bytes.length,selectionSamples:11025,applyCount:13,usedBeforeFile,usedAfterFile,usedAfterRepeatedApply:await ram()});
    const state=await page.evaluate(()=>__scspCheck.runtime.chipInspector.read('scsp'));assert.equal(state.channels[0].sample.length,11025);assert.equal(state.channels[0].sample.loopStartSamples,null);
    await hold.scrollIntoViewIfNeeded();const fb=await hold.boundingBox();await page.mouse.move(fb.x+fb.width/2,fb.y+fb.height/2);await page.mouse.down();await sound(page,true);await page.mouse.up();await sound(page,false);
    if(option('--compressed')){
      await panel.locator('[data-chip-control="scsp-audio-file"]').setInputFiles(option('--compressed'));
      await page.waitForFunction(()=>document.querySelector('[data-chip-output="scsp-file-status"]')?.textContent.includes('Loaded scsp-import-test.m4a'));
      await panel.locator('[data-chip-control="scsp-file-end"]').fill('.25');await panel.locator('[data-chip-action="scsp-use-selection"]').click();await panel.locator('[data-chip-action="scsp-apply"]').click();
      await page.waitForFunction(()=>document.querySelector('[data-chip-action="scsp-apply"]').disabled);
      await hold.scrollIntoViewIfNeeded();const cb=await hold.boundingBox();await page.mouse.move(cb.x+cb.width/2,cb.y+cb.height/2);await page.mouse.down();await sound(page,true);await page.mouse.up();await sound(page,false);
    }
    if(option('--compressed'))report.captures.push({browser:name,execution,check:'M4A decode / selection / Apply / playback',passed:true});
    if(option('--screenshot')&&name==='chromium'&&execution==='main'){await panel.locator('[data-chip-control="scsp-file-start"]').scrollIntoViewIfNeeded();await page.screenshot({path:option('--screenshot')});}
    // Return slot0 to a cycle before the existing continuous-note checks.
    await panel.locator('[data-chip-action="scsp-sine"]').click();await panel.locator('[data-chip-action="scsp-apply"]').click();await page.waitForFunction(()=>document.querySelector('[data-chip-action="scsp-apply"]').disabled);
    console.log('  Keyboard');if(!await page.locator('#keyboardTab').isVisible())await page.locator('.dock-toggle').click();await page.locator('#keyboardTab').click();await page.locator('#operatorKeyboardRoot button').filter({hasText:/^Guitar$/}).click();
    await page.selectOption('#playgroundKeyboardChip','chip:scsp');await page.selectOption('#playgroundKeyboardTargetChannel','31');assert.equal(await page.locator('#playgroundKeyboardTargetChannel option').count(),32);
    const key=await page.locator('#operatorKeyboardRoot .key').first().getAttribute('data-key');await page.keyboard.down(key);await sound(page,true);await page.keyboard.up(key);await sound(page,false);
    const starter=await fs.readFile(path.join(directory,prefix,'defaults/scsp/index.js'),'utf8'),example=await fs.readFile(path.join(directory,prefix,'examples/scsp/scsp-stereo-pcm.js'),'utf8');
    for(const source of [starter,example,voiceCode]){console.log('  Run '+(source===starter?'starter':source===example?'PCM':'copied voice'));
     await page.locator('#codeTab').click();await page.evaluate(({source,execution})=>{monaco.editor.getEditors()[0].setValue(source);document.getElementById('workerExecution').checked=execution==='worker';},{source,execution});await page.locator('#runButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);await sound(page,true);await page.locator('#stopButton').click();await sound(page,false);
    }
    await page.locator('#scspTab').click();await panel.locator('[data-chip-action="scsp-sine"]').click();await panel.locator('[data-chip-action="scsp-apply"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-chip-action="scsp-apply"]').disabled);
    console.log('  Mixer / FX / suspend recovery');
    const heldSource=`const saturn=await useSoundChip('scsp');saturn.allNotesOff();saturn.setLfo(0,{pitchDepth:0,amplitudeDepth:0,reset:false});saturn.setMix(0,{pan:0,totalLevel:12,directLevel:7});saturn.noteOn(0,69);await mixer.set('scsp',{pan:0,muted:false,solo:true,volume:1});setMasterVolume(1);await fx.setChain([]);`;
    let heldSequence=0;const runHeld=async(patch='')=>{
      const token=`SCSP_HELD_READY_${++heldSequence}`;
      await page.locator('#codeTab').click();await page.evaluate(({source,execution})=>{monaco.editor.getEditors()[0].setValue(source);document.getElementById('workerExecution').checked=execution==='worker';},{source:heldSource+patch+`log('${token}');liveLoop('scsp-held',async()=>{await sleep(60);});`,execution});
      await page.locator('#runButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);await page.waitForFunction(token=>document.getElementById('consoleOutput').textContent.includes(token),token);
      const lead=execution==='worker'?await page.evaluate(()=>__scspCheck.runtime.getTiming().workerLookaheadSeconds*1000):0;
      await page.waitForTimeout(200+lead);await sound(page,true);
      return Math.max(...(await measure(page)).map(row=>row.peak));
    };
    const base=await runHeld();
    await page.locator('#mixerTab').click();const strip=page.locator('#mixerPanel [data-chip-id="scsp"]');await strip.waitFor();
    await strip.locator('button').filter({hasText:/^Mute$/}).click();await sound(page,false);
    await strip.locator('button').filter({hasText:/^Mute$/}).click();await sound(page,true);
    await strip.locator('[data-setting="volume"]').evaluate(node=>{node.value='50';node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.waitForTimeout(350);const half=Math.max(...(await measure(page)).map(row=>row.peak));assert(Math.abs(half/base-.5)<.025,`Mixer half gain ${half/base}`);
    assert.equal(await page.evaluate(()=>__scspCheck.runtime.megaDrive.mixer.get('scsp').volume),.5);
    const effected=await runHeld('await fx.setChain([fx.gain({gain:.2})]);');assert(Math.abs(effected/base-.2)<.025,`FX gain ${effected/base}`);
    const master=await runHeld('setMasterVolume(.25);');assert(Math.abs(master/base-.25)<.025,`Master gain ${master/base}`);
    await page.evaluate(async()=>{for(const context of __scspAudit.contexts)if(context.state==='running')await context.suspend();});
    assert(await page.evaluate(()=>__scspAudit.contexts.every(c=>c.state==='suspended')));
    const resumed=await runHeld();assert(Math.abs(resumed/base-1)<.025,`Recovered output ${resumed/base}`);
    assert(await page.evaluate(()=>__scspAudit.contexts.every(c=>c.state==='running')));
    await page.locator('#stopButton').click();await sound(page,false);
    report.captures.push({browser:name,execution,checks:'Mixer / FX / Master / suspend-resume ratios',base,half,effected,master,resumed});
    if(execution==='worker')assert(await page.evaluate(()=>__scspAudit.workers.some(url=>/playground_logic_worker\.js/.test(url))),'Worker mode uses the actual logic Worker');
    assert.equal(await page.evaluate(()=>__scspAudit.worklets.filter(n=>n==='tetorica-playground-scsp').length),1);
    await page.locator('#codeTab').click();await page.evaluate(execution=>{
      monaco.editor.getEditors()[0].setValue("await mixer.set('scsp',{solo:false}); const extra = await createSoundChip('scsp', {id:'saturn-extra'}); extra.noteOn(31, 'A4'); liveLoop('extra-held', async()=>{await sleep(60);});");
      document.getElementById('workerExecution').checked=execution==='worker';
    },execution);await page.locator('#runButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);await sound(page,true);await page.locator('#stopButton').click();await sound(page,false);
    assert.deepEqual(errors.filter(e=>e!=='ResizeObserver loop completed with undelivered notifications.'),[]);if(errors.length)console.log('  Layout observer notifications: '+errors.length);assert.deepEqual(await page.evaluate(()=>__scspAudit.errors),[]);assert.equal(await page.evaluate(()=>__scspAudit.worklets.filter(n=>n==='tetorica-playground-scsp').length),2);
    report.results.push({browser:name,version:browser.version(),execution,checks:['Files/editor separation at 1440/686px','lazy mode','Prepare audio','Hold/release','PCM8 Apply / drawing / EG / hardware LFO / Copy voice','20 MiB audio / selection / 12x RAM reuse','Stop releases editor guard after a Run','manual blur release / editor focus','Mixer UI mute/volume / FX / Master / suspend-resume','32-slot PC Keyboard','starter','PCM16 upload example','independent instance','Stop'],layoutNotifications:errors,output:await measure(page)});
    console.log(`PASS ${name}/${execution}: Prepare, Hold, 32-slot Keyboard, starter, PCM upload example, independent instance, Stop; output muted.`);
   }catch(error){throw Error(`${name}/${execution}: ${error.message}; page errors=${JSON.stringify(errors)}; state=${await page.locator('#status').textContent()}; startup=${await page.locator('#startupMessage').textContent()}`,{cause:error});}finally{await context.close();}
  }}finally{await browser.close();}
 }report.passed=true;}finally{await new Promise(resolve=>server.close(resolve));if(option('--out'))await fs.writeFile(option('--out'),JSON.stringify(report,null,2)+'\n');}
})().catch(error=>{console.error(error);process.exitCode=1;});
