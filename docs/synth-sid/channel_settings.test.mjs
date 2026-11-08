// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDefaultPreset,presetToCode} from './preset.js';
import {createChannelSettings,readChannelSettings,selectedChannelPreset,selectChannelTarget,selectKeyboardMode,applyChannelPreset,editChannelPreset,channelPlaybackPlan,
  channelSettingsToCode,CHANNEL_SETTINGS_MAX_BYTES} from './channel_settings.js';
import {SidCore} from '../js/sid.js';
import {Sid8580Core} from '../js/sid8580.js';
import {SidSynth} from '../js/sidsynth.js';

const copy=value=>structuredClone(value);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function distinctChannels(){
  let settings=createChannelSettings();
  for(const [channel,waveform]of ['saw','pulse','triangle'].entries()){
    settings=selectChannelTarget(settings,channel);
    const preset=selectedChannelPreset(settings);preset.name=`Channel ${channel+1}`;
    Object.assign(preset.voice,{waveform,pulseWidth:400+channel*700,attack:channel,release:channel+4});
    settings=applyChannelPreset(settings,preset);
  }
  return settings;
}

test('channel setups round-trip detached voice data and start with the existing round-robin sound',()=>{
  const preset=createDefaultPreset(),settings=createChannelSettings(preset);
  assert.deepEqual(settings,{format:'tetorica-sid-channels',version:2,target:'round-robin',keyboardMode:'retrigger',channels:[preset,preset,preset]});
  const restored=readChannelSettings(JSON.stringify(settings));assert.deepEqual(restored,settings);
  restored.channels[0].voice.attack=13;restored.channels[0].filter.cutoff=2;
  assert.equal(settings.channels[0].voice.attack,2);assert.equal(preset.voice.attack,2);
  assert.equal(restored.channels[1].voice.attack,2);assert.equal(restored.channels[1].filter.cutoff,600);
  const selected=selectedChannelPreset(settings);selected.modulation.ratio=4;
  assert.equal(settings.channels[0].modulation.ratio,1);
  const legacy=copy(preset);legacy.version=1;delete legacy.model;
  assert.deepEqual(createChannelSettings(legacy),settings,'legacy single-voice imports migrate through the existing preset reader');
});

test('legacy channel files migrate to Retrigger while Legato survives selection, edits and sound replacement',()=>{
  const original=distinctChannels(),legacy=copy(original);legacy.version=1;delete legacy.keyboardMode;
  assert.deepEqual(readChannelSettings(legacy),original);
  assert.deepEqual(readChannelSettings(JSON.stringify(legacy)),original);
  const chosen=selectKeyboardMode(original,'legato');assert.equal(original.keyboardMode,'retrigger');
  assert.equal(chosen.keyboardMode,'legato');assert.deepEqual(chosen.channels,original.channels);
  assert.deepEqual(readChannelSettings(JSON.stringify(chosen)),chosen);
  for(const target of [0,1,2,'round-robin']){
    const selected=selectChannelTarget(chosen,target),edited=selectedChannelPreset(selected);edited.voice.attack=14;
    assert.equal(selected.keyboardMode,'legato');assert.equal(editChannelPreset(selected,edited).keyboardMode,'legato');
    assert.equal(applyChannelPreset(selected,createDefaultPreset()).keyboardMode,'legato');
    assert.deepEqual(channelPlaybackPlan(selected),channelPlaybackPlan(selectKeyboardMode(selected,'retrigger')),'the keyboard policy does not replace the hardware allocation plan');
  }
  assert.match(channelSettingsToCode(chosen),/Software keyboard mode: Legato keeps Gate on/);
  for(const value of ['',null,undefined,1,'Legato',true])assert.throws(()=>selectKeyboardMode(chosen,value));
  const noncanonical=copy(legacy);noncanonical.keyboardMode='legato';assert.throws(()=>readChannelSettings(noncanonical));
});

test('fixed channel edits preserve each sound while sharing model and filter across the chip',()=>{
  const original=distinctChannels(),settings=selectChannelTarget(original,1),before=copy(settings);
  const edited=selectedChannelPreset(settings);edited.model='8580';edited.name='Edited CH 2';
  Object.assign(edited.voice,{waveform:'noise',attack:11});edited.modulation={sync:true,ring:true,ratio:12139/9113};
  Object.assign(edited.filter,{enabled:true,mode:'notch',cutoff:1888,resonance:13,volume:11});
  const applied=applyChannelPreset(settings,edited);
  assert.deepEqual(settings,before,'input setup stays unchanged');assert.deepEqual(applied.channels[1],edited);
  for(const channel of [0,2]){
    assert.equal(applied.channels[channel].name,settings.channels[channel].name);
    assert.deepEqual(applied.channels[channel].voice,settings.channels[channel].voice);
    assert.deepEqual(applied.channels[channel].modulation,settings.channels[channel].modulation);
  }
  for(const preset of applied.channels){assert.equal(preset.model,'8580');assert.deepEqual(preset.filter,edited.filter);}
  const reopened=readChannelSettings(JSON.stringify(applied));
  for(let channel=0;channel<3;channel++)assert.deepEqual(selectedChannelPreset(selectChannelTarget(reopened,channel)),applied.channels[channel]);
  applied.channels[0].filter.cutoff=9;assert.equal(applied.channels[1].filter.cutoff,1888,'shared values do not alias caller-owned objects');
});

test('selecting round robin preserves all sounds and parameter edits broadcast only the changed fields',()=>{
  const settings=selectChannelTarget(distinctChannels(),1),before=copy(settings);
  const roundRobin=selectChannelTarget(settings,'round-robin');
  assert.deepEqual(roundRobin.channels,settings.channels);assert.deepEqual(settings,before);
  assert.deepEqual(readChannelSettings(JSON.stringify(roundRobin)),roundRobin);
  assert.deepEqual(selectedChannelPreset(roundRobin),settings.channels[0],'CH 1 is the displayed editing baseline');
  assert.deepEqual(editChannelPreset(roundRobin,selectedChannelPreset(roundRobin)),roundRobin,'an unchanged value does not unify channels');
  const edit=selectedChannelPreset(roundRobin);edit.voice.attack=12;
  const next=editChannelPreset(roundRobin,edit);
  for(let channel=0;channel<3;channel++)assert.deepEqual(next.channels[channel],{...roundRobin.channels[channel],voice:{...roundRobin.channels[channel].voice,attack:12}});
  assert.deepEqual(roundRobin.channels,settings.channels,'broadcast edits do not mutate the input');
  next.channels[0].voice.attack=15;assert.equal(next.channels[1].voice.attack,12);
  assert.deepEqual(selectedChannelPreset(selectChannelTarget(roundRobin,2)),settings.channels[2]);
});

test('complete voice replacement is distinct from an ordinary round-robin parameter edit',()=>{
  const settings=selectChannelTarget(distinctChannels(),'round-robin'),edit=selectedChannelPreset(settings);edit.voice.waveform='noise';
  const patched=editChannelPreset(settings,edit),loaded=applyChannelPreset(settings,edit);
  for(let channel=0;channel<3;channel++){
    assert.equal(patched.channels[channel].voice.waveform,['noise','pulse+noise','triangle+noise'][channel]);
    assert.equal(patched.channels[channel].voice.pulseWidth,settings.channels[channel].voice.pulseWidth);
    assert.deepEqual(loaded.channels[channel],edit,'an explicit voice load replaces the whole sound on all three');
  }
  const name=selectedChannelPreset(patched);name.name='Shared name';name.model='8580';name.filter.cutoff=1000;
  const renamed=editChannelPreset(patched,name);
  for(let channel=0;channel<3;channel++){
    assert.equal(renamed.channels[channel].name,'Shared name');assert.equal(renamed.channels[channel].model,'8580');
    assert.equal(renamed.channels[channel].filter.cutoff,1000);assert.equal(renamed.channels[channel].voice.pulseWidth,settings.channels[channel].voice.pulseWidth);
  }
  const fixed=selectChannelTarget(settings,1);assert.deepEqual(editChannelPreset(fixed,edit),applyChannelPreset(fixed,edit));
});

test('round-robin waveform toggles broadcast only changed bits and preserve other channel waveform selections',()=>{
  const original=selectChannelTarget(distinctChannels(),'round-robin');
  const add=selectedChannelPreset(original);add.voice.waveform='saw+pulse';
  const added=editChannelPreset(original,add);
  assert.deepEqual(added.channels.map(p=>p.voice.waveform),['saw+pulse','pulse','triangle+pulse']);
  const remove=selectedChannelPreset(added);remove.voice.waveform='pulse';
  const removed=editChannelPreset(added,remove);
  assert.deepEqual(removed.channels.map(p=>p.voice.waveform),['pulse','pulse','triangle+pulse']);
  for(let i=0;i<3;i++){
    assert.equal(removed.channels[i].voice.attack,original.channels[i].voice.attack);
    assert.equal(removed.channels[i].voice.pulseWidth,original.channels[i].voice.pulseWidth);
  }
  const full=applyChannelPreset(original,add);assert(full.channels.every(p=>p.voice.waveform==='saw+pulse'),'an explicit preset load still replaces the full waveform selection');
});

test('channel setups reject mismatched shared hardware and malformed data',()=>{
  const mutations=[value=>value.extra=1,value=>delete value.target,value=>value.format='sid',value=>value.version=3,value=>value.version='1',
    value=>delete value.keyboardMode,value=>value.keyboardMode='Legato',value=>value.keyboardMode=null,
    value=>value.target='0',value=>value.target=3,value=>value.target=-1,value=>value.target=1.5,value=>value.target=null,
    value=>value.channels=[],value=>value.channels.pop(),value=>value.channels.push(value.channels[0]),value=>delete value.channels[1],
    value=>value.channels.extra=1,value=>value.channels[Symbol('extra')]=1,value=>value.channels[0].voice.attack=16,
    value=>value.channels[1].model='8580',value=>value.channels[1].filter.cutoff++];
  for(const mutate of mutations){const settings=createChannelSettings();mutate(settings);assert.throws(()=>readChannelSettings(settings));assert.throws(()=>channelSettingsToCode(settings));}
  for(const value of [null,[],true,5,'{broken',new Date(),Object.create(createChannelSettings())])assert.throws(()=>readChannelSettings(value));
  const symbol=createChannelSettings();symbol[Symbol('extra')]=1;assert.throws(()=>readChannelSettings(symbol));
  const legacy=createChannelSettings();legacy.channels[0].version=1;delete legacy.channels[0].model;
  assert.throws(()=>readChannelSettings(legacy),/preset version 2/,'channel files have one canonical voice schema');
  for(const value of [undefined,null,'1',3,-1,NaN])assert.throws(()=>selectChannelTarget(createChannelSettings(),value));
});

test('playback planning preserves mixed voices and retains the one-pair Sync/Ring limit',()=>{
  const mixed=selectChannelTarget(distinctChannels(),'round-robin'),before=copy(mixed);
  assert.deepEqual(channelPlaybackPlan(mixed),{channels:[0,1,2],carrier:0,source:null});
  for(let channel=0;channel<3;channel++)assert.deepEqual(channelPlaybackPlan(selectChannelTarget(mixed,channel)),{channels:[channel],carrier:channel,source:null});
  mixed.channels[1].modulation={sync:true,ring:false,ratio:1.75};mixed.channels[2].modulation={sync:false,ring:true,ratio:2};
  assert.deepEqual(channelPlaybackPlan(mixed),{channels:[1],carrier:1,source:0},'the first configured pair is the one active carrier');
  assert.deepEqual(channelPlaybackPlan(selectChannelTarget(mixed,2)),{channels:[2],carrier:2,source:1},'fixed selection can use another saved pair');
  assert.deepEqual(channelPlaybackPlan(selectChannelTarget(mixed,0)),{channels:[0],carrier:0,source:null},'other saved pairs do not change a fixed independent channel');
  const plan=channelPlaybackPlan(before);plan.channels[0]=2;assert.deepEqual(channelPlaybackPlan(before).channels,[0,1,2]);
  assert.deepEqual(before,selectChannelTarget(distinctChannels(),'round-robin'));
});

test('channel data accessors are rejected without executing caller code',()=>{
  let reads=0;
  for(const field of ['format','version','target','keyboardMode','channels']){
    const settings=createChannelSettings();Object.defineProperty(settings,field,{enumerable:true,get(){reads++;throw Error('Unexpected getter');}});
    assert.throws(()=>readChannelSettings(settings),/accessors/);
  }
  const settings=createChannelSettings();Object.defineProperty(settings.channels,1,{enumerable:true,get(){reads++;throw Error('Unexpected slot getter');}});
  assert.throws(()=>readChannelSettings(settings),/accessors/);
  const nested=createChannelSettings();Object.defineProperty(nested.channels[0].voice,'attack',{enumerable:true,get(){reads++;throw Error('Unexpected voice getter');}});
  assert.throws(()=>readChannelSettings(nested),/accessors/);assert.equal(reads,0);
  const inherited=createChannelSettings();Object.setPrototypeOf(inherited.channels,{get map(){reads++;throw Error('Unexpected inherited getter');}});
  assert.throws(()=>readChannelSettings(inherited),/plain array/);assert.equal(reads,0);
});

test('channel JSON is bounded by UTF-8 bytes before parsing and permits the exact 64 KiB boundary',()=>{
  const payload=JSON.stringify(createChannelSettings()),padded=payload+' '.repeat(CHANNEL_SETTINGS_MAX_BYTES-payload.length);
  assert.deepEqual(readChannelSettings(padded),createChannelSettings());
  assert.throws(()=>readChannelSettings(padded+' '),/exceed 64 KiB/);
  const unicode='{"extra":"'+'é'.repeat(33000)+'"}';
  assert(unicode.length<CHANNEL_SETTINGS_MAX_BYTES);assert.throws(()=>readChannelSettings(unicode),/exceed 64 KiB/);
});

test('round-robin JavaScript keeps the existing portable export exactly, including both models and ratios',()=>{
  for(const model of ['6581','8580'])for(const paired of [false,true]){
    const preset=createDefaultPreset({model});preset.modulation={sync:paired,ring:paired,ratio:12139/9113};
    assert.equal(channelSettingsToCode(createChannelSettings(preset)),presetToCode(preset));
  }
});

test('fixed-channel JavaScript preserves stored voices and auditions only the selected physical carrier',async()=>{
  for(const model of ['6581','8580'])for(let carrier=0;carrier<3;carrier++)for(const paired of [false,true]){
    let settings=selectChannelTarget(distinctChannels(),carrier),preset=selectedChannelPreset(settings);
    preset.model=model;preset.modulation={sync:paired,ring:paired,ratio:12139/9113};preset.filter.enabled=true;
    settings=applyChannelPreset(settings,preset);const before=copy(settings),calls=[],created=[];
    const api={initialize(){calls.push(['initialize']);},setVoice(...args){calls.push(['setVoice',...args]);},setFilter(...args){calls.push(['setFilter',...args]);},
      setFrequency(...args){calls.push(['setFrequency',...args]);},keyOn(...args){calls.push(['keyOn',...args]);},noteOn(...args){calls.push(['noteOn',...args]);}};
    const primary=model==='6581'?api:new Proxy({}, {get(){throw Error('8580 snippet touched 6581 primary');}});
    await new AsyncFunction('sid','createSoundChip',channelSettingsToCode(settings))(primary,async(...args)=>{created.push(args);return api;});
    assert.equal(created.length,model==='8580'?1:0);if(model==='8580')assert.equal(created[0][1].model,'8580');
    assert.deepEqual(settings,before,'source overrides do not overwrite saved channel patches');
    const filter=calls.find(item=>item[0]==='setFilter')[1],source=(carrier+2)%3;
    assert.equal(filter.routing,1<<carrier);assert.equal(filter.voice3off,paired&&source===2);
    const voices=calls.filter(item=>item[0]==='setVoice');assert.equal(voices.length,3);
    for(const [,channel,voice]of voices){
      if(paired&&channel===source)assert.deepEqual(voice,{waveform:'triangle',pulseWidth:2048,attack:0,decay:0,sustain:0,release:0,test:false,sync:false,ring:false});
      else assert.deepEqual(voice,{...settings.channels[channel].voice,sync:paired&&channel===carrier,ring:paired&&channel===carrier});
    }
    if(paired){
      const hz=440*2**((60-69)/12);
      assert.deepEqual(calls.filter(item=>item[0]==='setFrequency'),[['setFrequency',carrier,hz],['setFrequency',source,hz*preset.modulation.ratio]]);
      assert.deepEqual(calls.filter(item=>item[0]==='keyOn'),[['keyOn',carrier]]);assert.equal(calls.some(item=>item[0]==='noteOn'),false);
    }else assert.deepEqual(calls.filter(item=>item[0]==='noteOn'),[['noteOn',carrier,'C4']]);
  }
});

test('mixed round-robin exports configure the actual three patches and the same playback plan',async()=>{
  for(const paired of [false,true]){
    const settings=selectChannelTarget(distinctChannels(),'round-robin');
    for(const preset of settings.channels)preset.filter.enabled=true;
    if(paired){settings.channels[1].modulation={sync:true,ring:true,ratio:1.75};settings.channels[2].modulation={sync:false,ring:true,ratio:2};}
    const before=copy(settings),calls=[];
    const sid={initialize(){},setVoice(...args){calls.push(['voice',...args]);},setFilter(...args){calls.push(['filter',...args]);},
      setFrequency(...args){calls.push(['frequency',...args]);},keyOn(...args){calls.push(['gate',...args]);},noteOn(...args){calls.push(['note',...args]);}};
    const code=channelSettingsToCode(settings);await new AsyncFunction('sid',code)(sid);
    assert.deepEqual(settings,before);assert(code.includes('round robin retains each stored channel sound'));
    assert.equal(calls.find(item=>item[0]==='filter')[1].routing,paired?2:7);
    for(const [,channel,voice]of calls.filter(item=>item[0]==='voice')){
      if(paired&&channel===0){assert.equal(voice.waveform,'triangle');assert.equal(voice.attack,0);assert.equal(voice.sustain,0);}
      else assert.deepEqual(voice,{...settings.channels[channel].voice,sync:paired&&channel===1,ring:paired&&channel===1});
    }
    if(paired){
      assert(code.includes('CH 2 is the first configured carrier'));
      assert.deepEqual(calls.filter(item=>item[0]==='gate'),[['gate',1]]);
      assert.deepEqual(calls.filter(item=>item[0]==='frequency').map(item=>item[1]),[1,0]);
    }else assert.deepEqual(calls.filter(item=>item[0]==='note'),[['note',0,'C4']]);
  }
});

test('mixed round-robin JavaScript runs distinct voices and a non-CH1 pair on either real core',async()=>{
  const binaries=await Promise.all(['../generated/sid/sid.wasm','../generated/sid8580-machine/sid8580-endpoint.wasm'].map(path=>readFile(new URL(path,import.meta.url))));
  for(const [index,Core]of [SidCore,Sid8580Core].entries())for(const paired of [false,true]){
    const core=await Core.create({sampleRate:48000,wasmBinary:binaries[index]}),sid=new SidSynth({core});
    try{
      const settings=selectChannelTarget(distinctChannels(),'round-robin');
      for(const preset of settings.channels){preset.model=index?'8580':'6581';preset.filter.enabled=true;}
      if(paired){settings.channels[1].modulation={sync:true,ring:true,ratio:1.75};settings.channels[2].modulation={sync:false,ring:true,ratio:2};}
      await new AsyncFunction('sid','createSoundChip',channelSettingsToCode(settings))(index?null:sid,async()=>sid);
      if(!paired){sid.noteOn(1,'E4');sid.noteOn(2,'G4');}
      const registers=sid.getRegisterSnapshot();assert.equal(registers[23]&7,paired?2:7);
      assert.equal(registers[4]&1,paired?0:1);assert.equal(registers[11]&1,1);assert.equal(registers[18]&1,paired?0:1);
      assert.equal(registers[18]&6,0,'the other stored pair is inactive');
      if(!paired)assert.deepEqual([registers[4]&0xf0,registers[11]&0xf0,registers[18]&0xf0],[32,64,16]);
      const pcm=core.render(6000);assert(pcm.every(Number.isFinite));assert(pcm.some(value=>Math.abs(value)>.00001));
    }finally{sid.dispose();core.dispose();}
  }
});

test('fixed exports execute on real 6581/8580 cores with the chosen Gate, source and shared filter route',async()=>{
  const binaries=await Promise.all(['../generated/sid/sid.wasm','../generated/sid8580-machine/sid8580-endpoint.wasm'].map(path=>readFile(new URL(path,import.meta.url))));
  for(const [index,Core]of [SidCore,Sid8580Core].entries())for(let carrier=0;carrier<3;carrier++)for(const paired of [false,true]){
    const model=index?'8580':'6581',core=await Core.create({sampleRate:48000,wasmBinary:binaries[index]}),sid=new SidSynth({core});
    try{
      let settings=selectChannelTarget(distinctChannels(),carrier),preset=selectedChannelPreset(settings);
      preset.model=model;preset.voice.waveform='triangle';preset.voice.attack=0;preset.voice.sustain=15;
      preset.modulation={sync:paired,ring:paired,ratio:1.75};preset.filter.enabled=true;
      settings=applyChannelPreset(settings,preset);
      await new AsyncFunction('sid','createSoundChip',channelSettingsToCode(settings))(index?null:sid,async()=>sid);
      const registers=sid.getRegisterSnapshot(),source=(carrier+2)%3;
      for(let channel=0;channel<3;channel++)assert.equal(registers[channel*7+4]&1,channel===carrier?1:0);
      assert.equal(registers[23]&7,1<<carrier);assert.equal(Boolean(registers[24]&128),paired&&source===2);
      if(paired){assert.equal(registers[source*7+4],16);assert.equal(registers[source*7+5],0);assert.equal(registers[source*7+6],0);}
      const pcm=core.render(6000);assert(pcm.every(Number.isFinite));assert(pcm.some(value=>Math.abs(value)>.00001));
    }finally{sid.dispose();core.dispose();}
  }
});
