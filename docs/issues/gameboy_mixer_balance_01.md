# Game BoyのMixer初期値を0.36へ

2026-10-25。ユーザーの聴感による調整として、Game Boyの初期値を`0.515271`から`0.36`へ変更した。

元のピーク校正データは残し、`scripts/generate_playground_mixer_defaults.mjs`の
`MIXER_LISTENING_LEVELS`を共通の生成方針にする。測定用の`buildPlaygroundMixerDefaults()`は変更せず、
`buildPlaygroundMixerPolicy()`でGame Boyのkind初期値と主音源の設定へ絶対値`0.36`を適用する。
他の音源、OPN内蔵SSG、コアの生成PCMや機種内の音量比は変更しない。

適用先はPlayground Systemの主音源・追加音源、AnalyzerのGame Boy初期値、
npm向けのopt-in `SOUNDCHIP_MIXER_PRESETS.calibrated`。
一般のMixerの従来fallback `0.28`は維持する。明示した共通設定・プロジェクト別音量は初期値を置き換え、追加倍率を掛けない。
保存済み音量は自動で上書きしない。

## 測定

[測定記録](gameboy_mixer_balance_01.json)は実Analyzerのmixed engine／WASM、44,100 Hz、
約440 Hz、0.25秒の待機後1秒を取得したもの。最大固定音量の50%矩形波1声を使い、
平均DCを除いたAC RMSを比較する。YM2612は現行の標準Mixer値`0.862153`と既存の後段`0.9`を含む単carrier。

| 対象 | AC RMS | YM2612基準に対する比率 |
| --- | ---: | ---: |
| YM2612基準 | 0.091340 | 1.000 |
| Game Boy、旧初期値0.515271 | 0.127958 | 1.401 |
| Game Boy、変更後0.36 | 0.089399 | 0.979 |

変更後は約−0.19 dB。unity出力に`0.36`を一度掛けたPCMとの最大誤差は約`3.6e-9`。
任意の曲・音色・発音数の聴感を一致させるという意味ではない。チップ全体の初期値なので波形RAMやノイズにも適用される。

## 検証

生成器の再現性、Game Boyの主音源・追加音源への適用、保存済みの明示音量の優先、
他音源と元の測定データの保持を関連試験で確認する。
共通ピーク校正と聴感用初期値を区別するため、既存のPlayground校正／比較検証もruntime policyを参照する。

- 生成器・Preset・保存設定優先・Analyzerの関連試験43件が成功。
- AnalyzerのChromium／WebKit UI試験でGame Boy初期値`0.36`、保存・再読込み・Resetを確認。
- Playgroundは両ブラウザーで主音源／追加音源の計4実PCM captureが成功。実Mixer値`0.36`と期待振幅を確認した。
  証拠は`/private/tmp/gameboy-gain036-playground-{chromium,webkit}.json`。
- npm向けビルドと実インストール・型・実コア検証が成功。公開は行っていない。

```sh
node scripts/generate_playground_mixer_defaults.mjs --report=docs/issues/playground_chip_levels_01.json --check
node scripts/generate_soundchip_mixer_presets.mjs --check
node scripts/check_analyzer_mixer_browser.cjs
```

今回、公開・npm publish・Tauriへの配布物取り込みは行わない。次のWASM SDK移行の予定は維持する。
