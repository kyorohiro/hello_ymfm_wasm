import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectPlaygroundDeclarations} from './playground_declarations.js';

const source = await readFile(new URL('./tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
test('Genesis declarations keep existing convenience APIs and MIDI channel constants', () => {
  const selected = selectPlaygroundDeclarations(source, 'ym2612');
  assert.equal(selected, source.replace(/^declare const (?:ssg|rhythm|adpcm|adpcmA|adpcmB|ws|pokey|pokey2|gameboy|nes|snes|opm|pce|dx7|opl|opll|ay|OPL_PRESETS|OPLL_INSTRUMENTS|OPLL_USER_PRESETS): [^\n]+\n/gm, ''));
});

test('Mega-CD keeps Genesis FM, PSG, DAC and MIDI channel conveniences', () => {
  assert.equal(selectPlaygroundDeclarations(source, 'mega-cd'), selectPlaygroundDeclarations(source, 'ym2612'));
});
for (const [chip, channels] of [['ym2203',3],['ym2608',6],['ym2610',4],['ym2610b',6]]) {
  test(`${chip} completion globals match FM channels and omit Genesis PSG/DAC shortcuts`, () => {
    const selected = selectPlaygroundDeclarations(source, chip);
    const names = [...selected.matchAll(/^declare const CH(\d+):/gm)].map(match => Number(match[1]));
    assert.deepEqual(names, Array.from({length:channels}, (_, i) => i + 1));
    assert.doesNotMatch(selected, /^declare const (psg|PSG[123]|dac)[: ]/m);
    assert.doesNotMatch(selected, /^declare function psg(?:Tone|Noise)\(/m);
    // Independent chip/sample/DAC types remain usable by explicitly created chips.
    assert.match(selected, /type YM2612PcmDac =/);
    assert.match(selected, /declare function useSoundChip</);
    assert.match(selected, /declare const fm: PlaygroundSelectedFm;/);
    assert.match(selected, /declare function sleep\(/);
    const opna = chip === 'ym2608';
    const opnb = chip === 'ym2610' || chip === 'ym2610b';
    for (const section of ['ssg','rhythm','adpcm','adpcmA','adpcmB']) {
      const available = section === 'ssg' ? chip === 'ym2203' || opna || opnb
        : section === 'rhythm' ? opna : section === 'adpcmA' || section === 'adpcmB' ? opnb : opna || opnb;
      assert.equal(new RegExp(`^declare const ${section}:`, 'm').test(selected), available, section);
    }
  });
}

test('Game Boy globals expose its native APU and shared helpers without FM shortcuts', () => {
  const selected = selectPlaygroundDeclarations(source, 'gameboy');
  assert.match(selected, /^declare const gameboy: PlaygroundPrimaryGameboy;/m);
  assert.doesNotMatch(selected, /^declare const (?:fm|FM_PRESETS|CH\d+|OP\d+|psg|PSG\d+|dac|ssg|rhythm|adpcm[AB]?):/m);
  assert.doesNotMatch(selected, /^declare function (?:play|write|scheduleWritesSamples|psgTone|psgNoise|noteToBlockFnum|hzToBlockFnum|noteLerp|tfiToPreset|vgiToPreset|setDacLookahead|getDacLookahead)\(/m);
  for (const name of ['beat','sleep','liveLoop','tween','scale','chord','beginSampleSchedule','useSoundChip']) {
    assert.match(selected, new RegExp(`^declare function ${name}[<(]`, 'm'));
  }
  for (const name of ['sample','stream','noise']) assert.match(selected, new RegExp(`^declare const ${name}:`, 'm'));
  assert.match(selected, /type FMApi =/);
  assert.match(selected, /type PlaygroundCreatedOPN</);
});

for (const [chip, globals] of [['pokey',['pokey']],['pokey-dual',['pokey','pokey2']],['wonderswan',['ws']],['nes',['nes']],['snes',['snes']],['x68000',['opm','adpcm']],['huc6280',['pce']],['dx7',['dx7']],['atari-st',['ay']]]) {
  test(`${chip} exposes only native primary globals and shared helpers`, () => {
    const selected = selectPlaygroundDeclarations(source, chip);
    for (const name of ['ws','pokey','pokey2','gameboy','nes','snes','opm','pce','adpcm','dx7','ay','opll','opl']) {
      assert.equal(new RegExp(`^declare const ${name}:`, 'm').test(selected), globals.includes(name), name);
    }
    assert.doesNotMatch(selected, /^declare const (?:fm|FM_PRESETS|midi|CH\d+|OP\d+|psg|PSG\d+|dac|ssg|rhythm|adpcm[AB]):/m);
    assert.doesNotMatch(selected, /^declare function (?:play|write|scheduleWritesSamples|noteToBlockFnum|hzToBlockFnum|noteLerp|tfiToPreset|vgiToPreset|setDacLookahead|getDacLookahead)\(/m);
    for (const name of ['beat','sleep','liveLoop','tween','scale','chord','beginSampleSchedule','useSoundChip']) {
      assert.match(selected, new RegExp(`^declare function ${name}[<(]`, 'm'));
    }
    for (const name of ['sample','stream','noise']) assert.match(selected, new RegExp(`^declare const ${name}:`, 'm'));
  });
}

for (const chip of ['game-gear', 'master-system']) {
  test(`${chip} exposes its primary PSG without Genesis or other native shortcuts`, () => {
    const selected = selectPlaygroundDeclarations(source, chip);
    assert.match(selected, /^declare const psg: PlaygroundSelectedPsg;/m);
    for (const [index, name] of ['PSG1','PSG2','PSG3'].entries()) {
      assert.match(selected, new RegExp(`^declare const ${name}: ${index};`, 'm'));
    }
    assert.doesNotMatch(selected, /^declare const (?:fm|FM_PRESETS|midi|CH\d+|OP\d+|dac|ssg|rhythm|adpcm[AB]?|gameboy|nes|snes|opm|pce):/m);
    assert.doesNotMatch(selected, /^declare function (?:play|write|scheduleWritesSamples|psgTone|psgNoise|noteToBlockFnum|hzToBlockFnum|noteLerp|tfiToPreset|vgiToPreset|setDacLookahead|getDacLookahead)\(/m);
    for (const name of ['beat','sleep','liveLoop','tween','scale','chord','beginSampleSchedule','useSoundChip']) {
      assert.match(selected, new RegExp(`^declare function ${name}[<(]`, 'm'));
    }
  });
}
