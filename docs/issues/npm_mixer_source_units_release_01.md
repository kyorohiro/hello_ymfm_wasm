# tetorica-fm2612 0.2.28: Mixerの調整値とsource単位

2026-10-25。[Mixer調整と単位の整理](psg_mixer_balance_02.md)をnpmへ公開する。

`SOUNDCHIP_MIXER_PRESETS.calibrated`の初期値は、Sega PSG `0.35`、AY `0.85`、
NES `1.16`、Game Boy `0.36`、HuC6280 `0.44`。
`gainUnits: 'source'`を選び、Genesis FM/PSGでも表示値が音源への実効倍率になる。
従来の`new SoundChipMixer()`、Mixer省略時、低レベルPCM、OPN内部の音量比は変更しない。

calibratedをMegaSynthへ渡していた利用者は、保存済みの旧Genesis主音源音量を
FM×`0.9` / PSG×`0.35`で一度換算する必要がある。汎用Mixerは保存形式の移行を自動実行しない。
独立した追加音源の値は換算しない。Nativeのsource単位の命令には対応したTauri hostが必要。

## 検証済み配布物

公開対象は、隔離環境で実インストール・型・実WASMを検証した同一tarball。
音源コアやWASMは前版から変更していない。

- 関連38試験成功。直前の実装検証では関連258試験、両ブラウザー各18実PCM経路、Analyzer 8経路も成功。
- 全942ローカル参照、15 renderer、26 WASM pairs、328 JSDoc宣言を検証。
- NodeNext／Bundler／Browserの型、source単位のreadonly属性、不正単位の拒否を確認。
- 録音sample・Native接続関連の既存検証も成功。
- 配布物は803 files、1,590,185 bytes。
- SHA256: `ac3ea596933cbf41e6d53bd86ece2f04ff4716a8342ab6d01292f632d23e2a73`
- npm shasum: `08f59bc1c507ecb021a526923e6812e7f525173c`
- npm integrity: `sha512-/0j1h1puGaM07K+oTRPnhuNhQ0R0sdxQwaiHymfhj838dD/UE7TrEjs0UBbJ01WIF8HAYf+nNIPfCY51E8JWfQ==`

公開状態：ブラウザー認証後、`npm publish`がexit 0と`+ tetorica-fm2612@0.2.28`を返した。
npm側の処理完了後、registryのversionとlatestが`0.2.28`、SHA1／integrityが上記の値と一致することを確認した。
公開tarballを再取得し、検証済みtarballとの全byte一致、source単位、5音源の調整値も確認した。
今回の公開対象は`tetorica-fm2612`のみ。Web配信、Tauriの同梱frontend、Examplesの依存更新は別作業。

[npm: tetorica-fm2612 0.2.28](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.28)
