// Full Playground UI + physical OPL WASM output in Chromium and WebKit.
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const docs=path.resolve(__dirname,'../docs');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
const server=http.createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,'http://localhost');
    if(url.pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    let file=path.resolve(docs,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(docs+path.sep))throw Error('Outside docs');
    if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
    let body=await fs.readFile(file);
    if(url.pathname.endsWith('/playground.js'))body=Buffer.from(body+'\nwindow.__oplCheck={runtime,megaDrive,operatorKeyboard,setBottomTab};');
    response.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');response.end(body);
  }catch(error){response.writeHead(404).end(error.message);}
});
async function field(page,selector,value){await page.locator(selector).evaluate((node,value)=>{
  if(node.type==='checkbox')node.checked=Boolean(value);else node.value=String(value);
  node.dispatchEvent(new Event(node.type==='range'?'input':'change',{bubbles:true}));
},value);}
async function state(page,chip){return page.evaluate(chip=>window.__oplCheck.runtime.chipInspector.read(chip),chip);}
async function until(page,chip,test,label){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){const snapshot=await state(page,chip);if(test(snapshot))return snapshot;await page.waitForTimeout(40);}
  throw Error(label+': '+JSON.stringify(await state(page,chip)));
}
async function meters(page){await page.evaluate(()=>{
  const {megaDrive}=window.__oplCheck,ctx=megaDrive.audioContext,split=ctx.createChannelSplitter(2),silent=ctx.createGain();
  silent.gain.value=0;silent.connect(ctx.destination);
  const analysers=[ctx.createAnalyser(),ctx.createAnalyser()];
  analysers.forEach((node,i)=>{node.fftSize=8192;split.connect(node,i);node.connect(silent);});
  megaDrive.audio.connectOutputMonitor(split);
  window.__oplCheck.measure=()=>analysers.map(node=>{
    const pcm=new Float32Array(node.fftSize);node.getFloatTimeDomainData(pcm);
    const mean=pcm.reduce((a,b)=>a+b,0)/pcm.length,cross=[];
    for(let i=1;i<pcm.length;i++)if(pcm[i-1]<mean&&pcm[i]>=mean)cross.push(i-1+(mean-pcm[i-1])/(pcm[i]-pcm[i-1]));
    return {rms:Math.sqrt(pcm.reduce((a,b)=>a+(b-mean)**2,0)/pcm.length),peak:Math.max(...pcm.map(Math.abs)),finite:pcm.every(Number.isFinite),hz:cross.length>2?(cross.length-1)*ctx.sampleRate/(cross.at(-1)-cross[0]):0};
  });
});}
const readPcm=page=>page.evaluate(()=>window.__oplCheck.measure());
async function audible(page,label){
  await page.waitForFunction(()=>window.__oplCheck.measure().some(x=>x.rms>.0002),null,{timeout:5000});
  const pcm=await readPcm(page);assert(pcm.every(x=>x.finite&&x.peak<.99),label+': finite unclipped PCM');return pcm;
}
async function silent(page){await page.waitForTimeout(240);await page.waitForFunction(()=>window.__oplCheck.measure().every(x=>x.peak<.00003),null,{timeout:5000});}
async function hold(page,selector){const button=page.locator(selector);await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();}
async function release(page){await page.mouse.move(5,5);await page.mouse.up();}
async function check(browser,base,chip,browserName){
  const page=await browser.newPage({serviceWorkers:'block'}),errors=[],missing=[];
  page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));page.on('response',r=>{if(r.status()===404)missing.push(r.url());});
  const panel='#'+chip+'Panel',control=name=>`${panel} [data-chip-control="opl-${name}"]`,action=name=>`${panel} [data-chip-action="opl-${name}"]`;
  try{
    await page.goto(base+`?mode=${chip}&no-sw=1`);
    await page.waitForFunction(()=>window.__oplCheck&&window.monaco?.editor?.getEditors().length);
    assert.equal(await page.evaluate(()=>window.__oplCheck.megaDrive.audioContext),null,'opening a mode does not open audio');
    assert(await page.locator('#'+chip+'Tab').isVisible());await page.click('#'+chip+'Tab');
    await page.click(`${panel} [data-chip-action="prepare"]`);await page.locator(control('frequency')).waitFor();
    await until(page,chip,s=>s.kind===chip&&s.channels.length===(chip==='ymf262'?18:9),'physical channels');
    const connected=await page.evaluate(()=>window.__oplCheck.runtime.chipInspector.list());
    assert.deepEqual(connected.map(entry=>entry.kind).sort(),chip==='y8950'?['ay8910','y8950','ym2413']:[chip],'selected mode sound set');
    await meters(page);await page.selectOption(control('preset'),'sine');await page.click(action('preset'));
    await field(page,control('frequency'),440);await until(page,chip,s=>Math.abs(s.channels[0].frequency-440)<2,'A4 register edit');
    await field(page,control('op-1-tl'),8);await until(page,chip,s=>s.channels[0].operators[1].tl===8,'partial operator edit');
    await hold(page,action('hold'));await audible(page,'panel Hold');await page.waitForTimeout(240);
    const tone=await readPcm(page);assert(tone.every(x=>Math.abs(x.hz-440)<4),'panel A4 pitch');await release(page);await silent(page);
    if(chip==='ymf262'){
      await page.selectOption(control('preset'),'four-op-bell');await page.click(action('preset'));
      await until(page,chip,s=>s.channels[0].fourOp&&!s.channels[3].available&&s.channels[0].operators.length===4,'four-op pair');
      assert(await page.locator(`${panel} [data-chip-channel="3"]`).isDisabled(),'paired secondary disabled');
      await hold(page,action('hold'));await audible(page,'four-op Hold');
      await field(page,control('pan-left'),true);await field(page,control('pan-right'),false);await page.waitForTimeout(240);
      const left=await readPcm(page);assert(left[0].rms>.0002&&left[1].peak<.00003,'4-op left output');
      await field(page,control('pan-left'),false);await field(page,control('pan-right'),true);await page.waitForTimeout(240);
      const right=await readPcm(page);assert(right[1].rms>.0002&&right[0].peak<.00003,'4-op right output');
      await release(page);await silent(page);
      await page.selectOption(control('preset'),'sine');await page.click(action('preset'));await field(page,control('four-op'),false);
    }
    const results=[];
    for(const execution of ['main','worker']){
      const source=`opl.setRhythm({enabled:false});opl.allNotesOff();opl.setPreset(0,OPL_PRESETS.sine);opl.setPreset(1,OPL_PRESETS.sine);liveLoop('opl-audio',async()=>{opl.noteOn(1,'E4');await sleep(.2);opl.keyOff(1);await sleep(.03);});`;
      await page.evaluate(({source,execution})=>window.__oplCheck.runtime.playSource(source,{execution}),{source,execution});
      await audible(page,execution+' script');await until(page,chip,s=>s.channels[1].operators[1].tl<63,'runtime patch state');
      await page.evaluate(()=>window.__oplCheck.setBottomTab('keyboard'));
      await page.selectOption('#playgroundKeyboardChip',`chip:${chip}`);
      await page.selectOption('#playgroundKeyboardTargetChannel','0');
      const key=await page.locator('#operatorKeyboardRoot .key').first().getAttribute('data-key');
      await page.evaluate(key=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})),key);
      await until(page,chip,s=>s.channels[0].active,'PC/Guitar key note-on');await audible(page,execution+' Keyboard');
      await page.evaluate(key=>document.body.dispatchEvent(new KeyboardEvent('keyup',{key,bubbles:true,cancelable:true})),key);
      await until(page,chip,s=>!s.channels[0].active,'PC/Guitar key note-off');
      await page.click('#stopButton');await page.waitForFunction(()=>window.__oplCheck.runtime.getState().playback==='stopped');await silent(page);
      const stopped=await state(page,chip);assert(stopped.channels.every(v=>!v.active));results.push(execution);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);console.log(JSON.stringify({browser:browserName,chip,passed:true,execution:results,panelPitch:tone[0].hz,keyboard:true,fourOp:chip==='ymf262'}));
  }finally{await page.close();}
}
(async()=>{
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}/playground/index.html`;
    const engines=process.argv.includes('--chromium')?{chromium}:process.argv.includes('--webkit')?{webkit}:{chromium,webkit};
    const flag=process.argv.find(arg=>arg.startsWith('--chip=')),chips=flag?[flag.slice(7)]:['ym3812','ym3526','y8950','ymf262'];
    for(const [name,engine]of Object.entries(engines)){
      const browser=await engine.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
      try{for(const chip of chips)await check(browser,base,chip,name);}finally{await browser.close();}
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
