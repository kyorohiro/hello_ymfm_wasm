// SPDX-License-Identifier: BSD-3-Clause
// Real YM2149 Worklet integration; every physical speaker route is muted.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const os=require('node:os');
const {chromium,webkit}=require('playwright');
const config={root:path.resolve(__dirname,'../docs'),entry:'/synth-ym2149-st/index.html',engines:'chromium,webkit',
  out:path.join(os.tmpdir(),'ym2149-st-synth-browser.json'),screenshots:path.join(os.tmpdir(),'ym2149-st-synth-browser')};
for(const arg of process.argv.slice(2)) {
  const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,`Unknown argument ${arg}`);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);
assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.every(name=>['chromium','webkit'].includes(name)));
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.ts':'text/plain'};
const server=http.createServer(async(req,res)=>{
  try {
    let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(name.endsWith('/'))name+='index.html';
    const file=path.resolve(config.root,'.'+name);
    if(!file.startsWith(config.root+path.sep)) {res.writeHead(403).end();return;}
    const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(data);
  } catch {res.writeHead(404).end();}
});
function installSilentAudit() {
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const audit=window.__ymAudit={contexts:[],processors:[],meters:[],writes:[]};
  window.AudioContext=class extends Context {constructor(...args){super(...args);audit.contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet {constructor(context,name,options){super(context,name,options);audit.processors.push({name,options:{clock:options.processorOptions?.clock,type:options.processorOptions?.type,flags:options.processorOptions?.flags}});}};
  AudioNode.prototype.connect=function(destination,...args) {
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);audit.meters.push({analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){if(data?.method)audit.writes.push({method:data.method,args:data.args});return post.call(this,data,...args);};
  audit.level=()=>{
    let peak=0,sum=0,count=0;
    for(const {analyser} of audit.meters){const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);for(const n of values){peak=Math.max(peak,Math.abs(n));sum+=n*n;count++;}}
    return {peak,rms:Math.sqrt(sum/Math.max(1,count))};
  };
}
async function main() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  await fs.mkdir(config.screenshots,{recursive:true});
  try {
    for(const name of engines) {
      const browser=await ({chromium,webkit}[name]).launch({headless:true});
      try {
        const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[],missing=[];
        await context.addInitScript(installSilentAudit);
        await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
        page.on('pageerror',e=>errors.push(e.message));
        page.on('response',res=>{if(res.url().startsWith(origin)&&res.status()>=400)missing.push(res.url());});
        await page.goto(origin+config.entry);
        await page.waitForFunction(()=>Boolean(window.tetoricaYm2149StSynth));
        await page.waitForFunction(()=>!document.getElementById('ymFileNewButton')?.disabled);
        assert.equal(await page.evaluate(()=>__ymAudit.contexts.length),0,'cold page creates no audio');
        await page.locator('#enableAudio').click();
        await page.waitForFunction(()=>document.getElementById('enableAudio').textContent==='Audio ready');
        assert.deepEqual(await page.evaluate(()=>__ymAudit.processors.find(p=>p.name==='tetorica-ay8910')?.options),{clock:2000000,type:16,flags:1});
        assert.equal(await page.evaluate(()=>__ymAudit.contexts.length),1);
        const snapshot=()=>page.evaluate(()=>tetoricaYm2149StSynth.getState());
        assert.deepEqual((await snapshot()).activeChannels,[]);
        const allocation=[];
        for(const key of ['z','x','c','v']) {
          await page.keyboard.press('Escape');await page.evaluate(()=>document.activeElement?.blur());
          await page.keyboard.down(key);await page.waitForFunction(()=>tetoricaYm2149StSynth.getState().activeChannels.length===1);
          allocation.push((await snapshot()).activeChannels[0]);await page.waitForTimeout(45);
          const level=await page.evaluate(()=>__ymAudit.level());assert(level.rms>0.0001,'actual YM2149 PCM is audible before the test mute');
          await page.keyboard.up(key);await page.waitForFunction(()=>tetoricaYm2149StSynth.getState().activeChannels.length===0);
        }
        assert.deepEqual(allocation,[0,1,2,0]);
        await page.locator('[data-channel="1"]').click();
        await page.locator('#fixedVolumeDisplay').press('Home');
        assert.equal((await snapshot()).preset.voices[1].volume,0);
        await page.locator('#fixedVolumeDisplay').press('ArrowUp');
        assert.equal((await snapshot()).preset.voices[1].volume,1);
        await page.locator('[data-channel="auto"]').click();
        assert.equal((await snapshot()).preset.voices[1].volume,1,'Auto selection preserves differences');
        await page.locator('#fixedVolumeDisplay').press('End');
        assert.deepEqual((await snapshot()).preset.voices.map(v=>v.volume),[15,15,15]);
        await page.locator('#synthInputCodeTab').click();
        await page.locator('#synthCodeRunButton').click();
        await page.waitForFunction(()=>tetoricaYm2149StSynth.getCodeState().running);
        await page.waitForFunction(()=>tetoricaYm2149StSynth.getState().activeChannels.length>0);
        const codePCM=await page.evaluate(()=>__ymAudit.level());
        await page.locator('[data-channel="0"]').click();await page.locator('#noiseEnabled').check();
        assert.equal((await snapshot()).preset.voices[0].noise,true);
        assert.equal(await page.evaluate(()=>tetoricaYm2149StSynth.getCodeState().running),true,'hardware edit keeps Code running');
        await page.locator('#synthInputKeyboardTab').click();
        assert.equal(await page.evaluate(()=>tetoricaYm2149StSynth.getCodeState().running),true,'Keyboard tab keeps Code running');
        await page.locator('#savePreset').click();
        await page.waitForFunction(()=>document.getElementById('ymPresetSelect').options.length>1);
        const options=await page.locator('#ymPresetSelect option').evaluateAll(items=>items.map(o=>o.value).filter(Boolean));
        await page.locator('#ymPresetSelect').selectOption(options.at(-1));
        assert.equal(await page.evaluate(()=>tetoricaYm2149StSynth.getCodeState().running),true,'preset keeps Code running');
        assert.equal(await page.locator('#synthKeyboardPanel').isVisible(),true,'preset preserves Keyboard mode');
        await page.locator('[data-channel="2"]').click();await page.evaluate(()=>document.activeElement?.blur());
        await page.keyboard.down('z');await page.waitForFunction(()=>tetoricaYm2149StSynth.getState().activeChannels.includes(2));
        await page.locator('#synthCodeStopButton').click();
        await page.waitForFunction(()=>!tetoricaYm2149StSynth.getCodeState().running);
        assert((await snapshot()).activeChannels.includes(2),'Code Stop preserves a held manual note');
        await page.keyboard.up('z');await page.waitForFunction(()=>tetoricaYm2149StSynth.getState().activeChannels.length===0);
        await page.locator('#stopSound').click();await page.waitForTimeout(140);
        assert((await page.evaluate(()=>__ymAudit.level())).rms<1e-6,'Stop returns to silence');
        await page.locator('#masterVolume').evaluate(input=>{input.value='3.8';input.dispatchEvent(new Event('input',{bubbles:true}));});
        assert.equal(await page.locator('#masterValue').textContent(),'380%');assert.equal(await page.locator('#masterVolume').getAttribute('data-boosted'),'true');
        await page.locator('#ymFilesToggle').click();
        await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeExpandButton').click();
        assert.equal(await page.locator('#synthWorkspace').evaluate(node=>node.classList.contains('is-code-expanded')),true);
        await page.locator('#synthCodeExpandButton').click();
        for(const width of [1280,390,320]) {
          await page.setViewportSize({width,height:900});await page.waitForTimeout(30);
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} ${width} layout`);
          await page.screenshot({path:path.join(config.screenshots,`${name}-${width}.png`),fullPage:true});
        }
        assert.deepEqual(missing,[],'no missing local resources');assert.deepEqual(errors,[],'no uncaught errors');
        const audit=await page.evaluate(()=>({contexts:__ymAudit.contexts.length,speakerRoutes:__ymAudit.meters.length,
          allPhysicalOutputsMuted:__ymAudit.meters.every(m=>m.mute.gain.value===0),processors:__ymAudit.processors,writes:__ymAudit.writes.length}));
        assert.equal(audit.contexts,1);assert.equal(audit.speakerRoutes,1);assert(audit.allPhysicalOutputsMuted);
        // A closed device retires the old client and can be explicitly enabled again.
        await page.evaluate(()=>__ymAudit.contexts[0].close());
        await page.waitForFunction(()=>document.getElementById('enableAudio').textContent==='Enable audio');
        await page.locator('#enableAudio').click();
        await page.waitForFunction(()=>document.getElementById('enableAudio').textContent==='Audio ready');
        await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down('z');
        await page.waitForFunction(()=>tetoricaYm2149StSynth.getState().activeChannels.includes(2));
        await page.keyboard.up('z');await page.waitForFunction(()=>tetoricaYm2149StSynth.getState().activeChannels.length===0);
        assert.equal(await page.evaluate(()=>__ymAudit.contexts.length),2);
        assert(await page.evaluate(()=>__ymAudit.meters.every(m=>m.mute.gain.value===0)));
        assert.deepEqual(errors,[],'recovery has no uncaught errors');assert.deepEqual(missing,[]);
        results.push({engine:name,passed:true,allocation,codePCM,audit,closedDeviceRecovery:true,
          editor:'offline fallback exercised; CDN deliberately blocked',errors,missing});
        await context.close();
      } finally {await browser.close();}
    }
    const report={passed:true,entry:config.entry,physicalOutputMuted:true,results};
    await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } finally {await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
