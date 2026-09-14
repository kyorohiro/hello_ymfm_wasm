import test from 'node:test';
import assert from 'node:assert/strict';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsVGM} from '../docs/js/ym2612vgm.js';
import {mockChips, vgmBytes} from './test-support/vgm-mock.js';

// Expected traces are literal specification examples, never derived from step().
const register = (sample, chip, port, address, value) =>
  ({sample, chip, instance:0, method:'register', args:[port,address,value]});
import {registerCases as cases} from './test-support/vgm-register-cases.js';

for (const [label, Parser] of [['web',Ym2612VGM],['docs',DocsVGM]]) {
  for (const [chip, bytes, port, address, value] of cases) test(`${label}: ${chip} command ${bytes[0].toString(16)} routes exact write`, () => {
    const mock = mockChips();
    mock.run(new Parser(vgmBytes([...bytes,0x66]), {logger:mock.logger}));
    assert.deepEqual(mock.trace, [register(0,chip,port,address,value)]);
    assert.deepEqual(mock.warnings, []);
  });
  test(`${label}: wait forms preserve absolute write times and end ignores trailing data`, () => {
    const mock = mockChips();
    const bytes = vgmBytes([0x50,0x90, 0x70,0x51,0x10,1, 0x7f,0x51,0x10,2,
      0x61,0x34,0x12,0x51,0x10,3, 0x62,0x51,0x10,4, 0x63,0x51,0x10,5,
      0x66,0x51,0x10,99]);
    mock.run(new Parser(bytes));
    assert.deepEqual(mock.trace, [
      {sample:0,chip:'psg',instance:0,method:'write',args:[0x90]},
      register(1,'ym2413',0,0x10,1),register(17,'ym2413',0,0x10,2),
      register(4677,'ym2413',0,0x10,3),register(5412,'ym2413',0,0x10,4),register(6294,'ym2413',0,0x10,5),
    ]);
    assert.equal(mock.sample,6294);
  });
  test(`${label}: MSX resolver routes ADPCM and interleaved chip writes in order`, () => {
    const mock = mockChips(); mock.targets.resolveChip = mock.resolveChip;
    const bytes=vgmBytes([0x67,0x66,0x88,10,0,0,0, 16,0,0,0, 4,0,0,0, 0x12,0x34,
      0xa0,8,15, 0x51,0x20,0x17, 0x61,2,0, 0x5c,7,0xb0,0x66]);
    const parser=new Parser(bytes);
    const expected=[{sample:0,chip:'y8950',instance:0,method:'samples',args:[4,16,[0x12,0x34]]},
      register(0,'ay8910',0,8,15),register(0,'ym2413',0,0x20,0x17),register(2,'y8950',0,7,0xb0)];
    assert.deepEqual(mock.run(parser),expected);
    parser.reset();mock.clear();assert.deepEqual(mock.run(parser),expected);
  });
  test(`${label}: PWM stream writes at start and period boundaries regardless of wait partition`, () => {
    const bytes=vgmBytes([0x67,0x66,3,4,0,0,0, 0x23,0x01,0x56,0x04,
      0x90,0,0x11,0,2, 0x91,0,3,1,0, 0x92,0,0x22,0x56,0,0,
      0x93,0,0,0,0,0,1,2,0,0,0, 0x61,5,0, 0x66]);
    const expected=[register(0,'pwm',0,2,0x123),register(2,'pwm',0,2,0x456)];
    for (const splitWait of [Infinity,1,2,3]) {
      const mock=mockChips();assert.deepEqual(mock.run(new Parser(bytes),{splitWait}),expected);assert.equal(mock.sample,5);
    }
  });
  test(`${label}: truncated writes never reach a chip; earlier valid writes are retained`, () => {
    for(const [, bytes] of cases) for(let length=1;length<bytes.length;length++) {
      const mock=mockChips();const parser=new Parser(vgmBytes([0x50,0x9f,...bytes.slice(0,length)]));
      assert.throws(()=>mock.run(parser),/Unexpected end/);
      assert.deepEqual(mock.trace,[{sample:0,chip:'psg',instance:0,method:'write',args:[0x9f]}]);
    }
  });
}
