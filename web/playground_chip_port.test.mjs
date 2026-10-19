import test from 'node:test';
import assert from 'node:assert/strict';
import {createChipPortReceiver} from './playground_chip_port.js';
import {createWorkerChip} from './playground_worker_chip.js';
import {YM2612Synth} from './ym2612synth.js';
import {YM2203Synth} from './ym2203synth.js';
import {YM2608Synth} from './ym2608synth.js';
import {YM2610BSynth} from './ym2610bsynth.js';
import {OPNWorkletTransport} from './opn_fm_synth.js';
import {createPerformanceQueue} from './playground_performance_queue.js';

test('replacing a performance port retires its session and removes already reserved commands', () => {
  const applied = [];
  const queue = createPerformanceQueue({apply: c => applied.push(c), nowFrame: () => 0, sampleRate: 48000});
  const receive = createChipPortReceiver(c => applied.push(c), () => 0, {performanceQueue: queue});
  const port = () => ({start() {}, close() {}, postMessage() {}});
  const first = port(), second = port();
  const packet = session => ({performance: {session, owner: 'loop:1', time: 1}, commands: [{type: 'write', value: session}]});
  receive({type: 'attach-chip-port', port: first});
  queue.receive({type: 'performance-start', session: 1});
  first.onmessage({data: packet(1)});
  receive({type: 'attach-chip-port', port: second});
  assert.equal(queue.getStats().activeSession, 0);
  first.onmessage({data: packet(1)});
  second.onmessage({data: packet(1)});
  queue.receive({type: 'performance-start', session: 2});
  second.onmessage({data: packet(2)});
  queue.advance(48000);
  assert.deepEqual(applied, [{type: 'write', value: 2}]);
  second.onmessage({data: {...packet(2), performance: {session: 2, owner: 'loop:1', time: 2}}});
  receive({type: 'detach-chip-port'});
  queue.advance(96000);
  assert.equal(applied.length, 1);
});

test('Replacing or detaching a chip port rejects stale queued commands', () => {
  const received = [];
  const receive = createChipPortReceiver(c => received.push(c));
  const port = () => ({start() {}, close() {this.closed = true;}});
  const first = port(), second = port();
  receive({type: 'attach-chip-port', port: first});
  first.onmessage({data: [{type: 'write', value: 1}]});
  receive({type: 'attach-chip-port', port: second});
  first.onmessage({data: [{type: 'write', value: 2}]});
  second.onmessage({data: [{type: 'write', value: 3}]});
  receive({type: 'detach-chip-port'});
  second.onmessage({data: [{type: 'write', value: 4}]});
  assert.deepEqual(received.map(c => c.value), [1, 3]);
  assert.ok(first.closed && second.closed);
});

test('Worker encoder preserves seeded parameters and matches ordinary synth registers', () => {
  const expected = [], actual = [], notifications = [];
  const synth = new YM2612Synth({transport: {write(port, register, value) {expected.push({type: 'write', port, register, value});}}});
  synth.setAlgo(0, 4, 3);
  const worker = createWorkerChip({port: {postMessage: batch => actual.push(...batch)}, capabilities: {chip: 'ym2612', fmChannels: 6}, state: synth.getState(), observe: e => notifications.push(e)});
  assert.equal(actual.length, 0, 'attaching must not reset the running chip');
  expected.length = 0;
  for (const [method, args] of [['setOperator', [0, 0, {tl: 30}]], ['setPreset', [0, {feedback: 2}]], ['noteOn', [0, 4, 553]], ['noteOff', [0]]]) {
    synth[method](...args);
    worker.fm[method](...args);
  }
  assert.deepEqual(actual, expected);
  assert.equal(notifications.length, 4);
});

test('Stop mutes all operators directly and next note restores its patch', () => {
  const commands = [];
  const worker = createWorkerChip({port: {postMessage: batch => commands.push(...batch)}, capabilities: {chip: 'ym2612', fmChannels: 6}});
  worker.fm.setOperator(0, 0, {tl: 22});
  worker.stop();
  assert.equal(commands.filter(c => c.type === 'write' && c.register >= 0x40 && c.register <= 0x4e && c.value === 127).length, 24);
  commands.length = 0;
  worker.fm.noteOn(0, 4, 553);
  assert.ok(commands.some(c => c.register === 0x40 && c.value === 22));
});

test('selected YM2608 exposes full sections and preserves seeded register shadows and raw reset', () => {
  const commands = [], events = [];
  const synth = new YM2608Synth({transport: {write() {}}});
  synth.write(0, 7, 0xc1); synth.write(0, 8, 11); synth.write(0, 0x18, 0xc5); synth.write(1, 1, 0xc2);
  const state = {...synth.getState(), clock: 7987200, ssg: {registers: synth.ssg.registers},
    rhythm: {levels: synth.rhythm.levels}, adpcm: {registers: synth.adpcm.registers}};
  const worker = createWorkerChip({port: {postMessage: batch => commands.push(...batch)},
    capabilities: {chip: 'ym2608', fmChannels: 6}, state, observe: event => events.push(event)});
  assert.equal(commands.length, 0, 'attaching preserves the running chip');
  assert.equal(worker.raw.ssg.clock, state.clock / 4); assert.equal(worker.raw.adpcm.clock, state.clock);
  worker.ssg.setMixer(1, {tone: true, noise: false});
  worker.ssg.keyOn(0);
  worker.rhythm.setVoice('bassDrum', {volume: 9});
  worker.adpcm.setPan(true, false);
  assert.deepEqual(commands, [
    {type: 'write', port: 0, register: 7, value: 0xd1},
    {type: 'write', port: 0, register: 7, value: 0xd0},
    {type: 'write', port: 0, register: 8, value: 11},
    {type: 'write', port: 0, register: 0x18, value: 0xc9},
    {type: 'write', port: 1, register: 1, value: 0x82},
  ]);
  assert.deepEqual(events.filter(event => event.method === 'write').map(event => event.args), commands.map(({port, register, value}) => [port, register, value]));
  worker.fm.reset();
  assert.equal(worker.raw.ssg.registers[7], 0); assert.equal(worker.raw.rhythm.levels[0], 0);
  assert.equal(worker.raw.adpcm.registers[1], 0); assert.equal(worker.raw.adpcm.registers[12], 255);
  assert.deepEqual(commands.at(-1), {type: 'write', port: 0, register: 0x29, value: 0x9f});
});

test('YM2608 memory/ROM uploads use typed acknowledgements and Stop rejects both outstanding requests', async () => {
  const commands = [], observations = [];
  const port = {postMessage: batch => commands.push(...batch)};
  const worker = createWorkerChip({port, capabilities: {chip: 'ym2608', fmChannels: 6}, observe: event => observations.push(event)});
  const memory = worker.adpcm.loadMemory(new Uint8Array(32), 64), memoryCommand = commands.at(-1);
  port.onmessage({data: {type: 'rhythm-rom-loaded', id: memoryCommand.id, error: 'wrong response type'}});
  port.onmessage({data: {type: 'adpcm-memory-loaded', id: memoryCommand.id}}); await memory;
  assert.equal(memoryCommand.type, 'loadAdpcmMemory'); assert.equal(memoryCommand.address, 64);
  const rom = worker.rhythm.loadRom(new ArrayBuffer(8192)), romCommand = commands.at(-1);
  assert.ok(romCommand.bytes instanceof Uint8Array);
  port.onmessage({data: {type: 'rhythm-rom-loaded', id: romCommand.id, error: 'ROM rejected'}});
  await assert.rejects(rom, /ROM rejected/);
  assert.equal(observations.length, 0, 'sample payloads never pass through Main observers');
  const pendingMemory = assert.rejects(worker.adpcm.loadMemory(new Uint8Array(32)), /Run stopped/);
  const pendingRom = assert.rejects(worker.rhythm.loadRom(new Uint8Array(8192)), /Run stopped/);
  worker.ssg.setVolume(0, 12); worker.rhythm.keyOn('snare'); worker.adpcm.keyOn();
  commands.length = 0; worker.stop(); await Promise.all([pendingMemory, pendingRom]);
  for (let register = 8; register <= 10; register++) assert.ok(commands.some(c => c.port === 0 && c.register === register && c.value === 0));
  assert.ok(commands.some(c => c.port === 0 && c.register === 0x10 && c.value === 0xbf));
  assert.ok(commands.some(c => c.port === 1 && c.register === 0 && c.value === 1));
  await assert.rejects(worker.adpcm.loadMemory(new Uint8Array(32)), /Run stopped/);
  worker.resume();
  const next = worker.adpcm.loadMemory(new Uint8Array(32)), nextCommand = commands.at(-1);
  port.onmessage({data: {type: 'adpcm-memory-loaded', id: nextCommand.id}}); await next;
});

test('selected YM2608 clock acknowledgements update both SSG pitch and ADPCM playback rates', async () => {
  const commands = [], port = {postMessage: batch => commands.push(...batch)};
  const worker = createWorkerChip({port, capabilities: {chip: 'ym2608', fmChannels: 6}});
  const pending = worker.fm.setClock(4000000), command = commands.at(-1);
  assert.equal(worker.raw.ssg.clock, 2000000);
  port.onmessage({data: {type: 'chip-clock-result', id: command.id}}); await pending;
  assert.equal(worker.raw.ssg.clock, 1000000); assert.equal(worker.raw.adpcm.clock, 4000000);
  worker.ssg.setFrequency(0, 440);
  const period = commands.at(-2).value | commands.at(-1).value << 8;
  assert.equal(period, Math.round(1000000 / (16 * 440)));
  worker.adpcm.setPlaybackRate(8000);
  assert.equal(worker.raw.adpcm.registers[9] | worker.raw.adpcm.registers[10] << 8, Math.round(8000 * 144 * 65536 / 4000000));
});

test('primary OPNA transport acknowledges ROM uploads and cancels pending loads without closing the reusable port', async () => {
  let receive;
  const commands = [], port = {postMessage: command => commands.push(command),
    addEventListener(_type, listener) {receive = listener;}, removeEventListener() {}};
  const transport = new OPNWorkletTransport(port, {chipName: 'YM2608', portCount: 2});
  const first = transport.loadRhythmRom(new Uint8Array(8192)), command = commands.at(-1);
  receive({data: {type: 'adpcm-memory-loaded', id: command.id, error: 'wrong response type'}});
  assert.equal(transport.memoryRequests.size, 1);
  receive({data: {type: 'rhythm-rom-loaded', id: command.id}}); await first;
  const memory = assert.rejects(transport.loadAdpcmMemory(new Uint8Array(32)), /Run stopped/);
  const rom = assert.rejects(transport.loadRhythmRom(new Uint8Array(8192)), /Run stopped/);
  transport.cancelPending(); await Promise.all([memory, rom]);
  assert.equal(transport.disposed, false);
  const next = transport.loadRhythmRom(new Uint8Array(8192)), last = commands.at(-1);
  receive({data: {type: 'rhythm-rom-loaded', id: last.id}}); await next;
  transport.dispose();
});

test('selected OPNA Stop aborts delayed sample decoding through resume before any late register or memory write', async () => {
  const commands = [], port = {postMessage: batch => commands.push(...batch)};
  const worker = createWorkerChip({port, capabilities: {chip: 'ym2608', fmChannels: 6}});
  let complete;
  const pending = worker.adpcm.loadSample(new ArrayBuffer(1), {decodeAudio: () => new Promise(resolve => {complete = resolve;})});
  const rejected = assert.rejects(pending, error => error.name === 'AbortError' && /Run stopped/.test(error.message));
  worker.stop(); worker.resume(); commands.length = 0;
  complete({channels: [new Float32Array(64)], sampleRate: 8000}); await rejected;
  assert.deepEqual(commands, [], 'a prior Run cannot configure or upload samples into the resumed chip');
  const abort = new AbortController();
  const callerCanceled = worker.adpcm.loadSample(new ArrayBuffer(1), {signal: abort.signal, decodeAudio: () => new Promise(resolve => {complete = resolve;})});
  const callerRejected = assert.rejects(callerCanceled, /caller canceled/);
  abort.abort(new Error('caller canceled'));
  complete({channels: [new Float32Array(64)], sampleRate: 8000}); await callerRejected;
  assert.deepEqual(commands, []);
});

test('selected OPNA prep port errors reject returned promises and release their pending entries', async () => {
  const worker = createWorkerChip({port: {postMessage() {throw Error('port closed');}}, capabilities: {chip: 'ym2608', fmChannels: 6}});
  await assert.rejects(worker.adpcm.loadMemory(new Uint8Array(32)), /port closed/);
  await assert.rejects(worker.rhythm.loadRom(new Uint8Array(8192)), /port closed/);
});

test('selected OPNA preserves remembered SSG levels across Main snapshots, Stop and explicit raw volume changes', () => {
  const commands = [], main = new YM2608Synth({transport: {write() {}}});
  main.ssg.setVolume(0, 12);
  const snapshot = () => ({...main.getState(), ssg: main.ssg._getState()});
  const worker = createWorkerChip({port: {postMessage: batch => commands.push(...batch)},
    capabilities: {chip: 'ym2608', fmChannels: 6}, state: snapshot(), observe: ({method, args}) => {
      if (method === 'write') main.write(...args);
      if (method === 'ssgState') main.ssg._adoptState(args[0]);
      if (method === 'reset') main.reset();
    }});
  assert.equal(worker.ssg._getState, undefined, 'internal state helpers stay out of script facades');
  worker.ssg.keyOff(0);
  assert.equal(main.ssg.registers[8], 0); assert.equal(main.ssg._getState().levels[0], 12);
  worker.adoptState(snapshot()); worker.ssg.keyOn(0);
  assert.deepEqual(commands.at(-1), {type: 'write', port: 0, register: 8, value: 12});
  worker.stop();
  assert.equal(main.ssg._getState().levels[0], 12, 'Stop silence keeps the configured SSG patch');
  worker.resume(); worker.adoptState(snapshot()); worker.ssg.keyOn(0);
  assert.equal(commands.at(-1).value, 12);
  worker.fm.write(0, 8, 3); worker.ssg.keyOff(0); worker.adoptState(snapshot()); worker.ssg.keyOn(0);
  assert.equal(commands.at(-1).value, 3, 'an explicit raw volume write replaces the remembered level');
  worker.fm.reset(); worker.adoptState(snapshot()); worker.ssg.keyOn(0);
  assert.equal(commands.at(-1).value, 0, 'whole-chip reset still clears the SSG patch');
});

for (const name of ['ym2610', 'ym2610b']) {
  test(`selected ${name} exposes shared SSG and ADPCM-A/B sections with seeded shadows and mapped FM`, () => {
    const commands = [], main = new YM2610BSynth({transport: {write() {}}});
    main.ssg.setVolume(0, 12); main.ssg.keyOff(0);
    main.write(0, 7, 0xc1); main.write(0, 0x11, 0xc2); main.write(1, 8, 0xc5);
    const snapshot = () => ({...main.getState(), clock: 8000000, ssg: main.ssg._getState(),
      adpcmA: {levels: Array.from(main.adpcmA.levels)}, adpcmB: {registers: Array.from(main.adpcmB.registers)}});
    const worker = createWorkerChip({port: {postMessage: batch => commands.push(...batch)},
      capabilities: {chip: name, fmChannels: name === 'ym2610' ? 4 : 6}, state: snapshot(), observe: ({method, args}) => {
        if (method === 'write') main.write(...args);
        if (method === 'ssgState') main.ssg._adoptState(args[0]);
        if (method === 'reset') main.reset();
      }});
    assert.equal(commands.length, 0, 'attaching does not reset or rewrite the device');
    assert.equal(worker.adpcm, worker.adpcmB, 'ADPCM alias addresses the same B section');
    assert.equal(worker.ssg._getState, undefined);
    worker.ssg.keyOn(0); assert.equal(commands.at(-1).value, 12);
    worker.ssg.noise(1, {period: 7, volume: 9});
    assert.equal(commands.at(-1).register, 9); assert.equal(commands.at(-1).value, 9);
    worker.adpcmA.setVoice(0, {volume: 9});
    assert.deepEqual(commands.at(-1), {type: 'write', port: 1, register: 8, value: 0xc9});
    worker.adpcmB.setPan(true, false);
    assert.deepEqual(commands.at(-1), {type: 'write', port: 0, register: 0x11, value: 0x82});
    worker.fm.setOperator(name === 'ym2610' ? 2 : 5, 0, {tl: 20});
    assert.deepEqual(commands.at(-1), {type: 'write', port: 1, register: name === 'ym2610' ? 0x41 : 0x42, value: 20});
    worker.adpcmA.keyOn([0, 5]); worker.adpcmB.keyOn({repeat: true}); commands.length = 0;
    worker.stop();
    for (const register of [8, 9, 10]) assert.ok(commands.some(c => c.port === 0 && c.register === register && c.value === 0));
    assert.ok(commands.some(c => c.port === 1 && c.register === 0 && c.value === 0xbf));
    assert.ok(commands.some(c => c.port === 0 && c.register === 0x10 && c.value === 1));
    assert.equal(main.ssg._getState().levels[0], 12, 'Stop preserves configured SSG volume');
    worker.resume(); worker.adoptState(snapshot()); worker.ssg.keyOn(0); assert.equal(commands.at(-1).value, 12);
    worker.fm.reset();
    assert.equal(worker.raw.ssg.registers[8], 0); assert.equal(worker.raw.adpcmA.levels[0], 0); assert.equal(worker.raw.adpcmB.registers[1], 0);
  });

  test(`${name} A/B memory preparation selects separate ROMs, typed ACKs and Stop cancellation`, async () => {
    const commands = [], observed = [], port = {postMessage: batch => commands.push(...batch)};
    const worker = createWorkerChip({port, capabilities: {chip: name, fmChannels: name === 'ym2610' ? 4 : 6}, observe: event => observed.push(event)});
    for (const [section, memoryType] of [['adpcmA', 0], ['adpcmB', 1]]) {
      const pending = worker[section].loadMemory(new ArrayBuffer(256), 512), command = commands.at(-1);
      assert.equal(command.type, 'loadAdpcmMemory'); assert.equal(command.memoryType, memoryType);
      assert.equal(command.address, 512); assert.ok(command.bytes instanceof Uint8Array);
      port.onmessage({data: {type: 'rhythm-rom-loaded', id: command.id, error: 'wrong ACK'}});
      port.onmessage({data: {type: 'adpcm-memory-loaded', id: command.id}}); await pending;
    }
    assert.equal(observed.length, 0, 'ROM bytes never travel through UI observation');
    const rejected = ['adpcmA', 'adpcmB'].map(section => assert.rejects(worker[section].loadMemory(new Uint8Array(256)), /Run stopped/));
    worker.stop(); await Promise.all(rejected);
    await assert.rejects(worker.adpcmB.loadMemory(new Uint8Array(256)), /Run stopped/);
    worker.resume();
    const next = worker.adpcmA.loadMemory(new Uint8Array(256)), command = commands.at(-1);
    port.onmessage({data: {type: 'adpcm-memory-loaded', id: command.id, error: 'ROM rejected'}});
    await assert.rejects(next, /ROM rejected/);
  });

  test(`${name} acknowledged master clock updates SSG and ADPCM-B rate conversion`, async () => {
    const commands = [], port = {postMessage: batch => commands.push(...batch)};
    const worker = createWorkerChip({port, capabilities: {chip: name, fmChannels: name === 'ym2610' ? 4 : 6}});
    assert.equal(worker.raw.ssg.clock, 2000000); assert.equal(worker.raw.adpcmB.clock, 8000000);
    const pending = worker.fm.setClock(4000000), command = commands.at(-1);
    port.onmessage({data: {type: 'chip-clock-result', id: command.id}}); await pending;
    worker.ssg.setFrequency(0, 440);
    assert.equal(commands.at(-2).value | commands.at(-1).value << 8, Math.round(1000000 / (16 * 440)));
    worker.adpcmB.setPlaybackRate(8000);
    assert.equal(worker.raw.adpcmB.registers[9] | worker.raw.adpcmB.registers[10] << 8, Math.round(8000 * 144 * 65536 / 4000000));
  });
}

test('primary OPNB transport validates A/B ROM ranges and remains reusable after canceled uploads', async () => {
  let receive;
  const commands = [], port = {postMessage: command => commands.push(command),
    addEventListener(_type, listener) {receive = listener;}, removeEventListener() {}};
  const transport = new OPNWorkletTransport(port, {chipName: 'YM2610B', portCount: 2});
  for (const memoryType of [0, 1]) {
    const pending = transport.loadAdpcmMemory(memoryType, new Uint8Array(256), 0x10000), command = commands.at(-1);
    assert.equal(command.memoryType, memoryType); assert.equal(command.address, 0x10000);
    receive({data: {type: 'adpcm-memory-loaded', id: command.id}}); await pending;
  }
  for (const args of [[2, new Uint8Array(1)], [0, new Uint8Array(1), -1], [1, new Uint8Array(256), 0x1000000], [0, new ArrayBuffer(1)]]) {
    await assert.rejects(transport.loadAdpcmMemory(...args), /Invalid ADPCM memory upload/);
  }
  const canceled = [0, 1].map(type => assert.rejects(transport.loadAdpcmMemory(type, new Uint8Array(256)), /Run stopped/));
  transport.cancelPending(); await Promise.all(canceled);
  const next = transport.loadAdpcmMemory(1, new Uint8Array(256)), command = commands.at(-1);
  receive({data: {type: 'adpcm-memory-loaded', id: command.id}}); await next;
  transport.dispose(); await assert.rejects(transport.loadAdpcmMemory(0, new Uint8Array(256)), /disposed/);
});

test('selected YM2203 exposes SSG tone/noise/envelope and preserves shared register shadows through Stop', () => {
  const commands = [], events = [], main = new YM2203Synth({transport: {write() {}}});
  main.write(0, 7, 0xc1); main.ssg.setVolume(0, 12); main.ssg.keyOff(0);
  const snapshot = () => ({...main.getState(), clock: 4000000, ssg: main.ssg._getState()});
  const worker = createWorkerChip({port: {postMessage: batch => commands.push(...batch)},
    capabilities: {chip: 'ym2203', fmChannels: 3}, state: snapshot(), observe: event => {
      events.push(event);
      if (event.method === 'write') main.write(...event.args);
      if (event.method === 'ssgState') main.ssg._adoptState(event.args[0]);
      if (event.method === 'reset') main.reset();
    }});
  assert.ok(worker.raw instanceof YM2203Synth);
  assert.equal(commands.length, 0, 'attachment preserves the running chip without a reset');
  assert.equal(worker.ssg._getState, undefined);
  assert.equal(worker.adpcm, undefined); assert.equal(worker.rhythm, undefined);
  worker.ssg.noise(1, {period: 7, volume: 9, envelope: true});
  assert.deepEqual(commands.slice(-3), [
    {type: 'write', port: 0, register: 6, value: 7},
    {type: 'write', port: 0, register: 7, value: 0xc3},
    {type: 'write', port: 0, register: 9, value: 16},
  ]);
  worker.ssg.setEnvelope({period: 0x1234, shape: 9});
  assert.deepEqual(commands.slice(-3).map(({register, value}) => [register, value]), [[11, 0x34], [12, 0x12], [13, 9]]);
  worker.ssg.keyOn(0); assert.equal(commands.at(-1).value, 12);
  worker.ssg.tone(2, {frequency: 440, volume: 10});
  assert.equal(worker.raw.ssg.registers[4] | worker.raw.ssg.registers[5] << 8, Math.round(2000000 / (16 * 440)));
  assert.deepEqual(main.ssg._getState(), worker.raw.ssg._getState());
  assert.ok(events.some(event => event.method === 'ssgState'));
  commands.length = 0; worker.stop();
  for (let register = 8; register <= 10; register++) assert.ok(commands.some(c => c.port === 0 && c.register === register && c.value === 0));
  assert.equal(main.ssg._getState().levels[0], 12);
  assert.equal(main.ssg._getState().levels[1], 16, 'Stop remembers envelope selection');
  worker.resume(); worker.adoptState(snapshot()); worker.ssg.keyOn(0); assert.equal(commands.at(-1).value, 12);
  worker.fm.write(0, 8, 3); worker.ssg.keyOff(0); worker.adoptState(snapshot()); worker.ssg.keyOn(0);
  assert.equal(commands.at(-1).value, 3, 'raw writes replace the remembered SSG volume');
  worker.fm.reset();
  assert.equal(main.ssg._getState().levels[0], 0); assert.equal(worker.raw.ssg.registers[7], 0);
});

test('selected YM2203 clock conversion follows acknowledged master/2 SSG frequency', async () => {
  const commands = [], port = {postMessage: batch => commands.push(...batch)};
  const worker = createWorkerChip({port, capabilities: {chip: 'ym2203', fmChannels: 3}});
  assert.equal(worker.raw.ssg.clock, 2000000);
  const pending = worker.fm.setClock(3000000), command = commands.at(-1);
  assert.equal(worker.raw.ssg.clock, 2000000, 'unacknowledged clock does not change helper math');
  port.onmessage({data: {type: 'chip-clock-result', id: command.id}}); await pending;
  assert.equal(worker.raw.ssg.clock, 1500000);
  worker.ssg.setFrequency(0, 440);
  assert.equal(commands.at(-2).value | commands.at(-1).value << 8, Math.round(1500000 / (16 * 440)));
  worker.adoptState({...worker.raw.getState(), clock: 6000000, ssg: worker.raw.ssg._getState()});
  assert.equal(worker.raw.ssg.clock, 3000000, 'Main snapshots adopt the same master/2 conversion');
});
