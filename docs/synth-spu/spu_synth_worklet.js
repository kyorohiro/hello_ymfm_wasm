// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
import factory from '../generated/ps1_spu_wasm.js?v=ps1-deferred-release-1';
import {Ps1Spu} from '../js/ps1_spu.js?v=ps1-deferred-release-1';
import {Ps1Synth} from '../js/ps1synth.js?v=ps1-deferred-release-1';
import {Ps1Resampler} from '../js/ps1_resampler.js?v=ps1-mode-1';
import {Ps1VoiceInspector} from '../js/playground_ps1_inspector.js?v=ps1-deferred-release-1';

const EDITOR_METHODS = new Set(['auditionOn', 'auditionOff', 'auditionAllOff', 'setWaveform', 'setPreset', 'setChannel', 'setEnvelope', 'setReverb', 'setPitch', 'setFrequency', 'setNote']);
const SYNTH_METHODS = new Set(['loadADPCM', 'getPreset', 'snapshot', 'noteOn', 'noteOff', 'keyOn', 'keyOff', 'allNotesOff', '_auditionKeyOn', '_auditionKeyOff', '_refreshEnvelope']);
const READ_METHODS = new Set(['inspect', 'getState', 'getPreset', 'getInstrument', 'snapshot']);

/** One SPU and its fixed-rate resampler. Rendering has no UI polling, script
 * execution, event dispatch, encoders or message allocation per audio block. */
export class SpuSynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super();
    this.dead = false;
    this.synth = null;
    this.inspector = null;
    this.resampler = null;
    this.port.onmessage = ({data}) => {
      if (data?.method === 'dispose') {this.dispose(); return;}
      void this.ready.then(() => this.receive(data)).catch(() => {});
    };
    // AudioWorkletGlobalScope need not expose URL/fetch. Bytes are supplied
    // by the main thread; locateFile bypasses the factory's URL fallback.
    this.ready = Ps1Spu.create({moduleFactory:factory, moduleOptions:{wasmBinary:processorOptions.wasmBinary, locateFile:() => 'ps1_spu_wasm.wasm'}}).then(core => {
      if (this.dead) {core.dispose(); return;}
      this.synth = new Ps1Synth({core});
      // The main thread prepares these bounded packets once. Each voice owns
      // its editable slot, so changing one cycle cannot affect a sibling.
      for (let ch = 0; ch < 24; ch++) {
        const sample = this.synth._setWaveformPrepared(ch, processorOptions.initialWaveform);
        this.synth.setPreset(ch, {sample});
      }
      this.inspector = new Ps1VoiceInspector(this.synth, {sampleRate});
      this.resampler = new Ps1Resampler(this.synth, sampleRate);
      this.port.postMessage({ready:true, sampleRate, nativeSampleRate:44100, state:this.inspector.read()});
    }).catch(error => this.fail(error));
  }

  receive(data) {
    const {id, method, args = []} = data ?? {};
    try {
      if (this.dead || !this.synth) throw new Error('SPU synth is not ready');
      if (!Array.isArray(args)) throw new TypeError('SPU command arguments must be an array');
      let value;
      if (method === 'inspect' || method === 'getState') value = this.inspector.read();
      else if (method === 'auditionOn') {
        // Validate the bent target before acquiring a manual note. Both pitch
        // writes happen in this message handler, with no render in between.
        const pitch = this.bentPitch(args[0], args[1], args[3] ?? 0);
        value = this.inspector.invoke(method, args.slice(0, 3));
        this.synth.setPitch(args[0], pitch);
      } else if (method === 'setPitchBend') {
        // The caller supplies the original MIDI note, avoiding cumulative
        // rounding/drift and allowing a Release tail to bend without KON.
        const pitch = this.bentPitch(args[0], args[1], args[2]);
        value = this.inspector.invoke('setPitch', [args[0], pitch]);
      }
      else if (method === 'getInstrument') {
        const preset = this.synth.getPreset(args[0]), sample = this.synth.samples[preset.sample];
        if (!sample) throw new Error('Assign an SPU sample before saving an instrument');
        const tuning = {adpcm:this.synth.sampleBytes[sample.id].slice(), baseFrequencyHz:sample.rootFrequencyHz};
        if (sample.loop) tuning.loopStartSamples = sample.loopStartSamples;
        const editor = this.synth.editorWaveforms[args[0]];
        value = {preset, sample:tuning, reverb:{...this.synth.reverb}, waveform:editor?.sample === sample.id ? editor.pcm.slice() : null};
      }
      else if (method === 'stop' || method === 'stopVoices') {
        this.inspector.resetAuditions();
        this.synth.stopVoices();
        this.resampler.reset(this.synth.core.nativeFrames);
        value = true;
      } else if (EDITOR_METHODS.has(method)) value = this.inspector.invoke(method, args);
      else if (SYNTH_METHODS.has(method)) value = this.synth[method](...args);
      else throw new Error(`Unknown SPU synth command: ${method}`);
      const reply = {id, value};
      // Snapshots are sent only after explicit requests or completed edits.
      // Audio blocks never send level/state updates to the UI.
      if (!READ_METHODS.has(method)) reply.state = this.inspector.read();
      this.port.postMessage(reply);
    } catch (error) {
      this.port.postMessage({id, error:String(error?.message ?? error), name:error?.name ?? 'Error'});
    }
  }

  bentPitch(channel, midi, semitones) {
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('MIDI note must be 0..127');
    if (!Number.isFinite(semitones) || semitones < -2 || semitones > 2) throw new RangeError('Pitch bend must be from -2 to 2 semitones');
    const preset = this.synth.getPreset(channel), sample = this.synth.samples[preset.sample];
    if (!sample) throw new Error('Assign an SPU ADPCM sample before using Keyboard');
    const pitch = Math.round(sample.basePitch * 440 * 2 ** ((midi - 69 + semitones) / 12) / sample.rootFrequencyHz);
    if (pitch < 1 || pitch > 0x3fff) throw new RangeError('Frequency is outside PS1 SPU PITCH range');
    return pitch;
  }

  fail(error) {
    if (this.dead) return;
    this.port.postMessage({fatal:true, error:String(error?.message ?? error)});
    this.dispose();
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.inspector?.resetAuditions();
    this.synth?.dispose();
    this.synth = null;
  }

  process(_inputs, outputs) {
    const left = outputs[0]?.[0], right = outputs[0]?.[1];
    if (!left || !right) return !this.dead;
    if (this.dead || !this.resampler) {left.fill(0); right.fill(0); return !this.dead;}
    try {this.resampler.render(left, right); return true;}
    catch (error) {left.fill(0); right.fill(0); this.fail(error); return false;}
  }
}

registerProcessor('tetorica-spu-synth', SpuSynthProcessor);
