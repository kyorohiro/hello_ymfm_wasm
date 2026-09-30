/** Independent OPN client. All writes and memory uploads use one ordered port. */
import {YM2612Synth} from './ym2612synth.js';
import {YM2203Synth} from './ym2203synth.js';
import {YM2610BSynth, NeoGeoFMSynth} from './ym2610bsynth.js';

export function createOpnClient(name, port) {
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
    if (disposed) throw new Error(`${name} disposed`);
    port.postMessage({method, args});
  };
  const request = (method, args) => new Promise((resolve, reject) => {
    if (disposed) { reject(new Error(`${name} disposed`)); return; }
    const id = ++sequence;
    pending.set(id, {resolve, reject});
    try { port.postMessage({id, method, args}); }
    catch (error) { pending.delete(id); reject(error); }
  });
  const transport = {
    write: (port, register, value) => send('write', [port, register, value]),
    reset: () => send('reset'),
    loadAdpcmMemory: (...args) => new Promise((resolve, reject) => {
      if (disposed) { reject(new Error(`${name} disposed`)); return; }
      const id = ++sequence;
      pending.set(id, {resolve, reject});
      try { port.postMessage({id, method: 'memory', args}); }
      catch (error) { pending.delete(id); reject(error); }
    }),
  };
  let synth;
  if (name === 'ym2612') synth = new YM2612Synth({transport});
  else if (name === 'ym2203') synth = new YM2203Synth({transport});
  else if (name === 'ym2610') {
    const full = new YM2610BSynth({transport});
    synth = new NeoGeoFMSynth(full);
    Object.assign(synth, {ssg: full.ssg, adpcmA: full.adpcmA, adpcmB: full.adpcmB, adpcm: full.adpcm});
  } else throw new Error(`Unsupported OPN chip: ${name}`);
  if (name === 'ym2203') {
    synth.setClock = async clock => { await request('clock', [clock]); synth.ssg.clock = clock / 2; };
    // Relative VGM sample positions, executed in the audio processor.
    synth.scheduleRegisters = (entries, durationSamples) => request('schedule', [entries, durationSamples]);
  }
  synth.dispose = () => {
    if (disposed) return;
    send('dispose'); disposed = true;
    for (const request of pending.values()) request.reject(new Error(`${name} disposed`));
    pending.clear(); port.close();
  };
  return synth;
}
