import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpnAdpcmMonitor, writeOpnAdpcm, opnAdpcmRows} from './opn_adpcm_monitor.js';

test('ADPCM-A retriggers flash only selected channels and preserve programmed addresses', () => {
  const state = createOpnAdpcmMonitor();
  assert.equal(writeOpnAdpcm(state, 1, 0x30, 0xff, 1), false);
  writeOpnAdpcm(state, 1, 0x1d, 0x12, 2);
  writeOpnAdpcm(state, 1, 0x15, 0x34, 3);
  writeOpnAdpcm(state, 1, 0, 0x21, 10);
  writeOpnAdpcm(state, 1, 0, 0x20, 20);
  assert.deepEqual(state.starts, [10,0,0,0,0,20,0]);
  writeOpnAdpcm(state, 1, 0, 0xa0, 30);
  assert.deepEqual(opnAdpcmRows(state,'A')[5].values, ['Stop','0x123400','0x0000FF',31,'L+R']);
  assert.deepEqual(state.starts, [10,0,0,0,0,0,0]);
});

test('ADPCM-B reset takes priority over start and seek reconstruction leaves its lamp off', () => {
  const state = createOpnAdpcmMonitor();
  writeOpnAdpcm(state, 0, 0x10, 0x90, 0);
  assert.equal(state.commands[6], 'Start');
  assert.equal(state.starts[6], 0);
  writeOpnAdpcm(state, 0, 0x10, 0x81, 100);
  assert.equal(state.commands[6], 'Reset');
  assert.equal(state.starts[6], 0);
  assert.equal(writeOpnAdpcm(state, 0, 0x1c, 0xff, 101), false);
});

test('OPNA Delta-T programmed byte ranges match Sample Explorer at external playback start', async () => {
  const {extractSamples} = await import('./sample_core.js');
  for (const mode of [0,1,2,3]) {
    const monitor = createOpnAdpcmMonitor('ym2608');
    const commands = [];
    for (const [reg,value] of [[1,mode],[2,2],[4,7],[12,255],[13,255],[0,0xa0]]) {
      writeOpnAdpcm(monitor,1,reg,value,1);
      commands.push(0x57,reg,value);
    }
    commands.push(0x62,0x66);
    const vgm = Buffer.alloc(0x100 + commands.length);
    vgm.write('Vgm '); vgm.writeUInt32LE(vgm.length-4,4); vgm.writeUInt32LE(0x171,8);
    vgm.writeUInt32LE(0xcc,0x34); vgm.writeUInt32LE(8000000,0x48); vgm.set(commands,0x100);
    const {samples:[sample]} = await extractSamples(vgm);
    const values = opnAdpcmRows(monitor,'B')[0].values;
    assert.deepEqual(values.slice(1,3).map(Number),[sample.byteStart,sample.byteEndExclusive-1]);
  }
});

test('OPNA links the external Delta-T start and clears it for CPU, recording or limit-wrapped starts', () => {
  const state = createOpnAdpcmMonitor('ym2608');
  const write = (reg,value,offset) => writeOpnAdpcm(state,1,reg,value,1,offset);
  write(4,7); write(9,0x34); write(10,0x12);
  write(0,0xa0,100);
  const trigger = state.lastTriggers[6];
  assert.deepEqual(trigger,{channel:1,commandEnd:100,rawStart:0,rawEnd:7,deltaN:0x1234,addressUnit:4});
  write(1,1); write(10,0x24); write(0,1);
  assert.equal(state.lastTriggers[6],trigger);
  for (const command of [0x80,0xe0]) {
    write(0,0xa0,110);
    assert.equal(state.lastTriggers[6].addressUnit,32);
    write(0,command,115);
    assert.equal(state.lastTriggers[6],null);
  }
  write(12,3); write(13,0); write(0,0xa0,120);
  assert.equal(state.lastTriggers[6],null);
});
