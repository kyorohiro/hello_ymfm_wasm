import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAYGROUND_MODES} from './playground_mode.js';
import {supportsPlaygroundAudioEngineMode,resolvePlaygroundAudioEngine} from './playground_audio_engine.js';

test('Native supports the existing standard modes and keeps Atari ST on Web Audio',()=>{
  assert.equal(PLAYGROUND_MODES.filter(mode=>mode.id!=='atari-st').length,26);
  for(const mode of PLAYGROUND_MODES){
    const native=mode.id!=='atari-st';
    assert.equal(supportsPlaygroundAudioEngineMode('webaudio',mode.id),true,mode.id);
    assert.equal(supportsPlaygroundAudioEngineMode('native',mode.id),native,mode.id);
    assert.equal(resolvePlaygroundAudioEngine({search:'?audioEngine=native',desktop:true,modeId:mode.id}).engine,native?'native':'webaudio');
  }
  assert.equal(supportsPlaygroundAudioEngineMode('native','genesis-nuked'),true);
  assert.equal(supportsPlaygroundAudioEngineMode('native','unknown-machine'),false);
});

test('Atari ST cannot select Native even in a desktop URL',()=>{
  assert.equal(supportsPlaygroundAudioEngineMode('webaudio','atari-st'),true);
  assert.equal(supportsPlaygroundAudioEngineMode('native','atari-st'),false);
  assert.deepEqual(resolvePlaygroundAudioEngine({search:'?mode=atari-st&audioEngine=native',desktop:true,modeId:'atari-st'}),
    {requested:'native',engine:'webaudio',available:false});
});

test('WonderSwan supports Native only when selected in the desktop app',()=>{
  assert.equal(supportsPlaygroundAudioEngineMode('webaudio','wonderswan'),true);
  assert.equal(supportsPlaygroundAudioEngineMode('native','wonderswan'),true);
  assert.deepEqual(resolvePlaygroundAudioEngine({search:'?mode=wonderswan&audioEngine=native',desktop:true,modeId:'wonderswan'}),
    {requested:'native',engine:'native',available:true});
  assert.equal(resolvePlaygroundAudioEngine({modeId:'wonderswan',desktop:true}).engine,'webaudio');
  assert.equal(resolvePlaygroundAudioEngine({modeId:'wonderswan',desktop:false,search:'?audioEngine=native'}).engine,'webaudio');
});

test('single and dual POKEY modes use Web Audio by default and can select desktop Native',()=>{
  for(const modeId of ['pokey','pokey-dual']) {
    assert.equal(supportsPlaygroundAudioEngineMode('native',modeId),true);
    assert.equal(resolvePlaygroundAudioEngine({modeId,desktop:true}).engine,'webaudio');
    assert.equal(resolvePlaygroundAudioEngine({modeId,desktop:false,search:'?audioEngine=native'}).engine,'webaudio');
    assert.equal(resolvePlaygroundAudioEngine({modeId,desktop:true,search:'?audioEngine=native'}).engine,'native');
  }
});

test('Web Audio remains the default and Native requires desktop selection for Nuked modes',()=>{
  for(const modeId of ['genesis-full-nuked','genesis-nuked']){
    assert.equal(resolvePlaygroundAudioEngine({desktop:true,modeId}).engine,'webaudio');
    assert.equal(resolvePlaygroundAudioEngine({search:'?audioEngine=native',desktop:false,modeId}).engine,'webaudio');
    assert.equal(resolvePlaygroundAudioEngine({search:'?audioEngine=native',desktop:true,modeId}).engine,'native');
  }
});


test('PS1 uses Web Audio by default and supports explicit desktop Native',()=>{
  assert.equal(supportsPlaygroundAudioEngineMode('native','ps1'),true);
  assert.deepEqual(resolvePlaygroundAudioEngine({search:'?mode=ps1&audioEngine=native',desktop:true,modeId:'ps1'}),
    {requested:'native',engine:'native',available:true});
  assert.equal(resolvePlaygroundAudioEngine({desktop:true,modeId:'ps1'}).engine,'webaudio');
  assert.equal(resolvePlaygroundAudioEngine({desktop:false,modeId:'ps1',search:'?audioEngine=native'}).engine,'webaudio');
});
