// SPDX-License-Identifier: BSD-3-Clause
import {createPlaygroundScspVoicePanel} from '../playground/playground_scsp_voice_panel.js';
import {createAudio} from './audio.js';
import {readPreset,writePreset} from './preset.js';
const $=id=>document.getElementById(id),status=$('status');
let audio=null,starting=false,queue=Promise.resolve(),serial=0,epoch=0;
const held=new Map(),keys='awsedftgyhujk',notes=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B','C'];
const report=error=>{status.textContent=error.message;};
function enqueue(fn){const task=queue.then(fn);queue=task.catch(report);return task;}
async function refresh(){if(audio)panel.update(await audio.read());}
const panel=createPlaygroundScspVoicePanel({root:$('voice'),onError:report,invoke:(method,args)=>enqueue(async()=>{
  if(!audio)throw new Error('Start audio first');
  const result=await audio.invoke(method,args);
  if(['setMix','setLfo'].includes(method))for(const entry of held.values())if(entry.source===args[0])await audio.command(method,[entry.slot,args[1]]);
  if(!['getPCM','auditionOff','auditionOn'].includes(method))await refresh();return result;
})});
// Keep the shared editor's detailed RAM protocol out of the standalone flow.
for(const p of $('voice').querySelectorAll('p'))if(p.textContent.startsWith('Software editor:'))p.textContent='Software waveform editor: Apply changes the source for new notes. Playing and releasing notes keep their original PCM. Press Stop to release their sample memory before further edits.';
function enable(value){$('stop').disabled=!value;$('save').disabled=!value;$('open').disabled=!value;panel.setConnected(value);}
$('start').onclick=async()=>{
  $('start').blur();if(starting)return;starting=true;$('start').disabled=true;
  try{if(audio)await audio.resume();else audio=await createAudio({volume:Number($('volume').value),onError:error=>{report(error);held.clear();audio=null;enable(false);$('start').disabled=false;}});enable(true);await refresh();status.textContent='Ready · play the keyboard. Edit Slot 1 to shape the keyboard voice.';}
  catch(error){report(error);}finally{starting=false;$('start').disabled=false;}
};
function highlight(){for(const b of $('keyboard').children)b.setAttribute('aria-pressed',String([...held.values()].some(v=>v.index===Number(b.dataset.index))));}
function release(id){const entry=held.get(id);if(!entry)return;held.delete(id);highlight();void enqueue(async()=>{if(audio&&entry.epoch===epoch)await audio.invoke('auditionOff',[entry.slot,entry.id]);});}
function releaseAll(){for(const id of [...held.keys()])release(id);panel.releaseAll();}
async function stop(){releaseAll();epoch++;if(audio){await audio.command('stopVoices');for(let ch=0;ch<32;ch++)if(playbackSlots.has(ch))await audio.command('setPreset',[ch,{sample:null}]);playbackSlots.clear();await refresh();}status.textContent='Stopped · sample RAM retained. Play to resume.';}
const playbackSlots=new Set();
$('stop').onclick=()=>{ $('stop').blur();void enqueue(stop);};
function press(id,index){
  if(held.has(id)||!audio)return;
  const source=panel.getSelectedChannel(),used=new Set([...held.values()].map(v=>v.slot));
  let slot=Array.from({length:32},(_,i)=>i).find(i=>i!==source&&!used.has(i));
  if(slot===undefined){const oldest=held.entries().next().value;slot=oldest[1].slot;release(oldest[0]);}
  const midi=(Number($('octave').value)+1)*12+index;
  if(!Number.isInteger(midi)||midi<0||midi>127)return;
  const entry={slot,source,index,midi,id:`synth-${++serial}`,epoch};held.set(id,entry);playbackSlots.add(slot);highlight();
  void enqueue(async()=>{
    if(!audio||entry.epoch!==epoch)return;
    await audio.resume();const state=await audio.read(),voice=state.channels[source];
    await audio.command('setPreset',[slot,{sample:voice.sample,envelope:voice.envelope,totalLevel:voice.totalLevel,directLevel:voice.directLevel,pan:voice.pan,lfo:voice.lfo}]);
    await audio.invoke('auditionOn',[slot,midi,entry.id]);
    await audio.command('setFrequency',[slot,440*2**((midi-69+Number($('pitch').value))/12)]);
  }).catch(()=>{if(held.get(id)===entry){held.delete(id);highlight();}if(audio&&entry.epoch===epoch)void enqueue(()=>audio?.invoke('auditionOff',[entry.slot,entry.id]));});
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
$('pitch').onchange=()=>{const value=Number($('pitch').value);if(!$('pitch').value.trim()||!$('pitch').reportValidity())return;$('pitch').blur();void enqueue(async()=>{for(const entry of held.values())if(audio)await audio.command('setFrequency',[entry.slot,440*2**((entry.midi-69+value)/12)]);});};
$('save').onclick=()=>{ $('save').blur();void enqueue(async()=>{if(!audio)return;const value=writePreset(await audio.invoke('getPCM',[panel.getSelectedChannel()]));const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='scsp-voice.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Preset saved, including applied PCM. Apply drafts before saving.';});};
$('open').onchange=()=>{const file=$('open').files?.[0];$('open').value='';$('open').blur();if(!file)return;void enqueue(async()=>{
  if(!audio)return;if(file.size>2*1024*1024)throw new Error('Preset must be at most 2 MiB');
  const value=readPreset(JSON.parse(await file.text())),slot=panel.getSelectedChannel();
  const sample=await audio.invoke('applyPCM',[slot,value.pcm,value.options]);await audio.command('setPreset',[slot,{...value.voice,sample}]);await refresh();status.textContent='Preset loaded · play a new note.';
});};
window.addEventListener('pagehide',()=>{epoch++;held.clear();void audio?.dispose();});
