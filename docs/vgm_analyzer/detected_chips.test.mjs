import * as playback from './playback_core.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./vgm_analyzer.js', import.meta.url), 'utf8');

function loadDetectedChips() {
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function formatClockHz('), source.indexOf('function applyYm2203WriteToMonitor(')), context);
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

function loadChipKindDetection() { return playback; }
function fakeVgm(header, commands) {
  return { header, analyzeCommandUsage: () => new Map(commands.map((cmd) => [cmd, 1])) };
}

test('detectPlaybackChipKindFromVgm requires the chip\'s own command to actually appear in the stream', () => {
  const { detectPlaybackChipKindFromVgm } = loadChipKindDetection();
  // A real Game Boy / Sega PCM track: the header clock is backed by at
  // least one matching write command in the data.
  assert.equal(detectPlaybackChipKindFromVgm(fakeVgm({ gameBoyDmgClock: 4194304 }, ['0xb3', '0x66'])), 'gameboy');
  assert.equal(detectPlaybackChipKindFromVgm(fakeVgm({ segaPcmClock: 4000000 }, ['0xc0', '0x66'])), 'segapcm');
  // Real-world bug: an MSX/other track's header claims a version new enough
  // to carry these v1.51/v1.61 fields but never actually zeroed the
  // reserved bytes there (including the top "variant" bits) - and the
  // command stream never writes 0xB3/0xC0 at all. Must not be played as a
  // phantom Game Boy/Sega PCM track.
  assert.equal(detectPlaybackChipKindFromVgm(fakeVgm({ gameBoyDmgClock: 0xc0000000 | 4194304 }, ['0x61', '0x66'])), 'ym2612');
  assert.equal(detectPlaybackChipKindFromVgm(fakeVgm({ ay8910Clock: 1789773, gameBoyDmgClock: 4194304 }, ['0xa0', '0x66'])), 'ay8910');
  assert.equal(detectPlaybackChipKindFromVgm(fakeVgm({ ym2612Clock: 7670454, segaPcmClock: 4000000 }, ['0x52', '0x66'])), 'ym2612');
});

test('isUnsupportedOplFamilyCombination rejects real conflicts but not stray Sega PCM/Game Boy noise', () => {
  const { isUnsupportedOplFamilyCombination } = loadChipKindDetection();
  assert.equal(isUnsupportedOplFamilyCombination('y8950', { y8950Clock: 3579545 }), false);
  assert.equal(isUnsupportedOplFamilyCombination('y8950', { y8950Clock: 3579545, ym2413Clock: 3579545 }), true);
  assert.equal(isUnsupportedOplFamilyCombination('y8950', { y8950Clock: 0xc0000000 | 3579545 }), true);
  // Sega PCM / Game Boy DMG noise must not veto an established chip, nor
  // veto each other when one of them is the (already command-verified) chip.
  assert.equal(isUnsupportedOplFamilyCombination('y8950', { y8950Clock: 3579545, gameBoyDmgClock: 0xc0000000 | 4194304 }), false);
  assert.equal(isUnsupportedOplFamilyCombination('gameboy', { gameBoyDmgClock: 0xc0000000 | 4194304 }), false);
  assert.equal(isUnsupportedOplFamilyCombination('gameboy', { gameBoyDmgClock: 4194304, y8950Clock: 3579545 }), true);
});

test('renderDetectedChips shows a joined summary and hides the element when nothing is declared', () => {
  const context = vm.createContext({ detectedChipsOutput: { textContent: '', hidden: false } });
  vm.runInContext(source.slice(source.indexOf('function formatClockHz('), source.indexOf('function applyYm2203WriteToMonitor(')), context);
  context.renderDetectedChips({ ym2151Clock: 3579545, segaPcmClock: 4000000 });
  assert.equal(context.detectedChipsOutput.hidden, false);
  assert.equal(context.detectedChipsOutput.textContent, 'Uses: YM2151 (3.58 MHz), Sega PCM (4 MHz)');
  context.renderDetectedChips({});
  assert.equal(context.detectedChipsOutput.hidden, true);
  assert.equal(context.detectedChipsOutput.textContent, '');
});
