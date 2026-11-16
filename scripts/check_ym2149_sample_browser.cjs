// SPDX-License-Identifier: BSD-3-Clause
// Exercise the shipped volume-register sample through the real Files / Code UI.
// PCM is observed upstream of a permanent zero-gain physical output route.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const config = {root:path.resolve(__dirname, '../docs'), entry:'/synth-ym2149-st/index.html',
  engines:'chromium,webkit', out:path.join(os.tmpdir(), 'ym2149-volume-sample-browser.json')};
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
const digest = value => createHash('sha256').update(value).digest('hex');
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
  const audit = window.__ymSampleAudit = {contexts:[], nodes:[], meters:[], traffic:[], receipts:[], commands:[],
    pcm:[], sequence:0, armStop:false, armedStop:null};
  window.AudioContext = class extends Context {constructor(...args) {super(...args); audit.contexts.push(this);}};
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, options) {super(context, name, options); if (name === 'tetorica-ay8910') audit.nodes.push(this);}
  };
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...args);
    const analyser = this.context.createAnalyser(), mute = this.context.createGain();
    analyser.fftSize = 256; analyser.smoothingTimeConstant = 0; mute.gain.value = 0;
    connect.call(this, analyser); connect.call(analyser, mute); connect.call(mute, destination);
    audit.meters.push({analyser, mute}); return destination;
  };
  audit.level = () => {
    let peak = 0, sum = 0, count = 0;
    for (const {analyser} of audit.meters) {
      const pcm = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(pcm);
      for (const value of pcm) {peak = Math.max(peak, Math.abs(value)); sum += value * value; count++;}
    }
    return {peak, rms:Math.sqrt(sum / Math.max(1, count))};
  };
  setInterval(() => {
    if (audit.contexts.length) audit.pcm.push({audioTime:audit.contexts.at(-1).currentTime, ...audit.level()});
  }, 4);
  audit.request = (method, args) => new Promise((resolve, reject) => {
    const node = audit.nodes.at(-1), id = `sample-browser-audit:${++audit.sequence}`;
    const listener = event => {
      if (event.data?.id !== id) return;
      node.port.removeEventListener('message', listener);
      if (event.data.error) reject(Error(event.data.error)); else resolve(event.data.value);
    };
    node.port.addEventListener('message', listener); node.port.start(); node.port.postMessage({method, args, id});
  });
  audit.capture = () => audit.request('ayTimed', [{action:'capture'}]);
  MessagePort.prototype.postMessage = function(data, ...args) {
    const audioTime = audit.contexts.at(-1)?.currentTime;
    if (data?.method === 'ayTimed') {
      const payload = structuredClone(data.args[0]);
      audit.traffic.push({...payload, id:data.id, time:performance.now() / 1000, audioTime,
        performance:structuredClone(data.timedPerformance)});
      const armed = audit.armStop && payload.action === 'schedule' && payload.options?.name === 'volume-sample';
      if (armed) audit.armStop = false;
      if (data.id !== undefined) {
        const port = this, listener = event => {
          if (event.data?.id !== data.id) return;
          removeMessage.call(port, 'message', listener);
          audit.receipts.push({action:payload.action, owner:payload.owner, id:data.id, ok:!event.data.error,
            value:event.data.value, error:event.data.error});
          if (armed && !event.data.error) setTimeout(async () => {
            const evidence = audit.armedStop = {scheduleId:data.id, acknowledgement:event.data.value};
            try {evidence.beforeStop = await audit.capture();} catch (error) {evidence.error = error.message;}
            evidence.clickAudioTime = audit.contexts.at(-1).currentTime;
            document.getElementById('synthCodeStopButton').click();
          }, 10);
        };
        addMessage.call(port, 'message', listener); port.start();
      }
    }
    const commands = data?.commands ?? (Array.isArray(data) ? data : [data]);
    for (const command of commands) if (command?.method === 'writeRegister')
      audit.commands.push({...structuredClone(command), audioTime});
    return post.call(this, data, ...args);
  };
  audit.readProject = async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('tetorica-ym2149-st-synth-files', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {return await new Promise((resolve, reject) => {
      const request = database.transaction('projects').objectStore('projects').get('current');
      request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(request.error);
    });} finally {database.close();}
  };
}

const samplePath = '/examples/volume-sample.js';
async function ready(page) {
  await page.waitForFunction(() => window.tetoricaYm2149StSynth && !document.getElementById('ymFileNewButton')?.disabled);
  if (!await page.locator('#ymFilesPanel').isVisible()) await page.locator('#ymFilesToggle').click();
}
async function select(page, file) {
  await page.locator(`#ymFilesTree button[data-file-path="${file}"]`).click();
  await page.waitForFunction(file => document.getElementById('ymFilesSelected').textContent === file, file);
  await page.locator('#synthInputCodeTab').click();
  await page.waitForFunction(() => !document.getElementById('synthCodeEditor').readOnly);
  return page.locator('#synthCodeEditor');
}
async function stored(page, predicate) {
  const until = Date.now() + 15000;
  do {
    const project = await page.evaluate(() => __ymSampleAudit.readProject());
    if (predicate(project)) return project;
    await page.waitForTimeout(30);
  } while (Date.now() < until);
  assert.fail('Edited Files persist to the saved project');
}
const schedules = (page, index = 0) => page.evaluate(index => __ymSampleAudit.traffic.slice(index).filter(
  row => row.action === 'schedule' && row.options?.name === 'volume-sample'), index);
async function waitSchedules(page, count, index = 0) {
  await page.waitForFunction(({count, index}) => __ymSampleAudit.traffic.slice(index).filter(
    row => row.action === 'schedule' && row.options?.name === 'volume-sample').length >= count,
  {count, index}, {timeout:12000});
  return schedules(page, index);
}
async function acknowledged(page, action, index, owner) {
  await page.waitForFunction(({action, index, owner}) => __ymSampleAudit.receipts.slice(index).some(
    row => row.action === action && row.ok && (owner === undefined || row.owner === owner)), {action, index, owner});
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const value = await __ymSampleAudit.capture();
    return {volume:value.registers[8], mixer:value.registers[7], otherVolumes:[value.registers[9], value.registers[10]],
      frame:value.frame, sampleRate:value.sampleRate, level:__ymSampleAudit.level()};
  });
}
async function stableVolume(page, volume, durationMs, silent = false) {
  const observations = [], start = Date.now();
  do {
    const value = await snapshot(page); observations.push(value);
    assert.equal(value.volume, volume, `R8 after cancellation ACK: ${JSON.stringify(observations)}`);
    if (silent) assert(value.level.rms < 1e-6, 'Upstream PCM remains silent after cleanup');
    await page.waitForTimeout(20);
  } while (Date.now() - start < durationMs);
  assert(observations.at(-1).frame > observations[0].frame, 'Worklet frames advance');
  return {first:observations[0], last:observations.at(-1), observations:observations.length, durationMs};
}
async function apply(page, source, marker) {
  const receiptIndex = await page.evaluate(() => __ymSampleAudit.receipts.length);
  await page.locator('#synthCodeEditor').fill(source + `\nconsole.log(${JSON.stringify(marker)});\n`);
  await page.locator('#synthCodeApplyButton').click();
  await page.waitForFunction(marker => document.getElementById('synthCodeLog').textContent.includes(marker), marker);
  return receiptIndex;
}
async function checkSchedules(page, rows, expectedInterval) {
  await page.waitForFunction(ids => ids.every(id => __ymSampleAudit.receipts.some(receipt => receipt.id === id)),
    rows.map(row => row.id));
  const receipts = await page.evaluate(() => __ymSampleAudit.receipts);
  const reservations = [];
  let expectedCodes;
  for (const row of rows) {
    assert(row.owner?.includes(':loop:'), 'One-shot reservation belongs to the drums loop');
    assert(!Object.hasOwn(row.options, 'repeatSeconds'), 'The shipped sample is a one-shot');
    assert.equal(row.operations.referenceSampleRate, 8000);
    const operations = row.operations.operations;
    assert.equal(operations.length, 641);
    for (const [index, operation] of operations.entries()) {
      assert.equal(operation.method, 'setVolume');
      assert.equal(operation.time.unit, 'sample'); assert.equal(operation.time.value, index);
      assert.equal(operation.args[0], 0); assert.equal(operation.args[2], false);
      assert(Number.isInteger(operation.args[1]) && operation.args[1] >= 0 && operation.args[1] <= 15);
    }
    assert.deepEqual(operations.at(-1).args, [0, 0, false], 'Explicit terminal R8 zero at source frame 640');
    const codes = operations.map(operation => operation.args[1]);
    if (expectedCodes) assert.deepEqual(codes, expectedCodes, 'BPM never changes sample quantization');
    expectedCodes = codes;
    assert(new Set(codes).size >= 12, 'The sample uses the nonlinear sixteen-code DAC range');
    const ack = receipts.find(receipt => receipt.id === row.id);
    assert(ack?.ok, 'AudioWorklet accepted the actual one-shot reservation');
    assert.equal(ack.value.entries, 641); assert.equal(ack.value.repeatSeconds, undefined);
    const outputFrames = operations.map(operation => Math.round(operation.time.value / 8000 * ack.value.sampleRate));
    assert.equal(outputFrames.at(-1), Math.round(0.08 * ack.value.sampleRate));
    assert(outputFrames.every((frame, index) => index === 0 || frame > outputFrames[index - 1]));
    reservations.push({startFrame:ack.value.startFrame, outputSampleRate:ack.value.sampleRate,
      sourceSampleRate:8000, entries:641, sampleOffsetRange:[0, 640], consecutiveSourceOffsets:true,
      durationSeconds:0.08, nominalWritesPerSecond:8000, terminalRegister:8, terminalValue:0,
      outputFrameRange:[0, outputFrames.at(-1)], distinctOutputFrameSteps:[...new Set(outputFrames.slice(1).map((f, i) => f - outputFrames[i]))]});
  }
  const intervals = rows.slice(1).map((row, index) => row.audioTime - rows[index].audioTime);
  for (const seconds of intervals) assert(Math.abs(seconds - expectedInterval) < 0.09,
    `Expected ${expectedInterval}s between hits; observed ${seconds}s`);
  return {owner:rows[0].owner, hitIntervalSeconds:expectedInterval, intervalsSeconds:intervals,
    codesSha256:digest(JSON.stringify(expectedCodes)), first24Codes:expectedCodes.slice(0, 24),
    last12Codes:expectedCodes.slice(-12), reservations};
}
async function percussion(page, rows) {
  const {pcm, receipts} = await page.evaluate(() => ({pcm:__ymSampleAudit.pcm, receipts:__ymSampleAudit.receipts}));
  const hits = [];
  for (const row of rows.slice(0, -1)) {
    const ack = receipts.find(receipt => receipt.id === row.id).value, start = ack.startFrame / ack.sampleRate;
    const inside = pcm.filter(frame => frame.audioTime >= start + 0.008 && frame.audioTime < start + 0.07);
    const between = pcm.filter(frame => frame.audioTime >= start + 0.14 && frame.audioTime < start + 0.35);
    assert(inside.length >= 5 && between.length >= 8, 'Meter samples both a hit and its following rest');
    const peak = Math.max(...inside.map(frame => frame.peak));
    const restRms = Math.max(...between.map(frame => frame.rms));
    assert(peak > 0.0001, 'The Worklet produces a percussive volume-register pulse');
    assert(restRms < 1e-6, 'Explicit terminal zero produces silence between hits');
    hits.push({startSeconds:start, pulsePeak:peak, restMaxRms:restRms,
      pulseObservations:inside.length, restObservations:between.length});
  }
  return hits;
}
function checkCompileTable(consoleText, expectedCodes) {
  const table = consoleText.split('\n').filter(line => line.includes('|')).map(line => line.split('|').map(cell => cell.trim()));
  const header = table.find(row => row.includes('register') && row.includes('value') && row.includes('offsetSeconds'));
  assert(header, 'Code Console displays the actual client compile table');
  const rows = table.slice(table.indexOf(header) + 1).filter(row => /^\d+$/.test(row[0]));
  assert.equal(rows.length, 24, 'The console table preview stays bounded to the first 24 writes');
  for (const [index, row] of rows.entries()) {
    assert.equal(Number(row[header.indexOf('register')]), 8);
    assert.equal(Number(row[header.indexOf('value')]), expectedCodes[index]);
    assert(Math.abs(Number(row[header.indexOf('offsetSeconds')]) - index / 8000) < 1e-10);
  }
  assert(consoleText.includes('641') && /24/.test(consoleText), 'Console labels the preview and complete write count');
  return {initialState:'client', completeWrites:641, previewWrites:rows.length,
    first24:rows.map(row => ({offsetSeconds:Number(row[header.indexOf('offsetSeconds')]),
      register:Number(row[header.indexOf('register')]), value:Number(row[header.indexOf('value')])}))};
}

async function runEngine(name, origin) {
  const browser = await ({chromium, webkit}[name]).launch({headless:true});
  let context, page;
  const errors = [], missing = [];
  try {
    context = await browser.newContext({viewport:{width:1280, height:1050}});
    await context.addInitScript(installSilentAudit);
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {if (response.url().startsWith(origin) && response.status() >= 400) missing.push(response.url());});
    await page.goto(origin + config.entry); await ready(page);
    await page.locator(`#ymFilesTree button[data-file-path="${samplePath}"]`).waitFor({state:'visible'});
    assert.equal(await page.evaluate(() => __ymSampleAudit.contexts.length), 0, 'The default sample appears without opening audio');
    assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'), 'keyboard');
    assert.equal(await page.evaluate(() => tetoricaYm2149StSynth.getCodeState().running), false);
    const editor = await select(page, samplePath), example = await editor.inputValue();
    assert(example.includes('const sampleRate = 8000;') && example.includes('const durationSeconds = 0.08;'));
    assert(example.includes('tone: false, noise: false, volume: 0, envelope: false'));
    assert(example.includes('liveCleanup(["drums"], () => ym.keyOff(CH1));'));
    assert(example.includes('initialState: "client"') && example.includes('writes.slice(0, 24)'));

    // Use the actual Files editor, then reload a saved project. Startup must
    // preserve the user's index and their edited copy of this default example.
    const savedSample = example + '\n// Keep my edited volume sample.\n';
    await editor.fill(savedSample);
    const indexEditor = await select(page, '/index.js');
    const savedIndex = (await indexEditor.inputValue()) + '\n// Keep my project index.\n';
    await indexEditor.fill(savedIndex);
    await select(page, samplePath);
    await stored(page, project => project?.filesystem.files.some(file => file.path === samplePath && file.data === savedSample) &&
      project.filesystem.files.some(file => file.path === '/index.js' && file.data === savedIndex));
    assert.equal(await page.evaluate(() => __ymSampleAudit.contexts.length), 0, 'Editing Files stays cold');
    await page.reload(); await ready(page);
    assert.equal(await page.evaluate(() => __ymSampleAudit.contexts.length), 0, 'Restoring edited files stays cold');
    assert.equal(await (await select(page, samplePath)).inputValue(), savedSample, 'Edited default sample survives startup');
    const recovered = await stored(page, project => project?.filesystem.files.some(file => file.path === '/index.js' && file.data === savedIndex));
    assert.equal(recovered.filesystem.files.find(file => file.path === samplePath).data, savedSample);
    assert.equal(await page.evaluate(() => tetoricaYm2149StSynth.getCodeState().running), false);

    await page.locator('#synthCodeRunButton').click();
    await page.waitForFunction(() => tetoricaYm2149StSynth.getCodeState().running &&
      tetoricaYm2149StSynth.getCodeState().loopNames.join(',') === 'drums');
    const initialRows = (await waitSchedules(page, 4)).slice(0, 4);
    const initial = await checkSchedules(page, initialRows, 0.5);
    const pcm = await percussion(page, initialRows);
    const consoleText = await page.locator('#synthCodeLog').textContent();
    const compile = checkCompileTable(consoleText, initial.first24Codes);
    const voice = await snapshot(page);
    assert.equal(voice.mixer & 9, 9, 'CH1 tone and noise generators are disabled');
    assert.deepEqual(voice.otherVolumes, [0, 0], 'CH2 and CH3 begin keyed off');

    // Apply changes the musical beat while preserving the exact source frames,
    // reference sample rate, quantized codes and explicit 80 ms terminal zero.
    const faster = example.replace('setBpm(120);', 'setBpm(240);');
    const editIndex = await page.evaluate(() => __ymSampleAudit.traffic.length);
    await apply(page, faster, 'VOLUME_SAMPLE_BPM_240_APPLIED');
    const editedRows = await waitSchedules(page, 5, editIndex);
    const applied = await checkSchedules(page, editedRows.slice(1, 5), 0.25);
    assert.equal(applied.owner, initial.owner, 'Apply retains the named drums owner');
    assert.equal(applied.codesSha256, initial.codesSha256, 'BPM leaves all sample codes unchanged');

    const removedSource = faster.replace(/liveLoop\("drums", async \(\) => \{[\s\S]*?\n\}\);\n/, '');
    assert(!removedSource.includes('liveLoop("drums"'));
    const removeReceipt = await apply(page, removedSource, 'VOLUME_SAMPLE_DRUMS_REMOVED');
    await acknowledged(page, 'releaseOwner', removeReceipt, initial.owner);
    await page.waitForFunction(() => __ymSampleAudit.level().rms < 1e-6, {}, {timeout:5000});
    assert.deepEqual(await page.evaluate(() => tetoricaYm2149StSynth.getCodeState().loopNames), []);
    const removed = await stableVolume(page, 0, 650, true);
    const removedCount = (await schedules(page)).length;
    // A sentinel is established only after the Worklet cancellation ACK.
    // It proves that no old source-frame event, including terminal zero, fires.
    await page.evaluate(() => __ymSampleAudit.request('writeRegister', [8, 15]));
    const removedSentinel = await stableVolume(page, 15, 650);
    assert.equal((await schedules(page)).length, removedCount, 'Removing drums prevents future hits');
    await page.evaluate(() => __ymSampleAudit.request('writeRegister', [8, 0]));

    // Arm the genuine Stop button from the next accepted reservation, avoiding
    // a browser-driver round trip longer than the shipped 80 ms sample itself.
    const restartIndex = await page.evaluate(() => {__ymSampleAudit.armStop = true; return __ymSampleAudit.traffic.length;});
    const stopReceipt = await page.evaluate(() => __ymSampleAudit.receipts.length);
    await apply(page, faster, 'VOLUME_SAMPLE_STOP_ARMED');
    const restored = (await waitSchedules(page, 1, restartIndex))[0];
    await page.waitForFunction(() => {const state = tetoricaYm2149StSynth.getCodeState();
      return __ymSampleAudit.armedStop?.beforeStop && !state.running && !state.stopping && !state.busy;});
    const armedStop = await page.evaluate(() => {
      const {acknowledgement, beforeStop, clickAudioTime, error} = __ymSampleAudit.armedStop;
      return {startFrame:acknowledgement.startFrame, sampleRate:acknowledgement.sampleRate,
        beforeStopFrame:beforeStop.frame, beforeStopVolume:beforeStop.registers[8], clickAudioTime, error};
    });
    assert.equal(armedStop.error, undefined);
    armedStop.elapsedSeconds = (armedStop.beforeStopFrame - armedStop.startFrame) / armedStop.sampleRate;
    assert(armedStop.elapsedSeconds >= 0 && armedStop.elapsedSeconds < 0.08,
      `Stop is initiated mid-shot, at ${armedStop.elapsedSeconds}s`);
    await acknowledged(page, 'cancelOwner', stopReceipt, restored.owner);
    await page.waitForFunction(() => __ymSampleAudit.level().rms < 1e-6, {}, {timeout:5000});
    const stoppedCount = (await schedules(page)).length;
    const stopped = await stableVolume(page, 0, 650, true);
    await page.evaluate(() => __ymSampleAudit.request('writeRegister', [8, 15]));
    const stoppedSentinel = await stableVolume(page, 15, 650);
    assert.equal((await schedules(page)).length, stoppedCount, 'Stop prevents future hits');
    await page.evaluate(() => __ymSampleAudit.request('writeRegister', [8, 0]));
    await page.waitForFunction(() => __ymSampleAudit.level().rms < 1e-6, {}, {timeout:5000});
    const audit = await page.evaluate(() => ({contexts:__ymSampleAudit.contexts.length, nodes:__ymSampleAudit.nodes.length,
      speakerRoutes:__ymSampleAudit.meters.length, physicalOutputMuted:__ymSampleAudit.meters.every(row => row.mute.gain.value === 0),
      finalPcm:__ymSampleAudit.level(), failedReceipts:__ymSampleAudit.receipts.filter(row => !row.ok),
      lifecycle:__ymSampleAudit.traffic.filter(row => !['capture', 'schedule'].includes(row.action))}));
    assert.equal(audit.contexts, 1); assert.equal(audit.nodes, 1); assert(audit.speakerRoutes > 0);
    assert(audit.physicalOutputMuted); assert(audit.finalPcm.rms < 1e-6); assert.deepEqual(audit.failedReceipts, []);
    assert.deepEqual(errors, []); assert.deepEqual(missing, []);
    return {engine:name, passed:true, editor:'Offline textarea; external CDN intentionally blocked',
      files:{coldDefaultVisible:true, coldAudioContexts:0, coldAutorun:false, editingOpenedAudio:false,
        savedIndexPreserved:true, editedSamplePreserved:true, savedIndexSha256:digest(savedIndex), savedSampleSha256:digest(savedSample)},
      compile, initial, pcm, voice, applied, removed, removedSentinel, armedStop, stopped, stoppedSentinel,
      audit, errors, missing, console:consoleText};
  } catch (error) {
    if (page) try {console.error(JSON.stringify({engine:name, diagnostics:await page.evaluate(() => ({
      code:window.tetoricaYm2149StSynth?.getCodeState(), error:document.getElementById('synthCodeError')?.textContent,
      log:document.getElementById('synthCodeLog')?.textContent,
      traffic:__ymSampleAudit.traffic.filter(row => row.action !== 'capture').slice(-5),
      receipts:__ymSampleAudit.receipts.filter(row => row.action !== 'capture').slice(-8),
      armedStop:__ymSampleAudit.armedStop,
      commands:__ymSampleAudit.commands.slice(-12)}))}, null, 2));} catch {}
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
