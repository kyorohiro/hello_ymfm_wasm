// SPDX-License-Identifier: BSD-3-Clause
import {createGameboySongPreview} from './song_preview.js';
import {isGameboySongPath} from './code_project.js?dmg-json-code=1';

const time = seconds => {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
};

/** Passive Files list; audio belongs exclusively to an explicit Play gesture. */
export function setupGameboySongControls({project, getAudio, beforePlay,
  onLiveView = () => {}, onState = () => {}, onStatus = () => {},
  createPreview = createGameboySongPreview, document: doc = globalThis.document} = {}) {
  const $ = id => doc.getElementById(id);
  const root = $('dmgSongPlayer'), select = $('dmgSongSelect');
  const play = $('dmgSongPlayButton'), stop = $('dmgSongStopButton');
  const status = $('dmgSongStatus'), live = $('dmgSongLiveEnabled');
  const channel = $('dmgSongChannelSelect'), liveStatus = $('dmgSongLiveStatus');
  const position = $('dmgSongPosition'), listeners = [];
  if (!root || !select || !play || !stop || !status || !live || !channel || !liveStatus)
    throw Error('Game Boy song controls mount is missing.');
  let disposed = false, selectedPath = null, selectedRevision = -1;
  let attempted = '', listSignature = '', selection = 0, choosing = false, selectionError = '';
  const text = (node, value) => {if (node && node.textContent !== value) node.textContent = value;};
  const report = error => {if (!disposed) {selectionError = error?.message ?? String(error); showState(preview.read()); onStatus(`VGM: ${selectionError}`);}};
  const listen = (node, type, fn) => {node.addEventListener(type, fn); listeners.push(() => node.removeEventListener(type, fn));};
  function showState(state) {
    if (disposed) return;
    root.dataset.state = state.playback;
    root.dataset.loading = String(Boolean(choosing || state.loading));
    root.dataset.positionFrames = String(state.positionFrames ?? 0);
    root.dataset.live = String(Boolean(state.liveActive && state.liveState));
    root.dataset.renderedFrames = String((state.positionFrames ?? 0) + (state.bufferedFrames ?? 0));
    text(play, state.playing ? 'Pause' : state.paused ? 'Resume' : 'Play');
    play.disabled = choosing || state.loading || state.busy || !state.hasSource;
    stop.disabled = !(choosing || state.loading || state.canStop || ['starting', 'playing', 'paused'].includes(state.playback));
    select.disabled = false;
    live.disabled = false; channel.disabled = false;
    const message = selectionError || (choosing || state.loading ? 'Validating VGM…' :
      state.playback === 'playing' ? 'Playing.' : state.playback === 'paused' ? 'Paused.' :
      state.playback === 'starting' ? 'Starting…' : state.playback === 'ended' ? 'Finished.' :
      state.playback === 'error' ? state.errorMessage || 'Playback failed.' :
      state.hasSource ? 'Ready. Press Play; your instrument is kept.' : 'Add a VGM / VGZ to Files to hear a reference song.');
    text(status, message); status.dataset.error = String(Boolean(selectionError || state.playback === 'error'));
    text(position, `${time(state.positionSeconds)}${state.durationSeconds != null ? ` / ${time(state.durationSeconds)}` : ''}`);
    const voice = Number.isInteger(state.liveVoice) ? state.liveVoice : Number(channel.value);
    channel.value = String(voice);
    live.checked = state.liveEnabled !== false;
    const observed = Boolean(state.liveActive && state.liveState);
    text(liveStatus, state.liveError ? `CH${voice + 1}: ${state.liveMessage || 'Live unavailable.'}` : observed ?
      `${state.paused ? 'Paused' : state.liveEnabled ? 'Live' : 'Frozen'} CH${voice + 1} · read-only · Stop VGM to edit and play your instrument.` :
      state.liveWaiting ? 'Waiting for the audible song position…' : 'CH1–CH4 show the song while it plays.');
    onLiveView({...state, selectedPath}); onState({...state, selectedPath});
  }
  const preview = createPreview({getAudio, beforePlay, onState: showState, onStatus});
  preview.setLiveEnabled(live.checked !== false);
  preview.setLiveVoice(Math.max(0, Math.min(3, Number(channel.value) || 0)));

  async function choose(path) {
    const revision = path ? project.fs.getRevision(path) : -1;
    if (path === selectedPath && revision === selectedRevision) {select.value = path || ''; return true;}
    const key = `${path ?? ''}:${revision}`;
    if (key === attempted) {select.value = selectedPath || ''; return false;}
    attempted = key;
    const token = ++selection;
    if (!path) {
      choosing = false; selectedPath = null; selectedRevision = -1; selectionError = '';
      preview.clear(); showState(preview.read()); return true;
    }
    const file = project.fs.get(path);
    if (!file || file.type !== 'binary') return false;
    choosing = true; selectionError = ''; showState(preview.read());
    try {
      const accepted = await preview.load(file.data, path.slice('/vgm/'.length));
      if (disposed || token !== selection) return false;
      if (accepted === false) throw Error(preview.read().errorMessage || `Could not load ${path}. Current song kept.`);
      selectedPath = path; selectedRevision = revision; select.value = path;
      return true;
    } catch (error) {
      if (!disposed && token === selection) {select.value = selectedPath || ''; if (error?.name !== 'AbortError') report(error);}
      return false;
    } finally {
      if (!disposed && token === selection) {choosing = false; showState(preview.read());}
    }
  }
  function refresh() {
    if (disposed) return;
    const entries = project.listEntries().filter(entry => entry.fileType === 'binary' && isGameboySongPath(entry.path))
      .sort((a, b) => a.path.localeCompare(b.path));
    const signature = JSON.stringify(entries.map(entry => [entry.path, entry.revision]));
    if (signature !== listSignature) {
      listSignature = signature;
      const placeholder = doc.createElement('option'); placeholder.value = '';
      placeholder.textContent = entries.length ? 'Choose VGM…' : 'No VGM files'; placeholder.disabled = true;
      select.replaceChildren(placeholder, ...entries.map(entry => {
        const option = doc.createElement('option'); option.value = entry.path;
        option.textContent = entry.path.slice('/vgm/'.length); option.title = entry.path; return option;
      }));
    }
    const next = entries.some(entry => entry.path === project.selectedPath) ? project.selectedPath :
      entries.some(entry => entry.path === selectedPath) ? selectedPath : entries[0]?.path ?? null;
    select.value = selectedPath || next || '';
    void choose(next);
  }
  const unsubscribe = project.onDidChange(refresh);
  function stopCurrent() {
    if (disposed) return;
    selection++; choosing = false; selectionError = ''; select.value = selectedPath || '';
    preview.stop(); showState(preview.read());
  }
  listen(select, 'change', () => {
    select.blur(); const path = select.value; selectionError = ''; attempted = '';
    if (project.fs.has(path) && isGameboySongPath(path)) {void choose(path); project.select(path);}
  });
  listen(play, 'click', () => {
    play.blur(); selectionError = '';
    const state = preview.read();
    if (choosing || state.loading || state.busy || !state.hasSource) return;
    if (state.playing) preview.pause();
    else Promise.resolve(state.paused ? preview.resume() : preview.play()).catch(report);
  });
  listen(stop, 'click', () => {stop.blur(); stopCurrent();});
  listen(live, 'change', () => {live.blur(); preview.setLiveEnabled(live.checked);});
  listen(channel, 'change', () => {channel.blur(); preview.setLiveVoice(Number(channel.value));});
  refresh(); showState(preview.read());
  return {
    getState: () => ({...preview.read(), selectedPath}),
    isActive: () => ['starting', 'playing', 'paused'].includes(preview.read().playback),
    isPlaying: () => preview.read().playing,
    async selectPath(path) {
      if (disposed || !isGameboySongPath(path) || !project.fs.has(path)) return false;
      attempted = ''; const pending = choose(path); project.select(path); return pending;
    },
    stop: stopCurrent,
    dispose() {if (disposed) return; disposed = true; selection++; unsubscribe(); for (const remove of listeners) remove(); preview.dispose();},
  };
}
