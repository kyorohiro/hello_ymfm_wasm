import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundChipMixer} from './soundchip_mixer.js';
const defaults = kinds => ({version:1,kinds});
const state = entries => ({version:1,entries});

test('common kind policy recomputes outputs beneath explicit project overrides without baking fallbacks', () => {
  const mixer = new SoundChipMixer(), applied = {};
  mixer.configureDefaults(defaults([{name:'gameboy',volume:.4,pan:.1}]));
  assert.deepEqual(mixer.getKindDefault('gameboy'),{volume:.4,pan:.1});
  mixer.set('lead',{pan:-.5});
  mixer.register('lead','gameboy',settings=>{applied.lead=settings;});
  mixer.register('other','gameboy',settings=>{applied.other=settings;});
  mixer.set('lead',{muted:true,solo:true});
  assert.deepEqual(mixer.exportState(),state([{id:'lead',name:'gameboy',settings:{pan:-.5,muted:true,solo:true}}]));
  let notifications=0;mixer.subscribe(()=>notifications++);
  mixer.setKindDefault('gameboy',{volume:.6,pan:.3});
  assert.equal(notifications,1);
  assert.deepEqual(mixer.get('lead'),{volume:.6,pan:-.5,muted:true,solo:true});
  assert.deepEqual(mixer.get('other'),{volume:.6,pan:.3,muted:false,solo:false});
  assert.equal(applied.other.effectiveMuted,true);
  assert.deepEqual(mixer.exportDefaults(),defaults([{name:'gameboy',volume:.6,pan:.3}]));
  mixer.reset('lead');
  assert.deepEqual(mixer.exportState(),state([]));
  assert.deepEqual(mixer.get('lead'),{volume:.6,pan:.3,muted:false,solo:false});
  mixer.configureDefaults(defaults([]));
  assert.deepEqual(mixer.get('lead'),{volume:.28,pan:0,muted:false,solo:false});
});

test('project JSON roundtrip retains disconnected stable IDs, explicit false/zero, and optional pre-start kind', () => {
  const mixer=new SoundChipMixer();
  const release=mixer.register('bass','ym2612',()=>{});
  mixer.set('bass',{volume:0,pan:0,muted:false,solo:false});release();
  mixer.set('pending',{pan:.25});
  const json=JSON.stringify(mixer.exportState());
  const restored=new SoundChipMixer();
  restored.configureDefaults(defaults([{name:'ym2612',volume:.8},{name:'gameboy',volume:.4}]));
  restored.restoreState(JSON.parse(json));
  assert.deepEqual(restored.list(),[]);
  assert.equal(JSON.stringify(restored.exportState()),json);
  restored.register('pending','gameboy',()=>{});
  assert.deepEqual(restored.get('pending'),{volume:.4,pan:.25,muted:false,solo:false});
  restored.register('bass','ym2612',()=>{});
  assert.deepEqual(restored.get('bass'),{volume:0,pan:0,muted:false,solo:false});
  assert.equal(restored.exportState().entries.find(entry=>entry.id==='pending').name,'gameboy');
});

test('restore replaces project state atomically while preserving live registration and meter release identities', () => {
  const mixer=new SoundChipMixer(), applied=[],meter=[];
  const release=mixer.register('live','ym2612',settings=>applied.push(settings),{setMetering:value=>meter.push(value)});
  const original=mixer.entries.get('live');
  mixer.set('live',{volume:.2,solo:true});
  mixer.set('old-prepared',{muted:true});
  const disconnected=mixer.register('old-disconnected','segapsg',()=>{});
  mixer.set('old-disconnected',{volume:.3});disconnected();
  let notifications=0;mixer.subscribe(()=>notifications++);
  const before=applied.length;
  mixer.restoreState(state([{id:'live',name:'ym2612',settings:{pan:-1}},{id:'later',name:'gameboy',settings:{volume:.7}}]));
  assert.equal(mixer.entries.get('live'),original);
  assert.equal(applied.length,before+1);assert.equal(notifications,1);
  assert.deepEqual(mixer.get('live'),{volume:1,pan:-1,muted:false,solo:false});
  assert.deepEqual(mixer.list().map(entry=>entry.id),['live']);
  assert.equal(mixer.retained.has('old-prepared'),false);assert.equal(mixer.retained.has('old-disconnected'),false);
  release();assert.deepEqual(mixer.list(),[]);assert.deepEqual(meter,[false,false]);
  assert.deepEqual(mixer.exportState(),state([{id:'later',name:'gameboy',settings:{volume:.7}},{id:'live',name:'ym2612',settings:{pan:-1}}]));
  mixer.restoreState(state([]));assert.deepEqual(mixer.exportState(),state([]));
});

test('known-kind overrides cannot leak into a different chip sharing the same explicit ID', () => {
  const mixer=new SoundChipMixer();
  mixer.restoreState(state([{id:'lead',name:'gameboy',settings:{volume:.2,muted:true}}]));
  const release=mixer.register('lead','ym2612',()=>{});
  assert.deepEqual(mixer.get('lead'),{volume:1,pan:0,muted:false,solo:false});
  assert.equal(mixer.exportState().entries[0].name,'gameboy');
  release();
  const reconnect=mixer.register('lead','gameboy',()=>{});
  assert.equal(mixer.get('lead').volume,.2);assert.equal(mixer.get('lead').muted,true);
  reconnect();
  const current=mixer.register('lead','ym2612',()=>{});
  mixer.set('lead',{pan:.5});
  assert.deepEqual(mixer.exportState(),state([{id:'lead',name:'ym2612',settings:{pan:.5}}]));
  current();
});

test('automatic identity stays transient while explicit numeric-looking IDs persist and reserved persisted IDs are skipped', () => {
  const mixer=new SoundChipMixer();
  const first=mixer.reserveId('ym2612');
  const next=`ym2612:${Number(first.id.split(':').at(-1))+1}`;first.release();
  mixer.restoreState(state([{id:next,name:'ym2612',settings:{volume:.3}}]));
  const automatic=mixer.reserveId('ym2612');assert.notEqual(automatic.id,next);
  const drop=mixer.register(automatic.id,'ym2612',()=>{});automatic.release();
  mixer.set(automatic.id,{volume:.1,solo:true});
  assert.deepEqual(mixer.exportState(),state([{id:next,name:'ym2612',settings:{volume:.3}}]));
  drop();assert.equal(mixer.retained.has(automatic.id),false);
  const explicit=mixer.reserveId('ym2612',next);
  const release=mixer.register(explicit.id,'ym2612',()=>{});explicit.release();
  assert.equal(mixer.get(next).volume,.3);release();
  assert.deepEqual(mixer.exportState(),state([{id:next,name:'ym2612',settings:{volume:.3}}]));
  const failed=mixer.reserveId('gameboy');failed.release();
  assert.equal(mixer.transientIds.has(failed.id),false);
});

test('invalid defaults/project imports validate every entry and cap JSON records without touching live state', () => {
  const mixer=new SoundChipMixer(),applied=[];
  mixer.register('live','ym2612',settings=>applied.push(settings));mixer.set('live',{volume:.7});
  mixer.configureDefaults(defaults([{name:'gameboy',volume:.4}]));
  const savedState=mixer.exportState(),savedDefaults=mixer.exportDefaults(),count=applied.length;
  const badDefaults=[null,{},defaults([{name:'gameboy',muted:true}]),defaults([{name:'gameboy',volume:NaN}]),
    defaults([{name:'x',volume:1},{name:'x',pan:0}]),defaults([{name:'x',pan:Infinity}]),
    defaults(Array.from({length:129},(_,i)=>({name:`kind-${i}`,volume:1}))),defaults([{name:'x'.repeat(257),volume:1}])];
  const badStates=[null,{},state([{id:'live',settings:{volume:.4}},{id:'bad',settings:{pan:2}}]),
    state([{id:'live',settings:{volume:.4}},{id:'live',settings:{pan:0}}]),state([{id:'a',settings:{solo:undefined}}]),
    state([{id:'a',name:undefined,settings:{volume:1}}]),state([{id:'a',settings:{effectiveMuted:true}}]),
    state([{id:'a',settings:{volume:.2},connected:true}]),state(Array.from({length:513},(_,i)=>({id:`id-${i}`,settings:{volume:1}}))),
    state([{id:'a'.repeat(257),settings:{volume:1}}]),{version:2,entries:[]}];
  for(const policy of badDefaults)assert.throws(()=>mixer.configureDefaults(policy));
  for(const policy of badStates)assert.throws(()=>mixer.restoreState(policy));
  assert.deepEqual(mixer.exportState(),savedState);assert.deepEqual(mixer.exportDefaults(),savedDefaults);assert.equal(applied.length,count);
  assert.throws(()=>mixer.configureDefaults(JSON.parse('{"version":1,"kinds":[],"__proto__":{}}')));
  assert.equal({}.polluted,undefined);
});

test('import/export copies records, does not persist derived solo/meter state, and supports safe map-key identifiers', () => {
  const mixer=new SoundChipMixer();
  const common=defaults([{name:'__proto__',volume:.6}]);mixer.configureDefaults(common);common.kinds[0].volume=.2;
  const project=state([{id:'__proto__',name:'__proto__',settings:{pan:.5,solo:true}}]);mixer.restoreState(project);
  project.entries[0].settings.pan=-1;
  mixer.register('__proto__','__proto__',()=>{});
  const exported=mixer.exportState();exported.entries[0].settings.pan=-.2;
  assert.deepEqual(mixer.get('__proto__'),{volume:.6,pan:.5,muted:false,solo:true});
  assert.deepEqual(mixer.exportState(),state([{id:'__proto__',name:'__proto__',settings:{pan:.5,solo:true}}]));
  assert.deepEqual(Object.keys(mixer.exportState().entries[0]).sort(),['id','name','settings']);
  assert.deepEqual(mixer.exportDefaults(),defaults([{name:'__proto__',volume:.6}]));
});

test('project import parks an explicit ID colliding with a live or still initializing automatic output', () => {
  for(const connected of [false,true]){
    const mixer=new SoundChipMixer();
    const automatic=mixer.reserveId('ym2612');
    let release=connected?mixer.register(automatic.id,'ym2612',()=>{}):null;
    const saved=state([{id:automatic.id,name:'gameboy',settings:{volume:.3,pan:.5}}]);
    mixer.restoreState(saved);
    assert.deepEqual(mixer.exportState(),saved);
    if(!connected)release=mixer.register(automatic.id,'ym2612',()=>{});
    automatic.release();
    assert.equal(mixer.get(automatic.id).volume,1);
    mixer.set(automatic.id,{volume:.7});
    assert.deepEqual(mixer.exportState(),saved,'automatic edits cannot overwrite the parked project source');
    release();assert.equal(mixer.deferredState.size,0);
    assert.deepEqual(mixer.exportState(),saved);
    mixer.register(automatic.id,'gameboy',()=>{});
    assert.equal(mixer.get(automatic.id).volume,.3);
  }
  const mixer=new SoundChipMixer(), pending=mixer.reserveId('ym2612');
  const saved=state([{id:pending.id,name:'gameboy',settings:{volume:.3}}]);
  mixer.restoreState(saved);pending.release();
  assert.equal(mixer.deferredState.size,0);assert.deepEqual(mixer.exportState(),saved);
});

test('project imports never persist source connection changes or callback references', () => {
  const mixer=new SoundChipMixer();
  mixer.restoreState(state([{id:'same',name:'ym2612',settings:{pan:.4}}]));
  const before=JSON.stringify(mixer.exportState());
  const release=mixer.register('same','ym2612',()=>{});assert.equal(JSON.stringify(mixer.exportState()),before);
  release();assert.equal(JSON.stringify(mixer.exportState()),before);
  const other=mixer.register('new','segapsg',()=>{});assert.equal(JSON.stringify(mixer.exportState()),before);
  other();assert.equal(JSON.stringify(mixer.exportState()),before);
});
