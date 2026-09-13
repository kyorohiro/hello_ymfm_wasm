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
    playlistLoopCheckbox: { checked: false }, playlistLoopControl: element(),
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

test('music selections replace the playlist and load their first track', async () => {
  const p = setup();
  await p.add(['first.vgm', 'second.VGZ', 'third.s98']);
  assert.deepEqual(p.calls, [['load', 'first.vgm']]);
  assert.deepEqual(p.list.children.map(row => row.children[0].textContent), ['first.vgm', 'second.VGZ', 'third.s98']);
  await p.add(['fourth.vgm']);
  assert.equal(p.list.children.length, 1);
  assert.deepEqual(p.list.children.map(row => row.children[0].textContent), ['fourth.vgm']);
  assert.deepEqual(p.calls, [['load', 'first.vgm'], ['load', 'fourth.vgm']]);
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
  const p = setup(file => file.name !== 'second-broken.vgm');
  await p.add(['first.vgm', 'second-broken.vgm']);
  await p.context.advancePlaylist();
  assert.deepEqual(p.calls, [['load', 'first.vgm'], ['load', 'second-broken.vgm']]);
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

test('numeric filename segments ignore zero padding and sort before larger numbers', async () => {
  const p = setup();
  await p.add(['10.vgm', '02.vgm', '001.vgm', '1.vgm', 'Track 10.s98', 'Track 2.s98']);
  assert.deepEqual(p.list.children.map(row => row.children[0].textContent), ['001.vgm', '1.vgm', '02.vgm', '10.vgm', 'Track 2.s98', 'Track 10.s98']);
  assert.deepEqual(p.calls, [['load', '001.vgm']]);
});

test('replacement starts with the new first track and advances within the new selection', async () => {
  const p = setup();
  await p.add(['02.vgm', '10.vgm']);
  await p.add(['1.vgm', '03.vgm']);
  assert.equal(p.list.children[0].children[0].attributes['aria-current'], 'true');
  assert.deepEqual(p.calls, [['load', '02.vgm'], ['load', '1.vgm']]);
  await p.context.advancePlaylist();
  assert.deepEqual(p.calls.slice(2), [['load', '03.vgm'], ['play', '03.vgm']]);
});

test('replacement cancels a queued selection from the previous playlist', async () => {
  const p = setup();
  await p.add(['02.vgm', '10.vgm']);
  const selecting = p.context.selectPlaylistTrack(1, true);
  const importing = p.add(['1.vgm']);
  await Promise.all([importing, selecting]);
  assert.deepEqual(p.calls, [['load', '02.vgm'], ['load', '1.vgm']]);
});

test('playlist loop is initially off and shown only with multiple music tracks', async () => {
  const p = setup();
  assert.equal(p.context.playlistLoopCheckbox.checked, false);
  assert.equal(p.context.playlistLoopControl.hidden, true);
  await p.add(['first.vgm', 'ym2608_adpcm_rom.bin']);
  assert.equal(p.context.playlistLoopControl.hidden, true);
  await p.add(['second.vgm', 'third.vgm']);
  assert.equal(p.context.playlistLoopControl.hidden, false);
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html.match(/<input id="playlistLoopCheckbox"[^>]*>/)[0], /\bchecked\b/);
});

test('playlist loop returns to the first track and switching it off restores final stop', async () => {
  const p = setup();
  await p.add(['02.vgm', '001.vgm']);
  p.context.playlistLoopCheckbox.checked = true;
  await p.context.advancePlaylist();
  await p.context.advancePlaylist();
  assert.deepEqual(p.calls, [['load', '001.vgm'], ['load', '02.vgm'], ['play', '02.vgm'], ['load', '001.vgm'], ['play', '001.vgm']]);
  p.context.playlistLoopCheckbox.checked = false;
  await p.context.advancePlaylist();
  const callCount = p.calls.length;
  await p.context.advancePlaylist();
  assert.equal(p.calls.length, callCount);
});


test('ROM-only import and cancelled file picker preserve the music playlist', async () => {
  const p = setup();
  await p.add(['song.vgm']);
  await p.add(['rhythm.bin']);
  await p.add([]);
  assert.deepEqual(p.list.children.map(row => row.children[0].textContent), ['song.vgm']);
  assert.deepEqual(p.calls, [['load', 'song.vgm'], ['rom', 'rhythm.bin']]);
});
