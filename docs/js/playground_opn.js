import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
/** Independent OPN client. All writes and memory uploads use one ordered port. */
import {YM2612Synth} from './ym2612synth.js?v=audio-stability-2';
import {YM2203Synth} from './ym2203synth.js?v=native-extra-ym2203-1';
import {YM2610BSynth, NeoGeoFMSynth} from './ym2610bsynth.js?v=native-extra-ym2203-1';
import {trackSsgRetainedLevels} from './opn_ssg_retained.js?v=native-extra-ym2203-1';

/**
 * Create a high-level OPN synth backed by ordered Worklet port commands.
 * The client owns the port; dispose rejects pending requests and closes it.
 * @param {'ym2612' | 'ym2203' | 'ym2610'} name Chip family to expose.
 * @param {MessagePort} port Paired with the chip's audio processor.
 * @returns The chip-specific synth and its disposal/optional scheduling controls.
 * @throws {Error} For an unsupported chip name.
 */
export function createOpnClient(name, port, options = {}) {
  let disposed = false, sequence = 0, constructing = true;
  const pending = new Map();
  port.onmessage = ({data}) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    data.error ? request.reject(new Error(data.error)) : request.resolve(data.value);
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
    reset: () => {if(!(constructing&&options.native&&name==='ym2203'))send('reset');},
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
  constructing=false;
  if(options.native&&name==='ym2203')trackSsgRetainedLevels(synth,(channel,level)=>send('setRetainedLevel',[channel,level]));
  if (name === 'ym2203') {
    // Relative VGM sample positions, executed in the audio processor.
    synth.scheduleRegisters = (entries, durationSamples) => request('schedule', [entries, durationSamples]);
  }
  synth.dispose = () => {
    if (disposed) return;
    send('dispose'); disposed = true;
    for (const request of pending.values()) request.reject(new Error(`${name} disposed`));
    pending.clear(); port.close();
  };
  const client=attachChipClock(synth, port, options.clock ?? CHIP_CLOCKS[name], {onApplied: hz => {
    if (name === 'ym2610') synth.fm.clock = hz;
    if (synth.ssg) synth.ssg.clock = hz / (name === 'ym2203' ? 2 : 4);
    if (synth.adpcmB) synth.adpcmB.clock = hz;
  }});
  if(options.native&&['ym2612','ym2203'].includes(name)){
    Object.defineProperties(client,{
      _getState:{value:()=>({...client.getState(),clock:client.clock,...(client.ssg?{ssg:client.ssg._getState()}:{})})},
      _adoptState:{value:state=>{
        if(!state)return;if(state.clock!==undefined)client._adoptClock(state.clock);
        if(state.channels)client.channels=structuredClone(state.channels);
        if(state.modeRegister!==undefined)client._modeRegister=state.modeRegister;
        if(state.lfo)client.lfo=structuredClone(state.lfo);
        if(state.dac)Object.assign(client.dac,state.dac);
        if(state.ssg?.registers)client.ssg?._adoptState(state.ssg);
      }},
    });
    client._adoptState(options.state);
    client.read=offset=>client._requestControl('read',[offset]);
    client.readStatus=()=>client._requestControl('readStatus');
    client.getIrq=()=>client._requestControl('getIrq');
    client._stopVoices=()=>client._requestControl('stopVoices');
    if(name==='ym2612'){
      const unsupported=feature=>{throw new Error(`${feature} is unavailable for additional Native YM2612 chips`);};
      client.scheduleWrites=()=>unsupported('Scheduled register batches');
      client.clearScheduledWrites=()=>unsupported('Scheduled register batches');
      client.loadDacBank=client.playDacBank=client.clearDacPlayback=()=>unsupported('DAC bank playback');
      for(const method of ['setSample','playFromSample','play','stop','removeSample'])client.dac[method]=()=>Promise.reject(new Error('PCM DAC sample playback is unavailable for additional Native YM2612 chips'));
    }
  }
  return client;
}
