import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./vgm_analyzer.js', import.meta.url), 'utf8');

function loadDetectedChips() {
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function formatClockHz('), source.indexOf('function detectPlaybackChipKind(')), context);
  return context;
}

test('formatClockHz renders MHz/kHz the way real VGM clocks read', () => {
  const { formatClockHz } = loadDetectedChips();
  assert.equal(formatClockHz(3579545), '3.58 MHz');
  assert.equal(formatClockHz(4000000), '4 MHz');
  assert.equal(formatClockHz(1789773), '1.79 MHz');
  assert.equal(formatClockHz(500000), '500 kHz');
});

test('detectHeaderChips lists every chip clock the header declares, regardless of playback support', () => {
  const { detectHeaderChips } = loadDetectedChips();
  // Cross-realm arrays from the vm sandbox need re-boxing via [...] before
  // deepEqual, since their Array prototype differs from this realm's.
  assert.deepEqual([...detectHeaderChips({ ym2612Clock: 7670454, psgClock: 3579545 })],
    ['YM2612 (7.67 MHz)', 'Sega PSG (3.58 MHz)']);
  // YM2151 + Sega PCM (e.g. OutRun): both must be listed even though this
  // combination previously failed to play (the bug that motivated this).
  assert.deepEqual([...detectHeaderChips({ ym2151Clock: 3579545, segaPcmClock: 4000000 })],
    ['YM2151 (3.58 MHz)', 'Sega PCM (4 MHz)']);
  assert.deepEqual([...detectHeaderChips({})], []);
  // The high "second chip"/variant bits are not part of the Hz value.
  assert.deepEqual([...detectHeaderChips({ ay8910Clock: 0x40000000 | 1789773 })], ['AY-3-8910 / YM2149 (1.79 MHz)']);
});

test('renderDetectedChips shows a joined summary and hides the element when nothing is declared', () => {
  const context = vm.createContext({ detectedChipsOutput: { textContent: '', hidden: false } });
  vm.runInContext(source.slice(source.indexOf('function formatClockHz('), source.indexOf('function detectPlaybackChipKind(')), context);
  context.renderDetectedChips({ ym2151Clock: 3579545, segaPcmClock: 4000000 });
  assert.equal(context.detectedChipsOutput.hidden, false);
  assert.equal(context.detectedChipsOutput.textContent, 'Uses: YM2151 (3.58 MHz), Sega PCM (4 MHz)');
  context.renderDetectedChips({});
  assert.equal(context.detectedChipsOutput.hidden, true);
  assert.equal(context.detectedChipsOutput.textContent, '');
});
