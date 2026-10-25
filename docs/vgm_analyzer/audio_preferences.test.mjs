import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioPreferences, AUDIO_PREFERENCES_KEY, effectDefaults} from './audio_preferences.js';
import {mixerDefaults} from './mixer_defaults.js';
const storage = () => {const data=new Map();return {getItem:k=>data.get(k) ?? null,setItem:(k,v)=>data.set(k,v)};};
test('effect, master and chip balances survive a new app instance, including absent chips', () => {
 const disk=storage(),first=createAudioPreferences(disk);
 first.setEffect({...effectDefaults(),enabled:true,bass:4,gain:120,reverb:23,noiseGate:10});
 first.setMaster(.75);first.setChip('gameBoyDmg',{gain:.41,pan:-.5,muted:true});
 first.setChip('ym2612',{gain:.6,pan:.2,muted:false});
 const second=createAudioPreferences(disk);
 assert.deepEqual(second.getEffect(),first.getEffect());assert.equal(second.getMaster(),.75);
 assert.deepEqual(second.getChip('gameBoyDmg'),{gain:.41,pan:-.5,muted:true});
 assert.equal(second.getChip('ym2612').gain,.6);assert.deepEqual(second.getChip('psg'),mixerDefaults('psg'));
 second.resetMixer();const third=createAudioPreferences(disk);
 assert.equal(third.getMaster(),1);assert.deepEqual(third.getChip('gameBoyDmg'),mixerDefaults('gameBoyDmg'));
 assert.deepEqual(third.getChip('ym2612'),mixerDefaults('ym2612'));assert.equal(third.getEffect().enabled,true);
 third.setEffect(effectDefaults());assert.deepEqual(createAudioPreferences(disk).getEffect(),effectDefaults());
});
test('corrupt and unavailable storage do not prevent playback; invalid fields restore defaults', () => {
 const disk=storage();disk.setItem(AUDIO_PREFERENCES_KEY,'{broken');
 assert.deepEqual(createAudioPreferences(disk).getEffect(),effectDefaults());
 disk.setItem(AUDIO_PREFERENCES_KEY,JSON.stringify({effect:{enabled:true,gain:999,bass:'12',reverb:40},master:-2,chips:{gameBoyDmg:{gain:5,pan:9,muted:'yes'}}}));
 const prefs=createAudioPreferences(disk);
 assert.equal(prefs.getEffect().gain,100);assert.equal(prefs.getEffect().bass,0);assert.equal(prefs.getEffect().reverb,40);
 assert.equal(prefs.getMaster(),1);assert.deepEqual(prefs.getChip('gameBoyDmg'),mixerDefaults('gameBoyDmg'));
 const blocked=createAudioPreferences({getItem(){throw Error('blocked');},setItem(){throw Error('quota');}});
 blocked.setMaster(.5);assert.equal(blocked.getMaster(),.5);
 blocked.setEffect({...effectDefaults(),enabled:true});assert.equal(blocked.getEffect().enabled,true);
});

test('partial saved fields keep contextual calibration dynamic without materializing a gain override',()=>{
 const genesis={kind:'ym2612'},other={kind:'ym3812'},disk=storage(),prefs=createAudioPreferences(disk);
 prefs.setChip('psg',{pan:.4});prefs.setChip('ym2612',{muted:true});
 const authored=JSON.parse(disk.getItem(AUDIO_PREFERENCES_KEY));
 assert.deepEqual(authored.chips.psg,{pan:.4});assert.deepEqual(authored.chips.ym2612,{muted:true});
 const reopened=createAudioPreferences(disk);
 assert.deepEqual(reopened.getChip('psg',genesis),{...mixerDefaults('psg',genesis),pan:.4});
 assert.deepEqual(reopened.getChip('psg',other),{...mixerDefaults('psg',other),pan:.4});
 assert.equal(reopened.getChip('psg',genesis).gain,reopened.getChip('psg',other).gain);
 assert.deepEqual(reopened.getChip('ym2612',genesis),{...mixerDefaults('ym2612',genesis),muted:true});
 reopened.setMaster(.8);
 assert.equal(Object.hasOwn(JSON.parse(disk.getItem(AUDIO_PREFERENCES_KEY)).chips.psg,'gain'),false);
});

test('legacy saved gains convert on read according to source owner without rewriting or compounding',()=>{
 const disk=storage();
 disk.setItem(AUDIO_PREFERENCES_KEY,JSON.stringify({chips:{psg:{gain:1,pan:0,muted:false},nesApu:{gain:0},ym2612:{gain:.6}}}));
 const original=disk.getItem(AUDIO_PREFERENCES_KEY),first=createAudioPreferences(disk);
 assert.equal(first.getChip('psg',{kind:'ym2612'}).gain,.35);
 assert.equal(first.getChip('psg',{kind:'ym3812'}).gain,1);
 assert.equal(first.getChip('nesApu').gain,0);assert.equal(first.getChip('ym2612',{kind:'ym2612'}).gain,.6*.9);
 assert.equal(disk.getItem(AUDIO_PREFERENCES_KEY),original,'Reading defaults must not persist a migration');
 first.setChip('psg',{muted:true});
 for(let index=0;index<3;index++){
  const next=createAudioPreferences(disk);next.setChip('psg',{pan:.2});
  assert.deepEqual(next.getChip('psg',{kind:'ym2612'}),{gain:.35,pan:.2,muted:true});
  assert.equal(next.getChip('psg',{kind:'ym3812'}).gain,1);
  assert.equal(JSON.parse(disk.getItem(AUDIO_PREFERENCES_KEY)).chips.psg.gain,1);
  assert.equal(Object.hasOwn(JSON.parse(disk.getItem(AUDIO_PREFERENCES_KEY)).chips.psg,'gainUnits'),false);
 }
 const last=createAudioPreferences(disk);last.resetMixer();
 assert.deepEqual(JSON.parse(disk.getItem(AUDIO_PREFERENCES_KEY)).chips,{});
 assert.deepEqual(last.getChip('psg',{kind:'ym2612'}),mixerDefaults('psg',{kind:'ym2612'}));
 assert.deepEqual(last.getChip('nesApu'),mixerDefaults('nesApu'));
});

test('former PSG levels retain their effective sound until Reset selects the new balance',()=>{
 const disk=storage(),old={psg:1.840254,ay8910:1.545813,nesApu:1.981272};
 disk.setItem(AUDIO_PREFERENCES_KEY,JSON.stringify({chips:Object.fromEntries(Object.entries(old).map(([id,gain])=>[id,{gain}]))}));
 const prefs=createAudioPreferences(disk),configuration={kind:'ym2612'};
 for(const [id,gain] of Object.entries(old))assert.equal(prefs.getChip(id,configuration).gain,id==='psg'?gain*.35:gain);
 prefs.setChip('psg',{pan:.3});
 assert.equal(createAudioPreferences(disk).getChip('psg',configuration).gain,old.psg*.35);
 prefs.resetMixer();
 const reset=createAudioPreferences(disk);
 for(const id of Object.keys(old))assert.deepEqual(reset.getChip(id,configuration),mixerDefaults(id,configuration));
 assert.deepEqual(JSON.parse(disk.getItem(AUDIO_PREFERENCES_KEY)).chips,{});
});

test('new gain edits use source units in every context while pan-only edits retain other legacy records',()=>{
 const disk=storage();disk.setItem(AUDIO_PREFERENCES_KEY,JSON.stringify({chips:{psg:{gain:1.3},ym2612:{gain:.8}}}));
 const prefs=createAudioPreferences(disk),genesis={kind:'ym2612'},standalone={kind:'ym3812'};
 prefs.setChip('psg',{gain:.35});prefs.setChip('psg',{pan:-.2,muted:true});prefs.setChip('ym2612',{pan:.4});
 const authored=JSON.parse(disk.getItem(AUDIO_PREFERENCES_KEY));
 assert.deepEqual(authored.chips.psg,{gain:.35,gainUnits:'source',pan:-.2,muted:true});
 assert.deepEqual(authored.chips.ym2612,{gain:.8,pan:.4});
 const reopened=createAudioPreferences(disk);
 for(const configuration of [genesis,standalone])assert.deepEqual(reopened.getChip('psg',configuration),{gain:.35,pan:-.2,muted:true});
 assert.equal(reopened.getChip('ym2612',genesis).gain,.8*.9);
 assert.equal(reopened.getChip('ym2612',standalone).gain,.8);
 for(const gain of [0,1,2]){
  reopened.setChip('psg',{gain});
  const next=createAudioPreferences(disk);
  assert.equal(next.getChip('psg',genesis).gain,gain);assert.equal(next.getChip('psg',standalone).gain,gain);
 }
});
