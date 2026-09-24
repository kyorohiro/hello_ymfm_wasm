import test from 'node:test';
import assert from 'node:assert/strict';
import {exportFmRegisterSnapshot} from './fm_snapshot.js';
function source(chip,commands){const b=new Uint8Array(256+commands.length+1),v=new DataView(b.buffer);b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x34,0xcc,true);v.setUint32({ym2151:0x30,ymf262:0x5c,ymf278b:0x60}[chip],chip==='ym2151'?3579545:chip==='ymf262'?14318180:33868800,true);b.set([...commands,0x66],256);return b;}
test('OPM JSON retains separate AMD/PMD and operator key state at requested time',()=>{
 const b=source('ym2151',[0x54,0x19,33,0x54,0x19,128|55,0x54,8,0x78,0x54,0x40,0x72,0x61,100,0,0x54,8,0,0x61,100,0]);
 const a=JSON.parse(JSON.stringify(exportFmRegisterSnapshot(b,{chip:'ym2151',atSample:99})));
 assert.equal(a.lfo.amd,33);assert.equal(a.lfo.pmd,55);assert(a.channels[0].operators.every(o=>o.key));assert.equal(a.channels[0].operators[0].dt1,7);
 assert(exportFmRegisterSnapshot(b,{chip:'ym2151',atSample:100}).channels[0].operators.every(o=>!o.key));
});
for(const chip of ['ymf262','ymf278b'])test(`${chip} JSON retains both banks, 4op links, operators and rhythm`,()=>{
 const w=(p,r,v)=>chip==='ymf262'?[0x5e+p,r,v]:[0xd0,p,r,v];
 const b=source(chip,[...w(1,5,1),...w(1,4,9),...w(1,0x20,0xf5),...w(1,0xe0,7),...w(0,0xbd,0x3f),...(chip==='ymf278b'?w(2,0x68,128):[]),0x61,100,0]);
 const a=JSON.parse(JSON.stringify(exportFmRegisterSnapshot(b,{chip})));
 assert.equal(a.registers.length,512);assert.equal(a.channels.length,18);assert.equal(a.channels[0].pairChannel,4);assert.equal(a.channels[12].pairChannel,10);
 assert.equal(a.channels[9].operators[0].multiplier,5);assert.equal(a.channels[9].operators[0].waveformRegister,7);assert.equal(a.rhythm,63);
 if(chip==='ymf278b')assert.equal(a.pcm.registers[0x68],128);
 assert.throws(()=>exportFmRegisterSnapshot(b,{chip,atSample:101}),/track end/);
 const v=new DataView(b.buffer),offset=chip==='ymf262'?0x5c:0x60;v.setUint32(offset,v.getUint32(offset,true)|0x40000000,true);
 assert.throws(()=>exportFmRegisterSnapshot(b,{chip}),/single/);
});
