import {createTfiFromPreset} from '../js/tfi.js';
import {extractOpmPatches,exportOpm} from './opm_export.js';

export const OPM_TFI_CONVERSION = 'opm-to-ym2612-basic-v1';
export const OPM_TFI_NOTICE = 'Approximate YM2612 conversion: DT2, LFO/AM, noise, pan and operator key masks are not retained. Envelope/DT clock compensation is not applied. Source OPM and conversion.json are included.';

export function convertOpmToTfi(snapshot, channel) {
  if(!Number.isInteger(channel)||channel<0||channel>7)throw new RangeError('Invalid OPM channel');
  const ch=snapshot.channels[channel],operators={};
  // Both cores use physical register slots 1,3,2,4; the preset uses logical keys.
  ch.operators.forEach((op,slot)=>{
    operators[[1,3,2,4][slot]]={multi:op.mul,dt:op.dt1,tl:op.tl,rs:op.ks,
      ar:op.ar,d1r:op.d1r,d2r:op.d2r,rr:op.rr,sl:op.d1l,ssg:0};
  });
  const warnings=['Envelope and DT timing are not compensated for source/target clock differences.',
    'TFI does not retain pan, LFO settings, AM enable or operator key masks.'];
  if(ch.operators.some(op=>op.dt2))warnings.push('Nonzero DT2 omitted; operator frequency ratios can change.');
  if(ch.operators.some(op=>op.am)||ch.ams||ch.pms)warnings.push('AM/PM modulation omitted.');
  if(channel===7&&snapshot.noise.enabled)warnings.push('CH8 noise omitted; the TFI produces an FM tone instead.');
  const mask=ch.operators.reduce((m,o,i)=>m|(o.key?1<<i:0),0);
  if(mask && mask!==15)warnings.push('Partial operator key mask omitted; Playground keys all four operators.');
  return {data:createTfiFromPreset({algorithm:ch.algorithm,feedback:ch.feedback,operators}),warnings};
}

export function createOpmTfiFiles({buffer,snapshot,clock,fileName='VGM',sample=null}) {
  const mode=snapshot?'snapshot':'all';
  let patches;
  if(snapshot){
    if(!Number.isInteger(clock)||clock<=0||clock>0x3fffffff)throw new RangeError('Source YM2151 clock required');
    patches=Array.from({length:8},(_,channel)=>({name:`CH${channel+1}.opm`,channel,snapshot,clock,sample}));
  } else patches=extractOpmPatches(buffer,{includeSnapshots:true});
  if(!patches.length)return {files:[],count:0};
  const files=[],entries=[],encoder=new TextEncoder();
  for(const patch of patches){
    const stem=patch.name.replace(/\.opm$/i,''),converted=convertOpmToTfi(patch.snapshot,patch.channel);
    files.push({name:`${stem}.tfi`,data:converted.data});
    files.push({name:`source/${stem}.opm`,data:encoder.encode(patch.text ?? exportOpm(patch.snapshot,patch.channel,stem,{clock:patch.clock}))});
    entries.push({file:`${stem}.tfi`,sourceOpm:`source/${stem}.opm`,channel:patch.channel+1,sample:patch.sample,
      sourceClockHz:patch.clock,warnings:converted.warnings});
  }
  const metadata={version:1,conversion:OPM_TFI_CONVERSION,mode,sourceFile:fileName,sourceChip:'YM2151',targetChip:'YM2612',targetClockHz:7670454,
    clockCompensation:'none',sampleUnitHz:44100,notice:OPM_TFI_NOTICE,entries};
  files.push({name:'conversion.json',data:encoder.encode(JSON.stringify(metadata,null,2)+'\n')});
  return {files,count:patches.length};
}
