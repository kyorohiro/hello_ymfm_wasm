// Exercise the application's real preset routes and PCM installation guard.
// No AudioContext, browser or physical audio device is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createPcmBuiltinPreset,createPcmPreset,createSynthPcmVoice,isPcmPreset,normalizePcmPreset,buildPcmMemory,pcmSampleBytes,PCM_ENCODING,PCM_MAX_FRAMES} from './synth_pcm.js';
import {isPsgPreset,normalizePsgPreset} from './synth_psg_preset.js';
import {createSynthProject} from './synth_project.js';

const source=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const builtinMap=source.match(/const PCM_BUILTIN_SHAPES=Object.freeze\([\s\S]*?\);/)[0];
const routes=source.slice(source.indexOf('function applyPresetState('),source.indexOf('function buildCurrentPresetState()'));
const prepare=source.slice(source.indexOf('async function ensureAudioReady('),source.indexOf('function buildKeyboard()'));
const localGuard=source.slice(source.indexOf('function isLocalChannelTarget()'),source.indexOf('function localChannel()'));
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('PCM did not finish installing');}

function harness({code=false,playback='stopped',chip='pcm',target='pcm:7',source:origin='local',preset}={}) {
  const loads=[],selections=[],notifications=[],transport={playback},identity={context:{boots:1},loop:{ticks:23},fx:{name:'unchanged'}};
  const device={keyOff(){},loadMemory(memory,address){loads.push({memory:Uint8Array.from(memory),address});return Promise.resolve();}};
  const voice=createSynthPcmVoice({getPcm:()=>device});
  const named=preset??createPcmBuiltinPreset('triangle');
  if(!preset){named.sample.name='Chosen triangle';named.settings.volume=37;}
  const project=createSynthProject();project.writeTone('/presets/Triangle.pcm.json',named);
  const scope=vm.createContext({
    isPcmPreset,normalizePcmPreset,isPsgPreset,normalizePsgPreset,createPcmBuiltinPreset,
    createPsgPreset(){throw Error('unexpected PSG default');},FM_PRESETS:{},
    synthProject:project,
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
  vm.runInContext(builtinMap+'\n'+localGuard+'\n'+routes+'\n'+prepare,scope);
  return {scope,voice,device,named,loads,selections,notifications,identity,transport,project};
}

function variablePreset(frames) {
  const bytes=Uint8Array.from({length:frames},(_,index)=>(index*17%127)|(index%2?128:0));
  return createPcmPreset({sample:{name:`Variable ${frames}`,sampleRate:22050,encoding:PCM_ENCODING,data:Buffer.from(bytes).toString('base64')},
    settings:{rootNote:49,loopStart:Math.floor(frames/3),loopEnd:frames,volume:53,panLeft:6,panRight:11}});
}

test('real Files PCM documents apply 128 / 256 / 1024 / 4096 / maximum frames without truncating the sample or loop',async()=>{
  for(const frames of [128,256,1024,4096,PCM_MAX_FRAMES])for(const code of [false,true])for(const target of ['synth','pcm:7']) {
    const preset=variablePreset(frames),h=harness({code,target,preset});
    h.scope.applyPresetState('vfs:/presets/Triangle.pcm.json');await until(()=>h.voice.isReady());
    assert.equal(h.voice.getState().frames,frames);
    assert.deepEqual(h.voice.getPreset(),preset);
    assert.deepEqual(h.project.readTone('/presets/Triangle.pcm.json').preset,preset);
    assert.equal(h.loads.length,1);assert.equal(h.loads[0].memory.length,65536);
    assert.deepEqual(h.loads[0].memory.subarray(0,frames),pcmSampleBytes(preset.sample));
    assert(h.loads[0].memory.subarray(frames).every(value=>value===255),'sample-end guards follow the real length, not frame 256');
    assert.equal(h.voice.getSettings().loopStart,Math.floor(frames/3));assert.equal(h.voice.getSettings().loopEnd,frames);
    assert.equal(h.scope.songTargetState.target,'synth');assert.equal(h.scope.codeActive,code);
  }
});

test('replacing PCM documents across long and short lengths resets the actual frame count without retaining old loop bounds',async()=>{
  const h=harness({code:true});
  for(const frames of [4096,128,PCM_MAX_FRAMES,1024,256]) {
    const preset=variablePreset(frames);
    h.project.writeTone('/presets/Triangle.pcm.json',preset);
    h.scope.applyPresetState('vfs:/presets/Triangle.pcm.json');await until(()=>h.voice.isReady());
    assert.equal(h.voice.getState().frames,frames);assert.deepEqual(h.voice.getPreset(),preset);
    assert.deepEqual(h.loads.at(-1).memory,buildPcmMemory(preset));
    assert.equal(h.scope.identity,h.identity);assert.equal(h.scope.codeActive,true);
  }
});

test('all four PCM builtin preset IDs resolve directly without an intermediate Sine or replacing Files bytes',async()=>{
  for(const code of [false,true])for(const shape of ['sine','triangle','saw','square']) {
    const h=harness({code,preset:variablePreset(9215)}),before=h.project.snapshot();
    const id=`pcm-${shape}`,expected=createPcmBuiltinPreset(shape);
    h.scope.applyPresetState(id);await until(()=>h.voice.isReady());
    assert.deepEqual(h.voice.getPreset(),expected);assert.equal(h.voice.getState().frames,256);
    assert.equal(h.scope.currentPcmPresetName,id);assert.equal(h.scope.pcmPresetSelect.value,id);
    assert.equal(h.loads.length,1);assert.deepEqual(h.loads[0].memory,buildPcmMemory(expected));
    assert.deepEqual(h.project.snapshot(),before,'builtin selection never changes the saved long sample or its checkpoint');
    assert.equal(h.scope.codeActive,code);assert.equal(h.scope.identity,h.identity);
    h.scope.applyPresetState(id);await until(()=>h.loads.length===2&&h.voice.isReady());
    assert.deepEqual(h.loads[1].memory,buildPcmMemory(expected),'same builtin selection reinstalls its own sample');
  }
});

test('PCM builtin buttons use the preset selection transaction instead of editing the active file sample',async()=>{
  const h=harness({code:true,preset:variablePreset(9215)}),requests=[],messages=[];
  h.scope.synthFiles={selectPreset:async id=>{requests.push(id);h.scope.applyPresetState(id);return true;}};
  h.scope.setStatus=message=>messages.push(message);
  const start=source.indexOf('onBuiltin:shape=>')+'onBuiltin:'.length;
  const callback=source.slice(start,source.indexOf('  onSampleEdit:preset=>',start)).trim().replace(/,$/,'');
  const choose=vm.runInContext('('+callback+')',h.scope);
  const before=h.project.snapshot();choose('saw');await until(()=>h.voice.isReady()&&messages.length===1);
  assert.deepEqual(requests,['pcm-saw']);assert.equal(h.loads.length,1);
  assert.deepEqual(h.voice.getPreset(),createPcmBuiltinPreset('saw'));assert.deepEqual(h.project.snapshot(),before);
  assert.match(messages[0],/Previous preset kept/);assert.equal(h.scope.codeActive,true);
  choose('invalid');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(requests,['pcm-saw']);
});

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
