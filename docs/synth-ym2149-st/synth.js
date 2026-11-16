// SPDX-License-Identifier: BSD-3-Clause
import {createAudio} from './audio.js';
import {createDefaultPreset, readPreset} from './preset.js';
import {setupYmCodeHost} from './code_host.js';
import {setupNumberControls} from './controls.js';
import {createYmSongPlayer} from './song_player.js';
import {prepareYmReference,createYmReferenceEngine} from './reference_source.js';
import {setupYmSongPanel} from './song_panel.js';
import {ymSongLiveView,captureYmSongVoice} from './song_live.js';
import {setupSynthMenu} from '../synth/synth_menu.js';
import {createSpuOutputVisualizer} from '../synth-spu/spu_synth_visualizer.js';
import {createFretboardState, createFretboardLayout, renderFretboardControls,
  buildKeyboard, setInstrument, setFretPosition, setStringWindowIndex} from '../synth/synth_keyboard.js';

const $ = id => document.getElementById(id);
let audio = null, opening = null, disposed = false, codeHost = null;
let preset = createDefaultPreset(), target = null, pitch = 0, octave = 0;
let serial = 0, revision = 0, renderFrame = null;
let songPlayer=null,songPanel=null,audition=null;
let songState={playing:false,paused:false,busy:false,liveEnabled:true,liveState:null};
const held = new Map();
const status = (message, error=false) => {
  $('audioStatus').textContent = message; $('audioStatus').dataset.error = String(error);
};
const report = error => {if(error?.name !== 'AbortError') status(error?.message ?? String(error), true);};
const safe = fn => (...args) => {try {Promise.resolve(fn(...args)).catch(report);} catch(error) {report(error);}};
const listen = (id, event, fn) => $(id)?.addEventListener(event, safe(fn));
const numbers = setupNumberControls();
const visualizer = createSpuOutputVisualizer({canvas:$('outputCanvas'),envelopeCanvas:$('envelopeCanvas')});
let visualMode = 'envelope';
const resize = new ResizeObserver(() => {
  const width = Math.max(120,Math.round($('outputCanvas').parentElement.getBoundingClientRect().width));
  for(const id of ['outputCanvas','envelopeCanvas']) $(id).width=width;
  visualizer.setMode(visualMode);
});
resize.observe($('outputCanvas').parentElement);

function getSettings() {return readPreset(audition?.original ?? audio?.instrument.getPreset() ?? preset);}
function referenceView() {
  if(target===null||!songState.liveEnabled||!songState.liveState||!songState.playing&&!songState.paused)return null;
  return ymSongLiveView(songState.liveState,target);
}
function restoreAudition() {
  if(!audition)return;
  const old=audition;audition=null;preset=old.original;
  if(audio===old.engine) {
    audio.stop();audio.instrument.applyPreset(old.original);audio.instrument.selectChannel(target);audio.instrument.setPitch(old.pitch);
  }
}
function editView() {
  if(referenceView()){stopKeyboard();target=null;audio?.instrument.selectChannel(null);}
}
function activity() {
  if(disposed) return;
  visualizer.setRunning(Boolean(held.size || songState.playing || codeHost?.isRunning() || audio?.instrument.read().activeChannels.length));
  for(const key of $('keyboard').querySelectorAll('.key'))
    key.classList.toggle('is-active',[...held.values()].some(note=>note.key===key.dataset.key));
}
function render() {
  renderFrame=null;
  if(disposed) return;
  if(audio) {const state=audio.instrument.read(); if(!audition)preset=state.preset; target=state.selectedChannel; pitch=state.pitch;}
  const live=referenceView(),shown=live?.preset??preset,voice=shown.voices[target ?? 0];
  $('ymSynthMain').dataset.referenceView=String(Boolean(live));
  for(const id of ['toneEnabled','noiseEnabled','envelopeEnabled','tonePeriod','fixedVolume','noisePeriod','envelopePeriod','envelopeShape','retriggerEnvelope','presetName','savePreset'])$(id).disabled=Boolean(live);
  $('ymSongCapture').disabled=!songState.paused||songState.busy||!live?.canCapture;
  $('ymSongCapture').title=live?.reason||(!songState.paused?'Pause to capture the selected reference channel':'');
  const name=$('presetName');
  if(document.activeElement!==name) name.value=shown.name;
  for(const [id,key] of [['toneEnabled','tone'],['noiseEnabled','noise'],['envelopeEnabled','envelope']]) {
    const node=$(id); node.checked=voice[key];
    node.indeterminate=target===null && shown.voices.some(item=>item[key]!==voice[key]);
  }
  for(const [id,value] of [['tonePeriod',voice.period],['fixedVolume',voice.volume],['noisePeriod',shown.noisePeriod],
    ['envelopePeriod',shown.envelope.period],['envelopeShape',shown.envelope.shape]]) $(id).value=String(value);
  for(const [id,key] of [['tonePeriod','period'],['fixedVolume','volume']]) {
    const mixed=target===null && preset.voices.some(item=>item[key]!==voice[key]);
    $(id).parentElement.dataset.mixed=String(mixed);
    $(id+'Display')?.setAttribute('aria-description',mixed?'Channels differ. An edit applies to all three.':'');
  }
  $('voiceFrequency').textContent=`${((live?.clock??2000000)/(16*Math.max(1,voice.period))).toFixed(2)} Hz`;
  $('channelStatus').textContent=live
    ? `${songState.paused?'Paused · C4 auditions recorded pitch':'Live · Pause to audition'} · ${live.description}${live.reason?' · '+live.reason:''}`
    : target===null
    ? 'Auto · keyboard uses CH1–CH3 in turn. Edits affect all three; selecting Auto keeps their current settings.'
    : `CH${target+1} · display, controls and keyboard address this physical voice.`;
  for(const button of document.querySelectorAll('[data-channel]')) {
    const selected=button.dataset.channel===(target===null?'auto':String(target));
    button.setAttribute('aria-selected',String(selected)); button.tabIndex=selected?0:-1;
    const channel=Number(button.dataset.channel);
    button.classList.toggle('is-playing',Number.isInteger(channel) && Boolean((live?.activeChannels??audio?.instrument.read().activeChannels)?.includes(channel)));
  }
  for(const [range,label] of [['pitchBendTop','pitchBendTopValue'],['pitchBend','pitchBendValue']]) {
    $(range).value=String(pitch); $(label).textContent=(pitch>=0?'+':'')+pitch.toFixed(2);
  }
  numbers.refresh(); activity();
}
function requestRender() {if(!disposed && renderFrame===null) renderFrame=requestAnimationFrame(render);}
async function ensureAudio() {
  if(disposed) throw new DOMException('Synth closed','AbortError');
  if(audio && audio.context.state!=='closed') {await audio.resume(); return audio;}
  if(opening) return opening;
  const initial=readPreset(preset), generation=revision;
  opening=(async()=>{
    let created=null;
    created=await createAudio({volume:Number($('masterVolume').value),preset:initial,onError(error) {
      if(created && audio===created) {
        audio=null; held.clear(); visualizer.disconnect();
        audition=null;songPlayer?.stop();
        $('enableAudio').textContent='Enable audio'; requestRender();
        void codeHost?.stop().catch(()=>{});
      }
      report(error);
    },
      onChange() {if(audio===created && created) requestRender();}});
    if(disposed) {await created.dispose(); throw new DOMException('Synth closed','AbortError');}
    audio=created;
    if(generation!==revision) created.instrument.applyPreset(preset);
    created.instrument.selectChannel(target); created.instrument.setPitch(pitch);
    created.setVolume(Number($('masterVolume').value));
    created.setChipVolume(Number($('chipVolume').value));
    visualizer.connect(created.context,created.outputNode);
    $('enableAudio').textContent='Audio ready';
    status('Audio ready · YM2149 at 2 MHz'); render();
    return created;
  })().finally(()=>{opening=null;});
  return opening;
}
function changed() {revision++; codeHost?.markSoundDirty(); render();}
function applySettings(value) {
  const next=readPreset(value);
  restoreAudition();editView();
  preset=next;
  audio?.instrument.applyPreset(next);
  changed();
}
function editVoice(patch) {
  if(referenceView())return;
  if(audio) audio.instrument.setVoice(patch);
  else {for(let i=0;i<3;i++) if(target===null || i===target) Object.assign(preset.voices[i],patch);}
  changed();
}
function editShared(kind,value) {
  if(referenceView())return;
  if(kind==='noise') {
    if(audio) audio.instrument.setNoisePeriod(value); else preset.noisePeriod=value;
  } else {
    if(audio) audio.instrument.setEnvelope(value); else Object.assign(preset.envelope,value);
  }
  changed();
}
function stopKeyboard() {
  for(const note of held.values()) if(note.started) audio?.instrument.noteOff(note.id);
  held.clear();restoreAudition();activity();
}
async function stopAll() {
  stopKeyboard();songPlayer?.stop();
  await codeHost?.stop();
  audio?.stop();
  pitch=0; audio?.instrument.setPitch(0);
  render(); status('All sound stopped.');
}
setupSynthMenu({document,window});
listen('enableAudio','click',ensureAudio);
listen('stopSound','click',stopAll);
listen('savePreset','click',()=>codeHost.files.saveSound());
listen('presetName','change',()=>{
  const next=readPreset({...getSettings(),name:$('presetName').value});
  if(audio)audio.instrument.setName(next.name);else preset=next;
  changed();
});
for(const [id,key] of [['toneEnabled','tone'],['noiseEnabled','noise'],['envelopeEnabled','envelope']])
  listen(id,'change',()=>editVoice({[key]:$(id).checked}));
for(const [id,key] of [['tonePeriod','period'],['fixedVolume','volume']])
  listen(id,'input',()=>editVoice({[key]:Number($(id).value)}));
listen('noisePeriod','input',()=>editShared('noise',Number($('noisePeriod').value)));
listen('envelopePeriod','input',()=>editShared('envelope',{period:Number($('envelopePeriod').value)}));
listen('envelopeShape','change',()=>editShared('envelope',{shape:Number($('envelopeShape').value)}));
listen('retriggerEnvelope','click',()=>editShared('envelope',{shape:Number($('envelopeShape').value)}));
for(const button of document.querySelectorAll('[data-channel]')) {
  const choose=()=>{
    if(songState.playing||songState.paused)stopKeyboard();
    target=button.dataset.channel==='auto'?null:Number(button.dataset.channel);
    audio?.instrument.selectChannel(target); render();
  };
  button.addEventListener('click',choose);
  button.addEventListener('keydown',event=>{
    const buttons=[...document.querySelectorAll('[data-channel]')],i=buttons.indexOf(button);
    const next=event.key==='ArrowRight'?(i+1)%buttons.length:event.key==='ArrowLeft'?(i+buttons.length-1)%buttons.length:
      event.key==='Home'?0:event.key==='End'?buttons.length-1:-1;
    if(next<0) return;
    event.preventDefault(); event.stopPropagation(); buttons[next].click(); buttons[next].focus();
  });
}
for(const button of document.querySelectorAll('[data-chip-tab]')) button.addEventListener('click',()=>{
  const selected=button.dataset.chipTab;
  for(const tab of document.querySelectorAll('[data-chip-tab]')) {
    const on=tab===button;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;
  }
  $('ymChipPanel').hidden=selected!=='ym2149';$('ymMixerPanel').hidden=selected!=='mixer';
});
for(const button of document.querySelectorAll('[data-visual-mode]')) button.addEventListener('click',()=>{
  visualMode=button.dataset.visualMode;
  for(const tab of document.querySelectorAll('[data-visual-mode]')) tab.setAttribute('aria-pressed',String(tab===button));
  $('outputCanvas').hidden=visualMode==='envelope'; $('envelopeCanvas').hidden=visualMode!=='envelope';
  visualizer.setMode(visualMode);
});
for(const [range,label,set] of [
  ['masterVolume','masterValue',value=>audio?.setVolume(value)],
  ['chipVolume','chipVolumeValue',value=>audio?.setChipVolume(value)]]) {
  const update=()=>{const value=Number($(range).value);$(label).textContent=`${Math.round(value*100)}%`;$(range).dataset.boosted=String(value>1);set(value);};
  listen(range,'input',update); update();
}
function setPitch(value) {pitch=value; audio?.instrument.setPitch(value); render();}
for(const id of ['pitchBendTop','pitchBend']) listen(id,'input',()=>setPitch(Number($(id).value)));
listen('resetPitch','click',()=>setPitch(0));

// Shared compact computer-keyboard/fretboard layout, using MIDI rather than OPN pitch data.
const fret=createFretboardState(), keyboard=document.createElement('div');keyboard.className='keyboard';$('keyboard').append(keyboard);
const tools=Object.fromEntries(['instrument','position','fret','strings','window'].map(name=>{
  const element=document.createElement('div');element.className=`fretboard-${name} toolbar-group`;return [name,element];
}));
const toolbar=document.createElement('div');toolbar.className='fretboard-toolbar';
const summary=document.createElement('div');summary.className='fretboard-row fretboard-summary';summary.append(tools.fret,tools.strings);
const choices=document.createElement('div');choices.className='fretboard-row';choices.append(tools.instrument,tools.position,tools.window);
toolbar.append(summary,choices);$('fretboardControls').append(toolbar);
let layout;
function renderKeyboard() {
  layout=createFretboardLayout({state:fret,octave});
  renderFretboardControls({instrumentRoot:tools.instrument,positionRoot:tools.position,fretDisplayRoot:tools.fret,stringDisplayRoot:tools.strings,stringWindowRoot:tools.window,state:fret,
    onInstrumentChange:value=>{stopKeyboard();setInstrument(fret,value);renderKeyboard();},
    onPositionPresetSelect:value=>{stopKeyboard();setFretPosition(fret,value);renderKeyboard();},
    onStringWindowChange:value=>{stopKeyboard();setStringWindowIndex(fret,value);renderKeyboard();}});
  buildKeyboard({root:keyboard,rowDefs:layout.rowDefs,layoutEntries:layout.entries,showPitch:false,
    onPointerDown:(event,entry)=>{if(event.button===0) press(`pointer:${event.pointerId}`,entry);},
    onPointerUp:event=>release(`pointer:${event.pointerId}`),onPointerCancel:event=>release(`pointer:${event.pointerId}`)});
  $('octaveLabel').textContent=`Octave ${octave>=0?'+':''}${octave}`;
  $('octaveDown').disabled=octave<=-2;$('octaveUp').disabled=octave>=2;
}
function press(source,entry) {
  if(disposed || held.has(source)||songState.busy) return;
  const view=referenceView();
  if(view&&songState.playing){status('Pause the reference song to audition the selected channel.');return;}
  if(view&&!view.canAudition){status(view.reason);return;}
  const snapshot=view?songState.liveState:null,frame=songState.positionFrames,channel=target;
  const note={id:`ym-key:${++serial}`,midi:entry.midi,key:entry.key,started:false}; held.set(source,note); activity();
  void ensureAudio().then(engine=>{
    if(disposed || held.get(source)!==note) return;
    let midi=note.midi;
    if(view) {
      if(!songState.paused||songState.positionFrames!==frame||target!==channel){held.delete(source);activity();return;}
      const recordedMidi=69+12*Math.log2(view.frequency/440);
      if(view.preset.voices[channel].tone&&(recordedMidi+note.midi-60<0||recordedMidi+note.midi-60>127))throw new Error('Recorded pitch is outside the keyboard audition range. Capture it to inspect the raw period.');
      if(!audition) {
        const original=getSettings();audition={original,pitch,engine,frame};
        engine.stop();engine.instrument.applyPreset(captureYmSongVoice(snapshot,channel));engine.instrument.selectChannel(channel);
      }
      if(view.preset.voices[channel].tone)midi=recordedMidi+note.midi-60;
    }
    engine.instrument.noteOn(note.id,midi); note.started=true; activity();
  }).catch(error=>{if(held.get(source)===note)held.delete(source);report(error);activity();});
}
function release(source) {
  const note=held.get(source);if(!note)return;
  held.delete(source); if(note.started)audio?.instrument.noteOff(note.id);if(!held.size)restoreAudition(); activity();
}
const inputBlocked=event=>Boolean(event.metaKey||event.ctrlKey||event.altKey||event.target?.closest(
  'input:not([type="hidden"]),textarea,select,[contenteditable="true"],.monaco-editor,[role="dialog"],.synth-menu-panel'));
window.addEventListener('keydown',event=>{
  if(event.repeat || inputBlocked(event))return;
  const entry=layout?.entries.find(item=>item.key===event.key.toLowerCase());
  if(entry){event.preventDefault();press(`key:${event.code}`,entry);}
});
window.addEventListener('keyup',event=>release(`key:${event.code}`));
window.addEventListener('blur',stopKeyboard);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopKeyboard();});
for(const [id,delta] of [['octaveDown',-1],['octaveUp',1]]) listen(id,'click',()=>{
  stopKeyboard();octave=Math.max(-2,Math.min(2,octave+delta));renderKeyboard();
});
// Pointer use of hardware controls returns focus to performance; text entry stays editable.
document.addEventListener('pointerdown',event=>{
  const node=event.target.closest('select,input[type="range"],input[type="checkbox"],button');
  if(node && !node.closest('#synthCodePanel,[role="dialog"],#ymFilesPanel,.synth-menu-panel')) document.activeElement?.blur();
});
document.addEventListener('change',event=>{if(event.target.matches('select,input[type="checkbox"]'))event.target.blur();});
document.addEventListener('pointerup',event=>{if(event.target.matches('input[type="range"]'))event.target.blur();});

codeHost=setupYmCodeHost({ensureAudio,getAudio:()=>audio,getSettings,applySettings,stopKeyboard,
  stopSong:()=>{stopKeyboard();songPlayer?.stop();},onActivity:requestRender,setStatus:status});
songPlayer=createYmSongPlayer({getAudio:()=>audio,prepareSource:prepareYmReference,createEngine:createYmReferenceEngine,
  beforePlay:async()=>{
    stopKeyboard();await codeHost.stop();await ensureAudio();audio.stop();
    if(target===null){target=0;audio.instrument.selectChannel(target);}
  },
  onState(state) {
    songState=state;
    if(audition&&(!state.paused||state.busy||state.positionFrames!==audition.frame||!state.liveEnabled))stopKeyboard();
    songPanel?.update(state);requestRender();
  },onStatus:status});
songPanel=setupYmSongPanel({project:codeHost.project,files:codeHost.files,player:songPlayer,onStatus:status});
listen('ymSongCapture','click',async()=>{
  const view=referenceView();if(!songState.paused||songState.busy||!view?.canCapture)return;
  const frame=songState.positionFrames,channel=target;
  const sound=captureYmSongVoice(songState.liveState,channel,{name:`${songState.metadata?.title||songState.name} CH${channel+1}`});
  let applied=false;
  await codeHost.files.saveCapturedSound(sound,{
    isCurrent:()=>!disposed&&songState.paused&&!songState.busy&&songState.positionFrames===frame&&(applied||target===channel),
    apply(next,{isCurrent}) {if(!isCurrent())return false;applied=true;applySettings(next);return true;},
  });render();
});
void codeHost.ready.catch(report);
renderKeyboard();render();
window.addEventListener('pagehide',()=>{
  disposed=true;stopKeyboard();songPanel.dispose();songPlayer.dispose();resize.disconnect();visualizer.dispose();numbers.dispose();
  if(renderFrame!==null)cancelAnimationFrame(renderFrame);
  void codeHost.dispose().finally(()=>audio?.dispose()).catch(()=>{});
},{once:true});
// Read-only host diagnostics also make source examples easy to inspect.
window.tetoricaYm2149StSynth=Object.freeze({getSettings,getState:()=>audio?.instrument.read()??{preset:getSettings(),selectedChannel:target,pitch,activeChannels:[],revision},
  getCodeState:()=>codeHost.getState(),getSongState:()=>songPlayer.read()});
