import test from 'node:test';
import assert from 'node:assert/strict';
import {createAy8910Client} from '../../tetorica_src/runtime/playground_ay8910.js';
import {createAyOperationResetState} from '../../tetorica_src/runtime/ay8910_operations.js';
import {createAyTimedSnapshot, validateAyTimedSnapshot} from '../../tetorica_src/runtime/ay8910_timed_state.js';

function setup(options = {}) {
  const sent = [], deferred = [], listeners = new Set();
  const state = createAyOperationResetState(); state.registers[7] = 0xc9;
  state.levels = [0,27,9];
  const remote = {state,instanceId:'chip-one',clock:2000000,type:0x10,flags:1,frame:128,sampleRate:48000};
  let closed = 0;
  const port = {
    start() {}, close() { closed++; },
    postMessage(data) {
      sent.push(data);
      if (data.id === undefined) return;
      let value;
      if (data.method === 'ayTimed') {
        const payload = data.args[0];
        value = payload.action === 'capture' ? structuredClone(createAyTimedSnapshot(remote.state,remote)) : {accepted:true,action:payload.action};
      } else value = true;
      const answer = () => emit({id:data.id,value});
      if (options.defer) deferred.push(answer); else queueMicrotask(answer);
    },
  };
  if (options.events) {
    port.addEventListener = (_type,listener) => listeners.add(listener);
    port.removeEventListener = (_type,listener) => listeners.delete(listener);
  }
  const emit = data => {
    port.onmessage?.({data});
    for (const listener of [...listeners]) listener({data});
  };
  const client = createAy8910Client(port,{clock:2000000,type:0x10,flags:1,instanceId:'chip-one',...options.client});
  const timed = () => sent.filter(message => message.method === 'ayTimed');
  return {client,remote,sent,deferred,timed,emit,listenerCount:()=>listeners.size,closed:()=>closed};
}

test('snapshot helpers return detached read-only complete state with strict identity/config validation', () => {
  const state = createAyOperationResetState(), config = {instanceId:'one',clock:2000000,type:0x10,flags:1,frame:42,sampleRate:48000};
  state.levels[0] = 0;
  const snapshot = createAyTimedSnapshot(state,config);
  assert(Object.isFrozen(snapshot)); assert(Object.isFrozen(snapshot.registers)); assert(Object.isFrozen(snapshot.levels));
  state.registers[7] = 123; state.levels[0] = 9;
  assert.equal(snapshot.registers[7],0); assert.equal(snapshot.levels[0],0);
  assert.throws(() => { snapshot.levels[0] = 5; }, TypeError);
  const copied = validateAyTimedSnapshot(structuredClone(snapshot),config);
  assert.deepEqual(copied,snapshot); assert.notEqual(copied.registers,snapshot.registers);
  for (const [key,value] of [['instanceId','two'],['clock',1000000],['type',0],['flags',0]]) {
    assert.throws(() => validateAyTimedSnapshot(snapshot,{[key]:value}), /Incompatible/);
  }
  assert.deepEqual(validateAyTimedSnapshot(snapshot,{sampleRate:44100}),snapshot,'Device rate is not a register-compilation compatibility key');
  for (const key of Object.keys(snapshot)) {
    const invalid = structuredClone(snapshot); delete invalid[key];
    assert.throws(() => validateAyTimedSnapshot(invalid), /snapshot|Snapshot|state|State/);
  }
  for (const field of [{version:2},{format:'other'},{frame:-1},{clock:undefined},{sampleRate:Infinity},{levels:[1,2]},{extra:true}]) {
    assert.throws(() => validateAyTimedSnapshot({...snapshot,...field}));
  }
});

test('build is additive and state-free; incomplete client baseline rejects without RPC or fallback', async () => {
  const p = setup();
  try {
    const plan = p.client.build(b => b.setMixer(0,{tone:true}));
    assert.equal(p.sent.length,0);
    assert.equal(p.client.getState,undefined,'Existing register client did not gain a changed getState');
    await assert.rejects(p.client.compile(plan,{initialState:'client'}), /Incomplete AY client state/);
    assert.equal(p.sent.length,0);
    const reset = await p.client.compile(plan,{initialState:'reset'});
    assert.equal(reset[0].value,0);
    assert.equal(p.sent.length,0);
    assert.equal(p.client._timedClientStateComplete,false);
  } finally { p.client.dispose(); }
});

test('client mode uses local complete registers and retained levels without communication or mutation', async () => {
  const p = setup();
  try {
    p.client.initialize(); p.client.writeRegister(7,0xc9); p.client.setVolume(0,0); p.client.setVolume(1,11,true); p.client.keyOff(1);
    const before = p.client._getState(), count = p.sent.length;
    const plan = p.client.build(b => { b.setMixer(0,{tone:true}); b.keyOn(0); b.keyOn(1); });
    const rows = await p.client.compile(plan,{initialState:'client'});
    assert.deepEqual(rows.map(({register,value}) => [register,value]),[[7,0xc8],[8,0],[9,27]]);
    assert.equal(p.sent.length,count); assert.deepEqual(p.client._getState(),before);
    assert.equal(p.timed().length,0);

    p.client.adoptRegisterSnapshot(p.client.getRegisterSnapshot());
    await assert.rejects(p.client.compile(plan,{initialState:'client'}), /Incomplete/);
    assert.equal(p.timed().length,0,'Raw-only adoption does not secretly refresh missing metadata');
    p.client._adoptState(before);
    assert.deepEqual(await p.client.compile(plan,{initialState:'client'}),rows);
    p.client._forceKeyOff(1);
    assert.equal(p.client._timedClientStateComplete,true,'Internal guarded releases retain complete metadata provenance');
  } finally { p.client.dispose(); }
});

test('current capture and reset compilation change neither live client state nor existing reservations', async () => {
  const p = setup();
  try {
    p.client.initialize(); const before = p.client._getState();
    const plan = p.client.build(b => { b.setMixer(0,{tone:true}); b.setMixer(1,{noise:false}); });
    const rows = await p.client.compile(plan);
    assert.deepEqual(rows.map(row => row.value),[0xc8,0xd8]);
    assert.equal(p.timed().length,1); assert.equal(p.timed()[0].args[0].action,'capture');
    const reset = await p.client.compile(plan,{initialState:'reset'});
    assert.deepEqual(reset.map(row => row.value),[0,0x10]);
    assert.equal(p.timed().length,1);
    assert.deepEqual(p.client._getState(),before);
  } finally { p.client.dispose(); }
});

test('one captured snapshot is reusable across different virtual programs without readback or contamination', async () => {
  const p = setup();
  try {
    const snapshot = await p.client.captureState(), saved = structuredClone(snapshot);
    const a = p.client.build(b => b.setMixer(0,{tone:true}));
    const b = p.client.build(b => b.setMixer(0,{tone:false}));
    p.client.initialize(); p.client.writeRegister(7,0);
    const before = p.client._getState();
    const results = await Promise.all([p.client.compile(a,{initialState:snapshot}),p.client.compile(b,{initialState:snapshot})]);
    assert.deepEqual(results.map(rows => rows[0].value),[0xc8,0xc9]);
    assert.deepEqual(await p.client.compile(a,{initialState:snapshot}),results[0]);
    assert.deepEqual(snapshot,saved); assert.deepEqual(p.client._getState(),before);
    assert.equal(p.timed().length,1);
  } finally { p.client.dispose(); }
});

test('captured current compilation uses actual renderer clock without adopting it into client state', async () => {
  const p = setup({client:{clock:4000000}});
  try {
    const plan = p.client.build(b => b.setFrequency(0,50));
    // 50Hz is valid at captured 2MHz, but below the 4MHz client's range.
    const rows = await p.client.compile(plan);
    assert.deepEqual(rows.map(({register,value}) => [register,value]),[[0,196],[1,9]]);
    assert.equal(p.client.clock,4000000);
    const snapshot = await p.client.captureState();
    assert.equal(snapshot.clock,2000000);
    await assert.rejects(p.client.compile(plan,{initialState:snapshot}), /clock/);
    assert.equal(p.client.clock,4000000);
  } finally { p.client.dispose(); }
});

test('supplied snapshots reject unknown/mismatched identity and incompatible configuration without RPC', async () => {
  const p = setup({client:{instanceId:undefined}});
  try {
    const snapshot = createAyTimedSnapshot(p.remote.state,p.remote);
    const plan = p.client.build(b => b.keyOn(0));
    await assert.rejects(p.client.compile(plan,{initialState:snapshot}), /identity is unknown/);
    assert.equal(p.timed().length,0);
    await p.client.captureState();
    assert.equal((await p.client.compile(plan,{initialState:snapshot}))[0].value,0);
    for (const field of [{instanceId:'another'},{clock:1000000},{type:0},{flags:0},{version:2},{levels:[9,9]}]) {
      await assert.rejects(p.client.compile(plan,{initialState:{...snapshot,...field}}));
    }
    assert.equal(p.timed().length,1);
  } finally { p.client.dispose(); }
});

test('compile copies operation input before awaiting capture, and client mode copies before yielding', async () => {
  const p = setup({defer:true});
  try {
    p.client.initialize(); p.client.writeRegister(7,0xc9);
    const plan = p.client.build(b => b.setMixer(0,{tone:true}));
    const current = p.client.compile(plan);
    plan.operations[0].args[1].tone = false;
    assert.equal(p.deferred.length,1); p.deferred.shift()();
    assert.equal((await current)[0].value,0xc8);

    const clientPlan = p.client.build(b => b.setMixer(0,{tone:true}));
    const local = p.client.compile(clientPlan,{initialState:'client'});
    p.client.writeRegister(7,0xff);
    assert.equal((await local)[0].value,0xc8);
    assert.equal(p.deferred.length,0);
  } finally { p.client.dispose(); }
});

test('schedule/clear and private transaction ownership use copied data with acceptance RPCs', async () => {
  const p = setup();
  try {
    const capability = p.client._timedOperations;
    assert.equal(capability,p.client._timedOperations); assert(Object.isFrozen(capability));
    const plan = p.client.build(b => b.setEnvelope({shape:8})), settings = {name:'buzzer',repeatSeconds:1/110};
    const scheduled = p.client.schedule(plan,settings);
    plan.operations[0].args[0].shape = 3; settings.repeatSeconds = 1;
    assert.equal((await scheduled).accepted,true);
    const payload = p.timed().at(-1).args[0];
    assert.deepEqual(payload.options,{name:'buzzer',repeatSeconds:1/110});
    assert.equal(payload.operations.operations[0].args[0].shape,8);
    await capability.schedule(plan,{name:'pair'},{owner:'loop-one'});
    assert.equal(p.timed().at(-1).args[0].owner,'loop-one');
    await capability.stage('apply-one','loop-one','schedule',[plan,{name:'pair'}]);
    assert.deepEqual(p.timed().at(-1).args[0],{action:'stage',transactionId:'apply-one',owner:'loop-one',method:'schedule',args:[plan,{name:'pair'}]});
    await capability.stage('apply-one','loop-one','clearSchedule',['buzzer']);
    await capability.commit('apply-one','loop-one');
    await capability.abort('apply-one','loop-one');
    await capability.cancelOwner('loop-one');
    await capability.releaseOwner('loop-one');
    await p.client.clearSchedule('pair');
    assert.deepEqual(p.timed().slice(-6).map(message => message.args[0].action),['stage','commit','abort','cancelOwner','releaseOwner','clear']);
  } finally { p.client.dispose(); }
});

test('invalid scheduling/options fail before changing any existing remote reservation', async () => {
  const p = setup();
  try {
    const plan = p.client.build(b => b.atSample(100).keyOn(0));
    for (const settings of [{name:''},{name:'x',repeatSeconds:0},{name:'x',repeatSeconds:100/44100},{name:'x',repeatSeconds:Infinity},{name:'x',extra:true}]) {
      await assert.rejects(p.client.schedule(plan,settings));
    }
    const invalid = structuredClone(plan); invalid.operations[0].method = 'initialize';
    await assert.rejects(p.client.schedule(invalid,{name:'x'}));
    await assert.rejects(p.client.compile(plan,{initialState:null}));
    await assert.rejects(p.client.compile(plan,{initialState:'other'}));
    await assert.rejects(p.client.compile(plan,{extra:true}));
    await assert.rejects(p.client._timedOperations.stage('txn','owner','reset',[]));
    assert.equal(p.timed().length,0);
  } finally { p.client.dispose(); }
});

test('Native rejects capture and timed execution locally while valid client/reset inspection remains available', async () => {
  const state = createAyOperationResetState(); state.registers[7] = 0xc9;
  const p = setup({client:{native:true,state:{...state,clock:2000000,initialized:true}}});
  try {
    const plan = p.client.build(b => b.setMixer(0,{tone:true}));
    assert.equal((await p.client.compile(plan,{initialState:'client'}))[0].value,0xc8);
    assert.equal((await p.client.compile(plan,{initialState:'reset'}))[0].value,0);
    for (const run of [() => p.client.captureState(),() => p.client.compile(plan),() => p.client.schedule(plan,{name:'x'}),() => p.client.clearSchedule('x')]) await assert.rejects(run(),/Native is not supported/);
    assert.equal(await p.client._timedOperations.cancelOwner('owner'),false);
    assert.equal(await p.client._timedOperations.releaseOwner('owner'),false);
    assert.equal(p.sent.length,0);
  } finally { p.client.dispose(); }
});

test('disposal rejects pending captures and every later operation without extra messages', async () => {
  const p = setup({defer:true});
  const plan = p.client.build(b => b.keyOn(0));
  const pending = p.client.captureState(), rejected = assert.rejects(pending,/disposed/);
  p.client.dispose(); await rejected;
  const count = p.sent.length;
  assert.throws(() => p.client.build(() => {}),/disposed/);
  await assert.rejects(p.client.compile(plan,{initialState:'reset'}),/disposed/);
  await assert.rejects(p.client.captureState(),/disposed/);
  await assert.rejects(p.client.schedule(plan,{name:'x'}),/disposed/);
  assert.equal(p.sent.length,count); assert.equal(p.closed(),1);
});

for (const events of [false,true]) test(`nonfatal timed errors notify isolated private observers and detach on disposal (${events?'EventTarget':'onmessage'})`, async () => {
  const p = setup({events}), diagnostics = [], logs = [], original = console.error;
  console.error = (...args) => logs.push(args);
  try {
    const before = p.client._getState();
    const received = {type:'ay-timed-error',message:'Frequency out of range',owner:'loop-one',session:1};
    p.emit(received);
    assert.equal(logs.length,1,'No subscribers logs one visible diagnostic');
    assert.match(logs[0][0], /Frequency out of range/);
    const throwing = p.client._timedOperations.onError(() => { throw Error('observer failure'); });
    const unsubscribe = p.client._timedOperations.onError(value => diagnostics.push(value));
    const count = p.sent.length;
    p.emit(received);
    assert.equal(diagnostics.length,1); assert(Object.isFrozen(diagnostics[0]));
    assert.deepEqual(diagnostics[0],received); assert.notEqual(diagnostics[0],received);
    assert.equal(logs.length,2,'Observer exceptions are caught and reported independently');
    assert.match(logs[1][0], /error observer/);
    assert.deepEqual(p.client._getState(),before); assert.equal(p.sent.length,count);
    assert.equal((await p.client.captureState()).instanceId,'chip-one','An observer exception does not break RPC replies');
    throwing(); unsubscribe(); unsubscribe();
    p.emit(received); assert.equal(logs.length,3);
    assert.throws(() => p.client._timedOperations.onError(null), /function/);
    p.client.dispose();
    p.emit(received); assert.equal(logs.length,3,'Disposal suppresses retired diagnostics');
    assert.equal(p.listenerCount(),0);
  } finally {console.error = original; p.client.dispose();}
});
