import test from 'node:test';
import assert from 'node:assert/strict';
import {extractOpl3Notes} from './ymf262_notes.js';
import {analyzeLilyPondSource} from './vgm_lilypond.js';
import {exportSource,listSourceScoreChannels,inspectSourceSupport} from './analyzer_core.js';
const w=(r,v,p=0)=>[0x5e+p,r,v], wait=[0x61,0x22,0x56]; // 22050 samples
function vgm(commands,clock=14318180){const b=new Uint8Array(256+commands.length+1);b.set([86,103,109,32]);const v=new DataView(b.buffer);v.setUint32(8,0x171,true);v.setUint32(0x34,0xcc,true);v.setUint32(0x5c,clock,true);b.set([...commands,0x66],256);return b;}
const on=(ch,f=580,p=0)=>[...w(0xa0+ch,f&255,p),...w(0xb0+ch,0x30|(f>>8),p)];
test('OPL3 two banks retain 18 channels and base pitch, held pitch changes and retriggers',()=>{
 const b=vgm([...w(5,1,1),...on(0),...on(8,580,1),...wait,...w(0xa0,581&255),...wait,...w(0xb0,0x12),...w(0xb0,0x32),...wait]);
 const a=extractOpl3Notes(b),n=a.channels[0].notes;
 assert.equal(a.channels.length,18);assert.equal(a.channels[17].notes.length,1);
 assert.equal(n.length,3);assert.equal(n[0].key,n[1].key);assert.notEqual(n[1].key,n[2].key);
 assert.ok(Math.abs(n[0].midi-69)<0.03);assert.equal(a.time,66150);
});
test('all six 4op pairs suppress partner notes and use leader frequency/key',()=>{
 for(let bank=0;bank<2;bank++)for(let pair=0;pair<3;pair++){
  const b=vgm([...w(5,1,1),...w(4,1<<(bank*3+pair),1),...on(pair,580,bank),...on(pair+3,700,bank),...wait,...w(0xb0+pair+3,0,bank),...wait,...w(0xb0+pair,0,bank),...wait]);
  const a=extractOpl3Notes(b);assert.equal(a.channels[bank*9+pair].notes.length,1);
  assert.equal(a.channels[bank*9+pair].notes[0].end,44100);
  assert.equal(a.channels[bank*9+pair+3].notes.length,0);
 }
});
test('mode changes split topology; rhythm removes CH7-9 and zero pitch stays unknown',()=>{
 const a=extractOpl3Notes(vgm([...w(5,1,1),...on(0),...on(3),...on(6),...on(7),...on(8),...wait,...w(4,1,1),...w(0xbd,0x3f),...wait,...w(4,0,1),...w(0xbd,0),...wait]));
 assert.equal(a.channels[3].notes.length,2);assert.equal(a.channels[6].notes.length,2);
 assert.equal(a.channels[0].notes.length,3);assert.match([...a.warnings.keys()].join(' '),/percussion/);
 assert.equal(extractOpl3Notes(vgm([...on(0,0),...wait])).channels[0].notes[0].midi,null);
 assert.throws(()=>extractOpl3Notes(vgm([],14318180|0x40000000)),/Dual/);
});
test('compatibility mode bank writes alias bank zero before NEW',()=>{
 const a=extractOpl3Notes(vgm([...on(0,580,1),...wait]));assert.equal(a.channels[0].notes.length,1);assert.equal(a.channels[9].notes.length,0);
});
test('shared score pipeline exports MusicXML/LilyPond and stable CLI channel selection',async()=>{
 const b=vgm([...w(5,1,1),...on(0),...wait]);
 assert.equal(analyzeLilyPondSource(b).channels[0].name,'YMF262 CH1');
 assert.equal(listSourceScoreChannels(b).channels[0].id,'ymf262-ch1');
 const xml=exportSource(b,{format:'musicxml',bpm:120,channels:['ymf262-ch1']});
 assert.match(xml.text,/<step>A<\/step>/);assert.match(xml.text,/YMF262 CH1/);
 assert.match(exportSource(b,{format:'lilypond',bpm:120}).text,/YMF262 CH1/);
 const support=await inspectSourceSupport(b);assert.equal(support.exports.musicxml.status,'available');assert.equal(support.exports.lilypond.status,'available');
});
test('live OPL3 monitor follows pair/rhythm changes and reset',async()=>{
 const {createOpl3Monitor,applyOpl3Write,describeOpl3Notes}=await import('./ymf262_notes.js');
 const regs=createOpl3Monitor();const put=(r,v,p=0)=>applyOpl3Write(regs,r,v,p);
 put(5,1,1);put(0xa0,68);put(0xb0,50);put(0xa3,68);put(0xb3,50);
 let notes=describeOpl3Notes(regs,14318180);assert.equal(notes[3].keyOn,true);
 put(4,1,1);notes=describeOpl3Notes(regs,14318180);
 assert.equal(notes[0].keyOn,true);assert.equal(notes[0].paired,true);assert.equal(notes[3].keyOn,false);assert.equal(notes[3].slave,true);
 put(0xbd,32);assert.equal(describeOpl3Notes(regs,14318180)[6].percussion,true);
 assert.ok(describeOpl3Notes(createOpl3Monitor(),14318180).every(n=>!n.keyOn));
});
test('Song timeline worker loads OPL3 pairs without duplicate notes',async()=>{
 const previous=globalThis.self, messages=[];
 globalThis.self={postMessage:m=>messages.push(m)};
 try {
  await import('./note_timeline_worker.js');
  self.onmessage({data:{type:'load',buffer:vgm([...w(5,1,1),...w(4,1,1),...on(0),...on(3),...wait])}});
  assert.equal(messages[0].type,'ready');assert.equal(messages[0].duration,22050);
  assert.deepEqual(messages[0].names,['CH1']);
  self.onmessage({data:{type:'view',id:1,start:0,end:22050,limit:100}});
  assert.equal(messages[1].type,'view');assert.equal(messages[1].channels.length,1);
 }finally{globalThis.self=previous;}
});
