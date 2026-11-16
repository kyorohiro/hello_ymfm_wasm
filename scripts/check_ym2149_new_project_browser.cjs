// SPDX-License-Identifier: BSD-3-Clause
// Exercise New project in disposable Chromium/WebKit profiles. Every physical
// audio route passes through zero gain; the upstream PCM remains measurable.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {root: path.join(repository, 'docs'), entry: '/synth-ym2149-st/index.html',
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'ym2149-new-project-browser.json')};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const match = /^--(root|entry|engines|out)(?:=(.+))?$/.exec(args[i]);
  assert(match, `Unknown argument ${args[i]}`);
  config[match[1]] = match[2] ?? args[++i];
  assert(config[match[1]], `Missing value for --${match[1]}`);
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry));
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
const digest = value => createHash('sha256').update(value).digest('hex');
const mime = {'.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ts': 'text/plain'};
const server = http.createServer(async (request, response) => {
  try {
    let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (name.endsWith('/')) name += 'index.html';
    const filename = path.resolve(config.root, '.' + name);
    if (!filename.startsWith(config.root + path.sep)) {response.writeHead(403).end(); return;}
    response.writeHead(200, {'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'}).end(await fs.readFile(filename));
  } catch {response.writeHead(404).end();}
});

function installSilentAudit() {
  const Context = window.AudioContext ?? window.webkitAudioContext;
  const Worklet = window.AudioWorkletNode, connect = AudioNode.prototype.connect;
  const post = MessagePort.prototype.postMessage;
  const audit = window.__ymNewProjectAudit = {contexts: [], nodes: [], meters: [], traffic: [], sequence: 0};
  window.AudioContext = class extends Context {
    constructor(...args) {super(...args); audit.contexts.push(this);}
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, options) {
      super(context, name, options);
      if (name === 'tetorica-ay8910') audit.nodes.push(this);
    }
  };
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...args);
    const analyser = this.context.createAnalyser(), mute = this.context.createGain();
    analyser.fftSize = 4096; mute.gain.value = 0;
    connect.call(this, analyser); connect.call(analyser, mute); connect.call(mute, destination);
    audit.meters.push({analyser, mute}); return destination;
  };
  MessagePort.prototype.postMessage = function(data, ...args) {
    if (data?.method === 'ayTimed' && data.args?.[0]?.action !== 'capture')
      audit.traffic.push({...structuredClone(data.args[0]), audioTime: audit.contexts.at(-1)?.currentTime});
    return post.call(this, data, ...args);
  };
  audit.level = () => {
    let peak = 0, sum = 0, count = 0;
    for (const {analyser} of audit.meters) {
      const pcm = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(pcm);
      for (const value of pcm) {peak = Math.max(peak, Math.abs(value)); sum += value * value; count++;}
    }
    return {peak, rms: Math.sqrt(sum / Math.max(1, count))};
  };
  audit.capture = () => new Promise((resolve, reject) => {
    const node = audit.nodes.at(-1), id = `new-project-browser:${++audit.sequence}`;
    const listener = event => {
      if (event.data?.id !== id) return;
      node.port.removeEventListener('message', listener);
      if (event.data.error) reject(Error(event.data.error)); else resolve(event.data.value);
    };
    node.port.addEventListener('message', listener); node.port.start();
    node.port.postMessage({method: 'ayTimed', args: [{action: 'capture'}], id});
  });
  audit.readProject = async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('tetorica-ym2149-st-synth-files', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const value = await new Promise((resolve, reject) => {
        const request = database.transaction('projects').objectStore('projects').get('current');
        request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(request.error);
      });
      return value && JSON.parse(JSON.stringify(value, (_key, entry) =>
        entry instanceof Uint8Array ? {$bytes: Array.from(entry)} : entry));
    } finally {database.close();}
  };
}

const project = page => page.evaluate(() => __ymNewProjectAudit.readProject());
async function waitProject(page, predicate, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const saved = await project(page);
    if (predicate(saved)) return saved;
    await page.waitForTimeout(25);
  }
  assert.fail(message);
}
async function state(page) {
  return page.evaluate(() => ({settings: tetoricaYm2149StSynth.getSettings(),
    instrument: tetoricaYm2149StSynth.getState(), code: tetoricaYm2149StSynth.getCodeState(),
    song: tetoricaYm2149StSynth.getSongState(),
    selectedPath: document.getElementById('ymFilesSelected').textContent,
    inputMode: document.getElementById('synthInputSection').dataset.inputMode,
    master: document.getElementById('masterVolume').value,
    chipGain: document.getElementById('chipVolume').value,
    octave: document.getElementById('octaveLabel').textContent,
    pitch: document.getElementById('pitchBend').value,
    activeKeys: [...document.querySelectorAll('#keyboard .key.is-active')].map(key => key.dataset.key),
    presetOptions: [...document.getElementById('ymPresetSelect').options].map(option => option.value),
    presetValue: document.getElementById('ymPresetSelect').value,
    songOptions: [...document.getElementById('ymSongSelect').options].map(option => option.value),
    songValue: document.getElementById('ymSongSelect').value,
    contexts: __ymNewProjectAudit.contexts.length, nodes: __ymNewProjectAudit.nodes.length,
    traffic: __ymNewProjectAudit.traffic.length, level: __ymNewProjectAudit.level()}));
}
async function ready(page) {
  await page.waitForFunction(() => window.tetoricaYm2149StSynth &&
    document.getElementById('ymProjectNewButton') && !document.getElementById('ymProjectNewButton').disabled);
}
async function openNew(page) {
  if (!await page.locator('#synthMenu').evaluate(node => node.open)) await page.locator('#synthMenuButton').click();
  await page.locator('#ymProjectNewButton').click();
  await page.locator('#ymNewProjectDialog').waitFor({state: 'visible'});
  assert.equal(await page.locator('#synthMenu').evaluate(node => node.open), false, 'choosing New closes Menu');
}
async function assertModalBlocksKey(page) {
  await page.keyboard.down('a'); await page.waitForTimeout(50);
  const value = await state(page); await page.keyboard.up('a');
  assert.equal(value.contexts, 0, 'musical typing in the modal never requests audio');
  assert.deepEqual(value.activeKeys, [], 'the New confirmation blocks performance keyboard input');
}
async function selectFile(page, filename) {
  await page.locator(`#ymFilesTree button[data-file-path="${filename}"]`).click();
  await page.waitForFunction(filename => document.getElementById('ymFilesSelected').textContent === filename, filename);
}
async function range(page, id, value) {
  await page.locator('#' + id).evaluate((node, value) => {
    node.value = String(value); node.dispatchEvent(new Event('input', {bubbles: true}));
  }, value);
}
async function downloadBytes(download) {
  const stream = await download.createReadStream(), chunks = [];
  assert(stream, 'browser produced a downloadable archive');
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
function assertIdle(value, selectedPath = '/index.js') {
  assert.equal(value.code.running, false); assert.equal(Boolean(value.code.busy), false);
  assert.equal(Boolean(value.code.stopping), false); assert.deepEqual(value.code.loopNames ?? [], []);
  assert.deepEqual(value.activeKeys, []); assert.deepEqual(value.instrument.activeChannels, []);
  assert.equal(value.song.loaded, false); assert.equal(value.song.playing, false); assert.equal(value.song.paused, false);
  assert.equal(value.songValue, ''); assert.deepEqual(value.songOptions, ['']);
  assert.equal(value.presetValue, ''); assert.deepEqual(value.presetOptions, ['']);
  assert.equal(value.instrument.selectedChannel, null); assert.equal(value.pitch, '0');
  assert.equal(value.instrument.pitch, 0); assert.equal(value.octave, 'Octave +0');
  assert.equal(value.inputMode, 'keyboard'); assert.equal(value.selectedPath, selectedPath);
}
function assertFresh(saved, expected, previousIdentity) {
  assert.deepEqual(saved.settings, expected.settings, 'New restores the fresh default sound');
  assert.equal(saved.selectedPath, '/index.js'); assert.deepEqual(saved.codeState, {mode: 'keyboard', path: '/index.js'});
  assert.notEqual(saved.workspaceId, previousIdentity, 'New changes workspace identity');
  assert.deepEqual(saved.filesystem.files.map(file => file.path).sort(), expected.files.map(file => file.path).sort(),
    'Fresh Files contains only starter index.js and the shipped automatic examples');
  for (const file of expected.files)
    assert.equal(saved.filesystem.files.find(candidate => candidate.path === file.path)?.data, file.data,
      `Fresh ${file.path} matches the shipped default`);
}
async function assertFreshUi(page, defaults, preferences, contexts) {
  const value = await state(page); assertIdle(value);
  assert.deepEqual(value.settings, defaults.settings); assert.equal(value.master, preferences.master);
  assert.equal(value.chipGain, preferences.chipGain); assert.equal(value.contexts, contexts);
  for (const id of ['ymSongPlay', 'ymSongPause', 'ymSongStop', 'ymSongSeek', 'ymSongCapture'])
    assert.equal(await page.locator('#' + id).isDisabled(), true, `empty song transport ${id} is disabled`);
  return value;
}
async function stableSilence(page, durationMs = 1200) {
  await page.waitForFunction(() => __ymNewProjectAudit.level().rms < 1e-6, {}, {timeout: 5000});
  const start = Date.now(), snapshots = [];
  const scheduleCount = await page.evaluate(() => __ymNewProjectAudit.traffic.filter(row => row.action === 'schedule').length);
  do {
    const observation = await page.evaluate(async () => {
      const captured = await __ymNewProjectAudit.capture();
      return {frame: captured.frame, shape: captured.registers[13] & 15, level: __ymNewProjectAudit.level()};
    });
    assert(observation.level.rms < 1e-6, 'New silences upstream PCM');
    assert.equal(observation.shape, 10, 'No retired buzzer reservation rewrites the default envelope');
    snapshots.push(observation); await page.waitForTimeout(60);
  } while (Date.now() - start < durationMs);
  assert(snapshots.at(-1).frame > snapshots[0].frame, 'the actual worklet audio clock keeps advancing');
  assert.equal(await page.evaluate(() => __ymNewProjectAudit.traffic.filter(row => row.action === 'schedule').length),
    scheduleCount, 'New prevents future loop scheduling');
  assert.equal((await state(page)).code.running, false, 'New never reruns starter Code');
  return {durationMs, observations: snapshots.length, first: snapshots[0], last: snapshots.at(-1), scheduleCount};
}

async function runEngine(name, origin, fixture, loadCassette) {
  const browser = await ({chromium, webkit}[name]).launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 1050}, acceptDownloads: true});
  let page;
  const errors = [], missing = [], downloads = [];
  try {
    await context.addInitScript(installSilentAudit);
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {if (response.url().startsWith(origin) && response.status() >= 400) missing.push(response.url());});
    page.on('download', download => downloads.push(download.suggestedFilename()));
    await page.goto(origin + config.entry); await ready(page);
    const examples = await page.evaluate(async () => {
      const source = document.querySelector('script[type="module"][src]').src;
      const url = new URL('./code_examples.js?v=ym-sample-1', source).href;
      if (!performance.getEntriesByType('resource').some(entry => entry.name === url))
        throw new Error('Startup did not request the versioned examples module');
      return (await import(url)).YM_CODE_EXAMPLES;
    });
    const examplePaths = Object.keys(examples).sort();
    assert(examplePaths.includes('/examples/volume-modulation.js'), 'the shipped examples include volume modulation');
    assert(examplePaths.includes('/examples/volume-sample.js'), 'the shipped examples include the volume sample');
    const defaultPaths = ['/index.js', ...examplePaths].sort();
    const hiddenProject = await waitProject(page, saved => saved?.filesystem.files.length === defaultPaths.length && !saved.filesVisible,
      'the cold initial project persists while Files is hidden');
    const hiddenState = await state(page);
    assert.equal(await page.locator('#ymFilesPanel').isVisible(), false);
    await openNew(page); await assertModalBlocksKey(page); await page.locator('#ymNewProjectCancel').click();
    await page.locator('#ymNewProjectDialog').waitFor({state: 'hidden'});
    assert.equal(await page.locator('#ymFilesPanel').isVisible(), false, 'New is accessible without showing Files');
    assert.deepEqual(await state(page), hiddenState); assert.deepEqual(await project(page), hiddenProject);
    if (!await page.locator('#ymFilesPanel').isVisible()) await page.locator('#ymFilesToggle').click();
    assert.equal(await page.locator('#ymMenuProjectNew #ymProjectNewButton').count(), 1, 'New is mounted in Menu');
    assert.equal(await page.locator('#ymFileExamplesButton').count(), 0, 'automatic examples have no repair toolbar action');
    for (const filePath of examplePaths)
      await page.locator(`#ymFilesTree button[data-file-path="${filePath}"]`).waitFor({state: 'visible'});
    const initial = await waitProject(page, saved => saved?.filesystem.files.length === defaultPaths.length,
      'initial starter and examples are persisted');
    assert.deepEqual(initial.filesystem.files.map(file => file.path).sort(), defaultPaths,
      'the initial project contains exactly the starter and shipped examples');
    for (const [filePath, source] of Object.entries(examples))
      assert.equal(initial.filesystem.files.find(file => file.path === filePath)?.data, source,
        `initial example ${filePath} matches the shipped source`);
    const defaults = {settings: initial.settings, files: initial.filesystem.files};
    const starter = defaults.files.find(file => file.path === '/index.js').data;
    const originalBuzzer = defaults.files.find(file => file.path === '/examples/sync-buzzer.js').data;
    const coldBefore = await state(page);
    assert.equal(coldBefore.contexts, 0); assertIdle(coldBefore, '');
    for (const dismiss of ['cancel', 'escape']) {
      await openNew(page);
      if (name === 'chromium' && dismiss === 'cancel')
        await page.screenshot({path: '/tmp/tetorica-ym2149-new-project-dialog.png', fullPage: true});
      assert.equal((await state(page)).contexts, 0, 'opening New never requests audio');
      await assertModalBlocksKey(page);
      if (dismiss === 'cancel') await page.locator('#ymNewProjectCancel').click();
      else await page.keyboard.press('Escape');
      await page.locator('#ymNewProjectDialog').waitFor({state: 'hidden'});
      const after = await state(page);
      assert.deepEqual(after, coldBefore, `${dismiss} preserves cold runtime and UI state`);
      assert.deepEqual(await project(page), initial, `${dismiss} preserves all persisted project data`);
    }
    await page.setViewportSize({width: 390, height: 844}); await openNew(page);
    const mobile = await page.evaluate(() => ({viewport: innerWidth, width: document.documentElement.scrollWidth,
      dialogWidth: document.getElementById('ymNewProjectDialog').getBoundingClientRect().width}));
    assert(mobile.width <= mobile.viewport + 1 && mobile.dialogWidth <= mobile.viewport, 'New confirmation fits mobile');
    await page.locator('#ymNewProjectCancel').click(); await page.setViewportSize({width: 1280, height: 1050});

    // All additions and edits are made through the real editor, Files and music inputs.
    await page.locator('#synthInputCodeTab').click();
    const editor = page.locator('#synthCodeEditor'); await editor.waitFor({state: 'visible'});
    await page.waitForFunction(() => !document.getElementById('synthCodeEditor').readOnly);
    const indexSource = '// Browser New project keeps this user edit in its backup.\n' + starter;
    await editor.fill(indexSource); await page.locator('#synthInputKeyboardTab').click();
    await page.locator('#presetName').fill('Browser New project sound'); await page.locator('#presetName').dispatchEvent('change');
    await page.locator('#noiseEnabled').check(); await page.locator('#savePreset').click();
    await page.waitForFunction(() => document.getElementById('ymPresetSelect').options.length === 2 &&
      !document.getElementById('ymProjectNewButton').disabled);
    const presetPath = await page.locator('#ymPresetSelect option').last().getAttribute('value');
    await page.locator('#ymPresetSelect').selectOption(presetPath);
    await page.waitForFunction(path => document.getElementById('ymPresetSelect').value === path, presetPath);
    const binary = Buffer.from([0, 17, 128, 255, 39, 91, 0]);
    await page.locator('#ymFilesInput').setInputFiles({name: 'user-data.bin', mimeType: 'application/octet-stream', buffer: binary});
    await page.locator('#ymFilesTree button[data-file-path="/user-data.bin"]').waitFor({state: 'visible'});
    await page.locator('#ymMusicInput').setInputFiles({name: 'new-project-reference.vgm', mimeType: 'application/octet-stream', buffer: Buffer.from(fixture)});
    await page.waitForFunction(() => tetoricaYm2149StSynth.getSongState().loaded && !tetoricaYm2149StSynth.getSongState().busy);
    assert.equal((await state(page)).contexts, 0, 'editing, preset selection and music import remain cold');
    await range(page, 'masterVolume', 0.37); await page.locator('#ymMixerTab').click();
    await range(page, 'chipVolume', 1.42); await page.locator('#ymChipTab').click();
    await page.locator('#ymChannel2Tab').click(); await range(page, 'pitchBendTop', 1.25);
    await page.locator('#octaveUp').click();
    const preferences = {master: '0.37', chipGain: '1.42'};
    await selectFile(page, '/examples/sync-buzzer.js'); await page.locator('#synthInputCodeTab').click();
    assert.equal(await editor.inputValue(), originalBuzzer);
    await page.locator('#synthCodeRunButton').click();
    await page.waitForFunction(() => {
      const code = tetoricaYm2149StSynth.getCodeState();
      return code.running && code.loopNames.length === 2;
    });
    await page.waitForFunction(() => __ymNewProjectAudit.level().rms > 0.0001);
    const soundingPcm = await page.evaluate(() => __ymNewProjectAudit.level());
    assert.deepEqual((await state(page)).code.loopNames.slice().sort(), ['buzzer-motion', 'melody']);
    await page.locator('#synthInputKeyboardTab').click(); await page.locator('#channelStatus').click(); await page.keyboard.down('z');
    await page.waitForFunction(() => document.querySelector('#keyboard .key[data-key="z"]')?.classList.contains('is-active'));
    // Let the earlier tab/control edits finish their normal debounced save
    // before attributing any persistence change to opening the confirmation.
    await page.waitForTimeout(300);
    for (const dismiss of ['cancel', 'escape']) {
      const before = await state(page), savedBefore = await project(page);
      const trafficBefore = await page.evaluate(() => __ymNewProjectAudit.traffic.filter(row =>
        ['cancelOwner', 'releaseOwner', 'abort'].includes(row.action)).length);
      await openNew(page);
      if (dismiss === 'cancel') await page.locator('#ymNewProjectCancel').click(); else await page.keyboard.press('Escape');
      await page.locator('#ymNewProjectDialog').waitFor({state: 'hidden'});
      const after = await state(page);
      assert.equal(after.code.running, true); assert.deepEqual(after.code.loopNames.slice().sort(), ['buzzer-motion', 'melody']);
      assert.deepEqual(after.activeKeys, before.activeKeys, `${dismiss} keeps the held keyboard note`);
      assert.equal(after.contexts, 1); assert.equal(after.selectedPath, before.selectedPath); assert.equal(after.inputMode, before.inputMode);
      assert.deepEqual(await project(page), savedBefore, `${dismiss} preserves the running project's saved data`);
      assert.equal(await page.evaluate(() => __ymNewProjectAudit.traffic.filter(row =>
        ['cancelOwner', 'releaseOwner', 'abort'].includes(row.action)).length), trafficBefore, 'opening/dismissing never stops Code');
    }
    const schedulesBefore = await page.evaluate(() => __ymNewProjectAudit.traffic.filter(row => row.action === 'schedule').length);
    await page.waitForFunction(count => __ymNewProjectAudit.traffic.filter(row => row.action === 'schedule').length > count,
      schedulesBefore, {timeout: 5000});
    await page.keyboard.up('z'); await page.locator('#synthInputCodeTab').click();
    const unappliedSource = originalBuzzer + '\n// Latest editor edit: exported without Apply before New.\n';
    await editor.fill(unappliedSource);
    const journalBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('tetorica-ym2149-st-synth-pending-code') || 'null'));
    assert.equal(journalBefore?.source, unappliedSource, 'latest unapplied editor text has a recovery journal');
    await page.locator('#channelStatus').click(); await page.keyboard.down('z');
    await page.waitForFunction(() => document.querySelector('#keyboard .key[data-key="z"]')?.classList.contains('is-active'));
    const oldIdentity = (await project(page)).workspaceId;
    await openNew(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#ymNewProjectExport').click()]);
    const archive = await downloadBytes(download);
    await page.locator('#ymNewProjectDialog').waitFor({state: 'hidden'});
    const fresh = await waitProject(page, saved => saved?.workspaceId !== oldIdentity && saved?.filesystem.files.length === defaults.files.length,
      'export then create persists a fresh workspace');
    assertFresh(fresh, defaults, oldIdentity);
    const freshState = await assertFreshUi(page, defaults, preferences, 1);
    await page.keyboard.up('z');
    const cassette = await loadCassette(new Uint8Array(archive));
    const text = filename => new TextDecoder().decode(cassette.files.get(filename));
    assert.equal(text('index.js'), indexSource, 'download keeps user index.js');
    assert.equal(text('examples/sync-buzzer.js'), unappliedSource, 'download includes latest editor text without Apply');
    assert.deepEqual(Buffer.from(cassette.files.get('user-data.bin')), binary, 'download keeps exact binary bytes');
    assert.deepEqual(Buffer.from(cassette.files.get('vgm/new-project-reference.vgm')), Buffer.from(fixture));
    assert.equal(JSON.parse(text(presetPath.slice(1))).name, 'Browser New project sound');
    const manifest = JSON.parse(text('ym2149-st-synth.project.json'));
    assert.equal(manifest.format, 'tetorica-ym2149-st-code-project');
    assert.equal(manifest.settings.name, 'Browser New project sound');
    assert.equal(manifest.selectedPath, '/examples/sync-buzzer.js');
    assert.deepEqual(manifest.codeState, {mode: 'code', path: '/examples/sync-buzzer.js'});
    assert.match(download.suggestedFilename(), /\.cassette\.zip$/);
    const stopped = await stableSilence(page);
    const firstAudit = await page.evaluate(() => ({contexts: __ymNewProjectAudit.contexts.length,
      nodes: __ymNewProjectAudit.nodes.length, speakerRoutes: __ymNewProjectAudit.meters.length,
      physicalOutputMuted: __ymNewProjectAudit.meters.every(item => item.mute.gain.value === 0),
      lifecycle: __ymNewProjectAudit.traffic.filter(row => row.action !== 'schedule')}));
    assert.equal(firstAudit.contexts, 1); assert.equal(firstAudit.nodes, 1); assert(firstAudit.physicalOutputMuted);
    assert(firstAudit.lifecycle.some(row => row.action === 'cancelOwner'), 'New cancels actual Code ownership');
    assert.equal(await page.evaluate(() => localStorage.getItem('tetorica-ym2149-st-synth-pending-code')), null,
      'the previous workspace recovery journal is cleared');

    // The fresh workspace must survive a navigation with no implicit playback.
    await page.reload(); await ready(page);
    if (!await page.locator('#ymFilesPanel').isVisible()) await page.locator('#ymFilesToggle').click();
    const reloaded = await waitProject(page, saved => saved?.workspaceId === fresh.workspaceId,
      'fresh workspace identity survives reload');
    assertFresh(reloaded, defaults, oldIdentity);
    const reloadState = await state(page); assertIdle(reloadState); assert.equal(reloadState.contexts, 0);
    assert.deepEqual(reloadState.settings, defaults.settings);
    await page.locator('#synthInputCodeTab').click(); assert.equal(await editor.inputValue(), starter);
    await page.locator('#synthInputKeyboardTab').click();
    await openNew(page); await page.locator('#ymNewProjectCreate').click();
    await page.locator('#ymNewProjectDialog').waitFor({state: 'hidden'});
    const coldFresh = await waitProject(page, saved => saved?.workspaceId !== reloaded.workspaceId && saved?.filesystem.files.length === defaults.files.length,
      'create without export can replace a cold workspace');
    assertFresh(coldFresh, defaults, reloaded.workspaceId);
    await assertFreshUi(page, defaults, {master: reloadState.master, chipGain: reloadState.chipGain}, 0);
    assert.equal(downloads.length, 1, 'cold Create without export produces no extra download');

    // Create without export also stops an actual reference performance and a held key.
    await range(page, 'masterVolume', 0.37); await page.locator('#ymMixerTab').click();
    await range(page, 'chipVolume', 1.42); await page.locator('#ymChipTab').click();
    await page.locator('#ymMusicInput').setInputFiles({name: 'new-project-reference.vgm', mimeType: 'application/octet-stream', buffer: Buffer.from(fixture)});
    await page.waitForFunction(() => tetoricaYm2149StSynth.getSongState().loaded && !tetoricaYm2149StSynth.getSongState().busy);
    await page.locator('#ymSongPlay').click();
    await page.waitForFunction(() => tetoricaYm2149StSynth.getSongState().playing && tetoricaYm2149StSynth.getSongState().positionFrames > 4410);
    await page.waitForFunction(() => __ymNewProjectAudit.level().rms > 0.0001);
    await page.locator('#ymSongLive').uncheck(); await page.locator('#ymChannel3Tab').click();
    await range(page, 'pitchBendTop', -0.75); await page.locator('#octaveDown').click();
    await page.locator('#channelStatus').click(); await page.keyboard.down('z');
    await page.waitForFunction(() => document.querySelector('#keyboard .key[data-key="z"]')?.classList.contains('is-active'));
    const songBefore = await state(page), secondIdentity = (await project(page)).workspaceId;
    await openNew(page); await page.locator('#ymNewProjectCancel').click();
    await page.locator('#ymNewProjectDialog').waitFor({state: 'hidden'});
    await page.waitForFunction(frame => tetoricaYm2149StSynth.getSongState().positionFrames > frame, songBefore.song.positionFrames);
    const songCancelled = await state(page);
    assert.equal(songCancelled.song.playing, true); assert(songCancelled.activeKeys.includes('z'));
    await openNew(page); await page.locator('#ymNewProjectCreate').click();
    await page.locator('#ymNewProjectDialog').waitFor({state: 'hidden'});
    const secondFresh = await waitProject(page, saved => saved?.workspaceId !== secondIdentity && saved?.filesystem.files.length === defaults.files.length,
      'create without export persists another fresh workspace');
    assertFresh(secondFresh, defaults, secondIdentity);
    const secondState = await assertFreshUi(page, defaults, preferences, 1); await page.keyboard.up('z');
    const secondStopped = await stableSilence(page, 250);
    assert.equal(downloads.length, 1, 'Create without export produces no download');
    const audit = await page.evaluate(() => ({contexts: __ymNewProjectAudit.contexts.length,
      nodes: __ymNewProjectAudit.nodes.length, speakerRoutes: __ymNewProjectAudit.meters.length,
      physicalOutputMuted: __ymNewProjectAudit.meters.every(item => item.mute.gain.value === 0),
      stoppedPcm: __ymNewProjectAudit.level(), lifecycle: __ymNewProjectAudit.traffic.filter(row => row.action !== 'schedule')}));
    assert.equal(audit.contexts, 1); assert.equal(audit.nodes, 1); assert(audit.speakerRoutes > 0); assert(audit.physicalOutputMuted);
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => {
      const url = new URL(entry.name); return url.pathname + url.search;
    }));
    const scriptSource = await page.locator('script[type="module"][src]').getAttribute('src');
    const directory = path.posix.dirname(new URL(scriptSource, origin + config.entry).pathname).replace(/\/$/, '');
    const freshModules = ['synth.js', 'code_host.js', 'code_files.js', 'code_examples.js']
      .map(file => `${directory}/${file}?v=ym-sample-1`);
    for (const module of freshModules) assert(resources.includes(module), `versioned New project dependency ${module} is requested`);
    assert.deepEqual(errors, [], 'no uncaught browser errors'); assert.deepEqual(missing, [], 'no missing local resources');
    return {engine: name, passed: true, editor: 'Offline textarea; external CDN intentionally blocked',
      cold: {contexts: 0, cancelPreservesAllData: true, escapePreservesAllData: true, mobile,
        menuWorksWithFilesHidden: true, modalBlocksMusicalKeys: true, examplesAutomatic: true, examplesButtonAbsent: true},
      editedWorkspace: {indexSha256: digest(indexSource), presetPath, binaryBytes: [...binary], musicPath: '/vgm/new-project-reference.vgm'},
      runningCancel: {loops: ['buzzer-motion', 'melody'], cancelKeepsHeldKey: true, escapeKeepsHeldKey: true,
        schedulingContinues: true, soundingPcm},
      exportAndCreate: {filename: download.suggestedFilename(), bytes: archive.length, sha256: digest(archive),
        cassettePaths: [...cassette.files.keys()].sort(), unappliedEditorEditIncluded: true, binaryPreserved: true,
        previousWorkspaceId: oldIdentity, newWorkspaceId: fresh.workspaceId, freshPaths: fresh.filesystem.files.map(file => file.path),
        defaultSettings: freshState.settings, masterRetained: freshState.master, chipGainRetained: freshState.chipGain,
        stopped, audio: firstAudit},
      reload: {workspaceId: reloaded.workspaceId, freshFilesRetained: true, starterRestored: true, audioContexts: 0, codeRunning: false},
      coldCreateWithoutExport: {workspaceId: coldFresh.workspaceId, audioContexts: 0, defaultSound: true,
        starterAndExamplesOnly: true, codeRunning: false, downloadCount: 1},
      createWithoutExport: {playingSongBefore: songBefore.song.name, cancelledSongContinues: true,
        heldKeyCleared: true, songUnloaded: !secondState.song.loaded, defaultSettings: secondState.settings,
        masterRetained: secondState.master, chipGainRetained: secondState.chipGain,
        audioContextsBefore: songBefore.contexts, audioContextsAfter: secondState.contexts,
        downloadCount: downloads.length, stopped: secondStopped},
      freshModules, audit, errors, missing};
  } catch (error) {
    if (page) try {
      const saved = await project(page);
      console.error(JSON.stringify({engine: name, errors, missing,
      state: await state(page), project: saved && {...saved, filesystem: {...saved.filesystem,
        files: saved.filesystem.files.map(file => ({path: file.path, type: file.type,
          size: typeof file.data === 'string' ? file.data.length : file.data.$bytes?.length}))}},
      diagnostics: await page.evaluate(() => ({
        filesStatus: document.getElementById('ymFilesStatus')?.textContent,
        audioStatus: document.getElementById('audioStatus')?.textContent,
        codeError: document.getElementById('synthCodeError')?.textContent,
        dialog: document.getElementById('ymNewProjectDialog')?.outerHTML,
        traffic: __ymNewProjectAudit.traffic.slice(-12)}))}, null, 2));} catch {}
    throw error;
  } finally {await context.close(); await browser.close();}
}

async function main() {
  const {loadPlaygroundCassette} = await import(pathToFileURL(path.join(repository, 'docs/playground/playground_cassette.js')));
  const {createYmVgmFixture, ayWrite, ayWait} = await import(pathToFileURL(path.join(repository, 'docs/synth-ym2149-st/vgm_test_helpers.mjs')));
  const commands = [];
  for (const [register, value] of [[0, 100], [1, 0], [2, 200], [3, 0], [4, 44], [5, 1],
    [6, 8], [7, 0x38], [8, 9], [9, 7], [10, 6], [11, 80], [12, 0], [13, 10]]) commands.push(...ayWrite(register, value));
  for (let i = 0; i < 30; i++) commands.push(...ayWait(44100)); commands.push(0x66);
  const fixture = createYmVgmFixture(commands);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`, results = [];
    for (const engine of engines) results.push(await runEngine(engine, origin, fixture, loadPlaygroundCassette));
    const resourcePaths = [...new Set(results.flatMap(result => result.freshModules))];
    const currentSources = await Promise.all(resourcePaths.map(async resource => {
      const filename = path.join(config.root, new URL(resource, 'http://localhost').pathname);
      const body = await fs.readFile(filename);
      return {resource, bytes: body.length, sha256: digest(body)};
    }));
    const report = {passed: true, servedRoot: path.relative(repository, config.root), entry: config.entry,
      resourceVersion: 'ym-sample-1', currentSources, physicalOutputMuted: true,
      disposableBrowserProfiles: true, fixture: 'Original generated 30-second YM2149 VGM; no third-party music', results};
    await fs.mkdir(path.dirname(config.out), {recursive: true}); await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {await new Promise(resolve => server.close(resolve));}
}
main().catch(error => {console.error(error); process.exitCode = 1;});
