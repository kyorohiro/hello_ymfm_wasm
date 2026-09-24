import {Ym2612VGM} from '../js/ym2612vgm.js';
import {createOpmState} from './opm_monitor.js';
import {applyOpl3Write,describeOpl3Notes} from './ymf262_notes.js';

// Source-based replay also works before playback, after seeks, and without ROMs.
export function exportFmRegisterSnapshot(source,{chip,atSample=0}={}) {
  if(!['ym2151','ymf262','ymf278b'].includes(chip))throw new Error('Unsupported snapshot chip');
  if(!Number.isSafeInteger(atSample)||atSample<0)throw new RangeError('Invalid snapshot sample');
  const parser=new Ym2612VGM(source,{logger:null}),rawClock=parser.header[chip+'Clock'];
  if(!(rawClock&0x3fffffff)||(rawClock&0xc0000000))throw new Error('Snapshot requires a single non-variant '+chip);
  const registers=new Uint8Array(chip==='ym2151'?256:512),pcm=new Uint8Array(256),opm=createOpmState(()=>0);
  let time=0;
  for(;;){
    const e=parser.step();if(e.type==='end'){if(time<atSample)throw new RangeError('Snapshot time exceeds track end');break;}
    if(e.type==='wait'){time+=e.samples;if(time>atSample)break;continue;}
    if(e.type!==chip+'-write')continue;
    if(e.chipIndex)throw new Error('Second chip snapshot is not supported');
    if(chip==='ym2151'){registers[e.register]=e.value;opm.write(e.register,e.value);}
    else if(e.port===2)pcm[e.register]=e.value;
    else applyOpl3Write(registers,e.register,e.value,e.port);
  }
  const result={format:'tetorica-fm-register-snapshot',version:1,chip,clock:rawClock&0x3fffffff,timebase:44100,atSample,
    description:'Programmed register state at source time, not audible output time or an envelope/audio save state. Unwritten raw registers are zero. Sample memory is not included.',registers:Array.from(registers)};
  if(chip==='ym2151')return {...result,...opm.snapshot()};
  const slots=[0,1,2,8,9,10,16,17,18];
  result.newMode=!!(registers[0x105]&1);result.fourOpMask=registers[0x104]&63;result.rhythm=registers[0xbd];
  result.channels=describeOpl3Notes(registers,result.clock,chip).map((note,i)=>{
    const bank=i>=9?256:0,local=i%9,c=registers[bank+0xc0+local];
    return {channel:i+1,...note,pairChannel:note.paired?(note.slave?i-2:i+4):null,
      connection:c&1,feedback:(c>>1)&7,outputMask:c>>4,
      operators:[slots[local],slots[local]+3].map(slot=>{
        const offset=bank+slot,a=registers[0x20+offset],b=registers[0x40+offset],d=registers[0x60+offset],e=registers[0x80+offset];
        return {offset,am:!!(a&128),vibrato:!!(a&64),sustain:!!(a&32),ksr:!!(a&16),multiplier:a&15,
          ksl:b>>6,totalLevel:b&63,attack:d>>4,decay:d&15,sustainLevel:e>>4,release:e&15,waveformRegister:registers[0xe0+offset]};
      })};
  });
  if(chip==='ymf278b'){
    result.pcm={registers:Array.from(pcm),description:'Explicit PCM register writes only; wave-header auto-loaded parameters and sample memory are not reconstructed.'};
  }
  return result;
}
