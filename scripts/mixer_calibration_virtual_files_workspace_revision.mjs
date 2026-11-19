// Exact non-audio file-workspace transition; measured DSP and gains are kept.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const VIRTUAL_FILES_WORKSPACE_RECEIPT='docs/issues/virtual_files_workspace_calibration_revision_20261119.json';
export const VIRTUAL_FILES_WORKSPACE_PIN='2529d9df54deac5cab8887ca1764c071abd47e65e7ed52bd4424e246460639d5';
const targets=['js/tetorica_virtual_files/filesystem.js','js/tetorica_virtual_files/index.js'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const match=(b,r)=>r&&b.length===r.bytes&&sha(b)===r.sha256;
const fail=path=>{throw Error('Invalid Virtual Files workspace calibration revision: '+path);};
export function isMixerCalibrationVirtualFilesWorkspaceRevision(path,bytes,record,{readSource=url=>readFileSync(url)}={}){
  if(!targets.includes(path))return false;
  const r=JSON.parse(readSource(new URL('../'+VIRTUAL_FILES_WORKSPACE_RECEIPT,import.meta.url)));
  if(sha(JSON.stringify(r))!==VIRTUAL_FILES_WORKSPACE_PIN)fail('independent receipt pin changed');
  if(r.scope!=='virtual-files-working-saved-non-audio-revision'||JSON.stringify(Object.keys(r.sources))!==JSON.stringify(targets))fail('source inventory changed');
  const entry=r.sources[path];
  if(record?.bytes!==entry.before.bytes||record.sha256!==entry.before.sha256||!match(bytes,entry.after))return false;
  for(const [name,expected]of Object.entries({...r.dependencies,...r.reports})){
    if(!match(readSource(new URL('../'+name,import.meta.url)),expected))fail('dependency changed: '+name);
  }
  return true;
}
