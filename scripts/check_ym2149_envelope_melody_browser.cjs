// SPDX-License-Identifier: BSD-3-Clause
// Exercise the original envelope-pitched melody through the real Files / Code UI.
// Every physical destination is permanently muted before application modules run.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const {chromium, webkit} = require('playwright');

const config = {root:path.resolve(__dirname, '../docs'), entry:'/synth-ym2149-st/index.html',
  engines:'chromium,webkit', out:path.join(os.tmpdir(), 'ym2149-envelope-melody-browser.json')};
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
const examplePath = '/examples/envelope-melody.js';
const expectedHz = [52, 55, 57].map(midi => 440 * 2 ** ((midi - 69) / 12));
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.wasm':'application/wasm',
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
  const audit = window.__ymEnvelopeMelodyAudit = {contexts:[], nodes:[], meters:[], traffic:[], receipts:[], commands:[], sequence:0};
  window.AudioContext = class extends Context {constructor(...args) {super(...args); audit.contexts.push(this);}};
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, options) {super(context, name, options); if (name === 'tetorica-ay8910') audit.nodes.push(this);}
  };
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...args);
    const analyser = this.context.createAnalyser(), mute = this.context.createGain();
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0; mute.gain.value = 0;
    connect.call(this, analyser); connect.call(analyser, mute); connect.call(mute, destination);
    audit.meters.push({analyser, mute}); return destination;
  };
  audit.level = () => {
    let peak = 0, sum = 0, square = 0, count = 0;
    for (const {analyser} of audit.meters) {
      const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values);
      for (const value of values) {peak = Math.max(peak, Math.abs(value)); sum += value; square += value * value; count++;}
    }
    const rms = Math.sqrt(square / Math.max(1, count));
    return {peak, rms, acRms:Math.sqrt(Math.max(0, square / Math.max(1, count) - (sum / Math.max(1, count)) ** 2))};
  };
  audit.request = (method, args) => new Promise((resolve, reject) => {
    const node = audit.nodes.at(-1);
    if (!node) {reject(Error('No live AY node')); return;}
    const id = `envelope-melody-audit:${++audit.sequence}`;
    const timeout = setTimeout(() => {node.port.removeEventListener('message', listener); reject(Error('AY audit response exceeded five seconds'));}, 5000);
    const listener = event => {
      if (event.data?.id !== id) return;
      clearTimeout(timeout); node.port.removeEventListener('message', listener);
      event.data.error ? reject(Error(event.data.error)) : resolve(event.data.value);
    };
    node.port.addEventListener('message', listener); node.port.start(); node.port.postMessage({method, args, id});
  });
  audit.capture = () => audit.request('ayTimed', [{action:'capture'}]);
  MessagePort.prototype.postMessage = function(data, ...args) {
    if (data?.method === 'ayTimed') {
      const payload = structuredClone(data.args[0]);
      audit.traffic.push({...payload, id:data.id, time:performance.now() / 1000,
        audioTime:audit.contexts.at(-1)?.currentTime});
      if (data.id !== undefined) {
        const port = this, listener = event => {
          if (event.data?.id !== data.id) return;
          removeMessage.call(port, 'message', listener);
          audit.receipts.push({action:payload.action, owner:payload.owner, id:data.id,
            ok:!event.data.error, value:event.data.value, error:event.data.error});
        };
        addMessage.call(port, 'message', listener); port.start();
      }
    } else if (data?.method && ['setEnvelope','setVoice','keyOn','keyOff','writeRegister'].includes(data.method)) {
      audit.commands.push({method:data.method, args:structuredClone(data.args), audioTime:audit.contexts.at(-1)?.currentTime});
    }
    return post.call(this, data, ...args);
  };
}

const schedules = (page, index = 0) => page.evaluate(index => __ymEnvelopeMelodyAudit.traffic.slice(index).filter(
  row => row.action === 'schedule' && row.options?.name === 'envelope-melody'), index);
async function waitSchedules(page, count, index = 0) {
  await page.waitForFunction(({count, index}) => __ymEnvelopeMelodyAudit.traffic.slice(index).filter(
    row => row.action === 'schedule' && row.options?.name === 'envelope-melody').length >= count,
  {count, index}, {timeout:15000});
  return schedules(page, index);
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const state = await __ymEnvelopeMelodyAudit.capture();
    return {mixer:state.registers[7], volume:state.registers[8], others:[state.registers[9], state.registers[10]],
      shape:state.registers[13] & 15, period:state.registers[11] | state.registers[12] << 8,
      frame:state.frame, sampleRate:state.sampleRate, level:__ymEnvelopeMelodyAudit.level()};
  });
}
async function untilSnapshot(page, predicate, label, timeout = 5000) {
  const end = Date.now() + timeout;
  let value;
  do {value = await snapshot(page); if (predicate(value)) return value; await page.waitForTimeout(10);} while (Date.now() < end);
  assert.fail(`${label}: ${JSON.stringify(value)}`);
}
async function acknowledged(page, action, index, owner) {
  await page.waitForFunction(({action, index, owner}) => __ymEnvelopeMelodyAudit.receipts.slice(index).some(
    r => r.action === action && r.ok && (owner === undefined || r.owner === owner)), {action, index, owner});
}
async function apply(page, source, marker) {
  const receiptIndex = await page.evaluate(() => __ymEnvelopeMelodyAudit.receipts.length);
  await page.locator('#synthCodeEditor').fill(source + `\nconsole.log(${JSON.stringify(marker)});\n`);
  await page.locator('#synthCodeApplyButton').click();
  await page.waitForFunction(marker => document.getElementById('synthCodeLog').textContent.includes(marker), marker);
  return receiptIndex;
}
function checkSchedules(rows, spacingSeconds) {
  const first = rows.findIndex(row => Math.abs(1 / row.options.repeatSeconds - expectedHz[0]) < 1e-8);
  assert(first >= 0, 'Observed E3 envelope pitch');
  const sequence = rows.slice(first, first + expectedHz.length);
  assert.equal(sequence.length, expectedHz.length);
  for (let index = 0; index < sequence.length; index++) {
    const row = sequence[index];
    assert(Math.abs(1 / row.options.repeatSeconds - expectedHz[index]) < 1e-8,
      'Equal-tempered note frequency controls R13 repeat, not Tone registers');
    assert(row.owner?.includes(':loop:'), 'Reservation belongs to the melody loop');
    assert.equal(row.operations.operations.length, 1, 'Repeating pattern remains compact');
    const operation = row.operations.operations[0];
    assert.equal(operation.method, 'setEnvelope'); assert.deepEqual(operation.args, [{shape:9}]);
    assert.deepEqual(operation.time, {unit:'sample', value:0});
    assert.equal(row.operations.referenceSampleRate, 44100, 'Reference clock is independent of output rate');
  }
  const spacing = sequence.slice(1).map((row, index) => row.audioTime - sequence[index].audioTime);
  for (const interval of spacing) assert(Math.abs(interval - spacingSeconds) < 0.15,
    `Expected ${spacingSeconds}s melody step; got ${interval}s`);
  return {owner:sequence[0].owner, frequenciesHz:expectedHz, repeatSeconds:sequence.map(row => row.options.repeatSeconds),
    melodyStepSeconds:spacingSeconds, observedIntervalsSeconds:spacing, operation:sequence[0].operations.operations[0]};
}
async function stableSentinel(page, shape, durationMs = 300) {
  const observations = [], end = Date.now() + durationMs;
  do {
    const current = await snapshot(page); observations.push(current);
    assert.equal(current.shape, shape, 'Old R13 reservation cannot overwrite the post-ACK sentinel');
    assert.equal(current.volume, 0, 'Cleanup silences the last envelope-selected voice');
    await page.waitForTimeout(25);
  } while (Date.now() < end);
  assert(observations.at(-1).frame > observations[0].frame);
  return {first:observations[0], last:observations.at(-1), observations:observations.length};
}

async function runEngine(name, origin) {
  const browser = await ({chromium, webkit}[name]).launch({headless:true,
    ...(name === 'chromium' ? {args:['--mute-audio']} : {})});
  let context, page;
  try {
    context = await browser.newContext({viewport:{width:1280, height:1050}});
    await context.addInitScript(installSilentAudit);
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    page = await context.newPage(); page.setDefaultTimeout(20000);
    const errors = [], missing = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {if (response.url().startsWith(origin) && response.status() >= 400) missing.push(response.url());});
    await page.goto(origin + config.entry);
    await page.waitForFunction(() => window.tetoricaYm2149StSynth && !document.getElementById('ymFileNewButton')?.disabled);
    const cold = async () => {
      assert.equal(await page.evaluate(() => __ymEnvelopeMelodyAudit.contexts.length), 0);
      assert.equal(await page.evaluate(() => tetoricaYm2149StSynth.getCodeState().running), false);
    };
    await cold();
    if (!await page.locator('#ymFilesPanel').isVisible()) await page.locator('#ymFilesToggle').click();
    await page.locator(`#ymFilesTree button[data-file-path="${examplePath}"]`).waitFor({state:'visible'});
    await page.locator(`#ymFilesTree button[data-file-path="${examplePath}"]`).click();
    assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'), 'keyboard', 'Selecting an example keeps Keyboard');
    await cold();
    await page.locator('#synthInputCodeTab').click();
    const editor = page.locator('#synthCodeEditor'); await editor.waitFor({state:'visible'});
    await page.waitForFunction(() => !document.getElementById('synthCodeEditor').readOnly);
    const example = await editor.inputValue();
    assert(example.includes('envelope-melody') && example.includes('shape: 9'));
    const savedExample = example + '\n// Preserved browser-check source edit.\n';
    await editor.fill(savedExample);
    await page.locator('#ymFilesTree button[data-file-path="/examples/README.md"]').click();
    await page.waitForFunction(() => document.getElementById('ymFilesSelected').textContent === '/examples/README.md' &&
      document.getElementById('synthCodeEditor').value.startsWith('# YM2149 timed sound examples'));
    assert((await editor.inputValue()).includes('envelope-melody.js'));
    await page.locator(`#ymFilesTree button[data-file-path="${examplePath}"]`).click();
    await page.waitForFunction(file => document.getElementById('ymFilesSelected').textContent === file &&
      document.getElementById('synthCodeEditor').value.includes('// Preserved browser-check source edit.'), examplePath);
    assert.equal(await editor.inputValue(), savedExample, 'File selection preserves edited source');
    await cold();

    await page.locator('#synthCodeRunButton').click();
    await page.waitForFunction(() => tetoricaYm2149StSynth.getCodeState().running);
    await page.waitForFunction(() => __ymEnvelopeMelodyAudit.level().acRms > 0.0001);
    const sound = await untilSnapshot(page, value => (value.mixer & 9) === 9 && value.volume === 16, 'Envelope alone supplies sound');
    assert.deepEqual(sound.others, [0, 0]); assert.equal(sound.shape, 9); assert.equal(sound.period, 100);
    const initialRows = await waitSchedules(page, 3), initial = checkSchedules(initialRows, 0.5);
    await page.waitForFunction(() => __ymEnvelopeMelodyAudit.receipts.filter(row => row.action === 'schedule' && row.ok).length >= 3);
    const displayedShape = await page.locator('#envelopeShape').inputValue();
    assert.equal(displayedShape, '9', 'The live editor displays the same Shape 9 used by the Worklet reservation');
    const consoleText = await page.locator('#synthCodeLog').textContent();
    const table = consoleText.split('\n').filter(line => line.includes('|')).map(line => line.split('|').map(cell => cell.trim()));
    const header = table.find(row => row.includes('register') && row.includes('value'));
    assert(header && table.some(row => row[header.indexOf('register')] === '13' && row[header.indexOf('value')] === '9'), 'Console exposes the R13=9 compile row');
    assert(consoleText.includes('Envelope pitch:'), 'Note / retrigger Hz are visible');

    // Edit the actual Period spinbutton. The repeat pattern only rewrites R13.
    await page.locator('#ymChannel1Tab').click();
    await page.locator('#envelopePeriodDisplay').press('Home');
    for (let i = 0; i < 3; i++) await page.locator('#envelopePeriodDisplay').press('PageUp');
    const manual = await untilSnapshot(page, value => value.period === 48, 'Manual Period reaches hardware');
    const beforeManualRows = (await schedules(page)).length, periodObservations = [];
    const end = Date.now() + 1150;
    do {const value = await snapshot(page); periodObservations.push({period:value.period, frame:value.frame}); assert.equal(value.period, 48); await page.waitForTimeout(25);} while (Date.now() < end);
    assert((await schedules(page)).length > beforeManualRows, 'Notes continue while Period is edited');
    assert.equal(await page.evaluate(() => tetoricaYm2149StSynth.getCodeState().running), true);

    const faster = example.replace('setBpm(120)', 'setBpm(240)');
    assert.notEqual(faster, example);
    const fastIndex = await page.evaluate(() => __ymEnvelopeMelodyAudit.traffic.length);
    await apply(page, faster, 'ENVELOPE_MELODY_BPM_240_APPLIED');
    const fasterRows = await waitSchedules(page, 5, fastIndex), applied = checkSchedules(fasterRows, 0.25);
    assert.equal(applied.owner, initial.owner, 'Apply retains named-loop ownership');
    assert.deepEqual(applied.repeatSeconds, initial.repeatSeconds, 'BPM changes note spacing, not pitch');
    await untilSnapshot(page, value => value.period === 100, 'Apply intentionally re-runs the example setup');

    const removed = faster.replace(/liveLoop\("envelope-melody", async \(\) => \{[\s\S]*?\n\}\);\n/, '');
    assert(!removed.includes('liveLoop("envelope-melody"'));
    const removeReceipt = await apply(page, removed, 'ENVELOPE_MELODY_LOOP_REMOVED');
    await acknowledged(page, 'releaseOwner', removeReceipt, initial.owner);
    assert.deepEqual(await page.evaluate(() => tetoricaYm2149StSynth.getCodeState().loopNames), []);
    await page.evaluate(() => __ymEnvelopeMelodyAudit.request('writeRegister', [13, 13]));
    const removedLoop = await stableSentinel(page, 13, 400);
    await page.waitForFunction(() => __ymEnvelopeMelodyAudit.level().rms < 1e-6);

    const restoreIndex = await page.evaluate(() => __ymEnvelopeMelodyAudit.traffic.length);
    await apply(page, faster, 'ENVELOPE_MELODY_RESTORED');
    const restoredRows = await waitSchedules(page, 1, restoreIndex), restoredOwner = restoredRows[0].owner;
    const stopReceipt = await page.evaluate(() => __ymEnvelopeMelodyAudit.receipts.length);
    await page.locator('#synthCodeStopButton').click();
    await page.waitForFunction(() => {const state = tetoricaYm2149StSynth.getCodeState(); return !state.running && !state.stopping && !state.busy;});
    await acknowledged(page, 'cancelOwner', stopReceipt, restoredOwner);
    await page.waitForFunction(() => __ymEnvelopeMelodyAudit.level().rms < 1e-6);
    const stoppedCount = (await schedules(page)).length;
    await page.evaluate(() => __ymEnvelopeMelodyAudit.request('writeRegister', [13, 15]));
    const stopped = await stableSentinel(page, 15, 450);
    assert.equal((await schedules(page)).length, stoppedCount, 'Stop prevents future scheduling');
    const audit = await page.evaluate(() => ({contexts:__ymEnvelopeMelodyAudit.contexts.length, nodes:__ymEnvelopeMelodyAudit.nodes.length,
      speakerRoutes:__ymEnvelopeMelodyAudit.meters.length, physicalOutputMuted:__ymEnvelopeMelodyAudit.meters.every(item => item.mute.gain.value === 0),
      stoppedPcm:__ymEnvelopeMelodyAudit.level(), failedReceipts:__ymEnvelopeMelodyAudit.receipts.filter(row => !row.ok),
      lifecycle:__ymEnvelopeMelodyAudit.traffic.filter(row => !['capture','schedule'].includes(row.action))}));
    assert.equal(audit.contexts, 1); assert.equal(audit.nodes, 1); assert(audit.speakerRoutes > 0); assert(audit.physicalOutputMuted);
    assert(audit.stoppedPcm.rms < 1e-6); assert.deepEqual(audit.failedReceipts, []);
    assert.deepEqual(errors, []); assert.deepEqual(missing, []);
    return {engine:name, passed:true, files:{coldAudioContexts:0, keyboardModePreserved:true, editedSourcePreserved:true},
      sound, initial, displayedShape, manual:{...manual, observations:periodObservations}, applied, removedLoop, stopped, audit, errors, missing, console:consoleText};
  } catch (error) {
    if (page) try {console.error(JSON.stringify({engine:name, diagnostics:await page.evaluate(() => ({code:tetoricaYm2149StSynth.getCodeState(),
      error:document.getElementById('synthCodeError')?.textContent, log:document.getElementById('synthCodeLog')?.textContent,
      traffic:__ymEnvelopeMelodyAudit.traffic.filter(row => row.action !== 'capture').slice(-20),
      receipts:__ymEnvelopeMelodyAudit.receipts.filter(row => row.action !== 'capture').slice(-20)}))}, null, 2));} catch {}
    throw error;
  } finally {await context?.close(); await browser.close();}
}
async function main() {
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const origin = `http://127.0.0.1:${server.address().port}`, results = [];
  let failure;
  try {for (const engine of engines) results.push(await runEngine(engine, origin));} catch (error) {failure = error;}
  finally {server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));}
  const report = {passed:!failure, entry:config.entry, physicalOutputMuted:true, listeningPerformed:false, results,
    ...(failure ? {error:failure.stack ?? String(failure)} : {})};
  await fs.mkdir(path.dirname(config.out), {recursive:true}); await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
  if (failure) throw failure;
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => {console.error(error); process.exitCode = 1;});
