// Serve docs on port 8093, or set TEMPO_TEST_URL.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  try{
    const context=await browser.newContext({serviceWorkers:'block'});
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/playground.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__tempoRuntime=runtime;'});});
    await page.goto(process.env.TEMPO_TEST_URL||'http://localhost:8093/playground/index.html');
    await page.waitForFunction(()=>window.__tempoRuntime&&window.monaco?.editor?.getEditors().some(editor=>editor.getModel()?.uri.path.startsWith('/project/')));
    const results=[];
    for(const worker of [false,true]){
      await page.locator('#workerExecution').setChecked(worker);
      // Warm the real audio/Worker pipeline before measuring short note lengths.
      await page.evaluate(worker=>window.__tempoRuntime.playSource('await play("C4",{seconds:.05});',{execution:worker?'worker':'main'}),worker);
      await page.evaluate(()=>{
        const editor=monaco.editor.getEditors().find(editor=>editor.getModel()?.uri.path.startsWith('/project/'));
        editor.setValue(`
          setBpm(120);
          fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
          const output=midi.output('tetorica-ym2612');
          const start=performance.now();
          const trace=(key,value)=>console.log('TEMPO_TRACE',JSON.stringify({key,value,seconds:(performance.now()-start)/1000}));
          await Promise.all([
            tween({beats:1},progress=>trace('progress',progress)),
            play('C4',{beats:1}).then(()=>trace('fm')),
            output.play('E4',{beats:1}).then(()=>trace('midi')),
            beat(1).then(()=>trace('beat')),
            sleep(.5).then(()=>trace('seconds')),
            sleepSamples(24000,48000).then(()=>trace('samples'))
          ]);
          trace('done');
        `);
      });
      await page.locator('#runButton').click();
      await page.waitForFunction(()=>[...document.getElementById('consoleOutput').textContent.matchAll(/TEMPO_TRACE (\{[^\n]+\})/g)].some(match=>{const value=JSON.parse(match[1]);return value.key==='progress'&&value.value>=.25&&value.value<.8;}));
      await page.evaluate(()=>window.__tempoRuntime.setBpm(60));
      await page.waitForFunction(()=>document.getElementById('consoleOutput').textContent.includes('"key":"done"'));
      const trace=await page.evaluate(()=>[...document.getElementById('consoleOutput').textContent.matchAll(/TEMPO_TRACE (\{[^\n]+\})/g)].map(match=>JSON.parse(match[1])));
      for(const key of ['fm','midi','beat']){const value=trace.find(entry=>entry.key===key);assert(value,`${worker}: ${key}`);assert(value.seconds>.65&&value.seconds<1.2,JSON.stringify(value));}
      for(const key of ['seconds','samples']){const value=trace.find(entry=>entry.key===key);assert(value.seconds>.45&&value.seconds<.65,JSON.stringify(value));}
      assert.equal(trace.filter(entry=>entry.key==='progress'&&entry.value===1).length,1);
      assert.equal(trace.find(entry=>entry.key==='progress').value,0);
      results.push({worker,notes:trace.filter(entry=>['fm','midi','beat','seconds','samples'].includes(entry.key))});
      await page.locator('#stopButton').click();
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,results}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
