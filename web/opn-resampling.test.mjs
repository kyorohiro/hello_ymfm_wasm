import test from 'node:test';
import assert from 'node:assert/strict';

for (const tree of ['web', 'docs/js']) {
  for (const [file, name] of [
    ['ym2203audioengine', 'Ym2203AudioEngine'],
    ['ym2608audioengine', 'Ym2608AudioEngine'],
    ['ym2610baudioengine', 'Ym2610BAudioEngine'],
  ]) {
    const { [name]: Engine } = await import(`../${tree}/${file}.js`);
    const setup = (sourceRate, outputRate) => {
      const chip = {
        frames: 0,
        reset() { this.frames = 0; },
        setMuteMask() {}, clearAdpcmBMemory() {}, clearAdpcmRoms() {},
        generateStereo(n) {
          assert.ok(n > 0);
          const left = Float32Array.from({ length: n }, () => ++this.frames);
          return { left, right: Float32Array.from(left, x => -x) };
        },
      };
      return { chip, engine: new Engine(chip, sourceRate, outputRate) };
    };
    test(`${tree} ${name}: upsampling holds stereo samples across calls and clears them on reset`, () => {
      const { chip, engine } = setup(48000, 96000);
      const a = engine.processFrames(3), b = engine.processFrames(5);
      assert.deepEqual([...a.left, ...b.left], [0,1,1,2,2,3,3,4]);
      assert.deepEqual([...a.right, ...b.right], [0,-1,-1,-2,-2,-3,-3,-4]);
      assert.equal(chip.frames, 4);
      engine.setMasterVolume(0.5);
      assert.equal(engine.processFrames(1).left[0], 2);
      engine.reset();
      assert.equal(engine.processFrames(1).left[0], 0);
      assert.equal(chip.frames, 0);
    });
    test(`${tree} ${name}: fractional conversion preserves time across buffer boundaries`, () => {
      const { chip, engine } = setup(32000, 44100);
      for (let i = 0; i < 100; i++) engine.processFrames(441);
      assert.equal(chip.frames, 32000);
    });
    test(`${tree} ${name}: downsampling still averages the source frames`, () => {
      const { chip, engine } = setup(96000, 48000);
      const pcm = engine.processFrames(3);
      assert.deepEqual([...pcm.left], [1.5,3.5,5.5]);
      assert.deepEqual([...pcm.right], [-1.5,-3.5,-5.5]);
      assert.equal(chip.frames, 6);
    });
  }
}
