import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/pokey_wasm.js';
import {PokeyAudioEngine} from '../../web/pokeyaudioengine.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {createPokeyVgm} from '../../test/helpers/pokey_vgm_fixture.mjs';
import {createPlaybackEngine,createPlaybackPlayer,selectPlaybackConfiguration,applyPlaybackMutes} from './playback_core.js';
import {PokeyPlaybackEngine,pokeyPlaybackConfiguration} from './pokey_playback.js';
import {seekPlayback} from './seek_playback.js';
const binary=await readFile(new URL('../generated/pokey_wasm.wasm',import.meta.url));
const getFactory=async name=>{assert.equal(name,'pokey');return options=>factory({...options,wasmBinary:binary});};
const energy=pcm=>pcm.left.reduce((sum,v)=>sum+v*v,0);
function render(player,frames) {const left=new Float32Array(frames),right=new Float32Array(frames);player.process(left,right,frames);return {left,right};}

for(const dual of [false,true])test(`POKEY ${dual?'dual':'single'} declares independent sources and physical mute IDs`,async()=>{
  const source=createPokeyVgm({dual}),vgm=new Ym2612VGM(source),config=selectPlaybackConfiguration(vgm);
  assert.equal(config.kind,'pokey');assert.deepEqual(config.chips.map(c=>c.id),dual?['pokey','pokey:2']:['pokey']);
  const engine=await createPlaybackEngine(vgm,{getFactory});
  try{
    assert.equal(engine.entries.size,dual?2:1);assert.deepEqual([...engine.playbackMixer.strips.keys()],config.chips.map(c=>c.id));
    for(const id of engine.playbackMixer.strips.keys())assert.deepEqual(engine.playbackMixer.get(id),{gain:1,pan:0,muted:false});
    const player=createPlaybackPlayer(engine,source);player.setPrefetchFactor(1);player.play();assert(energy(render(player,4096))>1);
    assert.throws(()=>engine.getVgmTarget('pokey',dual?2:1),/No playback instance/);
    applyPlaybackMutes(engine,config,Array.from({length:dual?8:4},(_,i)=>`pokey-ch-${i+1}`));
    assert.equal(energy(engine.processFrames(4096)),0);player.reset();player.play();assert.equal(energy(render(player,4096)),0,'monitor mutes survive replay');
  }finally{engine.dispose();}
});

test('dual POKEY sums independent speaker PCM once at explicit unity, with no hidden attenuation',async()=>{
  const shared=await factory({wasmBinary:binary}),engine=await PokeyPlaybackEngine.create({rawClock:1789790|0x40000000,moduleFactory:()=>shared});
  const references=await Promise.all([0,1].map(()=>PokeyAudioEngine.create({moduleFactory:()=>shared,clock:1789790})));
  try{
    const observed=[];engine.onWrite=(...args)=>observed.push(args);
    for(let i=0;i<2;i++)for(const [register,value] of [[15,3],[8,0],[0,71+i*20],[1,0xa8],[9,0]]){engine.writePokey(register,value,i);references[i].writePokey(register,value);}
    const actual=engine.processFrames(8192),parts=references.map(ref=>ref.processFrames(8192));
    assert.deepEqual(actual.left,Float32Array.from(parts[0].left,(v,i)=>v+parts[1].left[i]));assert.deepEqual(actual.left,actual.right);
    assert(observed.some(row=>row[2]===1));assert.notEqual(engine.entries.get('pokey:0').engine,engine.entries.get('pokey:1').engine);
  }finally{engine.dispose();references.forEach(ref=>ref.dispose());}
});

test('dual POKEY seek reproduces both cores, polynomials and DC state by exact replay',async()=>{
  const source=createPokeyVgm({dual:true,seconds:2,loop:false,voices:[{chip:0,channel:0,distortion:0,frequency:440},{chip:1,channel:3,frequency:330}]}),parser=new Ym2612VGM(source);
  const a=await createPlaybackEngine(parser,{getFactory}),b=await createPlaybackEngine(parser,{getFactory});
  try{
    const first=createPlaybackPlayer(a,source),second=createPlaybackPlayer(b,source);first.setPrefetchFactor(1);first.play();
    render(first,22050);const expected=render(first,1024);
    await seekPlayback(second,22050);second.play();assert.deepEqual(render(second,1024),expected);
    assert.equal(a.supportsState(),false);
  }finally{a.dispose();b.dispose();}
});

test('dual POKEY creation fails cleanly for invalid clock/variant/factory',async()=>{
  for(const clock of [0,0x40000000,0x80000000|1789790,100000001])assert.throws(()=>pokeyPlaybackConfiguration(clock),/POKEY/);
  await assert.rejects(PokeyPlaybackEngine.create({rawClock:1789790,moduleFactory:async()=>({})}),/POKEY|Pokey/);
});

test('header composition preserves both POKEYs and their Mixer IDs beside another chip',async()=>{
  const {getNodePlaybackFactory}=await import('../../cli/render.js');
  const source=createPokeyVgm({dual:true,chip:1,channel:3,loop:false,seconds:.2});
  new DataView(source.buffer).setUint32(0x74,1789773,true); // An additional, silent AY.
  const vgm=new Ym2612VGM(source),configuration=selectPlaybackConfiguration(vgm);
  assert.equal(configuration.kind,'mixed');
  const engine=await createPlaybackEngine(vgm,{getFactory:getNodePlaybackFactory});
  try{
    assert.deepEqual(new Set(engine.playbackMixer.strips.keys()),new Set(['ay8910','pokey','pokey:2']));
    const player=createPlaybackPlayer(engine,source);player.play();assert(energy(render(player,4096))>1);
    const core=engine.entries.get('pokey:0').engine;
    assert.equal(core.entries.get('pokey:0').engine.registers[7]&15,0);
    assert.equal(core.entries.get('pokey:1').engine.registers[7]&15,12);
  }finally{engine.dispose();}
});
