// Real AudioWorklet/WASM DSP Lab; measure destination signal and mute speakers.
const {chromium,webkit}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
let root=path.resolve(__dirname,'../docs'),out='/private/tmp/scsp-dsp-lab-browser.json';
for(let i=2;i<process.argv.length;i++){const flag=process.argv[i],value=process.argv[++i];assert(value);if(flag==='--root')root=path.resolve(value);else if(flag==='--out')out=path.resolve(value);else throw Error('Usage: --root DIR --out FILE');}
(async()=>{
 const mime={'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.css':'text/css','.webp':'image/webp'};
 const server=http.createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));assert(file.startsWith(root+path.sep));res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream'});res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const rows=[];
 try{for(const [name,engine]of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true});try{
   const page=await browser.newPage({viewport:{width:900,height:900}}),errors=[],missing=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)missing.push(r.url());});
   await page.addInitScript(()=>{const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(dest,...args){if(dest===this.context.destination){window.labAnalyser=this.context.createAnalyser();window.labAnalyser.fftSize=2048;const mute=this.context.createGain();mute.gain.value=0;connect.call(this,window.labAnalyser);connect.call(window.labAnalyser,mute);connect.call(mute,dest);return dest;}return connect.call(this,dest,...args);};});
   await page.goto(`http://127.0.0.1:${server.address().port}/playground/scsp-dsp.html`);await page.click('#start');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Ready'));
   await page.uncheck('#dry');await page.fill('#time','80');await page.dispatchEvent('#time','change');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('DSP updated'));await page.click('#pulse');
   await page.waitForFunction(()=>{const a=window.labAnalyser,v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);return v.some(x=>Math.abs(x)>.0001);});
   await page.click('#stop');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Stopped'));await page.waitForFunction(()=>{const a=window.labAnalyser,v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);return v.every(x=>x===0);});
   await page.uncheck('#enabled');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('DSP updated'));await page.click('#pulse');await page.waitForTimeout(300);
   assert(await page.evaluate(()=>{const a=window.labAnalyser,v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);return v.every(x=>x===0);}));
   await page.check('#enabled');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('DSP updated'));await page.click('#pulse');await page.waitForFunction(()=>{const a=window.labAnalyser,v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);return v.some(x=>Math.abs(x)>.0001);});await page.click('#stop');
   await page.setViewportSize({width:390,height:844});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1);await page.screenshot({path:`/private/tmp/scsp-dsp-lab-${name}.png`,fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
   rows.push({engine:name,wetOnly:true,bypass:true,reenable:true,stopSilence:true,mobileOverflow:overflow,pageErrors:errors,missingAssets:missing,measurement:'destination input after Volume',physicalOutput:'muted'});
  }finally{await browser.close();}
 }}finally{await new Promise(resolve=>server.close(resolve));}
 const report={passed:true,entry:'/playground/scsp-dsp.html',rows};await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});
