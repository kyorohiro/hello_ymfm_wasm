// Offline owner harness: actual app audio, audio-owned release and native core.
// Reference-queue guard tests can explicitly inject their synchronous adapter.
import {readFile} from 'node:fs/promises';
import factory from '../../docs/generated/ym2608_wasm.js';
import {Ym2608AudioEngine} from '../../docs/js/ym2608audioengine.js';
import {YM2608Synth} from '../../docs/js/ym2608synth.js';
import {createPerformanceQueue} from '../../docs/js/playground_performance_queue.js';
import {createFm2608Audio} from '../../docs/synth-fm2608/audio.js';
import {createYm2608AdpcmRelease} from '../../docs/synth-fm2608/adpcm_audio_receiver.js';
let module;
const moduleFactory = async () => module ??= await factory({wasmBinary:await readFile(new URL('../../docs/generated/ym2608_wasm.wasm',import.meta.url))});
export async function createFm2608GuardAudio(rate = 48000, {createAdpcmRelease} = {}) {
  const engine = await Ym2608AudioEngine.create({ym2608ModuleFactory:moduleFactory,outputSampleRate:rate,masterVolume:1});
  let frame = 0;
  const writes = [], messages = [];
  const context = {sampleRate:rate,currentTime:0,state:'suspended',destination:{},
    createGain() { return {gain:{value:1,cancelScheduledValues() {},setValueAtTime(value) {this.value=value;},linearRampToValueAtTime(value) {this.value=value;}},connect() {},disconnect() {}}; },
    async close() {this.state='closed';},
  };
  const physical = command => {
    engine.writeYm2608(command.port,command.register,command.value);
    writes.push({port:command.port,register:command.register,value:command.value,frame});
  };
  const release = createYm2608AdpcmRelease({sampleRate:rate,nowFrame:() => frame,
    writePhysical:(register,value) => physical({port:1,register,value})});
  const apply = command => physical({...command,value:release.filterWrite(command.port,command.register,command.value)});
  const queue = createPerformanceQueue({sampleRate:rate,nowFrame:() => frame,apply});
  const transport = {write:(port,register,value) => apply({port,register,value}),
    writeBatch:commands => commands.forEach(apply),reset:() => engine.reset(),
    loadAdpcmMemory:async (bytes,address) => engine.loadAdpcmBMemory(bytes,address)};
  const chip = new YM2608Synth({transport});
  const audio = await createFm2608Audio({createContext:() => context,createAdpcmRelease,createRuntime:() => ({fm:chip,
    node:{port:{postMessage(message) {messages.push(message);if(!release.receive(message)&&!queue.receive(message))throw Error('Unsupported test-owner command');}}},
    async start() {},async close() {engine.dispose();}})});
  function render(frames) {
    const left = new Float32Array(frames), right = new Float32Array(frames);
    for (let offset = 0;offset < frames;) {
      queue.advance(frame);
      release.advance(frame);
      const count = Math.min(frames-offset,queue.nextFrame()-frame,release.nextFrame()-frame);
      const pcm = engine.processFrames(count);
      left.set(pcm.left,offset); right.set(pcm.right,offset);
      frame += count; offset += count; context.currentTime = frame/rate;
    }
    return {left,right};
  }
  return {audio,chip,engine,queue,release,context,writes,messages,render,get frame() {return frame;},dispose:() => audio.dispose()};
}
