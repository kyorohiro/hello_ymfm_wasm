// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
import factory from '../generated/ps1_spu_wasm.js?v=spu-mix-precision-1';
import {Ps1Spu} from '../js/ps1_spu.js?v=ps1-deferred-release-1';
import {Ps1Synth} from '../js/ps1synth.js?v=ps1-deferred-release-1';
import {Ps1Resampler} from '../js/ps1_resampler.js?v=ps1-mode-1';
import {Ps1VoiceInspector} from '../js/playground_ps1_inspector.js?v=ps1-deferred-release-1';
import {patchPs1Envelope} from '../js/ps1_parameters.js?v=ps1-voice-editor-1';
import {SPU_SYNTH_MIX_HEADROOM} from './spu_synth_levels.js';
import {readMorph, morphPcm} from './spu_synth_morph.js';
import {readNoise} from './spu_synth_noise.js';
import {readPmon, pmonAdsr} from './spu_synth_pmon.js';
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
    this.pmon = readPmon();
    this.noise = readNoise();
    this.morph = readMorph();
    this.pmonSample = null;
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
      // Standalone software extension; the shared register/PCM JS API and its
      // default legacy mixer remain unchanged for other chip hosts.
      const headroom=core.module._ps1_spu_set_mix_headroom;
      if(typeof headroom!=='function'||!headroom(core.handle,SPU_SYNTH_MIX_HEADROOM))throw new Error('SPU precision mixer is unavailable');
      // The main thread prepares these bounded packets once. Each voice owns
      // its editable slot, so changing one cycle cannot affect a sibling.
      for (let ch = 0; ch < 24; ch++) {
        const sample = this.synth._setWaveformPrepared(ch, processorOptions.initialWaveform);
        this.synth.setPreset(ch, {sample});
      }
      this.inspector = new Ps1VoiceInspector(this.synth, {sampleRate});
      this.resampler = new Ps1Resampler(this.synth, sampleRate);
      this.syncModulators();
      this.port.postMessage({ready:true, sampleRate, nativeSampleRate:44100, state:this.readState()});
    }).catch(error => this.fail(error));
  }

  receive(data) {
    const {id, method, args = []} = data ?? {};
    try {
      if (this.dead || !this.synth) throw new Error('SPU synth is not ready');
      if (!Array.isArray(args)) throw new TypeError('SPU command arguments must be an array');
      let value;
      if (method === 'inspect' || method === 'getState') value = this.readState();
      else if (method === 'instrumentNoteOn') {
        const [midi, identity, bend = this.instrumentBend] = args;
        if (typeof identity !== 'string' || !identity.length || identity.length > 128) throw new TypeError('Audition identity must contain 1..128 characters');
        const channel = this.carrierChannel(this.voices.peek());
        // The shared inspector also validates the unbent note before its
        // manual transition, so reject that failure before taking a slot.
        this.bentPitch(channel, midi, 0);
        const pitch = this.bentPitch(channel, midi, bend);
        // Validation precedes both the allocator mutation and manual KON.
        // No message or render can interleave the lease and pitch writes.
        const allocation = this.voices.allocate(identity);
        if (this.noise.enabled) {
          // Noise has no per-note PITCH. Use the same lease map and release
          // path, without the shared sample inspector's tuning validation.
          this.inspector.auditions.set(channel,identity);
          this.inspector.beginAudition(channel,`voice-editor:${identity}`);
          this.synth._auditionKeyOn(channel);
        } else this.inspector.invoke('auditionOn', [channel, midi, identity]);
        this.synth.setPitch(channel, pitch);
        if (this.pmon.enabled) {this.configureModulator(channel-1, midi, bend); this.synth.core.auditionKey(channel-1, true);}
        this.lastMidi[channel] = midi;
        this.lastBend[channel] = bend;
        value = {channel, stolenId:allocation.stolen?.id ?? null};
      } else if (method === 'instrumentNoteOff') {
        const channel = this.voices.release(args[0]);
        value = channel === null ? false : this.releaseInstrumentNote(this.carrierChannel(channel), args[0]);
      } else if (method === 'instrumentAllNotesOff') {
        for (const entry of this.voices.entries()) this.releaseInstrumentNote(this.carrierChannel(entry.channel), entry.id);
        this.voices.reset();
        value = true;
      }
      else if (method === 'setInstrumentPmon') {
        const next = readPmon(args[0]);
        const prepared = args[1];
        // Validate depth packets, tuning and capacity before stopping any note.
        if (prepared) {
          if (!Array.isArray(prepared.pcm) || prepared.pcm.length !== 112 || prepared.pcm.some(x => !Number.isFinite(x) || Math.abs(x)>1) || !ArrayBuffer.isView(prepared.adpcm) || prepared.adpcm.length !== 64) throw new TypeError('Invalid PMON waveform packets');
          if ((prepared.adpcm[0]>>4)!==0 || prepared.adpcm[1]!==6 || prepared.adpcm[17]!==0 || prepared.adpcm[33]!==0 || prepared.adpcm[49]!==3) throw new TypeError('PMON waveform must be four looping ADPCM packets');
          if (!this.pmonSample && this.synth.nextAddress+64 > 524288) throw new RangeError('No sample RAM available for PMON');
        }
        if (next.enabled && (!this.pmonSample || !this.pmon.enabled) && !prepared) throw new Error('Prepare the PMON waveform before enabling');
        if (next.enabled && (next.depth !== this.pmon.depth || next.waveform !== this.pmon.waveform) && this.pmonSample && !prepared) throw new Error('Prepare the PMON waveform for a depth change');
        if (prepared && (!this.pmonSample || next.depth !== this.pmon.depth || next.waveform !== this.pmon.waveform || next.enabled && !this.pmon.enabled)) {
          if (!this.pmonSample) this.pmonSample=this.synth.loadADPCM(prepared.adpcm,{baseFrequencyHz:44100/112,loopStartSamples:0});
          else {this.synth.core.loadRam(prepared.adpcm,this.pmonSample.startAddress); this.synth.sampleBytes[this.pmonSample.id]=prepared.adpcm.slice();}
        }
        const topology = next.enabled !== this.pmon.enabled;
        if (topology) this.stopInstrument();
        this.pmon = next;
        if (next.enabled) this.noise={...this.noise,enabled:false};
        if (topology) this.voices = new SpuRoundRobinVoices(next.enabled ? 12 : 24);
        this.syncModulators();
        value = {...this.pmon};
      }
      else if (method === 'setInstrumentNoise') {
        const next=readNoise(args[0]);
        const topology=next.enabled!==this.noise.enabled;
        if (topology) this.stopInstrument();
        this.noise=next;
        if (next.enabled) this.pmon={...this.pmon,enabled:false};
        if (topology) this.voices=new SpuRoundRobinVoices(24);
        value={...this.noise};
      }
      else if (method === 'auditionOn') {
        if (this.pmon.enabled || this.noise.enabled) throw new Error('Use instrumentNoteOn for PMON or Noise voices');
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
        for (let ch = 0; ch < 24; ch++) this.authorChannel(ch, () => this.inspector.invoke(method === 'setInstrumentPreset' ? 'setPreset' : 'setEnvelope', [ch, patch, options]));
        if (method==='setInstrumentPreset' && patch.sample!==undefined) this.morph={...this.morph,enabled:false};
        value = true;
      } else if (method === 'setInstrumentWaveform' || method === 'setInstrumentMorph') {
        const nextMorph=method==='setInstrumentMorph' ? readMorph(args[0]) : null;
        if (nextMorph && !nextMorph.enabled) {this.morph=nextMorph;value={...this.morph};}
        else {
          const [prepared, options = {}] = nextMorph ? [args[1],{retrigger:false}] : args;
          if(nextMorph) {
            const pcm=morphPcm(nextMorph);
            if(!prepared || !Array.isArray(prepared.pcm) || prepared.pcm.length!==112 || pcm.some((x,i)=>x!==prepared.pcm[i]))throw new TypeError('Prepare matching Software morph waveform packets');
          }
          this.validateInstrumentOptions(options, true);
          // Each voice reuses the private editor slot allocated at startup.
          // One already-encoded cycle arrives in one message for all 24 slots.
          for (let ch = 0; ch < 24; ch++) {
            const slot = this.synth.editorWaveforms[ch];
            const sample = slot && this.synth.samples[slot.sample];
            if (!sample || sample.editorChannel !== ch || sample.byteLength !== 64) throw new Error('SPU instrument waveform slot is invalid');
          }
          const notes = this.activeNotes();
          const pitches = notes.map((midi, ch) => midi === null ? null : this.noise.enabled ? 4096 : this.pitchForSample(this.synth.samples[this.synth.editorWaveforms[ch].sample], midi, this.lastBend[ch] ?? this.instrumentBend));
          for (let ch = 0; ch < 24; ch++) {
            const sample = this.authorChannel(ch, () => this.inspector.invoke('setWaveform', [ch, prepared, options]));
            if (ch === 0) value = sample;
          }
          // Imported audio can have a different root frequency. Retune each
          // current note to the new private cycle before another audio block,
          // retaining its original MIDI note and explicit/global bend.
          for (let ch = 0; ch < 24; ch++) if (pitches[ch] !== null) this.inspector.invoke('setPitch', [ch, pitches[ch]]);
          this.lastMidi = notes;
          for (let ch = 0; ch < 24; ch++) if (notes[ch] === null) this.lastBend[ch] = null;
          this.morph=nextMorph ?? {...this.morph,enabled:false};
          if(nextMorph)value={...this.morph};
        }
      }
      else if (method === 'setInstrumentReverbPreset') {
        const patch=args[0];
        this.synth._reverb(patch);
        if (typeof patch.preset!=='string') throw new TypeError('Choose an SPU reverb preset');
        const enabled=patch.preset!=='off';
        // One audio-thread transaction: select the effect and change every
        // carrier send before another render or state reply can interleave.
        this.inspector.invoke('setReverb',[patch]);
        for(let ch=0;ch<24;ch++) this.authorChannel(ch,()=>this.inspector.invoke('setPreset',[ch,{reverb:enabled}]));
        value=true;
      }
      else if (method === 'getInstrument') {
        const preset = this.synth.getPreset(args[0]), sample = this.synth.samples[preset.sample];
        if (!sample) throw new Error('Assign an SPU sample before saving an instrument');
        const tuning = {adpcm:this.synth.sampleBytes[sample.id].slice(), baseFrequencyHz:sample.rootFrequencyHz};
        if (sample.loop) tuning.loopStartSamples = sample.loopStartSamples;
        const editor = this.synth.editorWaveforms[args[0]];
        value = {preset, sample:tuning, pmon:{...this.pmon}, noise:{...this.noise}, morph:readMorph(this.morph), reverb:{...this.synth.reverb}, waveform:editor?.sample === sample.id ? editor.pcm.slice() : null};
      }
      else if (method === 'stop' || method === 'stopVoices') {
        this.stopInstrument();
        value = true;
      } else if (EDITOR_METHODS.has(method)) value = this.inspector.invoke(method, args);
      else if (SYNTH_METHODS.has(method)) value = this.synth[method](...args);
      else throw new Error(`Unknown SPU synth command: ${method}`);
      if (!READ_METHODS.has(method)) this.syncModulators();
      const reply = {id, value};
      // Snapshots are sent only after explicit requests or completed edits.
      // Audio blocks never send level/state updates to the UI.
      if (!READ_METHODS.has(method)) reply.state = this.readState();
      this.port.postMessage(reply);
    } catch (error) {
      this.port.postMessage({id, error:String(error?.message ?? error), name:error?.name ?? 'Error'});
    }
  }

  readState() {return {...this.inspector.read(), pmon:{...this.pmon}, noise:{...this.noise}, morph:readMorph(this.morph), pmonSampleReserved:Boolean(this.pmonSample), polyphony:this.pmon.enabled ? 12 : 24};}
  carrierChannel(slot) {return this.pmon.enabled ? slot*2+1 : slot;}
  authorChannel(ch, apply) {
    if (!this.pmon.enabled || ch%2) return apply();
    // Keep one canonical authored instrument in every slot. Even channels
    // are physically configured as modulators only while pairing is enabled.
    const core=this.synth.core, write=core.write, refresh=core.refreshEnvelope;
    core.write=()=>{}; core.refreshEnvelope=()=>{};
    try {return apply();} finally {core.write=write; core.refreshEnvelope=refresh;}
  }
  configureModulator(ch, midi, bend) {
    const core=this.synth.core, sample=this.pmonSample;
    const {adsr1,adsr2}=pmonAdsr(this.pmon.decayMs,this.synth.getPreset(ch+1).adsr2);
    const pitch=midi===null ? 0 : Math.max(1,Math.min(0x3fff,Math.round(4096*440*2**((midi-69+bend)/12)*this.pmon.ratio/(44100/112))));
    for (const [offset,value] of [[0,0],[2,0],[4,pitch],[6,sample.startAddress>>3],[8,adsr1],[10,adsr2],[14,sample.repeatAddress>>3]]) core.write(ch*16+offset,value);
  }
  syncModulators() {
    const core=this.synth.core;
    core.write(0x194,this.noise.enabled ? 0xffff : 0);
    core.write(0x196,this.noise.enabled ? 0xff : 0);
    core.write(0x1aa,(core.read(0x1aa)&~0x3f00)|((this.noise.enabled ? this.noise.clock : 0)<<8));
    if (this.noise.enabled) {
      core.write(0x190,0);core.write(0x192,0);
      // Preserve the authored PCM/audio sample. Noise uses the existing
      // private looping slot so a one-shot recording cannot end a noise note.
      for(let ch=0;ch<24;ch++) {
        const sample=this.synth.samples[this.synth.editorWaveforms[ch].sample];
        core.write(ch*16+6,sample.startAddress>>3);
        core.write(ch*16+14,sample.repeatAddress>>3);
        core.write(ch*16+4,4096);
      }
    }
    if (!this.pmon.enabled) return;
    // Odd voices consume the preceding even voice's post-envelope OUTX.
    this.synth.core.write(0x190,0xaaaa); this.synth.core.write(0x192,0xaa);
    for (let ch=0;ch<24;ch+=2) this.configureModulator(ch,this.lastMidi[ch+1],this.lastBend[ch+1] ?? this.instrumentBend);
  }
  releaseInstrumentNote(ch, id) {
    const released=this.inspector.invoke('auditionOff',[ch,id]);
    if (released && this.pmon.enabled) this.synth.core.auditionKey(ch-1,false);
    return released;
  }
  stopInstrument() {
    this.inspector.resetAuditions(); this.synth.stopVoices();
    this.resampler.reset(this.synth.core.nativeFrames);
    this.lastMidi.fill(null); this.lastBend.fill(null); this.voices.reset();
  }

  bentPitch(channel, midi, semitones) {
    if (this.noise.enabled) {
      if (!Number.isInteger(midi) || midi<0 || midi>127) throw new RangeError('MIDI note must be 0..127');
      this.validateBend(semitones);return 4096;
    }
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
