// Real final-output monitoring, selected-view work and a bounded headless CPU
// comparison. Source instrumentation is confined to the self-hosted response.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {chromium,webkit} = require('playwright');

const docs = path.resolve(__dirname,'../docs');
const artifacts = process.env.PANEL_TEST_ARTIFACT_DIR || os.tmpdir();
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const server = http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let filename = path.resolve(docs,'.' + pathname);
    if (!filename.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename,'index.html');
    let body = await fs.readFile(filename);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() +
      '\nwindow.__audioMonitorTest={runtime,megaDrive,get editor(){return editorAdapter;}};');
    if (pathname.endsWith('/playground_audio_monitor.js')) {
      const source = body.toString();
      assert(source.includes('  function tick(time) {') && source.includes('  function refresh() {'));
      body = Buffer.from(source.replace('  function tick(time) {','  function __monitorTick(time) {')
        .replace('  function refresh() {',`  function tick(time) {
    const start = performance.now();
    try {return __monitorTick(time);}
    finally {window.__monitorMetrics.callbacks++; window.__monitorMetrics.tickMs += performance.now() - start;}
  }

  function refresh() {`));
    }
    response.setHeader('Content-Type',mime[path.extname(filename)] || 'application/octet-stream');
    response.end(body);
  } catch (error) {response.writeHead(404).end(String(error));}
});

function instrumentation() {
  window.__resetMonitorMetrics = () => {window.__monitorMetrics = {timeReads:0,fftReads:0,callbacks:0,tickMs:0,canvas:{},lastTime:null,lastFrequency:null};};
  window.__resetMonitorMetrics();
  for (const [method,field,last] of [['getFloatTimeDomainData','timeReads','lastTime'],['getFloatFrequencyData','fftReads','lastFrequency']]) {
    const original = AnalyserNode.prototype[method];
    AnalyserNode.prototype[method] = function(data) {
      original.call(this,data);
      if (!this.__independentMeter) {window.__monitorMetrics[field]++; window.__monitorMetrics[last] = data;}
    };
  }
  const methods = ['fillRect','lineTo','stroke'];
  const native = new Map(methods.map(method => [method,CanvasRenderingContext2D.prototype[method]]));
  const wrapped = new Map(methods.map(method => [method,function(...args) {
    if (this.canvas.id.startsWith('audioMonitor')) {
      const metrics = window.__monitorMetrics;
      const counts = metrics.canvas[this.canvas.id] ??= {fillRect:0,lineTo:0,stroke:0};
      counts[method]++;
    }
    return native.get(method).apply(this,args);
  }]));
  window.__countMonitorCanvas = enabled => {
    for (const method of methods) CanvasRenderingContext2D.prototype[method] = (enabled ? wrapped : native).get(method);
  };
  window.__countMonitorCanvas(true);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const m = window.__monitorMetrics,signal = data => {
      if (!data) return null;
      let peak = 0,energy = 0;
      for (const value of data) {peak = Math.max(peak,Math.abs(value)); energy += value * value;}
      return {peak,rms:Math.sqrt(energy / data.length)};
    };
    const pcm = new Float32Array(window.__audioMonitorTest.meter.fftSize);
    window.__audioMonitorTest.meter.getFloatTimeDomainData(pcm);
    const mean = pcm.reduce((sum,value) => sum + value,0) / pcm.length;
    return {timeReads:m.timeReads,fftReads:m.fftReads,callbacks:m.callbacks,tickMs:m.tickMs,canvas:m.canvas,
      timeSignal:signal(m.lastTime),maxDb:m.lastFrequency ? Math.max(...m.lastFrequency) : null,
      outputRms:Math.sqrt(pcm.reduce((sum,value) => sum + (value - mean) ** 2,0) / pcm.length)};
  });
}

async function measure(page,ms,canvas = true) {
  await page.evaluate(canvas => {window.__countMonitorCanvas(canvas); window.__resetMonitorMetrics();},canvas);
  await page.waitForTimeout(ms);
  return snapshot(page);
}

const selectMode = (page,mode) => page.selectOption('#audioMonitorMode',mode);

async function checkBrowser(name,type,url) {
  const browser = await type.launch({headless:true,...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'}),errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror',error => errors.push(error.message));
    await page.addInitScript(instrumentation);
    await page.goto(url);
    await page.waitForFunction(() => window.__audioMonitorTest?.editor.kind === 'monaco');
    await page.click('#audioMonitorTab');
    assert.equal(await page.locator('#audioMonitorMode').inputValue(),'envelope','a fresh session defaults to Envelope');
    await page.evaluate(() => {
      document.getElementById('workerExecution').checked = false;
      window.__audioMonitorTest.editor.setValue(`fm.setPreset(CH1,FM_PRESETS.sine); fm.setPan(CH1,true,false);
liveLoop('monitor-test',async()=>{await play('A4',{channel:CH1,seconds:60});});`);
    });
    await page.click('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled);
    await page.evaluate(() => {
      const p = window.__audioMonitorTest,context = p.megaDrive.audioContext;
      const mute = context.createGain(); mute.gain.value = 0; mute.connect(context.destination);
      p.meter = context.createAnalyser(); p.meter.__independentMeter = true; p.meter.fftSize = 4096; p.meter.connect(mute);
      p.megaDrive.audio.connectOutputMonitor(p.meter);
    });
    await page.waitForTimeout(250);
    const results = [];
    for (const mode of ['envelope','waveform','spectrum']) {
      await selectMode(page,mode); await page.waitForTimeout(200);
      const counted = await measure(page,1000);
      const reads = counted.timeReads + counted.fftReads;
      assert(reads > 5 && reads <= 20,'the selected monitor should update near its 15 Hz budget: ' + JSON.stringify({mode,counted}));
      if (mode === 'spectrum') {
        assert.equal(counted.timeReads,0,'Spectrum must not read waveform data');
        assert(counted.maxDb > -60,'Spectrum must receive the final sine output');
      } else {
        assert.equal(counted.fftReads,0,mode + ' must not request FFT data');
        assert(counted.timeSignal.peak > .01,mode + ' must receive real PCM');
      }
      assert.equal(Object.keys(counted.canvas).length,1,'only the selected plot may be drawn');
      assert(Object.values(counted.canvas)[0].stroke > 0,'the selected canvas must contain a plotted signal');
      // Native canvas methods are restored for CPU timing; per-segment counting
      // must not inflate the comparison between plots with different geometry.
      const timed = await measure(page,1000,false);
      const timedReads = timed.timeReads + timed.fftReads;
      assert(timedReads > 5);
      assert(Math.abs(timed.outputRms / counted.outputRms - 1) < .03,'analysis must not change audible gain');
      const bounds = await page.evaluate(() => {
        const panel = document.getElementById('audioMonitorPanel'),rect = panel.getBoundingClientRect();
        const visible = [...panel.querySelectorAll('canvas')].filter(canvas => canvas.getClientRects().length);
        return {panelTop:rect.top,panelBottom:rect.bottom,clientHeight:panel.clientHeight,scrollHeight:panel.scrollHeight,
          canvases:visible.map(canvas => {
            const plot = canvas.getBoundingClientRect();
            return {id:canvas.id,top:plot.top,bottom:plot.bottom,height:plot.height,
              visibleHeight:Math.max(0,Math.min(plot.bottom,rect.bottom) - Math.max(plot.top,rect.top))};
          })};
      });
      assert.equal(bounds.canvases.length,1,'only the selected canvas is visible');
      for (const plot of bounds.canvases) {
        assert(plot.top >= bounds.panelTop - 1 && plot.bottom <= bounds.panelBottom + 1 &&
          plot.visibleHeight >= plot.height - 1,
        'the complete plot must fit the default 260 px panel without scrolling: ' + JSON.stringify({mode,bounds}));
      }
      await page.screenshot({path:path.join(artifacts,`playground-audio-${name}-${mode}.png`)});
      results.push({mode,counts:counted,benchmark:{windowMs:1000,callbacks:timed.callbacks,reads:timedReads,
        tickCpuMs:timed.tickMs,cpuMsPerRead:timed.tickMs / timedReads},outputRms:timed.outputRms,bounds});
    }
    const baseline = results[0].outputRms;
    assert(results.every(result => Math.abs(result.outputRms / baseline - 1) < .03),'switching views must retain output gain');

    await selectMode(page,'waveform'); await page.selectOption('#audioMonitorChannel','1'); await page.waitForTimeout(250);
    const right = await measure(page,350);
    assert(right.timeReads > 0 && right.timeSignal.peak < .00001,'Right channel must be silent for a left-only note');
    assert(Math.abs(right.outputRms / baseline - 1) < .03,'choosing a channel must not pan the audible output');
    await page.selectOption('#audioMonitorChannel','0'); await page.waitForTimeout(200);
    await page.click('#audioMonitorPause'); await page.waitForTimeout(100);
    const paused = await measure(page,350);
    assert.equal(paused.timeReads + paused.fftReads,0); assert.deepEqual(paused.canvas,{});
    assert(Math.abs(paused.outputRms / baseline - 1) < .03,'Pause must affect analysis only');
    await page.click('#audioMonitorPause'); await page.waitForTimeout(200);
    assert((await measure(page,350)).timeReads > 0,'Resume must restart analysis');
    await page.click('#consoleTab'); await page.waitForTimeout(100);
    const hidden = await measure(page,350);
    assert.equal(hidden.timeReads + hidden.fftReads,0); assert.deepEqual(hidden.canvas,{});
    assert(Math.abs(hidden.outputRms / baseline - 1) < .03,'hiding Audio must retain audible output');
    await page.click('#audioMonitorTab'); await selectMode(page,'spectrum');
    await page.evaluate(() => window.__audioMonitorTest.runtime.stop());
    await page.reload();
    await page.waitForFunction(() => window.__audioMonitorTest?.editor.kind === 'monaco');
    await page.click('#audioMonitorTab');
    assert.equal(await page.locator('#audioMonitorMode').inputValue(),'spectrum','the last selected view must survive reload');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({browser:name,passed:true,results,right,paused,hidden,persisted:'spectrum',
      observation:'Instrumented headless monitor callback CPU, not physical device latency or a statistical performance guarantee.',errors}));
    await page.close();
  } finally {await browser.close();}
}

(async () => {
  await new Promise((resolve,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',resolve);});
  try {
    const url = `http://127.0.0.1:${server.address().port}/playground/index.html`;
    const selected = process.argv.includes('--chromium') ? [['chromium',chromium]]
      : process.argv.includes('--webkit') ? [['webkit',webkit]] : [['chromium',chromium],['webkit',webkit]];
    for (const [name,type] of selected) await checkBrowser(name,type,url);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
