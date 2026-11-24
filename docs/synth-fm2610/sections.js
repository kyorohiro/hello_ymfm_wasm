// SPDX-License-Identifier: BSD-3-Clause
import {encodeAdpcmA} from '../js/adpcm_a_sample.js';
import {readSamplePCM} from '../js/adpcm_b_sample.js';
import {createOfflineAudioDecoder} from '../js/audio_decode.js';
import {createParamControl} from '../synth/synth_controls.js';
import {midiToNoteName} from '../synth/synth_keyboard.js';
import {ADPCM_A_KIT_MAX_SAMPLE_BYTES, normalizeAdpcmAKit} from './adpcm_a_kit.js';
import {createFm2610AdpcmB, FM2610_ADPCM_B_MAX_RATE, getFm2610AdpcmBWaveform} from './adpcm_b.js';
import {getFm2610AdpcmAWaveform} from './song_adpcm_a_waveform.js';
import {createFm2610AdpcmReadouts} from './song_adpcm_view.js';

const MASTER_CLOCK = 8_000_000;
const SAMPLE_ADDRESS = 0x10000;
const A_RATE = MASTER_CLOCK / 432;
const A_CUSTOM_START = 0x800000;
const A_SLOT_BYTES = 0x100000;
const A_MAX_FILE_BYTES = 64 * 1024 * 1024;
const DRUMS = ['Kick', 'Snare', 'Closed hat', 'Tom', 'Block', 'Shaker'];
const A_VOICES = DRUMS.map((_, index) => index);
export const ADPCM_A_KEYS = 'fghjkl';

function encodeDrumSample(audio, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./adpcm-a-worker.js', import.meta.url), {type: 'module'});
    function close() {
      signal.removeEventListener('abort', abort);
      worker.terminate();
    }
    function abort() {
      close();
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, {once: true});
    worker.onmessage = ({data}) => {
      close();
      if (data.error) reject(new Error(data.error));
      else resolve(data.bytes);
    };
    worker.onerror = event => {
      close();
      reject(new Error(event.message || 'Could not prepare the ADPCM-A sample.'));
    };
    try {
      const buffers = [...new Set(audio.channels.map(channel => channel.buffer))];
      worker.postMessage({audio, rate: A_RATE, maxBytes: ADPCM_A_KIT_MAX_SAMPLE_BYTES}, buffers);
    } catch (error) {
      close();
      reject(error);
    }
  });
}

function drumBank(rate) {
  const duration = [.24, .17, .065, .22, .11, .14];
  let seed = 0x2610;
  let address = SAMPLE_ADDRESS;
  const samples = duration.map((seconds, voice) => {
    const pcm = new Float32Array(Math.ceil(seconds * rate));
    let phase = 0;
    let previousNoise = 0;
    for (let frame = 0; frame < pcm.length; frame++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 0x80000000 - 1;
      const treble = (noise - previousNoise) / 2;
      previousNoise = noise;
      const time = frame / rate;
      const angle = 2 * Math.PI * time;
      let sample;
      switch (voice) {
        case 0:
          phase += 2 * Math.PI * (48 + 115 * Math.exp(-time * 36)) / rate;
          sample = .7 * Math.sin(phase) * Math.exp(-time * 16);
          break;
        case 1:
          sample = (.44 * noise + .14 * Math.sin(angle * 190)) * Math.exp(-time * 27);
          break;
        case 2:
          sample = .5 * treble * Math.exp(-time * 65);
          break;
        case 3:
          phase += 2 * Math.PI * (98 + 62 * Math.exp(-time * 28)) / rate;
          sample = .55 * Math.sin(phase) * Math.exp(-time * 20);
          break;
        case 4:
          sample = (.28 * Math.sin(angle * 740) + .12 * Math.sin(angle * 1120)) * Math.exp(-time * 38);
          break;
        default:
          sample = .42 * treble * (.68 + .32 * Math.sin(angle * 68)) * Math.exp(-time * 24);
      }
      const fade = Math.min(1, frame / (rate * .001), (pcm.length - 1 - frame) / (rate * .008));
      pcm[frame] = sample * fade;
    }
    const {bytes} = encodeAdpcmA(pcm);
    const range = {start: address, end: address + bytes.length};
    address = range.end;
    return {bytes, range};
  });
  const bytes = new Uint8Array(address - SAMPLE_ADDRESS);
  for (const sample of samples) bytes.set(sample.bytes, sample.range.start - SAMPLE_ADDRESS);
  return {bytes, ranges: samples.map(sample => sample.range)};
}

function drawAdpcmWaveform(canvas, peaks) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const {width, height} = canvas;
  context.fillStyle = '#18150f';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#4b3b26';
  context.lineWidth = 1;
  context.beginPath();
  for (const fraction of [.25, .5, .75]) {
    const y = height * fraction + .5;
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
  if (!peaks?.length) return;
  const columnWidth = width / (peaks.length / 2);
  const middle = height / 2, amplitude = middle - 4;
  context.strokeStyle = '#ffcc78';
  context.lineWidth = columnWidth;
  context.beginPath();
  for (let index = 0; index < peaks.length; index += 2) {
    const x = (index / 2 + .5) * columnWidth;
    context.moveTo(x, middle - peaks[index + 1] * amplitude - .5);
    context.lineTo(x, middle - peaks[index] * amplitude + .5);
  }
  context.stroke();
}

function createSongWaveView(canvas, prepareWaveform, report) {
  let request, activeKey;
  const cache = new Map();

  function cancel() {
    request?.abort();
    request = activeKey = undefined;
  }

  async function show(key, readBytes) {
    if (key === activeKey) return;
    cancel();
    activeKey = key;
    const cached = cache.get(key);
    drawAdpcmWaveform(canvas, cached);
    if (key === null || cached) return;

    const pending = new AbortController();
    request = pending;
    try {
      const bytes = readBytes();
      if (!bytes) {
        activeKey = undefined;
        return;
      }
      const peaks = await prepareWaveform(bytes, pending.signal, {transfer: true});
      if (pending.signal.aborted) return;
      if (cache.size >= 12) cache.delete(cache.keys().next().value);
      cache.set(key, peaks);
      drawAdpcmWaveform(canvas, peaks);
    } catch (error) {
      if (!pending.signal.aborted) report(error);
    } finally {
      if (request === pending) request = undefined;
    }
  }

  return {show, cancel, reset() { cancel(); cache.clear(); }};
}

export function setupFm2610Sections({
  ssgPanel, adpcmAPanel, adpcmBPanel, sound, releaseAdpcmBKeyboard,
  saveAdpcmAKit, saveAdpcmBSample, onAdpcmLiveChange, playSongAdpcmA, stopSongAdpcmA, report = () => {},
}) {
  const doc = ssgPanel.ownerDocument;
  const element = (tag, text, className) => {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, action) => {
    const node = element('button', text);
    node.type = 'button';
    node.addEventListener('click', () => {
      try {
        Promise.resolve(action()).catch(error => report(error.message));
      } catch (error) {
        report(error.message);
      }
    });
    return node;
  };
  const slider = (text, min, max, step, value, change) => {
    const label = element('label');
    const input = element('input');
    Object.assign(input, {type: 'range', min, max, step, value});
    const output = element('output', String(value));
    output.setAttribute('aria-hidden', 'true');
    label.append(text, ' ', input, ' ', output);
    input.addEventListener('input', () => {
      const next = Number(input.value);
      output.value = String(next);
      change(next);
    });
    return {
      label,
      setValue(next, display = null) {
        input.value = String(next);
        output.value = display ?? String(next);
        if (display === null) input.removeAttribute('aria-valuetext');
        else input.setAttribute('aria-valuetext', display);
      },
    };
  };
  const toggle = (text, checked, change) => {
    const label = element('label');
    const input = element('input');
    Object.assign(input, {type: 'checkbox', checked});
    label.append(input, ' ', text);
    input.addEventListener('change', () => change(input.checked));
    return label;
  };
  const title = (text, detail) => {
    const heading = element('div', '', 'section-heading');
    heading.append(element('h2', text), element('p', detail, 'fm2610-section-note'));
    return heading;
  };

  const adpcmReadouts = createFm2610AdpcmReadouts(doc, selectSongAdpcmA);
  function changeAdpcmLive() {
    refreshSongAdpcmView();
    onAdpcmLiveChange();
  }
  const aLive = toggle('Live', true, changeAdpcmLive);
  const bLive = toggle('Live', true, changeAdpcmLive);
  const aLiveInput = aLive.querySelector('input');
  const bLiveInput = bLive.querySelector('input');
  aLive.className = bLive.className = 'fm-live-toggle';
  aLiveInput.id = 'adpcmALive';
  bLiveInput.id = 'adpcmBLive';
  aLive.title = bLive.title = 'Follow the ADPCM registers during VGM playback';
  let songSnapshot = null, readSongAdpcmA, readSongAdpcmB, visibleAdpcm, songPaused = false;
  let aPinnedVoice = null, aPreviewVoice = 0, aAuditionSnapshot = null;

  const voices = Array.from({length: 3}, () => ({tone: true, noise: false, level: 10, gate: false, request: 0}));
  let ssgChip;
  let noisePeriod = 16;
  let ssgEditChannel = null;

  function updateSsg(channel) {
    const voice = voices[channel];
    if (!ssgChip || !voice.gate) return;
    ssgChip.setMixer(channel, {tone: voice.tone, noise: voice.noise});
    // Turning both sources off silences the voice as well as disabling the gates.
    ssgChip.setVolume(channel, voice.tone || voice.noise ? voice.level : 0, false);
  }

  async function noteOnSSG(channel, midi) {
    const voice = voices[channel];
    const request = ++voice.request;
    const {ssg} = await sound();
    if (request !== voice.request) return;
    ssgChip = ssg;
    ssgChip.write(6, noisePeriod);
    ssgChip.setNote(channel, midi);
    voice.gate = true;
    // SSGSynth.keyOn always enables tone. Keep the user's noise-only setting.
    updateSsg(channel);
  }

  function noteOffSSG(channel) {
    const voice = voices[channel];
    voice.request++;
    if (voice.gate) ssgChip.keyOff(channel);
    voice.gate = false;
  }

  function editSsg(key, value) {
    voices.forEach((voice, channel) => {
      if (ssgEditChannel !== null && channel !== ssgEditChannel) return;
      voice[key] = value;
      updateSsg(channel);
    });
    showSSGChannel(ssgEditChannel);
  }

  const ssgControls = element('div', '', 'fm2610-section-grid');
  const ssgVoice = element('section', '', 'fm2610-voice');
  ssgVoice.setAttribute('aria-label', 'SSG voice settings');
  const ssgTone = toggle('Tone', voices[0].tone, value => editSsg('tone', value));
  const ssgNoise = toggle('Noise', voices[0].noise, value => editSsg('noise', value));
  const ssgLevel = slider('Level', 0, 15, 1, voices[0].level, value => editSsg('level', value));
  const ssgSwitches = [['tone', ssgTone.querySelector('input')], ['noise', ssgNoise.querySelector('input')]];

  function showSSGChannel(channel) {
    ssgEditChannel = channel;
    const voice = voices[channel ?? 0];
    const mixed = key => channel === null && voices.some(other => other[key] !== voice[key]);
    for (const [key, input] of ssgSwitches) {
      input.indeterminate = mixed(key);
      input.checked = !input.indeterminate && voice[key];
    }
    ssgLevel.setValue(voice.level, mixed('level') ? 'Mixed' : null);
  }

  ssgVoice.append(ssgTone, ssgNoise, ssgLevel.label);
  ssgControls.append(ssgVoice);
  ssgPanel.append(title('SSG · 3 voices', 'AUTO cycles through all three channels and applies edits to all of them.'),
    ssgControls, slider('Noise period (shared)', 1, 31, 1, noisePeriod, value => {
      noisePeriod = value;
      if (voices.some(voice => voice.gate)) ssgChip.write(6, noisePeriod);
    }).label);

  let aState;
  let aLevel = 56;
  const aRequests = new Uint32Array(DRUMS.length);
  const aPlayed = new Set();
  const aPads = DRUMS.map(() => ({sample: null, pending: null, render: null}));
  const decodeAudio = createOfflineAudioDecoder();

  async function playDrum(channel) {
    const request = ++aRequests[channel];
    const sample = aPads[channel].sample;
    try {
      const {adpcmA} = await sound();
      if (request !== aRequests[channel]) return;
      if (aState?.chip !== adpcmA) {
        aState = {chip: adpcmA, builtIn: null, customLoads: Array(DRUMS.length).fill(null)};
        aPlayed.clear();
      }
      const state = aState;
      let range;
      if (sample) {
        const start = A_CUSTOM_START + channel * A_SLOT_BYTES;
        range = {start, end: start + sample.bytes.length};
        let load = state.customLoads[channel];
        if (load?.sample !== sample) {
          // Writes to this ROM slot can affect an active voice reading it.
          // Leave the other five voices and the built-in ranges alone.
          adpcmA.keyOff(channel);
          aPlayed.delete(channel);
          load = {sample, ready: Promise.resolve(adpcmA.loadMemory(sample.bytes, start))};
          state.customLoads[channel] = load;
        }
        try {
          await load.ready;
        } catch (error) {
          if (state.customLoads[channel] === load) state.customLoads[channel] = null;
          throw error;
        }
      } else {
        if (!state.builtIn) {
          const {bytes, ranges} = drumBank(A_RATE);
          const ready = Promise.resolve().then(() => adpcmA.loadMemory(bytes, SAMPLE_ADDRESS)).catch(error => {
            state.builtIn = null;
            throw error;
          });
          state.builtIn = {ranges, ready};
        }
        range = state.builtIn.ranges[channel];
        await state.builtIn.ready;
      }
      if (state !== aState || request !== aRequests[channel]) return;
      adpcmA.setVolume(aLevel);
      adpcmA.setSample(channel, range);
      adpcmA.setVoice(channel, {volume: 27, left: true, right: true});
      adpcmA.keyOn(channel);
      aPlayed.add(channel);
    } catch (error) {
      if (request === aRequests[channel] && error?.name !== 'AbortError') throw error;
    }
  }

  function stopDrums(channels = A_VOICES) {
    for (const channel of channels) aRequests[channel]++;
    const played = channels.filter(channel => aPlayed.delete(channel));
    if (played.length) aState.chip.keyOff(played);
  }

  const drumPads = element('div', '', 'fm2610-section-grid');
  DRUMS.forEach((name, channel) => {
    const state = aPads[channel];
    const pad = element('section', '', 'fm2610-voice');
    const voice = `A${channel + 1}`;
    const shortcut = ADPCM_A_KEYS[channel].toUpperCase();
    const heading = element('h3', voice);
    heading.append(' ', element('kbd', shortcut, 'drum-shortcut'));
    const sampleName = element('p', '', 'fm2610-sample-name');
    sampleName.setAttribute('aria-live', 'polite');
    const picker = element('input');
    Object.assign(picker, {type: 'file', accept: 'audio/*,.wav,.flac,.m4a', hidden: true});
    const play = button('Play', () => playDrum(channel));
    play.setAttribute('aria-keyshortcuts', shortcut);
    const off = button('Stop', () => stopDrums([channel]));
    const select = button('Load sample…', () => picker.click());
    select.setAttribute('aria-label', `Load sample for ${voice}`);
    const reset = button('Reset sample', () => {
      state.pending?.abort();
      state.pending = null;
      aRequests[channel]++;
      state.sample = null;
      showSample();
    });
    reset.setAttribute('aria-label', `Reset ${voice} to ${name}`);
    function showSample() {
      const selected = state.sample?.name ?? name;
      sampleName.textContent = state.pending ? 'Preparing sample…' : selected;
      sampleName.title = selected;
      play.setAttribute('aria-label', state.sample ? `Play ${voice}: ${selected}` : name);
      off.setAttribute('aria-label', state.sample ? `Stop ${voice}` : `Stop ${name}`);
      reset.disabled = !state.pending && !state.sample;
    }
    picker.addEventListener('change', async () => {
      const file = picker.files[0];
      picker.value = '';
      if (!file) return;
      state.pending?.abort();
      const controller = new AbortController();
      const {signal} = controller;
      state.pending = controller;
      showSample();
      try {
        if (file.size > A_MAX_FILE_BYTES) throw new RangeError('Audio files must fit within 64 MiB.');
        const audio = await readSamplePCM(file, {signal, decodeAudio});
        const bytes = await encodeDrumSample(audio, signal);
        signal.throwIfAborted();
        aRequests[channel]++;
        state.sample = {name:file.name,bytes};
      } catch (error) {
        if (!signal.aborted) report(error.message);
      } finally {
        if (state.pending === controller) {
          state.pending = null;
          showSample();
        }
      }
    });
    state.render = showSample;
    showSample();
    const controls = element('div', '', 'fm2610-sample-controls');
    controls.append(play, off, select, reset);
    pad.append(heading, sampleName, controls, picker);
    drumPads.append(pad);
  });
  const aToolbar = element('div', '', 'fm2610-inline-controls');
  const aLevelControl = slider('ADPCM-A level', 0, 63, 1, aLevel, value => {
    aLevel = value;
    if (aPlayed.size) aState.chip.setVolume(value);
  });
  aToolbar.append(aLevelControl.label);
  if (saveAdpcmAKit) {
    const save = button('Save Kit…', () => saveAdpcmAKit(getAdpcmAKit()));
    save.title = 'Save the level and the last completed sample selection for each pad.';
    aToolbar.append(save);
  }
  aToolbar.append(button('Stop all drums', () => stopDrums()));
  const aHeader = title('ADPCM-A · 6 voices', 'Load one-shot samples up to about 113 seconds per voice. Playback is fixed at 8 MHz ÷ 432.');
  aHeader.append(aLive);
  const aEditor = element('div');
  aEditor.append(drumPads, aToolbar);
  adpcmAPanel.append(aHeader, aEditor, adpcmReadouts.aPanel);

  const aWaveform = element('canvas');
  Object.assign(aWaveform, {id: 'adpcmAWaveform', width: 900, height: 144});
  aWaveform.setAttribute('role', 'img');
  aWaveform.setAttribute('aria-label', 'Decoded ADPCM-A sample waveform');
  const aWave = createSongWaveView(aWaveform, getFm2610AdpcmAWaveform, report);
  const aPreviewInfo = element('p', '', 'fm2610-sample-name');
  aPreviewInfo.id = 'adpcmAPreviewInfo';
  const aAuto = button('AUTO', () => selectSongAdpcmA(null));
  aAuto.title = 'Follow the last ADPCM-A voice triggered by the VGM';
  const aPreviewPlay = button('Play sample', () => auditionSongAdpcmA(aPreviewVoice));
  aPreviewPlay.id = 'adpcmAAuditionPlay';
  const aPreviewStop = button('Stop audition', stopSongAdpcmA);
  aPreviewStop.id = 'adpcmAAuditionStop';
  const aPreviewToolbar = element('div', '', 'fm2610-inline-controls');
  aPreviewToolbar.append(aAuto, aPreviewPlay, aPreviewStop);
  adpcmReadouts.aPanel.append(aPreviewToolbar, aWaveform, aPreviewInfo);

  function selectSongAdpcmA(channel) {
    aPinnedVoice = channel;
    refreshSongAdpcmView();
  }

  function updateSongAdpcmA() {
    const state = songSnapshot.adpcm.adpcmA;
    const recent = state.voices.reduce((best, voice) => voice.lastTrigger > best.lastTrigger ? voice : best);
    aPreviewVoice = aPinnedVoice ?? (recent.lastTrigger ? recent.channel : state.voices.find(voice => voice.available)?.channel ?? 0);
    const voice = state.voices[aPreviewVoice];
    adpcmReadouts.updateA(state, aPreviewVoice);
    aAuto.setAttribute('aria-pressed', String(aPinnedVoice === null));
    aPreviewPlay.disabled = !aAuditionSnapshot || !voice.available;
    aPreviewStop.disabled = !aAuditionSnapshot;
    const length = 2 * (voice.playbackEnd - voice.start) / state.sampleRate;
    const details = voice.available ? `${length.toFixed(3)} s` : 'ROM data unavailable';
    const preview = `A${aPreviewVoice + 1} · ${details}` + (songPaused ? '' : ' · Pause VGM to audition');
    if (aPreviewInfo.textContent !== preview) aPreviewInfo.textContent = preview;
    const key = voice.available ? `${state.rom.revision}:${voice.start}:${voice.playbackEnd}` : null;
    void aWave.show(key, () => readSongAdpcmA(songSnapshot, aPreviewVoice));
  }

  function auditionSongAdpcmA(channel) {
    const snapshot = aAuditionSnapshot;
    if (!snapshot) return;
    const bytes = readSongAdpcmA(snapshot, channel);
    if (bytes) return playSongAdpcmA(snapshot, channel, bytes);
  }

  function playAdpcmAKey(channel) {
    if (!isFollowingAdpcm('adpcm-a')) return playDrum(channel);
    if (!aAuditionSnapshot) return;
    selectSongAdpcmA(channel);
    return auditionSongAdpcmA(channel);
  }

  function getAdpcmAKit() {
    return {
      level: aLevel,
      pads: aPads.map(({sample}) => sample && {name: sample.name, bytes: sample.bytes.slice()}),
    };
  }

  function applyAdpcmAKit(kit) {
    const {level, pads} = normalizeAdpcmAKit(kit);
    stopDrums();
    aState?.customLoads.fill(null);
    aLevel = level;
    aLevelControl.setValue(level);
    aPads.forEach((pad, channel) => {
      pad.pending?.abort();
      pad.pending = null;
      pad.sample = pads[channel];
    });
    for (const pad of aPads) pad.render();
  }

  const adpcmB = createFm2610AdpcmB({sound});
  const bDefault = adpcmB.getSettings();
  const bName = element('p', '', 'fm2610-sample-name');
  bName.setAttribute('aria-live', 'polite');
  const bWaveform = element('canvas');
  Object.assign(bWaveform, {id: 'adpcmBWaveform', width: 900, height: 144});
  bWaveform.setAttribute('role', 'img');
  bWaveform.setAttribute('aria-label', 'Decoded ADPCM-B sample waveform');
  const bDuration = element('p');
  bDuration.id = 'adpcmBSampleDuration';
  const bPicker = element('input');
  Object.assign(bPicker, {type: 'file', accept: '.wav,audio/wav,audio/x-wav', hidden: true, id: 'adpcmBWavInput'});
  let bPending;
  let bWaveRequest;
  let bEditorPeaks;
  const bWave = createSongWaveView(bWaveform, getFm2610AdpcmBWaveform, report);

  const bRoot = createParamControl({label: 'Root note', min: 0, max: 127, step: 1,
    value: bDefault.rootNote, formatValue: midiToNoteName, wheelAdjust: false,
    onChange: rootNote => adpcmB.setSettings({rootNote})});
  const bRate = slider('Base rate (Hz)', 1, FM2610_ADPCM_B_MAX_RATE, 1, bDefault.sampleRate,
    sampleRate => showAdpcmBDuration(adpcmB.setSettings({sampleRate})));
  const bVolume = slider('ADPCM-B level', 0, 255, 1, bDefault.volume,
    volume => adpcmB.setSettings({volume}));
  const bRepeat = toggle('Repeat', bDefault.repeat, repeat => adpcmB.setSettings({repeat}));
  const bSave = button('Save sample…', () => saveAdpcmBSample(adpcmB.getSample()));

  function showAdpcmBDuration({byteLength, sampleRate}) {
    bDuration.textContent = (2 * byteLength / sampleRate).toFixed(3) + ' s at base rate';
  }

  async function refreshAdpcmBWaveform() {
    bWaveRequest?.abort();
    const request = new AbortController();
    bWaveRequest = request;
    bEditorPeaks = undefined;
    if (!isFollowingAdpcm('adpcm-b')) drawAdpcmWaveform(bWaveform);
    try {
      const peaks = await adpcmB.getWaveform(request.signal);
      if (!request.signal.aborted) {
        bEditorPeaks = peaks;
        if (!isFollowingAdpcm('adpcm-b')) drawAdpcmWaveform(bWaveform, peaks);
      }
    } catch (error) {
      if (!request.signal.aborted) report(error);
    } finally {
      if (bWaveRequest === request) bWaveRequest = null;
    }
  }

  function renderAdpcmB() {
    const settings = adpcmB.getSettings();
    const {name, rootNote, sampleRate, volume, repeat} = settings;
    bRoot.updateVisual(rootNote);
    bRate.setValue(sampleRate);
    bVolume.setValue(volume);
    bRepeat.querySelector('input').checked = repeat;
    bSave.disabled = Boolean(bPending);
    if (!isFollowingAdpcm('adpcm-b')) {
      bName.textContent = bPending ? 'Preparing WAV…' : name;
      bName.title = name;
      showAdpcmBDuration(settings);
    }
  }

  function applyAdpcmBSample(sample) {
    bPending?.abort();
    bPending = null;
    releaseAdpcmBKeyboard();
    adpcmB.applySample(sample);
    renderAdpcmB();
    void refreshAdpcmBWaveform();
  }

  bPicker.addEventListener('change', async () => {
    const file = bPicker.files[0];
    bPicker.value = '';
    if (!file) return;
    bPending?.abort();
    const controller = new AbortController();
    bPending = controller;
    renderAdpcmB();
    try {
      await adpcmB.loadSample(file, {signal: controller.signal});
      releaseAdpcmBKeyboard();
      void refreshAdpcmBWaveform();
    } catch (error) {
      if (!controller.signal.aborted) report(error);
    } finally {
      if (bPending === controller) {
        bPending = null;
        renderAdpcmB();
      }
    }
  });
  const bToolbar = element('div', '', 'fm2610-inline-controls');
  bToolbar.append(button('Load WAV…', () => bPicker.click()), button('Play sample', () => {
    releaseAdpcmBKeyboard();
    return adpcmB.play();
  }), button('Stop sample', () => {
    releaseAdpcmBKeyboard();
    adpcmB.stop();
  }), button('Reset to pluck', () => applyAdpcmBSample(null)), bSave);
  const bParameters = element('div', '', 'fm2610-inline-controls');
  bParameters.append(bRoot.element, bRate.label, bVolume.label, bRepeat);
  const bHeader = title('ADPCM-B · 1 voice', 'Set the root note for keyboard playback. Repeat applies when the next note starts.');
  bHeader.append(bLive);
  adpcmBPanel.append(bHeader, bName, bToolbar, adpcmReadouts.bPanel, bWaveform, bDuration, bParameters, bPicker);
  renderAdpcmB();
  void refreshAdpcmBWaveform();

  function isFollowingAdpcm(source) {
    if (!songSnapshot?.adpcm) return false;
    if (source === 'adpcm-a') return aLiveInput.checked;
    return source === 'adpcm-b' && bLiveInput.checked;
  }

  function refreshSongAdpcmView() {
    const followA = isFollowingAdpcm('adpcm-a');
    const followB = isFollowingAdpcm('adpcm-b');
    const wasFollowingA = !adpcmReadouts.aPanel.hidden;
    const wasFollowingB = !adpcmReadouts.bPanel.hidden;
    if (followA !== wasFollowingA) {
      aEditor.hidden = followA;
      adpcmReadouts.aPanel.hidden = !followA;
    }
    const showingA = followA && visibleAdpcm === 'adpcm-a';
    const nextAuditionSnapshot = showingA && songPaused ? songSnapshot : null;
    if (aAuditionSnapshot && aAuditionSnapshot !== nextAuditionSnapshot) stopSongAdpcmA();
    aAuditionSnapshot = nextAuditionSnapshot;
    if (showingA) updateSongAdpcmA();
    else aWave.cancel();

    if (followB !== wasFollowingB) {
      adpcmReadouts.bPanel.hidden = !followB;
      bToolbar.hidden = bParameters.hidden = followB;
    }
    if (!followB && wasFollowingB) {
      bWave.cancel();
      renderAdpcmB();
      drawAdpcmWaveform(bWaveform, bEditorPeaks);
    }
    if (!followB || visibleAdpcm !== 'adpcm-b') {
      bWave.cancel();
      return;
    }

    const state = songSnapshot.adpcm.adpcmB;
    const name = 'VGM sample';
    if (bName.textContent !== name) {
      bName.textContent = name;
      bName.title = name;
    }
    const duration = state.available && state.sampleRate > 0
      ? (2 * (state.end - state.start) / state.sampleRate).toFixed(3) + ' s at playback rate' : '';
    if (bDuration.textContent !== duration) bDuration.textContent = duration;
    adpcmReadouts.updateB(state);
    const key = state.available ? `${state.rom.revision}:${state.start}:${state.end}` : null;
    void bWave.show(key, () => readSongAdpcmB(songSnapshot));
  }

  function setSongAdpcm(snapshot, {readAdpcmA, readAdpcmB, visible, paused}) {
    if (songSnapshot && !snapshot) {
      aWave.reset();
      bWave.reset();
    }
    songSnapshot = snapshot;
    readSongAdpcmA = readAdpcmA;
    readSongAdpcmB = readAdpcmB;
    visibleAdpcm = visible;
    songPaused = paused;
    refreshSongAdpcmView();
  }

  function showAdpcmEditor(source) {
    if (!isFollowingAdpcm(source)) return;
    (source === 'adpcm-a' ? aLiveInput : bLiveInput).checked = false;
    changeAdpcmLive();
  }

  function stopAdpcm({invalidateB = false} = {}) {
    stopDrums();
    if (invalidateB) adpcmB.invalidate();
    else adpcmB.stop();
  }

  return {
    noteOnSSG,
    noteOffSSG,
    showSSGChannel,
    playAdpcmAKey,
    canAuditionAdpcmA: () => Boolean(aAuditionSnapshot),
    applyAdpcmAKit,
    getAdpcmAKit,
    noteOnAdpcmB: adpcmB.noteOn,
    noteOffAdpcmB: adpcmB.noteOff,
    applyAdpcmBSample,
    getAdpcmBSample: adpcmB.getSample,
    setSongAdpcm,
    isFollowingAdpcm,
    showAdpcmEditor,
    stopAdpcm,
    stop(options) {
      voices.forEach((_, channel) => noteOffSSG(channel));
      stopAdpcm(options);
    },
  };
}
