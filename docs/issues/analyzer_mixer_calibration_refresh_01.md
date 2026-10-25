# Analyzerの校正記録をsource単位へ更新

2026-10-25。`sh scripts/package_itch_vgm_analyzer.sh`が
`Analyzer calibration source changed; remeasure: docs/vgm_analyzer/playback_mixer.js`で停止した。
source単位への変更後、再生・WAV出力は検証済みだったが、itch.io用の生成チェックが参照する
旧測定記録の更新を確認していなかった。

## 対応

- 旧`analyzer_extra_levels_01.json`と`analyzer_psg_levels_01.json`は歴史的な測定記録として保持。
  現在の実コア／Mixerで再測定した`_02`記録を作り、生成器の入力を切り替えた。
- Extraの18 captureは、PCM hash・測定値・算出値が旧記録と完全一致。
- PSGの12 captureは、明示したunity出力をsourceの生PCMとして測定する。
  アプリがすでに相殺したGenesisの旧0.35を、測定側で再度割らない。
  旧機種倍率は`legacyEngineTrim`という別のメタデータに記録する。
- PSGの算出値も従来と同じ`0.455420 / 1.100331 / 1.512236`。
  実際に使う聴感用の設定`0.35 / 0.85 / 1.16`等とは区別する。
- 現行Mixer・再生経路・loader等のソースhashを測定記録へ追加した。
  生成器のhashチェックは維持し、ソース記録の省略も拒否する。
- 生成済み`mixer_calibration_data.js`は出典コメントだけ変更。音量定数・再生コードは変更していない。

生成結果と現行ソースの一致を確認する回帰試験、およびPSGの旧0.35を二重に補正しない実PCM試験を追加した。
公開済みnpmの音量動作に変更はなく、この修正のためのnpm再公開は不要。

## 検証

- 関連12試験成功。現行ソースとの生成チェック、不正hash・出典省略の拒否、source単位のraw測定を含む。
- Analyzer実PCM 8経路：unity/defaultの倍率、reset、WAV一致が成功。
- ユーザーと同じコマンドでZIP生成成功。校正・support・753ローカル参照のチェックを通過。
- 生成したstageをChromium／WebKitで確認。Mixer初期値、旧設定の換算、保存・Reset、
  YM2608 FM／SSGの実WASM AudioWorklet出力が成功。
- ZIP全370ファイルがstageとbyte一致。

```sh
node --test scripts/generate_analyzer_mixer_defaults.test.mjs scripts/measure_analyzer_psg_levels.test.mjs docs/vgm_analyzer/mixer_defaults.test.mjs
node scripts/check_analyzer_mixer_levels.mjs
sh scripts/package_itch_vgm_analyzer.sh
node scripts/check_analyzer_mixer_browser.cjs --root=release/itch_vgm_analyzer_dev
```

生成物：`release/hello_ymfm_wasm_dev_itch_vgm_analyzer.zip`、1,751,696 bytes。
今回のZIPのSHA256：`d3732d825db9605c314cccb5a80f1fef84b4a3568836fc037535302e8d415b08`。
itch.ioへのアップロードは行っていない。
