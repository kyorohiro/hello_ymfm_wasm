// SPDX-License-Identifier: BSD-3-Clause
// Real HuC6280 WASM / AudioWorklet, with the final output muted during checks.
const {chromium, webkit} = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {gzipSync} = require('node:zlib');

// Self-authored register sequences; no commercial game files or recordings.
const vgmWave = Array.from({length:32},(_,i)=>i<8?31:i<16?3:i<24?20:8);
const secondWave = Array.from({length:32},(_,i)=>(i%4)*10);
const write = (register,value) => [0xb9,register,value];
const vgmWait = [0x61,0xe8,0x03];
function upload(channel,wave,{volume=24,balance=255}={}) {
  return [...write(0,channel),...write(4,64),...write(4,0),...wave.flatMap(value=>write(6,value)),
    ...write(5,balance),...write(2,254),...write(3,0),...write(7,0),...write(4,128|volume)];
}
function vgmBytes(commands,clock=3579545) {
  const bytes=Buffer.alloc(256+commands.length);bytes.write('Vgm ');
  bytes.writeUInt32LE(bytes.length-4,4);bytes.writeUInt32LE(0x171,8);
  bytes.writeUInt32LE(0xcc,0x34);bytes.writeUInt32LE(clock,0xa4);bytes.set(commands,256);return bytes;
}
function makeVgm() {
  return vgmBytes([...write(1,255),...write(9,0),...upload(0,vgmWave,{volume:25}),...vgmWait,
    ...write(2,120),...vgmWait,...write(4,0),...upload(2,secondWave,{volume:20,balance:247}),...vgmWait,
    ...write(4,0),...write(0,4),...write(5,255),...write(7,144),...write(4,151),...vgmWait,...write(4,0),0x66]);
}
function makePagedVgm() {
  const commands=[...write(1,255),...write(9,0)];
  for(let i=0;i<29;i++) commands.push(...upload(2,Array.from({length:32},(_,index)=>(index+i)%32)),...vgmWait,...write(4,0));
  return vgmBytes([...commands,0x66]);
}
function makeLongVgm() {
  const prefix=[...write(1,255),...write(9,0),...upload(0,vgmWave),...vgmWait];
  return vgmBytes(Buffer.concat([Buffer.from(prefix),Buffer.alloc(500_000,0x70),Buffer.from([0x66])]));
}

const config = {root:path.resolve(__dirname, '../docs'), entry:'/synth-huc6280/index.html',
  out:'/private/tmp/tetorica-huc6280-synth-browser.json', screenshots:null};
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
      const audit = window.audit = {contexts:[],worklets:[],analysers:[],nextId:0};
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
    await page.waitForFunction(() => document.querySelector('#voiceEditor canvas'));
    check('local assets, lazy audio and selected white icon');
    assert.match(await page.title(),/Tetorica HuC6280 Synth/);
    assert.equal(await page.evaluate(() => window.audit.contexts.length),0);
    assert(await page.locator('.product-icon').evaluate(img => img.complete&&img.naturalWidth===1254));
    check('VGM analysis is passive and the import control is discoverable');
    assert(await page.locator('#loadVgm').isVisible());
    await page.locator('#vgmFileInput').setInputFiles({name:'original-pce.vgm',mimeType:'application/octet-stream',buffer:makeVgm()});
    await page.waitForFunction(()=>document.querySelectorAll('[data-vgm-voice]').length===3);
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
    assert.equal(await page.locator('#instrumentName').inputValue(),'Sine');
    check('real AudioWorklet and six physical wave voices');
    await page.locator('#startAudio').click();
    await page.waitForFunction(() => document.querySelector('#startAudio').textContent.includes('ready'));
    let state=await read();assert.equal(state.capacity,6);
    // Derive actual performance keys rather than depending on one fret layout.
    const keys=await page.locator('#keyboard .key:not([disabled])').evaluateAll(nodes=>[...new Set(nodes.map(node=>node.dataset.key))].slice(0,7));
    assert.equal(keys.length,7);
    for(const key of keys.slice(0,6)) await page.keyboard.down(key);
    state=await wait(s=>s.voices.length===6);
    assert.equal(new Set(state.voices.map(v=>v.channel)).size,6);await sound();
    const oldest=state.voices[0].id;
    await page.keyboard.down(keys[6]);state=await wait(s=>s.voices.length===6&&!s.voices.some(v=>v.id===oldest));
    await page.keyboard.up(keys[0]);assert.equal((await read()).voices.length,6,'stolen release preserves replacement');
    for(const key of keys.slice(1)) await page.keyboard.up(key);
    await wait(s=>s.voices.length===0);await silent();
    check('Master boost, live pitch and two synchronized wheels');
    await page.locator('#masterVolume').evaluate(input=>{input.value='3.8';input.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#masterVolumeValue').textContent(),'380%');
    assert.equal(await page.locator('#masterVolume').getAttribute('data-boosted'),'true');
    await page.locator('#masterVolume').evaluate(input=>{input.value='.7';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.keyboard.down(keys[1]);state=await wait(s=>s.voices.length===1);const owner=state.voices[0].id;
    await page.locator('#pitchBend').evaluate(input=>{input.value='1.5';input.dispatchEvent(new Event('input',{bubbles:true}));});
    state=await wait(s=>s.pitch===1.5);assert.equal(state.voices[0].id,owner);
    assert.equal(await page.locator('#keyboardPitchBend').inputValue(),'1.5');
    await page.locator('#keyboardPitchBend').dispatchEvent('pointercancel');await wait(s=>s.pitch===0);
    assert.equal(await page.locator('#pitchBend').inputValue(),'0');await page.keyboard.up(keys[1]);await silent();
    check('noise uses CH5/CH6, changes clock live and retains musical key input');
    await radio('source','noise').click();await wait(s=>s.preset.source==='noise');
    await page.keyboard.down(keys[0]);await page.keyboard.down(keys[1]);
    state=await wait(s=>s.voices.length===2);assert.deepEqual(state.voices.map(v=>v.channel).sort(),[4,5]);await sound();
    const owners=state.voices.map(v=>v.id);
    await page.locator('[data-stepper-for="noiseFrequency"][data-stepper-delta="1"]').click();
    state=await wait(s=>s.preset.noise.frequency===17);assert.deepEqual(state.voices.map(v=>v.id),owners);
    assert(await page.locator('#pitchBend').isDisabled());
    await page.keyboard.up(keys[0]);await page.keyboard.up(keys[1]);await silent();
    await page.locator('#levelSection > summary').click();
    assert.equal(await page.locator('#levelSection').evaluate(node=>node.open),false);
    check('one waveform canvas, five-bit drawing and software/hardware labels');
    await radio('source','wave').click();await wait(s=>s.preset.source==='wave');
    assert.equal(await page.locator('#levelSection').evaluate(node=>node.open),false,'editing preserves collapsed sections');
    await page.locator('#levelSection > summary').click();
    assert.equal(await page.locator('#voiceEditor canvas').count(),1);
    const before=(await read()).preset.wave;
    const canvas=page.locator('#waveCanvas'),box=await canvas.boundingBox();
    assert(box);await page.mouse.move(box.x+box.width*.2,box.y+box.height*.25);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.6,box.y+box.height*.7,{steps:12});await page.mouse.up();
    state=await wait(s=>JSON.stringify(s.preset.wave)!==JSON.stringify(before));
    assert.equal(state.preset.wave.length,32);assert(state.preset.wave.every(v=>Number.isInteger(v)&&v>=0&&v<=31));
    assert.match(await page.locator('#voiceEditor').textContent(),/Software.*[Ee]nvelope/);
    check('cancelled waveform strokes retain the original data and held note');
    const committed=state.preset.wave;
    await page.keyboard.down(keys[0]);state=await wait(s=>s.voices.length===1);const cancelledOwner=state.voices[0].id;
    await canvas.evaluate(node=>node.addEventListener('pointerdown',event=>{window.audit.pointerId=event.pointerId;},{once:true}));
    await page.mouse.move(box.x+box.width*.3,box.y+box.height*.3);await page.mouse.down();
    await canvas.dispatchEvent('pointercancel',{pointerId:await page.evaluate(()=>window.audit.pointerId)});await page.mouse.up();
    state=await read();assert.deepEqual(state.preset.wave,committed);assert.equal(state.voices[0].id,cancelledOwner);
    await page.keyboard.up(keys[0]);await silent();
    check('hardware LFO reserves CH2 for mono carrier, and live rate retains ownership');
    await page.locator('[data-wave-target="lfo"]').click();
    const main=state.preset.wave;
    await page.locator('[data-wave-shape="square"]').click();
    state=await wait(s=>s.preset.lfo.wave.filter(v=>v===31).length===16);assert.deepEqual(state.preset.wave,main);
    await page.locator('#lfoEnabled').check();await wait(s=>s.capacity===1&&s.preset.lfo.enabled);
    await page.keyboard.down(keys[0]);state=await wait(s=>s.voices.length===1);assert.equal(state.voices[0].channel,0);await sound();
    const lfoOwner=state.voices[0].id;
    await page.locator('[data-stepper-for="lfoFrequency"][data-stepper-delta="1"]').click();
    state=await wait(s=>s.preset.lfo.frequency===33);assert.equal(state.voices[0].id,lfoOwner);
    await page.keyboard.down(keys[1]);state=await wait(s=>s.voices.length===1&&s.voices[0].id!==lfoOwner);
    await page.keyboard.up(keys[0]);assert.equal((await read()).voices.length,1);
    await page.keyboard.up(keys[1]);await silent();
    check('preset save, atomic rejected import, round trip and Playground code');
    const downloadPromise=page.waitForEvent('download');await page.locator('#savePreset').click();const download=await downloadPromise;
    const saved=JSON.parse(await fs.readFile(await download.path(),'utf8'));
    assert.equal(saved.format,'tetorica-huc6280-voice');assert.equal(saved.lfo.enabled,true);
    await page.locator('#presetFileInput').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"format":"wrong"}')});
    await page.waitForFunction(()=>document.querySelector('#audioStatus').dataset.error==='true');
    assert.deepEqual((await read()).preset,saved);
    await page.locator('#resetPreset').click();await wait(s=>!s.preset.lfo.enabled);
    await page.locator('#presetFileInput').setInputFiles({name:'voice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
    state=await wait(s=>s.preset.lfo.enabled);assert.deepEqual(state.preset,saved);
    await page.locator('#copyCode').click();assert.match(await page.locator('#codeOutput').inputValue(),/pce\.setWaveform/);
    check('VGM voice selection, exact wave bytes, editing and preset round trip');
    await page.locator('[data-vgm-voice="1"]').click();
    state=await wait(s=>JSON.stringify(s.preset.wave)===JSON.stringify(vgmWave)&&s.preset.volume===25);
    assert.equal(state.preset.envelope.enabled,false);assert.equal(state.preset.lfo.enabled,false);
    assert.equal(state.capacity,6);assert.equal(state.voices.length,0);
    assert.equal(await page.locator('[data-vgm-voice="1"]').getAttribute('aria-pressed'),'true');
    await page.keyboard.down(keys[0]);await wait(s=>s.voices.length===1);await sound();await page.keyboard.up(keys[0]);await silent();
    await page.locator('[data-wave-target="main"]').click();await page.locator('[data-wave-shape="saw"]').click();
    await wait(s=>JSON.stringify(s.preset.wave)!==JSON.stringify(vgmWave));
    assert.equal(await page.locator('[data-vgm-voice][aria-pressed="true"]').count(),0);
    await page.locator('[data-vgm-voice="1"]').click();state=await wait(s=>JSON.stringify(s.preset.wave)===JSON.stringify(vgmWave));
    const imported=state.preset,saveImport=page.waitForEvent('download');await page.locator('#savePreset').click();
    assert.deepEqual(JSON.parse(await fs.readFile(await(await saveImport).path(),'utf8')),imported);
    await page.locator('#resetPreset').click();await wait(s=>s.preset.name==='Sine');
    await page.locator('#presetFileInput').setInputFiles({name:'imported.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
    await wait(s=>JSON.stringify(s.preset)===JSON.stringify(imported));
    check('VGM files, failures, VGZ and cancelled analysis retain held sound');
    await page.keyboard.down(keys[0]);state=await wait(s=>s.voices.length===1);const importOwner=state.voices[0].id;
    await page.locator('#vgmFileInput').setInputFiles({name:'wrong-chip.vgm',mimeType:'application/octet-stream',buffer:vgmBytes([0x66],0)});
    await page.waitForFunction(()=>document.querySelector('#vgmStatus').dataset.error==='true');
    state=await read();assert.equal(state.voices[0].id,importOwner);assert.deepEqual(state.preset,imported);
    await page.locator('#vgmFileInput').setInputFiles({name:'compressed.vgz',mimeType:'application/gzip',buffer:gzipSync(makeVgm())});
    await page.waitForFunction(()=>document.querySelector('#vgmFileName').textContent==='compressed.vgz');
    state=await read();assert.equal(state.voices[0].id,importOwner);assert.deepEqual(state.preset,imported);
    check('late file reads cannot replace the newer library or current instrument');
    await page.evaluate(()=>{
      window.audit.originalFileRead=File.prototype.arrayBuffer;
      File.prototype.arrayBuffer=function(...args) {
        if(this.name!=='stale.vgm') return window.audit.originalFileRead.apply(this,args);
        return new Promise((resolve,reject)=>{
          window.audit.releaseStale=()=>window.audit.originalFileRead.apply(this,args).then(resolve,reject);
        });
      };
    });
    await page.locator('#vgmFileInput').setInputFiles({name:'stale.vgm',mimeType:'application/octet-stream',buffer:makePagedVgm()});
    await page.waitForFunction(()=>typeof window.audit.releaseStale==='function');
    await page.locator('#vgmFileInput').setInputFiles({name:'newer.vgz',mimeType:'application/gzip',buffer:gzipSync(makeVgm())});
    await page.waitForFunction(()=>document.querySelector('#vgmFileName').textContent==='newer.vgz');
    await page.evaluate(async()=>{await window.audit.releaseStale();File.prototype.arrayBuffer=window.audit.originalFileRead;});
    assert.equal(await page.locator('#vgmFileName').textContent(),'newer.vgz');
    state=await read();assert.equal(state.voices[0].id,importOwner);assert.deepEqual(state.preset,imported);
    await page.locator('#vgmFileInput').setInputFiles({name:'long.vgm',mimeType:'application/octet-stream',buffer:makeLongVgm()});
    await page.locator('#cancelVgm').click();
    await page.waitForFunction(()=>document.querySelector('#vgmStatus').textContent.includes('cancelled'));
    await page.waitForTimeout(70);state=await read();assert.equal(state.voices[0].id,importOwner);assert.deepEqual(state.preset,imported);
    assert.equal(await page.locator('#vgmFileName').textContent(),'newer.vgz');
    await page.keyboard.up(keys[0]);await silent();
    check('Wave/Noise filters, paging and selection preserve performance keys');
    await page.locator('[data-vgm-filter="noise"]').click();assert.equal(await page.locator('[data-vgm-voice]').count(),1);
    await page.locator('[data-vgm-voice]').click();state=await wait(s=>s.preset.source==='noise'&&s.preset.noise.frequency===16);
    assert.equal(state.preset.volume,23);assert.equal(state.capacity,2);
    await page.keyboard.down(keys[0]);await wait(s=>s.voices.length===1);await sound();await page.keyboard.up(keys[0]);await silent();
    await page.locator('#vgmFileInput').setInputFiles({name:'many-waves.vgm',mimeType:'application/octet-stream',buffer:makePagedVgm()});
    await page.waitForFunction(()=>document.querySelector('#vgmFileName').textContent==='many-waves.vgm');
    assert.equal(await page.locator('[data-vgm-voice]').count(),24);await page.locator('#vgmNext').click();
    assert.equal(await page.locator('[data-vgm-voice]').count(),5);await page.locator('#vgmPrevious').click();
    assert.equal(await page.locator('[data-vgm-voice]').count(),24);
    await page.locator('[data-vgm-voice]').first().click();await wait(s=>s.preset.source==='wave');
    await page.keyboard.down(keys[0]);state=await wait(s=>s.voices.length===1);const closedOwner=state.voices[0].id;
    await page.locator('#closeVgm').click();state=await read();assert.equal(state.voices[0].id,closedOwner);
    await page.keyboard.up(keys[0]);await silent();
    check('Stop, octave, focused controls, spectrum and narrow layout');
    await page.locator('#stopAudio').click();await wait(s=>s.voices.length===0);await silent();
    await page.locator('#octaveUp').click();assert.equal((await page.locator('#octaveValue').textContent()).trim(),'+1');
    await page.locator('#lfoEnabled').focus();await page.keyboard.down(keys[0]);await wait(s=>s.voices.length===1);await page.keyboard.up(keys[0]);await silent();
    await page.keyboard.down(keys[0]);await wait(s=>s.voices.length===1);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await wait(s=>s.voices.length===0);await silent();await page.keyboard.up(keys[0]);
    await page.locator('[data-visual-mode="spectrum"]').click();
    assert.equal(await page.locator('[data-visual-mode="spectrum"]').getAttribute('aria-pressed'),'true');
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(120);
    await page.locator('#vgmFileInput').setInputFiles({name:'mobile.vgm',mimeType:'application/octet-stream',buffer:makeVgm()});
    await page.waitForFunction(()=>document.querySelectorAll('[data-vgm-voice]').length===3);
    assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0);
    if(config.screenshots) {await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-390.png`),fullPage:true});}
    await page.setViewportSize({width:1180,height:1000});await page.locator('#resetPreset').click();await wait(s=>!s.preset.lfo.enabled);
    if(config.screenshots) await page.screenshot({path:path.join(config.screenshots,`${name}-1180.png`),fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(external,[]);
    return {engine:name,ok:true,checks,errors,failed,external,sample:await page.evaluate(()=>window.audit.sample())};
  }catch(error) {throw new Error(`${name} (${stage}): ${error.message}`,{cause:error});}
  finally {await browser.close();}
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
    console.log(`HuC6280 Synth browser checks passed: ${config.out}`);
  }finally {await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
