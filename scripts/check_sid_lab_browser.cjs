// SPDX-License-Identifier: BSD-3-Clause
// Real chips/m6581 WASM + AudioWorklet checks. A final zero-gain tap mutes speakers.
const {chromium, webkit} = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const config = {root:path.resolve(__dirname, '../docs'), entry:'/playground/sid-lab/index.html',
  out:'/private/tmp/tetorica-sid-lab-browser.json', screenshots:null};
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index].replace(/^--/, '');
  assert(['root','entry','out','screenshots'].includes(key), 'Usage: --root DOCS --entry /playground/sid-lab/index.html --out REPORT [--screenshots DIR]');
  const value = process.argv[++index];assert(value, `Missing --${key}`);
  config[key] = key === 'entry' ? value : path.resolve(value);
}
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm',
  '.json':'application/json','.md':'text/markdown','.webp':'image/webp','.png':'image/png'};
const frequency = (hz, clock) => Math.round(hz * 16777216 / clock);
const voiceFrequency = (state, index) => state.registers[index * 7] | state.registers[index * 7 + 1] << 8;
const difference = (a, b) => {
  let distance = 0, total = 0;
  for (let index = 0; index < a.length; index++) {distance += Math.abs(a[index] - b[index]);total += a[index] + b[index];}
  return total ? distance / total : 0;
};

async function checkEngine(name, engine, origin) {
  const browser = await engine.launch({headless:true});
  const checks = [], errors = [], consoleErrors = [], failed = [], external = [], measurements = {};
  let stage = 'startup', releaseWasm = null, holdWasm = true, page;
  try {
    if (config.screenshots) await fs.mkdir(config.screenshots, {recursive:true});
    page = await browser.newPage({viewport:{width:1180,height:1000}});page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {if (message.type() === 'error') consoleErrors.push(message.text());});
    page.on('response', response => {if (response.status() >= 400) failed.push({url:response.url(),status:response.status()});});
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin && !['data:','blob:'].includes(url.protocol)) {external.push(url.href);return route.abort();}
      if (url.origin === origin && url.pathname.endsWith('/sid.wasm') && holdWasm) {
        holdWasm = false;await new Promise(resolve => {releaseWasm = resolve;});
      }
      return route.continue();
    });
    await page.addInitScript(() => {
      const audit = window.audit = {contexts:[],worklets:[],analysers:[],nextId:0,messages:[]};
      const Context = window.AudioContext ?? window.webkitAudioContext, Worklet = window.AudioWorkletNode;
      const connect = AudioNode.prototype.connect, post = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function(data, ...args) {
        if (data?.method) audit.messages.push({method:data.method,id:data.id});
        return post.call(this,data,...args);
      };
      window.AudioContext = class extends Context {constructor(...args) {super(...args);audit.contexts.push(this);}};
      if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
      AudioNode.prototype.connect = function(destination, ...args) {
        if (destination === this.context.destination) {
          const analyser = this.context.createAnalyser();analyser.fftSize = 8192;analyser.smoothingTimeConstant = 0;
          const mute = this.context.createGain();mute.gain.value = 0;audit.analysers.push(analyser);
          connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);return destination;
        }
        return connect.call(this,destination,...args);
      };
      window.AudioWorkletNode = class extends Worklet {constructor(...args) {super(...args);audit.worklets.push(this);}};
      audit.request = (method, args = []) => new Promise((resolve,reject) => {
        const node = audit.worklets.at(-1), id = --audit.nextId;
        if (!node) return reject(new Error('No SID worklet'));
        const timer = setTimeout(() => {node.port.removeEventListener('message',receive);reject(new Error('SID audit request timed out'));},5000);
        function receive({data}) {
          if (data.id !== id) return;
          clearTimeout(timer);node.port.removeEventListener('message',receive);
          data.error ? reject(new Error(data.error)) : resolve(data.value);
        }
        node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});
      });
      audit.sample = () => {
        const analyser = audit.analysers.at(-1);
        if (!analyser) return {rms:0,peak:0,finite:true,spectrum:[]};
        const values = new Float32Array(analyser.fftSize), db = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatTimeDomainData(values);analyser.getFloatFrequencyData(db);
        let squares = 0, peak = 0;
        for (const value of values) {squares += value * value;peak = Math.max(peak,Math.abs(value));}
        return {rms:Math.sqrt(squares / values.length),peak,finite:values.every(Number.isFinite),
          spectrum:Array.from(db,value => Number.isFinite(value) ? 10 ** (value / 10) : 0)};
      };
    });
    const check = label => {stage = label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
    const read = () => page.evaluate(() => audit.request('getState'));
    const waitState = async predicate => {
      for (let attempt = 0; attempt < 120; attempt++) {const state = await read();if (predicate(state)) return state;await page.waitForTimeout(25);}
      throw new Error(`SID state did not settle: ${JSON.stringify(await read())}`);
    };
    const sound = () => page.waitForFunction(() => {const value = audit.sample();return value.finite && value.rms > .00001;});
    const silent = () => page.waitForFunction(() => audit.sample().rms < .00001);
    const setRange = async (id, value) => page.locator('#' + id).evaluate((element,next) => {element.value = String(next);element.dispatchEvent(new Event('input',{bubbles:true}));},value);
    const measure = async () => {await page.waitForTimeout(260);const value = await page.evaluate(() => audit.sample());assert(value.finite);return value;};
    const chooseWave = value => page.locator(`[data-waveform="${value}"]`).click();
    const chooseFilter = value => page.locator(`[data-filter-mode="${value}"]`).click();
    const startTone = async () => {await page.locator('#playTone').click();await page.waitForFunction(() => document.querySelector('#playTone').getAttribute('aria-pressed') === 'true');};
    const startChord = async () => {await page.locator('#playChord').click();await page.waitForFunction(() => document.querySelector('#playChord').getAttribute('aria-pressed') === 'true');};

    await page.goto(origin + config.entry);await page.waitForFunction(() => document.querySelector('#cutoff'));
    check('lazy independent 6581 lab, one canvas, button / slider controls and no select');
    assert.match(await page.title(),/SID Register Lab/);assert.match(await page.locator('.scope-note').textContent(),/chips\/m6581.*6581 approximation/);
    assert.match(await page.locator('.scope-note').textContent(),/8580/);assert.equal(await page.locator('canvas').count(),1);
    assert.equal(await page.locator('select').count(),0);assert.equal(await page.evaluate(() => audit.contexts.length),0);
    await chooseWave('pulse');await setRange('pulseWidth',1024);await chooseWave('saw');await chooseFilter('lowpass');await chooseFilter('off');
    assert.equal(await page.evaluate(() => audit.contexts.length),0);

    check('first Play is bounded while loading; Stop cancels a pending start without a stale note');
    await page.locator('#playTone').click();
    for (let attempt = 0; !releaseWasm && attempt < 120; attempt++) await page.waitForTimeout(25);
    assert(releaseWasm, 'first WASM fetch reached the loading gate');
    assert.equal(await page.locator('#playTone').isDisabled(),true);assert.equal(await page.locator('#transportPanel').getAttribute('aria-busy'),'true');
    await page.locator('#playTone').dispatchEvent('click');assert.equal(await page.evaluate(() => audit.contexts.length),1);
    await page.locator('#stopAudio').click();releaseWasm();releaseWasm = null;await page.waitForTimeout(80);
    assert.equal(await page.locator('#playTone').getAttribute('aria-pressed'),'false');assert.match(await page.locator('#status').textContent(),/Stopped/);
    assert.equal(await page.evaluate(() => audit.messages.filter(message => message.method === 'playTone').length),0);await silent();

    check('real WASM tone, live four waveforms and pulse width register / PCM changes');
    await startTone();
    let state = await waitState(value => value.registers[4] === 0x21);await sound();
    assert.equal(state.model,'6581');assert.equal(state.clockHz,985248);assert.equal(voiceFrequency(state,0),frequency(220,985248));
    assert.equal(state.registers[5],0x26);assert.equal(state.registers[6],0xc5);assert(state.cycles > 0);
    const waveSamples = {};
    for (const [wave,control] of [['triangle',0x11],['saw',0x21],['pulse',0x41],['noise',0x81]]) {
      const before = state.cycles;await chooseWave(wave);state = await waitState(value => value.registers[4] === control);await sound();
      assert(state.cycles >= before,'wave edits keep the same running core');assert.equal(voiceFrequency(state,0),frequency(220,985248));
      waveSamples[wave] = await measure();assert(waveSamples[wave].peak > .0001);
    }
    assert(difference(waveSamples.triangle.spectrum,waveSamples.saw.spectrum) > .03,'Triangle and Saw expose different harmonic spectra');
    await chooseWave('pulse');await setRange('pulseWidth',512);await waitState(value => (value.registers[2] | value.registers[3] << 8) === 512);const narrowPulse = await measure();
    await setRange('pulseWidth',2048);await waitState(value => (value.registers[2] | value.registers[3] << 8) === 2048);const squarePulse = await measure();
    assert(difference(narrowPulse.spectrum,squarePulse.spectrum) > .03,'pulse-width changes alter actual harmonic content');
    measurements.waveforms = Object.fromEntries(Object.entries(waveSamples).map(([wave,sample]) => [wave,{rms:sample.rms,peak:sample.peak}]));
    measurements.pulseWidthSpectrumDifference = difference(narrowPulse.spectrum,squarePulse.spectrum);

    check('Gate release follows hardware envelope, triad uses three voices and Stop removes output');
    await page.locator('#release').press('Home');await page.locator('#release').press('ArrowUp');await page.locator('#release').press('ArrowUp');
    await waitState(value => (value.registers[6] & 15) === 2);
    await page.locator('#releaseGate').click();state = await waitState(value => !(value.registers[4] & 1));
    await waitState(value => value.voices.every(voice => voice.envelope === 0));await silent();
    await chooseWave('saw');await page.locator('#sustain').press('End');
    await startChord();state = await waitState(value => [4,11,18].every(register => value.registers[register] & 1));await sound();
    for (const [index,note] of [60,64,67].entries()) assert.equal(voiceFrequency(state,index),frequency(440 * 2 ** ((note - 69) / 12),985248));
    await page.locator('#stopAudio').click();await silent();assert.equal(await page.locator('#playChord').getAttribute('aria-pressed'),'false');

    check('shared LP / BP / HP filter cutoff and resonance change held real PCM, with Notch routing');
    await startTone();await waitState(value => value.registers[4] & 1);await sound();
    measurements.filters = {};
    for (const [mode,mask] of [['lowpass',0x10],['bandpass',0x20],['highpass',0x40]]) {
      await chooseFilter(mode);state = await waitState(value => (value.registers[24] & 0x70) === mask);
      const before = state.cycles;assert.equal(state.registers[23] & 7,7);
      await setRange('cutoff',128);await waitState(value => ((value.registers[22] << 3) | value.registers[21]) === 128);const low = await measure();
      await setRange('cutoff',1700);state = await waitState(value => ((value.registers[22] << 3) | value.registers[21]) === 1700);const high = await measure();
      assert(state.cycles >= before);assert.equal(state.registers[4] & 1,1);
      const cutoffDifference = difference(low.spectrum,high.spectrum);assert(cutoffDifference > .03,`${mode} cutoff changes actual output (${cutoffDifference})`);
      await setRange('cutoff',700);await setRange('resonance',0);await waitState(value => value.registers[23] >> 4 === 0);const lowResonance = await measure();
      await setRange('resonance',15);await waitState(value => value.registers[23] >> 4 === 15);const highResonance = await measure();
      const resonanceDifference = difference(lowResonance.spectrum,highResonance.spectrum);assert(resonanceDifference > .01,`${mode} resonance changes actual output (${resonanceDifference})`);
      measurements.filters[mode] = {lowCutoffRms:low.rms,highCutoffRms:high.rms,cutoffSpectrumDifference:cutoffDifference,resonanceSpectrumDifference:resonanceDifference};
    }
    await chooseFilter('notch');state = await waitState(value => (value.registers[24] & 0x70) === 0x50);assert.equal(state.registers[23] & 7,7);await sound();

    check('Sync / Ring reserve silent Voice 3, block triad and retain carrier-only shared-filter routing');
    await chooseFilter('off');await chooseWave('triangle');await startTone();await waitState(value => value.registers[4] === 0x11);const plainTriangle = await measure();
    await setRange('modulatorHz',137);await page.locator('#sync').click();state = await waitState(value => value.registers[4] === 0x13 && value.registers[18] === 0x11);await sound();
    assert.equal(state.registers[24] & 0x80,0x80);assert.equal(state.registers[23] & 7,0);assert.equal(state.registers[11] & 1,0);
    assert.equal(voiceFrequency(state,2),frequency(137,985248));assert.equal(await page.locator('#playChord').isDisabled(),true);
    const sync = await measure();assert(difference(plainTriangle.spectrum,sync.spectrum) > .01);
    await page.locator('#playChord').dispatchEvent('click');state = await read();assert.equal(state.registers[11] & 1,0);
    await page.locator('#sync').click();await page.locator('#ring').click();state = await waitState(value => value.registers[4] === 0x15);await sound();const ring = await measure();
    assert.equal(state.registers[24] & 0x80,0x80);assert.equal(state.registers[18],0x11);assert(difference(plainTriangle.spectrum,ring.spectrum) > .01);
    await chooseFilter('lowpass');state = await waitState(value => (value.registers[24] & 0x70) === 0x10);assert.equal(state.registers[23] & 7,1);
    measurements.modulation = {syncSpectrumDifference:difference(plainTriangle.spectrum,sync.spectrum),ringSpectrumDifference:difference(plainTriangle.spectrum,ring.spectrum),voice3MutedBy3Off:true,filteredVoiceMask:1};

    check('PAL / NTSC clock changes stop sound and re-create a tuned core without another AudioContext');
    const nodesBefore = await page.evaluate(() => audit.worklets.length);
    await page.locator('[data-clock-hz="1022727"]').click();await page.waitForFunction(() => /Clock changed/.test(document.querySelector('#status').textContent));await silent();
    assert.equal(await page.locator('#playTone').getAttribute('aria-pressed'),'false');
    await startTone();state = await waitState(value => value.clockHz === 1022727 && value.registers[4] & 1);await sound();
    assert.equal(voiceFrequency(state,0),frequency(220,1022727));assert.equal(voiceFrequency(state,2),frequency(137,1022727));
    assert((await page.evaluate(() => audit.worklets.length)) > nodesBefore);assert.equal(await page.evaluate(() => audit.contexts.length),1);
    await page.locator('[data-clock-hz="985248"]').click();await silent();await page.locator('#ring').click();await chooseFilter('off');
    await startChord();state = await waitState(value => value.clockHz === 985248 && value.registers[11] & 1);await sound();

    check('processor failure is visible, silences output and permits an explicit clean retry');
    await page.evaluate(() => audit.worklets.at(-1).onprocessorerror(new Event('processorerror')));
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error');await silent();
    measurements.recoveredError = await page.locator('#status').textContent();assert.match(measurements.recoveredError,/SID AudioWorklet failed/);
    assert.equal(await page.locator('#playTone').isEnabled(),true);
    await startTone();state = await waitState(value => value.clockHz === 985248 && value.registers[4] & 1);await sound();
    assert.equal(await page.locator('#status').getAttribute('data-state'),'playing');assert.equal(await page.evaluate(() => audit.contexts.length),1);

    check('one waveform / spectrum canvas remains usable at 1180px and 390px without overflow');
    await page.locator('#showWaveform').click();assert.equal(await page.locator('#showWaveform').getAttribute('aria-pressed'),'true');
    if (config.screenshots) await page.screenshot({path:path.join(config.screenshots,`${name}-1180.png`),fullPage:true});
    await page.locator('#showSpectrum').click();assert.equal(await page.locator('#showSpectrum').getAttribute('aria-pressed'),'true');
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => Math.max(0,document.documentElement.scrollWidth - innerWidth)),0);
    assert.equal(await page.locator('canvas').count(),1);assert.equal(await page.locator('select').count(),0);
    if (config.screenshots) await page.screenshot({path:path.join(config.screenshots,`${name}-390.png`),fullPage:true});
    await page.locator('#stopAudio').click();await silent();
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(failed,[]);assert.deepEqual(external,[]);
    return {engine:name,ok:true,checks,measurements,errors,consoleErrors,failed,external,
      contexts:await page.evaluate(() => audit.contexts.length),sample:await page.evaluate(() => {const {spectrum,...sample} = audit.sample();return sample;})};
  } catch (error) {
    if (config.screenshots && page) await page.screenshot({path:path.join(config.screenshots,`${name}-failed.png`),fullPage:true}).catch(() => {});
    throw new Error(`${name} (${stage}): ${error.message}; diagnostics=${JSON.stringify({errors,consoleErrors,failed,external})}`,{cause:error});
  } finally {releaseWasm?.();await browser.close();}
}

const server = http.createServer(async (request,response) => {
  try {
    const file = path.resolve(config.root,'.' + decodeURIComponent(new URL(request.url,'http://localhost').pathname));
    if (!file.startsWith(config.root + path.sep)) {response.writeHead(403);response.end();return;}
    const data = await fs.readFile(file);response.writeHead(200,{'content-type':mime[path.extname(file)] ?? 'application/octet-stream','cache-control':'no-store'});response.end(data);
  } catch {response.writeHead(404);response.end();}
});
(async () => {
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    const origin = `http://127.0.0.1:${server.address().port}`, results = [];
    for (const [name,engine] of [['chromium',chromium],['webkit',webkit]]) results.push(await checkEngine(name,engine,origin));
    await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify({entry:config.entry,speakersMuted:true,results},null,2) + '\n');
    console.log(`SID lab browser checks passed: ${config.out}`);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);process.exitCode = 1;});
