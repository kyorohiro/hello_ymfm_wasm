// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {demoVgm,demoTracks} from './demo.js';
import {QSoundPcm} from '../js/qsoundpcm.js';

import {readPreset,bankHash,presetRom} from './preset.js';

let Processor;
globalThis.sampleRate=48000;
globalThis.AudioWorkletProcessor=class {port={};};
globalThis.registerProcessor=(_,type)=>{Processor=type;};
await import('./processor.js');

test('Stop retains the imported ROM and retriggers only the selected ADPCM voice',()=>{
  const processor=new Processor();
  const send=data=>processor.port.onmessage({data});
  send({type:'song',bytes:demoVgm(demoTracks.adpcm.score())});
  processor.song.applyDueEvents();
  const rom=processor.chip.rom;
  rom.fill(0x77,40,60);
  const settings=[[0xce,40],[0xcf,60],[0xd0,0],[0xd1,0x7600],[0x91,0x130]];
  send(settings);
  send('stop-audition');
  assert.equal(processor.chip.rom,rom);
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

test('Pause auditions a detached PCM voice, Resume matches continuous playback, Stop keeps edits',()=>{
  const player=new Processor(), reference=new Processor();
  const send=(p,data)=>p.port.onmessage({data});
  const render=(p,n)=>{
    const left=new Float32Array(n),right=left.slice();
    p.process([],[[left,right]]);
    return [left,right];
  };
  const bytes=demoVgm(demoTracks.demo.score());
  for(const p of [player,reference]){
    send(p,{type:'song',bytes});
    render(p,1400);
  }
  send(player,{type:'pause-song',paused:true});
  const song=player.song,rom=song.chip.rom;
  assert.equal(player.chip.rom,rom);
  assert.ok(render(player,4096).every(side=>side.every(x=>x===0)));
  send(player,[[0x80,0x12a]]);
  const rate=player.rates[0];
  send(player,{type:'captured-note',channel:0,midi:72});
  assert.equal(player.chip.voices[0].rate,rate*2);
  assert.ok(render(player,2048).some(side=>side.some(x=>x!==0)));
  assert.equal(song.frames,1400);
  send(player,{type:'pause-song',paused:false});
  assert.deepEqual(render(player,2048),render(reference,2048));
  send(player,{type:'pause-song',paused:true});
  send(player,{type:'voice-setting',channel:0,field:'rate',value:2400});
  send(player,[[0x80,0x12a]]);
  send(player,'stop-audition');
  assert.equal(player.song,null);
  assert.equal(player.chip.rom,rom);
  assert.equal(player.chip.voices[0].pan,0x12a);
  assert.ok(render(player,128).every(side=>side.every(x=>x===0)));
  send(player,{type:'captured-note',channel:0,midi:60});
  assert.equal(player.chip.voices[0].rate,2400);
  assert.ok(render(player,2048).some(side=>side.some(x=>x!==0)));
});

test('PCM preset resolves its VGM bank and plays identical stereo samples on another channel',async()=>{
  const bytes=demoVgm(demoTracks.demo.score()),path='/songs/bass.vgm';
  // Change the embedded sample bytes so a fallback to the factory ROM cannot pass.
  bytes.fill(78,271,271+128);
  const player=new Processor(),send=data=>player.port.onmessage({data});
  send({type:'song',path,bytes});
  player.song.applyDueEvents();
  send({type:'pause-song',paused:true});
  send([[0x80,0x117]]);
  let snapshot;
  send({type:'read-preset',channel:0,reply:{postMessage:data=>{snapshot=data;},close(){}}});
  const {bytes:bank,...settings}=snapshot;
  const p=readPreset(JSON.stringify({...settings,format:'qsound-pcm-1',bankHash:await bankHash(bank)}));
  const strike=channel=>{
    send({type:'captured-note',channel,midi:60});
    const left=new Float32Array(2048),right=left.slice();
    player.process([],[[left,right]]);
    return [left,right];
  };
  const original=strike(0);
  assert.ok(original[0].some(x=>x!==0));
  send('stop');
  await assert.rejects(presetRom(p,demoVgm()),/differs/);
  send({type:'load-preset',channel:4,preset:p,rom:await presetRom(p,bytes)});
  assert.equal(player.chip.voices[4].pan,0x117);
  assert.deepEqual(strike(4),original);
});
