import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Rf5c164, RF5C164_CLOCK} from '../../web/rf5c164.js';
import {createRf5c164Control} from '../../web/playground_rf5c164.js';
import factory from '../generated/rf5c164_wasm.js';

const source = await readFile(new URL('./examples/mega-cd/megacd-pcm-loop.js', import.meta.url), 'utf8');
const wasmBinary = await readFile(new URL('../generated/rf5c164_wasm.wasm', import.meta.url));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function loadExample({singleMarker = false} = {}) {
  const chip = await Rf5c164.create({moduleFactory: factory, moduleOptions: {wasmBinary}, sampleRate: 48000});
  const control = createRf5c164Control(chip);
  const steps = new Map();
  let loop;
  const pcm = {
    clock: RF5C164_CLOCK,
    loadMemory(bytes) { control.loadMemory(singleMarker ? bytes.slice(0, 129) : bytes); },
    setChannel: (channel, options) => control.setChannel(channel, options),
    setPitch(channel, step) { steps.set(channel, step); control.setPitch(channel, step); },
    keyOn: channel => control.keyOn(channel),
    keyOff: channel => control.keyOff(channel),
  };
  const api = {
    useSoundChip: async name => { assert.equal(name, 'rf5c164'); return pcm; },
    setBpm() {},
    liveLoop(name, callback) { assert.equal(name, 'eight-pcm-voices'); loop = callback; },
    async beat() {},
  };
  try {
    await new AsyncFunction(...Object.keys(api), source)(...Object.values(api));
    assert.equal(typeof loop, 'function');
    await loop(); // Apply the actual example's eight pitches, finishing with all keys off.
    assert.equal(steps.size, 8);
    return {chip, control, steps};
  } catch (error) {
    chip.dispose();
    throw error;
  }
}

function measure(chip, channel, blocks = 100) {
  let quietBlocks = 0, maxAddress = 0, minRms = Infinity;
  for (let block = 0; block < blocks; block++) {
    const output = chip.generateStereo(960); // 20 ms; several waveform periods per block.
    let leftEnergy = 0, rightEnergy = 0;
    for (let i = 0; i < output.left.length; i++) {
      assert.ok(Number.isFinite(output.left[i]) && Number.isFinite(output.right[i]));
      leftEnergy += output.left[i] ** 2;
      rightEnergy += output.right[i] ** 2;
    }
    const rms = Math.sqrt(Math.max(leftEnergy, rightEnergy) / output.left.length);
    minRms = Math.min(minRms, rms);
    if (rms < 0.02) quietBlocks++;
    const address = chip.read(channel * 2) | chip.read(channel * 2 + 1) << 8;
    maxAddress = Math.max(maxAddress, address);
  }
  return {quietBlocks, maxAddress, minRms};
}

test('all eight example notes keep sounding across hundreds of real RF5C164 waveform loops', async () => {
  const {chip, control, steps} = await loadExample();
  try {
    assert.ok([...steps.values()].some(step => step > 2048), 'the example exercises pitches that skip RAM bytes');
    for (const channel of steps.keys()) {
      control.keyOn(channel);
      const result = measure(chip, channel);
      assert.equal(result.quietBlocks, 0, `voice ${channel + 1} remains audible for every 20 ms block: ${JSON.stringify(result)}`);
      assert.ok(result.maxAddress < 160, `voice ${channel + 1} stays in waveform/marker RAM: ${JSON.stringify(result)}`);
      control.keyOff(channel);
      chip.generateStereo(128);
      assert.ok(chip.generateStereo(128).left.every(value => value === 0));
    }
  } finally {
    chip.dispose();
  }
});

test('the former single-marker waveform lets a high note escape into silent zero RAM', async t => {
  const {chip, control, steps} = await loadExample({singleMarker: true});
  try {
    const results = [];
    for (const [channel, step] of steps) {
      if (step <= 2048) continue;
      control.keyOn(channel);
      results.push({channel, step, ...measure(chip, channel)});
      control.keyOff(channel);
    }
    const broken = results.find(result => result.quietBlocks > 90 && result.maxAddress > 160);
    assert.ok(broken, `a former high note must escape waveform RAM and become mostly silent: ${JSON.stringify(results)}`);
    t.diagnostic(`Former single-marker failure: ${JSON.stringify(broken)}`);
  } finally {
    chip.dispose();
  }
});
