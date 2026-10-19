// Full Playground UI + native AudioWorklets. The response only exposes existing controls.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');
const docs = path.resolve(__dirname, '../docs');
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const accessor = '\nwindow.__nativeVoice={runtime,megaDrive,chipTabs,operatorKeyboard,setSource:v=>editorAdapter.setValue(v)};';
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let filename = path.resolve(docs, '.' + pathname);
    if (!filename.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
    let body = await fs.readFile(filename);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() + accessor);
    response.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream'); response.end(body);
  } catch (error) {response.writeHead(404).end(error.message);}
});
const definitions = {
  gameboy: {root:'#gameboyPanel',tab:'#gameboyTab',channel:n=>`[data-chip-channel="${n}"]`, control:n=>`[data-chip-control="gb-${n}"]`, hold:'[data-chip-action="gb-hold"]', keyboard:'[data-chip-action="gb-keyboard"]', frequency:'frequency', volume:'volume', waveChannel:2, waveAction:'[data-chip-action="gb-wave-triangle"]', noiseChannel:3, waveCanvas:'[data-chip-control="gb-waveform"]'},
  nes: {root:'#nesPanel',tab:'#nesTab',channel:n=>`[data-nes-channel="${n}"]`,control:n=>`[data-nes-control="${n}"]`,hold:'[data-nes-action="audition"]',keyboard:'[data-nes-action="keyboard"]',frequency:'pulse-0-frequency',volume:'pulse-0-volume',waveChannel:5,waveAction:'[data-nes-action="wave-sine"]',noiseChannel:3,waveCanvas:'canvas'},
};
const scoped = (d, selector) => `${d.root} ${selector}`;
async function field(page, selector, value) {
  await page.locator(selector).evaluate((node, value) => {node.value = String(value); node.dispatchEvent(new Event(node.type === 'range' ? 'input' : 'change', {bubbles:true}));}, value);
}
async function read(page, kind) {return page.evaluate(kind => window.__nativeVoice.runtime.chipInspector.read(kind), kind);}
async function untilState(page, kind, source, label) {
  await page.waitForFunction(async ({kind, source}) => {
    const state = await window.__nativeVoice.runtime.chipInspector.read(kind); return new Function('state', `return (${source})`)(state);
  }, {kind, source}, {timeout:10000}).catch(error => {throw new Error(`${label}: ${error.message}`);});
}
async function installMeter(page) {
  await page.evaluate(() => {
    const {megaDrive} = window.__nativeVoice, context = megaDrive.audioContext;
    const splitter = context.createChannelSplitter(2), silent = context.createGain(); silent.gain.value = 0; silent.connect(context.destination);
    const meters = [context.createAnalyser(), context.createAnalyser()];
    meters.forEach((meter, channel) => {meter.fftSize = 4096; splitter.connect(meter, channel); meter.connect(silent);});
    megaDrive.audio.connectOutputMonitor(splitter); window.__nativeVoice.meters = meters;
    window.__nativeVoice.measure = () => meters.map(meter => {
      const values = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(values);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      return {rms:Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length),peak:Math.max(...values.map(Math.abs)),finite:values.every(Number.isFinite)};
    });
  });
}
async function audible(page, label) {
  await page.waitForFunction(() => window.__nativeVoice.measure().some(meter => meter.rms > .0002), null, {timeout:5000}).catch(error => {throw new Error(label + ': inaudible. ' + error.message);});
  const meters = await page.evaluate(() => window.__nativeVoice.measure()); assert(meters.every(m => m.finite && m.peak < 1), label + ': nonfinite/clipped PCM'); return meters;
}
async function silent(page, label) {
  await page.waitForTimeout(180);
  await page.waitForFunction(() => window.__nativeVoice.measure().every(meter => meter.rms < .00003), null, {timeout:5000}).catch(error => {throw new Error(label + ': output stayed audible. ' + error.message);});
}
async function holdStart(page, d) {
  const node = page.locator(scoped(d, d.hold)); await node.scrollIntoViewIfNeeded(); const rect = await node.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
}
async function releaseOutside(page) {await page.mouse.move(5, 5); await page.mouse.up();}
async function keyboardKey(page, type, key) {
  if (!key) key = await page.locator('#operatorKeyboardRoot .key').first().getAttribute('data-key');
  await page.evaluate(({type,key}) => document.body.dispatchEvent(new KeyboardEvent(type, {key,code:`Key${key.toUpperCase()}`,bubbles:true,cancelable:true})), {type,key}); return key;
}
async function stop(page, kind) {
  const fdsBefore = kind === 'nes' ? (await read(page, kind)).fds : null;
  await page.click('#stopButton'); await page.waitForFunction(() => window.__nativeVoice.runtime.getState().playback === 'stopped');
  if (fdsBefore) {
    const fdsAfter = (await read(page, kind)).fds;
    assert.equal(fdsAfter.period, fdsBefore.period, 'Stop preserves the FDS timer configured through the panel');
    assert.equal(fdsAfter.frequency, fdsBefore.frequency, 'Stop preserves the FDS pitch');
    assert.deepEqual(fdsAfter.wave, fdsBefore.wave, 'Stop preserves FDS Wave RAM');
  }
}
const loopSource = kind => kind === 'gameboy' ? `
gameboy.pulse.setVoice(0,{duty:.5,volume:8,envelope:{direction:'down',period:0}});
liveLoop('voice-panel-background',async()=>{
  gameboy.pulse.noteOn(0,'C4'); await sleep(.08); gameboy.pulse.keyOff(0); await sleep(.02);
});` : `
nes.pulse.setVoice(0,{duty:.5,volume:8});
liveLoop('voice-panel-background',async()=>{
  nes.pulse.noteOn(0,'C4'); await sleep(.08); nes.pulse.keyOff(0); await sleep(.02);
});`;
async function check(page, url, browserName, kind, worker) {
  const d = definitions[kind], errors = [], results = {browser:browserName,kind,worker};
  page.on('pageerror', error => errors.push(error.message));
  console.log(JSON.stringify({...results, stage:'start'}));
  await page.goto(`${url}?mode=${kind}`); await page.waitForFunction(() => window.__nativeVoice && window.monaco?.editor?.getEditors().length);
  await page.click(d.tab);
  assert.equal(await page.evaluate(() => window.__nativeVoice.megaDrive.audioContext), null, 'opening a tab did not open audio');
  assert.deepEqual(await page.evaluate(() => window.__nativeVoice.runtime.chipInspector.list()), [], 'opening a tab did not create a chip');
  await page.click(scoped(d, '[data-chip-action="prepare"]'));
  await page.locator(scoped(d, d.control(d.frequency))).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__nativeVoice.runtime.chipInspector.list().map(entry=>entry.kind)), [kind], 'Prepare uses one primary chip');
  assert.equal(await page.evaluate(() => window.__nativeVoice.runtime.getState().playback), 'stopped', 'Prepare did not execute the program');
  await installMeter(page);
  await field(page, scoped(d, d.control(d.frequency)), 440);
  await untilState(page, kind, 'Math.abs(state.channels[0].frequency-440)<3', 'frequency edit reaches primary chip');
  const focused = page.locator(scoped(d, d.control(d.frequency))); await focused.focus(); await focused.fill('345.678'); await page.waitForTimeout(420);
  assert.equal(await focused.inputValue(), '345.678', 'polling preserves focused edits'); await field(page, scoped(d, d.control(d.frequency)), 440); await page.locator(d.tab).focus();
  await field(page, scoped(d, d.control(d.volume)), 9);
  await untilState(page, kind, 'state.channels[0].volume===9', 'voice edit readback');
  if (kind === 'nes') await field(page, scoped(d, d.control('audition-midi')), 69);
  await holdStart(page, d); results.pulse = await audible(page, 'pulse Hold');
  await untilState(page, kind, 'state.channels[0].active', 'Hold gate is active'); await releaseOutside(page); await silent(page, 'release outside Hold');
  await untilState(page, kind, '!state.channels[0].active', 'Hold gate is released');

  // Edit and audition the native waveform, without an extra synth or fallback audio.
  await page.click(scoped(d, d.channel(d.waveChannel))); await page.click(scoped(d, d.waveAction));
  await untilState(page, kind, kind === 'gameboy' ? 'state.channels[2].waveform.length===32 && Math.max(...state.channels[2].waveform)>0' : 'state.fds.wave.length===64 && Math.max(...state.fds.wave)>0', 'native wave shape readback');
  if (kind === 'gameboy') await field(page, scoped(d, d.control('wave-level')), 1);
  const canvas = page.locator(scoped(d, d.waveCanvas)); await canvas.scrollIntoViewIfNeeded(); const rect = await canvas.boundingBox();
  await page.mouse.move(rect.x + 2, rect.y + rect.height - .5); await page.mouse.down(); await page.mouse.move(rect.x + rect.width - 3, rect.y + .5, {steps:12}); await page.mouse.up();
  await untilState(page, kind, kind === 'gameboy' ? 'state.channels[2].waveform[0]===0 && state.channels[2].waveform[31]===15' : 'state.fds.wave[0]===0 && state.fds.wave[63]===63', 'drawn wave committed to RAM');
  await holdStart(page, d); results.wave = await audible(page, 'native wave Hold'); await releaseOutside(page); await silent(page, 'wave release');
  await page.click(scoped(d, d.channel(d.noiseChannel)));
  if (kind === 'gameboy') {await field(page, scoped(d,d.control('volume')), 9); await field(page, scoped(d,d.control('noise-divisor')), 3); await field(page, scoped(d,d.control('noise-shift')), 2);}
  else {await field(page, scoped(d,d.control('noise-volume')), 9); await field(page, scoped(d,d.control('noise-period')), 5);}
  await holdStart(page, d); results.noise = await audible(page, 'noise Hold'); await releaseOutside(page); await silent(page, 'noise release');

  // Read-only polling is suspended both outside the tab and in a hidden document.
  await page.evaluate(() => {
    const api = window.__nativeVoice.runtime.chipInspector, original = api.read.bind(api); window.__nativeVoice.reads = 0;
    api.read = (...args) => {window.__nativeVoice.reads++; return original(...args);};
    window.__nativeVoice.hidden = false; Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__nativeVoice.hidden});
    window.__nativeVoice.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenReads = await page.evaluate(() => window.__nativeVoice.reads); await page.waitForTimeout(650); assert.equal(await page.evaluate(() => window.__nativeVoice.reads), hiddenReads, 'hidden documents do not poll');
  await page.evaluate(() => {window.__nativeVoice.hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
  await page.click('#codeTab'); await page.waitForTimeout(60); const hiddenTabReads = await page.evaluate(() => window.__nativeVoice.reads); await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => window.__nativeVoice.reads), hiddenTabReads, 'hidden chip panels do not poll');

  await page.click(d.tab); await page.click(scoped(d, d.channel(0))); await page.click(scoped(d, d.keyboard));
  await page.locator('#keyboardPanel').waitFor({state:'visible'});
  let key = await keyboardKey(page,'keydown'); results.keyboard = await audible(page,'Guitar computer key'); await keyboardKey(page,'keyup',key); await silent(page,'Guitar keyup');
  key = await keyboardKey(page,'keydown'); await audible(page,'Guitar before Code focus'); await page.click('#codeTab'); await page.locator('#editorHost textarea').first().focus(); await keyboardKey(page,'keyup',key); await silent(page,'Code focus releases Guitar');
  await page.click('#keyboardTab'); key = await keyboardKey(page,'keydown'); await audible(page,'Guitar before blur'); await page.evaluate(()=>window.dispatchEvent(new Event('blur'))); await silent(page,'window blur releases Guitar'); await keyboardKey(page,'keyup',key);
  await page.click(d.tab); await page.click(scoped(d,d.keyboard)); key = await keyboardKey(page,'keydown'); await audible(page,'Guitar before Stop'); await stop(page,kind); await silent(page,'Stop silences Guitar'); await keyboardKey(page,'keyup',key);

  await page.evaluate(({source,worker})=>{window.__nativeVoice.setSource(source);document.getElementById('workerExecution').checked=worker;},{source:loopSource(kind),worker});
  await page.click('#runButton'); await page.waitForFunction(()=>window.__nativeVoice.runtime.getState().playback==='running');
  await page.click(d.tab); await page.locator(scoped(d,d.hold)).waitFor();
  if (kind === 'nes') await field(page, scoped(d,d.control('audition-midi')), 69);
  await holdStart(page,d); await untilState(page,kind,'Math.abs(state.channels[0].frequency-440)<3 && state.channels[0].active','audition retunes code channel');
  for (let i=0;i<4;i++) {await page.waitForTimeout(220);const held=await read(page,kind);assert(Math.abs(held.channels[0].frequency-440)<3 && held.channels[0].active,'queued code did not steal held audition');}
  await audible(page,'audition over background program');
  await field(page,scoped(d,d.control(d.volume)),6); await untilState(page,kind,'state.channels[0].volume===6','voice remains editable while auditioning');
  await releaseOutside(page); await untilState(page,kind,'Math.abs(state.channels[0].frequency-261.6256)<3 && state.channels[0].active','code resumes on its next note');
  await stop(page,kind); await silent(page,'Stop after background audition');
  assert.deepEqual(await page.evaluate(()=>window.__nativeVoice.runtime.chipInspector.list().map(entry=>entry.kind)),[kind], 'audition added no sound devices');
  assert.deepEqual(errors,[],'browser page errors');
  if (process.argv.includes('--screenshots')) {
    await page.click(d.tab); await page.click(scoped(d,d.channel(d.waveChannel))); await page.click(scoped(d,d.keyboard));
    await page.locator('#keyboardPanel').waitFor({state:'visible'}); await page.waitForTimeout(180);
    results.screenshot = `/private/tmp/native-voice-${browserName}-${kind}-${worker?'worker':'main'}-success.png`;
    await page.screenshot({path:results.screenshot});
  }
  console.log(JSON.stringify({...results,stage:'passed'}));
}
(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    const url=`http://127.0.0.1:${server.address().port}/playground/index.html`;
    const engines=process.argv.includes('--chromium')?[['chromium',chromium]]:process.argv.includes('--webkit')?[['webkit',webkit]]:[['chromium',chromium],['webkit',webkit]];
    const kinds=process.argv.includes('--gameboy')?['gameboy']:process.argv.includes('--nes')?['nes']:['gameboy','nes'];
    const workers=process.argv.includes('--main')?[false]:process.argv.includes('--worker')?[true]:[false,true];
    for (const [name,type] of engines) {
      const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
      try {for(const kind of kinds) for(const worker of workers) {const page=await browser.newPage({viewport:{width:1380,height:1000},serviceWorkers:'block'});page.setDefaultTimeout(20000);try{await check(page,url,name,kind,worker);}catch(error){console.error(JSON.stringify({diagnostic:await page.evaluate(()=>({runtime:document.getElementById('runtimeState')?.textContent,status:document.getElementById('status')?.textContent,console:document.getElementById('consoleOutput')?.textContent,panels:[...document.querySelectorAll('.chip-editor-panel')].map(n=>({id:n.id,hidden:n.hidden,text:n.textContent})),inspector:window.__nativeVoice?.runtime.chipInspector.list()})).catch(()=>null)}));await page.screenshot({path:`/private/tmp/native-voice-${name}-${kind}-${worker?'worker':'main'}.png`}).catch(()=>{});throw error;}finally{await page.close();}}}
      finally{await browser.close();}
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
