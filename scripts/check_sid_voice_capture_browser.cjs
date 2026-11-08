// Explicit Player capture -> portable preset / same-origin Synth handoff.
// Every physical output of every tab is intercepted before app code runs.
// Only self-authored programs are loaded; no game tune, ROM or PCM is saved.
const {chromium, webkit} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');

const config = {root: path.resolve(__dirname, '../docs'), playerRoot: null, synthRoot: null,
  out: '/private/tmp/tetorica-sid-voice-capture-browser.json', screenshots: null};
const names = {'--root': 'root', '--player-root': 'playerRoot', '--synth-root': 'synthRoot', '--out': 'out', '--screenshots': 'screenshots'};
for (let i = 2; i < process.argv.length; ++i) {
  const key = names[process.argv[i]], value = process.argv[++i];
  assert(key && value && !value.startsWith('--'), 'Usage: --root docs --out JSON --screenshots DIR [--player-root ZIPDIR --synth-root ZIPDIR]');
  config[key] = path.resolve(value);
}
assert.equal(Boolean(config.playerRoot), Boolean(config.synthRoot), 'Both extracted package roots are required together');
const packaged = Boolean(config.playerRoot);
const playerEntry = packaged ? '/index.html' : '/sid-player/index.html';
const synthEntry = packaged ? '/synth-dist/index.html' : '/synth-sid/index.html';
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.sid': 'application/octet-stream'};
const report = {schemaVersion: 1, passed: false, packaged, playerEntry, synthEntry,
  physicalOutputMuted: true, listeningPerformed: false,
  fixtures: 'Original Tetorica register scenes and tiny PSID programs; no game tune, ROM dump or recorded audio', results: []};

function instrument() {
  const audit = window.__sidVoiceCaptureAudit = {contexts: [], worklets: [], sinks: [], messages: [],
    captureReads: [], captureReplies: [], handoffs: [], processorErrors: [], nextId: 0};
  const Context = window.AudioContext ?? window.webkitAudioContext, Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect, post = MessagePort.prototype.postMessage;
  const portRequests = new WeakMap();
  window.AudioContext = class extends Context {constructor(...args) {super(...args);audit.contexts.push(this);}};
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(...args) {
      super(...args);audit.worklets.push(this);const requests = new Map();portRequests.set(this.port, requests);
      this.addEventListener('processorerror', () => audit.processorErrors.push(args[1]));
      this.port.addEventListener('message', event => {
        const request = requests.get(event.data?.id);
        if (!request?.capture || request.received) return;
        request.received = true;
        audit.captureReplies.push({id: event.data.id, state: event.data.value, error: event.data.error ?? null});
        if (audit.holdManualReply) {
          audit.holdManualReply = false;event.stopImmediatePropagation();
          // Retain the actual CPU/Worklet reply, not a fabricated snapshot.
          // Stop/load may retire its client before this late reply is released.
          audit.releaseManualReply = () => {
            audit.releaseManualReply = null;
            this.port.dispatchEvent(new MessageEvent('message', {data: event.data}));
          };
        }
      });
    }
  };
  MessagePort.prototype.postMessage = function(data, ...args) {
    if (data?.method) audit.messages.push({id: data.id, method: data.method});
    if (data?.id > 0) {
      const capture = data.method === 'read' && audit.markCapture;
      if (capture) {audit.markCapture = false;audit.captureReads.push(data.id);}
      portRequests.get(this)?.set(data.id, {method: data.method, capture, received: false});
    }
    return post.call(this, data, ...args);
  };
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination === this.context.destination) {
      const analyser = this.context.createAnalyser(), mute = this.context.createGain();
      analyser.fftSize = 8192;mute.gain.value = 0;
      connect.call(this, analyser, ...args);connect.call(analyser, mute);connect.call(mute, destination);
      audit.sinks.push({context: this.context, analyser, mute});return destination;
    }
    return connect.call(this, destination, ...args);
  };
  audit.sample = () => {
    const active = audit.sinks.findLast(sink => sink.context.state === 'running');
    const muted = audit.sinks.every(sink => sink.mute.gain.value === 0);
    if (!active) return {rms: 0, peak: 0, finite: true, muted};
    const pcm = new Float32Array(active.analyser.fftSize);active.analyser.getFloatTimeDomainData(pcm);
    let square = 0, peak = 0;
    for (const value of pcm) {square += value * value;peak = Math.max(peak, Math.abs(value));}
    return {rms: Math.sqrt(square / pcm.length), peak, finite: pcm.every(Number.isFinite), muted};
  };
  audit.read = () => new Promise((resolve, reject) => {
    const node = audit.worklets.findLast(value => value.context.state !== 'closed'), id = --audit.nextId;
    if (!node) return reject(new Error('No open SID worklet'));
    const timer = setTimeout(() => {node.port.removeEventListener('message', receive);reject(new Error('Audit read timeout'));}, 5000);
    function receive({data}) {
      if (data?.id !== id) return;
      clearTimeout(timer);node.port.removeEventListener('message', receive);
      data.error ? reject(new Error(data.error)) : resolve(data.value);
    }
    node.port.addEventListener('message', receive);node.port.start();node.port.postMessage({id, method: 'read', args: []});
  });
  const setItem = Storage.prototype.setItem, getItem = Storage.prototype.getItem;
  Storage.prototype.setItem = function(key, value) {
    if (String(key).startsWith('tetorica.sid.voice-handoff.v1:')) audit.handoffs.push({key: String(key), value: JSON.parse(value)});
    return setItem.call(this, key, value);
  };
  audit.denyHandoffStorage = () => {
    Storage.prototype.getItem = function(key) {
      if (String(key).startsWith('tetorica.sid.voice-handoff.v1:')) throw new DOMException('Blocked for integration check', 'SecurityError');
      return getItem.call(this, key);
    };
  };
  audit.restoreHandoffStorage = () => {Storage.prototype.getItem = getItem;};
  // Exercise receiver cleanup without changing the explicitly requested token.
  // Other hash components must survive the application's one-time import.
  if (new URLSearchParams(location.hash.slice(1)).has('sid-voice')) {
    history.replaceState(history.state, '', location.pathname + location.search + location.hash + '&keep=hello%20world');
  }
}

function authoredUnsupportedScene(kind) {
  const program = [], write = (reg, value) => program.push(0xa9, value, 0x8d, reg & 255, reg >> 8);
  for (let reg = 0; reg <= 24; ++reg) write(0xd400 + reg, 0);
  for (let voice = 0; voice < 3; ++voice) {
    const base = 0xd400 + voice * 7;
    for (const [reg, value] of [[0, 0x45], [1, 0x1d], [2, 0], [3, 8], [5, 0], [6, 0xf5]]) write(base + reg, value);
    write(base + 4, kind === 'controls' ? [0x31, 0x23, 0x49][voice] : voice === 0 ? 0x21 : 0);
  }
  write(0xd417, kind === 'controls' ? 0 : 1);write(0xd418, 8);
  program.push(0x60);const play = 0x1000 + program.length;program.push(0x60);
  const bytes = new Uint8Array(124 + program.length), view = new DataView(bytes.buffer);
  bytes.set([80, 83, 73, 68]);view.setUint16(4, 2);view.setUint16(6, 124);view.setUint16(8, 0x1000);
  view.setUint16(10, 0x1000);view.setUint16(12, play);view.setUint16(14, 1);view.setUint16(16, 1);view.setUint16(118, 0x14);
  for (const [at, text] of [[22, 'Capture ' + kind], [54, 'Tetorica contributors'], [86, '2026 BSD-3-Clause']]) bytes.set(new TextEncoder().encode(text).subarray(0, 32), at);
  bytes.set(program, 124);return bytes;
}

async function checkBrowser(name, engine, origin, helpers) {
  const browser = await engine.launch({headless: true}), context = await browser.newContext({acceptDownloads: true, viewport: {width: 1180, height: 1000}});
  await context.addInitScript(instrument);
  const errors = [], consoleErrors = [], failures = [], external = [], checks = [], captures = [];
  let stage = 'startup', player;
  context.on('page', page => {
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {if (message.type() === 'error') consoleErrors.push(message.text());});
    page.on('response', response => {if (response.status() >= 400) failures.push({url: response.url(), status: response.status()});});
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) {external.push(url.href);return route.abort();}
    return route.continue();
  });
  const check = label => {stage = label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  const sample = page => page.evaluate(() => __sidVoiceCaptureAudit.sample());
  const sound = page => page.waitForFunction(() => {const value = __sidVoiceCaptureAudit.sample();return value.finite && value.muted && value.rms > .00001;});
  const silent = page => page.waitForFunction(() => {const value = __sidVoiceCaptureAudit.sample();return value.finite && value.muted && value.peak < 1e-8;});
  const ready = () => player.waitForFunction(() => document.getElementById('status').dataset.state === 'ready' && !document.getElementById('play').disabled);
  const play = async () => {await player.locator('#play').click();await player.waitForFunction(() => document.getElementById('status').dataset.state === 'playing');await sound(player);};
  const progressed = async () => {
    for (let attempt = 0; attempt < 160; ++attempt) {
      const state = await player.evaluate(() => __sidVoiceCaptureAudit.read());
      if (state.positionFrames > 0) return state;
      await player.waitForTimeout(25);
    }
    throw new Error('The actual SID Worklet has not rendered a frame');
  };
  const stop = async () => {await player.locator('#stop').click();await silent(player);};
  async function capture() {
    const before = await player.evaluate(() => __sidVoiceCaptureAudit.captureReads.length);
    await player.evaluate(() => {__sidVoiceCaptureAudit.markCapture = true;document.getElementById('captureVoiceNow').click();});
    await player.waitForFunction(() => document.getElementById('captureVoiceStatus').textContent.startsWith('Snapshot captured.'));
    const observed = await player.evaluate(() => ({reads: __sidVoiceCaptureAudit.captureReads, reply: __sidVoiceCaptureAudit.captureReplies.at(-1)}));
    assert.equal(observed.reads.length, before + 1);assert(observed.reply.id > 0 && !observed.reply.error);
    assert.equal(observed.reply.id, observed.reads.at(-1));assert(observed.reply.state.positionFrames > 0);
    return observed.reply.state;
  }
  async function downloadPreset(page, id) {
    const pending = page.waitForEvent('download');await page.locator('#' + id).click();const download = await pending;
    const data = await fs.readFile(await download.path());
    const value = JSON.parse(data.toString());assert.deepEqual(helpers.readPreset(value), value);
    return {value, data};
  }
  async function loadBytes(bytes, filename) {
    await player.locator('#sidFile').setInputFiles({name: filename, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes)});await ready();
  }
  async function auditionSynth(page, expected) {
    await page.waitForSelector('#instrumentName', {state: 'attached'});
    assert.equal(await page.evaluate(() => __sidVoiceCaptureAudit.contexts.length), 0, 'receiving or loading a preset must not allocate audio');
    assert.equal(await page.locator('#instrumentName').inputValue(), expected.name);
    assert.equal(await page.locator('#sidModelBadge').textContent(), expected.model);
    const key = await page.locator('#keyboard .key:not([disabled])').first().getAttribute('data-key');assert(key);
    await page.keyboard.down(key);await page.waitForFunction(() => document.getElementById('startAudio').textContent.includes('ready'));await sound(page);
    const state = await page.evaluate(() => __sidVoiceCaptureAudit.read());assert.deepEqual(state.preset, expected);assert.equal(state.model, expected.model);assert.equal(state.voices.length, 1);
    captures.push({check: stage, model: state.model, audition: await sample(page)});
    await page.keyboard.up(key);await page.locator('#stopAudio').click();await silent(page);
    if (!await page.locator('#presetTools').evaluate(node => node.open)) await page.locator('#presetTools > summary').click();
    const saved = await downloadPreset(page, 'savePreset');assert.deepEqual(saved.value, expected);
    return saved;
  }
  try {
    player = await context.newPage();await player.goto(origin + playerEntry);await player.waitForSelector('#voiceCapture');
    check('snapshot controls are folded and audio-free until explicit playback and capture');
    assert.equal(await player.locator('#voiceCapture').evaluate(node => node.open), false);
    assert.equal(await player.locator('#captureVoiceNow').isDisabled(), true);assert.equal(await player.locator('#saveVoicePreset').isDisabled(), true);
    await player.locator('#voiceCapture > summary').click();await player.locator('#captureVoiceNow').evaluate(node => node.click());
    assert.equal(await player.evaluate(() => __sidVoiceCaptureAudit.contexts.length), 0);
    assert.match(await player.locator('#captureVoiceNotice').textContent(), /Instantaneous.*Envelope.*automation/);
    await player.locator('#demo').selectOption('tone');await player.locator('#loadDemo').click();await ready();
    assert.equal(await player.evaluate(() => __sidVoiceCaptureAudit.contexts.length), 0);await play();

    check('Capture now uses a fresh coherent real Worklet read and saves exactly its selected voice');
    const toneState = await capture(), toneMetadata = {name: await player.locator('#title').textContent(), subtune: Number(await player.locator('#subtune').inputValue())};
    const toneExpected = helpers.captureSidVoices(toneState, toneMetadata).voices[0].preset;assert(toneExpected);
    const tone = await downloadPreset(player, 'saveVoicePreset');assert.deepEqual(tone.value, toneExpected);
    assert.equal(tone.value.model, '6581');assert.equal(tone.value.voice.waveform, 'triangle');
    assert.equal(tone.value.filter.enabled, false);assert.equal(tone.value.filter.volume, toneState.registers[24] & 15);
    captures.push({model: '6581', capturePositionFrames: toneState.positionFrames, captureReadId: await player.evaluate(() => __sidVoiceCaptureAudit.captureReads.at(-1)), preset: tone.value});
    await player.locator('[data-snapshot-voice="1"]').click();assert.equal(await player.locator('#saveVoicePreset').isDisabled(), true);
    assert.match(await player.locator('#captureVoicePreview').textContent(), /No oscillator waveform/);
    await player.locator('[data-snapshot-voice="0"]').click();assert.equal(await player.locator('#saveVoicePreset').isDisabled(), false);

    check('Stop and new-file selection cancel delayed real capture replies while preserving the accepted snapshot');
    const acceptedInfo = await player.locator('#captureVoiceInfo').textContent();
    for (const change of ['stop', 'load']) {
      if (change === 'load') await play();
      await player.evaluate(() => {const audit = __sidVoiceCaptureAudit;audit.markCapture = true;audit.holdManualReply = true;document.getElementById('captureVoiceNow').click();});
      await player.waitForFunction(() => typeof __sidVoiceCaptureAudit.releaseManualReply === 'function');
      if (change === 'stop') await stop();
      else await loadBytes(helpers.tone, 'another-authored-tone.sid');
      await player.evaluate(() => __sidVoiceCaptureAudit.releaseManualReply());await player.waitForTimeout(80);
      assert.equal(await player.locator('#captureVoiceInfo').textContent(), acceptedInfo);
      assert.match(await player.locator('#captureVoiceStatus').textContent(), /cancelled.*Previous snapshot kept/);
      assert.equal(await player.locator('#saveVoicePreset').isDisabled(), false);
      assert.deepEqual((await downloadPreset(player, 'saveVoicePreset')).value, tone.value);
    }

    for (const model of ['6581', '8580']) {
      check(`${model} real playback captures its applied model, shared filter route and hardware codes`);
      await loadBytes(model === '6581' ? helpers.tone : helpers.filtered8580, 'capture-' + model + '.sid');await play();
      if (model === '8580') await player.locator('#sidModel').evaluate(node => {node.value = '6581';}); // A draft display is not the running core.
      const observed = await capture(), metadata = {name: await player.locator('#title').textContent(), subtune: Number(await player.locator('#subtune').inputValue())};
      if (model === '8580') await player.locator('#sidModel').evaluate(node => {node.value = 'auto';});
      const expected = helpers.captureSidVoices(observed, metadata).voices[0].preset;assert(expected);assert.equal(expected.model, model);
      const saved = await downloadPreset(player, 'saveVoicePreset');assert.deepEqual(saved.value, expected);
      if (model === '8580') {assert.equal(expected.filter.enabled, true);assert.equal(expected.filter.mode, 'lowpass');assert.equal(expected.filter.cutoff, 512);assert.equal(expected.filter.resonance, 12);assert.match(await player.locator('#captureVoicePreview').textContent(), /Envelope is unavailable/);}

      if (!packaged && model === '6581') {
        check('blocked browser storage keeps playback and snapshot, and explains portable Save / Load fallback');
        await player.evaluate(() => __sidVoiceCaptureAudit.denyHandoffStorage());
        const pages = context.pages().length;await player.locator('#openSnapshotSynth').click();
        await player.waitForFunction(() => document.getElementById('captureVoiceStatus').textContent.includes('Automatic transfer unavailable'));
        assert.equal(context.pages().length, pages);assert.equal(await player.locator('#saveVoicePreset').isDisabled(), false);await sound(player);
        await player.evaluate(() => __sidVoiceCaptureAudit.restoreHandoffStorage());assert.deepEqual((await downloadPreset(player, 'saveVoicePreset')).value, expected);
      }
      let synth;
      if (!packaged) {
        check(`${model} explicit same-origin handoff is single-use, preserves unrelated storage/hash and starts no Synth audio`);
        await player.evaluate(() => localStorage.setItem('sid-capture-unrelated', 'keep'));
        assert.equal(await player.locator('#openSnapshotSynth').getAttribute('aria-disabled'), 'false');
        const opened = context.waitForEvent('page');await player.locator('#openSnapshotSynth').click();synth = await opened;
        await synth.waitForFunction(() => document.getElementById('audioStatus')?.textContent.includes('snapshot loaded'));
        const transfer = await player.evaluate(() => __sidVoiceCaptureAudit.handoffs.at(-1));
        assert.deepEqual(Object.keys(transfer.value).sort(), ['createdAt', 'format', 'preset', 'version']);assert.deepEqual(transfer.value.preset, expected);
        assert.equal(await synth.evaluate(key => localStorage.getItem(key), transfer.key), null);
        assert.equal(await synth.evaluate(() => localStorage.getItem('sid-capture-unrelated')), 'keep');assert.equal(await synth.evaluate(() => location.hash), '#keep=hello%20world');
        await stop();await auditionSynth(synth, expected);
      } else {
        check(`${model} standalone cross-origin link uses portable preset download / Synth Load preset without external navigation`);
        assert.equal(await player.locator('#openSnapshotSynth').getAttribute('aria-disabled'), 'true');
        const pages = context.pages().length;await player.locator('#openSnapshotSynth').evaluate(node => node.click());
        assert.equal(context.pages().length, pages);assert.match(await player.locator('#captureVoiceStatus').textContent(), /Save preset.*Load preset.*same host/);
        await stop();synth = await context.newPage();await synth.goto(origin + synthEntry);await synth.waitForSelector('#presetFileInput', {state: 'attached'});
        assert.equal(await synth.evaluate(() => __sidVoiceCaptureAudit.contexts.length), 0);
        await synth.locator('#presetFileInput').setInputFiles({name: 'captured.json', mimeType: 'application/json', buffer: saved.data});
        await synth.waitForFunction(name => document.getElementById('instrumentName').value === name, expected.name);
        await auditionSynth(synth, expected);
      }
      for (const width of [1180, 390]) {
        await player.setViewportSize({width, height: width === 390 ? 844 : 1000});
        assert.equal(await player.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)), 0);
        if (config.screenshots) await player.screenshot({path: path.join(config.screenshots, `${name}-${model}-player-${width}.png`), fullPage: true});
      }
      await player.setViewportSize({width: 1180, height: 1000});
      if (config.screenshots) {await synth.setViewportSize({width: 390, height: 844});await synth.screenshot({path: path.join(config.screenshots, `${name}-${model}-synth-390.png`), fullPage: true});}
      await synth.close();
    }

    check('unsupported combined / Sync / TEST and routed-all-off controls report reasons from actual authored CPU programs');
    await loadBytes(authoredUnsupportedScene('controls'), 'unsupported-controls.sid');
    await player.locator('#play').click();await player.waitForFunction(() => document.getElementById('status').dataset.state === 'playing');await progressed();await capture();
    for (const [voice, reason] of [[0, /Combined waveforms/], [1, /Sync \/ Ring/], [2, /TEST is held/]]) {
      await player.locator(`[data-snapshot-voice="${voice}"]`).click();assert.equal(await player.locator('#saveVoicePreset').isDisabled(), true);assert.match(await player.locator('#captureVoicePreview').textContent(), reason);
    }
    await stop();await loadBytes(authoredUnsupportedScene('silent-route'), 'unsupported-filter-route.sid');
    await player.locator('#play').click();await player.waitForFunction(() => document.getElementById('status').dataset.state === 'playing');await progressed();await capture();
    await player.locator('[data-snapshot-voice="0"]').click();assert.match(await player.locator('#captureVoicePreview').textContent(), /filter with no enabled outputs/);assert.equal(await player.locator('#saveVoicePreset').isDisabled(), true);await stop();

    assert.deepEqual(errors, []);assert.deepEqual(consoleErrors, []);assert.deepEqual(failures, []);assert.deepEqual(external, []);
    for (const page of context.pages()) assert.deepEqual(await page.evaluate(() => __sidVoiceCaptureAudit.processorErrors), []);
    report.results.push({browser: name, version: browser.version(), passed: true, checks, captures, errors, consoleErrors, failures, external});
    console.log(`PASS ${name}: ${checks.length} voice capture checks, all physical audio muted.`);
  } catch (error) {
    if (config.screenshots && player) await player.screenshot({path: path.join(config.screenshots, `${name}-failed.png`), fullPage: true}).catch(() => {});
    const status = await player?.evaluate(() => ({status: document.getElementById('status')?.textContent, capture: document.getElementById('captureVoiceStatus')?.textContent, preview: document.getElementById('captureVoicePreview')?.textContent})).catch(() => ({}));
    report.results.push({browser: name, passed: false, stage, error: error.message, errors, consoleErrors, failures, external, status});
    throw new Error(`${name} (${stage}): ${error.message}; ${JSON.stringify({errors, consoleErrors, failures, external, status})}`, {cause: error});
  } finally {await context.close();await browser.close();}
}

(async () => {
  const {createSid8580MachineFixture} = await import('../test/helpers/sid8580_machine_fixtures.mjs');
  const {createSidReferenceFixture} = await import('../test/fixtures/sid-reference/fixture.mjs');
  const {captureSidVoices} = await import('../docs/sid-player/voice_snapshot.js');
  const {readPreset} = await import('../docs/synth-sid/preset.js');
  const helpers = {tone: createSidReferenceFixture('tone').bytes,
    filtered8580: createSid8580MachineFixture('bus-immediate', {filter: true}).bytes, captureSidVoices, readPreset};
  if (config.screenshots) await fs.mkdir(config.screenshots, {recursive: true});
  report.checkerSha256 = createHash('sha256').update(await fs.readFile(__filename)).digest('hex');
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const synth = packaged && pathname.startsWith('/synth-dist/');
      const base = synth ? config.synthRoot : config.playerRoot ?? config.root;
      const relative = synth ? pathname.slice('/synth-dist'.length) : pathname;
      const file = path.resolve(base, '.' + relative);assert(file.startsWith(base + path.sep));
      const bytes = await fs.readFile(file);response.writeHead(200, {'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store'});response.end(bytes);
    } catch {response.writeHead(404);response.end();}
  });
  await new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve);});
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) await checkBrowser(name, engine, origin, helpers);
    report.passed = true;
  } finally {await new Promise(resolve => server.close(resolve));await fs.mkdir(path.dirname(config.out), {recursive: true});await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');}
})().catch(error => {console.error(error);process.exitCode = 1;});
