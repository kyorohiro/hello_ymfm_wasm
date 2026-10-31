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
    await page.locator('#presetSelect').selectOption('sine');
    await page.waitForFunction(()=>document.getElementById('presetSelect').value==='sine');
  }
  const input=page.locator(chip==='spu'?'#masterVolume':'#masterVolumeRange');await input.waitFor();
  const scale=chip==='spu'?1:100;
  assert.equal(Number(await input.getAttribute('max')),2*scale);
  const set=async value=>{await input.evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value*scale);};
  const color=()=>input.evaluate(node=>getComputedStyle(node).accentColor);
  await set(1);const blue=await color();await set(2);const orange=await color();assert.notEqual(blue,orange);
  assert.equal(await page.locator('#masterVolumeValue').textContent(),'200%');
  await page.locator(chip==='spu'?'#startAudio':'#keyboard .key').first().click();
  await page.waitForFunction(chip=>document.getElementById(chip==='spu'?'audioStatus':'status').textContent.includes('Audio ready'),chip);
  await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down('y');
  await set(1);await page.waitForTimeout(100);const at100=await page.evaluate(()=>__masterRms());assert(at100>.00001);
  await set(2);await page.waitForTimeout(100);const at200=await page.evaluate(()=>__masterRms());
  const ratio=at200/at100;assert(Math.abs(ratio-2)<.15,`${name} ${chip}: expected twice the output, got ${ratio}`);
  await set(1.01);assert.equal(await color(),orange);assert.equal(await page.locator('#masterVolumeValue').textContent(),'101%');
  await set(1);assert.equal(await color(),blue);await set(.5);assert.equal(await color(),blue);
  await set(0);await page.waitForTimeout(100);assert((await page.evaluate(()=>__masterRms()))<1e-8);
  assert(await page.evaluate(()=>__masterSinks.every(({gate})=>gate.gain.value===0)));
  await page.keyboard.up('y');
  for(const width of [1200,390]){await page.setViewportSize({width,height:1000});await set(2);await input.locator('..').screenshot({path:`/private/tmp/${chip}-master200-${name}-${width}.png`});}
  assert.deepEqual(errors,[]);await page.close();
  return {browser:name,chip,maxPercent:200,blue,orange,at100,at200,ratio,mute:true,physicalOutputMuted:true};
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const results=[];
  try{for(const [name,type]of Object.entries({chromium,webkit})){const browser=await type.launch({headless:true});try{for(const chip of ['fm2612','spu'])results.push(await run(browser,name,`http://127.0.0.1:${server.address().port}`,chip));}finally{await browser.close();}}}
  finally{await new Promise(resolve=>server.close(resolve));}
  const report={passed:true,physicalOutputMuted:true,listeningPerformed:false,results};
  if(process.argv[2])await fs.writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
