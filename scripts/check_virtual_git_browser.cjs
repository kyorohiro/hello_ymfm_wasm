const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const local=path.resolve(__dirname,'..'),root=process.env.GIT_SOURCE_ROOT||local,desktop=process.env.GIT_TEST_DESKTOP==='1'||process.argv.includes('--desktop');
(async()=>{const browser=await (process.argv.includes('--webkit')?webkit:chromium).launch({headless:true});try{
  const page=await browser.newPage({acceptDownloads:true}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept(dialog.type()==='prompt'?'git-round-trip':undefined));
  if(desktop){
    await page.addInitScript(()=>{
      window.__gitRequests=[];let saved=[{id:'native-personal-token',name:'Personal',host:'https://github.com'},{id:'native-work-token',name:'Work',host:'https://github.com'}];let selectedId=null;
      const pkt=text=>(new TextEncoder().encode(text).length+4).toString(16).padStart(4,'0')+text;
      window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
        window.__gitRequests.push({command,args});
        if(command==='git_tokens'){
          const r=args.request;
          if(r.action==='list')return{tokens:saved,selectedId,supported:true};
          if(r.action==='add'){const entry={id:'native-spare-token',name:r.name,host:r.host};saved.push(entry);selectedId=entry.id;return{saved:true,entry};}
          if(r.action==='select'){if(!saved.some(e=>e.id===r.id))throw 'Unknown token';selectedId=r.id;return{selectedId};}
          if(r.action==='replace')return{updated:true};
          if(r.action==='delete'){saved=saved.filter(e=>e.id!==r.id);if(selectedId===r.id)selectedId=null;return{deleted:true};}
        }
        if(command==='git_https_begin'){selectedId='native-work-token';if(!selectedId)throw 'No app token selected';if(saved.find(e=>e.id===selectedId).host!==new URL(args.request.url).origin)throw 'Wrong token host';window.__gitChosen=selectedId;return 'native-session';}
        if(command==='git_https_request'){
          const {url,method}=args.request;
          if(window.__gitRejectNext){window.__gitRejectNext=false;throw 'Git host rejected authentication. Check token permissions and the repository URL';}
          const body=method==='GET'?pkt('# service=git-receive-pack\n')+'0000'+pkt('0000000000000000000000000000000000000000 capabilities^{}\0report-status side-band-64k\n')+'0000':pkt('\x01'+pkt('unpack ok\n')+pkt('ok refs/heads/main\n')+'0000')+'0000';
          return{url,statusCode:200,statusMessage:'OK',headers:{'content-type':method==='GET'?'application/x-git-receive-pack-advertisement':'application/x-git-receive-pack-result'},body:btoa(body)};
        }
      }};
    });
    await page.route('**/desktop-git-runtime.js',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'w/tetorica-fm2612-playground-tauri/desktop/git-runtime.bundle.js'),'utf8')}));
    await page.route('**/playground.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\n;\n'+fs.readFileSync(path.join(root,'w/tetorica-fm2612-playground-tauri/desktop/git-interface.js'),'utf8')});});
  }
  await page.goto(process.env.GIT_TEST_URL||process.argv.find(arg=>arg.startsWith('--url='))?.slice(6)||'http://127.0.0.1:8087/playground/index.html');
  await page.waitForFunction(()=>window.monaco?.editor?.getEditors().some(e=>e.getModel()?.uri.path==='/project/index.js')&&document.getElementById('desktop-git'));
  await page.evaluate(()=>monaco.editor.getEditors().find(e=>e.getModel()?.uri.path==='/project/index.js').setValue('// first revision\n'));
  await page.locator('#shellTab').click();
  const run=async(command,expected)=>{
    await page.locator('#shellOutput').evaluate(element=>element.textContent='');const before='';await page.locator('#shellInput').fill(command);await page.locator('#shellInput').press('Enter');
    await page.waitForFunction(({before,expected})=>{const text=document.querySelector('#shellOutput').textContent;return text!==before&&text.includes(expected)&&document.querySelector('#shellStopButton').disabled;},{before,expected}).catch(async error=>{throw Error(command+' failed: '+(await page.locator('#shellOutput').textContent()).slice(-3000)+'; '+errors.join('; '));});
  };
  await run('git init','On branch main');await run('git config user.name Test','Test');await run('git config user.email test@example.com','test@example.com');
  await run('git diff','first revision');await run('git add index.js','[staged] index.js');await run('git diff --cached','first revision');await run('git commit -m first','\"commit\":');await run('git branch -a','* main');
  await page.evaluate(()=>monaco.editor.getEditors().find(e=>e.getModel()?.uri.path==='/project/index.js').setValue('// browser edit\n'));
  await run('git status .','[unstaged] index.js');await run('git diff','browser edit');
  if(desktop){
    await run('git remote add origin https://github.com/owner/repository.git','origin');await run('git remote -v','repository.git (push)');await page.locator('#mainMenu').evaluate(e=>e.open=true);await page.locator('#desktop-git').click();
    await page.waitForFunction(()=>document.querySelectorAll('#gitTokenSelect option').length===3);
    assert.equal(await page.locator('[data-git]').count(),0);assert.equal(await page.locator('#gitRemote').count(),0);const saveBounds=await page.locator('[data-token=add]').boundingBox();assert(saveBounds.y+saveBounds.height<=page.viewportSize().height);
    await page.locator('#gitTokenName').fill('Spare');await page.locator('[data-token=add]').click();await page.waitForFunction(()=>document.querySelectorAll('#gitTokenSelect option').length===4);
    await page.locator('#gitTokenSelect').selectOption('native-spare-token');await page.locator('[data-token=delete]').click();await page.waitForFunction(()=>document.querySelectorAll('#gitTokenSelect option').length===3);
    assert.equal(await page.locator('[data-token=select],[data-token=replace]').count(),0);
    assert.equal(await page.locator('#desktop-git-dialog input[type=password]').count(),0);await page.locator('#gitClose').click();
    await page.evaluate(()=>window.__gitRejectNext=true);await run('git push origin main','Git host rejected authentication. Check token permissions');await run('git push origin main','"completed": true');
    const requests=await page.evaluate(()=>window.__gitRequests);assert(requests.some(r=>r.command==='git_https_request'&&r.args.request.method==='POST'));
    assert.equal(await page.evaluate(()=>window.__gitChosen),'native-work-token');assert(!requests.some(r=>r.command==='git_request'));assert(requests.every(r=>!JSON.stringify(r).match(/password|authorization|personal_access_token/i)));
  }else await run('git push origin main','Browser Git supports local operations');
  await page.locator('#mainMenu').evaluate(e=>e.open=true);await page.locator('#exportCassetteButton').click();
  const downloadPromise=page.waitForEvent('download');await page.locator('#confirmCassetteExportButton').click();const download=await downloadPromise;
  const archive=await download.path();const {loadPlaygroundCassette}=await import(path.join(root,'docs/playground/playground_cassette.js'));const cassette=await loadPlaygroundCassette(fs.readFileSync(archive));assert(cassette.files.has('.git/HEAD'));assert(cassette.files.has('.git/index'));assert(cassette.files.has('.git/refs/heads/main'));for(const bytes of cassette.files.values())assert(!Buffer.from(bytes).includes(Buffer.from('native-work-token')));
  await page.locator('#mainMenu').evaluate(e=>e.open=true);await page.locator('#newCassetteButton').click();await page.locator('#newCassetteDialog button[value=new]').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('New cassette'));
  await run('git status','No Git repository');if(desktop){await page.locator('#mainMenu').evaluate(e=>e.open=true);await page.locator('#desktop-git').click();await page.waitForFunction(()=>document.querySelector('#gitTokenBinding').textContent.includes('確認画面でトークンを選べます'));await page.locator('#gitClose').click();}
  await page.locator('input[type=file][accept=".zip,application/zip"]').setInputFiles({name:'git-round-trip.cassette.zip',mimeType:'application/zip',buffer:fs.readFileSync(archive)});
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Loaded cassette'));
  await run('git log','first');await run('git diff','browser edit');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,desktop,localGit:true,cassetteHistoryRoundTrip:true,newCassetteClearsGit:true,nativeHttps:desktop}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exit(1);});
