// Test-only predecessor bytes for immutable pre-source-mixer evidence.
// Production calibration validates the newly measured current source hashes.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHistoricalGitReader} from './historical_calibration_git_reader.mjs';
import {ym2608SourceGainDefaultChecker} from '../../scripts/check_ym2608_source_gain_defaults.mjs';

export const YM2608_SOURCE_MIX_HISTORY_PATH='test/fixtures/ym2608-source-mix-predecessors.json';
export const YM2608_SOURCE_MIX_HISTORY_PIN='78cf5b059970016c2368c4feb62251bb55394d3103c6c9ed367b367c4cb31690';
const root=fileURLToPath(new URL('../../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const matches=(bytes,record)=>record&&bytes.length===record.bytes&&sha(bytes)===record.sha256;
const fail=message=>{throw Error('Invalid historical YM2608 source-mix fixture: '+message);};
const sourceNames=Object.freeze([
 'docs/js/ym2608.js','docs/js/ym2608synth.js',
 'tetorica_src/runtime/ym2608.js','tetorica_src/runtime/ym2608synth.js',
 'tetorica_src/runtime/ym2608audioengine.js','tetorica_src/runtime/ym2608-worklet.js',
 'docs/js/ym2608audioengine.js','docs/js/ym2608-worklet.js',
 'docs/generated/ym2608_wasm.js','docs/generated/ym2608_wasm.wasm',
 'third_party/tetorica-soundchip-native/wasm/ym2608_wasm.cpp',
 'third_party/tetorica-soundchip-native/scripts/build_ym2608_wasm.sh',
]);

export function createHistoricalYm2608SourceMixReader(readSource=url=>readFileSync(url)){
 let evidence,verified=false;
 const sources=()=>{
  evidence??=JSON.parse(readSource(new URL('../../'+YM2608_SOURCE_MIX_HISTORY_PATH,import.meta.url)));
  if(sha(JSON.stringify(evidence))!==YM2608_SOURCE_MIX_HISTORY_PIN)fail('independently pinned receipt changed');
  if(evidence.schemaVersion!==1||evidence.scope!=='test-only-pre-source-mixer-history'||
   JSON.stringify(Object.keys(evidence.sources))!==JSON.stringify(sourceNames))fail('source inventory changed');
  return evidence;
 };
 return location=>{
  const bytes=readSource(location);
  const filename=location instanceof URL&&location.protocol==='file:'?fileURLToPath(location):null;
  const name=filename===null?null:relative(root,filename).replaceAll('\\','/');
  if(!sourceNames.includes(name))return bytes;
  const value=sources(),entry=value.sources[name];
  if(!matches(bytes,entry.after))return bytes;
  if(!verified){
   for(const [path,source]of Object.entries(value.sources)){
    if(!matches(readSource(new URL('../../'+path,import.meta.url)),source.after))fail('current dependency changed: '+path);
    if(!matches(Buffer.from(source.beforeBase64,'base64'),source.before))fail('predecessor bytes changed: '+path);
   }
   const proofBytes=readSource(new URL('../../'+value.proof.path,import.meta.url));
   if(!matches(proofBytes,value.proof))fail('default PCM proof changed');
   const proof=JSON.parse(proofBytes);
   if(proof.passed!==true||proof.deviceOpened!==false||proof.maximumDifference!==0||
    proof.cases?.length!==586||proof.totalOutputStereoFrames!==7264744||proof.cases.some(row=>row.maximumDifference!==0))fail('incomplete default PCM comparison');
   for(const [key,path]of [['javascript','docs/generated/ym2608_wasm.js'],['wasm','docs/generated/ym2608_wasm.wasm']]){
    if(proof.inputs.sdk[key].sha256!==value.sources[path].after.sha256||
     proof.inputs.legacy[key].sha256!==value.sources[path].before.sha256)fail('proof targets another SDK');
   }
   for(const wrapper of proof.inputs.wrappers){
    const name=sourceNames.find(name=>wrapper.path.endsWith('/'+name));
    if(!name||!matches(readSource(new URL('../../'+name,import.meta.url)),wrapper))fail('proof wrapper changed: '+wrapper.path);
   }
   const checker=ym2608SourceGainDefaultChecker(readSource(new URL('../../scripts/check_ym2608_wasm_sdk.mjs',import.meta.url)).toString());
   if(!matches(Buffer.from(checker),proof.inputs.checker))fail('differential checker changed');
   verified=true;
  }
  return Buffer.from(entry.beforeBase64,'base64');
 };
}

const encoding=options=>typeof options==='string'?options:options?.encoding;
const defaultReader=createHistoricalYm2608SourceMixReader(
 createHistoricalGitReader('d81ce2bcf9be9c315a789d22dbafa230dfe8e1db'),
);
export function readHistoricalYm2608SourceMixFileSync(path,options){
 const location=path instanceof URL?path:new URL('file://'+resolve(String(path)));
 const bytes=defaultReader(location);
 return encoding(options)?bytes.toString(encoding(options)):bytes;
}
export async function readHistoricalYm2608SourceMixFile(path,options){
 const location=path instanceof URL?path:new URL('file://'+resolve(String(path)));
 const bytes=defaultReader(location);
 return encoding(options)?bytes.toString(encoding(options)):bytes;
}
