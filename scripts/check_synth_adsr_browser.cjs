// Exercise Synth's shared envelope editor through real pointer and keyboard
// events. Private state is exposed only by this test server.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {chromium, webkit} = require('playwright');

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const docs = path.resolve(option('root') || path.join(__dirname, '../docs'));
const entry = option('entry') || '/synth/index.html';
const artifacts = process.env.PANEL_TEST_ARTIFACT_DIR || os.tmpdir();
const editor = '#synthEnvelopeEditor';
const canvas = `${editor} [data-operator-envelope]`;
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.wasm':'application/wasm', '.json':'application/json', '.svg':'image/svg+xml'};
const hook = `
window.__synthAdsrTest = {
  operators: () => structuredClone(operatorStates),
  preset: buildCurrentPresetState,
  voices: () => structuredClone(voices),
  outputHistory: () => outputEnvelopeHistory.slice(),
  fm: () => synth,
  project: synthProject,
  files: () => synthFiles,
  tone: () => {
    if (!synthFiles?.activeTonePath) return null;
    const preset = synthProject.readTone(synthFiles.activeTonePath).preset;
    return {...preset, operators:Object.fromEntries([1,2,3,4].map(operator => [operator,preset.operators[operator]]))};
  },
};`;
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let filename = path.resolve(docs, '.' + pathname);
    if (!filename.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
    let body = await fs.readFile(filename);
    if (path.basename(filename) === 'synth.js') body = Buffer.from(body.toString() + hook);
    response.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
    response.end(body);
  } catch (error) {response.writeHead(404).end(String(error));}
});

function instrumentation() {
  window.__synthAdsrContexts = 0;
  window.__synthAdsrPaints = 0;
  window.__synthAdsrTrace = {count:0, duringDrag:0, points:[], sourcePeak:0};
  window.__synthAdsrDragging = false;
  document.addEventListener('pointerdown', event => {
    if (event.target.closest?.('#synthEnvelopeEditor [data-envelope-handle]')) window.__synthAdsrDragging = true;
  }, true);
  for (const event of ['pointerup', 'pointercancel']) document.addEventListener(event, () => {window.__synthAdsrDragging = false;}, true);
  const wrap = Original => Original && new Proxy(Original, {construct(target, args, newTarget) {
    window.__synthAdsrContexts++;
    return Reflect.construct(target, args, newTarget);
  }});
  const Original = window.AudioContext;
  window.AudioContext = wrap(Original);
  if (window.webkitAudioContext && window.webkitAudioContext !== Original) window.webkitAudioContext = wrap(window.webkitAudioContext);
  for (const method of ['beginPath', 'moveTo', 'lineTo']) {
    const original = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function(...args) {
      if (this.canvas.closest('#synthEnvelopeEditor')) {
        if (method === 'beginPath') this.__synthAdsrPath = [];
        else this.__synthAdsrPath?.push(args.slice(0, 2));
      }
      return original.apply(this, args);
    };
  }
  for (const method of ['stroke', 'fillText']) {
    const original = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function(...args) {
      if (this.canvas.closest('#synthEnvelopeEditor')) {
        window.__synthAdsrPaints++;
        if (method === 'stroke' && this.strokeStyle === '#7be0d6') {
          const trace = window.__synthAdsrTrace;
          trace.count++;
          if (window.__synthAdsrDragging) trace.duringDrag++;
          trace.points = this.__synthAdsrPath?.map(point => point.slice()) || [];
          trace.sourcePeak = Math.max(0, ...(window.__synthAdsrTest?.outputHistory() || []));
        }
      }
      return original.apply(this, args);
    };
  }
}

async function states(page) {return page.evaluate(() => window.__synthAdsrTest.operators());}
async function paints(page) {return page.evaluate(() => window.__synthAdsrPaints);}
async function seedOperator(page, operator = 4) {
  // Use the existing numeric control handlers to give every stage room to move.
  await page.evaluate(({operator}) => {
    const row = document.querySelectorAll('#operatorControls .operator-row')[operator - 1];
    for (const [field, desired] of Object.entries({TL:40, AR:16, D1R:16, D2R:16, SL:7, RR:7})) {
      const value = row.querySelector(`.param-value[aria-label="${field}"]`);
      const buttons = value.closest('.param-control').querySelectorAll('.param-button');
      for (let count = 0; Number(value.textContent) !== desired && count < 128; count++) {
        buttons[Number(value.textContent) < desired ? 1 : 0].click();
      }
      if (Number(value.textContent) !== desired) throw Error('Could not seed ' + field);
    }
  }, {operator});
  await page.waitForTimeout(90);
}

async function selectOperator(page, operator) {
  const selector = `${editor} [data-envelope-operator="${operator}"]`;
  await page.locator(selector).click();
  await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-pressed') === 'true', selector);
}

async function startDrag(page, handle) {
  const button = page.locator(`${editor} [data-envelope-handle="${handle}"]`);
  await button.scrollIntoViewIfNeeded();
  const bounds = await button.boundingBox();
  assert(bounds?.width > 0 && bounds?.height > 0, 'A visible pointer target is required: ' + handle);
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  return {x, y};
}

async function drag(page, handle, {dx = 30, dy = 0, holdForOutput = false} = {}) {
  const before = await states(page);
  await page.evaluate(() => {window.__synthAdsrFocus = document.activeElement;});
  const point = await startDrag(page, handle);
  await page.mouse.move(point.x + dx, point.y + dy, {steps:5});
  if (holdForOutput) {
    const before = await page.evaluate(() => structuredClone(window.__synthAdsrTrace));
    // No further pointer movement: real audio telemetry must keep updating the
    // output trace independently while the edited point remains captured.
    await page.waitForFunction(before => window.__synthAdsrTrace.duringDrag >= before + 2, before.duringDrag);
    assert.notDeepEqual(await page.evaluate(() => window.__synthAdsrTrace.points), before.points,
      'Real output history must advance while the envelope point is held without mouse movement');
  }
  await page.mouse.up(); await page.waitForTimeout(90);
  assert.equal(await page.evaluate(() => document.activeElement === window.__synthAdsrFocus), true,
    'Envelope dragging must preserve computer keyboard focus');
  return {handle, before, after:await states(page)};
}

function assertChanged(result, operator, fields) {
  for (const key of Object.keys(result.before)) {
    if (Number(key) !== operator) {
      assert.deepEqual(result.after[key], result.before[key], 'A drag must preserve another operator');
      continue;
    }
    for (const field of Object.keys(result.before[key])) {
      if (fields.includes(field)) assert.notEqual(result.after[key][field], result.before[key][field], `${result.handle} must change ${field}`);
      else assert.equal(result.after[key][field], result.before[key][field], `${result.handle} must preserve ${field}`);
    }
  }
  const limits = {tl:127, ar:31, d1r:31, d2r:31, sl:15, rr:15};
  for (const settings of Object.values(result.after)) for (const [field, max] of Object.entries(limits)) {
    assert(Number.isInteger(settings[field]) && settings[field] >= 0 && settings[field] <= max, 'A drag must retain valid chip values: ' + field);
  }
}

async function showEditor(page) {
  await page.locator('[data-visual-mode="envelope"]').click();
  await page.locator(canvas).scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('#synthEnvelopeEditor [data-envelope-handle="attack"]')?.style.left);
}

async function checkBrowser(name, type, url) {
  const browser = await type.launch({headless:true, ...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1400, height:1050}, serviceWorkers:'block'});
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => {errors.push('Unexpected dialog: ' + dialog.message()); return dialog.dismiss();});
    await page.addInitScript(instrumentation);
    await page.goto(url);
    await page.waitForFunction(() => window.__synthAdsrTest && !document.getElementById('synthFileNewButton').disabled);
    assert.equal(await page.locator('[data-visual-mode]').count(), 3, 'Keep the three existing monitor modes');
    assert.equal(await page.locator('[data-visual-mode="adsr"]').count(), 0, 'Envelope editing belongs in the existing Envelope mode');
    assert.equal(await page.locator('[data-visual-mode="envelope"]').getAttribute('aria-pressed'), 'true',
      'The existing Envelope mode remains selected by default');
    await showEditor(page);
    assert.equal(await page.locator(`${editor} [data-envelope-operator="4"]`).getAttribute('aria-pressed'), 'true');
    assert(await paints(page) > 0, 'The default Envelope displays editable operator curves');
    assert.equal(await page.evaluate(() => window.__synthAdsrContexts), 0, 'Showing Envelope must not initialize audio');
    await seedOperator(page);
    await page.locator('#synthFileSaveButton').click();
    await page.waitForFunction(() => document.getElementById('synthFileSaveButton').dataset.feedback === 'success');
    const baseline = await states(page);
    const edits = [];
    for (const [handle, dy, fields] of [['attack',14,['ar','tl']], ['decay',12,['d1r','sl']], ['sustain',0,['d2r']], ['release',0,['rr']]]) {
      const result = await drag(page, handle, {dx:30, dy});
      assertChanged(result, 4, fields); edits.push({handle, values:result.after[4]});
      assert.equal(await page.evaluate(() => window.__synthAdsrContexts), 0, 'Editing an unplayed instrument must remain lazy');
    }
    assert.match(await page.locator(`${editor} [data-envelope-readout]`).textContent(), /OP4.*AR.*TL.*D1R.*SL.*D2R.*RR/);
    assert.deepEqual(await page.evaluate(() => window.__synthAdsrTest.tone().operators), await states(page),
      'Graph edits must reach the current Virtual Files instrument');
    assert.equal(await page.locator('#synthFileRevertButton').isEnabled(), true, 'Graph edits must enable Revert');
    console.log(JSON.stringify({browser:name, phase:'silent-edits-and-files', passed:true}));

    // Reverting while a point is captured must end the old gesture even though
    // the file path and preset name can remain unchanged.
    const captured = await startDrag(page, 'attack');
    await page.mouse.move(captured.x + 10, captured.y + 4, {steps:2});
    await page.evaluate(() => document.getElementById('synthFileRevertButton').click());
    await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Reverted '));
    await page.mouse.move(captured.x + 180, captured.y + 80, {steps:3});
    await page.mouse.up(); await page.waitForTimeout(100);
    assert.deepEqual(await states(page), baseline, 'Revert cancels captured edits and restores the synced patch');
    assert.deepEqual(await page.evaluate(() => window.__synthAdsrTest.tone().operators), baseline,
      'Revert restores both the graph and its current instrument file');

    await selectOperator(page, 2); await seedOperator(page, 2);
    assertChanged(await drag(page, 'attack', {dx:30, dy:12}), 2, ['ar','tl']);
    await selectOperator(page, 4);
    const cancelled = await startDrag(page, 'decay');
    await page.evaluate(() => {document.querySelector('#synthEnvelopeEditor').open = false;});
    await page.waitForTimeout(60); const foldedState = await states(page);
    await page.mouse.move(cancelled.x + 170, cancelled.y + 40, {steps:3});
    await page.mouse.up(); await page.waitForTimeout(70);
    assert.deepEqual(await states(page), foldedState, 'Folding cancels captured envelope gestures');
    const foldedPaints = await paints(page); await page.waitForTimeout(180);
    assert.equal(await paints(page), foldedPaints, 'A folded editor must not continuously draw');
    await page.locator(`${editor} > summary`).click();
    await page.locator(canvas).scrollIntoViewIfNeeded(); await page.waitForTimeout(90);
    const staticPaints = await paints(page); await page.waitForTimeout(180);
    assert.equal(await paints(page), staticPaints, 'A static editor must not have its own animation loop');

    // Keep a computer-keyboard note held while dragging. The same current patch
    // must reach all six channels without retriggering or losing the key-up.
    // Finish the explicitly requested audio initialization before holding a key;
    // the constructor/WASM handshake is asynchronous on the first gesture.
    await page.locator('#keyboard .key').first().click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('Audio ready'));
    await page.locator(canvas).scrollIntoViewIfNeeded(); await page.waitForTimeout(60);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.down('a');
    await page.waitForFunction(() => window.__synthAdsrTest.voices().some(voice => voice.key === 'a' && voice.held));
    await page.waitForFunction(() => window.__synthAdsrTest.outputHistory().some(value => value > .001));
    await page.evaluate(() => {
      const fm = window.__synthAdsrTest.fm();
      window.__synthAdsrCalls = {operators:[], keyOn:0};
      const original = fm.setOperator.bind(fm);
      fm.setOperator = (...args) => {window.__synthAdsrCalls.operators.push(structuredClone(args)); return original(...args);};
      for (const method of ['keyOn', 'noteOn']) if (typeof fm[method] === 'function') {
        const original = fm[method].bind(fm);
        fm[method] = (...args) => {window.__synthAdsrCalls.keyOn++; return original(...args);};
      }
    });
    await selectOperator(page, 3);
    assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-envelope-operator]')), false,
      'Pointer operator selection must keep computer keyboard focus');
    await selectOperator(page, 4);
    const liveEdit = await drag(page, 'attack', {dx:25, dy:10, holdForOutput:true});
    assertChanged(liveEdit, 4, ['ar','tl']);
    const trace = await page.evaluate(() => window.__synthAdsrTrace);
    assert(trace.count > 0 && trace.duringDrag > 1 && trace.points.length > 2 && trace.sourcePeak > .001,
      'The same editable Envelope graph must continue drawing real output RMS while dragging');
    assert(trace.points.every(point => point.every(Number.isFinite)), 'The live RMS trace must contain finite plotted points');
    const calls = await page.evaluate(() => window.__synthAdsrCalls);
    assert.deepEqual([...new Set(calls.operators.filter(call => call[1] === 3).map(call => call[0]))].sort(), [0,1,2,3,4,5],
      'Live envelope changes must update all six Synth channels');
    assert.equal(calls.keyOn, 0, 'Envelope editing must not retrigger the held note');
    assert(await page.evaluate(() => window.__synthAdsrTest.voices().some(voice => voice.key === 'a' && voice.held)));
    await page.screenshot({path:path.join(artifacts, `synth-adsr-${name}.png`)});
    await page.keyboard.up('a');
    await page.waitForFunction(() => !window.__synthAdsrTest.voices().some(voice => voice.key === 'a' && voice.held));
    await page.locator('[data-visual-mode="waveform"]').click();
    await page.waitForTimeout(80);
    const hiddenPaints = await paints(page); await page.waitForTimeout(180);
    assert.equal(await paints(page), hiddenPaints, 'Waveform mode must stop hidden editor painting');
    const traceBeforeReturn = await page.evaluate(() => window.__synthAdsrTrace.count);
    await showEditor(page);
    await page.waitForFunction(count => window.__synthAdsrTrace.count > count, traceBeforeReturn);
    await page.locator('[data-visual-mode="spectrum"]').click();
    assert.equal(await page.locator(editor).isVisible(), false, 'Spectrum mode hides the integrated Envelope graph');

    const mobile = await browser.newPage({viewport:{width:390, height:844}, serviceWorkers:'block'});
    mobile.on('pageerror', error => errors.push('mobile: ' + error.message));
    await mobile.goto(url); await mobile.waitForFunction(() => !!window.__synthAdsrTest);
    await showEditor(mobile);
    const graph = await mobile.locator(canvas).boundingBox();
    assert(graph.width >= 280 && graph.width <= 390, 'The envelope graph must fit a narrow display');
    await mobile.screenshot({path:path.join(artifacts, `synth-adsr-mobile-${name}.png`)});
    await mobile.close();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({browser:name, entry, passed:true, edits, channels:[0,1,2,3,4,5], outputTrace:{draws:trace.count, whileDragging:trace.duringDrag, sourcePeak:trace.sourcePeak}, mobileGraphWidth:graph.width}));
    await page.close();
  } finally {await browser.close();}
}

(async () => {
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  try {
    const url = `http://127.0.0.1:${server.address().port}${entry}`;
    const browsers = process.argv.includes('--chromium') ? [['chromium',chromium]]
      : process.argv.includes('--webkit') ? [['webkit',webkit]] : [['chromium',chromium],['webkit',webkit]];
    for (const [name, type] of browsers) await checkBrowser(name, type, url);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
