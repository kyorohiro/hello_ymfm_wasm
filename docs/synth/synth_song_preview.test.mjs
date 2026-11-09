import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {createSynthSongPreview, inspectGenesisPreview} from './synth_song_preview.js';

function vgm({clock=7670454, psg=3579545, otherClock=0, rf=0, pwm=0, command=0x52, commands:providedCommands}={}) {
  const commands = providedCommands ?? [command,0xb0,4,0x61,0x44,0xac,0x66];
  const bytes = new Uint8Array(256 + commands.length), view = new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);
  view.setUint32(4, bytes.length-4, true);
  view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 204, true);
  view.setUint32(0x18, 44100, true);
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
function fixture({getAudio, createEngine}={}) {
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
    onState:state=>states.push(state),onStatus:message=>statuses.push(message)});
  return {host,engines,states,statuses,preview};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,35));

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
    f.host.context.currentTime=.075;
    const consumed=f.preview.getState().consumedFrames;assert(consumed>0);
    f.preview.pause();const frozen=f.preview.getState();
    assert.equal(frozen.playback,'paused');assert.equal(frozen.positionFrames,consumed);
    const initialNodes=[...f.host.starts];assert(initialNodes.every(node=>node.stopped));
    f.host.context.currentTime=5;await tick();
    assert.equal(f.preview.getState().consumedFrames,consumed);
    await f.preview.resume();assert.equal(f.preview.getState().playback,'playing');
    assert.equal(f.engines.length,1,'Resume does not recreate or rewind the engine');
    const resumed=f.host.starts[initialNodes.length], cumulativeFrames=initialNodes[0].buffer.length;
    assert.equal(resumed.buffer,initialNodes[1].buffer,'Resume keeps the partially heard PCM buffer');
    assert(Math.abs(resumed.offset-(consumed-cumulativeFrames)/44100)<1e-12);
    f.host.context.currentTime=5.05;assert(f.preview.getState().consumedFrames>consumed);
    f.preview.stop();assert.equal(f.preview.getState().positionFrames,0);
    assert.equal(f.engines[0].disposed,1);assert(f.host.starts.every(node=>node.stopped||node.disconnected));
  }finally{f.preview.dispose();}
});

test('natural EOF drains scheduled samples before releasing the engine',async()=>{
  const f=fixture();
  try{
    f.preview.load(vgm(),'song.vgm');await f.preview.play();
    assert.equal(f.preview.getState().playback,'playing');
    for(let step=0;step<20&&f.preview.getState().playback==='playing';step++){
      f.host.context.currentTime+=.1;await tick();
    }
    const state=f.preview.getState();assert.equal(state.playback,'ended');
    assert.equal(state.positionFrames,44100);assert.equal(state.positionSeconds,1);
    assert.equal(f.engines[0].disposed,1);assert.equal(f.preview.getState().hasSource,true);
  }finally{f.preview.dispose();}
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
