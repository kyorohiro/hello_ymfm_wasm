// Real Playground Main/Worker -> DX7 WASM Worklet -> mixer -> FX/master output.
// Self-hosts docs; DX7_TEST_URL can point at the flattened packaged Playground.
// --stage release/itch_playground_dx7-dev serves and checks a flattened stage.
const {chromium, webkit, firefox} = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const assert = require('node:assert/strict');

function observeDX7Nodes() {
  const nodes = globalThis.__dx7NodeLifecycle = [];
  globalThis.AudioWorkletNode = new Proxy(globalThis.AudioWorkletNode, {
    construct(Type, args, Target) {
      const node = Reflect.construct(Type, args, Target);
      if (args[1] === 'tetorica-playground-dx7') {
        const state = {disposeSent:false, closed:false};
        const send = node.port.postMessage.bind(node.port), close = node.port.close.bind(node.port);
        node.port.postMessage = (data, ...transfer) => {
          if (data?.method === 'dispose') state.disposeSent = true;
          return send(data, ...transfer);
        };
        node.port.close = () => { state.closed = true; return close(); };
        nodes.push(state);
      }
      return node;
    },
  });
}

const root = path.resolve(__dirname, '..');
const docs = path.join(root, 'docs');
const stageOption = process.argv.indexOf('--stage');
if (stageOption !== -1 && !process.argv[stageOption + 1]) throw Error('--stage requires a directory');
const servedRoot = stageOption === -1 ? docs : path.resolve(root, process.argv[stageOption + 1]);
const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.wasm':'application/wasm', '.json':'application/json', '.svg':'image/svg+xml'};
const accessor = '\nwindow.__dx7Test={runtime,megaDrive};';
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.resolve(servedRoot, '.' + pathname);
    if (!file.startsWith(servedRoot + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    let body = await fs.readFile(file);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() + accessor);
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch (error) { response.writeHead(404).end(String(error)); }
});

async function checkStopDuringInitialization(browser, url, execution) {
  // A fresh realm avoids the app-owned WASM cache and makes this race deterministic.
  const page = await browser.newPage({serviceWorkers:'block'}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let releaseFetch, requestedResolve;
  const requested = new Promise(resolve => { requestedResolve = resolve; });
  const released = new Promise(resolve => { releaseFetch = resolve; });
  try {
    if (process.env.DX7_TEST_URL) await page.route('**/playground.js?*', async route => {
      const response = await route.fetch(); await route.fulfill({response, body:await response.text() + accessor});
    });
    await page.route('**/msfa_dx7/wasm/msfa.wasm', async route => {
      requestedResolve(); await released; await route.continue();
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__dx7Test && window.monaco?.editor?.getEditors().length);
    // The real editor must know both the new methods and nested DX7 fields.
    const completion = await page.evaluate(async () => {
      const source = "async function objectVoice() {\nconst dx7 = await useSoundChip('dx7');\nawait dx7.setOperator(1, {  });\nawait dx7.setPreset({});\ndx7.\n}";
      const model = monaco.editor.createModel(source,'javascript',monaco.Uri.parse('file:///dx7-object-completion.js'));
      try {
        const getWorker = await monaco.languages.typescript.getJavaScriptWorker();
        const worker = await getWorker(model.uri);
        const uri = model.uri.toString();
        const methods = await worker.getCompletionsAtPosition(uri,source.indexOf('dx7.\n')+4);
        const fields = await worker.getCompletionsAtPosition(uri,source.indexOf('{  }')+2);
        const hover = await worker.getQuickInfoAtPosition(uri,source.indexOf('setPreset')+2);
        return {methods:methods?.entries.map(entry=>entry.name),fields:fields?.entries.map(entry=>entry.name),hover:hover?.displayParts.map(part=>part.text).join('')};
      } finally {model.dispose();}
    });
    for(const method of ['setPreset','setOperator','setOperators','setFeedback','getPreset'])assert(completion.methods?.includes(method),'Missing Monaco DX7 completion: '+method);
    for(const field of ['coarse','fine','outputLevel','envelope'])assert(completion.fields?.includes(field),'Missing Monaco DX7 field: '+field);
    assert(completion.hover?.includes('DX7Preset'),'Missing typed DX7 preset hover');
    await page.evaluate(execution => {
      document.getElementById('workerExecution').checked = execution === 'worker';
      window.monaco.editor.getEditors()[0].setValue("const dx7 = await useSoundChip('dx7'); dx7.noteOn(60, 100); console.log('DX7_LATE_NOTE');");
    }, execution);
    await page.click('#runButton');
    let timeout;
    try { await Promise.race([requested, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('DX7 WASM initialization was not requested')), 15000); })]); }
    finally { clearTimeout(timeout); }
    await page.evaluate(() => window.__dx7Test.runtime.stop());
    releaseFetch();
    await page.waitForFunction(() => !document.getElementById('runButton').disabled);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.__dx7Test.megaDrive.mixer.list().filter(chip => chip.name === 'dx7' && chip.connected).length), 0, `${execution}: STOP during init left a connected DX7`);
    assert.equal(await page.evaluate(() => document.getElementById('consoleOutput').textContent.includes('DX7_LATE_NOTE')), false, `${execution}: cancelled initialization played a late note`);
    await page.evaluate(async execution => {
      await window.__dx7Test.runtime.playSource("const dx7 = await useSoundChip('dx7'); dx7.noteOn(60,100); console.log('DX7_INIT_RECOVERED');", {execution});
    }, execution);
    await page.waitForFunction(() => document.getElementById('consoleOutput').textContent.includes('DX7_INIT_RECOVERED'));
    assert.equal(await page.evaluate(() => window.__dx7Test.megaDrive.mixer.list().filter(chip => chip.name === 'dx7' && chip.connected).length), 1, `${execution}: cannot recreate after STOP during init`);
    await page.evaluate(async () => window.__dx7Test.runtime.stopWithFade());
    assert.deepEqual(errors, []);
  } finally { releaseFetch(); await page.close(); }
}

async function runBrowser(name, type, url, fixture) {
  const browser = await type.launch({headless:true, ...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const page = await browser.newPage({serviceWorkers:'block'}), errors = [], network = [], results = [];
    await page.addInitScript(observeDX7Nodes);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('dx7-should-not-request')) network.push(request.url()); });
    if (process.env.DX7_TEST_URL) await page.route('**/playground.js?*', async route => {
      const response = await route.fetch();
      await route.fulfill({response, body:await response.text() + accessor});
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__dx7Test && window.monaco?.editor?.getEditors().length);
    // A real Run click supplies the WebKit user gesture; keep execution guards enabled.
    await page.evaluate(() => {
      document.getElementById('workerExecution').checked = false;
      window.monaco.editor.getEditors()[0].setValue('await sleep(.01);');
    });
    await page.click('#runButton');
    await page.waitForFunction(() => !document.getElementById('runButton').disabled);
    await page.evaluate(() => {
      const {megaDrive} = window.__dx7Test, context = megaDrive.audioContext;
      const splitter = context.createChannelSplitter(2), meters = [context.createAnalyser(), context.createAnalyser()];
      const silent = context.createGain(); silent.gain.value = 0; silent.connect(context.destination);
      for (let channel = 0; channel < 2; channel++) {
        meters[channel].fftSize = 2048;
        splitter.connect(meters[channel], channel); meters[channel].connect(silent);
      }
      const detach = megaDrive.audio.connectOutputMonitor(splitter);
      window.__dx7Meters = {meters, splitter, silent, detach};
    });
    let serial = 0, activeExecution = 'main';
    const run = async (source, execution) => {
      activeExecution = execution;
      const token = `DX7_RESULT_${++serial}:`;
      await page.evaluate(async ({source, execution, token}) => {
        await window.__dx7Test.runtime.playSource(source + `\nconsole.log(${JSON.stringify(token)} + JSON.stringify(typeof result === 'undefined' ? {} : result));`, {execution});
      }, {source, execution, token});
      await page.waitForFunction(token => document.getElementById('consoleOutput').textContent.includes(token), token);
      return page.evaluate(token => {
        const text = document.getElementById('consoleOutput').textContent;
        const line = text.slice(text.lastIndexOf(token) + token.length).split('\n')[0];
        return JSON.parse(line);
      }, token);
    };
    const meter = async () => {
      const lead = activeExecution === 'worker' ? await page.evaluate(() => window.__dx7Test.runtime.getTiming().workerLookaheadSeconds * 1000) : 0;
      // Setters acknowledge acceptance. Wait for the configured audio reservation
      // and analyser window before measuring the changed waveform.
      await page.waitForTimeout(100 + lead);
      const samples = [];
      for (let i = 0; i < 3; i++) {
        samples.push(await page.evaluate(() => window.__dx7Meters.meters.map(meter => {
          const pcm = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(pcm);
          return Math.sqrt(pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length);
        })));
        await page.waitForTimeout(20);
      }
      return [0, 1].map(channel => samples.reduce((sum, frame) => sum + frame[channel], 0) / samples.length);
    };
    const closeTo = (actual, expected, message, tolerance = .08) => assert(Math.abs(actual / expected - 1) < tolerance, `${name}: ${message}: ${actual} expected ${expected}`);
    const single = `new Uint8Array(${JSON.stringify(fixture.single)})`;
    const bank = `new Uint8Array(${JSON.stringify(fixture.bank)})`;
    const silentVoice = `new Uint8Array(${JSON.stringify(fixture.silent)})`;
    for (const execution of ['main', 'worker']) {
      await page.evaluate(async () => window.__dx7Test.runtime.stopWithFade());
      const initial = await run(`
        let blocked = false;
        try { await fetch('https://example.com/dx7-should-not-request'); } catch (error) { blocked = /Network access is disabled/.test(error.message); }
        if (!blocked) throw Error('Execution network guard was bypassed');
        const dx7 = await useSoundChip('dx7');
        const again = await useSoundChip('dx7');
        if (dx7 !== again) throw Error('useSoundChip did not reuse DX7');
        await dx7.loadSysex(${single});
        dx7.selectVoice(0); dx7.noteOn(60, 100);
        context.dx7 = dx7; context.initialId = dx7.id;
        const result = {id:dx7.id, voices:dx7.voices, state:await dx7.getState()};
      `, execution);
      assert.equal(initial.id, 'dx7:shared');
      assert.equal(initial.voices.length, 1); assert.equal(initial.voices[0].name, 'TEST SINE');
      assert.equal(initial.state.internalSampleRate, 44100);
      assert([44100, 48000].includes(initial.state.sampleRate));
      const baseline = await meter();
      assert(baseline.every(value => value > .005), `${name}/${execution}: DX7 final output is silent ${baseline}`);
      closeTo(baseline[0], baseline[1], 'stereo mono duplication');
      const reuse = await run(`
        const dx7 = await useSoundChip('dx7');
        const result = {same:context.dx7 === dx7, id:dx7.id, voices:dx7.voices};
      `, execution);
      assert.equal(reuse.same, true); assert.equal(reuse.id, initial.id); assert.equal(reuse.voices.length, 1);
      const independent = await run(`
        const independent = await createSoundChip('dx7', {id:'dx7-test-independent'});
        let collision = false;
        try { await createSoundChip('dx7', {id:'dx7-test-independent'}); } catch { collision = true; }
        if (!collision) throw Error('Duplicate mixer id accepted');
        const result = {id:independent.id, voices:independent.voices, chips:(await mixer.list()).filter(chip => chip.name === 'dx7')};
        await independent.loadSysex(${silentVoice}); independent.noteOn(60,100);
        context.independent = independent;
      `, execution);
      assert.equal(independent.id, 'dx7-test-independent'); assert.equal(independent.chips.length, 2);
      assert.equal(independent.voices[0].name, 'INIT SINE');
      const isolated = await meter(); closeTo(isolated[0], baseline[0], 'independent bank does not change shared PCM');
      await run(`
        (await useSoundChip('dx7')).panic();
        if (context.independent.voices[0].name !== 'SILENT') throw Error('Shared bank leaked into independent instance');
      `, execution);
      assert((await meter()).every(value => value < .00001), `${name}/${execution}: independent silent voice inherited shared sound`);
      await run(`context.independent.dispose(); (await useSoundChip('dx7')).noteOn(60,100);`, execution);
      await run(`mixer.set(context.initialId, {pan:-1});`, execution);
      const left = await meter(); assert(left[0] > .005 && left[1] < .00001, `${name}/${execution}: left pan ${left}`);
      await run(`mixer.set(context.initialId, {pan:1});`, execution);
      const right = await meter(); assert(right[1] > .005 && right[0] < .00001, `${name}/${execution}: right pan ${right}`);
      await run(`mixer.set(context.initialId, {pan:0, volume:.5});`, execution);
      const half = await meter(); closeTo(half[0], baseline[0] * .5, 'chip volume');
      await run(`mixer.set(context.initialId, {muted:true});`, execution);
      const muted = await meter(); assert(muted.every(value => value < .00001), `${name}/${execution}: mute ${muted}`);
      await run(`mixer.set(context.initialId, {muted:false, volume:1}); setMasterVolume(.25);`, execution);
      const master = await meter(); closeTo(master[0], baseline[0] * .25, 'master volume');
      await run(`setMasterVolume(1); fx.setChain([fx.gain({gain:.2})]);`, execution);
      const fx = await meter(); closeTo(fx[0], baseline[0] * .2, 'DX7 enters final FX chain');
      const loaded = await run(`
        const dx7 = await useSoundChip('dx7');
        dx7.panic(); await dx7.loadSysex(${bank}); dx7.selectVoice(31);
        const before = dx7.voices;
        let rejected = false;
        try { await dx7.loadSysex(new Uint8Array([0xf0, 0x43, 0xf7])); } catch { rejected = true; }
        if (!rejected || JSON.stringify(before) !== JSON.stringify(dx7.voices) || dx7.selectedVoice !== 31) throw Error('Invalid load changed active bank');
        dx7.noteOn(67,100);
        const result = {voices:dx7.voices, selected:dx7.selectedVoice};
      `, execution);
      assert.equal(loaded.voices.length, 32); assert.equal(loaded.voices[31].name, 'BANK 31'); assert.equal(loaded.selected, 31);
      assert((await meter()).every(value => value > .005), `${name}/${execution}: bank selection then noteOn silent`);
      const object = await run(`
        const dx7 = await useSoundChip('dx7'); dx7.panic();
        const bankBefore = dx7.voices;
        await dx7.setPreset({name:'OBJ', algorithm:31, operators:{1:{coarse:2, outputLevel:90}}});
        await dx7.setOperator(1, {fine:12});
        await dx7.setOperators([[1,{detune:8}], [6,{coarse:3, outputLevel:0}]]);
        const beforeInvalid = await dx7.getPreset();
        let rejected = false;
        try { await dx7.setOperators([[1,{outputLevel:0}], [6,{coarse:32}]]); }
        catch { rejected = true; }
        if (!rejected || JSON.stringify(beforeInvalid) !== JSON.stringify(await dx7.getPreset())) throw Error('Invalid operator batch changed the patch');
        const after = dx7.voices;
        if (after.length !== 32 || dx7.selectedVoice !== 31 || bankBefore.some((voice,index) => index !== 31 && voice.name !== after[index].name)) throw Error('Object edit replaced another bank slot');
        dx7.selectVoice(0);
        const other = await dx7.getPreset();
        dx7.selectVoice(31);
        const preset = await dx7.getPreset();
        const exposed = await dx7.getPreset(); exposed.operators[1].coarse = 31;
        if ((await dx7.getPreset()).operators[1].coarse !== 2) throw Error('getPreset leaked mutable state');
        dx7.noteOn(60,100);
        const result = {id:dx7.id, same:dx7 === context.dx7, voices:dx7.voices, selected:dx7.selectedVoice, preset, other, rejected};
      `, execution);
      assert.equal(object.same, true); assert.equal(object.id, initial.id);
      assert.equal(object.selected, 31); assert.equal(object.voices.length, 32); assert.equal(object.voices[31].name, 'OBJ');
      assert.equal(object.other.name, 'BANK 0'); assert.equal(object.other.operators[1].coarse, 1);
      assert.equal(object.preset.name, 'OBJ'); assert.equal(object.preset.algorithm, 31);
      assert.equal(object.preset.operators[1].coarse, 2); assert.equal(object.preset.operators[1].outputLevel, 90);
      assert.equal(object.preset.operators[1].fine, 12); assert.equal(object.preset.operators[1].detune, 8);
      assert.equal(object.preset.operators[6].coarse, 3); assert.equal(object.rejected, true);
      const objectPcm = await meter();
      assert(objectPcm.every(value => value > .005), `${name}/${execution}: object-authored DX7 patch is silent ${objectPcm}`);
      // The real editor's Main and Worker bridges must reach currently sounding
      // notes, not just the next Note On's stored preset.
      await run(`
        const dx7=await useSoundChip('dx7'); dx7.panic();
        await dx7.setPreset({name:'LIVE',algorithm:31,operators:{1:{coarse:1,fine:0,detune:7,outputLevel:90}}});
        dx7.noteOn(69,100);
      `, execution);
      const liveHeld = await meter();
      const frequency = () => page.evaluate(() => {
        const meter=window.__dx7Meters.meters[0],pcm=new Float32Array(meter.fftSize),crossings=[];
        meter.getFloatTimeDomainData(pcm);
        for(let i=1;i<pcm.length;i++) if(pcm[i-1]<=0&&pcm[i]>0) crossings.push(i-1-pcm[i-1]/(pcm[i]-pcm[i-1]));
        return crossings.length>1 ? window.__dx7Test.megaDrive.audioContext.sampleRate*(crossings.length-1)/(crossings.at(-1)-crossings[0]) : 0;
      });
      const liveInitialHz = await frequency();
      await run(`await (await useSoundChip('dx7')).setOperator(1,{coarse:2});`, execution);
      await meter();
      const liveOctaveHz = await frequency();
      assert(Math.abs(liveInitialHz / 440 - 1) < .03 && Math.abs(liveOctaveHz / 880 - 1) < .03, `${name}/${execution}: live frequency ${liveInitialHz} -> ${liveOctaveHz}`);
      await run(`await (await useSoundChip('dx7')).setOperators([[1,{outputLevel:0}],[6,{fine:12}]]);`, execution);
      const liveMuted = await meter();
      assert(liveMuted.every((value,channel)=>value < liveHeld[channel]*.002), `${name}/${execution}: live Output Level zero retained held audio ${liveMuted}`);
      const liveFeedback = await run(`
        const dx7=await useSoundChip('dx7'); await dx7.setFeedback(7);
        await dx7.setOperator(1,{outputLevel:90}); const result={feedback:(await dx7.getPreset()).feedback};
      `, execution);
      assert.equal(liveFeedback.feedback, 7, `${name}/${execution}: Feedback acknowledgement`);
      const liveRestored = await meter();
      assert(liveRestored.every((value,channel)=>value > liveHeld[channel]*.8), `${name}/${execution}: live Output Level did not restore held audio ${liveRestored}`);
      await run(`
        const dx7 = await useSoundChip('dx7'); dx7.panic();
        await dx7.loadSysex(${silentVoice});
        const loading = dx7.loadSysex(${single});
        dx7.noteOn(60,100); // Even without awaiting the upload first, the port is FIFO.
        await loading; await dx7.getState();
      `, execution);
      assert((await meter()).every(value => value > .005), `${name}/${execution}: noteOn overtook the SysEx upload`);
      await run(`(await useSoundChip('dx7')).noteOff(60); await sleep(.5);`, execution);
      assert((await meter()).every(value => value < .0001), `${name}/${execution}: noteOff did not release the voice`);
      await run(`const dx7=await useSoundChip('dx7'); dx7.noteOn(60,100); dx7.noteOn(64,100); await sleep(.05); dx7.allNotesOff(); await sleep(.5);`, execution);
      assert((await meter()).every(value => value < .0001), `${name}/${execution}: allNotesOff did not release voices`);
      await run(`(await useSoundChip('dx7')).noteOn(67,100);`, execution);
      const beforeStop = await page.evaluate(() => window.__dx7NodeLifecycle.length);
      await page.evaluate(async () => window.__dx7Test.runtime.stopWithFade());
      const stopped = await meter(); assert(stopped.every(value => value < .00001), `${name}/${execution}: STOP retained audio ${stopped}`);
      assert.equal(await page.evaluate(() => window.__dx7NodeLifecycle.every(node => node.disposeSent && node.closed)), true, 'STOP disposes the DX7 processors and closes their ports');
      assert.equal(await page.evaluate(() => window.__dx7Test.megaDrive.mixer.list().filter(chip => chip.name === 'dx7' && chip.connected).length), 0);
      const recreated = await run(`const dx7 = await useSoundChip('dx7'); dx7.noteOn(60,100); const result = {id:dx7.id, voices:dx7.voices, preset:await dx7.getPreset()};`, execution);
      assert.equal(recreated.id, initial.id, 'the shared mixer identity survives Stop, independently of the audio instance');
      assert.deepEqual(await page.evaluate(() => ({count:window.__dx7NodeLifecycle.length, current:window.__dx7NodeLifecycle.at(-1)})), {count:beforeStop + 1, current:{disposeSent:false, closed:false}}, 'Run after STOP creates a fresh DX7 Worklet');
      assert.equal(recreated.voices[0].name, 'INIT SINE');
      assert.equal(recreated.preset.operators[1].coarse, 1); assert.equal(recreated.preset.operators[1].outputLevel, 85);
      assert((await meter()).every(value => value > .005), `${name}/${execution}: recreation after STOP silent`);
      const cancelled = await run(`
        const dx7 = await createSoundChip('dx7');
        const pending = dx7.loadSysex(${bank}); dx7.dispose();
        let rejected = false; try { await pending; } catch { rejected = true; }
        const result = {rejected};
      `, execution);
      assert.equal(cancelled.rejected, true, 'Dispose rejects an in-flight SysEx request');
      await page.evaluate(async () => window.__dx7Test.runtime.stopWithFade());
      results.push({execution, sampleRate:initial.state.sampleRate, baseline, half, master, fx, objectPcm, liveHeld, liveMuted, liveRestored, liveInitialHz, liveOctaveHz, stopped});
    }
    assert.deepEqual(network, [], 'User network requests remain blocked');
    assert.deepEqual(errors, []);
    await page.evaluate(() => { const {detach, splitter, meters, silent} = window.__dx7Meters; detach(); splitter.disconnect(); meters.forEach(node => node.disconnect()); silent.disconnect(); });
    for (const execution of ['main', 'worker']) await checkStopDuringInitialization(browser, url, execution);
    console.log(JSON.stringify({browser:name, passed:true, results}));
  } finally { await browser.close(); }
}

(async () => {
  const {createInitVoice, createVoiceSysex, createBankSysex} = await import(pathToFileURL(path.join(root, 'web/msfa_dx7/src/sysex.js')).href);
  const fixture = {
    single:Array.from(createVoiceSysex(createInitVoice('TEST SINE'))),
    bank:Array.from(createBankSysex(Array.from({length:32}, (_, index) => createInitVoice(`BANK ${index}`)))),
  };
  const silentVoice = createInitVoice('SILENT'); silentVoice[5 * 21 + 16] = 0;
  fixture.silent = Array.from(createVoiceSysex(silentVoice));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = process.env.DX7_TEST_URL || `http://127.0.0.1:${server.address().port}/${stageOption === -1 ? 'playground/' : ''}index.html`;
    const types = {chromium, webkit, firefox};
    for (const name of (process.env.DX7_TEST_BROWSERS || 'chromium,webkit').split(',')) {
      if (!types[name]) throw Error(`Unknown browser ${name}`);
      await runBrowser(name, types[name], url, fixture);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
