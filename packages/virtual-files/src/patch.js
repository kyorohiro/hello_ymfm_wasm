import {createVirtualFileSystem} from './filesystem.js';
import {resolvePath} from './path.js';
/** @typedef {{path:string,expectedRevision?:number,type?:'replace',oldText:string,newText:string,expect?:number}|{path:string,expectedRevision?:number,type:'create',text:string}|{path:string,expectedRevision?:number,type:'delete',expectedText:string}} TextPatch */
/** Stage every operation, then commit once. Failed validation never writes to the live store.
 * @param {ReturnType<typeof createVirtualFileSystem>} fs
 * @param {TextPatch[]} edits
 * @param {{cwd?:string,dryRun?:boolean,authorize?:(operation:string,paths:string[])=>void,assertActive?:()=>void}} [options] */
export function applyTextPatch(fs,edits,{cwd='/',dryRun=false,authorize=()=>{},assertActive=()=>{}}={}){
  if(!Array.isArray(edits)||!edits.length||edits.length>1000)throw Error('Patch must contain 1..1000 edits');
  assertActive();const draft=createVirtualFileSystem();draft.restore(fs.snapshot());
  const changes=[],removed=[],revisions=new Map();
  for(const edit of edits){
    assertActive();if(!edit||typeof edit!=='object'||typeof edit.path!=='string'||!edit.path)throw Error('Each edit needs a nonempty path');
    const path=resolvePath(edit.path,cwd),type=edit.type??'replace',file=draft.get(path);
    if(path==='/')throw Error('Cannot patch the filesystem root');
    if(!revisions.has(path))revisions.set(path,fs.getRevision(path));
    if(edit.expectedRevision!==undefined&&(!Number.isSafeInteger(edit.expectedRevision)||edit.expectedRevision<0))throw Error(`Invalid expectedRevision: ${path}`);
    if(edit.expectedRevision!==undefined&&edit.expectedRevision!==revisions.get(path))throw Error(`Revision conflict: ${path}; read the file again`);
    const allowed=type==='replace'?['path','type','oldText','newText','expect']:type==='create'?['path','type','text']:type==='delete'?['path','type','expectedText']:[];
    if(!allowed.length||Object.keys(edit).some(k=>k!=='expectedRevision'&&!allowed.includes(k)))throw Error(`Invalid patch fields: ${path}`);
    if(type==='create'){
      if(file||draft.listDirectories().includes(path))throw Error(`Patch conflict: path exists: ${path}`);
      if(typeof edit.text!=='string')throw Error(`Create requires text: ${path}`);
      draft.writeText(path,edit.text);changes.push({path,type,matches:0});continue;
    }
    if(!file||file.type!=='text')throw Error(`Patch requires an existing text file: ${path}`);
    if(type==='delete'){
      if(typeof edit.expectedText!=='string'||edit.expectedText!==file.data)throw Error(`Patch conflict: expectedText differs: ${path}`);
      draft.delete(path);removed.push(path);changes.push({path,type,matches:1});continue;
    }
    if(typeof edit.oldText!=='string'||!edit.oldText||typeof edit.newText!=='string')throw Error(`Replace requires nonempty oldText and string newText: ${path}`);
    const expected=edit.expect??1;
    if(!Number.isSafeInteger(expected)||expected<1||expected>1000)throw Error(`Invalid expect: ${path}`);
    const parts=file.data.split(edit.oldText),matches=parts.length-1;
    if(matches!==expected)throw Error(`Patch conflict: ${path}: expected ${expected} occurrence(s), found ${matches}`);
    draft.writeText(path,parts.join(edit.newText));changes.push({path,type,matches});
  }
  assertActive();
  const paths=[...new Set(changes.map(c=>c.path))];
  if(!dryRun){authorize('patch',paths);for(const path of new Set(removed))authorize('rm',[path]);assertActive();for(const [path,revision] of revisions)if(fs.getRevision(path)!==revision)throw Error(`Revision conflict: ${path}; read the file again`);fs.replace(draft.list(),draft.listDirectories());}
  return {applied:!dryRun,changes:changes.map(change=>({...change,beforeRevision:revisions.get(change.path),revision:fs.getRevision(change.path)}))};
}
function same(a,b){return a.type===b.type&&(a.type==='text'?a.data===b.data:a.data.length===b.data.length&&a.data.every((v,i)=>v===b.data[i]));}
function textDiff(before,after){
  const a=before.split('\n'),b=after.split('\n');let start=0,endA=a.length,endB=b.length;
  while(start<endA&&start<endB&&a[start]===b[start])start++;
  while(endA>start&&endB>start&&a[endA-1]===b[endB-1]){endA--;endB--;}
  const from=Math.max(0,start-3),toA=Math.min(a.length,endA+3),toB=Math.min(b.length,endB+3);
  const hunk=[`@@ -${from+1},${toA-from} +${from+1},${toB-from} @@`];let budget=2000,truncated=false;
  const add=(prefix,line)=>{const text=prefix+line;if(text.length+1>budget){hunk.push(text.slice(0,Math.max(0,budget)));budget=0;truncated=true;return false;}hunk.push(text);budget-=text.length+1;return true;};
  for(let i=from;i<start;i++)if(!add(' ',a[i]))break;
  if(!truncated)for(let i=start;i<endA;i++)if(!add('-',a[i]))break;
  if(!truncated)for(let i=start;i<endB;i++)if(!add('+',b[i]))break;
  if(!truncated)for(let i=endB;i<toB;i++)if(!add(' ',b[i]))break;
  return {hunk:hunk.join('\n')+'\n',hunkTruncated:truncated};
}
/** @typedef {{path:string,status:'added'|'removed'|'modified',beforeType:'text'|'binary'|'directory'|null,afterType:'text'|'binary'|'directory'|null,hunk?:string,hunkTruncated?:boolean}} SnapshotChange */
/** Compare validated snapshots, including binary changes and empty directories.
 * Text excerpts are bounded review output, not an executable unified patch.
 * @param {import('./filesystem.js').Snapshot} before
 * @param {import('./filesystem.js').Snapshot} after
 * @param {{path?:string}} [options]
 * @returns {SnapshotChange[]} */
export function diffSnapshots(before,after,{path='/'}={}){
  const left=createVirtualFileSystem(),right=createVirtualFileSystem();left.restore(before);right.restore(after);
  path=resolvePath(path);const inside=p=>path==='/'||p===path||p.startsWith(path+'/');
  const a=new Map(left.list().map(f=>[f.path,f])),b=new Map(right.list().map(f=>[f.path,f]));
  const dirsA=new Set(left.listDirectories()),dirsB=new Set(right.listDirectories());
  const paths=[...new Set([...a.keys(),...b.keys(),...dirsA,...dirsB])].filter(inside).sort(),changes=[];
  for(const path of paths){
    const old=a.get(path),now=b.get(path);
    if(old&&now&&same(old,now))continue;
    if(!old&&!now&&dirsA.has(path)===dirsB.has(path))continue;
    const beforeType=old?old.type:dirsA.has(path)?'directory':null,afterType=now?now.type:dirsB.has(path)?'directory':null;
    const change={path,status:beforeType===null?'added':afterType===null?'removed':'modified',beforeType,afterType};
    if((!old||old.type==='text')&&(!now||now.type==='text')&&(old||now))Object.assign(change,textDiff(old?.data??'',now?.data??''));
    changes.push(change);
  }
  return changes;
}

/** Undo only the paths changed between two live-store checkpoints. Unrelated
 * edits are retained; any conflict prevents the entire commit.
 * @param {ReturnType<typeof createVirtualFileSystem>} fs
 * @param {import('./filesystem.js').FileCheckpoint} before
 * @param {import('./filesystem.js').FileCheckpoint} after
 * @param {{path?:string,dryRun?:boolean,authorize?:(operation:string,paths:string[])=>void,assertActive?:()=>void}} [options] */
export function undoFileChanges(fs,before,after,{path='/',dryRun=false,authorize=()=>{},assertActive=()=>{}}={}){
  assertActive();
  if(!before||!after||before.scope!==fs.checkpoint().scope||after.scope!==before.scope)throw Error('Undo checkpoints belong to a different filesystem');
  const changes=diffSnapshots(before.snapshot,after.snapshot,{path}).map(({hunk,hunkTruncated,...change})=>change);
  const oldFiles=new Map(before.snapshot.files.map(f=>[f.path,f]));
  const afterFiles=new Map(after.snapshot.files.map(f=>[f.path,f]));
  const afterDirs=new Set(after.snapshot.directories),selected=new Set(changes.map(c=>c.path));
  function conflicts(){
    assertActive();const found=[];
    const currentPaths=[...fs.list().map(f=>f.path),...fs.listDirectories()];
    for(const change of changes){
      const path=change.path,current=fs.get(path),expected=afterFiles.get(path);
      const revision=after.revisions[path]??0;
      if(!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid checkpoint revision');
      if(fs.getRevision(path)!==revision||(current||expected?(!current||!expected||!same(current,expected)):fs.listDirectories().includes(path)!==afterDirs.has(path)))found.push({path,reason:'changed since AFTER snapshot'});
      else if(change.afterType==='directory'&&change.beforeType!=='directory'&&currentPaths.some(p=>p.startsWith(path+'/')&&!selected.has(p)))found.push({path,reason:'directory contains later additions'});
    }
    return found;
  }
  let blocked=conflicts();
  const report=()=>({applied:false,total:changes.length,changes:changes.slice(0,100),conflicts:blocked.slice(0,100),totalConflicts:blocked.length,truncated:changes.length>100||blocked.length>100});
  if(blocked.length||dryRun||!changes.length)return report();
  authorize('undo',changes.map(c=>c.path));
  for(const change of changes)if(change.afterType!==null&&change.afterType!==change.beforeType)authorize('rm',[change.path]);
  blocked=conflicts();if(blocked.length)return report();
  // Merge into the latest store so authorization callbacks cannot erase unrelated edits.
  const files=new Map(fs.list().map(f=>[f.path,f])),dirs=new Set(fs.listDirectories());
  for(const change of changes){files.delete(change.path);dirs.delete(change.path);if(oldFiles.has(change.path))files.set(change.path,oldFiles.get(change.path));if(change.beforeType==='directory')dirs.add(change.path);}
  const draft=createVirtualFileSystem();draft.replace([...files.values()],[...dirs]);
  assertActive();fs.replace(draft.list(),draft.listDirectories());
  return {...report(),applied:true};
}
