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

test('installed source ownership applies Genesis trim compensation and never leaks it to another PSG owner',()=>{
 const configuration={kind:'ym2612',chips:[{id:'ym2612'},{id:'psg'}]};
 const genesis={ym2612:source(),psg:source(),writeYm2612(){},reset(){},sampleRate:()=>44100};
 const mixer=installPlaybackMixer(genesis,configuration);
 assert.equal(mixer.get('ym2612').gain,Number((.775938/.9).toFixed(6)));
 assert.equal(mixer.get('psg').gain,Number((.644089/.35).toFixed(6)));
 const unrelated={psg:source(),reset(){},sampleRate:()=>44100};
 const separate=installPlaybackMixer(unrelated,{kind:'ym2612',chips:[{id:'psg'}]});
 assert.equal(separate.get('psg').gain,.644089,'The actual source owner takes precedence over configuration inference');
 const opl={ym3812:source(),psg:source(),reset(){},sampleRate:()=>44100};
 const oplMixer=installPlaybackMixer(opl,{kind:'ym3812',chips:[{id:'ym3812'},{id:'psg'}]});
 assert.equal(oplMixer.get('psg').gain,.644089);
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
