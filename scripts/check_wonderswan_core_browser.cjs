// Real standalone WonderSwan WASM in Browser and DedicatedWorker.
// No AudioContext, AudioWorklet, physical audio device or mocked core is used.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const root = path.resolve(__dirname, '..');
const config = {engines:[], out:null};
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--chromium' || arg === '--webkit') config.engines.push(arg.slice(2));
  else if (arg === '--out') {
    assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), '--out requires a path');
    config.out = path.resolve(process.argv[++i]);
  } else if (arg === '--help') {
    console.log('Usage: node scripts/check_wonderswan_core_browser.cjs [--chromium] [--webkit] [--out REPORT.json]');
    process.exit(0);
  } else throw Error('Unknown argument: ' + arg);
}
if (!config.engines.length) config.engines = ['chromium', 'webkit'];
config.engines = [...new Set(config.engines)];

// This exact function runs in Node, the browser Window and a DedicatedWorker.
// Checks inside the runner are independent controls; byte-for-byte Node PCM
// comparison below additionally verifies the same WASM/wrapper in each realm.
async function runScenarios(WonderSwan, factory, wasmBinary) {
  const check = (condition, label) => {if (!condition) throw Error(label);};
  const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const module = await factory({wasmBinary});
  const create = rate => WonderSwan.create({moduleFactory:async () => module, clock:3072000, sampleRate:rate});
  const frames = 128, blocks = 12, results = [], wrapper = [];
  function setup(chip, mode) {
    chip.writeRegister(0x91, 8);
    const bytes = new Uint8Array(64);
    for (let ch = 0; ch < 4; ch++) {
      for (let i = 0; i < 16; i++) {
        const lo = (i * 2 + ch * 3) & 15, hi = (i * 2 + 1 + ch * 3) & 15;
        bytes[ch * 16 + i] = lo | hi << 4;
      }
      const divisor = 1801 + ch * 51;
      chip.writeRegister(0x80 + ch * 2, divisor & 255);
      chip.writeRegister(0x81 + ch * 2, divisor >> 8);
      chip.writeRegister(0x88 + ch, [0xf1,0x2e,0xb5,0x79][ch]);
    }
    chip.loadMemory(bytes);
    bytes.fill(0);
    check(chip.readMemory(1) === 0x32, 'RAM upload must copy packed input bytes');
    chip.writeMemory(0x3fff, 0xa5);
    chip.writeRegister(0x90, mode === 'sweep' ? 0x44 : mode === 'noise' ? 0x88 : mode === 'pcm' ? 0x22 : 15);
    if (mode === 'sweep') {chip.writeRegister(0x8c, 7); chip.writeRegister(0x8d, 0);}
    if (mode === 'noise') chip.writeRegister(0x8e, 0x18);
    if (mode === 'pcm') {chip.writeRegister(0x94, 15); chip.writeRegister(0x89, 0xe3);}
  }
  function snapshot(chip, full = false) {
    return {registers:Array.from({length:32}, (_, i) => chip.readRegister(0x80 + i)),
      memory:Array.from({length:full ? 0x4000 : 64}, (_, i) => chip.readMemory(i)),
      lastByte:chip.readMemory(0x3fff)};
  }
  for (const rate of [44100,48000]) {
    for (const mode of ['four-waves','noise','sweep','pcm','mute','reset']) {
      const chip = await create(rate);
      try {
        chip.reserveFrames(frames);
        setup(chip, mode);
        const left = [], right = [], states = [], peaks = [];
        let retainedView;
        for (let block = 0; block < blocks; block++) {
          if (mode === 'noise') chip.writeRegister(0x8e, 0x18 | block % 8);
          if (mode === 'sweep' && block === 6) chip.writeRegister(0x8c, 0xff);
          if (mode === 'pcm') {
            chip.writeRegister(0x89, (block * 37 + 17) & 255);
            chip.writeRegister(0x94, [15,5,8,2][block % 4]);
          }
          if (mode === 'mute') {
            if (block === 3) for (let ch = 0; ch < 4; ch++) chip.setChannelMuted(ch, true);
            if (block === 6) for (let ch = 0; ch < 4; ch++) chip.setChannelMuted(ch, false);
          }
          if (mode === 'reset' && block === 6) chip.reset();
          if (mode === 'reset' && block === 9) setup(chip, mode);
          const view = chip.generateStereoView(frames);
          if (retainedView) check(view === retainedView && view.left === retainedView.left && view.right === retainedView.right,
            'Fixed-size borrowed PCM views must be reused');
          retainedView = view;
          let peak = 0;
          for (let i = 0; i < frames; i++) {
            check(Number.isFinite(view.left[i]) && Number.isFinite(view.right[i]), 'PCM must be finite');
            peak = Math.max(peak, Math.abs(view.left[i]), Math.abs(view.right[i]));
          }
          left.push(...view.left); right.push(...view.right); peaks.push(peak);
          states.push(snapshot(chip));
        }
        check(peaks.slice(0,3).some(v => v > 0), mode + ' positive control must produce PCM');
        check(left.some((v, i) => v !== right[i]), mode + ' must exercise separate stereo values');
        if (mode === 'mute') check(peaks.slice(3,6).every(v => v === 0) && peaks.slice(6).some(v => v > 0), 'Mute and unmute PCM controls');
        if (mode === 'reset') {
          check(peaks.slice(6,9).every(v => v === 0), 'Cold reset must clear held PCM');
          check(states[6].memory.every(v => v === 0) && states[6].lastByte === 0, 'Cold reset must clear RAM');
          check(peaks.slice(9).some(v => v > 0), 'Reprogrammed reset instance must produce PCM');
        }
        if (mode === 'sweep') check(states.some(s => s.registers[4] !== states[0].registers[4]), 'Sweep must change frequency');
        if (mode === 'noise') check(states.some(s => s.registers[0x12] || s.registers[0x13]), 'Noise LFSR must advance');
        results.push({rate,mode,frames:left.length,left,right,states,final:snapshot(chip,true)});
      } finally {chip.dispose();}
    }

    const a = await create(rate), b = await create(rate), reference = await create(rate);
    let owned, retained;
    try {
      a.reserveFrames(512); b.reserveFrames(512); reference.reserveFrames(512);
      setup(a, 'four-waves'); setup(reference, 'four-waves');
      check(b.generateStereo(frames).left.every(v => v === 0), 'An independent cold instance must stay silent');
      b.writeMemory(0,255); b.writeRegister(0x88,255); b.writeRegister(0x90,1); b.generateStereo(333);
      check(a.readMemory(0) === reference.readMemory(0), 'Other-instance RAM writes must remain isolated');
      const actual = a.generateStereo(frames), expected = reference.generateStereo(frames);
      check(same(actual.left,expected.left) && same(actual.right,expected.right), 'Other-instance rendering must not advance the active instance');
      owned = a.generateStereo(17); retained = {left:Array.from(owned.left),right:Array.from(owned.right)};
      const intoLeft = new Float32Array(frames), intoRight = new Float32Array(frames);
      a.generateStereoInto(intoLeft,intoRight);
      check(same(owned.left,retained.left) && same(owned.right,retained.right), 'Owned PCM must survive later renders');
      wrapper.push({rate,independentInstances:true,borrowedViewReuse:true,ownedCopyRetention:true,
        owned:retained,into:{left:Array.from(intoLeft),right:Array.from(intoRight)}});
    } finally {a.dispose(); b.dispose(); reference.dispose();}
    check(same(owned.left,retained.left) && same(owned.right,retained.right), 'Owned PCM must survive disposal');
  }
  return {clock:3072000,rates:[44100,48000],blocks,blockFrames:frames,results,wrapper};
}

const runnerSource = `import {WonderSwan} from '/web/wonderswan.js';
import factory from '/docs/generated/wonderswan_wasm.js';
const runScenarios=${runScenarios.toString()};
export async function run(){const response=await fetch('/docs/generated/wonderswan_wasm.wasm');
if(!response.ok)throw Error('WASM fetch failed: '+response.status);
return runScenarios(WonderSwan,factory,new Uint8Array(await response.arrayBuffer()));}`;
const workerSource = `import {run} from '/check_runner.mjs';
self.onmessage=async()=>{try{self.postMessage({result:await run()});}catch(error){self.postMessage({error:error.stack||String(error)});}};`;
const digest = value => createHash('sha256').update(Buffer.from(new Float32Array(value).buffer)).digest('hex');

(async () => {
  const wasmBinary = await fs.readFile(path.join(root,'docs/generated/wonderswan_wasm.wasm'));
  const {WonderSwan} = await import(pathToFileURL(path.join(root,'web/wonderswan.js')).href);
  const {default:factory} = await import(pathToFileURL(path.join(root,'docs/generated/wonderswan_wasm.js')).href);
  const expected = await runScenarios(WonderSwan,factory,wasmBinary);
  const assets = new Map([
    ['/',{type:'text/html',body:'<!doctype html><meta charset="utf-8"><title>Standalone WonderSwan core verification</title>'}],
    ['/check_runner.mjs',{type:'text/javascript',body:runnerSource}],
    ['/check_worker.mjs',{type:'text/javascript',body:workerSource}],
    ['/web/wonderswan.js',{type:'text/javascript',body:await fs.readFile(path.join(root,'web/wonderswan.js'))}],
    ['/docs/generated/wonderswan_wasm.js',{type:'text/javascript',body:await fs.readFile(path.join(root,'docs/generated/wonderswan_wasm.js'))}],
    ['/docs/generated/wonderswan_wasm.wasm',{type:'application/wasm',body:wasmBinary}],
  ]);
  const server = http.createServer((request,response) => {
    let pathname;
    try {pathname = new URL(request.url,'http://localhost').pathname;} catch {response.writeHead(400).end(); return;}
    if (pathname === '/favicon.ico') {response.writeHead(204).end(); return;}
    const asset = assets.get(pathname);
    if (!asset || request.method !== 'GET') {response.writeHead(404,{'Content-Type':'text/plain'}).end('Not found'); return;}
    response.writeHead(200,{'Content-Type':asset.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(asset.body);
  });
  await new Promise((resolve,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',resolve);});
  const report = {schemaVersion:1,passed:false,deviceOpened:false,audioContextCreated:false,
    wasmSha256:createHash('sha256').update(wasmBinary).digest('hex'),clock:expected.clock,rates:expected.rates,
    sources:await Promise.all(['scripts/check_wonderswan_core_browser.cjs','web/wonderswan.js','docs/generated/wonderswan_wasm.js'].map(async file => {
      const bytes=await fs.readFile(path.join(root,file));
      return {path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    })),
    method:'Exact Float32 PCM and register/RAM comparison: real Node WASM reference versus browser Window and DedicatedWorker, with independent positive controls.',
    limits:['Standalone synchronous core and wrapper only; no Playground Mode, AudioWorklet scheduling, real-time deadlines, physical audio, listening judgment or hardware-accuracy claim.'],engines:[]};
  try {
    for (const name of config.engines) {
      const browser = await ({chromium,webkit}[name]).launch({headless:true});
      try {
        const page = await browser.newPage(), errors = [], failures = [];
        page.on('pageerror',error => errors.push(error.stack || error.message));
        page.on('requestfailed',request => failures.push(request.url() + ': ' + request.failure()?.errorText));
        page.on('response',response => {if (response.status() >= 400) failures.push(response.url() + ': HTTP ' + response.status());});
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        for (const realm of ['Window','DedicatedWorker']) {
          const actual = await page.evaluate(async realm => {
            if (realm === 'Window') return (await import('/check_runner.mjs')).run();
            return new Promise((resolve,reject) => {
              const worker = new Worker('/check_worker.mjs',{type:'module'});
              const timer = setTimeout(() => {worker.terminate(); reject(Error('WonderSwan worker timed out'));},30000);
              const finish = (error,result) => {clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve(result);};
              worker.onerror = error => finish(Error(error.message));
              worker.onmessage = ({data}) => finish(data.error ? Error(data.error) : null,data.result);
              worker.postMessage('run');
            });
          },realm);
          assert.deepEqual(actual,expected,`${name} ${realm}: exact PCM/register/RAM/reference agreement`);
          const frames = actual.results.reduce((sum,scene) => sum + scene.frames,0);
          report.engines.push({name,realm,passed:true,scenes:actual.results.length,stereoFrames:frames,
            sampleComparisons:frames * 2,maximumDifference:0,registerRamSnapshots:actual.results.reduce((sum,scene) => sum + scene.states.length + 1,0),
            pcmSha256:actual.results.map(scene => ({rate:scene.rate,mode:scene.mode,left:digest(scene.left),right:digest(scene.right)}))});
          console.log(`WonderSwan ${name} ${realm}: ${actual.results.length} scenes, ${frames} stereo frames; PCM/register/RAM exact, wrapper controls passed.`);
        }
        assert.deepEqual(errors,[],`${name}: browser exceptions`);
        assert.deepEqual(failures,[],`${name}: failed requests`);
      } finally {await browser.close();}
    }
    report.passed = true;
    if (config.out) await fs.writeFile(config.out,JSON.stringify(report,null,2) + '\n');
    console.log('WonderSwan standalone browser / worker check passed; no audio device opened.');
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
