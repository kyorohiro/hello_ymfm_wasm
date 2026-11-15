import test from 'node:test';
import assert from 'node:assert/strict';
import {createNesSongPlayer} from './song_player.js';
import {createNesSongEngine} from './song_engine.js';
import {captureNesSongPreset} from './song_state.js';

const w=(register,value)=>[0xb4,register,value];
function fixture(commands=[...w(0x15,3),...w(0,0xbf),...w(1,8),...w(2,0x40),...w(3,9),
  ...w(4,0x79),...w(5,8),...w(6,0x60),...w(7,9),0x61,0x44,0xac,0x66]) {
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,256-0x34,true);view.setUint32(0x84,1789773,true);bytes.set(commands,256);return bytes;
}
function fdsFixture() {
  const wave=Array.from({length:64},(_,index)=>Math.round(31.5+31.5*Math.sin(index*Math.PI/32)));
  const bytes=fixture([...w(0x3f,2),...w(0x29,128),...wave.flatMap((value,index)=>w(0x40+index,value)),
    ...w(0x29,0),...w(0x20,0x90),...w(0x27,128),...w(0x22,0x90),...w(0x23,1),0x61,0x44,0xac,0x66]);
  new DataView(bytes.buffer).setUint32(0x84,(1789773|0x80000000)>>>0,true);return bytes;
}
function rig({beforePlay=async()=>{},gate}={}) {
  let clock=0,serial=0;const timers=new Map(),engines=[],nodes=[];
  const context={state:'running',currentTime:0,resume:async()=>{},
    createGain(){return{context,gain:{value:1},connect(){},disconnect(){}};},
    createBuffer(channels,frames,rate){return{channels,frames,rate,copyToChannel(){}};},
    createBufferSource(){const node={connect(){},disconnect(){},start(at,offset){node.started={at,offset};},stop(){node.stopped=true;}};nodes.push(node);return node;},
  };
  const audio={context,songInputNode:context.createGain(),outputNode:context.createGain()};
  const createEngine=async header=>{
    if(gate)await gate(engines.length);
    const engine=await createNesSongEngine(header),process=engine.processFrames,dispose=engine.dispose;
    engine.testFrames=0;engine.disposed=false;
    engine.processFrames=frames=>{engine.testFrames+=frames;return process(frames);};
    engine.dispose=()=>{engine.disposed=true;dispose();};engines.push(engine);return engine;
  };
  const player=createNesSongPlayer({getAudio:()=>audio,beforePlay,createEngine,
    schedule:(task,delay)=>{const id=++serial;timers.set(id,{task,at:clock+delay/1000});return id;},cancel:id=>timers.delete(id),
    yieldTask:async()=>{},nowMs:()=>clock*1000});
  function advance(seconds) {
    const target=clock+seconds;
    for(let i=0;i<100000;i++) {
      const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>target)break;
      timers.delete(next[0]);clock=next[1].at;context.currentTime=clock;next[1].task();
    }
    clock=target;context.currentTime=clock;
  }
  return{player,engines,context,nodes,timers,advance};
}
test('loading opens no audio and invalid replacement preserves a playing song',async()=>{
  const r=rig();try{
    await r.player.load(fixture(),'first.vgm');assert.equal(r.engines.length,0);await r.player.play();r.advance(.1);
    const position=r.player.getState().positionSeconds;await assert.rejects(r.player.load(new Uint8Array(4),'bad.vgm'),/header/);
    assert.equal(r.player.getState().name,'first.vgm');assert.equal(r.player.getState().playing,true);assert.equal(r.player.getState().positionSeconds,position);
  }finally{r.player.dispose();}
});
test('Pause is silent and its independent keyboard APU leaves original PCM/core intact for Resume',async()=>{
  const r=rig();try{
    await r.player.load(fixture(),'one');assert.equal(await r.player.play(),true);r.advance(.1);await r.player.pause();
    const paused=r.player.getState(),frames=r.engines[0].testFrames;
    assert.equal(paused.manualReady,true);assert.equal(r.engines.length,2);
    const clone=r.engines[1].getCoreState();assert.equal(clone.enableMask,0);assert.equal(clone.fdsGain,0);assert.equal(clone.dmcOutput,0);
    r.player.noteOn('trial',60,1);r.advance(.1);r.player.noteOff('trial');
    assert.equal(r.engines[0].testFrames,frames);assert.equal(r.player.getState().positionSeconds,paused.positionSeconds);
    assert.equal(r.player.getState().liveState.channels[1].preset.pulse.volume,9);
    assert.equal(await r.player.resume(),true);assert.equal(r.engines[1].disposed,true);r.advance(.05);
    assert.ok(r.player.getState().positionSeconds>paused.positionSeconds);
  }finally{r.player.dispose();assert.equal(r.timers.size,0);}
});
test('human edits share the playing APU and keep authored song observations available',async()=>{
  const r=rig();try{
    await r.player.load(fixture(),'one');await r.player.play();r.advance(.1);
    const preset=captureNesSongPreset(r.player.getState().liveState,{channel:0});preset.pulse.volume=3;
    r.player.applyPreset(0,preset);r.player.noteOn('manual',64,0);r.advance(.08);
    const state=r.player.getState();assert.equal(state.playing,true);assert.equal(state.liveState.channels[0].preset.pulse.volume,3);
    assert.equal(state.songLiveState.channels[0].preset.pulse.volume,15);assert.equal(r.player.noteOff('manual'),true);
  }finally{r.player.dispose();}
});
test('paused FDS attack restores its frozen gain after clone silence and repeated release',async()=>{
  const r=rig();try{
    await r.player.load(fdsFixture(),'FDS');await r.player.play();r.advance(.1);await r.player.pause();
    assert.equal(r.player.getState().liveState.channels[5].preset.fds.volume,16);
    assert.equal(r.engines[1].getCoreState().fdsGain,0);
    for(let count=0;count<2;count++) {
      r.player.noteOn('fds-'+count,48,5);
      const hardware=r.engines[1].getCoreState();assert.equal(hardware.fdsActive,true);assert.equal(hardware.fdsGain,16);
      const pcm=r.engines[1].processFrames(2048);assert.ok(pcm.left.some(value=>Math.abs(value)>.001));
      r.player.noteOff('fds-'+count);assert.equal(r.engines[1].getCoreState().fdsGain,0);
      const state=r.player.getState(),captured=captureNesSongPreset(state.liveState,{channel:5});
      assert.equal(state.liveState.coreState.fdsGain,0);assert.equal(captured.fds.volume,16);assert.equal(captured.fds.envelope.initialGain,16);
    }
  }finally{r.player.dispose();}
});
test('paused DMC edits and release retain the whole sample and authored initial DAC level',async()=>{
  const data=Uint8Array.from({length:65},(_,index)=>index&1?0xaa:0x55),block=new Uint8Array(9+data.length),view=new DataView(block.buffer);
  block.set([0x67,0x66,0xc2]);view.setUint32(3,data.length+2,true);view.setUint16(7,0xe000,true);block.set(data,9);
  const source=fixture([...block,...w(0x10,0x4a),...w(0x11,72),...w(0x12,128),...w(0x13,4),...w(0x15,16),0x61,0x44,0xac,0x66]);
  const r=rig();try{
    await r.player.load(source,'DMC');await r.player.play();r.advance(.1);await r.player.pause();
    const preset=captureNesSongPreset(r.player.getState().liveState,{channel:4}),level=preset.dmc.level;preset.dmc.rate=7;
    r.player.applyPreset(4,preset);assert.equal(captureNesSongPreset(r.player.getState().liveState,{channel:4}).dmc.data.length,65);
    r.player.noteOn('dmc',60,4);r.advance(.02);r.player.noteOff('dmc');
    const snapshot=r.player.getState().liveState,captured=captureNesSongPreset(snapshot,{channel:4});
    assert.equal(snapshot.coreState.dmcOutput,0);assert.equal(captured.dmc.level,level);assert.deepEqual(captured.dmc.data,[...data]);assert.equal(captured.dmc.rate,7);
  }finally{r.player.dispose();}
});
test('later song triggers retire manual owners so stale key releases cannot cut the song',async()=>{
  const r=rig();try{
    const source=fixture([...w(0x15,1),...w(0,0xbf),...w(1,8),...w(2,0x40),...w(3,9),0x61,0x11,0x2b,
      ...w(3,9),0x61,0x33,0x81,0x66]);
    await r.player.load(source,'one');await r.player.play();r.advance(.1);r.player.noteOn('old',60,0);r.advance(.25);
    assert.equal(r.player.noteOff('old'),false);assert.equal(r.player.getState().playing,true);assert.equal(r.engines[0].getCoreState().enableMask&1,1);
  }finally{r.player.dispose();}
});
test('borrowed public-client edits are manual and obsolete clients cannot write after Stop',async()=>{
  const r=rig();try{
    await r.player.load(fixture(),'one');await r.player.play();r.advance(.1);
    r.player.noteOn('before-raw',60,0);const chip=r.player.getChip();chip.pulse.setVoice(0,{volume:4});chip.noteOn(0,'E4');
    assert.equal(r.player.noteOff('before-raw'),false);r.advance(.08);
    assert.equal(r.player.getState().liveState.channels[0].preset.pulse.volume,4);
    assert.equal(r.player.getState().songLiveState.channels[0].preset.pulse.volume,15);
    r.player.stop();assert.equal(r.player.noteOff('released-after-stop'),false);assert.throws(()=>chip.noteOn(0,'C4'),/disposed/);
  }finally{r.player.dispose();}
});
test('seek rebuilds exact source timing and paused capture preserves original channel differences',async()=>{
  const r=rig();try{
    await r.player.load(fixture(),'one');await r.player.play();r.advance(.1);assert.equal(await r.player.seek(.5),true);
    assert.equal(r.player.getState().playing,true);assert.ok(Math.abs(r.player.getState().positionSeconds-.5)<.001);
    await r.player.pause();assert.equal(await r.player.seek(.25),true);const state=r.player.getState();assert.equal(state.paused,true);
    assert.ok(Math.abs(state.positionSeconds-.25)<.001);assert.equal(captureNesSongPreset(state.liveState,{channel:0}).pulse.volume,15);
    assert.equal(captureNesSongPreset(state.liveState,{channel:1}).pulse.volume,9);
  }finally{r.player.dispose();}
});
test('natural end keeps a final snapshot which can be reconstructed for later manual audition',async()=>{
  const preparation=[],r=rig({beforePlay:async options=>preparation.push(options.manualPreparation)});try{
    await r.player.load(fixture(),'one');await r.player.play();r.advance(1.5);const ended=r.player.getState();
    assert.equal(ended.playback,'ended');assert.equal(ended.liveState.channels[0].preset.pulse.volume,15);assert.equal(r.engines[0].disposed,true);
    assert.equal(await r.player.seek(ended.positionSeconds,{manualPreparation:true}),true);assert.equal(r.player.getState().manualReady,true);
    r.player.noteOn('after-end',60,0);r.player.noteOff('after-end');assert.deepEqual(preparation,[false,true]);assert.equal(r.context.state,'running');
  }finally{r.player.dispose();assert.ok(r.engines.every(engine=>engine.disposed));}
});
test('Stop cancels delayed pause preparation and disposes every eventual native core',async()=>{
  let entered,resolve;const started=new Promise(done=>entered=done),gate=new Promise(done=>resolve=done);
  const r=rig({gate:index=>{if(index===1){entered();return gate;}}});try{
    await r.player.load(fixture(),'one');await r.player.play();r.advance(.1);const pausing=r.player.pause();await started;r.player.stop();resolve();await pausing;
    assert.equal(r.player.getState().playback,'stopped');assert.ok(r.engines.every(engine=>engine.disposed));
  }finally{r.player.dispose();}
});
