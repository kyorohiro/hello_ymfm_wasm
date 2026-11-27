// SPDX-License-Identifier: BSD-3-Clause
import {createParamControl} from '../synth/synth_controls.js';
import {QSOUND_PCM_RATE} from '../js/qsoundpcm.js';
import {createWaveEditor} from './wave_editor.js';
import {demoVgm,noteWrites,demoTracks,pcmRate} from './demo.js';
const $ = id => document.getElementById(id);
const channels = Array.from({length:16},()=>({sample:0,send:0,pan:16,volume:8000,held:null,rate:pcmRate(60),referenceRate:null,referenceNote:60,note:60,end:256,loop:256}));
let selected = 0, context, ready, port, generation = 0;
let revision = 0, demoPlaying = false, shown, cursor = null;
const draw = createWaveEditor(edit);
const echo = {delay:6,feedback:0};
const echoControls = {};
for (const [key,label,min,max] of [['send','Echo send · CH',-32768,32767],
  ['delay','Delay · shared',0,1024],['feedback','Feedback · shared',-32768,32767]]) {
  echoControls[key] = createParamControl({label,min,max,step:1,value:0,
    formatValue:key === 'delay' ? ticks=>ticks+' ticks · '+(ticks*1000/QSOUND_PCM_RATE).toFixed(2)+' ms' : String,
    onChange(value) {
      revision++;
      if (key === 'send') channels[selected].send = value;
      else echo[key] = value;
      port?.postMessage(echoWrite(key,value,selected));
    }});
  $('echo-controls').append(echoControls[key].element);
}
function echoWrite(key,value,ch) {
  if (key === 'delay') return {type:'echo-delay',ticks:value};
  return [[key === 'send' ? 0xba+ch : 0x93,value & 65535]];
}
function restoreEcho() {
  if (!port) return;
  port.postMessage(echoWrite('delay',echo.delay));
  port.postMessage([[0x93,echo.feedback & 65535],...channels.map((v,i)=>[0xba+i,v.send & 65535])]);
}
function showEcho(send,delay,feedback) {
  echoControls.send.updateVisual(send);
  echoControls.delay.updateVisual(delay);
  echoControls.feedback.updateVisual(feedback);
}
function refresh() {
  revision++;
  shown = channels[selected];
  cursor = null;
  showEcho(shown.send,echo.delay,echo.feedback);
  $('wave').selectedIndex=shown.sample;
  draw(shown);
}
function edit(key,value) {
  const v = channels[selected];
  Object.assign(v,{sample:shown.sample,rate:shown.rate,end:shown.end,loop:shown.loop});
  v[key] = value;
  const writes = [[selected*8+({rate:2,end:5,loop:4})[key],value]];
  if (key === 'rate') {
    v.referenceRate = value;
    v.referenceNote = v.note;
  }
  if (key === 'end' && v.loop > value-v.sample*256) {
    v.loop = value-v.sample*256;
    writes.push([selected*8+4,v.loop]);
  }
  port?.postMessage(writes);
  revision++;
  shown = v;
  draw(v,cursor);
}
function inspect({data}) {
  if (data.revision !== revision || data.channel !== selected) return;
  const v = channels[selected];
  if (demoPlaying && data.end > data.start && data.end <= data.start+256 && data.start % 256 === 0) {
    shown = {sample:data.start/256,rate:data.rate,end:data.end,loop:data.loop};
  } else shown = v;
  if (demoPlaying && data.finished && !data.active) {
    demoPlaying = false;
    restoreEcho();
    shown = v;
  }
  $('wave').selectedIndex=shown.sample;
  if (demoPlaying) showEcho(data.send,data.delay,data.feedback);
  else showEcho(v.send,echo.delay,echo.feedback);
  cursor = data.active ? data.address : null;
  draw(shown,cursor);
}
setInterval(()=>{
  if (port && !document.hidden && (demoPlaying || channels[selected].held || cursor !== null))
    port.postMessage({type:'inspect',channel:selected,revision});
},50);
async function audio() {
  context ??= new AudioContext();
  await context.resume();
  ready ??= context.audioWorklet.addModule('./processor.js').then(()=>{
    const node = new AudioWorkletNode(context,'tetorica-cps2-preview',{outputChannelCount:[2]});
    node.connect(context.destination); port = node.port; port.onmessage = inspect; restoreEcho();
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
  refresh();
}
for(let i=0;i<16;i++) {
  const button=document.createElement('button');
  button.textContent='CH'+(i+1); button.onclick=()=>select(i); $('channels').append(button);
}
select(0);
$('wave').onchange=()=>{
  const v=channels[selected];
  v.sample=$('wave').selectedIndex;
  v.end=(v.sample+1)*256;
  v.loop=256;
  if (v.held) port?.postMessage(noteWrites(selected,v.note,v.sample,v.pan,v.volume,v.rate,v.end,v.loop));
  refresh();
};
$('pan').oninput=()=>{const value=channels[selected].pan=Number($('pan').value);port?.postMessage([[0x80+selected,0x110+value]]);};
$('vol').oninput=()=>{const v=channels[selected];v.volume=Number($('vol').value);if(v.held)port?.postMessage([[selected*8+6,v.volume]]);};
function press(id,midi) {
  const ch=selected,v=channels[ch]; v.held=id;
  v.note=midi;
  v.rate=v.referenceRate === null ? pcmRate(midi) : Math.min(65535,Math.round(v.referenceRate*2**((midi-v.referenceNote)/12)));
  refresh();
  run(async()=>{await audio();if(v.held===id)port.postMessage(noteWrites(ch,midi,v.sample,v.pan,v.volume,v.rate,v.end,v.loop));});
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
function stop(){demoPlaying=false;refresh();generation++; channels.forEach(v=>v.held=null);port?.postMessage('stop');restoreEcho();}
window.addEventListener('blur',stop);
$('demo').onclick=()=>{stop();const token=generation;run(async()=>{await audio();if(token===generation){demoPlaying=true;port.postMessage($('score').value);}});};
$('stop').onclick=stop;
$('save').onclick=()=>{
  const track = demoTracks[$('score').value];
  const url=URL.createObjectURL(new Blob([demoVgm(track.score())],{type:'application/octet-stream'}));
  const link=document.createElement('a');link.href=url;link.download=track.filename;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
