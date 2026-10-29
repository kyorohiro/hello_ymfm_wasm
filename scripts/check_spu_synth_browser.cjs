// Standalone SPU Synth: real public UI and AudioWorklet PCM in Chromium/WebKit.
// Every connection to the physical destination is intercepted and muted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {chromium, webkit} = require('playwright');
const {PROCESSOR_NAMES, processorSource, analyzePilotPcm, analyzeClockRows} = require('./audio_clock_audit.cjs');

const config = {root:path.resolve(__dirname, '../docs'), entry:'/synth-spu/index.html', out:null, screenshots:null, engines:[]};
const usage = 'Usage: node scripts/check_spu_synth_browser.cjs [--chromium-only | --webkit-only] [--root DIR] [--entry /synth-spu/index.html] [--out REPORT.json] [--screenshots DIR]';
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--help') {console.log(usage); process.exit(0);}
  if (['--chromium-only', '--webkit-only'].includes(arg)) {config.engines.push(arg.slice(2, -5)); continue;}
  const match = arg.match(/^--(root|entry|out|screenshots)(?:=(.*))?$/); assert(match, usage);
  const value = match[2] ?? process.argv[++i]; assert(value && !value.startsWith('--'), usage);
  config[match[1]] = match[1] === 'entry' ? value : path.resolve(value);
}
assert(config.engines.length <= 1, usage);
if (!config.engines.length) config.engines = ['chromium', 'webkit'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const served = new Map();
const panel = '#spuVoicePanel';
const control = name => `${panel} [data-chip-control="ps1-${name}"]`;
const action = name => `${panel} [data-chip-action="ps1-${name}"]`;

function instrumentation() {
  const audit = window.__spuSynthAudit = {contexts:[], worklets:[], sinks:new Map(), processorErrors:[], commands:[], states:[], captures:[], replies:new Set(), analysers:[], analyserReads:[], analyserEdges:[]};
  const Context = window.AudioContext, Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect, post = MessagePort.prototype.postMessage;
  const createAnalyser = BaseAudioContext.prototype.createAnalyser;
  BaseAudioContext.prototype.createAnalyser = function(...args) {const node = createAnalyser.apply(this, args); audit.analysers.push(node); return node;};
  for (const method of ['getFloatTimeDomainData', 'getByteTimeDomainData', 'getFloatFrequencyData', 'getByteFrequencyData']) {
    const original = AnalyserNode.prototype[method];
    AnalyserNode.prototype[method] = function(values, ...args) {
      const result = original.call(this, values, ...args), frequency = method.includes('Frequency');
      let peak = frequency ? -Infinity : 0, peakBin = 0, energy = 0, finite = 0;
      for (let index = 0; index < values.length; index++) {
        const value = values[index];
        if (Number.isFinite(value)) finite++;
        if (frequency) {if (value > peak) {peak = value; peakBin = index;}}
        else {const sample = method.startsWith('getByte') ? (value - 128) / 128 : value; peak = Math.max(peak, Math.abs(sample)); energy += sample * sample;}
      }
      audit.analyserReads.push({method, analyser:audit.analysers.indexOf(this), at:performance.now(), time:this.context.currentTime, values:values.length, finite, peak, rms:frequency ? null : Math.sqrt(energy / values.length), peakBin:frequency ? peakBin : null, peakHz:frequency ? peakBin * this.context.sampleRate / this.fftSize : null, binHz:frequency ? this.context.sampleRate / this.fftSize : null});
      return result;
    };
  }
  const labels = new WeakMap(); let sequence = 0; audit.connect = connect;
  window.AudioContext = class extends Context {constructor(...args) {super(...args); audit.contexts.push(this);}};
  if (window.webkitAudioContext === Context) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, ...args) {
      super(context, name, ...args); audit.worklets.push(name); const label = {name, port:++sequence}; labels.set(this.port, label);
      this.addEventListener('processorerror', () => audit.processorErrors.push(name));
      this.port.addEventListener('message', ({data}) => {
        if (data?.id !== undefined) {
          audit.replies.add(`${label.port}:${data.id}`);
          const command = audit.commands.findLast(command => command.port === label.port && command.id === data.id);
          if (command?.method === 'instrumentNoteOn') command.allocation = structuredClone(data.value);
        }
        const state = data?.state ?? data?.value;
        if (Array.isArray(state?.channels) && state.channels.length === 24 && Array.isArray(state.samples)) audit.states.push(state);
      });
    }
  };
  MessagePort.prototype.postMessage = function(data, ...args) {
    if (data && typeof data === 'object' && typeof data.method === 'string') audit.commands.push({...labels.get(this), id:data.id, method:data.method, args:structuredClone(data.args ?? [])});
    return post.call(this, data, ...args);
  };
  AudioNode.prototype.connect = function(destination, ...args) {
    if (this instanceof AnalyserNode || destination instanceof AnalyserNode) audit.analyserEdges.push({source:this instanceof AnalyserNode ? 'analyser' : this.constructor.name, destination:destination instanceof AnalyserNode ? 'analyser' : destination.constructor.name, sourceAnalyser:audit.analysers.indexOf(this), destinationAnalyser:audit.analysers.indexOf(destination)});
    if (destination === this.context.destination) {
      let sink = audit.sinks.get(this.context);
      if (!sink) {
        const sum = this.context.createGain(), gate = this.context.createGain(); gate.gain.value = 0;
        connect.call(sum, gate); connect.call(gate, destination); sink = {sum, gate}; audit.sinks.set(this.context, sink);
      }
      connect.call(this, sink.sum, ...args); return destination;
    }
    return connect.call(this, destination, ...args);
  };
  AudioNode.prototype.disconnect = function(...args) {
    if (args[0] === this.context.destination && audit.sinks.has(this.context)) args[0] = audit.sinks.get(this.context).sum;
    return disconnect.apply(this, args);
  };
}

async function capture(page, frames = 16384) {
  return page.evaluate(async ({frames, captureName, pilotName}) => {
    const audit = window.__spuSynthAudit;
    const context = [...audit.contexts].reverse().find(value => value.state !== 'closed' && audit.sinks.has(value));
    if (!context) throw Error('No live SPU Synth output graph');
    const sink = audit.sinks.get(context);
    if (!sink.capture) {
      await context.audioWorklet.addModule('/__spu_synth_capture.js');
      const node = new AudioWorkletNode(context, captureName, {numberOfInputs:2, numberOfOutputs:1, outputChannelCount:[2], processorOptions:{pilotInput:1}});
      const pilot = new AudioWorkletNode(context, pilotName, {numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[1]});
      audit.connect.call(pilot, node, 0, 1); audit.connect.call(sink.sum, node); audit.connect.call(node, sink.gate);
      sink.capture = node; sink.pilot = pilot; sink.sequence = 0;
      node.port.onmessage = ({data}) => {if (sink.pending?.id === data.id) {const pending = sink.pending; sink.pending = null; clearTimeout(pending.timer); pending.resolve(data);}};
    }
    const data = await new Promise((resolve, reject) => {
      if (sink.pending) throw Error('Concurrent SPU Synth capture'); const id = ++sink.sequence;
      const timer = setTimeout(() => {sink.pending = null; reject(Error('SPU Synth PCM capture timed out'));}, 10000);
      sink.pending = {id, resolve, timer}; sink.capture.port.postMessage({id, frames});
    });
    const pilot = window.__spuSynthClock.pilot(data.pilot, {expectedFrames:frames, pilotInputFrames:data.pilotInputFrames});
    const clock = window.__spuSynthClock.clock(data.rows);
    audit.captures.push({id:data.id, frames:data.left.length, pilot, clock});
    const channels = [data.left, data.right].map(values => {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      let peak = 0, energy = 0, nonFinite = 0, nonZero = 0; const crossings = [];
      for (let i = 0; i < values.length; i++) {
        const value = values[i]; peak = Math.max(peak, Math.abs(value)); energy += (value - mean) ** 2;
        if (!Number.isFinite(value)) nonFinite++; if (value !== 0) nonZero++;
        if (i && values[i - 1] < mean && value >= mean) crossings.push(i - 1 + (mean - values[i - 1]) / (value - values[i - 1]));
      }
      let fingerprint=2166136261;
      for(const byte of new Uint8Array(values.buffer,values.byteOffset,values.byteLength))fingerprint=Math.imul(fingerprint^byte,16777619)>>>0;
      return {pcmFingerprint:fingerprint, peak, rms:Math.sqrt(energy / values.length), nonFinite, nonZero, hz:crossings.length > 2 ? (crossings.length - 1) * context.sampleRate / (crossings.at(-1) - crossings[0]) : 0};
    });
    if (sink.gate.gain.value !== 0) throw Error('Physical SPU Synth output must remain muted');
    return {frames:data.left.length, sampleRate:context.sampleRate, channels, pilot, clock, frameGaps:data.frameGaps, physicalOutputMuted:true};
  }, {frames, captureName:PROCESSOR_NAMES.capture, pilotName:PROCESSOR_NAMES.pilot});
}

function assertPcm(pcm, label) {
  assert.equal(pcm.pilot.continuous, true, `${label}: independent PCM pilot ${JSON.stringify(pcm.pilot)}`);
  assert.equal(pcm.clock.measurementValid, true, `${label}: complete callback sequence`);
  assert.equal(pcm.clock.frames, pcm.frames, `${label}: complete captured frames`);
  assert.equal(pcm.clock.gapCount, pcm.frameGaps, `${label}: every clock anomaly retained`);
  assert(pcm.channels.every(channel => channel.nonFinite === 0), `${label}: finite PCM`);
}
async function audible(page, label, hz) {
  let pcm;
  for (let i = 0; i < 6; i++) {
    pcm = await capture(page); assertPcm(pcm, label);
    if (pcm.channels.every(channel => channel.rms > .0001 && channel.peak < 1 && (hz === undefined || Math.abs(channel.hz - hz) < Math.max(3, hz * .015)))) return pcm;
  }
  throw Error(`${label}: expected audible, unclipped${hz === undefined ? '' : ` ${hz} Hz`} PCM ${JSON.stringify(pcm)}`);
}
async function silent(page, label) {
  let pcm;
  for (let i = 0; i < 10; i++) {
    pcm = await capture(page, 4096); assertPcm(pcm, label);
    if (pcm.channels.every(channel => channel.nonZero === 0)) return pcm;
  }
  throw Error(`${label}: expected exact zero PCM ${JSON.stringify(pcm)}`);
}
async function field(page, name, value) {
  await editorTab(page, name.startsWith('reverb-') ? 'fx' : name.startsWith('wave-') ? 'pcm' : 'adsr');
  await page.locator(control(name)).evaluate((node, value) => {
    if (node.type === 'checkbox') node.checked = Boolean(value); else node.value = String(value);
    node.dispatchEvent(new Event('change', {bubbles:true})); node.blur();
  }, value);
  await settled(page);
}
const current = page => page.evaluate(() => __spuSynthAudit.states.at(-1));
async function settled(page) {
  // Completed user edits return their actual chip state. Wait for those
  // replies and the editor's frame; never inject an inspect request or timer.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => __spuSynthAudit.commands.every(command => command.id === undefined || __spuSynthAudit.replies.has(`${command.port}:${command.id}`)));
  return current(page);
}
async function applied(page, predicate) {
  await page.waitForFunction(predicate => {const state = __spuSynthAudit.states.at(-1); return Boolean(state && new Function('state', `return (${predicate})`)(state));}, predicate);
  return current(page);
}

function sineWav() {
  const rate = 44100, frames = 4410, bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 20000), 44 + i * 2);
  return bytes;
}

function noteFrequency(note) {
  const match = String(note).match(/^([A-G])([#b]?)(-?\d+)$/); assert(match, 'A visible keyboard note has standard pitch notation: ' + note);
  const semitone = {C:0, D:2, E:4, F:5, G:7, A:9, B:11}[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  return 440 * 2 ** (((Number(match[3]) + 1) * 12 + semitone - 69) / 12);
}
async function setSlider(page, selector, value) {
  await page.locator(selector).evaluate((node, value) => {node.value = String(value); node.dispatchEvent(new Event('input', {bubbles:true})); node.dispatchEvent(new Event('change', {bubbles:true}));}, value);
}
async function hold(page, key = 'y') {
  const button = page.locator(`#keyboardMount .key[data-key="${key}"]`); await button.scrollIntoViewIfNeeded(); const box = await button.boundingBox(); assert(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await settled(page);
}
async function release(page) {await page.mouse.move(2, 2); await page.mouse.up(); await settled(page);}
async function fastEnvelope(page) {
  for (const [name, value] of Object.entries({'attack-rate':0, 'attack-exponential':false, 'decay-rate':0, 'sustain-level':15, 'sustain-rate':0, 'sustain-decrease':false, 'sustain-exponential':false, 'release-rate':0, 'release-exponential':false})) await field(page, name, value);
}

const editorNames = ['pcm', 'adsr', 'fx', 'audio'];
async function assertEditorTab(page, name, {focused = false} = {}) {
  const snapshot = await page.evaluate(names => ({tabs:names.map(value => {
    const button = document.querySelector(`[data-spu-editor-tab="${value}"]`), content = document.getElementById(`instrumentPanel-${value}`);
    return {name:value, button:button && {role:button.getAttribute('role'), id:button.id, controls:button.getAttribute('aria-controls'), selected:button.getAttribute('aria-selected'), tabindex:button.getAttribute('tabindex'), focused:button === document.activeElement}, content:content && {role:content.getAttribute('role'), labelledby:content.getAttribute('aria-labelledby'), hidden:content.getAttribute('hidden'), visible:content.getClientRects().length > 0}};
  }), files:['instrumentName', 'loadPreset', 'savePreset', 'resetPreset'].map(id => ({id, visible:document.getElementById(id)?.getClientRects().length > 0}))}), editorNames);
  for (const value of editorNames) {
    const {button, content} = snapshot.tabs.find(tab => tab.name === value);
    assert(button && content, `Both ${value} tab and panel exist`);
    assert.equal(button.role, 'tab', 'Editor buttons expose tab semantics');
    assert.equal(button.id, `instrumentTab-${value}`);
    assert.equal(button.controls, `instrumentPanel-${value}`);
    assert.equal(button.selected, String(value === name));
    assert.equal(button.tabindex, value === name ? '0' : '-1', 'Editor tabs use roving keyboard focus');
    assert.equal(content.role, 'tabpanel');
    assert.equal(content.labelledby, `instrumentTab-${value}`);
    assert.equal(content.visible, value === name, 'Only the selected settings panel is visible');
    if (value !== name) assert.equal(content.hidden, '', 'Inactive panel is hidden from layout and accessibility navigation');
  }
  if (focused) assert.equal(snapshot.tabs.find(tab => tab.name === name).button.focused, true, 'Arrow navigation focuses the selected settings tab');
  for (const file of snapshot.files) assert.equal(file.visible, true, 'Common instrument files stay available in every settings tab: ' + file.id);
}
async function editorTab(page, name) {
  const button = page.locator(`[data-spu-editor-tab="${name}"]`);
  if (await button.getAttribute('aria-selected') !== 'true') await button.click();
  await assertEditorTab(page, name);
}
async function shape(page, name) {await editorTab(page, 'pcm'); await page.locator(action(`wave-${name}`)).click();}
async function navigateEditorTabs(page) {
  for (const name of editorNames) await editorTab(page, name);
  await page.locator('[data-spu-editor-tab="pcm"]').focus();
  const navigation = [['ArrowRight', 'adsr'], ['ArrowRight', 'fx'], ['ArrowRight', 'audio'], ['ArrowRight', 'pcm'], ['ArrowLeft', 'audio'], ['Home', 'pcm'], ['End', 'audio']];
  for (const [key, name] of navigation) {await page.keyboard.press(key); await assertEditorTab(page, name, {focused:true});}
  await editorTab(page, 'pcm');
  return navigation;
}
async function checkEditorTabsBeforeAudio(page) {
  console.log('CHECK settings tabs: default PCM / accessible navigation / audio-lazy selection');
  assert.deepEqual(await page.locator('[data-spu-editor-tab]').allTextContents(), ['PCM', 'ADSR', 'FX', 'Audio']);
  await assertEditorTab(page, 'pcm');
  const commands = await page.evaluate(() => __spuSynthAudit.commands.length);
  const navigation = await navigateEditorTabs(page);
  assert.equal(await page.evaluate(() => __spuSynthAudit.contexts.length), 0, 'Settings tab clicks and keyboard navigation never create an AudioContext');
  assert.equal(await page.evaluate(() => __spuSynthAudit.commands.length), commands, 'Settings tabs send no audio commands before Enable audio');
  return {default:'pcm', names:editorNames, navigation, audioLazy:true, commonFilesAlwaysVisible:true};
}
async function checkEditorTabsDuringSound(page, keyboardHz) {
  console.log('CHECK settings tabs: held-note ownership / instrument and audio isolation');
  await page.locator('h1').click(); await page.keyboard.down('y'); await settled(page);
  const beforePcm = await audible(page, 'Held note before settings navigation', keyboardHz), before = await current(page);
  const baseline = await page.evaluate(() => ({commands:__spuSynthAudit.commands.length, contexts:__spuSynthAudit.contexts.length}));
  const navigation = await navigateEditorTabs(page), after = await settled(page);
  const afterPcm = await audible(page, 'Held note after settings navigation', keyboardHz);
  assert.deepEqual(after.auditions, before.auditions, 'Settings navigation preserves every held note lease');
  assert.deepEqual(after.channels.map(channel => ({sample:channel.sample, pitch:channel.pitch, adsr1:channel.adsr1, adsr2:channel.adsr2, volumeLeft:channel.volumeLeft, volumeRight:channel.volumeRight})), before.channels.map(channel => ({sample:channel.sample, pitch:channel.pitch, adsr1:channel.adsr1, adsr2:channel.adsr2, volumeLeft:channel.volumeLeft, volumeRight:channel.volumeRight})), 'Settings navigation preserves PCM, pitch, ADSR and voice volume');
  assert.equal(await page.evaluate(() => __spuSynthAudit.commands.length), baseline.commands, 'Settings tab switches send no note, gate, preset or inspect command');
  assert.equal(await page.evaluate(() => __spuSynthAudit.contexts.length), baseline.contexts, 'Settings navigation does not replace or create audio contexts');
  await page.keyboard.up('y'); await silent(page, 'Held settings-navigation note released');
  return {navigation, beforePcm, afterPcm, ownershipPreserved:true, instrumentPreserved:true, extraAudioCommands:0, extraContexts:0};
}

async function monitorMode(page, mode) {
  await page.locator(`[data-spu-visual-mode="${mode}"]`).click();
  assert.equal(await page.locator(`[data-spu-visual-mode="${mode}"]`).getAttribute('aria-pressed'), 'true', 'The chosen monitor mode is announced');
  assert.equal(await page.locator('[data-spu-visual-mode][aria-pressed="true"]').count(), 1, 'Only one monitor mode is selected');
  await settled(page);
}
async function monitorReads(page, from = 0) {return page.evaluate(from => __spuSynthAudit.analyserReads.slice(from), from);}
async function waitMonitorRead(page, from, kind) {
  await page.waitForFunction(({from, kind}) => __spuSynthAudit.analyserReads.slice(from).some(value => value.method.includes(kind) && (kind === 'Frequency' ? Number.isFinite(value.peak) && value.peakHz > 0 && value.peak > (value.method.startsWith('getByte') ? 0 : -100) : value.rms > .00001)), {from, kind});
  return (await monitorReads(page, from)).filter(value => value.method.includes(kind)).at(-1);
}
async function monitorSignature(page, selector = '#outputCanvas') {
  return page.locator(selector).evaluate(canvas => {
    const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let signature = 2166136261;
    for (const value of bytes) signature = Math.imul(signature ^ value, 16777619) >>> 0;
    return {width:canvas.width, height:canvas.height, signature};
  });
}
async function checkMonitor(page, keyboardHz) {
  console.log('CHECK monitor: final output signal / passive branch / tab isolation / idle scheduling');
  assert.deepEqual(await page.locator('[data-spu-visual-mode]').allTextContents(), ['Envelope', 'Waveform', 'Spectrum']);
  await monitorMode(page, 'envelope');
  assert.equal(await page.locator('#spuMonitor [data-chip-envelope-handle]').count(), 0, 'The top monitor contains measured output, not ADSR edit handles');
  assert.equal(await page.locator('#instrumentPanel-adsr [data-chip-envelope-handle]').count(), 4, 'The editable ADSR graph lives in its settings tab');
  assert.equal(await page.locator('#monitorEnvelopeMount').isVisible(), true);
  assert.equal(await page.locator('#outputEnvelopeCanvas').isVisible(), true);
  assert.equal(await page.locator('#outputCanvas').isVisible(), false);
  const idleEnvelope = await monitorSignature(page, '#outputEnvelopeCanvas');
  assert.equal(idleEnvelope.width, 900); assert.equal(idleEnvelope.height, 240, 'Output envelope uses the full monitor canvas');
  // The successful setup edits intentionally wake a quiet release/tail probe.
  // Let its documented 400 ms silence window finish before testing idle sleep.
  await page.waitForTimeout(600);
  const idleFrom = (await monitorReads(page)).length;
  await page.waitForTimeout(250);
  assert.equal((await monitorReads(page)).length, idleFrom, 'Idle monitor does not read an analyser continuously');
  await page.locator('h1').click(); await page.keyboard.down('y'); await settled(page);
  await audible(page, 'Monitor reference note', keyboardHz);
  const measuredEnvelope = await monitorSignature(page, '#outputEnvelopeCanvas');
  assert.notEqual(measuredEnvelope.signature, idleEnvelope.signature, 'The output envelope changes with the real sounding signal');
  const before = await current(page), commandFrom = await page.evaluate(() => __spuSynthAudit.commands.length);
  await monitorMode(page, 'waveform');
  assert.equal(await page.locator('#monitorEnvelopeMount').isVisible(), false);
  assert.equal(await page.locator('#outputCanvas').isVisible(), true);
  assert.match(await page.locator('#visualizerDescription').innerText(), /waveform|output/i);
  const fullFrom = (await monitorReads(page)).length;
  const fullRead = await waitMonitorRead(page, fullFrom, 'TimeDomain'), fullCanvas = await monitorSignature(page);
  assert.equal(fullRead.finite, fullRead.values, 'Waveform receives finite real audio samples');
  await setSlider(page, '#masterVolume', .35);
  const halfPcm = await audible(page, 'Monitor after master-volume change', keyboardHz);
  const quietFrom = (await monitorReads(page)).length;
  const quietRead = await waitMonitorRead(page, quietFrom, 'TimeDomain'), quietCanvas = await monitorSignature(page);
  assert(quietRead.rms < fullRead.rms * .7 && quietRead.rms > fullRead.rms * .3, 'The waveform is measured after the real master gain: ' + JSON.stringify({fullRead, quietRead}));
  assert.notEqual(quietCanvas.signature, fullCanvas.signature, 'The rendered waveform changes with measured output volume');
  await setSlider(page, '#masterVolume', .7);
  await monitorMode(page, 'spectrum');
  assert.match(await page.locator('#visualizerDescription').innerText(), /spectrum|frequen/i);
  const spectrumFrom = (await monitorReads(page)).length;
  const spectrum = await waitMonitorRead(page, spectrumFrom, 'Frequency');
  assert(Math.abs(spectrum.peakHz - keyboardHz) <= spectrum.binHz * 2, 'The spectrum peak follows the sounding SPU note: ' + JSON.stringify({keyboardHz, spectrum}));
  const spectrumCanvas = await monitorSignature(page);
  assert.notEqual(spectrumCanvas.signature, quietCanvas.signature, 'Spectrum paints a distinct real FFT trace');
  const after = await settled(page);
  assert.deepEqual(after.auditions, before.auditions, 'Changing visualization preserves every note lease');
  assert.deepEqual(after.channels.map(channel => ({sample:channel.sample, pitch:channel.pitch, adsr1:channel.adsr1, adsr2:channel.adsr2})), before.channels.map(channel => ({sample:channel.sample, pitch:channel.pitch, adsr1:channel.adsr1, adsr2:channel.adsr2})), 'Display switches preserve samples, pitch and ADSR');
  const commands = await page.evaluate(from => __spuSynthAudit.commands.slice(from), commandFrom);
  assert(!commands.some(command => ['instrumentNoteOn', 'instrumentNoteOff', 'auditionOn', 'auditionOff', 'noteOn', 'noteOff', 'keyOn', 'keyOff', 'loadADPCM', 'setInstrumentWaveform'].includes(command.method)), 'Display switches never send note, gate or sample commands');
  const pacingFrom = (await monitorReads(page)).length;
  await page.waitForTimeout(450);
  const pacing = await monitorReads(page, pacingFrom);
  const sameKind = pacing.filter(value => value.method.includes('Frequency'));
  assert(sameKind.length >= 2 && sameKind.length <= 18, 'Active visual monitoring is limited to approximately 30 Hz: ' + JSON.stringify(sameKind.map(row => row.at)));
  await page.keyboard.up('y'); await silent(page, 'Monitor reference release');
  await page.locator('#stopAudio').click(); await silent(page, 'Monitor Stop');
  const stoppedFrom = (await monitorReads(page)).length;
  await page.waitForTimeout(250);
  assert.equal((await monitorReads(page)).length, stoppedFrom, 'Stopped monitor has no continual analyser reads');
  const graph = await page.evaluate(() => ({analysers:__spuSynthAudit.analysers.map(node => ({fftSize:node.fftSize, sampleRate:node.context.sampleRate})), edges:__spuSynthAudit.analyserEdges}));
  assert.equal(graph.analysers.length, 1, 'One passive analyser serves every monitor view');
  assert(graph.edges.some(edge => edge.destination === 'analyser'), 'The analyser receives actual output');
  assert(!graph.edges.some(edge => edge.source === 'analyser'), 'The monitor is an unconnected passive output branch');
  await monitorMode(page, 'envelope');
  return {modes:['envelope', 'waveform', 'spectrum'], editableEnvelope:false, measuredEnvelope:true, idleEnvelope, outputEnvelope:measuredEnvelope, finalOutputMeasured:true, fullRead, quietRead, halfPcm, fullCanvas, quietCanvas, spectrum, spectrumCanvas, displayPreservesNotes:true, displayPreservesInstrument:true, passiveGraph:graph, activeFrequencyReads:sameKind.length, inactiveReads:0};
}
async function checkMonitorWake(page, keyboardHz) {
  console.log('CHECK monitor: released infinite tail resumes after master unmute without a new note');
  await monitorMode(page, 'waveform'); await field(page, 'release-rate', 31);
  await hold(page); await audible(page, 'Infinite-release monitor note', keyboardHz); await release(page);
  const released = await settled(page);
  assert.equal(released.auditions.length, 0, 'The infinite-release tail no longer has a held note lease');
  await audible(page, 'Unowned infinite-release tail', keyboardHz);
  await setSlider(page, '#masterVolume', 0); const muted = await silent(page, 'Master-muted infinite-release tail');
  await page.waitForTimeout(750);
  const sleepingFrom = (await monitorReads(page)).length;
  await page.waitForTimeout(250);
  assert.equal((await monitorReads(page)).length, sleepingFrom, 'A quiet tail eventually stops analyser reads');
  const commandFrom = await page.evaluate(() => __spuSynthAudit.commands.length);
  await setSlider(page, '#masterVolume', .7); const restored = await audible(page, 'Master unmute restores the existing tail', keyboardHz);
  const resumed = await waitMonitorRead(page, sleepingFrom, 'TimeDomain');
  assert(resumed.rms > .0001, 'The display wakes and measures the resumed output without a held note');
  assert.equal((await settled(page)).auditions.length, 0, 'Waking the display does not allocate a new voice');
  const commands = await page.evaluate(from => __spuSynthAudit.commands.slice(from), commandFrom);
  assert(!commands.some(command => ['instrumentNoteOn', 'instrumentNoteOff', 'auditionOn', 'auditionOff', 'noteOn', 'noteOff', 'keyOn', 'keyOff'].includes(command.method)), 'Master mute/unmute never changes note ownership or gates');
  await field(page, 'release-rate', 0); await silent(page, 'Live release-rate cleanup after display wake');
  await page.locator('#stopAudio').click(); await silent(page, 'Stop after display wake'); await monitorMode(page, 'envelope');
  return {unownedTail:true, sleptWhenMuted:true, resumedWithoutNoteOn:true, muted, restored, resumed, ownershipUnchanged:true};
}

async function checkBrandAssets(page) {
  const headerIcon = page.locator('header img[src*="icon.png"]').first();
  await headerIcon.waitFor({state:'visible'});
  await headerIcon.evaluate(image => image.decode());
  const brand = await page.evaluate(async () => {
    const header = [...document.querySelectorAll('header img')].find(image => new URL(image.currentSrc || image.src, location.href).pathname.endsWith('/icon.png'));
    const links = [];
    for (const rel of ['icon', 'apple-touch-icon']) {
      const link = document.querySelector(`link[rel~="${rel}"]`);
      if (!link) {links.push({rel, missing:true}); continue;}
      const url = new URL(link.href, location.href), image = new Image(); image.src = url.href;
      await image.decode();
      const response = await fetch(url.href), bytes = await response.arrayBuffer();
      links.push({rel, href:link.getAttribute('href'), pathname:url.pathname, local:url.origin === location.origin, status:response.status, bytes:bytes.byteLength, naturalWidth:image.naturalWidth, naturalHeight:image.naturalHeight});
    }
    const style = getComputedStyle(document.documentElement);
    const palette = Object.fromEntries([...style].filter(property => property.startsWith('--')).sort().map(property => [property, style.getPropertyValue(property).trim()]));
    return {header:header && {src:header.getAttribute('src'), pathname:new URL(header.currentSrc || header.src, location.href).pathname, alt:header.alt, altAttributePresent:header.hasAttribute('alt'), naturalWidth:header.naturalWidth, naturalHeight:header.naturalHeight}, links, palette};
  });
  assert(brand.header && brand.header.naturalWidth > 0 && brand.header.naturalHeight > 0, 'The supplied product icon is decoded in the visible header');
  assert.equal(brand.header.altAttributePresent, true, 'The header icon explicitly declares its text alternative or decorative role');
  for (const link of brand.links) {
    assert.equal(link.missing, undefined, `The ${link.rel} link exists`);
    assert.equal(link.local, true, `The ${link.rel} uses the packaged local image`);
    assert(link.pathname.endsWith('/icon.png'), `The ${link.rel} uses the supplied icon.png`);
    assert.equal(link.status, 200, `The ${link.rel} image loads`);
    assert(link.bytes > 0 && link.naturalWidth > 0 && link.naturalHeight > 0, `The ${link.rel} image contains decodable pixels`);
  }
  return brand;
}

async function checkKeyboardFocus(page, keyboardHz) {
  console.log('CHECK keyboard focus: selected preset / repeats / number and text commit');
  await editorTab(page,'fx');
  const preset=page.locator(control('reverb-preset'));
  await preset.focus();await preset.selectOption('hall');await settled(page);
  assert(await preset.evaluate(node=>document.activeElement===node),'Keep actual select focus after choosing a preset');
  const from=await page.evaluate(()=>__spuSynthAudit.commands.length);
  await page.keyboard.down('r');const selectedPcm=await audible(page,'Keyboard after focused reverb selection');
  assert.equal((await current(page)).auditions.length,1);
  await page.keyboard.down('r');await settled(page);
  assert.equal(await preset.inputValue(),'hall','Musical keys and repeats must not invoke select type-ahead');
  const starts=await page.evaluate(from=>__spuSynthAudit.commands.slice(from).filter(command=>command.method==='instrumentNoteOn').length,from);
  assert.equal(starts,1,'A repeat never allocates another note');
  await page.keyboard.up('r');await settled(page);
  assert.equal((await current(page)).auditions.length,0,'Key Up is received while select retains focus');
  await page.keyboard.press('Tab');
  assert(!(await preset.evaluate(node=>document.activeElement===node)),'Tab still leaves the select normally');
  await page.locator('#stopAudio').click();await silent(page,'Focused select note stops');

  const numeric=page.locator(control('reverb-left'));
  await numeric.focus();await numeric.fill('0.2');
  await page.keyboard.press('y');await settled(page);
  assert.equal((await current(page)).auditions.length,0,'Typing inside a number field does not play notes');
  assert(await numeric.evaluate(node=>document.activeElement===node));
  await page.keyboard.press('Enter');await settled(page);
  assert(!(await numeric.evaluate(node=>document.activeElement===node)),'Enter commits and leaves number editing');
  await page.keyboard.down('y');const numberPcm=await audible(page,'Keyboard after number commit',keyboardHz);
  await page.keyboard.up('y');await settled(page);
  await page.locator('#stopAudio').click();await silent(page,'Committed number note stops');

  const name=page.locator('#instrumentName');
  await name.focus();await name.fill('Focus test');await page.keyboard.type('y');await settled(page);
  assert.equal((await current(page)).auditions.length,0,'Typing a name never plays a note');
  assert.equal(await name.inputValue(),'Focus testy');
  await page.keyboard.press('Enter');
  await page.keyboard.down('y');const textPcm=await audible(page,'Keyboard after name commit',keyboardHz);
  await page.keyboard.up('y');await page.locator('#stopAudio').click();await silent(page,'Committed text note stops');
  return {selectFocusPlayable:true,typeAheadSuppressed:true,repeatsStartOneNote:true,keyUpReceived:true,tabPreserved:true,textAndNumberEditingProtected:true,enterReturnsToPlaying:true,selectedPcm,numberPcm,textPcm};
}

async function checkPmon(page, keyboardHz, name) {
  console.log('CHECK PMON: FX controls / paired allocation / held edits / save and restore');
  await field(page,'reverb-send',false);await field(page,'reverb-preset','off');
  const set = async (name,value) => {
    await editorTab(page,'fx');
    await page.locator(`[data-pmon="${name}"]`).evaluate((node,value)=>{
      if(node.type==='checkbox')node.checked=value;else node.value=String(value);
      node.dispatchEvent(new Event('change',{bubbles:true}));node.blur();
    },value);
    await settled(page);
  };
  await set('depth',0);await set('decayMs',0);await set('enabled',true);
  assert.equal((await current(page)).polyphony,12);
  await page.locator('h1').click();await page.keyboard.down('y');
  const held=await settled(page);assert.equal(held.auditions[0].channel,1);
  const dry=await audible(page,'PMON depth zero',keyboardHz);
  const commandStart=await page.evaluate(()=>__spuSynthAudit.commands.length);
  await set('depth',.8);await set('ratio',3);
  const wetState=await settled(page),wet=await audible(page,'Real hardware PMON');
  assert.deepEqual(wetState.auditions,held.auditions,'Ratio/Depth keep note identity');
  const edits=await page.evaluate(start=>__spuSynthAudit.commands.slice(start),commandStart);
  assert(!edits.some(command=>command.method==='instrumentNoteOn'),'PMON edits do not re-key carriers');
  assert.notEqual(wet.channels[0].pcmFingerprint,dry.channels[0].pcmFingerprint,'PMON changes actual PCM');
  assert(wetState.channels.every(channel=>channel.waveform?.pcm?.length===112),'source Sine never replaces the authored carrier wave');
  const shapes=[];
  for(const waveform of ['sine','triangle','saw','square']) {
    await set('waveform',waveform);
    const state=await settled(page),pcm=await audible(page,`PMON ${waveform}`);
    assert.deepEqual(state.auditions,held.auditions,'Changing modulator keeps note owners');
    assert.equal(state.samples.length,wetState.samples.length,'Modulator edits reuse sample RAM');
    shapes.push({waveform,pcm});
  }
  assert.equal(new Set(shapes.map(value=>value.pcm.channels[0].pcmFingerprint)).size,4);
  assert(!(await page.evaluate(start=>__spuSynthAudit.commands.slice(start),commandStart)).some(c=>c.method==='instrumentNoteOn'));
  await set('decayMs',740);
  const pmonLayouts=[];
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:width===390?844:1100});
    const dimensions=await page.locator('.spu-pmon').evaluate(node=>({width:node.getBoundingClientRect().width,scroll:node.scrollWidth,client:node.clientWidth}));
    assert(dimensions.scroll<=dimensions.client+1,'PMON controls fit without horizontal scrolling');
    const screenshot=config.screenshots ? path.join(config.screenshots,`${name}-pmon-${width}.png`) : null;
    if(screenshot)await page.locator('.spu-pmon').screenshot({path:screenshot});
    pmonLayouts.push({viewport:width,...dimensions,screenshot});
  }
  await page.setViewportSize({width:1440,height:1100});
  await page.locator('#instrumentName').fill('PMON Bell');
  const downloadPromise=page.waitForEvent('download');await page.locator('#savePreset').click();
  const bytes=await fs.readFile(await (await downloadPromise).path()),preset=JSON.parse(bytes);
  assert.deepEqual(preset.pmon,{enabled:true,ratio:3,depth:.8,decayMs:740,waveform:'square'});
  await set('enabled',false);assert.equal((await current(page)).auditions.length,0);
  await page.keyboard.up('y');
  await page.locator('#presetFileInput').setInputFiles({name:'pmon.spu.json',mimeType:'application/json',buffer:bytes});
  await page.waitForFunction(()=>document.getElementById('audioStatus').textContent==='Loaded PMON Bell.');
  const restored=await settled(page);assert.deepEqual(restored.pmon,preset.pmon);
  assert(await page.locator('[data-pmon="enabled"]').isChecked());
  const keys=await page.locator('#keyboardMount .key[data-key]').evaluateAll(nodes=>[...new Set(nodes.map(node=>node.dataset.key))].slice(0,13));
  await page.locator('h1').click();const from=await page.evaluate(()=>__spuSynthAudit.commands.length);
  for(const key of keys)await page.keyboard.down(key);
  const paired=await settled(page);
  const ons=await page.evaluate(from=>__spuSynthAudit.commands.slice(from).filter(c=>c.method==='instrumentNoteOn').map(c=>c.allocation),from);
  assert.deepEqual(ons.map(note=>note.channel),[1,3,5,7,9,11,13,15,17,19,21,23,1]);
  assert.equal(paired.auditions.length,12);
  await page.keyboard.up(keys[0]);assert.deepEqual((await settled(page)).auditions,paired.auditions);
  for(const key of keys.slice(1))await page.keyboard.up(key);
  await page.locator('#stopAudio').click();await silent(page,'PMON Stop clears source and carrier tails');
  await set('enabled',false);assert.equal((await current(page)).polyphony,24);
  // Old version-1 instruments remain valid and explicitly return to Off.
  delete preset.pmon;delete preset.noise;
  await page.locator('#presetFileInput').setInputFiles({name:'legacy.spu.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(preset))});
  await page.waitForFunction(()=>document.getElementById('audioStatus').textContent==='Loaded PMON Bell.');
  await settled(page);assert.equal((await current(page)).pmon.enabled,false);
  return {physicalVoices:24,polyphony:12,carrierChannels:ons.map(note=>note.channel),heldEditsKeepOwners:true,presetRoundTrip:true,legacyDefaultsOff:true,layouts:pmonLayouts,shapes,dry,wet};
}

async function checkNoise(page,name) {
  console.log('CHECK Noise: source / live clock / focus / preset / PMON switching');
  await fastEnvelope(page);
  await editorTab(page,'pcm');
  const select=page.locator('[data-noise="source"]');
  const source=async value=>{await editorTab(page,'pcm');await select.selectOption(value);await settled(page);};
  const original=(await current(page)).channels[0].waveform;
  await source('noise');
  const initial=await current(page);assert(initial.noise.enabled);assert.equal(initial.polyphony,24);assert(!initial.pmon.enabled);
  await select.focus();await page.keyboard.down('y');
  const held=await settled(page);assert.equal(held.auditions.length,1);
  assert(await select.evaluate(node=>node===document.activeElement),'Source focus still allows keyboard notes');
  assert.equal(await select.inputValue(),'noise');
  const pcm=await audible(page,'Noise held from focused select');
  const start=await page.evaluate(()=>__spuSynthAudit.commands.length);
  const slider=page.locator('[data-noise="clock"]');
  // No change event: an input must reach the SPU before the drag ends.
  await slider.evaluate(node=>{node.value='56';node.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal((await settled(page)).noise.clock,56,'input updates Noise clock without waiting for change');
  await slider.scrollIntoViewIfNeeded();const box=await slider.boundingBox();assert(box);
  await page.mouse.move(box.x+box.width*.85,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width-1,box.y+box.height/2,{steps:8});
  const changed=await settled(page),clockPcm=await audible(page,'Noise clock changes before mouse release');
  assert.equal(changed.noise.clock,63,'Native range drag reaches the SPU while the mouse is still down');
  await page.mouse.up();await settled(page);
  assert.deepEqual(changed.auditions,held.auditions);
  assert.equal(changed.samples.length,initial.samples.length);
  assert.notEqual(pcm.channels[0].pcmFingerprint,clockPcm.channels[0].pcmFingerprint);
  assert(!(await page.evaluate(start=>__spuSynthAudit.commands.slice(start),start)).some(c=>c.method==='instrumentNoteOn'));
  await page.keyboard.up('y');await settled(page);await silent(page,'Noise release');
  const layouts=[];
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:width===390?844:1100});
    const dimensions=await page.locator('.spu-source').evaluate(node=>({scroll:node.scrollWidth,client:node.clientWidth,document:document.documentElement.scrollWidth,viewport:innerWidth}));
    assert(dimensions.scroll<=dimensions.client+1);assert(dimensions.document<=width+1);
    const screenshot=config.screenshots?path.join(config.screenshots,`${name}-noise-${width}.png`):null;
    if(screenshot)await page.screenshot({path:screenshot,fullPage:true});
    layouts.push({...dimensions,screenshot});
  }
  await page.setViewportSize({width:1440,height:1100});
  await page.locator('#instrumentName').fill('Noise Drum');
  const download=page.waitForEvent('download');await page.locator('#savePreset').click();
  const bytes=await fs.readFile(await(await download).path()),preset=JSON.parse(bytes);
  assert.deepEqual(preset.noise,{enabled:true,clock:63});assert(!preset.pmon.enabled);
  await source('sample');assert.deepEqual((await current(page)).channels[0].waveform,original,'Noise keeps authored PCM');
  await page.locator('#presetFileInput').setInputFiles({name:'noise.spu.json',mimeType:'application/json',buffer:bytes});
  await page.waitForFunction(()=>document.getElementById('audioStatus').textContent==='Loaded Noise Drum.');
  assert.deepEqual((await settled(page)).noise,preset.noise);assert.equal(await select.inputValue(),'noise');
  await page.locator('h1').click();await page.keyboard.down('y');await settled(page);
  await editorTab(page,'fx');await page.locator('[data-pmon="enabled"]').check();
  let state=await settled(page);assert(state.pmon.enabled);assert(!state.noise.enabled);assert.equal(state.polyphony,12);assert.equal(state.auditions.length,0);
  await page.keyboard.up('y');await source('noise');
  state=await current(page);assert(!state.pmon.enabled);assert.equal(state.polyphony,24);
  await page.locator('h1').click();await page.keyboard.down('y');await settled(page);await audible(page,'Noise after PMON switch');
  await page.locator('#stopAudio').click();await silent(page,'Noise Stop');await page.keyboard.up('y');
  await page.locator('#resetPreset').click();
  state=await settled(page);assert(!state.noise.enabled);assert(!state.pmon.enabled);assert.equal(await select.inputValue(),'sample');
  return {sharedClock:true,clock:63,polyphony:24,focusedSelectPlayable:true,heldClockKeepsOwners:true,clockUpdatesBeforePointerRelease:true,presetRoundTrip:true,pcmRetained:true,exclusiveWithPmon:true,layouts,pcm,clockPcm};
}

async function checkMorph(page,name) {
  console.log('CHECK Software morph: held native drag / endpoints / presets / PMON / layout');
  await fastEnvelope(page);await field(page,'reverb-preset','off');
  await shape(page,'triangle');const original=(await settled(page)).channels[0].waveform.pcm;
  const set=async(key,value)=>{
    await editorTab(page,'pcm');
    const node=page.locator(`[data-morph="${key}"]`);
    if(key==='enabled')await node.setChecked(value);else if(key==='amount')await node.evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);
    else await node.selectOption(value);
    await settled(page);
  };
  await page.locator('[data-morph-capture="a"]').click();await settled(page);
  await set('b','square');
  assert.deepEqual((await current(page)).morph.a,original,'Current PCM becomes endpoint A');
  assert.deepEqual((await current(page)).channels[0].waveform.pcm,original,'Preparing endpoints while Off leaves PCM alone');
  assert.match(await page.locator('.spu-morph').innerText(),/Software feature:.*not a built-in PS1 SPU effect/s);
  await page.locator('h1').click();await page.keyboard.down('y');
  const held=await settled(page),before=await audible(page,'Before Software morph');
  const start=await page.evaluate(()=>__spuSynthAudit.commands.length);
  await set('enabled',true);
  const slider=page.locator('[data-morph="amount"]');await slider.scrollIntoViewIfNeeded();const box=await slider.boundingBox();assert(box);
  await page.mouse.move(box.x+7,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width-1,box.y+box.height/2,{steps:10});
  const changed=await settled(page),pcm=await audible(page,'Software morph before pointer release');
  assert.equal(changed.morph.amount,1);assert.deepEqual(changed.channels[0].waveform.pcm,changed.morph.b);
  assert.deepEqual(changed.auditions,held.auditions);assert.equal(changed.nextAddress,held.nextAddress);assert.equal(changed.samples.length,held.samples.length);
  assert.notEqual(before.channels[0].pcmFingerprint,pcm.channels[0].pcmFingerprint);
  assert(!(await page.evaluate(start=>__spuSynthAudit.commands.slice(start),start)).some(c=>c.method==='instrumentNoteOn'));
  await page.mouse.up();await page.keyboard.up('y');await settled(page);await silent(page,'Morph release');
  const morphCanvas=page.locator('.spu-morph canvas');
  assert.equal(await morphCanvas.count(),1,'Morph reuses one canvas for viewing and drawing');
  assert.equal(await page.locator('#instrumentPanel-pcm canvas:visible').count(),1,'There is no separate preview or drawing canvas');
  const previewRead=()=>morphCanvas.evaluate(node=>{
    const pixels=node.getContext('2d').getImageData(0,0,node.width,node.height).data;
    let hash=2166136261;for(const value of pixels)hash=Math.imul(hash^value,16777619)>>>0;
    const colors={a:0,b:0,result:0};
    for(let i=0;i<pixels.length;i+=4){const [r,g,b]=pixels.slice(i,i+3);if(b>r*1.2&&g>r)colors.a++;if(r>g*1.2&&b>g)colors.b++;if(r>g&&g>b*1.2)colors.result++;}
    return {hash,colors};
  });
  const previewsBefore=await previewRead();
  await set('amount',.5);await page.locator('h1').click();await page.keyboard.down('y');
  const drawingOwners=(await settled(page)).auditions;
  const editorStart=await page.evaluate(()=>__spuSynthAudit.commands.length);
  const selectEndpoint=async key=>{
    const from=await page.evaluate(()=>__spuSynthAudit.commands.length);
    await page.locator(`[data-morph-edit="${key}"]`).click();await settled(page);
    assert.equal(await page.evaluate(()=>__spuSynthAudit.commands.length),from,'Selecting A/B never sends audio commands');
    assert.equal(await page.locator(`[data-morph-edit="${key}"]`).getAttribute('aria-pressed'),'true');
    assert.match(await page.locator('#instrumentPanel-pcm h3').innerText(),new RegExp(`Wave ${key.toUpperCase()}`));
  };
  const drawEndpoint=async key=>{
    await selectEndpoint(key);const prior=await current(page),other=key==='a'?'b':'a';
    const canvas=page.locator(control('waveform'));await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();assert(box);
    await page.mouse.move(box.x+box.width*.12,box.y+box.height*.2);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.7,box.y+box.height*.65,{steps:10});await page.mouse.up();
    const after=await settled(page);assert(after.morph.enabled,'Drawing endpoints keeps Morph On');
    assert.notDeepEqual(after.morph[key],prior.morph[key]);assert.deepEqual(after.morph[other],prior.morph[other]);
    assert.deepEqual(after.auditions,drawingOwners);
    await field(page,'wave-index',7);await field(page,'wave-value',key==='a'?.83:-.77);
    assert.equal((await current(page)).morph[key][7],Math.fround(key==='a'?.83:-.77));
  };
  await drawEndpoint('a');await drawEndpoint('b');
  const beforeCancel=await current(page);
  await morphCanvas.scrollIntoViewIfNeeded();const cancelBox=await morphCanvas.boundingBox();
  await page.mouse.move(cancelBox.x+cancelBox.width*.2,cancelBox.y+cancelBox.height*.3);await page.mouse.down();
  await page.mouse.move(cancelBox.x+cancelBox.width*.5,cancelBox.y+cancelBox.height*.7,{steps:3});
  await page.locator('[data-spu-editor-tab="adsr"]').focus();await page.keyboard.press('Enter');
  await assertEditorTab(page,'adsr');await page.mouse.up();await editorTab(page,'pcm');
  assert.deepEqual((await settled(page)).morph,beforeCancel.morph,'Leaving the editor cancels an unfinished stroke');

  const drawn=await current(page),previewsAfter=await previewRead();
  assert.notEqual(previewsBefore.hash,previewsAfter.hash,'The shared canvas follows endpoint edits');
  for(const key of ['a','b','result'])assert(previewsAfter.colors[key]>20,`${key} waveform is visible in its own color on the shared canvas`);
  await editorTab(page,'adsr');await editorTab(page,'pcm');
  const returned=await previewRead();assert.deepEqual(returned,previewsAfter,'Returning to PCM restores all overlaid traces');
  assert(!(await page.evaluate(start=>__spuSynthAudit.commands.slice(start),editorStart)).some(c=>c.method==='instrumentNoteOn'));
  await audible(page,'Drawn A/B blend while held');await page.keyboard.up('y');await settled(page);await silent(page,'Drawn Morph release');
  const upperMorph=page.locator('#morphAmount');
  assert.equal(await upperMorph.inputValue(),await page.locator('[data-morph="amount"]').inputValue(),'PCM amount synchronizes the upper slider');
  await editorTab(page,'fx');await page.locator('h1').click();await page.keyboard.down('y');
  const performanceHeld=await settled(page),performanceStart=await page.evaluate(()=>__spuSynthAudit.commands.length);
  const beforePerformance=await audible(page,'Before upper Morph gesture');
  await upperMorph.scrollIntoViewIfNeeded();const upperBox=await upperMorph.boundingBox();assert(upperBox);
  await page.mouse.move(upperBox.x+upperBox.width/2,upperBox.y+upperBox.height/2);await page.mouse.down();
  await page.mouse.move(upperBox.x+upperBox.width/2,upperBox.y+1,{steps:8});
  const performanceState=await settled(page),performancePcm=await audible(page,'Upper Morph before pointer release');
  assert.equal(performanceState.morph.amount,1);assert.equal(await page.locator('[data-morph="amount"]').inputValue(),'1');
  assert.deepEqual(performanceState.auditions,performanceHeld.auditions);assert.equal(performanceState.nextAddress,performanceHeld.nextAddress);
  assert.notEqual(beforePerformance.channels[0].pcmFingerprint,performancePcm.channels[0].pcmFingerprint);
  await page.mouse.up();await settled(page);assert.equal(await upperMorph.inputValue(),'1','Morph retains its value after release');
  assert.equal(await page.locator('#pitchBend').inputValue(),'0','Morph does not change Pitch');
  assert(!(await page.evaluate(start=>__spuSynthAudit.commands.slice(start),performanceStart)).some(c=>c.method==='instrumentNoteOn'));
  await page.keyboard.up('y');await settled(page);await silent(page,'Upper Morph note release');
  await set('amount',.5);assert.equal(await upperMorph.inputValue(),'0.5');


  const layouts=[];
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:width===390?844:1100});
    const sizes=await page.locator('.spu-morph').evaluate(node=>({scroll:node.scrollWidth,client:node.clientWidth,document:document.documentElement.scrollWidth}));
    assert(sizes.scroll<=sizes.client+1);assert(sizes.document<=width+1);
    const screenshot=config.screenshots?path.join(config.screenshots,`${name}-morph-${width}.png`):null;
    if(screenshot){await page.locator('.spu-morph').screenshot({path:screenshot});await page.locator('#spuMonitor').screenshot({path:path.join(config.screenshots,`${name}-dual-morph-${width}.png`)});}layouts.push({width,...sizes,screenshot});
  }
  await page.setViewportSize({width:1440,height:1100});
  await set('amount',.37);await page.locator('#instrumentName').fill('Software Morph');
  const download=page.waitForEvent('download');await page.locator('#savePreset').click();
  const bytes=await fs.readFile(await(await download).path()),preset=JSON.parse(bytes);
  assert(preset.morph.enabled);assert.equal(preset.morph.amount,.37);
  await set('enabled',false);assert(await upperMorph.isDisabled());assert.deepEqual((await current(page)).channels[0].waveform.pcm,preset.waveform,'Off freezes blend');
  await shape(page,'sine');assert(!(await settled(page)).morph.enabled);
  await page.locator('#presetFileInput').setInputFiles({name:'morph.spu.json',mimeType:'application/json',buffer:bytes});
  await page.waitForFunction(()=>document.getElementById('audioStatus').textContent==='Loaded Software Morph.');
  assert.deepEqual((await settled(page)).morph,preset.morph);assert(await page.locator('[data-morph="enabled"]').isChecked());
  assert.equal(await upperMorph.inputValue(),'0.37','Preset load updates both controls');
  await editorTab(page,'fx');await page.locator('[data-pmon="enabled"]').check();await settled(page);
  await page.locator('h1').click();await page.keyboard.down('y');const paired=await settled(page);
  await set('amount',.75);assert.deepEqual((await current(page)).auditions,paired.auditions);assert((await current(page)).pmon.enabled);
  await audible(page,'Software morph with PMON');await page.keyboard.up('y');await page.locator('#stopAudio').click();await silent(page,'Morph PMON Stop');
  await editorTab(page,'pcm');await page.locator('[data-noise="source"]').selectOption('noise');await settled(page);
  assert(!(await page.locator('.spu-morph').isVisible()));
  assert(await page.locator('#morphAmount').isDisabled(),'Noise disables the performance Morph control');
  await page.locator('[data-noise="source"]').selectOption('sample');await settled(page);assert(await page.locator('.spu-morph').isVisible());
  delete preset.morph;
  await page.locator('#presetFileInput').setInputFiles({name:'legacy-morph.spu.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(preset))});
  await page.waitForFunction(()=>document.getElementById('audioStatus').textContent==='Loaded Software Morph.');
  assert(!(await settled(page)).morph.enabled);
  await page.locator('#resetPreset').click();assert(!(await settled(page)).morph.enabled);
  return {softwareLabel:true,dualMorphControls:true,upperMorphWorksOutsidePcm:true,morphRetainsOnRelease:true,performancePcm,singleCanvas:true,threeOverlaidWaveforms:true,independentAbDrawing:true,abNumericEditing:true,selectionSendsNoAudioCommands:true,previewsBefore,previewsAfter,clockUpdatesBeforePointerRelease:true,heldOwnersPreserved:true,noRetrigger:true,ramReused:true,captureCurrentPcm:true,presetRoundTrip:true,legacyDefaultsOff:true,pmonCompatible:true,layouts,before,pcm};
}

// No private production hooks, injected chip calls or fake renderers are used.
async function runCase(browser, name, origin) {
  const context = await browser.newContext({serviceWorkers:'block', viewport:{width:1440, height:1100}, acceptDownloads:true});
  await context.addInitScript({content:`globalThis.__spuSynthClock={pilot:${analyzePilotPcm.toString()},clock:${analyzeClockRows.toString()}};`});
  await context.addInitScript(instrumentation);
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const errors = [], failedResponses = [];
  page.on('pageerror', error => errors.push({message:error.message, stack:error.stack}));
  page.on('response', response => {if (response.status() >= 400) failedResponses.push({url:response.url(), status:response.status()});});
  try {
    console.log(`CHECK ${name}: lazy startup / one common instrument`);
    await page.goto(origin + config.entry, {waitUntil:'domcontentloaded'});
    await page.locator('#startAudio').waitFor({state:'visible'});
    assert.match(await page.title(), /Tetorica.*SPU.*Synth/i);
    const brand = await checkBrandAssets(page);
    assert.equal(await page.evaluate(() => __spuSynthAudit.contexts.length), 0, 'Opening the page remains audio-lazy');
    const editorTabs = await checkEditorTabsBeforeAudio(page);
    await page.locator('#startAudio').click();
    await page.locator(action('wave-sine')).waitFor({state:'visible'});
    await page.waitForFunction(() => __spuSynthAudit.states.length > 0 || document.getElementById('audioStatus').dataset.error === 'true');
    assert.notEqual(await page.locator('#audioStatus').getAttribute('data-error'), 'true', 'Audio startup: ' + await page.locator('#audioStatus').textContent());
    assert.equal(await page.locator(`${panel} [data-chip-channel]`).count(), 0, 'Hardware voice selection is automatic');
    assert.deepEqual(await page.locator(`${panel} h3`).allTextContents(), ['PCM cycle → SPU ADPCM', 'ADSR envelope', 'SPU reverb'], 'The instrument exposes only PCM, ADSR and reverb editor sections');
    assert(!/Voice studio|Selected ADPCM voice/.test(await page.locator(panel).innerText()), 'There is no physical-voice studio/card');
    assert.equal(await page.locator('#refreshVoice').count(), 0, 'No manual state refresh is needed');
    assert.equal(await page.evaluate(() => __spuSynthAudit.contexts.length), 1, 'A user action creates a single audio context');
    await fastEnvelope(page);
    await field(page, 'reverb-send', false); await field(page, 'reverb-preset', 'off');
    const initial = await settled(page); assert.equal(initial.channels.length, 24);
    assert(initial.channels.every(channel => channel.waveform?.pcm?.length === 112), 'The initial common instrument has an editable cycle on every voice');
    assert(initial.channels.every(channel => channel.adsr1 === initial.channels[0].adsr1 && channel.adsr2 === initial.channels[0].adsr2), 'All voices use the common initial ADSR');
    const computerKey = page.locator('#keyboardMount .key[data-key="y"]');
    await computerKey.waitFor({state:'visible'});
    const keyboardNote = (await computerKey.locator('span').textContent()).trim(), keyboardHz = noteFrequency(keyboardNote);
    const idleFrom = await page.evaluate(() => __spuSynthAudit.commands.length);
    await page.waitForTimeout(250);
    const idleCommands = await page.evaluate(from => __spuSynthAudit.commands.slice(from), idleFrom);
    assert(!idleCommands.some(command => ['inspect', 'getState'].includes(command.method)), 'An idle editor performs no background SPU inspection');
    const monitor = await checkMonitor(page, keyboardHz);
    monitor.wake = await checkMonitorWake(page, keyboardHz);
    editorTabs.heldNote = await checkEditorTabsDuringSound(page, keyboardHz);
    console.log(`CHECK ${name}: pointer sound / ADSR graph / keyboard pitch`);
    const pointerStart = await page.evaluate(() => __spuSynthAudit.commands.length);
    await hold(page); const pointerPcm = await audible(page, 'Pointer-held initial sine', keyboardHz);
    await release(page); const pointerRelease = await silent(page, 'Pointer release');
    const pointerCommands = await page.evaluate(from => __spuSynthAudit.commands.slice(from), pointerStart);
    assert.equal(pointerCommands.filter(command => command.method === 'instrumentNoteOn').length, 1, 'Pointer hold acquires one voice');
    assert.equal(pointerCommands.filter(command => command.method === 'instrumentNoteOff').length, 1, 'Pointer release releases one voice');

    await field(page, 'attack-rate', 32); await field(page, 'decay-rate', 4); await field(page, 'sustain-level', 8); await field(page, 'release-rate', 8);
    const beforeGraph = await settled(page), handle = page.locator('#instrumentPanel-adsr [data-chip-envelope-handle="attack"]');
    await handle.scrollIntoViewIfNeeded(); const box = await handle.boundingBox(); assert(box, 'The ADSR graph exposes its attack handle');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, {steps:6}); await page.mouse.up();
    const afterGraph = await settled(page);
    assert.notEqual(afterGraph.channels[0].envelopeParameters.attackRate, beforeGraph.channels[0].envelopeParameters.attackRate, 'Dragging the graph changes Attack');
    assert(afterGraph.channels.every(channel => channel.adsr1 === afterGraph.channels[0].adsr1 && channel.adsr2 === afterGraph.channels[0].adsr2), 'Dragging ADSR updates the common instrument on all 24 voices');
    await fastEnvelope(page);

    // Select a standard fretboard key from its visible pitch label, then use
    // real PC keydown/up while the physical sink remains permanently muted.
    await page.locator('#instrumentName').focus(); await page.keyboard.press('Tab');
    await page.locator('h1').click(); await page.keyboard.down('y');
    const keyboardPcm = await audible(page, 'PC keyboard', keyboardHz);
    const beforePitch = await settled(page), held = beforePitch.auditions[0];
    assert(held, 'The keyboard owns a sounding SPU voice');
    const pitchFrom = await page.evaluate(() => __spuSynthAudit.commands.length);
    await setSlider(page, '#pitchBend', 2); const bentPcm = await audible(page, 'Held-note pitch bend', keyboardHz * 2 ** (2 / 12));
    const bentState = await settled(page);
    assert.equal(bentState.auditions.length, beforePitch.auditions.length, 'Pitch bending preserves note ownership');
    const pitchCommands = await page.evaluate(from => __spuSynthAudit.commands.slice(from), pitchFrom);
    assert(!pitchCommands.some(command => ['instrumentNoteOn', 'auditionOn', 'noteOn', 'keyOn'].includes(command.method)), 'Pitch bending never re-triggers the sample');
    await setSlider(page, '#pitchBend', 0); const centeredPcm = await audible(page, 'Pitch center', keyboardHz);
    const pitchBox = await page.locator('#pitchBend').boundingBox(); assert(pitchBox);
    await page.mouse.move(pitchBox.x + pitchBox.width / 2, pitchBox.y + pitchBox.height * .2); await page.mouse.down(); await settled(page);
    const gestureBend = Number(await page.locator('#pitchBend').inputValue()); assert(gestureBend > .1, 'Dragging the upper Pitch wheel raises the pitch');
    const gesturePcm = await audible(page, 'Real Pitch wheel gesture', keyboardHz * 2 ** (gestureBend / 12));
    await page.mouse.up(); await settled(page);
    assert.equal(Number(await page.locator('#pitchBend').inputValue()), 0, 'Releasing the Pitch wheel returns it to center');
    const gestureCenteredPcm = await audible(page, 'Pitch wheel release centers the sounding note', keyboardHz);
    await page.keyboard.up('y'); await silent(page, 'Computer key release');

    console.log(`CHECK ${name}: independent chord voices / live common controls / sustain`);
    await page.locator('#sustainToggle').check();
    await page.locator('#sustainToggle').focus();
    assert.equal(await page.locator('#sustainToggle').evaluate(node => document.activeElement === node), true, 'Sustain retains normal checkbox focus');
    for (const key of ['y', 'u']) await page.keyboard.down(key);
    await hold(page, 'i');
    const chordState = await settled(page), chordPcm = await audible(page, 'PC and pointer chord');
    assert.equal(chordState.auditions.length, 3, 'PC keys and pointer notes coexist');
    assert.equal(new Set(chordState.auditions.map(entry => entry.channel)).size, 3, 'Each chord note owns an independent hardware voice');
    const chordFrom = await page.evaluate(() => __spuSynthAudit.commands.length);
    await field(page, 'release-rate', 8);
    const chordEdited = await settled(page);
    assert.deepEqual(chordEdited.auditions, chordState.auditions, 'Live common ADSR edits preserve every chord note lease');
    assert(chordEdited.channels.every(channel => channel.envelopeParameters.releaseRate === 8), 'Live ADSR edits reach all 24 voices');
    await setSlider(page, '#pitchBend', 1);
    const chordBent = await settled(page);
    assert.deepEqual(chordBent.auditions, chordState.auditions, 'Chord pitch bending preserves all notes');
    for (const {channel} of chordState.auditions) assert(chordBent.channels[channel].pitch > chordEdited.channels[channel].pitch, 'Pitch bend changes each held voice');
    const chordCommands = await page.evaluate(from => __spuSynthAudit.commands.slice(from), chordFrom);
    assert(!chordCommands.some(command => ['instrumentNoteOn', 'auditionOn', 'noteOn', 'keyOn'].includes(command.method)), 'ADSR edits and chord pitch never re-trigger notes');
    await setSlider(page, '#pitchBend', 0);
    await page.keyboard.up('y'); await page.keyboard.up('u'); await release(page);
    assert.equal((await settled(page)).auditions.length, 3, 'Sustain keeps all released PC and pointer notes alive');
    await page.locator('#sustainToggle').uncheck();
    await settled(page); const sustainReleased = await silent(page, 'Sustain release');
    assert.equal((await current(page)).auditions.length, 0, 'Sustain off releases every sustained source');
    await fastEnvelope(page);

    console.log(`CHECK ${name}: all 24 round-robin slots / safe oldest-note stealing`);
    const keys = await page.locator('#keyboardMount .key[data-key]').evaluateAll(nodes => [...new Set(nodes.map(node => node.dataset.key))].slice(0, 26));
    assert.equal(keys.length, 26, 'The visible fretboard provides 26 real PC-key sources');
    await page.locator('h1').click();
    const allocationFrom = await page.evaluate(() => __spuSynthAudit.commands.length);
    for (const key of keys) await page.keyboard.down(key);
    const allocated = await settled(page);
    const ons = await page.evaluate(from => __spuSynthAudit.commands.slice(from).filter(command => command.method === 'instrumentNoteOn').map(command => ({channel:command.allocation.channel, midi:command.args[0], id:command.args[1]})), allocationFrom);
    assert.equal(ons.length, 26, 'Every PC key starts a note');
    const firstChannel = ons[0].channel;
    assert.deepEqual(ons.map(command => command.channel), Array.from({length:26}, (_, index) => (firstChannel + index) % 24), 'Allocation rotates over all 24 physical voices before replacing the oldest');
    assert.equal(allocated.auditions.length, 24, 'The SPU holds exactly 24 independent notes after two steals');
    const expectedLeases = ons.slice(2).map(({channel, id}) => ({channel, id}));
    assert.deepEqual([...allocated.auditions].sort((a, b) => a.channel - b.channel), [...expectedLeases].sort((a, b) => a.channel - b.channel), 'Stolen slots belong to the replacement note owners');
    const staleFrom = await page.evaluate(() => __spuSynthAudit.commands.length);
    await page.keyboard.up(keys[0]); await page.keyboard.up(keys[1]);
    const staleReleased = await settled(page);
    assert.deepEqual(staleReleased.auditions, allocated.auditions, 'Releasing stolen keys leaves their replacement notes sounding');
    const staleCommands = await page.evaluate(from => __spuSynthAudit.commands.slice(from), staleFrom);
    assert(!staleCommands.some(command => command.method === 'instrumentNoteOff'), 'Retired key sources cannot issue an Off against replacement voices');
    for (const key of keys.slice(2)) await page.keyboard.up(key);
    await settled(page); await silent(page, 'All round-robin notes released');
    assert.equal((await current(page)).auditions.length, 0);

    console.log(`CHECK ${name}: common PCM shapes / real WAV import / portable preset round trip`);
    await shape(page, 'triangle');
    const triangle = await settled(page);
    assert(triangle.channels.every(channel => JSON.stringify(channel.waveform?.pcm) === JSON.stringify(triangle.channels[0].waveform.pcm)), 'A waveform choice reaches all 24 independent editor slots');
    assert.notDeepEqual(triangle.channels[0].waveform.pcm, initial.channels[0].waveform.pcm, 'The shape button changes the real waveform');
    await shape(page, 'sine'); await settled(page);

    await editorTab(page, 'audio');
    await page.locator('#sampleLoop').check(); await page.locator('#sampleRootNote').fill('69');
    const wav = sineWav(); await page.locator('#audioFileInput').setInputFiles({name:'browser-sine.wav', mimeType:'audio/wav', buffer:wav});
    await page.waitForFunction(() => document.getElementById('sampleName').textContent.includes('browser-sine'));
    const imported = await settled(page); assert(imported.samples.length > initial.samples.length, 'Import creates a real sample descriptor');
    assert(imported.channels.every(channel => channel.sample === imported.channels[0].sample), 'Audio import assigns the shared sample to all 24 voices');
    assert.equal(imported.samples.find(sample => sample.id === imported.channels[0].sample).rootFrequencyHz, 440, 'Imported sample retains the chosen root note');
    await hold(page); const importedPcm = await audible(page, 'Imported WAV', keyboardHz); await release(page); await silent(page, 'Imported WAV release');
    await page.locator('#instrumentName').fill('Browser round trip');
    const downloadPromise = page.waitForEvent('download'); await page.locator('#savePreset').click(); const download = await downloadPromise;
    const presetBytes = await fs.readFile(await download.path()), preset = JSON.parse(presetBytes.toString());
    assert.equal(preset.schema, 'tetorica-spu-synth.instrument'); assert.equal(preset.version, 1);
    await field(page, 'release-rate', 15); await applied(page, 'state.channels.every(channel=>channel.envelopeParameters.releaseRate===15)');
    await page.locator('#presetFileInput').setInputFiles({name:'browser-round-trip.json', mimeType:'application/json', buffer:presetBytes});
    await page.waitForFunction(() => document.getElementById('audioStatus').textContent.startsWith('Loaded Browser round trip'));
    const restored = await settled(page); assert(restored.channels.every(channel => channel.adsr1 === imported.channels[0].adsr1 && channel.adsr2 === imported.channels[0].adsr2), 'Preset restoration applies ADSR across the entire instrument');
    assert.equal(new Set(restored.channels.map(channel => channel.sample)).size, 1, 'Restored recorded sample is common to all voices');
    await page.locator('h1').click(); await page.keyboard.down('y'); await settled(page);
    await audible(page, 'Restored preset', keyboardHz);
    const beforeCycleSwitch = await settled(page);
    await shape(page, 'sine');
    const cycleSwitched = await settled(page);
    assert.deepEqual(cycleSwitched.auditions, beforeCycleSwitch.auditions, 'Changing a held imported sample back to a cycle keeps note ownership');
    assert(cycleSwitched.channels.every(channel => channel.waveform?.pcm?.length === 112), 'Switching back to a cycle restores editable PCM on all voices');
    const retunedPcm = await audible(page, 'Held imported sample to cycle retains pitch', keyboardHz);
    await field(page, 'reverb-send', false); await field(page, 'reverb-preset', 'room');
    assert((await current(page)).channels.every(channel=>channel.reverb),'Selecting Room enables all sends automatically');
    assert(await page.locator(control('reverb-send')).isChecked(),'The Enable reverb checkbox follows preset selection');
    await field(page, 'reverb-left', .3); await field(page, 'reverb-right', .3);
    const reverberant = await settled(page);
    assert(reverberant.channels.every(channel => channel.reverb === true), 'The common reverb send reaches every round-robin voice');
    assert.equal(reverberant.reverb.preset, 'room');
    assert.equal(reverberant.reverb.volumeLeft, .3); assert.equal(reverberant.reverb.volumeRight, .3);
    const reverbPcm = await audible(page, 'Shared SPU reverb');
    await field(page,'reverb-send',false);
    const bypassed=await current(page);
    assert(bypassed.channels.every(channel=>!channel.reverb));
    assert.deepEqual(bypassed.reverb,reverberant.reverb,'Manual bypass retains the selected preset and returns');
    await field(page,'reverb-send',true);
    assert.deepEqual((await current(page)).reverb,reverberant.reverb,'Re-enabling restores the same settings');
    await field(page,'reverb-preset','off');
    assert((await current(page)).channels.every(channel=>!channel.reverb),'Selecting Off disables every send');
    assert(!(await page.locator(control('reverb-send')).isChecked()));
    await field(page,'reverb-preset','room');
    await page.locator('#stopAudio').click(); const stopped = await silent(page, 'Stop all voices');
    await page.keyboard.up('y');

    const keyboardFocus=await checkKeyboardFocus(page,keyboardHz);
    const pmon=await checkPmon(page,keyboardHz,name);
    const noise=await checkNoise(page,name);
    const morph=await checkMorph(page,name);

    console.log(`CHECK ${name}: real audio failure / explicit user retry`);
    await page.evaluate(async () => {const context = [...__spuSynthAudit.contexts].reverse().find(value => value.state !== 'closed'); await context.close();});
    await page.waitForFunction(() => !document.getElementById('startAudio').disabled && /Enable audio/i.test(document.getElementById('startAudio').textContent));
    await page.locator('#startAudio').click();
    await page.waitForFunction(() => __spuSynthAudit.contexts.length === 2 && __spuSynthAudit.contexts.at(-1).state === 'running' && !document.getElementById('startAudio').disabled && /Audio ready/i.test(document.getElementById('startAudio').textContent));
    assert.equal(await page.locator('#instrumentName').inputValue(), 'Sine', 'A new audio session labels its actual fresh instrument');
    await page.waitForFunction(() => document.getElementById('sampleName').textContent.startsWith('Sine'));
    await hold(page); const recovery = await audible(page, 'Audio retry restores a real SPU voice', keyboardHz);
    await release(page); await silent(page, 'Recovered pointer release'); await page.locator('#stopAudio').click(); await silent(page, 'Recovered Stop');

    const screenshots = [], layouts = [];
    if (config.screenshots) await fs.mkdir(config.screenshots, {recursive:true});
    for (const [label, width, height] of [['desktop', 1440, 1100], ['mobile', 390, 844]]) {
      await page.setViewportSize({width, height});
      for (const [mode, editor] of [['envelope', 'pcm'], ['waveform', 'pcm'], ['spectrum', 'pcm'], ['envelope', 'adsr'], ['envelope', 'fx'], ['envelope', 'audio']]) {
        await monitorMode(page, mode); await editorTab(page, editor);
        const dimensions = await page.evaluate(() => {
          const plot = document.querySelector('.monitor-plot').getBoundingClientRect(), pitch = document.getElementById('pitchBend').getBoundingClientRect(), morph = document.getElementById('morphAmount').getBoundingClientRect();
          const bodyBackground = getComputedStyle(document.body).backgroundColor;
          return {viewport:innerWidth, document:document.documentElement.scrollWidth, plot:{left:plot.left, right:plot.right, top:plot.top, bottom:plot.bottom}, pitch:{left:pitch.left, right:pitch.right, top:pitch.top, bottom:pitch.bottom}, morph:{left:morph.left,right:morph.right,top:morph.top,bottom:morph.bottom}, background:bodyBackground === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.documentElement).backgroundColor : bodyBackground, bodyBackgroundImage:getComputedStyle(document.body).backgroundImage};
        });
        assert(dimensions.document <= dimensions.viewport + 1, 'SPU Synth fits ' + label + ': ' + JSON.stringify(dimensions));
        assert(dimensions.pitch.left >= dimensions.plot.right - 2, 'Pitch remains beside the ' + mode + ' display at ' + label + ': ' + JSON.stringify(dimensions));
        assert(dimensions.morph.left>dimensions.pitch.right,'Morph remains beside Pitch');
        assert(dimensions.morph.bottom-dimensions.morph.top>dimensions.morph.right-dimensions.morph.left,'Morph uses a vertical slider');
        assert(dimensions.plot.right-dimensions.plot.left>=100,'The monitor remains visible beside both sliders');
        assert(dimensions.pitch.bottom - dimensions.pitch.top > dimensions.pitch.right - dimensions.pitch.left, 'Pitch uses a vertical slider at ' + label);
        layouts.push({label, mode, editor, ...dimensions});
        if (config.screenshots) {const filename = path.join(config.screenshots, `${name}-spu-synth-${label}-${mode}-${editor}.png`); await page.screenshot({path:filename, fullPage:true}); screenshots.push({label, mode, editor, path:filename, ...dimensions});}
      }
    }
    const audit = await page.evaluate(() => ({worklets:__spuSynthAudit.worklets, processorErrors:__spuSynthAudit.processorErrors, physicalOutputMuted:[...__spuSynthAudit.sinks.values()].every(sink => sink.gate.gain.value === 0), captureContinuity:{captures:__spuSynthAudit.captures.length, frames:__spuSynthAudit.captures.reduce((sum, entry) => sum + entry.frames, 0), pcmContinuous:__spuSynthAudit.captures.every(entry => entry.pilot.continuous && entry.clock.measurementValid && entry.clock.frames === entry.frames), clockAnomalies:__spuSynthAudit.captures.filter(entry => !entry.clock.continuous)}}));
    assert(audit.worklets.includes('tetorica-spu-synth'), 'The dedicated real SPU AudioWorklet is used'); assert(audit.physicalOutputMuted); assert(audit.captureContinuity.pcmContinuous);
    assert.deepEqual(audit.processorErrors, []); assert.deepEqual(errors, [], 'No browser exceptions'); assert.deepEqual(failedResponses, [], 'No missing runtime assets');
    return {browser:name, version:browser.version(), brand, pmon, noise, morph, keyboardFocus, audioLazy:true, hardwareVoices:24, commonInstrument:true, editorSections:['PCM cycle → SPU ADPCM', 'ADSR envelope', 'SPU reverb'], editorTabs, idlePolling:false, monitor, pointer:{pcm:pointerPcm, release:pointerRelease}, graph:{before:beforeGraph.channels[0].envelopeParameters, after:afterGraph.channels[0].envelopeParameters, allVoicesUpdated:true}, keyboard:{note:keyboardNote, pcm:keyboardPcm}, pitch:{bent:bentPcm, centered:centeredPcm, gestureBend, gesturePcm, gestureCenteredPcm, recentersOnRelease:true, retriggered:false}, chord:{voices:3, pcm:chordPcm, pcAndPointerCoexist:true, checkboxFocusPlayable:true, allVoicesLiveUpdated:true, pitchRetriggered:false, sustainReleased}, roundRobin:{noteOns:ons, hardwareVoices:24, heldAfterSteal:allocated.auditions.length, staleKeyOffPreservedReplacement:true}, waveform:{allVoicesUpdated:true, heldSampleToCycleRetuned:true, retunedPcm}, sample:{name:'browser-sine.wav', bytes:wav.length, rootMidi:69, allVoicesUpdated:true, pcm:importedPcm}, preset:{schema:preset.schema, version:preset.version, bytes:presetBytes.length, roundTrip:true, allVoicesUpdated:true}, reverb:{preset:'room', allVoicesUpdated:true, pcm:reverbPcm}, stopped, recovery, layouts, screenshots, ...audit};
  } catch (error) {
    const state = await page.evaluate(() => ({title:document.title, status:document.getElementById('status')?.textContent, body:document.body?.innerText?.slice(0, 6000), contexts:__spuSynthAudit.contexts.map(context => ({state:context.state, sampleRate:context.sampleRate})), commands:__spuSynthAudit.commands.slice(-20), captures:__spuSynthAudit.captures.slice(-3)})).catch(() => null);
    throw Error(`${name}: ${error.message}\n${JSON.stringify({state, errors, failedResponses})}`, {cause:error});
  } finally {await context.close();}
}

(async () => {
  const helperPath = require.resolve('./audio_clock_audit.cjs'), checkerSha256 = hash(await fs.readFile(__filename)), captureHelperSha256 = hash(await fs.readFile(helperPath));
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/favicon.ico') {response.writeHead(204).end(); return;}
      if (pathname === '/__spu_synth_capture.js') {response.writeHead(200, {'Content-Type':'text/javascript', 'Cache-Control':'no-store'}).end(processorSource); return;}
      let filename = path.resolve(config.root, '.' + pathname); assert(filename === config.root || filename.startsWith(config.root + path.sep), 'Outside selected host');
      if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
      const bytes = await fs.readFile(filename), name = path.relative(config.root, filename), sha256 = hash(bytes);
      if (served.has(name)) assert.equal(served.get(name).sha256, sha256, 'Source changed during browser check: ' + name);
      served.set(name, {bytes:bytes.length, sha256});
      const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml', '.png':'image/png', '.woff':'font/woff', '.woff2':'font/woff2'};
      response.writeHead(200, {'Content-Type':mime[path.extname(filename)] ?? 'application/octet-stream', 'Cache-Control':'no-store'}).end(bytes);
    } catch (error) {response.writeHead(404).end(error.message);}
  });
  try {
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const results = [], origin = `http://127.0.0.1:${server.address().port}`;
    for (const name of config.engines) {
      const browser = await ({chromium, webkit})[name].launch({headless:true, ...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
      try {results.push(await runCase(browser, name, origin)); console.log(`PASS ${name}: standalone SPU Synth.`);} finally {await browser.close();}
    }
    for (const [name, entry] of served) assert.equal(hash(await fs.readFile(path.join(config.root, name))), entry.sha256, 'Source remained frozen: ' + name);
    assert.equal(hash(await fs.readFile(__filename)), checkerSha256, 'Checker stayed frozen throughout browser execution');
    assert.equal(hash(await fs.readFile(helperPath)), captureHelperSha256, 'Capture helper stayed frozen throughout browser execution');
    const report = {schemaVersion:1, passed:true, physicalOutputMuted:true, listeningPerformed:false, publicUiOnly:true, root:config.root, entry:config.entry, results, sources:Object.fromEntries([...served].sort(([a], [b]) => a.localeCompare(b))), checkerSha256, captureHelperSha256};
    if (config.out) await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
    console.log(`SPU Synth browser check passed: ${results.length} browsers${config.out ? '; ' + config.out : ''}.`);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error.stack ?? error); process.exitCode = 1;});
