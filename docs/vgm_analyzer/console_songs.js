// SPDX-License-Identifier: BSD-3-Clause
import {createScspSongPlayer} from '../synth-scsp/song_player.js';
import {listScspSsfEntries, parseScspSsfTime, readScspSsfSet} from '../synth-scsp/ssf_source.js';
import {readPsfFileSet} from '../playground/playground_ps1_psf.js';
import {createPsfSongPreview} from '../synth-spu/psf_song_preview.js';
import {preparePsfSongSource} from '../synth-spu/psf_song_source.js';
import {createPsfPlaybackCore} from '../synth-spu/psf_playback_core.js';
import {SPU_SYNTH_MIX_HEADROOM} from '../synth-spu/spu_synth_levels.js';

import {createVsuAudio} from '../synth-vsu/audio.js';
import {parseVsuVgm} from '../synth-vsu/vgm.js';

function vsuSong(plan, update, getMuteMask, setOutput) {
  let state = 'stopped', position = 0, message = '', revision = 0;
  const engine = createVsuAudio({volume:1,onVgmState(event) {
    state = event.state;
    position = event.positionTicks / 44100;
    update();
  }, onError(error) {state = 'stopped'; message = error.message; update();}});
  return {
    usesOwnAudio:true,
    setMuteMask(mask) {if (engine.output) engine.setVgmMask(63 & ~mask);},
    read:() => ({state,canPlay:['stopped','ended'].includes(state),canPause:state === 'playing',
      canResume:state === 'paused',paused:state === 'paused',canStop:['starting','playing','paused'].includes(state),
      positionSeconds:position,busy:state === 'starting',message:message || 'VSU · '+state}),
    async play() {
      const ticket = ++revision;
      state = 'starting'; message = ''; update();
      try {
        await engine.ensureReady();
        if (ticket !== revision) return;
        setOutput(engine.output);
        engine.playVgm(plan,{mask:63 & ~getMuteMask()});
      } catch (error) {if (ticket === revision) {state = 'stopped'; message = error.message; update();}}
    },
    resume:() => engine.pauseVgm(false), pause:() => engine.pauseVgm(true),
    stop() {revision++; engine.stopVgm(); state = 'stopped'; position = 0; update();},
    dispose() {revision++; engine.dispose();},
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
  return songs.sort((a,b) => a.path.localeCompare(b.path,undefined,{numeric:true}));
}

/** One selected playlist track owns its engine, output and mute state. */
export async function createConsoleSong(song, {getMaster, update, connectOutput, releaseOutput, onEnded}) {
  let context, output, engine, psfCore, disposed = false, muteMask = 0;
  let message = '', finished = false, fadeGain = 1, playRevision = 0;
  const psf = song.format === 'PSF1';
  const chip = psf ? 'SPU' : song.format === 'VSU' ? 'VSU' : 'SCSP';
  const tags = psf && song.set.records.get(song.path)?.tags;
  const length = tags ? parseScspSsfTime(tags.get('length')) : null;
  const duration = length === null ? null : length + (parseScspSsfTime(tags.get('fade')) || 0);
  function setVolume(value) {
    if (output) output.gain.value = value * (psf ? SPU_SYNTH_MIX_HEADROOM * fadeGain : 1);
  }
  function attach(node) {
    if (disposed) return;
    output = node;
    setVolume(getMaster());
    connectOutput();
  }
  async function audio() {
    if (disposed) throw new Error('Track closed');
    if (!context) {context = new AudioContext(); attach(context.createGain());}
    await context.resume();
    return {context, gain:output, outputNode:output};
  }
  function changed() {
    if (disposed || !engine) return;
    const state = engine.read();
    if (psf && duration > length && state.playing) {
      const next = Math.min(1, Math.max(0, (duration-state.positionSeconds)/(duration-length)));
      if (next !== fadeGain) {fadeGain = next; setVolume(getMaster());}
    }
    const atEnd = state.state === 'ended' || (psf && duration > 0 && state.playing && state.positionSeconds >= duration);
    if (atEnd && !finished) {
      finished = true;
      if (psf) engine.stop();
      onEnded();
    }
    update();
  }
  function dispose() {
    disposed = true;
    playRevision++;
    if (output) releaseOutput(output.context);
    engine?.dispose();
    if (context) void context.close();
  }
  try {
    if (chip === 'VSU') {
      engine = vsuSong(parseVsuVgm(song.bytes),changed,() => muteMask,attach);
    } else if (psf) {
      engine = createPsfSongPreview({getAudio:audio,onUpdate:changed,async createCore({set,entry,signal}) {
        const image = await preparePsfSongSource(set,entry,{signal});
        psfCore = await createPsfPlaybackCore({image,signal});
        psfCore.setMuteMask(muteMask);
        return psfCore;
      }});
      engine.setLiveEnabled(false);
      engine.setSource(song.set,song.path);
    } else {
      engine = createScspSongPlayer({getAudio:audio,getMuteMask:() => muteMask,onState:changed,
        onStatus(value) {message = value; changed();}});
      if (song.bytes) await engine.load(new Uint8Array(song.bytes),song.path);
      else await engine.loadSsf(song.set,song.path);
    }
    return {
      channelCount:chip === 'VSU' ? 6 : psf ? 24 : 32, chip,
      get loadedFiles() {return engine.read().loadedFiles;},
      get outputNode() {return output;}, get muteMask() {return muteMask;},
      setMuteMask(mask) {muteMask = mask >>> 0; engine.setMuteMask?.(muteMask); psfCore?.setMuteMask(muteMask);},
      setVolume, dispose,
      read() {
        const state = engine.read();
        return {...state, loading:state.busy, error:state.error || state.errorMessage, message:state.errorMessage || state.message || message || chip+' · Ready'};
      },
      async play() {
        const revision = ++playRevision;
        finished = false;
        fadeGain = 1;
        setVolume(getMaster());
        // Unlock inside the Play gesture, before PSF decompression / Worker startup.
        if (chip !== 'VSU') await audio();
        if (!disposed && revision === playRevision) await engine.play();
        changed();
      },
      pause:() => engine.pause(), resume:() => engine.resume(), stop() {playRevision++; return engine.stop();},
    };
  } catch (error) {dispose(); throw error;}
}
