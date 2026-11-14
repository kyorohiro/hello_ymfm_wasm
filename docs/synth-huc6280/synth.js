// SPDX-License-Identifier: BSD-3-Clause
import {createAudio} from './audio.js?v=cdrom2-1';
import {createMsm5205Source} from './msm5205_source.js?v=huc-cdda-ui-1';
import {setupMsm5205Controls} from './msm5205_controls.js';
import {createCddaSource} from './cdda_source.js';
import {createCddaSessionFiles} from './cdda_session_files.js';
import {createCddaInputReader} from './cdda_inputs.js';
import {setupCddaControls} from './cdda_controls.js';
import {createPcEngineSourceMix,setupPcEngineSourceMix} from './source_mix.js';
import {addPcEngineCodeExamples} from './cdrom2_examples.js?v=huc-channel-ui-1';
import {createEditor} from './editor.js?v=huc-vgm-manual-2';
import {setupHuc6280CodeHost} from './code_host.js?v=huc-channel-ui-1';
import {createHuc6280CodeLive,huc6280CodeLiveView} from './code_live.js?v=huc-live-1';
import {createHuc6280CodeEdit} from './code_parameter_edit.js?v=huc-code-1';
import {setupSynthMenu} from '../synth/synth_menu.js';
import {createVgmLibrary} from './vgm_library.js?v=huc-capture-1';
import {setupHuc6280SongControls} from './song_controls.js?v=huc-channel-ui-1';
import {huc6280SongLiveView} from './song_live.js?v=huc-live-1';
import {createHuc6280SongAudition} from './song_audition.js?v=huc-capture-1';
import {createDefaultPreset, readPreset, presetToCode, isWaveOnlyEdit} from './preset.js?v=wave-held-1';
import {prepareDdaAudio} from './audio_import.js';
import {prepareHuc6280SelectedPreset} from './selected_preset.js?v=huc-channel-ui-1';
import {MAX_PRESET_BYTES} from './dda_pcm.js';
import {createSpuOutputVisualizer} from '../synth-spu/spu_synth_visualizer.js';
import {createFretboardState, createFretboardLayout, renderFretboardControls, buildKeyboard,
  setInstrument, setFretPosition, setStringWindowIndex, midiToNoteName} from '../synth/synth_keyboard.js';

const $ = id => document.getElementById(id);
const status = (text, error = false) => {
  $('audioStatus').textContent = text;
  $('audioStatus').dataset.error = String(error);
};
const report = error => status(error?.message ?? String(error), true);
let audio = null, opening = null, disposed = false, epoch = 0, sequence = 0, importSequence = 0, switchingAudioOutput = false;
let preset = createDefaultPreset(), revision = 0, octave = 0, pitch = 0;
let queue = Promise.resolve();
let vgmLibrary = null, codeHost = null, codeLive = null, editorLive=null, codeWasRunning=false, channelTarget = 'synth', autoUpdate=true, displayedPreset = null, liveSignature = null;
let msmSource=null,msmControls=null,cddaSource=null,cddaControls=null,cddaReader=null;
const cddaSession=createCddaSessionFiles();
let songControls=null, songState=null, chipView='huc6280';
const sourceMix=createPcEngineSourceMix();
const sourceMixerUi=setupPcEngineSourceMix({root:$('hucSourceMixer'),mix:sourceMix});
const unsubscribeSourceMix=sourceMix.onChange(value=>{
  try{audio?.setSourceMix(value);songControls?.setSourceMix(value);visualizer.wake();}catch(error){report(error);}
});
let audition=null,auditionSelectionKey=null,channelSelection=0;
let selectedPresetKey='',selectedPresetResult=null,savingSelectedPreset=false;
const notes = new Map(), auditionNotes=new Map(), fret = createFretboardState();
const pitchWheels = [[$('pitchBend'), $('pitchValue')], [$('keyboardPitchBend'), $('keyboardPitchValue')]];
const visualizer = createSpuOutputVisualizer({canvas: $('outputCanvas')});
visualizer.setMode('waveform');
const enqueue = action => {
  const task = queue.then(action);
  queue = task.catch(report);
  return task;
};
const capacity = () => preset.source === 'noise' ? 2 : preset.source === 'wave' && preset.lfo.enabled ? 1 : 6;
const channelContext=()=>['starting','seeking','playing','paused'].includes(songState?.playback)?'vgm':codeHost?.isRunning()?'code':'synth';
function updateKeys() {
  const keys = new Set([...notes.values(),...auditionNotes.values()].map(note => note.key));
  for (const button of $('keyboard').querySelectorAll('.key')) {
    const active = keys.has(button.dataset.key);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const trial=audition?.read();
  visualizer.setRunning(notes.size > 0 || auditionNotes.size>0 || Boolean(trial?.soundingCount) || trial?.state==='preparing' || trial?.state==='stopping' || Boolean(codeHost?.isRunning()) || Boolean(songState?.playing) || msmSource?.read().state==='playing' || cddaSource?.read().state==='playing');
  updateCapacity();
}
function readVoices(state) {
  const owners = new Set(state.voices.map(voice => voice.id));
  for (const [source, note] of notes) if (note.owner!=='song'&&note.started&&!owners.has(note.id)) notes.delete(source);
  updateKeys();
  updateCapacity();
}
function updateCapacity() {
  if(channelTarget!=='synth'){const origin=channelContext();$('voiceCapacity').textContent=`${origin==='vgm'?'VGM':origin==='code'?'Code':'Synth'} · CH ${channelTarget+1}${origin==='vgm'&&!songState?.manualReady?' · read-only':` · ${notes.size} hand keys`}`;return;}
  if(songState?.playing){$('voiceCapacity').textContent=`VGM continues · your instrument · ${notes.size} hand keys`;return;}
  if(codeHost?.isRunning()){ $('voiceCapacity').textContent=channelTarget==='synth'?`Code continues · common instrument · ${notes.size} hand keys`:`Code continues · CH ${channelTarget+1} · ${notes.size} hand keys`;return;}
  const description = preset.source === 'noise' ? 'Noise · CH5 / CH6 · keys trigger the same noise'
    : preset.source === 'dda' ? 'DDA PCM · CH1–CH6 · software sample feed'
      : preset.lfo.enabled ? 'Wave + Hardware LFO · CH2 → CH1' : 'Wave · CH1–CH6';
  const recorded = preset.source === 'wave' && preset.lfo.enabled && preset.lfo.mode === 'recorded';
  $('voiceCapacity').textContent = `${description} · ${capacity()} ${capacity() === 1 ? 'voice' : 'voices'} · round robin · ${notes.size} held${recorded ? ' · C4 = recorded pitch' : ''}`;
}
function updatePresetUi() {
  renderCodeLive();
  if (document.activeElement !== $('instrumentName')) $('instrumentName').value = preset.name;
  if (!$('codeOutput').hidden) {
    if (preset.source === 'dda') {$('codeOutput').hidden=true;$('codeOutput').value='';}
    else $('codeOutput').value = presetToCode(preset);
  }
  $('copyCode').textContent = preset.source === 'dda' ? 'Copy DDA preset JS' : 'Copy JavaScript';
  updateCapacity();
  if (!layout || keyboardSource !== keyboardMode()) renderKeyboard();
  else updateKeys();
}
function audioFailed(error) {
  msmControls?.cancelPlay();cddaControls?.cancelPlay();
  songControls?.stop();
  void codeHost?.stop();void msmSource?.stop().catch(()=>{});void cddaSource?.stop().catch(()=>{});
  epoch++;
  notes.clear(); updateKeys();
  const failed = audio; audio = null;
  visualizer.disconnect();
  if (failed) void failed.dispose().catch(() => {});
  $('startAudio').textContent = 'Enable audio';
  report(error);
}
async function ensureAudio() {
  if (disposed) throw new Error('HuC6280 Synth is closed');
  if (!audio && !opening) {
    $('startAudio').disabled = true;
    status('Preparing HuC6280 audio…');
    opening = (async () => {
      const engine = await createAudio({volume: Number($('masterVolume').value),sourceMix:sourceMix.read(), onError: audioFailed});
      try {
        // Source edits remain available while WASM loads. Adopt the latest draft.
        let applied, appliedPitch;
        do {
          applied = revision; appliedPitch = pitch;
          await engine.command('loadPreset', [readPreset(preset)]);
          await engine.command('setPitch', [appliedPitch]);
        } while (applied !== revision || appliedPitch !== pitch);
        if (disposed) throw new Error('HuC6280 Synth is closed');
        engine.setVolume(Number($('masterVolume').value));
        engine.setSourceMix(sourceMix.read());
        audio = engine;
        syncChannelObservers();
        visualizer.connect(engine.context, engine.outputNode);
        $('startAudio').textContent = 'Audio ready';
        status('Audio ready · play the keyboard. Explore Wave, Noise, Hardware LFO or DDA PCM.');
        return engine;
      } catch (error) {await engine.dispose(); throw error;}
    })().finally(() => {opening = null; $('startAudio').disabled = false;});
  }
  const engine = audio ?? await opening;
  await engine.resume();
  return engine;
}
function applyPreset(value, {load = false, message, fromVgm = false, keepSongPaused=false, atomic=false, isCurrent=()=>true} = {}) {
  const next = readPreset(value);
  if(disposed||!isCurrent())return Promise.resolve(false);
  // The authored instrument remains independent of the reference PSG.
  const retainPause=Boolean(songState?.paused&&(keepSongPaused||!load&&channelTarget==='synth'));
  const retainPlaying=Boolean(songState?.playing&&channelTarget==='synth');
  if(songControls?.read().canStop&&!retainPause&&!retainPlaying)songControls.stop();
  const retiring=stopAudition();
  if (!fromVgm) vgmLibrary?.clearSelection();
  const previous = preset, engineAtSelection=audio, keepCode=Boolean(audio&&codeHost?.isRunning());
  let session=audio?.codeSession;
  const waveOnly=!load&&isWaveOnlyEdit(previous,next);
  const replacesVoices = load || !waveOnly&&(previous.source !== next.source || previous.lfo.enabled !== next.lfo.enabled
    || previous.lfo.mode !== next.lfo.mode || previous.lfo.output.enabled !== next.lfo.output.enabled
    || previous.envelope.enabled !== next.envelope.enabled || JSON.stringify(previous.wave) !== JSON.stringify(next.wave)
    || JSON.stringify(previous.lfo.wave) !== JSON.stringify(next.lfo.wave) || previous.dda.data !== next.dda.data);
  if (replacesVoices) {epoch++;notes.clear();updateKeys();}
  const performanceEpoch=epoch;
  const deferredAuthor=keepCode||atomic;
  if(!deferredAuthor)preset = next;
  revision++;
  const editRevision = revision;
  if (load || previous.source !== next.source) setPitchUi(0);
  if(!deferredAuthor){updatePresetUi();codeHost?.markSoundDirty();}
  if (!audio) {if(deferredAuthor){preset=next;updatePresetUi();codeHost?.markSoundDirty();}status(message ?? 'Instrument updated · enable audio, then play.'); return Promise.resolve(true);}
  return enqueue(async () => {
    const engine = audio;
    if (!engine) return false;
    try {
      const current=()=>!disposed&&isCurrent()&&audio===engine&&revision===editRevision&&(!keepCode||epoch===performanceEpoch&&codeHost?.isRunning()&&engine===engineAtSelection&&(session==null||engine.codeSession===session));
      if(!current())return false;
      await retiring;if(!current())return false;
      if(keepCode&&session==null){await engine.getHuc6280Client();if(!current())return false;session=engine.codeSession;}
      if(keepCode)await engine.applyCodePreset(next,{replace:load,isCurrent:current});
      else await engine.command(load ? 'loadPreset' : 'setPreset', [next]);
      if(!current()){
        if(atomic&&audio===engine&&revision===editRevision&&!codeHost?.isRunning())await engine.command('loadPreset',[previous]);
        return false;
      }
      if (load || previous.source !== next.source) await engine.command('setPitch', [0]);
      const state = await engine.read();
      if (!current()) {
        if(atomic&&audio===engine&&revision===editRevision&&!codeHost?.isRunning())await engine.command('loadPreset',[previous]);
        return false;
      }
      if(deferredAuthor&&current()){preset=readPreset(state.preset);updatePresetUi();codeHost?.markSoundDirty();}
      readVoices(state);
      visualizer.wake();
      if (revision === editRevision) status(message ?? (waveOnly
        ? 'Wave updated · held notes and Software envelope continue.' : replacesVoices
        ? 'Wave or routing updated · previous notes stopped. Play the keyboard.'
        : 'Instrument updated · volume, pan, Noise clock and LFO rate apply live.'));
      return true;
    } catch (error) {
      if(atomic){
        // Capture publishes only a complete, current acknowledgement. A failed
        // read must not recover by adopting native state from a cancelled ticket.
        if(audio===engine&&revision===editRevision&&!codeHost?.isRunning()){
          try{await engine.command('loadPreset',[previous]);}catch{}
        }
        throw error;
      }
      if (audio === engine && revision === editRevision) {
        preset = (await engine.read()).preset;
        updatePresetUi();
      }
      throw error;
    }
  });
}
async function loadDdaAudio(file,{sampleRate,signal,onCommit}) {
  if(channelTarget!=='synth')throw Error('Choose Auto to load the shared DDA sample; channel controls keep using the current sample.');
  const token=++importSequence, draftRevision=revision;
  const prepared=await prepareDdaAudio(file,{sampleRate,signal});
  if (signal?.aborted) throw new DOMException('Audio import cancelled','AbortError');
  if (disposed||token!==importSequence||draftRevision!==revision) return 'Import discarded · instrument changed. Previous sound kept.';
  const next=readPreset({...preset, source:'dda', name:prepared.name.slice(0,80),
    dda:{...prepared,rootNote:preset.dda.rootNote,loop:preset.dda.loop,speed:preset.dda.speed}});
  // Conversion can be cancelled; committing the validated preset is atomic.
  // End the UI's cancellable stage before changing its authored instrument.
  onCommit?.();
  await applyPreset(next,{load:true,message:`Loaded ${prepared.name} · DDA PCM · play the keyboard.`});
  return `Loaded ${prepared.name} · 5-bit PCM at ${prepared.sampleRate.toLocaleString()} Hz.`;
}
const editor = createEditor({root: $('voiceEditor'), onChange: value => {void editVisiblePreset(value).catch(report);},
  onError:report,onLoadAudio:loadDdaAudio});
vgmLibrary = createVgmLibrary({root:$('vgmImport'),onSource:({bytes,name},options)=>codeHost.files.importSong(bytes,name,{...options,announce:false}), onSelect:value => applyPreset(value, {
  load:true, fromVgm:true, message:`${value.name} loaded from VGM · Software Envelope off · play the keyboard.`,
})});

msmSource=createMsm5205Source({ensureAudio:()=>enqueue(ensureAudio),getAudio:()=>audio,
  readFile:path=>codeHost.project.readFile(path,{type:'arrayBuffer'},{path:'/index.js'}),
  onState(){if(!disposed){updateKeys();visualizer.wake();}},onError:report});

cddaSource=createCddaSource({ensureAudio:()=>enqueue(ensureAudio),getAudio:()=>audio,
  readFile:(...args)=>cddaReader(...args),onState(){if(!disposed){updateKeys();visualizer.wake();}},onError:report});

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
const keyboardMode = () => `${preset.source}:${preset.source==='dda' ? Boolean(preset.dda.data) : preset.lfo.enabled && preset.lfo.mode === 'recorded' ? 'recorded' : 'keyboard'}`;
function renderKeyboard() {
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
      if (button.disabled) button.title = 'Below this hardware channel’s pitch range. Raise the octave.';
      button.addEventListener('keydown', event => {
        if (event.key===' '||event.key==='Enter') {event.preventDefault(); if(!event.repeat) press(`button:${entry.key}`,entry);}
      });
      button.addEventListener('keyup',event=>{if(event.key===' '||event.key==='Enter') {event.preventDefault();release(`button:${entry.key}`);}});
    }
  }
  $('octaveValue').textContent = `${octave>0?'+':''}${octave}`;
  $('octaveDown').disabled = octave<=-2; $('octaveUp').disabled = octave>=2;
  updateKeys();
}
function pausedSelection(){return channelContext()==='vgm'&&songState?.paused&&channelTarget!=='synth'?songControls?.getPausedSelection?.()??null:null;}
function pausedVoice(){return pausedSelection()?.prepared??null;}
function playingSelection(){return songState?.playing&&!songState?.busy&&channelTarget!=='synth'?songControls?.getManualSelection?.(channelTarget)??null:null;}
function syncSongManualState(previous){
  if(previous?.manualEpoch===songState?.manualEpoch&&previous?.playing===songState?.playing)return;
  for(const[source,note]of notes)if(note.owner==='song')notes.delete(source);
  if(channelTarget!=='synth')setPitchUi(0);
  updateKeys();
}
function stopAudition(){auditionNotes.clear();updateKeys();return audition?.read().active?audition.stop():Promise.resolve();}
function syncAuditionSelection(){
  const key=pausedSelection()?.key??null;
  if(key!==auditionSelectionKey){auditionSelectionKey=key;auditionNotes.clear();void audition?.stop().catch(report);setPitchUi(0);}
}
function canPlay(midi) {
  if(channelContext()==='vgm'&&channelTarget!=='synth'){
    if(songState?.playing){const voice=playingSelection();return Boolean(voice?.playable)&&midi>=0&&midi<=127&&(voice.source==='noise'||440*2**((midi-69)/12)>=3579545/(32*4096));}
    const voice=pausedVoice();if(!voice?.playable)return false;
    return midi>=0&&midi<=127&&(voice.source==='noise'||voice.preset.lfo.enabled||440*2**((midi-69)/12)>=3579545/(32*4096));
  }
  const sound=channelTarget!=='synth'?(displayedPreset??preset):preset;
  if(channelContext()==='synth'&&channelTarget===1&&sound.lfo.enabled)return false;
  const hz = 440*2**((midi-69)/12);
  if(sound.source==='dda') return midi>=0&&midi<=127&&Boolean(sound.dda.data);
  return midi>=0 && midi<=127 && (sound.source==='noise' || sound.lfo.enabled && sound.lfo.mode==='recorded' || hz >= 3579545 / (32 * 4096));
}
function press(source, entry) {
  const phase=codeHost?.getState?.();
  if (!['huc6280','mixer'].includes(chipView)||songState?.busy||switchingAudioOutput||phase?.busy||phase?.stopping||notes.has(source)||!canPlay(entry.midi)) return;
  if(songState?.playing&&channelTarget!=='synth'){
    const selection=playingSelection();if(!selection?.playable)return;
    const owner=songControls,manualEpoch=songState.manualEpoch;
    const note={id:`huc6280-song:${++sequence}`,owner:'song',key:entry.key,midi:entry.midi,channel:channelTarget,epoch,manualEpoch,started:false};
    const current=()=>!disposed&&!switchingAudioOutput&&notes.get(source)===note&&note.epoch===epoch&&songControls===owner&&songState?.playing&&!songState?.busy&&songState?.manualEpoch===manualEpoch&&channelTarget===note.channel;
    notes.set(source,note);updateKeys();
    void enqueue(async()=>{
      if(!current())return;
      const result=owner.noteOn(note.id,note.midi,note.channel,{epoch:manualEpoch});
      if(!current())return;
      if(result===false){notes.delete(source);updateKeys();return;}
      note.started=true;
      if(result?.stolenId)for(const[key,old]of notes)if(old.id===result.stolenId)notes.delete(key);
      updateKeys();visualizer.wake();status(`VGM CH ${note.channel+1} · ${midiToNoteName(note.midi)} · manual key; later song writes take over.`);
    }).catch(error=>{if(notes.get(source)===note)notes.delete(source);updateKeys();if(error?.name!=='AbortError')report(error);});
    return;
  }
  if(pausedSelection()){
    if(auditionNotes.has(source))return;
    const note={id:`huc6280-trial:${++sequence}`,key:entry.key,midi:entry.midi,epoch},key=pausedSelection().key;
    auditionNotes.set(source,note);updateKeys();
    void audition.noteOn(note.id,note.midi,{isCurrent:()=>!disposed&&!switchingAudioOutput&&auditionNotes.get(source)===note&&note.epoch===epoch&&pausedSelection()?.key===key})
      .then(result=>{if(!result&&auditionNotes.get(source)===note)auditionNotes.delete(source);updateKeys();visualizer.wake();})
      .catch(error=>{if(auditionNotes.get(source)===note)auditionNotes.delete(source);updateKeys();if(error?.name!=='AbortError')report(error);});
    return;
  }
  const codeAtPress=Boolean(codeHost?.isRunning()),engineAtPress=audio,sessionAtPress=audio?.codeSession,songAtPress=channelContext()==='vgm',songEpoch=songState?.manualEpoch;
  const note = {id:`huc6280-synth:${++sequence}`,key:entry.key,midi:entry.midi,epoch,started:false,channel:channelTarget!=='synth'?channelTarget:undefined};
  const current=()=>!songState?.busy&&(!songState?.playing||channelTarget==='synth')&&(!songAtPress||songState?.manualEpoch===songEpoch&&channelContext()==='vgm')&&!switchingAudioOutput&&notes.get(source)===note&&note.epoch===epoch&&
    (codeAtPress?codeHost?.isRunning()&&audio===engineAtPress&&audio?.codeSession===sessionAtPress:!codeHost?.isRunning());
  notes.set(source,note); updateKeys();
  void enqueue(async () => {
    if (!current()) return;
    const engine = await ensureAudio();
    if (!current()) return;
    note.started = true;
    const result = await engine.command('noteOn',[note.id,note.midi,note.channel]);
    if (audio!==engine||note.epoch!==epoch) return;
    if (result.stolenId) for (const [key,old] of notes) if (old.id===result.stolenId) notes.delete(key);
    readVoices(await engine.read());
    status(preset.source==='noise' ? 'Noise triggered · pitch is set by Noise clock controls.'
      : preset.source==='dda' ? `${midiToNoteName(note.midi)} · DDA PCM · ${notes.size}/6 voices · software playback`
      : `${midiToNoteName(note.midi)}${preset.lfo.enabled && preset.lfo.mode==='recorded' ? ' trigger · C4 = recorded carrier pitch' : ''} · ${notes.size}/${capacity()} voices`);
  }).catch(error=>{if(notes.get(source)===note) notes.delete(source);updateKeys();report(error);});
}
function release(source) {
  const trial=auditionNotes.get(source);
  if(trial){auditionNotes.delete(source);updateKeys();void audition.noteOff(trial.id).catch(report);return;}
  const note = notes.get(source);
  if (!note) return;
  notes.delete(source);updateKeys();
  if(note.owner==='song'){
    if(note.started)void enqueue(()=>{if(!disposed&&note.epoch===epoch&&songState?.manualEpoch===note.manualEpoch)return songControls?.noteOff(note.id,{epoch:note.manualEpoch});}).catch(report);
    return;
  }
  if (note.started) void enqueue(async()=>{
    if (audio && note.epoch===epoch) {await audio.command('noteOff',[note.id]);updateCapacity();}
  });
}
function stopNotes(message) {
  epoch++; notes.clear(); updateKeys();
  if(codeHost?.isRunning()||songState?.playing)setPitchUi(0);
  const retiringSong=songControls?.releaseKeyboard?.({epoch:songState?.manualEpoch});
  const retiring=stopAudition();
  return enqueue(async()=>{await retiring;await retiringSong;if(audio) await audio.command(codeHost?.isRunning()?'releaseKeyboard':'stop'); if(!codeHost?.isRunning()&&!songState?.playing)visualizer.stop();if(message) status(message);});
}
$('startAudio').addEventListener('click',()=>{$('startAudio').blur();void enqueue(ensureAudio).catch(report);});
$('stopAudio').addEventListener('click',()=>{
  $('stopAudio').blur();msmControls?.cancelPlay();cddaControls?.cancelPlay();songControls?.stop();
  epoch++;notes.clear();setPitchUi(0);updateKeys();const retiring=stopAudition();
  // Capture Stop authority synchronously; each source must be stopped even
  // if a sibling fails. Keyboard cleanup waits only for Code's output fade.
  const codeStopped=codeHost?.stop(),msmStopped=msmSource?.stop(),cddaStopped=cddaSource?.stop();
  const hands=Promise.resolve(codeStopped).finally(async()=>{await retiring;await stopNotes('Stopped · instrument retained. Play to resume.');});
  void Promise.allSettled([hands,msmStopped,cddaStopped]).then(results=>{
    const failure=results.find(item=>item.status==='rejected'&&item.reason?.name!=='AbortError');if(failure)report(failure.reason);
  });
});
for(const [id,delta] of [['octaveDown',-1],['octaveUp',1]]) $(id).addEventListener('click',()=>{
  $(id).blur();stopNotes();octave=Math.max(-2,Math.min(2,octave+delta));renderKeyboard();
});
function editing(target) {
  const control = target?.closest?.('input,select,textarea,[contenteditable="true"],dialog[open],.monaco-editor,#synthCodeEditorHost');
  return control && !control.matches?.('input[type="range"],input[type="checkbox"],input[type="radio"]');
}
window.addEventListener('keydown',event=>{
  if(!['huc6280','mixer'].includes(chipView)||event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||editing(event.target)) return;
  const key=event.key.toLowerCase(),entry=layout.entries.find(item=>item.key===key);
  if(!entry) return;
  event.preventDefault(); if(!event.repeat) press(`key:${event.code||key}`,{...entry,midi:entry.midi+octave*12});
});
window.addEventListener('keyup',event=>release(`key:${event.code||event.key.toLowerCase()}`));
window.addEventListener('blur',()=>{stopNotes();setPitch(0);});
document.addEventListener('visibilitychange',()=>{if(document.hidden) {stopNotes();setPitch(0);}});
function setPitchUi(value) {
  pitch=value;
  for (const [wheel, output] of pitchWheels) {
    wheel.value=String(value);
    output.textContent=`${value>=0?'+':''}${value.toFixed(2)}`;
  }
}
function setPitch(value) {
  if(!['huc6280','mixer'].includes(chipView)&&value!==0)return;
  if(songState?.busy)return;
  if(songState?.playing&&channelTarget!=='synth'){
    const selection=playingSelection();if(!selection?.playable||selection.source==='noise'){setPitchUi(0);return;}
    const owner=songControls,manualEpoch=songState.manualEpoch,token=epoch;
    setPitchUi(value);
    void enqueue(()=>{if(!disposed&&epoch===token&&songControls===owner&&songState?.playing&&!songState?.busy&&songState.manualEpoch===manualEpoch)return owner.setPitch(value,{epoch:manualEpoch});}).catch(report);
    return;
  }
  if(pausedSelection()){
    if(!pausedVoice()?.playable||pausedVoice()?.source==='noise'){setPitchUi(0);return;}
    setPitchUi(value);void audition.setPitch(value).catch(report);return;
  }
  const previous=pitch;setPitchUi(value);
  const engine=audio,token=epoch,session=engine?.codeSession,wasCode=Boolean(codeHost?.isRunning()),songAtPitch=channelContext()==='vgm',songEpoch=songState?.manualEpoch;
  const current=()=>!disposed&&audio===engine&&epoch===token&&engine.codeSession===session&&Boolean(codeHost?.isRunning())===wasCode&&(!songState?.playing||channelTarget==='synth')&&(!songAtPitch||songState?.manualEpoch===songEpoch&&channelContext()==='vgm')&&!songState?.busy;
  if(engine) void enqueue(async()=>{
    if(!current())return;
    try{await engine.command('setPitch',[value]);if(current())visualizer.wake();}
    catch(error){if(!current())return;if(pitch===value) setPitchUi(previous);throw error;}
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
  try{saveFile('huc6280-voice.json',JSON.stringify(readPreset(preset),null,2)+'\n');status('Preset saved · Wave, Noise, LFO, DDA PCM and Software envelope included.');}catch(error){report(error);}
});
$('loadPreset').addEventListener('click',()=>{$('loadPreset').blur();$('presetFileInput').click();});
$('presetFileInput').addEventListener('change',async()=>{
  const file=$('presetFileInput').files?.[0];$('presetFileInput').value='';$('presetFileInput').blur();
  if(!file) return;
  const token=++importSequence, draftRevision=revision;
  try {
    if(file.size>MAX_PRESET_BYTES) throw new Error('Preset must be at most 32 MiB');
    const next=readPreset(JSON.parse(await file.text()));
    if(disposed||token!==importSequence||draftRevision!==revision) return;
    await applyPreset(next,{load:true,message:'Preset loaded · play the keyboard.'});
    if(codeHost&&file.size<16*1024*1024){try{await codeHost.files.importFiles([file],{announce:false,isCurrent:()=>!disposed&&token===importSequence});}catch(error){status(`Instrument loaded. Files copy unavailable: ${error.message}`,true);}}
  }catch(error){report(error);}
});
$('saveSoundToFiles').addEventListener('click',()=>{void codeHost.files.saveSound().catch(report);});
$('resetPreset').addEventListener('click',()=>{$('resetPreset').blur();void applyPreset(createDefaultPreset(),{load:true,message:'Instrument reset · Sine ready.'}).catch(report);});
$('copyCode').addEventListener('click',async()=>{
  $('copyCode').blur();
  try {
    const code=presetToCode(preset);$('codeOutput').value=code;$('codeOutput').hidden=false;
    const destination=preset.source==='dda' ? 'DDA preset data and Instrument usage example' : 'paste into Playground HuC6280 mode';
    try{await navigator.clipboard.writeText(code);status(`JavaScript copied · ${destination}.`);}
    catch{status(`JavaScript ready below · ${destination}.`);}
  }catch(error){report(error);}
});
window.addEventListener('pagehide',event=>{
  songControls?.stop();
  if(event.persisted){stopNotes();void codeHost?.stop();void msmSource?.stop().catch(()=>{});void cddaSource?.stop().catch(()=>{});return;}
  disposed=true;msmControls?.dispose();cddaControls?.dispose();cddaSession.dispose();sourceMixerUi.dispose();unsubscribeSourceMix();epoch++;notes.clear();auditionNotes.clear();songControls?.dispose();codeLive?.dispose();editorLive?.dispose();monitorResize.disconnect();visualizer.dispose();editor.dispose();vgmLibrary.dispose();const closing=audio;audio=null;void Promise.allSettled([codeHost?.dispose(),audition?.dispose(),msmSource?.dispose(),cddaSource?.dispose()]).finally(()=>closing?.dispose()).catch(()=>{});
});
function selectedPresetFor(context,snapshot){
  const key=channelTarget==='synth'?`auto:${revision}`:JSON.stringify([context,channelTarget,snapshot?.clock,snapshot?.positionFrames,snapshot?.revision,snapshot?.registers,snapshot?.globals,snapshot?.waveforms,snapshot?.envelopes]);
  if(key!==selectedPresetKey||!selectedPresetResult){
    selectedPresetKey=key;
    try{selectedPresetResult=prepareHuc6280SelectedPreset({target:channelTarget,origin:context,author:preset,snapshot});}
    catch(error){selectedPresetResult={sound:null,reason:error.message};}
  }
  return selectedPresetResult;
}
function renderCodeLive() {
  if(disposed)return;
  const context=channelContext(),physical=channelTarget!=='synth',observer=context==='code'?codeLive:editorLive;
  const observed=context==='vgm'?songState:observer?.read(),snapshot=observed?.liveState;
  const songEditable=physical&&context==='vgm'&&(songState?.playing||songState?.paused)&&songState?.manualReady;
  const readOnly=physical&&context==='vgm'&&!songEditable,waiting=physical&&!snapshot;
  const tools=$('hucCodeLiveTools');tools.hidden=false;tools.dataset.origin=context;tools.dataset.context=context;tools.dataset.channel=String(channelTarget);
  const trial=audition?.read();tools.dataset.auditionState=trial?.state??'idle';tools.dataset.heldCount=String(trial?.heldCount??0);tools.dataset.auditionSource=trial?.source??'';
  tools.dataset.positionFrames=String(snapshot?.positionFrames??'');tools.dataset.renderedFrames=String(context==='vgm'?(songState?.positionFrames??0)+(songState?.bufferedFrames??0):snapshot?.positionFrames??'');
  $('hucChannelSelect').value=String(channelTarget);$('hucLiveEnabled').checked=autoUpdate;
  $('instrumentName').readOnly=physical;$('saveSoundToFiles').disabled=physical;
  $('loadDdaAudio').disabled=physical;$('ddaAudioFileInput').disabled=physical;
  $('loadDdaAudio').title=physical?'Choose Auto to replace the shared DDA sample.':'Load audio for the authored instrument.';
  const saved=selectedPresetFor(context,snapshot),saveSelected=$('hucSaveSelectedPreset');
  saveSelected.disabled=savingSelectedPreset||!codeHost||$('hucFilesPanel').getAttribute('aria-busy')==='true'||!saved.sound||Boolean(physical&&context==='vgm'&&songState?.busy);
  saveSelected.textContent=savingSelectedPreset?'Saving…':'Save to presets';
  saveSelected.title=saved.reason||'Save this configured sound to presets/ without changing the channel, Code or song playback.';
  let value=preset,readout='',shown=null;
  if(physical&&snapshot){try{shown=context==='vgm'?huc6280SongLiveView(snapshot,channelTarget,preset):huc6280CodeLiveView(snapshot,channelTarget,preset);value=shown.preset;readout=shown.readout;}catch(error){readout=error.message;}}
  const meta={physical,readOnly:readOnly||waiting,origin:context==='vgm'?'VGM':context==='code'?'Code':'Synth',channel:physical?channelTarget:null,
    waveKnown:waiting?false:shown?.waveKnown??true,lfoWaveKnown:waiting?false:shown?.lfoWaveKnown??true,ddaValue:shown?.ddaValue,
    unknownFields:waiting?['source','volume','pan.left','pan.right','noise.frequency','lfo.enabled','lfo.frequency','lfo.depth','lfo.carrierPeriod','lfo.modulatorPeriod']:shown?.unknownFields??[]};
  const mount=$('voiceEditor');mount.inert=false;mount.dataset.readonly=String(Boolean(readOnly||waiting));mount.dataset.source=shown?.source??value.source;
  mount.dataset.positionFrames=String(snapshot?.positionFrames??'');
  mount.dataset.period=String(shown?.period??'unknown');mount.dataset.gate=shown?.gate==null?'unknown':String(shown.gate);
  mount.dataset.waveKnown=String(meta.waveKnown);mount.dataset.ddaValue=Number.isInteger(shown?.ddaValue)?String(shown.ddaValue):'unknown';
  mount.setAttribute('aria-label',physical?`${readOnly?'Read-only VGM':'Edit'} CH ${channelTarget+1}`:'HuC6280 instrument editor');
  const {data:_data,...dda}=value.dda;
  const signature=JSON.stringify([{...value,dda},meta,context,channelTarget,revision]);
  if(signature!==liveSignature&&!editor.isInteracting()) {editor.update(value,meta);displayedPreset=readPreset(value);liveSignature=signature;}
  const paused=pausedVoice();
  const liveVoice=playingSelection();
  for(const [wheel]of pitchWheels)wheel.disabled=value.source==='noise'||Boolean(readOnly&&(!paused?.playable||paused.source==='noise'))||Boolean(songState?.busy)||Boolean(context==='vgm'&&physical&&(songState?.paused?!paused?.playable:songState?.playing&&!liveVoice?.playable));
  if(layout)for(const button of keyboard.querySelectorAll('.key')){const entry=layout.entries.find(item=>item.key===button.dataset.key);if(entry)button.disabled=!canPlay(entry.midi+octave*12);}
  const origin=context==='vgm'?`VGM · ${songState?.seeking?'Seeking':songState?.paused?'Paused':'Playing'}`:context==='code'?'Code continues':'Synth';
  $('hucChannelStatus').textContent=physical?`${origin} · CH ${channelTarget+1} · ${readOnly?'read-only':waiting&&!audio?'Enable audio to view and edit this channel.':songEditable?`edit hardware · ${(songState.paused?paused:liveVoice)?.playable?'keyboard: this CH':'keyboard unavailable'}`:'edit and play this channel'}${autoUpdate?'':' · Auto update Off'}`:`${origin} · Auto · round robin`;
  $('hucChannelReadout').textContent=observed?.liveError?observed.liveMessage:waiting?audio||context==='vgm'?'Waiting for recorded channel settings…':'Physical channel view starts after Enable audio or a keyboard note.':readout;
  $('hucSongCaptureButton').hidden=context!=='vgm'||!physical;$('hucSongCaptureStatus').hidden=context!=='vgm'||!physical||!$('hucSongCaptureStatus').textContent;
  $('hucKeyboardHint').textContent=songState?.seeking||songState?.seekPreparing?'Preparing the VGM position · keyboard audition resumes when ready.':context==='vgm'?physical?songState?.paused?paused?.playable?`Paused VGM CH ${channelTarget+1} · keyboard auditions this configured sound${paused.source==='noise'?' · Noise pitch is fixed':''}.`:paused?.reason??'The selected paused channel cannot be auditioned.':liveVoice?.playable?`Keyboard writes into VGM CH ${channelTarget+1}; later song writes take over${liveVoice.source==='noise'?' · Noise pitch is fixed':''}.`:liveVoice?.reason??'The playing channel is not ready for keyboard input.':songState?.playing?'VGM continues · keyboard plays your edited instrument.':'Reference song paused · keyboard plays your edited instrument.':physical?context==='synth'&&channelTarget===1&&value.lfo.enabled?'CH2 is reserved as the hardware LFO source. Play CH1 for the carrier.':`Keyboard plays CH ${channelTarget+1}.`:'Every key plays the selected source. No keyboard split.';
  $('hucKeyboardControls').hidden=!['huc6280','mixer'].includes(chipView);
  if(chipView==='msm5205')$('hucKeyboardHint').textContent='MSM5205 plays samples using Play / Stop above or Code. It has no keyboard noteOn instrument here.';
  else if(chipView==='cdda')$('hucKeyboardHint').textContent='CD-DA uses the track transport above or Code. Playback keeps its original rate; it has no pitched keyboard instrument here.';
  updateKeys();
}
async function editVisiblePreset(value) {
  const next=readPreset(value);
  if(channelTarget==='synth')return applyPreset(next);
  const context=channelContext();
  if(context==='vgm'){
    if(!(songState?.playing||songState?.paused)||!songState?.manualReady||songState?.busy)return false;
    const edit=createHuc6280CodeEdit(displayedPreset??preset,next,channelTarget);if(!edit)return;
    const owner=songControls,manualEpoch=songState.manualEpoch,token=epoch,channel=channelTarget,editingPaused=Boolean(songState.paused);
    return enqueue(()=>{
      if(disposed||songControls!==owner||epoch!==token||channelTarget!==channel||!(songState?.playing||songState?.paused)||Boolean(songState.paused)!==editingPaused||songState?.busy||songState.manualEpoch!==manualEpoch)return false;
      const result=owner.applyEdit(edit,{epoch:manualEpoch});
      if(result!==false){liveSignature=null;visualizer.wake();}
      return result;
    });
  }
  if(!audio)throw Error('Enable audio to edit a physical channel. Synth editing remains available without audio.');
  const edit=createHuc6280CodeEdit(displayedPreset??preset,next,channelTarget);if(!edit)return;
  const engine=audio,session=engine?.codeSession,token=epoch;
  const current=()=>!disposed&&audio===engine&&engine?.codeSession===session&&token===epoch&&channelContext()===context;
  try{await enqueue(async()=>{if(!current())return;const state=await engine[context==='code'?'applyCodeEdit':'applyEditorEdit'](edit,{isCurrent:current});if(!current())return;
    if(context==='code'){preset=readPreset(state.preset);revision++;codeHost.markSoundDirty();}
    liveSignature=null;await(context==='code'?codeLive:editorLive).refresh();visualizer.wake();});}
  catch(error){liveSignature=null;renderCodeLive();throw error;}
}
function syncChannelObservers(){
  const context=channelContext();codeLive?.setEnabled(autoUpdate);editorLive?.setEnabled(autoUpdate);
  codeLive?.sync();editorLive?.sync();
  if(channelTarget!=='synth'&&context!=='vgm'){
    const observer=context==='code'?codeLive:editorLive;
    if(audio&&!observer?.read().liveState)void observer?.refresh().catch(report);
  }
}
async function setChannelTarget(value,{fromSong=false}={}){
  const target=value==='synth'?'synth':Number(value);
  if(target!=='synth'&&(!Number.isInteger(target)||target<0||target>5))throw Error('Choose Auto or CH1–CH6.');
  const request=++channelSelection;channelTarget=target;
  if(!fromSong)songControls?.setView(target,{notify:false});
  syncAuditionSelection();liveSignature=null;syncChannelObservers();renderCodeLive();
  await stopNotes();if(request!==channelSelection||disposed)return false;
  if(target!=='synth'){codeLive.setVoice(target);editorLive.setVoice(target);}
  syncChannelObservers();renderCodeLive();return true;
}
async function capturePausedVoice(payload,{isCurrent=()=>true}={}){
  if(!isCurrent()||!songState?.paused||!payload.capturable)return false;
  await stopNotes();if(!isCurrent()||!songState?.paused)return false;
  return applyPreset(payload.preset,{load:true,keepSongPaused:true,atomic:true,isCurrent,message:'Captured VGM sound · song stays paused. Edit the Synth or save it to Files.'});
}
codeHost=setupHuc6280CodeHost({msm5205Source:msmSource,cddaSource,
  readCddaFile:(...args)=>cddaReader(...args),getExportNotice:()=>cddaSession.list().length?'Session WAVs are not included; keep the original WAVs and reopen them after restoring the Project.':'',
  onBeforeWorkspaceReplace:()=>{cddaSession.clear();},ensureAudio:()=>enqueue(ensureAudio),getAudio:()=>audio,
  getSettings:()=>readPreset(preset),applySettings:(value,options={})=>applyPreset(value,{...options,load:true}),stopKeyboard:()=>stopNotes(),
  stopSong:async()=>{songControls?.stop();await stopAudition();},
  onActivity(){const running=Boolean(codeHost?.isRunning());if(running!==codeWasRunning){if(!running){msmControls?.cancelPlay();cddaControls?.cancelPlay();}epoch++;notes.clear();setPitchUi(0);codeWasRunning=running;updateKeys();}syncChannelObservers();renderCodeLive();msmControls?.refresh();cddaControls?.refresh();visualizer.wake();},setStatus:status});
cddaReader=createCddaInputReader({project:codeHost.project,session:cddaSession});
msmControls=setupMsm5205Controls({root:$('msm5205Controls'),source:msmSource,project:codeHost.project,
  addFiles:()=>{$('hucFileImportButton').click();},onStatus:status,onOutput:()=>{updateKeys();visualizer.wake();},
  isVisible:()=>chipView==='msm5205'&&!document.hidden,
  beforePlay(){const phase=codeHost.getState();if(disposed||switchingAudioOutput||phase.busy||phase.stopping)throw Error('Wait for the current audio operation before playing ADPCM.');},
  afterPlay(){if(!codeHost.isRunning())codeHost.openOutput();},
});
cddaControls=setupCddaControls({root:$('cddaControls'),source:cddaSource,session:cddaSession,project:codeHost.project,
  addFiles:()=>{$('hucFileImportButton').click();},onStatus:status,onOutput:()=>{updateKeys();visualizer.wake();},
  isVisible:()=>chipView==='cdda'&&!document.hidden,
  beforePlay(){const phase=codeHost.getState();if(disposed||switchingAudioOutput||phase.busy||phase.stopping)throw Error('Wait for the current audio operation before playing CD-DA.');},
  afterPlay(){if(!codeHost.isRunning())codeHost.openOutput();},
});
codeLive=createHuc6280CodeLive({getAudio:()=>audio,isRunning:()=>channelContext()==='code'&&channelTarget!=='synth',onUpdate:()=>renderCodeLive()});
editorLive=createHuc6280CodeLive({getAudio:()=>audio,isRunning:()=>Boolean(audio)&&channelContext()==='synth'&&channelTarget!=='synth',method:'observeEditor',onUpdate:()=>renderCodeLive()});
audition=createHuc6280SongAudition({ensureAudio:()=>enqueue(ensureAudio),getAudio:()=>audio,getSelection:pausedSelection,
  onUpdate(){if(!disposed){renderCodeLive();visualizer.wake();}}});
songControls=setupHuc6280SongControls({project:codeHost.project,getAudio:()=>enqueue(ensureAudio),
  onCapture:capturePausedVoice,onViewChange:(target)=>{void setChannelTarget(target,{fromSong:true}).catch(report);},
  beforePlay:async({isCurrent=()=>true}={})=>{if(!isCurrent())return;msmControls?.cancelPlay();cddaControls?.cancelPlay();await codeHost.stop();if(!isCurrent())return;await Promise.all([msmSource.stop(),cddaSource.stop()]);if(!isCurrent())return;setPitchUi(0);await stopNotes();},
  onState(state){const previousState=songState,previous=songState?.playback;songState=state;syncSongManualState(previousState);syncAuditionSelection();syncChannelObservers();renderCodeLive();if(state.playing)visualizer.wake();
    if(state.playback!==previous){
      if(state.seeking)status('Seeking VGM · Cancel keeps the previous position.');
      else if(state.playing)status('VGM playing · edit a CH or play your own Synth instrument.');
      else if(state.paused)status('VGM paused · edit or play a CH, or save it to presets/. Resume continues the song.');
      else if(state.playback==='ended')status('VGM finished · your instrument is retained.');
      else if(state.playback==='stopped'&&previous!=null)status(state.seekMessage||'VGM stopped · your instrument is retained.');
    }
  },onStatus:status});
songControls.setSourceMix(sourceMix.read());
for(const tab of document.querySelectorAll('[data-huc-chip-tab]')){
  const select=()=>{
    chipView=tab.dataset.hucChipTab;$('hucSynthMain').dataset.chipView=chipView;
    for(const button of document.querySelectorAll('[data-huc-chip-tab]')){const active=button===tab;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
    for(const panel of document.querySelectorAll('[data-huc-chip-panel]'))panel.hidden=panel.dataset.hucChipPanel!==chipView;
    renderCodeLive();msmControls?.refresh();cddaControls?.refresh();visualizer.wake();
  };
  tab.addEventListener('click',()=>{tab.blur();select();});
  tab.addEventListener('keydown',event=>{
    const tabs=[...document.querySelectorAll('[data-huc-chip-tab]')],index=tabs.indexOf(tab);
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:null;
    if(next===null)return;event.preventDefault();tabs[next].click();tabs[next].focus();
  });
}
for(const button of document.querySelectorAll('[data-add-cdrom2-examples]'))button.addEventListener('click',()=>{
  button.blur();try{const added=addPcEngineCodeExamples(codeHost.project);status(added.length?'Added missing HuC6280, MSM5205 and CD-DA examples to Files. Select a file in Code, then Run.':'Code examples are already in Files; existing files were kept.');}catch(error){report(error);}
});
$('hucSaveSelectedPreset').addEventListener('pointerdown',event=>{if(event.button===0)event.preventDefault();});
$('hucSaveSelectedPreset').addEventListener('click',()=>{
  $('hucSaveSelectedPreset').blur();if(savingSelectedPreset||disposed)return;
  const context=channelContext(),observer=context==='code'?codeLive:editorLive;
  const snapshot=context==='vgm'?songState?.liveState:observer?.read().liveState;
  const selected=selectedPresetFor(context,snapshot);if(!selected.sound){status(selected.reason,true);return;}
  savingSelectedPreset=true;renderCodeLive();
  void codeHost.files.saveSound({sound:selected.sound,select:false}).then(path=>{if(path&&!disposed)status(`Saved to ${path}. Channel and playback kept.`);}).catch(report).finally(()=>{savingSelectedPreset=false;renderCodeLive();});
});
$('hucChannelSelect').addEventListener('change',()=>{const value=$('hucChannelSelect').value;$('hucChannelSelect').blur();void setChannelTarget(value).catch(report);});
$('hucLiveEnabled').addEventListener('change',()=>{autoUpdate=$('hucLiveEnabled').checked;$('hucLiveEnabled').blur();songControls.setLiveEnabled(autoUpdate);syncChannelObservers();liveSignature=null;renderCodeLive();});
setupSynthMenu({document,window});
updatePresetUi();setVolume();setPitchUi(0);

// Desktop adapters change only the final Master bus. The HuC6280 PSG, allocator
// and output monitor keep using the same graph; ordinary sites expose no API.
const localDesktop = (location.protocol === 'tauri:' && location.hostname === 'localhost') ||
  (['http:', 'https:'].includes(location.protocol) && location.hostname === 'tauri.localhost');
if (window.top === window && localDesktop && window.__TAURI_INTERNALS__) {
  Object.defineProperty(window, 'tetoricaSynthAudio', {value:Object.freeze({
    setSwitching(value) {switchingAudioOutput = value === true;},
    async ensureReady() {const engine = await ensureAudio(); return {context:engine.context, output:engine.outputNode};},
    async stopPlayback() {
      msmControls?.cancelPlay();cddaControls?.cancelPlay();setPitchUi(0);
      songControls?.stop();
      await codeHost?.stop();await Promise.all([msmSource?.stop(),cddaSource?.stop()]);await stopNotes();
      await enqueue(async () => {if (audio) await audio.command('setPitch', [0]);});
    },
  })});
  window.dispatchEvent(new Event('tetorica-synth-ready'));
}
