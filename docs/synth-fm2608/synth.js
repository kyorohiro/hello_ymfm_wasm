// SPDX-License-Identifier: BSD-3-Clause
import {createDefaultPreset, readPreset, readFmPreset, FM_PRESETS, RHYTHM_NAMES, waveShape, decodeAdpcm, decodeBase64} from './preset.js?v=opna-sine-release-2';
import {createFm2608Audio} from './audio.js?v=opna-sine-release-2';
import {setupFm2608CodeHost} from './code_host.js?v=opna-output-menu-1';
import {setupFm2608SongControls} from './song_controls.js?v=opna-sine-release-2';
import {createParamControl, buildHeader, buildOperatorControls} from '../synth/synth_controls.js';
import {createOperatorEnvelopeView} from '../synth/synth_operator_envelope.js';
import {createSynthOutputVisualizer} from '../synth/synth_output_visualizer.js';
import {buildKeyboard, createFretboardLayout, createFretboardState, midiToNoteName} from '../synth/synth_keyboard.js';
import {parseTfi, createTfiFromPreset} from '../js/tfi.js';
import {parseVgi, createVgiFromPreset} from '../js/vgi.js';
import {noteToHz,opnPitchFromHz} from '../js/soundchip_pitch.js';

const byId = id => document.getElementById(id);
const sections = {fm:6, ssg:3, rhythm:6, adpcm:1};
const sectionNames = {fm:'FM', ssg:'SSG', rhythm:'Rhythm', adpcm:'ADPCM-B'};
const selection = {fm:'auto', ssg:'auto', rhythm:'auto', adpcm:0};
const controls = new Map(), operatorControls = new Map(), operatorGates = new Map();
const held = new Map(), pendingNotes = new Map(), owners = new Map();
const mute = {fm:Array(6).fill(false), ssg:Array(3).fill(false), rhythm:Array(6).fill(false), adpcm:[false]};
const nextChannel = {fm:0, ssg:0, rhythm:0, adpcm:0};
const fretboard = createFretboardState(), visualizer = createSynthOutputVisualizer();
const operatorDefinitions = [
  ['dt','DT',7,'pitch'], ['multi','MULT',15,'pitch'], ['tl','TL',127,'level'], ['rs','RS',3,'envelope'],
  ['ar','AR',31,'envelope'], ['am','AM',1,'modulation'], ['d1r','D1R',31,'envelope'], ['d2r','D2R',31,'envelope'],
  ['sl','SL',15,'envelope'], ['rr','RR',15,'envelope'], ['ssg','SSG-EG',15,'modulation'],
].map(([id,label,max,category]) => ({id,label,min:0,max,step:1,category,booleanMode:id==='am'}));
// Same operator routing expressions as FM2612 Synth. Operator numbers match
// the control rows and envelope guide colors.
const algorithmDescriptions = [
  'OP1 -> OP2 -> OP3 -> OP4 -> OUT',
  '(OP1 + OP2) -> OP3 -> OP4 -> OUT',
  '(OP1 + (OP2 -> OP3)) -> OP4 -> OUT',
  '((OP1 -> OP2) + OP3) -> OP4 -> OUT',
  '(OP1 -> OP2) + (OP3 -> OP4) -> OUT',
  '(OP1 -> OP2) + (OP1 -> OP3) + (OP1 -> OP4) -> OUT',
  '(OP1 -> OP2) + OP3 + OP4 -> OUT',
  'OP1 + OP2 + OP3 + OP4 -> OUT',
];

let settings = createDefaultPreset(), section = 'fm', audio = null, audioPending = null;
let host = null, songs = null, octave = 0, layout, pitch = 0, master = .7, visualMode = 'envelope';
let generation = 0, editQueue = Promise.resolve(), disposed = false, lastLive = 0;
let sampleData = '', sampleRange = '', referenceSampleKey = '', decodedSample = new Float32Array(), referenceSamples = new Float32Array();
let waveDraft = null, wavePointer = null, previousWavePoint = null;
let analyser = null, envelope = [], monitorFrame = null, sampleBusy = false;
let switchingAudioOutput = false, desktopOutputHandler = null;
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
function channelCount(kind) {
  return kind === 'fm' && songs?.isViewing() && songs.getState().sourceChip === 'ym2203' ? 3 : sections[kind];
}
function targets(kind = section) {
  return selection[kind] === 'auto' ? Array.from({length:channelCount(kind)}, (_,index) => index) : [selection[kind]];
}
function chip() {
  if (!audio || audio.context.state === 'closed') return null;
  return audio.getChip();
}
function live() {
  return Boolean(songs?.snapshot() || chip() && byId('liveUpdate').checked && section !== 'mixer' && selection[section] !== 'auto');
}
function fmSnapshot(channel) {
  const voice = songs?.snapshot()?.fm.channels[channel] ?? audio?.getFmState().channels[channel];
  const raw = voice?.preset;
  if (!raw) return settings.fm[channel];
  const keyMask = settings.fm[channel].keyMask === 0 && !songs?.isViewing() ? 0 :
    voice.selectedKeyMask ?? (voice.lastKeyMask || (settings.fm[channel].keyMask ?? 15));
  return readFmPreset({...raw,keyMask,
    operators:[1,2,3,4].map(operator => raw.operators[operator])});
}
function ssgSnapshot(channel) {
  const reference = songs?.snapshot()?.ssg.channels[channel];
  if (reference) return {tone:reference.tone,noise:reference.noise,volume:reference.volume,envelope:reference.envelope};
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
  const reference = songs?.snapshot()?.rhythm.voices[channel];
  if (reference) return reference;
  const current = chip();
  if (!current) return settings.rhythm.voices[channel];
  const value = current.rhythm.levels[channel];
  return {volume:value & 31,left:Boolean(value & 128),right:Boolean(value & 64)};
}
function adpcmSnapshot() {
  const reference = songs?.snapshot()?.adpcm;
  if (reference) return {...settings.adpcm,...reference,rootNote:Number(byId('songReferenceKey').value)};
  const current = chip();
  if (!current) return settings.adpcm;
  const registers = current.adpcm.registers;
  return {...settings.adpcm,volume:registers[11],left:Boolean(registers[1] & 128),right:Boolean(registers[1] & 64),
    repeat:registers[0] & 128 ? Boolean(registers[0] & 16) : settings.adpcm.repeat};
}
function adpcmPlaybackRate() {
  const reference = songs?.snapshot()?.adpcm;
  if (reference) return reference.sampleRate;
  const current = chip();
  if (!current) return settings.adpcm.sampleRate;
  const registers = current.adpcm.registers;
  return (registers[9] | registers[10] << 8) * current.clock / (144 * 65536);
}
function getSettings() {
  return chip() ? audio.capturePreset(settings) : readPreset(settings);
}

function channel3Snapshot() {
  return songs?.snapshot()?.channel3 ?? (live() && audio ? audio.getChannel3State() : settings.channel3);
}
function lfoSnapshot() {
  return songs?.snapshot()?.fm.lfo ?? (live() && audio ? audio.getFmState().lfo : settings.lfo);
}
function editChannel3(mutator) {
  const next = structuredClone(channel3Snapshot());
  mutator(next);
  return edit(value => { value.channel3 = next; },raw => {
    const running = raw.getChannel3State().running;
    raw.setChannel3Mode(next.mode,{timerA:next.timerA,running:next.mode === 'csm' && running});
    for (const [operator,frequency] of next.frequencies.entries()) {
      if (operator < 3) raw.setChannel3SpecialFrequency(operator,frequency.block,frequency.fnum);
      else raw.setBlockFnum(2,frequency.block,frequency.fnum);
    }
  });
}

function referenceSettings() {
  const snapshot = songs.snapshot(), result = structuredClone(settings);
  result.fm = result.fm.map((_,channel) => fmSnapshot(channel));
  result.lfo = {...snapshot.fm.lfo};
  result.channel3 = structuredClone(snapshot.channel3);
  result.ssg = {channels:result.ssg.channels.map((_,channel) => ssgSnapshot(channel)),
    noisePeriod:snapshot.ssg.noisePeriod,envelopePeriod:snapshot.ssg.envelopePeriod,envelopeShape:snapshot.ssg.envelopeShape};
  result.rhythm = {volume:snapshot.rhythm.volume,voices:snapshot.rhythm.voices.map(voice => ({...voice}))};
  for (const key of ['volume','left','right','repeat']) result.adpcm[key] = snapshot.adpcm[key];
  result.adpcm.rootNote = Number(byId('songReferenceKey').value);
  if (snapshot.adpcm.sampleRate > 0) result.adpcm.sampleRate = snapshot.adpcm.sampleRate;
  return readPreset(result);
}
function writeReferenceChannel3(next) {
  const raw = songs.getChip(), snapshot = songs.snapshot(), mode = snapshot.fm.modeRegister;
  const previous = snapshot.channel3;
  if (next.timerA !== previous.timerA) {
    raw.write(0,0x24,next.timerA >> 2);
    raw.write(0,0x25,next.timerA & 3);
  }
  for (const [operator,frequency] of next.frequencies.entries()) {
    if (frequency.block === previous.frequencies[operator].block && frequency.fnum === previous.frequencies[operator].fnum) continue;
    if (operator < 3) raw.setChannel3SpecialFrequency(operator,frequency.block,frequency.fnum);
    else raw.setBlockFnum(2,frequency.block,frequency.fnum);
  }
  const bits = next.mode === 'csm' ? 128 : next.mode === 'special' ? 64 : 0;
  const enteringCsm = next.mode === 'csm' && previous.mode !== 'csm';
  const heldNote = [...held.values()].some(note => note.source === 'song' && note.kind === 'fm' && note.channel === 2);
  const running = next.mode === 'csm' && (mode & 1 || snapshot.fm.channels[2].gate || heldNote);
  if (enteringCsm) raw.keyOff(2);
  if (next.mode !== previous.mode) raw.write(0,0x27,(mode & 14) | bits | (running ? 1 : 0));
}
function applyReferenceSettings(before,next) {
  const raw = songs.getChip(), snapshot = songs.snapshot();
  if (!raw) throw new Error('Pause or play the song before editing its channels.');
  const changed = (first,second) => JSON.stringify(first) !== JSON.stringify(second);
  for (let channel = 0; channel < 6; channel++) {
    const first = before.fm[channel], second = next.fm[channel], current = raw.channels[channel];
    if (first.algorithm !== second.algorithm || first.feedback !== second.feedback) {
      raw.setAlgo(channel,first.algorithm !== second.algorithm ? second.algorithm : current.algorithm,
        first.feedback !== second.feedback ? second.feedback : current.feedback);
    }
    if (changed(first.pan,second.pan) || first.ams !== second.ams || first.pms !== second.pms) {
      raw.setPan(channel,first.pan.left !== second.pan.left ? second.pan.left : current.left,
        first.pan.right !== second.pan.right ? second.pan.right : current.right,
        first.ams !== second.ams ? second.ams : current.ams,first.pms !== second.pms ? second.pms : current.pms);
    }
    for (let operator = 0; operator < 4; operator++) {
      const patch = Object.fromEntries(Object.entries(second.operators[operator]).filter(([key,value]) => value !== first.operators[operator][key]));
      if (Object.keys(patch).length) raw.setOperator(channel,operator,patch);
    }
    if (first.keyMask !== second.keyMask) songs.setKeyMask(channel,second.keyMask);
    if (first.keyMask !== second.keyMask && snapshot.fm.channels[channel].gate) {
      const mask = second.keyMask;
      if (mask) raw.keyOn(channel,[0,1,2,3].filter(operator => mask & (1 << operator)));
      else raw.keyOff(channel);
    }
  }
  if (changed(before.lfo,next.lfo)) raw.setLfo(next.lfo.enabled,next.lfo.frequency);
  if (changed(before.channel3,next.channel3)) writeReferenceChannel3(next.channel3);
  for (let channel = 0; channel < 3; channel++) {
    const first = before.ssg.channels[channel], second = next.ssg.channels[channel];
    const mixer = Object.fromEntries(['tone','noise'].filter(key => first[key] !== second[key]).map(key => [key,second[key]]));
    if (Object.keys(mixer).length) raw.ssg.setMixer(channel,mixer);
    if (first.volume !== second.volume || first.envelope !== second.envelope) {
      const level = raw.ssg._getState().levels[channel];
      raw.ssg.setVolume(channel,first.volume !== second.volume ? second.volume : level & 15,
        first.envelope !== second.envelope ? second.envelope : Boolean(level & 16));
    }
  }
  if (before.ssg.noisePeriod !== next.ssg.noisePeriod) raw.ssg.write(6,next.ssg.noisePeriod);
  if (before.ssg.envelopePeriod !== next.ssg.envelopePeriod) {
    raw.ssg.write(11,next.ssg.envelopePeriod & 255);
    raw.ssg.write(12,next.ssg.envelopePeriod >> 8);
  }
  if (before.ssg.envelopeShape !== next.ssg.envelopeShape) raw.ssg.write(13,next.ssg.envelopeShape);
  if (before.rhythm.volume !== next.rhythm.volume) raw.rhythm.setVolume(next.rhythm.volume);
  for (let channel = 0; channel < 6; channel++) {
    const patch = Object.fromEntries(['volume','left','right'].filter(key => before.rhythm.voices[channel][key] !== next.rhythm.voices[channel][key]).map(key => [key,next.rhythm.voices[channel][key]]));
    if (Object.keys(patch).length) raw.rhythm.setVoice(channel,patch);
  }
  if (before.adpcm.volume !== next.adpcm.volume) raw.adpcm.setVolume(next.adpcm.volume);
  if (before.adpcm.left !== next.adpcm.left || before.adpcm.right !== next.adpcm.right) {
    raw.adpcm.setPan(before.adpcm.left !== next.adpcm.left ? next.adpcm.left : Boolean(raw.adpcm.registers[1] & 128),
      before.adpcm.right !== next.adpcm.right ? next.adpcm.right : Boolean(raw.adpcm.registers[1] & 64));
  }
  if (before.adpcm.sampleRate !== next.adpcm.sampleRate) {
    raw.adpcm.setPlaybackRate(next.adpcm.sampleRate);
    for (const note of held.values()) if (note.source === 'song' && note.kind === 'adpcm') {
      const factor = 2 ** ((note.midi - Number(byId('songReferenceKey').value) + pitch) / 12);
      note.referenceRate = next.adpcm.sampleRate / factor;
    }
  }
  if (before.adpcm.rootNote !== next.adpcm.rootNote) setReferenceKey(next.adpcm.rootNote);
  if (before.adpcm.repeat !== next.adpcm.repeat) {
    raw.write(1,0,(raw.adpcm.registers[0] & ~16) | (next.adpcm.repeat ? 16 : 0));
  }
}
function setReferenceKey(value) {
  const select = byId('songReferenceKey');
  if (![...select.options].some(option => Number(option.value) === value)) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = midiToNoteName(value);
    select.append(option);
  }
  select.value = String(value);
  for (const note of held.values()) if (note.source === 'song' && note.kind === 'adpcm') referenceNoteOn(note,{retuneOnly:true});
}

async function applySettings(value, {isCurrent = () => true,selection:importedSelection} = {}) {
  let next = readPreset(value);
  await editQueue;
  if (!isCurrent()) return false;
  if (importedSelection) {
    const {section:kind,channel} = importedSelection;
    if (!Object.hasOwn(sections,kind) ||
      (channel !== 'auto' && (!Number.isInteger(channel) || channel < 0 || channel >= sections[kind])) ||
      (channel === 'auto' && sections[kind] === 1)) throw new Error('Invalid imported instrument channel');
    const merged = readPreset(settings);
    const groups = {fm:['fm','lfo','channel3'],ssg:['ssg'],rhythm:['rhythm'],adpcm:['adpcm']};
    for (const key of groups[kind]) merged[key] = next[key];
    if (kind === 'rhythm' && channel !== 'auto') {
      merged.rhythm.voices = settings.rhythm.voices.map((voice,index) =>
        index === channel ? next.rhythm.voices[index] : structuredClone(voice));
    }
    merged.name = next.name;
    next = readPreset(merged);
  }
  if (audio) await audio.applyPreset(next);
  if (!isCurrent()) return false;
  settings = next;
  songs?.setView('synth');
  byId('instrumentName').value = settings.name;
  byId('fmPreset').value = '';
  if (importedSelection) {
    selection[importedSelection.section] = importedSelection.channel;
    selectSection(importedSelection.section,{releaseNotes:false});
  }
  updateControls();
  renderSample();
  return true;
}
async function edit(mutator, forceWrite) {
  if (songs?.isViewing()) {
    if (!await songs.ensureEditable() || !songs.isViewing()) throw new DOMException('Song edit cancelled','AbortError');
    const before = referenceSettings(), next = structuredClone(before);
    mutator(next);
    const accepted = readPreset(next);
    applyReferenceSettings(before,accepted);
    songs.applyDisplayEdit(before,accepted);
    updateControls();
    return Promise.resolve(accepted);
  }
  const next = structuredClone(settings);
  mutator(next);
  settings = readPreset(next);
  if (!chip()) {
    try { host?.markSoundDirty(); } catch (error) { report(error); }
  }
  updateControls();
  const accepted = settings;
  const task = editQueue.then(async () => {
    if (!audio) return;
    await audio.applyPreset(accepted);
    forceWrite?.(audio.getChip());
    try { host?.markSoundDirty(); } catch (error) { report(error); }
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
      else if (key !== 'keyMask') raw.setPan(channel,key === 'left' ? value : voice.pan.left,key === 'right' ? value : voice.pan.right,key === 'ams' ? value : voice.ams,key === 'pms' ? value : voice.pms);
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
    controlsMap:operatorControls,gateControls:operatorGates,
    getOperatorEnabled:operator => Boolean((displayedFm().keyMask ?? 15) & (1 << (operator - 1))),
    onOperatorGateChange:(operator,enabled) => {
      const mask = displayedFm().keyMask ?? 15, bit = 1 << (operator - 1);
      editFm('keyMask',enabled ? mask | bit : mask & ~bit);
    },
    onChange:(operator,key,value) => editOperator(operator - 1,{[key]:value})});
  addControl('lfoControls','lfo.enabled','Enable',1,false,value => {
    const current = lfoSnapshot();
    edit(next => { next.lfo = {...current,enabled:value}; },raw => raw.setLfo(value,current.frequency)).catch(report);
  },true);
  addControl('lfoControls','lfo.frequency','Rate · 0–7',7,0,value => {
    const current = lfoSnapshot();
    edit(next => { next.lfo = {...current,frequency:value}; },raw => raw.setLfo(current.enabled,value)).catch(report);
  });
  addControl('channel3Timer','channel3.timerA','Timer A · 0–1023',1023,512,value => {
    editChannel3(next => { next.timerA = value; }).catch(report);
  });
  for (let operator = 0; operator < 4; operator++) {
    const row = document.createElement('div');
    row.id = 'channel3Frequency' + operator;
    row.className = 'opna-channel3-frequency';
    const label = document.createElement('h3');
    label.textContent = 'OP' + (operator + 1);
    label.className = 'op-color-' + (operator + 1);
    row.append(label);
    byId('channel3Frequencies').append(row);
    for (const [key,max] of [['block',7],['fnum',2047]]) {
      addControl(row.id,'channel3.' + operator + '.' + key,key === 'block' ? 'Block' : 'FNUM',max,0,value => {
        editChannel3(next => { next.frequencies[operator][key] = value; }).catch(report);
      });
    }
  }
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
    const reference = songs?.snapshot();
    const raw = reference ? songs.getChip() : chip();
    raw?.ssg.write(13,reference?.ssg.envelopeShape ?? settings.ssg.envelopeShape);
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
      if (songs?.isViewing() && !await songs.ensureEditable()) return;
      const raw = songs?.isViewing() ? songs.getChip() : engine.getChip();
      raw?.rhythm.keyOn(index);
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
          if (note) audio.setPitch(pitch);
          else raw.adpcm.setPlaybackRate(value);
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
        songs?.player.setChannelEnabled(kind,channel,!mute[kind][channel]);
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
  const routing = 'ALGO ' + fm.algorithm + ' ' + algorithmDescriptions[fm.algorithm] +
    (fm.feedback ? ' · OP1 feedback ' + fm.feedback : ' · FB off');
  const algorithm = byId('fmAlgorithm');
  if (algorithm.textContent !== routing) {
    algorithm.innerHTML = routing.replace(/OP([1-4])/g,'<span class="op-color-$1">OP$1</span>');
  }
  for (const key of ['algorithm','feedback','ams','pms']) setControl('fm.' + key,fm[key]);
  for (const key of ['left','right']) setControl('fm.' + key,fm.pan[key]);
  for (const [operator,values] of operatorControls) {
    for (const [key,control] of values) control.updateVisual(fm.operators[operator - 1][key]);
  }
  for (const [operator,button] of operatorGates) {
    button.setAttribute('aria-pressed',String(Boolean((fm.keyMask ?? 15) & (1 << (operator - 1)))));
    button.disabled = currentChannel() === 2 && channel3Snapshot()?.mode === 'csm';
  }
  const current = chip(), useLive = live();
  const reference = songs?.snapshot();
  const ssg = section === 'ssg' ? displayedSsg() : settings.ssg.channels[0];
  for (const key of ['tone','noise','volume','envelope']) setControl('ssg.' + key,ssg[key]);
  const sharedSsg = useLive && section === 'ssg' && !reference ? current.ssg.registers : null;
  setControl('ssg.noisePeriod',reference?.ssg.noisePeriod ?? (sharedSsg ? sharedSsg[6] & 31 : settings.ssg.noisePeriod));
  setControl('ssg.envelopePeriod',reference?.ssg.envelopePeriod ?? (sharedSsg ? sharedSsg[11] | sharedSsg[12] << 8 : settings.ssg.envelopePeriod));
  setControl('ssg.envelopeShape',reference?.ssg.envelopeShape ?? (sharedSsg ? sharedSsg[13] & 15 : settings.ssg.envelopeShape));
  const lfo = lfoSnapshot();
  setControl('lfo.enabled',lfo.enabled);
  setControl('lfo.frequency',lfo.frequency);
  setControl('rhythm.sharedVolume',reference?.rhythm.volume ?? (useLive && section === 'rhythm' ? audio.getRegisterState()[0][0x11] & 63 : settings.rhythm.volume));
  const rhythmChannel = section === 'rhythm' ? currentChannel() : 0;
  const rhythm = useLive && section === 'rhythm' ? rhythmSnapshot(rhythmChannel) : settings.rhythm.voices[rhythmChannel];
  for (const key of ['volume','left','right']) setControl('rhythm.' + key,rhythm[key]);
  const adpcm = useLive && section === 'adpcm' ? adpcmSnapshot() : settings.adpcm;
  controls.get('adpcm.sampleRate').element.querySelector('.param-label').textContent = reference ? 'Playback · Hz' : 'Base rate · Hz';
  controls.get('adpcm.rootNote').element.querySelector('.param-label').textContent = reference ? 'Reference · MIDI' : 'Root · MIDI';
  for (const key of ['rootNote','sampleRate','volume','left','right','repeat']) {
    setControl('adpcm.' + key,key === 'sampleRate' ? Math.round(adpcm[key]) : adpcm[key]);
  }
  const channel3 = channel3Snapshot();
  if (channel3) {
    byId('channel3Mode').value = channel3.mode;
    setControl('channel3.timerA',channel3.timerA);
    for (const [operator,frequency] of channel3.frequencies.entries()) {
      for (const key of ['block','fnum']) setControl('channel3.' + operator + '.' + key,frequency[key]);
    }
    byId('channel3Status').textContent = channel3.mode === 'normal' ? 'Normal FM · ' + channelCount('fm') + ' melodic channels.' :
      channel3.mode === 'csm' ? 'CH3 · Timer A ' + (channel3.running ? 'running' : 'starts on Key On') + ' · all four OPs trigger.' :
        'CH3 · four hardware frequencies · keyboard tuning preserves their ratios.';
    const auto = byId('channelTabs').querySelector('[data-channel="auto"]');
    if (section === 'fm' && auto) {
      auto.disabled = channel3.mode !== 'normal';
      if (auto.disabled && selection.fm === 'auto') {
        selection.fm = 2;
        renderChannelTabs();
      }
    }
  }
  byId('drawWave').disabled = Boolean(reference);
  byId('songReferenceKeyLabel').hidden = section !== 'adpcm';
  if (section === 'ssg') drawSsgEnvelope();
  envelopeView.invalidate();
  updateReadout();
}
function updateReadout() {
  if (section === 'mixer') {
    byId('channelReadout').textContent = 'Shared Keyboard / Code output';
    return;
  }
  const target = selection[section] === 'auto' ? 'Auto · ' + channelCount(section) + ' hardware channels' : 'CH' + (selection[section] + 1);
  const rate = section === 'adpcm' && chip() ? ' · Playback ' + Math.round(adpcmPlaybackRate()).toLocaleString() + ' Hz' : '';
  const source = songs?.isViewing() ? ' · ' + (songs.getState().playback === 'paused' ? 'Paused song' : byId('liveUpdate').checked ? 'Live from song' : 'Frozen song') : live() && host?.isRunning() ? ' · Live from Code' : '';
  byId('channelReadout').textContent = sectionNames[section] + ' · ' + target + source + rate;
  byId('keyboardHint').textContent = section === 'rhythm' ?
    'Rhythm · ' + (selection.rhythm === 'auto' ? 'Auto · key bindings shown on pads' : RHYTHM_NAMES[selection.rhythm] + ' · all note keys') :
    sectionNames[section] + ' · ' + target + ' · Pitch is software tuning';
}
function updateRhythmPadLabels() {
  if (!layout) return;
  const homeKeys = layout.entries.filter(entry => entry.rowIndex === 2).slice(-6);
  for (const pad of byId('rhythmPads').querySelectorAll('[data-rhythm-pad]')) {
    const voice = Number(pad.dataset.rhythmPad);
    const key = selection.rhythm === 'auto' ? homeKeys.find(entry => (entry.midi % 6 + 6) % 6 === voice)?.label :
      selection.rhythm === voice ? 'Any key' : '';
    pad.textContent = RHYTHM_NAMES[voice] + (key ? ' (' + key + ')' : '');
  }
}
function renderChannelTabs() {
  const root = byId('channelTabs');
  root.replaceChildren();
  byId('channelBar').hidden = section === 'mixer';
  if (section === 'mixer') return;
  const count = channelCount(section);
  if (selection[section] !== 'auto' && selection[section] >= count) selection[section] = 0;
  const choices = count > 1 ? ['auto',...Array.from({length:count},(_,index) => index)] : [0];
  for (const value of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role','tab');
    button.textContent = value === 'auto' ? 'Auto' : section === 'rhythm' ? RHYTHM_NAMES[value] : 'CH' + (value + 1);
    button.dataset.channel = String(value);
    button.setAttribute('aria-selected',String(selection[section] === value));
    button.tabIndex = selection[section] === value ? 0 : -1;
    button.disabled = section === 'fm' && value === 'auto' && channel3Snapshot()?.mode !== 'normal';
    button.addEventListener('click',() => {
      releaseKeyboard();
      selection[section] = value;
      renderChannelTabs();
      updateControls();
    });
    root.append(button);
  }
  if (section === 'rhythm') updateRhythmPadLabels();
}
function selectSection(value,{releaseNotes = true} = {}) {
  if (releaseNotes) releaseKeyboard();
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
  songs?.refresh();
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

async function prepareDesktopOutput(engine,enabled) {
  if (enabled && desktopOutputHandler) {
    const token = generation;
    const isCurrent = () => !disposed && token === generation && engine === audio;
    await desktopOutputHandler({context:engine.context,output:engine.outputNode},{isCurrent});
    if (!isCurrent()) throw new DOMException('Audio output preparation stopped','AbortError');
  }
  return engine;
}
async function ensureAudio({prepareOutput = true} = {}) {
  if (disposed || prepareOutput && switchingAudioOutput) throw new DOMException('Audio output is changing','AbortError');
  if (audio && audio.context.state !== 'closed') {
    await audio.context.resume();
    return prepareDesktopOutput(audio,prepareOutput);
  }
  if (audioPending) return prepareDesktopOutput(await audioPending,prepareOutput);
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
    updateOutputMixer();
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
  return prepareDesktopOutput(await pending,prepareOutput);
}
function allocateChannel(kind,midi) {
  if (kind === 'fm' && selection.fm === 'auto' && channel3Snapshot().mode !== 'normal') return 2;
  if (selection[kind] !== 'auto') return selection[kind];
  if (kind === 'rhythm') return ((midi % 6) + 6) % 6;
  const count = channelCount(kind);
  let channel = nextChannel[kind] % count;
  for (let index = 0; index < count; index++) {
    const candidate = (channel + index) % count;
    if (!owners.has(kind + ':' + candidate)) { channel = candidate; break; }
  }
  nextChannel[kind] = (channel + 1) % count;
  return channel;
}
async function press(id,midi) {
  if (switchingAudioOutput || section === 'mixer' || pendingNotes.has(id)) return;
  const request = {kind:section,midi,token:generation,source:songs?.isViewing() ? 'song' : 'synth'};
  pendingNotes.set(id,request);
  try {
    const engine = await ensureAudio();
    await editQueue;
    if (request.source === 'song' && !await songs.ensureEditable()) return;
    if (switchingAudioOutput || pendingNotes.get(id) !== request || request.token !== generation) return;
    const channel = allocateChannel(request.kind,midi), lane = request.kind + ':' + channel;
    const previous = owners.get(lane);
    const previousNote = previous ? held.get(previous) : null;
    if (previous) {
      held.delete(previous);
      pendingNotes.delete(previous);
    }
    owners.set(lane,id);
    held.set(id,{...request,channel,lane,referenceRate:previousNote?.referenceRate});
    if (request.source === 'song') referenceNoteOn(held.get(id));
    else await engine.noteOn(request.kind,channel,midi);
    if (pendingNotes.get(id) !== request || request.token !== generation) {
      if (owners.get(lane) === id) {
        if (request.source === 'song') referenceNoteOff(held.get(id)); else engine.noteOff(request.kind,channel);
        owners.delete(lane);
      }
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
    try {
      if (note.source === 'song') referenceNoteOff(note);
      else audio?.noteOff(note.kind,note.channel);
    } catch (error) { report(error); }
  }
  paintKeys();
}
function releaseKeyboard() {
  pendingNotes.clear();
  for (const id of [...held.keys()]) release(id);
}
function referenceNoteOn(note,{retuneOnly = false} = {}) {
  const raw = songs.getChip(), state = songs.getState(), snapshot = songs.snapshot();
  if (!raw || state.manualReady === false) throw new Error('Reference channel is preparing. Pause or play the song before auditioning.');
  const {kind,channel,midi} = note, hz = noteToHz(midi) * 2 ** (pitch / 12);
  note.referenceChip = raw;
  if (kind === 'fm') {
    const mode = snapshot.channel3;
    if (channel === 2 && mode.mode !== 'normal') {
      const base = mode.frequencies[3];
      const baseHz = base.fnum * raw.clock * 2 ** (base.block - 1) / (144 * 2 ** 20);
      for (const [operator,frequency] of mode.frequencies.entries()) {
        const sourceHz = frequency.fnum * raw.clock * 2 ** (frequency.block - 1) / (144 * 2 ** 20);
        const next = sourceHz === 0 ? {block:0,fnum:0} : baseHz > 0 ? opnPitchFromHz(sourceHz * hz / baseHz,raw.clock,144,{clamp:true}) : frequency;
        if (operator < 3) raw.setChannel3SpecialFrequency(operator,next.block,next.fnum);
        else raw.setBlockFnum(2,next.block,next.fnum);
      }
      if (mode.mode === 'csm') {
        if (!retuneOnly) {
          raw.keyOff(2);
          raw.write(0,0x24,mode.timerA >> 2);
          raw.write(0,0x25,mode.timerA & 3);
          raw.write(0,0x27,(snapshot.fm.modeRegister & 14) | 128 | 1);
        }
        return;
      }
    } else raw.setFrequency(channel,hz);
    if (!retuneOnly) {
      raw.keyOff(channel);
      const mask = fmSnapshot(channel).keyMask ?? 15;
      if (mask) raw.keyOn(channel,[0,1,2,3].filter(operator => mask & (1 << operator)));
    }
  } else if (kind === 'ssg') {
    raw.ssg.setFrequency(channel,hz);
    if (!retuneOnly) {
      const value = ssgSnapshot(channel);
      raw.ssg.setMixer(channel,value);
      raw.ssg.setVolume(channel,value.volume,value.envelope);
      if (value.envelope) raw.ssg.write(13,snapshot.ssg.envelopeShape);
    }
  } else if (kind === 'rhythm') { if (!retuneOnly) raw.rhythm.keyOn(channel); }
  else {
    if (!snapshot.adpcm.available) throw new Error(snapshot.adpcm.error || 'The selected song sample is unavailable for keyboard audition.');
    const registers = raw.adpcm.registers;
    if (note.referenceRate === undefined) note.referenceRate = (registers[9] | registers[10] << 8) * raw.clock / (144 * 65536);
    raw.adpcm.setPlaybackRate(Math.min(raw.clock / 144 * 65535 / 65536,
      note.referenceRate * hz / noteToHz(Number(byId('songReferenceKey').value))));
    if (!retuneOnly) raw.adpcm.keyOn({repeat:snapshot.adpcm.repeat});
  }
}
function referenceNoteOff(note) {
  const raw = note?.referenceChip;
  if (!raw) return;
  if (note.kind === 'fm') {
    const snapshot = songs?.snapshot();
    if (note.channel === 2 && snapshot?.channel3.mode === 'csm') raw.write(0,0x27,(snapshot.fm.modeRegister & 14) | 128);
    raw.keyOff(note.channel);
  } else if (note.kind === 'ssg') raw.ssg.keyOff(note.channel);
  else if (note.kind === 'rhythm') raw.rhythm.keyOff(note.channel);
  else {
    (raw.adpcm.noteOff ?? raw.adpcm.keyOff).call(raw.adpcm);
    if (note.referenceRate > 0) raw.adpcm.setPlaybackRate(note.referenceRate);
  }
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
  updateRhythmPadLabels();
}
function editableTarget(target) {
  return Boolean(target?.closest('textarea,input:not([type="range"]):not([type="checkbox"]):not([type="button"]):not([type="file"]),[contenteditable="true"],.monaco-editor'));
}
function updatePitch(value) {
  pitch = value;
  for (const id of ['pitchBend','keyboardPitchBend']) byId(id).value = String(value);
  for (const id of ['pitchValue','keyboardPitchValue']) byId(id).textContent = (value >= 0 ? '+' : '') + value.toFixed(2);
  try { audio?.setPitch(value); } catch (error) { report(error); }
  for (const note of held.values()) if (note.source === 'song') {
    try { referenceNoteOn(note,{retuneOnly:true}); } catch (error) { report(error); }
  }
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
function updateOutputMixer(mix = songs?.getState().outputMix) {
  if (!mix) return;
  for (const [key,id] of [['fm','Fm'],['ssg','Ssg']]) {
    byId('mixer' + id + 'Volume').value = String(mix[key]);
    byId('mixer' + id + 'Volume').dataset.boosted = String(mix[key] > 1);
    byId('mixer' + id + 'Value').textContent = Math.round(mix[key] * 100) + '%';
  }
  const multiplier = value => Number(value.toFixed(6)).toLocaleString('en-US',{maximumFractionDigits:6});
  byId('ym2203Mode').checked = mix.ym2203Mode;
  byId('mixerCorrection').textContent = (mix.ym2203Mode ? 'YM2203 correction · SSG ×0.75' : 'YM2203 correction Off') +
    (mix.volumeAdjustmentsApplied ? ' · VGM FM ×' + multiplier(mix.file.fm) + ' / SSG ×' + multiplier(mix.file.ssg) : '');
  byId('mixerEffective').textContent = 'Effective output · FM ×' + multiplier(mix.effective.fm) + ' · SSG ×' + multiplier(mix.effective.ssg);
  if (audio && audio.context.state !== 'closed') audio.setOutputGains(mix.effective);
}
async function stopAll() {
  generation++;
  releaseKeyboard();
  updatePitch(0);
  await host?.stop();
  await songs?.stop();
  await audio?.stopAll();
  status('All sound stopped.');
}

function refreshDecodedSample() {
  const reference = songs?.snapshot()?.adpcm;
  if (reference) {
    const key = [reference.memoryRevision,reference.start,reference.end,reference.available].join('/');
    if (key !== referenceSampleKey) {
      referenceSampleKey = key;
      referenceSamples = reference.available && reference.bytes instanceof Uint8Array ? decodeAdpcm(reference.bytes) : new Float32Array();
    }
    return referenceSamples;
  }
  const range = [settings.adpcm.address,settings.adpcm.start,settings.adpcm.end].join('/');
  if (sampleData !== settings.adpcm.data || sampleRange !== range) {
    sampleData = settings.adpcm.data;
    sampleRange = range;
    const bytes = decodeBase64(sampleData);
    decodedSample = decodeAdpcm(bytes.subarray(settings.adpcm.start - settings.adpcm.address,settings.adpcm.end - settings.adpcm.address));
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
  const reference = songs?.snapshot()?.adpcm, current = reference ?? settings.adpcm;
  const bytes = reference ? reference.end - reference.start : decodeBase64(settings.adpcm.data).length;
  byId('sampleInfo').textContent = samples.length.toLocaleString() + ' decoded frames · ' + bytes.toLocaleString() +
    ' ADPCM bytes · ' + (current.sampleRate > 0 ? (samples.length / current.sampleRate).toFixed(3) : '0.000') + ' s · Root ' +
    midiToNoteName(reference ? Number(byId('songReferenceKey').value) : current.rootNote) + ' · aligned range ' + current.start + '–' + current.end +
    (reference && !reference.available ? ' · ' + (reference.error || 'No uploaded sample in this range.') : '');
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
    songs?.setView('synth');
    const engine = await ensureAudio();
    await editQueue;
    settings = await engine.setWave(waveShape(shape,128),{rootNote:settings.adpcm.rootNote,generatedShape:shape});
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
    songs?.setView('synth');
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
  const rate = Math.max(1,Math.round(adpcmSnapshot().sampleRate));
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
  const shape = songs?.snapshot()?.ssg.envelopeShape ?? (live() && section === 'ssg' ? chip().ssg.registers[13] & 15 : settings.ssg.envelopeShape);
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
    if (live()) {
      updateControls();
      if (songs?.isViewing() && section === 'adpcm') renderSample();
    }
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
for (const [key,id] of [['fm','mixerFmVolume'],['ssg','mixerSsgVolume']]) {
  byId(id).addEventListener('input',event => {
    try { songs.player.setOutputMix({[key]:Number(event.target.value)}); }
    catch (error) { report(error); }
  });
}
byId('ym2203Mode').addEventListener('change',event => {
  try { songs.player.setOutputMix({ym2203Mode:event.target.checked}); }
  catch (error) { report(error); }
});
for (const id of ['pitchBend','keyboardPitchBend']) {
  byId(id).addEventListener('input',event => updatePitch(Number(event.target.value)));
  for (const type of ['pointerup','pointercancel','keyup','blur']) byId(id).addEventListener(type,() => updatePitch(0));
}
byId('octaveDown').addEventListener('click',() => { releaseKeyboard(); octave = Math.max(-2,octave - 1); renderKeyboard(); });
byId('octaveUp').addEventListener('click',() => { releaseKeyboard(); octave = Math.min(2,octave + 1); renderKeyboard(); });
for (const button of byId('chipTabs').querySelectorAll('[data-section]')) button.addEventListener('click',() => selectSection(button.dataset.section));
installTabKeys(byId('chipTabs'));
installTabKeys(byId('channelTabs'));
byId('liveUpdate').addEventListener('change',event => {
  songs?.setLiveEnabled(event.target.checked);
  updateControls();
});
byId('channel3Mode').addEventListener('change',event => {
  const mode = event.target.value;
  releaseKeyboard();
  if (mode !== 'normal') selection.fm = 2;
  run(async () => {
    await editChannel3(next => { next.mode = mode; });
    renderChannelTabs();
    updateControls();
  });
});
byId('songReferenceKey').addEventListener('change',event => {
  setReferenceKey(Number(event.target.value));
  updateControls();
  renderSample();
});
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
byId('importSongButton').addEventListener('click',() => byId('songFileInput').click());
byId('songFileInput').addEventListener('change',event => {
  const files = [...event.target.files];
  event.target.value = '';
  run(async () => {
    const paths = await host.files.importFiles(files);
    const path = paths.find(value => /\.(?:vgm|vgz|s98)$/i.test(value));
    if (path) await host.files.selectFile(path);
  });
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
  if (event.button !== 0 || songs?.isViewing() || !byId('drawWave').checked || sampleBusy || wavePointer !== null) return;
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
  stopKeyboard:releaseKeyboard,onActivity:updateReadout,setStatus:status,
  onSelectSong:file => songs.selectFile(file),onWorkspaceReplace:() => songs?.reset(),
  onBeforeRun:async () => { await songs?.stop(); }});
songs = setupFm2608SongControls({project:host.project,files:host.files,ensureAudio,getAudio:() => audio,getSettings,
  beforePlay:async () => { releaseKeyboard(); await host.stop(); },beforeTransport:releaseKeyboard,
  getSelection:() => ({section,channel:currentChannel()}),setStatus:status,
  onCapture:async preset => {
    releaseKeyboard();
    await applySettings(preset);
    host.markSoundDirty();
  },
  onStateChange:updateReadout,onOutputMixChange:updateOutputMixer,onViewChange:() => {
    releaseKeyboard();
    referenceSampleKey = '';
    renderChannelTabs();
    updateControls();
    renderSample();
  }});
updateOutputMixer();
host.ready.then(() => { updateControls(); renderSample(); }).catch(report);

// Desktop adapters route the final Master bus before playback starts. Keep
// device output and window controls outside the reusable browser sources.
const desktopLocation = window.location;
const localDesktop = desktopLocation && ((desktopLocation.protocol === 'tauri:' && desktopLocation.hostname === 'localhost') ||
  (['http:','https:'].includes(desktopLocation.protocol) && desktopLocation.hostname === 'tauri.localhost'));
if (window.top === window && localDesktop && window.__TAURI_INTERNALS__) {
  const output = engine => engine && engine.context.state !== 'closed' ? {context:engine.context,output:engine.outputNode} : null;
  Object.defineProperty(window,'tetoricaSynthAudio',{value:Object.freeze({
    getOutput() { return output(audio); },
    async ensureReady() { return output(await ensureAudio({prepareOutput:false})); },
    setSwitching(value) { switchingAudioOutput = value === true; },
    setOutputHandler(handler) {
      if (handler !== null && typeof handler !== 'function') throw new TypeError('Desktop output handler must be a function or null');
      desktopOutputHandler = handler;
    },
    stopPlayback:stopAll,
  })});
  window.dispatchEvent(new Event('tetorica-synth-ready'));
}
monitorFrame = requestAnimationFrame(drawOutput);
window.addEventListener('pagehide',event => {
  releaseKeyboard();
  if (event.persisted) return;
  disposed = true;
  generation++;
  cancelAnimationFrame(monitorFrame);
  envelopeView.dispose();
  visualizer.disconnect();
  void Promise.allSettled([host.dispose(),songs.dispose()]).finally(() => audio?.dispose()).catch(() => {});
});

