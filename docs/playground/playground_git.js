import {createVirtualGit,registerGitShell,formatGitStatus} from '../js/tetorica_virtual_files/git.bundle.js';

/** Shared browser/desktop Git UI. Secrets and remote transport are provided by the host. */
export function installPlaygroundGit({fs,shell,lifecycle,beforeCommand=()=>{},afterCommand=()=>{},beginRemote,importFolder}){
  const repository=createVirtualGit({fs,beginRemote,syncWorkingFiles:beforeCommand});registerGitShell(shell,repository);
  const button=document.createElement('button');button.type='button';button.id='desktop-git';button.textContent='Git…';
  document.querySelector('#mainMenu > .toolbar-menu-panel')?.append(button);
  const dialog=document.createElement('dialog');dialog.id='desktop-git-dialog';dialog.setAttribute('aria-label','Project Git');
  dialog.innerHTML=`<h2>Project Git</h2><p>Git history is stored in this Cassette’s <code>/.git</code>. Export Cassette includes the history. New Cassette starts without it.</p>
    <div><button data-git="init">Initialize Git</button><button data-git="status">Changes</button><button data-git="diff">Diff</button><button data-git="cached">Staged diff</button><button data-git="log">History</button></div>
    <div id="gitChanges"></div>
    <label>Author <input id="gitAuthor" autocomplete="off"></label><label>Email <input id="gitEmail" type="email" autocomplete="off"></label>
    <label>Commit message <input id="gitMessage" autocomplete="off"></label><button data-git="commit">Stage selected and commit</button>
    <p>The commit also includes files already staged. Review Staged diff first.</p>
    <label>HTTPS repository URL <input id="gitRemote" placeholder="https://github.com/owner/repository.git" autocomplete="off"></label>
    <div><button data-git="remote">Set origin</button><button data-git="fetch">Fetch</button><button data-git="pull">Pull (fast-forward)</button><button data-git="push">Push…</button></div>
    <p id="gitNetworkHelp"></p><button id="gitImportFolder" hidden>Import existing repository folder…</button>
    <pre id="gitOutput" role="status"></pre><button id="gitCancel" hidden>Cancel operation</button><button id="gitClose">Close</button>`;
  const style=document.createElement('style');style.textContent=`#desktop-git-dialog{width:min(700px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:20px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--ink)}#desktop-git-dialog label{display:block;margin:8px 0}#desktop-git-dialog label input{width:100%;box-sizing:border-box}#desktop-git-dialog button{margin:3px}#desktop-git-dialog p{font-size:12px}#gitChanges{max-height:160px;overflow:auto}#gitOutput{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto}`;
  document.head.append(style);document.body.append(dialog);
  const field=id=>dialog.querySelector('#'+id),output=value=>field('gitOutput').textContent=String(value);
  field('gitNetworkHelp').textContent=beginRemote?'Remote operations use native HTTPS. The token is entered in a native window and is not saved in the Cassette.':'Browser Git supports local operations. Use the Tauri app for remote operations.';
  for(const action of ['push','fetch','pull'])dialog.querySelector(`[data-git="${action}"]`).hidden=!beginRemote;
  let busy=false,controller=null,generation=0;
  // Project replacement invalidates pending work, including native authentication.
  const invalidate=lifecycle?.invalidate?.bind(lifecycle);
  if(invalidate)lifecycle.invalidate=(...args)=>{generation++;controller?.abort();return invalidate(...args);};
  function showStatus(result){
    field('gitChanges').replaceChildren();
    for(const file of result.files??[]){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.value='/'+file.path;check.checked=true;check.style.width='auto';
      label.append(check,document.createTextNode(` ${file.staged?'[staged] ':''}${file.untracked?'[untracked] ':''}${file.worktree&&!file.untracked?'[unstaged] ':''}${file.path}`));field('gitChanges').append(label);}
    output(formatGitStatus(result));
  }
  async function run(action){
    if(busy)return;busy=true;controller=new AbortController();const started=generation;
    for(const element of dialog.querySelectorAll('button[data-git]'))element.disabled=true;field('gitCancel').hidden=false;output('Working…');
    const assertActive=()=>{controller.signal.throwIfAborted();if(started!==generation)throw Error('Project changed');};
    const execute=(action,args={})=>repository.execute(action,args,{signal:controller.signal,assertActive});
    try{
      beforeCommand();let result;
      if(action==='commit'){
        const paths=[...field('gitChanges').querySelectorAll('input:checked')].map(input=>input.value);
        if(!paths.length)throw Error('Choose files from Changes first');
        await execute('stage',{paths});result=await execute('commit',{message:field('gitMessage').value,name:field('gitAuthor').value,email:field('gitEmail').value});
      }else if(action==='cached')result=await execute('diff',{staged:true});
      else if(action==='remote')result=await execute('remote',{url:field('gitRemote').value});
      else result=await execute(action);
      assertActive();afterCommand();
      if(action==='status'||action==='init')showStatus(result);
      else if(action==='diff'||action==='cached')output(result.text||`No ${action==='cached'?'staged':'unstaged'} changes.`);
      else if(action==='log')output(result.length?result.map(c=>`${c.id.slice(0,10)} ${c.message.trim()}`).join('\n'):'No commits yet.');
      else if(action==='commit'){showStatus(await execute('status'));output(`Committed ${result.commit}`);}
      else output(JSON.stringify(result,null,2));
    }catch(error){output(error.message??String(error));}
    finally{busy=false;controller=null;field('gitCancel').hidden=true;for(const element of dialog.querySelectorAll('button[data-git]'))element.disabled=false;}
  }
  button.addEventListener('click',()=>{document.getElementById('mainMenu').open=false;dialog.showModal();void run('status');});
  dialog.addEventListener('click',event=>{const action=event.target.closest('button[data-git]')?.dataset.git;if(action)void run(action);});
  field('gitClose').addEventListener('click',()=>dialog.close());field('gitCancel').addEventListener('click',()=>controller?.abort());
  if(importFolder){field('gitImportFolder').hidden=false;field('gitImportFolder').addEventListener('click',async()=>{
    if(busy)return;
    if(!window.confirm('Replace current files and Git history with the selected folder? Export your current Cassette first if you want to keep it.'))return;
    try{await importFolder();output('Repository imported. Use Changes to review it.');}catch(error){output(error.message??String(error));}
  });}
  return repository;
}
