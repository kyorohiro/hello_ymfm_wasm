// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
/** Identity-safe round robin. Released voices are preferred in cursor order;
 * with every voice held, the oldest note is replaced. Late releases of stolen
 * identities cannot reach the replacement note. Owned by the audio processor. */
export class SpuRoundRobinVoices {
  constructor(count = 24) {
    if (!Number.isSafeInteger(count) || count < 1 || count > 24) throw new RangeError('Voice count must be 1–24');
    this.count = count;
    this.reset();
  }
  reset() {this.slots = Array(this.count).fill(null); this.notes = new Map(); this.cursor = 0; this.sequence = 0;}
  peek() {
    for (let offset = 0; offset < this.count; offset++) {
      const candidate = (this.cursor + offset) % this.count;
      if (this.slots[candidate] === null) return candidate;
    }
    return this.slots.reduce((oldest, note) => note.order < this.slots[oldest].order ? note.channel : oldest, 0);
  }
  allocate(id) {
    if (typeof id !== 'string' || !id.length || id.length > 128) throw new TypeError('Note identity must contain 1–128 characters');
    if (this.notes.has(id)) throw new Error('Note identity is already active');
    const channel = this.peek();
    const previous = this.slots[channel];
    if (previous) this.notes.delete(previous.id);
    const note = {id, channel, order:++this.sequence};
    this.slots[channel] = note; this.notes.set(id, note); this.cursor = (channel + 1) % this.count;
    return {channel, stolen:previous ? {...previous} : null};
  }
  release(id) {
    const note = this.notes.get(id);
    if (!note || this.slots[note.channel] !== note) return null;
    this.notes.delete(id); this.slots[note.channel] = null;
    return note.channel;
  }
  entries() {return this.slots.filter(Boolean).map(note => ({...note}));}
}
