import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectPlaygroundDeclarations} from './playground_declarations.js';

const source = await readFile(new URL('./tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
test('Genesis declarations keep existing convenience APIs and MIDI channel constants', () => {
  const selected = selectPlaygroundDeclarations(source, 'ym2612');
  assert.equal(selected, source.replace(/^declare const (?:ssg|rhythm|adpcm): [^\n]+\n/gm, ''));
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
    for (const section of ['ssg','rhythm','adpcm']) {
      assert.equal(new RegExp(`^declare const ${section}:`, 'm').test(selected), chip === 'ym2608');
    }
  });
}
