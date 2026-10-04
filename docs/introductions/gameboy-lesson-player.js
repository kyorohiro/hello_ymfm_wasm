/** Finite preview playback shared by interactive Game Boy lessons. */
export function attachLesson({read, code, render, draw, clear, reset}) {
  const status = document.querySelector('#status');
  let context, active, generation = 0;
  function stop() {
    generation++;
    if (!active) return;
    const {source, gain, audio} = active;
    const now = audio.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + .01);
    source.stop(now + .015);
    active = null;
  }
  function update() {
    stop(); clear();
    const text = code(read());
    document.querySelector('#code').textContent = text;
    document.querySelector('#lesson-source').textContent = text;
    document.dispatchEvent(new CustomEvent('playground-source-change', {detail: {id: 'lesson-source'}}));
    status.textContent = '再生して、設定の違いを聴き比べてください。';
  }
  document.querySelector('#play').addEventListener('click', async () => {
    stop(); const run = generation;
    try {
      const settings = read();
      context ??= new AudioContext();
      const audio = context;
      await audio.resume();
      if (run !== generation) return;
      status.textContent = '音を準備しています…';
      const pcm = await render(settings, {sampleRate: audio.sampleRate});
      if (run !== generation) return;
      draw(pcm);
      const buffer = audio.createBuffer(2, pcm.left.length, pcm.sampleRate);
      buffer.copyToChannel(pcm.left, 0); buffer.copyToChannel(pcm.right, 1);
      const source = audio.createBufferSource(), gain = audio.createGain();
      source.buffer = buffer; source.connect(gain); gain.connect(audio.destination);
      const now = audio.currentTime;
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.7, now + .01);
      gain.gain.setValueAtTime(.7, now + buffer.duration - .01);
      gain.gain.linearRampToValueAtTime(0, now + buffer.duration);
      active = {source, gain, audio};
      source.onended = () => {
        source.disconnect(); gain.disconnect();
        if (run === generation) { active = null; status.textContent = '再生が終了しました。'; }
      };
      source.start(); status.textContent = `${buffer.duration}秒間再生しています。`;
    } catch (error) {
      if (run === generation) { stop(); status.textContent = `再生できませんでした：${error.message}`; }
    }
  });
  document.querySelector('#stop').addEventListener('click', () => { stop(); status.textContent = '停止しました。'; });
  document.querySelector('#reset').addEventListener('click', () => { reset(); update(); status.textContent = '初期値に戻しました。'; });
  document.querySelector('#copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code(read())); status.textContent = 'コードをコピーしました。'; }
    catch { status.textContent = '下のコードを選択してコピーしてください。'; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); status.textContent = 'ページを離れたため停止しました。'; } });
  window.addEventListener('pagehide', () => { stop(); if (context) { void context.close(); context = null; } });
  update();
  return {update, stop};
}

export function blankCanvas(canvas, text) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#61716a'; ctx.font = '18px sans-serif'; ctx.fillText(text, 24, 110);
  canvas.setAttribute('aria-label', text);
}
export function drawTrace(canvas, values, {min = 0, max, label, duration}) {
  const ctx = canvas.getContext('2d'), w = canvas.width - 80, h = canvas.height - 60;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#ccd7ce'; ctx.beginPath(); ctx.moveTo(50, 20); ctx.lineTo(50, 20 + h); ctx.lineTo(50 + w, 20 + h); ctx.stroke();
  ctx.fillStyle = '#61716a'; ctx.font = '16px sans-serif';
  ctx.fillText(String(max), 5, 30); ctx.fillText(String(min), 5, 20 + h);
  ctx.fillText('0', 50, canvas.height - 10); ctx.fillText(duration, canvas.width - 95, canvas.height - 10);
  ctx.strokeStyle = '#276449'; ctx.lineWidth = 2; ctx.beginPath();
  values.forEach((value, i) => { const x = 50 + i / (values.length - 1) * w, y = 20 + h * (1 - (value - min) / (max - min)); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke(); canvas.setAttribute('aria-label', label);
}
