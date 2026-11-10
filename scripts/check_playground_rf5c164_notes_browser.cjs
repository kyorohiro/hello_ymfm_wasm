// Actual RF5C164 WASM + MegaSynth + Playground Main/Worker note-helper check.
// No physical audio: every destination connection is intercepted through gain
// zero before any runtime module loads; Chromium is also launched muted.
// The HTML is a small harness, while all runtime/WASM bytes come from --root.
// No editor CDN, application UI, microphone, audio files or screenshots needed.
//
// node scripts/check_playground_rf5c164_notes_browser.cjs \
//   --root=docs --entry=/playground/index.html --engines=chromium,webkit \
//   --out=/private/tmp/playground-rf5c164-notes.json
// Flat itch Playground stages use the same js/ + generated/ asset layout.
// --prefix=/nested/ mounts the same package below an additional URL prefix.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {tmpdir} = require('node:os');

const config = {
  root: path.resolve(__dirname, '../docs'),
  entry: '/__rf5c164_notes_check.html',
  prefix: '/',
  engines: 'chromium',
  out: path.join(tmpdir(), 'playground-rf5c164-notes-browser.json'),
};
if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/check_playground_rf5c164_notes_browser.cjs [--root=docs] [--entry=/playground/index.html] [--prefix=/nested/] [--engines=chromium,webkit] [--out=/tmp/result.json]');
  process.exit(0);
}
for (let index = 2; index < process.argv.length; index++) {
  const match = /^--(root|entry|prefix|engines|out)(?:=(.*))?$/.exec(process.argv[index]);
  assert(match, `Unknown argument: ${process.argv[index]}`);
  const value = match[2] ?? process.argv[++index];
  assert(value && !value.startsWith('--'), `Missing --${match[1]} value`);
  config[match[1]] = value;
}
config.root = path.resolve(config.root);
config.out = path.resolve(config.out);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry), '--entry must be a URL pathname');
assert(config.prefix.startsWith('/') && !/[?#]/.test(config.prefix), '--prefix must be a URL pathname');
config.prefix = config.prefix.replace(/\/+$/, '') + '/';
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)), 'Unknown browser engine');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const served = new Map(), missing = [], blocked = [], results = [];
const harness = Buffer.from('<!doctype html><meta charset="utf-8"><title>RF5C164 note API check</title><button id="start">Start muted check</button>');
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json'};
let entry, server;

// This function is serialized into the page before the first application byte.
function installSilentAudit() {
  const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
  const postMessage = MessagePort.prototype.postMessage, meters = [], methods = {};
  AudioNode.prototype.connect = function(destination, ...ports) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...ports);
    const gate = this.context.createGain(), splitter = this.context.createChannelSplitter(2);
    const left = this.context.createAnalyser(), right = this.context.createAnalyser();
    gate.gain.value = 0;
    left.fftSize = right.fftSize = 16384;
    connect.call(this, splitter, ports[0] ?? 0, 0);
    connect.call(splitter, left, 0); connect.call(splitter, right, 1);
    connect.call(left, gate); connect.call(right, gate); connect.call(gate, destination);
    meters.push({source: this, splitter, left, right, gate, destination, output: ports[0] ?? 0});
    return destination;
  };
  AudioNode.prototype.disconnect = function(...args) {
    if (args[0] === this.context.destination) {
      const matches = meters.filter(meter => meter.source === this && meter.destination === args[0] && (args[1] === undefined || args[1] === meter.output));
      if (matches.length) {
        for (const meter of matches) {
          try { disconnect.call(this, meter.splitter); } catch {}
        }
        return;
      }
    }
    return disconnect.call(this, ...args);
  };
  MessagePort.prototype.postMessage = function(message, ...args) {
    if (message && typeof message.method === 'string') methods[message.method] = (methods[message.method] ?? 0) + 1;
    return postMessage.call(this, message, ...args);
  };
  function channel(analyser) {
    const values = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(values);
    let sum = 0, squares = 0, finite = true, peak = 0;
    for (const value of values) { sum += value; squares += value * value; finite &&= Number.isFinite(value); }
    const mean = sum / values.length, crossings = [];
    for (let index = 1; index < values.length; index++) {
      const before = values[index - 1] - mean, after = values[index] - mean;
      peak = Math.max(peak, Math.abs(after));
      if (before <= 0 && after > 0) crossings.push(index - 1 - before / (after - before));
    }
    const acRms = Math.sqrt(Math.max(0, squares / values.length - mean * mean));
    const hz = acRms > 1e-7 && crossings.length > 3
      ? analyser.context.sampleRate * (crossings.length - 1) / (crossings.at(-1) - crossings[0]) : 0;
    return {mean, acRms, acPeak: peak, hz, finite};
  }
  window.__rfNoteAudioAudit = {
    read() {
      const rows = meters.filter(meter => meter.source.context.state !== 'closed').map(meter => ({
        left: channel(meter.left), right: channel(meter.right), sampleRate: meter.source.context.sampleRate,
        audioTime: meter.source.context.currentTime, windowSeconds: meter.left.fftSize / meter.source.context.sampleRate,
      }));
      rows.sort((a, b) => (b.left.acRms + b.right.acRms) - (a.left.acRms + a.right.acRms));
      return rows[0] ?? null;
    },
    summary() { return {destinationConnections: meters.length, physicallyMuted: meters.every(meter => meter.gate.gain.value === 0), wireMethods: {...methods}}; },
  };
}

function sourceFor({id, independent, holdOnly = false}) {
  return `
const pcm = await ${independent ? `createSoundChip('rf5c164', {id:${JSON.stringify('rf-notes-'+id)}})` : "useSoundChip('rf5c164')"};
const wave = Float32Array.from({length:256}, (_,i) => Math.sin(i*2*Math.PI/256));
const sample = await pcm.loadSample({channels:[wave],sampleRate:32768}, {loopStart:0,endGuardBytes:32});
await pcm.setChannel(CH1,{...sample,volume:64,pan:{left:15,right:0}});
if (pcm.setRootNote(null)!==60) throw Error('Root null must restore C4');
const root=pcm.setRootNote('A4');
if (root!==69 || typeof root!=='number') throw Error('Root setter is not synchronous MIDI 69');
const report=(phase,details={})=>log('RFNOTES',JSON.stringify({id:${JSON.stringify(id)},phase,...details}));
keyboard.bind('cancel note loop',{
  noteOn(){stopLoop('rf-note');report('cancelled');},noteOff(){},allNotesOff(){}
});
liveLoop('rf-note',async()=>{
  await pcm.noteOn(CH1,'A4');
  report('${holdOnly ? 'stop-ready' : 'a4'}',{root,baseStep:sample.step});
  ${holdOnly ? '' : `await sleep(1.8);
  const octave=await pcm.setNote(CH1,'A5');
  const repeated=await pcm.setNote(CH1,'A5');
  if (octave!==repeated || octave!==Math.round(sample.step*2)) throw Error('Musical pitch accumulated into its baseline');
  report('a5',{baseStep:sample.step,step:octave,repeated});
  await sleep(1.8);
  await pcm.noteOff(CH1);report('off');
  await sleep(1.8);
  await pcm.noteOn(CH1,'A4');report('cancel-ready');`}
  await sleep(120);
});`;
}

async function logs(page) { return page.evaluate(() => window.__rfNoteTest.logs); }
async function phase(page, id, wanted) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => ({logs: window.__rfNoteTest.logs, errors: window.__rfNoteTest.runtimeErrors}));
    assert.deepEqual(state.errors, [], 'Playground runtime errors');
    for (const line of state.logs) {
      if (!line.startsWith('RFNOTES ')) continue;
      const event = JSON.parse(line.slice('RFNOTES '.length));
      if (event.id === id && event.phase === wanted) return event;
    }
    await delay(25);
  }
  throw Error(`Missing ${id}/${wanted}; logs: ${JSON.stringify(await logs(page))}`);
}
async function output(page, label, expectedHz = null) {
  const deadline = Date.now() + 7000;
  let value, firstAudioTime = null;
  while (Date.now() < deadline) {
    value = await page.evaluate(() => window.__rfNoteAudioAudit.read());
    if (value) {
      assert(value.left.finite && value.right.finite, `${label}: finite samples`);
      firstAudioTime ??= value.audioTime;
      // A retune initially leaves both pitches in the analyser's rolling
      // window. Wait for two complete fresh windows on the rendering clock,
      // even if that transition already falls within the frequency tolerance.
      const fresh = value.audioTime - firstAudioTime >= value.windowSeconds * 2;
      if (fresh && expectedHz === null) {
        if (Math.max(value.left.acRms, value.right.acRms) < 1e-6) return value;
      } else if (fresh && value.left.acRms > .0002 && value.right.acRms < Math.max(.00003, value.left.acRms * .02)
        && Math.abs(value.left.hz - expectedHz) < expectedHz * .045 + 1) return value;
    }
    await delay(35);
  }
  throw Error(`${label}: output did not settle at ${expectedHz === null ? 'AC silence' : expectedHz + ' Hz'}; ${JSON.stringify(value)}; logs ${JSON.stringify(await logs(page))}`);
}

async function megaSynthCase(page) {
  const sample = await page.evaluate(async () => {
    const pcm = window.__rfNoteTest.mega.pcm;
    const wave = Float32Array.from({length:256}, (_,i) => Math.sin(i*2*Math.PI/256));
    const sample = await pcm.loadSample({channels:[wave],sampleRate:32768},{loopStart:0,endGuardBytes:32});
    await pcm.setChannel(0,{...sample,volume:64,pan:{left:15,right:0}});
    if (pcm.setRootNote(null) !== 60 || pcm.setRootNote('A4') !== 69) throw Error('MegaSynth sync Root/null');
    await pcm.noteOn(0,'A4');
    window.__rfNoteTest.sample = sample;
    return sample;
  });
  const a4 = await output(page, 'MegaSynth A4', 128);
  const steps = await page.evaluate(async () => {
    const pcm = window.__rfNoteTest.mega.pcm;
    return [await pcm.setNote(0,'A5'),await pcm.setNote(0,'A5')];
  });
  assert.deepEqual(steps, [sample.step * 2, sample.step * 2], 'Repeated setNote retains the declared sample speed');
  const a5 = await output(page, 'MegaSynth A5', 256);
  assert(Math.abs(a5.left.hz / a4.left.hz - 2) < .035, 'Measured octave is twice original frequency: '+JSON.stringify({a4,a5}));
  await page.evaluate(() => window.__rfNoteTest.mega.pcm.noteOff(0));
  const off = await output(page, 'MegaSynth hard noteOff');
  return {kind: 'MegaSynth client', sample, steps, a4, a5, off};
}

async function playgroundCase(page, execution, independent) {
  const id = execution + '-' + (independent ? 'independent' : 'primary');
  await page.evaluate(({source, execution}) => window.__rfNoteTest.runtime.playSource(source,{execution}), {source:sourceFor({id,independent}),execution});
  const start = await phase(page,id,'a4'), a4 = await output(page,id+' A4',128);
  const changed = await phase(page,id,'a5'), a5 = await output(page,id+' A5',256);
  assert.equal(start.root,69); assert.equal(changed.step,start.baseStep*2); assert.equal(changed.repeated,changed.step);
  assert(Math.abs(a5.left.hz/a4.left.hz-2)<.035,id+': measured octave '+JSON.stringify({a4,a5}));
  await phase(page,id,'off'); const off = await output(page,id+' hard noteOff');
  await phase(page,id,'cancel-ready'); await output(page,id+' before loop cancel',128);
  await page.evaluate(async () => {
    const target=window.__rfNoteTest.runtime.getKeyboardTarget();
    if (!target) throw Error('Missing loop-cancel keyboard target');
    await target.noteOn({id:'cancel',midi:60,velocity:100});
  });
  await phase(page,id,'cancelled'); const cancelled=await output(page,id+' loop cancellation');
  // A fresh Run makes Stop exercise its own ownership fence, separately from
  // the keyboard callback's named-loop cancellation above.
  const stopId=id+'-stop';
  await page.evaluate(({source,execution}) => window.__rfNoteTest.runtime.playSource(source,{execution}),{source:sourceFor({id:stopId,independent,holdOnly:true}),execution});
  await phase(page,stopId,'stop-ready'); await output(page,id+' before Stop',128);
  await page.evaluate(() => window.__rfNoteTest.runtime.stop());
  const stopped=await output(page,id+' global Stop');
  return {execution,client:independent?'independent createSoundChip':'borrowed useSoundChip',start,changed,a4,a5,off,cancelled,stopped};
}

async function checkBrowser(engine, origin, assetPrefix) {
  const {chromium,webkit}=require('playwright');
  const browser=await ({chromium,webkit}[engine]).launch({headless:true,...(engine==='chromium'?{args:['--mute-audio','--autoplay-policy=no-user-gesture-required']}:{} )});
  const errors=[], failed=[], responses=[];
  let page;
  try {
    page=await browser.newPage({serviceWorkers:'block',viewport:{width:1000,height:700}});
    page.setDefaultTimeout(30000);
    page.on('pageerror',error=>errors.push(error.stack??error.message));
    page.on('requestfailed',request=>failed.push({url:request.url(),error:request.failure()?.errorText}));
    page.on('response',response=>{if(response.status()>=400)responses.push({status:response.status(),url:response.url()});});
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){blocked.push(url.href);return route.abort();}
      return route.continue();
    });
    await page.addInitScript(installSilentAudit);
    await page.goto(origin+entry);
    await page.evaluate(async assetPrefix=>{
      const {MegaSynth}=await import(assetPrefix+'js/megasynth.js');
      const {createPlaygroundRuntime}=await import(assetPrefix+'js/playground_runtime.js');
      const state=window.__rfNoteTest={logs:[],runtimeErrors:[],ready:false,error:null};
      const absolute=file=>new URL(assetPrefix+file,location.origin).href;
      state.mega=new MegaSynth({megaCD:true,masterVolume:1,workletUrl:absolute('js/ym2612-worklet.js'),
        ym2612WasmUrl:absolute('generated/ym2612_wasm.wasm'),segaPsgWasmUrl:absolute('generated/segapsg_wasm.wasm'),
        // Use MegaSynth's normal sibling Worklet URL, including its served
        // cache revision. A raw override would register that same processor
        // again under a second URL when an independent client is created.
        rf5c164WasmUrl:absolute('generated/rf5c164_wasm.wasm')});
      state.runtime=createPlaygroundRuntime({synth:state.mega,workerLookaheadSeconds:.05,
        onLog:line=>state.logs.push(line),onStatus:message=>{if(/^Error:|failed/i.test(message))state.runtimeErrors.push(message);}});
      document.querySelector('#start').onclick=async()=>{
        try {await state.runtime.initialize();state.ready=true;}
        catch(error){state.error=error.stack??error.message;}
      };
    },assetPrefix);
    await page.locator('#start').click();
    await page.waitForFunction(()=>window.__rfNoteTest.ready||window.__rfNoteTest.error);
    assert.equal(await page.evaluate(()=>window.__rfNoteTest.error),null,'WASM audio initializes under a user gesture');
    const cases=[await megaSynthCase(page)];
    for(const execution of ['main','worker'])for(const independent of [false,true])cases.push(await playgroundCase(page,execution,independent));
    await page.evaluate(async()=>{await window.__rfNoteTest.runtime.finalize();});
    const audit=await page.evaluate(()=>window.__rfNoteAudioAudit.summary());
    assert(audit.destinationConnections>0&&audit.physicallyMuted,'Every physical audio destination passed through gain zero');
    for(const name of ['setRootNote','setNote','noteOn','noteOff'])assert.equal(audit.wireMethods[name]??0,0,'Note helpers expand to the existing raw RPC: '+name);
    assert((audit.wireMethods.setChannel??0)>0&&(audit.wireMethods.keyOn??0)>0&&(audit.wireMethods.keyOff??0)>0,'Raw RF5C164 operations reached real Worklets');
    assert.deepEqual(await page.evaluate(()=>window.__rfNoteTest.runtimeErrors),[]);
    assert.deepEqual(errors,[],'No uncaught page errors');assert.deepEqual(failed,[],'No failed module/worker/WASM requests');assert.deepEqual(responses,[],'No HTTP errors');
    return {engine,passed:true,cases,audit};
  } finally {
    if(page)await page.evaluate(async()=>{try{await window.__rfNoteTest?.runtime?.finalize();}catch{}}).catch(()=>{});
    await browser.close();
  }
}

(async()=>{
  entry=config.entry.startsWith(config.prefix)?config.entry:config.prefix+config.entry.slice(1);
  // Both the normal docs tree and flat itch stage keep readable runtime files
  // in js/. Validate before launching a browser, with a useful packaging error.
  for(const file of ['js/playground_runtime.js','js/megasynth.js','js/rf5c164_notes.js','generated/rf5c164_wasm.wasm'])await fs.access(path.join(config.root,file));
  server=http.createServer(async(request,response)=>{
    try {
      const pathname=new URL(request.url,'http://localhost').pathname;
      if(pathname===entry){response.setHeader('Content-Type','text/html');response.end(harness);return;}
      if(pathname.endsWith('/favicon.ico')){response.writeHead(204).end();return;}
      assert(pathname.startsWith(config.prefix),'URL is outside package mount');
      const filename=path.resolve(config.root,decodeURIComponent(pathname.slice(config.prefix.length)));
      assert(filename.startsWith(config.root+path.sep),'Path is outside package root');
      const bytes=await fs.readFile(filename),relative=path.relative(config.root,filename).split(path.sep).join('/');
      const metadata={bytes:bytes.length,sha256:hash(bytes)};
      if(served.has(relative))assert.deepEqual(served.get(relative),metadata,'Asset changed during browser check');
      served.set(relative,metadata);response.setHeader('Cache-Control','no-store');
      response.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');response.end(bytes);
    } catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
  const origin='http://127.0.0.1:'+server.address().port;
  for(const engine of engines){results.push(await checkBrowser(engine,origin,config.prefix));console.log('PASS '+engine+': RF5C164 note APIs, Main/Worker, primary/independent, hard noteOff, loop cancel and Stop; physically muted.');}
  assert.deepEqual(missing,[]);assert.deepEqual(blocked,[]);
  assert(served.has('generated/rf5c164_wasm.wasm')&&served.has('generated/ym2612_wasm.wasm'),'Actual RF5C164 and YM2612 WASM assets were served');
})().catch(error=>{results.push({passed:false,error:error.stack??error.message});process.exitCode=1;console.error(error);}).finally(async()=>{
  if(server?.listening)await new Promise(resolve=>server.close(resolve));
  await fs.mkdir(path.dirname(config.out),{recursive:true});
  await fs.writeFile(config.out,JSON.stringify({passed:process.exitCode!==1,root:config.root,entry,prefix:config.prefix,
    generatedHarness:{bytes:harness.length,sha256:hash(harness)},physicalAudio:'All AudioNode destination connections intercepted through gain zero before imports; Chromium additionally --mute-audio.',
    analysis:'Mean-subtracted AC RMS and positive crossings; idle YM2612 DC is excluded. No audio is played to a physical output or saved.',
    results,missing,blocked,servedAssets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))},null,2)+'\n');
});
