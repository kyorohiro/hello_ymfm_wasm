// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
import factory from '../generated/ps1_spu_wasm.js?v=ps1-deferred-release-1';
import {Ps1Spu} from '../js/ps1_spu.js?v=ps1-deferred-release-1';
import {Ps1Synth} from '../js/ps1synth.js?v=ps1-deferred-release-1';
import {Ps1Resampler} from '../js/ps1_resampler.js?v=ps1-mode-1';
import {Ps1VoiceInspector} from '../js/playground_ps1_inspector.js?v=ps1-deferred-release-1';
import {patchPs1Envelope} from '../js/ps1_parameters.js?v=ps1-voice-editor-1';
import {SpuRoundRobinVoices} from './spu_synth_voices.js?v=spu-synth-2';

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
    this.lastMidi = Array(24).fill(null);
    this.lastBend = Array(24).fill(null);
    this.instrumentBend = 0;
    this.voices = new SpuRoundRobinVoices();
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
      else if (method === 'instrumentNoteOn') {
        const [midi, identity, bend = this.instrumentBend] = args;
        if (typeof identity !== 'string' || !identity.length || identity.length > 128) throw new TypeError('Audition identity must contain 1..128 characters');
        const channel = this.voices.peek();
        // The shared inspector also validates the unbent note before its
        // manual transition, so reject that failure before taking a slot.
        this.bentPitch(channel, midi, 0);
        const pitch = this.bentPitch(channel, midi, bend);
        // Validation precedes both the allocator mutation and manual KON.
        // No message or render can interleave the lease and pitch writes.
        const allocation = this.voices.allocate(identity);
        this.inspector.invoke('auditionOn', [allocation.channel, midi, identity]);
        this.synth.setPitch(allocation.channel, pitch);
        this.lastMidi[allocation.channel] = midi;
        this.lastBend[allocation.channel] = bend;
        value = {channel:allocation.channel, stolenId:allocation.stolen?.id ?? null};
      } else if (method === 'instrumentNoteOff') {
        const channel = this.voices.release(args[0]);
        value = channel === null ? false : this.inspector.invoke('auditionOff', [channel, args[0]]);
      } else if (method === 'instrumentAllNotesOff') {
        for (const entry of this.voices.entries()) this.inspector.invoke('auditionOff', [entry.channel, entry.id]);
        this.voices.reset();
        value = true;
      }
      else if (method === 'auditionOn') {
        // Validate the bent target before acquiring a manual note. Both pitch
        // writes happen in this message handler, with no render in between.
        const pitch = this.bentPitch(args[0], args[1], args[3] ?? this.instrumentBend);
        value = this.inspector.invoke(method, args.slice(0, 3));
        this.synth.setPitch(args[0], pitch);
        this.lastMidi[args[0]] = args[1];
        this.lastBend[args[0]] = args[3] ?? this.instrumentBend;
      } else if (method === 'setPitchBend') {
        // The caller supplies the original MIDI note, avoiding cumulative
        // rounding/drift and allowing a Release tail to bend without KON.
        const pitch = this.bentPitch(args[0], args[1], args[2]);
        value = this.inspector.invoke('setPitch', [args[0], pitch]);
        if (this.lastMidi[args[0]] !== null) {
          this.lastMidi[args[0]] = args[1];
          this.lastBend[args[0]] = args[2];
        }
      } else if (method === 'setInstrumentPitchBend') {
        this.validateBend(args[0]);
        // Include released notes while their decoder/envelope may still run.
        // Compute all targets before changing any voice or the stored bend.
        const notes = this.activeNotes();
        const pitches = notes.map((midi, ch) => midi === null ? null : this.bentPitch(ch, midi, args[0]));
        for (let ch = 0; ch < 24; ch++) if (pitches[ch] !== null) this.inspector.invoke('setPitch', [ch, pitches[ch]]);
        this.lastMidi = notes;
        this.lastBend = notes.map(midi => midi === null ? null : args[0]);
        this.instrumentBend = args[0];
        value = true;
      } else if (method === 'setInstrumentEnvelope' || method === 'setInstrumentPreset') {
        const [patch, options = {}] = args;
        this.validateInstrumentOptions(options);
        // Validate the entire instrument before applying a patch. In
        // particular a private waveform ID cannot be shared between voices.
        for (let ch = 0; ch < 24; ch++) {
          if (method === 'setInstrumentPreset') this.synth._preset(ch, patch);
          else {
            const preset = this.synth.getPreset(ch);
            patchPs1Envelope(preset.adsr1, preset.adsr2, patch);
          }
        }
        for (let ch = 0; ch < 24; ch++) this.inspector.invoke(method === 'setInstrumentPreset' ? 'setPreset' : 'setEnvelope', [ch, patch, options]);
        value = true;
      } else if (method === 'setInstrumentWaveform') {
        const [prepared, options = {}] = args;
        this.validateInstrumentOptions(options, true);
        // Each voice reuses the private editor slot allocated at startup.
        // One already-encoded cycle arrives in one message for all 24 slots.
        for (let ch = 0; ch < 24; ch++) {
          const slot = this.synth.editorWaveforms[ch];
          const sample = slot && this.synth.samples[slot.sample];
          if (!sample || sample.editorChannel !== ch || sample.byteLength !== 64) throw new Error('SPU instrument waveform slot is invalid');
        }
        const notes = this.activeNotes();
        const pitches = notes.map((midi, ch) => midi === null ? null : this.pitchForSample(this.synth.samples[this.synth.editorWaveforms[ch].sample], midi, this.lastBend[ch] ?? this.instrumentBend));
        for (let ch = 0; ch < 24; ch++) {
          const sample = this.inspector.invoke('setWaveform', [ch, prepared, options]);
          if (ch === 0) value = sample;
        }
        // Imported audio can have a different root frequency. Retune each
        // current note to the new private cycle before another audio block,
        // retaining its original MIDI note and explicit/global bend.
        for (let ch = 0; ch < 24; ch++) if (pitches[ch] !== null) this.inspector.invoke('setPitch', [ch, pitches[ch]]);
        this.lastMidi = notes;
        for (let ch = 0; ch < 24; ch++) if (notes[ch] === null) this.lastBend[ch] = null;
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
        this.lastMidi.fill(null);
        this.lastBend.fill(null);
        this.voices.reset();
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
    const preset = this.synth.getPreset(channel), sample = this.synth.samples[preset.sample];
    return this.pitchForSample(sample, midi, semitones);
  }

  pitchForSample(sample, midi, semitones) {
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('MIDI note must be 0..127');
    this.validateBend(semitones);
    if (!sample) throw new Error('Assign an SPU ADPCM sample before using Keyboard');
    const pitch = Math.round(sample.basePitch * 440 * 2 ** ((midi - 69 + semitones) / 12) / sample.rootFrequencyHz);
    if (pitch < 1 || pitch > 0x3fff) throw new RangeError('Frequency is outside PS1 SPU PITCH range');
    return pitch;
  }

  activeNotes() {
    // A released voice is a bend target until its envelope actually reaches
    // zero. Finished notes must not block later changes with stale tuning.
    return this.lastMidi.map((midi, ch) => midi !== null && (this.synth.gates[ch] || this.synth.core.read(ch * 16 + 12) > 0) ? midi : null);
  }

  validateBend(semitones) {
    if (!Number.isFinite(semitones) || semitones < -2 || semitones > 2) throw new RangeError('Pitch bend must be from -2 to 2 semitones');
  }

  validateInstrumentOptions(value, waveform = false) {
    const key = waveform ? 'retrigger' : 'live';
    if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).some(name => name !== key) || value[key] !== undefined && typeof value[key] !== 'boolean') throw new TypeError(`Expected {${key}?:boolean}`);
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
