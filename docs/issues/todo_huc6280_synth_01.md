# Tetorica HuC6280 Synth

開始: 2026-11-05。PC EngineのHuC6280を、SPU／DMG Synthと同じ流れで触れる独立Web Synthにする。正本は `docs/synth-huc6280/`、製品アイコンは `docs/tetorica_huc6280_synth.webp`。

## 今回の実装

- [x] 既存のHuC6280 WASM／高級APIを使い、AudioWorkletから実音源を鳴らす。
- [x] Waveは6ch、Noiseは実機のCH5／CH6を使う2chラウンドロビン。古いnoteOffが盗まれた声を止めないよう所有権を管理する。
- [x] 32サンプル・5bit波形を1つのcanvasで描く。Sine／Triangle／Saw／Squareと、Main／LFOの編集対象切替を用意する。
- [x] Hardware LFOはCH2→CH1の専用配線として表示し、有効時はCH1の単音へ切替。CH2の変調波形は出力をミュートする。
- [x] ソフトウェアEnvelopeは実機機能と区別して表示し、鍵盤からAttack／Decay／Sustain／Releaseを体験できるようにする。
- [x] SPU系の共通操作: Enable audio、Stop、Master 0–380%（100%超はオレンジ）、Waveform／Spectrum、2箇所のPitch、Octave、コンパクトな演奏鍵盤。
- [x] 数値は「− 値 ＋」、選択はボタンにし、演奏キーを奪わない。狭い画面と折りたたみも確認する。
- [x] プリセットJSON保存／読込、初期化、Playground向けJavaScript出力。
- [x] 改造できる元のJSモジュール、WASM、音源の対応ソースとライセンスを含むitch.io ZIP。
- [x] ホーム／README／配布コマンドへ入口を追加し、実WASMのunit・Chromium／WebKit・独立ZIPを検証する。

## 実装・検証記録（2026-11-05）

`docs/synth-huc6280/index.html` に初版を実装した。画面はSPU系の共通CSS／鍵盤／モニターを利用し、白＋オレンジの指定アイコンを使用する。音源は既存の `Huc6280Synth` と `Huc6280AudioEngine` をAudioWorklet上で接続した。共有runtime／WASMは変更していない。

- `npm run test:huc6280-synth`: **23件成功**。実WASMで6／2／1声、voice stealingと遅い離鍵、ピッチ、Noise／LFO、ADSRのリリースと無音、任意のrender分割でのPCM一致、atomicなプリセット検証、音声初期化・破棄、配布ソースの整合を確認した。
- 既存HuC6280 API／PCM engineの回帰テスト **9件成功**。`npm run check:runtime-artifacts` も成功（33 SDK builds／66 outputs／73 mirrors）。
- ソース版はChromium／WebKitとも成功。[検証記録](huc6280_synth_browser_01.json)。実音源の出力をMaster後で計測し、検証中のスピーカー出力はミュートした。発音中のNoise clock／LFO rate／Pitch、2箇所のwheel、操作後の演奏、描画・キャンセル・折りたたみ、preset保存／不正入力拒否／復元、390px幅でoverflow 0を確認した。
- 独立ZIPを別ディレクトリーへ展開して同じ両ブラウザー検証が成功。[ZIP検証記録](huc6280_synth_zip_browser_01.json)。外部ネットワーク依存・404・page errorは0。
- ZIP: `release/tetorica_huc6280_synth_0.0.1_itch.zip`（41 files、1,021,906 bytes）。SHA-256: `428d4a296ad61a4eef25feca125c864459fbadda69e470ead3fb9073e76f5b83`。元のJS／CSSの分割・コメント・識別子・相対importを保持し、WASMと対応する固定SDKソース・再ビルド手順・ライセンスを含む。
- 数値はステッパーと横ドラッグ、source／depthは選択ボタン。Main／LFOは1つのcanvasで切替。描画・shape・source・LFO切替・Envelope On/Offは保持音を止める。level／pan／Noise clock／LFO rate・depth／Pitchは保持音へ反映する。
- Software Envelopeは実機のchannel volumeへ16出力frameごとに書き込み、実機の1.5dB単位へ量子化する。時間設定は新しいノートに適用。初期値はA5ms／D0／S100%／R25ms。Hardware LFOのrateは0–255のdivider codeで、大きいほど遅く、鍵盤のピッチにも連動する。
- Copy JavaScriptはPlaygroundの初期化済み `pce` に対するハードウェア設定・試奏用。ホスト側のSoftware Envelopeはコメントに値を残し、スケジューリングを再現するコードとしては扱わない。

実聴、長時間／実ゲーム由来の比較、commit／push／公開はこの検証には含めていない。次はユーザー試奏と必要な調整。その後の候補は下記のVGM音色抽出。

## 接続仕様（並行実装用）

- `preset.js`: `createDefaultPreset()`、`readPreset(value)`、`waveShape(name)`、`presetToCode(value)`。
- プリセット v1: `{format:'tetorica-huc6280-voice',version:1,name,source:'wave'|'noise',wave:[32個の0..31],volume:0..31,pan:{left:0..15,right:0..15},noise:{frequency:0..31},lfo:{enabled:boolean,frequency:0..255,depth:1|2|3,wave:[32個の0..31]},envelope:{enabled:boolean,attack:秒,decay:秒,sustain:0..1,release:秒}}`。
- `instrument.js`: `Huc6280Instrument(core)`、`read()`→`{preset,voices:[{id,midi,channel}],capacity,pitch}`、`setPreset`、`loadPreset`、`noteOn`→`{channel,stolenId}`、`noteOff`、`setPitch`、`stop`、`generateStereo`、`dispose`。
- `audio.js`: `createAudio({volume,onError})`→`{context,outputNode,command,read,setVolume,resume,dispose}`。`processor.js`が実WASMとInstrumentを所有する。
- `editor.js`: `createEditor({root,onChange,onError})`→`{update(preset),dispose()}`。変更は妥当な完全プリセットを返す。描画はpointer releaseで反映する。
- 既存の共有runtime／WASMの正本を変更しない。`docs/js`・`docs/generated`を利用する。

## 後続候補

- [ ] VGM／VGZからの音色抽出（6chの波形・Noise・LFO構成をどう1音色へまとめるか確認）。
- [ ] DDA／CD-ROM² ADPCM／CD-DAは別の用途として検討する。DDAへ1値を書くだけの操作を「PCM再生」と呼ばない。
- [ ] 必要ならSoftware morphや外部ソフトウェアFXを追加する。SPUのハードウェアReverbと混同しない。
- [ ] Web版確認後、Tauri／Native版へ進む。

## 再開時

まず `git status --short` とこのTODOを確認する。各モジュールの実装・検証結果を下に記録し、未実行の実聴・公開を完了扱いにしない。
