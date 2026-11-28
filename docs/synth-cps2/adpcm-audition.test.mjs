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
  send(player,{type:'voice-setting',channel:0,field:'rate',value:0});
  assert.equal(player.chip.voices[0].rate,0);
  for(const [midi,expected] of [[60,4096],[72,8192],[48,2048]]){
    send(player,{type:'captured-note',channel:0,midi});
    assert.equal(player.chip.voices[0].rate,expected);
    assert.ok(render(player,2048).some(side=>side.some(x=>x!==0)));
  }
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

test('saved Voice 2 ADPCM one-shot retriggers on Voice 3 with the same decoded stereo output',async()=>{
  const player=new Processor(),send=data=>player.port.onmessage({data});
  const bytes=demoVgm(demoTracks.adpcm.score());
  send({type:'song',bytes,path:'/songs/trio.vgm'});
  player.process([],[[new Float32Array(20000),new Float32Array(20000)]]);
  send({type:'pause-song',paused:true});
  let snapshot;
  send({type:'read-preset',kind:'adpcm',channel:1,reply:{postMessage:data=>{snapshot=data;},close(){}}});
  const {bytes:bank,...fields}=snapshot;
  const preset=readPreset(JSON.stringify({format:'qsound-adpcm-1',bankHash:await bankHash(bank),...fields}));
  function hit(voice){
    send([[0xd6+voice,1]]);
    // Each decoder is serviced in its own DSP slot. Align the first high nibble.
    for(let i=0;i<voice;i++)player.chip.tick();
    return Array.from({length:3500},()=>{
      player.chip.tick();
      return [player.chip.left,player.chip.right];
    });
  }
  const original=hit(1);
  assert.ok(original.some(pair=>pair[0]!==0 && pair[1]!==0));
  send('stop');
  send({type:'load-preset',channel:2,preset,rom:await presetRom(preset,bytes)});
  assert.deepEqual(hit(2),original);
});

test('scheduled PCM and ADPCM writes share output frames across block boundaries and cancel together',async()=>{
  const {qsoundPlanTools}=await import('./timed-plan.js');
  const {attachRegisterTimedClient}=await import('../js/register_timed_client.js');
  for(const hz of [44100,48000]){
    globalThis.sampleRate=hz;
    try{
      const p=new Processor(), reference=new Processor();
      const send=(processor,writes)=>processor.port.onmessage({data:writes});
      for(const chip of [p,reference])send(chip,[[0xce,512],[0xcf,1024],[0xd0,0],[0xd1,32767]]);
      const api=attachRegisterTimedClient({},payload=>p.timeline.request(payload),qsoundPlanTools());
      const plan=api.build(b=>{
        b.atSample(5).noteOn(1,60,0).trigger(2);
        b.atSample(48).noteOff(1);
      },{referenceSampleRate:hz});
      const trace=await api.compile(plan);
      assert.equal(p.chip.lastWrites[0xd7],-1);
      const cycle=137;
      await api.schedule(plan,{name:'bar',repeatSeconds:cycle/hz});
      const render=(chip,n)=>{
        const left=new Float32Array(n),right=left.slice();chip.process([],[[left,right]]);return left;
      };
      const actual=[...render(p,132),...render(p,181),...render(p,90)];
      const expected=[];
      for(let frame=0;frame<actual.length;frame++){
        if(frame>=128)for(const w of trace){
          if(Math.round(w.offsetSeconds*hz)===(frame-128)%cycle)send(reference,w.fadeMs?{type:'note-off',channel:w.register>>3}:[[w.register,w.value]]);
        }
        expected.push(render(reference,1)[0]);
      }
      assert.ok(actual.some(x=>x!==0));
      assert.deepEqual(actual,expected);
      send(p,[[6,1234]]); // A newer manual gate survives cancellation.
      await api.clearSchedule('bar');
      render(p,cycle*2);
      assert.equal(p.chip.voices[0].volume,1234);
      assert.equal(p.chip.adpcm[1].gain,0);
      await api.schedule(plan,{name:'pending',repeatSeconds:cycle/hz});
      send(p,{type:'clear-timeline'});render(p,cycle*3);
      assert.equal(p.chip.voices[0].volume,1234);
    }finally{globalThis.sampleRate=48000;}
  }
});

test('Code FX processes both QSound outputs, preserves state on Apply and restores the dry route on Stop',()=>{
  const p=new Processor(),dry=new Processor();
  const send=data=>p.port.onmessage({data});
  const render=processor=>{
    const stereo=[new Float32Array(128),new Float32Array(128)];
    processor.process([],[stereo]);return stereo;
  };
  for(const processor of [p,dry])processor.port.onmessage({data:[[0x78,0x8000],[1,0],[2,4096],[4,256],[5,256],[6,8192]]});
  const register={op:'live-fx',action:'register',name:'test',context:{step:0.125},source:
    'process(input,output,state,params){state.gain=(state.gain??0)+params.step;for(let c=0;c<2;c++)for(let i=0;i<input[c].length;i++)output[c][i]=input[c][i]*state.gain;}'};
  function checkGain(gain){
    const output=render(p),reference=render(dry);
    assert.ok(reference.every(channel=>channel.some(v=>v!==0)));
    for(let c=0;c<2;c++)assert.deepEqual(output[c],reference[c].map(v=>v*gain));
  }
  send({codeFx:register});checkGain(0.125);
  send({codeFx:{...register,context:{step:0.375}}});checkGain(0.5);
  send({codeFx:{op:'live-fx',action:'context',name:'test',context:{step:0}}});checkGain(0.5);
  send({type:'clear-code-fx'});checkGain(1);
});

test('same-ROM preset updates just its destination and preserves another held PCM voice',()=>{
  const p=new Processor(),send=data=>p.port.onmessage({data});
  send({type:'prepare-audition',writes:[[1,0],[2,4096],[4,256],[5,256],[6,8000]]});
  send({type:'captured-note',channel:0,midi:60});
  const original=p.chip,voice=original.voices[0];
  p.process([],[[new Float32Array(137),new Float32Array(137)]]);
  const position=voice.address;
  const preset={format:'qsound-pcm-1',start:256,end:480,loop:32,bank:0,rate:2500,pan:0x120,volume:7234,send:910};
  send({type:'load-preset',preset,channel:2});
  assert.equal(p.chip,original);
  assert.equal(voice.address,position);
  assert.equal(voice.volume,8000);
  send({type:'captured-note',channel:2,midi:60});
  assert.deepEqual([p.starts[2],p.chip.voices[2].rate,p.chip.voices[2].loop,p.chip.voices[2].volume],[256,2500,32,7234]);
});

test('PCM note-off ramps one voice for 4 ms and respects retriggers, key-off and the option',()=>{
  const p=new Processor(),send=data=>p.port.onmessage({data});
  const [v,other]=p.chip.voices;
  send([[6,8000],[14,9000]]);
  send({type:'note-off',channel:0});
  const ticks=Math.round(p.chip.tickRate*.004);
  for(let n=1;n<=ticks;n++){
    p.chip.tick();
    assert.equal(v.volume,Math.trunc(8000*(ticks-n)/ticks));
    assert.equal(other.volume,9000);
  }
  send([[6,8000]]);
  send({type:'note-off',channel:0});
  p.chip.tick();
  send([[6,5000]]);
  p.chip.tick();
  assert.equal(v.volume,5000);
  send({type:'key-off',channel:0});
  assert.equal(v.volume,0);
  send({type:'auto-fade',enabled:false});
  send([[6,8000]]);
  send({type:'note-off',channel:0});
  assert.equal(v.volume,0);
});
