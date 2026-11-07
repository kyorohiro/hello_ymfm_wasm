// SPDX-License-Identifier: BSD-3-Clause
// Separate GPL quality oracle. Reuses, but never rewrites, the checked raw-bus
// reference's existing pinned static install. No network or library rebuild.
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
import {access,chmod,copyFile,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareSid8580Reference} from './prepare_sid8580_reference.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const exec=promisify(execFile),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function record(path) {const bytes=await readFile(path);return {bytes:bytes.length,sha256:sha(bytes)};}
async function run(command,args) {
  try{return await exec(command,args,{cwd:root,timeout:120000,maxBuffer:4*1024*1024});}
  catch(error){throw new Error(`${command} failed: ${(error.stderr||error.message).slice(-10000)}`,{cause:error});}
}
export async function prepareSid8580QualityReference({workDir=join(root,'build/sid-reference'),referenceWorkDir=join(root,'build/sid-reference'),force=false,check=false}={}) {
  if(force&&check)throw new Error('--force and --check cannot be combined');
  // The existing builder's check authenticates the old binary, archive, serial
  // recipe, library and headers without editing or rebuilding any of them.
  const reference=await prepareSid8580Reference({workDir:resolve(referenceWorkDir),check:true});
  const prefix=join(root,reference.manifest.provenance.install.prefix);
  const library=join(prefix,'lib/libresidfp.a');
  const provenance={pin:reference.manifest.provenance.pin,
    staticInstall:reference.manifest.provenance.install,
    serialTables:reference.manifest.provenance.serialTables,
    rawBusOracle:{manifestPath:reference.manifestPath,...await record(reference.manifestPath),binary:reference.manifest.binary},
    note:'Existing local static install only; a new oracle executable is linked. No new library-rebuild attestation.'};
  const inputs={};
  for(const path of ['test/helpers/sid8580_quality_reference.cpp','scripts/prepare_sid8580_quality_reference.mjs',
    'scripts/prepare_sid8580_reference.mjs'])inputs[path]=await record(join(root,path));
  const compiler=process.env.CXX||'c++',flags=['-std=c++17','-O2','-ffp-contract=off','-pthread'];
  const build={platform:process.platform,arch:process.arch,compiler,
    compilerVersion:(await run(compiler,['--version'])).stdout.trim(),flags};
  workDir=resolve(workDir);await mkdir(workDir,{recursive:true});
  const binary=join(workDir,process.platform==='win32'?'sid8580-quality-reference.exe':'sid8580-quality-reference');
  const manifestPath=join(workDir,'sid8580-quality-reference-build.json');
  if(!force) {
    try {
      const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
      if(!same(manifest.inputs,inputs)||!same(manifest.provenance,provenance)||!same(manifest.build,build)
        ||!same(manifest.binary,await record(binary)))throw new Error('SID8580 quality reference build is stale');
      await access(binary,constants.X_OK);return {binary,manifestPath,manifest};
    }catch(error){if(check)throw error;}
  }
  const temporary=await mkdtemp(join(workDir,'sid8580-quality-build-'));
  const output=join(temporary,'sid8580-quality-reference');
  await run(compiler,[...flags,'-I'+join(prefix,'include'),join(root,'test/helpers/sid8580_quality_reference.cpp'),library,'-o',output]);
  await copyFile(output,binary);await chmod(binary,0o755);
  const manifest={format:'tetorica-sid8580-quality-reference-build',version:1,license:'GPL-2.0-or-later',
    purpose:'External chip-rate reference plus common rational host sampler; no production linkage/distribution',
    inputs,provenance,build,binary:await record(binary)};
  await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');return {binary,manifestPath,manifest};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const options={};
  for(let i=2;i<process.argv.length;++i) {
    const flag=process.argv[i];
    if(flag==='--check')options.check=true;
    else if(flag==='--force')options.force=true;
    else if(flag==='--work-dir'||flag==='--reference-work-dir') {
      const value=process.argv[++i];if(!value||value.startsWith('--'))throw new Error(`${flag} needs a path`);
      options[flag==='--work-dir'?'workDir':'referenceWorkDir']=value;
    }else throw new Error('Usage: node scripts/prepare_sid8580_quality_reference.mjs [--work-dir OUTPUT] [--reference-work-dir CHECKED_REFERENCE] [--check|--force]');
  }
  const result=await prepareSid8580QualityReference(options);
  console.log(JSON.stringify({passed:true,binary:result.binary,manifestPath:result.manifestPath,
    binarySha256:result.manifest.binary.sha256,linkedInstall:result.manifest.provenance.staticInstall.prefix},null,2));
}
