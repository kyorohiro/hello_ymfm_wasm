// SPDX-License-Identifier: BSD-3-Clause
// Real SNES S-DSP WASM / AudioWorklet, with the final output muted during checks.
const {chromium, webkit} = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

function makeWav() {
  const rate=44100,frames=rate*5,channels=2,bytes=Buffer.alloc(44+frames*channels*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
  bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(channels,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*channels*2,28);
  bytes.writeUInt16LE(channels*2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
  for(let i=0;i<frames;i++) for(let ch=0;ch<channels;ch++) bytes.writeInt16LE(Math.round(Math.sin(i/rate*Math.PI*2*220)*(ch===0?.6:.3)*32767),44+(i*channels+ch)*2);
  return bytes;
}

// Self-authored RAM / DSP snapshot, with no IPL ROM or game material.
function makeSpc(title='<img src=x onerror=alert(1)>') {
  const bytes=Buffer.alloc(0x10200),ram=bytes.subarray(0x100,0x10100),dsp=bytes.subarray(0x10100,0x10180);
  bytes.write('SNES-SPC700 Sound File Data v0.30',0,'ascii');
  bytes[0x21]=bytes[0x22]=0x1a;bytes[0x23]=0x1a;bytes[0x24]=30;
  bytes.write(title,0x2e,32,'ascii');bytes.write('Tetorica browser fixture',0x4e,32,'ascii');
  dsp[0x5d]=0x20;
  const brr=Buffer.from([0xc0,0x77,0x66,0x44,0x22,0x0e,0xcc,0xaa,0x99,0xc3,0x99,0xaa,0xcc,0xee,0x02,0x44,0x66,0x77]);
  brr.copy(ram,0x3000);brr.copy(ram,0x3040);
  for(const [srcn,start,loop]of[[3,0x3000,0x3009],[5,0x3000,0x3009],[6,0x3040,0x4000]]) {
    ram.writeUInt16LE(start,0x2000+srcn*4);ram.writeUInt16LE(loop,0x2002+srcn*4);
  }
  const voice=(index,{srcn=3,pitch=4096,left=16,right=24,adsr1=0x8f,adsr2=0xe0,gain=80,active=true}={})=>{
    const base=index<<4;dsp[base]=left&255;dsp[base+1]=right&255;
    dsp[base+2]=pitch&255;dsp[base+3]=pitch>>8;dsp[base+4]=srcn;
    dsp[base+5]=adsr1;dsp[base+6]=adsr2;dsp[base+7]=gain;
    dsp[base+8]=active?0x40:0;dsp[base+9]=active?0x10:0;
  };
  voice(0);voice(1,{pitch:2048,left:-20,right:18,adsr1:0x21,adsr2:0xa5,gain:96,active:false});
  voice(2,{srcn:5});dsp[0x3d]=1<<2;
  voice(3,{pitch:0});voice(4,{srcn:6});
  voice(5,{adsr1:0,adsr2:0,gain:0xc8});voice(6);voice(7);
  dsp[0x2d]=dsp[0x4d]=1<<6;
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
        if(audit.holdSpcCommit&&data?.method==='loadPreset') {
          audit.holdSpcCommit=false;audit.releaseSpcCommit=()=>post.call(this,data,...args);return;
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
        if (!node) return reject(new Error('No S-DSP worklet'));
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
    check('SPC file opening is passive, bounded to snapshot candidates and safe metadata text');
    await page.locator('#spcFileInput').setInputFiles({name:'self-authored.spc',mimeType:'application/octet-stream',buffer:makeSpc()});
    await page.waitForFunction(()=>document.querySelectorAll('#spcCandidates [data-spc-voice]').length===8);
    assert.equal(await page.evaluate(()=>audit.contexts.length),0);
    assert.equal(await page.locator('#instrumentName').inputValue(),'Sine');
    assert.equal(await radio('source','wave').getAttribute('aria-checked'),'true');
    assert.match(await page.locator('#spcMetadata').textContent(),/<img src=x onerror=alert\(1\)>/);
    assert.equal(await page.locator('#spcMetadata img').count(),0);
    for(const index of [0,1,5,6,7])assert.equal(await page.locator(`#spcCandidate${index}`).isEnabled(),true);
    for(const index of [2,3,4])assert.equal(await page.locator(`#spcCandidate${index}`).isDisabled(),true);
    assert.match(await page.locator('#spcCandidates').textContent(),/Noise/i);
    assert.match(await page.locator('#spcCandidates').textContent(),/PITCH/);
    assert.match(await page.locator('#spcCandidates').textContent(),/PMON|modulation/i);
    assert.match(await page.locator('#spcCandidates').textContent(),/Echo/i);
    assert.match(await page.locator('#spcSection').textContent(),/ENVX.*OUTX|OUTX.*ENVX/);
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
    check('real hardware Echo, live FIR / Delay / signed Return, tail, portable v2 and v1 migration');
    assert.equal(await page.locator('#firSection').getAttribute('open'),null);
    await page.locator('#echoEnabled').check();
    state=await wait(s=>s.preset.echo.enabled&&s.echoRegisters.eon===255);
    assert.equal(state.memory.directoryAddress,0x7800);assert.equal(state.memory.maxSampleBytes,33786);
    assert.equal(state.echoRegisters.esa,0);assert.equal(state.echoRegisters.edl,4);assert.equal(state.echoRegisters.flg&32,0);
    assert.match(await page.locator('#sampleBudget').textContent(),/33,786/);
    await page.keyboard.down(keys[1]);state=await wait(s=>s.voices.length===1);await sound();
    const echoOwner=state.voices[0].id,echoGeneration=state.generation;
    await page.locator('[data-stepper-for="echoDelay"][data-stepper-delta="1"]').click();
    state=await wait(s=>s.echoRegisters.edl===5);assert.match(await page.locator('#echoDelayInfo').textContent(),/80/);
    await page.locator('[data-stepper-for="echoFeedback"][data-stepper-delta="1"]').click();
    state=await wait(s=>s.echoRegisters.efb===33);
    await page.locator('#echoVolumeRight').press('Home');state=await wait(s=>s.echoRegisters.volumeRight===128);
    await page.locator('#firSection > summary').click();
    await page.locator('[data-stepper-for="echoFir0"][data-stepper-delta="-1"]').click();
    state=await wait(s=>s.echoRegisters.fir[0]===126);
    assert.equal(state.voices[0].id,echoOwner);assert.equal(state.generation,echoGeneration);
    await page.locator('#resetEchoFir').click();state=await wait(s=>s.echoRegisters.fir[0]===127);
    assert.deepEqual(state.echoRegisters.fir,[127,0,0,0,0,0,0,0]);
    await page.locator('#echoSend').uncheck();state=await wait(s=>s.echoRegisters.eon===0);
    assert.equal(state.voices[0].id,echoOwner);await page.locator('#echoSend').check();await wait(s=>s.echoRegisters.eon===255);
    await page.waitForTimeout(120);await page.keyboard.up(keys[1]);await wait(s=>s.voices.length===0);
    await page.waitForTimeout(120);assert((await page.evaluate(()=>audit.sample())).rms>.00001,'Echo remains after the dry hardware KOFF release');
    const echoDownload=page.waitForEvent('download');await page.locator('#savePreset').click();
    const echoSaved=JSON.parse(await fs.readFile(await(await echoDownload).path(),'utf8'));
    assert.equal(echoSaved.version,2);assert.equal(echoSaved.echo.enabled,true);assert.equal(echoSaved.echo.volumeRight,-128);
    await page.locator('#copyCode').click();const echoCode=await page.locator('#codeOutput').inputValue();
    assert(echoCode.indexOf('setEcho')>=0&&echoCode.indexOf('setEcho')<echoCode.indexOf('loadBRR'),'reserve Echo before uploading BRR');
    await page.locator('#echoEnabled').uncheck();state=await wait(s=>!s.preset.echo.enabled);await silent();
    assert.equal(state.memory.directoryAddress,0);assert.equal(state.memory.maxSampleBytes,64512);
    const legacy={...echoSaved,version:1};delete legacy.echo;
    await page.locator('#presetFileInput').setInputFiles({name:'legacy-v1.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
    state=await wait(s=>s.preset.version===2&&!s.preset.echo.enabled);assert.equal(state.preset.echo.feedback,32);
    await page.locator('#presetFileInput').setInputFiles({name:'echo-v2.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(echoSaved))});
    state=await wait(s=>s.preset.echo.enabled&&s.preset.echo.delay===5);assert.equal(state.echoRegisters.volumeRight,128);
    await page.locator('#resetPreset').click();await wait(s=>!s.preset.echo.enabled&&s.preset.name==='Sine');
    check('wave drawing applies on release; cancelled strokes preserve held sound');
    await page.keyboard.down(keys[0]);state=await wait(s=>s.voices.length===1);const drawOwner=state.voices[0].id;
    await page.locator('#waveCanvas').scrollIntoViewIfNeeded();
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
    await page.locator('#echoEnabled').click();
    await page.waitForFunction(()=>document.querySelector('#audioStatus').dataset.error==='true');
    state=await read();assert.equal(state.preset.echo.enabled,false);assert.equal(state.voices[0].id,sampleOwner);
    assert.equal(state.generation,sampleGeneration);assert.equal(await page.locator('#echoEnabled').isChecked(),false);
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
    check('SPC selection adopts BRR, resolved loop, packed ADSR / GAIN, signed levels and declared C4 tuning');
    await page.locator('#spcCandidate0').click();
    state=await wait(s=>s.preset.source==='brr'&&s.preset.brr.basePitch===4096&&s.preset.brr.loopStartSamples===16);
    assert.equal(state.preset.brr.rootNote,60);assert.equal(state.sample.frames,32);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const shortBrrCoverage=await page.locator('#waveCanvas').evaluate(canvas=>{
      const {width,height}=canvas,pixels=canvas.getContext('2d').getImageData(0,0,width,height).data;
      const left=28,right=width-15,top=16,bottom=height-28;let traced=0;
      for(let x=left;x<=right;x++)for(let y=top;y<=bottom;y++) {
        const offset=(y*width+x)*4,r=pixels[offset],g=pixels[offset+1],b=pixels[offset+2];
        if(g>100&&g>r+25&&g>b+15){traced++;break;}
      }
      return traced/(right-left+1);
    });
    assert(shortBrrCoverage>.7,`32-frame BRR preview should draw a continuous green waveform, covered ${(shortBrrCoverage*100).toFixed(1)}% of plot columns`);
    for(const registers of state.registers)assert.deepEqual([registers[0],registers[1],registers[5],registers[6],registers[7]],[16,24,0x8f,0xe0,80]);
    const rootKey=await page.locator('#keyboard .key:not([disabled])').evaluateAll(nodes=>nodes.find(node=>/(?:^|\s)C4(?:\s|$)/.test(node.textContent))?.dataset.key);
    assert(rootKey,'current keyboard exposes declared root C4');
    await page.keyboard.down(rootKey);state=await wait(s=>s.voices.length===1);await sound();
    let rootRegisters=state.registers[state.voices[0].channel];assert.equal(rootRegisters[2]|rootRegisters[3]<<8,4096);
    await page.keyboard.up(rootKey);await silent();
    await page.locator('#spcCandidate1').click();
    state=await wait(s=>s.preset.brr.basePitch===2048&&s.preset.volume.left===-20);
    assert.equal(state.preset.envelope.mode,'gain');assert.equal(state.preset.envelope.gainMode,'direct');
    assert.equal(state.preset.envelope.gainLevel,96);assert.equal(state.preset.brr.loopStartSamples,16);
    for(const registers of state.registers)assert.deepEqual([registers[0],registers[1],registers[5],registers[6],registers[7]],[236,18,0x21,0xa5,96]);
    await page.keyboard.down(rootKey);state=await wait(s=>s.voices.length===1);await sound();
    rootRegisters=state.registers[state.voices[0].channel];assert.equal(rootRegisters[2]|rootRegisters[3]<<8,2048);
    const spcOwner=state.voices[0].id,spcPreset=state.preset;
    check('invalid, cancelled and superseded SPC file opens retain the instrument, held owner and previous candidates');
    await page.locator('#spcFileInput').setInputFiles({name:'invalid.spc',mimeType:'application/octet-stream',buffer:Buffer.from('not an SPC')});
    await page.waitForFunction(()=>document.querySelector('#spcImportStatus').dataset.error==='true');
    state=await read();assert.deepEqual(state.preset,spcPreset);assert.equal(state.voices[0].id,spcOwner);
    assert.equal(await page.locator('#spcCandidates [data-spc-voice]').count(),8);
    await page.evaluate(()=>{
      audit.oversizedSpcReads=0;audit.beforeSpcCapRead=File.prototype.arrayBuffer;
      File.prototype.arrayBuffer=function(...args){if(this.name==='oversized.spc')audit.oversizedSpcReads++;return audit.beforeSpcCapRead.apply(this,args);};
    });
    await page.locator('#spcFileInput').setInputFiles({name:'oversized.spc',mimeType:'application/octet-stream',buffer:Buffer.alloc(16*1024*1024+1)});
    await page.waitForFunction(()=>/16 MiB/.test(document.querySelector('#spcImportStatus').textContent));
    assert.equal(await page.evaluate(()=>audit.oversizedSpcReads),0);
    await page.evaluate(()=>{File.prototype.arrayBuffer=audit.beforeSpcCapRead;});
    state=await read();assert.deepEqual(state.preset,spcPreset);assert.equal(state.voices[0].id,spcOwner);
    await page.evaluate(()=>{
      audit.spcReadFile=File.prototype.arrayBuffer;
      File.prototype.arrayBuffer=function(...args){
        if(!['cancel.spc','late.spc'].includes(this.name))return audit.spcReadFile.apply(this,args);
        return new Promise((resolve,reject)=>{audit[this.name==='cancel.spc'?'releaseSpcFile':'releaseLateSpcFile']=()=>audit.spcReadFile.apply(this,args).then(resolve,reject);});
      };
    });
    await page.locator('#spcFileInput').setInputFiles({name:'cancel.spc',mimeType:'application/octet-stream',buffer:makeSpc('Cancelled snapshot')});
    await page.waitForFunction(()=>typeof audit.releaseSpcFile==='function');await page.locator('#cancelSpcImport').click();
    await page.evaluate(()=>audit.releaseSpcFile());
    state=await read();assert.deepEqual(state.preset,spcPreset);assert.equal(state.voices[0].id,spcOwner);
    assert.equal(await page.locator('#spcCandidates [data-spc-voice]').count(),8);
    assert.doesNotMatch(await page.locator('#spcMetadata').textContent(),/Cancelled snapshot/);
    await page.locator('#spcFileInput').setInputFiles({name:'late.spc',mimeType:'application/octet-stream',buffer:makeSpc('Late snapshot')});
    await page.waitForFunction(()=>typeof audit.releaseLateSpcFile==='function');
    await page.locator('#spcFileInput').setInputFiles({name:'replacement.spc',mimeType:'application/octet-stream',buffer:makeSpc('Replacement snapshot')});
    await page.waitForFunction(()=>document.querySelector('#spcMetadata').textContent.includes('Replacement snapshot'));
    await page.evaluate(async()=>{await audit.releaseLateSpcFile();File.prototype.arrayBuffer=audit.spcReadFile;});
    assert.match(await page.locator('#spcMetadata').textContent(),/Replacement snapshot/);
    assert.doesNotMatch(await page.locator('#spcMetadata').textContent(),/Late snapshot/);
    state=await read();assert.deepEqual(state.preset,spcPreset);assert.equal(state.voices[0].id,spcOwner);
    await page.keyboard.up(rootKey);await silent();
    check('SPC selection commit closes cancellation and portable preset restores the imported voice');
    await page.evaluate(()=>{audit.holdSpcCommit=true;});await page.locator('#spcCandidate0').click();
    await page.waitForFunction(()=>typeof audit.releaseSpcCommit==='function');
    assert.match(await page.locator('#spcImportStatus').textContent(),/Applying/);
    assert(!await page.locator('#cancelSpcImport').isVisible()||await page.locator('#cancelSpcImport').isDisabled());
    await page.evaluate(()=>audit.releaseSpcCommit());
    await wait(s=>s.preset.brr.basePitch===4096&&s.preset.volume.left===16);
    await page.waitForFunction(()=>!document.querySelector('#spcCandidate0').disabled);
    const spcDownload=page.waitForEvent('download');await page.locator('#savePreset').click();
    const spcSaved=JSON.parse(await fs.readFile(await(await spcDownload).path(),'utf8'));
    assert.equal(spcSaved.brr.loopStartSamples,16);assert.equal(spcSaved.brr.basePitch,4096);assert.equal(spcSaved.brr.rootNote,60);
    assert.deepEqual(Buffer.from(spcSaved.brr.data,'base64'),rawBrr);
    assert.equal(await page.locator('#spcCandidate0').getAttribute('aria-pressed'),'true');
    await page.locator('#resetPreset').click();await wait(s=>s.preset.source==='wave'&&s.preset.name==='Sine');
    assert.equal(await page.locator('#spcCandidates [aria-pressed="true"]').count(),0,'Reset clears the previous SPC selection highlight');
    await page.locator('#presetFileInput').setInputFiles({name:'saved-spc-voice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(spcSaved))});
    state=await wait(s=>s.preset.source==='brr'&&s.preset.brr.loopStartSamples===16&&s.preset.brr.basePitch===4096);
    assert.equal(state.preset.envelope.mode,'adsr');
    assert.equal(await page.locator('#spcCandidates [aria-pressed="true"]').count(),0,'Loading JSON does not select a snapshot candidate');
    await page.locator('#copyCode').click();assert.match(await page.locator('#codeOutput').inputValue(),/loopStartSamples.*16/);
    await page.locator('#spcCandidate1').click();await wait(s=>s.preset.brr.basePitch===2048);
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
