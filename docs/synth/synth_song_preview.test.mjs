import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {createSynthSongPreview, inspectGenesisPreview} from './synth_song_preview.js';
import {SYNTH_SONG_MIX_DEFAULTS as defaults} from './synth_song_mix_defaults.js';

function vgm({clock=7670454, psg=3579545, otherClock=0, rf=0, pwm=0, command=0x52, commands:providedCommands,durationSamples=44100}={}) {
  const commands = providedCommands ?? [command,0xb0,4,0x61,0x44,0xac,0x66];
  const bytes = new Uint8Array(256 + commands.length), view = new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);
  view.setUint32(4, bytes.length-4, true);
  view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 204, true);
  view.setUint32(0x18, durationSamples, true);
  view.setUint32(0x2c, clock, true);
  view.setUint32(0xc, psg, true);
  view.setUint32(0x30, otherClock, true);
  view.setUint32(0x6c, rf, true);
  view.setUint32(0x70, pwm, true);
  bytes.set(commands,256);
  return bytes;
}
function audioHost() {
  const starts = [], gains = [], context = {currentTime:0, resumeCalls:0,
    async resume() {this.resumeCalls++;},
    createGain() {
      const gain = {context, gain:{value:1}, connected:null, disconnected:false,
        connect(output) {this.connected=output;}, disconnect() {this.disconnected=true;}};
      gains.push(gain);return gain;
    },
    createBuffer(channels, frames, rate) {
      const data = Array.from({length:channels},()=>new Float32Array(frames));
      return {length:frames,sampleRate:rate,getChannelData:channel=>data[channel],
        copyToChannel(values,channel) {data[channel].set(values);}};
    },
    createBufferSource() {
      return {buffer:null,onended:null,stopped:false,disconnected:false,
        connect(output) {this.output=output;}, disconnect() {this.disconnected=true;},
        start(when,offset) {this.when=when;this.offset=offset;starts.push(this);},
        stop() {this.stopped=true;}};
    },
  };
  return {context, output:{context}, starts, gains};
}
function fixture({getAudio, createEngine, beforeResume}={}) {
  const host=audioHost(), engines=[], states=[], statuses=[];
  const factory=async header=>{
    let phase=0;
    const engine={header,disposed:0,writes:[],reset(){phase=0;},sampleRate:()=>44100,
      writeYm2612(...args){this.writes.push(args);},writePsg(){},
      processFrames(frames){const left=Float32Array.from({length:frames},()=>Math.sin(2*Math.PI*220*phase++/44100)*.1);return {left,right:left.slice()};},
      dispose(){this.disposed++;}};
    engines.push(engine);return engine;
  };
  const preview=createSynthSongPreview({getAudio:getAudio??(()=>host),createEngine:createEngine??factory,
    beforeResume,onState:state=>states.push(state),onStatus:message=>statuses.push(message)});
  return {host,engines,states,statuses,preview};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,35));

test('native PSG-only playback observes the audible prefix and exact paused/seek positions without a fabricated FM snapshot',async()=>{
  const host=audioHost(),preview=createSynthSongPreview({getAudio:()=>host});
  const wait=frames=>[0x61,frames&255,frames>>8];
  const bytes=vgm({clock:0,durationSamples:17640,commands:[
    0x50,0x8e,0x50,0x0f,0x50,0x96,...wait(2205),
    0x50,0x99,0x50,0xe7,0x50,0xf4,...wait(15435),0x66,
  ]});
  try {
    await preview.load(bytes,'PSG-only.vgm');assert.equal(preview.getState().psgLiveState,null);
    assert.equal(await preview.play(),true);
    const deadline=Date.now()+1000;
    while(host.starts.reduce((sum,node)=>sum+node.buffer.length,0)<12000&&Date.now()<deadline)await tick();
    let view=preview.getState();assert.equal(view.liveState,null);assert.equal(view.psgLiveState.channels[0].attenuation,6);
    assert.equal(view.psgLiveState.channels[3].attenuation,15,'render-ahead noise writes are not yet audible');
    host.context.currentTime=.085;preview.pause();view=preview.getState();
    assert.equal(view.psgLiveState.channels[0].attenuation,9);assert.equal(view.psgLiveState.channels[3].attenuation,4);
    const frozen=structuredClone(view.psgLiveState);host.context.currentTime=10;await tick();
    assert.deepEqual(preview.getState().psgLiveState,frozen);
    await preview.seek(.025);view=preview.getState();assert.equal(view.playback,'paused');
    assert.equal(view.psgLiveState.channels[0].attenuation,6);assert.equal(view.psgLiveState.channels[3].lastAttenuation,15);
    await preview.seek(.075);view=preview.getState();assert.equal(view.psgLiveState.channels[0].attenuation,9);
    assert.equal(view.psgLiveState.channels[3].noiseRate,'tone3');assert.equal(view.psgLiveState.channels[3].attenuation,4);
    const samples=host.starts.flatMap(node=>Array.from(node.buffer.getChannelData(0)));
    assert(samples.some(value=>Math.abs(value)>.001),'the actual PSG core rendered audio');
    preview.stop();assert.equal(preview.getState().psgLiveState,null);
  } finally {preview.dispose();}
});

test('native PCM-only playback shows audible RAM and registers, exact Pause and seek without FM/PSG snapshots',async()=>{
  const host=audioHost(),preview=createSynthSongPreview({getAudio:()=>host});
  const wait=frames=>[0x61,frames&255,frames>>8];
  const block=[0x67,0x66,0xc1,7,0,0,0,0,1,0xa0,0xa1,0x20,0x21,255];
  const commands=[...block,0xb1,7,0xc0,0xb1,0,64,0xb1,1,0xa5,0xb1,2,0,0xb1,3,8,
    0xb1,4,0,0xb1,5,1,0xb1,6,1,0xb1,8,0xfe,...wait(2205),
    0xc2,0,1,0xb4,0xb1,0,32,...wait(15435),0x66];
  try {
    await preview.load(vgm({clock:0,psg:0,rf:12500000,durationSamples:17640,commands}),'PCM-only.vgm');
    assert.equal(preview.getState().pcmLiveState,null);await preview.play();
    const deadline=Date.now()+1000;
    while(host.starts.reduce((sum,node)=>sum+node.buffer.length,0)<12000&&Date.now()<deadline)await tick();
    let view=preview.getState();assert.equal(view.liveState,null);assert.equal(view.psgLiveState,null);
    assert.equal(view.pcmLiveState.channels[0].volume,64);assert.equal(view.pcmLiveState.channels[0].panLeft,5);
    assert.equal(view.pcmLiveState.channels[0].panRight,10);assert.equal(view.pcmLiveState.ram[0x100],0xa0);
    assert.equal(view.pcmLiveState.known[0x104],1);assert.equal(view.pcmLiveState.known[0x105],0);
    const early=view.pcmLiveState;host.context.currentTime=.085;preview.pause();view=preview.getState();
    assert.equal(view.pcmLiveState.channels[0].volume,32);assert.equal(view.pcmLiveState.ram[0x100],0xb4);
    assert.equal(early.ram[0x100],0xa0,'render-ahead memory cannot mutate an earlier view');
    const paused=structuredClone(view.pcmLiveState);host.context.currentTime=10;await tick();
    assert.deepEqual(preview.getState().pcmLiveState,paused);
    await preview.seek(.025);view=preview.getState();assert.equal(view.playback,'paused');
    assert.equal(view.pcmLiveState.channels[0].volume,64);assert.equal(view.pcmLiveState.ram[0x100],0xa0);
    await preview.seek(.075);view=preview.getState();assert.equal(view.pcmLiveState.channels[0].volume,32);
    assert.equal(view.pcmLiveState.ram[0x100],0xb4);assert.equal(view.pcmLiveState.frame,view.consumedFrames);
    assert(host.starts.some(node=>node.buffer.getChannelData(0).some(value=>Math.abs(value)>.001)),'native RF5C164 generated numeric PCM');
    preview.stop();assert.equal(preview.getState().pcmLiveState,null);
  } finally {preview.dispose();}
});

test('native PCM seek cache restores audible RAM, pending writes and original pan under Mix muting',async()=>{
  const host=audioHost(),preview=createSynthSongPreview({getAudio:()=>host}),commands=[];
  const block=[0x67,0x66,0xc1,7,0,0,0,0,1,0xa0,0xa1,0x20,0x21,255];commands.push(...block);
  commands.push(0xb1,7,0xc0,0xb1,1,0xa5,0xb1,2,0,0xb1,3,8,0xb1,4,0,0xb1,5,1,0xb1,6,1,0xb1,8,0xfe);
  for(let second=0;second<12;second++)commands.push(0xb1,0,32+second,0xc2,0,1,0x80+second,0x61,0x44,0xac);
  commands.push(0x66);
  try {
    await preview.load(vgm({clock:0,psg:0,rf:12500000,durationSamples:12*44100,commands}),'PCM-cache.vgm');
    await preview.seek(0);preview.setChannelMuted('pcm:0',true);await preview.seek(10.25);let view=preview.getState();
    assert.equal(view.pcmLiveState.channels[0].volume,42);assert.equal(view.pcmLiveState.ram[0x100],0x8a);
    assert.equal(view.pcmLiveState.channels[0].panLeft,5);assert.equal(view.pcmLiveState.channels[0].panRight,10,'source routing survives Mix mask');
    assert(view.cache.count>0);await preview.seek(6.25);view=preview.getState();assert(view.cache.lastRestoreFrame>0);
    assert.equal(view.pcmLiveState.channels[0].volume,38);assert.equal(view.pcmLiveState.ram[0x100],0x86);
    const cached=view.pcmLiveState;preview.setSeekCacheEnabled(false);await preview.seek(6.25);
    view=preview.getState();assert.deepEqual(view.pcmLiveState.channels,cached.channels);
    assert.deepEqual(view.pcmLiveState.ram,cached.ram);assert.deepEqual(view.pcmLiveState.known,cached.known);
  } finally {preview.dispose();}
});

test('mixed native PSG/YM seek cache restores both audible decoders with independent source clocks',async()=>{
  const host=audioHost(),preview=createSynthSongPreview({getAudio:()=>host});
  const commands=[];let frames=0;
  const wait=count=>{while(count){const chunk=Math.min(count,65535);commands.push(0x61,chunk&255,chunk>>8);count-=chunk;frames+=chunk;}};
  for(let second=0;second<12;second++) {
    commands.push(0x52,0xb0,second%8,0x50,0x80|(second&15),0x50,0x10+(second&7),0x50,0x90|(second%14));
    wait(44100);
  }
  commands.push(0x66);
  try {
    await preview.load(vgm({commands,durationSamples:frames}),'mixed-observers.vgm');
    await preview.seek(10.25);let view=preview.getState();
    assert.equal(view.liveState.channels[0].preset.algorithm,2);assert.equal(view.psgLiveState.channels[0].attenuation,10);
    assert.equal(view.psgLiveState.channels[0].period,(0x12<<4)|10);
    assert.equal(view.liveState.frame,view.psgLiveState.frame);assert(view.cache.count>0);
    await preview.seek(6.25);view=preview.getState();assert(view.cache.lastRestoreFrame>0);
    assert.equal(view.liveState.channels[0].preset.algorithm,6);assert.equal(view.psgLiveState.channels[0].attenuation,6);
    assert.equal(view.psgLiveState.channels[0].period,(0x16<<4)|6);
    assert.equal(view.liveState.frame,view.psgLiveState.frame);
    preview.setSeekCacheEnabled(false);await preview.seek(6.25);
    const cold=preview.getState();assert.deepEqual(cold.psgLiveState.channels,view.psgLiveState.channels);
    assert.deepEqual(cold.liveState.channels,view.liveState.channels);
  } finally {preview.dispose();}
});

test('selection stays silent; Play borrows the existing output and requests its gesture before awaiting',async()=>{
  let requested=0;const host=audioHost(), f=fixture({getAudio:()=>{requested++;return host;}});
  try{
    const bytes=vgm();f.preview.load(bytes,'song.vgm');bytes[0]=0;
    assert.equal(requested,0);assert.equal(f.engines.length,0);
    f.preview.setVolume(3.8);
    const playing=f.preview.play();assert.equal(requested,1,'shared audio gesture is requested synchronously');
    assert.equal(await playing,true);assert.equal(f.engines.length,1);
    assert.equal(f.engines[0].header.ym2612Clock,7670454);
    assert.equal(host.gains[0].connected,host.output);assert.equal(host.gains[0].gain.value,3.8);
    // Cooperative rendering can yield before its first buffer under parallel
    // test load. It must still schedule audio on a bounded subsequent refill.
    const deadline=Date.now()+1000;
    while(!host.starts.length&&Date.now()<deadline)await tick();
    assert(host.starts.length>0);assert(host.starts.every(node=>node.buffer.sampleRate===44100));
    f.preview.setVolume(.5);assert.equal(host.gains[0].gain.value,.5);
    assert.throws(()=>f.preview.setVolume(4),/0\.\.3.8/);
  }finally{f.preview.dispose();}
  assert.equal(f.engines[0].disposed,1);
});

test('Pause freezes consumed frames and Resume preserves the exact unconsumed buffer offset',async()=>{
  const f=fixture();
  try{
    f.preview.load(vgm(),'song.vgm');await f.preview.play();
    // A cooperative refill may initially schedule only part of a chunk under
    // parallel WASM test load. Wait for audio covering the intended pause point
    // before advancing the fake audio clock into that unconsumed buffer.
    const deadline=Date.now()+1000;
    const scheduledFrames=()=>f.host.starts.reduce((sum,node)=>sum+node.buffer.length,0);
    while(scheduledFrames()<44100*.2&&Date.now()<deadline)await tick();
    assert(scheduledFrames()>=44100*.2,'the player schedules enough actual audio for a mid-buffer Pause');
    f.host.context.currentTime=.075;
    const consumed=f.preview.getState().consumedFrames;assert(consumed>0);
    f.preview.pause();const frozen=f.preview.getState();
    assert.equal(frozen.playback,'paused');assert.equal(frozen.positionFrames,consumed);
    const initialNodes=[...f.host.starts];assert(initialNodes.every(node=>node.stopped));
    f.host.context.currentTime=5;await tick();
    assert.equal(f.preview.getState().consumedFrames,consumed);
    await f.preview.resume();assert.equal(f.preview.getState().playback,'playing');
    assert.equal(f.engines.length,1,'Resume does not recreate or rewind the engine');
    let cumulativeFrames=0;
    const expected=initialNodes.find(node=>{
      if(cumulativeFrames+node.buffer.length>consumed)return true;
      cumulativeFrames+=node.buffer.length;return false;
    });
    assert(expected&&consumed>cumulativeFrames,'Pause falls inside a buffer that was scheduled before Pause');
    const resumed=f.host.starts[initialNodes.length];
    assert(resumed,'Resume schedules the retained PCM');
    assert.equal(resumed.buffer,expected.buffer,'Resume keeps the partially heard PCM buffer');
    assert(Math.abs(resumed.offset-(consumed-cumulativeFrames)/44100)<1e-12);
    f.host.context.currentTime=5.05;assert(f.preview.getState().consumedFrames>consumed);
    f.preview.stop();assert.equal(f.preview.getState().positionFrames,0);
    assert.equal(f.engines[0].disposed,0,'Stop retains the same-source engine and bounded checkpoints');assert(f.host.starts.every(node=>node.stopped||node.disconnected));
  }finally{f.preview.dispose();}
  assert.equal(f.engines[0].disposed,1);
});

test('Resume requests its trusted audio context before waiting for recorder shutdown and Stop cancels a waiting resume',async()=>{
  const order=[],release=[];
  const f=fixture({beforeResume:()=>{
    order.push('shutdown');return new Promise(resolve=>release.push(resolve));
  }});
  try {
    f.preview.load(vgm(),'song.vgm');await f.preview.play();
    const deadline=Date.now()+1000;
    while(!f.host.starts.length&&Date.now()<deadline)await tick();
    assert(f.host.starts.length>0,'the source has real retained PCM before Pause');
    f.host.context.currentTime=.04;f.preview.pause();
    const position=f.preview.getState().consumedFrames,initialCount=f.host.starts.length;
    f.host.context.resume=async()=>{order.push('context');f.host.context.resumeCalls++;};
    const pending=f.preview.resume();
    assert.deepEqual(order,['context','shutdown'],'the trusted context request is synchronous and precedes any shutdown yield');
    f.host.context.currentTime=5;await tick();
    assert.equal(f.preview.getState().playback,'paused');assert.equal(f.preview.getState().consumedFrames,position);
    assert.equal(f.host.starts.length,initialCount,'no retained buffer is scheduled before shutdown finishes');
    assert(f.host.starts.every(node=>node.stopped));
    release.shift()();assert.equal(await pending,true);
    assert.equal(f.preview.getState().playback,'playing');assert(f.host.starts.length>initialCount);
    assert.equal(f.engines.length,1,'shutdown does not recreate the reference engine');

    f.host.context.currentTime=5.05;f.preview.pause();
    const beforeCancel=f.host.starts.length;
    const cancelled=f.preview.resume();
    assert.deepEqual(order,['context','shutdown','context','shutdown']);
    f.preview.stop();f.host.context.currentTime=10;release.shift()();
    assert.equal(await cancelled,false,'Stop invalidates the pending Resume generation');
    assert.equal(f.preview.getState().playback,'stopped');assert.equal(f.preview.getState().consumedFrames,0);
    assert.equal(f.host.starts.length,beforeCancel,'a late shutdown completion cannot schedule another buffer');
    assert.equal(f.engines[0].disposed,0,'a cancelled Resume retains the source cache without scheduling audio');assert(f.host.starts.every(node=>node.stopped||node.disconnected));
  } finally {f.preview.dispose();}
  assert.equal(f.engines[0].disposed,1);
});

test('natural EOF drains scheduled samples and retains the source engine until disposal',async()=>{
  const f=fixture();
  try{
    f.preview.load(vgm(),'song.vgm');await f.preview.play();
    assert.equal(f.preview.getState().playback,'playing');
    for(let step=0;step<20&&f.preview.getState().playback==='playing';step++){
      f.host.context.currentTime+=.1;await tick();
    }
    const state=f.preview.getState();assert.equal(state.playback,'ended');
    assert.equal(state.positionFrames,44100);assert.equal(state.positionSeconds,1);
    assert.equal(f.engines[0].disposed,0);assert.equal(f.preview.getState().hasSource,true);
  }finally{f.preview.dispose();}
  assert.equal(f.engines[0].disposed,1);
});

test('Stop during shared audio preparation cannot create a late song engine',async()=>{
  let finish;const f=fixture({getAudio:()=>new Promise(resolve=>{finish=resolve;})});
  try{
    f.preview.load(vgm(),'first.vgm');const pending=f.preview.play();
    f.preview.stop();finish(f.host);assert.equal(await pending,false);
    assert.equal(f.engines.length,0);assert.equal(f.preview.getState().playback,'stopped');
  }finally{f.preview.dispose();}
});

test('a slow engine is disposed when another source is selected',async()=>{
  let finish;const engine={disposed:0,dispose(){this.disposed++;}}, f=fixture({createEngine:()=>new Promise(resolve=>{finish=resolve;})});
  try{
    f.preview.load(vgm(),'old.vgm');const pending=f.preview.play();
    while(!finish)await new Promise(resolve=>setTimeout(resolve,0));
    f.preview.load(vgm(),'new.vgm');finish(engine);
    assert.equal(await pending,false);assert.equal(engine.disposed,1);
    assert.equal(f.preview.getState().name,'new.vgm');assert.equal(f.preview.getState().playback,'stopped');
    assert.equal(f.host.starts.length,0);
    f.preview.clear();assert.equal(f.preview.getState().hasSource,false);assert.equal(f.preview.getState().name,'');
  }finally{f.preview.dispose();}
});

test('VGZ stays unmodified and unsupported chips / variants / commands reject clearly',async()=>{
  const f=fixture(), compressed=new Uint8Array(gzipSync(vgm())), original=compressed.slice();
  try{
    f.preview.load(compressed,'song.vgz');await f.preview.play();assert.deepEqual(compressed,original);
    f.preview.stop();
    for(const bytes of [vgm({otherClock:4000000}),vgm({clock:0x40000000|7670454}),vgm({command:0x54})]){
      f.preview.load(bytes,'unsupported.vgm');await assert.rejects(f.preview.play(),/support/i);
      assert.equal(f.preview.getState().playback,'error');assert.equal(f.preview.getState().name,'unsupported.vgm');
      assert.match(f.preview.getState().errorMessage,/support/i);
    }
    assert.equal(f.engines.length,1,'unsupported files never create a reference engine');
    assert.throws(()=>inspectGenesisPreview(new Uint8Array(3)),/VGM|header/i);
  }finally{f.preview.dispose();}
});

test('Game Gear stereo commands reject rather than silently losing their routing',()=>{
  const commands=[0x4f,0xff,0x50,0x90,0x61,0x44,0xac,0x66];
  const bytes=new Uint8Array(256+commands.length);
  bytes.set(vgm().subarray(0,256));bytes.set(commands,256);
  new DataView(bytes.buffer).setUint32(4,bytes.length-4,true);
  assert.throws(()=>inspectGenesisPreview(bytes),/0x4f/);
});

test('Mega CD RAM blocks, memory writes, bank copies and 32X direct/stream commands validate with their clocks',()=>{
  const ramBlock = [0x67,0x66,0xc1,7,0,0,0,0,0,0x40,0x40,0xc0,0xc0,0xff];
  const rfCommands = [...ramBlock,0xb1,7,0xc0,0xc2,0,0,0x20,0x61,10,0,0x66];
  const rf = inspectGenesisPreview(vgm({rf:12500000,commands:rfCommands}));
  assert.equal(rf.rf5c164Clock,12500000);
  const bankCopy = [0x67,0x66,2,3,0,0,0,0x40,0xc0,0xff,
    0x68,0x66,2,0,0,0,0,0,0,3,0,0,0x61,10,0,0x66];
  assert.equal(inspectGenesisPreview(vgm({rf:12500000,commands:bankCopy})).rf5c164Clock,12500000);
  const pwmCommands=[0xb2,0x00,5,0xb2,0x10,100,0xb2,0x40,60,
    0x67,0x66,3,2,0,0,0,40,0,0x90,0,0x11,0,4,
    0x91,0,3,1,0,0x92,0,0xb9,1,0,0,0x93,0,0,0,0,0,1,1,0,0,0,0x61,10,0,0x66];
  assert.equal(inspectGenesisPreview(vgm({pwm:23011361,commands:pwmCommands})).pwmClock,23011361);
  assert.throws(()=>inspectGenesisPreview(vgm({commands:rfCommands})),/RF5C164 clock/);
  assert.throws(()=>inspectGenesisPreview(vgm({commands:pwmCommands})),/32X PWM clock/);
});

test('second RF/PWM instances, absent optional clocks and unsupported RF DAC streams fail before audio',()=>{
  for(const fields of [{rf:0x40000000|12500000},{pwm:0x40000000|23011361}]){
    assert.throws(()=>inspectGenesisPreview(vgm(fields)),/dual or variant/);
  }
  assert.throws(()=>inspectGenesisPreview(vgm({rf:12500000,commands:[0xb1,0x87,0xc0,0x66]})),/second RF5C164 chip/);
  assert.throws(()=>inspectGenesisPreview(vgm({rf:12500000,commands:[0x67,0x66,0xc1,3,0,0,0x80,0,0,0xff,0x66]})),/second RF5C164 sample bank/);
  assert.throws(()=>inspectGenesisPreview(vgm({rf:12500000,commands:[0x68,0x66,0x82,0,0,0,0,0,0,1,0,0,0x66]})),/PCM RAM target/);
  assert.throws(()=>inspectGenesisPreview(vgm({rf:12500000,commands:[0x90,0,0x10,0,0,0x66]})),/DAC stream chip type 0x10/);
  assert.throws(()=>inspectGenesisPreview(vgm({commands:[0x90,0,0x11,0,4,0x66]})),/32X PWM clock/);
});

for(const [name,file]of [['Mega CD RF5C164','genesis-pcm'],['32X PWM stream','pwm-stream']]){
  test(`${name} playback creates its actual WASM chip and produces sustained PCM`,async()=>{
    const host=audioHost(),preview=createSynthSongPreview({getAudio:()=>host});
    try{
      preview.load(new Uint8Array(await readFile(new URL(`../../test/fixtures/${file}.vgm`,import.meta.url))),file+'.vgm');
      assert.equal(await preview.play(),true);
      assert.equal(preview.getState().playback,'playing');
      assert(host.starts.length>1);
      const values=host.starts.flatMap(node=>Array.from(node.buffer.getChannelData(0)));
      const first=1024,count=values.length-first;
      const mean=values.slice(first).reduce((sum,value)=>sum+value,0)/count;
      const acRms=Math.sqrt(values.slice(first).reduce((sum,value)=>sum+(value-mean)**2,0)/count);
      assert(values.every(Number.isFinite));
      assert(acRms>.001,`Expected ${name} AC audio, got ${acRms}`);
      preview.pause();assert.equal(preview.getState().playback,'paused');
      assert(host.starts.every(node=>node.stopped));
      await preview.resume();assert.equal(preview.getState().playback,'playing');
      preview.stop();assert.equal(preview.getState().consumedFrames,0);
    }finally{preview.dispose();}
  });
}

test('reference mix changes future PCM without discarding queued audio, Live state or the paused position',async()=>{
  const host=audioHost(),preview=createSynthSongPreview({getAudio:()=>host});
  const bytes=vgm({clock:0,psg:3579545,commands:[
    0x50,0x8c,0x50,0x1f,0x50,0x90,0x61,0x44,0xac,0x66]});
  const nonzero=nodes=>nodes.some(node=>node.buffer.getChannelData(0).some(value=>Math.abs(value)>.001));
  const quiet=nodes=>nodes.length>0&&nodes.every(node=>node.buffer.getChannelData(0).every(value=>value===0));
  try {
    preview.load(bytes,'tone.vgm');
    assert.deepEqual(preview.getState().mix.channels,[],'selection never initializes audio or parses the file');
    await preview.play();
    const deadline=Date.now()+1000;
    while(!host.starts.length&&Date.now()<deadline)await tick();
    assert(nonzero(host.starts),'actual PSG tone is present before mute');
    assert.deepEqual(preview.getState().mix.channels.map(channel=>channel.id),['psg:0','psg:1','psg:2','psg:3']);
    const originalNodes=[...host.starts],position=preview.getState().consumedFrames;
    preview.setChannelMuted('psg:0',true);
    assert.equal(preview.getState().consumedFrames,position,'mute does not seek or skip commands');
    assert(originalNodes.every(node=>!node.stopped),'scheduled PCM is not discarded on mute');
    assert(nonzero(originalNodes),'already scheduled audio remains the original PCM');
    host.context.currentTime=.14;
    const mutedFrom=host.starts.length;await tick();
    assert(host.starts.length>mutedFrom);
    assert(quiet(host.starts.slice(-1)),'after the small parser queue drains, newly generated actual PCM is silent, including absent YM2612 DC');
    preview.pause();
    const paused=preview.getState().consumedFrames,pausedNodes=[...host.starts];
    preview.setChannelMuted('psg:1',true);
    assert.equal(preview.getState().consumedFrames,paused);
    assert.equal(host.starts.length,pausedNodes.length,'a paused mix edit never renders or starts audio');
    assert.equal(preview.getState().mix.channels[0].effectiveMuted,true,'the earlier mute remains independent of another channel');
    await preview.resume();
    assert.equal(preview.getState().consumedFrames,paused,'Resume keeps the exact pause position');
    preview.resetMix();
    const unmutedFrom=host.starts.length;
    host.context.currentTime+=.14;await tick();
    assert(nonzero(host.starts.slice(unmutedFrom)),'unmute resumes the existing oscillator without replaying the source');
    assert.equal(preview.getState().liveState,null,'PSG mix never fabricates a YM2612 Live snapshot');
    assert.throws(()=>preview.setChannelMuted('ym2612:0',true),/Unknown reference channel/);
    assert.throws(()=>preview.setChannelMuted('psg:0',1),/boolean/);
  } finally {preview.dispose();}
});

test('mix choices survive Stop and replay of the same source but clear for a different file',async()=>{
  const host=audioHost(),preview=createSynthSongPreview({getAudio:()=>host});
  try {
    preview.load(vgm(),'first.vgm');await preview.play();
    preview.setChannelMuted('ym2612:5',true);preview.setChannelMuted('psg:3',true);
    preview.setGroupVolume('ym2612',2);preview.setGroupVolume('psg',.4);
    const chosen=preview.getState().mix;
    preview.stop();assert.equal(preview.getState().mix,chosen);
    await preview.play();assert.equal(preview.getState().mix,chosen);
    assert.deepEqual(preview.getState().mix.groups.map(({id,volume})=>[id,volume]),[['ym2612',2],['psg',.4]]);
    preview.load(vgm({psg:0}),'second.vgm');
    assert.deepEqual(preview.getState().mix.channels,[]);
    await preview.play();
    assert.equal(preview.getState().mix.channels.length,6);
    assert.equal(preview.getState().mix.changed,false,'different source starts with all its own channels audible');
    assert.deepEqual(preview.getState().mix.groups,[{id:'ym2612',label:'YM2612',volume:defaults.ym2612}]);
    preview.setChannelMuted('ym2612:0',true);preview.setGroupVolume('ym2612',0);preview.resetMix();
    assert.equal(preview.getState().mix.changed,false);
    preview.clear();assert.deepEqual(preview.getState().mix.channels,[]);
  } finally {preview.dispose();}
  assert.throws(()=>preview.setChannelMuted('ym2612:0',true),/disposed/);
  assert.throws(()=>preview.setGroupVolume('ym2612',1),/disposed/);
});

test('source volume changes affect future actual PSG PCM, preserve the queued prefix, and wait during Pause',async()=>{
  const host=audioHost(),preview=createSynthSongPreview({getAudio:()=>host});
  const bytes=vgm({clock:0,psg:3579545,commands:[
    0x50,0x8c,0x50,0x1f,0x50,0x90,0x61,0x44,0xac,0x66]}),original=bytes.slice();
  const peak=nodes=>nodes.reduce((maximum,node)=>node.buffer.getChannelData(0).reduce((m,value)=>Math.max(m,Math.abs(value)),maximum),0);
  try {
    preview.load(bytes,'gain.vgm');await preview.play();
    const deadline=Date.now()+1000;
    while(!host.starts.length&&Date.now()<deadline)await tick();
    assert(peak(host.starts)>.001,'the source has actual PSG audio');
    const initial=[...host.starts],initialPcm=initial.map(node=>node.buffer.getChannelData(0).slice()),position=preview.getState().consumedFrames;
    const baseline=peak(initial),master=host.gains[0].gain.value;
    preview.setGroupVolume('psg',0);
    assert.equal(preview.getState().consumedFrames,position);
    assert.equal(host.gains[0].gain.value,master,'source volume is independent of Master');
    assert(initial.every(node=>!node.stopped),'gain edits do not flush already queued audio');
    initial.forEach((node,index)=>assert.deepEqual(node.buffer.getChannelData(0),initialPcm[index]));
    host.context.currentTime=.14;await tick();
    assert.equal(peak(host.starts.slice(-1)),0,'newly generated PCM uses the zero gain after the parser prefix drains');
    const retained=host.starts.filter(node=>node.when+node.buffer.length/node.buffer.sampleRate>host.context.currentTime);
    const retainedPcm=retained.map(node=>node.buffer.getChannelData(0).slice());
    preview.pause();const paused=preview.getState().consumedFrames,count=host.starts.length;
    preview.setGroupVolume('psg',.5);
    assert.equal(host.starts.length,count,'paused gain edits do not render or schedule audio');
    assert.equal(preview.getState().consumedFrames,paused);
    const beforeInvalid=preview.getState().mix;
    for(const gain of [-1,4,NaN,'1'])assert.throws(()=>preview.setGroupVolume('psg',gain),/0\.\.3\.8/);
    assert.throws(()=>preview.setGroupVolume('pwm',1),/Unknown reference volume group/);
    assert.equal(preview.getState().mix,beforeInvalid,'invalid gain edits are atomic');
    await preview.resume();assert.equal(preview.getState().consumedFrames,paused);
    const resumePrefix=host.starts.slice(count,count+retained.length);
    assert(resumePrefix.length>0);
    assert.deepEqual(resumePrefix.map(node=>node.buffer),retained.map(node=>node.buffer),
      'Resume first keeps the exact queued prefix rather than regenerating it at the new gain');
    resumePrefix.forEach((node,index)=>assert.deepEqual(node.buffer.getChannelData(0),retainedPcm[index]));
    host.context.currentTime+=.14;await tick();
    assert(Math.abs(peak(host.starts.slice(-1))/baseline-.5/defaults.psg)<1e-6,'50% is an absolute source gain relative to the calibrated starting balance');
    const current=preview.getState().consumedFrames;
    preview.setGroupVolume('psg',3.8);
    assert.equal(preview.getState().consumedFrames,current);
    host.context.currentTime+=.14;await tick();
    assert(Math.abs(peak(host.starts.slice(-1))/baseline-3.8/defaults.psg)<1e-5,'380% is an absolute source gain');
    assert.deepEqual(bytes,original,'the source VGM is unchanged');
  } finally {preview.dispose();}
});

test('group gain never changes the written-register Live snapshot, channel mutes or original FM data',async()=>{
  const host=audioHost(),preview=createSynthSongPreview({getAudio:()=>host}),commands=[];
  for(const slot of [0,8,4,12])for(const [register,value]of [[0x30,1],[0x40,slot===12?16:127],[0x50,31],[0x60,0],[0x70,0],[0x80,15]]) {
    commands.push(0x52,register+slot,value);
  }
  for(const [register,value]of [[0xb0,7],[0xb4,0xc0],[0xa4,0x24],[0xa0,0x40],[0x28,0x80]])commands.push(0x52,register,value);
  commands.push(0x61,0x44,0xac,0x66);
  const bytes=vgm({psg:0,commands}),original=bytes.slice();
  try {
    preview.load(bytes,'fm-gain.vgm');await preview.play();
    const deadline=Date.now()+1000;
    while(!host.starts.length&&Date.now()<deadline)await tick();
    host.context.currentTime=.04;preview.pause();
    const before=structuredClone(preview.getState().liveState),position=preview.getState().consumedFrames,nodes=host.starts.length;
    assert(before?.channels[0].keyMask,'the source snapshot has an audible FM voice');
    preview.setChannelMuted('ym2612:0',true);
    preview.setGroupVolume('ym2612',0);preview.setGroupVolume('ym2612',3.8);
    assert.equal(preview.getState().mix.channels[0].muted,true,'gain edits retain independent channel mutes');
    assert.deepEqual(preview.getState().liveState,before);
    assert.equal(preview.getState().consumedFrames,position);assert.equal(host.starts.length,nodes);
    preview.resetMix();
    assert.deepEqual(preview.getState().liveState,before,'Reset changes only listening choices');
    assert.equal(preview.getState().mix.groups[0].volume,defaults.ym2612);
    assert.equal(preview.getState().mix.channels[0].muted,false);
    assert.deepEqual(bytes,original);
  } finally {preview.dispose();}
});

function waitCommands(seconds) {
  const commands=[];
  for(let remaining=Math.round(seconds*44100);remaining>0;) {
    const samples=Math.min(65535,remaining);commands.push(0x61,samples&255,samples>>8);remaining-=samples;
  }
  return commands;
}
function longPsgSong(seconds=20) {
  return vgm({clock:0,commands:[0x50,0x8c,0x50,0x1f,0x50,0x90,...waitCommands(seconds),0x66],durationSamples:seconds*44100});
}
test('loading VGM and VGZ prepares a known duration without audio; stale metadata and unknown durations stay safe',async()=>{
  let requests=0;const host=audioHost(),preview=createSynthSongPreview({getAudio:()=>{requests++;return host;}});
  try {
    const first=preview.load(new Uint8Array(gzipSync(longPsgSong(20))),'old.vgz');
    const latest=preview.load(longPsgSong(12),'new.vgm');
    assert.equal(await first,false);assert.equal(await latest,true);
    assert.equal(requests,0);assert.equal(host.starts.length,0);
    assert.equal(preview.getState().durationSeconds,12);assert.equal(preview.getState().seekable,true);
    assert.equal(preview.getState().name,'new.vgm');assert.deepEqual(preview.getState().cache,
      {enabled:true,supported:false,count:0,bytes:0,maxBytes:32*1024*1024,maxCount:120,lastRestoreFrame:0});
    const unknown=longPsgSong(2);new DataView(unknown.buffer).setUint32(0x18,0,true);
    await preview.load(unknown,'unknown.vgm');assert.equal(preview.getState().seekable,false);
    assert.equal(await preview.seek(10),true,'an API seek with no declared duration stops at actual EOF');
    assert.equal(preview.getState().playback,'paused');assert(Math.abs(preview.getState().positionSeconds-2)<.001);
    assert.equal(preview.getState().durationKnown,true);
  } finally {preview.dispose();}
});

test('seeks at time zero and exact event boundaries show the next sample settings without scheduling audio; EOF and invalid targets clamp safely',async()=>{
  const f=fixture();
  const bytes=vgm({psg:0,commands:[0x52,0xb0,7,0x52,0xb4,0xc0,0x52,0xa4,0x24,0x52,0xa0,0x40,
    0x52,0x28,0x80,...waitCommands(6),0x52,0xa0,0x80,0x52,0x28,0x40,...waitCommands(1),0x66],durationSamples:7*44100});
  try {
    await f.preview.load(bytes,'boundaries.vgm');await f.preview.seek(0);
    let state=f.preview.getState();
    assert.equal(state.playback,'paused');assert.equal(state.positionFrames,0);
    assert.equal(state.liveState.channels[0].keyMask,8,'zero-time initialization is visible before the first audible sample');
    assert.equal(f.host.starts.length,0);assert.equal(state.cache.supported,false,'unsupported engines retain a correct cold-replay fallback');
    await f.preview.seek(6);state=f.preview.getState();
    assert.equal(state.positionFrames,6*44100);assert.equal(state.liveState.channels[0].keyMask,4);
    assert.equal(state.liveState.channels[0].fnum,0x480);assert.equal(state.liveState.channels[0].keyOnCount,2);
    assert.equal(f.host.starts.length,0);
    for(const invalid of [-1,NaN,Infinity,'2',null])await assert.rejects(f.preview.seek(invalid),/finite nonnegative/);
    assert.equal(f.preview.getState().positionFrames,6*44100,'invalid seeks do not cancel or move the current voice');
    await f.preview.seek(999);state=f.preview.getState();
    assert.equal(state.playback,'paused');assert.equal(state.positionSeconds,7);
    await f.preview.play();const old=[...f.host.starts];await f.preview.seek(999);
    assert.equal(f.preview.getState().playback,'ended','a playing seek to actual EOF has no audio left to resume');
    assert(old.every(node=>node.stopped));assert.equal(f.preview.getState().positionSeconds,7);
  } finally {f.preview.dispose();}
});

function statefulEngine({rate=1000,stateBytes=128,slow=false}={}) {
  let phase=0;const saved=new WeakMap();
  return {disposed:0,reset(){phase=0;},sampleRate:()=>rate,writeYm2612(){},writePsg(){},supportsState:()=>true,stateSettingsKey:()=>String(rate),
    saveState(){const state=Object.freeze({byteLength:stateBytes});saved.set(state,phase);return state;},
    validateState(state){if(!saved.has(state))throw new Error('foreign state');},
    loadState(state){this.validateState(state);phase=saved.get(state);},
    processFrames(frames){
      if(slow){const until=performance.now()+.15;while(performance.now()<until){}}
      const left=Float32Array.from({length:frames},()=>((phase++%100)/100-.5)*.1);return {left,right:left.slice()};
    },dispose(){this.disposed++;}};
}

test('seek cache stays inside count and byte budgets and Off retains no hidden snapshots',async()=>{
  for(const stateBytes of [128,8*1024*1024]) {
    const host=audioHost(),engine=statefulEngine({stateBytes}),preview=createSynthSongPreview({getAudio:()=>host,createEngine:async()=>engine});
    try {
      await preview.load(longPsgSong(1300),'long.vgm');await preview.seek(1250);
      const stats=preview.getState().cache;
      assert(stats.bytes<=stats.maxBytes&&stats.count<=stats.maxCount);
      if(stateBytes===128)assert.equal(stats.count,120,'a long source evicts its oldest checkpoints at the count bound');
      else assert(stats.count>0&&stats.count<5,'large snapshots reach the byte budget before the count budget');
      preview.stop();assert.equal(preview.getState().cache.count,stats.count);
      await preview.play();assert.equal(preview.getState().cache.count,stats.count,'same-source Play resets playback without dropping compatible checkpoints');
      assert.equal(engine.disposed,0,'the same source keeps its checkpoint-owning engine');
      preview.setSeekCacheEnabled(false);assert.equal(preview.getState().cache.bytes,0);
      await preview.seek(900);assert.equal(preview.getState().cache.count,0);
      preview.setSeekCacheEnabled(true);await preview.seek(10);assert(preview.getState().cache.count>0);
      assert.throws(()=>preview.setSeekCacheEnabled(1),/boolean/);
      preview.clear();assert.equal(engine.disposed,1);assert.equal(preview.getState().cache.count,0);
    } finally {preview.dispose();}
  }
});

test('seek requests its trusted context before recorder shutdown, and a newer seek bypasses stale pending engine creation',async()=>{
  const host=audioHost(),order=[],old=statefulEngine({rate:44100}),latest=statefulEngine({rate:44100});
  let resolveOld,calls=0;
  host.context.resume=async()=>{order.push('context');};
  const preview=createSynthSongPreview({getAudio:()=>{order.push('audio');return host;},
    beforeResume:async()=>{order.push('shutdown');},
    createEngine:async()=>++calls===1?new Promise(resolve=>{resolveOld=resolve;}):latest});
  try {
    await preview.load(longPsgSong(10),'pending.vgm');const obsolete=preview.seek(3);
    assert.deepEqual(order.slice(0,3),['audio','context','shutdown']);
    while(!resolveOld)await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(await preview.seek(1.25),true,'a delayed old constructor does not block a newer source operation');
    assert.equal(preview.getState().positionSeconds,1.25);assert.equal(preview.getState().playback,'paused');
    resolveOld(old);assert.equal(await obsolete,false);assert.equal(old.disposed,1);assert.equal(latest.disposed,0);
    assert.equal(host.starts.length,0);
  } finally {preview.dispose();}
  assert.equal(latest.disposed,1);
});

test('seek cancellation covers waiting audio, latest in-place target, Stop, source replacement and disposal',async()=>{
  let resolveAudio;const delayed=fixture({getAudio:()=>new Promise(resolve=>{resolveAudio=resolve;})});
  try {
    await delayed.preview.load(longPsgSong(10),'delayed.vgm');const pending=delayed.preview.seek(3);
    delayed.preview.stop();resolveAudio(delayed.host);assert.equal(await pending,false);
    assert.equal(delayed.engines.length,0);assert.equal(delayed.preview.getState().playback,'stopped');
  } finally {delayed.preview.dispose();}
  for(const action of ['latest','stop','load','dispose']) {
    const host=audioHost(),engine=statefulEngine({slow:true});let preview,interrupted=false,next;
    preview=createSynthSongPreview({getAudio:()=>host,createEngine:async()=>engine,onState:state=>{
      if(!interrupted&&state.seeking&&state.seekProgress>0&&state.seekProgress<1) {
        interrupted=true;
        if(action==='latest')next=preview.seek(1.25);
        else if(action==='stop')preview.stop();
        else if(action==='load')next=preview.load(longPsgSong(2),'new.vgm');
        else preview.dispose();
      }
    }});
    try {
      await preview.load(longPsgSong(1300),'old.vgm');const first=preview.seek(1200);
      assert.equal(await first,false,'an interrupted seek cannot commit its old target');if(next)await next;
      assert(interrupted,'the long silent renderer yielded for user input');
      assert.equal(host.starts.length,0,'a cancelled stopped-song seek cannot start audio');
      if(action==='latest'){assert.equal(preview.getState().playback,'paused');assert.equal(preview.getState().positionSeconds,1.25);}
      else {assert.equal(preview.getState().playback,'stopped');assert.equal(preview.getState().positionSeconds,0);}
      if(action==='load')assert.equal(preview.getState().name,'new.vgm');
      if(action==='load'||action==='dispose')assert.equal(engine.disposed,1);
    } finally {preview.dispose();}
  }
});
