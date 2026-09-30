/** Audio-thread timeline: VGM positions are 44100 Hz samples, not output frames. */
export class Ym2608Timeline {
  constructor(engine, sampleRate) { this.engine = engine; this.sampleRate = sampleRate; this.prepared = null; this.active = null; }
  prepare(events, blocks, duration) {
    if (this.active) throw new Error('YM2608 timeline is playing');
    if (!Array.isArray(events) || !Array.isArray(blocks) || !Number.isSafeInteger(duration) || duration <= 0) throw new Error('Invalid YM2608 timeline');
    if (!blocks.every(b => b instanceof Uint8Array && b.length <= 0x200000)) throw new Error('Invalid ADPCM block');
    let previous = 0;
    const copy = events.map(e => {
      if (!Array.isArray(e) || e.length !== 4 || !e.every(Number.isSafeInteger)) throw new Error('Invalid timeline event');
      const [at, port, register, value] = e;
      if (at < previous || at > duration || port < 0 || port > 2) throw new Error('Invalid timeline position');
      if (port === 2) {
        if (!blocks[register] || value < 0 || value + blocks[register].length > 0x200000) throw new Error('Invalid ADPCM range');
      } else if (register < 0 || register > 255 || value < 0 || value > 255) throw new Error('Invalid register write');
      previous = at; return [...e];
    });
    this.prepared = {events: copy, blocks: blocks.map(b => b.slice()), duration};
  }
  play(reply) {
    if (this.active || !this.prepared) throw new Error('YM2608 timeline unavailable or already playing');
    this.engine.ym2608.reset();
    this.active = {...this.prepared, frame: 0, index: 0, reply};
  }
  cancel() { const active = this.active; this.active = null; active?.reply('Timeline cancelled'); }
  dispose() { this.cancel(); this.prepared = null; }
  process(left, right) {
    let offset = 0;
    while (offset < left.length) {
      const a = this.active;
      if (!a) { this.engine.process(left.subarray(offset), right.subarray(offset), left.length - offset); return; }
      try {
        while (a.index < a.events.length && Math.ceil(a.events[a.index][0] * this.sampleRate / 44100) <= a.frame) {
          const [, port, r, v] = a.events[a.index++];
          if (port === 2) this.engine.loadAdpcmBMemory(a.blocks[r], v);
          else this.engine.writeYm2608(port, r, v);
        }
        if (a.frame >= Math.ceil(a.duration * this.sampleRate / 44100)) {
          this.active = null; a.reply(); continue;
        }
        const next = a.index < a.events.length ? a.events[a.index][0] : a.duration;
        const count = Math.min(left.length - offset, Math.ceil(next * this.sampleRate / 44100) - a.frame);
        this.engine.process(left.subarray(offset, offset + count), right.subarray(offset, offset + count), count);
        a.frame += count; offset += count;
      } catch (error) { this.active = null; a.reply(error.message); }
    }
  }
}
