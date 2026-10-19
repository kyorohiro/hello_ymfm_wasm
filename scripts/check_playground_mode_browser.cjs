// Real OPN environments, Main/Worker playback, Monaco types and project transfer.
// Self-hosts docs. Chromium is required; pass --webkit to include WebKit.
// --project-only exercises transfer/autosave/legacy URLs without repeating audio.
// --tabs-only checks mode-specific chip tabs without audio/transfer suites.
// --types-only checks the actual Monaco completions, diagnostics and FM hovers.
// --opna-only checks mode-specific section types and primary OPNA section audio.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const docs = path.resolve(__dirname, '../docs');
const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.wasm':'application/wasm', '.json':'application/json', '.svg':'image/svg+xml'};
const accessor = '\nwindow.__modeRegression={runtime,megaDrive,selectedMode,virtualFiles,getEditorValue,setEditorValue:value=>editorAdapter.setValue(value)};';
const modes = [
  {id:'genesis', label:'Genesis', chip:'ym2612', clock:7670454, channels:6},
  {id:'genesis-full', label:'Genesis Full', chip:'ym2612', clock:7670454, channels:6, full:true},
  {id:'genesis-full-nuked', label:'Genesis Full (Nuked)', chip:'ym2612', clock:7670454, channels:6, full:true, nuked:true},
  {id:'pc98-26', label:'PC-98 (YM2203 / OPN)', chip:'ym2203', clock:4000000, channels:3},
  {id:'pc98', label:'PC-98 (YM2608 / OPNA)', chip:'ym2608', clock:8000000, channels:6},
  {id:'neogeo', label:'Neo Geo', chip:'ym2610', clock:8000000, channels:4},
];
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
  } catch (error) {response.writeHead(404).end(error.message);}
});

async function ready(page) {
  await page.waitForFunction(() => window.__modeRegression && window.monaco?.editor?.getEditors().length);
  await page.locator('#startupNotice').waitFor({state:'hidden'});
  // The editor appears before its lazy TypeScript worker has loaded. Await a
  // real worker request so a subsequent navigation cannot cancel CDN imports
  // and surface WebKit's worker-load errors in the outgoing page.
  await page.evaluate(async () => {
    const model = monaco.editor.getEditors()[0].getModel();
    const getWorker = await monaco.languages.typescript.getJavaScriptWorker();
    const worker = await getWorker(model.uri);
    await worker.getSemanticDiagnostics(model.uri.toString());
  });
}

async function checkTypes(page, mode) {
  const types = await page.evaluate(async mode => {
    const models = monaco.editor.getModels().filter(model => model.uri.path.endsWith('.d.ts'));
    const selected = models.find(model => model.uri.path.endsWith(`/tetorica-playground-${mode.chip}.d.ts`));
    const valid = `fm.setPreset(${mode.channels - 1}, FM_PRESETS['one-op-basic']);\n`;
    const source = valid + `fm.setPreset(${mode.channels}, FM_PRESETS['one-op-basic']);\nfm;\npg.fm;\nfm.`;
    const model = monaco.editor.createModel(source, 'javascript', monaco.Uri.parse('file:///mode-type-regression.js'));
    try {
      const getWorker = await monaco.languages.typescript.getJavaScriptWorker();
      const worker = await getWorker(model.uri), uri = model.uri.toString();
      const diagnostics = await worker.getSemanticDiagnostics(uri);
      const completion = await worker.getCompletionsAtPosition(uri, source.length);
      const fmHover = await worker.getQuickInfoAtPosition(uri, source.indexOf('fm;') + 1);
      const pgFmHover = await worker.getQuickInfoAtPosition(uri, source.indexOf('pg.fm;') + 4);
      const completions = async (name, source, position = source.length) => {
        const probe = monaco.editor.createModel(source, 'javascript', monaco.Uri.parse(`file:///mode-${name}-completion.js`));
        try {
          const service = await getWorker(probe.uri);
          return (await service.getCompletionsAtPosition(probe.uri.toString(), position))?.entries.map(entry => entry.name) || [];
        } finally {probe.dispose();}
      };
      const prepareSource = "livePrepare('opna-types', api => { api. });";
      const sections = {globals:await completions('globals', ';\n'), pg:await completions('pg', 'pg.'),
        prepare:await completions('prepare', prepareSource, prepareSource.indexOf('api.') + 4)};
      if (mode.chip === 'ym2608') {
        for (const section of ['ssg','rhythm','adpcm']) sections[section] = await completions(section, `${section}.`);
      }
      return {selected:selected?.getValue(), validLength:valid.length,
        diagnostics:diagnostics.map(({start, code}) => ({start, code})),
        methods:completion?.entries.map(entry => entry.name),
        sections,
        hovers:{fm:fmHover?.displayParts.map(part => part.text).join(''),
          pgFm:pgFmHover?.displayParts.map(part => part.text).join('')}};
    } finally {model.dispose();}
  }, mode);
  assert(types.selected?.includes(`"${mode.chip}"`), `${mode.id}: selected declarations missing`);
  assert(types.methods?.includes('setPreset'), `${mode.id}: fm completion missing`);
  assert(!types.diagnostics.some(diagnostic => diagnostic.start < types.validLength), `${mode.id}: highest native FM channel rejected`);
  assert(types.diagnostics.some(diagnostic => diagnostic.start >= types.validLength && diagnostic.code === 2345), `${mode.id}: out-of-range FM channel accepted`);
  assert.equal(types.methods.includes('setDacEnabled'), mode.chip === 'ym2612', `${mode.id}: DAC completion follows selected FM`);
  const expectedName = `${mode.chip.toUpperCase()}FMApi`;
  for (const [target, hover] of Object.entries(types.hovers)) {
    assert(hover?.includes(expectedName), `${mode.id}: ${target} hover should identify ${expectedName}, got ${hover}`);
    if (mode.chip !== 'ym2612') {
      assert(!/PlaygroundOPNFm|YM2612Channel/.test(hover), `${mode.id}: ${target} hover exposes a generic or Genesis FM type: ${hover}`);
    }
  }
  for (const target of ['globals', 'pg', 'prepare']) {
    for (const section of ['ssg', 'rhythm', 'adpcm']) {
      assert.equal(types.sections[target].includes(section), mode.chip === 'ym2608', `${mode.id}: ${target} ${section} completion follows the selected mode`);
    }
  }
  if (mode.chip === 'ym2608') {
    for (const [section, methods] of Object.entries({ssg:['tone','setFrequency','keyOff'],
      rhythm:['setVoice','keyOn','keyOff'], adpcm:['loadSample','loadMemory','setPlaybackRate','keyOn','keyOff']})) {
      for (const method of methods) assert(types.sections[section].includes(method), `OPNA ${section}.${method} completion missing`);
    }
  }
  return types.hovers;
}

async function checkChipTabs(page, mode) {
  const chipTabs = {operator:'#operatorTabButton', segapsg:'#segapsgTab', rf5c164:'#rf5c164Tab', pwm:'#pwmTab'};
  const expected = mode.chip === 'ym2612'
    ? ['operator', 'segapsg', ...(mode.full ? ['rf5c164', 'pwm'] : [])] : ['operator'];
  for (const [name, selector] of Object.entries(chipTabs)) {
    assert.equal(await page.locator(selector).isVisible(), expected.includes(name), `${mode.id}: ${name} tab visibility`);
  }
  for (const selector of ['#codeTab', '#audioMonitorTab', '#fxMonitorTab', '#mixerTab', '#consoleTab', '#shellTab', '#keyboardTab', '#helpersTab']) {
    assert(await page.locator(selector).isVisible(), `${mode.id}: generic tool ${selector} remains available`);
  }
  await page.locator('#operatorTabButton').focus();
  await page.keyboard.press('ArrowRight');
  const next = mode.chip === 'ym2612' ? 'segapsgTab' : 'codeTab';
  assert.equal(await page.evaluate(() => document.activeElement.id), next, `${mode.id}: ArrowRight skips hidden chip tabs`);
  assert.equal(await page.locator(`#${next}`).getAttribute('aria-selected'), 'true');
  await page.locator('#codeTab').click();
}

async function checkAdditionalChipTabs(page, mode) {
  if (mode.id !== 'pc98') return;
  // The Run gesture initializes audio in WebKit; the independent chip itself is
  // deliberately added through the runtime API after the page has started.
  await page.evaluate(() => {
    document.getElementById('workerExecution').checked = false;
    window.__modeRegression.setEditorValue("console.log('MODE_TAB_RUNTIME_READY');");
  });
  await page.click('#runButton');
  await page.waitForFunction(() => document.getElementById('consoleOutput').textContent.includes('MODE_TAB_RUNTIME_READY'));
  await page.evaluate(async () => {
    await window.__modeRegression.runtime.playSource("const extra = await useSoundChip('segapsg'); console.log('MODE_EXTRA_CHIP_TAB_PASS:' + extra.id);", {execution:'main'});
  });
  await page.waitForFunction(() => document.getElementById('consoleOutput').textContent.includes('MODE_EXTRA_CHIP_TAB_PASS:segapsg:shared'));
  assert(await page.evaluate(() => window.__modeRegression.runtime.chipInspector.list().some(chip => chip.id === 'segapsg:shared')), 'the extra chip was actually connected');
  await checkChipTabs(page, mode);
  await page.evaluate(async () => window.__modeRegression.runtime.stopWithFade());
  assert.equal(await page.locator('#segapsgTab').isVisible(), false, 'an added chip does not change mode-defined tabs');
}

async function checkOpnaSections(page, browserName) {
  const examplePath = '/examples/pc98/pc98-opna-sections.js';
  const example = await page.evaluate(path => window.__modeRegression.virtualFiles.get(path)?.data, examplePath);
  assert.equal(example, await fs.readFile(path.join(docs, 'playground', examplePath), 'utf8'), 'the built-in OPNA example matches its source file');
  await page.evaluate(() => {
    document.getElementById('workerExecution').checked = false;
    window.__modeRegression.setEditorValue("console.log('OPNA_PRIMARY_READY');");
  });
  await page.click('#runButton');
  await page.waitForFunction(() => document.getElementById('consoleOutput').textContent.includes('OPNA_PRIMARY_READY'));
  await page.evaluate(() => {
    const {megaDrive} = window.__modeRegression;
    const context = megaDrive.audioContext, meter = context.createAnalyser(), silent = context.createGain();
    meter.fftSize = 1024; silent.gain.value = 0; meter.connect(silent); silent.connect(context.destination);
    const state = window.__opnaMeter = {meter, silent, detach:megaDrive.audio.connectOutputMonitor(meter), peak:0, quietSince:null};
    state.timer = setInterval(() => {
      const pcm = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(pcm);
      let peak = 0;
      for (const value of pcm) peak = Math.max(peak, Math.abs(value));
      state.peak = Math.max(state.peak, peak);
      if (peak < .00001) state.quietSince ??= performance.now();
      else state.quietSince = null;
    }, 10);
  });
  const cases = {
    ssg:"ssg.tone(0, {frequency:440, volume:12}); liveLoop('opna-ssg-hold', async () => {await sleep(.1);});",
    rhythm:`
      rhythm.setVolume(48); rhythm.setVoice('snare', {volume:24, left:true, right:true});
      liveLoop('opna-rhythm-hold', async () => {rhythm.keyOn('snare'); await sleep(.12);});
    `,
    adpcm:`
      const sample = await livePrepare('opna-pcm-sample', async api => {
        if (api.adpcm !== adpcm) throw Error('livePrepare is not using primary ADPCM');
        const sampleRate = 8000, pcm = new Float32Array(4096);
        for (let i=0; i<pcm.length; i++) pcm[i] = .7 * Math.sin(2*Math.PI*330*i/sampleRate);
        return await api.adpcm.loadSample({channels:[pcm], sampleRate}, {address:0});
      });
      if (!(sample.frames > 0 && sample.duration > .4)) throw Error('PCM sample was not encoded/uploaded');
      adpcm.setVolume(220); adpcm.setPan(true, true); adpcm.keyOn({repeat:true});
      liveLoop('opna-adpcm-hold', async () => {await sleep(.1);});
    `,
  };
  try {
    for (const execution of ['main', 'worker']) {
      const lookahead = await page.evaluate(execution => execution === 'worker'
        ? window.__modeRegression.runtime.getTiming().workerLookaheadSeconds * 1000 : 0, execution);
      for (const [section, body] of Object.entries(cases)) {
        const marker = `OPNA_SECTION_PASS:${execution}:${section}`;
        const source = `
          if (ssg !== pg.ssg || rhythm !== pg.rhythm || adpcm !== pg.adpcm) throw Error('OPNA section aliases do not share the primary chip');
          await livePrepare(${JSON.stringify(`opna-context-${execution}-${section}`)}, async api => {
            if (api.fm !== fm || api.ssg !== ssg || api.rhythm !== rhythm || api.adpcm !== adpcm) throw Error('livePrepare OPNA context differs from globals');
            return true;
          });
          const initialClock = fm.clock;
          try {
            await fm.setClock(6000000);
            if (fm.clock !== 6000000) throw Error('Primary FM clock did not change');
            if (ssg.setFrequency(0, 440) !== Math.round(6000000 / (4*16*440))) throw Error('SSG clock is not synchronized');
            const expectedRate = Math.round(8000*144*65536/6000000)*6000000/(144*65536);
            if (Math.abs(adpcm.setPlaybackRate(8000) - expectedRate) > .000001) throw Error('ADPCM clock is not synchronized');
          } finally {await fm.setClock(initialClock);}
          ${body}
          console.log(${JSON.stringify(marker)});
        `;
        await page.evaluate(async ({source, execution}) => {
          window.__opnaMeter.peak = 0; window.__opnaMeter.quietSince = null;
          await window.__modeRegression.runtime.playSource(source, {execution});
        }, {source, execution});
        await page.waitForFunction(marker => document.getElementById('consoleOutput').textContent.includes(marker), marker);
        await page.waitForFunction(() => window.__opnaMeter.peak > .0001, null, {timeout:3000 + lookahead});
        const actual = await page.evaluate(() => {
          const {runtime, megaDrive} = window.__modeRegression;
          return {peak:window.__opnaMeter.peak,
            connected:megaDrive.mixer.list().filter(chip => chip.connected).map(chip => ({id:chip.id, name:chip.name})),
            inspected:runtime.chipInspector.list().map(chip => chip.id)};
        });
        assert.deepEqual(actual.connected.map(chip => chip.id), ['ym2608'], `${execution}/${section}: sections must share the one primary YM2608`);
        assert(!actual.inspected.some(id => /^ym2608:/.test(id)), `${execution}/${section}: an extra YM2608 was created`);
        await page.evaluate(() => {
          // Keep the master gate open: silence must come from stopping OPNA's
          // generators rather than from the UI's output fade masking them.
          window.__modeRegression.runtime.stop();
          window.__opnaMeter.quietSince = null;
        });
        // Observe continuous silence beyond the Worker reservation window, so
        // a queued key-on cannot pass by arriving after an early quiet frame.
        const quietMs = Math.max(250, lookahead + 150);
        await page.waitForFunction(quietMs => window.__opnaMeter.quietSince !== null &&
          performance.now() - window.__opnaMeter.quietSince >= quietMs, quietMs, {timeout:3000 + lookahead});
        console.log(JSON.stringify({browser:browserName, mode:'pc98', execution, section, peak:actual.peak,
          primaryOnly:true, clockSynchronized:true, stopQuiet:true, passed:true}));
      }
      const marker = `OPNA_BUILTIN_EXAMPLE_PASS:${execution}`;
      await page.evaluate(async ({source, execution, marker}) => {
        window.__opnaMeter.peak = 0; window.__opnaMeter.quietSince = null;
        await window.__modeRegression.runtime.playSource(source + `\nconsole.log(${JSON.stringify(marker)});`, {execution});
      }, {source:example, execution, marker});
      await page.waitForFunction(marker => document.getElementById('consoleOutput').textContent.includes(marker), marker);
      assert(await page.evaluate(() => window.__opnaMeter.peak > .0001), `${execution}: the built-in OPNA example produced no audio`);
      assert.deepEqual(await page.evaluate(() => window.__modeRegression.megaDrive.mixer.list()
        .filter(chip => chip.connected).map(chip => chip.id)), ['ym2608'], 'the built-in example uses only primary OPNA');
      await page.evaluate(() => {window.__modeRegression.runtime.stop(); window.__opnaMeter.quietSince = null;});
      await page.waitForFunction(quietMs => window.__opnaMeter.quietSince !== null &&
        performance.now() - window.__opnaMeter.quietSince >= quietMs, Math.max(250, lookahead + 150), {timeout:3000 + lookahead});
      console.log(JSON.stringify({browser:browserName, mode:'pc98', execution, example:examplePath,
        primaryOnly:true, audible:true, stopQuiet:true, passed:true}));
    }
  } finally {
    await page.evaluate(async () => {
      const state = window.__opnaMeter;
      if (!state) return;
      clearInterval(state.timer); state.detach(); state.meter.disconnect(); state.silent.disconnect();
      delete window.__opnaMeter;
      await window.__modeRegression.runtime.stopWithFade();
    }).catch(() => {});
  }
}

async function checkAudio(page, mode) {
  // A real Run click supplies the initial audio gesture, including in WebKit.
  await page.evaluate(() => {
    document.getElementById('workerExecution').checked = false;
    window.__modeRegression.setEditorValue("await sleep(.01); console.log('MODE_AUDIO_READY');");
  });
  await page.click('#runButton');
  await page.waitForFunction(() => document.getElementById('consoleOutput').textContent.includes('MODE_AUDIO_READY'));
  const native = await page.evaluate(() => {
    const {megaDrive, selectedMode} = window.__modeRegression;
    const context = megaDrive.audioContext;
    const meter = context.createAnalyser(), silent = context.createGain();
    meter.fftSize = 1024; silent.gain.value = 0;
    meter.connect(silent); silent.connect(context.destination);
    const detach = megaDrive.audio.connectOutputMonitor(meter);
    window.__modeMeter = {meter, silent, detach, peak:0};
    window.__modeMeter.timer = setInterval(() => {
      const pcm = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(pcm);
      for (const value of pcm) window.__modeMeter.peak = Math.max(window.__modeMeter.peak, Math.abs(value));
    }, 10);
    return {chip:megaDrive.capabilities.chip, channels:megaDrive.capabilities.fmChannels,
      pcm:Boolean(megaDrive.pcm), pwm:Boolean(megaDrive.pwm), engine:selectedMode.engine,
      worklet:megaDrive.workletUrl};
  });
  assert.equal(native.chip, mode.chip);
  assert.equal(native.channels, mode.channels);
  assert.equal(native.pcm, Boolean(mode.full), `${mode.id}: RF5C164 startup`);
  assert.equal(native.pwm, Boolean(mode.full), `${mode.id}: 32X PWM startup`);
  assert.equal(native.engine, mode.nuked ? 'nuked' : 'ymfm');
  assert.equal(native.worklet.includes('ym2612-worklet-nuked'), Boolean(mode.nuked));
  try {
    for (const execution of ['main', 'worker']) {
      const marker = `MODE_AUDIO_PASS:${mode.id}:${execution}`;
      const source = `
        if (fm.clock !== ${mode.clock}) throw Error('Wrong mode clock: ' + fm.clock);
        const pitch = noteToBlockFnum('A4');
        const hz = pitch.fnum * fm.clock * 2 ** (pitch.block - 1) / (${mode.chip === 'ym2203' ? 72 : 144} * 2 ** 20);
        if (Math.abs(hz - 440) > .6) throw Error('Mode pitch/clock mismatch: ' + hz);
        fm.setPreset(${mode.channels - 1}, FM_PRESETS['one-op-basic']);
        await play('A4', {channel:${mode.channels - 1}, seconds:.3});
        console.log(${JSON.stringify(marker)});
      `;
      await page.evaluate(async ({source, execution}) => {
        window.__modeMeter.peak = 0;
        await window.__modeRegression.runtime.playSource(source, {execution});
      }, {source, execution});
      await page.waitForFunction(marker => document.getElementById('consoleOutput').textContent.includes(marker), marker);
      // A Worker completion acknowledges scheduling. Its audio can still be in
      // the configured lookahead window when the console marker arrives.
      const audibleTimeout = await page.evaluate(execution => 1500 + (execution === 'worker'
        ? window.__modeRegression.runtime.getTiming().workerLookaheadSeconds * 1000 : 0), execution);
      await page.waitForFunction(() => window.__modeMeter.peak > .00001, null, {timeout:audibleTimeout});
      const peak = await page.evaluate(() => window.__modeMeter.peak);
      assert(peak > .00001, `${mode.id}/${execution}: short play was silent (${peak})`);
      await page.evaluate(async () => window.__modeRegression.runtime.stopWithFade());
      console.log(JSON.stringify({mode:mode.id, execution, clock:mode.clock, channels:mode.channels, peak, passed:true}));
    }
  } finally {
    await page.evaluate(() => {
      const meter = window.__modeMeter;
      if (!meter) return;
      clearInterval(meter.timer); meter.detach(); meter.meter.disconnect(); meter.silent.disconnect();
      delete window.__modeMeter;
    }).catch(() => {}); // A failed navigation may already have discarded the realm.
  }
}

async function checkProjectSwitch(page, base, screenshot) {
  const original = '// Source loaded from URL\nawait sleep(.01);\n';
  const source = '// Edited before changing mode\nfm.setPreset(CH1, FM_PRESETS["one-op-basic"]);\nawait play("D4", {seconds:.01});\n';
  await page.goto(`${base}?mode=genesis&src=${Buffer.from(original).toString('base64url')}&no-sw=1`);
  await ready(page);
  assert.equal(await page.evaluate(() => window.__modeRegression.getEditorValue()), original);
  await page.evaluate(source => {
    const test = window.__modeRegression;
    test.virtualFiles.writeBinary('/assets/mode-test.bin', new Uint8Array([0, 255, 128, 13, 10, 0]));
    test.virtualFiles.writeBinary('/assets/opaque.txt', new Uint8Array([255, 0, 128, 10]));
    test.virtualFiles.writeText('/NOTICE', 'Extensionless text remains text.\n');
    test.virtualFiles.mkdir('/assets/empty', {recursive:true});
    test.virtualFiles.writeText('/lib/mode-test.js', 'export const value = 42;\n');
    test.setEditorValue(source);
  }, source);
  // Use the public control so stopping, snapshotting and reload all run together.
  await page.locator('#mainMenu > summary').click();
  await Promise.all([
    page.waitForURL(url => url.searchParams.get('mode') === 'pc98'),
    page.locator('#playgroundMode').selectOption('pc98'),
  ]);
  await ready(page);
  const restored = await page.evaluate(() => {
    const test = window.__modeRegression;
    return {mode:test.selectedMode.id, editor:test.getEditorValue(), entry:test.virtualFiles.get('/index.js')?.data,
      binary:Array.from(test.virtualFiles.get('/assets/mode-test.bin')?.data || []),
      opaque:{type:test.virtualFiles.get('/assets/opaque.txt')?.type,
        bytes:Array.from(test.virtualFiles.get('/assets/opaque.txt')?.data || []),
        typed:test.virtualFiles.get('/assets/opaque.txt')?.data instanceof Uint8Array},
      notice:{type:test.virtualFiles.get('/NOTICE')?.type, data:test.virtualFiles.get('/NOTICE')?.data},
      module:test.virtualFiles.get('/lib/mode-test.js')?.data,
      empty:test.virtualFiles.stat('/assets/empty')?.type};
  });
  assert.equal(restored.mode, 'pc98');
  assert.equal(restored.editor, source, 'unsaved editor text survives switching');
  assert.equal(restored.entry, source, 'the transferred entry point includes unsaved edits');
  assert.deepEqual(restored.binary, [0,255,128,13,10,0]);
  assert.deepEqual(restored.opaque, {type:'binary', bytes:[255,0,128,10], typed:true}, 'a text extension does not turn binary into text');
  assert.deepEqual(restored.notice, {type:'text', data:'Extensionless text remains text.\n'}, 'extensionless text retains its type');
  assert.equal(restored.module, 'export const value = 42;\n');
  assert.equal(restored.empty, 'directory');
  const switched = new URL(page.url());
  for (const key of ['src','chip','engine','modeProject']) assert(!switched.searchParams.has(key), `switch left stale ${key} URL input`);
  if (screenshot) {
    await page.locator('#mainMenu > summary').click();
    await page.locator('#playgroundModeDetails').waitFor({state:'visible'});
    await page.screenshot({path:'/private/tmp/playground-opn-mode.png'});
    await page.locator('#mainMenu > summary').click();
  }
}

async function checkDesktopAutosave(browser, base) {
  // Autosave only needs the Desktop presence flag. No native playback or IPC is
  // involved, so this intentionally supplies no native command implementation.
  const context = await browser.newContext({serviceWorkers:'block'});
  await context.addInitScript(() => {window.__TAURI_INTERNALS__ = {};});
  const page = await context.newPage(), errors = [], failedRequests = [], consoleErrors = [];
  page.on('pageerror', error => errors.push({message:error.message, stack:error.stack, url:page.url()}));
  page.on('requestfailed', request => failedRequests.push({url:request.url(), type:request.resourceType(), error:request.failure()?.errorText}));
  page.on('console', message => {if (message.type() === 'error') consoleErrors.push({text:message.text(), location:message.location()});});
  const legacySource = '// Legacy YM2203 draft\nawait sleep(.01);\n';
  const opnSource = '// PC-98 OPN mode draft\nawait sleep(.02);\n';
  const genesisSource = '// Genesis mode draft\nawait sleep(.03);\n';
  const fullSource = '// Genesis Full mode draft\nawait sleep(.04);\n';
  try {
    // The landing page establishes the origin without starting Playground's
    // pagehide autosave before legacy storage has been populated.
    await page.goto(new URL('/index.html?no-sw=1', base).href);
    await page.evaluate(async legacySource => {
      const {openDraftStore} = await import('./playground/playground_autosave.js');
      const store = await openDraftStore(indexedDB, 'ym2203');
      try {
        await store.save({version:1, activePath:'/index.js', runPath:'/index.js',
          directories:['/', '/assets', '/assets/empty'], metadata:null, hasMetadataFile:false,
          files:[{path:'/index.js', type:'text', data:legacySource},
            {path:'/NOTICE', type:'text', data:'Legacy extensionless text.\n'},
            {path:'/assets/opaque.txt', type:'binary', data:new Uint8Array([255,0,128])}]});
      } finally {store.close();}
    }, legacySource);
    await page.goto(`${base}?mode=pc98-26&no-sw=1`); await ready(page);
    assert.equal(await page.evaluate(() => window.__modeRegression.getEditorValue()), legacySource, 'the legacy YM2203 draft migrates into its OPN mode');
    assert.match(await page.locator('#autosaveStatus').textContent(), /Autosave restored/);
    assert.deepEqual(await page.evaluate(() => {
      const files = window.__modeRegression.virtualFiles;
      return {notice:files.get('/NOTICE')?.type, binary:files.get('/assets/opaque.txt')?.type,
        bytes:Array.from(files.get('/assets/opaque.txt')?.data || []), empty:files.stat('/assets/empty')?.type};
    }), {notice:'text', binary:'binary', bytes:[255,0,128], empty:'directory'});
    const editAndFlush = source => page.evaluate(async source => {
      window.__modeRegression.setEditorValue(source);
      await window.__tetoricaAutosaveFlush();
    }, source);
    await editAndFlush(opnSource);
    await page.goto(`${base}?mode=genesis&no-sw=1`); await ready(page);
    assert.notEqual(await page.evaluate(() => window.__modeRegression.getEditorValue()), opnSource, 'Genesis does not load the OPN mode draft');
    await editAndFlush(genesisSource);
    await page.goto(`${base}?mode=pc98-26&no-sw=1`); await ready(page);
    assert.equal(await page.evaluate(() => window.__modeRegression.getEditorValue()), opnSource, 'the new mode draft takes precedence over the legacy draft');
    await page.goto(`${base}?mode=genesis-full&no-sw=1`); await ready(page);
    assert.notEqual(await page.evaluate(() => window.__modeRegression.getEditorValue()), genesisSource, 'Genesis Full has its own draft');
    await editAndFlush(fullSource);
    await page.goto(`${base}?mode=genesis&no-sw=1`); await ready(page);
    assert.equal(await page.evaluate(() => window.__modeRegression.getEditorValue()), genesisSource, 'Genesis Full does not overwrite Genesis');
    const stored = await page.evaluate(async () => {
      const {openDraftStore} = await import('./playground_autosave.js');
      const drafts = {};
      for (const key of ['ym2203', 'mode:pc98-26', 'mode:genesis', 'mode:genesis-full']) {
        const store = await openDraftStore(indexedDB, key);
        try {drafts[key] = (await store.load())?.files.find(file => file.path === '/index.js')?.data;}
        finally {store.close();}
      }
      return drafts;
    });
    assert.deepEqual(stored, {'ym2203':legacySource, 'mode:pc98-26':opnSource, 'mode:genesis':genesisSource, 'mode:genesis-full':fullSource});
    if (errors.length) console.error(JSON.stringify({desktopAutosave:true, errors, failedRequests, consoleErrors}));
    assert.deepEqual(errors, [], 'Desktop autosave page errors');
  } finally {await context.close();}
}

async function checkLegacyAndLayout(page, base) {
  for (const [query, expected] of [
    ['chip=ym2203', 'pc98-26'], ['chip=ym2610b', 'neogeo-b'],
    ['engine=nuked', 'genesis-nuked'], ['mode=pc98&chip=ym2612&engine=nuked', 'pc98'],
  ]) {
    await page.goto(`${base}?${query}&no-sw=1`); await ready(page);
    assert.equal(await page.evaluate(() => window.__modeRegression.selectedMode.id), expected, query);
    assert.equal(await page.locator('#playgroundMode').inputValue(), expected, query);
  }
  await page.goto(`${base}?mode=pc98&layout=simple&no-sw=1`); await ready(page);
  assert.equal(await page.evaluate(() => window.__modeRegression.selectedMode.id), 'pc98');
  assert(await page.locator('body').evaluate(element => element.classList.contains('mode-simple')), 'layout=simple coexists with environment mode');
  assert.equal(await page.locator('#playgroundMode').inputValue(), 'pc98');
}

async function checkBrowser(name, type, base) {
  const browser = await type.launch({headless:true, ...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  const context = await browser.newContext({serviceWorkers:'block', viewport:{width:1320, height:960}});
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  const tabsOnly = process.argv.includes('--tabs-only');
  const typesOnly = process.argv.includes('--types-only');
  const opnaOnly = process.argv.includes('--opna-only');
  try {
    for (const mode of process.argv.includes('--project-only') ? [] : modes) {
      await page.goto(`${base}?mode=${mode.id}&no-sw=1`); await ready(page);
      assert.equal(await page.title(), `Tetorica ${mode.label} Playground`);
      assert.equal(await page.locator('#playgroundMode').inputValue(), mode.id);
      assert.deepEqual(await page.locator('#playgroundMode option').evaluateAll(options => options.map(option => option.value)), modes.map(mode => mode.id));
      if (!typesOnly && !opnaOnly) await checkChipTabs(page, mode);
      let typeHovers;
      if (!tabsOnly) {
        typeHovers = await checkTypes(page, mode);
        if (!typesOnly && !opnaOnly) await checkAudio(page, mode);
      }
      if (!typesOnly && !opnaOnly) await checkAdditionalChipTabs(page, mode);
      if (!typesOnly && !tabsOnly && mode.id === 'pc98') await checkOpnaSections(page, name);
      if (!typesOnly && !opnaOnly && mode.id === 'pc98' && name === 'chromium') await page.screenshot({path:'/private/tmp/playground-mode-tabs.png'});
      if (tabsOnly) console.log(JSON.stringify({browser:name, mode:mode.id, chipTabs:true, keyboardNavigation:true, passed:true}));
      if (typesOnly) console.log(JSON.stringify({browser:name, mode:mode.id, hovers:typeHovers, passed:true}));
    }
    if (!tabsOnly && !typesOnly && !opnaOnly) {
      await checkProjectSwitch(page, base, name === 'chromium');
      await checkLegacyAndLayout(page, base);
      await checkDesktopAutosave(browser, base);
    }
    assert.deepEqual(errors, [], `${name}: page errors`);
    console.log(JSON.stringify({browser:name, passed:true, modes:process.argv.includes('--project-only') ? 0 : modes.length,
      chipTabs:!typesOnly && !opnaOnly && !process.argv.includes('--project-only'),
      opnaSections:!tabsOnly && !typesOnly && !process.argv.includes('--project-only'),
      projectSwitch:!tabsOnly && !typesOnly && !opnaOnly, fileTypes:!tabsOnly && !typesOnly && !opnaOnly,
      desktopAutosave:!tabsOnly && !typesOnly && !opnaOnly, legacyUrls:!tabsOnly && !typesOnly && !opnaOnly,
      simpleLayout:!tabsOnly && !typesOnly && !opnaOnly}));
  } catch (error) {
    console.error(JSON.stringify({browser:name, url:page.url(), status:await page.locator('#status').textContent().catch(() => null), errors}));
    throw error;
  } finally {await context.close(); await browser.close();}
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/playground/index.html`;
    await checkBrowser('chromium', chromium, base);
    if (process.argv.includes('--webkit')) await checkBrowser('webkit', webkit, base);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
