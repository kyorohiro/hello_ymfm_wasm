// SPDX-License-Identifier: BSD-3-Clause
import {createAudio} from '../sid-player/audio.js?sid-mixer=1';
import {validatePlayerSid} from '../sid-player/models.js';

export function createSidSong(bytes, subtune, getMaster, update, {connectOutput,releaseOutput} = {}) {
  const parsed = validatePlayerSid(bytes,{subtune});
  const backend = parsed.selectedModel === '8580' ? '8580' : parsed.format === 'RSID' ? 'rsid'
    : parsed.timing === 'cia' ? 'psid-cia' : 'psid-vbi';
  let active, controller, phase = 'ready', elapsed = 0, started = 0, error = '';

  let muteMask = 0, progress = '';
  function stop(reason = '') {
    progress = '';
    if (active) releaseOutput?.(active.context);
    controller?.abort();
    controller = null;
    void active?.dispose();
    active = null;
    phase = 'ready';
    error = reason;
    elapsed = 0;
    update();
  }
  async function play() {
    if (phase !== 'ready') return;
    const attempt = new AbortController();
    controller = attempt;
    phase = 'starting';
    progress = 'Preparing SID playback…';
    error = '';
    update();
    try {
      const audio = await createAudio({volume:1,backend,signal:attempt.signal,
        mixerBinaryUrl:new URL('../generated/sid-analyzer/'+parsed.selectedModel+'.wasm',import.meta.url),
        onProgress(message) {if (controller === attempt) {progress = message; update();}},
        onError(cause) {
        if (controller === attempt) stop(cause.message);
      }});
      if (attempt.signal.aborted) {await audio.dispose(); return;}
      active = audio;
      audio.outputNode.gain.value = getMaster();
      connectOutput?.();
      progress = 'Initializing '+parsed.format+' subtune '+parsed.subtune+'…'; update();
      await audio.command('load',[bytes,{...parsed.playerOptions,subtune:parsed.subtune,environment:'minimal'}]);
      attempt.signal.throwIfAborted();
      await audio.command('setMuteMask',[muteMask]);
      attempt.signal.throwIfAborted();
      await audio.command('start');
      attempt.signal.throwIfAborted();
      started = audio.context.currentTime;
      phase = 'playing'; progress = '';
      update();
    } catch (cause) {if (controller === attempt) stop(cause.message);}
  }
  async function toggle(pause) {
    const audio = active;
    if (!audio || phase !== (pause ? 'playing' : 'paused')) return;
    phase = 'switching';
    update();
    try {
      if (!pause) await audio.resume();
      const state = await audio.command(pause ? 'pause' : 'resume');
      if (audio !== active) return;
      elapsed = state.positionFrames / audio.sampleRate;
      started = audio.context.currentTime;
      phase = pause ? 'paused' : 'playing';
      update();
    } catch (cause) {if (audio === active) stop(cause.message);}
  }
  return {
    usesOwnAudio:true, play, pause:() => toggle(true), resume:() => toggle(false), stop, dispose:stop,
    get outputNode() {return active?.outputNode;},
    get muteMask() {return muteMask;},
    setMuteMask(mask) {
      muteMask = mask;
      const audio = active;
      if (audio) void audio.command('setMuteMask',[mask]).catch(cause => {if (audio === active) stop(cause.message);});
    },
    setVolume(value) {if (active) active.outputNode.gain.value = value;},
    description:[parsed.metadata.name,parsed.metadata.author,parsed.format,'PAL',
      parsed.selectedModel === '8580' ? '8580 Preview' : '6581',parsed.timing].filter(Boolean).join(' · '),
    read:() => ({canPlay:phase === 'ready',canPause:phase === 'playing',canResume:phase === 'paused',
      canStop:phase !== 'ready',paused:phase === 'paused',loading:phase === 'starting',message:error || progress || 'SID · '+phase,
      positionSeconds:elapsed + (phase === 'playing' ? active.context.currentTime-started : 0)}),
  };
}

export {parsePlayerStructure} from '../sid-player/model_policy.js';
export {PSID_MAX_FILE_BYTES} from '../js/sid_psid.js';
