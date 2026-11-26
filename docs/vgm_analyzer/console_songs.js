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

function vsuSong(plan, getMaster, update, getMuteMask, setOutput) {
  let state = 'stopped', position = 0, message = '';
  const engine = createVsuAudio({volume:1,onVgmState(event) {
    state = event.state;
    position = event.positionTicks / 44100;
    update();
  }, onError(error) {state = 'stopped'; message = error.message; update();}});
  return {
    usesOwnAudio:true,
    setMuteMask(mask) {if (engine.output) engine.setVgmMask(63 & ~mask);},
    read:() => ({canPlay:['stopped','ended'].includes(state),canPause:state === 'playing',
      canResume:state === 'paused',paused:state === 'paused',canStop:['playing','paused'].includes(state),
      positionSeconds:position,message:message || 'VSU · '+state}),
    async play() {
      state = 'starting'; update();
      try {
        await engine.ensureReady();
        engine.output.gain.value = getMaster();
        setOutput(engine.output);
        engine.playVgm(plan,{mask:63 & ~getMuteMask()});
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

export function createConsoleSongs(dialog, getMaster, {effectsPane, setOutput}) {
  const control = name => dialog.querySelector('[data-song="'+name+'"]');
  const select = control('tracks'), status = control('status');
  let context, master, player, entries = [], revision = 0, controller;
  let muteMask = 0, psfCore = null, restoreEffects = null;
  const channels = control('channels');
  function showChannels(count) {
    channels.replaceChildren();
    for (let channel=0; channel<count; channel++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'channel-toggle';
      button.textContent = 'CH'+(channel+1);
      button.setAttribute('aria-label','Mute '+button.textContent);
      button.setAttribute('aria-pressed','false');
      button.onclick = () => {
        const bit = 1 << channel;
        muteMask = (muteMask ^ bit) >>> 0;
        button.setAttribute('aria-pressed',String(Boolean(muteMask & bit)));
        button.classList.toggle('is-muted',Boolean(muteMask & bit));
        player?.setMuteMask?.(muteMask);
        psfCore?.setMuteMask(muteMask);
      };
      channels.append(button);
    }
  }
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

    }
    setOutput(master);
    master.gain.value = getMaster() * (entries[select.selectedIndex]?.format === 'PSF1' ? SPU_SYNTH_MIX_HEADROOM : 1);
    await context.resume();
    return {context, gain:master, outputNode:master};
  };
  function retire() {
    const old = player;
    player = null;
    setOutput(null);
    psfCore = null; muteMask = 0; showChannels(0);
    old?.dispose();
  }
  async function choose() {
    const ticket = ++revision;
    retire();
    render();
    const song = entries[select.selectedIndex];
    control('info').textContent = song?.title || '';
    if (!song) return;
    control('progress').hidden = false;
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
          showChannels(6);
          player = vsuSong(parseVsuVgm(bytes),getMaster,update,() => muteMask,setOutput);
          update();
          return;
        }
      }
      if (song.format === 'PSF1') {
        showChannels(24);
        player = createPsfSongPreview({getAudio:audio,onUpdate:update,async createCore({set,entry,signal}) {
          const image = await preparePsfSongSource(set,entry,{signal});
          const core = await createPsfPlaybackCore({image,signal});
          if (ticket === revision && !signal?.aborted) {
            psfCore = core;
            core.setMuteMask(muteMask);
          }
          return core;
        }});
        player.setLiveEnabled(false);
        player.setSource(song.set,song.path);
      } else {
        showChannels(32);
        player = createScspSongPlayer({getAudio:audio,getMuteMask:() => muteMask,onState:update,onStatus(message) {
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
    finally {if (ticket === revision) control('progress').hidden = true;}
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
    restoreEffects?.(); restoreEffects = null;
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
    if (!restoreEffects) {
      const marker = document.createComment('Analyzer Effect controls');
      effectsPane.before(marker);
      const hidden = effectsPane.hidden;
      control('effects').append(effectsPane);
      effectsPane.hidden = false;
      restoreEffects = () => {marker.replaceWith(effectsPane); effectsPane.hidden = hidden;};
    }
    if (!dialog.open) dialog.showModal();
    clearInterval(timer);
    timer = setInterval(render,250);
    control('info').textContent = '';
    control('progress').hidden = false;
    status.textContent = files.length === 1 ? 'Reading '+files[0].name+'…' : 'Reading '+files.length+' song files…';
    render();
    try {
      const songs = await consoleSongEntries(files,controller.signal);
      if (ticket !== revision) return;
      entries = songs;
      for (const {path,format} of songs) select.add(new Option(format+' · '+path));
      if (songs.length) await choose();
      else status.textContent = 'Select a song together with its library files.';
    } catch (error) { if (ticket === revision) status.textContent = error.message; }
    finally {if (ticket === revision) control('progress').hidden = true;}
  };
}
