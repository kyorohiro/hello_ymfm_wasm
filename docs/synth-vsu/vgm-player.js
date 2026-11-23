// SPDX-License-Identifier: BSD-3-Clause
import { VSU_CHANNEL_COUNT } from './vsu.js';
import { VGM_SAMPLE_RATE } from './vgm.js';

const ALL_CHANNELS = (1 << VSU_CHANNEL_COUNT) - 1;

function timeLabel(ticks) {
  const hundredths = Math.floor(ticks * 100 / VGM_SAMPLE_RATE);
  const seconds = Math.floor(hundredths / 100);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') +
    '.' + String(hundredths % 100).padStart(2, '0');
}

export function setupVgmPlayer({ root, audio, preparePlayback, importSongs, openSong, copyVoice, onPlaybackChange }) {
  const doc = root.ownerDocument;
  const byId = id => doc.getElementById(id);
  const picker = byId('vgmSong'), importButton = byId('vgmImport');
  const playButton = byId('vgmPlay'), pauseButton = byId('vgmPause'), stopButton = byId('vgmStop');
  const loop = byId('vgmLoop');
  const seek = byId('vgmProgress'), time = byId('vgmTime'), status = byId('vgmStatus'), errorOutput = byId('vgmError');
  const loopMarker = byId('vgmLoopMarker'), loopTime = byId('vgmLoopTime');
  const channelMix = byId('vgmChannelMix'), muteButton = byId('vgmMute'), soloButton = byId('vgmSolo');
  const copy = byId('vgmCapture'), captureStatus = byId('vgmCaptureStatus');
  let paths = [];
  let available = false;
  const titles = new Map();
  let song = null, state = 'empty', playbackId = null, playAttempt = 0;
  let positionTick = 0, scrubTick = null, pendingSeek = null;
  let muted = 0, solo = 0;
  let channelIndex = null, liveChannels = [], capturePending = false;
  let reportedPlayback = '';

  function mixerMask() {
    return (solo || ALL_CHANNELS) & ~muted;
  }

  function toggleMask(kind) {
    if (channelMix.hidden) return;
    const bit = 1 << channelIndex;
    if (kind === 'mute') muted ^= bit;
    else solo ^= bit;
    audio.setVgmMask(mixerMask());
    drawChannelMix();
  }

  function drawChannelMix() {
    const hidden = channelIndex === null || (state !== 'playing' && state !== 'paused');
    if (channelMix.hidden !== hidden) channelMix.hidden = hidden;
    if (hidden) return;
    const bit = 1 << channelIndex;
    for (const [button, mask] of [[muteButton, muted], [soloButton, solo]]) {
      const pressed = String(Boolean(mask & bit));
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    }
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

  function drawPosition() {
    const total = song?.plan.durationTicks ?? 0;
    const ticks = scrubTick ?? positionTick;
    seek.value = ticks;
    seek.style.setProperty('--seek-position', (total ? ticks * 100 / total : 0) + '%');
    time.value = timeLabel(ticks) + ' / ' + timeLabel(total);
    seek.setAttribute('aria-valuetext', time.value);
  }

  function drawSeekRange() {
    const total = song?.plan.durationTicks ?? 0;
    const loopTick = song?.plan.loopTick ?? null;
    seek.max = total || 1;
    loopMarker.hidden = loopTick === null;
    loopTime.hidden = loopTick === null;
    if (loopTick !== null) {
      loopMarker.style.setProperty('--loop-position', (loopTick * 100 / total) + '%');
      loopMarker.title = 'Loop starts at ' + timeLabel(loopTick);
      loopTime.value = 'Loop ' + timeLabel(loopTick);
    } else loopTime.value = '';
    drawPosition();
  }

  function drawTransport() {
    playButton.disabled = !song || ['playing', 'preparing', 'seeking'].includes(state);
    playButton.textContent = state === 'paused' ? 'Resume' : 'Play';
    pauseButton.disabled = state !== 'playing';
    stopButton.disabled = !['preparing', 'seeking', 'playing', 'paused', 'ended'].includes(state);
    seek.disabled = !song || state === 'preparing';
    drawChannelMix();
    drawCapture();
    const playback = state + ':' + playbackId;
    if (playback !== reportedPlayback) {
      reportedPlayback = playback;
      onPlaybackChange({ state, id: playbackId });
    }
  }

  function drawCapture() {
    const paused = state === 'paused';
    const active = channelIndex !== null && liveChannels[channelIndex]?.active;
    if (copy.hidden !== channelMix.hidden) copy.hidden = channelMix.hidden;
    copy.disabled = capturePending || !paused || !active;
    copy.title = paused && !active ? 'Choose an active VGM channel.' : 'Copy an active channel from paused playback.';
  }

  function setChannel(index) {
    channelIndex = index;
    if (index !== null) {
      muteButton.setAttribute('aria-label', 'Mute VGM CH' + (index + 1));
      soloButton.setAttribute('aria-label', 'Solo VGM CH' + (index + 1));
    }
    drawChannelMix();
    drawCapture();
  }

  async function capture() {
    if (copy.disabled) return;
    const index = channelIndex;
    capturePending = true;
    captureStatus.value = '';
    drawCapture();
    try {
      const snapshot = await audio.captureVgmChannel(index);
      await copyVoice(snapshot);
      captureStatus.value = 'Copied CH' + (index + 1) + ' to Synth.';
    } catch (error) {
      captureStatus.value = error.message;
    } finally {
      capturePending = false;
      drawCapture();
    }
  }

  function stop() {
    playAttempt += 1;
    pendingSeek?.controller.abort();
    pendingSeek = null;
    audio.stopVgm();
    playbackId = null;
    state = song ? 'stopped' : 'empty';
    positionTick = 0;
    scrubTick = null;
    liveChannels = [];
    status.textContent = song ? 'Stopped.' : 'Choose a Virtual Boy VGM or VGZ.';
    drawPosition();
    drawTransport();
  }

  function interrupt(error) {
    if (['preparing', 'seeking', 'playing', 'paused'].includes(state)) {
      stop();
      if (error) status.textContent = error.message;
    }
  }

  function onAudioState(update) {
    if (playbackId === null || update.id !== playbackId || (pendingSeek && pendingSeek.id !== update.id)) return;
    pendingSeek = null;
    state = update.state;
    liveChannels = update.channels;
    positionTick = update.positionTicks;
    if (state === 'stopped') playbackId = null;
    const next = { playing: 'Playing.', paused: 'Paused.', ended: 'Finished.', stopped: 'Stopped.' }[state];
    if (status.textContent !== next) status.textContent = next;
    drawPosition();
    drawTransport();
  }

  function setSong(path, plan, { show = false } = {}) {
    song = path ? { path, plan } : null;
    if (path) titles.set(path, plan.title);
    stop();
    captureStatus.value = '';
    drawSeekRange();
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

  async function seekTo(tick) {
    if (!song || state === 'preparing') return;
    const resume = pendingSeek ? pendingSeek.resume : state === 'playing';
    const target = Math.max(0, Math.min(song.plan.durationTicks, tick));
    pendingSeek?.controller.abort();
    const request = { controller: new AbortController(), resume, id: null };
    pendingSeek = request;
    state = 'seeking';
    scrubTick = null;
    positionTick = target;
    captureStatus.value = '';
    status.textContent = 'Seeking…';
    drawPosition();
    drawTransport();
    try {
      await preparePlayback();
      if (pendingSeek !== request) return;
      const id = await audio.seekVgm(song.plan, target, {
        loop: loop.checked, mask: mixerMask(), paused: !request.resume, signal: request.controller.signal,
      });
      if (pendingSeek !== request) return;
      request.id = playbackId = id;
    } catch (error) {
      if (pendingSeek !== request) return;
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
  copy.addEventListener('click', () => void capture());
  muteButton.addEventListener('click', () => toggleMask('mute'));
  soloButton.addEventListener('click', () => toggleMask('solo'));
  loop.addEventListener('change', () => audio.setVgmLoop(loop.checked));
  seek.addEventListener('input', () => {
    scrubTick = seek.valueAsNumber;
    drawPosition();
  });
  seek.addEventListener('change', () => void seekTo(seek.valueAsNumber));
  function cancelScrub() {
    if (scrubTick === null) return;
    scrubTick = null;
    drawPosition();
  }
  seek.addEventListener('pointercancel', cancelScrub);
  seek.addEventListener('blur', cancelScrub);
  seek.addEventListener('keydown', event => {
    if (seek.disabled) return;
    const increments = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 };
    const seconds = increments[event.key];
    if (seconds === undefined && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const target = seconds === undefined ? event.key === 'Home' ? 0 : song.plan.durationTicks
      : seek.valueAsNumber + seconds * VGM_SAMPLE_RATE;
    void seekTo(target);
  });
  drawSongs();
  drawSeekRange();
  drawTransport();
  return { setFiles, setSong, setChannel, setAvailability, showError, onAudioState, interrupt };
}
