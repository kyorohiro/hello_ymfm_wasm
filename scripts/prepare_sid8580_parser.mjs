#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// A marked research view of the existing BSD layout parser. No target bytes
// are rewritten and none of the original production guards are changed.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
export const researchPsidView=source=>{
  assert.equal((source.match(/function parsePsidStructure\(/g)||[]).length,1,'Expected one original PSID layout parser');
  assert(!source.includes('export {parsePsidStructure}'),'Original parser already exports the research view');
  return '// Generated research-only parser view; original BSD source follows unchanged.\n'+source+
    '\n// Research code applies its own explicit PAL/8580 selection.\nexport {parsePsidStructure};\n';
};
export async function prepareResearchParser({check=false,out=resolve(root,'docs/sid8580-lab/psid_structure.js')}={}){
  const original=await readFile(resolve(root,'tetorica_src/runtime/sid_psid.js'),'utf8'),expected=researchPsidView(original);
  if(check)assert.equal(await readFile(out,'utf8'),expected,'Research parser view is stale');
  else{await mkdir(dirname(out),{recursive:true});await writeFile(out,expected);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assert(process.argv.slice(2).every(a=>a==='--check'));
  await prepareResearchParser({check:process.argv.includes('--check')});
  console.log('Research PSID layout parser view verified');
}
