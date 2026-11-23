// SPDX-License-Identifier: BSD-3-Clause
import { VSU_CHANNEL_COUNT } from './vsu.js';
import { CH5 } from './ch5.js';
import { VGM_SAMPLE_RATE } from './vgm.js';

const ALL_CHANNELS = (1 << VSU_CHANNEL_COUNT) - 1;
const TRACK_MODE = { off: 'Wave', sweep: 'Sweep', modulation: 'Modulation' };

function timeLabel(ticks) {
  const seconds = Math.floor(ticks / VGM_SAMPLE_RATE);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

export function setupVgmPlayer({ root, audio, preparePlayback, importSongs, openSong }) {
  const doc = root.ownerDocument;
  const byId = id => root.querySelector('#' + id);
  const picker = byId('vgmSong'), importButton = byId('vgmImport');
  const playButton = byId('vgmPlay'), pauseButton = byId('vgmPause'), stopButton = byId('vgmStop');
  const loop = byId('vgmLoop');
  const progress = byId('vgmProgress'), time = byId('vgmTime'), status = byId('vgmStatus'), errorOutput = byId('vgmError');
  const mixer = byId('vgmMixer'), channelList = byId('vgmChannels');
  let paths = [];
  let available = false;
  const titles = new Map();
  let song = null, state = 'empty', playbackId = null, playAttempt = 0;
  let muted = 0, solo = 0;

  function make(tag, text) {
    const element = doc.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function mixerMask() {
    return (solo || ALL_CHANNELS) & ~muted;
  }

  function toggleMask(kind, index) {
    const bit = 1 << index;
    if (kind === 'mute') muted ^= bit;
    else solo ^= bit;
    audio.setVgmMask(mixerMask());
    drawMixerButtons();
  }

  const channels = Array.from({ length: VSU_CHANNEL_COUNT }, (_, index) => {
    const strip = make('div');
    strip.className = 'vgm-channel';
    strip.dataset.channel = String(index + 1);
    const heading = make('h3', 'CH' + (index + 1));
    const mode = make('output');
    const levels = make('output');
    const buttons = make('div');
    buttons.className = 'switches';
    const mute = make('button', 'Mute'), soloButton = make('button', 'Solo');
    for (const [button, kind] of [[mute, 'Mute'], [soloButton, 'Solo']]) {
      button.type = 'button';
      button.setAttribute('aria-label', kind + ' CH' + (index + 1));
      button.addEventListener('click', () => toggleMask(kind.toLowerCase(), index));
      buttons.append(button);
    }
    strip.append(heading, mode, levels, buttons);
    channelList.append(strip);
    return { strip, mode, levels, mute, solo: soloButton };
  });

  function drawMixerButtons() {
    channels.forEach((channel, index) => {
      channel.mute.setAttribute('aria-pressed', String(Boolean(muted & (1 << index))));
      channel.solo.setAttribute('aria-pressed', String(Boolean(solo & (1 << index))));
    });
  }

  function drawChannels(values = []) {
    channels.forEach(({ strip, mode, levels }, index) => {
      const { active = false, left = 0, right = 0, mode: effect = 'off' } = values[index] ?? {};
      if (strip.dataset.active !== String(active)) strip.dataset.active = String(active);
      const voiceMode = index === CH5 ? TRACK_MODE[effect] ?? 'Wave'
        : index === VSU_CHANNEL_COUNT - 1 ? 'Noise' : 'Wave';
      const voice = voiceMode + (active ? ' · On' : ' · Off');
      const volume = `L ${left} / R ${right}`;
      if (mode.value !== voice) mode.value = voice;
      if (levels.value !== volume) levels.value = volume;
    });
  }

  function drawSongs() {
    const placeholder = new Option('Choose a song…', '');
    placeholder.disabled = true;
    picker.replaceChildren(placeholder);
    for (const path of paths) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      const title = titles.get(path);
      const option = new Option(title || name, path);
      option.title = path;
      picker.append(option);
    }
    picker.value = song?.path ?? '';
    picker.disabled = !available || !paths.length;
  }

  function drawPosition(ticks = 0) {
    const total = song?.plan.durationTicks ?? 0;
    progress.max = total || 1;
    progress.value = ticks;
    time.value = timeLabel(ticks) + ' / ' + timeLabel(total);
  }

  function drawTransport() {
    playButton.disabled = !song || state === 'playing' || state === 'preparing';
    playButton.textContent = state === 'paused' ? 'Resume' : 'Play';
    pauseButton.disabled = state !== 'playing';
    stopButton.disabled = !['preparing', 'playing', 'paused', 'ended'].includes(state);
    mixer.hidden = !song;
  }

  function stop() {
    playAttempt += 1;
    if (playbackId !== null) audio.stopVgm();
    playbackId = null;
    state = song ? 'stopped' : 'empty';
    status.textContent = song ? 'Stopped.' : 'Choose a Virtual Boy VGM or VGZ.';
    drawPosition();
    drawChannels();
    drawTransport();
  }

  function interrupt(error) {
    if (['preparing', 'playing', 'paused'].includes(state)) {
      stop();
      if (error) status.textContent = error.message;
    }
  }

  function onAudioState(update) {
    if (playbackId === null || update.id !== playbackId) return;
    state = update.state;
    if (state === 'stopped') playbackId = null;
    const next = { playing: 'Playing.', paused: 'Paused.', ended: 'Finished.', stopped: 'Stopped.' }[state];
    if (status.textContent !== next) status.textContent = next;
    drawPosition(update.positionTicks);
    drawChannels(update.channels);
    drawTransport();
  }

  function setSong(path, plan, { show = false } = {}) {
    song = path ? { path, plan } : null;
    if (path) titles.set(path, plan.title);
    stop();
    showError();
    if (show) root.open = true;
    if (song) status.textContent = 'Ready.';
    drawSongs();
  }

  function setFiles(next) {
    paths = next;
    for (const path of titles.keys()) if (!paths.includes(path)) titles.delete(path);
    drawSongs();
  }

  function setAvailability(next) {
    if (available === next) return;
    available = next;
    picker.disabled = !available || !paths.length;
    importButton.disabled = !available;
  }

  function showError(error) {
    errorOutput.textContent = error?.message ?? '';
    errorOutput.hidden = !error;
  }

  async function play() {
    if (playButton.disabled) return;
    if (state === 'paused') {
      audio.pauseVgm(false);
      return;
    }
    state = 'preparing';
    status.textContent = 'Preparing playback…';
    drawTransport();
    const attempt = ++playAttempt;
    try {
      await preparePlayback();
      if (attempt !== playAttempt) return;
      playbackId = audio.playVgm(song.plan, { loop: loop.checked, mask: mixerMask() });
    } catch (error) {
      if (attempt !== playAttempt) return;
      stop();
      status.textContent = error.message;
    }
  }

  importButton.addEventListener('click', importSongs);
  picker.addEventListener('change', async () => {
    try {
      await openSong(picker.value);
    } catch (error) {
      showError(error);
    } finally {
      picker.value = song?.path ?? '';
    }
  });
  playButton.addEventListener('click', () => void play());
  pauseButton.addEventListener('click', () => audio.pauseVgm(true));
  stopButton.addEventListener('click', stop);
  loop.addEventListener('change', () => audio.setVgmLoop(loop.checked));
  drawMixerButtons();
  drawSongs();
  drawTransport();
  return { setFiles, setSong, setAvailability, showError, onAudioState, interrupt };
}
