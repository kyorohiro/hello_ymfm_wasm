// SPDX-License-Identifier: BSD-3-Clause
import {createScspSongPlayer} from '../synth-scsp/song_player.js';
import {listScspSsfEntries, readScspSsfSet} from '../synth-scsp/ssf_source.js';
import {readPsfFileSet} from '../playground/playground_ps1_psf.js';
import {createPsfSongPreview} from '../synth-spu/psf_song_preview.js';
import {preparePsfSongSource} from '../synth-spu/psf_song_source.js';
import {createPsfPlaybackCore} from '../synth-spu/psf_playback_core.js';
import {SPU_SYNTH_MIX_HEADROOM} from '../synth-spu/spu_synth_levels.js';

import {createVsuAudio} from '../synth-vsu/audio.js';
import {parseVsuVgm} from '../synth-vsu/vgm.js';
import {maybeDecodeVgmFile} from '../js/vgm_file.js';
import {consoleVgmChip} from './console_vgm.js';

function vsuSong(plan, getMaster, update) {
  let state = 'stopped', position = 0, message = '';
  const engine = createVsuAudio({volume:1,onVgmState(event) {
    state = event.state;
    position = event.positionTicks / 44100;
    update();
  }, onError(error) {state = 'stopped'; message = error.message; update();}});
  return {
    usesOwnAudio:true,
    read:() => ({canPlay:['stopped','ended'].includes(state),canPause:state === 'playing',
      canResume:state === 'paused',paused:state === 'paused',canStop:['playing','paused'].includes(state),
      positionSeconds:position,message:message || 'VSU · '+state}),
    async play() {
      state = 'starting'; update();
      try {
        await engine.ensureReady();
        engine.output.gain.value = getMaster();
        engine.playVgm(plan);
      } catch (error) {state = 'stopped'; message = error.message; update();}
    },
    resume:() => engine.pauseVgm(false), pause:() => engine.pauseVgm(true),
    stop:() => engine.stopVgm(), dispose:() => engine.dispose(),
  };
}

export async function consoleSongEntries(files, signal) {
  const songs = [];
  const ssf = files.filter(file => /\.(ssf|minissf|ssflib)$/i.test(file.name));
  if (ssf.length) {
    const set = await readScspSsfSet(ssf,{signal});
    for (const {path,title} of listScspSsfEntries(set)) songs.push({format:'SSF',path,title,set});
  }
  const psf = files.filter(file => /\.(psf|minipsf|psf1?lib)$/i.test(file.name));
  if (psf.length) {
    const set = await readPsfFileSet(psf,{signal});
    for (const {path,title} of set.entries) if (/\.(psf|minipsf)$/i.test(path)) songs.push({format:'PSF1',path,title,set});
  }
  for (const file of files.filter(file => /\.vg[zm]$/i.test(file.name))) {
    songs.push({format:'VGM',path:file.webkitRelativePath || file.name,file});
  }
  return songs.sort((a,b) => a.path.localeCompare(b.path,undefined,{numeric:true}));
}

export function createConsoleSongs(dialog, getMaster) {
  const control = name => dialog.querySelector('[data-song="'+name+'"]');
  const select = control('tracks'), status = control('status');
  let context, master, player, entries = [], revision = 0, controller;
  function render() {
    const state = player?.read();
    control('play').disabled = !(state?.canPlay || state?.canResume);
    control('pause').disabled = !state?.canPause;
    control('stop').disabled = !state?.canStop;
    control('play').textContent = state?.paused ? 'Resume' : 'Play';
    if (state?.message || state?.errorMessage) status.textContent = state.errorMessage || state.message;
    control('position').textContent = Math.floor(state?.positionSeconds || 0) + ' s';
  }
  const audio = async () => {
    if (!context) {
      context = new AudioContext();
      master = context.createGain();
      master.connect(context.destination);
    }
    master.gain.value = getMaster() * (entries[select.selectedIndex]?.format === 'PSF1' ? SPU_SYNTH_MIX_HEADROOM : 1);
    await context.resume();
    return {context, gain:master, outputNode:master};
  };
  function retire() {
    const old = player;
    player = null;
    old?.dispose();
  }
  async function choose() {
    const ticket = ++revision;
    retire();
    render();
    const song = entries[select.selectedIndex];
    control('info').textContent = song?.title || '';
    if (!song) return;
    status.textContent = 'Loading '+song.path+'…';
    const update = () => { if (ticket === revision) render(); };
    try {
      let bytes;
      if (song.file) {
        if (song.file.size > 64 * 1024 * 1024) throw new Error('VGM exceeds 64 MiB.');
        bytes = await maybeDecodeVgmFile(await song.file.arrayBuffer(),{maxBytes:64*1024*1024});
        if (ticket !== revision) return;
        const chip = consoleVgmChip(bytes);
        if (!chip) throw new Error('Use the main playlist for other VGM chips.');
        control('info').textContent = chip + ' · VGM';
        if (chip === 'VSU') {
          player = vsuSong(parseVsuVgm(bytes),getMaster,update);
          update();
          return;
        }
      }
      if (song.format === 'PSF1') {
        player = createPsfSongPreview({getAudio:audio,onUpdate:update,async createCore({set,entry,signal}) {
          const image = await preparePsfSongSource(set,entry,{signal});
          return createPsfPlaybackCore({image,signal});
        }});
        player.setLiveEnabled(false);
        player.setSource(song.set,song.path);
      } else {
        player = createScspSongPlayer({getAudio:audio,onState:update,onStatus(message) {
          if (ticket === revision) status.textContent = message;
        }});
        if (song.file) {
          await player.load(new Uint8Array(bytes),song.path);
        } else {
          const loaded = await player.loadSsf(song.set,song.path);
          if (ticket === revision) control('info').textContent = [song.title,loaded.format,...loaded.loadedFiles].filter(Boolean).join(' · ');
        }
        if (ticket === revision) status.textContent = 'Ready';
      }
    } catch (error) { if (ticket === revision) status.textContent = error.message; }
    update();
  }
  select.onchange = () => choose();
  for (const action of ['play','pause','stop']) control(action).onclick = async () => {
    const current = player;
    try {
      if (action === 'play' && !current?.usesOwnAudio) await audio();
      if (current && current === player) await current[action === 'play' && current.read().paused ? 'resume' : action]();
    } catch (error) { if (current === player) status.textContent = error.message; }
    render();
  };
  let timer;
  function close() {
    ++revision;
    controller?.abort();
    retire();
    clearInterval(timer);
    if (context) void context.close();
    context = master = null;
    entries = [];
    select.replaceChildren();
  }
  dialog.addEventListener('close',() => {if (!dialog.open) close();});
  window.addEventListener('pagehide',close);
  return async files => {
    const ticket = ++revision;
    controller?.abort();
    controller = new AbortController();
    retire();
    entries = [];
    select.replaceChildren();
    if (!dialog.open) dialog.showModal();
    clearInterval(timer);
    timer = setInterval(render,250);
    control('info').textContent = '';
    status.textContent = 'Reading song files…';
    render();
    try {
      const songs = await consoleSongEntries(files,controller.signal);
      if (ticket !== revision) return;
      entries = songs;
      for (const {path,format} of songs) select.add(new Option(format+' · '+path));
      if (songs.length) await choose();
      else status.textContent = 'Select a song together with its library files.';
    } catch (error) { if (ticket === revision) status.textContent = error.message; }
  };
}
