import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundChipMixer} from '../../web/soundchip_mixer.js';
import {createVirtualFileSystem} from './playground_virtual_files.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from './playground_cassette.js';
import {createPlaygroundMixerState,MIXER_STATE_PATH,MIXER_DEFAULTS_KEY} from './playground_mixer_state.js';

function fixture({mixer=new SoundChipMixer(),files=createVirtualFileSystem([]),storage=new Map()}={}) {
  const timers=new Map(),errors=[],writes=[],memberships=[];let next=0;
  const defaults={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  const state=createPlaygroundMixerState({mixer,files,getStorage:()=>defaults,
    setTimer:callback=>{timers.set(++next,callback);return next;},clearTimer:id=>timers.delete(id),
    onWrite:(path,change)=>{writes.push(path);memberships.push(change);},onError:error=>errors.push(error.message)});
  return {state,mixer,files,storage,defaults,timers,errors,writes,memberships,
    runTimers(){for(const [id,callback]of [...timers]){timers.delete(id);callback();}}};
}

test('common defaults survive new projects while project mute/solo and explicit overrides do not',t=>{
  const f=fixture();t.after(()=>f.state.dispose());
  f.mixer.register('ym2612','ym2612',()=>{});
  assert.equal(f.files.has(MIXER_STATE_PATH),false,'connecting audio alone must not create a settings file');
  f.mixer.set('ym2612',{volume:.6,pan:-.2,muted:true,solo:true});
  f.state.saveDefault('ym2612');
  assert.deepEqual(JSON.parse(f.storage.get(MIXER_DEFAULTS_KEY)),{version:1,kinds:[{name:'ym2612',volume:.6,pan:-.2}]});
  f.runTimers();assert.equal(f.writes.length,1);
  assert.deepEqual(JSON.parse(f.files.get(MIXER_STATE_PATH).data).entries[0].settings,{volume:.6,pan:-.2,muted:true,solo:true});
  f.state.replaceProject(()=>f.files.replace([{path:'/index.js',data:'// New project'}]));
  assert.deepEqual(f.mixer.get('ym2612'),{volume:.6,pan:-.2,muted:false,solo:false});
  assert.equal(f.files.has(MIXER_STATE_PATH),false);assert.equal(f.timers.size,0);
  const another=fixture({storage:f.storage});t.after(()=>another.state.dispose());
  another.mixer.register('ym2612','ym2612',()=>{});
  assert.deepEqual(another.mixer.get('ym2612'),{volume:.6,pan:-.2,muted:false,solo:false});
});

test('project settings round-trip with a Cassette and override only selected common values',async t=>{
  const storage=new Map([[MIXER_DEFAULTS_KEY,JSON.stringify({version:1,kinds:[{name:'segapsg',volume:.3,pan:.4}]})]]);
  const f=fixture({storage});t.after(()=>f.state.dispose());
  const release=f.mixer.register('lead','segapsg',()=>{});
  f.mixer.set('lead',{volume:.7,muted:true});f.state.flush();release();
  const zip=createPlaygroundCassetteZip(f.files.list()),cassette=await loadPlaygroundCassette(zip);
  const files=createVirtualFileSystem([...cassette.files].filter(([path])=>path==='mixer/state.json').map(([path,data])=>({path,data:new TextDecoder().decode(data)})));
  const restored=fixture({files,storage});t.after(()=>restored.state.dispose());
  const cleanup=restored.mixer.register('lead','segapsg',()=>{});
  assert.deepEqual(restored.mixer.get('lead'),{volume:.7,pan:.4,muted:true,solo:false});
  restored.state.resetProject('lead');
  assert.deepEqual(restored.mixer.get('lead'),{volume:.3,pan:.4,muted:false,solo:false});
  assert.equal(files.has(MIXER_STATE_PATH),false);
  cleanup();assert.deepEqual(restored.mixer.list(),[],'policy restore must not break output cleanup identity');
});

test('slider edits coalesce; flush captures the latest values before export and never persists generated IDs',t=>{
  const f=fixture();t.after(()=>f.state.dispose());f.mixer.register('segapsg','segapsg',()=>{});
  for(let i=1;i<=10;i++)f.mixer.set('segapsg',{volume:i/10});
  assert.equal(f.timers.size,1);assert.equal(f.writes.length,0);
  f.state.flush();assert.equal(f.timers.size,0);assert.equal(f.writes.length,1);
  assert.deepEqual(f.memberships,[{created:true,removed:false}]);
  assert.equal(JSON.parse(f.files.get(MIXER_STATE_PATH).data).entries[0].settings.volume,1);
  const reservation=f.mixer.reserveId('segapsg');const release=f.mixer.register(reservation.id,'segapsg',()=>{});reservation.release();
  f.mixer.set(reservation.id,{volume:.2});release();f.runTimers();
  assert.equal(f.writes.length,1,'automatic IDs never become stored project identities');
  f.mixer.set('segapsg',{volume:.3});f.state.flush();
  assert.deepEqual(f.memberships.at(-1),{created:false,removed:false},'ordinary slider saves do not rebuild the asset tree');
  f.state.resetProject('segapsg');assert.deepEqual(f.memberships.at(-1),{created:false,removed:true});
});

test('manual JSON edits apply atomically; malformed files survive slider edits and recover when corrected',t=>{
  const f=fixture();t.after(()=>f.state.dispose());f.mixer.register('ym2612','ym2612',()=>{});
  const record=volume=>JSON.stringify({version:1,entries:[{id:'ym2612',name:'ym2612',settings:{volume}}]});
  f.files.writeText(MIXER_STATE_PATH,record(.4));assert.equal(f.mixer.get('ym2612').volume,.4);
  const invalid='{ "version": 1, "entries": [';
  f.files.writeText(MIXER_STATE_PATH,invalid);assert.equal(f.mixer.get('ym2612').volume,.4);
  f.mixer.set('ym2612',{volume:.8});assert.equal(f.state.flush(),false);
  assert.equal(f.files.get(MIXER_STATE_PATH).data,invalid);assert(f.errors.some(error=>error.includes('fix the file')));
  f.files.writeText(MIXER_STATE_PATH,record(.5));assert.equal(f.mixer.get('ym2612').volume,.5);
  f.files.delete(MIXER_STATE_PATH);assert.equal(f.mixer.get('ym2612').volume,1);
});

test('replacing a project cancels old timers and invalid incoming state cannot retain the old mix',t=>{
  const f=fixture();t.after(()=>f.state.dispose());f.mixer.register('ym2612','ym2612',()=>{});
  f.mixer.set('ym2612',{volume:.2});assert.equal(f.timers.size,1);
  f.state.replaceProject(()=>f.files.replace([{path:MIXER_STATE_PATH,data:'invalid'}]));
  f.runTimers();assert.equal(f.timers.size,0);assert.equal(f.mixer.get('ym2612').volume,1);
  assert.equal(f.files.get(MIXER_STATE_PATH).data,'invalid');
});

test('read-only common storage rolls back common policy without undoing the project mix',t=>{
  const f=fixture();t.after(()=>f.state.dispose());f.mixer.register('lead','segapsg',()=>{});
  f.mixer.set('lead',{volume:.3});f.defaults.setItem=()=>{throw new Error('Storage is full');};
  assert.throws(()=>f.state.saveDefault('lead'),/Storage is full/);
  assert.deepEqual(f.mixer.exportDefaults(),{version:1,kinds:[]});
  assert.equal(f.mixer.get('lead').volume,.3);assert.equal(f.storage.size,0);
});

test('a failed project replacement retains its pending mix and still saves it',t=>{
  const f=fixture();t.after(()=>f.state.dispose());f.mixer.register('lead','segapsg',()=>{});
  f.mixer.set('lead',{volume:.2});
  assert.throws(()=>f.state.replaceProject(()=>{throw Error('Invalid project');}),/Invalid project/);
  assert.equal(f.mixer.get('lead').volume,.2);assert.equal(f.timers.size,1);
  f.runTimers();assert.equal(JSON.parse(f.files.get(MIXER_STATE_PATH).data).entries[0].settings.volume,.2);
});

test('malformed common storage is isolated from valid project settings and startup creates no audio',t=>{
  const storage=new Map([[MIXER_DEFAULTS_KEY,'not JSON']]);
  const files=createVirtualFileSystem([{path:MIXER_STATE_PATH,data:JSON.stringify({version:1,entries:[{id:'lead',name:'segapsg',settings:{volume:.2}}]})}]);
  const f=fixture({storage,files});t.after(()=>f.state.dispose());
  assert.equal(f.mixer.get('lead').volume,.2);assert.equal(f.writes.length,0);assert(f.errors.length);
  assert.equal(f.storage.get(MIXER_DEFAULTS_KEY),'not JSON');
});

test('disposing state flushes once and detaches all subscriptions and timers',()=>{
  const f=fixture();f.mixer.register('lead','segapsg',()=>{});f.mixer.set('lead',{volume:.4});f.state.dispose();
  assert.equal(f.writes.length,1);assert.equal(f.timers.size,0);
  f.mixer.set('lead',{volume:.8});f.files.replace([]);f.runTimers();
  assert.equal(f.files.has(MIXER_STATE_PATH),false);assert.equal(f.writes.length,1);assert.equal(f.mixer.get('lead').volume,.8);
});

test('the largest allowed project schema remains readable after saving escaped identifiers',t=>{
  const f=fixture();t.after(()=>f.state.dispose());
  const name='\u0001'.repeat(255)+'x';
  const state={version:1,entries:Array.from({length:512},(_,i)=>({id:'\u0001'.repeat(250)+i,name,settings:{volume:.4}}))};
  f.files.writeText(MIXER_STATE_PATH,JSON.stringify(state));assert.equal(f.errors.length,0);
  f.mixer.set(state.entries[0].id,{volume:.6});assert.equal(f.state.flush(),true);
  const restored=fixture({files:createVirtualFileSystem([{path:MIXER_STATE_PATH,data:f.files.get(MIXER_STATE_PATH).data}])});
  t.after(()=>restored.state.dispose());assert.equal(restored.errors.length,0);assert.equal(restored.mixer.exportState().entries.length,512);
});
