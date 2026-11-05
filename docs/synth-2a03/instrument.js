// SPDX-License-Identifier: BSD-3-Clause
import {NesApuSynth, NesApuDirectTransport} from '../js/nesapusynth.js';
import {createDefaultPreset, readPreset} from './preset.js';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const poolFor = preset => preset.source === 'pulse' ? [0, 1] : preset.source === 'triangle' ? [2] : preset.source === 'noise' ? [3] : preset.source === 'dmc' ? [4] : [5];
const quietSweep = {enabled: false, period: 0, negate: true, shift: 0};

/** Host keyboard allocation around one physical NES APU and FDS expansion. */
export class NesInstrument {
  constructor(core) {
    if (!core || typeof core.generateStereo !== 'function' || typeof core.writeRegister !== 'function' || !core.fdsEnabled) throw new TypeError('Expected an NES APU with FDS enabled');
    this.core = core; this.synth = new NesApuSynth({transport: new NesApuDirectTransport(core), fds: true});
    this.preset = createDefaultPreset(); this.pitch = 0; this.cursor = 0; this.sequence = 0;
    this.voices = new Map(); this.slots = Array(6).fill(null); this.disposed = false;
    this._apply(null, this.preset); this.stop();
  }
  _open() {if (this.disposed) throw new Error('NES instrument is disposed');}
  _frequency(midi, pitch = this.pitch, source = this.preset.source) {
    const hz = 440 * 2 ** ((midi - 69 + pitch) / 12);
    const period = source === 'fds' ? Math.round(hz * 4194304 / this.synth.clock)
      : Math.round(this.synth.clock / ((source === 'triangle' ? 32 : 16) * hz) - 1);
    if (period < (source === 'fds' ? 1 : 8) || period > (source === 'fds' ? 4095 : 2047)) throw new RangeError(`Note is outside the NES ${source} frequency range`);
    return {hz, period};
  }
  _pulseVoice(channel, preset, {live = false} = {}) {
    const {duty, volume, envelope, sweep, lengthHalt} = preset.pulse;
    const base = 0x4000 + channel * 4, active = this.synth._getState().registers[channel * 4];
    // Envelope, shared loop/length halt and Sweep wait for the next attack.
    // Live fixed-volume/Duty editing must preserve the active shared bit,
    // rather than using the public fixed-volume helper that always sets it.
    const control = live
      ? (active & 16) && !envelope.enabled ? (active & 0x30) | volume : active & 0x3f
      : ((envelope.enabled ? envelope.loop : lengthHalt) ? 32 : 0) | (envelope.enabled ? envelope.period : 16 | volume);
    this.synth.writeRegister(base, ([.125, .25, .5, .75].indexOf(duty) << 6) | control);
    if (!live) {
      const value = sweep.enabled ? sweep : quietSweep;
      this.synth.writeRegister(base + 1, (value.enabled ? 128 : 0) | (value.period << 4) | (value.negate ? 8 : 0) | value.shift);
    }
  }
  _noiseVoice(preset, {live = false} = {}) {
    const {volume, period, shortMode, envelope, lengthHalt} = preset.noise;
    const active = this.synth._getState().registers[0x0c], constantVolume = Boolean(active & 16);
    // Match Pulse editing: keep a held envelope's mode and decay state until
    // the next attack. LFSR clock/mode remain live without a trigger write.
    if (!live || constantVolume && !envelope.enabled) {
      this.synth.writeRegister(0x400c, live ? (active & 0x30) | volume
        : ((envelope.enabled ? envelope.loop : lengthHalt) ? 32 : 0) | (envelope.enabled ? envelope.period : 16 | volume));
    }
    this.synth.writeRegister(0x400e, (shortMode ? 128 : 0) | period);
  }
  _fdsVolume(preset, {live = false} = {}) {
    const {volume, master, envelope} = preset.fds;
    const constantVolume = Boolean(this.synth._getState().registers[0x80] & 128);
    // setVolume writes fixed gain, so an active or pending envelope must keep
    // its mode, seed and timer until a new key. Master scale alone stays live.
    if (!live || constantVolume && !envelope.enabled) this.synth.fds.setVolume(volume, master);
    else this.synth.writeRegister(0x4089, master);
  }
  _fdsDepth(preset, {live = false} = {}) {
    const {depth, envelope} = preset.fds.modulation;
    const constantDepth = Boolean(this.synth._getState().registers[0x84] & 128);
    // The depth envelope has its own divider. Live FM clock / bias changes
    // must not rewrite its control or reset that divider's current phase.
    if (!live || constantDepth && !envelope.enabled) this.synth.writeRegister(0x4084, 128 | depth);
  }
  _triangleControl(preset) {
    const {control, linearReload} = preset.triangle;
    this.synth.writeRegister(0x4008, (control ? 128 : 0) | linearReload);
  }
  _apply(previous, next) {
    const changed = (path, value) => !previous || !equal(path(previous), value);
    if (changed(p => p.pulse, next.pulse)) for (let channel = 0; channel < 2; channel++) this._pulseVoice(channel, next, {live: Boolean(this.slots[channel])});
    // Authored gate settings wait for a fresh attack while a key owns CH3,
    // including after a hardware counter has already stopped its sequencer.
    if (changed(p => p.triangle, next.triangle) && !this.slots[2]) this._triangleControl(next);
    if (changed(p => p.noise, next.noise)) this._noiseVoice(next, {live:Boolean(this.slots[3])});
    if (changed(p => p.dmc.data, next.dmc.data) && next.dmc.data.length) {
      // This instrument runs inside the Worklet with a DirectTransport, so
      // the public low-level memory upload completes synchronously. Padding
      // matches dmc.loadSample(), without introducing a Promise into commands.
      const length = Math.ceil((next.dmc.data.length - 1) / 16) * 16 + 1;
      const bytes = new Uint8Array(length).fill(0xaa); bytes.set(next.dmc.data);
      this.synth.loadMemory(bytes, 0xc000);
    }
    if (changed(p => [p.dmc.rate, p.dmc.loop], [next.dmc.rate, next.dmc.loop])) this.synth.writeRegister(0x4010, (next.dmc.loop ? 64 : 0) | next.dmc.rate);
    if (changed(p => p.fds.wave, next.fds.wave)) this.synth.fds.setWave(next.fds.wave);
    if (changed(p => [p.fds.volume, p.fds.master, p.fds.envelope], [next.fds.volume, next.fds.master, next.fds.envelope])) this._fdsVolume(next, {live:Boolean(this.slots[5])});
    const mod = next.fds.modulation;
    if (changed(p => p.fds.modulation.table, mod.table)) this.synth.fds.setModulation(mod);
    else {
      // Avoid rewriting the modulation RAM and resetting its clock for an
      // ordinary rate/depth/bias adjustment on a held FDS note.
      if (changed(p => [p.fds.modulation.depth, p.fds.modulation.envelope], [mod.depth, mod.envelope])) this._fdsDepth(next, {live:Boolean(this.slots[5])});
      if (changed(p => p.fds.modulation.bias, mod.bias)) this.synth.writeRegister(0x4085, mod.bias & 127);
      if (changed(p => p.fds.modulation.rate, mod.rate)) this.synth.writeRegister(0x4086, mod.rate & 255);
      if (changed(p => [p.fds.modulation.rate, p.fds.modulation.enabled], [mod.rate, mod.enabled])) this.synth.writeRegister(0x4087, (mod.enabled ? 0 : 128) | (mod.rate >> 8));
    }
  }
  _retune(channel, period, {trigger = false, lengthIndex} = {}) {
    if (channel === 5) {
      this.synth.writeRegister(0x4082, period & 255);
      this.synth.writeRegister(0x4083, (this.synth._getState().registers[0x83] & 0xc0) | (period >> 8));
      return;
    }
    const base = 0x4000 + channel * 4, previous = this.synth._getState().registers[channel * 4 + 3];
    this.synth.writeRegister(base + 2, period & 255);
    // NES timer-high writes restart the hardware envelope/length. Skip them
    // while the high bits are unchanged. Crossing a timer-byte boundary still
    // has that hardware side effect; the host voice identity stays unchanged.
    // Length index 0 is meaningful for every tone channel. Pitch retains the
    // active index instead of applying a pending authored gate setting.
    const length = lengthIndex === undefined ? previous & 0xf8 : lengthIndex << 3;
    if (trigger || (previous & 7) !== (period >> 8)) this.synth.writeRegister(base + 3, length | (period >> 8));
  }
  read() {
    this._open();
    const coreState = this.core.getState?.();
    return {preset: readPreset(this.preset), voices: [...this.voices.values()].map(({id, midi, channel}) => ({id, midi, channel})),
      capacity: poolFor(this.preset).length, pitch: this.pitch, registers: this.synth._getState().registers, ...(coreState ? {coreState} : {})};
  }
  setPreset(value) {
    this._open(); const next = readPreset(value), previous = this.preset;
    if (previous.source !== next.source || !equal(previous.dmc.data, next.dmc.data) || !equal(previous.fds.wave, next.fds.wave) || !equal(previous.fds.modulation.table, next.fds.modulation.table)) this.stop();
    this._apply(previous, next); this.preset = next; return this.read();
  }
  loadPreset(value) {
    this._open(); const next = readPreset(value);
    this.stop(); this.synth.reset(); this.pitch = 0; this._apply(null, next); this.preset = next; return this.read();
  }
  noteOn(id, midi) {
    this._open();
    if (typeof id !== 'string' || !id.length || id.length > 128) throw new TypeError('Expected a note identity of 1–128 characters');
    if (this.voices.has(id)) throw new Error('Note identity is already active');
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Expected a MIDI note 0–127');
    const source = this.preset.source, tone = source === 'noise' || source === 'dmc' ? null : this._frequency(midi), pool = poolFor(this.preset);
    if (source === 'dmc' && !this.preset.dmc.data.length) throw new Error('Load a DPCM sample or choose Demo DPCM before playing DMC');
    let channel;
    for (let offset = 0; offset < pool.length; offset++) {
      const candidate = pool[(this.cursor + offset) % pool.length];
      if (this.slots[candidate] === null) {channel = candidate; break;}
    }
    if (channel === undefined) channel = pool.reduce((oldest, candidate) => this.slots[candidate].order < this.slots[oldest].order ? candidate : oldest, pool[0]);
    const previous = this.slots[channel];
    if (previous) {this._stopChannel(channel); this.voices.delete(previous.id);}
    if (source === 'pulse') {
      this._pulseVoice(channel, this.preset);
      this._retune(channel, tone.period, {trigger: true, lengthIndex:this.preset.pulse.lengthIndex}); this.synth.keyOn(channel);
    } else if (source === 'triangle') {
      this._triangleControl(this.preset);
      this._retune(2, tone.period, {trigger:true, lengthIndex:this.preset.triangle.lengthIndex}); this.synth.keyOn(2);
    } else if (source === 'noise') {
      this._noiseVoice(this.preset);
      // The high-level Noise attack selects length index 1. Enable first,
      // then load the authored index so all 32 hardware entries remain usable.
      this.synth.writeRegister(0x4015, this.synth._getState().enabled | 8);
      this.synth.writeRegister(0x400f, this.preset.noise.lengthIndex << 3);
    }
    else if (source === 'dmc') {
      const {rate, loop, level, data} = this.preset.dmc;
      this.synth.noteOff(4);
      this.synth.writeRegister(0x4010, (loop ? 64 : 0) | rate);
      this.synth.writeRegister(0x4011, level);
      this.synth.writeRegister(0x4012, 0);
      this.synth.writeRegister(0x4013, Math.ceil((data.length - 1) / 16));
      // One selected source owns the core. An explicit DMC off/on trigger
      // follows hardware output-unit continuation; it does not reset the APU.
      this.synth.writeRegister(0x4015, this.synth._getState().enabled | 16);
    }
    else {
      // Refresh the high-level keyOn cache while silent. keyOn intentionally
      // selects fixed gain and stops envelopes; program the authored hardware
      // envelope only afterwards so the public API cannot overwrite it.
      this.synth.fds.setVolume(this.preset.fds.volume, this.preset.fds.master);
      this._retune(5, tone.period); this.synth.fds.keyOn();
      const envelope = this.preset.fds.envelope, depthEnvelope = this.preset.fds.modulation.envelope;
      // Restore a pending fixed-depth change as well as seeding every enabled
      // envelope. The master clock and halt line are shared by both units.
      this.synth.writeRegister(0x4084, 128 | this.preset.fds.modulation.depth);
      if (envelope.enabled || depthEnvelope.enabled) {
        const clock = this.preset.fds.envelopeClock;
        if (envelope.enabled) this.synth.writeRegister(0x4080, 128 | envelope.initialGain);
        if (depthEnvelope.enabled) this.synth.writeRegister(0x4084, 128 | depthEnvelope.initialGain);
        this.synth.writeRegister(0x408a, clock.masterSpeed);
        if (envelope.enabled) this.synth.writeRegister(0x4080, (envelope.increase ? 64 : 0) | envelope.period);
        if (depthEnvelope.enabled) this.synth.writeRegister(0x4084, (depthEnvelope.increase ? 64 : 0) | depthEnvelope.period);
        this.synth.writeRegister(0x4083, (this.synth._getState().registers[0x83] & 15) | (clock.halt ? 64 : 0));
      }
    }
    const voice = {id, midi, channel, order: ++this.sequence};
    this.slots[channel] = voice; this.voices.set(id, voice); this.cursor = (pool.indexOf(channel) + 1) % pool.length;
    return {channel, stolenId: previous?.id ?? null};
  }
  noteOff(id) {
    this._open(); const voice = this.voices.get(id);
    if (!voice || this.slots[voice.channel] !== voice) return false;
    this._stopChannel(voice.channel); this.voices.delete(id); this.slots[voice.channel] = null; return true;
  }
  setPitch(semitones) {
    this._open();
    if (!Number.isFinite(semitones) || semitones < -24 || semitones > 24) throw new RangeError('Pitch must be between -24 and +24 semitones');
    const updates = ['noise', 'dmc'].includes(this.preset.source) ? [] : [...this.voices.values()].map(voice => [voice.channel, this._frequency(voice.midi, semitones).period]);
    for (const [channel, period] of updates) this._retune(channel, period);
    this.pitch = semitones; return this.read();
  }
  stop() {
    this._open(); for (let channel = 0; channel < 6; channel++) this._stopChannel(channel);
    this.voices.clear(); this.slots.fill(null); this.cursor = 0; return this.read();
  }
  _stopChannel(channel) {
    this.synth.noteOff(channel);
    // The hardware DAC can retain its last level after the sample ends.
    // An explicit Synth release clears that level instead of leaving DC.
    if (channel === 4) this.synth.writeRegister(0x4011, 0);
  }
  generateStereo(frames) {this._open(); return this.core.generateStereo(frames);}
  dispose() {if (this.disposed) return; this.stop(); this.core.dispose(); this.disposed = true;}
}
