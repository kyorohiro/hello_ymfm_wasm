import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultPreset, readPreset, presetToCode} from './preset.js';

test('complete ST preset round-trips as independent readable JSON', () => {
  const original = createDefaultPreset();
  const json = presetToCode(original);
  assert.ok(json.endsWith('\n'));
  assert.match(json, /\n  "voices": \[/);
  const copy = readPreset(json);
  assert.deepEqual(copy, original);
  copy.voices[0].volume = 1;
  copy.envelope.shape = 0;
  assert.equal(original.voices[0].volume, 9);
  assert.equal(original.envelope.shape, 10);
});

test('rejects incomplete, foreign and out-of-range hardware presets', () => {
  const mutate = fn => { const p = createDefaultPreset(); fn(p); return p; };
  for (const invalid of [
    mutate(p => { p.voices.pop(); }),
    mutate(p => { p.voices[1].period = 4096; }),
    mutate(p => { p.voices[1].volume = 16; }),
    mutate(p => { p.voices[1].tone = 1; }),
    mutate(p => { p.noisePeriod = 32; }),
    mutate(p => { p.envelope.shape = 16; }),
    mutate(p => { p.envelope.period = -1; }),
    mutate(p => { p.format = 'tetorica-aswan-voice'; }),
    mutate(p => { p.envelope.attack = 1; }),
    mutate(p => { p.name = '\u0000'; }),
  ]) assert.throws(() => readPreset(invalid));
});
