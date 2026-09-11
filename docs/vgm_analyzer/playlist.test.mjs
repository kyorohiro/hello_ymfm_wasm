import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./vgm_analyzer.js', import.meta.url), 'utf8');
function setup(load = async () => true) {
  const calls = [];
  const element = () => ({
    children: [], attributes: {}, listeners: {},
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
  });
  const list = element();
  const input = element();
  const context = vm.createContext({
    console, playlistList: list, playlistSummary: element(), fileInput: input,
    document: { createElement: element }, currentBuffer: null,
    player: { pause() {} }, timelineSeekController: null,
    stopActiveStream() {}, setStatus: text => calls.push(['status', text]),
    handleYm2608RomFile: async file => calls.push(['rom', file.name]),
    handleFile: async file => {
      calls.push(['load', file.name]);
      context.currentBuffer = await load(file) ? file : null;
    },
    playCurrentVgm: async () => calls.push(['play', context.currentBuffer.name]),
  });
  vm.runInContext(source.slice(source.indexOf('// Playlist operations'), source.indexOf('let fileDragDepth')), context);
  return {
    context, calls, list, input,
    add: names => context.importPlaylistFiles(names.map(name => ({ name }))),
    settle: () => vm.runInContext('fileLoadQueue', context),
  };
}

test('music imports keep order, load only the first track, and append without interrupting', async () => {
  const p = setup();
  await p.add(['first.vgm', 'second.VGZ', 'third.s98']);
  assert.deepEqual(p.calls, [['load', 'first.vgm']]);
  assert.deepEqual(p.list.children.map(row => row.children[0].textContent), ['first.vgm', 'second.VGZ', 'third.s98']);
  await p.add(['fourth.vgm']);
  assert.equal(p.list.children.length, 4);
  assert.deepEqual(p.calls, [['load', 'first.vgm']]);
});

test('BIN is loaded as ROM, not listed; unsupported ROM extension is rejected', async () => {
  const p = setup();
  await p.add(['ym2608_adpcm_rom.BIN', 'unsupported.rom', 'first.vgm']);
  assert.deepEqual(p.calls.slice(0, 2), [['rom', 'ym2608_adpcm_rom.BIN'], ['load', 'first.vgm']]);
  assert.match(p.calls[2][1], /Unsupported files: unsupported\.rom/);
  assert.equal(p.list.children.length, 1);
});

test('track completion advances in order and stops at the end', async () => {
  const p = setup();
  await p.add(['first.vgm', 'second.vgm', 'third.vgm']);
  await p.context.advancePlaylist();
  await p.context.advancePlaylist();
  await p.context.advancePlaylist();
  assert.deepEqual(p.calls, [['load', 'first.vgm'], ['load', 'second.vgm'], ['play', 'second.vgm'], ['load', 'third.vgm'], ['play', 'third.vgm']]);
  assert.equal(p.list.children[2].children[0].attributes['aria-current'], 'true');
});

test('clicking a track selects and plays it; newer selections supersede queued selections', async () => {
  const p = setup();
  await p.add(['first.vgm', 'second.vgm', 'third.vgm']);
  p.list.children[1].children[0].listeners.click();
  p.list.children[2].children[0].listeners.click();
  await p.settle();
  assert.deepEqual(p.calls, [['load', 'first.vgm'], ['load', 'third.vgm'], ['play', 'third.vgm']]);
});

test('stopping during a track read cancels automatic playback', async () => {
  let release;
  const p = setup(file => file.name === 'second.vgm' ? new Promise(resolve => { release = resolve; }) : true);
  await p.add(['first.vgm', 'second.vgm']);
  const next = p.context.advancePlaylist();
  await Promise.resolve();
  vm.runInContext('playlistRevision += 1', p.context);
  release(true);
  await next;
  assert.deepEqual(p.calls, [['load', 'first.vgm'], ['load', 'second.vgm']]);
});

test('invalid music does not replay the preceding track', async () => {
  const p = setup(file => file.name !== 'broken.vgm');
  await p.add(['first.vgm', 'broken.vgm']);
  await p.context.advancePlaylist();
  assert.deepEqual(p.calls, [['load', 'first.vgm'], ['load', 'broken.vgm']]);
});

test('file picker imports all selected music files and allows selecting them again', async () => {
  const p = setup();
  const target = { files: [{ name: 'first.vgm' }, { name: 'second.vgm' }], value: 'selection' };
  p.input.listeners.change({ target });
  await p.settle();
  assert.equal(target.value, '');
  assert.equal(p.list.children.length, 2);
});

for (const mode of ['worklet', 'script']) {
  test(`${mode} stream completion plays the next playlist track`, async () => {
    const p = setup();
    await p.add(['first.vgm', 'second.vgm']);
    const node = { port: {}, connect() {} };
    Object.assign(p.context, {
      audioContext: { audioWorklet: {}, destination: {}, createScriptProcessor: () => node },
      AudioWorkletNode: function () { return node; }, workletModuleReady: true,
      activeStream: null, resetTimelineToStart() {}, requestPlaybackUiRender() {},
      currentStatusSuffix: () => '', scheduleWorkletPump() {}, pumpWorkletChunks() {},
      applyAnalyzerMuteToBuffer() {},
      player: { pause() {}, isPaused: () => false, process() {}, stats: () => ({ playing: false, paused: false, queuedFrames: 0 }) },
    });
    const start = source.indexOf('async function startWorkletStream(');
    const end = source.indexOf('async function handleFile(', start);
    vm.runInContext(source.slice(start, end), p.context);
    if (mode === 'worklet') {
      await p.context.startWorkletStream(44100);
      node.port.onmessage({ data: { ended: true, queuedFrames: 0 } });
    } else {
      p.context.startScriptProcessorStream();
      node.onaudioprocess({ outputBuffer: { getChannelData: () => new Float32Array(2048) } });
    }
    await p.settle();
    assert.deepEqual(p.calls.filter(([type]) => type !== 'status'), [['load', 'first.vgm'], ['load', 'second.vgm'], ['play', 'second.vgm']]);
  });
}
