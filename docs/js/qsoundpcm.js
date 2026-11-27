// SPDX-License-Identifier: BSD-3-Clause
// PCM register and phase behavior adapted from MAME qsoundhle.cpp,
// copyright superctr and Valley Bell. See third_party/mame-qsound/LICENSE.
export const QSOUND_PCM_RATE = 60_000_000 / (2 * 1248);
const signed = word => (word << 16) >> 16;

export class QSoundPcm {
  constructor(rom, sampleRate = QSOUND_PCM_RATE) {
    if (!(rom instanceof Uint8Array) || !(sampleRate > 0) || !Number.isFinite(sampleRate))
      throw new TypeError('Expected sample ROM bytes and a positive sample rate');
    this.rom = rom;
    this.sampleRate = sampleRate;
    this.tickRate = QSOUND_PCM_RATE;
    this.voices = Array.from({length:16}, () => ({
      muted:false, bank:0, address:0, phase:0, rate:0, loop:0, end:0, volume:0, pan:0x120,
    }));
    this.left = this.right = 0;
    this.ticks = 1;
  }

  writeRegister(reg, value) {
    if (!Number.isInteger(reg) || reg < 0 || reg > 255 ||
        !Number.isInteger(value) || value < 0 || value > 65535)
      throw new RangeError('Expected an 8-bit register and 16-bit data word');
    if (reg >= 0x80 && reg < 0x90) {this.voices[reg-0x80].pan = value; return;}
    if (reg >= 0x80) return;
    const ch = reg >> 3, voice = this.voices[ch];
    switch (reg & 7) {
      case 0: this.voices[(ch+1)&15].bank = value & 0x7fff; break;
      case 1: voice.address = signed(value); break;
      case 2: voice.rate = value; break;
      case 3: voice.phase = value; break;
      case 4: voice.loop = signed(value); break;
      case 5: voice.end = signed(value); break;
      case 6: voice.volume = signed(value); break;
    }
  }

  tick() {
    let left = 0, right = 0;
    for (const v of this.voices) {
      if (v.volume && !v.muted) {
        const byte = this.rom[v.bank * 65536 + (v.address & 0xffff)] ?? 0;
        const pcm = signed(((byte << 24 >> 24) * 256 * v.volume) >> 14) / 32768;
        // Dry preview only. The DL-1425 spatial DSP uses different gain tables.
        const pan = Math.min(32, Math.max(0, v.pan - 0x110)) / 32;
        left += pcm * (1-pan);
        right += pcm * pan;
      }
      let position = v.address * 4096 + (v.phase >>> 4) + v.rate;
      if ((position >> 12) >= v.end) position -= v.loop * 4096;
      position = Math.min(0x7ffffff, Math.max(-0x8000000, position));
      v.address = position >> 12;
      v.phase = (position << 4) & 65535;
    }
    this.left = Math.max(-1, Math.min(1, left));
    this.right = Math.max(-1, Math.min(1, right));
  }

  render(left, right) {
    for (let i=0; i<left.length; i++) {
      while (this.ticks >= 1) {this.tick(); this.ticks--;}
      left[i] = this.left;
      right[i] = this.right;
      this.ticks += this.tickRate / this.sampleRate;
    }
  }
}
