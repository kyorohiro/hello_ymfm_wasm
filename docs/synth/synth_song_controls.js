import {createSynthSongPreview} from './synth_song_preview.js?v=pcm-manual-1';
import {setupSynthSongSeekControls} from './synth_song_seek_controls.js?v=song-seek-1';
import {setupSynthSongMixControls} from './synth_song_mix_controls.js?v=channel-mixer-1';
import {createSynthSongCopyPreset} from './synth_song_copy.js';
import {describeSynthSongVoice} from './synth_song_voice.js?v=vgm-mix-copy-1';
import {describeSynthPsgSongVoice,createSynthPsgSongCopyPreset} from './synth_song_psg_voice.js?v=psg-live-1';
import {describeSynthPcmSongVoice,createSynthPcmSongCopyPreset} from './synth_song_pcm_voice.js?v=pcm-live-draw-1';

const isSong = path => path.startsWith('/vgm/') && /\.(vgm|vgz)$/i.test(path);
const chips={
  ym2612:{label:'YM2612',targets:['0','1','2','3','4','5'],describe:describeSynthSongVoice,copy:createSynthSongCopyPreset},
  psg:{label:'PSG',targets:['psg:0','psg:1','psg:2','psg:3'],describe:describeSynthPsgSongVoice,copy:createSynthPsgSongCopyPreset},
  pcm:{label:'Mega CD PCM',targets:Array.from({length:8},(_,channel)=>`pcm:${channel}`),describe:describeSynthPcmSongVoice,copy:createSynthPcmSongCopyPreset},
};
const channelNumber=value=>value==='synth'?null:Number(value.includes(':')?value.split(':')[1]:value);
const hexAddress=value=>Number.isInteger(value)?`$${value.toString(16).padStart(4,'0').toUpperCase()}`:'—';

/** Keep reference-song selection separate from the instrument editor. */
export function setupSynthSongControls({project, getAudio, getVolume, onFileSelected, onLiveView=()=>{}, onTargetState=()=>{}, onCopyToSynth=async()=>false, onStatus=()=>{}, beforeResume,mix,
  createPreview=createSynthSongPreview,setupSeek=setupSynthSongSeekControls,setupMix=setupSynthSongMixControls}) {
  const root = document.getElementById('synthSongPlayer');
  const select = document.getElementById('synthSongSelect');
  const play = document.getElementById('synthSongPlayButton');
  const stop = document.getElementById('synthSongStopButton');
  const status = document.getElementById('synthSongStatus');
  const live = document.getElementById('synthSongLiveToggle');
  const channel = document.getElementById('synthSongChannelSelect');
  const liveStatus = document.getElementById('synthSongLiveStatus');
  const copy=document.getElementById('synthSongCopyButton');
  const formatInfo = document.querySelector('.synth-file-format-note');
  let selectedPath = null, selectedRevision = -1, listRevision = '', disposed = false;
  const frozenSnapshots={ym2612:null,psg:null,pcm:null};
  const lastChannels={ym2612:'0',psg:'psg:0',pcm:'pcm:0'};
  let selectedChip='ym2612';
  let copying=false, mixControls=null, seekControls=null;
  const text = (node, value) => {if (node.textContent !== value) node.textContent = value;};
  const snapshotFor=(state,chip)=>chip==='pcm'?state.pcmLiveState:chip==='psg'?state.psgLiveState:state.liveState;
  const resetFrozen=()=>{for(const chip of Object.keys(chips))frozenSnapshots[chip]=null;};
  function rememberChannel() {
    if(channel.value!=='synth')lastChannels[selectedChip]=channel.value;
  }
  function setChipOptions(chip,value) {
    if(chip!==selectedChip) {
      selectedChip=chip;
      const values=chips[chip].targets;
      channel.replaceChildren(...['synth',...values].map((target,index)=>{
        const option=document.createElement('option');option.value=target;
        option.textContent=!index?'Synth':chip==='psg'?(index===4?'Noise':`Tone ${index}`):`CH${index}`;
        return option;
      }));
      channel.title=chip==='pcm'?'Synth: edit and play your own sample bank. PCM CH1–CH8: edit and play that song channel using its existing RAM. Pause for independent audition.'
        :chip==='psg'?'Synth: edit your Tone or Noise instrument. Tone 1–3 / Noise: view, edit and play that song channel. Pause for independent audition.'
        :'Synth: edit and play all FM channels. CH1–CH6: view, edit and play that song channel. Pause for independent audition.';
    }
    channel.value=value;
  }


  function showState(state) {
    root.dataset.state = status.dataset.state = state.playback;
    root.dataset.consumedFrames = String(state.consumedFrames ?? 0);
    text(play, state.playback === 'playing' ? 'Pause' : state.playback === 'paused' ? 'Resume' : 'Play');
    const seeking = state.playback === 'seeking';
    play.disabled = copying || !selectedPath || state.playback === 'loading' || seeking;
    stop.disabled = copying || !['loading', 'playing', 'paused', 'seeking'].includes(state.playback);
    select.disabled=copying;
    const messages = {stopped:'Stopped.', loading:'Loading…', playing:'Playing.', paused:'Paused.', ended:'Finished.',
      seeking:'Seeking… ' + Math.round((state.seekProgress ?? 0) * 100) + '%'};
    // Progress is frequent; announce transport changes, not an identical status
    // on every render refill, to keep the live region quiet while playing.
    text(status, state.errorMessage ? `${state.name}: ${state.errorMessage}` : messages[state.playback] ?? 'Ready.');
    status.title = status.textContent;
    seekControls?.update(state);
    const running = ['playing', 'paused'].includes(state.playback);
    // Keep all channels at the same observation instant. Live Off freezes the
    // current settings instead of sending the user back to the editor. Pause
    // always captures its exact audible position, including when Live is Off.
    if (state.playback === 'loading' || seeking) resetFrozen();
    for(const chip of Object.keys(chips)) {
      const next=snapshotFor(state,chip);
      if(running&&next&&(live.checked||!frozenSnapshots[chip]||state.playback==='paused'))frozenSnapshots[chip]=next;
    }
    const target = !selectedPath || channel.value === 'synth' ? 'synth' : selectedChip==='ym2612'?Number(channel.value):channel.value;
    const selectedChannel = target === 'synth' ? null : channelNumber(String(target));
    const frozen = running ? frozenSnapshots[selectedChip] : null;
    const snapshot = state.playback==='playing'
      ? (selectedChip==='ym2612'?preview.readFmSnapshot?.(frozen,state.consumedFrames)
        :selectedChip==='psg'?preview.readPsgSnapshot?.(frozen,state.consumedFrames)
          :selectedChip==='pcm'?preview.readPcmSnapshot?.(frozen,state.consumedFrames):frozen) ?? frozen : frozen;
    const voice = selectedChannel === null ? null : snapshot?.channels[selectedChannel];
    const editable=state.playback==='playing'&&Boolean(selectedChip==='ym2612'?state.manualReady:selectedChip==='psg'?state.psgManualReady:selectedChip==='pcm'?state.pcmManualReady:false);
    const view = voice ? {chip:selectedChip,snapshot, channel:selectedChannel, paused:state.playback==='paused', following:live.checked,editable} : null;
    root.dataset.live = String(Boolean(voice));
    root.dataset.target = String(target);
    root.dataset.chip=selectedChip;
    root.dataset.manualReady=String(Boolean(state.manualReady));
    root.dataset.psgManualReady=String(Boolean(state.psgManualReady));
    root.dataset.pcmManualReady=String(Boolean(state.pcmManualReady));
    channel.disabled = copying || seeking;
    live.disabled = seeking;
    const description=voice?chips[selectedChip].describe(snapshot,selectedChannel):null;
    copy.disabled=copying||state.playback!=='paused'||!description?.playable;
    copy.title=copying?'Copying…':description&&!description.playable?description.reason:
      state.playback==='paused'&&voice?'Copy this CH into a new editable Synth instrument. Your previous instrument is kept.':`Pause and select a ${chips[selectedChip].label} channel to copy its sound to Synth.`;
    mixControls?.update(state.mix);
    if(voice&&selectedChip==='pcm') {
      const mode=state.playback==='paused'?'Paused':live.checked?'Live':'Frozen';
      const rate=snapshot.clockHz/384*voice.step/2048;
      const signal=`Step ${voice.step} · Rate ${Number.isFinite(rate)?rate.toFixed(1)+' Hz':'—'}`;
      const pan=`Pan L${voice.panLeft} / R${voice.panRight}`;
      const memory=`Start ${hexAddress(voice.start)} · Loop ${hexAddress(voice.loopStart)}`;
      const manualDescription=editable?preview.describePcm?.(selectedChannel):null;
      const audition=editable?(manualDescription?.playable?'Keyboard + controls: this song CH · C4 = recorded speed':manualDescription?.reason??'Preparing keyboard'):
        !description.playable?description.reason:state.playback==='paused'?'Keyboard: this CH':'Pause to play this CH';
      text(liveStatus,`${mode} PCM CH${selectedChannel+1} · ${signal} · Volume ${voice.volume}${voice.active?'':' · Off'} · ${pan} · ${memory} · ${audition}${editable?' · temporary edits; later VGM writes take over':' · read-only'}`);
    } else if(voice&&selectedChip==='psg') {
      const mode=state.playback==='paused'?'Paused':live.checked?'Live':'Frozen';
      const label=selectedChannel===3?'Noise':`Tone ${selectedChannel+1}`;
      const settings=voice.preset;
      const signal=selectedChannel===3?`${settings.noiseType==='white'?'White':'Periodic'} · ${settings.noiseRate==='tone3'?'Tone 3 clock':{low:'Clock / 512',medium:'Clock / 1024',high:'Clock / 2048'}[settings.noiseRate]}`
        :`Period ${voice.period} · ${Number.isFinite(voice.frequencyHz)?voice.frequencyHz.toFixed(1)+' Hz':'—'}`;
      const manualDescription=editable?preview.describePsg?.(selectedChannel):null;
      const audition=editable?(manualDescription?.playable?'Keyboard + controls: this song CH':manualDescription?.reason??'Preparing keyboard'):
        !description.playable?description.reason:state.playback==='paused'?'Keyboard: this CH':'Pause to play this CH';
      text(liveStatus,`${mode} PSG ${label} · ${signal} · Attenuation ${voice.attenuation}${voice.attenuation===15?' · Muted':''} · ${audition}${editable?' · temporary edits; later VGM writes take over':' · read-only'}`);
    } else if (voice) {
      const names = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
      const midi = Number.isFinite(voice.midi) ? Math.round(voice.midi) : null;
      const note = selectedChannel === 5 && snapshot.dacEnabled ? 'DAC' :
        midi === null ? '—' : `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
      const pan = voice.preset.pan;
      const gate = selectedChannel === 5 && snapshot.dacEnabled ? 'PCM' :
        selectedChannel === 2 && snapshot.csmEnabled ? 'CSM' : `Gate ${voice.gate ? 'On' : 'Off'}`;
      const audition = selectedChannel === 5 && snapshot.dacEnabled ? 'DAC / PCM · FM keyboard unavailable' :
        selectedChannel === 2 && snapshot.csmEnabled ? 'CSM · keyboard unavailable' :
        selectedChannel === 2 && voice.specialMode && !voice.specialFrequencies[3]?.fnum ? 'No base pitch · keyboard unavailable' :
        state.playback === 'paused' ? 'Keyboard: this CH' : editable ? 'Keyboard + controls: this song CH' : 'Pause to play this CH';
      const mode = state.playback === 'paused' ? 'Paused' : live.checked ? 'Live' : 'Frozen';
      text(liveStatus, `${mode} CH${selectedChannel + 1} · ${note} · ${gate} · ${pan.left ? 'L' : ''}${pan.right ? 'R' : ''}${!pan.left && !pan.right ? 'Muted' : ''} · ${audition}${editable?' · temporary edits; later VGM writes take over':' · read-only'}`);
    } else {
      text(liveStatus, target === 'synth' ? selectedChip==='pcm'&&state.playback==='playing'?'Synth · edit and play your own sample bank; song RAM is separate':'Synth · edit and play' :
        running && !snapshotFor(state,selectedChip) ? `No ${chips[selectedChip].label} in this VGM · choose Synth to play` : 'Synth keyboard · Play, then Pause to play this CH');
    }
    // The keyboard owner needs transport/target changes even before a chip
    // snapshot exists. Notify it first so stale held notes cannot cross modes.
    onTargetState({target,chip:selectedChip, playback:state.playback, manualReady:Boolean(state.manualReady),psgManualReady:Boolean(state.psgManualReady),pcmManualReady:Boolean(state.pcmManualReady), view});
    onLiveView(view);
  }
  const preview = createPreview({getAudio, onState:showState, onStatus, beforeResume,...(mix===undefined?{}:{mix})});
  mixControls=setupMix({preview});
  seekControls=setupSeek({preview,onStatus});
  preview.setVolume(getVolume());

  function choose(path) {
    const revision = path ? project.fs.getRevision(path) : -1;
    if (path === selectedPath && revision === selectedRevision) return;
    selectedPath = path;
    selectedRevision = revision;
    resetFrozen();
    seekControls.cancelDraft();
    if (path) {
      const file = project.fs.get(path);
      // Non-binary VGM files from other tools still produce a useful load error.
      const bytes = file.type === 'binary' ? file.data : new TextEncoder().encode(file.data);
      preview.load(bytes, path.slice('/vgm/'.length));
    } else preview.clear();
    select.value = path ?? '';
    showState(preview.getState());
  }

  function refresh() {
    if (disposed) return;
    // Metadata only: knob edits must not repeatedly copy large recordings.
    const entries = project.listEntries().filter(entry => entry.type === 'file' && isSong(entry.path));
    const revision = JSON.stringify(entries.map(entry => [entry.path, entry.revision]));
    if (revision !== listRevision) {
      listRevision = revision;
      select.replaceChildren(...entries.map(entry => {
        const option = document.createElement('option');
        option.value = entry.path;
        option.textContent = entry.path.slice('/vgm/'.length);
        return option;
      }));
    }
    const exists = path => entries.some(entry => entry.path === path);
    const next = exists(project.selectedPath) ? project.selectedPath : exists(selectedPath) ? selectedPath : entries[0]?.path ?? null;
    root.hidden = !entries.length;
    formatInfo.hidden = Boolean(entries.length);
    choose(next);
    select.value = next ?? '';
  }
  const unsubscribe = project.onDidChange(refresh);

  select.addEventListener('change', () => {
    choose(select.value);
    void onFileSelected?.(selectedPath);
    select.blur();
  });
  // Pointer operations leave letter keys available to the instrument keyboard.
  for (const button of [play, stop, copy]) {
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('keydown', event => {
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    });
  }
  play.addEventListener('click', () => {
    const state = preview.getState().playback;
    if (state === 'playing') preview.pause();
    else if (state === 'paused') void preview.resume().catch(() => showState(preview.getState()));
    else void preview.play().catch(() => showState(preview.getState()));
  });
  stop.addEventListener('click', () => preview.stop());
  copy.addEventListener('click',async()=>{
    const state=preview.getState(),number=channelNumber(channel.value);
    const chip=selectedChip,snapshot=snapshotFor(state,chip);
    if(copying||state.playback!=='paused'||number===null||!snapshot)return;
    copying=true;showState(state);
    try {
      const preset=chips[chip].copy(snapshot,number);
      const suffix=chip==='pcm'?`PCM-CH${number+1}`:chip==='psg'?`PSG-${number===3?'Noise':'Tone'+(number+1)}`:`CH${number+1}`;
      const copied=await onCopyToSynth(preset,`${state.name.replace(/\.(?:vgm|vgz)$/i,'')}-${suffix}`);
      if(copied)channel.value='synth';
    } catch(error) {onStatus(`Copy failed: ${error.message}`);}
    finally {copying=false;showState(preview.getState());copy.blur();}
  });
  select.addEventListener('keydown', event => event.stopPropagation());
  live.addEventListener('change', () => {showState(preview.getState()); live.blur();});
  channel.addEventListener('change', () => {rememberChannel();showState(preview.getState()); channel.blur();});
  for (const control of [live, channel]) control.addEventListener('keydown', event => event.stopPropagation());

  refresh();
  showState(preview.getState());
  return {
    stop: () => preview.stop(),
    editFm: edit=>preview.editFm?.(edit),
    applyFmPreset: (channel,preset)=>preview.applyFmPreset?.(channel,preset),
    noteOnFm: (...args)=>preview.noteOnFm?.(...args),
    noteOffFm: id=>preview.noteOffFm?.(id),
    releaseFmKeyboard: ()=>preview.releaseFmKeyboard?.(),
    setFmPitch: value=>preview.setFmPitch?.(value),
    describeFm: channel=>preview.describeFm?.(channel),
    editPsg: edit=>preview.editPsg?.(edit),
    applyPsgPreset: (channel,preset)=>preview.applyPsgPreset?.(channel,preset),
    noteOnPsg: (...args)=>preview.noteOnPsg?.(...args),
    noteOffPsg: id=>preview.noteOffPsg?.(id),
    releasePsgKeyboard: ()=>preview.releasePsgKeyboard?.(),
    setPsgPitch: value=>preview.setPsgPitch?.(value),
    describePsg: channel=>preview.describePsg?.(channel),
    editPcm: edit=>preview.editPcm?.(edit),
    applyPcmSettings: (...args)=>preview.applyPcmSettings?.(...args),
    noteOnPcm: (...args)=>preview.noteOnPcm?.(...args),
    noteOffPcm: id=>preview.noteOffPcm?.(id),
    releasePcmKeyboard: ()=>preview.releasePcmKeyboard?.(),
    setPcmPitch: value=>preview.setPcmPitch?.(value),
    describePcm: channel=>preview.describePcm?.(channel),
    selectChip(chip) {
      if(!Object.hasOwn(chips,chip)||copying)return false;
      if(chip===selectedChip)return true;
      const synth=channel.value==='synth';rememberChannel();
      setChipOptions(chip,synth?'synth':lastChannels[chip]);
      showState(preview.getState());return true;
    },
    selectTarget(value) {
      value=String(value);
      const chip=/^pcm:[0-7]$/.test(value)?'pcm':/^psg:[0-3]$/.test(value)?'psg':/^[0-5]$/.test(value)?'ym2612':value==='synth'?selectedChip:null;
      if(!chip||copying)return false;
      rememberChannel();setChipOptions(chip,value);rememberChannel();
      showState(preview.getState());
      return true;
    },
    setVolume: value => preview.setVolume(value),
    reset() {preview.stop();selectedRevision=-1;mixControls.close();refresh();},
    dispose() {disposed = true; unsubscribe(); seekControls.dispose();preview.dispose();mixControls.dispose();},
  };
}
