# Run・Keyboard・Synth の音程と発音干渉

作成日：2026-10-16
状態：実装・検証済み。未公開。

## 調査

`ym2612_ch1_002.tfi` を Run で鳴らすと、Playground の Keyboard や Synth より大きく聞こえるという報告を調査した。
コード側の `getMasterVolume()` は 1。TFI の各 OP パラメーターは各経路で一致し、同じ音程・時間での音源 PCM も完全一致した。
Chrome の新規環境でも、同条件の出力に Run 固有の増幅は再現しなかった。
今回の修正で、主観的な音量差の原因が確定したとは扱わない。

確認できた不具合は次の二つ。

- 鍵盤側に古い基準が残り、表示 E4 は約252 Hz、Run の E4 は約330 Hzだった。
- Run の `play()` と手弾きが同じ CH を使うと、Run の Note Off や次の音符が、保持中の鍵盤の音を切る・上書きする。

## 採用した仕様

- Playground、FILES の試聴、Synth の鍵盤は `midiToOpnPitch` に統一する。A4＝440 Hz、現在のチップ clock と標準プリスケーラーを使う。
- メイン Keyboard／Operator は、鍵盤を押している CH の音程と Key On/Off を手弾き優先にする。
- 離した後は、次にプログラムが指定する音符から復帰する。押下中に抑制した音符は後から再生しない。
- 他 CH とループの時間進行は続く。音色・LFO・FX の操作も継続する。
- 同じ CH で鍵盤を押し替えた後、古いキーを離しても新しい音を止めない。
- Stop は手動音の Key Off と所有状態の解除を行う。Main／Worker の MessagePort 到着順に依存しない。
- 音量倍率は維持する。

## 実装

`web/playground_audition_guard.js` が Worklet 内で対象 CH の pitch/key レジスター書き込みを制御する。
これにより Main、Worker の直接通信、予約済みの書き込みも同じ規則を通る。
YM2612、Nuked、YM2203、YM2608、YM2610B の Worklet に接続した。
Neo Geo の論理 CH から物理 CH への変換はホスト側で行う。
Runtime の `getAuditionSynth()` はホスト UI 用であり、実行コードのグローバル API には追加しない。

## 検証

- 新規 guard 11 件を含む、Worklet／offline 関連92テスト。
- 音程、pitch bend、鍵盤、TFI 編集、Runtime の既存操作を含む関連27テスト。
- Chromium／WebKit × Main／Worker：最終出力 PCM で A4 の維持、他 CH の継続、キー押し替え、次の演奏音への復帰、Stop と再試奏を確認。
- Synth の Chromium／WebKit 回帰、型チェック、全23 WASM エンジンの読み込み、Playground／Synth の itch 配布物内の参照を確認。

ブラウザ版 Playground の自動復元は Tauri 向けと異なるため、既存プロジェクトで修正版を再読み込みする前に Cassette を Export する。
