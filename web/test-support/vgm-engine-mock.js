// Records engine calls, after VgmPlayer's real target adapters have run.
// Time is measured in rendered output frames; at 44100 Hz it is also VGM time.
export class MockSoundEngine {
  constructor(rate = 44100) {
    this.rate = rate;
    this.trace = [];
    this.frames = 0;
    this.resets = 0;
  }
  sampleRate() { return this.rate; }
  reset() { this.frames = 0; this.trace.length = 0; this.resets++; }
  processFrames(frames) {
    this.frames += frames;
    return {left: new Float32Array(frames), right: new Float32Array(frames)};
  }
  record(chip, method, args) {
    this.trace.push({frame: this.frames, chip, instance: 0, method, args});
  }
  writeYm2612(port, register, value) { this.record('ym2612', 'register', [port, register, value]); }
  writeAy8910(register, value) { this.record('ay8910', 'register', [0, register, value]); }
  writeYm2413(register, value) { this.record('ym2413', 'register', [0, register, value]); }
  writeY8950(register, value) { this.record('y8950', 'register', [0, register, value]); }
  writePwm(register, value) { this.record('pwm', 'register', [0, register, value]); }
  writePsg(value) { this.record('psg', 'write', [value]); }
}

export function drainPlayer(player, frames = 128) {
  for (let calls = 0; player.isPlaying() || player.queuedFrames; calls++) {
    if (calls >= 100000) throw new Error('Player did not terminate');
    player.process(new Float32Array(frames), new Float32Array(frames), frames);
  }
}
