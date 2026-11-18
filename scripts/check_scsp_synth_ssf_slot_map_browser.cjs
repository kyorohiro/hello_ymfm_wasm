// SPDX-License-Identifier: BSD-3-Clause
// Observe an original SSF through real playback; every physical audio route is muted before initialization.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium, webkit } = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {
  root: path.join(repository, 'docs'), entry: '/synth-scsp/index.html', engines: 'chromium,webkit',
  out: path.join(os.tmpdir(), 'scsp-synth-ssf-slot-map-browser.json'),
  screenshots: null,
};
const arguments_ = process.argv.slice(2);
for (let index = 0; index < arguments_.length; index++) {
  const match = /^--(root|entry|engines|out|screenshots)(?:=(.+))?$/.exec(arguments_[index]);
  assert(match, 'Unknown argument ' + arguments_[index]);
  config[match[1]] = match[2] ?? arguments_[++index];
  assert(config[match[1]], 'Missing value for ' + match[1]);
}
config.root = path.resolve(config.root);
config.out = path.resolve(config.out);
config.screenshots = path.resolve(config.screenshots ?? config.out.replace(/\.json$/, '') + '-screenshots');
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry));
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const served = new Map(), serverMissing = [];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.md': 'text/plain', '.scspasm': 'text/plain' };
const server = http.createServer(async (request, response) => {
  try {
    let relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (relative === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (relative.endsWith('/')) relative += 'index.html';
    const file = path.resolve(config.root, '.' + relative);
    assert(file.startsWith(config.root + path.sep));
    const bytes = await fs.readFile(file), name = path.relative(config.root, file).split(path.sep).join('/');
    const record = { bytes: bytes.length, sha256: sha(bytes) };
    assert(!served.has(name) || served.get(name).sha256 === record.sha256, 'Source changed during verification: ' + name);
    served.set(name, record);
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(bytes);
  } catch (error) { serverMissing.push({ url: request.url, error: error.message }); response.writeHead(404).end(); }
});

// The app cannot access the extra zero-gain nodes. This guard is installed in
// the context before any app JS or AudioContext / worklet is initialized.
function installSilentAudit() {
  const Context = window.AudioContext ?? window.webkitAudioContext, Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect, post = MessagePort.prototype.postMessage;
  const audit = window.__scspSlotMapAudit = { contexts: [], nodes: [], meters: [], commands: [], processorErrors: [], sequence: 0 };
  window.AudioContext = class extends Context {
    constructor(options = {}) { super({ ...options, sampleRate: 48000 }); audit.contexts.push(this); }
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, options) {
      super(context, name, options); audit.nodes.push({ name, node: this });
      this.addEventListener('processorerror', () => audit.processorErrors.push(name));
    }
  };
  AudioNode.prototype.connect = function (destination, ...rest) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...rest);
    const analyser = this.context.createAnalyser(), mute = this.context.createGain();
    analyser.fftSize = 2048; mute.gain.value = 0;
    connect.call(this, analyser, ...rest); connect.call(analyser, mute); connect.call(mute, destination);
    audit.meters.push({ analyser, mute }); return destination;
  };
  MessagePort.prototype.postMessage = function (data, ...rest) {
    if (data?.method || data?.type === 'chip-inspector') audit.commands.push(structuredClone(data));
    return post.call(this, data, ...rest);
  };
  audit.graph = () => ({ contexts: audit.contexts.length, rates: audit.contexts.map(context => context.sampleRate),
    worklets: audit.nodes.map(value => value.name), destinationEdges: audit.meters.length,
    physicalOutputMuted: audit.meters.every(value => value.mute.gain.value === 0), processorErrors: [...audit.processorErrors] });
  audit.level = () => {
    let peak = 0;
    for (const { analyser } of audit.meters) {
      if (analyser.context.state === 'closed') continue;
      const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values);
      for (const value of values) { if (!Number.isFinite(value)) throw Error('Non-finite Master output'); peak = Math.max(peak, Math.abs(value)); }
    }
    return { peak, muted: audit.meters.every(value => value.mute.gain.value === 0) };
  };
  audit.request = (method, args = []) => new Promise((resolve, reject) => {
    const node = audit.nodes.findLast(value => value.name === 'tetorica-scsp-synth')?.node;
    if (!node) return reject(Error('Primary Synth is unavailable'));
    const id = 'ssf-slot-map-' + ++audit.sequence;
    const timer = setTimeout(() => { node.port.removeEventListener('message', receive); reject(Error('Primary Synth request timed out')); }, 5000);
    function receive({ data }) {
      if (data?.id !== id) return;
      clearTimeout(timer); node.port.removeEventListener('message', receive);
      data.error ? reject(Error(data.error)) : resolve(data.value);
    }
    node.port.addEventListener('message', receive); node.port.start(); node.port.postMessage({ id, method, args });
  });
  audit.writes = () => audit.commands.filter(command => {
    if (command.type === 'chip-inspector') return command.action !== 'read' && command.method !== 'getPCM';
    if (command.method === 'invokePhysical' && command.args?.[0] === 'getPCM') return false;
    return ['setConfig', 'setEffect', 'setDspSend', 'setDspSourceSend', 'setDspReturn', 'applyDspProgram',
      'setDspCoefficients', 'loadPatch', 'invokePhysical', 'write', 'reset'].includes(command.method);
  });
}
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(read, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await delay(25); }
  throw Error('Timed out: ' + label);
}
const graph = page => page.evaluate(() => __scspSlotMapAudit.graph());
const level = page => page.evaluate(() => __scspSlotMapAudit.level());
const request = (page, method, args = []) => page.evaluate(({ method, args }) => __scspSlotMapAudit.request(method, args), { method, args });
const writes = page => page.evaluate(() => __scspSlotMapAudit.writes());
const control = (page, name) => page.locator('#voice [data-chip-control="scsp-' + name + '"]');
const authoring = async page => {
  const value = await request(page, 'readAuthoring');
  return JSON.stringify({ config: value.state.config, operators: value.operators });
};
async function view(page) {
  return page.evaluate(() => {
    const root = document.getElementById('scspSsfSlotRoutes'), live = document.getElementById('scspSsfLive');
    const text = name => document.getElementById('scspSsfRoute' + name)?.textContent;
    return { available: root?.dataset.available, frame: root?.dataset.frame, slot: root?.dataset.slot, playback: root?.dataset.playback,
      hidden: root?.hidden, liveFrame: live.dataset.frame, liveActive: live.dataset.active,
      source: document.getElementById('scspChannelTabs').dataset.source,
      selected: document.querySelector('#scspChannelTabs [aria-selected="true"]')?.dataset.scspChannel,
      voiceSlot: document.getElementById('voice').dataset.ssfSlot,
      position: Number(document.getElementById('scspSongSeek').value), pause: document.getElementById('scspSongPause').textContent,
      status: document.getElementById('status').textContent,
      fields: Object.fromEntries(['Badge', 'Frame', 'Status', 'Diagram', 'X', 'Y', 'Selected', 'Source', 'Depth', 'Write', 'Activity', 'Direct', 'Send'].map(name => [name, text(name)])),
      controls: root?.querySelectorAll('input,button,textarea,select').length,
      channels: [...document.querySelectorAll('#scspChannelTabs [data-scsp-channel]')].map(button => ({
        channel: button.dataset.scspChannel, active: button.dataset.active, gate: button.dataset.gate,
        phase: button.dataset.phase, env: button.style.getPropertyValue('--scsp-env'), title: button.title,
      })),
    };
  });
}
const aligned = value => value.available === 'true' && value.frame === value.liveFrame && value.selected === value.slot && value.voiceSlot === value.slot;
const waitView = (page, predicate, label) => until(async () => { const value = await view(page); return predicate(value) ? value : false; }, label);
async function select(page, slot) {
  await page.locator('#scspChannelTabs [data-scsp-channel="' + slot + '"]').click();
  return waitView(page, value => value.selected === String(slot) && (value.source !== 'ssf' || aligned(value)), 'selected CH ' + slot);
}
async function seek(page, seconds) {
  await page.locator('#scspSongSeek').evaluate((node, seconds) => {
    node.value = String(seconds); node.dispatchEvent(new Event('change', { bubbles: true }));
  }, seconds);
  return waitView(page, value => aligned(value) && value.pause === 'Resume' && Math.abs(value.position - seconds) < .1, 'paused seek ' + seconds);
}
async function canvas(page) {
  return page.locator('#voice canvas').evaluate(async node => {
    const bytes = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].join(',');
  });
}

/** No game data: patch original authored fixture register immediates, then run
 * an original countdown and KEYONEX key-off so real Release remains visible. */
async function originalFixture() {
  const fixtures = await import(pathToFileURL(path.join(repository, 'test/helpers/scsp_ssf_fixture.mjs')).href);
  const original = fixtures.createScspSsfCaptureFixture(), image = original.image.slice(), words = new DataView(image.buffer);
  const replacements = new Map([[0x10000a, 0x3c00], [0x10000e, 0x5fff], [0x100014, 3 << 3],
    [0x10002c, 0x200 | 32], [0x10002e, 0x3fdf], [0x100034, (3 << 3) | 7]]);
  for (let at = 0x100; at < original.image.length - 8; at += 2) {
    if (words.getUint16(at, false) !== 0x33fc) continue;
    const target = words.getUint32(at + 4, false);
    if (replacements.has(target)) words.setUint16(at + 2, replacements.get(target), false);
  }
  // The capture fixture stops at the first BRA.S-to-self in its main driver.
  let stop = null;
  for (let at = 0x100; at < 0x600; at += 2) if (words.getUint16(at, false) === 0x60fe) { stop = at; break; }
  assert.notEqual(stop, null);
  words.setUint16(stop, 0x4ef9, false); words.setUint32(stop + 2, 0x700, false);
  let at = 0x700;
  const word = value => { words.setUint16(at, value, false); at += 2; };
  const long = value => { words.setUint32(at, value, false); at += 4; };
  word(0x203c); long(2000000); word(0x5380); word(0x66fc); // MOVE.L / SUBQ / BNE countdown.
  word(0x33fc); word(0x1020); long(0x100000); // KEYONEX, CH1 KEYONB Off; CH2 stays held.
  word(0x33fc); word(0x0fdf); long(0x10002e); // CH2 MDL=0, retaining raw X/Y for independent audition / Capture.
  word(0x60fe);
  const bytes = fixtures.ssfFromProgram(image, 0, 'title=Tetorica original SSF slot routes and Release\nartist=Tetorica\nlength=0:30\nfade=0\n');
  const { prepareScspSsfSource } = await import(pathToFileURL(path.join(repository, 'docs/synth-scsp/ssf_source.js')).href);
  const { createScspSsfRenderer } = await import(pathToFileURL(path.join(repository, 'docs/synth-scsp/ssf_renderer.js')).href);
  const source = await prepareScspSsfSource([{ path: '/ssf/routes.ssf', data: bytes }], '/ssf/routes.ssf');
  const wasmBinary = await fs.readFile(path.join(repository, 'docs/generated/ssf-player/ssf_player.wasm'));
  const renderer = await createScspSsfRenderer(source, { wasmBinary });
  let gateFrame = null, releaseFrame = null;
  try {
    for (let index = 0; index < 500; index++) {
      renderer.process(new Float32Array(1024), new Float32Array(1024), 1024);
      const snapshot = renderer.readSnapshot(), slot = snapshot.slots[0];
      if (slot.active && slot.gate) gateFrame ??= snapshot.frame;
      if (slot.active && !slot.gate && slot.envelopePhase === 3) { releaseFrame = snapshot.frame; break; }
    }
  } finally { renderer.dispose(); }
  assert(gateFrame !== null && releaseFrame !== null, 'Real renderer fixture includes Gate then active Release');
  return { bytes, image, gateFrame, releaseFrame, releaseSeconds: releaseFrame / 44100 + .1 };
}

async function exercise(engine, origin, fixture) {
  const browser = await ({ chromium, webkit }[engine]).launch({ headless: true, ...(engine === 'chromium' ? { args: ['--mute-audio'] } : {}) });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } }), page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [], missing = [], external = [], blockedMonaco = [], cases = [], screenshots = {}, observations = {};
  let stage = 'startup';
  const step = label => { stage = label; console.log('CHECK ' + engine + ': ' + label); };
  await context.addInitScript(installSilentAudit);
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    const url = route.request().url();
    (/monaco|jsdelivr/.test(url) ? blockedMonaco : external).push(url); return route.abort();
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) missing.push({ url: response.url(), status: response.status() }); });
  try {
    step('one permanent Auto / CH selector remains passive');
    await page.goto(origin + config.entry);
    await page.waitForFunction(() => document.getElementById('scspFilesPanel').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#scspChannelTabs [data-scsp-channel]').count(), 33);
    assert.equal(await page.locator('#scspSsfSlot,#scspSsfSlots').count(), 0);
    assert.equal((await view(page)).selected, 'auto');
    await select(page, 31); await select(page, 'auto');
    assert.equal((await graph(page)).contexts, 0);
    await page.click('[data-chip-action="scsp-square"]');
    await control(page, 'root').fill('500'); await control(page, 'root').dispatchEvent('change');
    const draft = await canvas(page);
    await page.locator('#ssfFileInput').setInputFiles({ name: 'original-slot-routes.ssf', mimeType: 'application/octet-stream', buffer: Buffer.from(fixture.bytes) });
    await until(() => page.locator('#scspSongPlay').isEnabled(), 'original SSF import');
    assert.equal((await graph(page)).contexts, 0, 'Importing SSF never starts audio');
    await page.click('#start');
    await page.waitForFunction(() => __scspSlotMapAudit.nodes.some(value => value.name === 'tetorica-scsp-synth') && !document.getElementById('start').disabled);
    const authored = await authoring(page), patch = await request(page, 'exportPatch'), dsp = await request(page, 'readDspSetup');
    cases.push('One 33-button Auto/CH row; physical selection and original SSF import stay passive before AudioContext initialization');

    step('real Play snapshots show selected raw stack references and distinct Direct / MIXS paths');
    await page.check('#scspSsfLiveEnabled'); await page.click('#scspSongPlay');
    let current = await waitView(page, value => aligned(value) && Number(value.frame) > 0 && value.playback === 'Live', 'real Live route snapshot');
    current = await select(page, 0);
    assert.equal(current.controls, 0); assert.equal(current.hidden, false);
    assert.match(current.fields.X, /offset 63/); assert.match(current.fields.Y, /offset 63/);
    assert.match(current.fields.Depth, /MDL 5.*enabled/); assert.match(current.fields.Write, /STWINH Off.*allowed/);
    assert.match(current.fields.Direct, /Level 7.*Pan 0/); assert.match(current.fields.Send, /MIXS3.*IMXL 0/);
    assert.match(current.fields.Diagram, /Sound Stack/);
    assert.doesNotMatch(current.fields.Diagram, /CH32|CH\d+\s*[→>]\s*CH\d+|\bOperator [AB]\b|\bCarrier\b|\bModulator\b|\bReturn 3\b/i);
    const firstFrame = Number(current.frame), writeBaseline = await writes(page);
    observations.play = current;
    await page.locator('#scspChannelTabs [data-scsp-channel="0"]').focus();
    await waitView(page, value => aligned(value) && Number(value.frame) > firstFrame + 2048, 'advancing audible-position snapshots');
    assert(await page.locator('#scspChannelTabs [data-scsp-channel="0"]').evaluate(node => node === document.activeElement), 'Polling retains channel keyboard focus');
    const audible = await until(async () => { const value = await level(page); return value.muted && value.peak > .00005 ? value : false; }, 'finite permanently muted real Master PCM');
    cases.push('Play follows actual audible-position frames; repeated raw X/Y=63 remains two Sound Stack references, MDL/STWINH and Direct/MIXS are explicit without invented CH producers');

    step('Pause freezes the snapshot; selection reads a different route without register writes');
    await page.click('#scspSongPause');
    const paused = await waitView(page, value => aligned(value) && value.playback === 'Paused' && value.pause === 'Resume', 'paused route snapshot');
    const frozen = value => JSON.stringify({ frame: value.frame, position: value.position, channels: value.channels });
    await delay(180); assert.equal(frozen(await view(page)), frozen(paused));
    current = await select(page, 1);
    assert.equal(current.frame, paused.frame); assert.equal(current.position, paused.position);
    assert.match(current.fields.X, /offset 63/); assert.match(current.fields.Y, /offset 31/);
    assert.match(current.fields.Depth, /MDL 3.*bypassed/); assert.match(current.fields.Write, /STWINH On.*inhibited/);
    assert.match(current.fields.Direct, /Level 5.*Pan 6/); assert.match(current.fields.Send, /MIXS3.*IMXL 7/);
    await select(page, 31); current = await select(page, 1);
    assert.equal(current.frame, paused.frame); assert.equal(current.position, paused.position);
    assert.deepEqual(await writes(page), writeBaseline, 'Channel observation cannot write Synth parameters / DSP registers');
    assert.equal(await authoring(page), authored); assert.deepEqual(await request(page, 'readDspSetup'), dsp);
    assert(await control(page, 'totalLevel').isEnabled(), 'Existing selected-slot parameter editor remains available');
    assert(await control(page, 'bits').isDisabled());
    cases.push('Pause freezes frame/position/all activity; CH2/CH32 selection preserves time, exposes bypassed MDL and STWINH, and causes no authoring or register mutations');

    step('real gate-off Release remains observed active and selectable');
    current = await seek(page, fixture.releaseSeconds); current = await select(page, 0);
    const released = current.channels.find(channel => channel.channel === '0');
    assert.equal(released.gate, 'false'); assert.equal(released.active, 'true'); assert.equal(released.phase, 'release');
    assert.match(released.title, /Release/i); assert.match(released.title, /ENV/);
    assert.match(current.fields.Activity, /Gate Off.*Observed active.*Release/);
    const held = current.channels.find(channel => channel.channel === '1');
    assert.equal(held.gate, 'true'); assert.equal(held.active, 'true');
    const inactive = current.channels.find(channel => channel.channel === '31');
    assert.equal(inactive.active, 'false'); assert.equal(inactive.gate, 'false');
    assert.doesNotMatch(inactive.title, /\bFree\b/i);
    observations.release = current;
    await page.locator('#scspChannelTabs [data-scsp-channel="0"]').focus();
    await page.keyboard.press('ArrowRight');
    await waitView(page, value => aligned(value) && value.slot === '1', 'arrow-key CH2 selection');
    assert.match((await view(page)).fields.Depth, /MDL 0.*bypassed/, 'The original driver changes CH2 to independent PCM after Release');
    assert(await page.locator('#scspChannelTabs [data-scsp-channel="1"]').evaluate(node => node === document.activeElement));
    assert.deepEqual(await writes(page), writeBaseline);
    cases.push('An independently verified original 68000 KEYONEX key-off produces active Release / Gate Off, while CH2 remains gated and idle CH32 is never called free; arrow-key selection retains focus');

    step('paused keyboard audition preserves the observed route and authored instrument');
    const auditionBefore = await view(page), authoredBeforeAudition = await authoring(page);
    await page.evaluate(() => document.activeElement?.blur());
    const key = page.locator('#keyboard .key').filter({ hasText: /\bC4\b/ }).first(), letter = await key.getAttribute('data-key');
    assert(letter); await page.keyboard.down(letter);
    await until(async () => (await request(page, 'readAudition')).voiceGroups.some(group => group.held), 'selected SSF audition');
    assert.equal((await view(page)).frame, auditionBefore.frame); assert.equal((await view(page)).position, auditionBefore.position);
    assert.equal(await authoring(page), authoredBeforeAudition);
    await page.keyboard.up(letter);
    await until(async () => !(await request(page, 'readAudition')).voiceGroups.some(group => group.held), 'selected SSF audition released');
    cases.push('Existing selected-slot keyboard audition leaves paused frame / selected routes / authored instrument intact');

    step('desktop and 390px layouts retain readable references and help focus');
    await fs.mkdir(config.screenshots, { recursive: true });
    await page.locator('#scspSsfRouteHelp > summary').focus();
    for (const width of [1400, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('#scspSsfSlotRoutes').scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(overflow <= 1, 'Page fits ' + width + 'px: overflow=' + overflow);
      const clipped = await page.locator('#scspChannelTabs button').evaluateAll(buttons => buttons.filter(button => button.scrollWidth > button.clientWidth + 1).map(button => button.textContent));
      assert.deepEqual(clipped, [], 'CH labels remain readable at ' + width);
      assert.equal(await page.locator('#scspChannelTabs [data-scsp-channel]').count(), 33);
      assert.equal(await page.locator('#scspSsfSlot,#scspSsfSlots').count(), 0);
      screenshots[String(width)] = path.join(config.screenshots, engine + '-' + width + '.png');
      await page.screenshot({ path: screenshots[String(width)], fullPage: true });
    }
    assert(await page.locator('#scspSsfRouteHelp > summary').evaluate(node => node === document.activeElement), 'Polling and layout retain help focus');
    assert.equal(await page.locator('#scspSsfRouteHelp').evaluate(node => node.open), false, 'Detailed caveats remain behind ?');
    await page.setViewportSize({ width: 1400, height: 1000 });
    cases.push('One selector and selected routes fit desktop and 390px; help remains collapsed and keyboard focus survives updates');

    step('Resume advances then Live Off / Stop restore authored state and draft');
    const resumeBefore = await view(page); await page.click('#scspSongPause');
    current = await waitView(page, value => aligned(value) && value.playback === 'Live' && Number(value.frame) > Number(resumeBefore.frame) + 2048, 'Resume advances current selected route');
    assert.equal(current.slot, resumeBefore.slot);
    await page.uncheck('#scspSsfLiveEnabled');
    await waitView(page, value => value.source === 'authored' && value.liveActive === 'false', 'Live Off authored view');
    await select(page, 'auto');
    assert.equal(await canvas(page), draft); assert.equal(await control(page, 'root').inputValue(), '500');
    assert.equal(await authoring(page), authored); assert.deepEqual(await request(page, 'exportPatch'), patch); assert.deepEqual(await request(page, 'readDspSetup'), dsp);
    await page.check('#scspSsfLiveEnabled'); await waitView(page, aligned, 'Live On current route');
    await page.click('#scspSongStop');
    await waitView(page, value => value.source === 'authored' && value.liveActive === 'false', 'Stop authored view');
    await select(page, 'auto');
    assert.equal(await canvas(page), draft); assert.equal(await authoring(page), authored);
    assert.deepEqual(await request(page, 'exportPatch'), patch); assert.deepEqual(await request(page, 'readDspSetup'), dsp);
    assert.deepEqual(await writes(page), writeBaseline);
    cases.push('Resume advances frames with the same selection; Live Off and Stop restore unapplied Auto waveform / pitch draft, authored instrument and DSP without observation writes');

    step('Capture still intentionally returns the selected physical slot to authored Auto');
    await page.click('#scspSongPlay'); await waitView(page, aligned, 'second Play'); await page.click('#scspSongPause');
    await waitView(page, value => aligned(value) && value.pause === 'Resume', 'second Pause');
    await seek(page, fixture.releaseSeconds); await select(page, 1);
    await page.click('#scspSsfCapture');
    await waitView(page, value => /^Captured SSF Slot 2/.test(value.status) && value.selected === 'auto' && value.source === 'authored', 'explicit selected CH2 Capture');
    const captured = await request(page, 'readAuthoring'); assert.equal(captured.state.slots[0].sample.bits, 8);
    await page.click('#scspSongStop');
    const stopped = await until(async () => { const value = await level(page); return value.muted && value.peak < 1e-7 ? value : false; }, 'Stop Master silence');
    cases.push('Explicit Capture still copies selected CH2 PCM8 into editable Auto and Stop produces finite silence');
    const audited = await graph(page);
    assert(audited.physicalOutputMuted && audited.destinationEdges === 1); assert.equal(audited.contexts, 1);
    assert(audited.rates.every(rate => rate === 48000)); assert.deepEqual(audited.processorErrors, []);
    assert.deepEqual(errors, []); assert.deepEqual(missing, []); assert.deepEqual(external, []);
    return { browser: engine, passed: true, cases, graph: audited, audible, stopped, observations, screenshots,
      physicalOutputMuted: true, listeningPerformed: false, errors, missing, external, expectedBlockedMonaco: blockedMonaco };
  } catch (error) {
    await fs.mkdir(config.screenshots, { recursive: true });
    const screenshot = path.join(config.screenshots, engine + '-failure.png');
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    error.receipt = { browser: engine, passed: false, stage, cases, error: error.stack, errors, missing, external,
      expectedBlockedMonaco: blockedMonaco, view: await view(page).catch(() => null), graph: await graph(page).catch(() => null), screenshot };
    throw error;
  } finally { await context.close(); await browser.close(); }
}

(async () => {
  await fs.mkdir(path.dirname(config.out), { recursive: true });
  const fixture = await originalFixture(), results = [];
  let failure = null;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const engine of engines) {
      try { results.push(await exercise(engine, origin, fixture)); }
      catch (error) { results.push(error.receipt ?? { browser: engine, passed: false, error: error.stack }); throw error; }
    }
    for (const [name, record] of served) assert.equal(sha(await fs.readFile(path.join(config.root, name))), record.sha256, 'Source changed ' + name);
    assert.deepEqual(serverMissing, []);
  } catch (error) { failure = error; }
  finally { server.closeIdleConnections?.(); server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  const report = { schemaVersion: 1, passed: !failure, root: config.root, entry: config.entry,
    physicalOutputMuted: true, listeningPerformed: false, fixture: { imageSha256: sha(fixture.image), bytesSha256: sha(fixture.bytes),
      gateFrame: fixture.gateFrame, releaseFrame: fixture.releaseFrame, releaseSeconds: fixture.releaseSeconds },
    results, assets: Object.fromEntries(served), missing: serverMissing, ...(failure ? { error: failure.stack } : {}) };
  await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
  if (failure) throw failure;
  console.log('SCSP SSF selected-slot routes browser PASS: ' + config.out);
})().catch(error => { console.error(error); process.exitCode = 1; });
