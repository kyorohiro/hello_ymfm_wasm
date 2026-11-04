// Exercise the real standalone page, AudioWorklet and WASM in both engines.
// Measure the node actually connected to destination, then mute that connection
// so browser validation never plays notes through the user's speakers.
const {chromium, webkit} = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const config = {
  root:path.resolve(__dirname, '../docs'), entry:'/synth-gameboy/index.html',
  out:'/private/tmp/tetorica-gameboy-synth-browser.json', screenshots:null,
};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  assert(['root','entry','out','screenshots'].includes(key), 'Usage: --root DIR --entry /index.html --out REPORT [--screenshots DIR]');
  const value = process.argv[++i]; assert(value, `Missing --${key} value`);
  config[key] = key === 'entry' ? value : path.resolve(value);
}
const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
  '.wasm':'application/wasm', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.svg':'image/svg+xml'};

async function runEngine(name, engine, origin) {
  const browser = await engine.launch({headless:true});
  let page, stage = 'startup';
  let initialWasmSeen = false, releaseInitialWasm;
  const initialWasmGate = new Promise(resolve => {releaseInitialWasm = resolve;});
  const errors = [], missing = [], external = [];
  const check = text => {stage = text; console.log(`CHECK ${name}: ${text}`);};
  try {
    page = await browser.newPage({acceptDownloads:true, viewport:{width:1180,height:940}});
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {if (response.status() >= 400) missing.push({url:response.url(), status:response.status()});});
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.protocol === 'data:' || url.protocol === 'blob:' || url.origin === origin) {
        if (!initialWasmSeen && url.pathname.endsWith('/gameboy_apu_wasm.wasm')) {
          initialWasmSeen = true; await initialWasmGate;
        }
        return route.continue();
      }
      external.push(url.href); return route.abort();
    });
    await page.addInitScript(() => {
      window.audit = {contexts:[], worklets:[], analysers:[], outgoing:[], nextId:0};
      const Context = window.AudioContext ?? window.webkitAudioContext;
      const Node = window.AudioWorkletNode, connect = AudioNode.prototype.connect;
      const AuditedContext = class extends Context {
        constructor(...args) {super(...args); window.audit.contexts.push(this);}
      };
      window.AudioContext = AuditedContext;
      if (window.webkitAudioContext) window.webkitAudioContext = AuditedContext;
      AudioNode.prototype.connect = function(destination, ...args) {
        if (destination === this.context.destination) {
          const analyser = this.context.createAnalyser(); analyser.fftSize = 4096;
          const mute = this.context.createGain(); mute.gain.value = 0;
          window.audit.analysers.push(analyser);
          connect.call(this, analyser); connect.call(analyser, mute); connect.call(mute, destination);
          return destination;
        }
        return connect.call(this, destination, ...args);
      };
      window.AudioWorkletNode = class extends Node {
        constructor(...args) {super(...args); window.audit.worklets.push(this);}
      };
      const post = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function(data, ...args) {
        if (data?.method) window.audit.outgoing.push({method:data.method, args:data.args});
        return post.call(this, data, ...args);
      };
      window.audit.read = () => new Promise((resolve, reject) => {
        const node = window.audit.worklets.at(-1), id = --window.audit.nextId;
        if (!node) {reject(new Error('No Game Boy worklet')); return;}
        const timer = setTimeout(() => {node.port.removeEventListener('message', receive); reject(new Error('Audit read timed out'));}, 5000);
        function receive({data}) {
          if (data.id !== id) return;
          clearTimeout(timer); node.port.removeEventListener('message', receive);
          if (data.error) reject(new Error(data.error)); else resolve(data.value);
        }
        node.port.addEventListener('message', receive); node.port.start();
        node.port.postMessage({id, method:'read', args:[]});
      });
      window.audit.sample = () => {
        const analyser = window.audit.analysers.at(-1);
        if (!analyser) return {rms:0, peak:0, finite:true};
        const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values);
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        let square = 0, peak = 0;
        for (const value of values) {square += (value - mean) ** 2; peak = Math.max(peak, Math.abs(value));}
        return {rms:Math.sqrt(square / values.length), peak, mean, finite:values.every(Number.isFinite)};
      };
    });
    const inspect = () => page.evaluate(() => window.audit.read());
    const waitState = async (predicate, message = 'Instrument state did not settle') => {
      let last;
      for (let attempt = 0; attempt < 100; attempt++) {
        last = await inspect(); if (predicate(last)) return last;
        await page.waitForTimeout(25);
      }
      throw new Error(`${message}: ${JSON.stringify(last)}`);
    };
    const sound = () => page.waitForFunction(() => {
      const value = window.audit.sample(); return value.finite && value.rms > .0001;
    });
    const silent = () => page.waitForFunction(() => window.audit.sample().rms < .000001);
    const stepButton = (selector, delta) => page.locator(`[data-stepper-for="${selector.replace(/^#/, '')}"][data-stepper-delta="${delta}"]`);
    const number = async (selector, value) => {
      for (let attempt = 0; attempt < 32; attempt++) {
        const current = Number(await page.locator(selector).textContent());
        assert(Number.isInteger(current), `${selector} has a numeric display`);
        if (current === value) return;
        const delta = current < value ? 1 : -1;
        await stepButton(selector, delta).click();
        await page.waitForFunction(({selector,next}) => Number(document.querySelector(selector).textContent) === next, {selector,next:current+delta});
      }
      assert.fail(`${selector} did not reach ${value}`);
    };
    const pointerSelect = async (id, value) => {
      await page.locator(id).focus();
      await page.dispatchEvent(id, 'pointerdown', {pointerType:'mouse', button:0});
      await page.selectOption(id, String(value));
      await page.waitForFunction(selector => document.activeElement !== document.querySelector(selector), id);
    };
    const stop = async () => {
      await page.click('#stopAudio'); await waitState(state => state.voices.length === 0);
    };
    const setMaster = async value => {
      await page.locator('#masterVolume').evaluate((input, next) => {
        input.value = String(next); input.dispatchEvent(new Event('input', {bubbles:true}));
      }, value);
    };

    check('lazy startup / editing without an audio device');
    await page.goto(`${origin}${config.entry}`);
    await page.waitForSelector('#pulseDuty');
    assert.equal(await page.evaluate(() => window.audit.contexts.length), 0);
    assert.equal(await page.locator('#voiceEditor input[type=number]').count(), 0, 'instrument values use steppers rather than text fields');
    await number('#pulseVolume', 11); await number('#pulseVolume', 10);
    assert.equal(await page.evaluate(() => window.audit.contexts.length), 0, 'stepping a value does not start audio');
    await pointerSelect('#pulseDuty', .25);
    await page.fill('#instrumentName', 'Game Boy browser audit'); await page.press('#instrumentName', 'Enter');
    assert.equal(await page.evaluate(() => window.audit.contexts.length), 0);
    assert.equal(await page.locator('#keyboard .key').count(), 36);
    await page.click('#startAudio');
    for (let attempt = 0; !initialWasmSeen && attempt < 100; attempt++) await page.waitForTimeout(25);
    assert(initialWasmSeen,'initial WASM request reached the delay gate');
    check('initialization adopts source and Master edits / released startup key stays silent');
    await page.keyboard.down('a'); await page.keyboard.up('a');
    await pointerSelect('#source','wave'); await setMaster(0);
    assert.equal(await page.locator('#masterVolumeValue').textContent(),'0%');
    releaseInitialWasm();
    await page.waitForFunction(() => document.querySelector('#audioStatus').textContent.startsWith('Audio ready'));
    let state = await waitState(value => value.preset.source === 'wave' && value.preset.pulse.duty === .25);
    assert.equal(state.capacity,1); assert.equal(state.voices.length,0);
    assert.equal(await page.evaluate(() => window.audit.outgoing.filter(message => message.method === 'noteOn').length),0);
    await page.keyboard.down('a'); await waitState(value => value.voices.length === 1); await silent();
    await setMaster(.7); await sound(); await page.keyboard.up('a'); await waitState(value => value.voices.length === 0);
    await page.click('#resetPreset'); await waitState(value => value.preset.source === 'pulse' && value.capacity === 2);
    assert.equal(await page.evaluate(() => window.audit.contexts.length),1);
    assert.equal(await page.evaluate(() => window.audit.analysers.length),1, 'one final destination branch; monitor is passive');

    check('two Pulse owners / oldest stealing / late key release');
    await page.keyboard.down('a'); state = await waitState(value => value.voices.length === 1);
    const first = state.voices[0]; await sound();
    await page.keyboard.down('s'); state = await waitState(value => value.voices.length === 2);
    const second = state.voices.find(voice => voice.id !== first.id);
    assert.notEqual(first.channel, second.channel);
    const pulseLevel = await page.evaluate(() => window.audit.sample()); assert(pulseLevel.finite);
    await page.keyboard.down('d'); state = await waitState(value => value.voices.length === 2 && !value.voices.some(voice => voice.id === first.id));
    const replacement = state.voices.find(voice => voice.id !== second.id);
    assert.equal(replacement.channel, first.channel);
    await page.keyboard.up('a'); state = await inspect(); assert(state.voices.some(voice => voice.id === replacement.id));
    assert.equal(await page.locator('#keyboard .key[aria-pressed=true]').count(),2);

    check('live Pitch / final Master mute and restore / 380% boost');
    const ownersBeforePitch = state.voices.map(voice => voice.id), registersBeforePitch = [...state.registers];
    const attacksBeforePitch = await page.evaluate(() => window.audit.outgoing.filter(message => message.method === 'noteOn').length);
    await page.locator('#pitchBend').evaluate(input => {input.value = '1';input.dispatchEvent(new Event('input', {bubbles:true}));});
    state = await waitState(value => value.pitch === 1);
    assert.deepEqual(state.voices.map(voice => voice.id), ownersBeforePitch);
    assert.notDeepEqual(state.registers.slice(3,5), registersBeforePitch.slice(3,5));
    assert.equal(await page.evaluate(() => window.audit.outgoing.filter(message => message.method === 'noteOn').length), attacksBeforePitch);
    await page.dispatchEvent('#pitchBend', 'pointerup'); await waitState(value => value.pitch === 0);
    await setMaster(0); await silent(); assert.equal((await inspect()).voices.length,2);
    await setMaster(.7); await sound();
    const normalColor = await page.locator('#masterVolume').evaluate(input => getComputedStyle(input).accentColor);
    await setMaster(3.8);
    assert.equal(await page.locator('#masterVolumeValue').textContent(),'380%');
    assert.equal(await page.locator('#masterVolume').getAttribute('data-boosted'),'true');
    assert.notEqual(await page.locator('#masterVolume').evaluate(input => getComputedStyle(input).accentColor), normalColor);
    await setMaster(.7); await page.keyboard.up('s'); await page.keyboard.up('d'); await waitState(value => value.voices.length === 0);

    check('CH1 Sweep selects one hardware Pulse voice');
    for (const selector of ['#sweepPeriod','#sweepShift']) for (const delta of [-1,1]) assert.equal(await stepButton(selector,delta).isDisabled(),true);
    await page.check('#sweepEnabled'); await waitState(value => value.capacity === 1);
    for (const selector of ['#sweepPeriod','#sweepShift']) for (const delta of [-1,1]) assert.equal(await stepButton(selector,delta).isDisabled(),false);
    await number('#sweepPeriod',4); await waitState(value => value.preset.pulse.sweep.period === 4);
    await number('#sweepPeriod',3); await waitState(value => value.preset.pulse.sweep.period === 3);
    if (config.screenshots) await page.screenshot({path:path.join(config.screenshots,`gameboy-${name}-steppers-desktop.png`),fullPage:true});
    await page.keyboard.down('a'); state = await waitState(value => value.voices.length === 1); const sweepFirst = state.voices[0].id;
    await page.keyboard.down('s'); state = await waitState(value => value.voices.length === 1 && value.voices[0].id !== sweepFirst);
    assert.equal(state.voices[0].channel,0);
    await page.keyboard.up('a'); assert.equal((await inspect()).voices[0].id,state.voices[0].id);
    await page.keyboard.up('s'); await page.uncheck('#sweepEnabled'); await waitState(value => value.capacity === 2);

    check('Wave source / pointer select returns keyboard focus / auto-applied drawing');
    await pointerSelect('#source','wave'); state = await waitState(value => value.preset.source === 'wave');
    assert.equal(state.capacity,1); assert.equal(state.voices.length,0);
    await page.keyboard.down('a'); state = await waitState(value => value.voices.length === 1); await sound();
    assert.equal(state.voices[0].channel,2);
    const waveBefore = [...state.preset.wave.samples], waveOwner = state.voices[0].id;
    const wave = page.locator('#waveCanvas'); await wave.scrollIntoViewIfNeeded(); const rect = await wave.boundingBox(); assert(rect);
    await page.mouse.move(rect.x + rect.width * .15, rect.y + rect.height * .2); await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * .8, rect.y + rect.height * .75, {steps:12});
    state = await inspect(); assert.deepEqual(state.preset.wave.samples,waveBefore); assert.equal(state.voices[0].id,waveOwner);
    await page.mouse.up(); state = await waitState(value => JSON.stringify(value.preset.wave.samples) !== JSON.stringify(waveBefore));
    assert.equal(state.voices.length,0); assert.equal(state.preset.wave.samples.length,32);
    assert(state.preset.wave.samples.every(value => Number.isInteger(value) && value >= 0 && value <= 15));
    await page.keyboard.up('a'); await page.keyboard.down('a'); await waitState(value => value.voices.length === 1); await sound(); await page.keyboard.up('a');
    await page.click('[data-wave-shape="saw"]'); state = await waitState(value => value.preset.wave.samples[0] === 0 && value.preset.wave.samples.at(-1) === 15);

    check('Noise source / monophonic ownership / live clock without note pitch');
    await pointerSelect('#source','noise'); state = await waitState(value => value.preset.source === 'noise');
    assert.equal(state.capacity,1); assert.equal(await page.isDisabled('#pitchBend'),true);
    await page.keyboard.down('a'); state = await waitState(value => value.voices.length === 1); await sound();
    const noiseOwner = state.voices[0].id, oldClock = state.registers[18]; assert.equal(state.voices[0].channel,3);
    const noiseAttacks = await page.evaluate(() => window.audit.outgoing.filter(message => message.method === 'noteOn').length);
    await number('#noiseShift',6); state = await waitState(value => value.preset.noise.shift === 6);
    assert.equal(state.voices[0].id,noiseOwner); assert.notEqual(state.registers[18],oldClock);
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.matches('input,select,textarea'))),false, 'pointer steppers leave performance keys available');
    await number('#noiseDivisor',4); state = await waitState(value => value.preset.noise.divisor === 4);
    assert.equal(state.voices[0].id,noiseOwner); await sound();
    await number('#noiseDivisor',3); state = await waitState(value => value.preset.noise.divisor === 3);
    assert.equal(state.voices[0].id,noiseOwner);
    assert.equal(await page.evaluate(() => window.audit.outgoing.filter(message => message.method === 'noteOn').length),noiseAttacks, 'live steppers do not retrigger held notes');
    await page.keyboard.up('a'); await waitState(value => value.voices.length === 0);
    await page.keyboard.down('a'); state = await waitState(value => value.voices.length === 1); await sound();
    const steppedNoiseOwner=state.voices[0].id;
    assert.notEqual(steppedNoiseOwner,noiseOwner, 'a subsequent performance key still triggers after stepping');
    await pointerSelect('#noiseWidth',7); state = await waitState(value => value.preset.noise.width === 7); assert.equal(state.voices[0].id,steppedNoiseOwner);
    const noiseClock = state.registers[18];
    await page.keyboard.down('s'); state = await waitState(value => value.voices.length === 1 && value.voices[0].id !== steppedNoiseOwner);
    assert.equal(state.registers[18],noiseClock);
    await page.keyboard.up('a'); assert.equal((await inspect()).voices[0].id,state.voices[0].id);
    await page.keyboard.up('s'); await stop();

    check('steppers clamp to hardware bounds / keyboard arrows keep performance access');
    await stepButton('#noiseShift',-1).focus();
    await page.keyboard.press('ArrowRight'); await waitState(value => value.preset.noise.shift === 7);
    assert.equal(await stepButton('#noiseShift',-1).evaluate(button=>document.activeElement===button),true);
    await page.keyboard.down('a'); await waitState(value=>value.voices.length===1); await sound();
    await page.keyboard.up('a'); await waitState(value=>value.voices.length===0);
    await page.keyboard.press('ArrowLeft'); await waitState(value=>value.preset.noise.shift===6);
    await page.keyboard.press('Home'); await waitState(value=>value.preset.noise.shift===0);
    assert.equal(await stepButton('#noiseShift',-1).isDisabled(),true);
    assert.equal(await stepButton('#noiseShift',1).isDisabled(),false);
    await stepButton('#noiseShift',1).focus();
    await page.keyboard.press('End'); await waitState(value=>value.preset.noise.shift===15);
    assert.equal(await stepButton('#noiseShift',1).isDisabled(),true);
    assert.equal(await stepButton('#noiseShift',-1).isDisabled(),false);
    await number('#noiseShift',6); await waitState(value=>value.preset.noise.shift===6);
    assert.equal(await page.locator('#noiseShift').evaluate(output=>output.tagName),'OUTPUT');
    // The center value is also a pointer control; dragging cannot steal a
    // held keyboard owner or send another trigger into the real APU.
    await page.keyboard.down('a'); state=await waitState(value=>value.voices.length===1);
    const dragOwner=state.voices[0].id;
    const dragAttacks=await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length);
    await page.locator('#noiseShift').scrollIntoViewIfNeeded();
    const valueRect=await page.locator('#noiseShift').boundingBox();assert(valueRect);
    await page.mouse.move(valueRect.x+valueRect.width/2,valueRect.y+valueRect.height/2);await page.mouse.down();
    await page.mouse.move(valueRect.x+valueRect.width/2+16,valueRect.y+valueRect.height/2,{steps:4});
    state=await waitState(value=>value.preset.noise.shift===8);assert.equal(state.voices[0].id,dragOwner);
    await page.mouse.up();
    assert.equal(await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length),dragAttacks);
    await page.keyboard.up('a');await waitState(value=>value.voices.length===0);
    await number('#noiseShift',6);
    if(config.screenshots){
      await page.setViewportSize({width:390,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);
      await page.screenshot({path:path.join(config.screenshots,`gameboy-${name}-steppers-mobile.png`),fullPage:true});
      await page.setViewportSize({width:1180,height:940});
    }

    check('portable preset download / real import / invalid preset preserves the held sound');
    const downloadEvent = page.waitForEvent('download'); await page.click('#savePreset');
    const download = await downloadEvent, saved = JSON.parse(await fs.readFile(await download.path(),'utf8'));
    assert.equal(saved.format,'tetorica-gameboy-voice'); assert.equal(saved.version,1); assert.equal(saved.source,'noise');
    await pointerSelect('#source','pulse'); await waitState(value => value.preset.source === 'pulse');
    await page.setInputFiles('#presetFileInput',{name:'gameboy-roundtrip.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
    await page.waitForFunction(() => document.querySelector('#audioStatus').textContent.startsWith('Preset loaded'));
    state = await waitState(value => value.preset.source === 'noise'); assert.deepEqual(state.preset,saved); assert.equal(state.voices.length,0);
    await page.keyboard.down('a'); state = await waitState(value => value.voices.length === 1); await sound();
    const intact = structuredClone(state), invalid = structuredClone(saved); invalid.wave.samples[0] = 16;
    await page.setInputFiles('#presetFileInput',{name:'invalid-gameboy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
    await page.waitForFunction(() => document.querySelector('#audioStatus').dataset.error === 'true');
    state = await inspect(); assert.deepEqual(state.preset,intact.preset); assert.deepEqual(state.voices,intact.voices); await sound();
    await page.keyboard.up('a'); await stop();
    await page.click('#copyCode'); await page.waitForFunction(() => !document.querySelector('#codeOutput').hidden && document.querySelector('#codeOutput').value.includes('gameboy.noise.setVoice'));
    assert.match(await page.inputValue('#codeOutput'),/gameboy\.noise\.keyOn\(\)/);

    check('keyboard select navigation preserves focus until commit / blur releases');
    await page.click('#resetPreset'); await waitState(value => value.preset.source === 'pulse');
    await page.locator('#source').focus(); await page.keyboard.press('ArrowDown'); await page.selectOption('#source','wave');
    assert.equal(await page.locator('#source').evaluate(input => document.activeElement === input),true);
    await page.keyboard.down('a'); await page.keyboard.up('a'); assert.equal((await inspect()).voices.length,0);
    await page.keyboard.press('Enter'); await page.waitForFunction(() => document.activeElement !== document.querySelector('#source'));
    await waitState(value => value.preset.source === 'wave');
    await page.keyboard.down('a'); await waitState(value => value.voices.length === 1); await sound();
    await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.keyboard.up('a'); await waitState(value => value.voices.length === 0);
    await page.waitForFunction(() => document.querySelectorAll('#keyboard .key[aria-pressed=true]').length === 0);

    check('desktop/mobile layout / explicit audio-context recovery');
    if (config.screenshots) await page.screenshot({path:path.join(config.screenshots,`gameboy-${name}-desktop.png`),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1, `${name} mobile overflow: ${overflow}`);
    if (config.screenshots) await page.screenshot({path:path.join(config.screenshots,`gameboy-${name}-mobile.png`),fullPage:true});
    await page.setViewportSize({width:1180,height:940});
    await page.evaluate(() => window.audit.contexts.at(-1).close());
    await page.waitForFunction(() => document.querySelector('#audioStatus').textContent.includes('AudioContext was closed') && !document.querySelector('#startAudio').disabled);
    await page.click('#startAudio'); await page.waitForFunction(() => document.querySelector('#audioStatus').textContent.startsWith('Audio ready'));
    assert.equal(await page.evaluate(() => window.audit.contexts.length),2);
    await page.keyboard.down('a'); await waitState(value => value.voices.length === 1); await sound(); await page.keyboard.up('a'); await stop();
    assert.deepEqual(errors,[]); assert.deepEqual(missing,[]); assert.deepEqual(external,[]);
    console.log(`PASS ${name}: standalone Game Boy Synth`);
    return {engine:name, sampleRate:await page.evaluate(() => window.audit.contexts.at(-1).sampleRate), pulseLevel,
      lazyStartup:true, editingSilent:true, startupLatestSource:true, startupLatestMaster:true, startupKeyRelease:true,
      physicalPulseRoundRobin:true, lateReleaseSafe:true, sweepCapacity:true,
      livePitch:true, masterMuteRestore:true, master380:true, waveDrawingAutoApply:true, noiseClockLive:true,
      buttonSteppers:true, heldNoteStepperEdits:true, stepperDrag:true, stepperBounds:true, stepperKeyboardAccess:true,
      noiseIgnoresNotePitch:true, presetRoundTrip:true, invalidPresetAtomic:true, copyJavaScript:true,
      selectPointerCommit:true, selectKeyboardFocus:true, blurRelease:true, contextRecovery:true,
      finalDestinationMeasurement:true, physicalOutput:'muted', mobileOverflow:overflow, pageErrors:errors, missingAssets:missing, externalRequests:external};
  } catch (error) {
    if (page && config.screenshots) await page.screenshot({path:path.join(config.screenshots,`gameboy-${name}-failure.png`),fullPage:true}).catch(() => {});
    error.message = `${name}, ${stage}: ${error.message}; pageErrors=${JSON.stringify(errors)}; missing=${JSON.stringify(missing)}`;
    throw error;
  } finally {releaseInitialWasm(); await browser.close();}
}

(async () => {
  await fs.mkdir(path.dirname(config.out),{recursive:true});
  if (config.screenshots) await fs.mkdir(config.screenshots,{recursive:true});
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
      const filename = path.resolve(config.root, `.${pathname}`);
      if (!filename.startsWith(config.root + path.sep)) throw new Error('Outside server root');
      const bytes = await fs.readFile(filename);
      response.writeHead(200, {'Content-Type':mime[path.extname(filename)] ?? 'application/octet-stream'}); response.end(bytes);
    } catch {response.writeHead(404); response.end();}
  });
  const rows = [];
  try {
    await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [name,engine] of [['chromium',chromium],['webkit',webkit]]) rows.push(await runEngine(name,engine,origin));
    await fs.writeFile(config.out,JSON.stringify({passed:true,entry:config.entry,rows},null,2)+'\n');
    console.log(`Game Boy Synth browser check passed: ${rows.length} browsers; ${config.out}`);
  } catch (error) {
    await fs.writeFile(config.out,JSON.stringify({passed:false,entry:config.entry,error:error.message,rows},null,2)+'\n');
    throw error;
  } finally {if (server.listening) await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);process.exitCode = 1;});
