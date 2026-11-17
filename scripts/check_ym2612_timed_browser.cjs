// SPDX-License-Identifier: BSD-3-Clause
// Real FM Synth Code / Worklet integration. Every physical output is muted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const {chromium, webkit} = require('playwright');
const config = {root:path.resolve(__dirname, '../docs'), entry:'/synth/index.html',
  engines:'chromium,webkit', out:path.join(os.tmpdir(), 'ym2612-timed-browser.json')};
for (const argument of process.argv.slice(2)) {
  const match = /^--(root|entry|engines|out)=(.+)$/.exec(argument);
  assert(match, `Unknown argument ${argument}`); config[match[1]] = match[2];
}
config.root = path.resolve(config.root);
const mime = {'.js':'text/javascript', '.html':'text/html', '.css':'text/css',
  '.wasm':'application/wasm', '.json':'application/json', '.ts':'text/plain'};
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
  const connect = AudioNode.prototype.connect;
  const audit = window.__fmTimedAudit = {nodes:[], contexts:[], routes:[], sequence:0};
  window.AudioContext = class extends Context {constructor(...args) {super(...args); audit.contexts.push(this);}};
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, options) {super(context, name, options); if (name === 'ym2612-processor') audit.nodes.push(this);}
  };
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...args);
    const meter = this.context.createAnalyser(), mute = this.context.createGain();
    meter.fftSize = 2048; mute.gain.value = 0;
    connect.call(this, meter); connect.call(meter, mute); connect.call(mute, destination);
    audit.routes.push({meter, mute}); return destination;
  };
  audit.capture = () => new Promise((resolve, reject) => {
    const port = audit.nodes[0].port, id = 'fm-browser:' + ++audit.sequence;
    const listener = event => {
      if (event.data?.id !== id) return;
      port.removeEventListener('message', listener);
      event.data.error ? reject(Error(event.data.error)) : resolve(event.data.value);
    };
    port.addEventListener('message', listener); port.start();
    port.postMessage({method:'ym2612Timed', id, args:[{action:'capture'}]});
  });
  audit.level = () => {
    let peak = 0;
    for (const {meter} of audit.routes) {
      const pcm = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(pcm);
      for (const value of pcm) peak = Math.max(peak, Math.abs(value));
    }
    return peak;
  };
}

const base = `const fm = await useSoundChip("ym2612");
fm.setAlgo(CH1,7); fm.setPan(CH1,true,true);
fm.setOperators(CH1, [[OP1,{dt:3,multi:1,tl:32,ar:31,d1r:0,d2r:0,sl:0,rr:8}],
 [OP2,{tl:127}], [OP3,{tl:127}], [OP4,{tl:127}]]);
fm.noteOn(CH1,"E3");
const plan = fm.build(b => b.atSample(0).setOperator(CH1,OP1,{multi:2}));
const current = await fm.compile(plan);
const client = await fm.compile(plan,{initialState:"client"});
const reset = await fm.compile(plan,{initialState:"reset"});
const snapshot = await fm.captureState();
const saved = JSON.stringify(snapshot);
const reused = await fm.compile(plan,{initialState:snapshot});
if (current[0].value !== 0x32 || client[0].value !== 0x32 || reset[0].value !== 2 || reused[0].value !== 0x32)
 throw Error("Incorrect baseline or packed MULT / DT resolution");
if (JSON.stringify(snapshot) !== saved || !Object.isFrozen(snapshot.registers[0])) throw Error("Snapshot changed");
await fm.schedule(plan,{name:"browser-operator",repeatSeconds:0.01});
console.log("FM_TIMED_READY");`;
const replacement = value => `const fm = await useSoundChip("ym2612");
await fm.schedule(fm.build(b=>b.setOperator(CH1,OP1,{multi:${value}})),{name:"browser-operator",repeatSeconds:0.01});
console.log("FM_APPLY_${value}");`;

async function execute(page, source, action, marker) {
  await page.locator('#synthCodeEditor').fill(source);
  await page.locator('#synthCode' + action + 'Button').click();
  await page.waitForFunction(marker => document.getElementById('synthCodeLog').textContent.includes(marker), marker);
}
async function stable(page, value, count = 4) {
  const rows = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = await page.evaluate(() => __fmTimedAudit.capture());
    rows.push({value:state.registers[0][0x30], frame:state.frame});
    if (rows.length >= count && rows.slice(-count).every(row => row.value === value) &&
        rows.at(-1).frame > rows.at(-count).frame) return rows.slice(-count);
    await page.waitForTimeout(20);
  }
  assert.fail(`Expected register 0x30=${value}, got ${JSON.stringify(rows)}`);
}
async function run(browserName, origin) {
  const browser = await {chromium, webkit}[browserName].launch({headless:true});
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  let page;
  try {
    await context.addInitScript(installSilentAudit);
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    page = await context.newPage(); const errors = [], missing = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {if (response.url().startsWith(origin) && response.status() >= 400) missing.push(response.url());});
    await page.goto(origin + config.entry);
    await page.waitForFunction(() => !document.getElementById('synthFileNewButton')?.disabled);
    assert.equal(await page.evaluate(() => __fmTimedAudit.contexts.length), 0);
    await page.locator('#keyboard .key').first().click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('Audio ready'));
    await page.locator('#synthInputCodeTab').click();
    await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    await execute(page, base, 'Run', 'FM_TIMED_READY');
    const initial = await stable(page, 0x32);
    await page.waitForFunction(() => __fmTimedAudit.level() > 0.0001);
    const soundingPeak = await page.evaluate(() => __fmTimedAudit.level());
    await execute(page, replacement(4), 'Apply', 'FM_APPLY_4');
    const applied = await stable(page, 0x34);
    await execute(page, replacement(6) + '\nthrow Error("EXPECTED_FAILED_APPLY");', 'Apply', 'FM_APPLY_6');
    await page.waitForFunction(() => document.getElementById('synthCodeError').textContent.includes('EXPECTED_FAILED_APPLY'));
    const failedApply = await stable(page, 0x34);
    // An Apply with no top-level reservation removes the old entry reservation.
    await execute(page, 'const fm=await useSoundChip("ym2612"); console.log("FM_EMPTY");', 'Apply', 'FM_EMPTY');
    await page.waitForTimeout(150);
    await page.evaluate(() => __fmTimedAudit.nodes[0].port.postMessage({type:'write',port:0,register:0x30,value:0x37}));
    const removed = await stable(page, 0x37, 8);
    await execute(page, replacement(4), 'Apply', 'FM_APPLY_4');
    await stable(page, 0x34);
    await page.locator('#synthCodeStopButton').click();
    await page.waitForFunction(() => document.getElementById('synthCodeState').textContent === 'Stopped');
    await page.waitForTimeout(150);
    await page.evaluate(() => __fmTimedAudit.nodes[0].port.postMessage({type:'write',port:0,register:0x30,value:0x39}));
    const stopped = await stable(page, 0x39, 8);
    // Run the actual editable file installed into Files, not a copied fixture.
    if (await page.locator('#synthFilesPanel').isHidden()) await page.locator('#synthFilesToggle').click();
    const folder = page.locator('#synthFilesTree summary[data-file-path="/examples"]');
    if (!await folder.evaluate(node => node.parentElement.open)) await folder.click();
    await page.locator('#synthFilesTree [data-file-path="/examples/timed-operators.js"]').click();
    await page.waitForFunction(() => document.getElementById('synthCodeEditor').value.includes('function operatorMotion(seconds)'));
    await page.locator('#synthCodeRunButton').click();
    await page.waitForFunction(() => document.getElementById('synthCodeLog').textContent.includes('Predicted register writes'));
    const motionValues = [];
    for (let i = 0; i < 12; i++) {
      motionValues.push(await page.evaluate(async () => (await __fmTimedAudit.capture()).registers[0][0x30]));
      await page.waitForTimeout(25);
    }
    assert(new Set(motionValues).size > 1, 'Shipped example moves MULT on the actual Worklet');
    assert.equal(await page.locator('#synthCodeError').textContent(), '');
    await page.locator('#synthCodeStopButton').click();
    await page.waitForFunction(() => document.getElementById('synthCodeState').textContent === 'Stopped');
    await page.waitForTimeout(150);
    const audit = await page.evaluate(() => ({contexts:__fmTimedAudit.contexts.length,
      nodes:__fmTimedAudit.nodes.length, routes:__fmTimedAudit.routes.length,
      muted:__fmTimedAudit.routes.every(route => route.mute.gain.value === 0), peak:__fmTimedAudit.level()}));
    assert(audit.routes > 0 && audit.muted); assert.deepEqual(errors, []); assert.deepEqual(missing, []);
    return {browser:browserName, passed:true, soundingPeak, audit,
      checkpoints:{initial,applied,failedApply,removed,stopped}, example:{path:'/examples/timed-operators.js',motionValues}};
  } catch (error) {
    if (page) console.error(await page.evaluate(() => ({status:document.getElementById('status')?.textContent,
      codeError:document.getElementById('synthCodeError')?.textContent, log:document.getElementById('synthCodeLog')?.textContent})));
    throw error;
  } finally {await context.close(); await browser.close();}
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`, results = [];
    for (const name of config.engines.split(',')) results.push(await run(name, origin));
    const report = {passed:true, physicalOutputMuted:true, results};
    await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
