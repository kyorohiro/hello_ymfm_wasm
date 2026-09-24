# Node.js の利用例

## YM2612 → WAV

リポジトリーのルートで実行する。

```sh
node examples/nodejs/main_ym2612_wave.js
```

`examples/nodejs/ym2612.wav` に、A4（440 Hz）のサイン波を1秒、
Key Off 後の余韻を0.5秒生成する。出力は16 bitステレオ WAV。
同名ファイルは上書きする。保存先を指定することもできる。

```sh
node examples/nodejs/main_ym2612_wave.js /tmp/ym2612.wav
```

生成済みの `docs/generated/ym2612_wasm.js` と `ym2612_wasm.wasm` が必要。
ない場合はビルド環境を用意し、`sh scripts/build_ym2612_wasm.sh` で生成する。

サンプルは次の順に処理する。

1. `createYm2612()` で WASM チップを初期化する。
2. `YM2612DirectTransport` で `YM2612Synth` をチップに接続する。
3. `setPreset()` と `noteOn()` で音色と音程を設定する。
4. `chip.generateStereo()` で PCM を取り出す。
5. `noteOff()` 後も生成し、余韻をつなぐ。
6. `encodeStereoWav()` と `writeFile()` で保存し、`dispose()` で解放する。

`generateStereo()` の引数は左右1組を1フレームとするフレーム数。
秒数に `chip.sampleRate()` を掛けて求める。44,100 Hz と決め打ちしない。
オフライン計算なので、AudioContext・AudioWorklet・実時間の待機は不要。

音色は `FM_PRESETS["sine"]`、音程は `hzToBlockFnum(440, ...)` を変えて試せる。
余韻の長さは音色に合わせて調整する。
WAV 変換には現在の共通利用可能な関数として Analyzer の
`docs/vgm_analyzer/vgm_wav.js` を使用している。
