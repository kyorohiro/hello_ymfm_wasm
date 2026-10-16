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
  window.__monitorContexts = [];
  const Context = window.AudioContext;
  window.AudioContext = new Proxy(Context,{construct(target,args,newTarget) {
    const context = Reflect.construct(target,args,newTarget),resume = context.resume.bind(context);
    context.__monitorResumeCalls = 0;
    context.resume = (...args) => {context.__monitorResumeCalls++; return resume(...args);};
    window.__monitorContexts.push(context);
    return context;
  }});
  window.__resetMonitorMetrics = () => {window.__monitorMetrics = {timeReads:0,fftReads:0,callbacks:0,tickMs:0,canvas:{},lastTime:null,lastFrequency:null};};
  window.__resetMonitorMetrics();
  for (const [method,field,last] of [['getFloatTimeDomainData','timeReads','lastTime'],['getFloatFrequencyData','fftReads','lastFrequency']]) {
    const original = AnalyserNode.prototype[method];
    AnalyserNode.prototype[method] = function(data) {
      original.call(this,data);
      if (!this.__independentMeter) {window.__monitorMetrics[field]++; window.__monitorMetrics[last] = data;}
    };
  }
  const methods = ['fillRect','lineTo','moveTo','stroke','fillText'];
  const native = new Map(methods.map(method => [method,CanvasRenderingContext2D.prototype[method]]));
  const wrapped = new Map(methods.map(method => [method,function(...args) {
    if (this.canvas.id.startsWith('audioMonitor')) {
      const metrics = window.__monitorMetrics;
      const counts = metrics.canvas[this.canvas.id] ??= {fillRect:0,lineTo:0,moveTo:0,stroke:0,fillText:0,labels:{},traces:{},ranges:[]};
      counts[method]++;
      if (method === 'fillText' && args[1] <= 10) {
        counts.labels[args[2]] = String(args[0]);
        const value = Number(args[0]);
        if (args[2] <= 25 && value > 0 && Number.isFinite(value)) counts.ranges.push(value);
      }
      if (['moveTo','lineTo'].includes(method) && ['#69cfff','#ffba69'].includes(this.strokeStyle)) {
        const trace = counts.traces[this.strokeStyle] ??= {minY:Infinity,maxY:-Infinity};
        trace.minY = Math.min(trace.minY,args[1]); trace.maxY = Math.max(trace.maxY,args[1]);
      }
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
      outputRms:Math.sqrt(pcm.reduce((sum,value) => sum + (value - mean) ** 2,0) / pcm.length),
      audioState:{contexts:window.__monitorContexts.length,resumes:window.__monitorContexts.map(context => context.__monitorResumeCalls),
        context:window.__monitorContexts.indexOf(window.__audioMonitorTest.megaDrive.audioContext),
        master:window.__audioMonitorTest.megaDrive.audio.masterVolume,listening:window.__audioMonitorTest.megaDrive.audio.listeningVolume}};
  });
}

async function measure(page,ms,canvas = true) {
  await page.evaluate(canvas => {window.__countMonitorCanvas(canvas); window.__resetMonitorMetrics();},canvas);
  await page.waitForTimeout(ms);
  return snapshot(page);
}

const selectMode = (page,mode) => page.selectOption('#audioMonitorMode',mode);
const scaleValues = ['auto','2','1','0.5','0.2','0.1','0.05','0.02','0.01','0.005','0.001'];
const extent = canvas => Math.max(...Object.values(canvas.labels).map(Number).filter(Number.isFinite).map(Math.abs));
const span = (canvas,color = '#69cfff') => canvas.traces[color].maxY - canvas.traces[color].minY;

async function changeScale(page,value) {
  return page.evaluate(value => {
    window.__countMonitorCanvas(true); window.__resetMonitorMetrics();
    const select = document.getElementById('audioMonitorScale'); select.value = value;
    select.dispatchEvent(new Event('change',{bubbles:true}));
    const m = window.__monitorMetrics;
    return {timeReads:m.timeReads,fftReads:m.fftReads,canvas:m.canvas};
  },value);
}

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
    assert.equal(await page.locator('#audioMonitorScale').inputValue(),'auto','a fresh session defaults to Auto Y range');
    assert.deepEqual(await page.locator('#audioMonitorScale option').evaluateAll(options => options.map(option => option.value)),scaleValues);
    await page.evaluate(() => {
      document.getElementById('workerExecution').checked = false;
      // A quiet carrier makes the benefit of Auto observable with real PCM.
      window.__audioMonitorTest.editor.setValue(`const quiet=structuredClone(FM_PRESETS.sine); quiet.operators[3].tl=32;
fm.setPreset(CH1,quiet); fm.setPan(CH1,true,false);
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
      assert.equal(await page.locator('#audioMonitorScaleControl').isVisible(),mode !== 'spectrum','Spectrum keeps its dBFS scale');
      const counted = await measure(page,1000);
      const reads = counted.timeReads + counted.fftReads;
      assert(reads > 5 && reads <= 20,'the selected monitor should update near its 15 Hz budget: ' + JSON.stringify({mode,counted}));
      if (mode === 'spectrum') {
        assert.equal(counted.timeReads,0,'Spectrum must not read waveform data');
        assert(counted.maxDb > -60,'Spectrum must receive the final sine output');
      } else {
        assert.equal(counted.fftReads,0,mode + ' must not request FFT data');
        assert(counted.timeSignal.peak > .001,mode + ' must receive real PCM');
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

    const scales = [];
    await selectMode(page,'waveform'); await page.waitForTimeout(200);
    const audioState = (await snapshot(page)).audioState;
    for (const value of ['1','0.05','auto']) {
      const changed = await changeScale(page,value);
      assert.equal(changed.timeReads + changed.fftReads,0,'changing Y range reuses captured PCM synchronously');
      assert(changed.canvas.audioMonitorWave?.stroke > 0,'changing Y range repaints the cached waveform immediately');
      const result = await measure(page,400),canvas = result.canvas.audioMonitorWave;
      assert.equal(result.fftReads,0,'waveform range changes must not introduce FFT reads');
      assert(result.timeReads >= 3 && result.timeReads <= 8,'range selection retains the15Hz analysis budget');
      assert.deepEqual(result.audioState,audioState,'display range cannot create/resume audio or change either volume');
      assert(Math.abs(result.outputRms / baseline - 1) < .03,'range selection must not change final audible gain');
      if (value !== 'auto') assert.equal(extent(canvas),Number(value),'numeric Y labels show the selected physical amplitude');
      else {
        assert(extent(canvas) < .05 && extent(canvas) >= .001,'Auto follows the quiet signal rather than remaining ±1');
        assert(Math.max(...canvas.ranges) / Math.min(...canvas.ranges) < 1.05,'a steady tone retains a stable Auto scale across captures');
      }
      scales.push({value,...result});
    }
    assert(Math.abs(span(scales[1].canvas.audioMonitorWave) / span(scales[0].canvas.audioMonitorWave) - 20) < 1,
      'fixed ±0.05 magnifies the same quiet PCM20× compared with ±1');
    assert(span(scales[2].canvas.audioMonitorWave) > span(scales[0].canvas.audioMonitorWave) * 10,
      'Auto makes the small real waveform visibly taller');
    await selectMode(page,'envelope'); await page.waitForTimeout(250);
    await changeScale(page,'0.05');
    const envelopeScale = await measure(page,250);
    assert.equal(extent(envelopeScale.canvas.audioMonitorEnvelope),.05,'Envelope shares the explicit amplitude scale');
    assert.equal(envelopeScale.fftReads,0);
    assert.deepEqual(envelopeScale.audioState,audioState);
    await page.screenshot({path:path.join(artifacts,`playground-audio-${name}-fixed-range.png`)});

    await selectMode(page,'waveform'); await page.selectOption('#audioMonitorChannel','1'); await page.waitForTimeout(250);
    const right = await measure(page,350);
    assert(right.timeReads > 0 && right.timeSignal.peak < .00001,'Right channel must be silent for a left-only note');
    assert(Math.abs(right.outputRms / baseline - 1) < .03,'choosing a channel must not pan the audible output');
    await page.selectOption('#audioMonitorChannel','0'); await page.waitForTimeout(200);
    await page.click('#audioMonitorPause'); await page.waitForTimeout(100);
    const paused = await measure(page,350);
    assert.equal(paused.timeReads + paused.fftReads,0); assert.deepEqual(paused.canvas,{});
    assert(Math.abs(paused.outputRms / baseline - 1) < .03,'Pause must affect analysis only');
    const pausedScales = [];
    for (const value of ['1','0.05']) {
      const changed = await changeScale(page,value);
      assert.equal(changed.timeReads + changed.fftReads,0);
      const repaint = await snapshot(page);
      assert.equal(repaint.timeReads + repaint.fftReads,0,'paused scale repaint must not fetch fresh PCM');
      assert(repaint.canvas.audioMonitorWave?.stroke > 0,'paused scale selection must repaint the cached waveform');
      assert.equal(extent(repaint.canvas.audioMonitorWave),Number(value));
      assert.deepEqual(repaint.audioState,audioState,'paused range selection must not initialize or resume audio');
      assert(Math.abs(repaint.outputRms / baseline - 1) < .03);
      pausedScales.push({value,...repaint});
    }
    assert(Math.abs(span(pausedScales[1].canvas.audioMonitorWave) / span(pausedScales[0].canvas.audioMonitorWave) - 20) < .001,
      'paused range selection rescales the exact cached samples');
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
    assert.equal(await page.locator('#audioMonitorScale').inputValue(),'0.05','the fixed range survives reload independently of view');
    assert(!(await page.locator('#audioMonitorScaleControl').isVisible()),'Spectrum retains dBFS after restoring a fixed waveform range');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({browser:name,passed:true,results,scales,envelopeScale,right,paused,pausedScales,hidden,persisted:'spectrum',persistedScale:'0.05',
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
