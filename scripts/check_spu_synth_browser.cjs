// Standalone SPU Synth: real public UI and AudioWorklet PCM in Chromium/WebKit.
// Every connection to the physical destination is intercepted and muted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {chromium, webkit} = require('playwright');
const {PROCESSOR_NAMES, processorSource, analyzePilotPcm, analyzeClockRows} = require('./audio_clock_audit.cjs');

const config = {root:path.resolve(__dirname, '../docs'), entry:'/synth-spu/index.html', out:null, screenshots:null, engines:[]};
const usage = 'Usage: node scripts/check_spu_synth_browser.cjs [--chromium-only | --webkit-only] [--root DIR] [--entry /synth-spu/index.html] [--out REPORT.json] [--screenshots DIR]';
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--help') {console.log(usage); process.exit(0);}
  if (['--chromium-only', '--webkit-only'].includes(arg)) {config.engines.push(arg.slice(2, -5)); continue;}
  const match = arg.match(/^--(root|entry|out|screenshots)(?:=(.*))?$/); assert(match, usage);
  const value = match[2] ?? process.argv[++i]; assert(value && !value.startsWith('--'), usage);
  config[match[1]] = match[1] === 'entry' ? value : path.resolve(value);
}
assert(config.engines.length <= 1, usage);
if (!config.engines.length) config.engines = ['chromium', 'webkit'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const served = new Map();
const panel = '#spuVoicePanel';
const control = name => `${panel} [data-chip-control="ps1-${name}"]`;
const action = name => `${panel} [data-chip-action="ps1-${name}"]`;

function instrumentation() {
  const audit = window.__spuSynthAudit = {contexts:[], worklets:[], sinks:new Map(), processorErrors:[], commands:[], states:[], captures:[]};
  const Context = window.AudioContext, Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect, post = MessagePort.prototype.postMessage;
  const labels = new WeakMap(); audit.connect = connect;
  window.AudioContext = class extends Context {constructor(...args) {super(...args); audit.contexts.push(this);}};
  if (window.webkitAudioContext === Context) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, ...args) {
      super(context, name, ...args); audit.worklets.push(name); labels.set(this.port, name);
      this.addEventListener('processorerror', () => audit.processorErrors.push(name));
      this.port.addEventListener('message', ({data}) => {
        const state = data?.state ?? data?.value;
        if (Array.isArray(state?.channels) && state.channels.length === 24 && Array.isArray(state.samples)) audit.states.push(state);
      });
    }
  };
  MessagePort.prototype.postMessage = function(data, ...args) {
    if (data && typeof data === 'object' && typeof data.method === 'string') audit.commands.push({name:labels.get(this) ?? null, method:data.method, args:structuredClone(data.args ?? [])});
    return post.call(this, data, ...args);
  };
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination === this.context.destination) {
      let sink = audit.sinks.get(this.context);
      if (!sink) {
        const sum = this.context.createGain(), gate = this.context.createGain(); gate.gain.value = 0;
        connect.call(sum, gate); connect.call(gate, destination); sink = {sum, gate}; audit.sinks.set(this.context, sink);
      }
      connect.call(this, sink.sum, ...args); return destination;
    }
    return connect.call(this, destination, ...args);
  };
  AudioNode.prototype.disconnect = function(...args) {
    if (args[0] === this.context.destination && audit.sinks.has(this.context)) args[0] = audit.sinks.get(this.context).sum;
    return disconnect.apply(this, args);
  };
}

async function capture(page, frames = 16384) {
  return page.evaluate(async ({frames, captureName, pilotName}) => {
    const audit = window.__spuSynthAudit;
    const context = [...audit.contexts].reverse().find(value => value.state !== 'closed' && audit.sinks.has(value));
    if (!context) throw Error('No live SPU Synth output graph');
    const sink = audit.sinks.get(context);
    if (!sink.capture) {
      await context.audioWorklet.addModule('/__spu_synth_capture.js');
      const node = new AudioWorkletNode(context, captureName, {numberOfInputs:2, numberOfOutputs:1, outputChannelCount:[2], processorOptions:{pilotInput:1}});
      const pilot = new AudioWorkletNode(context, pilotName, {numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[1]});
      audit.connect.call(pilot, node, 0, 1); audit.connect.call(sink.sum, node); audit.connect.call(node, sink.gate);
      sink.capture = node; sink.pilot = pilot; sink.sequence = 0;
      node.port.onmessage = ({data}) => {if (sink.pending?.id === data.id) {const pending = sink.pending; sink.pending = null; clearTimeout(pending.timer); pending.resolve(data);}};
    }
    const data = await new Promise((resolve, reject) => {
      if (sink.pending) throw Error('Concurrent SPU Synth capture'); const id = ++sink.sequence;
      const timer = setTimeout(() => {sink.pending = null; reject(Error('SPU Synth PCM capture timed out'));}, 10000);
      sink.pending = {id, resolve, timer}; sink.capture.port.postMessage({id, frames});
    });
    const pilot = window.__spuSynthClock.pilot(data.pilot, {expectedFrames:frames, pilotInputFrames:data.pilotInputFrames});
    const clock = window.__spuSynthClock.clock(data.rows);
    audit.captures.push({id:data.id, frames:data.left.length, pilot, clock});
    const channels = [data.left, data.right].map(values => {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      let peak = 0, energy = 0, nonFinite = 0, nonZero = 0; const crossings = [];
      for (let i = 0; i < values.length; i++) {
        const value = values[i]; peak = Math.max(peak, Math.abs(value)); energy += (value - mean) ** 2;
        if (!Number.isFinite(value)) nonFinite++; if (value !== 0) nonZero++;
        if (i && values[i - 1] < mean && value >= mean) crossings.push(i - 1 + (mean - values[i - 1]) / (value - values[i - 1]));
      }
      return {peak, rms:Math.sqrt(energy / values.length), nonFinite, nonZero, hz:crossings.length > 2 ? (crossings.length - 1) * context.sampleRate / (crossings.at(-1) - crossings[0]) : 0};
    });
    if (sink.gate.gain.value !== 0) throw Error('Physical SPU Synth output must remain muted');
    return {frames:data.left.length, sampleRate:context.sampleRate, channels, pilot, clock, frameGaps:data.frameGaps, physicalOutputMuted:true};
  }, {frames, captureName:PROCESSOR_NAMES.capture, pilotName:PROCESSOR_NAMES.pilot});
}

function assertPcm(pcm, label) {
  assert.equal(pcm.pilot.continuous, true, `${label}: independent PCM pilot ${JSON.stringify(pcm.pilot)}`);
  assert.equal(pcm.clock.measurementValid, true, `${label}: complete callback sequence`);
  assert.equal(pcm.clock.frames, pcm.frames, `${label}: complete captured frames`);
  assert.equal(pcm.clock.gapCount, pcm.frameGaps, `${label}: every clock anomaly retained`);
  assert(pcm.channels.every(channel => channel.nonFinite === 0), `${label}: finite PCM`);
}
async function audible(page, label, hz) {
  let pcm;
  for (let i = 0; i < 6; i++) {
    pcm = await capture(page); assertPcm(pcm, label);
    if (pcm.channels.every(channel => channel.rms > .0001 && channel.peak < 1 && (hz === undefined || Math.abs(channel.hz - hz) < Math.max(3, hz * .015)))) return pcm;
  }
  throw Error(`${label}: expected audible, unclipped${hz === undefined ? '' : ` ${hz} Hz`} PCM ${JSON.stringify(pcm)}`);
}
async function silent(page, label) {
  let pcm;
  for (let i = 0; i < 10; i++) {
    pcm = await capture(page, 4096); assertPcm(pcm, label);
    if (pcm.channels.every(channel => channel.nonZero === 0)) return pcm;
  }
  throw Error(`${label}: expected exact zero PCM ${JSON.stringify(pcm)}`);
}
async function field(page, name, value) {
  await page.locator(control(name)).evaluate((node, value) => {
    if (node.type === 'checkbox') node.checked = Boolean(value); else node.value = String(value);
    node.dispatchEvent(new Event('change', {bubbles:true})); node.blur();
  }, value);
}
const current = page => page.evaluate(() => __spuSynthAudit.states.at(-1));
async function refresh(page) {
  const before = await page.evaluate(() => __spuSynthAudit.states.length);
  await page.locator('#refreshVoice').click();
  await page.waitForFunction(before => __spuSynthAudit.states.length > before, before);
  return current(page);
}
async function applied(page, predicate) {
  await page.waitForFunction(predicate => {const state = __spuSynthAudit.states.at(-1); return Boolean(state && new Function('state', `return (${predicate})`)(state));}, predicate);
  return current(page);
}

function sineWav() {
  const rate = 44100, frames = 4410, bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 20000), 44 + i * 2);
  return bytes;
}

function noteFrequency(note) {
  const match = String(note).match(/^([A-G])([#b]?)(-?\d+)$/); assert(match, 'A visible keyboard note has standard pitch notation: ' + note);
  const semitone = {C:0, D:2, E:4, F:5, G:7, A:9, B:11}[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  return 440 * 2 ** (((Number(match[3]) + 1) * 12 + semitone - 69) / 12);
}
async function setSlider(page, selector, value) {
  await page.locator(selector).evaluate((node, value) => {node.value = String(value); node.dispatchEvent(new Event('input', {bubbles:true})); node.dispatchEvent(new Event('change', {bubbles:true}));}, value);
}
async function hold(page) {
  const button = page.locator(action('hold')); await button.scrollIntoViewIfNeeded(); const box = await button.boundingBox(); assert(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
}
async function release(page) {await page.mouse.move(2, 2); await page.mouse.up();}
async function fastEnvelope(page) {
  for (const [name, value] of Object.entries({'attack-rate':0, 'attack-exponential':false, 'decay-rate':0, 'sustain-level':15, 'sustain-rate':0, 'sustain-decrease':false, 'sustain-exponential':false, 'release-rate':0, 'release-exponential':false})) await field(page, name, value);
}

// No private production hooks, injected chip calls or fake renderers are used.
async function runCase(browser, name, origin) {
  const context = await browser.newContext({serviceWorkers:'block', viewport:{width:1440, height:1100}, acceptDownloads:true});
  await context.addInitScript({content:`globalThis.__spuSynthClock={pilot:${analyzePilotPcm.toString()},clock:${analyzeClockRows.toString()}};`});
  await context.addInitScript(instrumentation);
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const errors = [], failedResponses = [];
  page.on('pageerror', error => errors.push({message:error.message, stack:error.stack}));
  page.on('response', response => {if (response.status() >= 400) failedResponses.push({url:response.url(), status:response.status()});});
  try {
    console.log(`CHECK ${name}: lazy startup / hardware voices`);
    await page.goto(origin + config.entry, {waitUntil:'domcontentloaded'});
    await page.locator('#startAudio').waitFor({state:'visible'});
    assert.match(await page.title(), /Tetorica.*SPU.*Synth/i);
    assert.equal(await page.evaluate(() => __spuSynthAudit.contexts.length), 0, 'Opening the page remains audio-lazy');
    await page.locator('#startAudio').click();
    await page.locator(control('attack-rate')).waitFor({state:'visible'});
    await page.waitForFunction(() => __spuSynthAudit.states.length > 0 || document.getElementById('audioStatus').dataset.error === 'true');
    assert.notEqual(await page.locator('#audioStatus').getAttribute('data-error'), 'true', 'Audio startup: ' + await page.locator('#audioStatus').textContent());
    assert.equal(await page.locator(`${panel} [data-chip-channel]`).count(), 24, 'All 24 hardware voices have a selector');
    assert.equal(await page.evaluate(() => __spuSynthAudit.contexts.length), 1, 'A user action creates a single audio context');
    await page.locator(`${panel} [data-chip-channel="23"]`).click();
    await field(page, 'audition-midi', 69); await fastEnvelope(page);
    await field(page, 'reverb-send', false); await field(page, 'reverb-preset', 'off');
    const initial = await refresh(page); assert.equal(initial.channels.length, 24);
    assert(initial.channels[23].waveform?.pcm?.length > 0, 'The initial instrument exposes editable PCM');
    const idleFrom = await page.evaluate(() => __spuSynthAudit.commands.length);
    await page.waitForTimeout(250);
    const idleCommands = await page.evaluate(from => __spuSynthAudit.commands.slice(from), idleFrom);
    assert(!idleCommands.some(command => ['inspect', 'getState'].includes(command.method)), 'An idle editor performs no background SPU inspection');
    console.log(`CHECK ${name}: pointer sound / ADSR graph / keyboard pitch`);
    const pointerStart = await page.evaluate(() => __spuSynthAudit.commands.length);
    await hold(page); const pointerPcm = await audible(page, 'Pointer-held initial sine', 440);
    await release(page); const pointerRelease = await silent(page, 'Pointer release');
    const pointerCommands = await page.evaluate(from => __spuSynthAudit.commands.slice(from), pointerStart);
    assert.equal(pointerCommands.filter(command => command.method === 'auditionOn').length, 1, 'Pointer hold acquires one voice');
    assert.equal(pointerCommands.filter(command => command.method === 'auditionOff').length, 1, 'Pointer release releases one voice');

    await field(page, 'attack-rate', 32); await field(page, 'decay-rate', 4); await field(page, 'sustain-level', 8); await field(page, 'release-rate', 8);
    const beforeGraph = await refresh(page), handle = page.locator(`${panel} [data-chip-envelope-handle="attack"]`);
    await handle.scrollIntoViewIfNeeded(); const box = await handle.boundingBox(); assert(box, 'The ADSR graph exposes its attack handle');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, {steps:6}); await page.mouse.up();
    const afterGraph = await refresh(page);
    assert.notEqual(afterGraph.channels[23].envelopeParameters.attackRate, beforeGraph.channels[23].envelopeParameters.attackRate, 'Dragging the graph changes Attack');
    assert.deepEqual(afterGraph.channels.slice(0, 23).map(({adsr1, adsr2}) => ({adsr1, adsr2})), beforeGraph.channels.slice(0, 23).map(({adsr1, adsr2}) => ({adsr1, adsr2})), 'Graph editing preserves the other voices');
    await fastEnvelope(page);

    // Select a standard fretboard key from its visible pitch label, then use
    // real PC keydown/up while the physical sink remains permanently muted.
    await page.locator(action('keyboard')).click();
    const computerKey = page.locator('#keyboardMount .key[data-key="y"]');
    await computerKey.waitFor({state:'visible'}); const keyboardNote = (await computerKey.locator('span').textContent()).trim(), keyboardHz = noteFrequency(keyboardNote);
    await page.locator('#instrumentName').focus(); await page.keyboard.press('Tab');
    await page.locator('h1').click(); await page.keyboard.down('y');
    const keyboardPcm = await audible(page, 'PC keyboard', keyboardHz);
    const beforePitch = await refresh(page), held = beforePitch.auditions.find(entry => entry.channel === 23) ?? beforePitch.auditions[0];
    assert(held, 'The keyboard owns a sounding SPU voice');
    const pitchFrom = await page.evaluate(() => __spuSynthAudit.commands.length);
    await setSlider(page, '#pitchBend', 2); const bentPcm = await audible(page, 'Held-note pitch bend', keyboardHz * 2 ** (2 / 12));
    const bentState = await refresh(page);
    assert.equal(bentState.auditions.length, beforePitch.auditions.length, 'Pitch bending preserves note ownership');
    const pitchCommands = await page.evaluate(from => __spuSynthAudit.commands.slice(from), pitchFrom);
    assert(!pitchCommands.some(command => ['auditionOn', 'noteOn', 'keyOn'].includes(command.method)), 'Pitch bending never re-triggers the sample');
    await setSlider(page, '#pitchBend', 0); const centeredPcm = await audible(page, 'Pitch center', keyboardHz);
    await page.keyboard.up('y'); await silent(page, 'Computer key release');

    console.log(`CHECK ${name}: actual WAV import / portable preset round trip`);
    await page.locator('#sampleLoop').check(); await page.locator('#sampleRootNote').fill('69');
    const wav = sineWav(); await page.locator('#audioFileInput').setInputFiles({name:'browser-sine.wav', mimeType:'audio/wav', buffer:wav});
    await page.waitForFunction(() => document.getElementById('sampleName').textContent.includes('browser-sine'));
    const imported = await refresh(page); assert(imported.samples.length > initial.samples.length, 'Import creates a real sample descriptor');
    await hold(page); const importedPcm = await audible(page, 'Imported WAV'); await release(page); await silent(page, 'Imported WAV release');
    await page.locator('#instrumentName').fill('Browser round trip');
    const downloadPromise = page.waitForEvent('download'); await page.locator('#savePreset').click(); const download = await downloadPromise;
    const presetBytes = await fs.readFile(await download.path()), preset = JSON.parse(presetBytes.toString());
    assert.equal(preset.schema, 'tetorica-spu-synth.instrument'); assert.equal(preset.version, 1);
    await field(page, 'release-rate', 15); await applied(page, 'state.channels[23].envelopeParameters.releaseRate===15');
    await page.locator('#presetFileInput').setInputFiles({name:'browser-round-trip.json', mimeType:'application/json', buffer:presetBytes});
    const restored = await refresh(page); assert.equal(restored.channels[23].adsr1, imported.channels[23].adsr1); assert.equal(restored.channels[23].adsr2, imported.channels[23].adsr2);
    await page.locator(action('sustain')).click(); await audible(page, 'Restored preset');
    await page.locator('#stopAudio').click(); const stopped = await silent(page, 'Stop all voices');

    console.log(`CHECK ${name}: real audio failure / explicit user retry`);
    await page.evaluate(async () => {const context = [...__spuSynthAudit.contexts].reverse().find(value => value.state !== 'closed'); await context.close();});
    await page.waitForFunction(() => !document.getElementById('startAudio').disabled && /Enable audio/i.test(document.getElementById('startAudio').textContent));
    await page.locator('#startAudio').click();
    await page.waitForFunction(() => __spuSynthAudit.contexts.length === 2 && __spuSynthAudit.contexts.at(-1).state === 'running' && !document.getElementById('startAudio').disabled && /Audio ready/i.test(document.getElementById('startAudio').textContent));
    assert.equal(await page.locator('#instrumentName').inputValue(), 'Sine', 'A new audio session labels its actual fresh instrument');
    await page.waitForFunction(() => document.getElementById('sampleName').textContent.startsWith('Sine'));
    await field(page, 'audition-midi', 69); await hold(page); const recovery = await audible(page, 'Audio retry restores a real SPU voice', 440);
    await release(page); await silent(page, 'Recovered pointer release'); await page.locator('#stopAudio').click(); await silent(page, 'Recovered Stop');

    const screenshots = [];
    if (config.screenshots) {
      await fs.mkdir(config.screenshots, {recursive:true});
      for (const [label, width, height] of [['desktop', 1440, 1100], ['mobile', 390, 844]]) {
        await page.setViewportSize({width, height}); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const dimensions = await page.evaluate(() => ({viewport:innerWidth, document:document.documentElement.scrollWidth}));
        assert(dimensions.document <= dimensions.viewport + 1, 'SPU Synth fits ' + label + ': ' + JSON.stringify(dimensions));
        const filename = path.join(config.screenshots, `${name}-spu-synth-${label}.png`); await page.screenshot({path:filename, fullPage:true}); screenshots.push({label, path:filename, ...dimensions});
      }
    }
    const audit = await page.evaluate(() => ({worklets:__spuSynthAudit.worklets, processorErrors:__spuSynthAudit.processorErrors, physicalOutputMuted:[...__spuSynthAudit.sinks.values()].every(sink => sink.gate.gain.value === 0), captureContinuity:{captures:__spuSynthAudit.captures.length, frames:__spuSynthAudit.captures.reduce((sum, entry) => sum + entry.frames, 0), pcmContinuous:__spuSynthAudit.captures.every(entry => entry.pilot.continuous && entry.clock.measurementValid && entry.clock.frames === entry.frames), clockAnomalies:__spuSynthAudit.captures.filter(entry => !entry.clock.continuous)}}));
    assert(audit.worklets.includes('tetorica-spu-synth'), 'The dedicated real SPU AudioWorklet is used'); assert(audit.physicalOutputMuted); assert(audit.captureContinuity.pcmContinuous);
    assert.deepEqual(audit.processorErrors, []); assert.deepEqual(errors, [], 'No browser exceptions'); assert.deepEqual(failedResponses, [], 'No missing runtime assets');
    return {browser:name, version:browser.version(), audioLazy:true, hardwareVoices:24, idlePolling:false, pointer:{pcm:pointerPcm, release:pointerRelease}, graph:{before:beforeGraph.channels[23].envelopeParameters, after:afterGraph.channels[23].envelopeParameters, otherVoicesPreserved:true}, keyboard:{note:keyboardNote, pcm:keyboardPcm}, pitch:{bent:bentPcm, centered:centeredPcm, retriggered:false}, sample:{name:'browser-sine.wav', bytes:wav.length, pcm:importedPcm}, preset:{schema:preset.schema, version:preset.version, bytes:presetBytes.length, roundTrip:true}, stopped, recovery, screenshots, ...audit};
  } catch (error) {
    const state = await page.evaluate(() => ({title:document.title, status:document.getElementById('status')?.textContent, body:document.body?.innerText?.slice(0, 6000), contexts:__spuSynthAudit.contexts.map(context => ({state:context.state, sampleRate:context.sampleRate})), commands:__spuSynthAudit.commands.slice(-20), captures:__spuSynthAudit.captures.slice(-3)})).catch(() => null);
    throw Error(`${name}: ${error.message}\n${JSON.stringify({state, errors, failedResponses})}`, {cause:error});
  } finally {await context.close();}
}

(async () => {
  const helperPath = require.resolve('./audio_clock_audit.cjs'), checkerSha256 = hash(await fs.readFile(__filename)), captureHelperSha256 = hash(await fs.readFile(helperPath));
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/favicon.ico') {response.writeHead(204).end(); return;}
      if (pathname === '/__spu_synth_capture.js') {response.writeHead(200, {'Content-Type':'text/javascript', 'Cache-Control':'no-store'}).end(processorSource); return;}
      let filename = path.resolve(config.root, '.' + pathname); assert(filename === config.root || filename.startsWith(config.root + path.sep), 'Outside selected host');
      if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
      const bytes = await fs.readFile(filename), name = path.relative(config.root, filename), sha256 = hash(bytes);
      if (served.has(name)) assert.equal(served.get(name).sha256, sha256, 'Source changed during browser check: ' + name);
      served.set(name, {bytes:bytes.length, sha256});
      const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml', '.png':'image/png', '.woff':'font/woff', '.woff2':'font/woff2'};
      response.writeHead(200, {'Content-Type':mime[path.extname(filename)] ?? 'application/octet-stream', 'Cache-Control':'no-store'}).end(bytes);
    } catch (error) {response.writeHead(404).end(error.message);}
  });
  try {
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const results = [], origin = `http://127.0.0.1:${server.address().port}`;
    for (const name of config.engines) {
      const browser = await ({chromium, webkit})[name].launch({headless:true, ...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
      try {results.push(await runCase(browser, name, origin)); console.log(`PASS ${name}: standalone SPU Synth.`);} finally {await browser.close();}
    }
    for (const [name, entry] of served) assert.equal(hash(await fs.readFile(path.join(config.root, name))), entry.sha256, 'Source remained frozen: ' + name);
    assert.equal(hash(await fs.readFile(__filename)), checkerSha256, 'Checker stayed frozen throughout browser execution');
    assert.equal(hash(await fs.readFile(helperPath)), captureHelperSha256, 'Capture helper stayed frozen throughout browser execution');
    const report = {schemaVersion:1, passed:true, physicalOutputMuted:true, listeningPerformed:false, publicUiOnly:true, root:config.root, entry:config.entry, results, sources:Object.fromEntries([...served].sort(([a], [b]) => a.localeCompare(b))), checkerSha256, captureHelperSha256};
    if (config.out) await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
    console.log(`SPU Synth browser check passed: ${results.length} browsers${config.out ? '; ' + config.out : ''}.`);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error.stack ?? error); process.exitCode = 1;});
