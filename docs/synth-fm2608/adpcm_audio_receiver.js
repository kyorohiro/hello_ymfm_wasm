// SPDX-License-Identifier: BSD-3-Clause
// Optional host-side musical release, not a YM2608 hardware envelope.
// A single receiver-relative request survives delayed MessagePort delivery.
// Eight-bit level quantization and short-envelope transients remain possible.
const TYPE = 'synth-adpcm-release';
const fraction = progress => progress <= 0 ? 1 : progress >= 1 ? 0
  : (1 + Math.cos(progress * Math.PI)) / 2;
const ownerValid = owner => typeof owner === 'string' && owner.length > 0 && owner.length <= 256;

/** writePhysical(register,value) bypasses this filter and authored shadows.
 * The renderer must split at nextFrame() and call advance(frame) there.
 * nowFrame() includes its current sub-frame when filtering timed raw writes.
 */
export function createYm2608AdpcmRelease({sampleRate,nowFrame,writePhysical,onStop = () => {}} = {}) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || typeof nowFrame !== 'function' ||
      typeof writePhysical !== 'function' || typeof onStop !== 'function') throw TypeError('Invalid YM2608 release receiver');
  let cursor = 0, nominal = 0, physical = 0, gate = false, owner = null, tail = null, rejectedMessages = 0;
  const current = () => Math.max(cursor,nowFrame());
  const levelAt = at => Math.round(nominal * tail.from * fraction((at - tail.start) / (tail.end - tail.start)));
  function volume(value,force = false) {
    if (!force && physical === value) return;
    physical = value; writePhysical(11,value);
  }
  function stop() {
    volume(0,true); writePhysical(0,1); gate = false; onStop();
  }
  function retire({stop:mustStop = false,restore = false} = {}) {
    tail = null;
    if (mustStop) stop();
    if (restore) volume(nominal);
  }
  function receive(data) {
    if (data?.type !== TYPE) return false;
    const at = current();
    if (!ownerValid(data.owner) || !Number.isSafeInteger(at) || at < 0) { rejectedMessages++; return true; }
    if (data.action === 'cancel') {
      if ((data.stop !== undefined && typeof data.stop !== 'boolean') ||
          (data.restore !== undefined && typeof data.restore !== 'boolean')) { rejectedMessages++; return true; }
      // Keep the recent owner until a new gate/release, allowing its explicit
      // restore after a plain cancel without ever touching a newer owner.
      if (data.owner === owner) retire(data);
      return true;
    }
    const duration = data.durationSeconds ?? .012,frames = Math.round(duration * sampleRate);
    if (data.action !== 'release' || !Number.isFinite(duration) || duration <= 0 || duration > 1 ||
        !Number.isSafeInteger(frames) || frames < 1 || !Number.isSafeInteger(at + frames)) { rejectedMessages++; return true; }
    if (!gate || data.owner === owner) return true;
    const from = tail && nominal ? Math.min(1,physical / nominal) : 1;
    owner = data.owner; cursor = at; tail = {start:at,end:at + frames,from};
    // A muted/zero-level voice still receives a real reset without a timer.
    if (!nominal) retire({stop:true});
    return true;
  }
  function filterWrite(port,register,value) {
    if (port !== 1) return value;
    if (register === 11) {
      nominal = value;
      physical = tail ? levelAt(current()) : value;
      return physical;
    }
    if (register === 0 || [2,3,4,5,12,13].includes(register)) {
      retire({restore:true}); owner = null;
      if (register === 0) { gate = Boolean(value & 128); if (!gate) onStop(); }
    }
    return value;
  }
  function nextFrame() {
    if (!tail) return Infinity;
    const at = current();
    if (at >= tail.end || levelAt(at) !== physical) return at;
    if (!physical || !nominal) return tail.end;
    // Solve the next rounding boundary, then correct floating-point ties.
    // This avoids scanning or allocating one event per output sample.
    const threshold = Math.max(-1,Math.min(1,2 * (physical - .5) / (nominal * tail.from) - 1));
    let next = Math.max(at + 1,Math.floor(tail.start + (tail.end - tail.start) * Math.acos(threshold) / Math.PI) + 1);
    next = Math.min(next,tail.end);
    while (next < tail.end && levelAt(next) === physical) next++;
    return next;
  }
  function advance(frame = current()) {
    if (!Number.isSafeInteger(frame) || frame < cursor) return;
    cursor = frame;
    if (!tail) return;
    if (frame >= tail.end) { retire({stop:true}); return; }
    volume(levelAt(frame));
  }
  function reset() { cursor = 0; nominal = physical = 0; gate = false; owner = tail = null; }
  return {receive,filterWrite,nextFrame,advance,reset,getState:() => ({active:Boolean(tail),owner,gate,
    nominalVolume:nominal,physicalVolume:physical,rejectedMessages,
    ...(tail ? {startFrame:tail.start,endFrame:tail.end} : {})})};
}
