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
import {planSpuInstrument,planSpuParameterEdit,SPU_PARAMETER_METHODS} from './spu_instrument_plan.js?v=spu-code-parameters-4';

import {validateHostPcm} from './spu_synth_long_audio.js';

const EDITOR_METHODS = new Set(['auditionOn', 'auditionOff', 'auditionAllOff', 'setWaveform', 'setPreset', 'setChannel', 'setEnvelope', 'setReverb', 'setPitch', 'setFrequency', 'setNote']);
const SYNTH_METHODS = new Set(['loadADPCM', 'getPreset', 'snapshot', 'noteOn', 'noteOff', 'keyOn', 'keyOff', 'allNotesOff', '_auditionKeyOn', '_auditionKeyOff', '_refreshEnvelope']);
const READ_METHODS = new Set(['inspect', 'getState', 'getEditorState', 'getPreset', 'getInstrument', 'getInstrumentSample', 'snapshot', 'findADPCM']);
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
    this.keyboardOwners=new Map();
    this.keyboardModulators=new Map();
    this.codePmonEdits=new Map();this.codeNoiseEdits=new Map();this.codeMorphEdits=new Map();
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
      const soundSelection=method==='applyInstrument';
      const parameterEdit=method==='editInstrument';
      const keyboardRequest=['instrumentNoteOn','instrumentNoteOff','instrumentAllNotesOff','setInstrumentPitchBend'].includes(method);
      // In particular a failed full-sample edit must not retire a borrowed
      // Code checkpoint, release notes or touch sample RAM.
      if(method==='setInstrumentSample'&&args.length===2){if(args[1] !==(this.codeCheckpoint?this.codeEpoch:null))throw codeCancelled();}
      if(method==='setInstrumentSample'&&(args.length<1||args.length>2))throw new TypeError('SPU full-sample edit requires one source and optional Code owner');
      const sampleEdit=method==='setInstrumentSample'?this.prepareInstrumentSampleEdit(args.slice(0,1)):null;
      if(this.codeCheckpoint&&!codeRequest&&!configuration&&!soundSelection&&!parameterEdit&&!keyboardRequest&&method!=='setInstrumentSample'&&!READ_METHODS.has(method))this.endCode();
      if (method === 'beginCode') {
        if(args.length)throw new TypeError('SPU Code start takes no arguments');
        value=this.beginCode();
      }
      else if(method==='code')value=this.invokeCode(...args);
      else if(method==='observeCode') {
        if(args.length)throw new TypeError('SPU Code observation takes no arguments');
        value=this.observeCode();
      }
      else if(soundSelection) {
        if(args.length!==2)throw new TypeError('SPU instrument selection needs a prepared sound and its owner');
        if(args[1] !== (this.codeCheckpoint?this.codeEpoch:null))throw codeCancelled();
        value=this.applyPreparedInstrument(args[0]);
      }
      else if(parameterEdit)value=this.editCodeInstrument(...args);
      else if(configuration) {
        if(args.length!==1||typeof args[0]!=='boolean')throw new TypeError('SPU Click guard must be boolean');
        // Apply only to the next gate operation; this transaction must not
        // touch a held note, its envelope, sample cursor or Code session.
        this.clickGuard=args[0];value=this.clickGuard;
      }
      else if (method === 'inspect' || method === 'getState') value = this.readState();
      else if(method==='getEditorState')value=this.readEditorState();
      else if (method === 'findADPCM') {
        if(args.length!==2)throw new TypeError('SPU sample lookup needs ADPCM bytes and tuning options');
        value=this.findADPCM(args[0],args[1]);
      }
      else if (method === 'getInstrumentSample') {
        if(args.length!==1)throw new TypeError('SPU sample read needs one channel');
        value=this.readInstrumentSample(args[0]);
      }
      else if (method === 'setInstrumentSample') {
        if(this.codeCheckpoint){
          const authored=this.readInstrument(0),saved=this.codeCheckpoint;
          this.applyPreparedInstrument({preset:(({sample,...preset})=>preset)(authored.preset),sample:{adpcm:sampleEdit.prepared.adpcm,baseFrequencyHz:sampleEdit.prepared.rootFrequencyHz,...(sampleEdit.prepared.loop?{loopStartSamples:sampleEdit.prepared.loopStartSamples}:{})},
            reverb:authored.reverb,pmon:authored.pmon,noise:authored.noise,morph:authored.morph,waveform:null,sampleEdit:true,
            pmonWaveform:authored.pmon.enabled?{pcm:saved.pmonWaveform,adpcm:saved.sampleBytes[saved.pmonSampleId]}:null,
            noiseWaveform:{pcm:saved.editorWaveforms[0].pcm,adpcm:saved.sampleBytes[saved.editorWaveforms[0].sample]}});
          value={sampleId:this.codeCheckpoint.channels[0].sample,token:this.instrumentSampleSource().token};
        }else value=this.applyInstrumentSampleEdit(sampleEdit);
      }
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
        const [midi, identity, bend = this.instrumentBend,selectedChannel=null] = args;
        if (typeof identity !== 'string' || !identity.length || identity.length > 128) throw new TypeError('Audition identity must contain 1..128 characters');
        if(selectedChannel!==null&&(!Number.isInteger(selectedChannel)||selectedChannel<0||selectedChannel>23))throw new RangeError('SPU keyboard channel must be 0..23');
        const channel = selectedChannel??this.carrierChannel(this.voices.peek());
        // The shared inspector also validates the unbent note before its
        // manual transition, so reject that failure before taking a slot.
        this.bentPitch(channel, midi, 0);
        const pitch = this.bentPitch(channel, midi, bend);
        // Validation precedes both the allocator mutation and manual KON.
        // No message or render can interleave the lease and pitch writes.
        const allocation = selectedChannel===null?this.voices.allocate(identity):{channel,stolen:null};
        const previous=this.inspector.auditions.get(channel);
        if(previous&&previous!==identity){this.voices.release(previous);this.inspector.auditions.delete(channel);}
        this.retireKeyboardChannel(channel);
        if (this.noiseFor(channel).enabled) {
          // Noise has no per-note PITCH. Use the same lease map and release
          // path, without the shared sample inspector's tuning validation.
          this.inspector.auditions.set(channel,identity);
          this.inspector.beginAudition(channel,`voice-editor:${identity}`);
          this.voiceKey(channel,true,this.clickGuard);
        } else this.inspector.invoke('auditionOn', [channel, midi, identity]);
        this.synth.setPitch(channel, pitch);
        const pairing=this.pmonFor(channel);
        if(pairing.settings.enabled){this.retireKeyboardChannel(channel-1);this.configureModulator(channel-1,midi,bend,pairing);this.physicalKey(channel-1,true,this.clickGuard);this.codeGates.delete(channel-1);this.keyboardModulators.set(channel-1,{id:identity,carrier:channel});}
        this.keyboardOwners.set(channel,identity);this.codeGates.delete(channel);
        this.lastMidi[channel] = midi;
        this.lastBend[channel] = bend;
        value = {channel, stolenId:previous??allocation.stolen?.id??null};
      } else if (method === 'instrumentNoteOff') {
        const found=[...this.keyboardOwners].find(([,id])=>id===args[0]);this.voices.release(args[0]);
        value=found?this.releaseInstrumentNote(found[0],args[0]):false;
      } else if (method === 'instrumentAllNotesOff') {
        for (const [ch,id]of [...this.keyboardOwners])this.releaseInstrumentNote(ch,id);
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
        for(let ch=1;ch<24;ch++)if(pitches[ch]!==null&&this.pmonFor(ch).settings.enabled)this.configureModulator(ch-1,notes[ch],args[0],this.pmonFor(ch));
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
      if (!codeRequest&&!configuration&&!parameterEdit&&!keyboardRequest&&!READ_METHODS.has(method)&&method!=='setInstrumentSample') this.syncModulators();
      const reply = {id, value};
      // Snapshots are sent only after explicit requests or completed edits.
      // Audio blocks never send level/state updates to the UI.
      if (!codeRequest&&!configuration&&!READ_METHODS.has(method)) reply.state = this.readEditorState();
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
    const slot=this.reusableSampleBackup(source,sample);
    const availableEditBytes=sample.samplePcmEditable||slot?sample.byteLength:524288-source.nextAddress;
    return {sampleId:sample.id,token,adpcm:bytes.slice(),byteLength:sample.byteLength,availableEditBytes,baseFrequencyHz:sample.rootFrequencyHz,
      ...(sample.loop?{loopStartSamples:sample.loopStartSamples}:{})};
  }

  reusableSampleBackup(source,sample) {
    const slotId=this.codeCheckpoint?source.samplePcmSlotId:this.samplePcmState().slotId,candidate=source.samples[slotId];
    if(!candidate?.samplePcmEditable||candidate.id===sample.id||candidate.byteLength!==sample.byteLength||
      source.channels.some(voice=>voice.sample===candidate.id))return null;
    // A saved author bank has no running voices (beginCode stops them first).
    // In the live bank, reject any programmed pointer into the spare slot,
    // including an unrelated voice or a separately configured PMON source.
    if(!this.codeCheckpoint)for(let ch=0;ch<24;ch++) {
      // Programmed Start can already describe the next key while the decoder
      // still runs the previous slot. Without a cursor API, any held/releasing
      // voice prevents spare reuse, even when the visible pointers moved away.
      if(this.synth.gates[ch]||this.synth.core.read(ch*16+12)>0)return null;
      for(const offset of [6,14]) {
        const address=this.synth.core.read(ch*16+offset)*8;
        if(address>=candidate.startAddress&&address<candidate.startAddress+candidate.byteLength)return null;
      }
    }
    return candidate;
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
    const backup=this.reusableSampleBackup(source,sample);
    if(!sample.samplePcmEditable&&!backup&&source.nextAddress+prepared.adpcm.length>524288)
      throw new RangeError('No sample RAM available for a private full-sample edit');
    return {prepared,original:{...sample},backupId:backup?.id??null};
  }

  applyInstrumentSampleEdit({prepared,original,backupId}) {
    // Inverted copy-on-write: live decoders keep physical address A. Preserve
    // the immutable original ID at backup B, then let a private ID own A.
    // No voice/register/owner, envelope, resampler or output history is reset.
    // Code edits retain their existing checkpoint restoration before this call.
    const synth=this.synth,core=synth.core,current=synth.samples[original.id],oldBytes=synth.sampleBytes[original.id];
    let slot=current;
    if(!original.samplePcmEditable) {
      const backup=backupId===null?null:synth.samples[backupId],address=backup?.startAddress??synth.nextAddress;
      const backupBytes=core.readRam(address,prepared.adpcm.length),count=synth.samples.length,nextAddress=synth.nextAddress;
      let storage=backup;
      try {
        if(storage)core.loadRam(oldBytes,address);
        else {
          const loaded=synth.loadADPCM(oldBytes,{baseFrequencyHz:original.rootFrequencyHz,...(original.loop?{loopStartSamples:original.loopStartSamples}:{})});
          storage=synth.samples[loaded.id];
        }
        core.loadRam(prepared.adpcm,original.startAddress);
      }catch(error) {
        // Native allocation/upload failures must not publish moved IDs or
        // consume a new logical slot. Restore bytes when the core still accepts
        // transfers; a terminal engine failure is handled by the audio host.
        try{core.loadRam(oldBytes,original.startAddress);core.loadRam(backupBytes,address);}catch{}
        synth.samples.length=count;synth.sampleBytes.length=count;synth.nextAddress=nextAddress;
        throw error;
      }
      const repeatOffset=original.repeatAddress-original.startAddress;
      Object.assign(current,{startAddress:address,repeatAddress:address+repeatOffset});
      Object.assign(storage,{...original,id:storage.id,startAddress:original.startAddress,repeatAddress:original.repeatAddress,samplePcmEditable:true});
      slot=storage;
      // The raw Start/Repeat already point at A. Only change the logical
      // descriptor binding; writing unchanged Repeat would force a live loop.
      for(const voice of synth.channels)if(voice.sample===original.id)voice.sample=slot.id;
    }else {
      try {core.loadRam(prepared.adpcm,slot.startAddress);}
      catch(error) {try{core.loadRam(oldBytes,slot.startAddress);}catch{}throw error;}
    }
    synth.sampleBytes[slot.id]=prepared.adpcm;
    Object.assign(slot,{rootNote:original.rootNote,rootFrequencyHz:prepared.rootFrequencyHz,basePitch:original.basePitch,
      loop:prepared.loop,loopStartSamples:prepared.loopStartSamples,decodedFrames:prepared.decodedFrames,
      repeatAddress:slot.startAddress+(prepared.loopStartSamples??0)/28*16,samplePcmEditable:true});
    this.samplePcmState().slotId=slot.id;
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

  noiseFor(ch){return this.codeCheckpoint&&this.codeNoiseEdits.has(ch)?this.codeNoiseEdits.get(ch):this.noise;}
  pmonFor(ch){return this.codeCheckpoint&&this.codePmonEdits.has(ch)?this.codePmonEdits.get(ch):{settings:{...this.pmon,enabled:this.pmon.enabled&&ch%2===1},sampleId:this.pmonSample?.id??null,waveform:this.pmonWaveform,private:false};}
  clearCodeEdits(){this.codePmonEdits.clear();this.codeNoiseEdits.clear();this.codeMorphEdits.clear();}
  hasKeyboardOwner(ch){return this.keyboardOwners.has(ch)||this.keyboardModulators.has(ch);}
  retireKeyboardChannel(ch){const id=this.keyboardOwners.get(ch);if(id){this.keyboardOwners.delete(ch);this.inspector.auditions.delete(ch);this.voices.release(id);if(this.keyboardModulators.get(ch-1)?.id===id)this.keyboardModulators.delete(ch-1);}this.keyboardModulators.delete(ch);this.lastMidi[ch]=null;this.lastBend[ch]=null;}
  retireChannel(ch){this.retireKeyboardChannel(ch);this.codeGates.delete(ch);this.physicalKey(ch,false,this.clickGuard);this.synth.gates[ch]=false;this.lastMidi[ch]=null;this.lastBend[ch]=null;}
  editCodeInstrument(session,target,method,args) {
    if(!this.codeCheckpoint||session!==this.codeEpoch)throw codeCancelled();
    if(target!==null&&(!Number.isInteger(target)||target<0||target>23))throw new RangeError('SPU Live channel must be 0..23');
    if(!SPU_PARAMETER_METHODS.includes(method))throw new TypeError('Unsupported SPU editor parameter');
    const targets=target===null?Array.from({length:24},(_,ch)=>ch):[target],synth=this.synth,core=synth.core;
    if(this.codeNoiseSample&&synth.samples[this.codeNoiseSample.id]!==this.codeNoiseSample)throw new Error('Temporary Noise loop belongs to an expired sample bank');
    if(method==='setInstrumentPmon'&&target===0&&args[0]?.enabled)throw new RangeError('CH1 has no preceding oscillator for PMON');
    const pair=this.pmonFor(target??1),noise=this.noiseFor(target??0);
    const source={...synth,pmon:pair.settings,noise,morph:this.codeMorphEdits.get(target)??this.morph,
      pmonSampleId:pair.sampleId,pmonWaveform:pair.waveform,hostAudio:this.hostAudio,hostSlotId:this.hostSlot?.id??null,noiseSupportSampleId:this.codeNoiseSample?.id};
    const fixedVolume=value=>{value&=0x7fff;return Math.max(-1,Math.min(1,(value&0x4000?value-0x8000:value)/0x3fff));};
    source.channels=synth.channels.map((preset,ch)=>({...preset,volumeLeft:fixedVolume(core.read(ch*16)),volumeRight:fixedVolume(core.read(ch*16+2)),
      pitch:core.read(ch*16+4)&0x3fff,adsr1:core.read(ch*16+8),adsr2:core.read(ch*16+10),reverb:Boolean(core.read(0x198+(ch>=16?2:0))&(1<<(ch%16)))}));
    // A depth edit must not overwrite the support sample of another carrier.
    if(method==='setInstrumentPmon'&&target!==null&&!pair.private&&(args[2]??Object.keys(args[0])).some(key=>['enabled','depth','waveform'].includes(key)))source.pmonSampleId=null;
    const live=planSpuParameterEdit(source,method,args,targets),author=planSpuParameterEdit(this.codeCheckpoint,method,args);
    // Preserve the musical frequency if a different-root sample becomes a
    // 112-frame cycle. Other scalar edits never write PITCH or gate registers.
    const waveEdit=method==='setInstrumentWaveform'||method==='setInstrumentMorph'&&live.morph.enabled;
    if(waveEdit)for(const ch of targets){
      const before=synth.samples.find(sample=>sample.startAddress===core.read(ch*16+6)*8)??synth.samples[synth.channels[ch].sample],after=live.samples[live.channels[ch].sample];
      const pitch=this.noiseFor(ch).enabled?4096:Math.round(core.read(ch*16+4)*(before?.rootFrequencyHz??after.rootFrequencyHz)/after.rootFrequencyHz);
      if(pitch<0||pitch>0x3fff)throw new RangeError('Frequency is outside the new SPU cycle pitch range');live.channels[ch].pitch=pitch;
    }
    const ram=live.writes.length?core.readRam():null;
    try{for(const {address,bytes}of live.writes)core.loadRam(bytes,address);}catch(error){if(ram)core.loadRam(ram,0);throw error;}
    for(const key of ['samples','sampleBytes','editorWaveforms','nextAddress'])synth[key]=live[key];
    if(this.codeNoiseSample)this.codeNoiseSample=synth.samples[this.codeNoiseSample.id];
    if(method==='setInstrumentPreset'||method==='setInstrumentEnvelope') {
      for(const ch of targets) {
        const old=synth.channels[ch],next=live.channels[ch],patch=method==='setInstrumentEnvelope'?{adsr1:next.adsr1,adsr2:next.adsr2}:args[0],base=ch*16;
        for(const [key,offset]of [['volumeLeft',0],['volumeRight',2],['pitch',4],['adsr1',8],['adsr2',10]])if(Object.hasOwn(patch,key))core.write(base+offset,key.startsWith('volume')?Math.round(next[key]*0x3fff)&0x7fff:next[key]);
        if(Object.hasOwn(patch,'reverb'))synth._writeReverbSend(ch,next.reverb);
        synth.channels[ch]=next;
        if(args[1]?.live!==false&&(old.adsr1!==next.adsr1||old.adsr2!==next.adsr2))core.refreshEnvelope?.(ch);
      }
    } else if(method==='setReverb'||method==='setInstrumentReverbPreset') {
      synth.setReverb(live.reverb);
      if(method==='setInstrumentReverbPreset')for(const ch of targets){synth.channels[ch]=live.channels[ch];synth._writeReverbSend(ch,live.channels[ch].reverb);}
    } else if(waveEdit) {
      for(const ch of targets){const next=live.channels[ch],sample=live.samples[next.sample];synth.channels[ch]=next;core.write(ch*16+6,sample.startAddress>>3);core.write(ch*16+14,sample.repeatAddress>>3);core.write(ch*16+4,next.pitch);}
      this.syncHostMask();
    }
    if(method==='setInstrumentWaveform'||method==='setInstrumentMorph')for(const ch of targets)this.codeMorphEdits.set(ch,live.morph);
    if(method==='setInstrumentNoise') {
      for(const ch of targets)if(synth.channels[ch].sample===null)synth.channels[ch]=live.channels[ch];
      const enabledChanged=(args[1]??Object.keys(args[0])).includes('enabled');
      if((args[1]??Object.keys(args[0])).includes('clock'))this.noise={...this.noise,clock:live.noise.clock};
      if(enabledChanged)for(const ch of targets){if(this.noiseFor(ch).enabled!==live.noise.enabled)this.retireChannel(ch);this.codeNoiseEdits.set(ch,{...live.noise});if(live.noise.enabled){const old=this.pmonFor(ch);this.codePmonEdits.set(ch,{...old,settings:{...old.settings,enabled:false}});}}
      if(enabledChanged&&!live.noise.enabled)for(const ch of targets){const preset=synth.channels[ch],sample=synth.samples[preset.sample];if(sample){core.write(ch*16+6,sample.startAddress>>3);core.write(ch*16+14,sample.repeatAddress>>3);core.write(ch*16+4,preset.pitch);}}
      this.syncModulators({noiseChannels:enabledChanged?targets:[],pmonChannels:[]});
    } else if(method==='setInstrumentPmon') {
      const carriers=target===null?targets.filter(ch=>ch%2===1):targets;
      for(const ch of carriers){const old=this.pmonFor(ch),forked=live.pmon.enabled&&old.settings.enabled&&old.sampleId!==live.pmonSampleId;
        if(old.settings.enabled!==live.pmon.enabled||forked){this.retireChannel(ch);this.retireChannel(ch-1);}
        this.codePmonEdits.set(ch,{settings:live.pmon,sampleId:live.pmonSampleId,waveform:live.pmonWaveform,private:target!==null&&(old.private||old.sampleId!==live.pmonSampleId)});
        if(live.pmon.enabled)this.codeNoiseEdits.set(ch,{...this.noiseFor(ch),enabled:false});}
      this.syncModulators({noiseChannels:[],pmonChannels:carriers});
    }
    const {writes:ignored,value:ignoredValue,...bank}=author;this.codeCheckpoint={...this.codeCheckpoint,...bank};
    if(live.writes.length){this.reviseInstrumentSample();this.codeCheckpoint.samplePcmRevision=this.samplePcmState().revision;}
    return live.value;
  }

  applyPreparedInstrument(value) {
    const saved=this.codeCheckpoint,synth=this.synth;
    const live=planSpuInstrument({...synth,pmon:this.pmon,noise:this.noise,morph:this.morph,
      pmonSampleId:this.pmonSample?.id??null,pmonWaveform:this.pmonWaveform,hostAudio:this.hostAudio,hostSlotId:this.hostSlot?.id??null,samplePcmSlotId:this.samplePcmState().slotId},value);
    // A script's temporary bank can be smaller OR larger than the authored
    // bank. Validate both before releasing even one held voice.
    const authored=saved?planSpuInstrument(saved,value):null;
    const core=synth.core,m=core.module;
    // Reserve native transfer memory / old bytes before changing voices. A
    // failed RAM upload restores touched bytes without retiring the client,
    // advancing the core, or replacing either bank's metadata.
    const oldRam=live.writes.length?core.readRam():null;
    let hostPtr=0;
    if(live.hostAudio) {
      if(typeof m._ps1_spu_set_host_pcm!=='function'||typeof m._ps1_spu_set_host_mask!=='function')throw new Error('Software audio is unavailable');
      hostPtr=m._malloc(live.hostAudio.pcm.byteLength);
      if(!hostPtr)throw new Error('Not enough memory for software audio');
    }
    try {
      for(const {address,bytes}of live.writes)core.loadRam(bytes,address);
      if(live.hostAudio) {
        const pcm=live.hostAudio.pcm;
        m.HEAPU8.set(new Uint8Array(pcm.buffer,pcm.byteOffset,pcm.byteLength),hostPtr);
        if(!m._ps1_spu_set_host_pcm(core.handle,hostPtr,pcm.length,Number(live.hostAudio.loop)))throw new Error('Not enough memory for software audio');
      }
    } catch(error) {
      if(oldRam)core.loadRam(oldRam,0);
      throw error;
    } finally {if(hostPtr)m._free(hostPtr);}
    this.stopInstrument();this.codeGates.clear();this.codeNoiseSample=null;this.clearCodeEdits();
    for(const key of ['samples','sampleBytes','editorWaveforms','channels','nextAddress'])synth[key]=live[key];
    this.pmon=live.pmon;this.noise=live.noise;this.morph=live.morph;
    this.pmonSample=live.pmonSampleId===null?null:synth.samples[live.pmonSampleId];this.pmonWaveform=live.pmonWaveform;
    this.hostAudio=live.hostAudio;this.hostSlot=live.hostSlotId===null?null:synth.samples[live.hostSlotId];
    this.voices=new SpuRoundRobinVoices(live.pmon.enabled?12:24);this.instrumentBend=0;
    core.write(0x190,0);core.write(0x192,0);
    for(let ch=0;ch<24;ch++)synth.setPreset(ch,live.channels[ch]);
    synth.setReverb(live.reverb);this.syncModulators();this.reviseInstrumentSample();
    this.samplePcmState().slotId=value.sampleEdit?live.channels[0].sample:null;
    if(authored) {
      const {writes:ignored,...bank}=authored;
      this.codeCheckpoint={...saved,...bank,samplePcmRevision:this.samplePcmState().revision,samplePcmSlotId:value.sampleEdit?authored.channels[0].sample:null};
    }
    return true;
  }

  beginCode() {
    this.endCode();this.stopInstrument();this.clearCodeEdits();this.syncModulators();
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
    this.codeNoiseSample=null;this.clearCodeEdits();
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
    if(method==='noteOff'&&this.hasKeyboardOwner(ch))return false;
    if(this.noiseFor(ch).enabled&&['setNote','setFrequency','noteOn'].includes(method)) {
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
      this.codeGates.clear();this.keyboardOwners.clear();this.keyboardModulators.clear();this.inspector.resetAuditions();this.clearCodeEdits();this.lastMidi.fill(null);this.lastBend.fill(null);this.voices.reset();
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
      this.retireKeyboardChannel(ch);this.codeGates.add(ch);
      if(this.pmonFor(ch).settings.enabled){this.retireKeyboardChannel(ch-1);this.configureCodeModulator(ch);this.physicalKey(ch-1,true,method==='noteOn'&&this.clickGuard);this.codeGates.add(ch-1);}
    }else if(['keyOff','noteOff'].includes(method)) {
      if(method==='keyOff')this.retireKeyboardChannel(ch);this.codeGates.delete(ch);
      if(this.pmonFor(ch).settings.enabled&&!this.hasKeyboardOwner(ch-1)){this.physicalKey(ch-1,false,method==='noteOff'&&this.clickGuard);this.codeGates.delete(ch-1);}
    }else if(method==='allNotesOff') {
      this.codeGates.clear();this.keyboardOwners.clear();this.keyboardModulators.clear();this.inspector.resetAuditions();this.voices.reset();
    }else if(this.pmonFor(ch).settings.enabled&&['setFrequency','setNote','setPitch','setPreset','setChannel'].includes(method))this.configureCodeModulator(ch);
    if(['setPreset','setChannel','reset'].includes(method))this.syncHostMask();
    if(this.noiseFor(ch).enabled&&['setPreset','setChannel'].includes(method))this.syncModulators({noiseChannels:[ch],pmonChannels:[]});
    return result;
  }

  configureCodeModulator(carrier) {
    const preset=this.synth.getPreset(carrier),sample=this.synth.samples[preset.sample];
    if(!sample||!this.synth.samples[this.pmonFor(carrier).sampleId])return;
    const hz=sample.rootFrequencyHz*preset.pitch/sample.basePitch;
    const midi=hz>0?69+12*Math.log2(hz/440):null;
    this.configureModulator(carrier-1,midi,0,this.pmonFor(carrier));
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
        reverb:Boolean(send[ch>=16?1:0]&(1<<(ch%16))),gate:this.codeGates.has(ch)||this.hasKeyboardOwner(ch),active:this.codeGates.has(ch)||this.hasKeyboardOwner(ch),waveform,rawRegisters,
        noise:this.noiseFor(ch).enabled,noiseClock:this.noise.clock,pmonSettings:{...this.pmonFor(ch).settings},morphSettings:readMorph(this.codeMorphEdits.get(ch)??this.morph),
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
  readEditorState() {
    const saved=this.codeCheckpoint;if(!saved)return this.readState();
    // Code's physical bank may have unrelated IDs and private patches. Keep
    // that observation in observeCode; keyboard replies must not replace the
    // authored controls shown by Live Off with a Code channel's settings.
    const model=Object.assign(Object.create(Ps1Synth.prototype),saved,{disposed:false,sampleRate:44100,channelCount:24,
      gates:Array(24).fill(false),core:{nativeFrames:this.synth.core.nativeFrames,read:()=>0}}),state=model.getState(),samplePcm=this.instrumentSampleSource();
    return {...state,kind:'ps1',sampleRate,nativeSampleRate:44100,channels:state.channels.map((voice,ch)=>{
      const sample=saved.samples[voice.sample];let adpcmPreview=null,adpcmPreviewUnavailable=null;
      if(sample&&!voice.waveform&&!saved.noise.enabled&&sample.editorChannel===undefined&&sample.id!==saved.hostSlotId&&sample.id!==saved.pmonSampleId){
        const preview=this.adpcmPreviews.read(saved.sampleBytes[sample.id]);adpcmPreview=preview.preview?{sample:sample.id,...preview.preview}:null;adpcmPreviewUnavailable=preview.unavailableReason;
      }
      return {...voice,channel:ch,active:false,type:'spu-adpcm',adpcmPreview,adpcmPreviewUnavailable};}),
      auditions:[...this.inspector.auditions].map(([channel,id])=>({channel,id})),clickGuard:this.clickGuard,
      hostAudio:saved.hostAudio?{frames:saved.hostAudio.pcm.length,duration:saved.hostAudio.pcm.length/44100,loop:saved.hostAudio.loop}:null,
      pmon:{...saved.pmon},noise:{...saved.noise},morph:readMorph(saved.morph),pmonSampleReserved:saved.pmonSampleId!==null,polyphony:saved.pmon.enabled?12:24,
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
  configureModulator(ch,midi,bend,pair=this.pmonFor(ch+1)) {
    const core=this.synth.core,sample=this.synth.samples[pair.sampleId],settings=pair.settings;
    if(!sample)return;
    const {adsr1,adsr2}=pmonAdsr(settings.decayMs,this.synth.getPreset(ch+1).adsr2);
    const pitch=midi===null?0:Math.max(1,Math.min(0x3fff,Math.round(4096*440*2**((midi-69+bend)/12)*settings.ratio/(44100/112))));
    for(const[offset,value]of[[0,0],[2,0],[4,pitch],[6,sample.startAddress>>3],[8,adsr1],[10,adsr2],[14,sample.repeatAddress>>3]])core.write(ch*16+offset,value);
  }
  syncHostMask() {
    const core=this.synth.core;let mask=0;
    if(this.hostAudio)for(let ch=0;ch<24;ch++)if(!this.noiseFor(ch).enabled&&!this.pmonFor(ch+1).settings.enabled&&this.synth.getPreset(ch).sample===this.hostSlot.id)mask|=1<<ch;
    core.module._ps1_spu_set_host_mask?.(core.handle,mask);
  }
  syncModulators({noiseChannels=null,pmonChannels=null}={}) {
    const core=this.synth.core,bound=this.codeNoiseSample,noiseSamples=Array(24).fill(null);let noiseMask=0,pmonMask=0;
    if(bound&&(!this.codeCheckpoint||this.synth.samples[bound.id]!==bound||!bound.loop))throw new Error('Temporary Noise loop belongs to an expired sample bank');
    for(let ch=0;ch<24;ch++) {
      if(this.noiseFor(ch).enabled){const sample=bound??this.synth.samples[this.synth.editorWaveforms[ch]?.sample];if(!sample?.loop)throw new Error('Noise needs valid looping voice samples');noiseSamples[ch]=sample;noiseMask|=1<<ch;}
      else if(ch>0&&this.pmonFor(ch).settings.enabled)pmonMask|=1<<ch;
    }
    this.syncHostMask();core.write(0x194,noiseMask&65535);core.write(0x196,noiseMask>>>16);
    core.write(0x1aa,(core.read(0x1aa)&~0x3f00)|((noiseMask?this.noise.clock:0)<<8));
    for(let ch=0;ch<24;ch++)if(noiseSamples[ch]&&(!noiseChannels||noiseChannels.includes(ch))){const sample=noiseSamples[ch];core.write(ch*16+6,sample.startAddress>>3);core.write(ch*16+14,sample.repeatAddress>>3);core.write(ch*16+4,4096);}
    core.write(0x190,pmonMask&65535);core.write(0x192,pmonMask>>>16);
    for(let ch=1;ch<24;ch++)if(pmonMask&(1<<ch)&&(!pmonChannels||pmonChannels.includes(ch))){
      if(this.codeCheckpoint)this.configureCodeModulator(ch);else this.configureModulator(ch-1,this.lastMidi[ch],this.lastBend[ch]??this.instrumentBend);
    }
  }
  releaseInstrumentNote(ch, id) {
    if(this.keyboardOwners.get(ch)!==id)return false;
    const released=this.inspector.invoke('auditionOff',[ch,id]);this.keyboardOwners.delete(ch);
    if(this.keyboardModulators.get(ch-1)?.id===id){this.keyboardModulators.delete(ch-1);if(released&&!this.codeGates.has(ch-1)&&!this.hasKeyboardOwner(ch-1))this.physicalKey(ch-1,false,this.clickGuard);}
    return released;
  }
  stopInstrument() {
    this.inspector.resetAuditions(); this.synth.stopVoices();
    this.resampler.reset(this.synth.core.nativeFrames);
    this.lastMidi.fill(null); this.lastBend.fill(null); this.voices.reset();this.keyboardOwners.clear();this.keyboardModulators.clear();
  }

  bentPitch(channel, midi, semitones) {
    if (this.noiseFor(channel).enabled) {
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
