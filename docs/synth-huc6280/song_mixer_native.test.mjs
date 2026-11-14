// SPDX-License-Identifier: BSD-3-Clause
// Native PCM arrays only. No AudioContext/device/browser is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {createHuc6280SongPreview} from './song_preview.js';
import {createHuc6280SongTimeline} from './song_state.js';
import {vgm,write,wait,voice,init,wave,block,streamSetup,streamStart,fakeAudio} from './song_test_helpers.mjs';

const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
const native=()=>Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:44100,masterVolume:1});
const sides=['left','right'];
const peak=pcm=>sides.reduce((max,side)=>pcm[side].reduce((value,sample)=>Math.max(value,Math.abs(sample)),max),0);
function program(engine,commands){for(let i=0;i<commands.length;i+=3){assert.equal(commands[i],0xb9);engine.writeHuc6280(commands[i+1],commands[i+2]);}}
function playerFor(engine,bytes){const player=new VgmPlayer(engine);player.setPrefetchFactor(1);player.load(bytes,{logger:null});player.reset();player.play();return player;}
function chunk(player,frames=64){const left=new Float32Array(frames),right=new Float32Array(frames);assert.equal(player.process(left,right,frames),frames);return{left,right};}
async function previewPcm(bytes,{enabled=Array(6).fill(true),toggle}={}){
  const graph=fakeAudio(),preview=createHuc6280SongPreview({getAudio:()=>graph.audio,createEngine:native,schedule:graph.schedule,cancel:graph.cancel,nowMs:()=>0});
  try{
    enabled.forEach((on,ch)=>preview.setChannelEnabled(ch,on));await preview.load(bytes);assert(await preview.play());toggle?.({graph,preview});
    for(let i=0;i<100&&preview.read().playing;i++)graph.tick(.008);
    assert.equal(preview.read().playback,'ended');
    const pcm={left:[],right:[]};for(const buffer of graph.buffers)for(let ch=0;ch<2;ch++)pcm[sides[ch]].push(...buffer.data[ch]);
    return{pcm,state:preview.read(),buffers:graph.buffers};
  }finally{preview.dispose();}
}

test('native six-channel all-On preview is identical to the raw shared player; every channel isolates without register changes',async()=>{
  const commands=[...init,...Array.from({length:4},(_,ch)=>voice(ch,{period:100+ch*63})).flat(),
    ...voice(4,{noise:true}),...voice(5,{dda:true}),...write(6,25)];
  const bytes=vgm([...commands,...wait(4096)]),plain=await native();let expected;
  try{const player=playerFor(plain,bytes),left=new Float32Array(4096),right=new Float32Array(4096);assert.equal(player.process(left,right,4096),4096);expected={left:[...left],right:[...right]};}finally{plain.dispose();}
  const all=await previewPcm(bytes);assert.deepEqual(all.pcm,expected);assert.deepEqual(all.state.channelEnabled,Array(6).fill(true));
  const solos=[];
  for(let selected=0;selected<6;selected++){
    const enabled=Array.from({length:6},(_,ch)=>ch===selected),result=await previewPcm(bytes,{enabled});
    assert(peak(result.pcm)>.0001,`CH${selected+1} has actual native output`);assert.equal(result.state.channelMuteMask,63^(1<<selected));solos.push(result.pcm);
  }
  for(const side of sides)for(let i=0;i<4096;i++){
    const sum=solos.reduce((value,pcm)=>value+pcm[side][i],0);assert(Math.abs(sum-all.pcm[side][i])<1e-6,`isolated outputs sum to original ${side} frame${i}`);
  }
  const silent=await previewPcm(bytes,{enabled:Array(6).fill(false)});assert.equal(peak(silent.pcm),0);assert(silent.state.liveState.ddaWrites[5]>0,'DDA/configured state still advances while outputs are off');
});

test('native CH2 mute preserves the LFO carrier; CH1 mute keeps CH2 advancing, and unmuting restores exact future PCM phase',async()=>{
  const engines=await Promise.all([native(),native(),native()]),[plain,carrierOnly,modOnly]=engines;
  const commands=[...init,...voice(1,{period:19,values:wave}),...voice(0,{period:234}),...write(8,4),...write(9,2)];
  try{
    for(const engine of engines)program(engine,commands);
    const selectors=engines.map(engine=>engine.selectedChannel);let hardwareWrites=0;
    for(const engine of engines){const write=engine.writeHuc6280;engine.writeHuc6280=function(...args){hardwareWrites++;return write.apply(this,args);};}
    carrierOnly.setChannelMuted(1,true);modOnly.setChannelMuted(0,true);
    const together=plain.processFrames(4096),carrier=carrierOnly.processFrames(4096),mod=modOnly.processFrames(4096);
    assert(peak(carrier)>.001);assert(peak(mod)>.001);
    for(const side of sides)for(let i=0;i<4096;i++)assert(Math.abs(together[side][i]-carrier[side][i]-mod[side][i])<1e-6);
    carrierOnly.setChannelMuted(1,false);modOnly.setChannelMuted(0,false);
    const future=plain.processFrames(4096);assert.deepEqual(carrierOnly.processFrames(4096),future,'muted CH2 advanced its modulation phase');
    assert.deepEqual(modOnly.processFrames(4096),future,'muted carrier continued advancing CH2');
    assert.equal(hardwareWrites,0,'output gates never write a captured hardware register');assert.deepEqual(engines.map(engine=>engine.selectedChannel),selectors);
  }finally{engines.forEach(engine=>engine.dispose());}
});

test('native ordinary Wave and Noise remain phase-continuous while muted and produce silent output before unmute',async()=>{
  for(const [channel,options]of[[2,{period:177}],[4,{noise:true}]]){
    const plain=await native(),muted=await native();try{
      const commands=[...init,...voice(channel,options)];program(plain,commands);program(muted,commands);muted.setChannelMuted(channel,true);
      plain.processFrames(4096);assert.equal(peak(muted.processFrames(4096)),0);muted.setChannelMuted(channel,false);
      assert.deepEqual(muted.processFrames(4096),plain.processFrames(4096),`CH${channel+1} phase/Noise seed keeps running`);
    }finally{plain.dispose();muted.dispose();}
  }
});

test('native DAC streams feed unchanged while their output is muted and resume the exact current value/timeline',async()=>{
  const pcm=[0,31,8,23,12,19,15,16],bytes=vgm([...init,...voice(0,{dda:true}),...block(pcm),...streamSetup(),...streamStart(pcm.length,{mode:129}),
    ...Array.from({length:32},()=>wait(64)).flat(),0x94,0]);
  const plain=await native(),muted=await native(),plainTimeline=createHuc6280SongTimeline(plain),mutedTimeline=createHuc6280SongTimeline(muted);
  try{
    const a=playerFor(plain,bytes),b=playerFor(muted,bytes);muted.setChannelMuted(0,true);
    for(let i=0;i<8;i++){chunk(a);assert.equal(peak(chunk(b)),0);}
    const before=mutedTimeline.read(512);assert(before.ddaWrites[0]>20);assert.deepEqual(before,plainTimeline.read(512));
    muted.setChannelMuted(0,false);
    for(let i=0;i<24;i++)assert.deepEqual(chunk(b),chunk(a),'native DAC events were not skipped or replayed');
    assert.deepEqual(mutedTimeline.read(2048),plainTimeline.read(2048));
  }finally{plainTimeline.dispose();mutedTimeline.dispose();plain.dispose();muted.dispose();}
});

test('native output toggle keeps already-rendered PCM intact and affects only the subsequent render frontier',async()=>{
  const bytes=vgm([...init,...voice(0),...wait(10000)]),baseline=await previewPcm(bytes);let oldCount=0,oldFrames=0;
  const changed=await previewPcm(bytes,{toggle({graph,preview}){
    oldCount=graph.buffers.length;oldFrames=graph.buffers.reduce((sum,buffer)=>sum+buffer.length,0);
    const recorded=graph.buffers.map(buffer=>buffer.data.map(side=>side.slice())),state=preview.read();
    preview.setChannelEnabled(0,false);assert.equal(preview.read().positionFrames,state.positionFrames);assert.equal(preview.read().liveState,state.liveState);
    graph.buffers.forEach((buffer,index)=>assert.deepEqual(buffer.data,recorded[index]));
  }});
  for(const side of sides){assert.deepEqual(changed.pcm[side].slice(0,oldFrames),baseline.pcm[side].slice(0,oldFrames));assert(changed.pcm[side].slice(oldFrames).every(value=>value===0));}
  assert(oldCount>0&&oldFrames<10000);assert.equal(changed.state.positionFrames,10000);assert.equal(changed.state.liveState.registers[0][4],159);
});
