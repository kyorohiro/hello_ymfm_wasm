# play() の拍・秒指定

実装済み：Playground の `play()`／`pg.play()` と `midi.output(...).play()` に `beats`／`seconds` を追加。

```js
setBpm(120);
await play('C4', { beats: 1 });     // 0.5秒
await play('C4', { seconds: 0.3 }); // 0.3秒
```

- `beats` は呼び出し時の BPM で一度だけ秒へ換算する。発音途中の BPM 変更には追従しない。
- `seconds` は BPM に依存しない。
- `beats`／`seconds`／`duration` を複数指定すると、発音前にエラーにする。undefined は未指定扱い。
- 値は有限の0以上の数値。負数、NaN、Infinity、数値文字列は受け付けない。
- 既存 `duration` の単位は維持する。通常の play は秒（既定0.2秒）、MIDI出力の play は拍（既定1拍）。省略時の動作も維持。
- Main・Worker・WorkerからMainへのフォールバックで同じ変換を行う。
- YM2612Synth や他のチップの API に BPM は追加しない。今回は Playground の演奏補助 API の変更。
- 音声サンプル再生や stream の duration は変更しない。

Playground の `play-beats-seconds` サンプルで、BPM変更時の拍指定・秒指定の違いを確認できる。既存サンプルやVGM変換コードの一括変更は行わない。

関連：[共通の時間制御の設計案](inputtimer_like_midi_01.md)
