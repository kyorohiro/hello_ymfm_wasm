import {createYm2151Audio} from '../js/playground_ym2151_audio.js';
import {createYm2151RegisterClient} from '../js/playground_ym2151.js';
import {Ym2151VoiceInspector} from '../js/playground_ym2151_inspector.js';
import {createPlaygroundYm2151VoicePanel} from '../playground/playground_ym2151_voice_panel.js';
import {createParamControl} from '../synth/synth_controls.js';
import {createFretboardLayout,createFretboardState,buildKeyboard} from '../synth/synth_keyboard.js';
import {createSynthOutputVisualizer} from '../synth/synth_output_visualizer.js';
import {displaySample} from './sample-view.js';
import {setupFiles} from './files.js';
import {createKit,samples} from './kit.js';

const $ = id => document.getElementById(id);
const status = message => { $('status').textContent = message; };
const fail = error => status(error.message ?? String(error));
const scope = createSynthOutputVisualizer({trace:'#a5df69',waveformMinRange:.04});
let audio, starting, context, dirty = true, mode = 'waveform', worker, runId = 0;
let sampleRom = createKit(), rawOki = [];
const voiceMutes = Array(4).fill(false);
const muteButtons = [];
const keyMasks = Array(8).fill(15);
const inspector = new Ym2151VoiceInspector({dispatch({method,args}) {
  if (method === 'writeRegister') opm.writeRegister(...args);
  if (method === 'forceKeyOff') opm.keyOff(args[0]);
  if (method === 'auditionKeyOn') opm.keyOn(args[0]);
}});
const opm = createYm2151RegisterClient((method,args) => {
  if (method !== 'writeRegister') throw Error('Unsupported OPM command');
  inspector.observeWrite(...args);
  audio?.fm.port.postMessage({method,args});
  dirty = true;
});
const keyOn = opm.keyOn;
opm.keyOn = (ch,mask=keyMasks[ch]) => keyOn(ch,mask);
const panel = createPlaygroundYm2151VoicePanel({root:$('fm'),createOperatorControl:createParamControl,invoke(method,args) {
  if (method === 'auditionOn') startAudio().catch(fail);
  return inspector.invoke(method,args);
},onError:fail});
panel.setConnected(true);
for (let ch=0;ch<8;ch++) {
  opm.setPan(ch,true,true);
  opm.setAlgo(ch,4,2);
  for (let op=0;op<4;op++) opm.setOperator(ch,op,{
    mul:[2,1,3,1][op],tl:[38,26,46,31][op],ar:31,d1r:8,d1l:5,d2r:2,rr:9,
  });
}

async function startAudio() {
  if (audio) {await context.resume();return;}
  if (starting) return starting;
  starting = (async () => {
    context = new AudioContext();
    let fm;
    try {
      await context.resume();
      const master = context.createGain();
      master.gain.value = Number($('master').value)/100;
      await context.audioWorklet.addModule(new URL('./oki-worklet.js',import.meta.url));
      fm = await createYm2151Audio(context,master);
      const pcm = new AudioWorkletNode(context,'cps1-oki',{numberOfInputs:0,outputChannelCount:[2]});
      pcm.port.onmessage = ({data}) => showBusy(data);
      pcm.connect(master); master.connect(context.destination);
      scope.connect(context,[master]);
      audio = {fm,pcm,master};
      const state = inspector.read();
      const writes = [];
      state.registers.forEach((value,r) => {
        if (r >= 0x0f && r !== 0x19) writes.push([r,value]);
      });
      writes.push([0x19,state.lfo.amDepth],[0x19,128|state.lfo.pmDepth]);
      state.channels.forEach(({channel,keyMask}) => {if (keyMask) writes.push([8,channel|(keyMask<<3)]);});
      fm.port.postMessage(writes.map(args => ({method:'writeRegister',args})));
      pcm.port.postMessage({rom:sampleRom});
      pcm.port.postMessage({voiceMutes});
      if (rawOki.length) pcm.port.postMessage({commands:rawOki});
      rawOki = [];
      $('power').disabled = true; $('power').textContent = 'Audio on'; status('Audio ready');
    } catch (error) {
      fm?.dispose(); audio = null; rawOki = [];
      await context.close(); throw error;
    } finally {starting = null;}
  })();
  return starting;
}
$('power').onclick = () => startAudio().catch(fail);
$('master').oninput = () => {
  $('volume').value = $('master').value+'%';
  if (audio) audio.master.gain.setTargetAtTime(Number($('master').value)/100,context.currentTime,.01);
};
$('scopeMode').onclick = () => {
  mode = mode === 'waveform' ? 'spectrum' : 'waveform';
  $('scopeMode').textContent = mode === 'waveform' ? 'Waveform' : 'Spectrum';
};
const canvas = $('scope'), ctx = canvas.getContext('2d');
new ResizeObserver(([entry]) => {
  canvas.width = Math.max(1,Math.round(entry.contentRect.width));
  canvas.height = Math.max(1,Math.round(entry.contentRect.height));
}).observe(canvas);
function draw() {
  if (dirty) {panel.update(inspector.read()); dirty = false;}
  scope.draw(canvas,ctx,mode);
  requestAnimationFrame(draw);
}
draw();
for (const tab of document.querySelectorAll('[data-tab]')) tab.onclick = () => {
  for (const button of document.querySelectorAll('[data-tab]')) {
    $(button.dataset.tab).hidden = button !== tab;
    button.setAttribute('aria-pressed',String(button === tab));
  }
  panel.setVisible(tab.dataset.tab === 'fm');
};

const hex = n => '0x'+n.toString(16).toUpperCase().padStart(2,'0');
function limit(value,max,name) {
  if (!Number.isInteger(value) || value<0 || value>max) throw RangeError(name+' must be 0–'+max);
  return value;
}
function write(...bytes) {
  bytes.forEach(b => limit(b,255,'Command'));
  if (audio) audio.pcm.port.postMessage({commands:bytes}); else rawOki.push(...bytes);
  $('command').value = bytes.map(hex).join(' ');
}
const oki = {
  write:byte => write(byte),
  play(voice,sample,attenuation=2) {
    write(128|limit(sample,127,'Sample'), (16<<limit(voice,3,'Voice'))|limit(attenuation,15,'Attenuation'));
  },
  stop(voice) {write(8<<limit(voice,3,'Voice'));},
  setVoiceMuted(voice,muted) {
    limit(voice,3,'Voice');
    if (typeof muted !== 'boolean') throw TypeError('Muted must be true or false');
    voiceMutes[voice] = muted;
    muteButtons[voice].setAttribute('aria-pressed',String(muted));
    audio?.pcm.port.postMessage({voiceMutes});
  },
};
function showBusy(value) {
  $('busy').value = hex(value);
  document.querySelectorAll('.lamp').forEach((lamp,i) => {
    const active = Boolean(value & (1<<i));
    lamp.textContent = 'Voice '+(i+1)+(active?' ●':' ○');
    lamp.classList.toggle('on',active);
  });
}
function updateSampleView() {
  displaySample($('sampleWave'),$('sampleRange'),sampleRom,Number($('sample').value));
}
$('sample').onchange = updateSampleView;
function chooseSamples(names) {
  $('sample').replaceChildren(...names.map((name,i) => new Option(i+' · '+name,i)));
  updateSampleView();
}
chooseSamples(samples);
for (let i=0;i<4;i++) {
  const row = document.createElement('div'); row.className = 'bar';
  const lamp = document.createElement('output'); lamp.className = 'lamp';
  const play = document.createElement('button'); play.textContent = 'Play';
  play.onclick = () => {try {
    const sample = Number($('sample').value), attenuation = $('attenuation').valueAsNumber;
    oki.play(i,sample,attenuation); startAudio().catch(fail);
  } catch (error) {fail(error);}};
  const stop = document.createElement('button'); stop.textContent = 'Stop'; stop.onclick = () => oki.stop(i);
  const mute = document.createElement('button');
  mute.textContent = 'Mute'; mute.setAttribute('aria-label','Mute Voice '+(i+1));
  mute.setAttribute('aria-pressed','false');
  mute.onclick = () => oki.setVoiceMuted(i,!voiceMutes[i]);
  muteButtons.push(mute);
  row.append(lamp,play,stop,mute); $('voices').append(row);
}
showBusy(0xf0);
let romRevision = 0;
function installRom(bytes,names,label) {
  romRevision++; sampleRom = bytes; rawOki = [];
  audio?.pcm.port.postMessage({rom:bytes}); chooseSamples(names); $('romName').textContent = label;
}
$('rom').onchange = async () => {
  const file = $('rom').files[0], revision = ++romRevision;
  if (!file) return;
  try {
    if (file.size < 8 || file.size > 0x40000) throw Error('Choose a single MSM6295 ROM bank (8 bytes to 256 KiB).');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (revision === romRevision) files.addBank(bytes,Array(128).fill('ROM sample'),file.name);
  } catch (error) {fail(error);}
};
$('restore').onclick = () => {romRevision++; $('rom').value=''; files.restoreKit();};

const layout = createFretboardLayout({state:createFretboardState()});
const held = new Map();
function press(id,entry) {
  if (held.has(id)) return;
  const ch = panel.getSelectedChannel();
  held.set(id,ch); inspector.invoke('auditionOn',[ch,entry.midi,id]); startAudio().catch(fail);
}
function release(id) {
  if (held.has(id)) inspector.invoke('auditionOff',[held.get(id),id]);
  held.delete(id);
}
buildKeyboard({root:$('keys'),rowDefs:layout.rowDefs,layoutEntries:layout.entries,showPitch:false,
  onPointerDown:(e,entry) => press('pointer'+e.pointerId,entry),
  onPointerUp:e => release('pointer'+e.pointerId),onPointerCancel:e => release('pointer'+e.pointerId)});
window.addEventListener('keydown',e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('textarea,input,select,[contenteditable=true]')) return;
  const entry = layout.entries.find(v => v.key === e.key.toLowerCase());
  if (entry) {e.preventDefault();press(e.code,entry);}
});
window.addEventListener('keyup',e => release(e.code));
window.addEventListener('blur',() => {for (const id of held.keys()) release(id);});

const example = `// OPM channels 0–7, OKI voices 0–3. Sleep is in seconds.
for (const note of ['C3', 'G3', 'Bb3', 'C4']) {
  opm.noteOn(0, note);
  oki.play(0, 0, 2);
  await sleep(0.18);
  opm.keyOff(0);
  oki.play(1, 1, 4);
  await sleep(0.18);
}`;
const entryPath = '/index.js', roundPath = '/examples/round-start.js';
const scripts = new Map([[entryPath,example]]);
const storageKey = path => path === entryPath ? 'cps1.code' : 'cps1.round-start';
for (const path of [entryPath,roundPath]) {
  try {
    const saved = localStorage.getItem(storageKey(path));
    if (saved !== null) scripts.set(path,saved);
  } catch {}
}
let activePath = entryPath, openRequest = 0;
$('editor').value = scripts.get(activePath);
function saveScript(path,text) {
  scripts.set(path,text);
  try {localStorage.setItem(storageKey(path),text);} catch {}
}
$('editor').oninput = () => saveScript(activePath,$('editor').value);
async function roundSource() {
  if (!scripts.has(roundPath)) {
    const response = await fetch(new URL('./examples/round-start.js',import.meta.url));
    if (!response.ok) throw Error('Could not load Round Start ('+response.status+')');
    const source = await response.text();
    if (!scripts.has(roundPath)) scripts.set(roundPath,source);
  }
  return scripts.get(roundPath);
}
async function openScript(path) {
  const request = ++openRequest;
  try {
    if (path === roundPath) await roundSource();
    if (request !== openRequest) return;
    activePath = path; $('codeFile').value = path; $('editor').value = scripts.get(path);
    document.querySelector('[data-tab="code"]').click();
  } catch (error) {if (request === openRequest) {$('codeFile').value=activePath; fail(error);}}
}
$('codeFile').onchange = () => openScript($('codeFile').value);
$('openCode').onclick = () => openScript(entryPath);
$('openRoundStart').onclick = () => openScript(roundPath);
function stopRun() {
  runId++; worker?.terminate(); worker = null;
  panel.releaseAll(); held.clear();
  for (let ch=0;ch<8;ch++) opm.keyOff(ch);
  write(0x78);
}
$('stop').onclick = () => {stopRun();status('Stopped');};
$('run').onclick = async () => {
  stopRun(); const id = runId;
  try {
    const source = $('editor').value;
    await startAudio(); if (id !== runId) return;
    worker = new Worker(new URL('./code-worker.js',import.meta.url),{type:'module'});
    status('Running');
    worker.onmessage = ({data}) => {
      if (id !== runId) return;
      try {
        if (data.error) throw Error(data.error);
        if (data.done) {worker.terminate();worker=null;status('Finished');return;}
        const api = data.chip === 'opm' ? opm : oki;
        api[data.method](...data.args);
      } catch (error) {stopRun();fail(error);}
    };
    worker.onerror = event => {stopRun();fail(event.message);};
    worker.postMessage(source);
  } catch (error) {stopRun();fail(error);}
};

const files = setupFiles({inspector,panel,keyMasks,defaultBank:{bytes:sampleRom,names:samples,name:'Original kit'},
  applyBank:installRom,getCode:() => scripts.get(entryPath),getRoundSource:roundSource,
  setCode:(value,round) => {
    openRequest++;
    saveScript(entryPath,value);
    if (round !== undefined) saveScript(roundPath,round);
    else {
      scripts.delete(roundPath);
      try {localStorage.removeItem(storageKey(roundPath));} catch {}
    }
    activePath=entryPath; $('codeFile').value=entryPath; $('editor').value=value;
  },stop:stopRun});
