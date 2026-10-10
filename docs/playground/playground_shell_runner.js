import {shellError,boundedShellReport} from './playground_shell_diagnostics.js';
import {createShellFileSession} from './playground_shell_session.js';
import {createShellModuleLoader} from './playground_shell_modules.js';

/** Workers keep arbitrary script loops away from the editor; this is not a security sandbox. */
export function createShellScriptRunner({fs,sync,onChange,onOutput=()=>{},isCurrent=()=>true,workerFactory=url=>new Worker(url,{type:'module'})}){
  const runs=new Set();
  let generation=0,sequence=0;
  const results=new Map();
  const workerUrl=new URL('./playground_shell_worker.js',import.meta.url);
  function run(context){
    const json=context.args[0]==='--json',args=json?context.args.slice(1):context.args;
    const id=++sequence,started=performance.now(),path=args.length?context.resolve(args[0]):null;
    let stdout='',stderr='',finished=false,finish;
    const logs=[],truncated={stdout:false,stderr:false,console:false,report:false};let logChars=0;
    function report(code,error=null){
      const value=boundedShellReport({id,path,code,status:code===130?'cancelled':code?'failed':'completed',durationMs:Math.max(0,Math.round(performance.now()-started)),stdout,stderr,console:logs,error,truncated});
      results.set(id,value);while(results.size>10)results.delete(results.keys().next().value);
      return {code,stdout:json?JSON.stringify(value)+'\n':stdout,stderr:json?'':stderr};
    }
    if(!args.length){stderr='Usage: js [--json] PATH [ARGS...]';return Promise.resolve(report(1,shellError(stderr)));}
    const startedGeneration=generation;
    const current=()=>startedGeneration===generation&&isCurrent();
    const session=createShellFileSession({fs,context,sync,onChange,isCurrent:current});
    const load=createShellModuleLoader(file=>session.facade.get(file));
    let worker;
    try{worker=workerFactory(workerUrl);}catch(error){stderr=String(error.message??error);return Promise.resolve(report(1,shellError(error,{path})));}
    const completed=new Promise(resolve=>finish=resolve);
    function output(text,error=false,level=error?'error':'log'){
      if(finished)return;
      const field=error?'stderr':'stdout',previous=error?stderr:stdout,remaining=Math.max(0,8000-previous.length);
      const accepted=text.slice(0,remaining);if(text.length>remaining)truncated[field]=true;
      if(error)stderr+=accepted;else stdout+=accepted;
      if(level!==null&&logs.length<100&&logChars<8000){const entry=text.slice(0,Math.min(1000,8000-logChars));logs.push({sequence:logs.length+1,level,text:entry});logChars+=entry.length;if(entry.length<text.length)truncated.console=true;}else if(level!==null)truncated.console=true;
      if(!json&&accepted)onOutput(accepted,error);
    }
    function close(code,error='',details=null){
      if(finished)return;
      if(error)output(error+'\n',true,null);
      finished=true;worker.terminate();context.signal?.removeEventListener('abort',abort);runs.delete(cancel);
      finish(report(code,details??(error?shellError(error,{path}):null)));
    }
    const abort=()=>close(130,'Shell script stopped');
    const cancel=reason=>close(130,reason??'Shell script stopped');runs.add(cancel);
    context.signal?.addEventListener('abort',abort,{once:true});
    worker.addEventListener('error',event=>{event.preventDefault();close(1,event.message??'Shell worker failed',shellError(event.error??event.message,{path,filename:event.filename,line:event.lineno,column:event.colno}));});
    worker.addEventListener('message',async event=>{
      const data=event.data;
      if(finished)return;
      try{
        session.guard();
        if(data.type==='output'){output(String(data.text),data.level==='error',['log','info','warn','error','debug'].includes(data.level)?data.level:'log');return;}
        if(data.type==='output-truncated'){if(data.field==='stdout'||data.field==='stderr')truncated[data.field]=true;truncated.console=true;return;}
        if(data.type==='done'){close(0);return;}
        if(data.type==='failed'){close(1,String(data.error),data.details??shellError(data.error,{path}));return;}
        if(data.type!=='rpc')return;
        let result;
        if(data.method==='module')result=load(...data.args);
        else if(data.method.startsWith('fs.'))result=session.invoke(data.method.slice(3),data.args);
        else if(data.method==='execute'){
          result={result:await context.execute(data.args[0],{fs:session.facade}),cwd:context.resolve('.')};
        }else throw Error('Unsupported shell request');
        if(!finished){session.guard();worker.postMessage({type:'reply',id:data.id,result});}
      }catch(error){
        if(finished)return;
        if(!current()||context.signal?.aborted){close(130,error.message);return;}
        if(data.type==='rpc')worker.postMessage({type:'reply',id:data.id,error:String(error.message??error)});
        else close(1,String(error.message??error));
      }
    });
    if(context.signal?.aborted)abort();
    else worker.postMessage({type:'start',path,args:args.slice(1),cwd:context.cwd});
    return completed;
  }
  return {run,result(id){const value=results.get(id??[...results.keys()].at(-1));if(!value)throw Error('Run result not found');return structuredClone(value);},clearResults(){results.clear();},stop(reason='Shell script stopped'){generation++;for(const cancel of [...runs])cancel(reason);}};
}
