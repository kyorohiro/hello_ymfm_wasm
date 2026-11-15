// SPDX-License-Identifier: BSD-3-Clause
import {createDefaultPreset, readPreset, readFmPreset, FM_PRESETS, RHYTHM_NAMES, waveShape, decodeAdpcm, decodeBase64} from './preset.js';
import {createFm2608Audio} from './audio.js';
import {setupFm2608CodeHost} from './code_host.js';
import {createParamControl, buildHeader, buildOperatorControls} from '../synth/synth_controls.js';
import {createOperatorEnvelopeView} from '../synth/synth_operator_envelope.js';
import {createSynthOutputVisualizer} from '../synth/synth_output_visualizer.js';
import {buildKeyboard, createFretboardLayout, createFretboardState, midiToNoteName} from '../synth/synth_keyboard.js';
import {parseTfi, createTfiFromPreset} from '../js/tfi.js';
import {parseVgi, createVgiFromPreset} from '../js/vgi.js';

const byId = id => document.getElementById(id);
const sections = {fm:6, ssg:3, rhythm:6, adpcm:1};
const sectionNames = {fm:'FM', ssg:'SSG', rhythm:'Rhythm', adpcm:'ADPCM-B'};
const selection = {fm:'auto', ssg:'auto', rhythm:'auto', adpcm:0};
const controls = new Map(), operatorControls = new Map();
const held = new Map(), pendingNotes = new Map(), owners = new Map();
const mute = {fm:Array(6).fill(false), ssg:Array(3).fill(false), rhythm:Array(6).fill(false), adpcm:[false]};
const nextChannel = {fm:0, ssg:0, rhythm:0, adpcm:0};
const fretboard = createFretboardState(), visualizer = createSynthOutputVisualizer();
const operatorDefinitions = [
  ['dt','DT',7], ['multi','MULT',15], ['tl','TL',127], ['rs','RS',3],
  ['ar','AR',31], ['am','AM',1], ['d1r','D1R',31], ['d2r','D2R',31],
  ['sl','SL',15], ['rr','RR',15], ['ssg','SSG-EG',15],
].map(([id,label,max]) => ({id,label,min:0,max,step:1,booleanMode:id==='am'}));

let settings = createDefaultPreset(), section = 'fm', audio = null, audioPending = null;
let host = null, octave = 0, layout, pitch = 0, master = .7, visualMode = 'envelope';
let generation = 0, editQueue = Promise.resolve(), disposed = false, lastLive = 0;
let sampleData = '', decodedSample = new Float32Array(), waveDraft = null, wavePointer = null, previousWavePoint = null;
let analyser = null, envelope = [], monitorFrame = null, sampleBusy = false;
const monitorSamples = new Float32Array(2048);

function status(message, error = false) {
  byId('audioStatus').textContent = message;
  byId('audioStatus').dataset.error = String(error);
}
function report(error) {
  if (error?.name !== 'AbortError') status(error?.message ?? String(error), true);
}
function run(task) {
  Promise.resolve().then(task).catch(report);
}
function currentChannel() {
  return section === 'mixer' || selection[section] === 'auto' ? 0 : selection[section];
}
function targets(kind = section) {
  return selection[kind] === 'auto' ? Array.from({length:sections[kind]}, (_,index) => index) : [selection[kind]];
}
function chip() {
  if (!audio || audio.context.state === 'closed') return null;
  return audio.getChip();
}
function live() {
  return Boolean(chip() && byId('liveUpdate').checked && section !== 'mixer' && selection[section] !== 'auto');
}
function fmSnapshot(channel) {
  const raw = audio?.getFmState().channels[channel].preset;
  if (!raw) return settings.fm[channel];
  return readFmPreset({...raw,operators:[1,2,3,4].map(operator => raw.operators[operator])});
}
function ssgSnapshot(channel) {
  const ssg = chip()?.ssg;
  if (!ssg) return settings.ssg.channels[channel];
  const registers = ssg.registers, level = ssg._getState().levels[channel];
  return {tone:!(registers[7] & (1 << channel)),noise:!(registers[7] & (8 << channel)),
    volume:level & 16 ? settings.ssg.channels[channel].volume : level & 15,envelope:Boolean(level & 16)};
}
function displayedFm() {
  return live() ? fmSnapshot(currentChannel()) : settings.fm[section === 'fm' ? currentChannel() : 0];
}
function displayedSsg() {
  return live() ? ssgSnapshot(currentChannel()) : settings.ssg.channels[currentChannel()];
}
function rhythmSnapshot(channel) {
  const current = chip();
  if (!current) return settings.rhythm.voices[channel];
  const value = current.rhythm.levels[channel];
  return {volume:value & 31,left:Boolean(value & 128),right:Boolean(value & 64)};
}
function adpcmSnapshot() {
  const current = chip();
  if (!current) return settings.adpcm;
  const registers = current.adpcm.registers;
  return {...settings.adpcm,volume:registers[11],left:Boolean(registers[1] & 128),right:Boolean(registers[1] & 64),
    repeat:registers[0] & 128 ? Boolean(registers[0] & 16) : settings.adpcm.repeat};
}
function adpcmPlaybackRate() {
  const current = chip();
  if (!current) return settings.adpcm.sampleRate;
  const registers = current.adpcm.registers;
  return (registers[9] | registers[10] << 8) * current.clock / (144 * 65536);
}
function getSettings() {
  const result = structuredClone(settings), current = chip();
  if (current) {
    result.fm = result.fm.map((_,channel) => fmSnapshot(channel));
    result.lfo = {...audio.getFmState().lfo};
    result.ssg.channels = result.ssg.channels.map((_,channel) => ssgSnapshot(channel));
    const registers = current.ssg.registers;
    result.ssg.noisePeriod = registers[6] & 31;
    result.ssg.envelopePeriod = registers[11] | registers[12] << 8;
    result.ssg.envelopeShape = registers[13] & 15;
    result.rhythm.voices = result.rhythm.voices.map((_,channel) => {
      const value = current.rhythm.levels[channel];
      return {volume:value & 31,left:Boolean(value & 128),right:Boolean(value & 64)};
    });
    result.rhythm.volume = audio.getRegisterState()[0][0x11] & 63;
    result.adpcm.volume = current.adpcm.registers[11];
    result.adpcm.left = Boolean(current.adpcm.registers[1] & 128);
    result.adpcm.right = Boolean(current.adpcm.registers[1] & 64);
    const note = [...held.values()].find(item => item.kind === 'adpcm');
    const factor = note ? 2 ** ((note.midi - settings.adpcm.rootNote + pitch) / 12) : 1;
    const sampleRegisters = current.adpcm.registers;
    const delta = sampleRegisters[9] | sampleRegisters[10] << 8;
    const expected = Math.max(1,Math.min(65535,Math.round(settings.adpcm.sampleRate * factor * 144 * 65536 / current.clock)));
    if (delta > 0 && delta !== expected) result.adpcm.sampleRate = adpcmPlaybackRate() / factor;
    if (sampleRegisters[0] & 128) result.adpcm.repeat = Boolean(sampleRegisters[0] & 16);
  }
  return readPreset(result);
}

async function applySettings(value, {isCurrent = () => true} = {}) {
  const next = readPreset(value);
  await editQueue;
  if (!isCurrent()) return false;
  if (audio) await audio.applyPreset(next);
  if (!isCurrent()) return false;
  settings = next;
  byId('instrumentName').value = settings.name;
  byId('fmPreset').value = '';
  updateControls();
  renderSample();
  return true;
}
function edit(mutator, forceWrite) {
  const next = structuredClone(settings);
  mutator(next);
  settings = readPreset(next);
  host?.markSoundDirty();
  updateControls();
  const accepted = settings;
  const task = editQueue.then(async () => {
    if (!audio) return;
    await audio.applyPreset(accepted);
    forceWrite?.(audio.getChip());
  });
  editQueue = task.catch(report);
  return task;
}
function editFm(key, value) {
  const channels = targets('fm');
  edit(next => {
    for (const channel of channels) {
      if (live()) next.fm[channel] = fmSnapshot(channel);
      if (key === 'left' || key === 'right') next.fm[channel].pan[key] = value;
      else next.fm[channel][key] = value;
    }
  }, raw => {
    for (const channel of channels) {
      const voice = fmSnapshot(channel);
      if (key === 'algorithm' || key === 'feedback') raw.setAlgo(channel,key === 'algorithm' ? value : voice.algorithm,key === 'feedback' ? value : voice.feedback);
      else raw.setPan(channel,key === 'left' ? value : voice.pan.left,key === 'right' ? value : voice.pan.right,key === 'ams' ? value : voice.ams,key === 'pms' ? value : voice.pms);
    }
  }).catch(report);
  byId('fmPreset').value = '';
}
function editOperator(operator, patch) {
  const channels = targets('fm');
  edit(next => {
    for (const channel of channels) {
      if (live()) next.fm[channel] = fmSnapshot(channel);
      Object.assign(next.fm[channel].operators[operator],patch);
    }
  }, raw => {
    for (const channel of channels) raw.setOperator(channel,operator,patch);
  }).catch(report);
  byId('fmPreset').value = '';
}
function addControl(parent, key, label, max, value, onChange, booleanMode = false, min = 0) {
  const control = createParamControl({label,min,max,step:1,value,onChange,booleanMode});
  control.element.dataset.control = key;
  byId(parent).append(control.element);
  controls.set(key,control);
  return control;
}
function setControl(key, value) {
  controls.get(key)?.updateVisual(value);
}

function buildControls() {
  for (const [key,label,max,booleanMode] of [
    ['algorithm','ALGO',7,false],['feedback','FB',7,false],['ams','AMS',3,false],
    ['pms','PMS',7,false],['left','Left',1,true],['right','Right',1,true],
  ]) {
    addControl('fmCommonControls','fm.' + key,label,max,0,value => editFm(key,value),booleanMode);
  }
  buildHeader(byId('operatorHeader'),operatorDefinitions);
  buildOperatorControls({root:byId('operatorControls'),operatorNumbers:[1,2,3,4],defs:operatorDefinitions,
    operatorStates:Object.fromEntries(settings.fm[0].operators.map((value,index) => [index + 1,value])),
    controlsMap:operatorControls,onChange:(operator,key,value) => editOperator(operator - 1,{[key]:value})});
  addControl('lfoControls','lfo.enabled','Enable',1,false,value => {
    const current = live() ? audio.getFmState().lfo : settings.lfo;
    edit(next => { next.lfo = {...current,enabled:value}; },raw => raw.setLfo(value,current.frequency)).catch(report);
  },true);
  addControl('lfoControls','lfo.frequency','Rate · 0–7',7,0,value => {
    const current = live() ? audio.getFmState().lfo : settings.lfo;
    edit(next => { next.lfo = {...current,frequency:value}; },raw => raw.setLfo(current.enabled,value)).catch(report);
  });
  for (const [key,label,max,booleanMode] of [
    ['tone','Tone',1,true],['noise','Noise',1,true],['volume','Level · 0–15',15,false],['envelope','Envelope',1,true],
  ]) {
    addControl('ssgControls','ssg.' + key,label,max,0,value => {
      const channels = targets('ssg');
      edit(next => {
        for (const channel of channels) {
          if (live()) next.ssg.channels[channel] = ssgSnapshot(channel);
          next.ssg.channels[channel][key] = value;
        }
      },raw => {
        for (const channel of channels) {
          const current = ssgSnapshot(channel);
          if (key === 'tone' || key === 'noise') raw.ssg.setMixer(channel,{...current,[key]:value});
          else {
            const active = Boolean(raw.ssg.registers[8 + channel] & 31);
            raw.ssg.setVolume(channel,key === 'volume' ? value : settings.ssg.channels[channel].volume,key === 'envelope' ? value : current.envelope);
            if (!active) raw.ssg.keyOff(channel);
          }
        }
      }).catch(report);
    },booleanMode);
  }
  addControl('noiseControls','ssg.noisePeriod','Period · 0–31',31,16,value => {
    edit(next => { next.ssg.noisePeriod = value; },raw => raw.ssg.write(6,value)).catch(report);
  });
  addControl('ssgEnvelopeControls','ssg.envelopePeriod','Period · 0–65535',65535,512,value => {
    edit(next => { next.ssg.envelopePeriod = value; },raw => {
      raw.ssg.write(11,value & 255);
      raw.ssg.write(12,value >> 8);
    }).catch(report);
  });
  addControl('ssgEnvelopeControls','ssg.envelopeShape','Shape · 0–15',15,10,value => {
    edit(next => { next.ssg.envelopeShape = value; },raw => raw.ssg.write(13,value)).catch(report);
    drawSsgEnvelope();
  });
  const restart = document.createElement('button');
  restart.id = 'restartEnvelope';
  restart.type = 'button';
  restart.textContent = 'Restart envelope';
  restart.addEventListener('click',() => {
    chip()?.ssg.write(13,settings.ssg.envelopeShape);
  });
  byId('ssgEnvelopeControls').append(restart);
  addControl('rhythmSharedControls','rhythm.sharedVolume','Shared level · 0–63',63,48,value => {
    edit(next => { next.rhythm.volume = value; },raw => raw.rhythm.setVolume(value)).catch(report);
  });
  for (const [index,name] of RHYTHM_NAMES.entries()) {
    const pad = document.createElement('button');
    pad.type = 'button';
    pad.textContent = name;
    pad.dataset.rhythmPad = String(index);
    pad.addEventListener('click',() => run(async () => {
      const engine = await ensureAudio();
      await editQueue;
      engine.getChip().rhythm.keyOn(index);
      pad.classList.add('is-active');
      setTimeout(() => pad.classList.remove('is-active'),150);
    }));
    byId('rhythmPads').append(pad);
  }
  for (const [key,label,max,booleanMode] of [['volume','Level · 0–31',31,false],['left','Left',1,true],['right','Right',1,true]]) {
    addControl('rhythmControls','rhythm.' + key,label,max,0,value => {
      const channels = targets('rhythm');
      edit(next => {
        for (const channel of channels) {
          if (live()) next.rhythm.voices[channel] = rhythmSnapshot(channel);
          next.rhythm.voices[channel][key] = value;
        }
      },raw => {
        for (const channel of channels) raw.rhythm.setVoice(channel,{[key]:value});
      }).catch(report);
    },booleanMode);
  }
  for (const [key,label,max,booleanMode,min] of [
    ['rootNote','Root · MIDI',127,false,0],['sampleRate','Base rate · Hz',55554,false,1],
    ['volume','Level · 0–255',255,false,0],['left','Left',1,true,0],
    ['right','Right',1,true,0],['repeat','Repeat',1,true,0],
  ]) {
    addControl('adpcmControls','adpcm.' + key,label,max,0,value => {
      edit(next => { next.adpcm[key] = value; },raw => {
        if (key === 'volume') raw.adpcm.setVolume(value);
        if (key === 'left' || key === 'right') {
          const current = adpcmSnapshot();
          raw.adpcm.setPan(key === 'left' ? value : current.left,key === 'right' ? value : current.right);
        }
        if (key === 'sampleRate') {
          const note = [...held.values()].find(item => item.kind === 'adpcm');
          const rate = value * (note ? 2 ** ((note.midi - settings.adpcm.rootNote + pitch) / 12) : 1);
          raw.adpcm.setPlaybackRate(Math.min(55554,rate));
        }
        if (key === 'rootNote') audio.setPitch(pitch);
        if (key === 'repeat' && raw.adpcm.registers[0] & 128) raw.adpcm.keyOn({repeat:value});
      }).then(renderSample).catch(report);
    },booleanMode,min);
  }
  for (const [kind,count] of Object.entries(sections)) {
    const row = document.createElement('div');
    row.className = 'opna-mixer-row';
    const title = document.createElement('h3');
    title.textContent = sectionNames[kind];
    row.append(title);
    for (let channel = 0; channel < count; channel++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.mixerSection = kind;
      button.dataset.mixerChannel = String(channel);
      button.textContent = kind === 'rhythm' ? RHYTHM_NAMES[channel] : 'CH' + (channel + 1);
      button.setAttribute('aria-label',sectionNames[kind] + ' channel ' + (channel + 1) + ' output');
      button.setAttribute('aria-pressed','true');
      button.addEventListener('click',() => {
        mute[kind][channel] = !mute[kind][channel];
        audio?.setMute(kind,channel,mute[kind][channel]);
        button.setAttribute('aria-pressed',String(!mute[kind][channel]));
        button.textContent = (kind === 'rhythm' ? RHYTHM_NAMES[channel] : 'CH' + (channel + 1)) + (mute[kind][channel] ? ' · Muted' : '');
      });
      row.append(button);
    }
    byId('mixerControls').append(row);
  }
}

const envelopeView = createOperatorEnvelopeView({
  root:byId('fmEnvelope'),
  getOperators:() => Object.fromEntries(displayedFm().operators.map((value,index) => [index + 1,value])),
  getSelectionKey:() => selection.fm,
  onEdit:(operator,patch) => editOperator(operator - 1,patch),
});

function updateControls() {
  const fm = displayedFm();
  for (const key of ['algorithm','feedback','ams','pms']) setControl('fm.' + key,fm[key]);
  for (const key of ['left','right']) setControl('fm.' + key,fm.pan[key]);
  for (const [operator,values] of operatorControls) {
    for (const [key,control] of values) control.updateVisual(fm.operators[operator - 1][key]);
  }
  const current = chip(), useLive = live();
  const ssg = section === 'ssg' ? displayedSsg() : settings.ssg.channels[0];
  for (const key of ['tone','noise','volume','envelope']) setControl('ssg.' + key,ssg[key]);
  const sharedSsg = useLive && section === 'ssg' ? current.ssg.registers : null;
  setControl('ssg.noisePeriod',sharedSsg ? sharedSsg[6] & 31 : settings.ssg.noisePeriod);
  setControl('ssg.envelopePeriod',sharedSsg ? sharedSsg[11] | sharedSsg[12] << 8 : settings.ssg.envelopePeriod);
  setControl('ssg.envelopeShape',sharedSsg ? sharedSsg[13] & 15 : settings.ssg.envelopeShape);
  const lfo = useLive ? audio.getFmState().lfo : settings.lfo;
  setControl('lfo.enabled',lfo.enabled);
  setControl('lfo.frequency',lfo.frequency);
  setControl('rhythm.sharedVolume',useLive && section === 'rhythm' ? audio.getRegisterState()[0][0x11] & 63 : settings.rhythm.volume);
  const rhythmChannel = section === 'rhythm' ? currentChannel() : 0;
  const rhythm = useLive && section === 'rhythm' ? rhythmSnapshot(rhythmChannel) : settings.rhythm.voices[rhythmChannel];
  for (const key of ['volume','left','right']) setControl('rhythm.' + key,rhythm[key]);
  const adpcm = useLive && section === 'adpcm' ? adpcmSnapshot() : settings.adpcm;
  for (const key of ['rootNote','sampleRate','volume','left','right','repeat']) {
    setControl('adpcm.' + key,key === 'sampleRate' ? Math.round(adpcm[key]) : adpcm[key]);
  }
  if (section === 'ssg') drawSsgEnvelope();
  envelopeView.invalidate();
  updateReadout();
}
function updateReadout() {
  if (section === 'mixer') {
    byId('channelReadout').textContent = 'Shared Keyboard / Code output';
    return;
  }
  const target = selection[section] === 'auto' ? 'Auto · ' + sections[section] + ' hardware channels' : 'CH' + (selection[section] + 1);
  const rate = section === 'adpcm' && chip() ? ' · Playback ' + Math.round(adpcmPlaybackRate()).toLocaleString() + ' Hz' : '';
  byId('channelReadout').textContent = sectionNames[section] + ' · ' + target + (live() && host?.isRunning() ? ' · Live from Code' : '') + rate;
  byId('keyboardHint').textContent = section === 'rhythm' ? 'Rhythm keys trigger the six fixed voices.' : sectionNames[section] + ' · ' + target + ' · Pitch is software tuning';
}
function renderChannelTabs() {
  const root = byId('channelTabs');
  root.replaceChildren();
  byId('channelBar').hidden = section === 'mixer';
  if (section === 'mixer') return;
  const choices = sections[section] > 1 ? ['auto',...Array.from({length:sections[section]},(_,index) => index)] : [0];
  for (const value of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role','tab');
    button.textContent = value === 'auto' ? 'Auto' : section === 'rhythm' ? RHYTHM_NAMES[value] : 'CH' + (value + 1);
    button.dataset.channel = String(value);
    button.setAttribute('aria-selected',String(selection[section] === value));
    button.tabIndex = selection[section] === value ? 0 : -1;
    button.addEventListener('click',() => {
      releaseKeyboard();
      selection[section] = value;
      renderChannelTabs();
      updateControls();
    });
    root.append(button);
  }
}
function selectSection(value) {
  releaseKeyboard();
  section = value;
  for (const button of byId('chipTabs').querySelectorAll('[data-section]')) {
    const selected = button.dataset.section === section;
    button.setAttribute('aria-selected',String(selected));
    button.tabIndex = selected ? 0 : -1;
    byId('panel-' + button.dataset.section).hidden = !selected;
  }
  envelopeView.setVisible?.(section === 'fm');
  renderChannelTabs();
  updateControls();
  if (section === 'ssg') drawSsgEnvelope();
  if (section === 'adpcm') renderSample();
}
function installTabKeys(root) {
  root.addEventListener('keydown',event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const buttons = [...root.querySelectorAll('[role="tab"]')], index = buttons.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].click();
    root.querySelectorAll('[role="tab"]')[next]?.focus();
  });
}

async function ensureAudio() {
  if (audio && audio.context.state !== 'closed') {
    await audio.context.resume();
    return audio;
  }
  if (audioPending) return audioPending;
  const token = generation;
  byId('startAudio').disabled = true;
  status('Preparing OPNA…');
  const pending = createFm2608Audio({volume:master,onError:error => {
    report(error);
    byId('startAudio').textContent = 'Enable audio';
  }}).then(async engine => {
    if (disposed || token !== generation) {
      await engine.dispose();
      throw new DOMException('Audio preparation stopped','AbortError');
    }
    await engine.applyPreset(settings);
    if (disposed || token !== generation) {
      await engine.dispose();
      throw new DOMException('Audio preparation stopped','AbortError');
    }
    audio = engine;
    for (const [kind,values] of Object.entries(mute)) values.forEach((muted,index) => engine.setMute(kind,index,muted));
    visualizer.connect(engine.context,[engine.outputNode]);
    analyser = engine.context.createAnalyser();
    analyser.fftSize = monitorSamples.length;
    engine.outputNode.connect(analyser);
    byId('startAudio').textContent = 'Audio ready';
    status('OPNA ready · play the keyboard or Run Code.');
    return engine;
  }).finally(() => {
    if (audioPending === pending) audioPending = null;
    byId('startAudio').disabled = false;
  });
  audioPending = pending;
  return pending;
}
function allocateChannel(kind,midi) {
  if (selection[kind] !== 'auto') return selection[kind];
  if (kind === 'rhythm') return ((midi % 6) + 6) % 6;
  const count = sections[kind];
  let channel = nextChannel[kind];
  for (let index = 0; index < count; index++) {
    const candidate = (channel + index) % count;
    if (!owners.has(kind + ':' + candidate)) { channel = candidate; break; }
  }
  nextChannel[kind] = (channel + 1) % count;
  return channel;
}
async function press(id,midi) {
  if (section === 'mixer' || pendingNotes.has(id)) return;
  const request = {kind:section,midi,token:generation};
  pendingNotes.set(id,request);
  try {
    const engine = await ensureAudio();
    await editQueue;
    if (pendingNotes.get(id) !== request || request.token !== generation) return;
    const channel = allocateChannel(request.kind,midi), lane = request.kind + ':' + channel;
    const previous = owners.get(lane);
    if (previous) {
      held.delete(previous);
      pendingNotes.delete(previous);
    }
    owners.set(lane,id);
    held.set(id,{...request,channel,lane});
    await engine.noteOn(request.kind,channel,midi);
    if (pendingNotes.get(id) !== request || request.token !== generation) {
      if (owners.get(lane) === id) { engine.noteOff(request.kind,channel); owners.delete(lane); }
      held.delete(id);
    }
    paintKeys();
  } catch (error) {
    pendingNotes.delete(id);
    held.delete(id);
    for (const [lane,owner] of owners) if (owner === id) owners.delete(lane);
    paintKeys();
    throw error;
  }
}
function release(id) {
  pendingNotes.delete(id);
  const note = held.get(id);
  if (!note) return;
  held.delete(id);
  if (owners.get(note.lane) === id) {
    owners.delete(note.lane);
    try { audio?.noteOff(note.kind,note.channel); } catch (error) { report(error); }
  }
  paintKeys();
}
function releaseKeyboard() {
  pendingNotes.clear();
  for (const id of [...held.keys()]) release(id);
}
function paintKeys() {
  const active = new Set([...held.values()].map(note => note.midi));
  for (const button of byId('keyboard').querySelectorAll('[data-key]')) {
    const entry = layout.entries.find(value => value.key === button.dataset.key);
    button.classList.toggle('is-active',Boolean(entry && active.has(entry.midi)));
  }
}
function renderKeyboard() {
  layout = createFretboardLayout({state:fretboard,octave,clock:8000000,divider:144});
  buildKeyboard({root:byId('keyboard'),rowDefs:layout.rowDefs,layoutEntries:layout.entries,showPitch:false,
    onPointerDown:(event,entry) => press('pointer:' + event.pointerId,entry.midi).catch(report),
    onPointerUp:event => release('pointer:' + event.pointerId),
    onPointerCancel:event => release('pointer:' + event.pointerId)});
  byId('octaveValue').textContent = (octave >= 0 ? '+' : '') + octave;
}
function editableTarget(target) {
  return Boolean(target?.closest('textarea,input:not([type="range"]):not([type="checkbox"]):not([type="button"]):not([type="file"]),[contenteditable="true"],.monaco-editor'));
}
function updatePitch(value) {
  pitch = value;
  for (const id of ['pitchBend','keyboardPitchBend']) byId(id).value = String(value);
  for (const id of ['pitchValue','keyboardPitchValue']) byId(id).textContent = (value >= 0 ? '+' : '') + value.toFixed(2);
  try { audio?.setPitch(value); } catch (error) { report(error); }
}
function updateMaster(value) {
  master = value;
  for (const id of ['masterVolume','monitorVolume']) {
    byId(id).value = String(value);
    byId(id).dataset.boosted = String(value > 1);
  }
  for (const id of ['masterVolumeValue','monitorVolumeValue']) byId(id).textContent = Math.round(value * 100) + '%';
  try { audio?.setMasterVolume(value); } catch (error) { report(error); }
}
async function stopAll() {
  generation++;
  releaseKeyboard();
  updatePitch(0);
  await host?.stop();
  await audio?.stopAll();
  status('All sound stopped.');
}

function refreshDecodedSample() {
  if (sampleData !== settings.adpcm.data) {
    sampleData = settings.adpcm.data;
    decodedSample = decodeAdpcm(sampleData);
  }
  return waveDraft ?? decodedSample;
}
function renderSample() {
  const samples = refreshDecodedSample(), canvas = byId('waveCanvas'), context = canvas.getContext('2d');
  context.fillStyle = '#14232b';
  context.fillRect(0,0,canvas.width,canvas.height);
  context.strokeStyle = '#36525a';
  context.lineWidth = 1;
  for (let row = 1; row < 4; row++) {
    const y = canvas.height * row / 4;
    context.beginPath(); context.moveTo(0,y); context.lineTo(canvas.width,y); context.stroke();
  }
  context.strokeStyle = '#76e1cb';
  context.lineWidth = 1.7;
  context.beginPath();
  const stride = Math.max(1,Math.floor(samples.length / canvas.width));
  for (let x = 0; x < canvas.width; x++) {
    const first = Math.floor(x * samples.length / canvas.width);
    let value = samples[first] ?? 0;
    for (let index = first; index < Math.min(samples.length,first + stride); index++) {
      if (Math.abs(samples[index]) > Math.abs(value)) value = samples[index];
    }
    const y = (1 - value) * canvas.height / 2;
    if (x === 0) context.moveTo(x,y); else context.lineTo(x,y);
  }
  context.stroke();
  const bytes = decodeBase64(settings.adpcm.data).length;
  byId('sampleInfo').textContent = samples.length.toLocaleString() + ' decoded frames · ' + bytes.toLocaleString() +
    ' ADPCM bytes · ' + (samples.length / settings.adpcm.sampleRate).toFixed(3) + ' s · Root ' +
    midiToNoteName(settings.adpcm.rootNote) + ' · aligned range 0–' + bytes;
}
function wavePoint(event) {
  const rect = byId('waveCanvas').getBoundingClientRect();
  return {index:Math.max(0,Math.min(decodedSample.length - 1,Math.round((event.clientX - rect.left) / rect.width * (decodedSample.length - 1)))),
    value:Math.max(-1,Math.min(1,1 - (event.clientY - rect.top) / rect.height * 2))};
}
function drawWavePoint(event) {
  const point = wavePoint(event), previous = previousWavePoint ?? point;
  const length = Math.abs(point.index - previous.index);
  for (let step = 0; step <= length; step++) {
    const progress = length ? step / length : 0;
    const index = Math.round(previous.index + (point.index - previous.index) * progress);
    waveDraft[index] = previous.value + (point.value - previous.value) * progress;
  }
  previousWavePoint = point;
  renderSample();
}
async function finishWave(event) {
  if (wavePointer !== event.pointerId) return;
  drawWavePoint(event);
  const samples = waveDraft;
  wavePointer = null;
  waveDraft = null;
  previousWavePoint = null;
  sampleBusy = true;
  try {
    const engine = await ensureAudio();
    settings = await engine.setWave(samples,{rootNote:settings.adpcm.rootNote,sampleRate:settings.adpcm.sampleRate});
    host.markSoundDirty();
    updateControls();
  } finally { sampleBusy = false; renderSample(); }
}
async function generateWave(shape) {
  if (sampleBusy) return;
  sampleBusy = true;
  try {
    const engine = await ensureAudio();
    await editQueue;
    settings = await engine.setWave(waveShape(shape,128),{rootNote:settings.adpcm.rootNote});
    host.markSoundDirty();
    updateControls();
    renderSample();
    status('Software ' + shape + ' wave encoded as OPNA ADPCM-B.');
  } finally { sampleBusy = false; }
}
async function importAudio(file) {
  if (!file || sampleBusy) return;
  sampleBusy = true;
  try {
    const engine = await ensureAudio();
    await editQueue;
    const result = await engine.loadAudio(new Uint8Array(await file.arrayBuffer()));
    settings = result;
    host.markSoundDirty();
    selectSection('adpcm');
    status('Loaded ' + file.name + ' as ADPCM-B. Play the keyboard.');
  } finally { sampleBusy = false; }
}
function download(name,data,type) {
  const url = URL.createObjectURL(new Blob([data],{type}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_');
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
function exportFm(format) {
  const voice = section === 'fm' ? displayedFm() : settings.fm[0];
  const preset = {...voice,operators:Object.fromEntries(voice.operators.map((value,index) => [index + 1,value]))};
  download(settings.name + '.' + format,format === 'tfi' ? createTfiFromPreset(preset) : createVgiFromPreset(preset),'application/octet-stream');
}
function exportWave() {
  const samples = refreshDecodedSample(), data = new ArrayBuffer(44 + samples.length * 2), view = new DataView(data);
  const ascii = (offset,text) => [...text].forEach((character,index) => view.setUint8(offset + index,character.charCodeAt(0)));
  ascii(0,'RIFF'); view.setUint32(4,data.byteLength - 8,true); ascii(8,'WAVE'); ascii(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  const rate = Math.round(settings.adpcm.sampleRate);
  view.setUint32(24,rate,true); view.setUint32(28,rate * 2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true); ascii(36,'data'); view.setUint32(40,samples.length * 2,true);
  for (let index = 0; index < samples.length; index++) view.setInt16(44 + index * 2,Math.round(Math.max(-1,Math.min(1,samples[index])) * 32767),true);
  download(settings.name + '.wav',data,'audio/wav');
}
async function importSound(file) {
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.tfi$|\.vgi$/i.test(file.name)) {
    const parsed = /\.tfi$/i.test(file.name) ? parseTfi(bytes) : parseVgi(bytes);
    const fm = readFmPreset({...parsed,operators:parsed.operators.length === 5 ? parsed.operators.slice(1) : parsed.operators});
    await edit(next => {
      for (const channel of targets('fm')) next.fm[channel] = structuredClone(fm);
    });
    selectSection('fm');
    byId('fmPreset').value = '';
    status('Loaded FM sound from ' + file.name);
    return;
  }
  await applySettings(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  host.markSoundDirty();
  status('Loaded OPNA settings from ' + file.name);
}

function drawSsgEnvelope() {
  const canvas = byId('ssgEnvelopeCanvas'), context = canvas.getContext('2d');
  const shape = live() && section === 'ssg' ? chip().ssg.registers[13] & 15 : settings.ssg.envelopeShape;
  context.fillStyle = '#14232b'; context.fillRect(0,0,canvas.width,canvas.height);
  context.strokeStyle = '#76e1cb'; context.lineWidth = 2; context.beginPath();
  for (let x = 0; x < canvas.width; x++) {
    const position = x / canvas.width * 4, cycle = Math.floor(position), phase = position - cycle;
    let attack = Boolean(shape & 4), value;
    if (cycle && !(shape & 8)) value = 0;
    else if (cycle && shape & 1) value = attack !== Boolean(shape & 2) ? 1 : 0;
    else {
      if (shape & 2 && cycle % 2) attack = !attack;
      value = attack ? phase : 1 - phase;
    }
    const y = 10 + (1 - value) * (canvas.height - 20);
    if (!x) context.moveTo(x,y); else context.lineTo(x,y);
  }
  context.stroke();
}
function drawOutput() {
  monitorFrame = requestAnimationFrame(drawOutput);
  if (disposed || document.hidden) return;
  const canvas = byId('outputCanvas'), context = canvas.getContext('2d');
  if (visualMode !== 'envelope') visualizer.draw(canvas,context,visualMode);
  else {
    monitorSamples.fill(0);
    analyser?.getFloatTimeDomainData(monitorSamples);
    const rms = Math.sqrt(monitorSamples.reduce((sum,value) => sum + value * value,0) / monitorSamples.length);
    envelope.push(rms);
    if (envelope.length > 160) envelope.shift();
    context.fillStyle = '#14232b'; context.fillRect(0,0,canvas.width,canvas.height);
    context.strokeStyle = '#36525a'; context.fillStyle = '#b7cbd0'; context.font = '11px sans-serif';
    for (let row = 0; row <= 4; row++) {
      const y = 14 + row * (canvas.height - 36) / 4;
      context.beginPath(); context.moveTo(40,y); context.lineTo(canvas.width - 12,y); context.stroke();
      context.fillText(String(-row * 22.5),2,y + 4);
    }
    context.strokeStyle = '#76e1cb'; context.lineWidth = 2; context.beginPath();
    for (const [index,value] of envelope.entries()) {
      const decibels = value > 0 ? Math.max(-90,20 * Math.log10(value)) : -90;
      const x = 40 + index / 159 * (canvas.width - 52), y = 14 + -decibels / 90 * (canvas.height - 36);
      if (!index) context.moveTo(x,y); else context.lineTo(x,y);
    }
    context.stroke();
    context.fillText('dBFS · recent output RMS',40,canvas.height - 6);
  }
  if (performance.now() - lastLive > 120) {
    lastLive = performance.now();
    if (live()) updateControls();
  }
}

buildControls();
renderKeyboard();
renderChannelTabs();
updateControls();
renderSample();
drawSsgEnvelope();
envelopeView.setVisible(true);
updateMaster(master);

for (const [key,voice] of Object.entries(FM_PRESETS)) {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = voice.label;
  byId('fmPreset').append(option);
}
const placeholder = document.createElement('option');
placeholder.value = ''; placeholder.textContent = 'Custom'; placeholder.disabled = true;
byId('fmPreset').prepend(placeholder);
byId('fmPreset').value = 'two-op-bell';
byId('instrumentName').value = settings.name;
byId('fmPreset').addEventListener('change',event => {
  const selected = event.target.value;
  const voice = readFmPreset(FM_PRESETS[selected]);
  edit(next => {
    for (const channel of targets('fm')) next.fm[channel] = structuredClone(voice);
  }).then(() => { byId('fmPreset').value = selected; }).catch(report);
  event.target.blur();
});
byId('instrumentName').addEventListener('change',event => {
  const name = event.target.value.trim();
  if (!name) { event.target.value = settings.name; return; }
  edit(next => { next.name = name; }).catch(report);
});
byId('startAudio').addEventListener('click',() => run(ensureAudio));
byId('stopAudio').addEventListener('click',() => run(stopAll));
for (const id of ['masterVolume','monitorVolume']) byId(id).addEventListener('input',event => updateMaster(Number(event.target.value)));
for (const id of ['pitchBend','keyboardPitchBend']) {
  byId(id).addEventListener('input',event => updatePitch(Number(event.target.value)));
  for (const type of ['pointerup','pointercancel','keyup','blur']) byId(id).addEventListener(type,() => updatePitch(0));
}
byId('octaveDown').addEventListener('click',() => { releaseKeyboard(); octave = Math.max(-2,octave - 1); renderKeyboard(); });
byId('octaveUp').addEventListener('click',() => { releaseKeyboard(); octave = Math.min(2,octave + 1); renderKeyboard(); });
for (const button of byId('chipTabs').querySelectorAll('[data-section]')) button.addEventListener('click',() => selectSection(button.dataset.section));
installTabKeys(byId('chipTabs'));
installTabKeys(byId('channelTabs'));
byId('liveUpdate').addEventListener('change',updateControls);
for (const button of document.querySelectorAll('[data-visual-mode]')) button.addEventListener('click',() => {
  visualMode = button.dataset.visualMode;
  for (const item of document.querySelectorAll('[data-visual-mode]')) item.setAttribute('aria-pressed',String(item === button));
  byId('visualizerDescription').textContent = visualMode === 'envelope' ? 'Live output level after Master volume.' : 'Live ' + visualMode + ' after Master volume.';
});
document.addEventListener('pointerdown',event => {
  if (event.button === 0 && event.target.closest('button') && !event.target.closest('dialog,.monaco-editor')) {
    if (editableTarget(document.activeElement)) document.activeElement.blur();
    event.preventDefault();
  }
  if (!byId('synthMenu').contains(event.target)) byId('synthMenu').open = false;
});
document.addEventListener('change',event => {
  if (event.target.matches('select,input[type="checkbox"]')) event.target.blur();
});
document.addEventListener('keydown',event => {
  if (event.ctrlKey || event.metaKey || event.altKey || editableTarget(event.target) || document.querySelector('dialog[open]')) return;
  const entry = layout.entries.find(value => value.key === event.key.toLowerCase());
  if (!entry) return;
  event.preventDefault();
  if (event.repeat) return;
  if (event.target instanceof HTMLSelectElement) event.target.blur();
  run(() => press('key:' + entry.key,entry.midi));
},true);
document.addEventListener('keyup',event => {
  const key = event.key.toLowerCase();
  if (pendingNotes.has('key:' + key) || held.has('key:' + key)) {
    event.preventDefault();
    release('key:' + key);
  }
},true);
window.addEventListener('blur',releaseKeyboard);
document.addEventListener('visibilitychange',() => { if (document.hidden) releaseKeyboard(); });

byId('importSoundButton').addEventListener('click',() => byId('soundFileInput').click());
for (const id of ['importAudioButton','loadAudioButton']) byId(id).addEventListener('click',() => byId('audioFileInput').click());
byId('soundFileInput').addEventListener('change',event => {
  const file = event.target.files[0]; event.target.value = ''; run(() => importSound(file));
});
byId('audioFileInput').addEventListener('change',event => {
  const file = event.target.files[0]; event.target.value = ''; run(() => importAudio(file));
});
byId('exportSoundButton').addEventListener('click',() => {
  const preset = getSettings();
  download(preset.name + '.opna.json',JSON.stringify(preset,null,2) + '\n','application/json');
});
byId('exportTfiButton').addEventListener('click',() => exportFm('tfi'));
byId('exportVgiButton').addEventListener('click',() => exportFm('vgi'));
byId('saveWaveButton').addEventListener('click',exportWave);
for (const button of document.querySelectorAll('[data-wave-shape]')) button.addEventListener('click',() => run(() => generateWave(button.dataset.waveShape)));
byId('drawWave').addEventListener('change',event => byId('waveCanvas').classList.toggle('is-editable',event.target.checked));
byId('waveCanvas').addEventListener('pointerdown',event => {
  if (event.button !== 0 || !byId('drawWave').checked || sampleBusy || wavePointer !== null) return;
  event.preventDefault();
  waveDraft = Float32Array.from(refreshDecodedSample());
  wavePointer = event.pointerId;
  previousWavePoint = null;
  event.target.setPointerCapture(event.pointerId);
  drawWavePoint(event);
});
byId('waveCanvas').addEventListener('pointermove',event => {
  if (event.pointerId === wavePointer) drawWavePoint(event);
});
byId('waveCanvas').addEventListener('pointerup',event => run(() => finishWave(event)));
byId('waveCanvas').addEventListener('pointercancel',() => {
  wavePointer = null; waveDraft = null; previousWavePoint = null; renderSample();
});
byId('synthMenu').addEventListener('click',event => {
  if (event.target.closest('button')) byId('synthMenu').open = false;
});

host = setupFm2608CodeHost({ensureAudio,getAudio:() => audio,getSettings,applySettings,
  stopKeyboard:releaseKeyboard,onActivity:updateReadout,setStatus:status});
host.ready.then(() => { updateControls(); renderSample(); }).catch(report);
monitorFrame = requestAnimationFrame(drawOutput);
window.addEventListener('pagehide',event => {
  releaseKeyboard();
  if (event.persisted) return;
  disposed = true;
  generation++;
  cancelAnimationFrame(monitorFrame);
  envelopeView.dispose();
  visualizer.disconnect();
  void host.dispose().finally(() => audio?.dispose()).catch(() => {});
});

