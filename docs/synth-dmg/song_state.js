// SPDX-License-Identifier: BSD-3-Clause
// Sent/configured registers, not native envelope, sweep or channel-active data.
const TRIGGERS = new Set([4,9,14,19]);
const integer = (value, max, label) => {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${label} must be an integer 0..${max}`);
  return value;
};

export function createGameboyRegisterState(clock = 4194304) {
  if (clock !== 4194304) throw new RangeError('DMG song observation requires the normal 4194304 Hz clock');
  const registers = new Uint8Array(48), voice = new Uint8Array(48);
  let revision = 0, cached = null;
  function reset() {registers.fill(0);voice.fill(0);revision++;cached=null;}
  function write(register,value) {
    integer(register,47,'DMG register'); integer(value,255,'DMG byte');
    if (register === 22 && !(value & 128)) {registers.fill(0,0,23);voice.fill(0,0,23);}
    // NR14/24/34/44 trigger is a write edge, not a retained state bit.
    registers[register] = voice[register] = TRIGGERS.has(register) ? value & 127 : value;
    revision++; cached = null;
  }
  function snapshot(frame = 0) {
    integer(frame,Number.MAX_SAFE_INTEGER,'DMG observation frame');
    if (!cached) cached = Object.freeze({clock,initialized:Boolean(registers[22] & 128),revision,
      registers:Object.freeze(Array.from(registers)),voice:Object.freeze(Array.from(voice)),activeMask:null,
      observation:Object.freeze({registers:'sent',voice:'configured',power:'sent-register',hardwareEnvelope:false,hardwareSweep:false})});
    return Object.freeze({...cached,positionFrames:frame});
  }
  return {write,reset,snapshot};
}

/** Stamp writes with engine-generated frames, including VgmPlayer's internal
 * prefetch. Applying events only through the consumed frame keeps the Live
 * view behind that prefetch. Pause retains this same timeline and PCM. */
export function createGameboySongTimeline(engine,clock = 4194304) {
  for (const method of ['writeGameboyApu','processFrames','reset']) if (typeof engine?.[method] !== 'function') throw new TypeError('Expected a Game Boy VGM audio engine');
  const original = {write:engine.writeGameboyApu,process:engine.processFrames,reset:engine.reset};
  const state = createGameboyRegisterState(clock);
  let generated = 0, readFrame = 0, events = [], head = 0, disposed = false;
  function write(register,value) {
    integer(register,47,'DMG register'); integer(value,255,'DMG byte');
    if (events.length - head >= 131072) throw new Error('DMG song exceeds the pending Live register-event limit');
    const result = original.write.call(this,register,value);
    if (!disposed) events.push({frame:generated,register,value});
    return result;
  }
  function process(frames) {
    const pcm = original.process.call(this,frames);
    generated += frames;
    return pcm;
  }
  function reset(...args) {
    const result = original.reset.apply(this,args);
    generated = readFrame = 0;events=[];head=0;state.reset();
    return result;
  }
  engine.writeGameboyApu = write; engine.processFrames = process; engine.reset = reset;
  return {
    read(frame) {
      if (disposed) throw new Error('DMG song timeline is disposed');
      const next = Math.max(0,Math.min(generated,Math.floor(frame)));
      if (!Number.isFinite(next) || next < readFrame) throw new RangeError('DMG song observation cannot move backwards without reset');
      while (head < events.length && events[head].frame <= next) {
        const event = events[head++];state.write(event.register,event.value);
      }
      readFrame = next;
      if (head === events.length) {events=[];head=0;}
      else if (head > 256) {events=events.slice(head);head=0;}
      return state.snapshot(next);
    },
    get generatedFrames() {return generated;},
    get pendingEvents() {return events.length-head;},
    dispose() {
      if (disposed) return;disposed=true;events=[];head=0;
      if (engine.writeGameboyApu === write) engine.writeGameboyApu=original.write;
      if (engine.processFrames === process) engine.processFrames=original.process;
      if (engine.reset === reset) engine.reset=original.reset;
    },
  };
}
