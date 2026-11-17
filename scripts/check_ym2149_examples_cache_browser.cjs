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
const legacyExamplesRevision = 'e3e82949';
const legacyExamplesUrl = '/synth-ym2149-st/code_examples.js';
const currentExamplesUrl = '/synth-ym2149-st/code_examples.js?v=ym-envelope-melody-1';
const legacyPage = '/synth-ym2149-st/examples-cache-legacy.html';
const legacyHtmlPath = 'docs/synth-ym2149-st/index.html';
const legacyHtml = execFileSync('git', ['show', `${legacyRevision}:${legacyHtmlPath}`], {cwd: repository});
const fixtures = new Map([
  ['/synth-ym2149-st/synth.js', 'docs/synth-ym2149-st/synth.js'],
  ['/synth-ym2149-st/code_host.js', 'docs/synth-ym2149-st/code_host.js'],
  ['/synth-ym2149-st/code_files.js?v=draft-reconnect-1', 'docs/synth-ym2149-st/code_files.js'],
  ['/js/playground_code_runtime.js', 'docs/js/playground_code_runtime.js'],
  [legacyExamplesUrl, 'docs/synth-ym2149-st/code_examples.js', legacyExamplesRevision],
].map(([url, source, revision = legacyRevision]) => [url, {source, revision,
  body: execFileSync('git', ['show', `${revision}:${source}`], {cwd: repository})}]));
assert(legacyHtml.includes('src="./synth.js"'));
assert(!fixtures.get('/synth-ym2149-st/code_files.js?v=draft-reconnect-1').body.includes('ymFileExamplesButton'));
// Pin the immediate predecessor as well as the older missing-Examples graph.
// Never use a moving HEAD here: committing this test must not change fixtures.
const previousRevision = 'd3f20bfb9d5170b0ede6ef9882ebb0ba18e3105e';
const previousPage = '/synth-ym2149-st/examples-cache-previous-release.html';
const previousExamplesUrl = '/synth-ym2149-st/code_examples.js?v=ym-sample-1';
const previousHtml = execFileSync('git', ['show', `${previousRevision}:${legacyHtmlPath}`], {cwd: repository});
const previousFixtures = new Map(['synth.js', 'code_host.js', 'code_files.js', 'code_examples.js'].map(module => {
  const source = 'docs/synth-ym2149-st/' + module;
  return ['/synth-ym2149-st/' + module + '?v=ym-sample-1', {source, revision: previousRevision,
    body: execFileSync('git', ['show', `${previousRevision}:${source}`], {cwd: repository})}];
}));
assert(previousHtml.includes('src="./synth.js?v=ym-sample-1"'));
assert(previousFixtures.get(previousExamplesUrl).body.includes("'/examples/volume-sample.js'"));
assert(!previousFixtures.get(previousExamplesUrl).body.includes("'/examples/envelope-melody.js'"));
const freshResources = [
  '/synth-ym2149-st/synth.js?v=ym-envelope-melody-1',
  '/synth-ym2149-st/code_host.js?v=ym-envelope-melody-1',
  '/synth-ym2149-st/code_files.js?v=ym-envelope-melody-1',
  currentExamplesUrl,
  '/js/playground_code_runtime.js?v=console-table-1',
  '/js/playground_log.js?v=console-table-1',
];
const served = new Map();
let serveLegacy = false, servePrevious = false;
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
    } else if (url.pathname === previousPage) {
      body = previousHtml;
      response.setHeader('Cache-Control', 'no-store');
    } else if (serveLegacy && fixtures.has(resource)) {
      body = fixtures.get(resource).body;
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (servePrevious && previousFixtures.has(resource)) {
      body = previousFixtures.get(resource).body;
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
    const button = document.getElementById(examples ? 'ymProjectNewButton' : 'ymFileNewButton');
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
    // An earlier deployment also left the three-example module cached under its
    // unversioned URL. Loading its definitions must not add files or run Code.
    const cachedExamplePaths = await page.evaluate(async url =>
      Object.keys((await import(url)).YM_CODE_EXAMPLES).sort(), legacyExamplesUrl);
    assert.deepEqual(cachedExamplePaths, [
      '/examples/README.md', '/examples/sync-buzzer.js', '/examples/volume-modulation.js',
    ]);
    assert.deepEqual(await project(page), savedBefore, 'priming the old example definitions preserves the draft');
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
    assert.deepEqual(await page.evaluate(async url =>
      Object.keys((await import(url)).YM_CODE_EXAMPLES).sort(), legacyExamplesUrl), cachedExamplePaths,
    'the unversioned URL still exposes the cached three-example module');
    assert.deepEqual(counts([...fixtures.keys()]), afterWarm, 'negative control uses cached old startup modules');
    assert.deepEqual(await sentinels(page), storage);
    preservedDraft(savedBefore, await project(page));

    const beforeFresh = counts(freshResources);
    await page.goto(origin + config.entry);
    await ready(page, true);
    assert(await page.evaluate(url => performance.getEntriesByType('resource').some(entry =>
      entry.name === new URL(url, location.href).href), currentExamplesUrl),
    'startup requests the versioned examples module before the test inspects it');
    const examples = await page.evaluate(async url => {
      const {YM_CODE_EXAMPLES} = await import(url);
      return YM_CODE_EXAMPLES;
    }, currentExamplesUrl);
    const examplePaths = Object.keys(examples).sort();
    assert(examplePaths.includes('/examples/volume-modulation.js'), 'the shipped examples include volume modulation');
    assert(examplePaths.includes('/examples/volume-sample.js'), 'the shipped examples include the volume sample');
    assert(examplePaths.includes('/examples/envelope-melody.js'), 'the shipped examples include envelope melody');
    if (!await page.locator('#ymFilesPanel').isVisible()) await page.locator('#ymFilesToggle').click();
    for (const filePath of examplePaths)
      await page.locator(`#ymFilesTree button[data-file-path="${filePath}"]`).waitFor({state: 'visible'});
    const recovered = await liveState(page);
    preserved(baseline, recovered);
    assert.equal(await page.locator('#ymFileExamplesButton').count(), 0, 'redundant Examples action is removed');
    assert.equal(await page.locator('#ymProjectNewButton').count(), 1, 'New Project is available in the menu');
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => {
      const url = new URL(entry.name); return url.pathname + url.search;
    }));
    for (const url of freshResources) {
      assert(resources.includes(url), `current page requests ${url}`);
      assert.equal((served.get(url) ?? 0) - beforeFresh[url], 1, `fetch fresh startup resource ${url} once`);
    }
    assert.deepEqual(counts([...fixtures.keys()]), afterWarm, 'recovery leaves old cached startup responses untouched');
    const savedAfter = await waitForProject(page, saved => examplePaths.every(filePath =>
        saved?.filesystem.files.some(file => file.path === filePath)),
      'the automatic examples persist without a repair click');
    preservedDraft(savedBefore, savedAfter);
    for (const [file, source] of Object.entries(examples))
      assert.equal(savedAfter.filesystem.files.find(entry => entry.path === file)?.data, source,
        `default example ${file} matches the shipped source`);
    assert.deepEqual(savedAfter.filesystem.files.map(file => file.path).sort(),
      [...savedBefore.filesystem.files.map(file => file.path), ...examplePaths].sort(),
      'recovery adds exactly the shipped examples to the saved project');
    assert.equal(savedAfter.filesystem.files.length, savedBefore.filesystem.files.length + examplePaths.length);
    assert.deepEqual(await sentinels(page), storage, 'recovery preserves localStorage and binary/text IndexedDB data');

    // Default files require no toolbar action or project replacement.
    assert.deepEqual(await project(page), savedAfter, 'discovery preserves the saved project');
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
        examplesButtonPresent: false, exampleFilesPresent: false, cachedExamplePaths,
        oldStartupServedFromHttpCache: true},
      recovery: {entry: config.entry, freshResources, defaultExamplesVisibleBeforeClick: true,
        examplesButtonPresent: false, newProjectMenuPresent: true, matchingExamplePaths: Object.keys(examples),
        savedIndexSha256: digest(savedIndex), savedSettings: recovered.settings,
        selectedPath: recovered.selectedPath, inputMode: recovered.inputMode,
        oldStartupStillCached: true,
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

async function checkPreviousRelease(name, origin) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'ym2149-previous-release-cache-'));
  let context, page;
  const errors = [], missing = [], editorPolicyMessages = [], unexpectedConsoleErrors = [];
  const counts = urls => Object.fromEntries(urls.map(url => [url, served.get(url) ?? 0]));
  const previousPaths = ['/examples/README.md', '/examples/sync-buzzer.js',
    '/examples/volume-modulation.js', '/examples/volume-sample.js'].sort();
  const newPath = '/examples/envelope-melody.js', editedPath = '/examples/sync-buzzer.js';
  const newResources = freshResources.filter(url => url.startsWith('/synth-ym2149-st/'));
  const savedIndex = '// Saved before the envelope-melody release.\nthrow new Error("Saved index must never auto-run");\n';
  const savedExample = '// Keep my edited Sync-buzzer example.\nthrow new Error("Saved example must never auto-run");\n';
  function checkPreserved(before, after) {
    assert.deepEqual(after.settings, before.settings, 'previous-release instrument settings survive');
    assert.equal(after.selectedPath, editedPath, 'previous-release selected example survives');
    assert.equal(after.inputMode, 'code', 'previous-release Code mode survives without auto-run');
    assert.equal(after.running, false, 'previous-release saved Code never runs');
    assert.equal(after.audioContexts, 0, 'previous-release restoration never creates audio');
  }
  try {
    context = await ({chromium, webkit}[name]).launchPersistentContext(profile, {
      headless: true, serviceWorkers: 'block', viewport: {width: 1280, height: 900}});
    await context.addInitScript(installSilentAudit);
    page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith(origin + '/') && response.status() >= 400) missing.push(response.url());
    });
    page.on('console', message => {
      if (message.type() !== 'error') return;
      if (message.text().includes('cdnjs.cloudflare.com/ajax/libs/monaco-editor/')) editorPolicyMessages.push(message.text());
      else unexpectedConsoleErrors.push(message.text());
    });
    servePrevious = true;
    const beforeWarm = counts([...previousFixtures.keys()]);
    await page.goto(origin + previousPage + '?warm=1'); await ready(page, true);
    const oldDefinitions = await page.evaluate(async url =>
      (await import(url)).YM_CODE_EXAMPLES, previousExamplesUrl);
    assert.deepEqual(Object.keys(oldDefinitions).sort(), previousPaths, 'pinned prior release has exactly four definitions');
    await waitForProject(page, saved => previousPaths.every(filePath =>
      saved?.filesystem.files.some(file => file.path === filePath)), 'previous-release defaults persist');
    await page.locator('#presetName').fill('Saved prior-release sound');
    await page.locator('#presetName').dispatchEvent('change');
    await page.locator('#noiseEnabled').check();
    if (!await page.locator('#ymFilesPanel').isVisible()) await page.locator('#ymFilesToggle').click();
    await page.locator('#synthInputCodeTab').click();
    await page.waitForFunction(() => !document.getElementById('synthCodeEditor').readOnly);
    await page.locator('#ymFilesTree button[data-file-path="/index.js"]').click();
    await page.waitForFunction(() => document.getElementById('ymFilesSelected').textContent === '/index.js');
    await page.locator('#synthCodeEditor').fill(savedIndex);
    await page.locator(`#ymFilesTree button[data-file-path="${editedPath}"]`).click();
    await page.waitForFunction(file => document.getElementById('ymFilesSelected').textContent === file, editedPath);
    await page.locator('#synthCodeEditor').fill(savedExample);
    const savedBefore = await waitForProject(page, saved =>
      saved?.settings.name === 'Saved prior-release sound' && saved.selectedPath === editedPath &&
      saved.codeState.mode === 'code' && saved.codeState.path === editedPath &&
      saved.filesystem.files.some(file => file.path === '/index.js' && file.data === savedIndex) &&
      saved.filesystem.files.some(file => file.path === editedPath && file.data === savedExample),
    'both user edits and Code selection persist before deployment');
    const baseline = await liveState(page), storage = await sentinels(page, true);
    checkPreserved(baseline, baseline);
    assert(!baseline.filePaths.includes(newPath));
    const afterWarm = counts([...previousFixtures.keys()]);
    for (const url of previousFixtures.keys())
      assert.equal(afterWarm[url] - beforeWarm[url], 1, `warm previous-release response ${url} once`);

    // Current bytes are now the only server responses. A fresh document using
    // the previous HTML still sees the immutable old graph and four definitions.
    servePrevious = false;
    await page.goto(origin + previousPage + '?negative=1'); await ready(page, true);
    const negative = await liveState(page); checkPreserved(baseline, negative);
    assert(!negative.filePaths.includes(newPath), 'cached prior graph cannot discover the new definition');
    assert.deepEqual(await page.evaluate(async url =>
      Object.keys((await import(url)).YM_CODE_EXAMPLES).sort(), previousExamplesUrl), previousPaths);
    assert.deepEqual(counts([...previousFixtures.keys()]), afterWarm, 'prior-release negative control uses actual HTTP cache');
    preservedDraft(savedBefore, await project(page));
    assert.deepEqual(await sentinels(page), storage);
    assert.equal(await page.locator('#synthCodeEditor').inputValue(), savedExample);

    const beforeFresh = counts(newResources);
    await page.goto(origin + config.entry); await ready(page, true);
    assert(await page.evaluate(url => performance.getEntriesByType('resource').some(entry =>
      entry.name === new URL(url, location.href).href), currentExamplesUrl), 'fresh startup itself requests new definitions');
    const definitions = await page.evaluate(async url =>
      (await import(url)).YM_CODE_EXAMPLES, currentExamplesUrl);
    assert.deepEqual(Object.keys(definitions).sort(), [...previousPaths, newPath].sort(), 'current release adds one definition');
    const savedAfter = await waitForProject(page, saved =>
      saved?.filesystem.files.some(file => file.path === newPath), 'new example persists automatically');
    preservedDraft(savedBefore, savedAfter);
    assert.equal(savedAfter.filesystem.files.length, savedBefore.filesystem.files.length + 1);
    assert.equal(savedAfter.filesystem.files.find(file => file.path === newPath)?.data, definitions[newPath]);
    assert.deepEqual(savedAfter.filesystem.files.map(file => file.path).sort(),
      [...savedBefore.filesystem.files.map(file => file.path), newPath].sort(), 'only the missing example is inserted');
    if (!await page.locator('#ymFilesPanel').isVisible()) await page.locator('#ymFilesToggle').click();
    await page.locator(`#ymFilesTree button[data-file-path="${newPath}"]`).waitFor({state: 'visible'});
    const recovered = await liveState(page); checkPreserved(baseline, recovered);
    await page.locator('#synthCodeEditor').waitFor({state: 'visible'});
    assert.equal(await page.locator('#synthCodeEditor').inputValue(), savedExample, 'edited example remains visible and unchanged');
    assert.equal(savedAfter.filesystem.files.find(file => file.path === '/index.js')?.data, savedIndex);
    for (const url of newResources)
      assert.equal((served.get(url) ?? 0) - beforeFresh[url], 1, `fresh new-release resource ${url} once`);
    assert.deepEqual(counts([...previousFixtures.keys()]), afterWarm, 'new startup leaves old immutable responses cached');
    assert.deepEqual(await sentinels(page), storage);
    assert.deepEqual(errors, []); assert.deepEqual(missing, []); assert.deepEqual(unexpectedConsoleErrors, []);
    return {engine: name, passed: true, persistentHttpCache: true, fixtureRevision: previousRevision,
      previousNetworkRequests: Object.fromEntries([...previousFixtures.keys()].map(url => [url, afterWarm[url] - beforeWarm[url]])),
      negativeControl: {freshDocument: true, cachedExamplePaths: previousPaths, newExamplePresent: false,
        previousStartupServedFromHttpCache: true},
      recovery: {entry: config.entry, freshResources: newResources, addedPath: newPath,
        sourceMatchesCurrent: true, previousStartupStillCached: true,
        savedIndexSha256: digest(savedIndex), editedExampleSha256: digest(savedExample),
        selectedPath: recovered.selectedPath, inputMode: recovered.inputMode,
        projectFilesBefore: savedBefore.filesystem.files.map(file => file.path),
        projectFilesAfter: savedAfter.filesystem.files.map(file => file.path)},
      storagePreserved: storage, audio: {contexts: 0, codeRunning: false, physicalRoutes: 0},
      expectedEditorPolicyMessages: editorPolicyMessages.length, errors, missing, unexpectedConsoleErrors};
  } catch (error) {
    if (page) {try {console.error(JSON.stringify({phase: 'previous-release', engine: name, errors, missing,
      unexpectedConsoleErrors, state: await liveState(page), stored: await project(page)}, null, 2));} catch {}}
    throw error;
  } finally {
    servePrevious = false;
    await context?.close(); await fs.rm(profile, {recursive: true, force: true});
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
    const results = [], previousReleaseResults = [];
    for (const name of engines) {
      results.push(await check(name, origin));
      previousReleaseResults.push(await checkPreviousRelease(name, origin));
    }
    const report = {passed: true, entry: config.entry, routingDisabled: true,
      fixture: {revision: legacyRevision,
        html: {path: legacyHtmlPath, bytes: legacyHtml.length, sha256: digest(legacyHtml)},
        modules: [...fixtures].map(([url, {source, revision, body}]) => ({url, path: source, revision,
          bytes: body.length, sha256: digest(body)}))},
      previousReleaseFixture: {revision: previousRevision,
        html: {path: legacyHtmlPath, bytes: previousHtml.length, sha256: digest(previousHtml)},
        modules: [...previousFixtures].map(([url, {source, revision, body}]) => ({url, path: source, revision,
          bytes: body.length, sha256: digest(body)}))}, currentSources, results, previousReleaseResults};
    await fs.mkdir(path.dirname(config.out), {recursive: true});
    await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
