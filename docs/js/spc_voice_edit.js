/** Bounded per-voice edits. Packed fields merge with actual current DSP bytes. */
const ranges={volumeLeft:[-128,127],volumeRight:[-128,127],pitch:[0,16383],attack:[0,15],decay:[0,7],sustainLevel:[0,7],sustainRate:[0,31],gainLevel:[0,127],gainRate:[0,31]};
const gainModes=['direct','linear-decrease','exponential-decrease','linear-increase','bent-increase'];
export function validateSpcVoiceEdit(channel,changes){
 if(!Number.isInteger(channel)||channel<0||channel>7)throw RangeError('SPC channel must be 0..7');
 if(!changes||typeof changes!=='object'||Array.isArray(changes)||![Object.prototype,null].includes(Object.getPrototypeOf(changes)))throw TypeError('Expected SPC voice changes');
 const keys=Reflect.ownKeys(changes);if(!keys.length||keys.length>11)throw TypeError('Expected 1–11 SPC voice fields');
 const result={};for(const key of keys){const value=changes[key];
  if(Object.hasOwn(ranges,key)){const [min,max]=ranges[key];if(!Number.isInteger(value)||value<min||value>max)throw RangeError(`Invalid SPC ${key}`);}
  else if(key==='envelopeMode'){if(!['adsr','gain'].includes(value))throw TypeError('Invalid SPC envelope mode');}
  else if(key==='gainMode'){if(!gainModes.includes(value))throw TypeError('Invalid SPC GAIN mode');}
  else throw TypeError('Unsupported SPC voice field: '+String(key));result[key]=value;
 }return result;
}
export function spcVoiceWrites(channel,changes,dsp){
 const edit=validateSpcVoiceEdit(channel,changes);if(!(dsp instanceof Uint8Array)||dsp.length!==128)throw TypeError('Expected 128 DSP bytes');
 const base=channel*16,registers=new Map();const read=offset=>registers.get(base+offset)??dsp[base+offset],write=(offset,value)=>registers.set(base+offset,value&255);
 // Deterministic merging permits mode + level/rate in the same atomic request.
 for(const key of ['volumeLeft','volumeRight','pitch','envelopeMode','attack','decay','sustainLevel','sustainRate','gainMode','gainLevel','gainRate']){
  if(!Object.hasOwn(edit,key))continue;const value=edit[key];
  if(key==='volumeLeft')write(0,value);else if(key==='volumeRight')write(1,value);
  else if(key==='pitch'){write(2,value&255);write(3,(read(3)&0xc0)|(value>>8));}
  else if(key==='envelopeMode')write(5,(read(5)&127)|(value==='adsr'?128:0));
  else if(key==='attack')write(5,(read(5)&0xf0)|value);
  else if(key==='decay')write(5,(read(5)&0x8f)|(value<<4));
  else if(key==='sustainLevel')write(6,(read(6)&31)|(value<<5));
  else if(key==='sustainRate')write(6,(read(6)&0xe0)|value);
  else if(key==='gainMode'){const mode=gainModes.indexOf(value);write(7,mode===0?read(7)&127:128|((mode-1)<<5)|(read(7)&31));}
  else if(key==='gainLevel'){if(read(7)&128)throw Error('GAIN mode changed; choose Direct level first.');write(7,value);}
  else if(key==='gainRate'){if(!(read(7)&128))throw Error('GAIN mode changed; choose a dynamic GAIN shape first.');write(7,(read(7)&0xe0)|value);}
 }
 return [...registers];
}
