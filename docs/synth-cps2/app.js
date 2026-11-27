// SPDX-License-Identifier: BSD-3-Clause
import {createSynthOutputVisualizer} from '../synth/synth_output_visualizer.js';
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
import {demoVgm,noteWrites,demoTracks,pcmRate,adpcmTriggerWrites} from './demo.js';
const $ = id => document.getElementById(id);
const channels = Array.from({length:16},()=>({sample:0,send:0,pan:16,volume:8000,held:null,rate:pcmRate(60),referenceRate:null,referenceNote:60,note:60,end:256,loop:256}));
let selected = 0, context, ready, port, masterGain, generation = 0;
let revision = 0, demoPlaying = false, shown, cursor = null;
let codeWorker = null;
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
  $('song-seek').disabled=!preparedSong;
  $('song-seek').max=preparedSong?.ticks??1;
  if(songState==='stopped' && !seeking)showPosition(0);
  const mark=$('loop-mark');
  mark.hidden=!preparedSong?.canLoop;
  if(!mark.hidden){
    mark.style.left=(100*preparedSong.loopTick/preparedSong.ticks)+'%';
    mark.title='Loop start '+clockText(preparedSong.loopTick);
  }
  $('song-transport').hidden=!songPath;
  $('song-loop').disabled=!preparedSong?.canLoop;
  $('song-title').textContent=songPath?.split('/').pop()??'';
  $('song-play').disabled=seeking || songState==='playing' || !preparedSong;
  $('song-play').textContent=songState==='paused'?'Resume':'Play VGM';
  $('song-pause').disabled=seeking || songState!=='playing';
  $('song-stop').disabled=songState==='stopped';
  $('wave').disabled=songState!=='stopped';
  $('vol').min=songState==='stopped'?0:-32768;
  $('vol').max=songState==='stopped'?16384:32767;
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
      if (songState==='stopped') {
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
  if(songState!=='stopped'){
    port?.postMessage([[selected*8+({rate:2,end:5,loop:4})[key],value]]);
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
function inspect({data}) {
  if (data.revision !== revision || data.channel !== selected) return;
  if (data.view && songState!=='stopped') {
    if(seeking)return;
    if(data.view.ended && songState==='playing'){stop();return;}
    let tick=Math.round(data.view.seconds*44100);
    if(preparedSong?.canLoop && tick>preparedSong.ticks){
      const span=preparedSong.ticks-preparedSong.loopTick;
      tick=preparedSong.loopTick+(tick-preparedSong.ticks)%span;
    }
    if(!sliding)showPosition(tick);
    $('wave').selectedIndex=-1;
    $('pan').value=Math.min(32,Math.max(0,data.view.pan-0x110));
    $('vol').value=data.view.volume;
    showEcho(data.send,data.delay,data.feedback);
    draw({sample:0,rate:data.rate,end:data.end&65535,loop:data.loop&65535},data.active?data.address:null,data.view);
    return;
  }
  const v = channels[selected];
  if ((demoPlaying || codeWorker) && [0,256].includes(data.start) && data.loop>=0 && data.loop<=data.end-data.start && data.end > data.start && data.end <= data.start+256) {
    shown = {sample:data.start/256,rate:data.rate,end:data.end,loop:data.loop};
  } else shown = v;
  if (demoPlaying && data.finished && !data.active) {
    demoPlaying = false;
    restoreEcho();
    shown = v;
  }
  $('wave').selectedIndex=shown.sample;
  if (demoPlaying || codeWorker) showEcho(data.send,data.delay,data.feedback);
  else showEcho(v.send,echo.delay,echo.feedback);
  cursor = data.active ? data.address : null;
  draw(shown,cursor);
}
setInterval(()=>{
  if (port && !document.hidden && (songState!=='stopped' || demoPlaying || codeWorker || channels[selected].held || cursor !== null))
    port.postMessage({type:'inspect',channel:selected,revision});
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
$('pan').oninput=()=>{const value=Number($('pan').value);if(songState==='stopped')channels[selected].pan=value;port?.postMessage([[0x80+selected,0x110+value]]);};
$('vol').oninput=()=>{const v=channels[selected];const volume=Number($('vol').value);if(songState==='stopped')v.volume=volume;if(v.held || songState!=='stopped')port?.postMessage([[selected*8+6,volume]]);};
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
const pads = Array.from({length:3},(_,i)=>({sample:i,pan:16*i,volume:0x7fff}));
function triggerPad(i) {
  const token = generation;
  const {sample,pan,volume} = pads[i];
  run(async()=>{
    await audio();
    if (token === generation) port.postMessage(adpcmTriggerWrites(i,sample,pan,volume));
  });
}
const padControls = [];
pads.forEach((pad,i)=>{
  const controls={};
  padControls.push(controls);
  const group = document.createElement('fieldset');
  group.className = 'adpcm-voice';
  const legend = document.createElement('legend');
  legend.textContent = 'ADPCM '+(i+1);
  const button = document.createElement('button');
  button.className = 'adpcm-pad';
  button.textContent = 'Trigger · '+(i+1);
  button.onpointerdown = e=>{if(e.button===0)triggerPad(i);};
  button.onclick = e=>{if(e.detail===0)triggerPad(i);};
  group.append(legend,button);
  for (const [key,label,max] of [['sample','Sample',2],['pan','Pan',32],['volume','Volume',32767]]) {
    const control = createParamControl({label,min:0,max,step:1,value:pad[key],
      formatValue:key==='sample' ? n=>'Pulse '+(n+1) : String,
      onChange(value) {
        pad[key]=value;
        if (key==='pan') port?.postMessage([[0x90+i,0x110+value]]);
      }});
    controls[key]=control;
    group.append(control.element);
  }
  $('adpcm-pads').append(group);
});
window.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.altKey||e.metaKey||e.target.closest('input,select,textarea,.monaco-editor,[contenteditable=true]'))return;
  if (/^[123]$/.test(e.key)) {
    e.preventDefault();
    if (!e.repeat) triggerPad(Number(e.key)-1);
    return;
  }
  const i=keys.indexOf(e.key.toLowerCase()); if(i<0||e.key.length!==1)return;
  e.preventDefault();if(!e.repeat)press(e.code,notes[i]);
});
window.addEventListener('keyup',e=>release(e.code));
function stop(){cancelSeek();sliding=false;songState='stopped';transport();$('pan').value=channels[selected].pan;$('vol').value=channels[selected].volume;stopWorker();demoPlaying=false;refresh();generation++; channels.forEach(v=>v.held=null);port?.postMessage('stop');restoreEcho();}
window.addEventListener('blur',()=>{if(songState==='stopped')stop();else channels.forEach(v=>{if(v.held)release(v.held);});});
$('demo').onclick=()=>{stop();const token=generation;run(async()=>{await audio();if(token===generation){demoPlaying=true;port.postMessage($('score').value);}});};
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
  {path:'/examples/pad-loop.js',data:`setBpm(106);
liveLoop('pads', async () => {
  for (const voice of [1, 2, 1, 3]) {
    qsound.trigger(voice, voice - 1, (voice - 1) * 16);
    await beat(0.5);
  }
});
`},
]);
let activePath='/index.js';
const expanded=new Map([['/examples',true]]);
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
  getPath:()=>activePath,listFiles:()=>files.list().filter(f=>f.type==='text'),openFile:openScript,
  onEdit:()=>{files.writeText(activePath,source.value);scheduleDraft();},visible:()=>!$('code-panel').hidden,run:apply=>$(apply?'apply-code':'run-code').click(),
});
function selectPerformance(code) {
  $('code-panel').hidden=!code;
  $('keys').hidden=code;
  $('keyboard-tab').setAttribute('aria-pressed',String(!code));
  $('code-tab').setAttribute('aria-pressed',String(code));
  if(code)editor.load().then(()=>editor.layout());
}
$('keyboard-tab').onclick=()=>selectPerformance(false);
$('code-tab').onclick=()=>selectPerformance(true);
function stopWorker() {
  codeWorker?.terminate();
  codeWorker=null;
  $('apply-code').disabled=$('stop-code').disabled=true;
  $('code-status').textContent='';
}
$('run-code').onclick=()=>run(async()=>{
  stop();
  const token=generation;
  await audio();
  if(token!==generation)return;
  const worker=new Worker('./code-worker.js',{type:'module'});
  codeWorker=worker;
  $('stop-code').disabled=false;
  worker.onmessage=({data})=>{
    if(worker!==codeWorker)return;
    if(data.writes)port.postMessage(data.writes);
    if(data.status){$('code-status').textContent=data.status;$('apply-code').disabled=false;}
  };
  worker.onerror=e=>{if(worker===codeWorker){stop();$('code-status').textContent=e.message;}};
  worker.postMessage({source:source.value,path:activePath});
});
$('apply-code').onclick=()=>codeWorker?.postMessage({source:source.value,path:activePath,apply:true});
$('stop-code').onclick=stop;

function renderFiles() {
  const entries=files.list();
  const songs=entries.filter(file=>file.type==='binary').length;
  $('export-contents').textContent='Includes '+songs+' VGM/VGZ '+(songs===1?'file':'files')+' with embedded sample data.';
  renderFileTree($('project-tree'),entries,{expanded,selectedPath:songPath??activePath,onOpen:openScript});
}
function openScript(path,prepared) {
  const file=files.get(path);
  if (!file) return;
  if (file.type==='binary') {
    stop();songPath=path;
    preparedSong=null;$('song-loop').checked=false;
    transport();renderFiles();
    const token=++preparationRevision;
    Promise.resolve(prepared??prepareSong(file.data)).then(song=>{
      if(token!==preparationRevision || path!==songPath)return;
      preparedSong=song;transport();
    }).catch(error=>{if(token===preparationRevision && path===songPath)$('file-status').textContent=error.message;});
    return;
  }
  if(songPath){stop();songPath=null;preparedSong=null;transport();}
  activePath=path;
  editor.setSource(file.data,path);
  renderFiles();
  scheduleDraft();
}
function snapshot() {
  return {version:1,files:files.list(),active:activePath,song:songPath,channels:channels.map(({held,...settings})=>settings),
    pads:pads.map(p=>({...p})),mix:mixer.get(),selected,echo:{...echo}};
}
const factory=snapshot();
function replaceProject(project) {
  stop();
  songSelection++;songPath=null;preparedSong=null;transport();
  files.replace(project.files);
  project.channels.forEach((v,i)=>Object.assign(channels[i],v,{held:null}));
  project.pads.forEach((v,i)=>{
    Object.assign(pads[i],v);
    for (const [key,value] of Object.entries(v)) padControls[i][key].updateVisual(value);
  });
  mixer.set(project.mix);
  Object.assign(echo,project.echo);
  restoreEcho();
  select(project.selected);
  openScript(project.active);
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
  const songs=Object.values(demoTracks).map(track=>({
    path:'/songs/'+track.filename,type:'binary',data:demoVgm(track.score()),
  }));
  downloadCassette({...factory,files:[...factory.files,...songs]},'tetorica-cps2-demos.cassette.zip');
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
$('song-play').onclick=()=>run(async()=>{
  if(songState==='paused'){songState='playing';port.postMessage({type:'pause-song',paused:false});transport();return;}
  stop();
  const token=generation;
  if(!preparedSong)return;
  const {bytes}=preparedSong;
  await audio();
  if(token!==generation)return;
  songState='playing';port.postMessage({type:'song',bytes,loop:preparedSong.canLoop && $('song-loop').checked});transport();
});
$('song-pause').onclick=()=>{
  songState='paused';port.postMessage({type:'pause-song',paused:true});transport();
};
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
  sliding=false;
  if(songState==='stopped'){stop();songState='paused';}
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
      port.postMessage({type:'song',bytes:song.bytes,state,loop:$('song-loop').checked,paused:songState==='paused'},
        [state.chip.rom.buffer,state.chip.echoLine.buffer,state.starts.buffer]);
      cancelSeek();transport();
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
