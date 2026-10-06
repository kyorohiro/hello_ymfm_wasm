const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
// Run after examples npm run build; optional argument points to its dist directory.
const root=path.resolve(process.argv[2] || path.join(__dirname, '../w/tetorica-fm2612-examples/dist'));
const server=http.createServer(async(req,res)=>{try{let url=new URL(req.url,'http://local').pathname;if(url.endsWith('favicon.ico')){res.writeHead(204).end();return;}assert.ok(url.startsWith('/tetorica-fm2612-examples/'));url=url.slice('/tetorica-fm2612-examples'.length);if(url.endsWith('/'))url+='index.html';let file=path.resolve(root,'.'+url);assert.ok(file.startsWith(root+'/'));res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));}catch(e){res.writeHead(404).end(e.message);}});
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/tetorica-fm2612-examples/`;const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});try{
 const page=await browser.newPage();await page.addInitScript(()=>{
  window.__audio={peak:0,contexts:[]};const connect=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(target,...args){if(target===this.context.destination){
    const analyser=this.context.createAnalyser();analyser.fftSize=256;connect.call(this,analyser);const data=new Float32Array(256);const ctx=this.context;window.__audio.contexts.push(ctx);
    const timer=setInterval(()=>{if(ctx.state==='closed'){clearInterval(timer);return;}analyser.getFloatTimeDomainData(data);for(const v of data)window.__audio.peak=Math.max(window.__audio.peak,Math.abs(v));},5);
   }return connect.call(this,target,...args);};
 });
 let errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
 await page.goto(base);await page.waitForSelector('.sample-card');
 const manifest=JSON.parse(await fs.readFile(root+'/examples/manifest.json','utf8'));
 assert.equal(await page.locator('.sample-card').count(),manifest.length);
 for(const item of manifest.filter(x=>x.environments?.length===1&&x.environments[0]==='node')){
  const card=page.locator('.sample-card').filter({has:page.locator('p.eyebrow',{hasText:item.id})});assert.equal(await card.locator('a').count(),2);assert.equal(await card.locator('a',{hasText:'Web →'}).count(),0);
 }
 let count=0;
 for(const item of manifest.filter(x=>(!x.environments||x.environments.includes('web'))&&(!process.argv[3]||new RegExp(process.argv[3]).test(x.id)))){
  errors=[];await page.goto(base+`examples/${item.id}/web/index.html`);await page.locator('#play').click();
  await page.waitForFunction(()=>/^(Finished\.|Error:)/.test(document.querySelector('#status')?.textContent||''),{},{timeout:20000});
  const status=await page.locator('#status').textContent();assert.equal(status,'Finished.',item.id+': '+status);
  await page.waitForFunction(()=>!document.querySelector('#play').disabled,{},{timeout:5000});
  const audio=await page.evaluate(()=>({peak:window.__audio.peak,closed:window.__audio.contexts.every(ctx=>ctx.state==='closed')}));assert.ok(audio.peak>1e-5,item.id+' silent');assert.ok(audio.closed,item.id+' unclosed context');assert.deepEqual(errors,[],item.id);
  // The examples must also cancel initialization/playback and release resources.
  await page.locator('#play').click();await page.locator('#stop').click();await page.waitForFunction(()=>!document.querySelector('#play').disabled,{},{timeout:10000});
  assert.ok(!/^Error:/.test(await page.locator('#status').textContent()),item.id+' stop error');
  assert.ok(await page.evaluate(()=>window.__audio.contexts.every(ctx=>ctx.state==='closed')),item.id+' context after stop');
  assert.deepEqual(errors,[],item.id+' errors after stop');
  count++;console.log('PASS '+item.id+' peak='+audio.peak.toFixed(5));
 }
 console.log(`PASS ${count} Browser examples: package imports, audible output, finish/stop/cleanup; ${manifest.length} catalog cards under repository URL prefix`);
}finally{await browser.close();server.close();}})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
