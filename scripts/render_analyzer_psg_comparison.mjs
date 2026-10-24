/** Listening references before/after the Analyzer PSG balance; OPNA ratios are retained. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {makePsgBalanceReference,renderPsgBalanceReference} from './measure_analyzer_psg_balance.mjs';
import {makeAnalyzerPsgLevelReference} from './measure_analyzer_psg_levels.mjs';
import {encodeStereoWav} from '../docs/vgm_analyzer/vgm_wav.js';
import {mixerDefaults} from '../docs/vgm_analyzer/mixer_defaults.js';

const output=resolve(process.argv[2]??'release/analyzer-psg-adjusted');
if(process.argv.length>3)throw new Error('Usage: node scripts/render_analyzer_psg_comparison.mjs [output-directory]');
await mkdir(output,{recursive:true});
const report=JSON.parse(await readFile(new URL('../docs/issues/analyzer_psg_levels_01.json',import.meta.url),'utf8'));
const sections=['ym2608-fm','ym2608-ssg','sega-psg','ay8910','nesApu'];
const before=[],after=[];
for(const section of sections) {
  const id=section==='sega-psg'?'psg':section;
  const reference=section.startsWith('ym2608-')?makePsgBalanceReference(section,440):makeAnalyzerPsgLevelReference(id,440);
  const previousGain=section.startsWith('ym2608-')?report.reference.gain
    :report.rows.find(row=>row.id===id&&row.frequencyHz===440&&row.canonical).previousMixerGain;
  const gain=mixerDefaults(reference.source,undefined,reference.downstreamTrim).gain;
  const pair=await Promise.all([renderPsgBalanceReference(reference,{gain:previousGain}),renderPsgBalanceReference(reference,{gain})]);
  before.push(pair[0]);after.push(pair[1]);
}
const rate=before[0].pcm.sampleRate;
const variants=[{name:'01-before',references:before},{name:'02-after',references:after}];
const note={frequencyHz:440,sampleRate:rate,order:sections,
  auditionOnly:'Mean DC removal and 10 ms edge fades; no peak normalization. Before uses recorded former gains; after uses current Analyzer strip defaults. OPNA FM/SSG share the same unchanged gain.',
  secondsPerTone:1,silenceBetweenTones:.3,variants:[]};
for(const {name,references} of variants) {
  const gap=Math.round(rate*.3),frames=rate*sections.length+gap*(sections.length-1);
  const left=new Float32Array(frames),right=new Float32Array(frames);
  for(let index=0;index<references.length;index++) {
    const reference=references[index],start=index*(rate+gap),fade=Math.round(rate*.01);
    for(let sample=0;sample<rate;sample++) {
      const edge=Math.min(1,sample/fade,(rate-1-sample)/fade);
      left[start+sample]=(reference.pcm.left[sample]-reference.metrics.dc)*edge;
      right[start+sample]=(reference.pcm.right[sample]-reference.metrics.dc)*edge;
    }
  }
  const file=name+'.wav';
  await writeFile(resolve(output,file),encodeStereoWav(left,right,rate));
  note.variants.push({file,sections:sections.map((section,index)=>({section,
    mixerGain:references[index].gain,steadyAcRms:references[index].metrics.acRms}))});
}
await writeFile(resolve(output,'comparison.json'),JSON.stringify(note,null,2)+'\n');
console.log(`Saved ${variants.length} FM / SSG / Sega PSG / AY / NES comparisons in ${output}`);
