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
      else {assert.ok([0x80,0x90,0xb0,0xc0,0xe0].includes(status&0xf0));const data=bytes.slice(pos,pos+((status&0xf0)===0xc0?1:2));pos+=data.length;assert.ok([...data].every(n=>n<128));events.push({tick,status,data});}
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
test('held pitches use bend without retriggering and other channels remain independent',()=>{
  const source=vgm([...on,...wait(1000),0x52,0xa0,0x1d,...wait(1000),0x52,0xa4,0x2a,0x52,0xa0,0x1d,
    0x53,0xa4,0x22,0x53,0xa0,0x1d,0x52,0x28,0xf4,...wait(1000),0x66]);
  const result=exportAnalysisMidi(source);const d=decode(result.bytes);
  assert.equal(result.noteCount,2);assert.deepEqual(notes(d.tracks[1]).filter(e=>e.status===144).map(e=>e.data[0]),[57]);
  assert.ok(d.tracks[1].some(e=>e.status===0xe0 && e.tick>0 && e.tick<130));
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

function opnVgm(kind, registers, clock) {
  const b=vgm(registers,0),v=new DataView(b.buffer);
  v.setUint32(kind==='ym2203'?0x44:0x48,clock,true);return b;
}
const opnOn=(command,key=0)=>[command,0xa4,0x22,command,0xa0,0x1d,0x55===command?0x55:0x56,0x28,0xf0|key];
test('YM2203 exports three FM tracks at clock/72; non-FM writes never become notes',()=>{
  const source=opnVgm('ym2203',[0x55,0,255,0x55,8,15,...opnOn(0x55,4),0x55,0x2b,128,...wait(22050),0x55,0x28,4,0x66],3835227);
  const result=exportAnalysisMidi(source),d=decode(result.bytes);
  assert.equal(result.chipName,'YM2203');assert.equal(d.tracks.length,4);
  // YM2203 ignores KEY bit 2; half the YM2612 clock gives the same FM pitch.
  assert.deepEqual(notes(d.tracks[1]).map(e=>[e.tick,e.data[0]]),[[0,57],[960,57]]);
  assert.ok(result.warnings.some(w=>w.includes('SSG writes omitted')));
});
test('YM2608 exports both FM ports; rhythm and ADPCM-B/DAC-like addresses are excluded',()=>{
  const source=opnVgm('ym2608',[0x56,0x29,0x80,0x56,0x10,255,0x57,0,128,0x57,0x10,255,
    ...opnOn(0x56),...opnOn(0x57,4),0x56,0x2b,128,...wait(22050),0x56,0x28,0,0x56,0x28,4,0x66],7670454);
  const result=exportAnalysisMidi(source),d=decode(result.bytes);
  assert.equal(result.chipName,'YM2608');assert.equal(d.tracks.length,7);assert.equal(result.noteCount,2);
  assert.equal(notes(d.tracks[1])[0].data[0],57);assert.equal(notes(d.tracks[4])[0].data[0],57);
  assert.equal(new TextDecoder().decode(d.tracks[4][0].data),'YM2608 CH4');
  assert.ok(result.warnings.some(w=>w.includes('ADPCM writes omitted')));
});
test('OPN prescaler changes bend held notes; 2E is conditional',()=>{
  for(const kind of ['ym2203','ym2608']) {
    const c=kind==='ym2203'?0x55:0x56,clock=kind==='ym2203'?3835227:7670454;
    const source=opnVgm(kind,[...opnOn(c),...wait(22050),c,0x2e,0,...wait(22050),c,0x2e,0,...wait(22050),c,0x2d,0,...wait(22050),c,0x28,0,0x66],clock);
    const result=exportAnalysisMidi(source), d=decode(result.bytes);
    const pb=d.tracks[1].filter(e=>e.status===0xe0 && e.tick>0 && e.tick<3840);
    assert.deepEqual(pb.map(e=>e.tick),[960,2880]);
    assert.ok(pb[0].data[1]>pb[1].data[1]);
    assert.ok(result.bendRanges[0]>=12);
    assert.deepEqual(notes(d.tracks[1]).filter(e=>(e.status&0xf0)===0x90).map(e=>[e.tick,e.data[0]]),[[0,57]]);
  }
});
test('YM2608 CH4–6 only produce notes while six-channel mode is enabled',()=>{
  const source=opnVgm('ym2608',[...opnOn(0x57,4),...wait(22050),0x56,0x29,0x80,...wait(22050),0x56,0x29,0,...wait(22050),0x66],7670454);
  const result=exportAnalysisMidi(source),d=decode(result.bytes);
  assert.equal(result.noteCount,1);assert.deepEqual(notes(d.tracks[4]).map(e=>e.tick),[960,1920]);
});
test('mixed OPN headers select one chip and do not mix other register streams',()=>{
  const source=opnVgm('ym2608',[...opnOn(0x56),...wait(22050),0x56,0x28,0,0x55,0x28,0xf0,0x66],7670454);
  new DataView(source.buffer).setUint32(0x44,3835227,true);
  const result=exportAnalysisMidi(source);assert.equal(result.chipKind,'ym2608');assert.equal(result.noteCount,1);
  assert.ok(result.warnings.some(w=>w.includes('YM2203 FM omitted')));
});

test('vibrato retains one KEY note with accurate signed 14-bit bends and RPN sensitivity',()=>{
  const commands=[...on];
  for(const fnum of [558,524,541]) commands.push(...wait(22050),0x52,0xa4,0x22,0x52,0xa0,fnum&255);
  commands.push(...wait(22050),0x52,0x28,0,0x66);
  const result=exportAnalysisMidi(vgm(commands)),d=decode(result.bytes),t=d.tracks[1];
  assert.equal(result.noteCount,1);assert.equal(result.bendRanges[0],2);
  assert.deepEqual(notes(t).map(e=>e.tick),[0,3840]);
  assert.deepEqual(t.filter(e=>e.status===0xb0).map(e=>[...e.data]),[[101,0],[100,0],[6,2],[38,0],[101,127],[100,127]]);
  const sounding=t.filter(e=>e.status===0xe0 && e.tick<3840).slice(1); // omit setup center
  assert.deepEqual(sounding.map(e=>e.tick),[0,960,1920,2880]);
  [541,558,524,541].forEach((fnum,i)=>{
    const target=69+12*Math.log2((fnum*7670454*8/(144*2**20))/440);
    const value=sounding[i].data[0]+128*sounding[i].data[1];
    const actual=57+(value-8192)*result.bendRanges[0]/8192;
    assert.ok(Math.abs(actual-target)<=result.bendRanges[0]/16384+1e-9);
  });
  assert.ok(t.findIndex(e=>e.status===0x90)>t.indexOf(sounding[0]));
  assert.deepEqual([...t.filter(e=>e.status===0xe0).at(-1).data],[0,64]);
});
test('retrigger sets the new note bend before Note On and independent MIDI channels do not share bends',()=>{
  const result=exportAnalysisMidi(vgm([...on,...wait(22050),0x52,0xa4,0x2a,0x52,0xa0,0x1d,...wait(22050),
    0x52,0x28,0xf0,0x53,0xa4,0x22,0x53,0xa0,0x1d,0x52,0x28,0xf4,...wait(22050),0x66]));
  const d=decode(result.bytes),boundary=d.tracks[1].filter(e=>e.tick===1920);
  assert.deepEqual(boundary.map(e=>e.status),[0x80,0xe0,0x90]);
  assert.equal(boundary[2].data[0],69);
  assert.equal(result.bendRanges[3],2);
  assert.ok(d.tracks[4].filter(e=>(e.status&0xf0)===0xe0).every(e=>e.status===0xe3));
});
test('multiple pitch changes in one tick use the final value without extra notes',()=>{
  const result=exportAnalysisMidi(vgm([...on,0x70,0x52,0xa0,0x21,0x70,0x52,0xa0,0x25,...wait(22050),0x66]));
  const t=decode(result.bytes).tracks[1];
  assert.equal(result.noteCount,1);
  assert.equal(t.filter(e=>e.status===0xe0&&e.tick===0).length,2); // setup center + final pitch at tick zero
  assert.deepEqual(notes(t).map(e=>e.status),[0x90,0x80]);
});
