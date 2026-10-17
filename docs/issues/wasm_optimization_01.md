# 音源WASMの最適化（2026-10-17）

## 採用した設定

先行して対応したYM2612 / Sega PSGに続き、最適化指定がなかった次の6音源を
`-O2 -sASSERTIONS=1`で再ビルドした。

- YM2203
- YM2608
- YM2610B（同じWASM内のYM2610も確認）
- YM2413
- RF5C164
- Nuked-OPN2

最適化の変更は各`build_*_wasm.sh`の設定と`docs/generated/`のJS / WASM。
音色、位相、EG、先読み時間、波形補間には変更を加えない。
`NDEBUG`やfast-mathは追加しない。
実行時の検査と、旧JS / 新WASM等がキャッシュで混在する場合の互換性を保つため、
先行対応と同様に`ASSERTIONS=1`を明示した。

## 変更前との比較

Emscripten 6.0.6-gitで生成。元の生成物を別フォルダーに退避し、同じ公開ラッパーと
レジスター操作を通してFloat32 PCM、状態、ステータスを比較した。

| 音源 | PCM等の確認範囲 | Node単体計測の高速化目安 |
| --- | --- | --- |
| YM2203 | FM / SSG、tone / noise / envelope、mute、reset、状態復元、分割生成 | 約7.2倍 |
| YM2608 | FM / SSG、6 rhythm、ADPCM-B、pan / rate / loop、mute、状態復元 | 約8.0倍 |
| YM2610B / YM2610 | FM / SSG、ADPCM-A / B、pan / rate / loop、mute、状態復元 | 約8.1倍（B） |
| YM2413 | 9 melodic / 5 rhythm、mute / 解除、keyOff、reset | 約13.8倍 |
| RF5C164 | 8ch、RAM / bank、pan、loop、step、mask、状態復元、32 / 44.1 / 48kHz | 約3.9倍 |
| Nuked-OPN2 | 16 preset、全algorithm、6ch、LFO / SSG-EG、DAC全256値、timer / IRQ、reset、raw writes | 約4.4倍 |

すべて変更前とPCMの差分0、NaN / Infinityなし。
状態保存に対応する音源はsave / load後もPCMが一致した。
Nukedは従来から状態保存APIなし、内部Envelope配列は従来どおり0。
6音源すべてで旧JS＋新WASM、新JS＋旧WASMの初期化・生成も成功した。

速度はウォームアップ後のNode参考計測。OPNは128出力frames / 48kHzに相当する
ネイティブフレーム数、OPLL / RFは128frames、Nukedは143framesを使用した。
試行数や生成経路が異なるため、音源間の絶対負荷比較やSafariの締切保証には用いない。

6組のJS＋WASMの合計サイズは856,759 → 441,119 bytes（約48.5%減）。

## 回帰・パッケージ検証

- `node --test web/*.test.mjs docs/playground/*.test.mjs test/*.test.mjs`：1,830件成功。
- Chromium / WebKit：計28ケース成功。YM2203 / YM2608 / 公開YM2610 / YM2610B / Nukedの
  Main / Worker、RF5C164のWAV読み込み・RAM転送・loop・pan・keyOffを両実行経路で確認。
  YM2610B内部プロファイルはblock / fnumの生指定で検証した。
  YM2413はPlaygroundの音源APIではなく、ブラウザーとmodule Workerから直接生成しPCMの一致を確認。
  全ケースで有限の発音PCM、processor / page / console / runtimeエラーなし。
  runtimeの終了後は所有するAudioContextが閉じていることも確認。
- `node scripts/check_fm2612_package.mjs`：隔離したtarballのインストール、15 renderer / 全23 WASM engineの初期化、391配布参照を確認。
- 生成宣言210件、NodeNext / Bundler、正例 / 負例、ブラウザー向け型チェックが成功。
- Playground / Synth / Analyzerのitch.io用ZIPを生成し、ローカル参照403 / 185 / 626件を検証。
- 3アプリのTauri `dist`へZIPを取り込み、`release.lock.json`との全ファイル一致を確認。
  Playground 539 / Synth 138 / Analyzer 275ファイル。インポート用テストは計20件成功。
  Synth / Analyzerには、前回の取り込み以降にルートで変更された共有ランタイムも反映される。
- バージョン変更・npm公開・itch.ioへのアップロードは行わない。

## 検証中に修正した不具合

- Neo Geo（非B YM2610）の終了処理：`NeoGeoFMSynth`に`transport`参照を転送するgetterを追加。
  従来の`close()`が未定義の`transport.dispose`で例外になり、後続の解放に進めなかった。
  音源計算は変更せず、実際のtransportを確実に破棄する。再起動時の差し替えと、
  listener / node / portの解放、各transportが1度だけ破棄されることを回帰テストに追加。
- Analyzerの梱包リスト：新しいチップ編集UI等が参照する共有JSと描画モジュール計8個を追加。
  これらが不足してZIPの参照検査に失敗していたため、今回の配布生成に合わせて修正した。

Tauriの取り込みは開発用アセットの更新。インストーラーの再ビルド、実機での音量キー操作、
Windows / Linux上での確認はこの作業には含めていない。

関連する先行対応とmacOS音量キーの切り分けは[liveloop_timer.md](./liveloop_timer.md)を参照。
