# Native Audio Effect: gain疎通確認

リポジトリのルートで `python3 -m http.server 8080` を起動し、
http://localhost:8080/docs/native_audio_effect/ を開く。
AudioWorkletを使うため、localhostまたはHTTPSで配信する（file://不可）。

音声ファイルをドロップ、または選択して「再生」を押す。
Gain 0で無音、1で原音、2で2倍。BypassはC側のゲインを1へ戻す。
ループ・停止・再生に対応。停止後の再生は先頭から。
対応音声形式はブラウザーのdecodeAudioDataに依存する。
ファイル全体をメモリーにデコードするため、まず短いファイルで試す。

経路：AudioBufferSourceNode → AudioWorklet → gain.wasm → 出力。
DSP本体は `native/audio_effect/gain.c`。ステレオplanar float32を固定バッファで処理し、
ゲイン変更は5msで補間。処理中のメモリー確保はしない。
これはgainの疎通確認であり、必須FX一式の実用性検証完了ではない。

ビルド（Emscriptenが必要）：

```sh
sh scripts/build_native_audio_effect.sh
node --test test/native_audio_effect.test.mjs
```

自動検証は実WASMの倍率・ランプ・ステレオとWorklet処理。
ブラウザー実機での試聴、ファイルデコード、負荷検証は別途行う。

## 3バンドEQ

Gainの後に、Bass（200 Hz low shelf）、Middle（1 kHz peaking、Q=0.707）、
Treble（4 kHz high shelf）を直列接続。各バンド±12 dB。
全てC側のbiquadで処理し、左右のフィルター状態は独立。
正規化係数を10msで補間し、EQ Bypassは全バンドを0 dBへ戻す。
Gain BypassとEQ Bypassは独立する。EQリセットはスライダーを0 dBへ戻す。
ブースト時はGainを下げてヘッドルームを確保する。

44.1/48/96 kHzで周波数応答・左右分離・フラット復帰と、連続した極端な変更を
実WASMで検証済み。係数補間中の聴感やブラウザー実機の負荷は試聴で確認する。

## アルゴリズム型リバーブ

`native/audio_effect/reverb.c` に独立して実装。Gain → EQ → Reverbの固定直列。
左右それぞれ4本の並列damped combと2段のall-passで残響を生成する。
左右の遅延時間をずらして広がりを作る。Wet入力は左右の平均。
MixはDry/Wetの線形クロスフェード、Roomはフィードバック量、Dampingは
フィードバック内の高域減衰。各パラメーターは約20msの時定数で平滑化する。
Roomは秒数ではない。リバーブ内部の並列処理は汎用branch/parallel APIとは別。

固定バッファを確保し、処理中のメモリー確保はしない。
自然終了では余韻を再生し、停止・ファイル変更・再生開始で残響を消去する。
Reverb BypassはMixを0へ戻すが内部状態の更新は継続する。
44.1/48/96 kHzでインパルスの残響・減衰・ステレオ差・クリアを自動検証済み。
ブラウザー実機での響きと負荷の検証は別途必要。

## Compressor

`native/audio_effect/compressor.c`。Gain → EQ → Compressor → Reverbの順。
左右の瞬時ピークの最大値で目標圧縮量を計算し、dB単位のゲインリダクションを
Attack/Releaseで平滑化する。左右に同じゲインを適用する。
ハードニー・先読みなし。ピークを完全に抑えるリミッターではない。

Threshold（-60〜0 dBFS）、Ratio（1〜20）、Attack（0.1〜200 ms）、
Release（10〜2000 ms）、Makeup（-12〜24 dB）。時間は一次平滑化の時定数。
Threshold/Ratio/MakeupとBypassは10ms時定数で補間する。
Compressor BypassではMakeupも無効。内部の検出・圧縮状態は更新し続ける。
停止・再生開始では圧縮状態をクリアするが、設定は維持する。

44.1/48/96 kHzで静的圧縮比、左右連動、Attack/Release、Makeup、Bypassを
実WASMで検証済み。瞬時ピーク方式の低音への影響やポンピング、実ブラウザーの
処理負荷は試聴・実機で評価する。既存DynamicsCompressorNodeの完全再現ではない。

## Noise Gate

`native/audio_effect/noise_gate.c`。Gain → EQ → Gate → Compressor → Reverbの固定直列。
左右の絶対値の最大を使うピークフォロワー（立ち上がり即時・減衰10ms）で判定する。
Threshold以上で開き、Threshold − Hysteresis未満がHold時間続くと閉じる。
音声ゲインはAttack/Releaseの一次平滑化で変更し、左右に同じ値を適用する。

Threshold -80〜0 dBFS、Hysteresis 0〜24 dB、Attack 0.1〜200 ms、
Hold 0〜1000 ms、Release 10〜2000 ms。初期値は-40 dBFS / 6 dB / 5 / 50 / 100 ms。
Threshold・Hysteresis・Bypassは10ms時定数で補間。Bypass中も検出は継続する。
停止・再生開始で検出レベル・開閉状態をクリアし、設定は維持する。
Reverbの前にあるので生成済みの残響をゲートで切らない。
先読みはなく、短い音や小さい減衰の欠落は設定と試聴で確認する。

44.1/48/96 kHzで小信号抑制・ヒステリシス・Hold・Attack/Release・左右連動・
Bypass・不正値拒否を検証済み。実ブラウザーでの試聴・負荷評価は別途必要。

## C側の接続グラフ

現在のページは `native/audio_effect/graph.c` の処理経路を使用する。
上部のRoutingで次の構成を選択できる（切り替え時は停止、再生ボタンで先頭から再開）。

- 直列：Gain → EQ → Gate → Compressor → Reverb
- Dry/Wet並列：前段Gain/EQ/Gate/Compressor → [Dry × A + Reverb(100% Wet) × B]
- 2台のCompressor：前段Gain/EQ/Gate → [Compressor × A + 独立した強圧縮 × B] → Reverb

枝A/BのGainは独立したインスタンス。並列は単純加算で自動正規化しない。
Dry/Wet構成のReverb Bypassは枝Bの消音、2台構成のCompressor操作は枝Aに適用する。
枝BのCompressorは−30 dB、10:1、Attack 5ms、Release 250ms、Makeup 0dB。

`graph.js` は構成を記述してCへ渡すだけで、分岐・直列処理・加算はC側で実行する。

```javascript
setChain(api, [
  effect('gain', 0),
  parallel(
    branch(effect('gain', 1)),
    branch(effect('reverb', 0), effect('gain', 2)),
  ),
]);
```

このAPIは検証ページ内部用で、Playgroundへはまだ公開していない。
`branch` は直列コンテナー、`parallel` は同じ入力を各枝へ渡す加算コンテナー。
空のbranchは素通し、空のparallelはエラー。

試作の上限は32ノード・各FX種8インスタンス。全状態をWASM内で事前確保する
（WASM初期メモリー32MiB、遅延バッファも事前確保）。同じ種類とslotのFXを
複数箇所へ置くこと、循環、共有ノードは拒否する。任意DAGではなく木構造。
slotはWASMインスタンスが所有し、graph_resetで設定も初期化、graph_clearで
履歴のみ消去する。動的な個別生成・解放や無制限な拡張は未対応。

構成はdraftとして検証後に一括commitし、不正なら既存構成を維持する。
Workletのメッセージ処理とPCM処理は直列に実行される。
無停止のクリックレス接続切り替えは未対応。ページは切り替え前に音源を停止する。
EQは `eq.c`、グラフは `graph.c` に分離。既存gain_processは互換検証用の固定直列入口。
