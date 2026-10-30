// SPDX-License-Identifier: BSD-3-Clause
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function list(directory,prefix='') {
  const files=[];for(const entry of await readdir(directory,{withFileTypes:true})) {
    const name=prefix+entry.name;
    if(entry.isDirectory())files.push(...await list(join(directory,entry.name),name+'/'));
    else if(entry.isFile())files.push(name);else throw new Error('Unsupported SCSP source entry');
  }return files.sort();
}
/** Ship byte-exact fixed-SDK inputs in their original relative layout. */
export async function copyScspSources(stage) {
  const sdk=join(root,'third_party/tetorica-soundchip-native'),pin=JSON.parse(await readFile(join(root,'third_party/soundchip-sdk.json')));
  const manifestBytes=await readFile(join(sdk,'RELEASE-MANIFEST.json'));
  if(sha(manifestBytes)!==pin.manifestSha256)throw new Error('SCSP SDK manifest does not match the fixed pin');
  const manifest=JSON.parse(manifestBytes),component='vendor/mame-scsp';
  const names=[...(await list(join(sdk,component))).map(p=>component+'/'+p),'LICENSE','sdk.json','native/include/tetorica/scsp.h','scripts/build_scsp_wasm.sh'].sort();
  const payload=new Map(),inputs=[];
  for(const name of names) {
    const bytes=await readFile(join(sdk,name)),record=manifest.files[name];
    if(!record||bytes.length!==record.size||sha(bytes)!==record.sha256)throw new Error('SCSP source differs from fixed manifest: '+name);
    const target='sources/scsp-sdk/'+name;payload.set(target,bytes);inputs.push({path:target,bytes:bytes.length,sha256:sha(bytes)});
  }
  payload.set('sources/scsp-sdk/RELEASE-MANIFEST.json',manifestBytes);
  payload.set('licenses/mame-scsp/LICENSE',payload.get('sources/scsp-sdk/vendor/mame-scsp/LICENSE'));
  payload.set('licenses/mame-scsp/README.md',Buffer.from('Saturn SCSP: MAME adaptation by ElSemi and R. Belmont, BSD-3-Clause.\nSee ../../sources/SCSP.md for source, attribution and rebuilding.\n'));
  payload.set('sources/SCSP.md',Buffer.from(`# Saturn SCSP source and rebuilding

The standalone C++17 SCSP/DSP, C API, pristine MAME upstream, revision, hashes and
attribution are included under [scsp-sdk/vendor/mame-scsp/](scsp-sdk/vendor/mame-scsp/README.md).
These are byte-exact inputs from the fixed tetorica-soundchip-native SDK, including
its unpublished local-candidate status where applicable. [SCSP.json](SCSP.json)
records that pin and the distributed input/output hashes. Output hashes identify
the shipped pair; they are not a separate compiler provenance receipt.

From this sources directory, with Emscripten available:

\`sh scsp-sdk/scripts/build_scsp_wasm.sh ../generated\`

The original SDK layout and recipe are retained; no network, full SDK checkout,
MAME framework, CPU, BIOS, ROM or game recording is required. Each core owns 32
physical slots / 512 KiB RAM and renders stereo PCM at 44,100 Hz. Native hosts
compile scsp_instrument.cpp, scsp.cpp and scspdsp.cpp from the component directory.
CPU/timer/IRQ/SSF execution is not provided. DSP/FM/LFO behavior and hardware
fidelity are not established by the current PCM/transport checks. The original
MAME envelope/DSP approximations remain documented in the component README.
`));
  const generated={};for(const name of ['scsp_wasm.js','scsp_wasm.wasm']) {
    const bytes=await readFile(join(root,'docs/generated',name));generated[name]={bytes:bytes.length,sha256:sha(bytes)};
  }
  payload.set('sources/SCSP.json',Buffer.from(JSON.stringify({schemaVersion:1,component:'scsp',sdk:pin,inputs,generated,modifications:'None: original SDK paths, source bytes and build recipe retained.'},null,2)+'\n'));
  for(const [name,bytes]of payload){const target=join(stage,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
  return {inputs:inputs.length,files:payload.size};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw new Error('Usage: node scripts/copy_scsp_sources.mjs <stage>');
  console.log(await copyScspSources(resolve(process.argv[2])));
}
