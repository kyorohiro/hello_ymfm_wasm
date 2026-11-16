// SPDX-License-Identifier: BSD-3-Clause
// Run the shipped fixed-volume example through Files / Code in real browsers.
// Every physical speaker route passes through zero gain; PCM is metered before it.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const {chromium, webkit} = require('playwright');

const config = {root:path.resolve(__dirname, '../docs'), entry:'/synth-ym2149-st/index.html',
  engines:'chromium,webkit', out:path.join(os.tmpdir(), 'ym2149-volume-browser.json')};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const match = /^--(root|entry|engines|out)(?:=(.+))?$/.exec(args[index]);
  assert(match, `Unknown argument ${args[index]}`);
  config[match[1]] = match[2] ?? args[++index];
  assert(config[match[1]], `Missing value for --${match[1]}`);
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry));
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
const mime = {'.js':'text/javascript', '.html':'text/html', '.css':'text/css', '.wasm':'application/wasm',
  '.json':'application/json', '.webp':'image/webp', '.svg':'image/svg+xml', '.ts':'text/plain'};
const server = http.createServer(async (request, response) => {
  try {
    let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (name.endsWith('/')) name += 'index.html';
    const file = path.resolve(config.root, '.' + name);
    if (!file.startsWith(config.root + path.sep)) {response.writeHead(403).end(); return;}
    const bytes = await fs.readFile(file);
    response.writeHead(200, {'Content-Type':mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control':'no-store'}).end(bytes);
  } catch {response.writeHead(404).end();}
});

function installSilentAudit() {
  const Context = window.AudioContext ?? window.webkitAudioContext, Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect, post = MessagePort.prototype.postMessage;
  const addMessage = MessagePort.prototype.addEventListener, removeMessage = MessagePort.prototype.removeEventListener;
  const audit = window.__ymVolumeAudit = {contexts:[], nodes:[], meters:[], traffic:[], receipts:[], commands:[], sequence:0};
  window.AudioContext = class extends Context {constructor(...args) {super(...args); audit.contexts.push(this);}};
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, options) {super(context, name, options); if (name === 'tetorica-ay8910') audit.nodes.push(this);}
  };
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...args);
    const analyser = this.context.createAnalyser(), mute = this.context.createGain();
    analyser.fftSize = 4096; mute.gain.value = 0;
    connect.call(this, analyser); connect.call(analyser, mute); connect.call(mute, destination);
    audit.meters.push({analyser, mute}); return destination;
  };
  MessagePort.prototype.postMessage = function(data, ...args) {
    const audioTime = audit.contexts.at(-1)?.currentTime;
    if (data?.method === 'ayTimed') {
      const payload = structuredClone(data.args[0]);
      audit.traffic.push({...payload, id:data.id, time:performance.now() / 1000, audioTime, commandIndex:audit.commands.length,
        performance:structuredClone(data.timedPerformance)});
      if (data.id !== undefined) {
        const port = this, listener = event => {
          if (event.data?.id !== data.id) return;
          removeMessage.call(port, 'message', listener);
          audit.receipts.push({action:payload.action, owner:payload.owner, id:data.id, ok:!event.data.error,
            value:event.data.value, error:event.data.error});
        };
        addMessage.call(port, 'message', listener); port.start();
      }
    }
    const commands = data?.commands ?? (Array.isArray(data) ? data : [data]);
    for (const command of commands) if (command?.method === 'writeRegister')
      audit.commands.push({...structuredClone(command), audioTime, performance:structuredClone(data.performance)});
    return post.call(this, data, ...args);
  };
  audit.level = () => {
    let peak = 0, sum = 0, count = 0;
    for (const {analyser} of audit.meters) {
      const pcm = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(pcm);
      for (const value of pcm) {peak = Math.max(peak, Math.abs(value)); sum += value * value; count++;}
    }
    return {peak, rms:Math.sqrt(sum / Math.max(1, count))};
  };
  audit.request = (method, args) => new Promise((resolve, reject) => {
    const node = audit.nodes.at(-1), id = `volume-browser-audit:${++audit.sequence}`;
    const listener = event => {
      if (event.data?.id !== id) return;
      node.port.removeEventListener('message', listener);
      if (event.data.error) reject(Error(event.data.error)); else resolve(event.data.value);
    };
    node.port.addEventListener('message', listener); node.port.start(); node.port.postMessage({method, args, id});
  });
  audit.capture = () => audit.request('ayTimed', [{action:'capture'}]);
}

const levels = [0, 2, 4, 6, 8, 10, 12, 14, 15, 14, 12, 10, 8, 6, 4, 2];
const schedules = (page, index = 0) => page.evaluate(index => __ymVolumeAudit.traffic.slice(index).filter(
  row => row.action === 'schedule' && row.options?.name === 'volume-modulation'), index);
async function waitSchedules(page, rates, index = 0) {
  await page.waitForFunction(({rates, index}) => {
    const rows = __ymVolumeAudit.traffic.slice(index).filter(row => row.action === 'schedule' && row.options?.name === 'volume-modulation');
    return rates.every(hz => rows.some(row => Math.abs(1 / row.options.repeatSeconds - hz) < 1e-8));
  }, {rates, index}, {timeout:10000});
  return schedules(page, index);
}
async function acknowledged(page, action, index, owner) {
  await page.waitForFunction(({action, index, owner}) => __ymVolumeAudit.receipts.slice(index).some(
    row => row.action === action && row.ok && (owner === undefined || row.owner === owner)), {action, index, owner});
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const value = await __ymVolumeAudit.capture();
    return {volume:value.registers[8], period:value.registers[0] | (value.registers[1] & 15) << 8,
      frame:value.frame, sampleRate:value.sampleRate, level:__ymVolumeAudit.level()};
  });
}
async function stableVolume(page, volume, durationMs, silent = false) {
  const observations = [], start = Date.now();
  do {
    const value = await snapshot(page); observations.push(value);
    assert.equal(value.volume, volume, `R8 after cancellation ACK: ${JSON.stringify(observations)}`);
    if (silent) assert(value.level.rms < 1e-6, 'Upstream PCM remains silent after cleanup');
    await page.waitForTimeout(25);
  } while (Date.now() - start < durationMs);
  assert(observations.at(-1).frame > observations[0].frame, 'Worklet frames advance');
  return {first:observations[0], last:observations.at(-1), observations:observations.length, durationMs,
    distinctTonePeriods:[...new Set(observations.map(row => row.period))]};
}
async function observeFixedVolume(page) {
  const samples = [], start = Date.now();
  do {
    const value = await snapshot(page); samples.push(value);
    assert(levels.includes(value.volume), 'Actual R8 stays within the supplied fixed-volume pattern');
    assert.equal(value.volume & 16, 0, 'Actual R8 never selects the hardware envelope');
    await page.waitForTimeout(5);
  } while (Date.now() - start < 180);
  const values = [...new Set(samples.map(row => row.volume))].sort((a, b) => a - b);
  assert(values.length >= 5, 'The actual Worklet executes multiple fixed-volume steps');
  assert(samples.at(-1).frame > samples[0].frame);
  return {firstFrame:samples[0].frame, lastFrame:samples.at(-1).frame, samples:samples.length,
    sampleRate:samples[0].sampleRate, observedRegister8Values:values, envelopeEnabled:false};
}
async function apply(page, source, marker) {
  const receiptIndex = await page.evaluate(() => __ymVolumeAudit.receipts.length);
  await page.locator('#synthCodeEditor').fill(source + `\nconsole.log(${JSON.stringify(marker)});\n`);
  await page.locator('#synthCodeApplyButton').click();
  await page.waitForFunction(marker => document.getElementById('synthCodeLog').textContent.includes(marker), marker);
  return receiptIndex;
}
async function checkSchedules(page, rows, rates, expectedLevels, stepSeconds) {
  rows = rows.slice(0, rates.length);
  assert.deepEqual(rows.map(row => Math.round(1 / row.options.repeatSeconds)), rates);
  const receipts = await page.evaluate(() => __ymVolumeAudit.receipts);
  const reservations = [];
  for (const [rowIndex, row] of rows.entries()) {
    const hz = rates[rowIndex], operations = row.operations.operations;
    assert(row.owner?.includes(':loop:'), 'Reservation belongs to a named loop');
    assert.equal(operations.length, expectedLevels.length);
    for (const [index, operation] of operations.entries()) {
      assert.equal(operation.method, 'setVolume');
      assert.deepEqual(operation.args, [0, expectedLevels[index], false]);
      assert.equal(operation.time.unit, 'seconds');
      assert(Math.abs(operation.time.value - index / (hz * expectedLevels.length)) < 1e-12);
    }
    const ack = receipts.find(receipt => receipt.id === row.id);
    assert(ack?.ok, 'AudioWorklet accepted the actual reservation');
    assert.equal(ack.value.entries, expectedLevels.length);
    assert.equal(ack.value.repeatSeconds, 1 / hz);
    const sampleRate = ack.value.sampleRate;
    reservations.push({hz, startFrame:ack.value.startFrame, sampleRate,
      offsetsSeconds:operations.map(operation => operation.time.value),
      roundedFrameOffsets:operations.map(operation => Math.round(operation.time.value * sampleRate)),
      registers:operations.map(() => 8), values:expectedLevels});
  }
  const intervals = rows.slice(1).map((row, index) => row.audioTime - rows[index].audioTime);
  for (const seconds of intervals) assert(Math.abs(seconds - stepSeconds) < 0.2,
    `Expected ${stepSeconds}s rate step; observed ${seconds}s`);
  return {ratesHz:rates, stepSeconds, intervalsSeconds:intervals, owner:rows[0].owner, reservations};
}
function checkCompileTable(consoleText, expectedLevels, hz) {
  const table = consoleText.split('\n').filter(line => line.includes('|')).map(line => line.split('|').map(cell => cell.trim()));
  const header = table.find(row => row.includes('register') && row.includes('value') && row.includes('offsetSeconds'));
  assert(header, 'Code Console displays the actual compile table');
  const rows = table.slice(table.indexOf(header) + 1).filter(row => /^\d+$/.test(row[0]));
  assert.equal(rows.length, expectedLevels.length, 'Compile table contains all sixteen R8 writes');
  for (const [index, row] of rows.entries()) {
    assert.equal(Number(row[header.indexOf('register')]), 8);
    assert.equal(Number(row[header.indexOf('value')]), expectedLevels[index]);
    assert(Math.abs(Number(row[header.indexOf('offsetSeconds')]) - index / (hz * expectedLevels.length)) < 1e-10);
  }
  return rows.map(row => ({offsetSeconds:Number(row[header.indexOf('offsetSeconds')]),
    register:Number(row[header.indexOf('register')]), value:Number(row[header.indexOf('value')])}));
}
async function melody(page, index, expectedSeconds, minimum = 4) {
  const writes = await page.evaluate(index => __ymVolumeAudit.commands.slice(index), index);
  const notes = writes.filter(row => row.args[0] === 0);
  assert(notes.length >= minimum, 'Continuous melody keeps issuing tone-period changes');
  const intervals = notes.slice(1).map((row, index) => row.audioTime - notes[index].audioTime);
  for (const seconds of intervals) assert(Math.abs(seconds - expectedSeconds) < 0.15,
    `Expected ${expectedSeconds}s melody step; observed ${seconds}s`);
  assert(new Set(notes.map(row => row.args[1])).size > 1, 'The melody changes pitch');
  assert(writes.every(row => row.args[0] < 2), 'Melody changes pitch without gate/volume writes');
  return {notes:notes.length, expectedSeconds, intervalsSeconds:intervals,
    registers:[...new Set(writes.map(row => row.args[0]))]};
}

async function runEngine(name, origin) {
  const browser = await ({chromium, webkit}[name]).launch({headless:true});
  let context, page;
  try {
    context = await browser.newContext({viewport:{width:1280, height:1050}});
    await context.addInitScript(installSilentAudit);
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    page = await context.newPage(); const errors = [], missing = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {if (response.url().startsWith(origin) && response.status() >= 400) missing.push(response.url());});
    await page.goto(origin + config.entry);
    await page.waitForFunction(() => window.tetoricaYm2149StSynth && !document.getElementById('ymFileNewButton')?.disabled);
    assert.equal(await page.evaluate(() => __ymVolumeAudit.contexts.length), 0);
    if (!await page.locator('#ymFilesPanel').isVisible()) await page.locator('#ymFilesToggle').click();
    const file = page.locator('#ymFilesTree button[data-file-path="/examples/volume-modulation.js"]');
    await file.waitFor({state:'visible'}); await file.click();
    await page.waitForFunction(() => document.getElementById('ymFilesSelected').textContent === '/examples/volume-modulation.js');
    assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'), 'keyboard');
    await page.locator('#synthInputCodeTab').click();
    const editor = page.locator('#synthCodeEditor');
    await page.waitForFunction(() => !document.getElementById('synthCodeEditor').readOnly);
    const example = await editor.inputValue();
    assert(example.includes(`const levels = [${levels.join(', ')}];`));
    assert(example.includes('const modulationHz = [25, 50, 100];'));
    assert(example.includes('liveCleanup(["volume-motion"], () => ym.keyOff(CH1));'));
    assert.equal(await page.evaluate(() => __ymVolumeAudit.contexts.length), 0, 'Selecting/editing Files does not open audio');
    assert.equal(await page.evaluate(() => tetoricaYm2149StSynth.getCodeState().running), false);

    await page.locator('#synthCodeRunButton').click();
    await page.waitForFunction(() => tetoricaYm2149StSynth.getCodeState().running && tetoricaYm2149StSynth.getCodeState().loopNames.length === 2);
    assert.deepEqual(await page.evaluate(() => tetoricaYm2149StSynth.getCodeState().loopNames.slice().sort()), ['melody', 'volume-motion']);
    const sounding = await page.waitForFunction(() => {const level = __ymVolumeAudit.level(); return level.rms > 0.0001 ? level : false;}, {}, {timeout:5000});
    const pcm = await sounding.jsonValue(); await sounding.dispose();
    const fixedVolume = await observeFixedVolume(page);
    const initialRows = await waitSchedules(page, [25, 50, 100]);
    const initial = await checkSchedules(page, initialRows, [25, 50, 100], levels, 1);
    const initialMelody = await melody(page, initialRows[0].commandIndex, 0.25, 7);
    const consoleText = await page.locator('#synthCodeLog').textContent();
    const compile = checkCompileTable(consoleText, levels, 25);
    for (const hz of [25, 50, 100]) assert(consoleText.includes(`R8 fixed volume: ${hz} cycles/s; ${hz * 16} nominal writes/s`));

    // Edit real source via Apply: rates remain in Hz while BPM changes musical periods.
    const editedLevels = levels.map(level => Math.floor(level / 2));
    const edited = example.replace(`[${levels.join(', ')}]`, `[${editedLevels.join(', ')}]`)
      .replace('[25, 50, 100]', '[40, 80]').replace('setBpm(120);', 'setBpm(240);');
    const editIndex = await page.evaluate(() => __ymVolumeAudit.traffic.length);
    await apply(page, edited, 'VOLUME_EDIT_APPLIED');
    await waitSchedules(page, [40, 80], editIndex);
    // Wait for a full new cycle, avoiding the outgoing callback's prior musical wait.
    await page.waitForFunction(index => __ymVolumeAudit.traffic.slice(index).filter(
      row => row.action === 'schedule' && row.options?.name === 'volume-modulation' && [40, 80].includes(Math.round(1 / row.options.repeatSeconds))).length >= 3, editIndex);
    const newRows = (await schedules(page, editIndex)).filter(row => [40, 80].includes(Math.round(1 / row.options.repeatSeconds)));
    assert.deepEqual(newRows.slice(0, 3).map(row => Math.round(1 / row.options.repeatSeconds)), [40, 80, 40]);
    const applied = await checkSchedules(page, newRows.slice(1, 3), [80, 40], editedLevels, 0.5);
    assert.equal(applied.owner, initial.owner, 'Apply retains the named motion owner');
    const editCommandIndex = await page.evaluate(() => __ymVolumeAudit.commands.length);
    await page.waitForTimeout(700);
    const editedMelody = await melody(page, editCommandIndex, 0.125, 4);

    // Removing only motion must cancel future R8 writes and silence the last level.
    const removed = edited.replace(/liveLoop\("volume-motion", async \(\) => \{[\s\S]*?\n\}\);\n/, '');
    assert(!removed.includes('liveLoop("volume-motion"'));
    const removeReceipt = await apply(page, removed, 'VOLUME_MOTION_REMOVED');
    await acknowledged(page, 'releaseOwner', removeReceipt, initial.owner);
    await page.waitForFunction(() => __ymVolumeAudit.level().rms < 1e-6, {}, {timeout:5000});
    assert.deepEqual(await page.evaluate(() => tetoricaYm2149StSynth.getCodeState().loopNames), ['melody']);
    const removeCommandIndex = await page.evaluate(() => __ymVolumeAudit.commands.length);
    const removedMotion = await stableVolume(page, 0, 650, true);
    const remainingMelody = await melody(page, removeCommandIndex, 0.125, 4);
    assert(removedMotion.distinctTonePeriods.length > 1, 'Actual Worklet pitch changes continue with R8 zero');
    // A final old event can precede its ACK. Establish the sentinel after that ACK.
    // Its temporary nonzero level is upstream of the immutable physical zero gain.
    await page.evaluate(() => __ymVolumeAudit.request('writeRegister', [8, 15]));
    const canceledSentinel = await stableVolume(page, 15, 650);
    const restartIndex = await page.evaluate(() => __ymVolumeAudit.traffic.length);
    await apply(page, edited, 'VOLUME_MOTION_RESTORED');
    const restored = (await waitSchedules(page, [40], restartIndex)).find(row => Math.round(1 / row.options.repeatSeconds) === 40);
    const stopReceipt = await page.evaluate(() => __ymVolumeAudit.receipts.length);
    await page.locator('#synthCodeStopButton').click();
    await page.waitForFunction(() => {const state = tetoricaYm2149StSynth.getCodeState(); return !state.running && !state.stopping && !state.busy;});
    await acknowledged(page, 'cancelOwner', stopReceipt, restored.owner);
    await page.waitForFunction(() => __ymVolumeAudit.level().rms < 1e-6, {}, {timeout:5000});
    const stoppedCount = (await schedules(page)).length;
    const stopped = await stableVolume(page, 0, 650, true);
    assert.equal((await schedules(page)).length, stoppedCount, 'Stop prevents future scheduling');

    if (!await page.locator('#synthMenu').evaluate(node => node.open)) await page.locator('#synthMenuButton').click();
    await page.locator('#ymProjectNewButton').click();
    await page.locator('#ymNewProjectDialog').waitFor({state:'visible'});
    await page.locator('#ymNewProjectCreate').click();
    await page.locator('#ymNewProjectDialog').waitFor({state:'hidden'});
    await page.waitForFunction(() => document.getElementById('ymFilesTree').querySelector('button[data-file-path="/examples/volume-modulation.js"]'));
    assert.equal(await page.evaluate(() => tetoricaYm2149StSynth.getCodeState().running), false, 'New project restores example without autorun');
    assert.deepEqual(await page.evaluate(() => tetoricaYm2149StSynth.getCodeState().loopNames), []);
    const audit = await page.evaluate(() => ({contexts:__ymVolumeAudit.contexts.length, nodes:__ymVolumeAudit.nodes.length,
      speakerRoutes:__ymVolumeAudit.meters.length, physicalOutputMuted:__ymVolumeAudit.meters.every(row => row.mute.gain.value === 0),
      stoppedPcm:__ymVolumeAudit.level(), failedReceipts:__ymVolumeAudit.receipts.filter(row => !row.ok),
      lifecycle:__ymVolumeAudit.traffic.filter(row => !['capture', 'schedule'].includes(row.action))}));
    assert.equal(audit.contexts, 1); assert.equal(audit.nodes, 1); assert(audit.speakerRoutes > 0);
    assert(audit.physicalOutputMuted); assert(audit.stoppedPcm.rms < 1e-6); assert.deepEqual(audit.failedReceipts, []);
    assert.deepEqual(errors, []); assert.deepEqual(missing, []);
    return {engine:name, passed:true, editor:'Offline textarea; external CDN intentionally blocked',
      files:{coldAudioContexts:0, keyboardModePreserved:true, newProjectExamplePresent:true, newProjectAutorun:false},
      pcm, fixedVolume, compile, initial, initialMelody, applied, editedMelody, removedMotion, remainingMelody,
      canceledSentinel, stopped, audit, errors, missing, console:consoleText};
  } catch (error) {
    if (page) try {console.error(JSON.stringify({engine:name, diagnostics:await page.evaluate(() => ({
      code:tetoricaYm2149StSynth.getCodeState(), error:document.getElementById('synthCodeError').textContent,
      log:document.getElementById('synthCodeLog').textContent,
      traffic:__ymVolumeAudit.traffic.filter(row => row.action !== 'capture').slice(-12),
      receipts:__ymVolumeAudit.receipts.filter(row => row.action !== 'capture').slice(-12),
      commands:__ymVolumeAudit.commands.slice(-12)}))}, null, 2));} catch {}
    throw error;
  } finally {await context?.close(); await browser.close();}
}

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, results = [];
  try {
    for (const engine of engines) results.push(await runEngine(engine, origin));
    const report = {passed:true, entry:config.entry, physicalOutputMuted:true, results};
    await fs.mkdir(path.dirname(config.out), {recursive:true});
    await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {await new Promise(resolve => server.close(resolve));}
}
main().catch(error => {console.error(error); process.exitCode = 1;});
