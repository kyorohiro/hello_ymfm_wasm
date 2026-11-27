// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {demoVgm,demoTracks} from './demo.js';
import {QSoundPcm} from '../js/qsoundpcm.js';

test('Stop retains the imported ROM and retriggers only the selected ADPCM voice',async()=>{
  let Processor;
  globalThis.sampleRate=48000;
  globalThis.AudioWorkletProcessor=class {port={};};
  globalThis.registerProcessor=(_,type)=>{Processor=type;};
  await import('./processor.js');
  const processor=new Processor();
  const send=data=>processor.port.onmessage({data});
  send({type:'song',bytes:demoVgm(demoTracks.adpcm.score())});
  processor.song.applyDueEvents();
  const rom=processor.chip.rom;
  rom.fill(0x77,40,60);
  const settings=[[0xce,40],[0xcf,60],[0xd0,0],[0xd1,0x7600],[0x91,0x130]];
  send(settings);
  send('stop-audition');
  assert.equal(processor.chip.adpcmRom,rom);
  assert.ok(processor.chip.adpcm.every(v=>v.gain===0 && !v.trigger));
  send([[0xd7,1]]);
  const reference=new QSoundPcm(rom,48000);
  for(const [reg,value] of [...settings,[0xd7,1]])reference.writeRegister(reg,value);
  const render=chip=>{
    const l=new Float32Array(1024),r=l.slice();
    chip.render(l,r);
    return [l,r];
  };
  const result=render(processor.chip);
  assert.deepEqual(result,render(reference));
  assert.ok(result[1].some(x=>x!==0));
  assert.ok(result[0].every(x=>x===0));
});
