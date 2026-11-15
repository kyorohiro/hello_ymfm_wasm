// SPDX-License-Identifier: BSD-3-Clause
// Exercise the real OPNA AudioWorklet. Every speaker connection is muted here.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {chromium,webkit} = require('playwright');
const {gzipSync} = require('node:zlib');
const {pathToFileURL} = require('node:url');

const config = {root:path.resolve(__dirname,'../docs'),entry:'/synth-fm2608/index.html',
  engines:'chromium,webkit',editor:'fallback',song:'',out:path.resolve(__dirname,'../build/fm2608-synth-browser.json'),
  screenshots:path.resolve(__dirname,'../build/fm2608-synth-browser')};
for (const argument of process.argv.slice(2)) {
  const match = /^--(root|entry|engines|editor|song|out|screenshots)=(.+)$/.exec(argument);
  assert(match,'Unknown argument ' + argument);
  config[match[1]] = match[2];
}
config.root = path.resolve(config.root);
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm',
  '.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
const results = [], missing = [];
let server;

function makeWav() {
  const rate = 22050, frames = 2205, bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8,4); bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(rate,24); bytes.writeUInt32LE(rate * 2,28);
  bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34); bytes.write('data',36);
  bytes.writeUInt32LE(frames * 2,40);
  for (let index = 0; index < frames; index++) bytes.writeInt16LE(Math.round(Math.sin(index / rate * Math.PI * 440) * 16000),44 + index * 2);
  return bytes;
}

async function makeReferenceFiles() {
  const moduleUrl = name => pathToFileURL(path.resolve(__dirname,'../docs',name)).href;
  const [{YM2608Synth},{createDefaultPreset,readFmPreset,FM_PRESETS}] = await Promise.all([
    import(moduleUrl('js/ym2608synth.js')),import(moduleUrl('synth-fm2608/preset.js')),
  ]);
  const writes = [], chip = new YM2608Synth({transport:{write:(port,register,value) => writes.push([port,register,value])}});
  const sample = Buffer.from(createDefaultPreset().adpcm.data,'base64');
  chip.setPreset(0,readFmPreset(FM_PRESETS.sine));
  chip.noteOn(0,'C4');
  chip.ssg.tone(0,{frequency:220,volume:7});
  chip.ssg.setEnvelope({period:512,shape:0});
  chip.ssg.tone(1,{frequency:330,volume:7,envelope:true});
  chip.rhythm.setVolume(48);
  chip.rhythm.setVoice(0,{volume:24,left:true,right:true});
  chip.rhythm.keyOn(0);
  chip.adpcm.setSample({start:256,end:256+sample.length});
  chip.adpcm.setPlaybackRate(22050);
  chip.adpcm.setVolume(120);
  chip.adpcm.setPan(true,true);
  chip.adpcm.keyOn({repeat:true});
  const block = Buffer.alloc(15+sample.length);
  block.set([0x67,0x66,0x81]);block.writeUInt32LE(8+sample.length,3);
  block.writeUInt32LE(0x200000,7);block.writeUInt32LE(256,11);sample.copy(block,15);
  const commands = [...block,...writes.flatMap(([port,register,value]) => [0x56+port,register,value])];
  for (let second=0; second<16; second++) commands.push(0x56,0xb0,(second % 8) << 3 | 7,0x61,0x44,0xac);
  commands.push(0x66);
  const vgm = Buffer.alloc(256+commands.length);
  vgm.set([0x56,0x67,0x6d,0x20]);vgm.writeUInt32LE(vgm.length-4,4);vgm.writeUInt32LE(0x171,8);
  vgm.writeUInt32LE(256-0x34,0x34);vgm.writeUInt32LE(8000000,0x48);vgm.writeUInt32LE(16*44100,0x18);vgm.set(commands,256);
  const s98Commands = [...writes.filter(([port]) => port===0).flatMap(([port,register,value]) => [port,register,value]),...Array(1600).fill(0xff),0xfd];
  const s98 = Buffer.alloc(48+s98Commands.length);
  s98.set([83,57,56,51]);s98.writeUInt32LE(1,4);s98.writeUInt32LE(100,8);s98.writeUInt32LE(48,0x14);
  s98.writeUInt32LE(1,0x1c);s98.writeUInt32LE(4,0x20);s98.writeUInt32LE(7987200,0x24);s98.set(s98Commands,48);
  const opnWrites = writes.filter(([port,register]) => port === 0 &&
    (register < 16 || register === 0x28 || register >= 0x30 && register <= 0xb2));
  const opnCommands = opnWrites.flatMap(([,register,value]) => [0x55,register,value]);
  for (let second=0; second<16; second++) opnCommands.push(0x55,0xb0,(second % 8) << 3 | 7,0x61,0x44,0xac);
  opnCommands.push(0x66);
  const opnVgm = Buffer.alloc(256+opnCommands.length);
  vgm.copy(opnVgm,0,0,256);
  opnVgm.writeUInt32LE(opnVgm.length-4,4);opnVgm.writeUInt32LE(4000000,0x44);opnVgm.writeUInt32LE(0,0x48);opnVgm.set(opnCommands,256);
  const opnS98Commands = [...opnWrites.flatMap(([,register,value]) => [0,register,value]),...Array(1600).fill(0xff),0xfd];
  const opnS98 = Buffer.alloc(48+opnS98Commands.length);
  s98.copy(opnS98,0,0,48);
  opnS98.writeUInt32LE(2,0x20);opnS98.writeUInt32LE(4000000,0x24);opnS98.set(opnS98Commands,48);
  const endingCommands = [...block,...writes.flatMap(([port,register,value]) => [0x56+port,register,value]),0x61,0x44,0xac,0x66];
  const ending = Buffer.alloc(256+endingCommands.length);
  vgm.copy(ending,0,0,256);
  ending.writeUInt32LE(ending.length-4,4);ending.writeUInt32LE(44100,0x18);ending.set(endingCommands,256);
  return {sample,files:[{name:'OPNA reference.vgm',mimeType:'application/octet-stream',buffer:vgm},
    {name:'OPNA reference.vgz',mimeType:'application/octet-stream',buffer:gzipSync(vgm)},
    {name:'OPNA reference.s98',mimeType:'application/octet-stream',buffer:s98}],
    opnFiles:[{name:'OPN reference.vgm',mimeType:'application/octet-stream',buffer:opnVgm},
      {name:'OPN reference.vgz',mimeType:'application/octet-stream',buffer:gzipSync(opnVgm)},
      {name:'OPN reference.s98',mimeType:'application/octet-stream',buffer:opnS98}],
    endingFile:{name:'Ended reference.vgm',mimeType:'application/octet-stream',buffer:ending}};
}

async function downloadBytes(download) {
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function installAudit() {
  const Context = window.AudioContext ?? window.webkitAudioContext;
  const Worklet = window.AudioWorkletNode, connect = AudioNode.prototype.connect, post = MessagePort.prototype.postMessage;
  const audit = window.__opnaAudit = {contexts:[],worklets:[],meters:[],commands:[]};
  window.AudioContext = class extends Context {
    constructor(...args) { super(...args); audit.contexts.push(this); }
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(...args) { super(...args); audit.worklets.push({node:this,name:args[1]}); }
  };
  AudioNode.prototype.connect = function(destination,...args) {
    if (destination !== this.context.destination) return connect.call(this,destination,...args);
    const analyser = this.context.createAnalyser(), mute = this.context.createGain();
    analyser.fftSize = 4096;
    mute.gain.value = 0;
    connect.call(this,analyser);
    connect.call(analyser,mute);
    connect.call(mute,destination);
    audit.meters.push({analyser,mute});
    return destination;
  };
  MessagePort.prototype.postMessage = function(message,...args) {
    if (message?.type === 'write') {
      audit.commands.push({port:message.port,register:message.register,value:message.value});
      if (audit.commands.length > 5000) audit.commands.shift();
    }
    return post.call(this,message,...args);
  };
  audit.sample = () => {
    const meter = audit.meters.at(-1);
    if (!meter) return {rms:0,peak:0,finite:true,muted:true};
    const values = new Float32Array(meter.analyser.fftSize);
    meter.analyser.getFloatTimeDomainData(values);
    const mean = values.reduce((sum,value) => sum + value,0) / values.length;
    let square = 0, peak = 0;
    for (const value of values) { square += (value - mean) ** 2; peak = Math.max(peak,Math.abs(value)); }
    return {rms:Math.sqrt(square / values.length),peak,finite:values.every(Number.isFinite),
      muted:audit.meters.every(value => value.mute.gain.value === 0)};
  };
}
async function checkEngine(name,origin) {
  assert(['chromium','webkit'].includes(name));
  const browser = await ({chromium,webkit}[name]).launch({headless:true,...(name === 'chromium' ? {args:['--mute-audio']} : {})});
  const checks = [], errors = [], failures = [], ym2203Assets = [];
  let page, stage = 'startup';
  const check = label => { stage = label; checks.push(label); console.log(name + ': ' + label); };
  try {
    page = await browser.newPage({viewport:{width:1180,height:1000},acceptDownloads:true});
    page.setDefaultTimeout(20000);
    page.on('pageerror',error => errors.push(error.message));
    page.on('response',response => { if (response.status() >= 400) failures.push(response.url()); });
    page.on('request',request => { if (/ym2203_wasm\.(?:js|wasm)(?:\?|$)/.test(request.url())) ym2203Assets.push(request.url()); });
    await page.route('**/*',route => {
      const url = new URL(route.request().url());
      const editorAsset = config.editor === 'monaco' && url.href.startsWith('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/');
      return url.origin === origin || ['data:','blob:'].includes(url.protocol) || editorAsset ? route.continue() : route.abort();
    });
    await page.addInitScript(installAudit);
    await page.goto(origin + config.entry);
    await page.waitForFunction(() => document.querySelector('#opnaSaveSoundAs')?.disabled === false);
    assert.deepEqual(errors,[]);
    assert.equal(await page.title(),'Tetorica FM2608 Synth');
    check('loads without audio and Files is ready');
    assert.equal(await page.evaluate(() => __opnaAudit.contexts.length),0);
    await page.screenshot({path:path.join(config.screenshots,name + '-initial.png'),fullPage:true});

    const algorithmControl = page.locator('[data-control="fm.algorithm"]');
    const initialAlgorithm = Number(await algorithmControl.locator('.param-value').textContent());
    for (let step=0; step<7; step++) await algorithmControl.locator('.param-button').first().click();
    const routings = [
      'OP1 -> OP2 -> OP3 -> OP4 -> OUT',
      '(OP1 + OP2) -> OP3 -> OP4 -> OUT',
      '(OP1 + (OP2 -> OP3)) -> OP4 -> OUT',
      '((OP1 -> OP2) + OP3) -> OP4 -> OUT',
      '(OP1 -> OP2) + (OP3 -> OP4) -> OUT',
      '(OP1 -> OP2) + (OP1 -> OP3) + (OP1 -> OP4) -> OUT',
      '(OP1 -> OP2) + OP3 + OP4 -> OUT',
      'OP1 + OP2 + OP3 + OP4 -> OUT',
    ];
    for (const [algorithm,routing] of routings.entries()) {
      if (algorithm) await algorithmControl.locator('.param-button').last().click();
      await page.waitForFunction(({algorithm,routing}) => document.querySelector('#fmAlgorithm').textContent.startsWith('ALGO '+algorithm+' '+routing),{algorithm,routing});
    }
    const operatorColors = ['rgb(242, 192, 120)','rgb(255, 147, 188)','rgb(157, 255, 155)','rgb(137, 183, 255)'];
    for (let operator=1; operator<=4; operator++) {
      const colors = await page.evaluate(operator => [
        document.querySelector('[data-operator-gate="'+operator+'"]'),
        document.querySelector('[data-envelope-operator="'+operator+'"]'),
        document.querySelector('#fmAlgorithm .op-color-'+operator),
        document.querySelector('#channel3Frequency'+(operator-1)+' h3'),
      ].map(node => getComputedStyle(node).color),operator);
      assert.deepEqual(colors,Array(4).fill(operatorColors[operator-1]));
    }
    assert.deepEqual(await page.locator('#operatorHeader .param-label-category-envelope').allTextContents(),['RS','AR','D1R','D2R','SL','RR']);
    assert.equal(await page.locator('#operatorControls .param-category-envelope').count(),24);
    assert.equal(await page.locator('#operatorControls .param-category-envelope').first().evaluate(node => getComputedStyle(node).borderTopColor),'rgb(167, 125, 98)');
    for (let step=7; step>initialAlgorithm; step--) await algorithmControl.locator('.param-button').first().click();
    await page.locator('[data-operator-envelope]').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('[data-envelope-readout]').textContent.includes('OP4'));
    await page.screenshot({path:path.join(config.screenshots,name + '-fm-routing.png'),fullPage:true});
    await page.setViewportSize({width:390,height:1000});
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 2);
    await page.screenshot({path:path.join(config.screenshots,name + '-fm-routing-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1180,height:1000});
    assert.equal(await page.evaluate(() => __opnaAudit.contexts.length),0);
    check('all eight ALGO routings, matched OP colors and envelope parameter colors update without audio');

    if (config.editor === 'monaco') {
      await page.locator('#synthInputCodeTab').click();
      await page.waitForFunction(() => {
        const host = document.querySelector('#synthCodeEditorHost');
        return window.monaco?.editor?.getEditors().some(editor => host.contains(editor.getDomNode()));
      },null,{timeout:60000});
      assert((await page.locator('#synthCodeEditorHost').boundingBox()).height > 200);
      const source = 'const opna = await useSoundChip("ym2608");\nopna.setFrequency(CH1, 440);\nopna.ssg.setEnvelope({period: 512, shape: 10});\nopna.rhythm.keyOn("snare");\nopna.adpcm.keyOn({repeat: true});\nopna.setCsm(true, {timerA: 900, running: false});\nconst captured = opna.capturePreset();\nconsole.log(captured.adpcm.start, captured.fm[0].keyMask);\nconst motion = await livePrepare("motion", () => ({ratio: 1}));\nawait tween({beats: 2}, p => {motion.ratio = p;});\n';
      await page.evaluate(source => {
        const host = document.querySelector('#synthCodeEditorHost');
        monaco.editor.getEditors().find(editor => host.contains(editor.getDomNode())).setValue(source);
      },source);
      const diagnostics = await page.evaluate(async () => {
        const model = monaco.editor.getModels().find(model => model.uri.path === '/project/index.js');
        const worker = await (await monaco.languages.typescript.getJavaScriptWorker())(model.uri);
        return {syntax:await worker.getSyntacticDiagnostics(model.uri.toString()),semantic:await worker.getSemanticDiagnostics(model.uri.toString())};
      });
      assert.deepEqual(diagnostics,{syntax:[],semantic:[]});
      check('actual Monaco is visible and its worker accepts all four OPNA sections');
      await page.evaluate(() => {
        const host = document.querySelector('#synthCodeEditorHost');
        const editor = monaco.editor.getEditors().find(editor => host.contains(editor.getDomNode()));
        const model = editor.getModel(), index = model.getValue().indexOf('opna.adpcm.keyOn') + 'opna.adpcm.'.length + 1;
        editor.updateOptions({gotoLocation:{multipleDefinitions:'goto'}});
        editor.setPosition(model.getPositionAt(index)); editor.focus();
        editor.trigger('opna-browser-check','editor.action.revealDefinition',{});
      });
      const dialog = page.locator('dialog[data-monaco-definition="true"]');
      await dialog.waitFor({state:'visible'});
      await dialog.getByRole('button',{name:'View implementation',exact:true}).click();
      await page.waitForFunction(() => document.querySelector('dialog[data-monaco-definition="true"] strong')?.textContent === 'ym2608synth.js (read-only)');
      const implementation = await page.evaluate(() => {
        const model = monaco.editor.getModels().find(model => model.uri.path === '/tetorica-runtime/ym2608synth.js');
        const editor = monaco.editor.getEditors().find(editor => editor.getModel() === model);
        return model.getLineContent(editor.getPosition().lineNumber);
      });
      assert.match(implementation,/keyOn.*repeat/);
      await dialog.getByRole('button',{name:'Close',exact:true}).click();
      check('ADPCM completion opens the correct readable implementation');
      for (const [symbol,file,expected] of [['setCsm','sound_state.js','installChannel3Controls'],['capturePreset','audio.js','capturePreset']]) {
        await page.evaluate(symbol => {
          const host = document.querySelector('#synthCodeEditorHost');
          const editor = monaco.editor.getEditors().find(editor => host.contains(editor.getDomNode()));
          const model = editor.getModel(), index = model.getValue().indexOf('opna.'+symbol) + 'opna.'.length + 1;
          editor.setPosition(model.getPositionAt(index));editor.focus();
          editor.trigger('opna-browser-check','editor.action.revealDefinition',{});
        },symbol);
        await dialog.waitFor({state:'visible'});
        await dialog.getByRole('button',{name:'View implementation',exact:true}).click();
        await page.waitForFunction(file => document.querySelector('dialog[data-monaco-definition="true"] strong')?.textContent === file+' (read-only)',file);
        const line = await page.evaluate(file => {
          const model = monaco.editor.getModels().find(model => model.uri.path.endsWith('/'+file));
          const editor = monaco.editor.getEditors().find(editor => editor.getModel() === model);
          return model.getLineContent(editor.getPosition().lineNumber);
        },file);
        assert(line.includes(expected));
        await dialog.getByRole('button',{name:'Close',exact:true}).click();
      }
      check('CSM and portable capture navigate to their Synth implementation');
      await page.locator('#synthCodeExpandButton').click();
      assert.equal(await page.locator('#synthExpandedCodeSlot #synthCodeEditorHost').count(),1);
      for (const width of [1180,390]) {
        await page.setViewportSize({width,height:1000});
        await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 2);
        assert((await page.locator('#synthCodeEditorHost').boundingBox()).height > 200);
      }
      await page.screenshot({path:path.join(config.screenshots,name + '-monaco.png'),fullPage:true});
      check('actual Monaco expands beside Files and fits mobile');
      assert.equal(await page.evaluate(() => __opnaAudit.contexts.length),0);
      assert.deepEqual(errors,[]);
      assert.deepEqual(failures,[]);
      return {engine:name,passed:true,checks,diagnostics,audioContexts:0,errors};
    }

    await page.locator('[data-operator-envelope]').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('[data-envelope-readout]').textContent.includes('OP4'));
    await page.locator('[data-envelope-operator="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-envelope-readout]').textContent.includes('OP1'));
    await page.locator('[data-envelope-handle="attack"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('[data-envelope-readout]').textContent.includes('AR 30'));
    assert.equal(await page.evaluate(() => __opnaAudit.contexts.length),0);
    await page.screenshot({path:path.join(config.screenshots,name + '-initial.png'),fullPage:true});
    check('operator envelope draws on view and edits without creating audio');

    await page.locator('#startAudio').click();
    await page.waitForFunction(() => document.querySelector('#startAudio').textContent === 'Audio ready');
    assert.equal(await page.evaluate(() => __opnaAudit.worklets.filter(item => item.name === 'ym2608-processor').length),1);
    const audible = async () => {
      await page.waitForFunction(() => { const value = __opnaAudit.sample(); return value.muted && value.finite && value.rms > .00005; });
      return page.evaluate(() => __opnaAudit.sample());
    };
    const quiet = () => page.waitForFunction(() => __opnaAudit.sample().rms < .000002);
    await page.locator('#fmPreset').selectOption('sine');
    await page.locator('#channelTabs [data-channel="0"]').click();
    await page.keyboard.down('a');
    const fm = await audible();
    await page.keyboard.up('a');
    await quiet();
    check('FM keyboard produces actual PCM and releases');

    await page.locator('#tab-ssg').click();
    await page.locator('#channelTabs [data-channel="0"]').click();
    await page.keyboard.down('a');
    const ssg = await audible();
    await page.locator('[data-control="ssg.volume"] .param-button').last().click();
    await page.keyboard.up('a');
    await quiet();
    check('SSG keyboard and live parameter editing');

    await page.locator('#tab-rhythm').click();
    await page.locator('[data-rhythm-pad="0"]').click();
    const rhythm = await audible();
    await page.locator('#stopAudio').click();
    await quiet();
    check('synthetic hardware rhythm ROM produces PCM');

    const rhythmPadNames = ['Bass drum (F)','Snare (G)','Cymbal (H)','Hi-hat (J)','Tom (K)','Rim shot (L)'];
    assert.deepEqual(await page.locator('[data-rhythm-pad]').allTextContents(),rhythmPadNames);
    for (const [voice,key] of [...'fghjkl'].entries()) {
      const commandCount = await page.evaluate(() => __opnaAudit.commands.length);
      await page.keyboard.down(key);
      await page.waitForFunction(({commandCount,voice}) => __opnaAudit.commands.slice(commandCount).some(command =>
        command.port === 0 && command.register === 0x10 && command.value === 1 << voice),{commandCount,voice});
      await page.keyboard.up(key);
    }
    await page.locator('#octaveUp').click();
    assert.deepEqual(await page.locator('[data-rhythm-pad]').allTextContents(),rhythmPadNames);
    await page.locator('#octaveDown').click();
    await page.locator('#channelTabs [data-channel="2"]').click();
    assert.equal(await page.locator('[data-rhythm-pad="2"]').textContent(),'Cymbal (Any key)');
    assert.equal(await page.locator('[data-rhythm-pad="0"]').textContent(),'Bass drum');
    assert.match(await page.locator('#keyboardHint').textContent(),/Cymbal · all note keys/);
    const fixedRhythmCommands = await page.evaluate(() => __opnaAudit.commands.length);
    await page.keyboard.down('a');
    await page.waitForFunction(start => __opnaAudit.commands.slice(start).some(command =>
      command.port === 0 && command.register === 0x10 && command.value === 4),fixedRhythmCommands);
    await page.keyboard.up('a');
    await page.locator('#channelTabs [data-channel="auto"]').click();
    assert.deepEqual(await page.locator('[data-rhythm-pad]').allTextContents(),rhythmPadNames);
    await page.locator('#rhythmPads').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(config.screenshots,name + '-rhythm-keys.png'),fullPage:true});
    await page.locator('#stopAudio').click();
    await quiet();
    check('Rhythm pad key labels match all six actual voices, Octave and fixed-channel keyboard input');

    await page.locator('#tab-adpcm').click();
    await page.keyboard.down('a');
    const adpcm = await audible();
    await page.locator('#drawWave').check();
    const canvas = page.locator('#waveCanvas'), box = await canvas.boundingBox();
    const beforeSample = await page.locator('#sampleInfo').textContent();
    await page.mouse.move(box.x + box.width * .2,box.y + box.height * .3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .4,box.y + box.height * .6,{steps:6});
    await page.mouse.up();
    await audible();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#sampleInfo').textContent(),beforeSample);
    await page.keyboard.up('a');
    await quiet();
    check('ADPCM keyboard and held-sample drawing preserve length/root');

    const baseRate = Number(await page.locator('[data-control="adpcm.sampleRate"] .param-value').textContent());
    await page.locator('#octaveDown').click();
    await page.keyboard.down('a');
    await audible();
    assert.equal(Number(await page.locator('[data-control="adpcm.sampleRate"] .param-value').textContent()),baseRate);
    const rateFromReadout = () => page.locator('#channelReadout').textContent().then(text => Number(/Playback ([\d,]+) Hz/.exec(text)[1].replaceAll(',','')));
    await page.waitForTimeout(180);
    const initialRate = await rateFromReadout();
    await page.locator('[data-control="adpcm.sampleRate"] .param-button').last().click();
    await page.waitForFunction(rate => Number(document.querySelector('[data-control="adpcm.sampleRate"] .param-value').textContent) === rate,baseRate + 1);
    await page.waitForTimeout(180);
    assert(Math.abs(await rateFromReadout() / initialRate - 1) < .01,'base-rate edit retains the held note transposition');
    await page.keyboard.up('a');
    await page.locator('#octaveUp').click();
    await quiet();
    check('ADPCM base-rate editing preserves a transposed held note');

    await page.locator('#audioFileInput').setInputFiles({name:'test-sample.wav',mimeType:'audio/wav',buffer:makeWav()});
    await page.waitForFunction(() => document.querySelector('#audioStatus').textContent.includes('Loaded test-sample.wav'));
    assert(!/^128 decoded/.test(await page.locator('#sampleInfo').textContent()));
    await page.keyboard.down('a');
    await audible();
    await page.keyboard.up('a');
    await quiet();
    const downloading = page.waitForEvent('download');
    await page.locator('#saveWaveButton').click();
    const waveDownload = await downloading, chunks = [];
    for await (const chunk of await waveDownload.createReadStream()) chunks.push(chunk);
    const waveBytes = Buffer.concat(chunks);
    assert.equal(waveBytes.toString('ascii',0,4),'RIFF');
    assert(waveBytes.length > 44 + 128 * 2);
    check('audio import encodes a complete sample and WAV export retains it');

    await page.locator('#opnaSaveSoundAs').click();
    await page.locator('#opnaFileNameInput').fill('Browser sound');
    await page.locator('#opnaFileNameConfirm').click();
    await page.locator('#opnaPresetSelect option').filter({hasText:'Browser sound'}).waitFor({state:'attached'});
    check('saves full OPNA settings to Files presets');
    if (await page.locator('#opnaFilesPanel').isHidden()) await page.locator('#opnaFilesToggle').click();
    await page.locator('#opnaFilesTree button[data-file-path="/presets/Browser sound.opna.json"]').click();
    assert.equal(await page.locator('#synthInputKeyboardTab').getAttribute('aria-selected'),'true');
    check('preset selection preserves Keyboard mode');

    await page.locator('#tab-fm').click();
    await page.locator('#opnaFilesTree button[data-file-path="/index.js"]').click();
    await page.locator('#synthInputCodeTab').click();
    await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    const code = 'const opna = await useSoundChip("ym2608");\nsetBpm(120);\nliveLoop("melody", async () => {\n  context.count = (context.count || 0) + 1;\n  opna.noteOn(CH1, "A3");\n  await beat(0.8);\n  opna.noteOff(CH1);\n  await beat(0.2);\n});\n';
    await page.locator('#synthCodeEditor').fill(code);
    await page.locator('#synthCodeRunButton').click();
    await page.waitForFunction(() => /Playing|Running/.test(document.querySelector('#synthCodeState').textContent));
    await audible();
    assert.equal(await page.locator('#synthCodeError').textContent(),'');
    await page.locator('#channelTabs [data-channel="0"]').click();
    await page.locator('[data-control="fm.feedback"] .param-button').last().click();
    await page.locator('#fmPreset').selectOption('two-op-bell');
    await page.locator('#synthInputKeyboardTab').click();
    assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);
    await page.waitForTimeout(180);
    await audible();
    check('Code shares OPNA; controls/preset/Keyboard view keep loops running');

    await page.locator('#synthCodeStopButton').click();
    await page.waitForFunction(() => /Stopped|Idle/.test(document.querySelector('#synthCodeState').textContent));
    await quiet();
    await page.keyboard.down('a');
    await audible();
    await page.keyboard.up('a');
    await page.locator('#stopAudio').click();
    await quiet();
    check('Code Stop is silent and keyboard can restart');

    await page.locator('#synthInputCodeTab').click();
    await page.locator('#synthCodeEditor').fill('const opna = await useSoundChip("ym2608");\nawait opna.noteOn(CH1,"A3");\nopna.ssg.tone(CH1,{frequency:220,volume:10});\nliveLoop("hold",async()=>{await beat(1);});\n');
    await page.locator('#synthCodeRunButton').click();
    await page.waitForFunction(() => /Playing|Running/.test(document.querySelector('#synthCodeState').textContent));
    await page.locator('#tab-mixer').click();
    const outputLevel = (id,value) => page.locator(id).evaluate((node,value) => {
      node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));
    },value);
    const nearLevel = (baseline,ratio) => page.waitForFunction(({baseline,ratio}) =>
      Math.abs(__opnaAudit.sample().rms/baseline-ratio)<.035,{baseline,ratio});
    await outputLevel('#mixerFmVolume',0);
    await page.waitForTimeout(200);
    const ssgUnity = (await audible()).rms;
    const keyWrites = await page.evaluate(() => __opnaAudit.commands.filter(value => value.register === 0x28).length);
    await outputLevel('#mixerSsgVolume',.5);
    await nearLevel(ssgUnity,.5);
    await page.locator('#ym2203Mode').check();
    await nearLevel(ssgUnity,.375);
    assert.match(await page.locator('#mixerCorrection').textContent(),/SSG ×0.75/);
    assert.match(await page.locator('#mixerEffective').textContent(),/SSG ×0.375/);
    await page.locator('#ym2203Mode').uncheck();
    await outputLevel('#mixerSsgVolume',0);
    await quiet();
    await outputLevel('#mixerFmVolume',1);
    await page.waitForTimeout(200);
    const fmUnity = (await audible()).rms;
    await outputLevel('#mixerFmVolume',.5);
    await nearLevel(fmUnity,.5);
    assert.equal(await page.evaluate(() => __opnaAudit.commands.filter(value => value.register === 0x28).length),keyWrites);
    assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);
    await outputLevel('#mixerFmVolume',1);
    await outputLevel('#mixerSsgVolume',1);
    await page.screenshot({path:path.join(config.screenshots,name + '-output-mixer.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 2);
    await page.screenshot({path:path.join(config.screenshots,name + '-output-mixer-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1180,height:1000});
    await page.locator('#synthCodeStopButton').click();
    await quiet();
    await page.locator('#tab-fm').click();
    check('software output Mixer scales FM and SSG independently and YM2203 mode preserves running Code notes');

    await page.locator('#synthInputCodeTab').click();
    const liveCode = 'const opna = await useSoundChip("ym2608");\nopna.write(0, 0xb0, 0x2f);\nopna.write(0, 0x22, 0x0b);\nopna.ssg.tone(0, {frequency:220, volume:7});\nopna.rhythm.setVoice(0, {volume:7});\nopna.adpcm.setVolume(90);\nopna.adpcm.setPlaybackRate(16000);\nopna.adpcm.keyOn({repeat:false});\nsetBpm(120);\nliveLoop("hold", async () => {await beat(1);});\n';
    await page.locator('#synthCodeEditor').fill(liveCode);
    await page.locator('#synthCodeRunButton').click();
    await page.waitForFunction(() => /Playing|Running/.test(document.querySelector('#synthCodeState').textContent));
    await page.locator('#channelTabs [data-channel="0"]').click();
    await page.waitForFunction(() => document.querySelector('[data-control="fm.algorithm"] .param-value').textContent === '7');
    assert.equal(await page.locator('#fmAlgorithm').textContent(),'ALGO 7 OP1 + OP2 + OP3 + OP4 -> OUT · OP1 feedback 5');
    assert.equal(await page.locator('[data-control="fm.feedback"] .param-value').textContent(),'5');
    assert.equal(await page.locator('[data-control="lfo.enabled"] .param-value').textContent(),'ON');
    assert.equal(await page.locator('[data-control="lfo.frequency"] .param-value').textContent(),'3');
    await page.locator('#synthMenu summary').first().click();
    const presetDownloadReady = page.waitForEvent('download');
    await page.locator('#exportSoundButton').click();
    const presetDownload = await presetDownloadReady, presetChunks = [];
    for await (const chunk of await presetDownload.createReadStream()) presetChunks.push(chunk);
    const livePreset = JSON.parse(Buffer.concat(presetChunks).toString('utf8'));
    assert.equal(livePreset.fm[0].algorithm,7);
    assert.equal(livePreset.lfo.frequency,3);
    assert(Math.abs(livePreset.adpcm.sampleRate - 16000) < 1);
    assert.equal(livePreset.adpcm.repeat,false);
    check('raw FM/LFO writes and ADPCM performance tuning are captured in saved settings');
    await page.locator('#tab-ssg').click();
    await page.locator('#channelTabs [data-channel="0"]').click();
    await page.waitForFunction(() => document.querySelector('[data-control="ssg.volume"] .param-value').textContent === '7');
    await page.locator('[data-control="ssg.volume"] .param-value').scrollIntoViewIfNeeded();
    const ssgLevelBox = await page.locator('[data-control="ssg.volume"] .param-value').boundingBox();
    await page.mouse.move(ssgLevelBox.x + ssgLevelBox.width / 2,ssgLevelBox.y + ssgLevelBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(ssgLevelBox.x + ssgLevelBox.width / 2 + 4 * 160 / 15,ssgLevelBox.y + ssgLevelBox.height / 2);
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('[data-control="ssg.volume"] .param-value').textContent === '11');
    await page.locator('#tab-rhythm').click();
    await page.locator('#channelTabs [data-channel="0"]').click();
    await page.waitForFunction(() => document.querySelector('[data-control="rhythm.volume"] .param-value').textContent === '7');
    await page.locator('[data-control="rhythm.volume"] .param-value').scrollIntoViewIfNeeded();
    const rhythmLevelBox = await page.locator('[data-control="rhythm.volume"] .param-value').boundingBox();
    await page.mouse.move(rhythmLevelBox.x + rhythmLevelBox.width / 2,rhythmLevelBox.y + rhythmLevelBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(rhythmLevelBox.x + rhythmLevelBox.width / 2 + 17 * 160 / 31,rhythmLevelBox.y + rhythmLevelBox.height / 2);
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('[data-control="rhythm.volume"] .param-value').textContent === '24');
    await page.locator('#tab-adpcm').click();
    await page.waitForFunction(() => document.querySelector('[data-control="adpcm.volume"] .param-value').textContent === '90');
    await page.locator('[data-control="adpcm.volume"] .param-value').scrollIntoViewIfNeeded();
    const levelBox = await page.locator('[data-control="adpcm.volume"] .param-value').boundingBox();
    await page.mouse.move(levelBox.x + levelBox.width / 2,levelBox.y + levelBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(levelBox.x + levelBox.width / 2 + 64,levelBox.y + levelBox.height / 2);
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('[data-control="adpcm.volume"] .param-value').textContent === '192');
    await page.locator('#synthCodeStopButton').click();
    await page.waitForFunction(() => /Stopped|Idle/.test(document.querySelector('#synthCodeState').textContent));
    await quiet();
    await page.locator('#synthInputKeyboardTab').click();
    check('Live SSG/Rhythm/ADPCM editing can return to saved values while Code runs');

    await page.locator('#tab-fm').click();
    await page.locator('#fmPreset').selectOption('sine');
    await page.locator('#channelTabs [data-channel="0"]').click();
    await page.keyboard.down('a');
    await audible();
    await page.locator('#tab-mixer').click();
    await page.keyboard.up('a');
    await page.locator('[data-mixer-section="fm"][data-mixer-channel="0"]').click();
    await page.locator('#tab-fm').click();
    await page.keyboard.down('a');
    await quiet();
    await page.keyboard.up('a');
    await page.locator('#tab-mixer').click();
    await page.locator('[data-mixer-section="fm"][data-mixer-channel="0"]').click();
    await page.locator('#tab-fm').click();
    await page.keyboard.down('a');
    await audible();
    await page.keyboard.up('a');
    await page.locator('#stopAudio').click();
    check('Mixer mute gates current/future notes and restores latest level');

    await page.locator('#channelTabs [data-channel="1"]').click();
    const channelTwo = await page.locator('[data-control="fm.algorithm"] .param-value').textContent();
    await page.locator('#channelTabs [data-channel="auto"]').click();
    await page.locator('#channelTabs [data-channel="1"]').click();
    assert.equal(await page.locator('[data-control="fm.algorithm"] .param-value').textContent(),channelTwo);
    check('choosing Auto preserves separate channel sounds');

    await page.locator('#channelTabs [data-channel="0"]').click();
    await page.locator('#fmPreset').selectOption('sine');
    await page.keyboard.down('a');
    await audible();
    for (const gate of await page.locator('[data-operator-gate]').all()) await gate.click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-operator-gate]')].every(button => button.getAttribute('aria-pressed') === 'false'));
    await quiet();
    await page.keyboard.up('a');
    await page.locator('#fmPreset').selectOption('sine');
    await page.locator('#channel3Controls summary').first().click();
    await page.locator('#channel3Mode').selectOption('special');
    await page.waitForFunction(() => document.querySelector('#channelTabs [data-channel="2"]').getAttribute('aria-selected') === 'true');
    assert(await page.locator('#channelTabs [data-channel="auto"]').isDisabled());
    await page.keyboard.down('a');
    await audible();
    await page.keyboard.up('a');
    await quiet();
    await page.locator('#channel3Mode').selectOption('csm');
    await page.keyboard.down('a');
    await audible();
    await page.keyboard.up('a');
    await page.locator('#stopAudio').click();
    await quiet();
    await page.locator('#channel3Mode').selectOption('normal');
    await page.waitForFunction(() => !document.querySelector('#channelTabs [data-channel="auto"]').disabled);
    check('operator Gates, special CH3 and Timer A CSM work through the UI');

    const reference = await makeReferenceFiles();
    await page.locator('#synthInputCodeTab').click();
    const memoryCode = 'const opna = await useSoundChip("ym2608");\nawait opna.adpcm.loadMemory(new Uint8Array(' + JSON.stringify([...reference.sample]) + '), 512);\nopna.adpcm.setSample({start:512,end:576});\nopna.adpcm.setPlaybackRate(12000);\nconsole.log("memory-ready");\nliveLoop("keep",async()=>{await beat(1);});\n';
    await page.locator('#synthCodeEditor').fill(memoryCode);
    await page.locator('#synthCodeRunButton').click();
    await page.waitForFunction(() => document.querySelector('#synthCodeLog').textContent.includes('memory-ready'));
    await page.locator('#synthMenu summary').first().click();
    const memoryDownloadReady = page.waitForEvent('download');
    await page.locator('#exportSoundButton').click();
    const memoryDownload = await memoryDownloadReady, memoryChunks = [];
    for await (const chunk of await memoryDownload.createReadStream()) memoryChunks.push(chunk);
    const memoryPreset = JSON.parse(Buffer.concat(memoryChunks).toString('utf8'));
    assert.equal(memoryPreset.adpcm.start,512);
    assert.equal(memoryPreset.adpcm.end,576);
    assert(Math.abs(memoryPreset.adpcm.sampleRate-12000)<1);
    assert.deepEqual(Buffer.from(memoryPreset.adpcm.data,'base64').subarray(512-memoryPreset.adpcm.address,576-memoryPreset.adpcm.address),reference.sample);
    await page.locator('#synthCodeStopButton').click();
    await page.locator('#synthInputKeyboardTab').click();
    check('Code-loaded ADPCM memory and selected address range export through the UI');

    await page.locator('#synthInputCodeTab').click();
    await page.locator('#synthCodeEditor').fill('const opna = await useSoundChip("ym2608");\nawait opna.noteOn(CH1,"A3");\nliveLoop("hold",async()=>{await beat(1);});\n');
    await page.locator('#synthCodeRunButton').click();
    await page.waitForFunction(() => /Playing|Running/.test(document.querySelector('#synthCodeState').textContent));
    const instrumentBeforeImport = await page.locator('#instrumentName').inputValue();
    await page.locator('#songFileInput').setInputFiles(reference.files);
    await page.waitForFunction(() => document.querySelector('#songSelect').options.length === 4 && !document.querySelector('#songPlay').disabled);
    assert.equal(await page.locator('#instrumentName').inputValue(),instrumentBeforeImport);
    assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);
    assert.equal(await page.locator('#synthInputCodeTab').getAttribute('aria-selected'),'true');
    await page.locator('#synthMenu summary').first().click();
    const libraryDownloadReady = page.waitForEvent('download');
    await page.locator('#opnaProjectExportButton').click();
    const {loadPlaygroundCassette} = await import(pathToFileURL(path.resolve(__dirname,'../docs/playground/playground_cassette.js')).href);
    const library = await loadPlaygroundCassette(new Uint8Array(await downloadBytes(await libraryDownloadReady)));
    assert.deepEqual(Buffer.from(library.files.get('vgm/OPNA reference.vgm')),reference.files[0].buffer);
    const importedSounds = [...library.files].filter(([filename]) => filename.startsWith('presets/OPNA reference/') && filename.endsWith('.opna.json'))
      .map(([filename,data]) => ({path:'/'+filename,preset:JSON.parse(Buffer.from(data).toString('utf8'))}));
    const importedBySection = new Map(importedSounds.map(value => [value.preset.importedVoice.section,value]));
    assert.deepEqual([...importedBySection.keys()].sort(),['adpcm','fm','rhythm','ssg']);
    assert(importedSounds.every(value => value.preset.vgmSource.file === '/vgm/OPNA reference.vgm'));
    assert.equal(await page.locator('#opnaImportDetails').getAttribute('open'),null);
    for (const kind of ['ssg','fm']) {
      const imported = importedBySection.get(kind);
      await page.locator('#opnaPresetSelect').selectOption(imported.path);
      await page.waitForFunction(kind => document.querySelector('#tab-'+kind).getAttribute('aria-selected') === 'true',kind);
      assert.equal(await page.locator('#channelTabs [data-channel="auto"]').getAttribute('aria-selected'),'true');
      assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);
      assert.equal(await page.locator('#synthInputCodeTab').getAttribute('aria-selected'),'true');
    }
    await page.locator('#synthMenu summary').first().click();
    const importedPresetDownloadReady = page.waitForEvent('download');
    await page.locator('#exportSoundButton').click();
    const appliedImported = JSON.parse((await downloadBytes(await importedPresetDownloadReady)).toString('utf8'));
    assert.deepEqual(appliedImported.ssg,importedBySection.get('ssg').preset.ssg);
    assert(appliedImported.fm.every(voice => JSON.stringify(voice) === JSON.stringify(importedBySection.get('fm').preset.fm[0])));
    await page.locator('#synthCodeStopButton').click();
    await quiet();
    await page.locator('#synthInputKeyboardTab').click();
    await page.waitForFunction(() => document.querySelector('#synthInputKeyboardTab').getAttribute('aria-selected') === 'true');
    for (const kind of ['fm','ssg','adpcm','rhythm']) {
      const imported = importedBySection.get(kind);
      await page.locator('#opnaPresetSelect').selectOption(imported.path);
      await page.waitForFunction(({kind,name}) => document.querySelector('#tab-'+kind).getAttribute('aria-selected') === 'true' &&
        document.querySelector('#instrumentName').value === name && document.querySelector('#opnaFilesPanel').getAttribute('aria-busy') === 'false',
      {kind,name:imported.preset.name});
      assert.equal(await page.locator('#synthInputKeyboardTab').getAttribute('aria-selected'),'true');
      if (kind === 'ssg') await page.waitForTimeout(600);
      await page.keyboard.down('a');
      await audible();
      await page.keyboard.up('a');
      await quiet();
      if (kind === 'ssg') {
        await page.waitForTimeout(600);
        await page.keyboard.down('a');
        await audible();
        await page.keyboard.up('a');
        await quiet();
      }
    }
    await page.screenshot({path:path.join(config.screenshots,name + '-imported-presets.png'),fullPage:true});
    await page.locator('#opnaFilesTree button[data-file-path="/index.js"]').click();
    check('VGM imports archive all four sound sections in presets, preserving Code and supporting normal picker audition');
    await page.locator('#songSelect').selectOption('/vgm/OPNA reference.vgm');
    await page.locator('#tab-fm').click();
    await page.locator('#channelTabs [data-channel="0"]').click();
    await page.locator('#songPlay').click();
    await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.playback === 'playing');
    await audible();
    await page.waitForFunction(() => document.querySelector('#songView').value === 'song');
    await page.locator('[data-control="fm.feedback"] .param-button').last().click();
    await page.keyboard.down('a');
    await audible();
    assert.equal(await page.locator('#referenceSong').getAttribute('data-playback'),'playing');
    await page.keyboard.up('a');
    const unsupported = Buffer.from(reference.files[0].buffer);
    unsupported.writeUInt32LE(7670454,0x2c);
    await page.locator('#songFileInput').setInputFiles({name:'Unsupported.vgm',mimeType:'application/octet-stream',buffer:unsupported});
    await page.waitForFunction(() => document.querySelector('#audioStatus').textContent.includes('Unsupported chip: YM2612'));
    assert.equal(await page.locator('#songSelect').inputValue(),'/vgm/OPNA reference.vgm');
    assert.equal(await page.locator('#referenceSong').getAttribute('data-playback'),'playing');
    await page.locator('#songPause').click();
    await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.manualReady === 'true' && document.querySelector('#referenceSong').dataset.playback === 'paused');
    const pausedTime = await page.locator('#songTime').textContent();
    await quiet();
    await page.keyboard.down('a');
    await audible();
    await page.keyboard.up('a');
    await quiet();
    assert.equal(await page.locator('#songTime').textContent(),pausedTime);
    for (const gate of await page.locator('[data-operator-gate]').all()) if (await gate.getAttribute('aria-pressed') === 'true') await gate.click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-operator-gate]')].every(button => button.getAttribute('aria-pressed') === 'false'));
    await page.keyboard.down('a');
    await quiet();
    await page.keyboard.up('a');
    for (const gate of await page.locator('[data-operator-gate]').all()) await gate.click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-operator-gate]')].every(button => button.getAttribute('aria-pressed') === 'true'));
    await page.locator('#liveUpdate').uncheck();
    const feedbackBefore = Number(await page.locator('[data-control="fm.feedback"] .param-value').textContent());
    await page.locator('[data-control="fm.feedback"] .param-button').last().click();
    await page.waitForFunction(value => Number(document.querySelector('[data-control="fm.feedback"] .param-value').textContent) === Math.min(7,value+1),feedbackBefore);
    await page.waitForTimeout(180);
    assert.equal(Number(await page.locator('[data-control="fm.feedback"] .param-value').textContent()),Math.min(7,feedbackBefore+1));
    await page.locator('#liveUpdate').check();
    await page.locator('#tab-ssg').click();
    await page.locator('#channelTabs [data-channel="0"]').click();
    for (let trial=0;trial<2;trial++) {
      await page.keyboard.down('a');
      await audible();
      await page.keyboard.up('a');
      await quiet();
    }
    await page.locator('#tab-adpcm').click();
    await page.waitForFunction(() => document.querySelector('#sampleInfo').textContent.startsWith('128 decoded frames'));
    await page.keyboard.down('a');
    await audible();
    await page.keyboard.up('a');
    await quiet();
    const expectedReferenceRate = Math.round(Math.round(22050 * 144 * 65536 / 8000000) * 8000000 / (144 * 65536));
    await page.waitForFunction(value => Number(document.querySelector('[data-control="adpcm.sampleRate"] .param-value').textContent) === value,expectedReferenceRate);
    const referenceRateBefore = Number(await page.locator('[data-control="adpcm.sampleRate"] .param-value').textContent());
    await page.locator('[data-control="adpcm.sampleRate"] .param-button').last().click();
    await page.waitForFunction(value => Number(document.querySelector('[data-control="adpcm.sampleRate"] .param-value').textContent) === value,referenceRateBefore+1);
    await page.locator('[data-control="adpcm.rootNote"] .param-button').last().click();
    await page.waitForFunction(() => document.querySelector('#songReferenceKey').value === '61');
    await page.keyboard.down('a');
    await audible();
    await page.keyboard.up('a');
    await quiet();
    await page.waitForFunction(value => Number(document.querySelector('[data-control="adpcm.sampleRate"] .param-value').textContent) === value,referenceRateBefore+1);
    await page.screenshot({path:path.join(config.screenshots,name + '-reference-paused.png'),fullPage:true});
    await page.locator('#songCapture').click();
    await page.waitForFunction(() => document.querySelector('#songView').value === 'synth');
    assert.equal(await page.locator('#referenceSong').getAttribute('data-playback'),'paused');
    assert.equal(await page.locator('#songPlay').textContent(),'Resume');
    await page.keyboard.down('a');
    await audible();
    await page.keyboard.up('a');
    await quiet();
    check('VGM Files, Live controls, paused FM/SSG/ADPCM audition and Capture preserve song position');

    await page.locator('#songPlay').click();
    await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.playback === 'playing');
    await page.locator('#songSeek').evaluate(node => {node.value='8';node.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.playback === 'playing' && document.querySelector('#songTime').textContent.startsWith('0:08'));
    await page.locator('#songSeek').focus();
    await page.waitForFunction(() => Number(document.querySelector('#songSeek').value) > 8.2);
    await page.locator('#tab-mixer').click();
    for (const kind of ['fm','ssg','rhythm','adpcm']) {
      for (const button of await page.locator('[data-mixer-section="'+kind+'"]').all()) if (await button.getAttribute('aria-pressed') === 'true') await button.click();
    }
    await quiet();
    await page.locator('[data-mixer-section="fm"][data-mixer-channel="0"]').click();
    await audible();
    await page.locator('#songStop').click();
    await quiet();
    for (const kind of ['fm','ssg','rhythm','adpcm']) {
      for (const button of await page.locator('[data-mixer-section="'+kind+'"]').all()) if (await button.getAttribute('aria-pressed') === 'false') await button.click();
    }
    check('reference Seek, focused progress and channel Mixer operate on the song output');

    for (const extension of ['vgz','s98']) {
      await page.locator('#songSelect').selectOption('/vgm/OPNA reference.'+extension);
      await page.waitForFunction(() => !document.querySelector('#songPlay').disabled);
      await page.locator('#songPlay').click();
      await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.playback === 'playing');
      await audible();
      await page.locator('#songStop').click();
      await quiet();
    }
    check('VGZ and S98 reference files play using the shared OPNA core');

    await page.locator('#tab-fm').click();
    await page.locator('#channelTabs [data-channel="5"]').click();
    await page.locator('#songFileInput').setInputFiles(reference.opnFiles);
    await page.waitForFunction(() => document.querySelector('#songSelect').options.length === 7 && !document.querySelector('#songPlay').disabled);
    await page.locator('#songSelect').selectOption('/vgm/OPN reference.vgm');
    await page.waitForFunction(() => !document.querySelector('#songCompatibility').hidden);
    assert.equal(await page.locator('#referenceSong').getAttribute('data-source-chip'),'ym2203');
    assert.equal(await page.locator('#ym2203Mode').isChecked(),true);
    assert.match(await page.locator('#mixerEffective').textContent(),/SSG ×0.75/);
    assert.match(await page.locator('#songCompatibility').getAttribute('title'),/4 MHz → YM2608 8 MHz/);
    await page.locator('#songPlay').click();
    await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.playback === 'playing' && document.querySelector('#songView').value === 'song');
    assert.equal(await page.locator('#channelTabs [data-channel]').count(),4);
    assert.equal(await page.locator('#channelTabs [data-channel="0"]').getAttribute('aria-selected'),'true');
    await audible();
    await page.locator('#songPause').click();
    await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.manualReady === 'true');
    await quiet();
    await page.keyboard.down('a');
    await audible();
    await page.keyboard.up('a');
    await quiet();
    await page.locator('#tab-ssg').click();
    await page.locator('#channelTabs [data-channel="0"]').click();
    await page.keyboard.down('a');
    await audible();
    await page.keyboard.up('a');
    await quiet();
    await page.locator('#tab-fm').click();
    await page.locator('#songSeek').evaluate(node => {node.value='8';node.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.manualReady === 'true' && document.querySelector('#songTime').textContent.startsWith('0:08'));
    await page.keyboard.down('a');
    await audible();
    await page.keyboard.up('a');
    await quiet();
    await page.screenshot({path:path.join(config.screenshots,name + '-ym2203-paused.png'),fullPage:true});
    await page.locator('#songCapture').click();
    await page.waitForFunction(() => document.querySelector('#songView').value === 'synth');
    assert.equal(await page.locator('#referenceSong').getAttribute('data-playback'),'paused');
    assert.equal(await page.locator('#channelTabs [data-channel]').count(),7);
    await page.locator('#songPlay').click();
    await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.playback === 'playing');
    await audible();
    await page.locator('#songStop').click();
    await quiet();
    if (await page.locator('#opnaFilesPanel').isHidden()) await page.locator('#opnaFilesToggle').click();
    await page.locator('#opnaFilesTree button[data-file-path="/vgm/OPN reference.vgm"]').click();
    await page.locator('#synthMenu summary').first().click();
    const sourceDownloadReady = page.waitForEvent('download');
    await page.locator('#opnaFileExportButton').click();
    const sourceDownload = await sourceDownloadReady, sourceChunks = [];
    for await (const chunk of await sourceDownload.createReadStream()) sourceChunks.push(chunk);
    assert.deepEqual(Buffer.concat(sourceChunks),reference.opnFiles[0].buffer);
    check('YM2203 compatibility keeps source bytes and supports Live, paused FM/SSG, Seek and Capture');
    for (const extension of ['vgz','s98']) {
      await page.locator('#songSelect').selectOption('/vgm/OPN reference.'+extension);
      await page.waitForFunction(() => !document.querySelector('#songPlay').disabled);
      await page.locator('#songPlay').click();
      await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.playback === 'playing');
      assert.equal(await page.locator('#referenceSong').getAttribute('data-source-chip'),'ym2203');
      await audible();
      await page.locator('#songStop').click();
      await quiet();
    }
    assert.deepEqual(ym2203Assets,[]);
    if (config.song) {
      const filename = path.basename(config.song), buffer = await fs.readFile(config.song);
      await page.locator('#songFileInput').setInputFiles({name:filename,mimeType:'application/octet-stream',buffer});
      await page.waitForFunction(filename => document.querySelector('#songSelect').value === '/vgm/'+filename &&
        document.querySelector('#referenceSong').dataset.sourceChip === 'ym2203' && !document.querySelector('#songPlay').disabled,filename);
      assert.equal(await page.locator('#ym2203Mode').isChecked(),true);
      assert.match(await page.locator('#mixerEffective').textContent(),/SSG ×1.201172/);
      await page.locator('#songPlay').click();
      await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.playback === 'playing');
      await audible();
      await page.locator('#songPause').click();
      await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.manualReady === 'true');
      await quiet();
      await page.locator('#songSeek').evaluate(node => {node.value='8';node.dispatchEvent(new Event('change',{bubbles:true}));});
      await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.manualReady === 'true' && document.querySelector('#songTime').textContent.startsWith('0:08'));
      await page.locator('#songPlay').click();
      await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.playback === 'playing');
      await audible();
      await page.screenshot({path:path.join(config.screenshots,name + '-real-ym2203.png'),fullPage:true});
      await page.locator('#songStop').click();
      await quiet();
      check('local YM2203 song imports and renders through Play, Pause, Seek and Resume');
    }
    if (await page.locator('#opnaFilesPanel').isHidden()) await page.locator('#opnaFilesToggle').click();
    await page.locator('#opnaFilesTree button[data-file-path="/vgm/OPN reference.s98"]').click();
    await page.waitForFunction(() => document.querySelector('#songSelect').value === '/vgm/OPN reference.s98');
    assert.equal(await page.locator('#ym2203Mode').isChecked(),true);
    await page.locator('#opnaFileDeleteButton').click();
    await page.locator('#opnaFileNameConfirm').click();
    await page.waitForFunction(() => document.querySelector('#songSelect').value === '' && !document.querySelector('#ym2203Mode').checked);
    assert.match(await page.locator('#mixerEffective').textContent(),/FM ×1 · SSG ×1/);
    check('removing the selected reference file clears its automatic mixer profile');
    await page.locator('#songSelect').selectOption('/vgm/OPNA reference.vgm');
    await page.waitForFunction(() => !document.querySelector('#songPlay').disabled && document.querySelector('#songCompatibility').hidden);
    assert.equal(await page.locator('#ym2203Mode').isChecked(),false);
    check('YM2203 VGZ and S98 use only the OPNA core and native OPNA playback remains selectable');

    await page.locator('#songPlay').click();
    await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.playback === 'playing');
    await page.locator('#synthInputCodeTab').click();
    await page.locator('#synthCodeRunButton').click();
    await page.waitForFunction(() => /Playing|Running/.test(document.querySelector('#synthCodeState').textContent));
    await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.playback === 'stopped');
    await page.locator('#songPlay').click();
    await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.playback === 'playing');
    await page.waitForFunction(() => /Stopped|Idle/.test(document.querySelector('#synthCodeState').textContent));
    await page.locator('#songStop').click();
    await page.locator('#tab-fm').click();
    check('Code and reference-song transports hand off without closing audio');

    await page.locator('#synthInputKeyboardTab').click();
    await page.locator('#songFileInput').setInputFiles(reference.endingFile);
    await page.waitForFunction(() => document.querySelector('#songSelect').value === '/vgm/Ended reference.vgm' && !document.querySelector('#songPlay').disabled);
    await page.locator('#tab-ssg').click();
    await page.locator('#songView').selectOption('song');
    await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.manualReady === 'true');
    await page.locator('[data-control="ssg.volume"] .param-button').last().click();
    await page.locator('#tab-rhythm').click();
    await page.locator('[data-control="rhythm.volume"] .param-button').last().click();
    assert.equal(await page.locator('#referenceSong').getAttribute('data-playback'),'paused');
    await page.locator('#songStop').click();
    await page.locator('#tab-fm').click();
    await page.locator('#channelTabs [data-channel="0"]').click();
    await page.locator('#songPlay').click();
    await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.playback === 'ended');
    await quiet();
    const endTime = await page.locator('#songTime').textContent();
    const endedFeedback = Number(await page.locator('[data-control="fm.feedback"] .param-value').textContent());
    await page.locator('[data-control="fm.feedback"] .param-button').last().click();
    await page.waitForFunction(value => document.querySelector('#referenceSong').dataset.manualReady === 'true' &&
      Number(document.querySelector('[data-control="fm.feedback"] .param-value').textContent) === Math.min(7,value+1),endedFeedback);
    assert.equal(await page.locator('#songTime').textContent(),endTime);
    await page.locator('#songPlay').click();
    await page.waitForFunction(() => document.querySelector('#referenceSong').dataset.playback === 'ended');
    await quiet();
    await page.keyboard.down('a');
    await audible();
    assert.equal(await page.locator('#referenceSong').getAttribute('data-playback'),'paused');
    await page.keyboard.up('a');
    await quiet();
    await page.locator('[data-operator-gate="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-operator-gate="1"]').getAttribute('aria-pressed') === 'false');
    assert.equal(await page.locator('#songTime').textContent(),endTime);
    await page.locator('#songStop').click();
    check('stopped song view and naturally ended channels remain editable, with the first audition key preserved');

    await page.locator('#masterVolume').evaluate(node => {node.value = '3.8'; node.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#monitorVolumeValue').textContent(),'380%');
    assert.equal(await page.locator('#monitorVolume').getAttribute('data-boosted'),'true');
    await page.locator('#synthInputCodeTab').click();
    await page.locator('#synthCodeExpandButton').click();
    assert.equal(await page.locator('#synthExpandedCodeSlot #synthInputSection').count(),1);
    assert((await page.locator('#synthCodeEditor').boundingBox()).height > 200);
    await page.locator('#synthCodeExpandButton').click();
    check('380 percent Master and expanded Code match existing Synth conventions');

    await page.locator('#synthInputKeyboardTab').click();
    await page.screenshot({path:path.join(config.screenshots,name + '-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(100);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 2,'Mobile page overflow ' + overflow);
    await page.screenshot({path:path.join(config.screenshots,name + '-mobile.png'),fullPage:true});
    check('desktop and mobile layout');
    assert.deepEqual(errors,[]);
    assert.deepEqual(failures,[]);
    return {engine:name,passed:true,physicalOutputMuted:true,checks,pcm:{fm,ssg,rhythm,adpcm},errors};
  } catch (error) {
    if (page) await page.screenshot({path:path.join(config.screenshots,name + '-failure.png'),fullPage:true}).catch(() => {});
    return {engine:name,passed:false,stage,checks,error:error.stack,errors,failures,
      status:page ? await page.locator('#audioStatus').textContent().catch(() => null) : null,
      codeError:page ? await page.locator('#synthCodeError').textContent().catch(() => null) : null};
  } finally { await browser.close(); }
}
(async () => {
  await fs.mkdir(config.screenshots,{recursive:true});
  await fs.mkdir(path.dirname(config.out),{recursive:true});
  server = http.createServer(async (request,response) => {
    try {
      const url = new URL(request.url,'http://localhost'), target = path.resolve(config.root,'.' + decodeURIComponent(url.pathname));
      assert(target.startsWith(config.root + path.sep) || target === config.root);
      const filename = (await fs.stat(target)).isDirectory() ? path.join(target,'index.html') : target;
      response.writeHead(200,{'Content-Type':mime[path.extname(filename)] ?? 'application/octet-stream','Cache-Control':'no-store'});
      response.end(await fs.readFile(filename));
    } catch {
      missing.push(request.url);
      response.writeHead(404);
      response.end('Missing');
    }
  });
  await new Promise((resolve,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',resolve);});
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const name of config.engines.split(',')) results.push(await checkEngine(name,origin));
    const report = {passed:results.every(value => value.passed),root:config.root,entry:config.entry,results,missing};
    await fs.writeFile(config.out,JSON.stringify(report,null,2) + '\n');
    console.log(JSON.stringify(report,null,2));
    if (!report.passed) process.exitCode = 1;
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(async error => {
  console.error(error);
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  process.exitCode = 1;
});

