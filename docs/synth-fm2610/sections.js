// SPDX-License-Identifier: BSD-3-Clause
import {encodeAdpcmA} from '../js/adpcm_a_sample.js';
import {readSamplePCM} from '../js/adpcm_b_sample.js';
import {createOfflineAudioDecoder} from '../js/audio_decode.js';
import {createParamControl} from '../synth/synth_controls.js';
import {midiToNoteName} from '../synth/synth_keyboard.js';
import {ADPCM_A_KIT_MAX_SAMPLE_BYTES, normalizeAdpcmAKit} from './adpcm_a_kit.js';
import {createAdpcmRangeView} from './adpcm_range_view.js';
import {
  createFm2610AdpcmB, FM2610_ADPCM_B_MAX_RATE, getFm2610AdpcmBRateLimits, getFm2610AdpcmBWaveform,
} from './adpcm_b.js';
import {getFm2610AdpcmAWaveform} from './song_adpcm_a_waveform.js';
import {createFm2610AdpcmReadouts} from './song_adpcm_view.js';
import {createDefaultSsgPreset, readSsgPreset} from './ssg_preset.js';

const MASTER_CLOCK = 8_000_000;
const SAMPLE_ADDRESS = 0x10000;
const A_RATE = MASTER_CLOCK / 432;
const A_CUSTOM_START = 0x800000;
const A_SLOT_BYTES = 0x100000;
const A_MAX_FILE_BYTES = 64 * 1024 * 1024;
const DRUMS = ['Kick', 'Snare', 'Closed hat', 'Tom', 'Block', 'Shaker'];
const A_VOICES = DRUMS.map((_, index) => index);
const A_DEFAULT_VOICE = Object.freeze({volume: 27, left: true, right: true});
const ADPCM_ADDRESS_STEP = 256;
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
  ssgPanel, adpcmAPanel, adpcmBPanel, sound, getMode, releaseAdpcmAKeyboard, releaseAdpcmBKeyboard,
  saveSsgPreset, saveAdpcmAKit, saveAdpcmBSample, onInstrumentEdited = () => {}, onInstrumentAdopted = () => {}, report = () => {},
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
  let songSnapshot = null, reference = null, visibleSource;
  const referenceName = () => reference?.kind === 'code' ? 'Code' : 'VGM';
  let aPinnedVoice = null, aPreviewVoice = 0, aLastTrigger = 0, aKitSource = '';
  const aAppliedSnapshots = new WeakSet();
  const bAppliedSnapshots = new WeakMap();

  const defaultSsg = createDefaultSsgPreset();
  const voices = defaultSsg.channels.map(voice => ({...voice, gate: false, request: 0}));
  let ssgChip;
  let {noisePeriod, envelopePeriod, envelopeShape} = defaultSsg;
  let ssgEditChannel = null;
  const ssgAppliedSnapshots = new WeakSet();
  let displayedSsg, displayedSsgKind;

  const hasSsgGate = () => voices.some(voice => voice.gate);
  const hasSsgEnvelope = () => voices.some(voice => voice.gate && voice.envelope && (voice.tone || voice.noise));

  function updateSsg(channel) {
    const voice = voices[channel];
    if (!ssgChip || !voice.gate) return;
    ssgChip.setMixer(channel, {tone: voice.tone, noise: voice.noise});
    const enabled = voice.tone || voice.noise;
    ssgChip.setVolume(channel, enabled ? voice.level : 0, enabled && voice.envelope);
  }

  async function noteOnSSG(channel, midi) {
    const voice = voices[channel];
    const request = ++voice.request;
    const {ssg} = await sound();
    if (request !== voice.request) return;
    const envelopeRunning = ssgChip === ssg && hasSsgEnvelope();
    ssgChip = ssg;
    ssgChip.write(6, noisePeriod);
    voice.period = ssgChip.setNote(channel, midi);
    voice.gate = true;
    if (hasSsgEnvelope() && !envelopeRunning) ssgChip.setEnvelope({period: envelopePeriod, shape: envelopeShape});
    updateSsg(channel);
    showSSGChannel(ssgEditChannel);
  }

  function noteOffSSG(channel) {
    const voice = voices[channel];
    voice.request++;
    if (voice.gate) ssgChip.keyOff(channel);
    voice.gate = false;
  }

  function editSsg(key, value) {
    const channels = ssgEditChannel === null ? voices.map((_, channel) => channel) : [ssgEditChannel];
    const envelopeRunning = hasSsgEnvelope();
    for (const channel of channels) voices[channel][key] = value;
    if (hasSsgEnvelope() && !envelopeRunning) ssgChip.setEnvelope({period: envelopePeriod, shape: envelopeShape});
    for (const channel of channels) {
      if (key === 'period' && voices[channel].gate) ssgChip.setTonePeriod(channel, value);
      else if (key !== 'period') updateSsg(channel);
    }
    onInstrumentEdited('ssg');
    showSSGChannel(ssgEditChannel);
  }

  const ssgControls = element('div', '', 'fm2610-section-grid');
  const ssgVoice = element('section', '', 'fm2610-voice');
  ssgVoice.setAttribute('aria-label', 'SSG voice settings');
  const ssgTone = toggle('Tone', voices[0].tone, value => editSsg('tone', value));
  const ssgNoise = toggle('Noise', voices[0].noise, value => editSsg('noise', value));
  const ssgEnvelope = toggle('Envelope', voices[0].envelope, value => editSsg('envelope', value));
  const ssgLevel = slider('Level', 0, 15, 1, voices[0].level, value => editSsg('level', value));
  const ssgTonePeriod = slider('Tone period', 0, 4095, 1, voices[0].period, value => editSsg('period', value));
  const ssgSwitches = [['tone', ssgTone], ['noise', ssgNoise], ['envelope', ssgEnvelope]]
    .map(([key, label]) => [key, label.querySelector('input')]);
  const ssgNoisePeriod = slider('Noise period (shared)', 0, 31, 1, noisePeriod, value => {
    noisePeriod = value;
    if (hasSsgGate()) ssgChip.write(6, noisePeriod);
    onInstrumentEdited('ssg');
  });
  const ssgEnvelopePeriod = slider('Envelope period (shared)', 0, 65535, 1, envelopePeriod, value => {
    envelopePeriod = value;
    if (hasSsgEnvelope()) ssgChip.setEnvelope({period: envelopePeriod});
    onInstrumentEdited('ssg');
  });
  const ssgEnvelopeShape = slider('Envelope shape (shared)', 0, 15, 1, envelopeShape, value => {
    envelopeShape = value;
    if (hasSsgEnvelope()) ssgChip.setEnvelope({shape: envelopeShape});
    onInstrumentEdited('ssg');
  });
  const ssgSave = saveSsgPreset ? button('Save preset…', () => saveSsgPreset(getSsgPreset())) : null;
  if (ssgSave) ssgSave.id = 'ssgSavePreset';
  const ssgStatus = element('p', '', 'fm2610-sample-name');
  ssgStatus.id = 'ssgChannelState';
  const ssgParameters = [
    ...ssgSwitches.map(([, input]) => input),
    ...[ssgLevel, ssgTonePeriod, ssgNoisePeriod, ssgEnvelopePeriod, ssgEnvelopeShape]
      .map(control => control.label.querySelector('input')),
  ];

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
    ssgTonePeriod.setValue(voice.period, mixed('period') ? 'Mixed' : null);
    ssgNoisePeriod.setValue(state?.noisePeriod ?? noisePeriod);
    ssgEnvelopePeriod.setValue(state?.envelopePeriod ?? envelopePeriod);
    ssgEnvelopeShape.setValue(state?.envelopeShape ?? envelopeShape);
    for (const input of ssgParameters) input.disabled = Boolean(state);
    if (ssgSave) ssgSave.disabled = Boolean(state);
    ssgStatus.textContent = state ? (reference.kind === 'code' ? 'Code · Running' : 'VGM · Playing') : 'Edit';
  }

  function isFollowingSsg() {
    return Boolean(songSnapshot?.ssg && !reference.frozen);
  }

  function adoptSsg(state) {
    ({noisePeriod, envelopePeriod, envelopeShape} = state);
    state.channels.forEach(({tone, noise, level, envelope, period}, channel) => {
      Object.assign(voices[channel], {tone, noise, level, envelope, period});
    });
    if (!hasSsgGate()) return;
    ssgChip.write(6, noisePeriod);
    if (hasSsgEnvelope()) ssgChip.setEnvelope({period: envelopePeriod, shape: envelopeShape});
    voices.forEach((voice, channel) => {
      if (voice.gate) ssgChip.setTonePeriod(channel, voice.period);
      updateSsg(channel);
    });
  }

  function getSsgPreset() {
    if (isFollowingSsg()) throw new Error(`${reference.kind === 'code' ? 'Stop Code' : 'Pause VGM'} to save the SSG preset.`);
    return readSsgPreset({...defaultSsg, channels: voices, noisePeriod, envelopePeriod, envelopeShape});
  }

  function applySsgPreset(preset) {
    if (isFollowingSsg()) throw new Error(`${reference.kind === 'code' ? 'Stop Code' : 'Pause VGM'} to open the SSG preset.`);
    adoptSsg(readSsgPreset(preset));
    showSSGChannel(ssgEditChannel);
  }

  function refreshSsgReference() {
    const captured = songSnapshot?.ssg;
    const adopt = captured && reference.frozen && !ssgAppliedSnapshots.has(songSnapshot);
    if (adopt) {
      ssgAppliedSnapshots.add(songSnapshot);
      onInstrumentAdopted('ssg');
      adoptSsg(captured);
    }
    if (visibleSource !== 'ssg' && !adopt) return;
    const state = isFollowingSsg() ? captured : null;
    const kind = state ? reference.kind : null;
    if (!adopt && state === displayedSsg && kind === displayedSsgKind) return;
    displayedSsg = state;
    displayedSsgKind = kind;
    showSSGChannel(ssgEditChannel);
  }

  ssgVoice.append(ssgTone, ssgNoise, ssgEnvelope, ssgLevel.label, ssgTonePeriod.label);
  ssgControls.append(ssgVoice);
  const ssgShared = element('div', '', 'fm2610-inline-controls');
  ssgShared.append(ssgNoisePeriod.label, ssgEnvelopePeriod.label, ssgEnvelopeShape.label);
  if (ssgSave) ssgShared.append(ssgSave);
  ssgPanel.append(title('SSG · 3 voices', 'AUTO rotates notes across three channels and applies each edit to all three. Noise and envelope settings are shared.'),
    ssgControls, ssgShared, ssgStatus);
  showSSGChannel(ssgEditChannel);

  let aState;
  let aLevel = 56;
  let aBuiltIn;
  const aRequests = new Uint32Array(DRUMS.length);
  const aPlayed = new Set();
  const aKeyboardOwners = Array(DRUMS.length).fill(null);
  const aPads = DRUMS.map(() =>
    ({sample: null, range: null, voice: A_DEFAULT_VOICE, missingRom: false, pending: null, render: null}));
  const decodeAudio = createOfflineAudioDecoder();

  function padWindow(channel) {
    const pad = aPads[channel];
    const {sample} = pad;
    if (sample?.bank) {
      const {start, end} = pad.range;
      const span = sample.bank.coveredRange(start, end);
      return {start, end, span, rom: sample.bank, read: (from = start, to = end) => sample.bank.read(from, to)};
    }
    if (sample) {
      const address = sample.address ?? A_CUSTOM_START + channel * A_SLOT_BYTES;
      const span = {start: address, end: address + sample.bytes.length};
      const {start, end} = pad.range ?? span;
      return {start, end, span, rom: sample,
        read: (from = start, to = end) => sample.bytes.slice(from - address, to - address)};
    }
    aBuiltIn ??= drumBank(A_RATE);
    const span = aBuiltIn.ranges[channel];
    const {start, end} = pad.range ?? span;
    return {start, end, span, rom: aBuiltIn,
      read: (from = start, to = end) => aBuiltIn.bytes.slice(from - SAMPLE_ADDRESS, to - SAMPLE_ADDRESS)};
  }

  async function playDrum(channel, owner = null) {
    if (isFollowingAdpcm('adpcm-a')) return;
    const window = padWindow(channel);
    if (!window.span || window.end <= window.start) return;
    aKeyboardOwners[channel] = owner;
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
        const address = sample.address ?? start;
        const bytes = sample.bank ? window.read : () => sample.bytes;
        const first = sample.bank ? window.start : address;
        const last = sample.bank ? window.end : address + sample.bytes.length;
        range = {start: start + window.start - first, end: start + window.end - first};
        let load = state.customLoads[channel];
        if (load?.sample !== sample || load.first !== first || load.last !== last) {
          // Writes to this ROM slot can affect an active voice reading it.
          // Leave the other five voices and the built-in ranges alone.
          adpcmA.keyOff(channel);
          aPlayed.delete(channel);
          load = {sample, first, last, ready: Promise.resolve(adpcmA.loadMemory(bytes(), start))};
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
          state.builtIn = Promise.resolve().then(() => adpcmA.loadMemory(aBuiltIn.bytes, SAMPLE_ADDRESS)).catch(error => {
            state.builtIn = null;
            throw error;
          });
        }
        range = {start: window.start, end: window.end};
        await state.builtIn;
      }
      if (state !== aState || request !== aRequests[channel]) return;
      adpcmA.setVolume(aLevel);
      adpcmA.setSample(channel, range);
      adpcmA.setVoice(channel, aPads[channel].voice);
      adpcmA.keyOn(channel);
      aPlayed.add(channel);
    } catch (error) {
      if (request === aRequests[channel] && error?.name !== 'AbortError') throw error;
    }
  }

  function stopDrums(channels = A_VOICES) {
    for (const channel of channels) {
      aKeyboardOwners[channel] = null;
      aRequests[channel]++;
    }
    const played = channels.filter(channel => aPlayed.delete(channel));
    if (played.length) aState.chip.keyOff(played);
  }

  const drumPads = element('div', '', 'fm2610-section-grid');
  DRUMS.forEach((name, channel) => {
    const state = aPads[channel];
    const pad = element('section', '', 'fm2610-voice');
    const voice = `A${channel + 1}`;
    const shortcut = ADPCM_A_KEYS[channel].toUpperCase();
    const heading = element('h3');
    const choose = button(voice, () => selectSongAdpcmA(channel));
    state.select = choose;
    heading.append(choose, ' ', element('kbd', shortcut, 'drum-shortcut'));
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
      stopDrums([channel]);
      state.sample = null;
      state.range = null;
      state.voice = A_DEFAULT_VOICE;
      state.missingRom = false;
      showSample();
      updateWorkingAdpcmA();
      onInstrumentEdited('adpcm-a');
    });
    reset.setAttribute('aria-label', `Reset ${voice} to ${name}`);
    function showSample() {
      const selected = state.sample?.name ?? name;
      sampleName.textContent = state.pending ? 'Preparing sample…' :
        state.missingRom ? selected + ' · Captured ROM unavailable' : selected;
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
        stopDrums([channel]);
        state.sample = {name:file.name,bytes};
        state.range = null;
        state.voice = A_DEFAULT_VOICE;
        state.missingRom = false;
        selectSongAdpcmA(channel);
        onInstrumentEdited('adpcm-a');
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
    onInstrumentEdited('adpcm-a');
  });
  aToolbar.append(aLevelControl.label);
  if (saveAdpcmAKit) {
    const save = button('Save Kit…', () => saveAdpcmAKit(getAdpcmAKit()));
    save.title = 'Save the level and the last completed sample selection for each pad.';
    aToolbar.append(save);
  }
  aToolbar.append(button('Stop all drums', () => stopDrums()));
  const aHeader = title('ADPCM-A · 6 voices', 'Load one-shot samples up to about 113 seconds per voice. Playback is fixed at 8 MHz ÷ 432.');
  const aSource = element('p', '', 'fm2610-sample-name');
  aSource.id = 'adpcmASource';
  const aEditor = element('div');
  aEditor.append(drumPads, aToolbar);
  adpcmAPanel.append(aHeader, aSource, aEditor, adpcmReadouts.aPanel);

  const aWaveform = element('canvas');
  Object.assign(aWaveform, {id: 'adpcmAWaveform', width: 900, height: 144});
  aWaveform.setAttribute('role', 'img');
  aWaveform.setAttribute('aria-label', 'Decoded ADPCM-A sample waveform');
  const aRangeView = createAdpcmRangeView(aWaveform, 'adpcmA', editAdpcmARange);
  const aWave = createSongWaveView(aWaveform, getFm2610AdpcmAWaveform, report);
  const aPreviewInfo = element('p', '', 'fm2610-sample-name');
  aPreviewInfo.id = 'adpcmAPreviewInfo';
  const aAuto = button('AUTO', () => selectSongAdpcmA(null));
  aAuto.title = 'Select the last pad triggered by playback';
  const aPreviewPlay = button('Play sample', () => playDrum(aPreviewVoice));
  aPreviewPlay.id = 'adpcmAAuditionPlay';
  const aPreviewStop = button('Stop sample', () => stopDrums([aPreviewVoice]));
  aPreviewStop.id = 'adpcmAAuditionStop';
  const aPreviewToolbar = element('div', '', 'fm2610-inline-controls');
  aPreviewToolbar.append(aAuto, aPreviewPlay, aPreviewStop);
  const aSampleControls = element('div', '', 'fm2610-inline-controls fm2610-adpcm-range');
  aSampleControls.setAttribute('role', 'group');
  aSampleControls.setAttribute('aria-label', 'ADPCM-A sample settings');
  const aVoiceLevel = slider('Voice level', 0, 31, 1, 0, volume => editVoiceA({volume}));
  const panLeft = toggle('Pan left', false, left => editVoiceA({left}));
  const panRight = toggle('Pan right', false, right => editVoiceA({right}));
  const aStart = addressControl('ROM start', value => editAdpcmARange('start', value));
  const aEnd = addressControl('ROM end', value => editAdpcmARange('end', value));
  aSampleControls.append(aVoiceLevel.label, panLeft, panRight, aStart.element, aEnd.element);
  aEditor.append(aPreviewToolbar, aSampleControls);
  adpcmAPanel.append(aRangeView.plot, aRangeView.hint, aPreviewInfo);

  function addressControl(label, onChange) {
    const control = createParamControl({
      label, min: 0, max: 0x1000000, step: ADPCM_ADDRESS_STEP, value: 0,
      wheelAdjust: false,
      formatValue: value => '0x' + value.toString(16).toUpperCase().padStart(6, '0'),
      onChange,
    });
    if (label === 'ROM end') control.element.title = 'Exclusive end address. Applies on the next key press or Play sample.';
    nameParameterButtons(control, label);
    return control;
  }

  function nameParameterButtons(control, label) {
    const [minus, plus] = control.element.querySelectorAll('.param-button');
    minus.setAttribute('aria-label', 'Decrease ' + label);
    plus.setAttribute('aria-label', 'Increase ' + label);
  }

  function snapAddress(address, view) {
    const position = view ? Math.max(view.first, Math.min(view.last, address)) : address;
    return Math.round(position / ADPCM_ADDRESS_STEP) * ADPCM_ADDRESS_STEP;
  }

  function padRangeLimits({start, end, span}, field) {
    return field === 'start' ?
      {min: Math.max(span.start, end - ADPCM_A_KIT_MAX_SAMPLE_BYTES), max: end - ADPCM_ADDRESS_STEP} :
      {min: start + ADPCM_ADDRESS_STEP, max: Math.min(span.end, start + ADPCM_A_KIT_MAX_SAMPLE_BYTES)};
  }

  function editAdpcmARange(field, address, view) {
    if (isFollowingAdpcm('adpcm-a')) return;
    const window = padWindow(aPreviewVoice);
    if (!window.span || (view && (view.channel !== aPreviewVoice || view.rom !== window.rom))) return;
    const {min, max} = padRangeLimits(window, field);
    const value = Math.max(min, Math.min(max, snapAddress(address, view)));
    if (window[field] === value) return;
    const {start, end} = window;
    aPads[aPreviewVoice].range = {start, end, [field]: value};
    updateWorkingAdpcmA();
    onInstrumentEdited('adpcm-a');
  }

  function cancelAdpcmARangeDrag() {
    aStart.cancelDrag();
    aEnd.cancelDrag();
    aRangeView.cancelDrag();
  }

  function padWaveBounds(sample, {span, start, end}) {
    if (!sample?.bank) return span;
    const previous = sample.waveBounds ??= {start, end};
    if (previous.start <= start && end <= previous.end) return previous;
    const first = Math.min(previous.start, start), last = Math.max(previous.end, end);
    // Start at the captured sound. Keep any visible neighboring material
    // when trimming, but avoid zooming out to the whole game's ROM bank.
    sample.waveBounds = last - first <= ADPCM_A_KIT_MAX_SAMPLE_BYTES ? {start: first, end: last} : {start, end};
    return sample.waveBounds;
  }

  function editVoiceA(changes) {
    const pad = aPads[aPreviewVoice];
    pad.voice = {...pad.voice, ...changes};
    if (aPlayed.has(aPreviewVoice)) aState.chip.setVoice(aPreviewVoice, pad.voice);
    onInstrumentEdited('adpcm-a');
  }

  function recentAdpcmAPad(state) {
    const recent = state.voices.reduce((best, voice) => voice.lastTrigger > best.lastTrigger ? voice : best);
    return recent.lastTrigger ? recent.channel : state.voices.find(voice => voice.available)?.channel ?? 0;
  }

  function selectSongAdpcmA(channel) {
    const observed = isFollowingAdpcm('adpcm-a') ? songSnapshot.adpcm.adpcmA : null;
    const selected = channel ?? (observed ? recentAdpcmAPad(observed) : aLastTrigger);
    if (aPreviewVoice !== selected) cancelAdpcmARangeDrag();
    aPinnedVoice = channel;
    aPreviewVoice = selected;
    if (observed) adpcmReadouts.updateA(observed, selected);
    else updateWorkingAdpcmA();
  }

  function updateWorkingAdpcmA() {
    const {voice, sample} = aPads[aPreviewVoice];
    const window = padWindow(aPreviewVoice);
    const {span, start, end, rom, read} = window;
    const available = Boolean(span && end > start);
    for (const [index, pad] of aPads.entries()) pad.select.setAttribute('aria-pressed', String(index === aPreviewVoice));
    aAuto.setAttribute('aria-pressed', String(aPinnedVoice === null));
    aPreviewPlay.disabled = !available;
    aVoiceLevel.setValue(voice.volume);
    panLeft.querySelector('input').checked = voice.left;
    panRight.querySelector('input').checked = voice.right;
    for (const [control, field] of [[aStart, 'start'], [aEnd, 'end']]) {
      if (available) {
        const {min, max} = padRangeLimits(window, field);
        control.updateRange(min, max);
      }
      control.updateVisual(window[field]);
      for (const button of control.element.querySelectorAll('button')) button.disabled = !available;
    }
    const length = available ? (2 * (end - start) / A_RATE).toFixed(3) + ' s' : 'ROM data unavailable';
    aPreviewInfo.textContent = 'A' + (aPreviewVoice + 1) + ' · ' + (sample?.name ?? DRUMS[aPreviewVoice]) + ' · ' + length;
    if (!available) {
      aRangeView.show(null);
      void aWave.show(null);
      return;
    }
    const {start: first, end: last} = padWaveBounds(sample, window);
    aRangeView.show({channel: aPreviewVoice, rom, first, last, start, end});
    void aWave.show(rom, first, last, () => read(first, last));
  }

  function adoptAdpcmA(sourceReference) {
    const {snapshot, kind, reader} = sourceReference;
    if (aAppliedSnapshots.has(snapshot)) return;
    const state = snapshot.adpcm.adpcmA;
    const programmed = state.voices.filter(voice => voice.programmed);
    if (programmed.length === 0 && !state.levelWritten) return;
    const bank = reader.retainAdpcmARom(snapshot);
    if (!bank) return;
    onInstrumentAdopted('adpcm-a');
    aAppliedSnapshots.add(snapshot);
    cancelAdpcmARangeDrag();
    releaseAdpcmAKeyboard();
    const channels = programmed.map(voice => voice.channel);
    stopDrums(channels);
    if (state.levelWritten) {
      aLevel = state.volume;
      aLevelControl.setValue(aLevel);
      if (aPlayed.size) aState.chip.setVolume(aLevel);
    }
    aKitSource = kind === 'code' ? 'Code' : 'VGM';
    for (const {channel, start, playbackEnd, volume, left, right, available} of programmed) {
      const pad = aPads[channel];
      pad.missingRom = !available;
      if (available) {
        pad.pending?.abort();
        pad.pending = null;
        pad.sample = {name: aKitSource + ' A' + (channel + 1), bank};
        pad.range = {start, end: playbackEnd};
      }
      pad.voice = {volume, left, right};
      pad.render();
    }
    aLastTrigger = recentAdpcmAPad(state);
    if (aPinnedVoice === null) aPreviewVoice = aLastTrigger;
    return true;
  }

  function playAdpcmAKey(channel, owner) {
    selectSongAdpcmA(channel);
    return playDrum(channel, owner);
  }

  function stopAdpcmAKey(channel, owner) {
    if (aKeyboardOwners[channel] === owner) stopDrums([channel]);
  }

  function getAdpcmAKit() {
    return {
      level: aLevel,
      pads: aPads.map(({sample, range, voice}, channel) => {
        if (!sample && !range && voice === A_DEFAULT_VOICE) return null;
        const window = padWindow(channel);
        const bytes = window.read();
        if (!bytes) return null;
        const plain = sample && !sample.bank && !range && sample.address === undefined;
        return {
          name: sample?.name ?? DRUMS[channel], bytes,
          ...(!plain && {address: window.start}),
          ...(voice !== A_DEFAULT_VOICE && {voice}),
        };
      }),
    };
  }

  function applyAdpcmAKit(kit) {
    const {level, pads} = normalizeAdpcmAKit(kit);
    stopDrums();
    cancelAdpcmARangeDrag();
    aState?.customLoads.fill(null);
    aKitSource = '';
    aLevel = level;
    aLevelControl.setValue(level);
    aPads.forEach((pad, channel) => {
      pad.pending?.abort();
      pad.pending = null;
      pad.sample = pads[channel];
      pad.range = null;
      pad.voice = pad.sample?.voice ?? A_DEFAULT_VOICE;
      pad.missingRom = false;
      pad.render();
    });
    refreshWorkingAdpcmA();
    if (!isFollowingAdpcm('adpcm-a')) updateWorkingAdpcmA();
  }

  const adpcmB = createFm2610AdpcmB({sound, getMode, onKeyLatchChange: updateAdpcmBHardware});
  const bDefault = adpcmB.getSettings();
  const bName = element('p', '', 'fm2610-sample-name');
  bName.setAttribute('aria-live', 'polite');
  const bUnavailable = element('p', '', 'fm2610-section-note');
  bUnavailable.hidden = true;
  const bWaveform = element('canvas');
  Object.assign(bWaveform, {id: 'adpcmBWaveform', width: 900, height: 144});
  bWaveform.setAttribute('role', 'img');
  bWaveform.setAttribute('aria-label', 'Decoded ADPCM-B sample waveform');
  const bRangeView = createAdpcmRangeView(bWaveform, 'adpcmB', editAdpcmBRange);
  const bDuration = element('p');
  bDuration.id = 'adpcmBSampleDuration';
  const bPicker = element('input');
  Object.assign(bPicker, {type: 'file', accept: '.wav,audio/wav,audio/x-wav', hidden: true, id: 'adpcmBWavInput'});
  let bPending;
  let bWaveRequest;
  let bEditorPeaks;
  let bDrawMode = false, bStroke, bDrawJob, bExportJob;
  const bWave = createSongWaveView(bWaveform, getFm2610AdpcmBWaveform, report);
  let bPreparedSample;
  let bRangeSource = {}, bWasFollowing = false;

  const bStart = addressControl('ROM start', value => editAdpcmBRange('start', value));
  const bEnd = addressControl('ROM end', value => editAdpcmBRange('end', value));
  const bDelta = createParamControl({label: 'Delta-N', min: 1, max: 65535, step: 1,
    value: bDefault.deltaN, wheelAdjust: false, onChange(deltaN) {
      adpcmB.setDeltaN(deltaN);
      renderAdpcmB();
      onInstrumentEdited('adpcm-b');
    }});
  nameParameterButtons(bDelta, 'Delta-N');
  bDelta.element.classList.add('fm2610-adpcm-delta');
  bDelta.element.title = 'Delta-N at the root note. Keyboard notes transpose this rate.';

  const bRoot = createParamControl({label: 'Root note', min: 0, max: 127, step: 1,
    value: bDefault.rootNote, formatValue: midiToNoteName, wheelAdjust: false,
    onChange(rootNote) {
      editAdpcmBSettings({rootNote});
      renderAdpcmB();
    }});
  const bRate = slider('Base rate (Hz)', 1, FM2610_ADPCM_B_MAX_RATE, 1, bDefault.sampleRate, sampleRate => {
    const {clockHz} = adpcmB.getSettings();
    if (clockHz === undefined) {
      sampleRate = Math.max(1, Math.min(FM2610_ADPCM_B_MAX_RATE, Math.round(sampleRate)));
    }
    editAdpcmBSettings({sampleRate});
    renderAdpcmB();
  });
  const bRateInput = bRate.label.querySelector('input');
  const bVolume = slider('ADPCM-B level', 0, 255, 1, bDefault.volume, volume => editAdpcmBSettings({volume}));
  const bRepeat = toggle('Repeat', bDefault.repeat, repeat => editAdpcmBSettings({repeat}));
  const bLeft = toggle('Left', true, left => editAdpcmBSettings({left}));
  const bRight = toggle('Right', true, right => editAdpcmBSettings({right}));
  const bSave = button('Save sample…', () => saveAdpcmBSample(adpcmB.getSample()));
  const bExport = button('Export WAV', exportAdpcmBWave);
  bExport.title = 'Export the selected ROM range as mono WAV at the base rate.';
  const bRangeTool = button('Range', () => setAdpcmBWaveTool(false));
  const bDrawTool = button('Draw', () => setAdpcmBWaveTool(true));
  const bWaveTools = element('div', '', 'fm2610-inline-controls');
  bWaveTools.setAttribute('role', 'group');
  bWaveTools.setAttribute('aria-label', 'ADPCM-B waveform tool');
  bWaveTools.append(bRangeTool, bDrawTool);
  const bDrawHint = element('p', '', 'fm2610-sample-name fm2610-adpcm-range-hint');
  bDrawHint.id = 'adpcmBDrawHint';
  const bDrawStatus = element('output', '', 'fm2610-sample-name');
  bDrawStatus.setAttribute('role', 'status');
  bDrawStatus.hidden = true;

  function editAdpcmBSettings(settings) {
    adpcmB.setSettings(settings);
    onInstrumentEdited('adpcm-b');
  }

  function showAdpcmBDuration({start, end, sampleRate}) {
    bDuration.textContent = (2 * (end - start) / sampleRate).toFixed(3) + ' s at base rate';
  }

  function cancelAdpcmBRangeDrag() {
    bStart.cancelDrag();
    bEnd.cancelDrag();
    bRangeView.cancelDrag();
  }

  function setAdpcmBWaveTool(draw) {
    if (draw === bDrawMode) return;
    cancelAdpcmBRangeDrag();
    if (!draw) cancelAdpcmBDrawing();
    bDrawMode = draw;
    renderAdpcmB();
  }

  function releaseAdpcmBStroke() {
    const stroke = bStroke;
    if (!stroke) return null;
    bStroke = null;
    if (bWaveform.hasPointerCapture(stroke.pointer)) bWaveform.releasePointerCapture(stroke.pointer);
    return stroke;
  }

  function cancelAdpcmBDrawing() {
    if (!bStroke && !bDrawJob) return;
    releaseAdpcmBStroke();
    bDrawJob?.abort();
    bDrawJob = null;
    if (!isFollowingAdpcm('adpcm-b')) drawAdpcmWaveform(bWaveform, bEditorPeaks);
    renderAdpcmB();
  }

  function paintAdpcmBStroke(event) {
    const bounds = bWaveform.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = (event.clientY - bounds.top) * bWaveform.height / bounds.height;
    const middle = bWaveform.height / 2;
    const amplitude = Math.max(-1, Math.min(1, (middle - y) / (middle - 4)));
    const {points, peaks} = bStroke;
    const previous = points.at(-1) ?? {position, amplitude};
    if (points.length && previous.position === position && previous.amplitude === amplitude) return;
    points.push({position, amplitude});
    // Preview the painted columns immediately; the committed plot is the actual decode.
    const last = peaks.length / 2 - 1;
    const from = Math.round(previous.position * last), to = Math.round(position * last);
    for (let column = Math.min(from, to); column <= Math.max(from, to); column++) {
      const amount = from === to ? 1 : (column - from) / (to - from);
      peaks[column * 2] = peaks[column * 2 + 1] = previous.amplitude + (amplitude - previous.amplitude) * amount;
    }
    drawAdpcmWaveform(bWaveform, peaks);
  }

  bWaveform.addEventListener('pointerdown', event => {
    if (!bDrawMode || !bEditorPeaks?.length || bPending || bDrawJob || bStroke ||
        isFollowingAdpcm('adpcm-b') || event.button !== 0) return;
    event.preventDefault();
    bDrawStatus.hidden = true;
    bStroke = {pointer: event.pointerId, points: [], peaks: bEditorPeaks.slice()};
    bWaveform.setPointerCapture(event.pointerId);
    paintAdpcmBStroke(event);
  });
  bWaveform.addEventListener('pointermove', event => {
    if (bStroke?.pointer === event.pointerId) paintAdpcmBStroke(event);
  });
  bWaveform.addEventListener('pointerup', async event => {
    if (bStroke?.pointer !== event.pointerId) return;
    paintAdpcmBStroke(event);
    const {points} = releaseAdpcmBStroke();
    const job = new AbortController();
    bDrawJob = job;
    renderAdpcmB();
    try {
      if (await adpcmB.drawWave(points, job.signal)) {
        bDrawStatus.textContent = 'Waveform updated. The next note uses the edited sample.';
        bDrawStatus.hidden = false;
        onInstrumentEdited('adpcm-b');
        await refreshAdpcmBWaveform();
      } else {
        drawAdpcmWaveform(bWaveform, bEditorPeaks);
      }
    } catch (error) {
      if (!job.signal.aborted) {
        drawAdpcmWaveform(bWaveform, bEditorPeaks);
        report(error);
      }
    } finally {
      if (bDrawJob === job) {
        bDrawJob = null;
        renderAdpcmB();
      }
    }
  });
  for (const eventName of ['pointercancel', 'lostpointercapture']) {
    bWaveform.addEventListener(eventName, event => {
      if (bStroke?.pointer === event.pointerId) cancelAdpcmBDrawing();
    });
  }
  const bWindow = bWaveform.ownerDocument.defaultView;
  bWindow.addEventListener('blur', () => {
    if (bStroke) cancelAdpcmBDrawing();
  });
  bWindow.addEventListener('keydown', event => {
    if (event.key === 'Escape' && bStroke) {
      event.preventDefault();
      cancelAdpcmBDrawing();
    }
  });

  async function exportAdpcmBWave() {
    const job = new AbortController();
    bExportJob = job;
    renderAdpcmB();
    try {
      const {name} = adpcmB.getSettings();
      const bytes = await adpcmB.exportWave(job.signal);
      const url = bWindow.URL.createObjectURL(new Blob([bytes], {type: 'audio/wav'}));
      try {
        const anchor = element('a');
        anchor.href = url;
        anchor.download = name.replace(/\.wav$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '.wav';
        anchor.click();
      } finally {
        bWindow.setTimeout(() => bWindow.URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      if (!job.signal.aborted) report(error);
    } finally {
      if (bExportJob === job) {
        bExportJob = null;
        renderAdpcmB();
      }
    }
  }

  function editAdpcmBRange(field, address, view) {
    if (isFollowingAdpcm('adpcm-b') || (view && view.rom !== bRangeSource)) return;
    const settings = adpcmB.getSettings();
    const {sampleStart, sampleEnd, start, end} = settings;
    const min = field === 'start' ? sampleStart : start + ADPCM_ADDRESS_STEP;
    const max = field === 'start' ? end - ADPCM_ADDRESS_STEP : sampleEnd;
    const value = Math.max(min, Math.min(max, snapAddress(address, view)));
    if (value === settings[field]) return;
    adpcmB.setRange({[field]: value});
    renderAdpcmB();
    onInstrumentEdited('adpcm-b');
  }

  function updateAdpcmBHardware() {
    if (isFollowingAdpcm('adpcm-b')) return;
    const {keyed, playbackRate} = adpcmB.getSettings();
    adpcmReadouts.updateB({keyed, playbackRate, available: true});
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
        renderAdpcmBControls(isFollowingAdpcm('adpcm-b'));
      }
    } catch (error) {
      if (!request.signal.aborted) report(error);
    } finally {
      if (bWaveRequest === request) bWaveRequest = null;
    }
  }

  function renderAdpcmBParameters({rootNote, sampleRate, volume, repeat, clockHz, deltaN, start, end,
    left = true, right = true}) {
    bStart.updateVisual(start);
    bEnd.updateVisual(end);
    bDelta.updateVisual(deltaN);
    bRoot.updateVisual(rootNote);
    const {min, max} = getFm2610AdpcmBRateLimits(clockHz);
    Object.assign(bRateInput, {min: Math.min(min, sampleRate), max: Math.max(max, sampleRate),
      step: clockHz === undefined && Number.isInteger(sampleRate) ? 1 : 'any'});
    bRate.setValue(sampleRate, Number.isInteger(sampleRate) ? null : sampleRate.toFixed(2));
    bVolume.setValue(volume);
    bRepeat.querySelector('input').checked = repeat;
    bLeft.querySelector('input').checked = left;
    bRight.querySelector('input').checked = right;
  }

  function renderAdpcmBControls(following) {
    for (const control of bToolbar.querySelectorAll('button')) {
      control.disabled = following || (control === bSave && Boolean(bPending));
    }
    const preparing = Boolean(bPending || bDrawJob);
    bSave.disabled ||= preparing;
    bExport.disabled ||= preparing || Boolean(bExportJob);
    bRangeTool.disabled = following;
    bDrawTool.disabled = following || preparing || !bEditorPeaks?.length;
    bRangeTool.setAttribute('aria-pressed', String(!bDrawMode));
    bDrawTool.setAttribute('aria-pressed', String(bDrawMode));
    const drawing = !following && bDrawMode;
    bWaveform.classList.toggle('is-drawing', drawing && !preparing);
    bWaveform.setAttribute('aria-describedby', drawing ? bDrawHint.id : bRangeView.hint.id);
    bDrawHint.hidden = !drawing;
    bDrawHint.textContent = bDrawJob ? 'Encoding waveform…' : 'Draw on the waveform and release to apply. Escape cancels the stroke.';
    if (following) bDrawStatus.hidden = true;
    for (const control of bParameters.querySelectorAll('button, input')) control.disabled = following;
  }

  function renderAdpcmB() {
    const following = isFollowingAdpcm('adpcm-b');
    renderAdpcmBControls(following);
    if (following) {
      bRangeView.show(null);
      return;
    }
    const settings = adpcmB.getSettings();
    const {start, end, sampleStart, sampleEnd} = settings;
    bStart.updateRange(sampleStart, end - ADPCM_ADDRESS_STEP);
    bEnd.updateRange(start + ADPCM_ADDRESS_STEP, sampleEnd);
    bRangeView.show(bDrawMode ? null : {channel: 0, rom: bRangeSource, first: sampleStart, last: sampleEnd, start, end});
    renderAdpcmBParameters(settings);
    bName.textContent = bPending ? 'Preparing WAV…' : settings.name;
    bName.title = settings.name;
    showAdpcmBDuration(settings);
    updateAdpcmBHardware();
  }

  function applyAdpcmBSample(sample) {
    cancelAdpcmBDrawing();
    bDrawStatus.hidden = true;
    bPending?.abort();
    bPending = null;
    releaseAdpcmBKeyboard();
    adpcmB.applySample(sample);
    cancelAdpcmBRangeDrag();
    bRangeSource = {};
    bPreparedSample = null;
    renderAdpcmB();
    void refreshAdpcmBWaveform();
  }

  bPicker.addEventListener('change', async () => {
    const file = bPicker.files[0];
    bPicker.value = '';
    if (!file) return;
    cancelAdpcmBDrawing();
    bDrawStatus.hidden = true;
    bPending?.abort();
    const controller = new AbortController();
    bPending = controller;
    renderAdpcmB();
    try {
      await adpcmB.loadSample(file, {signal: controller.signal});
      if (bPending !== controller) return;
      cancelAdpcmBRangeDrag();
      bRangeSource = {};
      bPreparedSample = null;
      releaseAdpcmBKeyboard();
      void refreshAdpcmBWaveform();
      onInstrumentEdited('adpcm-b');
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
  }), button('Reset to pluck', () => {
    applyAdpcmBSample(null);
    onInstrumentEdited('adpcm-b');
  }), bSave, bExport);
  const bParameters = element('div', '', 'fm2610-inline-controls');
  const bRangeControls = element('div', '', 'fm2610-inline-controls fm2610-adpcm-range');
  bRangeControls.append(bStart.element, bEnd.element);
  const bPan = element('div', '', 'fm2610-inline-controls');
  bPan.setAttribute('role', 'group');
  bPan.setAttribute('aria-label', 'Pan');
  bPan.append(element('span', 'Pan'), bLeft, bRight);
  bParameters.append(bRangeControls, bDelta.element, bRoot.element, bRate.label, bVolume.label, bPan, bRepeat);
  const bHeader = title('ADPCM-B · 1 voice', 'Set the root note for keyboard playback. Repeat applies when the next note starts.');
  adpcmBPanel.append(bHeader, bName, bUnavailable, bToolbar, bWaveTools, bRangeView.plot, bRangeView.hint,
    bDrawHint, bDrawStatus, bDuration, bParameters, adpcmReadouts.bPanel, bPicker);
  renderAdpcmB();
  void refreshAdpcmBWaveform();

  function isFollowingAdpcm(source) {
    if (!songSnapshot?.adpcm) return false;
    if (source === 'adpcm-a') return !reference.frozen && songSnapshot.adpcmSources?.a !== false;
    return source === 'adpcm-b' && !reference.frozen && songSnapshot.adpcmSources?.b !== false;
  }

  function adoptAdpcmB() {
    if (!reference?.frozen || songSnapshot.adpcmSources?.b === false) return '';
    if (bAppliedSnapshots.has(songSnapshot)) return bAppliedSnapshots.get(songSnapshot);
    const state = songSnapshot.adpcm?.adpcmB;
    const {clockHz} = songSnapshot;
    const name = referenceName();
    const validClock = Number.isInteger(clockHz) && clockHz >= 100000 && clockHz <= 24000000;
    const bytes = state?.available && state.deltaN > 0 && validClock
      ? reference.reader.readAdpcmBBytes(songSnapshot) : null;
    let notice = name + ' ADPCM-B sample data is unavailable at this position.';
    if (bytes) {
      const previous = adpcmB.getSettings();
      const {start: address, sampleRate, volume, left, right, repeat} = state;
      onInstrumentAdopted('adpcm-b');
      applyAdpcmBSample({name: name + ' sample', bytes, address, sampleRate, clockHz,
        rootNote: previous.clockHz === undefined ? 60 : previous.rootNote, volume, left, right, repeat});
      notice = '';
    } else if (state?.available && !state.deltaN) {
      notice = name + ' ADPCM-B playback rate is zero.';
    } else if (state?.available && !validClock) {
      notice = name + ' ADPCM-B clock is outside the playback range.';
    }
    bAppliedSnapshots.set(songSnapshot, notice);
    return notice;
  }

  let aWasVisible = false;
  function refreshWorkingAdpcmA() {
    const following = isFollowingAdpcm('adpcm-a');
    const wasFollowing = !adpcmReadouts.aPanel.hidden;
    const visible = visibleSource === 'adpcm-a';
    const adopted = reference?.frozen && songSnapshot?.adpcm?.adpcmA &&
      songSnapshot.adpcmSources?.a !== false && adoptAdpcmA(reference);
    if (following !== wasFollowing) {
      releaseAdpcmAKeyboard();
      if (following) stopDrums();
      cancelAdpcmARangeDrag();
      if (following) aRangeView.show(null);
      aEditor.hidden = following;
      adpcmReadouts.aPanel.hidden = !following;
    }
    const label = following ? (reference.kind === 'code' ? 'Code · Running' : 'VGM · Playing') :
      aKitSource ? 'Editing · From ' + aKitSource : 'Editing · ADPCM-A kit';
    if (aSource.textContent !== label) aSource.textContent = label;
    if (following && visible) {
      const state = songSnapshot.adpcm.adpcmA;
      const channel = aPinnedVoice ?? recentAdpcmAPad(state);
      const voice = state.voices[channel];
      adpcmReadouts.updateA(state, channel);
      const detail = voice.available ? (2 * (voice.playbackEnd - voice.start) / state.sampleRate).toFixed(3) + ' s' :
        'ROM data unavailable';
      const info = 'A' + (channel + 1) + ' · ' + detail;
      if (aPreviewInfo.textContent !== info) aPreviewInfo.textContent = info;
      const snapshot = songSnapshot, {reader} = reference;
      void aWave.show(voice.available ? state.rom : null, voice.start, voice.playbackEnd,
        () => reader.readAdpcmABytes(snapshot, channel));
    } else if (visible && (adopted || !aWasVisible || wasFollowing)) {
      updateWorkingAdpcmA();
    }
    if (aWasVisible && !visible) {
      aRangeView.show(null);
      cancelAdpcmARangeDrag();
      aWave.cancel();
    }
    aWasVisible = visible;
  }

  function refreshSongAdpcmView() {
    refreshWorkingAdpcmA();
    const followB = isFollowingAdpcm('adpcm-b');
    const unavailable = adoptAdpcmB();
    bUnavailable.hidden = !unavailable;
    if (bUnavailable.textContent !== unavailable) bUnavailable.textContent = unavailable;
    if (followB !== bWasFollowing) {
      bWasFollowing = followB;
      cancelAdpcmBRangeDrag();
      renderAdpcmB();
      if (followB) {
        cancelAdpcmBDrawing();
        releaseAdpcmBKeyboard();
        adpcmB.stop();
      } else {
        drawAdpcmWaveform(bWaveform, bEditorPeaks);
      }
    }
    if (!followB || visibleSource !== 'adpcm-b') {
      bWave.cancel();
      if (!followB && visibleSource === 'adpcm-b' && !bPreparedSample && adpcmB.getSettings().clockHz !== undefined) {
        bPreparedSample = true;
        void adpcmB.prepare().catch(report);
      }
      return;
    }

    const state = songSnapshot.adpcm.adpcmB;
    const name = `${referenceName()} · Playing`;
    if (bName.textContent !== name) {
      bName.textContent = name;
      bName.title = name;
    }
    const duration = state.available && state.sampleRate > 0
      ? (2 * (state.end - state.start) / state.sampleRate).toFixed(3) + ' s at playback rate' : '';
    if (bDuration.textContent !== duration) bDuration.textContent = duration;
    adpcmReadouts.updateB({...state, playbackRate: state.sampleRate});
    renderAdpcmBParameters({...state, clockHz: songSnapshot.clockHz, rootNote: adpcmB.getSettings().rootNote});
    void bWave.show(state.available ? state.rom : null, state.start, state.end,
      () => reference.reader.readAdpcmBBytes(songSnapshot));
  }

  function setPerformanceReference(next, visible) {
    if (reference?.frozen && (reference.snapshot !== next?.snapshot || !next.frozen)) {
      cancelAdpcmARangeDrag();
      cancelAdpcmBRangeDrag();
    }
    if (visibleSource === 'adpcm-b' && visible !== 'adpcm-b') {
      cancelAdpcmBRangeDrag();
      cancelAdpcmBDrawing();
    }
    if (reference?.kind !== next?.kind) {
      bWave.reset();
    }
    reference = next;
    songSnapshot = next?.snapshot ?? null;
    visibleSource = visible;
    refreshSsgReference();
    refreshSongAdpcmView();
  }

  function stopAdpcm({invalidateB = false} = {}) {
    stopDrums();
    if (invalidateB) {
      adpcmB.invalidate();
      bPreparedSample = false;
    }
    else adpcmB.stop();
  }

  return {
    noteOnSSG,
    noteOffSSG,
    showSSGChannel,
    isFollowingSsg,
    getSsgPreset,
    applySsgPreset,
    playAdpcmAKey,
    stopAdpcmAKey,
    applyAdpcmAKit,
    getAdpcmAKit,
    noteOnAdpcmB: adpcmB.noteOn,
    noteOffAdpcmB: adpcmB.noteOff,
    applyAdpcmBSample,
    getAdpcmBSample: adpcmB.getSample,
    setAdpcmBSourceGains: adpcmB.setSourceGains,
    stopAdpcmB: adpcmB.stop,
    setPerformanceReference,
    isFollowingAdpcm,
    stopAdpcm,
    stop(options) {
      voices.forEach((_, channel) => noteOffSSG(channel));
      stopAdpcm(options);
    },
  };
}
