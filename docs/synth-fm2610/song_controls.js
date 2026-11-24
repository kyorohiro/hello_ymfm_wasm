// SPDX-License-Identifier: BSD-3-Clause
import { prepareFm2610Vgm } from './vgm.js';
import { createFm2610SongTransport } from './song_player.js';

function timeLabel(seconds) {
  const total = Math.floor(seconds);
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

export function setupFm2610SongControls({getFiles, sound, beforePlay, onPlayback = () => {}, announce, report}) {
  const node = id => document.getElementById(id);
  const input = node('vgmInput'), select = node('songSelect'), seek = node('songSeek');
  const playButton = node('songPlay'), pauseButton = node('songPause'), stopButton = node('songStop');
  const messages = node('songStatus');
  let path = '', source = null, loading = null, seekDraft = false, errorText = '';
  const player = createFm2610SongTransport({
    sound, beforePlay, onError: showError,
    onState(state) {
      render();
      onPlayback(state);
    },
  });

  function render() {
    const {playback, position} = player.getState();
    const duration = (source?.totalSamples ?? 0) / 44100;
    const busy = Boolean(loading) || ['loading', 'pausing'].includes(playback);
    playButton.disabled = !source || busy || playback === 'playing';
    playButton.textContent = playback === 'paused' ? 'Resume' : 'Play';
    pauseButton.disabled = playback !== 'playing';
    stopButton.disabled = !['playing', 'paused', 'loading', 'pausing'].includes(playback);
    seek.max = String(duration);
    seek.disabled = !duration || busy;
    if (!seekDraft) seek.value = String(position);
    node('songTime').textContent = timeLabel(position) + ' / ' + timeLabel(duration);
    const chip = source?.variant === 'ym2610b' ? 'YM2610B' : 'YM2610';
    const track = source?.metadata?.trackName || source?.metadata?.trackNameOriginal;
    const label = source ? [chip, track, ...source.warnings].filter(Boolean).join(' · ') : '';
    const message = errorText || (loading ? 'Reading VGM…' : playback === 'loading' ? 'Preparing playback…' : label);
    if (message !== messages.textContent) messages.textContent = message;
    messages.dataset.error = String(Boolean(errorText));
    const panel = node('referenceSong');
    panel.dataset.playback = playback;
    panel.dataset.seekRestoredFrame = String(player.getSeekCacheStats().lastRestoreFrame);
    panel.hidden = !(select.options.length > 1 || loading);
  }

  function showError(error) {
    if (error?.name === 'AbortError') return;
    errorText = error?.message ?? String(error);
    if (select.options.length <= 1) report(error);
    render();
  }

  function refresh() {
    const entries = getFiles().listVgm();
    if (path && !entries.some(entry => entry.path === path)) {
      source = null;
      path = '';
      player.clear();
    }
    select.replaceChildren(new Option('Choose a song…', ''), ...entries.map(entry => new Option(entry.name, entry.path)));
    select.value = path;
    select.disabled = !entries.length;
    render();
  }

  async function prepare(task) {
    loading?.abort();
    const controller = new AbortController(), {signal} = controller;
    loading = controller;
    errorText = '';
    render();
    try {
      const result = await task(signal);
      signal.throwIfAborted();
      ({path, source} = result);
      player.clear();
      refresh();
    } catch (error) {
      if (!signal.aborted) {
        select.value = path;
        showError(error);
      }
    } finally {
      if (loading === controller) {
        loading = null;
        render();
      }
    }
  }

  function selectFile(nextPath) {
    if (!nextPath) { clear(); return; }
    if (!loading && path === nextPath) return;
    return prepare(async signal => ({
      path: nextPath,
      source: await prepareFm2610Vgm(getFiles().readBinary(nextPath), {name: nextPath.split('/').at(-1), signal}),
    }));
  }

  function importFile(file) {
    return prepare(async signal => {
      await getFiles().ready;
      signal.throwIfAborted();
      if (file.size > 64 * 1024 * 1024) throw new RangeError('VGM file exceeds 64 MiB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const prepared = await prepareFm2610Vgm(bytes, {name: file.name, signal});
      signal.throwIfAborted();
      const presets = prepared.presets.map(({name, preset}) => ({name, patch: preset}));
      const saved = await getFiles().addVgmFiles({name: file.name, bytes, presets, signal});
      signal.throwIfAborted();
      getFiles().show(true);
      announce('Imported ' + file.name + ' · ' + saved.presetPaths.length + ' FM presets.');
      return {path: saved.path, source: prepared};
    });
  }

  function stop() { player.stop(); }

  function clear() {
    loading?.abort();
    loading = null;
    source = null;
    path = '';
    seekDraft = false;
    errorText = '';
    player.clear();
    refresh();
  }

  node('importVgm').addEventListener('click', () => {
    node('synthMenu').open = false;
    input.value = '';
    input.click();
  });
  input.addEventListener('change', () => { if (input.files[0]) void importFile(input.files[0]); });
  select.addEventListener('change', () => { select.blur(); void selectFile(select.value); });
  playButton.addEventListener('click', () => {
    errorText = '';
    if (player.getState().playback === 'paused') player.resume();
    else if (source) void player.play(source);
  });
  pauseButton.addEventListener('click', player.pause);
  stopButton.addEventListener('click', stop);
  seek.addEventListener('input', () => { seekDraft = true; });
  seek.addEventListener('change', () => {
    seekDraft = false;
    if (source) void player.play(source, {position: Number(seek.value), paused: player.getState().playback !== 'playing'});
  });
  for (const event of ['blur', 'pointercancel']) seek.addEventListener(event, () => { seekDraft = false; render(); });

  return {refresh, importFile, selectFile, stop, clear, clearPlayback: player.clear,
    getAdpcmAWindow: player.getAdpcmAWindow,
    retainAdpcmARom: player.retainAdpcmARom,
    readAdpcmABytes: player.readAdpcmABytes, readAdpcmBBytes: player.readAdpcmBBytes,
    writeFm: player.writeFm, getFmEditSnapshot: player.getFmEditSnapshot,
    setSourceGains: gains => player.setSourceGains(gains)};
}
