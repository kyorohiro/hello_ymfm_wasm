// Test/benchmark-only, original register fixtures; no game data or audio device.
import {vgm,write,wait,voice,init,block,streamSetup,streamStart} from './song_test_helpers.mjs';
const waits=samples=>{const result=[];while(samples>0){const length=Math.min(65535,samples);result.push(...wait(length));samples-=length;}return result;};
export function createSeekFixture(kind,seconds=2.5){
  const total=Math.max(1,Math.round(seconds*44100)),first=Math.min(11025,total),rest=total-first;let commands;
  if(kind==='wave')commands=[...init,...voice(0),...waits(first),...write(2,98),...write(3,1),...write(5,0xd9),...write(4,151),...waits(rest)];
  else if(kind==='lfo')commands=[...init,...voice(1,{period:19}),...voice(0),...write(8,7),...write(9,2),...waits(first),...write(8,3),...waits(rest)];
  else if(kind==='noise')commands=[...init,...voice(4,{noise:true}),...waits(first),...write(7,0x9d),...waits(rest)];
  else if(kind==='dda'){
    const pcm=Array.from({length:64},(_,i)=>Math.round(15.5+15.5*Math.sin(i*Math.PI/32)));
    commands=[...init,...voice(0,{dda:true}),...block(pcm),...streamSetup(0,0,7000),...streamStart(pcm.length,{mode:129}),...waits(total),0x94,0];
  }else throw RangeError('Expected Wave/LFO/Noise/DDA seek fixture');
  return vgm(commands);
}
