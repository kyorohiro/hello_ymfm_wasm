import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PlaybackMixer, installPlaybackMixer, mixerDefaults} from './playback_mixer.js';
import {createPlaybackEngine, createPlaybackPlayer} from './playback_core.js';
import {seekPlayback} from './seek_playback.js';
import {renderVgmToWav, encodeStereoWav} from './vgm_wav.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {getNodePlaybackFactory} from '../../cli/render.js';

const source = () => ({frames: 0, generateStereo(n) {
  this.frames += n;
  return {left: new Float32Array(n).fill(.8), right: new Float32Array(n).fill(.4)};
}});
test('independent gain, stereo balance and mute preserve synthesis and original PCM at defaults', () => {
  const mixer = new PlaybackMixer(), a = source(), b = source();
  mixer.addSource('a', a); mixer.addSource('b', b);
  assert.equal(a.generateStereo(1).left[0], Math.fround(.8));
  mixer.set('a', {gain: .5, pan: 1}); mixer.reset();
  assert.deepEqual(a.generateStereo(1), {left: Float32Array.of(0), right: Float32Array.of(.2)});
  assert.equal(b.generateStereo(1).left[0], Math.fround(.8));
  mixer.set('a', {muted: true}); mixer.reset();
  assert.equal(a.generateStereo(3).right[0], 0); assert.equal(a.frames, 5);
  mixer.set('a', {muted: false, pan: -1}); mixer.reset();
  assert.equal(a.generateStereo(1).left[0], Math.fround(.4));
  assert.equal(a.generateStereo(1).right[0], 0);
  assert.throws(() => mixer.set('a', {gain: NaN}), RangeError);
  assert.throws(() => mixer.set('a', {pan: 2}), RangeError);
});
test('gain ramps are continuous across render boundaries; Into respects frame count', () => {
  const pass = sizes => {
    const chip = source(), mixer = new PlaybackMixer(); mixer.addSource('a', chip, 'generateStereo', 1000);
    mixer.set('a', {gain: 0});
    return sizes.flatMap(n => [...chip.generateStereo(n).left]);
  };
  assert.deepEqual(pass([8]), pass([1, 2, 5]));
  const chip = {generateStereoInto(l, r, n = l.length) {l.fill(1, 0, n); r.fill(1, 0, n);}};
  const mixer = new PlaybackMixer(); mixer.addSource('a', chip, 'generateStereoInto');
  mixer.set('a', {gain: .5}); mixer.reset();
  const l = new Float32Array(4).fill(9), r = l.slice(); chip.generateStereoInto(l, r, 2);
  assert.deepEqual([...l], [.5, .5, 9, 9]);
  chip.generateStereoInto(l, r); assert.deepEqual([...l], [.5, .5, .5, .5]);
});
test('actual Game Boy VGM gain, pan and mute survive player restart and WAV rendering', async () => {
  const bytes = await readFile(new URL('../../test/fixtures/gameboy-tone.vgm', import.meta.url));
  const render = async settings => {
    const engine = await createPlaybackEngine(new Ym2612VGM(bytes), {getFactory: getNodePlaybackFactory});
    try {
      assert.deepEqual([...engine.playbackMixer.strips.keys()], ['gameBoyDmg']);
      engine.playbackMixer.set('gameBoyDmg', settings);
      const player = createPlaybackPlayer(engine, bytes); player.stop(); player.play();
      const l = new Float32Array(4096), r = l.slice(); player.process(l, r, l.length);
      const {renderVgmToWav} = await import('./vgm_wav.js');
      player.stop(); player.play(); const wav = await renderVgmToWav(player, {maxSeconds: .02});
      return {l, r, wav};
    } finally {engine.dispose();}
  };
  const full = await render({gain:1}), defaults = await render({}), half = await render({gain: .5}), muted = await render({muted: true}), left = await render({gain:1,pan: -1});
  assert(full.l.some(v => v !== 0));
  assert.deepEqual(defaults.l,full.l.map(v=>v*mixerDefaults('gameBoyDmg').gain));
  assert.deepEqual(half.l, full.l.map(v => v * .5));
  assert.deepEqual(left.l, full.l); assert(left.r.every(v => v === 0));
  assert(muted.l.every(v => v === 0)); assert(muted.r.every(v => v === 0));
  assert(muted.wav.bytes.subarray(44).every(v => v === 0));
});

test('new strips start at measured levels immediately and late registration preserves another strip ramp',()=>{
 const mixer=new PlaybackMixer(),pcm=source();mixer.addSource('rf5c164',pcm);
 assert.equal(pcm.generateStereo(1).left[0],Math.fround(Math.fround(.8)*.280286));
 mixer.set('rf5c164',{gain:.7});
 pcm.generateStereo(1);
 const before={...mixer.strips.get('rf5c164')};
 const other=source();mixer.addSource('ym2612',other);
 assert.equal(other.generateStereo(1).left[0],Math.fround(Math.fround(.8)*.775938));
 for(const field of ['left','right','remaining'])assert.equal(mixer.strips.get('rf5c164')[field],before[field],field);
 assert.equal(mixer.get('rf5c164').gain,.7);
});

test('installed source ownership cancels Genesis balance without changing public source-unit gains',()=>{
 const configuration={kind:'ym2612',chips:[{id:'ym2612'},{id:'psg'}]};
 const genesis={ym2612:source(),psg:source(),writeYm2612(){},reset(){},sampleRate:()=>44100};
 const mixer=installPlaybackMixer(genesis,configuration);
 assert.equal(mixer.get('ym2612').gain,.775938);
 assert.equal(mixer.get('psg').gain,.35);
 for(const [id,trim] of [['ym2612',.9],['psg',.35]])for(const gain of [0,.35,1,2]){
  mixer.set(id,{gain});mixer.reset();
  const pcm=genesis[id].generateStereo(3);
  for(const sample of pcm.left)assert.ok(Math.abs(sample*trim-Math.fround(.8)*gain)<2e-7,`${id}: ${gain} is an actual source gain`);
 }
 const unrelated={psg:source(),reset(){},sampleRate:()=>44100};
 const separate=installPlaybackMixer(unrelated,{kind:'ym2612',chips:[{id:'psg'}]});
 assert.equal(separate.get('psg').gain,.35,'The actual source owner takes precedence over configuration inference');
 const opl={ym3812:source(),psg:source(),reset(){},sampleRate:()=>44100};
 const oplMixer=installPlaybackMixer(opl,{kind:'ym3812',chips:[{id:'ym3812'},{id:'psg'}]});
 assert.equal(oplMixer.get('psg').gain,.35);
});

test('Genesis normalization preserves borrowed tails, zero-frame calls and ramp segmentation',()=>{
 const render=sizes=>{
  const left=new Float32Array(12),right=new Float32Array(12);
  const source={generateStereoView(){left.fill(1);right.fill(.5);return {left,right};}};
  const mixer=new PlaybackMixer();mixer.addSource('psg',source,'generateStereoView',1000,.35);
  mixer.set('psg',{gain:1});
  return sizes.flatMap(frames=>{
   const before=mixer.strips.get('psg').remaining,pcm=source.generateStereoView(frames);
   assert.ok(pcm.left.subarray(frames).every(value=>value===1));
   assert.ok(pcm.right.subarray(frames).every(value=>value===.5));
   if(!frames)assert.equal(mixer.strips.get('psg').remaining,before);
   return [...pcm.left.subarray(0,frames)];
  });
 };
 assert.deepEqual(render([0,8]),render([1,0,2,5]));
});

test('actual Genesis FM and PSG source gains survive restart, snapshot, seek and WAV export',async()=>{
 const fmBytes=await readFile(new URL('../../test/fixtures/genesis-pcm.vgm',import.meta.url));
 const psgBytes=new Uint8Array(await readFile(new URL('../../test/fixtures/psg-tone.vgm',import.meta.url)));
 // Select the Genesis host for the existing original PSG-only test program.
 new DataView(psgBytes.buffer).setUint32(0x2c,7670454,true);
 const read=(player,frames)=>{const left=new Float32Array(frames),right=new Float32Array(frames);player.process(left,right,frames);return {left,right};};
 for(const id of ['ym2612','psg']){
  const bytes=id==='psg'?psgBytes:fmBytes;
  const make=()=>createPlaybackEngine(new Ym2612VGM(bytes),{getFactory:getNodePlaybackFactory});
  const render=async gain=>{
   const engine=await make();
   try{
    for(const source of engine.playbackMixer.strips.keys())engine.playbackMixer.set(source,{muted:source!==id});
    engine.playbackMixer.set(id,{gain});
    const player=createPlaybackPlayer(engine,bytes);player.stop();player.play();
    const first=read(player,4096);player.stop();player.play();assert.deepEqual(read(player,4096),first,`${id}: restart`);
    const snapshot=player.saveState(),continuation=read(player,2048);player.loadState(snapshot);
    assert.deepEqual(read(player,2048),continuation,`${id}: snapshot`);
    // seekPlayback uses 44.1 kHz VGM wait units; Genesis renders at clock/144.
    await seekPlayback(player,4096.5*44100/player.sampleRate(),{yieldTask:async()=>{}});player.play();assert.deepEqual(read(player,2048),continuation,`${id}: seek`);
    player.stop();player.play();const wav=await renderVgmToWav(player,{maxSeconds:882/player.sampleRate(),blockFrames:882});
    assert.deepEqual(wav.bytes,encodeStereoWav(first.left.subarray(0,882),first.right.subarray(0,882),player.sampleRate()),`${id}: WAV`);
    return first;
   }finally{engine.dispose();}
  };
  const unity=await render(1);assert.ok(unity.left.some(value=>Math.abs(value)>.001),id+' reference is audible');
  for(const gain of [0,mixerDefaults(id).gain,.5,2]){
   const actual=await render(gain);
   for(const side of ['left','right'])for(let i=0;i<actual[side].length;i++)assert.ok(Math.abs(actual[side][i]-unity[side][i]*gain)<2e-7,`${id}/${gain}/${side}/${i}: absolute source gain`);
  }
 }
});

test('actual Analyzer NES defaults apply without UI setup and survive restart, snapshots, seek and WAV export',async()=>{
 const bytes=await readFile(new URL('../../test/fixtures/nes-tone.vgm',import.meta.url));
 const make=()=>createPlaybackEngine(new Ym2612VGM(bytes),{getFactory:getNodePlaybackFactory});
 const engine=await make(),unity=await make();
 const read=(player,frames)=>{const left=new Float32Array(frames),right=new Float32Array(frames);player.process(left,right,frames);return {left,right};};
 try{
  assert.equal(engine.sampleRate(),44100,'Measure and calibrate the actual Analyzer default sample rate');
  assert.deepEqual(engine.playbackMixer.get('nesApu'),mixerDefaults('nesApu'));
  const player=createPlaybackPlayer(engine,bytes),rawPlayer=createPlaybackPlayer(unity,bytes);
  unity.playbackMixer.set('nesApu',{gain:1});rawPlayer.stop();rawPlayer.play();player.play();
  const raw=read(rawPlayer,4096),initial=read(player,4096),gain=mixerDefaults('nesApu').gain;
  assert.ok(initial.left.some(value=>Math.abs(value)>.001));
  assert.deepEqual(initial.left,raw.left.map(value=>value*gain));
  player.stop();player.play();assert.deepEqual(read(player,4096),initial,'Restart keeps measured level without a unity ramp');
  assert.equal(player.supportsState(),true);
  const snapshot=player.saveState(),continuation=read(player,2048);
  player.loadState(snapshot);assert.deepEqual(read(player,2048),continuation,'Snapshot restores exact calibrated continuation');
  await seekPlayback(player,4096,{yieldTask:async()=>{}});player.play();
  assert.deepEqual(read(player,2048),continuation,'Silent seek preserves the same applied Mixer level');
  player.stop();player.play();
  const wav=await renderVgmToWav(player,{maxSeconds:.02,blockFrames:882});
  assert.deepEqual(wav.bytes,encodeStereoWav(initial.left.subarray(0,882),initial.right.subarray(0,882),44100),'WAV uses the same calibrated samples before any app preferences are applied');
  engine.playbackMixer.set('nesApu',{gain:.5});player.stop();player.play();
  assert.deepEqual(read(player,4096).left,raw.left.map(value=>value*.5),'An explicit gain is absolute, not multiplied by calibration');
  await seekPlayback(player,4096,{yieldTask:async()=>{}});
  assert.equal(engine.playbackMixer.get('nesApu').gain,.5);
 }finally{engine.dispose();unity.dispose();}
});

test('actual YM2608 FM and internal SSG apply each default/explicit gain, pan and mute once through borrowed PCM',async()=>{
 const pull=(player,frames)=>{const left=new Float32Array(frames),right=new Float32Array(frames);player.process(left,right,frames);return {left,right};};
 for(const section of ['fm','ssg']){
  const bytes=await readFile(new URL(`../../test/fixtures/ym2608-${section}.vgm`,import.meta.url));
  const render=async settings=>{
   const engine=await createPlaybackEngine(new Ym2612VGM(bytes),{getFactory:getNodePlaybackFactory});
   try{
    assert.equal(engine.playbackMixer.get('ym2608').gain,1.03357,'OPNA whole-chip default stays unchanged');
    if(settings)engine.playbackMixer.set('ym2608',settings);
    const player=createPlaybackPlayer(engine,bytes);player.stop();player.play();
    const first=pull(player,4096);
    player.stop();player.play();const restarted=pull(player,4096);
    player.stop();player.play();
    const snapshot=player.saveState(),wavPcm=pull(player,882);player.loadState(snapshot);
    const wav=await renderVgmToWav(player,{maxSeconds:.02,blockFrames:882});
    assert.ok(Buffer.from(wav.bytes).equals(Buffer.from(encodeStereoWav(wavPcm.left,wavPcm.right,player.sampleRate()))),`${section}: WAV and live PCM share the same gain`);
    return {first,restarted};
   }finally{engine.dispose();}
  };
  const unity=await render({gain:1}),defaults=await render(),half=await render({gain:.5}),right=await render({gain:1,pan:1}),muted=await render({muted:true});
  for(const cycle of ['first','restarted']){
   assert.ok(unity[cycle].left.some(value=>Math.abs(value)>.001),`${section}/${cycle}: reference is audible`);
   for(const side of ['left','right']){
    // The output adapter averages native frames after Float32 trim; allow only
    // that rounding difference, while independently checking every sample.
    let maxError=0;
    for(let index=0;index<unity[cycle][side].length;index++){
     maxError=Math.max(maxError,Math.abs(defaults[cycle][side][index]-unity[cycle][side][index]*1.03357));
     assert.equal(half[cycle][side][index],Math.fround(unity[cycle][side][index]*.5),`${section}/${cycle}/${side}/${index}: explicit volume is absolute`);
    }
    assert.ok(maxError<2e-7,`${section}/${cycle}/${side}: default must reach generateStereoView once (error${maxError})`);
    assert.ok(muted[cycle][side].every(value=>value===0),`${section}/${cycle}/${side}: mute reaches borrowed samples`);
   }
   assert.ok(right[cycle].left.every(value=>value===0));
   assert.ok(Buffer.from(right[cycle].right.buffer).equals(Buffer.from(unity[cycle].right.buffer)),`${section}/${cycle}: right pan keeps the original right PCM`);
  }
 }
});

test('borrowed View registration touches only requested frames and advances a ramp once per used sample',()=>{
 const render=sizes=>{
  const left=new Float32Array(16),right=new Float32Array(16);
  const borrowed={generateStereoView(){left.fill(1);right.fill(.5);return {left,right};}};
  const mixer=new PlaybackMixer();mixer.addSource('ym2608',borrowed,'generateStereoView',1000);
  mixer.set('ym2608',{gain:0});
  return sizes.flatMap(frames=>{
   const pcm=borrowed.generateStereoView(frames);
   assert.ok(pcm.left.subarray(frames).every(value=>value===1),'Reserved left capacity remains untouched');
   assert.ok(pcm.right.subarray(frames).every(value=>value===.5),'Reserved right capacity remains untouched');
   return [...pcm.left.subarray(0,frames)];
  });
 };
 assert.deepEqual(render([4]),render([1,1,2]));
});
