// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.

const FFT_SIZE = 2048;
const FRAME_INTERVAL = 1000 / 30;
const QUIET_RMS = .00003;
const QUIET_MILLISECONDS = 400;
const HISTORY_LENGTH = 180;
const MODES = new Set(['envelope', 'waveform', 'spectrum']);

/** Observe the final output on a passive branch. The analyser never connects to
 * the speakers, and canvas work never sends messages to the audio processor.
 * `setRunning(false)` lets the measured release/reverb tail reach silence before
 * sleeping. A hidden document or setVisible(false) cancels canvas animation.
 * The optional envelopeCanvas shows measured output-level history, independently
 * of the instrument's ADSR editor. Its vertical axis is RMS in dBFS.
 * onLevel receives {rms, peak, db}; it is a reused, read-only callback value.
 */
export function createSpuOutputVisualizer({canvas, envelopeCanvas = null, onLevel = () => {},
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  document: documentNode = globalThis.document} = {}) {
  const context2d = canvas?.getContext('2d') ?? null;
  const envelope2d = envelopeCanvas?.getContext('2d') ?? null;
  const waveform = new Float32Array(FFT_SIZE);
  const spectrum = new Float32Array(FFT_SIZE / 2);
  const history = new Float32Array(HISTORY_LENGTH);
  const level = {rms: 0, peak: 0, db: -90};
  let analyser = null, source = null, audioContext = null;
  let mode = 'envelope', running = false, tailing = false, visible = true, disposed = false;
  let frame = null, previousTime = -Infinity, quietSince = null, historyPosition = 0;

  const canAnimate = () => !disposed && visible && !documentNode?.hidden && analyser &&
    audioContext?.state === 'running' && (running || tailing);
  function cancel() {
    if (frame !== null) cancelFrame?.(frame);
    frame = null;
  }
  function schedule() {
    if (frame === null && canAnimate()) frame = requestFrame?.(animate) ?? null;
  }
  function stateChanged() {
    if (!canAnimate()) cancel();
    else {previousTime = -Infinity; schedule();}
  }
  function visibilityChanged() {
    if (documentNode.hidden) cancel();
    else {previousTime = -Infinity; schedule();}
  }
  documentNode?.addEventListener?.('visibilitychange', visibilityChanged);

  function sample() {
    waveform.fill(0);
    analyser?.getFloatTimeDomainData(waveform);
    let sum = 0, peak = 0;
    for (let i = 0; i < waveform.length; i++) {
      const value = Number.isFinite(waveform[i]) ? waveform[i] : 0;
      waveform[i] = value;
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    level.rms = Math.sqrt(sum / waveform.length);
    level.peak = peak;
    level.db = Math.max(-90, 20 * Math.log10(Math.max(level.rms, 1e-12)));
    history[historyPosition] = Math.min(1, level.rms);
    historyPosition = (historyPosition + 1) % history.length;
    if (mode === 'spectrum') readSpectrum();
    onLevel(level);
  }
  function readSpectrum() {
    spectrum.fill(-90);
    analyser?.getFloatFrequencyData(spectrum);
  }
  function animate(time) {
    frame = null;
    if (!canAnimate()) return;
    if (time - previousTime >= FRAME_INTERVAL - .1) {
      previousTime = time;
      sample();
      draw();
      if (!running && level.rms < QUIET_RMS) {
        quietSince ??= time;
        if (time - quietSince >= QUIET_MILLISECONDS) tailing = false;
      } else quietSince = null;
    }
    schedule();
  }
  function drawEnvelope() {
    if (!envelope2d) return;
    const ctx = envelope2d, {width, height} = envelopeCanvas;
    ctx.clearRect(0, 0, width, height);
    const left = 42, right = width - 18, top = 30, bottom = height - 29;
    const h = Math.max(1, bottom - top);
    ctx.fillStyle = '#15191c'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#36444b'; ctx.fillStyle = '#b6c4cb';
    ctx.lineWidth = 1; ctx.font = '11px sans-serif';
    for (let i = 0; i <= 4; i++) {
      const y = top + h * i / 4;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      ctx.fillText(String(-i * 22.5), 3, y + 4);
    }
    ctx.fillText('OUTPUT RMS · recent history', left, 14);
    ctx.fillText(`${level.db.toFixed(1)} dBFS`, Math.max(left, right - 88), 14);
    // Frame delivery may be throttled, so do not label a fixed elapsed time.
    ctx.fillText('Older', left, height - 8);
    ctx.fillText('Now', right - 24, height - 8);
    ctx.strokeStyle = '#75d8e9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < history.length; i++) {
      const value = history[(historyPosition + i) % history.length];
      const db = Math.max(-90, Math.min(0, 20 * Math.log10(Math.max(value, 1e-12))));
      const x = left + (right - left) * i / (history.length - 1);
      const y = top + h * -db / 90;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  function draw() {
    if (mode === 'envelope') {drawEnvelope(); return;}
    if (!context2d) return;
    const ctx = context2d, {width, height} = canvas;
    const left = 42, right = width - 18, top = 16, bottom = height - 29;
    const w = Math.max(1, right - left), h = Math.max(1, bottom - top);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#15191c'; ctx.fillRect(0, 0, width, height);
    ctx.font = '11px sans-serif'; ctx.lineWidth = 1;
    ctx.strokeStyle = '#36444b'; ctx.fillStyle = '#b6c4cb';
    for (let i = 0; i <= 4; i++) {
      const y = top + h * i / 4;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      ctx.fillText(mode === 'waveform' ? (1 - i / 2).toFixed(1) : String(-i * 22.5), 3, y + 4);
    }
    const sampleRate = audioContext?.sampleRate ?? 48000;
    ctx.strokeStyle = '#75d8e9'; ctx.lineWidth = 2; ctx.beginPath();
    if (mode === 'waveform') {
      let start = 0;
      for (let i = 1; i < waveform.length / 2; i++) {
        if (waveform[i - 1] < 0 && waveform[i] >= 0) {start = i; break;}
      }
      const count = waveform.length / 2;
      for (let i = 0; i < count; i++) {
        const x = left + w * i / (count - 1);
        const y = top + h * (1 - Math.max(-1, Math.min(1, waveform[start + i]))) / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillText('0 ms', left, height - 8);
      ctx.fillText(`${(count / sampleRate * 1000).toFixed(1)} ms`, right - 55, height - 8);
    } else {
      const maxHz = Math.min(20000, sampleRate / 2);
      const logRange = Math.log(Math.max(21, maxHz) / 20);
      const pixels = Math.ceil(w);
      for (let pixel = 0; pixel <= pixels; pixel++) {
        const hz = 20 * Math.exp(logRange * pixel / pixels);
        const nextHz = 20 * Math.exp(logRange * (pixel + 1) / pixels);
        const first = Math.max(1, Math.min(spectrum.length - 1, Math.floor(hz * FFT_SIZE / sampleRate)));
        const last = Math.min(spectrum.length - 1, Math.ceil(nextHz * FFT_SIZE / sampleRate));
        let db = -90;
        for (let bin = first; bin <= last; bin++) if (Number.isFinite(spectrum[bin])) db = Math.max(db, spectrum[bin]);
        const y = top + h * (1 - Math.max(0, Math.min(1, (db + 90) / 90)));
        if (pixel === 0) ctx.moveTo(left, y); else ctx.lineTo(left + w * pixel / pixels, y);
      }
      ctx.stroke();
      for (const hz of [20, 100, 1000, 10000]) {
        if (hz > maxHz) continue;
        const x = left + w * Math.log(hz / 20) / logRange;
        ctx.fillText(hz >= 1000 ? `${hz / 1000}k Hz` : `${hz} Hz`, x, height - 8);
      }
    }
    ctx.fillStyle = '#b6c4cb';
    ctx.fillText(`RMS ${level.db.toFixed(1)} dBFS`, Math.max(left, right - 125), top + 12);
  }
  function stop() {
    cancel();
    running = tailing = false;
    quietSince = null; previousTime = -Infinity;
    waveform.fill(0); spectrum.fill(-90); history.fill(0); historyPosition = 0;
    level.rms = level.peak = 0; level.db = -90;
    onLevel(level);
    draw();
  }
  function disconnect() {
    if (source && analyser) {try {source.disconnect(analyser);} catch {}}
    analyser?.disconnect();
    audioContext?.removeEventListener?.('statechange', stateChanged);
    analyser = source = audioContext = null;
    stop();
  }
  return {
    connect(context, outputSource) {
      if (disposed) throw new Error('SPU output visualizer is disposed');
      if (context === audioContext && outputSource === source) return;
      disconnect();
      audioContext = context; source = outputSource;
      analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.minDecibels = -90; analyser.maxDecibels = 0;
      analyser.smoothingTimeConstant = .7;
      source.connect(analyser);
      audioContext.addEventListener?.('statechange', stateChanged);
      draw();
    },
    setMode(value) {
      if (!MODES.has(value)) throw new RangeError('SPU visualizer mode must be envelope, waveform, or spectrum');
      mode = value;
      if (!disposed) {
        if (mode === 'spectrum' && (running || tailing)) readSpectrum();
        draw(); schedule();
      }
    },
    setRunning(value) {
      if (disposed) return;
      const wasRunning = running;
      running = Boolean(value);
      if (running) {
        tailing = true; quietSince = null;
        // Parameter/note state events may arrive faster than display frames.
        // Repeated active notifications must not reset the 30 fps limiter.
        if (!wasRunning) previousTime = -Infinity;
      }
      schedule();
    },
    setVisible(value) {
      visible = Boolean(value);
      if (!visible) cancel();
      else {previousTime = -Infinity; schedule();}
    },
    // A master/reverb/live-envelope edit can make a quiet Release audible
    // without acquiring another held note. Observe that tail, preserving the
    // key-held flag and the frame limiter during repeated parameter gestures.
    wake() {
      if (disposed || !analyser) return;
      if (frame === null) previousTime = -Infinity;
      tailing = true; quietSince = null;
      schedule();
    },
    get level() {return {...level};},
    getStats() {return {...level, mode, animating: frame !== null, running, tailing};},
    stop,
    disconnect,
    dispose() {
      if (disposed) return;
      disposed = true;
      disconnect();
      documentNode?.removeEventListener?.('visibilitychange', visibilityChanged);
    },
  };
}
