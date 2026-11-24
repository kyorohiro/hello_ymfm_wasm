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
  let request, activeKey, nextBank = 0;
  const cache = new Map();
  const banks = new WeakMap();

  function cancel() {
    request?.abort();
    request = activeKey = undefined;
  }

  async function show(rom, start, end, readBytes) {
    if (rom && !banks.has(rom)) banks.set(rom, ++nextBank);
    const key = rom ? `${banks.get(rom)}:${start}:${end}` : null;
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
  saveAdpcmAKit, saveAdpcmBSample, onReferenceChange, stopSongSsg, playSongAdpcmA, stopSongAdpcmA,
  setSongAdpcmAVoice, setSongAdpcmALevel, playSongAdpcmB, stopSongAdpcmB, report = () => {},
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
    onReferenceChange();
  }
  const aLive = toggle('Live', true, changeAdpcmLive);
  const bLive = toggle('Live', true, changeAdpcmLive);
  const aLiveInput = aLive.querySelector('input');
  const bLiveInput = bLive.querySelector('input');
  aLive.className = bLive.className = 'fm-live-toggle';
  aLiveInput.id = 'adpcmALive';
  bLiveInput.id = 'adpcmBLive';
  aLive.title = bLive.title = 'Follow ADPCM registers written by VGM or Code';
  let songSnapshot = null, reference = null, visibleSource;
  const referenceName = () => reference?.kind === 'code' ? 'Code' : 'VGM';
  const auditionHint = () => reference?.kind === 'code' ? 'Stop Code to audition' : 'Pause VGM to audition';
  let aPinnedVoice = null, aPreviewVoice = 0, aAuditionSnapshot = null;
  let aTrialSnapshot = null, aTrialTotalLevel = null;
  const aTrialVoices = new Map();
  let bAuditionSnapshot = null, bAuditionKey = null, bReferenceNote = 60;

  const voices = Array.from({length: 3}, () => ({tone: true, noise: false, level: 10, gate: false, request: 0}));
  let ssgChip;
  let noisePeriod = 16;
  let ssgEditChannel = null;
  let ssgAuditionSnapshot = null;
  let displayedSsg, displayedSsgStatus;

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
  const ssgNoisePeriod = slider('Noise period (shared)', 1, 31, 1, noisePeriod, value => {
    noisePeriod = value;
    if (voices.some(voice => voice.gate)) ssgChip.write(6, noisePeriod);
  });
  const ssgLive = toggle('Live', true, () => {
    refreshSsgReference();
    onReferenceChange();
  });
  const ssgLiveInput = ssgLive.querySelector('input');
  ssgLiveInput.id = 'ssgLive';
  ssgLive.className = 'fm-live-toggle';
  ssgLive.title = 'Follow SSG registers written by VGM or Code';
  const ssgStatus = element('p', '', 'fm2610-sample-name');
  ssgStatus.id = 'ssgChannelState';
  const ssgNoiseRange = ssgNoisePeriod.label.querySelector('input');
  const ssgParameters = [...ssgSwitches.map(([, input]) => input), ssgLevel.label.querySelector('input'), ssgNoiseRange];

  function showSSGChannel(channel) {
    ssgEditChannel = channel;
    const state = isFollowingSsg() ? songSnapshot.ssg : null;
    const channels = state?.channels ?? voices;
    const voice = channels[channel ?? 0];
    const mixed = key => channel === null && channels.some(other => other[key] !== voice[key]);
    for (const [key, input] of ssgSwitches) {
      input.indeterminate = mixed(key);
      input.checked = !input.indeterminate && voice[key];
    }
    ssgLevel.setValue(voice.level, mixed('level') ? 'Mixed' : null);
    ssgNoiseRange.min = state ? 0 : 1;
    ssgNoisePeriod.setValue(state?.noisePeriod ?? noisePeriod);
    for (const input of ssgParameters) input.disabled = Boolean(state);
    ssgStatus.hidden = !state;
    if (state) {
      const periods = channel === null ? channels.map(voice => voice.period).join(' / ') : voice.period;
      const parts = [referenceName(), reference.retained && 'Stopped state', `Tone period ${periods}`];
      if (channel === null ? channels.some(voice => voice.envelope) : voice.envelope) {
        parts.push(`Envelope ${state.envelopePeriod} · Shape ${state.envelopeShape}`);
      }
      ssgStatus.textContent = parts.filter(Boolean).join(' · ');
    }
  }

  function isFollowingSsg() {
    return ssgLiveInput.checked && Boolean(songSnapshot?.ssg);
  }

  function refreshSsgReference() {
    const state = isFollowingSsg() ? songSnapshot.ssg : null;
    const visible = visibleSource === 'ssg';
    const nextSnapshot = state && reference.frozen && visible ? songSnapshot : null;
    const changed = ssgAuditionSnapshot && ssgAuditionSnapshot !== nextSnapshot;
    ssgAuditionSnapshot = nextSnapshot;
    if (changed) stopSongSsg();
    if (!visible) return;
    const status = state ? `${reference.kind}:${reference.retained}` : '';
    if (state === displayedSsg && status === displayedSsgStatus) return;
    displayedSsg = state;
    displayedSsgStatus = status;
    showSSGChannel(ssgEditChannel);
  }

  ssgVoice.append(ssgTone, ssgNoise, ssgLevel.label);
  ssgControls.append(ssgVoice);
  const ssgHeader = title('SSG · 3 voices', 'AUTO cycles through all three channels and applies edits to all of them.');
  ssgHeader.append(ssgLive);
  ssgStatus.hidden = true;
  ssgPanel.append(ssgHeader, ssgControls, ssgNoisePeriod.label, ssgStatus);

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
  aAuto.title = 'Follow the last ADPCM-A voice triggered';
  const aPreviewPlay = button('Play sample', () => auditionSongAdpcmA(aPreviewVoice));
  aPreviewPlay.id = 'adpcmAAuditionPlay';
  const aPreviewStop = button('Stop audition', stopSongAdpcmA);
  aPreviewStop.id = 'adpcmAAuditionStop';
  const aPreviewToolbar = element('div', '', 'fm2610-inline-controls');
  aPreviewToolbar.append(aAuto, aPreviewPlay, aPreviewStop);
  const aTrialToolbar = element('div', '', 'fm2610-inline-controls fm2610-adpcm-trial');
  aTrialToolbar.hidden = true;
  aTrialToolbar.setAttribute('role', 'group');
  aTrialToolbar.setAttribute('aria-label', 'ADPCM-A audition settings');
  const aTrialLevel = slider('Voice level', 0, 31, 1, 0, volume => editAuditionA({volume}));
  const panLeft = toggle('Pan left', false, left => editAuditionA({left}));
  const panRight = toggle('Pan right', false, right => editAuditionA({right}));
  const aTotal = slider('Total level (all voices)', 0, 63, 1, 0, value => {
    aTrialTotalLevel = value;
    setSongAdpcmALevel(value);
  });
  const aStart = auditionAddress('ROM start (hex)', 'startText');
  const aEnd = auditionAddress('ROM end (hex, exclusive)', 'endText');
  const aRestore = button('Restore VGM settings', restoreAuditionA);
  aTrialToolbar.append(aTrialLevel.label, panLeft, panRight, aTotal.label, aStart.label, aEnd.label, aRestore);
  adpcmReadouts.aPanel.append(aPreviewToolbar, aWaveform, aPreviewInfo, aTrialToolbar);

  function auditionAddress(name, key) {
    const label = element('label');
    const input = element('input');
    Object.assign(input, {type: 'text', size: 10, maxLength: 9, spellcheck: false});
    input.autocomplete = 'off';
    input.title = 'The ROM range is applied on the next Play sample.';
    input.addEventListener('change', () => {
      editAuditionA({[key]: input.value.trim()});
      updateSongAdpcmA();
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') input.blur(); });
    label.append(name, ' ', input);
    return {label, input};
  }

  const aHex = address => '0x' + address.toString(16).toUpperCase().padStart(6, '0');
  const aParseHex = value => /^(?:0x)?[0-9a-f]{1,7}$/i.test(value) ? Number.parseInt(value, 16) : NaN;

  function auditionASettings(channel) {
    const voice = aAuditionSnapshot.adpcm.adpcmA.voices[channel];
    const {volume, left, right, start, playbackEnd} = voice;
    return aTrialVoices.get(channel) ?? {volume, left, right, startText: aHex(start), endText: aHex(playbackEnd)};
  }

  function editAuditionA(changes) {
    if (!aAuditionSnapshot) return;
    const settings = {...auditionASettings(aPreviewVoice), ...changes};
    aTrialVoices.set(aPreviewVoice, settings);
    const {volume, left, right} = settings;
    if ('volume' in changes || 'left' in changes || 'right' in changes) {
      setSongAdpcmAVoice(aPreviewVoice, {volume, left, right});
    }
  }

  function restoreAuditionA() {
    if (!aAuditionSnapshot) return;
    const {volume, voices} = aAuditionSnapshot.adpcm.adpcmA;
    aTrialVoices.clear();
    aTrialTotalLevel = null;
    setSongAdpcmALevel(volume);
    for (const {channel, volume: voiceLevel, left, right} of voices) {
      setSongAdpcmAVoice(channel, {volume: voiceLevel, left, right});
    }
    updateSongAdpcmA();
  }

  function auditionAWindow(voice) {
    const draft = aTrialVoices.get(voice.channel);
    if (!draft) return {window: voice};
    const start = aParseHex(draft.startText), end = aParseHex(draft.endText);
    if (start === voice.start && end === voice.playbackEnd) return {window: voice};
    try {
      const query = {start, end};
      return {window: reference.reader.getAdpcmAWindow(aAuditionSnapshot, voice.channel, query), query};
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return {error: 'Use 256-byte-aligned ROM addresses.'};
    }
  }

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
    const {window, query, error} = auditionAWindow(voice);
    aPreviewPlay.disabled = !aAuditionSnapshot || !window?.available;
    aPreviewStop.disabled = !aAuditionSnapshot;
    aTrialToolbar.hidden = !aAuditionSnapshot;
    if (aAuditionSnapshot) {
      aRestore.textContent = `Restore ${referenceName()} settings`;
      const draft = auditionASettings(aPreviewVoice);
      aTrialLevel.setValue(draft.volume);
      aTotal.setValue(aTrialTotalLevel ?? state.volume);
      panLeft.querySelector('input').checked = draft.left;
      panRight.querySelector('input').checked = draft.right;
      aStart.input.value = draft.startText;
      aEnd.input.value = draft.endText;
    }
    const details = window?.available ? `${(2 * (window.playbackEnd - window.start) / state.sampleRate).toFixed(3)} s` :
      error ?? (window?.rangeValid === false ? 'Invalid ROM range' : 'ROM data unavailable');
    const status = reference.retained ? `${referenceName()} stopped` : reference.frozen ? '' : auditionHint();
    const preview = [`A${aPreviewVoice + 1}`, details, status].filter(Boolean).join(' · ');
    if (aPreviewInfo.textContent !== preview) aPreviewInfo.textContent = preview;
    void aWave.show(window?.available ? state.rom : null, window?.start, window?.playbackEnd,
      () => reference.reader.readAdpcmABytes(songSnapshot, aPreviewVoice, query));
  }

  function auditionSongAdpcmA(channel) {
    const snapshot = aAuditionSnapshot;
    if (!snapshot) return;
    const state = snapshot.adpcm.adpcmA;
    const {window, query} = auditionAWindow(state.voices[channel]);
    if (!window?.available) return;
    const bytes = reference.reader.readAdpcmABytes(snapshot, channel, query);
    if (!bytes) return;
    return playSongAdpcmA(snapshot, channel, bytes, () => {
      const {volume, left, right} = auditionASettings(channel);
      return {start: window.start, end: window.playbackEnd, volume, left, right, totalVolume: aTrialTotalLevel ?? state.volume};
    });
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
  const bPreviewPlay = button('Play sample', () => {
    releaseAdpcmBKeyboard();
    return auditionSongAdpcmB();
  });
  bPreviewPlay.id = 'adpcmBAuditionPlay';
  const bPreviewStop = button('Stop audition', endSongAdpcmB);
  bPreviewStop.id = 'adpcmBAuditionStop';
  const bReference = createParamControl({label: 'Reference note', min: 0, max: 127, step: 1,
    value: bReferenceNote, formatValue: midiToNoteName, wheelAdjust: false,
    onChange: midi => { bReferenceNote = midi; }});
  const bPreviewToolbar = element('div', '', 'fm2610-inline-controls');
  bPreviewToolbar.hidden = true;
  bPreviewToolbar.append(bPreviewPlay, bPreviewStop, bReference.element);
  const bParameters = element('div', '', 'fm2610-inline-controls');
  bParameters.append(bRoot.element, bRate.label, bVolume.label, bRepeat);
  const bHeader = title('ADPCM-B · 1 voice', 'Set the root note for keyboard playback. Repeat applies when the next note starts.');
  bHeader.append(bLive);
  adpcmBPanel.append(bHeader, bName, bToolbar, adpcmReadouts.bPanel, bWaveform, bDuration, bPreviewToolbar, bParameters, bPicker);
  renderAdpcmB();
  void refreshAdpcmBWaveform();

  function isFollowingAdpcm(source) {
    if (!songSnapshot?.adpcm) return false;
    if (source === 'adpcm-a') return aLiveInput.checked && songSnapshot.adpcmSources?.a !== false;
    return source === 'adpcm-b' && bLiveInput.checked && songSnapshot.adpcmSources?.b !== false;
  }

  function canAuditionAdpcmB() {
    const sample = bAuditionSnapshot?.adpcm.adpcmB;
    return Boolean(sample?.available && sample.deltaN > 0);
  }

  function auditionSongAdpcmB(midi = bReferenceNote) {
    if (!canAuditionAdpcmB()) return false;
    const snapshot = bAuditionSnapshot;
    const bytes = reference.reader.readAdpcmBBytes(snapshot);
    if (!bytes) return false;
    const rate = snapshot.adpcm.adpcmB.deltaN * 2 ** ((midi - bReferenceNote) / 12);
    const deltaN = Math.max(1, Math.min(65535, Math.round(rate)));
    return playSongAdpcmB(snapshot, bytes, {deltaN});
  }

  function noteOnSongAdpcmB(midi, owner) {
    bAuditionKey = owner;
    return auditionSongAdpcmB(midi);
  }

  function noteOffSongAdpcmB(owner) {
    if (bAuditionKey !== owner) return;
    bAuditionKey = null;
    stopSongAdpcmB();
  }

  function endSongAdpcmB() {
    bAuditionKey = null;
    releaseAdpcmBKeyboard();
    stopSongAdpcmB();
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
    const showingA = followA && visibleSource === 'adpcm-a';
    const nextAuditionSnapshot = showingA && reference.frozen ? songSnapshot : null;
    if (aAuditionSnapshot && aAuditionSnapshot !== nextAuditionSnapshot) stopSongAdpcmA();
    aAuditionSnapshot = nextAuditionSnapshot;
    const nextTrialSnapshot = followA && reference.frozen ? songSnapshot : null;
    if (nextTrialSnapshot !== aTrialSnapshot) {
      aTrialVoices.clear();
      aTrialTotalLevel = null;
      aTrialSnapshot = nextTrialSnapshot;
    }
    if (showingA) updateSongAdpcmA();
    else aWave.cancel();

    if (followB !== wasFollowingB) {
      adpcmReadouts.bPanel.hidden = !followB;
      bPreviewToolbar.hidden = !followB;
      bToolbar.hidden = bParameters.hidden = followB;
    }
    if (!followB && wasFollowingB) {
      bWave.cancel();
      renderAdpcmB();
      drawAdpcmWaveform(bWaveform, bEditorPeaks);
    }
    const showingB = followB && visibleSource === 'adpcm-b';
    const nextBAudition = showingB && reference.frozen ? songSnapshot : null;
    const endingBAudition = bAuditionSnapshot && bAuditionSnapshot !== nextBAudition;
    bAuditionSnapshot = nextBAudition;
    if (endingBAudition) endSongAdpcmB();
    if (!showingB) {
      bWave.cancel();
      return;
    }

    const state = songSnapshot.adpcm.adpcmB;
    bPreviewPlay.disabled = !canAuditionAdpcmB();
    bPreviewPlay.title = !reference.frozen ? auditionHint() :
      !state.available ? 'ROM data unavailable' : state.deltaN === 0 ? 'Playback rate is zero' : '';
    bPreviewStop.disabled = !bAuditionSnapshot;
    const name = `${referenceName()} sample${reference.retained ? ' · Stopped' : ''}`;
    if (bName.textContent !== name) {
      bName.textContent = name;
      bName.title = name;
    }
    const duration = state.available && state.sampleRate > 0
      ? (2 * (state.end - state.start) / state.sampleRate).toFixed(3) + ' s at playback rate' : '';
    if (bDuration.textContent !== duration) bDuration.textContent = duration;
    adpcmReadouts.updateB(state);
    void bWave.show(state.available ? state.rom : null, state.start, state.end,
      () => reference.reader.readAdpcmBBytes(songSnapshot));
  }

  function setPerformanceReference(next, visible) {
    if (reference?.kind !== next?.kind) {
      aWave.reset();
      bWave.reset();
    }
    reference = next;
    songSnapshot = next?.snapshot ?? null;
    visibleSource = visible;
    refreshSsgReference();
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
    isFollowingSsg,
    getSsgAuditionSnapshot: () => ssgAuditionSnapshot,
    playAdpcmAKey,
    canAuditionAdpcmA: () => Boolean(aAuditionSnapshot),
    applyAdpcmAKit,
    getAdpcmAKit,
    noteOnAdpcmB: adpcmB.noteOn,
    noteOffAdpcmB: adpcmB.noteOff,
    applyAdpcmBSample,
    getAdpcmBSample: adpcmB.getSample,
    canAuditionAdpcmB, noteOnSongAdpcmB, noteOffSongAdpcmB,
    setPerformanceReference,
    isFollowingAdpcm,
    showAdpcmEditor,
    stopAdpcm,
    stop(options) {
      voices.forEach((_, channel) => noteOffSSG(channel));
      stopAdpcm(options);
    },
  };
}
