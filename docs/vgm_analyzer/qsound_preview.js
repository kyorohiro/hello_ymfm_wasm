// SPDX-License-Identifier: BSD-3-Clause
import {QSoundPcm,QSOUND_PCM_RATE} from '../js/qsoundpcm.js';

// The VGM header stores the external clock (4 MHz on CPS2).
export function createQSoundPreview(clock, masterVolume=1) {
  let rom = new Uint8Array(), chip;
  const muted = Array(16).fill(false);
  function reset() {
    chip = new QSoundPcm(rom,44100);
    chip.tickRate = QSOUND_PCM_RATE * clock / 4_000_000;
    chip.voices.forEach((voice,i)=>{voice.muted=muted[i];});
  }
  reset();
  return {
    qsoundTarget:{
      writeRegister:(r,v)=>chip.writeRegister(r,v),
      loadSampleMemory(data,offset,size) {
        if (rom.length !== size) rom = new Uint8Array(size);
        rom.set(data,offset);
        chip.rom = rom;
      },
    },
    clearSampleMemory(){chip.rom=rom=new Uint8Array();},
    setChannelMuted(i,value){muted[i]=chip.voices[i].muted=Boolean(value);},
    setMasterVolume(value){masterVolume=value;},
    getMasterVolume:()=>masterVolume,
    sampleRate:()=>44100,
    processFrames(frames) {
      const left=new Float32Array(frames), right=new Float32Array(frames);
      chip.render(left,right);
      if (masterVolume!==1) for(let i=0;i<frames;i++){left[i]*=masterVolume;right[i]*=masterVolume;}
      return {left,right};
    },
    reset,dispose(){rom=chip.rom=new Uint8Array();},
  };
}
