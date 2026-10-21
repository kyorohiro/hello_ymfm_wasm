// Full Playground chip editors, shared floating Keyboard, actual WASM/PCM.
// The HTTP test response exposes lexical controls; no product source is replaced.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const docs = path.resolve(__dirname, '../docs');
const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml'};
const accessor = '\nwindow.__operatorKeyboardCheck={runtime,megaDrive,operatorKeyboard,operatorTab,keyboardRouting,chipTabs,setBottomTab,setSource:value=>editorAdapter.setValue(value)};';
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/favicon.ico') {response.writeHead(204).end(); return;}
    let file = path.resolve(docs, '.' + pathname);
    if (!file.startsWith(docs + path.sep)) throw Error('Outside docs');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    let body = await fs.readFile(file);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() + accessor);
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    response.end(body);
  } catch (error) {response.writeHead(404).end(error.message);}
});

const fm = 'for(const ch of [CH1,CH2])fm.setPreset(ch,FM_PRESETS.sine);';
const pcm = `const pcm=await useSoundChip('rf5c164'),wave=new Uint8Array(129);
for(let i=0;i<128;i++){const value=Math.sin(i*Math.PI/64);wave[i]=Math.round(Math.abs(value)*100)|(value>=0?128:0);}wave[128]=255;
await pcm.loadMemory(wave);for(const ch of [0,1])await pcm.setChannel(ch,{start:0,loopStart:0,step:2048,volume:80,pan:{left:15,right:15}});`;
const cases = [
  {id:'gameboy', mode:'gameboy', chip:'gameboy', source:`for(const ch of [0,1])gameboy.pulse.setVoice(ch,{duty:.5,volume:9,envelope:{direction:'down',period:0}});`},
  {id:'nes', mode:'nes', chip:'nes', channelAttribute:'data-nes-channel', source:`for(const ch of [0,1])nes.pulse.setVoice(ch,{duty:.5,volume:8});`},
  {id:'pc-engine', mode:'pc-engine', chip:'huc6280', source:`pce.setMasterVolume(15,15);for(const ch of [0,1]){pce.setWaveform(ch,Array.from({length:32},(_,i)=>Math.round(15.5+15.5*Math.sin(i*Math.PI/16))));pce.setVolume(ch,24);pce.setPan(ch,15,15);}`},
  {id:'dx7', mode:'dx7', chip:'dx7', singleChannel:true, source:`await dx7.setPreset({name:'KBD CHECK',algorithm:31,feedback:0,operators:{1:{coarse:1,outputLevel:85,envelope:{rates:[99,99,99,99],levels:[99,99,99,0]}}}});await mixer.set(dx7.id,{volume:.5});`},
  {id:'ym2151', mode:'x68000', chip:'ym2151', source:`for(const ch of [0,1]){opm.setAlgo(ch,7);opm.setPan(ch,true,true);for(let op=0;op<4;op++)opm.setOperator(ch,op,{mul:1,tl:op===3?32:127,ar:31,d1r:0,d2r:0,d1l:0,rr:15});}`},
  {id:'opl', mode:'ym3812', chip:'ym3812', source:`opl.setRhythm({enabled:false});for(const ch of [0,1])opl.setPreset(ch,OPL_PRESETS.sine);`},
  {id:'opll', mode:'msx', chip:'ym2413', source:`opll.setUserPatch(OPLL_USER_PRESETS.sine);for(const ch of [0,1])opll.setVoice(ch,{instrument:0,attenuation:4,sustain:false});`},
  {id:'ay8910', mode:'msx', chip:'ay8910', source:`for(const ch of [0,1]){ay.setVoice(ch,{tone:true,noise:false,volume:9,envelope:false});ay.keyOff(ch);}`},
  {id:'segapsg', mode:'game-gear', chip:'segapsg', channelAttribute:'data-chip-keyboard-channel', source:`for(const ch of [0,1]){psg.tone(ch,{frequency:440,attenuation:9});psg.off(ch);}`},
  {id:'rf5c164', mode:'mega-cd', chip:'rf5c164', source:fm + pcm},
  {id:'opn', mode:'genesis', chip:'ym2612', opn:true, source:fm},
];

const panel = test => test.opn ? '#operatorPanel' : `#${test.chip}Panel`;
const tab = test => test.opn ? '#operatorTabButton' : `#${test.chip}Tab`;
const routeState = page => page.evaluate(() => window.__operatorKeyboardCheck.keyboardRouting.getState());
const snapshot = (page, chip) => page.evaluate(chip => window.__operatorKeyboardCheck.runtime.chipInspector.read(chip), chip);
const routeId = (test, channel) => test.opn ? `fm:${channel}` : String(channel);
let sequence = 0;

async function until(page, read, predicate, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await page.waitForTimeout(30);
  }
  throw Error(`${label}: ${JSON.stringify(await read())}`);
}

async function installDiagnostics(page) {
  await page.evaluate(() => {
    const test = window.__operatorKeyboardCheck;
    if (test.measure) return;
    const api = test.runtime.chipInspector, invoke = api.invoke.bind(api);
    test.commands = []; test.commandErrors = [];
    test.opnHeld = new Set(); test.opnOnCount = 0;
    const audition = test.runtime.getAuditionSynth(), on = audition.noteOn.bind(audition), off = audition.noteOff.bind(audition);
    audition.noteOn = (ch, ...args) => {on(ch, ...args); test.opnHeld.add(ch); test.opnOnCount++;};
    audition.noteOff = ch => {off(ch); test.opnHeld.delete(ch);};
    api.invoke = (id, method, args = []) => {
      test.commands.push({id, method, args:structuredClone(args)});
      return invoke(id, method, args).catch(error => {
        if (error.name !== 'AbortError') test.commandErrors.push({id, method, error:error.message});
        throw error;
      });
    };
    const context = test.megaDrive.audioContext;
    const split = context.createChannelSplitter(2), mute = context.createGain();
    mute.gain.value = 0; mute.connect(context.destination);
    const meters = [context.createAnalyser(), context.createAnalyser()];
    meters.forEach((meter, index) => {meter.fftSize = 8192; split.connect(meter, index); meter.connect(mute);});
    test.megaDrive.audio.connectOutputMonitor(split);
    test.measure = () => meters.map(meter => {
      const samples = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(samples);
      const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      return {rms:Math.sqrt(samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length),
        peak:Math.max(...samples.map(Math.abs)), finite:samples.every(Number.isFinite)};
    });
  });
}

async function audible(page, label) {
  await page.waitForFunction(() => window.__operatorKeyboardCheck.measure().some(value => value.rms > .00015), null, {timeout:8000})
    .catch(error => {throw Error(`${label}: no chip PCM (${error.message})`);});
  const pcm = await page.evaluate(() => window.__operatorKeyboardCheck.measure());
  assert(pcm.every(value => value.finite && value.peak < .99), `${label}: finite, unclipped output`);
  return pcm;
}

async function silent(page, label) {
  await page.waitForTimeout(220);
  await page.waitForFunction(() => window.__operatorKeyboardCheck.measure().every(value => value.rms < .00004), null, {timeout:8000})
    .catch(error => {throw Error(`${label}: voice remained audible (${error.message})`);});
}

async function key(page, type, value = 'a') {
  // Neutral body focus uses the real global handler without typing into Monaco.
  await page.evaluate(({type, value}) => document.body.dispatchEvent(new KeyboardEvent(type, {
    key:value, code:`Key${value.toUpperCase()}`, bubbles:true, cancelable:true,
  })), {type, value});
}

async function channel(page, test, value) {
  if (test.opn) await page.selectOption('#operatorTabChannelSelect', String(value));
  else await page.click(`${panel(test)} [${test.channelAttribute || 'data-chip-channel'}="${value}"]`);
}

async function active(page, test, ch, expected) {
  if (test.opn) return until(page, () => page.evaluate(async ch => {
    const test = window.__operatorKeyboardCheck, state = await test.runtime.chipInspector.read('ym2612');
    return test.opnHeld.has(ch) || state.held.includes(`fm:${ch}`);
  }, ch), value => value === expected, `OPN CH${ch + 1} keyboard ownership`);
  return until(page, () => snapshot(page, test.chip), state => {
    const value = test.chip === 'dx7' ? state.activeNotes.some(note => note.manual)
      : Boolean(state.channels[ch].active);
    return value === expected;
  }, `${test.chip} CH${ch + 1} ${expected ? 'key-on' : 'release'}`);
}

async function lastOn(page, test, expectedChannel) {
  if (test.opn) return;
  const command = await until(page,
    () => page.evaluate(() => window.__operatorKeyboardCheck.commands.findLast(value => value.method === 'auditionOn')),
    value => value?.id === test.chip && value.args[0] === expectedChannel,
    'selected editor channel owns the PC key');
  assert(Number.isInteger(command.args[1]) && command.args[1] >= 0 && command.args[1] <= 127);
}

async function assertOverlay(page, test) {
  assert(await page.locator(panel(test)).isVisible(), 'the chip editor remains the primary view');
  assert(await page.locator('#keyboardPanel.is-floating-keyboard').isVisible(), 'audition controls float over the editor');
  const geometry = await page.locator('#keyboardPanel').evaluate(node => {
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    return {position:style.position, right:innerWidth - rect.right, bottom:innerHeight - rect.bottom, width:rect.width};
  });
  assert.equal(geometry.position, 'fixed', 'audition controls use a fixed overlay');
  assert(geometry.right >= 0 && geometry.right <= 40 && geometry.bottom >= 0 && geometry.bottom <= 100,
    `audition controls remain in the bottom-right corner: ${JSON.stringify(geometry)}`);
  if (!test.opn) assert(await page.locator('#playgroundKeyboardEditorTarget').isVisible(), 'compact controls identify the editor target');
}

async function configure(page, test, worker) {
  const marker = `OPERATOR_KEYBOARD_READY_${++sequence}`;
  await page.evaluate(({source, worker, marker}) => {
    window.__operatorKeyboardCheck.setSource(source + `\nliveLoop('keyboard-check-keep',async()=>{await sleep(1);});\nconsole.log(${JSON.stringify(marker)});`);
    document.getElementById('workerExecution').checked = worker;
  }, {source:test.source, worker, marker});
  await page.click('#runButton');
  await page.waitForFunction(marker => document.getElementById('consoleOutput').textContent.includes(marker), marker);
  const ahead = worker ? await page.evaluate(() => window.__operatorKeyboardCheck.runtime.getTiming().workerLookaheadSeconds * 1000) : 0;
  await page.waitForTimeout(ahead + 120);
  await installDiagnostics(page);
  await silent(page, 'voice setup is silent');
}

async function check(page, url, test, browser, worker) {
  const errors = [], failed = [], result = {case:test.id, mode:test.mode, browser, worker};
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {if (response.status() >= 400) failed.push({url:response.url(), status:response.status()});});
  console.log(JSON.stringify({...result, stage:'start'}));
  await page.goto(`${url}?mode=${test.mode}&no-sw=1`);
  await page.waitForFunction(() => window.__operatorKeyboardCheck && window.monaco?.editor?.getEditors().length);
  await page.locator('#startupNotice').waitFor({state:'hidden'});
  await page.click(tab(test));
  await assertOverlay(page, test);
  assert.equal(await page.evaluate(() => window.__operatorKeyboardCheck.megaDrive.audioContext), null, 'opening an editor does not create audio');
  assert.deepEqual(await page.evaluate(() => window.__operatorKeyboardCheck.runtime.chipInspector.list()), [], 'opening an editor does not create chips');
  if (test.id === 'gameboy') {
    // The mode's authored default voice is playable before the first Run. Use
    // a physical browser key so WebKit receives a real user activation.
    await page.locator(tab(test)).focus(); await page.keyboard.down('a');
    await page.waitForFunction(() => window.__operatorKeyboardCheck.megaDrive.audioContext);
    await page.waitForFunction(chip => window.__operatorKeyboardCheck.runtime.chipInspector.list().some(value => value.id === chip), test.chip);
    await installDiagnostics(page);
    await active(page, test, 0, true);
    result.beforeRun = await audible(page, 'first editor key prepares audio without Run');
    assert.equal(await page.evaluate(() => window.__operatorKeyboardCheck.runtime.getState().playback), 'stopped');
    await page.keyboard.up('a'); await active(page, test, 0, false); await silent(page, 'first editor key release');
  }
  await configure(page, test, worker);

  // A saved bottom Keyboard selection must survive automatic on-editor routing.
  await page.click('#keyboardTab');
  await page.selectOption('#playgroundKeyboardChip', `chip:${test.chip}`);
  const manualChannel = test.singleChannel ? 0 : 1;
  await page.selectOption('#playgroundKeyboardTargetChannel', routeId(test, manualChannel));
  const savedRoute = await routeState(page);
  await page.click('#consoleTab'); // Keep the full Keyboard out of the dock.
  await page.click(tab(test));
  if (!test.singleChannel) await channel(page, test, 0);
  await assertOverlay(page, test);
  const afterEditor = await routeState(page);
  assert.equal(afterEditor.chipId, savedRoute.chipId, 'editor audition preserves bottom Keyboard chip');
  assert.equal(afterEditor.channelId, savedRoute.channelId, 'editor audition preserves bottom Keyboard channel');
  const useKeyboard = page.locator(`${panel(test)} [data-chip-action$="-keyboard"]`);
  if (await useKeyboard.count()) assert.notEqual(await useKeyboard.getAttribute('aria-pressed'), 'true', 'editor audition requires no Use Keyboard opt-in');

  await key(page, 'keydown');
  await active(page, test, 0, true); await lastOn(page, test, 0);
  result.first = await audible(page, 'PC key from the chip editor');
  if (!test.singleChannel) {
    // OPN retains its existing channel-selection behavior: release the old
    // physical key before selecting another channel. New editors release on
    // selection, so their change below deliberately happens while held.
    if (test.opn) {await key(page, 'keyup'); await active(page, test, 0, false); await silent(page, 'OPN keyup');}
    await channel(page, test, 1);
    await active(page, test, 0, false); await silent(page, 'changing editor channel releases the held voice');
    await key(page, 'keyup'); // Late physical release of the previous channel.
    await key(page, 'keydown', 's');
    await active(page, test, 1, true); await lastOn(page, test, 1);
    result.next = await audible(page, 'PC key follows the selected editor channel');
    await key(page, 'keyup', 'a');
    await active(page, test, 1, true); await audible(page, 'stale keyup preserves replacement channel');
    await key(page, 'keyup', 's'); await active(page, test, 1, false);
  } else {
    await key(page, 'keyup'); await active(page, test, 0, false);
  }
  await silent(page, 'editor keyup');

  // A different primary view releases the editor voice and disables its keys.
  await key(page, 'keydown'); await audible(page, 'key before leaving editor');
  await page.click('#codeTab'); await silent(page, 'leaving editor releases held keys');
  await key(page, 'keyup');
  const before = await page.evaluate(() => window.__operatorKeyboardCheck.commands.filter(value => value.method === 'auditionOn').length + window.__operatorKeyboardCheck.opnOnCount);
  await key(page, 'keydown'); await key(page, 'keyup'); await silent(page, 'Code has no implicit chip audition');
  assert.equal(await page.evaluate(() => window.__operatorKeyboardCheck.commands.filter(value => value.method === 'auditionOn').length + window.__operatorKeyboardCheck.opnOnCount), before);

  // The ordinary Keyboard still uses the user's original explicit route.
  await page.click('#keyboardTab');
  const restored = await routeState(page);
  assert.equal(restored.chipId, savedRoute.chipId); assert.equal(restored.channelId, savedRoute.channelId);
  assert(!await page.locator('#keyboardPanel').evaluate(node => node.classList.contains('is-floating-keyboard')), 'normal Keyboard remains in the dock');
  await key(page, 'keydown'); await active(page, test, manualChannel, true); await lastOn(page, test, manualChannel);
  result.dock = await audible(page, 'normal Keyboard retains its selected target');
  await key(page, 'keyup'); await active(page, test, manualChannel, false); await silent(page, 'normal Keyboard keyup');
  await page.click('#consoleTab'); await page.click(tab(test));
  await key(page, 'keydown'); await audible(page, 'editor audition before Stop');
  await page.click('#stopButton'); await key(page, 'keyup'); await silent(page, 'Stop releases editor audition');
  assert.deepEqual(await page.evaluate(() => window.__operatorKeyboardCheck.commandErrors), [], 'all inspector auditions succeed');
  assert.deepEqual(errors, [], 'no browser errors'); assert.deepEqual(failed, [], 'all resources loaded');
  if (process.argv.includes('--screenshots')) {
    result.screenshot = `/private/tmp/operator-keyboard-${test.id}-${browser}-${worker ? 'worker' : 'main'}-success.png`;
    await page.screenshot({path:result.screenshot});
    if (['gameboy', 'pc-engine', 'dx7'].includes(test.id)) {
      await page.setViewportSize({width:680, height:820}); await assertOverlay(page, test);
      result.smallScreenshot = result.screenshot.replace('-success.png', '-small-success.png');
      await page.screenshot({path:result.smallScreenshot});
    }
  }
  console.log(JSON.stringify({...result, pass:true}));
}

async function main() {
  const values = prefix => process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length).split(',');
  const selectedCases = values('--case=') || values('--cases=');
  const selectedModes = values('--mode=') || values('--modes=');
  const selected = cases.filter(test => (!selectedCases || selectedCases.includes(test.id)) && (!selectedModes || selectedModes.includes(test.mode)));
  assert(selected.length, 'No supported --case/--mode selected');
  for (const id of selectedCases || []) assert(cases.some(test => test.id === id), `Unknown case: ${id}`);
  for (const id of selectedModes || []) assert(cases.some(test => test.mode === id), `Unknown mode: ${id}`);
  const engines = process.argv.includes('--chromium') ? [['chromium', chromium]] : process.argv.includes('--webkit') ? [['webkit', webkit]] : [['chromium', chromium], ['webkit', webkit]];
  const workers = process.argv.includes('--main') ? [false] : process.argv.includes('--worker') ? [true] : [false, true];
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  try {
    const url = `http://127.0.0.1:${server.address().port}/playground/index.html`;
    for (const [name, type] of engines) {
      const browser = await type.launch({headless:true, ...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
      try {
        for (const test of selected) for (const worker of workers) {
          const page = await browser.newPage({viewport:{width:1420, height:1100}, serviceWorkers:'block'});
          page.setDefaultTimeout(25000);
          try {await check(page, url, test, name, worker);}
          catch (error) {
            console.error(JSON.stringify({case:test.id, browser:name, worker, diagnostic:await page.evaluate(() => ({
              status:document.getElementById('status')?.textContent, console:document.getElementById('consoleOutput')?.textContent,
              routes:window.__operatorKeyboardCheck?.keyboardRouting.getState(),
              target:document.getElementById('playgroundKeyboardEditorTarget')?.textContent,
              commands:window.__operatorKeyboardCheck?.commands, errors:window.__operatorKeyboardCheck?.commandErrors,
              pcm:window.__operatorKeyboardCheck?.measure?.(),
            })).catch(() => null)}));
            await page.screenshot({path:`/private/tmp/operator-keyboard-${test.id}-${name}-${worker ? 'worker' : 'main'}-failed.png`}).catch(() => {});
            throw error;
          } finally {await page.close();}
        }
      } finally {await browser.close();}
    }
  } finally {await new Promise(resolve => server.close(resolve));}
}

main().catch(error => {console.error(error); process.exitCode = 1;});
