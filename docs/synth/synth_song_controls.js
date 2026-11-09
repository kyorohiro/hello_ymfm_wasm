import {createSynthSongPreview} from './synth_song_preview.js?v=vgm-live-1';

const isSong = path => path.startsWith('/vgm/') && /\.(vgm|vgz)$/i.test(path);
const displayTime = seconds => {
  const whole = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** Keep reference-song selection separate from the instrument editor. */
export function setupSynthSongControls({project, getAudio, getVolume, onFileSelected, onLiveView=()=>{}}) {
  const root = document.getElementById('synthSongPlayer');
  const select = document.getElementById('synthSongSelect');
  const play = document.getElementById('synthSongPlayButton');
  const stop = document.getElementById('synthSongStopButton');
  const status = document.getElementById('synthSongStatus');
  const time = document.getElementById('synthSongTime');
  const live = document.getElementById('synthSongLiveToggle');
  const channel = document.getElementById('synthSongChannelSelect');
  const liveStatus = document.getElementById('synthSongLiveStatus');
  const formatInfo = document.querySelector('.synth-file-format-note');
  let selectedPath = null, selectedRevision = -1, listRevision = '', disposed = false;
  const text = (node, value) => {if (node.textContent !== value) node.textContent = value;};

  function showState(state) {
    root.dataset.state = status.dataset.state = state.playback;
    root.dataset.consumedFrames = String(state.consumedFrames ?? 0);
    text(play, state.playback === 'playing' ? 'Pause' : state.playback === 'paused' ? 'Resume' : 'Play');
    play.disabled = !selectedPath || state.playback === 'loading';
    stop.disabled = !['loading', 'playing', 'paused'].includes(state.playback);
    const messages = {stopped:'Stopped.', loading:'Loading…', playing:'Playing.', paused:'Paused.', ended:'Finished.'};
    // Progress is frequent; announce transport changes, not an identical status
    // on every render refill, to keep the live region quiet while playing.
    text(status, state.errorMessage ? `${state.name}: ${state.errorMessage}` : messages[state.playback] ?? 'Ready.');
    status.title = status.textContent;
    text(time, displayTime(state.positionSeconds));
    const running = ['playing', 'paused'].includes(state.playback);
    const snapshot = running && live.checked ? state.liveState : null;
    const selectedChannel = Number(channel.value);
    const voice = snapshot?.channels[selectedChannel];
    root.dataset.live = String(Boolean(voice));
    channel.disabled = !live.checked || running && !state.liveState;
    if (voice) {
      const names = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
      const midi = Number.isFinite(voice.midi) ? Math.round(voice.midi) : null;
      const note = selectedChannel === 5 && snapshot.dacEnabled ? 'DAC' :
        midi === null ? '—' : `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
      const pan = voice.preset.pan;
      const gate = selectedChannel === 5 && snapshot.dacEnabled ? 'PCM' :
        selectedChannel === 2 && snapshot.csmEnabled ? 'CSM' : `Gate ${voice.gate ? 'On' : 'Off'}`;
      text(liveStatus, `${state.playback === 'paused' ? 'Paused' : 'Live'} CH${selectedChannel + 1} · ${note} · ${gate} · ${pan.left ? 'L' : ''}${pan.right ? 'R' : ''}${!pan.left && !pan.right ? 'Muted' : ''} · read-only`);
      onLiveView({snapshot, channel:selectedChannel, paused:state.playback === 'paused'});
    } else {
      text(liveStatus, running && live.checked && !state.liveState ? 'No YM2612 in this VGM' : live.checked ? 'Live when playing' : 'Edit');
      onLiveView(null);
    }
  }
  const preview = createSynthSongPreview({getAudio, onState:showState});
  preview.setVolume(getVolume());

  function choose(path) {
    const revision = path ? project.fs.getRevision(path) : -1;
    if (path === selectedPath && revision === selectedRevision) return;
    selectedPath = path;
    selectedRevision = revision;
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
  for (const button of [play, stop]) {
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
  select.addEventListener('keydown', event => event.stopPropagation());
  live.addEventListener('change', () => {showState(preview.getState()); live.blur();});
  channel.addEventListener('change', () => {showState(preview.getState()); channel.blur();});
  for (const control of [live, channel]) control.addEventListener('keydown', event => event.stopPropagation());

  refresh();
  showState(preview.getState());
  return {
    stop: () => preview.stop(),
    setVolume: value => preview.setVolume(value),
    reset() {preview.stop(); refresh();},
    dispose() {disposed = true; unsubscribe(); preview.dispose();},
  };
}
