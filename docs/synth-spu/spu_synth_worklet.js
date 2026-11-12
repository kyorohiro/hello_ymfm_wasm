// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
import factory from '../generated/ps1_spu_wasm.js?v=spu-long-audio-1';
import {Ps1Spu} from '../js/ps1_spu.js?v=ps1-deferred-release-1';
import {Ps1Synth,preparePs1ADPCM} from '../js/ps1synth.js?v=ps1-oneshot-marker-1';
import {Ps1Resampler} from '../js/ps1_resampler.js?v=ps1-mode-1';
import {Ps1VoiceInspector} from '../js/playground_ps1_inspector.js?v=ps1-oneshot-marker-1';
import {patchPs1Envelope,decodePs1Envelope} from '../js/ps1_parameters.js?v=ps1-voice-editor-1';
import {noteToHz} from '../js/soundchip_pitch.js';
import {SPU_SYNTH_MIX_HEADROOM} from './spu_synth_levels.js';
import {readMorph, morphPcm} from './spu_synth_morph.js';
import {readNoise} from './spu_synth_noise.js';
import {readPmon, pmonAdsr} from './spu_synth_pmon.js';
import {SpuRoundRobinVoices} from './spu_synth_voices.js?v=spu-synth-2';
import {createSpuAdpcmPreviewCache} from './spu_adpcm_preview.js';

import {validateHostPcm} from './spu_synth_long_audio.js';

const EDITOR_METHODS = new Set(['auditionOn', 'auditionOff', 'auditionAllOff', 'setWaveform', 'setPreset', 'setChannel', 'setEnvelope', 'setReverb', 'setPitch', 'setFrequency', 'setNote']);
const SYNTH_METHODS = new Set(['loadADPCM', 'getPreset', 'snapshot', 'noteOn', 'noteOff', 'keyOn', 'keyOff', 'allNotesOff', '_auditionKeyOn', '_auditionKeyOff', '_refreshEnvelope']);
const READ_METHODS = new Set(['inspect', 'getState', 'getPreset', 'getInstrument', 'getInstrumentSample', 'snapshot', 'findADPCM']);
const CODE_METHODS = new Set(['loadADPCM','getPreset','setPreset','setChannel','setEnvelope','setReverb','setPitch','setFrequency','setNote','keyOn','keyOff','noteOn','noteOff','allNotesOff','reset','getState','snapshot','_setAuditionNoise']);
const codeCancelled=()=>{const error=new Error('SPU Code session stopped');error.name='AbortError';return error;};

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
    // Host preference, separate from portable sound data and Code checkpoints.
    this.clickGuard = true;
    this.pmon = readPmon();
    this.noise = readNoise();
    this.morph = readMorph({enabled:true});
    this.pmonSample = null;
    this.hostAudio = null;
    this.hostSlot = null;
    this.pmonWaveform = null;
    this.codeEpoch = 0;
    this.codeCheckpoint = null;
    this.codeNoiseSample = null;
    this.codeGates = new Set();
    this.adpcmPreviews = createSpuAdpcmPreviewCache();
    // Full imported-sample edits own one private slot. Identity tokens are
    // independent of reusable numeric sample IDs and temporary Code banks.
    this.samplePcm = {sequence:0,revision:0,byteSequence:0,bytes:new WeakMap(),slotId:null};
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
      this.inspector = new Ps1VoiceInspector(this.synth, {sampleRate,dispatch:command=>{
        if(command.method==='_auditionKeyOn'||command.method==='_auditionKeyOff')
          return this.voiceKey(command.args[0],command.method==='_auditionKeyOn',this.clickGuard);
        return this.synth[command.method](...(command.args??[]));
      }});
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
      const codeRequest=['beginCode','code','observeCode'].includes(method);
      const configuration=method==='setClickGuard';
      // In particular a failed full-sample edit must not retire a borrowed
      // Code checkpoint, release notes or touch sample RAM.
      const sampleEdit=method==='setInstrumentSample'?this.prepareInstrumentSampleEdit(args):null;
      if(this.codeCheckpoint&&!codeRequest&&!configuration&&!READ_METHODS.has(method))this.endCode();
      if (method === 'beginCode') {
        if(args.length)throw new TypeError('SPU Code start takes no arguments');
        value=this.beginCode();
      }
      else if(method==='code')value=this.invokeCode(...args);
      else if(method==='observeCode') {
        if(args.length)throw new TypeError('SPU Code observation takes no arguments');
        value=this.observeCode();
      }
      else if(configuration) {
        if(args.length!==1||typeof args[0]!=='boolean')throw new TypeError('SPU Click guard must be boolean');
        // Apply only to the next gate operation; this transaction must not
        // touch a held note, its envelope, sample cursor or Code session.
        this.clickGuard=args[0];value=this.clickGuard;
      }
      else if (method === 'inspect' || method === 'getState') value = this.readState();
      else if (method === 'findADPCM') {
        if(args.length!==2)throw new TypeError('SPU sample lookup needs ADPCM bytes and tuning options');
        value=this.findADPCM(args[0],args[1]);
      }
      else if (method === 'getInstrumentSample') {
        if(args.length!==1)throw new TypeError('SPU sample read needs one channel');
        value=this.readInstrumentSample(args[0]);
      }
      else if (method === 'setInstrumentSample') value=this.applyInstrumentSampleEdit(sampleEdit);
      else if (method === 'loadHostPCM') {
        const pcm=validateHostPcm(args[0]),options=args[1];
        if (!options || typeof options.loop!=='boolean' || !Number.isFinite(options.baseFrequencyHz) || options.baseFrequencyHz<=0 || options.baseFrequencyHz>1000000) throw new TypeError('Invalid software audio tuning');
        if (options.loop && pcm.length<4) throw new RangeError('Software audio loops require at least 4 frames');
        const core=this.synth.core,m=core.module;
        if (typeof m._ps1_spu_set_host_pcm!=='function' || typeof m._ps1_spu_set_host_mask!=='function') throw new Error('Software audio is unavailable');
        // One shared, silent RAM placeholder retains the existing instrument
        // editor and tuning API. Audio data itself never occupies SPU RAM.
        if (!this.hostSlot) {
          const bytes=new Uint8Array(16);bytes[0]=12;bytes[1]=1;
          this.hostSlot=this.synth.loadADPCM(bytes,{baseFrequencyHz:options.baseFrequencyHz});
        }
        const ptr=m._malloc(pcm.byteLength);
        if (!ptr) throw new Error('Not enough memory for this recording');
        try {
          m.HEAPU8.set(new Uint8Array(pcm.buffer,pcm.byteOffset,pcm.byteLength),ptr);
          this.stopInstrument();
          if (!m._ps1_spu_set_host_pcm(core.handle,ptr,pcm.length,Number(options.loop))) throw new Error('Not enough memory for software audio');
        } finally {m._free(ptr);}
        const slot=this.synth.samples[this.hostSlot.id];
        this.hostSlot=slot;
        // The descriptor is shared, with independent native playback cursors.
        Object.assign(slot,{rootFrequencyHz:options.baseFrequencyHz,basePitch:4096,loop:options.loop,loopStartSamples:options.loop?0:null,decodedFrames:pcm.length});
        this.hostAudio={pcm,baseFrequencyHz:options.baseFrequencyHz,loop:options.loop};
        for (let ch=0;ch<24;ch++) this.authorChannel(ch,()=>this.inspector.invoke('setPreset',[ch,{sample:slot}]));
        this.morph={...this.morph,enabled:false};
        this.reviseInstrumentSample();
        value={frames:pcm.length,duration:pcm.length/44100};
      }
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
          this.voiceKey(channel,true,this.clickGuard);
        } else this.inspector.invoke('auditionOn', [channel, midi, identity]);
        this.synth.setPitch(channel, pitch);
        if (this.pmon.enabled) {this.configureModulator(channel-1, midi, bend); this.physicalKey(channel-1,true,this.clickGuard);}
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
          if (prepared.adpcm[1]!==6 || prepared.adpcm[17]!==0 || prepared.adpcm[33]!==0 || prepared.adpcm[49]!==3) throw new TypeError('PMON waveform must be four looping ADPCM packets');
          if (!this.pmonSample && this.synth.nextAddress+64 > 524288) throw new RangeError('No sample RAM available for PMON');
        }
        if (next.enabled && (!this.pmonSample || !this.pmon.enabled) && !prepared) throw new Error('Prepare the PMON waveform before enabling');
        if (next.enabled && (next.depth !== this.pmon.depth || next.waveform !== this.pmon.waveform) && this.pmonSample && !prepared) throw new Error('Prepare the PMON waveform for a depth change');
        if (prepared && (!this.pmonSample || next.depth !== this.pmon.depth || next.waveform !== this.pmon.waveform || next.enabled && !this.pmon.enabled)) {
          if (!this.pmonSample) this.pmonSample=this.synth.loadADPCM(prepared.adpcm,{baseFrequencyHz:44100/112,loopStartSamples:0});
          else {this.synth.core.loadRam(prepared.adpcm,this.pmonSample.startAddress); this.synth.sampleBytes[this.pmonSample.id]=prepared.adpcm.slice();}
          this.pmonWaveform=prepared.pcm.slice();
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
        if (method==='setInstrumentPreset' && patch.sample!==undefined) {
          this.morph={...this.morph,enabled:false};
          if (this.hostAudio && this.synth.getPreset(0).sample!==this.hostSlot.id) this.clearHostAudio();
          this.reviseInstrumentSample();
        }
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
          if (this.hostAudio) {this.stopInstrument();this.clearHostAudio();}
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
          this.reviseInstrumentSample();
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
        value=this.readInstrument(args[0]);
      }
      else if (method === 'stop' || method === 'stopVoices') {
        this.stopInstrument();
        value = true;
      } else if (EDITOR_METHODS.has(method)) {
        value = this.inspector.invoke(method, args);
        if(method==='setWaveform'||['setPreset','setChannel'].includes(method)&&args[1]?.sample!==undefined)this.reviseInstrumentSample();
      }
      else if (SYNTH_METHODS.has(method)) value = this.synth[method](...args);
      else throw new Error(`Unknown SPU synth command: ${method}`);
      if (!codeRequest&&!configuration&&!READ_METHODS.has(method)) this.syncModulators();
      const reply = {id, value};
      // Snapshots are sent only after explicit requests or completed edits.
      // Audio blocks never send level/state updates to the UI.
      if (!codeRequest&&!configuration&&!READ_METHODS.has(method)) reply.state = this.readState();
      this.port.postMessage(reply);
    } catch (error) {
      this.port.postMessage({id, error:String(error?.message ?? error), name:error?.name ?? 'Error'});
    }
  }

  // A portable preset can point back to an immutable sample already resident
  // in this bank. Never share editable cycles, PMON sources or host placeholders.
  // Query the current bank each time; Code reset/Stop can replace its resources.
  findADPCM(input,options) {
    const prepared=preparePs1ADPCM(input,options);
    for(const sample of this.synth.samples) {
      if(sample.editorChannel!==undefined||sample.samplePcmEditable||sample.id===this.pmonSample?.id||sample.id===this.hostSlot?.id||
        sample.byteLength!==prepared.adpcm.length||sample.rootFrequencyHz!==prepared.rootFrequencyHz||
        sample.basePitch!==prepared.basePitch||sample.loop!==prepared.loop||sample.loopStartSamples!==prepared.loopStartSamples)continue;
      const bytes=this.synth.sampleBytes[sample.id];
      if(bytes?.length===prepared.adpcm.length&&bytes.every((value,index)=>value===prepared.adpcm[index]))return {...sample};
    }
    return null;
  }

  samplePcmState() {
    // Also supports hosts which construct the processor before the optional
    // editor is used. Counters never rewind when a temporary bank is restored.
    return this.samplePcm??= {sequence:0,revision:0,byteSequence:0,bytes:new WeakMap(),slotId:null};
  }

  reviseInstrumentSample() {
    const state=this.samplePcmState();state.revision=++state.sequence;
  }

  sampleByteToken(bytes) {
    const state=this.samplePcmState();let token=state.bytes.get(bytes);
    if(token===undefined){token=++state.byteSequence;state.bytes.set(bytes,token);}
    return token;
  }

  instrumentSampleSource(ch=0) {
    if(!Number.isInteger(ch)||ch<0||ch>23)throw new RangeError('PS1 SPU channel must be 0..23');
    const source=this.codeCheckpoint??this.synth,settings=this.codeCheckpoint??this;
    const sample=source.samples[source.channels[ch]?.sample],bytes=sample&&source.sampleBytes[sample.id];
    const hostId=this.codeCheckpoint?source.hostSlotId:this.hostSlot?.id;
    const pmonId=this.codeCheckpoint?source.pmonSampleId:this.pmonSample?.id;
    if(!sample||!bytes||settings.noise.enabled||sample.editorChannel!==undefined||sample.id===hostId||sample.id===pmonId||source.editorWaveforms[ch]?.sample===sample.id)return null;
    const revision=this.codeCheckpoint?source.samplePcmRevision:this.samplePcmState().revision;
    return {source,sample,bytes,token:`${revision}:${sample.id}:${this.sampleByteToken(bytes)}`};
  }

  readInstrumentSample(ch) {
    const found=this.instrumentSampleSource(ch);
    if(!found)throw new Error('Select an imported ADPCM sample before editing its full waveform');
    const {source,sample,bytes,token}=found;
    const slotId=this.codeCheckpoint?source.samplePcmSlotId:this.samplePcmState().slotId,slot=source.samples[slotId];
    const availableEditBytes=slot?.samplePcmEditable&&slot.byteLength===sample.byteLength?slot.byteLength:524288-source.nextAddress;
    return {sampleId:sample.id,token,adpcm:bytes.slice(),byteLength:sample.byteLength,availableEditBytes,baseFrequencyHz:sample.rootFrequencyHz,
      ...(sample.loop?{loopStartSamples:sample.loopStartSamples}:{})};
  }

  prepareInstrumentSampleEdit(args) {
    const edit=args[0];
    if(args.length!==1||!edit||typeof edit!=='object'||Array.isArray(edit)||
      Reflect.ownKeys(edit).some(key=>!['sourceSampleId','sourceToken','adpcm'].includes(key)))throw new TypeError('SPU sample edit needs sourceSampleId, sourceToken and ADPCM bytes');
    const found=this.instrumentSampleSource();
    if(!found||edit.sourceSampleId!==found.sample.id||edit.sourceToken!==found.token)throw new Error('SPU sample changed; reopen its waveform before applying this edit');
    const {source,sample}=found,options={baseFrequencyHz:sample.rootFrequencyHz,...(sample.loop?{loopStartSamples:sample.loopStartSamples}:{})};
    const prepared=preparePs1ADPCM(edit.adpcm,options);
    if(prepared.adpcm.length!==sample.byteLength||prepared.loop!==sample.loop||prepared.loopStartSamples!==sample.loopStartSamples||prepared.rootFrequencyHz!==sample.rootFrequencyHz)
      throw new RangeError('A full-sample edit must preserve its length, tuning and loop');
    const slotId=this.codeCheckpoint?source.samplePcmSlotId:this.samplePcmState().slotId;
    const candidate=source.samples[slotId],slot=candidate?.samplePcmEditable&&candidate.byteLength===sample.byteLength?candidate:null;
    if(!slot&&source.nextAddress+prepared.adpcm.length>524288)throw new RangeError('No sample RAM available for a private full-sample edit');
    return {prepared,original:{...sample},slotId:slot?.id??null};
  }

  applyInstrumentSampleEdit({prepared,original,slotId}) {
    // Every failure above precedes this first audible mutation. No encoder or
    // decoder runs here; the preparation worker supplies complete packets.
    this.stopInstrument();
    let slot=slotId===null?null:this.synth.samples[slotId];
    if(!slot) {
      const loaded=this.synth.loadADPCM(prepared.adpcm,{baseFrequencyHz:prepared.rootFrequencyHz,...(prepared.loop?{loopStartSamples:prepared.loopStartSamples}:{})});
      slot=this.synth.samples[loaded.id];
    }else {
      this.synth.core.loadRam(prepared.adpcm,slot.startAddress);
      this.synth.sampleBytes[slot.id]=prepared.adpcm;
    }
    Object.assign(slot,{rootNote:original.rootNote,rootFrequencyHz:prepared.rootFrequencyHz,basePitch:original.basePitch,
      loop:prepared.loop,loopStartSamples:prepared.loopStartSamples,decodedFrames:prepared.decodedFrames,
      repeatAddress:slot.startAddress+(prepared.loopStartSamples??0)/28*16,samplePcmEditable:true});
    this.samplePcmState().slotId=slot.id;
    for(let ch=0;ch<24;ch++)this.authorChannel(ch,()=>this.inspector.invoke('setPreset',[ch,{sample:slot}]));
    this.reviseInstrumentSample();
    const {sample,token}=this.instrumentSampleSource();return {sampleId:sample.id,token};
  }

  readInstrument(ch) {
    if(!Number.isInteger(ch)||ch<0||ch>23)throw new RangeError('PS1 SPU channel must be 0..23');
    // Saving the editor sound while Code runs must never capture a temporary
    // script patch or its private sample uploads.
    const source=this.codeCheckpoint??this.synth,preset={...source.channels[ch]},sample=source.samples[preset.sample];
    if(!sample)throw new Error('Assign an SPU sample before saving an instrument');
    const host=this.codeCheckpoint?source.hostAudio:this.hostAudio,hostId=this.codeCheckpoint?source.hostSlotId:this.hostSlot?.id;
    const tuning=host&&sample.id===hostId?{...host}:{adpcm:source.sampleBytes[sample.id].slice(),baseFrequencyHz:sample.rootFrequencyHz};
    if(sample.loop&&!tuning.pcm)tuning.loopStartSamples=sample.loopStartSamples;
    const editor=source.editorWaveforms[ch],settings=this.codeCheckpoint??this;
    return {preset,sample:tuning,pmon:{...settings.pmon},noise:{...settings.noise},morph:readMorph(settings.morph),reverb:{...source.reverb},waveform:editor?.sample===sample.id?editor.pcm.slice():null};
  }

  beginCode() {
    this.endCode();this.stopInstrument();this.syncModulators();
    const synth=this.synth;
    // One bounded checkpoint per Run. Host PCM is immutable through the raw
    // PS1 API and remains shared; no recording-sized copy enters this path.
    const samplePcm=this.samplePcmState();
    this.codeCheckpoint={ram:synth.core.readRam(),samples:synth.samples.map(value=>({...value})),
      sampleBytes:synth.sampleBytes.map(value=>{const copy=value.slice();samplePcm.bytes.set(copy,this.sampleByteToken(value));return copy;}),editorWaveforms:synth.editorWaveforms.map(value=>value?{sample:value.sample,pcm:value.pcm.slice()}:null),
      channels:synth.channels.map(value=>({...value})),reverb:{...synth.reverb},nextAddress:synth.nextAddress,
      pmon:{...this.pmon},noise:{...this.noise},morph:readMorph(this.morph),pmonSampleId:this.pmonSample?.id??null,
      pmonWaveform:this.pmonWaveform?.slice()??null,hostAudio:this.hostAudio,hostSlotId:this.hostSlot?.id??null,
      samplePcmRevision:samplePcm.revision,samplePcmSlotId:samplePcm.slotId};
    this.codeEpoch++;this.codeGates.clear();
    return {session:this.codeEpoch,sampleRate,nativeSampleRate:44100,channelCount:24};
  }

  endCode() {
    const saved=this.codeCheckpoint;this.codeCheckpoint=null;this.codeEpoch++;this.codeGates.clear();
    this.codeNoiseSample=null;
    if(!saved)return false;
    this.inspector.resetAuditions();
    const synth=this.synth;
    synth.samples=saved.samples;synth.sampleBytes=saved.sampleBytes;synth.editorWaveforms=saved.editorWaveforms;
    synth.channels=saved.channels;synth.reverb=saved.reverb;synth.nextAddress=saved.nextAddress;
    synth.core.loadRam(saved.ram,0);
    this.pmon=saved.pmon;this.noise=saved.noise;this.morph=saved.morph;this.pmonWaveform=saved.pmonWaveform;
    this.pmonSample=saved.pmonSampleId===null?null:synth.samples[saved.pmonSampleId];
    this.hostAudio=saved.hostAudio;this.hostSlot=saved.hostSlotId===null?null:synth.samples[saved.hostSlotId];
    Object.assign(this.samplePcmState(),{revision:saved.samplePcmRevision,slotId:saved.samplePcmSlotId});
    this.stopInstrument();this.syncModulators();return true;
  }

  invokeCode(session,method,args=[]) {
    if(!this.codeCheckpoint||session!==this.codeEpoch)throw codeCancelled();
    if(!CODE_METHODS.has(method)||!Array.isArray(args))throw new TypeError('Unsupported SPU Code operation');
    if(method==='getState')return this.observeCode();
    if(method==='snapshot')return {...this.observeCode(),ram:this.synth.core.readRam(),registers:Uint16Array.from({length:512},(_,at)=>this.synth.core.read(at*2))};
    if(method==='_setAuditionNoise') {
      if(args.length!==2)throw new TypeError('Temporary Noise needs settings and a loaded loop sample ID');
      const next=readNoise(args[0]),sampleId=args[1];let sample=null;
      if(next.enabled) {
        if(this.pmon.enabled)throw new Error('Temporary Noise cannot use a PMON carrier');
        if(!Number.isInteger(sampleId)||sampleId<0||sampleId>=this.synth.samples.length)
          throw new RangeError('Temporary Noise needs an existing immutable loop sample');
        sample=this.synth.samples[sampleId];
        if(!sample.loop||sample.editorChannel!==undefined||sample.id===this.hostSlot?.id||sample.id===this.pmonSample?.id)
          throw new TypeError('Temporary Noise needs an existing immutable loop sample');
      }else if(sampleId!==null)throw new TypeError('Disabled temporary Noise takes a null sample ID');
      // Reset(clearRam) has no per-voice editor waveforms. Bind this one
      // already-validated immutable loop to the current lease, not to a
      // reusable numeric sample ID or the author's private waveform slots.
      this.codeNoiseSample=sample;this.noise=next;this.syncModulators();return {...next};
    }
    const ch=args[0];let result;
    if(this.noise.enabled&&['setNote','setFrequency','noteOn'].includes(method)) {
      if(!Number.isInteger(ch)||ch<0||ch>23)throw new RangeError('PS1 SPU channel must be 0..23');
      if(method==='setFrequency') {
        if(!Number.isFinite(args[1])||args[1]<=0)throw new RangeError('frequency must be positive finite Hz');
      }else if(method!=='noteOn'||args[1]!==undefined)noteToHz(args[1]);
      // Noise uses one global clock, not a sample's declared root pitch.
      if(method==='noteOn')result=this.voiceKey(ch,true,this.clickGuard);
    }else if(method==='noteOn') {
      if(args[1]!==undefined)this.synth.setNote(ch,args[1]);
      result=this.voiceKey(ch,true,this.clickGuard);
    }else if(method==='noteOff')result=this.voiceKey(ch,false,this.clickGuard);
    else if(method==='allNotesOff'&&this.clickGuard) {
      for(let voice=0;voice<24;voice++)this.voiceKey(voice,false,true);
    }else result=this.synth[method](...args);
    if(method==='reset') {
      this.codeGates.clear();this.lastMidi.fill(null);this.lastBend.fill(null);this.voices.reset();
      if(args[0]?.clearRam) {
        // A new Code bank can reuse numeric sample IDs. Retire all bindings
        // to the old bank instead of mistaking its new sample 0 for a host
        // recording or a PMON source. The authored checkpoint owns the old
        // immutable host PCM and restores its binding on Stop.
        this.hostAudio=null;this.hostSlot=null;this.pmonSample=null;this.pmonWaveform=null;this.codeNoiseSample=null;this.samplePcmState().slotId=null;
        this.pmon={...this.pmon,enabled:false};this.noise={...this.noise,enabled:false};this.morph={...this.morph,enabled:false};
      }
      this.resampler.reset(this.synth.core.nativeFrames);this.syncModulators();
    }else if(['keyOn','noteOn'].includes(method)) {
      this.codeGates.add(ch);
      if(this.pmon.enabled&&ch%2===1){this.configureCodeModulator(ch);this.physicalKey(ch-1,true,method==='noteOn'&&this.clickGuard);this.codeGates.add(ch-1);}
    }else if(['keyOff','noteOff'].includes(method)) {
      this.codeGates.delete(ch);
      if(this.pmon.enabled&&ch%2===1){this.physicalKey(ch-1,false,method==='noteOff'&&this.clickGuard);this.codeGates.delete(ch-1);}
    }else if(method==='allNotesOff') {
      this.codeGates.clear();
    }else if(this.pmon.enabled&&ch%2===1&&['setFrequency','setNote','setPitch','setPreset','setChannel'].includes(method))this.configureCodeModulator(ch);
    if(['setPreset','setChannel','reset'].includes(method))this.syncHostMask();
    if(this.noise.enabled&&['setPreset','setChannel'].includes(method))this.syncModulators();
    return result;
  }

  configureCodeModulator(carrier) {
    const preset=this.synth.getPreset(carrier),sample=this.synth.samples[preset.sample];
    if(!sample||!this.pmonSample)return;
    const hz=sample.rootFrequencyHz*preset.pitch/sample.basePitch;
    const midi=hz>0?69+12*Math.log2(hz/440):null;
    this.configureModulator(carrier-1,midi,0);
  }

  observeCode() {
    if(!this.codeCheckpoint)return null;
    const state=this.readState(),core=this.synth.core,send=[core.read(0x198),core.read(0x19a)];
    const volume=value=>{value&=0x7fff;return (value&0x4000?value-0x8000:value)/0x3fff;};
    return {...state,codeActive:true,hostAudio:state.hostAudio?{...state.hostAudio,sampleId:this.hostSlot?.id??null}:null,channels:state.channels.map((voice,ch)=>{
      const base=ch*16,rawRegisters=Array.from({length:8},(_,index)=>core.read(base+index*2));
      const address=rawRegisters[3]<<3,sample=this.synth.samples.find(value=>value.startAddress===address);
      const editor=this.synth.editorWaveforms[ch];
      const waveform=sample&&editor?.sample===sample.id?{sample:sample.id,pcm:editor.pcm.slice()}
        :sample&&this.pmonSample?.id===sample.id&&this.pmonWaveform?{sample:sample.id,pcm:this.pmonWaveform.slice()}:null;
      return {...voice,sample:sample?.id??null,volumeLeft:volume(rawRegisters[0]),volumeRight:volume(rawRegisters[1]),pitch:rawRegisters[2]&0x3fff,
        adsr1:rawRegisters[4],adsr2:rawRegisters[5],envelopeParameters:decodePs1Envelope(rawRegisters[4],rawRegisters[5]),
        reverb:Boolean(send[ch>=16?1:0]&(1<<(ch%16))),gate:this.codeGates.has(ch),active:this.codeGates.has(ch),waveform,rawRegisters,
        ...this.readAdpcmPreview(sample,waveform)};
    })};
  }

  clearHostAudio() {
    const c=this.synth.core;
    c.module._ps1_spu_set_host_mask(c.handle,0);
    c.module._ps1_spu_set_host_pcm(c.handle,0,0,0);
    this.hostAudio=null;
  }

  readAdpcmPreview(sample,waveform) {
    if(!sample||waveform||this.noise.enabled||sample.editorChannel!==undefined||sample.id===this.hostSlot?.id||sample.id===this.pmonSample?.id)
      return {adpcmPreview:null,adpcmPreviewUnavailable:null};
    const {preview,unavailableReason}=this.adpcmPreviews.read(this.synth.sampleBytes[sample.id]);
    return {adpcmPreview:preview?{sample:sample.id,...preview}:null,adpcmPreviewUnavailable:unavailableReason};
  }

  readState() {
    const state=this.inspector.read(),samplePcm=this.instrumentSampleSource();
    return {...state,channels:state.channels.map(voice=>({...voice,...this.readAdpcmPreview(this.synth.samples[voice.sample],voice.waveform)})),
      clickGuard:this.clickGuard,hostAudio:this.hostAudio?{frames:this.hostAudio.pcm.length,duration:this.hostAudio.pcm.length/44100,loop:this.hostAudio.loop}:null,
      pmon:{...this.pmon},noise:{...this.noise},morph:readMorph(this.morph),pmonSampleReserved:Boolean(this.pmonSample),polyphony:this.pmon.enabled?12:24,
      samplePcmSource:samplePcm?{sampleId:samplePcm.sample.id,token:samplePcm.token}:null};
  }
  voiceKey(ch,on,smooth) {
    return this.synth[smooth?(on?'_auditionKeyOn':'_auditionKeyOff'):(on?'keyOn':'keyOff')](ch);
  }
  physicalKey(ch,on,smooth) {
    // PMON sources have physical register patches instead of authored voice
    // presets. Do not overwrite their send/sample words via a Synth key call.
    if(smooth)return this.synth.core.auditionKey(ch,on);
    return this.synth.core.write((on?0x188:0x18c)+(ch>=16?2:0),1<<(ch%16));
  }
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
  syncHostMask() {
    const core=this.synth.core;
    let mask=0;
    if (this.hostAudio && !this.noise.enabled) for(let ch=0;ch<24;ch++) {
      if ((!this.pmon.enabled || ch%2) && this.synth.getPreset(ch).sample===this.hostSlot.id) mask|=1<<ch;
    }
    core.module._ps1_spu_set_host_mask?.(core.handle,mask);
  }
  syncModulators() {
    const core=this.synth.core;
    // Resolve every Noise loop before touching mode/mask words. A missing
    // editor slot or an obsolete temporary binding must not leave partial
    // NON/clock writes behind when validation fails.
    let noiseSamples=null;
    if(this.noise.enabled) {
      const bound=this.codeNoiseSample;
      if(bound&&(!this.codeCheckpoint||this.synth.samples[bound.id]!==bound||!bound.loop))
        throw new Error('Temporary Noise loop belongs to an expired sample bank');
      noiseSamples=Array.from({length:24},(_,ch)=>bound??this.synth.samples[this.synth.editorWaveforms[ch]?.sample]);
      if(noiseSamples.some(sample=>!sample?.loop))throw new Error('Noise needs valid looping voice samples');
    }
    this.syncHostMask();
    core.write(0x194,this.noise.enabled ? 0xffff : 0);
    core.write(0x196,this.noise.enabled ? 0xff : 0);
    core.write(0x1aa,(core.read(0x1aa)&~0x3f00)|((this.noise.enabled ? this.noise.clock : 0)<<8));
    if (this.noise.enabled) {
      core.write(0x190,0);core.write(0x192,0);
      // Preserve the authored PCM/audio sample. Use an editor's private loop
      // or the temporary lease's support loop, never a one-shot recording.
      for(let ch=0;ch<24;ch++) {
        const sample=noiseSamples[ch];
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
    if (released && this.pmon.enabled) this.physicalKey(ch-1,false,this.clickGuard);
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
    this.codeCheckpoint=null;this.codeNoiseSample=null;this.codeEpoch++;this.codeGates.clear();
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
