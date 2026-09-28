import {VOICES as ROM_VOICES, PARAMETERS, defaultParameters, generateRhythmRom} from '../assets/opna-rhythm/synthesis.mjs';
import moduleFactory from '../generated/ym2608_wasm.js';
import {renderRhythmVoice, SAMPLE_RATE, VOICES} from './opna-rhythm-render.js';

const $ = id => document.getElementById(id);
const roms = {A: null, B: null}, caches = {A: new Map(), B: new Map()}, revisions = {A: 0, B: 0};
let context, gain, nodes = [], playback = 0;
function status(text) { $('status').textContent = text; }
function buttons() {
  $('playA').disabled = !roms.A;
  $('playB').disabled = !roms.B;
  $('playAB').disabled = !roms.A || !roms.B;
}
function stop() {
  playback++;
  for (const node of nodes) { node.onended = null; node.stop(); node.disconnect(); }
  nodes = [];
}
function clear(side) {
  const canvas = $('wave' + side);
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  $('stats' + side).textContent = '未再生';
}
async function load(side, getBytes, name) {
  stop();
  const revision = ++revisions[side];
  roms[side] = null; caches[side].clear(); clear(side); buttons();
  $('name' + side).textContent = '読み込み中…';
  try {
    const bytes = new Uint8Array(await getBytes());
    if (bytes.length !== 8192) throw new Error(`8 KiBが必要です（選択ファイル: ${bytes.length} bytes）。`);
    if (revision !== revisions[side]) return;
    roms[side] = bytes;
    $('name' + side).textContent = `${name} · ${bytes.length} bytes`;
    status(`${side} を設定しました。`);
  } catch (error) {
    if (revision !== revisions[side]) return;
    $('name' + side).textContent = '読み込めませんでした'; status(error.message);
  }
  buttons(); redraw();
}
function bundled() {
  return load('A', async () => {
    const response = await fetch('../js/tetorica_ym2608_adpcm_rom.bin');
    if (!response.ok) throw new Error(`同梱ROMの読み込み失敗: HTTP ${response.status}`);
    return response.arrayBuffer();
  }, 'tetorica_ym2608_adpcm_rom.bin');
}
function redraw() {
  const voice = Number($('voice').value);
  const clips = ['A', 'B'].map(side => caches[side].get(voice));
  let peak = 0;
  for (const pcm of clips) if (pcm) for (const v of pcm.left) peak = Math.max(peak, Math.abs(v));
  const scale = $('waveGain').value === 'auto' ? (peak > 0 ? 0.9 / peak : 1) : Number($('waveGain').value);
  const spec = ROM_VOICES[voice];
  const seconds = $('waveTime').value === 'auto' ? spec.length * 2 * spec.divisor / 8000000 + 0.005 : Number($('waveTime').value);
  $('waveScale').textContent = `共通 ×${scale.toFixed(1)} · ${(seconds * 1000).toFixed(1)} ms`;
  clips.forEach((pcm, i) => { if (pcm) draw(i ? 'B' : 'A', pcm, scale, seconds); });
}
function draw(side, pcm, scale, seconds) {
  const canvas = $('wave' + side), ctx = canvas.getContext('2d'), data = pcm.left;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#c7d1df'; ctx.beginPath(); ctx.moveTo(0, 60); ctx.lineTo(canvas.width, 60); ctx.stroke();
  ctx.strokeStyle = side === 'A' ? '#2863ba' : '#ac5428'; ctx.beginPath();
  for (let x = 0; x < canvas.width; x++) {
    const start = Math.floor(x * Math.min(data.length, Math.round(seconds * SAMPLE_RATE)) / canvas.width), end = Math.floor((x + 1) * Math.min(data.length, Math.round(seconds * SAMPLE_RATE)) / canvas.width);
    let low = 0, high = 0;
    for (let i = start; i < end; i++) { low = Math.min(low, data[i]); high = Math.max(high, data[i]); }
    ctx.moveTo(x, 60 - high * 58 * scale); ctx.lineTo(x, 60 - low * 58 * scale);
  }
  ctx.stroke();
  let peak = 0, sum = 0;
  for (const value of data) { peak = Math.max(peak, Math.abs(value)); sum += value * value; }
  $('stats' + side).textContent = `Peak ${peak.toFixed(4)} · RMS（1秒）${Math.sqrt(sum / data.length).toFixed(4)}`;
}
async function play(sides) {
  stop(); const token = playback, voice = Number($('voice').value);
  try {
    context ??= new AudioContext();
    if (!gain) { gain = context.createGain(); gain.connect(context.destination); }
    gain.gain.value = Number($('volume').value);
    await context.resume();
    if (token !== playback) return;
    status('試聴音を生成中…');
    const clips = [];
    for (const side of sides) {
      if (!caches[side].has(voice)) {
        const pcm = await renderRhythmVoice(roms[side], voice, moduleFactory);
        if (token !== playback) return;
        caches[side].set(voice, pcm);
      }
      clips.push(caches[side].get(voice));
    }
    const start = context.currentTime + 0.04;
    clips.forEach((pcm, index) => {
      redraw();
      const buffer = context.createBuffer(2, pcm.left.length, SAMPLE_RATE);
      buffer.copyToChannel(pcm.left, 0); buffer.copyToChannel(pcm.right, 1);
      const node = context.createBufferSource(); node.buffer = buffer; node.connect(gain); nodes.push(node);
      node.onended = () => {
        node.disconnect(); nodes = nodes.filter(n => n !== node);
        if (!nodes.length && token === playback) status('再生終了');
      };
      node.start(start + index * 1.25);
    });
    status(`${VOICES[voice]} · ${sides.join(' → ')} 再生中${sides.length === 2 ? '（Bは1.25秒後）' : ''}`);
  } catch (error) { if (token === playback) { stop(); status(error.message); } }
}
for (const side of ['A', 'B']) {
  $('file' + side).addEventListener('change', event => {
    const file = event.target.files[0];
    if (file) void load(side, () => file.arrayBuffer(), file.name);
    event.target.value = ''; // Allow reloading a newly generated file with the same name.
  });
  $('play' + side).onclick = () => void play([side]);
}
$('playAB').onclick = () => void play(['A', 'B']);
$('stop').onclick = () => { stop(); status('停止しました。'); };
$('defaultRom').onclick = () => void bundled();
$('voice').onchange = () => { stop(); clear('A'); clear('B'); showParameters(); redraw(); status('音を選択しました。'); };
$('volume').oninput = () => { if (gain) gain.gain.value = Number($('volume').value); };
window.addEventListener('pagehide', () => { stop(); void context?.close(); });
void bundled();

const settings = Object.fromEntries(ROM_VOICES.map(v => [v.name, defaultParameters()]));
let generated = null;
function dirty() {
  generated = null; $('downloadRom').disabled = true;
  $('generationStatus').textContent = '値を変更しました。「生成してAに設定」で試聴に反映してください。';
}
function showParameters() {
  const values = settings[ROM_VOICES[Number($('voice').value)].name];
  $('parameters').replaceChildren();
  for (const [key, spec] of Object.entries(PARAMETERS)) {
    if (spec.voice && spec.voice !== ROM_VOICES[Number($('voice').value)].name) continue;
    const label = document.createElement('label'); label.textContent = spec.label + ' ';
    const input = document.createElement('input'); input.type = 'number';
    input.min = spec.min; input.max = spec.max; input.step = spec.step; input.value = values[key];
    if (key === 'noise' && ROM_VOICES[Number($('voice').value)].name === 'tom') {
      input.disabled = true; label.append('（Tomは使用しません）');
    }
    input.style.width = '6em';
    input.oninput = () => {
      input.setCustomValidity('');
      if (!input.checkValidity() || input.value === '') { input.setCustomValidity('範囲内の数値を入力してください'); }
      else input.setCustomValidity('');
      values[key] = input.value === '' ? NaN : Number(input.value); dirty();
    };
    label.append(input); $('parameters').append(label);
  }
}
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], {type}));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('generate').onclick = async () => {
  try {
    const bytes = generateRhythmRom(settings);
    await load('A', async () => bytes, 'Tetorica · ページ内で生成');
    generated = bytes; $('downloadRom').disabled = false;
    $('generationStatus').textContent = '6音の8 KiB ROMを生成済み。Aを再生して比較できます。';
    await play(['A']);
  } catch (error) { status(error.message); }
};
$('resetParams').onclick = () => { settings[ROM_VOICES[Number($('voice').value)].name] = defaultParameters(); showParameters(); dirty(); };
$('downloadRom').onclick = () => { if (generated) download(generated, 'tetorica_ym2608_adpcm_rom.bin', 'application/octet-stream'); };
$('saveParams').onclick = () => {
  try { generateRhythmRom(settings); download(JSON.stringify(settings, null, 2), 'tetorica_opna_settings.json', 'application/json'); }
  catch (error) { status(error.message); }
};
$('loadParams').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('設定JSONが不正です');
    for (const voice of ROM_VOICES) {
      if (!data[voice.name] || typeof data[voice.name] !== 'object' || Array.isArray(data[voice.name])) throw new Error('6音の設定が必要です');
      // Older saved settings omit newly added parameters; use their defaults.
      data[voice.name] = {...defaultParameters(), ...data[voice.name]};
    }
    generateRhythmRom(data);
    for (const voice of ROM_VOICES) settings[voice.name] = {...data[voice.name]};
    showParameters(); dirty(); status('設定を読み込みました。');
  } catch (error) { status(error.message); }
  event.target.value = '';
};
$('waveGain').onchange = redraw;
$('waveTime').onchange = redraw;
showParameters();
