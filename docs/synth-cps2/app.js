// SPDX-License-Identifier: BSD-3-Clause
import {installSpuFileContextMenu} from '../synth-spu/file_context_menu.js';
import {setupKeyboard} from './keyboard.js';
import {createPadWave} from './pad-wave.js';
import {createRomPages} from './rom-pages.js';
import {createRomMap} from './rom-map.js';
import {setupSynthMenu} from '../synth/synth_menu.js';
import {isPresetPath,bankHash,readPreset,presetRom,resolveRom} from './preset.js';
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
import {QSoundPcm,QSOUND_PCM_RATE,advanceAdpcm} from '../js/qsoundpcm.js';
import {createWaveEditor} from './wave_editor.js';
import {demoRom,demoVgm,noteWrites,demoTracks,pcmRate} from './demo.js';
import {isSamplePath,sampleLibrary,maxRom} from './samples.js';
import {drumPath,sampleDuet,padGroove,scheduledBar,filterGroove} from './sample-duet.js';
import {presetJamFiles} from './preset-jam.js';
import {bankLibrary,defaultRom,editSlot,factoryBanks,isBankPath,padFromPcm} from './banks.js';
import {catalogPath,catalogText,isCatalogPath,rangeKey,rangeName,readCatalog} from './range-presets.js';
import {zipSync} from '../playground/vendor/fflate.js';
const rangePresets=new Map();
let syncedBank=null,syncedRomRevision=-1,syncedRangeSignature=null;
let currentRanges=[],vgmRanges=[],rangeVersion=-1;
const stockBanks=factoryBanks();
let bankPath=defaultRom,bankSlots=Object.fromEntries(stockBanks.map(([path,b])=>[path,b.slots]));
let library=bankLibrary(stockBanks[0][1].rom,bankSlots[bankPath]),slot=0;

const itemFor=v=>library.items.get(v.samplePath);
const startFor=v=>itemFor(v)?.start??v.start??v.sample*256;
const bankFor=v=>itemFor(v)?.bank??v.bank??0;
function authoredNote(ch,midi,v){
  return noteWrites(ch,midi,v.sample,v.pan,v.volume,v.rate,v.end,v.loop,bankFor(v),startFor(v));
}
function installRom(){
  port?.postMessage({type:'project-rom',rom:library.rom});
}
const $ = id => document.getElementById(id);
setupSynthMenu({document,window});
const channels = Array.from({length:16},()=>({sample:0,send:0,pan:16,volume:8000,held:null,rate:pcmRate(60),referenceRate:null,referenceNote:60,note:60,end:256,loop:256}));
let autoChannel=true,nextAuto=0;
let autoVoice={...channels[0]};
const editedVoice=()=>autoChannel?autoVoice:channels[selected];
const keyboardOwnsTarget=()=>!autoChannel || Boolean(channels[selected].held);
let selected = 0, context, ready, port, masterGain, generation = 0;
let revision = 0, shown, cursor = null;
let codeWorker = null, liveInstrument=false, romPath=null;
let attached=null;
const pending=new Map(),pendingBanks=new Map();
function pendingBankPath(path){
  if(pendingBanks.has(path))return path;
  if(isCatalogPath(path))return [...pendingBanks.keys()].find(bank=>catalogPath(bank)===path);
}
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
  renderBankEditor();
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
  $('song-transport').hidden=false;
  $('song-loop').disabled=!preparedSong?.canLoop;
  $('song-select').value=songPath??'';
  $('song-status').textContent=seeking?'Seeking…':songState==='paused'?'Paused · audition':songState==='playing'?'Playing':liveInstrument?'Stopped · audition':'Ready';
  $('song-play').disabled=seeking || songState==='playing' || !preparedSong;
  $('song-play').textContent=songState==='paused'?'Resume':'Play VGM';
  $('song-pause').disabled=seeking || songState!=='playing';
  $('song-stop').disabled=false;
  $('save').disabled=!songPath;
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
const draw = createWaveEditor(edit,itemFor,()=>library.rom);
const pcmBank=createParamControl({label:'ROM bank',min:0,max:32767,step:1,value:0,onChange:value=>setPcmAddress('bank',value)});
const pcmStart=createParamControl({label:'Start',min:0,max:65535,step:1,value:0,onChange:value=>setPcmAddress('start',value)});
$('pcm-address').append(pcmBank.element,pcmStart.element);
function setPcmAddress(key,value){
  const v=editedVoice(),reg=key==='bank'?((selected+15)&15)*8:selected*8+1;
  const writes=[[reg,key==='bank'?value|0x8000:value]];
  if(autoChannel || !liveInstrument){
    v.bank=bankFor(v);v.start=startFor(v);v.samplePath=null;v[key]=value;
    refresh();
  }
  attached=null;if(keyboardOwnsTarget())port?.postMessage(writes);inspectChannel();
}
const echo = {delay:6,feedback:0};
const echoControls = {};
for (const [key,label,min,max] of [['send','Echo send · CH',-32768,32767],
  ['delay','Delay · shared',0,1024],['feedback','Feedback · shared',-32768,32767]]) {
  echoControls[key] = createParamControl({label,min,max,step:1,value:0,
    formatValue:key === 'delay' ? ticks=>ticks+' ticks · '+(ticks*1000/QSOUND_PCM_RATE).toFixed(2)+' ms' : String,
    onChange(value) {
      revision++;
      if (!liveInstrument || autoChannel) {
        if (key === 'send') editedVoice().send = value;
        else echo[key] = value;
      }
      if(key==='send')editPreset(false,key,value);
      if(key!=='send'||keyboardOwnsTarget())port?.postMessage(echoWrite(key,value,selected));
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
  shown = editedVoice();
  cursor = null;
  showEcho(shown.send,echo.delay,echo.feedback);
  pcmBank.updateVisual(bankFor(shown));pcmStart.updateVisual(startFor(shown));
  draw(shown);
}
function edit(key,value) {
  editPreset(false,key,value);
  if(liveInstrument && !autoChannel){
    if(key==='rate' && songState!=='playing')port?.postMessage({type:'voice-setting',channel:selected,field:'rate',value});
    else port?.postMessage([[selected*8+({rate:2,end:5,loop:4})[key],value]]);
    revision++;
    return;
  }
  const v = editedVoice();
  Object.assign(v,{sample:shown.sample,rate:shown.rate,end:shown.end,loop:shown.loop});
  v[key] = value;
  const writes = [[selected*8+({rate:2,end:5,loop:4})[key],value]];
  if (key === 'rate') {
    v.referenceRate = value;
    v.referenceNote = v.note;
  }
  if (key === 'end' && itemFor(v) && v.loop > value-startFor(v)) {
    v.loop = value-startFor(v);
    writes.push([selected*8+4,v.loop]);
  }
  if(keyboardOwnsTarget())port?.postMessage(writes);
  revision++;
  shown = v;
  draw(v,cursor);
}
const registerPanel=$('register-panel');
const drawRegisters=createRegisterTable($('register-rows'),$('register-position'));
function inspectChannel() {
  port?.postMessage({type:'inspect',channel:selected,revision,romMap:liveInstrument && !$('rom-chip').hidden,skipWave:$('pcm-chip').hidden,livePad:liveInstrument,padBankKey,padVoice:!$('adpcm-chip').hidden?padVoice:null,registers:!registerPanel.hidden});
}
function selectPcmTab(registers) {
  registerPanel.hidden=!registers;
  $('pcm-panel').hidden=registers;
  for(const tab of $('pcm-tabs').children){
    const active=(tab.id==='register-tab')===registers;
    tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
  }
  revision++;
  if(registers)drawRegisters(selected);
  inspectChannel();
}
$('pcm-tabs').onkeydown=e=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();
  const registers=e.key==='End'||(e.key!=='Home' && e.target.id==='pcm-tab');
  selectPcmTab(registers);$(registers?'register-tab':'pcm-tab').focus();
};
$('register-tab').onclick=()=>selectPcmTab(true);
$('pcm-tab').onclick=()=>selectPcmTab(false);
function inspect({data}) {
  if(data.type==='range-state'){
    if(liveInstrument && (!romPath||data.source===romPath)){
      currentRanges=data.current;rangeVersion=data.version;if(data.ranges)vgmRanges=data.ranges;
      if(romPath){
        try{syncPlayingBank(data);}catch(error){$('file-status').textContent=error.message;}
      }
      renderRanges();
    }
    return;
  }
  if(data.type==='rom-pages'){
    if(!$('rom-chip').hidden)romPages.draw(data);
    return;
  }
  if(data.fxError){$('code-status').textContent=data.fxError;return;}
  if(data.scheduleFailure){$('code-status').textContent=data.scheduleFailure;return;}
  if (data.revision !== revision || data.channel !== selected) return;
  if(data.romMap && liveInstrument && !seeking && !$('rom-chip').hidden)displayMap(data.romMap);
  if(!seeking && data.padVoice===padVoice && data.padState){
    const state=data.padState;
    if(state.active)padInspectUntil=performance.now()+200;
    if(liveInstrument){
      if(state.bytes){padBankBytes=state.bytes;padBankKey=state.key;}
      showPad(state);
    }
    drawPad(state.active?state.address:null,liveInstrument?state:undefined);
  }
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
    if(autoChannel){
      showEcho(autoVoice.send,data.delay,data.feedback);
      if(registerPanel.hidden)draw(autoVoice);return;
    }
    pcmBank.updateVisual(data.view.bank);pcmStart.updateVisual(data.view.start);
    $('pan').value=Math.min(32,Math.max(0,data.view.pan-0x110));
    $('vol').value=data.view.volume;
    showEcho(data.send,data.delay,data.feedback);
    if(!registerPanel.hidden || !data.view.wave)return;
    draw({sample:0,rate:data.rate,end:data.end&65535,loop:data.loop&65535},data.active?data.address:null,data.view);
    return;
  }
  shown=editedVoice();
  pcmBank.updateVisual(bankFor(shown));pcmStart.updateVisual(startFor(shown));
  showEcho(shown.send,echo.delay,echo.feedback);
  cursor = data.active ? data.address : null;
  if(registerPanel.hidden)draw(shown,cursor);
}
let lastInspect=0;
setInterval(()=>{
  if(!port || document.hidden)return;
  const moving=(!$('adpcm-chip').hidden && performance.now()<padInspectUntil) || songState==='playing' || codeWorker || channels[selected].held || cursor!==null;
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
    port = node.port; port.onmessage = inspect; applyMix(mixer.get()); installRom();restoreEcho();
  }).catch(error=>{ready=null;throw error;});
  await ready;
}
const status = $('status');
function run(task) {task().catch(e=>{status.textContent=e.message;});}
function select(channel,auto=false) {
  autoChannel=auto;
  selected = channel;
  if(!registerPanel.hidden)drawRegisters(selected);
  [...$('channels').children].forEach((b,i)=>{
    b.setAttribute('aria-pressed',auto ? i===0 : i===channel+1);
    b.classList.toggle('auto-target',auto && i===channel+1);
  });
  const v = editedVoice();
  $('pan').value=v.pan; $('vol').value=v.volume;
  if(!liveInstrument || autoChannel)refresh();
  if(liveInstrument || !registerPanel.hidden){revision++;inspectChannel();}
}
const autoButton=document.createElement('button');
autoButton.textContent='AUTO';
autoButton.title='Edit the AUTO voice. Each note uses the next available PCM channel; the outline shows the destination.';
autoButton.onclick=()=>{if(!autoChannel)nextAuto=selected;select(selected,true);};
$('channels').append(autoButton);
for(let i=0;i<16;i++) {
  const button=document.createElement('button');
  button.textContent='CH'+(i+1); button.onclick=()=>select(i); $('channels').append(button);
}
select(0,true);
$('pan').oninput=()=>{
  const value=Number($('pan').value);editPreset(false,'pan',0x110+value);
  if(autoChannel || !liveInstrument)editedVoice().pan=value;
  if(keyboardOwnsTarget())port?.postMessage([[0x80+selected,0x110+value]]);
};
$('vol').oninput=()=>{
  const volume=Number($('vol').value);editPreset(false,'volume',volume);
  if(autoChannel || !liveInstrument)editedVoice().volume=volume;
  if(!keyboardOwnsTarget())return;
  if(!autoChannel && liveInstrument && songState!=='playing')port?.postMessage({type:'voice-setting',channel:selected,field:'volume',value:volume});
  else if(channels[selected].held || liveInstrument)port?.postMessage([[selected*8+6,volume&65535]]);
};
function press(id,midi) {
  if(seeking)return;
  let ch=selected;
  if(autoChannel){
    ch=nextAuto;
    while(channels[ch].held){
      ch=(ch+1)%channels.length;
      if(ch===nextAuto)return;
    }
    nextAuto=(ch+1)%channels.length;
    select(ch,true);
  }
  const physical=channels[ch];physical.held=id;
  if(liveInstrument && !autoChannel){
    port?.postMessage({type:'captured-note',channel:ch,midi});return;
  }
  const v=autoChannel?{...autoVoice}:physical;
  v.note=midi;
  v.rate=v.referenceRate===null?Math.min(65535,pcmRate(midi)):
    Math.min(65535,Math.round(v.referenceRate*2**((midi-v.referenceNote)/12)));
  const writes=[[0xba+ch,v.send&65535],...authoredNote(ch,midi,v)];
  refresh();
  run(async()=>{await audio();if(physical.held===id)port.postMessage(writes);});
}
function release(id) {
  channels.forEach((v,ch)=>{if(v.held===id){v.held=null;port?.postMessage(liveInstrument?{type:'captured-off',channel:ch}:[[ch*8+6,0]]);}});
}
const pads=Array.from({length:3},(_,i)=>({sample:i,start:(i+1)*512,end:(i+2)*512,bank:0,pan:16*i,volume:32767}));
const factoryBank=demoRom();
const paintPad=createPadWave($('pad-wave'),$('pad-caption'),$('pad-cursor'));
let padBankBytes,padBankKey,padInspectUntil=0,manualPadRom,manualPadBank,manualPadBytes;
function drawPad(address=null,state){
  const pad=state??pads[padVoice];
  if(!state && (manualPadRom!==library.rom || manualPadBank!==pad.bank)){
    manualPadRom=library.rom;manualPadBank=pad.bank;
    manualPadBytes=library.rom.subarray(pad.bank*65536,(pad.bank+1)*65536);
  }
  paintPad(pad,state?padBankBytes:manualPadBytes,state?.tickRate??QSOUND_PCM_RATE,address);
}
let padVoice=0;
const padControls={};
const padHex=n=>'0x'+n.toString(16).toUpperCase().padStart(4,'0');
const padFields=['start','end','bank','volume'];
function showPad(state){
  const live=state?.panWord!==undefined;
  const pad=state??pads[padVoice];
  padControls.sample.updateRange(pads[padVoice].samplePath?-1:0,2);
  for(const key of padFields)padControls[key].updateVisual(pad[key]);
  padControls.panWord.updateVisual(live?pad.panWord:0x110+pad.pan);
  padControls.sample.updateVisual(pads[padVoice].samplePath?-1:pads[padVoice].sample);
  if(!live)drawPad();
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
  run(async()=>{await audio();if(token===generation){
    padInspectUntil=performance.now()+200;
    port.postMessage(writes);inspectChannel();
  }});
}
for(let i=0;i<3;i++){
  const b=document.createElement('button');
  b.textContent='Voice '+(i+1);
  b.setAttribute('aria-pressed',String(i===0));
  b.onclick=()=>{
    padVoice=i;revision++;
    for(const item of $('adpcm-voices').children)item.setAttribute('aria-pressed',String(item===b));
    if(liveInstrument)inspectChannel();else showPad();
    renderPresetInfo();
  };
  $('adpcm-voices').append(b);
}
for(const [key,label,min,max] of [['sample','Sample',0,2],['start','Start',0,65535],['end','End (exclusive)',0,65535],
  ['bank','ROM bank',0,32767],['volume','Volume',-32768,32767],['panWord','Pan register',0x110,0x130]]){
  const control=createParamControl({label,min,max,step:1,value:min,formatValue:key==='sample'?n=>n===-1?(pads[padVoice].samplePath??'WAV').split('/').pop():'Pulse '+(n+1):key==='volume'?String:padHex,
    onChange(value){
      revision++;
      editPreset(true,key==='panWord'?'pan':key,value);
      const pad=pads[padVoice];
      if(!liveInstrument){
        if(key==='sample'){
          if(value<0)return;
          Object.assign(pad,{samplePath:null,sample:value,start:(value+1)*512,end:(value+2)*512,bank:0});showPad();return;
        }
        if(key==='panWord')pad.pan=value-0x110;
        else pad[key]=value;
        drawPad();
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
const setPadKeyboard=setupKeyboard({press,release,triggerPad:voice=>triggerPad(voice-1)});
function stop(keepInstrument=true){
  liveInstrument=Boolean(keepInstrument && liveInstrument);
  if(!liveInstrument){attached=null;romPath=null;vgmRanges=[];currentRanges=[];rangeVersion=-1;syncedBank=null;syncedRomRevision=-1;syncedRangeSignature=null;}
  cancelSeek();sliding=false;songState='stopped';
  stopWorker();
  generation++;
  channels.forEach(v=>v.held=null);
  $('pan').value=editedVoice().pan;
  $('vol').value=editedVoice().volume;
  transport();refresh();
  port?.postMessage(liveInstrument?'stop-audition':'stop');
  if(!liveInstrument){restoreEcho();showRomMap();}
  if(liveInstrument)inspectChannel();
  renderPresetInfo();
}
let replacingWav=null;
window.addEventListener('blur',()=>{if(songState==='stopped' && !replacingWav)stop();else channels.forEach(v=>{if(v.held)release(v.held);});});
$('restore-instrument').onclick=()=>stop(false);
$('save').onclick=()=>{
  const file=files.get(songPath);
  if(!file || file.type!=='binary')return;
  const url=URL.createObjectURL(new Blob([file.data],{type:'application/octet-stream'}));
  const link=document.createElement('a');link.href=url;link.download=songPath.split('/').pop();link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};

const source = $('source');
const files = createVirtualFileSystem([
  {path:'/index.js',data:source.value},
  ...presetJamFiles,
  ...stockBanks.flatMap(([path,b])=>[{path,data:b.rom},{path:catalogPath(path),data:catalogText(b.slots,[])}]),
  {path:'/examples/sample-duet.js',data:sampleDuet},
  {path:'/examples/pad-groove.js',data:padGroove},
  {path:'/examples/scheduled-bar.js',data:scheduledBar},
  {path:'/examples/filter-groove.js',data:filterGroove},
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
rebuildSamples();
setPcmSample(channels[0],drumPath);
channels[0].loop=1;autoVoice={...channels[0]};
setPadSample(pads[0],drumPath);
refresh();showPad();
$('add-demos').onclick=()=>run(async()=>{
  const additions=presetJamFiles.filter(file=>!files.has(file.path));
  for(const track of Object.values(demoTracks)){
    const bytes=demoVgm(track.score());
    let path='/songs/'+track.filename,n=1;
    while(files.has(path)){
      const existing=files.get(path).data;
      if(existing.length===bytes.length && bytes.every((v,i)=>v===existing[i]))break;
      path='/songs/'+track.filename.replace('.vgm','-'+(++n)+'.vgm');
    }
    if(!files.has(path))additions.push({path,data:bytes});
  }
  if(!files.has('/examples/sample-duet.js'))additions.push({path:'/examples/sample-duet.js',data:sampleDuet});
  if(!files.has('/examples/pad-groove.js'))additions.push({path:'/examples/pad-groove.js',data:padGroove});
  if(!files.has('/examples/scheduled-bar.js'))additions.push({path:'/examples/scheduled-bar.js',data:scheduledBar});
  if(!files.has('/examples/filter-groove.js'))additions.push({path:'/examples/filter-groove.js',data:filterGroove});
  for(const [path,b] of stockBanks)if(!files.has(path)){
    additions.push({path,data:b.rom},{path:catalogPath(path),data:catalogText(b.slots,[])});bankSlots[path]=b.slots;
  }
  files.writeFiles(additions);
  if(!songPath)selectDefaultSong();
  setFiles(true);renderFiles();scheduleDraft();
  $('file-status').textContent=additions.length?'Added '+additions.length+' demo files.':'Demo files already present.';
});
let activePath='/index.js', highlightedPath=activePath;
const expanded=new Map([['/examples',true],['/songs',true],['/presets',true],['/banks',true]]);
const editor = setupSynthMonacoEditor({
  textarea:source,editorHost:$('code-host'),editorNote:$('editor-note'),chip:'cps2',
  declarationsOnly:true,transformDeclarations:()=>`
/** AudioWorklet sample rate inside a liveFx process callback. */
declare const sampleRate:number;
interface LiveFxOptions<T extends object> {
  context?:T; resetState?:boolean;
  process(input:Float32Array[],output:Float32Array[],state:Record<string,any>,context:T):void;
}
declare function liveFx<T extends object>(name:string,options:LiveFxOptions<T>):void;
declare const fx:{liveFx:typeof liveFx;updateContext(name:string,values:object):void;removeLiveFx(name:string):void};
declare function liveLoop(name:string, play:()=>Promise<void>):void;
declare function beat(beats?:number):Promise<void>;
declare function setBpm(bpm:number):void;
declare function sleep(seconds:number):Promise<void>;
declare function stopLoop(name:string):void;
interface QSoundWrite {offsetSeconds:number;register:number;value:number}
interface QSoundPlan {chip:'qsound';version:1;referenceSampleRate:number;writes:QSoundWrite[]}
interface QSoundBuilder {
  atSeconds(seconds:number):this; atSample(offset:number):this; writeRegister(register:number,value:number):this;
  noteOn(channel:number,midi:number,sample:number|string,pan?:number,volume?:number):this;
  noteOff(channel:number):this; trigger(voice:number):this;
}
declare const qsound:{
  build(record:(b:QSoundBuilder)=>void,options?:{referenceSampleRate?:number}):QSoundPlan;
  compile(plan:QSoundPlan):Promise<QSoundWrite[]>;
  schedule(plan:QSoundPlan,options:{name:string;repeatSeconds?:number}):Promise<unknown>;
  clearSchedule(name:string):Promise<unknown>;
  /** Load a PCM channel or ADPCM voice preset. Name the destination ROM explicitly to switch all voices. */
  loadPreset(target:number,path:string,options?:{switchRom?:string|null}):Promise<void>;
  /** Assign a WAV from Files. Offset, length and loop are measured in ROM bytes. */
  /** Prepare a project WAV for a one-shot. Await before calling trigger(voice). */
  assignPad(voice:number,path:string):Promise<void>;
  assignSample(channel:number,path:string,options?:{offset?:number,length?:number,loop?:number}):void;
  writeRegister(register:number,value:number):void;
  noteOn(channel:number,midi:number,sample?:number,pan?:number,volume?:number):void;
  noteOff(channel:number):void;
  trigger(voice:number,sample?:number,pan?:number,volume?:number):void;
};
declare function useSoundChip(name:'qsound'):Promise<typeof qsound>;`,
  getPath:()=>activePath,listFiles:()=>files.list().filter(f=>f.type==='text' && f.path.endsWith('.js')),openFile:openScript,
  onEdit:()=>editFile(activePath,source.value),visible:()=>!$('code-panel').hidden,run:apply=>$(apply?'apply-code':'run-code').click(),
});
let codeMode=false, chipView='pcm-chip', mainView='code-panel', lowerView='keyboard';
const chipTabs=[...document.querySelectorAll('[data-chip]')];
const performanceTabs=[...document.querySelectorAll('[data-performance]')];
function drawWorkspace(){
  setPadKeyboard(chipView==='adpcm-chip');
  const chip=codeMode?mainView:chipView, performance=codeMode?mainView:lowerView;
  for(const tab of chipTabs){
    const active=tab.dataset.chip===chip;
    $(tab.dataset.chip).hidden=!active;
    tab.setAttribute('aria-pressed',String(active));
  }
  for(const tab of performanceTabs){
    const active=tab.dataset.performance===performance;
    $(tab.dataset.performance).hidden=!active;
    tab.setAttribute('aria-pressed',String(active));
  }
  revision++;showRomMap();renderPresetInfo();renderBankEditor();
  if(!$('code-panel').hidden)editor.load().then(()=>editor.layout());
}
function selectPerformance(code) {
  codeMode=code;
  const [keyboard,script]=performanceTabs;
  if(code){
    mainView='code-panel';
    $('chip-tabs').prepend(script);
    $('chip-tabs').append(keyboard);
    setFiles(true);
  }else{
    $('performance-tabs').append(keyboard,script);
  }
  $('performance-tabs').hidden=code;
  $('keyboard-tab').setAttribute('aria-pressed',String(!code));
  $('code-tab').setAttribute('aria-pressed',String(code));
  drawWorkspace();
}
for(const tab of performanceTabs)tab.onclick=()=>{
  if(codeMode)mainView=tab.dataset.performance;
  else lowerView=tab.dataset.performance;
  drawWorkspace();
};
function setFiles(visible){
  $('files').hidden=!visible;
  $('workspace').classList.toggle('files-hidden',!visible);
  $('files-toggle').setAttribute('aria-pressed',String(visible));
  if(!$('code-panel').hidden)editor.layout();
}
$('files-toggle').onclick=()=>setFiles($('files').hidden);
const drawRomMap=createRomMap((address,adpcm)=>romPages.selectPage(address>>>8,adpcm));
const romPages=createRomPages((bank,page)=>{
  if(port){
    port.postMessage({type:'rom-pages',bank,page});

  }
  else{
    const offset=(bank*256+page)*256;
    romPages.draw({bank,page,size:library.rom.length,bytes:library.rom.slice(offset,offset+256)});
  }
});
$('bank-inspector').ontoggle=()=>{if($('bank-inspector').open)romPages.refresh();};
setInterval(()=>{
  if(!port || document.hidden && !romPath)return;
  const romVisible=!$('rom-chip').hidden;
  if(romVisible && $('bank-inspector').open)romPages.refresh();
  if((liveInstrument && romVisible) || romPath)
    port.postMessage({type:'range-state',known:rangeVersion,knownRom:syncedRomRevision});
},250);
function showRomMap(){
  if($('rom-chip').hidden)return;
  if(liveInstrument){inspectChannel();return;}
  const voices=channels.map((v,id)=>({id,bank:bankFor(v),start:startFor(v),end:v.end,loop:v.loop}));
  pads.forEach((v,i)=>voices.push({id:16+i,bank:v.bank,start:v.start,end:v.end,loop:0}));
  displayMap({size:library.rom.length,voices});
}
function displayMap(map){
  drawRomMap(map,romPath??bankPath);
  if(!port)romPages.refresh();
}
for(const tab of chipTabs)tab.onclick=()=>{
  chipView=tab.dataset.chip;
  mainView=chipView;
  drawWorkspace();
};
$('keyboard-tab').onclick=()=>selectPerformance(false);
$('code-tab').onclick=()=>selectPerformance(true);
function codeSamples(){
  if(romPath)return null;
  return [...library.items].map(([path,{bank,start,length,rate}])=>[path,{bank,start,length,rate}]);
}
function stopWorker() {
  if(codeWorker){
    port?.postMessage({type:'clear-timeline'});
    port?.postMessage({type:'clear-code-fx'});
  }
  codeWorker?.terminate();
  codeWorker=null;
  $('apply-code').disabled=$('stop-code').disabled=true;
  $('code-status').textContent='';
}
function prepareSynthAudition(){
  const settings=channels.flatMap((v,ch)=>authoredNote(ch,v.note,v));
  port.postMessage({type:'prepare-audition',writes:[...settings,...pads.flatMap((_,i)=>padWrites(i))]});
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
  if(!liveInstrument)prepareSynthAudition();
  codeWorker=worker;liveInstrument=true;transport();
  $('stop-code').disabled=false;
  worker.onmessage=({data})=>{
    if(worker!==codeWorker)return;
    if(data.codeFx){port.postMessage({codeFx:data.codeFx});return;}
    if(data.timedRequest){port.postMessage(data,[data.reply]);return;}
    if(data.loadPreset){
      const {target,path,options,reply}=data.loadPreset;
      applyPresetFile(path,target,options,()=>worker===codeWorker).then(
        ()=>reply.postMessage({samples:codeSamples()}),
        error=>reply.postMessage({error:error.message})
      ).finally(()=>reply.close());
      return;
    }
    if(data.assignPad){
      const {voice,path,reply}=data.assignPad;
      try{
        if(romPath)throw Error('Choose Use synth instruments to play WAVs from the project ROM.');
        const pad=ensurePadSample(path),base=0xca+4*(voice-1);
        port.postMessage([[base,pad.start],[base+1,pad.start+pad.length],[base+2,pad.bank]]);
        reply.postMessage({});
      }catch(error){reply.postMessage({error:error.message});}
      finally{reply.close();}
    }
    if(data.audition)port.postMessage(data.audition);
    if(data.writes)port.postMessage(data.writes);
    if(data.status){$('code-status').textContent=data.status;$('apply-code').disabled=false;}
  };
  worker.onerror=e=>{if(worker===codeWorker){stop();$('code-status').textContent=e.message;}};
  worker.postMessage({source:files.get(activePath).data,path:activePath,captured:liveInstrument,samples:codeSamples()});
});
$('apply-code').onclick=()=>codeWorker?.postMessage({source:files.get(activePath).data,path:activePath,apply:true,samples:codeSamples()});
$('stop-code').onclick=stop;

function renderFiles() {
  renderBankEditor();
  const entries=files.list();
  for(const [path,pair] of pendingBanks){
    if(!files.has(path))entries.push({path,type:'binary',data:pair.rom},{path:catalogPath(path),type:'text',data:pair.json});
  }
  const tracks=entries.filter(file=>/\.vg[mz]$/i.test(file.path));
  const songs=tracks.length, picker=$('song-select');
  picker.replaceChildren(...tracks.map(({path})=>new Option(path.split('/').pop(),path)));
  picker.value=songPath??'';
  picker.disabled=!songs;
  $('export-contents').textContent='Includes '+songs+' VGM/VGZ '+(songs===1?'file':'files')+' with embedded sample data.';
  renderFileTree($('project-tree'),entries,{expanded,selectedPath:highlightedPath,onOpen:openScript});
  for(const row of $('project-tree').querySelectorAll('button[data-file-path]')){
    const path=row.dataset.filePath;
    if(pending.has(path)||pendingBankPath(path))row.append(' *');
    if(isPresetPath(path))row.title=path+' · ROM: '+(readPreset(files.get(path).data).source?.path??'factory');
  }
  renderPresetInfo();
}
function renderPresetInfo(){
  const f=isPresetPath(highlightedPath)?files.get(highlightedPath):null;
  const preset=f?readPreset(f.data):null;
  $('apply-preset').hidden=!preset;
  $('apply-preset').textContent='Apply preset';
  $('save-files').hidden=$('auto-apply').checked;
  $('save-files').disabled=!pending.size&&!pendingBanks.size;
  const target=preset?.source?.path??null;
  $('preset-info').textContent=preset
    ? (target!==romPath?'Switch shared ROM (all voices): '+(romPath??'factory')+' → ':'Shared ROM: ')+(target??'factory')+' · Bank '+preset.bank
    : 'Shared ROM: '+(romPath??bankPath);
}
$('song-select').onchange=event=>openScript(event.target.value);
function openScript(path,prepared) {
  if(pendingBankPath(path)){
    $('file-status').textContent='Choose Save files to use this ROM and its presets.';
    return;
  }
  const file=files.get(path);
  if (!file) return;
  highlightedPath=path;
  if(isCatalogPath(path)){
    const rom=Object.keys(bankSlots).find(p=>catalogPath(p)===path);if(rom)openScript(rom);return;
  }
  if(isBankPath(path)){
    selectBank(path);document.querySelector('[data-chip="rom-chip"]').click();return;
  }
  if(isPresetPath(path)){
    renderFiles();
    if($('auto-apply').checked && (readPreset(file.data).source?.path??null)===romPath)run(()=>loadPreset(path,file.data,false));
    return;
  }
  if (file.type==='binary') {
    if(path===songPath && preparedSong && !prepared){renderFiles();return;}
    stop(false);songPath=path;
    preparedSong=null;$('song-loop').checked=false;
    transport();renderFiles();
    const token=++preparationRevision;
    Promise.resolve(prepared??prepareSong(file.data)).then(song=>{
      if(token!==preparationRevision || path!==songPath)return;
      preparedSong=song;transport();scheduleDraft();
    }).catch(error=>{if(token===preparationRevision && path===songPath)$('file-status').textContent=error.message;});
    return;
  }
  if(codeMode || lowerView!=='code-panel')selectPerformance(true);
  activePath=path;
  editor.setSource(pending.get(path)??file.data,path);
  renderFiles();
  scheduleDraft();
}
async function savePreset(kind){
  const adpcm=kind==='adpcm',ch=adpcm?padVoice:selected,token=generation;
  let voice;
  if(liveInstrument){
    const {port1,port2}=new MessageChannel();
    const result=new Promise(resolve=>{port1.onmessage=e=>{port1.close();resolve(e.data);};});
    port.postMessage({type:'read-preset',kind,channel:ch,reply:port2},[port2]);
    voice=await result;
  }else if(adpcm){
    const v=pads[ch];
    voice={source:null,clock:4000000,bytes:library.rom.subarray(v.bank*65536,(v.bank+1)*65536),bank:v.bank,start:v.start,end:v.end,
      pan:0x110+v.pan,volume:v.volume};
  }else{
    const v=channels[ch];
    const rate=v.referenceRate===null?pcmRate(60):Math.min(65535,Math.round(v.referenceRate*2**((60-v.referenceNote)/12)));
    voice={source:null,clock:4000000,bytes:library.rom.subarray((bankFor(v))*65536,((bankFor(v))+1)*65536),bank:bankFor(v),start:startFor(v),end:v.end,loop:v.loop,
      rate,pan:0x110+v.pan,volume:v.volume,send:v.send};
  }
  let {bytes,...settings}=voice;
  if(!settings.source){
      const item=library.regions.find(i=>i.bank===settings.bank && i.start<=settings.start && settings.start<i.start+i.length);
      settings.projectRange=item?[item.start,item.start+item.length]:[0,bytes.length];
      bytes=bytes.subarray(...settings.projectRange);
  }
  if(!bytes.length)throw Error('This channel has no sample ROM in its bank.');
  const preset={format:'qsound-'+kind+'-1',...settings,bankHash:await bankHash(bytes)};
  if(generation!==token)return;
  const name=prompt(kind.toUpperCase()+' preset name',(adpcm?'Voice ':'CH')+(ch+1))?.trim();
  if(!name)return;
  const path=checkPath('/presets/'+name.replace(/\.(adpcm|pcm)\.json$/i,'')+'.'+kind+'.json');
  if(!isPresetPath(path))throw Error('Enter a file name without folders.');
  if(files.has(path) && !confirm('Replace '+path+'?'))return;
  const text=JSON.stringify(preset,null,2);
  readPreset(text);
  files.writeText(path,text);
  pending.delete(path);attached={path,adpcm,ch};highlightedPath=path;setFiles(true);renderFiles();await saveDraft();
  $('file-status').textContent='Saved '+path;
}
$('save-pad-preset').onclick=()=>run(()=>savePreset('adpcm'));

let presetQueue=Promise.resolve();
function applyPresetFile(path,target,options,current){
  const token=generation;
  function check(){
    if(generation!==token || seeking || !current())throw Error('Preset load superseded.');
  }
  async function apply(){
    check();
    if(!isPresetPath(path) || !files.has(path))throw Error('Missing preset: '+path);
    const p=readPreset(files.get(path).data),adpcm=p.format==='qsound-adpcm-1';
    if(!Number.isInteger(target)||target<1||target>(adpcm?3:16))throw Error(adpcm?'Choose Voice 1–3.':'Choose CH1–16.');
    const destination=p.source?.path??null;
    const mismatch=()=>Error('Preset needs shared ROM '+(destination??'project')+
      ' for all voices. Use Apply preset in Files or pass {switchRom: '+JSON.stringify(destination)+'}.');
    const explicit=Object.hasOwn(options,'switchRom');
    if(explicit && options.switchRom!==destination)throw mismatch();
    if(!explicit && destination!==romPath)throw mismatch();
    if(p.source && !files.has(destination))throw Error('Missing preset source '+destination);
    await audio();check();
    let same=false;
    if(destination===romPath){
      if(songState==='playing')pauseSong();
      const [first,last]=p.projectRange??[0,!p.source && p.bank===0?factoryBank.length:65536];
      const {port1,port2}=new MessageChannel();
      const snapshot=new Promise(resolve=>port1.onmessage=e=>{port1.close();resolve(e.data);});
      port.postMessage({type:'preset-bank',bank:p.bank,first,last,reply:port2},[port2]);
      const {bytes,clock}=await snapshot;
      same=clock===p.clock && bytes.length>0 && await bankHash(bytes)===p.bankHash;
      check();
    }
    let rom,song;
    if(!same){
      if(!explicit)throw mismatch();
      song=p.source?await prepareSong(files.get(destination).data):null;
      rom=await presetRom(p,song?.bytes,library.rom);
      if(!p.source)rom=library.rom.slice();
      check();
    }
    if(songState==='playing')pauseSong();
    if(!liveInstrument)prepareSynthAudition();
    liveInstrument=true;
    port.postMessage({type:'load-preset',channel:target-1,preset:p,rom},rom?[rom.buffer]:[]);
    if(rom){
      channels.forEach(v=>v.held=null);romPath=destination;
      songPath=destination;preparedSong=song;preparationRevision++;songState='stopped';showPosition(0);
      codeWorker?.postMessage({samples:codeSamples()});
    }
    attached=null;revision++;transport();inspectChannel();renderPresetInfo();
    $('file-status').textContent='Loaded '+path+' on '+(adpcm?'Voice ':'CH')+target+' · Shared ROM: '+(destination??'project');
  }
  const result=presetQueue.then(apply);
  presetQueue=result.catch(()=>{});
  return result;
}
async function loadPreset(path,text,explicit=true){
  const p=readPreset(text),adpcm=p.format==='qsound-adpcm-1',ch=adpcm?padVoice:selected;
  const current=()=>path===highlightedPath && ch===(adpcm?padVoice:selected);
  await applyPresetFile(path,ch+1,explicit?{switchRom:p.source?.path??null}:{},current);
  if(autoChannel && !adpcm){
    autoVoice={sample:0,samplePath:null,bank:p.bank,start:p.start,end:p.end,loop:p.loop,send:p.send,
      pan:p.pan-0x110,volume:p.volume,note:60,rate:p.rate,referenceNote:60,referenceRate:p.rate,held:null};
    select(ch,true);
  }
  attached={path,adpcm,ch};selectPerformance(false);
  document.querySelector(adpcm?'[data-chip="adpcm-chip"]':'[data-chip="pcm-chip"]').click();
  if(!adpcm)selectPcmTab(false);
  scheduleDraft();
}
let bankEdit=0;
function editPreset(adpcm,key,value){
  const link=attached;
  if(!link || link.adpcm!==adpcm || link.ch!==(adpcm?padVoice:selected))return;
  const current=()=>readPreset(pending.get(link.path)??files.get(link.path).data);
  if(key==='bank'){
    const token=++bankEdit;
    run(async()=>{
      const p=current(),song=p.source?await prepareSong(files.get(p.source.path).data):null;
      const rom=p.source?resolveRom(p.source,song?.bytes).rom:library.rom,bank=rom.subarray(value*65536,(value+1)*65536);
      if(!bank.length)throw Error('The selected bank has no ROM data.');
      const projectRange=!p.source && value>0?[0,bank.length]:undefined;
      const hash=await bankHash(!p.source && !value?bank.subarray(0,factoryBank.length):bank);
      if(token===bankEdit && attached===link)
        editFile(link.path,JSON.stringify({...current(),bank:value,projectRange,bankHash:hash},null,2));
    });
  }else if(key!=='sample'){
    editFile(link.path,JSON.stringify({...current(),[key]:value},null,2));
  }else attached=null;
}
function selectDefaultSong(){
  const first='/songs/'+demoTracks.demo.filename;
  const path=files.has(first)?first:files.list().find(f=>/\.vg[mz]$/i.test(f.path))?.path;
  if(path)openScript(path);
}
function editFile(path,text){
  const wasDirty=pending.has(path);
  if($('auto-apply').checked)files.writeText(path,text);
  else if(files.get(path).data===text)pending.delete(path);
  else pending.set(path,text);
  if(wasDirty!==pending.has(path))renderFiles();
  scheduleDraft();
}
function saveFiles(){
  const entries=[...pending].map(([path,data])=>({path,data}));
  for(const [path,pair] of pendingBanks){
    if(pair.rom)entries.push({path,data:pair.rom});
    entries.push({path:catalogPath(path),data:pair.json});
  }
  files.writeFiles(entries);
  for(const [path,pair] of pendingBanks){
    const catalog=readCatalog(pair.json);
    bankSlots[path]=catalog.slots;rangePresets.set(path,catalog.presets);
  }
  pendingBanks.clear();
  pending.clear();renderFiles();scheduleDraft();
}
$('auto-apply').onchange=()=>{if($('auto-apply').checked)saveFiles();else renderFiles();scheduleDraft();};
$('save-files').onclick=saveFiles;
$('apply-preset').onclick=()=>{
  run(()=>loadPreset(highlightedPath,files.get(highlightedPath).data));
};
function presetReferences(path){
  const regions=library.regions.filter(i=>i.path===path);
  return files.list().filter(f=>{
    if(!isPresetPath(f.path))return false;
    const p=readPreset(f.data);
    return p.source?.path===path || regions.some(item=>p.bank===item.bank && p.projectRange &&
      item.start<p.projectRange[1] && item.start+item.length>p.projectRange[0]);
  });
}
function renameSource(text,from,to){
  const p=readPreset(text);
  if(p.source?.path===from)p.source.path=to;
  return JSON.stringify(p,null,2);
}
function fileActions(path){
  if(pendingBankPath(path))return [{id:'open',label:'View pending ROM'}];
  if(isCatalogPath(path))return [{id:'open',label:'Open ROM presets'}];
  if(path==='/banks')return [{id:'new-rom',label:'New ROM…'},{id:'import-rom',label:'Import ROM…'}];
  if(!files.has(path))return [{id:'new',label:'New JavaScript file…'}];
  if(isBankPath(path))return [{id:'open',label:'Load ROM'},{id:'new-rom',label:'New ROM…'},{id:'duplicate',label:'Duplicate'},{id:'rename',label:'Rename…'},{id:'delete',label:'Delete',disabled:path===bankPath}];
  return [{id:'open',label:isPresetPath(path)?'Apply preset':'Open'},
    {id:'duplicate',label:'Duplicate'},{id:'rename',label:'Rename…',disabled:path==='/index.js'},
    {id:'delete',label:'Delete',disabled:path==='/index.js' || presetReferences(path).length>0 || (isSamplePath(path) && [...channels,...pads].some(v=>v.samplePath===path))}];
}
function fileAction(action,path){
  if(action==='new-rom'||action==='import-rom'){$(action).click();return;}
  if(action==='new'){$('new-script').click();return;}
  const file=files.get(path);
  if(!file)return;
  if(action==='open'){
    if(isPresetPath(path))return loadPreset(path,file.data);
    openScript(path);return;
  }
  if(action==='delete'){
    if(!confirm('Delete '+path+'?'))return;
    files.delete(path);pending.delete(path);
    if(isBankPath(path)){files.delete(catalogPath(path));rangePresets.delete(path);delete bankSlots[path];}
    if(attached?.path===path)attached=null;
    if(path===songPath){stop(false);songPath=null;preparedSong=null;transport();selectDefaultSong();}
    if(path===activePath)openScript('/index.js');
    highlightedPath=activePath;
  }else{
    const leaf=path.split('/').pop(),ext=leaf.match(/(?:\.(?:adpcm|pcm)\.json|\.[^.]+)$/i)[0];
    const parent=path.slice(0,-leaf.length);
    let dest;
    if(action==='duplicate'){
      const stem=leaf.slice(0,-ext.length);
      let n=1;do{dest=parent+stem+' copy'+(n===1?'':' '+n)+ext;n++;}while(files.has(dest)||(isBankPath(path)&&(files.has(catalogPath(dest))||pendingBankPath(catalogPath(dest)))));
    }else{
      const name=prompt('Rename file',leaf)?.trim();
      if(!name || name===leaf)return;
      if(name.includes('/'))throw Error('Enter a file name without folders.');
      dest=checkPath(parent+name+(name.toLowerCase().endsWith(ext.toLowerCase())?'':ext));
      if(files.has(dest))throw Error('A file with that name already exists.');
    }
    const entries=[{path:dest,data:file.data}];
    if(action==='rename' && /\.vg[mz]$/i.test(path)){
      for(const f of presetReferences(path))entries.push({path:f.path,data:renameSource(f.data,path,dest)});
    }
    if(isBankPath(path)){
      if(!isBankPath(dest)||files.has(catalogPath(dest))||pendingBankPath(catalogPath(dest)))throw Error('Choose an unused ROM and catalog name.');
      entries.push({path:catalogPath(dest),data:catalogText(bankSlots[path],rangePresets.get(path)??[])});
    }
    files.writeFiles(entries);
    if(pending.has(path))pending.set(dest,pending.get(path));
    if(action==='rename'){
      files.delete(path);pending.delete(path);
      if(file.type==='binary'){
        for(const [key,value] of pending)if(isPresetPath(key))pending.set(key,renameSource(value,path,dest));
        port?.postMessage({type:'rename-song',from:path,to:dest});
      }
      if(attached?.path===path)attached={...attached,path:dest};
      if(songPath===path){songPath=dest;transport();}
      if(romPath===path)romPath=dest;
      if(activePath===path){activePath=dest;editor.setSource(pending.get(dest)??file.data,dest);}
    }
    if(isBankPath(path)){
      bankSlots[dest]=structuredClone(bankSlots[path]??[]);rangePresets.set(dest,structuredClone(rangePresets.get(path)??[]));
      if(action==='rename'){files.delete(catalogPath(path));rangePresets.delete(path);}
      if(action==='rename'){delete bankSlots[path];if(path===bankPath)bankPath=dest;}
    }
    highlightedPath=dest;
  }
  renderFiles();scheduleDraft();
}
installSpuFileContextMenu({root:$('project-tree'),getActions:fileActions,
  onTarget:path=>{highlightedPath=path;renderFiles();},onAction:fileAction,
  onError:e=>{$('file-status').textContent=e.message;}});
function snapshot() {
  return {version:1,bankPath,bankSlots:structuredClone(bankSlots),files:files.list(),active:activePath,song:songPath,channels:channels.map(({held,...settings})=>settings),
    pads:pads.map(p=>({...p})),mix:mixer.get(),selected,autoChannel,autoVoice:{...autoVoice},echo:{...echo}};
}
const factory=snapshot();
function replaceProject(project) {
  stop(false);
  songSelection++;songPath=null;preparedSong=null;transport();
  attached=null;pending.clear();pendingBanks.clear();$('auto-apply').checked=true;
  files.replace(project.files);rangePresets.clear();
  if(project.bankPath){
    bankPath=project.bankPath;bankSlots=structuredClone(project.bankSlots);
  }else{
    const legacy=sampleLibrary(project.files,project.placements,project.padPlacements);
    bankPath=defaultRom;bankSlots=Object.fromEntries(stockBanks.map(([path,b])=>[path,b.slots]));
    bankSlots[bankPath]=[...stockBanks[1][1].slots,...legacy.regions.map(r=>({
      path:r.path,name:r.path.split('/').pop(),kind:legacy.padItems.get(r.path)===r?'ADPCM':'PCM',offset:r.offset,length:r.length,rate:r.rate,
    }))];
    for(const f of project.files)if(isSamplePath(f.path))files.delete(f.path);
    for(const [path,b] of stockBanks)files.writeBinary(path,path===bankPath?legacy.rom:b.rom);
  }
  for(const path of Object.keys(bankSlots)){
    const f=files.get(catalogPath(path));
    if(f)rangePresets.set(path,readCatalog(f.data).presets);
    else syncCatalog(path);
  }
  rebuildSamples();
  project.channels.forEach((v,i)=>Object.assign(channels[i],{samplePath:null},v,{held:null}));
  autoVoice={...(project.autoVoice??channels[project.selected]),held:null};nextAuto=project.selected;
  project.pads.forEach((v,i)=>{
    Object.assign(pads[i],{samplePath:null},v);
  });
  syncPadView();
  mixer.set(project.mix);
  Object.assign(echo,project.echo);
  restoreEcho();
  select(project.selected,project.autoChannel===true);showRomMap();
  activePath=highlightedPath=project.active;editor.setSource(files.get(activePath).data,activePath);renderFiles();
  if(project.song)openScript(project.song);else selectDefaultSong();
}
const draftKey='tetorica.cps2.cassette.v1';
const store=createSynthProjectStore({name:'tetorica-cps2-project'});
let timer, draftReady=false;
async function saveDraft() {
  clearTimeout(timer);
  if(!draftReady)return;
  try {if(!await store.write({...snapshot(),autoApply:$('auto-apply').checked,pending:[...pending],pendingBanks:[...pendingBanks]})) throw Error();}
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
    for(const file of project.files)if(/\.vg[mz]$/i.test(file.path))await prepareSong(file.data);
    if (!confirm('Replace the current project with '+file.name+'?')) return;
    replaceProject(project);saveDraft();$('file-status').textContent='Imported '+file.name;
  } catch(error){$('file-status').textContent=error.message;}
};
function rebuildSamples(next=bankLibrary(files.get(bankPath).data,bankSlots[bankPath])){
  library=next;
  if(port)port.postMessage({type:'project-rom',rom:library.rom});
  codeWorker?.postMessage({samples:codeSamples()});
}
function setPcmSample(v,path){
  const item=library.items.get(path);
  Object.assign(v,{samplePath:path,sample:0,note:60,referenceNote:60,rate:item.rate,referenceRate:item.rate,
    end:item.start+item.length,loop:item.length});
}
function setPadSample(pad,path){
  const item=library.padItems.get(path);
  Object.assign(pad,{samplePath:path,bank:item.bank,start:item.start,end:item.start+item.length});
}
function ensurePadSample(path){
  if(!library.padItems.has(path)){
    const pcm=library.items.get(path);
    if(!pcm)throw Error('Missing ADPCM slot: '+path);
    const result=padFromPcm(library.rom,bankSlots[bankPath],pcm);
    checkBankSize(bankPath,result.library.rom);
    files.writeBinary(bankPath,result.library.rom);bankSlots[bankPath]=result.slots;syncCatalog(bankPath);
    rebuildSamples(result.library);renderBankEditor();scheduleDraft();
  }
  return library.padItems.get(path);
}
function assignSample(path){
  const item=library.items.get(path),v=editedVoice(),adpcm=!$('adpcm-chip').hidden;
  if(adpcm){
    try{ensurePadSample(path);}
    catch(error){$('file-status').textContent=error.message;return;}
  }
  if(liveInstrument)stop(false);
  attached=null;highlightedPath=bankPath;
  if(adpcm){
    setPadSample(pads[padVoice],path);revision++;showPad();renderFiles();scheduleDraft();
    $('file-status').textContent=path+' → ADPCM Voice '+(padVoice+1)+' · Key '+(padVoice+1);
    return;
  }
  if(v.held)release(v.held);
  setPcmSample(v,path);
  selectPerformance(false);document.querySelector('[data-chip="pcm-chip"]').click();selectPcmTab(false);
  select(selected,autoChannel);renderFiles();scheduleDraft();
  $('file-status').textContent=path+' → '+(autoChannel?'AUTO':'CH'+(selected+1))+' · Bank '+item.bank+' · '+item.length+' bytes';
}
const slotControl=createParamControl({label:'Sample slot',min:0,max:127,step:1,value:0,onChange:chooseSlot});
$('bank-slot').append(slotControl.element);
const slotButtons=Array.from({length:128},(_,i)=>{
  const b=document.createElement('button');b.textContent=i;b.onclick=()=>chooseSlot(i);
  $('slot-buttons').append(b);return b;
});
function chooseSlot(i){
  slot=i;
  const s=bankSlots[bankPath]?.[slot];if(s)$('slot-kind').value=s.kind;
  renderBankEditor();
}
let previewItem=null;
function drawSlotWave(item){
  if(previewItem===item)return;
  previewItem=item;
  drawSampleWave($('slot-wave'),item);
}
function drawSampleWave(canvas,item){
  const {width,height}=canvas,ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,width,height);
  if(!item){
    ctx.fillStyle='#527083';ctx.fillRect(0,height/2,width,1);
    return;
  }
  const adpcm=item.kind==='ADPCM';
  const voice={start:0,end:item.length,bank:0,volume:32767,trigger:true};
  const count=item.length*(adpcm?2:1);
  ctx.fillStyle='#8ae2d1';
  for(let x=0,i=0;x<width;x++){
    let min=1,max=-1;
    const until=Math.ceil((x+1)*count/width);
    for(;i<until;i++){
      if(adpcm)advanceAdpcm(voice,item.pcm,i%2);
      const v=adpcm?voice.output/32768:((item.pcm[i]<<24)>>24)/128;
      min=Math.min(min,v);max=Math.max(max,v);
    }
    if(max>=min)ctx.fillRect(x,(1-max)*height/2,1,1+(max-min)*height/2);
  }
}
function syncCatalog(path){
  const catalog=files.get(catalogPath(path));
  const source=catalog && readCatalog(catalog.data).source;
  files.writeText(catalogPath(path),catalogText(bankSlots[path]??[],rangePresets.get(path)??[],source));
  const staged=pendingBanks.get(path);
  if(staged)staged.json=catalogText(bankSlots[path]??[],readCatalog(staged.json).presets,source);
}
function slotRanges(){
  return (bankSlots[bankPath]??[]).flatMap(s=>s?[{name:s.name,kind:s.kind,
    bank:Math.floor(s.offset/65536),start:s.offset%65536,end:(s.offset+s.length)%65536,
    ...(s.kind==='PCM'?{rate:s.rate,loop:s.length}:{})}]:[]);
}
function projectRanges(){
  return [...slotRanges(),...(rangePresets.get(bankPath)??[])];
}
function authoredRanges(){
  return [...channels.map((v,i)=>({voice:i,kind:'PCM',bank:bankFor(v),start:startFor(v),end:v.end,rate:v.rate,loop:v.loop})),
    ...pads.map((p,i)=>({voice:i+16,kind:'ADPCM',bank:p.bank,start:p.start,end:p.end})),
    {voice:-1,kind:'PCM',bank:bankFor(autoVoice),start:startFor(autoVoice),end:autoVoice.end,rate:autoVoice.rate,loop:autoVoice.loop}];
}
const pickerSignatures=new WeakMap();
function rangeOptions(id,options){
  const picker=$(id),signature=JSON.stringify(options);
  if(signature===pickerSignatures.get(picker))return;
  const old=picker.value;
  picker.replaceChildren(...options.map(([value,label])=>new Option(label,String(value))));
  if(options.some(([value])=>String(value)===old))picker.value=old;
  pickerSignatures.set(picker,signature);
}
function availableRanges(){return romPath?vgmRanges:projectRanges();}
let renderedHistory=null;
function currentRomRanges(){
  const ranges=new Map();
  for(const {voice,...range} of liveInstrument?currentRanges:authoredRanges()){
    ranges.set(rangeKey(range),range);
  }
  return ranges;
}
function editablePresets(path=bankPath){
  const staged=pendingBanks.get(path);
  return staged?readCatalog(staged.json).presets:(rangePresets.get(path)??[]);
}
let creationRanges;
let itemRanges=new Map(),itemDraft,itemRom,itemSignature,previewNode;
let cachedRomPath,cachedRevision,cachedRom;
const itemControls={};
for(const [key,label,max] of [['bank','Bank',32767],['start','Start',65535],['end','End (exclusive)',65535],
    ['rate','Rate',65535],['loop','Loop length',65535]]){
  const control=createParamControl({label,min:0,max,step:1,value:0,
    formatValue:key==='start'||key==='end'?n=>'0x'+n.toString(16).toUpperCase().padStart(4,'0'):String,
    onChange(value){if(itemDraft){itemDraft[key]=value;drawItem();}}});
  $('item-controls').append(control.element);itemControls[key]=control;
}
function selectedRomBytes(path){
  if(!path)return null;
  if(!romPath)return library.rom;
  const staged=pendingBanks.get(path)?.rom;
  if(staged)return staged;
  const revision=files.getRevision(path);
  if(path!==cachedRomPath||revision!==cachedRevision){
    cachedRomPath=path;cachedRevision=revision;cachedRom=files.get(path)?.data;
  }
  return cachedRom;
}
function stopItemPreview(){
  if(previewNode){previewNode.stop();previewNode.disconnect();previewNode=null;}
}
function showItem(){
  const id=$('range-current').value,p=itemRanges.get(id),path=romPath?syncedBank:bankPath;
  const rom=selectedRomBytes(path),signature=JSON.stringify([path,id,p]);
  if(signature===itemSignature && rom===itemRom)return;
  rangeDrag=null;stopItemPreview();itemSignature=signature;itemRom=rom;itemDraft=p?{...p}:null;
  $('item-editor').hidden=!itemDraft;
  if(!p)return;
  $('item-encoding').textContent=p.kind==='PCM'?'8-bit PCM':'4-bit ADPCM';
  for(const [key,control] of Object.entries(itemControls)){
    control.element.hidden=!(key in p);
    if(key in p)control.updateVisual(p[key]);
  }
  drawItem();
}
let selectionView=false,rangeDrag;
const bankWave=document.createElement('canvas');
bankWave.width=$('item-wave').width;bankWave.height=$('item-wave').height;
let drawnRom,drawnBank,drawnKind;
function bankLength(){return Math.min(65536,Math.max(0,(itemRom?.length??0)-itemDraft.bank*65536));}
function drawFullBank(){
  const p=itemDraft,base=p.bank*65536,size=bankLength();
  if(drawnRom!==itemRom||drawnBank!==p.bank||drawnKind!==p.kind){
    const pcm=itemRom?.subarray(base,base+size);
    drawSampleWave(bankWave,size?{pcm,length:size,kind:p.kind}:null);
    drawnRom=itemRom;drawnBank=p.bank;drawnKind=p.kind;
  }
  const canvas=$('item-wave'),ctx=canvas.getContext('2d'),{width,height}=canvas;
  ctx.clearRect(0,0,width,height);ctx.drawImage(bankWave,0,0);
  if(!size)return;
  const x=n=>Math.min(width,n*width/size);
  ctx.fillStyle='rgba(255,196,66,.24)';
  if(p.end>=p.start)ctx.fillRect(x(p.start),0,x(p.end)-x(p.start),height);
  else{ctx.fillRect(x(p.start),0,width-x(p.start),height);ctx.fillRect(0,0,x(p.end),height);}
  for(const address of [p.start,(p.start && !p.end)?65536:p.end]){
    ctx.fillStyle='#ffd674';ctx.fillRect(Math.min(width-2,x(address)),0,2,height);
  }
}
function setItemView(selection){
  selectionView=selection;rangeDrag=null;
  $('item-selection').setAttribute('aria-pressed',String(selection));
  $('item-full').setAttribute('aria-pressed',String(!selection));
  $('item-wave').setAttribute('aria-label',selection?'Selected range waveform':'Full bank waveform');
  $('item-wave').style.cursor=selection?'default':'crosshair';
  $('item-wave-help').hidden=selection;
  if(itemDraft)drawItem();
}
$('item-full').onclick=()=>setItemView(false);
$('item-selection').onclick=()=>setItemView(true);
const itemWave=$('item-wave');
function pointerAddress(e){
  const rect=itemWave.getBoundingClientRect();
  return Math.max(0,Math.min(bankLength(),Math.round((e.clientX-rect.left)*bankLength()/rect.width)));
}
itemWave.onpointerdown=e=>{
  if(selectionView||!itemDraft||!bankLength()||e.button!==0||rangeDrag)return;
  const anchor=pointerAddress(e),tolerance=6*bankLength()/itemWave.getBoundingClientRect().width;
  const startDistance=Math.abs(anchor-itemDraft.start),endDistance=Math.abs(anchor-((itemDraft.start && !itemDraft.end)?65536:itemDraft.end));
  let edge=null;
  if(Math.min(startDistance,endDistance)<=tolerance)edge=startDistance<endDistance?'start':'end';
  rangeDrag={pointer:e.pointerId,anchor,edge};
  itemWave.setPointerCapture(e.pointerId);e.preventDefault();
};
function moveRange(e){
  if(!rangeDrag||rangeDrag.pointer!==e.pointerId)return;
  const address=pointerAddress(e),{anchor,edge}=rangeDrag;
  if(edge)itemDraft[edge]=edge==='end'?address&65535:Math.min(65535,address);
  else if(anchor!==address){
    itemDraft.start=Math.min(anchor,address,65535);itemDraft.end=Math.max(anchor,address)&65535;
  }
  itemControls.start.updateVisual(itemDraft.start);itemControls.end.updateVisual(itemDraft.end);
  drawItem();
}
itemWave.onpointermove=moveRange;
itemWave.onpointerup=e=>{moveRange(e);if(rangeDrag?.pointer===e.pointerId)rangeDrag=null;};
itemWave.onlostpointercapture=e=>{if(rangeDrag?.pointer===e.pointerId)rangeDrag=null;};
function drawItem(){
  const p=itemDraft,base=p.bank*65536,length=(p.end-p.start)&65535;
  const wraps=p.end<p.start;
  const valid=itemRom && length && base+(wraps?65536:p.end)<=itemRom.length;
  let item;
  if(selectionView && valid){
    let pcm=itemRom.subarray(base+p.start,base+(wraps?65536:p.end));
    if(wraps){
      const joined=new Uint8Array(length);joined.set(pcm);joined.set(itemRom.subarray(base,base+p.end),pcm.length);pcm=joined;
    }
    item={pcm,length,kind:p.kind};
  }
  if(selectionView)drawSampleWave($('item-wave'),item);else drawFullBank();
  $('item-preview').disabled=!valid;
  $('item-save').disabled=!valid || rangeKey(p)===rangeKey(itemRanges.get($('range-current').value));
}
$('item-preview').onclick=()=>run(async()=>{
  const p={...itemDraft},rom=itemRom,signature=itemSignature;
  await audio();if(signature!==itemSignature)return;
  stopItemPreview();
  const rate=context.sampleRate,chip=new QSoundPcm(rom,rate);
  const writes=p.kind==='PCM'?noteWrites(0,60,0,16,16384,p.rate,p.end,p.loop,p.bank,p.start):
    [[0xca,p.start],[0xcb,p.end],[0xcc,p.bank],[0xcd,32767],[0x90,0x120],[0xd6,1]];
  for(const [reg,value] of writes)chip.writeRegister(reg,value);
  const buffer=context.createBuffer(2,rate,rate);
  chip.render(buffer.getChannelData(0),buffer.getChannelData(1));
  const node=context.createBufferSource();node.buffer=buffer;node.connect(masterGain);
  node.onended=()=>{node.disconnect();if(previewNode===node)previewNode=null;};
  previewNode=node;node.start();
});
$('item-save').onclick=()=>{
  const path=romPath?syncedBank:bankPath;if(!path||!itemDraft)return;
  const list=[...editablePresets(path)],id=$('range-current').value;
  const existing=id.startsWith('preset:'),index=existing?Number(id.slice(7)):list.length;
  const name=existing?list[index].name:(itemDraft.name?itemDraft.name+' (edited)':rangeName(itemDraft));
  list[index]={...itemDraft,name};
  writeRangePresets(list,'preset:'+index,path);
};
function updateRangeActions(){
  $('range-new').disabled=Boolean(romPath);
  $('range-del').disabled=Boolean(romPath)||!$('range-current').value.startsWith('preset:');
}
$('range-current').onchange=()=>{updateRangeActions();showItem();};
function writeRangePresets(list,next,path=bankPath){
  if($('auto-apply').checked){
    rangePresets.set(path,list);syncCatalog(path);
  }else{
    const staged=pendingBanks.get(path),saved=files.get(catalogPath(path))?.data;
    const source=readCatalog(staged?.json??saved).source;
    const json=catalogText(bankSlots[path]??[],list,source);
    if(json===saved&&!staged?.rom)pendingBanks.delete(path);
    else pendingBanks.set(path,{...staged,json});
  }
  renderFiles();
  if([...$('range-current').options].some(o=>o.value===next))$('range-current').value=next;
  updateRangeActions();showItem();scheduleDraft();
}
$('range-new').onclick=()=>{
  creationRanges=currentRomRanges();
  const options=Array.from(creationRanges,([key,range])=>[key,rangeName(range)]);
  rangeOptions('range-source',options);
  const range=creationRanges.get($('range-source').value);
  $('range-name').value=range?rangeName(range):'';
  $('range-create').showModal();
};
$('range-source').onchange=()=>{
  $('range-name').value=rangeName(creationRanges.get($('range-source').value));
};
$('range-create').querySelector('form').onsubmit=e=>{
  if(e.submitter?.value==='cancel')return;
  const name=$('range-name').value.trim(),range=creationRanges.get($('range-source').value);
  if(!range||!name||romPath){e.preventDefault();return;}
  const list=[...editablePresets(),{...range,name}];
  writeRangePresets(list,'preset:'+(list.length-1));
};
$('range-del').onclick=()=>{
  const value=$('range-current').value;
  if(romPath||!value.startsWith('preset:'))return;
  const list=[...editablePresets()],index=Number(value.slice(7)),preset=list[index];
  if(!preset||!confirm('Delete preset '+preset.name+'?'))return;
  list.splice(index,1);
  writeRangePresets(list,'preset:'+Math.min(index,list.length-1));
};
function renderRanges(){
  const current=currentRomRanges(),options=[];
  itemRanges=new Map();
  if(!romPath){
    for(const range of slotRanges()){
      itemRanges.set('slot:'+rangeKey(range),range);options.push(['slot:'+rangeKey(range),range.name]);current.delete(rangeKey(range));
    }
  }
  const path=romPath?syncedBank:bankPath;
  if(path)editablePresets(path).forEach((preset,index)=>{
    itemRanges.set('preset:'+index,preset);options.push(['preset:'+index,preset.name]);current.delete(rangeKey(preset));
  });
  for(const [key,range] of current){itemRanges.set(key,range);options.push([key,rangeName(range)]);}
  rangeOptions('range-current',options);
  $('range-current').disabled=!options.length;
  updateRangeActions();showItem();
  if(romPath && renderedHistory===vgmRanges)return;
  renderedHistory=romPath?vgmRanges:null;
  const presets=availableRanges();
  for(const [id,kind] of [['pcm-range','PCM'],['adpcm-range','ADPCM']]){
    rangeOptions(id,[['','Choose preset…'],...presets.flatMap((p,i)=>p.kind===kind&&!p.earlierImage?[[i,p.name??rangeName(p)]]:[])]);
  }
  $('range-history-label').hidden=$('use-history').hidden=!romPath;
  rangeOptions('range-history',romPath?vgmRanges.map((p,i)=>[i,rangeName(p)+(p.earlierImage?' · Earlier ROM image':'')]):[]);
  $('use-history').disabled=!vgmRanges.length||Boolean(vgmRanges[Number($('range-history').value)]?.earlierImage);

}
function applyRange(p){
  if(!p||p.earlierImage)return;
  if(songState==='playing')pauseSong();
  if(p.kind==='PCM'){
    if(!liveInstrument||autoChannel){
      Object.assign(editedVoice(),{samplePath:null,sample:0,bank:p.bank,start:p.start,end:p.end,loop:p.loop,
        rate:p.rate,note:60,referenceNote:60,referenceRate:p.rate});
    }
    if(!autoChannel||keyboardOwnsTarget()){
      const b=selected*8;
      port?.postMessage([[((selected+15)&15)*8,0x8000|p.bank],[b+1,p.start],[b+2,p.rate],[b+3,0],[b+4,p.loop],[b+5,p.end]]);
    }
  }else{
    if(!liveInstrument)Object.assign(pads[padVoice],{samplePath:null,bank:p.bank,start:p.start,end:p.end});
    const b=0xca+4*padVoice;port?.postMessage([[b,p.start],[b+1,p.end],[b+2,p.bank]]);
    if(!liveInstrument)showPad();
  }
  attached=null;refresh();inspectChannel();scheduleDraft();
}
$('pcm-range').onchange=$('adpcm-range').onchange=e=>{if(e.target.value!=='')applyRange(availableRanges()[Number(e.target.value)]);};
$('range-history').onchange=()=>{$('use-history').disabled=Boolean(vgmRanges[Number($('range-history').value)]?.earlierImage);};
$('use-history').onclick=()=>{
  const p=vgmRanges[Number($('range-history').value)];
  if(!p||p.earlierImage)return;
  applyRange(p);document.querySelector('[data-chip="'+p.kind.toLowerCase()+'-chip"]').click();
};
// Keep separate images when a later VGM data block replaces sample bytes.
function syncPlayingBank({source,bytes,current,ranges,romRevision,version}){
  if(!source || source!==romPath)return;
  let path=syncedBank;
  if(bytes){
    if(!bytes.length)return;
    const stem='/banks/'+source.split('/').pop().replace(/\.vg[mz]$/i,'').replace(/[\x00-\x1f\\<>:"|?*]/g,'_');
    for(let n=1;;n++){
      path=stem+(n===1?'':' '+n)+'.bin';
      const staged=pendingBanks.get(path);
      const json=staged?.json??files.get(catalogPath(path))?.data;
      if(!files.has(path)&&!json)break;
      if(!json || readCatalog(json).source!==source)continue;
      const existing=staged?.rom??files.get(path)?.data;
      if(existing?.length===bytes.length && existing.every((v,i)=>v===bytes[i]))break;
    }
  }
  const staged=pendingBanks.get(path);
  if(!path || (!bytes && !staged && !files.has(path)))return;
  const signature=JSON.stringify([path,version,current]);
  if(!bytes && signature===syncedRangeSignature)return;
  const fresh=!staged&&!files.has(path),presets=staged?readCatalog(staged.json).presets:(rangePresets.get(path)??[]),keys=new Set(presets.map(rangeKey));
  const added=[];
  for(const {voice,...p} of [...(ranges??vgmRanges),...current]){
    const key=rangeKey(p);
    if(p.earlierImage || keys.has(key))continue;
    keys.add(key);added.push({...p,name:rangeName(p)});
  }
  if(fresh || added.length){
    const list=[...presets,...added],text=catalogText(bankSlots[path]??[],list,source);
    const entries=[{path:catalogPath(path),data:text}];
    if(fresh)entries.unshift({path,data:bytes});
    if(fresh){
      try{checkBankSize(path,bytes,new TextEncoder().encode(text).length);}
      catch(error){
        if(!(error instanceof RangeError))throw error;
        syncedRomRevision=romRevision;syncedBank=null;
        $('file-status').textContent='The cassette is full. Export ROM keeps the playing ROM and its presets together.';
        return {path,rom:bytes,json:text};
      }
    }
    if($('auto-apply').checked){
      files.writeFiles(entries);
      bankSlots[path]??=[];rangePresets.set(path,list);
    }else{
      pendingBanks.set(path,{rom:fresh?bytes:staged?.rom,json:text});
    }
    scheduleDraft();
  }
  const switched=syncedBank!==path;
  syncedBank=path;syncedRomRevision=romRevision;syncedRangeSignature=signature;
  if(fresh || switched || (!staged && pendingBanks.has(path)))renderFiles();
}
$('range-export').onclick=()=>run(async()=>{
  let path=bankPath,overflow;
  if(romPath){
    const source=romPath;
    const {port1,port2}=new MessageChannel();
    const snapshot=new Promise(resolve=>{port1.onmessage=e=>{port1.close();resolve(e.data);};});
    port.postMessage({type:'export-pair',reply:port2},[port2]);
    const data=await snapshot;
    if(source!==romPath || data.source!==source || !data.bytes.length)throw Error('The selected ROM changed or is not ready.');
    overflow=syncPlayingBank(data);path=overflow?.path??syncedBank;
  }
  const name=path.split('/').pop(),jsonName=catalogPath(name);
  const staged=pendingBanks.get(path);
  const rom=overflow?.rom??staged?.rom??files.get(path).data,json=overflow?.json??staged?.json??files.get(catalogPath(path)).data;
  const bytes=zipSync({[name]:rom,[jsonName]:new TextEncoder().encode(json)});
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),link=document.createElement('a');
  link.href=url;link.download=name.replace(/\.(rom|bin)$/i,'.zip');link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
function renderBankEditor(){
  renderRanges();
  const picker=$('rom-file'),paths=files.readdir('/banks').map(name=>'/banks/'+name).filter(path=>isBankPath(path)&&files.has(path));
  const selectedRom=romPath?(syncedBank??romPath):bankPath;
  if(!paths.includes(selectedRom))paths.unshift(selectedRom);
  if(paths.join('\n')!==Array.from(picker.options,o=>o.value).join('\n'))
    picker.replaceChildren(...paths.map(path=>new Option(path.split('/').pop(),path)));
  picker.value=selectedRom;$('bank-name').textContent=bankPath.split('/').pop();
  const slots=bankSlots[bankPath]??[],s=slots[slot];
  slotControl.updateVisual(slot);
  drawSlotWave(library.regions.find(item=>item.slot===slot));
  slotButtons.forEach((b,i)=>{
    b.classList.toggle('filled',Boolean(slots[i]));
    b.setAttribute('aria-pressed',String(i===slot));b.title=slots[i]?.name??'Empty slot '+i;
  });
  $('bank-size').textContent=slots.filter(Boolean).length+' / 128 slots · ROM '+library.rom.length.toLocaleString()+' / '+maxRom.toLocaleString()+' bytes';
  $('slot-info').textContent=s?s.name+' · '+s.kind+' · Bank '+Math.floor(s.offset/65536)+' · '+s.length+' bytes':'Empty slot';
  $('slot-del').disabled=!s || Boolean(romPath);$('slot-load').disabled=Boolean(romPath);
  $('slot-editor').hidden=Boolean(romPath);
  $('slot-use').disabled=!s || Boolean(romPath);
  $('slot-use').textContent=s?.kind==='ADPCM'?'Assign to Voice '+(padVoice+1):autoChannel?'Assign to AUTO':'Assign to CH'+(selected+1);
}
function selectBank(path){
  if(pendingBankPath(path)){renderBankEditor();$('file-status').textContent='Choose Save files to use this ROM and its presets.';return;}
  if(!isBankPath(path)||!files.has(path))throw Error('Missing ROM '+path);
  if(bankPath!==path || romPath){
    for(const v of [...channels,autoVoice]){v.bank=bankFor(v);v.start=startFor(v);}
    stop(false);bankPath=path;
    rebuildSamples();
    for(const v of [...channels,autoVoice]){
      if(library.items.has(v.samplePath))setPcmSample(v,v.samplePath);
      else v.samplePath=null;
    }
    for(const p of pads){
      if(library.padItems.has(p.samplePath))setPadSample(p,p.samplePath);
      else p.samplePath=null;
    }
    refresh();showPad();showRomMap();
  }
  highlightedPath=path;renderFiles();chooseSlot(slot);scheduleDraft();
}
$('rom-file').onchange=e=>selectBank(e.target.value);
function checkBankSize(path,bytes,extraSize=0){
  const total=files.list().reduce((n,f)=>f.path===path?n:n+(typeof f.data==='string'?new TextEncoder().encode(f.data).length:f.data.length),bytes.length+extraSize);
  const stagedSize=[...pendingBanks].reduce((n,[bank,pair])=>n+(pair.rom?.length??0)+new TextEncoder().encode(pair.json).length-(files.has(catalogPath(bank))?files.stat(catalogPath(bank)).size:0),0);
  if(total+stagedSize>maxRom)throw new RangeError('The cassette exceeds 16 MiB.');
}
function addRom(name,bytes,presets=[],slots=[]){
  if(!name.trim() || /[/\\]/.test(name))throw Error('Enter a ROM file name.');
  const path=checkPath('/banks/'+name.trim()+(/\.(bin|rom)$/i.test(name.trim())?'':'.bin'));
  if(!isBankPath(path)||files.has(path)||files.has(catalogPath(path))||pendingBankPath(catalogPath(path)))throw Error('Choose a new ROM file name.');
  bankLibrary(bytes,slots);
  const text=catalogText(slots,presets);readCatalog(text);
  checkBankSize(path,bytes,new TextEncoder().encode(text).length);
  files.writeFiles([{path,data:bytes},{path:catalogPath(path),data:text}]);
  bankSlots[path]=slots;rangePresets.set(path,presets);
  selectBank(path);
}
$('new-rom').onclick=()=>run(async()=>{
  let n=1;while(files.has('/banks/user-'+n+'.bin'))n++;
  const name=prompt('New ROM file name','user-'+n+'.bin');
  if(!name?.trim())return;
  addRom(name,new Uint8Array());chooseSlot(0);$('slot-editor').open=true;
  document.querySelector('[data-chip="rom-chip"]').click();
});
$('import-rom').onclick=()=>$('rom-input').click();
$('rom-input').onchange=e=>run(async()=>{
  const input=[...e.target.files];e.target.value='';if(!input.length)return;
  const rom=input.find(f=>/\.(rom|bin)$/i.test(f.name)),json=input.find(f=>/\.preset\.json$/i.test(f.name));
  if(!rom||input.length!==(json?2:1)||json&&json.name!==catalogPath(rom.name))throw Error('Choose one ROM and its matching .preset.json.');
  if(rom.size+(json?.size??0)>maxRom)throw Error('ROM pair exceeds 16 MiB.');
  const c=json?readCatalog(await json.text()):{slots:[],presets:[]};
  addRom(rom.name,new Uint8Array(await rom.arrayBuffer()),c.presets,c.slots);
});
function updateSlot(data,name,kind){
  if(romPath)throw Error('Load a project ROM first.');
  const old=bankSlots[bankPath][slot],result=editSlot(library.rom,bankSlots[bankPath],slot,data,kind,name);
  checkBankSize(bankPath,result.library.rom);
  if(liveInstrument)stop(false);
  files.writeBinary(bankPath,result.library.rom);bankSlots[bankPath]=result.slots;syncCatalog(bankPath);
  rebuildSamples(result.library);
  if(old){
    for(const v of [...channels,autoVoice])if(old.kind==='PCM'&&v.samplePath===old.path){
      const item=library.items.get(old.path);
      if(item){const end=v.end-old.offset%65536,loop=v.loop;setPcmSample(v,old.path);
        if(end>0&&end<=item.length){v.end=item.start+end;v.loop=Math.min(end,loop);}}
      else Object.assign(v,{samplePath:null,sample:0,bank:0,start:0,end:256,loop:256,referenceRate:null});
    }
    for(const [i,p] of pads.entries())if(old.kind==='ADPCM'&&p.samplePath===old.path){
      if(library.padItems.has(old.path))setPadSample(p,old.path);
      else Object.assign(p,{samplePath:null,sample:i,bank:0,start:(i+1)*512,end:(i+2)*512});
    }
  }
  chooseSlot(slot);revision++;refresh();showPad();showRomMap();renderFiles();scheduleDraft();
}
$('slot-load').onclick=()=>{
  replacingWav={path:bankPath,slot,revision:files.getRevision(bankPath),kind:$('slot-kind').value};
  $('wav-input').click();
};
$('wav-input').oncancel=()=>{replacingWav=null;};
$('wav-input').onchange=e=>run(async()=>{
  const target=replacingWav,f=e.target.files[0];replacingWav=null;e.target.value='';
  if(!target||!f)return;
  if(f.size>maxRom)throw Error('WAV exceeds 16 MiB.');
  const data=new Uint8Array(await f.arrayBuffer());
  if(target.path!==bankPath||target.slot!==slot||target.revision!==files.getRevision(bankPath))throw Error('The selected slot changed.');
  updateSlot(data,f.name,target.kind);
});
$('slot-del').onclick=()=>run(async()=>{
  if(confirm('Delete slot '+slot+' from '+bankPath+'?'))updateSlot(null);
});
$('slot-use').onclick=()=>{
  const s=bankSlots[bankPath][slot];if(!s)return;
  document.querySelector(s.kind==='PCM'?'[data-chip="pcm-chip"]':'[data-chip="adpcm-chip"]').click();
  assignSample(s.path);
};
$('import-wav').onclick=()=>{document.querySelector('[data-chip="rom-chip"]').click();$('slot-load').click();};
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
  if(songState==='paused'){attached=null;stopWorker();channels.forEach(v=>v.held=null);revision++;songState='playing';port.postMessage({type:'pause-song',paused:false});transport();return;}
  stop();
  const token=generation;
  if(!preparedSong)return;
  const {bytes}=preparedSong;
  await audio();
  if(token!==generation)return;
  attached=null;romPath=songPath;syncedBank=null;syncedRomRevision=-1;rangeVersion=-1;vgmRanges=[];currentRanges=[];renderPresetInfo();liveInstrument=true;songState='playing';port.postMessage({type:'song',path:songPath,bytes,loop:preparedSong.canLoop && $('song-loop').checked});
  port.postMessage({type:'range-state',known:-1,knownRom:-1});transport();
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
      revision++;attached=null;romPath=songPath;syncedBank=null;syncedRomRevision=-1;rangeVersion=-1;vgmRanges=[];currentRanges=[];renderPresetInfo();
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
  if(draft){
    replaceProject(validateProject(draft));
    $('auto-apply').checked=draft.autoApply!==false;
    if(!draft.autoApply){
      for(const [path,pair] of draft.pendingBanks??[]){
        if(!isBankPath(path)||!(pair.rom instanceof Uint8Array || files.has(path)))continue;
        readCatalog(pair.json);pendingBanks.set(path,pair);
      }
    }
    if(!draft.autoApply && Array.isArray(draft.pending)){
      for(const [path,text] of draft.pending)if(typeof text==='string' && files.get(path)?.type==='text'){
        if(isPresetPath(path))readPreset(text);
        pending.set(path,text);
      }
      editor.setSource(pending.get(activePath)??files.get(activePath).data,activePath);
    }
  }
} catch(error){$('file-status').textContent='Draft unavailable: '+error.message;}
if(!songPath)selectDefaultSong();
renderFiles();draftReady=true;
