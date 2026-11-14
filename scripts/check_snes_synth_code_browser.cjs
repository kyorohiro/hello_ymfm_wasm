// SPDX-License-Identifier: BSD-3-Clause
// Real WASM checks; every destination is replaced by a preinstalled zero-gain route.
const {chromium,webkit}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const config={root:path.resolve(__dirname,'../docs'),entry:'/synth-snes/index.html',out:'/private/tmp/snes-code-browser.json'};
for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i].replace(/^--/,'');assert(key in config);config[key]=key==='entry'?process.argv[i+1]:path.resolve(process.argv[i+1]);}
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.wasm':'application/wasm','.ts':'text/plain','.webp':'image/webp'};
async function check(name,engine,origin){
 const browser=await engine.launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
 const page=await browser.newPage({viewport:{width:1240,height:1000},acceptDownloads:true}),errors=[],missing=[],checks=[],measurements=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(origin)&&r.status()>=400)missing.push(r.url());});
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.addInitScript(()=>{
   const audit=window.audit={contexts:[],nodes:[],mutes:[],analysers:[],notes:[],databases:[],next:0};
   const open=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{const request=open(...args);request.addEventListener('success',()=>audit.databases.push(request.result));return request;};
   const Context=window.AudioContext??window.webkitAudioContext,Node=window.AudioWorkletNode,connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
   window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
   AudioNode.prototype.connect=function(destination,...args){if(destination===this.context.destination){const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;audit.mutes.push(mute);audit.analysers.push(analyser);connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);return destination;}return connect.call(this,destination,...args);};
   window.AudioWorkletNode=class extends Node{constructor(...args){super(...args);if(args[1]==='tetorica-sdsp-synth')audit.nodes.push(this);}};
   MessagePort.prototype.postMessage=function(data,...args){if(['noteOn','noteOff'].includes(data?.method))audit.notes.push({method:data.method,args:data.args});return post.call(this,data,...args);};
   audit.read=()=>new Promise((resolve,reject)=>{const node=audit.nodes.at(-1),id=--audit.next;
     const timer=setTimeout(()=>reject(Error('read timeout')),5000);const receive=({data})=>{if(data.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);};node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method:'read',args:[]});});
   audit.measure=()=>{const a=audit.analysers.at(-1);if(!a)return {peak:0,rms:0,finite:true};const values=new Float32Array(a.fftSize);a.getFloatTimeDomainData(values);return {peak:Math.max(...values.map(Math.abs)),rms:Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length),finite:values.every(Number.isFinite)};};
   audit.peak=()=>audit.measure().peak;
 });
 const mark=label=>{checks.push(label);console.log(name+': '+label);};
 const state=()=>page.evaluate(()=>audit.read());
 const waitVoices=async count=>{for(let i=0;i<100;i++){const s=await state();if(s.voices.length===count)return s;await page.waitForTimeout(25);}throw Error('Expected '+count+' voices: '+JSON.stringify(await state()));};
 const waitState=async predicate=>{for(let i=0;i<100;i++){const value=await state();if(predicate(value))return value;await page.waitForTimeout(25);}throw Error('S-DSP state did not settle: '+JSON.stringify(await state()));};
 const setCode=async source=>{await page.locator('#synthCodeEditor').fill(source);};
 const run=async source=>{if(source!==undefined)await setCode(source);await page.locator('#synthCodeRunButton').click();await page.waitForFunction(()=>/Running|Playing/.test(document.querySelector('#synthCodeState').textContent));assert.equal(await page.locator('#synthCodeError').textContent(),'');};
 try{
   await page.goto(origin+config.entry);await page.waitForFunction(()=>!document.querySelector('#synthInputCodeTab').disabled&&!document.querySelector('.snes-main').inert);
   mark('passive startup and named preset Files');assert.equal(await page.evaluate(()=>audit.contexts.length),0);
   await page.locator('#snesFilesToggle').click();await page.locator('#snesFileSaveSoundButton').click();await page.waitForFunction(()=>document.querySelector('#snesFilesStatus').textContent.includes('/presets/Sine.sdsp.json'));
   await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});assert((await page.locator('#synthCodeEditor').inputValue()).includes('tetorica-sdsp-voice'));
   // Opening Code after saving keeps that JSON selected; choose the starter explicitly.
   await page.locator('#snesFilesTree button[data-file-path="/index.js"]').click();
   mark('BPM starter and actual shared S-DSP output');await page.waitForFunction(()=>document.querySelector('#synthCodeEditor').value.includes('await beat(0.5)'));
   await run();await page.waitForFunction(()=>audit.notes.some(n=>n.method==='noteOn'&&n.args[0].startsWith('sdsp-code:')));await page.waitForFunction(()=>audit.peak()>.0001);
   assert.equal(await page.evaluate(()=>audit.contexts.length),1);assert.equal(await page.evaluate(()=>audit.nodes.length),1);
   await page.locator('#synthCodeStopButton').click();await waitVoices(0);
   mark('manual keyboard in Code, focus safety and shared allocation');
   await run('const snes=await useSoundChip("snes"); await snes.noteOn(CH1,"C4"); context.kept=17; liveFx("gain",{context:{gain:.5},process(input,output,state,ctx){for(let ch=0;ch<output.length;ch++)for(let i=0;i<output[ch].length;i++)output[ch][i]=(input[ch]?.[i]??0)*ctx.gain;}});');await waitVoices(1);
   await page.locator('#synthInputCodeTab').click();await page.keyboard.down('q');await waitVoices(2);await page.keyboard.up('q');await waitVoices(1);
   await page.locator('#synthCodeEditor').focus();const before=await page.evaluate(()=>audit.notes.length);await page.keyboard.press('w');assert.equal(await page.evaluate(()=>audit.notes.length),before);
   await setCode('if(context.kept!==17)throw Error("context lost"); const chip=await useSoundChip("snes"); await chip.noteOn(CH2,"E4");');await page.locator('#synthCodeApplyButton').click();await waitVoices(2);
   await page.locator('#synthInputKeyboardTab').click();assert.match(await page.locator('#synthCodeState').textContent(),/Running/);
   await page.keyboard.down('q');await waitVoices(3);await page.locator('#synthCodeStopButton').click();await waitVoices(1);await page.keyboard.up('q');await waitVoices(0);
   let expectedSound;
   const presets=await page.evaluate(async()=>{
     const base=new URL('./',document.querySelector('script[type="module"]').src);
     const module=await import(new URL('preset.js',base)),{encodeBrr}=await import(new URL('../js/snes_brr_encoder.js',base)),{encodeBase64}=await import(new URL('sample.js',base));
     return ['wave','brr','noise','pmon','pmon-brr'].map(kind=>{
       const p=module.createDefaultPreset();p.echo.enabled=true;if(kind==='noise')p.source='noise';if(kind.startsWith('pmon'))p.pmon.enabled=true;
       if(kind==='brr'||kind==='pmon-brr'){
         p.source='brr';p.brr={name:'self-authored.brr',data:encodeBase64(encodeBrr(Float32Array.from(p.wave),{loopStartSamples:0}).brr),rootNote:60,basePitch:4096,loopStartSamples:0};
         if(kind==='pmon-brr'){p.pmon.source='brr';p.pmon.brr={...p.brr};}
       }
       return {kind,preset:p};
     });
   });
   for(const {kind,preset}of presets){
     mark('held Code + keyboard live edits: '+kind+' with Echo');
     await page.locator('#presetFileInput').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(preset))});
     const expected=structuredClone(preset);if(expected.brr.data)delete expected.brr.data;if(expected.pmon.brr.data)delete expected.pmon.brr.data;
     await waitState(s=>require('node:util').isDeepStrictEqual(s.preset,expected));
     await page.locator('#synthInputCodeTab').click();await run('const chip=await useSoundChip("snes");await chip.noteOn(CH1,"C4");');
     const single=await waitVoices(1);assert.equal(single.capacity,preset.pmon.enabled?4:8);assert.equal(single.echo.enabled,true);await page.waitForFunction(()=>audit.peak()>.0001);
     await page.locator('#synthInputCodeTab').click();await page.keyboard.down('q');const held=await waitVoices(2);
     const edit=async(id,delta,read)=>{
       const before=await state(),oldValue=read(before.preset);
       await page.locator('#'+id).evaluate(element=>{for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});
       await page.locator(`[data-stepper-for="${id}"][data-stepper-delta="${delta}"]`).click();
       const after=await waitState(s=>read(s.preset)!==oldValue);
       assert.deepEqual(after.voices,held.voices,id+' retains both Code and manual owners');assert.equal(after.generation,held.generation,id+' keeps the same DSP generation');
     };
     await edit('volumeLeft',1,p=>p.volume.left);await edit('attack',-1,p=>p.envelope.attack);await edit('echoFeedback',1,p=>p.echo.feedback);
     if(kind==='noise')await edit('noiseClock',-1,p=>p.noise.clock);
     if(preset.source==='brr')await edit('basePitch',1,p=>p.brr.basePitch);
     if(preset.pmon.enabled)await edit('pmonRatio',1,p=>p.pmon.ratio);
     const pcm=await page.evaluate(()=>audit.measure());assert(pcm.finite&&pcm.peak>0,kind+' retains finite audio after live edits');measurements.push({kind,...pcm});
     const edited=(await state()).preset;expectedSound=structuredClone(edited);expectedSound.brr.data=preset.brr.data;expectedSound.pmon.brr.data=preset.pmon.brr.data;
     await page.locator('#synthCodeStopButton').click();const manual=await waitVoices(1);assert(manual.voices[0].id.startsWith('sdsp-synth:'));await page.keyboard.up('q');await waitVoices(0);
     assert.deepEqual((await state()).preset,edited);assert.equal(await page.evaluate(()=>audit.contexts.length),1);
   }
   mark('voice stealing and stale manual key release');
   await page.locator('#synthInputCodeTab').click();await page.keyboard.down('q');await waitVoices(1);
   await run('const chip=await useSoundChip("snes");for(let lane=0;lane<8;lane++)await chip.noteOn(lane,60+lane);');
   const stolen=await waitVoices(4);assert(stolen.voices.every(v=>v.id.startsWith('sdsp-code:')));await page.keyboard.up('q');assert.deepEqual((await state()).voices,stolen.voices);
   await page.locator('#synthCodeStopButton').click();await waitVoices(0);
   mark('Code and full PMON/Echo preset recover after reload without executing');
   const saved='// user performance retained\nconst chip=await useSoundChip("snes");\nawait chip.noteOn(CH1,"G4");\n';await setCode(saved);
   await page.keyboard.press('ControlOrMeta+s');await page.waitForTimeout(250);await page.reload();await page.waitForFunction(()=>!document.querySelector('.snes-main').inert);
   assert.equal(await page.evaluate(()=>audit.contexts.length),0);await page.locator('#synthInputCodeTab').click();await page.waitForFunction(()=>!document.querySelector('#synthCodeEditor').readOnly);
   assert.equal(await page.locator('#synthCodeEditor').inputValue(),saved);
   mark('Cassette roundtrip preserves Code, full sound and binary files');
   if(await page.locator('#snesFilesPanel').isHidden())await page.locator('#snesFilesToggle').click();
   await page.locator('#snesFilesInput').setInputFiles({name:'test.brr',mimeType:'application/octet-stream',buffer:Buffer.from([1,255,0,128])});await page.waitForTimeout(150);
   const downloading=page.waitForEvent('download');await page.locator('#snesProjectExportButton').click();const download=await downloading,archive=await fs.readFile(await download.path());
   const {loadPlaygroundCassette}=await import('../docs/playground/playground_cassette.js');const cassette=await loadPlaygroundCassette(new Uint8Array(archive));
   assert.deepEqual(JSON.parse(new TextDecoder().decode(cassette.files.get('snes-synth.project.json'))).settings,expectedSound,'Cassette retains both BRR payloads and all live edits');assert.deepEqual([...cassette.files.get('test.brr')],[1,255,0,128]);
   await setCode('// changed');await page.locator('#snesProjectFileInput').setInputFiles({name:'saved.cassette.zip',mimeType:'application/zip',buffer:archive});
   await page.waitForFunction(()=>document.querySelector('#snesFilesStatus').textContent.includes('project imported'));
   assert.equal(await page.locator('#synthCodeEditor').inputValue(),saved);assert.equal(await page.evaluate(()=>audit.contexts.length),0);
   await run();const restored=await waitVoices(1);assert.equal(restored.pmon.enabled,true);assert.equal(restored.echo.enabled,true);await page.locator('#synthCodeStopButton').click();
   mark('closed IndexedDB connection recovers without losing a newer Code edit');
   await page.evaluate(()=>audit.databases.forEach(db=>db.close()));await setCode(saved+'// after reconnect\n');await page.keyboard.press('ControlOrMeta+s');await page.waitForTimeout(200);await page.reload();await page.waitForFunction(()=>!document.querySelector('.snes-main').inert);await page.locator('#synthInputCodeTab').click();await page.waitForFunction(()=>document.querySelector('#synthCodeEditor').value.endsWith('// after reconnect\n'));assert.equal(await page.evaluate(()=>audit.contexts.length),0);
   mark('expanded Code and narrow layout');await page.locator('#synthCodeExpandButton').click();assert(await page.locator('#synthWorkspace').evaluate(e=>e.classList.contains('is-code-expanded')));
   await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:config.out.replace(/\.json$/,'-'+name+'-wide.png'),fullPage:true});await page.setViewportSize({width:390,height:844});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:config.out.replace(/\.json$/,'-'+name+'-narrow.png'),fullPage:true});
   assert.equal(await page.locator('#synthCodeError').textContent(),'');assert.equal(await page.evaluate(()=>audit.mutes.every(m=>m.gain.value===0)),true);assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
   return {engine:name,passed:true,checks,measurements,muted:true};
 }catch(error){await page.screenshot({path:config.out.replace(/\.json$/,'-'+name+'-failure.png')}).catch(()=>{});throw Error(name+' / '+checks.at(-1)+': '+error.stack+'\npage errors: '+errors+'\nmissing: '+missing);}
 finally{await browser.close();}
}
(async()=>{
 const server=http.createServer(async(req,res)=>{try{const file=path.resolve(config.root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));assert(file.startsWith(config.root+path.sep));res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end('not found');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const origin='http://127.0.0.1:'+server.address().port,results=[];for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])results.push(await check(name,engine,origin));await fs.writeFile(config.out,JSON.stringify({passed:true,results},null,2)+'\n');}
 finally{await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
