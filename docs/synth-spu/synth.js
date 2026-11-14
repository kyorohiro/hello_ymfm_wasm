// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {createSpuAudio} from './spu_synth_audio.js?v=spu-code-parameters-6';
import {createSpuInstrumentPanel} from './spu_synth_panel.js?v=psf-manual-3';
import {createSpuOutputVisualizer} from './spu_synth_visualizer.js';
import {createFretboardState, createFretboardLayout, renderFretboardControls, buildKeyboard, setInstrument, setFretPosition, setStringWindowIndex} from '../synth/synth_keyboard.js';
import {createOfflineAudioDecoder} from '../js/audio_decode.js';
import {readSpuInstrument, writeSpuInstrument, prepareAudioPcm, MAX_INSTRUMENT_BYTES} from './spu_synth_instrument.js?v=spu-split-vab-1';

import {MAX_AUDIO_FILE_BYTES, prepareHostAudio} from './spu_synth_long_audio.js';
import {MAX_VAB_FILE_BYTES, readVab, prepareVabTone,exportVab} from './spu_synth_vab.js?v=ps1-vab-api-1';
import {PSF_FILES, readPsfFileSet, extractPsfVabs, psfRejectionSummary} from '../playground/playground_ps1_psf.js?v=ps1-vab-api-1';
import {setupSpuCodeHost} from './code_host.js?v=draft-reconnect-1';
import {SPU_PROJECT_FILE_BYTES} from './code_project.js?v=draft-reconnect-1';
import {prepareVabTonePreset,prepareVabBankPresets} from './spu_bank_presets.js?v=ps1-vab-api-1';
import {createSpuCodeLive} from './code_live.js?v=spu-code-1';
import {morphPcm} from './spu_synth_morph.js';
import {createPs1InitSample} from '../js/ps1synth.js?v=ps1-oneshot-marker-1';
import {setupSynthMenu} from '../synth/synth_menu.js';
import {createPsfSongPreview} from './psf_song_preview.js?v=psf-manual-1';
import {setupPsfSeekControls} from './psf_seek_controls.js?v=spu-psf-seek-1';
import {preparePsfSongSource} from './psf_song_source.js?v=spu-psf-playback-1';
import {createPsfPlaybackCore} from './psf_playback_core.js?v=psf-manual-2';
import {preparePsfVoiceCapture} from './psf_capture.js?v=psf-marker-capture-1';
import {createPsfPausedAudition} from './psf_paused_audition.js?v=psf-marker-audition-1';
import {createPsfChannelActivity} from './psf_channel_activity.js?v=psf-synth-view-1';

const $ = id => document.getElementById(id);
const psfChannelActivity=createPsfChannelActivity({element:$('spuPsfChannelActivity'),onSelect:selectLiveVoice});
// Replacing even an unchanged button/label text node can cancel a trusted
// WebKit click between pointerdown and pointerup during Live's 20-Hz updates.
const setText = (id,value) => {const node=$(id);if(node.textContent!==value)node.textContent=value;};
const status = (message, error = false) => { $('audioStatus').textContent = message; $('audioStatus').dataset.error = String(error); };
const sampleStatus = (message, error = false) => {status(message,error);$('sampleLoadStatus').textContent=message;$('sampleLoadStatus').dataset.error=String(error);};
const report = error => {if(error?.name!=='AbortError')status(error?.message ?? String(error), true);};
let audio = null, opening = null, state = null, stateFrame = null, epoch = 0, assetEpoch = 0, octave = 0, bend = 0;
const notes = new Map();
let instrumentName = 'Sine';
let noteSequence = 0, topologyPending = 0, switchingAudioOutput = false;
let codeHost = null, codeLive = null, disposed = false, liveReadOnly = false;
let clickGuardIntent = 0, clickGuardApplied = true;
let psfSong=null;
let psfSeekControls=null;
let psfView='channel';
let psfViewEpoch=0;
let capturePending=null;
let pausedAudition=null,pausedStopFence=Promise.resolve(),pausedStopping=0,pausedEditorAudition=false,psfActionEpoch=0;
const auditionAudioIds=new WeakMap();let auditionAudioSequence=0;
const observedSaveButtons=new Map();
const pausedEditorMethods=new Set(['setInstrumentPreset','setInstrumentEnvelope','setInstrumentWaveform','setInstrumentMorph','setInstrumentSample',
  'setInstrumentNoise','setInstrumentPmon','setInstrumentReverbPreset','setReverb','setInstrumentPitchBend']);
const rmsCanvas = document.createElement('canvas');
rmsCanvas.id = 'outputEnvelopeCanvas'; rmsCanvas.width = 900; rmsCanvas.height = 240;
rmsCanvas.setAttribute('role', 'img'); rmsCanvas.setAttribute('aria-label', 'Measured SPU output RMS history');
const visualizer = createSpuOutputVisualizer({canvas:$('outputCanvas'), envelopeCanvas:rmsCanvas});
const previewActive=()=>Boolean(pausedAudition?.read().active);
const performanceRunning=()=>Boolean(psfSong?.read().playing||codeHost?.isRunning()||previewActive()||(state?.auditions?.length??0)>0);
function pausedSelection() {
  const live=psfSong?.read();
  if(disposed||capturePending||!audio||codeHost?.isRunning()||!live?.paused||live.seeking||psfView!=='channel'||!live.liveEnabled||!live.canCapture)return null;
  if(!auditionAudioIds.has(audio))auditionAudioIds.set(audio,++auditionAudioSequence);
  const referenceNote=$('spuPsfReferenceKey').value;
  return {key:JSON.stringify([auditionAudioIds.get(audio),assetEpoch,live.selection?.entry,live.captureFrame,live.liveVoice,referenceNote]),referenceNote,
    reverb:{preset:state.reverb.preset,volumeLeft:state.reverb.volumeLeft,volumeRight:state.reverb.volumeRight}};
}
function updateHeldStatus() {
  const preview=pausedAudition?.read();
  $('voiceAllocationStatus').textContent=preview?.active?`Paused PSF CH ${(psfSong?.read().liveVoice??0)+1} · temporary audition · ${preview.heldCount} held`:
    playingPsfChannel()?`PSF CH ${psfSong.read().liveVoice+1} · keyboard shares this physical voice · ${[...notes.values()].filter(note=>note.owner==='psf-live').length} held`:
    `${state?.noise?.enabled?'24 voices · Noise · shared clock':state?.pmon?.enabled?'12 notes · paired PMON':'24 voices · round robin'} · ${state?.auditions?.length??0} held`;
}
function releasePsfKeys(){try{return psfSong?.releaseManual();}catch(error){report(error);return false;}}
function stopPausedKeyboard({releaseEdited=false}={}) {
  const preview=pausedAudition?.read(),hadPreview=[...notes.values()].some(note=>note.owner==='psf-preview');
  if(!releaseEdited&&!preview?.active&&!preview?.error&&!hadPreview&&!pausedStopping)return pausedStopFence;
  const hadEdited=pausedEditorAudition||[...notes.values()].some(note=>!['psf-preview','psf-live'].includes(note.owner)),owner=audio;
  if(releaseEdited)releasePsfKeys();
  for(const [source,note]of notes)if(releaseEdited||note.owner==='psf-preview')notes.delete(source);
  if(releaseEdited){epoch++;pausedEditorAudition=false;$('sustainToggle').checked=false;}
  updateKeys();
  // Invalidate preview work synchronously, then serialize restoration before
  // any new owner may issue commands to the authored editor's RAM bank.
  pausedStopping++;
  const restore=preview?.active||preview?.error?pausedAudition.stop():Promise.resolve(),previous=pausedStopFence;
  const next=(async()=>{try{await previous.catch(()=>{});await restore;if(releaseEdited&&hadEdited&&owner===audio&&owner)await owner.stop();}finally{pausedStopping--;}})();
  pausedStopFence=next.catch(()=>{});return next;
}

function updateSampleName(next=state,channel=0,fromCode=false) {
  if(!next)return;
  const sample=next.samples?.find(item=>item.id===next.channels[channel]?.sample);
  const host=next.hostAudio&&(!fromCode||next.hostAudio.sampleId===sample?.id);
  const name=fromCode?`Code CH ${channel+1} · Sample ${sample?.id??'—'}`:instrumentName;
  $('sampleName').textContent=host?`${name} · Software audio · ${next.hostAudio.duration.toFixed(1)} s · ${next.hostAudio.loop?'loop':'one shot'}`:`${name}${sample?` · ${sample.byteLength.toLocaleString()} ADPCM bytes · ${sample.loop?'loop':'one shot'}`:''}`;
}
function applyState(next) {
  state = next;
  visualizer.setRunning(performanceRunning());
  if (stateFrame !== null) return;
  stateFrame = requestAnimationFrame(() => {
    stateFrame = null;
    panel.update(state);
    updateSampleName();
    updateHeldStatus();
    updateCodeDisplay();
  });
}
function psfOwnsLiveView() {
  const song=psfSong?.read();
  return Boolean(song&&(song.playing||song.paused||song.resuming||song.seeking||song.seekPreparing));
}
function psfSeekBusy(){const song=psfSong?.read();return Boolean(song&&(song.seeking||song.seekPreparing));}
function playingPsfChannel() {
  const live=psfSong?.read();
  return live?.playing&&!live.seeking&&!live.seekPreparing&&psfView==='channel'&&live.liveEnabled?live:null;
}
function retainedPsfEditorOwner() {
  const owner=psfSong,live=owner?.read();
  if(!(live?.paused||live?.playing)||live.seeking||live.seekPreparing||psfView!=='synth'||codeHost?.isRunning())return null;
  const action=psfActionEpoch,view=psfViewEpoch,entry=live.selection?.entry;
  return ()=>psfSong===owner&&psfActionEpoch===action&&psfViewEpoch===view&&psfView==='synth'&&
    !codeHost?.isRunning()&&(owner.read().paused||owner.read().playing)&&!psfSeekBusy()&&owner.read().selection?.entry===entry;
}
const addressText=value=>Number.isInteger(value)?`0x${value.toString(16).toUpperCase().padStart(5,'0')}`:'—';
function cancelPendingCapture(){if(capturePending)capturePending.cancelled=true;}
function captureUnavailable(live) {
  if(capturePending)return 'Preparing the captured instrument…';
  if(live.seeking||live.seekPreparing)return 'Wait for seeking to finish before capturing a channel.';
  if(!live.paused)return 'Pause the song before capturing a channel.';
  if(!live.liveEnabled)return 'Enable Live to capture the paused channel.';
  if(!live.canCapture)return live.captureMessage||'Waiting for the matching paused SPU RAM snapshot.';
  const voice=live.liveState?.channels?.[live.liveVoice];
  if(voice?.hardwarePmon)return 'PMON carrier capture is not supported; choose an ADPCM or Noise channel without PMON.';
  if(voice?.noise)return '';
  if(!voice||voice.pitch<=0)return 'The selected channel needs a nonzero PITCH code.';
  return '';
}
function updateCodeDisplay() {
  if (disposed || !codeLive) return;
  const fromPsf=psfOwnsLiveView(), live=fromPsf?psfSong.read():codeLive.read();
  const running=fromPsf||Boolean(codeHost?.isRunning()), observing=running&&live.liveEnabled&&(!fromPsf||psfView==='channel');
  const seeking=Boolean(fromPsf&&(live.seeking||live.seekPreparing));
  const psfEditable=Boolean(fromPsf&&observing&&live.playing&&live.manualAvailable&&live.liveState&&!seeking);
  const inputBlocked=Boolean(seeking||observing&&(!live.liveState||fromPsf&&!psfEditable));
  const source=fromPsf?'PSF':'Code';
  $('spuCodeLiveTools').hidden=!running;
  $('spuCodeLiveTools').dataset.liveKind=fromPsf?'psf':'code';
  if(fromPsf){$('spuCodeLiveTools').dataset.psfView=psfView;$('spuCodeLiveTools').dataset.psfVoice=String(live.liveVoice);}
  else {delete $('spuCodeLiveTools').dataset.psfView;delete $('spuCodeLiveTools').dataset.psfVoice;}
  $('spuCodeLiveTools').setAttribute('aria-label',`${source} channel observations`);
  setText('spuLiveSourceLabel',fromPsf?'View / keyboard':`${source} view`);
  setText('spuLiveEnabledLabel',`Live from ${source}`);
  $('spuLiveChannel').setAttribute('aria-label',fromPsf?'PSF channel or editable Synth':'Code channel to observe');
  $('spuLiveHelpLabel').setAttribute('aria-label',`About ${source} Live`);
  $('spuLiveHelpText').textContent=fromPsf?
    "Live follows the audible PSF position, up to 20 updates/s. While playing, the selected CH shares its voice Volume, PITCH, ADSR and keyboard with the original PSF SPU. Edits are temporary; later song writes can replace them. Old key releases and Pitch resets cannot overwrite a newer CPU-owned note. Reference key maps the source-written PITCH without inferring the sample root. Noise keys trigger its envelope; its shared Clock still controls the noise character. PMON keeps the preceding source voice running; the keyboard does not transpose a pair. Commands reach the next unrendered boundary, with about 0.2 seconds of bounded lookahead plus device latency. Sample RAM, Start/Repeat and shared Noise/reverb/PMON controls stay read-only in CH view. The PCM graph is a bounded sample-start preview, not the current output. Selected CH only is a software Dry listening helper; all voices and shared effects continue processing. Pause freezes the source and temporarily auditions the selected ADPCM or Noise on the editor bank. Resume restores the editor and continues retained song PCM. Capture to Synth copies the paused sound into the author instrument; it does not edit the PSF. Synth view plays and edits the separate authored instrument while the PSF continues, or keeps its paused position. Live Off selects Synth; On returns to the remembered PSF CH. Loading a different instrument/source, starting Code, or explicit Stop retains its existing transport behavior. Seek reconstructs the source program and discards temporary channel edits. Code and PSF playback stay mutually exclusive.":
    'Live shows the selected physical CH, up to 20 updates/s. Change a control to edit only that parameter on this CH; its musical pitch and Gate are kept for scalar edits. Reverb and Noise clock are shared hardware settings. PMON uses the preceding physical CH as its source. The touched setting is also kept in your common keyboard instrument for Stop. Live Off edits the common instrument on all CHs. Code and Keyboard tabs keep Run, loops, context and software FX. In Keyboard with Live On, keys play this CH; Live Off uses round robin. The latest Note On owns a physical CH: an old key-up or Code noteOff cannot release the other performer. There is no automatic return to the earlier note. Raw keyOff/allNotesOff remain explicit hardware actions. Code can overwrite the same parameter later. Stop restores the latest edited sound. Intermediate register writes can be missed.';
  $('spuLiveEnabled').checked=live.liveEnabled;
  $('spuLiveEnabled').disabled=seeking;
  $('spuLiveChannel').disabled=seeking;
  $('spuLiveSynthOption').hidden=$('spuLiveSynthOption').disabled=!fromPsf;
  for(const option of $('spuLiveChannel').options)if(option.value!=='synth'){
    const text=`${fromPsf?'PSF ':''}CH ${Number(option.value)+1}`;if(option.textContent!==text)option.textContent=text;
  }
  $('spuLiveChannel').value=fromPsf&&psfView==='synth'?'synth':String(live.liveVoice);
  $('spuPsfMonitorTools').hidden=!fromPsf;
  $('spuPsfMonitorEnabled').checked=Boolean(fromPsf&&live.monitorEnabled);
  $('spuPsfMonitorEnabled').disabled=seeking||Boolean(capturePending)||Boolean(fromPsf&&!live.monitorAvailable&&!live.monitorEnabled);
  $('spuPsfMonitorTools').title='Tetorica listening helper: selected-channel dry output, with all voices and the shared reverb still running. Off restores the original full mix and reverb.';
  psfChannelActivity.update({visible:fromPsf,voice:fromPsf&&psfView==='synth'?null:live.liveVoice,liveState:fromPsf&&!seeking?live.liveState:null,
    waiting:seeking||!live.liveEnabled||live.liveWaiting,error:live.liveError});
  for(const button of $('spuPsfChannelActivity').querySelectorAll('button'))button.disabled=seeking;
  $('spuPsfCaptureTools').hidden=!fromPsf;
  const captureReason=fromPsf?(psfView==='synth'?'Choose a PSF CH to copy its paused sound into Synth.':captureUnavailable(live)):'Play a PSF song to capture a channel.';
  $('spuPsfCapture').disabled=!fromPsf||Boolean(captureReason);
  const noiseVoice=fromPsf&&Boolean(live.liveState?.channels?.[live.liveVoice]?.noise);
  $('spuPsfReferenceKey').disabled=seeking||Boolean(capturePending)||noiseVoice||(fromPsf&&psfView==='synth');
  $('spuPsfReferenceKey').title=noiseVoice?'Noise uses the shared Clock; Reference key does not apply.':'This key reproduces the selected ADPCM PITCH code; it does not infer the original root note.';
  setText('spuPsfCapture',capturePending?'Preparing…':'Capture to Synth');
  const captureHint=captureReason||(noiseVoice?'Copy Noise Clock, ADSR, voice volumes and send. Keys trigger the envelope; Clock changes the noise character. The running Noise phase is not copied. Your edited shared reverb is kept.':'Copy the paused ADPCM, loop, ADSR, voice volumes and send. A new key press restarts the envelope; looping samples use their internal Loop Start marker when present. The Reference key preserves this PITCH. Your edited shared reverb is kept.');
  $('spuPsfCapture').title=captureHint;setText('spuPsfCaptureHint',captureHint);
  const root=$('spuVoicePanel'),viewChanged=root.dataset.observing!==String(observing)||root.dataset.observationKind!==(observing?source.toLowerCase():'');
  root.dataset.observing=String(observing);root.dataset.observationChannel=String(live.liveVoice);root.dataset.observationKind=observing?source.toLowerCase():'';root.dataset.observationWaiting=String(fromPsf&&observing&&(seeking||!live.liveState||live.liveWaiting||live.liveError));root.inert=inputBlocked;
  delete root.dataset.observationFrame;
  const readOnlyChanged=liveReadOnly!==inputBlocked;
  if (readOnlyChanged) {liveReadOnly=inputBlocked;panel.setConnected(Boolean(audio)&&!inputBlocked);}
  let displayed=state;
  if (observing&&live.liveState&&!seeking) {
    const snapshot=live.liveState, voice=snapshot.channels?.[live.liveVoice];
    if (voice) {
      // The standalone editor has one instrument slot. Map only its display
      // to the selected physical voice; no preset or sample is applied.
      const selectedMorph=voice.morphSettings??snapshot.morph;
      const matchesMorph=!fromPsf&&selectedMorph?.enabled&&voice.waveform?.pcm&&morphPcm(selectedMorph).every((value,i)=>value===voice.waveform.pcm[i]);
      displayed={...snapshot,channels:snapshot.channels.map((value,i)=>i===0?{...voice,channel:0}:value),
        codeEditChannel:fromPsf?null:live.liveVoice,
        observation:fromPsf?{...snapshot.observation,voice:live.liveVoice,editable:psfEditable}:snapshot.observation,
        morph:selectedMorph?{...selectedMorph,enabled:Boolean(matchesMorph)}:undefined,
        ...(!fromPsf?{pmon:voice.pmonSettings??snapshot.pmon,noise:{...snapshot.noise,enabled:voice.noise??snapshot.noise?.enabled,clock:voice.noiseClock??snapshot.noise?.clock}}:{})};
      if(fromPsf) {
        if(Number.isInteger(snapshot.observation?.nativeFrames))root.dataset.observationFrame=String(snapshot.observation.nativeFrames);
        $('sampleName').textContent=`PSF CH ${live.liveVoice+1} · Programmed Start ${addressText(voice.startAddress)} · bounded ADPCM preview`;
        $('spuLiveReadout').textContent=`CH ${live.liveVoice+1} · Gate request ${voice.gate?'On':'Off'} · Core ${voice.active?'active':'inactive'} · ENV ${voice.envelope??'—'} · ENDX ${voice.ended?'set':'clear'} · PITCH ${voice.pitch} · Vol L ${voice.volumeLeft?.toFixed(3)??'—'} / R ${voice.volumeRight?.toFixed(3)??'—'} · Start ${addressText(voice.startAddress)} · Repeat ${addressText(voice.repeatAddress)} (programmed)`;
      } else {
        updateSampleName(snapshot,live.liveVoice,true);
        $('spuLiveReadout').textContent=`CH ${live.liveVoice+1} · Gate ${voice.gate?'On':'Off'} · ENV ${voice.envelope??'—'} · PITCH ${voice.pitch} · Sample ${voice.sample??'—'}`;
      }
    }
  } else {$('spuLiveReadout').textContent='';updateSampleName();}
  if(observing&&(!live.liveState||seeking)) {
    $('spuLiveReadout').textContent='';
    if(fromPsf)$('sampleName').textContent=seeking?'Seeking PSF · previous position and edited sample are kept':'PSF observation waiting · edited sample is kept';
  }
  // Off transport ticks must not redraw the authored editor or interrupt a
  // drawing gesture. Actual editor changes already arrive through applyState.
  if (displayed&&((observing&&live.liveState&&!seeking)||readOnlyChanged||viewChanged)) panel.update(displayed);
  for (const id of ['pitchBend','keyboardPitchBend']) $(id).disabled=fromPsf?!(live.playing&&(psfView==='synth'||psfEditable)):running&&Boolean(codeHost?.isCodeMode());
  if (running) for (const input of document.querySelectorAll('[data-morph-performance-amount]'))
    input.disabled=seeking||(fromPsf?!((live.paused||live.playing)&&psfView==='synth'):false)||!displayed?.morph?.enabled||Boolean(displayed?.noise?.enabled);
  $('instrumentName').disabled=inputBlocked||fromPsf&&observing;
  for(const id of ['savePreset','saveSoundToFiles','spuFileSaveSoundButton']) {
    const button=$(id);if(!button)continue;
    if(fromPsf&&observing) {
      if(!observedSaveButtons.has(button))observedSaveButtons.set(button,{disabled:button.disabled,title:button.getAttribute('title')});
      button.disabled=true;button.title='Live view only. Capture a paused ADPCM channel into Synth, or turn Live off to save your edited instrument.';
    } else if(observedSaveButtons.has(button)) {
      const previous=observedSaveButtons.get(button);button.disabled=previous.disabled;
      if(previous.title===null)button.removeAttribute('title');else button.title=previous.title;
      observedSaveButtons.delete(button);
    }
  }
  $('spuLiveStatus').textContent=seeking?(live.seekMessage||'Seeking silently · previous position and edited instrument kept.'):
    !running?'Performance stopped · edited instrument restored.':fromPsf&&psfView==='synth'?`Synth · edit and play your own instrument. PSF ${live.paused?'stays paused; Resume continues the song':'continues playing'}. Choose a PSF CH to share its controls and keyboard.`:!live.liveEnabled?`Live off · ${source} continues${live.paused?' paused':''}. ${fromPsf?'Choose Synth to edit.':'Edit the common keyboard sound without stopping Code.'}`:live.liveError?live.liveMessage:live.liveWaiting?`Waiting for the current ${source} observation…`:`${live.paused?'Paused · frozen':'Live'} · ${source} CH ${live.liveVoice+1} · ${fromPsf?psfEditable?'edit volume / PITCH / ADSR · keyboard: this CH':live.playing?(live.manualReason||'Channel controls preparing'):'read-only PCM / ADSR / FX':'edit this CH · shared Reverb / Noise clock'}`;
  if(fromPsf) {
    const monitor=live.monitorError?live.monitorMessage:live.monitorSwitching?'Switching listening output…':live.monitorEnabled?`Listening to CH ${live.liveVoice+1} · Dry`:'';
    if(monitor)$('spuLiveStatus').textContent+=` · ${monitor}`;
  }
  $('spuLiveStatus').dataset.error=String(Boolean(fromPsf&&live.monitorError));
}
function codeActivity() {
  if (disposed) return;
  codeLive?.sync();updateCodeDisplay();
  visualizer.setRunning(performanceRunning());
  visualizer.wake();
}
async function stopCodeForEdit({preservePsf=false,isCurrent=()=>true}={}) {
  const operation=assetEpoch,current=()=>!disposed&&operation===assetEpoch&&isCurrent();
  await stopPausedKeyboard();
  if(!current())return false;
  if(!preservePsf&&psfSong?.read().canStop)await psfSong.stop();
  if(!current())return false;
  if(codeHost?.isRunning())await codeHost.stop();
  return current();
}
function audioFailed(error) {
  const failed = audio; epoch++; notes.clear(); updateKeys();
  // Release handlers must see the failed engine, rather than implicitly
  // creating a replacement while disconnecting this panel's note owners.
  panel.setConnected(false); $('startAudio').textContent = 'Enable audio';
  visualizer.disconnect();
  audio = null;
  void pausedAudition?.stop().catch(()=>{});
  void psfSong?.stop().catch(()=>{});
  void codeHost?.stop().catch(()=>{});codeLive?.sync();updateCodeDisplay();
  if (failed) void failed.dispose().catch(() => {});
  report(error);
}
async function ensureAudio() {
  if (!audio) {
    if (!opening) {
      const restarting = state !== null;
      $('startAudio').disabled = true;
      status('Preparing SPU…');
      opening = createSpuAudio({onState:applyState, onError:audioFailed}).then(async value => {
        audio = value;
        clickGuardApplied=value.state?.clickGuard!==false;
        try {await applyClickGuard(value);}
        catch(error){if(audio===value){audio=null;await value.dispose();}throw error;}
        instrumentName = 'Sine'; $('instrumentName').value = instrumentName;
        codeHost?.markSoundDirty();
        audio.setVolume(Number($('masterVolume').value));
        visualizer.connect(audio.context, audio.gain);
        panel.setConnected(true);
        applyState(audio.state);
        $('startAudio').textContent = 'Audio ready';
        status(restarting ? 'Audio restarted with Sine. Load a saved preset to restore an instrument.' : 'Audio ready. Play notes and edit the instrument.');
        return audio;
      }).catch(error => {
        $('startAudio').textContent = 'Enable audio';
        panel.setConnected(false);
        throw error;
      }).finally(() => {opening = null; $('startAudio').disabled = false;});
    }
    await opening;
  }
  await audio.resume();
  return audio;
}
async function applyClickGuard(engine=audio) {
  const desired=$('spuClickGuard').checked,request=++clickGuardIntent;
  if(!engine)return;
  try {
    const accepted=await engine.command('setClickGuard',[desired]);
    if(typeof accepted!=='boolean')throw new TypeError('SPU click guard did not acknowledge its setting');
    if(audio===engine&&request===clickGuardIntent){clickGuardApplied=accepted;$('spuClickGuard').checked=accepted;}
  } catch(error) {
    if(audio===engine&&request===clickGuardIntent)$('spuClickGuard').checked=clickGuardApplied;
    throw error;
  }
}
$('spuClickGuard').addEventListener('change',()=>{void applyClickGuard().catch(report);$('spuClickGuard').blur();});
async function invoke(method, args = []) {
  cancelPendingCapture();
  if(psfSeekBusy())throw new DOMException('Wait for PSF seeking to finish','AbortError');
  const preparing=psfSong?.read();
  if(preparing?.starting||preparing?.resuming)throw new DOMException('PSF playback is preparing','AbortError');
  const psfChannel=playingPsfChannel();
  if(psfChannel) {
    if(!psfChannel.manualAvailable)throw new Error(psfChannel.manualReason||'PSF channel controls are preparing.');
    let result;
    if(method==='setInstrumentPreset')result=psfSong.editVoice(psfChannel.liveVoice,args[0]);
    else if(method==='setInstrumentEnvelope')result=psfSong.editVoice(psfChannel.liveVoice,{envelope:args[0]});
    else if(method==='setInstrumentPitchBend')result=psfSong.setPitchBend(args[0]);
    else throw new Error('Use Synth view to edit samples or shared effects. PSF channel controls support voice volume, PITCH and ADSR.');
    visualizer.wake();return result;
  }
  const retainedEdit=pausedEditorMethods.has(method)?retainedPsfEditorOwner():null;
  const codeRunning=Boolean(codeHost?.isRunning()),codeSession=audio?.codeSession,codeView=codeLive?.read(),codeTarget=codeView?.liveEnabled?codeView.liveVoice:null;
  const operation=assetEpoch,current=()=>!disposed&&operation===assetEpoch&&(!retainedEdit||retainedEdit());
  if(previewActive()||pausedStopping)await stopPausedKeyboard();
  if(!current())throw new DOMException('Instrument edit was superseded','AbortError');
  if(psfSong?.read().canStop)if(!await stopCodeForEdit({preservePsf:Boolean(retainedEdit),isCurrent:current}))throw new DOMException('Instrument edit was superseded','AbortError');
  // Note owners have already awaited resume and checked their press token.
  // Do not yield again here: an Off/Stop must never overtake its pending On.
  const engine = audio ?? await ensureAudio();
  if(!current())throw new DOMException('Instrument edit was superseded','AbortError');
  const changesTopology = method === 'setInstrumentPmon' && Boolean(state?.pmon?.enabled) !== args[0]?.enabled || method === 'setInstrumentNoise' && Boolean(state?.noise?.enabled) !== args[0]?.enabled;
  if (changesTopology) topologyPending++;
  const commandEpoch = epoch;
  // Only reconcile leases that existed when this edit was sent. A key pressed
  // after this snapshot boundary must keep its own later Note Off identity.
  const editedNotes=new Set([...notes.values()].filter(note=>!['psf-preview','psf-live'].includes(note.owner)&&note.started&&note.submitted).map(note=>note.id));
  let result;
  try {
    if(method==='instrumentNoteOn')for(const note of notes.values())if(note.id===args[1])note.submitted=true;
    if(codeRunning&&method.startsWith('set')&&method!=='setInstrumentPitchBend'&&method!=='setInstrumentSample') {
      if(!Number.isSafeInteger(codeSession)||engine.codeSession!==codeSession)throw new DOMException('SPU Code stopped','AbortError');
      result=await engine.command('editInstrument',[codeSession,codeTarget,method,args]);
    }else result = await engine.command(method,method==='setInstrumentSample'&&codeRunning?[...args,codeSession]:args);
    // The worklet validates before stopping voices. Preserve note owners when
    // it rejects the change, so their later key-up can still release them.
    if (changesTopology && !codeRunning&&audio===engine && commandEpoch===epoch) {epoch++;notes.clear();updateKeys();}
    else if(audio===engine&&commandEpoch===epoch&&Array.isArray(engine.state?.auditions)) {
      const sounding=new Set(engine.state.auditions.map(note=>note.id));
      for(const [source,note]of notes)if(editedNotes.has(note.id)&&!sounding.has(note.id))notes.delete(source);
      updateKeys();
    }
  } catch(error){if(error?.committed&&current())codeHost?.markSoundDirty();throw error;}
  finally {if(changesTopology)topologyPending--;}

  // A live edit may expose a release/reverb tail after the display slept.
  // Monitoring remains passive, and an intervening Stop cancels this wake.
  if (method.startsWith('set') && commandEpoch === epoch&&current()) visualizer.wake();
  if (method.startsWith('set')) codeHost?.markSoundDirty();
  return result;
}
const panel = createSpuInstrumentPanel({
  root:$('spuVoicePanel'), morphPerformanceRoot:document, invoke, ensureAudioReady:ensureAudio, onError:report,
  async readSample(){
    const owner=audio;if(!owner)throw new DOMException('Audio is unavailable','AbortError');
    const source=await owner.command('getInstrumentSample',[0]);
    if(disposed||audio!==owner)throw new DOMException('Sample owner changed','AbortError');
    return source;
  },
  async prepareSampleEdit(source,pcm,{signal}={}){
    const owner=audio,operation=assetEpoch;
    if(!owner||signal?.aborted)throw new DOMException('Sample edit cancelled','AbortError');
    if(!(pcm instanceof Float32Array)||pcm.length!==source.adpcm.byteLength/16*28)throw new RangeError('Sample editing must preserve the complete source length.');
    if(Number.isSafeInteger(source.availableEditBytes)&&source.availableEditBytes<source.adpcm.byteLength)throw new RangeError('Not enough free SPU RAM for an edited copy. Save the instrument and reload to free the sample bank.');
    const encoded=await encodeInWorker(pcm.slice(),{loopStartSamples:source.loopStartSamples??null,maxBytes:source.adpcm.byteLength},{signal});
    if(disposed||audio!==owner||operation!==assetEpoch||signal?.aborted)throw new DOMException('Sample edit was superseded','AbortError');
    return {sourceSampleId:source.sampleId,sourceToken:source.token,adpcm:encoded.adpcm};
  },
});
setupSynthMenu({document,window});
$('synthMenuPanel').addEventListener('click',event=>{
  const action=event.target.closest('[data-spu-open-panel],[data-spu-restore-editor]');
  if(!action)return;
  // Restore the existing editor without changing Code ownership or sound.
  // A cancelled picker must not stop a running performance.
  void codeHost?.controls.setExpanded(false);
  if(action.dataset.spuOpenPanel)selectEditorTab(action.dataset.spuOpenPanel);
}, {capture:true});
codeLive=createSpuCodeLive({getAudio:()=>audio,isRunning:()=>Boolean(codeHost?.isRunning()&&!document.hidden),onUpdate:updateCodeDisplay});
for(let ch=0;ch<24;ch++)$('spuLiveChannel').append(new Option(`CH ${ch+1}`,String(ch)));
function selectLiveVoice(voice) {
  if(!Number.isInteger(voice)||voice<0||voice>23)return;
  const fromPsf=psfOwnsLiveView(),live=fromPsf?psfSong.read():codeLive?.read();
  if(!live||live.seeking||live.seekPreparing||(live.liveVoice===voice&&(!fromPsf||(psfView==='channel'&&live.liveEnabled))))return;
  cancelPendingCapture();void stopPausedKeyboard({releaseEdited:true}).catch(report);
  psfViewEpoch++;
  if(fromPsf){psfView='channel';psfSong.setLiveVoice(voice);psfSong.setLiveEnabled(true);updateCodeDisplay();}
  else codeLive.setVoice(voice);
}
$('spuLiveChannel').addEventListener('change',()=>{
  if($('spuLiveChannel').value==='synth'&&psfOwnsLiveView()){
    cancelPendingCapture();void stopPausedKeyboard({releaseEdited:true}).catch(report);psfViewEpoch++;psfView='synth';updateCodeDisplay();
  }else selectLiveVoice(Number($('spuLiveChannel').value));
  $('spuLiveChannel').blur();
});
$('spuPsfMonitorEnabled').addEventListener('change',()=>{
  const enabled=$('spuPsfMonitorEnabled').checked;$('spuPsfMonitorEnabled').blur();
  if(psfOwnsLiveView())void psfSong.setMonitorEnabled(enabled).catch(report);
});
$('spuLiveEnabled').addEventListener('change',()=>{cancelPendingCapture();void stopPausedKeyboard({releaseEdited:true}).catch(report);const enabled=$('spuLiveEnabled').checked;if(psfOwnsLiveView()){psfViewEpoch++;psfView=enabled?'channel':'synth';psfSong.setLiveEnabled(enabled);}else codeLive.setEnabled(enabled);$('spuLiveEnabled').blur();});
$('spuPsfReferenceKey').addEventListener('change',()=>{cancelPendingCapture();void stopPausedKeyboard({releaseEdited:true}).catch(report);$('spuPsfReferenceKey').blur();});
$('spuPsfCapture').addEventListener('click',()=>{$('spuPsfCapture').blur();void capturePsfVoice();});
document.addEventListener('click',event=>{
  if(!psfOwnsLiveView()||psfView!=='channel'||!psfSong.read().liveEnabled)return;
  if(!event.target.closest('#savePreset,#saveSoundToFiles,#spuFileSaveSoundButton'))return;
  event.preventDefault();event.stopImmediatePropagation();
  status('Live view only. Capture a paused ADPCM channel into Synth, or turn Live off to save your edited instrument.');
},true);
$('monitorEnvelopeMount').append(rmsCanvas);
const editorTabs = [...document.querySelectorAll('[data-spu-editor-tab]')];
function selectEditorTab(name, focus = false) {
  const selected = editorTabs.find(button => button.dataset.spuEditorTab === name);
  if (!selected) return;
  panel.setSection(name);
  $('instrumentPanel-audio').hidden = name !== 'audio';
  $('instrumentPanel-bank').hidden = name !== 'bank';
  for (const button of editorTabs) {
    const active = button === selected;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  if (focus) selected.focus();
}
for (const [index, button] of editorTabs.entries()) {
  button.addEventListener('click', () => selectEditorTab(button.dataset.spuEditorTab));
  button.addEventListener('keydown', event => {
    let target;
    if (event.key === 'ArrowRight') target = (index + 1) % editorTabs.length;
    else if (event.key === 'ArrowLeft') target = (index + editorTabs.length - 1) % editorTabs.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = editorTabs.length - 1;
    else return;
    event.preventDefault();
    selectEditorTab(editorTabs[target].dataset.spuEditorTab, true);
  });
}
selectEditorTab('pcm');
const visualDescriptions = {
  envelope:'Live output level after Master volume. Open ADSR below to edit the instrument’s envelope.',
  waveform:'Live SPU output waveform after Master volume. Pitch bends sounding notes without restarting them.',
  spectrum:'Live SPU output spectrum after Master volume. Frequency increases from left to right.',
};
function setVisualMode(mode) {
  $('monitorEnvelopeMount').hidden = mode !== 'envelope';
  $('outputCanvas').hidden = mode === 'envelope';
  $('outputCanvas').setAttribute('aria-label', mode === 'spectrum' ? 'Live SPU output frequency spectrum' : 'Live SPU output waveform');
  $('visualizerDescription').textContent = visualDescriptions[mode];
  for (const button of document.querySelectorAll('[data-spu-visual-mode]')) button.setAttribute('aria-pressed', String(button.dataset.spuVisualMode === mode));
  visualizer.setMode(mode);
}
for (const button of document.querySelectorAll('[data-spu-visual-mode]')) button.addEventListener('click', () => setVisualMode(button.dataset.spuVisualMode));
setVisualMode('envelope');

const fret = createFretboardState(), keyboard = document.createElement('div');
keyboard.className = 'keyboard'; keyboard.id = 'keyboardKeys';
const toolbar = document.createElement('div'); toolbar.className = 'fretboard-toolbar';
const keyboardTools = Object.fromEntries(['instrument', 'position', 'fret', 'strings', 'window'].map(name => {
  const node = document.createElement('div');
  node.className = `fretboard-${name} ${['fret', 'strings'].includes(name) ? 'fret-display' : 'toolbar-group'}`;
  return [name, node];
}));
const summary = document.createElement('div'); summary.className = 'fretboard-row fretboard-summary';
summary.append(keyboardTools.fret, keyboardTools.strings);
const choices = document.createElement('div'); choices.className = 'fretboard-row';
for (const name of ['instrument', 'position', 'window']) {
  if (choices.childElementCount) {const divider = document.createElement('span'); divider.className = 'toolbar-divider'; divider.textContent = '|'; divider.setAttribute('aria-hidden', 'true'); choices.append(divider);}
  choices.append(keyboardTools[name]);
}
toolbar.append(summary, choices);
$('keyboardFretboard').append(toolbar);
$('keyboardMount').append(keyboard);
let layout;
function renderKeyboard() {
  layout = createFretboardLayout({state:fret});
  renderFretboardControls({instrumentRoot:keyboardTools.instrument, positionRoot:keyboardTools.position,
    fretDisplayRoot:keyboardTools.fret, stringDisplayRoot:keyboardTools.strings, stringWindowRoot:keyboardTools.window,
    state:fret, onInstrumentChange(value) { releaseKeyboard(true); setInstrument(fret, value); renderKeyboard(); },
    onPositionPresetSelect(value) { releaseKeyboard(true); setFretPosition(fret, value); renderKeyboard(); },
    onStringWindowChange(value) { releaseKeyboard(true); setStringWindowIndex(fret, value); renderKeyboard(); }});
  const entries = layout.entries.map(entry => ({...entry, midi:entry.midi + octave * 12,
    noteName:noteName(entry.midi + octave * 12)}));
  buildKeyboard({root:keyboard, rowDefs:layout.rowDefs, layoutEntries:entries, showPitch:false,
    onPointerDown(event, entry) { if (event.button !== 0) return; void press(`pointer:${event.pointerId}`, entry).catch(report); },
    onPointerUp(event) { release(`pointer:${event.pointerId}`); },
    onPointerCancel(event) { release(`pointer:${event.pointerId}`, true); }});
  $('octaveValue').textContent = `${octave > 0 ? '+' : ''}${octave}`;
  $('octaveDown').disabled = octave <= -2; $('octaveUp').disabled = octave >= 2;
  updateKeys();
}
function noteName(midi) {return `${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;}
function updateKeys() {
  const keys = new Set([...notes.values()].map(note => note.key));
  for (const button of keyboard.querySelectorAll('.key')) {
    const active = keys.has(button.dataset.key);
    button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active));
  }
  updateHeldStatus();
}
async function press(source, entry) {
  if (codeHost?.getState?.()?.busy || topologyPending || switchingAudioOutput || capturePending || psfSeekBusy()) return;
  if (notes.get(source)?.released) release(source, true);
  if (notes.has(source)) return;
  const song=psfSong?.read(),selectedPsf=psfView==='channel'&&song?.liveEnabled,selection=song?.paused&&selectedPsf?pausedSelection():null;
  if(song?.starting||song?.resuming)return;
  const owner=song?.paused?(selectedPsf?'psf-preview':'psf-editor'):song?.playing?(selectedPsf?'psf-live':'psf-editor'):'editor';
  const transport=psfSong,psfAction=psfActionEpoch,selectedChannel=song?.liveVoice;
  const note = {key:entry.key, midi:entry.midi, channel:owner==='psf-live'?selectedChannel:null, id:`spu-synth:${++noteSequence}`, epoch, started:false,submitted:false,owner};
  notes.set(source, note); updateKeys();
  try {
    await ensureAudio();
    await pausedStopFence;
    const current=()=>note.epoch===epoch&&notes.get(source)===note&&!disposed&&!topologyPending&&!switchingAudioOutput&&
      (!owner.startsWith('psf-')||psfSong===transport&&psfActionEpoch===psfAction&&transport.read().selection?.entry===song.selection?.entry);
    if(!current())return;
    if(codeHost?.getState?.()?.busy||!codeHost?.isRunning()&&codeHost?.openOutput?.()===false){notes.delete(source);updateKeys();return;}
    let allocation;
    if(owner==='psf-preview') {
      if(!selection)throw new Error(psfSong.read().captureMessage||'Wait for a matching paused ADPCM observation before auditioning.');
      if(pausedSelection()?.key!==selection.key)return;
      note.started=true;
      allocation=await pausedAudition.noteOn(note.id,note.midi,{isCurrent:()=>current()&&pausedSelection()?.key===selection.key});
      if(!allocation){if(notes.get(source)===note)notes.delete(source);updateKeys();return;}
    } else if(owner==='psf-live') {
      const live=playingPsfChannel();
      if(!live||live.liveVoice!==selectedChannel||!current())return;
      const available=transport.describeVoice(selectedChannel);
      if(!live.manualAvailable||!available?.playable)throw new Error(available?.reason||live.manualReason||'This PSF voice is not ready for keyboard input.');
      const referenceMidi=(Number($('spuPsfReferenceKey').value.slice(1))+1)*12;
      note.started=true;note.submitted=true;
      allocation=transport.noteOn(note.id,selectedChannel,note.midi,{referenceMidi,bend});
      if(!allocation){if(notes.get(source)===note)notes.delete(source);updateKeys();return;}
    } else if(owner==='psf-editor') {
      // Synth view auditions the authored instrument without retiring the
      // paused song. Its bank must first be restored from any preview lease.
      await stopPausedKeyboard();
      const live=psfSong?.read();
      if(!current()||!(live?.paused||live?.playing)||(psfView==='channel'&&live.liveEnabled)||live.selection?.entry!==song.selection?.entry)return;
      note.started=true;note.submitted=true;pausedEditorAudition=true;allocation=await audio.command('instrumentNoteOn',[note.midi,note.id,bend]);
    } else {
      await stopPausedKeyboard();
      // Retire a playing song before marking this note started. Key-up may
      // overtake that await and must cancel the pending On.
      if(psfSong?.read().canStop)await psfSong.stop();
      if(!current())return;
      note.started = true;
      const live=codeLive?.read(),channel=codeHost?.isRunning()&&live?.liveEnabled?live.liveVoice:null;
      allocation = await invoke('instrumentNoteOn', [note.midi, note.id, bend,channel]);
    }
    note.channel = allocation.channel;
    if (allocation.stolenId) for (const [oldSource, old] of notes) if (old.id === allocation.stolenId) notes.delete(oldSource);
    updateKeys();
    if (notes.get(source) === note) status(owner==='psf-preview'?`Paused PSF CH ${psfSong.read().liveVoice+1} · ${noteName(note.midi)} · temporary audition. Source display stays frozen.`:
      owner==='psf-live'?`PSF CH ${selectedChannel+1} · ${noteName(note.midi)} · manual key; later song writes take over.`:`${noteName(note.midi)} · ${state?.auditions?.length ?? notes.size} notes held`);
  } catch (error) { if (notes.get(source) === note) notes.delete(source); updateKeys();if(error?.name!=='AbortError')throw error; }
}
function release(source, force = false) {
  const note = notes.get(source); if (!note) return;
  if (!force && $('sustainToggle').checked) {note.released = true; return;}
  notes.delete(source); updateKeys();
  if(note.owner==='psf-preview')void pausedAudition?.noteOff(note.id).catch(report);
  else if(note.owner==='psf-live'){try{psfSong?.noteOff(note.id);}catch(error){report(error);}}
  else if (note.started && audio) void audio.command('instrumentNoteOff', [note.id]).catch(report);
}
function releaseKeyboard(force = false) {
  if (force) {
    releasePsfKeys();
    epoch++; notes.clear(); updateKeys();
    if(previewActive()||pausedStopping)void pausedAudition?.allNotesOff().catch(report);
    else if (audio) void audio.command('instrumentAllNotesOff').catch(report);
  } else for (const source of [...notes.keys()]) release(source);
}
function editing(target) {
  if(target?.closest?.('dialog[open],.monaco-editor,#synthCodeEditorHost,[contenteditable]:not([contenteditable="false"])'))return true;
  const node = target?.closest?.('input,select,textarea');
  return node && !node.matches?.('input[type=range],input[type=checkbox]');
}
// Native select popups can consume keys before document handlers see them.
// Return pointer users to performance focus once a choice is committed; keep
// focus for keyboard navigation so arrows and Tab remain usable.
let pointerSelect = null;
document.addEventListener('pointerdown', event => {
  pointerSelect = event.target?.closest?.('select') ?? null;
}, {capture:true});
document.addEventListener('change', event => {
  const select = event.target?.closest?.('select');
  if (select?.closest('#synthDesktopTools')) return;
  if (select && select === pointerSelect) {
    pointerSelect = null;
    // Let native WebKit finish committing the option and let change handlers
    // read its value before leaving the popup.
    setTimeout(() => {if (document.activeElement === select) select.blur();}, 0);
  }
}, {capture:true});
document.addEventListener('keydown', event => {
  if(event.defaultPrevented||$('spuFileNameDialog')?.open||$('spuFileContextMenu')?.hidden===false)return;
  if(event.key==='Escape'&&psfSong?.read().seeking){event.preventDefault();event.stopPropagation();void cancelPsfSeek().catch(report);return;}
  if(event.key==='Escape'&&event.target?.id==='psfSongSeek')return;
  if (event.target?.closest?.('select') && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End',' ','Enter','Escape','Tab'].includes(event.key)) pointerSelect = null;
  if (event.isComposing) return;
  const entryField=event.target?.closest?.('input[type=number],input[type=text]');
  const editorField=event.target?.closest?.('dialog[open],.monaco-editor,#synthCodeEditorHost,[contenteditable]:not([contenteditable="false"])');
  if (event.key === 'Enter' && entryField&&!editorField) {event.preventDefault();entryField.blur();return;}
  if (editing(event.target)) return;
  if (event.key === 'Escape') {void stop().catch(report); return;}
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const entry = layout.entries.find(value => value.key === event.key.toLowerCase()); if (!entry) return;
  // Capture musical keys before a focused select can use type-ahead. Keep
  // arrows, Space and Tab available for normal control navigation. Repeats
  // are cancelled as well, without starting a second note.
  event.preventDefault();
  if (!event.repeat) void press(`key:${event.code}`, {...entry, midi:entry.midi + octave * 12}).catch(report);
}, {capture:true});
document.addEventListener('keyup', event => release(`key:${event.code}`));
window.addEventListener('blur', () => {releaseKeyboard(true);resetBend();});
document.addEventListener('visibilitychange', () => {
  codeLive.sync();
  if (document.hidden) {releaseKeyboard(true);resetBend();panel.setVisible(false);}
  else panel.setVisible(true);
  visualizer.setVisible(!document.hidden);
});
$('sustainToggle').addEventListener('change', () => {if (!$('sustainToggle').checked) for (const [source, note] of notes) if (note.released) release(source, true);});
for (const [id, delta] of [['octaveDown', -1], ['octaveUp', 1]]) $(id).addEventListener('click', () => {releaseKeyboard(true); octave = Math.max(-2, Math.min(2, octave + delta)); renderKeyboard();});
let bendFrame = null;
function applyBend(value = Number($('pitchBend').value)) {
  const previous=bend;
  bend = value;
  for (const id of ['pitchBend', 'keyboardPitchBend']) $(id).value = String(bend);
  for (const id of ['pitchValue', 'keyboardPitchValue']) $(id).textContent = `${bend > 0 ? '+' : ''}${bend.toFixed(2)} st`;
  const song=psfSong?.read();
  if(previous===value||song?.paused||song?.resuming||song?.starting)return;
  if (bendFrame !== null) return;
  const commandEpoch=epoch,operation=assetEpoch;
  bendFrame = requestAnimationFrame(() => {
    bendFrame = null;
    if(commandEpoch!==epoch||operation!==assetEpoch||disposed)return;
    const live=psfSong?.read();
    if (audio&&!live?.paused&&!live?.resuming&&!live?.starting) void invoke('setInstrumentPitchBend', [bend]).catch(report);
  });
}
function resetBend() {applyBend(0);}
for (const id of ['pitchBend', 'keyboardPitchBend']) {
  $(id).addEventListener('input', event => applyBend(Number(event.currentTarget.value)));
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) $(id).addEventListener(event, resetBend);
}
$('startAudio').addEventListener('click', () => {void ensureAudio().catch(report);});
async function stop({preservePausedPsf=false}={}) {
  if(!preservePausedPsf)cancelPendingCapture();
  const action=++psfActionEpoch,operation=assetEpoch,current=()=>action===psfActionEpoch&&operation===assetEpoch;
  const seekingStop=!preservePausedPsf&&psfSeekBusy()?psfSong.stop():null;
  epoch++; notes.clear(); updateKeys(); panel.releaseAll();
  visualizer.stop();
  $('sustainToggle').checked = false;
  await stopPausedKeyboard({releaseEdited:true});
  if(!current())return;
  // Capture replaces the editor instrument, not the paused source machine.
  // Ordinary Stop / imports still retire both owners.
  if(!preservePausedPsf)await (seekingStop??psfSong?.stop());
  if(!current())return;
  await codeHost?.stop();
  if(!current())return;
  if (opening) {try {await opening;} catch {return;}}
  if(!current())return;
  if (audio) await audio.stop();
  visualizer.stop();
  status('Stopped. Samples and settings are kept.');
  codeLive.sync();updateCodeDisplay();
}
$('stopAudio').addEventListener('click', () => {cancelPendingCapture();void stop().catch(report);});
$('allNotesOff').addEventListener('click', () => {
  releaseKeyboard(true); panel.releaseAll();
  $('sustainToggle').checked = false;
});
$('masterVolume').addEventListener('input', () => {
  const value = Number($('masterVolume').value);
  $('masterVolume').dataset.boosted = String(value > 1);
  $('masterVolumeValue').textContent = `${Math.round(value * 100)}%`; audio?.setVolume(value);
  if (audio) visualizer.wake();
});
$('instrumentName').addEventListener('change', () => {
  instrumentName = $('instrumentName').value.trim() || 'Untitled';
  codeHost?.markSoundDirty();
  $('instrumentName').value = instrumentName; if (state) applyState(state);
});

const decodeAudio = createOfflineAudioDecoder({getSampleRate:() => 44100});
let preparation = null;
function encodeInWorker(pcm, options, {signal}={}) {
  if(signal?.aborted)return Promise.reject(new DOMException('Sample preparation cancelled','AbortError'));
  preparation?.cancel();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./spu_synth_prepare_worker.js', import.meta.url), {type:'module'});
    let settled=false;
    const abort=()=>complete(new DOMException('Sample preparation cancelled','AbortError'));
    const complete = (error, result) => {if(settled)return;settled=true;signal?.removeEventListener('abort',abort);worker.terminate(); if (preparation?.worker === worker) preparation = null; error ? reject(error) : resolve(result);};
    preparation = {worker, cancel:() => complete(new DOMException('Sample preparation cancelled', 'AbortError'))};
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage = ({data}) => complete(data.error ? new Error(data.error) : null, data.result);
    worker.onerror = event => complete(new Error(event.message || 'Sample encoding failed'));
    try {worker.postMessage({pcm, options}, [pcm.buffer]);}
    catch(error){complete(error);}
  });
}
$('loadAudio').addEventListener('click', () => $('audioFileInput').click());
$('audioFileInput').addEventListener('change', async () => {
  const file = $('audioFileInput').files[0]; $('audioFileInput').value = ''; if (!file) return;
  const operation = beginAssetOperation();
  const codeSession=codeHost?.isRunning()?audio?.codeSession:null;
  preparation?.cancel();
  const rootNote = Number($('sampleRootNote').value), loop = $('sampleLoop').checked;
  try {
    if (!Number.isInteger(rootNote) || rootNote < 0 || rootNote > 127) throw new RangeError('Root MIDI note must be 0–127');
    if (file.size > MAX_AUDIO_FILE_BYTES) throw new RangeError('Choose an audio file smaller than 32 MiB');
    if(codeSession===null)await stopCodeForEdit();
    sampleStatus('Opening audio…');
    const engine = await ensureAudio(); sampleStatus('Decoding audio…');
    const buffer = await decodeAudio(await file.arrayBuffer());
    if (operation !== assetEpoch) return;
    const current = await engine.inspect(), maxBytes = 524288 - current.nextAddress;
    const useHost=Math.ceil(buffer.length/28)*16 > maxBytes;
    const prepared=useHost ? {pcm:prepareHostAudio(buffer),trimmedFrames:0} : prepareAudioPcm(buffer, {loop, maxBytes});
    sampleStatus(useHost ? 'Preparing Software audio…' : 'Encoding SPU ADPCM…');
    const encoded = useHost ? null : await encodeInWorker(prepared.pcm, {loopStartSamples:prepared.loopStartSamples, maxBytes});
    if (operation !== assetEpoch) return;
    if(codeSession!==null) {
      if(engine.codeSession!==codeSession||!codeHost?.isRunning())return;
      const source=await engine.command('getInstrument',[0]);if(operation!==assetEpoch||engine.codeSession!==codeSession)return;
      const {sample:ignored,...preset}=source.preset,baseFrequencyHz=440*2**((rootNote-69)/12);
      const instrument=writeSpuInstrument(file.name.slice(0,80),{...source,preset,waveform:null,morph:{...source.morph,enabled:false},
        sample:useHost?{pcm:prepared.pcm,baseFrequencyHz,loop}:{adpcm:encoded.adpcm,baseFrequencyHz,...(loop?{loopStartSamples:0}:{})}});
      if(await applyInstrumentDocument(instrument,{isCurrent:()=>operation===assetEpoch&&engine.codeSession===codeSession}))sampleStatus(`Loaded ${file.name}. Code continues.`);
      return;
    }
    await stop();
    if (operation !== assetEpoch) return;
    if (useHost) await engine.command('loadHostPCM',[prepared.pcm,{baseFrequencyHz:440*2**((rootNote-69)/12),loop}]);
    else {
      const sample = await engine.command('loadADPCM', [encoded.adpcm, {rootNote, ...(loop ? {loopStartSamples:0} : {})}]);
      if (operation !== assetEpoch) return;
      await engine.command('setInstrumentPreset', [{sample}]);
    }
    if (operation !== assetEpoch) return;
    instrumentName = file.name.slice(0, 80); $('instrumentName').value = instrumentName;
    codeHost?.markSoundDirty();
    sampleStatus(`Loaded ${file.name} · ${useHost ? 'Software audio · ' : ''}root ${noteName(rootNote)}${prepared.trimmedFrames ? ` · trimmed ${prepared.trimmedFrames} frames for the loop boundary` : ''}.`);
    applyState(await engine.inspect());
  } catch (error) {if (operation === assetEpoch && error.name !== 'AbortError') sampleStatus(error.message,true);}
});

function download(name, contents) {
  const url = URL.createObjectURL(new Blob([contents], {type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
let vabBank = null, vabName = '', bankChoices = [], psfSet = null, bankReadController = null, psfHasSongs = false, extractingPsf = false, bankSaveRequest = null;
const vabStatus = (message, error=false) => { $('vabStatus').textContent=message; $('vabStatus').dataset.error=String(error); };
function updatePsfPlayback(next) {
  if(disposed)return;
  $('psfSongPlayer').hidden=!psfSet;
  $('psfPlaySong').disabled=!psfHasSongs||!next.canPlay||Boolean(bankReadController);
  $('psfPauseSong').disabled=!(next.canPause||next.canResume);
  setText('psfPauseSong',next.paused||next.resuming?'Resume':'Pause');
  $('psfStopSong').disabled=!next.canStop;
  psfSeekControls?.update({...next,canSeek:next.canSeek&&psfHasSongs&&!bankReadController});
  $('extractPsf').disabled=Boolean(bankReadController)||!psfSet||next.seeking||next.seekPreparing;
  const message=psfSet&&!psfHasSongs?'PSF libraries only · use PSF / VAB to extract a bank.':next.message;
  $('psfPlaybackStatus').textContent=message;
  $('psfPlaybackStatus').title=message;
  $('psfEntry').title=$('psfEntry').value;
  $('psfPlaybackStatus').dataset.error=String(next.error);
  $('psfPlaybackStatus').dataset.monitorEnabled=String(Boolean(next.monitorEnabled));
  $('psfPlaybackStatus').dataset.monitorSwitching=String(Boolean(next.monitorSwitching));
  $('psfPlaybackStatus').dataset.monitorVoice=Number.isInteger(next.monitorVoice)?String(next.monitorVoice):'full';
  visualizer.setRunning(performanceRunning());
  if(next.playing)visualizer.wake();
  updateCodeDisplay();
}
psfSong=createPsfSongPreview({getAudio:ensureAudio,onUpdate:updatePsfPlayback,
  async createCore({set,entry,signal}) {
    const image=await preparePsfSongSource(set,entry,{signal});
    return createPsfPlaybackCore({image,signal});
  },
  async beforePlay({signal}) {
    await stopPausedKeyboard({releaseEdited:true});signal.throwIfAborted();
    psfView=psfSong.read().liveEnabled?'channel':'synth';
    signal.throwIfAborted();epoch++;notes.clear();updateKeys();panel.releaseAll();
    $('sustainToggle').checked=false;
    if(bendFrame!==null){cancelAnimationFrame(bendFrame);bendFrame=null;}
    bend=0;for(const id of ['pitchBend','keyboardPitchBend'])$(id).value='0';for(const id of ['pitchValue','keyboardPitchValue'])$(id).textContent='0.00 st';
    await codeHost?.stop();signal.throwIfAborted();
    if(audio)await audio.stop();signal.throwIfAborted();
  },
  async beforeSeek({signal,isCurrent}) {
    const action=psfActionEpoch,operation=assetEpoch;
    const check=()=>{signal.throwIfAborted();if(disposed||action!==psfActionEpoch||operation!==assetEpoch||!isCurrent())throw new DOMException('PSF seek was superseded','AbortError');};
    await stopPausedKeyboard({releaseEdited:true});check();
    epoch++;notes.clear();updateKeys();panel.releaseAll();$('sustainToggle').checked=false;
    if(bendFrame!==null){cancelAnimationFrame(bendFrame);bendFrame=null;}
    await codeHost?.stop();check();
    if(audio)await audio.stop();check();
  },
});
function startPsfSeek(seconds){cancelPendingCapture();psfActionEpoch++;return psfSong.seek(seconds);}
function cancelPsfSeek(){cancelPendingCapture();psfActionEpoch++;return psfSong.cancelSeek();}
psfSeekControls=setupPsfSeekControls({read:()=>({...psfSong.read(),canSeek:psfSong.read().canSeek&&psfHasSongs&&!bankReadController}),seek:startPsfSeek,cancelSeek:cancelPsfSeek,
  getTags:()=>psfSet?.records.get($('psfEntry').value)?.tags,onError:report});
pausedAudition=createPsfPausedAudition({getAudio:()=>audio,getSelection:pausedSelection,getCapturePayload:()=>psfSong.capturePaused(),
  onUpdate(next){
    const tools=$('spuCodeLiveTools');tools.dataset.pausedAuditionState=next.state;tools.dataset.pausedAuditionHeld=String(next.heldCount);
    updateHeldStatus();visualizer.setRunning(performanceRunning());if(next.active)visualizer.wake();
  },
});
updatePsfPlayback(psfSong.read());
$('psfPlaySong').addEventListener('click',()=>{cancelPendingCapture();psfActionEpoch++;void psfSong.play().catch(report);});
$('psfPauseSong').addEventListener('click',()=>{cancelPendingCapture();void (async()=>{
  const initial=psfSong.read(),action=++psfActionEpoch,operation=assetEpoch;
  await stopPausedKeyboard({releaseEdited:true});
  if(disposed||action!==psfActionEpoch||operation!==assetEpoch)return;
  const next=psfSong.read();
  if(initial.paused&&next.paused)await psfSong.resume();else if(initial.playing&&next.playing)await psfSong.pause();
})().catch(report);});
$('psfStopSong').addEventListener('click',()=>{cancelPendingCapture();void (async()=>{
  const action=++psfActionEpoch,operation=assetEpoch,seekingStop=psfSeekBusy()?psfSong.stop():null;
  await stopPausedKeyboard({releaseEdited:true});
  if(seekingStop){await seekingStop;return;}
  if(!disposed&&action===psfActionEpoch&&operation===assetEpoch)await psfSong.stop();
})().catch(report);});
function updateBankControls() {
  const busy=Boolean(bankReadController);
  $('psfEntry').disabled=$('extractPsf').disabled=busy||!psfSet;
  setText('extractPsf',extractingPsf?'Extracting…':'Extract VAB');
  $('vabBank').disabled=busy||!bankChoices.length;
  $('vabTone').disabled=busy||!vabBank;
  $('loadVabTone').disabled=busy||!vabBank||$('vabTone').value==='';
  $('saveVabBank').disabled=busy||Boolean(bankSaveRequest)||!vabBank;
  $('saveVabTone').disabled=$('saveVabBank').disabled||$('vabTone').value==='';
  if(psfSong)updatePsfPlayback(psfSong.read());
}
function beginAssetOperation() {
  psfActionEpoch++;void stopPausedKeyboard().catch(report);
  if(psfSong?.read().seeking)void psfSong.cancelSeek().catch(report);
  const reading=Boolean(bankReadController);
  bankReadController?.abort(); bankReadController=null;extractingPsf=false;
  if (reading) vabStatus('Sound bank operation cancelled.');
  updateBankControls();
  return ++assetEpoch;
}
function chooseBank(index) {
  const choice=bankChoices[index]; if (!choice) return;
  vabBank=choice.bank; vabName=choice.name;
  const availability=new Map(),reasons=new Map(); let first=null,playable=0;
  $('vabTone').replaceChildren(...vabBank.tones.map((tone,index)=>{
    if (!availability.has(tone.sample)) {
      try {prepareVabTone(vabBank,index); availability.set(tone.sample,'');}
      catch (error) {availability.set(tone.sample,error.message);}
    }
    const reason=availability.get(tone.sample);
    const detail=reason?.replace(/^(?:VAB|SPU ADPCM):?\s*/,'');
    const option=new Option(`Program ${tone.program} · Tone ${tone.index} · Sample ${tone.sample} · ${noteName(tone.center)} +${tone.shift}/128 st · keys ${tone.keyLow}–${tone.keyHigh}${reason?` · unavailable: ${detail}`:''}`,String(index));
    option.disabled=Boolean(reason);
    if (reason) {option.title=reason;reasons.set(reason,(reasons.get(reason)??0)+1);}
    else {first??=index;playable++;}
    return option;
  }));
  $('vabTone').value=first===null?'':String(first);
  $('vabAvailability').hidden=false;
  $('vabAvailability').textContent=`${playable} / ${vabBank.tones.length} Tones available${reasons.size?' · see unavailable reasons below':'.'}`;
  const details=$('vabUnavailableDetails');details.hidden=!reasons.size;details.open=false;
  $('vabUnavailableReasons').replaceChildren(...[...reasons].map(([reason,count])=>{
    const item=document.createElement('li');item.textContent=`${count} Tone${count===1?'':'s'} · ${reason}`;return item;
  }));
  updateBankControls();
}
function showBanks(choices) {
  bankChoices=choices.map(choice=>({...choice,samples:new Map()}));
  $('vabBank').replaceChildren(...choices.map((choice,index)=>new Option(choice.name,String(index))));
  $('vabBank').value='0'; chooseBank(0);
}
$('vabBank').addEventListener('change',()=>{beginAssetOperation();chooseBank(Number($('vabBank').value));});
$('vabTone').addEventListener('change',()=>{beginAssetOperation();updateBankControls();});
async function saveVabPresets(all) {
  if(!vabBank||bankReadController||bankSaveRequest||!all&&$('vabTone').value==='')return;
  const request={},operation=assetEpoch,bank=vabBank,name=vabName,index=Number($('vabTone').value);
  // This is the authored Synth state, not the observed PSF channel's FX.
  const reverb=state?{preset:state.reverb.preset,volumeLeft:state.reverb.volumeLeft,volumeRight:state.reverb.volumeRight}:{preset:'off',volumeLeft:.25,volumeRight:.25};
  const current=()=>!disposed&&bankSaveRequest===request&&assetEpoch===operation&&vabBank===bank;
  bankSaveRequest=request;updateBankControls();
  try {
    await codeHost.ready;if(!current())return;
    const used=codeHost.project.fs.list().reduce((total,file)=>total+(file.type==='text'?new TextEncoder().encode(file.data).byteLength:file.data.byteLength),0);
    const bytes=exportVab(bank,all?{}:{toneNumber:index}),free=SPU_PROJECT_FILE_BYTES-used-bytes.byteLength;
    if(free<0)throw Error('The VAB exceeds the free space in the 16 MiB project. No presets were saved.');
    const result=all?prepareVabBankPresets(bank,{name,reverb,maxBytes:free}):{instruments:[prepareVabTonePreset(bank,index,{name,reverb})],unavailable:[]};
    const assetName=all?name:result.instruments[0].name;
    const paths=await codeHost.files.saveInstruments(result.instruments,{assets:[{name:assetName,data:bytes}],isCurrent:current});
    if(!current()||!paths)return;
    const reasons=new Map();for(const item of result.unavailable)reasons.set(item.reason,(reasons.get(item.reason)??0)+1);
    vabStatus(`Saved VAB + ${paths.length} Tone JSON${paths.length===1?'':'s'} to Files / presets.${result.unavailable.length?` ${result.unavailable.length} unavailable Tone${result.unavailable.length===1?'':'s'} skipped in JSON: ${[...reasons].map(([reason,count])=>`${count} × ${reason}`).join('; ')}`:''} Choose a VAB Tone or JSON from Preset below to load it.`);
  }catch(error){if(current()&&error.name!=='AbortError'){vabStatus(error.message,true);report(error);}}
  finally{if(bankSaveRequest===request){bankSaveRequest=null;updateBankControls();}}
}
for(const[id,all]of [['saveVabBank',true],['saveVabTone',false]]) {
  $(id).addEventListener('pointerdown',event=>{if(event.button===0){event.preventDefault();if(!codeHost?.isCodeMode())document.activeElement?.blur?.();}});
  $(id).addEventListener('click',()=>void saveVabPresets(all));
}
$('psfEntry').addEventListener('change',()=>{beginAssetOperation();if(psfSet)psfSong.setSource(psfSet,$('psfEntry').value);});
for(const button of document.querySelectorAll('[data-spu-import-input]'))
  button.addEventListener('click',() => $(button.dataset.spuImportInput).click());
function showPsfSongs(set,isFolder) {
  const songs=set.entries.filter(entry=>!/\.(?:psflib|psf1lib)$/i.test(entry.path));
  psfHasSongs=songs.length>0;
  // A library-only set retains the importer's extraction fallback. It is
  // explicitly labelled as libraries and cannot start a song from this UI.
  const entries=psfHasSongs?songs:set.entries;
  const paths=[...set.records.keys()],root=paths[0].split('/')[0];
  const folder=isFolder&&paths.every(path=>path.startsWith(root+'/'))?root:'';
  $('psfSongFolder').hidden=!folder;
  $('psfSongFolder').textContent=folder;
  $('psfSongFolder').title=folder;
  $('psfSongLabel').textContent=psfHasSongs?'PSF':'Library';
  $('psfEntry').replaceChildren(...entries.map(entry=>{
    const path=folder?entry.path.slice(folder.length+1):entry.path;
    const option=new Option(`${path}${entry.title?` · ${entry.title}`:''}`,entry.path);
    option.title=entry.path;return option;
  }));
}
async function openPsf(input,isFolder) {
  const selected=[...input.files]; input.value=''; if (!selected.length) return;
  const operation=beginAssetOperation(); preparation?.cancel();
  bankReadController=new AbortController(); const signal=bankReadController.signal;
  updateBankControls(); vabStatus('Reading PSF set…');
  try {
    const next=await readPsfFileSet(isFolder?selected.filter(file=>PSF_FILES.test(file.name)):selected,{signal});
    if (operation!==assetEpoch) return;
    psfSet=next;
    showPsfSongs(next,isFolder);
    psfSong.setSource(next,$('psfEntry').value);
    vabStatus(`Opened ${next.records.size} PSF/library files. Choose an entry to play the song or Extract VAB banks. Current instrument is kept.`);
  } catch (error) {if (operation===assetEpoch && error.name!=='AbortError') vabStatus(error.message,true);}
  finally {if (operation===assetEpoch) {bankReadController=null;updateBankControls();}}
}
$('psfFileInput').addEventListener('change',()=>openPsf($('psfFileInput'),false));
$('psfFolderInput').addEventListener('change',()=>openPsf($('psfFolderInput'),true));
$('extractPsf').addEventListener('click',async()=>{
  if (!psfSet || bankReadController) return;
  selectEditorTab('bank');
  $('instrumentPanel-bank').scrollIntoView({block:'nearest'});
  const operation=beginAssetOperation(), entry=$('psfEntry').value;
  preparation?.cancel(); bankReadController=new AbortController(); const signal=bankReadController.signal;
  extractingPsf=true;
  updateBankControls(); vabStatus('Expanding PSF libraries and searching for VAB banks…');
  try {
    const result=await extractPsfVabs(psfSet,entry,{signal});
    if (operation!==assetEpoch) return;
    if (!result.banks.length) {
      vabStatus(`No standard VAB found in ${entry}. Ambiguous VH/VB mappings, custom or runtime-packed banks need further support.${psfRejectionSummary(result)}${vabBank?' Previous bank is kept.':''}`);
      return;
    }
    showBanks(result.banks.map(found=>({bank:found.bank,name:found.layout==='split'
      ?`${entry} · VH @0x${(0x80000000+found.address).toString(16)} · matched VB @0x${(0x80000000+found.bodyAddress).toString(16)}`
      :`${entry} · VAB @0x${(0x80000000+found.address).toString(16)}`})));
    vabStatus(`Extracted ${result.banks.length} VAB banks from ${entry} (${result.loadedFiles.length} program overlays). Choose a bank and Tone, then load it.${psfRejectionSummary(result)}`);
  } catch (error) {if (operation===assetEpoch && error.name!=='AbortError') vabStatus(error.message,true);}
  finally {if (operation===assetEpoch) {bankReadController=null;extractingPsf=false;updateBankControls();}}
});
$('vabFileInput').addEventListener('change', async () => {
  const files = [...$('vabFileInput').files]; $('vabFileInput').value='';
  if (!files.length) return;
  const operation=beginAssetOperation(); preparation?.cancel();
  bankReadController=new AbortController(); updateBankControls();
  try {
    if (files.some(file => file.size > MAX_VAB_FILE_BYTES)) throw new RangeError('Each VAB / VH / VB file must be at most 1 MiB');
    let header, body;
    if (files.length===1 && !/\.vb$/i.test(files[0].name)) header=files[0];
    else if (files.length===2) {header=files.find(file => /\.vh$/i.test(file.name)); body=files.find(file => /\.vb$/i.test(file.name));}
    if (!header || files.length>1 && !body) throw new TypeError('Choose one VAB file, or one VH and one matching VB together');
    vabStatus('Reading sound bank…');
    const [vh, vb] = await Promise.all([header.arrayBuffer(), body?.arrayBuffer()]);
    const bank = readVab(vh, vb);
    if (operation!==assetEpoch) return;
    showBanks([{bank,name:header.name}]);
    vabStatus(`${vabName}: ${bank.programs.length} programs · ${bank.tones.length} tones · ${bank.samples.length} samples. Choose a Tone and load it.`);
  } catch (error) {if (operation===assetEpoch) vabStatus(`${error.message}${vabBank ? ' Previous bank is kept.' : ''}`,true);}
  finally {if (operation===assetEpoch) {bankReadController=null;updateBankControls();}}
});
$('loadVabTone').addEventListener('click', async () => {
  if (!vabBank || bankReadController || $('vabTone').value==='') return;
  const operation=beginAssetOperation(),bank=vabBank,name=vabName,index=Number($('vabTone').value);
  preparation?.cancel();
  try {
    // Parse/tune the Tone before changing either the author or the Code bank.
    const prepared=prepareVabTone(bank,index);
    const reverb=state?{preset:state.reverb.preset,volumeLeft:state.reverb.volumeLeft,volumeRight:state.reverb.volumeRight}:{preset:'off',volumeLeft:.25,volumeRight:.25};
    const instrument=prepareVabTonePreset(bank,index,{name,reverb});
    if(!await applyInstrumentDocument(instrument,{isCurrent:()=>operation===assetEpoch}))return;
    const message=`Loaded ${instrument.name} · ${prepared.adpcm.length} ADPCM bytes${prepared.trimmedBytes ? ` · ignored ${prepared.trimmedBytes} bytes after END` : ''}. Play the keyboard or use Save to presets.`;
    vabStatus(message);status(message);
  } catch(error){if(operation===assetEpoch){vabStatus(error.message,true);report(error);}}
});
$('savePreset').addEventListener('click', async () => {
  try {
    const name = $('instrumentName').value.trim() || 'Untitled';
    const instrument = await getInstrumentDocument();
    download(`${name.replace(/[^\p{L}\p{N}_. -]/gu, '_')}.spu.json`, JSON.stringify(instrument));
    status(`Saved ${name}, including its sample, ADSR, PMON, Noise, Software morph and shared reverb settings.`);
  } catch (error) {report(error);}
});
$('saveSoundToFiles').addEventListener('pointerdown',event=>{
  if(event.button===0){event.preventDefault();if(!codeHost?.isCodeMode())document.activeElement?.blur?.();}
});
$('saveSoundToFiles').addEventListener('click',async()=>{
  try {await codeHost.ready;await codeHost.files.saveSound();}
  catch(error){report(error);}
});
$('loadPreset').addEventListener('click', () => $('presetFileInput').click());
$('presetFileInput').addEventListener('change', async () => {
  const file = $('presetFileInput').files[0]; $('presetFileInput').value = ''; if (!file) return;
  const operation = beginAssetOperation();
  preparation?.cancel();
  try {
    if (file.size > MAX_INSTRUMENT_BYTES) throw new RangeError('Instrument file exceeds 224 MiB');
    const instrument = JSON.parse(await file.text());
    if (operation !== assetEpoch) return;
    await applyInstrumentDocument(instrument,{isCurrent:()=>operation===assetEpoch});
  } catch (error) {if (operation === assetEpoch) report(error);}
});
async function getInstrumentDocument() {
  const engine=await ensureAudio();
  return writeSpuInstrument($('instrumentName').value.trim()||'Untitled',await engine.command('getInstrument',[0]));
}
async function capturePsfVoice() {
  if(disposed||capturePending||!psfOwnsLiveView())return;
  const transport=psfSong,initial=transport.read(),unavailable=captureUnavailable(initial);
  if(unavailable){status(unavailable,true);return;}
  const request={cancelled:false};capturePending=request;updateCodeDisplay();
  const owner=audio,sourceSet=psfSet,entry=$('psfEntry').value,referenceNote=$('spuPsfReferenceKey').value;
  let operation=assetEpoch,committed=false,payload;
  const sourceCurrent=()=>{
    const live=transport.read();
    return psfSong===transport&&psfSet===sourceSet&&$('psfEntry').value===entry&&live.paused&&live.liveEnabled&&
      live.liveVoice===payload.voice&&live.captureFrame===payload.frame&&live.canCapture;
  };
  const current=()=>!disposed&&capturePending===request&&!request.cancelled&&operation===assetEpoch&&audio===owner&&(committed||sourceCurrent());
  try {
    // Freeze and validate the selected historical RAM synchronously. Neither
    // preparation nor the later capacity/cache queries stop the paused song.
    payload=transport.capturePaused();
    const baseName=(payload.source?.title||payload.source?.entry?.split('/').pop()||'PSF').slice(0,60);
    const noiseCapture=Boolean(payload.state.channels[payload.voice]?.noise);
    const prepared=preparePsfVoiceCapture(payload,{referenceNote,name:`${baseName}${noiseCapture?' Noise':''} CH ${payload.voice+1}`,
      reverb:{preset:state.reverb.preset,volumeLeft:state.reverb.volumeLeft,volumeRight:state.reverb.volumeRight}});
    readSpuInstrument(prepared.instrument);
    if(!current())return;
    operation=beginAssetOperation();preparation?.cancel();
    const applied=await applyInstrumentDocument(prepared.instrument,{isCurrent:current,deferStopForPreflight:true,preservePausedPsf:true,beforeStop(){
      if(!current())return false;
      // After committing, Synth view can edit the captured sound.
      // A newer source action still cancels this request through its owner.
      committed=true;return true;
    }});
    if(!applied||!current())return;
    // Select the copied editor instrument explicitly. Keep Live acquisition
    // and the source machine intact so the original CH activity stays visible.
    psfView='synth';updateCodeDisplay();
    await codeHost?.controls.setExpanded(false);if(!current())return;
    if(codeHost?.isCodeMode())await codeHost.controls.setMode('keyboard');if(!current())return;
    selectEditorTab('pcm');
    const captured=prepared.capture;
    if(captured.kind==='noise')status(`Captured Noise CH ${payload.voice+1} · Clock ${captured.noiseClock}. Keys trigger the envelope; Clock changes the noise character. Shared editor reverb kept.`);
    else status(`Captured CH ${payload.voice+1} · ${captured.byteLength.toLocaleString()} ADPCM bytes. ${referenceNote} reproduces PITCH ${captured.rawPitch}; play a new note to start its envelope. Shared editor reverb kept.${captured.warnings?.length?' '+captured.warnings.join(' '):''}`);
  } catch(error) {
    if(!disposed&&capturePending===request&&!request.cancelled&&operation===assetEpoch)report(error);
  } finally {
    if(capturePending===request){capturePending=null;updateCodeDisplay();}
  }
}
async function applyInstrumentDocument(value,{isCurrent=()=>true,beforeStop=()=>true,deferStopForPreflight=false,preservePausedPsf=false}={}) {
  const instrument=readSpuInstrument(value),operation=assetEpoch,codeAtStart=Boolean(codeHost?.isRunning());
  const current=()=>!disposed&&operation===assetEpoch&&isCurrent()&&(codeAtStart||!codeHost?.isRunning());
  if(!current())return false;
  if(preservePausedPsf&&(!deferStopForPreflight||!psfSong?.read().paused))return false;
  if(codeHost?.isRunning()) {
    const session=audio?.codeSession;
    if(!beforeStop())return false;
    const engine=await ensureAudio();if(!current())return false;
    if(!Number.isSafeInteger(session)||engine.codeSession!==session||!codeHost.isRunning())return false;
    // One transaction validates the authored checkpoint AND the resident Code
    // bank. Keep runtime/context/FX and client ownership; only held sample
    // voices may stop. Explicit Stop later restores this latest editor sound.
    await engine.command('applyInstrument',[value,session]);if(!current())return false;
    const snapshot=await engine.inspect();if(!current()||audio!==engine)return false;
    // Stop can win after the DSP committed but before its acknowledgement.
    // Reconcile the committed author name/state without restarting that owner
    // or claiming the cancelled Files selection as applied.
    instrumentName=instrument.name;$('instrumentName').value=instrumentName;
    applyState(snapshot);codeHost.markSoundDirty();
    if(engine.codeSession!==session||!codeHost.isRunning())return false;
    status(`Loaded ${instrument.name}. Code continues.`);return true;
  }
  // Code may own a temporary RAM bank. Ordinary imports must restore the
  // authored bank before looking up sample IDs or inspecting its capacity.
  // Only paused PSF Capture, whose editor bank is already resident, defers it.
  if(!deferStopForPreflight) {
    if(!beforeStop())return false;
    await stopCodeForEdit({isCurrent:current});if(!current())return false;
  }
  if(deferStopForPreflight){await stopPausedKeyboard();if(!current())return false;}
  const engine=await ensureAudio();if(!current())return false;
  const bank=await engine.inspect();if(!current())return false;
  const fixedAdpcm=!instrument.waveform&&instrument.version!==2;
  let sample=null;
  if(fixedAdpcm){
    const {adpcm,...options}=instrument.sample;
    sample=await engine.command('findADPCM',[adpcm,options]);if(!current())return false;
  }
  const requiredBytes=(fixedAdpcm&&!sample?instrument.sample.adpcm.length:0)+(instrument.pmon.enabled&&!bank.pmonSampleReserved?64:0);
  if(requiredBytes>524288-bank.nextAddress)throw new RangeError('Instrument exceeds free SPU sample RAM. Reload for a fresh bank.');
  if(deferStopForPreflight) {
    if(!current()||!beforeStop())return false;
    if(!preservePausedPsf)await stopCodeForEdit({isCurrent:current});
    if(!current())return false;
  }
  await stop({preservePausedPsf});if(!current())return false;
  if(instrument.waveform)await engine.command('setInstrumentWaveform',[instrument.waveform]);
  else if(instrument.version===2){const {pcm,...options}=instrument.sample;await engine.command('loadHostPCM',[pcm,options]);}
  else if(!sample){const {adpcm,...options}=instrument.sample;sample=await engine.command('loadADPCM',[adpcm,options]);}
  if(!current())return false;
  await engine.command('setInstrumentPreset',[{...instrument.preset,...(sample?{sample}:{})}]);
  if(!current())return false;
  for(const [method,args]of [['setReverb',[instrument.reverb]],['setInstrumentNoise',[instrument.noise]],['setInstrumentPmon',[instrument.pmon]],['setInstrumentMorph',[instrument.morph]]]){
    await engine.command(method,args);if(!current())return false;
  }
  instrumentName=instrument.name;$('instrumentName').value=instrumentName;
  status(`Loaded ${instrument.name}.`);applyState(await engine.inspect());codeHost?.markSoundDirty();return true;
}
$('resetPreset').addEventListener('click', async () => {
  const operation = beginAssetOperation(); preparation?.cancel();
  try {
    if(codeHost?.isRunning()) {
      const instrument=writeSpuInstrument('Sine',{preset:{volumeLeft:.75,volumeRight:.75,adsr1:15,adsr2:0,pitch:4096,reverb:false},
        sample:createPs1InitSample(),reverb:state?.reverb??{preset:'off',volumeLeft:.25,volumeRight:.25},waveform:morphPcm({enabled:true}),
        morph:{enabled:true},noise:{enabled:false},pmon:{enabled:false}});
      await applyInstrumentDocument(instrument,{isCurrent:()=>operation===assetEpoch});return;
    }
    await stopCodeForEdit();
    const engine = await ensureAudio();
    if (operation !== assetEpoch) return;
    await stop();
    if (operation !== assetEpoch) return;
    const pcm = Array.from({length:112}, (_, index) => .65 * Math.sin(2 * Math.PI * index / 112));
    await engine.command('setInstrumentWaveform', [pcm]);
    if (operation !== assetEpoch) return;
    await engine.command('setInstrumentPreset', [{volumeLeft:.75, volumeRight:.75, adsr1:15, adsr2:0, pitch:4096, reverb:false}]);
    if (operation !== assetEpoch) return;
    await engine.command('setInstrumentNoise', [{enabled:false}]);
    await engine.command('setInstrumentMorph', [{enabled:true}]);
    await engine.command('setInstrumentPmon', [{enabled:false}]);
    instrumentName = 'Sine'; $('instrumentName').value = instrumentName;
    codeHost?.markSoundDirty();
    status('Instrument reset to Sine.'); applyState(await engine.inspect());
  } catch (error) {report(error);}
});
window.addEventListener('pagehide', event => {
  if(!event.persisted){disposed=true;codeLive.dispose();psfChannelActivity.dispose();psfSeekControls?.dispose();}
  epoch++; beginAssetOperation(); preparation?.cancel(); releaseKeyboard(true); panel.setVisible(false);
  if (event.persisted) visualizer.stop(); else visualizer.dispose();
  void (async()=>{
    await stopPausedKeyboard({releaseEdited:true});
    if(event.persisted){await psfSong?.stop();await codeHost?.stop();}
    else{await pausedAudition?.dispose();await psfSong?.dispose();await codeHost?.dispose();}
    if(audio)await audio.stop();
  })().catch(()=>{});
});
renderKeyboard();

codeHost=setupSpuCodeHost({ensureAudio,getAudio:()=>audio,getInstrument:getInstrumentDocument,
  async applyInstrument(value,options){beginAssetOperation();preparation?.cancel();return applyInstrumentDocument(value,options);},
  async applyVabTone({bank,toneNumber,name},options){
    const reverb=state?{preset:state.reverb.preset,volumeLeft:state.reverb.volumeLeft,volumeRight:state.reverb.volumeRight}:{preset:'off',volumeLeft:.25,volumeRight:.25};
    const instrument=prepareVabTonePreset(bank,toneNumber,{name,reverb});
    beginAssetOperation();preparation?.cancel();return applyInstrumentDocument(instrument,options);
  },
  async stopKeyboard(){
    await stopPausedKeyboard({releaseEdited:true});
    epoch++;notes.clear();updateKeys();panel.releaseAll();$('sustainToggle').checked=false;
    if(bendFrame!==null){cancelAnimationFrame(bendFrame);bendFrame=null;}
    bend=0;for(const id of ['pitchBend','keyboardPitchBend'])$(id).value='0';for(const id of ['pitchValue','keyboardPitchValue'])$(id).textContent='0.00 st';
    if(audio){await audio.command('instrumentAllNotesOff');await audio.command('setInstrumentPitchBend',[0]);}
  },
  async beforeRun(){await stopPausedKeyboard({releaseEdited:true});await psfSong?.stop();beginAssetOperation();preparation?.cancel();},
  onActivity:codeActivity,setStatus:message=>status(message),
});
void codeHost.ready.catch(report);

// Desktop adapters reroute only the final bus. SPU rendering and monitoring
// stay in the same Web Audio graph, with no desktop API on ordinary websites.
if (window.__TAURI_INTERNALS__) {
  Object.defineProperty(window, 'tetoricaSynthAudio', {value:Object.freeze({
    setSwitching(value) {switchingAudioOutput = value === true;},
    async ensureReady() {const engine = await ensureAudio(); return {context:engine.context, output:engine.gain};},
    async stopPlayback() {await stop();},
  })});
  $('synthDesktopTools').hidden = false;
  window.dispatchEvent(new Event('tetorica-synth-ready'));
}
