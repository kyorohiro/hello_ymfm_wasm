// Serve docs on port 8093, or set STARTUP_TEST_URL.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const url=process.env.STARTUP_TEST_URL||'http://localhost:8093/playground/index.html';
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({serviceWorkers:'block'});
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    let releaseRuntime,releaseEditor;
    const runtimeGate=new Promise(resolve=>releaseRuntime=resolve);
    const editorGate=new Promise(resolve=>releaseEditor=resolve);
    await page.route('**/playground_runtime.js?*',async route=>{await runtimeGate;await route.continue();});
    await page.route('**/vs/loader*.js',async route=>{await editorGate;await route.continue();});
    await page.goto(url,{waitUntil:'domcontentloaded'});
    assert(await page.locator('#startupNotice').isVisible());
    assert.match(await page.locator('#startupMessage').textContent(),/Downloading/);
    assert.match(await page.locator('#fileExplorerList').textContent(),/Loading project files/);
    assert(await page.locator('#editor').evaluate(element=>element.readOnly));
    assert.match(await page.locator('#editor').getAttribute('placeholder'),/Loading code/);
    await page.screenshot({path:'/private/tmp/playground-startup-loading.png'});
    releaseRuntime();
    await page.waitForFunction(()=>document.querySelector('#fileExplorerList [data-file-path="/index.js"]'));
    assert.match(await page.locator('#startupMessage').textContent(),/Loading the code editor/);
    assert((await page.locator('#editor').inputValue()).length>0);
    assert(!await page.locator('#editor').evaluate(element=>element.readOnly));
    releaseEditor();
    await page.locator('#startupNotice').waitFor({state:'hidden'});
    assert.equal(await page.locator('#fileExplorerList').getAttribute('aria-busy'),'false');
    assert.deepEqual(errors,[]);
    const failed=await context.newPage();
    await failed.route('**/playground.js?*',route=>route.abort());
    await failed.goto(url,{waitUntil:'domcontentloaded'});
    await failed.locator('#startupRetry').waitFor({state:'visible'});
    assert.match(await failed.locator('#startupMessage').textContent(),/could not start/);
    assert.equal(await failed.locator('#status').textContent(),'Startup failed.');
    const fallback=await context.newPage();
    await fallback.route('**/vs/loader*.js',route=>route.abort());
    await fallback.goto(url,{waitUntil:'domcontentloaded'});
    await fallback.locator('#startupNotice').waitFor({state:'hidden'});
    assert(await fallback.locator('#editor').isVisible());
    assert(!await fallback.locator('#editor').evaluate(element=>element.readOnly));
    assert((await fallback.locator('#editor').inputValue()).length>0);
    console.log('Startup: visible before modules load, project/editor stages, completion, failure/reload, and basic-editor fallback passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
