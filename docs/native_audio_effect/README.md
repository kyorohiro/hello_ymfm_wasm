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
