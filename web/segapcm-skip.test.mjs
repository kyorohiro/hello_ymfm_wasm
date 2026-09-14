import test from 'node:test';
import assert from 'node:assert/strict';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsParser} from '../docs/js/ym2612vgm.js';
import {mockChips,vgmBytes} from './test-support/vgm-mock.js';
for(const [name,Parser] of [['web',Ym2612VGM],['docs',DocsParser]])test(`${name}: Sega PCM block and writes skip while OPM keeps exact timing`,()=>{
 const mock=mockChips();const bytes=vgmBytes([0x67,0x66,0x80,10,0,0,0,16,0,0,0,4,0,0,0,18,52,
  0xc0,2,0,99,0x54,0x20,0xc7,0x71,0xc0,3,0,11,0x54,8,0x78,0x66]);
 mock.run(new Parser(bytes,{logger:mock.logger}));
 assert.deepEqual(mock.trace,[{sample:0,chip:'ym2151',instance:0,method:'register',args:[0,0x20,0xc7]},
  {sample:2,chip:'ym2151',instance:0,method:'register',args:[0,8,0x78]}]);
 assert.equal(mock.warnings.length,3);
 assert.throws(()=>mock.run(new Parser(vgmBytes([0x67,0x66,0x80,10,0,0,0,1]))),/Unexpected end/);
});
