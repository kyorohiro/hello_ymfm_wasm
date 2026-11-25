// SPDX-License-Identifier: BSD-3-Clause
// Exercise the real sliders and observe PM bytes returned by the AudioWorklet.
const path=require('node:path'),fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const server=http.createServer((req,res)=>{
   const root=path.resolve(__dirname,'../docs');
   const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
   if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
   if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream');
   fs.createReadStream(file).pipe(res);
 });
 await new Promise((ok,fail)=>server.listen(0,'127.0.0.1',ok).on('error',fail));
 let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();page.setDefaultTimeout(5000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    const connect=AudioNode.prototype.connect;
    window.testAudioLinks=new Map();
    AudioNode.prototype.connect=function(destination,...args){
      if(destination instanceof AudioNode)window.testAudioLinks.set(destination,this);
      return connect.call(this,destination,...args);
    };
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/synth-fm21290/index.html');
  await page.click('#tab-chipPanel');await page.selectOption('#bank','1');
  const wheel=page.locator('#pitchWheel');
  const pm=word=>page.waitForFunction(v=>document.querySelector('#modBytes').textContent.endsWith(v),word);
  await wheel.focus();await page.keyboard.down('End');await pm('02 ab');
  await page.keyboard.down('a');await page.waitForFunction(()=>document.querySelector('#channels [data-state=on]'));
  await page.keyboard.up('a');await page.keyboard.up('End');await pm('00 00');
  assert.equal(await wheel.inputValue(),'0');
  const track=[0,144,60,95,0,176,1,127,0,224,0,96,0x82,0x20,224,0,0,0,144,64,100,0x88,0,255,47,0];
  await page.locator('#importMidi').setInputFiles({name:'bend.mid',mimeType:'audio/midi',buffer:Buffer.from([77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,track.length,...track])});
  await page.getByText('Mod wheel settings',{exact:true}).click();await page.check('#modBias');
  const am=value=>page.waitForFunction(v=>document.querySelector('#modBytes').textContent.startsWith(v+' '),value);
  await am('ff');
  await page.locator('#playMidi').evaluate(button=>button.click());await pm('01 55');await am('00');
  assert.equal(await page.inputValue('#modPosition'),'127');
  await wheel.focus();await page.keyboard.down('End');await pm('02 ab');
  await page.waitForFunction(()=>document.querySelectorAll('#channels [data-state=on]').length===2);
  await pm('02 ab');
  await page.keyboard.up('End');await pm('fd 55');
  const rect=await wheel.boundingBox();await page.mouse.move(rect.x+rect.width-3,rect.y+rect.height/2);
  await page.mouse.down();await pm('02 ab');await page.locator('#stopMidi').evaluate(b=>b.click());
  await page.mouse.move(rect.x+rect.width+45,rect.y+10);await pm('02 ab');await page.mouse.up();await pm('00 00');
  assert.equal(await wheel.inputValue(),'0');
  await am('ff');assert.equal(await page.inputValue('#modPosition'),'0');
  await page.locator('#modPosition').press('End');await am('00');
  await page.locator('#modPosition').blur();assert.equal(await page.inputValue('#modPosition'),'127');
  await wheel.focus();await page.keyboard.down('Home');await pm('fd 55');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await pm('00 00');await page.keyboard.up('Home');
  await page.click('#tab-mixerPanel');
  const master=page.locator('#master'),mixer=page.locator('#mixer');
  async function gains(masterPercent,mixerPercent){
    await page.waitForFunction(([m,s])=>{
      const links=window.testAudioLinks;
      const dest=[...links.keys()].findLast(node=>node instanceof AudioDestinationNode && node.context.state==='running');
      const master=links.get(dest),mixer=links.get(master);
      return master instanceof GainNode && mixer instanceof GainNode && links.has(mixer)
        && Math.abs(master.gain.value-m/100)<1e-5 && Math.abs(mixer.gain.value-s/100)<1e-5;
    },[masterPercent,mixerPercent]);
  }
  await gains(65,100);
  for(const mode of ['Spectrum','Waveform']){
    const button=page.getByRole('button',{name:mode,exact:true});
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#scope').getAttribute('aria-label'),'Output '+mode.toLowerCase());
  }
  for(const slider of [master,mixer]){
    await slider.click();
    await page.keyboard.down('a');await page.waitForFunction(()=>document.querySelector('#channels [data-state=on]'));
    await page.keyboard.up('a');await page.waitForFunction(()=>!document.querySelector('#channels [data-state=on]'));
  }
  await master.press('Home');await gains(0,Number(await mixer.inputValue()));
  await mixer.press('End');await gains(0,380);
  await master.press('Home');await gains(0,380);
  await master.press('End');await mixer.press('Home');await gains(380,0);
  await mixer.press('End');await gains(380,380);
  await page.selectOption('#engine','msfa');await page.waitForSelector('#engine:enabled');assert.ok(await wheel.isDisabled());
  await page.locator('#keyboardPanel').focus();await page.keyboard.down('a');
  await gains(380,380);await page.keyboard.up('a');
  await page.selectOption('#engine','chip');await page.waitForSelector('#pitchWheel:enabled');assert.equal(await wheel.inputValue(),'0');
  await page.waitForFunction(()=>document.querySelector('#draftStatus').textContent==='Saved locally');
  await page.reload();await page.waitForSelector('main:not([inert])');
  assert.equal(await page.innerText('#masterValue'),'380%');assert.equal(await page.innerText('#mixerValue'),'380%');
  assert.deepEqual(errors,[]);assert.equal(await page.innerText('#status'),'');console.log('Cold wheel, physical key, PM words, newer SMF bend, stop under wheel, pointer release outside, blur, engine switch passed');
 } finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
