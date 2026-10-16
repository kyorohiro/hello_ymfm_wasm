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
  window.__resetFXMonitorMetrics = () => {window.__fxMonitorMetrics = {fftCalls:0,snapshots:0,requests:0,canvas:{},latest:null};};
  window.__resetFXMonitorMetrics();
  for (const method of ['stroke','clearRect']) {
    const original = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function(...args) {
      if (['fxMonitorWave','fxMonitorFFT'].includes(this.canvas.id)) {
        const counts = window.__fxMonitorMetrics.canvas[this.canvas.id] ??= {stroke:0,clearRect:0,colors:{}};
        counts[method]++;
        if (method === 'stroke') counts.colors[this.strokeStyle] = (counts.colors[this.strokeStyle] || 0) + 1;
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
fm.setPreset(CH1,FM_PRESETS.sine); fm.setPan(CH1,true,false);
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
    await page.waitForFunction(() => window.__fxMonitorMetrics.latest?.input?.some(value => Math.abs(value) > .001));
    const results = [];
    for (const mode of ['waveform','spectrum']) {
      await page.selectOption('#fxMonitorMode',mode); await page.waitForTimeout(200);
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
    await page.evaluate(() => window.__fxMonitorTest.runtime.stop());
    await page.reload();
    await page.waitForFunction(() => window.__fxMonitorTest?.editor.kind === 'monaco');
    await page.click('#fxMonitorTab');
    assert.equal(await page.locator('#fxMonitorMode').inputValue(),'spectrum','the last selected plot survives reload');
    assert(await page.locator('#fxMonitorSpectrumView').isVisible());
    assert(!(await page.locator('#fxMonitorWaveView').isVisible()));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({browser:name,passed:true,results,right,hidden,persisted:'spectrum',errors}));
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
