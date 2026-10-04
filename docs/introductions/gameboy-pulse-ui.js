import {DEFAULT_PULSE, pulseCode, renderPulse} from './gameboy-pulse.js';

const form = document.querySelector('#pulse-controls');
const status = document.querySelector('#status');
const canvas = document.querySelector('#waveform');
const ctx = canvas.getContext('2d');
let context, source, gain, generation = 0;

function settings() {
  return {channel: Number(form.elements.channel.value), duty: Number(form.elements.duty.value),
    note: form.elements.note.value, volume: Number(form.elements.volume.value)};
}

function updateCode() {
  const code = pulseCode(settings());
  document.querySelector('#pulse-source').textContent = code;
  document.querySelector('#code').textContent = code;
  document.dispatchEvent(new CustomEvent('playground-source-change', {detail: {id: 'pulse-source'}}));
}

function clearWaveform() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#61716a';
  ctx.font = '18px sans-serif';
  ctx.fillText('再生すると、生成したPCMを表示します', 20, 100);
}

function drawWaveform(pcm) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const start = Math.round(pcm.sampleRate * 0.1);
  const count = Math.round(pcm.sampleRate * 0.012);
  ctx.strokeStyle = '#ccd7ce';
  ctx.beginPath(); ctx.moveTo(0, 110); ctx.lineTo(canvas.width, 110); ctx.stroke();
  ctx.strokeStyle = '#276449'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const x = i / (count - 1) * canvas.width;
    const y = 110 - pcm.left[start + i] * 360;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  canvas.setAttribute('aria-label', `${form.elements.duty.value * 100}%、${form.elements.note.value}の生成PCM、発音開始100 ms後から12 ms、固定振幅スケール`);
}

function stop() {
  generation++;
  if (source) {
    source.onended = null;
    // A short fade also handles stop/replay clicks without an abrupt buffer cut.
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.01);
    source.stop(now + 0.015);
    const oldSource = source, oldGain = gain;
    oldSource.onended = () => { oldSource.disconnect(); oldGain.disconnect(); };
    source = null; gain = null;
  }
}

form.addEventListener('input', () => {
  stop(); updateCode(); clearWaveform();
  status.textContent = '設定を変更しました。再生して聴き比べてください。';
});

document.querySelector('#play').addEventListener('click', async () => {
  stop();
  const run = generation;
  try {
    context ??= new AudioContext();
    await context.resume();
    if (run !== generation) return;
    status.textContent = '音を準備しています…';
    const pcm = await renderPulse(settings(), {sampleRate: context.sampleRate});
    if (run !== generation) return;
    drawWaveform(pcm);
    const buffer = context.createBuffer(2, pcm.left.length, pcm.sampleRate);
    buffer.copyToChannel(pcm.left, 0); buffer.copyToChannel(pcm.right, 1);
    source = context.createBufferSource(); source.buffer = buffer;
    gain = context.createGain(); source.connect(gain); gain.connect(context.destination);
    const now = context.currentTime, duration = buffer.duration;
    // Playback-only fades: the plot above remains the unmodified core PCM.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.7, now + 0.01);
    gain.gain.setValueAtTime(0.7, now + duration - 0.01);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    const activeSource = source, activeGain = gain;
    source.onended = () => {
      activeSource.disconnect(); activeGain.disconnect();
      if (run === generation) { source = null; gain = null; status.textContent = '再生が終了しました。別のデューティ比も試してください。'; }
    };
    source.start(); status.textContent = '1.5秒間再生しています。';
  } catch (error) {
    if (run === generation) { stop(); status.textContent = `再生できませんでした：${error.message}`; }
  }
});

document.querySelector('#stop').addEventListener('click', () => { stop(); status.textContent = '停止しました。'; });
document.querySelector('#reset').addEventListener('click', () => {
  stop();
  for (const [name, value] of Object.entries(DEFAULT_PULSE)) form.elements[name].value = value;
  updateCode(); clearWaveform(); status.textContent = '初期値に戻しました。';
});
document.querySelector('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(pulseCode(settings())); status.textContent = 'コードをコピーしました。'; }
  catch { status.textContent = 'コピーできませんでした。下のコードを選択してコピーしてください。'; }
});
function releaseAudio() {
  stop();
  if (context) { void context.close(); context = null; }
}
window.addEventListener('pagehide', releaseAudio);
document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); status.textContent = 'ページを離れたため停止しました。'; } });
updateCode(); clearWaveform();
