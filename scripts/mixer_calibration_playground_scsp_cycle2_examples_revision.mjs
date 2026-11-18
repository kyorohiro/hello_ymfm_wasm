/** Exact data-only Examples registration. No example source is executed here.
 * Restore three complete reviewed bodies before the existing calibration chain. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';

export const SCSP_CYCLE2_EXAMPLES_BASE='d0372196c843629f9b206bcff5aeb1f09628d408';
export const SCSP_CYCLE2_EXAMPLES_RECEIPT='docs/issues/playground_scsp_cycle2_examples_source_revision_01.json';
export const SCSP_CYCLE2_EXAMPLES_PIN='50653b0f6a3cf800861234dc4c0b6484f541a5397ee0c451ef39d7a514a34eb7';
export const SCSP_CYCLE2_EXAMPLES_PATH='/examples/scsp/scsp-cycle2-prototype.js';
export const SCSP_CYCLE2_EXAMPLES_SOURCES=Object.freeze([
  'docs/playground/playground_examples.js','docs/playground/playground_mode_examples.js','docs/playground/playground.js',
]);
export const SCSP_CYCLE2_EXAMPLES_RELATED=Object.freeze([
  'docs/playground/examples/scsp/scsp-cycle2-prototype.js',
  'docs/playground/playground_scsp_cycle2_example.test.mjs','docs/playground/playground_examples.test.mjs',
  'docs/playground/playground_mode_starters.js','docs/playground/playground_mode_starters.test.mjs',
  'scripts/build_playground_examples.mjs','scripts/check_scsp_cycle2_prototype_browser.cjs',
  'scripts/mixer_calibration_scsp_fm_multiple_self_revision.mjs',
  'scripts/mixer_calibration_scsp_dsp_routing_revision.mjs',
  'docs/playground/playground_mixer_defaults.js','docs/js/soundchip_mixer_presets.js',
  'tetorica_src/runtime/scspsynth.js','docs/js/scspsynth.js',
  'docs/generated/scsp_wasm.js','docs/generated/scsp_wasm.wasm',
  'third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.cpp',
  'third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.h',
]);
export const SCSP_CYCLE2_EXAMPLES_REPORTS=Object.freeze([
  'docs/issues/playground_scsp_dsp_routing_source_revision_01.json',
  'docs/issues/scsp_fm_multiple_self_source_revision_01.json',
]);
const root=fileURLToPath(new URL('../',import.meta.url)),read=url=>readFileSync(url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const matches=(bytes,record)=>record&&bytes.length===record.bytes&&sha(bytes)===record.sha256;
const keys=(object,names)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).length===names.length&&names.every(name=>Object.hasOwn(object,name));
const fail=message=>{throw Error('Invalid exact SCSP cycle2 Examples revision: '+message);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const nameOf=path=>typeof path==='string'&&path.startsWith('playground/')?'docs/'+path:path;

/** Parse only the generator's JSON values, never evaluate its JavaScript. */
export function parseScspCycle2ExampleCatalog(bytes){
  let text=bytes.toString('utf8');
  const result={};
  for(const [name,end]of [
    ['DEFAULT_CODE',';\nexport const MODE_DEFAULT_CODES = '],
    ['MODE_DEFAULT_CODES',';\nexport const MODE_DEFAULT_HISTORY = '],
    ['MODE_DEFAULT_HISTORY',';\nexport const EXAMPLE_FILES = '],
    ['EXAMPLE_FILES',';\nexport const EXAMPLES = '],
  ]){
    const start='export const '+name+' = ',at=text.indexOf(start),stop=text.indexOf(end,at+start.length);
    if(at<0||text.indexOf(start,at+1)>=0||stop<0)fail('generated catalog declaration changed: '+name);
    result[name]=JSON.parse(text.slice(at+start.length,stop));
    text=text.slice(0,at+start.length)+'<'+name+'>'+text.slice(stop);
  }
  const start='export const MODE_EXAMPLE_FILES = Object.fromEntries(Object.entries(',end=').map(([id, paths]) => [id, paths.map(path => exampleByPath.get(path))]));';
  const at=text.indexOf(start),stop=text.indexOf(end,at+start.length);
  if(at<0||text.indexOf(start,at+1)>=0||stop<0)fail('generated mode catalog declaration changed');
  result.modes=JSON.parse(text.slice(at+start.length,stop));
  result.scaffold=text.slice(0,at+start.length)+'<MODE_EXAMPLE_FILES>'+text.slice(stop);
  return result;
}

/** Check the entire non-audio change rather than granting a generic hash bypass. */
export function verifyScspCycle2ExamplesDataOnly(before,after,example){
  const catalog=SCSP_CYCLE2_EXAMPLES_SOURCES[0],mode=SCSP_CYCLE2_EXAMPLES_SOURCES[1],page=SCSP_CYCLE2_EXAMPLES_SOURCES[2];
  const a=parseScspCycle2ExampleCatalog(before[catalog]),b=parseScspCycle2ExampleCatalog(after[catalog]);
  for(const key of ['DEFAULT_CODE','MODE_DEFAULT_CODES','MODE_DEFAULT_HISTORY','scaffold'])if(!same(a[key],b[key]))fail('old defaults or executable catalog scaffold changed: '+key);
  const additions=b.EXAMPLE_FILES.filter(file=>!a.EXAMPLE_FILES.some(old=>old.path===file.path));
  if(additions.length!==1||additions[0].path!==SCSP_CYCLE2_EXAMPLES_PATH||additions[0].name!=='scsp-cycle2-prototype'||additions[0].data!==example.toString('utf8')||
      !same(b.EXAMPLE_FILES.filter(file=>file.path!==SCSP_CYCLE2_EXAMPLES_PATH),a.EXAMPLE_FILES))fail('old example content/order changed or new source detached');
  if(!same(Object.keys(a.modes),Object.keys(b.modes)))fail('mode inventory changed');
  for(const id of Object.keys(a.modes)){
    const expected=id==='scsp'?[...a.modes[id].slice(0,2),SCSP_CYCLE2_EXAMPLES_PATH,...a.modes[id].slice(2)]:a.modes[id];
    if(!same(b.modes[id],expected))fail('unexpected mode catalog edit: '+id);
  }
  const insertion="'/examples/scsp/scsp-two-slot-fm.js','/examples/scsp/scsp-dsp-roundtrip.js'";
  const source=before[mode].toString('utf8');
  if(source.split(insertion).length!==2||after[mode].toString('utf8')!==source.replace(insertion,"'/examples/scsp/scsp-two-slot-fm.js','"+SCSP_CYCLE2_EXAMPLES_PATH+"','/examples/scsp/scsp-dsp-roundtrip.js'"))fail('mode registration changes beyond one SCSP path');
  const oldImport='./playground_examples.js?v=scsp-dsp-routing-1',newImport='./playground_examples.js?v=scsp-cycle2-examples-1',oldPage=before[page].toString('utf8');
  if(oldPage.split(oldImport).length!==2||after[page].toString('utf8')!==oldPage.replace(oldImport,newImport))fail('page changes beyond one catalog cache query');
  return {existingExamples:a.EXAMPLE_FILES.length,modes:Object.keys(a.modes).length,addedPath:SCSP_CYCLE2_EXAMPLES_PATH,oldDefaultsExact:true,oldExamplesExact:true,otherModesExact:true,executableScaffoldExact:true,exampleExecuted:false};
}
function restoreBody(bytes,entry){
  const parts=[];let cursor=0;
  if(!Array.isArray(entry.reverseHunks)||!entry.reverseHunks.length)fail('missing exact source recipe');
  for(const h of entry.reverseHunks){
    if(!keys(h,['afterOffset','afterBytes','beforeText'])||!Number.isSafeInteger(h.afterOffset)||h.afterOffset<cursor||!Number.isSafeInteger(h.afterBytes)||h.afterBytes<0||h.afterOffset+h.afterBytes>bytes.length||typeof h.beforeText!=='string')fail('invalid exact source recipe');
    parts.push(bytes.subarray(cursor,h.afterOffset),Buffer.from(h.beforeText));cursor=h.afterOffset+h.afterBytes;
  }
  parts.push(bytes.subarray(cursor));const previous=Buffer.concat(parts);
  if(!matches(previous,entry.before))fail('complete predecessor reconstruction mismatch');
  return previous;
}
function createRestorer(readSource,snapshot=false){
  let receipt,verified=false;
  return(path,bytes)=>{
    const name=nameOf(path);if(!SCSP_CYCLE2_EXAMPLES_SOURCES.includes(name))return bytes;
    if(!receipt||!snapshot){
      receipt=JSON.parse(readSource(new URL('../'+SCSP_CYCLE2_EXAMPLES_RECEIPT,import.meta.url)));
      if(sha(JSON.stringify(receipt))!==SCSP_CYCLE2_EXAMPLES_PIN)fail('independently pinned receipt changed');
      if(receipt.schemaVersion!==1||receipt.scope!=='playground-scsp-cycle2-data-only-examples-registration'||receipt.baseCommit!==SCSP_CYCLE2_EXAMPLES_BASE||!keys(receipt.sources,SCSP_CYCLE2_EXAMPLES_SOURCES)||!keys(receipt.relatedSources,SCSP_CYCLE2_EXAMPLES_RELATED)||!keys(receipt.reports,SCSP_CYCLE2_EXAMPLES_REPORTS))fail('receipt inventory changed');
    }
    const entry=receipt.sources[name];if(!matches(bytes,entry.after))return bytes;
    if(!verified){
      const current={},previous={};
      for(const dependency of [...SCSP_CYCLE2_EXAMPLES_SOURCES,...SCSP_CYCLE2_EXAMPLES_RELATED,...SCSP_CYCLE2_EXAMPLES_REPORTS]){
        const data=Buffer.from(readSource(new URL('../'+dependency,import.meta.url))),expected=receipt.sources[dependency]?.after??receipt.relatedSources[dependency]??receipt.reports[dependency];
        if(!matches(data,expected))fail('pinned source/report dependency changed: '+dependency);
        if(SCSP_CYCLE2_EXAMPLES_SOURCES.includes(dependency)){current[dependency]=data;previous[dependency]=restoreBody(data,receipt.sources[dependency]);}
      }
      const summary=verifyScspCycle2ExamplesDataOnly(previous,current,readSource(new URL('../'+SCSP_CYCLE2_EXAMPLES_RELATED[0],import.meta.url)));
      if(!same(summary,receipt.dataOnly))fail('data-only result changed');
      verified=snapshot;
    }
    return restoreBody(Buffer.from(bytes),entry);
  };
}
export function restoreMixerCalibrationPlaygroundScspCycle2ExamplesRevision(path,bytes,{readSource=read}={}){return createRestorer(readSource)(path,bytes);}
export function createPlaygroundScspCycle2ExamplesRevisionReadContext(readSource=read){
  const originals=new Map(),predecessors=new Map();
  const original=url=>{const key=url instanceof URL?url.href:url;if(!originals.has(key))originals.set(key,Buffer.from(readSource(url)));return originals.get(key);};
  const restore=createRestorer(original,true);
  const reader=url=>{const key=url instanceof URL?url.href:url;if(!predecessors.has(key)){const bytes=original(url),path=url instanceof URL&&url.protocol==='file:'?relative(root,fileURLToPath(url)).replaceAll('\\','/'):null;predecessors.set(key,path===null?bytes:restore(path,bytes));}return predecessors.get(key);};
  return {restore,readSource:reader};
}
