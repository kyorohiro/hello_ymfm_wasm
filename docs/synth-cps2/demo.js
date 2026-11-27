// SPDX-License-Identifier: BSD-3-Clause
import {QSOUND_PCM_RATE} from '../js/qsoundpcm.js';

export function demoRom() {
  const rom = new Uint8Array(512 + 3 * 512);
  for (let i=0; i<256; i++) {
    const phase = 2 * Math.PI * i / 256;
    rom[i] = Math.round(84*Math.sin(phase) + 24*Math.sin(phase*3));
    rom[256+i] = Math.round(70*Math.sin(phase) + 32*Math.sin(phase*2) + 16*Math.sin(phase*5));
  }
  // Three one-shot pulses with different periods and decaying nibble amplitudes.
  for (let voice = 0; voice < 3; voice++) {
    const start = 512 + voice * 512;
    for (let nibble = 0; nibble < 1024; nibble++) {
      const amplitude = Math.ceil(7 * (1 - nibble / 1024));
      const angle = nibble * 2 * Math.PI / [45,31,19][voice];
      const code = Math.round(amplitude * Math.sin(angle)) & 15;
      rom[start + (nibble >> 1)] |= nibble % 2 ? code : code << 4;
    }
  }
  return rom;
}

export function noteWrites(ch, midi, sample, pan, volume) {
  const base = ch * 8;
  const rate = Math.round(4096 * 256 * 440 * 2**((midi-69)/12) / QSOUND_PCM_RATE);
  return [[((ch+15)&15)*8,0x8000],[base+1,sample*256],[base+3,0],[base+4,256],
    [base+5,(sample+1)*256],[base+2,rate],[0x80+ch,0x110+pan],[base+6,volume]];
}

// Event positions are in VGM ticks (44.1 kHz). Both playback and export use this score.
export function demoScore() {
  const events = [];
  function note(t, ch, midi, length, wave, pan, volume) {
    events.push({t,writes:noteWrites(ch,midi,wave,pan,volume)});
    events.push({t:t+length,writes:[[ch*8+6,0]]});
  }
  [40,40,43,45,40,47,45,43].forEach((m,i) => note(i*11025,0,m,8000,0,9,8000));
  [64,67,71,69,67,64].forEach((m,i) => note((i+1)*11025+5512,1,m,6500,1,24,5600));
  return events.sort((a,b)=>a.t-b.t);
}

export function adpcmScore() {
  const events = [0,1,2,0,2,1].map((voice, index) => {
    const reg = 0xca + 4 * voice, start = 512 + 512 * voice;
    return {t:index * 11025, writes:[[reg,start],[reg+1,start+512],[reg+2,0x8000],
      [reg+3,0x7fff],[0x90+voice,0x110+voice*16],[0xd6+voice,1]]};
  });
  events.push({t:6 * 11025, writes:[]});
  return events;
}

function echoScore() {
  const note = noteWrites(0,72,1,4,8000);
  return [
    {t:0, writes:note}, {t:700, writes:[[6,0]]},
    {t:22050, writes:[[0xd9,0x554+960],[0x93,0x3200],[0xba,0x4000],...note]},
    {t:22750, writes:[[6,0]]}, {t:50000, writes:[]},
  ];
}

export const demoTracks = {
  demo:{score:demoScore, filename:'tetorica-cps2-first-round.vgm'},
  adpcm:{score:adpcmScore, filename:'tetorica-cps2-adpcm-trio.vgm'},
  echo:{score:echoScore, filename:'tetorica-cps2-echo.vgm'},
};

export function demoVgm(score = demoScore()) {
  const rom = demoRom(), commands = [];
  const u32 = n => [n&255,n>>>8&255,n>>>16&255,n>>>24];
  commands.push(0x67,0x66,0x8f,...u32(8+rom.length),...u32(rom.length),0,0,0,0,...rom);
  let time = 0;
  for (const {t,writes} of score) {
    const wait = t-time;
    if (wait) commands.push(0x61,wait&255,wait>>>8);
    for (const [reg,value] of writes) commands.push(0xc4,value>>>8,value&255,reg);
    time=t;
  }
  commands.push(0x66);
  const bytes = new Uint8Array(256+commands.length), header = new DataView(bytes.buffer);
  bytes.set([86,103,109,32]); bytes.set(commands,256);
  for (const [offset,value] of [[4,bytes.length-4],[8,0x171],[0x18,time],[0x34,204],[0xb4,4_000_000]])
    header.setUint32(offset,value,true);
  return bytes;
}
