// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
/** Isolated offline PS1 SPU preview. Never opens a device or touches live audio. */
import {renderPs1Sample} from './playground_sample_ps1.js?v=ps1-sample-editor-1';
import {Ps1Spu} from './ps1_spu.js?v=ps1-deferred-release-1';
import {Ps1Synth} from './ps1synth.js?v=ps1-deferred-release-1';

const SAMPLE_RATE = 44100;
const PREVIEW_SECONDS = .85;
const OUTPUT_GAIN = 1; // PS1 is unmeasured unity; no hidden normalization/Mixer gain.

/** Audition the same declared MIDI-root key as the instrument's Keyboard route.
 * baseFrequencyHz includes cents metadata, so setting the root MIDI note applies
 * the same cents compensation as subsequent Keyboard notes. At zero cents the
 * hardware pitch is 4096. Voice level .75 matches the default sample instrument.
 * A short endpoint fade affects only this disposable preview, not source/ADPCM.
 * The caller supplies the actual generated WASM factory and options.
 * @param {any} audio
 * @param {any} [settings]
 * @param {{moduleFactory:Function,moduleOptions?:any,maxBytes?:number}} [options]
 */
export async function renderPs1SamplePreview(audio, settings = {}, {moduleFactory, moduleOptions, maxBytes} = {}) {
  // Validate and encode before allocating any native handle.
  const converted = renderPs1Sample(audio, settings, {maxBytes});
  // Emscripten mutates its options object into the initialized module. Keep
  // this private module from replacing caller-owned module views or exports.
  const core = await Ps1Spu.create({moduleFactory, moduleOptions: {...moduleOptions}});
  let synth;
  try {
    synth = new Ps1Synth({core});
    const sample = synth.loadADPCM(converted.adpcm, {baseFrequencyHz: converted.baseFrequencyHz,
      ...(converted.loopEnabled ? {loopStartSamples: converted.loopStartFrame} : {})});
    synth.setPreset(0, {sample, volumeLeft: .75, volumeRight: .75, adsr1: 0x000f, adsr2: 0});
    synth.noteOn(0, converted.rootMidi);
    const pitch = synth.getPreset(0).pitch;
    const frames = Math.round(PREVIEW_SECONDS * SAMPLE_RATE);
    const left = new Float32Array(frames), right = new Float32Array(frames), channels = [left, right];
    synth.renderInto(left, right, frames);
    const fadeFrames = Math.round(.005 * SAMPLE_RATE);
    for (const channel of channels) for (let i = 0; i < frames; i++) {
      if (!Number.isFinite(channel[i])) throw new Error('PS1 preview produced non-finite PCM.');
      const edge = Math.min(1, i / fadeFrames, (frames - 1 - i) / fadeFrames);
      channel[i] = Math.max(-1, Math.min(1, channel[i] * OUTPUT_GAIN)) * edge;
    }
    synth.noteOff(0);
    const {channels: _edited, decodedChannels: _decoded, ...metadata} = converted;
    return {...metadata, channels, sampleRate: SAMPLE_RATE,
      durationSeconds: frames / SAMPLE_RATE, frequencyHz: 440 * 2 ** ((converted.rootMidi - 69) / 12),
      sourceFrequencyHz: converted.baseFrequencyHz, pitch, outputGain: OUTPUT_GAIN,
      sampleLoopEnabled: converted.loopEnabled, sampleLoopStartFrame: converted.loopStartFrame,
      sampleLoopEndFrame: converted.loopEndFrame,
      loopEnabled: false, loopStartFrame: 0, loopEndFrame: frames};
  } finally {
    // Ps1Synth owns its core; do not destroy the same native handle twice.
    if (synth) synth.dispose();
    else core.dispose();
  }
}
