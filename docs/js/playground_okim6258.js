import {attachChipClock} from './playground_chip_clock.js?v=msx-modes-2';
import {Oki6258Synth, OKIM6258_CLOCK} from './okim6258synth.js?v=msx-modes-2';

/** Main/Worker API; samples and playback commands share one ordered port. */
export function createOki6258Client(port, {clock = OKIM6258_CLOCK} = {}) {
  let disposed = false, sequence = 0;
  const pending = new Map();
  port.onmessage = ({data}) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    data.error ? request.reject(new Error(data.error)) : request.resolve();
  };
  port.start?.();
  const send = (method, args = []) => {
    if (disposed) throw new Error('OKIM6258 disposed');
    port.postMessage({method, args});
  };
  const synth = new Oki6258Synth({clock, transport:{
    writeRegister:(...args) => send('writeRegister', args),
    loadMemory:(bytes,metadata) => new Promise((resolve, reject) => {
      if (disposed) { reject(new Error('OKIM6258 disposed')); return; }
      const id = ++sequence;
      pending.set(id, {resolve, reject});
      try { port.postMessage({method:'loadMemory', args:[bytes,metadata], id}); }
      catch (error) { pending.delete(id); reject(error); }
    }),
    play:options => send('play', [options]), stop:() => send('stop'), reset:() => send('reset'),
    dispose() {
      if (disposed) return;
      send('dispose'); disposed = true;
      for (const request of pending.values()) request.reject(new Error('OKIM6258 disposed'));
      pending.clear(); port.close();
    },
  }});
  const controlled=attachChipClock(synth,port,clock,{onApplied:hz=>synth._adoptHardwareClock(hz)});
  Object.defineProperty(synth,'_stopVoices',{value:()=>controlled._requestControl('stopVoices')});
  return controlled;
}
