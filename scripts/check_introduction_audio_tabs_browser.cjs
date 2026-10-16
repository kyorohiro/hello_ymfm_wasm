const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');

async function serveIntroduction(){
  const docs=path.resolve(__dirname,'../docs');
  const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png'};
  const server=http.createServer(async(request,response)=>{
    try{
      const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
      let filename=path.resolve(docs,'.'+pathname);
      if(filename!==docs&&!filename.startsWith(docs+path.sep))throw Error('Invalid path');
      if((await fs.stat(filename)).isDirectory())filename=path.join(filename,'index.html');
      const body=await fs.readFile(filename);
      response.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store'});
      response.end(body);
    }catch(error){response.writeHead(404).end(String(error));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {
    url:`http://127.0.0.1:${server.address().port}/introductions/index-ja.html`,
    close:()=>new Promise(resolve=>server.close(resolve)),
  };
}

const views={
  envelope:{section:'#audioMonitorEnvelopeView',canvas:'audioMonitorEnvelope'},
  waveform:{section:'#audioMonitorWaveView',canvas:'audioMonitorWave'},
  spectrum:{section:'#audioMonitorSpectrumView',canvas:'audioMonitorSpectrum'},
};

async function checkSelectedView(frame,mode){
  await frame.locator('#audioMonitorMode').selectOption(mode);
  for(const [name,view] of Object.entries(views)){
    assert.equal(await frame.locator(view.section).isVisible(),name===mode,`${mode}: only its plot is visible`);
  }
  // Ignore the initial repaint on a mode change; check ongoing playback draws.
  await frame.waitForTimeout(100);
  const before=await frame.evaluate(()=>{
    window.__introAudioObservation.signal={};
    return {...window.__introAudioObservation.draws};
  });
  await frame.waitForFunction(({mode,canvas,draws})=>{
    const observation=window.__introAudioObservation;
    const signal=observation.signal[mode];
    return observation.draws[canvas]>draws && signal &&
      (mode==='spectrum'?signal.frequencyPeak>-80:signal.timePeak>.01);
  },{mode,canvas:views[mode].canvas,draws:before[views[mode].canvas]});
  await frame.waitForTimeout(150);
  const after=await frame.evaluate(()=>({...window.__introAudioObservation.draws}));
  for(const [name,view] of Object.entries(views)){
    if(name!==mode)assert.equal(after[view.canvas],before[view.canvas],`${mode}: hidden ${name} plot kept drawing`);
  }
}

(async()=>{
  const localServer=process.env.INTRODUCTION_TEST_URL?null:await serveIntroduction();
  let browser;
  try{
    browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.addInitScript(()=>{
      const observation=window.__introAudioObservation={signal:{},draws:{audioMonitorEnvelope:0,audioMonitorWave:0,audioMonitorSpectrum:0}};
      // Observe browser APIs rather than rewriting a particular monitor source
      // expression: the three views intentionally use different read paths.
      for(const [method,property,initial] of [['getFloatTimeDomainData','timePeak',0],['getFloatFrequencyData','frequencyPeak',-Infinity]]){
        const original=AnalyserNode.prototype[method];
        AnalyserNode.prototype[method]=function(buffer){
          const result=original.call(this,buffer);
          const mode=document.getElementById('audioMonitorMode')?.value;
          if(mode){
            const signal=observation.signal[mode]??={};
            let peak=signal[property]??initial;
            for(const value of buffer)peak=Math.max(peak,property==='timePeak'?Math.abs(value):value);
            signal[property]=peak;
          }
          return result;
        };
      }
      for(const method of ['clearRect','fillRect','stroke']){
        const draw=CanvasRenderingContext2D.prototype[method];
        CanvasRenderingContext2D.prototype[method]=function(...args){
          if(Object.hasOwn(observation.draws,this.canvas.id))observation.draws[this.canvas.id]++;
          return draw.apply(this,args);
        };
      }
    });
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const introductionUrl=process.env.INTRODUCTION_TEST_URL||localServer.url;
    await page.goto(introductionUrl);
    let expectedMode='envelope';
    for(const id of ['example-diy-fm-sine','example-diy-fm-modulation']){
      const element=page.locator(`iframe[data-playground-src="${id}"]`);
      await element.scrollIntoViewIfNeeded();
      const url=new URL(await element.getAttribute('src'),introductionUrl);
      assert.equal(url.searchParams.get('mode'),'full');assert.equal(url.searchParams.get('monitor'),'1');
      const frame=await (await element.elementHandle()).contentFrame();
      // A lazy iframe may already have been prefetched before the first frame
      // changes mode. Navigation verifies persisted preferences on fresh load.
      if(expectedMode==='spectrum')await frame.goto(url.href);
      await frame.locator('#startupNotice').waitFor({state:'hidden'});
      assert(await frame.locator('#bottomDock #audioMonitorPanel').isVisible());
      assert.equal(await frame.locator('#audioMonitorTab').getAttribute('aria-selected'),'true');
      assert(!await frame.locator('body').evaluate(body=>body.classList.contains('has-inline-audio-monitor')));
      assert.equal(await frame.locator('#audioMonitorMode').inputValue(),expectedMode);
      const divider=frame.locator('.bottom-panel-divider');
      const before=Number(await divider.getAttribute('aria-valuenow'));
      await divider.focus();await divider.press('ArrowUp');
      assert(Number(await divider.getAttribute('aria-valuenow'))>before);
      await frame.locator('#runButton').click();
      for(const mode of Object.keys(views))await checkSelectedView(frame,mode);
      await frame.locator('#consoleTab').click();assert(!await frame.locator('#audioMonitorPanel').isVisible());
      await frame.locator('#audioMonitorTab').click();assert(await frame.locator('#audioMonitorPanel').isVisible());
      assert.equal(await frame.locator('#audioMonitorMode').inputValue(),'spectrum');
      await frame.locator('#stopButton').click();
      expectedMode='spectrum';
    }
    assert.deepEqual(errors,[]);
    console.log('Both Japanese DIY FM embeds use resizable bottom Audio tabs; Envelope, Oscilloscope and Spectrum show live audio one view at a time, and the selected mode survives a fresh iframe load.');
  }finally{await browser?.close();await localServer?.close();}
})().catch(error=>{console.error(error);process.exit(1);});
