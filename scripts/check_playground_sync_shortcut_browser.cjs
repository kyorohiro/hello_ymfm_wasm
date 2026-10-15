// Real Playground editors and Virtual Files. Self-hosts docs on an ephemeral port.
// Run both engines by default, or pass --chromium / --webkit for one engine.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const docs = path.resolve(__dirname, '../docs');
const accessor = `
const syncShortcutCalls = [];
const originalShortcutSync = virtualFiles.sync;
virtualFiles.sync = function (...args) {
  syncShortcutCalls.push(args[0]);
  return originalShortcutSync.apply(this, args);
};
window.__syncShortcutTest = {
  fs: virtualFiles,
  get editor() { return editorAdapter; },
  get path() { return activeVirtualPath; },
  get tfi() { return activeTfiFilePath; },
  codePanel, rawEditor: editor, open: openVirtualFile, tab: setBottomTab,
  calls: syncShortcutCalls,
};`;

const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml'};
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.resolve(docs, '.' + pathname);
    if (!file.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    let body = await fs.readFile(file);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() + accessor);
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch (error) { response.writeHead(404).end(String(error)); }
});

async function waitSaved(page, source, text, calls) {
  await page.waitForFunction(({source, text, calls}) => {
    const audit = window.__syncShortcutTest;
    return audit.fs.get('/.tet.ss' + source)?.data === text && audit.calls.length === calls;
  }, {source, text, calls});
  assert.equal(await page.locator('#status').textContent(), `Synced ${source} to /.tet.ss${source}.`);
}

async function dispatchSave(page, extra = {}) {
  return page.evaluate(extra => {
    const event = new KeyboardEvent('keydown', {key:'s', code:'KeyS', ctrlKey:true, bubbles:true, cancelable:true, ...extra});
    const accepted = document.body.dispatchEvent(event);
    return {accepted, prevented:event.defaultPrevented};
  }, extra);
}

async function checkSyncFeedback(page, success = true) {
  const button = page.locator('#syncCodeButton');
  if (success) {
    assert.equal(await button.getAttribute('data-feedback'), 'success');
    assert.equal((await button.textContent()).trim(), '✓ Synced');
  } else {
    assert.notEqual(await button.getAttribute('data-feedback'), 'success');
    assert.equal((await button.textContent()).trim(), 'Sync');
  }
}

async function syncControlBounds(page) {
  return page.evaluate(() => {
    const button = document.getElementById('syncCodeButton').getBoundingClientRect();
    const panel = document.querySelector('.dock-toggle').getBoundingClientRect();
    return {width:button.width, panelLeft:panel.left};
  });
}

async function settleCurrentModel(page) {
  await page.evaluate(async () => {
    const model = monaco.editor.getEditors().find(editor => editor.getModel()?.uri.path.startsWith('/project/'))?.getModel();
    const factory = await monaco.languages.typescript.getJavaScriptWorker();
    const worker = await factory(model.uri);
    await worker.getSyntacticDiagnostics(model.uri.toString());
  });
}

async function checkCodeButtons(page) {
  const syncButton = page.locator('#syncCodeButton'), revertButton = page.locator('#revertCodeButton');
  await page.evaluate(() => {
    const audit = window.__syncShortcutTest;
    audit.fs.remove('/.tet.ss/index.js', {recursive:true});
    audit.editor.setValue('// baseline from Sync button\n');
    audit.fs.writeText('/index.js', '// stale VFS before Sync button\n');
  });
  assert.equal(await syncButton.isEnabled(), true);
  assert.equal(await revertButton.isDisabled(), true);
  await checkSyncFeedback(page, false);
  const beforeFeedback = await syncControlBounds(page);
  const calls = await page.evaluate(() => window.__syncShortcutTest.calls.length);
  let expectedCalls = calls + 1;
  const otherBefore = await page.evaluate(() => window.__syncShortcutTest.fs.get('/shortcut/second.js').data);
  await syncButton.click();
  await waitSaved(page, '/index.js', '// baseline from Sync button\n', expectedCalls);
  await checkSyncFeedback(page);
  const duringFeedback = await syncControlBounds(page);
  assert(Math.abs(beforeFeedback.width - duringFeedback.width) < .75, 'Sync feedback changes the button width');
  assert(Math.abs(beforeFeedback.panelLeft - duringFeedback.panelLeft) < .75, 'Sync feedback shifts Panel');
  await page.evaluate(() => { window.__syncFeedbackFocusTarget = document.activeElement; });
  await page.waitForFunction(() => document.getElementById('syncCodeButton').dataset.feedback !== 'success');
  await checkSyncFeedback(page, false);
  assert.equal(await page.evaluate(() => document.activeElement === window.__syncFeedbackFocusTarget), true);
  const afterFeedback = await syncControlBounds(page);
  assert(Math.abs(beforeFeedback.width - afterFeedback.width) < .75);
  assert(Math.abs(beforeFeedback.panelLeft - afterFeedback.panelLeft) < .75);
  await syncButton.click(); // No content changed; the feedback must still appear.
  await waitSaved(page, '/index.js', '// baseline from Sync button\n', ++expectedCalls);
  await checkSyncFeedback(page);
  assert.equal(await syncButton.isEnabled(), true);
  assert.equal(await revertButton.isDisabled(), true);

  await page.evaluate(() => window.__syncShortcutTest.editor.setValue('// edit to undo after Revert\n'));
  await checkSyncFeedback(page, false);
  assert.equal(await revertButton.isEnabled(), true);
  await revertButton.click();
  await page.waitForFunction(() => window.__syncShortcutTest.editor.getValue() === '// baseline from Sync button\n');
  assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.get('/index.js').data), '// baseline from Sync button\n');
  assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.get('/.tet.ss/index.js').data), '// baseline from Sync button\n');
  assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.get('/shortcut/second.js').data), otherBefore);
  assert.equal(await page.evaluate(() => window.__syncShortcutTest.calls.length), expectedCalls);
  assert.equal(await revertButton.isDisabled(), true);

  await page.evaluate(() => window.__syncShortcutTest.editor.focus());
  const modifier = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control');
  await page.keyboard.press(modifier + '+z');
  await page.waitForFunction(() => window.__syncShortcutTest.editor.getValue() === '// edit to undo after Revert\n');
  assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.get('/index.js').data), '// edit to undo after Revert\n');
  assert.equal(await revertButton.isEnabled(), true);
  await page.keyboard.press(modifier + '+Shift+z');
  await page.waitForFunction(() => window.__syncShortcutTest.editor.getValue() === '// baseline from Sync button\n');
  assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.get('/.tet.ss/index.js').data), '// baseline from Sync button\n');
  assert.equal(await page.evaluate(() => window.__syncShortcutTest.calls.length), expectedCalls);

  for (const source of ['/sys/button-guard.js', '/.git/button-guard.js']) {
    await settleCurrentModel(page);
    await page.evaluate(source => {
      const audit = window.__syncShortcutTest;
      audit.fs.writeText(source, '// internal file\n');
      audit.open(source);
    }, source);
    assert.equal(await syncButton.isDisabled(), true);
    assert.equal(await revertButton.isDisabled(), true);
  }
  await settleCurrentModel(page);
  await page.evaluate(() => window.__syncShortcutTest.open('/index.js'));
  for (const width of [1280, 390]) {
    await page.setViewportSize({width, height:900});
    const bounds = await page.evaluate(() => {
      const rect = selector => {
        const {left, right, width} = document.querySelector(selector).getBoundingClientRect();
        return {left, right, width};
      };
      return {sync:rect('#syncCodeButton'), revert:rect('#revertCodeButton'), panel:rect('.dock-toggle')};
    });
    assert(bounds.sync.width > 0 && bounds.revert.width > 0);
    assert(bounds.sync.right <= bounds.revert.left + 1, `Sync/Revert overlap at ${width}px`);
    assert(bounds.revert.right <= bounds.panel.left + 1, `File controls overlap Panel at ${width}px`);
  }
  await page.setViewportSize({width:1280, height:900});
}

async function checkEditor(browser, url) {
  const page = await browser.newPage({serviceWorkers:'block'}), errors = [];
  page.on('pageerror', error => errors.push({message:error.message, stack:error.stack}));
  try {
    await page.addInitScript(() => {
      window.__syncShortcutRejections = [];
      window.addEventListener('unhandledrejection', event => {
        window.__syncShortcutRejections.push({message:event.reason?.message, stack:event.reason?.stack ?? ''});
      });
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__syncShortcutTest && window.monaco?.editor?.getEditors().some(editor => editor.getModel()?.uri.path === '/project/index.js'));
    await page.evaluate(() => {
      const audit = window.__syncShortcutTest;
      audit.editor.setValue('// latest editor text\n');
      audit.fs.writeText('/index.js', '// deliberately stale virtual text\n');
      audit.editor.focus();
    });
    await page.keyboard.press('Control+s');
    await waitSaved(page, '/index.js', '// latest editor text\n', 1);
    await checkSyncFeedback(page);
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.get('/index.js').data), '// latest editor text\n');

    await page.evaluate(() => window.__syncShortcutTest.editor.setValue('// next unsynced edit\n'));
    await checkSyncFeedback(page, false);
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.get('/.tet.ss/index.js').data), '// latest editor text\n');
    await page.keyboard.press('Meta+s');
    await waitSaved(page, '/index.js', '// next unsynced edit\n', 2);
    await checkSyncFeedback(page);
    await settleCurrentModel(page);

    await page.evaluate(() => {
      const audit = window.__syncShortcutTest;
      audit.fs.writeText('/shortcut/second.js', '// second original\n');
      audit.open('/shortcut/second.js');
      audit.editor.setValue('// second latest\n');
      audit.editor.focus();
    });
    await checkSyncFeedback(page, false);
    await page.keyboard.press('Control+s');
    await waitSaved(page, '/shortcut/second.js', '// second latest\n', 3);
    await checkSyncFeedback(page);
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.get('/.tet.ss/index.js').data), '// next unsynced edit\n');

    assert.deepEqual(await dispatchSave(page), {accepted:false, prevented:true});
    await page.waitForFunction(() => window.__syncShortcutTest.calls.length === 4);
    assert.deepEqual(await dispatchSave(page, {repeat:true}), {accepted:false, prevented:true});
    for (const extra of [{shiftKey:true}, {altKey:true}, {isComposing:true}]) {
      assert.deepEqual(await dispatchSave(page, extra), {accepted:true, prevented:false});
    }
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.calls.length), 4);
    await settleCurrentModel(page);

    await page.evaluate(async () => {
      const audit = window.__syncShortcutTest;
      audit.editor.setValue('// second still being edited\n');
      const {createVgiFromPreset} = await import('/js/vgi.js');
      audit.fs.writeBinary('/presets/shortcut.vgi', createVgiFromPreset({algorithm:7}));
      audit.open('/presets/shortcut.vgi');
      document.activeElement?.blur();
    });
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.tfi), '/presets/shortcut.vgi');
    assert.equal(await page.locator('#syncCodeButton').isDisabled(), true);
    assert.equal(await page.locator('#revertCodeButton').isDisabled(), true);
    assert.deepEqual(await dispatchSave(page), {accepted:false, prevented:true});
    assert.equal(await page.locator('#status').textContent(), 'Open a code file to sync.');
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.calls.length), 4);
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.get('/.tet.ss/shortcut/second.js').data), '// second latest\n');
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.has('/.tet.ss/presets/shortcut.vgi')), false);

    await settleCurrentModel(page);
    await page.evaluate(() => {
      const audit = window.__syncShortcutTest;
      audit.open('/index.js');
      audit.fs.remove('/.tet.ss/index.js');
      audit.fs.writeText('/.tet.ss/index.js/blocker', 'must survive sync failure');
      audit.editor.setValue('// editor content survives failure\n');
      audit.editor.focus();
    });
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Could not sync /index.js:'));
    await checkSyncFeedback(page, false);
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.calls.length), 5);
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.get('/index.js').data), '// editor content survives failure\n');
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.get('/.tet.ss/index.js/blocker').data), 'must survive sync failure');
    await checkCodeButtons(page);
    // Monaco 0.52.2 can reject an in-flight model task when its view changes.
    // Keep these identified editor cancellations visible and fail every other error.
    const rejections = await page.evaluate(() => window.__syncShortcutRejections);
    const modelTrace = stack => stack.includes('/monaco-editor/0.52.2/min/vs/editor/editor.main.js') &&
      stack.includes('setModel') && stack.includes('dispose');
    const modelCancellations = errors.filter(error => ['Canceled', 'Canceled: Canceled'].includes(error.message) &&
      (modelTrace(error.stack) || rejections.some(reason => reason.message === 'Canceled' && modelTrace(reason.stack))));
    assert.deepEqual(errors.filter(error => !modelCancellations.includes(error)), [], JSON.stringify({rejections}));
    return modelCancellations.length;
  } finally { await page.close(); }
}

async function checkFallback(browser, url) {
  const page = await browser.newPage({serviceWorkers:'block'}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/monaco-editor/**', route => route.abort());
    await page.goto(url);
    await page.waitForFunction(() => window.__syncShortcutTest && !document.getElementById('editor').readOnly);
    assert.equal(await page.locator('#syncCodeButton').isEnabled(), true);
    assert.equal(await page.locator('#revertCodeButton').isDisabled(), true);
    await page.locator('#editor').fill('// textarea current\n');
    await page.keyboard.press('Control+s');
    await waitSaved(page, '/index.js', '// textarea current\n', 1);
    await checkSyncFeedback(page);
    await page.evaluate(() => { window.__syncShortcutTest.rawEditor.value = '// latest textarea buffer without input event\n'; });
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.get('/.tet.ss/index.js').data), '// textarea current\n');
    await page.keyboard.press('Meta+s');
    await waitSaved(page, '/index.js', '// latest textarea buffer without input event\n', 2);
    await checkSyncFeedback(page);
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.get('/index.js').data), '// latest textarea buffer without input event\n');
    await page.locator('#editor').fill('// textarea changes to revert\n');
    await checkSyncFeedback(page, false);
    assert.equal(await page.locator('#revertCodeButton').isEnabled(), true);
    await page.locator('#revertCodeButton').click();
    assert.equal(await page.locator('#editor').inputValue(), '// latest textarea buffer without input event\n');
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.fs.get('/index.js').data), '// latest textarea buffer without input event\n');
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.calls.length), 2);
    assert.equal(await page.locator('#revertCodeButton').isDisabled(), true);
    await page.evaluate(() => { window.__syncShortcutTest.rawEditor.value = '// textarea Sync button latest buffer\n'; });
    await page.locator('#syncCodeButton').click();
    await waitSaved(page, '/index.js', '// textarea Sync button latest buffer\n', 3);
    await checkSyncFeedback(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

(async () => {
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  try {
    const url = `http://127.0.0.1:${server.address().port}/playground/index.html`;
    const engines = process.argv.includes('--webkit') ? [['webkit', webkit]] : process.argv.includes('--chromium') ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];
    for (const [engine, type] of engines) {
      const browser = await type.launch({headless:true});
      try {
        const expectedMonacoModelCancellations = await checkEditor(browser, url);
        await checkFallback(browser, url);
        console.log(JSON.stringify({engine, passed:true, editor:'monaco', fallback:'textarea', ctrlS:true, commandS:true, syncButton:true, syncFeedback:true, revertButton:true, undoRedo:true, onlyActiveFile:true, guards:true, failuresVisible:true, expectedMonacoModelCancellations}));
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => {console.error(error); process.exitCode = 1;});
