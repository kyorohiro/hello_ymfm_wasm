// Serve docs on port 8093, or set TONE_API_TEST_URL (including ?chip=ym2203/ym2610).
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/playground.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__toneRuntime=runtime;'});});
  await page.goto(process.argv[2]||process.env.TONE_API_TEST_URL||'http://localhost:8093/playground/index.html');
  await page.waitForFunction(()=>window.__toneRuntime&&window.monaco?.editor?.getEditors().length);
  for(const execution of ['main','worker']){
   const source=`
    for(const name of ['ym2612','ym2203','ym2610','ym2608','ym2151','segapsg','gameboy','nes']){
      const chip=await createSoundChip(name,name==='nes'?{fds:true}:{});
      try{
        for(const method of ['setFrequency','setNote','keyOn','keyOff','noteOn'])if(typeof chip[method]!=='function')throw Error(name+' missing '+method);
        if(name==='gameboy')chip.initialize();
        else if(name==='ym2151'){
          chip.setAlgo(0,7);chip.setPan(0,true,true);chip.setOperator(0,3,{mul:1,tl:32,ar:31,d1r:0,d2r:0,d1l:0,rr:15});
        }else if(name.startsWith('ym'))chip.setPreset(0,FM_PRESETS['one-op-basic']);
        chip.setFrequency(0,440);chip.keyOn(0);await sleep(.015);chip.keyOff(0);
        chip.setNote(0,'A4');chip.keyOn(0);await sleep(.015);chip.keyOff(0);
        chip.noteOn(0,69);await sleep(.015);chip.keyOff(0);
        const clock=chip.clock;await chip.setClock(Math.round(clock*.75));chip.noteOn(0,'A4');await sleep(.015);chip.keyOff(0);await chip.setClock(clock);
        if(['ym2612','ym2203','ym2610','ym2608'].includes(name)){
          chip.setBlockFnum(0,4,600);chip.noteOnRaw(0,4,600);chip.keyOff(0);
          chip.setFrequency(0,4,600);chip.noteOn(0,4,600);chip.keyOff(0);
        }
        if(chip.ssg){chip.ssg.setVolume(0,12);chip.ssg.setFrequency(0,440);chip.ssg.keyOn(0);chip.ssg.keyOff(0);chip.ssg.noteOn(0,69);chip.ssg.keyOff(0);}
        if(name==='gameboy'){chip.pulse.noteOn(0,'C4');chip.pulse.keyOff(0);chip.wave.noteOn(69);chip.wave.keyOff();}
        if(name==='nes')for(const part of [chip.triangle,chip.fds]){part.setFrequency(440);part.keyOn();part.keyOff();part.setNote(69);part.noteOn('C4');part.keyOff();}
      }finally{chip.dispose();}
    }
    fm.setPreset(CH1,FM_PRESETS['one-op-basic']);fm.setFrequency(CH1,440);fm.keyOn(CH1);await sleep(.015);fm.keyOff(CH1);
    fm.setNote(CH1,69);fm.noteOn(CH1,'C4');await sleep(.015);fm.keyOff(CH1);
    fm.setBlockFnum(CH1,4,600);fm.noteOnRaw(CH1,4,600);fm.keyOff(CH1);
    console.log('TONE_API_PASS ${execution}');
   `;
   await page.evaluate(async ({source,execution})=>window.__toneRuntime.playSource(source,{execution}),{source,execution});
   await page.waitForFunction(execution=>document.getElementById('consoleOutput').textContent.includes('TONE_API_PASS '+execution),execution);
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,execution:['main','worker']}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
