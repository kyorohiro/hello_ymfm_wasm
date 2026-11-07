// SPDX-License-Identifier: BSD-3-Clause
import {Sid8580MachineCore} from './core.js';
import {createResearchAudio} from './audio.js';
import {finishResearchPreflight} from './preflight.js';
const $=id=>document.getElementById(id),profiles=()=>({resonance:$('resonance').checked,cutoff:$('cutoff').checked});
let selected=null,draft=null,prepared=null,audio=null,pendingAudio=null,pending=false,playing=false,job=0,controller=null,analyser=null;
function beginJob(){++job;controller?.abort();controller=null;const waiting=pendingAudio;pendingAudio=null;void waiting?.dispose();return job;}
const status=(text,state)=>{$('status').textContent=text;$('status').dataset.state=state;};
const controls=()=>{$('play').disabled=!selected||pending;$('stop').disabled=!pending&&!audio;};
const choices=()=>({clock:$('clock').value||undefined,model:$('model').value||undefined,
  subtune:Number($('subtune').value)||undefined,environment:'minimal'});
function showState(state){
  $('target').textContent=`Declared: ${state.declaredClock} / ${state.declaredModel} · Running: PAL / ${state.model} · ${state.timing}`;
  const w=state.worklet;
  $('details').textContent=`${state.sampleRate} Hz · CPU cycles ${state.cycles} · SID ticks ${state.sidCycles}\nIRQ ${state.irqCount} · NMI ${state.nmiCount} · play calls ${state.playCalls} · host DC blocker ${state.hostDcHz} Hz\nProfiles: resonance ${state.profiles.resonance?'on':'off'} / cutoff ${state.profiles.cutoff?'on':'off'}`+
    (w?`\nWorklet: ${w.blocks} blocks · mean ${w.meanRenderMs.toFixed(3)} ms · max ${w.maxRenderMs.toFixed(3)} ms · ${w.overBudgetBlocks} over budget\nLoad preflight ${w.lastLoadMs.toFixed(1)} ms · timer ${w.timingSource}`:'');
}
async function loadBytes(bytes,name,{subtune}={}){
  const token=beginJob();const abort=controller=new AbortController();pending=true;controls();status('Checking the candidate in the C64 machine…','loading');
  let candidate;
  try{
    const options={...choices(),subtune};
    candidate=await Sid8580MachineCore.create({sampleRate:audio?.sampleRate??48000,profiles:profiles(),signal:abort.signal});
    // Let Stop or a newer selection invalidate this candidate before preflight.
    await new Promise(resolve=>setTimeout(resolve,0));abort.signal.throwIfAborted();candidate.load(bytes,options);
    await finishResearchPreflight(candidate,{signal:abort.signal});
    if(token!==job)return;
    // Commit the selection synchronously. The old Worklet is never loaded
    // speculatively; a newer failed/cancelled candidate cannot alter it.
    const previousAudio=audio;audio=null;analyser=null;playing=false;void previousAudio?.dispose();
    const previous=prepared;prepared=candidate;candidate=null;previous?.dispose();
    const state=prepared.getState();selected={bytes:new Uint8Array(bytes).slice(),name,subtune:state.subtune,options:{...options,subtune:state.subtune}};
    $('title').textContent=prepared.parsed.metadata.name||name;
    $('subtune').replaceChildren(...Array.from({length:prepared.parsed.songs},(_,i)=>new Option(String(i+1),String(i+1))));
    $('subtune').value=String(state.subtune);$('subtune').disabled=prepared.parsed.songs<2;showState(state);
    status('Ready. Press Play to start the AudioWorklet.','ready');
  }catch(error){if(token===job&&error.name!=='AbortError'){if(selected)$('subtune').value=String(selected.subtune);
    status(`${error.message}${selected?' Current sound kept.':''}`,'error');}}
  finally{candidate?.dispose();if(token===job){pending=false;controls();}}
}
async function play(){
  if(!selected||pending)return;const token=beginJob();const abort=controller=new AbortController();pending=true;controls();status('Starting the research AudioWorklet…','loading');
  const old=audio;audio=null;analyser=null;const closing=old?.dispose();void closing?.catch(()=>{});let candidate;
  try{
    candidate=await createResearchAudio({profiles:profiles(),volume:Number($('volume').value)/100,signal:abort.signal,
      onError:error=>{if(token===job){playing=false;status(error.message,'error');}}});
    candidate.setVolume(Number($('volume').value)/100);
    if(token!==job)return;pendingAudio=candidate;
    await closing;
    abort.signal.throwIfAborted();if(token!==job)return;
    await candidate.command('load',[selected.bytes,selected.options]);abort.signal.throwIfAborted();
    await candidate.command('start');abort.signal.throwIfAborted();if(token!==job)return;
    audio=candidate;pendingAudio=null;candidate=null;playing=true;analyser=audio.context.createAnalyser();analyser.fftSize=1024;audio.outputNode.connect(analyser);
    showState(await audio.read());status('Playing · research 8580 C64 machine','playing');
  }catch(error){if(token===job&&error.name!=='AbortError')status(error.message,'error');}
  finally{if(pendingAudio===candidate)pendingAudio=null;await candidate?.dispose();if(token===job){pending=false;controls();}}
}
async function stop(){const token=beginJob();pending=false;playing=false;const old=audio;audio=null;analyser=null;
  if(selected)$('subtune').value=String(selected.subtune);
  await old?.dispose();if(token===job){status(selected?'Stopped. Play restarts the selected subtune.':'Stopped.','stopped');controls();}}
$('play').addEventListener('click',play);$('stop').addEventListener('click',stop);
async function readCandidate(name,read){
  const token=beginJob();const abort=controller=new AbortController();pending=true;controls();status('Reading the candidate…','loading');
  try{const bytes=new Uint8Array(await read(abort.signal));abort.signal.throwIfAborted();if(token!==job)return;
    draft={bytes,name};await loadBytes(bytes,name);}
  catch(error){if(token===job&&error.name!=='AbortError')status(`${error.message}${selected?' Current sound kept.':''}`,'error');}
  finally{if(token===job){pending=false;controls();}}
}
$('loadDemo').addEventListener('click',()=>{const name=$('demo').value;void readCandidate(`${name}.sid`,async signal=>{
  const r=await fetch(new URL(`./demos/${name}.sid`,import.meta.url),{signal});if(!r.ok)throw new Error('Demo load failed');return r.arrayBuffer();
});});
$('sidFile').addEventListener('change',()=>{const file=$('sidFile').files?.[0];if(file)void readCandidate(file.name,()=>{
  if(file.size>65700)throw new Error('SID file exceeds the 64-KiB program limit');return file.arrayBuffer();
});});
for(const id of ['clock','model'])$(id).addEventListener('change',()=>{if(draft)void loadBytes(draft.bytes,draft.name);});
$('subtune').addEventListener('change',()=>{if(selected)void loadBytes(selected.bytes,selected.name,{subtune:Number($('subtune').value)});});
$('volume').addEventListener('input',()=>{const n=Number($('volume').value);$('volumeValue').value=`${n}%`;$('volume').classList.toggle('boost',n>100);
  try{(audio??pendingAudio)?.setVolume(n/100);}catch(error){status(error.message,'error');}});
setInterval(async()=>{const current=audio;if(!current||pending)return;try{const state=await current.read();if(current===audio){playing=state.playing;showState(state);}}catch{}},500);
const context=$('wave').getContext('2d'),samples=new Float32Array(1024);
function draw(){const canvas=$('wave');context.fillStyle='#172228';context.fillRect(0,0,canvas.width,canvas.height);analyser?analyser.getFloatTimeDomainData(samples):samples.fill(0);
  context.strokeStyle='#8fc5c6';context.lineWidth=2;context.beginPath();for(let i=0;i<samples.length;i++){const x=i/(samples.length-1)*canvas.width,y=(.5-samples[i]*.45)*canvas.height;i?context.lineTo(x,y):context.moveTo(x,y);}context.stroke();requestAnimationFrame(draw);}
draw();controls();window.addEventListener('pagehide',()=>{void stop();prepared?.dispose();prepared=null;});
