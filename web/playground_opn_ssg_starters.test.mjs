import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ym2203} from './ym2203.js';
import {Ym2608} from './ym2608.js';
import {Ym2610B} from './ym2610b.js';
import {SSGSynth} from './ssgsynth.js';

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const fixtures = [
  {chip:'ym2203', Chip:Ym2203, mode:'pc98-26', example:'pc98/pc98-opn-melody.js', periodFrames:128},
  {chip:'ym2608', Chip:Ym2608, mode:'pc98', example:'pc98/pc98-opna-groove.js', periodFrames:128},
  {chip:'ym2610b', Chip:Ym2610B, variant:false, mode:'neogeo', example:'neogeo/neogeo-opnb-duet.js', periodFrames:64},
  {chip:'ym2610b', Chip:Ym2610B, variant:true, mode:'neogeo', example:'neogeo/neogeo-opnb-duet.js', periodFrames:64},
];
function periodicError(pcm, period) {
  let sum = 0;
  for (let i = period; i < pcm.length; i++) sum += Math.abs(pcm[i] - pcm[i - period]);
  return sum / (pcm.length - period);
}
for (const fixture of fixtures) test(`${fixture.mode} ${fixture.variant === true ? 'YM2610B' : fixture.chip} starter keeps SSG noise disabled across notes`, async () => {
  const {default:moduleFactory} = await import(`../docs/generated/${fixture.chip}_wasm.js`);
  const chip = await fixture.Chip.create({moduleFactory, variant:fixture.variant, moduleOptions:{
    wasmBinary:await readFile(new URL(`../docs/generated/${fixture.chip}_wasm.wasm`, import.meta.url)),
  }});
  const readRegister = register => {chip.write(0, register); return chip.read(1);};
  const createSsg = () => new SSGSynth({clock:2000000, transport:{write(register, value) {
    chip.write(0, register); chip.write(1, value);
  }}});
  try {
    assert.equal(readRegister(7),0,'the native reset enables tone and noise mixer gates');
    const old = createSsg();
    old.setTonePeriod(0,16); old.setVolume(0,8); old.keyOn(0);
    chip.generateStereo(1024);
    assert.ok(periodicError(chip.generateStereo(4096).left,fixture.periodFrames) > 0.001,
      'a bare noteOn retains reset noise gates and produces a nonperiodic signal');

    for (const path of [`defaults/${fixture.mode}/index.js`,`examples/${fixture.example}`]) {
      chip.reset();
      const ssg = createSsg(), pause = new Error('first note reached');
      let loop;
      const source = await readFile(new URL(`../docs/playground/${path}`, import.meta.url),'utf8');
      // Isolate the starter's SSG through the real chip. FM and intentional
      // rhythm percussion are separate sound sources and are silent here.
      await new AsyncFunction('setBpm','fm','CH1','FM_PRESETS','ssg','rhythm','liveLoop','play','beat',source)(
        () => {}, {setPreset() {}}, 0, {}, ssg, {setVolume() {},setVoice() {},keyOn() {}},
        (_name,callback) => {loop = callback;}, async () => {throw pause;}, async () => {});
      assert.equal(typeof loop,'function');
      assert.equal(readRegister(7) & 8,8,`${path} disables channel 0 noise before playback`);
      await assert.rejects(loop(),error => error === pause);
      assert.equal(readRegister(8),8);
      // A period of 16 has an integral native PCM period, allowing a strict
      // test for unwanted noise without relying on a spectrum threshold.
      ssg.setTonePeriod(0,16); chip.generateStereo(1024);
      const pcm = chip.generateStereo(4096).left;
      assert.ok(pcm.some(value => value !== 0),'the bass remains audible');
      assert.equal(periodicError(pcm,fixture.periodFrames),0,`${path} emits tone without noise`);
      ssg.keyOff(0); chip.generateStereo(128);
      assert.ok(chip.generateStereo(128).left.every(value => value === 0));
      ssg.noteOn(0,'G2');
      assert.equal(readRegister(7) & 8,8,'later noteOn preserves the starter mixer choice');
    }
  } finally {chip.dispose();}
});
