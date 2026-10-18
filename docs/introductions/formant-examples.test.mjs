import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {formantProcess, createFormantExample} from './formant-examples.js';
import {createNativeFXController} from '../../web/native_fx.js';
import {LiveFX} from '../../web/custom_fx.js';
import {spectrum} from '../playground/playground_fx_monitor.js';
import ym2612Factory from '../generated/ym2612_wasm.js';
import {Ym2612} from '../../web/ym2612.js';
import {YM2612Synth, YM2612DirectTransport} from '../../web/ym2612synth.js';
import {FM_PRESETS} from '../../web/megasynth-fm-presets.js';

// Compile the same serialized function in a Worklet-like global realm. Importing
// the function directly would incorrectly let it see this test's globals.
const rackSource = (await readFile(new URL('../../web/custom_fx.js', import.meta.url), 'utf8'))
  .replace('export class LiveFX', 'class LiveFX') + '\nglobalThis.LiveFX = LiveFX;';
function fixture(rate, patch = {}) {
  const scope = vm.createContext({sampleRate: rate});
  vm.runInContext(rackSource, scope);
  const rack = new scope.LiveFX(rate), errors = [];
  const fx = createNativeFXController(message => rack.command(message));
  const context = {vowel: 0, autoVowels: false, transitionMs: 60, gain: 4, mix: 1, ...patch};
  fx.liveFx('formant-test', {process: formantProcess, context});
  return {
    rack, fx, errors,
    get state() { return rack.effects.get('formant-test').state; },
    process(channels) { rack.process(channels, message => errors.push(message)); return channels; },
    processDirect(channels) {
      const output = channels.map(channel => new Float32Array(channel.length));
      const effect = rack.effects.get('formant-test');
      effect.fn(channels, output, effect.state, effect.context);
      return output;
    },
    update(patch) { fx.updateContext('formant-test', patch); },
    apply(patch, resetState = false) {
      fx.liveFx('formant-test', {process: formantProcess, context: {...context, ...patch}, resetState});
    },
  };
}
function carrier(frame, rate) {
  // Deterministic band-rich source, with no out-of-band square-wave aliases.
  let sum = 0;
  for (let harmonic = 1; harmonic <= 25; harmonic++) {
    const frequency = 130 * harmonic;
    if (frequency < rate * .45) sum += Math.sin(frame * 2 * Math.PI * frequency / rate) / harmonic;
  }
  return sum * .12;
}
function render(f, frames, {rate = f.state?.rate ?? 48000, block = 128, start = 0, right = 'same', signal = carrier} = {}) {
  const left = new Float32Array(frames), other = new Float32Array(frames);
  for (let offset = 0; offset < frames; offset += block) {
    const n = Math.min(block, frames - offset), channels = [new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) {
      channels[0][i] = signal(start + offset + i, rate);
      channels[1][i] = right === 'same' ? channels[0][i] : 0;
    }
    f.process(channels); left.set(channels[0], offset); other.set(channels[1], offset);
  }
  return [left, other];
}
function finiteBounded(channels, limit = .750001) {
  for (const channel of channels) for (const sample of channel) {
    assert.ok(Number.isFinite(sample), 'finite PCM');
    assert.ok(Math.abs(sample) <= limit, 'bounded PCM: ' + sample);
  }
}

for (const rate of [16000, 32000, 44100, 48000, 96000]) {
  test(`serialized formants at ${rate} Hz preserve PCM across 1/17/128-frame blocks and isolate stereo`, () => {
    const settings = {autoVowels: true, vowelSeconds: .25, lfoHz: 2.3, lfoDepth: .7};
    const reference = fixture(rate, settings), small = fixture(rate, settings), irregular = fixture(rate, settings);
    const a = render(reference, 8192, {rate, block: 128});
    const b = render(small, 8192, {rate, block: 1});
    const c = render(irregular, 8192, {rate, block: 17});
    assert.deepEqual(a, b); assert.deepEqual(a, c);
    assert.deepEqual(a[0], a[1], 'same input and controls produce synchronized stereo');
    assert.equal(reference.state.rate, rate, 'uses the actual Worklet rate');
    assert.ok(a[0].some(value => Math.abs(value) > .001), 'audible output');
    finiteBounded(a);
    const isolated = fixture(rate);
    const stereo = render(isolated, 4096, {rate, right: 'silent'});
    assert.ok(stereo[1].every(value => value === 0), 'left history never enters the right channel');
    assert.deepEqual(reference.errors, []); assert.deepEqual(isolated.errors, []);
  });
}

test('five vowels have different spectral envelopes at both 44.1 and 48 kHz', t => {
  for (const rate of [44100, 48000]) {
    const envelopes = [];
    for (let vowel = 0; vowel < 5; vowel++) {
      const f = fixture(rate, {vowel, gain: 2});
      const audio = render(f, Math.round(rate * .7) + 8192, {rate})[0];
      const bins = spectrum(audio.slice(-8192));
      const bands = [[200, 450], [450, 1000], [1000, 1500], [1700, 2500], [2500, 3400]];
      const powers = bands.map(([low, high]) => {
        let power = 0;
        for (let bin = Math.ceil(low * 8192 / rate); bin <= Math.floor(high * 8192 / rate); bin++) power += 10 ** (bins[bin] / 10);
        return power;
      });
      const total = powers.reduce((sum, power) => sum + power, 0);
      envelopes.push(powers.map(power => power / total));
      assert.deepEqual(f.errors, []);
    }
    let minimum = Infinity;
    for (let a = 0; a < envelopes.length; a++) for (let b = a + 1; b < envelopes.length; b++) {
      const distance = envelopes[a].reduce((sum, value, i) => sum + Math.abs(value - envelopes[b][i]), 0);
      minimum = Math.min(minimum, distance);
      assert.ok(distance > .1, `vowels ${a}/${b} have distinct band-power ratios at ${rate} Hz: ${distance}`);
    }
    t.diagnostic(`${rate} Hz: minimum five-band normalized spectral distance ${minimum.toFixed(3)}`);
  }
});

test('same-name Apply preserves integrators and smoothly changes vowel/gain without a reset transient', () => {
  const rate = 48000, warmFrames = 24000, patch = {vowel: 1, gain: 8, mix: .75};
  const applied = fixture(rate), contextUpdate = fixture(rate), reset = fixture(rate);
  const warm = render(applied, warmFrames, {rate});
  render(contextUpdate, warmFrames, {rate}); render(reset, warmFrames, {rate});
  const memory = applied.state.memory, integrators = applied.state.memory[0], before = Array.from(integrators);
  applied.apply(patch); contextUpdate.update(patch); reset.apply(patch, true);
  assert.equal(applied.state.memory, memory); assert.equal(applied.state.memory[0], integrators);
  assert.deepEqual(Array.from(integrators), before, 'registration does not clear the integrators');
  const a = render(applied, 4096, {rate, start: warmFrames});
  const b = render(contextUpdate, 4096, {rate, start: warmFrames});
  const c = render(reset, 4096, {rate, start: warmFrames});
  assert.deepEqual(a, b, 'Apply and partial context update have identical DSP continuation');
  assert.notDeepEqual(a, c, 'a reset deliberately loses the existing filter state');
  const previous = warm[0].at(-1), preservedStep = Math.abs(a[0][0] - previous), resetStep = Math.abs(c[0][0] - previous);
  assert.ok(preservedStep < .04, `small Apply-boundary change: ${preservedStep}`);
  assert.ok(resetStep > preservedStep, `preserved continuation ${preservedStep} < reset discontinuity ${resetStep}`);
  finiteBounded(a, 1); assert.deepEqual(applied.errors, []);
});

test('invalid/extreme controls stay finite and do not bypass the FX; DSP sanitizes nonfinite source samples', () => {
  const rate = 48000, f = fixture(rate);
  const invalids = [NaN, Infinity, -Infinity, -1e300, 1e300, undefined, null, 'bad'];
  let start = 0;
  for (const value of invalids) {
    f.update({vowel: value, vowelSeconds: value, transitionMs: value, lfoHz: value, lfoDepth: value,
      gain: value, mix: value, formants: [[value, value, value]], bandwidths: [value, value, value], levels: [value, value, value]});
    const out = render(f, 8192, {rate, start, signal: frame => [NaN, Infinity, -Infinity, 1e30, -1e30, .2, -.3, 0][frame % 8]});
    finiteBounded(out, 1.000001); start += 8192;
    // Also exercise the serialized DSP independently of rack mixing/clipping.
    const source = Float32Array.of(NaN, Infinity, -Infinity, 1e30, -1e30, .2, -.3, 0);
    finiteBounded(f.processDirect([source, source.slice()]), 1.000001);
  }
  assert.deepEqual(f.errors, []);
  assert.equal(f.rack.effects.get('formant-test').bypass, false);
});

test('120 seconds of changing targets, LFO, gain and mix remain bounded with stable channel state', t => {
  const rate = 16000, f = fixture(rate, {autoVowels: true, vowelSeconds: .25, lfoHz: 8, lfoDepth: 1, gain: 12});
  const channels = [new Float32Array(128), new Float32Array(128)];
  const total = rate * 120, started = performance.now();
  let peak = 0, energy = 0;
  for (let frame = 0; frame < total; frame += 128) {
    if (frame % (128 * 50) === 0) f.update({vowel: (frame / 6400) % 5,
      autoVowels: (frame / 6400) % 2 === 0, lfoDepth: (frame / 6400) % 3 / 2,
      gain: (frame / 6400) % 13, mix: (frame / 6400) % 5 / 4,
      bandwidths: [40, 600, 40], levels: [2, .5, 2]});
    for (let i = 0; i < 128; i++) {
      const phase = ((frame + i) * 137 / rate) % 1;
      channels[0][i] = phase < .5 ? .3 : -.3;
      channels[1][i] = 0;
    }
    f.process(channels);
    for (let i = 0; i < 128; i++) {
      const value = channels[0][i];
      if (!Number.isFinite(value) || Math.abs(value) > 1.000001) assert.fail('unstable PCM at ' + (frame + i));
      if (channels[1][i] !== 0) assert.fail('stereo state leaked');
      peak = Math.max(peak, Math.abs(value)); energy += value * value;
    }
  }
  assert.ok(energy > 1); assert.deepEqual(f.errors, []);
  assert.equal(f.state.memory.length, 2); assert.equal(f.state.memory[0].length, 6);
  assert.ok(f.state.memory.every(channel => Array.from(channel).every(Number.isFinite)));
  t.diagnostic(`120 s simulated at 16 kHz in ${(performance.now() - started).toFixed(1)} ms; peak=${peak.toFixed(4)}`);
});

test('representative 256k-frame stereo DSP timing is reported without a machine-dependent threshold', t => {
  const rate = 48000, rack = new LiveFX(rate), errors = [];
  const fx = createNativeFXController(message => rack.command(message));
  fx.liveFx('formant-test', {process: formantProcess, context: {autoVowels: true, lfoHz: .8, lfoDepth: .3}});
  const originalRate = Object.getOwnPropertyDescriptor(globalThis, 'sampleRate');
  Object.defineProperty(globalThis, 'sampleRate', {configurable: true, value: rate});
  const channels = [new Float32Array(128).fill(.2), new Float32Array(128).fill(-.2)];
  try {
    for (let i = 0; i < 100; i++) rack.process(channels.map(channel => channel.slice()), error => errors.push(error));
    const started = performance.now();
    for (let i = 0; i < 2048; i++) {
      channels[0].fill(.2); channels[1].fill(-.2); rack.process(channels, error => errors.push(error));
    }
    const elapsed = performance.now() - started;
    assert.deepEqual(errors, []);
    t.diagnostic(`262144 stereo frames: ${elapsed.toFixed(1)} ms CPU for ${(262144 / rate).toFixed(3)} s audio; ordinary JS realm, includes LiveFX copying and finite checks`);
  } finally {
    if (originalRate) Object.defineProperty(globalThis, 'sampleRate', originalRate);
    else delete globalThis.sampleRate;
  }
});

test('example A/B/C use supported APIs, preserve a sustained source on Apply, and separate pitch from formants', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const experiment of ['A', 'B', 'C']) {
    const f = fixture(48000), prepared = new Map(), loops = new Map(), notes = [], keys = [];
    let position = 0;
    const psg = {setFrequency(channel, hz) {assert.equal(channel, 0); notes.push(hz);},
      setAttenuation(channel, attenuation) {assert.equal(channel, 0); assert.equal(attenuation, 5);},
      keyOn(channel) {keys.push(channel);}};
    const api = {psg, PSG1: 0, liveFx: f.fx.liveFx, liveLoop(name, fn) {loops.set(name, fn);},
      livePrepare: async (name, fn) => {if (!prepared.has(name)) prepared.set(name, await fn()); return prepared.get(name);},
      cycle(values) {return values[position++ % values.length];}, sleep: async seconds => assert.equal(seconds, .6)};
    const source = createFormantExample('pitch').replace(/(?:const|let) experiment = 'A';/, `let experiment = '${experiment}';`);
    await new AsyncFunction(...Object.keys(api), source)(...Object.values(api));
    assert.equal(loops.size, 1); assert.deepEqual(keys, [0]);
    const fn = [...loops.values()][0]; for (let i = 0; i < 4; i++) await fn();
    const effect = f.rack.effects.get('formant-pitch');
    assert.equal(effect.context.autoVowels, experiment !== 'B');
    assert.equal(effect.context.vowel, 0);
    if (experiment === 'A') assert.ok(notes.every(hz => hz === 130));
    else assert.ok(new Set(notes).size >= 3, 'B/C change source pitch');
    const state = effect.state;
    await new AsyncFunction(...Object.keys(api), source)(...Object.values(api));
    assert.deepEqual(keys, [0], 'Apply does not key the sustained source on again');
    assert.equal(f.rack.effects.get('formant-pitch').state, state, 'Apply retains formant state');
  }
  for (const kind of ['vowels', 'voice', 'pitch', 'ym2612']) {
    const source = createFormantExample(kind);
    assert.ok(source.includes('process: formantProcess'));
    assert.ok(source.includes(`liveFx('formant-${kind}'`));
    assert.ok(!source.includes('resetState: true'));
  }
  assert.throws(() => createFormantExample('unknown'), /Unknown formant lesson/);
});

test('the YM2612 lesson drives a real WASM carrier through formants and preserves its voice when Run again edits source parameters', async t => {
  const chip = await Ym2612.create({moduleFactory: ym2612Factory,
    moduleOptions: {wasmBinary: await readFile(new URL('../generated/ym2612_wasm.wasm', import.meta.url))}});
  try {
    const transport = new YM2612DirectTransport(chip), writes = [], calls = [];
    const write = transport.write.bind(transport);
    transport.write = (port, register, value) => {writes.push({port, register, value}); write(port, register, value);};
    const synth = new YM2612Synth({transport}), rate = chip.sampleRate(), f = fixture(rate);
    f.fx.removeLiveFx('formant-test');
    const fm = new Proxy(synth, {get(target, name) {
      const value = Reflect.get(target, name);
      return typeof value === 'function' ? (...args) => {calls.push({name, args}); return value.apply(target, args);} : value;
    }});
    const prepared = new Map(), loops = new Map(); let cyclePosition = 0;
    const api = {fm, FM_PRESETS, CH1: 0, OP1: 0, OP4: 3, liveFx: f.fx.liveFx,
      livePrepare: async (name, fn) => {if (!prepared.has(name)) prepared.set(name, await fn()); return prepared.get(name);},
      liveLoop: (name, fn) => loops.set(name, fn), cycle: values => values[cyclePosition++ % values.length],
      sleep: async seconds => assert.equal(seconds, .6)};
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const execute = source => new AsyncFunction(...Object.keys(api), source)(...Object.values(api));
    const original = createFormantExample('ym2612');
    await execute(original);
    assert.equal(loops.size, 1);
    assert.deepEqual(calls.filter(call => call.name === 'keyOn').map(call => call.args), [[0, [0]]]);
    const effect = f.rack.effects.get('formant-ym2612');
    assert.equal(effect.context.autoVowels, true, 'A changes vowel color');
    calls.length = 0;
    for (let i = 0; i < 4; i++) await [...loops.values()][0]();
    assert.deepEqual(calls.filter(call => call.name === 'setFrequency').map(call => call.args[1]), [130, 130, 130, 130], 'A keeps the carrier pitch fixed');

    chip.generateStereo(Math.round(rate * .1));
    const dry = chip.generateStereo(16384), bins = spectrum(dry.left);
    const bandPower = harmonic => {
      const centre = Math.round(130 * harmonic * dry.left.length / rate); let power = 0;
      for (let bin = centre - 2; bin <= centre + 2; bin++) power += 10 ** (bins[bin] / 10);
      return power;
    };
    const harmonicRatio = Array.from({length: 11}, (_, i) => bandPower(i + 2)).reduce((a, b) => a + b, 0) / bandPower(1);
    assert.ok(harmonicRatio > .05, 'feedback supplies harmonics for the formant filters: ' + harmonicRatio);
    const processPcm = pcm => {
      const output = [new Float32Array(pcm.left.length), new Float32Array(pcm.right.length)];
      for (let offset = 0; offset < pcm.left.length; offset += 128) {
        const channels = [pcm.left.slice(offset, offset + 128), pcm.right.slice(offset, offset + 128)];
        f.process(channels); output[0].set(channels[0], offset); output[1].set(channels[1], offset);
      }
      finiteBounded(output); return output;
    };
    const wet = processPcm(dry);
    const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
    assert.ok(rms(wet[0]) > .0001, 'real FM source remains audible after filtering');
    assert.ok(rms(wet[0].map((value, i) => value - dry.left[i])) > .001, 'the filter actually changes the real carrier');
    assert.deepEqual(wet[0], wet[1], 'the panned carrier and filter stay synchronized');
    const state = effect.state, integrators = effect.state.memory[0], before = Array.from(integrators);

    const fixed = original.replace("let experiment = 'A';", "let experiment = 'B';")
      .replace('const fixedVowel = 0;', 'const fixedVowel = 2;');
    assert.notEqual(fixed, original);
    await execute(fixed);
    assert.equal(f.rack.effects.get('formant-ym2612').state, state, 'Run again retains DSP state');
    assert.equal(state.memory[0], integrators); assert.deepEqual(Array.from(integrators), before);
    assert.equal(f.rack.effects.get('formant-ym2612').context.autoVowels, false, 'B holds the selected vowel');
    assert.equal(f.rack.effects.get('formant-ym2612').context.vowel, 2);
    calls.length = 0; cyclePosition = 0;
    for (let i = 0; i < 4; i++) await [...loops.values()][0]();
    assert.deepEqual(calls.filter(call => call.name === 'setFrequency').map(call => call.args[1]), [130, 162.5, 195, 162.5], 'B moves source pitch independently');
    processPcm(chip.generateStereo(8192));

    const edited = original.replace("let experiment = 'A';", "let experiment = 'C';")
      .replace('const carrierHz = 130;', 'const carrierHz = 196;')
      .replace('const feedback = 6;', 'const feedback = 4;')
      .replace('const operatorLevel = 16;', 'const operatorLevel = 24;');
    await execute(edited);
    assert.equal(synth.channels[0].algorithm, 7); assert.equal(synth.channels[0].feedback, 4);
    assert.equal(synth.channels[0].operators[0].tl, 24, 'Run again changes operator level outside livePrepare');
    const channel = synth.channels[0];
    const actualHz = channel.fnum * synth.clock * 2 ** (channel.block - 1) / (144 * 2 ** 20);
    assert.ok(Math.abs(actualHz - 196) < .3, 'the two-argument setFrequency controls calibrated Hz');
    assert.equal(f.rack.effects.get('formant-ym2612').context.autoVowels, true, 'C also moves formants');
    calls.length = 0; cyclePosition = 0;
    for (let i = 0; i < 4; i++) await [...loops.values()][0]();
    assert.deepEqual(calls.filter(call => call.name === 'setFrequency').map(call => call.args[1]), [196, 245, 294, 245]);
    assert.equal(f.rack.effects.get('formant-ym2612').state, state);
    const final = processPcm(chip.generateStereo(8192));
    assert.ok(rms(final[0]) > .00001, 'edited source still produces finite audible output');
    assert.deepEqual(writes.filter(write => write.port === 0 && write.register === 0x28).map(write => write.value), [0x10], 'source edits never retrigger the envelope');
    assert.deepEqual(f.errors, []);
    t.diagnostic(`real YM2612 ${rate} Hz; harmonic/fundamental power=${harmonicRatio.toFixed(3)}; filtered RMS=${rms(wet[0]).toFixed(5)}`);
  } finally {chip.dispose();}
});

test('all eight published lesson embeds exactly match the tested canonical source and are linked from their index', async () => {
  const indices = new Map(await Promise.all(['', '_ja'].map(async locale => [locale,
    await readFile(new URL(`./tetorica-fx${locale}.html`, import.meta.url), 'utf8')])));
  for (const locale of ['', '_ja']) for (const kind of ['vowels', 'voice', 'pitch', 'ym2612']) {
    const filename = `tetorica-fx-formant-${kind}${locale}.html`, id = `formant-${kind}`;
    const html = await readFile(new URL('./' + filename, import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script type="text\/plain" id="([^"]+)">([\s\S]*?)<\/script>/g)];
    const script = scripts.find(([, candidate]) => candidate === id);
    assert.ok(script, filename + ' contains its editable source');
    assert.equal(script[2].trim(), createFormantExample(kind).trim(), filename + ' is current with the tested DSP');
    assert.match(html, new RegExp(`<iframe\\b[^>]*data-playground-src="${id}"`), filename + ' embeds that source');
    assert.match(html, new RegExp(`<a\\b[^>]*data-playground-src="${id}"`), filename + ' opens that source separately');
    assert.ok(indices.get(locale).includes(`href="./${filename}"`), filename + ' is reachable from its language index');
  }
});
