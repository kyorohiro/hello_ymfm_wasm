import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundChipMixer, chipMixGains, soundChipMixDefaults} from './soundchip_mixer.js';

test('shared defaults, pre-start partial settings, reset and independent source lifetime', () => {
  const mixer = new SoundChipMixer(), updates = [];
  mixer.set('gb1', {pan: -.5});
  const release = mixer.register('gb1', 'gameboy', settings => updates.push({...settings}));
  assert.deepEqual(mixer.get('gb1'), {volume: .28, pan: -.5, muted: false});
  const other = mixer.register('gb2', 'gameboy', () => {});
  mixer.set('gb1', {volume: .7, muted: true});
  assert.equal(mixer.get('gb2').volume, .28);
  assert.deepEqual(chipMixGains(mixer.get('gb1')), [0, 0]);
  mixer.reset('gb1'); assert.deepEqual(mixer.get('gb1'), soundChipMixDefaults('gameboy'));
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
