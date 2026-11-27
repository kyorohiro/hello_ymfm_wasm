// SPDX-License-Identifier: BSD-3-Clause
// Keep the original two-byte protocol, including a start addressed to several voices.
export function writePerformanceCommand(chip,byte,samples,attenuation){
  if(chip.pending<0){chip.command(byte);return byte;}
  const level=attenuation??(byte&15);
  if(samples?.some(id=>id!=null) && (byte&0xf0)){
    const original=chip.pending;
    for(let voice=0;voice<4;voice++){
      if(!(byte&(16<<voice)))continue;
      chip.pending=samples[voice]??original;
      chip.command((16<<voice)|level);
    }
  }else chip.command((byte&0xf0)|level);
  return (byte&0xf0)|level;
}
