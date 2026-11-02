// Master UI and actual output gain in both standalone Synths. Physical output is muted.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium,webkit}=require('playwright');
const root=path.resolve(__dirname,'../docs');
const server=http.createServer(async(req,res)=>{
  try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);assert(file.startsWith(root+path.sep));const bytes=await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);}
  catch(error){res.writeHead(404).end(error.message);}
});
function captureOutput(){
  window.__masterSinks=[];
  const connect=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination){
      const analyser=this.context.createAnalyser(),gate=this.context.createGain();analyser.fftSize=2048;gate.gain.value=0;
      connect.call(analyser,gate);connect.call(gate,destination);window.__masterSinks.push({analyser,gate});
      return connect.call(this,analyser,...args);
    }
    return connect.call(this,destination,...args);
  };
  window.__masterRms=async()=>{
    let sum=0;
    for(let i=0;i<20;i++){
      await new Promise(requestAnimationFrame);
      sum+=Math.max(0,...__masterSinks.map(({analyser})=>{const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((s,v)=>s+v*v,0)/data.length);}));
    }
    return sum/20;
  };
}
async function run(browser,name,origin,chip){
  const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(captureOutput);
  await page.goto(origin+`/${chip==='spu'?'synth-spu':'synth'}/index.html`);
  if(chip==='fm2612'){
    await page.waitForFunction(()=>!document.getElementById('synthFileNewButton').disabled);
    await page.locator('#presetSelect').selectOption('sine');
    // The Files controller applies a preset asynchronously after flushing its
    // draft. Wait for the sustained patch, rather than the select's new value.
    await page.waitForFunction(()=>!document.getElementById('presetSelect').disabled&&
      document.getElementById('presetSelect').value==='sine'&&
      [...document.querySelectorAll('#operatorControls .param-value[aria-label="D2R"]')].every(node=>node.textContent==='0'));
  }
  const input=page.locator(chip==='spu'?'#masterVolume':'#masterVolumeRange');await input.waitFor();
  const scale=chip==='spu'?1:100;
  const defaultPercent=Number(await input.inputValue())/scale*100;
  assert.equal(defaultPercent,chip==='spu'?70:100,'existing startup volume is preserved');
  assert.equal(Number(await input.getAttribute('max')),3.8*scale);
  const set=async value=>{await input.evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value*scale);};
  const color=()=>input.evaluate(node=>getComputedStyle(node).accentColor);
  await set(1);const blue=await color();await set(3.8);const orange=await color();assert.notEqual(blue,orange);
  assert.equal(await page.locator('#masterVolumeValue').textContent(),'380%');
  await page.locator(chip==='spu'?'#startAudio':'#keyboard .key').first().click();
  await page.waitForFunction(chip=>document.getElementById(chip==='spu'?'audioStatus':'status').textContent.includes('Audio ready'),chip);
  await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down('y');
  await page.waitForFunction(chip=>document.querySelector(`${chip==='spu'?'#keyboardMount':'#keyboard'} .key[data-key="y"]`)?.classList.contains('is-active'),chip);
  await page.waitForFunction(async()=>await __masterRms()>.00001,null,{polling:200});
  const startup380=await page.evaluate(()=>__masterRms());assert(startup380>.00001,`${name} ${chip}: no held-note output at startup 380%`);
  await set(1);await page.waitForTimeout(100);const at100=await page.evaluate(()=>__masterRms());assert(at100>.00001);
  const measured={},ratios={};
  for(const value of [.5,2,3.8]){
    await set(value);await page.waitForTimeout(100);const rms=await page.evaluate(()=>__masterRms());
    const ratio=rms/at100;assert(Math.abs(ratio-value)<value*.075,`${name} ${chip}: expected ${value} times the output, got ${ratio}`);
    assert.equal(await page.locator('#masterVolumeValue').textContent(),`${Math.round(value*100)}%`);
    measured[Math.round(value*100)]=rms;ratios[Math.round(value*100)]=ratio;
  }
  assert(Math.abs(startup380/at100-3.8)<.285,'380% selected before Enable audio reaches the actual output');
  await set(1.01);assert.equal(await color(),orange);assert.equal(await page.locator('#masterVolumeValue').textContent(),'101%');
  await set(1);assert.equal(await color(),blue);await set(.5);assert.equal(await color(),blue);
  await set(0);await page.waitForTimeout(100);assert((await page.evaluate(()=>__masterRms()))<1e-8);
  assert(await page.evaluate(()=>__masterSinks.every(({gate})=>gate.gain.value===0)));
  await page.keyboard.up('y');
  for(const width of [1200,390]){await page.setViewportSize({width,height:1000});await set(3.8);await input.locator('..').screenshot({path:`/private/tmp/${chip}-master380-${name}-${width}.png`});}
  assert.deepEqual(errors,[]);await page.close();
  return {browser:name,chip,maxPercent:380,defaultPercent,blue,orange,startup380,at100,measured,ratios,mute:true,physicalOutputMuted:true};
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const results=[];
  try{for(const [name,type]of Object.entries({chromium,webkit})){const browser=await type.launch({headless:true});try{for(const chip of ['fm2612','spu'])results.push(await run(browser,name,`http://127.0.0.1:${server.address().port}`,chip));}finally{await browser.close();}}}
  finally{await new Promise(resolve=>server.close(resolve));}
  const report={passed:true,physicalOutputMuted:true,listeningPerformed:false,results};
  if(process.argv[2])await fs.writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
