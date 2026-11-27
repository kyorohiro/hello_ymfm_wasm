import {arrangeVoiceSections} from './voice-tabs.js';
import {setupSynthMenu} from '../synth/synth_menu.js';
import {createYm2151Audio} from '../js/playground_ym2151_audio.js';
import {createYm2151RegisterClient} from '../js/playground_ym2151.js';
import {Ym2151VoiceInspector} from '../js/playground_ym2151_inspector.js';
import {createPlaygroundYm2151VoicePanel} from '../playground/playground_ym2151_voice_panel.js';
import {createParamControl} from '../synth/synth_controls.js';
import {createFretboardLayout,createFretboardState,buildKeyboard} from '../synth/synth_keyboard.js';
import {createSynthOutputVisualizer} from '../synth/synth_output_visualizer.js';
import {decodeSongSample} from './song-samples.js';
import {displaySample,drawWave} from './sample-view.js';
import {setupFiles} from './files.js';
import {createKit,samples} from './kit.js';

const $ = id => document.getElementById(id);
setupSynthMenu({document,window});
$('chooseCassette').onclick = () => $('importCassette').click();
const status = message => { $('status').textContent = message; };
const fail = error => status(error.message ?? String(error));
const scope = createSynthOutputVisualizer({trace:'#a5df69',waveformMinRange:.04});
let audio, starting, context, dirty = true, mode = 'waveform', worker, runId = 0;
let sampleRom = createKit(), rawOki = [];
const voiceMutes = Array(4).fill(false);
const muteButtons = [], mixerVoiceButtons = [];
const fmMutes = Array(8).fill(false);
const mix = {fm:{level:100,muted:false},pcm:{level:100,muted:false}};

// Mask only the stereo output enables. Preserve the patch, phase and envelopes.
function audibleRegister(register,value) {
  return [register,register >= 0x20 && register <= 0x27 && fmMutes[register-0x20] ? value & 0x3f : value];
}
function gainFor(source) {return source.muted ? 0 : source.level/100;}
const keyMasks = Array(8).fill(15);
const inspector = new Ym2151VoiceInspector({dispatch({method,args}) {
  if (method === 'writeRegister') opm.writeRegister(...args);
  if (method === 'forceKeyOff') opm.keyOff(args[0]);
  if (method === 'auditionKeyOn') opm.keyOn(args[0]);
}});
const opm = createYm2151RegisterClient((method,args) => {
  if (method !== 'writeRegister') throw Error('Unsupported OPM command');
  inspector.observeWrite(...args);
  audio?.fm.port.postMessage({method,args:audibleRegister(...args)});
  dirty = true;
});
const keyOn = opm.keyOn;
opm.keyOn = (ch,mask=keyMasks[ch]) => keyOn(ch,mask);
let autoChannel=true, nextChannel=0;
const autoHeld=new Map();
function editVoice(method,args) {
  const result=inspector.invoke(method,args);
  if (['setVoice','setOperator'].includes(method)) files.recordEdit(args[0]);
  if (autoChannel && ['setVoice','setOperator'].includes(method)) {
    for (const ch of new Set(autoHeld.values())) if (ch!==args[0]) inspector.invoke(method,[ch,...args.slice(1)]);
  }
  return result;
}
const panel = createPlaygroundYm2151VoicePanel({root:$('fm'),arrangeSections:sections=>arrangeVoiceSections(sections,{
  read:()=>keyMasks[panel.getSelectedChannel()],
  toggle(bit) {
    const ch=panel.getSelectedChannel();
    keyMasks[ch]^=bit;
    files.recordEdit(ch);
  },
}),onChannelChange:()=>{autoChannel=false;syncKeyChannels();},createOperatorControl:createParamControl,invoke(method,args) {
  if (method === 'auditionOn') startAudio().catch(fail);
  return editVoice(method,args);
},onError:fail});
panel.setConnected(true);
for (let ch=0;ch<8;ch++) {
  opm.setPan(ch,true,true);
  opm.setAlgo(ch,4,2);
  for (let op=0;op<4;op++) opm.setOperator(ch,op,{
    mul:[2,1,3,1][op],tl:[38,26,46,31][op],ar:31,d1r:8,d1l:5,d2r:2,rr:9,
  });
}

async function startAudio() {
  if (audio) {await context.resume();return;}
  if (starting) return starting;
  starting = (async () => {
    context = new AudioContext();
    let fm;
    try {
      await context.resume();
      const master = context.createGain();
      master.gain.value = Number($('master').value)/100;
      await context.audioWorklet.addModule(new URL('./oki-worklet.js',import.meta.url));
      const buses = {fm:context.createGain(),pcm:context.createGain()};
      fm = await createYm2151Audio(context,buses.fm);
      for (const [id,bus] of Object.entries(buses)) {
        bus.gain.value = gainFor(mix[id]); bus.connect(master);
      }
      const pcm = new AudioWorkletNode(context,'cps1-oki',{numberOfInputs:0,outputChannelCount:[2]});
      pcm.port.onmessage = ({data}) => showBusy(data);
      pcm.connect(buses.pcm); master.connect(context.destination);
      scope.connect(context,[master]);
      audio = {fm,pcm,master,buses};
      const state = inspector.read();
      const writes = [];
      state.registers.forEach((value,r) => {
        if (r >= 0x0f && r !== 0x19) writes.push(audibleRegister(r,value));
      });
      writes.push([0x19,state.lfo.amDepth],[0x19,128|state.lfo.pmDepth]);
      state.channels.forEach(({channel,keyMask}) => {if (keyMask) writes.push([8,channel|(keyMask<<3)]);});
      fm.port.postMessage(writes.map(args => ({method:'writeRegister',args})));
      pcm.port.postMessage({rom:sampleRom});
      pcm.port.postMessage({voiceMutes});
      if (rawOki.length) pcm.port.postMessage({commands:rawOki});
      rawOki = [];
      $('power').disabled = true; $('power').textContent = 'Audio on'; status('Audio ready');
    } catch (error) {
      fm?.dispose(); audio = null; rawOki = [];
      await context.close(); throw error;
    } finally {starting = null;}
  })();
  return starting;
}
$('power').onclick = () => startAudio().catch(fail);
$('master').oninput = () => {
  $('volume').value = $('master').value+'%';
  if (audio) audio.master.gain.setTargetAtTime(Number($('master').value)/100,context.currentTime,.01);
};
$('scopeMode').onclick = () => {
  mode = mode === 'waveform' ? 'spectrum' : 'waveform';
  $('scopeMode').textContent = mode === 'waveform' ? 'Waveform' : 'Spectrum';
};
const canvas = $('scope'), ctx = canvas.getContext('2d');
new ResizeObserver(([entry]) => {
  canvas.width = Math.max(1,Math.round(entry.contentRect.width));
  canvas.height = Math.max(1,Math.round(entry.contentRect.height));
}).observe(canvas);
function draw() {
  if (dirty) {panel.update(inspector.read()); syncKeyChannels(); dirty = false;}
  scope.draw(canvas,ctx,mode);
  requestAnimationFrame(draw);
}
draw();
function setFilesOpen(open) {
  $('files').hidden=!open;
  $('filesToggle').setAttribute('aria-expanded',String(open));
}
$('filesToggle').onclick=()=>setFilesOpen($('files').hidden);
const main = document.querySelector('main');
const tabs = [...document.querySelectorAll('[data-tab]')];
const synthView = {source:'fm',performance:'keyboardPanel'};
let codeView = 'code';
function renderWorkspace() {
  const synth = main.dataset.mode === 'synth';
  $('performanceTabs').hidden = !synth;
  $('sourceTabs').setAttribute('aria-label',synth ? 'Sound chips' : 'Code workspace');
  $('synthMode').setAttribute('aria-pressed',String(synth));
  $('codeMode').setAttribute('aria-pressed',String(!synth));
  for (const tab of tabs) {
    const id = tab.dataset.tab;
    const visible = synth ? id === synthView.source || id === synthView.performance : id === codeView;
    $(id).hidden = !visible;
    tab.setAttribute('role','tab');
    tab.setAttribute('aria-selected',String(visible));
    tab.tabIndex=visible?0:-1;
    $(id).setAttribute('role','tabpanel');
    tab.setAttribute('aria-controls',id);
  }
  panel.setVisible(!$('fm').hidden);
}
function changeMode(mode) {
  if (mode === 'synth') synthView.performance = 'keyboardPanel';
  if (main.dataset.mode === mode) {renderWorkspace();return;}
  main.dataset.mode = mode;
  const codeTab = tabs.find(tab=>tab.dataset.tab==='code');
  const keyboardTab = tabs.find(tab=>tab.dataset.tab==='keyboardPanel');
  if (mode === 'code') {
    $('sourceTabs').prepend(codeTab);
    $('sourceTabs').append(keyboardTab);
    codeView = 'code';
  } else {
    $('performanceTabs').append(keyboardTab,codeTab);
  }
  renderWorkspace();
}
$('synthMode').onclick = () => changeMode('synth');
$('codeMode').onclick = () => changeMode('code');
for (const tab of tabs) tab.onclick = () => {
  const id = tab.dataset.tab;
  if (main.dataset.mode === 'code') codeView = id;
  else if (tab.parentElement === $('performanceTabs')) synthView.performance = id;
  else synthView.source = id;
  renderWorkspace();
};
for (const bar of [$('sourceTabs'),$('performanceTabs')]) {
  bar.setAttribute('role','tablist');
  bar.onkeydown=e=>{
    const items=[...bar.children], index=items.indexOf(e.target);
    if (index<0 || !['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    e.preventDefault();
    const target=e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowRight'?1:-1)+items.length)%items.length;
    items[target].focus();items[target].click();
  };
}
renderWorkspace();

const hex = n => '0x'+n.toString(16).toUpperCase().padStart(2,'0');
function limit(value,max,name) {
  if (!Number.isInteger(value) || value<0 || value>max) throw RangeError(name+' must be 0–'+max);
  return value;
}
function write(...bytes) {
  bytes.forEach(b => limit(b,255,'Command'));
  if (audio) audio.pcm.port.postMessage({commands:bytes}); else rawOki.push(...bytes);
  $('command').value = bytes.map(hex).join(' ');
}
const oki = {
  write:byte => write(byte),
  play(voice,sample,attenuation=2) {
    write(128|limit(sample,127,'Sample'), (16<<limit(voice,3,'Voice'))|limit(attenuation,15,'Attenuation'));
  },
  stop(voice) {write(8<<limit(voice,3,'Voice'));},
  setVoiceMuted(voice,muted) {
    limit(voice,3,'Voice');
    if (typeof muted !== 'boolean') throw TypeError('Muted must be true or false');
    voiceMutes[voice] = muted;
    muteButtons[voice].setAttribute('aria-pressed',String(muted));
    mixerVoiceButtons[voice].setAttribute('aria-pressed',String(!muted));
    audio?.pcm.port.postMessage({voiceMutes});syncSongMutes();
  },
};
function showBusy(value) {
  $('busy').value = hex(value);
  $('hitPad').dataset.sounding=String(Boolean(value & 8));
  $('hitPad').textContent='Hit · Voice 4'+(value & 8 ? ' ●' : '');
  document.querySelectorAll('.lamp').forEach((lamp,i) => {
    const active = Boolean(value & (1<<i));
    lamp.textContent = 'Voice '+(i+1)+(active?' ●':' ○');
    lamp.classList.toggle('on',active);
  });
}
function updateSampleView() {
  displaySample($('sampleWave'),$('sampleRange'),sampleRom,Number($('sample').value));
}
$('sample').onchange = updateSampleView;
function chooseSamples(names) {
  $('hitPad').disabled=names[3]!=='Arcade hit';
  $('sample').replaceChildren(...names.map((name,i) => new Option(i+' · '+name,i)));
  updateSampleView();
}
chooseSamples(samples);
$('hitPad').onclick=()=>{
  oki.play(3,3,2);startAudio().catch(fail);
};
for (let i=0;i<4;i++) {
  const row = document.createElement('div'); row.className = 'bar';
  const lamp = document.createElement('output'); lamp.className = 'lamp';
  const play = document.createElement('button'); play.textContent = 'Play';
  play.onclick = () => {try {
    const sample = Number($('sample').value), attenuation = $('attenuation').valueAsNumber;
    oki.play(i,sample,attenuation); startAudio().catch(fail);
  } catch (error) {fail(error);}};
  const stop = document.createElement('button'); stop.textContent = 'Stop'; stop.onclick = () => oki.stop(i);
  const mute = document.createElement('button');
  mute.textContent = 'Mute'; mute.setAttribute('aria-label','Mute Voice '+(i+1));
  mute.setAttribute('aria-pressed','false');
  mute.onclick = () => oki.setVoiceMuted(i,!voiceMutes[i]);
  muteButtons.push(mute);
  row.append(lamp,play,stop,mute); $('voices').append(row);
}
function toggleButton(text,label,pressed,click) {
  const button = document.createElement('button');
  button.textContent=text; button.setAttribute('aria-label',label);
  button.setAttribute('aria-pressed',String(pressed)); button.onclick=click;
  return button;
}
for (const [id,name,mutes] of [['fm','YM2151',fmMutes],['pcm','MSM6295',voiceMutes]]) {
  const group = document.createElement('fieldset'), legend = document.createElement('legend');
  legend.textContent=name;
  const row = document.createElement('div'), channels = document.createElement('div');
  row.className=channels.className='bar';
  const source = mix[id], slider=document.createElement('input'), value=document.createElement('output');
  Object.assign(slider,{type:'range',min:'0',max:'380',value:'100'});
  slider.setAttribute('aria-label',name+' volume'); value.value='100%';
  function apply() {
    if (audio) audio.buses[id].gain.setTargetAtTime(gainFor(source),context.currentTime,.01);
  }
  slider.oninput=()=>{source.level=Number(slider.value);value.value=slider.value+'%';apply();};
  const mute=toggleButton('Mute','Mute '+name,false,()=>{
    source.muted=!source.muted; mute.setAttribute('aria-pressed',String(source.muted));apply();
  });
  row.append(slider,value,mute);
  mutes.forEach((_,i)=>{
    const label=(id==='fm'?'CH':'Voice ')+(i+1);
    const button=toggleButton(label,name+' '+label+' on',true,()=>{
      if (id==='pcm') return oki.setVoiceMuted(i,!mutes[i]);
      mutes[i]=!mutes[i];syncSongMutes();
      button.setAttribute('aria-pressed',String(!mutes[i]));
      const register=0x20+i;
      audio?.fm.port.postMessage({method:'writeRegister',args:audibleRegister(register,inspector.read().registers[register])});
    });
    if (id==='pcm') mixerVoiceButtons.push(button);
    channels.append(button);
  });
  group.append(legend,row,channels); $('mixer').append(group);
}
showBusy(0xf0);
let romRevision = 0;
function installRom(bytes,names,label) {
  romRevision++; sampleRom = bytes; rawOki = [];
  audio?.pcm.port.postMessage({rom:bytes}); audio?.pcm.port.postMessage({voiceMutes}); chooseSamples(names); $('romName').textContent = label;
}
$('rom').onchange = async () => {
  const file = $('rom').files[0], revision = ++romRevision;
  if (!file) return;
  try {
    if (file.size < 8 || file.size > 0x40000) throw Error('Choose a single MSM6295 ROM bank (8 bytes to 256 KiB).');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (revision === romRevision) files.addBank(bytes,Array(128).fill('ROM sample'),file.name);
  } catch (error) {fail(error);}
};
$('restore').onclick = () => {romRevision++; $('rom').value=''; files.restoreKit();};

function syncKeyChannels() {
  const target=autoChannel?-1:panel.getSelectedChannel();
  for (const button of document.querySelectorAll('[data-key-channel],[data-chip-channel]')) {
    const ch=Number(button.dataset.keyChannel ?? button.dataset.chipChannel);
    button.setAttribute('aria-pressed',String(ch===target));
  }
}
function channelButton(ch) {
  const button=document.createElement('button');
  button.dataset.keyChannel=String(ch);button.textContent=ch<0?'AUTO':'CH'+(ch+1);
  button.onclick=()=>{
    if (ch<0) {autoChannel=true;nextChannel=panel.getSelectedChannel();syncKeyChannels();}
    else panel.selectChannel(ch);
  };
  return button;
}
$('fm').querySelector('.chip-channel-list').prepend(channelButton(-1));
for (let ch=-1;ch<8;ch++) $('keyChannels').append(channelButton(ch));
syncKeyChannels();
const fretboard = createFretboardState();
let layout = createFretboardLayout({state:fretboard});
const octaveControl = createParamControl({label:'Octave',min:-2,max:2,step:1,value:0,showLabel:false,
  formatValue:value => value > 0 ? '+'+value : String(value),
  onChange(octave) {
    layout = createFretboardLayout({state:fretboard,octave});
    // Keep the buttons mounted so held pointers still receive their release.
    for (const button of $('keys').querySelectorAll('.key')) {
      const entry = layout.entries.find(note => note.key === button.dataset.key);
      button.querySelector('span').textContent = entry.noteName;
    }
  },
});
$('keyOctave').append(octaveControl.element);
const held = new Map();
function press(id,entry) {
  if (held.has(id)) return;
  let ch=panel.getSelectedChannel();
  if (autoChannel) {
    const channels=inspector.read().channels;
    const free=Array.from({length:8},(_,i)=>(nextChannel+i)%8).find(i=>!channels[i].active);
    const oldest=autoHeld.entries().next().value;
    if (free===undefined && !oldest) return;
    const target=free ?? oldest[1];
    for (const [owner,used] of autoHeld) if (used===target) autoHeld.delete(owner);
    if (target!==ch) {
      const {algorithm,feedback,pan,ams,pms,operators}=channels[ch];
      inspector.invoke('setVoice',[target,{algorithm,feedback,pan,ams,pms,operators}]);
      keyMasks[target]=keyMasks[ch];
    }
    ch=target;nextChannel=(ch+1)%8;autoHeld.set(id,ch);
  }
  held.set(id,ch); inspector.invoke('auditionOn',[ch,entry.midi,id]); startAudio().catch(fail);
}
function release(id) {
  if (held.has(id)) inspector.invoke('auditionOff',[held.get(id),id]);
  held.delete(id);autoHeld.delete(id);
}
buildKeyboard({root:$('keys'),rowDefs:layout.rowDefs,layoutEntries:layout.entries,showPitch:false,
  onPointerDown:(e,key) => press('pointer'+e.pointerId,layout.entries.find(entry => entry.key === key.key)),
  onPointerUp:e => release('pointer'+e.pointerId),onPointerCancel:e => release('pointer'+e.pointerId)});
window.addEventListener('keydown',e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('textarea,input:not([type=range]),select,[contenteditable=true]')) return;
  const entry = layout.entries.find(v => v.key === e.key.toLowerCase());
  if (entry) {e.preventDefault();press(e.code,entry);}
});
window.addEventListener('keyup',e => release(e.code));
window.addEventListener('blur',() => {for (const id of held.keys()) release(id);});

const example = `// OPM channels 0–7, OKI voices 0–3. Sleep is in seconds.
for (const note of ['C3', 'G3', 'Bb3', 'C4']) {
  opm.noteOn(0, note);
  oki.play(0, 0, 2);
  await sleep(0.18);
  opm.keyOff(0);
  oki.play(1, 1, 4);
  await sleep(0.18);
}`;
const entryPath = '/index.js', roundPath = '/examples/round-start.js';
const scripts = new Map([[entryPath,example]]);
const storageKey = path => path === entryPath ? 'cps1.code' : 'cps1.round-start';
for (const path of [entryPath,roundPath]) {
  try {
    const saved = localStorage.getItem(storageKey(path));
    if (saved !== null) scripts.set(path,saved);
  } catch {}
}
let activePath = entryPath, openRequest = 0;
$('editor').value = scripts.get(activePath);
function saveScript(path,text) {
  scripts.set(path,text);
  try {localStorage.setItem(storageKey(path),text);} catch {}
}
$('editor').oninput = () => saveScript(activePath,$('editor').value);
async function roundSource() {
  if (!scripts.has(roundPath)) {
    const response = await fetch(new URL('./examples/round-start.js',import.meta.url));
    if (!response.ok) throw Error('Could not load Round Start ('+response.status+')');
    const source = await response.text();
    if (!scripts.has(roundPath)) scripts.set(roundPath,source);
  }
  return scripts.get(roundPath);
}
async function openScript(path) {
  const request = ++openRequest;
  try {
    if (path === roundPath) await roundSource();
    if (request !== openRequest) return;
    activePath = path; $('codeFile').value = path; $('editor').value = scripts.get(path);
    document.querySelector('[data-tab="code"]').click();
  } catch (error) {if (request === openRequest) {$('codeFile').value=activePath; fail(error);}}
}
$('codeFile').onchange = () => openScript($('codeFile').value);
let songNode, songRequest=0;
let pausedSong=null, sourceChannel=0;
let previewNode, previewGain, selectedOkiVoice=0, sampleBuffer;
function stopPreview() {
  if (previewNode) {
    previewNode.onended=null;previewNode.stop();previewNode.disconnect();previewGain.disconnect();
    previewNode=null;
  }
  $('previewSongSample').textContent='Preview';
}
function showOkiVoice(index) {
  stopPreview();
  selectedOkiVoice=index;
  const {voices,rate}=pausedSong.oki, voice=voices[index];
  for (const [i,button] of Array.from($('songOkiVoices').children).entries()) {
    button.textContent='Voice '+(i+1)+(voices[i].busy?' · Busy':' · Idle');
    button.setAttribute('aria-pressed',String(i===index));
  }
  const info=[];
  if (voice.requestedSample!==undefined) {
    info.push('Last request '+voice.requestedSample+' · Attenuation '+voice.requestedAttenuation);
    if (voice.sample!==undefined && (voice.requestedSample!==voice.sample || voice.requestedAttenuation!==voice.attenuation))
      info.push('Last played '+voice.sample+' · Attenuation '+voice.attenuation);
  } else info.push('No sample requested');
  const canvas=$('songSampleWave');
  sampleBuffer=null;
  if (voice.bytes) {
    const {pcm,min,max}=decodeSongSample(voice,canvas.width);
    sampleBuffer=context.createBuffer(1,pcm.length,context.sampleRate);
    sampleBuffer.copyToChannel(pcm,0);
    drawWave(canvas,min,max);
    info.push((pcm.length/rate).toFixed(3)+' s');
  } else if (voice.requestedSample!==undefined) info.push('No complete sample available');
  canvas.hidden=!sampleBuffer;
  $('previewSongSample').disabled=!sampleBuffer;
  $('songSampleInfo').textContent=info.join(' · ');
}
for (let i=0;i<4;i++) {
  const button=document.createElement('button');
  button.onclick=()=>showOkiVoice(i);
  $('songOkiVoices').append(button);
}
$('previewSongSample').onclick=()=>{
  if (previewNode) {stopPreview();return;}
  if (!pausedSong?.oki || !sampleBuffer) return;
  previewNode=context.createBufferSource();previewGain=context.createGain();
  previewNode.buffer=sampleBuffer;
  previewNode.playbackRate.value=pausedSong.oki.rate/context.sampleRate;
  previewGain.gain.value=voiceMutes[selectedOkiVoice]?0:1;
  previewNode.connect(previewGain).connect(audio.buses.pcm);
  previewNode.onended=()=>{
    previewNode.disconnect();previewGain.disconnect();previewNode=null;
    $('previewSongSample').textContent='Preview';
  };
  $('previewSongSample').textContent='Stop preview';
  previewNode.start();
};
const songChannels=$('songChannels');
for (let ch=0;ch<8;ch++) {
  const button=document.createElement('button');
  button.textContent='CH'+(ch+1);
  button.onclick=()=>showSongChannel(ch);
  songChannels.append(button);
  $('songTarget').add(new Option('CH'+(ch+1),ch));
}
function showSongChannel(ch) {
  sourceChannel=ch;
  const voice=pausedSong.channels[ch];
  Array.from(songChannels.children).forEach((button,i)=>{
    button.setAttribute('aria-pressed',String(i===ch));
    button.dataset.sounding=String(pausedSong.channels[i].active);
    button.title=pausedSong.channels[i].active?'Key on':'Key off';
  });
  $('songOperators').replaceChildren();
  voice.operators.forEach((op,i)=>{
    const row=$('songOperators').insertRow();
    row.insertCell().textContent='OP'+(i+1);
    for (const key of ['mul','dt1','dt2','tl','ks','ar','d1r','d2r','d1l','rr','am'])
      row.insertCell().textContent=String(Number(op[key]));
  });
  $('songPatch').textContent='Algorithm '+voice.algorithm+' · Feedback '+voice.feedback+
    ' · OP1–4 TL '+voice.operators.map(op=>op.tl).join(' / ')+
    ' · Key '+(voice.active?'on':'off');
}
$('useSongVoice').onclick=()=>{
  const target=Number($('songTarget').value);
  files.copySongVoice(target,pausedSong.channels[sourceChannel],pausedSong.masks[sourceChannel]);
  panel.selectChannel(target);
  status('Copied VGM CH'+(sourceChannel+1)+' to YM2151 CH'+(target+1));
};
$('pauseSong').onclick=()=>{
  $('pauseSong').disabled=true;
  songNode?.port.postMessage({pause:true});
};
function syncSongMutes() {
  if (previewNode) previewGain.gain.value=voiceMutes[selectedOkiVoice]?0:1;
  songNode?.port.postMessage({fm:fmMutes,pcm:voiceMutes});}
function stopSong() {
  stopPreview();$('songOki').hidden=true;sampleBuffer=null;
  songRequest++;
  if (songNode) {
    songNode.port.onmessage=null;songNode.port.postMessage({stop:true});songNode.disconnect();
    songNode=null;
  }
  if (!$('stopSong').disabled) status('Stopped');
  $('stopSong').disabled=true;
  $('pauseSong').disabled=true;
  $('playSong').disabled=!$('songs').options.length;
  $('playSong').textContent='Play';
  $('songVoice').hidden=true;$('songTime').textContent='';pausedSong=null;
}
async function playSong(song) {
  if (pausedSong && songNode) {
    stopPreview();$('songOki').hidden=true;
    $('playSong').disabled=true;
    songNode.port.postMessage({pause:false});
    return;
  }
  stopRun();
  $('playSong').disabled=true;
  const request=songRequest;
  $('stopSong').disabled=false;
  try {
    await startAudio();
    if (request!==songRequest) return;
    const response=await fetch(new URL('../generated/ym2151_wasm.wasm',import.meta.url));
    if (!response.ok) throw Error('Could not load YM2151.');
    const [wasmBinary]=await Promise.all([response.arrayBuffer(),context.audioWorklet.addModule(new URL('./song-worklet.js',import.meta.url))]);
    if (request!==songRequest) return;
    songNode=new AudioWorkletNode(context,'cps1-song',{numberOfInputs:0,numberOfOutputs:2,outputChannelCount:[2,2],
      processorOptions:{bytes:song.bytes,wasmBinary}});
    songNode.connect(audio.buses.fm,0);songNode.connect(audio.buses.pcm,1);
    syncSongMutes();
    songNode.port.onmessage=({data})=>{
      if (request!==songRequest) return;
      if (data.done) {stopSong();status(data.error ?? 'Finished');return;}
      if (data.ready) {$('pauseSong').disabled=false;return;}
      pausedSong=data.paused?data:null;
      $('songOki').hidden=!data.oki;
      if (data.oki) {
        const voices=data.oki.voices;
        const active=voices.findIndex(v=>v.busy);
        showOkiVoice(active>=0?active:Math.max(0,voices.findIndex(v=>v.requestedSample!==undefined)));
      } else sampleBuffer=null;
      $('songVoice').hidden=!data.channels;
      $('songTime').textContent=data.paused?data.seconds.toFixed(2)+' s':'';
      $('playSong').textContent=data.paused?'Resume':'Play';
      $('playSong').disabled=!data.paused;$('pauseSong').disabled=data.paused;
      if (data.channels) {
        $('songTarget').value=String(panel.getSelectedChannel());
        showSongChannel(Math.max(0,data.channels.findIndex(ch=>ch.active)));
      }
      status((data.paused?'Paused ':'Playing ')+song.name);
    };
    songNode.onprocessorerror=()=>{if (request===songRequest) {stopSong();status('VGM playback failed');}};
    status('Playing '+song.name);
  } catch(error) {if (request===songRequest) {stopSong();fail(error);}}
}
function stopRun() {
  stopSong();
  runId++; worker?.terminate(); worker = null;
  panel.releaseAll(); held.clear();autoHeld.clear();
  for (let ch=0;ch<8;ch++) opm.keyOff(ch);
  write(0x78);
}
$('stop').onclick = () => {stopRun();status('Stopped');};
$('run').onclick = async () => {
  stopRun(); const id = runId;
  try {
    const source = $('editor').value;
    await startAudio(); if (id !== runId) return;
    worker = new Worker(new URL('./code-worker.js',import.meta.url),{type:'module'});
    status('Running');
    worker.onmessage = ({data}) => {
      if (id !== runId) return;
      try {
        if (data.error) throw Error(data.error);
        if (data.done) {worker.terminate();worker=null;status('Finished');return;}
        const api = data.chip === 'opm' ? opm : oki;
        api[data.method](...data.args);
      } catch (error) {stopRun();fail(error);}
    };
    worker.onerror = event => {stopRun();fail(event.message);};
    worker.postMessage(source);
  } catch (error) {stopRun();fail(error);}
};

const files = setupFiles({inspector,panel,keyMasks,openScript,playSong,stopSong,openFiles:()=>setFilesOpen(true),defaultCode:example,defaultBank:{bytes:sampleRom,names:samples,name:'Original kit'},
  applyBank:installRom,getCode:() => scripts.get(entryPath),getRoundSource:roundSource,
  setCode:(value,round) => {
    openRequest++;
    saveScript(entryPath,value);
    if (round !== undefined) saveScript(roundPath,round);
    else {
      scripts.delete(roundPath);
      try {localStorage.removeItem(storageKey(roundPath));} catch {}
    }
    activePath=entryPath; $('codeFile').value=entryPath; $('editor').value=value;
  },stop:() => {stopRun();status('Stopped');}});
