// Real normal-Playground C64 integration. All physical audio paths end in gain 0.
const {chromium, webkit} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {createHash} = require('node:crypto');

const config = {root: path.resolve(__dirname, '../docs'), out: '/private/tmp/tetorica-playground-sid-browser.json', screenshots: null, chromiumOnly: false};
for (let i = 2; i < process.argv.length; ++i) {
  const name = process.argv[i];
  if (name === '--chromium-only') { config.chromiumOnly = true; continue; }
  assert(['--root', '--out', '--screenshots'].includes(name), `Unknown option ${name}`);
  const value = process.argv[++i]; assert(value && !value.startsWith('--'), `Missing ${name}`); config[name.slice(2)] = path.resolve(value);
}
const report = {schemaVersion: 1, passed: false, checker: 'scripts/check_playground_sid_browser.cjs',
  physicalOutputMuted: true, listeningPerformed: false, results: []};
const mime = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml'};
const difference = (a, b) => { let distance = 0, total = 0; for (let i = 0; i < a.length; ++i) { distance += Math.abs(a[i] - b[i]); total += a[i] + b[i]; } return total ? distance / total : 0; };

function instrument() {
  const audit = window.__sidAudit = {contexts: [], worklets: [], workers: [], sinks: [], processorErrors: []};
  const Context = window.AudioContext ?? window.webkitAudioContext, Worklet = window.AudioWorkletNode, WorkerClass = window.Worker;
  const connect = AudioNode.prototype.connect;
  window.AudioContext = class extends Context { constructor(...args) { super(...args); audit.contexts.push(this); } };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.Worker = class extends WorkerClass { constructor(url, ...args) { super(url, ...args); audit.workers.push(String(url)); } };
  window.AudioWorkletNode = class extends Worklet { constructor(context, name, ...args) { super(context, name, ...args); audit.worklets.push({name, node: this}); this.addEventListener('processorerror', () => audit.processorErrors.push(name)); } };
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination === this.context.destination) {
      let sink = audit.sinks.find(value => value.context === this.context);
      if (!sink) {
        const analyser = this.context.createAnalyser(), finalGain = this.context.createGain();
        analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0; finalGain.gain.value = 0;
        connect.call(analyser, finalGain); connect.call(finalGain, destination);
        sink = {context: this.context, analyser, finalGain}; audit.sinks.push(sink);
      }
      connect.call(this, sink.analyser, ...args); return destination;
    }
    return connect.call(this, destination, ...args);
  };
  audit.sample = () => audit.sinks.map(({context, analyser, finalGain}) => {
    const pcm = new Float32Array(analyser.fftSize), db = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatTimeDomainData(pcm); analyser.getFloatFrequencyData(db);
    let square = 0, peak = 0; for (const value of pcm) { square += value * value; peak = Math.max(peak, Math.abs(value)); }
    return {sampleRate: context.sampleRate, peak, rms: Math.sqrt(square / pcm.length), finite: pcm.every(Number.isFinite),
      muted: finalGain.gain.value === 0, spectrum: Array.from(db, value => Number.isFinite(value) ? 10 ** (value / 10) : 0)};
  });
}
async function checkEngine(name, engine, origin, prefix) {
  const {createDefaultPreset, presetToCode} = await import('../docs/synth-sid/preset.js');
  const exportedPreset = createDefaultPreset({model: '8580'});
  exportedPreset.voice.attack = 0; exportedPreset.voice.sustain = 15;
  exportedPreset.filter = {enabled: true, mode: 'lowpass+bandpass', cutoff: 700, resonance: 8, volume: 8};
  const exportedCode = presetToCode(exportedPreset);
  const browser = await engine.launch({headless: true});
  try {
    for (const execution of ['main', 'worker']) {
      const context = await browser.newContext({serviceWorkers: 'block', viewport: {width: 1440, height: 1080}});
      await context.addInitScript(instrument); const page = await context.newPage(); page.setDefaultTimeout(20000);
      const errors = [], consoleErrors = [], failed = [], external = [], editorDependencies = new Set(), checks = [], captures = [];
      let stage = 'startup', heldWasm, holdFirstWasm = true;
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('response', response => { if (response.status() >= 400) failed.push({url: response.url(), status: response.status()}); });
      const editorDependency = url => url.startsWith('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/');
      context.on('request', request => {
        const url = new URL(request.url());
        if (editorDependency(url.href)) editorDependencies.add(url.href);
        else if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) external.push(url.href);
      });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol) && !editorDependency(url.href)) return route.abort();
        if (url.origin === origin && /\/sid\/sid\.wasm$/.test(url.pathname) && holdFirstWasm) {
          holdFirstWasm = false; await new Promise(resolve => { heldWasm = resolve; });
        }
        return route.continue();
      });
      const check = label => { stage = label; checks.push(label); console.log(`CHECK ${name}/${execution}: ${label}`); };
      const state = () => page.evaluate(() => __sidPlaygroundCheck.runtime.chipInspector.read('sid'));
      const sample = () => page.evaluate(() => __sidAudit.sample());
      const sound = async (expected = true) => {
        for (let i = 0; i < 100; ++i) {
          const rows = await sample(); assert(rows.every(row => row.finite && row.muted), 'Output is finite and physically muted');
          if (rows.length && (expected ? rows.some(row => row.rms > .00001) : rows.every(row => row.peak < 1e-8))) {
            captures.push({check: stage, sounding: expected, output: rows.map(({spectrum, ...row}) => row)}); return rows;
          }
          await page.waitForTimeout(50);
        }
        throw new Error(`Expected ${expected ? 'sound' : 'silence'}: ${JSON.stringify((await sample()).map(({spectrum, ...row}) => row))}`);
      };
      const waitState = async predicate => {
        for (let i = 0; i < 120; ++i) { const value = await state(); if (predicate(value)) return value; await page.waitForTimeout(40); }
        throw new Error(`SID state did not settle: ${JSON.stringify(await state())}`);
      };
      const lead = async () => execution === 'worker' ? page.evaluate(() => __sidPlaygroundCheck.runtime.getTiming().workerLookaheadSeconds * 1000) : 0;
      const setCode = async source => {
        await page.locator('#codeTab').click();
        await page.evaluate(({source, execution}) => { monaco.editor.getEditors()[0].setValue(source); document.getElementById('workerExecution').checked = execution === 'worker'; }, {source, execution});
      };
      const run = async source => {
        await setCode(source); await page.locator('#runButton').click();
        await page.waitForFunction(() => !document.getElementById('runButton').disabled);
        await page.waitForTimeout(await lead() + 200);
        const status = await page.locator('#status').textContent(); assert(!/failed|error:/i.test(status), status);
      };
      const stop = async () => { await page.locator('#stopButton').click(); await sound(false); };
      const marker = token => page.waitForFunction(value => document.getElementById('consoleOutput').textContent.includes(value), token);
      try {
        await page.goto(`${origin}/${prefix}index.html?mode=c64&layout=full&no-sw=1`, {waitUntil: 'domcontentloaded'});
        await page.waitForFunction(() => document.getElementById('startupNotice')?.hidden);
        await page.waitForFunction(() => window.monaco?.editor?.getEditors().length === 1);
        assert.equal(await page.locator('#playgroundMode').inputValue(), 'c64');
        check('lazy SID mode, read-only panel and Files separation');
        assert.equal(await page.evaluate(() => __sidAudit.worklets.length), 0);
        await page.locator('#sidTab').click();
        assert.match(await page.locator('#sidPanel').textContent(), /SID|Prepare|Connect/i);
        for (const width of [1440, 390]) {
          await page.setViewportSize({width, height: 1080});
          const layout = await page.evaluate(() => {
            const panel = document.getElementById('sidPanel'), files = document.getElementById('fileExplorer');
            const p = panel.getBoundingClientRect(), f = files.getBoundingClientRect();
            return {panelLeft: p.left, filesRight: f.right, filesVisible: f.width > 0, host: panel.parentElement.className,
              tabInEditor: !!document.getElementById('sidTab').closest('.workbench-editor')};
          });
          assert.equal(layout.host, 'workbench-primary-panels'); assert(layout.tabInEditor);
          if (layout.filesVisible) assert(layout.panelLeft >= layout.filesRight - 1, `SID overlaps Files: ${JSON.stringify(layout)}`);
        }
        await page.setViewportSize({width: 1440, height: 1080});
        check('Stop during the first delayed WASM start cannot leave a stale note');
        const starter = await fs.readFile(path.join(config.root, prefix, 'defaults/c64/index.js'), 'utf8');
        await setCode(starter); await page.locator('#runButton').click();
        for (let i = 0; !heldWasm && i < 120; ++i) await page.waitForTimeout(25);
        assert(heldWasm, 'first SID WASM request reached the test gate'); await page.locator('#stopButton').click();
        heldWasm(); heldWasm = null;
        await page.waitForFunction(() => !document.getElementById('runButton').disabled); await page.waitForTimeout(150); await sound(false);

        check('three default editable examples produce actual PCM and Stop/re-Run');
        for (const file of ['sid-melody.js', 'sid-triad.js', 'sid-filter-sweep.js']) {
          const source = await fs.readFile(path.join(config.root, prefix, 'examples/c64', file), 'utf8');
          await run(source); await sound(); await stop();
          captures.push({example: file, passed: true});
        }
        await run(starter); await sound(); await stop();

        check('primary use cache, helper/raw register edits and async read/getState resume the calling loop');
        await run(`const borrowed=await useSoundChip('sid');if(borrowed!==sid||borrowed!==await useSoundChip('sid'))throw Error('SID primary cache identity');
sid.setVoice(0,{waveform:'pulse',pulseWidth:900,attack:0,sustain:15});sid.setFilter({mode:'off',routing:0,volume:8});
liveLoop('sid-browser-rpc',async()=>{sid.noteOn(0,'A3');const value=await sid.readRegister(28);const applied=await sid.getState();
if(applied.model!=='6581'||typeof value!=='number')throw Error('SID async state');sid.writeRegister(2,52);sid.writeRegister(3,3);sid.setNote(0,'C4');
log('SID_RPC_READY');await sleep(60);});`);
        await marker('SID_RPC_READY'); await page.waitForTimeout(await lead() + 200); await sound();
        let applied = await waitState(value => value.channels[0].pulseWidth === 820 && value.channels[0].gate);
        assert.equal(applied.channels[0].frequencyRegister, Math.round(261.6255653005986 * 16777216 / 985248));
        await page.locator('#sidTab').click(); await page.waitForFunction(() => document.querySelectorAll('#sidPanel [data-sid-voice]').length === 3);
        assert.match(await page.locator('#sidPanel').textContent(), /read|inspect|Edit voices/i);
        assert.equal(await page.locator('#sidPanel [data-sid-voice] input,#sidPanel [data-sid-voice] select,#sidPanel [data-sid-voice] canvas').count(), 0);
        assert.match(await page.locator('#sidPanel [data-chip-output="sid-filter-routing"]').textContent(), /mask 0/);
        if (config.screenshots) await page.screenshot({path: path.join(config.screenshots, `${name}-${execution}-desktop.png`)});
        await stop();

        check('software loop automation changes live LP/BP/HP hardware state and actual spectrum');
        await run(`for(let ch=0;ch<3;ch++){sid.setVoice(ch,{waveform:'saw',attack:0,sustain:15});sid.noteOn(ch,['C3','G3','C4'][ch]);}
liveLoop('sid-browser-filter',async()=>{for(const mode of ['lowpass','bandpass','highpass']){
sid.setFilter({mode,cutoff:700,resonance:10,routing:7,volume:8});log('SID_FILTER_'+mode);await sleep(1.8);}});`);
        const filters = {};
        for (const mode of ['lowpass', 'bandpass', 'highpass']) {
          await waitState(value => value.filter.mode === mode && value.filter.routing === 7);
          await page.waitForTimeout(220); await sound(); const rows = await sample(); filters[mode] = rows.reduce((a, b) => a.rms > b.rms ? a : b);
        }
        const filterDifference = {lowBand: difference(filters.lowpass.spectrum, filters.bandpass.spectrum), bandHigh: difference(filters.bandpass.spectrum, filters.highpass.spectrum)};
        assert(filterDifference.lowBand > .01 && filterDifference.bandHigh > .01, JSON.stringify(filterDifference));
        captures.push({filterDifference, modes: Object.fromEntries(Object.entries(filters).map(([mode, {rms, peak}]) => [mode, {rms, peak}]))}); await stop();

        check('same-name loop Apply cannot let its retired Gate-off cut the new note');
        await run(`sid.setFilter({mode:'off',routing:0,volume:8});sid.setVoice(0,{waveform:'triangle',attack:0,sustain:15});
liveLoop('sid-browser-owner',async()=>{sid.noteOn(0,'C4');try{await sleep(1.1);}finally{sid.keyOff(0);}});`); await sound();
        // Apply updates a same-name loop at its next boundary. The new Run's
        // immediate note must also survive the retiring iteration's finally.
        await run(`sid.noteOn(0,'G4');log('SID_REPLACED_READY');liveLoop('sid-browser-owner',async()=>{await sleep(60);});`);
        await marker('SID_REPLACED_READY'); await page.waitForTimeout(await lead() + 1400); await sound();
        applied = await state(); assert(applied.channels[0].gate); assert.equal(applied.channels[0].frequencyRegister, Math.round(391.99543598174927 * 16777216 / 985248)); await stop();

        check('independent additional SID instance, cache stability and final Stop silence');
        await run(`const cached=await useSoundChip('sid');const extra=await createSoundChip('sid',{clock:1022727,model:'6581'});
if(extra===cached||cached!==await useSoundChip('sid'))throw Error('SID instance identity');extra.setVoice(2,{waveform:'triangle',attack:0,sustain:15});
extra.noteOn(2,'A4');const state=await extra.getState();if(state.clock!==1022727)throw Error('SID extra clock');log('SID_EXTRA_READY');
liveLoop('sid-browser-extra',async()=>{await sleep(60);});`);
        await marker('SID_EXTRA_READY'); await sound();
        assert(await page.evaluate(() => __sidAudit.worklets.filter(value => value.name === 'tetorica-sid').length >= 2)); await stop();

        check('Synth Copy JavaScript creates a real 8580 extra instance and leaves the C64 primary at 6581');
        await run(exportedCode + `\nconst observed=await sid8580.getState();const primary=await sid.getState();
if(observed.model!=='8580'||observed.clock!==985248||primary.model!=='6581')throw Error('SID copied model');
if(observed.channels[0].envelope!==null)throw Error('8580 Envelope is unknown');
log('SID_8580_COPY_READY');liveLoop('sid-browser-8580',async()=>{await sleep(60);});`);
        await marker('SID_8580_COPY_READY'); await sound();
        const extra8580 = await page.evaluate(() => __sidPlaygroundCheck.runtime.chipInspector.read('sid:8580-voice'));
        assert.equal(extra8580.model, '8580'); assert.equal(extra8580.channels[0].gate, true);
        assert.equal(extra8580.filter.mode, 'lowpass+bandpass');
        captures.push({copiedSynthModel: extra8580.model, primaryModel: (await state()).model,
          codeSha256: createHash('sha256').update(exportedCode).digest('hex')});
        await stop();
        if (execution === 'worker') assert(await page.evaluate(() => __sidAudit.workers.some(url => /playground_logic_worker\.js/.test(url))));
        await page.locator('#sidTab').click(); await page.setViewportSize({width: 390, height: 844}); await page.waitForTimeout(100);
        if (config.screenshots) await page.screenshot({path: path.join(config.screenshots, `${name}-${execution}-390.png`)});
        const layoutNotifications = errors.filter(error => error === 'ResizeObserver loop completed with undelivered notifications.');
        assert.deepEqual(errors.filter(error => !layoutNotifications.includes(error)), []); assert.deepEqual(consoleErrors, []); assert.deepEqual(failed, []); assert.deepEqual(external, []);
        assert.deepEqual(await page.evaluate(() => __sidAudit.processorErrors), []);
        report.results.push({browser: name, version: browser.version(), execution, passed: true, checks, captures, errors: [], consoleErrors, failed, external, editorDependencies: [...editorDependencies], layoutNotifications});
        console.log(`PASS ${name}/${execution}: ${checks.length} checks; physical output muted.`);
      } catch (error) {
        heldWasm?.(); heldWasm = null;
        if (config.screenshots) await page.screenshot({path: path.join(config.screenshots, `${name}-${execution}-failed.png`)}).catch(() => {});
        const status = await page.evaluate(() => ({status: document.getElementById('status')?.textContent, startup: document.getElementById('startupMessage')?.textContent, console: document.getElementById('consoleOutput')?.textContent})).catch(() => ({}));
        report.results.push({browser: name, execution, passed: false, stage, error: error.message, errors, consoleErrors, failed, external, editorDependencies: [...editorDependencies], status});
        throw new Error(`${name}/${execution} (${stage}): ${error.message}; ${JSON.stringify({errors, consoleErrors, failed, external, status})}`, {cause: error});
      } finally { heldWasm?.(); await context.close(); }
    }
  } finally { await browser.close(); }
}

(async () => {
  const nested = await fs.access(path.join(config.root, 'playground/index.html')).then(() => true, () => false), prefix = nested ? 'playground/' : '';
  if (config.screenshots) await fs.mkdir(config.screenshots, {recursive: true});
  report.rootLayout = nested ? 'docs/playground' : 'flat-playground'; report.checkerSha256 = createHash('sha256').update(await fs.readFile(__filename)).digest('hex');
  const server = http.createServer(async (request, response) => {
    try {
      const file = path.resolve(config.root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
      assert(file.startsWith(config.root + path.sep)); let data = await fs.readFile(file);
      if (path.basename(file) === 'playground.js') {
        const source = data.toString(), names = [...new Set([...source.matchAll(/([A-Za-z_$][\w$]*)\.getTiming\(\)\.workerLookaheadSeconds/g)].map(match => match[1]))];
        assert.equal(names.length, 1, 'Exactly one source/bundled Playground runtime timing owner');
        data = Buffer.from(source + `\nwindow.__sidPlaygroundCheck={runtime:${names[0]}};\n`);
      }
      response.writeHead(200, {'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store'}); response.end(data);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [name, engine] of config.chromiumOnly ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]]) await checkEngine(name, engine, origin, prefix);
    report.passed = true;
  } finally {
    await new Promise(resolve => server.close(resolve)); await fs.mkdir(path.dirname(config.out), {recursive: true}); await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
