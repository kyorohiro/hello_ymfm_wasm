import {createVirtualFileSystem} from './filesystem.js';
import {resolvePath} from './path.js';
/** @typedef {{path:string,type?:'replace',oldText:string,newText:string,expect?:number}|{path:string,type:'create',text:string}|{path:string,type:'delete',expectedText:string}} TextPatch */
/** Stage every operation, then commit once. Failed validation never writes to the live store.
 * @param {ReturnType<typeof createVirtualFileSystem>} fs
 * @param {TextPatch[]} edits
 * @param {{cwd?:string,dryRun?:boolean,authorize?:(operation:string,paths:string[])=>void,assertActive?:()=>void}} [options] */
export function applyTextPatch(fs,edits,{cwd='/',dryRun=false,authorize=()=>{},assertActive=()=>{}}={}){
  if(!Array.isArray(edits)||!edits.length||edits.length>1000)throw Error('Patch must contain 1..1000 edits');
  assertActive();const draft=createVirtualFileSystem();draft.restore(fs.snapshot());
  const changes=[],removed=[];
  for(const edit of edits){
    assertActive();if(!edit||typeof edit!=='object'||typeof edit.path!=='string'||!edit.path)throw Error('Each edit needs a nonempty path');
    const path=resolvePath(edit.path,cwd),type=edit.type??'replace',file=draft.get(path);
    if(path==='/')throw Error('Cannot patch the filesystem root');
    const allowed=type==='replace'?['path','type','oldText','newText','expect']:type==='create'?['path','type','text']:type==='delete'?['path','type','expectedText']:[];
    if(!allowed.length||Object.keys(edit).some(k=>!allowed.includes(k)))throw Error(`Invalid patch fields: ${path}`);
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
  if(!dryRun){authorize('patch',paths);for(const path of new Set(removed))authorize('rm',[path]);assertActive();fs.replace(draft.list(),draft.listDirectories());}
  return {applied:!dryRun,changes};
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
