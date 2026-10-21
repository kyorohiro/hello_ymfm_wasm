const MAX_SECONDS = 30;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_MARKERS = 32;
const loadedModules = new WeakMap();

/** Encode the recorded floats without clipping, normalization or PCM16 conversion. */
export function encodeDiagnosticWav(left, right, frames, sampleRate) {
  if (!Number.isInteger(frames) || frames < 0 || frames > left.length || frames > right.length) {
    throw new RangeError('Invalid diagnostic frame count');
  }
  const buffer = new ArrayBuffer(44 + frames * 8);
  const view = new DataView(buffer);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 8, true);
  view.setUint16(32, 8, true); view.setUint16(34, 32, true);
  text(36, 'data'); view.setUint32(40, frames * 8, true);
  for (let i = 0, offset = 44; i < frames; i++, offset += 8) {
    view.setFloat32(offset, left[i], true); view.setFloat32(offset + 4, right[i], true);
  }
  return buffer;
}

function defaultDownload(blob, name, document) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  // Safari may consume the URL after the click handler has returned.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opt-in capture of the existing Playground graph. Never starts or changes playback. */
export function createAudioDiagnostics({
  getSynth, getMetadata = () => ({}), host,
  workletUrl = new URL('../js/audio-diagnostic-worklet.js', import.meta.url),
  document = globalThis.document,
  AudioWorkletNodeClass = globalThis.AudioWorkletNode,
  download = (blob, name) => defaultDownload(blob, name, document),
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  seconds = MAX_SECONDS,
}) {
  let phase = 'idle', session = null, result = null, sequence = 0;
  let nativeCleanup = Promise.resolve();
  const panel = document.createElement('section');
  panel.className = 'audio-diagnostics';
  panel.setAttribute('aria-label', 'Audio diagnostics');
  const title = document.createElement('strong'); title.textContent = 'Audio diagnostics';
  const description = document.createElement('p');
  description.textContent = 'Record chip output and mixed output from the current playback. A clean recording cannot rule out audio-device dropouts.';
  const controls = document.createElement('div');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const buttons = {};
  const handlers = [];
  const addButton = (key, label, action) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    const listener = () => { void action(); };
    button.addEventListener('click', listener); handlers.push([button, listener]);
    controls.append(button); buttons[key] = button;
  };
  addButton('start', 'Record 30 s', start);
  addButton('stop', 'Stop recording', stop);
  addButton('mark', 'Mark noise', markNoise);
  addButton('chip', 'Save chip WAV', () => save('chip'));
  addButton('output', 'Save output WAV', () => save('output'));
  addButton('json', 'Save JSON', () => save('json'));
  addButton('close', 'Close diagnostics', dispose);
  panel.append(title, description, controls, status); host.append(panel);

  function update(message) {
    buttons.start.disabled = phase === 'disposed' || Boolean(session);
    buttons.stop.disabled = !session || phase === 'stopping';
    buttons.mark.disabled = phase !== 'recording';
    for (const key of ['chip', 'output', 'json']) buttons[key].disabled = !result || phase === 'disposed';
    if (result?.report.backend === 'native-genesis') buttons.chip.disabled = true;
    if (message) status.textContent = message;
  }
  update('Play audio with Run, then record here. Playback continues during recording.');

  function clean(active) {
    if (!active || active.cleaned) return;
    active.cleaned = true;
    clearTimer(active.timer);
    active.context?.removeEventListener('statechange', active.contextListener);
    if (active.native) {
      // Await a pending start before finalizing it. A new capture waits for this
      // cleanup barrier, so late IPC cannot leave a hidden capture or stop the
      // replacement capture. The result is deliberately discarded on cancel.
      nativeCleanup = finishNative(active).then(() => {}, () => {});
      return;
    }
    try { active.release?.(); } catch {}
    // Disconnect only our branch; the existing audible chip path stays connected.
    try { if (active.tap) active.raw.disconnect(active.tap, 0, 0); } catch {}
    try { active.bridge?.disconnect(); } catch {}
    if (active.tap) {
      active.tap.removeEventListener('processorerror', active.errorListener);
      active.tap.port.onmessage = null;
      try { active.tap.port.close(); } catch {}
      try { active.tap.disconnect(); } catch {}
    }
  }

  function fail(active, message) {
    if (session !== active) return;
    try { active.tap?.port.postMessage({type: 'cancel', id: active.id}); } catch {}
    clean(active); session = null; phase = 'idle'; update(message);
  }

  async function start() {
    if (phase === 'disposed' || session) return;
    const synth = getSynth();
    if (synth?.capabilities?.backend === 'native-genesis') return startNative(synth);
    const context = synth?.audioContext;
    if (context?.state !== 'running' || !synth.node || !synth.audio?.connectOutputMonitor) {
      update('Press Run to start audio before recording.'); return;
    }
    if (!Number.isFinite(context.sampleRate) || context.sampleRate < 1 || !AudioWorkletNodeClass) {
      update('Audio diagnostics are unavailable in this audio context.'); return;
    }
    description.textContent = 'Record chip output and mixed output from the current playback. A clean recording cannot rule out audio-device dropouts.';
    const capacity = Math.floor(Math.min(MAX_SECONDS, Math.max(0.001, Number(seconds) || MAX_SECONDS)) * context.sampleRate);
    const frames = Math.min(capacity, Math.floor(MAX_BYTES / 16));
    const active = {id: ++sequence, context, synth, raw: synth.node, capacity: frames, marks: [], droppedMarkers: 0};
    active.contextListener = () => {
      if (context.state === 'closed') fail(active, 'Recording cancelled: audio was closed.');
    };
    active.errorListener = () => fail(active, 'Recording cancelled: the diagnostic processor failed.');
    session = active; result = null; phase = 'preparing';
    context.addEventListener('statechange', active.contextListener);
    update('Preparing recording…');
    try {
      let loading = loadedModules.get(context);
      if (!loading) {
        loading = context.audioWorklet.addModule(workletUrl);
        loadedModules.set(context, loading);
        void loading.catch(() => { if (loadedModules.get(context) === loading) loadedModules.delete(context); });
      }
      await loading;
      if (session !== active) return;
      if (context.state !== 'running' || getSynth() !== synth || synth.node !== active.raw) {
        fail(active, 'Recording cancelled: the audio session changed.'); return;
      }
      active.metadata = getMetadata();
      active.requestedAtWallMs = now();
      active.tap = new AudioWorkletNodeClass(context, 'tetorica-audio-diagnostic', {
        numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit',
      });
      active.tap.addEventListener('processorerror', active.errorListener);
      active.tap.port.onmessage = ({data}) => receive(active, data);
      active.bridge = context.createGain();
      active.bridge.connect(active.tap, 0, 1);
      active.release = synth.audio.connectOutputMonitor(active.bridge);
      active.raw.connect(active.tap, 0, 0);
      // The tap emits silence. This connection only keeps its observation branch pulled.
      active.tap.connect(context.destination);
      // Allocate on Main, not in a running audio render callback.
      const channels = Array.from({length: 4}, () => new Float32Array(frames));
      active.timer = setTimer(() => fail(active, 'Recording cancelled: the audio processor did not respond.'), 5000);
      active.tap.port.postMessage({type: 'arm', id: active.id, channels}, channels.map(channel => channel.buffer));
    } catch (error) {
      fail(active, `Could not record audio: ${error.message ?? error}`);
    }
  }

  async function startNative(synth) {
    const context = synth.clock;
    if (context?.state !== 'running' || !synth.isReady?.() ||
        typeof synth.startOutputRecording !== 'function' || typeof synth.stopOutputRecording !== 'function') {
      update('Press Run to start audio before recording.'); return;
    }
    if (!Number.isInteger(context.sampleRate) || context.sampleRate < 8000 || context.sampleRate > 384000) {
      update('Audio diagnostics are unavailable for this native audio clock.'); return;
    }
    const requestedSeconds = Math.min(MAX_SECONDS, Math.max(0.001, Number(seconds) || MAX_SECONDS));
    const capacity = Math.min(Math.floor(requestedSeconds * context.sampleRate), Math.floor(MAX_BYTES / 8));
    const active = {id:++sequence, native:true, synth, context, capacity, marks:[], droppedMarkers:0};
    active.contextListener = () => {
      if (context.state !== 'running') fail(active, 'Recording cancelled: native audio was closed.');
    };
    session = active; result = null; phase = 'preparing';
    context.addEventListener?.('statechange', active.contextListener);
    description.textContent = 'Record the native final output, including samples and FX. Chip-only capture is unavailable. A clean recording cannot rule out audio-device dropouts.';
    update('Preparing native output recording…');
    try {
      await nativeCleanup;
      if (session !== active) return;
      if (getSynth() !== synth || context.state !== 'running') {
        fail(active, 'Recording cancelled: the audio session changed.'); return;
      }
      active.metadata = getMetadata(); active.requestedAtWallMs = now();
      active.nativeStart = Promise.resolve().then(() => synth.startOutputRecording({seconds:capacity/context.sampleRate}));
      await active.nativeStart;
      if (session !== active) return;
      if (getSynth() !== synth || context.state !== 'running') {
        fail(active, 'Recording cancelled: the audio session changed.'); return;
      }
      phase = 'recording';
      active.timer = setTimer(() => { void stop(); }, capacity/context.sampleRate*1000);
      update(`Recording native output up to ${(capacity/context.sampleRate).toFixed(1)} s. Playback is unchanged.`);
    } catch (error) { fail(active, `Could not record audio: ${error.message ?? error}`); }
  }

  function finishNative(active) {
    if (!active.nativeStart) return Promise.resolve();
    if (!active.nativeStop) active.nativeStop = active.nativeStart.then(() => active.synth.stopOutputRecording());
    return active.nativeStop;
  }

  async function stopNative(active) {
    clearTimer(active.timer);
    active.timer = setTimer(() => fail(active, 'Recording cancelled: no native result was received.'), 5000);
    try {
      const data = await finishNative(active);
      if (session !== active) return;
      if (getSynth() !== active.synth || active.context.state !== 'running') {
        fail(active, 'Recording cancelled: the audio session changed.'); return;
      }
      if (!Number.isSafeInteger(data?.frames) || data.frames < 0 || data.frames > active.capacity ||
          data.sampleRate !== active.context.sampleRate || !Number.isSafeInteger(data.firstFrame) || data.firstFrame < 0 ||
          !Array.isArray(data.channels) || data.channels.length !== 2 ||
          !data.channels.every(channel => channel instanceof Float32Array && channel.length === data.frames)) {
        fail(active, 'Recording cancelled: invalid native diagnostic data.'); return;
      }
      const {channels, ...capture} = data;
      result = {channels, report:{
        format:'tetorica-audio-diagnostic-v1', backend:'native-genesis',
        requestedAtWallMs:active.requestedAtWallMs, completedAtWallMs:now(),
        audioContext:null, nativeClock:{sampleRate:data.sampleRate}, metadata:active.metadata,
        capture, channelOrder:['output-left','output-right'],
        marks:active.marks.map(mark=>({...mark,frameOffset:Math.round(mark.audioTime*data.sampleRate)-data.firstFrame})),
        droppedMarkers:active.droppedMarkers,
        limitations:'Native final-output PCM precedes the audio device. Continuous capture frames do not prove that the device played without dropouts. Chip-only PCM is unavailable. Marker timing follows the Main-thread estimate of the native audio clock.',
      }};
      clean(active); session=null; phase='ready';
      update(`Recorded ${(data.frames/data.sampleRate).toFixed(2)} s of native output. Save output WAV and JSON.`);
    } catch (error) { fail(active, `Could not finish recording: ${error.message ?? error}`); }
  }

  function receive(active, data) {
    if (session !== active || data?.id !== active.id) return;
    if (data.type === 'error') {
      fail(active, `Recording cancelled: ${data.error ?? 'the diagnostic processor failed.'}`); return;
    }
    if (data.type === 'armed' && phase === 'preparing') {
      clearTimer(active.timer); active.timer = null;
      phase = 'recording';
      update(`Recording up to ${(active.capacity / active.context.sampleRate).toFixed(1)} s. Playback is unchanged.`);
      return;
    }
    if (data.type !== 'result') return;
    if (!Number.isInteger(data.frames) || data.frames < 0 || data.frames > active.capacity ||
        data.sampleRate !== active.context.sampleRate || !Array.isArray(data.channels) || data.channels.length !== 4 ||
        !data.channels.every(channel => channel instanceof Float32Array && channel.length >= data.frames && channel.length <= active.capacity)) {
      fail(active, 'Recording cancelled: invalid diagnostic data.'); return;
    }
    const {channels, type, id, ...capture} = data;
    result = {
      channels,
      report: {
        format: 'tetorica-audio-diagnostic-v1',
        requestedAtWallMs: active.requestedAtWallMs, completedAtWallMs: now(),
        audioContext: {sampleRate:active.context.sampleRate,
          baseLatency:Number.isFinite(active.context.baseLatency) ? active.context.baseLatency : null,
          outputLatency:Number.isFinite(active.context.outputLatency) ? active.context.outputLatency : null},
        metadata: active.metadata, capture,
        channelOrder: ['chip-left', 'chip-right', 'output-left', 'output-right'],
        marks: active.marks.map(mark => ({...mark, frameOffset: Number.isFinite(data.firstFrame)
          ? Math.round(mark.audioTime * data.sampleRate) - data.firstFrame : null})),
        droppedMarkers: active.droppedMarkers,
        limitations: 'Captured PCM precedes the audio device. Continuous capture frames do not prove that the device played without dropouts. Wall timings use coarse, non-monotonic Date.now and are not device-underrun counts. Marker timing follows the Main-thread audio clock.',
      },
    };
    clean(active); session = null; phase = 'ready';
    update(`Recorded ${(data.frames / data.sampleRate).toFixed(2)} s. Save both WAVs and JSON to compare.`);
  }

  function stop() {
    if (!session || phase === 'disposed' || phase === 'stopping') return;
    const active = session;
    if (phase === 'preparing') {
      fail(active, 'Recording cancelled before it started.'); return;
    }
    phase = 'stopping'; update('Finishing recording…');
    if (active.native) return stopNative(active);
    active.timer = setTimer(() => fail(active, 'Recording cancelled: no result was received.'), 3000);
    try { active.tap.port.postMessage({type: 'stop', id: active.id}); }
    catch (error) { fail(active, `Could not finish recording: ${error.message ?? error}`); }
  }

  function markNoise() {
    if (phase !== 'recording' || !session) return;
    if (session.marks.length >= MAX_MARKERS) { session.droppedMarkers++; return; }
    session.marks.push({audioTime: session.context.currentTime, wallTimeMs: now()});
    update(`Noise marked (${session.marks.length}). Recording continues.`);
  }

  function save(kind) {
    if (!result || phase === 'disposed') return;
    try {
      const {capture} = result.report;
      const prefix = `tetorica-audio-${result.report.requestedAtWallMs}`;
      if (kind === 'json') download(new Blob([JSON.stringify(result.report, null, 2)], {type: 'application/json'}), `${prefix}.json`);
      else if (kind === 'chip' || kind === 'output') {
        if (kind === 'chip' && result.report.backend === 'native-genesis') return;
        const offset = kind === 'chip' || result.report.backend === 'native-genesis' ? 0 : 2;
        download(new Blob([encodeDiagnosticWav(result.channels[offset], result.channels[offset + 1], capture.frames, capture.sampleRate)], {type: 'audio/wav'}), `${prefix}-${kind}.wav`);
      }
    } catch (error) { update(`Could not save recording: ${error.message ?? error}`); }
  }

  function cancel() {
    if (phase === 'disposed') return;
    if (session) fail(session, 'Recording cancelled.');
  }

  function dispose() {
    if (phase === 'disposed') return;
    cancel(); result = null; phase = 'disposed';
    for (const [button, listener] of handlers) button.removeEventListener('click', listener);
    update(); panel.remove();
  }

  return {element: panel, start, stop, cancel, markNoise, save, dispose,
    getState: () => ({phase, recording: phase === 'recording', hasResult: Boolean(result)}),
    getResult: () => result};
}
