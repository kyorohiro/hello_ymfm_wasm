import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpnbAdpcmMonitor, writeOpnbAdpcm, opnbAdpcmRows} from './opnb_adpcm_monitor.js';

test('ADPCM-A retriggers flash only selected channels and preserve programmed addresses', () => {
  const state = createOpnbAdpcmMonitor();
  assert.equal(writeOpnbAdpcm(state, 1, 0x30, 0xff, 1), false);
  writeOpnbAdpcm(state, 1, 0x1d, 0x12, 2);
  writeOpnbAdpcm(state, 1, 0x15, 0x34, 3);
  writeOpnbAdpcm(state, 1, 0, 0x21, 10);
  writeOpnbAdpcm(state, 1, 0, 0x20, 20);
  assert.deepEqual(state.starts, [10,0,0,0,0,20,0]);
  writeOpnbAdpcm(state, 1, 0, 0xa0, 30);
  assert.deepEqual(opnbAdpcmRows(state,'A')[5].values, ['Stop','0x123400','0x0000FF',31,'L+R']);
  assert.deepEqual(state.starts, [10,0,0,0,0,0,0]);
});

test('ADPCM-B reset takes priority over start and seek reconstruction leaves its lamp off', () => {
  const state = createOpnbAdpcmMonitor();
  writeOpnbAdpcm(state, 0, 0x10, 0x90, 0);
  assert.equal(state.commands[6], 'Start');
  assert.equal(state.starts[6], 0);
  writeOpnbAdpcm(state, 0, 0x10, 0x81, 100);
  assert.equal(state.commands[6], 'Reset');
  assert.equal(state.starts[6], 0);
  assert.equal(writeOpnbAdpcm(state, 0, 0x1c, 0xff, 101), false);
});
