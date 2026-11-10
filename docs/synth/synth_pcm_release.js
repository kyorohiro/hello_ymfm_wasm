// App-only release smoothing. The RF5C164 core and its ordinary keyOff remain
// unchanged. Only releaseNote() asks this host to fade a physical voice.
import {RF5C164Synth} from '../js/rf5c164synth.js?v=audio-stability-2';

export const PCM_RELEASE_SECONDS=.004;
const channel=value=>{
  if(!Number.isInteger(value)||value<0||value>7)throw new RangeError('PCM release channel must be in range 0..7');
  return value;
};

/**
 * Wrap a new/reset raw RF5C164Synth and route every control through pcm. A true
 * note release moves that channel's real eight-bit volume to zero for 4 ms,
 * then masks it off. The original renderer is untouched while no tail exists.
 * Main-thread timers, output gain and the other channels are never involved.
 */
export function createSynthPcmRelease({pcm:raw,sampleRate,renderAudio}={}) {
  if(['writeRegister','loadMemory','reset'].some(name=>typeof raw?.[name]!=='function')||typeof renderAudio!=='function') {
    throw new TypeError('PCM release needs a synchronous RF5C164 and stereo renderer');
  }
  if(typeof sampleRate!=='number'||!Number.isFinite(sampleRate)||sampleRate<=0||sampleRate>768000)throw new RangeError('Invalid PCM release sample rate');
  const releaseFrames=Math.max(1,Math.round(sampleRate*PCM_RELEASE_SECONDS));
  const quantum=Math.max(1,Math.round(sampleRate/16000));
  const baseVolumes=new Uint8Array(8),actualVolumes=new Uint8Array(8),releases=new Map();
  let frame=0,selected=0,control=0,actualMask=255;
  const level=tail=>Math.max(0,1-(frame-tail.start)/releaseFrames);
  const mask=value=>{raw.writeRegister(8,value);actualMask=value;};
  function writeVolume(ch,value) {
    if(actualVolumes[ch]===value)return;
    // An envelope write must not move the author's banked-register target or
    // enable a globally disabled chip. RAM-window selection is restored too.
    raw.writeRegister(7,(control&128)|64|ch);raw.writeRegister(0,value);
    if(ch!==selected)raw.writeRegister(7,(control&128)|64|selected);
    if(!(control&64))raw.writeRegister(7,control);
    actualVolumes[ch]=value;
  }
  function write(register,value) {
    if(register===0) {
      baseVolumes[selected]=value;
      const tail=releases.get(selected),actual=tail?Math.round(value*level(tail)):value;
      raw.writeRegister(register,actual);actualVolumes[selected]=actual;return;
    }
    if(register===8) {
      // Raw mask writes are an explicit hardware operation. A normal key-up
      // instead uses releaseNote; semantic keyOn never sends this logical mask.
      const tails=[...releases.keys()];releases.clear();mask(value);
      for(const ch of tails)writeVolume(ch,baseVolumes[ch]);
      return;
    }
    raw.writeRegister(register,value);
    if(register===7){control=value;if(value&64)selected=value&7;}
  }
  function reset() {
    releases.clear();baseVolumes.fill(0);actualVolumes.fill(0);
    selected=control=0;actualMask=255;frame=0;raw.reset();
  }
  const pcm=new RF5C164Synth({transport:{write,loadMemory:(bytes,address)=>raw.loadMemory(bytes,address),reset}});
  pcm.keyOn=ch=>{
    channel(ch);releases.delete(ch);writeVolume(ch,baseVolumes[ch]);
    selected=ch;control=0xc0|ch;raw.writeRegister(7,control);
    mask(actualMask|(1<<ch));mask(actualMask&~(1<<ch));
    pcm.channelMask&=~(1<<ch);
  };
  pcm.keyOff=ch=>{
    channel(ch);releases.delete(ch);mask(actualMask|(1<<ch));
    pcm.channelMask|=1<<ch;writeVolume(ch,baseVolumes[ch]);
  };
  pcm.releaseNote=ch=>{
    channel(ch);
    if(pcm.channelMask&(1<<ch))return false;
    pcm.channelMask|=1<<ch;
    if(!actualVolumes[ch]){pcm.keyOff(ch);return true;}
    releases.set(ch,{start:frame,end:frame+releaseFrames,next:frame+quantum-frame%quantum});return true;
  };
  function update() {
    for(const [ch,tail]of releases) {
      if(frame>=tail.end) {
        writeVolume(ch,0);mask(actualMask|(1<<ch));releases.delete(ch);
      } else if(frame>=tail.next) {
        writeVolume(ch,Math.round(baseVolumes[ch]*level(tail)));tail.next+=quantum;
      }
    }
  }
  function render(left,right) {
    if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length!==right.length) {
      throw new TypeError('PCM release needs matching stereo Float32Arrays');
    }
    let offset=0;
    while(offset<left.length) {
      update();
      let count=left.length-offset;
      if(releases.size) {
        for(const tail of releases.values())count=Math.min(count,tail.next-frame,tail.end-frame);
      }
      renderAudio(left.subarray(offset,offset+count),right.subarray(offset,offset+count));
      offset+=count;frame+=count;
    }
    if(left.length)update();
  }
  return {pcm,render,getState:()=>({frame,releaseFrames,channelMask:pcm.channelMask,actualMask,selected,control,
    heldChannels:Array.from({length:8},(_,ch)=>ch).filter(ch=>!(pcm.channelMask&(1<<ch))),
    releasingChannels:[...releases.keys()].sort((a,b)=>a-b),baseVolumes:[...baseVolumes],actualVolumes:[...actualVolumes]})};
}
