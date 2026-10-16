# Playground liveFx

Code に演奏と自作FXをまとめて書く。数式専用の Custom FX Lab タブは廃止。

```javascript
liveFx("distortion", {
  context: { gain: 0.5, drive: 2 },
  process(input, output, state, context) {
    for (let ch = 0; ch < input.length; ch++) {
      for (let i = 0; i < input[ch].length; i++) {
        output[ch][i] = Math.tanh(input[ch][i] * context.drive) * context.gain;
      }
    }
  },
});
fx.updateContext("distortion", { drive: 4 });
```

## 実行と更新

- process のソースと context のコピーを AudioWorklet に送り、そこで関数を作り直す。
- 外側の変数を捕捉できない。設定は context、処理の履歴は state に持たせる。
- input/output はチャンネルごとの Float32Array の配列。output は毎ブロック0に初期化する。
- state は初期値 {}。遅延バッファなどもここで保持できる。毎サンプルのメモリ確保を避ける。
- 同じ名前を再登録すると state を維持し、process/context を置き換える。resetState: true で初期化。
- 既存の演奏中 Apply で再登録できる。通常のRun/Stopでリセットした場合は引き継がない。
- fx.updateContext(name, patch) は浅い部分更新。元のオブジェクトを変更するだけでは伝わらない。
- fx.removeLiveFx(name) で解除。Stop・実行環境の切り替えでも全解除する。
- 最大8個。native FXの後段に登録順で直列適用。setChainへの挿入は未対応。
- Worker実行時はWorker → Workletの直接ポート。main threadへ音声処理を依頼しない。
- 命令はキューへ送る。返り値はvoidで、awaitしてもWorkletの完了を待つ意味にはならない。
- ブロック境界で更新。サンプル時刻予約・更新時のクロスフェードは未対応。
- streamなどnative FXを通らない音声には適用しない。

## エラーと制約

同期関数のみ。通常の関数・アロー関数・processメソッド記法に対応。
構文エラーなら旧処理を維持する。実行時例外や非有限出力は該当FXをBypassして
ブラウザーConsoleに報告し、再登録で復帰する。出力は−1..1に制限する。

動的関数生成を使うため、これを禁止するCSPでは登録できない。
自由なJS処理なので無限ループや過大な計算量を強制中断する仕組みはない。
コードは音声ブロック内で完了するように書く。

## サンプルと検証

- examples/basic/livefx/live-fx-distortion.js：演奏とcontext更新を同じコードに記述。
- node --test web/custom_fx.test.mjs test/playground_native_fx.test.mjs docs/playground/playground_logic_worker.test.mjs
- contextのコピー・部分更新、state保持と初期化、異常時Bypass、
  実WASMとWorker専用ポート、Stopと古いポート遮断を検証。
- 実ブラウザーでの試聴と負荷確認は別途必要。

## FX Monitor

下部のFX Monitorタブで、liveFx名と左右CHを選択して入力／出力を比較する。
ViewでOscilloscope／Spectrumを切り替える。初期表示はOscilloscopeで、最後の選択を記憶する。
入力（青）と出力（オレンジ）は、選んだグラフに重ねて表示する。
波形のYはAutoが初期値で、2／1／0.5／0.2／0.1／0.05／0.02／0.01／0.005／0.001へ固定できる。
入力と出力は共通の±振幅レンジを使い、縦軸には実際の振幅を表示する。
Autoはピークに25%の余白を取り、大きいピークへ即時に追従し、縮小は約1.5秒の時定数で進める。
無音・微小な残差ではレンジを保持する。音量や減衰の比較には固定レンジを使う。
選択は記憶し、レンジ変更は取得済みPCMを再描画する。音声取得・FFT・音量変更は追加しない。
スペクトルは−100〜0 dBFSの固定スケールで、振幅レンジのコントロールを隠す。
2048サンプルの窓を最大約10回/秒更新する。Spectrumを選んだときだけ
Hann窓FFT（周波数軸は線形）を計算し、表示中のCanvasだけ描画する。
短い窓なので低音の分解能には限界があり、精密な測定器ではなく学習用の表示。

AudioNodeは追加しない。Workletに1窓だけ要求し、連続した入力／出力サンプルを
受け取ってから次を要求する。FFTとCanvas描画はmain threadで実行する。
タブを閉じる／ページを非表示にすると観測を解除する。
音声処理は表示の応答を待たず、未処理の観測要求を積み上げない。
対象はliveFx単位であり、native FX単体の内部やstateの可視化は未対応。
