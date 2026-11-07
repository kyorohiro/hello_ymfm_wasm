// SPDX-License-Identifier: BSD-3-Clause
// Predeclared original chip experiments; no oracle implementation/tables.
import {qualityTone} from './sid8580_quality_fixtures.mjs';

export const CUTOFF_MATRIX=Object.freeze({
  version:1,
  trainingFc:[64,128,256,512,1024,1536,2047],
  holdoutFc:[96,192,384,768,1280,1792],
  factors:[.6,.72,.84,.96,1.08,1.2,1.32,1.44,1.6],
  nominalGrid:'Frequency grid only: (6.2 * FC + 30) * factor. Not a fitted reference curve.',
  training:{rate:48000,sustain:4,res:0},
  holdoutBase:{rate:48000,sustain:4,res:0},
  holdoutInteractions:{fc:[192,1280],rates:[44100,96000],sustain:15,res:12},
  volume:12,
  outputLevelReason:'Fixed before measurement to reduce high-harmonic PCM quantization; the voice/filter input level still comes from sustain.',
  harmonic:'ceil(requested Hz / 3000); all fundamental registers remain in 1..65535',
  unmeasuredEndpoint:'FC0 retains the original 30-Hz coefficient; no endpoint hardware-accuracy claim',
});

export function sid8580CutoffFixtures({validation=false}={}){
  const curves=validation?
    [...CUTOFF_MATRIX.holdoutFc.map(fc=>({fc,...CUTOFF_MATRIX.holdoutBase,group:'holdout-fc'})),
      ...CUTOFF_MATRIX.holdoutInteractions.fc.flatMap(fc=>CUTOFF_MATRIX.holdoutInteractions.rates.map(rate=>
        ({fc,rate,sustain:15,res:12,group:'holdout-interaction'})))]:
    CUTOFF_MATRIX.trainingFc.map(fc=>({fc,...CUTOFF_MATRIX.training,group:'training'}));
  const scenes=[],dry=new Map();
  function tone(config){
    const f=qualityTone(config);
    // Preserve the existing fixture/previous phase byte-for-byte. Select the
    // new fixed output volume only in this experiment, after the silent reset.
    let last=-1;for(let i=0;i<f.commands.length;i++)if(f.commands[i][0]==='w'&&f.commands[i][1]===24)last=i;
    f.commands[last][2]=f.mode|CUTOFF_MATRIX.volume;
    f.volume=CUTOFF_MATRIX.volume;return f;
  }
  for(const curve of curves){
    const key=`${curve.group}:fc${curve.fc}:s${curve.sustain}:r${curve.res}:rate${curve.rate}`;
    for(const [index,factor] of CUTOFF_MATRIX.factors.entries()){
      const hz=(6.2*curve.fc+30)*factor,harmonic=Math.ceil(hz/3000);
      for(const [label,mode] of [['lp',0x10],['hp',0x40]]){
        const config={...curve,hz,harmonic,mode,name:`${key}:f${index}:${label}`},f=tone(config);
        Object.assign(f,{curveKey:key,group:curve.group,frequencyIndex:index});scenes.push(f);
        const dkey=`${f.dryKey}:${harmonic}`;
        if(!dry.has(dkey))dry.set(dkey,tone({...config,fc:0,res:0,mode:0,kind:'dry',name:`dry:${dkey}`}));
      }
    }
  }
  return [...dry.values(),...scenes];
}
