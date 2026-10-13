// Serve docs on port 8093, or set CHIP_CLOCK_TEST_URL.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/playground.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__clockRuntime=runtime;'});});
  const target=process.env.CHIP_CLOCK_TEST_URL||'http://localhost:8093/playground/index.html';
  const selected=new URL(target).searchParams.get('chip')||'ym2612';
  await page.goto(target);
  await page.waitForFunction(()=>window.__clockRuntime&&window.monaco?.editor?.getEditors().length);
  const results=[];
  for(const execution of ['main','worker']){
   await page.evaluate(async ({execution,selected})=>{
    await window.__clockRuntime.playSource(`
      const names=['ym2612','ym2203','ym2610','ym2608','ym2151','segapsg','gameboy','nes','rf5c164','pwm'];
      for (const name of names) {
        const chip=await createSoundChip(name);
        const initial=chip.clock;
        if (!Number.isInteger(initial)) throw Error(name+' missing clock');
        await chip.setClock(Math.round(initial*.75));
        if (chip.clock!==Math.round(initial*.75)) throw Error(name+' clock mismatch');
        await chip.setClock(initial);
        let rejected=false;try {await chip.setClock(NaN);} catch {rejected=true;}
        if (!rejected||chip.clock!==initial) throw Error(name+' validation');
        chip.dispose();
      }
      const chip=fm;
      const initial=chip.clock;
      fm.setPreset(CH1,FM_PRESETS['one-op-basic']);fm.noteOn(CH1,4,600);
      await chip.setClock(Math.round(initial*.5));
      await sleep(.05);
      await chip.setClock(initial);fm.noteOff(CH1);
      console.log('CLOCK_PASS', '${execution}');
    `,{execution});
   },{execution,selected});
   await page.waitForFunction(execution=>document.getElementById('consoleOutput').textContent.includes('CLOCK_PASS '+execution),execution);
   if (selected === 'ym2612') await page.evaluate(async execution => {
    const source = await (await fetch('./examples/chip-raw/chip-clock-sweep.js')).text();
    await window.__clockRuntime.playSource(source, {execution});
   }, execution);
   results.push(execution);
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,results}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
