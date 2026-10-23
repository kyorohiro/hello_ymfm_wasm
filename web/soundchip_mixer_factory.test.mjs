import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundChipMixer, PCMChipMixer, chipMixGains, soundChipMixDefaults} from './soundchip_mixer.js';

const kinds = records => ({version:1,kinds:records});
const state = entries => ({version:1,entries});
const entry = (id,name,settings) => ({id,name,settings});
const mix = (volume,pan=0,muted=false,solo=false) => ({volume,pan,muted,solo});
const factory = () => ({
  factoryDefaults:kinds([{name:'ym2612',volume:.3,pan:.2},{name:'gameboy',volume:.4}]),
  factoryEntries:state([entry('ym2612','ym2612',{volume:.5,pan:-.1})]),
});

test('application factory policies leave shared library defaults and raw PCM at their existing levels',()=>{
  const application = new SoundChipMixer(factory()), library = new SoundChipMixer();
  application.register('gameboy','gameboy',()=>{}); library.register('gameboy','gameboy',()=>{});
  assert.equal(application.get('gameboy').volume,.4);
  assert.equal(library.get('gameboy').volume,.28);
  assert.deepEqual(soundChipMixDefaults('gameboy'),{volume:.28,pan:0,muted:false});
  assert.deepEqual(soundChipMixDefaults('gameBoyDmg'),{volume:.28,pan:0,muted:false});
  assert.deepEqual(soundChipMixDefaults('ym2612'),{volume:1,pan:0,muted:false});
  const pcm = new PCMChipMixer(), source = {generateStereo:()=>({left:new Float32Array([.3]),right:new Float32Array([-.2])})};
  pcm.addSource('ym2612',source);
  assert.deepEqual(pcm.get('ym2612'),{volume:1,pan:0,muted:false});
  assert.deepEqual(source.generateStereo(),{left:new Float32Array([.3]),right:new Float32Array([-.2])});
});

test('factory kinds and matching IDs sit below authored kind and ID settings without entering exports',()=>{
  const mixer = new SoundChipMixer(factory()), applied = [];
  assert.deepEqual(mixer.get('ym2612'),mix(.5,-.1),'built-in ID can be inspected before start');
  assert.deepEqual(mixer.getKindDefault('ym2612'),{volume:.3,pan:.2},'common policy excludes primary-only balance');
  const disconnect = mixer.register('ym2612','ym2612',settings=>applied.push(settings));
  mixer.register('lead','ym2612',()=>{});
  assert.deepEqual(mixer.get('lead'),mix(.3,.2));
  assert.deepEqual(mixer.exportDefaults(),kinds([])); assert.deepEqual(mixer.exportState(),state([]));
  mixer.configureDefaults(kinds([{name:'ym2612',volume:.7}]));
  assert.deepEqual(mixer.get('ym2612'),mix(.7,-.1));
  assert.deepEqual(mixer.get('lead'),mix(.7,.2));
  mixer.set('ym2612',{volume:.9,pan:.5});
  assert.deepEqual(mixer.get('ym2612'),mix(.9,.5));
  assert.deepEqual(chipMixGains(applied.at(-1)),[.45,.9]);
  assert.deepEqual(mixer.exportDefaults(),kinds([{name:'ym2612',volume:.7}]));
  assert.deepEqual(mixer.exportState(),state([entry('ym2612','ym2612',{volume:.9,pan:.5})]));
  mixer.reset('ym2612'); assert.deepEqual(mixer.get('ym2612'),mix(.7,-.1));
  mixer.configureDefaults(kinds([])); assert.deepEqual(mixer.get('ym2612'),mix(.5,-.1));
  disconnect(); assert.deepEqual(mixer.get('ym2612'),mix(.5,-.1),'disconnected settings keep factory identity');
  const reconnect = mixer.register('ym2612','ym2612',()=>{});
  mixer.restoreState(state([]),kinds([]));
  assert.deepEqual(mixer.get('ym2612'),mix(.5,-.1));
  assert.deepEqual(mixer.exportState(),state([])); reconnect();
});

test('factory ID balance requires both exact ID and kind and never transfers to another source',()=>{
  const mixer = new SoundChipMixer(factory());
  const remove = mixer.register('ym2612','gameboy',()=>{});
  assert.deepEqual(mixer.get('ym2612'),mix(.4));
  remove();
  const release = mixer.register('ym2612','ym2612',()=>{});
  assert.deepEqual(mixer.get('ym2612'),mix(.5,-.1));
  mixer.register('YM2612','ym2612',()=>{});
  mixer.register('other','YM2612',()=>{});
  assert.deepEqual(mixer.get('YM2612'),mix(.3,.2),'different ID uses kind balance only');
  assert.deepEqual(mixer.get('other'),mix(1),'kind lookup is exact, not a global alias rewrite');
  release();
});

test('deferred, retained and transient restore paths keep factory fallbacks and authored values distinct',()=>{
  const mixer = new SoundChipMixer(factory());
  mixer.restoreState(state([entry('ym2612','ym2612',{muted:true}),entry('lead','ym2612',{volume:.8})]));
  assert.deepEqual(mixer.get('ym2612'),mix(.5,-.1,true));
  mixer.setKindDefault('ym2612',{pan:.4});
  assert.deepEqual(mixer.get('ym2612'),mix(.5,.4,true));
  const release = mixer.register('ym2612','ym2612',()=>{});
  const reserved = mixer.reserveId('ym2612');
  mixer.restoreState(state([entry(reserved.id,'ym2612',{volume:.8}),entry('ym2612','ym2612',{muted:true})]),kinds([]));
  const transient = mixer.register(reserved.id,'ym2612',()=>{}); reserved.release();
  assert.deepEqual(mixer.get(reserved.id),mix(.3,.2),'transient ID never inherits saved project values');
  assert.deepEqual(mixer.get('ym2612'),mix(.5,-.1,true));
  mixer.reset();
  assert.deepEqual(mixer.get('ym2612'),mix(.5,-.1));
  assert.deepEqual(mixer.exportState(),state([]));
  transient(); release();
});

test('factory gains feed existing mute, solo and pan logic exactly once',()=>{
  const mixer = new SoundChipMixer(factory()), applied = {};
  mixer.register('ym2612','ym2612',settings=>{applied.primary=chipMixGains(settings);});
  mixer.register('lead','ym2612',settings=>{applied.lead=chipMixGains(settings);});
  assert.deepEqual(applied.primary,[.5,.45]);
  assert.deepEqual(applied.lead,[.24,.3]);
  mixer.set('lead',{solo:true}); assert.deepEqual(applied.primary,[0,0]);
  mixer.set('ym2612',{solo:true}); assert.deepEqual(applied.primary,[.5,.45]);
  mixer.set('ym2612',{muted:true}); assert.deepEqual(applied.primary,[0,0]);
  mixer.reset(); assert.deepEqual(applied.primary,[.5,.45]); assert.deepEqual(applied.lead,[.24,.3]);
});

test('factory policies are validated completely, copied, and reject out-of-range gains without clamping',()=>{
  const options = factory(), before = structuredClone(options), mixer = new SoundChipMixer(options);
  assert.deepEqual(options,before);
  options.factoryDefaults.kinds[0].volume=2;
  options.factoryEntries.entries[0].settings.volume=2;
  mixer.register('ym2612','ym2612',()=>{}); assert.deepEqual(mixer.get('ym2612'),mix(.5,-.1));
  for(const factoryDefaults of [null,kinds([{name:'x',volume:2.001}]),kinds([{name:'x',volume:NaN}]),kinds([{name:'x',volume:-1}]),kinds([{name:'x',muted:true}]),kinds([{name:'x',volume:1},{name:'x',volume:.5}])]){
    assert.throws(()=>new SoundChipMixer({factoryDefaults}));
  }
  for(const factoryEntries of [null,state([{id:'x',settings:{volume:.5}}]),state([entry('x','x',{volume:2.001})]),state([entry('x','x',{volume:NaN})]),state([entry('x','x',{muted:true})]),state([entry('x','x',{solo:true})]),state([entry('x','x',{volume:.3}),entry('x','x',{volume:.4})])]){
    assert.throws(()=>new SoundChipMixer({factoryDefaults:before.factoryDefaults,factoryEntries}));
  }
  assert.doesNotThrow(()=>new SoundChipMixer({factoryDefaults:kinds([{name:'x',volume:2}]),factoryEntries:state([entry('x','x',{volume:0})])}));
  assert.deepEqual(mixer.exportDefaults(),kinds([])); assert.deepEqual(mixer.exportState(),state([]));
});
