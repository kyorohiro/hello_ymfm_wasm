import {createMonitorScale, normalizeMonitorRange, formatMonitorAmplitude} from './playground_monitor_scale.js';

/** Read Web Audio analyser snapshots and draw the mixed output without changing audible routing. */
export function createAudioMonitor(getAudio, {
  panel, envelopeCanvas, waveCanvas, spectrumCanvas, modeSelect, modePanels = {},
  channel, status, pauseButton, description, storage, getSourceLabel = () => '',
  scaleSelect, scaleControl,
}) {
  const modes = ['envelope', 'waveform', 'spectrum'];
  const preferenceKey = 'tetorica.playground.audioMonitorMode';
  const rangeKey = 'tetorica.playground.audioMonitorRange';
  let mode = 'envelope';
  let range = 'auto';
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    const savedMode = storage?.getItem(preferenceKey);
    if (modes.includes(savedMode)) mode = savedMode;
    range = normalizeMonitorRange(storage?.getItem(rangeKey));
  } catch { /* Storage can be unavailable in embedded/private browsing. */ }
  if (scaleSelect) scaleSelect.value = range;
  const autoScale = createMonitorScale();
  let visible = false, inView = true, paused = false, frame = 0, lastDraw = -Infinity;
  let audio = null, context = null, splitter = null, analyser = null, release = null;
  let selectedChannel = 0;
  let samples = null, bins = null;
  let idleDrawn = false;
  let hasSnapshot = false, snapshotRate = 48000, snapshotTime = 0;
  // Bounded snapshot history, with real elapsed time on the horizontal axis.
  const historyTimes = new Float64Array(80);
  const historyRms = new Float32Array(80), historyPeaks = new Float32Array(80);
  let historyHead = 0, historySize = 0;

  function resetHistory() { historyHead = historySize = 0; }

  function resetObservation() {
    resetHistory(); autoScale.reset(); hasSnapshot = false;
  }

  function amplitudeRange(peak, time) {
    return range === 'auto' ? autoScale.update(peak, time) : Number(range);
  }

  function updateModeUI() {
    modeSelect.value = mode;
    if (scaleControl) scaleControl.hidden = mode === 'spectrum';
    for (const name of modes) if (modePanels[name]) modePanels[name].hidden = name !== mode;
    if (description) description.textContent = {
      envelope: 'Last 5 seconds · RMS (blue) and sampled peak (orange). Y selects Auto or a fixed amplitude range.',
      waveform: 'Waveform over 20 milliseconds. Y selects Auto or a fixed ±amplitude range.',
      spectrum: 'Spectrum: −100 to 0 dBFS · 4096-point FFT · logarithmic frequency axis.',
    }[mode] + ' Up to 15 updates/sec. Mixed output after effects and master volume. Pause stops analysis while audio keeps playing.';
  }
  updateModeUI();

  function setStatus(message) {
    if (status.textContent !== message) status.textContent = message;
  }

  function detach() {
    release?.(); release = null;
    splitter?.disconnect();
    analyser?.disconnect();
    audio = context = splitter = analyser = null;
    // Keep the last snapshot available for display-only range changes in Pause.
  }

  function attach(next) {
    detach();
    resetObservation();
    audio = next; context = next.audioContext;
    splitter = context.createChannelSplitter(2);
    selectedChannel = Number(channel.value) === 1 ? 1 : 0;
    analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -100; analyser.maxDecibels = 0;
    splitter.connect(analyser, selectedChannel);
    release = audio.connectOutputMonitor(splitter);
    samples = new Float32Array(4096); bins = new Float32Array(2048);
    idleDrawn = false;
  }

  function axes(canvas, kind, sampleRate, yRange = 1) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const left = 64, right = w - 18, top = 18, bottom = h - 30;
    ctx.fillStyle = '#101820'; ctx.fillRect(0, 0, w, h);
    ctx.font = '12px sans-serif';
    for (let j = 0; j <= 4; j++) {
      const y = top + (bottom - top) * j / 4;
      ctx.strokeStyle = '#33424e'; ctx.beginPath();
      ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      ctx.fillStyle = '#bcc8d2';
      ctx.fillText(kind === 'spectrum' ? String(-25 * j) : formatMonitorAmplitude(yRange * (kind === 'envelope' ? 1 - j / 4 : 1 - j / 2)), 5, y + 4);
    }
    ctx.fillText(kind === 'spectrum' ? 'dBFS' : 'amplitude', left, 12);
    if (kind === 'spectrum') {
      const max = sampleRate / 2;
      for (const hz of [20, 100, 1000, 10000, max]) {
        if (hz > max || (hz === 10000 && max < 15000)) continue;
        const x = left + Math.log(hz / 20) / Math.log(max / 20) * (right - left);
        if (hz !== max && x > right - 105) continue;
        ctx.fillText(hz >= 1000 ? `${(hz / 1000).toFixed(1)}k Hz` : `${hz} Hz`, Math.min(right - 50, x), h - 8);
      }
    } else if (kind === 'envelope') {
      for (let j = 0; j <= 5; j++) ctx.fillText(j === 5 ? 'now' : `${j - 5} s`, left + (right - left) * j / 5 - (j === 5 ? 24 : 0), h - 8);
    } else {
      for (let j = 0; j <= 4; j++) ctx.fillText(`${j * 5} ms`, left + (right - left) * j / 4 - (j === 4 ? 32 : 0), h - 8);
    }
    return {ctx, left, right, top, bottom};
  }

  function drawEnvelope(time, capture) {
    if (capture) {
      let sum = 0, peak = 0;
      for (let i = 0; i < samples.length; i++) {
        const value = samples[i];
        sum += value * value; peak = Math.max(peak, Math.abs(value));
      }
      historyTimes[historyHead] = time;
      historyRms[historyHead] = Math.sqrt(sum / samples.length);
      historyPeaks[historyHead] = peak;
      historyHead = (historyHead + 1) % historyTimes.length;
      historySize = Math.min(historySize + 1, historyTimes.length);
    }
    let visiblePeak = 0;
    for (let j = 0; j < historySize; j++) {
      const i = (historyHead - historySize + j + historyTimes.length) % historyTimes.length;
      if (time - historyTimes[i] <= 5000) visiblePeak = Math.max(visiblePeak, historyPeaks[i]);
    }
    const yRange = amplitudeRange(visiblePeak, time);
    const plot = axes(envelopeCanvas, 'envelope', undefined, yRange);
    for (const [values, color] of [[historyRms, '#69cfff'], [historyPeaks, '#ffba69']]) {
      plot.ctx.strokeStyle = color; plot.ctx.beginPath();
      let started = false;
      for (let j = 0; j < historySize; j++) {
        const i = (historyHead - historySize + j + historyTimes.length) % historyTimes.length;
        const age = time - historyTimes[i];
        if (age > 5000) continue;
        const x = plot.right - age / 5000 * (plot.right - plot.left);
        const y = plot.bottom - Math.min(1, values[i] / yRange) * (plot.bottom - plot.top);
        if (started) plot.ctx.lineTo(x, y); else { plot.ctx.moveTo(x, y); started = true; }
      }
      plot.ctx.stroke();
    }
  }

  function drawWaveform(sampleRate, time) {
    const count = Math.min(Math.round(sampleRate * .02), samples.length / 2);
    // Start on a rising zero crossing for a steady view of periodic signals.
    let start = 0;
    for (let i = 1; i < samples.length - count; i++) {
      if (samples[i - 1] <= 0 && samples[i] > 0) { start = i; break; }
    }
    let peak = 0;
    for (let i = 0; i < count; i++) peak = Math.max(peak, Math.abs(samples[start + i]));
    const yRange = amplitudeRange(peak, time);
    const wave = axes(waveCanvas, 'waveform', sampleRate, yRange);
    wave.ctx.strokeStyle = '#69cfff'; wave.ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = wave.left + i / (count - 1) * (wave.right - wave.left);
      const y = wave.top + (1 - Math.max(-1, Math.min(1, samples[start + i] / yRange))) / 2 * (wave.bottom - wave.top);
      if (i) wave.ctx.lineTo(x, y); else wave.ctx.moveTo(x, y);
    }
    wave.ctx.stroke();
  }

  function drawSpectrum(sampleRate) {
    const fft = axes(spectrumCanvas, 'spectrum', sampleRate);
    fft.ctx.strokeStyle = '#ffba69'; fft.ctx.beginPath();
    // Take the strongest FFT bin in each screen column so narrow peaks remain visible.
    const max = sampleRate / 2, binHz = sampleRate / 4096;
    const width = fft.right - fft.left;
    for (let x = 0; x <= width; x++) {
      const from = 20 * (max / 20) ** (x / width);
      const to = 20 * (max / 20) ** ((x + 1) / width);
      const first = Math.min(bins.length - 1, Math.max(1, Math.floor(from / binHz)));
      const last = Math.min(bins.length - 1, Math.max(first, Math.ceil(to / binHz) - 1));
      let db = -100;
      for (let i = first; i <= last; i++) db = Math.max(db, bins[i]);
      const y = fft.top + Math.max(0, Math.min(1, -db / 100)) * (fft.bottom - fft.top);
      if (x) fft.ctx.lineTo(fft.left + x, y); else fft.ctx.moveTo(fft.left, y);
    }
    fft.ctx.stroke();
  }

  function draw(sampleRate, time, capture = false) {
    if (capture) { hasSnapshot = true; snapshotRate = sampleRate; snapshotTime = time; }
    if (mode === 'envelope') drawEnvelope(time, capture);
    else if (mode === 'waveform') drawWaveform(sampleRate, time);
    else drawSpectrum(sampleRate);
  }

  function drawIdle() {
    resetObservation();
    samples = new Float32Array(4096); bins = new Float32Array(2048).fill(-100);
    draw(48000, 0);
    idleDrawn = true;
  }

  function tick(time) {
    frame = 0;
    if (!visible || !inView || paused || document.hidden) return;
    frame = requestAnimationFrame(tick);
    if (time - lastDraw < 1000 / 15) return;
    lastDraw = time;
    const next = getAudio();
    const sourceLabel = getSourceLabel();
    if (!next?.masterOutputNode || !next.audioContext || next.audioContext.state === 'closed') {
      detach();
      if (!idleDrawn) drawIdle();
      setStatus(sourceLabel ? `${sourceLabel} · Play a note to observe audio.` : 'Press Run to observe audio.');
      return;
    }
    if (audio !== next || context !== next.audioContext || !next.outputMonitors.has(splitter) || selectedChannel !== (Number(channel.value) === 1 ? 1 : 0)) attach(next);
    if (mode === 'spectrum') analyser.getFloatFrequencyData(bins);
    else analyser.getFloatTimeDomainData(samples);
    draw(context.sampleRate, time, true);
    setStatus(`${sourceLabel ? sourceLabel + ' · ' : ''}${context.sampleRate} Hz · ${channel.value === '1' ? 'Right' : 'Left'} · mixed output after effects and volume`);
  }
  function changeMode() {
    mode = modes.includes(modeSelect.value) ? modeSelect.value : 'envelope';
    try { storage?.setItem(preferenceKey, mode); } catch { /* Analysis works without persistence. */ }
    updateModeUI(); resetObservation(); idleDrawn = false; lastDraw = -Infinity;
    if (visible && inView && paused && !document.hidden) drawIdle();
    refresh();
  }
  modeSelect.addEventListener('change', changeMode);

  function changeScale() {
    range = normalizeMonitorRange(scaleSelect.value);
    scaleSelect.value = range;
    try { storage?.setItem(rangeKey, range); } catch { /* The display also works without storage. */ }
    autoScale.reset();
    if (visible && inView && !document.hidden && mode !== 'spectrum') {
      if (hasSnapshot) draw(snapshotRate, snapshotTime);
      else drawIdle();
    }
  }
  scaleSelect?.addEventListener('change', changeScale);

  function refresh() {
    cancelAnimationFrame(frame); frame = 0;
    if (visible && inView && !paused && !document.hidden) frame = requestAnimationFrame(tick);
    else detach();
  }
  function togglePause() {
    paused = !paused;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
    pauseButton.setAttribute('aria-pressed', String(paused));
    if (paused) setStatus('Analysis paused. Audio playback continues.');
    lastDraw = -Infinity;
    refresh();
  }
  pauseButton?.addEventListener('click', togglePause);
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting; refresh();
  }) : null;
  observer?.observe(panel);
  document.addEventListener('visibilitychange', refresh);
  const onPageHide = () => { visible = false; refresh(); };
  window.addEventListener('pagehide', onPageHide);
  return {
    setVisible(value) { visible = Boolean(value); refresh(); },
    dispose() {
      visible = false; refresh(); observer?.disconnect();
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pagehide', onPageHide);
      pauseButton?.removeEventListener('click', togglePause);
      modeSelect.removeEventListener('change', changeMode);
      scaleSelect?.removeEventListener('change', changeScale);
    },
  };
}
