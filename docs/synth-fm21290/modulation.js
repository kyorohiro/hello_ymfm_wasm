// SPDX-License-Identifier: BSD-3-Clause
// CPU-side voice modulation, following the DX7 v1.8 timer handler.
import {AM, PM} from './chip.js';

import {PitchEnvelope} from './pitch_envelope.js';

const sine = [
  2,5,8,11,14,17,20,23,26,29,32,35,38,41,44,47,
  50,53,56,58,61,64,67,69,72,74,77,79,82,84,86,89,
  91,93,95,97,99,101,103,105,106,108,110,111,113,114,115,117,
  118,119,120,121,122,123,124,124,125,125,126,126,127,127,127,127,
];
const ampTable = [
  255,255,224,205,192,181,173,166,160,154,149,145,141,137,134,130,
  128,125,122,120,117,115,113,111,109,107,105,103,102,100,98,97,
  96,94,93,91,90,89,88,86,85,84,83,82,81,80,79,78,
  77,76,75,74,73,72,71,70,70,69,68,67,66,66,65,64,
  64,63,62,61,61,60,59,59,58,57,57,56,56,55,54,54,
  53,53,52,51,51,50,50,49,49,48,48,47,47,46,46,45,
  45,44,44,43,43,42,42,42,41,41,40,40,39,39,38,38,
  38,37,37,36,36,36,35,35,34,34,34,33,33,33,32,32,
  32,31,31,30,30,30,29,29,29,28,28,28,27,27,27,26,
  26,26,25,25,25,24,24,24,24,23,23,23,22,22,22,21,
  21,21,21,20,20,20,19,19,19,19,18,18,18,18,17,17,
  17,17,16,16,16,16,15,15,15,15,14,14,14,14,13,13,
  13,13,12,12,12,12,11,11,11,11,10,10,10,10,9,9,
  9,9,8,8,8,8,8,7,7,7,7,6,6,6,6,6,
  5,5,5,5,5,4,4,4,4,4,3,3,3,3,3,2,
  2,2,2,2,2,1,1,1,1,1,0,0,0,0,0,0,
];
const sensitivities = [0,10,20,33,55,92,153,255];
const scaled = value => value*165 >> 6;

// The ROM divider is 3140 CPU timer clocks. Nominal timing omits IRQ latency.
// Use doubled CPU clock units to retain the half-Hz fraction without drift.
const clockUnits = 2356625;
export class ModulatedChip {
  constructor(chip) {
    this.chip = chip;
    this.pitchEnvelope = new PitchEnvelope(chip);
    this.period = chip.sampleRate * 6280;
    this.elapsed = 0;
    this.phase = 0;
    this.random = 0;
    this.wave = 0;
    this.bend = 0;
    this.fade = 255;
    this.delayPhase = 65535;
    this.configure({speed:0,delay:0,sync:false,waveform:0,ampModDepth:0,pitchModDepth:0,pitchModSensitivity:0});
  }
  configure(lfo) {
    const speed = Math.max(1,scaled(lfo.speed));
    this.increment = speed * (11 + Math.max(0,(speed-160) >> 2));
    const delay = 99-lfo.delay;
    this.delayIncrement = (16+(delay & 15)) << (2+(delay >> 4));
    this.delay = lfo.delay;
    if (!this.delay) { this.fade=255; this.delayPhase=65535; }
    this.sync = lfo.sync;
    this.shape = lfo.waveform;
    const oldAM = this.amDepth, oldPM = this.pmDepth && this.sensitivity;
    this.amDepth = scaled(lfo.ampModDepth);
    this.pmDepth = scaled(lfo.pitchModDepth);
    this.sensitivity = sensitivities[lfo.pitchModSensitivity];
    if(oldAM && !this.amDepth)this.chip.writeRegister(AM,0);
    if(oldPM && !(this.pmDepth && this.sensitivity))this.writePitch(this.bend);
  }
  writePitch(pitch) {
    this.chip.writeRegister(PM,(pitch >> 8) & 255);
    this.chip.writeRegister(PM+1,pitch & 255);
  }
  setBend(value) {
    this.bend=value;
    this.writePitch(this.bend+this.pitchOffset());
  }
  keyOn(ch, basePitch) {
    if (ch !== undefined) this.pitchEnvelope.keyOn(ch, basePitch);
    if(this.sync)this.phase=0x7fff;
    if(this.delay){this.delayPhase=0;this.fade=0;}
  }
  pitchOffset() {
    const signed = (this.wave ^ 128)-128;
    return (Math.trunc(signed*this.sensitivity/256) * (this.pmDepth*this.fade >> 8)) >> 1;
  }
  tick() {
    const old = this.phase;
    this.phase = (old+this.increment) & 65535;
    const hi = this.phase >> 8;
    switch(this.shape) {
      case 0: this.wave = (((this.phase >> 7) ^ (hi & 128 ? 255 : 0))+128) & 255; break;
      case 1: this.wave = 255-hi; break;
      case 2: this.wave = hi; break;
      case 3: this.wave = hi & 128 ? 128 : 127; break;
      case 4: this.wave = sine[(hi & 63) ^ (hi & 64 ? 63 : 0)] ^ (hi & 128 ? 255 : 0); break;
      case 5:
        if(old<32768 && this.phase>=32768) {
          this.random=(this.random*179+0x11) & 255;
          this.wave=this.random;
        }
        break;
    }
    this.delayPhase += this.delayIncrement;
    if(this.delayPhase>65535) {
      this.delayPhase=65535;
      this.fade=Math.min(255,this.fade+Math.max(1,this.delayIncrement>>8));
    }
    if(this.amDepth) {
      const magnitude = (this.amDepth*this.fade >> 8) * (this.wave ^ 127) >> 8;
      this.chip.writeRegister(AM,ampTable[255-magnitude]);
    }
    this.pitchEnvelope.tick();
    if(this.pmDepth && this.sensitivity)this.writePitch(this.pitchOffset()+this.bend);
  }
  renderInto(buffer) {
    let offset=0;
    while(offset<buffer.length) {
      const frames=Math.min(buffer.length-offset,Math.ceil((this.period-this.elapsed)/clockUnits));
      this.chip.renderInto(offset===0 && frames===buffer.length ? buffer : buffer.subarray(offset,offset+frames));
      offset+=frames;
      this.elapsed+=frames*clockUnits;
      if(this.elapsed>=this.period){this.elapsed-=this.period;this.tick();}
    }
  }
}
