/**
 * @file vgm-engine-mock.js
 * 実行環境: Node.js のテスト用（ヘルパー自体は Browser でも使用可能）
 * 依存: JavaScript のデータ処理。DOM・Web Audio への依存なし。
 */
// Records engine calls, after VgmPlayer's real target adapters have run.
// Time is measured in rendered output frames; at 44100 Hz it is also VGM time.
export class MockSoundEngine {
  constructor(rate = 44100) {
    this.rate = rate;
    this.trace = [];
    this.lifecycle = [];
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
    (method === 'clear' ? this.lifecycle : this.trace).push({frame: this.frames, chip, instance: 0, method, args});
  }
  writeYm2612(port, register, value) { this.record('ym2612', 'register', [port, register, value]); }
  writeAy8910(register, value) { this.record('ay8910', 'register', [0, register, value]); }
  writeYm2413(register, value) { this.record('ym2413', 'register', [0, register, value]); }
  writeY8950(register, value) { this.record('y8950', 'register', [0, register, value]); }
  writePwm(register, value) { this.record('pwm', 'register', [0, register, value]); }
  writeYm2151(r,v) { this.record('ym2151','register',[0,r,v]); }
  writeYm2203(r,v) { this.record('ym2203','register',[0,r,v]); }
  writeYm2608(p,r,v) { this.record('ym2608','register',[p,r,v]); }
  writeYm2610B(p,r,v) { this.record('ym2610','register',[p,r,v]); }
  writeYm3526(r,v) { this.record('ym3526','register',[0,r,v]); }
  writeYm3812(r,v) { this.record('ym3812','register',[0,r,v]); }
  writeYmf262(p,r,v) { this.record('ymf262','register',[p,r,v]); }
  writeYmf278b(p,r,v) { this.record('ymf278b','register',[p,r,v]); }
  writeRf5c164(r,v) { this.record('rf5c164','register',[0,r,v]); }
  writeRf5c164Memory(offset,value) { this.record('rf5c164','memory-write',[offset,value]); }
  loadSampleMemory(data,offset,size) { this.record('samples','load',[offset,size,[...data]]); }
  loadAdpcmBMemory(data,offset,size) { this.record('ym2608','load',[offset,size,[...data]]); }
  loadAdpcmRom(type,data,offset,size) { this.record('ym2610','load',[type,offset,size,[...data]]); }
  loadRf5c164Memory(data,offset) { this.record('rf5c164','load',[offset,[...data]]); }
  clearSampleMemory() { this.record('samples','clear',[]); }
  clearAdpcmBMemory() { this.record('ym2608','clear',[]); }
  clearAdpcmRoms() { this.record('ym2610','clear',[]); }
  clearRf5c164Memory() { this.record('rf5c164','clear',[]); }
  writePsg(value) { this.record('psg', 'write', [value]); }
}

export function drainPlayer(player, frames = 128) {
  for (let calls = 0; player.isPlaying() || player.queuedFrames; calls++) {
    if (calls >= 100000) throw new Error('Player did not terminate');
    player.process(new Float32Array(frames), new Float32Array(frames), frames);
  }
}
