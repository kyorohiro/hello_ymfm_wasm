import test from 'node:test';
import assert from 'node:assert/strict';
import { createPsgMonitor, applySsgWrite, applyPsgWrite } from './psg_monitor.js';
import { describeToneNotes, extractToneNotes } from './tone_notes.js';

test('live SSG clock, mixer, fixed volume and prescalers match note extraction math',()=>{
  for(const [kind,clock] of [['ym2203',4000000],['ym2608',8000000]]) {
    const s=createPsgMonitor(kind);
    for(const [r,v] of [[7,0x3e],[0,28],[1,1],[8,15]]) applySsgWrite(s,0,r,v,0);
    const a=describeToneNotes(s,clock)[0];
    assert.ok(a.keyOn);assert.ok(Math.abs(a.midi-69)<0.02);
    applySsgWrite(s,0,0x2e,0,1);
    assert.ok(Math.abs(describeToneNotes(s,clock)[0].midi-a.midi-12)<1e-8);
    applySsgWrite(s,0,8,0,2);assert.equal(describeToneNotes(s,clock)[0].keyOn,false);
    applySsgWrite(s,0,8,16,3);assert.equal(describeToneNotes(s,clock)[0].keyOn,true);
    applySsgWrite(s,0,7,0x3f,4);assert.equal(describeToneNotes(s,clock)[0].keyOn,false);
  }
});
test('live PSG period zero is Sega 1024 and attenuation 15 is off',()=>{
  const s=createPsgMonitor('ym2612');
  applyPsgWrite(s,0x90,0);
  assert.ok(Math.abs(describeToneNotes(s,3579545)[0].midi-(69+12*Math.log2(3579545/32/1024/440)))<1e-8);
  applyPsgWrite(s,0x9f,1);assert.equal(describeToneNotes(s,3579545)[0].keyOn,false);
});
test('SSG envelope shape retriggers, prescaler changes bend, end closes held note',()=>{
  const commands=[0x56,7,0x3e,0x56,0,28,0x56,1,1,0x56,8,16,0x61,100,0,
    0x56,13,9,0x61,100,0,0x56,0x2e,0,0x61,100,0,0x66];
  const b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);
  b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x34,0xcc,true);v.setUint32(0x48,8000000,true);b.set(commands,256);
  const r=extractToneNotes(b,'ym2608'),n=r.channels[0].notes;
  assert.equal(n.length,3);assert.notEqual(n[0].key,n[1].key);assert.equal(n[1].key,n[2].key);
  assert.equal(n[2].end,300);assert.ok(Math.abs(n[2].midi-n[1].midi-12)<1e-8);
  assert.ok([...r.warnings.keys()].some(x=>x.includes('envelope phase')));
});
