import {createShellFileSession} from './playground_shell_session.js';
import {createShellModuleLoader} from './playground_shell_modules.js';

/** Workers keep arbitrary script loops away from the editor; this is not a security sandbox. */
export function createShellScriptRunner({fs,sync,onChange,onOutput=()=>{},isCurrent=()=>true,workerFactory=url=>new Worker(url,{type:'module'})}){
  const runs=new Set();
  let generation=0;
  const workerUrl=new URL('./playground_shell_worker.js',import.meta.url);
  function run(context){
    if(!context.args.length)return Promise.resolve({code:1,stdout:'',stderr:'Usage: js PATH [ARGS...]'});
    const path=context.resolve(context.args[0]);
    const startedGeneration=generation;
    const current=()=>startedGeneration===generation&&isCurrent();
    const session=createShellFileSession({fs,context,sync,onChange,isCurrent:current});
    const load=createShellModuleLoader(file=>session.facade.get(file));
    let worker;
    try{worker=workerFactory(workerUrl);}catch(error){return Promise.resolve({code:1,stdout:'',stderr:error.message});}
    let stdout='',stderr='',finished=false,finish;
    const completed=new Promise(resolve=>finish=resolve);
    function output(text,error=false){if(finished)return;if(error)stderr+=text;else stdout+=text;onOutput(text,error);}
    function close(code,error=''){
      if(finished)return;
      if(error)output(error+'\n',true);
      finished=true;worker.terminate();context.signal?.removeEventListener('abort',abort);runs.delete(cancel);
      finish({code,stdout,stderr});
    }
    const abort=()=>close(130,'Shell script stopped');
    const cancel=reason=>close(130,reason??'Shell script stopped');runs.add(cancel);
    context.signal?.addEventListener('abort',abort,{once:true});
    worker.addEventListener('error',event=>{event.preventDefault();close(1,event.message??'Shell worker failed');});
    worker.addEventListener('message',async event=>{
      const data=event.data;
      if(finished)return;
      try{
        session.guard();
        if(data.type==='output'){output(String(data.text),data.level==='error');return;}
        if(data.type==='done'){close(0);return;}
        if(data.type==='failed'){close(1,String(data.error));return;}
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
    else worker.postMessage({type:'start',path,args:context.args.slice(1),cwd:context.cwd});
    return completed;
  }
  return {run,stop(reason='Shell script stopped'){generation++;for(const cancel of [...runs])cancel(reason);}};
}
