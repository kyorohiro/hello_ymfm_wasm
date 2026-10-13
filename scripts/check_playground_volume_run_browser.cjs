// Serve docs; optional URL also accepts the flattened Tauri release directory.
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const results=[];
 for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
  try{
   const page=await browser.newPage({serviceWorkers:'block'}),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/playground.js?*',async route=>{
    const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__volumeRunTest={runtime,megaDrive};'});
   });
   await page.goto(process.argv[2]||'http://127.0.0.1:8096/playground/index.html');
   await page.waitForFunction(()=>window.__volumeRunTest&&window.monaco?.editor?.getEditors().length);
   await page.evaluate(()=>{
    window.monaco.editor.getEditors()[0].setValue('setMasterVolume(1.0); await sleep(0.05);');
    const input=document.getElementById('masterVolumeRange');input.value='380';input.dispatchEvent(new Event('input',{bubbles:true}));
   });
   await page.click('#runButton');await page.waitForFunction(()=>!document.getElementById('runButton').disabled);
   await page.evaluate(()=>{
    const {megaDrive}=window.__volumeRunTest,context=megaDrive.audioContext;
    const signal=context.createConstantSource();signal.offset.value=.02;signal.connect(megaDrive.audio.masterInputNode);signal.start();
    const meter=context.createAnalyser();meter.fftSize=1024;const detach=megaDrive.audio.connectOutputMonitor(meter);
    window.__volumeSignal={signal,meter,detach};
   });
   const measure=async()=>{
    await page.waitForTimeout(80);
    return page.evaluate(()=>{
     const {megaDrive,runtime}=window.__volumeRunTest,pcm=new Float32Array(1024);window.__volumeSignal.meter.getFloatTimeDomainData(pcm);
     return {display:document.getElementById('masterVolumeValue').textContent,slider:document.getElementById('masterVolumeRange').value,
      listening:megaDrive.audio.listeningVolume,script:runtime.getMasterVolume(),mean:pcm.reduce((sum,v)=>sum+v,0)/pcm.length};
    });
   };
   for(const execution of ['main','worker']){
    await page.evaluate(async execution=>{await window.__volumeRunTest.runtime.stopWithFade();document.getElementById('workerExecution').checked=execution==='worker';},execution);
    for(let run=0;run<2;run++){
     await page.click('#runButton');await page.waitForFunction(()=>!document.getElementById('runButton').disabled);
     const actual=await measure();assert.equal(actual.display,'380%');assert.equal(actual.slider,'380');assert.equal(actual.listening,3.8);assert.equal(actual.script,1);
     assert(Math.abs(actual.mean-.076)<.001,JSON.stringify({name,execution,run,actual}));results.push({browser:name,execution,run,...actual});
    }
   }
   await page.evaluate(()=>{const input=document.getElementById('masterVolumeRange');input.value='250';input.dispatchEvent(new Event('input',{bubbles:true}));});
   await page.click('#runButton');await page.waitForFunction(()=>!document.getElementById('runButton').disabled);
   const changed=await measure();assert.equal(changed.display,'250%');assert.equal(changed.listening,2.5);assert(Math.abs(changed.mean-.05)<.001,JSON.stringify(changed));
   await page.evaluate(async()=>{const {signal,meter,detach}=window.__volumeSignal;signal.stop();signal.disconnect();detach();meter.disconnect();await window.__volumeRunTest.runtime.stopWithFade();});
   assert.deepEqual(errors,[]);
  }finally{await browser.close();}
 }
 console.log(JSON.stringify({passed:true,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});
