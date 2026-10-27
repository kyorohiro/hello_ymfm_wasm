import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root = new URL('../',import.meta.url);
const inputs = [
  ['docs/issues/analyzer_nes_levels_01.json',['nesApu']],
  ['docs/issues/analyzer_extra_levels_06.json',['segaPcm','k051649','ymf278b','msm5205','okim6295']],
];
const psgInput = 'docs/issues/analyzer_psg_levels_07.json';
const roundGain = value => Number(value.toFixed(6));

/** Application balance for square-wave references; leave composite-chip ratios intact. */
export function buildAnalyzerPsgDefaults(report, referenceGain) {
  const ids = ['psg','ay8910','nesApu'];
  if(report?.schemaVersion!==1||report.passed!==true||report.sampleRate!==44100||
    report.referenceFrequencyHz!==440||report.reference?.id!=='ym2608'||
    report.reference.gain!==referenceGain||!Number.isFinite(referenceGain)||referenceGain<=0||
    !Number.isFinite(report.reference.unityAcRms)||report.reference.unityAcRms<=0||
    !Number.isFinite(report.reference.targetAcRms)||report.reference.targetAcRms<=0||
    Math.abs(report.reference.targetAcRms/(report.reference.unityAcRms*referenceGain)-1)>1e-6||
    JSON.stringify(Object.keys(report.defaults??{}).sort())!==JSON.stringify([...ids].sort())) {
    throw new Error('Incomplete Analyzer PSG balance report');
  }
  const defaults = {};
  for(const id of ids) {
    for(const frequencyHz of [220,440,880]) {
      const references = report.rows?.filter(row=>row.id===id&&row.frequencyHz===frequencyHz&&row.canonical===true);
      if(references?.length!==1||references[0].sampleRate!==44100||
        !Number.isFinite(references[0].rawAcRms)||references[0].rawAcRms<=0) {
        throw new Error('Missing Analyzer PSG reference: '+id+'/'+frequencyHz);
      }
    }
    const reference = report.rows.find(row=>row.id===id&&row.frequencyHz===440&&row.canonical===true);
    const gain = report.defaults[id];
    if(!Number.isFinite(gain)||gain<=0||gain>2||gain!==roundGain(report.reference.targetAcRms/reference.rawAcRms)) {
      throw new Error('Invalid Analyzer PSG gain: '+id);
    }
    defaults[id]=gain;
  }
  return defaults;
}

export function buildAnalyzerMixerDefaults(reports, targetAmplitude) {
  if(reports.length!==inputs.length||!Number.isFinite(targetAmplitude)||targetAmplitude<=0)throw new Error('Missing Analyzer calibration reports');
  const defaults = {};
  for(let index=0;index<inputs.length;index++) {
    const report = reports[index], expected = inputs[index][1];
    if(report.schemaVersion!==1||report.passed!==true||report.targetAmplitude!==targetAmplitude||
      JSON.stringify(Object.keys(report.defaults??{}).sort())!==JSON.stringify([...expected].sort()))throw new Error('Incomplete Analyzer calibration report');
    for(const id of expected) {
      const reference = report.rows?.find(row=>row.id===id&&row.frequencyHz===440&&
        (row.sampleRate??report.sampleRate)===(report.referenceSampleRate??report.sampleRate));
      const gain = report.defaults[id];
      if(!reference||!Number.isFinite(reference.amplitude)||reference.amplitude<=0||
        !Number.isFinite(gain)||gain<=0||gain>2||gain!==Number((targetAmplitude/reference.amplitude).toFixed(6)))throw new Error('Invalid Analyzer calibration gain: '+id);
      defaults[id]=gain;
    }
  }
  return Object.fromEntries(Object.entries(defaults).sort(([a],[b])=>a.localeCompare(b)));
}

/** Measurement records remain tied to the actual renderer, including unity Mixer processing.
 * @param {object[]} reports
 * @param {(path:string)=>Promise<Uint8Array>} [readSource]
 */
export async function verifyAnalyzerCalibrationSources(reports,readSource=path=>readFile(new URL(path,root))) {
  for(const report of reports) {
    const sources = Array.isArray(report.sources) ? report.sources : Object.entries(report.sources??{}).map(([path,record])=>
      typeof record==='string'?{path,sha256:record}:{path,...record});
    if(!sources.length)throw new Error('Missing Analyzer calibration sources');
    await Promise.all(sources.map(async source=>{
      const bytes=await readSource(source.path);
      if(createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw new Error('Analyzer calibration source changed; remeasure: '+source.path);
    }));
  }
}

export async function generateAnalyzerMixerDefaults({check=false} = {}) {
  const baseline = JSON.parse(await readFile(new URL('docs/issues/playground_chip_levels_01.json',root),'utf8'));
  const reports = await Promise.all(inputs.map(async ([name])=>JSON.parse(await readFile(new URL(name,root),'utf8'))));
  const psgReport = JSON.parse(await readFile(new URL(psgInput,root),'utf8'));
  const referenceGain = baseline.calibration.routes.find(route=>route.kind==='ym2608'&&route.role==='extra').volume;
  const defaults = Object.fromEntries(Object.entries({...buildAnalyzerMixerDefaults(reports,baseline.calibration.targetAmplitude),
    ...buildAnalyzerPsgDefaults(psgReport,referenceGain)}).sort(([a],[b])=>a.localeCompare(b)));
  await verifyAnalyzerCalibrationSources([...reports,psgReport]);
  const output = `// Generated by scripts/generate_analyzer_mixer_defaults.mjs; do not edit gains here.
// Actual Analyzer paths at 44,100 Hz; the shared preset covers the remaining kinds.
// Peak reference measurements: docs/issues/analyzer_nes_levels_01.json and analyzer_extra_levels_06.json.
// PSG balance references: docs/issues/analyzer_psg_levels_07.json; runtime listening levels are applied separately.
export const ANALYZER_MIXER_DEFAULTS = Object.freeze(${JSON.stringify(defaults,null,2)});
`;
  const outPath = new URL('docs/vgm_analyzer/mixer_calibration_data.js',root);
  if(check) {
    if(await readFile(outPath,'utf8')!==output)throw new Error('Analyzer Mixer defaults are stale');
  }else await writeFile(outPath,output);
  return defaults;
}

async function main() {
  const args = process.argv.slice(2);
  if(args.some(arg=>arg!=='--check'))throw new Error('Usage: node scripts/generate_analyzer_mixer_defaults.mjs [--check]');
  const defaults = await generateAnalyzerMixerDefaults({check:args.includes('--check')});
  console.log(`${args.includes('--check')?'CHECK PASS':'Generated'}: ${Object.keys(defaults).length} Analyzer-specific reference levels`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
