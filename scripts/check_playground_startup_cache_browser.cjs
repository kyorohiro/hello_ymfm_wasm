// Exercise upgrades against a real warm HTTP cache. Playwright request routing
// deliberately stays disabled: routing would turn off the cache under test.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {chromium, webkit} = require('playwright');

const docs = path.resolve(__dirname, '../docs');
const legacyUrls = [
  '/playground/playground_operator_tab.js',
  '/js/playground_runtime.js',
  '/js/playground_runtime.js?v=worker-lookahead-1',
  '/js/soundchip_mixer.js',
];
const legacyPaths = new Set(legacyUrls.map(url => url.split('?')[0]));
const served = new Map();
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml'};

function obsoleteModule(body, pathname) {
  let source = body.toString();
  if (pathname.endsWith('/playground_operator_tab.js')) {
    assert(source.includes('    setVisible: envelopeView.setVisible,'), 'operator cache fixture matches the current factory');
    source = source.replace('    setVisible: envelopeView.setVisible,', '');
  } else if (pathname.endsWith('/playground_runtime.js')) {
    assert(source.includes('    chipInspector,\n'), 'runtime cache fixture matches the current factory');
    source = source.replace('    chipInspector,\n', '');
  } else if (pathname.endsWith('/soundchip_mixer.js')) {
    source += '\nSoundChipMixer.prototype.subscribeMeters = undefined;\n';
  }
  return source + '\nexport const __startupCacheLegacy = true;\n';
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const resource = url.pathname + url.search;
    served.set(resource, (served.get(resource) ?? 0) + 1);
    if (url.pathname === '/cache-warm.html') {
      response.setHeader('Content-Type', 'text/html');
      response.setHeader('Cache-Control', 'no-store');
      response.end('<!doctype html><title>Warm legacy Playground modules</title>');
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    let filename = path.resolve(docs, '.' + pathname);
    if (!filename.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
    let body = await fs.readFile(filename);
    if (legacyUrls.includes(resource)) {
      body = obsoleteModule(body, pathname);
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      response.setHeader('Cache-Control', 'no-cache');
    }
    if (pathname === '/playground/index.html' && url.searchParams.has('startup-cache-negative')) {
      body = body.toString().replace(/import\((['"])(\.\/playground\.js\?[^'"]+)\1\)/,
        (_match, quote, module) => `import(${quote}${module}&startup-cache-negative=1${quote})`);
    }
    if (pathname === '/playground/playground.js') {
      if (url.searchParams.has('startup-cache-negative')) {
        body = body.toString().replace(/(['"])\.\/playground_operator_tab\.js(?:\?[^'"]*)?\1/,
          '"./playground_operator_tab.js"');
      }
      body = body.toString() + '\nwindow.__startupCacheApp={runtime,megaDrive,virtualFiles,get editor(){return editorAdapter;}};\n';
    }
    response.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
    response.end(body);
  } catch (error) {
    console.error('SERVE', request.url, error.message);
    response.writeHead(404).end(error.message);
  }
});

async function check(engine, browserName, origin) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'playground-startup-cache-'));
  try {
    const context = await engine.launchPersistentContext(profile, {headless: true,
      serviceWorkers: 'block', viewport: {width: 1280, height: 900}});
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      // Tauri's autosave is exercised without native audio or desktop helpers.
      await page.addInitScript(() => {window.__TAURI_INTERNALS__ = {invoke: async () => null};});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error' && message.text().includes('Playground startup failed:')) errors.push(message.text());
      });
      await page.goto(origin + '/cache-warm.html');
      const oldCounts = new Map(legacyUrls.map(url => [url, served.get(url) ?? 0]));
      const warmed = await page.evaluate(async urls => {
        const modules = [];
        for (const url of urls) modules.push((await import(url)).__startupCacheLegacy);
        const {openDraftStore} = await import('/playground/playground_autosave.js');
        const store = await openDraftStore(indexedDB, 'ym2612');
        await store.save({version: 1, activePath: '/index.js', runPath: '/index.js',
          directories: ['/cache-upgrade', '/cache-upgrade/empty'], files: [
            {path: '/index.js', type: 'text', data: '// User code survives the dependency upgrade.\n'},
            {path: '/cache-upgrade/keep.txt', type: 'text', data: 'Keep my cassette files.'},
            {path: '/cache-upgrade/keep.bin', type: 'binary', data: new Uint8Array([0, 17, 128, 255])},
          ]});
        store.close();
        localStorage.setItem('startup-cache-sentinel', 'Keep my preferences.');
        localStorage.setItem('tetorica.playground.workerLookaheadMs', '85');
        return modules;
      }, legacyUrls);
      assert(warmed.every(Boolean), 'all obsolete modules are in the real browser HTTP cache');
      const warmCounts = new Map(legacyUrls.map(url => [url, served.get(url) ?? 0]));
      for (const url of legacyUrls) assert.equal(warmCounts.get(url) - oldCounts.get(url), 1, 'legacy module served once: ' + url);

      // Negative control: reverting only the operator import reproduces the
      // exact user report. The fixture must actually detect stale APIs.
      await page.goto(origin + '/playground/index.html?no-sw=1&startup-cache-negative=1');
      await page.waitForFunction(() => document.getElementById('status')?.textContent === 'Startup failed.');
      assert(errors.some(message => message.includes('operatorTab.setVisible is not a function')),
        'legacy operator reproduces the reported failure: ' + JSON.stringify(errors));
      errors.length = 0;

      // Same origin and browser context: do not clear cookies, storage, cache,
      // or the persisted project as an upgrade workaround.
      await page.goto(origin + '/playground/index.html?no-sw=1');
      try {
        await page.waitForFunction(() => window.__startupCacheApp?.editor?.kind === 'monaco' && document.getElementById('startupNotice').hidden);
      } catch (error) {
        const state = await page.evaluate(() => ({status: document.getElementById('status')?.textContent,
          startup: document.getElementById('startupMessage')?.textContent}));
        throw Error(error.message + '\nWarm-cache startup state: ' + JSON.stringify({state, errors}));
      }
      const restored = await page.evaluate(() => {
        const app = window.__startupCacheApp;
        return {code: app.editor.getValue(), text: app.virtualFiles.get('/cache-upgrade/keep.txt')?.data,
          binary: Array.from(app.virtualFiles.get('/cache-upgrade/keep.bin')?.data ?? []),
          directories: app.virtualFiles.listDirectories(), sentinel: localStorage.getItem('startup-cache-sentinel'),
          lookahead: app.runtime.getTiming().workerLookaheadSeconds,
          inspector: typeof app.runtime.chipInspector?.read,
          mixerMeters: typeof app.megaDrive.mixer?.subscribeMeters,
          resources: performance.getEntriesByType('resource').map(entry => new URL(entry.name)).map(url => url.pathname + url.search)};
      });
      assert.equal(restored.code, '// User code survives the dependency upgrade.\n');
      assert.equal(restored.text, 'Keep my cassette files.');
      assert.deepEqual(restored.binary, [0, 17, 128, 255]);
      assert(restored.directories.includes('/cache-upgrade/empty'), 'empty virtual directories survive');
      assert.equal(restored.sentinel, 'Keep my preferences.');
      assert.equal(restored.lookahead, .085, 'existing application preferences survive');
      assert.equal(restored.inspector, 'function');
      assert.equal(restored.mixerMeters, 'function');
      for (const pathname of legacyPaths) {
        const imported = restored.resources.filter(url => url.split('?')[0] === pathname);
        assert(imported.length > 0, 'upgraded app requests the module: ' + pathname);
        assert(imported.every(url => !legacyUrls.includes(url)), 'upgraded dependency has a fresh identity: ' + imported.join(', '));
      }
      for (const [tab, panel] of [['operatorTabButton', 'operatorPanel'], ['segapsgTab', 'segapsgPanel'],
        ['rf5c164Tab', 'rf5c164Panel'], ['pwmTab', 'pwmPanel'], ['mixerTab', 'mixerPanel']]) {
        await page.click('#' + tab);
        assert(await page.locator('#' + panel).isVisible(), 'the upgraded tab opens: ' + tab);
      }
      await page.evaluate(() => window.__tetoricaAutosaveFlush());
      assert.deepEqual(errors, [], 'no startup or tab errors with a warm legacy cache');

      // A fresh document must still obtain the obsolete modules from cache,
      // proving success came from new dependency URLs, not a cache reset.
      await page.goto(origin + '/cache-warm.html');
      const stillCached = await page.evaluate(async urls => {
        const result = [];
        for (const url of urls) result.push((await import(url)).__startupCacheLegacy);
        const {openDraftStore} = await import('/playground/playground_autosave.js');
        const store = await openDraftStore(indexedDB, 'ym2612');
        const snapshot = await store.load(); store.close();
        return {modules: result, text: snapshot.files.find(file => file.path === '/cache-upgrade/keep.txt')?.data,
          sentinel: localStorage.getItem('startup-cache-sentinel')};
      }, legacyUrls);
      assert(stillCached.modules.every(Boolean), 'old cached module responses remain intact');
      for (const url of legacyUrls) assert.equal(served.get(url), warmCounts.get(url), 'no refetch or cache clearing for: ' + url);
      assert.equal(stillCached.text, 'Keep my cassette files.');
      assert.equal(stillCached.sentinel, 'Keep my preferences.');
      console.log(JSON.stringify({passed: true, browser: browserName, warmHttpCache: true,
        reproducedOriginalError: true, obsoleteModules: legacyUrls, tabs: true,
        persistedTextAndBinaryFiles: true, preferencesPreserved: true}));
    } finally {await context.close();}
  } finally {await fs.rm(profile, {recursive: true, force: true});}
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const engines = process.argv.includes('--chromium') ? [[chromium, 'chromium']] :
      process.argv.includes('--webkit') ? [[webkit, 'webkit']] : [[chromium, 'chromium'], [webkit, 'webkit']];
    for (const [engine, name] of engines) await check(engine, name, origin);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
