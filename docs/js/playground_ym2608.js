import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
/** Shared main-thread / Worker facade; register writes and memory transfers share one ordered port. */
import {YM2608Synth,YM2608AdpcmSynth} from './ym2608synth.js?v=native-extra-huc6280-1';
import {trackSsgRetainedLevels} from './opn_ssg_retained.js?v=native-extra-huc6280-1';
import {readSamplePCM} from './adpcm_b_sample.js';

/** @param {MessagePort} port */
export function createYm2608Client(port, options = {}, lifecycle = {}) {
  let disposed = false, sequence = 0, constructing = true;
  const pending = new Map();
  port.onmessage = ({data}) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    const reply=()=>{if(disposed||lifecycle.isStopped?.(request.context)){request.reject(new Error('Run stopped'));return;}lifecycle.restoreContext?.(request.context);data.error ? request.reject(new Error(data.error)) : request.resolve(data.value);};
    if(options.native)setTimeout(reply,0);else reply();
  };
  port.start?.();
  const send = (method, args = []) => {
    if (disposed) throw new Error('YM2608 disposed');
    port.postMessage({method, args});
  };
  const transfer = (method, args) => {
    if (disposed) return Promise.reject(new Error('YM2608 disposed'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, {resolve, reject,context:lifecycle.captureContext?.()});
      try { port.postMessage({id, method, args}); }
      catch (error) { pending.delete(id); reject(error); }
    });
  };
  const synth = new YM2608Synth({transport: {
    write: (port, register, value) => {if(!(options.native&&constructing))send('write', [port, register, value]);},
    reset: () => {if(!(options.native&&constructing))send('reset');},
    loadRhythmRom: bytes => transfer('rom', [bytes]),
    loadAdpcmMemory: (bytes, offset) => transfer('memory', [bytes, offset]),
  }});
  constructing=false;
  if(options.native)trackSsgRetainedLevels(synth,(channel,level)=>send('setRetainedLevel',[channel,level]));
  // VGM supplies its own setup, including the extended-channel mode register.
  synth.resetRegisters = () => {
    send('reset'); synth.ssg.resetState(); synth.rhythm.resetState(); synth.adpcm.resetState();
  };
  synth.prepareTimeline = (events, blocks, durationSamples) => transfer('prepareTimeline', [events, blocks, durationSamples]);
  synth.playTimeline = () => transfer('playTimeline', []);
  synth.dispose = () => {
    if (disposed) return;
    send('dispose'); disposed = true;
    for (const request of pending.values()) request.reject(new Error('YM2608 disposed'));
    pending.clear(); port.close();
  };
  const client=attachChipClock(synth, port, options.clock ?? CHIP_CLOCKS.ym2608, {onApplied: hz => { synth.ssg.clock = hz / 4; synth.adpcm.clock = hz; }});
  if(options.native){
    Object.defineProperties(client,{
      _getState:{value:()=>({...client.getState(),clock:client.clock,ssg:client.ssg._getState(),rhythm:{levels:Array.from(client.rhythm.levels)},adpcm:{registers:Array.from(client.adpcm.registers)}})},
      _adoptState:{value:state=>{if(!state)return;if(state.clock!==undefined)client._adoptClock(state.clock);if(state.channels)client.channels=structuredClone(state.channels);if(state.modeRegister!==undefined)client._modeRegister=state.modeRegister;if(state.lfo)client.lfo=structuredClone(state.lfo);if(state.ssg?.registers)client.ssg._adoptState(state.ssg);if(state.rhythm?.levels)client.rhythm.levels.set(state.rhythm.levels);if(state.adpcm?.registers)client.adpcm.registers.set(state.adpcm.registers);}},
    });
    client._adoptState(options.state);
    client.read=offset=>client._requestControl('read',[offset]);client.readStatus=()=>client._requestControl('readStatus');client.getIrq=()=>client._requestControl('getIrq');
    client.adpcm.loadSample=async(source,sampleOptions={})=>{
      const context=lifecycle.captureContext?.(),check=()=>{if(disposed||lifecycle.isStopped?.(context))throw new Error('Run stopped');lifecycle.restoreContext?.(context);};
      const pcm=await readSamplePCM(source,{...sampleOptions,decodeAudio:sampleOptions.decodeAudio??lifecycle.decodeAudio});check();
      const operations=[],staged=new YM2608AdpcmSynth({write:(register,value)=>operations.push({register,value}),loadMemory:(bytes,address)=>operations.push({bytes,address})},client.clock);
      staged.registers.set(client.adpcm.registers);const result=await staged.loadSample(pcm,sampleOptions);
      // Each resumed sample operation owns a host task; concurrent decoders
      // cannot overwrite one another's Worker owner before committing writes.
      await new Promise((resolve,reject)=>setTimeout(()=>{try{check();resolve();}catch(error){reject(error);}},0));
      for(const operation of operations){check();sampleOptions.signal?.throwIfAborted();if(operation.bytes)await transfer('memory',[operation.bytes,operation.address]);else send('write',[1,operation.register,operation.value]);}
      check();sampleOptions.signal?.throwIfAborted();client.adpcm.registers.set(staged.registers);return result;
    };
  }
  return client;
}
