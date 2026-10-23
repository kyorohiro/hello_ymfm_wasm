import {opnPitchFromHz} from './soundchip_pitch.js';
import {keyboardChannels} from './playground_keyboard_channels.js?v=native-extra-pwm-1';

const integer=(value,max,label)=>{if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${label} must be 0..${max}`);return value;};
const identity=value=>{if(typeof value!=='string'||!value.length||value.length>256)throw new TypeError('Audition identity must contain 1..256 characters');return value;};
const fmMap=kind=>kind==='ym2610'?[1,2,4,5]:Array.from({length:kind==='ym2203'?3:6},(_,i)=>i);

/** Private admin endpoint for every physical OPN instance. Reads never write to
 * the chip. Manual leases filter the same register path as Main and Worker.
 * Rhythm and ADPCM keys trigger the selected sound at its configured rate.
 */
export class OpnKeyboardInspector {
  /** @param {{writeRegister:(register:number,value:number,port?:number)=>unknown,reset:(...args:any[])=>unknown}} chip
   * @param {{kind:'ym2612'|'ym2203'|'ym2608'|'ym2610'|'ym2610b',
   * guard:ReturnType<typeof import('./playground_audition_guard.js?v=audio-numeric-bindings-1').createOpnAuditionGuard>,
   * clock:()=>number,sampleRate:number}} options */
  constructor(chip,{kind,guard,clock,sampleRate}) {
    if(!['ym2612','ym2203','ym2608','ym2610','ym2610b'].includes(kind))throw new Error('Unsupported OPN inspector');
    this.kind=kind;this.guard=guard;this.clock=clock;this.sampleRate=sampleRate;this.fm=fmMap(kind);
    this.held=new Map();this.sequence=0;this.registers=[new Uint8Array(256),new Uint8Array(256)];this.levels=new Uint8Array(3);this.adpcmRepeat=0;
    const write=chip.writeRegister.bind(chip),reset=chip.reset.bind(chip);
    this.direct=(register,value,port=0)=>{write(register,value,port);this.observe(register,value,port);};
    chip.writeRegister=(register,value,port=0)=>{
      const filtered=this.filter(register,value,port);if(filtered===null)return;
      this.direct(register,filtered,port);
    };
    chip.reset=(...args)=>{this.held.clear();this.registers.forEach(r=>r.fill(0));this.levels.fill(0);this.adpcmRepeat=0;return reset(...args);};
  }
  channel(value) {
    const id=typeof value==='number'?`fm:${value}`:value;
    if(typeof id!=='string'||! /^(fm|ssg|rhythm|adpcm-a|adpcm-b):[0-9]+$/.test(id))throw new RangeError('Invalid OPN keyboard channel');
    const [section,index]=id.split(':'),channel=Number(index);
    const count=section==='fm'?this.fm.length:section==='ssg'&&this.kind!=='ym2612'?3:
      section==='rhythm'&&this.kind==='ym2608'?6:section==='adpcm-a'&&['ym2610','ym2610b'].includes(this.kind)?6:
      section==='adpcm-b'&&['ym2608','ym2610','ym2610b'].includes(this.kind)?1:0;
    if(!Number.isSafeInteger(channel)||channel>=count)throw new RangeError('Unavailable OPN keyboard channel');
    return {id:`${section}:${channel}`,section,channel};
  }
  observe(register,value,port) {
    this.registers[port][register]=value;
    if(port===0&&register>=8&&register<=10&&value&31)this.levels[register-8]=value&31;
    if((this.kind==='ym2608'&&port===1&&register===0||['ym2610','ym2610b'].includes(this.kind)&&port===0&&register===0x10)&&value&0x80)this.adpcmRepeat=value&0x10;
  }
  filter(register,value,port) {
    if(!this.held.size)return value;
    if(port===0&&this.kind!=='ym2612') {
      if(register<=5&&this.held.has(`ssg:${register>>1}`))return null;
      if(register===7){let mask=0;for(let ch=0;ch<3;ch++)if(this.held.has(`ssg:${ch}`))mask|=(1<<ch)|(8<<ch);value=(value&~mask)|(this.registers[0][7]&mask);}
      if(register>=8&&register<=10&&!(value&31)&&this.held.has(`ssg:${register-8}`))return null;
    }
    const rhythm=this.kind==='ym2608';
    if((rhythm&&port===0&&register===0x10)||(!rhythm&&['ym2610','ym2610b'].includes(this.kind)&&port===1&&register===0)){
      let mask=0;for(let ch=0;ch<6;ch++)if(this.held.has(`${rhythm?'rhythm':'adpcm-a'}:${ch}`))mask|=1<<ch;
      const next=value&~mask;if((value&63)&&!(next&63))return null;value=next;
    }
    if(this.held.has('adpcm-b:0')){
      const base=rhythm?0:0x10,expectedPort=rhythm?1:0;
      if(port===expectedPort&&[base,base+9,base+10].includes(register))return null;
    }
    return value;
  }
  read(){return {kind:this.kind,clock:this.clock(),sampleRate:this.sampleRate,keyboardChannels:keyboardChannels(this.kind),held:[...this.held.keys()]};}
  invoke(method,args=[]) {
    if(method==='auditionAllOff'){this.clear();return true;}
    if(!['auditionOn','auditionOff'].includes(method))throw new Error('Unsupported OPN inspector operation');
    const target=this.channel(args[0]),id=identity(args[method==='auditionOn'?2:1]);
    if(method==='auditionOff'){
      if(this.held.get(target.id)?.id===id)this.release(target);
      return true;
    }
    const midi=integer(args[1],127,'MIDI note');
    if(args[3]!==undefined)integer(args[3],127,'Velocity');
    // Finish validation and pitch calculation before changing an existing lease.
    const hz=440*2**((midi-69)/12),pitch=target.section==='fm'?opnPitchFromHz(hz,this.clock(),this.kind==='ym2203'?72:144,{clamp:true}):null;
    const period=target.section==='ssg'?Math.max(1,Math.min(4095,Math.round(this.clock()/(this.kind==='ym2203'?2:4)/(16*hz)))):0;
    // Legacy OPN preview commands use ascending positive tokens. Allocate the
    // private admin identity from the opposite end so an old legacy release
    // cannot accidentally match a new Keyboard lease.
    const token=Number.MAX_SAFE_INTEGER-(++this.sequence);
    this.held.set(target.id,{id,token});
    const ch=target.channel;
    if(target.section==='fm')this.guard.handle({type:'audition-note-on',channel:this.fm[ch],token,block:pitch.block,fnum:pitch.fnum});
    else if(target.section==='ssg'){
      this.direct(8+ch,0);this.direct(ch*2,period&255);this.direct(ch*2+1,period>>8);
      // An untouched/silent SSG has no auditionable voice. Enable its tone with
      // a modest level; configured envelope/noise choices are otherwise kept.
      const mixer=this.registers[0][7],bits=(1<<ch)|(8<<ch);
      this.direct(7,!this.levels[ch]||(mixer&bits)===bits?(mixer&~(1<<ch))|(8<<ch):mixer);
      this.direct(8+ch,this.levels[ch]||12);
    }else if(target.section==='rhythm'){this.direct(0x10,0x80|(1<<ch));this.direct(0x10,1<<ch);}
    else if(target.section==='adpcm-a'){this.direct(0,0x80|(1<<ch),1);this.direct(0,1<<ch,1);}
    else {const port=this.kind==='ym2608'?1:0,base=port?0:0x10;this.direct(base,1,port);this.direct(base,0xa0|this.adpcmRepeat,port);}
    return true;
  }
  release(target) {
    const held=this.held.get(target.id);if(!held)return;
    this.held.delete(target.id);const ch=target.channel;
    if(target.section==='fm')this.guard.handle({type:'audition-note-off',channel:this.fm[ch],token:held.token});
    else if(target.section==='ssg')this.direct(8+ch,0);
    else if(target.section==='rhythm')this.direct(0x10,0x80|(1<<ch));
    else if(target.section==='adpcm-a')this.direct(0,0x80|(1<<ch),1);
    else this.direct(this.kind==='ym2608'?0:0x10,1,this.kind==='ym2608'?1:0);
  }
  clear(){for(const id of [...this.held.keys()])this.release(this.channel(id));}
}
