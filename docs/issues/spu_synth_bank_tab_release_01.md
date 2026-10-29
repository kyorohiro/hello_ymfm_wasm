# SPU Synth PSF / VAB専用タブと公開準備

2026-10-30。ユーザーによるPSFインポートの動作確認後、Audioから独立した **PSF / VAB** タブへ移動。
Audioは一般音声の読み込み、PSF / VABはPS1音色バンクに用途を分ける。

## 変更

- PCM／ADSR／FX／Audio／PSF / VABの5タブ。矢印・Home／End・roving focusを維持。
- タブ切り替えは音色・保持中のノートを変更せず、音声準備前にも使用できる。
- bankタブ表示中は非表示のPCM／ADSR editorを休止する。
- モバイル幅で5タブが収まるよう余白を調整。
- Synth READMEとZIP root READMEに専用タブ・対応範囲を反映。
  Synth READMEに残っていた旧「linear interpolation」表記も実装済みの4点Gaussianへ修正。

## 公開前チェックで追加修正した表示競合

最初のZIPのWebKit全回帰で、Morph Offのクリック直後にcheckboxが元へ戻るタイミングを検出。
音声側の応答が次のUIフレームより先に完了すると、changeMorphのfinallyが古い描画済み設定を復元していた。
音声側から返る確定設定をlastMorphへ保持してからpendingを解除するよう修正。
ブラウザ試験では意図的にrequestAnimationFrameを保留し、応答完了後・再描画前にもcheckboxがOff、
上段Morphがdisabledのままであることを確認する回帰ケースを追加。旧ZIPでのWebKit単独再実行は成功したが、
それだけで解決扱いにせず、修正を含むZIPを新規作成して全回帰をやり直した。
追加回帰の初回は先に予約されたUIフレームが残り、保留できたフレーム数のassertが失敗。
既存フレームの完了を待ってから保留するよう試験の前提を整え、最終版で両ブラウザの全回帰に成功した。

## 残作業の判定

今回の対応範囲は標準VAB v6／v7、VH＋VB、PSF1／MiniPSFに連続配置された標準VABの静的抽出と単一Tone演奏。
複数作品での対応確認、分離配置VH／VB、鍵域・layers、独自／runtime形式は後続TODOであり、対応済みとは告知しない。
Playground公開前の音量校正freshness gateは別の残作業。Standalone ZIPにはそのゲートの変更・迂回は行っていない。

## 配布物とdevlog

- コマンド：`sh scripts/package_itch_spu_synth.sh dev`。
- 公開用ZIP：`release/tetorica_spu_synth_dev_itch.zip`、46 files、5,529,017 bytes。
- SHA-256：`91c35b65cafdaa7fab495b1dc5a2f8db15c868b8db369a8e304e1f788ac0cef3`。
- バンドル・元ソース・ライセンス・WASMを含む。ZIPを新しいprivate tmpへ展開してブラウザ検証する。
- 公開用version番号は新規採番せず、包装labelは既定の`dev`。
- itch.ioへHTML projectとしてアップロードし、root `index.html` を使う。
- 英語投稿原稿：[devlog_spu_psf_vab.md](devlog_spu_psf_vab.md)。末尾のPosting notesは投稿に含めない。

itch.ioへのアップロード・devlog投稿は未実施。npm公開、Web deploy、git commit／pushも行っていない。

## 検証

最終結果：[spu_synth_bank_tab_release_01.json](spu_synth_bank_tab_release_01.json)。
NodeのSynth／package検証67件と共通PSFパーサー9件を確認。
ソース版はChromium／WebKitでVAB／PSF／5タブの起動前navigationを検証。
最終配布ZIPは新規展開したroot `index.html` からChromium／WebKitの全Synth回帰チェックに成功。
実AudioWorkletのPCM、全タブでの発音保持、PC鍵盤、preset往復、PSFエラー・キャンセル、
実Clock Towerセットからの対応Tone演奏、1440／390pxの表示を含む。
物理出力はミュートし、自動試験での実聴は行っていない。ソース版390pxのスクリーンショットを目視確認。

最終ZIPは38件の元ソース入力が現在のworkspaceとSHA-256一致。新規描画保留回帰は両ブラウザで成功。
