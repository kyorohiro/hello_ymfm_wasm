// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro and Tetorica contributors.
// Entire diagnostic program and note/control data are newly authored here.
export const SID_REFERENCE_FIXTURES=Object.freeze(['tone','pulse','noise','melody-filter']);
export const SID_REFERENCE_CLOCK=985248;
const LOAD=0x1000,BASE=0xd400,HEADER=0x7c;
const op={ldaImmediate:0xa9,staAbsolute:0x8d,incAbsolute:0xee,ldaAbsolute:0xad,andImmediate:0x29,lsrA:0x4a,tax:0xaa,ldaAbsoluteX:0xbd,rts:0x60};
class Program {
  bytes=[];labels=new Map();references=[];
  label(name){if(this.labels.has(name))throw new Error('Duplicate fixture label');this.labels.set(name,this.bytes.length);}
  emit(...bytes){this.bytes.push(...bytes);}
  absolute(opcode,address){this.emit(opcode);if(typeof address==='string'){this.references.push({at:this.bytes.length,label:address});this.emit(0,0);}else this.emit(address&255,address>>>8);}
  finish(){for(const{at,label}of this.references){if(!this.labels.has(label))throw new Error('Unknown fixture label');const address=LOAD+this.labels.get(label);this.bytes[at]=address&255;this.bytes[at+1]=address>>>8;}return Uint8Array.from(this.bytes);}
  address(label){return LOAD+this.labels.get(label);}
}
const write=(register,value)=>({address:BASE+register,register,value});
const sidFrequency=midi=>Math.round(440*2**((midi-69)/12)*16777216/SID_REFERENCE_CLOCK);
const field=(bytes,at,value)=>bytes.set(new TextEncoder().encode(value).subarray(0,32),at);

/** A deterministic PSID with a tiny straight-line init/play program. All timing
 * comes from the external C64 CPU. Expected writes deliberately have no cycle.
 * callIndex 0 means the first play invocation following init.
 */
export function createSidReferenceFixture(profile='melody-filter',{version=2,embeddedLoadAddress=true}={}){
  if(!SID_REFERENCE_FIXTURES.includes(profile))throw new RangeError(`Unknown SID reference profile: ${profile}`);
  if(![2,3,4].includes(version))throw new RangeError('Fixture PSID version must be 2, 3 or 4');
  if(typeof embeddedLoadAddress!=='boolean')throw new TypeError('embeddedLoadAddress must be boolean');
  const tone=profile==='tone',filtered=profile==='melody-filter',pulse=profile==='pulse';
  const waveform=tone?0x10:pulse?0x40:profile==='noise'?0x80:0x20;
  const notes=tone?Array(8).fill(69):[60,64,67,72,71,67,62,55];
  const frequencies=notes.map(sidFrequency),widths=[512,1024,1536,2048,2560,3072,3584,2048];
  const cutoff=[300,450,700,1000,1450,1800,1000,600],resonance=[1,2,4,7,10,12,7,4];
  const controls=(tone?Array(8).fill(true):[true,true,false,true,true,false,true,false]).map(gate=>waveform+(gate?1:0));
  const program=new Program(),expectedInitWrites=[];
  const immediate=(register,value)=>{program.emit(op.ldaImmediate,value);program.absolute(op.staAbsolute,BASE+register);expectedInitWrites.push(write(register,value));};
  program.label('init');program.emit(op.ldaImmediate,0);program.absolute(op.staAbsolute,'counter');
  for(let register=0;register<=24;register++)immediate(register,0);
  for(const[register,value]of [[2,0],[3,8],[5,0x26],[6,0xc5],[21,filtered?600&7:0],[22,filtered?600>>>3:0],[23,filtered?0x41:0],[24,filtered?0x18:8],[0,frequencies[0]&255],[1,frequencies[0]>>>8],[4,controls[0]]])immediate(register,value);
  program.emit(op.rts);
  program.label('play');program.absolute(op.incAbsolute,'counter');program.absolute(op.ldaAbsolute,'counter');program.emit(op.andImmediate,31);program.absolute(op.staAbsolute,'counter');program.emit(op.lsrA,op.lsrA,op.tax);
  const tables=[];
  const tableWrite=(label,register,values)=>{program.absolute(op.ldaAbsoluteX,label);program.absolute(op.staAbsolute,BASE+register);tables.push({label,register,values});};
  tableWrite('frequencyLow',0,frequencies.map(value=>value&255));tableWrite('frequencyHigh',1,frequencies.map(value=>value>>>8));
  if(pulse){tableWrite('pulseLow',2,widths.map(value=>value&255));tableWrite('pulseHigh',3,widths.map(value=>value>>>8));}
  if(filtered){tableWrite('cutoffLow',21,cutoff.map(value=>value&7));tableWrite('cutoffHigh',22,cutoff.map(value=>value>>>3));tableWrite('resonance',23,resonance.map(value=>(value<<4)|1));}
  tableWrite('control',4,controls);program.emit(op.rts);
  for(const{label,values}of tables){program.label(label);program.emit(...values);}
  program.label('counter');program.emit(0);
  const binary=program.finish(),bytes=new Uint8Array(HEADER+(embeddedLoadAddress?2:0)+binary.length),view=new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('PSID'));view.setUint16(4,version);view.setUint16(6,HEADER);view.setUint16(8,embeddedLoadAddress?0:LOAD);view.setUint16(10,program.address('init'));view.setUint16(12,program.address('play'));view.setUint16(14,1);view.setUint16(16,1);view.setUint32(18,0);
  field(bytes,0x16,`Tetorica ${profile}`);field(bytes,0x36,'Tetorica contributors');field(bytes,0x56,'2026 BSD-3-Clause');view.setUint16(0x76,0x14);
  let dataOffset=HEADER;if(embeddedLoadAddress){view.setUint16(dataOffset,LOAD,true);dataOffset+=2;}bytes.set(binary,dataOffset);
  return {profile,bytes,program:binary,loadAddress:LOAD,initAddress:program.address('init'),playAddress:program.address('play'),clock:SID_REFERENCE_CLOCK,model:'6581',playPeriodCalls:32,
    expectedInitWrites:expectedInitWrites.map(value=>({...value})),
    expectedPlayWrites(callIndex){if(!Number.isSafeInteger(callIndex)||callIndex<0)throw new RangeError('play call index must be a nonnegative safe integer');const step=((callIndex+1)%32)>>>2;return tables.map(({register,values})=>write(register,values[step]));},
  };
}
