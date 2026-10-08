import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioPreferences, AUDIO_PREFERENCES_KEY, effectDefaults} from './audio_preferences.js';
const storage = () => {const data=new Map();return {getItem:k=>data.get(k) ?? null,setItem:(k,v)=>data.set(k,v)};};
test('effect, master and chip balances survive a new app instance, including absent chips', () => {
 const disk=storage(),first=createAudioPreferences(disk);
 first.setEffect({...effectDefaults(),enabled:true,bass:4,gain:120,reverb:23,noiseGate:10});
 first.setMaster(.75);first.setChip('gameBoyDmg',{gain:.41,pan:-.5,muted:true});
 first.setChip('ym2612',{gain:.6,pan:.2,muted:false});
 const second=createAudioPreferences(disk);
 assert.deepEqual(second.getEffect(),first.getEffect());assert.equal(second.getMaster(),.75);
 assert.deepEqual(second.getChip('gameBoyDmg'),{gain:.41,pan:-.5,muted:true});
 assert.equal(second.getChip('ym2612').gain,.6);assert.equal(second.getChip('psg').gain,1);
 second.resetMixer();const third=createAudioPreferences(disk);
 assert.equal(third.getMaster(),1);assert.deepEqual(third.getChip('gameBoyDmg'),{gain:.28,pan:0,muted:false});
 assert.equal(third.getChip('ym2612').gain,1);assert.equal(third.getEffect().enabled,true);
 third.setEffect(effectDefaults());assert.deepEqual(createAudioPreferences(disk).getEffect(),effectDefaults());
});
test('corrupt and unavailable storage do not prevent playback; invalid fields restore defaults', () => {
 const disk=storage();disk.setItem(AUDIO_PREFERENCES_KEY,'{broken');
 assert.deepEqual(createAudioPreferences(disk).getEffect(),effectDefaults());
 disk.setItem(AUDIO_PREFERENCES_KEY,JSON.stringify({effect:{enabled:true,gain:999,bass:'12',reverb:40},master:-2,chips:{gameBoyDmg:{gain:5,pan:9,muted:'yes'}}}));
 const prefs=createAudioPreferences(disk);
 assert.equal(prefs.getEffect().gain,100);assert.equal(prefs.getEffect().bass,0);assert.equal(prefs.getEffect().reverb,40);
 assert.equal(prefs.getMaster(),1);assert.deepEqual(prefs.getChip('gameBoyDmg'),{gain:.28,pan:0,muted:false});
 const blocked=createAudioPreferences({getItem(){throw Error('blocked');},setItem(){throw Error('quota');}});
 blocked.setMaster(.5);assert.equal(blocked.getMaster(),.5);
 blocked.setEffect({...effectDefaults(),enabled:true});assert.equal(blocked.getEffect().enabled,true);
});
