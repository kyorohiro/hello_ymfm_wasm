// SPDX-License-Identifier: BSD-3-Clause
import {createDefaultPreset,readPreset} from './preset.js';
import {HUC6280_CLOCK} from '../js/huc6280synth.js';

/** Sent registers/configured Wave RAM, not the instantaneous output or phase. */
export function huc6280CodeLiveView(snapshot,channel,original=createDefaultPreset()){
  if(!Number.isInteger(channel)||channel<0||channel>5)throw RangeError('HuC6280 channel must be 0..5');
  if(!Array.isArray(snapshot?.registers)||snapshot.registers.length!==8||!Array.isArray(snapshot.globals)||snapshot.globals.length!==10||!Array.isArray(snapshot.waveforms)||snapshot.waveforms.length!==8)throw TypeError('HuC6280 observation needs sent registers and configured waves');
  const registers=snapshot.registers[channel],preset=readPreset(original),control=registers[4],lfo=snapshot.globals[9];
  preset.source=control&64?'dda':channel>=4&&registers[7]&128?'noise':'wave';
  preset.volume=control&31;preset.pan={left:registers[5]>>4,right:registers[5]&15};preset.wave=Array.from(snapshot.waveforms[channel]);
  preset.noise.frequency=channel>=4?registers[7]&31:preset.noise.frequency;
  Object.assign(preset.lfo,{enabled:Boolean(lfo&3),frequency:snapshot.globals[8],depth:(lfo&3)||preset.lfo.depth,reset:Boolean(lfo&128),
    wave:Array.from(snapshot.waveforms[1]),mode:'recorded',carrierPeriod:(snapshot.registers[0][2]|(snapshot.registers[0][3]&15)<<8)||4096,
    modulatorPeriod:(snapshot.registers[1][2]|(snapshot.registers[1][3]&15)<<8)||4096,
    output:{enabled:Boolean(snapshot.registers[1][4]&128),volume:snapshot.registers[1][4]&31,pan:{left:snapshot.registers[1][5]>>4,right:snapshot.registers[1][5]&15}}});
  if(snapshot.envelopes?.[channel])preset.envelope={...snapshot.envelopes[channel]};
  const dda=snapshot.ddaVoices?.[channel]??snapshot.dda;
  if(dda)for(const key of ['sampleRate','rootNote','loop','speed'])if(dda[key]!==undefined)preset.dda[key]=dda[key];
  const period=(registers[2]|(registers[3]&15)<<8)||4096,frequency=HUC6280_CLOCK/(32*period);
  return {preset:readPreset(preset),channel,period,frequency,gate:Boolean(control&128),
    readout:`CH ${channel+1} · ${preset.source==='dda'?'DDA · software sample supply':preset.source==='noise'?'Noise':'Wave'} · Gate ${control&128?'On':'Off'} · ${preset.source==='noise'?`Noise clock ${registers[7]&31}`:preset.source==='dda'?`sample ${preset.dda.sampleRate} Hz · speed ${preset.dda.speed}`:`period ${period} · ${frequency.toFixed(1)} Hz`} · Volume ${control&31} · L ${registers[5]>>4} / R ${registers[5]&15}`};
}
