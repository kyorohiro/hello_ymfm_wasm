import {applyTextPatch,diffSnapshots,undoFileChanges} from './patch.js';
const compare=(a,b)=>a<b?-1:a>b?1:0;
const lines=text=>{const result=text.split('\n');if(result.at(-1)==='')result.pop();return result;};
const integer=(value,min,max,name)=>{const n=Number(value);if(!/^\d+$/.test(value)||!Number.isSafeInteger(n)||n<min||n>max)throw Error(`Invalid ${name}: expected ${min}..${max}`);return n;};
function options(args,booleans,values){
  const flags={},positional=[];
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--'){positional.push(...args.slice(i+1));break;}
    if(booleans.includes(arg)){flags[arg]=true;continue;}
    if(values.includes(arg)){if(i+1>=args.length)throw Error(`Missing value for ${arg}`);flags[arg]=args[++i];continue;}
    if(arg!=='-'&&arg.startsWith('-'))throw Error(`Unknown option: ${arg}; use -- before a path or pattern starting with -`);
    positional.push(arg);
  }
  return {flags,positional};
}
function* walk(context,path){
  const pending=[path];
  while(pending.length){
    context.assertActive();const path=pending.pop(),stat=context.fs.stat(path);
    yield {path,type:stat.type,size:stat.size,revision:stat.revision};
    if(stat.type==='directory')for(const name of context.fs.readdir(path).reverse())pending.push(context.resolve(path==='/'?'/'+name:path+'/'+name));
  }
}
function glob(pattern){return new RegExp('^'+[...pattern].map(c=>c==='*'?'.*':c==='?'?'.':c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('')+'$');}
function page(flags){return {offset:integer(flags['--offset']??'0',0,Number.MAX_SAFE_INTEGER,'offset'),limit:integer(flags['--limit']??'100',1,1000,'limit')};}
function resultPage(entries,flags,render,total=entries.length,alreadyPaged=false){
  const {offset,limit}=page(flags),selected=[];let budget=16000;
  for(const entry of entries.slice(alreadyPaged?0:offset,alreadyPaged?limit:offset+limit)){const size=Math.max(JSON.stringify(entry).length,render(entry).length)+1;if(size>budget){if(!selected.length)throw Error('Result exceeds output budget; narrow the query');break;}selected.push(entry);budget-=size;}
  const nextOffset=offset+selected.length;
  const truncated=nextOffset<total;
  return {code:0,stdout:flags['--json']?JSON.stringify({entries:selected,total,offset,nextOffset:truncated?nextOffset:null,truncated})+'\n':selected.map(render).join('\n')+(selected.length?'\n':''),stderr:truncated&&!flags['--json']?`More results: use --offset ${nextOffset}\n`:''};
}
function textFile(context,path){const file=context.fs.get(path);if(!file)throw Error(`File not found: ${path}`);if(file.type!=='text')throw Error(`Not a text file: ${path}`);return file.data;}
/** Commands for bounded inspection and exact edits. Patterns are literal, not host expressions.
 * @param {(name:string,command:import('./shell.js').Command)=>void} register
 * @param {(operation:string,paths:string[])=>void} authorize */
export function registerAgentCommands(register,authorize){
  const snapshots=new Map();
  register('find',context=>{
    const {flags,positional}=options(context.args,['--json'],['-name','-type','--offset','--limit']);
    if(positional.length>1)throw Error('Usage: find [PATH] [-name GLOB] [-type f|d] [--json] [--offset N] [--limit N]');
    if(flags['-type']&&!['f','d'].includes(flags['-type']))throw Error('Expected -type f or d');
    const pattern=flags['-name']?glob(flags['-name']):null;
    const entries=[...walk(context,context.resolve(positional[0]??'.'))].filter(entry=>(!flags['-type']||entry.type===(flags['-type']==='f'?'file':'directory'))&&(!pattern||pattern.test(entry.path.split('/').at(-1))));
    entries.sort((a,b)=>compare(a.path,b.path));return resultPage(entries,flags,e=>e.path+(e.type==='directory'&&e.path!=='/'?'/':''));
  });
  register('rg',async context=>{
    const {flags,positional}=options(context.args,['--json','-n','-F','-i','-l'],['--offset','--limit']);
    if(positional.length<1||positional.length>2)throw Error('Usage: rg [-n] [-F] [-i] [-l] [--json] [--offset N] [--limit N] PATTERN [PATH]');
    const pattern=flags['-i']?positional[0].toLowerCase():positional[0];
    if(!pattern||pattern.includes('\n')||pattern.includes('\r'))throw Error('Search pattern must be a nonempty single-line literal');
    const entries=[],{offset,limit}=page(flags);let total=0,scanned=0;
    const files=positional[1]==='-'?[{path:'-',type:'file',size:context.stdin.length}]:[...walk(context,context.resolve(positional[1]??'.'))].filter(entry=>entry.type==='file').sort((a,b)=>compare(a.path,b.path));
    for(const entry of files){
      if(entry.type!=='file')continue;const file=entry.path==='-'?{type:'text',data:context.stdin}:context.fs.get(entry.path);if(file.type!=='text')continue;
      const content=lines(file.data);
      for(let i=0;i<content.length;i++){
        if(++scanned%2048===0)await new Promise(resolve=>setTimeout(resolve,0));
        context.assertActive();const line=content[i],column=(flags['-i']?line.toLowerCase():line).indexOf(pattern);
        if(column<0)continue;
        const snippetStart=Math.max(0,column-200);
        if(total++>=offset&&entries.length<limit)entries.push(flags['-l']?{path:entry.path}:{path:entry.path,line:i+1,column:column+1,text:line.slice(snippetStart,snippetStart+1000),snippetStartColumn:snippetStart+1,textTruncated:snippetStart>0||line.length>snippetStart+1000});
        if(flags['-l'])break;
      }
    }
    const result=resultPage(entries,flags,e=>flags['-l']?e.path:`${e.path}:${e.line}:${e.text}${e.textTruncated?' …':''}`,total,true);
    if(!total)result.code=1;return result;
  });
  register('read',context=>{
    const {flags,positional}=options(context.args,['--json'],['--start','--end','--max-chars']);
    if(positional.length!==1)throw Error('Usage: read [--start N] [--end N] [--max-chars N] [--json] PATH');
    const path=positional[0]==='-'?'-':context.resolve(positional[0]),content=lines(path==='-'?context.stdin:textFile(context,path));
    const start=integer(flags['--start']??'1',1,Number.MAX_SAFE_INTEGER,'start');
    const end=integer(flags['--end']??String(start+199),start,Number.MAX_SAFE_INTEGER,'end');
    const max=integer(flags['--max-chars']??'16000',1,64000,'max-chars');
    let budget=max,nextLine=null;const selected=[];
    for(let i=start-1;i<Math.min(end,content.length);i++){
      context.assertActive();const line=content[i],text=line.slice(0,Math.max(0,budget-1));
      if(budget<=0){nextLine=i+1;break;}
      selected.push({line:i+1,text});budget-=text.length+1;
      if(text.length<line.length){nextLine=i+1;break;}
    }
    if(nextLine===null&&end<content.length)nextLine=end+1;
    return {code:0,stdout:flags['--json']?JSON.stringify({path,revision:path==='-'?null:context.fs.getRevision(path),lines:selected,totalLines:content.length,nextLine,truncated:nextLine!==null})+'\n':selected.map(e=>`${e.line}\t${e.text}`).join('\n')+(selected.length?'\n':''),stderr:nextLine!==null&&!flags['--json']?`Output truncated: continue with --start ${nextLine}\n`:''};
  });
  register('edit',context=>{
    const {flags,positional}=options(context.args,['--json','--dry-run'],['--expect','--revision']);
    if(positional.length!==3)throw Error('Usage: edit [--revision N] [--expect N] [--dry-run] [--json] PATH OLD_TEXT NEW_TEXT');
    const [input,oldText,newText]=positional,path=context.resolve(input),before=textFile(context,path);
    const revision=context.fs.getRevision(path),expectedRevision=flags['--revision']===undefined?revision:integer(flags['--revision'],0,Number.MAX_SAFE_INTEGER,'revision');
    if(revision!==expectedRevision)throw Error(`Revision conflict: ${path}; read the file again`);
    if(!oldText)throw Error('OLD_TEXT must not be empty');
    const expected=integer(flags['--expect']??'1',1,1000,'expect');
    const segments=before.split(oldText),matches=segments.length-1;
    if(matches!==expected)throw Error(`Edit conflict: expected ${expected} occurrence(s), found ${matches}; read the file again`);
    const after=segments.join(newText),changed=before!==after;
    if(!flags['--dry-run']&&changed){context.assertActive();authorize('edit',[path]);context.fs.writeText(path,after,{expectedRevision});}
    const report={path,revision:context.fs.getRevision(path),beforeRevision:revision,matches,changed,applied:!flags['--dry-run']&&changed};
    return flags['--json']?JSON.stringify(report)+'\n':`${flags['--dry-run']?'Preview':'Edit'} ${path}: ${matches} occurrence(s), ${report.applied?'applied':changed?'not applied':'unchanged'}\n`;
  });
  register('patch',context=>{
    const {flags,positional}=options(context.args,['--json','--dry-run'],[]);
    if(positional.length!==1)throw Error('Usage: patch [--json] [--dry-run] PATCH_FILE|-');
    const source=positional[0]==='-'?context.stdin:textFile(context,context.resolve(positional[0]));
    if(source.length>1000000)throw Error('Patch document exceeds 1,000,000 characters');
    const report=applyTextPatch(context.fs,JSON.parse(source),{cwd:context.cwd,dryRun:!!flags['--dry-run'],authorize,assertActive:context.assertActive});
    return flags['--json']?JSON.stringify(report)+'\n':`${report.applied?'Applied':'Preview'} ${report.changes.length} patch edit(s)\n`;
  });
  register('snapshot',context=>{
    const {flags,positional}=options(context.args,['--json','--list','--remove'],[]);
    if(positional.length>1||flags['--list']&&(positional.length||flags['--remove']))throw Error('Usage: snapshot [--json] [NAME] | snapshot --list | snapshot --remove NAME');
    const name=positional[0]??'baseline';
    if(flags['--list'])return JSON.stringify([...snapshots.keys()].sort())+'\n';
    if(flags['--remove']){if(!positional.length||!snapshots.delete(name))throw Error('Snapshot not found');return;}
    if(!snapshots.has(name)&&snapshots.size>=8)throw Error('At most 8 snapshots; remove one first');
    snapshots.set(name,context.fs.checkpoint());return flags['--json']?JSON.stringify({name,files:snapshots.get(name).snapshot.files.length})+'\n':`Snapshot ${name} saved\n`;
  });
  register('undo',context=>{
    const {flags,positional}=options(context.args,['--json','--dry-run'],[]);
    if(positional.length<2||positional.length>3)throw Error('Usage: undo [--json] [--dry-run] BEFORE AFTER [PATH]');
    const before=snapshots.get(positional[0]),after=snapshots.get(positional[1]);
    if(!before||!after)throw Error('Snapshot not found');
    const report=undoFileChanges(context.fs,before,after,{path:context.resolve(positional[2]??'/'),dryRun:!!flags['--dry-run'],authorize,assertActive:context.assertActive});
    const stdout=flags['--json']?JSON.stringify(report)+'\n':report.conflicts.length?`Undo conflict: ${report.conflicts.map(c=>c.path).join(', ')}\n`:`${report.applied?'Undid':'Preview'} ${report.total} path change(s)\n`;
    return {code:report.conflicts.length?1:0,stdout,stderr:''};
  });
  register('diff',context=>{
    const {flags,positional}=options(context.args,['--json'],['--offset','--limit']);
    if(positional.length>2)throw Error('Usage: diff [--json] [--offset N] [--limit N] [NAME] [PATH]');
    const name=positional[0]??'baseline',before=snapshots.get(name);if(!before)throw Error(`Snapshot not found: ${name}`);
    const changes=diffSnapshots(before.snapshot,context.fs.snapshot(),{path:context.resolve(positional[1]??'/')});
    return resultPage(changes,flags,e=>e.hunk?`--- ${e.path} (before)\n+++ ${e.path} (after)\n${e.hunk}${e.hunkTruncated?'[hunk truncated]\n':''}`:`${e.status}: ${e.path} (${e.beforeType??'missing'} -> ${e.afterType??'missing'})`);
  });
  return {clearSnapshots(){snapshots.clear();}};

}
