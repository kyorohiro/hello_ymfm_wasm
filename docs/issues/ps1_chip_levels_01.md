# PS1: Mixer基準音量の測定

2026-10-29。PS1の単音デジタル出力を専用波形で測定し、Playgroundの
System built-inとnpmの任意の`calibrated` presetへ反映する。
PS1のprimary／追加instanceはともに **`1.0 → 0.128832`**。
npm calibratedはPS1を含む23音源のprofileとなる。
既存の153測定、他音源の係数、共通目標値
**`0.12881777435541153`**は変更しない。

## 測定と係数

基準は自作の112-frame／64-byte sine ADPCM。filter 0／shift 0、voice 0だけを
保持し、voice左右volume 1、最大attack・full sustain、reverb Offで測定する。
原波形のdecoded peak **`0.875`**をcodec headroomとして扱う。
Playgroundの公開`useSoundChip('ps1')`／`createSoundChip('ps1')`経路を使い、
Mixerはvolume 1、pan 0、unmuted、soloに揃える。

| 項目 | 結果 |
| --- | ---: |
| SPU実出力のhalf peak-to-peak | `0.8749008178710938` |
| codec headroom補正後 | `0.9998866489955357` |
| 共通目標値 ÷ 補正後振幅、6桁丸め | `0.128832` |
| 安定収録のAC RMS範囲（左右） | 約`0.617737`〜`0.618962` |

係数はChromium／Main／48,000 Hz／440 Hzをprimary／追加で別々に導出した。
両方とも同値となった。個別のgainをclampしたり、PS1のために共通目標値を
下げたりしていない。

旧報告のGenesis YM2612基準振幅`0.1494140625`には当時の内部trim `0.9`が
含まれる。現行のsource unity基準は`0.166015625`であり、両者を未補正で
比較しない。旧153行を再生成せず、PS1の測定を別reportとして追加した。

初期音色はshift 4で、codec入力振幅がこの基準より16倍小さい。
その静かなサンプルは変更しない。今回の係数は単音のデジタル出力単位であり、
聴感音量、曲ごとのnormalization、多声発音や実機のアナログ音量を揃える処理ではない。

## 完了した基準測定

[Browser測定JSON](ps1_chip_levels_01.json)はChromium／WebKit ×
44,100／48,000 Hz × Main／Worker × primary／追加 × 220／440／880 Hzの
**PS1 48条件**と、同じBrowser／rate／executionの**YM2612基準8条件**に成功した。
実際に採用されたsample rate、左右のpeak／RMS／DC／推定周波数、
停止後exact zero、source／WASM／測定scriptのhashを記録している。

通常測定は発音後1秒以上待ち、続く約1秒を収録する。最初の0.2秒待機版では
Workerの予約発音が収録窓へ入り、RMSが約`0.52`になる条件を観測した。
最終版は待機時間を揃えて全条件を新規実行し、上のRMS範囲を得た。
half peak-to-peakと導出gainは変わらなかった。短い待機版のfull／verify報告は
`/private/tmp`に残し、最終根拠として再利用していない。

初回probeは測定codeの`ps1`変数が未定義で失敗した。公開APIの
`await useSoundChip('ps1')`へ修正して再実行した。音源runtimeの修正ではなく、
失敗したprobeを成功扱いしていない。

収録点はsource Mixer後、FX／master／listening前。物理出力は常時zero gateで
muteし、収録用の独立PCMカウンターは別inputへ接続する。カウンターは収録経路の
sample順序を検証するもので、SPU内部の全frameやphysical deviceのdeadlineを
保証しない。global clockの不整合は別の診断として保持する。人の実聴や
ノイズ改善の確認を行った結果ではない。

[Offline Native／WASM比較JSON](ps1_chip_levels_offline_01.json)は
primary／追加 × 220／440／880 Hz × 44,100／48,000 Hzの12条件を記録する。
固定SDKから独立compileしたNative coreと実配布WASMの
**1,317,252 sample comparisonsで最大差0**。AudioContextやNativeの物理音声deviceは
開いていない。

## 適用範囲と再現

System built-inのprimary PS1／追加PS1 fallbackと、npmの任意のcalibrated presetへ
反映する。`current.json`、default preset、明示的なuser gainは従来どおり絶対値で
扱い、保存済み値を自動変換しない。raw PCM、SPU／Synth、初期サンプル、他音源の
係数は変更しない。package-rootの低レベルfactoryへPS1を追加する作業でもない。
package versionは据え置きで、公開は行わない。

Sample Editorの独立したSPU previewはhost Mixerのdefaultsを通さず、
`playground_sample_ps1_preview.js`のraw preview gain `1`を維持する。
今回のSystem係数はこのprivate previewへ重ねて適用しないため、hostでの
発音とpreviewを同じ出力レベルとして比較しない。

生成処理は完全なPS1 report、共通目標値、全route、実行sourceとhashを検証する。
生成されるMixer defaults／presets自身はreportのhash対象から除き、循環依存を避ける。
293の配信資産と、5つの測定script／旧reportの出典hashを照合してから生成する。
両generatorは`--ps1-report=<report.json>`で測定を明示でき、`--no-ps1`では
従来の未測定unity fallbackを生成できる。

```sh
node scripts/check_ps1_calibration_offline.mjs --out /private/tmp/ps1-levels-offline.json
node scripts/calibrate_ps1_levels.cjs --out /private/tmp/ps1-levels-raw.json
node scripts/generate_playground_mixer_defaults.mjs --report=docs/issues/playground_chip_levels_01.json --ps1-report=docs/issues/ps1_chip_levels_01.json --check
node scripts/generate_soundchip_mixer_presets.mjs --ps1-report=docs/issues/ps1_chip_levels_01.json --check
node scripts/calibrate_ps1_levels.cjs --verify --baseline docs/issues/ps1_chip_levels_01.json --out /private/tmp/ps1-calibration-settled-verify.json
```

## 最終適用後の確認

生成された係数を使うBrowserの全48 PS1＋8 YM2612条件も新規実行し成功した。
[適用後の検証JSON](ps1_chip_levels_verify_01.json)へ112 captures／6,200,320 framesを記録。
倍率適用の最大相対誤差は振幅約`2.01e-9`、RMS約`0.00057471`（0.058%未満）。
基準測定・適用後とも独立pilotは全収録で連続し、Stop後はexact zero、
今回のglobal clock診断異常は0だった。これを人の実聴や過去のnoise解決とは扱わない。

関連Node試験は**182件成功、skip／failure 0**。測定不備・旧reportの改変・出典の
不一致を拒否する試験と、保存値の絶対置換、繰り返しrestore、System復帰を含む。
両generatorの`--check`、canonical／docs mirrorの一致（型importのcache queryを除く）も成功した。

isolated npmの実tarballをinstallし、**1,004 files／1,097 asset refs／28 WASM engines**、
PS1の実音源・preset・保存値、NodeNext／Bundler／Browser型の検証が成功。
385 declarationsを生成・検証した。package versionは変更せず、npm公開は行っていない。

Playgroundのdownload／Run ZIPは新規作成・CRC成功。Run ZIPは**931 files**で
itch.ioの1,000 entries以内。SHA256は`f6f331217f15b08ee3ff9871a39c971761e60b8294038d299e280de9280c4669`。
その[実Run ZIPによるBrowser回帰](ps1_chip_levels_zip_01.json)も
Chromium／WebKit × Main／Workerの4条件成功。初期コードを各2回、Example、
CH24 Guitar／PC Keyboard、SPU editor試奏、追加SPUの独立dispose、RAM保持、
Stop、error recovery、mode往復を検証した。196 captures／1,736,704 framesで
pilotは連続し、今回のclock診断異常は0。人の実聴は行っていない。

itch web CIへ182件の試験と全条件の生成済み係数の再測定を追加した。
今回の変更についてremote CIはまだ起動していない。
