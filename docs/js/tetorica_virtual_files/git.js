import git from 'isomorphic-git';
import {Buffer} from 'buffer';
import {createTwoFilesPatch} from 'diff';
import {createVirtualFileSystem} from './filesystem.js';
import {resolvePath} from './path.js';
// isomorphic-git's ESM build expects the standard browser Buffer polyfill.
if(!Reflect.get(globalThis,'Buffer'))Reflect.set(globalThis,'Buffer',Buffer);

/** @typedef {ReturnType<typeof createVirtualFileSystem>} VirtualFS */
/** @typedef {{request:(request:any)=>Promise<any>}} HttpClient */
/** @param {string} message @param {string} code */
function failure(message, code) {return Object.assign(Error(message), {code});}
/** Node-compatible promise filesystem for isomorphic-git. No host files are accessed.
 * @param {VirtualFS} store */
export function createGitFileSystem(store) {
  const bytes = value => typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  function stat(path) {
    try {const s=store.stat(path);return {size:s.size,mode:s.type==='directory'?0o40755:0o100644,mtimeMs:s.revision*1000,ctimeMs:s.revision*1000,uid:0,gid:0,ino:0,dev:0,
      isFile:()=>s.type==='file',isDirectory:()=>s.type==='directory',isSymbolicLink:()=>false};}
    catch {throw failure(`No such file: ${path}`,'ENOENT');}
  }
  return {promises:{
    async readFile(path,options){const file=store.get(path);if(!file)throw failure(`No such file: ${path}`,'ENOENT');const data=bytes(file.data);return (typeof options==='string'?options:options?.encoding)?new TextDecoder().decode(data):data;},
    async writeFile(path,data){store.writeBinary(path,bytes(data));},
    async unlink(path){if(!store.delete(path))throw failure(`No such file: ${path}`,'ENOENT');},
    async readdir(path){try{return store.readdir(path);}catch{throw failure(`No such directory: ${path}`,'ENOENT');}},
    async mkdir(path){try{store.mkdir(path);}catch(error){if(store.listDirectories().includes(resolvePath(path)))throw failure(`Already exists: ${path}`,'EEXIST');if(!store.listDirectories().includes(resolvePath(path+'/..')))throw failure(`Parent directory does not exist: ${path}`,'ENOENT');throw error;}},
    async rmdir(path){store.remove(path);},
    async stat(path){return stat(path);},async lstat(path){return stat(path);},
    async readlink(){throw failure('Symbolic links are not supported','EINVAL');},
    async symlink(){throw failure('Symbolic links are not supported','ENOTSUP');},
    async chmod(){},
  }};
}
/** @param {string} path */
export function isGitPath(path){return path==='/.git'||path.startsWith('/.git/');}
/** @param {string} url */
export function gitHttpsUrl(url){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname==='/'||parsed.pathname.includes('%'))throw Error('Use an HTTPS repository URL without credentials, such as https://github.com/owner/repository.git');
  parsed.pathname=parsed.pathname.replace(/\/$/,'');
  if(!parsed.pathname.endsWith('.git'))parsed.pathname+='.git';
  return parsed.href;
}
/** Git repositories live entirely inside Virtual Files, including /.git.
 * Operations run on an isolated copy and publish only if the original store
 * has not changed. Cancellation or project replacement cannot publish stale data.
 * @param {{fs:VirtualFS,http?:HttpClient,syncWorkingFiles?:()=>void,beginRemote?:(request:{url:string,operation:string,branch:string,commit:string})=>Promise<{http:HttpClient,close:()=>Promise<void>}>}} options */
export function createVirtualGit({fs,http,beginRemote,syncWorkingFiles=()=>{}}) {
  let running=false;
  async function transaction(action,{signal,assertActive=()=>{}}={}){
    if(running)throw Error('A Git operation is already running');running=true;
    try{syncWorkingFiles();}catch(error){running=false;throw error;}
    const original=fs.checkpoint(),draft=createVirtualFileSystem();draft.restore(original.snapshot);
    const check=()=>{signal?.throwIfAborted();assertActive();const now=fs.checkpoint();if(JSON.stringify(now.revisions)!==JSON.stringify(original.revisions))throw Error('Files changed during Git operation; retry with the current project');};
    try{
      check();const result=await action(draft,createGitFileSystem(draft));syncWorkingFiles();check();
      // Do not turn unchanged text working files into binary editor previews.
      const prior=new Map(original.snapshot.files.map(f=>[f.path,f]));
      const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
      const entries=draft.list().map(file=>{
        if(isGitPath(file.path))return file;
        const old=prior.get(file.path);
        if((old?.type==='text'||!old&&/\.(?:js|mjs|json|md|txt|css|html|ts)$/i.test(file.path))&&file.type==='binary'){
          try{return {...file,data:decoder.decode(file.data)};}catch{}
        }
        return file;
      });
      fs.replace(entries,draft.listDirectories());return result;
    }finally{running=false;}
  }
  const initialized=store=>store.has('/.git/HEAD');
  const common=adapter=>({fs:adapter,dir:'/',gitdir:'/.git'});
  const selected=(path,paths)=>!paths?.length||paths.some(value=>{const absolute=resolvePath(value);return absolute==='/'||'/'+path===absolute||('/'+path).startsWith(absolute+'/');});
  async function status(store,adapter){
    if(!initialized(store))return {initialized:false,branch:null,files:[]};
    const rows=await git.statusMatrix({...common(adapter),filter:path=>!path.startsWith('sys/')});
    return {initialized:true,branch:await git.currentBranch(common(adapter)),files:rows.filter(([,h,w,s])=>h!==w||w!==s).map(([path,h,w,s])=>({path,staged:h!==s,untracked:h===0&&s===0,worktree:w!==s,head:h,work:w,stage:s}))};
  }
  function requireRepo(store){if(!initialized(store))throw Error('No Git repository. Run git init first.');}
  async function stagedBytes(adapter,paths){
    const result=new Map();
    await git.walk({...common(adapter),trees:[git.STAGE()],map:async(path,[entry])=>{
      if(paths.has(path)&&entry&&await entry.type()==='blob')result.set(path,new Uint8Array((await git.readBlob({...common(adapter),oid:await entry.oid()})).blob));
    }});return result;
  }
  const api={
    /** @param {string} action @param {any} [args] @param {{signal?:AbortSignal,assertActive?:()=>void}} [guards] */
    async execute(action,args={},guards={}){return transaction(async(store,adapter)=>{
      const base=common(adapter);
      if(action==='init'){await git.init({...base,defaultBranch:'main'});return status(store,adapter);}
      if(action==='status'){const result=await status(store,adapter);return {...result,files:result.files.filter(file=>selected(file.path,args.paths))};}
      requireRepo(store);
      if(action==='config'){
        if(!['user.name','user.email'].includes(args.path))throw Error('Supported settings: user.name, user.email');
        if(args.value!==undefined)await git.setConfig({...base,path:args.path,value:args.value});
        return {value:await git.getConfig({...base,path:args.path})};
      }
      if(action==='remote'){
        const remote=args.remote??'origin';if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote))throw Error('Invalid remote name');
        if(args.url)await git.addRemote({...base,remote,url:gitHttpsUrl(args.url),force:true});
        return git.listRemotes(base);
      }
      if(action==='branch'){
        if(args.name)await git.branch({...base,ref:args.name});
        const current=await git.currentBranch(base),local=await git.listBranches(base),remotes=[];
        for(const {remote} of await git.listRemotes(base))for(const name of await git.listBranches({...base,remote}))remotes.push(`${remote}/${name}`);
        return {current,local,remotes};
      }
      if(action==='stage'){
        const rows=await git.statusMatrix({...base,filter:path=>!path.startsWith('sys/')});
        const requested=(args.paths??[]).map(path=>resolvePath(path));
        if(!requested.length)throw Error('Usage: git add PATH...');
        if(requested.some(isGitPath))throw Error('/.git is repository metadata and cannot be staged');
        for(const path of requested)if(path!=='/'&&!rows.some(([p])=>'/'+p===path||('/'+p).startsWith(path+'/'))&&!store.has(path))throw Error(`Path not found: ${path}`);
        for(const [path,,work] of rows){if(!requested.some(p=>p==='/'||'/'+path===p||('/'+path).startsWith(p+'/')))continue;
          if(work===0)await git.remove({...base,filepath:path});else await git.add({...base,filepath:path});}
        return status(store,adapter);
      }
      if(action==='commit'){
        if(!args.message?.trim())throw Error('A commit message is required');
        const changed=await status(store,adapter);if(!changed.files.some(f=>f.staged))throw Error('No staged changes to commit');
        const name=args.name||await git.getConfig({...base,path:'user.name'}),email=args.email||await git.getConfig({...base,path:'user.email'});
        if(!name||!email)throw Error('Set the author with git config user.name "Name" and git config user.email "email@example.com"');
        if(args.name)await git.setConfig({...base,path:'user.name',value:name});if(args.email)await git.setConfig({...base,path:'user.email',value:email});
        return {commit:await git.commit({...base,message:args.message,author:{name,email}})};
      }
      if(action==='log'){
        let oid;try{oid=await git.resolveRef({...base,ref:'HEAD'});}catch(error){if(error.code!=='NotFoundError')throw error;return [];}
        return (await git.log({...base,ref:oid,depth:50})).map(entry=>({id:entry.oid,message:entry.commit.message,author:entry.commit.author.name,time:entry.commit.author.timestamp}));
      }
      if(action==='diff'){
        const state=await status(store,adapter),files=state.files.filter(f=>selected(f.path,args.paths)&&(args.staged?f.staged:f.worktree));
        const staged=await stagedBytes(adapter,new Set(files.map(f=>f.path)));let head;
        try{head=await git.resolveRef({...base,ref:'HEAD'});}catch(error){if(error.code!=='NotFoundError')throw error;}
        let text='',truncated=false;
        for(const file of files){
          let before=staged.get(file.path),after=store.get('/'+file.path)?.data;
          if(args.staged){after=staged.get(file.path);before=undefined;if(head&&file.head)before=(await git.readBlob({...base,oid:head,filepath:file.path})).blob;}
          const decode=value=>{if(value===undefined)return '';if(typeof value==='string')return value;if(value.includes(0))return null;try{return new TextDecoder('utf-8',{fatal:true}).decode(value);}catch{return null;}};
          const a=decode(before),b=decode(after);
          const patch=a===null||b===null?`Binary files a/${file.path} and b/${file.path} differ\n`:createTwoFilesPatch(before===undefined?'/dev/null':'a/'+file.path,after===undefined?'/dev/null':'b/'+file.path,a,b);
          if(text.length+patch.length>1024*1024){truncated=true;break;}text+=patch;
        }
        return {text,truncated};
      }
      if(['push','fetch','pull'].includes(action)){
        if(!http&&!beginRemote)throw Error('Remote Git operations are available in the Tauri app. Browser Git supports local operations.');
        const remote=args.remote??'origin';if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote))throw Error('Invalid remote name');
        const configured=await git.getConfig({...base,path:`remote.${remote}.url`});if(!configured)throw Error(`No such remote: ${remote}`);
        const url=gitHttpsUrl(configured);
        const branch=args.branch??await git.currentBranch(base);if(!branch)throw Error('Check out a branch first');
        if(action==='push'&&!(await git.listBranches(base)).includes(branch))throw Error(`No such local branch: ${branch}`);
        if(action==='pull'&&(await status(store,adapter)).files.length)throw Error('Commit local changes before pulling');
        let commit='';try{commit=await git.resolveRef({...base,ref:`refs/heads/${branch}`});}catch{}
        guards.signal?.throwIfAborted();guards.assertActive?.();
        const session=beginRemote?await beginRemote({url,operation:action,branch,commit}):{http,close:async()=>{}};
        try{
          const network={...base,http:session.http,url,remote,ref:branch,remoteRef:branch,onAuth:()=>({cancel:true}),signal:guards.signal};
          if(action==='push'){
            const result=await git.push(network);if(result.ok===false||result.error)throw Error(result.error||'Push rejected');
            if(args.setUpstream){await git.setConfig({...base,path:`branch.${branch}.remote`,value:remote});await git.setConfig({...base,path:`branch.${branch}.merge`,value:`refs/heads/${branch}`});}
            return {completed:true,operation:action,result};
          }
          const result=await git.fetch(network);
          if(action==='pull')await git.fastForward({...base,http:session.http,url,ref:branch,remote});
          return {completed:true,operation:action,result};
        }finally{await session.close();}
      }
      throw Error('Unsupported Git operation');
    },guards);},
  };
  return api;
}
/** @param {any} shell @param {ReturnType<typeof createVirtualGit>} repository */
export function registerGitShell(shell,repository){
  shell.register('git',async context=>{
    const [command,...args]=context.args;let action=command,options={};
    if(!command||command==='help')return 'git init | status [-s|--short] [PATH...] | diff [--cached] [PATH...] | add PATH... | commit -m MESSAGE | log | branch [-a|-r|NAME] | config user.name/user.email VALUE | remote [-v] | remote add|set-url NAME HTTPS_URL | remote get-url NAME | fetch | pull | push [-u] [REMOTE [BRANCH]]\n';
    if(command==='start'){if(args.length)throw Error('Usage: git start');action='init';}
    else if(command==='add'){action='stage';options={paths:args.map(context.resolve)};if(!args.length)throw Error('Usage: git add PATH...');}
    else if(command==='commit'){if(args.length!==2||args[0]!=='-m')throw Error('Usage: git commit -m MESSAGE');options={message:args[1]};}
    else if(command==='status'||command==='diff'){
      options={paths:[],staged:false,short:false};let literal=false;
      for(const arg of args){
        if(!literal&&arg==='--'){literal=true;continue;}
        if(!literal&&command==='diff'&&(arg==='--cached'||arg==='--staged')){options.staged=true;continue;}
        if(!literal&&command==='status'&&['-s','--short','--porcelain'].includes(arg)){options.short=true;continue;}
        if(!literal&&arg.startsWith('-'))throw Error(`Unsupported git ${command} option: ${arg}`);
        options.paths.push(context.resolve(arg));
      }
    }
    else if(command==='config'){if(args.length<1||args.length>2)throw Error('Usage: git config user.name|user.email [VALUE]');options={path:args[0],...(args.length===2?{value:args[1]}:{})};}
    else if(command==='branch'){
      if(!args.length)options={};
      else if(args.length===1&&['-a','--all'].includes(args[0]))options={all:true};
      else if(args.length===1&&['-r','--remotes'].includes(args[0]))options={remoteOnly:true};
      else if(args.length===1&&!args[0].startsWith('-'))options={name:args[0]};
      else throw Error('Usage: git branch [-a|--all|-r|--remotes|NAME]');
    }
    else if(command==='push'){
      options={setUpstream:false};const positional=[];let literal=false;
      for(const arg of args){if(!literal&&arg==='--'){literal=true;continue;}if(!literal&&['-u','--set-upstream'].includes(arg)){options.setUpstream=true;continue;}if(!literal&&arg.startsWith('-'))throw Error(`Unsupported git push option: ${arg}`);positional.push(arg);}
      if(positional.length>2)throw Error('Usage: git push [-u] [REMOTE [BRANCH]]');
      if(positional.length)options.remote=positional[0];if(positional.length===2)options.branch=positional[1];
    }
    else if(command==='remote'){
      if(!args.length||args.length===1&&['-v','--verbose'].includes(args[0]))options={verbose:args.length>0};
      else if(args.length===3&&['add','set-url'].includes(args[0]))options={remote:args[1],url:args[2]};
      else if(args.length===2&&args[0]==='get-url')options={getUrl:true,remote:args[1]};
      else throw Error('Usage: git remote [-v] | git remote add|set-url NAME HTTPS_URL | git remote get-url NAME');
    }
    else if(!['init','status','log','push','fetch','pull'].includes(command)||args.length)throw Error('Unsupported Git command. Type git help.');
    context.assertActive();const result=await repository.execute(action,options,{signal:context.signal,assertActive:context.assertActive});
    if(action==='status'||action==='stage'||action==='init'){
      if(!result.initialized)return formatGitStatus(result);
      if(options.short)return result.files.map(file=>{
        if(file.untracked)return `?? ${file.path}`;
        const staged=file.staged?(file.head===0?'A':file.stage===0?'D':'M'):' ';
        const working=file.worktree?(file.work===0?'D':'M'):' ';
        return `${staged}${working} ${file.path}`;
      }).join('\n')+(result.files.length?'\n':'');
      return formatGitStatus(result);
    }
    if(action==='remote'){
      if(options.getUrl){const remote=result.find(remote=>remote.remote===options.remote);if(!remote)throw Error(`No such remote: ${options.remote}`);return remote.url+'\n';}
      return result.map(remote=>options.verbose?`${remote.remote}\t${remote.url} (fetch)\n${remote.remote}\t${remote.url} (push)`:remote.remote).join('\n')+(result.length?'\n':'');
    }
    if(action==='branch'){
      if(options.name)return '';
      return [...(options.remoteOnly?[]:result.local.map(name=>`${name===result.current?'*':' '} ${name}`)),...(options.all||options.remoteOnly?result.remotes.map(name=>`  ${options.all?'remotes/':''}${name}`):[])].join('\n')+((options.remoteOnly?result.remotes.length:result.local.length||options.all&&result.remotes.length)?'\n':'');
    }
    if(action==='diff')return (result.text||(options.staged?'No staged changes.':'No unstaged changes. Use git diff --cached to review staged changes.'))+(result.truncated?'\n[Diff truncated]':'')+'\n';
    if(action==='config')return (result.value??'Not set')+'\n';
    if(action==='log')return result.length?result.map(c=>`${c.id.slice(0,10)} ${c.message.trim()}`).join('\n')+'\n':'No commits yet.\n';
    return JSON.stringify(result,null,2)+'\n';
  });
}
/** @param {any} result */
export function formatGitStatus(result){
  if(!result.initialized)return 'No Git repository. Run git init.\n';
  return `On branch ${result.branch??'(detached)'}\n`+(result.files.length?result.files.map(file=>`[${[file.untracked?'untracked':'',file.staged?'staged':'',file.worktree&&!file.untracked?'unstaged':''].filter(Boolean).join(', ')}] ${file.path}`).join('\n')+'\n':'Working tree clean.\n');
}
