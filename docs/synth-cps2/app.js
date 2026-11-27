// SPDX-License-Identifier: BSD-3-Clause
import {demoVgm,noteWrites,demoTracks} from './demo.js';
const $ = id => document.getElementById(id);
const channels = Array.from({length:16},()=>({sample:0,pan:16,volume:8000,held:null}));
let selected = 0, context, ready, port, generation = 0;
async function audio() {
  context ??= new AudioContext();
  await context.resume();
  ready ??= context.audioWorklet.addModule('./processor.js').then(()=>{
    const node = new AudioWorkletNode(context,'tetorica-cps2-preview',{outputChannelCount:[2]});
    node.connect(context.destination); port = node.port;
  }).catch(error=>{ready=null;throw error;});
  await ready;
}
const status = document.querySelector('output');
function run(task) {task().catch(e=>{status.textContent=e.message;});}
function select(channel) {
  selected = channel;
  [...$('channels').children].forEach((b,i)=>b.setAttribute('aria-pressed',i===channel));
  const v = channels[channel];
  $('wave').selectedIndex=v.sample; $('pan').value=v.pan; $('vol').value=v.volume;
}
for(let i=0;i<16;i++) {
  const button=document.createElement('button');
  button.textContent='CH'+(i+1); button.onclick=()=>select(i); $('channels').append(button);
}
select(0);
$('wave').onchange=()=>{channels[selected].sample=$('wave').selectedIndex;};
$('pan').oninput=()=>{const value=channels[selected].pan=Number($('pan').value);port?.postMessage([[0x80+selected,0x110+value]]);};
$('vol').oninput=()=>{const v=channels[selected];v.volume=Number($('vol').value);if(v.held)port?.postMessage([[selected*8+6,v.volume]]);};
function press(id,midi) {
  const ch=selected,v=channels[ch]; v.held=id;
  run(async()=>{await audio();if(v.held===id)port.postMessage(noteWrites(ch,midi,v.sample,v.pan,v.volume));});
}
function release(id) {
  channels.forEach((v,ch)=>{if(v.held===id){v.held=null;port?.postMessage([[ch*8+6,0]]);}});
}
const keys='asdfghjk',notes=[60,62,64,65,67,69,71,72];
[...keys].forEach((key,i)=>{
  const button=document.createElement('button');button.textContent=key.toUpperCase()+' · '+'CDEFGABC'[i];
  button.onpointerdown=e=>{button.setPointerCapture(e.pointerId);press('p'+e.pointerId,notes[i]);};
  button.onlostpointercapture=e=>release('p'+e.pointerId);$('keys').append(button);
});
window.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.altKey||e.metaKey||e.target.matches('input,select'))return;
  const i=keys.indexOf(e.key.toLowerCase()); if(i<0||e.key.length!==1)return;
  e.preventDefault();if(!e.repeat)press(e.code,notes[i]);
});
window.addEventListener('keyup',e=>release(e.code));
function stop(){generation++; channels.forEach(v=>v.held=null);port?.postMessage('stop');}
window.addEventListener('blur',stop);
$('demo').onclick=()=>{stop();const token=generation;run(async()=>{await audio();if(token===generation)port.postMessage($('score').value);});};
$('stop').onclick=stop;
$('save').onclick=()=>{
  const track = demoTracks[$('score').value];
  const url=URL.createObjectURL(new Blob([demoVgm(track.score())],{type:'application/octet-stream'}));
  const link=document.createElement('a');link.href=url;link.download=track.filename;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
