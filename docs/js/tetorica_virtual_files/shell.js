import {parsePipeline} from './pipeline.js';
import {registerAgentCommands} from './agent_commands.js';
import {resolvePath} from './path.js';
import {createVirtualFileSystem,transferVirtualFiles} from './filesystem.js';
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
    if ('|;&<>'.includes(char)) throw Error('Use shell.execute() for pipelines and redirection; command chaining is not supported');
    word+=char;started=true;
  }
  if (quote || escaped) throw Error('Unterminated quote or escape');
  if (started) args.push(word);
  return args;
}
/** @typedef {{code:number,stdout:string,stderr:string,stages?:Array<{command:string[],code:number}>}} CommandResult */
/** @typedef {{signal?:AbortSignal,stdin?:string,reportStages?:boolean,fs?:ReturnType<typeof import('./filesystem.js').createVirtualFileSystem>}} ExecuteOptions */
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
    dispose() {unsubscribe();agentCommands.clearSnapshots();},
    clearSnapshots() {agentCommands.clearSnapshots();},
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
  async function dispatch(source, {signal,stdin = '',reportStages=false,fs:commandFs = fs,baseCwd=cwd} = {}, isActive) {
    try {
      if(!isActive())throw Error('Command session has ended');
      signal?.throwIfAborted();
      if(typeof stdin!=='string')throw TypeError('stdin must be a string');
      if(Array.isArray(source)&&source.some(arg=>typeof arg!=='string'))throw TypeError('Command arguments must be strings');
      if(Array.isArray(source)&&reportStages)return await runPipeline(source.length?[{args:source,input:null,output:null}]:[],{signal,stdin,fs:commandFs,baseCwd},isActive);
      if(!Array.isArray(source)){
        const plan=parsePipeline(source);
        if(plan.length>1||plan.some(s=>s.input!==null||s.output!==null)||reportStages)return await runPipeline(plan,{signal,stdin,fs:commandFs,baseCwd},isActive);
        source=plan[0]?.args??[];
      }
      const [name,...args]=Array.isArray(source)?source:parseCommand(source);
      if(!name)return {code:0,stdout:'',stderr:''};
      const command=commands.get(name);
      if(!command)return {code:127,stdout:'',stderr:`Unknown command: ${name}`};
      const context={fs:commandFs,args,cwd:baseCwd,resolve:path=>resolvePath(path,baseCwd),signal,stdin,
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
  async function runPipeline(plan,{signal,stdin,fs:commandFs,baseCwd},isActive){
    const stages=[],writes=[];let stderr='',stdout='';
    const active=()=>{if(!isActive())throw Error('Command session has ended');signal?.throwIfAborted();};
    const same=(a,b)=>a===null?b===null:b!==null&&a.type===b.type&&(a.type==='text'?a.data===b.data:a.data.length===b.data.length&&a.data.every((v,i)=>v===b.data[i]));
    try{
      const targets=new Map();
      for(const stage of plan)if(stage.output){const path=resolvePath(stage.output.path,baseCwd),before=commandFs.get(path);if(before&&before.type!=='text')throw Error(`Redirect requires text: ${path}`);if(!before&&commandFs.listDirectories().includes(path))throw Error(`Redirect target is a directory: ${path}`);targets.set(path,{file:before,revision:commandFs.getRevision(path)});}
      if(plan[0]?.input!==null&&plan.length){const path=resolvePath(plan[0].input,baseCwd),file=commandFs.get(path);if(!file||file.type!=='text')throw Error(`Input requires an existing text file: ${path}`);stdin=file.data;}
      if(stdin.length>1000000)throw Error('Pipeline input exceeds 1,000,000 characters');
      for(const stage of plan){
        active();const result=await dispatch(stage.args,{signal,stdin,fs:commandFs,baseCwd},isActive);
        stages.push({command:stage.args,code:result.code});stderr+=result.stderr;stdout=result.stdout;
        if(result.code!==0)return {code:result.code,stdout,stderr,stages};
        if(stdout.length>1000000)throw Error('Pipeline output exceeds 1,000,000 characters');
        if(stage.output){writes.push({path:resolvePath(stage.output.path,baseCwd),append:stage.output.append,text:stdout});stdout='';}
        stdin=stdout;
      }
      active();
      if(writes.length){
        const paths=[...targets.keys()];write('redirect',paths);active();
        for(const [path,before] of targets)if((before.revision!==commandFs.getRevision(path)||!same(before.file,commandFs.get(path))))throw Error(`Redirect conflict: file changed during execution: ${path}`);
        const draft=createVirtualFileSystem();draft.restore(commandFs.snapshot());
        for(const output of writes){const old=draft.get(output.path);if(old&&old.type!=='text')throw Error(`Redirect requires text: ${output.path}`);draft.writeText(output.path,(output.append?(old?.data??''):'')+output.text);}
        active();commandFs.replace(draft.list(),draft.listDirectories(),{checkpointChanges:true});
      }
      return {code:0,stdout,stderr,stages};
    }catch(error){return {code:signal?.aborted?130:1,stdout:'',stderr:stderr+String(error?.message??error),stages};}
  }
  shell.register('pipeline',async context=>{
    if(context.args.length!==2||context.args[0]!=='--json')throw Error('Usage: pipeline --json SOURCE');
    const result=await context.execute(context.args[1],{reportStages:true});
    return {code:result.code,stdout:JSON.stringify(result)+'\n',stderr:''};
  });
  shell.register('pwd',context=>context.cwd+'\n');
  const usages={pipeline:'pipeline --json SOURCE',pwd:'pwd',ls:'ls [PATH]',cd:'cd [PATH]',cat:'cat PATH|-',echo:'echo [TEXT...]',mkdir:'mkdir [-p] PATH',touch:'touch PATH',write:'write PATH TEXT',rm:'rm [-r] PATH',cp:'cp SOURCE DESTINATION',mv:'mv SOURCE DESTINATION',
    find:'find [PATH] [-name GLOB] [-type f|d] [--json] [--offset N] [--limit N]',
    rg:'rg [-n] [-F] [-i] [-l] [--json] [--offset N] [--limit N] LITERAL [PATH]',
    read:'read [--start N] [--end N] [--max-chars N] [--json] PATH',
    js:'js [--json] PATH [ARGS...]',result:'result [--json] [RUN_ID]',check:'check [--json] [PATH]',patch:'patch [--json] [--dry-run] PATCH_FILE|-',undo:'undo [--json] [--dry-run] BEFORE AFTER [PATH]',snapshot:'snapshot [NAME] | snapshot --list | snapshot --remove NAME',diff:'diff [--json] [--offset N] [--limit N] [NAME] [PATH]',
    edit:'edit [--revision N] [--expect N] [--dry-run] [--json] PATH OLD_TEXT NEW_TEXT',help:'help [COMMAND|--json]'};
  shell.register('help',({args})=>{
    if(args.length>1)throw Error('Usage: help [COMMAND|--json]');
    if(args[0]==='--json')return JSON.stringify([...commands.keys()].sort().map(name=>({name,usage:usages[name]??name})))+'\n';
    if(args.length){if(!commands.has(args[0]))throw Error(`Unknown command: ${args[0]}`);return (usages[args[0]]??args[0])+'\n';}
    return [...commands.keys()].sort().join(' ')+'\n';
  });
  shell.register('cd',({fs,args,resolve})=>{if(args.length>1)throw Error('Expected one directory');const path=resolve(args[0]??'/');if(fs.stat(path).type!=='directory')throw Error('Not a directory');cwd=path;});
  shell.register('ls',({fs,args,resolve})=>{if(args.length>1)throw Error('Expected one path');const path=resolve(args[0]??'.');return fs.stat(path).type==='file' ? path+'\n' : fs.readdir(path).map(name=>name+(fs.stat(resolvePath(name,path)).type==='directory'?'/':'')).join('\n')+'\n';});
  shell.register('cat',async({fs,args,resolve,stdin})=>{count(args,1);return args[0]==='-'?stdin:fs.createFileReader('/')(resolve(args[0]),{type:'text'});});
  shell.register('echo',({args})=>args.join(' ')+'\n');
  shell.register('mkdir',({fs,args,resolve})=>{const recursive=args[0]==='-p';if(recursive)args=args.slice(1);count(args,1);const path=resolve(args[0]);write('mkdir',[path]);fs.mkdir(path,{recursive});});
  shell.register('touch',({fs,args,resolve})=>{count(args,1);const path=resolve(args[0]);write('touch',[path]);if(!fs.has(path))fs.writeText(path,'');else if(fs.stat(path).type!=='file')throw Error('Not a file');});
  shell.register('write',({fs,args,resolve})=>{count(args,2);const path=resolve(args[0]);write('write',[path]);fs.writeText(path,args[1]);});
  shell.register('rm',({fs,args,resolve})=>{const recursive=args[0]==='-r';if(recursive)args=args.slice(1);count(args,1);const path=resolve(args[0]);write('rm',[path]);fs.remove(path,{recursive});});
  for (const name of ['cp','mv']) shell.register(name,({fs,args,resolve})=>{count(args,2);const paths=args.map(resolve);write(name,paths);transferVirtualFiles(fs,paths[0],paths[1],{copy:name==='cp'});});
  const agentCommands=registerAgentCommands((name,command)=>shell.register(name,command),write);
  return shell;
}
