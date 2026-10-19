// The actual Playground host: Menu editor, neutral VFS assets, shared Guitar,
// mode handoff and downloaded/reloaded Cassette. No microphone is accessed.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const docs = path.resolve(__dirname, '../docs');
const asset = '/samples/sampler.sample.json', wavPath = '/samples/sampler.wav';
const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.wasm':'application/wasm', '.json':'application/json', '.svg':'image/svg+xml'};
const accessor = '\nwindow.__sampleHost={runtime,megaDrive,virtualFiles,openVirtualFile,getEditorValue};';
const server = http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let file = path.resolve(docs,'.'+pathname);
    if (!file.startsWith(docs+path.sep)) throw Error('Invalid path');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file,'index.html');
    let body = await fs.readFile(file);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString()+accessor);
    response.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch(error) {response.writeHead(404).end(error.message);}
});

async function ready(page) {
  await page.waitForFunction(() => window.__sampleHost && window.monaco?.editor?.getEditors().length);
  await page.locator('#startupNotice').waitFor({state:'hidden'});
  await page.evaluate(async () => {
    const model = monaco.editor.getEditors()[0].getModel();
    const getWorker = await monaco.languages.typescript.getJavaScriptWorker();
    await (await getWorker(model.uri)).getSemanticDiagnostics(model.uri.toString());
  });
  // Finish model-scoped UI requests before this automation replaces the model
  // again; this does not delay musical input or audio lifecycle assertions.
  await page.waitForTimeout(150);
}
async function menu(page) {
  if (!await page.locator('#mainMenu').evaluate(node => node.open)) await page.locator('#mainMenu > summary').click();
}
async function savedAsset(page) {
  return page.evaluate(({asset,wavPath}) => {
    const {virtualFiles} = window.__sampleHost, file = virtualFiles.get(asset), wav = virtualFiles.get(wavPath);
    return {manifest:file?.type === 'text' ? JSON.parse(file.data) : null,
      manifestText:file?.data, wav:wav?.type === 'binary' ? Array.from(wav.data) : null};
  },{asset,wavPath});
}
async function changeMode(page,base,id) {
  await ready(page);
  await menu(page); await page.locator('#playgroundMode').selectOption(id);
  await page.locator('#changeModeDialog').waitFor({state:'visible'});
  await Promise.all([page.waitForURL(url => url.searchParams.get('mode') === id),page.locator('#modeChoiceKeep').click()]);
  await ready(page);
  assert.equal(new URL(page.url()).pathname,new URL(base).pathname);
}
async function startMeter(page) {
  await page.evaluate(() => {
    const {megaDrive} = window.__sampleHost, context = megaDrive.audioContext;
    const analyser = context.createAnalyser(), silent = context.createGain();
    analyser.fftSize = 2048; silent.gain.value = 0; analyser.connect(silent); silent.connect(context.destination);
    const current = window.__sampleMeter = {peak:0,acPeak:0,lastAcPeak:0,finite:true,quietSince:null};
    const samples = new Float32Array(analyser.fftSize);
    current.detach = megaDrive.audio.connectOutputMonitor(analyser);
    current.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const mean = samples.reduce((sum,value) => sum+value,0) / samples.length;
      let ac = 0;
      for (const value of samples) {current.finite &&= Number.isFinite(value); current.peak = Math.max(current.peak,Math.abs(value)); ac = Math.max(ac,Math.abs(value-mean));}
      current.acPeak = Math.max(current.acPeak,ac); current.lastAcPeak = ac;
      if (ac < .00005) current.quietSince ??= performance.now(); else current.quietSince = null;
    },10);
    current.close = () => {clearInterval(current.timer);current.detach();analyser.disconnect();silent.disconnect();};
  });
}
async function playSavedSampler(page,mode,execution) {
  page.samplePhase = `${mode}/${execution}`;
  await ready(page);
  const sourcePath = mode === 'mega-cd' ? '/examples/mega-cd/megacd-sampler.js'
    : mode === 'gameboy' ? '/examples/gameboy/gameboy-sampler.js'
    : mode === 'pc98' ? '/examples/pc98/pc98-sampler.js' : '/examples/neogeo/neogeo-sampler.js';
  const source = await page.evaluate(async ({sourcePath,execution}) => {
    const test = window.__sampleHost;
    if (test.virtualFiles.get(sourcePath)?.type !== 'text') throw Error('Missing sampler example: '+sourcePath);
    test.openVirtualFile(sourcePath);
    document.getElementById('workerExecution').checked = execution === 'worker';
    const model = monaco.editor.getEditors()[0].getModel();
    const getWorker = await monaco.languages.typescript.getJavaScriptWorker();
    const diagnostics = await (await getWorker(model.uri)).getSemanticDiagnostics(model.uri.toString());
    return {text:test.getEditorValue(),diagnostics:diagnostics.filter(d => d.category === 1).map(d => ({code:d.code,message:d.messageText}))};
  },{sourcePath,execution});
  assert.deepEqual(source.diagnostics,[],`${mode}: actual sampler source has no Monaco errors`);
  assert.match(source.text,/createSampleInstrument/);
  await page.locator('#runButton').click();
  await page.waitForFunction(() => window.__sampleHost.runtime.getKeyboardTarget()?.name === 'sampler');
  assert.equal(await page.locator('dialog[data-audio-input]').count(),0,'edit:false loads the saved sample without a dialog');
  await page.locator('#keyboardTab').click();
  assert(await page.locator('#keyboardPanel').isVisible(),`${mode}: shared Keyboard is visible`);
  assert.equal(await page.locator('#playgroundKeyboardChannelTools').isVisible(),false,'custom targets hide FM controls');
  assert.equal(await page.locator('#playgroundKeyboardKeys small').count(),0,'custom targets omit block/fnum details');
  await startMeter(page);
  try {
    const key = page.locator('#playgroundKeyboardKeys [data-key="1"]').first();
    await key.scrollIntoViewIfNeeded();
    const box = await key.boundingBox(); assert(box,'Guitar key has a visible position');
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
    await page.waitForFunction(() => window.__sampleMeter.acPeak > .0005);
    const meter = await page.evaluate(() => ({peak:__sampleMeter.peak,acPeak:__sampleMeter.acPeak,finite:__sampleMeter.finite}));
    assert(meter.finite && meter.peak < 1,`${mode}/${execution}: finite unclipped output`);
    // Release outside the key to exercise pointer capture, rather than a click.
    await page.mouse.move(10,10); await page.mouse.up();
    await page.waitForFunction(() => __sampleMeter.quietSince !== null && performance.now()-__sampleMeter.quietSince > 100).catch(async error => {
      console.error({mode,execution,phase:'pointer-outside-release',meter:await page.evaluate(() => ({lastAcPeak:__sampleMeter.lastAcPeak,quietSince:__sampleMeter.quietSince,activeKeys:document.querySelectorAll('#playgroundKeyboardKeys .is-active').length})),
        inspector:await page.evaluate(() => window.__sampleHost.runtime.chipInspector.read('rf5c164'))});
      throw error;
    });
    await key.focus(); await page.keyboard.down('1');
    await page.waitForFunction(() => __sampleMeter.lastAcPeak > .0005);
    await page.locator('#codeTab').click(); await page.locator('.monaco-editor textarea').first().focus();
    await page.keyboard.up('1');
    await page.waitForFunction(() => __sampleMeter.quietSince !== null && performance.now()-__sampleMeter.quietSince > 100);
    await page.keyboard.down('1'); await page.waitForTimeout(180); await page.keyboard.up('1');
    assert((await page.evaluate(() => __sampleMeter.lastAcPeak)) < .00005,`${mode}/${execution}: Code input does not trigger the instrument`);
    // The key is expected to type into Monaco; undo this intentional test edit.
    await page.evaluate(source => monaco.editor.getEditors()[0].setValue(source),source.text);
    await ready(page);
    await page.locator('#keyboardTab').click();
    if (execution === 'main') await page.screenshot({path:`/private/tmp/sample-host-${mode}.png`});
    await page.locator('#stopButton').click();
    await page.waitForFunction(() => !window.__sampleHost.runtime.getKeyboardTarget());
    console.log(JSON.stringify({mode,execution,savedAsset:true,keyboard:true,pointerOutsideRelease:true,editorKeysSuppressed:true,stopUnbind:true,...meter}));
  } finally {await page.evaluate(() => {__sampleMeter?.close();delete window.__sampleMeter;});}
}

async function check(name,type,base) {
  const browser = await type.launch({headless:true,...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  const page = await browser.newPage({viewport:{width:1280,height:1000},acceptDownloads:true}), errors = [];
  page.setDefaultTimeout(20000); page.on('pageerror',error => errors.push({message:error.message,stack:error.stack,phase:page.samplePhase}));
  try {
    page.samplePhase = 'menu-editor';
    await page.goto(`${base}?mode=mega-cd&no-sw=1`); await ready(page);
    await menu(page); await page.locator('#sampleEditorButton').click();
    const editor = page.locator('dialog[data-audio-input]'); await editor.waitFor({state:'visible'});
    assert.equal(await editor.locator('[data-audio-action="use"]').textContent(),'Save sample');
    await editor.locator('[data-action="new-wave"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-audio-action="use"]').disabled);
    const canvas = await editor.locator('canvas').boundingBox(); assert(canvas);
    await page.mouse.move(canvas.x+canvas.width*.15,canvas.y+canvas.height*.35); await page.mouse.down();
    await page.mouse.move(canvas.x+canvas.width*.7,canvas.y+canvas.height*.7,{steps:10}); await page.mouse.up();
    await editor.locator('[data-field="rate"]').selectOption('22050');
    await page.screenshot({path:`/private/tmp/sample-host-editor-${name}.png`});
    await editor.locator('[data-audio-action="use"]').click(); await editor.waitFor({state:'detached'});
    const original = await savedAsset(page);
    assert.equal(original.manifest?.format,'tetorica-sample-v1'); assert.equal(original.manifest.sourcePath,wavPath);
    assert(original.manifest.settings.drawStrokes.length > 0,'drawing saved as non-destructive settings');
    assert.equal(original.manifest.settings.outputSampleRate,22050);
    assert.equal(original.manifest.settings.target,undefined,'sample asset remains neutral across modes');
    assert.equal(Buffer.from(original.wav).toString('ascii',0,4),'RIFF'); assert.equal(Buffer.from(original.wav).readUInt16LE(20),3,'original float32 WAV is saved');
    assert.equal(await page.evaluate(() => window.__sampleHost.runtime.getKeyboardTarget()),null,'Menu saves without binding a runtime target');
    await page.evaluate(asset => window.__sampleHost.openVirtualFile(asset),asset); await editor.waitFor({state:'visible'});
    assert.equal(await editor.locator('[data-field="rate"]').inputValue(),'22050','saved output rate restores');
    await editor.locator('[data-audio-action="cancel"]').click(); await editor.waitFor({state:'detached'});
    for (const mode of ['mega-cd','gameboy','pc98','neogeo-b']) {
      if (mode !== 'mega-cd') await changeMode(page,base,mode);
      assert.deepEqual(await savedAsset(page),original,`${mode}: mode handoff preserves the same original and edits`);
      for (const execution of ['main','worker']) await playSavedSampler(page,mode,execution);
    }
    // Download a real Cassette, clear the project through New Cassette, then
    // restore through Load Cassette's browser file chooser.
    page.samplePhase = 'cassette-save'; await ready(page);
    await menu(page); await page.locator('#exportCassetteButton').click();
    await page.locator('#cassetteExportDialog').waitFor({state:'visible'});
    page.once('dialog',dialog => dialog.accept('sample-host-roundtrip'));
    const [download] = await Promise.all([page.waitForEvent('download'),page.locator('#confirmCassetteExportButton').click()]);
    const downloaded = await fs.readFile(await download.path());
    assert.equal(download.suggestedFilename(),'sample-host-roundtrip.cassette.zip');
    const {loadPlaygroundCassette} = await import(pathToFileURL(path.join(docs,'playground/playground_cassette.js')));
    const cassette = await loadPlaygroundCassette(new Uint8Array(downloaded));
    assert.deepEqual(Buffer.from(cassette.files.get(wavPath.slice(1))),Buffer.from(original.wav));
    assert.equal(Buffer.from(cassette.files.get(asset.slice(1))).toString(),original.manifestText);
    page.samplePhase = 'new-cassette'; await ready(page);
    await menu(page); await page.locator('#newCassetteButton').click();
    await page.locator('#newCassetteDialog button[value="new"]').click();
    await page.waitForFunction(asset => !window.__sampleHost.virtualFiles.get(asset),asset);
    page.samplePhase = 'load-cassette'; await ready(page); await menu(page);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'),page.locator('#importCassetteButton').click()]);
    await chooser.setFiles({name:'sample-host-roundtrip.cassette.zip',mimeType:'application/zip',buffer:downloaded});
    await page.waitForFunction(asset => !!window.__sampleHost.virtualFiles.get(asset),asset);
    await ready(page);
    assert.deepEqual(await savedAsset(page),original,'actual Cassette reload restores original WAV and all edit settings');
    await playSavedSampler(page,'neogeo-b','worker');
    assert.deepEqual(errors,[],'host page errors');
    console.log(JSON.stringify({browser:name,menuEditor:true,drawSaved:true,assetManifest:true,floatWav:true,neutralAcrossModes:4,mainWorker:true,cassetteDownloadReload:true,pageErrors:0,passed:true}));
  } catch(error) {
    console.error({browser:name,errors,console:await page.locator('#consoleOutput').textContent().catch(() => null),status:await page.locator('[data-audio-input-status]').textContent().catch(() => null)});
    await page.screenshot({path:`/private/tmp/sample-host-${name}-failure.png`}).catch(() => {}); throw error;
  } finally {await browser.close();}
}
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/playground/`;
    if (!process.argv.includes('--webkit-only')) await check('chromium',chromium,base);
    if (process.argv.includes('--webkit') || process.argv.includes('--webkit-only')) await check('webkit',webkit,base);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);process.exitCode=1;});
