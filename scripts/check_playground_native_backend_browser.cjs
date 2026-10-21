// Real shared Playground/settings, real Web Audio regression, mocked native IPC.
// No native audio device is opened. Native PCM is covered by Rust/C++ offline tests.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium, webkit} = require('playwright');
const rootOption = process.argv.find(value => value.startsWith('--root='));
const docs = rootOption ? path.resolve(rootOption.slice(7)) : path.resolve(__dirname, '../docs');
const entryPath = rootOption ? '/index.html' : '/playground/index.html';
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const accessor = '\nwindow.__nativeBackendTest={runtime,selectedMode,get editor(){return editorAdapter}};';
const source = `// Native/Web Audio project handoff regression.
setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
liveLoop('shared-phrase', async () => {
  for (const note of ['E3','G3','A3','B3','D4']) {
    await play(note, {channel:CH1, duration:0.8});
    await beat(cycle([0.04,0.04,0.08]));
  }
});`;
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.resolve(docs, '.' + pathname);
    if (!file.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    let body = await fs.readFile(file);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() + accessor);
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch (error) {response.writeHead(404).end(String(error));}
});

class FakeNative {
  constructor() {this.calls = []; this.sessions = 0; this.current = null; this.failStart = false;}
  status() {
    if (!this.current) throw Error('No native session');
    return {session:this.current.session,sampleRate:48000,frame:Math.floor((performance.now() - this.current.began) * 48),
      ymClock:7670454,psgClock:3579545,running:true,queued:0,lateCommands:0,queueOverflows:0,error:null};
  }
  async invoke(command, args = {}) {
    this.calls.push({command,args});
    if (command === 'native_genesis_start') {
      if (this.failStart) {this.failStart = false; throw Error('Simulated native device unavailable');}
      this.current = {session:++this.sessions,began:performance.now()};
      return this.status();
    }
    if (!command.startsWith('native_genesis_')) return null;
    if (command === 'native_genesis_shutdown') {
      if (this.current?.session === args.session) this.current = null;
      return null;
    }
    if (!this.current || this.current.session !== args.session) throw Error('Stale native audio session');
    if (command === 'native_genesis_status' || command === 'native_genesis_stop') return this.status();
    if (command === 'native_genesis_commands') {
      assert(Array.isArray(args.commands) && args.commands.length > 0 && args.commands.length <= 4096);
      assert(args.commands.every(entry => Number.isSafeInteger(entry.frame) && entry.frame >= 0));
      return this.status();
    }
    if (['native_genesis_performance','native_genesis_fx','native_genesis_media_load','native_genesis_media_remove','native_genesis_record_start'].includes(command)) return this.status();
    if (command === 'native_genesis_record_stop') return {sampleRate:48000,firstFrame:0,frames:16,complete:false,channels:[Array(16).fill(.1),Array(16).fill(-.1)]};
    throw Error('Unexpected native command: ' + command);
  }
  count(command) {return this.calls.filter(call => call.command === command).length;}
}

function observeAudioCreation() {
  window.__audioConstructions = {contexts:0,worklets:[]};
  for (const key of ['AudioContext','AudioWorkletNode']) {
    const Type = window[key];
    if (!Type) continue;
    window[key] = new Proxy(Type, {construct(Type, args, Target) {
      if (key === 'AudioContext') window.__audioConstructions.contexts++;
      else window.__audioConstructions.worklets.push(args[1]);
      return Reflect.construct(Type,args,Target);
    }});
  }
}
async function ready(page) {
  await page.waitForFunction(() => Boolean(window.__nativeBackendTest));
  await page.locator('#startupNotice').waitFor({state:'hidden'});
}
async function openSettings(page) {
  await page.locator('#mainMenu > summary').click();
  await page.click('#audioEngineButton');
  await page.locator('#audioEngineDialog').waitFor({state:'visible'});
}
async function selectEngine(page, value) {
  await openSettings(page);
  await page.selectOption('#audioEngineSelect', value);
  await Promise.all([page.waitForURL(url => url.searchParams.get('audioEngine') === (value === 'native' ? 'native' : null)), page.click('#audioEngineApply')]);
  await ready(page);
  assert.equal(await page.evaluate(() => window.__nativeBackendTest.editor.getValue()), source);
}
async function run(page) {
  await page.click('#runButton');
  await page.waitForFunction(() => window.__nativeBackendTest.runtime.getState().playback === 'running');
}
async function until(check) {
  const end = Date.now() + 10000;
  while (!check()) {if (Date.now() > end) throw Error('Native IPC expectation timed out'); await new Promise(resolve => setTimeout(resolve, 10));}
}
async function nativeRun(page, native) {
  const before = native.count('native_genesis_commands');
  await run(page);
  await until(() => native.count('native_genesis_commands') > before && native.calls.some(call => call.command === 'native_genesis_commands' && call.args.commands.some(entry => entry.type === 'write' && entry.register === 0x28 && entry.value & 0xf0)));
  assert.equal(await page.evaluate(() => window.__nativeBackendTest.runtime.megaDrive.backend), 'native-genesis');
  assert.deepEqual(await page.evaluate(() => window.__audioConstructions), {contexts:0,worklets:[]});
  assert.equal(await page.evaluate(() => window.__nativeBackendTest.runtime.capabilities.worker), true);
}
async function workerMediaRun(page,native) {
  await page.evaluate(() => window.__nativeBackendTest.runtime.stopWithFade());
  const first=native.calls.length;
  await page.evaluate(async () => {
    await window.__nativeBackendTest.runtime.playSource(`
      setBpm(120);
      fm.setPreset(CH1,FM_PRESETS['one-op-basic']);
      const gain=fx.gain({gain:0.5});fx.setChain([gain]);gain.gain.rampTo(0.8,0.1);
      await sample.load('native-test',{sampleRate:22050,channels:[new Float32Array([0,.5,0,-.5])]});
      await sample.play('native-test',{loop:true});
      await fm.dac.setSample('native-dac',new Uint8Array([128,160,128,96]),{sampleRate:8000});
      await fm.dac.playFromSample('native-dac');
      psg.tone(PSG1,{note:'C4',attenuation:8});
      liveLoop('native-worker-phrase',async()=>{await play('E3',{channel:CH1,duration:0.1});await beat(0.1);});
    `,{execution:'worker'});
  });
  const calls=()=>native.calls.slice(first), commands=()=>calls().flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
  await until(()=>commands().some(c=>c.type==='write'&&c.register===0x28&&(c.value&0xf0)&&c.performance&&c.owner));
  assert(calls().some(c=>c.command==='native_genesis_performance'&&c.args.op==='start'));
  assert(calls().some(c=>c.command==='native_genesis_fx'&&c.args.message.op==='chain'&&c.args.performance));
  assert(calls().some(c=>c.command==='native_genesis_media_load'&&c.args.kind==='sample'));
  assert(commands().some(c=>c.type==='sample-play'&&c.performance&&c.frame>0));
  assert(commands().some(c=>c.type==='dac-play'&&c.performance&&c.frame>0));
  await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource('stopLoop("native-worker-phrase");',{execution:'worker'}));
  await until(()=>calls().some(c=>c.command==='native_genesis_performance'&&c.args.op==='cancel-owner'));
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await until(()=>calls().some(c=>c.command==='native_genesis_performance'&&c.args.op==='stop'));
  // Reuse the existing Worker/ports after Stop with a fresh performance session.
  await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource('await play("G3",{channel:CH1,duration:0});',{execution:'worker'}));
  assert.equal(calls().filter(c=>c.command==='native_genesis_performance'&&c.args.op==='start').length,2);
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  assert.deepEqual(await page.evaluate(()=>window.__audioConstructions),{contexts:0,worklets:[]});
}
async function nativeRecording(page,native) {
  await page.locator('#mainMenu > summary').click();
  await page.click('#audioDiagnosticsButton');
  const panel=page.locator('.audio-diagnostics');await panel.waitFor({state:'visible'});
  const before=native.count('native_genesis_record_start');
  await panel.getByRole('button',{name:'Record 30 s',exact:true}).click();
  await until(()=>native.count('native_genesis_record_start')>before);
  await panel.getByRole('button',{name:'Mark noise',exact:true}).click();
  await panel.getByRole('button',{name:'Stop recording',exact:true}).click();
  await panel.getByRole('button',{name:'Save output WAV',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.audio-diagnostics button')).find(b=>b.textContent==='Save output WAV').disabled);
  assert(await panel.getByRole('button',{name:'Save chip WAV',exact:true}).isDisabled());
  const saving=page.waitForEvent('download');await panel.getByRole('button',{name:'Save output WAV',exact:true}).click();
  const downloaded=await saving,bytes=await fs.readFile(await downloaded.path());
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.readUInt16LE(20),3);assert.equal(bytes.readUInt32LE(40),16*8);
  await panel.getByRole('button',{name:'Close diagnostics',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.__audioConstructions),{contexts:0,worklets:[]});
}
async function keyboard(page, native) {
  await page.click('#keyboardTab');
  for (const [chip, channel] of [['ym2612','fm:0'], ['segapsg','0']]) {
    await page.selectOption('#playgroundKeyboardChip', 'chip:' + chip);
    await page.selectOption('#playgroundKeyboardTargetChannel', channel);
    await page.locator('#keyboardTab').focus();
    const first = native.calls.length;
    const commands = () => native.calls.slice(first).flatMap(call => call.command === 'native_genesis_commands' ? call.args.commands : []);
    await page.keyboard.down('z');
    await until(() => commands().some(entry => chip === 'ym2612'
      ? entry.type === 'write' && entry.register === 0x28 && Boolean(entry.value & 0xf0)
      : entry.type === 'psg-write' && (entry.value & 0xf0) === 0x90 && (entry.value & 15) !== 15));
    await page.keyboard.up('z');
    await until(() => commands().some(entry => chip === 'ym2612'
      ? entry.type === 'write' && entry.register === 0x28 && !(entry.value & 0xf0)
      : entry.type === 'psg-write' && entry.value === 0x9f));
  }
}

async function checkBrowser(name, type, url, artifacts) {
  const browser = await type.launch({headless:true,...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const plain = await browser.newContext({serviceWorkers:'block'});
    const normal = await plain.newPage();
    // Exercise the real textarea fallback; external Monaco CDN availability is
    // unrelated to native transport/settings and is not required by this check.
    await normal.route('**/vs/loader*.js', route => route.abort());
    await normal.goto(url);
    await ready(normal);
    assert.equal(await normal.locator('#audioEngineButton').count(), 0);
    await plain.close();
    const context = await browser.newContext({serviceWorkers:'block'}), page = await context.newPage();
    const native = new FakeNative(), errors = [];
    await page.exposeBinding('__nativeInvoke', (_event, command, args) => native.invoke(command, args));
    await page.addInitScript(observeAudioCreation);
    await page.addInitScript(() => {window.__TAURI_INTERNALS__ = {invoke:(command,args) => window.__nativeInvoke(command,args)};});
    await page.route('**/vs/loader*.js', route => route.abort());
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(20000);
    await page.goto(url); await ready(page);
    assert.equal(native.count('native_genesis_start'), 0);
    await openSettings(page);
    assert.equal(await page.locator('#audioEngineSelect').inputValue(), 'webaudio');
    await page.locator('#audioEngineDialog').evaluate(dialog => dialog.close());
    await page.evaluate(source => {window.__nativeBackendTest.editor.setValue(source); document.getElementById('workerExecution').checked = false;}, source);
    await run(page);
    assert(await page.evaluate(() => window.__audioConstructions.contexts > 0 && window.__audioConstructions.worklets.includes('ym2612-processor')));
    assert.equal(native.count('native_genesis_start'), 0);
    await selectEngine(page, 'native');
    assert.equal(native.count('native_genesis_start'), 0, 'Selection alone must not open a device');
    await nativeRun(page, native);
    const firstSession = native.current.session;
    await page.click('#stopButton');
    await until(() => native.count('native_genesis_stop') > 0);
    await page.waitForFunction(() => window.__nativeBackendTest.runtime.getState().playback === 'stopped');
    await keyboard(page, native);
    await workerMediaRun(page,native);
    await nativeRun(page, native);
    await nativeRecording(page,native);
    assert.equal(native.current.session, firstSession, 'Stop/Run should reuse the stream clock');
    await openSettings(page);
    await page.screenshot({path:path.join(artifacts, name + '-native-settings.png')});
    await page.locator('#audioEngineDialog').evaluate(dialog => dialog.close());
    await selectEngine(page, 'webaudio');
    assert(native.count('native_genesis_shutdown') > 0);
    assert.equal(native.current, null);
    // Native failure remains visible and selected, with no silent Web Audio fallback.
    native.failStart = true;
    await selectEngine(page, 'native');
    await page.click('#runButton');
    await page.waitForFunction(() => document.body.textContent.includes('Simulated native device unavailable'));
    assert.equal(await page.evaluate(() => new URL(location.href).searchParams.get('audioEngine')), 'native');
    assert.deepEqual(await page.evaluate(() => window.__audioConstructions), {contexts:0,worklets:[]});
    await selectEngine(page, 'webaudio'); await run(page);
    assert(await page.evaluate(() => window.__audioConstructions.contexts > 0));
    // Switching machine mode closes native ownership and uses Web Audio explicitly.
    await selectEngine(page, 'native'); await nativeRun(page, native);
    const shutdowns = native.count('native_genesis_shutdown');
    await page.locator('#mainMenu > summary').click();
    await page.selectOption('#playgroundMode', 'gameboy');
    await page.locator('#changeModeDialog').waitFor({state:'visible'});
    await Promise.all([page.waitForURL(url => url.searchParams.get('mode') === 'gameboy'), page.locator('#changeModeDialog').evaluate(dialog => dialog.close('keep'))]);
    await ready(page);
    assert(native.count('native_genesis_shutdown') > shutdowns);
    assert.equal(native.current, null);
    assert.notEqual(await page.evaluate(() => window.__nativeBackendTest.runtime.megaDrive.backend), 'native-genesis');
    await openSettings(page);
    assert.equal(await page.locator('#audioEngineSelect option[value="native"]').isDisabled(), true);
    assert.equal(await page.locator('#audioEngineSelect').inputValue(), 'webaudio');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(artifacts, name + '-native-settings.json'), JSON.stringify({mockedNative:true, calls:native.calls}, null, 2));
    await context.close();
    console.log(`${name}: PASS Web Audio default, project handoff, Native Main/Worker, DAC/sample/FX, loop cancellation, recording, Stop/Run, failure/recovery, mode cleanup; no native AudioContext/Worklet (native IPC mocked)`);
  } finally {await browser.close();}
}

(async () => {
  const option = process.argv.find(value => value.startsWith('--out='));
  const artifacts = option ? path.resolve(option.slice(6)) : await fs.mkdtemp(path.join(os.tmpdir(), 'playground-native-backend-'));
  await fs.mkdir(artifacts, {recursive:true});
  await new Promise((resolve,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',resolve);});
  try {
    const url = `http://127.0.0.1:${server.address().port}${entryPath}?mode=genesis`;
    for (const [name,type] of [['chromium',chromium],['webkit',webkit]]) {
      if (!process.argv.includes('--chromium') && !process.argv.includes('--webkit') || process.argv.includes('--' + name)) await checkBrowser(name,type,url,artifacts);
    }
    console.log('Artifacts: ' + artifacts);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
