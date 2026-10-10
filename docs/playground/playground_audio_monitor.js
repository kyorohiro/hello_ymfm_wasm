/** Observe final mixed audio. Analysis and canvas drawing stay outside the audio thread. */
export function createAudioMonitor(getAudio, {panel, waveCanvas, spectrumCanvas, channel, status}) {
  let visible = false, inView = true, frame = 0, lastDraw = 0;
  let audio = null, context = null, splitter = null, analysers = [], release = null;
  let samples = null, bins = null;
  let idleDrawn = false;

  function setStatus(message) {
    if (status.textContent !== message) status.textContent = message;
  }

  function detach() {
    release?.(); release = null;
    splitter?.disconnect();
    for (const analyser of analysers) analyser.disconnect();
    audio = context = splitter = null; analysers = [];
  }

  function attach(next) {
    detach();
    audio = next; context = next.audioContext;
    splitter = context.createChannelSplitter(2);
    analysers = [0, 1].map(index => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      analyser.minDecibels = -100; analyser.maxDecibels = 0;
      splitter.connect(analyser, index);
      return analyser;
    });
    release = audio.connectOutputMonitor(splitter);
    samples = new Float32Array(4096); bins = new Float32Array(2048);
    idleDrawn = false;
  }

  function axes(canvas, spectrum, sampleRate) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const left = 44, right = w - 18, top = 18, bottom = h - 30;
    ctx.fillStyle = '#101820'; ctx.fillRect(0, 0, w, h);
    ctx.font = '12px sans-serif';
    for (let j = 0; j <= 4; j++) {
      const y = top + (bottom - top) * j / 4;
      ctx.strokeStyle = '#33424e'; ctx.beginPath();
      ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      ctx.fillStyle = '#bcc8d2';
      ctx.fillText(String(spectrum ? -25 * j : 1 - j / 2), 5, y + 4);
    }
    ctx.fillText(spectrum ? 'dBFS' : 'amplitude', left, 12);
    if (spectrum) {
      const max = sampleRate / 2;
      for (const hz of [20, 100, 1000, 10000, max]) {
        if (hz > max || (hz === 10000 && max < 15000)) continue;
        const x = left + Math.log(hz / 20) / Math.log(max / 20) * (right - left);
        if (hz !== max && x > right - 105) continue;
        ctx.fillText(hz >= 1000 ? `${(hz / 1000).toFixed(1)}k Hz` : `${hz} Hz`, Math.min(right - 50, x), h - 8);
      }
    } else {
      for (let j = 0; j <= 4; j++) ctx.fillText(`${j * 5} ms`, left + (right - left) * j / 4 - (j === 4 ? 32 : 0), h - 8);
    }
    return {ctx, left, right, top, bottom};
  }

  function draw(sampleRate) {
    const wave = axes(waveCanvas, false, sampleRate);
    const count = Math.min(Math.round(sampleRate * .02), samples.length / 2);
    // Start on a rising zero crossing for a steady view of periodic signals.
    let start = 0;
    for (let i = 1; i < samples.length - count; i++) {
      if (samples[i - 1] <= 0 && samples[i] > 0) { start = i; break; }
    }
    wave.ctx.strokeStyle = '#69cfff'; wave.ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = wave.left + i / (count - 1) * (wave.right - wave.left);
      const y = wave.top + (1 - Math.max(-1, Math.min(1, samples[start + i]))) / 2 * (wave.bottom - wave.top);
      if (i) wave.ctx.lineTo(x, y); else wave.ctx.moveTo(x, y);
    }
    wave.ctx.stroke();
    const fft = axes(spectrumCanvas, true, sampleRate);
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

  function tick(time) {
    frame = 0;
    if (!visible || !inView || document.hidden) return;
    frame = requestAnimationFrame(tick);
    if (time - lastDraw < 1000 / 30) return;
    lastDraw = time;
    const next = getAudio();
    if (!next?.masterOutputNode || !next.audioContext || next.audioContext.state === 'closed') {
      detach();
      if (!idleDrawn) {
        samples = new Float32Array(4096); bins = new Float32Array(2048).fill(-100);
        draw(48000);
        idleDrawn = true;
      }
      setStatus('Press Run to observe audio.');
      return;
    }
    if (audio !== next || context !== next.audioContext || !next.outputMonitors.has(splitter)) attach(next);
    const analyser = analysers[Number(channel.value) || 0];
    analyser.getFloatTimeDomainData(samples); analyser.getFloatFrequencyData(bins);
    draw(context.sampleRate);
    setStatus(`${context.sampleRate} Hz · ${channel.value === '1' ? 'Right' : 'Left'} · mixed output after effects and volume`);
  }

  function refresh() {
    cancelAnimationFrame(frame); frame = 0;
    if (visible && inView && !document.hidden) frame = requestAnimationFrame(tick);
    else detach();
  }
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
    },
  };
}
