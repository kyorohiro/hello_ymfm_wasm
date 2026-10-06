/** Worker-owned dry FM capture and native sample playback for a session looper. */
export class MegaSynthPCMLooper {
  #engine; #clock; #capture = null; #banks = new Map(); #timers = new Map(); #sequence = 0; #limit;
  #lastPlayed = new Map();
  constructor(engine, clock, maxSeconds = 60) {
    if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 600) throw new RangeError('looperMaxAudioSeconds must be from >0 to 600');
    this.#engine = engine; this.#clock = clock; this.#limit = Math.floor(maxSeconds * engine.sampleRate);
  }
  startCapture = () => {
    if (this.#banks.size >= 64) throw new Error('PCM looper bank limit (64) reached');
    this.#capture = {chunks: [], frames: 0};
  };
  assertCanRender(frames) {
    if (!this.#capture) return;
    const retained = [...this.#banks.values()].reduce((sum, pcm) => sum + pcm.channels[0].length, 0);
    if (retained + this.#capture.frames + frames > this.#limit) {
      throw new Error('PCM looper audio limit reached; undo or clear before recording more');
    }
  }
  capture = channels => {
    if (!this.#capture) return;
    this.#capture.chunks.push(channels.map(channel => channel.slice()));
    this.#capture.frames += channels[0].length;
  };
  stopCapture = () => {
    const capture = this.#capture; this.#capture = null;
    if (!capture?.frames) return null;
    const channels = [new Float32Array(capture.frames), new Float32Array(capture.frames)];
    let offset = 0;
    for (const chunk of capture.chunks) {channels.forEach((channel, i) => channel.set(chunk[i], offset)); offset += chunk[0].length;}
    const name = `looper-pcm-${++this.#sequence}`;
    const pcm = {channels, sampleRate: this.#engine.sampleRate};
    this.#engine.sampleCommand({action: 'load', name, pcm}); this.#banks.set(name, pcm);
    return {audio: {name, frames: capture.frames, sampleRate: pcm.sampleRate}, audioDuration: capture.frames / pcm.sampleRate};
  };
  schedulePlayback = (unit, startTime) => {
    const name = unit.audio.name;
    const frame = Math.max(this.#engine.currentFrame, Math.round(startTime * this.#engine.sampleRate));
    const play = () => {
      if (this.#lastPlayed.get(name) === frame) return;
      this.#engine.sampleCommand({action: 'play', name, options: {
      playbackRate: 1, gain: 1, pan: 0, offset: 0, duration: -1, loop: false,
      loopStart: 0, loopEnd: 0, fadeIn: 0, fadeOut: 0,
      }}); this.#lastPlayed.set(name, frame);
    };
    if (frame === this.#engine.currentFrame) {play(); return;}
    if ([...this.#timers.values()].some(timer => timer.name === name && timer.frame === frame)) return;
    const id = this.#clock.atFrame(frame, () => {this.#timers.delete(id); play();});
    this.#timers.set(id, {name, frame});
  };
  stopPlayback = unit => {
    const name = unit?.audio?.name;
    for (const [id, timer] of this.#timers) if (!name || timer.name === name) {this.#clock.clearTimer(id); this.#timers.delete(id);}
    if (name) this.#lastPlayed.delete(name); else this.#lastPlayed.clear();
    this.#engine.sampleCommand({action: 'stop', name});
  };
  prune(units) {
    const retained = new Set(units.map(unit => unit.audio?.name));
    for (const name of this.#banks.keys()) if (!retained.has(name)) {
      this.#engine.sampleCommand({action: 'unload', name}); this.#banks.delete(name);
      this.#lastPlayed.delete(name);
    }
  }
  exportAudio(unit) {
    const pcm = this.#banks.get(unit?.audio?.name);
    if (!pcm) throw new Error('No PCM audio for this looper unit');
    return {sampleRate: pcm.sampleRate, channels: pcm.channels.map(channel => channel.slice())};
  }
}
