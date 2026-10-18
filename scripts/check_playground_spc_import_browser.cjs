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
    code.push(0xab,0x30); // INC $30: CPU bookkeeping that the DSP never reads.
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
function fixtureWithMusicalEvents(bytes) {
  const fixture = Buffer.from(bytes), ram = fixture.subarray(0x100,0x10100), code = [];
  const writeDsp = (address,value) => code.push(0x8f,address,0xf2,0x8f,value,0xf3);
  const delay = pitchHigh => {
    code.push(0xcd,160);
    const outer = code.length;
    writeDsp(3,pitchHigh); // Repeated unchanged writes must not become 160 calls.
    code.push(0x8d,255,0xfe,0xfe,0x1d,0xd0,0);
    code[code.length - 1] = (outer - code.length) & 255;
  };
  delay(16); writeDsp(3,8);
  delay(8); writeDsp(0x5c,1);
  delay(8); writeDsp(0x5c,0); writeDsp(0x4c,1);
  delay(8); writeDsp(0x5c,1); code.push(0x2f,0xfe);
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
  if (mode === 'javascript' || mode === 'trace') {
    await dialog.locator('input[data-spc-conversion-seconds]').fill('2');
    if (mode === 'javascript') {
      await dialog.locator('input[data-spc-control-step]').fill('20');
      assert.match(await dialog.innerText(),/approx|not.*exact|not.*identical|lossy/i,
        'Readable conversion must disclose that it approximates the original song');
      await dialog.locator('[data-spc-pitch-table][data-spc-pitch-state="ready"]').waitFor({state:'visible'});
      assert(await dialog.locator('[data-spc-pitch-sample]').count() > 0,
        'Song JavaScript analyzes its captured BRR samples before conversion');
    }
    if (browserName) await page.screenshot({path:`/private/tmp/playground-spc-${mode}-import-${browserName}.png`});
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
async function cancelConversionImport(page,fixture,mode = 'javascript') {
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
    await dialog.locator(`input[name="spc-import-mode"][value="${mode}"]`).check();
    await dialog.locator('input[data-spc-conversion-seconds]').fill('2');
    // Readable mode analyzes automatically before its confirm button is enabled.
    // Trace mode still starts its capture only on an explicit conversion.
    if (mode === 'trace') await dialog.locator('[data-spc-import-confirm]').click();
    await Promise.race([started,new Promise((_,reject) => {timer=setTimeout(() => reject(Error('Conversion worker was not requested')),10000);})]);
    await dialog.locator('[data-spc-import-cancel]').click();
    await dialog.waitFor({state:'hidden'});
  } finally {clearTimeout(timer); release(); await page.unroute(pattern);}
  await page.waitForTimeout(100);
  assert.deepEqual(await snapshotFiles(page),before,'Cancelling a running conversion must not create partial or late project files');
}
const sourceWithoutComments = source => source.split('\n').map(line => line.replace(/\/\/.*$/,'').trimEnd())
  .filter(line => line.trim()).join('\n');
async function checkPitchAnnotations(page,fixture,original,browserName) {
  const originalSource = original.files.find(file => file.path === original.entryPath).data;
  const before = await snapshotFiles(page);
  const openAnalyzed = async () => {
    await openImport(page,fixture);
    const dialog = page.locator('#spcImportDialog');
    await dialog.locator('input[name="spc-import-mode"][value="javascript"]').check();
    await dialog.locator('input[data-spc-conversion-seconds]').fill('2');
    await dialog.locator('input[data-spc-control-step]').fill('20');
    const table = dialog.locator('[data-spc-pitch-table][data-spc-pitch-state="ready"]');
    await table.waitFor({state:'visible'});
    const row = table.locator('[data-spc-pitch-sample="0"]');
    await row.waitFor({state:'visible'});
    assert.match(await row.innerText(),/estimate|provisional|manual/i,
      'The pitch reference clearly identifies detection confidence or a manual assignment');
    assert.match(await row.locator('input[data-spc-pitch-note]').inputValue(),/^[A-G][#b]?\-?\d+$/,
      'Automatic analysis fills an editable nearest note or provisional C4');
    assert(Number.isFinite(Number(await row.locator('input[data-spc-pitch-cents]').inputValue())),
      'The note reference retains a finite cents offset');
    return {dialog,table,row};
  };
  // Validation and closing a completed preview must not create project files.
  let preview = await openAnalyzed();
  const requestCount = await page.evaluate(() => window.__spcImportWorkerRequests.filter(request => request.action === 'analyze').length);
  await preview.row.locator('input[data-spc-pitch-note]').fill('not-a-note');
  assert.equal(await preview.row.locator('input[data-spc-pitch-note]').evaluate(input => input.checkValidity()),false);
  await preview.dialog.locator('[data-spc-import-confirm]').evaluate(button => button.click());
  assert(await preview.dialog.isVisible());
  assert.deepEqual(await snapshotFiles(page),before,'An invalid pitch reference must not import files');
  await preview.row.locator('input[data-spc-pitch-note]').fill('C5');
  await preview.row.locator('input[data-spc-pitch-cents]').fill('');
  assert.equal(await preview.row.locator('input[data-spc-pitch-cents]').evaluate(input => input.checkValidity()),false);
  await preview.dialog.locator('[data-spc-import-confirm]').evaluate(button => button.click());
  assert(await preview.dialog.isVisible());
  assert.deepEqual(await snapshotFiles(page),before,'An invalid cents offset must not import files');
  await preview.row.locator('input[data-spc-pitch-cents]').fill('0');
  assert.match(await preview.row.innerText(),/manual/i,'Editing a reference marks it as a manual assignment');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__spcImportWorkerRequests.filter(request => request.action === 'analyze').length),requestCount,
    'Changing annotation fields must reuse the already captured performance');
  if (browserName) await page.screenshot({path:`/private/tmp/playground-spc-pitch-annotations-${browserName}.png`});
  await preview.dialog.locator('[data-spc-import-cancel]').click();
  await preview.dialog.waitFor({state:'hidden'});
  assert.deepEqual(await snapshotFiles(page),before,'Closing a pitch preview must leave all project files unchanged');

  // A fresh import uses manual labels while every actual playback statement,
  // tuning value and BRR asset remains the same as automatic conversion.
  preview = await openAnalyzed();
  await preview.row.locator('input[data-spc-pitch-note]').fill('C5');
  await preview.row.locator('input[data-spc-pitch-cents]').fill('23.25');
  assert.equal(await preview.row.locator('input[data-spc-pitch-cents]').inputValue(),'23.25',
    'The editable reference retains fractional cents even though source comments round for readability');
  if (browserName) await page.screenshot({path:`/private/tmp/playground-spc-pitch-annotations-${browserName}.png`});
  const beforeGenerate = await page.evaluate(() => window.__spcImportWorkerRequests.length);
  await preview.dialog.locator('[data-spc-import-confirm]').click();
  await preview.dialog.waitFor({state:'hidden'});
  const after = await snapshotFiles(page); assertExistingUnchanged(before,after);
  const oldPaths = new Set(before.map(file => file.path));
  const files = await readFiles(page,after.filter(file => !oldPaths.has(file.path)).map(file => file.path));
  const sourceFile = files.find(file => file.path.endsWith('/index.js'));
  assert(sourceFile,'Manual pitch annotation creates its runnable source');
  assert.equal(sourceWithoutComments(sourceFile.data),sourceWithoutComments(originalSource),
    'Changing the note reference must change comments only, never raw PITCH or playback tuning');
  assert.match(sourceFile.data,/rootNote: ['"]C4['"], basePitch: 4096/,
    'BRR tuning remains the raw 32 kHz reference despite a different comment label');
  const initialPitch = sourceFile.data.split('\n').find(line => /snes\.setPitch\(0, 4096\)/.test(line));
  assert.match(initialPitch,/reference C5.*\+23c/);
  const halfPitch = sourceFile.data.split('\n').find(line => /snes\.setPitch\(0, 2048\)/.test(line));
  assert.match(halfPitch,/reference C4.*\+23c/);
  assert.match(sourceFile.data,/manual/i,'Per-sample reference comments preserve manual-assignment provenance');
  const requests = await page.evaluate(start => window.__spcImportWorkerRequests.slice(start),beforeGenerate);
  assert(requests.some(request => request.action === 'generate' && request.hasPerformance),
    'Converting a ready preview formats the cached performance in a Worker');
  assert(requests.every(request => request.action !== 'analyze' && request.action !== 'convert'),
    'Manual annotations must not recapture the SPC during conversion');
  const diagnostics = await checkGeneratedDiagnostics(page,sourceFile.path);
  return {manualOnlyComments:true,invalidControlsNoFiles:true,cancelNoFiles:true,cachedPerformance:true,
    initialPitch:initialPitch.trim(),halfPitch:halfPitch.trim(),requests,diagnostics};
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
async function runGenerated(page,script,execution,{repeat=false,waitForLog,waitForComplete=false} = {}) {
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
  if (measured.rms <= .001) console.error(await page.evaluate(() => ({
    status:document.getElementById('status').textContent,console:document.getElementById('consoleOutput').textContent,
    state:window.__spcImportTest.runtime.getState(),outcomes:window.__spcImportTest.runOutcomes,
    context:window.__spcImportTest.megaDrive.audioContext.state,
    mixer:window.__spcImportTest.megaDrive.mixer.list(),
  })));
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
  if (waitForLog) await page.waitForFunction(marker => document.getElementById('consoleOutput').textContent.includes(marker),waitForLog);
  if (waitForComplete) {
    await page.waitForFunction(count => window.__spcImportTest.runOutcomes.length > count,outcomes);
    assert.deepEqual(await page.evaluate(() => window.__spcImportTest.runOutcomes.at(-1)),{ok:true},
      `${execution}: generated song must finish before STOP`);
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
async function checkSpcEvents(page,directory,execution) {
  const marker = `SPC_EVENTS_${execution}:`, script = `${directory}/observe-${execution}.js`;
  const source = `const spc = await useSoundChip('spc');
await spc.loadSPC(await file('./original.spc', {type:'arrayBuffer'}));
const events = [], pitches = [], excluded = [], removed = [];
const summarize = event => ({type:event.type, channel:'channel' in event ? event.channel : null});
const off = spc.onEvent(event => {events.push(summarize(event));}, {voices:[0], types:['noteOn','noteOff','pitch'], intervalMs:16});
const offPitch = spc.onEvent(event => {pitches.push(summarize(event));}, {voices:[0], types:['pitch'], intervalMs:16});
const offExcluded = spc.onEvent(event => {excluded.push(summarize(event));}, {voices:[7], types:['noteOn','noteOff','pitch'], intervalMs:16});
const offRemoved = spc.onEvent(event => {removed.push(summarize(event));}, {voices:[0], intervalMs:16});
offRemoved();
spc.play();
await sleep(1.4);
off(); offPitch(); offExcluded();
console.log(${JSON.stringify(marker)} + JSON.stringify({events,pitches,excluded,removed}));
await sleep(10);
`;
  await page.evaluate(({script,source}) => window.__spcImportTest.virtualFiles.writeText(script,source),{script,source});
  const diagnostics = await checkGeneratedDiagnostics(page,script);
  const audio = await runGenerated(page,script,execution,{waitForLog:marker});
  const observed = await page.evaluate(marker => {
    const text = document.getElementById('consoleOutput').textContent;
    return JSON.parse(text.slice(text.lastIndexOf(marker) + marker.length).split('\n')[0]);
  },marker);
  assert(observed.events.some(event => event.type === 'noteOn'),'SPC events expose initial/retriggered notes');
  assert(observed.events.some(event => event.type === 'noteOff'),'SPC events expose real KOFF events');
  assert(observed.events.some(event => event.type === 'pitch'),'SPC events expose the changed hardware pitch');
  assert(observed.events.every(event => event.channel === 0 && ['noteOn','noteOff','pitch'].includes(event.type)),
    'The voice and event-type filters must apply to actual playback callbacks');
  assert(observed.pitches.length >= 1 && observed.pitches.length < 8,'Unchanged driver PITCH writes must be coalesced semantically');
  assert(observed.pitches.every(event => event.type === 'pitch' && event.channel === 0));
  assert.deepEqual(observed.excluded,[],'An excluded silent voice must not receive other voices events');
  assert.deepEqual(observed.removed,[],'Unsubscribing before playback prevents callbacks');
  return {audio,diagnostics,...observed};
}
async function checkSpcEventGuard(page,directory,execution) {
  const marker = `SPC_EVENT_GUARD_${execution}:`, script = `${directory}/event-guard-${execution}.js`;
  const source = `const spc = await useSoundChip('spc');
await spc.loadSPC(await file('./original.spc', {type:'arrayBuffer'}));
const off = spc.onEvent(async event => {
  off();
  try {
    // @ts-expect-error Intentional forbidden-API probe: fetch is absent from Playground globals.
    await fetch('/spc-callback-guard-probe');
    console.log(${JSON.stringify(marker)} + 'unexpected network access');
  } catch (error) {
    console.log(${JSON.stringify(marker)} + String(error));
  }
}, {voices:[0], types:['pitch'], intervalMs:16});
await spc.play();
`;
  await page.evaluate(({script,source}) => window.__spcImportTest.virtualFiles.writeText(script,source),{script,source});
  const diagnostics = await checkGeneratedDiagnostics(page,script);
  const audio = await runGenerated(page,script,execution,{waitForLog:marker});
  const result = await page.evaluate(marker => {
    const text = document.getElementById('consoleOutput').textContent;
    return text.slice(text.lastIndexOf(marker) + marker.length).split('\n')[0];
  },marker);
  assert.match(result,/Network access is disabled/,
    'An async SPC callback after the top-level script finishes must retain Playground execution guards');
  return {audio,diagnostics,result};
}
async function checkIdleSpcEvents(page,directory,execution) {
  const marker = `SPC_IDLE_EVENTS_${execution}:`, script = `${directory}/idle-events-${execution}.js`;
  const source = `const spc = await useSoundChip('spc');
await spc.loadSPC(await file('./original.spc', {type:'arrayBuffer'}));
const events = [];
spc.onEvent(event => {
  events.push({type:event.type, channel:'channel' in event ? event.channel : null,
    reason:'reason' in event ? event.reason : null, inferred:'inferred' in event ? event.inferred : false});
}, {voices:[0], types:['noteOn'], intervalMs:16});
await spc.play();
await sleep(.3);
console.log(${JSON.stringify(marker)} + JSON.stringify(events));
await sleep(10);
`;
  await page.evaluate(({script,source}) => window.__spcImportTest.virtualFiles.writeText(script,source),{script,source});
  const diagnostics = await checkGeneratedDiagnostics(page,script);
  const audio = await runGenerated(page,script,execution,{waitForLog:marker});
  const events = await page.evaluate(marker => {
    const text = document.getElementById('consoleOutput').textContent;
    return JSON.parse(text.slice(text.lastIndexOf(marker) + marker.length).split('\n')[0]);
  },marker);
  assert.deepEqual(events,[{type:'noteOn',channel:0,reason:'initial',inferred:true}],
    'Static DSP playback must emit one inferred initial note without raw writes, overflow or repeated heartbeat notes');
  return {audio,diagnostics,events};
}
async function checkDenseSongTiming(page,fixture,execution) {
  const marker = `SPC_DENSE_TIMING_${execution}_`, directory = `/spc/dense-timing-${execution}`;
  const script = `${directory}/index.js`;
  const details = await page.evaluate(async ({fixture,marker,directory,script}) => {
    const {buildSpcSongSource} = await import(new URL('playground_spc_song_source.js?dense-timing-check=1',location.href).href);
    const bytes = new Uint8Array(fixture), dsp = bytes.slice(0x10100,0x10180);
    const preset = {adsr1:0,adsr2:0,gain:127,volumeLeft:64,volumeRight:48,pitch:4096,sourceNumber:0};
    const events = [{type:'noteOn',clock:0,channel:0,sourceNumber:0,pitch:4096,
      preset,sampleId:0,reason:'kon'}];
    // A relative sleep for every 1 ms event hits the browser's nested-timer
    // minimum and stretches this one-second song to several seconds. Events
    // across distinct voices can be this close even with a 20 ms control step.
    for (let index = 1; index <= 900; index++) events.push({type:'pitch',clock:Math.round(index * 1024),
      channel:0,pitch:4096 + index % 512});
    events.push({type:'noteOff',clock:1024000,channel:0,reason:'koff'});
    const performance = {version:1,clockRate:1024000,durationClocks:1024000,
      initialDsp:dsp,events,samples:[{id:0,sourceNumber:0,brr:bytes.slice(0x2100,0x2109),
        loop:true,loopStartSamples:0}],warnings:[],controlStepMs:0,
      statistics:{rawWrites:events.length,eventCount:events.length}};
    const generated = buildSpcSongSource(performance,directory);
    let source = generated.source;
    if (!source.includes('const timeline = createTimeline();')) throw Error('Generated song must create its clock after loading assets');
    source = source.replace('const timeline = createTimeline();',
      `const timeline = createTimeline();\n  console.log(${JSON.stringify(marker + 'START')});`);
    source = source.replace('  snes.allNotesOff();',
      `  console.log(${JSON.stringify(marker + 'END')});\n  snes.allNotesOff();`);
    const p = window.__spcImportTest;
    for (const file of generated.files) {
      if (file.type === 'text') p.virtualFiles.writeText(file.path,file.data);
      else p.virtualFiles.writeBinary(file.path,file.data);
    }
    p.virtualFiles.writeText(script,source);
    p.denseTimingObserver?.disconnect();
    p.denseTiming = {start:null,end:null};
    p.denseTimingObserver = new MutationObserver(() => {
      const text = document.getElementById('consoleOutput').textContent;
      if (p.denseTiming.start === null && text.includes(marker + 'START')) p.denseTiming.start = performanceNow();
      if (p.denseTiming.end === null && text.includes(marker + 'END')) p.denseTiming.end = performanceNow();
    });
    // Use the browser's clock only in this external test harness. Generated
    // Playground code has no dependency on browser globals or test functions.
    const performanceNow = () => window.performance.now();
    p.denseTimingObserver.observe(document.getElementById('consoleOutput'),{subtree:true,childList:true,characterData:true});
    return {source,eventCount:events.length,waitCount:(source.match(/\.waitUntil\(/g) || []).length};
  },{fixture:Array.from(fixture),marker,directory,script});
  assert.match(details.source,/createTimeline\(/);
  assert.match(details.source,/await timeline\.waitUntil\(/);
  assert.doesNotMatch(details.source,/await sleep\(/,'Dense song events must use absolute deadlines');
  assert(details.waitCount >= 900,'The fixture must exercise many close event deadlines');
  const diagnostics = await checkGeneratedDiagnostics(page,script);
  const audio = await runGenerated(page,script,execution,{waitForLog:marker + 'END',waitForComplete:true});
  const timing = await page.evaluate(() => {
    const p = window.__spcImportTest; p.denseTimingObserver.disconnect();
    return {...p.denseTiming,outcome:p.runOutcomes.at(-1)};
  });
  assert.equal(typeof timing.start,'number'); assert.equal(typeof timing.end,'number');
  const dispatchDurationMs = timing.end - timing.start;
  assert(dispatchDurationMs >= 800 && dispatchDurationMs < 1350,
    `${execution}: one second of dense controls must retain song speed, observed ${dispatchDurationMs.toFixed(1)} ms`);
  assert.deepEqual(timing.outcome,{ok:true},'The dense generated song must finish without an execution error');
  return {eventCount:details.eventCount,waitCount:details.waitCount,dispatchDurationMs,audio,diagnostics};
}
function assertPageErrors(errors,rejections) {
  // Monaco cancels its previous view when switching the generated model.
  const modelTrace = stack => stack.includes('/monaco-editor/0.52.2/min/vs/editor/editor.main.js')
    && stack.includes('setModel') && stack.includes('dispose');
  const modelCancellations = errors.filter(error => ['Canceled','Canceled: Canceled'].includes(error.message)
    && (modelTrace(error.stack) || rejections.some(reason => reason.message === 'Canceled' && modelTrace(reason.stack))));
  assert.deepEqual(errors.filter(error => !modelCancellations.includes(error)),[],JSON.stringify({rejections}));
  return modelCancellations.length;
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
      window.__spcImportWorkerRequests = [];
      const NativeWorker = window.Worker, urls = new WeakMap();
      window.Worker = new Proxy(NativeWorker,{construct(Target,args) {
        const worker = Reflect.construct(Target,args); urls.set(worker,String(args[0])); return worker;
      }});
      const originalPostMessage = NativeWorker.prototype.postMessage;
      NativeWorker.prototype.postMessage = function(message,...args) {
        if ((urls.get(this) || '').includes('playground_spc_trace_worker.js')) {
          window.__spcImportWorkerRequests.push({action:message?.action,
            hasPerformance:Boolean(message?.performance),durationSeconds:message?.durationSeconds});
        }
        return Reflect.apply(originalPostMessage,this,[message,...args]);
      };
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__spcImportTest?.editor.kind === 'monaco');
    if (process.argv.includes('--timing-only')) {
      const timing = {};
      for (const execution of ['main','worker']) timing[execution] = await checkDenseSongTiming(page,fixture,execution);
      const modelCancellations = assertPageErrors(errors,await page.evaluate(() => window.__spcImportRejections));
      console.log(JSON.stringify({browser:name,passed:true,denseSongTiming:true,timing,modelCancellations}));
      await page.close(); return;
    }
    if (process.argv.includes('--idle-events')) {
      const song = await importBundle(page,fixture,'song'), observations = {};
      for (const execution of ['main','worker']) observations[execution] = await checkIdleSpcEvents(page,song.directory,execution);
      const modelCancellations = assertPageErrors(errors,await page.evaluate(() => window.__spcImportRejections));
      console.log(JSON.stringify({browser:name,passed:true,idleEvents:true,observations,modelCancellations}));
      await page.close(); return;
    }
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
    await cancelConversionImport(page,timedFixture);
    const trace = await importBundle(page,timedFixture,'trace',name);
    assert.equal(trace.files.length,5,'Event trace stores original SPC, provenance, initial RAM/DSP and editable timed writes');
    const recorded = JSON.parse(trace.files.find(file => file.path.endsWith('/sourceinfo.json')).data);
    assert.equal(recorded.mode,'trace'); assert.equal(recorded.conversion.durationSeconds,2);
    assert.equal(recorded.conversion.clockRate,1024000); assert(recorded.conversion.eventCount >= 5);
    const optimization = recorded.conversion.optimization;
    assert.equal(optimization.kind,'dsp-ram-read-set');
    assert(optimization.ramReadAddresses > 0 && optimization.ramReadAddresses < 65536,
      'The import records an actual bounded DSP RAM-read set');
    assert.equal(optimization.dspEvents + optimization.ramEvents,recorded.conversion.eventCount);
    assert(optimization.dspEvents >= 4 && optimization.ramEvents >= 1,
      'DSP changes and the live sample-RAM mutation must remain recorded');
    assert(recorded.conversion.eventCount < 50,
      'Hundreds of writes to the CPU-only counter must not become generated source rows');
    assert((await page.locator('#status').innerText()).includes(
      `${recorded.conversion.eventCount} writes (DSP ${optimization.dspEvents}, RAM ${optimization.ramEvents})`),
    'The import completion status shows the actual retained DSP/RAM counts');
    assert.equal(trace.files.find(file => file.path.endsWith('/initial.ram.bin')).data.length,65536);
    assert.equal(trace.files.find(file => file.path.endsWith('/initial.dsp.bin')).data.length,128);
    const traceSource = trace.files.find(file => file.path === trace.entryPath).data;
    assert.match(traceSource,/prepareTimeline/); assert.match(traceSource,/playTimeline/);
    assert.match(traceSource,/0x2001/,'The editable source must retain sample RAM changes');
    assert.doesNotMatch(traceSource,/, 1, 0x0030,/,
      'DSP-unread CPU bookkeeping must be absent from the editable source');
    assert.match(traceSource,/Work RAM.*omitted/);
    assert.match(traceSource,/new RAM regions.*new capture/,
      'The editable source explains the read-set capture constraint');
    assert.match(traceSource,/Pitch high/i); assert.match(traceSource,/Key off mask/i);
    diagnostics.push(await checkGeneratedDiagnostics(page,trace.entryPath));
    const traceLevels = {};
    for (const execution of ['main','worker']) traceLevels[execution] = await runGenerated(page,trace.entryPath,execution);
    const musicalFixture = fixtureWithMusicalEvents(fixture);
    const readable = await importBundle(page,musicalFixture,'javascript',name);
    const readableSource = readable.files.find(file => file.path === readable.entryPath).data;
    const readableMetadata = JSON.parse(readable.files.find(file => file.path.endsWith('/sourceinfo.json')).data);
    assert.equal(readableMetadata.mode,'javascript');
    assert.equal(readableMetadata.conversion.kind,'readable');
    assert(Array.isArray(readableMetadata.conversion.warnings));
    assert.equal(readableMetadata.conversion.controlStepMs,20);
    assert(readableMetadata.conversion.rawWrites >= 400 && readableMetadata.conversion.eventCount < 20,
      'Actual conversion statistics distinguish repeated driver writes from meaningful events');
    assert.match(await page.locator('#status').innerText(),/interpreted events.*writes.*Approximate/i);
    assert(readable.files.some(file => file.path.endsWith('.brr')),'Readable song JavaScript saves playable BRR assets');
    assert(readable.files.every(file => !/\/initial\.(ram|dsp)\.bin$/.test(file.path)),
      'Readable song JavaScript uses instrument assets instead of raw DSP/RAM snapshots');
    for (const method of ['loadBRR','setPreset','setPitch','keyOn','keyOff']) assert.match(readableSource,new RegExp(`\\.${method}\\(`));
    assert.match(readableSource,/const timeline = createTimeline\(\)/);
    assert.match(readableSource,/await timeline\.waitUntil\(/);
    assert.doesNotMatch(readableSource,/await sleep\(/,'Readable song events must not accumulate relative timer delays');
    assert.doesNotMatch(readableSource,/new Uint32Array|prepareTimeline|playTimeline/);
    assert((readableSource.match(/\.setPitch\(/g) || []).length < 16,
      'Repeated unchanged driver PITCH writes must not turn into hundreds of high-level calls');
    assert.match(readableSource,/approx|not.*exact|not.*identical|lossy/i);
    diagnostics.push(await checkGeneratedDiagnostics(page,readable.entryPath));
    const pitchAnnotations = await checkPitchAnnotations(page,musicalFixture,readable,name);
    const readableLevels = {}, eventObservations = {}, eventGuards = {};
    for (const execution of ['main','worker']) {
      readableLevels[execution] = await runGenerated(page,readable.entryPath,execution);
      eventObservations[execution] = await checkSpcEvents(page,readable.directory,execution);
      eventGuards[execution] = await checkSpcEventGuard(page,readable.directory,execution);
    }
    const denseSongTiming = {};
    for (const execution of ['main','worker']) denseSongTiming[execution] = await checkDenseSongTiming(page,fixture,execution);
    await page.evaluate(script => window.__spcImportTest.open(script),readable.entryPath);
    await page.screenshot({path:`/private/tmp/playground-spc-import-${name}.png`});
    // Opening generated models can cancel Monaco 0.52.2's previous view task.
    // Match the same identified cancellation as the Sync/Revert browser test;
    // keep its count visible and reject every other page error.
    const rejections = await page.evaluate(() => window.__spcImportRejections);
    const modelCancellations = assertPageErrors(errors,rejections);
    console.log(JSON.stringify({browser:name,passed:true,cancelNoChange:true,conversionCancelNoChange:true,repeatedSongRun:true,uniqueDirectories:[song.directory,repeatedSong.directory,instruments.directory,trace.directory,readable.directory],
      songLevels,instrumentLevels,traceLevels,readableLevels,eventObservations,eventGuards,denseSongTiming,pitchAnnotations,optimization,diagnostics,modelCancellations,unusedRootUnknown:true,originalSpcPreserved:true}));
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
