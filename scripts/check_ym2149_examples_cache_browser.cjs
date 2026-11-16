// SPDX-License-Identifier: BSD-3-Clause
// Keep the real pre-Examples startup graph in a persistent HTTP cache.
// Playwright routing must stay disabled: route() disables the cache under test.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {root: path.join(repository, 'docs'), entry: '/synth-ym2149-st/index.html',
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'ym2149-examples-cache-browser.json')};
for (const argument of process.argv.slice(2)) {
  const match = /^--(root|entry|engines|out)=(.+)$/.exec(argument);
  assert(match, `Unknown argument ${argument}`);
  config[match[1]] = match[2];
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry), 'entry is an absolute page path');
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
const digest = body => createHash('sha256').update(body).digest('hex');
const legacyRevision = '2e67ed92';
const legacyPage = '/synth-ym2149-st/examples-cache-legacy.html';
const legacyHtmlPath = 'docs/synth-ym2149-st/index.html';
const legacyHtml = execFileSync('git', ['show', `${legacyRevision}:${legacyHtmlPath}`], {cwd: repository});
const fixtures = new Map([
  ['/synth-ym2149-st/synth.js', 'docs/synth-ym2149-st/synth.js'],
  ['/synth-ym2149-st/code_host.js', 'docs/synth-ym2149-st/code_host.js'],
  ['/synth-ym2149-st/code_files.js?v=draft-reconnect-1', 'docs/synth-ym2149-st/code_files.js'],
  ['/js/playground_code_runtime.js', 'docs/js/playground_code_runtime.js'],
].map(([url, source]) => [url, {source,
  body: execFileSync('git', ['show', `${legacyRevision}:${source}`], {cwd: repository})}]));
assert(legacyHtml.includes('src="./synth.js"'));
assert(!fixtures.get('/synth-ym2149-st/code_files.js?v=draft-reconnect-1').body.includes('ymFileExamplesButton'));
const freshResources = [
  '/synth-ym2149-st/synth.js?v=ym-examples-1',
  '/synth-ym2149-st/code_host.js?v=ym-examples-1',
  '/synth-ym2149-st/code_files.js?v=ym-examples-1',
  '/js/playground_code_runtime.js?v=console-table-1',
  '/js/playground_log.js?v=console-table-1',
];
const served = new Map();
let serveLegacy = false;
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ts': 'text/plain'};
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const resource = url.pathname + url.search;
    served.set(resource, (served.get(resource) ?? 0) + 1);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filename = path.resolve(config.root, '.' + pathname);
    assert(filename.startsWith(config.root + path.sep), 'path remains inside the served root');
    let body;
    if (url.pathname === legacyPage) {
      // The old HTML lives beside its original module paths in source and ZIP.
      // Each navigation gets a fresh document/module map without refetching JS.
      body = legacyHtml;
      response.setHeader('Cache-Control', 'no-store');
    } else if (serveLegacy && fixtures.has(resource)) {
      body = fixtures.get(resource).body;
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      body = await fs.readFile(filename);
      response.setHeader('Cache-Control', 'no-cache');
    }
    if (path.extname(filename) === '.html') {
      // Block the optional CDN editor without request interception; use the
      // application's supported local textarea fallback in this dependency test.
      response.setHeader('Content-Security-Policy', "script-src 'self' 'unsafe-eval' blob:; worker-src 'self' blob:");
    }
    response.setHeader('Content-Type', mime[path.extname(filename)] ?? 'application/octet-stream');
    response.end(body);
  } catch (error) {
    response.writeHead(404).end(error.message);
  }
});

function installSilentAudit() {
  const Context = window.AudioContext ?? window.webkitAudioContext;
  const connect = AudioNode.prototype.connect;
  const audit = window.__ymExamplesCacheAudit = {contexts: [], routes: []};
  window.AudioContext = class extends Context {
    constructor(...args) {super(...args); audit.contexts.push(this);}
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...args);
    const mute = this.context.createGain();
    mute.gain.value = 0;
    connect.call(this, mute, ...args);
    connect.call(mute, destination);
    audit.routes.push(mute);
    return destination;
  };
  audit.readProject = async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('tetorica-ym2149-st-synth-files', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects');
        const request = transaction.objectStore('projects').get('current');
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {database.close();}
  };
}

async function sentinels(page, write = false) {
  return page.evaluate(async write => {
    const localKey = 'ym2149-examples-cache-sentinel';
    if (write) localStorage.setItem(localKey, 'Keep my saved preferences.');
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('ym2149-examples-cache-sentinels', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sentinels');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (write) await new Promise((resolve, reject) => {
        const transaction = database.transaction('sentinels', 'readwrite');
        transaction.objectStore('sentinels').put({text: 'Keep my cassette data.',
          binary: new Uint8Array([0, 17, 128, 255])}, 'keep');
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      const value = await new Promise((resolve, reject) => {
        const request = database.transaction('sentinels').objectStore('sentinels').get('keep');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return {localStorage: localStorage.getItem(localKey), indexedDB: value && {
        text: value.text, binary: Array.from(value.binary)}};
    } finally {database.close();}
  }, write);
}

async function ready(page, examples) {
  await page.waitForFunction(examples => {
    const button = document.getElementById(examples ? 'ymFileExamplesButton' : 'ymFileNewButton');
    return Boolean(window.tetoricaYm2149StSynth && button && !button.disabled);
  }, examples);
}
async function project(page) {return page.evaluate(() => __ymExamplesCacheAudit.readProject());}
async function waitForProject(page, predicate, message) {
  // waitForFunction does not poll a Promise's resolved false value. Await each
  // actual IndexedDB read before deciding whether the startup save is complete.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const saved = await project(page);
    if (predicate(saved)) return saved;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(message);
}
async function liveState(page) {
  return page.evaluate(() => ({settings: tetoricaYm2149StSynth.getSettings(),
    selectedPath: document.getElementById('ymFilesSelected').textContent,
    inputMode: document.getElementById('synthInputSection').dataset.inputMode,
    running: tetoricaYm2149StSynth.getCodeState().running,
    audioContexts: __ymExamplesCacheAudit.contexts.length,
    filePaths: Array.from(document.querySelectorAll('#ymFilesTree button[data-file-path]'), button => button.dataset.filePath)}));
}
function preserved(before, after) {
  assert.deepEqual(after.settings, before.settings, 'instrument settings survive');
  assert.equal(after.selectedPath, before.selectedPath, 'selected file survives');
  assert.equal(after.inputMode, 'keyboard', 'Keyboard mode survives');
  assert.equal(after.running, false, 'Code never runs');
  assert.equal(after.audioContexts, 0, 'browsing and restoring never creates an AudioContext');
}
function preservedDraft(before, after) {
  for (const field of ['format', 'version', 'name', 'settings', 'selectedPath', 'codeState', 'workspaceId'])
    assert.deepEqual(after[field], before[field], `saved project ${field} survives`);
  for (const file of before.filesystem.files)
    assert.deepEqual(after.filesystem.files.find(candidate => candidate.path === file.path), file,
      `saved file ${file.path} survives`);
  for (const directory of before.filesystem.directories)
    assert(after.filesystem.directories.includes(directory), `saved directory ${directory} survives`);
}

async function check(name, origin) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'ym2149-examples-cache-'));
  let context, page;
  const errors = [], missing = [], editorPolicyMessages = [], unexpectedConsoleErrors = [];
  const counts = urls => Object.fromEntries(urls.map(url => [url, served.get(url) ?? 0]));
  try {
    context = await ({chromium, webkit}[name]).launchPersistentContext(profile, {
      headless: true, serviceWorkers: 'block', viewport: {width: 1280, height: 900}});
    await context.addInitScript(installSilentAudit);
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith(origin + '/') && response.status() >= 400) missing.push(response.url());
    });
    page.on('console', message => {
      if (message.type() !== 'error') return;
      if (message.text().includes('cdnjs.cloudflare.com/ajax/libs/monaco-editor/')) editorPolicyMessages.push(message.text());
      else unexpectedConsoleErrors.push(message.text());
    });

    serveLegacy = true;
    const beforeWarm = counts([...fixtures.keys()]);
    await page.goto(origin + legacyPage + '?warm=1');
    await ready(page, false);
    assert.equal(await page.locator('#ymFileExamplesButton').count(), 0);
    assert.equal(await page.locator('#ymFileSaveSoundButton').count(), 1);
    await page.locator('#presetName').fill('Saved cache-regression sound');
    await page.locator('#presetName').dispatchEvent('change');
    await page.locator('#noiseEnabled').check();
    await page.locator('#synthInputCodeTab').click();
    await page.waitForFunction(() => !document.getElementById('synthCodeEditor').readOnly);
    const savedIndex = '// Saved before the Examples upgrade.\nthrow new Error("Saved Code must never run while browsing Files");\n';
    await page.locator('#synthCodeEditor').fill(savedIndex);
    await page.locator('#synthInputKeyboardTab').click();
    await page.locator('#ymFilesToggle').click();
    await page.locator('#ymFilesTree button[data-file-path="/index.js"]').click();
    await page.waitForFunction(() => document.getElementById('ymFilesSelected').textContent === '/index.js');
    await waitForProject(page, saved => saved?.settings.name === 'Saved cache-regression sound' &&
        saved.selectedPath === '/index.js' && saved.codeState.mode === 'keyboard' &&
        saved.filesystem.files.some(file => file.path === '/index.js' && file.data === savedIndex),
      'the edited legacy project persists before navigation');
    const baseline = await liveState(page);
    const savedBefore = await project(page);
    const storage = await sentinels(page, true);
    assert.equal(baseline.selectedPath, '/index.js');
    assert.equal(baseline.inputMode, 'keyboard');
    assert(baseline.settings.voices.every(voice => voice.noise), 'saved settings differ from defaults');
    assert(!baseline.filePaths.some(file => file.startsWith('/examples/')));
    assert.equal(baseline.audioContexts, 0);
    const afterWarm = counts([...fixtures.keys()]);
    for (const url of fixtures.keys()) assert.equal(afterWarm[url] - beforeWarm[url], 1, `warm legacy response ${url} once`);

    // Deployment now exposes only current files. The old URLs must still come
    // from HTTP cache in a fresh document, proving the reported missing action.
    serveLegacy = false;
    await page.goto(origin + legacyPage + '?negative=1');
    await ready(page, false);
    if (!await page.locator('#ymFilesPanel').isVisible()) await page.locator('#ymFilesToggle').click();
    assert.equal(await page.locator('#ymFileNewButton').isVisible(), true);
    assert.equal(await page.locator('#ymFileSaveSoundButton').isVisible(), true);
    assert.equal(await page.locator('#ymFileExamplesButton').count(), 0, 'cached old Files panel has no Examples action');
    const negative = await liveState(page);
    preserved(baseline, negative);
    assert(!negative.filePaths.some(file => file.startsWith('/examples/')), 'cached old panel has no default examples');
    assert.deepEqual(counts([...fixtures.keys()]), afterWarm, 'negative control uses cached old startup modules');
    assert.deepEqual(await sentinels(page), storage);
    preservedDraft(savedBefore, await project(page));

    const beforeFresh = counts(freshResources);
    await page.goto(origin + config.entry);
    await ready(page, true);
    if (!await page.locator('#ymFilesPanel').isVisible()) await page.locator('#ymFilesToggle').click();
    await page.locator('#ymFilesTree button[data-file-path="/examples/sync-buzzer.js"]').waitFor({state: 'visible'});
    await page.locator('#ymFilesTree button[data-file-path="/examples/README.md"]').waitFor({state: 'visible'});
    const recovered = await liveState(page);
    preserved(baseline, recovered);
    assert.equal(await page.locator('#ymFileExamplesButton').isVisible(), true);
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => {
      const url = new URL(entry.name); return url.pathname + url.search;
    }));
    for (const url of freshResources) {
      assert(resources.includes(url), `current page requests ${url}`);
      assert.equal((served.get(url) ?? 0) - beforeFresh[url], 1, `fetch fresh startup resource ${url} once`);
    }
    assert.deepEqual(counts([...fixtures.keys()]), afterWarm, 'recovery leaves old cached startup responses untouched');
    await waitForProject(page, saved => ['/examples/sync-buzzer.js', '/examples/README.md'].every(path =>
        saved?.filesystem.files.some(file => file.path === path)),
      'the automatic examples persist without a repair click');
    const savedAfter = await project(page);
    preservedDraft(savedBefore, savedAfter);
    const examples = await page.evaluate(async () => {
      const {YM_CODE_EXAMPLES} = await import('/synth-ym2149-st/code_examples.js');
      return YM_CODE_EXAMPLES;
    });
    assert.deepEqual(Object.keys(examples).sort(), ['/examples/README.md', '/examples/sync-buzzer.js']);
    for (const [file, source] of Object.entries(examples))
      assert.equal(savedAfter.filesystem.files.find(entry => entry.path === file)?.data, source,
        `default example ${file} matches the shipped source`);
    assert.equal(savedAfter.filesystem.files.length, savedBefore.filesystem.files.length + 2);
    assert.deepEqual(await sentinels(page), storage, 'recovery preserves localStorage and binary/text IndexedDB data');

    // Examples is now a repair action. A click must keep the defaults and the
    // existing project unchanged rather than being necessary to discover them.
    await page.locator('#ymFileExamplesButton').click();
    await page.waitForFunction(() => document.getElementById('ymFilesStatus').textContent.includes('existing files were kept'));
    assert.deepEqual(await project(page), savedAfter, 're-adding defaults is idempotent');
    preserved(baseline, await liveState(page));
    await page.locator('#synthInputCodeTab').click();
    await page.locator('#synthCodeEditor').waitFor({state: 'visible'});
    await page.waitForFunction(() => !document.getElementById('synthCodeEditor').readOnly);
    assert.equal(await page.locator('#synthCodeEditor').inputValue(), savedIndex, 'restored index.js remains editable and unchanged');
    await page.locator('#synthInputKeyboardTab').click();
    await page.waitForFunction(() => document.getElementById('synthInputSection').dataset.inputMode === 'keyboard');
    preserved(baseline, await liveState(page));
    assert.deepEqual(await sentinels(page), storage);
    assert.deepEqual(counts([...fixtures.keys()]), afterWarm);
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    assert.deepEqual(missing, [], 'no missing local resources');
    assert.deepEqual(unexpectedConsoleErrors, [], 'no unexpected console errors');
    return {engine: name, passed: true, persistentHttpCache: true,
      legacyNetworkRequests: Object.fromEntries([...fixtures.keys()].map(url => [url, afterWarm[url] - beforeWarm[url]])),
      negativeControl: {freshDocument: true, newJsVisible: true, saveSoundVisible: true,
        examplesButtonPresent: false, exampleFilesPresent: false, oldStartupServedFromHttpCache: true},
      recovery: {entry: config.entry, freshResources, defaultExamplesVisibleBeforeClick: true,
        examplesButtonVisible: true, matchingExamplePaths: Object.keys(examples),
        savedIndexSha256: digest(savedIndex), savedSettings: recovered.settings,
        selectedPath: recovered.selectedPath, inputMode: recovered.inputMode,
        oldStartupStillCached: true, examplesRepairIsIdempotent: true,
        projectFilesBefore: savedBefore.filesystem.files.map(file => file.path),
        projectFilesAfter: savedAfter.filesystem.files.map(file => file.path)},
      storagePreserved: storage, audio: {contexts: 0, codeRunning: false, physicalRoutes: 0},
      editor: 'Local textarea fallback; CDN scripts denied by server CSP',
      expectedEditorPolicyMessages: editorPolicyMessages.length, errors, missing, unexpectedConsoleErrors};
  } catch (error) {
    if (page) {
      try {console.error(JSON.stringify({engine: name, errors, missing, unexpectedConsoleErrors,
        state: await page.evaluate(() => ({status: document.getElementById('audioStatus')?.textContent,
          files: document.getElementById('ymFilesStatus')?.textContent,
          examplesButton: Boolean(document.getElementById('ymFileExamplesButton')),
          error: document.getElementById('synthCodeError')?.textContent}))}, null, 2));} catch {}
      try {console.error(JSON.stringify({storedFiles: (await project(page))?.filesystem.files.map(file => ({
        path: file.path, type: file.type, textLength: typeof file.data === 'string' ? file.data.length : null,
      }))}, null, 2));} catch {}
    }
    throw error;
  } finally {
    await context?.close();
    await fs.rm(profile, {recursive: true, force: true});
  }
}

(async () => {
  const currentSources = [];
  for (const url of freshResources) {
    const body = await fs.readFile(path.join(config.root, new URL(url, 'http://localhost').pathname));
    currentSources.push({url, bytes: body.length, sha256: digest(body)});
  }
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const results = [];
    for (const name of engines) results.push(await check(name, origin));
    const report = {passed: true, entry: config.entry, routingDisabled: true,
      fixture: {revision: legacyRevision,
        html: {path: legacyHtmlPath, bytes: legacyHtml.length, sha256: digest(legacyHtml)},
        modules: [...fixtures].map(([url, {source, body}]) => ({url, path: source,
          bytes: body.length, sha256: digest(body)}))}, currentSources, results};
    await fs.mkdir(path.dirname(config.out), {recursive: true});
    await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
