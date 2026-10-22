import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createNativeWorkerApis} from './playground_native_primary.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {createPerformanceSender} from './playground_performance_sender.js';

const CHIPS = ['ym3526', 'ym3812', 'ymf262'];
const address = channel => (channel >= 9 ? 256 : 0) + 0xb0 + channel % 9;
async function until(predicate) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Native OPL loop did not start');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
function fixture(chip) {
  const calls = [], commands = [], errors = [];
  const state = {chip, clock: chip === 'ymf262' ? 14318180 : 3579545,
    registers: Array(chip === 'ymf262' ? 512 : 256).fill(0), status: 0, irq: false,
    held: [], pendingCommands: [], sourceMuteMask: 0, sampleRate: 48000};
  const status = () => ({session: 1, mode: chip, sampleRate: 48000, frame: 0,
    ymClock: state.clock, psgClock: 0, running: true});
  const snapshot = () => ({[chip]: structuredClone(state), sampleRate: 48000, frame: 0, revision: commands.length});
  function stop() {
    state.held.length = 0;
    for (let ch = 0; ch < (chip === 'ymf262' ? 18 : 9); ch++) state.registers[address(ch)] &= 223;
    state.registers[0xbd] &= 224;
  }
  function apply(message) {
    if (message.method === 'batch') {
      if (message.action === 'on' && !state.held.includes(message.channel)) state.held.push(message.channel);
      for (const c of message.commands) apply(c);
      if (message.action === 'off') state.held = state.held.filter(ch => ch !== message.channel);
      return;
    }
    if (message.method === 'write') state.registers[message.register] = message.value;
    else if (message.method === 'clock') state.clock = message.hz;
    else if (message.method === 'key-off') {
      if (message.channel >= 18) state.registers[0xbd] &= ~(16 >> (message.channel - 18));
      else {
        state.registers[address(message.channel)] &= 223;
        if ([0, 1, 2, 9, 10, 11].includes(message.channel) && state.registers[0x104] & (1 << [0, 1, 2, 9, 10, 11].indexOf(message.channel))) state.registers[address(message.channel + 3)] &= 223;
      }
    } else if (message.method === 'audition-key-on') state.registers[address(message.channel)] |= 32;
    else if (message.method === 'stop-voices') stop();
    else if (message.method === 'reset') state.registers.fill(0);
  }
  const invoke = async (command, args) => {
    calls.push({command, args});
    if (command === 'native_genesis_commands') {
      if (state.held.length && args.commands.some(c => c.type === 'opl' && c.message.method === 'clock')) throw new Error('Release the manually held OPL voices before changing the clock');
      for (const c of args.commands) {
      commands.push(c);
      assert(!['write', 'psg-write', 'psg-stereo', 'reset', 'msx', 'master-system', 'x68000', 'ym2608', 'ym2610b'].includes(c.type), 'DOS PC has only its selected OPL');
      if (c.type === 'opl') { assert.equal(c.message.chip, chip); apply(c.message); }
      }
    }
    if (command === 'native_genesis_stop') stop();
    if (command === 'native_genesis_opl_status') return snapshot();
    return status();
  };
  return {synth: new NativeGenesisSynth({mode: chip, invoke, now: () => 0, onError: error => errors.push(error)}),
    calls, commands, errors, state, snapshot};
}

for (const chip of CHIPS) {
  test(`Native ${chip} Main borrows its selected OPL with no Genesis graph`, async t => {
    const previous = globalThis.window; globalThis.window = {setTimeout, clearTimeout};
    const f = fixture(chip), runtime = createPlaygroundRuntime({synth: f.synth, guardExecution: false});
    t.after(async () => { await runtime.finalize(); globalThis.window = previous; delete globalThis.oplNativeResult; });
    await runtime.playSource(`
      if (await useSoundChip('${chip}') !== opl) throw Error('Selected primary was not reused');
      opl.setPreset(0, {algorithm:1,feedback:3,operators:[{mul:2,tl:21,ar:15,rr:5},{mul:1,tl:4,ar:15,rr:6}]});
      opl.setOperator(0, 1, {vibrato:true});
      ${chip === 'ymf262' ? "opl.setPreset(9,{fourOp:true,algorithm:3,pan:{left:true,right:false},operators:[{mul:2},{mul:1},{mul:3},{tl:4}]});opl.noteOn(9,'E4');" : ''}
      opl.noteOn(0, 'A4');
      opl.setRhythm({enabled:true,bassDrum:true,snare:true,hiHat:true});
      await opl.setClock(${chip === 'ymf262' ? 14000000 : 4000000});
      await mixer.set(opl.id, {volume:.6,pan:-.2});
      globalThis.oplNativeResult = {id:opl.id,clock:opl.clock,fmType:typeof fm,psgType:typeof psg};
    `);
    await f.synth.flush();
    assert.deepEqual(globalThis.oplNativeResult, {id: chip, clock: chip === 'ymf262' ? 14000000 : 4000000, fmType: 'undefined', psgType: 'undefined'});
    assert.equal(f.state.registers[0x20] & 15, 2); assert.equal(f.state.registers[0x43] & 63, 4);
    assert.equal(f.state.registers[0xbd] & 63, 57); assert(f.state.registers[0xb0] & 32);
    if (chip === 'ymf262') { assert(f.state.registers[0x104] & 8); assert.equal(f.state.registers[0x1c0] & 48, 16); assert(f.state.registers[0x1b0] & 32); }
    assert.equal(f.synth.fm, null); assert.equal(f.synth.psg, null); assert.equal(f.synth.audioContext, null); assert.equal(f.synth.node, null);
    assert.equal(f.synth[chip], f.synth.opl);
    for (const other of CHIPS.filter(name => name !== chip)) assert.equal(f.synth[other], null);
    assert.deepEqual(f.synth.mixer.list().filter(c => c.connected).map(c => c.id), [chip]);
    assert.deepEqual(f.synth.chipInspector.list().map(c => c.id), [chip]);
    const patch = f.state.registers[0x43]; await runtime.stopWithFade();
    assert.equal(f.state.registers[0x43], patch); assert.equal(f.state.registers[0xbd] & 63, 32); assert.equal(f.state.registers[0xb0] & 32, 0);
    assert.equal(f.synth.opl._getState().registers[0xb0] & 32, 0); assert.deepEqual(f.errors, []);
  });

  test(`Native ${chip} real Worker bridge preserves selected ports, bank writes, timing and Stop`, async () => {
    const f = fixture(chip); await f.synth.start(); f.commands.length = 0;
    const bridge = createNativeGenesisWorkerBridge({synth: f.synth, MessageChannelClass: MessageChannel, onError: error => f.errors.push(error)});
    const host = createPerformanceHost({getContext: () => ({currentTime: 0, state: 'running'})});
    try {
      const clock = await host.start([bridge.port], .25);
      const sender = createPerformanceSender({leaseUntimed: true, now: () => clock.performanceEpochMs}); sender.configure(clock);
      assert(bridge[`${chip}Port`]);
      for (const other of CHIPS.filter(name => name !== chip)) assert.equal(bridge[`${other}Port`], null);
      assert.equal(bridge.segapsgPort, null); assert.equal(bridge.ym2413Port, null); assert.equal(bridge.ay8910Port, null);
      const observed = [];
      const worker = createNativeWorkerApis([{name: chip, globalName: 'opl', port: bridge[`${chip}Port`], state: f.synth.opl._getState()}], sender,
        (name, state) => { observed.push({name, state}); f.synth.opl._adoptState(state); });
      const api = worker.apis.opl;
      assert.equal(api.id, chip); assert.equal(api.channels, chip === 'ymf262' ? 18 : 9);
      api.setOperator(0, 1, {mul: 3, tl: 7}); api.noteOn(0, 'A4');
      if (chip === 'ymf262') { api.setFourOp(9, true); api.setOperator(9, 3, {mul: 4, tl: 5}); api.noteOn(9, 'E4'); api.writeRegister(0x1c0, 0x11); }
      api.setRhythm({enabled: true, bassDrum: true, snare: true, tom: true, cymbal: true, hiHat: true});
      await api.setClock(chip === 'ymf262' ? 14000000 : 4000000);
      assert.equal(f.state.registers[0x23] & 15, 3); assert.equal(f.state.registers[0x43] & 63, 7);
      assert.equal(f.state.registers[0xbd] & 63, 63);
      if (chip === 'ymf262') { assert.equal(f.state.registers[0x12b] & 15, 4); assert.equal(f.state.registers[0x14b] & 63, 5); assert.equal(f.state.registers[0x1c0], 0x11); }
      const writes = f.commands.filter(c => c.type === 'opl' && c.message.method === 'write');
      assert(writes.length > 0); assert(writes.every(c => c.frame === 12000 && c.performance === clock.session && c.owner > 0));
      assert(observed.some(event => event.name === 'opl' && event.state.chip === chip));
      await worker.stop(); assert.equal(f.state.registers[0xbd] & 63, 32);
      for (let ch = 0; ch < api.channels; ch++) assert.equal(f.state.registers[address(ch)] & 32, 0);
      assert.equal(f.state.registers[0x43] & 63, 7); assert.deepEqual(f.errors, []);
    } finally { host.stop(); await bridge.dispose(); await f.synth.close(); }
  });

  test(`Native ${chip} Main loop cleanup releases only its high-level rhythm owners`, async t => {
    const previous = globalThis.window; globalThis.window = {setTimeout, clearTimeout};
    const f = fixture(chip), runtime = createPlaygroundRuntime({synth: f.synth, guardExecution: false});
    t.after(async () => { await runtime.finalize(); globalThis.window = previous; });
    await runtime.playSource(`
      opl.setRhythm({enabled:true});
      liveLoop('drums',async()=>{opl.setRhythm({snare:true,hiHat:true});await sleep(60);});
    `);
    await until(() => (f.synth.opl.getRegisterSnapshot()[0xbd] & 9) === 9);
    await f.synth.flush(); const before = f.commands.length;
    await runtime.playSource(`opl.setRhythm({bassDrum:true});stopLoop('drums');`);
    await f.synth.flush();
    assert.equal(f.state.registers[0xbd] & 63, 48);
    assert.deepEqual(f.commands.slice(before).filter(c => c.type === 'opl' && c.message.method === 'key-off').map(c => c.message.channel).sort((a, b) => a - b), [19, 22]);
    assert.equal(f.synth.opl._getState().registers[0xbd] & 63, 48);

    await runtime.playSource(`liveLoop('old',async()=>{opl.setRhythm({snare:true});await sleep(60);});`);
    await until(() => !!(f.synth.opl.getRegisterSnapshot()[0xbd] & 8)); await f.synth.flush();
    const replacement = f.commands.length;
    await runtime.playSource(`opl.setRhythm({snare:true});stopLoop('old');`); await f.synth.flush();
    assert.equal(f.state.registers[0xbd] & 8, 8);
    assert(!f.commands.slice(replacement).some(c => c.type === 'opl' && c.message.method === 'key-off' && c.message.channel === 19), 'retired loop must not stop the replacement drum');
    assert.deepEqual(f.errors, []);
  });

  test(`Native ${chip} Main raw BD loop releases its five owned drum triggers`, async t => {
    const previous = globalThis.window; globalThis.window = {setTimeout, clearTimeout};
    const f = fixture(chip), runtime = createPlaygroundRuntime({synth: f.synth, guardExecution: false});
    t.after(async () => { await runtime.finalize(); globalThis.window = previous; });
    await runtime.playSource(`liveLoop('raw-drums',async()=>{opl.writeRegister(0xbd,0x3f);await sleep(60);});`);
    await until(() => (f.synth.opl.getRegisterSnapshot()[0xbd] & 63) === 63); await f.synth.flush();
    const before = f.commands.length;
    await runtime.playSource(`stopLoop('raw-drums');`); await f.synth.flush();
    assert.equal(f.state.registers[0xbd] & 63, 32);
    assert.deepEqual(f.commands.slice(before).filter(c => c.type === 'opl' && c.message.method === 'key-off').map(c => c.message.channel).sort((a, b) => a - b), [18, 19, 20, 21, 22]);
    assert.deepEqual(f.errors, []);
  });

  test(`Native ${chip} Main and Worker clock controls reject held edits without adopting them`, async () => {
    const f = fixture(chip); await f.synth.start();
    await f.synth.nativeOpl.invoke('auditionOn', [0, 69, 'held']);
    const baseClock = f.synth.opl.clock;
    f.synth.opl.setOperator(1, 1, {tl: 11});
    await assert.rejects(f.synth.opl.setClock(4000000), /held/); assert.equal(f.synth.opl.clock, baseClock);
    assert.equal(f.synth.isReady(), true); assert.equal(f.state.registers[0x44] & 63, 11);
    f.synth.opl.noteOn(1, 'A4'); await f.synth.flush(); assert(f.state.registers[0xb1] & 32);
    const bridge = createNativeGenesisWorkerBridge({synth: f.synth, MessageChannelClass: MessageChannel, onError: error => f.errors.push(error)});
    const host = createPerformanceHost({getContext: () => ({currentTime: 0, state: 'running'})});
    try {
      const clock = await host.start([bridge.port], .25), sender = createPerformanceSender({leaseUntimed: true, now: () => clock.performanceEpochMs}); sender.configure(clock);
      const worker = createNativeWorkerApis([{name: chip, globalName: 'opl', port: bridge[`${chip}Port`], state: f.synth.opl._getState()}], sender, () => {});
      await assert.rejects(worker.apis.opl.setClock(4000000), /held/); assert.equal(worker.apis.opl.clock, baseClock); assert.equal(f.synth.opl.clock, baseClock);
      await f.synth.nativeOpl.invoke('auditionOff', [0, 'held']);
      await worker.apis.opl.setClock(4000000); assert.equal(worker.apis.opl.clock, 4000000); assert.equal(f.synth.opl.clock, 4000000);
      assert.equal(f.state.clock, 4000000); assert(f.calls.some(c => c.command === 'native_genesis_opl_status' && Number.isSafeInteger(c.args.after)));
    } finally { host.stop(); await bridge.dispose(); await f.synth.close(); }
  });
}

test('Native OPL3 bank 1 BD is not rhythm while explicit-bank B0 owns its melodic channel', async t => {
  const previous = globalThis.window; globalThis.window = {setTimeout, clearTimeout};
  const f = fixture('ymf262'), runtime = createPlaygroundRuntime({synth: f.synth, guardExecution: false});
  t.after(async () => { await runtime.finalize(); globalThis.window = previous; });
  await runtime.playSource(`
    opl.setRhythm({enabled:true,bassDrum:true});
    liveLoop('banked',async()=>{opl.writeRegister(0xbd,0x3f,1);opl.writeRegister(0xb0,0x20,1);await sleep(60);});
  `);
  await until(() => f.synth.opl.getRegisterSnapshot()[0x1b0] === 32); await f.synth.flush();
  const before = f.commands.length;
  await runtime.playSource(`stopLoop('banked');`); await f.synth.flush();
  assert.equal(f.state.registers[0x1b0] & 32, 0); assert.equal(f.state.registers[0xbd] & 63, 48);
  assert.deepEqual(f.commands.slice(before).filter(c => c.type === 'opl' && c.message.method === 'key-off').map(c => c.message.channel), [9]);
  assert.deepEqual(f.errors, []);
});

const HELD_CLOCK_ERROR = 'Release the manually held OPL voices before changing the clock';
for (const scenario of [
  {name: 'non-clock batch with the held-clock text', methods: ['write'], error: HELD_CLOCK_ERROR},
  {name: 'mixed clock and note batch with the held-clock text', methods: ['clock', 'write'], error: HELD_CLOCK_ERROR},
  {name: 'clock-only batch with an unrelated device error', methods: ['clock'], error: 'Native audio device disconnected'},
]) test(`Native OPL keeps ${scenario.name} fatal`, async t => {
  const f = fixture('ym3812'); await f.synth.start(); t.after(() => f.synth.close());
  const invoke = f.synth.invoke;
  f.synth.invoke = (command, args) => command === 'native_genesis_commands'
    ? Promise.reject(new Error(scenario.error)) : invoke(command, args);
  const commands = scenario.methods.map(method => ({type: 'opl', frame: 0, message: {chip: 'ym3812', method,
    ...(method === 'clock' ? {hz: 4000000} : {register: 0xb0, value: 32})}}));
  f.synth.enqueueMany(commands);
  await assert.rejects(f.synth.flush(), error => error.message === scenario.error && error.code !== 'OPL_CLOCK_HELD');
  assert.equal(f.synth.state, 'error'); assert.equal(f.synth.isReady(), false);
  assert.equal(f.errors.length, 1); assert.equal(f.errors[0].message, scenario.error);
});

test('Native OPL recovers the exact clock-only held error when Tauri rejects with a string', async t => {
  const f = fixture('ym3812'); await f.synth.start(); t.after(() => f.synth.close());
  const invoke = f.synth.invoke; let rejected = false;
  f.synth.invoke = (command, args) => {
    if (!rejected && command === 'native_genesis_commands' && args.commands.every(c => c.type === 'opl' && c.message.method === 'clock')) {
      rejected = true; return Promise.reject(HELD_CLOCK_ERROR);
    }
    return invoke(command, args);
  };
  await assert.rejects(f.synth.opl.setClock(4000000), error => error.message === HELD_CLOCK_ERROR && error.code === 'OPL_CLOCK_HELD');
  assert.equal(f.synth.isReady(), true); assert.equal(f.synth.opl.clock, 3579545); assert.deepEqual(f.errors, []);
  await f.synth.opl.setClock(4000000); f.synth.opl.noteOn(1, 'A4'); await f.synth.flush();
  assert.equal(f.synth.opl.clock, 4000000); assert(f.state.registers[0xb1] & 32); assert.deepEqual(f.errors, []);
});
