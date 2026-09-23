import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSccMonitor,applySccWrite,describeSccNotes} from './scc_notes.js';
import {extractMsxNotes} from './msx_notes.js';
import {analyzeLilyPondSource} from './vgm_lilypond.js';
import {exportSource,listSourceScoreChannels,inspectSourceSupport} from './analyzer_core.js';
const clock=1789773;
const w=(p,r,v)=>[0xd2,p,r,v],wait=n=>[0x61,n&255,n>>8];
function vgm(commands,plus=false){
 const b=new Uint8Array(256+commands.length+1),h=new DataView(b.buffer);
 b.set([86,103,109,32]);h.setUint32(8,0x171,true);h.setUint32(0x34,0xcc,true);
 h.setUint32(0x9c,(clock|(plus?0x80000000:0))>>>0,true);b.set(commands,256);b[b.length-1]=0x66;return b;
}
const fixture=parts=>readFileSync(new URL(`../../test/fixtures/msx-${parts.join('-')}.vgm`,import.meta.url));
test('SCC pitch is clock/(32*(period+1)); silence and retriggers retain timing and key identity',()=>{
 const source=vgm([...w(0,1,127),...w(1,0,126),...w(3,0,1),...wait(100),
  ...w(1,0,127),...wait(100),...w(2,0,0),...wait(100),...w(2,0,15),...wait(100),
  ...w(3,0,0),...w(3,0,1),...wait(100),...w(1,0,8),...wait(100),
  ...w(1,0,127),...w(5,0,1),...wait(100),...w(5,0,0),...wait(100),...w(0,1,0),...wait(100)]);
 const a=extractMsxNotes(source),notes=a.channels[0].notes;
 assert.equal(a.time,900);
 assert.deepEqual(notes.map(n=>[n.start,n.end,n.key]),[[0,100,1],[100,200,1],[300,400,2],[400,500,3],[700,800,5]]);
 assert(Math.abs(notes[0].midi-(69+12*Math.log2(clock/(32*127)/440)))<1e-10);
 assert(a.channels.slice(1).every(c=>c.notes.length===0));
});
test('SCC shares CH4/5 waves; SCC+ port 4 keeps all five independent',()=>{
 for(const plus of [false,true]){
  const state=createSccMonitor(plus);
  for(const ch of [3,4]){applySccWrite(state,1,ch*2,127);applySccWrite(state,2,ch,15);}
  applySccWrite(state,3,0,24);applySccWrite(state,plus?4:0,0x61,127);
  assert.deepEqual(describeSccNotes(state,clock).slice(3).map(n=>n.keyOn),[true,!plus]);
  applySccWrite(state,4,0x81,64);
  assert(describeSccNotes(state,clock)[4].keyOn);
  assert.equal(state.channels[3].wave[1],127);assert.equal(state.channels[4].wave[1],64);
  if(!plus){applySccWrite(state,5,0,0x80);applySccWrite(state,0,0x61,0);assert.equal(state.channels[3].wave[1],127);}
 }
});
test('SCC+ keeps names and pitched notes in all exports and rejects dual/second chip',()=>{
 const b=vgm([...w(4,0x81,127),...w(1,8,127),...w(3,0,16),...wait(22050)],true);
 assert.equal(extractMsxNotes(b).channels[4].name,'SCC+ CH5');
 assert.equal(listSourceScoreChannels(b).channels[4].id,'scc-ch5');
 for(const format of ['midi','musicxml','lilypond'])assert.equal(exportSource(b,{format,bpm:120}).noteCount,1);
 const dual=b.slice();new DataView(dual.buffer).setUint32(0x9c,clock|0xc0000000,true);
 assert.throws(()=>extractMsxNotes(dual),/dual/);
 const second=b.slice();second[257]|=128;assert.throws(()=>extractMsxNotes(second),/Second K051649/);
 const foreign=b.slice();new DataView(foreign.buffer).setUint32(0x80,4194304,true);assert.throws(()=>extractMsxNotes(foreign),/gameBoyDmgClock/);
});
test('every MSX chip subset preserves solo pitches, names and times; four-chip export uses MIDI ports',async()=>{
 const parts=['ay','opll','audio','scc'],solo=parts.map(p=>extractMsxNotes(fixture([p])).channels);
 for(let mask=1;mask<16;mask++){
  const selected=parts.filter((_,i)=>mask&(1<<i)),b=fixture(selected),a=extractMsxNotes(b);
  assert.deepEqual(a.channels,solo.filter((_,i)=>mask&(1<<i)).flat(),selected.join('+'));
  assert.deepEqual(analyzeLilyPondSource(b).channels.map(({name,notes})=>({name,notes})),a.channels,selected.join('+'));
  for(const format of ['midi','musicxml','lilypond'])assert.equal(exportSource(b,{format,bpm:120}).noteCount,selected.length,format);
 }
 const b=fixture(parts),support=await inspectSourceSupport(b);
 for(const f of ['midi','musicxml','lilypond'])assert.equal(support.exports[f].status,'available');
 const midi=exportSource(b,{format:'midi',bpm:120});
 assert(midi.warnings.some(w=>/multi-port/.test(w)));
 assert(Buffer.from(midi.bytes).includes(Buffer.from([255,0x21,1,1])));
 for(const format of ['musicxml','lilypond']){
  const score=exportSource(b,{format,bpm:120,channels:['scc-ch1']});
  assert.equal(score.noteCount,1);assert.match(score.text,/SCC CH1/);assert.doesNotMatch(score.text,/AY8910 SSG 1/);
 }
});

test('mixed AY shape writes retrigger envelope tones without retriggering fixed-volume transitions',()=>{
 const b=vgm([0xa0,0,127,0xa0,7,0x3e,0xa0,8,16,...wait(100),
  0xa0,13,9,...wait(100),0xa0,8,15,...wait(100),0xa0,13,9,...wait(100),0xa0,8,0]);
 new DataView(b.buffer).setUint32(0x74,clock,true);
 const a=extractMsxNotes(b);
 assert.deepEqual(a.channels[0].notes.map(n=>[n.start,n.end,n.key]),[[0,100,1],[100,400,2]]);
});
