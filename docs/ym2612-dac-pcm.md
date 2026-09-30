# YM2612Synth: PCMの登録と再生

YM2612 の DAC は **モノラル PCM を1系統再生する機能**です。再生中は CH6 の FM 出力を置き換えます。左右への振り分けはできますが、左右に別々の PCM を再生する機能ではありません。

`YM2612Synth` の `dac` に PCM API を追加しました。Node.js の `YM2612DirectTransport` と Web の `YM2612WorkletTransport` で同じ呼び方を使います。

```js
// 準備：再生側にデータが登録されるまで待つ。
await synth.dac.setSample('voice', pcmBytes, {sampleRate: 11025});

// 演奏：登録名だけ送る。when省略は次に処理する音声フレームから。
await synth.dac.playFromSample('voice');
```

入力は unsigned 8-bit mono PCM。`Uint8Array`、`ArrayBuffer`、0〜255 の整数配列を受け付けます。128 が無音レベルです。WAV ファイル全体や Float32 PCM は直接渡せません。入力をコピーするため、呼び出し元のバッファは転送で切り離されず、後から変更しても登録音は変わりません。

## 再生オプション

```js
await synth.dac.playFromSample('voice', {
  offset: 100, // PCMの先頭からのバイト数
  size: 2000, // 再生するバイト数。省略は残り全部
  pan: 'both', // 'both'（既定）/ 'left' / 'right'
  when: 1.5, // バックエンドのタイムライン上の絶対時刻（秒）
});
```

`when` を省略すると即再生、指定すると予約します。Web では `AudioContext.currentTime` と同じ時計、Node.js では DirectTransport が生成したフレーム数 ÷ チップのサンプルレートです。Node.js の時計は生成開始・reset 時が0秒です。Web の時計は reset しても巻き戻りません。過去の時刻を指定した場合は次の音声フレームから、PCM の冒頭を落とさずに開始します。

各 Promise はコマンドの受付完了を表し、音が鳴り終わるまで待つものではありません。`setSample()` は AudioWorklet の登録完了通知を待ちます。演奏前に必要な音を登録し、演奏中は名前を指定する方法を基本とします。

PCM は1系統です。新しい再生が始まると再生中の PCM を置き換えます。多重再生・ミキシングは行いません。開始時に DAC と出力先を設定し、終了時に128を書いて DAC を無効にします。既存の FM CH6 のパッチや Key On 状態を保存・復元する処理は行いません。PCM の端の不連続によるクリックを避けるには、入力に短いフェードを付けてください。

```js
await synth.dac.stop(); // 再生と未開始の予約をキャンセル。登録音は保持
await synth.dac.removeSample('voice'); // 登録解除。受付済みの再生は影響を受けない

// 試聴用。登録名を作らず、PCMを直接渡して再生することも可能。
await synth.dac.play(pcmBytes, {sampleRate: 11025});
```

同じ名前の `setSample()` は登録を置き換えます。受付済みの再生はその時点の PCM を保持します。`synth.reset()` は再生を停止し、登録済み PCM は再利用できます。Web で独自にノードを管理する場合は、切断前に `transport.dispose()` を呼んで未完了の登録をキャンセルしてください。MegaSynth の `close()` はこの処理を行います。

## Node.jsで音声を生成する

```js
const transport = new YM2612DirectTransport(chip);
const synth = new YM2612Synth({transport});
await synth.dac.setSample('voice', pcmBytes, {sampleRate: 11025});
await synth.dac.playFromSample('voice');
const pcm = transport.generateStereo(chip.sampleRate()); // 1秒分を生成
```

**新しいPCM APIでは `transport.generateStereo()` で生成します。** 生の `chip.generateStereo()` を直接呼ぶと、この予約処理と時計は進みません。FM の音も同じチップから同時に生成されます。

実行例：

```sh
node examples/nodejs/main_ym2612_dac_sample_wave.js /tmp/ym2612-dac.wav
```

- [Node.jsサンプル](../examples/nodejs/main_ym2612_dac_sample_wave.js)
- [Webサンプル](../examples/browser/ym2612_dac_sample.html)：リポジトリのルートをHTTP配信し、ブラウザーで開きます。

## 既存APIとの違い

| API | 入力と用途 |
|---|---|
| 新しい `synth.dac.setSample()` / `playFromSample()` | 通常の PCM とサンプルレート。登録して繰り返し再生 |
| 新しい `synth.dac.play()` | 通常の PCM を直接渡して再生 |
| Playground の `dac.schedule()` / `scheduleBase64()` | 44100単位の時刻とDAC値を予約 |
| Playground の `dac.load()` / `playStream()` | 時刻付きの5バイトレコード列を登録して再生 |
| `synth.writeDac()` / `setDacEnabled()` | 個別のDACレジスター操作 |

既存 API は残しています。新しい API に `beginSampleSchedule()` は不要です。Playground の YM2612 モードでも `fm.dac` から使用できます。サンプル一覧の `dac-pcm-sample` を選んでください。Main/Worker の両方で登録完了を待ち、Stop で再生と予約をキャンセルします。`when` は音声時計の絶対秒のままで、ループ相対時刻への変換は行いません。サンプルでは `when` を省略し、`sleep()` で繰り返し間隔を指定します。Playground の既存グローバル `dac` と新しい `fm.dac` は別の API です。独立して生成する追加 YM2612 の DAC 転送には未対応です。

独自 transport は `dacCommand()` の実装が必要です。未対応の場合はエラーを返します。同じチップで古い時刻付きDAC再生と新しいPCM再生を同時に動かすと、同じDACレジスターを操作するため混在させないでください。
