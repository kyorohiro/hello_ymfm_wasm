// Exercise the real standalone page, AudioWorklet and WASM in both engines.
// Measure the node actually connected to destination, then mute that connection
// so browser validation never plays notes through the user's speakers.
const {chromium, webkit} = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {gzipSync} = require('node:zlib');

// Self-authored register logs only; no game music, ROMs or third-party voices.
const vgmWave = Array.from({length:64}, (_,index) => index);
const vgmModulation = [...Array(8).fill(1), ...Array(16).fill(7), ...Array(8).fill(1)];
const vgmWrite = (register,value) => [0xb4,register,value];
function vgmBytes(commands, {nes = true, fds = true} = {}) {
  const bytes=Buffer.alloc(256+commands.length);
  bytes.write('Vgm ');bytes.writeUInt32LE(bytes.length-4,4);
  bytes.writeUInt32LE(0x171,8);bytes.writeUInt32LE(0xcc,0x34);
  bytes.writeUInt32LE(nes ? (1789773 | (fds ? 0x80000000 : 0)) >>> 0 : 0,0x84);
  bytes.set(commands,256);return bytes;
}
function makeInstrumentVgm(options = {}) {
  const w=vgmWrite,wait=[0x61,0xe8,0x03];
  return vgmBytes([
    ...w(0x15,0x0f), ...w(0,0xba), ...w(1,0xa9), ...w(2,0x40), ...w(3,0x89), ...wait,
    ...w(4,0x79), ...w(5,0x08), ...w(6,0x40), ...w(7,0x89), ...wait,
    ...w(7,0x89), ...wait,
    ...w(8,0xff), ...w(0x0a,0x40), ...w(0x0b,0x89), ...wait,
    ...w(0x0c,0x3b), ...w(0x0e,0x83), ...w(0x0f,0x08), ...wait,
    ...w(0x3f,2), ...w(0x23,0x80), ...w(0x29,0x80),
    ...vgmWave.flatMap((value,index)=>w(0x40+index,value)),
    ...w(0x27,0x80), ...vgmModulation.flatMap(value=>w(0x28,value)),
    ...w(0x29,0), ...w(0x20,0x98), ...w(0x24,0x90), ...w(0x25,0),
    ...w(0x26,0), ...w(0x27,1), ...w(0x22,0x66), ...w(0x23,0x42), ...wait, 0x66,
  ],options);
}
function makePagedInstrumentVgm() {
  const commands=[...vgmWrite(0x15,2),...vgmWrite(5,8)];
  for(let index=0;index<30;index++) commands.push(
    ...vgmWrite(4,((index%4)<<6)|0x30|(1+Math.floor(index/4))),
    ...vgmWrite(6,0x40),...vgmWrite(7,0x89),0x61,0xe8,0x03);
  commands.push(0x66);return vgmBytes(commands,{fds:false});
}
function makeNoiseEnvelopeVgm() {
  return vgmBytes([...vgmWrite(0x15,8),...vgmWrite(0x0c,0x23),...vgmWrite(0x0e,0x83),...vgmWrite(0x0f,8),0x66],{fds:false});
}
const config = {
  root:path.resolve(__dirname, '../docs'), entry:'/synth-2a03/index.html',
  out:'/private/tmp/tetorica-2a03-synth-browser.json', screenshots:null,
};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  assert(['root','entry','out','screenshots'].includes(key), 'Usage: --root DIR --entry /index.html --out REPORT [--screenshots DIR]');
  const value = process.argv[++i]; assert(value, `Missing --${key} value`);
  config[key] = key === 'entry' ? value : path.resolve(value);
}
const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
  '.wasm':'application/wasm', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.svg':'image/svg+xml'};

async function runEngine(name, engine, origin) {
  const browser = await engine.launch({headless:true});
  let page, stage = 'startup';
  let initialWasmSeen = false, releaseInitialWasm, legacyRedirect = false;
  const initialWasmGate = new Promise(resolve => {releaseInitialWasm = resolve;});
  const errors = [], missing = [], external = [];
  const check = text => {stage = text; console.log(`CHECK ${name}: ${text}`);};
  try {
    page = await browser.newPage({acceptDownloads:true, viewport:{width:1180,height:940}});
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {if (response.status() >= 400) missing.push({url:response.url(), status:response.status()});});
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.protocol === 'data:' || url.protocol === 'blob:' || url.origin === origin) {
        if (!initialWasmSeen && url.pathname.endsWith('/nesapu_wasm.wasm')) {
          initialWasmSeen = true; await initialWasmGate;
        }
        return route.continue();
      }
      external.push(url.href); return route.abort();
    });
    await page.addInitScript(() => {
      window.audit = {contexts:[], worklets:[], analysers:[], outgoing:[], nextId:0};
      const Context = window.AudioContext ?? window.webkitAudioContext;
      const Node = window.AudioWorkletNode, connect = AudioNode.prototype.connect;
      const AuditedContext = class extends Context {
        constructor(...args) {super(...args); window.audit.contexts.push(this);}
      };
      window.AudioContext = AuditedContext;
      if (window.webkitAudioContext) window.webkitAudioContext = AuditedContext;
      AudioNode.prototype.connect = function(destination, ...args) {
        if (destination === this.context.destination) {
          const analyser = this.context.createAnalyser(); analyser.fftSize = 4096;
          const mute = this.context.createGain(); mute.gain.value = 0;
          window.audit.analysers.push(analyser);
          connect.call(this, analyser); connect.call(analyser, mute); connect.call(mute, destination);
          return destination;
        }
        return connect.call(this, destination, ...args);
      };
      window.AudioWorkletNode = class extends Node {
        constructor(...args) {super(...args); window.audit.worklets.push(this);}
      };
      const post = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function(data, ...args) {
        if (data?.method) window.audit.outgoing.push({method:data.method, args:data.args});
        return post.call(this, data, ...args);
      };
      window.audit.read = () => new Promise((resolve, reject) => {
        const node = window.audit.worklets.at(-1), id = --window.audit.nextId;
        if (!node) {reject(new Error('No NES worklet')); return;}
        const timer = setTimeout(() => {node.port.removeEventListener('message', receive); reject(new Error('Audit read timed out'));}, 5000);
        function receive({data}) {
          if (data.id !== id) return;
          clearTimeout(timer); node.port.removeEventListener('message', receive);
          if (data.error) reject(new Error(data.error)); else resolve(data.value);
        }
        node.port.addEventListener('message', receive); node.port.start();
        node.port.postMessage({id, method:'read', args:[]});
      });
      window.audit.sample = () => {
        const analyser = window.audit.analysers.at(-1);
        if (!analyser) return {rms:0, peak:0, finite:true};
        const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values);
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        let square = 0, peak = 0;
        for (const value of values) {square += (value - mean) ** 2; peak = Math.max(peak, Math.abs(value));}
        return {rms:Math.sqrt(square / values.length), peak, mean, finite:values.every(Number.isFinite)};
      };
    });
    const inspect = () => page.evaluate(() => window.audit.read());
    const waitState = async (predicate, message = 'Instrument state did not settle') => {
      let last;
      for (let attempt = 0; attempt < 100; attempt++) {
        last = await inspect(); if (predicate(last)) return last;
        await page.waitForTimeout(25);
      }
      throw new Error(`${message}: ${JSON.stringify(last)}`);
    };
    const sound = () => page.waitForFunction(() => {
      const value = window.audit.sample(); return value.finite && value.rms > .0001;
    });
    const silent = () => page.waitForFunction(() => window.audit.sample().rms < .000001);
    const stepButton = (selector, delta) => page.locator(`[data-stepper-for="${selector.replace(/^#/, '')}"][data-stepper-delta="${delta}"]`);
    const number = async (selector, value) => {
      for (let attempt = 0; attempt < 32; attempt++) {
        const current = Number(await page.locator(selector).textContent());
        assert(Number.isInteger(current), `${selector} has a numeric display`);
        if (current === value) return;
        const delta = current < value ? 1 : -1;
        await stepButton(selector, delta).click();
        await page.waitForFunction(({selector,next}) => Number(document.querySelector(selector).textContent) === next, {selector,next:current+delta});
      }
      assert.fail(`${selector} did not reach ${value}`);
    };
    const choiceButton = (selector, value) => page.locator(`[data-choice-for="${selector.replace(/^#/, '')}"][data-choice-value="${String(value)}"]`);
    const choose = async (selector, value) => {
      // Use an actual pointer click: synthetic change/selectOption cannot
      // establish that native type-ahead no longer consumes performance keys.
      const button = choiceButton(selector, value);
      await button.click();
      assert.equal(await button.getAttribute('aria-checked'),'true');
      assert.equal(await page.evaluate(() => Boolean(document.activeElement?.matches('input:not([type=range]),select,textarea'))),false,
        'choice buttons leave the performance keyboard available');
    };
    const stop = async () => {
      await page.click('#stopAudio'); await waitState(state => state.voices.length === 0);
    };
    const setMaster = async value => {
      await page.locator('#masterVolume').evaluate((input, next) => {
        input.value = String(next); input.dispatchEvent(new Event('input', {bubbles:true}));
      }, value);
    };
    const pitchWheels = ['#pitchBend','#keyboardPitchBend'];
    const assertPitchUi = async value => {
      const actual=await page.evaluate(()=>({
        values:['pitchBend','keyboardPitchBend'].map(id=>Number(document.getElementById(id).value)),
        labels:['pitchValue','keyboardPitchValue'].map(id=>document.getElementById(id).textContent),
      }));
      assert.deepEqual(actual.values,[value,value]);
      const label=`${value>=0?'+':''}${value.toFixed(2)}`;
      assert.deepEqual(actual.labels,[label,label]);
    };
    const assertPitchPositions = async () => {
      const positions=await page.evaluate(()=>{
        const rect=selector=>{const value=document.querySelector(selector).getBoundingClientRect();return {left:value.left,right:value.right};};
        const monitor=document.querySelector('#pitchBend').closest('label').getBoundingClientRect();
        const keyboard=document.querySelector('#keyboardPitchBend').closest('label').getBoundingClientRect();
        return {monitorLeft:monitor.left,canvas:rect('#outputCanvas'),keyboardRight:keyboard.right,keys:rect('#keyboard')};
      });
      assert(positions.monitorLeft>=positions.canvas.right-1,'monitor Pitch is to the right of the output plot');
      assert(positions.keyboardRight<=positions.keys.left+1,'keyboard Pitch is to the left of the keys');
    };

    const spectrum = () => page.evaluate(() => {
      const analyser=window.audit.analysers.at(-1), values=new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(values);
      const power=Array.from(values,value=>Number.isFinite(value)?10**(value/10):0);
      const sum=power.reduce((total,value)=>total+value,0)||1;
      return power.map(value=>value/sum);
    });
    const compareSpectra=(a,b)=>a.reduce((sum,value,index)=>sum+Math.abs(value-b[index]),0);
    const averagedSpectrum=async()=>{
      const values=[];
      for(let frame=0;frame<4;frame++){values.push(await spectrum());await page.waitForTimeout(25);}
      return values[0].map((_,index)=>values.reduce((sum,value)=>sum+value[index],0)/values.length);
    };
    const screenshot = async label => {
      if(config.screenshots) await page.screenshot({path:path.join(config.screenshots,'2a03-'+name+'-'+label+'.png'),fullPage:true});
    };
    if (config.entry === '/synth-2a03/index.html') {
      const legacyExists = await fs.access(path.join(config.root,'synth-nes/index.html')).then(()=>true,()=>false);
      if (legacyExists) {
        check('legacy NES address redirects while preserving query and fragment');
        await page.goto(origin+'/synth-nes/index.html?redirect-check=1#voiceEditor');
        await page.waitForURL(url=>url.pathname==='/synth-2a03/index.html'&&url.search==='?redirect-check=1'&&url.hash==='#voiceEditor');
        legacyRedirect = true;
      }
    }
    check('product identity / supplied icon / lazy startup / editing without an audio device');
    await page.goto(origin+config.entry);
    assert.equal(await page.title(),'Tetorica 2A03 Synth');
    assert.match(await page.locator('#synthTitle').textContent(),/Tetorica\s+2A03 Synth/);
    const icon = page.locator('.product-icon');
    await icon.waitFor();
    await page.waitForFunction(()=>{const image=document.querySelector('.product-icon');return image?.complete&&image.naturalWidth>=256&&image.naturalWidth===image.naturalHeight;});
    const iconUrl = await icon.evaluate(image=>image.src);
    assert.equal(new URL(iconUrl).origin,origin);
    assert(new URL(iconUrl).pathname.endsWith('/tetorica_2a03_synth.webp'));
    for(const selector of ['link[rel="icon"]','link[rel="apple-touch-icon"]']) {
      assert.equal(await page.locator(selector).evaluate(link=>link.href),iconUrl);
    }
    const iconResponse=await page.request.get(iconUrl);assert(iconResponse.ok());
    assert.deepEqual(await iconResponse.body(),await fs.readFile(path.join(config.root,'tetorica_2a03_synth.webp')));
    await page.waitForSelector('#pulseDuty');
    assert.equal(await page.locator('.monitor-pitch input[type=range]').count(),2);
    await assertPitchPositions(); await assertPitchUi(0);
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
    assert.equal(await page.locator('#voiceEditor input[type=number]').count(),0,'instrument values are button steppers');
    assert.equal(await page.locator('#voiceEditor select').count(),0,'sound choices avoid native type-ahead');
    assert.equal(await page.locator('#source [role=radio]').count(),4);
    await number('#pulseVolume',11); await number('#pulseVolume',10);
    await choose('#pulseDuty',.25);
    await page.fill('#instrumentName','NES browser audit'); await page.press('#instrumentName','Enter');
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
    assert.equal(await page.locator('#keyboard .key').count(),36);

    check('VGM library is passive before audio; source filters and bounded pages retain the edited draft');
    const vgmChooser=page.waitForEvent('filechooser');await page.click('#loadVgm');
    await (await vgmChooser).setFiles({name:'self-authored-2a03.vgm',mimeType:'application/octet-stream',buffer:makeInstrumentVgm()});
    await page.waitForFunction(()=>document.querySelector('#vgmLibrary').dataset.loading==='false'&&document.querySelectorAll('[data-vgm-voice]').length===5);
    assert.equal(await page.isVisible('#vgmLibrary'),true);
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
    assert.equal(await page.locator('#instrumentName').inputValue(),'NES browser audit');
    assert.equal(await choiceButton('#pulseDuty',.25).getAttribute('aria-checked'),'true');
    assert.equal(await page.locator('[data-vgm-voice][aria-pressed=true]').count(),0);
    assert.equal(await page.isVisible('#vgmWarnings'),true);
    assert.equal(await page.locator('#vgmWarnings').evaluate(details=>details.open),false,'general file notes start collapsed');
    assert.match(await page.locator('#vgmWarningsSummary').textContent(),/^File notes \(\d+\)$/);
    assert.equal(await page.isVisible('#vgmWarningList'),false);
    await page.click('#vgmWarningsSummary');
    assert.equal(await page.isVisible('#vgmWarningList'),true);
    assert((await page.locator('#vgmWarningList li').count())>0);
    await page.click('#vgmWarningsSummary');
    assert.equal(await page.locator('#vgmWarnings').evaluate(details=>details.open),false);
    for(const [kind,count] of [['pulse',2],['triangle',1],['noise',1],['fds',1],['all',5]]) {
      await page.click(`[data-vgm-filter="${kind}"]`);assert.equal(await page.locator('[data-vgm-voice]').count(),count);
    }
    await page.click('#closeVgm');assert.equal(await page.isVisible('#vgmLibrary'),false);
    assert.equal(await page.locator('#instrumentName').inputValue(),'NES browser audit');
    await page.setInputFiles('#vgmFileInput',{name:'thirty-self-authored-voices.vgm',mimeType:'application/octet-stream',buffer:makePagedInstrumentVgm()});
    await page.waitForFunction(()=>document.querySelector('#vgmLibrary').dataset.loading==='false'&&document.querySelectorAll('[data-vgm-voice]').length===24);
    assert.match(await page.locator('#vgmPage').textContent(),/1–24 \/ 30 sounds/);
    assert.equal(await page.isDisabled('#vgmPrevious'),true);
    for(const kind of ['triangle','noise','fds']) assert.equal(await page.isDisabled(`[data-vgm-filter="${kind}"]`),true);
    await page.click('#vgmNext');assert.equal(await page.locator('[data-vgm-voice]').count(),6);
    assert.match(await page.locator('#vgmPage').textContent(),/25–30 \/ 30 sounds/);assert.equal(await page.isDisabled('#vgmNext'),true);
    await page.click('#vgmPrevious');assert.equal(await page.locator('[data-vgm-voice]').count(),24);
    await page.click('#closeVgm');assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);

    check('initialization adopts the current source and Master; released startup note stays silent');
    await page.click('#startAudio');
    for(let attempt=0;!initialWasmSeen&&attempt<100;attempt++) await page.waitForTimeout(25);
    assert(initialWasmSeen,'initial WASM request reached the delay gate');
    await page.keyboard.down('a'); await page.keyboard.up('a');
    await choose('#source','triangle'); await setMaster(0);
    releaseInitialWasm();
    await page.waitForFunction(()=>document.querySelector('#audioStatus').textContent.startsWith('Audio ready'));
    let state=await waitState(value=>value.preset.source==='triangle'&&value.preset.pulse.duty===.25);
    assert.equal(state.capacity,1); assert.equal(state.voices.length,0);
    assert.equal(await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length),0);
    await page.keyboard.down('a'); await waitState(value=>value.voices.length===1); await silent();
    await setMaster(.7); await sound(); await page.keyboard.up('a'); await waitState(value=>value.voices.length===0);
    await page.click('#resetPreset'); await waitState(value=>value.preset.source==='pulse'&&value.capacity===2);
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),1);
    assert.equal(await page.evaluate(()=>window.audit.analysers.length),1,'a single speaker branch, with passive monitor');

    check('two physical Pulse owners / oldest replacement / safe late key release');
    await page.keyboard.down('a'); state=await waitState(value=>value.voices.length===1); const first=state.voices[0]; await sound();
    await page.keyboard.down('s'); state=await waitState(value=>value.voices.length===2); const second=state.voices.find(voice=>voice.id!==first.id);
    assert.notEqual(first.channel,second.channel);
    const pulseLevel=await page.evaluate(()=>window.audit.sample()); assert(pulseLevel.finite);
    await page.keyboard.down('d'); state=await waitState(value=>value.voices.length===2&&!value.voices.some(voice=>voice.id===first.id));
    const replacement=state.voices.find(voice=>voice.id!==second.id); assert.equal(replacement.channel,first.channel);
    await page.keyboard.up('a'); assert((await inspect()).voices.some(voice=>voice.id===replacement.id));
    assert.equal(await page.locator('#keyboard .key[aria-pressed=true]').count(),2);
    const owners=state.voices.map(voice=>voice.id), attacks=await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length);
    await choose('#pulseDuty',.125); state=await waitState(value=>value.preset.pulse.duty===.125);
    assert.deepEqual(state.voices.map(voice=>voice.id),owners);
    assert.equal(state.registers[0]&0xc0,0); assert.equal(state.registers[4]&0xc0,0);
    assert.equal(await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length),attacks);
    await sound();

    check('paired Pitch wheels synchronize in both directions and spring back without changing owners');
    const oldRegisters=[...state.registers];
    await page.locator('#pitchBend').evaluate(input=>{input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}));});
    state=await waitState(value=>value.pitch===1); await assertPitchUi(1);
    assert.deepEqual(state.voices.map(voice=>voice.id),owners); assert.notDeepEqual(state.registers.slice(2,4),oldRegisters.slice(2,4));
    await page.locator('#keyboardPitchBend').evaluate(input=>{input.value='-1';input.dispatchEvent(new Event('input',{bubbles:true}));});
    state=await waitState(value=>value.pitch===-1); await assertPitchUi(-1);
    assert.deepEqual(state.voices.map(voice=>voice.id),owners);
    assert.equal(await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length),attacks);
    await page.dispatchEvent('#keyboardPitchBend','pointerup'); await waitState(value=>value.pitch===0); await assertPitchUi(0);
    await page.locator('#pitchBend').evaluate(input=>{input.value='.5';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await waitState(value=>value.pitch===.5); await page.dispatchEvent('#pitchBend','pointercancel'); await waitState(value=>value.pitch===0); await assertPitchUi(0);
    await setMaster(0); await silent(); assert.equal((await inspect()).voices.length,2);
    await setMaster(.7); await sound();
    const normalColor=await page.locator('#masterVolume').evaluate(input=>getComputedStyle(input).accentColor);
    await setMaster(3.8); assert.equal(await page.locator('#masterVolumeValue').textContent(),'380%');
    assert.equal(await page.locator('#masterVolume').getAttribute('data-boosted'),'true');
    assert.notEqual(await page.locator('#masterVolume').evaluate(input=>getComputedStyle(input).accentColor),normalColor);
    await setMaster(.7); await page.keyboard.up('s'); await page.keyboard.up('d'); await waitState(value=>value.voices.length===0);
    for(const selector of pitchWheels){await page.locator(selector).focus();await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();await page.keyboard.up('a');await waitState(value=>value.voices.length===0);}

    check('NES Sweep applies to both Pulse channels; envelope controls keep keyboard access');
    assert.equal(await stepButton('#sweepPeriod',1).isDisabled(),true);
    await page.check('#sweepEnabled'); await waitState(value=>value.preset.pulse.sweep.enabled&&value.capacity===2);
    await number('#sweepPeriod',4); await number('#sweepPeriod',3);
    await page.keyboard.down('a'); await page.keyboard.down('s');state=await waitState(value=>value.voices.length===2);assert.deepEqual(new Set(state.voices.map(voice=>voice.channel)),new Set([0,1]));
    await page.keyboard.up('a'); await page.keyboard.up('s'); await waitState(value=>value.voices.length===0); await page.uncheck('#sweepEnabled');
    await page.check('#pulseEnvelopeEnabled'); await waitState(value=>value.preset.pulse.envelope.enabled);
    await page.uncheck('#pulseEnvelopeEnabled');await waitState(value=>!value.preset.pulse.envelope.enabled);

    check('Triangle is one physical channel and a replaced note owns the late release');
    await choose('#source','triangle'); state=await waitState(value=>value.preset.source==='triangle');assert.equal(state.capacity,1);
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1);const triangleOwner=state.voices[0].id;assert.equal(state.voices[0].channel,2);await sound();
    await page.keyboard.down('s');state=await waitState(value=>value.voices.length===1&&value.voices[0].id!==triangleOwner);const triangleNew=state.voices[0].id;
    await page.keyboard.up('a');assert.equal((await inspect()).voices[0].id,triangleNew);await page.keyboard.up('s');await stop();

    check('Noise keys retrigger one voice; period and short mode change its character live');
    await choose('#source','noise');state=await waitState(value=>value.preset.source==='noise');assert.equal(state.capacity,1);
    for(const selector of pitchWheels)assert.equal(await page.isDisabled(selector),true);await assertPitchUi(0);
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1);const noiseOwner=state.voices[0].id;assert.equal(state.voices[0].channel,3);await sound();
    const noiseAttacks=await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length), oldNoise=state.registers[14];
    await number('#noisePeriod',8);state=await waitState(value=>value.preset.noise.period===8);assert.equal(state.voices[0].id,noiseOwner);assert.notEqual(state.registers[14],oldNoise);
    await choose('#noiseShortMode',true);state=await waitState(value=>value.preset.noise.shortMode);assert.equal(state.voices[0].id,noiseOwner);await sound();
    assert.equal(await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length),noiseAttacks);
    const noiseRegister=state.registers[14];
    await page.keyboard.down('s');state=await waitState(value=>value.voices.length===1&&value.voices[0].id!==noiseOwner);assert.equal(state.registers[14],noiseRegister);
    await page.keyboard.up('a');assert.equal((await inspect()).voices[0].id,state.voices[0].id);await page.keyboard.up('s');await stop();
    await page.locator('#noisePeriod').focus();await page.keyboard.press('Home');await waitState(value=>value.preset.noise.period===0);assert.equal(await stepButton('#noisePeriod',-1).isDisabled(),true);
    await page.keyboard.press('End');await waitState(value=>value.preset.noise.period===15);assert.equal(await stepButton('#noisePeriod',1).isDisabled(),true);
    await number('#noisePeriod',8);
    await page.locator('#noisePeriod').focus();await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();await page.keyboard.up('a');await waitState(value=>value.voices.length===0);

    check('FDS Wave drawing applies on release and stores exactly 64 six-bit samples');
    await choose('#source','fds');state=await waitState(value=>value.preset.source==='fds');assert.equal(state.capacity,1);
    for(const selector of pitchWheels)assert.equal(await page.isDisabled(selector),false);
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1);assert.equal(state.voices[0].channel,5);await sound();
    const fdsOwner=state.voices[0].id,waveBefore=[...state.preset.fds.wave];
    const canvas=page.locator('#fdsCanvas');await canvas.scrollIntoViewIfNeeded();let rect=await canvas.boundingBox();assert(rect);
    await page.mouse.move(rect.x+rect.width*.15,rect.y+rect.height*.2);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.8,rect.y+rect.height*.75,{steps:12});
    state=await inspect();assert.deepEqual(state.preset.fds.wave,waveBefore);assert.equal(state.voices[0].id,fdsOwner);
    await page.mouse.up();state=await waitState(value=>JSON.stringify(value.preset.fds.wave)!==JSON.stringify(waveBefore));assert.equal(state.voices.length,0);
    assert.equal(state.preset.fds.wave.length,64);assert(state.preset.fds.wave.every(value=>Number.isInteger(value)&&value>=0&&value<=63));
    await page.keyboard.up('a');await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();await page.keyboard.up('a');await stop();
    await page.click('[data-wave-shape="saw"]');state=await waitState(value=>value.preset.fds.wave[0]===0&&value.preset.fds.wave.at(-1)>=61);
    assert(state.preset.fds.wave.every((value,index,wave)=>index===0||value>=wave[index-1]));
    await page.click('[data-wave-shape="sine"]');await waitState(value=>value.preset.fds.wave[0]>0);
    const originalTable=[...(await inspect()).preset.fds.modulation.table];
    await page.click('[data-fds-edit="modulation"]');await page.click('[data-mod-code="2"]');
    await canvas.scrollIntoViewIfNeeded();rect=await canvas.boundingBox();assert(rect);
    await page.mouse.move(rect.x+rect.width*.1,rect.y+rect.height*.4);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.5,{steps:10});
    assert.deepEqual((await inspect()).preset.fds.modulation.table,originalTable);
    await page.mouse.up();state=await waitState(value=>JSON.stringify(value.preset.fds.modulation.table)!==JSON.stringify(originalTable));
    assert.equal(state.preset.fds.modulation.table.length,32);assert(state.preset.fds.modulation.table.every(value=>Number.isInteger(value)&&value>=0&&value<=7));assert(state.preset.fds.modulation.table.includes(2));
    await page.click('[data-mod-shape="vibrato"]');await page.click('[data-fds-edit="wave"]');

    check('FDS hardware modulation changes actual measured output, keeping note ownership');
    await page.keyboard.down('f');state=await waitState(value=>value.voices.length===1);await sound();
    const modOwner=state.voices[0].id;assert.equal(state.preset.fds.modulation.enabled,false);
    await page.waitForTimeout(150);const beforeMod=await averagedSpectrum();
    await page.check('#fdsModEnabled');state=await waitState(value=>value.preset.fds.modulation.enabled);assert.equal(state.voices[0].id,modOwner);
    assert(state.preset.fds.modulation.depth>0&&state.preset.fds.modulation.rate>0);
    await page.waitForTimeout(250);const afterMod=await averagedSpectrum(),modulationDifference=compareSpectra(beforeMod,afterMod);
    assert(modulationDifference>.005,'FDS modulation changed the rendered frequency spectrum; distance '+modulationDifference);
    const beforeDepth=state.preset.fds.modulation.depth;await number('#fdsModDepth',Math.min(63,beforeDepth+1));state=await waitState(value=>value.preset.fds.modulation.depth===Math.min(63,beforeDepth+1));assert.equal(state.voices[0].id,modOwner);
    const beforeRate=state.preset.fds.modulation.rate;await number('#fdsModRate',beforeRate+1);state=await waitState(value=>value.preset.fds.modulation.rate===beforeRate+1);assert.equal(state.voices[0].id,modOwner);
    await number('#fdsModBias',-1);state=await waitState(value=>value.preset.fds.modulation.bias===-1);assert.equal(state.registers[0x85],127);assert.equal(state.voices[0].id,modOwner);
    await number('#fdsModBias',0);await number('#fdsVolume',25);state=await waitState(value=>value.preset.fds.volume===25);assert.equal(state.voices[0].id,modOwner);
    await choose('#fdsMaster',1);state=await waitState(value=>value.preset.fds.master===1);assert.equal(state.registers[0x89],1);assert.equal(state.voices[0].id,modOwner);
    await choose('#fdsMaster',0);await sound();
    await page.keyboard.up('f');await stop();

    check('portable presets, actual import, invalid input atomicity, JavaScript export');
    const downloadEvent=page.waitForEvent('download');await page.click('#savePreset');const download=await downloadEvent;
    assert.equal(download.suggestedFilename(),'2a03-voice.json');
    const portable=JSON.parse(await fs.readFile(await download.path(),'utf8'));
    assert.equal(portable.format,'tetorica-nes-fds-voice');assert.equal(portable.source,'fds');assert.equal(portable.fds.wave.length,64);assert.equal(portable.fds.modulation.table.length,32);
    await page.click('#resetPreset');await waitState(value=>value.preset.source==='pulse');
    await page.setInputFiles('#presetFileInput',{name:'self-authored-nes-voice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(portable))});
    state=await waitState(value=>value.preset.source==='fds'&&value.preset.fds.modulation.enabled);assert.deepEqual(state.preset,portable);
    await page.click('#copyCode');await page.waitForFunction(()=>!document.querySelector('#codeOutput').hidden);
    const copied=await page.locator('#codeOutput').inputValue();assert.match(copied,/nes\.fds\.setWave/);assert.match(copied,/setModulation/);
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1);await sound();const heldBeforeError=structuredClone(state);
    const invalid=structuredClone(portable);invalid.fds.wave[0]=64;
    await page.setInputFiles('#presetFileInput',{name:'invalid-nes-voice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
    await page.waitForFunction(()=>document.querySelector('#audioStatus').dataset.error==='true');
    state=await inspect();assert.deepEqual(state.preset,heldBeforeError.preset);assert.deepEqual(state.voices,heldBeforeError.voices);await sound();
    await page.keyboard.up('a');await stop();

    check('VGM / VGZ voice selection maps both Pulse channels, Triangle, Noise and complete FDS tables');
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1);await sound();
    const beforeVgm=structuredClone(state);
    await page.setInputFiles('#vgmFileInput',{name:'self-authored-2a03.vgm',mimeType:'application/octet-stream',buffer:makeInstrumentVgm()});
    await page.waitForFunction(()=>document.querySelector('#vgmLibrary').dataset.loading==='false'&&document.querySelector('#vgmFileName').textContent==='self-authored-2a03.vgm'&&document.querySelectorAll('[data-vgm-voice]').length===5);
    state=await inspect();assert.deepEqual(state.preset,beforeVgm.preset);assert.deepEqual(state.voices,beforeVgm.voices);
    assert.equal(await page.locator('[data-vgm-voice][aria-pressed=true]').count(),0);
    const importVoice=async(index,predicate)=>{
      await page.locator('[data-vgm-voice]').nth(index).click();
      const current=await waitState(value=>predicate(value.preset));
      await page.waitForFunction(index=>document.querySelectorAll('[data-vgm-voice]')[index]?.getAttribute('aria-pressed')==='true',index);
      assert.equal(current.voices.length,0,'selecting a VGM voice stops held notes');
      assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.matches('input:not([type=range]),select,textarea'))),false);
      await page.keyboard.up('a');await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();
      await page.keyboard.up('a');await waitState(value=>value.voices.length===0);
      return current;
    };
    state=await importVoice(0,preset=>preset.source==='pulse'&&preset.pulse.volume===10&&preset.pulse.sweep.enabled);
    assert.equal(state.preset.pulse.duty,.5);assert.equal(state.preset.pulse.envelope.enabled,false);
    assert.deepEqual(state.preset.pulse.sweep,{enabled:true,period:2,negate:true,shift:1});assert.equal(state.capacity,2);
    state=await importVoice(1,preset=>preset.source==='pulse'&&preset.pulse.volume===9&&!preset.pulse.sweep.enabled);
    assert.equal(state.preset.pulse.duty,.25);assert.equal(state.capacity,2);
    state=await importVoice(2,preset=>preset.source==='triangle');assert.equal(state.capacity,1);
    state=await importVoice(3,preset=>preset.source==='noise'&&preset.noise.volume===11);
    assert.deepEqual(state.preset.noise,{volume:11,period:3,shortMode:true});
    state=await importVoice(4,preset=>preset.source==='fds'&&preset.fds.volume===24&&preset.fds.modulation.enabled);
    assert.deepEqual(state.preset.fds.wave,vgmWave);assert.equal(state.preset.fds.master,0);
    assert.deepEqual(state.preset.fds.modulation,{enabled:true,table:vgmModulation,rate:256,depth:16,bias:0});
    await page.click('#copyCode');assert.match(await page.locator('#codeOutput').inputValue(),/nes\.fds\.setWave/);
    const importedSaveEvent=page.waitForEvent('download');await page.click('#savePreset');
    const importedSave=await importedSaveEvent,importedPreset=JSON.parse(await fs.readFile(await importedSave.path(),'utf8'));
    assert.deepEqual(importedPreset,state.preset,'imported VGM sound can be saved as a portable instrument');

    check('approximated Noise envelope is shown for the chosen sound');
    await page.setInputFiles('#vgmFileInput',{name:'self-authored-noise-envelope.vgm',mimeType:'application/octet-stream',buffer:makeNoiseEnvelopeVgm()});
    await page.waitForFunction(()=>document.querySelector('#vgmLibrary').dataset.loading==='false'&&document.querySelector('#vgmFileName').textContent==='self-authored-noise-envelope.vgm'&&document.querySelectorAll('[data-vgm-voice]').length===1);
    state=await importVoice(0,preset=>preset.source==='noise'&&preset.noise.volume===15);
    assert.equal(await page.isVisible('#vgmVoiceWarnings'),true);
    assert.match(await page.locator('#vgmVoiceWarnings').textContent(),/envelope|fixed/i);
    await page.setInputFiles('#vgmFileInput',{name:'self-authored-2a03.vgm',mimeType:'application/octet-stream',buffer:makeInstrumentVgm()});
    await page.waitForFunction(()=>document.querySelector('#vgmLibrary').dataset.loading==='false'&&document.querySelector('#vgmFileName').textContent==='self-authored-2a03.vgm'&&document.querySelectorAll('[data-vgm-voice]').length===5);
    await importVoice(3,preset=>preset.source==='noise'&&preset.noise.volume===11);
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1);await sound();
    const beforeBadVgm=structuredClone(state),libraryBeforeError=await page.locator('#vgmVoices').innerText();
    for(const [filename,buffer] of [['broken.vgm',Buffer.from('not a VGM')],['no-nes.vgm',makeInstrumentVgm({nes:false})]]) {
      await page.setInputFiles('#vgmFileInput',{name:filename,mimeType:'application/octet-stream',buffer});
      await page.waitForFunction(()=>document.querySelector('#vgmLibrary').dataset.loading==='false'&&document.querySelector('#vgmStatus').dataset.error==='true');
      state=await inspect();assert.deepEqual(state.preset,beforeBadVgm.preset);assert.deepEqual(state.voices,beforeBadVgm.voices);
      assert.equal(await page.locator('#vgmVoices').innerText(),libraryBeforeError);await sound();
    }

    check('cancelled asynchronous VGM read keeps the library and sounding owner');
    await page.evaluate(()=>{
      const original=File.prototype.arrayBuffer;window.audit.restoreFileRead=()=>{File.prototype.arrayBuffer=original;};
      File.prototype.arrayBuffer=function(...args){
        const bytes=original.apply(this,args);if(this.name!=='slowfixture.vgm')return bytes;
        return bytes.then(value=>new Promise(resolve=>{window.audit.releaseSlowVgm=()=>resolve(value);})).finally(()=>{window.audit.slowVgmCompleted=true;});
      };
    });
    await page.setInputFiles('#vgmFileInput',{name:'slowfixture.vgm',mimeType:'application/octet-stream',buffer:makePagedInstrumentVgm()});
    await page.waitForFunction(()=>typeof window.audit.releaseSlowVgm==='function');
    assert.equal(await page.locator('#vgmLibrary').getAttribute('data-loading'),'true');await page.click('#cancelVgm');
    await page.evaluate(()=>{window.audit.releaseSlowVgm();window.audit.restoreFileRead();});
    await page.waitForFunction(()=>window.audit.slowVgmCompleted===true);
    assert.equal(await page.locator('#vgmLibrary').getAttribute('data-loading'),'false');
    assert.match(await page.locator('#vgmStatus').textContent(),/cancelled.*Current sound kept/);
    assert.equal(await page.locator('#vgmVoices').innerText(),libraryBeforeError);
    state=await inspect();assert.deepEqual(state.preset,beforeBadVgm.preset);assert.deepEqual(state.voices,beforeBadVgm.voices);await sound();
    await page.setInputFiles('#vgmFileInput',{name:'self-authored-2a03.vgz',mimeType:'application/gzip',buffer:gzipSync(makeInstrumentVgm())});
    await page.waitForFunction(()=>document.querySelector('#vgmLibrary').dataset.loading==='false'&&document.querySelector('#vgmFileName').textContent==='self-authored-2a03.vgz'&&document.querySelector('#vgmStatus').dataset.error!=='true'&&document.querySelectorAll('[data-vgm-voice]').length===5);
    state=await inspect();assert.deepEqual(state.preset,beforeBadVgm.preset);assert.deepEqual(state.voices,beforeBadVgm.voices);
    await page.keyboard.up('a');await waitState(value=>value.voices.length===0);
    if(config.screenshots) {
      await page.setViewportSize({width:390,height:844});
      await page.waitForFunction(()=>{const canvas=document.querySelector('#outputCanvas');return canvas.width===Math.max(240,Math.round(canvas.clientWidth));});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,'VGM library fits a narrow screen');await screenshot('vgm-mobile');
      await page.setViewportSize({width:1180,height:940});
    }
    await page.click('#closeVgm');assert.equal(await page.isVisible('#vgmLibrary'),false);
    assert.deepEqual((await inspect()).preset,beforeBadVgm.preset);
    await choose('#source','pulse');await choose('#pulseDuty',.125);await choiceButton('#pulseDuty',.125).focus();await page.keyboard.press('ArrowRight');await waitState(value=>value.preset.pulse.duty===.25);
    await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();await page.keyboard.up('a');await waitState(value=>value.voices.length===0);
    await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await waitState(value=>value.voices.length===0);await page.keyboard.up('a');

    check('desktop/mobile layout and explicit AudioContext recovery');
    await screenshot('desktop');
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>{const canvas=document.querySelector('#outputCanvas');return canvas.width===Math.max(240,Math.round(canvas.clientWidth));});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1,name+' mobile overflow '+overflow);await assertPitchPositions();await screenshot('mobile');
    await choose('#source','fds');await page.click('[data-fds-edit="modulation"]');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,'FDS editor fits a narrow screen');await screenshot('fds-mobile');
    await page.setViewportSize({width:1180,height:940});
    await page.evaluate(()=>window.audit.contexts.at(-1).close());
    await page.waitForFunction(()=>document.querySelector('#audioStatus').textContent.includes('AudioContext was closed')&&!document.querySelector('#startAudio').disabled);
    await page.click('#startAudio');await page.waitForFunction(()=>document.querySelector('#audioStatus').textContent.startsWith('Audio ready'));
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),2);
    await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();await page.keyboard.up('a');await stop();
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
    console.log('PASS '+name+': standalone 2A03 Synth');
    return {engine:name,sampleRate:await page.evaluate(()=>window.audit.contexts.at(-1).sampleRate),pulseLevel,modulationDifference,
      productName:'Tetorica 2A03 Synth',productIcon:true,localFavicons:true,legacyRedirect,lazyStartup:true,editingSilent:true,startupLatestSource:true,startupLatestMaster:true,startupKeyRelease:true,
      physicalPulseRoundRobin:true,lateReleaseSafe:true,sweepBothPulseChannels:true,triangleMonophonic:true,noiseMonophonic:true,fdsMonophonic:true,
      pairedPitchWheels:true,pitchPositions:true,pitchUiSync:true,pitchSpringReset:true,focusedPitchKeyboardPerformance:true,
      masterMuteRestore:true,master380:true,buttonSteppers:true,choiceKeyboardAccess:true,noiseLiveTexture:true,noiseIgnoresNotePitch:true,
      fdsWaveDrawing:true,fdsModulationDrawing:true,fdsModulationAudible:true,presetRoundTrip:true,invalidPresetAtomic:true,copyJavaScript:true,
      vgmImportSilent:true,vgmFiveVoices:true,vgmSourceFilters:true,vgmPaging:true,vgmSelectionKeyboard:true,vgmImportedPresetExport:true,
      vgmFileNotesExpandable:true,vgmApproximationVisible:true,vgmFailuresKeepSound:true,vgmCancelKeepsSound:true,vgzImport:true,vgmCloseKeepsSound:true,
      blurRelease:true,contextRecovery:true,finalDestinationMeasurement:true,physicalOutput:'muted',mobileOverflow:overflow,pageErrors:errors,missingAssets:missing,externalRequests:external};
  } catch (error) {
    if (page && config.screenshots) await page.screenshot({path:path.join(config.screenshots,`2a03-${name}-failure.png`),fullPage:true}).catch(() => {});
    error.message = `${name}, ${stage}: ${error.message}; pageErrors=${JSON.stringify(errors)}; missing=${JSON.stringify(missing)}`;
    throw error;
  } finally {releaseInitialWasm(); await browser.close();}
}

(async () => {
  await fs.mkdir(path.dirname(config.out),{recursive:true});
  if (config.screenshots) await fs.mkdir(config.screenshots,{recursive:true});
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
      const filename = path.resolve(config.root, `.${pathname}`);
      if (!filename.startsWith(config.root + path.sep)) throw new Error('Outside server root');
      const bytes = await fs.readFile(filename);
      response.writeHead(200, {'Content-Type':mime[path.extname(filename)] ?? 'application/octet-stream'}); response.end(bytes);
    } catch {response.writeHead(404); response.end();}
  });
  const rows = [];
  try {
    await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [name,engine] of [['chromium',chromium],['webkit',webkit]]) rows.push(await runEngine(name,engine,origin));
    await fs.writeFile(config.out,JSON.stringify({passed:true,entry:config.entry,rows},null,2)+'\n');
    console.log(`2A03 Synth browser check passed: ${rows.length} browsers; ${config.out}`);
  } catch (error) {
    await fs.writeFile(config.out,JSON.stringify({passed:false,entry:config.entry,error:error.message,rows},null,2)+'\n');
    throw error;
  } finally {if (server.listening) await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);process.exitCode = 1;});
