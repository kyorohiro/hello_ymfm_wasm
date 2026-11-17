import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MODE_STARTERS} from './playground_mode_examples.js';

const examples = [
  ['mega-cd/megacd-sampler', 'rf5c164'],
  ['gameboy/gameboy-sampler', 'gameboy-wave'],
  ['pc98/pc98-sampler', 'adpcm-b'],
  ['neogeo/neogeo-sampler', 'adpcm-b'],
];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

for (const [path, target] of examples) test(`${path} loads its editable project asset and binds the shared Keyboard instrument`, async () => {
  const source = await readFile(new URL(`./examples/${path}.js`, import.meta.url), 'utf8');
  const audio = {name: 'voice.wav', channels: [new Float32Array(128)], sampleRate: 16000, target};
  const instrument = {name: target}, bound = [], logs = [];
  const api = {
    inputAudio: async options => {assert.deepEqual(options, {asset: '/samples/sampler.sample.json', edit: false}); return audio;},
    createSampleInstrument: async (actual, options) => {assert.equal(actual, audio); assert.equal(options, undefined, 'the editor Instrument selection must stay authoritative'); return instrument;},
    keyboard: {bind: (name, actual) => bound.push({name, actual})},
    log: message => logs.push(message),
  };
  await new AsyncFunction(...Object.keys(api), source)(...Object.values(api));
  assert.deepEqual(bound, [{name: 'sampler', actual: instrument}]);
  assert.ok(logs.some(message => message.includes('Keyboard') && message.includes('/samples/sampler.sample.json')));
});

test('cancelling source selection leaves every sampler example silent and unbound', async () => {
  for (const [path] of examples) {
    const source = await readFile(new URL(`./examples/${path}.js`, import.meta.url), 'utf8');
    await new AsyncFunction('inputAudio', 'createSampleInstrument', 'keyboard', 'log', source)(
      async () => null,
      () => assert.fail('cancelled input must not create an instrument'),
      {bind() {assert.fail('cancelled input must not replace the keyboard');}},
      () => {},
    );
  }
});

test('samplers remain discoverable alongside compact machine demos', () => {
  for (const [mode, path, count] of [
    ['mega-cd', 'mega-cd/megacd-sampler', 3], ['gameboy', 'gameboy/gameboy-sampler', 3],
    ['pc98', 'pc98/pc98-sampler', 3], ['neogeo', 'neogeo/neogeo-sampler', 4], ['neogeo-b', 'neogeo/neogeo-sampler', 4],
  ]) {
    const examples = MODE_STARTERS[mode].examples;
    assert.equal(examples.length, count, mode);
    assert.ok(examples.includes(`/examples/${path}.js`));
  }
  assert.ok(MODE_STARTERS['neogeo-b'].examples.includes('/examples/neogeo/neogeo-b-six-channel.js'));
  for (const mode of ['neogeo','neogeo-b']) assert.ok(MODE_STARTERS[mode].examples.includes('/examples/neogeo/neogeo-adpcm-a-drums.js'));
  assert.ok(MODE_STARTERS.gameboy.examples.includes('/examples/gameboy/gameboy-mode-wave.js'));
});
