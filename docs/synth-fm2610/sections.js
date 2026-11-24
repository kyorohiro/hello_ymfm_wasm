// SPDX-License-Identifier: BSD-3-Clause
import {encodeAdpcmA} from '../js/adpcm_a_sample.js';
import {encodeAdpcmB, readSamplePCM} from '../js/adpcm_b_sample.js';
import {createOfflineAudioDecoder} from '../js/audio_decode.js';
import {ADPCM_A_KIT_MAX_SAMPLE_BYTES, normalizeAdpcmAKit} from './adpcm_a_kit.js';

const MASTER_CLOCK = 8_000_000;
const SAMPLE_ADDRESS = 0x10000;
const A_RATE = MASTER_CLOCK / 432;
const A_CUSTOM_START = 0x800000;
const A_SLOT_BYTES = 0x100000;
const A_MAX_FILE_BYTES = 64 * 1024 * 1024;
const B_SOURCE_RATE = 12000;
const DRUMS = ['Kick', 'Snare', 'Closed hat', 'Tom', 'Block', 'Shaker'];
const A_VOICES = DRUMS.map((_, index) => index);

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

function bSample() {
  // An original plucked tone. A multiple of 512 frames makes the 256-byte
  // address range exact, without adding unencoded bytes between repeats.
  const pcm = new Float32Array(4096);
  for (let frame = 0; frame < pcm.length; frame++) {
    const seconds = frame / B_SOURCE_RATE;
    const angle = 2 * Math.PI * 196 * seconds;
    const fade = Math.min(1, frame / 24, (pcm.length - 1 - frame) / 240);
    pcm[frame] = (.62 * Math.sin(angle) + .2 * Math.sin(angle * 2) * Math.exp(-seconds * 18)) *
      Math.exp(-seconds * 9) * fade;
  }
  return encodeAdpcmB({channels: [pcm], sampleRate: B_SOURCE_RATE}, B_SOURCE_RATE).bytes;
}

export function setupFm2610Sections({ssgPanel, adpcmAPanel, adpcmBPanel, sound, saveAdpcmAKit, report = () => {}}) {
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
      setValue(next) {
        input.value = String(next);
        output.value = String(next);
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

  const voices = Array.from({length: 3}, () => ({tone: true, noise: false, level: 10, gate: false, request: 0}));
  let ssgChip;
  let noisePeriod = 16;

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

  const ssgControls = element('div', '', 'fm2610-section-grid');
  voices.forEach((voice, channel) => {
    const card = element('section', '', 'fm2610-voice');
    card.append(element('h3', `SSG ${channel + 1}`),
      toggle('Tone', voice.tone, value => { voice.tone = value; updateSsg(channel); }),
      toggle('Noise', voice.noise, value => { voice.noise = value; updateSsg(channel); }),
      slider('Level', 0, 15, 1, voice.level, value => { voice.level = value; updateSsg(channel); }).label);
    ssgControls.append(card);
  });
  ssgPanel.append(title('SSG · 3 voices', 'Play the selected SSG voice from the keyboard. The noise period is shared by all three voices.'),
    ssgControls, slider('Noise period', 1, 31, 1, noisePeriod, value => {
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
    const sampleName = element('p', '', 'fm2610-sample-name');
    sampleName.setAttribute('aria-live', 'polite');
    const picker = element('input');
    Object.assign(picker, {type: 'file', accept: 'audio/*,.wav,.flac,.m4a', hidden: true});
    const play = button('Play', () => playDrum(channel));
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
    pad.append(element('h3', voice), sampleName, controls, picker);
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
  adpcmAPanel.append(title('ADPCM-A · 6 voices', 'Load one-shot samples up to about 113 seconds per voice. Playback is fixed at 8 MHz ÷ 432.'), drumPads, aToolbar);

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

  let bState;
  let encodedB;
  let bRate = B_SOURCE_RATE;
  let bLevel = 176;
  let bRepeat = false;
  let bRequest = 0;
  let bPlayed = false;

  async function playSample() {
    const request = ++bRequest;
    const {adpcmB} = await sound();
    if (request !== bRequest) return;
    if (bState?.chip !== adpcmB) {
      encodedB ??= bSample();
      bState = {chip: adpcmB};
      bPlayed = false;
      const state = bState;
      state.ready = Promise.resolve().then(() => adpcmB.loadMemory(encodedB, SAMPLE_ADDRESS)).catch(error => {
        if (bState === state) bState = undefined;
        throw error;
      });
    }
    const state = bState;
    await state.ready;
    if (state !== bState || request !== bRequest) return;
    adpcmB.keyOff();
    adpcmB.setSample({start: SAMPLE_ADDRESS, end: SAMPLE_ADDRESS + encodedB.length});
    adpcmB.setPlaybackRate(bRate);
    adpcmB.setVolume(bLevel);
    adpcmB.setPan(true, true);
    adpcmB.keyOn({repeat: bRepeat});
    bPlayed = true;
  }

  function stopSample() {
    bRequest++;
    if (bPlayed) bState.chip.keyOff();
    bPlayed = false;
  }

  const bToolbar = element('div', '', 'fm2610-inline-controls');
  bToolbar.append(button('Play sample', playSample), button('Stop sample', stopSample),
    toggle('Repeat', bRepeat, value => { bRepeat = value; }),
    slider('Playback rate (Hz)', 2000, 48000, 100, bRate, value => {
      bRate = value;
      if (bPlayed) bState.chip.setPlaybackRate(value);
    }).label,
    slider('ADPCM-B level', 0, 255, 1, bLevel, value => {
      bLevel = value;
      if (bPlayed) bState.chip.setVolume(value);
    }).label);
  adpcmBPanel.append(title('ADPCM-B · 1 voice', 'A generated pluck plays at the chosen rate. Repeat applies on the next Play.'), bToolbar);

  function stopAdpcm() {
    stopDrums();
    stopSample();
  }

  return {
    noteOnSSG,
    noteOffSSG,
    applyAdpcmAKit,
    getAdpcmAKit,
    stopAdpcm,
    stop() {
      voices.forEach((_, channel) => noteOffSSG(channel));
      stopAdpcm();
    },
  };
}
