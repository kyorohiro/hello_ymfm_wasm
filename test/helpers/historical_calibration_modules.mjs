// Exercise real guard implementations with explicitly archived test inputs.
// Use an isolated temporary module graph; never patch Node's fs or production.
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';
import {rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const graphs=new Map();
async function prepare(mode){
 const directory=await mkdtemp(join(tmpdir(),'tetorica-historical-guards-'));
 process.once('exit',()=>rmSync(directory,{recursive:true,force:true}));
 const scripts=new URL('../../scripts/',import.meta.url),inputs=new URL('./historical_huc_timed_calibration_inputs.mjs',import.meta.url).href;
 const provider=pathToFileURL(join(directory,'archived-fs.mjs')).href;
 await writeFile(new URL(provider),`export {${mode==='post-source-mix'?'readPostSourceMixFileSync':'readFileSync'} as readFileSync} from '${inputs}';`);
 const extra=['ps1_mixer_calibration.mjs','wonderswan_mixer_calibration.mjs','pokey_mixer_calibration.mjs','scsp_mixer_calibration.mjs','record_monaco_virtual_models_ui_revision.mjs'];
 const files=(await readdir(scripts)).filter(name=>(name.startsWith('mixer_calibration_')||extra.includes(name))&&name.endsWith('.mjs')&&!name.endsWith('.test.mjs'));
 const asyncProvider=pathToFileURL(join(directory,'archived-fs-promises.mjs')).href;
 await writeFile(new URL(asyncProvider),`export * from 'node:fs/promises';\nimport {readFileSync} from '${provider}';\nexport async function readFile(location,options){return readFileSync(location,options);}`);
 await Promise.all(files.map(async name=>{
  const url=new URL(name,scripts);let source=await readFile(url,'utf8');
  const result=await build({stdin:{contents:source,sourcefile:name,resolveDir:new URL('../../scripts/',import.meta.url).pathname},
   bundle:true,format:'esm',write:false,treeShaking:false,define:{'import.meta.url':JSON.stringify(url.href)},
   plugins:[{name:'historical-guard-imports',setup(builder){builder.onResolve({filter:/.*/},({path:target})=>{
    const next=target==='node:fs'?provider:target==='node:fs/promises'?asyncProvider:target.startsWith('.')?
      files.includes(target.slice(2))?pathToFileURL(join(directory,target.slice(2))).href:new URL(target,url).href:target.startsWith('node:')?target:import.meta.resolve(target);
    return{path:next,external:true};
   });}}]});
  source=result.outputFiles[0].text;
  await writeFile(join(directory,name),source);
 }));
 return directory;
}
export async function historicalCalibrationModule(name,{mode='reviewed'}={}){
 if(!['reviewed','post-source-mix'].includes(mode))throw Error('Unknown historical input mode');
 if(!/^(?:mixer_calibration_[a-z0-9_]+|(?:ps1|wonderswan|pokey|scsp)_mixer_calibration|record_monaco_virtual_models_ui_revision)\.mjs$/.test(name))throw Error('Expected a historical calibration guard module');
 if(!graphs.has(mode))graphs.set(mode,prepare(mode));
 const directory=await graphs.get(mode);return import(pathToFileURL(join(directory,name)).href);
}
