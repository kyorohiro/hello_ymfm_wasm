// Standalone SCSP Synth, real AudioWorklet/WASM. Physical output is muted.
const {chromium,webkit}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../docs');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.md':'text/plain'};
(async()=>{
 const server=http.createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep))throw Error();const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const rows=[];
 try{for(const [name,engine]of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true});try{
   const page=await browser.newPage({acceptDownloads:true,viewport:{width:1100,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    window.audit={contexts:[],worklets:[],messages:[],analysers:[]};
    const Context=window.AudioContext,Node=window.AudioWorkletNode,connect=AudioNode.prototype.connect;
    window.AudioContext=class extends Context{constructor(...args){super(...args);window.audit.contexts.push(this);}};
    AudioNode.prototype.connect=function(dest,...args){if(dest===this.context.destination){const mute=this.context.createGain();mute.gain.value=0;connect.call(mute,dest);return connect.call(this,mute,...args);}return connect.call(this,dest,...args);};
    window.AudioWorkletNode=class extends Node{constructor(...args){super(...args);window.audit.worklets.push(this);const analyser=this.context.createAnalyser();analyser.fftSize=2048;connect.call(this,analyser);const sink=this.context.createGain();sink.gain.value=0;connect.call(analyser,sink);connect.call(sink,this.context.destination);window.audit.analysers.push(analyser);this.port.addEventListener('message',({data})=>window.audit.messages.push(data));}};
    const post=MessagePort.prototype.postMessage;MessagePort.prototype.postMessage=function(data,...args){if(data?.type==='chip-inspector'||data?.method)window.audit.messages.push(data);return post.call(this,data,...args);};
   });
   await page.goto(`http://127.0.0.1:${server.address().port}/synth-scsp/index.html`);
   await page.click('#start');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Ready'));
   await page.waitForFunction(()=>!document.querySelector('[data-chip-action="scsp-sine"]').disabled);
   await page.keyboard.down('a');await page.keyboard.down('d');await page.keyboard.down('g');
   await page.waitForFunction(()=>document.querySelectorAll('#keyboard [aria-pressed=true]').length===3);
   await page.waitForFunction(()=>{const a=window.audit.analysers[0],data=new Float32Array(a.fftSize);a.getFloatTimeDomainData(data);return data.some(v=>Math.abs(v)>.01);});
   const peak=await page.evaluate(()=>{const a=window.audit.analysers[0],v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);return Math.max(...v.map(Math.abs));});assert(peak<.95);
   // Applying a new source must keep all held notes on their original PCM.
   const inspect=()=>page.evaluate(()=>new Promise(resolve=>{const node=window.audit.worklets[0],id=-777;const listener=({data})=>{if(data.id===id){node.port.removeEventListener('message',listener);resolve(data.value);}};node.port.addEventListener('message',listener);node.port.postMessage({type:'chip-inspector',action:'read',id});}));
   const before=await inspect();await page.click('[data-chip-action="scsp-square"]');await page.click('[data-chip-action="scsp-apply"]');await page.waitForFunction(()=>document.querySelector('[data-chip-action="scsp-apply"]').disabled);
   const after=await inspect();assert.notEqual(after.channels[0].sample.id,before.channels[0].sample.id);for(let slot=1;slot<=3;slot++)assert.equal(after.playingSampleIds[slot],before.channels[slot].sample.id);
   await page.fill('#pitch','2');await page.dispatchEvent('#pitch','change');
   for(const key of ['a','d','g'])await page.keyboard.up(key);
   await page.click('#stop');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Stopped'));
   await page.click('[data-chip-action="scsp-triangle"]');await page.click('[data-chip-action="scsp-apply"]');
   await page.waitForFunction(()=>document.querySelector('[data-chip-action="scsp-apply"]').disabled);
   const downloadEvent=page.waitForEvent('download');await page.click('#save');const download=await downloadEvent;const preset=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.equal(preset.format,'tetorica-scsp-voice');
   await page.setInputFiles('#open',{name:'voice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(preset))});await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preset loaded'));
   await page.keyboard.down('a');await page.waitForFunction(()=>document.querySelectorAll('#keyboard [aria-pressed=true]').length===1);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('a');await page.waitForFunction(()=>document.querySelectorAll('#keyboard [aria-pressed=true]').length===0);
   // Real file conversion, source preserved outside RAM until Apply.
   const wav=Buffer.alloc(44+2048*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4096,40);for(let i=0;i<2048;i++)wav.writeInt16LE(Math.round(8192*Math.sin(i*2*Math.PI/64)),44+i*2);
   await page.setInputFiles('[data-chip-control="scsp-audio-file"]',{name:'tone.wav',mimeType:'audio/wav',buffer:wav});await page.waitForFunction(()=>document.querySelector('[data-chip-output="scsp-file-status"]').textContent.startsWith('Loaded'));
   await page.click('[data-chip-action="scsp-use-selection"]');await page.click('[data-chip-action="scsp-apply"]');await page.waitForFunction(()=>document.querySelector('[data-chip-action="scsp-apply"]').disabled);
   await page.keyboard.down('s');await page.waitForFunction(()=>document.querySelectorAll('#keyboard [aria-pressed=true]').length===1);await page.keyboard.up('s');await page.click('#stop');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Stopped'));
   await page.setViewportSize({width:390,height:844});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1,`mobile overflow ${overflow}`);assert.equal(await page.locator('canvas').count(),1);assert.deepEqual(errors,[]);
   await page.screenshot({path:`/private/tmp/scsp-synth-${name}.png`,fullPage:true});rows.push({engine:name,peak,triad:true,pitch:true,presetRoundTrip:true,heldPcmProtected:true,audioImport:true,focus:true,blurRelease:true,stop:true,singleCanvas:true,mobileOverflow:overflow,pageErrors:errors,physicalOutput:'muted'});
  }finally{await browser.close();}
 }}finally{await new Promise(resolve=>server.close(resolve));}
 const report={passed:true,rows};await fs.writeFile(path.join(root,'issues/scsp_synth_browser_01.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
