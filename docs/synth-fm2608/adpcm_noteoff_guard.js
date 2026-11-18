// SPDX-License-Identifier: BSD-3-Clause
// Standalone Synth software release; the common YM2608/ADPCM hardware API stays raw.
export const FM2608_ADPCM_RELEASE_SECONDS = .008;
// At most 255 distinct level changes plus the final Stop/restore batch.
export const FM2608_ADPCM_RELEASE_STEPS = 256;
const SESSION = 1;
const fadeFraction = progress => progress <= 0 ? 1 : progress >= 1 ? 0
  : (1 + Math.cos(progress * Math.PI)) / 2;

/** Use the existing owner-scoped audio-frame queue, not main-thread timers.
 * This standalone owner starts its queue session once, before Code is exposed.
 * Canceling a tail cancels only its own owner; unrelated reservations survive.
 * Physical release writes never enter the authored register/preset shadows.
 */
export function createFm2608AdpcmNoteOffGuard({postMessage = null, writePhysical,
  now = () => 0, sampleRate = 44100, getVolume, getMuted = () => false,
  getGate, requestedOff = () => {}} = {}) {
  for (const callback of [writePhysical,now,getVolume,getMuted,getGate,requestedOff]) {
    if (typeof callback !== 'function') throw TypeError('ADPCM noteOff guard requires owner callbacks');
  }
  if (postMessage !== null && typeof postMessage !== 'function') throw TypeError('Invalid ADPCM queue sender');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw RangeError('Invalid ADPCM output sample rate');
  const quantum = 128 / sampleRate;
  let tail = null, sequence = 0, disposed = false, needsRestore = false;
  const write = (register,value) => ({type:'write',port:1,register,value});
  const level = () => getMuted() ? 0 : getVolume();
  const fraction = at => !tail ? 1
    : tail.from * fadeFraction((at - tail.start) / (tail.end - tail.start));
  if (postMessage) postMessage({type:'performance-start',session:SESSION});

  function settleFinished() {
    if (tail && now() > tail.end + quantum) { tail = null; needsRestore = false; }
  }
  function cancel({restore = false, stop = false} = {}) {
    settleFinished();
    const previous = tail, affected = Boolean(previous || needsRestore);
    if (previous) {
      // After one full extra quantum the tail has already been consumed. Avoid
      // retaining canceled owner names for ordinary, fully completed notes.
      if (now() <= previous.end + quantum) postMessage?.({type:'performance-cancel-owner',session:SESSION,owner:previous.owner});
      tail = null;
    }
    if (affected && stop) { requestedOff(); writePhysical([write(0,1)]); }
    if (affected && restore) { writePhysical([write(11,level())]); needsRestore = false; }
    return affected;
  }
  function restore() {
    if (!needsRestore || disposed) return;
    writePhysical([write(11,level())]); needsRestore = false;
  }
  function schedule(start,end,from) {
    const owner = `fm2608-adpcm-release:${++sequence}`;
    const volume = level();
    tail = {owner,start,end,from}; needsRestore = true;
    // Render the smooth envelope at output-frame granularity. Repeated
    // integer levels add no state change, so send only distinct level writes.
    // The cap also bounds work for an injected, non-device sample clock.
    const frames = Math.max(1,Math.min(4096,Math.round((end - start) * sampleRate)));
    let previous = Math.round(volume * from);
    for (let frame = 1; frame <= frames; frame++) {
      const at = start + (end - start) * frame / frames;
      const value = Math.round(volume * from * fadeFraction(frame / frames));
      if (value === previous && frame !== frames) continue;
      previous = value;
      const commands = [write(11,value)];
      if (frame === frames) {
        // All three writes share one audio-frame batch: zero, decoder stop,
        // then the latest nominal level, with no audible frame in between.
        commands.push(write(0,1),write(11,volume));
      }
      postMessage({performance:{session:SESSION,owner,time:at},commands});
    }
  }
  function noteOff() {
    if (disposed || tail) return false;
    const playing = getGate(), volume = level();
    requestedOff();
    if (!postMessage || !playing || volume === 0) {
      writePhysical([write(0,1)]);
      return false;
    }
    const start = now() + quantum;
    schedule(start,start + FM2608_ADPCM_RELEASE_SECONDS,1);
    return true;
  }
  function volumeChanged() {
    settleFinished();
    if (!tail || disposed) return;
    const at = now(), end = tail.end, remaining = fraction(at);
    if (at >= end) { cancel({stop:true,restore:false}); return; }
    cancel();
    // Retarget only the remainder; authoring/mute edits cannot extend release.
    schedule(at,end,remaining);
  }
  return {
    noteOff,cancel,restore,volumeChanged,
    filterVolume(value) { settleFinished(); return tail ? Math.round(value * fraction(now())) : value; },
    getState() { return {pending:Boolean(tail && now() < tail.end),needsRestore,
      ...(tail ? {owner:tail.owner,start:tail.start,end:tail.end,fraction:fraction(now())} : {})}; },
    dispose() { if (disposed) return; cancel(); disposed = true; },
  };
}
