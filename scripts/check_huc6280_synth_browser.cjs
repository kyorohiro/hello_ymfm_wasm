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
const lfoWave = Array.from({length:32},(_,i)=>(i*7)%32);
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
function period(channel,value) {
  const raw=value===4096?0:value;
  return [...write(0,channel),...write(2,raw&255),...write(3,raw>>8)];
}
function makeLfoVgm() {
  return vgmBytes([...write(1,255),...write(9,0),...upload(0,vgmWave,{volume:25,balance:253}),...period(0,700),
    ...upload(1,lfoWave,{volume:19,balance:223}),...period(1,913),...write(8,7),...write(9,2),...vgmWait,
    ...write(0,0),...write(4,25),...write(0,1),...write(4,19),0x66]);
}
const streamPcm=Buffer.from(Array.from({length:3500},(_,i)=>0xe0|Math.round(15.5+15.5*Math.sin(i*Math.PI/16))));
function makePcmVgm({missing=false}={}) {
  const block=Buffer.alloc(7);block.set([0x67,0x66,missing?6:5]);block.writeUInt32LE(streamPcm.length,3);
  const frequency=Buffer.alloc(6);frequency.set([0x92,0]);frequency.writeUInt32LE(7000,2);
  const setup=[...write(1,255),...write(9,0),...write(0,2),...write(5,0xbd),...write(4,0xc0|22),
    0x90,0,0x1b,2,6,0x91,0,5,1,0];
  return vgmBytes(Buffer.concat([block,streamPcm,Buffer.from(setup),frequency,
    Buffer.from([0x95,0,0,0,1,0x61,0x44,0xac,0x94,0,0x66])]));
}
const directPcm=Buffer.from(Array.from({length:2205},(_,i)=>0xe0|Math.round(15.5+15.5*Math.sin(i*Math.PI/12))));
function makeDirectPcmVgm({irregular=false}={}) {
  const commands=[...write(1,255),...write(9,0),...write(0,3),...write(5,0xcb),...write(4,0xc0|23)];
  for(let index=0;index<directPcm.length;index++) commands.push(...write(6,directPcm[index]),irregular&&index===12?0x76:0x77);
  return vgmBytes([...commands,...write(4,0),0x66]);
}
function makePcmVolumeVariantsVgm() {
  const block=Buffer.alloc(7);block.set([0x67,0x66,5]);block.writeUInt32LE(streamPcm.length,3);
  const commands=[...write(1,255),...write(9,0),0x90,0,0x1b,2,6,0x91,0,5,1,0];
  for(const [volume,pan,rate]of[[12,0xcb,7000],[27,0xcb,7000],[20,0xcb,7000],[27,0xbd,7000],[27,0xcb,8000]]) {
    commands.push(...write(0,2),...write(5,pan),...write(4,0xc0|volume),0x92,0,rate&255,rate>>8,0,0,
      0x95,0,0,0,1,0x61,0x44,0xac,0x94,0,...write(4,0));
  }
  for(const [wave,volume,balance]of[[vgmWave,23,255],[vgmWave,24,255],[vgmWave,24,0xbd],[secondWave,24,255]]) {
    commands.push(...upload(0,wave,{volume,balance}),...vgmWait,...write(4,0));
  }
  commands.push(0x66);
  return vgmBytes(Buffer.concat([block,streamPcm,Buffer.from(commands)]));
}
function makeWav() {
  const rate=44100,frames=rate*5,channels=2,bytes=Buffer.alloc(44+frames*channels*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
  bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(channels,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*channels*2,28);
  bytes.writeUInt16LE(channels*2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
  for(let i=0;i<frames;i++) for(let ch=0;ch<channels;ch++) bytes.writeInt16LE(Math.round(Math.sin(i/rate*Math.PI*2*220)*(ch===0?.6:.3)*32767),44+(i*channels+ch)*2);
  return bytes;
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
          dataLength:data.args?.[0]?.dda?.data?.length??0,elided:data.ddaDataUnchanged===true});
        if(audit.holdDdaCommit&&data?.method==='loadPreset'&&data.args?.[0]?.dda?.name==='slow-commit.wav') {
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
    await page.waitForFunction(() => document.querySelector('#voiceEditor canvas'));
    check('local assets, lazy audio and selected white icon');
    assert.match(await page.title(),/Tetorica HuC6280 Synth/);
    assert.equal(await page.evaluate(() => window.audit.contexts.length),0);
    assert(await page.locator('.product-icon').evaluate(img => img.complete&&img.naturalWidth===1254));
    check('VGM analysis is passive and the import control is discoverable');
    assert(await page.locator('#loadVgm').isVisible());
    assert.equal(await page.locator('#vgmKeepLoudestPcm').isChecked(),false);
    await page.locator('#vgmFileInput').setInputFiles({name:'original-pce.vgm',mimeType:'application/octet-stream',buffer:makeVgm()});
    await page.waitForFunction(()=>document.querySelectorAll('[data-vgm-voice]').length===3);
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
    assert.equal(await page.locator('#instrumentName').inputValue(),'Sine');
    check('WAV conversion is passive, bounded five-bit PCM and needs no audio device');
    await radio('source','dda').click();assert(await page.locator('#loadDdaAudio').isVisible());
    assert.equal(await page.locator('#keyboard .key:not([disabled])').count(),0);
    await page.locator('#ddaAudioFileInput').setInputFiles({name:'dac-test.wav',mimeType:'audio/wav',buffer:makeWav()});
    await page.waitForFunction(()=>document.querySelector('#ddaLoadStatus').textContent.includes('Loaded'));
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
    assert((await page.locator('#ddaInfo').textContent()).includes('dac-test.wav'));
    await page.locator('#resetPreset').click();await page.waitForFunction(()=>document.querySelector('#source [data-choice-value="wave"]').getAttribute('aria-checked')==='true');
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
    assert.equal(await page.locator('#waveSection canvas').count(),1);
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
    check('VGM LFO pair preserves original periods, waves, rate, depth and CH2 output');
    await page.locator('#vgmFileInput').setInputFiles({name:'paired-lfo.vgz',mimeType:'application/gzip',buffer:gzipSync(makeLfoVgm())});
    await page.waitForFunction(()=>document.querySelector('#vgmFileName').textContent==='paired-lfo.vgz');
    await page.locator('[data-vgm-filter="lfo"]').click();assert.equal(await page.locator('[data-vgm-voice]').count(),1);
    await page.locator('[data-vgm-voice]').click();
    state=await wait(s=>s.preset.lfo.enabled&&s.preset.lfo.mode==='recorded');
    assert.equal(state.preset.version,3);assert.deepEqual(state.preset.wave,vgmWave);assert.deepEqual(state.preset.lfo.wave,lfoWave);
    assert.equal(state.preset.lfo.carrierPeriod,700);assert.equal(state.preset.lfo.modulatorPeriod,913);
    assert.equal(state.preset.lfo.frequency,7);assert.equal(state.preset.lfo.depth,2);assert.equal(state.preset.lfo.reset,false);
    assert.deepEqual(state.preset.lfo.output,{enabled:true,volume:19,pan:{left:13,right:15}});
    const c4=await page.locator('#keyboard .key').evaluateAll(nodes=>nodes.find(node=>node.querySelector('span')?.textContent==='C4')?.dataset.key);
    assert(c4,'keyboard exposes the C4 original-pitch trigger');
    await page.keyboard.down(c4);state=await wait(s=>s.voices.length===1);await sound();
    const lfoNote=state.voices[0].id;
    const regPeriod=(s,ch)=>(s.registers[ch][2]|((s.registers[ch][3]&15)<<8))||4096;
    assert.equal(regPeriod(state,0),700);assert.equal(regPeriod(state,1),913);assert(state.registers[1][4]&128);
    await page.locator('#pitchBend').evaluate(input=>{input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}));});
    state=await wait(s=>s.pitch===1);assert.equal(regPeriod(state,0),Math.round(700/2**(1/12)));assert.equal(regPeriod(state,1),913);
    assert.equal(state.voices[0].id,lfoNote);
    await page.locator('#pitchBend').dispatchEvent('pointercancel');await wait(s=>s.pitch===0);
    check('recorded LFO controls update held notes and pair releases to silence');
    await page.locator('[data-stepper-for="lfoModulatorPeriod"][data-stepper-delta="1"]').click();
    state=await wait(s=>s.preset.lfo.modulatorPeriod===914);assert.equal(regPeriod(state,1),914);assert.equal(state.voices[0].id,lfoNote);
    await page.locator('[data-stepper-for="lfoOutputVolume"][data-stepper-delta="1"]').click();
    state=await wait(s=>s.preset.lfo.output.volume===20);assert.equal(state.registers[1][4]&31,20);
    await page.locator('#lfoReset').check();state=await wait(s=>s.preset.lfo.reset);assert(state.globals[9]&128);assert.equal(state.voices[0].id,lfoNote);
    await page.locator('#lfoReset').uncheck();await wait(s=>!s.preset.lfo.reset);
    await page.keyboard.up(c4);await wait(s=>s.voices.length===0);await silent();
    state=await read();assert.equal(state.registers[0][4]&128,0);assert.equal(state.registers[1][4]&128,0);
    check('LFO pair wave editing, preset v2 round trip and v1 migration');
    await page.locator('[data-wave-target="lfo"]').click();await page.locator('[data-wave-shape="triangle"]').click();
    state=await wait(s=>JSON.stringify(s.preset.lfo.wave)!==JSON.stringify(lfoWave));assert.deepEqual(state.preset.wave,vgmWave);
    assert.equal(await page.locator('#waveSection canvas').count(),1);
    const pairedPreset=state.preset,pairedSave=page.waitForEvent('download');await page.locator('#savePreset').click();
    assert.deepEqual(JSON.parse(await fs.readFile(await(await pairedSave).path(),'utf8')),pairedPreset);
    await page.locator('#copyCode').click();
    const pairedCode=await page.locator('#codeOutput').inputValue();assert.match(pairedCode,/pce\.writeRegister/);
    const legacy={...pairedPreset,version:1,lfo:{enabled:true,frequency:7,depth:2,wave:pairedPreset.lfo.wave}};delete legacy.dda;
    await page.locator('#presetFileInput').setInputFiles({name:'legacy-v1.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
    state=await wait(s=>s.preset.lfo.mode==='follow'&&!s.preset.lfo.output.enabled);assert.equal(state.preset.version,3);
    await page.keyboard.down(c4);state=await wait(s=>s.voices.length===1);
    assert.equal(regPeriod(state,0),regPeriod(state,1));assert.equal(state.registers[1][4]&128,0);
    await page.keyboard.up(c4);await silent();
    const legacyV2={...pairedPreset,version:2};delete legacyV2.dda;
    await page.locator('#presetFileInput').setInputFiles({name:'paired-v2.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacyV2))});
    await wait(s=>JSON.stringify(s.preset)===JSON.stringify(pairedPreset));
    check('VGM DAC streams import exact five-bit PCM, low recorded rate, Loop and channel mix');
    await page.locator('#vgmFileInput').setInputFiles({name:'stream-pcm.vgz',mimeType:'application/gzip',buffer:gzipSync(makePcmVgm())});
    await page.waitForFunction(()=>document.querySelector('#vgmFileName').textContent==='stream-pcm.vgz');
    assert.deepEqual((await read()).preset,pairedPreset,'analysis retains the instrument');
    await page.locator('[data-vgm-filter="pcm"]').click();assert.equal(await page.locator('[data-vgm-voice]').count(),1);
    assert.match(await page.locator('[data-vgm-voice] small').textContent(),/7,000 Hz/);
    await page.locator('[data-vgm-voice]').click();
    state=await wait(s=>s.preset.source==='dda'&&s.preset.dda.sampleRate===7000);
    assert.equal(state.dda.samples,streamPcm.length);assert.equal(state.preset.dda.rootNote,60);
    assert.equal(state.preset.dda.loop,true);assert.equal(state.preset.dda.speed,1);
    assert.equal(state.preset.envelope.enabled,false);assert.equal(state.preset.volume,22);
    assert(!((await page.locator('#ddaLoadStatus').textContent()).includes('dac-test.wav')),'external PCM selection clears stale audio-import status');
    assert.deepEqual(state.preset.pan,{left:11,right:13});assert(await page.locator('#ddaCanvas').isVisible());
    await page.keyboard.down(c4);state=await wait(s=>s.voices.length===1);await sound();
    const pcmOwner=state.voices[0].id;
    await page.locator('[data-vgm-filter="all"]').click();assert.equal((await read()).voices[0].id,pcmOwner);
    await page.locator('[data-stepper-for="ddaRate"][data-stepper-delta="1"]').click();
    state=await wait(s=>s.preset.dda.sampleRate===7001);assert.equal(state.voices[0].id,pcmOwner);
    await page.locator('[data-stepper-for="ddaRate"][data-stepper-delta="-1"]').click();await wait(s=>s.preset.dda.sampleRate===7000);
    check('unsupported PCM streams keep the held sound and imported PCM round trips through JSON');
    await page.locator('#vgmFileInput').setInputFiles({name:'missing-bank.vgm',mimeType:'application/octet-stream',buffer:makePcmVgm({missing:true})});
    await page.waitForFunction(()=>document.querySelector('#vgmStatus').dataset.error==='true');
    assert.equal((await read()).voices[0].id,pcmOwner);assert.equal(await page.locator('#vgmFileName').textContent(),'stream-pcm.vgz');
    await page.keyboard.up(c4);await wait(s=>s.voices.length===0);await silent();
    const pcmDownload=page.waitForEvent('download');await page.locator('#savePreset').click();
    const pcmSaved=JSON.parse(await fs.readFile(await(await pcmDownload).path(),'utf8'));
    assert.deepEqual(Buffer.from(pcmSaved.dda.data,'base64'),Buffer.from(streamPcm.map(value=>value&31)));
    await page.locator('#resetPreset').click();await wait(s=>s.preset.source==='wave');
    await page.locator('#presetFileInput').setInputFiles({name:'vgm-pcm.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pcmSaved))});
    await wait(s=>s.preset.source==='dda'&&s.preset.dda.sampleRate===7000&&s.dda.samples===streamPcm.length);
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(120);
    assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0);
    if(config.screenshots)await page.screenshot({path:path.join(config.screenshots,`${name}-vgm-pcm-390.png`),fullPage:true});
    await page.setViewportSize({width:1180,height:1000});await page.waitForTimeout(120);
    if(config.screenshots)await page.screenshot({path:path.join(config.screenshots,`${name}-vgm-pcm-1180.png`),fullPage:true});
    check('Direct DAC PCM imports uniform writes with exact fractional rate and explicit one-shot boundaries');
    const beforeDirect=(await read()).preset;
    await page.locator('#vgmFileInput').setInputFiles({name:'direct-pcm.vgz',mimeType:'application/gzip',buffer:gzipSync(makeDirectPcmVgm())});
    await page.waitForFunction(()=>document.querySelector('#vgmFileName').textContent==='direct-pcm.vgz');
    assert.deepEqual((await read()).preset,beforeDirect,'direct PCM analysis retains the instrument');
    await page.locator('[data-vgm-filter="pcm"]').click();assert.equal(await page.locator('[data-vgm-voice]').count(),1);
    assert.match(await page.locator('[data-vgm-voice] small').textContent(),/Direct DAC/);
    assert.match(await page.locator('[data-vgm-voice] small').textContent(),/5,512\.5 Hz/);
    await page.locator('[data-vgm-voice]').click();state=await wait(s=>s.preset.source==='dda'&&s.preset.dda.sampleRate===5512.5);
    assert.equal(state.dda.samples,directPcm.length);assert.equal(state.preset.dda.loop,false);
    assert.equal(state.preset.dda.rootNote,60);assert.equal(state.preset.dda.speed,1);assert.equal(state.preset.volume,23);
    assert.deepEqual(state.preset.pan,{left:12,right:11});assert.equal(state.preset.envelope.enabled,false);
    assert.equal(await page.locator('#ddaRate').textContent(),'5512.5');
    await page.keyboard.down(c4);await wait(s=>s.voices.length===1);await sound();
    await wait(s=>s.dda.voices.some(v=>v.ended));await silent();
    await page.keyboard.up(c4);await wait(s=>s.voices.length===0);
    await page.locator('#ddaLoop').check();await wait(s=>s.preset.dda.loop);
    await page.keyboard.down(c4);state=await wait(s=>s.voices.length===1);await sound();const directOwner=state.voices[0].id;
    await page.locator('[data-stepper-for="ddaRate"][data-stepper-delta="1"]').click();
    state=await wait(s=>s.preset.dda.sampleRate===5513.5);assert.equal(state.voices[0].id,directOwner);
    await page.locator('[data-stepper-for="ddaRate"][data-stepper-delta="-1"]').click();await wait(s=>s.preset.dda.sampleRate===5512.5);
    check('irregular direct writes are omitted without changing held PCM and fractional-rate JSON is portable');
    await page.locator('#vgmFileInput').setInputFiles({name:'irregular-direct.vgm',mimeType:'application/octet-stream',buffer:makeDirectPcmVgm({irregular:true})});
    await page.waitForFunction(()=>document.querySelector('#vgmStatus').dataset.error==='true');
    assert.equal((await read()).voices[0].id,directOwner);assert.equal(await page.locator('#vgmFileName').textContent(),'direct-pcm.vgz');
    await page.keyboard.up(c4);await wait(s=>s.voices.length===0);await silent();
    const directDownload=page.waitForEvent('download');await page.locator('#savePreset').click();
    const directSaved=JSON.parse(await fs.readFile(await(await directDownload).path(),'utf8'));
    assert.equal(directSaved.dda.sampleRate,5512.5);
    assert.deepEqual(Buffer.from(directSaved.dda.data,'base64'),Buffer.from(directPcm.map(value=>value&31)));
    await page.locator('#resetPreset').click();await wait(s=>s.preset.source==='wave');
    await page.locator('#presetFileInput').setInputFiles({name:'direct-pcm.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(directSaved))});
    await wait(s=>s.preset.source==='dda'&&s.preset.dda.sampleRate===5512.5&&s.dda.samples===directPcm.length);
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(120);
    assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0);
    if(config.screenshots)await page.screenshot({path:path.join(config.screenshots,`${name}-direct-pcm-390.png`),fullPage:true});
    await page.setViewportSize({width:1180,height:1000});await page.waitForTimeout(120);
    if(config.screenshots)await page.screenshot({path:path.join(config.screenshots,`${name}-direct-pcm-1180.png`),fullPage:true});
    check('DDA plays six hardware DAC channels, changes speed/pitch live and elides cached PCM');
    await radio('source','dda').click();
    await page.locator('#ddaAudioFileInput').setInputFiles({name:'dac-test.wav',mimeType:'audio/wav',buffer:makeWav()});
    await page.waitForFunction(()=>document.querySelector('#ddaLoadStatus').textContent.includes('Loaded'));
    state=await wait(s=>s.preset.source==='dda'&&s.dda.samples>0);
    assert.equal(state.capacity,6);assert.equal(state.preset.dda.sampleRate,11025);
    assert.equal(Object.hasOwn(state.preset.dda,'data'),false,'large PCM omitted from processor replies');
    await page.locator('#ddaLoop').check();await wait(s=>s.preset.dda.loop);
    const fullTransfers=await page.evaluate(()=>window.audit.presetMessages.filter(m=>m.dataLength>0).length);
    for(const key of keys.slice(0,6))await page.keyboard.down(key);
    state=await wait(s=>s.voices.length===6);await sound();
    const ddaOwners=state.voices.map(v=>v.id);
    for(const channel of state.voices.map(v=>v.channel))assert.equal(state.registers[channel][4]&192,192);
    assert.equal(state.globals[9]&3,0,'DDA does not use hardware LFO');
    await page.locator('[data-stepper-for="ddaSpeed"][data-stepper-delta="1"]').click();
    state=await wait(s=>s.preset.dda.speed===1.125);assert.deepEqual(state.voices.map(v=>v.id),ddaOwners);
    await page.locator('[data-stepper-for="ddaRootNote"][data-stepper-delta="1"]').click();
    state=await wait(s=>s.preset.dda.rootNote===61);assert.deepEqual(state.voices.map(v=>v.id),ddaOwners);
    await page.locator('[data-stepper-for="ddaRate"][data-stepper-delta="1"]').click();await wait(s=>s.preset.dda.sampleRate===11026);
    await page.locator('#pitchBend').evaluate(input=>{input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}));});
    state=await wait(s=>s.pitch===1);assert.deepEqual(state.voices.map(v=>v.id),ddaOwners);await sound();
    await page.locator('#pitchBend').dispatchEvent('pointercancel');await wait(s=>s.pitch===0);
    assert.equal(await page.evaluate(()=>window.audit.presetMessages.filter(m=>m.dataLength>0).length),fullTransfers,'parameter edits do not resend PCM');
    await page.keyboard.down(keys[6]);await wait(s=>s.voices.length===6&&!s.voices.some(v=>v.id===ddaOwners[0]));
    await page.keyboard.up(keys[0]);assert.equal((await read()).voices.length,6);
    for(const key of keys.slice(1))await page.keyboard.up(key);await wait(s=>s.voices.length===0);await silent();
    check('DDA invalid/cancelled audio retains the current PCM and held owner');
    await page.keyboard.down(c4);state=await wait(s=>s.voices.length===1);const ddaOwner=state.voices[0].id,ddaMeta=state.preset.dda;
    await page.locator('#ddaAudioFileInput').setInputFiles({name:'broken.wav',mimeType:'audio/wav',buffer:Buffer.from('not a WAV')});
    await page.waitForFunction(()=>document.querySelector('#ddaLoadStatus').dataset.error==='true');
    state=await read();assert.equal(state.voices[0].id,ddaOwner);assert.deepEqual(state.preset.dda,ddaMeta);
    await page.evaluate(()=>{
      window.audit.audioFileRead=File.prototype.arrayBuffer;
      File.prototype.arrayBuffer=function(...args) {
        if(this.name!=='cancel.wav') return window.audit.audioFileRead.apply(this,args);
        return new Promise((resolve,reject)=>{window.audit.releaseAudio=()=>window.audit.audioFileRead.apply(this,args).then(resolve,reject);});
      };
    });
    await page.locator('#ddaAudioFileInput').setInputFiles({name:'cancel.wav',mimeType:'audio/wav',buffer:makeWav()});
    await page.waitForFunction(()=>typeof window.audit.releaseAudio==='function');await page.locator('#cancelDdaAudio').click();
    await page.evaluate(async()=>{await window.audit.releaseAudio();File.prototype.arrayBuffer=window.audit.audioFileRead;});
    state=await read();assert.equal(state.voices[0].id,ddaOwner);assert.deepEqual(state.preset.dda,ddaMeta);
    await page.keyboard.up(c4);await silent();
    check('DDA commit stage disables cancellation before a delayed Worklet acknowledgement');
    await page.evaluate(()=>{window.audit.holdDdaCommit=true;});
    await page.locator('#ddaAudioFileInput').setInputFiles({name:'slow-commit.wav',mimeType:'audio/wav',buffer:makeWav()});
    await page.waitForFunction(()=>typeof window.audit.releaseDdaCommit==='function');
    assert.match(await page.locator('#ddaLoadStatus').textContent(),/Applying/);
    assert.equal(await page.locator('#cancelDdaAudio').isVisible(),false);
    await page.evaluate(()=>window.audit.releaseDdaCommit());
    await page.waitForFunction(()=>document.querySelector('#ddaLoadStatus').textContent.includes('Loaded slow-commit.wav'));
    await wait(s=>s.preset.dda.name==='slow-commit.wav');
    check('one-shot DDA ends at silence, retains key ownership and round trips PCM in JSON');
    await page.locator('#ddaLoop').uncheck();await wait(s=>!s.preset.dda.loop);
    await page.locator('#ddaSpeed').focus();await page.keyboard.press('End');await wait(s=>s.preset.dda.speed===4);
    await page.keyboard.down(c4);await wait(s=>s.voices.length===1);
    await wait(s=>s.dda.voices.some(v=>v.ended));await silent();
    state=await read();assert.equal(state.voices.length,1);assert.equal(state.registers[state.voices[0].channel][4]&128,0);
    await page.keyboard.up(c4);await wait(s=>s.voices.length===0);
    const ddaDownload=page.waitForEvent('download');await page.locator('#savePreset').click();
    const ddaSaved=JSON.parse(await fs.readFile(await(await ddaDownload).path(),'utf8'));
    assert.equal(ddaSaved.version,3);const dac=Buffer.from(ddaSaved.dda.data,'base64');
    assert(dac.length>0&&dac.every(value=>value<=31));assert(Buffer.byteLength(JSON.stringify(ddaSaved))>65536,'PCM preset exceeds old 64 KiB limit');
    await page.locator('#copyCode').click();assert.match(await page.locator('#codeOutput').inputValue(),/DDA|dda/);
    await page.locator('#resetPreset').click();await wait(s=>s.preset.source==='wave');
    await page.locator('#presetFileInput').setInputFiles({name:'dda-v3.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(ddaSaved))});
    state=await wait(s=>s.preset.source==='dda'&&s.dda.samples===dac.length);assert.equal(state.preset.dda.speed,4);
    await page.keyboard.down(c4);await wait(s=>s.voices.length===1);await page.locator('#stopAudio').click();
    await wait(s=>s.voices.length===0);await silent();await page.keyboard.up(c4);
    if(config.screenshots)await page.screenshot({path:path.join(config.screenshots,`${name}-dda-1180.png`),fullPage:true});
    check('optional loudest PCM grouping preserves different pan/rates and never changes a held sound');
    await page.locator('#vgmFileInput').setInputFiles({name:'volume-variants.vgm',mimeType:'application/octet-stream',buffer:makePcmVolumeVariantsVgm()});
    await page.waitForFunction(()=>document.querySelector('#vgmFileName').textContent==='volume-variants.vgm');
    assert.equal(await page.locator('[data-vgm-voice]').count(),9);
    await page.locator('[data-vgm-filter="pcm"]').click();assert.equal(await page.locator('[data-vgm-voice]').count(),5);
    await page.locator('[data-vgm-voice="1"]').click();state=await wait(s=>s.preset.source==='dda'&&s.preset.volume===12);
    await page.keyboard.down(c4);state=await wait(s=>s.voices.length===1);await sound();const quietOwner=state.voices[0].id;
    await page.locator('#vgmKeepLoudestPcm').check();
    assert.equal(await page.locator('[data-vgm-voice]').count(),3);
    assert.equal(await page.locator('[data-vgm-filter="pcm"]').textContent(),'PCM (3)');
    assert.equal(await page.locator('[data-vgm-voice="1"]').count(),0);
    assert.equal(await page.locator('[data-vgm-voice="2"]').count(),1);
    assert.match(await page.locator('[data-vgm-voice="2"] small').textContent(),/level 27\/31.*3 volume variants grouped/);
    assert.equal(await page.locator('[data-vgm-voice][aria-pressed="true"]').count(),0,'hidden quiet selection does not move to the loud representative');
    state=await read();assert.equal(state.preset.volume,12);assert.equal(state.voices[0].id,quietOwner);await sound();
    assert(await page.locator('#vgmKeepLoudestPcm').evaluate(node=>node.ownerDocument.activeElement!==node));
    const otherKey=keys.find(key=>key!==c4);await page.keyboard.down(otherKey);await wait(s=>s.voices.length===2);
    await page.keyboard.up(otherKey);await wait(s=>s.voices.length===1);
    await page.locator('#vgmKeepLoudestPcm').uncheck();assert.equal(await page.locator('[data-vgm-voice]').count(),5);
    state=await read();assert.equal(state.preset.volume,12);assert.equal(state.voices[0].id,quietOwner);
    await page.locator('#vgmKeepLoudestPcm').check();await page.keyboard.up(c4);await wait(s=>s.voices.length===0);await silent();
    await page.locator('[data-vgm-voice="2"]').click();state=await wait(s=>s.preset.volume===27&&s.preset.dda.sampleRate===7000);
    assert.deepEqual(state.preset.pan,{left:12,right:11});
    const loudDownload=page.waitForEvent('download');await page.locator('#savePreset').click();
    const loudSaved=JSON.parse(await fs.readFile(await(await loudDownload).path(),'utf8'));
    assert.equal(loudSaved.volume,27);assert.deepEqual(Buffer.from(loudSaved.dda.data,'base64'),Buffer.from(streamPcm.map(value=>value&31)));
    await page.locator('#vgmKeepLoudestPcm').uncheck();assert.equal(await page.locator('[data-vgm-voice="2"]').getAttribute('aria-pressed'),'true');
    await page.locator('#vgmKeepLoudestPcm').check();assert.equal(await page.locator('[data-vgm-voice="2"]').getAttribute('aria-pressed'),'true');
    check('Wave channel levels 23 and 24 group to 24 while different waveform and pan remain separate');
    await page.locator('#vgmKeepLoudestPcm').uncheck();
    await page.locator('[data-vgm-filter="wave"]').click();assert.equal(await page.locator('[data-vgm-voice]').count(),4);
    await page.locator('[data-vgm-voice="6"]').click();state=await wait(s=>s.preset.source==='wave'&&s.preset.volume===23);
    assert.deepEqual(state.preset.wave,vgmWave);
    await page.keyboard.down(c4);state=await wait(s=>s.voices.length===1);await sound();const waveQuietOwner=state.voices[0].id;
    await page.locator('#vgmKeepLoudestPcm').check();assert.equal(await page.locator('[data-vgm-voice]').count(),3);
    assert.equal(await page.locator('[data-vgm-voice="6"]').count(),0);
    assert.match(await page.locator('[data-vgm-voice="7"] small').textContent(),/level 24\/31.*2 volume variants grouped/);
    assert.equal(await page.locator('[data-vgm-voice][aria-pressed="true"]').count(),0);
    state=await read();assert.equal(state.preset.volume,23);assert.equal(state.voices[0].id,waveQuietOwner);await sound();
    await page.locator('#vgmKeepLoudestPcm').uncheck();assert.equal(await page.locator('[data-vgm-voice]').count(),4);
    assert.equal((await read()).voices[0].id,waveQuietOwner);
    await page.locator('#vgmKeepLoudestPcm').check();await page.keyboard.up(c4);await wait(s=>s.voices.length===0);await silent();
    await page.locator('[data-vgm-voice="7"]').click();state=await wait(s=>s.preset.source==='wave'&&s.preset.volume===24);
    assert.deepEqual(state.preset.wave,vgmWave);assert.deepEqual(state.preset.pan,{left:15,right:15});
    const waveLoudDownload=page.waitForEvent('download');await page.locator('#savePreset').click();
    const waveLoudSaved=JSON.parse(await fs.readFile(await(await waveLoudDownload).path(),'utf8'));
    assert.equal(waveLoudSaved.volume,24);assert.deepEqual(waveLoudSaved.wave,vgmWave);
    await page.locator('#vgmKeepLoudestPcm').uncheck();assert.equal(await page.locator('[data-vgm-voice="7"]').getAttribute('aria-pressed'),'true');
    await page.locator('#vgmKeepLoudestPcm').check();assert.equal(await page.locator('[data-vgm-voice="7"]').getAttribute('aria-pressed'),'true');
    check('loudest PCM preference applies to the next file and its reversible view fits a narrow screen');
    await page.locator('#vgmFileInput').setInputFiles({name:'volume-variants.vgz',mimeType:'application/gzip',buffer:gzipSync(makePcmVolumeVariantsVgm())});
    await page.waitForFunction(()=>document.querySelector('#vgmFileName').textContent==='volume-variants.vgz');
    assert.equal(await page.locator('[data-vgm-voice]').count(),6);assert.equal((await read()).preset.volume,24);
    await page.locator('[data-vgm-filter="wave"]').click();
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(120);
    assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0);
    if(config.screenshots)await page.screenshot({path:path.join(config.screenshots,`${name}-loudest-pcm-390.png`),fullPage:true});
    await page.setViewportSize({width:1180,height:1000});await page.waitForTimeout(120);
    if(config.screenshots)await page.screenshot({path:path.join(config.screenshots,`${name}-loudest-pcm-1180.png`),fullPage:true});
    await page.locator('#vgmKeepLoudestPcm').uncheck();
    await page.locator('#resetPreset').click();await wait(s=>s.preset.source==='wave');
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
    await page.locator('#presetFileInput').setInputFiles({name:'mobile-dda.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(ddaSaved))});
    await wait(s=>s.preset.source==='dda'&&s.dda.samples===dac.length);
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
