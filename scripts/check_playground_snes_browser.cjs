// Actual Playground Main/logic Worker -> authored BRR -> accurate S-DSP WASM
// -> existing mixer/FX/master output, Chromium and WebKit. No game data.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const docs=path.resolve(__dirname,'../docs'),mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml'};
const accessor='\nwindow.__snesTest={runtime,megaDrive};';
const server=http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let file=path.resolve(docs,'.'+pathname);if(!file.startsWith(docs+path.sep))throw Error('Invalid path');if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');let body=await fs.readFile(file);if(pathname.endsWith('/playground.js'))body=Buffer.from(body.toString()+accessor);res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(body);}catch(error){res.writeHead(404).end(String(error));}});
async function check(name,type,url){
 const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
 try{
  const page=await browser.newPage({serviceWorkers:'block'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.waitForFunction(()=>window.__snesTest&&window.monaco?.editor?.getEditors().length);
  await page.evaluate(()=>{document.getElementById('workerExecution').checked=false;monaco.editor.getEditors()[0].setValue('await sleep(.01);');});
  await page.click('#runButton');await page.waitForFunction(()=>!document.getElementById('runButton').disabled);
  await page.evaluate(()=>{const{megaDrive}=window.__snesTest,context=megaDrive.audioContext;const analyser=context.createAnalyser(),sink=context.createGain();analyser.fftSize=2048;sink.gain.value=0;analyser.connect(sink);sink.connect(context.destination);const detach=megaDrive.audio.connectOutputMonitor(analyser);window.__snesMonitor={analyser,sink,detach};});
  let serial=0,execution='main';
  const run=async source=>{const token=`SNES_RESULT_${++serial}:`;await page.evaluate(async({source,execution,token})=>{await window.__snesTest.runtime.playSource(source+`\nconsole.log(${JSON.stringify(token)}+JSON.stringify(typeof result==='undefined'?{}:result));`,{execution});},{source,execution,token});await page.waitForFunction(token=>document.getElementById('consoleOutput').textContent.includes(token),token);return page.evaluate(token=>{const text=document.getElementById('consoleOutput').textContent;return JSON.parse(text.slice(text.lastIndexOf(token)+token.length).split('\n')[0]);},token);};
  const meter=async()=>{const lead=execution==='worker'?await page.evaluate(()=>__snesTest.runtime.getTiming().workerLookaheadSeconds*1000):0;await page.waitForTimeout(lead+120);return page.evaluate(()=>{const a=__snesMonitor.analyser,data=new Float32Array(a.fftSize);a.getFloatTimeDomainData(data);return{rms:Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length),finite:data.every(Number.isFinite)};});};
  const brr='new Uint8Array([0xc3,0x12,0x34,0x56,0x76,0x54,0x32,0x10,0xfe])',results=[];
  for(execution of ['main','worker']){
   await page.evaluate(async()=>__snesTest.runtime.stopWithFade());
   // Gain/FX ratios use explicit unity, independently of calibrated defaults.
   const initial=await run(`const snes=await useSoundChip('snes'),again=await useSoundChip('snes');if(snes!==again)throw Error('not shared');let invalid=false;try{await snes.loadBRR(${brr},{});}catch{invalid=true;}if(!invalid)throw Error('missing tuning accepted');const sample=await snes.loadBRR(${brr},{rootNote:60,loopStartSamples:0});snes.setPreset(0,{sample,gain:127,volumeLeft:100,volumeRight:100});await mixer.set(snes.id,{volume:1});snes.noteOn(0,'C4');context.snes=snes;const result={id:snes.id,sample,samples:(await snes.getState()).samples.length,nativeRate:snes.nativeSampleRate,outputRate:snes.sampleRate};`);
   assert.equal(initial.id,'snes:shared');assert.equal(initial.samples,1);assert.equal(initial.nativeRate,32000);assert([44100,48000].includes(initial.outputRate));
   const baseline=await meter();assert(baseline.finite&&baseline.rms>.01,`${name}/${execution}: silent or invalid native output ${JSON.stringify(baseline)}`);
   const reused=await run(`const snes=await useSoundChip('snes');const result={same:snes===context.snes,samples:(await snes.getState()).samples.length};`);assert.equal(reused.same,true);assert.equal(reused.samples,1);
   await run(`await mixer.set(context.snes.id,{muted:true});`);const muted=await meter();assert(muted.finite&&muted.rms<1e-6,`${name}/${execution}: mixer mute failed ${muted.rms}`);
   await run(`await mixer.set(context.snes.id,{muted:false,volume:.5});`);const half=await meter();assert(Math.abs(half.rms/baseline.rms-.5)<.08,`${name}/${execution}: mixer volume ratio ${half.rms/baseline.rms}`);
   await run(`await mixer.set(context.snes.id,{volume:1});fx.setChain([fx.gain({gain:.25})]);`);const fx=await meter();assert(Math.abs(fx.rms/baseline.rms-.25)<.08,`${name}/${execution}: FX route ratio ${fx.rms/baseline.rms}`);
   const isolated=await run(`fx.setChain([]);const other=await createSoundChip('snes',{id:'snes:independent-test'});const sample=await other.loadBRR(${brr},{rootNote:'A4',loopStartSamples:0});other.setPreset(7,{sample,volumeLeft:0,volumeRight:0});other.noteOn(7,'A4');context.other=other;const result={id:other.id,sharedSamples:(await context.snes.getState()).samples.length,otherRoot:(await other.getState()).samples[0].rootNote,chips:(await mixer.list()).filter(chip=>chip.name==='snes'&&chip.connected).length};`);
   assert.equal(isolated.id,'snes:independent-test');assert.equal(isolated.sharedSamples,1);assert.equal(isolated.otherRoot,'A4');assert.equal(isolated.chips,2);
   const independent=await meter();assert(Math.abs(independent.rms/baseline.rms-1)<.1,`${name}/${execution}: independent sample changed shared output`);
   await run(`context.other.dispose();context.snes.reset();context.snes.setPreset(0,{sample:0,gain:127});context.snes.noteOn(0,'C4');`);const reset=await meter();assert(reset.rms>.01&&reset.finite,`${name}/${execution}: reset did not retain sample`);
   await run(`context.snes.keyOff(0);`);const released=await meter();assert(released.rms<1e-6,`${name}/${execution}: KOFF did not release native voice ${released.rms}`);
   await page.evaluate(async()=>__snesTest.runtime.stopWithFade());const stopped=await meter();assert(stopped.rms<1e-6);assert.equal(await page.evaluate(()=>__snesTest.megaDrive.mixer.list().filter(chip=>chip.name==='snes'&&chip.connected).length),0);
   results.push({execution,nativeRate:initial.nativeRate,outputRate:initial.outputRate,baseline,muted,half,fx,independent,reset,released,stopped});
  }
  assert.deepEqual(errors,[]);await page.evaluate(()=>{__snesMonitor.detach();__snesMonitor.analyser.disconnect();__snesMonitor.sink.disconnect();});console.log(JSON.stringify({browser:name,passed:true,results}));
 }finally{await browser.close();}
}
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{const url=`http://127.0.0.1:${server.address().port}/playground/index.html`;await check('chromium',chromium,url);await check('webkit',webkit,url);}finally{await new Promise(resolve=>server.close(resolve));}})().catch(error=>{console.error(error);process.exitCode=1;});
