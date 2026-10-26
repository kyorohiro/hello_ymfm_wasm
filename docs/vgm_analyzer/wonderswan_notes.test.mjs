import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createWonderSwanMonitor,applyWonderSwanWrite,describeWonderSwanNotes,extractWonderSwanNotes} from './wonderswan_notes.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {packTimeline,timelineWindow} from './note_timeline.js';
import {groupScoreChannels} from './score_groups.js';
import {analyzeLilyPondSource,createLilyPondScore} from './vgm_lilypond.js';
import {createMusicXmlScore} from './vgm_musicxml.js';
import {exportAnalysisMidi} from './vgm_midi.js';
const clock=3072000;
const frequency=Math.round(2048-clock/(32*440));
const w=(r,v)=>[0xbc,r-0x80,v],wait=n=>[0x61,n&255,n>>>8];
const u32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255];
const setup=()=>[...w(0x91,8),...Array.from({length:4},(_,i)=>[...w(0x80+i*2,frequency&255),...w(0x81+i*2,frequency>>>8),...w(0x88+i,255)]).flat(),...w(0x90,15)];
function vgm(commands,{chipClock=clock}={}){
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);view.setUint32(8,0x171,true);view.setUint32(0x34,204,true);
  view.setUint32(0xc0,chipClock,true);bytes.set(commands,256);return bytes;
}

test('four wavetable pitches use the 11-bit period and relative or absolute ports',()=>{
  const state=createWonderSwanMonitor();
  applyWonderSwanWrite(state,0x11,8);
  for(let i=0;i<4;i++){
    applyWonderSwanWrite(state,i*2,frequency&255);
    applyWonderSwanWrite(state,0x81+i*2,0xf8|(frequency>>>8));
    applyWonderSwanWrite(state,8+i,255);
  }
  applyWonderSwanWrite(state,0x10,15);
  const notes=describeWonderSwanNotes(state,clock);
  assert.equal(notes.length,4);
  for(const note of notes){assert.equal(note.type,'Wave');assert.equal(note.keyOn,true);assert(Math.abs(note.midi-69)<.04);assert.equal(note.trigger,1);}
  applyWonderSwanWrite(state,0,0);applyWonderSwanWrite(state,1,0);
  assert.equal(describeWonderSwanNotes(state,clock)[0].midi,69+12*Math.log2(clock/(32*2048)/440));
  applyWonderSwanWrite(state,0,255);applyWonderSwanWrite(state,1,255);
  assert.equal(describeWonderSwanNotes(state,clock)[0].freq,2047);
  assert.equal(applyWonderSwanWrite(state,0x40,255),false);
});

test('mode exclusions, gate and pan silence do not invent PCM or sweep notes',()=>{
  const state=createWonderSwanMonitor();
  for(const i of [0,1,2,3])applyWonderSwanWrite(state,0x88+i,255);
  applyWonderSwanWrite(state,0x90,255);
  assert(describeWonderSwanNotes(state,clock).every(n=>n.midi===null));
  applyWonderSwanWrite(state,0x91,8);
  const notes=describeWonderSwanNotes(state,clock);
  assert.deepEqual(notes.map(n=>n.type),['Wave','Voice PCM','Sweep','Noise']);
  assert.equal(notes[0].keyOn,true);assert(notes.slice(1).every(n=>n.keyOn===false&&n.midi===null));
  applyWonderSwanWrite(state,0x90,15);
  applyWonderSwanWrite(state,0x88,0);assert.equal(describeWonderSwanNotes(state,clock)[0].reason,'Silent');
  applyWonderSwanWrite(state,0x88,0xf0);assert.equal(describeWonderSwanNotes(state,clock)[0].keyOn,true);
  applyWonderSwanWrite(state,0x90,14);assert.equal(describeWonderSwanNotes(state,clock)[0].reason,'Off');
  applyWonderSwanWrite(state,0x90,15);assert.equal(describeWonderSwanNotes(state,clock)[0].trigger,2);
});

const switching=()=>vgm([...setup(),...wait(100),...w(0x90,0xef),...wait(100),...w(0x90,15),...wait(100),...w(0x91,0),...wait(100),...w(0x91,8),...wait(100),...w(0x90,0),0x66]);
test('Song notes close during Voice PCM, sweep, noise and output-off gaps',()=>{
  const result=extractWonderSwanNotes(switching());
  assert.equal(result.time,500);
  assert.deepEqual(result.channels[0].notes.map(n=>[n.start,n.end]),[[0,300],[400,500]]);
  for(const ch of result.channels.slice(1))assert.deepEqual(ch.notes.map(n=>[n.start,n.end]),[[0,100],[200,300],[400,500]]);
  assert([...result.warnings.keys()].some(s=>/Voice|voice/.test(s)&&/sweep/.test(s)&&/noise/.test(s)));
  assert.throws(()=>extractWonderSwanNotes(vgm([0x66],{chipClock:clock|0x40000000})),/single WonderSwan/);
  assert.throws(()=>extractWonderSwanNotes(vgm([0x66],{chipClock:0})),/single WonderSwan/);
});

test('RAM updates never become notes or invalidate an existing wavetable base pitch',()=>{
  const bytes=vgm([...setup(),...wait(10),0xc6,0x12,0x00,0x55,...wait(10),0x66]);
  for(const ch of extractWonderSwanNotes(bytes).channels)assert.deepEqual(ch.notes.map(n=>[n.start,n.end]),[[0,20]]);
});

test('DAC stream register writes update notes without assigning sample bytes a pitch',()=>{
  const bytes=vgm([...setup(),
    0x67,0x66,5,...u32(2),0xef,15,
    0x90,0,0x21,0,0x10,0x91,0,5,1,0,0x92,0,...u32(4410),0x95,0,0,0,0,
    ...wait(20),0x66]);
  const result=extractWonderSwanNotes(bytes);
  assert.deepEqual(result.channels[0].notes.map(n=>[n.start,n.end]),[[0,20]]);
  for(const ch of result.channels.slice(1))assert.deepEqual(ch.notes.map(n=>[n.start,n.end]),[[10,20]]);
});

test('Song worker routes WonderSwan with the same silent mode gaps',()=>{
  const messages=[],context=vm.createContext({extractWonderSwanNotes,Ym2612VGM,packTimeline,timelineWindow,groupScoreChannels,
    self:{postMessage:m=>messages.push(m)}});
  const worker=readFileSync(new URL('./note_timeline_worker.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(worker,context);context.self.onmessage({data:{type:'load',buffer:switching()}});
  assert.equal(messages[0].type,'ready',messages[0].message);assert.equal(messages[0].duration,500);
  assert.deepEqual(Array.from(messages[0].names),['WonderSwan CH1','WonderSwan CH2','WonderSwan CH3','WonderSwan CH4']);
  context.self.onmessage({data:{type:'view',start:0,end:500,limit:100}});
  assert.deepEqual(Array.from(messages[1].channels[1].rows,r=>[r[0],r[1]]),[[0,100],[200,300],[400,500]]);
});

test('MIDI, LilyPond and MusicXML use four base-pitch parts with explicit omissions',()=>{
  const bytes=vgm([...setup(),...wait(22050),...w(0x90,0xef),...wait(22050),...w(0x90,0),0x66]);
  const analysis=analyzeLilyPondSource(bytes);
  assert.equal(analysis.channels.length,4);assert.equal(analysis.time,44100);
  assert(analysis.channels.every(ch=>ch.notes.length===1));
  assert.equal(analysis.channels[0].notes[0].end,44100);
  assert.equal(analysis.channels[1].notes[0].end,22050);
  const ly=createLilyPondScore(analysis.channels,analysis.time,{warnings:analysis.warnings});
  const xml=createMusicXmlScore(analysis.channels,analysis.time,{warnings:analysis.warnings});
  assert.equal(ly.noteCount,4);assert.equal(xml.noteCount,4);
  assert.match(ly.text,/WonderSwan CH4/);assert.match(xml.text,/voice PCM/);
  const midi=exportAnalysisMidi(bytes);assert.equal(midi.noteCount,4);assert.equal(midi.chipKind,'wonderswan');
  assert(midi.warnings.some(w=>/CH3 sweep/.test(w)));
});
