import {extractYmf278bFmNotes} from './ymf262_notes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {analyzeLilyPondSource} from './vgm_lilypond.js';
import {groupScoreChannels} from './score_groups.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {packTimeline,timelineWindow} from './note_timeline.js';

function gameboyVgm() {
 const registers=[[0x16,128],[2,0xf0],[3,0xd6],[4,0x86],
  [7,0xf0],[8,0xd6],[9,0x86],[0xa,128],[0xc,32],[0xd,0x6b],[0xe,0x87]];
 const commands=[...registers.flatMap(([r,v])=>[0xb3,r,v]),0x61,0x22,0x56,0xb3,0x16,0,0x61,0x22,0x56,0x66];
 const bytes=new Uint8Array(256+commands.length),header=new DataView(bytes.buffer);
 bytes.set([86,103,109,32]);header.setUint32(8,0x171,true);header.setUint32(0x34,0xcc,true);
 header.setUint32(0x80,4194304,true);header.setUint32(0x18,44100,true);bytes.set(commands,256);
 return bytes;
}
const analyzer=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('./note_timeline_worker.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
for(const kind of ['msx','gameboy','nes','y8950','ymf278b'])test(`${kind} file load feeds Song timeline and worker returns visible notes`,()=>{
 const bytes=kind==='gameboy'?gameboyVgm():readFileSync(new URL(`../../test/fixtures/${kind==='msx'?'msx-ay-opll-audio-scc':kind==='ymf278b'?'ymf278b-fm':kind==='y8950'?'y8950-fm':'nes-tone'}.vgm`,import.meta.url));
 const messages=[];
 const context=vm.createContext({extractYmf278bFmNotes,analyzeLilyPondSource,groupScoreChannels,Ym2612VGM,packTimeline,timelineWindow,
  self:{postMessage:message=>messages.push(message)}});
 vm.runInContext(worker,context);
 const start=analyzer.indexOf('  currentBuffer = buffer;');
 const end=analyzer.indexOf('  playbackSeek.max',start);
 assert.ok(start>=0&&end>start);
 let loaded=0;
 vm.runInNewContext(analyzer.slice(start,end),{currentBuffer:null,currentChipKind:kind,buffer:bytes,
  songTimeline:{load(buffer){loaded++;context.self.onmessage({data:{type:'load',buffer}});}}});
 assert.equal(loaded,1,'loading the file must supply Song timeline data');
 const ready=messages.shift();assert.equal(ready.type,'ready',ready.message);
 assert.ok(ready.duration>0);assert.ok(ready.names.length>0);
 if(kind==='gameboy')assert.deepEqual(Array.from(ready.names),['GB CH1','GB CH2','GB CH3']);
 context.self.onmessage({data:{type:'view',id:7,start:0,end:ready.duration,limit:100}});
 const view=messages.shift();assert.equal(view.type,'view');assert.equal(view.id,7);
 for(const channel of view.channels){
  assert.ok(channel.rows.length>0);
  for(const [start,end,pitch] of channel.rows){assert.ok(end>start);assert.ok(Number.isFinite(pitch));}
 }
 if(kind==='gameboy')for(const channel of view.channels){
  assert.equal(channel.rows.length,1);assert.equal(channel.rows[0][0],0);assert.equal(channel.rows[0][1],22050);
  assert.ok(Math.abs(channel.rows[0][2]-69)<0.1);
 }
});

test('all Note-ish chip modes pass loaded files to Song timeline',async()=>{
 const {chipSupportContext}=await import('./test_helpers/chip_support_context.mjs');
 const supportStart=analyzer.indexOf('function updateChipSupport()');
 const supportEnd=analyzer.indexOf('\nfunction buildParseInfo',supportStart);
 const loadStart=analyzer.indexOf('  currentBuffer = buffer;');
 const loadEnd=analyzer.indexOf('  playbackSeek.max',loadStart);
 assert.ok(supportStart>=0&&supportEnd>supportStart&&loadStart>=0&&loadEnd>loadStart);
 // PSG-only playback also uses the ym2612 UI mode; YM2610B uses ym2610.
 const supported=['msx','y8950','huc6280','ym2612','ym2203','ym2608','ym2610','ym2151','ym2413','ay8910','ym3526','ym3812','ymf278b','ymf262','nes','gameboy'];
 const unsupported=['okim6258','segapcm'];
 for(const kind of [...supported,...unsupported]){
  const buffer=new Uint8Array(1),loads=[];
  const context={...chipSupportContext(),currentChipKind:kind,buffer,setOutputTab(){},songTimeline:{load:value=>loads.push(value)}};
  vm.createContext(context);
  vm.runInContext(analyzer.slice(supportStart,supportEnd)+'\nupdateChipSupport();',context);
  assert.equal(context.noteishTab.disabled,!supported.includes(kind),kind);
  vm.runInContext(analyzer.slice(loadStart,loadEnd),context);
  assert.equal(loads.length,supported.includes(kind)?1:0,`${kind}: timeline loading must match Note-ish support`);
  if(loads.length)assert.equal(loads[0],buffer);
 }
});
