// SPDX-License-Identifier: BSD-3-Clause
// PCM register and phase behavior adapted from MAME qsoundhle.cpp,
// copyright superctr and Valley Bell. See third_party/mame-qsound/LICENSE.
export const QSOUND_PCM_RATE = 60_000_000 / (2 * 1248);
const signed = word => (word << 16) >> 16;

// DSP step multipliers in signed nibble order (-8 through +7).
const adpcmScale = [154,154,128,102,77,58,58,58,58,58,58,58,77,102,128,154];

export function advanceAdpcm(voice, rom, lowNibble, usage) {
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
  const address = voice.bank * 65536 + voice.address;
  if(usage && voice.gain && address<rom.length)usage[address>>>8]|=2;
  const byte = rom[address] ?? 0;
  const nibble = lowNibble ? byte & 15 : byte >>> 4;
  const code = nibble < 8 ? nibble : nibble - 16;
  if (lowNibble) voice.address = (voice.address + 1) & 65535;
  voice.output=adpcmOutput(voice.output,voice.step,code,voice.gain);
  voice.step=adpcmNextStep(voice.step,code);
}

export function adpcmOutput(previous,step,code,gain){
  const magnitude = ((1 + 2 * Math.abs(code)) * step) >> 1;
  const sample = Math.max(-32768, Math.min(32767, previous + (code <= 0 ? -magnitude : magnitude)));
  return (sample * gain) >> 16;
}

export function adpcmNextStep(step,code){
  return Math.max(1,Math.min(2000,(step*adpcmScale[8+code])>>6));
}

// Approximate standard-mode responses measured with an original PCM impulse VGM.
// Each coefficient averages three adjacent DSP output ticks. See synth-cps2/README.
const wetResponse=[
  [0,.00094,-.00217,-.00233,-.00094,.00439,.00178,.00128,-.00217,-.00444,-.00772,.00122,.00939,.00861,.00272,-.01494,-.05217,-.18728,-.02467,-.01478,.00622,.01722,-.00294,.00294,-.00639,-.00850,.00356,.00050,.00122,.00572,-.00228,0],
  [0,.00039,-.00411,-.00167,-.00144,.00072,.00689,.00228,-.00372,-.00400,-.01017,.00733,.00867,.00344,-.00050,-.01072,-.18194,-.06411,-.02261,-.00739,.01222,.00856,-.00300,-.00222,-.00461,-.00467,.00394,.00511,.00128,-.00183,-.00139,0],
];
function panCurve(points){
  return Array.from({length:33},(_,i)=>{
    const k=i>>2;
    return points[k]+((points[k+1]??points[k])-points[k])*(i%4)/4;
  });
}
const dryGain=panCurve([1,1,1,1,1,.64,.38,.20,0]);
const wetGain=panCurve([0,.18,.30,.46,.625,.65,.765,.79,1]);

function spatialState(){
  return {dry:new Float64Array(128),wetSums:new Float64Array(128),previous:0,older:0};
}
function spatialOutput(state,tick,side,dry,wet){
  state.dry[tick]=dry;
  state.wetSums[tick]=wet+state.previous+state.older;
  state.older=state.previous;
  state.previous=wet;
  let output=state.dry[(tick-(side===0?46:48))&127];
  const response=wetResponse[side];
  for(let i=1;i<response.length-1;i++)
    output+=response[i]*state.wetSums[(tick-3*i)&127];
  return output;
}

export class QSoundPcm {
  constructor(rom, sampleRate = QSOUND_PCM_RATE, {spatialPcm=false,trackRom=false}={}) {
    if (!(rom instanceof Uint8Array) || !(sampleRate > 0) || !Number.isFinite(sampleRate))
      throw new TypeError('Expected sample ROM bytes and a positive sample rate');
    this.spatial=spatialPcm?[spatialState(),spatialState()]:null;
    this.spatialTick=0;
    this.rom = rom;
    this.romUsage=trackRom?new Uint8Array(Math.ceil(rom.length/256)):null;
    this.sampleRate = sampleRate;
    this.tickRate = QSOUND_PCM_RATE;
    // -1 distinguishes an unwritten register from an explicit zero.
    this.lastWrites = new Int32Array(256).fill(-1);
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
    this.lastWrites[reg] = value;
    if (reg >= 0x80 && reg < 0x90) {this.voices[reg-0x80].pan = value; return;}
    if (reg >= 0x90 && reg <= 0x92) this.adpcm[reg-0x90].pan = value;
    if (reg >= 0xba && reg < 0xca) this.voices[reg-0xba].echoSend = signed(value);
    if (reg === 0x93) this.echoFeedback = signed(value);
    if (reg === 0xd9) this.echoEnd = value;
    if (reg === 0xe3) {
      // Preview changes the echo address base immediately on recognized state requests.
      const previousBase=this.echoBase;
      if ([0x288,0x039,0x314].includes(value)) this.echoBase = 0x554;
      if ([0x61a,0x04f,0x6b2].includes(value)) this.echoBase = 0x53c;
      if(this.spatial && (previousBase!==this.echoBase || value===0x288 || value===0x61a)){
        this.spatial=[spatialState(),spatialState()];this.spatialTick=0;
      }
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
      case 6: voice.volume = signed(value); if(value)voice.lastLevel=voice.volume; break;
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
    const spatial=this.spatial && this.echoBase===0x554;
    let dryL=0,dryR=0,wetL=0,wetR=0;
    for (const v of this.voices) {
      if(v.freezeWhileSilent && !v.volume)continue;
      if(this.romUsage && v.volume){
        const address=v.bank*65536+(v.address&65535);
        if(address<this.rom.length)this.romUsage[address>>>8]|=1;
      }
      if (v.volume && !v.muted) {
        const address=v.bank * 65536 + (v.address & 0xffff);
        const byte = this.rom[address] ?? 0;
        const sample = signed(((byte << 24 >> 24) * 256 * v.volume) >> 14);
        echoInput += sample * v.echoSend * 4;
        const pcm = sample / 32768;
        const index=v.pan-0x110;
        if(spatial && index>=0 && index<=32){
          dryL+=pcm*dryGain[index];dryR+=pcm*dryGain[32-index];
          wetL+=pcm*wetGain[index];wetR+=pcm*wetGain[32-index];
        }else{
          const pan=Math.max(0,Math.min(32,index))/32;
          left+=pcm*(1-pan);right+=pcm*pan;
        }
      }
      let position = v.address * 4096 + (v.phase >>> 4) + v.rate;
      if ((position >> 12) >= v.end) position -= v.loop * 4096;
      position = Math.min(0x7ffffff, Math.max(-0x8000000, position));
      v.address = position >> 12;
      v.phase = (position << 4) & 65535;
    }
    if(spatial){
      left+=spatialOutput(this.spatial[0],this.spatialTick,0,dryL,wetL);
      right+=spatialOutput(this.spatial[1],this.spatialTick,1,dryR,wetR);
      this.spatialTick=(this.spatialTick+1)&127;
    }
    advanceAdpcm(this.adpcm[this.adpcmSlot % 3], this.rom, this.adpcmSlot >= 3,this.romUsage);
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

  render(left, right, offset=0, count=left.length-offset) {
    if(this.romUsage && this.romUsage.length!==Math.ceil(this.rom.length/256)){
      const next=new Uint8Array(Math.ceil(this.rom.length/256));
      next.set(this.romUsage.subarray(0,next.length));this.romUsage=next;
    }
    for (let i=offset; i<offset+count; i++) {
      while (this.ticks >= 1) {this.tick(); this.ticks--;}
      left[i] = this.left;
      right[i] = this.right;
      this.ticks += this.tickRate / this.sampleRate;
    }
  }
}
