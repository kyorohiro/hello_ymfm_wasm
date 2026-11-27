// SPDX-License-Identifier: BSD-3-Clause
import {setupSynthMenu} from '../synth/synth_menu.js';
import {isPresetPath,bankHash,readPreset,presetRom} from './preset.js';
import {checkPath} from '../synth-cps1/project-tree.js';
import {createSynthOutputVisualizer} from '../synth/synth_output_visualizer.js';
import {createRegisterTable} from './registers.js';
import {setupMixer,mutedVoices} from './mixer.js';
import {inspectSong} from './song.js';
import {maybeDecodeVgmFile} from '../js/vgm_file.js';
import {createSynthProjectStore} from '../synth/synth_project_store.js';
import {exportProject,importProject,validateProject,scriptPath} from './cassette.js';
import {renderFileTree} from '../playground/playground_file_tree.js';
import {createVirtualFileSystem} from '../js/tetorica_virtual_files/filesystem.js';
import {setupSynthMonacoEditor} from '../synth/synth_monaco_editor.js';
import {createParamControl} from '../synth/synth_controls.js';
import {QSOUND_PCM_RATE} from '../js/qsoundpcm.js';
import {createWaveEditor} from './wave_editor.js';
import {demoRom,demoVgm,noteWrites,demoTracks,pcmRate} from './demo.js';
const $ = id => document.getElementById(id);
setupSynthMenu({document,window});
const channels = Array.from({length:16},()=>({sample:0,send:0,pan:16,volume:8000,held:null,rate:pcmRate(60),referenceRate:null,referenceNote:60,note:60,end:256,loop:256}));
let selected = 0, context, ready, port, masterGain, generation = 0;
let revision = 0, shown, cursor = null;
let codeWorker = null, liveInstrument=false;
let songPath=null, songState='stopped', songSelection=0;
let preparedSong=null, preparationRevision=0;
let seekWorker=null, seeking=false, sliding=false;
const songLimit=16*1024*1024;
async function prepareSong(raw) {
  const bytes=new Uint8Array(await maybeDecodeVgmFile(raw,{maxBytes:songLimit}));
  return {bytes,...inspectSong(bytes)};
}
function clockText(ticks) {
  const s=Math.floor(ticks/44100);
  return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
}
function showPosition(tick) {
  const total=preparedSong?.ticks??0;
  tick=Math.max(0,Math.min(total,Math.round(tick)));
  const text=clockText(tick)+' / '+clockText(total);
  const slider=$('song-seek');
  slider.value=tick;
  slider.setAttribute('aria-valuetext',text);
  if($('song-position').value!==text)$('song-position').value=text;
}
function transport() {
  syncPadView();
  $('song-seek').disabled=!preparedSong;
  $('song-seek').max=preparedSong?.ticks??1;
  if(songState==='stopped' && !seeking && !liveInstrument)showPosition(0);
  const mark=$('loop-mark');
  mark.hidden=!preparedSong?.canLoop;
  if(!mark.hidden){
    mark.style.left=(100*preparedSong.loopTick/preparedSong.ticks)+'%';
    mark.title='Loop start '+clockText(preparedSong.loopTick);
  }
  $('song-transport').hidden=!songPath;
  $('song-loop').disabled=!preparedSong?.canLoop;
  $('song-title').textContent=songPath?.split('/').pop()??'';
  $('song-status').textContent=seeking?'Seeking…':songState==='paused'?'Paused · audition':songState==='playing'?'Playing':liveInstrument?'Stopped · audition':'Ready';
  $('song-play').disabled=seeking || songState==='playing' || !preparedSong;
  $('song-play').textContent=songState==='paused'?'Resume':'Play VGM';
  $('song-pause').disabled=seeking || songState!=='playing';
  $('song-stop').disabled=songState==='stopped';
  $('wave').disabled=liveInstrument;
  $('stop').hidden=Boolean(songPath) && songState!=='stopped';
  $('audition-note').hidden=!liveInstrument;
  $('restore-instrument').hidden=!liveInstrument;
  $('vol').min=liveInstrument?-32768:0;
  $('vol').max=liveInstrument?32767:16384;
}

const scope=createSynthOutputVisualizer({background:'#102c43',grid:'#305067',trace:'#afeacb'});
const canvas=$('output-scope'), scopeContext=canvas.getContext('2d');
let scopeMode='waveform', scopeVisible=false, scopeTimer;
function drawScope(){scope.draw(canvas,scopeContext,scopeMode);}
function updateScope() {
  clearInterval(scopeTimer);
  if (!scopeVisible || document.hidden) return;
  drawScope();
  if (masterGain) scopeTimer=setInterval(drawScope,1000/30);
}
new IntersectionObserver(([entry])=>{scopeVisible=entry.isIntersecting;updateScope();}).observe(canvas);
new ResizeObserver(([entry])=>{
  canvas.width=Math.max(1,Math.round(entry.contentRect.width));
  canvas.height=Math.max(1,Math.round(entry.contentRect.height));
  if(scopeVisible)drawScope();
}).observe(canvas);
document.addEventListener('visibilitychange',updateScope);
const modes=document.querySelectorAll('[data-visual-mode]');
for(const button of modes)button.onclick=()=>{
  scopeMode=button.dataset.visualMode;
  for(const item of modes)item.setAttribute('aria-pressed',String(item===button));
  canvas.setAttribute('aria-label','Output '+scopeMode);
  drawScope();
};
const mixer = setupMixer(applyMix);
function applyMix(settings) {
  if(masterGain)masterGain.gain.setTargetAtTime(settings.master/100,context.currentTime,0.005);
  port?.postMessage({type:'mute-voices',mask:mutedVoices(settings)});
}
const draw = createWaveEditor(edit);
const echo = {delay:6,feedback:0};
const echoControls = {};
for (const [key,label,min,max] of [['send','Echo send · CH',-32768,32767],
  ['delay','Delay · shared',0,1024],['feedback','Feedback · shared',-32768,32767]]) {
  echoControls[key] = createParamControl({label,min,max,step:1,value:0,
    formatValue:key === 'delay' ? ticks=>ticks+' ticks · '+(ticks*1000/QSOUND_PCM_RATE).toFixed(2)+' ms' : String,
    onChange(value) {
      revision++;
      if (!liveInstrument) {
        if (key === 'send') channels[selected].send = value;
        else echo[key] = value;
      }
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
  if(liveInstrument){
    if(key==='rate' && songState!=='playing')port?.postMessage({type:'voice-setting',channel:selected,field:'rate',value});
    else port?.postMessage([[selected*8+({rate:2,end:5,loop:4})[key],value]]);
    revision++;
    return;
  }
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
const registerPanel=$('register-panel');
const drawRegisters=createRegisterTable($('register-rows'),$('register-position'));
function inspectChannel() {
  port?.postMessage({type:'inspect',channel:selected,revision,skipWave:$('pcm-chip').hidden,padVoice:liveInstrument && !$('adpcm-chip').hidden?padVoice:null,registers:!registerPanel.hidden});
}
function selectPcmTab(registers) {
  registerPanel.hidden=!registers;
  $('pcm-panel').hidden=registers;
  $('pcm-tab').setAttribute('aria-pressed',String(!registers));
  $('register-tab').setAttribute('aria-pressed',String(registers));
  revision++;
  if(registers)drawRegisters(selected);
  inspectChannel();
}
$('register-tab').onclick=()=>selectPcmTab(true);
$('pcm-tab').onclick=()=>selectPcmTab(false);
function inspect({data}) {
  if (data.revision !== revision || data.channel !== selected) return;
  if(liveInstrument && !seeking && data.padVoice===padVoice && data.padState)showPad(data.padState);
  if (!registerPanel.hidden && data.words && !seeking)drawRegisters(selected,data.words,data.address);
  if (data.view && liveInstrument) {
    if(seeking)return;
    cursor=data.active?data.address:null;
    if(data.view.ended && songState==='playing'){showPosition(preparedSong.ticks);stop();return;}
    let tick=Math.round(data.view.seconds*44100);
    if(preparedSong?.canLoop && tick>preparedSong.ticks){
      const span=preparedSong.ticks-preparedSong.loopTick;
      tick=preparedSong.loopTick+(tick-preparedSong.ticks)%span;
    }
    if(!sliding && songState!=='stopped')showPosition(tick);
    $('wave').selectedIndex=2;
    $('pan').value=Math.min(32,Math.max(0,data.view.pan-0x110));
    $('vol').value=data.view.volume;
    showEcho(data.send,data.delay,data.feedback);
    if(!registerPanel.hidden || !data.view.wave)return;
    draw({sample:0,rate:data.rate,end:data.end&65535,loop:data.loop&65535},data.active?data.address:null,data.view);
    return;
  }
  shown=channels[selected];
  $('wave').selectedIndex=shown.sample;
  showEcho(shown.send,echo.delay,echo.feedback);
  cursor = data.active ? data.address : null;
  if(registerPanel.hidden)draw(shown,cursor);
}
let lastInspect=0;
setInterval(()=>{
  if(!port || document.hidden)return;
  const moving=songState==='playing' || codeWorker || channels[selected].held || cursor!==null;
  if(!moving && !liveInstrument && registerPanel.hidden)return;
  const now=performance.now();
  if(!moving && now-lastInspect<250)return;
  lastInspect=now;
  inspectChannel();
},50);
async function audio() {
  context ??= new AudioContext();
  await context.resume();
  ready ??= context.audioWorklet.addModule('./processor.js').then(()=>{
    const node = new AudioWorkletNode(context,'tetorica-cps2-preview',{outputChannelCount:[2]});
    masterGain=context.createGain();
    masterGain.gain.value=mixer.get().master/100;
    node.connect(masterGain).connect(context.destination);
    scope.connect(context,[masterGain]);updateScope();
    port = node.port; port.onmessage = inspect; applyMix(mixer.get()); restoreEcho();
  }).catch(error=>{ready=null;throw error;});
  await ready;
}
const status = document.querySelector('footer output');
function run(task) {task().catch(e=>{status.textContent=e.message;});}
function select(channel) {
  selected = channel;
  if(!registerPanel.hidden)drawRegisters(selected);
  [...$('channels').children].forEach((b,i)=>b.setAttribute('aria-pressed',i===channel));
  const v = channels[channel];
  $('wave').selectedIndex=v.sample; $('pan').value=v.pan; $('vol').value=v.volume;
  if(liveInstrument){revision++;inspectChannel();}
  else{refresh();if(!registerPanel.hidden)inspectChannel();}
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
$('pan').oninput=()=>{const value=Number($('pan').value);if(!liveInstrument)channels[selected].pan=value;port?.postMessage([[0x80+selected,0x110+value]]);};
$('vol').oninput=()=>{const v=channels[selected];const volume=Number($('vol').value);if(!liveInstrument)v.volume=volume;
  if(liveInstrument && songState!=='playing')port?.postMessage({type:'voice-setting',channel:selected,field:'volume',value:volume});
  else if(v.held || liveInstrument)port?.postMessage([[selected*8+6,volume&65535]]);};
function press(id,midi) {
  const ch=selected,v=channels[ch]; v.held=id;
  if(liveInstrument){
    if(!seeking)port?.postMessage({type:'captured-note',channel:ch,midi});
    return;
  }
  v.note=midi;
  v.rate=v.referenceRate === null ? Math.min(65535,pcmRate(midi)) : Math.min(65535,Math.round(v.referenceRate*2**((midi-v.referenceNote)/12)));
  refresh();
  run(async()=>{await audio();if(v.held===id)port.postMessage(noteWrites(ch,midi,v.sample,v.pan,v.volume,v.rate,v.end,v.loop));});
}
function release(id) {
  channels.forEach((v,ch)=>{if(v.held===id){v.held=null;port?.postMessage(liveInstrument?{type:'captured-off',channel:ch}:[[ch*8+6,0]]);}});
}
const keys='awsedftgyhujk';
const noteNames=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B','C'];
let octave=4;
const keyboardNote=i=>(octave+1)*12+i;
$('octave').append(createParamControl({label:'Octave',min:0,max:7,step:1,value:octave,
  onChange:value=>{octave=value;}}).element);
[...keys].forEach((key,i)=>{
  const button=document.createElement('button');
  button.textContent=key.toUpperCase()+' · '+noteNames[i];
  if(noteNames[i].includes('♯'))button.className='sharp';
  button.onpointerdown=e=>{button.setPointerCapture(e.pointerId);press('p'+e.pointerId,keyboardNote(i));};
  button.onlostpointercapture=e=>release('p'+e.pointerId);
  button.onkeydown=e=>{
    if(e.code==='Space' || e.code==='Enter'){
      e.preventDefault();if(!e.repeat)press(e.code,keyboardNote(i));
    }
  };
  $('keys').append(button);
});
const pads=Array.from({length:3},(_,i)=>({sample:i,start:(i+1)*512,end:(i+2)*512,bank:0,pan:16*i,volume:32767}));
let padVoice=0;
const padControls={};
const padHex=n=>'0x'+n.toString(16).toUpperCase().padStart(4,'0');
const padFields=['start','end','bank','volume'];
function showPad(state){
  const live=state?.panWord!==undefined;
  const pad=state??pads[padVoice];
  for(const key of padFields)padControls[key].updateVisual(pad[key]);
  padControls.panWord.updateVisual(live?pad.panWord:0x110+pad.pan);
  padControls.sample.updateVisual(pads[padVoice].sample);
}
function syncPadView(){
  padControls.panWord.updateRange(liveInstrument?0:0x110,liveInstrument?65535:0x130);
  padControls.sample.element.style.display=liveInstrument?'none':'';
  $('pad-trigger').disabled=seeking;
  $('pad-status').textContent=songState==='paused'?'Paused · Audition the captured ROM.':'';
  if(!liveInstrument)showPad();
}
function padWrites(i){
  const pad=pads[i],base=0xca+4*i;
  return [[base,pad.start],[base+1,pad.end],[base+2,pad.bank],[base+3,pad.volume&65535],[0x90+i,0x110+pad.pan]];
}
function triggerPad(i){
  if(seeking)return;
  const token=generation;
  const writes=liveInstrument ? [] : padWrites(i);
  writes.push([0xd6+i,1]);
  run(async()=>{await audio();if(token===generation)port.postMessage(writes);});
}
for(let i=0;i<3;i++){
  const b=document.createElement('button');
  b.textContent='Voice '+(i+1);
  b.setAttribute('aria-pressed',String(i===0));
  b.onclick=()=>{
    padVoice=i;revision++;
    for(const item of $('adpcm-voices').children)item.setAttribute('aria-pressed',String(item===b));
    if(liveInstrument)inspectChannel();else showPad();
  };
  $('adpcm-voices').append(b);
}
for(const [key,label,min,max] of [['sample','Sample',0,2],['start','Start',0,65535],['end','End (exclusive)',0,65535],
  ['bank','ROM bank',0,32767],['volume','Volume',-32768,32767],['panWord','Pan register',0x110,0x130]]){
  const control=createParamControl({label,min,max,step:1,value:min,formatValue:key==='sample'?n=>'Pulse '+(n+1):key==='volume'?String:padHex,
    onChange(value){
      revision++;
      const pad=pads[padVoice];
      if(!liveInstrument){
        if(key==='sample'){
          Object.assign(pad,{sample:value,start:(value+1)*512,end:(value+2)*512,bank:0});showPad();return;
        }
        if(key==='panWord')pad.pan=value-0x110;
        else pad[key]=value;
      }
      const reg=key==='panWord'?0x90+padVoice:0xca+4*padVoice+padFields.indexOf(key);
      port?.postMessage([[reg,value&65535]]);
      if(liveInstrument)inspectChannel();
    }});
  padControls[key]=control;
  $('adpcm-pads').append(control.element);
}
$('pad-trigger').onclick=()=>triggerPad(padVoice);
syncPadView();
window.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.altKey||e.metaKey||e.target.closest('input:not([type=range]):not([type=checkbox]),textarea,.monaco-editor,[contenteditable=true]'))return;
  if (/^[123]$/.test(e.key)) {
    e.preventDefault();
    if (!e.repeat) triggerPad(Number(e.key)-1);
    return;
  }
  const i=keys.indexOf(e.key.toLowerCase()); if(i<0||e.key.length!==1)return;
  e.preventDefault();if(!e.repeat)press(e.code,keyboardNote(i));
});
window.addEventListener('keyup',e=>release(e.code));
function stop(keepInstrument=true){
  liveInstrument=Boolean(keepInstrument && liveInstrument);
  cancelSeek();sliding=false;songState='stopped';
  stopWorker();
  generation++;
  channels.forEach(v=>v.held=null);
  $('pan').value=channels[selected].pan;
  $('vol').value=channels[selected].volume;
  transport();refresh();
  port?.postMessage(liveInstrument?'stop-audition':'stop');
  if(!liveInstrument)restoreEcho();
  if(liveInstrument)inspectChannel();
}
window.addEventListener('blur',()=>{if(songState==='stopped')stop();else channels.forEach(v=>{if(v.held)release(v.held);});});
$('restore-instrument').onclick=()=>stop(false);
$('demo').onclick=()=>run(async()=>{
  const track=demoTracks[$('score').value],bytes=demoVgm(track.score());
  stop(false);
  songPath='/songs/'+track.filename;
  // Old cassettes need not contain the built-in demo files.
  if(files.has(songPath))songPath=availableDemoPath(track,bytes);
  if(!files.has(songPath))files.writeBinary(songPath,bytes);
  highlightedPath=songPath;preparationRevision++;preparedSong={bytes,...inspectSong(bytes)};
  transport();renderFiles();await playSong();
});
function availableDemoPath(track,bytes){
  const original='/songs/'+track.filename;
  let path=original,n=1;
  while(files.has(path)){
    const data=files.get(path).data;
    if(data instanceof Uint8Array && bytes.length===data.length && bytes.every((v,i)=>v===data[i]))break;
    path=original.replace('.vgm','-'+(++n)+'.vgm');
  }
  return path;
}
$('stop').onclick=stop;
$('save').onclick=()=>{
  const track = demoTracks[$('score').value];
  const url=URL.createObjectURL(new Blob([demoVgm(track.score())],{type:'application/octet-stream'}));
  const link=document.createElement('a');link.href=url;link.download=track.filename;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};

const source = $('source');
const files = createVirtualFileSystem([
  {path:'/index.js',data:source.value},
  ...Object.values(demoTracks).map(track=>({path:'/songs/'+track.filename,data:demoVgm(track.score())})),
  {path:'/examples/pad-loop.js',data:`setBpm(106);
liveLoop('pads', async () => {
  for (const voice of [1, 2, 1, 3]) {
    qsound.trigger(voice, voice - 1, (voice - 1) * 16);
    await beat(0.5);
  }
});
`},
]);
let activePath='/index.js', highlightedPath=activePath;
const expanded=new Map([['/examples',true],['/songs',true],['/presets',true]]);
const editor = setupSynthMonacoEditor({
  textarea:source,editorHost:$('code-host'),editorNote:$('editor-note'),chip:'cps2',
  declarationsOnly:true,transformDeclarations:()=>`
declare function liveLoop(name:string, play:()=>Promise<void>):void;
declare function beat(beats?:number):Promise<void>;
declare function setBpm(bpm:number):void;
declare function sleep(seconds:number):Promise<void>;
declare function stopLoop(name:string):void;
declare const qsound:{
  writeRegister(register:number,value:number):void;
  noteOn(channel:number,midi:number,sample?:number,pan?:number,volume?:number):void;
  noteOff(channel:number):void;
  trigger(voice:number,sample?:number,pan?:number,volume?:number):void;
};
declare function useSoundChip(name:'qsound'):Promise<typeof qsound>;`,
  getPath:()=>activePath,listFiles:()=>files.list().filter(f=>f.type==='text' && f.path.endsWith('.js')),openFile:openScript,
  onEdit:()=>{files.writeText(activePath,source.value);scheduleDraft();},visible:()=>!$('code-panel').hidden,run:apply=>$(apply?'apply-code':'run-code').click(),
});
function selectPerformance(code) {
  $('code-panel').hidden=!code;
  if(code)setFiles(true);
  $('keyboard-tab').setAttribute('aria-pressed',String(!code));
  $('code-tab').setAttribute('aria-pressed',String(code));
  if(code)editor.load().then(()=>editor.layout());
}
function setFiles(visible){
  $('files').hidden=!visible;
  $('workspace').classList.toggle('files-hidden',!visible);
  $('files-toggle').setAttribute('aria-pressed',String(visible));
  if(!$('code-panel').hidden)editor.layout();
}
$('files-toggle').onclick=()=>setFiles($('files').hidden);
for(const tab of document.querySelectorAll('[data-chip]'))tab.onclick=()=>{
  for(const item of document.querySelectorAll('[data-chip]')){
    $(item.dataset.chip).hidden=item!==tab;
    item.setAttribute('aria-pressed',String(item===tab));
  }
};
$('keyboard-tab').onclick=()=>selectPerformance(false);
$('code-tab').onclick=()=>selectPerformance(true);
function stopWorker() {
  codeWorker?.terminate();
  codeWorker=null;
  $('apply-code').disabled=$('stop-code').disabled=true;
  $('code-status').textContent='';
}
$('run-code').onclick=()=>run(async()=>{
  if(songState==='playing')pauseSong();
  if(codeWorker && liveInstrument)port?.postMessage({type:'silence-audition'});
  stopWorker();
  if(!liveInstrument)stop(false);
  const token=++generation;
  await audio();
  if(token!==generation)return;
  const worker=new Worker('./code-worker.js',{type:'module'});
  if(!liveInstrument){
    const settings=channels.flatMap((v,ch)=>noteWrites(ch,v.note,v.sample,v.pan,v.volume,v.rate,v.end,v.loop));
    port.postMessage([...settings,...pads.flatMap((_,i)=>padWrites(i))]);
    port.postMessage('stop-audition');
  }
  codeWorker=worker;liveInstrument=true;transport();
  $('stop-code').disabled=false;
  worker.onmessage=({data})=>{
    if(worker!==codeWorker)return;
    if(data.audition)port.postMessage(data.audition);
    if(data.writes)port.postMessage(data.writes);
    if(data.status){$('code-status').textContent=data.status;$('apply-code').disabled=false;}
  };
  worker.onerror=e=>{if(worker===codeWorker){stop();$('code-status').textContent=e.message;}};
  worker.postMessage({source:source.value,path:activePath,captured:liveInstrument});
});
$('apply-code').onclick=()=>codeWorker?.postMessage({source:source.value,path:activePath,apply:true});
$('stop-code').onclick=stop;

function renderFiles() {
  const entries=files.list();
  const songs=entries.filter(file=>file.type==='binary').length;
  $('export-contents').textContent='Includes '+songs+' VGM/VGZ '+(songs===1?'file':'files')+' with embedded sample data.';
  renderFileTree($('project-tree'),entries,{expanded,selectedPath:highlightedPath,onOpen:openScript});
}
function openScript(path,prepared) {
  const file=files.get(path);
  if (!file) return;
  highlightedPath=path;
  if(isPresetPath(path)){run(()=>loadPreset(path,file.data));return;}
  if (file.type==='binary') {
    if(path===songPath && preparedSong && !prepared){renderFiles();return;}
    stop(false);songPath=path;
    preparedSong=null;$('song-loop').checked=false;
    transport();renderFiles();
    const token=++preparationRevision;
    Promise.resolve(prepared??prepareSong(file.data)).then(song=>{
      if(token!==preparationRevision || path!==songPath)return;
      preparedSong=song;transport();
    }).catch(error=>{if(token===preparationRevision && path===songPath)$('file-status').textContent=error.message;});
    return;
  }
  selectPerformance(true);
  activePath=path;
  editor.setSource(file.data,path);
  renderFiles();
  scheduleDraft();
}
async function savePreset(){
  const ch=selected,token=generation;
  let voice;
  if(liveInstrument){
    const {port1,port2}=new MessageChannel();
    const result=new Promise(resolve=>{port1.onmessage=e=>{port1.close();resolve(e.data);};});
    port.postMessage({type:'read-preset',channel:ch,reply:port2},[port2]);
    voice=await result;
  }else{
    const v=channels[ch];
    const rate=v.referenceRate===null?pcmRate(60):Math.min(65535,Math.round(v.referenceRate*2**((60-v.referenceNote)/12)));
    voice={source:null,clock:4000000,bytes:demoRom(),bank:0,start:v.sample*256,end:v.end,loop:v.loop,
      rate,pan:0x110+v.pan,volume:v.volume,send:v.send};
  }
  const {bytes,...settings}=voice;
  if(!bytes.length)throw Error('This channel has no sample ROM in its bank.');
  const preset={format:'qsound-pcm-1',...settings,bankHash:await bankHash(bytes)};
  if(generation!==token)return;
  const name=prompt('PCM preset name','CH'+(ch+1))?.trim();
  if(!name)return;
  const path=checkPath('/presets/'+name.replace(/\.pcm\.json$/i,'')+'.pcm.json');
  if(!isPresetPath(path))throw Error('Enter a file name without folders.');
  if(files.has(path) && !confirm('Replace '+path+'?'))return;
  const text=JSON.stringify(preset,null,2);
  readPreset(text);
  files.writeText(path,text);
  highlightedPath=path;setFiles(true);renderFiles();await saveDraft();
  $('file-status').textContent='Saved '+path;
}
$('save-preset').onclick=()=>run(savePreset);

async function loadPreset(path,text){
  const p=readPreset(text),ch=selected,token=generation;
  const sourceFile=p.source && files.get(p.source.path);
  if(p.source && !sourceFile)throw Error('Missing preset source '+p.source.path);
  const song=sourceFile?await prepareSong(sourceFile.data):null;
  const rom=await presetRom(p,song?.bytes);
  await audio();
  if(token!==generation || path!==highlightedPath || ch!==selected)return;
  stop();
  liveInstrument=true;
  songPath=p.source?.path??null;preparedSong=song;preparationRevision++;
  port.postMessage({type:'load-preset',channel:ch,preset:p,rom},[rom.buffer]);
  selectPerformance(false);
  document.querySelector('[data-chip="pcm-chip"]').click();selectPcmTab(false);
  showPosition(0);transport();inspectChannel();renderFiles();scheduleDraft();
  $('file-status').textContent='Loaded '+path+' on CH'+(ch+1)+' · Shared ROM: '+(songPath??'factory');
}
function snapshot() {
  return {version:1,files:files.list(),active:activePath,song:songPath,channels:channels.map(({held,...settings})=>settings),
    pads:pads.map(p=>({...p})),mix:mixer.get(),selected,echo:{...echo}};
}
const factory=snapshot();
function replaceProject(project) {
  stop(false);
  songSelection++;songPath=null;preparedSong=null;transport();
  files.replace(project.files);
  project.channels.forEach((v,i)=>Object.assign(channels[i],v,{held:null}));
  project.pads.forEach((v,i)=>{
    Object.assign(pads[i],v);
  });
  syncPadView();
  mixer.set(project.mix);
  Object.assign(echo,project.echo);
  restoreEcho();
  select(project.selected);
  activePath=highlightedPath=project.active;editor.setSource(files.get(activePath).data,activePath);renderFiles();
  if(project.song)openScript(project.song);
}
const draftKey='tetorica.cps2.cassette.v1';
const store=createSynthProjectStore({name:'tetorica-cps2-project'});
let timer, draftReady=false;
async function saveDraft() {
  clearTimeout(timer);
  if(!draftReady)return;
  try {if(!await store.write(snapshot())) throw Error();}
  catch { $('file-status').textContent='Local draft could not be saved. Export a cassette to keep your work.'; }
}
function scheduleDraft() {clearTimeout(timer);timer=setTimeout(saveDraft,350);}
window.addEventListener('pagehide',saveDraft);
for (const event of ['click','change','pointerup','wheel']) document.querySelector('main').addEventListener(event,scheduleDraft);
$('new-script').onclick=()=>run(async()=>{
  const name=prompt('JavaScript file path','/examples/untitled.js')?.trim();
  if (!name) return;
  const path=scriptPath(name.startsWith('/')?name:'/'+name);
  if (files.has(path) || files.listDirectories().includes(path)) throw Error('Path already exists.');
  files.writeText(path,'');
  openScript(path);
});
$('new-cassette').onclick=()=>{
  if (!confirm('Replace the current files and instrument settings with the factory cassette?')) return;
  replaceProject(factory);saveDraft();$('file-status').textContent='New cassette';
};
function downloadCassette(project,filename) {
  const url=URL.createObjectURL(new Blob([exportProject(project)],{type:'application/zip'}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  $('file-status').textContent='Exported '+filename;
}
$('export-cassette').onclick=()=>run(async()=>downloadCassette(snapshot(),'tetorica-cps2.cassette.zip'));
$('demo-cassette').onclick=()=>run(async()=>{
  downloadCassette(factory,'tetorica-cps2-demos.cassette.zip');
});
$('import-cassette').onclick=()=>$('cassette-input').click();
$('cassette-input').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';
  if (!file) return;
  try {
    if (file.size>16*1024*1024) throw Error('Cassette exceeds 16 MiB.');
    const project=await importProject(await file.arrayBuffer());
    for(const file of project.files)if(file.type==='binary')await prepareSong(file.data);
    if (!confirm('Replace the current project with '+file.name+'?')) return;
    replaceProject(project);saveDraft();$('file-status').textContent='Imported '+file.name;
  } catch(error){$('file-status').textContent=error.message;}
};
$('import-song').onclick=()=>$('song-input').click();
$('song-input').onchange=async event=>{
  const file=event.target.files[0];event.target.value='';
  if(!file)return;
  const token=++songSelection;
  try {
    if(file.size>songLimit || !/\.(vgm|vgz)$/i.test(file.name))throw Error('Choose a VGM or VGZ up to 16 MiB.');
    const raw=new Uint8Array(await file.arrayBuffer());
    const prepared=await prepareSong(raw);
    if(token!==songSelection)return;
    const path='/songs/'+file.name;
    if(files.has(path) && !confirm('Replace '+path+'?'))return;
    files.writeBinary(path,raw);openScript(path,prepared);saveDraft();
    $('file-status').textContent='Imported '+file.name;
  } catch(error){$('file-status').textContent=error.message;}
};
async function playSong(){
  if(songState==='paused'){stopWorker();channels.forEach(v=>v.held=null);revision++;songState='playing';port.postMessage({type:'pause-song',paused:false});transport();return;}
  stop();
  const token=generation;
  if(!preparedSong)return;
  const {bytes}=preparedSong;
  await audio();
  if(token!==generation)return;
  liveInstrument=true;songState='playing';port.postMessage({type:'song',path:songPath,bytes,loop:preparedSong.canLoop && $('song-loop').checked});transport();
}
$('song-play').onclick=()=>run(playSong);
function pauseSong(){
  revision++;channels.forEach(v=>v.held=null);
  songState='paused';port.postMessage({type:'pause-song',paused:true});transport();inspectChannel();
}
$('song-pause').onclick=pauseSong;
function cancelSeek(){
  seekWorker?.terminate();
  seekWorker=null;
  seeking=false;
}
const slider=$('song-seek');
slider.oninput=()=>{sliding=true;showPosition(Number(slider.value));};
slider.onpointercancel=()=>{sliding=false;};
slider.onpointerup=()=>{sliding=false;};
slider.onkeydown=e=>{
  if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
  e.preventDefault();
  const step=(e.shiftKey?10:1)*44100;
  showPosition(Number(slider.value)+(e.key==='ArrowLeft'?-step:step));
  slider.dispatchEvent(new Event('change'));
};
slider.onchange=()=>run(async()=>{
  const tick=Number(slider.value),song=preparedSong;
  if(!song)return;
  stopWorker();channels.forEach(v=>v.held=null);
  sliding=false;
  if(songState==='stopped'){stop();liveInstrument=true;songState='paused';}
  cancelSeek();
  const token=++generation;
  port?.postMessage({type:'pause-song',paused:true});
  seeking=true;
  transport();showPosition(tick);
  try {
    await audio();
    if(token!==generation)return;
    const worker=new Worker('./seek-worker.js',{type:'module'});
    seekWorker=worker;
    worker.onmessage=({data:state})=>{
      if(token!==generation)return;
      revision++;
      port.postMessage({type:'song',path:songPath,bytes:song.bytes,state,loop:$('song-loop').checked,paused:songState==='paused'},
        [state.chip.rom.buffer,state.chip.echoLine.buffer,state.starts.buffer]);
      cancelSeek();transport();inspectChannel();
    };
    worker.onerror=e=>{if(token===generation){stop();status.textContent=e.message;}};
    worker.postMessage({bytes:song.bytes,rate:context.sampleRate,tick,mutes:mutedVoices(mixer.get())});
  } catch(error){if(token===generation)stop();throw error;}
});
$('song-stop').onclick=stop;
$('song-loop').onchange=()=>port?.postMessage({type:'loop-song',enabled:Boolean(preparedSong?.canLoop) && $('song-loop').checked});
renderFiles();
try {
  const draft=await store.read() ?? JSON.parse(localStorage.getItem(draftKey));
  if (draft) replaceProject(validateProject(draft));
} catch(error){$('file-status').textContent='Draft unavailable: '+error.message;}
draftReady=true;
