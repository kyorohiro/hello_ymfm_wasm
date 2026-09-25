const $ = id => document.getElementById(id);
let context, effect, buffer, source, setup, loadId = 0;
function status(text) { $('status').textContent = text; }
function updateGain() {
  const value = Number($('gain').value);
  $('value').textContent = `${value.toFixed(2)} ×`;
  effect?.port.postMessage({ type: 'gain', value, bypass: $('bypass').checked });
}
function updateEq() {
  const values = ['bass', 'middle', 'treble'].map(id => {
    const value = Number($(id).value);
    $(id + 'Value').textContent = `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
    return value;
  });
  effect?.port.postMessage({ type: 'eq', values, bypass: $('eqBypass').checked });
}
function updateReverb() {
  const values = {};
  for (const id of ['mix', 'room', 'damping']) {
    values[id] = Number($(id).value);
    $(id + 'Value').textContent = values[id].toFixed(2);
  }
  effect?.port.postMessage({ type: 'reverb', ...values, bypass: $('reverbBypass').checked });
}
function updateCompressor() {
  const values = {};
  for (const id of ['threshold', 'ratio', 'attack', 'release', 'makeup']) {
    values[id] = Number($(id).value);
    $(id + 'Value').textContent = String(values[id]);
  }
  effect?.port.postMessage({ type: 'compressor', ...values, bypass: $('compressorBypass').checked });
}
async function ready() {
  if (!context) context = new AudioContext();
  if (!setup) setup = (async () => {
    const response = await fetch(new URL('./gain.wasm?v=compressor-1', import.meta.url));
    if (!response.ok) throw new Error(`WASM: HTTP ${response.status}`);
    const module = await WebAssembly.compile(await response.arrayBuffer());
    await context.audioWorklet.addModule(new URL('./effect-worklet.js?v=compressor-1', import.meta.url));
    effect = new AudioWorkletNode(context, 'native-gain', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', processorOptions: { module },
    });
    effect.onprocessorerror = () => { stop(); status('WASM処理エラー。ページを再読み込みしてください。'); };
    effect.connect(context.destination);
    updateGain();
    updateEq();
    updateReverb();
    updateCompressor();
  })().catch(error => { setup = null; throw error; });
  return setup;
}
function stop() {
  effect?.port.postMessage({ type: 'clear' });
  if (source) { source.onended = null; source.stop(); source.disconnect(); source = null; }
  $('stop').disabled = true;
  if (buffer) status('停止しました。再生で先頭から開始します。');
}
async function load(file) {
  if (!file) return;
  const id = ++loadId;
  stop(); buffer = null; $('play').disabled = true;
  $('info').textContent = file.name;
  status('読み込み中…');
  try {
    await ready();
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (id !== loadId) return;
    buffer = decoded;
    $('info').textContent = `${file.name} / ${buffer.duration.toFixed(2)} 秒 / ${buffer.numberOfChannels} ch / ${buffer.sampleRate} Hz`;
    $('play').disabled = false;
    status('準備完了。再生を押してください。');
  } catch (error) { if (id === loadId) status(`読み込み失敗: ${error.message}`); }
}
$('play').onclick = async () => {
  $('play').disabled = true;
  try {
    const selected = buffer;
    const id = loadId;
    await context.resume();
    if (!selected || id !== loadId) return;
    stop();
    source = context.createBufferSource();
    source.buffer = selected;
    source.loop = $('loop').checked;
    source.connect(effect);
    source.onended = () => { source?.disconnect(); source = null; $('stop').disabled = false; status('再生終了 — リバーブの余韻は継続します。停止で消去。'); };
    source.start();
    $('stop').disabled = false;
    status(`再生中 — C/WASM gain → EQ → Compressor → Reverb・出力 ${context.sampleRate} Hz`);
  } catch (error) { status(`再生失敗: ${error.message}`); }
  finally { $('play').disabled = !buffer; }
};
$('stop').onclick = stop;
$('loop').onchange = () => { if (source) source.loop = $('loop').checked; };
$('gain').oninput = updateGain;
$('bypass').onchange = updateGain;
$('file').onchange = () => load($('file').files[0]);
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
$('drop').ondragover = event => { event.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = event => {
  event.preventDefault(); $('drop').classList.remove('over'); load(event.dataTransfer.files[0]);
};
window.addEventListener('pagehide', () => { stop(); context?.close(); });

for (const id of ['bass', 'middle', 'treble']) $(id).oninput = updateEq;
$('eqBypass').onchange = updateEq;
$('eqReset').onclick = () => {
  for (const id of ['bass', 'middle', 'treble']) $(id).value = 0;
  updateEq();
};

for (const id of ['mix', 'room', 'damping']) $(id).oninput = updateReverb;
$('reverbBypass').onchange = updateReverb;

for (const id of ['threshold', 'ratio', 'attack', 'release', 'makeup']) $(id).oninput = updateCompressor;
$('compressorBypass').onchange = updateCompressor;
