// SPDX-License-Identifier: BSD-3-Clause
import {createPlaygroundScspVoicePanel} from '../playground/playground_scsp_voice_panel.js';
import {createAudio} from './audio.js';
import {readPatch} from './patch.js';
import {OPERATOR_NAMES,operatorCount} from './routing.js';
const $=id=>document.getElementById(id),status=$('status');
let audio=null,starting=false,queue=Promise.resolve(),serial=0,epoch=0;
let selectedOperator=0,latestState=null;
const operatorButtons=[...document.querySelectorAll('[data-operator]')];
const held=new Map(),keys='awsedftgyhujk',notes=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B','C'];
const report=error=>{status.textContent=error.message;};
function enqueue(fn){const task=queue.then(fn);queue=task.catch(report);return task;}
async function refresh(){if(audio){
  const state=await audio.read();latestState=state;panel.update(state);
  for(const [id,value]of [['voiceMode',state.config.mode],['fmDepth',state.config.fm.depth],['fmRatio',state.config.fm.ratio],['algorithm',state.config.fm.algorithm],['operatorRatio',state.config.fm.ratios[selectedOperator]],['pitch',state.config.transpose]])if(document.activeElement!==$(id))$(id).value=value;
  for(const id of ['fmDepth','fmRatio','algorithm','operatorRatio'])$(id).disabled=state.config.mode==='pcm';
  $('capacity').textContent=`${state.voiceCapacity} playable voices · ${state.sourceCount} source slots reserved · ${operatorCount(state.config.mode)} slot(s) per key.`;
  const {inputs,outputs,count}=state.routing;
  $('routingSummary').textContent=inputs.flatMap((sources,target)=>sources.map(source=>`${OPERATOR_NAMES[source]} → ${OPERATOR_NAMES[target]}`)).concat([`Output: ${outputs.map(i=>OPERATOR_NAMES[i]).join(' + ')}`]).join(' · ');
  for(const button of operatorButtons){const index=Number(button.dataset.operator);button.setAttribute('aria-pressed',String(index===selectedOperator));button.textContent=`${OPERATOR_NAMES[index]} · ${index>=count?'Unused':outputs.includes(index)?'Output':'Modulator'}`;}
}}


const panel=createPlaygroundScspVoicePanel({root:$('voice'),showModulation:false,onError:report,invoke:(method,args)=>enqueue(async()=>{
  if(!audio)throw new Error('Start audio first');
  try{const result=await audio.invoke(method,args);if(!['getPCM','auditionOff','auditionOn'].includes(method))await refresh();return result;}catch(error){if(['setMix','setLfo','setEnvelope','setPreset'].includes(method))document.activeElement?.blur();await refresh();throw error;}
})});
// Keep the shared editor's detailed RAM protocol out of the standalone flow.
for(const p of $('voice').querySelectorAll('p'))if(p.textContent.startsWith('Software editor:'))p.textContent='Software waveform editor: Apply changes the source for new notes. Playing and releasing notes keep their original PCM. Press Stop to release their sample memory before further edits.';
// The shared slot preview is replaced by the grouped keyboard below.
$('voice').querySelector('[data-chip-action="scsp-hold"]').hidden=true;
// These are editor source slots, so their hardware gate is not the keyboard state.
$('voice').querySelectorAll(':scope > p')[1].hidden=true;
const copyButton=$('voice').querySelector('[data-chip-action="scsp-copy"]');copyButton.textContent='Copy this operator as JavaScript';const copyHint=document.createElement('p');copyHint.textContent='JavaScript copy exports only the selected operator. Save preset includes all six operators and the connection.';copyButton.after(copyHint);
for(const label of $('voice').querySelectorAll(':scope > label'))if(label.textContent.startsWith('MIDI note'))label.hidden=true;
function enable(value){for(const id of ['voiceMode','fmDepth','fmRatio','algorithm','operatorRatio'])$(id).disabled=!value;for(const button of operatorButtons)button.disabled=!value;$('stop').disabled=!value;$('save').disabled=!value;$('open').disabled=!value;panel.setConnected(value);}
$('start').onclick=async()=>{
  $('start').blur();if(starting)return;starting=true;$('start').disabled=true;
  try{if(audio)await audio.resume();else audio=await createAudio({volume:Number($('volume').value),onError:error=>{report(error);held.clear();epoch++;highlight();audio=null;enable(false);$('start').disabled=false;}});enable(true);await refresh();status.textContent='Ready · play the keyboard. Select A–F to edit an operator on the same canvas.';}
  catch(error){report(error);}finally{starting=false;$('start').disabled=false;}
};
function highlight(){for(const b of $('keyboard').children)b.setAttribute('aria-pressed',String([...held.values()].some(v=>v.index===Number(b.dataset.index))));}
function release(id){const entry=held.get(id);if(!entry)return;held.delete(id);highlight();void enqueue(async()=>{if(audio&&entry.epoch===epoch)await audio.command('noteOff',[entry.id]);});}
function releaseAll(){for(const id of [...held.keys()])release(id);panel.releaseAll();}
async function stop(){releaseAll();epoch++;if(audio){await audio.command('stopVoices');await refresh();}status.textContent='Stopped · sample RAM retained. Play to resume.';}
$('stop').onclick=()=>{ $('stop').blur();void enqueue(stop);};
function press(id,index){
  if(held.has(id)||!audio)return;
  const midi=(Number($('octave').value)+1)*12+index;
  if(!Number.isInteger(midi)||midi<0||midi>127)return;
  const entry={index,midi,id:`synth-${++serial}`,epoch};held.set(id,entry);highlight();
  void enqueue(async()=>{
    if(!audio||entry.epoch!==epoch)return;
    await audio.resume();const result=await audio.command('noteOn',[entry.id,midi]);
    if(result.stolenId)for(const [key,old]of held)if(old.id===result.stolenId)held.delete(key);highlight();
  }).catch(()=>{if(held.get(id)===entry){held.delete(id);highlight();}if(audio&&entry.epoch===epoch)void enqueue(()=>audio?.command('noteOff',[entry.id]));});
}
for(let index=0;index<13;index++){
  const b=document.createElement('button');b.textContent=`${notes[index]} · ${keys[index].toUpperCase()}`;b.dataset.index=index;b.setAttribute('aria-pressed','false');if([1,3,6,8,10].includes(index))b.className='black';
  b.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();b.setPointerCapture(event.pointerId);press(`pointer-${event.pointerId}`,index);});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,e=>release(`pointer-${e.pointerId}`));
  b.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();if(!event.repeat)press(`button-${index}`,index);}});b.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key))release(`button-${index}`);});$('keyboard').append(b);
}
window.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.metaKey||event.altKey||event.target.closest?.('input,select,textarea,[contenteditable=true]'))return;
  const index=keys.indexOf(event.key.toLowerCase());if(index<0)return;event.preventDefault();if(!event.repeat)press(`key-${event.code}`,index);
});
window.addEventListener('keyup',event=>release(`key-${event.code}`));window.addEventListener('blur',releaseAll);document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAll();});
$('volume').oninput=()=>audio?.setVolume(Number($('volume').value));$('volume').onchange=()=>$('volume').blur();
$('octave').onchange=()=>{releaseAll();$('octave').blur();};
function configure(patch,modeChange=false){return enqueue(async()=>{if(!audio)return;try{await audio.command('setConfig',[patch]);if(modeChange){held.clear();epoch++;highlight();}await refresh();status.textContent='Voice updated · held notes follow Pitch, ratio and depth.';}catch(error){await refresh();throw error;}});}
$('pitch').onchange=()=>{const value=Number($('pitch').value);if(!$('pitch').value.trim()||!$('pitch').reportValidity())return;$('pitch').blur();void configure({transpose:value});};
$('voiceMode').onchange=()=>{const mode=$('voiceMode').value;$('voiceMode').blur();void configure({mode},true);};
for(const [id,key]of [['fmDepth','depth'],['fmRatio','ratio']])$(id).onchange=()=>{const input=$(id);if(!input.value.trim()||!input.reportValidity())return;input.blur();void configure({fm:{[key]:Number(input.value)}});};
$('algorithm').onchange=()=>{const algorithm=$('algorithm').value;$('algorithm').blur();void configure({fm:{algorithm}},true);};
$('operatorRatio').onchange=()=>{const input=$('operatorRatio');if(!input.value.trim()||!input.reportValidity())return;const value=Number(input.value),slot=selectedOperator;input.blur();void enqueue(async()=>{if(!audio)return;const state=await audio.read(),ratios=[...state.config.fm.ratios];ratios[slot]=value;await audio.command('setConfig',[{fm:{ratios}}]);await refresh();});};
for(const button of operatorButtons)button.onclick=()=>{
  selectedOperator=Number(button.dataset.operator);$('voice').querySelector(`[data-scsp-slot="${selectedOperator}"]`).click();
  for(const b of operatorButtons)b.setAttribute('aria-pressed',String(b===button));
  if(latestState)$('operatorRatio').value=latestState.config.fm.ratios[selectedOperator];button.blur();
};
$('save').onclick=()=>{$('save').blur();void enqueue(async()=>{if(!audio)return;const value=await audio.command('exportPatch');const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='scsp-voice.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Preset saved · all six operators, connection, ratios, depth and pitch included. Apply drafts before saving.';});};
$('open').onchange=()=>{const file=$('open').files?.[0];$('open').value='';$('open').blur();if(!file)return;void enqueue(async()=>{if(!audio)return;if(file.size>8*1024*1024)throw new Error('Preset must be at most 8 MiB');const value=JSON.parse(await file.text());readPatch(value);await audio.command('loadPatch',[value]);held.clear();epoch++;highlight();await refresh();status.textContent='Preset loaded · voices stopped, all six operators ready.';});};
window.addEventListener('pagehide',()=>{epoch++;held.clear();void audio?.dispose();});
