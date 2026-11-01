// Standalone PS1 SPU WASM in Window and DedicatedWorker, Chromium and WebKit.
// No AudioContext, AudioWorklet, physical audio device, console BIOS or mocked core.
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
  } else if (arg.startsWith('--out=')) config.out = path.resolve(arg.slice(6));
  else if (arg === '--help') {
    console.log('Usage: node scripts/check_ps1_spu_browser.cjs [--chromium] [--webkit] [--out REPORT.json]');
    process.exit(0);
  } else throw Error('Unknown argument: ' + arg);
}
if (!config.engines.length) config.engines = ['chromium','webkit'];
config.engines = [...new Set(config.engines)];

// Execute exactly the same authored fixture and lifecycle checks in each realm.
async function runScenarios(Ps1Spu, factory, wasmBinary) {
  const check = (value, label) => {if (!value) throw Error(label);};
  const same = (a,b) => a.length === b.length && a.every((value,index) => Object.is(value,b[index]));
  const silent = pcm => pcm.left.every(value => value === 0) && pcm.right.every(value => value === 0);
  const crossings = pcm => pcm.reduce((sum,value,index) => sum + (index > 0 && pcm[index - 1] <= 0 && value > 0 ? 1 : 0),0);
  const peak = pcm => pcm.reduce((maximum,value) => Math.max(maximum,Math.abs(value)),0);
  const module = await factory({wasmBinary});
  const create = () => Ps1Spu.create({moduleFactory:async () => module});
  const chip = await create(), other = await create();
  const cycle = [0,1,2,3,4,5,6,7,6,5,4,3,2,1,0,-1,-2,-3,-4,-5,-6,-7,-6,-5,-4,-3,-2,-1];
  const adpcm = new Uint8Array(64);
  for (let block = 0; block < 4; block++) {
    adpcm[block * 16] = 4; // Predictor zero, shift four: authored signed 4-bit triangle.
    adpcm[block * 16 + 1] = block === 0 ? 6 : block === 3 ? 3 : 2;
    for (let byte = 0; byte < 14; byte++) adpcm[block * 16 + byte + 2] =
      (cycle[byte * 2] & 15) | (cycle[byte * 2 + 1] & 15) << 4;
  }
  const voice = 23, base = voice * 16, address = 0x1000;
  function setup(pitch) {
    chip.write(0x180,0x3fff); chip.write(0x182,0x3fff);
    chip.write(0x1aa,0xc000);
    chip.write(base,0x3fff); chip.write(base + 2,0x2000);
    chip.write(base + 4,pitch); chip.write(base + 6,address / 8);
    chip.write(base + 8,0x000f); chip.write(base + 10,0x0000);
    chip.write(base + 14,address / 8);
    chip.write(0x18a,0x80); // Upper key-on bank: the 24th hardware voice.
  }
  let normal, doubled, result;
  try {
    check(chip.sampleRate === 44100 && chip.nativeFrames === 0, 'Native sample rate/frame counter');
    chip.loadRam(adpcm,address);
    check(same(chip.readRam(address,adpcm.length),adpcm), 'RAM transfer must preserve authored packets');
    const expectedRam = Array.from(adpcm);
    adpcm.fill(0);
    check(same(chip.readRam(address,64),expectedRam), 'RAM upload must own its source bytes');
    check(other.readRam(address,64).every(value => value === 0), 'Independent instance RAM');
    setup(0x1000);
    check(chip.read(base + 4) === 0x1000 && chip.read(base + 6) === address / 8, 'Voice 24 register readback');
    check(silent(other.generateStereo(257)), 'Independent inactive instance stays silent');
    normal = chip.generateStereo(4097); // Also exercises internal ring-buffer chunking.
    check(chip.nativeFrames === 4097, 'Rendered frame counter');
    check(normal.left.every(Number.isFinite) && normal.right.every(Number.isFinite), 'Finite stereo PCM');
    check(peak(normal.left) > 0.04 && peak(normal.right) > 0.02, 'Voice 24 positive audio control');
    check(normal.left.some((value,index) => value !== normal.right[index]), 'Distinct stereo gains');
    check(chip.read(base + 12) > 0 && chip.read(0x200 + voice * 4) === 0x7ffe, 'Live envelope and extended volume bank');
    chip.write(base + 4,0x2000);
    check(chip.read(base + 4) === 0x2000, 'Live pitch register readback');
    doubled = chip.generateStereo(4097);
    check(doubled.left.every(Number.isFinite) && doubled.right.every(Number.isFinite), 'Finite pitch-up PCM');
    const low = crossings(normal.left), high = crossings(doubled.left);
    check(low > 100 && high > low * 1.9 && high < low * 2.1, 'Pitch doubling must double actual waveform frequency');
    const retained = Array.from(normal.left);
    chip.write(0x18e,0x80);
    const release = chip.generateStereo(1024);
    check(release.left.slice(-128).every(value => value === 0) && release.right.slice(-128).every(value => value === 0), 'Voice 24 key-off release');
    chip.reset();
    check(chip.nativeFrames === 0 && chip.read(base + 4) === 0, 'Reset registers/frame counter');
    check(same(chip.readRam(address,64),expectedRam), 'Default reset retains RAM');
    check(silent(chip.generateStereo(128)), 'Reset clears held voices');
    setup(0x1000);
    check(peak(chip.generateStereo(256).left) > 0.04, 'Retained RAM is playable after reset');
    chip.reset({clearRam:true});
    check(chip.readRam(address,64).every(value => value === 0), 'Explicit reset clears RAM');
    check(silent(chip.generateStereo(128)), 'Cleared reset silence');
    check(same(normal.left,retained), 'Returned PCM remains owned across later renders');
    const loopRepeats=[];
    for(const options of [{loopBlock:0,marker:true},{loopBlock:2,marker:true},{loopBlock:2,marker:false}])for(const pitch of [4096,0x1234]) {
      const bytes=new Uint8Array((options.loopBlock+4)*16);
      for(let block=0;block<options.loopBlock+4;block++) {
        const at=block*16;bytes[at]=1;
        bytes[at+1]=block===options.loopBlock&&options.marker?4:0;
        if(block===options.loopBlock+3)bytes[at+1]|=3;
        for(let i=0;i<28;i++) {const value=block<options.loopBlock?3:Math.round(7*Math.sin(2*Math.PI*((block-options.loopBlock)*28+i)/112));bytes[at+2+(i>>1)]|=(value&15)<<((i&1)*4);}
      }
      const control=bytes.slice();control[options.loopBlock*16+1]|=2;
      const configure=(core,packets)=>{
        core.reset({clearRam:true});core.loadRam(packets,0x2000);
        for(const [at,value]of [[0x180,0x3fff],[0x182,0x3fff],[0x1aa,0xc000],[0,0x3fff],[2,0x2000],[4,pitch],[6,0x400],[8,15],[10,0],[14,(0x2000+options.loopBlock*16)/8],[0x188,1]])core.write(at,value);
      };
      configure(chip,bytes);configure(other,control);
      const frames=16384,left=new Float32Array(frames+10).fill(123),right=new Float32Array(frames+10).fill(123),parts=[1,27,2,113,2048];
      for(let at=0,index=0;at<frames;index++){const count=Math.min(frames-at,parts[index%parts.length]);chip.renderInto(left,right,count,at+5);at+=count;}
      check([left,right].every(values=>values.slice(0,5).every(v=>v===123)&&values.slice(-5).every(v=>v===123)),'Loop render offsets preserve guard frames');
      const actual={left:left.slice(5,frames+5),right:right.slice(5,frames+5)},expected=other.generateStereo(frames);
      check(peak(expected.left.slice(8192))>.01,'Flag6/flag2 positive control remains audible');
      check(peak(actual.left.slice(8192))>.01,'Flag4-only/markerless loop remains audible beyond original END');
      check(same(actual.left,expected.left)&&same(actual.right,expected.right),'Repeat packet flag2 does not change exact PCM');
      check(same(chip.readRam(0x2000,bytes.length),bytes),'Loop playback retains original flag4/flag0 ADPCM bytes');
      chip.write(0x18c,1);
      const released=chip.generateStereo(8192);
      check(released.left.slice(-128).every(value=>value===0)&&released.right.slice(-128).every(value=>value===0),'Loop keyOff release');
      loopRepeats.push({...options,pitch,frames,tailPeak:peak(actual.left.slice(8192)),originalRamExact:true,
        left:Array.from(actual.left),right:Array.from(actual.right)});
    }
    result = {sampleRate:chip.sampleRate,voice:24,normalLeft:Array.from(normal.left),normalRight:Array.from(normal.right),loopRepeats,
      doubledLeft:Array.from(doubled.left),doubledRight:Array.from(doubled.right),
      crossings:{normal:low,doubled:high},peak:{left:peak(normal.left),right:peak(normal.right)},
      independentInstances:true,ramCopy:true,pitch:true,keyOff:true,resetRetainsRam:true,resetClearsRam:true};
  } finally {chip.dispose(); other.dispose();}
  chip.dispose(); // Disposal is idempotent.
  let rejected = false;
  try {chip.generateStereo(1);} catch (error) {rejected = /disposed/i.test(error.message);}
  check(rejected, 'Disposed instances reject rendering');
  check(same(normal.left,result.normalLeft), 'Owned PCM remains valid after disposal');
  result.disposed = true;
  return result;
}

const runnerSource = `import {Ps1Spu} from '/web/ps1_spu.js';
import factory from '/docs/generated/ps1_spu_wasm.js';
const runScenarios=${runScenarios.toString()};
export async function run(){const response=await fetch('/docs/generated/ps1_spu_wasm.wasm');
if(!response.ok)throw Error('WASM fetch failed: '+response.status);
return runScenarios(Ps1Spu,factory,new Uint8Array(await response.arrayBuffer()));}`;
const workerSource = `import {run} from '/check_runner.mjs';
for(const name of ['AudioContext','webkitAudioContext']) if(name in globalThis)
Object.defineProperty(globalThis,name,{configurable:true,value:class{constructor(){throw Error('Worker AudioContext creation is forbidden');}}});
self.onmessage=async()=>{try{self.postMessage({result:await run()});}catch(error){self.postMessage({error:error.stack||String(error)});}};`;
const hash = data => createHash('sha256').update(data).digest('hex');
const pcmHash = values => hash(Buffer.from(new Float32Array(values).buffer));

(async () => {
  const wasmBinary = await fs.readFile(path.join(root,'docs/generated/ps1_spu_wasm.wasm'));
  const {Ps1Spu} = await import(pathToFileURL(path.join(root,'web/ps1_spu.js')).href);
  const {default:factory} = await import(pathToFileURL(path.join(root,'docs/generated/ps1_spu_wasm.js')).href);
  const expected = await runScenarios(Ps1Spu,factory,wasmBinary);
  const assets = new Map([
    ['/',{type:'text/html',body:'<!doctype html><meta charset="utf-8"><title>Standalone PS1 SPU verification</title>'}],
    ['/check_runner.mjs',{type:'text/javascript',body:runnerSource}],
    ['/check_worker.mjs',{type:'text/javascript',body:workerSource}],
    ['/web/ps1_spu.js',{type:'text/javascript',body:await fs.readFile(path.join(root,'web/ps1_spu.js'))}],
    ['/docs/generated/ps1_spu_wasm.js',{type:'text/javascript',body:await fs.readFile(path.join(root,'docs/generated/ps1_spu_wasm.js'))}],
    ['/docs/generated/ps1_spu_wasm.wasm',{type:'application/wasm',body:wasmBinary}],
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
  const report = {schemaVersion:1,passed:false,audioContextCreated:false,physicalAudio:false,
    wasmSha256:hash(wasmBinary),sampleRate:44100,voice:24,
    sources:await Promise.all(['scripts/check_ps1_spu_browser.cjs','web/ps1_spu.js','docs/generated/ps1_spu_wasm.js'].map(async file => {
      const bytes = await fs.readFile(path.join(root,file));
      return {path:file,bytes:bytes.length,sha256:hash(bytes)};
    })),
    method:'Real Node WASM baseline versus Window and DedicatedWorker, exact Float32 PCM plus independent pitch/stereo/lifecycle controls.',
    limits:['Standalone module only; no Playground mode, AudioWorklet scheduling, realtime deadlines, listening judgment or hardware-accuracy claim.'],engines:[]};
  try {
    for (const name of config.engines) {
      const browser = await ({chromium,webkit}[name]).launch({headless:true});
      try {
        const page = await browser.newPage(), errors = [], failures = [];
        page.on('pageerror',error => errors.push(error.stack || error.message));
        page.on('requestfailed',request => failures.push(request.url() + ': ' + request.failure()?.errorText));
        page.on('response',response => {if (response.status() >= 400) failures.push(response.url() + ': HTTP ' + response.status());});
        await page.addInitScript(() => {
          globalThis.__audioContextCalls = 0;
          for (const name of ['AudioContext','webkitAudioContext']) if (name in globalThis) {
            Object.defineProperty(globalThis,name,{configurable:true,value:class {
              constructor() {globalThis.__audioContextCalls++; throw Error('AudioContext creation is forbidden in standalone SPU verification');}
            }});
          }
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        for (const realm of ['Window','DedicatedWorker']) {
          const actual = await page.evaluate(async realm => {
            if (realm === 'Window') return (await import('/check_runner.mjs')).run();
            return new Promise((resolve,reject) => {
              const worker = new Worker('/check_worker.mjs',{type:'module'});
              const timer = setTimeout(() => {worker.terminate(); reject(Error('PS1 SPU worker timed out'));},30000);
              const finish = (error,result) => {clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve(result);};
              worker.onerror = error => finish(Error(error.message));
              worker.onmessage = ({data}) => finish(data.error ? Error(data.error) : null,data.result);
              worker.postMessage('run');
            });
          },realm);
          assert.deepEqual(actual,expected,`${name} ${realm}: exact PCM/register/RAM/lifecycle agreement`);
          report.engines.push({name,realm,passed:true,stereoFrames:8194,sampleComparisons:32776,
            loopStereoFrames:actual.loopRepeats.length*16384,loopSampleComparisons:actual.loopRepeats.length*16384*2,maximumDifference:0,
            crossings:actual.crossings,peak:actual.peak,
            pcmSha256:{normalLeft:pcmHash(actual.normalLeft),normalRight:pcmHash(actual.normalRight),
              doubledLeft:pcmHash(actual.doubledLeft),doubledRight:pcmHash(actual.doubledRight)},
            loopRepeats:actual.loopRepeats.map(({left,right,...row})=>({...row,pcmSha256:{left:pcmHash(left),right:pcmHash(right)}})),
            independentInstances:true,ramCopy:true,pitch:true,keyOff:true,resetRetainsRam:true,resetClearsRam:true,disposed:true});
          console.log(`PS1 SPU ${name} ${realm}: voice 24, 44,100 Hz, exact PCM and pitch/stereo/reset/dispose controls passed.`);
        }
        assert.equal(await page.evaluate(() => globalThis.__audioContextCalls),0,`${name}: no AudioContext creation`);
        assert.deepEqual(errors,[],`${name}: browser exceptions`);
        assert.deepEqual(failures,[],`${name}: network failures`);
      } finally {await browser.close();}
    }
    report.passed = true;
  } catch (error) {report.error = error.stack || String(error); throw error;}
  finally {
    await new Promise(resolve => server.close(resolve));
    if (config.out) {await fs.mkdir(path.dirname(config.out),{recursive:true}); await fs.writeFile(config.out,JSON.stringify(report,null,2) + '\n');}
  }
})().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
