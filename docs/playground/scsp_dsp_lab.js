// SPDX-License-Identifier: BSD-3-Clause
import {createAudio} from '../synth-scsp/audio.js';
const $=id=>document.getElementById(id),controls=['enabled','dry','time','feedback','send','return'];
let audio=null,queue=Promise.resolve(),serial=0,epoch=0;const timers=new Set();
const report=error=>{$('status').textContent=error.message;};
const run=fn=>{const result=queue.then(fn);queue=result.catch(report);return queue;};
const enable=value=>{for(const id of ['pulse','stop',...controls])$(id).disabled=!value;};
const settings=()=>({enabled:$('enabled').checked,timeMs:Number($('time').value),feedback:Number($('feedback').value),send:Number($('send').value),returnLevel:Number($('return').value)});
$('start').onclick=()=>{$('start').blur();$('start').disabled=true;void run(async()=>{try{audio??=await createAudio({onError:error=>{audio=null;epoch++;enable(false);report(error);$('start').disabled=false;}});await audio.resume();await audio.command('setEffect',[settings()]);await audio.invoke('setMix',[0,{directLevel:$('dry').checked?7:0}]);enable(true);$('status').textContent='Ready · play a short tone.';}finally{$('start').disabled=false;}});};
for(const id of controls)$(id).onchange=()=>{const input=$(id);if(input.type==='number'&&(!input.value.trim()||!input.reportValidity()))return;input.blur();const effect=settings(),dry=$('dry').checked;void run(async()=>{if(!audio)return;await audio.command('setEffect',[effect]);await audio.invoke('setMix',[0,{directLevel:dry?7:0}]);$('status').textContent='DSP updated · play a short tone.';});};
$('pulse').onclick=()=>{$('pulse').blur();void run(async()=>{if(!audio)return;await audio.resume();const current=epoch,id=`pulse-${++serial}`;await audio.command('noteOn',[id,69]);const timer=setTimeout(()=>{timers.delete(timer);void run(async()=>{if(audio&&current===epoch)await audio.command('noteOff',[id]);});},45);timers.add(timer);$('status').textContent='Short tone · listen for the delayed repeats.';});};
$('stop').onclick=()=>{$('stop').blur();epoch++;for(const timer of timers)clearTimeout(timer);timers.clear();void run(async()=>{if(audio)await audio.command('stopVoices');$('status').textContent='Stopped · voices and echoes cleared.';});};
window.addEventListener('pagehide',()=>{epoch++;for(const timer of timers)clearTimeout(timer);void audio?.dispose();});
