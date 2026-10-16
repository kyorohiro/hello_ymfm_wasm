// Real Playground UI keyboard, runtime and YM2612 Worklet PCM. No app source is
// changed: the self-hosted response only exposes existing controls to the test.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium,webkit} = require('playwright');

const docs = path.resolve(__dirname,'../docs');
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const accessor = '\nwindow.__keyboardRegression={runtime,megaDrive,operatorKeyboard,operatorTab,setBottomTab,editorAdapter};';
const server = http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let filename = path.resolve(docs,'.' + pathname);
    if (!filename.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename,'index.html');
    let body = await fs.readFile(filename);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() + accessor);
    response.setHeader('Content-Type',mime[path.extname(filename)] || 'application/octet-stream');
    response.end(body);
  } catch (error) { response.writeHead(404).end(String(error)); }
});

async function initialize(page,url) {
  await page.goto(url);
  await page.waitForFunction(() => window.__keyboardRegression && window.monaco?.editor?.getEditors().length);
  await page.evaluate(() => {
    document.getElementById('workerExecution').checked = false;
    window.__keyboardRegression.editorAdapter.setValue('await sleep(.01);');
  });
  await page.click('#runButton'); // Supply WebKit's real user activation.
  await page.waitForFunction(() => !document.getElementById('runButton').disabled);
  await page.evaluate(() => {
    const {megaDrive} = window.__keyboardRegression,context = megaDrive.audioContext;
    const splitter = context.createChannelSplitter(2),meters = [context.createAnalyser(),context.createAnalyser()];
    const silent = context.createGain(); silent.gain.value = 0; silent.connect(context.destination);
    for (let channel = 0;channel < 2;channel++) {
      meters[channel].fftSize = 4096;
      splitter.connect(meters[channel],channel); meters[channel].connect(silent);
    }
    megaDrive.audio.connectOutputMonitor(splitter);
    window.__keyboardRegression.meters = meters;
    window.__keyboardRegression.setBottomTab('keyboard');
  });
  await page.locator('#operatorKeyboardRoot button').filter({hasText:'Ukulele'}).click();
}

async function run(page,source,execution) {
  await page.evaluate(async ({source,execution}) => {
    await window.__keyboardRegression.runtime.playSource(source,{execution});
  },{source,execution});
}

async function sample(page) {
  return page.evaluate(() => window.__keyboardRegression.meters.map(meter => {
    const pcm = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(pcm);
    const mean = pcm.reduce((sum,value) => sum + value,0) / pcm.length;
    let energy = 0,peak = 0;
    const crossings = [];
    for (let i = 0;i < pcm.length;i++) {
      const value = pcm[i] - mean; energy += value * value; peak = Math.max(peak,Math.abs(value));
      if (i && pcm[i - 1] < mean && pcm[i] >= mean) crossings.push(i - 1 + (mean - pcm[i - 1]) / (pcm[i] - pcm[i - 1]));
    }
    return {rms:Math.sqrt(energy / pcm.length),peak,
      frequency:crossings.length > 2 ? (crossings.length - 1) * meter.context.sampleRate / (crossings.at(-1) - crossings[0]) : null};
  }));
}

async function settled(page,wait = 160) {
  await page.waitForTimeout(wait);
  return sample(page);
}

async function stop(page) {
  await page.click('#stopButton');
  await page.waitForFunction(() => !document.getElementById('runButton').disabled &&
    window.__keyboardRegression.runtime.getState().playback === 'stopped');
}

async function key(page,note,type) {
  await page.evaluate(({note,type}) => {
    const root = document.getElementById('operatorKeyboardRoot');
    const button = [...root.querySelectorAll('.key')].find(button => button.querySelector('span')?.textContent === note);
    if (!button) throw Error('Keyboard note is not in the selected layout: ' + note);
    // Use the real global keyboard handlers. A neutral body target avoids
    // accidental editor typing and keeps focus changes out of this test.
    document.body.dispatchEvent(new KeyboardEvent(type,{key:button.dataset.key,bubbles:true,cancelable:true}));
  },{note,type});
}

function pitch(actual,expected,label) {
  assert(actual.rms > .001,label + ': audio is silent');
  assert(Math.abs(actual.frequency - expected) < 2,label + ': ' + JSON.stringify(actual));
}

const setupSource = `
const testTone = {algorithm:7,feedback:0,operators:FM_PRESETS.sine.operators.map(operator => ({...operator}))};
testTone.operators[3].tl = 32;
fm.setPreset(CH1,testTone); fm.setPan(CH1,true,false);
fm.setPreset(CH2,testTone); fm.setPan(CH2,false,true);
`;
const source = note => setupSource + `
liveLoop('lead',async () => { await play(${JSON.stringify(note)},{channel:CH1,seconds:.08}); await sleep(.02); });
liveLoop('other',async () => {
  context.keyboardRegressionTicks = (context.keyboardRegressionTicks || 0) + 1;
  console.log('KEYBOARD_OTHER_TICK',context.keyboardRegressionTicks);
  await play('G3',{channel:CH2,seconds:.25});
});
`;

async function checkExecution(page,execution) {
  await run(page,source('D4'),execution);
  await page.evaluate(() => window.__keyboardRegression.setBottomTab('keyboard'));
  const countTicks = () => page.evaluate(() => (document.getElementById('consoleOutput').textContent.match(/KEYBOARD_OTHER_TICK/g) || []).length);
  const ticksBefore = await countTicks();
  await key(page,'A4','keydown');
  const heldFirst = await settled(page,220);
  pitch(heldFirst[0],440,execution + ': held A4 after an old play() ends');
  pitch(heldFirst[1],196,execution + ': other channel while A4 is held');
  const heldLater = await settled(page,300);
  pitch(heldLater[0],440,execution + ': held A4 across later script Note Ons');
  pitch(heldLater[1],196,execution + ': other channel continues across script cycles');
  assert(await countTicks() > ticksBefore,execution + ': the other loop clock stopped during audition');

  // A later manual key steals the channel. Releasing its predecessor must not
  // send a stale key-off into the replacement note.
  await key(page,'B4','keydown');
  await settled(page);
  await key(page,'A4','keyup');
  const replacement = await settled(page);
  pitch(replacement[0],440 * 2 ** (2 / 12),execution + ': a stale manual release must not kill B4');
  await key(page,'B4','keyup');
  const resumed = await settled(page,220);
  assert(resumed[0].rms > .001,execution + ': the next program note must play after manual release');
  pitch(resumed[1],196,execution + ': unrelated channel after release');

  // Stop invalidates the held manual owner. An old physical key-up arriving
  // after a new Run must not stop the new program's note.
  await key(page,'A4','keydown');
  pitch((await settled(page))[0],440,execution + ': second manual hold');
  await stop(page);
  const stopped = await settled(page);
  assert(stopped.every(channel => channel.rms < .00001),execution + ': Stop left audible output');
  await run(page,setupSource + `
liveLoop('lead',async () => { await play('C5',{channel:CH1,seconds:1.2}); });
liveLoop('other',async () => { await play('G3',{channel:CH2,seconds:.25}); });
`,execution);
  await key(page,'A4','keyup');
  const afterStaleRelease = await settled(page,220);
  pitch(afterStaleRelease[0],523.251,execution + ': stale key-up after Stop must not kill a new Run');
  pitch(afterStaleRelease[1],196,execution + ': other channel after Stop/Run');

  await stop(page);
  await key(page,'A4','keydown');
  const auditionAfterStop = await settled(page,220);
  pitch(auditionAfterStop[0],440,execution + ': Keyboard can resume faded output after Stop');
  assert(auditionAfterStop[1].rms < .00001,execution + ': after-Stop audition restarted an unrelated channel');
  assert.equal(await page.evaluate(() => window.__keyboardRegression.runtime.getState().playback),'stopped',
    execution + ': audition must not restart the program');
  await key(page,'A4','keyup');
  const released = await settled(page,220);
  assert(released.every(channel => channel.rms < .0001),execution + ': audition release did not end the note');
  return {execution,heldFirst,heldLater,replacement,resumed,afterStaleRelease,auditionAfterStop};
}

async function checkBrowser(name,type,url) {
  const browser = await type.launch({headless:true,...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const page = await browser.newPage({serviceWorkers:'block'}),errors = [];
    page.on('pageerror',error => errors.push(error.message));
    await initialize(page,url);
    const results = [];
    for (const execution of ['main','worker']) results.push(await checkExecution(page,execution));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({browser:name,results}));
  } finally { await browser.close(); }
}

(async () => {
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  try {
    const url = `http://127.0.0.1:${server.address().port}/playground/index.html`;
    const selected = process.argv.includes('--chromium') ? [['chromium',chromium]]
      : process.argv.includes('--webkit') ? [['webkit',webkit]] : [['chromium',chromium],['webkit',webkit]];
    for (const [name,type] of selected) await checkBrowser(name,type,url);
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
