// Serve docs on port 8093, or set NES_FREQUENCY_TEST_URL.
const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/playground.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__nesRuntime=runtime;'});});
  await page.goto(process.env.NES_FREQUENCY_TEST_URL||'http://localhost:8093/playground/index.html');
  await page.waitForFunction(()=>window.__nesRuntime&&window.monaco?.editor?.getEditors().length);
  const example=readFileSync(resolve(__dirname,'../docs/playground/examples/nes/nes-pulse-frequency.js'),'utf8');
  for (const execution of ['main','worker']) {
   const source=example+`\nconst other=await createSoundChip('nes');\ntry {\n other.setFrequency(0,437);other.pulse.keyOn(0);await sleep(.05);other.pulse.keyOff(0);\n other.pulse.setFrequency(1,660);other.keyOn(1);await sleep(.05);other.keyOff(1);\n}finally{other.dispose();}\nconsole.log('NES_FREQUENCY_PASS ${execution}');`;
   await page.evaluate(async ({source,execution})=>window.__nesRuntime.playSource(source,{execution}),{source,execution});
   await page.waitForFunction(execution=>document.getElementById('consoleOutput').textContent.includes('NES_FREQUENCY_PASS '+execution),execution);
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,execution:['main','worker']}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
