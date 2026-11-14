// SPDX-License-Identifier: BSD-3-Clause
import {createDefaultPreset,readPreset} from './preset.js';
import {HUC6280_CLOCK} from '../js/huc6280synth.js';

/** Project sent VGM state onto the existing editor. Placeholder values satisfy
 * its portable preset schema only: unknownFields and waveKnown must be used
 * to show Unknown/blank RAM, never those placeholders as recorded hardware.
 * No authored Wave RAM, software envelope or PCM assets are borrowed. */
export function huc6280SongLiveView(snapshot,channel,_author) {
  if(!Number.isInteger(channel)||channel<0||channel>5)throw RangeError('HuC6280 song channel must be 0..5');
  if(!Array.isArray(snapshot?.registers)||snapshot.registers.length!==8||!Array.isArray(snapshot.globals)||snapshot.globals.length!==10||
    !Array.isArray(snapshot.waveforms)||snapshot.waveforms.length!==8)throw TypeError('HuC6280 VGM observation needs sent registers and known Wave RAM');
  const r=snapshot.registers[channel],g=snapshot.globals,control=r[4],noise=r[7],lfo=g[9];
  const preset=createDefaultPreset(),unknownFields=[];
  const known=value=>Number.isInteger(value);
  const field=(path,value,fallback=0)=>{if(value===null||value===undefined){unknownFields.push(path);return fallback;}return value;};
  const periodFor=ch=>{const values=snapshot.registers[ch];return known(values[2])&&known(values[3])?((values[2]|(values[3]&15)<<8)||4096):null;};
  const period=periodFor(channel),carrierPeriod=periodFor(0),modulatorPeriod=periodFor(1);
  const waveKnown=snapshot.waveforms[channel].length===32&&snapshot.waveforms[channel].every(known);
  const lfoWaveKnown=snapshot.waveforms[1].length===32&&snapshot.waveforms[1].every(known);
  let source;
  if(channel>=4&&noise===null||control===null)source='unknown';
  else source=channel>=4&&(noise&128)?'noise':control&64?'dda':'wave';
  preset.name=`VGM CH ${channel+1}`;preset.source=source==='unknown'?'wave':source;
  if(source==='unknown')unknownFields.push('source');
  preset.volume=field('volume',known(control)?control&31:null);
  preset.pan={left:field('pan.left',known(r[5])?r[5]>>4:null),right:field('pan.right',known(r[5])?r[5]&15:null)};
  preset.wave=waveKnown?[...snapshot.waveforms[channel]]:Array(32).fill(0);
  if(!waveKnown)unknownFields.push('wave');
  preset.noise.frequency=field('noise.frequency',channel>=4&&known(noise)?noise&31:null);
  preset.lfo.enabled=Boolean(field('lfo.enabled',known(lfo)?Boolean(lfo&3):null,false));
  preset.lfo.frequency=field('lfo.frequency',g[8]);
  preset.lfo.depth=field('lfo.depth',known(lfo)?(lfo&3)||1:null,1);
  preset.lfo.reset=Boolean(field('lfo.reset',known(lfo)?Boolean(lfo&128):null,false));
  preset.lfo.mode='recorded';
  preset.lfo.carrierPeriod=field('lfo.carrierPeriod',carrierPeriod,1);
  preset.lfo.modulatorPeriod=field('lfo.modulatorPeriod',modulatorPeriod,1);
  preset.lfo.wave=lfoWaveKnown?[...snapshot.waveforms[1]]:Array(32).fill(0);
  if(!lfoWaveKnown)unknownFields.push('lfo.wave');
  const mod=snapshot.registers[1],modControl=mod[4];
  preset.lfo.output={enabled:Boolean(field('lfo.output.enabled',known(modControl)?Boolean(modControl&128):null,false)),
    volume:field('lfo.output.volume',known(modControl)?modControl&31:null),
    pan:{left:field('lfo.output.pan.left',known(mod[5])?mod[5]>>4:null),right:field('lfo.output.pan.right',known(mod[5])?mod[5]&15:null)}};
  preset.envelope={enabled:false,attack:0,decay:0,sustain:1,release:0};
  unknownFields.push('dda.name','dda.data','dda.sampleRate','dda.rootNote','dda.loop','dda.speed');
  const gate=known(control)?Boolean(control&128):null;
  const frequency=period===null?null:(snapshot.clock??HUC6280_CLOCK)/(32*period);
  const ddaValue=snapshot.ddaValues?.[channel]??null,ddaLastFrame=snapshot.ddaFrames?.[channel]??null,ddaWrites=snapshot.ddaWrites?.[channel]??0;
  const timing=source==='noise'?`Noise clock ${known(noise)?noise&31:'Unknown'}`:source==='dda'?`last recorded DAC ${ddaValue??'Unknown'} / 31`:
    period===null?'period Unknown':`period ${period} · ${frequency.toFixed(1)} Hz${period===4096?' (zero register = 4096)':''}`;
  const readout=`VGM CH ${channel+1} · ${source==='unknown'?'Source Unknown':source==='dda'?'DDA':source==='noise'?'Noise':'Wave'} · Gate ${gate===null?'Unknown':gate?'On':'Off'} · ${timing} · Volume ${known(control)?control&31:'Unknown'} · L ${known(r[5])?r[5]>>4:'Unknown'} / R ${known(r[5])?r[5]&15:'Unknown'} · Global L ${known(g[1])?g[1]>>4:'Unknown'} / R ${known(g[1])?g[1]&15:'Unknown'} · sent/configured, not instantaneous phase`;
  return {preset:readPreset(preset),channel,source,period,frequency,gate,waveKnown,lfoWaveKnown,ddaValue,ddaLastFrame,ddaWrites,
    ddaActive:source==='dda'&&gate===true&&ddaValue!==null,unknownFields,readout,observation:snapshot.observation};
}
