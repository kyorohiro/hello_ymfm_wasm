// Run after build:fm2612, or pass an isolated installed tetorica-fm2612 directory.
// Uses the public direct factory with its default asset loading in every realm.
// PCM advances only through synchronous generateStereo* calls; no audio device
// or AudioContext / AudioWorklet is opened, and no timer drives the fixture.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {directory:path.join(repository, 'dist/fm2612'), engines:[], out:null};
let directoryProvided = false;
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--chromium' || argument === '--webkit') config.engines.push(argument.slice(2));
  else if (argument === '--out') {
    assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), '--out requires a path');
    config.out = path.resolve(process.argv[++index]);
  } else if (argument === '--help') {
    console.log('Usage: node scripts/check_wonderswan_factory_browser.cjs [PACKAGE_DIRECTORY] [--chromium] [--webkit] [--out REPORT.json]');
    process.exit(0);
  } else if (!argument.startsWith('--') && !directoryProvided) {
    config.directory = path.resolve(argument); directoryProvided = true;
  } else throw Error('Unknown argument: ' + argument);
}
if (!config.engines.length) config.engines = ['chromium', 'webkit'];
config.engines = [...new Set(config.engines)];

// Installed before dynamic imports, both in Window and in the real module Worker.
// Attempts are counted even if an imported module catches the thrown exception.
function installAudioGuards() {
  const attempts = [];
  for (const name of ['AudioContext','webkitAudioContext','OfflineAudioContext','webkitOfflineAudioContext','AudioWorkletNode']) {
    if (typeof globalThis[name] !== 'function') continue;
    const blocked = function () { attempts.push(name); throw Error('Audio API must not be used: ' + name); };
    Object.defineProperty(globalThis, name, {value:blocked, configurable:true});
    if (globalThis[name] !== blocked) throw Error('Failed to block ' + name);
  }
  if (globalThis.navigator?.mediaDevices?.getUserMedia) {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {configurable:true, value() {
      attempts.push('getUserMedia'); return Promise.reject(Error('Microphone must not be used'));
    }});
  }
  return attempts;
}

// The identical real-WASM fixture executes in Node, Window and DedicatedWorker.
async function runScenarios(createSoundChip, WonderSwanSynth, WonderSwanDirectTransport) {
  const check = (condition, label) => {if (!condition) throw Error(label);};
  const same = (left, right) => left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const equalPcm = (left, right) => same(left.left, right.left) && same(left.right, right.right);
  const packed = pcm => ({left:Array.from(pcm.left), right:Array.from(pcm.right)});
  const audible = pcm => pcm.left.some(value => value !== 0) || pcm.right.some(value => value !== 0);
  function program(chip) {
    const synth = new WonderSwanSynth({clock:chip.clock, transport:new WonderSwanDirectTransport(chip)});
    synth.initialize();
    const wave = Array.from({length:32}, (_, index) => (index * 7 + 3) & 15);
    synth.setWaveform(0, wave);
    wave.fill(0);
    check(chip.readMemory(0) === 0xa3 && chip.readMemory(1) === 0x81, 'Synth waveform must pack low nibble first and copy its input');
    synth.setWaveform(2, Array.from({length:32}, (_, index) => index < 16 ? 0 : 15));
    synth.setPan(0, 15, 2); synth.setPan(2, 3, 11);
    const hz = synth.setNote(0, 'A4');
    const effectiveClock = Math.floor(chip.clock / 128) * 128;
    const period = Math.round(effectiveClock / (32 * 440));
    check(hz === effectiveClock / (32 * period), 'Synth must use the factory-provided clock');
    const register = 2048 - period;
    check(chip.readRegister(0x80) === (register & 255) && chip.readRegister(0x81) === register >> 8,
      'Frequency registers must agree with the custom clock');
    synth.noteOn(2, 'E4'); synth.keyOn(0);
    const memory = Uint8Array.of(0x5a, 0xc3);
    chip.loadMemory(memory, 0x3ffe); memory.fill(0);
    check(chip.readMemory(0x3ffe) === 0x5a && chip.readMemory(0x3fff) === 0xc3, 'Factory core must copy RAM uploads');
    return synth;
  }
  const scenarios = [];
  for (const options of [{id:'factory-default'}, {id:'factory-custom', execution:'direct', clock:3200011, sampleRate:48000}]) {
    const chip = await createSoundChip('wonderswan', options);
    let synth;
    try {
      check(chip.clock === (options.clock ?? 3072000), 'Clock must be forwarded to the real core');
      check(chip.sampleRate() === (options.sampleRate ?? 44100), 'Sample rate must be forwarded to the real core');
      const descriptor = Object.getOwnPropertyDescriptor(chip, 'id');
      check(chip.id === options.id && descriptor.enumerable && !descriptor.writable && !descriptor.configurable,
        'Explicit factory ID must be enumerable and immutable');
      check(!Reflect.set(chip, 'id', 'changed') && chip.id === options.id, 'Stable ID must reject replacement');
      check(!audible(chip.generateStereo(64)), 'A direct cold core must remain silent');
      synth = program(chip);
      chip.reserveFrames(1024);
      const first = chip.generateStereo(1024), retained = packed(first);
      check(audible(first), 'Synth must produce nonzero PCM through the direct factory');
      check(first.left.every(Number.isFinite) && first.right.every(Number.isFinite), 'Factory PCM must be finite');
      check(first.left.some((value, index) => value !== first.right[index]), 'Fixture must exercise separate stereo paths');
      const intoLeft = new Float32Array(513), intoRight = new Float32Array(513);
      chip.generateStereoInto(intoLeft, intoRight);
      check(equalPcm(first, retained), 'Owned PCM must survive subsequent rendering');
      const second = packed({left:intoLeft, right:intoRight});
      const state = {registers:Array.from({length:32}, (_, index) => chip.readRegister(0x80 + index)),
        memory:Array.from({length:64}, (_, index) => chip.readMemory(index)),
        lastBytes:[chip.readMemory(0x3ffe),chip.readMemory(0x3fff)]};
      synth.dispose(); synth = null;
      check(audible(chip.generateStereo(64)), 'Direct transport must borrow rather than dispose the chip');
      chip.reset();
      check(!audible(chip.generateStereo(128)), 'Reset must silence output');
      check(chip.readMemory(0) === 0 && chip.readMemory(0x3fff) === 0, 'Reset must clear RAM');
      synth = program(chip);
      check(equalPcm(first, chip.generateStereo(1024)), 'Cold reinitialization must reproduce the exact PCM');
      scenarios.push({id:chip.id,clock:chip.clock,sampleRate:chip.sampleRate(),first:retained,second,state});
      chip.dispose(); chip.dispose();
      check(equalPcm(first, retained), 'Owned PCM must survive core disposal');
      for (const operation of [() => chip.sampleRate(), () => chip.readRegister(0x80),
        () => chip.writeMemory(0, 1), () => chip.generateStereo(1)]) {
        let rejected = false;
        try {operation();} catch (error) {rejected = /disposed/i.test(error.message);}
        check(rejected, 'Disposed factory core must reject access');
      }
      check(chip.id === options.id, 'Disposal must retain the stable chip ID');
    } finally {synth?.dispose(); chip.dispose();}
  }

  const a = await createSoundChip('wonderswan', {clock:3200011,sampleRate:48000});
  const b = await createSoundChip('wonderswan', {clock:3200011,sampleRate:48000});
  const reference = await createSoundChip('wonderswan', {clock:3200011,sampleRate:48000});
  let aSynth, referenceSynth;
  try {
    check(a !== b && a.id !== b.id && a.id !== reference.id && b.id !== reference.id,
      'Calls without explicit IDs must allocate independent instances and unique IDs');
    aSynth = program(a); referenceSynth = program(reference);
    b.writeMemory(0, 255); b.writeRegister(0x91, 8); b.writeRegister(0x88, 255); b.writeRegister(0x90, 1);
    check(a.readMemory(0) === 0xa3, 'RAM must not be shared between factory instances');
    b.generateStereo(777); b.dispose();
    const actual = a.generateStereo(257), expected = reference.generateStereo(257);
    check(audible(actual) && equalPcm(actual, expected), 'Rendering/disposal of another instance must not advance or change the active core');
    return {scenarios,independentInstances:true,automaticIdsUnique:true,disposedAccessRejected:true,
      borrowedTransport:true,independentPcm:packed(actual)};
  } finally {aSynth?.dispose(); referenceSynth?.dispose(); a.dispose(); b.dispose(); reference.dispose();}
}

const runnerSource = `const installAudioGuards=${installAudioGuards.toString()};
const runScenarios=${runScenarios.toString()};
export async function run(){
  const audioAttempts=installAudioGuards();
  const {createSoundChip}=await import('/package/soundchip.js');
  const {WonderSwanSynth,WonderSwanDirectTransport}=await import('/package/wonderswansynth.js');
  const result=await runScenarios(createSoundChip,WonderSwanSynth,WonderSwanDirectTransport);
  if(audioAttempts.length)throw Error('Unexpected audio API calls: '+audioAttempts.join(', '));
  return {result,audioAttempts};
}`;
const workerSource = `import {run} from '/factory-runner.mjs';
self.onmessage=async()=>{try{self.postMessage({value:await run()});}
catch(error){self.postMessage({error:error.stack||String(error)});}};`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pcmDigest = values => sha256(Buffer.from(new Float32Array(values).buffer));

(async () => {
  const packageMetadata = JSON.parse(await fs.readFile(path.join(config.directory, 'package.json'), 'utf8'));
  assert.equal(packageMetadata.name, 'tetorica-fm2612', 'Expected a built or installed tetorica-fm2612 package');
  const {createSoundChip} = await import(pathToFileURL(path.join(config.directory, 'soundchip.js')).href);
  const {WonderSwanSynth,WonderSwanDirectTransport} = await import(pathToFileURL(path.join(config.directory, 'wonderswansynth.js')).href);
  const expected = await runScenarios(createSoundChip,WonderSwanSynth,WonderSwanDirectTransport);
  const served = new Map();
  const server = http.createServer(async (request,response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (request.method !== 'GET') {response.writeHead(405).end(); return;}
      let bytes, contentType;
      if (pathname === '/favicon.ico') {response.writeHead(204).end(); return;}
      if (pathname === '/deeply/nested/application/index.html') {
        bytes = Buffer.from('<!doctype html><meta charset="utf-8"><title>Public WonderSwan factory verification</title>');
        contentType = 'text/html';
      } else if (pathname === '/factory-runner.mjs' || pathname === '/factory-worker.mjs') {
        bytes = Buffer.from(pathname === '/factory-runner.mjs' ? runnerSource : workerSource); contentType = 'text/javascript';
      } else {
        if (!pathname.startsWith('/package/')) {response.writeHead(404).end('Not found'); return;}
        const relative = decodeURIComponent(pathname.slice('/package/'.length));
        const filename = path.resolve(config.directory, relative);
        if (!filename.startsWith(config.directory + path.sep)) {response.writeHead(403).end(); return;}
        bytes = await fs.readFile(filename);
        contentType = filename.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
        const digest = sha256(bytes), previous = served.get(relative);
        if (previous && previous.sha256 !== digest) throw Error('Package source changed during browser verification: ' + relative);
        served.set(relative, {bytes:bytes.length,sha256:digest});
      }
      response.writeHead(200, {'Content-Type':contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(bytes);
    } catch (error) {response.writeHead(404, {'Content-Type':'text/plain'}).end(error.message);}
  });
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0, '127.0.0.1', resolve);});
  const report = {schemaVersion:1,passed:false,package:{name:packageMetadata.name,version:packageMetadata.version,directory:config.directory},
    method:'Default public createSoundChip asset loading; exact Float32 PCM/register/RAM comparison between Node, browser Window and real module DedicatedWorker.',
    audioContextCreated:false,audioWorkletCreated:false,physicalAudioDeviceOpened:false,engines:[],sources:{},
    limits:['Direct synchronous factory only; no real-time scheduling, physical listening or hardware-accuracy claim. Worker timeout bounds the test; no timer drives PCM.']};
  try {
    for (const name of config.engines) {
      const browser = await ({chromium,webkit}[name]).launch({headless:true});
      try {
        const page = await browser.newPage(), errors = [], failures = [], workers = [];
        page.on('pageerror', error => errors.push(error.stack || error.message));
        page.on('requestfailed', request => failures.push(request.url() + ': ' + request.failure()?.errorText));
        page.on('response', response => {if (response.status() >= 400) failures.push(response.url() + ': HTTP ' + response.status());});
        page.on('worker', worker => workers.push(worker.url()));
        await page.goto(`http://127.0.0.1:${server.address().port}/deeply/nested/application/index.html`);
        for (const realm of ['Window','DedicatedWorker']) {
          const actual = await page.evaluate(async realm => {
            if (realm === 'Window') return (await import('/factory-runner.mjs')).run();
            return new Promise((resolve,reject) => {
              const worker = new Worker('/factory-worker.mjs', {type:'module'});
              const timer = setTimeout(() => finish(Error('Public WonderSwan factory Worker timed out')), 30000);
              const finish = (error,value) => {clearTimeout(timer);worker.terminate();error ? reject(error) : resolve(value);};
              worker.onerror = event => finish(Error(event.message));
              worker.onmessage = ({data}) => finish(data.error ? Error(data.error) : null, data.value);
              worker.postMessage('run');
            });
          }, realm);
          assert.deepEqual(actual.audioAttempts, [], `${name} ${realm}: no audio constructors/device requests`);
          assert.deepEqual(actual.result, expected, `${name} ${realm}: exact Node reference PCM/register/RAM`);
          const stereoFrames = actual.result.scenarios.reduce((sum,scene) => sum + scene.first.left.length + scene.second.left.length, 0) + actual.result.independentPcm.left.length;
          report.engines.push({name,version:browser.version(),realm,passed:true,scenarios:actual.result.scenarios.length,
            stereoFrames,sampleComparisons:stereoFrames * 2,maximumDifference:0,audioAttempts:actual.audioAttempts,
            pcmSha256:actual.result.scenarios.map(scene => ({clock:scene.clock,sampleRate:scene.sampleRate,
              first:{left:pcmDigest(scene.first.left),right:pcmDigest(scene.first.right)},
              second:{left:pcmDigest(scene.second.left),right:pcmDigest(scene.second.right)}}))});
          console.log(`PASS: ${name} ${realm}: default/custom factory, Synth, RAM, independent instances and disposal; ${stereoFrames} exact stereo frames.`);
        }
        assert.equal(workers.length, 1, `${name}: exactly one real DedicatedWorker`);
        assert.deepEqual(errors, [], `${name}: no browser exceptions`);
        assert.deepEqual(failures, [], `${name}: no failed assets`);
      } finally {await browser.close();}
    }
    for (const required of ['soundchip.js','wonderswan.js','wonderswansynth.js','generated/wonderswan_wasm.js','generated/wonderswan_wasm.wasm']) {
      assert(served.has(required), 'Default browser loader must request packaged asset: ' + required);
    }
    assert.deepEqual([...served.keys()].filter(file => file.endsWith('_wasm.wasm')), ['generated/wonderswan_wasm.wasm'], 'No unrelated core WASM may load');
    report.sources = Object.fromEntries([...served].sort(([left],[right]) => left.localeCompare(right)));
    report.checkerSha256 = sha256(await fs.readFile(__filename));
    report.passed = true;
    if (config.out) await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
    console.log('WonderSwan public factory browser/module Worker verification passed; no audio device opened.');
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error.stack || error);process.exitCode = 1;});
