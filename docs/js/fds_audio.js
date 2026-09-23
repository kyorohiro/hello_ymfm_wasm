// Copyright (C) 2017-2020 FIX94. JavaScript adaptation: Tetorica contributors.
// MIT license; source, pinned revision and notice in third_party/fixnes-fds.
// Adapted from fixNES audio_fds.c, not NSFPlay.
export const fdsAddress = r => r === 0x3f ? 0x4023 : r < 0x40 ? 0x4080+(r&31) : 0x4000+r;
const signed7 = n => ((n&127)^64)-64;
export class FdsAudio {
  constructor(rate=44100){this.rate=rate;this.reset();}
  reset(){
    this.wave=new Uint8Array(64);this.modulation=new Uint8Array(32);
    this.modIndex=0;this.curWave=0;this.envSpeed=0xe8;this.volSpeed=0;this.sweepSpeed=0;
    this.volGain=0;this.sweepGain=0;this.volUp=false;this.sweepUp=false;
    this.master=0;this.ticks=0;this.modCounter=0;this.freq=0;this.modFreq=0;
    this.accumulator=0;this.modClock=0;this.updateRates();
    this.volTimer=this.volPeriod;this.sweepTimer=this.sweepPeriod;
    this.enabled=false;this.volEnabled=false;this.envEnabled=false;
    this.sweepEnabled=false;this.modEnabled=false;this.modForce=false;this.writeEnabled=false;
    this.io=true;this.out=0;this.low=0;this.dc=0;
    this.lowK=Math.exp(-2*Math.PI*2000/this.rate);this.dcK=Math.exp(-2*Math.PI*20/this.rate);
  }
  // Read-only views for the existing base-note monitor.
  get halt(){return !this.enabled;}
  get env(){return [{gain:this.volGain,disabled:!this.volEnabled,up:this.volUp}];}
  updateRates(){this.volPeriod=8*(this.envSpeed+1)*(this.volSpeed+1);this.sweepPeriod=8*(this.envSpeed+1)*(this.sweepSpeed+1);}
  write(register,value){
    const a=fdsAddress(register),v=value&255;
    if(a===0x4023){this.io=!!(v&2);return;}
    if(!this.io)return;
    if(a>=0x4040&&a<=0x407f){if(this.writeEnabled)this.wave[a&63]=v;return;}
    if(a<0x4080||a>0x408a)return;
    switch(a&15){
      case 0:
        this.volEnabled=!(v&128);this.volUp=!!(v&64);this.volSpeed=v&63;
        if(!this.volEnabled)this.volGain=v&63;
        this.updateRates();this.volTimer=this.volPeriod;break;
      case 2:this.freq=(this.freq&0xf00)|v;break;
      case 3:
        this.enabled=!(v&128);this.freq=(this.freq&255)|((v&15)<<8);
        if(!this.enabled){this.accumulator=0;this.curWave=this.wave[0];}
        this.envEnabled=!(v&64);
        if(!this.envEnabled){this.volTimer=this.volPeriod;this.sweepTimer=this.sweepPeriod;}break;
      case 4:
        this.sweepEnabled=!(v&128);this.sweepUp=!!(v&64);this.sweepSpeed=v&63;
        if(!this.sweepEnabled)this.sweepGain=v&63;
        this.updateRates();this.sweepTimer=this.sweepPeriod;break;
      case 5:this.modCounter=signed7(v);break;
      case 6:this.modFreq=(this.modFreq&0xf00)|v;break;
      case 7:
        this.modEnabled=!(v&128);this.modForce=!!(v&64);this.modFreq=(this.modFreq&255)|((v&15)<<8);
        if(!this.modEnabled){this.modClock=0;this.modIndex&=62;}break;
      case 8:
        if(!this.modEnabled){this.modulation[this.modIndex>>1]=v&7;this.modIndex=(this.modIndex+2)&63;}break;
      case 9:this.writeEnabled=!!(v&128);this.master=v&3;break;
      case 10:this.envSpeed=v;this.updateRates();break;
    }
  }
  envelope(){
    if(this.volEnabled){
      if(this.volTimer)this.volTimer--;
      else{this.volTimer=this.volPeriod;if(this.volUp){if(this.volGain<32)this.volGain++;}else if(this.volGain)this.volGain--;}
    }
    if(this.sweepEnabled){
      if(this.sweepTimer)this.sweepTimer--;
      else{this.sweepTimer=this.sweepPeriod;if(this.sweepUp){if(this.sweepGain<32)this.sweepGain++;}else if(this.sweepGain)this.sweepGain--;}
    }
  }
  tick(clocks=1){
    for(let cycle=0;cycle<clocks;cycle++){
      // fixNES clocks envelope timers once per CPU cycle, master update once
      // per CPU cycle with its internal divide-by-16 counter.
      if(this.envEnabled&&this.envSpeed){this.envelope();if(!this.enabled){this.envelope();this.envelope();this.envelope();}}
      if(!this.enabled)this.ticks=0;
      else if(!(this.ticks&15)){
        if(this.modEnabled){
          this.modClock=(this.modClock+this.modFreq)&65535;
          if((this.modClock&0xf000)||this.modForce){
            this.modClock&=4095;const entry=this.modulation[this.modIndex>>1];
            const step=[0,1,2,4,0,-4,-2,-1][entry];
            this.modCounter=entry===4?0:signed7(this.modCounter+step);
            this.modIndex=(this.modIndex+1)&63;
          }
        }
        let product=this.modCounter*this.sweepGain;
        if((product&15)&&!(product&0x800))product+=32;
        const multiplier=((product+1024)>>4)&255;
        this.accumulator=(this.accumulator+this.freq*multiplier)&0xffffff;
        this.curWave=this.wave[this.accumulator>>>18];
      }
      this.ticks=(this.ticks+1)&255;
      if(!this.writeEnabled){
        let volume=(this.curWave&63)*Math.min(this.volGain,32);
        if(this.master)volume=Math.floor(volume*[1,20/30,15/30,12/30][this.master]);
        this.out=(volume>>5)&63;
      }
    }
  }
  sample(){
    // Host-side filtering and approximate APU mix gain, not a hardware calibration.
    const value=this.out/63*0.3;
    this.low=this.lowK*this.low+(1-this.lowK)*value;
    this.dc=this.dcK*this.dc+(1-this.dcK)*this.low;
    return this.low-this.dc;
  }
}
