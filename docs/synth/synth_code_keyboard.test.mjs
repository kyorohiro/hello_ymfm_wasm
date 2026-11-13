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
    isSongChannelTarget:()=>false,songAuditionVoice:null});
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
