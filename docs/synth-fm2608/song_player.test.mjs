import test from 'node:test';
import assert from 'node:assert/strict';
import {createFm2608SongPlayer} from './song_player.js';
import {captureFm2608SongPreset} from './song_state.js';
import {decodeBase64} from './preset.js';

function fixture(commands=[0x56,0x29,0x9f,0x56,8,12,0x56,7,0x3e,0x61,0x44,0xac,0x66]) {
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);view.setUint32(0x34,256-0x34,true);view.setUint32(0x48,8000000,true);bytes.set(commands,256);return bytes;
}
function opnFixture() {
  const bytes=fixture([0x55,8,12,0x55,7,0x3e,0x61,0x44,0xac,0x66]),view=new DataView(bytes.buffer);
  view.setUint32(0x44,4000000,true);view.setUint32(0x48,0,true);
  view.setUint32(0xbc,4,true);view.setUint32(0xc0,12,true);view.setUint32(0xc8,4,true);
  bytes.set([1,0x86,0,0x9a,0x81],0xcc);
  return bytes;
}
function rig({beforePlay=async()=>{},createGate=null}={}) {
  let clock=0,serial=0;const timers=new Map(),engines=[],nodes=[];
  const context={state:'running',currentTime:0,resume:async()=>{},
    createGain(){return{context,gain:{value:1},connect(){},disconnect(){}};},
    createBuffer(channels,frames,rate){return{channels,frames,rate,copyToChannel(){}};},
    createBufferSource(){const node={buffer:null,connect(){},disconnect(){},start(at,offset){node.started={at,offset};},stop(){node.stopped=true;}};nodes.push(node);return node;},
  };
  const audio={context,outputNode:context.createGain()};
  const createEngine=async()=>{
    if(createGate)await createGate(engines.length);
    const engine={frames:0,writes:[],disposed:false,sampleRate:()=>44100,writeYm2608(...write){this.writes.push(write);},
      outputGains:{fm:1,ssg:1},setOutputGains(value){this.outputGains={...value};},
      reset(){this.frames=0;},loadAdpcmBMemory(){},clearAdpcmBMemory(){},loadAdpcmARom(){},
      processFrames(frames){this.frames+=frames;return{left:new Float32Array(frames).fill(.1),right:new Float32Array(frames).fill(.1)};},dispose(){this.disposed=true;}};
    engines.push(engine);return engine;
  };
  const player=createFm2608SongPlayer({getAudio:()=>audio,beforePlay,createEngine,
    schedule:(task,delay)=>{const id=++serial;timers.set(id,{task,at:clock+delay/1000});return id;},cancel:id=>timers.delete(id),
    yieldTask:async()=>{},nowMs:()=>clock*1000});
  function advance(seconds) {
    const target=clock+seconds;
    for(let i=0;i<100000;i++) {
      const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next||next[1].at>target)break;
      timers.delete(next[0]);clock=next[1].at;context.currentTime=clock;next[1].task();
    }
    clock=target;context.currentTime=clock;
  }
  return{player,engines,context,nodes,advance,timers};
}
test('loading opens no audio, invalid replacement preserves the current source',async()=>{
  const r=rig();await r.player.load(fixture(),'first.vgm');assert.equal(r.engines.length,0);
  await assert.rejects(r.player.load(new Uint8Array(4),'bad.vgm'),/header/);
  assert.equal(r.player.getState().name,'first.vgm');assert.equal(r.player.getState().loaded,true);r.player.dispose();
});
test('Pause retains exact song buffers and renders keyboard audition on a separate OPNA',async()=>{
  const r=rig();await r.player.load(fixture(),'one');assert.equal(await r.player.play(),true);r.advance(.08);
  await r.player.pause();const position=r.player.getState().positionSeconds,mainFrames=r.engines[0].frames;
  assert.equal(r.player.getState().manualReady,true);assert.equal(r.engines.length,2);
  const chip=r.player.getChip();chip.ssg.noteOn(0,'C4');r.advance(.1);chip.ssg.keyOff(0);
  assert.equal(r.engines[0].frames,mainFrames);assert.ok(r.engines[1].frames>0);assert.equal(r.player.getState().positionSeconds,position);
  assert.equal(r.player.getState().liveState.ssg.channels[0].volume,12);
  chip.ssg.noteOn(0,'E4');assert.deepEqual(r.engines[1].writes.at(-1),[0,8,12]);
  await r.player.resume();assert.equal(r.engines[1].disposed,true);r.advance(.05);
  assert.ok(r.player.getState().positionSeconds>position);r.player.dispose();assert.equal(r.timers.size,0);
});
test('manual writes and observed song settings stay distinct during playback',async()=>{
  const r=rig();await r.player.load(fixture(),'one');await r.player.play();
  r.player.getChip().setAlgo(0,7,5);r.advance(.12);
  const state=r.player.getState();assert.equal(state.liveState.fm.channels[0].preset.algorithm,7);
  assert.equal(state.songLiveState.fm.channels[0].preset.algorithm,0);r.player.dispose();
});
test('seek rebuilds from the source and Pause/Resume preserves the requested position',async()=>{
  const r=rig();await r.player.load(fixture(),'one');await r.player.play();r.advance(.1);
  assert.equal(await r.player.seek(.5),true);assert.equal(r.player.getState().playback,'playing');
  assert.ok(Math.abs(r.player.getState().positionSeconds-.5)<.001);
  await r.player.pause();assert.equal(await r.player.seek(.25),true);assert.equal(r.player.getState().playback,'paused');
  assert.ok(Math.abs(r.player.getState().positionSeconds-.25)<.001);r.player.dispose();
});
test('ending and Stop release every native engine without closing the host context',async()=>{
  const r=rig();await r.player.load(fixture(),'one');await r.player.play();r.advance(1.5);
  assert.equal(r.player.getState().playback,'ended');assert.equal(r.engines[0].disposed,true);assert.equal(r.context.state,'running');
  await r.player.play();await r.player.pause();r.player.stop();assert.ok(r.engines.every(engine=>engine.disposed));assert.equal(r.player.getState().positionSeconds,0);r.player.dispose();
});
test('ended channels can be reconstructed for a pending manual edit and audition at the final position',async()=>{
  const preparation=[];
  const r=rig({beforePlay:async options=>{preparation.push(options.manualPreparation);}});
  await r.player.load(fixture(),'one');await r.player.play();r.advance(1.5);
  const ended=r.player.getState(),position=ended.positionSeconds;
  assert.equal(ended.playback,'ended');assert.equal(ended.manualReady,false);
  assert.equal(r.player.getChip(),null);assert.equal(r.engines.length,1);assert.equal(r.engines[0].disposed,true);
  assert.equal(await r.player.seek(position,{manualPreparation:true}),true);
  let state=r.player.getState();
  assert.equal(state.playback,'paused');assert.equal(state.manualReady,true);
  assert.equal(state.positionSeconds,position);assert.equal(state.liveState.ssg.channels[0].volume,ended.liveState.ssg.channels[0].volume);
  assert.deepEqual(preparation,[false,true]);
  const chip=r.player.getChip();chip.setAlgo(0,7,3);chip.setOperator(0,0,{ar:27});
  state=r.player.getState();
  assert.equal(state.liveState.fm.channels[0].preset.algorithm,7);
  assert.equal(state.liveState.fm.channels[0].preset.operators[1].ar,27);
  chip.ssg.noteOn(0,'C4');r.advance(.1);chip.ssg.keyOff(0);
  assert.equal(r.player.getState().positionSeconds,position);
  assert.ok(r.engines.at(-1).frames>0);
  r.player.dispose();assert.ok(r.engines.every(engine=>engine.disposed));
});
test('replacement cancels an ended-channel reconstruction before its delayed engine can install',async()=>{
  let unblock,entered;
  const gate=new Promise(resolve=>{unblock=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const r=rig({createGate:index=>{if(index===1){entered();return gate;}}});
  await r.player.load(fixture(),'one');await r.player.play();r.advance(1.5);
  const preparing=r.player.seek(r.player.getState().positionSeconds,{manualPreparation:true});
  await started;
  await r.player.load(fixture(),'replacement');
  unblock();assert.equal(await preparing,false);
  const state=r.player.getState();
  assert.equal(state.name,'replacement');assert.equal(state.playback,'stopped');assert.equal(state.manualReady,false);
  assert.equal(r.player.getChip(),null);assert.ok(r.engines.every(engine=>engine.disposed));
  r.player.dispose();
});
test('Stop cancels delayed pause preparation and never leaks its eventual engine',async()=>{
  let resolve;const gate=new Promise(done=>resolve=done);
  const r=rig({createGate:index=>index===1?gate:undefined});await r.player.load(fixture(),'one');await r.player.play();
  const pausing=r.player.pause();r.player.stop();resolve();await pausing;
  assert.equal(r.player.getState().playback,'stopped');assert.ok(r.engines.every(engine=>engine.disposed));r.player.dispose();
});
test('channel mixer updates do not overwrite the displayed raw instrument',async()=>{
  const r=rig();await r.player.load(fixture(),'one');await r.player.play();r.advance(.1);
  r.player.setChannelEnabled('ssg',0,false);assert.equal(r.player.getState().channelEnabled.ssg[0],false);
  assert.equal(r.player.getState().liveState.ssg.channels[0].volume,12);assert.deepEqual(r.engines[0].writes.at(-1),[0,8,0]);
  r.player.setChannelEnabled('ssg',0,true);assert.deepEqual(r.engines[0].writes.at(-1),[0,8,12]);r.player.dispose();
});
test('a borrowed channel client cannot write through after Stop disposed its native chip',async()=>{
  const r=rig();await r.player.load(fixture(),'one');await r.player.play();const chip=r.player.getChip();r.player.stop();
  assert.throws(()=>chip.noteOn(0,'C4'),{name:'AbortError'});r.player.dispose();
});
test('paused ADPCM release preserves sample mode and Repeat for capture and the next trial note',async()=>{
  const bytes=Uint8Array.from({length:64},(_,index)=>index*3&255);
  const block=new Uint8Array(15+bytes.length),view=new DataView(block.buffer);
  block.set([0x67,0x66,0x81]);view.setUint32(3,8+bytes.length,true);view.setUint32(7,0x200000,true);view.setUint32(11,0x100,true);block.set(bytes,15);
  const source=fixture([...block,0x57,1,0xc2,0x57,2,8,0x57,4,9,0x57,9,255,0x57,10,127,0x57,11,192,0x57,0,0xb0,0x61,0x44,0xac,0x66]);
  const r=rig();await r.player.load(source,'adpcm');await r.player.play();r.advance(.1);await r.player.pause();
  const chip=r.player.getChip(),position=r.player.getState().positionSeconds,frames=r.engines[0].frames;
  assert.equal(r.player.getState().liveState.adpcm.external,true);
  assert.equal(r.player.getState().liveState.adpcm.playing,false);
  assert.equal(captureFm2608SongPreset(r.player.getState().liveState,{section:'adpcm'}).adpcm.repeat,true);
  chip.adpcm.keyOn({repeat:true});r.advance(.03);chip.adpcm.keyOff();
  let state=r.player.getState();assert.equal(state.liveState.adpcm.playing,false);assert.equal(state.liveState.adpcm.external,true);assert.equal(state.liveState.adpcm.repeat,true);
  let captured=captureFm2608SongPreset(state.liveState,{section:'adpcm'});
  assert.deepEqual(decodeBase64(captured.adpcm.data),bytes);assert.equal(captured.adpcm.repeat,true);assert.equal(captured.adpcm.address,0x100);
  // Match the UI's stopped Repeat toggle. Its raw control shadow must retain
  // external mode while changing only the Repeat bit, without retriggering.
  chip.write(1,0,chip.adpcm.registers[0] & ~16);
  state=r.player.getState();assert.equal(state.liveState.adpcm.external,true);assert.equal(state.liveState.adpcm.repeat,false);assert.equal(state.liveState.adpcm.playing,false);
  captured=captureFm2608SongPreset(state.liveState,{section:'adpcm'});assert.equal(captured.adpcm.repeat,false);
  chip.adpcm.keyOn({repeat:false});chip.adpcm.keyOff();assert.equal(r.player.getState().liveState.adpcm.external,true);
  chip.write(1,0,chip.adpcm.registers[0] | 16);assert.equal(r.player.getState().liveState.adpcm.repeat,true);
  assert.equal(r.engines[0].frames,frames);assert.equal(r.player.getState().positionSeconds,position);
  await r.player.resume();assert.equal(r.player.getState().songLiveState.adpcm.repeat,true);r.player.dispose();
});
test('YM2203 songs default to correction and file volumes, retaining user faders across source selection',async()=>{
  const r=rig();
  assert.equal(r.player.getState().outputMix.ym2203Mode,false);
  r.player.setOutputMix({fm:1.5,ssg:.5});
  await r.player.load(opnFixture(),'OPN');
  let state=r.player.getState();
  assert.equal(state.outputMix.ym2203Mode,true);
  assert.deepEqual(state.outputMix.effective,{fm:1.5,ssg:.6005859375});
  assert.equal(state.compatibility.volumeAdjustmentsApplied,true);
  assert.equal(state.compatibility.extraVolumeEntries[0].applied,true);
  assert.equal(r.engines.length,0);
  r.player.setOutputMix({ym2203Mode:false});
  assert.deepEqual(r.player.getState().outputMix.effective,{fm:1.5,ssg:.5});
  assert.equal(r.player.getState().compatibility.extraVolumeEntries[0].applied,false);
  await assert.rejects(r.player.load(new Uint8Array(4),'bad'),/header/);
  assert.equal(r.player.getState().outputMix.ym2203Mode,false);
  await r.player.load(opnFixture(),'OPN again');
  assert.equal(r.player.getState().outputMix.ym2203Mode,true);
  await r.player.load(fixture(),'OPNA');
  state=r.player.getState();assert.equal(state.outputMix.ym2203Mode,false);
  assert.deepEqual(state.outputMix.effective,{fm:1.5,ssg:.5});
  r.player.clear();assert.deepEqual(r.player.getState().outputMix.effective,{fm:1.5,ssg:.5});
  await r.player.load(opnFixture(),'OPN to clear');
  r.player.clear();
  state=r.player.getState();
  assert.equal(state.sourceChip,null);assert.equal(state.outputMix.ym2203Mode,false);
  assert.equal(state.outputMix.volumeAdjustmentsApplied,false);
  assert.deepEqual(state.outputMix.effective,{fm:1.5,ssg:.5});
  r.player.dispose();
});
test('output mix changes retain transport, note registers and paused position through Resume and Seek',async()=>{
  const r=rig();await r.player.load(opnFixture(),'OPN');await r.player.play();
  const main=r.engines[0];
  assert.deepEqual(main.outputGains,{fm:1,ssg:1.201171875});
  r.advance(.1);
  const firstPosition=r.player.getState().positionSeconds,writes=main.writes.length;
  r.player.setOutputMix({fm:.8,ssg:1.2});
  assert.equal(main.writes.length,writes);
  assert.equal(main.disposed,false);assert.equal(r.player.getState().playback,'playing');
  assert.equal(r.player.getState().positionSeconds,firstPosition);
  assert.deepEqual(main.outputGains,{fm:.8,ssg:1.4414062499999998});
  r.advance(.1);await r.player.pause();
  const pausedPosition=r.player.getState().positionSeconds,frames=main.frames;
  const audition=r.engines[1],chip=r.player.getChip();chip.ssg.noteOn(0,'C4');
  const auditionWrites=audition.writes.length;
  r.player.setOutputMix({ym2203Mode:false});
  assert.deepEqual(main.outputGains,{fm:.8,ssg:1.2});
  assert.deepEqual(audition.outputGains,{fm:.8,ssg:1.2});
  assert.equal(audition.writes.length,auditionWrites);assert.equal(main.frames,frames);
  assert.equal(r.player.getState().positionSeconds,pausedPosition);
  assert.equal(r.player.getState().liveState.ssg.channels[0].volume,12);
  await r.player.resume();assert.equal(r.player.getState().playback,'playing');
  assert.equal(r.player.getState().positionSeconds,pausedPosition);
  r.advance(.1);assert(r.player.getState().positionSeconds>pausedPosition);
  await r.player.seek(.5);assert.deepEqual(r.engines.at(-1).outputGains,{fm:.8,ssg:1.2});
  assert.equal(r.player.getState().playback,'playing');
  const current=r.player.getState().outputMix;
  assert.throws(()=>r.player.setOutputMix({fm:-1}),/0–3.8/);
  assert.deepEqual(r.player.getState().outputMix,current);
  r.player.dispose();
});
