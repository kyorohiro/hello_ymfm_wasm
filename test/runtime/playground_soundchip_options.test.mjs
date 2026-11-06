import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSoundChipOptions,validateYm2612Engine} from '../../tetorica_src/runtime/playground_soundchip_options.js';

test('additional YM2612 defaults to ymfm and accepts only the two concrete cores',()=>{
  assert.equal(validateYm2612Engine(),'ymfm');
  for(const engine of ['ymfm','nuked'])assert.equal(validateYm2612Engine(engine),engine);
  for(const engine of [null,false,0,'','Nuked','nuked-opn2',{},[]])assert.throws(()=>validateYm2612Engine(engine),/engine/);
  for(const options of [{},{id:'ym2612'},{engine:undefined},{engine:'ymfm'},{id:'nuked',engine:'nuked'}])assert.doesNotThrow(()=>validateSoundChipOptions('ym2612',options));
});

test('engine selection belongs only to additional YM2612 and rejects options before allocation',()=>{
  for(const name of ['ym2203','ym2608','ym2610','ym2610b','segapsg','nes','rf5c164','spc']) {
    assert.doesNotThrow(()=>validateSoundChipOptions(name,{id:'extra'}));
    assert.throws(()=>validateSoundChipOptions(name,{engine:'nuked'}),/createSoundChip supports/);
    assert.throws(()=>validateSoundChipOptions(name,{engine:undefined}),/createSoundChip supports/);
  }
  assert.doesNotThrow(()=>validateSoundChipOptions('nes',{fds:false,clock:1789773}));
  assert.throws(()=>validateSoundChipOptions('nes',{fds:1}),/fds/);
  for(const options of [null,[],false,'nuked',{clock:7670454},{unknown:true},{[Symbol('engine')]:'nuked'}])assert.throws(()=>validateSoundChipOptions('ym2612',options),/createSoundChip supports/);
});

test('SID creation validates the supported model and physical clock before allocation',()=>{
  for(const options of [{},{id:'lead'},{clock:985248,model:'6581'},{clock:900000},{clock:1100000}])assert.doesNotThrow(()=>validateSoundChipOptions('sid',options));
  for(const clock of [null,899999,1100001,985248.5,NaN,Infinity,'985248'])assert.throws(()=>validateSoundChipOptions('sid',{clock}),/SID clock/);
  for(const model of [null,6581,'8580','6581R4',''])assert.throws(()=>validateSoundChipOptions('sid',{model}),/SID model/);
  for(const options of [{sampleRate:48000},{engine:'chips'},{fds:false}])assert.throws(()=>validateSoundChipOptions('sid',options),/createSoundChip supports/);
});
