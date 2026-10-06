/** Optional Node Worker output adapter. Requires audify 1.10.x, loaded only here. */
export async function createOutput({sampleRate, bufferFrames, onDrain, onError, moduleUrl, deviceId}) {
  let loaded;
  try { loaded = await import(moduleUrl ?? 'audify'); }
  catch (cause) {throw new Error(`Could not load audify: ${cause.message}. Install with npm install audify`, {cause});}
  const {RtAudio, RtAudioFormat} = loaded.default ?? loaded;
  const audio = new RtAudio();
  let queuedFrames = 0, consumedFrames = 0, closed = false, running = false;
  let frames;
  try {
    frames = audio.openStream({deviceId: deviceId ?? audio.getDefaultOutputDevice(), nChannels: 2},
      null, RtAudioFormat.RTAUDIO_FLOAT32, sampleRate, bufferFrames, 'Tetorica MegaSynth', null,
      () => {
        if (closed || !running) return;
        queuedFrames = Math.max(0, queuedFrames - frames); consumedFrames += frames;
        onDrain();
      }, 0, (_type, message) => {if (!closed) onError(new Error(message));});
    if (audio.getStreamSampleRate() !== sampleRate) throw new Error('Audio device sample rate differs from renderer');
  } catch (error) {if (audio.isStreamOpen()) audio.closeStream(); throw error;}
  return {
    frames,
    get queuedFrames() {return queuedFrames;},
    write({left, right}) {
      if (closed || left.length !== frames || right.length !== frames) throw new Error('Invalid audio output block');
      const bytes = Buffer.allocUnsafe(frames * 8);
      for (let i = 0; i < frames; i++) for (const [channel, values] of [left, right].entries()) {
        const value = values[i];
        if (!Number.isFinite(value)) throw new Error('Non-finite audio output');
        bytes.writeFloatLE(Math.max(-1, Math.min(1, value)), i * 8 + channel * 4);
      }
      audio.write(bytes); queuedFrames += frames;
    },
    start() {running = true; audio.start();},
    stop() {
      running = false;
      if (audio.isStreamRunning()) audio.stop();
      audio.clearOutputQueue(); queuedFrames = 0;
    },
    getState() {return {api: audio.getApi(), consumedFrames, queuedFrames,
      bufferFrames: frames, deviceLatencyFrames: audio.getStreamLatency()};},
    close() {
      if (closed) return;
      closed = true; running = false;
      if (audio.isStreamRunning()) audio.stop();
      audio.clearOutputQueue(); audio.closeStream();
    },
  };
}
