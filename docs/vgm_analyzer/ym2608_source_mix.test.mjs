import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {YM2608_SOURCE_LABELS,ym2608SourceDefaults,Ym2608SourceMixer} from './ym2608_source_mix.js';
import {installPlaybackMixer,mixerDefaults} from './playback_mixer.js';
import {createPlaybackEngine,createPlaybackPlayer,selectPlaybackConfiguration} from './playback_core.js';
import {seekPlayback} from './seek_playback.js';
import {renderVgmToWav,encodeStereoWav} from './vgm_wav.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {createVgmTargets} from '../js/vgmplayer.js';
import {getNodePlaybackFactory} from '../../tetorica_src/cli/render.js';

const parts = Object.keys(YM2608_SOURCE_LABELS);
const defaults = () => Object.fromEntries(parts.map(part => [part,ym2608SourceDefaults()]));
const unity = {fm:1,ssg:1,rhythm:1,adpcm:1};
const pull = (player,frames) => {
  const left = new Float32Array(frames),right = new Float32Array(frames);
  player.process(left,right,frames); return {left,right};
};
const restart = player => {player.stop(); player.play();};
function closePcm(actual,expected,scale=1,label='PCM') {
  for (const side of ['left','right']) for (let index=0;index<actual[side].length;index++) {
    assert.ok(Math.abs(actual[side][index]-expected[side][index]*scale)<1e-6,`${label}/${side}/${index}`);
  }
}

test('source settings validate atomically, retain muted gain and return detached values',()=>{
  const calls=[]; let reject=false;
  const controller = new Ym2608SourceMixer({setSourceGains(gains) {if(reject)throw Error('native rejection');calls.push(gains);}});
  assert.deepEqual(controller.getState(),defaults()); assert.deepEqual(calls,[unity]);
  const authored={gain:3.8};controller.set('fm',authored);authored.gain=0;
  controller.set('fm',{muted:true});assert.deepEqual(calls.at(-1),{...unity,fm:0});
  controller.set('fm',{gain:.7});assert.deepEqual(controller.get('fm'),{gain:.7,muted:true});
  controller.set('fm',{muted:false});assert.deepEqual(calls.at(-1),{...unity,fm:.7});
  const state=controller.getState(),value=controller.get('fm');state.fm.gain=0;value.muted=true;
  assert.deepEqual(controller.get('fm'),{gain:.7,muted:false});
  const before=controller.getState(),count=calls.length;
  for(const patch of [null,[],{gain:NaN},{gain:Infinity},{gain:-.1},{gain:3.81},{gain:'1'},{muted:1},{pan:0},{gain:.5,muted:'yes'},{[Symbol()]:1}]) {
    assert.throws(()=>controller.set('fm',patch));assert.deepEqual(controller.getState(),before);
  }
  for(const part of ['noise','toString','__proto__',undefined,new String('fm')])assert.throws(()=>controller.get(part),TypeError);
  assert.equal(calls.length,count,'invalid values never reach native output');
  reject=true;assert.throws(()=>controller.set('ssg',{gain:.5}),/native rejection/);
  assert.deepEqual(controller.getState(),before,'native failures do not retain unapplied settings');
  assert.throws(()=>new Ym2608SourceMixer({}),/unavailable/);
});

test('installation keeps one borrowed PCM renderer and reapplies source controls after native reset',()=>{
  let gains,frames=0,calls=0;
  const chip={setSourceGains(value){calls++;gains=value;},generateStereoView(count){frames+=count;return {left:new Float32Array(count).fill(.25*gains.fm),right:new Float32Array(count).fill(.5*gains.fm)};}};
  const engine={ym2608:chip,sampleRate:()=>44100,stateSettingsKey:()=>'',reset(){gains={...unity};}};
  const mixer=installPlaybackMixer(engine,{kind:'ym2608',chips:[{id:'ym2608'}]});
  assert.deepEqual([...mixer.strips.keys()],['ym2608']);
  assert.deepEqual([...mixer.sourceMixers.keys()],['ym2608']);
  assert.equal(mixer.get('ym2608').gain,1.03357);
  const controller=mixer.sourceMixers.get('ym2608');controller.set('fm',{gain:.5,muted:true});
  const key=engine.stateSettingsKey();controller.set('fm',{gain:.8});
  assert.notEqual(engine.stateSettingsKey(),key,'remembered gain changes the settings key while effectively muted');
  engine.reset();assert.deepEqual(gains,{...unity,fm:0});
  assert.deepEqual(controller.get('fm'),{gain:.8,muted:true});
  const before=calls;chip.generateStereoView(7);assert.equal(frames,7);assert.equal(calls,before,'rendering never adds source gain calls or extra PCM passes');
  controller.set('fm',{muted:false});mixer.set('ym2608',{gain:.5,pan:1});mixer.reset();
  const pcm=chip.generateStereoView(1);assert.equal(pcm.left[0],0);assert.equal(pcm.right[0],Math.fround(.5*.8*.5));
  assert.throws(()=>installPlaybackMixer({...engine,ym2608:{generateStereoView:chip.generateStereoView}},{chips:[{id:'ym2608'}]}),/unavailable/);
});

const rhythmRom = await readFile(new URL('../../tetorica_src/runtime/tetorica_ym2608_adpcm_rom.bin',import.meta.url));
async function fixture(part,bytes=undefined) {
  bytes ??= await readFile(new URL(`../../test/fixtures/ym2608-${part}.vgm`,import.meta.url));
  const engine=await createPlaybackEngine(new Ym2612VGM(bytes),{getFactory:getNodePlaybackFactory,roms:{ym2608AdpcmA:rhythmRom}});
  const player=createPlaybackPlayer(engine,bytes);player.setPrefetchFactor(1);
  return {bytes,engine,player,controller:engine.playbackMixer.sourceMixers.get('ym2608')};
}

async function renderFixture(part,{sourceSettings={},parentSettings=undefined,bytes=undefined}={}) {
  const {engine,player,controller}=await fixture(part,bytes);
  try {
    assert.deepEqual(engine.playbackMixer.get('ym2608'),mixerDefaults('ym2608'));
    assert.deepEqual(controller.getState(),defaults());
    for(const [source,settings] of Object.entries(sourceSettings))controller.set(source,settings);
    if(parentSettings)engine.playbackMixer.set('ym2608',parentSettings);
    const authored=controller.getState();
    restart(player);const first=pull(player,4096);
    restart(player);const restarted=pull(player,4096);
    assert.deepEqual(controller.getState(),authored,'restart retains source settings');
    player.pause();player.resume();const snapshot=player.saveState(),continuation=pull(player,32);
    player.loadState(snapshot);assert.deepEqual(pull(player,32),continuation,'snapshot restores exact continuation');
    await seekPlayback(player,16,{yieldTask:async()=>{}});player.play();const sought=pull(player,32);
    assert.deepEqual(controller.getState(),authored,'seek retains source settings');
    // Reset phase is a pre-existing chip detail. Compare WAV to its own exact
    // snapshot rather than assuming unrelated reset cycles have identical PCM.
    restart(player);const wavStart=player.saveState(),wavPcm=pull(player,882);player.loadState(wavStart);
    const wav=await renderVgmToWav(player,{maxSeconds:.02,blockFrames:882});
    assert.deepEqual(wav.bytes,encodeStereoWav(wavPcm.left,wavPcm.right,player.sampleRate()),'WAV uses the live source balance');
    return {first,restarted,sought};
  } finally {engine.dispose();}
}

for(const part of parts)test(`real Analyzer ${part} volume and mute preserve other sources, parent balance and transport`,async()=>{
  const reference=await renderFixture(part);
  assert.ok(reference.first.left.some(value=>Math.abs(value)>1e-5),part+' fixture must be audible');
  const inactive=await renderFixture(part,{sourceSettings:Object.fromEntries(parts.filter(value=>value!==part).map(source=>[source,{gain:.25,muted:true}]))});
  const half=await renderFixture(part,{sourceSettings:{[part]:{gain:.5}}});
  const muted=await renderFixture(part,{sourceSettings:{[part]:{gain:.5,muted:true}}});
  const right=await renderFixture(part,{sourceSettings:{[part]:{gain:.5}},parentSettings:{gain:.5,pan:1}});
  const parentMuted=await renderFixture(part,{sourceSettings:{[part]:{gain:.5}},parentSettings:{muted:true}});
  for(const cycle of ['first','restarted','sought']) {
    closePcm(inactive[cycle],reference[cycle],1,part+' other sources');
    closePcm(half[cycle],reference[cycle],.5,part+' half');
    assert.ok(muted[cycle].left.every(value=>value===0)&&muted[cycle].right.every(value=>value===0));
    assert.ok(right[cycle].left.every(value=>value===0));
    closePcm({left:right[cycle].right,right:right[cycle].right},{left:half[cycle].right,right:half[cycle].right},.5/mixerDefaults('ym2608').gain,part+' parent volume');
    assert.ok(parentMuted[cycle].left.every(value=>value===0)&&parentMuted[cycle].right.every(value=>value===0));
  }
  const quiet=await fixture(part),audible=await fixture(part);
  try {
    quiet.controller.set(part,{gain:.5,muted:true});audible.controller.set(part,{gain:.5});
    // Initialize from the real VGM without pre-rendering its entire first wait
    // into VgmPlayer's PCM queue. Compare fresh native samples after unmuting.
    for(const current of [quiet,audible]) {
      current.engine.reset();
      const parser=new Ym2612VGM(current.bytes),targets=createVgmTargets(current.engine);
      while(true) {const event=parser.playStep(targets);if(event.type==='wait'||event.type==='end')break;}
    }
    const silence=quiet.engine.ym2608.generateStereo(16);audible.engine.ym2608.generateStereo(16);
    assert.ok(silence.left.every(value=>value===0)&&silence.right.every(value=>value===0));
    quiet.controller.set(part,{muted:false});
    closePcm(quiet.engine.ym2608.generateStereo(32),audible.engine.ym2608.generateStereo(32),1,part+' silent evolution');
    quiet.controller.set(part,{muted:true});const saved=quiet.player.saveState();
    quiet.controller.set(part,{gain:.7});assert.throws(()=>quiet.player.loadState(saved),/Incompatible/,'retained muted gain participates in snapshot compatibility');
  } finally {quiet.engine.dispose();audible.engine.dispose();}
});

test('source controls find YM2608 inside a real mixed engine and leave another chip independent',async()=>{
  const original=await readFile(new URL('../../test/fixtures/ym2608-fm.vgm',import.meta.url));
  const header=new DataView(original.buffer,original.byteOffset,original.byteLength),dataOffset=0x34+header.getUint32(0x34,true);
  const psgWrites=Uint8Array.of(0x50,0x84,0x50,0x10,0x50,0x90);
  const bytes=new Uint8Array(original.length+psgWrites.length);bytes.set(original.subarray(0,dataOffset));bytes.set(psgWrites,dataOffset);bytes.set(original.subarray(dataOffset),dataOffset+psgWrites.length);
  const next=new DataView(bytes.buffer);next.setUint32(0x04,bytes.length-4,true);next.setUint32(0x0c,3579545,true);
  const configuration=selectPlaybackConfiguration(new Ym2612VGM(bytes));assert.equal(configuration.kind,'mixed');
  async function render(settings) {
    const {engine,player,controller}=await fixture('fm',bytes);
    try {
      assert.deepEqual([...engine.playbackMixer.strips.keys()].sort(),['psg','ym2608']);
      assert.deepEqual([...engine.playbackMixer.sourceMixers.keys()],['ym2608']);
      controller.set('fm',settings);restart(player);const first=pull(player,4096);
      restart(player);return {first,restarted:pull(player,4096)};
    } finally {engine.dispose();}
  }
  const reference=await render({gain:1}),psg=await render({muted:true}),half=await render({gain:.5});
  assert.ok(psg.first.left.some(value=>Math.abs(value)>1e-5),'second chip is audible when YM2608 FM is muted');
  for(const cycle of ['first','restarted'])for(const side of ['left','right'])for(let i=0;i<half[cycle][side].length;i++)assert.ok(Math.abs(half[cycle][side][i]-(reference[cycle][side][i]+psg[cycle][side][i])*.5)<1e-6,side+' mixed source balance');
});
