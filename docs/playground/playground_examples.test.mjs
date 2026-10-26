import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_CODE, EXAMPLES, EXAMPLE_FILES, MODE_DEFAULT_CODES, MODE_DEFAULT_HISTORY, MODE_EXAMPLE_FILES} from './playground_examples.js';
import {MODE_STARTERS, selectModeExamples} from './playground_mode_examples.js';
import {buildExampleBundle} from '../../scripts/build_playground_examples.mjs';
import {createVirtualFileSystem} from './playground_virtual_files.js';
import {buildFileTree} from './playground_file_tree.js';
import {createPlaygroundCassetteZip, loadPlaygroundCassette} from './playground_cassette.js';
import {createFormantExample} from '../introductions/formant-examples.js';

test('wobble sample loop plays only samples loaded during preparation', async () => {
  const loaded = new Set();
  const played = [];
  const loops = [];
  const sample = {
    async load(name) { loaded.add(name); },
    async play(name) {
      assert.ok(loaded.has(name), `Unknown sample: ${name}`);
      played.push(name);
    },
  };
  const fx = { wobble() {}, delay() {}, reverb() {}, setChain() {} };
  const api = {
    setBpm() {}, setMasterVolume() {}, fx, sample,
    livePrepare: async (_name, prepare) => prepare({ fx, sample }),
    liveLoop: (_name, loop) => loops.push(loop),
    async sleep() {},
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(api), EXAMPLES['wobble-kick-bass-sample'])(...Object.values(api));
  assert.equal(loops.length, 1);
  await loops[0]();
  assert.deepEqual(played, ['sonic-pi/drum-heavy-kick', 'sonic-pi/bass-hit-c']);
});

test('bundled examples match editable categorized source files', async () => {
  const folders = [...new Set(EXAMPLE_FILES.map(file => file.path.split('/')[2]))];
  assert.equal(folders.indexOf('chip-raw'), folders.indexOf('basic') + 1);
  assert.deepEqual(folders, ['basic', 'chip-raw', 'genesis', 'mega-cd', 'game-gear', 'master-system', 'msx', 'gameboy', 'nes', 'pc98', 'neogeo', 'x68000', 'dx7', 'snes', 'pc-engine', 'opl', 'atari-st', 'wonderswan']);
  assert.ok(EXAMPLE_FILES.some(file => file.path === '/examples/chip-raw/ym2612-raw-write-beep.js'));
  assert.ok(EXAMPLE_FILES.some(file => file.path === '/examples/chip-raw/gameboy-raw-write-sample.js'));
  assert.deepEqual(EXAMPLE_FILES.filter(file => file.path.startsWith('/examples/basic/livefx/')).map(file => file.name), ['live-fx-distortion']);
  assert.ok(EXAMPLE_FILES.some(file => file.path === '/examples/basic/fm/fm-api-beep.js'));
  assert.ok(EXAMPLE_FILES.some(file => file.path === '/examples/basic/psg/psg-scale.js'));
  assert.ok(EXAMPLE_FILES.some(file => file.path === '/examples/basic/dac/dac-pcm-sample.js'));
  assert.ok(EXAMPLE_FILES.some(file => file.path === '/examples/snes/snes-brr-melody.js'));
  for (const file of EXAMPLE_FILES.filter(file => file.path.startsWith('/examples/genesis/'))) {
    if (file.name === 'genesis-mode-duet') {
      assert.match(file.data, /fm\.setPreset\(/);
      assert.match(file.data, /psg\.tone\(/);
    } else assert.match(file.data, /await (?:useSoundChip|createSoundChip)\(/);
  }
  assert.equal(await buildExampleBundle(), await readFile(new URL('./playground_examples.js',import.meta.url),'utf8'));
  for(const file of EXAMPLE_FILES){
    assert.match(file.path,/^\/examples\/(basic|chip-raw|genesis|mega-cd|game-gear|master-system|msx|gameboy|nes|pc98|neogeo|x68000|dx7|snes|pc-engine|opl|atari-st|wonderswan)\/(?:[\w-]+\/)*[\w-]+\.js$/);
    if (/^\/examples\/(genesis|mega-cd|game-gear|master-system|msx|gameboy|nes|pc98|neogeo|x68000|dx7|snes|pc-engine|opl|atari-st|wonderswan)\//.test(file.path)) {
      assert.equal(file.path.split('/').length, 4, 'machine examples have no subfolders');
    }
    assert.equal(file.data,await readFile(new URL('.'+file.path,import.meta.url),'utf8'));
    assert.equal(EXAMPLES[file.name],file.data);
  }
});

test('all mode starters match their physical index.js sources', async () => {
  const modeIds = Object.keys(MODE_STARTERS);
  assert.equal(modeIds.length, 24);
  assert.deepEqual(Object.keys(MODE_DEFAULT_CODES), modeIds);
  for (const [id, definition] of Object.entries(MODE_STARTERS)) {
    assert.equal(definition.index, `${id}/index.js`);
    const source = await readFile(new URL(`./defaults/${definition.index}`, import.meta.url), 'utf8');
    assert.equal(MODE_DEFAULT_CODES[id], source, `${id} starts from its own editable source`);
    assert.match(source, /liveLoop\(/, `${id} has a runnable starter`);
  }
  assert.equal(DEFAULT_CODE, await readFile(new URL('./defaults/index.js', import.meta.url), 'utf8'));
  assert.equal(MODE_DEFAULT_CODES.genesis, DEFAULT_CODE, 'the legacy Genesis default stays compatible');
  assert.equal(MODE_DEFAULT_CODES['genesis-nuked'], DEFAULT_CODE);
});

test('mode catalogs stay compact while Genesis retains its library and shares the mixed-chip scene', () => {
  assert.deepEqual(Object.keys(MODE_EXAMPLE_FILES), Object.keys(MODE_STARTERS));
  for (const [id, definition] of Object.entries(MODE_STARTERS)) {
    const files = MODE_EXAMPLE_FILES[id];
    assert.deepEqual(files, selectModeExamples(EXAMPLE_FILES, id), `${id} follows the editable catalog`);
    assert.equal(new Set(files.map(file => file.path)).size, files.length, `${id} has no duplicates`);
    for (const file of files) assert.ok(EXAMPLE_FILES.includes(file), `${id} uses a bundled source`);
    if (definition.examples) {
      if (id === 'master-system') assert.equal(files.length,5,'Master System retains two PSG examples alongside three OPLL examples');
      else if (['mega-cd','genesis-full','genesis-full-nuked'].includes(id)) assert.equal(files.length,6,'Genesis expansion modes include the shared mixed-chip, level and YM2612 engine comparison scenes');
      else assert.ok(files.length >= 2 && files.length <= 3, `${id} has two or three examples`);
      assert.deepEqual(files.map(file => file.path), definition.examples);
    }
  }

  const genesis = MODE_EXAMPLE_FILES.genesis;
  assert.ok(genesis.length > 40, 'Genesis keeps the established example library');
  assert.deepEqual(MODE_EXAMPLE_FILES['genesis-nuked'], genesis);
  for (const id of ['genesis','mega-cd','genesis-full','genesis-full-nuked','genesis-nuked']) {
    assert(MODE_EXAMPLE_FILES[id].some(file => file.path === '/examples/genesis/chip-level-comparison.js'), `${id} includes the shared listening comparison`);
    assert(MODE_EXAMPLE_FILES[id].some(file => file.path === '/examples/genesis/ym2612-engine-comparison.js'), `${id} includes the YM2612 engine comparison`);
  }
  for (const path of [
    '/examples/basic/fm/fm-api-beep.js',
    '/examples/basic/psg/psg-scale.js',
    '/examples/basic/dac/dac-pcm-sample.js',
    '/examples/gameboy/gameboy-synth.js',
    '/examples/pc98/ym2608-chip.js',
  ]) assert.ok(genesis.some(file => file.path === path), `Genesis retains ${path}`);
  for (const file of EXAMPLE_FILES.filter(file =>
    /\/(?:megacd-|gg-mode-|sms-mode-|gameboy-mode-|pc98-opn|neogeo-opnb-|neogeo-b-six-channel|nes-mode-|snes-mode-|x68000-mode-|pce-mode-)/.test(file.path))) {
    assert.ok(!genesis.includes(file), `${file.name} needs its native mode`);
  }
  assert.deepEqual(MODE_EXAMPLE_FILES.gameboy.map(file => file.name), [
    'gameboy-mode-pulse', 'gameboy-mode-wave', 'gameboy-sampler',
  ]);
  assert.throws(() => selectModeExamples(EXAMPLE_FILES, 'missing'), /Unsupported example mode/);
  assert.throws(() => selectModeExamples([], 'gameboy'), /Missing gameboy example/);
});

test('Sega mode starters and examples run with the built-in PSG; stereo keeps the correct speaker bits', async () => {
  const {SegaPSGSynth} = await import('../../web/segapsgsynth.js');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const id of ['game-gear', 'master-system']) {
    const sources = id === 'master-system'
      ? [...MODE_DEFAULT_HISTORY[id], ...MODE_EXAMPLE_FILES[id].filter(file => !file.name.startsWith('sms-opll-')).map(file => file.data)]
      : [MODE_DEFAULT_CODES[id], ...MODE_EXAMPLE_FILES[id].map(file => file.data)];
    for (const source of sources) {
      const writes = [], stereo = [], loops = [], waits = [];
      const psg = new SegaPSGSynth({transport: {write: value => writes.push(value)}});
      psg.setStereo = mask => stereo.push(mask);
      const api = {
        psg, PSG1: 0, PSG2: 1, PSG3: 2,
        setBpm: bpm => assert.equal(bpm, 120),
        liveLoop: (name, fn) => loops.push({name, fn}),
        beat: async beats => { assert.ok(beats > 0); waits.push(beats); },
      };
      await new AsyncFunction(...Object.keys(api), source)(...Object.values(api));
      assert.ok(loops.length > 0);
      for (const loop of loops) {
        const start = waits.length;
        await loop.fn();
        assert.ok(waits.length > start, `${loop.name} yields between PSG updates`);
      }
      assert.ok(writes.length > 0, `${id} plays through the PSG API`);
      if (id === 'master-system') assert.deepEqual(stereo, []);
      else {
        assert.equal(stereo[0], 0xff);
        assert.equal(stereo.at(-1), 0xff);
        if (source === EXAMPLES['gg-mode-stereo']) {
          assert.deepEqual(stereo, [0xff, 0xfe, 0xef, 0xfe, 0xef, 0xfe, 0xef, 0xfe, 0xef, 0xff]);
          assert.equal(0xfe & 0x11, 0x10, 'the left step enables only PSG1 left');
          assert.equal(0xef & 0x11, 0x01, 'the right step enables only PSG1 right');
        }
      }
    }
  }
});

test('Mega-CD starter and PCM demos use the shared PCM voices and valid waveform RAM', async () => {
  const {RF5C164Synth} = await import('../../web/rf5c164synth.js');
  const {encodeRf5c164} = await import('../../web/rf5c164_pcm.js');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const sources = [MODE_DEFAULT_CODES['mega-cd'], ...MODE_EXAMPLE_FILES['mega-cd']
    .filter(file => file.path.startsWith('/examples/mega-cd/') && file.name !== 'megacd-sampler').map(file => file.data)];
  for (const source of sources) {
    const writes = [], loops = [], waits = [], memory = [];
    const control = new RF5C164Synth({transport: {
      write: (...args) => writes.push(args),
      loadMemory: bytes => memory.push(bytes),
      reset() {},
    }});
    const pcm = Object.assign(control, {clock: 12500000, async loadSample(decoded) {
      const {bytes, step, frames} = encodeRf5c164(decoded);
      control.loadMemory(bytes);
      return {start: 0, loopStart: frames + 1, step};
    }});
    const api = {
      async useSoundChip(chip) { assert.equal(chip, 'rf5c164'); return pcm; },
      setBpm: bpm => assert.equal(bpm, 120),
      fm: {setPreset() {}}, FM_PRESETS: {'one-op-basic': {}}, CH1: 0,
      psg: {tone() {}, off() {}}, PSG1: 0,
      liveLoop: (_name, fn) => loops.push(fn),
      async beat(beats) { assert.ok(beats > 0); waits.push(beats); },
      async play(_note, {beats}) { waits.push(beats); },
    };
    await new AsyncFunction(...Object.keys(api), source)(...Object.values(api));
    assert.equal(memory.length, 1);
    assert.ok(memory[0].length <= 65536, 'waveform fits chip RAM');
    assert.ok(memory[0].indexOf(255) > 0, 'waveform precedes the end marker');
    assert.equal(memory[0].at(-1), 255, 'waveform ends with a marker');
    assert.equal(loops.length, 1);
    await loops[0]();
    assert.ok(waits.length > 0, 'PCM loops yield between notes');
    assert.ok(writes.some(([register, value]) => register === 8 && value !== 255), 'PCM voices actually key on');
    assert.equal(control.channelMask, 255, 'all voices release at the end of a loop');
  }
});

test('the singing keyboard is a direct Basic file and matches the tested canonical keyboard source', async () => {
  const path = '/examples/basic/singing-keyboard.js';
  const sample = EXAMPLE_FILES.find(file => file.path === path);
  assert.ok(sample, 'the example is directly inside Basic');
  assert.equal(sample.data.trim(), createFormantExample('ym2612', {keyboard: true}).trim());
  assert.equal(sample.data, await readFile(new URL('.' + path, import.meta.url), 'utf8'));
  assert.equal(EXAMPLES['singing-keyboard'], sample.data);
  assert.match(sample.data, /Run.*Keyboard.*melody/);
  assert.match(sample.data, /Keyboard.*メロディー/);
  assert.match(sample.data, /let experiment = 'K';/);
  const tree = buildFileTree(EXAMPLE_FILES), examples = tree.find(node => node.name === 'examples');
  const basic = examples.children.find(node => node.name === 'basic');
  assert.ok(basic.children.some(node => node.file && node.path === path), 'the example appears directly in the visible Basic file list');
});

test('examples appear in the folder tree and edited source survives cassette export', async () => {
  const fs=createVirtualFileSystem(EXAMPLE_FILES);
  const tree=buildFileTree(fs.list());
  assert.equal(tree[0].name,'examples');
  assert.equal(tree[0].children.length,new Set(EXAMPLE_FILES.map(file=>file.path.split('/')[2])).size);
  assert.deepEqual(tree[0].children.map(node => node.name), ['basic', 'chip-raw', 'genesis', 'mega-cd', 'game-gear', 'master-system', 'msx', 'gameboy', 'nes', 'pc98', 'neogeo', 'x68000', 'dx7', 'snes', 'pc-engine', 'opl', 'atari-st', 'wonderswan']);
  const path='/examples/basic/midi/midi-auto-chord.js';
  fs.writeText(path,'// user edited\n'+fs.get(path).data);
  const zip=createPlaygroundCassetteZip(fs.list());
  const cassette=await loadPlaygroundCassette(zip);
  assert.equal(new TextDecoder().decode(cassette.files.get(path.slice(1))),fs.get(path).data);
});

test('initial editor source uses the mode default; URL source still takes priority', async () => {
  const {resolveInitialSourceFromQuery}=await import('./playground_query.js');
  const defaults={'index.js':DEFAULT_CODE};
  const initial=resolveInitialSourceFromQuery('',defaults,'index.js');
  assert.equal(initial.source,DEFAULT_CODE);
  assert.match(initial.source,/liveFx\("distortion"/);
  assert.equal(EXAMPLES['live-loop'], undefined);
  const source='// shared source';
  const encoded=encodeURIComponent(Buffer.from(source).toString('base64'));
  assert.equal(resolveInitialSourceFromQuery('?src='+encoded,defaults,'index.js').source,source);
  const app=await readFile(new URL('./playground.js',import.meta.url),'utf8');
  assert.match(app,/resolveInitialSourceFromQuery\(\s*window\.location\.search,\s*\{ "index.js": initialCode \},\s*"index.js"/);
});

test('haunted bells loads its sample before alternating forward and reverse playback', async () => {
  const loaded = new Set();
  const rates = [];
  const waits = [];
  let loop;
  let direction = 0;
  const sample = {
    async load(name) { loaded.add(name); },
    async play(name, options) {
      assert.ok(loaded.has(name));
      rates.push(options.playbackRate);
    },
  };
  const api = {
    setBpm(bpm) { assert.equal(bpm, 60); },
    livePrepare: async (_name, prepare) => prepare({ sample }),
    liveLoop: (_name, callback) => { loop = callback; },
    sample,
    choose: values => values[direction++ % values.length],
    rrange: (min, max) => (min + max) / 2,
    beat: async value => { waits.push(value); },
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(api), EXAMPLES['haunted-bells'])(...Object.values(api));
  await loop();
  await loop();
  assert.deepEqual([...loaded], ['sonic-pi/perc-bell']);
  assert.deepEqual(rates, [-0.85, 0.85]);
  assert.deepEqual(waits, [1.05, 1.05]);
  assert.ok((await readFile(new URL('./samples/sonic-pi/perc_bell.flac', import.meta.url))).length > 0);
});

test('DX7 example awaits its independent instrument and releases each MIDI note', async () => {
  let loop;
  const events = [];
  const dx7 = {
    id:'dx7',
    noteOn(note, velocity) { events.push(['on', note, velocity]); },
    noteOff(note) { events.push(['off', note]); },
  };
  const api = {
    async useSoundChip(name) { assert.equal(name, 'dx7'); return dx7; },
    setBpm(bpm) { assert.equal(bpm, 110); },
    mixer: {async set() { assert.fail('the DX7 example must preserve Mixer settings'); }},
    liveLoop(name, callback) { assert.equal(name, 'dx7-melody'); loop = callback; },
    async beat(beats) { events.push(['beat', beats]); },
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(api), EXAMPLES['dx7-init-sine'])(...Object.values(api));
  assert.equal(events.length, 0);
  await loop();
  assert.deepEqual(events, [60,64,67,72,67,64].flatMap(note => [
    ['on', note, 100], ['beat', 0.4], ['off', note], ['beat', 0.1],
  ]));
});

test('slow hollow alternates independent channels at the original note intervals', async () => {
  const loops = [], events = [];
  let now = 0;
  const fm = {
    setPreset() {},
    setOperator(ch, op, p) {
      if (p.tl !== undefined) assert.ok(Number.isInteger(p.tl) && p.tl >= 0 && p.tl <= 127);
    },
    setFrequency() {},
    setBlockFnum() {},
    keyOn(ch) { events.push({ch, time: now, on: true}); },
    keyOff(ch) { events.push({ch, time: now, on: false}); },
  };
  const fx = { reverb: options => options, setChain() {} };
  const api = {
    fm, fx, FM_PRESETS: {'two-op-organ': {}},
    CH1: 0, CH2: 1, CH3: 2, CH4: 3, CH5: 4, CH6: 5, OP1: 0, OP2: 1,
    setBpm: bpm => assert.equal(bpm, 60),
    livePrepare: async (_name, fn) => fn({fx}),
    liveLoop: (name, fn) => loops.push({name, fn}),
    noteToBlockFnum: note => {
      assert.ok(['D4','E4','F#4','G4','A4','C#5'].includes(note));
      return {block: 4, fnum: 400};
    },
    choose: values => values[0],
    beat: async beats => { assert.ok(beats >= 0); now += beats; },
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(api), EXAMPLES['slow-hollow'])(...Object.values(api));
  assert.equal(loops.length, 6);
  for (let ch = 0; ch < 6; ch++) {
    now = 0; events.length = 0;
    await loops[ch].fn();
    await loops[ch].fn();
    const part = Math.floor(ch / 2), interval = [8,10,11][part];
    const duration = [12,9,10][part], start = (ch % 2) * interval;
    assert.deepEqual(events.map(e => [e.ch, e.on]), [[ch,true],[ch,false],[ch,true],[ch,false]]);
    const expected = [start, start + duration, start + interval * 2, start + interval * 2 + duration];
    events.forEach((event,i) => assert.ok(Math.abs(event.time - expected[i]) < 1e-8));
  }
});
