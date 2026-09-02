# VGM to Playground JavaScript TODO

完了した項目はこのファイルから削除する。

## Release / Sync

- [ ] `package_web_runtime_release.sh`、`package_web_runtime_exsample.sh`、`package_itch_playground.sh` で release を実際に生成する。展開後に Worker URL が 404 にならず、Main thread / Worker の両モードで Playground を起動できることを確認する。

## Worker Playground

- [ ] Worker で FX/noise の複合オブジェクト、Stop/Run、再実行時の `liveCleanup()` を実ブラウザで回帰確認する。

## DAC / VGM Stream

- [ ] `dacLookaheadSeconds` の実機値を調整する。既定は `0.25` 秒で、曲・端末ごとの安定下限と開始遅延を確認する。
- [ ] `dac.loadBase64()` の Base64 展開を Main thread から外す。
- [ ] 長尺 VGM の DAC 再生、Stop/Run、繰り返し再生を Main thread / Worker の両方で確認する。
- [ ] `Copy JavaScript` と `Copy Scheduled JavaScript` の DAC 再生結果、開始時の停止、ノイズ量を比較する。

## PC-98 Chips

- [ ] YM2203 / YM2608 を Playground の音源 API に接続する設計を決める。
- [ ] YM2608 の ADPCM / PCM 再生を、YM2612 DAC と同様に AudioWorklet 側で扱う方針を決める。
- [ ] Playground の複数チップを Worker 実行から制御できるようにする。
