import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAYGROUND_MODES} from './playground_mode.js';
import {supportsPlaygroundAudioEngineMode,resolvePlaygroundAudioEngine} from './playground_audio_engine.js';

test('Native supports every standard mode and the hidden legacy Genesis Nuked URL',()=>{
  assert.equal(PLAYGROUND_MODES.length,21);
  for(const mode of PLAYGROUND_MODES){assert.equal(supportsPlaygroundAudioEngineMode('native',mode.id),true,mode.id);assert.equal(resolvePlaygroundAudioEngine({search:'?audioEngine=native',desktop:true,modeId:mode.id}).engine,'native');}
  assert.equal(supportsPlaygroundAudioEngineMode('native','genesis-nuked'),true);
  assert.equal(supportsPlaygroundAudioEngineMode('native','unknown-machine'),false);
});

test('Web Audio remains the default and Native requires desktop selection for Nuked modes',()=>{
  for(const modeId of ['genesis-full-nuked','genesis-nuked']){
    assert.equal(resolvePlaygroundAudioEngine({desktop:true,modeId}).engine,'webaudio');
    assert.equal(resolvePlaygroundAudioEngine({search:'?audioEngine=native',desktop:false,modeId}).engine,'webaudio');
    assert.equal(resolvePlaygroundAudioEngine({search:'?audioEngine=native',desktop:true,modeId}).engine,'native');
  }
});
