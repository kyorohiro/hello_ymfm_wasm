/** Refresh the Analyzer's own reference measurements after source-mixer changes.
 * Reuse the existing synthetic probes without opening an audio device.
 */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {calibrateAnalyzerExtraLevels} from './calibrate_analyzer_extra_levels.mjs';
import {measureAnalyzerPsgLevels} from './measure_analyzer_psg_levels.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const additionalInputs=['scripts/measure_analyzer_ym2608_source_mix.mjs','docs/vgm_analyzer/ym2608_source_mix.js'];

export async function measureAnalyzerYm2608SourceMix() {
  const extra=await calibrateAnalyzerExtraLevels(),psg=await measureAnalyzerPsgLevels();
  for(const report of [extra,psg])for(const name of additionalInputs) {
    const bytes=await readFile(resolve(root,name));
    const sha256=createHash('sha256').update(bytes).digest('hex');
    report.sources[name]=report===extra?{sha256,size:bytes.length}:sha256;
  }
  return {'analyzer_extra_levels_09.json':extra,'analyzer_psg_levels_12.json':psg};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==4||process.argv[2]!=='--out-dir')throw new Error('Usage: node scripts/measure_analyzer_ym2608_source_mix.mjs --out-dir DIRECTORY');
  const directory=resolve(process.argv[3]);await mkdir(directory,{recursive:true});
  for(const [name,report] of Object.entries(await measureAnalyzerYm2608SourceMix())) {
    await writeFile(resolve(directory,name),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({file:name,passed:report.passed,rows:report.rows.length,defaults:report.defaults}));
  }
}
