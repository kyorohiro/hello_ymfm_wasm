import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PlaybackMixer} from './playback_mixer.js';
import {createPlaybackEngine, createPlaybackPlayer} from './playback_core.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {getNodePlaybackFactory} from '../../cli/render.js';

const source = () => ({frames: 0, generateStereo(n) {
  this.frames += n;
  return {left: new Float32Array(n).fill(.8), right: new Float32Array(n).fill(.4)};
}});
test('independent gain, stereo balance and mute preserve synthesis and original PCM at defaults', () => {
  const mixer = new PlaybackMixer(), a = source(), b = source();
  mixer.addSource('a', a); mixer.addSource('b', b);
  assert.equal(a.generateStereo(1).left[0], Math.fround(.8));
  mixer.set('a', {gain: .5, pan: 1}); mixer.reset();
  assert.deepEqual(a.generateStereo(1), {left: Float32Array.of(0), right: Float32Array.of(.2)});
  assert.equal(b.generateStereo(1).left[0], Math.fround(.8));
  mixer.set('a', {muted: true}); mixer.reset();
  assert.equal(a.generateStereo(3).right[0], 0); assert.equal(a.frames, 5);
  mixer.set('a', {muted: false, pan: -1}); mixer.reset();
  assert.equal(a.generateStereo(1).left[0], Math.fround(.4));
  assert.equal(a.generateStereo(1).right[0], 0);
  assert.throws(() => mixer.set('a', {gain: NaN}), RangeError);
  assert.throws(() => mixer.set('a', {pan: 2}), RangeError);
});
test('gain ramps are continuous across render boundaries; Into respects frame count', () => {
  const pass = sizes => {
    const chip = source(), mixer = new PlaybackMixer(); mixer.addSource('a', chip, 'generateStereo', 1000);
    mixer.set('a', {gain: 0});
    return sizes.flatMap(n => [...chip.generateStereo(n).left]);
  };
  assert.deepEqual(pass([8]), pass([1, 2, 5]));
  const chip = {generateStereoInto(l, r, n = l.length) {l.fill(1, 0, n); r.fill(1, 0, n);}};
  const mixer = new PlaybackMixer(); mixer.addSource('a', chip, 'generateStereoInto');
  mixer.set('a', {gain: .5}); mixer.reset();
  const l = new Float32Array(4).fill(9), r = l.slice(); chip.generateStereoInto(l, r, 2);
  assert.deepEqual([...l], [.5, .5, 9, 9]);
  chip.generateStereoInto(l, r); assert.deepEqual([...l], [.5, .5, .5, .5]);
});
test('actual Game Boy VGM gain, pan and mute survive player restart and WAV rendering', async () => {
  const bytes = await readFile(new URL('../../test/fixtures/gameboy-tone.vgm', import.meta.url));
  const render = async settings => {
    const engine = await createPlaybackEngine(new Ym2612VGM(bytes), {getFactory: getNodePlaybackFactory});
    try {
      assert.deepEqual([...engine.playbackMixer.strips.keys()], ['gameBoyDmg']);
      engine.playbackMixer.set('gameBoyDmg', settings);
      const player = createPlaybackPlayer(engine, bytes); player.stop(); player.play();
      const l = new Float32Array(4096), r = l.slice(); player.process(l, r, l.length);
      const {renderVgmToWav} = await import('./vgm_wav.js');
      player.stop(); player.play(); const wav = await renderVgmToWav(player, {maxSeconds: .02});
      return {l, r, wav};
    } finally {engine.dispose();}
  };
  const full = await render({}), half = await render({gain: .5}), muted = await render({muted: true}), left = await render({pan: -1});
  assert(full.l.some(v => v !== 0));
  assert.deepEqual(half.l, full.l.map(v => v * .5));
  assert.deepEqual(left.l, full.l); assert(left.r.every(v => v === 0));
  assert(muted.l.every(v => v === 0)); assert(muted.r.every(v => v === 0));
  assert(muted.wav.bytes.subarray(44).every(v => v === 0));
});
