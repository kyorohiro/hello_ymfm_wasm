// Selected environments, Main/Worker playback, Monaco types and project transfer.
// Self-hosts docs. Chromium is required; pass --webkit to include WebKit.
// --project-only exercises transfer/autosave/legacy URLs without repeating audio.
// --tabs-only checks mode-specific chip tabs without audio/transfer suites.
// --types-only checks the actual Monaco completions, diagnostics and FM hovers.
// --opna-only checks mode-specific section types and primary OPNA section audio.
// --opnb-only checks section types and both Neo Geo primary OPNB variants.
// --opnb-example-only runs the bundled OPNB example in both Neo Geo modes.
// --ym2203-only checks native OPN SSG types, audio, clock, reset and Stop.
// --gameboy-only checks the native non-FM environment, audio and mode transfer.
// --starters-only checks fresh defaults, curated files, playable examples and draft restore.
// --starter-modes=id,id focuses starter audio; --webkit-only selects only WebKit.
// --mode-choice-only checks mode choices, draft restore and New Cassette.
// --menu-only compares sustained audio and UI activity with Menu closed/open/closed.
// --menu-modes=genesis,pc98 and --menu-executions=main,worker focus that probe.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const docs = path.resolve(__dirname, '../docs');
const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.wasm':'application/wasm', '.json':'application/json', '.svg':'image/svg+xml'};
const accessor = '\nwindow.__modeRegression={runtime,megaDrive,selectedMode,virtualFiles,getEditorValue,setEditorValue:value=>editorAdapter.setValue(value),captureProjectSnapshot,openVirtualFile,loadCassetteSource,runCode};';
const modes = [
  {id:'genesis', label:'Genesis', chip:'ym2612', clock:7670454, channels:6},
  {id:'genesis-full', label:'Genesis Full', chip:'ym2612', clock:7670454, channels:6, full:true},
  {id:'genesis-full-nuked', label:'Genesis Full (Nuked)', chip:'ym2612', clock:7670454, channels:6, full:true, nuked:true},
  {id:'pc98-26', label:'PC-98 (YM2203 / OPN)', chip:'ym2203', clock:4000000, channels:3},
  {id:'pc98', label:'PC-98 (YM2608 / OPNA)', chip:'ym2608', clock:8000000, channels:6},
  {id:'neogeo', label:'Neo Geo', chip:'ym2610', clock:8000000, channels:4},
  {id:'neogeo-b', label:'Neo Geo (YM2610B)', chip:'ym2610b', clock:8000000, channels:6},
  {id:'gameboy', label:'Game Boy', chip:'gameboy', clock:4194304, channels:0},
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
  if (mode.chip === 'gameboy') return checkGameboyTypes(page);
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
      if (['ym2203', 'ym2608', 'ym2610', 'ym2610b'].includes(mode.chip)) {
        const names = mode.chip === 'ym2203' ? ['ssg'] : mode.chip === 'ym2608'
          ? ['ssg','rhythm','adpcm'] : ['ssg','adpcmA','adpcmB','adpcm'];
        for (const section of names) sections[section] = await completions(section, `${section}.`);
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
    assert(!types.sections[target].includes('gameboy'), `${mode.id}: ${target} should omit the Game Boy builtin`);
    const opna = mode.chip === 'ym2608', opnb = ['ym2610', 'ym2610b'].includes(mode.chip);
    for (const [section, available] of Object.entries({ssg:mode.chip === 'ym2203' || opna || opnb, rhythm:opna, adpcm:opna || opnb, adpcmA:opnb, adpcmB:opnb})) {
      assert.equal(types.sections[target].includes(section), available, `${mode.id}: ${target} ${section} completion follows the selected mode`);
    }
  }
  if (mode.chip === 'ym2203') {
    for (const method of ['tone','noise','setEnvelope','setFrequency','keyOff','reset']) {
      assert(types.sections.ssg.includes(method), `OPN ssg.${method} completion missing`);
    }
  }
  if (mode.chip === 'ym2608') {
    for (const [section, methods] of Object.entries({ssg:['tone','setFrequency','keyOff'],
      rhythm:['setVoice','keyOn','keyOff'], adpcm:['loadSample','loadMemory','setPlaybackRate','keyOn','keyOff']})) {
      for (const method of methods) assert(types.sections[section].includes(method), `OPNA ${section}.${method} completion missing`);
    }
  }
  if (['ym2610', 'ym2610b'].includes(mode.chip)) {
    for (const [section, methods] of Object.entries({ssg:['tone','noise','setFrequency','keyOff'],
      adpcmA:['loadMemory','setSample','setVoice','keyOn','keyOff'],
      adpcmB:['loadMemory','setSample','setPlaybackRate','keyOn','keyOff'],
      adpcm:['loadMemory','setSample','setPlaybackRate','keyOn','keyOff']})) {
      for (const method of methods) assert(types.sections[section].includes(method), `${mode.id}: ${section}.${method} completion missing`);
    }
  }
  return types.hovers;
}

async function checkGameboyTypes(page) {
  const types = await page.evaluate(async () => {
    const selected = monaco.editor.getModels().find(model => model.uri.path.endsWith('/tetorica-playground-gameboy.d.ts'));
    const getWorker = await monaco.languages.typescript.getJavaScriptWorker();
    const valid = `gameboy.pulse.noteOn(1, 'C4');\ngameboy.wave.noteOn('C3');\ngameboy.noise.keyOn();\npg.gameboy.setPan(3, true, true);\nlivePrepare('gb-types', api => api.gameboy.pulse.setDuty(0, .5));\n`;
    const invalid = `gameboy.pulse.noteOn(2, 'C4');\nfm;\nplay('C4');\nwrite(0, 1);\nFM_PRESETS;\nCH1;\nOP1;\nnoteToBlockFnum('C4');\npg.fm;\npg.play;\n`;
    const model = monaco.editor.createModel(valid + invalid, 'javascript', monaco.Uri.parse('file:///gameboy-native-mode-types.js'));
    const completions = async (name, source, position = source.length) => {
      const probe = monaco.editor.createModel(source, 'javascript', monaco.Uri.parse(`file:///gameboy-${name}-completion.js`));
      try {
        const service = await getWorker(probe.uri);
        return (await service.getCompletionsAtPosition(probe.uri.toString(), position))?.entries.map(entry => entry.name) || [];
      } finally {probe.dispose();}
    };
    try {
      const worker = await getWorker(model.uri), uri = model.uri.toString();
      const diagnostics = await worker.getSemanticDiagnostics(uri);
      const hover = await worker.getQuickInfoAtPosition(uri, valid.indexOf('gameboy') + 2);
      const prepareSource = "livePrepare('gb-context', api => {api.});";
      return {selected:selected?.getValue(), validLength:valid.length,
        diagnostics:diagnostics.map(({start, code}) => ({start, code})),
        hover:hover?.displayParts.map(part => part.text).join(''),
        globals:await completions('globals', ';\n'), pg:await completions('pg', 'pg.'),
        prepare:await completions('prepare', prepareSource, prepareSource.indexOf('api.') + 4),
        gameboy:await completions('chip', 'gameboy.'), pulse:await completions('pulse', 'gameboy.pulse.'),
        wave:await completions('wave', 'gameboy.wave.'), noise:await completions('noise', 'gameboy.noise.')};
    } finally {model.dispose();}
  });
  assert(types.selected?.includes('"gameboy"'), 'Game Boy selected declarations missing');
  assert(!types.diagnostics.some(diagnostic => diagnostic.start < types.validLength), 'native Game Boy controls rejected');
  assert(types.diagnostics.some(diagnostic => diagnostic.code === 2345), 'invalid third pulse channel accepted');
  assert.equal(types.diagnostics.filter(diagnostic => diagnostic.code === 2304).length, 7, 'FM-only globals should be undefined in Game Boy mode');
  assert.equal(types.diagnostics.filter(diagnostic => diagnostic.code === 2339).length, 2, 'pg should omit FM and play');
  for (const target of ['globals', 'pg', 'prepare']) {
    assert(types[target].includes('gameboy'), `${target}: native Game Boy completion missing`);
    for (const name of ['fm','play','write','FM_PRESETS','CH1','OP1','noteToBlockFnum','psg','dac','ssg','rhythm','adpcm']) {
      assert(!types[target].includes(name), `${target}: ${name} should not appear in Game Boy mode`);
    }
  }
  for (const [section, methods] of Object.entries({gameboy:['pulse','wave','noise','setClock','writeRegister'],
    pulse:['setVoice','setDuty','noteOn','keyOff'], wave:['stopAndSetWaveform','setLevel','noteOn','keyOff'],
    noise:['setVoice','setParameters','keyOn','keyOff']})) {
    for (const method of methods) assert(types[section].includes(method), `gameboy.${section}.${method} completion missing`);
  }
  assert(!types.gameboy.includes('dispose'), 'builtin lifetime must remain owned by the runtime');
  return {gameboy:types.hover};
}

async function checkChipTabs(page, mode) {
  const chipTabs = {operator:'#operatorTabButton', segapsg:'#segapsgTab', rf5c164:'#rf5c164Tab', pwm:'#pwmTab'};
  const expected = mode.chip === 'ym2612'
    ? ['operator', 'segapsg', ...(mode.full ? ['rf5c164', 'pwm'] : [])] : mode.chip === 'gameboy' ? [] : ['operator'];
  for (const [name, selector] of Object.entries(chipTabs)) {
    assert.equal(await page.locator(selector).isVisible(), expected.includes(name), `${mode.id}: ${name} tab visibility`);
  }
  for (const selector of ['#codeTab', '#audioMonitorTab', '#fxMonitorTab', '#mixerTab', '#consoleTab', '#shellTab', '#helpersTab']) {
    assert(await page.locator(selector).isVisible(), `${mode.id}: generic tool ${selector} remains available`);
  }
  assert.equal(await page.locator('#keyboardTab').isVisible(), mode.chip !== 'gameboy', `${mode.id}: FM keyboard visibility`);
  await page.locator(mode.chip === 'gameboy' ? '#codeTab' : '#operatorTabButton').focus();
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

async function checkGameboyAudio(page, browserName) {
  const examplePath = '/examples/gameboy/gameboy-mode-pulse.js';
  const example = await page.evaluate(path => window.__modeRegression.virtualFiles.get(path)?.data, examplePath);
  assert.equal(example, await fs.readFile(path.join(docs, 'playground', examplePath), 'utf8'), 'the builtin Game Boy example matches its source file');
  const initial = await page.evaluate(async () => ({source:window.__modeRegression.getEditorValue(),
    expected:(await import('./playground_examples.js')).MODE_DEFAULT_CODES.gameboy}));
  assert.equal(initial.source, initial.expected, 'Game Boy mode starts with its own runnable /index.js');
  await page.evaluate(() => {
    document.getElementById('workerExecution').checked = false;
    window.__modeRegression.setEditorValue("console.log('GAMEBOY_PRIMARY_READY');");
  });
  await page.click('#runButton');
  await page.waitForFunction(() => document.getElementById('consoleOutput').textContent.includes('GAMEBOY_PRIMARY_READY'));
  const primary = await page.evaluate(() => {
    const {megaDrive} = window.__modeRegression;
    const context = megaDrive.audioContext, meter = context.createAnalyser(), silent = context.createGain();
    meter.fftSize = 1024; silent.gain.value = 0; meter.connect(silent); silent.connect(context.destination);
    const state = window.__gameboyMeter = {meter, silent, detach:megaDrive.audio.connectOutputMonitor(meter), peak:0, quietSince:null};
    state.timer = setInterval(() => {
      const pcm = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(pcm);
      let peak = 0;
      for (const value of pcm) peak = Math.max(peak, Math.abs(value));
      state.peak = Math.max(state.peak, peak);
      if (peak < .00001) state.quietSince ??= performance.now();
      else state.quietSince = null;
    }, 10);
    return {chip:megaDrive.chip, fm:megaDrive.fm, gameboy:Boolean(megaDrive.gameboy),
      chips:megaDrive.mixer.list().filter(chip => chip.connected).map(chip => chip.id)};
  });
  assert.equal(primary.chip, 'gameboy');
  assert.equal(primary.fm, null, 'Game Boy does not initialize a hidden FM device');
  assert(primary.gameboy, 'the primary native Game Boy device exists');
  assert.deepEqual(primary.chips, ['gameboy']);
  const cases = {
    pulse:`gameboy.pulse.setVoice(0, {duty:.25, volume:10, envelope:{direction:'down',period:0}});
      liveLoop('gameboy-held-pulse', async () => {gameboy.pulse.noteOn(0, 'A4'); await sleep(3);});`,
    wave:`gameboy.wave.stopAndSetWaveform(Array.from({length:32}, (_, i) => i < 16 ? 15 : 0));
      gameboy.wave.setLevel(.5);
      liveLoop('gameboy-held-wave', async () => {gameboy.wave.noteOn('C4'); await sleep(3);});`,
    noise:`gameboy.noise.setVoice({volume:10,envelope:{direction:'down',period:0},divisor:3,shift:4,width:15});
      liveLoop('gameboy-held-noise', async () => {gameboy.noise.keyOn(); await sleep(3);});`,
  };
  const assertPrimaryOnly = async execution => {
    // Worker disposal is reserved on the audio timeline and can intentionally
    // finish after its console marker, at the end of the lookahead window.
    await page.waitForFunction(() => {
      const chips = window.__modeRegression.megaDrive.mixer.list().filter(chip => chip.connected);
      return chips.length === 1 && chips[0].id === 'gameboy';
    });
    const connected = await page.evaluate(() => window.__modeRegression.megaDrive.mixer.list().filter(chip => chip.connected).map(chip => chip.id));
    assert.deepEqual(connected, ['gameboy'], `${execution}: native controls reuse the primary Game Boy`);
  };
  const waitQuiet = async lookahead => {
    await page.evaluate(() => {window.__gameboyMeter.quietSince = null;});
    await page.waitForFunction(quietMs => window.__gameboyMeter.quietSince !== null &&
      performance.now() - window.__gameboyMeter.quietSince >= quietMs, Math.max(250, lookahead + 150), {timeout:4000 + lookahead});
  };
  try {
    for (const execution of ['main','worker']) {
      const lookahead = await page.evaluate(execution => execution === 'worker'
        ? window.__modeRegression.runtime.getTiming().workerLookaheadSeconds * 1000 : 0, execution);
      for (const [section, body] of Object.entries(cases)) {
        const marker = `GAMEBOY_SECTION_PASS:${execution}:${section}`;
        const source = `
          if (typeof fm !== 'undefined' || typeof play !== 'undefined' || typeof write !== 'undefined' ||
            typeof FM_PRESETS !== 'undefined' || typeof CH1 !== 'undefined' || typeof OP1 !== 'undefined' ||
            typeof noteToBlockFnum !== 'undefined') throw Error('FM globals leaked into Game Boy mode');
          if (gameboy !== pg.gameboy || gameboy !== await useSoundChip('gameboy')) throw Error('Game Boy aliases differ');
          if (typeof gameboy.dispose !== 'undefined') throw Error('Primary Game Boy lifetime leaked');
          for (const name of ['fm','play','write','presets','psg','dac']) if (name in pg) throw Error('pg.' + name + ' leaked');
          await livePrepare(${JSON.stringify(`gameboy-context-${execution}-${section}`)}, api => {
            if (api.gameboy !== gameboy || 'fm' in api || 'presets' in api) throw Error('livePrepare context differs');
            return true;
          });
          if (gameboy.clock !== 4194304) throw Error('Wrong default Game Boy clock: ' + gameboy.clock);
          try {
            await gameboy.setClock(4000000);
            const n = Math.round(2048 - 4000000 / (32 * 440));
            const expected = 4000000 / (32 * (2048 - n));
            if (gameboy.clock !== 4000000 || Math.abs(gameboy.pulse.setFrequency(0,440) - expected) > .000001) throw Error('Game Boy clock/pitch differ');
          } finally {await gameboy.setClock(4194304);}
          ${body}
          console.log(${JSON.stringify(marker)});
        `;
        await page.evaluate(async ({source, execution}) => {
          window.__gameboyMeter.peak = 0; window.__gameboyMeter.quietSince = null;
          await window.__modeRegression.runtime.playSource(source, {execution});
        }, {source, execution});
        await page.waitForFunction(marker => document.getElementById('consoleOutput').textContent.includes(marker), marker);
        await page.waitForFunction(() => window.__gameboyMeter.peak > .0001, null, {timeout:4000 + lookahead});
        const peak = await page.evaluate(() => window.__gameboyMeter.peak);
        await assertPrimaryOnly(execution);
        await page.evaluate(() => window.__modeRegression.runtime.stop());
        await waitQuiet(lookahead);
        console.log(JSON.stringify({browser:browserName,mode:'gameboy',execution,section,peak,clock:true,primaryOnly:true,stopQuiet:true,passed:true}));
      }
      // Removing an owned loop must release its generator while leaving the
      // audio output open, without relying on the global Stop button's fade.
      await page.evaluate(async ({source, execution}) => {
        window.__gameboyMeter.peak = 0;
        await window.__modeRegression.runtime.playSource(source, {execution});
      }, {source:cases.pulse, execution});
      await page.waitForFunction(() => window.__gameboyMeter.peak > .0001, null, {timeout:4000 + lookahead});
      await page.evaluate(async execution => window.__modeRegression.runtime.playSource("stopLoop('gameboy-held-pulse');", {execution}), execution);
      await waitQuiet(lookahead);
      const marker = `GAMEBOY_EXTRA_PASS:${execution}`;
      await page.evaluate(async ({execution,marker}) => window.__modeRegression.runtime.playSource(`
        const extra = await createSoundChip('gameboy');
        if (extra === gameboy || extra.id === gameboy.id) throw Error('createSoundChip must create an independent Game Boy');
        extra.initialize(); extra.dispose();
        if (await useSoundChip('gameboy') !== gameboy) throw Error('useSoundChip did not return primary');
        console.log(${JSON.stringify(marker)});
      `, {execution}), {execution,marker});
      await page.waitForFunction(marker => document.getElementById('consoleOutput').textContent.includes(marker), marker);
      await assertPrimaryOnly(execution);
      const exampleMarker = `GAMEBOY_EXAMPLE_PASS:${execution}`;
      await page.evaluate(async ({source,execution,marker}) => {
        window.__gameboyMeter.peak = 0;
        await window.__modeRegression.runtime.playSource(source + `\nconsole.log(${JSON.stringify(marker)});`, {execution});
      }, {source:example,execution,marker:exampleMarker});
      await page.waitForFunction(marker => document.getElementById('consoleOutput').textContent.includes(marker), exampleMarker);
      await page.waitForFunction(() => window.__gameboyMeter.peak > .0001, null, {timeout:4000 + lookahead});
      await assertPrimaryOnly(execution);
      await page.evaluate(() => window.__modeRegression.runtime.stop());
      await waitQuiet(lookahead);
      console.log(JSON.stringify({browser:browserName,mode:'gameboy',execution,example:examplePath,loopCancelQuiet:true,independentChip:true,primaryOnly:true,audible:true,stopQuiet:true,passed:true}));
    }
  } finally {
    await page.evaluate(async () => {
      const state = window.__gameboyMeter;
      if (!state) return;
      clearInterval(state.timer); state.detach(); state.meter.disconnect(); state.silent.disconnect();
      delete window.__gameboyMeter;
      await window.__modeRegression.runtime.stopWithFade();
    }).catch(() => {});
  }
}

async function checkYm2203Ssg(page, browserName) {
  const examplePath = '/examples/pc98/pc98-opn-ssg.js';
  const example = await page.evaluate(path => window.__modeRegression.virtualFiles.get(path)?.data, examplePath);
  assert.equal(example, await fs.readFile(path.join(docs, 'playground', examplePath), 'utf8'), 'the built-in OPN example matches its source file');
  await page.evaluate(() => {
    document.getElementById('workerExecution').checked = false;
    window.__modeRegression.setEditorValue("console.log('OPN_PRIMARY_READY');");
  });
  await page.click('#runButton');
  await page.waitForFunction(() => document.getElementById('consoleOutput').textContent.includes('OPN_PRIMARY_READY'));
  await page.evaluate(async () => {
    const {megaDrive} = window.__modeRegression;
    const context = megaDrive.audioContext, meter = context.createAnalyser(), silent = context.createGain();
    meter.fftSize = 1024; silent.gain.value = 0; meter.connect(silent); silent.connect(context.destination);
    const state = window.__opnMeter = {meter, silent, detach:megaDrive.audio.connectOutputMonitor(meter), peak:0, quietSince:null};
    const moduleUrl = URL.createObjectURL(new Blob([`
      class OPNMonoProbe extends AudioWorkletProcessor {
        process(inputs) {
          const channels = inputs[0], left = channels[0], right = channels[1];
          if (!left) return true;
          let peak = 0, difference = 0;
          for (let i = 0; i < left.length; i++) {
            peak = Math.max(peak, Math.abs(left[i]), Math.abs(right?.[i] ?? 0));
            difference = Math.max(difference, Math.abs(left[i] - (right?.[i] ?? left[i])));
          }
          this.port.postMessage({peak, difference, channels:channels.length});
          return true;
        }
      }
      registerProcessor('opn-mono-probe', OPNMonoProbe);
    `], {type:'text/javascript'}));
    try {await context.audioWorklet.addModule(moduleUrl);} finally {URL.revokeObjectURL(moduleUrl);}
    // Probe the primary worklet ahead of the mixer and any stereo effects.
    const probe = state.probe = new AudioWorkletNode(context, 'opn-mono-probe', {
      numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1],
      channelCount:2, channelCountMode:'explicit', channelInterpretation:'discrete',
    });
    probe.port.onmessage = ({data}) => {
      state.rawPeak = Math.max(state.rawPeak ?? 0, data.peak);
      state.rawDifference = Math.max(state.rawDifference ?? 0, data.difference);
    };
    megaDrive.node.connect(probe); probe.connect(silent);
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
    tone:"ssg.tone(0, {frequency:440, volume:12}); liveLoop('opn-tone-hold', async () => {await sleep(.1);});",
    noise:"ssg.noise(2, {period:19, volume:12}); liveLoop('opn-noise-hold', async () => {await sleep(.1);});",
    envelope: `
      ssg.setEnvelope({period:1000, shape:10}); ssg.tone(1, {frequency:330, envelope:true});
      liveLoop('opn-envelope-hold', async () => {await sleep(.1);});
    `,
    'fm-after-ssg-reset': `
      fm.setPreset(2, FM_PRESETS['one-op-basic']); fm.noteOn(2, 'A4');
      ssg.reset(); liveLoop('opn-fm-hold', async () => {await sleep(.1);});
    `,
  };
  try {
    for (const execution of ['main', 'worker']) {
      const lookahead = await page.evaluate(execution => execution === 'worker'
        ? window.__modeRegression.runtime.getTiming().workerLookaheadSeconds * 1000 : 0, execution);
      const assertQuiet = async () => {
        await page.evaluate(() => {
          // Keep the output gate open to observe the actual chip generators.
          window.__modeRegression.runtime.stop(); window.__opnMeter.quietSince = null;
        });
        await page.waitForFunction(quietMs => window.__opnMeter.quietSince !== null &&
          performance.now() - window.__opnMeter.quietSince >= quietMs,
        Math.max(250, lookahead + 150), {timeout:3000 + lookahead});
      };
      for (const [section, body] of Object.entries(cases)) {
        const marker = `OPN_SSG_PASS:${execution}:${section}`;
        const source = `
          if (ssg !== pg.ssg) throw Error('OPN SSG aliases do not share the primary chip');
          await livePrepare(${JSON.stringify(`opn-context-${execution}-${section}`)}, api => {
            if (api.fm !== fm || api.ssg !== ssg) throw Error('livePrepare OPN context differs from globals');
            if ('rhythm' in api || 'adpcm' in api || 'adpcmA' in api || 'adpcmB' in api) throw Error('OPN has unsupported sections');
            return true;
          });
          if (fm.clock !== 4000000) throw Error('OPN master clock differs from PC-98 mode');
          if (ssg.setFrequency(0, 440) !== Math.round(4000000 / (2*16*440))) throw Error('OPN SSG must use master / 2');
          try {
            await fm.setClock(6000000);
            if (fm.clock !== 6000000) throw Error('Primary OPN clock did not change');
            if (ssg.setFrequency(0, 440) !== Math.round(6000000 / (2*16*440))) throw Error('OPN SSG clock is not synchronized');
          } finally {await fm.setClock(4000000);}
          ${body}
          console.log(${JSON.stringify(marker)});
        `;
        await page.evaluate(async ({source, execution}) => {
          window.__opnMeter.peak = 0; window.__opnMeter.quietSince = null;
          window.__opnMeter.rawPeak = 0; window.__opnMeter.rawDifference = 0;
          await window.__modeRegression.runtime.playSource(source, {execution});
        }, {source, execution});
        await page.waitForFunction(marker => document.getElementById('consoleOutput').textContent.includes(marker), marker);
        await page.waitForFunction(() => window.__opnMeter.peak > .0001 && window.__opnMeter.rawPeak > .0001, null, {timeout:3000 + lookahead});
        const actual = await page.evaluate(() => ({peak:window.__opnMeter.peak,
          rawPeak:window.__opnMeter.rawPeak, rawDifference:window.__opnMeter.rawDifference,
          connected:window.__modeRegression.megaDrive.mixer.list().filter(chip => chip.connected).map(chip => chip.id),
          inspected:window.__modeRegression.runtime.chipInspector.list().map(chip => chip.id)}));
        assert.deepEqual(actual.connected, ['ym2203'], `${execution}/${section}: SSG must share the one primary YM2203`);
        assert(!actual.inspected.some(id => /^ym2203:/.test(id)), `${execution}/${section}: an extra YM2203 was created`);
        assert(actual.rawDifference <= 1e-7, `${execution}/${section}: native YM2203 output must be mono (difference ${actual.rawDifference})`);
        await assertQuiet();
        console.log(JSON.stringify({browser:browserName, mode:'pc98-26', execution, section, peak:actual.peak,
          primaryOnly:true, clockSynchronized:true, nativeMono:true, stopQuiet:true, passed:true}));
      }
      const marker = `OPN_BUILTIN_EXAMPLE_PASS:${execution}`;
      await page.evaluate(async ({source, execution, marker}) => {
        window.__opnMeter.peak = 0; window.__opnMeter.quietSince = null;
        await window.__modeRegression.runtime.playSource(source + `\nconsole.log(${JSON.stringify(marker)});`, {execution});
      }, {source:example, execution, marker});
      await page.waitForFunction(marker => document.getElementById('consoleOutput').textContent.includes(marker), marker);
      assert(await page.evaluate(() => window.__opnMeter.peak > .0001), `${execution}: the built-in OPN example produced no audio`);
      assert.deepEqual(await page.evaluate(() => window.__modeRegression.megaDrive.mixer.list()
        .filter(chip => chip.connected).map(chip => chip.id)), ['ym2203'], 'the built-in example uses only primary OPN');
      await assertQuiet();
      console.log(JSON.stringify({browser:browserName, mode:'pc98-26', execution, example:examplePath,
        primaryOnly:true, audible:true, stopQuiet:true, passed:true}));
    }
  } finally {
    await page.evaluate(async () => {
      const state = window.__opnMeter;
      if (!state) return;
      clearInterval(state.timer); state.detach(); state.meter.disconnect(); state.silent.disconnect();
      window.__modeRegression.megaDrive.node.disconnect(state.probe); state.probe.disconnect(); state.probe.port.close();
      delete window.__opnMeter;
      await window.__modeRegression.runtime.stopWithFade();
    }).catch(() => {});
  }
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

async function checkOpnbSections(page, browserName, mode, {exampleOnly = false} = {}) {
  const examplePath = '/examples/neogeo/neogeo-opnb-sections.js';
  const example = await page.evaluate(path => window.__modeRegression.virtualFiles.get(path)?.data, examplePath);
  assert.equal(example, await fs.readFile(path.join(docs, 'playground', examplePath), 'utf8'), 'the built-in OPNB example matches its source file');
  await page.evaluate(() => {
    document.getElementById('workerExecution').checked = false;
    window.__modeRegression.setEditorValue("console.log('OPNB_PRIMARY_READY');");
  });
  await page.click('#runButton');
  await page.waitForFunction(() => document.getElementById('consoleOutput').textContent.includes('OPNB_PRIMARY_READY'));
  await page.evaluate(() => {
    const {megaDrive} = window.__modeRegression;
    const context = megaDrive.audioContext, meter = context.createAnalyser(), silent = context.createGain();
    meter.fftSize = 1024; silent.gain.value = 0; meter.connect(silent); silent.connect(context.destination);
    const state = window.__opnbMeter = {meter, silent, detach:megaDrive.audio.connectOutputMonitor(meter), peak:0, quietSince:null};
    state.timer = setInterval(() => {
      const pcm = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(pcm);
      let peak = 0;
      for (const value of pcm) peak = Math.max(peak, Math.abs(value));
      state.peak = Math.max(state.peak, peak);
      if (peak < .00001) state.quietSince ??= performance.now();
      else state.quietSince = null;
    }, 10);
  });
  // The generated nibble stream exercises the decoders without any game ROM.
  const cases = {
    'ssg-tone':"ssg.tone(0, {frequency:440, volume:12}); liveLoop('opnb-tone-hold', async () => {await sleep(.1);});",
    'ssg-noise':"ssg.noise(2, {period:19, volume:12}); liveLoop('opnb-noise-hold', async () => {await sleep(.1);});",
    ...Object.fromEntries(Array.from({length:6}, (_, voice) => [`adpcmA-${voice}`, `
      await livePrepare('opnb-a-memory-${voice}', async api => {
        await api.adpcmA.loadMemory(new Uint8Array(1024).fill(0x17), ${voice * 1024}); return true;
      });
      adpcmA.setVolume(48); adpcmA.setVoice(${voice}, {volume:24, left:true, right:true});
      adpcmA.setSample(${voice}, {start:${voice * 1024}, end:${(voice + 1) * 1024}});
      liveLoop('opnb-a-hold', async () => {adpcmA.keyOn(${voice}); await sleep(.12);});
    `])),
    adpcmB:`
      await livePrepare('opnb-b-memory', async api => {
        await api.adpcmB.loadMemory(new Uint8Array(4096).fill(0x17).buffer, 256); return true;
      });
      adpcmB.setSample({start:256, end:4352}); adpcmB.setPlaybackRate(8000);
      adpcmB.setVolume(180); adpcmB.setPan(true, true); adpcm.keyOn({repeat:true});
      liveLoop('opnb-b-hold', async () => {await sleep(.1);});
    `,
    [`fm-${mode.channels - 1}`]:`
      fm.setPreset(${mode.channels - 1}, FM_PRESETS['one-op-basic']);
      liveLoop('opnb-fm-hold', async () => {await play('A4', {channel:${mode.channels - 1}, seconds:.15});});
    `,
  };
  try {
    for (const execution of ['main', 'worker']) {
      const lookahead = await page.evaluate(execution => execution === 'worker'
        ? window.__modeRegression.runtime.getTiming().workerLookaheadSeconds * 1000 : 0, execution);
      const physicalChannels = mode.chip === 'ym2610' ? [1, 2, 4, 5] : [0, 1, 2, 3, 4, 5];
      const pitches = await page.evaluate(async ({execution, channels}) => {
        const {runtime, megaDrive} = window.__modeRegression;
        const core = megaDrive.rawFm ?? megaDrive.fm;
        const before = core.getState().channels.map(({block, fnum}) => ({block, fnum}));
        const source = `for (let ch=0; ch<${channels}; ch++) fm.setBlockFnum(ch, 2, 1200+ch); console.log('OPNB_MAPPING_READY');`;
        await runtime.playSource(source, {execution});
        return {before, after:core.getState().channels.map(({block, fnum}) => ({block, fnum}))};
      }, {execution, channels:mode.channels});
      const expectedPitches = pitches.before.map(pitch => ({...pitch}));
      physicalChannels.forEach((physical, logical) => {expectedPitches[physical] = {block:2, fnum:1200 + logical};});
      assert.deepEqual(pitches.after, expectedPitches, `${mode.id}/${execution}: logical FM channels map to the native hardware channels`);
      for (const [section, body] of Object.entries(exampleOnly ? {} : cases)) {
        const marker = `OPNB_SECTION_PASS:${mode.id}:${execution}:${section}`;
        const source = `
          if (ssg !== pg.ssg || adpcmA !== pg.adpcmA || adpcmB !== pg.adpcmB || adpcm !== pg.adpcm || adpcm !== adpcmB)
            throw Error('OPNB aliases do not share the primary chip');
          await livePrepare(${JSON.stringify(`opnb-context-${mode.id}-${execution}-${section}`)}, async api => {
            if (api.fm !== fm || api.ssg !== ssg || api.adpcmA !== adpcmA || api.adpcmB !== adpcmB || api.adpcm !== adpcmB)
              throw Error('livePrepare OPNB context differs from globals');
            return true;
          });
          const initialClock = fm.clock;
          try {
            await fm.setClock(6000000);
            if (fm.clock !== 6000000) throw Error('Primary FM clock did not change');
            if (ssg.setFrequency(0, 440) !== Math.round(6000000 / (4*16*440))) throw Error('SSG clock is not synchronized');
            const expectedRate = Math.round(8000*144*65536/6000000)*6000000/(144*65536);
            if (Math.abs(adpcmB.setPlaybackRate(8000) - expectedRate) > .000001) throw Error('ADPCM-B clock is not synchronized');
          } finally {await fm.setClock(initialClock);}
          ${body}
          console.log(${JSON.stringify(marker)});
        `;
        await page.evaluate(async ({source, execution}) => {
          window.__opnbMeter.peak = 0; window.__opnbMeter.quietSince = null;
          await window.__modeRegression.runtime.playSource(source, {execution});
        }, {source, execution});
        await page.waitForFunction(marker => document.getElementById('consoleOutput').textContent.includes(marker), marker);
        await page.waitForFunction(() => window.__opnbMeter.peak > .0001, null, {timeout:3000 + lookahead});
        const actual = await page.evaluate(() => {
          const {runtime, megaDrive} = window.__modeRegression;
          return {peak:window.__opnbMeter.peak,
            connected:megaDrive.mixer.list().filter(chip => chip.connected).map(chip => chip.id),
            inspected:runtime.chipInspector.list().map(chip => chip.id)};
        });
        assert.deepEqual(actual.connected, [mode.chip], `${mode.id}/${execution}/${section}: sections must share the one primary OPNB`);
        assert(!actual.inspected.some(id => /^ym2610b?:/.test(id)), `${mode.id}/${execution}/${section}: an extra OPNB was created`);
        await page.evaluate(() => {
          // Keep the master gate open, including the Worker reservation window.
          window.__modeRegression.runtime.stop(); window.__opnbMeter.quietSince = null;
        });
        const quietMs = Math.max(250, lookahead + 150);
        await page.waitForFunction(quietMs => window.__opnbMeter.quietSince !== null &&
          performance.now() - window.__opnbMeter.quietSince >= quietMs, quietMs, {timeout:3000 + lookahead});
        console.log(JSON.stringify({browser:browserName, mode:mode.id, execution, section, peak:actual.peak,
          primaryOnly:true, clockSynchronized:true, stopQuiet:true, passed:true}));
      }
      const marker = `OPNB_BUILTIN_EXAMPLE_PASS:${mode.id}:${execution}`;
      await page.evaluate(async ({source, execution, marker}) => {
        window.__opnbMeter.peak = 0; window.__opnbMeter.quietSince = null;
        await window.__modeRegression.runtime.playSource(source + `\nconsole.log(${JSON.stringify(marker)});`, {execution});
      }, {source:example, execution, marker});
      await page.waitForFunction(marker => document.getElementById('consoleOutput').textContent.includes(marker), marker);
      assert(await page.evaluate(() => window.__opnbMeter.peak > .0001), `${mode.id}/${execution}: the built-in OPNB example produced no audio`);
      assert.deepEqual(await page.evaluate(() => window.__modeRegression.megaDrive.mixer.list()
        .filter(chip => chip.connected).map(chip => chip.id)), [mode.chip], 'the built-in example uses only primary OPNB');
      await page.evaluate(() => {window.__modeRegression.runtime.stop(); window.__opnbMeter.quietSince = null;});
      await page.waitForFunction(quietMs => window.__opnbMeter.quietSince !== null &&
        performance.now() - window.__opnbMeter.quietSince >= quietMs, Math.max(250, lookahead + 150), {timeout:3000 + lookahead});
      console.log(JSON.stringify({browser:browserName, mode:mode.id, execution, example:examplePath,
        primaryOnly:true, audible:true, stopQuiet:true, passed:true}));
    }
  } finally {
    await page.evaluate(async () => {
      const state = window.__opnbMeter;
      if (!state) return;
      clearInterval(state.timer); state.detach(); state.meter.disconnect(); state.silent.disconnect();
      delete window.__opnbMeter;
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
  await changeMode(page,'pc98','keep');
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

async function checkGameboyProjectSwitch(page, base) {
  const source = '// Shared project survives OPN and Game Boy mode changes.\nawait sleep(.01);\n';
  await page.goto(`${base}?mode=pc98-26&src=${Buffer.from(source).toString('base64url')}&no-sw=1`);
  await ready(page);
  await page.evaluate(() => {
    const {virtualFiles} = window.__modeRegression;
    virtualFiles.writeBinary('/assets/gameboy-mode.bin', new Uint8Array([0,255,128]));
    virtualFiles.writeText('/lib/gameboy-mode.js', 'export const value = 42;\n');
    virtualFiles.mkdir('/assets/gameboy-empty', {recursive:true});
  });
  for (const mode of ['gameboy','pc98-26']) {
    await changeMode(page,mode,'keep');
    const restored = await page.evaluate(() => {
      const test = window.__modeRegression;
      return {mode:test.selectedMode.id, source:test.getEditorValue(), entry:test.virtualFiles.get('/index.js')?.data,
        bytes:Array.from(test.virtualFiles.get('/assets/gameboy-mode.bin')?.data || []),
        module:test.virtualFiles.get('/lib/gameboy-mode.js')?.data,
        empty:test.virtualFiles.stat('/assets/gameboy-empty')?.type};
    });
    assert.deepEqual(restored, {mode,source,entry:source,bytes:[0,255,128],module:'export const value = 42;\n',empty:'directory'});
    assert(!new URL(page.url()).searchParams.has('src'), `${mode}: source URL is consumed after project transfer`);
  }
  console.log(JSON.stringify({mode:'gameboy',projectSwitch:'OPN→GameBoy→OPN',fileTypes:true,passed:true}));
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

async function checkStarterCatalog(page, mode) {
  const state = await page.evaluate(async modeId => {
    const {MODE_DEFAULT_CODES, MODE_EXAMPLE_FILES, EXAMPLE_FILES} = await import('./playground_examples.js');
    const test = window.__modeRegression;
    const expected = MODE_EXAMPLE_FILES[modeId];
    return {expected:expected.map(file => ({path:file.path,data:file.data})), canonicalCount:EXAMPLE_FILES.length,
      defaultCode:MODE_DEFAULT_CODES[modeId], editor:test.getEditorValue(), entry:test.virtualFiles.get('/index.js')?.data,
      examples:test.virtualFiles.list().filter(file => file.path.startsWith('/examples/') && file.path.endsWith('.js')).map(file => ({path:file.path,data:file.data})),
      tree:Array.from(document.querySelectorAll('#fileExplorerList button[data-file-path]'), node => node.dataset.filePath).filter(path => path.startsWith('/examples/') && path.endsWith('.js')),
      run:Array.from(document.querySelectorAll('#runFileSelect option'), node => node.value).filter(path => path.startsWith('/examples/') && path.endsWith('.js'))};
  }, mode.id);
  assert.equal(typeof state.defaultCode, 'string', `${mode.id}: mode has a starter`);
  assert.equal(state.editor, state.defaultCode, `${mode.id}: fresh editor shows its mode starter`);
  assert.equal(state.entry, state.defaultCode, `${mode.id}: /index.js contains its mode starter`);
  assert.deepEqual(state.examples.toSorted((a,b) => a.path.localeCompare(b.path)), state.expected.toSorted((a,b) => a.path.localeCompare(b.path)), `${mode.id}: VFS contains only selected examples`);
  const paths = state.expected.map(file => file.path).sort();
  assert.deepEqual(state.tree.sort(), paths, `${mode.id}: FILES follows selected examples`);
  assert.deepEqual(state.run.sort(), paths, `${mode.id}: Run selector follows selected examples`);
  if (mode.id === 'genesis') assert(paths.length > 20, 'default Genesis retains its rich catalog');
  else assert(paths.length >= 2 && paths.length <= 3, `${mode.id}: expected two or three curated examples, got ${paths.length}`);
  return [{path:'/index.js',data:state.defaultCode}, ...state.expected];
}

async function checkStarterAudio(page, browserName, mode, files) {
  // Initialize the audio context through the same user gesture as a normal Run.
  await page.evaluate(() => {
    document.getElementById('workerExecution').checked = false;
    window.__modeRegression.setEditorValue("console.log('MODE_STARTER_AUDIO_READY');");
  });
  await page.click('#runButton');
  await page.waitForFunction(() => document.getElementById('consoleOutput').textContent.includes('MODE_STARTER_AUDIO_READY'));
  await page.evaluate(() => {
    const {megaDrive} = window.__modeRegression, context = megaDrive.audioContext;
    const meter = context.createAnalyser(), silent = context.createGain();
    meter.fftSize = 2048; silent.gain.value = 0; meter.connect(silent); silent.connect(context.destination);
    const state = window.__starterMeter = {meter,silent,detach:megaDrive.audio.connectOutputMonitor(meter),peak:0,acPeak:0,recentAc:[],samples:0,quietThreshold:.00001,quietSince:null};
    state.timer = setInterval(() => {
      const pcm = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(pcm);
      const peak = pcm.reduce((max,value) => Math.max(max,Math.abs(value)),0);
      const mean = pcm.reduce((sum,value) => sum + value,0) / pcm.length;
      const acPeak = pcm.reduce((max,value) => Math.max(max,Math.abs(value - mean)),0);
      state.peak = Math.max(state.peak,peak); state.lastPeak = peak; state.lastMean = mean;
      state.acPeak = Math.max(state.acPeak,acPeak); state.lastAcPeak = acPeak; state.samples++;
      state.recentAc.push(acPeak); if (state.recentAc.length > 10) state.recentAc.shift();
      if (acPeak < state.quietThreshold) state.quietSince ??= performance.now(); else state.quietSince = null;
    },10);
  });
  await page.waitForFunction(() => window.__starterMeter.samples >= 30);
  const baseline = await page.evaluate(() => {
    const state = window.__starterMeter;
    const baseline = {peak:state.lastPeak,acPeak:Math.max(...state.recentAc),dc:state.lastMean};
    // Some emulators emit a constant DAC offset while idle. Measure the AC
    // signal above that offset, and retain the measured pre-Run noise floor.
    state.quietThreshold = Math.max(.00001,baseline.acPeak * 2);
    return baseline;
  });
  try {
    // Genesis retains the extensive legacy catalog. Its starter is the fresh
    // mode contract; running every old sample would repeat unrelated suites.
    const selected = mode.id === 'genesis' ? files.slice(0,1) : files;
    for (const execution of ['main','worker']) {
      for (const file of selected) {
        const lookahead = await page.evaluate(execution => execution === 'worker'
          ? window.__modeRegression.runtime.getTiming().workerLookaheadSeconds * 1000 : 0, execution);
        await page.evaluate(async ({file,execution}) => {
          const test = window.__modeRegression;
          test.openVirtualFile(file.path); test.setEditorValue(file.data);
          document.getElementById('workerExecution').checked = execution === 'worker';
          window.__starterMeter.peak = 0; window.__starterMeter.acPeak = 0; window.__starterMeter.quietSince = null;
          await test.runCode({propagateError:true});
        },{file,execution});
        await page.waitForFunction(() => window.__starterMeter.acPeak > window.__starterMeter.quietThreshold * 5, null,{timeout:5000 + lookahead});
        const peak = await page.evaluate(() => window.__starterMeter.peak);
        assert(!/\[error\]|(?:Reference|Syntax|Type)Error:/.test(await page.locator('#consoleOutput').textContent()), `${mode.id}/${execution}/${file.path}: runtime console error`);
        await page.evaluate(() => {window.__modeRegression.runtime.stop(); window.__starterMeter.quietSince = null;});
        await page.waitForFunction(quietMs => window.__starterMeter.quietSince !== null &&
          performance.now() - window.__starterMeter.quietSince >= quietMs, Math.max(250,lookahead + 150),{timeout:6000 + lookahead}).catch(async error => {
          console.error(JSON.stringify({mode:mode.id,execution,file:file.path,baseline,afterStop:await page.evaluate(() => {
            const state = window.__starterMeter; return {peak:state.lastPeak,acPeak:state.lastAcPeak,dc:state.lastMean,threshold:state.quietThreshold};
          })})); throw error;
        });
        console.log(JSON.stringify({browser:browserName,mode:mode.id,execution,starter:file.path === '/index.js',example:file.path,peak,baseline,stopQuiet:true,passed:true}));
      }
    }
  } finally {
    await page.evaluate(async () => {
      const state = window.__starterMeter;
      if (state) {clearInterval(state.timer); state.detach(); state.meter.disconnect(); state.silent.disconnect(); delete window.__starterMeter;}
      await window.__modeRegression.runtime.stopWithFade();
    }).catch(() => {});
  }
}

async function settleEditor(page) {
  await ready(page);
  // Let Monaco finish the model-scoped requests started by the editor change
  // before another synthetic action replaces that model in the same task.
  await page.waitForTimeout(150);
}

async function beginModeChange(page,id) {
  await settleEditor(page);
  if (!await page.locator('#playgroundMode').isVisible()) await page.locator('#mainMenu > summary').click();
  await page.locator('#playgroundMode').selectOption(id);
  await page.locator('#changeModeDialog').waitFor({state:'visible'});
  const label=await page.locator(`#playgroundMode option[value="${id}"]`).textContent();
  assert((await page.locator('#changeModeTarget').textContent()).includes(label),'dialog identifies the selected mode');
}

async function finishModeChange(page,id,choice='keep') {
  const selector={initial:'#modeChoiceInitial',keep:'#modeChoiceKeep',cancel:'#modeChoiceCancel'}[choice];
  assert(selector,`Unknown mode choice: ${choice}`);
  if(choice==='cancel'){
    await page.locator(selector).click();
    await page.locator('#changeModeDialog').waitFor({state:'hidden'});
    return;
  }
  await Promise.all([page.waitForURL(url=>url.searchParams.get('mode')===id),page.locator(selector).click()]);
  await ready(page);
}

async function changeMode(page,id,choice='keep') {
  await beginModeChange(page,id);
  await finishModeChange(page,id,choice);
}

async function openNewCassette(page) {
  await settleEditor(page);
  // Use the disclosure state: WebKit can report closed-menu children visible.
  if(!await page.locator('#mainMenu').evaluate(node=>node.open))await page.locator('#mainMenu > summary').click();
  await page.locator('#newCassetteButton').click();
  await page.locator('#newCassetteDialog').waitFor({state:'visible'});
}

async function assertModeStarter(page, modeId) {
  const state = await page.evaluate(async modeId => {
    const {MODE_DEFAULT_CODES} = await import('./playground_examples.js');
    const test = window.__modeRegression, snapshot = test.captureProjectSnapshot();
    return {mode:test.selectedMode.id,editor:test.getEditorValue(),entry:test.virtualFiles.get('/index.js')?.data,
      expected:MODE_DEFAULT_CODES[modeId],active:snapshot.activePath,run:snapshot.runPath};
  },modeId);
  assert.equal(state.mode,modeId);
  assert.equal(state.editor,state.expected,`${modeId}: explicit Initial choice opens the target mode's code`);
  assert.equal(state.entry,state.expected,`${modeId}: explicit Initial choice replaces /index.js`);
  assert.equal(state.active,'/index.js'); assert.equal(state.run,'/index.js');
}

async function checkStarterTransfer(page, base) {
  const foreign = '/examples/basic/fm/fm-api-beep.js';
  await page.goto(`${base}?mode=genesis&no-sw=1`); await ready(page);
  // Explicit Initial replaces the entry and file selections even when an
  // untouched foreign sample was previously open and selected for Run.
  await page.evaluate(path => window.__modeRegression.openVirtualFile(path),foreign);
  await changeMode(page,'gameboy','initial'); await assertModeStarter(page,'gameboy');
  assert.equal(await page.evaluate(path => window.__modeRegression.virtualFiles.has(path),foreign),false,'pristine foreign example is removed');
  await changeMode(page,'pc98','initial'); await assertModeStarter(page,'pc98');

  const editedIndex = '// User FM source stays intact across machine changes.\nfm.keyOff(0);\n';
  const editedExample = '// Edited built-in example is now project code.\nawait sleep(.01);\n';
  await page.goto(`${base}?mode=genesis&no-sw=1`); await ready(page);
  await page.evaluate(foreign => window.__modeRegression.openVirtualFile(foreign),foreign);
  await settleEditor(page);
  await page.evaluate(source => window.__modeRegression.setEditorValue(source),editedExample);
  await settleEditor(page);
  await page.evaluate(() => window.__modeRegression.openVirtualFile('/index.js'));
  await settleEditor(page);
  await page.evaluate(editedIndex => {
    const test = window.__modeRegression; test.setEditorValue(editedIndex);
    test.virtualFiles.writeBinary('/assets/starter.bin',new Uint8Array([0,255,128,0]));
    test.virtualFiles.writeText('/lib/own.js','export const own = true;\n');
    test.virtualFiles.mkdir('/assets/empty',{recursive:true});
  },editedIndex);
  await changeMode(page,'gameboy');
  const restored = await page.evaluate(foreign => {
    const test = window.__modeRegression;
    return {editor:test.getEditorValue(),index:test.virtualFiles.get('/index.js')?.data,example:test.virtualFiles.get(foreign)?.data,
      bytes:Array.from(test.virtualFiles.get('/assets/starter.bin')?.data || []),module:test.virtualFiles.get('/lib/own.js')?.data,
      empty:test.virtualFiles.stat('/assets/empty')?.type};
  },foreign);
  assert.deepEqual(restored,{editor:editedIndex,index:editedIndex,example:editedExample,bytes:[0,255,128,0],module:'export const own = true;\n',empty:'directory'});

  const beforeNew=await choiceProjectState(page);
  await openNewCassette(page);
  await page.locator('#newCassetteDialog button[value="cancel"]').click();
  await page.locator('#newCassetteDialog').waitFor({state:'hidden'});
  assert.deepEqual(await choiceProjectState(page),beforeNew,'Cancel New Cassette preserves the current project');

  await settleEditor(page);
  await page.evaluate(async ({editedIndex,editedExample}) => {
    const {createPlaygroundCassetteZip} = await import('./playground_cassette.js');
    const archive = createPlaygroundCassetteZip([
      {path:'/index.js',type:'text',data:editedIndex},
      {path:'/examples/author.js',type:'text',data:editedExample},
      {path:'/assets/cassette.bin',type:'binary',data:new Uint8Array([255,0,128])},
    ],{directories:['/assets/cassette-empty'],metadata:{title:'Mode project'},license:'CC0-1.0'});
    await window.__modeRegression.loadCassetteSource(archive,'mode-project.cassette.zip');
  },{editedIndex,editedExample});
  await changeMode(page,'pc98-26');
  const cassette = await page.evaluate(() => {
    const test = window.__modeRegression,snapshot = test.captureProjectSnapshot();
    return {editor:test.getEditorValue(),example:test.virtualFiles.get('/examples/author.js')?.data,
      bytes:Array.from(test.virtualFiles.get('/assets/cassette.bin')?.data || []),empty:test.virtualFiles.stat('/assets/cassette-empty')?.type,
      title:snapshot.metadata?.title,license:snapshot.metadata?.license};
  });
  assert.deepEqual(cassette,{editor:editedIndex,example:editedExample,bytes:[255,0,128],empty:'directory',title:'Mode project',license:'CC0-1.0'});
  console.log(JSON.stringify({starters:true,projectSwitch:'Genesis→GameBoy→PC98',pristineCleanup:true,editedFiles:true,binaryDirectories:true,cassette:true,newCassetteCancelPreservesEdits:true,passed:true}));
}

async function choiceProjectState(page) {
  return page.evaluate(()=>{
    const test=window.__modeRegression,snapshot=test.captureProjectSnapshot();
    return {mode:snapshot.modeId,active:snapshot.activePath,run:snapshot.runPath,editor:test.getEditorValue(),
      directories:snapshot.directories.slice().sort(),metadata:snapshot.metadata,hasMetadataFile:snapshot.hasMetadataFile,
      files:snapshot.files.map(file=>({path:file.path,type:typeof file.data==='string'?'text':'binary',
        data:typeof file.data==='string'?file.data:Array.from(file.data)})).sort((a,b)=>a.path.localeCompare(b.path))};
  });
}

const menuCaptureSource=`class MenuAudioCapture extends AudioWorkletProcessor {
  constructor(){super();this.reset();this.port.onmessage=({data})=>{if(data.op==='reset'){this.reset();this.port.postMessage({op:'reset'});}if(data.op==='report')this.port.postMessage({op:'report',frames:this.frames,invalid:this.invalid,peak:this.peak,maxQuietFrames:this.maxQuietFrames,frameGaps:this.frameGaps,maxDelta:this.maxDelta});};}
  reset(){this.frames=0;this.invalid=0;this.peak=0;this.quietFrames=0;this.maxQuietFrames=0;this.frameGaps=0;this.nextFrame=null;this.last=0;this.maxDelta=0;}
  process(inputs){const channels=inputs[0];if(!channels?.[0])return true;const frames=channels[0].length;if(this.nextFrame!==null&&this.nextFrame!==currentFrame)this.frameGaps++;this.nextFrame=currentFrame+frames;this.frames+=frames;let peak=0;
    for(const channel of channels)for(const value of channel){if(!Number.isFinite(value))this.invalid++;else peak=Math.max(peak,Math.abs(value));}
    for(const value of channels[0]){if(this.frames>frames)this.maxDelta=Math.max(this.maxDelta,Math.abs(value-this.last));this.last=value;}
    this.peak=Math.max(this.peak,peak);this.quietFrames=peak<1e-7?this.quietFrames+frames:0;this.maxQuietFrames=Math.max(this.maxQuietFrames,this.quietFrames);return true;}
}registerProcessor('tetorica-menu-audio-capture',MenuAudioCapture);`;

async function checkMenuAudio(page,base,browserName) {
  const modeIds=process.argv.find(arg=>arg.startsWith('--menu-modes='))?.split('=')[1].split(',')??['genesis'];
  const executions=process.argv.find(arg=>arg.startsWith('--menu-executions='))?.split('=')[1].split(',')??['main','worker'];
  assert(modeIds.length&&modeIds.every(id=>['genesis','pc98'].includes(id)),'Menu probe supports Genesis/PC98');
  assert(executions.length&&executions.every(value=>['main','worker'].includes(value)),'Menu probe supports Main/Worker');
  const source=`const preset={...FM_PRESETS['one-op-basic'],operators:FM_PRESETS['one-op-basic'].operators.map(op=>({...op}))};
preset.operators[3]={...preset.operators[3],tl:32,ar:31,d1r:0,d2r:0,sl:0,rr:15};fm.setPreset(CH1,preset);fm.noteOn(CH1,'A4');
onKeyboardPressKey('menu-probe-key',event=>{console.log('MENU_KEY_DOWN '+event.code);event.preventDefault?.();});
onKeyboardReleaseKey('menu-probe-key',event=>console.log('MENU_KEY_UP '+event.code));
liveLoop('menu-held-audio',async()=>{await sleep(.25);});console.log('MENU_SOURCE '+(typeof document==='undefined'?'worker':'main'));`;
  for(const mode of modeIds)for(const execution of executions){
    await page.goto(`${base}?mode=${mode}&no-sw=1`);await settleEditor(page);
    await page.evaluate(({source,execution})=>{window.__modeRegression.setEditorValue(source);document.getElementById('workerExecution').checked=execution==='worker';},{source,execution});
    await page.click('#runButton');
    await page.waitForFunction(execution=>document.getElementById('consoleOutput').textContent.includes('MENU_SOURCE '+execution),execution);
    const lead=execution==='worker'?await page.evaluate(()=>window.__modeRegression.runtime.getTiming().workerLookaheadSeconds*1000):0;
    await page.waitForTimeout(lead+250);
    await page.evaluate(async captureSource=>{
      const test=window.__modeRegression,context=test.megaDrive.audioContext,url=URL.createObjectURL(new Blob([captureSource],{type:'text/javascript'}));
      try{await context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
      const capture=new AudioWorkletNode(context,'tetorica-menu-audio-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
      const state=window.__menuProbe={capture,context,node:test.megaDrive.node,restores:[],sampleRate:context.sampleRate,processorError:false};
      state.detach=test.megaDrive.audio.connectOutputMonitor(capture);capture.connect(context.destination);capture.onprocessorerror=()=>{state.processorError=true;};
      state.resetMetrics=()=>{state.menuMutations=0;state.bodyMutations=0;state.menuCanvasCalls=0;state.canvasCalls={};state.messages={};state.lifecycle={};state.raf=0;};state.resetMetrics();
      const observe=new MutationObserver(records=>{for(const record of records){state.bodyMutations++;if(document.getElementById('mainMenu').contains(record.target))state.menuMutations++;}});
      observe.observe(document.body,{subtree:true,attributes:true,childList:true,characterData:true});state.restores.push(()=>observe.disconnect());
      const wrap=(target,key,fn)=>{const original=target[key];if(typeof original!=='function')return;target[key]=function(...args){fn(this,args);return original.apply(this,args);};state.restores.push(()=>{target[key]=original;});};
      for(const method of ['resume','suspend','close'])wrap(context,method,()=>{state.lifecycle[method]=(state.lifecycle[method]??0)+1;});
      wrap(state.node.port,'postMessage',(_,args)=>{for(const message of Array.isArray(args[0])?args[0]:[args[0]]){const type=message?.type??message?.method??'unknown';state.messages[type]=(state.messages[type]??0)+1;}});
      for(const method of ['clearRect','fillRect','stroke','fill','drawImage','putImageData'])wrap(CanvasRenderingContext2D.prototype,method,(ctx)=>{const canvas=ctx.canvas,key=canvas.id||canvas.closest('[id]')?.id||'anonymous';state.canvasCalls[key]=(state.canvasCalls[key]??0)+1;if(document.getElementById('mainMenu').contains(canvas))state.menuCanvasCalls++;});
      const raf=requestAnimationFrame;window.requestAnimationFrame=callback=>raf(time=>{state.raf++;callback(time);});state.restores.push(()=>{window.requestAnimationFrame=raf;});
      state.command=op=>new Promise(resolve=>{capture.port.onmessage=({data})=>{if(data.op===op)resolve(data);};capture.port.postMessage({op});});
      state.before=(test.megaDrive.fm.fm??test.megaDrive.fm).getState();
    },menuCaptureSource);
    const phase=async label=>{
      await page.waitForTimeout(100);
      await page.evaluate(async()=>{const state=window.__menuProbe;await state.command('reset');state.resetMetrics();state.started=performance.now();});
      await page.waitForTimeout(1200);
      const report=await page.evaluate(async()=>{const state=window.__menuProbe,pcm=await state.command('report'),test=window.__modeRegression;
        return {pcm,menuOpen:document.getElementById('mainMenu').open,menuMutations:state.menuMutations,bodyMutations:state.bodyMutations,
          menuCanvasCalls:state.menuCanvasCalls,canvasCalls:state.canvasCalls,raf:state.raf,messages:state.messages,lifecycle:state.lifecycle,
          ms:performance.now()-state.started,sampleRate:state.sampleRate,processorError:state.processorError,
          sameContext:state.context===test.megaDrive.audioContext,sameNode:state.node===test.megaDrive.node,
          stateUnchanged:JSON.stringify(state.before)===JSON.stringify((test.megaDrive.fm.fm??test.megaDrive.fm).getState()),playback:test.runtime.getState().playback};});
      const pfx=`${browserName}/${mode}/${execution}/${label}`;
      assert.equal(report.pcm.invalid,0,`${pfx}: finite PCM`);assert.equal(report.pcm.frameGaps,0,`${pfx}: continuous worklet frames`);
      assert(report.pcm.frames>report.sampleRate*.5&&report.pcm.peak>.0001,`${pfx}: sustained audio is captured`);
      assert(report.pcm.maxQuietFrames<report.sampleRate*.1,`${pfx}: held audio does not stop for 100ms`);
      assert.deepEqual(report.lifecycle,{},`${pfx}: no AudioContext lifecycle calls`);
      assert.equal(report.stateUnchanged,true,`${pfx}: menu does not change chip registers`);
      assert(!Object.keys(report.messages).some(type=>/write|reset|initialize|clock|envelope|dac-playback/.test(type)),`${pfx}: no register/reset/clock messages`);
      assert.equal(report.sameContext,true);assert.equal(report.sameNode,true);assert.equal(report.processorError,false);assert.equal(report.playback,'running');
      assert.equal(report.menuMutations,0,`${pfx}: settled menu has no continuous DOM updates`);
      assert.equal(report.menuCanvasCalls,0,`${pfx}: settled menu has no canvas rendering`);
      console.log(JSON.stringify({browser:browserName,mode,execution,menuPhase:label,...report,passed:true}));return report;
    };
    try{
      await phase('closed');await page.locator('#mainMenu > summary').click();await phase('open');
      await page.locator('#mainMenu > summary').click();await phase('closed-again');
      await page.locator('#codeTab').click();await page.keyboard.down('j');
      await page.waitForFunction(()=>document.getElementById('consoleOutput').textContent.includes('MENU_KEY_DOWN KeyJ'));
      await page.locator('#mainMenu > summary').click();await page.keyboard.up('j');
      await page.waitForFunction(()=>document.getElementById('consoleOutput').textContent.includes('MENU_KEY_UP KeyJ'));
      await page.keyboard.press('q');await page.keyboard.press('Escape');
      assert.equal(await page.locator('#mainMenu').evaluate(node=>node.open),false,'Menu Escape closes despite user preventDefault handler');
      assert.equal(await page.locator('#consoleOutput').textContent().then(text=>text.includes('MENU_KEY_DOWN KeyQ')||text.includes('MENU_KEY_DOWN Escape')),false,'Menu keys do not reach running code');
      await page.waitForFunction(()=>document.activeElement===document.querySelector('#mainMenu > summary'));
      await page.locator('#mainMenu > summary').click();
      for(const menu of ['menuImport','menuExport'])if(!await page.locator('#'+menu).evaluate(node=>node.open))await page.locator('#'+menu+' > summary').click();
      for(let repeat=0;repeat<3;repeat++){
        await page.locator('#mainMenu > summary').click();await page.locator('#mainMenu > summary').click();
        for(const [menu,button] of [['menuImport','importVgmButton'],['menuExport','exportTfiButton']]){
          assert.equal(await page.locator('#'+menu).evaluate(node=>node.open),true,`${menu}: expansion survives parent reopen`);
          await page.locator('#'+button).click({trial:true});
        }
      }
      assert.equal(await page.locator('#openInitialCodeButton, #menuExamples').count(),0,'No redundant starter action');
      await page.locator('#playgroundMode').click({trial:true});
      const screenshot=`/private/tmp/playground-menu-${browserName}-${mode}-${execution}.png`;await page.screenshot({path:screenshot});
      await page.setViewportSize({width:420,height:860});
      await page.locator('#playgroundMode').click({trial:true});await page.locator('#importVgmButton').click({trial:true});
      await page.screenshot({path:`/private/tmp/playground-menu-narrow-${browserName}-${mode}-${execution}.png`});await page.setViewportSize({width:1320,height:960});
      console.log(JSON.stringify({browser:browserName,mode,execution,menuKeysIsolated:true,heldKeyRelease:true,submenusRetained:true,nativeModeSelectReachable:true,narrowMenuReachable:true,screenshot,passed:true}));
    }finally{
      await page.evaluate(async()=>{const state=window.__menuProbe;for(const restore of state.restores.reverse())restore();state.detach();state.capture.disconnect();state.capture.port.close();await window.__modeRegression.runtime.stopWithFade();}).catch(()=>{});
    }
  }
}

async function checkMenuLayout(page,base,browserName) {
  for(const mode of ['genesis','snes']){
    await page.goto(`${base}?mode=${mode}&no-sw=1`);await settleEditor(page);
    await page.locator('#mainMenu > summary').click();
    const closed=await page.evaluate(()=>{
      const describe=id=>{const node=document.getElementById(id),panel=node.querySelector(':scope > .toolbar-menu-panel');
        return {open:node.open,hidden:node.hidden,height:node.getBoundingClientRect().height,summaryHeight:node.querySelector(':scope > summary').getBoundingClientRect().height,
          panelDisplay:getComputedStyle(panel).display,panelHeight:panel.getBoundingClientRect().height,panelWidth:panel.getBoundingClientRect().width};};
      return {import:describe('menuImport'),export:describe('menuExport')};
    });
    for(const id of ['import',...(mode==='genesis'?['export']:[])]){
      assert.equal(closed[id].open,false,`${mode}/${id}: initially collapsed`);
      assert.equal(closed[id].panelDisplay,'none');assert.equal(closed[id].panelHeight,0);assert.equal(closed[id].panelWidth,0);
      assert(closed[id].height<=closed[id].summaryHeight+2,`${mode}/${id}: closed panel leaves no blank vertical area`);
    }
    assert.equal(closed.export.hidden,mode!=='genesis',`${mode}: Export is only shown for FM modes`);
    const screenshot=`/private/tmp/playground-menu-closed-${browserName}-${mode}.png`;await page.screenshot({path:screenshot});
    const entries=[['menuImport','importVgmButton'],...(mode==='genesis'?[['menuExport','exportTfiButton']]:[])];
    for(const [menu] of entries)await page.locator('#'+menu+' > summary').click();
    for(let repeat=0;repeat<3;repeat++){
      await page.locator('#mainMenu > summary').click();await page.locator('#mainMenu > summary').click();
      for(const [menu,button] of entries){assert.equal(await page.locator('#'+menu).evaluate(node=>node.open),true,`${mode}/${menu}: expansion is retained`);await page.locator('#'+button).click({trial:true});}
    }
    const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#importVgmButton').click()]);
    await chooser.setFiles([]);
    await page.locator('#mainMenu > summary').click();
    for(const [menu,button] of entries){assert.equal(await page.locator('#'+menu).evaluate(node=>node.open),true);await page.locator('#'+button).click({trial:true});}
    await page.locator('#playgroundMode').selectOption(mode);
    assert.equal(await page.locator('#changeModeDialog').isVisible(),false,'Native Mode select same-mode choice leaves menu usable');
    await page.setViewportSize({width:420,height:860});
    await page.locator('#importVgmButton').click({trial:true});await page.locator('#playgroundMode').click({trial:true});
    await page.screenshot({path:`/private/tmp/playground-menu-layout-narrow-${browserName}-${mode}.png`});
    await page.setViewportSize({width:1320,height:960});
    console.log(JSON.stringify({browser:browserName,mode,menuLayout:true,closed,expandedContentsRetained:true,realImportFileChooser:true,narrowHitTesting:true,screenshot,passed:true}));
  }
}

async function checkModeChoices(page,base,browserName) {
  await page.goto(`${base}?mode=genesis&no-sw=1`);await ready(page);
  const genesisSource=await page.evaluate(()=>window.__modeRegression.getEditorValue());
  await changeMode(page,'gameboy','keep');
  assert.equal(await page.evaluate(()=>window.__modeRegression.getEditorValue()),genesisSource,'Keep preserves even an untouched old mode default');
  await changeMode(page,'pc98','initial');
  await assertModeStarter(page,'pc98');
  await settleEditor(page);

  const customIndex='// My index must survive an explicit initial-code choice.\nconsole.log("CUSTOM_MODE_INDEX");\n';
  const reservedBackup='// A pre-existing backup must not be overwritten.\n';
  const runSource=`context.modeChoiceTicks=0;
context.modeChoiceKeyPresses=0;
onKeyboardPressKey('mode-choice-keys',event=>{context.modeChoiceKeyPresses++;event.preventDefault();});
liveLoop('mode-choice-running',async()=>{context.modeChoiceTicks++;await sleep(.03);});
console.log('MODE_CHOICE_RUNNING');\n`;
  const metadata={title:'Mode choice resources',license:'CC0-1.0'};
  // Seed the same one-shot handoff used by mode navigation. Restoring after
  // Monaco has mounted would replace multiple models within one synthetic task
  // and cancel its unrelated outstanding language requests.
  const token=await page.evaluate(async ({customIndex,reservedBackup,runSource,metadata})=>{
    const {saveModeProject}=await import('./playground_mode_project.js');
    return saveModeProject(indexedDB,'pc98',{version:1,modeId:'pc98',activePath:'/lib/running.js',runPath:'/lib/running.js',
      directories:['/','/assets','/assets/empty','/lib','/index-genesis-2.js'],metadata,hasMetadataFile:true,
      files:[{path:'/index.js',type:'text',data:customIndex},
        {path:'/index-genesis.js',type:'text',data:reservedBackup},
        {path:'/lib/running.js',type:'text',data:runSource},
        {path:'/assets/opaque.txt',type:'binary',data:new Uint8Array([0,255,128,13])},
        {path:'/NOTICE',type:'text',data:'Resource without an extension\n'},
        {path:'/metadata.json',type:'text',data:JSON.stringify(metadata)}]});
  },{customIndex,reservedBackup,runSource,metadata});
  await page.goto(`${base}?mode=pc98&modeProject=${encodeURIComponent(token)}&no-sw=1`);
  await settleEditor(page);
  await page.evaluate(()=>{document.getElementById('workerExecution').checked=false;});
  const runLoop=async()=>{
    await page.locator('#runButton').click();
    await page.waitForFunction(()=>window.__modeRegression.runtime.getState().playback==='running' &&
      window.__modeRegression.runtime.context.modeChoiceTicks>=2);
    await page.evaluate(()=>{
      window.__modeChoiceContext=window.__modeRegression.runtime.context;
      window.__modeChoiceSynth=window.__modeRegression.megaDrive;
    });
  };
  await runLoop();
  // The dialog must leave the current editor, file selections, runtime context
  // and liveLoop intact until the user chooses Initial or Keep.
  const before=await choiceProjectState(page),beforeUrl=page.url();
  const assertRunningUnchanged=async label=>{
    const ticks=await page.evaluate(()=>window.__modeRegression.runtime.context.modeChoiceTicks);
    await page.waitForFunction(previous=>window.__modeRegression.runtime.context.modeChoiceTicks>previous,ticks);
    const live=await page.evaluate(()=>({playback:window.__modeRegression.runtime.getState().playback,
      sameContext:window.__modeChoiceContext===window.__modeRegression.runtime.context,
      sameSynth:window.__modeChoiceSynth===window.__modeRegression.megaDrive,
      keyPresses:window.__modeRegression.runtime.context.modeChoiceKeyPresses}));
    assert.deepEqual(live,{playback:'running',sameContext:true,sameSynth:true,keyPresses:0},`${label}: current run remains alive and dialog keys do not reach it`);
    assert.equal(page.url(),beforeUrl,`${label}: does not navigate`);
    assert.deepEqual(await choiceProjectState(page),before,`${label}: does not save or replace project content`);
  };
  await beginModeChange(page,'gameboy');
  await assertRunningUnchanged('pending choice');
  const screenshot=`/private/tmp/playground-mode-choice-${browserName}.png`;
  await page.screenshot({path:screenshot});
  await finishModeChange(page,'gameboy','cancel');
  assert.equal(await page.locator('#playgroundMode').inputValue(),'pc98','Cancel restores the current mode selector');
  await page.waitForFunction(()=>document.activeElement===document.querySelector('#mainMenu > summary'));
  await assertRunningUnchanged('Cancel');

  await beginModeChange(page,'gameboy');
  await page.keyboard.press('q');
  await page.keyboard.press('Escape');
  await page.locator('#changeModeDialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('#playgroundMode').inputValue(),'pc98','Escape restores the current mode selector');
  await page.waitForFunction(()=>document.activeElement===document.querySelector('#mainMenu > summary'));
  await assertRunningUnchanged('Escape');

  await page.locator('#mainMenu > summary').click();
  await page.locator('#playgroundMode').selectOption('pc98');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#changeModeDialog').isVisible(),false,'Selecting the current mode does not open a dialog');
  await assertRunningUnchanged('same mode');

  await beginModeChange(page,'genesis');
  await assertRunningUnchanged('pending Keep');
  await finishModeChange(page,'genesis','keep');
  const kept=await choiceProjectState(page);
  const resources=state=>({files:state.files.filter(file=>['/assets/opaque.txt','/NOTICE','/metadata.json','/lib/running.js','/index-genesis.js'].includes(file.path)),
    metadata:state.metadata,hasMetadataFile:state.hasMetadataFile,
    empty:state.directories.includes('/assets/empty'),occupiedBackup:state.directories.includes('/index-genesis-2.js')});
  assert.deepEqual(resources(kept),resources(before),'Keep preserves binary/text resources, empty directories and metadata');
  assert.equal(kept.files.find(file=>file.path==='/index.js')?.data,customIndex,'Keep preserves custom index');
  assert.equal(kept.active,before.active,'Keep preserves active editor path');
  assert.equal(kept.run,before.run,'Keep preserves the selected Run path');
  assert.equal(kept.editor,runSource,'Keep preserves active editor content');
  assert.equal(await page.evaluate(()=>window.__modeRegression.runtime.getState().playback),'stopped','The new mode waits for Run');

  assert.equal(await page.locator('#openInitialCodeButton, #menuExamples').count(),0,'New Cassette is the sole fresh-project action');
  await runLoop();
  const beforeNew=await choiceProjectState(page);
  await openNewCassette(page);
  const liveNew=await page.evaluate(()=>({playback:window.__modeRegression.runtime.getState().playback,
    sameContext:window.__modeChoiceContext===window.__modeRegression.runtime.context}));
  assert.deepEqual(liveNew,{playback:'running',sameContext:true},'Opening New Cassette does not stop the current run');
  await page.locator('#newCassetteDialog button[value="cancel"]').click();
  await page.locator('#newCassetteDialog').waitFor({state:'hidden'});
  assert.deepEqual(await choiceProjectState(page),beforeNew,'Cancel New Cassette preserves files and selections');
  assert.equal(await page.evaluate(()=>window.__modeRegression.runtime.getState().playback),'running','Cancel New Cassette preserves playback');
  await beginModeChange(page,'gameboy');
  const pendingInitial=await page.evaluate(()=>({playback:window.__modeRegression.runtime.getState().playback,
    sameContext:window.__modeChoiceContext===window.__modeRegression.runtime.context}));
  assert.deepEqual(pendingInitial,{playback:'running',sameContext:true},'Initial remains a choice until the button is clicked');
  await finishModeChange(page,'gameboy','initial');
  await assertModeStarter(page,'gameboy');
  const initialized=await choiceProjectState(page);
  assert.deepEqual(resources(initialized),resources(before),'Initial preserves resources, metadata and non-index source files');
  const backups=initialized.files.filter(file=>file.path!=='/index.js' && file.data===customIndex);
  assert.equal(backups.length,1,'Initial preserves the custom index as a separate backup');
  assert.equal(initialized.files.find(file=>file.path==='/index-genesis.js')?.data,reservedBackup,'Initial preserves pre-existing backup content');
  assert.equal(await page.evaluate(()=>window.__modeRegression.runtime.getState().playback),'stopped','Initial stops the previous run and does not autoplay');
  assert(!/\[error\]|(?:Reference|Syntax|Type)Error:/.test(await page.locator('#consoleOutput').textContent()),'Mode choices leave no runtime console error');
  await openNewCassette(page);
  await page.locator('#newCassetteDialog button[value="new"]').click();
  await page.waitForFunction(()=>!window.__modeRegression.virtualFiles.has('/assets/opaque.txt'));
  await settleEditor(page);
  const fresh=await choiceProjectState(page);
  const expected=await page.evaluate(async()=>(await import('./playground_examples.js')).MODE_DEFAULT_CODES.gameboy);
  assert.equal(fresh.editor,expected,'New Cassette opens the selected mode initial code');
  assert.equal(fresh.active,'/index.js');assert.equal(fresh.run,'/index.js');
  assert.equal(fresh.metadata,null);assert.equal(fresh.hasMetadataFile,false);
  assert(!fresh.files.some(file=>file.data===customIndex),'Confirmed New Cassette resets the old project');
  console.log(JSON.stringify({browser:browserName,modeChoices:true,initial:true,keep:true,cancel:true,escape:true,sameMode:true,
    untouchedDefaultKept:true,activeRunPreservedUntilChoice:true,dialogKeyboardIsolated:true,cancelFocusRestored:true,
    activeRunPathKept:true,customIndexBackup:backups[0].path,
    binaryDirectoriesMetadata:true,newCassetteCancelPreservesRun:true,newCassetteResetsProject:true,screenshot,passed:true}));
}

async function checkStarterLegacyDraft(browser, base) {
  const context = await browser.newContext({serviceWorkers:'block'});
  await context.addInitScript(() => {window.__TAURI_INTERNALS__ = {};});
  const page = await context.newPage(), errors = [];
  page.on('pageerror',error => errors.push(error.message));
  try {
    await page.goto(new URL('/index.html?no-sw=1',base).href);
    const legacySource=await page.evaluate(async () => {
      const {openDraftStore} = await import('./playground/playground_autosave.js');
      const {DEFAULT_CODE,EXAMPLE_FILES} = await import('./playground/playground_examples.js');
      const store = await openDraftStore(indexedDB,'mode:gameboy');
      try {await store.save({version:1,activePath:'/index.js',runPath:'/index.js',directories:['/'],files:[
        {path:'/index.js',type:'text',data:DEFAULT_CODE},...EXAMPLE_FILES.map(file => ({...file,type:'text'}))]});}
      finally {store.close();}
      return DEFAULT_CODE;
    });
    await page.goto(`${base}?mode=gameboy&no-sw=1`); await ready(page);
    assert.equal(await page.evaluate(()=>window.__modeRegression.getEditorValue()),legacySource,'legacy default draft is kept on restore');
    const custom = '// A custom FM draft must survive restore.\nfm.keyOff(0);\n';
    await page.evaluate(async custom => {window.__modeRegression.setEditorValue(custom); await window.__tetoricaAutosaveFlush();},custom);
    await page.reload(); await ready(page);
    assert.equal(await page.evaluate(() => window.__modeRegression.getEditorValue()),custom,'custom FM draft is preserved');
    for (const id of ['pc98','pc98-26','neogeo','snes','pc-engine']) {
      const historicalSource=await page.evaluate(async id => {
        const {openDraftStore} = await import('./playground_autosave.js');
        const {MODE_DEFAULT_HISTORY} = await import('./playground_examples.js?v=starter-history-1');
        const store = await openDraftStore(indexedDB,`mode:${id}`);
        try {await store.save({version:1,modeId:id,activePath:'/index.js',runPath:'/index.js',directories:['/'],
          files:[{path:'/index.js',type:'text',data:MODE_DEFAULT_HISTORY[id][0]}]});}
        finally {store.close();}
        return MODE_DEFAULT_HISTORY[id][0];
      },id);
      await page.goto(`${base}?mode=${id}&no-sw=1`); await ready(page);
      const restored=await page.evaluate(()=>({source:window.__modeRegression.getEditorValue(),
        index:window.__modeRegression.virtualFiles.get('/index.js')?.data}));
      assert.deepEqual(restored,{source:historicalSource,index:historicalSource},`${id}: historical starter is kept on restore`);
    }
    assert.deepEqual(errors,[],'legacy starter draft page errors');
    console.log(JSON.stringify({starters:true,legacyDefaultPreserved:true,historicalModes:5,customDraftPreserved:true,passed:true}));
  } finally {await context.close();}
}

async function checkBrowser(name, type, base) {
  const browser = await type.launch({headless:true, ...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  const context = await browser.newContext({serviceWorkers:'block', viewport:{width:1320, height:960}});
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push({message:error.message,stack:error.stack,url:page.url()}));
  const startersOnly = process.argv.includes('--starters-only');
  const modeChoiceOnly=process.argv.includes('--mode-choice-only');
  const tabsOnly = process.argv.includes('--tabs-only');
  const typesOnly = process.argv.includes('--types-only');
  const opnaOnly = process.argv.includes('--opna-only');
  const opnbOnly = process.argv.includes('--opnb-only');
  const opnbExampleOnly = process.argv.includes('--opnb-example-only');
  const ym2203Only = process.argv.includes('--ym2203-only');
  const gameboyOnly = process.argv.includes('--gameboy-only');
  const sectionsOnly = opnaOnly || opnbOnly || opnbExampleOnly || ym2203Only;
  const starterModeIds = process.argv.find(arg => arg.startsWith('--starter-modes='))?.split('=')[1].split(',');
  const selectedModes = startersOnly && starterModeIds ? modes.filter(mode => starterModeIds.includes(mode.id)) : process.argv.includes('--project-only') ? [] : gameboyOnly
    ? modes.filter(mode => mode.chip === 'gameboy') : ym2203Only
    ? modes.filter(mode => mode.chip === 'ym2203') : opnbExampleOnly
    ? modes.filter(mode => ['ym2610', 'ym2610b'].includes(mode.chip)) : modes;
  try {
    if(process.argv.includes('--menu-only')){
      await checkMenuAudio(page,base,name);
      await checkMenuLayout(page,base,name);
      assert.deepEqual(errors,[],`${name}: menu page errors`);
      console.log(JSON.stringify({browser:name,menuAudio:true,pageErrors:0,passed:true}));return;
    }
    if(modeChoiceOnly){
      await checkModeChoices(page,base,name);
      await checkStarterLegacyDraft(browser,base);
      assert.deepEqual(errors,[],`${name}: mode choice page errors`);
      console.log(JSON.stringify({browser:name,modeChoices:true,legacyDraftsPreserved:true,pageErrors:0,passed:true}));
      return;
    }
    for (const mode of selectedModes) {
      await page.goto(`${base}?mode=${mode.id}&no-sw=1`); await ready(page);
      assert.equal(await page.title(), `Tetorica ${mode.label} Playground`);
      assert.equal(await page.locator('#playgroundMode').inputValue(), mode.id);
      assert.deepEqual(await page.locator('#playgroundMode option').evaluateAll(options => options.map(option => option.value)), [...modes.map(mode => mode.id),'nes','snes','x68000','pc-engine']);
      if (startersOnly) {
        const files = await checkStarterCatalog(page,mode);
        await checkStarterAudio(page,name,mode,files);
        continue;
      }
      if (!typesOnly && !sectionsOnly) await checkChipTabs(page, mode);
      let typeHovers;
      if (!tabsOnly) {
        if (!opnbExampleOnly) typeHovers = await checkTypes(page, mode);
        if (!typesOnly && !sectionsOnly) {
          if (mode.chip === 'gameboy') await checkGameboyAudio(page, name);
          else await checkAudio(page, mode);
        }
      }
      if (!typesOnly && !sectionsOnly) await checkAdditionalChipTabs(page, mode);
      if (!typesOnly && !tabsOnly && !opnaOnly && !opnbOnly && !opnbExampleOnly && mode.id === 'pc98-26') await checkYm2203Ssg(page, name);
      if (!typesOnly && !tabsOnly && !opnbOnly && !opnbExampleOnly && !ym2203Only && mode.id === 'pc98') await checkOpnaSections(page, name);
      if (!typesOnly && !tabsOnly && !opnaOnly && !ym2203Only && ['ym2610', 'ym2610b'].includes(mode.chip)) await checkOpnbSections(page, name, mode, {exampleOnly:opnbExampleOnly});
      if (!typesOnly && !sectionsOnly && mode.id === 'pc98' && name === 'chromium') await page.screenshot({path:'/private/tmp/playground-mode-tabs.png'});
      if (tabsOnly) console.log(JSON.stringify({browser:name, mode:mode.id, chipTabs:true, keyboardNavigation:true, passed:true}));
      if (typesOnly) console.log(JSON.stringify({browser:name, mode:mode.id, hovers:typeHovers, passed:true}));
    }
    if (startersOnly) {
      await checkStarterTransfer(page,base);
      await checkStarterLegacyDraft(browser,base);
      assert.deepEqual(errors,[],`${name}: starter page errors`);
      console.log(JSON.stringify({browser:name,starters:true,modes:selectedModes.length,passed:true}));
      return;
    }
    if (!tabsOnly && !typesOnly && !sectionsOnly && gameboyOnly) await checkGameboyProjectSwitch(page, base);
    if (!tabsOnly && !typesOnly && !sectionsOnly && !gameboyOnly) {
      await checkProjectSwitch(page, base, name === 'chromium');
      await checkLegacyAndLayout(page, base);
      await checkDesktopAutosave(browser, base);
    }
    assert.deepEqual(errors, [], `${name}: page errors`);
    console.log(JSON.stringify({browser:name, passed:true, modes:selectedModes.length,
      chipTabs:!typesOnly && !sectionsOnly && !process.argv.includes('--project-only'),
      gameboy:!tabsOnly && !typesOnly && !sectionsOnly && !process.argv.includes('--project-only'),
      ym2203Ssg:!tabsOnly && !typesOnly && !opnaOnly && !opnbOnly && !opnbExampleOnly && !gameboyOnly && !process.argv.includes('--project-only'),
      opnaSections:!tabsOnly && !typesOnly && !opnbOnly && !opnbExampleOnly && !ym2203Only && !gameboyOnly && !process.argv.includes('--project-only'),
      opnbSections:!tabsOnly && !typesOnly && !opnaOnly && !opnbExampleOnly && !ym2203Only && !gameboyOnly && !process.argv.includes('--project-only'),
      opnbExamples:!tabsOnly && !typesOnly && !opnaOnly && !ym2203Only && !gameboyOnly && !process.argv.includes('--project-only'),
      projectSwitch:!tabsOnly && !typesOnly && !sectionsOnly, fileTypes:!tabsOnly && !typesOnly && !sectionsOnly,
      desktopAutosave:!tabsOnly && !typesOnly && !sectionsOnly && !gameboyOnly, legacyUrls:!tabsOnly && !typesOnly && !sectionsOnly && !gameboyOnly,
      simpleLayout:!tabsOnly && !typesOnly && !sectionsOnly && !gameboyOnly}));
  } catch (error) {
    await page.screenshot({path:`/private/tmp/playground-mode-failure-${name}.png`}).catch(()=>{});
    console.error(JSON.stringify({browser:name, url:page.url(), status:await page.locator('#status').textContent().catch(() => null),
      console:await page.locator('#consoleOutput').textContent().catch(() => null), errors,
      starterMeter:await page.evaluate(() => window.__starterMeter && {peak:window.__starterMeter.peak,lastPeak:window.__starterMeter.lastPeak}).catch(() => null)}));
    throw error;
  } finally {await context.close(); await browser.close();}
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/playground/index.html`;
    if (!process.argv.includes('--webkit-only')) await checkBrowser('chromium', chromium, base);
    if (process.argv.includes('--webkit') || process.argv.includes('--webkit-only')) await checkBrowser('webkit', webkit, base);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
