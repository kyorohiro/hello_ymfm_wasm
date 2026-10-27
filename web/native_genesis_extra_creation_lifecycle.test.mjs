import test from 'node:test';
import assert from 'node:assert/strict';
import {EXTRA_KINDS, createLifecycleFixture, installCreationEnvironment, deferred, until} from './native_genesis_extra_creation_fixture.mjs';

const selected = process.env.NATIVE_CREATION_KINDS?.split(',') ?? EXTRA_KINDS;
const bindCancel = `keyboard.bind('cancel',{noteOn(){stopLoop('make');log('cancelled');},noteOff(){},allNotesOff(){}});`;
async function cancelLoop(f, execution) {
  if (execution === 'main') f.runtime.context.cancel();
  else { f.runtime.getKeyboardTarget().noteOn({id: 'cancel', midi: 60}); await until(() => f.logs.includes('cancelled'), 'Worker loop cancellation'); }
}

for (const kind of selected) {
  for (const execution of ['main', 'worker']) test(`${kind}: ${execution} loop cancellation during Native creation retires the late response`, {timeout: 12000}, async t => {
    const env = installCreationEnvironment(t), f = createLifecycleFixture(t, env), gate = deferred(); f.setGate(gate);
    await f.runtime.playSource(`liveLoop('make',async()=>{await createSoundChip('${kind}',{id:'pending'});log('stale-create');await beat(100);});${execution === 'main' ? `context.cancel=()=>stopLoop('make');` : bindCancel}`, {execution});
    await until(() => f.createRequests.length === 1 && (execution === 'main' || f.runtime.getKeyboardTarget()), 'create entered');
    const instance = f.createRequests[0].args.instance;
    await cancelLoop(f, execution);
    await until(() => !f.synth.extraDevices.size, 'logical source removed before create reply');
    gate.resolve(); f.setGate(null);
    await until(() => !f.rack.size && f.disposeCount(instance) === 1, 'late Native instance disposed exactly once');
    assert(!f.logs.includes('stale-create'));
    assert.equal(f.synth.mixer.reservedIds.size, 0);
    await f.finalize();
  });

  test(`${kind}: a transferred Worker create response is disposed when its loop was cancelled`, {timeout: 12000}, async t => {
    const env = installCreationEnvironment(t, {holdResponse: message => message.type === 'response' && message.value?.id === 'pending'}), f = createLifecycleFixture(t, env);
    await f.runtime.playSource(`liveLoop('make',async()=>{await createSoundChip('${kind}',{id:'pending'});log('stale-response');await beat(100);});${bindCancel}`, {execution: 'worker'});
    await until(() => env.workers[0]?.heldResponses.length === 1 && f.runtime.getKeyboardTarget(), 'transferred create response held');
    const instance = f.createRequests[0].args.instance;
    await cancelLoop(f, 'worker'); env.workers[0].releaseResponses();
    await until(() => !f.rack.size && f.disposeCount(instance) === 1, 'late transferred response disposed');
    assert(!f.logs.includes('stale-response'));
    await f.finalize();
  });

  for (const execution of ['main', 'worker']) test(`${kind}: ${execution} Stop remains responsive during Native creation`, {timeout: 12000}, async t => {
    const env = installCreationEnvironment(t), f = createLifecycleFixture(t, env), gate = deferred(); f.setGate(gate);
    await f.runtime.playSource(`liveLoop('make',async()=>{await createSoundChip('${kind}',{id:'pending'});log('stale-stop');await beat(100);});`, {execution});
    await until(() => f.createRequests.length === 1, 'create entered before Stop');
    // Stop changes the logical Run immediately. Native's existing FIFO still
    // waits for its outstanding IPC response before its physical reset barrier.
    const stopping = f.runtime.stopWithFade();
    await until(() => !f.synth.extraDevices.size, 'Stop removed logical source before create reply');
    gate.resolve(); f.setGate(null);
    await stopping;
    await until(() => !f.pendingIPC.size && !f.rack.size, 'Stop late reply drained');
    assert(!f.logs.includes('stale-stop'));
    await f.finalize();
  });

  test(`${kind}: cancelled pending ID can be reused before the old Native response`, {timeout: 12000}, async t => {
    const env = installCreationEnvironment(t), f = createLifecycleFixture(t, env), gate = deferred(); f.setGate(gate);
    await f.runtime.playSource(`liveLoop('make',async()=>{await createSoundChip('${kind}',{id:'same'});log('stale-id');await beat(100);});context.cancel=()=>stopLoop('make');context.create=()=>createSoundChip('${kind}',{id:'same'});`);
    await until(() => f.createRequests.length === 1, 'old creation entered'); f.runtime.context.cancel();
    await until(() => !f.synth.extraDevices.size && !f.synth.mixer.reservedIds.size, 'old reservation released');
    const old = f.createRequests[0].args.instance; f.setGate(null);
    const replacing = f.runtime.context.create();
    await until(() => f.synth.extraDevices.size === 1, 'replacement source admitted before old response');
    const newer = [...f.synth.extraDevices.keys()][0]; assert.notEqual(old, newer);
    gate.resolve(); const replacement = await replacing;
    await until(() => f.disposeCount(old) === 1, 'old Native response retired');
    assert.equal(f.disposeCount(newer), 0); assert.equal(f.rack.size, 1); assert(f.rack.has(newer));
    assert.equal(replacement.id, 'same'); assert(!f.logs.includes('stale-id'));
    replacement.dispose(); await f.finalize();
  });

  test(`${kind}: switching to Main retires a Worker whose Native create response is pending`, {timeout: 12000}, async t => {
    const env = installCreationEnvironment(t), f = createLifecycleFixture(t, env), gate = deferred(); f.setGate(gate);
    await f.runtime.playSource(`liveLoop('make',async()=>{await createSoundChip('${kind}',{id:'pending'});log('stale-rerun');await beat(100);});`, {execution: 'worker'});
    await until(() => f.createRequests.length === 1, 'old Worker create entered');
    const oldWorker = env.workers[0], replacing = f.runtime.playSource(`log('replacement-run');`, {execution: 'main'});
    await until(() => !f.synth.extraDevices.size, 'old Worker logical source retired before Native reply');
    gate.resolve(); f.setGate(null); await replacing;
    await until(() => f.logs.includes('replacement-run') && !f.pendingIPC.size && !!oldWorker.terminated, 'old Worker terminated after Native barrier');
    assert(!f.logs.includes('stale-rerun')); assert.equal(f.reservedNativeUnits(), 0);
    await f.finalize();
  });

  test(`${kind}: Stop closes an unconsumed transferred Worker response`, {timeout: 12000}, async t => {
    const env = installCreationEnvironment(t, {holdResponse: message => message.type === 'response' && message.value?.id === 'pending'}), f = createLifecycleFixture(t, env);
    await f.runtime.playSource(`liveLoop('make',async()=>{await createSoundChip('${kind}',{id:'pending'});log('stale-transfer-stop');await beat(100);});`, {execution: 'worker'});
    await until(() => env.workers[0]?.heldResponses.length === 1, 'create response held before Worker consumption');
    const worker=env.workers[0],response=worker.heldResponses[0];
    await f.runtime.stopWithFade();
    assert(!f.logs.includes('stale-transfer-stop')); assert.equal(f.reservedNativeUnits(), 0);
    // Exercise the original failure deterministically: the port is already
    // closed while its transferred response is queued inside the Worker.
    await until(()=>worker.closedHeldResponses.has(response),'queued Worker response port closed by Stop');
    worker.releaseResponses();
    await until(()=>worker.releasedResponses.has(response)&&worker.messages.some(message=>message.command==='pcm.dispose'&&message.args?.[0]==='pending'),'closed late response delivered to production Worker cleanup');
    assert.equal(worker.heldResponses.length, 0);assert(!f.logs.includes('stale-transfer-stop'));
    await f.finalize();
  });

  for (const execution of ['main', 'worker']) test(`${kind}: ${execution} shared pending lookup survives cancellation of one caller`, {timeout: 12000}, async t => {
    // Use a real supported nonborrowing mode for Genesis's built-in FM/PSG.
    const env = installCreationEnvironment(t), f = createLifecycleFixture(t, env, {mode: ['segapsg', 'ym2612'].includes(kind) ? 'ym3526' : 'genesis'}), gate = deferred(); f.setGate(gate);
    await f.runtime.playSource(`liveLoop('make',async()=>{await useSoundChip('${kind}');log('cancelled-shared-continuation');await beat(100);});liveLoop('survivor',async()=>{const a=await useSoundChip('${kind}');log('survivor-ready');await beat(100);});${execution === 'main' ? `context.cancel=()=>stopLoop('make');` : bindCancel}`, {execution});
    await until(() => f.createRequests.length === 1 && (execution === 'main' || f.runtime.getKeyboardTarget()), 'shared creation entered');
    await cancelLoop(f, execution); gate.resolve(); f.setGate(null);
    await until(() => f.logs.includes('survivor-ready'), 'shared surviving caller resumed');
    assert.equal(f.createRequests.length, 1); assert.equal(f.rack.size, 1); assert.equal(f.synth.extraDevices.size, 1);
    assert(!f.logs.includes('cancelled-shared-continuation'));
    await f.finalize();
  });
}

test('all24 lifecycle matrix covers the public Native additional kinds without duplicates', () => {
  assert.equal(EXTRA_KINDS.length, 24); assert.equal(new Set(EXTRA_KINDS).size, 24);
});

test('host disposal detaches a ready Native Worker source before its Worker client cleanup and preserves its sibling', {timeout: 12000}, async t => {
  const env = installCreationEnvironment(t, {holdNotification: message => message.type === 'extra-chip-disposed' && message.id === 'host-dispose'});
  const f = createLifecycleFixture(t, env);
  await f.runtime.playSource(`const a=await createSoundChip('ym2612',{id:'host-dispose'}),b=await createSoundChip('ym2612',{id:'survivor'});liveLoop('owned',async()=>{await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('owned');b.noteOn(1,'D4');log('survivor-after-dispose');},noteOff(){},allNotesOff(){}});log('both-ready');`, {execution: 'worker'});
  await until(() => f.logs.includes('both-ready') && f.runtime.getKeyboardTarget(), 'two Worker devices ready');
  const [retired, survivor] = [...f.synth.extraDevices.values()], retiredPort = retired.node.port, survivorPort = survivor.node.port;
  assert(retired.ready && survivor.ready);
  const worker = env.workers[0], before = env.portMessages.length;
  retired.dispose();
  await until(() => f.rack.size === 1 && !env.ports.has(retiredPort) && worker.heldNotifications.length === 1, 'host-only source and port retirement');
  assert(!worker.messages.some(message => message.command === 'pcm.dispose' && message.args?.[0] === 'host-dispose'), 'Worker cleanup has not reached the host');
  assert.equal(f.runtime.getState().playback, 'running');
  f.runtime.getKeyboardTarget().noteOn({id: 'cancel', midi: 60});
  await until(() => f.logs.includes('survivor-after-dispose') && env.portMessages.slice(before).some(item => item.port === survivorPort && item.message.type === 'performance-cancel-owner'), 'sibling receives cancellation and remains usable');
  assert(!env.portMessages.slice(before).some(item => item.port === retiredPort && item.message.type === 'performance-cancel-owner'), 'Host no longer retains the disposed source port');
  assert.equal(f.synth.extraDevices.size, 1); assert(f.rack.has(survivor.nativeInstance)); assert.equal(f.disposeCount(retired.nativeInstance), 1);
  assert(f.commands().some(command => command.instance === survivor.nativeInstance && command.message?.method === 'write' && command.message.register === 0x28));
  worker.releaseNotifications();
  await until(() => worker.messages.some(message => message.command === 'pcm.dispose' && message.args?.[0] === 'host-dispose'), 'later Worker cleanup delivered');
  assert.equal(f.disposeCount(retired.nativeInstance), 1); assert.equal(f.synth.extraDevices.size, 1);
  await f.finalize();
});
