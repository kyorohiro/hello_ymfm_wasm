import {createNativeVoiceContext} from './native_genesis_voice_endpoint.js?v=native-msx-1';
import {createNativeGenesisSegaPsg} from './native_genesis_segapsg.js?v=native-game-gear-1';

export const EXTRA_PSG_CLOCK_HELD_ERROR = 'Release the manually held additional PSG voices before changing the clock';
const MAX_EXTRA_PSG = 16;

/** An independently owned Native PSG. Only ordered commands cross the bridge;
 * this endpoint creates neither an AudioContext nor an AudioNode. */
export async function createNativeGenesisExtraSegaPsg(synth, {id, bridge} = {}) {
  if (!synth.isReady() || synth.stopping || synth.closing) throw new DOMException('Native audio is stopping','AbortError');
  if (typeof id !== 'string' || !id.trim() || id.length > 256) throw new TypeError('Mixer id must contain 1..256 characters');
  if (synth.extraPsgDevices.size >= MAX_EXTRA_PSG) throw new RangeError(`Native audio supports at most ${MAX_EXTRA_PSG} additional PSG chips`);
  if (synth.nextExtraPsgInstance >= Number.MAX_SAFE_INTEGER) throw new RangeError('Native sound chip instance limit reached');
  const instance = ++synth.nextExtraPsgInstance, session = synth.session, generation = synth.generation;
  let disposed = false, created = false, connection;
  const current = () => !disposed && session === synth.session && generation === synth.generation && synth.isReady() && !synth.stopping && !synth.closing;
  const abort = () => new DOMException('Native additional PSG was disposed','AbortError');
  const facade = {
    get session() { return synth.session; }, get generation() { return synth.generation; },
    get clock() { return synth.clock; }, get stopping() { return synth.stopping; }, get closing() { return synth.closing; },
    isReady:current, frameAt:time=>synth.frameAt(time), flush:()=>synth.flush(),
    enqueue:command=>{ if (!current()) throw abort(); synth.enqueue({...command,instance}); },
    nativeRequest:(command,args)=>{ if (!current()) return Promise.reject(abort()); return synth.nativeRequest(command,{...args,instance}); },
    emit:event=>{ if (current()) { device.onState?.(event.state); synth.chipInspector?.notify(); } },
  };
  const context = createNativeVoiceContext(facade, {
    backend:'extra-psg',statusCommand:'native_genesis_extra_psg_status',label:'additional PSG',
  });
  const endpoint = createNativeGenesisSegaPsg(context,{stereoEnabled:true,acknowledgeClock:true});
  const client = endpoint.client;
  Object.defineProperty(client,'id',{value:id,enumerable:true});
  const device = {
    native:true, nativeInstance:instance, client, endpoint, clock:3579545, stereoEnabled:true,
    dispose() {
      if (disposed) return; const releaseNative = current() && created;
      disposed = true; connection?.dispose(); endpoint.reset(); synth.extraPsgDevices.delete(instance);
      synth.chipInspector?.notify();
      if (releaseNative) synth.nativeRequest('native_genesis_extra_psg_dispose',{instance}).catch(error=>{
        if (error?.name !== 'AbortError') synth.reportAsyncError(error);
      });
    },
    mix(settings) {
      if (!current()) return;
      endpoint.mix(settings.effectiveMuted ? 0 : settings.volume,settings.pan).catch(error=>{
        if (current() && error?.name !== 'AbortError') synth.reportAsyncError(error);
      });
    },
  };
  client.dispose = () => device.dispose();
  synth.extraPsgDevices.set(instance,device);
  try {
    await synth.nativeRequest('native_genesis_extra_psg_create',{instance});
    created = true; if (!current()) throw abort();
    await endpoint.initialize();
    if (!current()) throw abort();
    if (bridge) {
      connection = bridge.attachEndpoint((message,timing)=>endpoint.dispatch(message,timing));
      device.port = connection.port;
      device.node = {port:connection.controlPort};
    }
    synth.chipInspector?.notify(); return device;
  } catch (error) { device.dispose(); throw error; }
}
