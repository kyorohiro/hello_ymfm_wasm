import {NES_APU_CLOCK} from './nesapu.js';
import {ChipWorkletTransport} from './chip_worklet_transport.js';
/** @typedef {{writeRegister(address:number,value:number):void, reset?:()=>void,
 * setChannelEnabled?:(channel:number,enabled:boolean)=>void,
 * loadMemory?:(bytes:Uint8Array,address:number)=>void|Promise<unknown>, clock?:number, fdsEnabled?:boolean}} NesApuTransport
 * @typedef {{volume?:number, duty?:0.125|0.25|0.5|0.75, envelope?:{period:number,loop?:boolean}, sweep?:{enabled?:boolean,period?:number,negate?:boolean,shift?:number}}} NesPulseVoice
 */
function integer(n,max,label){if(!Number.isInteger(n)||n<0||n>max)throw new RangeError(`${label} must be 0..${max}`);return n;}
function frequency(note){
 if(typeof note==='string'){
  const m=/^([A-Ga-g])([#b]?)(-?\d+)$/.exec(note);if(!m)throw new RangeError('Invalid NES note');
  note=(Number(m[3])+1)*12+({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1].toUpperCase()])+(m[2]==='#'?1:m[2]==='b'?-1:0);
 }
 integer(note,127,'MIDI note');return 440*2**((note-69)/12);
}
function table(values,length,max,label){
 if(!values||values.length!==length)throw new RangeError(`${label} needs ${length} entries`);
 const copy=Array.from(values);for(const value of copy)integer(value,max,label);return copy;
}
/** Owns no chip or audio device. */
export class NesApuDirectTransport {
 /** @param {import('./nesapu.js').NesApu} chip */
 constructor(chip){this.chip=chip;this.clock=chip.clock;this.fdsEnabled=chip.fdsEnabled;}
 /** @param {number} address @param {number} value */
 writeRegister(address,value){this.chip.writeRegister(address,value);}
 /** @param {Uint8Array} bytes @param {number} address */
 loadMemory(bytes,address){this.chip.loadMemory(bytes,address);}
 /** @param {number} channel @param {boolean} enabled */
 setChannelEnabled(channel,enabled){this.chip.setChannelEnabled(channel,enabled);}
 reset(){this.chip.reset();}
 sampleRate(){return this.chip.sampleRate();}
 /** @param {number} frames */
 generateStereo(frames){return this.chip.generateStereo(frames);}
}
export class NesApuWorkletTransport extends ChipWorkletTransport {
 /** @param {import('./soundchip_worklet.js').WorkletSoundChip | MessagePort} endpoint */
 constructor(endpoint){super(endpoint);this.clock=this.endpoint?.clock??NES_APU_CLOCK;this.fdsEnabled=this.endpoint?.fdsEnabled??false;}
 /** @param {number} channel @param {boolean} enabled */
 setChannelEnabled(channel,enabled){this.send('setChannelEnabled',[channel,enabled]);}
 /** @param {Uint8Array} bytes @param {number} address */
 loadMemory(bytes,address){if(!this.endpoint)return Promise.reject(new Error('Memory uploads need a worklet endpoint'));return this.endpoint.request('loadMemory',[bytes,address]);}
}
/** NTSC NES tones and optional FDS. Pulse indices 0/1; common tone channels 0/1/2/5. */
export class NesApuSynth {
 #registers=new Uint8Array(0x90);
 #enabled=0;
 #fdsActive=false;
 #fdsGain=32;
 #fdsMaster=0;
 #generation=0;
 /** @type {{address:number,length:number}|null} */ #sample=null;
 /** @param {{transport:NesApuTransport, clock?:number, fds?:boolean}} options */
 constructor({transport,clock=transport?.clock??NES_APU_CLOCK,fds=transport?.fdsEnabled??false}={}){
  if(!transport?.writeRegister)throw new TypeError('NesApuSynth requires writeRegister(address,value)');
  if(!Number.isFinite(clock)||clock<1780000||clock>1800000)throw new RangeError('NES Synth currently supports NTSC clocks only');
  this.transport=transport;this.clock=clock;this.fdsEnabled=fds;
  this.pulse={
   /** @param {0|1} channel @param {NesPulseVoice} voice */
   setVoice:(channel,voice)=>this.#pulseVoice(channel,voice),
   /** @param {0|1} channel @param {string|number} note */
   setNote:(channel,note)=>this.setFrequency(channel,frequency(note)),
   /** @param {0|1} channel @param {string|number} note */
   noteOn:(channel,note)=>this.noteOn(channel,note),
   /** @param {0|1} channel */
   noteOff:channel=>this.noteOff(channel),
  };
  this.triangle={
   /** @param {string|number} note */ setNote:note=>this.setFrequency(2,frequency(note)),
   /** @param {string|number} note */ noteOn:note=>this.noteOn(2,note),noteOff:()=>this.noteOff(2),
  };
  this.noise={
   /** @param {{volume?:number,period?:number,shortMode?:boolean}} [options] */
   setVoice:({volume=8,period=6,shortMode=false}={})=>{
    integer(volume,15,'Noise volume');integer(period,15,'Noise period');if(typeof shortMode!=='boolean')throw new TypeError('Noise shortMode must be boolean');
    this.writeRegister(0x400c,0x30|volume);this.writeRegister(0x400e,(shortMode?128:0)|period);
   },
   noteOn:()=>{this.#enable(3,true);this.writeRegister(0x400f,8);},noteOff:()=>this.noteOff(3),
  };
  this.dmc={
   /** Pre-encoded DPCM, padded to 16*n+1 bytes. No PCM encoder or ROM needed.
    * @param {Uint8Array|ArrayBuffer} input @param {{address?:number}} [options] */
   loadSample:async(input,{address=0xc000}={})=>{
    const bytes=input instanceof ArrayBuffer?new Uint8Array(input):input;
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>4081)throw new RangeError('DMC sample must contain 1..4081 DPCM bytes');
    const length=Math.ceil((bytes.length-1)/16)*16+1;
    if(!Number.isInteger(address)||address<0xc000||address%64||address+length>65536)throw new RangeError('DMC address must be 64-byte aligned in $C000..$FFFF and fit the sample');
    if(!this.transport.loadMemory)throw new Error('Transport does not support DMC memory');
    const data=new Uint8Array(length).fill(0xaa);data.set(bytes);
    const generation=++this.#generation;this.#sample=null;this.#enable(4,false);
    await this.transport.loadMemory(data,address);
    if(generation!==this.#generation)throw new Error('DMC load was superseded or reset');
    this.#sample={address,length};return {address,length};
   },
   /** @param {{rate?:number,loop?:boolean,level?:number}} [options] */
   play:({rate=15,loop=false,level=64}={})=>{
    integer(rate,15,'DMC rate index');integer(level,127,'DMC initial level');if(typeof loop!=='boolean')throw new TypeError('DMC loop must be boolean');
    if(!this.#sample)throw new Error('Load a DMC sample before play()');
    this.#enable(4,false);this.writeRegister(0x4010,(loop?64:0)|rate);this.writeRegister(0x4011,level);
    this.writeRegister(0x4012,(this.#sample.address-0xc000)/64);this.writeRegister(0x4013,(this.#sample.length-1)/16);this.#enable(4,true);
   },stop:()=>this.noteOff(4),
  };
  this.fds={
   /** @param {ArrayLike<number>} values 64 wave samples, 0..63. */
   setWave:values=>{
    this.#checkFds();const wave=table(values,64,63,'FDS wave');const control=this.#registers[0x83],master=this.#registers[0x89]&3;
    this.writeRegister(0x4023,2);this.writeRegister(0x4083,control|128);this.writeRegister(0x4089,128|master);
    wave.forEach((value,i)=>this.writeRegister(0x4040+i,value));this.writeRegister(0x4089,master);this.writeRegister(0x4083,control);
   },
   /** @param {number} volume Fixed gain 0..32. @param {number} [master] Hardware scale 0..3. */
   setVolume:(volume,master=0)=>{this.#checkFds();integer(volume,32,'FDS volume');integer(master,3,'FDS master scale');this.#fdsGain=volume;this.#fdsMaster=master;this.writeRegister(0x4023,2);this.writeRegister(0x4080,128|(this.#fdsActive?volume:0));this.writeRegister(0x4089,master);},
   /** @param {string|number} note */ setNote:note=>{this.#checkFds();return this.setFrequency(5,frequency(note));},
   /** @param {string|number} note */ noteOn:note=>this.noteOn(5,note),noteOff:()=>this.noteOff(5),
   /** @param {{table:ArrayLike<number>,rate?:number,depth?:number,bias?:number,enabled?:boolean}} options */
   setModulation:({table:values,rate=0,depth=0,bias=0,enabled=true})=>{
    this.#checkFds();const data=table(values,32,7,'FDS modulation');integer(rate,4095,'FDS modulation rate');integer(depth,63,'FDS modulation depth');
    if(!Number.isInteger(bias)||bias< -64||bias>63)throw new RangeError('FDS modulation bias must be -64..63');if(typeof enabled!=='boolean')throw new TypeError('FDS modulation enabled must be boolean');
    this.writeRegister(0x4023,2);this.writeRegister(0x4087,128|(rate>>8));data.forEach(v=>this.writeRegister(0x4088,v));
    this.writeRegister(0x4085,bias&127);this.writeRegister(0x4084,128|depth);this.writeRegister(0x4086,rate&255);this.writeRegister(0x4087,(enabled?0:128)|(rate>>8));
   },
  };
  this.reset();
 }
 #checkFds(){if(!this.fdsEnabled)throw new Error('FDS requires createSoundChip(nes, {fds:true})');}
 /** @param {number} address @param {number} value */
 writeRegister(address,value){if(!((address>=0x4000&&address<=0x4017)||address===0x4023||(address>=0x4040&&address<=0x408a)))throw new RangeError('Unsupported NES address');if(address>=0x4023)this.#checkFds();integer(address-0x4000,0x8a,'NES address offset');integer(value,255,'NES register value');this.transport.writeRegister(address,value);this.#registers[address-0x4000]=value;if(address===0x4015)this.#enabled=value&31;if(address===0x4083)this.#fdsActive=!(value&128);}
 #enable(channel,enabled){
  if(this.transport.setChannelEnabled){this.#enabled=enabled?this.#enabled|(1<<channel):this.#enabled&~(1<<channel);this.transport.setChannelEnabled(channel,enabled);}
  else this.writeRegister(0x4015,enabled?this.#enabled|(1<<channel):this.#enabled&~(1<<channel));
 }
 reset(){
  ++this.#generation;this.#sample=null;this.#fdsActive=false;this.transport.reset?.();this.#registers.fill(0);this.#registers[0x83]=128;this.#registers[0x87]=128;
  this.writeRegister(0x4015,0);this.writeRegister(0x4017,64);
  this.pulse.setVoice(0,{duty:0.5,volume:8});this.pulse.setVoice(1,{duty:0.5,volume:8});this.writeRegister(0x4008,255);this.noise.setVoice();
  if(this.fdsEnabled){this.fds.setVolume(32);this.writeRegister(0x4083,128);this.writeRegister(0x4087,128);this.fds.setWave(Array.from({length:64},(_,i)=>Math.round(31.5+31.5*Math.sin(i*Math.PI/32))));}
 }
 #pulseVoice(channel,{duty,volume,envelope,sweep}){
  integer(channel,1,'Pulse channel');const base=0x4000+channel*4;let control=this.#registers[base-0x4000],sweepValue;
  if(duty!==undefined){const index=[0.125,0.25,0.5,0.75].indexOf(duty);if(index<0)throw new RangeError('Pulse duty must be .125, .25, .5 or .75');control=(control&63)|(index<<6);}
  if(volume!==undefined){integer(volume,15,'Pulse volume');control=(control&0xc0)|0x30|volume;}
  if(envelope!==undefined){integer(envelope.period,15,'Pulse envelope period');if(envelope.loop!==undefined&&typeof envelope.loop!=='boolean')throw new TypeError('Envelope loop must be boolean');control=(control&0xc0)|(envelope.loop?32:0)|envelope.period;}
  if(sweep!==undefined){const {period=0,shift=0,negate=false,enabled=false}=sweep;integer(period,7,'Sweep period');integer(shift,7,'Sweep shift');if(typeof negate!=='boolean'||typeof enabled!=='boolean')throw new TypeError('Sweep flags must be boolean');sweepValue=(enabled?128:0)|(period<<4)|(negate?8:0)|shift;}
  this.writeRegister(base,control);if(sweepValue!==undefined)this.writeRegister(base+1,sweepValue);
 }
 /** @param {0|1|2|5} channel @param {number} hz */
 setFrequency(channel,hz){
  if(![0,1,2,5].includes(channel))throw new RangeError('Tone channel must be 0, 1, 2 or 5');if(!Number.isFinite(hz)||hz<=0)throw new RangeError('Frequency must be positive');
  if(channel===5){this.#checkFds();const value=Math.round(hz*4194304/this.clock);if(value<1||value>4095)throw new RangeError('FDS frequency outside 12-bit range');this.writeRegister(0x4082,value&255);this.writeRegister(0x4083,(this.#registers[0x83]&0xc0)|(value>>8));return value;}
  const period=Math.round(this.clock/((channel===2?32:16)*hz)-1);if(period<(channel===2?2:8)||period>2047)throw new RangeError('NES frequency outside timer range');
  const base=0x4000+channel*4;this.writeRegister(base+2,period&255);this.writeRegister(base+3,8|(period>>8));return period;
 }
 /** @param {0|1|2|5} channel @param {string|number} note */
 noteOn(channel,note){
  this.setFrequency(channel,frequency(note));
  if(channel===5){this.#fdsActive=true;this.fds.setVolume(this.#fdsGain,this.#fdsMaster);this.writeRegister(0x4083,0x40|(this.#registers[0x83]&15));return;}
  this.#enable(channel,true);const high=0x4003+channel*4;this.writeRegister(high,this.#registers[high-0x4000]);
 }
 /** @param {number} channel */
 noteOff(channel){integer(channel,5,'NES channel');if(channel===5){this.#checkFds();this.writeRegister(0x4083,this.#registers[0x83]|128);this.writeRegister(0x4080,128);}else this.#enable(channel,false);}
}
