// Real liveFx input/output and selected-only plots in fresh browser sessions.
// Test hooks are added to self-hosted module responses, never application files.
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
      '\nwindow.__fxMonitorTest={runtime,megaDrive,get editor(){return editorAdapter;}};');
    if (pathname.endsWith('/playground_fx_monitor.js')) {
      const source = body.toString();
      assert(source.includes('export function spectrum(samples) {') && source.includes(' function receive(data){'));
      body = Buffer.from(source.replace('export function spectrum(samples) {',
        'export function spectrum(samples) { window.__fxMonitorMetrics.fftCalls++;')
        .replace(' function receive(data){',` function receive(data){
  if(visible&&!document.hidden&&data.id===id&&data.input){
   window.__fxMonitorMetrics.snapshots++;
   window.__fxMonitorMetrics.latest=data;
  }`));
    }
    response.setHeader('Content-Type',mime[path.extname(filename)] || 'application/octet-stream');
    response.end(body);
  } catch (error) {response.writeHead(404).end(String(error));}
});

function instrumentation() {
  window.__fxMonitorContexts = [];
  const Context = window.AudioContext;
  window.AudioContext = new Proxy(Context,{construct(target,args,newTarget) {
    const context = Reflect.construct(target,args,newTarget),resume = context.resume.bind(context);
    context.__monitorResumeCalls = 0;
    context.resume = (...args) => {context.__monitorResumeCalls++; return resume(...args);};
    window.__fxMonitorContexts.push(context);
    return context;
  }});
  window.__resetFXMonitorMetrics = () => {window.__fxMonitorMetrics = {fftCalls:0,snapshots:0,requests:0,canvas:{},latest:null};};
  window.__resetFXMonitorMetrics();
  for (const method of ['stroke','clearRect','moveTo','lineTo','fillText']) {
    const original = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function(...args) {
      if (['fxMonitorWave','fxMonitorFFT'].includes(this.canvas.id)) {
        const counts = window.__fxMonitorMetrics.canvas[this.canvas.id] ??= {stroke:0,clearRect:0,moveTo:0,lineTo:0,fillText:0,colors:{},labels:{},traces:{},ranges:[]};
        counts[method]++;
        if (method === 'stroke') counts.colors[this.strokeStyle] = (counts.colors[this.strokeStyle] || 0) + 1;
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
      return original.apply(this,args);
    };
  }
}

async function snapshot(page) {
  return page.evaluate(() => {
    const m = window.__fxMonitorMetrics,rms = data => data ? Math.sqrt(data.reduce((sum,value) => sum + value * value,0) / data.length) : null;
    const p = window.__fxMonitorTest,pcm = new Float32Array(p.meter.fftSize);
    p.meter.getFloatTimeDomainData(pcm);
    const mean = pcm.reduce((sum,value) => sum + value,0) / pcm.length;
    const panel = document.getElementById('fxMonitorPanel'),rect = panel.getBoundingClientRect();
    return {fftCalls:m.fftCalls,snapshots:m.snapshots,requests:m.requests,canvas:m.canvas,
      inputRms:rms(m.latest?.input),outputRms:rms(m.latest?.output),captureRate:m.latest?.rate,
      outputLevel:Math.sqrt(pcm.reduce((sum,value) => sum + (value - mean) ** 2,0) / pcm.length),
      audioState:{contexts:window.__fxMonitorContexts.length,resumes:window.__fxMonitorContexts.map(context => context.__monitorResumeCalls),
        context:window.__fxMonitorContexts.indexOf(p.megaDrive.audioContext),master:p.megaDrive.audio.masterVolume,listening:p.megaDrive.audio.listeningVolume},
      bounds:{top:rect.top,bottom:rect.bottom,canvases:[...panel.querySelectorAll('canvas')].filter(canvas => canvas.getClientRects().length).map(canvas => {
        const box = canvas.getBoundingClientRect(); return {id:canvas.id,top:box.top,bottom:box.bottom,height:box.height};
      })}};
  });
}

async function measure(page,ms = 1000) {
  await page.evaluate(() => window.__resetFXMonitorMetrics());
  await page.waitForTimeout(ms);
  return snapshot(page);
}

const scaleValues = ['auto','2','1','0.5','0.2','0.1','0.05','0.02','0.01','0.005','0.001'];
const extent = canvas => Math.max(...Object.values(canvas.labels).map(Number).filter(Number.isFinite).map(Math.abs));
const span = (canvas,color = '#69cfff') => canvas.traces[color].maxY - canvas.traces[color].minY;

async function changeScale(page,value) {
  return page.evaluate(value => {
    window.__resetFXMonitorMetrics();
    const select = document.getElementById('fxMonitorScale'); select.value = value;
    select.dispatchEvent(new Event('change',{bubbles:true}));
    const m = window.__fxMonitorMetrics;
    return {fftCalls:m.fftCalls,requests:m.requests,snapshots:m.snapshots,canvas:m.canvas};
  },value);
}

async function checkBrowser(name,type,url) {
  const browser = await type.launch({headless:true,...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'}),errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror',error => errors.push(error.message));
    await page.addInitScript(instrumentation);
    await page.goto(url);
    await page.waitForFunction(() => window.__fxMonitorTest?.editor.kind === 'monaco');
    await page.evaluate(() => {
      document.getElementById('workerExecution').checked = false;
      window.__fxMonitorTest.editor.setValue(`
const quiet=structuredClone(FM_PRESETS.sine); quiet.operators[3].tl=32;
fm.setPreset(CH1,quiet); fm.setPan(CH1,true,false);
liveFx('monitor-half',{context:{gain:.5},process(input,output,state,context){
  for(let channel=0;channel<output.length;channel++)for(let i=0;i<output[channel].length;i++)
    output[channel][i]=(input[channel]?.[i]??0)*context.gain;
}});
liveLoop('fx-monitor-test',async()=>{await play('A4',{channel:CH1,seconds:60});});`);
    });
    await page.click('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled);
    await page.evaluate(() => {
      const p = window.__fxMonitorTest,context = p.megaDrive.audioContext;
      const mute = context.createGain(); mute.gain.value = 0; mute.connect(context.destination);
      p.meter = context.createAnalyser(); p.meter.fftSize = 4096; p.meter.connect(mute);
      p.megaDrive.audio.connectOutputMonitor(p.meter);
      const port = p.megaDrive.audio.nativeFX.node.port,send = port.postMessage.bind(port);
      port.postMessage = (data,...args) => {
        if (data.op === 'fx-monitor' && data.enabled) window.__fxMonitorMetrics.requests++;
        return send(data,...args);
      };
    });
    await page.click('#fxMonitorTab');
    assert.equal(await page.locator('#fxMonitorMode').inputValue(),'waveform','fresh sessions default to Waveform');
    assert.equal(await page.locator('#fxMonitorScale').inputValue(),'auto','fresh sessions default to Auto Y range');
    assert.deepEqual(await page.locator('#fxMonitorScale option').evaluateAll(options => options.map(option => option.value)),scaleValues);
    await page.waitForFunction(() => window.__fxMonitorMetrics.latest?.input?.some(value => Math.abs(value) > .001));
    const results = [];
    for (const mode of ['waveform','spectrum']) {
      await page.selectOption('#fxMonitorMode',mode); await page.waitForTimeout(200);
      assert.equal(await page.locator('#fxMonitorScaleControl').isVisible(),mode === 'waveform','Spectrum keeps its dBFS scale');
      const result = await measure(page);
      assert(result.snapshots >= 6 && result.snapshots <= 14,'capture remains near its existing10Hz rate: ' + JSON.stringify({mode,result}));
      assert(result.requests >= 6 && result.requests <= 14);
      assert(result.inputRms > .001 && result.outputRms > .001,'liveFx must supply actual input and output PCM');
      assert(Math.abs(result.outputRms / result.inputRms - .5) < .005,'view switching must retain the half-gain effect');
      assert.equal(result.fftCalls,mode === 'spectrum' ? result.snapshots * 2 : 0,'FFT runs only for the two Spectrum traces');
      const id = mode === 'spectrum' ? 'fxMonitorFFT' : 'fxMonitorWave';
      assert.deepEqual(Object.keys(result.canvas),[id],'only the selected plot may be painted');
      assert(result.canvas[id].colors['#69cfff'] > 0 && result.canvas[id].colors['#ffba69'] > 0,
        'the selected plot must retain blue input and orange output');
      assert.equal(result.bounds.canvases.length,1,'only the selected canvas is visible');
      const plot = result.bounds.canvases[0];
      assert(plot.id === id && plot.top >= result.bounds.top - 1 && plot.bottom <= result.bounds.bottom + 1,
        'the complete plot must fit the default260px panel: ' + JSON.stringify(result.bounds));
      await page.screenshot({path:path.join(artifacts,`playground-fx-${name}-${mode}.png`)});
      results.push({mode,...result});
    }
    const level = results[0].outputLevel;
    assert(level > .001 && Math.abs(results[1].outputLevel / level - 1) < .03,'analysis mode must not change final audible gain');
    await page.selectOption('#fxMonitorMode','waveform'); await page.waitForTimeout(250);
    const audioState = (await snapshot(page)).audioState,scales = [];
    for (const value of ['1','0.05','auto']) {
      const changed = await changeScale(page,value);
      assert.equal(changed.fftCalls + changed.requests + changed.snapshots,0,'range changes reuse cached PCM without another capture or FFT');
      assert(changed.canvas.fxMonitorWave?.stroke > 0,'range changes repaint the captured input and output immediately');
      const result = await measure(page,500),canvas = result.canvas.fxMonitorWave;
      assert(result.snapshots >= 3 && result.snapshots <= 8 && result.requests >= 3 && result.requests <= 8,
        'range selection retains the10Hz capture budget');
      assert.equal(result.fftCalls,0,'waveform scaling does not calculate spectra');
      assert.deepEqual(result.audioState,audioState,'range controls cannot create/resume audio or change either volume');
      assert(Math.abs(result.outputLevel / level - 1) < .03,'range controls must not change final audible gain');
      assert(Math.abs(result.outputRms / result.inputRms - .5) < .005,'the live effect keeps its physical input/output level ratio');
      assert(Math.abs(span(canvas,'#ffba69') / span(canvas) - .5) < .005,
        'both overlays use the same Y scale and show the actual half-amplitude output');
      if (value !== 'auto') assert.equal(extent(canvas),Number(value),'Y labels show the selected physical amplitude');
      else {
        assert(extent(canvas) < .05 && extent(canvas) >= .001,'Auto magnifies the quiet actual input');
        assert(Math.max(...canvas.ranges) / Math.min(...canvas.ranges) < 1.05,'a steady effect has a stable Auto range across captures');
      }
      scales.push({value,...result});
    }
    assert(Math.abs(span(scales[1].canvas.fxMonitorWave) / span(scales[0].canvas.fxMonitorWave) - 20) < 1,
      'fixed ±0.05 magnifies the same PCM20× compared with ±1');
    assert(span(scales[2].canvas.fxMonitorWave) > span(scales[0].canvas.fxMonitorWave) * 10,
      'Auto makes the quiet input/output visibly taller');
    await changeScale(page,'0.05');
    await page.screenshot({path:path.join(artifacts,`playground-fx-${name}-fixed-range.png`)});
    await page.selectOption('#fxMonitorChannel','1'); await page.waitForTimeout(200);
    const right = await measure(page,400);
    assert(right.snapshots > 0 && right.inputRms < .00001 && right.outputRms < .00001,'Right capture is silent for the left-only note');
    assert(Math.abs(right.outputLevel / level - 1) < .03,'observing Right must not alter output routing');
    await page.selectOption('#fxMonitorChannel','0');
    await page.click('#consoleTab'); await page.waitForTimeout(200);
    const hidden = await measure(page,400);
    assert.equal(hidden.requests,0); assert.equal(hidden.snapshots,0); assert.equal(hidden.fftCalls,0); assert.deepEqual(hidden.canvas,{});
    assert(Math.abs(hidden.outputLevel / level - 1) < .03,'hiding FX Monitor must keep the effect and audio playing');
    await page.click('#fxMonitorTab'); await page.waitForTimeout(200);
    assert((await measure(page,400)).snapshots > 0,'showing FX Monitor resumes capture');
    await page.selectOption('#fxMonitorMode','spectrum');
    await page.evaluate(() => window.__fxMonitorTest.runtime.stop());
    await page.reload();
    await page.waitForFunction(() => window.__fxMonitorTest?.editor.kind === 'monaco');
    await page.click('#fxMonitorTab');
    assert.equal(await page.locator('#fxMonitorMode').inputValue(),'spectrum','the last selected plot survives reload');
    assert.equal(await page.locator('#fxMonitorScale').inputValue(),'0.05','the selected fixed range survives reload independently of view');
    assert(!(await page.locator('#fxMonitorScaleControl').isVisible()),'restoring a fixed waveform range must not replace Spectrum dBFS');
    assert(await page.locator('#fxMonitorSpectrumView').isVisible());
    assert(!(await page.locator('#fxMonitorWaveView').isVisible()));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({browser:name,passed:true,results,scales,right,hidden,persisted:'spectrum',persistedScale:'0.05',errors}));
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
