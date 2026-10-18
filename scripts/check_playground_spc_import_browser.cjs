// Real Playground SPC import dialogs, generated source and Main/Worker audio.
// All fixtures are authored synthetic SPC/BRR data, without game music or ROMs.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {pathToFileURL} = require('node:url');
const {chromium,webkit} = require('playwright');
const root = path.resolve(__dirname,'..');
const stageAt = process.argv.indexOf('--stage');
const docs = stageAt < 0 ? path.join(root,'docs') : path.resolve(process.argv[stageAt + 1]);
const entry = stageAt < 0 ? '/playground/' : '/';
const mime = {'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml'};
const hook = `
window.__spcImportTest={runtime,megaDrive,virtualFiles,open:openVirtualFile,runOutcomes:[],get path(){return activeVirtualPath;},get editor(){return editorAdapter;}};
const testOriginalPlay = runtime.play.bind(runtime);
runtime.play = async (...args) => {
  try {const result=await testOriginalPlay(...args); window.__spcImportTest.runOutcomes.push({ok:true}); return result;}
  catch(error) {window.__spcImportTest.runOutcomes.push({ok:false,name:error.name,message:error.message}); throw error;}
};`;
const server = http.createServer(async (request,response) => {
  try {
    let file = path.resolve(docs,'.' + decodeURIComponent(new URL(request.url,'http://localhost').pathname));
    if (file !== docs && !file.startsWith(docs + path.sep)) throw Error('Outside test root');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file,'index.html');
    let body = await fs.readFile(file);
    if (path.basename(file) === 'playground.js') body = Buffer.from(body.toString() + hook);
    response.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream'); response.end(body);
  } catch (error) {response.writeHead(404).end(String(error));}
});

function fixtureWithUnusedInstrument(bytes) {
  const fixture = Buffer.from(bytes), ram = fixture.subarray(0x100,0x10100);
  for (let source = 0; source < 256; source++) ram.set([0x04,0x30,0x04,0x30],0x1000 + source * 4);
  ram.set([0,0x20,0,0x20],0x1000);
  ram.set([0,0x20,0,0x20],0x1000 + 42 * 4);
  ram.set([0,0x21,0,0x21],0x1000 + 127 * 4);
  ram.set([0xc3,0x76,0x54,0x32,0x10,0xfe,0xdc,0xba,0x98],0x2100);
  // One bounded unterminated chain for the other 253 directory entries.
  for (let block = 0; block < Math.floor(65536 / 9); block++) ram[(0x3004 + block * 9) & 65535] &= 0xfe;
  return fixture;
}
function fixtureWithTimedWrites(bytes) {
  const fixture = Buffer.from(bytes), ram = fixture.subarray(0x100,0x10100), code = [];
  const writeDsp = (address,value) => code.push(0x8f,address,0xf2,0x8f,value,0xf3);
  const delay = () => {
    code.push(0xcd,160); // MOV X,#160.
    const outer = code.length;
    code.push(0x8d,255,0xfe,0xfe,0x1d,0xd0,0); // MOV Y,#255; DBNZ Y,-2; DEC X; BNE outer.
    code[code.length - 1] = (outer - code.length) & 255;
  };
  delay();
  code.push(0xe8,0x72,0xc5,0x01,0x20); // MOV A,#$72; MOV $2001,A: live BRR RAM mutation.
  writeDsp(3,8); // Half PITCH after the initial sounding segment.
  delay();
  writeDsp(0,0); writeDsp(1,64); // Switch the voice to the right output.
  delay();
  writeDsp(0x5c,1); // KOFF, then idle without further writes.
  code.push(0x2f,0xfe);
  ram.set(code,0x200);
  return fixture;
}
async function snapshotFiles(page) {
  return page.evaluate(() => window.__spcImportTest.virtualFiles.list().map(file => {
    const values = file.type === 'text' ? new TextEncoder().encode(file.data) : file.data;
    let hash = 2166136261; for (const value of values) hash = Math.imul(hash ^ value,16777619);
    return {path:file.path,type:file.type,length:values.length,hash:hash >>> 0};
  }).sort((a,b) => a.path.localeCompare(b.path)));
}
async function readFiles(page,paths) {
  return page.evaluate(paths => paths.map(path => {
    const file = window.__spcImportTest.virtualFiles.get(path);
    return {...file,data:file.type === 'binary' ? Array.from(file.data) : file.data};
  }),paths);
}
function assertExistingUnchanged(before,after) {
  const map = new Map(after.map(file => [file.path,file]));
  for (const file of before) assert.deepEqual(map.get(file.path),file,'Import must preserve existing project files: ' + file.path);
}
async function openImport(page,fixture) {
  if (!await page.locator('#mainMenu').evaluate(menu => menu.open)) await page.locator('#mainMenu > summary').click();
  if (!await page.locator('#menuImport').evaluate(menu => menu.open)) await page.locator('#menuImport > summary').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'),page.locator('#importSpcButton').click()]);
  await chooser.setFiles({name:'original.spc',mimeType:'application/octet-stream',buffer:fixture});
  await page.locator('#spcImportDialog').waitFor({state:'visible'});
}
async function importBundle(page,fixture,mode,browserName) {
  const before = await snapshotFiles(page);
  await openImport(page,fixture);
  const dialog = page.locator('#spcImportDialog');
  await dialog.locator(`input[name="spc-import-mode"][value="${mode}"]`).check();
  if (mode === 'javascript') {
    await dialog.locator('input[data-spc-conversion-seconds]').fill('2');
    if (browserName) await page.screenshot({path:`/private/tmp/playground-spc-javascript-import-${browserName}.png`});
  }
  if (mode === 'instruments') {
    await dialog.locator('[data-spc-candidate="srcn-127"]').waitFor({state:'visible'});
    assert.equal(await dialog.locator('input[data-spc-candidate]').count(),2,'Full directory scanning finds used and unused BRR candidates');
    for (const checkbox of await dialog.locator('input[data-spc-candidate]').all()) await checkbox.check();
    const voices = dialog.locator('select[data-spc-voice]');
    assert.equal(await voices.count(),2);
    await voices.nth(0).selectOption('0');
    assert.equal(await voices.nth(1).inputValue(),'','An unused candidate must not invent a captured Voice');
    const references = dialog.locator('input[data-spc-reference]');
    assert.equal(await references.count(),2);
    await references.nth(1).fill('G3');
    assert.match(await dialog.innerText(),/reference|assigned note/i);
    assert.match(await dialog.innerText(),/not inferred|not.*original|unknown|does not.*root/i,
      'The assigned reference note must not be presented as an inferred original pitch');
    if (browserName) await page.screenshot({path:`/private/tmp/playground-spc-import-dialog-${browserName}.png`});
  }
  await dialog.locator('[data-spc-import-confirm]').click();
  await dialog.waitFor({state:'hidden'});
  const after = await snapshotFiles(page); assertExistingUnchanged(before,after);
  const oldPaths = new Set(before.map(file => file.path)), added = after.filter(file => !oldPaths.has(file.path));
  const files = await readFiles(page,added.map(file => file.path));
  const originals = files.filter(file => file.path.endsWith('/original.spc'));
  assert.equal(originals.length,1,'Every import preserves its original SPC');
  assert.deepEqual(originals[0].data,Array.from(fixture),'The preserved SPC must match the selected file byte for byte');
  const entryPath = await page.evaluate(() => window.__spcImportTest.path);
  assert(files.some(file => file.path === entryPath && file.type === 'text' && file.path.endsWith('.js')),
    'Import opens its generated runnable JavaScript');
  return {files,entryPath,directory:originals[0].path.slice(0,-'/original.spc'.length)};
}
async function cancelJavascriptImport(page,fixture) {
  const before = await snapshotFiles(page);
  let release, requested;
  const barrier = new Promise(resolve => {release=resolve;});
  const started = new Promise(resolve => {requested=resolve;});
  const pattern = '**/playground_spc_trace_worker.js*';
  await page.route(pattern,async route => {
    requested(); await barrier;
    try {await route.continue();} catch {} // Cancelling terminates this real worker request.
  });
  let timer;
  try {
    await openImport(page,fixture);
    const dialog = page.locator('#spcImportDialog');
    await dialog.locator('input[name="spc-import-mode"][value="javascript"]').check();
    await dialog.locator('input[data-spc-conversion-seconds]').fill('2');
    await dialog.locator('[data-spc-import-confirm]').click();
    await Promise.race([started,new Promise((_,reject) => {timer=setTimeout(() => reject(Error('Conversion worker was not requested')),10000);})]);
    await dialog.locator('[data-spc-import-cancel]').click();
    await dialog.waitFor({state:'hidden'});
  } finally {clearTimeout(timer); release(); await page.unroute(pattern);}
  await page.waitForTimeout(100);
  assert.deepEqual(await snapshotFiles(page),before,'Cancelling a running conversion must not create partial or late project files');
}
async function attachMeter(page) {
  await page.waitForFunction(() => window.__spcImportTest.megaDrive.audioContext?.state === 'running'
    && window.__spcImportTest.megaDrive.audio.masterInputNode);
  await page.evaluate(() => {
    const p = window.__spcImportTest;
    if (p.meter) return;
    const context = p.megaDrive.audioContext, meter = context.createAnalyser(), sink = context.createGain();
    meter.fftSize = 4096; sink.gain.value = 0; meter.connect(sink); sink.connect(context.destination);
    // Keep the analyser active even when Stop disconnects the native FX graph.
    // A zero-valued meter input prevents its previous PCM window staying stale.
    const zero = context.createConstantSource(); zero.offset.value = 0;
    zero.connect(meter); zero.start(); p.meterZero = zero;
    p.detachMeter = p.megaDrive.audio.connectOutputMonitor(meter); p.meter = meter; p.sink = sink;
  });
}
async function level(page) {
  return page.evaluate(() => {
    const meter = window.__spcImportTest.meter, pcm = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(pcm);
    let sum = 0, peak = 0, bad = 0;
    for (const value of pcm) {if (!Number.isFinite(value)) bad++; else {sum += value * value; peak = Math.max(peak,Math.abs(value));}}
    return {rms:Math.sqrt(sum / pcm.length),peak,bad};
  });
}
async function checkGeneratedDiagnostics(page,script) {
  await page.evaluate(script => window.__spcImportTest.open(script),script);
  const result = await page.evaluate(async script => {
    const expected = '/project' + script;
    const model = monaco.editor.getEditors().find(editor => editor.getModel()?.uri.path === expected)?.getModel();
    if (!model) throw Error('The generated file is not the active Monaco model: ' + expected);
    const factory = await monaco.languages.typescript.getJavaScriptWorker();
    const worker = await factory(model.uri), uri = model.uri.toString();
    const [syntax,semantic] = await Promise.all([worker.getSyntacticDiagnostics(uri),worker.getSemanticDiagnostics(uri)]);
    const message = value => typeof value === 'string' ? value : [value.messageText,...(value.next || []).map(message)].join('\n');
    const ignored = monaco.languages.typescript.javascriptDefaults.getDiagnosticsOptions().diagnosticCodesToIgnore || [];
    const diagnostics = [...syntax,...semantic].map(diagnostic => ({code:diagnostic.code,
      message:message(diagnostic.messageText),start:diagnostic.start,length:diagnostic.length}));
    return {path:script,model:uri,ignored,diagnostics:diagnostics.filter(diagnostic => !ignored.includes(diagnostic.code))};
  },script);
  assert(!result.ignored.includes(2698) && !result.ignored.includes(2339),'Monaco must report the unknown-preset spread/property errors');
  assert.deepEqual(result.diagnostics,[],`Generated JavaScript must have no Monaco syntax/semantic diagnostics: ${script}`);
  return {path:result.path,syntaxErrors:0,semanticErrors:0};
}
async function runGenerated(page,script,execution,{repeat=false} = {}) {
  await page.evaluate(({script,execution}) => {
    const p = window.__spcImportTest; p.open(script);
    document.getElementById('workerExecution').checked = execution === 'worker';
  },{script,execution});
  let outcomes = await page.evaluate(() => window.__spcImportTest.runOutcomes.length);
  await page.locator('#runButton').click();
  await attachMeter(page);
  let measured;
  const deadline = Date.now() + 8000;
  do {
    await page.waitForTimeout(80); measured = await level(page);
    if (measured.rms > .001) break;
  } while (Date.now() < deadline);
  assert.equal(measured.bad,0,script + ': generated audio must be finite');
  assert(measured.rms > .001,`${execution}: generated script must produce real final-output PCM: ${script} ${JSON.stringify(measured)}`);
  if (repeat) {
    await page.waitForFunction(count => window.__spcImportTest.runOutcomes.length > count,outcomes);
    assert.deepEqual(await page.evaluate(() => window.__spcImportTest.runOutcomes.at(-1)),{ok:true},'The generated song script must complete successfully');
    outcomes = await page.evaluate(() => window.__spcImportTest.runOutcomes.length);
    await page.locator('#runButton').click();
    await page.waitForFunction(count => window.__spcImportTest.runOutcomes.length > count,outcomes);
    assert.deepEqual(await page.evaluate(() => window.__spcImportTest.runOutcomes.at(-1)),{ok:true},
      `${execution}: Run → Run must reuse the cached SPC player without an obsolete-owner abort`);
    await page.waitForTimeout(120);
    assert((await level(page)).rms > .001,`${execution}: repeated Run must leave the imported song audible`);
  }
  await page.locator('#stopButton').click();
  await page.waitForFunction(() => window.__spcImportTest.runtime.getState().playback === 'stopped'
    && !document.getElementById('stopButton').disabled);
  const stoppedAt = await page.evaluate(() => window.__spcImportTest.megaDrive.audioContext.currentTime);
  await page.waitForFunction(time => window.__spcImportTest.megaDrive.audioContext.currentTime >= time + .2,stoppedAt);
  const stopped = await level(page);
  if (stopped.peak >= .00001) console.error(await page.evaluate(() => ({context:window.__spcImportTest.megaDrive.audioContext.state,
    currentTime:window.__spcImportTest.megaDrive.audioContext.currentTime,mixer:window.__spcImportTest.megaDrive.mixer.list()})));
  assert(stopped.peak < .00001,`${execution}: STOP must silence the imported music: ${JSON.stringify(stopped)}`);
  return {...measured,stoppedPeak:stopped.peak};
}

async function checkBrowser(name,type,url,fixture) {
  const browser = await type.launch({headless:true,...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1360,height:980},serviceWorkers:'block'}),errors = [];
    page.setDefaultTimeout(30000);
    page.on('pageerror',error => errors.push({message:error.message,stack:error.stack}));
    page.on('dialog',dialog => {errors.push({message:'Unexpected browser dialog: ' + dialog.message(),stack:''}); return dialog.dismiss();});
    await page.addInitScript(() => {
      window.__spcImportRejections = [];
      window.addEventListener('unhandledrejection',event => {
        window.__spcImportRejections.push({message:event.reason?.message,stack:event.reason?.stack || ''});
      });
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__spcImportTest?.editor.kind === 'monaco');
    const initial = await snapshotFiles(page);
    await openImport(page,fixture);
    await page.locator('#spcImportDialog [data-spc-import-cancel]').click();
    await page.locator('#spcImportDialog').waitFor({state:'hidden'});
    assert.deepEqual(await snapshotFiles(page),initial,'Cancel must not create project files');
    const song = await importBundle(page,fixture,'song');
    assert.equal(song.files.length,3,'Song imports contain source SPC, provenance and runnable JavaScript');
    const songSource = song.files.find(file => file.path === song.entryPath).data;
    assert.match(songSource,/useSoundChip\(['"]spc['"]\)/);
    assert.match(songSource,/\.\/original\.spc/);
    const diagnostics = [await checkGeneratedDiagnostics(page,song.entryPath)];
    const repeatedSong = await importBundle(page,fixture,'song');
    assert.notEqual(repeatedSong.directory,song.directory,'Repeated imports allocate a new folder instead of replacing files');
    const songLevels = {};
    for (const execution of ['main','worker']) songLevels[execution] = await runGenerated(page,song.entryPath,execution,{repeat:true});
    const instruments = await importBundle(page,fixture,'instruments',name);
    assert.notEqual(instruments.directory,song.directory);
    assert.notEqual(instruments.directory,repeatedSong.directory);
    const brr = instruments.files.filter(file => file.path.endsWith('.brr'));
    const metadata = instruments.files.filter(file => file.path.endsWith('.metadata.json')).map(file => ({path:file.path,...JSON.parse(file.data)}));
    const presets = instruments.files.filter(file => /\/presets\/.*\.json$/.test(file.path));
    const scripts = instruments.files.filter(file => file.path.endsWith('.js'));
    assert.equal(brr.length,2); assert.equal(metadata.length,2); assert.equal(presets.length,2); assert.equal(scripts.length,2);
    for (const file of brr) assert.equal(file.data.length,9,'The extracted BRR data remains a complete raw block');
    const used = metadata.find(entry => entry.sourceNumbers.includes(0)), unused = metadata.find(entry => entry.sourceNumbers.includes(127));
    assert.deepEqual(used.sourceNumbers,[0,42]); assert.equal(used.selectedVoiceIndex,0);
    assert.deepEqual(unused.voices,[]); assert.equal(unused.selectedVoiceIndex,null);
    assert.equal(unused.rootNote,null,'No original root note can be inferred from BRR');
    assert.equal(unused.assignedReferenceNote,'G3','The user-assigned reference note is recorded separately');
    assert.match(unused.tuning,/not inferred/i);
    assert(scripts.every(file => /createSoundChip\(['"]snes['"]\)/.test(file.data)));
    const unusedScript = scripts.find(file => file.path.includes('127'));
    assert.match(unusedScript.data,/referenceNote = "G3"/);
    assert.match(unusedScript.data,/no captured Voice settings/);
    for (const script of scripts) diagnostics.push(await checkGeneratedDiagnostics(page,script.path));
    const instrumentLevels = {};
    for (const execution of ['main','worker']) {
      // Exercise both the captured-Voice preset and the unused raw candidate.
      instrumentLevels[execution] = [];
      for (const script of scripts) instrumentLevels[execution].push(await runGenerated(page,script.path,execution));
    }
    const timedFixture = fixtureWithTimedWrites(fixture);
    await cancelJavascriptImport(page,timedFixture);
    const javascript = await importBundle(page,timedFixture,'javascript',name);
    assert.equal(javascript.files.length,5,'Song JavaScript stores original SPC, provenance, initial RAM/DSP and editable timed writes');
    const recorded = JSON.parse(javascript.files.find(file => file.path.endsWith('/sourceinfo.json')).data);
    assert.equal(recorded.mode,'javascript'); assert.equal(recorded.conversion.durationSeconds,2);
    assert.equal(recorded.conversion.clockRate,1024000); assert(recorded.conversion.eventCount >= 5);
    assert.equal(javascript.files.find(file => file.path.endsWith('/initial.ram.bin')).data.length,65536);
    assert.equal(javascript.files.find(file => file.path.endsWith('/initial.dsp.bin')).data.length,128);
    const javascriptSource = javascript.files.find(file => file.path === javascript.entryPath).data;
    assert.match(javascriptSource,/prepareTimeline/); assert.match(javascriptSource,/playTimeline/);
    assert.match(javascriptSource,/0x2001/,'The editable source must retain sample RAM changes');
    assert.match(javascriptSource,/Pitch high/i); assert.match(javascriptSource,/Key off mask/i);
    diagnostics.push(await checkGeneratedDiagnostics(page,javascript.entryPath));
    const javascriptLevels = {};
    for (const execution of ['main','worker']) javascriptLevels[execution] = await runGenerated(page,javascript.entryPath,execution);
    await page.screenshot({path:`/private/tmp/playground-spc-import-${name}.png`});
    // Opening generated models can cancel Monaco 0.52.2's previous view task.
    // Match the same identified cancellation as the Sync/Revert browser test;
    // keep its count visible and reject every other page error.
    const rejections = await page.evaluate(() => window.__spcImportRejections);
    const modelTrace = stack => stack.includes('/monaco-editor/0.52.2/min/vs/editor/editor.main.js')
      && stack.includes('setModel') && stack.includes('dispose');
    const modelCancellations = errors.filter(error => ['Canceled','Canceled: Canceled'].includes(error.message)
      && (modelTrace(error.stack) || rejections.some(reason => reason.message === 'Canceled' && modelTrace(reason.stack))));
    assert.deepEqual(errors.filter(error => !modelCancellations.includes(error)),[],JSON.stringify({rejections}));
    console.log(JSON.stringify({browser:name,passed:true,cancelNoChange:true,conversionCancelNoChange:true,repeatedSongRun:true,uniqueDirectories:[song.directory,repeatedSong.directory,instruments.directory,javascript.directory],
      songLevels,instrumentLevels,javascriptLevels,diagnostics,modelCancellations:modelCancellations.length,unusedRootUnknown:true,originalSpcPreserved:true}));
    await page.close();
  } finally {await browser.close();}
}

(async () => {
  const {createSyntheticSpc} = await import(pathToFileURL(path.join(root,'web/spc_test_fixture.mjs')));
  const fixture = fixtureWithUnusedInstrument(createSyntheticSpc({voices:2}));
  await new Promise((resolve,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',resolve);});
  try {
    const browsers = process.argv.includes('--chromium') ? [['chromium',chromium]]
      : process.argv.includes('--webkit') ? [['webkit',webkit]] : [['chromium',chromium],['webkit',webkit]];
    for (const [name,type] of browsers) await checkBrowser(name,type,`http://127.0.0.1:${server.address().port}${entry}`,fixture);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
