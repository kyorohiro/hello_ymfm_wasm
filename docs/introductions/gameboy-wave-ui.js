import {WAVE_DEFAULTS, wavePreset, validateSamples, parseWave, lessonCode, renderLesson} from './gameboy-lessons.js';
import {attachLesson, blankCanvas, drawTrace} from './gameboy-lesson-player.js';
const form = document.querySelector('#lesson-controls');
const editor = document.querySelector('#sample-editor');
const shape = document.querySelector('#shape'), output = document.querySelector('#waveform');
let samples = wavePreset('triangle');
for (let i = 0; i < 32; i++) {
  const label = document.createElement('label');
  label.textContent = String(i);
  const input = document.createElement('input');
  input.type = 'range'; input.min = '0'; input.max = '15'; input.step = '1'; input.value = samples[i];
  input.dataset.sample = i; input.setAttribute('aria-label', `波形の点${i}、0〜15`);
  const value = document.createElement('output'); value.textContent = samples[i];
  label.append(input, value); editor.append(label);
}
function updateShape() {
  const ctx = shape.getContext('2d');
  ctx.clearRect(0, 0, shape.width, shape.height);
  const w = (shape.width - 80) / 32;
  ctx.fillStyle = '#276449';
  samples.forEach((value, i) => ctx.fillRect(50 + i * w, 180 - value * 10, w - 2, value * 10));
  ctx.fillStyle = '#61716a'; ctx.font = '16px sans-serif';
  ctx.fillText('15', 15, 35); ctx.fillText('0', 25, 185); ctx.fillText('点 0', 50, 210); ctx.fillText('点 31', shape.width - 100, 210);
  shape.setAttribute('aria-label', `編集した32点の波形（音源出力ではありません）：${samples.join(', ')}`);
  document.querySelector('#samples-json').value = JSON.stringify(samples);
}
function setSamples(next) {
  samples = validateSamples(next);
  editor.querySelectorAll('input').forEach((input, i) => {
    input.value = samples[i]; input.nextElementSibling.textContent = samples[i];
  });
  updateShape();
}
const read = () => ({samples: samples.slice(), note: form.elements.note.value, level: Number(form.elements.level.value)});
const player = attachLesson({read, code: s => lessonCode('wave', s), render: (s, options) => renderLesson('wave', s, options),
  reset() {
    for (const [key, value] of Object.entries(WAVE_DEFAULTS)) form.elements[key].value = value;
    setSamples(wavePreset('triangle')); document.querySelector('#preset').value = 'triangle';
  },
  clear: () => blankCanvas(output, '再生すると、音源が生成したPCMを表示します'),
  draw(pcm) {
    const start = Math.round(.1 * pcm.sampleRate), count = Math.round(.012 * pcm.sampleRate);
    drawTrace(output, pcm.left.slice(start, start + count), {min: -.25, max: .25, duration: '12 ms', label: '生成PCMの左出力。発音開始100 ms後から12 ms。固定振幅スケール。'});
  },
});
updateShape();
form.addEventListener('input', event => {
  if (event.target.dataset.sample !== undefined) {
    samples[Number(event.target.dataset.sample)] = Number(event.target.value);
    event.target.nextElementSibling.textContent = event.target.value;
    document.querySelector('#preset').value = 'custom'; updateShape();
  }
  player.update();
});
form.addEventListener('submit', event => event.preventDefault());
document.querySelector('#preset').addEventListener('change', event => {
  if (event.target.value !== 'custom') { setSamples(wavePreset(event.target.value)); player.update(); }
});
document.querySelector('#import').addEventListener('click', () => {
  try {
    const next = parseWave(document.querySelector('#samples-json').value);
    setSamples(next); document.querySelector('#preset').value = 'custom'; player.update();
    document.querySelector('#status').textContent = '32点の配列を読み込みました。再生して確認してください。';
  } catch { document.querySelector('#status').textContent = '読み込めません。JSON配列で32点すべてを0〜15の整数にしてください。現在の波形は保持しています。'; }
});
document.querySelector('#copy-array').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(samples)); document.querySelector('#status').textContent = '波形配列をコピーしました。'; }
  catch { document.querySelector('#status').textContent = '下の配列を選択してコピーしてください。'; }
});
