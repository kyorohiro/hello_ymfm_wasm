// SPDX-License-Identifier: BSD-3-Clause
import {createFm2608SongPlayer} from './song_player.js?v=opna-pcm-release-1';
import {captureFm2608SongPreset} from './song_state.js';

const songPath = path => /^\/vgm\/.*\.(?:vgm|vgz|s98)$/i.test(path);
const timeLabel = seconds => {
  const value = Math.max(0,Math.floor(seconds || 0));
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2,'0');
};

/** Keep project files and the reference transport independent of Code edits. */
export function setupFm2608SongControls({project,files,ensureAudio,getAudio,
  beforePlay = async () => {},getSettings,onCapture,onViewChange = () => {},onStateChange = () => {},onOutputMixChange = () => {},
  beforeTransport = () => {},
  getSelection,setStatus = () => {},document:doc = globalThis.document} = {}) {
  const node = id => doc.getElementById(id);
  let disposed = false, selectedPath = '', sourceData = null, view = 'synth';
  let loading = false, operation = 0, optionsSignature = '', state = null, lastPlayback = 'stopped', seekDraft = false;
  const selectedMasks = new Map();
  let frozenSnapshot = null;
  let editingPreparation = null;
  let outputMixSignature = '';
  const listeners = [];
  const listen = (target,type,callback) => {
    target.addEventListener(type,callback);
    listeners.push(() => target.removeEventListener(type,callback));
  };
  const report = error => {
    if (error?.name !== 'AbortError') setStatus(error?.message ?? String(error),true);
  };
  const run = task => void Promise.resolve().then(task).catch(report);
  const player = createFm2608SongPlayer({getAudio,beforePlay:async ({manualPreparation=false}={}) => {
    selectedMasks.clear();
    frozenSnapshot = null;
    // Preparing a finished channel for the current input must keep that
    // pending keyboard attack. Explicit playback changes use the normal owner
    // handoff, which releases keys and stops Code before starting a song.
    if (!manualPreparation) await beforePlay();
    await ensureAudio();
  },onState:next => {
    state = next;
    const mixSignature = JSON.stringify(next.outputMix);
    if (mixSignature !== outputMixSignature) {
      outputMixSignature = mixSignature;
      onOutputMixChange(next.outputMix);
    }
    if (next.playback !== lastPlayback) {
      lastPlayback = next.playback;
      if (['playing','paused','ended'].includes(lastPlayback)) setStatus('Reference song ' + lastPlayback + ' · ' + next.name);
    }
    render();
    if (view === 'song') onStateChange();
  },onStatus:message => setStatus(message,true)});

  function currentState() { return state ?? player.getState(); }
  function render() {
    if (disposed) return;
    const current = currentState(), playback = current.playback ?? current.state;
    node('referenceSong').dataset.playback = playback;
    node('referenceSong').dataset.manualReady = String(Boolean(current.manualReady));
    const loaded = Boolean(selectedPath && sourceData);
    const compatibility = loaded && current.compatibility;
    node('referenceSong').dataset.sourceChip = loaded ? current.sourceChip ?? 'ym2608' : '';
    node('songCompatibility').hidden = !compatibility;
    node('songCompatibilityInfo').hidden = !compatibility;
    if (compatibility) {
      const clock = value => (value / 1000000).toLocaleString('en-US',{maximumFractionDigits:6}) + ' MHz';
      const detail = 'YM2203 ' + clock(compatibility.sourceClock) + ' → YM2608 ' + clock(compatibility.targetClock) +
        '. FM CH1–3 and SSG use YM2608 compatibility playback. Pitch and timing follow the source. ' +
        'Use YM2203 mode in Mixer to apply the SSG ×0.75 correction and this file’s additional volume settings. ' +
        'The OPNA FM DAC model applies to compatibility playback.';
      node('songCompatibility').title = detail;
      node('songCompatibilityInfo').textContent = detail;
    }
    node('songPlay').disabled = !loaded || loading || playback === 'playing' || playback === 'seeking';
    node('songPlay').textContent = playback === 'paused' ? 'Resume' : 'Play';
    node('songPause').disabled = playback !== 'playing';
    node('songStop').disabled = !['playing','paused','seeking'].includes(playback);
    node('songControls').hidden = !loaded;
    node('songCapture').disabled = !snapshot() || current.busy || current.preparingAudition || getSelection().section === 'mixer';
    const position = current.positionSeconds ?? 0, duration = current.durationSeconds ?? 0;
    const seek = node('songSeek');
    seek.max = String(Math.max(1,duration));
    seek.disabled = !duration || loading || playback === 'seeking';
    if (!seekDraft) seek.value = String(position);
    node('songTime').textContent = timeLabel(position) + ' / ' + timeLabel(duration);
    node('songView').value = view;
    node('songReferenceKeyLabel').hidden = getSelection().section !== 'adpcm';
    const message = loading || playback === 'starting' ? 'Preparing reference song…' : current.seeking ? 'Seeking · ' + Math.round(current.seekProgress * 100) + '%' : current.errorMessage || (current.preparingAudition ? 'Preparing paused channels…' : '') ||
      (loaded ? (playback === 'paused' ? 'Paused · audition or capture a channel.' :
        playback === 'playing' ? 'Playing · ' + (view === 'song' ? 'Song channels' : 'Your sound') : 'Ready · ' + selectedPath) : '');
    node('songStatus').hidden = !message;
    node('songStatus').textContent = message;
  }
  function refreshFiles() {
    if (disposed) return;
    const entries = project.fs.list().filter(file => file.type === 'binary' && songPath(file.path));
    const signature = JSON.stringify(entries.map(file => [file.path,file.revision]));
    if (signature === optionsSignature) return;
    optionsSignature = signature;
    const placeholder = doc.createElement('option');
    placeholder.value = '';
    placeholder.textContent = entries.length ? 'Choose a song…' : 'Import VGM / S98…';
    const options = entries.map(file => {
      const option = doc.createElement('option');
      option.value = file.path;
      option.textContent = file.path.slice('/vgm/'.length);
      option.title = file.path;
      return option;
    });
    node('songSelect').replaceChildren(placeholder,...options);
    node('songSelect').disabled = !entries.length;
    const current = entries.find(file => file.path === selectedPath);
    if (!current && selectedPath) {
      operation++;
      selectedPath = '';
      sourceData = null;
      setView('synth');
      run(() => player.clear());
    }
    node('songSelect').value = selectedPath;
    render();
  }
  async function selectFile({path,data}) {
    if (disposed) return false;
    if (selectedPath === path && sourceData?.length === data.length && sourceData.every((value,index) => value === data[index])) return true;
    const token = ++operation;
    loading = true;
    render();
    try {
      beforeTransport();
      await player.load(data,path.split('/').pop());
      if (disposed || token !== operation) return false;
      selectedPath = path;
      sourceData = data.slice();
      selectedMasks.clear();
      frozenSnapshot = null;
      state = player.getState();
      setView('synth');
      node('songSelect').value = path;
      setStatus('Reference song loaded · ' + path);
      return true;
    } catch (error) {
      if (!disposed && token === operation) node('songSelect').value = selectedPath;
      throw error;
    } finally {
      if (!disposed && token === operation) { loading = false; render(); }
    }
  }
  function setView(next) {
    const accepted = next === 'song' ? 'song' : 'synth', changed = view !== accepted;
    view = accepted;
    render();
    if (changed) onViewChange();
  }
  function snapshot() {
    if (view !== 'song') return null;
    const current = currentState();
    if (!current.liveState) return null;
    const live = frozenSnapshot ?? current.liveState;
    if (!live || !selectedMasks.size) return live;
    const channels = live.fm.channels.map(voice => {
      const selected = selectedMasks.get(voice.channel);
      const count = current.songLiveState?.fm.channels[voice.channel].keyOnCount;
      if (!selected || selected.keyOnCount !== count) { selectedMasks.delete(voice.channel); return voice; }
      return {...voice,selectedKeyMask:selected.mask};
    });
    return {...live,fm:{...live.fm,channels}};
  }
  function applyDisplayEdit(before,next) {
    if (currentState().liveEnabled) return;
    const live = snapshot();
    if (!live) return;
    const changed = (first,second) => JSON.stringify(first) !== JSON.stringify(second);
    const result = {...live,fm:{...live.fm,channels:live.fm.channels.slice()},
      ssg:{...live.ssg,channels:live.ssg.channels.slice()},rhythm:{...live.rhythm,voices:live.rhythm.voices.slice()},adpcm:{...live.adpcm}};
    for (let channel=0; channel<6; channel++) if (changed(before.fm[channel],next.fm[channel])) {
      const value = next.fm[channel];
      result.fm.channels[channel] = {...live.fm.channels[channel],selectedKeyMask:value.keyMask,
        preset:{...value,operators:Object.fromEntries(value.operators.map((operator,index) => [index+1,operator]))}};
    }
    for (let channel=0; channel<3; channel++) if (changed(before.ssg.channels[channel],next.ssg.channels[channel])) {
      result.ssg.channels[channel] = {...live.ssg.channels[channel],...next.ssg.channels[channel]};
    }
    for (const key of ['noisePeriod','envelopePeriod','envelopeShape']) if (before.ssg[key] !== next.ssg[key]) result.ssg[key] = next.ssg[key];
    if (before.rhythm.volume !== next.rhythm.volume) result.rhythm.volume = next.rhythm.volume;
    for (let channel=0; channel<6; channel++) if (changed(before.rhythm.voices[channel],next.rhythm.voices[channel])) {
      result.rhythm.voices[channel] = {...live.rhythm.voices[channel],...next.rhythm.voices[channel]};
    }
    for (const key of ['sampleRate','volume','left','right','repeat']) if (before.adpcm[key] !== next.adpcm[key]) result.adpcm[key] = next.adpcm[key];
    if (changed(before.channel3,next.channel3)) result.channel3 = {...live.channel3,...next.channel3};
    if (changed(before.lfo,next.lfo)) { result.lfo = {...next.lfo}; result.fm.lfo = result.lfo; }
    frozenSnapshot = result;
  }
  async function ensureEditable() {
    if (disposed || view !== 'song' || !sourceData || loading) return false;
    if (player.getState().manualReady) return true;
    if (editingPreparation) return editingPreparation;
    const token = operation;
    const current = () => !disposed && token === operation && view === 'song' && !loading;
    const prepare = (async () => {
      if (player.getState().preparingAudition) await player.whenIdle();
      if (!current()) return false;
      const next = player.getState();
      if (next.manualReady) return true;
      if (next.busy || !['ended','stopped','paused'].includes(next.playback)) return false;
      // Reuse the normal seek reconstruction only when a person next edits or
      // auditions a stopped channel. Ended songs otherwise release their chip.
      const prepared = await player.seek(next.positionSeconds,{manualPreparation:true});
      return prepared && current() && player.getState().manualReady;
    })();
    editingPreparation = prepare;
    try { return await prepare; }
    finally { if (editingPreparation === prepare) editingPreparation = null; }
  }
  async function play() {
    if (!sourceData) return;
    const current = player.getState(), playback = current.playback ?? current.state;
    await (playback === 'paused' ? player.resume() : player.play());
    state = player.getState();
    if (state.liveState && ['playing','paused','ended'].includes(state.playback)) setView('song');
  }
  async function capture() {
    const live = snapshot();
    if (!live) return;
    const {section,channel} = getSelection();
    const preset = captureFm2608SongPreset(live,{section,channel,
      referenceNote:Number(node('songReferenceKey').value),basePreset:getSettings()});
    await onCapture(preset);
    setView('synth');
    setStatus('Captured ' + section.toUpperCase() + ' CH' + (channel + 1) + ' to your sound.');
  }
  listen(node('songSelect'),'change',event => {
    const file = project.fs.get(event.target.value);
    event.target.blur();
    if (file) run(() => selectFile({path:file.path,data:file.data}));
  });
  listen(node('songPlay'),'click',() => run(play));
  listen(node('songPause'),'click',() => run(() => { beforeTransport(); return player.pause(); }));
  listen(node('songStop'),'click',() => run(async () => { beforeTransport(); await player.stop(); setView('synth'); }));
  listen(node('songSeek'),'input',() => { seekDraft = true; });
  listen(node('songSeek'),'change',event => {
    const seconds = Number(event.target.value);
    seekDraft = false;
    run(() => { beforeTransport(); selectedMasks.clear(); frozenSnapshot = null; return player.seek(seconds); });
  });
  listen(node('songSeek'),'blur',() => { seekDraft = false; });
  listen(node('songSeek'),'pointercancel',() => { seekDraft = false; });
  listen(node('songView'),'change',event => {
    setView(event.target.value);
    if (view === 'song') run(ensureEditable);
  });
  listen(node('songCapture'),'click',() => run(capture));
  const unwatch = project.onDidChange(refreshFiles);
  refreshFiles();
  return {player,selectFile,setView,snapshot,applyDisplayEdit,ensureEditable,refresh:render,
    isViewing:() => view === 'song' && Boolean(sourceData),
    getState:() => player.getState(),getChip:() => player.getChip(),
    setKeyMask(channel,mask) {
      selectedMasks.set(channel,{mask,keyOnCount:currentState().songLiveState?.fm.channels[channel].keyOnCount});
    },
    setLiveEnabled(value) { frozenSnapshot = null; return player.setLiveEnabled(value); },
    async stop() { operation++; loading = false; selectedMasks.clear(); frozenSnapshot = null; await player.stop(); setView('synth'); },
    async reset() { await this.stop(); player.clear(); selectedPath = ''; sourceData = null; optionsSignature = ''; refreshFiles(); },
    async dispose() { if (disposed) return; disposed = true; operation++; unwatch(); listeners.forEach(stop => stop()); await player.dispose(); },
  };
}
