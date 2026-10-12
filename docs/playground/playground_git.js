import {createVirtualGit,registerGitShell} from '../js/tetorica_virtual_files/git.bundle.js';

/** Git commands share Virtual Files. The menu holds app-wide native credentials only. */
export function installPlaygroundGit({fs,shell,beforeCommand=()=>{},beginRemote,tokens}){
  const repository=createVirtualGit({fs,beginRemote,syncWorkingFiles:beforeCommand});registerGitShell(shell,repository);
  const button=document.createElement('button');button.type='button';button.id='desktop-git';button.textContent='Git 設定…';
  document.querySelector('#mainMenu > .toolbar-menu-panel')?.append(button);
  const dialog=document.createElement('dialog');dialog.id='desktop-git-dialog';dialog.setAttribute('aria-label','Git settings');
  dialog.innerHTML=`<h2>Git 設定</h2><p>Git の操作は Shell の <code>git</code> コマンドで行います。</p>
    <section id="gitTokens" hidden>
      <p>登録したトークンはアプリ共通です。使用するトークンは push などの通信時に選びます。</p>
      <label>登録名 <input id="gitTokenName" autocomplete="off" placeholder="例：GitHub用"></label>
      <label>接続先ホスト <input id="gitTokenHost" autocomplete="off" value="https://github.com"></label>
      <button data-token="add">トークンを登録…</button>
      <p>登録ボタンを押すと、別の入力画面が出ます。そこへ GitHub で発行した PAT を貼り付けてください。</p>
      <hr><label>保存済みトークン <select id="gitTokenSelect"></select></label>
      <button data-token="delete">選んだトークンを削除…</button>
      <p id="gitTokenBinding" role="status"></p>
      <small id="gitTokenStorage"></small>
    </section>
    <p id="gitNetworkHelp"></p><pre id="gitOutput" role="status"></pre><button id="gitClose">閉じる</button>`;
  const style=document.createElement('style');style.textContent=`#desktop-git-dialog{width:min(540px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:20px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--ink)}#desktop-git-dialog h2{margin:0 0 8px}#desktop-git-dialog label{display:block;margin:8px 0}#desktop-git-dialog label input,#desktop-git-dialog select{display:block;width:100%;box-sizing:border-box;padding:5px;margin-top:3px}#desktop-git-dialog button{margin:3px}#desktop-git-dialog p,#desktop-git-dialog small{font-size:12px}#gitOutput{white-space:pre-wrap;overflow-wrap:anywhere;max-height:90px;overflow:auto}`;
  document.head.append(style);document.body.append(dialog);
  const field=id=>dialog.querySelector('#'+id),output=value=>field('gitOutput').textContent=String(value);
  field('gitNetworkHelp').textContent=tokens?'':'ブラウザ版はローカルの Git 操作のみ対応しています。リモートとの通信には Tauri 版を使ってください。';
  let tokenBusy=false,tokenSupported=false;
  async function refreshTokens(preferredId){
    if(!tokens)return;
    const result=await tokens.list(),select=field('gitTokenSelect');tokenSupported=result.supported;
    select.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='トークンを選択';select.append(placeholder);
    for(const entry of result.tokens){const option=document.createElement('option');option.value=entry.id;option.textContent=`${entry.name} (${entry.host})`;select.append(option);}
    select.value=preferredId??result.selectedId??'';
    field('gitTokenStorage').textContent=`トークン本文は ${result.storage??'OS の資格情報ストア'} に保存し、Cassette には含めません。`;
    field('gitTokenBinding').textContent=!result.supported?'この OS では保存済みトークンに対応していません。':'push などの確認画面でトークンを選べます。前回の選択を初期値にします。';
    for(const button of field('gitTokens').querySelectorAll('button'))button.disabled=!result.supported;
  }
  if(tokens){
    field('gitTokens').hidden=false;
    field('gitTokens').addEventListener('click',async event=>{
      const action=event.target.closest('button[data-token]')?.dataset.token;if(!action||tokenBusy)return;
      tokenBusy=true;for(const button of field('gitTokens').querySelectorAll('button'))button.disabled=true;
      try{
        const id=field('gitTokenSelect').value;let preferred;
        if(action==='add'){const result=await tokens.add({name:field('gitTokenName').value,host:field('gitTokenHost').value});preferred=result.entry.id;field('gitTokenName').value='';output('トークンを登録しました。');}
        else {
          if(!id)throw Error('保存済みトークンを選んでください。');
          if(action==='delete'){await tokens.remove(id);output('保存済みトークンを削除しました。');}
        }
        await refreshTokens(preferred);
      }catch(error){output(error.message??String(error));}
      finally{tokenBusy=false;for(const button of field('gitTokens').querySelectorAll('button'))button.disabled=!tokenSupported;}
    });
  }
  button.addEventListener('click',async()=>{document.getElementById('mainMenu').open=false;dialog.showModal();try{await refreshTokens();}catch(error){output(error.message??String(error));}});
  field('gitClose').addEventListener('click',()=>dialog.close());
  return repository;
}
