/** Exact comparison of the frozen WonderSwan and fixed-SDK WASM builds.
 * Reuses the native-vs-WASM verifier's real register/RAM programs and fixed
 * DAC/LFSR/sweep/pitch expectations; no browser or physical audio is opened.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,realpath,stat,lstat} from 'node:fs/promises';
import {basename,dirname,resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {WonderSwan,WONDERSWAN_CLOCK} from '../web/wonderswan.js';
import {scenes,render,equalPcm,metrics,specifiedChecks,wrapperChecks,verifyWonderSwanBuildReceipt} from './check_wonderswan_core.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node scripts/check_wonderswan_wasm_sdk.mjs --legacy-dir DIR --sdk-dir DIR [--out REPORT.json]';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const outputs=['wonderswan_wasm.js','wonderswan_wasm.wasm','build-info.json','wonderswan_build-info.json'];
const requiredExports=['wonderswan_create','wonderswan_destroy','wonderswan_reset','wonderswan_write',
  'wonderswan_read','wonderswan_write_memory','wonderswan_read_memory','wonderswan_mute','wonderswan_generate','malloc','free'];

export function parseWonderSwanParityArguments(argv) {
  if(argv.includes('--help')){assert.deepEqual(argv,['--help'],'--help must stand alone');return null;}
  const values={};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i],at=arg.indexOf('='),name=at<0?arg:arg.slice(0,at);
    assert(['--legacy-dir','--sdk-dir','--out'].includes(name),`Unknown argument: ${arg}\n${usage}`);
    assert(!Object.hasOwn(values,name),'Duplicate argument: '+name);
    const value=at<0?argv[++i]:arg.slice(at+1);assert(value&&!value.startsWith('--'),name+' needs a value');
    values[name]=resolve(value);
  }
  assert(values['--legacy-dir']&&values['--sdk-dir'],usage);
  assert.notEqual(values['--legacy-dir'],values['--sdk-dir'],'Use distinct build directories');
  if(values['--out'])for(const directory of [values['--legacy-dir'],values['--sdk-dir']])
    assert(!outputs.some(name=>join(directory,name)===values['--out']),'Report must not overwrite a build input');
  return values;
}

const inside=(path,directory)=>{const r=relative(directory,path);return !r||(!isAbsolute(r)&&r.split(sep)[0]!=='..');};
async function canonical(path){
  try{return await realpath(path);}catch(error){
    if(error.code!=='ENOENT')throw error;
    return resolve(await canonical(dirname(path)),basename(path));
  }
}

/** Resolve aliases and reject unsafe output before reading receipts/importing
 * generated code. A fresh report path also prevents hardlink/source overwrite;
 * exclusive creation below preserves this guard if the output appears later.
 */
export async function validateWonderSwanParityPaths(parsed){
  const values={...parsed};
  for(const name of ['--legacy-dir','--sdk-dir']){
    values[name]=await realpath(values[name]);
    assert((await stat(values[name])).isDirectory(),name+' must be a directory');
  }
  const directories=[values['--legacy-dir'],values['--sdk-dir']];
  assert(!inside(directories[0],directories[1])&&!inside(directories[1],directories[0]),
    'Use distinct nonoverlapping build directories, including symlink aliases');
  if(values['--out']){
    try{
      const entry=await lstat(values['--out']);
      assert(!entry.isSymbolicLink(),'Report output must not be a symlink');
    }catch(error){if(error.code!=='ENOENT')throw error;}
    values['--out']=await canonical(values['--out']);
    for(const directory of directories)assert(!inside(values['--out'],directory),
      'Report must be outside both input directories');
    const sdkRoot=await realpath(join(root,'third_party/tetorica-soundchip-native'));
    assert(!inside(values['--out'],sdkRoot),'Report must not overwrite or create pinned SDK source inputs');
    try{
      await lstat(values['--out']);
      assert.fail('Report output already exists; choose a fresh path to preserve source/runtime inputs');
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return values;
}

async function metadata(path){const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha256(bytes)};}
async function backend(directory,{verifySources}){
  // The batch command verifies the frozen reference's pin/receipt before it
  // copies generated files. Candidate source reads are bound to the current pin.
  const audit=await verifyWonderSwanBuildReceipt(directory,{sourceRoot:root,verifySources});
  const js=join(directory,'wonderswan_wasm.js'),wasm=join(directory,'wonderswan_wasm.wasm');
  const wasmBinary=await readFile(wasm),compiled=new WebAssembly.Module(wasmBinary);
  const order=entries=>entries.toSorted((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const exports=order(WebAssembly.Module.exports(compiled)),imports=order(WebAssembly.Module.imports(compiled));
  for(const name of requiredExports)assert(exports.some(entry=>entry.name===name&&entry.kind==='function'),'Missing WASM export '+name);
  assert(exports.some(entry=>entry.name==='memory'&&entry.kind==='memory'),'Missing exported WASM memory');
  const {default:factory}=await import(pathToFileURL(js).href);assert.equal(typeof factory,'function');
  const module=await factory({wasmBinary});
  for(const name of requiredExports)assert.equal(typeof module['_'+name],'function','Missing JS ABI _'+name);
  assert.equal(typeof module.cwrap,'function');assert(module.HEAPF32 instanceof Float32Array);
  return {module,create:options=>WonderSwan.create({...options,moduleFactory:()=>module}),
    metadata:{directory,javascript:await metadata(js),wasm:await metadata(wasm),exports,imports,buildReceipt:audit}};
}

async function main(){
  const parsed=parseWonderSwanParityArguments(process.argv.slice(2));if(!parsed){console.log(usage);return;}
  const args=await validateWonderSwanParityPaths(parsed);
  const legacy=await backend(args['--legacy-dir'],{verifySources:false});
  const sdk=await backend(args['--sdk-dir'],{verifySources:true});
  assert.deepEqual(sdk.metadata.exports,legacy.metadata.exports,'WASM export ABI');
  assert.deepEqual(sdk.metadata.imports,legacy.metadata.imports,'WASM import ABI');
  const layouts=[{name:'regular',blocks:[128],api:'owned'},
    {name:'irregular',blocks:[1,17,127,509,3,1024,257],api:'borrowed'},
    {name:'into',blocks:[97,256,11],api:'into'}];
  const report={schemaVersion:1,passed:false,deviceOpened:false,maximumDifference:0,
    method:'Real frozen and SDK WASM builds through the unchanged synchronous JS wrapper. Exact stereo PCM, 32 readable registers and 16 KiB RAM; shared native-core verification scenarios and independent DAC/LFSR/sweep/pitch expectations.',
    limits:['Raw unipolar core output; no Mixer gain, DC filter, browser scheduling or listening judgment.',
      'The frozen reference receipt/output bytes are audited here; the batch verifier separately checks its fixed source snapshot. Candidate recipe sources are checked against the current fixed SDK manifest.'],
    legacy:legacy.metadata,sdk:sdk.metadata,cases:[],totalComparedStereoFrames:0,
    frameCountScope:'Both builds: full scenario body in each owned/borrowed/into partition, followed by a full reset replay. Independent expectation/wrapper self-check frames are not included.'};
  report.specifiedChecks={legacy:await specifiedChecks(legacy.create),sdk:await specifiedChecks(sdk.create)};
  report.wrapperChecks={legacy:await wrapperChecks(legacy.create,legacy.module),sdk:await wrapperChecks(sdk.create,sdk.module)};
  for(const rate of [44100,48000,96000])for(const clock of [WONDERSWAN_CLOCK,4000001])for(const scene of scenes()){
    let baseline;
    for(const layout of layouts){
      const a=await legacy.create({clock,sampleRate:rate}),b=await sdk.create({clock,sampleRate:rate});
      const label=`${scene.name}/${clock}/${rate}/${layout.name}`;
      try{
        const expected=render(a,scene,layout.blocks,layout.api),actual=render(b,scene,layout.blocks,layout.api);
        equalPcm(actual,expected,label);
        if(baseline)equalPcm(expected,baseline,label+'/partition-invariance');else baseline=expected;
        const measured=metrics(expected);if(scene.silent)assert.equal(measured.peak,0);else assert(measured.peak>0.001,label+' must emit sound');
        a.reset();b.reset();
        equalPcm(render(a,scene,layout.blocks,layout.api),expected,label+'/legacy-reset-replay');
        equalPcm(render(b,scene,layout.blocks,layout.api),expected,label+'/sdk-reset-replay');
        report.totalComparedStereoFrames+=scene.frames*4;
        report.cases.push({name:scene.name,clock,rate,frames:scene.frames,layout:layout.name,api:layout.api,
          resetReplay:true,...measured,pcmSha256:sha256(Buffer.concat([Buffer.from(expected.left.buffer),Buffer.from(expected.right.buffer)])),
          registersSha256:sha256(expected.registers),ramSha256:sha256(expected.memory),maximumDifference:0});
      }finally{a.dispose();b.dispose();}
    }
  }
  report.passed=true;
  if(args['--out']){await mkdir(dirname(args['--out']),{recursive:true});await writeFile(args['--out'],JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
  console.log(JSON.stringify({passed:true,cases:report.cases.length,totalComparedStereoFrames:report.totalComparedStereoFrames,
    maximumDifference:0,...(args['--out']?{report:args['--out']}:{})},null,2));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
}
