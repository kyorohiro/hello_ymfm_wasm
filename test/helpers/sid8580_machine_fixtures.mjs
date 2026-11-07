// SPDX-License-Identifier: BSD-3-Clause
// Original, small machine programs. No game music, ROM bytes or replay trace.
// The old authored helpers and their PAL6581 headers are never modified.
import {createPsidVbiMachineFixture} from './psid_vbi_machine_fixtures.mjs';
import {createPsidCiaFixture} from './psid_cia_fixtures.mjs';
import {createRsidFixture} from './rsid_fixtures.mjs';

export const SID8580_MACHINE_CLOCK = 985248;
export const SID8580_MACHINE_PROFILES = Object.freeze([
  'psid-vbi','psid-cia','psid-long-init','rsid-cia-irq','rsid-raster-irq',
  'rsid-cia-nmi','rsid-multispeed','bus-immediate','bus-aged','osc-env-branches',
  'pot-x','pot-y','pot-banked-ram',
]);
const LOAD=0x1000,SIGNATURE=0x0330;
class Program {
  bytes=[];labels=new Map();references=[];
  label(name){if(this.labels.has(name))throw new Error('Duplicate machine8580 label');this.labels.set(name,this.bytes.length);}
  emit(...bytes){this.bytes.push(...bytes);}
  address(name){if(!this.labels.has(name))throw new Error('Missing machine8580 label');return LOAD+this.labels.get(name);}
  absolute(opcode,target){
    this.emit(opcode);
    if(typeof target==='string'){this.references.push({at:this.bytes.length,target});this.emit(0,0);}
    else this.emit(target&255,target>>>8);
  }
  branch(opcode,target){this.emit(opcode);this.references.push({at:this.bytes.length,target,relative:true});this.emit(0);}
  store(address,value){this.emit(0xa9,value);this.absolute(0x8d,address);}
  finish(){
    for(const {at,target,relative}of this.references){
      const address=this.address(target);
      if(relative){const delta=address-(LOAD+at+1);if(delta< -128||delta>127)throw new Error('machine8580 branch range');this.bytes[at]=delta&255;}
      else{this.bytes[at]=address&255;this.bytes[at+1]=address>>>8;}
    }
    return Uint8Array.from(this.bytes);
  }
}
function declared8580(fixture){
  const bytes=fixture.bytes.slice(),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  view.setUint16(118,(view.getUint16(118)&~0x3c)|0x24); // PAL + MOS8580; retain other authored flags.
  return {...fixture,bytes};
}
function descriptor(profile,fixture,metadata){
  return {...declared8580(fixture),profile,declaredClock:'pal',declaredModel:'8580',clockHz:SID8580_MACHINE_CLOCK,
    environment:'minimal',...metadata};
}
function wait(p,label,outer){
  p.emit(0xa0,outer);p.label(label+'-outer');p.emit(0xa2,0);p.label(label+'-inner');
  p.emit(0xca);p.branch(0xd0,label+'-inner');p.emit(0x88);p.branch(0xd0,label+'-outer');
}
function psid(program,init,play,name){
  const bytes=new Uint8Array(124+program.length),view=new DataView(bytes.buffer);
  bytes.set([80,83,73,68]);view.setUint16(4,2);view.setUint16(6,124);view.setUint16(8,LOAD);
  view.setUint16(10,init);view.setUint16(12,play);view.setUint16(14,1);view.setUint16(16,1);view.setUint16(118,0x24);
  for(const [at,text]of [[22,'Tetorica8580 '+name],[54,'Tetorica contributors'],[86,'2026 BSD-3-Clause']])bytes.set(new TextEncoder().encode(text).subarray(0,32),at);
  bytes.set(program,124);return {bytes,program,loadAddress:LOAD,initAddress:init,playAddress:play};
}
function causal(profile,{filter=false}={}){
  const p=new Program(),reads=[],expectedRam=[],expectedNonzeroRam=[],feedback=[];
  p.label('init');p.emit(0x78);p.store(0xd011,0); // No bad-line stalls: an immediate STA is exactly four CPU cycles after LDA.
  for(let i=0;i<16;i++)p.store(SIGNATURE+i,0);
  for(const [reg,value]of [[4,0],[2,0],[3,8],[5,0],[6,0xf0],[0,0x45],[1,0x1d],[24,8],[4,0x41]])p.store(0xd400+reg,value);
  let expectedError=null;
  if(profile==='bus-immediate'||profile==='bus-aged'){
    p.store(0xd400,0x11);p.store(0xd402,0xa5); // Reading register0 must return the last bus byte, not register0's written shadow.
    if(profile==='bus-aged')wait(p,'bus-age',32); // About41k machine cycles: beyond6581 TTL, below8580 TTL.
    p.label('read-bus');p.absolute(0xad,0xd400);p.absolute(0x8d,0xd400);p.absolute(0x8d,SIGNATURE);
    reads.push({address:0xd400,register:0,value:0xa5,pc:p.address('read-bus')});
    feedback.push({readIndex:0,writeRegister:0,cyclesAfterRead:4,valueFromRead:true});
    p.emit(0xc9,0xa5);p.branch(0xd0,'bad');p.store(SIGNATURE+1,0x31);p.absolute(0x4c,'complete');
    p.label('bad');p.store(SIGNATURE+1,0x32);
    expectedRam.push([SIGNATURE,0xa5],[SIGNATURE+1,0x31]);
  }else if(profile==='osc-env-branches'){
    for(const [reg,value]of [[14,0x45],[15,0x1d],[19,0],[20,0xf0],[18,0x19]])p.store(0xd400+reg,value);
    wait(p,'attack',16);
    p.label('read-test-osc');p.absolute(0xad,0xd41b);p.absolute(0x8d,SIGNATURE);p.branch(0xd0,'bad');
    p.label('read-env');p.absolute(0xad,0xd41c);p.absolute(0x8d,SIGNATURE+1);p.emit(0xc9,255);p.branch(0xd0,'bad');
    p.store(0xd412,0x11);wait(p,'phase',1);
    p.label('read-running-osc');p.absolute(0xad,0xd41b);p.absolute(0x8d,0xd400);p.absolute(0x8d,SIGNATURE+2);p.branch(0xf0,'bad');
    p.label('read-running-env');p.absolute(0xad,0xd41c);p.absolute(0x8d,0xd401);p.absolute(0x8d,SIGNATURE+3);p.emit(0xc9,255);p.branch(0xd0,'bad');
    p.store(SIGNATURE+14,0x51);p.absolute(0x4c,'complete');p.label('bad');p.store(SIGNATURE+14,0x52);
    reads.push({address:0xd41b,register:27,value:0,pc:p.address('read-test-osc')},
      {address:0xd41c,register:28,value:255,pc:p.address('read-env')},
      {address:0xd41b,register:27,nonzero:true,ram:SIGNATURE+2,pc:p.address('read-running-osc')},
      {address:0xd41c,register:28,value:255,pc:p.address('read-running-env')});
    feedback.push({readIndex:2,writeRegister:0,cyclesAfterRead:4,valueFromRead:true},
      {readIndex:3,writeRegister:1,cyclesAfterRead:4,valueFromRead:true});
    expectedRam.push([SIGNATURE,0],[SIGNATURE+1,255],[SIGNATURE+3,255],[SIGNATURE+14,0x51]);expectedNonzeroRam.push(SIGNATURE+2);
  }else{
    const reg=profile==='pot-y'?26:25,address=0xd400+reg;
    if(profile==='pot-banked-ram'){
      p.store(1,0x34);p.store(address,0x3c);p.absolute(0xad,address);p.absolute(0x8d,SIGNATURE);
      p.store(1,0x35);expectedRam.push([SIGNATURE,0x3c]);
    }else expectedRam.push([SIGNATURE,0]);
    p.label('read-pot');p.absolute(0xad,address);p.absolute(0x8d,SIGNATURE+15);
    reads.push({address,register:reg,unsupported:true,pc:p.address('read-pot')});
    expectedError={kind:'unsupported-sid-read',address,register:reg};
  }
  p.label('complete');
  // An explicit positive-control variant, not an alteration to the13 default
  // fixtures. Activate a real chip filter only after the causal read/branch.
  if(filter)for(const [reg,value]of [[21,0],[22,64],[23,0xc1],[24,0x18]])p.store(0xd400+reg,value);
  p.store(SIGNATURE+15,0xa5);p.emit(0x60);
  p.label('play');p.absolute(0xee,SIGNATURE+4);p.absolute(0xad,SIGNATURE+4);p.absolute(0x8d,0xd402);p.emit(0x60);
  const program=p.finish();expectedRam.push([SIGNATURE+15,expectedError?0:0xa5]);
  return descriptor(profile,psid(program,p.address('init'),p.address('play'),profile),{
    format:'PSID',timing:'vbi',subtune:1,expectedInitReturned:!expectedError,
    signatureAddress:SIGNATURE,counterAddress:SIGNATURE+4,expectedRam,expectedNonzeroRam,expectedError,
    expectedReads:reads,feedback,filterEnabled:filter,
    filterControl:filter?{cutoff:512,resonance:12,mode:'lowpass',routing:1,volume:8}:null,
    readCycleConvention:'Number of completed SID ticks: CPU tick, SID tick/sample, then bus access. An old preincrement machine write trace for the same access is one less.',
    bankedRamRead:profile==='pot-banked-ram'?{address:0xd419,value:0x3c,signatureAddress:SIGNATURE,notASidRead:true}:null,
    modelDistinction:profile==='bus-aged'?{mos6581Read:0,mos8580Read:0xa5,marker8580:0x31,markerOther:0x32}:null,
  });
}

/** Fresh bytes per call. Expected CPU outcomes never inject SID read values. */
export function createSid8580MachineFixture(profile='psid-vbi',{filter=false}={}){
  if(!SID8580_MACHINE_PROFILES.includes(profile))throw new RangeError('Unknown SID8580 machine fixture');
  if(typeof filter!=='boolean')throw new TypeError('Machine8580 fixture filter option must be boolean');
  if(filter&&profile!=='bus-immediate')throw new RangeError('The filter positive control is a bus-immediate variant');
  if(profile==='psid-vbi'||profile==='psid-long-init')return descriptor(profile,
    createPsidVbiMachineFixture({delayBlocks:profile==='psid-long-init'?1:0,delayOuter:110}),
    {format:'PSID',timing:'vbi',subtune:1,expectedInitReturned:true,expectedLongInit:profile==='psid-long-init',expectedError:null});
  if(profile==='psid-cia')return descriptor(profile,createPsidCiaFixture({variable:true,observeIcr:true}),
    {format:'PSID',timing:'cia',subtune:2,expectedInitReturned:true,expectedError:null});
  if(profile.startsWith('rsid-')){
    const original=profile.slice(5),fixture=createRsidFixture(original);
    return descriptor(profile,fixture,{format:'RSID',timing:'machine',subtune:1,
      expectedInitReturned:!fixture.initBusyLoop,expectedError:null,expectedHostPlayCalls:0});
  }
  return causal(profile,{filter});
}
export function sid8580MachineFixtures(){return SID8580_MACHINE_PROFILES.map(profile=>createSid8580MachineFixture(profile));}
