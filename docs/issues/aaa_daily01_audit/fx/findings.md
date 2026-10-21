# NativeFX / LiveFX 性能監査結果（2026-10-21）

本番コードは変更していない。以下は性能監査の結果であり、過去のノイズ原因・解消を示す結果ではない。

## 条件と計測の限界

- Apple M2 / arm64 / Node 26.12.0 / V8 14.6.202.34-node.39。ブラウザーやデバイスの実時間締切を測る試験ではない。WebKitでの効果は未測定。
- 48,000 Hz、128 frames、stereo、実際の `NativeFXProcessor` + 出荷WASM。音声量子の予算は2,666.7 µs。入力は固定の有限な左右波形、出力を含むIOは再利用。FX Monitorは無効。
- 各条件・各試行：5,000 blocksウォームアップ、20,000 blocks計測（53.33秒分の音声）、3試行。各量子を個別計時し、配列への格納のみ実施。WASMコンパイル・初期化・ウォームアップ・明示GC・ソート・出力は計測外。比較の実行順序を交互にした。
- 時間計測とメモリー計測は別プロセス・別パス。メモリーは50,000 blocks（133.33秒分）、HeapProfiler sampling interval 1,024 bytes、minor/major GCで回収済みのオブジェクトも含む。数値は推定割り当て量であり、最大生存ヒープではない。
- GC回数・停止時間はヒープサンプリングによる影響を含む。実機で同じ頻度のGCが起きるとは言えない。最大実行時間にはOSのスケジューリング等を含む可能性があり、原因を分離していない。
- すべての時間計測ケースで、ウォームアップ後のWASM memory / 入出力PCM view差し替え0、ポート送信0。定常時のPCM再利用は機能している。

## 1. LiveFX出力の有限値検証：改善候補の優先度は高い（LiveFX使用時）

対象：`web/custom_fx.js:60`、`LiveFX.process()`。

現在は各チャンネルの出力を `for (const value of channel)` で走査し、NaN/Infinityを検出している。この走査を**検証を残したまま**インデックスループへ置き換えた一時モジュールで測定した。変更はこの1箇所のみで、バッファ確保・クリップ・fade・例外時bypass・復元処理を変更していない。

| 条件 | 50,000 blocksの推定割り当て量：現状→一時候補 | 削減率 |
| --- | ---: | ---: |
| LiveFX gain × 1 | 209,657,552 → 5,083,312 bytes | 97.6% |
| LiveFX gain × 8 | 1,663,366,384 → 27,822,264 bytes | 98.3% |

ユーザーのgain callbackはインデックスループでPCMを再利用するもの。現状の量は1 FXあたり約4,096 bytes / stereo128 frames増え、Float32Array走査の値をboxed numberにする処理と整合する。割り当て場所は `LiveFX.process` と記録され、走査1箇所だけを変える比較で大部分が消えた。V8で確認した結果であり、すべてのJSエンジンで同じ内部動作になるとは断定しない。

以下は3試行それぞれの指標の中央値。時間単位はµs。

| 条件 | 平均：現状→候補 | p95：現状→候補 | p99：現状→候補 |
| --- | ---: | ---: | ---: |
| LiveFX gain × 1 | 2.936 → 1.753 | 3.666 → 2.042 | 4.000 → 2.417 |
| LiveFX gain × 8 | 19.882 → 9.452 | 23.875 → 10.542 | 52.292 → 20.709 |

最大値は改善を保証しない。1 FXの試行別最大は現状181.875 / 51.875 / 54.125、候補131.334 / 77.250 / 62.208 µs。8 FXは現状170.750 / 1,385.917 / 105,917.125、候補45,539.375 / 61.208 / 841.625 µs。これらの単発外れ値を除いて集計していない。

再現性：6条件 × 2,000 blocksで左右PCMのバイト列一致。動的追加の5 ms fade、削除・再登録、context変更、gain rampを含む。さらに既存 `web/custom_fx.test.mjs` のimportのみ一時候補へ差し替え、11/11 PASS。NaN/Infinity検出、例外bypass、正常・不正なチャンネル置換、freezeされた配列からの復元、Main/Workerポート・Stop・Monitorも確認した。

リスク：小さい。検証を削除せず同じ要素を読む。ただし、Float32Arrayの独自 `Symbol.iterator` をユーザーが上書きした場合、インデックスによる実データの検証になる（意図した安全検証に合うが、この特殊操作の互換性は要判断）。WebKitを含むターゲットでの性能・波形検証を実装時に追加する。

証拠：`timing-indexed.json` / `alloc-indexed.json` / `compare-js-indexed.json` / `indexed-semantics.log`。

## 2. 保持した停止済みnoise voice：優先度は中程度、条件付き

対象：`native/audio_effect/noise.c:60-68`、`noise_mix()`。`web/native_noise.js:30-31` の `stop()` はvoiceを保持し、`dispose()` で解放する。

現在は作成済みvoiceの再生が停止しても、各量子の全128 framesで6パラメーターのtickとenv処理を続ける。inactiveで全パラメーター・envのremainingが0のときだけ、そのvoiceを量子単位で飛ばす一時C候補を測定した。エンジン全体・FX・sample mixは飛ばさない。

同一emcc 6.0.6・既存の同一ビルド引数で、変更なしbaselineと候補を別途ビルドした。以下は各試行の平均時間（µs）。

| 条件 | 同一コンパイラbaseline 3試行 | 候補 3試行 |
| --- | --- | --- |
| 作成済みinactive × 1 | 1.214 / 1.134 / 1.146 | 0.790 / 0.722 / 0.673 |
| 作成済みinactive × 32 | 15.508 / 15.559 / 16.562 | 0.693 / 0.695 / 0.696 |
| release完了inactive × 32 | 14.667 / 14.504 / 14.431 | 0.684 / 0.701 / 0.695 |
| active × 32 | 27.684 / 28.026 / 27.761 | 28.669 / 27.875 / 28.360 |

作成済みinactive ×32のp99はbaseline21.292–24.834 → 候補0.917–0.958 µs。active ×32の平均は対応する試行に対して約−0.5%〜+3.6%変化し、小さな判定追加コストがあり得る。通常のnoise未使用状態には効果がない。

再現性：32 voices・全5種のnoiseで、未再生・start/stop/restart・release・inactive中のcutoff/pan rampを含む4,000 blocksの左右PCMが、出荷WASM・同一コンパイラbaseline・候補の3つで完全一致。SHA256 `022e5d8381d6075e224b969ad1be16b682da5334713edccf191e0d80e7caacd2`。非ゼロの左右入力も混ぜている。

リスク：中程度。inactiveでもrunning rampは進める必要がある。release完了によるactive解除・フィルターstateのclearを飛ばしてはいけない。候補は両方のremainingを見ており、この遷移を通過するまで飛ばさない。env.valueが0であることを条件にする必要はない（remaining=0なら値は変化せずinactiveなので出力されない）。実装時は専用回帰テストと対象コンパイラでの確認が必要。

証拠：`timing.json` / `compare.json` / `compiler.txt` / `build-command-template.sh`。具体的な一時パスを含むビルドスクリプトはprobeで再生成する。

## 3. LiveFX未使用時の小さな割り当て：優先度は低い

対象：`web/custom_fx.js:27-36` / `web/native_fx_engine.js:85`。

空のLiveFXにも呼ばれるprocess内の稀なバッファ確保用arrow関数がnをcaptureしており、関数呼び出しのcontext割り当てと整合する結果だった。稀な確保を別helperへ移し、空ramps Mapのiterator生成前にsizeを確認する一時候補で、空ラック50,000 blocksの推定割り当て量は2,901,728 → 20,608 bytesとなった。定常PCMの割り当てではない。

効果の絶対量は約58 bytes / block（約22 KB/s）と小さく、通常の平均処理時間改善は確認できない。現状の空ラック平均0.700–0.800 µs、候補0.653 / 0.677 / 3.435 µs（最後の試行に35.871 msの単発外れ値を含む）。11条件のPCM一致を確認したが、上記1の大きな割り当て改善や他音源の改善より後に扱うのが妥当。

`hasProcessed` を保たない単なるLiveFX呼び出し省略は、途中登録のfadeを壊すので推奨しない。空chainだけを見たNativeFX全体のbypassも、noise/sample/ramp/将来のscheduled commandを失うため推奨しない。

## 現状を維持してよい箇所

- NativeFX入力2チャンネルと出力2チャンネルのコピーは、stereo128 framesで2,048 bytes / block = 768,000 bytes/s。WASM所有メモリーへの分離、noise/sample混合、graph処理に必要な経路であり、今回不要とは判定しない。viewは再利用されている。
- sample mixerは `native/audio_effect/sample.c:55` でinactive voiceを既に飛ばしており、同じ不要なper-frame処理はない。JS sampleのMapやbank割り当ては通常のrenderで走らずload/play制御時の処理。
- native filter + delay + reverbは平均約9 µs / block、p99は通常12–14 µs。今回測った範囲では優先して削る根拠がない。

## 優先順

1. LiveFX有限値検証のインデックス走査（測定済みの割り当て・処理時間削減、低リスク、LiveFX使用時に限定）。
2. 再利用する停止済みnoise voiceの定常inactive処理削減（測定済み、条件付き。全voice activeのコストとstate遷移へ注意）。
3. 空LiveFXのcontext / 空ramps iteratorの削減（割り当て減は測定済み、絶対量が小さいため後回し）。
