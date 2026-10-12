import {registerShellCheck} from './playground_shell_check.js';
import {createShell,parsePipeline,resolvePath} from '../js/tetorica_virtual_files/index.js';
import {createShellScriptRunner} from './playground_shell_runner.js';

/** The shell shares the editor's store; synchronize live edits before each command. */
export function installPlaygroundShell({fs, beforeCommand, afterCommand, output, form, input, prompt,stopButton,state,onPlay,panel,terminal,clearButton}) {
  const shell=createShell({fs,authorize(operation,paths){
    if(paths.some(path=>path==='/sys'||path.startsWith('/sys/')))throw Error('/sys is read-only');
    if(paths.some(path=>path==='/.git'||path.startsWith('/.git/')))throw Error('/.git is managed by Git commands');
    if((operation==='rm'||operation==='mv')&&paths.includes('/index.js'))throw Error('/index.js is the project entry point');
  }});
  registerShellCheck(shell);
  let queue=Promise.resolve(),epoch=0,active=null,streamed=0,structuredOutput=false;
  const history=[];let historyIndex=0,draft='';
  const setState=text=>{if(state){state.textContent=text;state.hidden=['Ready.','Finished.','Stopped.'].includes(text);}};
  const scroll=()=>{const viewport=terminal??output;viewport.scrollTop=viewport.scrollHeight;};
  function append(text){output.textContent+=text;if(output.textContent.length>50000)output.textContent=output.textContent.slice(-50000);scroll();}
  const clear=()=>{output.textContent='';scroll();};
  const stop=()=>{active?.abort();runner.stop();};
  const runner=createShellScriptRunner({fs,sync:beforeCommand,onChange:afterCommand,
    onOutput(text){if(structuredOutput)return;streamed++;append(text);}});
  shell.register('js',context=>runner.run(context));
  shell.register('result',context=>{
    const args=context.args.filter(arg=>arg!=='--json');
    if(args.length>1||args.length&&(!/^\d+$/.test(args[0])||!Number.isSafeInteger(Number(args[0]))||Number(args[0])<1))throw Error('Usage: result [--json] [RUN_ID]');
    return JSON.stringify(runner.result(args.length?Number(args[0]):undefined))+'\n';
  });
  if(onPlay)shell.register('play',async context=>{
    if(context.args.length!==1)throw Error('Usage: play PATH');
    context.assertActive();const path=context.resolve(context.args[0]);
    beforeCommand();await onPlay(path);context.assertActive();return `Played ${path}\n`;
  });
  fs.onDidChange(()=>{prompt.textContent=shell.cwd+' $';});
  function execute(source,options={}){
    const requestedEpoch=epoch;
    const command=queue.then(async()=>{
      if(options.signal?.aborted)return {code:130,stdout:'',stderr:'Command cancelled before execution'};
      if(requestedEpoch!==epoch)return {code:130,stdout:'',stderr:'Project changed; queued command cancelled'};
      const controller=new AbortController();active=controller;
      const abort=()=>controller.abort(options.signal?.reason);
      options.signal?.addEventListener('abort',abort,{once:true});
      if(stopButton){stopButton.disabled=false;stopButton.hidden=false;}
      const startOutput=streamed;append(`${shell.cwd} $ ${source}\n`);setState('Running…');
      try{
        let plan=[];try{plan=Array.isArray(source)?[{args:source}]:parsePipeline(source);}catch{}
        const tokens=plan[0]?.args??[];
        structuredOutput=plan.length>1||plan.some(stage=>stage.input||stage.output)||(tokens[0]==='js'||tokens[0]==='pipeline')&&tokens[1]==='--json';
        beforeCommand();options.beforeExecute?.();
        if(options.signal?.aborted)abort();
        const result=await shell.execute(source,{signal:controller.signal,stdin:options.stdin??''});
        if(requestedEpoch===epoch)afterCommand();
        if(streamed===startOutput)append(result.stdout+(result.stderr?result.stderr+'\n':''));
        prompt.textContent=shell.cwd+' $';setState(result.code===0?'Finished.':result.code===130?'Stopped.':`Exit ${result.code}`);
        return result;
      }finally{options.signal?.removeEventListener('abort',abort);structuredOutput=false;if(active===controller)active=null;if(stopButton){stopButton.disabled=true;stopButton.hidden=true;}}
    });
    queue=command.catch(()=>{});return command;
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();const source=input.value;input.value='';
    if(source.trim()){if(history.at(-1)!==source)history.push(source);if(history.length>100)history.shift();}
    historyIndex=history.length;draft='';
    input.focus();scroll();
    void execute(source).catch(error=>append(`Error: ${error.message}\n`));
  });
  input.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Tab'&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
      event.preventDefault();
      if(input.selectionStart!==input.selectionEnd||input.selectionEnd!==input.value.length)return;
      beforeCommand();
      const completed=completeShellPath(fs,shell.cwd,input.value);
      input.value=completed.source;input.setSelectionRange(input.value.length,input.value.length);
      if(completed.matches.length>1)append(`${prompt.textContent} ${input.value}\n${completed.matches.join('  ')}\n`);
      scroll();return;
    }
    if(!['ArrowUp','ArrowDown'].includes(event.key)||!history.length)return;
    event.preventDefault();if(historyIndex===history.length)draft=input.value;
    historyIndex=Math.max(0,Math.min(history.length,historyIndex+(event.key==='ArrowUp'?-1:1)));
    input.value=historyIndex===history.length?draft:history[historyIndex];
    input.setSelectionRange(input.value.length,input.value.length);
  });
  panel?.addEventListener('keydown',event=>{
    if(event.isComposing||!event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.key.toLowerCase()==='c'){
      // Preserve normal copy when the user has selected terminal output or input text.
      if(globalThis.getSelection?.()?.toString()||(event.target===input&&input.selectionStart!==input.selectionEnd))return;
      event.preventDefault();append(`${prompt.textContent} ${input.value}^C\n`);input.value='';stop();input.focus();
    }else if(event.key.toLowerCase()==='l'){event.preventDefault();clear();input.focus();}
  });
  terminal?.addEventListener('click',event=>{if(event.target===terminal&&!globalThis.getSelection?.()?.toString())input.focus();});
  document.getElementById('shellTab')?.addEventListener('click',()=>{input.focus();scroll();});
  clearButton?.addEventListener('click',()=>{clear();clearButton.closest('[popover]')?.hidePopover?.();input.focus();});
  stopButton?.addEventListener('click',stop);
  return {execute,shell,stop,invalidate(reason='Project changed'){shell.clearSnapshots();epoch++;active?.abort();runner.stop(reason);runner.clearResults();setState('Project changed.');}};
}

/** Complete the final path argument without evaluating command text, including unfinished quotes. */
export function completeShellPath(fs,cwd,source){
  let start=0,word='',quote='',escaped=false;
  for(let index=0;index<source.length;index++){
    const char=source[index];
    if(escaped){word+=char;escaped=false;continue;}
    if(char==='\\'&&quote!=="'"){escaped=true;continue;}
    if(quote){if(char===quote)quote='';else word+=char;continue;}
    if(char==='"'||char==="'"){quote=char;continue;}
    if(/\s/.test(char)){start=index+1;word='';continue;}
    if('|<>'.includes(char)){start=index+1;word='';continue;}
    word+=char;
  }
  const unchanged={source,matches:[]};
  try{
    const commandPrefix=source.slice(0,start);
    const args=/(?:>>|[<>])\s*$/.test(commandPrefix)?['redirect']:parsePipeline(commandPrefix).at(-1)?.args??[];
    if(!args.length||escaped)return unchanged;
    const slash=word.lastIndexOf('/'),prefix=word.slice(0,slash+1),name=word.slice(slash+1);
    const directory=resolvePath(prefix||'.',cwd);
    const matches=fs.readdir(directory).filter(item=>item.startsWith(name)).map(item=>{
      const path=prefix+item;
      return path+(fs.stat(resolvePath(path,cwd)).type==='directory'?'/':'');
    }).sort();
    if(!matches.length)return unchanged;
    let common=matches[0];for(const match of matches)while(!match.startsWith(common))common=common.slice(0,-1);
    if(common.length<=word.length&&matches.length>1)return {source,matches};
    const encoded=/[\s"'\\|;&<>]/.test(common)?'"'+common.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"':common;
    return {source:source.slice(0,start)+encoded+(matches.length===1&&!common.endsWith('/')?' ':''),matches};
  }catch{return unchanged;}
}
