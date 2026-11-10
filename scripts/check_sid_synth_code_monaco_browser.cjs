// Real Monaco integration for SID Synth Code, including actual editor visibility. This check never
// presses Run or creates an instrument. Every physical audio destination is
// intercepted before the app loads and connected through gain zero as well.
//
// node scripts/check_sid_synth_code_monaco_browser.cjs \
//   --root=docs --entry=/synth-sid/index.html --engines=chromium
// Exit 2 means the Monaco CDN was unavailable; exit 1 is an integration failure.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {tmpdir} = require('node:os');
const {chromium, webkit} = require('playwright');

const config = {
  root: path.resolve(__dirname, '../docs'),
  entry: '/synth-sid/index.html',
  engines: 'chromium',
  out: path.join(tmpdir(), 'sid-synth-code-monaco-browser.json'),
};
for (let i = 2; i < process.argv.length; i++) {
  const match = /^--(root|entry|engines|out)(?:=(.*))?$/.exec(process.argv[i]);
  assert(match, `Unknown argument: ${process.argv[i]}`);
  const value = match[2] ?? process.argv[++i];
  assert(value && !value.startsWith('--'), `Missing --${match[1]} value`);
  config[match[1]] = value;
}
config.root = path.resolve(config.root);
config.out = path.resolve(config.out);
const engines = config.engines.split(',');
assert(config.entry.startsWith('/'), '--entry must start with /');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)), 'Unknown browser engine');

const CDN_PREFIX = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/';
const isMonacoCdn = url => url.startsWith(CDN_PREFIX) && !url.includes('/../');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const served = new Map(), missing = [], blocked = [], cdn = new Map(), results = [];
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
};
class CdnUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'CdnUnavailableError'; }
}
async function bounded(promise, label, ms = 30000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const filename = path.resolve(config.root, '.' + decodeURIComponent(pathname));
    assert(filename.startsWith(config.root + path.sep), 'Path is outside package root');
    const bytes = await fs.readFile(filename);
    const relative = path.relative(config.root, filename).split(path.sep).join('/');
    const metadata = {bytes: bytes.length, sha256: hash(bytes)};
    if (served.has(relative)) assert.deepEqual(served.get(relative), metadata, 'Asset changed during check');
    served.set(relative, metadata);
    response.setHeader('Content-Type', mime[path.extname(filename)] ?? 'application/octet-stream');
    response.end(bytes);
  } catch (error) {
    missing.push({url: request.url, error: error.message});
    response.writeHead(404).end(error.message);
  }
});

function muteDestinations() {
  const gates = [], connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(destination, ...ports) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...ports);
    const gate = this.context.createGain();
    gate.gain.value = 0;
    connect.call(gate, destination);
    connect.call(this, gate, ...ports);
    gates.push(gate);
    return destination;
  };
  window.__synthCodeMonacoAudioAudit = () => ({
    destinationConnections: gates.length,
    physicallyMuted: gates.every(gate => gate.gain.value === 0),
  });
}

const GOOD_SOURCE = `// @ts-check
const sid = await useSoundChip('sid');
await sid.setVoice(CH1, {waveform: 'triangle+saw', attack: 2, sustain: 12});
await sid.setFilter({mode: 'notch', cutoff: 1200, resonance: 5, routing: 7});
const frequency = await sid.setFrequency(CH2, 440);
await sid.setNote(CH3, 'C4');
await sid.noteOn(CH1, 'C4');
await sid.noteOff(CH1);
const state = await sid.getState();
context.marker = state.channels[0].gate;
const prepared = await livePrepare('voice', async api => {
  const voice = await api.useSoundChip('sid');
  return {voice, count: 0};
});
prepared.count += 1;
liveLoop('phrase', async () => {
  await sid.noteOn(CH2, choose(scale('C4', 'minor')));
  await sleep(0.125);
  await sid.noteOff(CH2);
  await beat(0.5);
});
liveFx('gain', {context: {gain: 0.5}, process(input, output, state, ctx) {
  for (let i = 0; i < output[0].length; i++) output[0][i] = input[0][i] * ctx.gain;
}});
pg.log('ready', prepared.count, frequency);
`;
const BAD_SOURCE = `// @ts-check
await useSoundChip('ym2612');
log(CH4);
createSoundChip('sid');
await play('C4');
await pg.play('C4');
const sid = await useSoundChip('sid');
await sid.noteOn(3, 'C4');
`;

async function assertVisibleEditor(page, label) {
  const host = page.locator('#synthCodeEditorHost');
  await host.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const host = document.getElementById('synthCodeEditorHost');
    const editor = window.monaco?.editor?.getEditors().find(item => host?.contains(item.getDomNode()));
    const box = host?.getBoundingClientRect(), css = host && getComputedStyle(host);
    return host?.dataset.ready === 'true' && !host.hidden && css.display !== 'none' &&
      css.visibility !== 'hidden' && box.width > 100 && box.height >= 240 &&
      editor?.getLayoutInfo().width > 100 && editor.getLayoutInfo().height >= 240 &&
      /useSoundChip/.test(host.querySelector('.view-lines')?.textContent ?? '');
  });
  assert(await host.isVisible(), label + ': actual Monaco host is visible');
  assert(await page.locator('#synthCodeEditor').isHidden(), label + ': textarea is hidden only after Monaco is visible');
  return page.evaluate(() => {
    const host = document.getElementById('synthCodeEditorHost');
    const editor = monaco.editor.getEditors().find(item => host.contains(item.getDomNode()));
    const box = host.getBoundingClientRect(), layout = editor.getLayoutInfo();
    return {host: {width: box.width, height: box.height},
      editor: {width: layout.width, height: layout.height},
      renderedText: host.querySelector('.view-lines').textContent,
      source: editor.getValue(), hidden: host.hidden, display: getComputedStyle(host).display};
  });
}

async function setSource(page, source) {
  await page.evaluate(source => {
    const host = document.getElementById('synthCodeEditorHost');
    const editor = monaco.editor.getEditors().find(item => host.contains(item.getDomNode()));
    if (!editor) throw Error('Code Monaco editor missing');
    editor.setValue(source);
  }, source);
}
async function diagnostics(page) {
  return bounded(page.evaluate(async () => {
    const model = monaco.editor.getModels().find(item => item.uri.path === '/project/index.js');
    if (!model) throw Error('Code index.js Monaco model missing');
    const worker = await (await monaco.languages.typescript.getJavaScriptWorker())(model.uri);
    const simplify = item => ({
      code: item.code, category: item.category, start: item.start,
      line: model.getPositionAt(item.start ?? 0).lineNumber, message: item.messageText,
    });
    return {
      syntax: (await worker.getSyntacticDiagnostics(model.uri.toString())).map(simplify),
      semantic: (await worker.getSemanticDiagnostics(model.uri.toString())).map(simplify),
    };
  }), 'Monaco JavaScript worker diagnostics', 60000);
}
async function definition(page, {needle, symbol, file, sourceSymbol}) {
  const navigation = await page.evaluate(async ({needle, symbol}) => {
    const host = document.getElementById('synthCodeEditorHost');
    const editor = monaco.editor.getEditors().find(item => host.contains(item.getDomNode()));
    const model = editor.getModel(), index = model.getValue().indexOf(needle);
    if (index < 0) throw Error('Definition probe missing: ' + needle);
    // Overloaded hardware methods can have several declaration locations.
    // Follow the first through the public editor opener instead of a peek list.
    editor.updateOptions({gotoLocation: {multipleDefinitions: 'goto'}});
    editor.setPosition(model.getPositionAt(index + needle.indexOf(symbol) + 1));
    editor.focus();
    const action = editor.getAction('editor.action.revealDefinition');
    // Registered editor commands need not appear in getAction(). trigger() is
    // the public command route also used by the app's source-view context menu.
    // The visible dialog and requested source model are still asserted below.
    if (action) await action.run();
    else editor.trigger('synth-code-monaco-check', 'editor.action.revealDefinition', {});
    return {dispatch: action ? 'action.run' : 'editor.trigger',
      relatedActions: editor.getSupportedActions().map(item => item.id).filter(id => /defin|declar|symbol/i.test(id))};
  }, {needle, symbol});
  const dialog = page.locator('dialog[data-monaco-definition="true"]');
  await dialog.waitFor({state: 'visible'}).catch(error => {
    throw Error(`${error.message}\nNavigation diagnostic: ${JSON.stringify(navigation)}`);
  });
  await page.waitForFunction(() => {
    const dialog = document.querySelector('dialog[data-monaco-definition="true"]');
    return dialog?.open && dialog.querySelector('strong')?.textContent.endsWith('.d.ts (read-only)');
  });
  await dialog.getByRole('button', {name: 'View implementation', exact: true}).click();
  await page.waitForFunction(file => {
    const dialog = document.querySelector('dialog[data-monaco-definition="true"]');
    return dialog?.querySelector('strong')?.textContent === file + ' (read-only)' ||
      /Could not load/.test(dialog?.querySelector('[role="status"]')?.textContent ?? '');
  }, file);
  assert.equal(await dialog.locator('strong').textContent(), file + ' (read-only)',
    await dialog.locator('[role="status"]').textContent());
  const result = await page.evaluate(file => {
    const model = monaco.editor.getModels().find(item => item.uri.path === '/tetorica-runtime/' + file);
    const editor = monaco.editor.getEditors().find(item => item.getModel() === model);
    return model && editor ? {
      path: model.uri.path, text: model.getValue(), position: editor.getPosition(),
      readOnly: editor.getOption(monaco.editor.EditorOption.readOnly),
      line: model.getLineContent(editor.getPosition().lineNumber),
    } : null;
  }, file);
  assert(result, 'Implementation opens a real Monaco source model');
  assert(result.readOnly, 'Implementation is read-only');
  assert(result.text.length > 1000 && result.text.split('\n').length > 30, 'Readable source, not a stub');
  assert(result.position.lineNumber > 1, 'Implementation navigates to the function');
  assert(result.line.includes(sourceSymbol ?? symbol), 'Implementation points to the requested symbol');
  const receipt = {file, symbol, bytes: Buffer.byteLength(result.text),
    sha256: hash(result.text), line: result.position.lineNumber, readOnly: result.readOnly, navigation};
  await dialog.getByRole('button', {name: 'Close', exact: true}).click();
  return receipt;
}

async function checkFallback(browser, name, origin) {
  const context = await browser.newContext({viewport: {width: 1240, height: 1100}, serviceWorkers: 'block'});
  await context.addInitScript(muteDestinations);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  try {
    await page.goto(origin + config.entry);
    await page.waitForFunction(() => document.querySelector('.sid-main')?.inert === false && document.getElementById('sidFileNewButton')?.disabled === false);
    await page.locator('#synthInputCodeTab').click();
    await page.waitForFunction(() => /Fallback|could not load|unavailable/i.test(document.getElementById('synthCodeEditorNote')?.textContent ?? ''));
    const textarea = page.locator('#synthCodeEditor');
    assert(await textarea.isVisible(), 'A failed Monaco CDN keeps the fallback editor visible');
    assert.match(await textarea.inputValue(), /useSoundChip\("sid"\)/, 'Fallback retains SID source');
    assert(await page.locator('#synthCodeEditorHost').isHidden(), 'Unready Monaco host does not leave an empty editor');
    await textarea.fill('// fallback edit\nconst sid = await useSoundChip("sid");\n');
    await page.locator('#synthInputKeyboardTab').click();
    await page.locator('#synthCodePanel').waitFor({state: 'hidden'});
    await page.locator('#synthInputCodeTab').click();
    assert(await textarea.isVisible(), 'Fallback survives a Keyboard/Code switch');
    assert.match(await textarea.inputValue(), /fallback edit/);
    for (const width of [1240, 390]) {
      await page.setViewportSize({width, height: 1100});
      await page.locator('#synthCodeExpandButton').click();
      assert(await textarea.isVisible(), 'Expanded fallback remains visible at ' + width);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Fallback fits ' + width);
      await page.locator('#synthCodeExpandButton').click();
    }
    const audio = await page.evaluate(() => __synthCodeMonacoAudioAudit());
    assert(audio.physicallyMuted && audio.destinationConnections === 0, 'Fallback never starts audio');
    return {browser: name, passed: true, cdnIntentionallyBlocked: true, audio};
  } finally { await context.close(); }
}

async function run(browser, name, origin) {
  const context = await browser.newContext({viewport: {width: 1240, height: 1100}, serviceWorkers: 'block'});
  const page = await context.newPage(), pageErrors = [], consoleErrors = [], cdnFailures = [];
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push({text: message.text(), url: message.location().url});
  });
  page.on('requestfailed', request => {
    if (isMonacoCdn(request.url())) cdnFailures.push({url: request.url(), error: request.failure()?.errorText});
  });
  page.on('response', response => {
    if (isMonacoCdn(response.url())) {
      cdn.set(response.url(), {status: response.status()});
      if (response.status() >= 400) cdnFailures.push({url: response.url(), status: response.status()});
    }
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol) || isMonacoCdn(url.href)) {
      return route.continue();
    }
    blocked.push(url.href);
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(muteDestinations);
  const result = {browser: name, viewport: {width: 1240, height: 1100}, steps: []};
  try {
    await page.goto(origin + config.entry);
    await page.waitForFunction(() => document.querySelector('.sid-main')?.inert === false && document.getElementById('sidFileNewButton')?.disabled === false);
    assert.equal(await page.locator('#synthInputKeyboardTab').getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => Boolean(window.monaco)), false, 'Monaco stays lazy before Code opens');
    await page.locator('#synthInputCodeTab').click();
    try {
      await page.waitForFunction(() => {
        const host = document.getElementById('synthCodeEditorHost');
        return window.monaco?.editor?.getEditors().some(editor => host?.contains(editor.getDomNode())) ||
          /Fallback|could not load|unavailable/i.test(document.getElementById('synthCodeEditorNote')?.textContent ?? '');
      }, null, {timeout: 60000});
      const ready = await page.evaluate(() => {
        const host = document.getElementById('synthCodeEditorHost');
        return Boolean(window.monaco?.editor?.getEditors().some(editor => host?.contains(editor.getDomNode())));
      });
      if (!ready) {
        const note = await page.locator('#synthCodeEditorNote').textContent();
        if (cdnFailures.length) throw new CdnUnavailableError(note);
        throw Error('Monaco initialization failed without a CDN network failure: ' + note);
      }
    } catch (error) {
      if (error instanceof CdnUnavailableError) throw error;
      if (error.name === 'TimeoutError' && cdnFailures.length) throw new CdnUnavailableError(error.message);
      throw error;
    }
    result.initialLayout = await assertVisibleEditor(page, 'Initial Code tab');
    assert.match(result.initialLayout.source, /const sid = await useSoundChip\("sid"\)/, 'The starter source is populated');
    result.steps.push('Code lazily loads real Monaco and displays its rendered starter source in a nonzero host');
    const declarations = await page.evaluate(() => monaco.editor.getModels()
      .filter(model => model.uri.path.endsWith('.d.ts'))
      .map(model => ({path: model.uri.path, bytes: model.getValue().length,
        unavailableGlobals: /declare (?:function|const|var) (?:play|createSoundChip|midi|fm|psg|CH4)\b/.test(model.getValue())})));
    assert.equal(declarations.length, 1, 'Code registers only its shared, filtered declarations');
    assert.equal(declarations[0].path, '/tetorica-playground-globals.d.ts');
    assert(!declarations[0].unavailableGlobals, 'Full Playground globals do not leak into Code');
    result.declarations = declarations;

    await setSource(page, GOOD_SOURCE);
    try { result.good = await diagnostics(page); }
    catch (error) {
      if (/Timed out|TimeoutError/.test(error.message) && cdnFailures.length) throw new CdnUnavailableError(error.message);
      throw error;
    }
    assert.deepEqual(result.good, {syntax: [], semantic: []}, 'Awaited SID physical CH1/CH2/CH3, context, livePrepare and liveFx type-check');
    await page.evaluate(() => {
      const host=document.getElementById('synthCodeEditorHost');
      const editor=monaco.editor.getEditors().find(item=>host.contains(item.getDomNode()));
      editor.setPosition({lineNumber:5,column:3});window.__expandedMonaco={editor,model:editor.getModel()};
    });
    await page.locator('#synthInputKeyboardTab').click();
    await page.locator('#synthCodePanel').waitFor({state: 'hidden'});
    assert(await page.locator('#synthCodePanel').isHidden(), 'Keyboard hides the editor panel');
    await page.locator('#synthInputCodeTab').click();
    result.returnedLayout = await assertVisibleEditor(page, 'Return from Keyboard');
    assert.equal(result.returnedLayout.source, GOOD_SOURCE, 'Switching tabs keeps source');
    result.layouts = [];
    for(const width of [1240,390]) {
      await page.setViewportSize({width,height:1100});
      await page.locator('#synthCodeExpandButton').click();
      assert(await page.locator('#synthExpandedCodeSlot #synthCodeEditorHost').isVisible());
      assert(await page.locator('#sidFilesPanel').isVisible());
      result.layouts.push({width,expanded:true,...await assertVisibleEditor(page,'Expanded '+width)});
      assert(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1),'Expanded Monaco fits '+width);
      await page.locator('#synthCodeExpandButton').click();
      result.layouts.push({width,expanded:false,...await assertVisibleEditor(page,'Restored '+width)});
      assert(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1),'Restored Monaco fits '+width);
    }
    await page.setViewportSize({width:1240,height:1100});
    assert(await page.evaluate(() => {
      const host=document.getElementById('synthCodeEditorHost'),editor=monaco.editor.getEditors().find(item=>host.contains(item.getDomNode()));
      return editor===__expandedMonaco.editor&&editor.getModel()===__expandedMonaco.model&&editor.getPosition().lineNumber===5;
    }),'Tabs and Maximize / Restore keep the real Monaco instance, model and cursor');
    assert.equal(await page.evaluate(()=>__expandedMonaco.editor.getValue()),GOOD_SOURCE);
    result.steps.push('Keyboard/Code tabs and 1240px/390px Maximize/Restore preserve a visible real Monaco instance, model, text and cursor');
    await setSource(page, BAD_SOURCE);
    result.bad = await diagnostics(page);
    assert.deepEqual(result.bad.syntax, [], 'Negative probes are syntactically valid JavaScript');
    for (const line of [2, 3, 4, 5, 6, 8]) assert(result.bad.semantic.some(item => item.line === line), 'Unavailable API rejected on line ' + line);
    result.steps.push('The actual JavaScript worker accepts explicit instruments and rejects other chips, CH4, channel 3, independent factories and implicit play');

    result.chipCompletions = await bounded(page.evaluate(async () => {
      const source = 'await useSoundChip("");';
      const model = monaco.editor.getModels().find(item => item.uri.path === '/project/index.js');
      model.setValue(source);
      const worker = await (await monaco.languages.typescript.getJavaScriptWorker())(model.uri);
      const completion = await worker.getCompletionsAtPosition(model.uri.toString(), source.indexOf('""') + 1);
      return (completion?.entries ?? []).map(entry => entry.name.replace(/^["']|["']$/g, '')).sort();
    }), 'SID literal completion');
    assert.deepEqual(result.chipCompletions, ['sid']);
    result.steps.push('useSoundChip literal completion offers only the shared SID');

    await setSource(page, GOOD_SOURCE);
    await diagnostics(page);
    result.implementations = [];
    for (const target of [
      {needle: "useSoundChip('sid')", symbol: 'useSoundChip', file: 'playground_code_runtime.js'},
      {needle: 'sid.setVoice', symbol: 'setVoice', file: 'sidsynth.js'},
    ]) result.implementations.push(await bounded(definition(page, target), 'Go to Definition / ' + target.file, 60000));
    result.steps.push('Public Go to Definition and View implementation open readable Code runtime and SID sources');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '1240px layout has no horizontal overflow');
    result.audio = await page.evaluate(() => __synthCodeMonacoAudioAudit());
    assert(result.audio.physicallyMuted, 'Every physical output remains gain zero');
    assert.match(await page.locator('#synthCodeState').textContent(), /Idle|Stopped/i, 'Type checks never execute user Code');
    assert.equal(await page.locator('#keyboard .key.is-active').count(), 0, 'No performance key was played');
    assert.deepEqual(missing, [], 'No packaged type or source asset returns 404');
    assert.deepEqual(blocked, [], 'Only local package and pinned Monaco CDN URLs are requested');
    assert.deepEqual(pageErrors, [], 'No JavaScript page errors');
    assert.deepEqual(consoleErrors, [], 'No browser console errors');
    result.screenshot = path.join(path.dirname(config.out), path.basename(config.out, '.json') + '-' + name + '.png');
    await fs.mkdir(path.dirname(result.screenshot), {recursive: true});
    await page.locator('#synthWorkspace').screenshot({path: result.screenshot});
    result.cdnFailures = cdnFailures;
    result.passed = true;
    return result;
  } catch (error) {
    result.passed = false;
    result.status = error instanceof CdnUnavailableError ? 'cdn-unavailable' : 'failed';
    result.error = error.stack ?? error.message;
    result.cdnFailures = cdnFailures;
    result.pageErrors = pageErrors;
    result.consoleErrors = consoleErrors;
    results.push(result);
    throw error;
  } finally { await context.close(); }
}

(async () => {
  let failure;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const name of engines) {
      const browser = await bounded(({chromium, webkit})[name].launch({
        headless: true, ...(name === 'chromium' ? {args: ['--mute-audio']} : {}),
      }), 'launch ' + name);
      try {
        const fallback = await checkFallback(browser, name, origin);
        const result = await run(browser, name, origin);
        result.fallback = fallback;
        results.push(result);
        console.log(`PASS ${name}: visible real SID Monaco, types, SID completion and readable implementation navigation`);
      } finally { await browser.close(); }
    }
  } catch (error) { failure = error; }
  finally {
    server.closeIdleConnections?.(); server.closeAllConnections?.();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
  const unavailable = failure instanceof CdnUnavailableError;
  const report = {
    passed: !failure, status: failure ? unavailable ? 'cdn-unavailable' : 'failed' : 'passed',
    infrastructureFailure: unavailable, root: config.root, entry: config.entry,
    userCodeExecuted: false, listeningPerformed: false, physicalOutputMuted: true,
    error: failure ? failure.stack ?? failure.message : undefined, results,
    missing, blocked, cdn: Object.fromEntries([...cdn].sort(([a], [b]) => a.localeCompare(b))),
    assets: Object.fromEntries([...served].sort(([a], [b]) => a.localeCompare(b))),
  };
  await fs.mkdir(path.dirname(config.out), {recursive: true});
  await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status.toUpperCase()} receipt ${config.out}`);
  if (failure) { console.error(failure); process.exitCode = unavailable ? 2 : 1; }
})().catch(error => { console.error(error); process.exitCode = 1; });
