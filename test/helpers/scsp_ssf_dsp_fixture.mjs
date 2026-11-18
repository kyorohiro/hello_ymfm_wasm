// SPDX-License-Identifier: BSD-3-Clause
// Original 68000 and DSP programs, with no game code or recorded data.
import {ssfFromProgram} from './scsp_ssf_fixture.mjs';

export function createScspSsfDspFixture(){
  const image=new Uint8Array(0x6080),view=new DataView(image.buffer),program=new Uint16Array(512);
  const coefficients=Int16Array.from({length:64},(_,index)=>index===0?4095:index===1?-2048:[-4096,-1,0,1,2048,4095][index%6]);
  const addresses=Uint16Array.from({length:32},(_,index)=>(0x8000^(index*0x1111))&0xffff);
  for(let output=0;output<16;output++){
    // MIXS0 × COEF0/1, zero B; the next instruction emits the previous result.
    // These independently authored Mednafen register words intentionally do not
    // call the Synth assembler or its executable-profile validator.
    const prepare=(1n<<47n)|(32n<<38n)|(1n<<45n)|(BigInt(output%2)<<9n)|(1n<<17n);
    const emit=(1n<<28n)|(BigInt(output)<<24n)|(1n<<17n);
    for(const [step,instruction]of [[output*2,prepare],[output*2+1,emit]])
      for(let part=0;part<4;part++)program[step*4+part]=Number((instruction>>BigInt(48-part*16))&0xffffn);
  }
  // Unused instruction bits must survive observation, even outside the Synth's
  // limited execution profile. They have no effect in this pinned interpreter.
  for(let step=32;step<128;step++)program.set([0x8000,0x1000,0x0000,0x8080],step*4);
  view.setUint32(0,0x7fff0,false);view.setUint32(4,0x100,false);
  let pc=0x100;const word=value=>{view.setUint16(pc,value,false);pc+=2;};
  const write=(register,value)=>{word(0x33fc);word(value);view.setUint32(pc,0x100000+register,false);pc+=4;};
  word(0x46fc);word(0x2000);
  write(0x400,0x020f);
  for(let index=0;index<512;index++)write(0x800+index*2,program[index]);
  for(let index=0;index<64;index++)write(0x700+index*2,(coefficients[index]&0x1fff)<<3);
  for(let index=0;index<32;index++)write(0x780+index*2,addresses[index]);
  // Return controls are shared EFREG0..15, configured through slots0..15.
  for(let index=0;index<16;index++)write(index*32+22,((1+index%7)<<5)|(index*3&31));
  // SDIR bypasses EG/TL on the synthetic constant source, making the DSP's
  // expected signed outputs derivable directly from its coefficient codes.
  for(const [register,value]of [[2,0x6000],[4,0],[6,64],[8,31],[10,0x3c1f],[12,0x100],[14,0],[16,0],[18,0],[20,7]])write(register,value);
  write(0,0x1820);const idleAddress=pc;word(0x60fe);
  for(let index=0;index<64;index++)view.setInt16(0x6000+index*2,4096,false);
  if(pc>=0x6000)throw new Error('Original DSP fixture program overlaps its PCM');
  const bytes=ssfFromProgram(image,0,'title=Tetorica original SSF DSP observer\nartist=Tetorica\nlength=0:01\nfade=0\n');
  return {image,bytes,files:[{path:'/ssf/dsp-observer.ssf',data:bytes}],program,coefficients,addresses,idleAddress,
    outputs:Int16Array.from({length:16},(_,index)=>index%2?-2048:4095)};
}

/** Same original DSP setup, with later CPU writes for visible Live/Pause/Seek.
 * Only the new fixture changes; the static fixture's complete bytes stay exact. */
export function createScspSsfDspMotionFixture(){
  const initial=createScspSsfDspFixture(),image=initial.image.slice(),view=new DataView(image.buffer);
  let pc=0x5800;const word=value=>{view.setUint16(pc,value,false);pc+=2;},long=value=>{view.setUint32(pc,value,false);pc+=4;};
  const write=(register,value)=>{word(0x33fc);word(value);long(0x100000+register);};
  const delay=()=>{word(0x203c);long(300000);word(0x5380);word(0x66fc);};
  view.setUint16(initial.idleAddress,0x4ef9,false);view.setUint32(initial.idleAddress+2,pc,false);
  const loop=pc;
  delay();write(0x702,(-1024&0x1fff)<<3);write(0x800+127*8,0);write(0x780+31*2,0x2468);
  delay();write(0x702,(-2048&0x1fff)<<3);write(0x800+127*8,0x8000);write(0x780+31*2,initial.addresses[31]);
  word(0x4ef9);long(loop);
  const bytes=ssfFromProgram(image,0,'title=Tetorica original SSF DSP Live motion\nartist=Tetorica\nlength=0:04\nfade=0\n');
  return {...initial,image,bytes,files:[{path:'/ssf/dsp-motion.ssf',data:bytes}],motion:{coefficient:1,coefficientValues:[-2048,-1024],programWord:508,programValues:[0x8000,0],address:31,addressValues:[initial.addresses[31],0x2468]}};
}
