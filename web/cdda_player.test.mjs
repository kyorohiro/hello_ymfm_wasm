import test from 'node:test';
import assert from 'node:assert/strict';
import {createCddaPlayer} from './cdda_player.js';

function wav(frames = 100) {
  const bytes = new Uint8Array(44 + frames * 4), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RIFF')); bytes.set(new TextEncoder().encode('WAVEfmt '), 8);
  view.setUint32(4, bytes.length - 8, true); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, 44100, true); view.setUint32(28, 176400, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode('data'), 36); view.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {view.setInt16(44 + i * 4, i * 100 % 20000, true); view.setInt16(46 + i * 4, -i * 50 % 20000, true);}
  return bytes;
}
function deferred() {let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject};}
function adapter() {
  const calls = [], live = new Set();
  let state = 'empty', positionFrames = 0, durationFrames = 0, current = null, disposed = false;
  return {calls,live,
    async prepare(pcm, number) {
      assert(!disposed);
      calls.push(['prepare', number, pcm]);
      live.clear();live.add(pcm);current=number;durationFrames=pcm.length/4;positionFrames=0;state='ready';
    },
    async command(action, timing) {
      assert(!disposed);calls.push(['command', {...action}, timing]);
      if (action.type === 'play') {positionFrames=action.sourceFrame??0;state='playing';}
      if (action.type === 'pause') state='paused';
      if (action.type === 'resume') state='playing';
      if (action.type === 'stop') {state=durationFrames?'ready':'empty';positionFrames=0;}
      if (action.type === 'seek') positionFrames=action.sourceFrame;
      return {state,positionFrames,durationFrames,track:current};
    },
    advance(frames) {if(state==='playing'){positionFrames=Math.min(durationFrames,positionFrames+frames);if(positionFrames===durationFrames)state='ended';}},
    dispose() {if(!disposed){disposed=true;calls.push(['dispose']);live.clear();}},
  };
}
const manifest = {tracks:[{number:2,file:'/disc.wav',startFrame:10,endFrame:70,title:'Track 2'}, {number:3,file:'/disc.wav',startFrame:70,endFrame:100}]};

test('real manifest preparation preserves stereo bytes and presents selected track-relative state', async () => {
  const bytes=wav(), reads=[], device=adapter();
  const player=createCddaPlayer(device,{readFile:async path=>{reads.push(path);return bytes;}});
  const list=await player.load(manifest);
  assert.equal(list,player.list());assert(Object.isFrozen(list));assert.deepEqual(reads,[]);
  await player.play(2,{offset:5/44100,at:1.25});
  assert.deepEqual(reads,['/disc.wav']);
  const prepared=device.calls.find(call=>call[0]==='prepare');
  assert.equal(prepared[1],'2');assert.equal(prepared[2].buffer,bytes.buffer);
  assert.equal(prepared[2].byteOffset,44+10*4);assert.equal(prepared[2].byteLength,60*4);
  assert.deepEqual(device.calls.at(-1),['command',{type:'play',sourceFrame:5},{offset:5/44100,at:1.25}]);
  device.advance(12);
  const status=await player.getState();
  assert.equal(status.positionFrames,17);assert.equal(status.durationFrames,60);assert.equal(status.track,2);assert.equal(status.title,'Track 2');assert.equal(status.tracks,list);
  await player.play();assert.equal(reads.length,1,'replaying the selected track reuses its prepared PCM');
  await player.play(3);assert.equal(reads.length,2);assert.equal((await player.getState()).durationFrames,30);
  assert.equal(device.live.size,1,'replacement retains only the selected PCM');
  player.dispose();assert.equal(device.live.size,0);
});

test('pause/resume/seek/stop forward serialized controls and preserve a track-relative cursor', async () => {
  const device=adapter(),player=createCddaPlayer(device);
  await player.load(wav(44100));await player.play(1,{offset:.1});device.advance(500);
  await player.pause({at:2});const paused=await player.getState();device.advance(1000);
  assert.equal((await player.getState()).positionFrames,paused.positionFrames);
  assert.equal(paused.state,'paused');assert.equal(paused.positionFrames,4910);
  await player.seek(.5,{at:3});assert.equal((await player.getState()).positionFrames,22050);
  await player.resume({at:4});device.advance(100);assert.equal((await player.getState()).positionFrames,22150);
  await player.stop();const stopped=await player.getState();assert.equal(stopped.positionFrames,0);assert.equal(stopped.track,1);
  await player.play(1,{offset:1});assert.equal((await player.getState()).positionFrames,44100);
  assert(device.calls.some(call=>call[0]==='command'&&call[1].type==='pause'&&call[2].at===2));
  assert(device.calls.some(call=>call[0]==='command'&&call[1].type==='seek'&&call[2].at===3));
  player.dispose();
});

test('positions reject invalid seconds and source bounds before issuing playback controls', async () => {
  const device=adapter(),player=createCddaPlayer(device);
  await assert.rejects(player.play(),/Load CD-DA/);await assert.rejects(player.seek(0),/Select/);
  await player.load(wav(44100));await player.play();
  const plays=()=>device.calls.filter(call=>call[0]==='command'&&call[1].type==='play').length;
  const before=plays();
  for(const offset of [-1,NaN,Infinity,'0',Number.MAX_VALUE,1.01]) {
    await assert.rejects(player.play(1,{offset}),/position/);
    await assert.rejects(player.seek(offset),/position/);
  }
  assert.equal(plays(),before);
  await player.seek(1.6/44100);assert.equal((await player.getState()).positionFrames,2);
  await assert.rejects(player.play(8),/unknown track/);
  player.dispose();
});

test('load accepts a Virtual Files WAV path or JSON manifest path without fetching other tracks', async () => {
  const bytes=wav(), calls=[], device=adapter();
  const player=createCddaPlayer(device,{readFile:async path=>{
    calls.push(path);return /\.json$/i.test(path)?new TextEncoder().encode(JSON.stringify(manifest)):bytes;
  }});
  await player.load('/single.WAV');assert.deepEqual(calls,['/single.WAV']);await player.play();
  await player.load('/disc.JSON');assert.deepEqual(calls,['/single.WAV','/disc.JSON']);assert.equal(player.list()[0].number,2);
  await player.play(3);assert.deepEqual(calls,['/single.WAV','/disc.JSON','/disc.wav']);
  player.dispose();
});

test('invalid replacement leaves the existing selected source usable without allocating another PCM', async () => {
  const device=adapter(),player=createCddaPlayer(device,{readFile:async()=>{throw Error('missing Virtual File');}});
  await player.load(wav());await player.play();const previous=player.list(),pcm=[...device.live][0];
  const commands=device.calls.length;
  await assert.rejects(player.load(new Uint8Array(20)),/RIFF/);
  await assert.rejects(player.load({tracks:[{number:2,file:'/missing.wav',type:'data'}]}),/data tracks/);
  await assert.rejects(player.load('/missing.wav'),/missing Virtual File/);
  assert.equal(player.list(),previous);assert.equal([...device.live][0],pcm);assert.equal(device.calls.length,commands);
  await player.play();assert.equal((await player.getState()).track,1);assert.equal(device.live.size,1);
  player.dispose();
});

test('Stop invalidates a pending selected-file load and never starts its stale playback', async () => {
  const file=deferred(),started=deferred(),device=adapter();
  const player=createCddaPlayer(device,{readFile:async()=>{started.resolve();return file.promise;}});
  await player.load(manifest);
  const pending=player.play(2);const rejected=assert.rejects(pending,{name:'AbortError'});
  await started.promise;
  const stopping=player.stop();
  await stopping; // Stop must finish even when the Virtual Files read cannot.
  file.resolve(wav());await rejected;
  assert.equal(device.calls.filter(call=>call[0]==='prepare').length,0);
  assert.equal(device.calls.filter(call=>call[0]==='command'&&call[1].type==='play').length,0);
  assert.equal(device.live.size,0);
  player.dispose();
});

test('a newer load supersedes an older file await without replacing its track list afterward', async () => {
  const file=deferred(),started=deferred(),device=adapter();
  const player=createCddaPlayer(device,{readFile:async()=>{started.resolve();return file.promise;}});
  const old=player.load('/old.wav');const rejected=assert.rejects(old,{name:'AbortError'});await started.promise;
  await player.load(wav(30));const latest=player.list();file.resolve(wav(200));await rejected;
  assert.equal(player.list(),latest);await player.play();assert.equal((await player.getState()).durationFrames,30);
  player.dispose();
});

test('abort/disposal during a file read prevents preparation and dispose is idempotent', async () => {
  for(const action of ['abort','dispose']) {
    const file=deferred(),started=deferred(),device=adapter(),controller=new AbortController();
    const player=createCddaPlayer(device,{signal:controller.signal,readFile:async()=>{started.resolve();return file.promise;}});
    await player.load(manifest);
    const pending=player.play(2),rejected=assert.rejects(pending,{name:'AbortError'});await started.promise;
    if(action==='abort')controller.abort();else player.dispose();
    file.resolve(wav());await rejected;
    assert.equal(device.calls.filter(call=>call[0]==='prepare').length,0);
    player.dispose();player.dispose();assert.equal(device.calls.filter(call=>call[0]==='dispose').length,1);
    await assert.rejects(player.play(),{name:'AbortError'});assert.equal(device.live.size,0);
  }
});

test('invalid offset does not read or prepare a new selected track', async () => {
  const device=adapter(),reads=[],player=createCddaPlayer(device,{readFile:async path=>{reads.push(path);return wav();}});
  await player.load(manifest);await player.play(2);
  const before=device.calls.filter(call=>call[0]==='prepare').length;
  await assert.rejects(player.play(3,{offset:Infinity}),/position/);
  assert.equal(reads.length,1,'invalid seconds fail before reading another WAV');
  await assert.rejects(player.play(3,{offset:1}),/position/);
  assert.equal(device.calls.filter(call=>call[0]==='prepare').length,before,'out-of-range source position cannot replace active PCM');
  assert.equal((await player.getState()).track,2);
  player.dispose();
});

test('Stop during an installed replacement cannot leave stale previous-track metadata', async () => {
  const device=adapter(),readFile=async()=>wav(),player=createCddaPlayer(device,{readFile});
  await player.load(manifest);await player.play(2);
  const prepared=device.prepare.bind(device),started=deferred(),installed=deferred();
  device.prepare=async(...args)=>{
    await prepared(...args);
    if(args[1]==='3'){started.resolve();await installed.promise;}
  };
  const replacement=player.play(3),rejected=assert.rejects(replacement,{name:'AbortError'});
  await started.promise;await player.stop();installed.resolve();await rejected;
  await player.play(2);
  assert.deepEqual(device.calls.filter(call=>call[0]==='prepare').map(call=>call[1]),['2','3','2']);
  assert.equal((await player.getState()).track,2);
  player.dispose();
});

test('getState observes the effective host Mixer without applying its gain twice', async () => {
  const device=adapter();let mix={volume:.5,pan:-.25,muted:false};
  const command=device.command.bind(device);
  device.command=async(...args)=>({...await command(...args),gain:1,muted:false,volume:1,mute:false});
  const player=createCddaPlayer(device,{getMix:()=>mix});
  await player.load(wav());await player.play();
  const before=device.calls.length,state=await player.getState();
  assert.equal(state.volume,.5);assert.equal(state.pan,-.25);assert.equal(state.mute,false);
  assert.equal(state.gain,1,'core gain remains unity when host Mixer supplies gain');
  assert.deepEqual(device.calls.slice(before).map(call=>call[1]),[{type:'state'}],'reading Mixer state only reads the adapter');
  mix={volume:.75,pan:1,muted:false,effectiveMuted:true};
  const soloSuppressed=await player.getState();assert.equal(soloSuppressed.volume,.75);assert.equal(soloSuppressed.mute,true);
  mix={volume:1,pan:0,muted:true};assert.equal((await player.getState()).mute,true);
  mix=undefined;assert.equal((await player.getState()).volume,1,'without a host strip adapter metadata is retained');
  player.dispose();
});
