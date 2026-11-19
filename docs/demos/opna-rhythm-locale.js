// Page-only translations; synthesis settings and generated ROM bytes are language-independent.
const english = {
  "YM2608 Rhythm — A/B比較": "YM2608 Rhythm — ROM builder & A/B comparison",
  "同じ音・同じ音量設定で、Tetorica合成ROMとオリジナルROMを聴き比べます。": "Compare the Tetorica synthesized ROM with an original ROM using the same voice and volume settings.",
  "ROMファイルはブラウザー内で処理し、アップロードしません。": "ROM files stay in your browser and are never uploaded.",
  "比較するROM（8 KiB）": "ROM to compare (8 KiB)",
  "同梱版に戻す": "Restore bundled ROM",
  "読み込み待ち": "Waiting to load",
  "同梱の合成音色は": "The bundled synthesized sounds use the",
  "。調整したROMも選択できます。": " license. You can also select a customized ROM.",
  "B · オリジナル": "B · Original",
  "手元の ym2608_adpcm_rom.bin を選択してください。": "Select your local ym2608_adpcm_rom.bin.",
  "オリジナルROMは同梱していません。B側にも任意の8 KiB ROMを指定できます。": "The original ROM is not included. B also accepts any 8 KiB replacement ROM.",
  "音": "Voice",
  "A を再生": "Play A",
  "B を再生": "Play B",
  "停止": "Stop",
  "試聴音量": "Preview volume",
  "A → B は同じ音を順番に再生します。音量の自動補正なし。両方とも8 MHz / リズム音量48 / 各音24 / ステレオ / 出力48 kHz。": "A → B plays the same voice in sequence without volume normalization. Both use 8 MHz / rhythm volume 48 / voice volume 24 / stereo / 48 kHz output.",
  "選択した音の合成パラメーター": "Synthesis parameters for the selected voice",
  "6音のROMを生成してAに設定": "Generate all six voices and load into A",
  "この音の値を戻す": "Reset this voice",
  "生成ROMを保存": "Download generated ROM",
  "設定を保存（JSON）": "Save settings (JSON)",
  "設定を読み込む": "Load settings",
  "各音の値を保持します。外部ROMの値を解析する機能ではありません。生成時は6音とも合成音色で置き換えます。": "Settings are kept for each voice. Imported ROM parameters are not analyzed. Generating replaces all six voices with synthesized sounds.",
  "準備中…": "Preparing…",
  "波形の縦倍率": "Waveform vertical scale",
  "A/B共通で自動拡大": "Auto scale A and B together",
  "表示時間": "Time window",
  "音の長さに合わせる": "Fit voice duration",
  "1秒": "1 second",
  "A · 波形": "A · Waveform",
  "B · 波形": "B · Waveform",
  "未再生": "Not played yet",
  "A/B共通の時間軸・縦倍率です。表示の拡大は再生音量に影響しません。": "A and B share the same time axis and vertical scale. Zoom does not affect playback volume.",
  "Aの1秒間の波形": "A waveform (one-second buffer)",
  "Bの1秒間の波形": "B waveform (one-second buffer)",
  "音程倍率": "Pitch multiplier",
  "減衰時間倍率": "Decay time multiplier",
  "ノイズ量倍率": "Noise amount multiplier",
  "アタック時間 (ms)": "Attack time (ms)",
  "ピーク振幅倍率": "Peak amplitude multiplier",
  "最初の山の振幅倍率": "First crest amplitude multiplier",
  "ノイズを入れる山の数": "Number of crests with noise",
  "共鳴音の山の鋭さ（1＝正弦波）": "Resonance crest sharpness (1 = sine)",
  "出だしの強打量": "Initial strike amount",
  "強打の減衰時間 (ms)": "Strike decay time (ms)",
  "ハイハットの減衰時間 (ms)": "Hi-hat decay time (ms)",
  "後半に残すノイズ量（0〜0.8）": "Noise tail amount (0–0.8)",
  "Tomの減衰時間 (ms)": "Tom decay time (ms)",
  "後半に残す共鳴音の量（0〜0.8）": "Resonance tail amount (0–0.8)",
  "序盤のピーク強調倍率": "Early peak boost multiplier",
  "強調する振幅の境界": "Peak boost amplitude threshold",
  "強調する山の数": "Number of boosted crests",
  "後半に残す共鳴・ノイズ量": "Resonance / noise tail amount"
};
let language;
try { language = localStorage.getItem('opna-rhythm-language'); } catch {}
const requested = new URLSearchParams(location.search).get('lang');
if (requested === 'en' || requested === 'ja') language = requested;
if (language !== 'en' && language !== 'ja') language = navigator.language?.startsWith('ja') ? 'ja' : 'en';
const bindings = new Map();
export function text(japanese, translated = english[japanese] ?? japanese) {
  return language === 'ja' ? japanese : translated;
}
export function localized(node, japanese, translated = english[japanese] ?? japanese) {
  bindings.set(node, [japanese, translated]);
  node.textContent = text(japanese, translated);
}
export function setupLanguage(onChange) {
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  const staticText = [];
  while (walker.nextNode()) {
    const node = walker.currentNode, key = node.textContent.trim();
    if (english[key]) staticText.push([node, node.textContent, key]);
  }
  const attributes = [...document.querySelectorAll('[aria-label]')].map(node => [node, node.getAttribute('aria-label')]);
  const select = document.getElementById('language');
  function apply() {
    document.documentElement.lang = language;
    select.value = language;
    for (const [node, original, key] of staticText) node.textContent = original.replace(key, text(key));
    for (const [node, key] of attributes) node.setAttribute('aria-label', text(key));
    for (const [node, pair] of bindings) {
      if (node.isConnected) node.textContent = text(...pair);
      else bindings.delete(node);
    }
  }
  select.onchange = () => {
    language = select.value;
    try { localStorage.setItem('opna-rhythm-language', language); } catch {}
    const url = new URL(location.href); url.searchParams.set('lang', language);
    history.replaceState(null, '', url);
    apply(); onChange();
  };
  apply();
}
