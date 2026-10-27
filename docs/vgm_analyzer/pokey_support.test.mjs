import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {chipSupportContext} from './test_helpers/chip_support_context.mjs';
const source = readFileSync(new URL('./vgm_analyzer.js', import.meta.url), 'utf8');
const functionSource = name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};

test('POKEY live monitor permits only Operator Info / parsed data and rejects all score and FM exports', () => {
  const context = {...chipSupportContext(), currentChipKind: 'pokey', currentBuffer: {}, midiExportAvailable: true,
    setOutputTab(name) {context.selected = name;}};
  vm.createContext(context); vm.runInContext(functionSource('updateChipSupport'), context);
  context.updateChipSupport();
  assert.equal(context.selected, 'operator-info');
  assert.equal(context.operatorInfoTab.disabled, false);
  for (const key of ['noteishTab', 'tfiInfoTab', 'sampleTab', 'sheetMusicTab', 'exportMidiButton', 'exportMmlButton',
    'exportLilyPondButton', 'exportSnapshotButton', 'exportSnapshotTfiButton', 'exportSnapshotVgiButton', 'exportAllTfiButton', 'exportAllVgiButton']) {
    assert.equal(context[key].disabled, true, key);
  }
  assert.equal(context.document.getElementById('pokeyMonitor').hidden, false);
  assert.match(context.document.getElementById('chipSupportNotice').textContent, /one or two independent chips/);
  context.currentChipKind = 'ym2612'; context.updateChipSupport();
  assert.equal(context.operatorInfoTab.disabled, false);
  assert.equal(context.document.getElementById('pokeyMonitor').hidden, true);
});

test('POKEY never falls through to an FM monitor, Song timeline or direct FM export handler', () => {
  const mutes = Array(8).fill(false);
  const context = vm.createContext({currentChipKind: 'pokey', pokeyChannelMutes: mutes, noteishHeader: {pokeyClock: 1789773 | 0x40000000}});
  for (const name of ['channelMutesForChip', 'createChannelMonitorState', 'noteishChannels', 'scoreExportAvailable',
    'downloadAllTfiZip', 'downloadAllVgiZip', 'downloadSnapshot', 'downloadSnapshotTfiZip', 'downloadSnapshotVgiZip']) {
    vm.runInContext(functionSource(name), context);
  }
  assert.equal(context.channelMutesForChip('pokey'), mutes);
  assert.equal(context.createChannelMonitorState().length, 0);
  assert.equal(context.noteishChannels().length, 0);
  assert.equal(context.scoreExportAvailable(), false);
  for (const name of ['downloadAllTfiZip', 'downloadAllVgiZip', 'downloadSnapshot', 'downloadSnapshotTfiZip', 'downloadSnapshotVgiZip']) {
    assert.doesNotThrow(() => context[name]());
  }
  const start = source.indexOf('  currentBuffer = buffer;'), end = source.indexOf('  playbackSeek.max', start);
  let loads = 0;
  vm.runInNewContext(source.slice(start, end), {currentBuffer: null, currentChipKind: 'pokey', buffer: {}, songTimeline: {load() {loads++;}}});
  assert.equal(loads, 0);
});

test('POKEY detection labels both physical chips and renders unique 4/8 output mute controls', () => {
  const metadata = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function formatClockHz('), source.indexOf('function applyYm2203WriteToMonitor(')), metadata);
  assert.deepEqual(Array.from(metadata.detectHeaderChips({pokeyClock: 1789790})), ['POKEY (1.79 MHz)']);
  assert.deepEqual(Array.from(metadata.detectHeaderChips({pokeyClock: 1789773 | 0x40000000})), ['POKEY × 2 (1.79 MHz)']);
  for (const count of [4, 8]) {
    const controls = [], pokeyChannelMutes = Array(count).fill(false), applied = [];
    const context = vm.createContext({currentChipKind: 'pokey', noteishHeader: {}, pokeyChannelMutes,
      CHANNEL_MUTE_CHIPS: ['pokey'], channelMonitor: [], monitorToggles: {append: b => controls.push(b)},
      inlineMonitorToggles: {replaceChildren() {}}, ensureMonitorToggleHandler() {},
      sourcesForChip: () => [], sourceChipKind: () => 'pokey', hasOkiSource: () => false,
      document: {createElement: () => ({attrs: {}, setAttribute(k, v) {this.attrs[k] = v;}, cloneNode() {return this;}})},
      engine: {setChannelMuted(...args) {applied.push(args);}}, renderMonitorToggles() {},
      requestChannelMonitorRender() {}, flushPendingAudio() {},
    });
    vm.runInContext(functionSource('channelMutesForChip') + '\n' + functionSource('renderMonitorToggles') + '\n' + functionSource('toggleOpmChannelMute'), context);
    // The function clones its buttons into the compact playback dock.
    context.monitorToggles.children = controls;
    context.renderMonitorToggles();
    assert.equal(controls.length, count);
    assert.deepEqual(controls.map(b => b.attrs['data-channel-index']), Array.from({length: count}, (_, i) => String(i)));
    assert.equal(controls[0].textContent, count === 4 ? 'POKEY CH1' : 'POKEY 1 CH1');
    assert.equal(controls[count - 1].textContent, count === 4 ? 'POKEY CH4' : 'POKEY 2 CH4');
    context.toggleOpmChannelMute(count - 1);
    assert.deepEqual(applied, [[count - 1, true]]);
    assert.deepEqual(pokeyChannelMutes, Array.from({length: count}, (_, i) => i === count - 1));
    context.toggleOpmChannelMute(count); assert.equal(applied.length, 1);
  }
});
