import {PWM_METHODS} from './pwm32x_playback.js';
/** Render-clock event recording / looping for offline and Node Worker engines. */
import {createMegaSynthOffline} from './megasynth_offline.js';
import {MegaSynthRecordingManager} from './megasynth_recording.js';
import {MegaSynthLooper} from './looper.js';
import {SampleClock} from './sample_clock.js';
import {YM2612Synth} from './ym2612synth.js';
import {MegaSynthPCMLooper} from './megasynth_pcm_looper.js';

const COMMANDS = {
  reset: () => ({type: 'reset'}),
  setOperator: (channel, operator, params) => ({type: 'setOperator', channel, operator, params}),
  setAlgo: (channel, algorithm, feedback = 0) => ({type: 'setAlgo', channel, algorithm, feedback}),
  setPan: (channel, left, right, ams, pms) => ({type: 'setPan', channel, left, right, ams, pms}),
  setLfo: (enabled, frequency) => ({type: 'setLfo', enabled, frequency}),
  setDacEnabled: enabled => ({type: 'setDacEnabled', enabled}),
  writeDac: value => ({type: 'writeDac', value}),
  setChannel3SpecialMode: enabled => ({type: 'setChannel3SpecialMode', enabled}),
  setChannel3SpecialFrequency: (operator, block, fnum) => ({type: 'setChannel3SpecialFrequency', operator, block, fnum}),
  noteOn: (channel, block, fnum) => ({type: 'noteOn', channel, block, fnum}),
  noteOff: channel => ({type: 'noteOff', channel}),
};
const FM_METHODS = new Set([...Object.keys(COMMANDS), 'setPreset', 'setFrequency', 'write']);
const LOOP_METHODS = new Set(['start', 'stop', 'clear', 'startRecording', 'finishRecording',
  'toggleRecord', 'undo', 'noteOn', 'noteOff', 'getState', 'getUnits', 'exportAudio']);
const validationFM = () => new YM2612Synth({transport: {write(port, register, value) {}, reset() {}}});

/** @typedef {import('./megasynth_offline.js').MegaSynthOfflineOptions & {looperMode?: 'events'|'pcm', looperMaxAudioSeconds?: number}} MegaSynthSessionOptions */
/** @param {MegaSynthSessionOptions} [options] */
export async function createMegaSynthSession(options = {}) {
  if (!['events', 'pcm'].includes(options.looperMode ?? 'events')) throw new Error('Invalid looperMode');
  const engine = await createMegaSynthOffline(options);
  try {return new MegaSynthSession(engine, options);} catch (error) {engine.close(); throw error;}
}

class MegaSynthSession {
  #engine; #clock; #suppressed = 0; #closed = false; #rendering = false;
  #userTimers = new Set(); #recording;
  #closing;
  #pcmLooper;
  constructor(engine, options) {
    this.#engine = engine; this.fm = engine.fm; this.fx = engine.fx;
    this.#clock = new SampleClock(engine.sampleRate, () => engine.currentFrame);
    if (options.looperMode === 'pcm') this.#pcmLooper = new MegaSynthPCMLooper(engine, this.#clock, options.looperMaxAudioSeconds);
    const original = Object.fromEntries([...FM_METHODS, 'getState'].map(method => [method, this.fm[method].bind(this.fm)]));
    // Replayed commands and patch restoration must not record themselves.
    const playback = Object.fromEntries(Object.entries(original).map(([method, fn]) => [method, (...args) => {
      this.#suppressed++;
      try {return fn(...args);} finally {this.#suppressed--;}
    }]));
    this.#recording = new MegaSynthRecordingManager({synth: playback, now: () => this.currentTime,
      setTimer: this.#clock.setTimer, clearTimer: this.#clock.clearTimer, cyclePaddingSeconds: 0});
    for (const [method, toCommand] of Object.entries(COMMANDS)) {
      this.fm[method] = (...args) => {
        this.#assertOpen(); const result = original[method](...args);
        if (!this.#suppressed) this.#recording.recordCommand(toCommand(...args));
        return result;
      };
    }
    const applyPatch = (patch, channel, event) => {
      const source = patch.channels[event.channel];
      source.operators.forEach((operator, index) => playback.setOperator(channel, index, operator));
      playback.setAlgo(channel, source.algorithm, source.feedback);
      playback.setPan(channel, source.left, source.right, source.ams, source.pms);
    };
    this.looper = new MegaSynthLooper({synth: this.fm, liveTarget: this.fm, playbackTarget: playback,
      now: () => this.currentTime, setTimer: this.#clock.setTimer, clearTimer: this.#clock.clearTimer,
      getPatch: original.getState, applyPatch, audioPaddingSeconds: 0,
      ...(this.#pcmLooper ? {
        startAudioCapture: this.#pcmLooper.startCapture, stopAudioCapture: this.#pcmLooper.stopCapture,
        scheduleAudioPlayback: this.#pcmLooper.schedulePlayback, stopAudioPlayback: this.#pcmLooper.stopPlayback,
        onStateChange: () => this.#pcmLooper.prune(this.looper.getUnits()),
      } : {})});
    this.recording = {
      start: () => {this.#assertOpen(); return this.#recording.start();},
      stop: () => {this.#assertOpen(); return this.#recording.stop();},
      export: () => {this.#assertOpen(); return this.#recording.exportRecording();},
      import: data => {this.#assertOpen(); this.#validateRecording(data); return this.#recording.importRecording(data);},
      /** @param {unknown} [data] @param {{loop?: boolean, reset?: boolean, ignorePatch?: boolean, ignoreOperators?: boolean}} [options] */
      play: (data = null, options = {}) => {
        this.#assertOpen(); const selected = data ?? this.#recording.exportRecording();
        if (!selected) throw new Error('No recording to play');
        this.#validateRecording(selected, options);
        if (options.loop && Math.round(selected.durationSeconds * this.sampleRate) < 1) throw new Error('Recording loop must advance at least one frame');
        try {return this.#recording.play(selected, options);}
        catch (error) {this.#recording.stopPlayback(); throw error;}
      },
      stopPlayback: () => {this.#assertOpen(); this.#recording.stopPlayback();},
      getState: () => ({recording: this.#recording.isRecording(), playing: this.#recording.isPlaying()}),
    };
  }
  #assertOpen() {if (this.#closed) throw new Error('MegaSynthSession is closed');}
  #validateRecording(data, options = {}) {
    if (!data || data.format !== 'megasynth-recording-v1' || !Array.isArray(data.commands) ||
        !Number.isFinite(data.durationSeconds) || data.durationSeconds < 0) throw new Error('Invalid recording');
    for (const command of data.commands) {
      if (!command || !Object.hasOwn(COMMANDS, command.type) || !Number.isFinite(command.time) ||
          command.time < 0 || command.time > data.durationSeconds) throw new Error('Invalid recording command/time');
    }
    // Validate the public recording format before mutating the live chip.
    // A no-op transport exercises the same Synth range checks without WASM.
    const fm = validationFM();
    const callbacks = [];
    const validator = new MegaSynthRecordingManager({synth: fm, now: () => 0,
      setTimer: callback => {callbacks.push(callback); return callbacks.length;}, clearTimer() {}});
    validator.play(data, {...options, loop: false});
    for (const callback of callbacks.slice(0, -1)) callback();
    validator.stopPlayback();
  }
  get sampleRate() {return this.#engine.sampleRate;}
  get currentFrame() {return this.#engine.currentFrame;}
  get currentTime() {return this.#engine.currentTime;}
  get pendingTimers() {return this.#clock.pendingCount;}
  applyFX(command) {this.#assertOpen(); this.#engine.applyFX(command);}
  callFM(method, args) {
    this.#assertOpen(); if (!FM_METHODS.has(method) || !Array.isArray(args)) throw new Error('Invalid FM command');
    return this.fm[method](...args);
  }
  callPWM(method, args = []) {
    this.#assertOpen();
    if (!this.#engine.pwm) throw new Error('Enable mega32X to use PWM');
    if (!PWM_METHODS.has(method) || !Array.isArray(args)) throw new Error('Invalid PWM command');
    return this.#engine.pwm[method](...args);
  }
  async callLooper(method, args = []) {
    this.#assertOpen(); if (!LOOP_METHODS.has(method) || !Array.isArray(args)) throw new Error('Invalid looper command');
    if (method === 'exportAudio') {
      if (!this.#pcmLooper) throw new Error('PCM looper mode is not enabled');
      return this.#pcmLooper.exportAudio(this.looper.getUnits().find(unit => unit.id === args[0]));
    }
    // start() returns its class instance, which is not a transferable RPC result.
    const result = await this.looper[method](...args);
    return method === 'start' ? this.looper.getState() : result;
  }
  schedule(frame, command) {
    this.#assertOpen();
    if (!command || !Array.isArray(command.args) ||
        !(command.target === 'fm' && FM_METHODS.has(command.method)) &&
        !(command.target === 'looper' && LOOP_METHODS.has(command.method))) throw new Error('Invalid scheduled command');
    const copy = structuredClone(command);
    if (copy.target === 'fm' || ['noteOn', 'noteOff'].includes(copy.method)) validationFM()[copy.method](...copy.args);
    const id = this.#clock.atFrame(frame, () => {
      this.#userTimers.delete(id);
      return copy.target === 'fm' ? this.callFM(copy.method, copy.args) : this.callLooper(copy.method, copy.args);
    });
    this.#userTimers.add(id);
  }
  clearSchedule() {this.#assertOpen(); for (const id of this.#userTimers) this.#clock.clearTimer(id); this.#userTimers.clear();}
  async stopEvents() {
    this.#assertOpen(); this.clearSchedule();
    this.#recording.stop(); this.#recording.stopPlayback(); await this.looper.stop(); this.#clock.clear();
  }
  async stop() {await this.stopEvents(); this.#engine.stop();}
  /** Async only to await looper transitions; time still advances exclusively by PCM frames. */
  async render(frames) {
    this.#assertOpen();
    if (this.#rendering) throw new Error('Concurrent session render is not supported');
    if (!Number.isSafeInteger(frames) || frames < 0 || frames > 10000000) throw new RangeError('Invalid render frames');
    this.#rendering = true;
    try {
      const left = new Float32Array(frames), right = new Float32Array(frames);
      let offset = 0;
      while (true) {
        await this.#clock.runDue();
        if (offset === frames) break;
        const count = Math.min(frames - offset, this.#clock.nextFrame - this.currentFrame);
        this.#pcmLooper?.assertCanRender(count);
        const pcm = this.#engine.render(count, {onSource: this.#pcmLooper?.capture}); left.set(pcm.left, offset); right.set(pcm.right, offset); offset += count;
      }
      return {left, right, sampleRate: this.sampleRate};
    } finally {this.#rendering = false;}
  }
  close() {
    if (this.#closing) return this.#closing;
    if (this.#closed) return Promise.resolve();
    this.#closing = (async () => {
      try {await this.stopEvents();} finally {this.#pcmLooper?.prune([]); this.#closed = true; this.#clock.clear(); this.#engine.close();}
    })();
    return this.#closing;
  }
}
