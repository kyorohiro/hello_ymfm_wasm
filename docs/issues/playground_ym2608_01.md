# Playground createSoundChip("ym2608")

RF5C164に続き、独立したYM2608を追加。UIで選択した音源と併用できる。
戻り値はブラウザー用transportにつないだYM2608Synthで、Node.js例の
FM・SSG・rhythm・adpcmの設定コードを共用する。

```js
const chip = await createSoundChip('ym2608');
chip.reset();
chip.rhythm.setVolume(48);
chip.rhythm.setVoice(0, {volume: 24, left: true, right: true});
chip.rhythm.keyOn(0);
await sleep(0.5);
chip.dispose();
```

- 同梱Tetorica ROMを初期化時に転送。`await chip.rhythm.loadRom(bytes)` で差し替え可能。
- `await chip.adpcm.loadMemory(bytes, address)` は符号化済みADPCM-Bの転送。
- メモリー転送は完了応答を待てる。レジスタ書き込みも同じポートで順序を維持する。
- Worker → Workletへ直接通信し、共有のmaster入力へミックスする。
- Stop・再Run・破棄は既存のデバイス管理に統合。停止中に初期化が完了した音源も解放する。
- resetはサンプルメモリーを保持する。
- サンプル：`docs/playground/examples/pc98/ym2608-chip.js`。
- Node.js例のファイル入出力や`generateStereo()`は移植対象外。ブラウザーではWorkletが出力する。
- 同期のステータス読み取り・IRQ取得はこのtransportでは未対応。
- 即時書き込み方式であり、サンプル単位の時刻予約は未対応。
- YM2203は共通FM/SSG実装を持つが、このcreateSoundChip入口への追加は別作業。
- YM2610BのADPCM-Aは任意範囲を指定でき、YM2608の固定6領域とは異なる。

実Worklet処理とWASMを使った自動テストでFM・SSG・リズム・ADPCM-B、
メモリー保持、ポート解放を検証する。ブラウザーの実音声出力・聴感は未確認。

検証結果：YM2608ポート／Worklet、Playground runtime、YM2608Synth、既存RF5C164の
関連テストは成功。初期化途中のStopと未完了の転送の破棄もテスト済み。
Playground ZIPとブラウザーexamples ZIPを生成し、依存ファイルの検証に成功した。

## ym2608-rhythm例の修正

従来の`chip-saw/ym2608-rhythm.js`は選択中の`fm`に書き込んでおり、
YM2608以外の選択時はリズムが鳴らなかった。
独立した`createSoundChip('ym2608')`とrhythm APIに移行し、finallyで解放する。
例の実コードをポート・Worklet・WASMで実行し、6音＋8拍の全14回の発音を検証。
関連9テスト成功。既に開いている仮想ファイルは古い内容の可能性があるため、
ページ更新後にexamplesから新しい例を開き直す。
