import {createSynthSongPreview} from './synth_song_preview.js?v=song-seek-1';
import {setupSynthSongSeekControls} from './synth_song_seek_controls.js?v=song-seek-1';
import {setupSynthSongMixControls} from './synth_song_mix_controls.js?v=mix-source-1';
import {createSynthSongCopyPreset} from './synth_song_copy.js';
import {describeSynthSongVoice} from './synth_song_voice.js?v=vgm-mix-copy-1';

const isSong = path => path.startsWith('/vgm/') && /\.(vgm|vgz)$/i.test(path);

/** Keep reference-song selection separate from the instrument editor. */
export function setupSynthSongControls({project, getAudio, getVolume, onFileSelected, onLiveView=()=>{}, onTargetState=()=>{}, onCopyToSynth=async()=>false, onStatus=()=>{}, beforeResume}) {
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
  let frozenSnapshot = null;
  let copying=false, mixControls=null, seekControls=null;
  const text = (node, value) => {if (node.textContent !== value) node.textContent = value;};

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
    if (state.playback === 'loading' || seeking) frozenSnapshot = null;
    if (running && state.liveState && (live.checked || !frozenSnapshot || state.playback === 'paused')) {
      frozenSnapshot = state.liveState;
    }
    const target = !selectedPath || channel.value === 'synth' ? 'synth' : Number(channel.value);
    const selectedChannel = target === 'synth' ? null : target;
    const snapshot = running ? frozenSnapshot : null;
    const voice = selectedChannel === null ? null : snapshot?.channels[selectedChannel];
    const view = voice ? {snapshot, channel:selectedChannel, paused:state.playback === 'paused', following:live.checked} : null;
    root.dataset.live = String(Boolean(voice));
    root.dataset.target = String(target);
    channel.disabled = copying || seeking;
    live.disabled = seeking;
    const description=voice?describeSynthSongVoice(snapshot,selectedChannel):null;
    copy.disabled=copying||state.playback!=='paused'||!description?.playable;
    copy.title=copying?'Copying…':description&&!description.playable?description.reason:
      state.playback==='paused'&&voice?'Copy this CH into a new editable Synth instrument. Your previous instrument is kept.':'Pause and select an FM channel to copy its sound to Synth.';
    mixControls?.update(state.mix);
    document.getElementById('synthSongMixButton').disabled = seeking;
    if (seeking) mixControls?.close();
    if (voice) {
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
        state.playback === 'paused' ? 'Keyboard: this CH' : 'Pause to play this CH';
      const mode = state.playback === 'paused' ? 'Paused' : live.checked ? 'Live' : 'Frozen';
      text(liveStatus, `${mode} CH${selectedChannel + 1} · ${note} · ${gate} · ${pan.left ? 'L' : ''}${pan.right ? 'R' : ''}${!pan.left && !pan.right ? 'Muted' : ''} · ${audition} · read-only`);
    } else {
      text(liveStatus, target === 'synth' ? 'Synth · edit and play' :
        running && !state.liveState ? 'No YM2612 in this VGM · choose Synth to play' : 'Synth keyboard · Play, then Pause to play this CH');
    }
    // The keyboard owner needs transport/target changes even before a YM2612
    // snapshot exists. Notify it first so stale held notes cannot cross modes.
    onTargetState({target, playback:state.playback, view});
    onLiveView(view);
  }
  const preview = createSynthSongPreview({getAudio, onState:showState, onStatus, beforeResume});
  mixControls=setupSynthSongMixControls({preview});
  seekControls=setupSynthSongSeekControls({preview,onStatus});
  preview.setVolume(getVolume());

  function choose(path) {
    const revision = path ? project.fs.getRevision(path) : -1;
    if (path === selectedPath && revision === selectedRevision) return;
    selectedPath = path;
    selectedRevision = revision;
    frozenSnapshot = null;
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
    const state=preview.getState(),number=channel.value==='synth'?null:Number(channel.value);
    if(copying||state.playback!=='paused'||number===null||!state.liveState)return;
    copying=true;showState(state);
    try {
      const preset=createSynthSongCopyPreset(state.liveState,number);
      const copied=await onCopyToSynth(preset,`${state.name.replace(/\.(?:vgm|vgz)$/i,'')}-CH${number+1}`);
      if(copied)channel.value='synth';
    } catch(error) {onStatus(`Copy failed: ${error.message}`);}
    finally {copying=false;showState(preview.getState());copy.blur();}
  });
  select.addEventListener('keydown', event => event.stopPropagation());
  live.addEventListener('change', () => {showState(preview.getState()); live.blur();});
  channel.addEventListener('change', () => {showState(preview.getState()); channel.blur();});
  for (const control of [live, channel]) control.addEventListener('keydown', event => event.stopPropagation());

  refresh();
  showState(preview.getState());
  return {
    stop: () => preview.stop(),
    setVolume: value => preview.setVolume(value),
    reset() {preview.stop();selectedRevision=-1;mixControls.close();refresh();},
    dispose() {disposed = true; unsubscribe(); seekControls.dispose();preview.dispose();mixControls.dispose();},
  };
}
