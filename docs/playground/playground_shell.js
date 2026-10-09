import {createShell} from '../js/tetorica_virtual_files/index.js';

/** The shell shares the editor's store; synchronize live edits before each command. */
export function installPlaygroundShell({fs, beforeCommand, afterCommand, output, form, input, prompt}) {
  const shell=createShell({fs,authorize(operation,paths){
    if(paths.some(path=>path==='/sys'||path.startsWith('/sys/')))throw Error('/sys is read-only');
    if((operation==='rm'||operation==='mv')&&paths[0]==='/index.js')throw Error('/index.js is the project entry point');
  }});
  let queue=Promise.resolve();
  fs.onDidChange(()=>{prompt.textContent=shell.cwd+' $';});
  function execute(source){
    const command=queue.then(async()=>{
      beforeCommand();
      const result=await shell.execute(source);
      afterCommand();
      output.textContent+=`${shell.cwd} $ ${source}\n${result.stdout}${result.stderr ? result.stderr+'\n' : ''}`;
      if(output.textContent.length>50000)output.textContent=output.textContent.slice(-50000);
      output.scrollTop=output.scrollHeight;
      prompt.textContent=shell.cwd+' $';
      return result;
    });
    queue=command.catch(()=>{});return command;
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();const source=input.value;input.value='';
    void execute(source).catch(error=>{output.textContent+=`Error: ${error.message}\n`;});
  });
  return {execute,shell};
}
