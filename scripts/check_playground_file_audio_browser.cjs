// Observe the actual lazy TFI/VGI preview graph before Run, then switch back to
// the Playground graph. All private test access is in the self-hosted response.
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
      '\nwindow.__fileAudioTest={runtime,megaDrive,tfiFileEditor,virtualFiles,openVirtualFile,get editor(){return editorAdapter;}};');
    response.setHeader('Content-Type',mime[path.extname(filename)] || 'application/octet-stream');
    response.end(body);
  } catch (error) {response.writeHead(404).end(String(error));}
});

function instrumentation() {
  window.__contexts = [];
  window.__contextIds = new WeakMap();
  const Context = window.AudioContext;
  window.AudioContext = new Proxy(Context,{construct(target,args,newTarget) {
    const context = Reflect.construct(target,args,newTarget);
    window.__contexts.push(context); window.__contextIds.set(context,window.__contexts.length);
    const resume = context.resume.bind(context); context.__resumeCalls = 0;
    context.resume = (...args) => {context.__resumeCalls++; return resume(...args);};
    return context;
  }});
  window.__resetFileAudioMetrics = () => {window.__fileAudioMetrics = {timeReads:0,fftReads:0,context:null,lastTime:null,lastFrequency:null};};
  window.__resetFileAudioMetrics();
  for (const [method,field,last] of [['getFloatTimeDomainData','timeReads','lastTime'],['getFloatFrequencyData','fftReads','lastFrequency']]) {
    const original = AnalyserNode.prototype[method];
    AnalyserNode.prototype[method] = function(data) {
      original.call(this,data);
      if (!this.__testMeter) {
        const m = window.__fileAudioMetrics;
        m[field]++; m[last] = data; m.context = window.__contextIds.get(this.context);
      }
    };
  }
}

async function pressFileKey(page,type) {
  const key = await page.evaluate(() => {
    const button = [...document.querySelectorAll('#tfiFileKeyboard .key')].find(button => button.querySelector('span')?.textContent === 'A4');
    if (!button) throw Error('Choose the Ukulele layout to expose A4');
    document.activeElement?.blur(); return button.dataset.key;
  });
  await page.keyboard[type === 'down' ? 'down' : 'up'](key);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const p = window.__fileAudioTest,m = window.__fileAudioMetrics;
    const preview = p.tfiFileEditor.getAudioRuntime(),main = p.megaDrive.audio;
    const rms = meter => {
      if (!meter) return null;
      const data = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(data);
      const mean = data.reduce((sum,value) => sum + value,0) / data.length;
      return Math.sqrt(data.reduce((sum,value) => sum + (value - mean) ** 2,0) / data.length);
    };
    const monitorCount = (audio,meter) => audio ? audio.outputMonitors.size - Number(audio.outputMonitors.has(meter)) : 0;
    return {timeReads:m.timeReads,fftReads:m.fftReads,observedContext:m.context,
      peak:m.lastTime ? Math.max(...m.lastTime.map(Math.abs)) : null,
      maxDb:m.lastFrequency ? Math.max(...m.lastFrequency) : null,
      previewLevel:rms(p.previewMeter),mainLevel:rms(p.mainMeter),
      contexts:window.__contexts.length,resumes:window.__contexts.reduce((sum,context) => sum + context.__resumeCalls,0),
      previewContext:preview?.audioContext ? window.__contextIds.get(preview.audioContext) : null,
      mainContext:main?.audioContext ? window.__contextIds.get(main.audioContext) : null,
      previewMonitors:monitorCount(preview,p.previewMeter),mainMonitors:monitorCount(main,p.mainMeter),
      mainAuditionCalls:p.mainAuditionCalls,
      volume:{ui:document.getElementById('masterVolumeRange').value,script:p.runtime.getMasterVolume(),
        preview:preview?.masterVolume,previewListening:preview?.listeningVolume,main:main?.masterVolume,mainListening:main?.listeningVolume},
      status:document.getElementById('audioMonitorStatus').textContent};
  });
}

async function measure(page,ms = 450) {
  await page.evaluate(() => window.__resetFileAudioMetrics());
  await page.waitForTimeout(ms); return snapshot(page);
}

async function attachMeter(page,preview) {
  await page.evaluate(preview => {
    const p = window.__fileAudioTest,key = preview ? 'previewMeter' : 'mainMeter';
    if (p[key]) return;
    const audio = preview ? p.tfiFileEditor.getAudioRuntime() : p.megaDrive.audio;
    const mute = audio.audioContext.createGain(); mute.gain.value = 0; mute.connect(audio.audioContext.destination);
    const meter = audio.audioContext.createAnalyser(); meter.__testMeter = true; meter.fftSize = 4096; meter.connect(mute);
    audio.connectOutputMonitor(meter); p[key] = meter;
  },preview);
}

async function checkBrowser(name,type,url) {
  const browser = await type.launch({headless:true,...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'}),errors = [];
    page.setDefaultTimeout(10000); page.on('pageerror',error => errors.push(error.message));
    await page.addInitScript(instrumentation); await page.goto(url);
    await page.waitForFunction(() => window.__fileAudioTest?.editor.kind === 'monaco');
    const baselineContexts = await page.evaluate(async () => {
      const p = window.__fileAudioTest;
      const [{createTfiFromPreset},{createVgiFromPreset},{FM_PRESETS}] = await Promise.all([
        import('/js/tfi.js'),import('/js/vgi.js'),import('/js/megasynth-fm-presets.js'),
      ]);
      const preset = FM_PRESETS.sine;
      p.virtualFiles.writeBinary('/preview-test.tfi',createTfiFromPreset({...preset,operators:Object.fromEntries(preset.operators.map((operator,i) => [i + 1,operator]))}));
      p.virtualFiles.writeBinary('/preview-test.vgi',createVgiFromPreset(preset));
      const audition = p.runtime.getAuditionSynth(),on = audition.noteOn.bind(audition); p.mainAuditionCalls = 0;
      audition.noteOn = (...args) => {p.mainAuditionCalls++; return on(...args);};
      const volume = document.getElementById('masterVolumeRange'); volume.value = '80'; volume.dispatchEvent(new Event('input',{bubbles:true}));
      return window.__contexts.length;
    });
    const results = [];
    for (const format of ['tfi','vgi']) {
      await page.evaluate(format => window.__fileAudioTest.openVirtualFile('/preview-test.' + format),format);
      await page.click('#audioMonitorTab');
      for (const mode of ['envelope','waveform','spectrum']) await page.selectOption('#audioMonitorMode',mode);
      await page.waitForTimeout(200);
      if (format === 'tfi') {
        assert.equal(await page.evaluate(() => window.__fileAudioTest.tfiFileEditor.getAudioRuntime()),null);
        assert.equal((await snapshot(page)).contexts,baselineContexts,'opening a file or Audio view must not create a source');
        assert.match((await snapshot(page)).status,/File preview.*Play a note/);
      }
      // Both keyboard widgets are enabled here. A physical file key must not
      // initialize or write pitch into the main runtime's keyboard synth.
      await page.click('#keyboardTab');
      await page.locator('#tfiFileKeyboard button').filter({hasText:'Ukulele'}).click();
      await pressFileKey(page,'down');
      await page.waitForFunction(() => document.querySelectorAll('#tfiFileKeyboard .key.is-active').length === 1);
      await attachMeter(page,true); await page.click('#audioMonitorTab'); await page.waitForTimeout(200);
      const before = await snapshot(page);
      assert.equal(before.contexts,baselineContexts + 1,'only the file preview should create an AudioContext');
      assert.equal(before.mainAuditionCalls,0); assert.equal(before.mainContext,null);
      for (const mode of ['envelope','waveform','spectrum']) {
        await page.selectOption('#audioMonitorMode',mode); await page.waitForTimeout(150);
        const observed = await measure(page);
        assert.equal(observed.observedContext,observed.previewContext,'Audio observes the file preview graph');
        assert.match(observed.status,/File preview/);
        assert(observed.previewLevel > .001,'the held preview note must remain audible');
        assert.equal(observed.contexts,before.contexts); assert.equal(observed.resumes,before.resumes,'analysis must not start or resume a source');
        assert.equal(observed.mainAuditionCalls,0); assert.deepEqual(observed.volume,before.volume);
        if (mode === 'spectrum') {assert(observed.fftReads > 0 && observed.maxDb > -60); assert.equal(observed.timeReads,0);}
        else {assert(observed.timeReads > 0 && observed.peak > .01); assert.equal(observed.fftReads,0);}
        assert(Math.abs(observed.previewLevel / before.previewLevel - 1) < .03,'view switching must retain preview volume');
        if (mode === 'waveform') await page.screenshot({path:path.join(artifacts,`playground-file-audio-${name}-${format}.png`)});
        results.push({format,mode,...observed});
      }
      await page.click('#audioMonitorPause'); await page.waitForTimeout(100);
      const paused = await measure(page,300);
      assert.equal(paused.previewMonitors,0); assert.equal(paused.timeReads + paused.fftReads,0); assert(paused.previewLevel > .001);
      await page.click('#audioMonitorPause'); await page.waitForTimeout(150);
      await page.click('#consoleTab'); await page.waitForTimeout(100);
      const hidden = await measure(page,300);
      assert.equal(hidden.previewMonitors,0); assert.equal(hidden.timeReads + hidden.fftReads,0); assert(hidden.previewLevel > .001);
      await pressFileKey(page,'up'); await page.click('#audioMonitorTab');
    }
    await page.click('#operatorTabButton'); await page.waitForTimeout(200);
    const idleMain = await measure(page,200);
    assert.equal(idleMain.previewMonitors,0); assert.equal(idleMain.contexts,baselineContexts + 1);
    assert.equal(idleMain.mainContext,null,'switching to Operator must not start the main source');
    assert.doesNotMatch(idleMain.status,/File preview/);
    await page.evaluate(() => {
      const p = window.__fileAudioTest;
      const source = "fm.setPreset(CH1,FM_PRESETS.sine); liveLoop('main-monitor-test',async()=>{await play('A4',{seconds:60});});";
      p.virtualFiles.writeText('/index.js',source); p.editor.setValue(source);
      document.getElementById('workerExecution').checked = false;
    });
    await page.click('#runButton'); await page.waitForFunction(() => !document.getElementById('runButton').disabled);
    await attachMeter(page,false); await page.waitForTimeout(200);
    const main = await measure(page);
    assert.equal(main.observedContext,main.mainContext); assert(main.maxDb > -60 && main.mainLevel > .001);
    assert.doesNotMatch(main.status,/File preview/);
    await page.click('#codeTab'); await page.waitForTimeout(200);
    const fileAgain = await measure(page);
    assert.equal(fileAgain.observedContext,fileAgain.previewContext,'Code with a file open selects preview even while the main program plays');
    assert(fileAgain.maxDb < -90 && fileAgain.mainLevel > .001,'the silent preview must not fall back to main audio');
    assert.match(fileAgain.status,/File preview/);
    await page.evaluate(() => window.__fileAudioTest.openVirtualFile('/index.js')); await page.waitForTimeout(200);
    const codeMain = await measure(page);
    assert.equal(codeMain.observedContext,codeMain.mainContext); assert(codeMain.maxDb > -60);
    assert.doesNotMatch(codeMain.status,/File preview/);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({browser:name,passed:true,beforeRun:true,results,idleMain,main,fileAgain,codeMain,errors}));
    await page.evaluate(() => window.__fileAudioTest.runtime.stop()); await page.close();
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
