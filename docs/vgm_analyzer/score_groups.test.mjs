import test from 'node:test';
import assert from 'node:assert/strict';
import {groupScoreChannels,groupSelectedScoreChannels,scoreVoices,parseScoreGroups} from './score_groups.js';
import {createMusicXmlScore} from './vgm_musicxml.js';
import {createLilyPondScore} from './vgm_lilypond.js';
import {packTimeline,timelineWindow} from './note_timeline.js';
const channels=[{name:'YMF262 CH1',notes:[{start:0,end:44100,midi:60,key:1}]},{name:'YMF262 CH5',notes:[{start:22050,end:33075,midi:64,key:1},{start:44100,end:66150,midi:67,key:2}]},{name:'PSG 1',notes:[]}];
const groups=[{id:'piano',name:'Piano & Lead',channels:['ymf262-ch1','ymf262-ch5']}];
test('groups preserve overlap, origin and source objects; arbitrary CH sets and ungrouped tracks',()=>{
 const before=structuredClone(channels),result=groupScoreChannels(channels,groups);
 assert.equal(result.length,2);assert.equal(result[0].notes.length,3);
 assert.equal(result[0].notes[1].sourceChannel,'ymf262-ch5');assert.notEqual(result[0].notes[0].key,result[0].notes[1].key);
 assert.deepEqual(channels,before);assert.equal(scoreVoices(result[0],120).length,2);
 assert.equal(groupSelectedScoreChannels(channels,[channels[0]],groups)[0].notes.length,3);
 assert.equal(groupScoreChannels(channels,parseScoreGroups([],true,channels)).length,1);
 assert.throws(()=>groupScoreChannels(channels,[...groups,{id:'other',name:'Other',channels:['ymf262-ch1']}]),/multiply/);
 assert.throws(()=>groupScoreChannels(channels,[{...groups[0],channels:['absent']}]),/Unknown/);
});
test('MusicXML and LilyPond preserve all overlapping notes in one part/staff',()=>{
 const grouped=groupScoreChannels(channels,groups).slice(0,1);
 const xml=createMusicXmlScore(grouped,66150,{bpm:120});
 assert.equal(xml.noteCount,3);assert.equal(xml.skippedNotes,0);
 assert.equal((xml.text.match(/<score-part id=/g)||[]).length,1);
 assert.match(xml.text,/<backup><duration>16/);assert.match(xml.text,/<voice>2/);
 assert.match(xml.text,/ymf262-ch5/);assert.match(xml.text,/Piano &amp; Lead/);
 const ly=createLilyPondScore(grouped,66150,{bpm:120});
 assert.equal(ly.noteCount,3);assert.equal(ly.skippedNotes,0);
 assert.equal((ly.text.match(/new Staff /g)||[]).length,1);assert.match(ly.text,/new Voice/);assert.match(ly.text,/source-channel: ymf262-ch5/);
});
test('nested overlapping intervals remain visible when their start is outside viewport',()=>{
 const data=packTimeline([{start:0,end:100,midi:60,key:1},{start:10,end:20,midi:64,key:2},{start:30,end:40,midi:67,key:3}]);
 assert.equal(timelineWindow(data,50,60).rows.length,1);
});

test('simultaneous same pitches on different CH remain separate, with full voice durations across bars',()=>{
 const raw=['YM2612 CH1','YM2612 CH2'].map(name=>({name,notes:[{start:0,end:132300,midi:60,key:1}]}));
 const grouped=groupScoreChannels(raw,parseScoreGroups([],true,raw));
 assert.equal(grouped[0].notes.length,2);assert.equal(scoreVoices(grouped[0],120).length,2);
 const xml=createMusicXmlScore(grouped,132300,{bpm:120});assert.equal(xml.noteCount,2);assert.equal(xml.skippedNotes,0);
 for(const measure of xml.text.matchAll(/<measure[^>]*>([\s\S]*?)<\/measure>/g)){
  const totals=new Map();
  for(const n of measure[1].matchAll(/<note>([\s\S]*?)<\/note>/g)){
   const voice=n[1].match(/<voice>(\d+)</)[1],duration=Number(n[1].match(/<duration>(\d+)</)[1]);
   totals.set(voice,(totals.get(voice)??0)+duration);
  }
  assert.deepEqual([...totals.values()],[16,16]);
 }
});
