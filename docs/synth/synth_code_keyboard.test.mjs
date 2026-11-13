// Evaluate the actual input selectors during the cold Code initialization
// boundary. No browser or audio device is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const selectors=source.slice(source.indexOf('function getPlayableSynth()'),source.indexOf('async function ensureLooper()'));

test('cold Code initialization can apply author tuning before its keyboard adapter exists, for all three editor chips',()=>{
  const fm={},psg={},pcm={},wrapped=[];
  const scope=vm.createContext({codeActive:true,codeAudio:null,synth:{},editorChip:'ym2612',editorPerformanceTarget:fm,
    pcmAudio:{getPcm:()=>({})},psgAudio:{getPsg:()=>({})},pcmVoice:pcm,psgVoice:psg,looper:null,
    isSongChannelTarget:()=>false,isFmSongPlaying:()=>false,isPsgSongPlaying:()=>false,isPcmReferenceKeyboard:()=>false,songAuditionVoice:null});
  vm.runInContext(selectors,scope);
  for(const [chip,target]of [['ym2612',fm],['psg',psg],['pcm',pcm]]){
    scope.editorChip=chip;assert.equal(scope.getPlayableSynth(),target,'cold '+chip);
  }
  scope.codeAudio={keyboardTarget(name,target){wrapped.push(name);return {target};}};
  for(const [chip,target]of [['ym2612',fm],['psg',psg],['pcm',pcm]]){
    scope.editorChip=chip;assert.equal(scope.getPlayableSynth().target,target);
  }
  assert.deepEqual(wrapped,['ym2612','segapsg','rf5c164']);
});

test('switching editor tabs cannot send the old PCM or FM channel number to the PSG keyboard',()=>{
  const input=source.slice(source.indexOf('function isPerformanceInputEnabled()'),source.indexOf('function getCurrentPerformanceVoice()'));
  const described=[];
  const scope=vm.createContext({isReferenceKeyboard:()=>true,isSongChannelTarget:()=>true,
    editorChip:'psg',songTargetState:{chip:'pcm',target:'pcm:7',playback:'playing'},
    songControls:{describePsg(ch){assert(ch>=0&&ch<4);described.push(ch);return{playable:true};}},
    codeControls:{isCodeMode:()=>false},editorSwitchPending:false,switchingAudioOutput:false,referenceRecordingStop:null,songAuditionVoice:null});
  vm.runInContext(input,scope);
  assert.equal(scope.isPerformanceInputEnabled(),false);assert.deepEqual(described,[]);
  scope.songTargetState={chip:'ym2612',target:5,playback:'playing'};
  assert.equal(scope.isPerformanceInputEnabled(),false);assert.deepEqual(described,[]);
  scope.songTargetState={chip:'psg',target:'psg:3',playback:'playing'};
  assert.equal(scope.isPerformanceInputEnabled(),true);assert.deepEqual(described,[3]);
});
