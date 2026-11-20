// PSG / OPLL timed-operation checks against an isolated installed npm consumer.
// No repository runtime imports or physical audio output are used.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const modules = ['segapsg', 'ym2413'].flatMap(chip =>
  ['operations', 'timed_state', 'timed_client', 'timed_processor'].map(name => `${chip}_${name}`));
const examples = ['README.md', 'browser.js', 'compile.mjs', 'index.html', 'playground.js']
  .map(name => 'examples/timed-registers/' + name);
export const SEGA_TIMED_REQUIRED_PACKAGE_FILES = Object.freeze([
  ...examples,
  ...modules.flatMap(name => [name + '.js', name + '.d.ts']),
  ...['playground_segapsg', 'playground_segapsg_audio', 'playground_segapsg_worklet',
    'playground_ym2413', 'playground_ym2413_audio', 'playground_ym2413_worklet',
    'playground_performance_sender'].flatMap(name => [name + '.js', name + '.d.ts']),
  'generated/segapsg_wasm.js', 'generated/segapsg_wasm.wasm',
  'generated/ym2413_wasm.js', 'generated/ym2413_wasm.wasm',
]);

export function assertSegaTimedPackageFiles(paths) {
  for (const name of SEGA_TIMED_REQUIRED_PACKAGE_FILES)
    assert(paths.has(name), 'PSG / OPLL timed npm payload missing ' + name);
}

export async function checkInstalledSegaTimedNode(consumer) {
  for (const name of modules) {
    assert.deepEqual(await readFile(join(consumer, 'node_modules/tetorica-fm2612', name + '.js')),
      await readFile(join(root, 'tetorica_src/runtime', name + '.js')),
      'Installed timed source must retain authored bytes for ' + name);
  }
  for (const name of examples) {
    assert.deepEqual(await readFile(join(consumer, 'node_modules/tetorica-fm2612', name)),
      await readFile(join(root, 'packages/fm2612', name)), 'Installed timed example must retain authored bytes for ' + name);
  }
  const destination = join(consumer, 'sega-timed-installed-check.mjs');
  await writeFile(destination, String.raw`
import assert from 'node:assert/strict';
import {createSegaPsgClient} from 'tetorica-fm2612/playground_segapsg.js';
import {createYm2413Client} from 'tetorica-fm2612/playground_ym2413';
import {createNativeGenesisMasterSystem} from 'tetorica-fm2612/native_genesis_master_system.js';
import {createNativeGenesisYm2413Endpoint} from 'tetorica-fm2612/native_genesis_extra_ym2413.js';

let fetches = 0, audioContexts = 0;
globalThis.fetch = () => {fetches++; throw Error('Local compiler requested network data');};
globalThis.AudioContext = class {constructor() {audioContexts++; throw Error('Local compiler created audio');}};
globalThis.webkitAudioContext = globalThis.AudioContext;
for (const [chip, title] of [['segapsg', 'Psg'], ['ym2413', 'Opll']]) {
  for (const suffix of ['operations', 'timed_state', 'timed_client', 'timed_processor']) {
    const js = await import('tetorica-fm2612/' + chip + '_' + suffix + '.js');
    const bare = await import('tetorica-fm2612/' + chip + '_' + suffix);
    assert.deepEqual(Object.keys(js), Object.keys(bare));
    for (const key of Object.keys(js)) assert.equal(js[key], bare[key], 'Extension and bare subpaths share ' + key);
  }
  const sent = [], make = chip === 'segapsg' ? createSegaPsgClient : createYm2413Client;
  const api = make({postMessage:message => sent.push(message), start() {}, close() {}}, {native:true});
  try {
    if (chip === 'segapsg') api.setAttenuation(0, 7);
    else api.setUserOperator(0, {ar:6, dr:3});
    const before = structuredClone(api._getState()), count = sent.length;
    let builds = 0;
    const plan = api.build(b => {
      builds++;
      if (chip === 'segapsg') {
        b.atSample(441).keyOn(0).keyOn(0);
        b.atSeconds(.02).setNoise({type:'white', rate:'tone3'});
      } else {
        b.atSample(441).setUserOperator(0, {dr:2}).setUserOperator(0, {dr:2});
        b.atSeconds(.02).keyOn(0).keyOn(0);
      }
    });
    assert.equal(builds, 1); assert.equal(sent.length, count);
    assert.deepEqual(structuredClone(plan), plan);
    const reset = await api.compile(plan, {initialState:'reset'});
    assert.equal(reset[0].offsetSeconds, .01);
    assert.equal(reset.at(-1).offsetSeconds, .02);
    assert.equal(reset[0].value, reset[1].value, 'Repeated writes remain present');
    if (chip === 'segapsg') {
      assert.deepEqual(reset.map(row => row.value), [0x90, 0x90, 0xe7]);
      await assert.rejects(api.compile(plan, {initialState:'client'}), /Incomplete PSG client state/);
    } else {
      const local = await api.compile(plan, {initialState:'client'});
      assert.deepEqual(local.map(row => [row.register, row.value]), [[4,0x62], [4,0x62], [32,16], [32,16]]);
      assert.deepEqual(reset.map(row => [row.register, row.value]), [[4,2], [4,2], [32,16], [32,16]]);
    }
    assert.deepEqual(api._getState(), before); assert.equal(sent.length, count);
    const operations = await import('tetorica-fm2612/' + chip + '_operations');
    const states = await import('tetorica-fm2612/' + chip + '_timed_state.js');
    const initial = operations['create' + title + 'OperationResetState']();
    const snapshot = states['create' + title + 'TimedSnapshot'](initial, {instanceId:'consumer-' + chip, frame:12, sampleRate:48000});
    const original = structuredClone(snapshot);
    assert.deepEqual(states['validate' + title + 'TimedSnapshot'](snapshot), snapshot);
    operations['compile' + title + 'Operations'](plan, snapshot.state);
    assert.deepEqual(snapshot, original);
    for (const call of [() => api.captureState(), () => api.compile(plan),
      () => api.schedule(plan, {name:'unsupported'}), () => api.clearSchedule('unsupported')])
      await assert.rejects(call(), /AudioWorklet.*Native/);
    assert.equal(sent.length, count, 'Unsupported Native operations reject before bridge traffic');
  } finally {api.dispose();}
}
const synth = {session:1, generation:1, clock:{sampleRate:48000}, stopping:false, closing:false,
  isReady:() => true, frameAt:seconds => Math.round(seconds * 48000), enqueue() {}, async flush() {},
  async nativeRequest() {throw Error('Local compile requested a Native snapshot');},
};
const native = createNativeGenesisMasterSystem(synth);
for (const endpoint of [native.segapsg, native.ym2413, createNativeGenesisYm2413Endpoint(synth)]) {
  assert.equal(typeof endpoint.client.build, 'function');
  const plan = endpoint.client.build(b => b.keyOn(0));
  assert((await endpoint.client.compile(plan, {initialState:'reset'})).length);
  await assert.rejects(endpoint.client.captureState(), /AudioWorklet.*Native/);
}
const example = await import('./node_modules/tetorica-fm2612/examples/timed-registers/compile.mjs');
const demonstrated = example.runCompileExample();
assert.equal(demonstrated.psgWrites.length, 8); assert.equal(demonstrated.opllWrites.length, 21);
assert.equal(demonstrated.comparison.length, 1);
assert.equal(fetches, 0); assert.equal(audioContexts, 0);
console.log('Installed PSG / OPLL timed APIs: npm subpaths, detached recorder/state, compiler baselines, repeated writes and explicit Native limits verified; no audio device.');
`);
  execFileSync(process.execPath, [destination], {cwd:consumer, stdio:'inherit'});
  const exampleOutput = execFileSync(process.execPath, [join(consumer, 'node_modules/tetorica-fm2612/examples/timed-registers/compile.mjs')], {cwd:consumer, encoding:'utf8'});
  assert.match(exampleOutput, /Sega PSG command bytes/);
  assert.match(exampleOutput, /YM2413 address\/value writes/);
  await checkInstalledSegaTimedTypes(consumer);
}


async function checkInstalledSegaTimedTypes(consumer) {
  const filename = 'sega-timed-public-usage.mts';
  await writeFile(join(consumer, filename), String.raw`
import {buildPsgOperations,compilePsgOperations,createPsgOperationResetState} from 'tetorica-fm2612/segapsg_operations.js';
import {buildOpllOperations,compileOpllOperations,createOpllOperationResetState} from 'tetorica-fm2612/ym2413_operations.js';
import {createSegaPsgClient} from 'tetorica-fm2612/playground_segapsg.js';
import {createYm2413Client} from 'tetorica-fm2612/playground_ym2413.js';
import {createNativeGenesisSegaPsg} from 'tetorica-fm2612/native_genesis_segapsg.js';
import {createNativeGenesisOpll} from 'tetorica-fm2612/native_genesis_opll.js';
import {createNativeGenesisYm2413Endpoint} from 'tetorica-fm2612/native_genesis_extra_ym2413.js';
import type {PsgOperationRecorder} from 'tetorica-fm2612/segapsg_operations.js';
import type {OpllOperationRecorder} from 'tetorica-fm2612/ym2413_operations.js';
const psg=createSegaPsgClient(null,{instanceId:'psg',stereoEnabled:true});
const opll=createYm2413Client(null,{instanceId:'opll'});
const pulse=buildPsgOperations((b:PsgOperationRecorder)=>b.noteOn(0,'C4').atSample(4410).off(0));
const bell=buildOpllOperations((b:OpllOperationRecorder)=>b.setUserOperator(0,{tl:20}).noteOn(8,'C4').noteOff(8));
const psgWrites=compilePsgOperations(pulse,createPsgOperationResetState());
const opllWrites=compileOpllOperations(bell,createOpllOperationResetState());
await psg.schedule(pulse,{name:'pulse'});await opll.schedule(bell,{name:'bell'});
const psgSnapshot=await psg.captureState(),opllSnapshot=await opll.captureState();
await psg.compile(pulse,{initialState:psgSnapshot});await opll.compile(bell,{initialState:opllSnapshot});
for(const row of psgWrites){if('stereo'in row){const mask:number=row.stereo;void mask;}else{const value:number=row.value;void value;}}
const address:number=opllWrites[0].register;void address;
createNativeGenesisSegaPsg(null).client.compile(pulse,{initialState:'reset'});
createNativeGenesisOpll(null).client.compile(bell,{initialState:'client'});
createNativeGenesisYm2413Endpoint(null).client.compile(bell,{initialState:'reset'});
// @ts-expect-error Carrier TL belongs to per-channel attenuation.
buildOpllOperations(b=>b.setUserOperator(1,{tl:20}));
// @ts-expect-error Plain recorder arguments only.
buildOpllOperations(b=>b.setUserPatch(new Uint8Array(8)));
// @ts-expect-error Plain nested recorder arguments only.
buildOpllOperations(b=>b.setPreset(0,{userPatch:new Uint8Array(8)}));
// @ts-expect-error Nine melody channels.
buildOpllOperations(b=>b.noteOn(9,'C4'));
// @ts-expect-error Three tone channels.
buildPsgOperations(b=>b.noteOn(3,'C4'));
// @ts-expect-error Synchronous build callbacks only.
buildPsgOperations(async b=>b.off(0));
// @ts-expect-error Synchronous build callbacks only.
buildOpllOperations(async b=>b.noteOff(0));
// @ts-expect-error Wrong-chip snapshot.
await psg.compile(pulse,{initialState:opllSnapshot});
// @ts-expect-error Named reservations required.
await opll.schedule(bell,{});
// @ts-expect-error Native clients retain precise recorder signatures.
createNativeGenesisOpll(null).client.build(b=>b.setUserOperator(1,{tl:20}));
// @ts-expect-error Carrier TL is invalid inside a recorded shared patch as well.
buildOpllOperations(b=>b.setUserPatch({operators:[{tl:3},{tl:6}]}));
// @ts-expect-error Nested preset patch retains the same carrier restriction.
buildOpllOperations(b=>b.setPreset(0,{userPatch:{operators:[{}, {tl:6}]}}));
`);
  for (const resolution of ['NodeNext', 'Bundler']) {
    const config = join(consumer, 'sega-timed-tsconfig.json');
    await writeFile(config, JSON.stringify({compilerOptions:{
      strict:true, noEmit:true, skipLibCheck:false, target:'ES2022',
      module:resolution === 'NodeNext' ? 'NodeNext' : 'ESNext', moduleResolution:resolution,
      lib:['ES2022', 'DOM'], types:['node'], typeRoots:[join(root, 'node_modules/@types')],
    }, files:[filename]}));
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], {cwd:consumer, stdio:'inherit'});
  }
  console.log('Installed Sega timed examples: exact unchanged Node example (8 / 21 writes), strict positive / negative emitted-type consumers in NodeNext and Bundler verified.');
}

// Keep all physical destinations behind a permanent software-zero gate, even
// if a future runtime accidentally chooses its default output destination.
function mutePhysicalDestinations() {
  const connect = AudioNode.prototype.connect, gates = new WeakMap();
  globalThis.__segaPhysicalMutes = [];
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...args);
    let gate = gates.get(this.context);
    if (!gate) {
      gate = this.context.createGain(); gate.gain.value = 0;
      gates.set(this.context, gate); globalThis.__segaPhysicalMutes.push(gate);
      connect.call(gate, destination);
    }
    connect.call(this, gate, ...args); return destination;
  };
}

function score(chip) {
  return `
const voice = await useSoundChip(${JSON.stringify(chip)});
${chip === 'ym2413' ? 'voice.setVoice(0,{instrument:1,attenuation:4});' : ''}
const snapshot = await voice.captureState();
context.segaSnapshot = snapshot;
context.segaSnapshotJson = JSON.stringify(snapshot);
const plan = voice.build(b => {
  ${chip === 'ym2413' ? 'b.setVoice(0,{instrument:1,attenuation:4});' : 'b.setAttenuation(0,4);'}
  b.atSample(441).noteOn(0,'A4');
  b.atSeconds(.02).keyOn(0);
});
context.segaPlan = plan;
const rows = await voice.compile(plan);
const reset = await voice.compile(plan,{initialState:'reset'});
const reused = await voice.compile(plan,{initialState:snapshot});
const again = await voice.compile(plan,{initialState:snapshot});
if(JSON.stringify(reused)!==JSON.stringify(again)) throw Error('Snapshot reuse is not repeatable');
if(JSON.stringify(snapshot)!==context.segaSnapshotJson) throw Error('Compile changed the input snapshot');
${chip === 'ym2413' ? "if(!(await voice.compile(plan,{initialState:'client'})).length) throw Error('Missing complete OPLL client baseline');" : "let incomplete=false;try{await voice.compile(plan,{initialState:'client'});}catch(error){incomplete=/Incomplete PSG client state/.test(error.message);}if(!incomplete)throw Error('Incomplete PSG client baseline was accepted');"}
await voice.schedule(plan,{name:'npm-sega',repeatSeconds:.04});
const result = {chip:${JSON.stringify(chip)},sampleRate:snapshot.sampleRate,compiledWrites:rows.length,resetWrites:reset.length,offset:rows.at(-1).offsetSeconds};
`;
}

async function bounded(promise, label, timeout = 30000) {
  let timer;
  try {return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(label + ' timed out')), timeout);
  })]);} finally {clearTimeout(timer);}
}

/** Real installed Playground Main / Worker, WASM and Worklets, always muted.
 * Opt-in from the package checker; no broad app/browser suite is launched.
 */
export async function checkInstalledSegaTimedBrowser(consumer, {engines = ['chromium', 'webkit'], rates = [44100, 48000]} = {}) {
  assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)), 'Choose Chromium / WebKit');
  assert(rates.length && rates.every(rate => [44100, 48000].includes(rate)), 'Choose 44100 / 48000 Hz');
  const {chromium, webkit} = await import('playwright');
  const installed = resolve(consumer, 'node_modules/tetorica-fm2612');
  const prefix = '/nested/consumer/node_modules/tetorica-fm2612/';
  const served = new Set(), failedRequests = [], cases = [], started = Date.now();
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/') {response.writeHead(200, {'Content-Type':'text/html'}).end('<!doctype html><button id="start">Initialize muted audio</button>'); return;}
      if (pathname === '/favicon.ico') {response.writeHead(204).end(); return;}
      assert(pathname.startsWith(prefix), 'Only installed package files are served');
      const relative = pathname.slice(prefix.length), file = resolve(installed, relative);
      assert(file.startsWith(installed + sep), 'Invalid package path');
      const bytes = await readFile(file); served.add(relative);
      response.writeHead(200, {'Content-Type':extname(file) === '.wasm' ? 'application/wasm' : extname(file) === '.json' ? 'application/json' : 'text/javascript', 'Cache-Control':'no-store'}).end(bytes);
    } catch (error) {failedRequests.push({path:request.url, error:error.message}); response.writeHead(404).end(error.message);}
  });
  await new Promise((yes, no) => {server.once('error', no); server.listen(0, '127.0.0.1', yes);});
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const name of engines) {
      const browser = await ({chromium, webkit}[name]).launch({headless:true,
        ...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required', '--mute-audio']} : {})});
      try {
        for (const rate of rates) for (const chip of ['segapsg', 'ym2413']) for (const execution of ['main', 'worker']) {
          const page = await browser.newPage({serviceWorkers:'block'}), errors = [], external = [];
          page.setDefaultTimeout(20000);
          page.on('pageerror', error => errors.push(error.message));
          await page.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
            external.push(url.href); return route.abort();
          });
          await page.addInitScript(mutePhysicalDestinations);
          try {
            await page.goto(origin);
            await page.evaluate(async ({prefix, chip, rate}) => {
              const {NativeRuntimeSynth} = await import(prefix + 'native_runtime_synth.js');
              const {createPlaygroundRuntime} = await import(prefix + 'playground_runtime.js');
              document.querySelector('#start').onclick = () => {
                window.__segaStart = (async () => {
                  const context = new AudioContext({sampleRate:rate});
                  const synth = new NativeRuntimeSynth({chip, audioContext:context});
                  const logs = [], runtime = createPlaygroundRuntime({synth, guardExecution:true, onLog:line => logs.push(line)});
                  window.__segaCheck = {context, runtime, logs};
                  await runtime.initialize();
                  const analyser = context.createAnalyser(), monitorMute = context.createGain();
                  analyser.fftSize = 2048; monitorMute.gain.value = 0;
                  analyser.connect(monitorMute); monitorMute.connect(context.destination);
                  const detach = runtime.megaDrive.audio.connectOutputMonitor(analyser);
                  Object.assign(window.__segaCheck, {analyser, monitorMute, detach});
                })();
                window.__segaStart.catch(() => {});
              };
            }, {prefix, chip, rate});
            await page.click('#start');
            await bounded(page.evaluate(() => window.__segaStart), `${name}/${chip}/${execution} initialize`);
            let serial = 0;
            const run = async source => {
              const marker = `NPM_SEGA_${++serial}:`;
              await bounded(page.evaluate(async ({source, marker, execution}) => {
                await window.__segaCheck.runtime.playSource(source + `\nconsole.log(${JSON.stringify(marker)}+JSON.stringify(result));`, {execution});
              }, {source, marker, execution}), `${name}/${chip}/${execution} Run`);
              return page.evaluate(marker => {
                const line = window.__segaCheck.logs.find(line => line.includes(marker));
                if (!line) throw Error('Missing completed npm Run result');
                return JSON.parse(line.slice(line.indexOf(marker) + marker.length));
              }, marker);
            };
            const first = await run(score(chip));
            assert.equal(first.sampleRate, rate); assert(first.compiledWrites >= 3 && first.resetWrites >= 3);
            assert.equal(first.offset, .02);
            const waitSignal = async silent => {
              try {await page.waitForFunction(silent => {
                const audit = window.__segaCheck, pcm = new Float32Array(audit.analyser.fftSize);
                audit.analyser.getFloatTimeDomainData(pcm);
                if (!pcm.every(Number.isFinite)) throw Error('Non-finite installed PCM');
                const peak = pcm.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
                const minimum = pcm.reduce((min, value) => Math.min(min, value), Infinity);
                const maximum = pcm.reduce((max, value) => Math.max(max, value), -Infinity);
                return silent ? peak < 1e-8 : maximum - minimum > .0001;
              }, silent);} catch (error) {
                const diagnostics = await page.evaluate(async () => {
                  const audit = window.__segaCheck, inspector = audit.runtime.chipInspector;
                  const pcm = new Float32Array(audit.analyser.fftSize); audit.analyser.getFloatTimeDomainData(pcm);
                  return {peak:pcm.reduce((max,value)=>Math.max(max,Math.abs(value)),0),state:audit.runtime.getState(),
                    chips:await Promise.all(inspector.list().map(async endpoint=>({id:endpoint.id,state:await inspector.read(endpoint.id)}))), logs:audit.logs.slice(-3)};
                });
                throw new Error(`${name}/${chip}/${execution} expected ${silent?'silence':'signal'}: ${JSON.stringify(diagnostics)}`, {cause:error});
              }
            };
            await waitSignal(false);
            const live = await run(`
const voice=await useSoundChip(${JSON.stringify(chip)});
const state=await voice.captureState();
if(state.frame<=context.segaSnapshot.frame)throw Error('Installed audio timeline did not advance');
if(JSON.stringify(context.segaSnapshot)!==context.segaSnapshotJson)throw Error('Live rendering changed captured snapshot');
const reused=await voice.compile(context.segaPlan,{initialState:context.segaSnapshot});
if(!reused.length)throw Error('Reused snapshot lost its compiler output');
const cleared=await voice.clearSchedule('npm-sega');
if(!cleared)throw Error('Named schedule was not cleared');
const result={frame:state.frame,reusedWrites:reused.length,cleared};
`);
            assert(live.cleared && live.frame > 0); await waitSignal(true);
            await run(`const voice=await useSoundChip(${JSON.stringify(chip)});await voice.schedule(context.segaPlan,{name:'npm-stop',repeatSeconds:.04});const result={scheduled:true};`);
            await waitSignal(false);
            await bounded(page.evaluate(() => window.__segaCheck.runtime.stopWithFade()), `${name}/${chip}/${execution} Stop`);
            await waitSignal(true);
            const muted = await page.evaluate(() => __segaPhysicalMutes.length > 0 && __segaPhysicalMutes.every(gate => gate.gain.value === 0));
            assert(muted, 'Every physical output retains permanent zero gain');
            await page.evaluate(async () => {
              const audit = window.__segaCheck;
              audit.detach(); audit.analyser.disconnect(); audit.monitorMute.disconnect();
              await audit.runtime.finalize();
              if (audit.context.state !== 'closed') await audit.context.close();
            });
            assert.deepEqual(errors, []); assert.deepEqual(external, []);
            const row = {browser:name, chip, execution, sampleRate:rate, compiledWrites:first.compiledWrites,
              snapshotReusable:true, cleared:true, stopSilent:true, physicalMuted:true};
            cases.push(row); console.log(`Installed Sega timed: ${name} ${chip} ${execution} ${rate} passed (muted)`);
          } finally {await page.close();}
        }
      } finally {await browser.close();}
    }
    assert.deepEqual(failedRequests, [], 'Installed package must supply every module / WASM / Worker URL');
    for (const chip of ['segapsg', 'ym2413']) for (const suffix of ['operations', 'timed_state', 'timed_client', 'timed_processor'])
      assert(served.has(`${chip}_${suffix}.js`), 'Browser did not load installed module ' + chip + '_' + suffix);
    assert(served.has('playground_logic_worker.js'), 'Real packaged Worker was not used');
    return {passed:true, elapsedMs:Date.now() - started, cases, servedFiles:served.size};
  } catch (error) {
    if (failedRequests.length) throw new Error(error.message + '\nInstalled package requests: ' + JSON.stringify(failedRequests), {cause:error});
    throw error;
  } finally {await new Promise(yes => server.close(yes));}
}
