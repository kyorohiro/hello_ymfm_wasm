/** Read-only observation of native final output. This adapter owns neither an
 * AudioContext nor the playback command queue. The UI decides when to poll. */
const MODES = new Set(['envelope','waveform','spectrum']);
function validate(data,session,sampleRate,mode) {
  if (data?.session !== session || data.sampleRate !== sampleRate ||
      !Number.isSafeInteger(data.frame) || data.frame < 0 ||
      !Number.isInteger(data.frames) || data.frames < 0 || data.frames > 4096 || data.frames > data.frame ||
      !Number.isFinite(data.rms) || !Number.isFinite(data.peak) || data.rms < 0 || data.peak < 0 ||
      data.peak > 1 || data.rms > data.peak + 1e-6) throw new Error('Invalid Native audio monitor snapshot');
  const expected = mode === 'waveform' ? ['samples',4096,-1,1] : mode === 'spectrum' ? ['bins',2048,-100,0] : null;
  const result = {session,frame:data.frame,sampleRate,frames:data.frames,rms:data.rms,peak:data.peak};
  for (const key of ['samples','bins']) {
    if (key !== expected?.[0] && data[key] !== undefined) throw new Error('Unexpected Native audio monitor payload');
  }
  if (expected) {
    const [key,length,minimum,maximum] = expected, values = data[key];
    if ((!Array.isArray(values) && !(values instanceof Float32Array)) || values.length !== length ||
        values.some(value => !Number.isFinite(value) || value < minimum || value > maximum)) throw new Error('Invalid Native audio monitor samples');
    result[key] = Float32Array.from(values);
  }
  return result;
}

export function createNativeGenesisMonitor({invoke,getSession,getSampleRate,isReady}) {
  let epoch = 0, inFlight = null, disabling = null, observedSession = null;
  const current = (version,session) => version === epoch && getSession() === session && isReady();
  return {
    backend:'native-genesis', isReady, getSession,
    read({mode,channel}) {
      if (!MODES.has(mode) || (channel !== 0 && channel !== 1)) return Promise.reject(new TypeError('Invalid Native audio monitor mode or channel'));
      if (!isReady() || inFlight) return Promise.resolve(null);
      const session = getSession(), version = epoch, rate = getSampleRate(), previousOff = disabling;
      const request = (async () => {
        // A resume must not overtake the old panel's off request. Audio Stop
        // never waits for this separate, read-only observation barrier.
        await previousOff?.catch(() => {});
        if (!current(version,session)) return null;
        observedSession = session;
        try {
          const data = await invoke('native_genesis_monitor',{session,mode,channel});
          if (!current(version,session)) return null;
          // A busy reader or a ring overwritten during the bounded copy can
          // skip this visual frame. It is not a playback or monitor failure.
          if (data === null) return null;
          return validate(data,session,rate,mode);
        } catch(error) {
          if (!current(version,session)) return null;
          throw error instanceof Error ? error : new Error(String(error));
        }
      })();
      const pending = request.finally(() => {if (inFlight === pending) inFlight = null;});
      inFlight = pending; return pending;
    },
    pause() {
      ++epoch;
      if (observedSession === null) return disabling ?? Promise.resolve();
      const session = observedSession; observedSession = null;
      const previousOff = disabling, previousRead = inFlight;
      const request = (async () => {
        await previousOff?.catch(() => {}); await previousRead?.catch(() => {});
        // A retired page must not disable the replacement native session.
        if (getSession() !== session) return;
        await invoke('native_genesis_monitor',{session,mode:'off',channel:0});
      })();
      const pending = request.finally(() => {if (disabling === pending) disabling = null;});
      disabling = pending; return pending;
    },
  };
}
