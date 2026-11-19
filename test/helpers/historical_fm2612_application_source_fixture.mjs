// SPDX-License-Identifier: BSD-3-Clause
// Test-only dependency history, not evidence that a current application is
// equivalent to its predecessor. Production freshness readers do not use this.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const FM2612_APPLICATION_HISTORY_PATH='test/fixtures/fm2612-application-predecessors.json';
export const FM2612_APPLICATION_HISTORY_PIN='ab40e94c5a328241f1e767ac2cf65df20fc21bad3f873ea6e8b8fecb828f37d9';
const root=fileURLToPath(new URL('../../',import.meta.url));
const names=Object.freeze(['docs/synth/synth.js','docs/synth/index.html','docs/synth/synth_code_declarations.js',
  'scripts/mixer_calibration_scsp_output_level_new_cassette_revision.test.mjs','scripts/mixer_calibration_scsp_live_highlight_revision.test.mjs']);
const receiptNames=Object.freeze(['docs/issues/scsp_output_level_new_cassette_source_revision_01.json','docs/issues/playground_scsp_dsp_helpers_source_revision_01.json',
  'docs/issues/ym2608_source_mix_mixer_policy_revision_01.json']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[0-9a-f]{64}$/.test(value.sha256);
const matches=(bytes,expected)=>record(expected)&&bytes.length===expected.bytes&&sha(bytes)===expected.sha256;
const exactKeys=(value,keys)=>value&&JSON.stringify(Object.keys(value))===JSON.stringify(keys);
const fail=message=>{throw Error('Invalid historical FM2612 application fixture: '+message);};

/** An owned read snapshot authenticates the complete pair before returning any
 * predecessor. Unexpected bodies pass through to the historical guard, which
 * rejects them; a changed companion/receipt cannot authorize a partial graph. */
export function createHistoricalFm2612ApplicationReader(readSource=location=>readFileSync(location)){
  const originals=new Map(),predecessors=new Map();let evidence,verified=false;
  const location=name=>new URL('../../'+name,import.meta.url);
  function original(url){const key=url.href;if(!originals.has(key))originals.set(key,Buffer.from(readSource(url)));return originals.get(key);}
  function metadata(){
    if(evidence)return evidence;
    const value=JSON.parse(original(location(FM2612_APPLICATION_HISTORY_PATH)));
    if(sha(JSON.stringify(value))!==FM2612_APPLICATION_HISTORY_PIN)fail('independently pinned fixture changed');
    if(value.schemaVersion!==1||value.scope!=='test-only-fm2612-application-history'||value.baseCommit!=='db1e739d5bf8dac68bf93aa3aea34ef098153b25'||!exactKeys(value.sources,names)||!exactKeys(value.historicalReceipts,receiptNames))fail('exact source/receipt inventory changed');
    for(const name of names){const entry=value.sources[name];if(!record(entry.before)||!record(entry.after)||!Array.isArray(entry.reverseHunks)||!entry.reverseHunks.length)fail('invalid source pair: '+name);
      let cursor=0;for(const hunk of entry.reverseHunks){if(!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||!Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>entry.after.bytes||typeof hunk.beforeText!=='string')fail('invalid reverse hunk: '+name);cursor=hunk.afterOffset+hunk.afterBytes;}}
    evidence=value;return value;
  }
  function verify(value){
    if(verified)return;
    for(const path of receiptNames)if(!matches(original(location(path)),value.historicalReceipts[path]))fail('historical receipt changed: '+path);
    const scsp=JSON.parse(original(location(receiptNames[0]))),helpers=JSON.parse(original(location(receiptNames[1]))),policy=JSON.parse(original(location(receiptNames[2])));
    for(const name of names){
      const entry=value.sources[name],expected=policy.sources[name]?.after??scsp.relatedSources[name]??scsp.sources[name]?.after??helpers.sources[name]?.after;
      if(JSON.stringify(entry.before)!==JSON.stringify(expected))fail('predecessor detached from historical receipt: '+name);
      const bytes=original(location(name));if(!matches(bytes,entry.after))fail('current dependency changed: '+name);
      const parts=[];let cursor=0;
      for(const hunk of entry.reverseHunks){parts.push(bytes.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));cursor=hunk.afterOffset+hunk.afterBytes;}
      parts.push(bytes.subarray(cursor));const previous=Buffer.concat(parts);
      if(!matches(previous,entry.before))fail('complete predecessor mismatch: '+name);
      predecessors.set(name,previous);
    }
    verified=true;
  }
  return path=>{
    const url=path instanceof URL?path:new URL('file://'+resolve(String(path))),bytes=original(url);
    const name=url.protocol==='file:'?relative(root,fileURLToPath(url)).replaceAll('\\','/'):null;
    if(!names.includes(name))return Buffer.from(bytes);
    const value=metadata();if(!matches(bytes,value.sources[name].after))return Buffer.from(bytes);
    verify(value);return Buffer.from(predecessors.get(name));
  };
}
