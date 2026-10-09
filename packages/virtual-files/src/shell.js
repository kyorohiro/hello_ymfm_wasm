import {resolvePath} from './path.js';
import {transferVirtualFiles} from './filesystem.js';
/** Quotes and escapes only. No JavaScript evaluation or host shell invocation.
 * @param {string} source @returns {string[]} */
export function parseCommand(source) {
  const args=[];let word='',quote='',escaped=false,started=false;
  for (const char of source) {
    if (escaped) {word+=char;escaped=false;started=true;continue;}
    if (char === '\\' && quote !== "'") {escaped=true;started=true;continue;}
    if (quote) {if (char === quote) quote='';else word+=char;continue;}
    if (char === '"' || char === "'") {quote=char;started=true;continue;}
    if (/\s/.test(char)) {if (started) args.push(word);word='';started=false;continue;}
    if ('|;&<>'.includes(char)) throw Error('Pipes, redirection and command chaining are not supported yet');
    word+=char;started=true;
  }
  if (quote || escaped) throw Error('Unterminated quote or escape');
  if (started) args.push(word);
  return args;
}
/** @typedef {{code:number,stdout:string,stderr:string}} CommandResult */
/** @typedef {{signal?:AbortSignal,stdin?:string,fs?:ReturnType<typeof import('./filesystem.js').createVirtualFileSystem>}} ExecuteOptions */
/** @typedef {{execute:(source:string|string[],options?:ExecuteOptions)=>Promise<CommandResult>,assertActive:()=>void,fs:ReturnType<typeof import('./filesystem.js').createVirtualFileSystem>,args:string[],cwd:string,resolve:(path:string)=>string,signal?:AbortSignal,stdin:string}} CommandContext */
/** @typedef {(context:CommandContext)=>string|void|CommandResult|Promise<string|void|CommandResult>} Command */
/** @param {{fs:ReturnType<typeof import('./filesystem.js').createVirtualFileSystem>,cwd?:string,authorize?:(operation:string,paths:string[])=>void}} options */
export function createShell({fs,cwd = '/',authorize = () => {}}) {
  cwd=resolvePath(cwd);if (fs.stat(cwd).type !== 'directory') throw Error('Invalid working directory');
  /** @type {Map<string,Command>} */
  const commands=new Map();let queue=Promise.resolve();
  const unsubscribe=fs.onDidChange(()=>{try{if(fs.stat(cwd).type!=='directory')cwd='/';}catch{cwd='/';}});
  const count=(args,n)=>{if (args.length !== n) throw Error(`Expected ${n} argument(s)`);};
  const write=(operation,paths)=>authorize(operation,paths);
  const shell={
    get cwd() {return cwd;},
    dispose() {unsubscribe();},
    /** @param {string} name @param {Command} command */
    register(name,command) {if (!/^[\w-]+$/.test(name) || typeof command !== 'function') throw Error('Invalid command registration');commands.set(name,command);},
    /** Commands in one shell execute in order. Context.execute dispatches nested commands directly.
     * @param {string|string[]} source @param {ExecuteOptions} [options] @returns {Promise<CommandResult>} */
    execute(source,options = {}) {
      const request=Array.isArray(source)?source.slice():source;
      const run=queue.then(async()=>{
        let active=true;
        try{return await dispatch(request,options,()=>active);}
        finally{active=false;}
      });
      queue=run.then(()=>{});return run;
    },
  };
  async function dispatch(source, {signal,stdin = '',fs:commandFs = fs} = {}, isActive) {
    try {
      if(!isActive())throw Error('Command session has ended');
      signal?.throwIfAborted();
      if(Array.isArray(source)&&source.some(arg=>typeof arg!=='string'))throw TypeError('Command arguments must be strings');
      const [name,...args]=Array.isArray(source)?source:parseCommand(source);
      if(!name)return {code:0,stdout:'',stderr:''};
      const command=commands.get(name);
      if(!command)return {code:127,stdout:'',stderr:`Unknown command: ${name}`};
      const context={fs:commandFs,args,cwd,resolve:path=>resolvePath(path,cwd),signal,stdin,
        assertActive(){if(!isActive())throw Error('Command session has ended');signal?.throwIfAborted();},
        execute:(request,options = {})=>dispatch(request,{signal,stdin,fs:commandFs,...options},isActive)};
      const task=Promise.resolve().then(()=>{context.assertActive();return command(context);});
      let abort;
      const result=signal ? await Promise.race([task,new Promise((_,reject)=>{
        abort=()=>reject(signal.reason??new Error('Command aborted'));
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      })]).finally(()=>signal.removeEventListener('abort',abort)) : await task;
      context.assertActive();
      return typeof result==='object'&&result ? result : {code:0,stdout:result??'',stderr:''};
    }catch(error){return {code:signal?.aborted?130:1,stdout:'',stderr:String(error?.message??error)};}
  }
  shell.register('pwd',()=>cwd+'\n');
  shell.register('help',()=>[...commands.keys()].sort().join(' ')+'\n');
  shell.register('cd',({fs,args,resolve})=>{if(args.length>1)throw Error('Expected one directory');const path=resolve(args[0]??'/');if(fs.stat(path).type!=='directory')throw Error('Not a directory');cwd=path;});
  shell.register('ls',({fs,args,resolve})=>{if(args.length>1)throw Error('Expected one path');const path=resolve(args[0]??'.');return fs.stat(path).type==='file' ? path+'\n' : fs.readdir(path).map(name=>name+(fs.stat(resolvePath(name,path)).type==='directory'?'/':'')).join('\n')+'\n';});
  shell.register('cat',async({fs,args,resolve})=>{count(args,1);return fs.createFileReader('/')(resolve(args[0]),{type:'text'});});
  shell.register('echo',({args})=>args.join(' ')+'\n');
  shell.register('mkdir',({fs,args,resolve})=>{const recursive=args[0]==='-p';if(recursive)args=args.slice(1);count(args,1);const path=resolve(args[0]);write('mkdir',[path]);fs.mkdir(path,{recursive});});
  shell.register('touch',({fs,args,resolve})=>{count(args,1);const path=resolve(args[0]);write('touch',[path]);if(!fs.has(path))fs.writeText(path,'');else if(fs.stat(path).type!=='file')throw Error('Not a file');});
  shell.register('write',({fs,args,resolve})=>{count(args,2);const path=resolve(args[0]);write('write',[path]);fs.writeText(path,args[1]);});
  shell.register('rm',({fs,args,resolve})=>{const recursive=args[0]==='-r';if(recursive)args=args.slice(1);count(args,1);const path=resolve(args[0]);write('rm',[path]);fs.remove(path,{recursive});});
  for (const name of ['cp','mv']) shell.register(name,({fs,args,resolve})=>{count(args,2);const paths=args.map(resolve);write(name,paths);transferVirtualFiles(fs,paths[0],paths[1],{copy:name==='cp'});});
  return shell;
}
