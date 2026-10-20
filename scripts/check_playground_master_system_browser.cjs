// Real Master System UI, PSG + YM2413 worklets and physical PCM in both engines.
// The HTTP accessor exposes existing app controls only in this test response.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium,webkit} = require('playwright');
const docs = path.resolve(__dirname,'../docs');
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const server = http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if (pathname === '/favicon.ico') {response.writeHead(204).end(); return;}
    let file = path.resolve(docs,'.'+pathname);
    if (!file.startsWith(docs+path.sep)) throw Error('Outside docs');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file,'index.html');
    let body = await fs.readFile(file);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body+'\nwindow.__smsCheck={runtime,megaDrive,operatorKeyboard,setBottomTab,editorAdapter};');
    response.setHeader('Content-Type',mime[path.extname(file)] ?? 'application/octet-stream'); response.end(body);
  } catch (error) {response.writeHead(404).end(error.message);}
});

const panel = '#ym2413Panel';
const control = name => `${panel} [data-chip-control="opll-${name}"]`;
const action = name => `${panel} [data-chip-action="opll-${name}"]`;
const state = (page,chip = 'ym2413') => page.evaluate(chip => window.__smsCheck.runtime.chipInspector.read(chip),chip);
async function until(page,test,label,chip = 'ym2413') {
  const deadline = Date.now()+10000;
  while (Date.now()<deadline) {const snapshot = await state(page,chip); if (test(snapshot)) return snapshot; await page.waitForTimeout(40);}
  throw Error(label+': '+JSON.stringify(await state(page,chip)));
}
async function field(page,selector,value) {
  await page.locator(selector).evaluate((node,value) => {
    if (node.type === 'checkbox') node.checked = Boolean(value); else node.value = String(value);
    node.dispatchEvent(new Event('change',{bubbles:true}));
  },value);
}
async function attachMeters(page) {
  await page.evaluate(() => {
    const {megaDrive} = window.__smsCheck,context = megaDrive.audioContext;
    const splitter = context.createChannelSplitter(2),silent = context.createGain();
    silent.gain.value = 0; silent.connect(context.destination);
    const meters = [context.createAnalyser(),context.createAnalyser()];
    for (let ch = 0; ch<2; ch++) {meters[ch].fftSize = 8192; splitter.connect(meters[ch],ch); meters[ch].connect(silent);}
    megaDrive.audio.connectOutputMonitor(splitter);
    window.__smsCheck.measure = () => meters.map(meter => {
      const pcm = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(pcm);
      const mean = pcm.reduce((a,b) => a+b,0)/pcm.length,crossings = [];
      for (let i=1; i<pcm.length; i++) if (pcm[i-1]<mean && pcm[i]>=mean) crossings.push(i-1+(mean-pcm[i-1])/(pcm[i]-pcm[i-1]));
      return {rms:Math.sqrt(pcm.reduce((sum,value) => sum+(value-mean)**2,0)/pcm.length),
        peak:Math.max(...pcm.map(Math.abs)),finite:pcm.every(Number.isFinite),
        hz:crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0};
    });
  });
}
const pcm = page => page.evaluate(() => window.__smsCheck.measure());
async function audible(page,label) {
  await page.waitForFunction(() => window.__smsCheck.measure().every(v => v.rms>.0002),null,{timeout:5000});
  const tone = await pcm(page); assert(tone.every(v => v.finite && v.peak<.99),label+': finite unclipped stereo PCM'); return tone;
}
async function pitch(page,expected,label) {
  // OPLL has a key depress/attack phase. Measure a held voice after it settles.
  await page.waitForTimeout(320);
  let tone = await audible(page,label);
  const deadline = Date.now()+5000;
  while (Date.now()<deadline && (!tone.every(v => Math.abs(v.hz-expected)<3) || Math.abs(tone[0].rms-tone[1].rms)>Math.max(tone[0].rms,tone[1].rms)*.05)) {
    await page.waitForTimeout(100); tone = await pcm(page);
  }
  assert(tone.every(v => Math.abs(v.hz-expected)<3),label+': '+JSON.stringify(tone));
  assert(Math.abs(tone[0].rms-tone[1].rms)<Math.max(tone[0].rms,tone[1].rms)*.05,label+': mono signal reaches both outputs');
  return tone;
}
async function silent(page) {
  await page.waitForTimeout(260);
  await page.waitForFunction(() => window.__smsCheck.measure().every(v => v.peak<.00003),null,{timeout:5000});
}
async function stop(page) {
  await page.click('#stopButton');
  await page.waitForFunction(() => window.__smsCheck.runtime.getState().playback === 'stopped'); await silent(page);
}
async function hold(page) {
  const button = page.locator(action('hold')); await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox(); assert(box,'Hold button is laid out');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
}
async function release(page) {await page.mouse.move(5,5); await page.mouse.up();}
async function key(page,type,note = 'A4') {
  await page.evaluate(({type,note}) => {
    const button = [...document.querySelectorAll('#operatorKeyboardRoot .key')].find(button => button.querySelector('span')?.textContent === note);
    if (!button) throw Error('Keyboard note is absent: '+note);
    const key = button.dataset.key,code = /^\d$/.test(key)?`Digit${key}`:`Key${key.toUpperCase()}`;
    document.body.dispatchEvent(new KeyboardEvent(type,{key,code,bubbles:true,cancelable:true}));
  },{type,note});
}
async function keyboard(page,chip,channel) {
  await page.evaluate(() => window.__smsCheck.setBottomTab('keyboard'));
  await page.locator('#operatorKeyboardRoot button').filter({hasText:/^Ukulele$/}).click();
  await page.selectOption('#playgroundKeyboardChip',`chip:${chip}`);
  await page.selectOption('#playgroundKeyboardTargetChannel',String(channel));
}
async function opllChoices(page,expected,label) {
  // Observe the UI first: an explicit inspector read must not be what repairs
  // stale metadata while the Operators panel is hidden.
  await page.waitForFunction(expected => {
    const chip = document.getElementById('playgroundKeyboardChip');
    const select = document.getElementById('playgroundKeyboardTargetChannel');
    return chip.value === 'chip:ym2413' && select.options.length === expected;
  },expected,{timeout:6000});
  const values = await page.locator('#playgroundKeyboardTargetChannel option').evaluateAll(nodes => nodes.map(node => node.value));
  assert.deepEqual(values,expected === 11 ? ['0','1','2','3','4','5','rhythm:0','rhythm:1','rhythm:2','rhythm:3','rhythm:4'] : ['0','1','2','3','4','5','6','7','8'],label);
}
const play = (page,source,execution) => page.evaluate(({source,execution}) => window.__smsCheck.runtime.playSource(source,{execution}),{source,execution});
const quiet = `psg.allNotesOff();opll.allNotesOff();opll.setRhythm({enabled:false});`;
const globals = `if(OPLL_INSTRUMENTS.length!==16||!OPLL_USER_PRESETS.sine||typeof opll.setUserOperator!=='function'||typeof psg.tone!=='function')throw Error('Master System globals');console.log('SMS_GLOBALS_OK');`;

async function masterSystem(page,base) {
  await page.goto(base+'?mode=master-system&no-sw=1');
  await page.waitForFunction(() => window.__smsCheck && window.monaco?.editor?.getEditors().length);
  assert.equal(await page.evaluate(() => window.__smsCheck.megaDrive.audioContext),null,'Opening the page does not create audio');
  assert(await page.locator('#ym2413Tab').isVisible()); assert(await page.locator('#segapsgTab').isVisible());
  assert(!await page.locator('#operatorTab').isVisible(),'No implicit YM2612 Operators');
  await page.click('#ym2413Tab'); await page.click(`${panel} [data-chip-action="prepare"]`);
  await page.locator(control('instrument')).waitFor();
  await until(page,s => s.kind === 'ym2413' && s.channels.length === 9,'OPLL connected');
  const chips = await page.evaluate(() => window.__smsCheck.runtime.chipInspector.list());
  assert.deepEqual(chips.map(chip => chip.kind).sort(),['segapsg','ym2413'],'Exactly the Master System PSG and FM chips exist');
  await attachMeters(page);

  await page.selectOption(control('user-preset'),'sine'); await page.click(action('user-preset')); await page.click(action('use-user'));
  await field(page,control('attenuation'),3); await field(page,control('frequency'),440);
  await until(page,s => s.channels[0].instrument === 0 && s.channels[0].attenuation === 3,'Selected user voice');
  assert.equal(await page.locator(control('user-op-1-tl')).count(),0,'Carrier attenuation is per channel, not an invented shared TL');
  await page.screenshot({path:'/private/tmp/master-system-opll-panel.png',fullPage:true});
  await hold(page); const panelTone = await pitch(page,440,'Operators held sine'); await release(page); await silent(page);

  await page.click(`${panel} [data-chip-channel="1"]`); await page.click(action('use-user')); await field(page,control('attenuation'),4);
  await until(page,s => s.channels[0].instrument === 0 && s.channels[1].instrument === 0 && s.channels[0].attenuation === 3 && s.channels[1].attenuation === 4,'Shared patch with independent channel levels');
  await hold(page); await pitch(page,440,'Second channel uses the shared patch');
  await field(page,control('user-op-1-multi'),2); await until(page,s => s.userPatch.operators[1].multi === 2,'Shared carrier edit');
  await pitch(page,880,'Shared user edit changes live PCM'); await field(page,control('user-op-1-multi'),1); await release(page); await silent(page);
  await page.selectOption(control('instrument'),'4'); await until(page,s => s.channels[1].instrument === 4,'Built-in Flute');
  assert.match(await page.locator(`${panel} [data-chip-output="opll-instrument-info"]`).textContent(),/Flute.*read-only/);
  await page.click(action('use-user')); await page.click(action('keyboard'));
  await page.locator('#operatorKeyboardRoot button').filter({hasText:/^Ukulele$/}).click();
  await key(page,'keydown'); await until(page,s => s.channels[1].active,'Panel Use Keyboard'); await pitch(page,440,'Panel Keyboard target');
  await key(page,'keyup'); await silent(page);

  const executionResults = [];
  for (const execution of ['main','worker']) {
    await play(page,quiet+globals+`opll.setUserPatch(OPLL_USER_PRESETS.sine);opll.setVoice(0,{instrument:0,attenuation:3,sustain:false});opll.setVoice(8,{instrument:0,attenuation:4,sustain:false});liveLoop('sms-opll-browser',async()=>{opll.noteOn(0,'A4');await sleep(2);opll.keyOff(0);await sleep(.05);});`,execution);
    await until(page,s => s.channels[0].active,execution+' OPLL program gate'); await pitch(page,440,execution+' OPLL program');
    assert.match(await page.locator('#consoleOutput').textContent(),/SMS_GLOBALS_OK/);
    await keyboard(page,'ym2413',8); await key(page,'keydown'); await until(page,s => s.channels[8].active,execution+' Keyboard CH8');
    await key(page,'keyup'); await until(page,s => !s.channels[8].active,execution+' Keyboard CH8 release'); await stop(page);

    await play(page,quiet+globals+`liveLoop('sms-psg-browser',async()=>{psg.tone(PSG1,{note:'A4',attenuation:8});await sleep(1);});`,execution);
    await pitch(page,440,execution+' PSG program'); await stop(page);
    await keyboard(page,'segapsg',0); await key(page,'keydown'); await pitch(page,440,execution+' PSG Keyboard'); await key(page,'keyup'); await silent(page);

    await page.click('#codeTab'); await keyboard(page,'ym2413',0);
    await page.evaluate(() => document.activeElement?.blur?.());
    assert(!await page.locator(panel).isVisible(),execution+': OPLL Operators stay hidden during routing updates');
    await opllChoices(page,9,execution+': nine initial melodic channel choices');
    await play(page,quiet+globals+`let changed=false;liveLoop('sms-routing-metadata',async()=>{if(!changed){changed=true;await sleep(1);opll.setRhythm({enabled:true});await sleep(2);opll.setRhythm({enabled:false});}await sleep(1);});`,execution);
    await opllChoices(page,9,execution+': script starts with nine melody voices');
    await until(page,s => !s.rhythm.enabled,execution+': initial applied melody mode');
    await opllChoices(page,11,execution+': source rhythm enable adds five drums without opening Operators');
    await until(page,s => s.rhythm.enabled,execution+': source rhythm enable reaches applied registers');
    await opllChoices(page,9,execution+': source rhythm disable restores nine melodic choices');
    await until(page,s => !s.rhythm.enabled,execution+': source rhythm disable reaches applied registers');
    assert(!await page.locator(panel).isVisible(),execution+': routing did not open Operators');
    await stop(page);
    executionResults.push(execution);
  }

  await page.click('#ym2413Tab');
  await field(page,control('rhythm'),true); await until(page,s => s.rhythm.enabled,'Rhythm mode enabled');
  for (const ch of [6,7,8]) assert(await page.locator(`${panel} [data-chip-channel="${ch}"]`).isDisabled());
  for (const [ch,hz] of [[6,130.81],[7,369.99],[8,261.63]]) await field(page,control(`rhythm-pitch-${ch}`),hz);
  for (const name of ['bassDrum','snare','tom','cymbal','hiHat']) await field(page,control(`rhythm-${name}-attenuation`),3);
  await page.click(`${panel} [data-chip-rhythm="0"]`); await hold(page); await until(page,s => s.rhythm.bassDrum,'Drum Hold gate'); await audible(page,'Bass drum Hold'); await release(page); await silent(page);
  await page.click(action('play')); await until(page,s => s.rhythm.bassDrum,'Timed drum preview'); await audible(page,'Bass drum preview'); await silent(page);
  await keyboard(page,'ym2413','rhythm:1');
  assert.equal(await page.locator('#playgroundKeyboardTargetChannel option').count(),11,'Six melody + five drum choices');
  await key(page,'keydown'); await until(page,s => s.rhythm.snare,'Keyboard drum trigger'); await audible(page,'Keyboard snare');
  await stop(page); await key(page,'keyup');
  await until(page,s => s.channels.every(ch => !ch.active) && ['bassDrum','snare','tom','cymbal','hiHat'].every(name => !s.rhythm[name]),'Stop clears every normal and drum gate');
  return {chips:chips.map(chip => chip.kind),panelA4:panelTone[0].hz,execution:executionResults,sharedPatch:true,keyboard:true,rhythm:true};
}

async function gameGear(page,base) {
  await page.goto(base+'?mode=game-gear&no-sw=1');
  await page.waitForFunction(() => window.__smsCheck && window.monaco?.editor?.getEditors().length);
  assert(!await page.locator('#ym2413Tab').isVisible(),'Game Gear has no Master System FM tab');
  assert(await page.locator('#segapsgTab').isVisible());
  for (const execution of ['main','worker']) {
    await play(page,`if(typeof opll!=='undefined')throw Error('Game Gear gained implicit OPLL');console.log('GAME_GEAR_PSG_ONLY');liveLoop('gg-browser',async()=>{psg.tone(PSG1,{note:'A4',attenuation:8});await sleep(1);});`,execution);
    await page.waitForFunction(() => document.getElementById('consoleOutput').textContent.includes('GAME_GEAR_PSG_ONLY'));
    const chips = await page.evaluate(() => window.__smsCheck.runtime.chipInspector.list());
    assert.deepEqual(chips.map(chip => chip.kind),['segapsg']);
    await page.click('#stopButton'); await page.waitForFunction(() => window.__smsCheck.runtime.getState().playback === 'stopped');
  }
  return true;
}

(async () => {
  try {
    await new Promise((resolve,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',resolve);});
    const base = `http://127.0.0.1:${server.address().port}/playground/index.html`;
    const engines = process.argv.includes('--chromium')?{chromium}:process.argv.includes('--webkit')?{webkit}:{chromium,webkit};
    for (const [name,type] of Object.entries(engines)) {
      const browser = await type.launch({headless:true,...(name === 'chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
      try {
        const page = await browser.newPage({serviceWorkers:'block',viewport:{width:1600,height:1100}}),errors = [],missing = [];
        page.setDefaultTimeout(30000); page.on('pageerror',error => errors.push(error.message)); page.on('response',r => {if (r.status() === 404) missing.push(r.url());});
        try {
          const result = await masterSystem(page,base),negative = await gameGear(page,base);
          assert.deepEqual(errors,[]); assert.deepEqual(missing,[]);
          console.log(JSON.stringify({browser:name,passed:true,...result,gameGearPsgOnly:negative}));
        } finally {await page.close();}
      } finally {await browser.close();}
    }
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
