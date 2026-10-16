// Real panel routing and keyboard ownership in fresh browser sessions.
// Only the self-hosted module response exposes existing controls to this test.
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
      '\nwindow.__panelRegression={runtime,megaDrive,get editorAdapter(){return editorAdapter;},virtualFiles,openVirtualFile,createTfiFromPreset,FM_PRESETS};');
    response.setHeader('Content-Type',mime[path.extname(filename)] || 'application/octet-stream');
    response.end(body);
  } catch (error) {response.writeHead(404).end(String(error));}
});

async function layout(page) {
  return page.evaluate(() => {
    const visible = id => {
      const element = document.getElementById(id);
      return Boolean(element?.getClientRects().length) && getComputedStyle(element).visibility !== 'hidden';
    };
    const panel = document.getElementById('keyboardPanel');
    return {
      code:visible('codePanel'),operator:visible('operatorPanel'),keyboard:visible('keyboardPanel'),
      helpers:visible('helpersPanel'),keys:visible('playgroundKeyboardKeys'),dock:visible('bottomDock'),
      keyboardDocked:Boolean(panel.closest('#bottomDock')),
      keyboardPosition:getComputedStyle(panel).position,
      topTabs:[...document.querySelectorAll('.workbench-editor > .tabbar [role="tab"]')].map(tab => tab.id),
      lowerTabs:[...document.querySelectorAll('#bottomDock > .tabbar [role="tab"]')].map(tab => tab.id),
    };
  });
}

async function key(page,type) {
  const keyName = await page.evaluate(() => {
    const button = [...document.querySelectorAll('#operatorKeyboardRoot .key')].find(button => button.querySelector('span')?.textContent === 'A4');
    if (!button) throw Error('A4 is missing from the selected layout');
    document.activeElement?.blur();
    return button.dataset.key;
  });
  await page.keyboard[type === 'keydown' ? 'down' : 'up'](keyName);
}

async function state(page) {
  return page.evaluate(() => {
    const p = window.__panelRegression;
    const pcm = new Float32Array(p.meter.fftSize); p.meter.getFloatTimeDomainData(pcm);
    const mean = pcm.reduce((sum,value) => sum + value,0) / pcm.length;
    return {on:p.noteOns,off:p.noteOffs,active:document.querySelectorAll('#operatorKeyboardRoot .key.is-active').length,
      rms:Math.sqrt(pcm.reduce((sum,value) => sum + (value - mean) ** 2,0) / pcm.length)};
  });
}

async function checkBrowser(name,type,url) {
  const browser = await type.launch({headless:true,...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'}),errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror',error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__panelRegression?.editorAdapter.kind === 'monaco');
    await page.evaluate(() => {
      document.getElementById('workerExecution').checked = false;
      window.__panelRegression.editorAdapter.setValue('fm.setPreset(CH1,FM_PRESETS.sine); await sleep(.01);');
    });
    await page.click('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled);
    await page.evaluate(() => {
      const p = window.__panelRegression,context = p.megaDrive.audioContext;
      const mute = context.createGain(); mute.gain.value = 0; mute.connect(context.destination);
      p.meter = context.createAnalyser(); p.meter.fftSize = 4096; p.meter.connect(mute);
      p.megaDrive.audio.connectOutputMonitor(p.meter);
      const synth = p.runtime.getAuditionSynth();
      p.noteOns = 0; p.noteOffs = 0;
      const on = synth.noteOn.bind(synth),off = synth.noteOff.bind(synth);
      synth.noteOn = (...args) => {p.noteOns++; return on(...args);};
      synth.noteOff = (...args) => {p.noteOffs++; return off(...args);};
    });

    await page.click('#keyboardTab');
    const codeKeyboard = await layout(page);
    assert(codeKeyboard.code && codeKeyboard.keyboard && codeKeyboard.keys && codeKeyboard.keyboardDocked);
    assert(!codeKeyboard.topTabs.includes('keyboardTab') && !codeKeyboard.topTabs.includes('helpersTab'));
    assert(codeKeyboard.lowerTabs.includes('keyboardTab') && codeKeyboard.lowerTabs.includes('helpersTab'));
    await page.locator('#operatorKeyboardRoot button').filter({hasText:'Ukulele'}).click();
    await page.screenshot({path:path.join(artifacts,`playground-panel-${name}-code-keyboard.png`)});
    await key(page,'keydown'); await page.waitForTimeout(180);
    assert((await state(page)).rms > .001,'Code + lower Keyboard must produce real audio');
    await key(page,'keyup');

    await page.click('#helpersTab');
    const codeHelpers = await layout(page);
    assert(codeHelpers.code && codeHelpers.helpers && !codeHelpers.keyboard);
    await page.screenshot({path:path.join(artifacts,`playground-panel-${name}-code-helpers.png`)});
    const hiddenBefore = await state(page);
    await key(page,'keydown'); await page.waitForTimeout(80); await key(page,'keyup');
    assert.equal((await state(page)).on,hiddenBefore.on,'hidden keyboard must not capture typing in Code + Helpers');

    await page.click('#keyboardTab'); await page.click('#bottomDock .dock-close');
    const closed = await layout(page);
    assert(closed.code && !closed.dock && !closed.keyboard);
    const closedBefore = await state(page);
    await key(page,'keydown'); await page.waitForTimeout(80); await key(page,'keyup');
    assert.equal((await state(page)).on,closedBefore.on,'closing the lower panel must disable invisible audition');

    await page.click('#operatorTabButton'); await page.click('.dock-toggle'); await page.click('#audioMonitorTab');
    const operatorAudio = await layout(page);
    assert(operatorAudio.operator && operatorAudio.keyboard && !operatorAudio.keys && !operatorAudio.keyboardDocked);
    assert.equal(operatorAudio.keyboardPosition,'fixed','Operator + Audio keeps compact audition controls');
    await page.screenshot({path:path.join(artifacts,`playground-panel-${name}-operator-audio.png`)});
    await key(page,'keydown'); await page.waitForTimeout(180);
    const held = await state(page);
    assert(held.rms > .001 && held.active === 1,'Operator audition must sound');
    for (const tab of ['fxMonitorTab','consoleTab','audioMonitorTab']) await page.click('#' + tab);
    await page.waitForTimeout(180);
    const afterTabs = await state(page);
    assert.equal(afterTabs.on,held.on); assert.equal(afterTabs.off,held.off,'unrelated bottom tabs must not release an Operator note');
    assert(afterTabs.active === 1 && afterTabs.rms > .001,'held Operator note must survive unrelated tab changes');
    await key(page,'keyup');
    assert.equal((await state(page)).off,held.off + 1);

    await page.click('#keyboardTab');
    const operatorKeyboard = await layout(page);
    assert(operatorKeyboard.operator && operatorKeyboard.keyboard && operatorKeyboard.keys && operatorKeyboard.keyboardDocked);
    assert.notEqual(operatorKeyboard.keyboardPosition,'fixed','Operator + lower Keyboard must use the full docked view');
    assert.equal(await page.locator('#keyboardPanel').count(),1,'one keyboard is moved instead of creating duplicate listeners');

    // A visible file preview already owns physical keys. The new simultaneous
    // lower Keyboard must still support its own pointer audition without
    // playing a second synth for each physical keystroke.
    await page.evaluate(() => {
      const p = window.__panelRegression;
      const bytes = p.createTfiFromPreset({...p.FM_PRESETS.sine,operators:[null,...p.FM_PRESETS.sine.operators]});
      p.virtualFiles.writeBinary('/panel-test.tfi',bytes);
      p.openVirtualFile('/panel-test.tfi');
    });
    const previewBefore = await state(page);
    await key(page,'keydown');
    await page.waitForFunction(() => document.querySelectorAll('#tfiFileKeyboard .key.is-active').length === 1);
    assert.equal((await state(page)).on,previewBefore.on,'TFI preview owns physical keys while Code is visible');
    await key(page,'keyup');
    await page.waitForFunction(() => document.querySelectorAll('#tfiFileKeyboard .key.is-active').length === 0);
    const mainKey = page.locator('#operatorKeyboardRoot .key').filter({hasText:'A4'}).first();
    await mainKey.dispatchEvent('pointerdown',{pointerId:7,pointerType:'mouse',button:0,buttons:1});
    await page.waitForFunction(before => window.__panelRegression.noteOns === before + 1,previewBefore.on);
    assert.equal(await page.locator('#tfiFileKeyboard .key.is-active').count(),0,'main pointer audition must not trigger the file preview');
    await mainKey.dispatchEvent('pointerup',{pointerId:7,pointerType:'mouse',button:0,buttons:0});

    await page.setViewportSize({width:640,height:800});
    await page.click('#helpersTab'); await page.click('#keyboardTab'); await page.click('#bottomDock .dock-close');
    assert(!(await layout(page)).dock,'lower tabs and close remain reachable at 640 px');
    await page.click('.dock-toggle');
    assert((await layout(page)).keyboard,'Panel reopens the selected Keyboard at 640 px');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({browser:name,codeKeyboard,codeHelpers,closed,operatorAudio,operatorKeyboard,held,afterTabs,tfiCoexistence:true,narrowTabs:true,errors}));
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
