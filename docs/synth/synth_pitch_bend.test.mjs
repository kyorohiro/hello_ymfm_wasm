import test from 'node:test';
import assert from 'node:assert/strict';
import {bendPitch, applyPitchBend} from './synth_pitch_bend.js';

const pitchValue = pitch => pitch.fnum * 2 ** pitch.block;
test('pitch bend shifts by semitones, crosses blocks and restores exact raw tuning', () => {
  for (const base of [{block:4,fnum:553}, {block:3,fnum:2000}, {block:1,fnum:500}]) {
    for (const semitones of [-2, 2]) {
      const shifted = bendPitch(base, semitones);
      assert(Math.abs(pitchValue(shifted) / pitchValue(base) - 2 ** (semitones / 12)) < .002);
    }
    assert.deepEqual(bendPitch(base, 0), base);
  }
  assert.deepEqual(bendPitch({block:7,fnum:2047}, 2), {block:7,fnum:2047});
});
test('held voices and release tails bend from original pitches without accumulating drift', () => {
  const voices = [{channel:0,basePitch:{block:4,fnum:553}}, {channel:1,basePitch:null}];
  const commands = [];
  const synth = {setFrequency: (...args) => commands.push(args)};
  applyPitchBend(synth, voices, 2);
  applyPitchBend(synth, voices, 2);
  assert.deepEqual(commands[0], commands[1]);
  applyPitchBend(synth, voices, 0);
  assert.deepEqual(commands[2], [0,4,553]);
  assert.deepEqual(voices[0].basePitch, {block:4,fnum:553});
});
