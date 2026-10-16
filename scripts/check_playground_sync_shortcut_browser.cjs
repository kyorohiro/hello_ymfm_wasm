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
  get preview() { return tfiFileEditor.__testPreviewSynth(); },
  get previewAudio() { return tfiFileEditor.getAudioRuntime(); },
  runtime, parseInstrument: instrumentToEditorPreset,
  refresh: refreshCodeFileActions, revert: revertActiveCodeFile,
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
    if (pathname.endsWith('/playground_tfi_editor.js')) {
      const source = body.toString(), marker = '  return {\n    open(';
      assert(source.includes(marker));
      body = Buffer.from(source.replace(marker, '  return {\n    __testPreviewSynth: () => audio?.fm ?? null,\n    open('));
    }
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

async function binaryState(page, source) {
  return page.evaluate(source => {
    const audit = window.__syncShortcutTest,file = audit.fs.get(source),saved = audit.fs.checkpoints.get(source);
    const preview = audit.preview?.fm ?? audit.preview;
    return {bytes:Array.from(file.data),savedType:saved?.type,
      saved:saved?.type === 'binary' ? Array.from(saved.data) : saved?.data,
      registered:audit.runtime.presets['vfs:' + source],expected:audit.parseInstrument(source,file.data),
      editorLevel:Number(document.querySelectorAll('#tfiFileOperator .param-value[aria-label="TL"]')[3].textContent),
      previewLevel:preview?.getState().channels[0].operators[3].tl};
  },source);
}

async function waitBinarySaved(page, source, bytes, calls) {
  await page.waitForFunction(({source,bytes,calls}) => {
    const audit = window.__syncShortcutTest,saved = audit.fs.checkpoints.get(source);
    return saved?.type === 'binary' && saved.data.length === bytes.length &&
      saved.data.every((value,index) => value === bytes[index]) && audit.calls.length === calls &&
      document.getElementById('status').textContent === `Synced ${source} to /.tet.ss${source}.`;
  },{source,bytes,calls});
  await checkSyncFeedback(page);
}

async function previewLevel(page) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('1'); // Ukulele A4: real activation for WebKit's audio device.
  await page.waitForFunction(() => document.querySelectorAll('#tfiFileKeyboard .key.is-active').length === 1);
  await page.evaluate(() => {
    const audit = window.__syncShortcutTest;
    if (audit.meter) return;
    // The editor's public runtime getter owns the final volume/effects output.
    const audio = audit.previewAudio;
    const mute = audio.audioContext.createGain(); mute.gain.value = 0; mute.connect(audio.audioContext.destination);
    audit.meter = audio.audioContext.createAnalyser(); audit.meter.fftSize = 4096; audit.meter.connect(mute);
    audio.connectOutputMonitor(audit.meter);
  });
  await page.waitForTimeout(200);
  const level = await page.evaluate(() => {
    const meter = window.__syncShortcutTest.meter,data = new Float32Array(meter.fftSize);
    meter.getFloatTimeDomainData(data);
    const mean = data.reduce((sum,value) => sum + value,0) / data.length;
    return Math.sqrt(data.reduce((sum,value) => sum + (value - mean) ** 2,0) / data.length);
  });
  await page.keyboard.up('1');
  return level;
}

async function checkBinaryInstruments(page) {
  await page.evaluate(async () => {
    const audit = window.__syncShortcutTest;
    audit.editor.setValue('// second still being edited\n');
    const [{createTfiFromPreset},{createVgiFromPreset},{FM_PRESETS}] = await Promise.all([
      import('/js/tfi.js'),import('/js/vgi.js'),import('/js/megasynth-fm-presets.js'),
    ]);
    const preset = FM_PRESETS.sine;
    audit.fs.writeBinary('/presets/shortcut.tfi',createTfiFromPreset({...preset,operators:Object.fromEntries(preset.operators.map((operator,i) => [i + 1,operator]))}));
    audit.fs.writeBinary('/presets/shortcut.vgi',createVgiFromPreset({...preset,b4:0xc8}));
  });
  const texts = await page.evaluate(() => {
    const audit = window.__syncShortcutTest;
    return ['/index.js','/.tet.ss/index.js','/shortcut/second.js','/.tet.ss/shortcut/second.js'].map(path => [path,audit.fs.get(path).data]);
  });
  const results = [];
  for (const format of ['tfi','vgi']) {
    const source = '/presets/shortcut.' + format;
    await settleCurrentModel(page);
    await page.evaluate(source => window.__syncShortcutTest.open(source),source);
    await checkSyncFeedback(page,false);
    assert.equal(await page.locator('#syncCodeButton').isEnabled(),true);
    assert.equal(await page.locator('#revertCodeButton').isDisabled(),true);
    const original = await binaryState(page,source);
    assert.equal(original.savedType,undefined,'Playground keeps automatic checkpoints off for binary files too');
    const value = page.locator('#tfiFileOperator .param-value[aria-label="TL"]').nth(3);
    const plus = value.locator('..').locator('.param-button').last();
    await plus.click();
    const first = await binaryState(page,source);
    assert.notDeepEqual(first.bytes,original.bytes); assert.equal(first.savedType,undefined);
    assert.equal(await page.locator('#revertCodeButton').isDisabled(),true,'an unsynced instrument has no Revert target');
    let calls = await page.evaluate(() => window.__syncShortcutTest.calls.length);
    await page.locator('#syncCodeButton').click();
    await waitBinarySaved(page,source,first.bytes,++calls);
    await plus.click(); await checkSyncFeedback(page,false);
    const synced = await binaryState(page,source);
    assert.equal(await page.locator('#revertCodeButton').isEnabled(),true);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+s'); await waitBinarySaved(page,source,synced.bytes,++calls);
    await page.keyboard.press('Meta+s'); await waitBinarySaved(page,source,synced.bytes,++calls);
    await page.locator('#tfiFileKeyboard button').filter({hasText:'Ukulele'}).click();
    const baselineLevel = await previewLevel(page);
    assert(baselineLevel > .001,'the synced instrument must produce actual preview PCM');
    for (let i = 0;i < 12;i++) await plus.click();
    await checkSyncFeedback(page,false);
    const edited = await binaryState(page,source),editedLevel = await previewLevel(page);
    assert.notDeepEqual(edited.bytes,synced.bytes); assert.deepEqual(edited.saved,synced.bytes);
    assert(editedLevel < baselineLevel * .7,'Operator edits must reach the real preview synth');
    await page.locator('#revertCodeButton').click();
    await page.waitForFunction(({source,bytes}) => window.__syncShortcutTest.fs.get(source).data.every((value,i) => value === bytes[i]),{source,bytes:synced.bytes});
    const restored = await binaryState(page,source),restoredLevel = await previewLevel(page);
    assert.deepEqual(restored.bytes,synced.bytes); assert.deepEqual(restored.saved,synced.bytes);
    assert.deepEqual(restored.registered,restored.expected,'Revert refreshes the registered VFS preset');
    assert.equal(restored.editorLevel,synced.editorLevel); assert.equal(restored.previewLevel,synced.editorLevel);
    assert(Math.abs(restoredLevel / baselineLevel - 1) < .03,'Revert restores the actual preview output level');
    assert.equal(await page.locator('#revertCodeButton').isDisabled(),true);
    if (format === 'vgi') {assert.equal(restored.bytes.length,43); assert.equal(restored.bytes[2],0xc8,'VGI reserved pan metadata survives edits and Revert');}
    if (format === 'tfi') {
      // Wrong saved types and malformed bytes must be rejected before the
      // working file, displayed Operator values or preview state are changed.
      for (const bad of ['wrong saved type',[1,2]]) {
        await page.evaluate(({source,bad}) => {
          const audit = window.__syncShortcutTest;
          if (typeof bad === 'string') audit.fs.writeText('/.tet.ss' + source,bad);
          else audit.fs.writeBinary('/.tet.ss' + source,new Uint8Array(bad));
          audit.refresh();
        },{source,bad});
        if (typeof bad === 'string') {
          assert.equal(await page.locator('#revertCodeButton').isDisabled(),true);
          await page.evaluate(() => window.__syncShortcutTest.revert());
        } else {
          assert.equal(await page.locator('#revertCodeButton').isEnabled(),true);
          await page.locator('#revertCodeButton').click();
        }
        await page.waitForFunction(source => document.getElementById('status').textContent.startsWith(`Could not revert ${source}:`),source);
        const unchanged = await binaryState(page,source);
        assert.deepEqual(unchanged.bytes,restored.bytes); assert.equal(unchanged.editorLevel,restored.editorLevel);
        assert.equal(unchanged.previewLevel,restored.previewLevel); assert.deepEqual(unchanged.registered,restored.registered);
        assert.deepEqual(unchanged.saved,bad);
      }
      await page.evaluate(({source,bytes}) => {
        const audit = window.__syncShortcutTest; audit.fs.writeBinary('/.tet.ss' + source,new Uint8Array(bytes)); audit.refresh();
      },{source,bytes:synced.bytes});
    }
    await page.locator('#syncCodeButton').click(); await waitBinarySaved(page,source,synced.bytes,++calls);
    results.push({format,bytes:synced.bytes.length,baselineLevel,editedLevel,restoredLevel});
  }
  await settleCurrentModel(page);
  await page.evaluate(() => window.__syncShortcutTest.open('/shortcut/second.js'));
  await checkSyncFeedback(page,false);
  assert.deepEqual(await page.evaluate(texts => texts.map(([path]) => [path,window.__syncShortcutTest.fs.get(path).data]),texts),texts,
    'binary Sync/Revert must not flush, revert or sync another code file');
  return results;
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

    const binaryResults = await checkBinaryInstruments(page);
    const callsBeforeFailure = await page.evaluate(() => window.__syncShortcutTest.calls.length);

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
    assert.equal(await page.evaluate(() => window.__syncShortcutTest.calls.length), callsBeforeFailure + 1);
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
    return {modelCancellations:modelCancellations.length,binaryResults};
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
        const {modelCancellations:expectedMonacoModelCancellations,binaryResults} = await checkEditor(browser, url);
        await checkFallback(browser, url);
        console.log(JSON.stringify({engine, passed:true, editor:'monaco', fallback:'textarea', ctrlS:true, commandS:true, syncButton:true, syncFeedback:true, revertButton:true, undoRedo:true, onlyActiveFile:true, guards:true, failuresVisible:true, binaryResults, expectedMonacoModelCancellations}));
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => {console.error(error); process.exitCode = 1;});
