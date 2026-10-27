import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MessageChannel} from 'node:worker_threads';
import {MODE_DEFAULT_CODES, MODE_EXAMPLE_FILES} from './playground_examples.js';
import {createCddaOffline} from '../../web/cdda_offline.js';
import {parseCddaWav} from '../../web/cdda_source.js';
import {Rf5c164} from '../../web/rf5c164.js';
import {createRf5c164Client, createRf5c164Control} from '../../web/playground_rf5c164.js';
import factory from '../generated/rf5c164_wasm.js';

const source = await readFile(new URL('./examples/mega-cd/megacd-four-sources.js', import.meta.url), 'utf8');
const rfBytes = await readFile(new URL('../generated/rf5c164_wasm.wasm', import.meta.url));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function scene(sampleRate, {cancelAtWait = false, failLoad = false} = {}) {
  const chip = await Rf5c164.create({moduleFactory: factory, moduleOptions: {wasmBinary: rfBytes}, sampleRate});
  const control = createRf5c164Control(chip), {port1, port2} = new MessageChannel();
  const messages = [], notes = [], tones = [], waits = [], rfOutput = [], cdOutput = [];
  port1.on('message', message => {
    messages.push(message);
    const {id, method, args} = message;
    try { const value = control[method](...args); if (id) port1.postMessage({id, value}); }
    catch (error) { if (id) port1.postMessage({id, error: error.message}); }
  });
  const pcm = createRf5c164Client(port2, async () => assert.fail('generated PCM needs no file decoder'));
  const offline = await createCddaOffline({sampleRate});
  let loop, wav, cddaStarts = 0, psgActive = false;
  const cancelled = new DOMException('Run stopped', 'AbortError');
  const render = beats => {
    assert.ok(beats > 0);
    waits.push(beats);
    const frames = Math.round(beats * sampleRate / 2);
    rfOutput.push(chip.generateStereo(frames).left);
    const audio = offline.render(frames);
    assert.ok(audio.left.every(Number.isFinite) && audio.right.every(Number.isFinite));
    cdOutput.push(audio);
  };
  const api = {
    async useSoundChip(kind) { assert.equal(kind, 'rf5c164'); return pcm; },
    cdda: {
      async load(bytes) { if (failLoad) throw new Error('load failed'); wav = bytes; return offline.cdda.load(bytes); },
      async play() { cddaStarts++; return offline.cdda.play(); },
    },
    fm: {setPreset(ch) { assert.equal(ch, 0); }}, FM_PRESETS: {'one-op-basic': {}}, CH1: 0,
    psg: {tone(ch, options) { assert.equal(ch, 0); tones.push(options); psgActive = true; }, off(ch) { assert.equal(ch, 0); psgActive = false; }}, PSG1: 0,
    setBpm(bpm) { assert.equal(bpm, 120); },
    liveLoop(name, callback) { assert.equal(name, 'mega-cd-four-sources'); loop = callback; },
    async play(note, {beats, channel}) {
      assert.equal(channel, 0); assert.ok(psgActive, 'PSG accompanies the FM note');
      notes.push(note);
      if (cancelAtWait) { control.reset(); offline.adapter.command({type: 'stop'}); throw cancelled; }
      render(beats);
    },
    async beat(beats) { assert.equal(psgActive, false, 'PSG releases before the rest'); render(beats); },
    mixer: {set() { assert.fail('the scene must preserve Mixer settings'); }},
  };
  return {api, chip, pcm, offline, messages, notes, tones, waits, rfOutput, cdOutput,
    get wav() { return wav; }, get loop() { return loop; }, get cddaStarts() { return cddaStarts; }, cancelled,
    async close() {
      pcm.dispose(); await new Promise(resolve => setImmediate(resolve));
      port1.close(); port2.close(); chip.dispose(); offline.dispose();
    }};
}

test('Mega-CD exposes three demos, retains the sampler, and starts with the four-source scene', () => {
  assert.equal(MODE_DEFAULT_CODES['mega-cd'], source);
  assert.deepEqual(MODE_EXAMPLE_FILES['mega-cd'].map(file => file.name), ['megacd-four-sources', 'megacd-pcm-loop', 'megacd-sampler']);
  assert.doesNotMatch(source, /\b(?:setTimeout|setInterval|AudioContext|mixer\.set)\s*\(/);
});

for (const rate of [44100, 48000]) test(`generated Mega-CD audio is faded, bounded and repeatable on actual RF/CD-DA cores at ${rate} Hz`, async () => {
  const f = await scene(rate);
  try {
    await new AsyncFunction(...Object.keys(f.api), source)(...Object.values(f.api));
    assert.equal(f.cddaStarts, 0, 'preparation never starts playback');
    const parsed = parseCddaWav(f.wav);
    assert.equal(parsed.frames, 44100 * 4);
    const view = new DataView(parsed.pcm.buffer, parsed.pcm.byteOffset, parsed.pcm.byteLength);
    let maxJump = 0, stereoDifferences = 0;
    for (let i = 0; i < parsed.frames; i++) {
      const left = view.getInt16(i * 4, true), right = view.getInt16(i * 4 + 2, true);
      if (left !== right) stereoDifferences++;
      if (i) for (const offset of [0, 2]) maxJump = Math.max(maxJump, Math.abs(view.getInt16(i * 4 + offset, true) - view.getInt16((i - 1) * 4 + offset, true)));
      if (i % 22050 === 0 || i % 22050 === 22049) assert.deepEqual([left, right], [0, 0], 'each backing note fades to exact silence');
    }
    assert.ok(stereoDifferences > 100000, 'the generated backing is genuine stereo');
    assert.ok(maxJump < 400, `backing sample edges remain smooth: ${maxJump}`);
    const load = f.messages.find(message => message.method === 'loadMemory');
    const [ram, , metadata] = load.args;
    assert.equal(metadata.endGuardBytes, 32);
    assert.ok(ram.length <= 65536);
    assert.ok(ram.subarray(-32).every(value => value === 0xff));
    assert.ok(ram.subarray(metadata.loopStart, metadata.frames).every(value => value === 0x80), 'PCM loops only the faded silent tail');
    await f.loop(); await f.loop();
    assert.equal(f.cddaStarts, 2);
    assert.equal(f.notes.length, 16); assert.equal(f.tones.length, 16);
    assert.equal(f.waits.reduce((a, b) => a + b, 0), 16);
    assert.equal(f.offline.currentFrame, rate * 8, 'all waits share the same 8-second clock');
    assert.equal((await f.offline.cdda.getState()).state, 'ended');
    assert.ok(f.cdOutput[0].left.some(value => Math.abs(value) > .01), 'the actual CD-DA core renders the accompaniment');
    assert.ok(f.cdOutput[0].left.some((value, i) => value !== f.cdOutput[0].right[i]), 'the rendered accompaniment stays stereo');
    for (let i = 0; i < f.rfOutput.length; i += 2) {
      const gate = f.rfOutput[i], rest = f.rfOutput[i + 1];
      assert.ok(gate.some(value => Math.abs(value) > 0.01), 'each PCM note sounds');
      assert.ok(gate.subarray(Math.round(rate * .35)).every(value => value === 0), 'PCM has faded before key-off');
      assert.ok(rest.every(value => value === 0), 'PCM does not leak into rests');
      let jump = 0;
      for (let frame = 1; frame < gate.length; frame++) jump = Math.max(jump, Math.abs(gate[frame] - gate[frame - 1]));
      assert.ok(jump < .03, `PCM note edges stay smooth: ${jump}`);
    }
    const silence = f.offline.render(128);
    assert.ok(silence.left.every(value => value === 0) && silence.right.every(value => value === 0));
    assert.ok(f.chip.generateStereo(128).left.every(value => value === 0));
    await f.pcm.setPitch(0, 65535); await f.pcm.keyOn(0);
    f.chip.generateStereo(Math.round(rate * .03));
    assert.ok(f.chip.generateStereo(rate).left.every(value => value === 0), 'even the maximum pitch step lands in the silent guard loop');
  } finally { await f.close(); }
});

test('a rejected shared wait propagates cancellation and never starts a later note or CD-DA phrase', async () => {
  const f = await scene(48000, {cancelAtWait: true});
  try {
    await new AsyncFunction(...Object.keys(f.api), source)(...Object.values(f.api));
    await assert.rejects(f.loop(), error => error === f.cancelled);
    assert.equal(f.cddaStarts, 1); assert.equal(f.notes.length, 1); assert.equal(f.tones.length, 1);
    assert.deepEqual(f.waits, []);
    assert.ok(f.chip.generateStereo(128).left.every(value => value === 0));
    assert.ok(f.offline.render(128).left.every(value => value === 0));
  } finally { await f.close(); }
});

test('a failed CD-DA preparation registers no loop and does not start PCM or CD-DA', async () => {
  const f = await scene(48000, {failLoad: true});
  try {
    await assert.rejects(new AsyncFunction(...Object.keys(f.api), source)(...Object.values(f.api)), /load failed/);
    assert.equal(f.loop, undefined); assert.equal(f.cddaStarts, 0); assert.deepEqual(f.notes, []);
    assert.ok(!f.messages.some(message => message.method === 'keyOn'));
    assert.ok(f.chip.generateStereo(128).left.every(value => value === 0));
  } finally { await f.close(); }
});
