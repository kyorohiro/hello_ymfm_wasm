// Exercise the application's real preset routes and PCM installation guard.
// No AudioContext, browser or physical audio device is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createPcmBuiltinPreset,createSynthPcmVoice,isPcmPreset,normalizePcmPreset,buildPcmMemory} from './synth_pcm.js';
import {isPsgPreset,normalizePsgPreset} from './synth_psg_preset.js';

const source=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const routes=source.slice(source.indexOf('function applyPresetState('),source.indexOf('function buildCurrentPresetState()'));
const prepare=source.slice(source.indexOf('async function ensureAudioReady('),source.indexOf('function buildKeyboard()'));
const localGuard=source.slice(source.indexOf('function isLocalChannelTarget()'),source.indexOf('function localChannel()'));
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('PCM did not finish installing');}

function harness({code=false,playback='stopped',chip='pcm',target='pcm:7',source:origin='local'}={}) {
  const loads=[],selections=[],notifications=[],transport={playback},identity={context:{boots:1},loop:{ticks:23},fx:{name:'unchanged'}};
  const device={keyOff(){},loadMemory(memory,address){loads.push({memory:Uint8Array.from(memory),address});return Promise.resolve();}};
  const voice=createSynthPcmVoice({getPcm:()=>device});
  const named=createPcmBuiltinPreset('triangle');named.sample.name='Chosen triangle';named.settings.volume=37;
  const scope=vm.createContext({
    isPcmPreset,normalizePcmPreset,isPsgPreset,normalizePsgPreset,createPcmBuiltinPreset,
    createPsgPreset(){throw Error('unexpected PSG default');},FM_PRESETS:{},
    synthProject:{readTone(path){assert.equal(path,'/presets/Triangle.pcm.json');return {preset:named};}},
    codeActive:code,codeAudio:{pcmSourceChanged(){notifications.push('PCM source');}},
    activeInstrumentKind:'pcm',editorChip:chip,songTargetState:{source:origin,chip,target,playback},
    songControls:{
      selectChip(next){assert.equal(scope.activeInstrumentKind,'pcm','author kind precedes target callback');selections.push(['chip',next]);scope.songTargetState={...scope.songTargetState,chip:next};},
      selectTarget(next){selections.push(['target',next]);scope.songTargetState={...scope.songTargetState,target:next};},
    },
    selectEditorChip(button){scope.editorChip=button;},editorButtonForKind:kind=>kind==='fm'?'ym2612':kind,
    stopAllNotes(){throw Error('same-chip preset must not stop the automatic performance');},
    pcmVoice:voice,pcmLoadGeneration:0,currentPcmPresetName:'pcm-sine',pcmPresetSelect:{value:'pcm-sine'},pcmControls:{update(){}},
    audioContext:{state:'running'},audioReadyPromise:Promise.resolve(),
    pcmAudio:{prepare:async()=>device,getPcm:()=>device},performanceOutputBus:{},
    isSongChannelTarget:()=>scope.songTargetState.source!=='local'&&scope.songTargetState.target!=='synth'&&['loading','playing','paused','seeking'].includes(scope.songTargetState.playback),
    updateKeyboardAvailability(){},refreshLocalChannels(){},setStatus(message){throw Error(message);},
    identity,transport,
  });
  vm.runInContext(localGuard+'\n'+routes+'\n'+prepare,scope);
  return {scope,voice,device,named,loads,selections,notifications,identity,transport};
}

test('choosing a PCM Files preset or built-in preset from a Normal / Code physical CH selects Auto and installs the chosen RAM',async()=>{
  for(const code of [false,true])for(const id of ['vfs:/presets/Triangle.pcm.json','pcm-sine']) {
    const h=harness({code}),expected=id==='pcm-sine'?createPcmBuiltinPreset('sine'):h.named;
    h.scope.applyPresetState(id);
    assert.equal(h.scope.songTargetState.target,'synth');assert.equal(h.scope.songTargetState.chip,'pcm');
    assert.equal(h.scope.editorChip,'pcm');assert.equal(h.scope.activeInstrumentKind,'pcm');
    assert.equal(h.scope.currentPcmPresetName,id);assert.equal(h.scope.pcmPresetSelect.value,id);
    assert.deepEqual(h.voice.getPreset(),normalizePcmPreset(expected));
    await until(()=>h.voice.isReady());
    assert.equal(h.loads.length,1);assert.equal(h.loads[0].address,0);assert.deepEqual(h.loads[0].memory,buildPcmMemory(expected));
    assert.deepEqual(h.selections,[['chip','pcm'],['target','synth']]);assert.deepEqual(h.notifications,['PCM source']);
    assert.equal(h.scope.codeActive,code);assert.equal(h.scope.identity,h.identity);assert.equal(h.identity.context.boots,1);assert.equal(h.identity.loop.ticks,23);
    assert.equal(h.transport.playback,'stopped');
  }
});

test('reloading the same PCM author preset during Code replaces its custom RAM even from Auto',async()=>{
  const h=harness({code:true,target:'synth'});
  await h.voice.install();assert.equal(h.loads.length,1);
  h.scope.applyPresetState('pcm-sine');await until(()=>h.loads.length===2&&h.voice.isReady());
  assert.deepEqual(h.notifications,['PCM source']);assert.deepEqual(h.loads[1].memory,buildPcmMemory(createPcmBuiltinPreset('sine')));
  assert.equal(h.scope.codeActive,true);assert.equal(h.scope.identity,h.identity);
});

test('passive PCM editor restoration preserves the physical Code target and its sample RAM',async()=>{
  const h=harness({code:true});
  h.scope.applyPresetData(h.voice.getPreset(),'pcm-sine',{restoreEditor:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.scope.songTargetState.target,'pcm:7');assert.deepEqual(h.selections,[]);
  assert.deepEqual(h.notifications,[]);assert.deepEqual(h.loads,[]);assert.equal(h.scope.codeActive,true);
});

test('a malformed PCM preset leaves the target, author sound and RAM unchanged',()=>{
  const h=harness({code:true}),before=h.voice.getPreset();
  assert.throws(()=>h.scope.applyPresetData({...h.named,version:999},'invalid'),/Unsupported PCM preset/);
  assert.equal(h.scope.songTargetState.target,'pcm:7');assert.equal(h.scope.currentPcmPresetName,'pcm-sine');
  assert.deepEqual(h.voice.getPreset(),before);assert.deepEqual(h.selections,[]);assert.deepEqual(h.notifications,[]);assert.deepEqual(h.loads,[]);
});

test('choosing a PCM preset keeps the VGM transport playing or paused and switches the author target to Auto',async()=>{
  for(const playback of ['playing','paused']) {
    const h=harness({source:'vgm',playback});
    h.scope.applyPresetState('vfs:/presets/Triangle.pcm.json');await until(()=>h.voice.isReady());
    assert.equal(h.scope.songTargetState.target,'synth');assert.equal(h.scope.songTargetState.playback,playback);
    assert.equal(h.transport.playback,playback);assert.deepEqual(h.loads[0].memory,buildPcmMemory(h.named));
  }
});
