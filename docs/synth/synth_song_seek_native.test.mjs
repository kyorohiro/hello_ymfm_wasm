import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSynthSongPreview} from './synth_song_preview.js';
import {GenesisAudioEngine} from '../js/genesisaudioengine.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import ymFactory from '../generated/ym2612_wasm.js';
import psgFactory from '../generated/segapsg_wasm.js';
import pcmFactory from '../generated/rf5c164_wasm.js';
import {createYm2612SongTimeline} from './synth_song_state.js';
import {installSynthSongOutputMix} from './synth_song_output_mix.js';

const wasm=Object.fromEntries(await Promise.all(['ym2612','segapsg','rf5c164'].map(async id=>
  [id,await readFile(new URL(`../generated/${id}_wasm.wasm`,import.meta.url))])));
const nativeEngine=()=>GenesisAudioEngine.create({
  ym2612ModuleFactory:ymFactory,ym2612ModuleOptions:{wasmBinary:wasm.ym2612},
  segaPsgModuleFactory:psgFactory,segaPsgModuleOptions:{wasmBinary:wasm.segapsg},
  rf5c164Clock:12500000,rf5c164ModuleFactory:pcmFactory,rf5c164ModuleOptions:{wasmBinary:wasm.rf5c164},
  pwmModel:'mame',pwmClock:23011361,pwmOutputMode:'duty',
});
const sameLiveSource=(actual,expected)=>{
  // revision invalidates a local decoded-view cache. Replaying from zero may
  // reset that decoder more often than loading a checkpoint; source state,
  // source key-on counts and the audible frame must still match exactly.
  const {revision:actualRevision,...actualSource}=actual;
  const {revision:expectedRevision,...expectedSource}=expected;
  assert.deepEqual(actualSource,expectedSource);
};
const samePcm=(actual,expected,label)=>{
  for(const side of ['left','right']) {
    assert.equal(actual[side].length,expected[side].length);
    const first=actual[side].findIndex((value,index)=>value!==expected[side][index]);
    assert.equal(first,-1,`${label}: first unequal ${side} sample ${first}; actual=${actual[side][first]}, expected=${expected[side][first]}`);
  }
};

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

const tick=()=>new Promise(resolve=>setTimeout(resolve,35));

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

function longPcmSong(seconds=20) {
  const commands=[0xb1,7,0x80];
  for(let index=0;index<128;index++)commands.push(0xc2,index,0,index<64?(index%32<16?0xd0:0x50):255);
  commands.push(0xb1,7,0xc0,0xb1,0,192,0xb1,1,0xff,0xb1,2,0,0xb1,3,8,
    0xb1,4,0,0xb1,5,0,0xb1,6,0,0xb1,8,0xfe,
    0xb1,7,0xc5,0xb1,0,17,0xb1,7,0x83,...waitCommands(seconds),0x66);
  return vgm({clock:0,psg:0,rf:12500000,commands,durationSamples:seconds*44100});
}

async function mixedNativeSong() {
  const fixtureCommands=[];let fixtureSamples=0;
  for(const name of ['genesis-pcm','pwm-stream']) {
    const bytes=new Uint8Array(await readFile(new URL(`../../test/fixtures/${name}.vgm`,import.meta.url)));
    const view=new DataView(bytes.buffer),start=view.getUint32(0x34,true)+0x34;
    assert.equal(bytes.at(-1),0x66);fixtureCommands.push(...bytes.subarray(start,bytes.length-1));fixtureSamples+=view.getUint32(0x18,true);
  }
  const commands=[...fixtureCommands];
  for(const slot of [0,8,4,12])for(const [register,value]of [[0x30,1],[0x40,slot===12?16:127],[0x50,31],[0x60,2],[0x70,1],[0x80,0x27]])commands.push(0x52,register+slot,value);
  commands.push(0x52,0xb0,7,0x52,0xb4,0xc0,0x52,0xa4,0x24,0x52,0xa0,0x40,0x52,0x28,0x80,
    0x50,0x8c,0x50,0x1f,0x50,0x90,...waitCommands(6),
    0x52,0xa4,0x25,0x52,0xa0,0x40,...waitCommands(6),
    0x52,0x40+12,24,0x52,0xa4,0x26,0x52,0xa0,0x40,...waitCommands(5),0x66);
  return vgm({rf:12500000,pwm:23011361,commands,durationSamples:fixtureSamples+17*44100});
}
async function renderedPrefix(host,from,frames=4096) {
  const deadline=Date.now()+1000;
  while(host.starts.slice(from).reduce((sum,node)=>sum+node.buffer.length,0)<frames&&Date.now()<deadline) {
    // Budgeted rendering may fill the lookahead with fewer than 4096 frames.
    // Advance this fake audio clock so the scheduler can refill that prefix.
    host.context.currentTime+=.01;
    await tick();
  }
  const left=new Float32Array(frames),right=new Float32Array(frames);let offset=0;
  for(const node of host.starts.slice(from)) {
    const count=Math.min(node.buffer.length,frames-offset);
    left.set(node.buffer.getChannelData(0).subarray(0,count),offset);
    right.set(node.buffer.getChannelData(1).subarray(0,count),offset);
    offset+=count;if(offset===frames)break;
  }
  assert.equal(offset,frames,'the real player supplied the required output prefix');
  return {left,right};
}


test('real FM/PSG/RF/PWM seeks restore cached PCM and Live exactly, retain Stop cache, and invalidate only source listening changes',async()=>{
  const first=audioHost(),second=audioHost(),bytes=await mixedNativeSong(),original=bytes.slice();
  const cached=createSynthSongPreview({getAudio:()=>first}),cold=createSynthSongPreview({getAudio:()=>second,seekCacheEnabled:false});
  try {
    await Promise.all([cached.load(bytes,'mixed.vgm'),cold.load(bytes,'mixed.vgm')]);
    assert.equal(await cached.seek(13.123),true);assert.equal(cached.getState().playback,'paused');
    const warm=cached.getState().cache;
    assert(warm.supported&&warm.count>=2&&warm.bytes>0,'a cold long seek creates native snapshots');
    assert(warm.bytes<=warm.maxBytes&&warm.count<=warm.maxCount);
    assert.equal(first.starts.length,0,'seeking a stopped song renders silently until Resume');
    cached.setVolume(2);assert.equal(cached.getState().cache.count,warm.count,'Master is outside cached PCM');
    cached.stop();assert.equal(cached.getState().positionSeconds,0);assert.equal(cached.getState().cache.count,warm.count);
    assert.equal(await cached.seek(7.234),true);assert(cached.getState().cache.lastRestoreFrame>0,'the same-source Stop keeps a reusable checkpoint');
    assert.equal(await cold.seek(7.234),true);assert.equal(cold.getState().cache.count,0);
    assert.deepEqual(cached.getState().liveState,cold.getState().liveState,'cached seek restores the exact written FM state');
    assert.equal(cached.getState().positionFrames,cold.getState().positionFrames);
    let a=first.starts.length,b=second.starts.length;
    await cached.resume();await cold.resume();
    let [actual,expected]=await Promise.all([renderedPrefix(first,a),renderedPrefix(second,b)]);
    samePcm(actual,expected,'cached and cold native PCM match, including all four renderers');
    assert(actual.left.some(value=>Math.abs(value)>.001));
    const old=[...first.starts];a=first.starts.length;b=second.starts.length;
    await cached.seek(10.321);await cold.seek(10.321);
    assert.equal(cached.getState().playback,'playing','a playing seek resumes from the target');
    assert(old.every(node=>node.stopped),'no previous-position AudioBufferSource remains scheduled');
    sameLiveSource(cached.getState().liveState,cold.getState().liveState);
    [actual,expected]=await Promise.all([renderedPrefix(first,a),renderedPrefix(second,b)]);samePcm(actual,expected,'a repeated playing seek keeps the same native EG phase');
    cached.pause();cold.pause();
    const paused=cached.getState().positionFrames;
    cached.setChannelMuted('ym2612:0',true);cold.setChannelMuted('ym2612:0',true);
    cached.setGroupVolume('pcm',.53);cold.setGroupVolume('pcm',.53);
    assert.equal(cached.getState().cache.count,0,'mute/gain edits discard snapshots with older native pan or PCM');
    assert.equal(cached.getState().positionFrames,paused,'mix edits do not seek');
    await cached.seek(7.234);await cold.seek(7.234);assert.equal(cached.getState().cache.lastRestoreFrame,0,'changed settings replay cold');
    sameLiveSource(cached.getState().liveState,cold.getState().liveState);
    assert.equal(cached.getState().mix.channels.find(channel=>channel.id==='ym2612:0').muted,true);
    assert.equal(cached.getState().mix.groups.find(group=>group.id==='pcm').volume,.53);
    assert.equal(first.gains[0].gain.value,2,'Master remains outside native checkpoint state');
    a=first.starts.length;b=second.starts.length;await cached.resume();await cold.resume();
    [actual,expected]=await Promise.all([renderedPrefix(first,a),renderedPrefix(second,b)]);samePcm(actual,expected,'changed listening settings seek with the same native source state');
    cached.pause();await cached.seek(13.123);assert(cached.getState().cache.count>0);
    cached.setSeekCacheEnabled(false);assert.equal(cached.getState().cache.count,0);assert.equal(cached.getState().cache.bytes,0);
    await cached.seek(13.8);assert.equal(cached.getState().cache.lastRestoreFrame,0);assert.equal(cached.getState().cache.count,0);
    assert.equal(cached.getState().cache.supported,true,'cache support and the user toggle remain independent');
    assert.deepEqual(bytes,original);
    await cached.load(longPsgSong(1),'other.vgm');assert.equal(cached.getState().cache.bytes,0);assert.equal(cached.getState().cache.supported,false);
    cached.clear();assert.equal(cached.getState().hasSource,false);
  } finally {cached.dispose();cold.dispose();}
});

test('cold and cached mixed native seeks match uninterrupted linear playback at the destination',async()=>{
  const source=await mixedNativeSong(),host=audioHost(),preview=createSynthSongPreview({getAudio:()=>host,createEngine:nativeEngine});
  const engine=await nativeEngine(),outputMix=installSynthSongOutputMix(engine),timeline=createYm2612SongTimeline(engine),player=new VgmPlayer(engine);
  try {
    await preview.load(source,'linear-reference.vgm');
    // Build later checkpoints, then rewind into the middle of a sounding note.
    await preview.seek(14.2);assert(preview.getState().cache.count>=2);
    await preview.seek(7.234);const state=preview.getState();assert(state.cache.lastRestoreFrame>0);
    player.setPrefetchFactor(1);player.setLoopEnabled(false);player.load(source,{logger:null});player.play();
    const left=new Float32Array(4096),right=new Float32Array(4096);let consumed=0;
    while(consumed<state.positionFrames) {
      const count=Math.min(left.length,state.positionFrames-consumed),frames=player.process(left,right,count);
      assert(frames>0,'the linear reference reaches the requested destination');consumed+=frames;
    }
    sameLiveSource(state.liveState,timeline.read(consumed));
    const expected={left:new Float32Array(4096),right:new Float32Array(4096)};
    assert.equal(player.process(expected.left,expected.right,4096),4096);
    const start=host.starts.length;await preview.resume();const actual=await renderedPrefix(host,start);
    samePcm(actual,expected,'warm cached seek vs uninterrupted native playback');
    preview.pause();preview.setSeekCacheEnabled(false);
    await preview.seek(7.234);assert.equal(preview.getState().cache.count,0);assert.equal(preview.getState().cache.lastRestoreFrame,0);
    sameLiveSource(preview.getState().liveState,state.liveState);
    const second=host.starts.length;await preview.resume();
    samePcm(await renderedPrefix(host,second),expected,'cold repeated seek vs uninterrupted native playback');
  } finally {preview.dispose();timeline.dispose();outputMix.dispose();engine.dispose();}
});

test('manual FM edits reach real reference PCM at bounded latency and source seek cannot restore an edited checkpoint',async()=>{
  const host=audioHost(),controlHost=audioHost(),preview=createSynthSongPreview({getAudio:()=>host}),
    control=createSynthSongPreview({getAudio:()=>controlHost,seekCacheEnabled:false});
  const commands=[];
  for(const slot of [0,8,4,12])for(const [register,value]of [[0x30,1],[0x40,slot===12?16:127],[0x50,31],[0x60,0],[0x70,0],[0x80,0x07]])commands.push(0x52,register+slot,value);
  commands.push(0x52,0xb0,7,0x52,0xb4,0xc0,0x52,0xa4,0x24,0x52,0xa0,0x40,
    0x52,0x28,0x80,...waitCommands(12),0x66);
  const source=vgm({psg:0,commands,durationSamples:12*44100}),original=source.slice();
  const peak=nodes=>nodes.reduce((maximum,node)=>node.buffer.getChannelData(0).reduce((value,item)=>Math.max(value,Math.abs(item)),maximum),0);
  const span=nodes=>{const samples=nodes.flatMap(node=>Array.from(node.buffer.getChannelData(0)));return Math.max(...samples)-Math.min(...samples);};
  try {
    await preview.load(source,'native-manual.vgm');await control.load(source,'native-manual.vgm');
    await preview.seek(10.25);assert(preview.getState().cache.count>=2);
    await preview.resume();let state=preview.getState();
    assert(state.manualReady);assert(state.manualLatencySeconds<.11,'silent seek bounds native prefetch before manual input');
    const originalNodes=[...host.starts],before=span(originalNodes);assert(peak(originalNodes)>.001&&before>.001);
    preview.editFm({channel:0,changes:{'operators.4.tl':127}});
    assert.equal(preview.getState().cache.count,0);assert.equal(preview.getState().cache.manualDirty,true);
    for(let step=0;step<4;step++){host.context.currentTime+=.04;await tick();}
    const after=span(host.starts.slice(-1));
    assert(after<before*.01,`the edited carrier changes new real-WASM PCM on the same transport (AC span ${before} -> ${after})`);
    assert(originalNodes.every(node=>!node.stopped),'no queued song buffer is flushed for a knob edit');
    assert.equal(host.gains[0].gain.value,1);assert(preview.getState().manualLatencySeconds<.11);
    preview.pause();await preview.seek(6.25);await control.seek(6.25);
    state=preview.getState();assert.equal(state.cache.manualDirty,false);assert(state.cache.count>0);
    sameLiveSource(state.liveState,control.getState().liveState);
    const start=host.starts.length,controlStart=controlHost.starts.length;
    await preview.resume();await control.resume();
    samePcm(await renderedPrefix(host,start),await renderedPrefix(controlHost,controlStart),'source seek after a hand edit vs unedited cold native playback');
    assert.deepEqual(source,original);
  } finally {preview.dispose();control.dispose();}
});

test('manual PSG edits reach the same native output and source seek restores exact cold PCM with PSG-only headers',async()=>{
  const host=audioHost(),controlHost=audioHost(),preview=createSynthSongPreview({getAudio:()=>host}),
    control=createSynthSongPreview({getAudio:()=>controlHost,seekCacheEnabled:false});
  const source=longPsgSong(12),original=source.slice();
  const span=nodes=>{
    let min=Infinity,max=-Infinity;
    for(const node of nodes)for(const value of node.buffer.getChannelData(0)){min=Math.min(min,value);max=Math.max(max,value);}
    return max-min;
  };
  try {
    await preview.load(source,'native-PSG-manual.vgm');await control.load(source,'native-PSG-control.vgm');
    await preview.seek(10.25);assert(preview.getState().cache.count>=2);await preview.resume();
    let state=preview.getState();assert.equal(state.manualReady,false);assert.equal(state.psgManualReady,true);
    assert.equal(state.liveState,null);assert(state.psgManualLatencySeconds<.11);
    const originalNodes=[...host.starts],before=span(originalNodes);assert(before>.001);
    preview.applyPsgPreset(0,{attenuation:15});
    assert.equal(preview.getState().cache.manualDirty,true);assert.equal(preview.getState().cache.count,0);
    for(let step=0;step<4;step++){host.context.currentTime+=.04;await tick();}
    const after=span(host.starts.slice(-1));assert(after<before*.01,`native PSG hand edit reduces AC span ${before} -> ${after}`);
    assert(originalNodes.every(node=>!node.stopped),'manual PSG edits do not flush pre-rendered song output');
    assert.equal(host.gains[0].gain.value,1);assert(preview.getState().psgManualLatencySeconds<.11);
    preview.pause();await preview.seek(6.25);await control.seek(6.25);
    state=preview.getState();assert.equal(state.cache.manualDirty,false);assert(state.cache.count>0);
    sameLiveSource(state.psgLiveState,control.getState().psgLiveState);
    const start=host.starts.length,controlStart=controlHost.starts.length;await preview.resume();await control.resume();
    samePcm(await renderedPrefix(host,start),await renderedPrefix(controlHost,controlStart),'source seek after PSG manual edit vs original cold native playback');
    assert.deepEqual(source,original);
  } finally {preview.dispose();control.dispose();}
});

test('PSG observation and manual readiness add no writes or PCM changes before intervention',async()=>{
  const source=vgm({clock:0,commands:[0x50,0x8e,0x50,0x0f,0x50,0x94,
    0x50,0xc3,0x50,0x11,0x50,0xd7,0x50,0xe7,0x50,0xf8,...waitCommands(1),0x66]}),
    host=audioHost(),preview=createSynthSongPreview({getAudio:()=>host,createEngine:nativeEngine}),
    engine=await nativeEngine(),outputMix=installSynthSongOutputMix(engine),player=new VgmPlayer(engine);
  try {
    // PSG-only reference files mute the allocated but absent chips, including
    // the YM2612's idle DC component. Match that listening policy explicitly.
    outputMix.setMutedChannels([...[0,1,2,3,4,5].map(ch=>`ym2612:${ch}`),
      ...[0,1,2,3,4,5,6,7].map(ch=>`pcm:${ch}`),...['pwm:0','pwm:1']]);
    player.setPrefetchFactor(1);player.setLoopEnabled(false);player.load(source,{logger:null});player.play();
    const expected={left:new Float32Array(4096),right:new Float32Array(4096)};
    assert.equal(player.process(expected.left,expected.right,4096),4096);
    await preview.load(source,'PSG-unaltered.vgm');await preview.play();
    samePcm(await renderedPrefix(host,0),expected,'PSG helper vs independent native renderer before any hand edit');
    assert.equal(preview.getState().cache.manualDirty,false);
  } finally {preview.dispose();outputMix.dispose();engine.dispose();}
});

test('manual RF5C164 controls use the same native PCM and source seek restores original cold and cached state',async()=>{
  const host=audioHost(),controlHost=audioHost(),preview=createSynthSongPreview({getAudio:()=>host}),
    control=createSynthSongPreview({getAudio:()=>controlHost,seekCacheEnabled:false});
  const source=longPcmSong(14),original=source.slice();
  const span=(nodes,side=0)=>{
    let min=Infinity,max=-Infinity;
    for(const node of nodes)for(const value of node.buffer.getChannelData(side)){min=Math.min(min,value);max=Math.max(max,value);}
    return max-min;
  };
  try {
    await preview.load(source,'native-RF-manual.vgm');await control.load(source,'native-RF-control.vgm');
    await preview.seek(10.25);assert(preview.getState().cache.count>=2);await preview.resume();
    let state=preview.getState();assert.equal(state.manualReady,false);assert.equal(state.psgManualReady,false);
    assert.equal(state.pcmManualReady,true);assert.equal(state.liveState,null);assert.equal(state.psgLiveState,null);
    assert(state.pcmManualLatencySeconds<.11);assert.equal(preview.describePcm(0).playable,true);
    const originalNodes=[...host.starts],before=span(originalNodes);assert(before>.001);
    const selection=[state.pcmLiveState.selectedChannel,state.pcmLiveState.bank,state.pcmLiveState.enabled];
    preview.editPcm({channel:0,changes:{panLeft:0,step:4096}});
    for(let step=0;step<4;step++){host.context.currentTime+=.04;await tick();}
    assert(span(host.starts.slice(-1))<before*.01,'manual pan changes actual native left PCM');
    assert(span(host.starts.slice(-1),1)>.001,'unmodified right pan still passes actual sample playback');
    state=preview.getState();assert.equal(state.pcmLiveState.channels[0].step,4096);
    assert.deepEqual([state.pcmLiveState.selectedChannel,state.pcmLiveState.bank,state.pcmLiveState.enabled],selection);
    preview.applyPcmSettings(0,{volume:0});
    assert.equal(preview.getState().cache.manualDirty,true);assert.equal(preview.getState().cache.count,0);
    for(let step=0;step<4;step++){host.context.currentTime+=.04;await tick();}
    assert(span(host.starts.slice(-1),1)<before*.01,'the next native buffers reflect hardware volume zero');
    assert(originalNodes.every(node=>!node.stopped),'manual RF controls never flush the original audio queue');
    assert.equal(host.gains[0].gain.value,1);assert(preview.getState().pcmManualLatencySeconds<.11);
    preview.pause();await preview.seek(6.25);await control.seek(6.25);
    state=preview.getState();assert.equal(state.cache.manualDirty,false);assert(state.cache.count>0);
    sameLiveSource(state.pcmLiveState,control.getState().pcmLiveState);
    assert.equal(state.pcmLiveState.channels[0].volume,192);assert.equal(state.pcmLiveState.channels[0].step,2048);
    let start=host.starts.length,controlStart=controlHost.starts.length;await preview.resume();await control.resume();
    samePcm(await renderedPrefix(host,start),await renderedPrefix(controlHost,controlStart),'source seek after RF controls vs original cold native PCM');
    preview.pause();control.pause();await preview.seek(5.75);await control.seek(5.75);
    assert(preview.getState().cache.lastRestoreFrame>0,'source-only native checkpoints can be reused after intervention was discarded');
    sameLiveSource(preview.getState().pcmLiveState,control.getState().pcmLiveState);
    start=host.starts.length;controlStart=controlHost.starts.length;await preview.resume();await control.resume();
    samePcm(await renderedPrefix(host,start),await renderedPrefix(controlHost,controlStart),'restored RF cache vs original cold native PCM');
    assert.deepEqual(source,original);
  } finally {preview.dispose();control.dispose();}
});

test('RF-only manual observation leaves original native output bit-exact before intervention',async()=>{
  const source=longPcmSong(1),host=audioHost(),preview=createSynthSongPreview({getAudio:()=>host,createEngine:nativeEngine}),
    engine=await nativeEngine(),outputMix=installSynthSongOutputMix(engine),player=new VgmPlayer(engine);
  try {
    outputMix.setMutedChannels([...[0,1,2,3,4,5].map(ch=>`ym2612:${ch}`),
      ...[0,1,2,3].map(ch=>`psg:${ch}`),...['pwm:0','pwm:1']]);
    player.setPrefetchFactor(1);player.setLoopEnabled(false);player.load(source,{logger:null});player.play();
    const expected={left:new Float32Array(4096),right:new Float32Array(4096)};
    assert.equal(player.process(expected.left,expected.right,4096),4096);
    await preview.load(source,'RF-unaltered.vgm');await preview.play();
    samePcm(await renderedPrefix(host,0),expected,'RF helper vs independent native renderer before any hand edit');
    assert.equal(preview.getState().pcmManualReady,true);assert.equal(preview.getState().cache.manualDirty,false);
  } finally {preview.dispose();outputMix.dispose();engine.dispose();}
});

