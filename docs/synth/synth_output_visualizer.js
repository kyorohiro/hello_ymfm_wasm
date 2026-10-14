// Observe the sum of the live and looper output buses without routing audio
// through the canvas monitor or adding another connection to the speakers.
export function createSynthOutputVisualizer() {
  let analyser = null;
  let sources = [];
  const waveform = new Float32Array(2048);
  const spectrum = new Float32Array(1024);

  function disconnect() {
    for (const source of sources) {
      try { source.disconnect(analyser); } catch {}
    }
    analyser?.disconnect();
    sources = [];
    analyser = null;
  }

  function connect(audioContext, outputBuses) {
    disconnect();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = waveform.length;
    analyser.minDecibels = -90;
    analyser.maxDecibels = 0;
    analyser.smoothingTimeConstant = 0.75;
    sources = outputBuses;
    for (const source of sources) source.connect(analyser);
  }

  function draw(canvas, context, mode) {
    const {width, height} = canvas;
    const left = 38, right = width - 18, top = 14, bottom = height - 25;
    const w = right - left, h = bottom - top;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#10191a';
    context.fillRect(0, 0, width, height);
    context.font = '11px sans-serif';
    context.lineWidth = 1;
    context.strokeStyle = '#284642';
    context.fillStyle = '#a8bfba';
    for (let i = 0; i <= 4; i++) {
      const y = top + h * i / 4;
      context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke();
      context.fillText(mode === 'waveform' ? (1 - i / 2).toFixed(1) : String(-i * 22.5), 2, y + 4);
    }
    context.strokeStyle = '#7be0d6';
    context.lineWidth = 2;
    context.beginPath();
    if (mode === 'waveform') {
      waveform.fill(0);
      analyser?.getFloatTimeDomainData(waveform);
      // Anchor to a rising zero crossing to keep held notes easier to inspect.
      let start = 0;
      for (let i = 1; i < waveform.length / 2; i++) {
        if (waveform[i - 1] < 0 && waveform[i] >= 0) { start = i; break; }
      }
      const count = waveform.length / 2;
      for (let i = 0; i < count; i++) {
        const x = left + w * i / (count - 1);
        const y = top + h * (1 - Math.max(-1, Math.min(1, waveform[start + i]))) / 2;
        if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.stroke();
      const milliseconds = count / (analyser?.context.sampleRate ?? 48000) * 1000;
      context.fillText('0 ms', left, height - 6);
      context.fillText(`${milliseconds.toFixed(1)} ms`, right - 55, height - 6);
    } else {
      spectrum.fill(-Infinity);
      analyser?.getFloatFrequencyData(spectrum);
      const rate = analyser?.context.sampleRate ?? 48000;
      const maxHz = Math.min(20000, rate / 2);
      const logRange = Math.log(maxHz / 20);
      for (let pixel = 0; pixel <= Math.ceil(w); pixel++) {
        const hz = 20 * Math.exp(logRange * pixel / w);
        const nextHz = 20 * Math.exp(logRange * (pixel + 1) / w);
        const first = Math.max(1, Math.floor(hz * waveform.length / rate));
        const last = Math.min(spectrum.length - 1, Math.ceil(nextHz * waveform.length / rate));
        let db = -90;
        for (let bin = first; bin <= last; bin++) db = Math.max(db, spectrum[bin]);
        const y = top + h * (1 - Math.max(0, Math.min(1, (db + 90) / 90)));
        if (pixel === 0) context.moveTo(left, y); else context.lineTo(Math.min(right, left + pixel), y);
      }
      context.stroke();
      for (const hz of [20, 100, 1000, 10000]) {
        if (hz > maxHz) continue;
        const x = left + w * Math.log(hz / 20) / logRange;
        context.fillText(hz >= 1000 ? `${hz / 1000}k Hz` : `${hz} Hz`, x, height - 6);
      }
    }
  }

  return {connect, disconnect, draw};
}
