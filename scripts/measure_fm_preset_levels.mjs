/** Measure preset levels with the real YM2612 WASM (no browser/audio device).
 * node scripts/measure_fm_preset_levels.mjs [report.json]
 * C3/C4/C5, 2 seconds held per note; strongest 50 ms AC RMS window.
 * This measures signal levels, not perceptual loudness. No normalization is applied.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const {createYm2612,YM2612_CLOCK}=await import(root+'/web/ym2612.js');
const {YM2612Synth,YM2612DirectTransport}=await import(root+'/web/ym2612synth.js');
const {FM_PRESETS}=await import(root+'/web/megadrive-fm-presets.js');
const {hzToBlockFnum}=await import(root+'/web/pitch.js');
const {default:factory}=await import(root+'/docs/generated/ym2612_wasm.js');
const chip=await createYm2612(factory,{wasmBinary:await readFile(root+'/docs/generated/ym2612_wasm.wasm')});
const rate=chip.sampleRate(YM2612_CLOCK), results={};
try {
 for(const [name,preset] of Object.entries(FM_PRESETS)) {
  const notes=[];
  for(const hz of [130.8128,261.6256,523.2511]) {
   chip.reset();const synth=new YM2612Synth({transport:new YM2612DirectTransport(chip)});
   synth.setPreset(0,preset);const p=hzToBlockFnum(hz,YM2612_CLOCK);synth.noteOn(0,p.block,p.fnum);
   const {left}=chip.generateStereo(Math.round(rate*2));
   const win=Math.round(rate*.05);let max=0,peak=0;
   for(let i=0;i+win<=left.length;i+=win){let sum=0,mean=0;for(let j=i;j<i+win;j++){mean+=left[j];peak=Math.max(peak,Math.abs(left[j]));}mean/=win;for(let j=i;j<i+win;j++)sum+=(left[j]-mean)**2;max=Math.max(max,Math.sqrt(sum/win));}
   notes.push({rmsDb:20*Math.log10(max),peakDb:20*Math.log10(peak)});
  }
  results[name]={db:notes.map(n=>n.rmsDb).sort((a,b)=>a-b)[1],notes};
 }
}finally{chip.dispose();}
if(process.argv[2]) await writeFile(process.argv[2],JSON.stringify(results,null,2));
console.log(Object.entries(results).map(([n,r])=>`${n.padEnd(20)} ${r.db.toFixed(1)}`).join('\n'));
