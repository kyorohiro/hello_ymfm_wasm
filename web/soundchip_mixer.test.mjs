import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundChipMixer, chipMixGains, soundChipMixDefaults} from './soundchip_mixer.js';

test('shared defaults, pre-start partial settings, reset and independent source lifetime', () => {
  assert.deepEqual(soundChipMixDefaults(), {volume:1,pan:0,muted:false});
  const mixer = new SoundChipMixer(), updates = [];
  mixer.set('gb1', {pan: -.5});
  const release = mixer.register('gb1', 'gameboy', settings => updates.push({...settings}));
  assert.deepEqual(mixer.get('gb1'), {volume: .28, pan: -.5, muted: false, solo: false});
  const other = mixer.register('gb2', 'gameboy', () => {});
  mixer.set('gb1', {volume: .7, muted: true});
  assert.equal(mixer.get('gb2').volume, .28);
  assert.deepEqual(chipMixGains(mixer.get('gb1')), [0, 0]);
  mixer.reset('gb1'); assert.deepEqual(mixer.get('gb1'), {...soundChipMixDefaults('gameboy'), solo: false});
  assert.throws(() => mixer.register('gb1', 'gameboy', () => {}), /already connected/);
  assert.throws(() => mixer.set('gb1', {volume: NaN}), RangeError);
  assert.throws(() => mixer.set('gb1', {pan: 2}), RangeError);
  assert.throws(() => mixer.set('gb1', {gain: .3}), TypeError);
  release(); release(); assert.deepEqual(mixer.list().map(s => s.id), ['gb2']);
  const replacement = mixer.register('gb1', 'gameboy', () => {});
  release(); assert.equal(mixer.list().length, 2);
  replacement(); other(); assert.deepEqual(mixer.list(), []);
  assert(updates.length >= 3);
});

test('browser stereo routing applies defaults, ramps changes and unregisters only its own connection', () => {
  const nodes = [];
  const node = () => {
    const value = {targets: [], gain: {value: 1, calls: [], cancelAndHoldAtTime(t){this.calls.push(['hold',t]);}, linearRampToValueAtTime(v,t){this.calls.push(['ramp',v,t]);}},
      connect(target, output, input){this.targets.push({target, output, input});},
      disconnect(target){this.targets = target ? this.targets.filter(t => t.target !== target) : [];}};
    nodes.push(value); return value;
  };
  const context = {currentTime: 10, createGain: node, createChannelSplitter: node, createChannelMerger: node};
  const source = node(), destination = node(), mixer = new SoundChipMixer();
  const release = mixer.connect('gb', 'gameboy', source, destination, context);
  const [left, right, splitter, merger] = nodes.slice(2);
  assert.equal(left.gain.value, .28); assert.equal(right.gain.value, .28);
  assert.equal(source.targets[0].target, splitter); assert.equal(merger.targets[0].target, destination);
  mixer.set('gb', {volume: .5, pan: -1});
  assert.deepEqual(left.gain.calls.at(-1), ['ramp', .5, 10.005]);
  assert.deepEqual(right.gain.calls.at(-1), ['ramp', 0, 10.005]);
  release(); assert.equal(source.targets.length, 0); assert.equal(mixer.list().length, 0);
});

test('initializing outputs reserve automatic and explicit IDs before any awaits', () => {
 const mixer=new SoundChipMixer();
 const a=mixer.reserveId('gameboy'),b=mixer.reserveId('gameboy');assert.notEqual(a.id,b.id);
 const manual=mixer.reserveId('gameboy','lead');assert.throws(()=>mixer.reserveId('gameboy','lead'),/initializing/);
 manual.release();const retry=mixer.reserveId('gameboy','lead');manual.release();assert.throws(()=>mixer.reserveId('gameboy','lead'),/initializing/);
 const release=mixer.register(retry.id,'gameboy',()=>{});retry.release();
 assert.throws(()=>mixer.reserveId('gameboy','lead'),/connected/);
 release();assert.doesNotThrow(()=>mixer.reserveId('gameboy','lead').release());a.release();b.release();
});


test('multiple solos suppress other strips without changing manual mute and disconnected solo does not suppress', () => {
  const mixer = new SoundChipMixer(), applied = {};
  const releaseA = mixer.register('a', 'ym2612', settings => {applied.a = chipMixGains(settings);});
  mixer.register('b', 'segapsg', settings => {applied.b = chipMixGains(settings);});
  mixer.register('c', 'pwm', settings => {applied.c = chipMixGains(settings);});
  mixer.set('a', {solo: true});
  assert.deepEqual(applied, {a: [1,1], b: [0,0], c: [0,0]});
  assert.equal(mixer.get('b').muted, false);
  mixer.set('b', {solo: true, muted: true});
  assert.deepEqual(applied.b, [0,0]);
  mixer.set('a', {solo: false});
  assert.deepEqual(applied.a, [0,0]);
  mixer.set('b', {solo: false});
  assert.deepEqual(applied, {a: [1,1], b: [0,0], c: [1,1]});
  mixer.set('a', {solo: true}); releaseA();
  assert.deepEqual(applied.c, [1,1]);
  assert.equal(mixer.list().some(entry => entry.id === 'a'), false);
  assert.equal(mixer.get('a').solo, true);
});

test('explicit source settings survive release and reconnect while automatic sources remain transient', () => {
  const mixer = new SoundChipMixer();
  const release = mixer.register('lead', 'gameboy', () => {});
  mixer.set('lead', {volume: .7, pan: .4, muted: true, solo: true}); release();
  assert.deepEqual(mixer.list(), []);
  const updates = [];
  mixer.register('lead', 'gameboy', settings => updates.push(settings));
  assert.deepEqual(mixer.get('lead'), {volume: .7, pan: .4, muted: true, solo: true});
  assert.equal(updates[0].effectiveMuted, true);
  const automatic = mixer.reserveId('ym2612');
  const remove = mixer.register(automatic.id, 'ym2612', () => {}); automatic.release();
  mixer.set(automatic.id, {volume: .2}); remove();
  assert.equal(mixer.retained.has(automatic.id), false);
  mixer.reset();
  assert.deepEqual(mixer.get('lead'), {...soundChipMixDefaults('gameboy'), solo: false});
});

test('change subscriptions mirror script updates and meter subscriptions control endpoint lifetime', () => {
  const mixer = new SoundChipMixer(), changes = [], enabled = [], peaks = [];
  const unsubscribe = mixer.subscribe(entries => changes.push(entries));
  const release = mixer.register('x', 'ym2612', () => {}, {setMetering: value => enabled.push(value)});
  assert.deepEqual(enabled, [false]);
  const a = mixer.subscribeMeters(entries => peaks.push(entries));
  const b = mixer.subscribeMeters(() => {});
  assert.deepEqual(enabled, [false, true]);
  mixer.reportMeter('x', .3, .7); assert.deepEqual(peaks, [[{id:'x', left:.3, right:.7}]]);
  mixer.set('x', {volume: .5}); assert.equal(changes.at(-1)[0].volume, .5);
  a(); a(); assert.deepEqual(enabled, [false,true]); b();
  assert.deepEqual(enabled, [false,true,false]);
  mixer.reportMeter('x', 1, 1); assert.equal(peaks.length, 1);
  release(); assert.deepEqual(changes.at(-1), []);
  unsubscribe(); const count = changes.length; mixer.set('x', {solo:false}); assert.equal(changes.length,count);
});

test('node metering only allocates and samples while subscribed, and removes only its branch', async () => {
  const nodes = [], samples = [];
  const node = () => {
    const value = {targets: [], gain: {value:1, cancelAndHoldAtTime(){}, linearRampToValueAtTime(){}},
      connect(target, output, input){this.targets.push({target, output, input});},
      disconnect(target){this.targets = target ? this.targets.filter(t => t.target !== target) : [];}};
    nodes.push(value); return value;
  };
  const context = {currentTime:0,createGain:node,createChannelSplitter:node,createChannelMerger:node,
    createAnalyser(){const value=node(); value.getFloatTimeDomainData=buffer=>{buffer.fill(nodes.indexOf(value)%2 ? -.4 : .2); samples.push(value);}; return value;}};
  const source=node(),dest=node(),mixer=new SoundChipMixer();
  const release=mixer.connect('a','ym2612',source,dest,context);
  const [left,right]=nodes.slice(2); assert.equal(nodes.length,6);
  const peaks=[]; const stop=mixer.subscribeMeters(entries=>peaks.push(entries));
  assert.equal(nodes.length,9); assert.equal(left.targets.length,2); assert.equal(right.targets.length,2);
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(peaks.length,1); assert.equal(samples.length,2);
  assert.deepEqual([peaks[0][0].left,peaks[0][0].right].map(v=>Math.round(v*10)),[2,4]);
  stop(); assert.equal(left.targets.length,1); assert.equal(right.targets.length,1);
  const count=samples.length; await new Promise(resolve=>setTimeout(resolve,80)); assert.equal(samples.length,count);
  release(); assert.equal(source.targets.length,0);
});


test('throwing observers do not interrupt source registration, meter delivery or cleanup', () => {
  const previous = globalThis.reportError, errors = [], changes = [], meters = [], enabled = [];
  globalThis.reportError = error => errors.push(error);
  try {
    const mixer = new SoundChipMixer();
    mixer.subscribe(() => {throw new Error('observer failure');});
    mixer.subscribe(entries => changes.push(entries));
    const stopBroken = mixer.subscribeMeters(() => {throw new Error('meter observer failure');});
    const stopMeters = mixer.subscribeMeters(entries => meters.push(entries));
    const release = mixer.register('lead', 'ym2612', () => {}, {setMetering: value => enabled.push(value)});
    mixer.reportMeter('lead', .2, .3);
    assert.equal(meters.length, 1);
    assert.equal(changes.at(-1)[0].id, 'lead');
    release(); assert.deepEqual(changes.at(-1), []);
    assert.deepEqual(enabled, [true, false]);
    stopBroken(); stopMeters();
    assert.equal(errors.length, 3);
    assert.equal(mixer.entries.size, 0);
  } finally {
    if (previous === undefined) delete globalThis.reportError;
    else globalThis.reportError = previous;
  }
});
