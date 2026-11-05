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
function makeFdsEnvelopeVgm() {
  const w=vgmWrite;
  return vgmBytes([
    ...w(0x3f,2),...w(0x23,0xc0),...w(0x29,0x80),...vgmWave.flatMap((value,index)=>w(0x40+index,value)),...w(0x29,0),
    ...w(0x27,0x80),...vgmModulation.flatMap(value=>w(0x28,value)),...w(0x24,0x80),...w(0x25,0),...w(0x26,0),
    ...w(0x20,0x80),...w(0x2a,232),...w(0x20,0x48),...w(0x22,0x90),...w(0x23,1),0x66,
  ]);
}
function makeFdsDepthEnvelopeVgm() {
  const w=vgmWrite;
  return vgmBytes([
    ...w(0x3f,2),...w(0x23,0xc0),...w(0x29,0x80),...vgmWave.flatMap((value,index)=>w(0x40+index,value)),...w(0x29,0),
    ...w(0x27,0x80),...vgmModulation.flatMap(value=>w(0x28,value)),...w(0x25,0),...w(0x26,0),
    ...w(0x20,0x98),...w(0x24,0x80),...w(0x2a,232),...w(0x24,0x48),...w(0x27,1),...w(0x22,0x90),...w(0x23,1),0x66,
  ]);
}
const dpcmBytes = length => Buffer.from(Array.from({length}, (_,index)=>index%8<4?0xff:0));
function expectedDmcPreview(data, initial, rate, loop) {
  const hardwareBytes=data.length ? Math.ceil((data.length-1)/16)*16+1 : 0;
  const padded=[...data,...Array(hardwareBytes-data.length).fill(0xaa)];
  const decode=start=>{
    let level=start;
    for(const byte of padded)for(let bit=0;bit<8;bit++){
      if(byte&(1<<bit)){if(level<=125)level+=2;}else if(level>=2)level-=2;
    }
    return level;
  };
  const end=decode(initial),period=[428,380,340,320,286,254,226,214,190,160,142,128,106,84,72,54][rate];
  return {startLevel:initial,endLevel:end,bitCount:hardwareBytes*8,durationMs:hardwareBytes*8*period/1789773*1000,
    nextStartLevel:loop?end:null,nextEndLevel:loop?decode(end):null};
}
const vgmDmcFirst = dpcmBytes(257), vgmDmcSecond = dpcmBytes(17);
function dmcRamBlock(address, data) {
  const header = Buffer.alloc(9); header.set([0x67,0x66,0xc2]);
  header.writeUInt32LE(data.length + 2,3); header.writeUInt16LE(address,7);
  return [...header,...data];
}
function makeDmcInstrumentVgm({missing = false, mixed = false} = {}) {
  const w = vgmWrite, commands = [
    ...w(0x15,0), ...dmcRamBlock(0xc040,missing ? vgmDmcFirst.subarray(0,256) : vgmDmcFirst),
    ...w(0x10,0x4f), ...w(0x11,66), ...w(0x12,1), ...w(0x13,16), ...w(0x15,0x10), 0x61,0xe8,3,
  ];
  if (!missing) commands.push(...w(0x15,0), ...dmcRamBlock(0xc040,vgmDmcSecond),
    ...w(0x10,0x47), ...w(0x11,32), ...w(0x12,1), ...w(0x13,1), ...w(0x15,0x10));
  const existing = mixed ? [...makeInstrumentVgm().subarray(256,-1)] : [];
  return vgmBytes([...existing,...commands,0x66],{fds:mixed});
}
function makeBankDmcVgm() {
  const bank = Buffer.concat([Buffer.from([1,2,3]),vgmDmcSecond]);
  const block = data => {
    const header=Buffer.from([0x67,0x66,7,0,0,0,0]); header.writeUInt32LE(data.length,3); return [...header,...data];
  };
  const copy=Buffer.from([0x68,0x66,7,0,0,0,0,0,0,0,0,0]);
  copy.writeUIntLE(3,3,3); copy.writeUIntLE(0xc080,6,3); copy.writeUIntLE(17,9,3);
  return vgmBytes([...block(bank.subarray(0,10)),...block(bank.subarray(10)),...copy,
    ...vgmWrite(0x10,0x4a),...vgmWrite(0x11,48),...vgmWrite(0x12,2),...vgmWrite(0x13,1),...vgmWrite(0x15,16),0x66],{fds:false});
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
      const output=page.locator(selector),start=Number(await output.textContent());
      const min=Number(await output.getAttribute('aria-valuemin')),max=Number(await output.getAttribute('aria-valuemax'));
      // Exercise the public Home / End controls for large ranges such as the
      // FDS master clock, then use actual pointer steps for the remaining gap.
      if(Math.abs(value-min)<Math.abs(value-start)||Math.abs(value-max)<Math.abs(value-start)) {
        const home=Math.abs(value-min)<=Math.abs(value-max);
        await output.focus();await page.keyboard.press(home?'Home':'End');
        await page.waitForFunction(({selector,next})=>Number(document.querySelector(selector).textContent)===next,{selector,next:home?min:max});
      }
      for (let attempt = 0; attempt <= 4096; attempt++) {
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
    const dmcBit = (byte,bit) => page.locator(`#dmcBitEditor button[data-dmc-byte="${byte}"][data-dmc-bit="${bit}"]`);
    const dmcHistory = () => page.locator('#dmcBitEditor').evaluate(node => ({
      undo:Number(node.dataset.undoCount),redo:Number(node.dataset.redoCount),
    }));
    const downloadDpcm = async (expected, {programmatic = false} = {}) => {
      const before = {history:await dmcHistory(),contexts:await page.evaluate(()=>window.audit.contexts.length),
        rate:await page.locator('#dmcRate').textContent(),level:await page.locator('#dmcLevel').textContent(),loop:await page.isChecked('#dmcLoop')};
      const event=page.waitForEvent('download');
      if(programmatic)await page.locator('#saveDpcm').evaluate(node=>node.click());
      else await page.click('#saveDpcm');
      const download=await event;
      assert.equal(download.suggestedFilename(),'2a03-sample.dmc');
      assert.equal(await download.failure(),null);
      const bytes=await fs.readFile(await download.path());
      assert.deepEqual(bytes,Buffer.from(expected),'raw DPCM export contains exactly the committed original bytes, without padding or metadata');
      assert.deepEqual(await dmcHistory(),before.history,'downloading a sample does not mutate Undo / Redo');
      assert.equal(await page.evaluate(()=>window.audit.contexts.length),before.contexts,'downloading never creates an audio device');
      assert.equal(await page.locator('#dmcRate').textContent(),before.rate);assert.equal(await page.locator('#dmcLevel').textContent(),before.level);assert.equal(await page.isChecked('#dmcLoop'),before.loop);
      if(!programmatic)assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.matches('input,select,textarea,#saveDpcm'))),false,'pointer save returns focus to musical keys');
      return bytes;
    };
    const assertDmcHistory = async (undo,redo) => {
      assert.deepEqual(await dmcHistory(),{undo,redo},'DMC history records committed data edits only');
      assert.equal(await page.isDisabled('#dmcUndo'),undo===0,'Undo availability matches its history');
      assert.equal(await page.isDisabled('#dmcRedo'),redo===0,'Redo availability matches its history');
      assert.match(await page.locator('#dmcHistoryStatus').textContent(),new RegExp(`\\b${undo}\\b`));
      assert.match(await page.locator('#dmcHistoryStatus').textContent(),new RegExp(`\\b${redo}\\b`));
    };
    const dmcShortcut = (locator,key,modifiers = {ctrlKey:true}) => locator.evaluate((node,{key,modifiers}) => {
      node.focus();
      const event = new KeyboardEvent('keydown',{key,code:`Key${key.toUpperCase()}`,...modifiers,bubbles:true,cancelable:true});
      node.dispatchEvent(event);return event.defaultPrevented;
    },{key,modifiers});
    const assertDmcPreview = async preset => {
      const actual=await page.locator('#dmcDacCanvas').evaluate(canvas=>({...canvas.dataset}));
      const expected=expectedDmcPreview(preset.dmc.data,preset.dmc.level,preset.dmc.rate,preset.dmc.loop);
      for(const key of ['startLevel','endLevel','bitCount'])assert.equal(Number(actual[key]),expected[key],`DAC preview ${key}`);
      assert(Math.abs(Number(actual.durationMs)-expected.durationMs)<.0001,'DAC preview duration follows the hardware bit clock');
      for(const key of ['nextStartLevel','nextEndLevel']) {
        if(expected[key]===null)assert.equal(actual[key],'',`no second-pass ${key} with Loop off`);
        else assert.equal(Number(actual[key]),expected[key],`DAC preview ${key} carries the previous pass rather than resetting`);
      }
      return actual;
    };
    const dmcFirst = async () => {if(!await page.isDisabled('#dmcBitsFirst'))await page.click('#dmcBitsFirst');};
    const dmcDrawPoint = async (fraction, level) => {
      const canvas=page.locator('#dmcDacCanvas');await canvas.scrollIntoViewIfNeeded();
      return canvas.evaluate((node,{fraction,level})=>{
        const rect=node.getBoundingClientRect(),left=32,right=node.width-14,top=18,bottom=node.height-30;
        return {x:rect.left+(left+(right-left)*fraction)*rect.width/node.width,
          y:rect.top+(bottom-level/127*(bottom-top))*rect.height/node.height};
      },{fraction,level});
    };
    const startDmcDraw = async (fraction, level) => {
      await page.locator('#dmcDacCanvas').evaluate(node=>node.addEventListener('pointerdown',event=>{window.audit.dmcDrawPointer=event.pointerId;},{once:true}));
      const point=await dmcDrawPoint(fraction,level);await page.mouse.move(point.x,point.y);await page.mouse.down();
    };
    const moveDmcDraw = async (fraction, level, steps=1) => {
      const point=await dmcDrawPoint(fraction,level);await page.mouse.move(point.x,point.y,{steps});
    };
    const dmcDrawing = () => page.locator('#dmcDacCanvas').getAttribute('data-drawing');
    const cancelDmcPointer = async () => {
      const pointerId=await page.evaluate(()=>window.audit.dmcDrawPointer);
      await page.dispatchEvent('#dmcDacCanvas','pointercancel',{pointerId,pointerType:'mouse',bubbles:true});
      await page.mouse.up();
      assert.notEqual(await dmcDrawing(),'true');
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
    const screenshot = async (label, {fullPage = true} = {}) => {
      if(config.screenshots) await page.screenshot({path:path.join(config.screenshots,'2a03-'+name+'-'+label+'.png'),fullPage});
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
    assert.equal(await page.locator('#source [role=radio]').count(),5);
    await number('#pulseVolume',11); await number('#pulseVolume',10);
    await choose('#pulseDuty',.25);
    await page.fill('#instrumentName','NES browser audit'); await page.press('#instrumentName','Enter');
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
    assert.equal(await page.locator('#keyboard .key').count(),36);

    check('Noise hardware Envelope controls edit passively and distinguish fixed volume from decay');
    await choose('#source','noise');
    assert.equal(await stepButton('#noiseEnvelopePeriod',1).isDisabled(),true);
    assert.equal(await page.isDisabled('#noiseEnvelopeLoop'),true);
    assert.equal(await stepButton('#noiseVolume',1).isDisabled(),false);
    await page.check('#noiseEnvelopeEnabled');
    assert.equal(await stepButton('#noiseVolume',1).isDisabled(),true);
    assert.equal(await page.isDisabled('#noiseEnvelopeLoop'),false);
    await number('#noiseEnvelopePeriod',1);await number('#noiseEnvelopePeriod',8);
    await page.check('#noiseEnvelopeLoop');await page.uncheck('#noiseEnvelopeLoop');
    await page.uncheck('#noiseEnvelopeEnabled');
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);

    check('FDS volume Envelope controls are passive and keep fixed gain separate from the initial gain');
    await choose('#source','fds');
    assert.equal(await stepButton('#fdsEnvelopePeriod',1).isDisabled(),true);assert.equal(await page.isDisabled('#fdsEnvelopeHalt'),true);
    await page.check('#fdsEnvelopeEnabled');assert.equal(await stepButton('#fdsVolume',1).isDisabled(),true);
    await choose('#fdsEnvelopeIncrease',true);await choose('#fdsEnvelopeIncrease',false);
    await number('#fdsEnvelopeInitialGain',0);await number('#fdsEnvelopeInitialGain',32);
    await page.check('#fdsEnvelopeHalt');await page.uncheck('#fdsEnvelopeHalt');await page.uncheck('#fdsEnvelopeEnabled');
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);

    check('FDS Depth Envelope shares the clock without enabling the volume Envelope');
    assert.equal(await page.isDisabled('#fdsModEnvelopeEnabled'),true);
    await page.check('#fdsModEnabled');await page.check('#fdsModEnvelopeEnabled');
    assert.equal(await page.isChecked('#fdsEnvelopeEnabled'),false);
    assert.equal(await stepButton('#fdsEnvelopeMasterSpeed',1).isDisabled(),false);
    assert.equal(await stepButton('#fdsModDepth',1).isDisabled(),true);
    await choose('#fdsModEnvelopeIncrease',false);await choose('#fdsModEnvelopeIncrease',true);
    await number('#fdsModEnvelopeInitialGain',63);await number('#fdsModEnvelopeInitialGain',0);
    await page.uncheck('#fdsModEnvelopeEnabled');await page.uncheck('#fdsModEnabled');
    assert.equal(await page.isDisabled('#fdsEnvelopeHalt'),true);
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);

    check('DPCM demo and file loading are passive; an empty DMC source explains its sample requirement');
    await choose('#source','dmc');
    for(const selector of pitchWheels)assert.equal(await page.isDisabled(selector),true);
    assert.equal(await page.locator('#keyboard .key:disabled').count(),36);
    assert.equal(await page.isDisabled('#saveDpcm'),true,'an empty DMC draft cannot be exported');
    assert.match(await page.locator('#dpcmStatus').textContent(),/load|sample/i);
    await page.click('#demoDpcm');
    await page.waitForFunction(()=>document.querySelectorAll('#keyboard .key:disabled').length===0);
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
    const dpcmChooser=page.waitForEvent('filechooser');await page.click('#loadDpcm');
    await (await dpcmChooser).setFiles({name:'self-authored-32.dmc',mimeType:'application/octet-stream',buffer:dpcmBytes(32)});
    await page.waitForFunction(()=>/32.*bytes/i.test(document.querySelector('#dpcmStatus').textContent)&&document.querySelector('#dpcmStatus').dataset.error!=='true');
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
    assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.matches('input:not([type=range]),select,textarea'))),false);
    check('raw DPCM download is passive and preserves 32 original bytes rather than generated 33-byte hardware data');
    assert.equal(await page.isDisabled('#saveDpcm'),false);await downloadDpcm(dpcmBytes(32));
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);

    check('DMC Undo/Redo is passive, branches only on a changed edit and scopes shortcuts to editor focus');
    await assertDmcHistory(0,0);
    for(const [key,modifiers] of [['z',{ctrlKey:true}],['z',{metaKey:true,shiftKey:true}],['y',{ctrlKey:true}]]) {
      assert.equal(await dmcShortcut(dmcBit(0,0),key,modifiers),false,'unavailable DMC history leaves host shortcuts available');
    }
    await dmcBit(0,0).click();await assertDmcHistory(1,0);
    assert.equal(await dmcBit(0,0).getAttribute('aria-pressed'),'false');
    await page.click('#dmcUndo');await assertDmcHistory(0,1);
    assert.equal(await dmcBit(0,0).getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>document.activeElement?.closest('#dmcBitEditor')!==null),false,'pointer Undo returns focus to musical keys');
    await page.click('#dmcRedo');await assertDmcHistory(1,0);
    assert.equal(await dmcBit(0,0).getAttribute('aria-pressed'),'false');
    assert.equal(await dmcShortcut(dmcBit(0,0),'z',{metaKey:true}),true);await assertDmcHistory(0,1);
    await dmcBit(0,0).focus();await page.keyboard.press('1');await assertDmcHistory(0,1);
    assert.equal(await dmcShortcut(dmcBit(0,0),'z',{ctrlKey:true,shiftKey:true}),true);await assertDmcHistory(1,0);
    assert.equal(await dmcShortcut(dmcBit(0,0),'z'),true);await assertDmcHistory(0,1);
    assert.equal(await dmcShortcut(dmcBit(0,0),'y'),true);await assertDmcHistory(1,0);
    assert.equal(await dmcShortcut(dmcBit(0,0),'z'),true);await assertDmcHistory(0,1);
    await dmcBit(0,1).click();await assertDmcHistory(1,0);
    assert.equal(await dmcBit(0,0).getAttribute('aria-pressed'),'true');
    assert.equal(await dmcBit(0,1).getAttribute('aria-pressed'),'false','a different bit edit creates a fresh branch');
    for(const locator of [page.locator('#instrumentName'),page.locator('body')]) {
      assert.equal(await dmcShortcut(locator,'z'),false,'shortcuts outside the DMC editor remain available to the page');
      await assertDmcHistory(1,0);
    }
    await page.locator('#dmcBitEditor').evaluate(node=>{
      const input=document.createElement('textarea');input.id='auditDmcTextInput';node.append(input);
    });
    assert.equal(await dmcShortcut(page.locator('#auditDmcTextInput'),'z'),false,'native text Undo is not captured inside the editor');
    await page.locator('#auditDmcTextInput').evaluate(node=>node.remove());await assertDmcHistory(1,0);
    await number('#dmcRate',14);await number('#dmcLevel',65);await page.check('#dmcLoop');await assertDmcHistory(1,0);
    await choose('#source','pulse');await choose('#source','dmc');await assertDmcHistory(1,0);
    await page.click('#dmcUndo');await assertDmcHistory(0,1);
    await assertDmcPreview({dmc:{data:[...dpcmBytes(32)],level:65,rate:14,loop:true}});
    assert.equal(await page.locator('#dmcRate').textContent(),'14');assert.equal(await page.locator('#dmcLevel').textContent(),'65');assert.equal(await page.isChecked('#dmcLoop'),true);
    await page.click('#dmcRedo');await assertDmcHistory(1,0);
    assert.equal(await page.locator('#dmcRate').textContent(),'14');assert.equal(await page.locator('#dmcLevel').textContent(),'65');assert.equal(await page.isChecked('#dmcLoop'),true);
    await dmcBit(0,1).click();await assertDmcHistory(2,0);
    await number('#dmcRate',15);await number('#dmcLevel',64);await page.uncheck('#dmcLoop');
    await page.setInputFiles('#dpcmFileInput',{name:'self-authored-32.dmc',mimeType:'application/octet-stream',buffer:dpcmBytes(32)});
    await page.waitForFunction(()=>document.querySelector('#dmcBitEditor').dataset.undoCount==='0');
    await assertDmcHistory(0,0);
    assert.equal(await dmcBit(0,0).getAttribute('aria-pressed'),'true');assert.equal(await dmcBit(0,1).getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0,'Undo, Redo and all history operations stay passive');

    check('DMC bits edit passively in playback order and generated padding stays distinct');
    await page.waitForSelector('#dmcBitEditor');assert.equal(await page.isVisible('#dmcDacCanvas'),true);
    assert.equal(await dmcBit(0,0).getAttribute('aria-pressed'),'true');
    const passiveWave=await page.locator('#dmcDacCanvas').evaluate(canvas=>canvas.toDataURL());
    await dmcBit(0,0).click();
    await page.waitForFunction(()=>document.querySelector('[data-dmc-byte="0"][data-dmc-bit="0"]').getAttribute('aria-pressed')==='false');
    const passiveBitData=Buffer.from(dpcmBytes(32));passiveBitData[0]^=1;await downloadDpcm(passiveBitData);
    assert.match(await page.locator('#dmcBitReadout').textContent(),/64\s*(?:→|->)\s*62/,'the first played zero lowers the DAC by two');
    assert.notEqual(await page.locator('#dmcDacCanvas').evaluate(canvas=>canvas.toDataURL()),passiveWave,'a bit edit redraws its DAC trace immediately');
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
    for(const digit of [0,1]) {
      const unchanged=!digit;
      await dmcBit(0,0).focus();await page.keyboard.press(String(1-digit));
      await page.waitForFunction(expected=>document.querySelector('[data-dmc-byte="0"][data-dmc-bit="0"]').getAttribute('aria-pressed')===String(expected),unchanged);
      assert.equal(await page.evaluate(()=>document.activeElement?.dataset.dmcByte==='0'&&document.activeElement?.dataset.dmcBit==='0'),true,'keyboard editing retains the focused bit');
      for(const modifier of ['ctrlKey','metaKey','altKey']) {
        // Dispatch the chord to avoid native Ctrl/Meta+digit tab shortcuts in
        // the test browser; ordinary unmodified editing below uses real keys.
        const prevented=await dmcBit(0,0).evaluate((node,{digit,modifier})=>{
          const event=new KeyboardEvent('keydown',{key:String(digit),code:`Digit${digit}`,[modifier]:true,bubbles:true,cancelable:true});
          node.dispatchEvent(event);return event.defaultPrevented;
        },{digit,modifier});
        assert.equal(prevented,false,`${modifier}+${digit} remains available to the host`);
        assert.equal(await dmcBit(0,0).getAttribute('aria-pressed'),String(unchanged),'modified numeric shortcuts do not edit DPCM');
        assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
      }
    }
    for(const key of ['1','0','Enter','Space']) {
      await dmcBit(0,0).focus();await page.keyboard.press(key);
      const expected=key==='1'||key==='Enter';
      await page.waitForFunction(expected=>document.querySelector('[data-dmc-byte="0"][data-dmc-bit="0"]').getAttribute('aria-pressed')===String(expected),expected);
      assert.equal(await page.evaluate(()=>window.audit.contexts.length),0,'focused binary edits do not play a computer-key note');
    }
    await dmcBit(0,0).click();assert.equal(await dmcBit(0,0).getAttribute('aria-pressed'),'true');
    await page.click('#dmcBitsLast');
    assert.equal(await page.isDisabled('#dmcBitsNext'),true);
    assert.equal(await dmcBit(32,0).getAttribute('data-dmc-padding'),'true');
    assert.equal(await dmcBit(32,0).isDisabled(),true);
    assert.equal(await dmcBit(32,7).isDisabled(),true);
    assert.match(await page.locator('#dmcBitsPage').textContent(),/33/);
    await dmcFirst();assert.equal(await page.isDisabled('#dmcBitsPrevious'),true);
    assert.equal(await dmcBit(0,0).getAttribute('aria-pressed'),'true');

    check('DMC mouse drawing previews target and bit changes passively, with Escape and padding protection');
    const beforePassiveHistory=await dmcHistory();
    const beforePassiveDraw=await page.locator('#dmcDacCanvas').evaluate(node=>node.toDataURL());
    await startDmcDraw(.02,8);await moveDmcDraw(.98,12,5);
    assert.equal(await dmcDrawing(),'true');
    assert(Number(await page.locator('#dmcDacCanvas').getAttribute('data-target-points'))>20,'sparse pointer movement fills intervening bit targets');
    assert.notEqual(await page.locator('#dmcDacCanvas').evaluate(node=>node.toDataURL()),beforePassiveDraw,'the target and actual draft are visible before release');
    assert.equal(await dmcBit(0,1).getAttribute('aria-pressed'),'false','the bit grid previews drawn down-steps');
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
    await assertDmcHistory(beforePassiveHistory.undo,beforePassiveHistory.redo);
    await downloadDpcm(dpcmBytes(32),{programmatic:true});
    assert.equal(await dmcDrawing(),'true','saving committed bytes does not apply or discard an unfinished drawing');
    assert.equal(await dmcBit(0,1).getAttribute('aria-pressed'),'false','the local preview remains distinct from exported data');
    await page.keyboard.press('Escape');await page.mouse.up();assert.notEqual(await dmcDrawing(),'true');
    assert.equal(await dmcBit(0,1).getAttribute('aria-pressed'),'true','Escape restores original bits');
    await assertDmcHistory(beforePassiveHistory.undo,beforePassiveHistory.redo);
    await assertDmcPreview({dmc:{data:[...dpcmBytes(32)],level:64,rate:15,loop:false}});
    await startDmcDraw(1/32,66);await page.mouse.up();
    assert.notEqual(await dmcDrawing(),'true');await assertDmcHistory(beforePassiveHistory.undo,beforePassiveHistory.redo);
    await page.click('#dmcBitsLast');await startDmcDraw(.2,100);await moveDmcDraw(.8,20);await page.mouse.up();
    assert.notEqual(await dmcDrawing(),'true','generated padding cannot start a drawing');
    await assertDmcHistory(beforePassiveHistory.undo,beforePassiveHistory.redo);
    assert.equal(await dmcBit(32,0).isDisabled(),true);await dmcFirst();
    await page.setInputFiles('#dpcmFileInput',{name:'mixed-padding.dmc',mimeType:'application/octet-stream',buffer:dpcmBytes(2)});
    await page.waitForFunction(()=>/2.*bytes/i.test(document.querySelector('#dpcmStatus').textContent));
    await startDmcDraw(16.2/32,120);await page.mouse.up();
    assert.notEqual(await dmcDrawing(),'true','the first half of a padding bit must not snap back to the last real bit');
    await assertDmcPreview({dmc:{data:[...dpcmBytes(2)],level:64,rate:15,loop:false}});
    await page.setInputFiles('#dpcmFileInput',{name:'self-authored-32.dmc',mimeType:'application/octet-stream',buffer:dpcmBytes(32)});
    await page.waitForFunction(()=>/32.*bytes/i.test(document.querySelector('#dpcmStatus').textContent));
    await assertDmcHistory(0,0);
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
    const passiveDownloadEvent=page.waitForEvent('download');await page.click('#savePreset');
    const passiveDownload=await passiveDownloadEvent,passiveDpcm=JSON.parse(await fs.readFile(await passiveDownload.path(),'utf8'));
    assert.equal(passiveDpcm.version,5);assert.equal(passiveDpcm.source,'dmc');assert.deepEqual(passiveDpcm.dmc.data,[...dpcmBytes(32)]);
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
    await choose('#source','pulse');await page.fill('#instrumentName','NES browser audit');await page.press('#instrumentName','Enter');

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
    for(const kind of ['triangle','noise','dmc','fds']) assert.equal(await page.isDisabled(`[data-vgm-filter="${kind}"]`),true);
    await page.click('#vgmNext');assert.equal(await page.locator('[data-vgm-voice]').count(),6);
    assert.match(await page.locator('#vgmPage').textContent(),/25–30 \/ 30 sounds/);assert.equal(await page.isDisabled('#vgmNext'),true);
    await page.click('#vgmPrevious');assert.equal(await page.locator('[data-vgm-voice]').count(),24);
    await page.click('#closeVgm');assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);

    check('VGM DMC RAM analysis and source filtering stay passive before audio');
    await page.setInputFiles('#vgmFileInput',{name:'self-authored-mixed-dmc.vgm',mimeType:'application/octet-stream',buffer:makeDmcInstrumentVgm({mixed:true})});
    await page.waitForFunction(()=>document.querySelector('#vgmLibrary').dataset.loading==='false'&&document.querySelectorAll('[data-vgm-voice]').length===7);
    assert.equal(await page.evaluate(()=>window.audit.contexts.length),0);
    assert.equal(await page.locator('#instrumentName').inputValue(),'NES browser audit');
    assert.equal(await choiceButton('#source','dmc').getAttribute('aria-checked'),'false');
    assert.match(await page.locator('[data-vgm-filter="dmc"]').textContent(),/^DMC \(2\)$/);
    await page.click('[data-vgm-filter="dmc"]');assert.equal(await page.locator('[data-vgm-voice]').count(),2);
    assert.match(await page.locator('[data-vgm-voice]').first().textContent(),/DMC.*CH5/);
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

    check('Noise hardware Envelope decays in the real core, loops and adopts authored changes on the next trigger');
    await page.check('#noiseEnvelopeEnabled');await number('#noiseEnvelopePeriod',1);
    await waitState(value=>value.preset.noise.envelope.enabled&&value.preset.noise.envelope.period===1);
    assert.equal(await page.evaluate(()=>document.activeElement?.matches('input,select,textarea')),false,'pointer Envelope controls leave musical keys available');
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1);
    assert.equal(state.registers[0x0c],1);await sound();
    state=await waitState(value=>value.coreState.volumes[3]===0);assert.equal(state.voices.length,1,'a finished decay keeps its held-key owner');await silent();
    await page.keyboard.up('a');await waitState(value=>value.voices.length===0);
    await page.check('#noiseEnvelopeLoop');await waitState(value=>value.preset.noise.envelope.loop);
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1);await sound();
    const envelopeNoiseOwner=state.voices[0].id;
    let previousNoiseLevel=15,noiseFell=false,noiseRose=false;
    for(let frame=0;frame<40;frame++) {
      const level=(await inspect()).coreState.volumes[3];
      if(level<previousNoiseLevel)noiseFell=true;
      if(noiseFell&&level>previousNoiseLevel)noiseRose=true;
      previousNoiseLevel=level;await page.waitForTimeout(12);
    }
    assert(noiseFell&&noiseRose,'the hardware decay falls and reloads while Loop is enabled');
    const envelopeNoiseAttacks=await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length);
    await number('#noiseEnvelopePeriod',5);await page.uncheck('#noiseEnvelopeLoop');
    await number('#noisePeriod',7);await choose('#noiseShortMode',false);
    state=await waitState(value=>value.preset.noise.envelope.period===5&&!value.preset.noise.envelope.loop&&value.preset.noise.period===7&&!value.preset.noise.shortMode);
    assert.equal(state.registers[0x0c],0x21,'Envelope settings wait for a fresh trigger even during live clock changes');
    assert.equal(state.registers[0x0e],7);assert.equal(state.voices[0].id,envelopeNoiseOwner);
    assert.equal(await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length),envelopeNoiseAttacks);
    await page.keyboard.down('s');state=await waitState(value=>value.voices.length===1&&value.voices[0].id!==envelopeNoiseOwner);
    assert.equal(state.registers[0x0c],5);const newEnvelopeNoiseOwner=state.voices[0].id;
    await page.keyboard.up('a');assert.equal((await inspect()).voices[0].id,newEnvelopeNoiseOwner);await sound();
    await page.keyboard.up('s');await waitState(value=>value.voices.length===0);await silent();
    const noiseSaveEvent=page.waitForEvent('download');await page.click('#savePreset');const noiseSave=await noiseSaveEvent;
    const noisePortable=JSON.parse(await fs.readFile(await noiseSave.path(),'utf8'));
    assert.equal(noisePortable.version,5);assert.deepEqual(noisePortable.noise.envelope,{enabled:true,period:5,loop:false});
    await page.click('#copyCode');assert.match(await page.locator('#codeOutput').inputValue(),/nes\.writeRegister\(0x400c,\s*5\)/i);
    await page.uncheck('#noiseEnvelopeEnabled');await waitState(value=>!value.preset.noise.envelope.enabled);
    assert.equal(await stepButton('#noiseVolume',1).isDisabled(),false);assert.equal(await page.isDisabled('#noiseEnvelopeLoop'),true);
    await page.setInputFiles('#presetFileInput',{name:'noise-envelope-v5.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(noisePortable))});
    state=await waitState(value=>value.preset.noise.envelope.enabled&&value.preset.noise.envelope.period===5);
    assert.deepEqual(state.preset,noisePortable);assert.equal(await page.isChecked('#noiseEnvelopeEnabled'),true);
    if(config.screenshots) {
      await page.setViewportSize({width:390,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,'Noise Envelope fits a narrow screen');await screenshot('noise-envelope-mobile');
      await page.setViewportSize({width:1180,height:940});
    }
    await page.uncheck('#noiseEnvelopeEnabled');await waitState(value=>!value.preset.noise.envelope.enabled);

    check('DMC is one sample voice; rate and loop are live while Pitch and note selection do not tune it');
    await choose('#source','dmc');state=await waitState(value=>value.preset.source==='dmc');
    assert.equal(state.capacity,1);assert.equal(state.preset.dmc.data.length,0);
    await page.click('#demoDpcm');state=await waitState(value=>value.preset.dmc.data.length===257);
    await page.check('#dmcLoop');state=await waitState(value=>value.preset.dmc.loop);
    for(const selector of pitchWheels)assert.equal(await page.isDisabled(selector),true);await assertPitchUi(0);
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1&&value.coreState.dmcRemaining>0);
    const dmcOwner=state.voices[0].id,dmcFrequency=state.coreState.dmcFrequency;
    assert.equal(state.voices[0].channel,4);await sound();
    const dmcAttacks=await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length);
    await number('#dmcRate',14);state=await waitState(value=>value.preset.dmc.rate===14);
    assert.equal(state.voices[0].id,dmcOwner);assert.notEqual(state.coreState.dmcFrequency,dmcFrequency);await sound();
    const dmcLevel=state.registers[0x11];await number('#dmcLevel',65);state=await waitState(value=>value.preset.dmc.level===65);
    assert.equal(state.registers[0x11],dmcLevel,'initial level edits wait for the next trigger');assert.equal(state.voices[0].id,dmcOwner);
    assert.equal(await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length),dmcAttacks);
    const configuredDmcFrequency=state.coreState.dmcFrequency;
    await page.keyboard.down('s');state=await waitState(value=>value.voices.length===1&&value.voices[0].id!==dmcOwner);
    const replacementDmc=state.voices[0].id;assert.equal(state.coreState.dmcFrequency,configuredDmcFrequency);assert.equal(state.registers[0x11],65);
    await page.keyboard.up('a');assert.equal((await inspect()).voices[0].id,replacementDmc);await sound();
    await page.keyboard.up('s');await waitState(value=>value.voices.length===0);await silent();
    await page.locator('#dmcRate').focus();await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();

    check('invalid or absent DPCM input keeps the current looping sample and held owner');
    const dmcBeforeBad=structuredClone(await inspect());
    await downloadDpcm(dmcBeforeBad.preset.dmc.data);
    state=await inspect();assert.deepEqual(state.preset,dmcBeforeBad.preset);assert.deepEqual(state.voices,dmcBeforeBad.voices,'saving raw DPCM preserves the sounding owner');await sound();
    for(const [filename,buffer] of [['empty.dmc',Buffer.alloc(0)],['oversized.dmc',Buffer.alloc(4082)],['ordinary-audio.wav',dpcmBytes(32)]]) {
      await page.setInputFiles('#dpcmFileInput',{name:filename,mimeType:'application/octet-stream',buffer});
      await page.waitForFunction(()=>document.querySelector('#dpcmStatus').dataset.error==='true');
      state=await inspect();assert.deepEqual(state.preset,dmcBeforeBad.preset);assert.deepEqual(state.voices,dmcBeforeBad.voices);await sound();
    }
    const noDpcmChooser=page.waitForEvent('filechooser');await page.click('#loadDpcm');await (await noDpcmChooser).setFiles([]);
    state=await inspect();assert.deepEqual(state.preset,dmcBeforeBad.preset);assert.deepEqual(state.voices,dmcBeforeBad.voices);await sound();

    const deferDpcmRead=()=>page.evaluate(()=>{
      const original=File.prototype.arrayBuffer;window.audit.restoreDpcmRead=()=>{File.prototype.arrayBuffer=original;};
      delete window.audit.releaseSlowDpcm;window.audit.slowDpcmCompleted=false;
      File.prototype.arrayBuffer=function(...args){
        const bytes=original.apply(this,args);if(this.name!=='slowfixture.dmc')return bytes;
        return bytes.then(value=>new Promise(resolve=>{window.audit.releaseSlowDpcm=()=>resolve(value);})).finally(()=>{window.audit.slowDpcmCompleted=true;});
      };
    });
    const releaseDpcmRead=async()=>{
      await page.evaluate(()=>{window.audit.releaseSlowDpcm();window.audit.restoreDpcmRead();});
      await page.waitForFunction(()=>window.audit.slowDpcmCompleted===true);
    };
    check('explicit DPCM cancellation keeps the looping sample and rejects the late file result');
    await deferDpcmRead();
    await page.setInputFiles('#dpcmFileInput',{name:'slowfixture.dmc',mimeType:'application/octet-stream',buffer:dpcmBytes(32)});
    await page.waitForFunction(()=>typeof window.audit.releaseSlowDpcm==='function');
    await downloadDpcm(dmcBeforeBad.preset.dmc.data);
    assert.equal(await page.isVisible('#cancelDpcm'),true,'exporting the current sample does not cancel a pending file read');
    state=await inspect();assert.deepEqual(state.preset,dmcBeforeBad.preset);assert.deepEqual(state.voices,dmcBeforeBad.voices);
    assert.equal(await page.isVisible('#cancelDpcm'),true);await page.click('#cancelDpcm');
    assert.equal(await page.isVisible('#cancelDpcm'),false);assert.match(await page.locator('#dpcmStatus').textContent(),/cancelled.*Current sound kept/i);
    await releaseDpcmRead();state=await inspect();
    assert.deepEqual(state.preset,dmcBeforeBad.preset);assert.deepEqual(state.voices,dmcBeforeBad.voices);await sound();

    check('a newer DPCM load wins over a delayed file read and sample changes stop held notes');
    await deferDpcmRead();
    await page.setInputFiles('#dpcmFileInput',{name:'slowfixture.dmc',mimeType:'application/octet-stream',buffer:dpcmBytes(32)});
    await page.waitForFunction(()=>typeof window.audit.releaseSlowDpcm==='function');
    await page.setInputFiles('#dpcmFileInput',{name:'newer-self-authored.dmc',mimeType:'application/octet-stream',buffer:dpcmBytes(17)});
    state=await waitState(value=>value.preset.dmc.data.length===17);assert.equal(state.voices.length,0);
    const dmcAfterNewer=structuredClone(state.preset);
    await releaseDpcmRead();
    assert.deepEqual((await inspect()).preset,dmcAfterNewer);await page.keyboard.up('a');
    await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();

    check('choosing Demo sample supersedes a pending DPCM file and stops the replaced sample');
    await deferDpcmRead();
    await page.setInputFiles('#dpcmFileInput',{name:'slowfixture.dmc',mimeType:'application/octet-stream',buffer:dpcmBytes(32)});
    await page.waitForFunction(()=>typeof window.audit.releaseSlowDpcm==='function');
    await page.click('#demoDpcm');state=await waitState(value=>value.preset.dmc.data.length===257);assert.equal(state.voices.length,0);
    const dmcAfterDemo=structuredClone(state.preset);await releaseDpcmRead();assert.deepEqual((await inspect()).preset,dmcAfterDemo);
    await assertDmcHistory(0,0);
    await page.keyboard.up('a');await stop();await silent();

    check('Demo resets DMC history even when committed edits returned to identical sample bytes');
    await dmcFirst();await dmcBit(0,0).click();await dmcBit(0,0).click();await assertDmcHistory(2,0);
    assert.deepEqual((await inspect()).preset.dmc.data,dmcAfterDemo.dmc.data);
    await page.click('#demoDpcm');await assertDmcHistory(0,0);
    assert.deepEqual((await inspect()).preset.dmc.data,dmcAfterDemo.dmc.data);

    check('DMC one-shot reaches the hardware end and the next key retriggers the configured rate');
    await page.click('#demoDpcm');await waitState(value=>value.preset.dmc.data.length===257);
    await number('#dmcRate',0);await page.uncheck('#dmcLoop');await waitState(value=>!value.preset.dmc.loop&&value.preset.dmc.rate===0);
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1&&value.coreState.dmcRemaining>0);await sound();
    await waitState(value=>value.coreState.dmcRemaining===0);await silent();
    await page.keyboard.up('a');await page.keyboard.down('a');await waitState(value=>value.coreState.dmcRemaining>0);await sound();
    await page.keyboard.up('a');await stop();await silent();

    check('DMC DAC preview shows loop carry, odd-level limits and Rate-derived time');
    const beforeBitFixtures=structuredClone((await inspect()).preset);
    let preview=await assertDmcPreview(beforeBitFixtures);
    assert.equal(await page.locator('#dmcWaveSelected').getAttribute('aria-pressed'),'true');
    assert(Number(preview.visibleBits)<=32);
    await page.click('#dmcWaveAll');preview=await assertDmcPreview(beforeBitFixtures);
    assert.equal(await page.locator('#dmcWaveAll').getAttribute('aria-pressed'),'true');
    assert.equal(Number(preview.visibleBits),257*8);
    await page.click('#dmcWaveSelected');
    await number('#dmcLevel',64);
    await page.setInputFiles('#dpcmFileInput',{name:'one-byte-up.dmc',mimeType:'application/octet-stream',buffer:Buffer.from([0xff])});
    state=await waitState(value=>value.preset.dmc.data.length===1&&value.preset.dmc.data[0]===255);
    await downloadDpcm([255]);
    await page.check('#dmcLoop');state=await waitState(value=>value.preset.dmc.loop);
    preview=await assertDmcPreview(state.preset);
    assert.equal(Number(preview.endLevel),80);assert.equal(Number(preview.nextStartLevel),80);assert.equal(Number(preview.nextEndLevel),96);
    const slowDuration=Number(preview.durationMs);await number('#dmcRate',15);
    state=await waitState(value=>value.preset.dmc.rate===15);preview=await assertDmcPreview(state.preset);
    assert(Number(preview.durationMs)<slowDuration);assert.equal(Number(preview.endLevel),80,'Rate changes time, not the DAC step values');
    await page.locator('#dmcLevel').focus();await page.keyboard.press('End');
    state=await waitState(value=>value.preset.dmc.level===127);preview=await assertDmcPreview(state.preset);
    assert.equal(Number(preview.endLevel),127);assert.equal(Number(preview.nextEndLevel),127);
    assert.match(await page.locator('#dmcBitReadout').textContent(),/127\s*(?:→|->)\s*127/);
    await page.locator('#dmcLevel').focus();await page.keyboard.press('Home');await waitState(value=>value.preset.dmc.level===0);await number('#dmcLevel',1);
    await page.setInputFiles('#dpcmFileInput',{name:'one-byte-lsb-first.dmc',mimeType:'application/octet-stream',buffer:Buffer.from([1])});
    state=await waitState(value=>value.preset.dmc.data.length===1&&value.preset.dmc.data[0]===1);await dmcFirst();
    preview=await assertDmcPreview(state.preset);assert.equal(Number(preview.endLevel),1);
    assert.match(await page.locator('#dmcBitReadout').textContent(),/1\s*(?:→|->)\s*3/,'bit zero is the first played up-step');
    await dmcBit(0,0).click();state=await waitState(value=>value.preset.dmc.data[0]===0);preview=await assertDmcPreview(state.preset);
    assert.equal(Number(preview.endLevel),1);assert.match(await page.locator('#dmcBitReadout').textContent(),/1\s*(?:→|->)\s*1/,'the odd DAC low bit is retained at its lower limit');

    check('DMC bit paging stays bounded at the hardware sample limit and edits the final real byte');
    await page.setInputFiles('#dpcmFileInput',{name:'largest-dmc-sample.dmc',mimeType:'application/octet-stream',buffer:dpcmBytes(4081)});
    state=await waitState(value=>value.preset.dmc.data.length===4081);await assertDmcPreview(state.preset);
    assert((await page.locator('#dmcBitEditor button[data-dmc-byte][data-dmc-bit]').count())<=32,'only one small bit window is mounted');
    await page.click('#dmcBitsLast');
    assert.equal(await page.isDisabled('#dmcBitsNext'),true);assert.equal(await dmcBit(4080,7).isDisabled(),false);
    assert.notEqual(await dmcBit(4080,7).getAttribute('data-dmc-padding'),'true');
    await dmcBit(4080,7).click();state=await waitState(value=>value.preset.dmc.data[4080]===127);
    await downloadDpcm(state.preset.dmc.data);
    preview=await assertDmcPreview(state.preset);assert.equal(Number(preview.bitCount),4081*8);
    assert.equal(Number(preview.visibleStartBit),4080*8);assert.equal(Number(preview.visibleBits),8);
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,'the last DMC bit page fits a narrow screen');await screenshot('dmc-bits-last-mobile');
    await page.setViewportSize({width:1180,height:940});
    check('whole-sample drawing stays bounded at the maximum DMC length');
    await page.click('#dmcWaveAll');
    const largestBeforeDraw=structuredClone((await inspect()).preset);
    await startDmcDraw(.3,100);await moveDmcDraw(.7,24);
    assert.equal(await dmcDrawing(),'true');
    assert(Number(await page.locator('#dmcDacCanvas').getAttribute('data-target-points'))>1000);
    assert.deepEqual((await inspect()).preset,largestBeforeDraw,'even a long draft does not upload sample bytes before release');
    await page.mouse.up();state=await waitState(value=>JSON.stringify(value.preset.dmc.data)!==JSON.stringify(largestBeforeDraw.dmc.data));
    assert.equal(state.preset.dmc.data.length,4081);assert.equal(state.preset.dmc.data[4080],127,'drawing the middle leaves the final byte untouched');
    assert((await page.locator('#dmcBitEditor button[data-dmc-byte][data-dmc-bit]').count())<=32);
    await assertDmcPreview(state.preset);await page.click('#dmcWaveSelected');
    await dmcFirst();assert.equal(await page.isDisabled('#dmcBitsPrevious'),true);
    assert.equal(await dmcBit(0,0).getAttribute('aria-pressed'),'true');
    await page.setInputFiles('#presetFileInput',{name:'dmc-before-bit-fixtures.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(beforeBitFixtures))});
    state=await waitState(value=>value.preset.dmc.data.length===257&&value.preset.dmc.level===beforeBitFixtures.dmc.level);await dmcFirst();

    check('a DMC bit edit stops held audio, updates the preview and returns pointer focus to musical keys');
    await page.check('#dmcLoop');state=await waitState(value=>value.preset.dmc.loop);
    await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();
    const originalFirstByte=state.preset.dmc.data[0];
    await dmcBit(0,0).click();state=await waitState(value=>value.preset.dmc.data[0]===(originalFirstByte^1)&&value.voices.length===0);
    await assertDmcPreview(state.preset);
    assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.matches('input,select,textarea'))),false);
    await page.keyboard.up('a');await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();
    await page.keyboard.up('a');await stop();

    check('cancelled DMC strokes preserve sample bytes across pointer, parameter and source changes');
    const beforeCancelledDraw=structuredClone((await inspect()).preset);
    const beforeCancelledHistory=await dmcHistory();
    await startDmcDraw(.05,120);await moveDmcDraw(.95,20);assert.equal(await dmcDrawing(),'true');
    await cancelDmcPointer();assert.deepEqual((await inspect()).preset,beforeCancelledDraw);await assertDmcPreview(beforeCancelledDraw);
    await startDmcDraw(.05,120);await moveDmcDraw(.95,20);
    await dmcBit(0,0).focus();await page.keyboard.press('End');
    assert.notEqual(await dmcDrawing(),'true','keyboard paging cancels a draft before changing the bit range');await page.mouse.up();
    assert.deepEqual((await inspect()).preset,beforeCancelledDraw);await dmcFirst();
    await startDmcDraw(.05,120);await moveDmcDraw(.95,20);
    const resizePointer=await page.evaluate(()=>window.audit.dmcDrawPointer);
    await page.locator('#dmcDacCanvas').evaluate((node,pointerId)=>{
      const old=node.style.height;node.style.height='213px';const rect=node.getBoundingClientRect();
      node.dispatchEvent(new PointerEvent('pointerup',{pointerId,button:0,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,bubbles:true}));
      node.style.height=old;
    },resizePointer);
    assert.notEqual(await dmcDrawing(),'true','a resize during the final pointer preview cancels safely');await page.mouse.up();
    assert.deepEqual((await inspect()).preset,beforeCancelledDraw);await assertDmcPreview(beforeCancelledDraw);
    await startDmcDraw(.05,115);await moveDmcDraw(.95,18);
    const rateDelta=beforeCancelledDraw.dmc.rate===15?-1:1;
    await page.locator('#dmcRate').focus();await page.keyboard.press(rateDelta>0?'ArrowUp':'ArrowDown');
    state=await waitState(value=>value.preset.dmc.rate===beforeCancelledDraw.dmc.rate+rateDelta);
    assert.notEqual(await dmcDrawing(),'true');await page.mouse.up();
    assert.deepEqual(state.preset.dmc.data,beforeCancelledDraw.dmc.data,'Rate changes discard the uncommitted stroke');
    await number('#dmcRate',beforeCancelledDraw.dmc.rate);
    await startDmcDraw(.05,120);await moveDmcDraw(.95,10);
    await choiceButton('#source','dmc').focus();await page.keyboard.press('Home');
    state=await waitState(value=>value.preset.source==='pulse');assert.notEqual(await dmcDrawing(),'true');await page.mouse.up();
    assert.deepEqual(state.preset.dmc.data,beforeCancelledDraw.dmc.data,'source changes discard the uncommitted stroke');
    await choose('#source','dmc');await waitState(value=>value.preset.source==='dmc');
    await assertDmcHistory(beforeCancelledHistory.undo,beforeCancelledHistory.redo);

    check('DMC mouse target preview commits once on release and the edited sample plays through the real core');
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1);await sound();
    const beforeDraw=structuredClone(state),waveBeforeDraw=await page.locator('#dmcDacCanvas').evaluate(node=>node.toDataURL());
    const beforeDrawHistory=await dmcHistory();
    await startDmcDraw(.02,120);await moveDmcDraw(.5,104,3);await moveDmcDraw(.98,116,3);
    assert.equal(await dmcDrawing(),'true');assert(Number(await page.locator('#dmcDacCanvas').getAttribute('data-target-points'))>=30);
    state=await inspect();assert.deepEqual(state.preset,beforeDraw.preset);assert.deepEqual(state.voices,beforeDraw.voices,'held audio is not stopped for an uncommitted drawing');
    await assertDmcHistory(beforeDrawHistory.undo,beforeDrawHistory.redo);
    assert.notEqual(await page.locator('#dmcDacCanvas').evaluate(node=>node.toDataURL()),waveBeforeDraw);
    // A full-page capture can temporarily resize the viewport. Drawing
    // intentionally cancels on resize, so preserve this live pointer gesture.
    await screenshot('dmc-draw-preview',{fullPage:false});
    assert.equal(await dmcDrawing(),'true','capturing a preview must leave the real pointer gesture active');
    await page.mouse.up();state=await waitState(value=>value.voices.length===0&&JSON.stringify(value.preset.dmc.data)!==JSON.stringify(beforeDraw.preset.dmc.data));
    assert.notEqual(await dmcDrawing(),'true');assert.equal(state.preset.dmc.data.length,beforeDraw.preset.dmc.data.length);
    assert.deepEqual(state.preset.dmc.data.slice(4),beforeDraw.preset.dmc.data.slice(4),'the selected four-byte stroke leaves other encoded bits alone');
    await assertDmcHistory(beforeDrawHistory.undo+1,0);
    await assertDmcPreview(state.preset);
    await downloadDpcm(state.preset.dmc.data);
    assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.matches('input,select,textarea'))),false);
    await page.keyboard.up('a');await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();await page.keyboard.up('a');await stop();

    check('DMC Undo/Redo restores real sample playback, keeps current controls and clears drawing targets');
    const drawnDmcData=[...(await inspect()).preset.dmc.data];
    const historyControls={rate:beforeDraw.preset.dmc.rate===15?14:beforeDraw.preset.dmc.rate+1,level:beforeDraw.preset.dmc.level===127?126:beforeDraw.preset.dmc.level+1,loop:!beforeDraw.preset.dmc.loop};
    await number('#dmcRate',historyControls.rate);await number('#dmcLevel',historyControls.level);
    await page.locator('#dmcLoop').setChecked(historyControls.loop);await assertDmcHistory(beforeDrawHistory.undo+1,0);
    await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();
    await page.click('#dmcUndo');state=await waitState(value=>value.voices.length===0&&JSON.stringify(value.preset.dmc.data)===JSON.stringify(beforeDraw.preset.dmc.data));
    await assertDmcHistory(beforeDrawHistory.undo,1);await assertDmcPreview(state.preset);
    for(const [key,value]of Object.entries(historyControls))assert.equal(state.preset.dmc[key],value,`Undo preserves current ${key}`);
    assert.equal(Number(await page.locator('#dmcDacCanvas').getAttribute('data-target-points')),0,'Undo clears the previous green target');
    assert.notEqual(await dmcDrawing(),'true');
    assert.equal(await page.evaluate(()=>document.activeElement?.closest('#dmcBitEditor')!==null),false);
    await page.keyboard.up('a');await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();
    await page.click('#dmcRedo');state=await waitState(value=>value.voices.length===0&&JSON.stringify(value.preset.dmc.data)===JSON.stringify(drawnDmcData));
    await assertDmcHistory(beforeDrawHistory.undo+1,0);await assertDmcPreview(state.preset);
    for(const [key,value]of Object.entries(historyControls))assert.equal(state.preset.dmc[key],value,`Redo preserves current ${key}`);
    assert.equal(Number(await page.locator('#dmcDacCanvas').getAttribute('data-target-points')),0);
    await page.keyboard.up('a');await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();await page.keyboard.up('a');await stop();
    // Save from an undone state: a portable preset contains current bytes,
    // not the last committed stroke or the editor's private Redo branch.
    await startDmcDraw(.05,8);await moveDmcDraw(.95,12);assert.equal(await dmcDrawing(),'true');
    await assertDmcHistory(beforeDrawHistory.undo+1,0);
    assert.equal(await dmcShortcut(dmcBit(0,0),'z'),true,'Undo discards the unfinished drawing before restoring committed data');
    await page.mouse.up();state=await waitState(value=>JSON.stringify(value.preset.dmc.data)===JSON.stringify(beforeDraw.preset.dmc.data));
    assert.notEqual(await dmcDrawing(),'true');assert.equal(Number(await page.locator('#dmcDacCanvas').getAttribute('data-target-points')),0);
    await assertDmcHistory(beforeDrawHistory.undo,1);
    await number('#dmcRate',beforeDraw.preset.dmc.rate);await number('#dmcLevel',beforeDraw.preset.dmc.level);
    await page.locator('#dmcLoop').setChecked(beforeDraw.preset.dmc.loop);await assertDmcHistory(beforeDrawHistory.undo,1);
    await screenshot('dmc-undo');
    const editedDmcData=[...(await inspect()).preset.dmc.data];
    check('raw DPCM export after Undo saves restored bytes rather than the Redo branch');
    const undoneDpcm=await downloadDpcm(editedDmcData);
    assert.notDeepEqual([...undoneDpcm],drawnDmcData);

    check('portable v5 presets retain original DMC bytes and copied code awaits memory; v1 through v4 still migrate');
    const dmcSaveEvent=page.waitForEvent('download');await page.click('#savePreset');const dmcSave=await dmcSaveEvent;
    const dmcPortable=JSON.parse(await fs.readFile(await dmcSave.path(),'utf8'));
    assert.equal(dmcPortable.version,5);assert.equal(dmcPortable.source,'dmc');assert.equal(dmcPortable.dmc.data.length,257);
    assert.deepEqual(dmcPortable.dmc.data,editedDmcData,'portable presets retain the bit edits');
    assert.notDeepEqual(dmcPortable.dmc.data,drawnDmcData,'saving after Undo exports restored data rather than Redo data');
    await page.click('#copyCode');const dmcCode=await page.locator('#codeOutput').inputValue();
    assert.match(dmcCode,/await nes\.dmc\.loadSample/);assert.match(dmcCode,/Uint8Array\.from/);assert.match(dmcCode,/nes\.dmc\.play/);assert.match(dmcCode,/nes\.dmc\.stop/);
    await page.click('#resetPreset');await waitState(value=>value.preset.source==='pulse');await assertDmcHistory(0,0);
    await page.setInputFiles('#presetFileInput',{name:'self-authored-dmc-voice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(dmcPortable))});
    state=await waitState(value=>value.preset.source==='dmc');assert.deepEqual(state.preset,dmcPortable);
    await assertDmcHistory(0,0);
    await dmcBit(0,0).click();await dmcBit(0,0).click();await assertDmcHistory(2,0);
    assert.deepEqual((await inspect()).preset.dmc.data,dmcPortable.dmc.data);
    await page.setInputFiles('#presetFileInput',{name:'self-authored-dmc-voice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(dmcPortable))});
    await page.waitForFunction(()=>document.querySelector('#dmcBitEditor').dataset.undoCount==='0');await assertDmcHistory(0,0);
    assert.deepEqual((await inspect()).preset,dmcPortable,'loading identical preset bytes establishes a fresh history baseline');
    check('a downloaded DPCM file reloads exact bytes with current parameters and a fresh history');
    const rawRoundTrip=await downloadDpcm(dmcPortable.dmc.data);
    await dmcBit(0,0).click();await dmcBit(0,0).click();await assertDmcHistory(2,0);
    await page.setInputFiles('#dpcmFileInput',{name:'2a03-sample.dmc',mimeType:'application/octet-stream',buffer:rawRoundTrip});
    state=await waitState(value=>JSON.stringify(value.preset)===JSON.stringify(dmcPortable));
    await page.waitForFunction(()=>document.querySelector('#dmcBitEditor').dataset.undoCount==='0');await assertDmcHistory(0,0);
    assert.deepEqual(state.preset,dmcPortable,'raw sample round-trip keeps Rate, Loop, Initial level and every encoded byte');
    await dmcFirst();await assertDmcPreview(state.preset);
    assert.equal(await dmcBit(0,0).getAttribute('aria-pressed'),String(Boolean(editedDmcData[0]&1)));
    await page.check('#dmcLoop');await waitState(value=>value.preset.dmc.loop);await page.keyboard.down('a');await waitState(value=>value.voices.length===1);await sound();await page.keyboard.up('a');await stop();
    if(config.screenshots) {
      await page.setViewportSize({width:390,height:844});
      await page.waitForFunction(()=>{const canvas=document.querySelector('#outputCanvas');return canvas.width===Math.max(240,Math.round(canvas.clientWidth));});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,'DMC editor fits a narrow screen');await screenshot('dmc-mobile');
      await page.setViewportSize({width:1180,height:940});
    }
    const legacyV4Preset=structuredClone(dmcPortable);legacyV4Preset.name='Imported legacy v4';legacyV4Preset.version=4;
    legacyV4Preset.fds.envelope={enabled:true,increase:true,period:11,initialGain:17,masterSpeed:37,halt:true};
    delete legacyV4Preset.fds.envelopeClock;delete legacyV4Preset.fds.modulation.envelope;
    await page.setInputFiles('#presetFileInput',{name:'old-v4-voice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacyV4Preset))});
    state=await waitState(value=>value.preset.source==='dmc'&&value.preset.version===5&&value.preset.name==='Imported legacy v4');
    assert.deepEqual(state.preset.fds.envelope,{enabled:true,increase:true,period:11,initialGain:17});
    assert.deepEqual(state.preset.fds.envelopeClock,{masterSpeed:37,halt:true});
    assert.deepEqual(state.preset.fds.modulation.envelope,{enabled:false,increase:true,period:8,initialGain:0});
    const legacyV3Preset=structuredClone(legacyV4Preset);legacyV3Preset.name='Imported legacy v3';legacyV3Preset.version=3;delete legacyV3Preset.fds.envelope;
    await page.setInputFiles('#presetFileInput',{name:'old-v3-voice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacyV3Preset))});
    state=await waitState(value=>value.preset.source==='dmc'&&value.preset.version===5&&value.preset.name==='Imported legacy v3');
    assert.deepEqual(state.preset.dmc,dmcPortable.dmc);
    assert.deepEqual(state.preset.fds.envelope,{enabled:false,increase:false,period:8,initialGain:32});
    assert.deepEqual(state.preset.fds.envelopeClock,{masterSpeed:232,halt:false});
    const legacyV2Preset=structuredClone(legacyV3Preset);legacyV2Preset.name='Imported legacy v2';legacyV2Preset.version=2;delete legacyV2Preset.noise.envelope;
    await page.setInputFiles('#presetFileInput',{name:'old-v2-voice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacyV2Preset))});
    state=await waitState(value=>value.preset.source==='dmc'&&value.preset.version===5&&value.preset.name==='Imported legacy v2'&&value.preset.noise.envelope.period===8);
    assert.deepEqual(state.preset.dmc,dmcPortable.dmc);assert.deepEqual(state.preset.noise.envelope,{enabled:false,period:8,loop:false});
    const legacyPreset=structuredClone(legacyV2Preset);legacyPreset.version=1;legacyPreset.source='pulse';delete legacyPreset.dmc;
    await page.setInputFiles('#presetFileInput',{name:'old-v1-voice.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacyPreset))});
    state=await waitState(value=>value.preset.source==='pulse'&&value.preset.version===5);
    assert.equal(state.preset.dmc.data.length,0);assert.deepEqual(state.preset.pulse,legacyPreset.pulse);

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

    check('FDS volume Envelope decays and rises in the real core without a host gain ramp');
    await page.check('#fdsEnvelopeEnabled');await waitState(value=>value.preset.fds.envelope.enabled);
    assert.equal(await stepButton('#fdsVolume',1).isDisabled(),true);
    assert.equal(await page.evaluate(()=>document.activeElement?.matches('input,select,textarea')),false);
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1);await sound();
    assert.equal(state.registers[0x80],8);assert.equal(state.registers[0x8a],232);assert.equal(state.registers[0x83]&0xc0,0);
    state=await waitState(value=>value.coreState.fdsGain===0);assert.equal(state.voices.length,1);await silent();
    await page.keyboard.up('a');await stop();
    await choose('#fdsEnvelopeIncrease',true);await number('#fdsEnvelopeInitialGain',0);
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1&&value.coreState.fdsGain>0);await sound();
    const risingFdsOwner=state.voices[0].id,risingGain=state.coreState.fdsGain;
    assert.equal(state.registers[0x80],0x48);
    const fdsEnvelopeAttacks=await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length);
    await choose('#fdsMaster',1);
    await page.locator('#pitchBend').evaluate(input=>{input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await waitState(value=>value.pitch===1);await page.dispatchEvent('#pitchBend','pointerup');await waitState(value=>value.pitch===0);
    const heldFdsDepth=(await inspect()).preset.fds.modulation.depth;await number('#fdsModDepth',Math.min(63,heldFdsDepth+1));
    state=await inspect();assert.equal(state.voices[0].id,risingFdsOwner);assert.equal(state.registers[0x89],1);
    assert.equal(state.registers[0x80],0x48);assert.equal(state.registers[0x8a],232);assert.equal(state.registers[0x83]&0xc0,0);
    assert(state.coreState.fdsGain>=risingGain,'Master / Pitch / modulation edits keep the rising gain progressing');
    await choose('#fdsEnvelopeIncrease',false);await number('#fdsEnvelopeInitialGain',7);await number('#fdsEnvelopePeriod',9);
    await number('#fdsEnvelopeMasterSpeed',0);await page.check('#fdsEnvelopeHalt');
    state=await waitState(value=>value.preset.fds.envelopeClock.halt&&value.preset.fds.envelopeClock.masterSpeed===0);
    assert.equal(state.registers[0x80],0x48);assert.equal(state.registers[0x8a],232);assert.equal(state.registers[0x83]&0xc0,0);
    assert.equal(state.voices[0].id,risingFdsOwner);
    assert.equal(await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length),fdsEnvelopeAttacks);
    await page.keyboard.down('s');state=await waitState(value=>value.voices.length===1&&value.voices[0].id!==risingFdsOwner);
    const frozenFdsOwner=state.voices[0].id;assert.equal(state.registers[0x80],9);assert.equal(state.registers[0x8a],0);assert.equal(state.registers[0x83]&0xc0,0x40);
    assert.equal(state.coreState.fdsGain,7);await page.waitForTimeout(150);assert.equal((await inspect()).coreState.fdsGain,7);await sound();
    await page.keyboard.up('a');assert.equal((await inspect()).voices[0].id,frozenFdsOwner);
    await page.keyboard.up('s');await waitState(value=>value.voices.length===0);await silent();
    const fdsEnvelopeSaveEvent=page.waitForEvent('download');await page.click('#savePreset');const fdsEnvelopeSave=await fdsEnvelopeSaveEvent;
    const fdsEnvelopePortable=JSON.parse(await fs.readFile(await fdsEnvelopeSave.path(),'utf8'));
    assert.equal(fdsEnvelopePortable.version,5);
    assert.deepEqual(fdsEnvelopePortable.fds.envelope,{enabled:true,increase:false,period:9,initialGain:7});
    assert.deepEqual(fdsEnvelopePortable.fds.envelopeClock,{masterSpeed:0,halt:true});
    await page.click('#copyCode');const fdsEnvelopeCode=await page.locator('#codeOutput').inputValue();
    assert.match(fdsEnvelopeCode,/nes\.fds\.keyOn\(\)/);assert.match(fdsEnvelopeCode,/nes\.writeRegister\(0x408a,\s*0\)/i);
    assert.match(fdsEnvelopeCode,/nes\.writeRegister\(0x4080,\s*135\)/i);assert.match(fdsEnvelopeCode,/nes\.writeRegister\(0x4083,/i);
    await page.click('#resetPreset');await waitState(value=>value.preset.source==='pulse');
    await page.setInputFiles('#presetFileInput',{name:'fds-envelope-v5.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fdsEnvelopePortable))});
    state=await waitState(value=>value.preset.source==='fds'&&value.preset.fds.envelope.enabled&&value.preset.fds.envelope.initialGain===7);
    assert.deepEqual(state.preset,fdsEnvelopePortable);assert.equal(await page.isChecked('#fdsEnvelopeHalt'),true);
    if(config.screenshots) {
      await page.setViewportSize({width:390,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,'FDS Envelope fits a narrow screen');await screenshot('fds-envelope-mobile');
      await page.setViewportSize({width:1180,height:940});
    }
    await page.uncheck('#fdsEnvelopeEnabled');await waitState(value=>!value.preset.fds.envelope.enabled);
    assert.equal(await stepButton('#fdsVolume',1).isDisabled(),false);

    check('FDS Depth Envelope works alone, preserves live edits and shares its clock with volume');
    await page.check('#fdsModEnvelopeEnabled');await number('#fdsEnvelopeMasterSpeed',232);await page.uncheck('#fdsEnvelopeHalt');
    state=await waitState(value=>value.preset.fds.modulation.envelope.enabled&&value.preset.fds.envelopeClock.masterSpeed===232&&!value.preset.fds.envelopeClock.halt);
    assert.equal(state.preset.fds.envelope.enabled,false);assert.equal(await stepButton('#fdsModDepth',1).isDisabled(),true);
    assert.equal(await stepButton('#fdsEnvelopeMasterSpeed',1).isDisabled(),false);
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1&&value.coreState.fdsSweepGain>0);await sound();
    const depthFdsOwner=state.voices[0].id,startingDepth=state.coreState.fdsSweepGain;
    assert.equal(state.registers[0x84],0x48);assert.equal(state.registers[0x80],128|state.preset.fds.volume);
    assert.equal(state.registers[0x83]&0xc0,0);assert.equal(state.registers[0x8a],232);
    const depthAttacks=await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length);
    await choose('#fdsMaster',0);
    await page.locator('#pitchBend').evaluate(input=>{input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await waitState(value=>value.pitch===1);await page.dispatchEvent('#pitchBend','pointerup');await waitState(value=>value.pitch===0);
    const depthRate=(await inspect()).preset.fds.modulation.rate;await number('#fdsModRate',depthRate+1);
    await number('#fdsModBias',1);await number('#fdsModBias',0);
    await page.uncheck('#fdsModEnabled');await waitState(value=>!value.preset.fds.modulation.enabled);
    assert.equal(await page.isDisabled('#fdsModEnvelopeEnabled'),true);
    await page.check('#fdsModEnabled');state=await waitState(value=>value.preset.fds.modulation.enabled);
    assert.equal(state.voices[0].id,depthFdsOwner);assert.equal(state.registers[0x84],0x48);assert.equal(state.registers[0x8a],232);
    assert(state.coreState.fdsSweepGain>=startingDepth,'live edits keep increasing Depth progressing');
    await page.check('#fdsEnvelopeEnabled');await choose('#fdsEnvelopeIncrease',true);await number('#fdsEnvelopeInitialGain',0);await number('#fdsEnvelopePeriod',8);
    await choose('#fdsModEnvelopeIncrease',false);await number('#fdsModEnvelopeInitialGain',63);
    state=await waitState(value=>value.preset.fds.envelope.enabled&&value.preset.fds.modulation.envelope.initialGain===63);
    assert.equal(state.registers[0x80],128|state.preset.fds.volume,'pending volume Envelope waits for a new note');
    assert.equal(state.registers[0x84],0x48,'pending Depth Envelope keeps the current hardware settings');
    assert.equal(state.voices[0].id,depthFdsOwner);
    assert.equal(await page.evaluate(()=>window.audit.outgoing.filter(message=>message.method==='noteOn').length),depthAttacks);
    await page.keyboard.down('s');state=await waitState(value=>value.voices.length===1&&value.voices[0].id!==depthFdsOwner&&value.coreState.fdsGain>0&&value.coreState.fdsSweepGain<63);
    const dualFdsOwner=state.voices[0].id;assert.equal(state.registers[0x80],0x48);assert.equal(state.registers[0x84],8);await sound();
    await page.keyboard.up('a');assert.equal((await inspect()).voices[0].id,dualFdsOwner);
    state=await waitState(value=>value.coreState.fdsGain===32&&value.coreState.fdsSweepGain===0);
    assert.equal(state.voices[0].id,dualFdsOwner);await page.keyboard.up('s');await stop();
    await number('#fdsEnvelopeInitialGain',7);await number('#fdsModEnvelopeInitialGain',13);
    await number('#fdsEnvelopeMasterSpeed',0);await page.check('#fdsEnvelopeHalt');
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1&&value.coreState.fdsGain===7&&value.coreState.fdsSweepGain===13);
    assert.equal(state.registers[0x83]&0xc0,0x40);assert.equal(state.registers[0x8a],0);await sound();
    await page.waitForTimeout(150);state=await inspect();assert.equal(state.coreState.fdsGain,7);assert.equal(state.coreState.fdsSweepGain,13);
    await page.keyboard.up('a');await stop();
    const depthSaveEvent=page.waitForEvent('download');await page.click('#savePreset');const depthSave=await depthSaveEvent;
    const depthPortable=JSON.parse(await fs.readFile(await depthSave.path(),'utf8'));
    assert.equal(depthPortable.version,5);assert.deepEqual(depthPortable.fds.envelopeClock,{masterSpeed:0,halt:true});
    assert.deepEqual(depthPortable.fds.modulation.envelope,{enabled:true,increase:false,period:8,initialGain:13});
    await page.click('#copyCode');const depthCode=await page.locator('#codeOutput').inputValue();
    assert.match(depthCode,/nes\.writeRegister\(0x4084,\s*141\)/i);assert.match(depthCode,/nes\.writeRegister\(0x4080,\s*135\)/i);
    assert.match(depthCode,/nes\.writeRegister\(0x408a,\s*0\)/i);assert.match(depthCode,/nes\.fds\.keyOn\(\)/);
    await page.click('#resetPreset');await waitState(value=>value.preset.source==='pulse');
    await page.setInputFiles('#presetFileInput',{name:'fds-depth-envelope-v5.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(depthPortable))});
    state=await waitState(value=>value.preset.source==='fds'&&value.preset.fds.modulation.envelope.enabled&&value.preset.fds.modulation.envelope.initialGain===13);
    assert.deepEqual(state.preset,depthPortable);assert.equal(await page.isChecked('#fdsModEnvelopeEnabled'),true);
    assert.equal(await page.isChecked('#fdsEnvelopeHalt'),true);assert.equal(await stepButton('#fdsModDepth',1).isDisabled(),true);
    if(config.screenshots) {
      await page.setViewportSize({width:390,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,'FDS Depth Envelope fits a narrow screen');await screenshot('fds-depth-envelope-mobile');
      await page.setViewportSize({width:1180,height:940});
    }
    await page.uncheck('#fdsEnvelopeEnabled');await page.uncheck('#fdsModEnvelopeEnabled');
    await waitState(value=>!value.preset.fds.envelope.enabled&&!value.preset.fds.modulation.envelope.enabled);
    assert.equal(await stepButton('#fdsModDepth',1).isDisabled(),false);assert.equal(await page.isDisabled('#fdsEnvelopeHalt'),true);

    check('portable presets, actual import, invalid input atomicity, JavaScript export');
    const downloadEvent=page.waitForEvent('download');await page.click('#savePreset');const download=await downloadEvent;
    assert.equal(download.suggestedFilename(),'2a03-voice.json');
    const portable=JSON.parse(await fs.readFile(await download.path(),'utf8'));
    assert.equal(portable.format,'tetorica-nes-fds-voice');assert.equal(portable.version,5);assert.equal(portable.source,'fds');assert.equal(portable.fds.wave.length,64);assert.equal(portable.fds.modulation.table.length,32);
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
    assert.deepEqual(state.preset.noise,{volume:11,period:3,shortMode:true,envelope:{enabled:false,period:11,loop:true}});
    state=await importVoice(4,preset=>preset.source==='fds'&&preset.fds.volume===24&&preset.fds.modulation.enabled);
    assert.deepEqual(state.preset.fds.wave,vgmWave);assert.equal(state.preset.fds.master,0);
    assert.deepEqual(state.preset.fds.modulation,{enabled:true,table:vgmModulation,rate:256,depth:16,bias:0,envelope:{enabled:false,increase:false,period:16,initialGain:16}});
    await page.click('#copyCode');assert.match(await page.locator('#codeOutput').inputValue(),/nes\.fds\.setWave/);
    const importedSaveEvent=page.waitForEvent('download');await page.click('#savePreset');
    const importedSave=await importedSaveEvent,importedPreset=JSON.parse(await fs.readFile(await importedSave.path(),'utf8'));
    assert.deepEqual(importedPreset,state.preset,'imported VGM sound can be saved as a portable instrument');

    check('VGM DMC RAM snapshots select into the sample editor and produce actual PCM');
    await page.setInputFiles('#vgmFileInput',{name:'self-authored-mixed-dmc.vgm',mimeType:'application/octet-stream',buffer:makeDmcInstrumentVgm({mixed:true})});
    await page.waitForFunction(()=>document.querySelector('#vgmLibrary').dataset.loading==='false'&&document.querySelectorAll('[data-vgm-voice]').length===7);
    await page.click('[data-vgm-filter="dmc"]');assert.equal(await page.locator('[data-vgm-voice]').count(),2);
    state=await importVoice(0,preset=>preset.source==='dmc'&&preset.dmc.data.length===257);
    await assertDmcHistory(0,0);
    assert.equal(await page.isVisible('#dmcBitEditor'),true);await dmcFirst();await assertDmcPreview(state.preset);
    assert.equal(await dmcBit(0,0).getAttribute('aria-pressed'),'true');
    await dmcBit(0,0).click();state=await waitState(value=>value.preset.dmc.data[0]===(vgmDmcFirst[0]^1));
    await assertDmcPreview(state.preset);
    await dmcBit(0,0).click();state=await waitState(value=>value.preset.dmc.data[0]===vgmDmcFirst[0]);
    await assertDmcHistory(2,0);
    assert.deepEqual(state.preset.dmc,{data:[...vgmDmcFirst],rate:15,loop:true,level:66});assert.equal(state.capacity,1);
    await page.locator('[data-vgm-voice]').first().click();await assertDmcHistory(0,0);
    assert.deepEqual((await inspect()).preset.dmc.data,[...vgmDmcFirst],'selecting the same VGM voice resets history even with identical bytes');
    check('VGM-recovered DPCM uses the same mouse drawing editor');
    const vgmBeforeDraw=structuredClone(state.preset);
    await startDmcDraw(.02,8);await moveDmcDraw(.98,16,4);assert.equal(await dmcDrawing(),'true');
    assert.deepEqual((await inspect()).preset,vgmBeforeDraw);
    await page.mouse.up();state=await waitState(value=>JSON.stringify(value.preset.dmc.data)!==JSON.stringify(vgmBeforeDraw.dmc.data));
    assert.equal(state.preset.dmc.data.length,257);await assertDmcPreview(state.preset);
    await page.locator('[data-vgm-voice]').first().click();
    state=await waitState(value=>value.preset.dmc.data[0]===vgmDmcFirst[0]&&JSON.stringify(value.preset.dmc.data)===JSON.stringify([...vgmDmcFirst]));
    await assertDmcHistory(0,0);
    for(const selector of pitchWheels)assert.equal(await page.isDisabled(selector),true);
    state=await importVoice(1,preset=>preset.source==='dmc'&&preset.dmc.data.length===17);
    assert.deepEqual(state.preset.dmc,{data:[...vgmDmcSecond],rate:7,loop:true,level:32});
    await downloadDpcm(vgmDmcSecond);
    const vgmDmcSaveEvent=page.waitForEvent('download');await page.click('#savePreset');
    const vgmDmcSave=await vgmDmcSaveEvent,vgmDmcPreset=JSON.parse(await fs.readFile(await vgmDmcSave.path(),'utf8'));
    assert.deepEqual(vgmDmcPreset,state.preset,'the original captured DPCM bytes are portable');
    await page.click('#copyCode');assert.match(await page.locator('#codeOutput').inputValue(),/await nes\.dmc\.loadSample/);
    assert.match(await page.locator('#codeOutput').inputValue(),/"rate":7/);
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1);assert.equal(state.voices[0].channel,4);await sound();
    const capturedDmc=structuredClone(state),dmcLibraryBefore=await page.locator('#vgmVoices').innerText();
    await page.setInputFiles('#vgmFileInput',{name:'missing-dmc-ram.vgm',mimeType:'application/octet-stream',buffer:makeDmcInstrumentVgm({missing:true})});
    await page.waitForFunction(()=>document.querySelector('#vgmLibrary').dataset.loading==='false'&&document.querySelector('#vgmStatus').dataset.error==='true');
    state=await inspect();assert.deepEqual(state.preset,capturedDmc.preset);assert.deepEqual(state.voices,capturedDmc.voices);
    assert.equal(await page.locator('#vgmVoices').innerText(),dmcLibraryBefore);await sound();

    check('DMC-only VGZ imports concatenated bank data through NES RAM copy');
    await page.setInputFiles('#vgmFileInput',{name:'self-authored-bank-dmc.vgz',mimeType:'application/gzip',buffer:gzipSync(makeBankDmcVgm())});
    await page.waitForFunction(()=>document.querySelector('#vgmLibrary').dataset.loading==='false'&&document.querySelector('#vgmFileName').textContent==='self-authored-bank-dmc.vgz'&&document.querySelectorAll('[data-vgm-voice]').length===1);
    state=await inspect();assert.deepEqual(state.preset,capturedDmc.preset);assert.deepEqual(state.voices,capturedDmc.voices);
    await page.click('[data-vgm-filter="dmc"]');
    state=await importVoice(0,preset=>preset.source==='dmc'&&preset.dmc.rate===10&&preset.dmc.level===48);
    assert.deepEqual(state.preset.dmc.data,[...vgmDmcSecond]);assert.equal(state.preset.dmc.loop,true);
    assert.match(await page.locator('#dpcmStatus').textContent(),/17.*bytes/);
    if(config.screenshots) {
      await page.setViewportSize({width:390,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,'VGM DMC library fits a narrow screen');await screenshot('vgm-dmc-mobile');
      await page.setViewportSize({width:1180,height:940});
    }

    check('VGM Noise Envelope maps to hardware settings without a fixed-volume approximation');
    await page.setInputFiles('#vgmFileInput',{name:'self-authored-noise-envelope.vgm',mimeType:'application/octet-stream',buffer:makeNoiseEnvelopeVgm()});
    await page.waitForFunction(()=>document.querySelector('#vgmLibrary').dataset.loading==='false'&&document.querySelector('#vgmFileName').textContent==='self-authored-noise-envelope.vgm'&&document.querySelectorAll('[data-vgm-voice]').length===1);
    state=await importVoice(0,preset=>preset.source==='noise'&&preset.noise.envelope.enabled);
    assert.deepEqual(state.preset.noise.envelope,{enabled:true,period:3,loop:true});
    assert.equal(await page.isChecked('#noiseEnvelopeEnabled'),true);assert.equal(await page.isChecked('#noiseEnvelopeLoop'),true);
    assert.equal(await page.locator('#noiseEnvelopePeriod').textContent(),'3');
    assert.equal(await page.isVisible('#vgmVoiceWarnings'),false);
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1);
    assert.equal(state.registers[0x0c],0x23);await sound();await page.keyboard.up('a');await stop();

    check('VGM FDS volume Envelope retains recorded seed, direction and clocks for audition');
    await page.setInputFiles('#vgmFileInput',{name:'self-authored-fds-envelope.vgm',mimeType:'application/octet-stream',buffer:makeFdsEnvelopeVgm()});
    await page.waitForFunction(()=>document.querySelector('#vgmLibrary').dataset.loading==='false'&&document.querySelector('#vgmFileName').textContent==='self-authored-fds-envelope.vgm'&&document.querySelectorAll('[data-vgm-voice]').length===1);
    state=await importVoice(0,preset=>preset.source==='fds'&&preset.fds.envelope.enabled);
    assert.deepEqual(state.preset.fds.envelope,{enabled:true,increase:true,period:8,initialGain:0});
    assert.deepEqual(state.preset.fds.envelopeClock,{masterSpeed:232,halt:false});
    assert.equal(await page.isChecked('#fdsEnvelopeEnabled'),true);assert.equal(await page.locator('#fdsEnvelopeInitialGain').textContent(),'0');
    assert.equal(await choiceButton('#fdsEnvelopeIncrease',true).getAttribute('aria-checked'),'true');
    assert(!/FDS volume Envelope is approximated by fixed volume/i.test(await page.locator('#vgmVoiceWarnings').textContent()));
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1&&value.coreState.fdsGain>0);
    assert.equal(state.registers[0x80],0x48);assert.equal(state.registers[0x8a],232);await sound();await page.keyboard.up('a');await stop();

    check('VGM FDS Depth Envelope uses the shared clock with fixed volume');
    await page.setInputFiles('#vgmFileInput',{name:'self-authored-fds-depth-envelope.vgm',mimeType:'application/octet-stream',buffer:makeFdsDepthEnvelopeVgm()});
    await page.waitForFunction(()=>document.querySelector('#vgmLibrary').dataset.loading==='false'&&document.querySelector('#vgmFileName').textContent==='self-authored-fds-depth-envelope.vgm'&&document.querySelectorAll('[data-vgm-voice]').length===1);
    state=await importVoice(0,preset=>preset.source==='fds'&&preset.fds.modulation.envelope.enabled);
    assert.equal(state.preset.fds.envelope.enabled,false);
    assert.deepEqual(state.preset.fds.modulation.envelope,{enabled:true,increase:true,period:8,initialGain:0});
    assert.deepEqual(state.preset.fds.envelopeClock,{masterSpeed:232,halt:false});
    assert.equal(await page.isChecked('#fdsModEnvelopeEnabled'),true);assert.equal(await page.isChecked('#fdsEnvelopeEnabled'),false);
    assert(!/FDS modulation Envelope is approximated by fixed depth/i.test(await page.locator('#vgmVoiceWarnings').textContent()));
    await page.keyboard.down('a');state=await waitState(value=>value.voices.length===1&&value.coreState.fdsSweepGain>0);
    assert.equal(state.registers[0x84],0x48);assert.equal(state.registers[0x83]&0xc0,0);await sound();await page.keyboard.up('a');await stop();
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
      noiseEnvelopePassive:true,noiseEnvelopeHardwareDecay:true,noiseEnvelopeHardwareLoop:true,noiseEnvelopeNextTrigger:true,noiseEnvelopeLiveClock:true,noiseEnvelopeLateRelease:true,noiseEnvelopeKeyboardFocus:true,noiseEnvelopePresetRoundTrip:true,noiseEnvelopeCodeExport:true,noiseEnvelopeVgmImport:true,noiseEnvelopeMobile:true,presetV1V2Migration:true,
      fdsEnvelopePassive:true,fdsEnvelopeHardwareRise:true,fdsEnvelopeHardwareDecay:true,fdsEnvelopeSeed:true,fdsEnvelopeFreeze:true,fdsEnvelopeNextTrigger:true,fdsEnvelopeMasterLive:true,fdsEnvelopePitchLive:true,fdsEnvelopeModulationLive:true,fdsEnvelopeLateRelease:true,fdsEnvelopeKeyboardFocus:true,fdsEnvelopePresetRoundTrip:true,fdsEnvelopeCodeExport:true,fdsEnvelopeVgmImport:true,fdsEnvelopeMobile:true,presetV1V2V3Migration:true,
      fdsDepthEnvelopePassive:true,fdsDepthEnvelopeHardwareRise:true,fdsDepthEnvelopeHardwareDecay:true,fdsDepthEnvelopeOnly:true,fdsDepthEnvelopeSharedClock:true,fdsDepthEnvelopeDualFreeze:true,fdsDepthEnvelopeNextTrigger:true,fdsDepthEnvelopeLiveEdits:true,fdsDepthEnvelopeLateRelease:true,fdsDepthEnvelopePresetRoundTrip:true,fdsDepthEnvelopeCodeExport:true,fdsDepthEnvelopeVgmImport:true,fdsDepthEnvelopeMobile:true,presetV1V2V3V4Migration:true,
      fdsWaveDrawing:true,fdsModulationDrawing:true,fdsModulationAudible:true,presetRoundTrip:true,invalidPresetAtomic:true,copyJavaScript:true,
      vgmImportSilent:true,vgmFiveVoices:true,vgmSourceFilters:true,vgmPaging:true,vgmSelectionKeyboard:true,vgmImportedPresetExport:true,
      vgmFileNotesExpandable:true,vgmApproximationVisible:true,vgmFailuresKeepSound:true,vgmCancelKeepsSound:true,vgzImport:true,vgmCloseKeepsSound:true,
      vgmDmcImportSilent:true,vgmDmcFilter:true,vgmDmcSelectionKeyboard:true,vgmDmcSnapshots:true,vgmDmcPortableBytes:true,vgmDmcMissingRamKeepsSound:true,vgmDmcBankCopyVgz:true,
      dpcmLoadPassive:true,dmcEmptySampleGate:true,dmcMonophonic:true,dmcIgnoresNotePitch:true,dmcLiveRate:true,dmcLoopAndOneShot:true,
      dpcmFailuresKeepSound:true,dpcmCancelKeepsSound:true,dpcmSupersededReadSafe:true,dpcmDemoSupersedesRead:true,dpcmSampleChangeStopsNotes:true,dmcPresetExport:true,dmcCopyAwaitedMemory:true,legacyV1PresetMigration:true,dmcMobileLayout:true,
      dmcBitEditorPassive:true,dmcBitOrder:true,dmcBitKeyboardEditing:true,dmcBitModifierShortcuts:true,dmcPaddingReadOnly:true,dmcDacPreview:true,dmcLoopPreviewCarry:true,dmcDacOddLimits:true,dmcRatePreviewTime:true,
      dmcBitWindowBounded:true,dmcBitLastByte:true,dmcBitEditStopsNotes:true,dmcEditedPresetRoundTrip:true,dmcVgmBitEditor:true,dmcBitEditorMobile:true,
      dmcDrawPassive:true,dmcDrawPreview:true,dmcDrawReleaseCommit:true,dmcDrawPaddingProtected:true,dmcDrawEscapeCancel:true,dmcDrawPointerCancel:true,dmcDrawPageCancel:true,dmcDrawResizeCancel:true,dmcDrawParameterCancel:true,dmcDrawSourceCancel:true,dmcDrawMaximumLength:true,dmcVgmDrawEditor:true,
      dmcUndoRedoPassive:true,dmcUndoBit:true,dmcUndoStroke:true,dmcUndoBranch:true,dmcUndoNoopKeepsRedo:true,dmcHistoryPreviewExcluded:true,dmcHistoryCancelExcluded:true,
      dmcHistoryShortcutsScoped:true,dmcHistoryUnavailableShortcutsPass:true,dmcHistoryPreservesControls:true,dmcHistoryPreservesSourceToggle:true,dmcUndoStopsHeldAudio:true,dmcRedoRealPlayback:true,dmcUndoClearsDraftAndTarget:true,
      dmcHistoryIdenticalFileReset:true,dmcHistoryIdenticalDemoReset:true,dmcHistoryIdenticalPresetReset:true,dmcHistoryIdenticalVgmReset:true,dmcHistoryResetPreset:true,dmcSaveAfterUndo:true,
      dpcmExportEmptyGate:true,dpcmExportPassive:true,dpcmExportRawBytes:true,dpcmExportOriginalLength:true,dpcmExportBitEdit:true,dpcmExportDrawing:true,dpcmExportCommittedDuringDraft:true,
      dpcmExportUndo:true,dpcmExportEndpoints:true,dpcmExportKeepsControls:true,dpcmExportKeepsHistory:true,dpcmExportKeepsHeldAudio:true,dpcmExportKeepsPendingRead:true,dpcmExportKeyboardFocus:true,dpcmExportVgm:true,dpcmExportRoundTrip:true,
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
