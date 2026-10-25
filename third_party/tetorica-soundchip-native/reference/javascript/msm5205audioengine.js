// BSD-3-Clause. ADPCM/FIFO behavior adapted from libvgm's MSM5205 core.
// Copyright holders: Aaron Giles, eito, cam900, Valley Bell, Mao.
// Source and license: docs/licenses/libvgm-msm5205/.
const shifts=[-1,-1,-1,-1,2,4,6,8];
const steps=Array.from({length:49},(_,i)=>Math.floor(16*Math.pow(1.1,i)));
export class Msm5205AudioEngine {
  /** @param {{clock:number,flags?:number,outputSampleRate?:number,masterVolume?:number}} options Chip clock in Hz and output frames per second. */
  constructor({clock,flags=4,outputSampleRate=44100,masterVolume=1}={}) {
    if(!Number.isInteger(clock)||clock<=0||clock>0x3fffffff||!Number.isInteger(outputSampleRate)||outputSampleRate<8000||outputSampleRate>384000)
      throw new RangeError('Invalid MSM5205 clock/sample rate');
    this.clock=clock;this.flags=flags;this.rate=outputSampleRate;this.muted=false;this.setMasterVolume(masterVolume);this.reset();
  }
  sampleRate(){return this.rate;}
  setMasterVolume(value){if(!Number.isFinite(Number(value)))throw new RangeError('Invalid volume');return this.volume=Math.max(0,Math.min(3.8,Number(value)));}
  getMasterVolume(){return this.volume;}
  setMsm5205Muted(value){this.muted=Boolean(value);}
  reset(){this.signal=-2;this.step=0;this.phase=0;this.resetLine=0;this.vclk=0;this.prescaler=this.flags&3;this.bits=(this.flags&4)?4:3;this.fifo=[];}
  dispose(){this.fifo=[];}
  divider(){return [96,64,48,1][this.prescaler&3];}
  decode(){
    if(this.resetLine||!this.fifo.length)return;
    let nibble=this.fifo.shift();if(this.bits===3)nibble<<=1;nibble&=15;
    const size=steps[this.step];
    const delta=(size>>3)+((nibble&1)?size>>2:0)+((nibble&2)?size>>1:0)+((nibble&4)?size:0);
    this.signal=Math.max(-2048,Math.min(2047,((nibble&8?-delta:delta)*256+this.signal*245)>>8));
    this.step=Math.max(0,Math.min(48,this.step+shifts[nibble&7]));
  }
  writeMsm5205(register,value){
    if(!Number.isInteger(register)||register<0||register>7||!Number.isInteger(value)||value<0||value>15)throw new RangeError('Invalid MSM5205 write');
    switch(register){
      case 0:if(this.resetLine!==value){this.signal=0;this.step=0;}this.resetLine=value;if(value)this.fifo=[];break;
      case 1:if(this.fifo.length<7)this.fifo.push(value);break;
      case 2:if(this.divider()===1&&!(this.vclk&1)&&(value&1))this.decode();this.vclk=value;break;
      case 4:this.prescaler=value&3;break;
      case 5:this.bits=value?4:3;break;
    }
  }
  processFrames(frames){
    if(!Number.isInteger(frames)||frames<0||frames>1048576)throw new RangeError('Invalid MSM5205 frame count');
    const left=new Float32Array(frames),right=new Float32Array(frames),divider=this.divider();
    for(let i=0;i<frames;i++){
      if(divider!==1){this.phase+=this.clock;while(this.phase>=this.rate*divider){this.phase-=this.rate*divider;this.decode();}}
      left[i]=right[i]=this.resetLine||this.muted?0:this.signal/2048*this.volume;
    }
    return {left,right};
  }
}
export function attachMsm5205(engine,msm){
  const process=engine.processFrames.bind(engine),reset=engine.reset.bind(engine),dispose=engine.dispose.bind(engine);
  engine.msm5205=msm;
  engine.writeMsm5205=msm.writeMsm5205.bind(msm);engine.setMsm5205Muted=msm.setMsm5205Muted.bind(msm);
  engine.processFrames=frames=>{
    const pcm=process(frames),adpcm=msm.processFrames(frames),gain=engine.getMasterVolume();
    for(let i=0;i<frames;i++){pcm.left[i]+=adpcm.left[i]*gain;pcm.right[i]+=adpcm.right[i]*gain;}return pcm;
  };
  engine.reset=()=>{reset();msm.reset();};engine.dispose=()=>{dispose();msm.dispose();};
}
