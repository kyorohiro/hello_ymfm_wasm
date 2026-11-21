import {setupSynthExpandedTabs} from '../synth/synth_expanded_tabs.js';
import {createSnesChannelView,spcVariant} from './channel_view.js?v=shared-channel-editor-1';
import {createSnesMixer,setupSnesChipTabs} from './mixer.js';
// SPDX-License-Identifier: BSD-3-Clause
import {createSnesLooper} from './looper.js';
import {setupSnesLooperControls} from './looper_controls.js';
import {createSpcLiveInspector} from './spc_live.js?v=sound-library-1';
import {setupSnesMenu} from './menu.js';
import {createSnesSongPlayer} from './song_player.js?v=shared-channel-editor-1';
import {setupSnesSongControls} from './song_controls.js?v=spc-seek-controls-1';
import {setupSnesCodeHost} from './code_host.js?v=spc-menu-priority-1';
import {createSnesCodeClient} from './code_client.js';
import {createAudio} from './audio.js?v=spc-channel-edit-1';
import {createEditor} from './editor.js?v=adsr-graph-1';
import {createDefaultPreset, readPreset, presetToCode, pmonActive, presetBankKey, isWaveOnlyEdit} from './preset.js?v=sdsp-live-wave-1';
import {prepareAudio,prepareBrrFile} from './audio_import.js';
import {parseSpcVoices,parseSpcSnapshotVoices,MAX_SPC_BYTES} from './spc_import.js?v=spc-sample-inspection-1';
import {createSpcBrowser} from './spc_browser.js?v=spc-channel-edit-1';
const MAX_PRESET_BYTES=256*1024;
import {createSpuOutputVisualizer} from '../synth-spu/spu_synth_visualizer.js';
import {createFretboardState, createFretboardLayout, renderFretboardControls, buildKeyboard,
  setInstrument, setFretPosition, setStringWindowIndex, midiToNoteName} from '../synth/synth_keyboard.js';

const $ = id => document.getElementById(id);
const status = (text, error = false) => {
  $('audioStatus').textContent = text;
  $('audioStatus').dataset.error = String(error);
};
const report = error => status(error?.message ?? String(error), true);
let expandedTabs=null,codeHost=null,songControls=null,looperControls=null,liveInspector=null;
let looper=null,channelView=null,mixer=null,chipTabs=null,audition=null,previewSequence=0,previewKey=null,previewPlaying=false;
const performancePreset=()=>audition??preset;
const menu=setupSnesMenu();
const songPlayer=createSnesSongPlayer({ensureAudio,getAudio:()=>audio,onChange:state=>{songControls?.update(state);liveInspector?.update(state);channelView?.update(state);visualizer.setRunning(state.playing||Boolean(looper?.read().running)||notes.size>0||Boolean(codeHost?.isRunning()));}});
let audio = null, opening = null, spcBrowser = null, disposed = false, epoch = 0, sequence = 0, importSequence = 0, switchingAudioOutput = false;
let preset = createDefaultPreset(), revision = 0, octave = 0, pitch = 0;
let queue = Promise.resolve();
const notes = new Map(), fret = createFretboardState();
const pitchWheels = [[$('pitchBend'), $('pitchValue')], [$('keyboardPitchBend'), $('keyboardPitchValue')]];
const visualizer = createSpuOutputVisualizer({canvas: $('outputCanvas')});
visualizer.setMode('waveform');
const enqueue = action => {
  const task = queue.then(action);
  queue = task.catch(report);
  return task;
};
const capacity = () => pmonActive(performancePreset()) ? 4 : 8;
function updateKeys() {
  const keys = new Set([...notes.values()].map(note => note.key));
  for (const button of $('keyboard').querySelectorAll('.key')) {
    const active = keys.has(button.dataset.key);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  visualizer.setRunning(notes.size > 0 || Boolean(codeHost?.isRunning())||songPlayer.read().playing||Boolean(looper?.read().running));
  updateCapacity();
}
function readVoices(state) {
  const owners = new Set(state.voices.map(voice => voice.id));
  for (const [source, note] of notes) if (note.started && !owners.has(note.id)) notes.delete(source);
  updateKeys();
  updateCapacity();
}
function updateCapacity() {
  const selected=channelView?.read(),voice=selected?.view?.candidate?.voice;
  if(selected?.selected!==null&&voice){$('voiceCapacity').textContent=`CH${selected.selected+1} · SPC voice · ${voice.noise?'Hardware Noise':'PITCH '+voice.pitch}`;return;}
  const preset=performancePreset();
  $('voiceCapacity').textContent = preset.source==='noise'
    ? `Hardware Noise · shared clock ${preset.noise.clock} · 8 voice envelopes · ${notes.size} held`
    : pmonActive(preset)
      ? `Hardware PMON · 2 voices per note · 4 notes · round robin · ${notes.size} held`
      : `${preset.source==='wave'?'128-point wave → BRR':'BRR sample'} · 8 hardware voices · round robin · ${notes.size} held`;
}
function updatePresetUi() {
  const preset=performancePreset();
  const viewing=channelView?.read().selected!==null&&Boolean(channelView);
  const samplePreview=viewing&&!audition?channelView.read().view?.candidate?.samplePreview:null;
  $('snesVoiceFields').disabled=false;$('snesVoiceFields').hidden=false;$('voiceEditor').hidden=false;$('voiceEditor').dataset.channel=String(viewing);$('voiceEditor').dataset.sampleOnly=String(viewing&&!audition);
  const state=viewing?channelView.read():null;
  editor.update(preset,{samplePreview,channel:state?{index:state.selected,sourceId:state.sourceId,voice:state.view?.candidate?.voice,busy:state.busy,hasPreset:Boolean(audition),reason:state.view?.reason,transportRevision:state.transportRevision}:null});
  document.querySelector('.instrument-toolbar').inert=viewing;
  for(const id of ['synthMenuAudioImport','synthMenuBrrImport'])$(id).disabled=viewing;
  if (document.activeElement !== $('instrumentName')) $('instrumentName').value = preset.name;
  if (!$('codeOutput').hidden) {
    if (preset.source === 'brr' || pmonActive(preset) && preset.pmon.source === 'brr') {$('codeOutput').hidden=true;$('codeOutput').value='';}
    else $('codeOutput').value = presetToCode(preset);
  }
  $('copyCode').textContent = 'Copy JavaScript';
  setPitchUi(pitch);
  $('keyboardSourceHint').textContent=preset.source==='noise'
    ? 'Keys trigger Noise envelopes. Note names do not tune the sound.'
    : 'Every key plays the selected source. No keyboard split.';
  $('keyboardHint').textContent=preset.source==='noise'
    ? 'One shared Noise generator; each key has its own envelope. Noise clock changes its texture.'
    : pmonActive(preset)
      ? 'PMON uses two adjacent hardware voices per note. Four notes; when full, the oldest pair is replaced.'
      : 'When full, the oldest note is replaced.';
  updateCapacity();
  if (!layout || keyboardSource !== keyboardMode()) renderKeyboard();
  else updateKeys();
}
function audioFailed(error) {
  epoch++;
  notes.clear(); updateKeys();
  songPlayer.audioClosed();looper?.audioClosed();
  const failed = audio; audio = null;
  visualizer.disconnect();
  if (failed) void failed.dispose().catch(() => {});
  $('startAudio').textContent = 'Enable audio';
  void codeHost?.stop().catch(()=>{});
  report(error);
}
async function ensureAudio() {
  if (disposed) throw new Error('S-DSP Synth is closed');
  if (!audio && !opening) {
    $('startAudio').disabled = true;
    status('Preparing S-DSP audio…');
    opening = (async () => {
      const engine = await createAudio({volume: Number($('masterVolume').value), onError: audioFailed});
      try {
        // Source edits remain available while WASM loads. Adopt the latest draft.
        let applied, appliedPitch,appliedPreview;
        do {
          applied = revision; appliedPitch = pitch;appliedPreview=previewSequence;
          await engine.command('loadPreset', [readPreset(performancePreset())]);
          await engine.command('setPitch', [appliedPitch]);
        } while (applied !== revision || appliedPitch !== pitch||appliedPreview!==previewSequence);
        if (disposed) throw new Error('S-DSP Synth is closed');
        engine.setVolume(Number($('masterVolume').value));
        let client=null;
        engine.getSnesClient=async()=>{
          if(!client)client=createSnesCodeClient({timedPort:engine.timedPort,command:(...args)=>engine.command(...args),
            isCurrent:()=>audio===engine&&!disposed,onActivity:result=>{if(result?.stolenId)for(const [source,note]of notes)if(note.id===result.stolenId)notes.delete(source);updateKeys();visualizer.wake();}});
          return client;
        };
        engine.stopCode=async()=>{const previous=client;client=null;await previous?.dispose();};
        await mixer?.apply(engine);
        audio = engine;
        visualizer.connect(engine.context, engine.outputNode);
        $('startAudio').textContent = 'Audio ready';
        status('Audio ready · play the keyboard. Explore BRR, ADSR and GAIN.');
        return engine;
      } catch (error) {await engine.dispose(); throw error;}
    })().finally(() => {opening = null; $('startAudio').disabled = false;});
  }
  const engine = audio ?? await opening;
  await engine.resume();
  return engine;
}
function applyPreset(value, {load = false, message, fromSpc = false} = {}) {
  const next = readPreset(value);
  channelView?.reset();audition=null;previewKey='auto';previewPlaying=false;previewSequence++;
  if(!fromSpc) spcBrowser?.clearSelection();
  const previous = preset;
  const waveEdit = !load && isWaveOnlyEdit(previous,next);
  const replacesVoices = load || !waveEdit && presetBankKey(previous) !== presetBankKey(next);
  if (replacesVoices) {epoch++;notes.clear();updateKeys();}
  preset = next; revision++;
  const editRevision = revision;
  if (load || previous.source !== next.source) setPitchUi(0);
  updatePresetUi();
  codeHost?.markSoundDirty();
  if (!audio) {status(message ?? 'Instrument updated · enable audio, then play.'); return Promise.resolve();}
  return enqueue(async () => {
    const engine = audio;
    if (!engine) return;
    try {
      await engine.command(load ? 'loadPreset' : 'setPreset', [next]);
      if (load || previous.source !== next.source) await engine.command('setPitch', [0]);
      const state = await engine.read();
      if (audio !== engine) return;
      readVoices(state);
      visualizer.wake();
      if (revision === editRevision) status(message ?? (waveEdit
        ? 'Wave updated · held notes, release tails and Echo keep playing.'
        : replacesVoices
        ? 'Sample, PMON or Echo layout updated · previous notes and tails stopped. Play the keyboard.'
        : 'Instrument updated · hardware volume, envelopes, tuning, PMON ratio, Noise clock and Echo settings apply live.'));
    } catch (error) {
      if (audio === engine && revision === editRevision) {
        preset = (await engine.read()).preset;
        updatePresetUi();codeHost?.markSoundDirty();
      }
      throw error;
    }
  });
}
async function loadSample(file,options,isBrr) {
  const target=options.target??'carrier';
  if(!['carrier','modulator'].includes(target))throw new TypeError('Unknown sample target');
  const tuning=target==='modulator'?preset.pmon.brr:preset.brr;
  const token=++importSequence, draftRevision=revision;
  const prepared=isBrr ? await prepareBrrFile(file,{...options,rootNote:tuning.rootNote,basePitch:tuning.basePitch})
    : await prepareAudio(file,options);
  if(options.signal?.aborted) throw new DOMException('Sample import cancelled','AbortError');
  if(disposed||token!==importSequence||draftRevision!==revision) return 'Import discarded · instrument changed. Previous sound kept.';
  const next=readPreset(target==='modulator'
    ? {...preset,pmon:{...preset.pmon,source:'brr',brr:prepared}}
    : {...preset,source:'brr',name:prepared.name.slice(0,80),brr:prepared});
  options.onCommit?.();
  await applyPreset(next,{load:true,message:`Loaded ${prepared.name} · ${target} BRR sample · play the keyboard.`});
  return `Loaded ${prepared.name} into ${target}. Root note and base PITCH declare tuning; BRR does not store them.`;
}
const editor=createEditor({root:$('voiceEditor'),onVoiceEdit:changes=>channelView.edit(changes),onChange:value=>{void applyPreset(value).catch(report);},onError:report,
  onLoadAudio:(file,options)=>loadSample(file,options,false),onLoadBrr:(file,options)=>loadSample(file,options,true)});
const spcCancelled = () => new DOMException('SPC import cancelled','AbortError');
async function openSpc(file,{signal,onCommit=()=>{}}={}) {
  const request=++importSequence;
  if(disposed||signal?.aborted)throw spcCancelled();
  if(!Number.isSafeInteger(file?.size)||file.size<0||file.size>MAX_SPC_BYTES)throw new RangeError('SPC must be at most 16 MiB');
  const data=await file.arrayBuffer(),current=()=>!disposed&&!signal?.aborted&&request===importSequence;
  if(!current())throw spcCancelled();
  const candidates=parseSpcVoices(data,{name:file.name}),options=spcBrowser.getImportOptions();
  const sounds=candidates.candidates.map(candidate=>spcVariant(candidate,options)?.preset).filter(Boolean);
  const result=await codeHost.files.addSounds(sounds,{source:{name:file.name,bytes:new Uint8Array(data)},isCurrent:current,onCommit});
  if(!result||!current())throw spcCancelled();
  songPlayer.loadSource(data,{name:file.name,isCurrent:current});await mixer.apply();refreshSongFiles();$('snesSongSelect').value=result.sourcePath;return candidates;
}
async function openStoredSpc(file,{path,isCurrent}){
  if(!isCurrent())return false;const data=file.data,candidates=parseSpcVoices(data,{name:path.split('/').pop()});
  if(!isCurrent())return false;importSequence++;songPlayer.loadSource(data,{name:path.split('/').pop(),isCurrent});spcBrowser.showSource(candidates);await mixer.apply();$('snesSongSelect').value=path;return true;
}
function refreshSongFiles(){
  if(!codeHost)return;const select=$('snesSongSelect'),current=select.value,files=codeHost.project.fs.list().filter(file=>file.type==='binary'&&/\.spc$/i.test(file.path));
  const signature=files.map(file=>file.path).join('\n');if(select.dataset.signature===signature)return;select.dataset.signature=signature;
  select.replaceChildren(new Option('Choose SPC in Files…',''),...files.map(file=>new Option(file.path.split('/').pop(),file.path)));select.value=files.some(file=>file.path===current)?current:'';
}
async function selectSpc(candidate,{includeEcho=false,includePmon=false,signal,onCommit}={}) {
  if(disposed||signal?.aborted) throw spcCancelled();
  if(typeof includeEcho!=='boolean') throw new TypeError('SPC Echo import option must be boolean');
  if(typeof includePmon!=='boolean') throw new TypeError('SPC PMON import option must be boolean');
  const pair=includePmon&&candidate?.voice.pitchModulation&&!candidate?.voice.noise;
  const variant=spcVariant(candidate,{includeEcho,includePmon});
  if(!variant?.preset) throw new Error(variant?.reason??'This SPC voice is unavailable');
  const next=readPreset(variant.preset);
  const sourceLabel=pair?`PMON CH${candidate.pmonPair.modulatorVoice.index+1} → CH${candidate.voice.index+1}`
    :next.source==='noise'?`Noise clock ${next.noise.clock}`:`SRCN ${candidate.voice.sourceNumber}`;
  const echoLabel=includeEcho?(next.echo.enabled?'Echo / FIR imported':'Echo / FIR settings imported · Echo Off'):'dry voice';
  // Invalidate older audio / preset file reads before this explicit adoption.
  const token=++importSequence;
  onCommit?.();
  const applying=applyPreset(next,{load:true,fromSpc:true,message:`Loaded SPC CH${candidate.voice.index+1} · ${sourceLabel} · ${echoLabel}. Play the keyboard.`});
  const adoptedRevision=revision;
  await applying;
  if(disposed||signal?.aborted||token!==importSequence||adoptedRevision!==revision) throw spcCancelled();
  const tuningHint=pair?'Both captured PITCH values are declared at C4. The modulator is muted in the mix; its hardware envelope drives PMON.'
    :next.source==='noise'?'Keys trigger envelopes; Noise clock controls the shared generator.'
    :'Snapshot PITCH is declared at C4; adjust Root note to retune.';
  return `Loaded CH${candidate.voice.index+1} · ${sourceLabel} · ${echoLabel}. ${tuningHint}`;
}
spcBrowser=createSpcBrowser({root:$('spcBrowser'),onOpen:openSpc,onSelect:selectSpc,onError:report});
liveInspector=createSpcLiveInspector({root:spcBrowser.liveRoot,onError:report,onSave:()=>codeHost?.files.askSaveSound(),async onCapture(index){
  const token=++importSequence,draftRevision=revision,options=spcBrowser.getImportOptions();
  const captured=await songPlayer.capture();
  const current=()=>!disposed&&draftRevision===revision&&captured.isCurrent();
  if(token!==importSequence||!current())throw spcCancelled();
  const batch=parseSpcSnapshotVoices(captured.snapshot,{name:captured.name,metadata:captured.metadata});
  const candidate=batch.candidates[index];
  if(!candidate)throw new Error('SPC channel is unavailable');
  const message=await selectSpc(candidate,{...options,onCommit(){if(!current())throw spcCancelled();spcBrowser.clearSelection();}});
  return `Captured CH${index+1} at ${Number(batch.positionSeconds??0).toFixed(2)} s · ${message}`;
}});
liveInspector.update(songPlayer.read());

const keyboard = document.createElement('div'); keyboard.className = 'keyboard';
$('keyboard').append(keyboard);
const tools = Object.fromEntries(['instrument','position','fret','strings','window'].map(name => {
  const node = document.createElement('div');
  node.className = `fretboard-${name} ${['fret','strings'].includes(name) ? 'fret-display' : 'toolbar-group'}`;
  return [name,node];
}));
const toolbar = document.createElement('div'); toolbar.className = 'fretboard-toolbar';
const summary = document.createElement('div'); summary.className = 'fretboard-row fretboard-summary'; summary.append(tools.fret,tools.strings);
const choices = document.createElement('div'); choices.className = 'fretboard-row';
for (const name of ['instrument','position','window']) choices.append(tools[name]);
toolbar.append(summary,choices); $('keyboardFretboard').append(toolbar);
let layout, keyboardSource;
const keyboardMode = () => {const preset=performancePreset();return preset.source==='noise'?'noise':`${preset.source}:${Boolean(preset.brr.data)}:${preset.brr.rootNote}:${preset.brr.basePitch}:${pmonActive(preset)}:${preset.pmon.source}:${Boolean(preset.pmon.brr.data)}`;};
function renderKeyboard() {
  const preset=performancePreset();
  {
    keyboardSource = keyboardMode();
    layout = createFretboardLayout({state:fret});
    renderFretboardControls({instrumentRoot:tools.instrument,positionRoot:tools.position,fretDisplayRoot:tools.fret,
      stringDisplayRoot:tools.strings,stringWindowRoot:tools.window,state:fret,
      onInstrumentChange(value) {stopNotes();setInstrument(fret,value);renderKeyboard();},
      onPositionPresetSelect(value) {stopNotes();setFretPosition(fret,value);renderKeyboard();},
      onStringWindowChange(value) {stopNotes();setStringWindowIndex(fret,value);renderKeyboard();}});
    const entries = layout.entries.map(entry => ({...entry,midi:entry.midi+octave*12,noteName:midiToNoteName(entry.midi+octave*12)}));
    buildKeyboard({root:keyboard,rowDefs:layout.rowDefs,layoutEntries:entries,showPitch:false,
      onPointerDown(event,entry) {if (event.button===0) press(`pointer:${event.pointerId}`,entry);},
      onPointerUp(event) {release(`pointer:${event.pointerId}`);},onPointerCancel(event) {release(`pointer:${event.pointerId}`);}});
    for (const button of keyboard.querySelectorAll('.key')) {
      const entry = entries.find(item => item.key === button.dataset.key);
      button.disabled = !canPlay(entry.midi);
      if (button.disabled) button.title = 'Outside the S-DSP PITCH range. Change octave or sample tuning.';
      button.addEventListener('keydown', event => {
        if (event.key===' '||event.key==='Enter') {event.preventDefault(); if(!event.repeat) press(`button:${entry.key}`,entry);}
      });
      button.addEventListener('keyup',event=>{if(event.key===' '||event.key==='Enter') {event.preventDefault();release(`button:${entry.key}`);}});
    }
  }
  $('octaveValue').textContent = preset.source==='noise'?'—':`${octave>0?'+':''}${octave}`;
  $('octaveDown').disabled = preset.source==='noise'||octave<=-2; $('octaveUp').disabled = preset.source==='noise'||octave>=2;
  updateKeys();
}
function canPlay(midi) {
  const preset=performancePreset();
  if(!Number.isInteger(midi)||midi<0||midi>127||preset.source==='brr'&&!preset.brr.data) return false;
  if(preset.source==='noise') return true;
  if(pmonActive(preset)&&preset.pmon.source==='brr'&&!preset.pmon.brr.data)return false;
  const raw=preset.source==='wave' ? 4096*(440*2**((midi-69)/12))/(32000/128)
    : preset.brr.basePitch*2**((midi-preset.brr.rootNote)/12);
  return Math.round(raw)>=1&&Math.round(raw)<=16383;
}
function press(source, entry) {
  if (switchingAudioOutput||notes.has(source)||!canPlay(entry.midi)) return;
  if(channelView?.read().selected!==null&&channelView&&(songPlayer.read().playing||!audition)){status('Pause SPC and select a playable channel to audition.');return;}
  const note = {id:`sdsp-synth:${++sequence}`,key:entry.key,midi:entry.midi,epoch,started:false};
  notes.set(source,note); updateKeys();
  void enqueue(async () => {
    if (switchingAudioOutput || notes.get(source)!==note || note.epoch!==epoch) return;
    const engine = await ensureAudio();
    if (switchingAudioOutput||notes.get(source)!==note||note.epoch!==epoch) return;
    note.started = true;
    const result = await engine.command('noteOn',[note.id,note.midi]);
    if (audio!==engine||note.epoch!==epoch) return;
    if (result.stolenId) for (const [key,old] of notes) if (old.id===result.stolenId) notes.delete(key);
    readVoices(await engine.read());
    const preset=performancePreset();const label=preset.source==='noise'?`Noise clock ${preset.noise.clock}`:midiToNoteName(note.midi);
    status(`${label} · ${notes.size}/${capacity()} ${pmonActive(preset)?'notes · hardware PMON':'voices'} · hardware ${preset.envelope.mode==='adsr'?'ADSR':'GAIN'}`);
  }).catch(error=>{if(notes.get(source)===note) notes.delete(source);updateKeys();report(error);});
}
function release(source) {
  const note = notes.get(source);
  if (!note) return;
  notes.delete(source);updateKeys();
  if (note.started) void enqueue(async()=>{
    if (audio && note.epoch===epoch) {await audio.command('noteOff',[note.id]);updateCapacity();}
  });
}
function stopNotes(message) {
  const held=[...notes.values()];epoch++;notes.clear();updateKeys();
  return enqueue(async()=>{
    if(audio)for(const note of held)if(note.started)await audio.command('noteOff',[note.id]);
    if(!codeHost?.isRunning()&&!songPlayer.read().playing&&!looper?.read().running)visualizer.stop();if(message)status(message);
  });
}
$('startAudio').addEventListener('click',()=>{$('startAudio').blur();void enqueue(ensureAudio).catch(report);});
$('stopAudio').addEventListener('click',()=>{$('stopAudio').blur();void (async()=>{looper.stop();await songPlayer.stop();await codeHost.stop();await stopNotes();if(audio)await audio.command('stop');status('Stopped · instrument retained. Play to resume.');})().catch(report);});
for(const [id,delta] of [['octaveDown',-1],['octaveUp',1]]) $(id).addEventListener('click',()=>{
  if(performancePreset().source==='noise') return;
  $(id).blur();stopNotes();octave=Math.max(-2,Math.min(2,octave+delta));renderKeyboard();
});
function editing(target) {
  if(target?.closest?.('#synthCodeEditorHost,.monaco-editor,#snesFilesPanel,#synthMenu[open]'))return true;
  const control = target?.closest?.('input,select,textarea,[contenteditable="true"],dialog[open]');
  return control && !control.matches?.('input[type="range"],input[type="checkbox"],input[type="radio"]');
}
window.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.metaKey||event.altKey||editing(event.target)) return;
  const key=event.key.toLowerCase(),entry=layout.entries.find(item=>item.key===key);
  if(!entry) return;
  event.preventDefault(); if(!event.repeat) press(`key:${event.code||key}`,{...entry,midi:entry.midi+octave*12});
});
window.addEventListener('keyup',event=>release(`key:${event.code||event.key.toLowerCase()}`));
window.addEventListener('blur',()=>{stopNotes();setPitch(0);});
document.addEventListener('visibilitychange',()=>{if(document.hidden) {stopNotes();setPitch(0);}});
function setPitchUi(value) {
  const preset=performancePreset();
  const noise=preset.source==='noise';
  pitch=noise?0:value;
  for (const [wheel, output] of pitchWheels) {
    wheel.value=String(pitch);wheel.disabled=noise;
    output.textContent=noise?'—':`${pitch>=0?'+':''}${pitch.toFixed(2)}`;
    wheel.closest('label').title=noise?'Noise uses the shared Noise clock; Pitch does not tune it.'
      :'Software pitch bend, ±2 semitones. Release to return to center.';
  }
}
function setPitch(value) {
  const preset=performancePreset();
  if(preset.source==='noise'){setPitchUi(0);return;}
  const previous=pitch;setPitchUi(value);
  if(audio) void enqueue(async()=>{
    try{await audio?.command('setPitch',[value]);visualizer.wake();}
    catch(error){if(pitch===value) setPitchUi(previous);throw error;}
  });
}
for (const [wheel] of pitchWheels) {
  wheel.addEventListener('input',()=>setPitch(Number(wheel.value)));
  for(const event of ['pointerup','pointercancel','lostpointercapture','change']) wheel.addEventListener(event,()=>setPitch(0));
  wheel.addEventListener('keydown',event=>{if(event.key==='Home'||event.key==='Escape') {event.preventDefault();setPitch(0);}});
}
function setVolume() {
  const value=Number($('masterVolume').value);
  $('masterVolumeValue').textContent=`${Math.round(value*100)}%`;
  $('masterVolume').dataset.boosted=String(value>1);
  audio?.setVolume(value);visualizer.wake();
}
$('masterVolume').addEventListener('input',setVolume);
$('masterVolume').addEventListener('change',()=>$('masterVolume').blur());
for(const button of document.querySelectorAll('[data-visual-mode]')) button.addEventListener('click',()=>{
  const mode=button.dataset.visualMode;visualizer.setMode(mode);
  for(const peer of document.querySelectorAll('[data-visual-mode]')) peer.setAttribute('aria-pressed',String(peer===button));
  button.blur();
});
const monitorResize = new ResizeObserver(() => {
  const canvas=$('outputCanvas');
  if(!canvas.clientWidth||!canvas.clientHeight) return;
  canvas.width=Math.max(240,Math.round(canvas.clientWidth));
  canvas.height=Math.max(150,Math.round(canvas.clientHeight));
  visualizer.setMode(document.querySelector('[data-visual-mode][aria-pressed="true"]').dataset.visualMode);
});
monitorResize.observe($('outputCanvas'));
function commitName() {void applyPreset({...preset,name:$('instrumentName').value}).catch(report);$('instrumentName').blur();}
$('instrumentName').addEventListener('change',commitName);
$('instrumentName').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commitName();}});
function saveFile(name, text) {
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('savePreset').addEventListener('click',()=>{
  $('savePreset').blur();
  try{saveFile('sdsp-voice.json',JSON.stringify(readPreset(preset),null,2)+'\n');status('Preset saved · waveform, BRR sample, tuning and hardware envelope included.');}catch(error){report(error);}
});
$('loadPreset').addEventListener('click',()=>{$('loadPreset').blur();$('presetFileInput').click();});
$('presetFileInput').addEventListener('change',async()=>{
  const file=$('presetFileInput').files?.[0];$('presetFileInput').value='';$('presetFileInput').blur();
  if(!file) return;
  const token=++importSequence, draftRevision=revision;
  try {
    if(file.size>MAX_PRESET_BYTES) throw new Error('Preset must be at most 256 KiB');
    const next=readPreset(JSON.parse(await file.text()));
    if(disposed||token!==importSequence||draftRevision!==revision) return;
    const added=await codeHost.files.addSounds([next],{isCurrent:()=>!disposed&&token===importSequence&&draftRevision===revision});
    if(!added)return;if(disposed||token!==importSequence||draftRevision!==revision){status('Preset added to Files · current edit kept.');return;}
    await applyPreset(next,{load:true,message:'Preset added to /presets and loaded · play the keyboard.'});
  }catch(error){report(error);}
});
$('resetPreset').addEventListener('click',()=>{$('resetPreset').blur();void applyPreset(createDefaultPreset(),{load:true,message:'Instrument reset · Sine ready.'}).catch(report);});
$('copyCode').addEventListener('click',async()=>{
  $('copyCode').blur();
  try {
    const code=presetToCode(preset);$('codeOutput').value=code;$('codeOutput').hidden=false;
    const destination='paste into Playground SNES mode';
    try{await navigator.clipboard.writeText(code);status(`JavaScript copied · ${destination}.`);}
    catch{status(`JavaScript ready below · ${destination}.`);}
  }catch(error){report(error);}
});
window.addEventListener('pagehide',event=>{
  if(event.persisted){looper.stop();void songPlayer.pause().catch(report);void codeHost?.stop();stopNotes();return;}
  disposed=true;epoch++;notes.clear();expandedTabs?.dispose();looper.dispose();monitorResize.disconnect();visualizer.dispose();editor.dispose();liveInspector.dispose();spcBrowser.dispose();menu.dispose();looperControls?.dispose();channelView.dispose();chipTabs.dispose();unwatchSongFiles();songControls?.dispose();songPlayer.dispose();void (async()=>{try{await codeHost?.dispose();}finally{await audio?.dispose();audio=null;}})().catch(()=>{});
});
looper=createSnesLooper({ensureAudio,releaseNotes:()=>stopNotes(),
  beforeStart:async()=>{if(switchingAudioOutput)throw new Error('Wait for audio output switching.');if(codeHost?.isCodeMode()||codeHost?.isRunning())throw new Error('Stop Code and choose Keyboard to use Looper.');await stopNotes();},
  onChange:()=>{looperControls?.update();visualizer.setRunning(notes.size>0||Boolean(codeHost?.isRunning())||songPlayer.read().playing||Boolean(looper?.read().running));}});
looperControls=setupSnesLooperControls({looper,isBlocked:()=>switchingAudioOutput||Boolean(codeHost?.isCodeMode()||codeHost?.isRunning()),onError:report});
mixer=createSnesMixer({getAudio:()=>audio,player:songPlayer,onChange:()=>chipTabs?.update()});
chipTabs=setupSnesChipTabs({onSelect:button=>expandedTabs?.showChip(button),mixer,onError:report});
channelView=createSnesChannelView({onState:()=>updatePresetUi(),player:songPlayer,getOptions:()=>spcBrowser.getImportOptions(),onError:report,
  onBeforeSelect:async value=>{if(value!==null)await codeHost?.stop();await stopNotes();},
  onView(state){
    const token=++previewSequence,key=state.selected===null?'auto':state.sourceId+':'+state.selected,replace=key!==previewKey,wasPlaying=previewPlaying;previewKey=key;previewPlaying=state.playing;
    audition=state.selected===null?null:state.view?.preset??null;if(replace||state.playing)setPitchUi(0);updatePresetUi();
    if(state.selected!==null&&(state.playing||!audition)){if(state.playing&&wasPlaying&&!replace)return;return stopNotes().then(()=>enqueue(()=>audio?.command('setPitch',[0]))).catch(report);}
    return enqueue(async()=>{if(disposed||token!==previewSequence||!audio)return;await audio.command(replace?'loadPreset':'setPreset',[performancePreset()]);if(token!==previewSequence)return;readVoices(await audio.read());}).catch(report);
  },onCopy:candidate=>selectSpc(candidate,{...spcBrowser.getImportOptions(),onCommit:()=>spcBrowser.clearSelection()})});
channelView.update(songPlayer.read());
for(const id of ['spcIncludeEcho','spcIncludePmon'])$(id).addEventListener('change',()=>channelView.refresh());
$('snesVoiceFields').addEventListener('pointerdown',event=>{if($('snesVoiceFields').disabled&&!event.target.closest('summary')){event.preventDefault();event.stopImmediatePropagation();}},true);
$('snesSongSelect').addEventListener('change',()=>{const path=$('snesSongSelect').value;if(path)void codeHost.files.selectFile(path).catch(report);});
songControls=setupSnesSongControls({player:songPlayer,onError:report,setMuteMask:value=>mixer.setMuteMask(value)});
updatePresetUi();setVolume();setPitchUi(0);
codeHost=setupSnesCodeHost({onViewChange:mode=>expandedTabs?.showInput(mode),onExpandedChange:value=>expandedTabs?.setExpanded(value),onBeforeRun:()=>channelView.read().selected===null?undefined:channelView.select(null),onOpenSource:openStoredSpc,ensureAudio,getAudio:()=>audio,getSettings:()=>readPreset(preset),
  applySettings:async(value,{isCurrent=()=>true}={})=>{if(!isCurrent())return false;await applyPreset(value,{load:true});return isCurrent();},
  stopLooper:()=>looper.stop(),clearLooper:()=>looper.clear(),stopSong:()=>songPlayer.stop(),stopKeyboard:()=>stopNotes(),setStatus:status,onActivity:()=>{looperControls?.update();visualizer.setRunning(notes.size>0||Boolean(codeHost?.isRunning())||songPlayer.read().playing||Boolean(looper?.read().running));}});
expandedTabs=setupSynthExpandedTabs({codeControls:codeHost.controls,selectChip:button=>chipTabs.select(button),elements:{editor:$('snesSynthEditor'),chipTabs:[$('snesChipTab'),$('snesMixerTab')],volume:$('masterVolume').closest('.master-control')}});
const unwatchSongFiles=codeHost.project.onDidChange(refreshSongFiles);
void codeHost.ready.then(refreshSongFiles).catch(report);

// Desktop adapters change only the final Master bus. The S-DSP, allocator
// and output monitor keep using the same graph; ordinary sites expose no API.
const localDesktop = (location.protocol === 'tauri:' && location.hostname === 'localhost') ||
  (['http:', 'https:'].includes(location.protocol) && location.hostname === 'tauri.localhost');
if (window.top === window && localDesktop && window.__TAURI_INTERNALS__) {
  Object.defineProperty(window, 'tetoricaSynthAudio', {value:Object.freeze({
    setSwitching(value) {switchingAudioOutput = value === true;looperControls?.update();},
    async ensureReady() {const engine = await ensureAudio(); return {context:engine.context, output:engine.outputNode};},
    async stopPlayback() {
      setPitchUi(0);
      looper.stop();await songPlayer.pause();await codeHost.stop();await stopNotes();
      await enqueue(async () => {if (audio) await audio.command('setPitch', [0]);});
    },
  })});
  window.dispatchEvent(new Event('tetorica-synth-ready'));
}
