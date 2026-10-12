const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  try{
    const context=await browser.newContext({serviceWorkers:'block'});
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/playground_audio_monitor.js',async route=>{
      const response=await route.fetch();const source=await response.text();
      const marker='analyser.getFloatTimeDomainData(samples); analyser.getFloatFrequencyData(bins);';
      assert(source.includes(marker));
      await route.fulfill({response,body:source.replace(marker,marker+`
        window.__audioObservation = {
          peak: Math.max(window.__audioObservation?.peak ?? 0, ...samples.map(Math.abs)),
          spectrum: Math.max(window.__audioObservation?.spectrum ?? -100, ...bins)
        };
      `)});
    });
    await page.goto(process.env.INTRODUCTION_TEST_URL||'http://localhost:8093/introductions/index-ja.html');
    for(const id of ['example-diy-fm-sine','example-diy-fm-modulation']){
      const element=page.locator(`iframe[data-playground-src="${id}"]`);
      await element.scrollIntoViewIfNeeded();
      const url=new URL(await element.getAttribute('src'),'http://localhost:8093/introductions/');
      assert.equal(url.searchParams.get('mode'),'full');assert.equal(url.searchParams.get('monitor'),'1');
      const frame=await (await element.elementHandle()).contentFrame();
      await frame.locator('#startupNotice').waitFor({state:'hidden'});
      assert(await frame.locator('#bottomDock #audioMonitorPanel').isVisible());
      assert.equal(await frame.locator('#audioMonitorTab').getAttribute('aria-selected'),'true');
      assert(!await frame.locator('body').evaluate(body=>body.classList.contains('has-inline-audio-monitor')));
      const divider=frame.locator('.bottom-panel-divider');
      const before=Number(await divider.getAttribute('aria-valuenow'));
      await divider.focus();await divider.press('ArrowUp');
      assert(Number(await divider.getAttribute('aria-valuenow'))>before);
      await frame.locator('#runButton').click();
      await frame.waitForFunction(()=>window.__audioObservation?.peak>0.01&&window.__audioObservation?.spectrum>-80);
      await frame.locator('#consoleTab').click();assert(!await frame.locator('#audioMonitorPanel').isVisible());
      await frame.locator('#audioMonitorTab').click();assert(await frame.locator('#audioMonitorPanel').isVisible());
      await frame.locator('#stopButton').click();
    }
    assert.deepEqual(errors,[]);
    console.log('Both Japanese DIY FM embeds use resizable bottom Audio tabs; waveform and spectrum receive nonzero audio during playback.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
