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
import {displaySample,inspectBank} from './sample-view.js';
import {createSynthProjectStore} from '../synth/synth_project_store.js';
import {setupFiles} from './files.js';
import {createKit,samples} from './kit.js';

const $ = id => document.getElementById(id);
const example = `// OPM channels 0–7, OKI voices 0–3. Sleep is in seconds.
for (const note of ['C3', 'G3', 'Bb3', 'C4']) {
  opm.noteOn(0, note);
  oki.play(0, 0, 2);
  await sleep(0.18);
  opm.keyOff(0);
  oki.play(1, 1, 4);
  await sleep(0.18);
}`;
const defaults=new Map([['/index.js',example]]);
for(const option of Array.from($('codeFile').options).slice(1)){
  const response=await fetch(new URL('.'+option.value,import.meta.url));
  if(!response.ok)throw Error('Could not load '+option.value);
  defaults.set(option.value,await response.text());
}
let initialCode=new Map(defaults);
try{
  const saved=localStorage.getItem('cps1.scripts.v2');
  if(saved){
    const code=new Map(JSON.parse(saved));
    if(code.has('/index.js')&&[...code].every(([p,v])=>/^\/.*\.m?js$/i.test(p)&&typeof v==='string'))initialCode=code;
  }else for(const path of defaults.keys()){
    const key=path==='/index.js'?'cps1.code':'cps1.'+path.split('/').pop().replace(/\.js$/,'');
    const text=localStorage.getItem(key);if(text!==null)initialCode.set(path,text);
  }
}catch{}
const store=createSynthProjectStore({name:'tetorica-cps1-synth-files'});
const draft=await store.read().catch(()=>null);
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
let observation=null;
let voicePage='Voice';
const autoHeld=new Map();
function editVoice(method,args) {
  if(observation){
    if(!observation.fm || !method.startsWith('set'))return;
    observation.fm.invoke(method,args);
    songNode.port.postMessage({fmEdit:{method,args}});
    dirty=true;return;
  }
  const result=inspector.invoke(method,args);
  if (['setVoice','setOperator'].includes(method)) files.recordEdit(args[0]);
  if (autoChannel && ['setVoice','setOperator'].includes(method)) {
    for (const ch of new Set(autoHeld.values())) if (ch!==args[0]) inspector.invoke(method,[ch,...args.slice(1)]);
  }
  return result;
}
const panel = createPlaygroundYm2151VoicePanel({root:$('fm'),arrangeSections:sections=>arrangeVoiceSections(sections,{
  read:()=>(observation?.masks ?? keyMasks)[panel.getSelectedChannel()],
  toggle(bit) {
    const ch=panel.getSelectedChannel();
    if(observation){
      if(observation.fm){
        observation.masks[ch]^=bit;
        songNode.port.postMessage({keyMask:[ch,observation.masks[ch]]});
      }
      return;
    }
    keyMasks[ch]^=bit;
    files.recordEdit(ch);
  },
},(ch,op,patch)=>editVoice('setOperator',[ch,op,patch]),page=>{
  voicePage=page;
  syncKeyChannels();
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
      pcm.port.onmessage = ({data}) => {
        if(observation)return;
        if(data.commands){if(worker)$('command').value=data.commands.map(hex).join(' ');}
        else showBusy(data.status,data.samples);
      };
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
const visualModes=document.querySelectorAll('[data-visual-mode]');
for (const button of visualModes) button.onclick=()=>{
  mode=button.dataset.visualMode;
  for (const item of visualModes) item.setAttribute('aria-pressed',String(item===button));
  $('scope').setAttribute('aria-label','Output '+mode);
};
const canvas = $('scope'), ctx = canvas.getContext('2d');
new ResizeObserver(([entry]) => {
  canvas.width = Math.max(1,Math.round(entry.contentRect.width));
  canvas.height = Math.max(1,Math.round(entry.contentRect.height));
}).observe(canvas);
function draw() {
  if (dirty && (!observation || !$('fm').hidden)) {
    const source=observation ? observation.fm ?? observation.idleFm : inspector;
    if (source) panel.update(source.read());
    syncKeyChannels();dirty=false;
  }
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
let codeView = 'code', lastCodeChip='fm';
let pcmKeyboard=false;
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
  pcmKeyboard=!$('pcm').hidden || (!synth && codeView==='keyboardPanel' && lastCodeChip==='pcm');
  $('keyboardPanel').classList.toggle('pcm-keys',pcmKeyboard);
  $('pcmKeysHint').hidden=!pcmKeyboard;
  $('keyChannels').hidden=$('keyOctave').hidden=pcmKeyboard;
  panel.setVisible(!$('fm').hidden);
  syncKeyChannels();
}
function changeMode(mode) {
  if (mode === 'synth') synthView.performance = 'keyboardPanel';
  if (main.dataset.mode === mode) {renderWorkspace();return;}
  main.dataset.mode = mode;
  const codeTab = tabs.find(tab=>tab.dataset.tab==='code');
  const keyboardTab = tabs.find(tab=>tab.dataset.tab==='keyboardPanel');
  if (mode === 'code') {
    setFilesOpen(true);
    $('sourceTabs').prepend(codeTab);
    $('sourceTabs').append(keyboardTab);
    lastCodeChip=synthView.source;
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
  if (main.dataset.mode === 'code') {
    codeView=id;
    if (id==='pcm' || id==='fm') lastCodeChip=id;
  }
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
let writingCode=false;
function write(...bytes) {
  bytes.forEach(b => limit(b,255,'Command'));
  if (audio) audio.pcm.port.postMessage({commands:bytes,code:writingCode}); else rawOki.push(...bytes);
  if(!writingCode)$('command').value = bytes.map(hex).join(' ');
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
function showBusy(value,ids=[]) {
  let playing=0;
  $('busy').value = hex(value);
  $('hitPad').dataset.sounding=String(Boolean(value & 8));
  $('hitPad').textContent='Hit · Voice 4'+(value & 8 ? ' ●' : '');
  document.querySelectorAll('.lamp').forEach((lamp,i) => {
    const active = Boolean(value & (1<<i));
    if(active)playing++;
    const sample=ids[i],name=sample==null?'':slotName(sample);
    lamp.title='Voice '+(i+1)+(name?' · '+(active?'Playing ':'Last ')+name:'');
    lamp.classList.toggle('on',active);
  });
  $('voiceCount').textContent=playing+' / 4 voices playing';
}
let sampleNames=[],selectedSlot=0;
const voicePickers=[],voiceIds=[];
let nextSampleVoice=0;
function slotName(id){return !observation && sampleNames[id]?id+' · '+sampleNames[id]:String(id);}
function voiceSample(voice){return voiceIds[voice]<0?selectedSlot:voiceIds[voice];}
let sampleAttenuation=2;
let codeSamples=[];
function syncCodeSamples(){
  audio?.pcm.port.postMessage({codeSamples:Array.from(codeSamples,id=>id===-1?selectedSlot:id)});
}
const attenuationControl=createParamControl({label:'Attenuation',min:0,max:15,step:1,value:sampleAttenuation,
  onChange:value=>{
    if(observation)setSongAttenuation(value);
    else {
      sampleAttenuation=value;
      if(worker){audio.pcm.port.postMessage({codeAttenuation:value});}
    }
  },
});
$('attenuation').append(attenuationControl.element);
function setSongAttenuation(value){
  observation.attenuation=value;
  songNode.port.postMessage({attenuation:value});
  $('followAttenuation').hidden=value==null;
  attenuationControl.updateVisual(value??observation.oki?.sourceAttenuation??0);
}
$('followAttenuation').onclick=()=>setSongAttenuation(null);
const slotControl=createParamControl({label:'Sample slot',min:0,max:127,step:1,value:0,onChange:selectSlot});
$('slotControl').append(slotControl.element);
const slotButtons=Array.from({length:128},(_,id)=>{
  const button=document.createElement('button');
  button.textContent=id;button.setAttribute('aria-pressed','false');button.onclick=()=>selectSlot(id);
  $('sampleSlots').append(button);return button;
});
function selectSlot(id){
  slotButtons[selectedSlot].setAttribute('aria-pressed','false');
  selectedSlot=id;
  slotButtons[id].setAttribute('aria-pressed','true');
  slotControl.updateVisual(id);
  const filled=slotButtons[id].dataset.filled==='true';
  $('deleteSlot').disabled=!filled;
  $('selectedSample').textContent=filled?slotName(id):id+' · Empty';
  displaySample($('sampleWave'),$('sampleRange'),observation ? observation.rom : sampleRom,id,observation?.rate);
  if(observation){stopPreview();syncPreview();syncSongAssignments();}
  else if(worker && codeSamples.includes(-1))syncCodeSamples();
}
$('deleteSlot').onclick=()=>{try{files.deleteSample(selectedSlot);}catch(error){fail(error);}};
$('writeSlot').onclick=()=>$('slotAudio').click();
$('slotAudio').onchange=async()=>{
  const input=$('slotAudio'),file=input.files[0];input.value='';
  if(file)try {await files.loadSampleFile(file,selectedSlot);} catch(error){fail(error);}
};
function showSlots(rom,selected,rate=1000000/132) {
  const {ids,usedBytes}=inspectBank(rom);
  const occupied=new Set(ids);
  for(const [id,button] of slotButtons.entries()){
    button.dataset.filled=String(occupied.has(id));
    button.title=occupied.has(id)?slotName(id):id+' · Empty';
    button.setAttribute('aria-label',button.title);
  }
  $('bankInfo').textContent=ids.length+' / 128 samples · ROM '+usedBytes.toLocaleString('en-US')+' / 262,144 bytes · '+(rate/1000).toFixed(2)+' kHz';
  selectSlot(selected);
}
function chooseSamples(names,assignments=[],selected=0) {
  sampleNames=names;showSlots(sampleRom,selected);
  $('hitPad').disabled=names[3]!=='Arcade hit';
  for(const [voice,picker] of voicePickers.entries()){
    voiceIds[voice]=assignments[voice]??-1;
    picker.updateVisual(voiceIds[voice]);
  }
}
$('hitPad').onclick=()=>{
  oki.play(3,3,sampleAttenuation);startAudio().catch(fail);
};
for (let i=0;i<4;i++) {
  const row = document.createElement('div'); row.className = 'bar';
  const lamp=document.createElement('button');
  lamp.className='lamp';lamp.textContent='Voice '+(i+1);
  lamp.setAttribute('aria-label','Mute Voice '+(i+1));lamp.setAttribute('aria-pressed','false');
  lamp.onclick=()=>oki.setVoiceMuted(i,!voiceMutes[i]);muteButtons.push(lamp);
  const picker=createParamControl({label:'Voice '+(i+1)+' sample',min:-1,max:127,step:1,value:0,showLabel:false,
    formatValue:id=>id<0?'Follow':String(id),onChange:id=>{
      if(observation){
        observation.assignments[i]=id;
        syncSongAssignments();
      }else {files.assignSample(i,id);voiceIds[i]=id;
        if(worker){codeSamples[i]=id;syncCodeSamples();}}
    },
  });
  voicePickers.push(picker);
  row.append(lamp,picker.element);$('voices').append(row);
}
chooseSamples(samples,[0,1,2,3]);
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
let romRevision = 0, synthRomLabel=$('romName').textContent;
function installRom(bytes,names,label,assignments,extended=false,slot=null) {
  if(!extended)nextSampleVoice=0;
  synthRomLabel=label;
  romRevision++; sampleRom = bytes; rawOki = [];
  audio?.pcm.port.postMessage({rom:bytes,extended}); audio?.pcm.port.postMessage({voiceMutes}); chooseSamples(names,assignments,slot??(extended?selectedSlot:0)); $('romName').textContent = label;
}
$('importRom').onclick=()=>$('rom').click();
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

function keyboardChannel() {
  if (autoChannel && voicePage==='Noise' && !$('fm').hidden && !observation) return 7;
  return autoChannel?-1:panel.getSelectedChannel();
}
function syncKeyChannels() {
  const target=autoChannel?-1:panel.getSelectedChannel();
  const showNoise=target===-1 || target===7;
  const noiseTab=$('fm').querySelector('[data-voice-page="Noise"]');
  noiseTab.hidden=!showNoise;
  if (!showNoise && voicePage==='Noise') {
    $('fm').querySelector('[data-voice-page="Voice"]').click();
    return;
  }
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
  if (observation || held.has(id)) return;
  if (pcmKeyboard) {
    try {
      const voice=nextSampleVoice;
      oki.stop(voice);
      oki.play(voice,voiceSample(voice),sampleAttenuation);
      nextSampleVoice=(voice+1)%4;
      startAudio().catch(fail);
    } catch (error) {fail(error);}
    return;
  }
  let ch=keyboardChannel();
  if (ch<0) {
    ch=panel.getSelectedChannel();
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
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('textarea,input:not([type=range]),select,[contenteditable=true]')) return;
  const entry = layout.entries.find(v => v.key === e.key.toLowerCase());
  if (entry) {e.preventDefault();press(e.code,entry);}
});
window.addEventListener('keyup',e => release(e.code));
window.addEventListener('blur',() => {for (const id of held.keys()) release(id);});

let songNode, songRequest=0;
let pausedSong=null;
let previewNode, previewGain, selectedOkiVoice=0, sampleBuffer;
function stopPreview() {
  if (previewNode) {
    previewNode.onended=null;previewNode.stop();previewNode.disconnect();previewGain.disconnect();
    previewNode=null;
  }
  $('previewSongSample').textContent='Preview';
}
function syncPreview(){
  const index=pausedSong?.oki?.voices.findIndex(v=>v.sample===selectedSlot && v.bytes);
  selectedOkiVoice=index>=0?index:0;
  $('previewSongSample').hidden=!(index>=0);
}
const emptyRom=new Uint8Array();
function syncSongAssignments(){
  if(!observation.assignments.some(id=>id!=null))return;
  songNode?.port.postMessage({samples:observation.assignments.map(id=>id===-1?selectedSlot:id)});
  $('followVoices').hidden=false;
}
$('followVoices').onclick=()=>{
  observation.assignments.fill(null);
  songNode.port.postMessage({samples:observation.assignments});
  $('followVoices').hidden=true;
  showSongPcm(observation.song,observation.oki);
};
function showSongPcm(song,state){
  const bank=!state?.nmk && song.banks.find(b=>b.index===state?.bank);
  const rom=bank?.bytes ?? emptyRom;
  if(observation.rom!==rom || observation.rate!==state?.rate){
    observation.rom=rom;observation.rate=state?.rate;
    const path=song.bankPaths?.[bank?.index];
    const label=path?.split('/').pop() ?? (state?'No standalone ROM':'No MSM6295 in this VGM');
    $('romName').textContent=label;
    const list=$('romList');
    list.querySelector('[data-song-bank]')?.remove();
    if(!path || !Array.from(list.options).some(o=>o.value===path)){
      const option=new Option(label,'');option.dataset.songBank='';list.add(option);option.selected=true;
    }else list.value=path;
    showSlots(rom,selectedSlot,state?.rate);
  }
  const voices=state?.voices ?? [];
  const ids=voices.map(v=>v.sample ?? v.requestedSample);
  voicePickers.forEach((picker,i)=>picker.updateVisual(observation.assignments[i]??ids[i]??-1));
  const busy=voices.reduce((v,ch,i)=>v|(Number(ch.busy)<<i),0xf0);
  showBusy(busy,ids);
  $('command').value=state?.command==null?'—':hex(state.command);
  attenuationControl.updateVisual(observation.attenuation??state?.sourceAttenuation??0);
  voices.forEach((voice,i)=>{
    const detail=voice.requestedSample==null?'No request':'Last request '+voice.requestedSample+' · Attenuation '+voice.requestedAttenuation;
    muteButtons[i].title+=' · '+detail;
  });
  syncPreview();
}
$('previewSongSample').onclick=()=>{
  if (previewNode) {stopPreview();return;}
  const voice=pausedSong?.oki?.voices[selectedOkiVoice];
  if(!voice?.bytes)return;
  const {pcm}=decodeSongSample({...voice,attenuation:observation.attenuation??voice.attenuation},1);
  sampleBuffer=context.createBuffer(1,pcm.length,context.sampleRate);
  sampleBuffer.copyToChannel(pcm,0);
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
for (let ch=0;ch<8;ch++) $('songTarget').add(new Option('CH'+(ch+1),ch));
$('useSongVoice').onclick=()=>{
  const target=Number($('songTarget').value), ch=panel.getSelectedChannel();
  observation.copied.add(target);
  files.copySongVoice(target,observation.fm.read().channels[ch],observation.masks[ch]);
  status('Copied VGM CH'+(ch+1)+' to YM2151 CH'+(target+1));
};
function setSongView(active) {
  for(const node of $('pcmEditor').querySelectorAll('#romList,#importRom,#writeSlot,#deleteSlot,#chooseSamples,#restore'))node.inert=active;
  for(const picker of voicePickers)picker.element.inert=active && !observation?.oki;
  $('attenuation').inert=active && !observation?.oki;
  $('followAttenuation').hidden=true;
  $('followVoices').hidden=true;
  $('keyboardPanel').inert=active;
  for(const node of $('fm').querySelectorAll('.param-control,table button,input,.opm-envelope-editor canvas'))node.inert=active && !observation?.fm;
  for(const node of $('fm').querySelectorAll('.voice-tools > button:nth-of-type(2),[data-key-channel="-1"]'))node.inert=active;
  dirty=true;
}
$('pauseSong').onclick=()=>{
  $('pauseSong').disabled=true;
  songNode?.port.postMessage({pause:true});
};
function syncSongMutes() {
  if (previewNode) previewGain.gain.value=voiceMutes[selectedOkiVoice]?0:1;
  songNode?.port.postMessage({fm:fmMutes,pcm:voiceMutes});}
function stopSong(keepSettings=false) {
  stopPreview();$('previewSongSample').hidden=true;sampleBuffer=null;
  if (observation) {
    const state=observation, currentSlot=selectedSlot;
    const keep=keepSettings===true;
    const {channel,auto,slot,bankPath,command}=state;
    observation=null;
    $('romList').querySelector('[data-song-bank]')?.remove();
    const pcm=keep && state.oki;
    const bankKept=pcm && !pcm.nmk && files.keepSongBank(state.bankPaths[pcm.bank],state.rom,
      pcm.voices.map((v,i)=>state.assignments[i]??v.sample??v.requestedSample??-1));
    if(bankKept)selectSlot(currentSlot);
    else {
      $('romList').value=bankPath;
      $('romName').textContent=synthRomLabel;
      chooseSamples(sampleNames,[...voiceIds],slot);
    }
    if(pcm)sampleAttenuation=state.attenuation??pcm.sourceAttenuation??sampleAttenuation;
    attenuationControl.updateVisual(sampleAttenuation);showBusy(0xf0);
    if(!pcm)$('command').value=command;
    if(keep && state.fm){
      const {channels,lfo,noise}=state.fm.read();
      for(const ch of channels){
        if(state.copied.has(ch.channel))continue;
        files.copySongVoice(ch.channel,ch,state.masks[ch.channel]);
        inspector.invoke('setPitch',[ch.channel,ch.keyCode,ch.keyFraction]);
      }
      inspector.invoke('setLFO',[lfo]);inspector.invoke('setNoise',[noise]);
    }else {panel.selectChannel(channel);autoChannel=auto;}
    if(keep)files.persist();
    setSongView(false);syncKeyChannels();
  }
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
    stopPreview();
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
      if(data.editedFm){Object.assign(observation.fm,data.editedFm);dirty=true;return;}
      if (data.done) {stopSong(!data.error);status(data.error ?? 'Finished');return;}
      if (data.ready) {
        observation={song,assignments:Array(4).fill(null),bankPaths:song.bankPaths,copied:new Set(),channel:panel.getSelectedChannel(),auto:autoChannel,slot:selectedSlot,bankPath:$('romList').value,command:$('command').value,
          idleFm:data.fm ? null : new Ym2151VoiceInspector({}),
          fm:data.fm ? new Ym2151VoiceInspector({clock:data.clock,sampleRate:context.sampleRate,
            dispatch:({args})=>observation.fm.observeWrite(...args)}) : null,oki:data.oki};
        autoChannel=false;
        selectedOkiVoice=0;
        setSongView(true);
      }
      if (!observation) return;
      if(data.masks)observation.masks=data.masks;
      if (data.fm) {Object.assign(observation.fm,data.fm);dirty=true;}
      observation.oki=data.oki;
      if ('paused' in data){
        pausedSong=data.paused?data:null;
      }
      showSongPcm(song,data.oki);
      if (data.ready) {$('pauseSong').disabled=false;return;}
      if (data.playing) return;
      $('songVoice').hidden=!data.paused || !observation.fm;
      if (data.paused) $('songTarget').value=String(observation.channel);
      $('songTime').textContent=data.paused?data.seconds.toFixed(2)+' s':'';
      $('playSong').textContent=data.paused?'Resume':'Play';
      $('playSong').disabled=!data.paused;$('pauseSong').disabled=data.paused;
      status((data.paused?'Paused ':'Playing ')+song.name);
    };
    songNode.onprocessorerror=()=>{if (request===songRequest) {stopSong();status('VGM playback failed');}};
    status('Playing '+song.name);
  } catch(error) {if (request===songRequest) {stopSong();fail(error);}}
}
function stopRun(keepSettings=false) {
  stopSong(keepSettings);
  runId++; worker?.terminate(); worker = null;
  panel.releaseAll(); held.clear();autoHeld.clear();
  for (let ch=0;ch<8;ch++) opm.keyOff(ch);
  write(0x78);
}
$('stop').onclick = () => {stopRun(true);status('Stopped');};
$('run').onclick = async () => {
  stopRun(true); const id = runId;
  try {
    const source = $('editor').value;
    await startAudio(); if (id !== runId) return;
    codeSamples=[];audio.pcm.port.postMessage({codeSamples:[],codeAttenuation:null});
    worker = new Worker(new URL('./code-worker.js',import.meta.url),{type:'module'});
    status('Running');
    worker.onmessage = ({data}) => {
      if (id !== runId) return;
      try {
        if (data.error) throw Error(data.error);
        if(data.editedFm){Object.assign(observation.fm,data.editedFm);dirty=true;return;}
      if (data.done) {worker.terminate();worker=null;status('Finished');return;}
        const api = data.chip === 'opm' ? opm : oki;
        writingCode=true;
        try{api[data.method](...data.args);}finally{writingCode=false;}
      } catch (error) {stopRun();fail(error);}
    };
    worker.onerror = event => {stopRun();fail(event.message);};
    worker.postMessage(source);
  } catch (error) {stopRun();fail(error);}
};

const files = setupFiles({inspector,panel,keyMasks,defaults,initialCode,store,draft,playSong,stopSong,openFiles:()=>setFilesOpen(true),
  defaultBank:{bytes:sampleRom,names:samples,name:'Original kit',voiceSamples:[0,1,2,3]},applyBank:installRom,stop:()=>{stopRun();status('Stopped');}});
$('filesToggle').disabled=false;
