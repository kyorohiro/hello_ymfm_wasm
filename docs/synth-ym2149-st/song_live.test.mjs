import test from 'node:test';
import assert from 'node:assert/strict';
import {ymSongLiveView,captureYmSongVoice} from './song_live.js';
import {createYmCodeProject} from './code_project.js';
import {ymMusicEntries,listYmMusic} from './music_files.js';
function snapshot(){const registers=Array(16).fill(0);registers[0]=100;registers[2]=200;registers[4]=44;registers[5]=1;registers[6]=8;registers[7]=0x38;registers[8]=9;registers[9]=5;registers[10]=16;registers[11]=80;registers[13]=10;
  return {clock:2000000,frame:1024,registers,registerKnown:Array(16).fill(1)};}
test('Live projects the selected channel and shared generators without mutating the edit sound',()=>{
  const s=snapshot(),view=ymSongLiveView(s,1);
  assert.equal(view.frequency,625);assert.equal(view.preset.voices[1].volume,5);assert.equal(view.canCapture,true);
  assert.equal(view.preset.envelope.shape,10);assert.deepEqual(view.activeChannels,[0,1,2]);
  view.preset.voices[1].volume=15;assert.equal(s.registers[9],5);
});
test('capture copies one voice to Auto with clock normalization, preserving shared hardware fields',()=>{
  const s=snapshot();s.clock=1000000;
  const p=captureYmSongVoice(s,1,{name:'Song CH2'});
  assert(p.voices.every(v=>v.period===400&&v.volume===5));assert.equal(p.noisePeriod,16);assert.equal(p.envelope.period,160);assert.equal(p.name,'Song CH2');
  s.clock=2000000;s.flags=16;assert.equal(ymSongLiveView(s,1).frequency,312.5);
  assert.equal(captureYmSongVoice(s,1).voices[0].period,400);
});
test('silent or unknown settings are never advertised as recovered playable instruments',()=>{
  const s=snapshot();s.registers[9]=0;assert.equal(ymSongLiveView(s,1).canAudition,false);
  assert.throws(()=>captureYmSongVoice(s,1),/silent/);
  s.registers[9]=5;s.registerKnown[2]=0;assert.equal(ymSongLiveView(s,1).canCapture,false);
  assert.throws(()=>ymSongLiveView({...s,registers:[]},1));assert.throws(()=>ymSongLiveView(s,3));
  s.registerKnown[2]=1;s.registers[7]|=2|16;
  assert.equal(ymSongLiveView(s,1).canCapture,false);assert.match(ymSongLiveView(s,1).reason,/DAC/);
});
test('music sources stay opaque and are routed collision-safely into VGM and music folders',async()=>{
  const project=createYmCodeProject();const sources=[{name:'demo.vgz',bytes:Uint8Array.of(1,2)},{name:'demo.ym',bytes:Uint8Array.of(3,4)},{name:'demo.sndh',bytes:Uint8Array.of(5,6)}];
  const entries=ymMusicEntries(project,sources);assert.deepEqual(entries.map(e=>e.path),['/vgm/demo.vgz','/music/demo.ym','/music/demo.sndh']);
  project.importFiles(entries);sources[0].bytes[0]=99;assert.equal(project.fs.get('/vgm/demo.vgz').data[0],1);
  assert.equal(ymMusicEntries(project,[sources[0]])[0].path,'/vgm/demo (2).vgz');
  assert.equal(listYmMusic(project).length,3);
  const restored=createYmCodeProject();restored.restore(await restored.prepareImport(await project.exportProject()));
  assert.deepEqual(restored.fs.get('/music/demo.sndh').data,Uint8Array.of(5,6));
  assert.throws(()=>ymMusicEntries(project,[{name:'bad.txt',bytes:Uint8Array.of(1)}]));
});
