// SPDX-License-Identifier: BSD-3-Clause
// Real SNES S-DSP WASM / AudioWorklet, with the final output muted during checks.
const {chromium, webkit} = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {gzipSync} = require('node:zlib');

function makeWav() {
  const rate=44100,frames=rate*5,channels=2,bytes=Buffer.alloc(44+frames*channels*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
  bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(channels,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*channels*2,28);
  bytes.writeUInt16LE(channels*2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
  for(let i=0;i<frames;i++) for(let ch=0;ch<channels;ch++) bytes.writeInt16LE(Math.round(Math.sin(i/rate*Math.PI*2*220)*(ch===0?.6:.3)*32767),44+(i*channels+ch)*2);
  return bytes;
}

const config = {root:path.resolve(__dirname, '../docs'), entry:'/synth-snes/index.html',
  out:'/private/tmp/tetorica-sdsp-synth-browser.json', screenshots:null};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  assert(['root','entry','out','screenshots'].includes(key), 'Usage: --root DIR --entry /index.html --out REPORT [--screenshots DIR]');
  const value = process.argv[++i]; assert(value, `Missing --${key}`);
  config[key] = key === 'entry' ? value : path.resolve(value);
}
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm',
  '.json':'application/json','.webp':'image/webp','.png':'image/png'};

async function checkEngine(name, engine, origin) {
  const browser = await engine.launch({headless:true});
  const errors = [], failed = [], external = [], checks = [];
  let stage = 'startup';
  try {
    if(config.screenshots)await fs.mkdir(config.screenshots,{recursive:true});
    const page = await browser.newPage({acceptDownloads:true,viewport:{width:1180,height:1000}});
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {if (response.status() >= 400) failed.push({url:response.url(),status:response.status()});});
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ['data:','blob:'].includes(url.protocol)) return route.continue();
      external.push(url.href); return route.abort();
    });
    await page.addInitScript(() => {
      const audit = window.audit = {contexts:[],worklets:[],analysers:[],nextId:0,presetMessages:[]};
      const post=MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage=function(data,...args) {
        if(['setPreset','loadPreset'].includes(data?.method)) audit.presetMessages.push({method:data.method,
          dataLength:data.args?.[0]?.brr?.data?.length??0,elided:data.brrDataUnchanged===true});
        if(audit.holdDdaCommit&&data?.method==='loadPreset'&&data.args?.[0]?.brr?.name==='slow-commit.wav') {
          audit.holdDdaCommit=false;audit.releaseDdaCommit=()=>post.call(this,data,...args);return;
        }
        return post.call(this,data,...args);
      };
      const Context = window.AudioContext ?? window.webkitAudioContext;
      const Worklet = window.AudioWorkletNode, connect = AudioNode.prototype.connect;
      window.AudioContext = class extends Context {constructor(...args) {super(...args);audit.contexts.push(this);}};
      if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
      AudioNode.prototype.connect = function(destination, ...args) {
        if (destination === this.context.destination) {
          const analyser = this.context.createAnalyser(); analyser.fftSize = 4096;
          const mute = this.context.createGain(); mute.gain.value = 0;
          audit.analysers.push(analyser);
          connect.call(this, analyser);connect.call(analyser, mute);connect.call(mute, destination);
          return destination;
        }
        return connect.call(this, destination, ...args);
      };
      window.AudioWorkletNode = class extends Worklet {constructor(...args) {super(...args);audit.worklets.push(this);}};
      audit.read = () => new Promise((resolve,reject) => {
        const node = audit.worklets.at(-1), id = --audit.nextId;
        if (!node) return reject(new Error('No HuC6280 worklet'));
        const timer = setTimeout(() => {node.port.removeEventListener('message',receive);reject(new Error('Audit read timeout'));},5000);
        function receive({data}) {
          if (data.id !== id) return;
          clearTimeout(timer);node.port.removeEventListener('message',receive);
          data.error ? reject(new Error(data.error)) : resolve(data.value);
        }
        node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method:'read',args:[]});
      });
      audit.sample = () => {
        const analyser = audit.analysers.at(-1);
        if (!analyser) return {rms:0,peak:0,finite:true};
        const values = new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);
        const mean = values.reduce((sum,value) => sum+value,0)/values.length;
        let squares=0,peak=0;
        for (const value of values) {squares+=(value-mean)**2;peak=Math.max(peak,Math.abs(value));}
        return {rms:Math.sqrt(squares/values.length),peak,finite:values.every(Number.isFinite)};
      };
    });
    const check = label => {stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
    const read = () => page.evaluate(() => window.audit.read());
    const wait = async predicate => {
      for (let i=0;i<120;i++) {const state=await read();if(predicate(state)) return state;await page.waitForTimeout(25);}
      throw new Error(`State did not settle: ${JSON.stringify(await read())}`);
    };
    const sound = () => page.waitForFunction(() => {const s=window.audit.sample();return s.finite&&s.rms>.0001;});
    const silent = () => page.waitForFunction(() => window.audit.sample().rms<.000001);
    const radio = (id,value) => page.locator(`#${id} [role="radio"][data-choice-value="${value}"]`);

    await page.goto(origin+config.entry);
    await page.waitForFunction(()=>document.querySelector('#voiceEditor canvas'));
    check('lazy audio, one canvas and passive raw BRR preparation');
    assert.match(await page.title(),/Tetorica S-DSP Synth/);
    assert.equal(await page.evaluate(()=>audit.contexts.length),0);
    assert.equal(await page.locator('#voiceEditor canvas').count(),1);
    await radio('source','brr').click();assert.equal(await page.locator('#keyboard .key:not([disabled])').count(),0);
    const rawBrr=Buffer.from([0xc0,0x77,0x66,0x44,0x22,0x0e,0xcc,0xaa,0x99,0xc3,0x99,0xaa,0xcc,0xee,0x02,0x44,0x66,0x77]);
    await page.locator('#brrFileInput').setInputFiles({name:'self-authored.brr',mimeType:'application/octet-stream',buffer:rawBrr});
    await page.waitForFunction(()=>document.querySelector('#importStatus').textContent.includes('Loaded'));
    assert.equal(await page.evaluate(()=>audit.contexts.length),0);
    assert.match(await page.locator('#sampleInfo').textContent(),/self-authored/);
    await page.locator('#resetPreset').click();
    check('real S-DSP with eight round-robin voices and safe stale release');
    await page.locator('#startAudio').click();await page.waitForFunction(()=>document.querySelector('#startAudio').textContent.includes('ready'));
    let state=await read();assert.equal(state.capacity,8);
    const keys=await page.locator('#keyboard .key:not([disabled])').evaluateAll(nodes=>[...new Set(nodes.map(n=>n.dataset.key))].slice(0,9));
    assert.equal(keys.length,9);
    for(const key of keys.slice(0,8))await page.keyboard.down(key);
    state=await wait(s=>s.voices.length===8);await sound();assert.equal(new Set(state.voices.map(v=>v.channel)).size,8);
    const stolen=state.voices[0].id;
    await page.keyboard.down(keys[8]);await wait(s=>s.voices.length===8&&!s.voices.some(v=>v.id===stolen));
    await page.keyboard.up(keys[0]);assert.equal((await read()).voices.length,8);
    for(const key of keys.slice(1))await page.keyboard.up(key);await wait(s=>s.voices.length===0);await silent();
    check('Master boost, synchronized Pitch, live level and hardware ADSR / five GAIN modes');
    await page.locator('#masterVolume').evaluate(n=>{n.value='3.8';n.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#masterVolumeValue').textContent(),'380%');assert.equal(await page.locator('#masterVolume').getAttribute('data-boosted'),'true');
    await page.locator('#masterVolume').evaluate(n=>{n.value='.7';n.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.keyboard.down(keys[1]);state=await wait(s=>s.voices.length===1);await sound();const owner=state.voices[0].id,generation=state.generation;
    await page.locator('[data-stepper-for="volumeLeft"][data-stepper-delta="1"]').click();state=await wait(s=>s.preset.volume.left===17);
    assert.equal(state.voices[0].id,owner);assert.equal(state.generation,generation);
    await page.locator('#pitchBend').evaluate(n=>{n.value='1';n.dispatchEvent(new Event('input',{bubbles:true}));});
    state=await wait(s=>s.pitch===1);assert.equal(state.voices[0].id,owner);assert.equal(await page.locator('#keyboardPitchBend').inputValue(),'1');
    await page.locator('#pitchBend').dispatchEvent('pointercancel');await wait(s=>s.pitch===0);
    await page.locator('[data-stepper-for="decay"][data-stepper-delta="1"]').click();state=await wait(s=>s.preset.envelope.decay===3);
    assert.equal(state.registers[state.voices[0].channel][5],0xbf);
    await radio('envelopeMode','gain').click();await wait(s=>s.preset.envelope.mode==='gain');
    for(const [mode,packed]of[['direct',96],['linear-decrease',144],['exponential-decrease',176],['linear-increase',208],['bent-increase',240]]) {
      await radio('gainMode',mode).click();state=await wait(s=>s.preset.envelope.gainMode===mode);
      assert.equal(state.registers[state.voices[0].channel][7],packed);assert.equal(state.voices[0].id,owner);
    }
    await page.keyboard.up(keys[1]);await wait(s=>s.voices.length===0);await silent();
    await page.locator('#resetPreset').click();await wait(s=>s.preset.envelope.mode==='adsr');
    check('wave drawing applies on release; cancelled strokes preserve held sound');
    await page.keyboard.down(keys[0]);state=await wait(s=>s.voices.length===1);const drawOwner=state.voices[0].id;
    const before=state.preset.wave,box=await page.locator('#waveCanvas').boundingBox();assert(box);
    await page.mouse.move(box.x+30,box.y+20);await page.mouse.down();await page.mouse.move(box.x+100,box.y+30);
    await page.locator('#waveCanvas').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();
    state=await read();assert.deepEqual(state.preset.wave,before);assert.equal(state.voices[0].id,drawOwner);
    await page.keyboard.up(keys[0]);await silent();
    await page.mouse.move(box.x+50,box.y+30);await page.mouse.down();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.8,{steps:9});await page.mouse.up();
    state=await wait(s=>JSON.stringify(s.preset.wave)!==JSON.stringify(before));assert.equal(state.preset.wave.length,128);
    assert(state.preset.wave.every(v=>Number.isFinite(v)&&v>=-1&&v<=1));assert.equal(state.voices.length,0);
    await page.locator('[data-wave-shape="triangle"]').click();
    state=await wait(s=>s.preset.wave[0]===-.75);const authored=state.preset;
    const saved=page.waitForEvent('download');await page.locator('#savePreset').click();
    assert.deepEqual(JSON.parse(await fs.readFile(await(await saved).path(),'utf8')),authored);
    await page.locator('#copyCode').click();assert.match(await page.locator('#codeOutput').inputValue(),/useSoundChip\('snes'\)/);
    await page.locator('#presetFileInput').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"format":"bad"}')});
    await page.waitForFunction(()=>document.querySelector('#audioStatus').dataset.error==='true');assert.deepEqual((await read()).preset,authored);
    check('WAV converts to bounded BRR; live tuning preserves owner and cached sample');
    await page.locator('#audioFileInput').setInputFiles({name:'original-sine.wav',mimeType:'audio/wav',buffer:makeWav()});
    await page.waitForFunction(()=>document.querySelector('#importStatus').textContent.includes('Loaded original-sine.wav'));
    state=await wait(s=>s.preset.source==='brr');assert.equal(state.preset.brr.basePitch,2048);assert.equal(state.preset.brr.rootNote,60);
    assert.equal(Object.hasOwn(state.preset.brr,'data'),false);assert(state.sample.frames>=80000);
    await page.locator('#loopBrr').check();await wait(s=>s.preset.brr.loopStartSamples===0);
    const transfers=await page.evaluate(()=>audit.presetMessages.filter(x=>x.dataLength>0).length);
    await page.keyboard.down(keys[0]);state=await wait(s=>s.voices.length===1);await sound();const sampleOwner=state.voices[0].id,sampleGeneration=state.generation;
    await page.locator('[data-stepper-for="rootNote"][data-stepper-delta="1"]').click();state=await wait(s=>s.preset.brr.rootNote===61);
    assert.equal(state.voices[0].id,sampleOwner);assert.equal(state.generation,sampleGeneration);
    await page.locator('[data-stepper-for="volumeRight"][data-stepper-delta="1"]').click();await wait(s=>s.preset.volume.right===17);
    assert.equal(await page.evaluate(()=>audit.presetMessages.filter(x=>x.dataLength>0).length),transfers);
    check('bad samples and cancelled preparation retain current BRR and held owner');
    const meta=(await read()).preset.brr;
    await page.locator('#brrFileInput').setInputFiles({name:'broken.brr',mimeType:'application/octet-stream',buffer:Buffer.of(1,2,3)});
    await page.waitForFunction(()=>document.querySelector('#importStatus').dataset.error==='true');
    state=await read();assert.equal(state.voices[0].id,sampleOwner);assert.deepEqual(state.preset.brr,meta);
    await page.evaluate(()=>{audit.readFile=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(...args){if(this.name!=='cancel.wav')return audit.readFile.apply(this,args);return new Promise((resolve,reject)=>{audit.releaseFile=()=>audit.readFile.apply(this,args).then(resolve,reject);});};});
    await page.locator('#audioFileInput').setInputFiles({name:'cancel.wav',mimeType:'audio/wav',buffer:makeWav()});
    await page.waitForFunction(()=>typeof audit.releaseFile==='function');await page.locator('#cancelImport').click();
    await page.evaluate(async()=>{await audit.releaseFile();File.prototype.arrayBuffer=audit.readFile;});
    state=await read();assert.equal(state.voices[0].id,sampleOwner);assert.deepEqual(state.preset.brr,meta);
    await page.keyboard.up(keys[0]);await silent();
    check('sample adoption closes Cancel before a delayed processor acknowledgement');
    await page.evaluate(()=>{audit.holdDdaCommit=true;});
    await page.locator('#audioFileInput').setInputFiles({name:'slow-commit.wav',mimeType:'audio/wav',buffer:makeWav()});
    await page.waitForFunction(()=>typeof audit.releaseDdaCommit==='function');
    assert.match(await page.locator('#importStatus').textContent(),/Applying/);assert.equal(await page.locator('#cancelImport').isVisible(),false);
    await page.evaluate(()=>audit.releaseDdaCommit());await page.waitForFunction(()=>document.querySelector('#importStatus').textContent.includes('Loaded slow-commit.wav'));
    state=await wait(s=>s.preset.brr.name==='slow-commit.wav');
    const brrDownload=page.waitForEvent('download');await page.locator('#savePreset').click();
    const brrSaved=JSON.parse(await fs.readFile(await(await brrDownload).path(),'utf8'));
    const brrData=Buffer.from(brrSaved.brr.data,'base64');assert(brrData.length>9&&brrData.length<=64512);
    assert.equal(brrData.length%9,0);assert(brrData[brrData.length-9]&1);
    await page.locator('#resetPreset').click();await wait(s=>s.preset.source==='wave');
    await page.locator('#presetFileInput').setInputFiles({name:'saved-sdsp.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(brrSaved))});
    await wait(s=>s.preset.source==='brr'&&s.preset.brr.name==='slow-commit.wav');
    await page.keyboard.down(keys[0]);await wait(s=>s.voices.length===1);await sound();await page.locator('#stopAudio').click();
    await wait(s=>s.voices.length===0);await silent();await page.keyboard.up(keys[0]);
    check('Stop, octave, focused controls, spectrum and narrow layout');
    await page.locator('#octaveUp').click();assert.equal((await page.locator('#octaveValue').textContent()).trim(),'+1');
    await page.locator('#loopBrr').focus();await page.keyboard.down(keys[1]);await wait(s=>s.voices.length===1);await page.keyboard.up(keys[1]);await silent();
    await page.locator('[data-visual-mode="spectrum"]').click();
    assert.equal(await page.locator('[data-visual-mode="spectrum"]').getAttribute('aria-pressed'),'true');
    if(config.screenshots)await page.screenshot({path:path.join(config.screenshots,`${name}-1180.png`),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(120);
    assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0);
    if(config.screenshots)await page.screenshot({path:path.join(config.screenshots,`${name}-390.png`),fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(external,[]);
    return {engine:name,ok:true,checks,errors,failed,external,sample:await page.evaluate(()=>audit.sample())};
  }catch(error){throw new Error(`${name} (${stage}): ${error.message}`,{cause:error});}
  finally{await browser.close();}
}

const server=http.createServer(async(req,res)=>{
  try {
    const file=path.resolve(config.root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(config.root+path.sep)) {res.writeHead(403);res.end();return;}
    const data=await fs.readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]??'application/octet-stream','cache-control':'no-store'});res.end(data);
  }catch {res.writeHead(404);res.end();}
});
(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    const origin=`http://127.0.0.1:${server.address().port}`,results=[];
    for(const [name,engine]of[['chromium',chromium],['webkit',webkit]]) results.push(await checkEngine(name,engine,origin));
    await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify({entry:config.entry,results},null,2)+'\n');
    console.log(`S-DSP Synth browser checks passed: ${config.out}`);
  }finally {await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
