# Playground: SPUのVAB読み込み・試奏 — 2026-10-30

ユーザー依頼：「次に進む前に、まずはVABの読み込みをPlaygroundから試したい」。PSF抽出は進めていない。

## 操作

1. PlaygroundのPS1モードを開き、SPUタブでPrepare audio。
2. 対象Voiceを選び、Import VAB sound bank → Open VAB / VH + VB…。
3. VABを1ファイル、またはVHとVBを同時選択する。
4. Toneを選択し、Load Tone into Voice N。
5. Hold to play／Sustain play／Use Keyboardで試奏する。

バンクを開くだけでは音声やRAMを変更しない。Toneは選択した物理Voiceだけに割り当てる。
同じVoiceを実行中のコードが操作する場合は先にStopする。Run／RAMリセットで読み込んだ音色が置き換わる場合がある。
合成バンク `release/spu-synth-demo.vab` で試せる。実ゲーム由来のバンクは未検証。

## 実装

- VAB解析を `docs/playground/playground_ps1_vab.js` に共通化し、Synth側は再exportで従来の入口を維持する。
- Playgroundだけ `enableVabImport:true` でパネルを表示する。Standaloneの既存UIは維持する。
- 選択Voice／接続／タブの変更やdisposeで未完了のファイル読み込みを破棄する。
- Inspectorの `loadTone` はADPCM・音程・preset・RAM容量を先に検証し、1メッセージでロードとVoice割り当てを行う。
  不正な入力や容量不足では保持中の手動lease、RAM、レジスターを変更しない。
- 再読み込みは現行RAMの実バイトと音程・ループ情報を比較して再利用する。clearRam後の古いIDは再利用しない。
- Web AudioはMain／Workerへresourcesを通知する。Nativeはstagingした実メモリーuploadとpresetを送信し、primary／additional双方に対応する。
- 元のADPCM、ADSR、ループ、基準音程・fine tuneを使用。標準Sony v6／v7の単一Tone対応で、鍵域分割・重ね音などの制限はSynthと共通。
- 配布用ファイル一覧に共通parserとUIモジュールを追加した。

## 検証

[検証JSON](playground_spu_vab_01.json)。オリジナル合成バンクを使用。実聴は行わず、物理出力をミュートしてPCMを取得した。

- ソース版：Chromium／WebKit × Main／Workerの4経路で成功。
  VAB／逆順VH＋VB、他Voice保持、元ADPCM、fine tuneの実PCM、Keyboard、RAM再利用、clearRam後の再読み込み、不正バンク拒否後の保持音継続を確認。
- Playgroundのpanel／Worklet：71 tests成功。
- Native primary／additional：29 tests成功。実SPU RAMの一致、選択leaseだけの解除、実PCM、無効入力の原子性を確認。
- Standalone回帰・ZIP構造：67 tests成功。
- モバイル表示の横幅もブラウザで確認。画像は検証JSONのscreenshotsを参照。

## 配布状態

ローカル試奏用サーバーを `http://127.0.0.1:5174/playground/?mode=ps1&no-sw=1` で起動。
Web deploy／npm公開／git commit・pushは行っていない。

Playground ZIP作成は既存の音量校正freshnessチェックが
`served DSP/WASM source changed; remeasure: docs/js/playground_ps1_inspector.js` で停止した。
変更後のソースに対する校正証拠の更新が必要。元の測定reportやhashは書き換えておらず、gainも変更していない。
このため新しいPlayground ZIPは未作成。公開前のTODOとして残す。
