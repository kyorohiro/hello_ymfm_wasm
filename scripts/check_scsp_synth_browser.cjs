// Standalone SCSP Synth, real AudioWorklet/WASM. Physical output is muted.
const {chromium,webkit}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const config={root:path.resolve(__dirname,'../docs'),entry:'/synth-scsp/index.html',out:path.resolve(__dirname,'../docs/issues/scsp_synth_browser_01.json')};
for(let i=2;i<process.argv.length;i++){const key=process.argv[i].replace(/^--/,'');assert(['root','entry','out'].includes(key),'Usage: --root DIR --entry /index.html --out REPORT');const value=process.argv[++i];assert(value);config[key]=key==='entry'?value:path.resolve(value);}
const root=config.root;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.md':'text/plain','.webp':'image/webp'};
(async()=>{
 const server=http.createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep))throw Error();const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const rows=[];
 try{for(const [name,engine]of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true});try{
   const page=await browser.newPage({acceptDownloads:true,viewport:{width:1100,height:900}}),errors=[],missing=[],external=[];page.on('pageerror',e=>errors.push(e.message));
   page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
   await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){external.push(url.href);return route.abort();}return route.continue();});
   await page.addInitScript(()=>{
    window.audit={contexts:[],worklets:[],messages:[],analysers:[]};
    const Context=window.AudioContext,Node=window.AudioWorkletNode,connect=AudioNode.prototype.connect;
    window.AudioContext=class extends Context{constructor(...args){super(...args);window.audit.contexts.push(this);}};
    AudioNode.prototype.connect=function(dest,...args){if(dest===this.context.destination){const mute=this.context.createGain();mute.gain.value=0;connect.call(mute,dest);return connect.call(this,mute,...args);}return connect.call(this,dest,...args);};
    window.AudioWorkletNode=class extends Node{constructor(...args){super(...args);window.audit.worklets.push(this);const analyser=this.context.createAnalyser();analyser.fftSize=2048;connect.call(this,analyser);const sink=this.context.createGain();sink.gain.value=0;connect.call(analyser,sink);connect.call(sink,this.context.destination);window.audit.analysers.push(analyser);this.port.addEventListener('message',({data})=>window.audit.messages.push(data));}};
    const post=MessagePort.prototype.postMessage;MessagePort.prototype.postMessage=function(data,...args){if(data?.type==='chip-inspector'||data?.method)window.audit.messages.push(data);return post.call(this,data,...args);};
   });
   await page.goto(`http://127.0.0.1:${server.address().port}${config.entry}`);
   await page.waitForFunction(()=>document.querySelector('.product-icon')?.naturalWidth>0);
   assert.match(await page.locator('link[rel=icon]').getAttribute('href'),/tetorica-spu-1254\.webp$/);
   await page.click('#start');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Ready')).catch(async error=>{throw new Error(`${error.message}; status=${await page.locator('#status').textContent()}; errors=${JSON.stringify(errors)}`);});
   await page.waitForFunction(()=>!document.querySelector('[data-chip-action="scsp-sine"]').disabled);
   await page.keyboard.down('a');await page.keyboard.down('d');await page.keyboard.down('g');
   await page.waitForFunction(()=>document.querySelectorAll('#keyboard [aria-pressed=true]').length===3);
   await page.waitForFunction(()=>{const a=window.audit.analysers[0],data=new Float32Array(a.fftSize);a.getFloatTimeDomainData(data);return data.some(v=>Math.abs(v)>.01);});
   const peak=await page.evaluate(()=>{const a=window.audit.analysers[0],v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);return Math.max(...v.map(Math.abs));});assert(peak<.95);
   // Applying a new source must keep all held notes on their original PCM.
   const inspect=()=>page.evaluate(()=>new Promise(resolve=>{const node=window.audit.worklets[0],id=-777;const listener=({data})=>{if(data.id===id){node.port.removeEventListener('message',listener);resolve(data.value);}};node.port.addEventListener('message',listener);node.port.postMessage({type:'chip-inspector',action:'read',id});}));
   await page.selectOption('[data-chip-control="scsp-lfo-frequencyCode"]','20');
   await page.selectOption('[data-chip-control="scsp-lfo-pitchWave"]','2');
   await page.selectOption('[data-chip-control="scsp-lfo-pitchDepth"]','3');
   await page.selectOption('[data-chip-control="scsp-lfo-amplitudeDepth"]','4');
   await page.waitForFunction(()=>document.activeElement?.tagName!=='SELECT');
   let lfoState;for(let attempt=0;attempt<50;attempt++){lfoState=await inspect();if(lfoState.channels[4].lfo.amplitudeDepth===4)break;await page.waitForTimeout(20);}
   for(const slot of [0,2,3,4]){assert.equal(lfoState.channels[slot].lfo.frequencyCode,20);assert.equal(lfoState.channels[slot].lfo.pitchDepth,3);assert.equal(lfoState.channels[slot].lfo.amplitudeDepth,4);}
   await page.check('[data-chip-control="scsp-lfo-reset"]');await page.uncheck('[data-chip-control="scsp-lfo-reset"]');
   const before=await inspect();await page.click('[data-chip-action="scsp-square"]');await page.click('[data-chip-action="scsp-apply"]');await page.waitForFunction(()=>document.querySelector('[data-chip-action="scsp-apply"]').disabled);
   const after=await inspect();assert.notEqual(after.channels[0].sample.id,before.channels[0].sample.id);for(let slot=2;slot<=4;slot++)assert.equal(after.playingSampleIds[slot],before.channels[slot].sample.id);
   await page.fill('#pitch','2');await page.dispatchEvent('#pitch','change');
   for(const key of ['a','d','g'])await page.keyboard.up(key);
   await page.click('#stop');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Stopped'));
   await page.click('[data-chip-action="scsp-triangle"]');await page.click('[data-chip-action="scsp-apply"]');
   await page.waitForFunction(()=>document.querySelector('[data-chip-action="scsp-apply"]').disabled);
   const downloadEvent=page.waitForEvent('download');await page.click('#save');const download=await downloadEvent;const preset=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.equal(preset.format,'tetorica-scsp-voice');assert.equal(preset.operators.carrier.voice.lfo.pitchDepth,3);assert.equal(preset.operators.carrier.voice.lfo.amplitudeDepth,4);
   await page.setInputFiles('#open',{name:'voice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(preset))});await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preset loaded'));
   await page.keyboard.down('a');await page.waitForFunction(()=>document.querySelectorAll('#keyboard [aria-pressed=true]').length===1);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('a');await page.waitForFunction(()=>document.querySelectorAll('#keyboard [aria-pressed=true]').length===0);
   // A single keyboard note owns the complete FM pair. Source edits keep held PCM.
   const waitState=async fn=>{for(let n=0;n<100;n++){const state=await inspect();if(fn(state))return state;await page.waitForTimeout(20);}throw Error('Synth state did not settle');};
   await page.selectOption('#voiceMode','fm2');await waitState(s=>s.config.mode==='fm2');
   await page.keyboard.down('a');await page.keyboard.down('d');await page.keyboard.down('g');
   const fmBefore=await waitState(s=>s.voiceGroups.filter(g=>g.held).length===3);assert.equal(fmBefore.voiceCapacity,15);
   const pairs=fmBefore.voiceGroups.filter(g=>g.held).map(g=>g.slots);for(const [m,c]of pairs){assert.equal(fmBefore.channels[m].directLevel,0);assert.equal(fmBefore.channels[c].modulation.xOffset,63);}
   await page.click('#modulator');assert.equal(await page.locator('canvas').count(),1);
   await page.click('[data-chip-action="scsp-saw"]');await page.click('[data-chip-action="scsp-apply"]');await page.waitForFunction(()=>document.querySelector('[data-chip-action="scsp-apply"]').disabled);
   let fmState=await inspect();assert.notEqual(fmState.channels[1].sample.id,fmBefore.channels[1].sample.id);for(const [m]of pairs)assert.equal(fmState.playingSampleIds[m],fmBefore.channels[1].sample.id);
   await page.fill('#fmRatio','3');await page.dispatchEvent('#fmRatio','change');await page.fill('#fmDepth','8');await page.dispatchEvent('#fmDepth','change');await page.fill('#pitch','5');await page.dispatchEvent('#pitch','change');
   fmState=await waitState(s=>s.config.transpose===5&&s.config.fm.ratio===3&&s.config.fm.depth===8);
   for(const group of fmState.voiceGroups.filter(g=>g.held)){const [m,c]=group.slots;const hz=440*2**((group.midi-69+5)/12);assert(Math.abs(fmState.channels[c].frequencyHz-hz)<1e-6);assert(Math.abs(fmState.channels[m].frequencyHz-hz*3)<1e-6);assert.equal(fmState.channels[c].modulation.depth,8);}
   await page.waitForFunction(()=>{const a=window.audit.analysers[0],v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);return v.every(Number.isFinite)&&v.some(x=>Math.abs(x)>.0001);});
   await page.locator('.voice-routing').scrollIntoViewIfNeeded();await page.screenshot({path:`/private/tmp/scsp-synth-fm2-${name}.png`,fullPage:true});
   const fmDownloadEvent=page.waitForEvent('download');await page.click('#save');const fmDownload=await fmDownloadEvent,fmPatch=JSON.parse(await fs.readFile(await fmDownload.path(),'utf8'));assert.equal(fmPatch.version,2);assert.equal(fmPatch.mode,'fm2');assert.equal(fmPatch.fm.ratio,3);assert(fmPatch.operators.carrier.pcm.length&&fmPatch.operators.modulator.pcm.length);
   await page.setInputFiles('#open',{name:'fm.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fmPatch))});await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preset loaded'));fmState=await inspect();assert.equal(fmState.voiceGroups.length,0);assert.equal(fmState.config.mode,'fm2');assert.equal(fmState.config.fm.depth,8);
   for(const key of ['a','d','g'])await page.keyboard.up(key);
   await page.keyboard.down('a');await waitState(s=>s.voiceGroups.some(g=>g.held));const intact=await inspect();const invalid=structuredClone(fmPatch);invalid.fm.depth=13;
   await page.setInputFiles('#open',{name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('FM depth'));const failed=await inspect();assert.equal(failed.bankId,intact.bankId);assert(failed.voiceGroups.some(g=>g.held));assert.equal(failed.channels[0].sample.id,intact.channels[0].sample.id);
   await page.selectOption('#voiceMode','pcm');await waitState(s=>s.config.mode==='pcm');await page.waitForFunction(()=>document.querySelectorAll('#keyboard [aria-pressed=true]').length===0);await page.keyboard.up('a');
   // A legacy v1 file remains a PCM voice and supplies a fresh default modulator.
   const legacy={...fmPatch.operators.carrier,format:'tetorica-scsp-voice',version:1};await page.setInputFiles('#open',{name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Preset loaded'));assert.equal((await inspect()).config.mode,'pcm');
   await page.click('#carrier');
   // Real file conversion, source preserved outside RAM until Apply.
   const wav=Buffer.alloc(44+2048*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4096,40);for(let i=0;i<2048;i++)wav.writeInt16LE(Math.round(8192*Math.sin(i*2*Math.PI/64)),44+i*2);
   await page.setInputFiles('[data-chip-control="scsp-audio-file"]',{name:'tone.wav',mimeType:'audio/wav',buffer:wav});await page.waitForFunction(()=>document.querySelector('[data-chip-output="scsp-file-status"]').textContent.startsWith('Loaded'));
   await page.click('[data-chip-action="scsp-use-selection"]');await page.click('[data-chip-action="scsp-apply"]');await page.waitForFunction(()=>document.querySelector('[data-chip-action="scsp-apply"]').disabled);
   await page.keyboard.down('s');await page.waitForFunction(()=>document.querySelectorAll('#keyboard [aria-pressed=true]').length===1);await page.keyboard.up('s');await page.click('#stop');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Stopped'));
   await page.screenshot({path:`/private/tmp/scsp-synth-${name}-desktop.png`,fullPage:true});
   await page.setViewportSize({width:390,height:844});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1,`mobile overflow ${overflow}`);assert.equal(await page.locator('canvas').count(),1);assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
   await page.screenshot({path:`/private/tmp/scsp-synth-${name}.png`,fullPage:true});
   await page.evaluate(()=>window.audit.contexts[0].close());await page.waitForFunction(()=>!document.querySelector('#start').disabled&&document.querySelector('#status').textContent.includes('AudioContext was closed'));
   await page.click('#start');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Ready'));await page.keyboard.down('a');await page.waitForFunction(()=>{const a=window.audit.analysers.at(-1),v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);return v.some(x=>Math.abs(x)>.0001);});await page.keyboard.up('a');await page.click('#stop');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Stopped'));
   rows.push({engine:name,peak,triad:true,pitch:true,lfo:true,groupedFm:true,liveRatioDepthPitch:true,operatorPcmProtected:true,presetV2:true,legacyV1:true,invalidPresetAtomic:true,modeChangeStops:true,contextRecovery:true,presetRoundTrip:true,heldPcmProtected:true,audioImport:true,focus:true,blurRelease:true,stop:true,singleCanvas:true,productIcon:true,mobileOverflow:overflow,pageErrors:errors,missingAssets:missing,externalRequests:external,physicalOutput:'muted'});
  }finally{await browser.close();}
 }}finally{await new Promise(resolve=>server.close(resolve));}
 const report={passed:true,entry:config.entry,rows};await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
