# tetorica-vgm 0.2.14

2026-10-25。[Mixerの調整値とsource単位](psg_mixer_balance_02.md)をCLIのWAV出力へ反映して公開する。
`tetorica-fm2612@0.2.28`とは独立した配布物なので、別途公開が必要。

## 内容

| 音源 | WAV描画の初期値 |
| --- | ---: |
| Sega PSG | 0.35 |
| AY-3-8910 | 0.85 |
| NES APU | 1.16 |
| Game Boy | 0.36 |
| HuC6280 | 0.44 |

Analyzerと共通のsource単位を使い、GenesisでもPSGの0.35は音源への実効倍率となる。
Genesisの従来のFM 0.9／PSG 0.35を、表示上の初期値へ二重に掛けない。
OPN内部の音量比は保持する。音色・波形・曲・発音数の自動正規化は行わない。
解析や譜面等のexport形式は変更しない。

## 配布物と検証

- `tetorica-vgm-0.2.14.tgz`：250 files、820,347 bytes。
- SHA256：`c9be828350c715e39b81ad0fa77d8fe58b45cccb06cc7aebd5330a3b43fcea01`
- npm shasum：`e4f36437eec13a9bbaf0cee7676d622448767bc1`
- npm integrity：`sha512-frcoES6icDgxpkHNLPO3fxmeq5P//XWOdIpMJaumNhC4Ht3QUwqDIcaSDD+uysOOA2c809HWLfieQaeG1aCy0w==`
- CLI／VGM／S98／SPCの16試験が成功。
- 隔離tarballをオフラインインストールし、157 modulesの参照、SPC解析・音程指定、
  MIDI／MusicXML／LilyPond、CLI validation、VGM／S98の回帰確認が成功。
- 最終tarballの全250ファイルがstageとbyte一致することを確認。
- 隔離環境の公開`readSourceDocument()`／`renderSource()`で11種類の自作VGMをWAVへ描画し、
  作業ツリーの出力と全byte一致。Genesis単体FM／PSG／混合、AY、NES、Game Boy、
  HuC6280の矩形波／正弦波、YM2608 FM／SSGを含む。
- 配布物の5音源の初期値、YM2612 `0.775938`、YM2608 `1.03357`を確認。
  Genesis PSGの0.35出力は、Mixerを外した従来engineの0.35出力と37,287 PCM framesが一致し、二重適用がない。
- 配布物の458か所のローカル参照を確認。外部npm runtime依存なし。

```sh
node --test --test-concurrency=3 test/cli.test.mjs test/s98-cli.test.mjs test/spc-cli.test.mjs
node scripts/pack_cli.mjs --quiet
node scripts/check_vgm_spc_package.mjs ./tetorica-vgm-0.2.14.tgz
```

公開状態：ブラウザー認証後、`npm publish`がexit 0と`+ tetorica-vgm@0.2.14`を返した。
npmへの反映後にregistryのversion／latestが`0.2.14`、SHA1／integrity／ファイル数が上記と一致することを確認した。
公開tarballを再取得し、検証済みtarballとの全byte一致も確認した。

[npm: tetorica-vgm 0.2.14](https://www.npmjs.com/package/tetorica-vgm/v/0.2.14)
