import test from 'node:test';
import assert from 'node:assert/strict';
import {applyModulation, modulationSettings} from './synth_modulation.js';

test('mod wheel adds chip PMS, enables LFO and restores the untouched patch at zero', () => {
  const patch = {pms:2, ams:1, lfoEnabled:false, lfoFrequency:4};
  assert.deepEqual(modulationSettings(patch, 0), {pms:2, lfoEnabled:false, lfoFrequency:4});
  assert.deepEqual(modulationSettings(patch, 64), {pms:6, lfoEnabled:true, lfoFrequency:4});
  assert.equal(modulationSettings(patch, 127).pms, 7);
  const commands = [];
  applyModulation({setLfo: (...args) => commands.push(args), setPan: (...args) => commands.push(args)}, patch, 127, 6);
  assert.deepEqual(commands[0], [true, 4]);
  assert.equal(commands.length, 7);
  assert.deepEqual(commands[6], [5,true,true,1,7]);
  assert.equal(patch.pms, 2);
  assert.equal(patch.lfoEnabled, false);
  assert.equal(modulationSettings({...patch, lfoEnabled:true}, 0).lfoEnabled, true);
});
