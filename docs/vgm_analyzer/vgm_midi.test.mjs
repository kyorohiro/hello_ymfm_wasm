import test from 'node:test';
import assert from 'node:assert/strict';
import { exportAnalysisMidi } from './vgm_midi.js';
function vgm(commands, clock=7670454) {
  const b=new Uint8Array(256+commands.length);b.set([86,103,109,32]);
  const v=new DataView(b.buffer);v.setUint32(8,0x171,true);v.setUint32(0x2c,clock,true);v.setUint32(0x34,0xcc,true);
  b.set(commands,256);return b;
}
const on=[0x52,0xa4,0x22,0x52,0xa0,0x1d,0x52,0x28,0xf0];
const wait=n=>[0x61,n&255,n>>>8];
// Parse emitted SMF bytes independently of the writer helpers.
function decode(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const ascii=(p,n)=>String.fromCharCode(...bytes.slice(p,p+n));
  assert.equal(ascii(0,4),'MThd');assert.equal(view.getUint32(4),6);assert.equal(view.getUint16(8),1);
  const count=view.getUint16(10),ppqn=view.getUint16(12);let pos=14;
  const tracks=[];
  function variable() { let value=0;for(let i=0;i<4;i++){const b=bytes[pos++];value=value*128+(b&127);if(!(b&128))return value;}assert.fail('invalid VLQ'); }
  for(let i=0;i<count;i++) {
    assert.equal(ascii(pos,4),'MTrk');const end=pos+8+view.getUint32(pos+4);pos+=8;
    const events=[];let tick=0;
    while(pos<end) {
      tick+=variable();const status=bytes[pos++];
      if(status===255) { const type=bytes[pos++],length=variable(),data=bytes.slice(pos,pos+length);pos+=length;events.push({tick,status,type,data}); }
      else {assert.ok([0x80,0x90,0xc0].includes(status&0xf0));const data=bytes.slice(pos,pos+((status&0xf0)===0xc0?1:2));pos+=data.length;assert.ok([...data].every(n=>n<128));events.push({tick,status,data});}
    }
    assert.equal(pos,end);assert.equal(events.at(-1).type,47);assert.equal(events.at(-1).data.length,0);tracks.push(events);
  }
  assert.equal(pos,bytes.length);return {ppqn,tracks};
}
const notes=track=>track.filter(e=>(e.status&0xf0)===0x90||(e.status&0xf0)===0x80);
test('SMF format 1, conductor tempo, six channel tracks, note-off before retrigger, trailing silence',()=>{
  const source=vgm([...on,...wait(22050),0x52,0x28,0xf0,...wait(22050),0x52,0x28,0,...wait(22050),0x66]);
  const result=exportAnalysisMidi(source,{fileName:'曲.vgm'});const d=decode(result.bytes);
  assert.equal(d.ppqn,960);assert.equal(d.tracks.length,7);assert.equal(result.noteCount,2);
  assert.deepEqual([...d.tracks[0].find(e=>e.type===0x51).data],[7,161,32]);
  assert.deepEqual(notes(d.tracks[1]).map(e=>[e.tick,e.status,...e.data]),[[0,144,57,100],[960,128,57,0],[960,144,57,100],[1920,128,57,0]]);
  for(const t of d.tracks)assert.equal(t.at(-1).tick,2880);
  assert.equal(new TextDecoder().decode(d.tracks[0][0].data),'曲.vgm');
});
test('manual tempo changes beat positions while real time and off-grid timing are preserved',()=>{
  for(const bpm of [60,120,137.3]) {
    const result=exportAnalysisMidi(vgm([...wait(1000),...on,...wait(12345),0x52,0x28,0,0x66]),{bpm});
    const d=decode(result.bytes),n=notes(d.tracks[1]);
    for(const [i,samples] of [[0,1000],[1,13345]]) assert.ok(Math.abs(n[i].tick*result.tempo/(960*1e6)-samples/44100)<=result.tempo/(960*1e6)/2);
    assert.notEqual(n[0].tick%120,0);
  }
});
test('same-semitone held writes merge, pitch change splits, and other channels remain independent',()=>{
  const source=vgm([...on,...wait(1000),0x52,0xa0,0x1d,...wait(1000),0x52,0xa4,0x2a,0x52,0xa0,0x1d,
    0x53,0xa4,0x22,0x53,0xa0,0x1d,0x52,0x28,0xf4,...wait(1000),0x66]);
  const result=exportAnalysisMidi(source);const d=decode(result.bytes);
  assert.equal(result.noteCount,3);assert.deepEqual(notes(d.tracks[1]).filter(e=>e.status===144).map(e=>e.data[0]),[57,69]);
  assert.equal(notes(d.tracks[4])[0].status,0x93);
});
test('unknown notes omitted, loop not expanded, and warnings retained in MIDI',()=>{
  const source=vgm([...on,...wait(22050),0x52,0x28,0x10,...wait(22050),0x52,0x28,0,0x50,0x90,0x66]);
  new DataView(source.buffer).setUint32(0x1c,256-0x1c,true);
  const r=exportAnalysisMidi(source);assert.equal(r.noteCount,1);assert.equal(r.skippedNotes,1);
  const text=decode(r.bytes).tracks[0].filter(e=>e.type===1).map(e=>new TextDecoder().decode(e.data)).join('\n');
  assert.match(text,/loop is not expanded/);assert.match(text,/PSG writes omitted/);
});
test('reject unsupported sources, empty extraction and invalid tempo',()=>{
  assert.throws(()=>exportAnalysisMidi(vgm([0x66],0)),/YM2612/);
  assert.throws(()=>exportAnalysisMidi(vgm([0x66])),/No convertible/);
  for(const bpm of [0,1,-1,NaN,Infinity,1e9])assert.throws(()=>exportAnalysisMidi(vgm([...on,...wait(1000),0x66]),{bpm}));
});
