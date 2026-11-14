// SPDX-License-Identifier: BSD-3-Clause
import {createDefaultPreset,readPreset} from './preset.js';
import {HUC6280_CLOCK} from '../js/huc6280synth.js';

// The native chip adds 5-bit channel, channel-balance and global-balance
// attenuation codes before saturating at the silent code31.
const SCALE=[0,3,5,7,9,11,13,15,16,19,21,23,25,27,29,31];
const byte=value=>Number.isInteger(value)&&value>=0&&value<=255;
const knownWave=values=>Array.isArray(values)&&values.length===32&&values.every(value=>Number.isInteger(value)&&value>=0&&value<=31);
const period=registers=>byte(registers[2])&&byte(registers[3])?((registers[2]|(registers[3]&15)<<8)||4096):null;
const attenuation=(volume,pan,global)=>Math.min(31,31-volume+31-SCALE[pan]+31-SCALE[global]);

/** Fold the shared global balance into the existing portable channel fields.
 * Search only quieter/equal settings, with exact attenuation preferred. A
 * quantized fallback is disclosed and can never make either side louder. */
function normalizeLevel(control,balance,global) {
  const originalVolume=control&31,originalPan=[balance>>4,balance&15],globalPan=[global>>4,global&15];
  const target=originalPan.map((pan,index)=>attenuation(originalVolume,pan,globalPan[index]));
  let best=null;
  for(let volume=0;volume<=originalVolume;volume++) {
    const sides=target.map((wanted,index)=>{
      let bestSide=null;
      for(let pan=0;pan<16;pan++) {
        const actual=attenuation(volume,pan,15);
        if(actual<wanted)continue;
        const candidate={pan,actual,error:actual-wanted,distance:Math.abs(pan-originalPan[index])};
        if(!bestSide||candidate.error<bestSide.error||candidate.error===bestSide.error&&candidate.distance<bestSide.distance)bestSide=candidate;
      }
      return bestSide;
    });
    const candidate={volume,pan:{left:sides[0].pan,right:sides[1].pan},attenuation:sides.map(side=>side.actual),
      error:sides[0].error+sides[1].error,distance:originalVolume-volume+sides[0].distance+sides[1].distance};
    if(!best||candidate.error<best.error||candidate.error===best.error&&candidate.distance<best.distance)best=candidate;
  }
  return {...best,originalVolume,originalPan:{left:originalPan[0],right:originalPan[1]},globalBalance:global,targetAttenuation:target,
    extraAttenuation:best.attenuation.map((value,index)=>value-target[index]),audible:best.attenuation.some(value=>value<31)};
}

/** A retriggerable configured voice, not a native phase or DDA sample capture.
 * Ordinary Wave pitch comes from the keyboard. An active CH1 LFO captures its
 * complete fixed CH1/CH2 pair, with recorded periods referenced to C4. */
export function prepareHuc6280SongVoice(snapshot,channel,{name}={}) {
  if(!Number.isInteger(channel)||channel<0||channel>5)throw RangeError('HuC6280 song voice channel must be0..5');
  if(snapshot?.clock!==HUC6280_CLOCK)throw RangeError('Song voice requires the normal PC Engine clock');
  if(!Number.isSafeInteger(snapshot.positionFrames)||snapshot.positionFrames<0)throw RangeError('Song voice needs an exact nonnegative observation frame');
  const result={preset:null,channel,source:'unknown',positionFrames:snapshot.positionFrames,playable:false,capturable:false,
    reason:'',description:'',warnings:[],gate:null,period:null,frequencyHz:null,level:null,pair:false};
  const reject=reason=>({...result,reason,description:reason});
  if(!Array.isArray(snapshot.globals)||snapshot.globals.length!==10||!Array.isArray(snapshot.registers)||snapshot.registers.length!==8||
    snapshot.registers.some(row=>!Array.isArray(row)||row.length!==8)||!Array.isArray(snapshot.waveforms)||snapshot.waveforms.length!==8)return reject('The paused VGM register snapshot is incomplete.');
  const registers=snapshot.registers[channel],control=registers[4],balance=registers[5],global=snapshot.globals[1],lfo=snapshot.globals[9];
  if(!byte(control))return reject(`CH${channel+1} control was not recorded; its source and volume are unknown.`);
  result.gate=Boolean(control&128);result.period=period(registers);result.frequencyHz=result.period===null?null:HUC6280_CLOCK/(32*result.period);
  if(channel>=4&&!byte(registers[7]))return reject(`CH${channel+1} Noise control was not recorded; Wave/Noise routing is unknown.`);
  result.source=channel>=4&&(registers[7]&128)?'noise':control&64?'dda':'wave';
  if(channel<2&&!byte(lfo))return reject('Shared LFO control was not recorded; select a channel with known oscillator routing.');
  const activeLfo=channel<2&&Boolean(lfo&3);
  if(activeLfo&&channel===1)return reject('CH2 is the active hardware LFO modulator. Select CH1 to audition or capture the complete CH1 + CH2 pair.');
  if(result.source==='dda')return reject('DDA records a changing DAC value, not a complete sample. This paused snapshot cannot be auditioned or captured as PCM.');
  if(!byte(balance))return reject(`CH${channel+1} left/right balance was not recorded.`);
  if(!byte(global))return reject('Global left/right balance was not recorded; capture cannot preserve the channel output level.');
  const preset=createDefaultPreset();preset.wave=Array(32).fill(0);preset.lfo.wave=Array(32).fill(0);
  preset.envelope={enabled:false,attack:0,decay:0,sustain:1,release:0};preset.lfo.enabled=false;
  preset.source=result.source;preset.name=String(name??`${activeLfo?'LFO CH1 + CH2':`${result.source==='wave'?'Wave':'Noise'} CH${channel+1}`} · VGM`)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g,' ').trim().slice(0,80);
  const level=normalizeLevel(control,balance,global);result.level=level;
  preset.volume=level.volume;preset.pan=level.pan;
  let oscillates=false;
  if(result.source==='noise'){preset.noise.frequency=registers[7]&31;oscillates=true;}
  else {
    if(!knownWave(snapshot.waveforms[channel]))return reject(`CH${channel+1} Wave RAM is not fully recorded at known write positions; all32 samples are required.`);
    preset.wave=[...snapshot.waveforms[channel]];oscillates=preset.wave.some(value=>value!==preset.wave[0]);
  }
  const warnings=result.warnings;
  const disclose=(normalized,label)=>{
    if(global===255)return;
    warnings.push(`${label}: recorded global balance is folded into volume/balance${normalized.error?`; conservative quantization adds L${normalized.extraAttenuation[0]} / R${normalized.extraAttenuation[1]} attenuation steps`: ' with the same per-side attenuation'}. Neither output is made louder.`);
  };
  disclose(level,`CH${channel+1}`);
  if(activeLfo) {
    result.source='lfo';result.pair=true;
    const mod=snapshot.registers[1],modControl=mod[4];
    if(control&64||!byte(modControl)||(modControl&64))return reject('The active LFO pair needs known normal Wave control for both CH1 and CH2; DDA is unsupported.');
    if(!byte(mod[5]))return reject('The active LFO pair needs recorded CH2 left/right balance, including when its direct output is off.');
    if(!byte(snapshot.globals[8]))return reject('The active LFO frequency register was not recorded.');
    const carrierPeriod=period(registers),modulatorPeriod=period(mod);
    if(carrierPeriod===null||modulatorPeriod===null)return reject('The active LFO pair needs both recorded CH1 and CH2 frequency-period bytes.');
    if(!knownWave(snapshot.waveforms[1]))return reject('The active LFO pair needs all32 CH2 Wave RAM samples at known positions.');
    const modLevel=normalizeLevel(modControl,mod[5],global);disclose(modLevel,'CH2');
    preset.lfo={enabled:true,frequency:snapshot.globals[8],depth:lfo&3,reset:Boolean(lfo&128),wave:[...snapshot.waveforms[1]],
      mode:'recorded',carrierPeriod,modulatorPeriod,
      output:{enabled:Boolean(modControl&128),volume:modLevel.volume,pan:modLevel.pan}};
    result.modulatorLevel=modLevel;
    // CH2 phase advances through the gated CH1 carrier; with reset held it is
    // a fixed DAC-like wave index, rather than an independently keyed voice.
    const modOscillates=Boolean(modControl&128)&&modLevel.audible&&!(lfo&128)&&preset.lfo.wave.some(value=>value!==preset.lfo.wave[0]);
    oscillates=level.audible&&oscillates||modOscillates;
    warnings.push('C4 reproduces the recorded CH1 period; other keys transpose CH1 while CH2 keeps its fixed recorded period. Wave/LFO phase is retriggered, not restored.');
  } else if(result.source==='wave')warnings.push('The keyboard supplies ordinary note pitch; the recorded song period is not stored as a new root note. Wave phase is retriggered, not restored.');
  else warnings.push('Keys retrigger Noise at its recorded hardware clock; they do not transpose the Noise pitch.');
  result.preset=readPreset(preset);result.capturable=true;
  const outputAudible=result.pair?level.audible||result.modulatorLevel.audible&&preset.lfo.output.enabled:level.audible;
  result.reason=!result.gate?'The selected channel gate is off at this position.':!outputAudible?'The recorded channel/global balance mutes both outputs.':!oscillates?'This configured Wave output is constant at this position.':'';
  result.playable=!result.reason;
  result.description=`${result.pair?'LFO CH1 + CH2':`${result.source==='wave'?'Wave':'Noise'} CH${channel+1}`} · configured sound; Software Envelope Off. ${warnings.join(' ')}`;
  return result;
}
