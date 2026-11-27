// SPDX-License-Identifier: BSD-3-Clause
// PCM register and phase behavior adapted from MAME qsoundhle.cpp,
// copyright superctr and Valley Bell. See third_party/mame-qsound/LICENSE.
export const QSOUND_PCM_RATE = 60_000_000 / (2 * 1248);
const signed = word => (word << 16) >> 16;

// DSP step multipliers in signed nibble order (-8 through +7).
const adpcmScale = [154,154,128,102,77,58,58,58,58,58,58,58,77,102,128,154];

function advanceAdpcm(voice, rom, lowNibble) {
  if (!lowNibble) {
    if (voice.address === voice.end) voice.gain = 0;
    if (voice.trigger) {
      voice.address = voice.start;
      voice.gain = voice.volume;
      voice.step = 10;
      voice.output = 0;
      voice.trigger = false;
    }
  }
  const byte = rom[voice.bank * 65536 + voice.address] ?? 0;
  const nibble = lowNibble ? byte & 15 : byte >>> 4;
  const code = nibble < 8 ? nibble : nibble - 16;
  if (lowNibble) voice.address = (voice.address + 1) & 65535;
  const magnitude = ((1 + 2 * Math.abs(code)) * voice.step) >> 1;
  const sample = Math.max(-32768, Math.min(32767, voice.output + (code <= 0 ? -magnitude : magnitude)));
  voice.output = (sample * voice.gain) >> 16;
  voice.step = Math.max(1, Math.min(2000, (voice.step * adpcmScale[8 + code]) >> 6));
}

export class QSoundPcm {
  constructor(rom, sampleRate = QSOUND_PCM_RATE) {
    if (!(rom instanceof Uint8Array) || !(sampleRate > 0) || !Number.isFinite(sampleRate))
      throw new TypeError('Expected sample ROM bytes and a positive sample rate');
    this.rom = rom;
    this.sampleRate = sampleRate;
    this.tickRate = QSOUND_PCM_RATE;
    this.voices = Array.from({length:16}, () => ({
      muted:false, bank:0, address:0, phase:0, rate:0, loop:0, end:0, echoSend:0, volume:0, pan:0x120,
    }));
    this.adpcm = Array.from({length:3}, () => ({
      start:0, end:0, bank:0, address:0, volume:0, gain:0, trigger:false,
      step:0, output:0, muted:false, pan:0x120,
    }));
    this.echoLine = new Int16Array(1024);
    this.echoPosition = this.echoPrevious = this.echoFeedback = 0;
    this.echoBase = 0x554;
    this.echoEnd = this.echoBase + 6;
    this.adpcmSlot = 0;
    this.left = this.right = 0;
    this.ticks = 1;
  }

  setChannelMuted(index,muted) {
    const voice=index<16 ? this.voices[index] : this.adpcm[index-16];
    voice.muted=Boolean(muted);
  }

  writeRegister(reg, value) {
    if (!Number.isInteger(reg) || reg < 0 || reg > 255 ||
        !Number.isInteger(value) || value < 0 || value > 65535)
      throw new RangeError('Expected an 8-bit register and 16-bit data word');
    if (reg >= 0x80 && reg < 0x90) {this.voices[reg-0x80].pan = value; return;}
    if (reg >= 0x90 && reg <= 0x92) this.adpcm[reg-0x90].pan = value;
    if (reg >= 0xba && reg < 0xca) this.voices[reg-0xba].echoSend = signed(value);
    if (reg === 0x93) this.echoFeedback = signed(value);
    if (reg === 0xd9) this.echoEnd = value;
    if (reg === 0xe3) {
      // Preview changes the echo address base immediately on recognized state requests.
      if ([0x288,0x039,0x314].includes(value)) this.echoBase = 0x554;
      if ([0x61a,0x04f,0x6b2].includes(value)) this.echoBase = 0x53c;
      if (value === 0x288 || value === 0x61a) {
        this.echoLine.fill(0);
        this.echoPosition = this.echoPrevious = this.echoFeedback = 0;
        this.echoEnd = this.echoBase + 6;
        for (const voice of this.voices) voice.echoSend = 0;
      }
    }
    if (reg >= 0xca && reg < 0xd6) {
      const voice = this.adpcm[(reg-0xca) >> 2];
      switch ((reg-0xca) & 3) {
        case 0: voice.start = value; break;
        case 1: voice.end = value; break;
        case 2: voice.bank = value & 0x7fff; break;
        case 3: voice.volume = signed(value); break;
      }
    }
    if (reg >= 0xd6 && reg <= 0xd8) this.adpcm[reg-0xd6].trigger = value !== 0;
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

  advanceEcho(input) {
    const delayed = this.echoLine[this.echoPosition];
    const average = (delayed + this.echoPrevious) >> 1;
    this.echoPrevious = delayed;
    this.echoLine[this.echoPosition++] = (input + average * this.echoFeedback * 4) >> 16;
    const length = Math.max(0, Math.min(1024, this.echoEnd - this.echoBase));
    if (this.echoPosition >= length) this.echoPosition = 0;
    return average;
  }

  tick() {
    let left = 0, right = 0, echoInput = 0;
    for (const v of this.voices) {
      if (v.volume && !v.muted) {
        const byte = this.rom[v.bank * 65536 + (v.address & 0xffff)] ?? 0;
        const sample = signed(((byte << 24 >> 24) * 256 * v.volume) >> 14);
        echoInput += sample * v.echoSend * 4;
        const pcm = sample / 32768;
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
    advanceAdpcm(this.adpcm[this.adpcmSlot % 3], this.rom, this.adpcmSlot >= 3);
    this.adpcmSlot = (this.adpcmSlot + 1) % 6;
    for (const voice of this.adpcm) {
      if (!voice.output || voice.muted) continue;
      const pan = Math.min(32, Math.max(0, voice.pan - 0x110)) / 32;
      left += voice.output / 32768 * (1-pan);
      right += voice.output / 32768 * pan;
    }
    // Monitor the shared return centrally until the dry/wet spatial filters are modeled.
    const echo = this.advanceEcho(echoInput) / 32768;
    this.left = Math.max(-1, Math.min(1, left + echo));
    this.right = Math.max(-1, Math.min(1, right + echo));
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
