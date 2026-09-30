import {ym2203HighOperation} from './ym2203_high.js';
/** Only replace byte-identical contiguous writes. Memory events are barriers. */
export function ym2608HighOperation(events, index, registers) {
  const e = events[index];
  if (e.type !== 'ym2608-write') return null;
  const {port, register:r, value:v, time} = e;
  const result = (code, count=1) => ({code,count});
  const at = n => { const a=events[index+n];return a?.type==='ym2608-write'&&a.port===port&&a.time===time?a:null; };
  if (port===0 && r===0x10 && !(v&64) && (v&63)) {
    const voices=[0,1,2,3,4,5].filter(ch=>v&(1<<ch));
    return result(`opna.rhythm.${v&128?'keyOff':'keyOn'}(${JSON.stringify(voices)});`);
  }
  if (port===0 && r===0x11 && v<=63) return result(`opna.rhythm.setVolume(${v});`);
  if (port===0 && r>=0x18 && r<=0x1d && (v&32)===(registers[0][r]&32))
    return result(`opna.rhythm.setVoice(${r-0x18}, {volume: ${v&31}, left: ${!!(v&128)}, right: ${!!(v&64)}});`);
  if (port===1 && r<0x10) {
    if(r===0 && [1,0xa0,0xb0].includes(v))return result(v===1?'opna.adpcm.keyOff();':`opna.adpcm.keyOn({repeat: ${v===0xb0}});`);
    if(r===11)return result(`opna.adpcm.setVolume(${v});`);
    if(r===1 && (v&63)===(registers[1][1]&63))return result(`opna.adpcm.setPan(${!!(v&128)}, ${!!(v&64)});`);
    if(r===9 && at(1)?.register===10 && (v|at(1).value<<8)>0)return result(`opna.adpcm.setDeltaN(${v|at(1).value<<8});`,2);
    return null;
  }
  if(port===0 && r===0x28 && (v&15)>=4 && (v&15)<=6){
    const ch=(v&7)-1,ops=[0,1,2,3].filter(op=>v&(16<<op));
    return result(ops.length?`opna.keyOn(${ch}, ${JSON.stringify(ops)});`:`opna.keyOff(${ch});`);
  }
  if(port===1 && r<0x30)return null;
  const nearby=[];
  for(let n=0;n<4;n++){const a=at(n);if(!a)break;nearby.push([a.time,a.register,a.value]);}
  const op=ym2203HighOperation(nearby,0,registers[port]);
  if(!op)return null;
  let code=op.code.replaceAll('opn.','opna.');
  if(port===1)code=code.replace(/opna\.(setOperator|setAlgo|setFrequency)\((\d+)/,(_,method,ch)=>`opna.${method}(${Number(ch)+3}`);
  return result(code,op.count);
}
