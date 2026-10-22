import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisOpl} from './native_genesis_opl.js';
import {createOplClient} from './playground_opl.js';

const CHIPS = ['ym3526', 'ym3812', 'ymf262', 'y8950'];
const PAIRS = [0, 1, 2, 9, 10, 11];
const address = channel => (channel >= 9 ? 256 : 0) + 0xb0 + channel % 9;
async function until(predicate) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Native OPL control did not start');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
function fixture(chip = 'ym3812') {
  const commands = [], requests = [], events = [], future = [], held = new Map(), rejectedClocks = new Set();
  const count = chip === 'ymf262' ? 18 : 9;
  const state = {chip, clock: chip === 'ymf262' ? 14318180 : 3579545,
    registers: Array(chip === 'ymf262' ? 512 : 256).fill(0), status: 0, irq: false, sourceMuteMask: 0};
  let frame = 0, flushHook, statusHook;
  const pair = ch => { const bit = PAIRS.indexOf(ch); return bit >= 0 && state.registers[0x104] & (1 << bit) ? [ch, ch + 3] : [ch]; };
  const off = ch => { if (ch >= 18) state.registers[0xbd] &= ~(16 >> (ch - 18)); else for (const voice of pair(ch)) state.registers[address(voice)] &= 223; };
  const blocked = register => [...held.keys()].some(ch => register === 0x104 || register === 0x105 || register === 0xbd || pair(ch).some(voice => {
    const local = register & 255, bank = register >> 8;
    if (register < 2 || register === 8) return true;
    if (local >= 0xa0 && local <= 0xc8 && (local & 15) < 9) return voice === bank * 9 + (local & 15);
    const slots = [0, 1, 2, 8, 9, 10, 16, 17, 18], offset = local & 31;
    return bank === Math.floor(voice / 9) && (offset === slots[voice % 9] || offset === slots[voice % 9] + 3);
  }));
  function apply(m, bypass = false) {
    if (m.method === 'batch') {
      assert(m.commands.every(c => ['write', 'key-off', 'audition-key-on', 'clock'].includes(c.method)));
      if (m.action === 'off' && held.get(m.channel) !== m.voice) return;
      if (m.action === 'on') {
        for (const ch of held.keys()) if (pair(ch).some(c => pair(m.channel).includes(c))) { off(ch); held.delete(ch); }
        held.set(m.channel, m.voice);
      }
      for (const c of m.commands) apply(c, true);
      if (m.action === 'off') held.delete(m.channel);
      return;
    }
    if (m.method === 'write') { if (bypass || !blocked(m.register)) state.registers[m.register] = m.value; }
    else if (m.method === 'key-off') { if (bypass || !held.has(m.channel)) off(m.channel); }
    else if (m.method === 'audition-key-on') state.registers[address(m.channel)] |= 32;
    else if (m.method === 'clock') { if (!held.size) state.clock = m.hz; else rejectedClocks.add(m.id); }
    else if (m.method === 'reset') { held.clear(); state.registers.fill(0); }
    else if (m.method === 'stop-voices') { held.clear(); for (let ch = 0; ch < count; ch++) off(ch); state.registers[0xbd] &= 224; }
  }
  const snapshot = () => ({[chip]: {...structuredClone(state), held: [...held.keys()], pendingCommands: future.flatMap(c => c.message.id ? [c.message.id] : [])}, frame, sampleRate: 48000, revision: commands.length});
  const synth = {session: 1, generation: 1, clock: {sampleRate: 48000}, stopping: null, closing: false,
    isReady: () => true, frameAt: time => Math.round(time * 48000),
    enqueue(command) {
      if (command.message.method === 'clock' && held.size) throw new Error('Release the manually held OPL voices before changing the clock');
      commands.push(command); if (command.frame > frame) future.push(command); else apply(command.message);
    },
    async flush() { if (flushHook) await flushHook(); },
    async nativeRequest(command, args) {
      requests.push({command, args});
      if (args?.after) while (future.some(c => c.message.id === args.after)) await new Promise(resolve => setTimeout(resolve, 1));
      if (rejectedClocks.has(args?.after)) throw new Error('Release the manually held OPL voices before changing the clock');
      return statusHook ? statusHook() : snapshot();
    },
    emit: event => events.push(event)};
  const endpoint = createNativeGenesisOpl(synth, {chip, msxAudio: chip === 'y8950'});
  return {endpoint, client: endpoint.client, state, synth, commands, requests, events, held, snapshot,
    setFlushHook: hook => { flushHook = hook; }, setStatusHook: hook => { statusHook = hook; },
    async start() { await endpoint.initialize(); commands.length = 0; events.length = 0; },
    advance(to) { frame = to; for (let i = 0; i < future.length;) if (future[i].frame <= frame) apply(future.splice(i, 1)[0].message); else i++; },
    stop() { future.length = 0; apply({method: 'stop-voices'}); endpoint.adoptStopped(snapshot()); }};
}

for (const chip of CHIPS) {
  test(`Native ${chip} constructs a passive selected endpoint and initializes once`, async () => {
    const f = fixture(chip);
    assert.equal(f.commands.length, 0); assert.equal(f.client.id, chip); assert.equal(f.client.chip, chip);
    assert.equal(f.client.clock, chip === 'ymf262' ? 14318180 : 3579545);
    assert.throws(() => { f.client.clock = 4000000; }, TypeError);
    await f.start(); await f.endpoint.initialize(); assert.equal(f.commands.length, 0);
    assert.equal(f.state.registers.length, chip === 'ymf262' ? 512 : 256);
    assert.equal(f.client._getState().initialized, true);
    if (chip === 'ym3812') assert.equal(f.state.registers[1], 32);
    if (chip === 'ymf262') assert.equal(f.state.registers[0x105], 1);
  });

  test(`Native ${chip} authored writes match the existing Web client`, async () => {
    const f = fixture(chip); await f.start();
    const messages = [], web = createOplClient({postMessage: m => messages.push(m), close() {}}, {chip});
    web.initialize(); messages.length = 0;
    function program(api) {
      for (const ch of [0, api.channels - 1]) {
        api.setPreset(ch, {algorithm: 1, feedback: 3, operators: [{mul: 2, ar: 15, rr: 5, tl: 21}, {mul: 1, ar: 14, rr: 6, tl: 5}]});
        api.noteOn(ch, 'A4'); api.keyOff(ch); api.setOperator(ch, 0, {vibrato: true, am: true});
      }
      api.setLFO({amDepth: true, pmDepth: true}); api.setRhythm({enabled: true, bassDrum: true, snare: true, hiHat: true});
      api.setRhythm({bassDrum: false, snare: false}); api.allNotesOff();
    }
    program(web); program(f.client);
    assert.deepEqual(f.commands.map(c => c.message), messages.map(m => ({chip, method: 'write', register: m.args[0] | (m.args[2] << 8), value: m.args[1]})));
    assert.deepEqual(f.client._getState(), web._getState());
  });

  test(`Native ${chip} scheduled state remains separate from authored pitch and clock`, async () => {
    const f = fixture(chip); await f.start();
    const before = f.client._getState();
    assert.deepEqual(await f.endpoint.dispatch({method: 'writeRegister', args: [0xa0, 77], id: 'write'}, {time: 1, owner: 4, performance: 7}), {id: 'write'});
    assert.deepEqual(f.commands[0], {type: 'opl', frame: 48000, owner: 4, performance: 7, message: {chip, method: 'write', register: 0xa0, value: 77}});
    assert.equal((await f.endpoint.read()).registers[0xa0], 0); assert.deepEqual(f.client._getState(), before);
    const clockChange = f.endpoint.dispatch({method: 'clock', args: [4000000]}, {time: 1});
    await until(() => f.commands.some(c => c.message.method === 'clock'));
    assert.equal(f.client.clock, before.clock); assert.equal((await f.endpoint.read()).clock, before.clock);
    f.client.setNote(0, 'A4'); const authored = f.client.getRegisterSnapshot(); await f.endpoint.read();
    assert.deepEqual(f.client.getRegisterSnapshot(), authored);
    f.advance(48000); await clockChange; assert.equal(f.client.clock, 4000000); assert.equal((await f.endpoint.read()).clock, 4000000);
    assert(f.requests.every(r => r.command === 'native_genesis_opl_status'));
  });

  test(`Native ${chip} manual audition replacement ignores stale release and script key off`, async () => {
    const f = fixture(chip); await f.start(); const ch = f.client.channels - 1;
    await f.endpoint.invoke('setOperator', [ch, 1, {tl: 4}]);
    await f.endpoint.invoke('auditionOn', [ch, 69, 'old']); const old = f.held.get(ch);
    assert.equal((await f.endpoint.read()).channels[ch].active, true);
    await f.endpoint.invoke('auditionOn', [ch, 72, 'new']); assert.notEqual(f.held.get(ch), old);
    const before = f.commands.length;
    assert.equal(await f.endpoint.invoke('auditionOff', [ch, 'old']), false); assert.equal(f.commands.length, before);
    f.client.keyOff(ch); assert(f.state.registers[address(ch)] & 32);
    await f.endpoint.invoke('auditionOff', [ch, 'new']); assert.equal(f.state.registers[address(ch)] & 32, 0);
    assert.equal(f.held.size, 0); assert.equal(f.client.getRegisterSnapshot()[address(ch)] & 32, 0);
  });

  test(`Native ${chip} rhythm supports five raw triggers and force-off without melodic auditions`, async () => {
    const f = fixture(chip); await f.start();
    f.client.setRhythm({enabled: true, bassDrum: true, snare: true, tom: true, cymbal: true, hiHat: true});
    assert.equal(f.state.registers[0xbd] & 63, 63);
    for (let drum = 0; drum < 5; drum++) { await f.endpoint.dispatch({method: 'forceRhythmOff', args: [drum]}); assert.equal(f.state.registers[0xbd] & (16 >> drum), 0); }
    assert.equal((await f.endpoint.read()).keyboardChannels.length, f.client.channels - 3);
    const before = f.commands.length;
    await assert.rejects(f.endpoint.invoke('auditionOn', [6, 69, 'drum']), /Rhythm mode/);
    assert.equal(f.commands.length, before); assert.equal(f.held.size, 0);
  });

  test(`Native ${chip} layout metadata changes for layout bits and never ordinary note gates`, async () => {
    const f = fixture(chip); await f.start(); await Promise.resolve(); f.events.length = 0;
    f.client.noteOn(0, 'A4'); f.client.keyOff(0); f.client.setRhythm({bassDrum: true}); await Promise.resolve();
    assert.equal(f.events.length, 0);
    f.client.setRhythm({enabled: true}); await Promise.resolve(); assert.equal(f.events.length, 1);
    assert.equal(f.events[0].name, 'opl'); assert(f.events[0].state.registers[0xbd] & 32);
    f.events.length = 0; f.client.setRhythm({bassDrum: false, hiHat: true}); await Promise.resolve(); assert.equal(f.events.length, 0);
  });

  test(`Native ${chip} Stop retains patches, rhythm layout, clock and clears gates`, async () => {
    const f = fixture(chip); await f.start();
    f.client.setOperator(0, 1, {tl: 7, mul: 3}); f.client.setRhythm({enabled: true, snare: true});
    await f.client.setClock(4000000); await f.endpoint.invoke('auditionOn', [0, 69, 'held']);
    const before = f.client.getRegisterSnapshot(); f.stop();
    assert.equal(f.held.size, 0); assert.equal(f.client.clock, 4000000);
    assert.equal(f.client.getRegisterSnapshot()[0x43], before[0x43]); assert.equal(f.client.getRegisterSnapshot()[0x23], before[0x23]);
    assert.equal(f.client.getRegisterSnapshot()[0xbd] & 63, 32);
    for (let ch = 0; ch < f.client.channels; ch++) assert.equal(f.client.getRegisterSnapshot()[address(ch)] & 32, 0);
    f.endpoint.reset(); assert.equal(f.client.clock, chip === 'ymf262' ? 14318180 : 3579545);
    assert.equal(f.client._getState().initialized, false);
  });
}

test('Native OPL accepts flattened OPL3 addresses or explicit banks without ambiguous aliases', async () => {
  const f = fixture('ymf262'); await f.start();
  await f.endpoint.dispatch({method: 'writeRegister', args: [0x123, 41]});
  await f.endpoint.dispatch({method: 'writeRegister', args: [0x24, 42, 1]});
  assert.equal(f.state.registers[0x123], 41); assert.equal(f.state.registers[0x124], 42);
  const before = f.commands.length;
  for (const args of [[0x123, 0, 1], [512, 0], [-1, 0], [0, 256], [0, 0, 2]]) await assert.rejects(f.endpoint.dispatch({method: 'writeRegister', args}), RangeError);
  assert.equal(f.commands.length, before);
  const mono = fixture('ym3812'); await mono.start();
  await assert.rejects(mono.endpoint.dispatch({method: 'writeRegister', args: [0x20, 0, 1]}), /Bank/);
  assert.throws(() => createNativeGenesisOpl(f.synth, {chip: 'y8950'}), /DOS PC/);
});

for (const ch of PAIRS) test(`Native OPL3 four-operator pair ${ch}+${ch + 3} is one manual voice`, async () => {
  const f = fixture('ymf262'); await f.start();
  await f.endpoint.invoke('setPreset', [ch, {fourOp: true, algorithm: 3, pan: {left: true, right: false}, operators: [{tl: 19}, {tl: 11}, {tl: 9}, {tl: 3}]}]);
  const view = await f.endpoint.read(); assert.equal(view.channels[ch].operators.length, 4); assert.equal(view.channels[ch + 3].available, false);
  await f.endpoint.invoke('auditionOn', [ch, 69, 'four']); assert.deepEqual([...f.held.keys()], [ch]);
  const before = f.commands.length;
  await assert.rejects(f.endpoint.invoke('auditionOn', [ch + 3, 69, 'secondary']), /belongs to four/);
  assert.equal(f.commands.length, before); assert.deepEqual([...f.held.keys()], [ch]);
  const bank = ch >= 9 ? 256 : 0, slot = [0, 1, 2][ch % 9] + 8;
  const saved = f.state.registers[bank + 0x40 + slot];
  f.client.writeRegister(bank + 0x40 + slot, 63); assert.equal(f.state.registers[bank + 0x40 + slot], saved);
  await f.endpoint.invoke('setFourOp', [ch, false]); assert.equal(f.held.size, 0);
  assert.equal((await f.endpoint.read()).channels[ch + 3].available, true);
});

test('Native OPL3 layout notifications coalesce pair and extended-mode changes', async () => {
  const f = fixture('ymf262'); await f.start(); await Promise.resolve(); f.events.length = 0;
  f.client.setFourOp(0, true); f.client.setFourOp(9, true); f.client.writeRegister(0x105, 0);
  await Promise.resolve(); assert.equal(f.events.length, 1); assert.equal(f.events[0].state.registers[0x104], 9);
  f.events.length = 0; f.client.writeRegister(0x104, 9 | 128); f.client.writeRegister(0x105, 2);
  await Promise.resolve(); assert.equal(f.events.length, 0);
});

test('Native OPL mix works before initialize and async status reads are passive', async () => {
  const f = fixture(); await f.endpoint.mix(.3, -.2);
  assert.deepEqual(f.commands[0].message, {chip: 'ym3812', method: 'mix', volume: .3, pan: -.2});
  await f.start(); f.state.status = 192; f.state.irq = true;
  assert.equal(await f.client.readStatus(), 192); assert.equal(await f.client.getIrq(), true); assert.equal(f.commands.length, 0);
  await assert.rejects(f.endpoint.mix(NaN)); await assert.rejects(f.endpoint.mix(1, 2));
  f.setStatusHook(() => { const state = f.snapshot(); state.ym3812.registers.pop(); return state; });
  await assert.rejects(f.endpoint.read(), /invalid snapshot/);
});

for (const chip of CHIPS) test(`Native ${chip} clock rejection while held leaves Main authoring unchanged`, async () => {
  const f = fixture(chip); await f.start();
  await f.endpoint.invoke('auditionOn', [0, 69, 'held']);
  const before = f.client._getState(), eventCount = f.events.length;
  await assert.rejects(f.client.setClock(4000000), /held/);
  assert.deepEqual(f.client._getState(), before); assert.equal(f.events.length, eventCount);
  await f.endpoint.invoke('auditionOff', [0, 'held']);
  await f.client.setClock(4000000); assert.equal(f.client.clock, 4000000);
  assert(f.requests.some(request => Number.isSafeInteger(request.args?.after)));
});

for (const chip of ['ym3812','y8950']) for (const requested of [3579545, 4000000]) test(`Native ${chip} scheduled clock ${requested} detects a manual hold acquired after admission`, async () => {
  const f = fixture(chip); await f.start();
  const pending = f.endpoint.dispatch({method: 'clock', args: [requested]}, {time: 1});
  const rejected = assert.rejects(pending, /held/);
  await until(() => f.commands.some(c => c.message.method === 'clock'));
  await f.endpoint.invoke('auditionOn', [0, 69, 'late']);
  f.advance(48000); await rejected;
  assert.equal(f.client.clock, 3579545); assert.equal(f.state.clock, 3579545);
});

test('Native OPL clock barriers serialize scheduled edits and share identities with inspector batches', async () => {
  const f = fixture(); await f.start();
  await f.endpoint.invoke('setOperator', [0, 1, {tl: 3}]);
  const first = f.endpoint.dispatch({method: 'clock', args: [4000000], id: 'first'}, {time: 1});
  const second = f.endpoint.dispatch({method: 'clock', args: [5000000], id: 'second'}, {time: 2});
  await until(() => f.commands.some(c => c.message.method === 'clock'));
  assert.equal(f.commands.filter(c => c.message.method === 'clock').length, 1);
  assert.equal(f.client.clock, 3579545);
  f.advance(48000); assert.deepEqual(await first, {id: 'first'}); assert.equal(f.client.clock, 4000000);
  await until(() => f.commands.filter(c => c.message.method === 'clock').length === 2);
  f.advance(96000); assert.deepEqual(await second, {id: 'second'}); assert.equal(f.client.clock, 5000000);
  const ids = f.commands.flatMap(c => c.message.id ? [c.message.id] : []);
  assert.equal(new Set(ids).size, ids.length);
});

for (const cancellation of ['generation', 'session', 'owner']) test(`Native OPL async controls fence ${cancellation} cancellation`, async () => {
  const f = fixture(); await f.start(); let retired = false;
  f.setFlushHook(() => { if (cancellation === 'owner') retired = true; else f.synth[cancellation]++; });
  await assert.rejects(f.endpoint.dispatch({method: 'clock', args: [4000000]}, {checkCurrent() { if (retired) throw new DOMException('Retired', 'AbortError'); }}), {name: 'AbortError'});
  assert.equal(f.client.clock, 3579545);
});
