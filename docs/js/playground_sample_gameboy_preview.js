/** Browser / Worker / Node: owned comparison data and isolated offline Game Boy PCM. */
import {normalizeSampleEdit, renderSampleEdit, renderGameboyWave} from './playground_sample_edit.js?v=audio-numeric-bindings-1';
import {GameboyApu} from './gameboyapu.js?v=audio-stability-2';
import {GameboyDirectTransport, GameboySynth} from './gameboysynth.js?v=audio-stability-2';
import {SOUNDCHIP_MIXER_LISTENING_LEVELS} from './soundchip_mixer_presets.js';

const DISPLAY_POINTS = 256;
const PREVIEW_SECONDS = .85;
const PREVIEW_RATE = 44100;

/**
 * The display is sampled from the same edited mono selection used by the converter.
 * Its source positions span both endpoints and are bounded independently of recording length.
 * Wave RAM always comes from renderGameboyWave, including its circular resampling.
 */
export function renderGameboySampleComparison(audio, settings) {
  const edit = normalizeSampleEdit(audio, settings);
  const rendered = renderSampleEdit(audio, edit);
  const input = rendered.channels[0], points = Math.min(DISPLAY_POINTS, input.length);
  const source = Float32Array.from({length: points}, (_, i) => input[points === 1 ? 0
    : Math.round(i * (input.length - 1) / (points - 1))]);
  return {source, waveform: renderGameboyWave(audio, edit), rootMidi: edit.rootMidi,
    tuneCents: edit.tuneCents, sourceStartFrame: edit.startFrame, sourceEndFrame: edit.endFrame,
    peakBeforeClip: rendered.peakBeforeClip, clippedSamples: rendered.clippedSamples};
}

/**
 * Render a short note through a private native Game Boy core, never a live chip or device.
 * Like createSampleInstrument's wave RAM target, rootMidi is an integer MIDI note and
 * tuneCents is sample metadata: it does not transpose an independently pitched wave channel.
 * PCM uses the shared Game Boy listening gain, followed by a 5ms endpoint fade.
 * The module factory/loader is injected by the Worker or Node caller.
 * @param {any} audio
 * @param {any} settings
 * @param {{moduleFactory: Function, moduleOptions?: any}} options
 * @returns {Promise<{channels: Float32Array[], sampleRate: number, waveform: Uint8Array,
 * rootMidi: number, tuneCents: number, durationSeconds: number, frequencyHz: number}>}
 */
export async function renderGameboySamplePreview(audio, settings, {moduleFactory, moduleOptions} = {}) {
  const edit = normalizeSampleEdit(audio, settings);
  if (edit.rootMidi < 24) throw new RangeError('Game Boy converted preview requires a root note of C1 (MIDI 24) or higher.');
  const rendered = renderSampleEdit(audio, edit);
  const waveform = renderGameboyWave(audio, edit);
  const chip = await GameboyApu.create({moduleFactory, moduleOptions, sampleRate: PREVIEW_RATE});
  let synth;
  try {
    synth = new GameboySynth({transport: new GameboyDirectTransport(chip)});
    synth.initialize();
    synth.wave.stopAndSetWaveform(waveform);
    synth.setPan(2, true, true);
    const frequencyHz = synth.wave.setNote(edit.rootMidi);
    synth.wave.setLevel(1);
    synth.wave.keyOn();
    const frames = Math.round(PREVIEW_SECONDS * PREVIEW_RATE);
    const {left, right} = chip.generateStereo(frames);
    const channels = [left, right], fadeFrames = Math.round(.005 * PREVIEW_RATE);
    const outputGain = SOUNDCHIP_MIXER_LISTENING_LEVELS.gameboy;
    for (const channel of channels) for (let i = 0; i < channel.length; i++) {
      if (!Number.isFinite(channel[i])) throw new Error('Game Boy preview produced non-finite PCM.');
      const edge = Math.min(1, i / fadeFrames, (frames - 1 - i) / fadeFrames);
      channel[i] = Math.max(-1, Math.min(1, channel[i] * outputGain)) * edge;
    }
    synth.wave.keyOff();
    return {channels, sampleRate: PREVIEW_RATE, waveform, rootMidi: edit.rootMidi,
      tuneCents: edit.tuneCents, durationSeconds: frames / PREVIEW_RATE, frequencyHz, outputGain,
      loopEnabled: false, loopStartFrame: 0, loopEndFrame: frames,
      peakBeforeClip: rendered.peakBeforeClip, clippedSamples: rendered.clippedSamples};
  } finally {
    synth?.dispose();
    chip.dispose();
  }
}
