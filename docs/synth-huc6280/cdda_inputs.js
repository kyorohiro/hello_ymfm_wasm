// SPDX-License-Identifier: BSD-3-Clause
// App-local CD-DA input routing. Session File references stay outside the
// portable Files/Cassette filesystem and its unchanged 16 MiB budget.
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {parseCddaTrackManifest} from '../js/cdda_source.js';
import {isCddaSessionPath} from './cdda_session_files.js';
export {isCddaSessionPath} from './cdda_session_files.js';

export function resolveCddaInputPath(path,executionPath='/index.js') {
  if(typeof path!=='string'||!path.trim()||/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path.trimStart()))throw new TypeError('CD-DA needs a local virtual file path');
  if(typeof executionPath!=='string'||!executionPath.startsWith('/'))throw new TypeError('CD-DA execution path must be an absolute virtual path');
  return normalizeVirtualPath(path,normalizeVirtualPath(executionPath));
}

/** UI uses the default /index.js base. Code supplies its executionPath closure
 * or explicit {path} as the third argument. The reserved session namespace
 * never falls back to a colliding or stale project file. Other project reads
 * retain the existing Project provider; no File references are serialized.
 */
export function createCddaInputReader({project,session,getExecutionPath=()=>'/index.js'}={}) {
  if(typeof project?.readFile!=='function'||typeof session?.readFile!=='function'||typeof getExecutionPath!=='function')throw new TypeError('CD-DA reader requires Project and session file providers');
  return async function read(path,{signal,type='arrayBuffer'}={},entry={}) {
    if(type!=='arrayBuffer')throw new TypeError('CD-DA media reader returns bytes only');
    signal?.throwIfAborted();
    const executionPath=entry?.path??getExecutionPath(),resolved=resolveCddaInputPath(path,executionPath);
    if(isCddaSessionPath(resolved))return session.readFile(resolved,{signal});
    const source=await project.readFile(resolved,{type:'arrayBuffer'},{path:executionPath});signal?.throwIfAborted();
    if(source instanceof ArrayBuffer)return new Uint8Array(source);
    if(source instanceof Uint8Array)return new Uint8Array(source);
    throw new TypeError('CD-DA Project media reader must return WAV or manifest bytes');
  };
}

/** Project picker metadata filter. Named *.cdda.json manifests are listed for
 * explicit validation on Load. Other JSON files are shown only when their
 * provided text/bytes form an existing supported {tracks:[...]} manifest.
 */
export function isCddaProjectEntry(entry,data) {
  const path=entry?.path,type=entry?.fileType??entry?.type;
  if(typeof path!=='string'||entry?.session||isCddaSessionPath(path))return false;
  if(/\.wav$/i.test(path))return type==='binary';
  if(!/\.json$/i.test(path)||!['text','binary'].includes(type))return false;
  if(/\.cdda\.json$/i.test(path))return true;
  data??=entry?.data;
  try {
    if(data instanceof ArrayBuffer)data=new Uint8Array(data);
    if(data instanceof Uint8Array)data=new TextDecoder('utf-8',{fatal:true}).decode(data);
    parseCddaTrackManifest(data);return true;
  } catch{return false;}
}
