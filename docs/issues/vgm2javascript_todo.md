# VGM to Playground JavaScript TODO

完了した項目はこのファイルから削除する。

## Release / Sync

- [ ] Web runtime example / itch Playground の release を実際に生成して、Worker URL が 404 にならないことを確認する。

## Worker Playground

- [ ] Main thread 実行と `execution: "worker"` 実行の API 差分を一覧化する。
- [ ] Worker で FX/noise の複合オブジェクトと再実行・停止時の `liveCleanup()` を実ブラウザで回帰確認する。

## DAC / VGM Stream

- [ ] `dacLookaheadSeconds` の実機値を調整する。既定は 0.25 秒で、曲・端末ごとの安定下限を確認する。
- [ ] `dac.loadBase64()` の Base64 展開を Main thread から外す。
- [ ] 長尺 VGM の DAC 再生、Stop/Run、繰り返し再生を確認する。
- [ ] `Copy JavaScript` と `Copy Scheduled JavaScript` の DAC 再生結果を比較する。

## PC-98 Chips

- [ ] YM2203 / YM2608 を Playground の音源 API に接続する設計を決める。
- [ ] YM2608 の ADPCM / PCM 再生を、YM2612 DAC と同様に AudioWorklet 側で扱う方針を決める。
- [ ] Playground の複数チップを Worker 実行から制御できるようにする。
