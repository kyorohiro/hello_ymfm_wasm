// Exercise the passive operator guide in the actual Playground and TFI editor.
// Private state is exposed only by this self-hosted test server.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {chromium,webkit} = require('playwright');

const docs = path.resolve(__dirname,'../docs');
const artifacts = process.env.PANEL_TEST_ARTIFACT_DIR || os.tmpdir();
const main = '#operatorTabRoot [data-operator-envelope]';
const preview = '#tfiFileOperator [data-operator-envelope]';
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const server = http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let filename = path.resolve(docs,'.' + pathname);
    if (!filename.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename,'index.html');
    let body = await fs.readFile(filename);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() +
      '\nwindow.__operatorVisualTest={operatorTab,runtime,megaDrive,virtualFiles,openVirtualFile,tfiFileEditor,get editor(){return editorAdapter;}};');
    response.setHeader('Content-Type',mime[path.extname(filename)] || 'application/octet-stream');
    response.end(body);
  } catch (error) {response.writeHead(404).end(String(error));}
});

function instrumentation() {
  window.__operatorContexts = [];
  const Context = window.AudioContext;
  window.AudioContext = new Proxy(Context,{construct(target,args,newTarget) {
    const context = Reflect.construct(target,args,newTarget),resume = context.resume.bind(context);
    context.__resumeCalls = 0;
    context.resume = (...args) => {context.__resumeCalls++; return resume(...args);};
    window.__operatorContexts.push(context); return context;
  }});
  window.__operatorPaints = {};
  for (const method of ['clearRect','fillRect','stroke','fillText']) {
    const original = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function(...args) {
      if (this.canvas.matches('[data-operator-envelope]')) {
        const root = this.canvas.closest('#operatorTabRoot,#tfiFileOperator');
        const key = root?.id || 'unknown';
        window.__operatorPaints[key] = (window.__operatorPaints[key] || 0) + 1;
      }
      return original.apply(this,args);
    };
  }
}

async function snapshot(page,selector = main) {
  return page.evaluate(selector => {
    const canvas = document.querySelector(selector),pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let hash = 2166136261,nonempty = 0;
    for (let i = 0; i < pixels.length; i++) {hash = Math.imul(hash ^ pixels[i],16777619); nonempty += Number(pixels[i] !== 0);}
    return {hash:hash >>> 0,nonempty,width:canvas.width,height:canvas.height,paints:{...window.__operatorPaints},
      contexts:window.__operatorContexts.length,resumes:window.__operatorContexts.map(context => context.__resumeCalls)};
  },selector);
}

async function resetPaints(page) {await page.evaluate(() => {window.__operatorPaints = {};});}

async function showMain(page) {
  await page.click('#operatorTabButton'); await page.locator(main).scrollIntoViewIfNeeded();
  await page.waitForTimeout(100); return snapshot(page);
}

async function editParameter(page,label,delta) {
  // Drive the same increment/decrement handlers as the user rather than
  // mutating the private operator model.
  await page.evaluate(({label,delta}) => {
    const row = document.querySelectorAll('#operatorTabOperatorControls .operator-row')[3];
    const value = row.querySelector(`.param-value[aria-label="${label}"]`);
    const buttons = value.closest('.param-control').querySelectorAll('.param-button');
    for (let i = 0; i < Math.abs(delta); i++) buttons[delta > 0 ? 1 : 0].click();
  },{label,delta});
  await page.waitForTimeout(80); return snapshot(page);
}

async function audibleState(page) {
  return page.evaluate(() => {
    const p = window.__operatorVisualTest,data = new Float32Array(p.meter.fftSize);
    p.meter.getFloatTimeDomainData(data);
    const mean = data.reduce((sum,value) => sum + value,0) / data.length;
    return {rms:Math.sqrt(data.reduce((sum,value) => sum + (value - mean) ** 2,0) / data.length),
      contexts:window.__operatorContexts.length,resumes:window.__operatorContexts.map(context => context.__resumeCalls),
      volume:{script:p.runtime.getMasterVolume(),master:p.megaDrive.audio.masterVolume,listening:p.megaDrive.audio.listeningVolume}};
  });
}

async function checkBrowser(name,type,url) {
  const browser = await type.launch({headless:true,...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'}),errors = [];
    page.setDefaultTimeout(15000); page.on('pageerror',error => errors.push(error.message));
    await page.addInitScript(instrumentation); await page.goto(url);
    await page.waitForFunction(() => window.__operatorVisualTest?.editor.kind === 'monaco');
    await page.waitForTimeout(100);
    const hiddenInitial = await snapshot(page);
    assert.equal(hiddenInitial.paints.operatorTabRoot || 0,0,'the initially hidden guide must not draw');
    assert.equal(hiddenInitial.contexts,0,'building the guide must not initialize audio');
    const first = await showMain(page);
    assert(first.paints.operatorTabRoot > 0 && first.nonempty > 100,'opening YM2612 displays a real diagram');
    assert.equal(first.contexts,0,'showing the guide must not initialize audio');
    assert(await page.locator('#operatorTabRoot .operator-envelope-guide').evaluate(element => element.open),'the guide starts expanded');
    await page.evaluate(() => window.__operatorVisualTest.operatorTab.selectPreset(0,'sine'));
    await page.waitForTimeout(80); const sine = await snapshot(page);
    const edited = [];
    for (const [label,delta] of [['TL',24],['AR',-12],['RR',-8]]) {
      const previous = edited.at(-1) || sine,result = await editParameter(page,label,delta);
      assert.notEqual(result.hash,previous.hash,label + ' edits must change the plotted envelope');
      assert.equal(result.contexts,0,'editing an unplayed instrument must remain silent and lazy');
      edited.push({label,...result});
    }
    await resetPaints(page); await page.waitForTimeout(250);
    assert.equal((await snapshot(page)).paints.operatorTabRoot || 0,0,'a static guide must not run a continuous render loop');

    // Each channel owns its own visual state, matching the numeric controls.
    const channel0 = await snapshot(page);
    await page.evaluate(() => window.__operatorVisualTest.operatorTab.selectPreset(1,'fm-bass'));
    await page.waitForTimeout(80); const channel1 = await snapshot(page);
    assert.notEqual(channel1.hash,channel0.hash,'switching channel/preset changes the diagram');
    await page.selectOption('#operatorTabChannelSelect','0'); await page.waitForTimeout(80);
    assert.equal((await snapshot(page)).hash,channel0.hash,'returning to a channel restores its diagram');

    await page.click('#codeTab'); await page.waitForTimeout(50); await resetPaints(page);
    await page.evaluate(() => window.__operatorVisualTest.operatorTab.syncOperator(0,0,{tl:3,ar:8,rr:1}));
    await page.waitForTimeout(150);
    assert.equal((await snapshot(page)).paints.operatorTabRoot || 0,0,'hidden model changes must not draw');
    const afterHidden = await showMain(page);
    assert.notEqual(afterHidden.hash,channel0.hash,'revealing the guide draws the latest hidden edits');
    const summary = page.locator('#operatorTabRoot .operator-envelope-guide summary');
    await summary.click(); await page.waitForTimeout(80); await resetPaints(page);
    await page.evaluate(() => window.__operatorVisualTest.operatorTab.syncOperator(0,0,{ar:28,rr:12}));
    await page.waitForTimeout(150);
    assert.equal((await snapshot(page)).paints.operatorTabRoot || 0,0,'a folded guide does not redraw');
    await summary.click(); await page.locator(main).scrollIntoViewIfNeeded(); await page.waitForTimeout(80);
    assert.notEqual((await snapshot(page)).hash,afterHidden.hash,'unfolding draws the most recent parameters');

    // The same editor is also instantiated for binary instruments. It must not
    // accidentally select the main editor's canvas or initialize its preview.
    await page.evaluate(async () => {
      const p = window.__operatorVisualTest,[{createTfiFromPreset},{FM_PRESETS}] = await Promise.all([
        import('/js/tfi.js'),import('/js/megasynth-fm-presets.js')]);
      const preset = FM_PRESETS.sine;
      p.virtualFiles.writeBinary('/operator-guide.tfi',createTfiFromPreset({...preset,
        operators:Object.fromEntries(preset.operators.map((operator,i) => [i + 1,operator]))}));
      p.openVirtualFile('/operator-guide.tfi');
    });
    await page.locator(preview).scrollIntoViewIfNeeded(); await page.waitForTimeout(100);
    const file = await snapshot(page,preview);
    assert(file.nonempty > 100 && file.paints.tfiFileOperator > 0,'TFI preview also renders the guide');
    assert.equal(file.contexts,0,'opening the file guide does not initialize preview audio');
    assert.equal(await page.evaluate(() => window.__operatorVisualTest.tfiFileEditor.getAudioRuntime()),null);
    assert.equal(await page.locator('[data-operator-envelope]').count(),2,'each editor has its own canvas');
    await resetPaints(page);
    await page.evaluate(() => {
      const row = document.querySelectorAll('#tfiFileOperator [id$="operatorTabOperatorControls"] .operator-row')[3];
      const buttons = row.querySelector('.param-value[aria-label="TL"]').closest('.param-control').querySelectorAll('.param-button');
      for (let i = 0; i < 12; i++) buttons[1].click();
    });
    await page.waitForTimeout(80); const fileEdited = await snapshot(page,preview);
    assert.notEqual(fileEdited.hash,file.hash,'editing the file updates the independent guide');
    assert.equal(fileEdited.paints.operatorTabRoot || 0,0,'a file edit must not redraw the hidden main guide');
    assert.equal(fileEdited.contexts,0);
    await page.screenshot({path:path.join(artifacts,`playground-operator-${name}-file.png`)});

    // Verify the actual code -> FM event -> operator editor path, then compare
    // real final PCM while expanding/folding/hiding the passive drawing.
    await page.evaluate(() => {
      const p = window.__operatorVisualTest;
      const source = "fm.setPreset(CH1,FM_PRESETS.sine); liveLoop('operator-guide-test',async()=>{await play('A4',{channel:CH1,seconds:60});});";
      p.virtualFiles.writeText('/index.js',source); p.openVirtualFile('/index.js'); p.editor.setValue(source);
      document.getElementById('workerExecution').checked = false;
    });
    await page.click('#runButton'); await page.waitForFunction(() => !document.getElementById('runButton').disabled);
    await showMain(page); const beforeCode = await snapshot(page);
    await page.evaluate(async () => {
      const p = window.__operatorVisualTest;
      await p.runtime.playSource('fm.setOperator(CH1,3,{tl:32,ar:20,rr:5});',{execution:'main'});
    });
    await page.waitForTimeout(150); const code = await snapshot(page);
    assert.notEqual(code.hash,beforeCode.hash,'fm.setOperator from code updates the graph');
    assert.equal(await page.locator('#operatorTabOperatorControls .operator-row').nth(3).locator('.param-value[aria-label="TL"]').textContent(),'32');
    await page.evaluate(async () => {
      await window.__operatorVisualTest.runtime.playSource('fm.setOperator(CH1,3,{tl:40,ar:12,rr:7});',{execution:'worker'});
    });
    await page.waitForFunction(() => document.querySelectorAll('#operatorTabOperatorControls .operator-row')[3]
      .querySelector('.param-value[aria-label="TL"]').textContent === '40');
    await page.waitForTimeout(100); const workerCode = await snapshot(page);
    assert.notEqual(workerCode.hash,code.hash,'Worker fm.setOperator also updates the graph');
    assert.equal(await page.locator('#operatorTabOperatorControls .operator-row').nth(3).locator('.param-value[aria-label="AR"]').textContent(),'12');
    assert.equal(await page.locator('#operatorTabOperatorControls .operator-row').nth(3).locator('.param-value[aria-label="RR"]').textContent(),'7');
    // The preceding Run replaces/cancels play() waits. Their finally blocks
    // release owned notes, so their release tails are not a steady PCM fixture.
    // Drain Stop/Worker cleanup before starting an unowned, sustained chip note.
    await page.evaluate(async () => {
      const p = window.__operatorVisualTest;
      p.runtime.stop(); await p.runtime.prepareAudition();
    });
    await page.waitForTimeout(100);
    await page.evaluate(async () => {
      const p = window.__operatorVisualTest,{FM_PRESETS} = await import('/js/megasynth-fm-presets.js');
      p.megaDrive.fm.setPreset(0,FM_PRESETS.sine);
      p.megaDrive.fm.setOperator(0,3,{tl:32});
      p.megaDrive.fm.setPan(0,true,true,0,0);
      p.megaDrive.fm.noteOn(0,'A4');
    });
    await page.evaluate(() => {
      const p = window.__operatorVisualTest,audio = p.megaDrive.audio;
      const mute = audio.audioContext.createGain(); mute.gain.value = 0; mute.connect(audio.audioContext.destination);
      p.meter = audio.audioContext.createAnalyser(); p.meter.fftSize = 4096; p.meter.connect(mute); audio.connectOutputMonitor(p.meter);
    });
    await page.waitForTimeout(200); const baseline = await audibleState(page);
    assert(baseline.rms > .001,'the test must compare real audible PCM');
    const audio = [];
    for (const action of ['fold','unfold','hide','show']) {
      if (action === 'fold' || action === 'unfold') await summary.click();
      else if (action === 'hide') await page.click('#codeTab');
      else await showMain(page);
      await page.waitForTimeout(150);
      const state = await audibleState(page);
      assert(Math.abs(state.rms / baseline.rms - 1) < .03,
        'diagram visibility must not alter PCM level: ' + JSON.stringify({action,baseline,state}));
      assert.deepEqual({contexts:state.contexts,resumes:state.resumes,volume:state.volume},
        {contexts:baseline.contexts,resumes:baseline.resumes,volume:baseline.volume},'drawing must not change audio routing, volume or lifecycle');
      audio.push({action,...state});
    }
    await page.screenshot({path:path.join(artifacts,`playground-operator-${name}.png`)});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({browser:name,passed:true,hiddenInitial,first,edited,channel0,channel1,afterHidden,file,fileEdited,code,workerCode,baseline,audio,errors}));
    await page.evaluate(() => {window.__operatorVisualTest.megaDrive.fm.noteOff(0); window.__operatorVisualTest.runtime.stop();});
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
