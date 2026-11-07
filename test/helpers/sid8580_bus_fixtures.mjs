// SPDX-License-Identifier: BSD-3-Clause
// Reference-measured software decay windows, not guaranteed real-chip timings.
export const SID_BUS_TTL={6581:7424,8580:663552};
export function sid8580BusFixtures(model){
  const ttl=SID_BUS_TTL[model],half=ttl/2; if(!ttl)throw Error('Invalid model');
  const scenes=[];
  function add(name,commands,expectedReads,referenceShouldMatch=true){scenes.push({name,commands,expectedReads,referenceShouldMatch,
    cycles:commands.filter(c=>c[0]==='c').reduce((n,c)=>n+c[1],0)});}
  add('latest-valid-write',[['w',0,165],['r',1],['w',7,60],['r',31],['w',31,240],['r',24]],[165,60,240]);
  add('fresh-write-expiry',[['w',0,165],['c',ttl],['r',31]],[0]);
  add('fresh-write-last-retained',[['w',0,165],['c',ttl-1],['r',31]],[165]);
  add('read-halves-retention',[['w',0,165],['r',31],['c',half],['r',31]],[165,0]);
  add('read-shortened-last-cycle',[['w',0,165],['r',31],['c',half-1],['r',31]],[165,165]);
  add('bounded-residual-expiry',[['w',0,165],['c',ttl-1],['r',31],['c',1],['r',31]],[165,0],false);
  add('repeated-no-clock-reads',[['w',0,165],...Array.from({length:24},()=>['r',31]),['c',1],['r',31]],[...Array(24).fill(165),0],false);
  add('envelope-read-drives-bus',[['w',19,0],['w',20,240],['w',18,33],['c',2300],['r',28],['r',0],['c',half],['r',31]],[255,255,0]);
  const osc=Math.floor(((1000*0x2345)%0x1000000)/65536);
  add('oscillator-read-drives-bus',[['w',14,0x45],['w',15,0x23],['w',18,0x20],['c',1000],['r',27],['r',0]],[osc,osc],false);
  // TEST removes the oscillator reset-phase difference from this fixture.
  add('read-only-write-still-drives-bus',[['w',18,0x28],['c',100],['w',27,165],['r',0],['r',27],['r',31]],[165,0,0]);
  add('zero-byte-clears-latch',[['w',0,165],['w',31,0],['r',0],['c',ttl],['r',31]],[0,0]);
  return scenes;
}
