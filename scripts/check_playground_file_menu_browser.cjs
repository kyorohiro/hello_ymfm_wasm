// Serve docs on port 8093, or set FILE_MENU_TEST_URL.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
    await page.route('**/playground.js?*',async route=>{
      const response=await route.fetch();
      await route.fulfill({response,body:await response.text()+'\nwindow.__fileMenuAudit={fs:virtualFiles,get editor(){return editorAdapter;},refresh:refreshExplorerFiles};'});
    });
    await page.goto(process.env.FILE_MENU_TEST_URL||'http://localhost:8093/playground/index.html');
    await page.waitForFunction(()=>window.__fileMenuAudit&&window.monaco?.editor?.getEditors().some(editor=>editor.getModel()?.uri.path.startsWith('/project/')));
    const menu=page.locator('.file-context-menu');
    async function open(path){
      const target=page.locator(`#fileExplorerList [data-file-path="${path}"]`);
      await target.evaluate(element=>{for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});
      await target.click({button:'right'});await menu.waitFor({state:'visible'});
    }
    async function action(label){await menu.getByRole('menuitem',{name:label,exact:true}).click();await menu.waitFor({state:'hidden'});}
    async function prompted(label,value){page.once('dialog',dialog=>dialog.accept(value));await action(label);}
    await open('/');await prompted('New Folder…','menu-test');
    await page.waitForFunction(()=>window.__fileMenuAudit.fs.listDirectories().includes('/menu-test'));
    await open('/menu-test');await prompted('New File…','song.js');
    await page.waitForFunction(()=>window.__fileMenuAudit.fs.has('/menu-test/song.js'));
    await page.evaluate(()=>window.__fileMenuAudit.editor.setValue('unsaved editor content'));
    await open('/menu-test/song.js');await action('Copy Relative Path');
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'menu-test/song.js');
    await open('/menu-test/song.js');await action('Copy');
    await open('/menu-test');await action('Paste');
    await page.waitForFunction(()=>window.__fileMenuAudit.fs.has('/menu-test/song-copy.js'));
    assert.equal(await page.evaluate(()=>window.__fileMenuAudit.fs.get('/menu-test/song-copy.js').data),'unsaved editor content');
    await open('/menu-test/song-copy.js');await prompted('Rename…','renamed.js');
    await page.waitForFunction(()=>window.__fileMenuAudit.fs.has('/menu-test/renamed.js'));
    await open('/menu-test/renamed.js');await action('Cut');
    assert(await page.evaluate(()=>window.__fileMenuAudit.fs.has('/menu-test/renamed.js')));
    await open('/');await action('Paste');
    await page.waitForFunction(()=>window.__fileMenuAudit.fs.has('/renamed.js'));
    assert(!await page.evaluate(()=>window.__fileMenuAudit.fs.has('/menu-test/renamed.js')));
    await page.evaluate(()=>{const {fs,refresh}=window.__fileMenuAudit;fs.mkdir('/menu-test/empty');fs.writeBinary('/menu-test/data.bin',new Uint8Array([0,128,255]));refresh('/menu-test');});
    await open('/menu-test');await action('Copy');await open('/');await action('Paste');
    await page.waitForFunction(()=>window.__fileMenuAudit.fs.has('/menu-test-copy/data.bin'));
    assert.deepEqual(await page.evaluate(()=>Array.from(window.__fileMenuAudit.fs.get('/menu-test-copy/data.bin').data)),[0,128,255]);
    assert.equal(await page.evaluate(()=>window.__fileMenuAudit.fs.stat('/menu-test-copy/empty').type),'directory');
    await open('/menu-test');page.once('dialog',dialog=>dialog.accept());await action('Delete');
    await page.waitForFunction(()=>!window.__fileMenuAudit.fs.listDirectories().includes('/menu-test'));
    assert.equal(await page.evaluate(()=>window.__fileMenuAudit.editor.getValue()),await page.evaluate(()=>window.__fileMenuAudit.fs.get('/index.js').data));
    await open('/index.js');assert(await menu.getByRole('menuitem',{name:'Delete',exact:true}).isDisabled());
    assert(await menu.getByRole('menuitem',{name:'Cut',exact:true}).isDisabled());
    await page.keyboard.press('Escape');assert(!await menu.isVisible());
    await open('/');await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Paste');
    await page.locator('#fileExplorerList').click({position:{x:2,y:2}});assert(!await menu.isVisible());
    assert.deepEqual(errors,[]);
    console.log('File menu: all eight actions, unsaved edits, folder/binary copies, deletion fallback, entry-point protection, and keyboard dismissal passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
