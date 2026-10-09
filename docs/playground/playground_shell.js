import {createShell} from '../js/tetorica_virtual_files/index.js';
import {createShellScriptRunner} from './playground_shell_runner.js';

/** The shell shares the editor's store; synchronize live edits before each command. */
export function installPlaygroundShell({fs, beforeCommand, afterCommand, output, form, input, prompt,stopButton,state,onPlay}) {
  const shell=createShell({fs,authorize(operation,paths){
    if(paths.some(path=>path==='/sys'||path.startsWith('/sys/')))throw Error('/sys is read-only');
    if((operation==='rm'||operation==='mv')&&paths[0]==='/index.js')throw Error('/index.js is the project entry point');
  }});
  let queue=Promise.resolve(),epoch=0,active=null,streamed=0;
  const history=[];let historyIndex=0,draft='';
  const setState=text=>{if(state)state.textContent=text;};
  function append(text){output.textContent+=text;if(output.textContent.length>50000)output.textContent=output.textContent.slice(-50000);output.scrollTop=output.scrollHeight;}
  const runner=createShellScriptRunner({fs,sync:beforeCommand,onChange:afterCommand,
    onOutput(text){streamed++;append(text);}});
  shell.register('js',context=>runner.run(context));
  if(onPlay)shell.register('play',async context=>{
    if(context.args.length!==1)throw Error('Usage: play PATH');
    context.assertActive();const path=context.resolve(context.args[0]);
    beforeCommand();await onPlay(path);context.assertActive();return `Played ${path}\n`;
  });
  fs.onDidChange(()=>{prompt.textContent=shell.cwd+' $';});
  function execute(source){
    const requestedEpoch=epoch;
    const command=queue.then(async()=>{
      if(requestedEpoch!==epoch)return {code:130,stdout:'',stderr:'Project changed; queued command cancelled'};
      const controller=new AbortController();active=controller;
      if(stopButton)stopButton.disabled=false;
      const startOutput=streamed;append(`${shell.cwd} $ ${source}\n`);setState('Running…');
      try{
        beforeCommand();
        const result=await shell.execute(source,{signal:controller.signal});
        if(requestedEpoch===epoch)afterCommand();
        if(streamed===startOutput)append(result.stdout+(result.stderr?result.stderr+'\n':''));
        prompt.textContent=shell.cwd+' $';setState(result.code===0?'Finished.':result.code===130?'Stopped.':`Exit ${result.code}`);
        return result;
      }finally{if(active===controller)active=null;if(stopButton)stopButton.disabled=true;}
    });
    queue=command.catch(()=>{});return command;
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();const source=input.value;input.value='';
    if(source.trim()){if(history.at(-1)!==source)history.push(source);if(history.length>100)history.shift();}
    historyIndex=history.length;draft='';
    void execute(source).catch(error=>{output.textContent+=`Error: ${error.message}\n`;});
  });
  input.addEventListener('keydown',event=>{
    if(!['ArrowUp','ArrowDown'].includes(event.key)||!history.length)return;
    event.preventDefault();if(historyIndex===history.length)draft=input.value;
    historyIndex=Math.max(0,Math.min(history.length,historyIndex+(event.key==='ArrowUp'?-1:1)));
    input.value=historyIndex===history.length?draft:history[historyIndex];
    input.setSelectionRange(input.value.length,input.value.length);
  });
  const stop=()=>{active?.abort();runner.stop();};stopButton?.addEventListener('click',stop);
  return {execute,shell,stop,invalidate(reason='Project changed'){epoch++;active?.abort();runner.stop(reason);setState('Project changed.');}};
}
