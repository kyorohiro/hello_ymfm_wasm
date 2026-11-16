// SPDX-License-Identifier: BSD-3-Clause
// A real warm HTTP-cache regression for the YM2149 page's logger dependency.
// Do not add Playwright routing: route() disables the cache being tested.
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
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'log-table-cache-browser.json')};
for (const argument of process.argv.slice(2)) {
  const match = /^--(root|entry|engines|out)=(.+)$/.exec(argument);
  assert(match, `Unknown argument ${argument}`);
  config[match[1]] = match[2];
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry), 'entry is an absolute page path');
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));

const legacyRevision = '6663c6d5';
const legacySource = 'docs/js/playground_log.js';
// Preserve the actual previously shipped response, including its original bytes.
const legacyLog = execFileSync('git', ['show', `${legacyRevision}:${legacySource}`], {cwd: repository});
assert(legacyLog.includes('export function formatLogArgs('));
assert(!legacyLog.includes('formatLogTable'), 'the old logger lacks the newly required export');
const digest = body => createHash('sha256').update(body).digest('hex');
const bareLogger = '/js/playground_log.js';
const currentLogger = bareLogger + '?v=console-table-1';
const negativeImporter = '/js/playground_code_runtime.js?log-table-cache-negative=1';
const warmPage = '/log-table-cache-warm.html';
const served = new Map();
let serveLegacyBare = false;
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ts': 'text/plain'};
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const resource = url.pathname + url.search;
    served.set(resource, (served.get(resource) ?? 0) + 1);
    if (url.pathname === warmPage) {
      response.writeHead(200, {'Content-Type': 'text/html', 'Cache-Control': 'no-store'});
      response.end('<!doctype html><title>Logger HTTP cache regression</title>');
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filename = path.resolve(config.root, '.' + pathname);
    assert(filename.startsWith(config.root + path.sep), 'path remains inside the served root');
    let body = await fs.readFile(filename);
    if (resource === bareLogger && serveLegacyBare) {
      body = legacyLog;
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      response.setHeader('Cache-Control', 'no-cache');
    }
    if (resource === negativeImporter) {
      const source = body.toString();
      assert(source.includes("from './playground_log.js?v=console-table-1'"),
        'negative control changes only the current logger import identity');
      body = source.replace("from './playground_log.js?v=console-table-1'", "from './playground_log.js'");
      response.setHeader('Cache-Control', 'no-store');
    }
    if (path.extname(filename) === '.html') {
      // Keep the optional CDN editor out of this local dependency check without
      // request interception. The app retains its supported textarea fallback.
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
  const audit = window.__logTableCacheAudit = {contexts: [], routes: []};
  window.AudioContext = class extends Context {
    constructor(...args) {super(...args); audit.contexts.push(this);}
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...args);
    const mute = this.context.createGain();
    mute.gain.value = 0;
    // Only this audit owns the mute; application output cannot raise its gain.
    connect.call(this, mute, ...args);
    connect.call(mute, destination);
    audit.routes.push(mute);
    return destination;
  };
}

async function sentinels(page, write = false) {
  return page.evaluate(async write => {
    const localKey = 'log-table-cache-sentinel';
    if (write) localStorage.setItem(localKey, 'Keep my console-table preferences.');
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('log-table-cache-regression', 1);
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

async function check(name, origin) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'log-table-cache-'));
  let context, page;
  const errors = [], missing = [], editorPolicyMessages = [], unexpectedConsoleErrors = [];
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

    serveLegacyBare = true;
    await page.goto(origin + warmPage);
    const beforeBare = served.get(bareLogger) ?? 0;
    const exports = await page.evaluate(async url => Object.keys(await import(url)).sort(), bareLogger);
    assert.deepEqual(exports, ['formatLogArgs', 'serializeLogError']);
    const warmBare = served.get(bareLogger) ?? 0;
    assert.equal(warmBare - beforeBare, 1, 'old logger is served once into the real HTTP cache');
    const storage = await sentinels(page, true);
    // The origin now has the current bare response, just as after deployment.
    // A cached client must still retain its old immutable response.
    serveLegacyBare = false;

    // A new document has a fresh module map, so this is an HTTP-cache hit,
    // rather than reuse of the old document's already evaluated module.
    await page.goto(origin + warmPage + '?negative=1');
    const negative = await page.evaluate(async url => {
      try {await import(url); return {unexpectedSuccess: true};}
      catch (error) {return {name: error.name, message: error.message};}
    }, negativeImporter);
    assert.equal(negative.name, 'SyntaxError', JSON.stringify(negative));
    assert.match(negative.message, /formatLogTable/, 'the old dependency reproduces the reported missing export');
    assert.equal(served.get(bareLogger), warmBare, 'negative control reads the legacy logger from HTTP cache');
    assert.deepEqual(await sentinels(page), storage);

    const beforeCurrent = served.get(currentLogger) ?? 0;
    await page.goto(origin + config.entry);
    await page.waitForFunction(() => Boolean(window.tetoricaYm2149StSynth) &&
      !document.getElementById('ymFileNewButton')?.disabled);
    const cold = await page.evaluate(() => ({audioContexts: __logTableCacheAudit.contexts.length,
      codeState: tetoricaYm2149StSynth.getCodeState(),
      resources: performance.getEntriesByType('resource').map(entry => {
        const url = new URL(entry.name); return url.pathname + url.search;
      })}));
    assert.equal(cold.audioContexts, 0, 'the recovered page becomes ready before audio is enabled');
    assert.equal(cold.codeState.running, false, 'startup never runs code');
    assert(cold.resources.includes(currentLogger), 'the current page requests the versioned leaf module');
    // playground_live still needs only formatLogArgs and may safely share the
    // old bare response. Consumers of formatLogTable need the fresh identity.
    assert.equal(served.get(bareLogger), warmBare, 'compatible bare imports retain the cached legacy response');
    assert.equal((served.get(currentLogger) ?? 0) - beforeCurrent, 1, 'the fresh leaf is fetched once');
    assert.deepEqual(await sentinels(page), storage, 'startup preserves browser storage');

    await page.locator('#synthInputCodeTab').click();
    await page.waitForFunction(() => !document.getElementById('synthCodeEditor').readOnly);
    await page.locator('#synthCodeEditor').fill(
      'console.table([{register: 13, value: 8, label: "LOG_TABLE_WARM_CACHE"}], ["register", "value", "label"]);\n' +
      'console.log("LOG_TABLE_CACHE_COMPLETE");\n');
    await page.locator('#synthCodeRunButton').click();
    await page.waitForFunction(() => document.getElementById('synthCodeLog').textContent.includes('LOG_TABLE_CACHE_COMPLETE'));
    const table = await page.locator('#synthCodeLog').textContent();
    assert.match(table, /\(index\)\s+\| register\s+\| value\s+\| label/);
    assert.match(table, /0\s+\| 13\s+\| 8\s+\| LOG_TABLE_WARM_CACHE/);
    assert.equal(await page.locator('#synthCodeError').textContent(), '');
    if (await page.locator('#synthCodeStopButton').isEnabled()) await page.locator('#synthCodeStopButton').click();
    await page.waitForFunction(() => !tetoricaYm2149StSynth.getCodeState().running &&
      !tetoricaYm2149StSynth.getCodeState().busy && !tetoricaYm2149StSynth.getCodeState().stopping);
    const audio = await page.evaluate(() => ({contexts: __logTableCacheAudit.contexts.length,
      physicalRoutes: __logTableCacheAudit.routes.length,
      allPhysicalOutputsMuted: __logTableCacheAudit.routes.every(node => node.gain.value === 0)}));
    assert.equal(audio.contexts, 1);
    assert(audio.physicalRoutes > 0 && audio.allPhysicalOutputsMuted, 'every physical route remains muted');
    assert.deepEqual(await sentinels(page), storage, 'running console.table preserves browser storage');

    await page.goto(origin + warmPage + '?after=1');
    const remainingExports = await page.evaluate(async url => Object.keys(await import(url)).sort(), bareLogger);
    assert.deepEqual(remainingExports, exports, 'the stale bare response remains intact after recovery');
    assert.equal(served.get(bareLogger), warmBare, 'no refetch or cache clearing of the stale response');
    assert.deepEqual(await sentinels(page), storage);
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    assert.deepEqual(missing, [], 'no missing local resources');
    assert.deepEqual(unexpectedConsoleErrors, [], 'no unexpected console errors');
    return {engine: name, passed: true, persistentHttpCache: true,
      negativeControl: {...negative, freshDocument: true, legacyLoggerNetworkRequests: warmBare - beforeBare},
      recovery: {entry: config.entry, readyBeforeAudio: true, logger: currentLogger,
        loggerNetworkRequests: (served.get(currentLogger) ?? 0) - beforeCurrent,
        staleBareLoggerStillCached: true, consoleTable: true, table},
      storagePreserved: storage, audio, editor: 'Local textarea fallback; CDN scripts denied by server CSP',
      expectedEditorPolicyMessages: editorPolicyMessages.length, errors, missing, unexpectedConsoleErrors};
  } catch (error) {
    if (page) {
      try {console.error(JSON.stringify({engine: name, errors, missing, unexpectedConsoleErrors,
        state: await page.evaluate(() => ({status: document.getElementById('audioStatus')?.textContent,
          error: document.getElementById('synthCodeError')?.textContent,
          log: document.getElementById('synthCodeLog')?.textContent}))}, null, 2));} catch {}
    }
    throw error;
  } finally {
    await context?.close();
    await fs.rm(profile, {recursive: true, force: true});
  }
}

(async () => {
  const currentLog = await fs.readFile(path.join(config.root, bareLogger));
  assert(currentLog.includes('export function formatLogTable('), 'the current served logger has the required export');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const results = [];
    for (const name of engines) results.push(await check(name, origin));
    const report = {passed: true, entry: config.entry, routingDisabled: true,
      fixture: {revision: legacyRevision, path: legacySource, bytes: legacyLog.length, sha256: digest(legacyLog)},
      currentLogger: {url: currentLogger, bytes: currentLog.length, sha256: digest(currentLog)}, results};
    await fs.mkdir(path.dirname(config.out), {recursive: true});
    await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
