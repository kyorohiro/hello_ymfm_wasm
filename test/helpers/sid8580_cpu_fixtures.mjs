// SPDX-License-Identifier: BSD-3-Clause
// Expected observable outcomes for the original programs built in cpu.rs.
// No SID values are injected into the CPU. Check real reads, RAM branches and
// ensuing SID writes together, and hash exported actual program bytes.
export const SID8580_CPU_CLOCK = 985248;
export const SID8580_CPU_LOAD = 0x0800;
export const SID8580_CPU_STATE = Object.freeze({error:0,stopped:1,fixture:2,rate:3,model:4,
  pc:5,a:6,x:7,y:8,s:9,p:10,done:11,faultAddress:12,traceOverflow:13,instructions:14});
export const SID8580_CPU_FIXTURES = Object.freeze([
  {id:0,name:'bus-immediate',cycles:120000,error:0,done:true,
    signature:{0:0xa5,1:0x11,14:0,15:0xa5},finalSid:{0:0x40},reads:[{address:0xd400,value:0xa5,error:0}]},
  {id:1,name:'bus-aged',cycles:120000,error:0,done:true,
    byModel:{6581:{signature:{0:0,1:0x32,14:0,15:0xa5},finalSid:{0:0x40},reads:[{address:0xd400,value:0,error:0}]},
      8580:{signature:{0:0xa5,1:0x31,14:0,15:0xa5},finalSid:{0:0x80},reads:[{address:0xd400,value:0xa5,error:0}]}}},
  {id:2,name:'osc-env-branches',cycles:120000,error:0,done:true,
    signature:{0:0,1:255,3:255,14:0x51,15:0xa5},nonzeroSignature:[2],
    finalSidFromSignature:{0:2},reads:[{address:0xd41b,value:0,error:0},{address:0xd41c,value:255,error:0},
      {address:0xd41b,nonzero:true,signature:2,error:0},{address:0xd41c,value:255,error:0}]},
  {id:3,name:'unsupported-pot',cycles:120000,error:5,done:false,faultAddress:0xd419,
    signature:{0:0,15:0},reads:[{address:0xd419,value:256,error:5}]},
  {id:4,name:'jam',cycles:120000,error:10,done:false,faultAddress:0x0806,
    signature:{0:0x4a,15:0},reads:[]},
  {id:5,name:'unsupported-rom',cycles:120000,error:3,done:false,faultAddress:0xe000,
    signature:{0:0,15:0},reads:[]},
]);
export function sid8580CpuFixtures() {return structuredClone(SID8580_CPU_FIXTURES);}
export function sid8580CpuExpected(fixture,model) {
  return {...fixture,...fixture.byModel?.[model]};
}
export function sid8580CpuProtocol(fixture,rate=48000,model=8580,{chunk=null,stop=false,reset=false}={}) {
  if(chunk!==null&&(!Number.isSafeInteger(chunk)||chunk<1))throw new RangeError('CPU protocol chunk must be a positive integer');
  const lines=[`SID8CPU 1 ${rate} ${model} ${fixture.id}`];
  for(let left=fixture.cycles;left>0;) {const count=Math.min(left,chunk??left);lines.push(`c ${count}`);left-=count;}
  if(stop) lines.push('stop','c 1000');
  if(reset) lines.push('reset','c 1000');
  return lines.join('\n')+'\n';
}
