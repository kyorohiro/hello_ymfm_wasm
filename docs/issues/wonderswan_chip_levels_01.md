# WonderSwan: Mixer基準音量の測定

2026-10-29。WonderSwanの単音デジタル出力を専用の4bit波形で測定し、
PlaygroundのSystem built-inとnpmの任意の`calibrated` presetへ反映する。
既存の153測定、PS1の係数、他音源の係数、共通目標値
**`0.12881777435541153`**は変更しない。

Browserの全条件測定とoffline一致検証が完了した。
primary／追加とも **`1.0 → 1.172528`**を生成し、Playgroundとnpm用profileへ反映した。
生成した係数によるBrowserの全条件再検証も成功した。

## 基準波形と測定単位

自作の32点sineを4bit整数`0..15`へ量子化する。後半を`15 - 前半`として作り、
波形平均を正確に`7.5`へ揃える。CH0のみを保持し、左右のハードウェア音量は
`15/15`、Sweep／Noise／Voice PCMは無効にする。基準clockは3,072,000 Hz。
初期コードや通常音色の左右音量`9/9`は変更しない。

4bit全域を使う基準のheadroomは **`1`**。
PS1のADPCMで用いた`0.875`の補正を流用せず、unsigned midpointやDAC自体の
出力スケールを別のheadroomとして二重に補正しない。

| 項目 | 測定結果 |
| --- | ---: |
| unsigned raw DAC範囲 | `0..0.2197265625` |
| 既存speaker境界で差し引く平均値 | `0.10986328125` |
| speaker half peak-to-peak | `0.10986328125` |
| codec headroom | `1` |
| 共通目標値 ÷ 振幅、6桁丸め | `1.172528` |

raw C++／WASMはMAME由来のunipolar出力を維持する。
測定対象は既存のtickに同期したspeakerのDC補正後で、raw APIのDCを含むRMSとは
区別する。今回、新たなDC filterやSynth内部のgain、波形補正を導入しない。
基準A4は周波数レジスターの丸めにより約`440.3669724770642 Hz`となる。
24,000 Hzのnative tickと出力側のsample holdも維持する。

Chromium／Main／48,000 Hz／440 Hzの実収録をprimary／追加で別々に使い、
共通目標値を振幅で割って係数を求める。個別gainのclampや共通目標値の変更で
未検証のrouteを成立させない。

## 測定経路と根拠

[Browser測定JSON](wonderswan_chip_levels_01.json)はChromium／WebKit ×
44,100／48,000 Hz × Main／Worker × primary／追加 × 220／440／880 Hzの
**48条件**に成功した。同じBrowser／rate／executionでGenesis YM2612のunity基準
**8条件**も成功した。
公開`useSoundChip('wonderswan')`／`createSoundChip('wonderswan')`経路で
Mixer volume 1、pan 0、unmuted、soloに揃える。

収録点はsource Mixer後、FX／master／listening前。Workerの先行予約を待つため、
発音後1秒以上のwarmupに続いて約1秒を収録する。実際のAudioContext sample rate、
左右peak／RMS／DC／推定周波数、停止後exact zero、実行source・配信資産・WASM・
測定scriptのSHA256を記録した。全48条件のhalf peak-to-peakは
`0.10986328125`で一致し、AC RMSは約`0.0780841..0.0781292`だった。
112 captures／6,200,320 framesで独立pilotは連続、Stopはexact zero、
global clock診断異常は0。292配信資産と5つの測定script／旧reportの出典を保持し、
生成前の厳密な照合も成功した。物理出力は常時zero gateでmuteした。

独立PCMカウンターは別inputの収録順序を検証するもので、音源内部の全frameや
物理deviceのdeadlineを保証しない。global clockの不整合は別の診断として保持し、
失敗した収録や不整合を隠すために除外しない。人の実聴による結果ではない。

[offline比較JSON](wonderswan_chip_levels_offline_01.json)では
primary／追加 × 220／440／880 Hz × 44,100／48,000 Hzの
**12条件**を確認した。固定SDKのNative coreを独立compileし、実配布WASMと比較した
**1,338,528 samplesで最大差0**。既存Playground Workletのspeaker境界を実行する
VM比較は **552,600 frames**でraw DACから所定の平均値を引いたPCMと一致した。
AudioContextや物理deviceを開かないため、Browser transportや実時間性能の検証を
このoffline結果から主張しない。

## 適用と保存値

反映先はSystem built-inのprimary／追加WonderSwanと、npmの任意の
`SOUNDCHIP_MIXER_PRESETS.calibrated`。npmの測定対象はPS1を含む23から
**24種類**となる。`SoundChipMixer`を指定しない従来のgeneric defaults、
raw `generateStereo()`、低レベルchip／Synth、既存Exampleは変更しない。

generic Worklet endpointの出力gain既定値 **`0.25`**はMixerと別であり、
今回の係数へ吸収しない。`current.json`、default preset、ユーザーが明示した共通値・
ID別の値は絶対値としてfactory係数を置き換える。既存の保存値を自動で変更せず、
聴き比べるときはMixerで **System** を選ぶ。

固定した単音のデジタル出力単位を合わせる調整であり、聴感音量、4CH同時発音、
Noise／Sweep／Voice PCM、曲ごとのnormalization、実機のアナログ出力を揃える
処理ではない。全音源のノイズ問題が解決したという確認でもない。
package versionの変更・npm公開・itch.io公開は別作業とする。

## 出典hashとUI cache

旧153行のreportとPS1の測定reportはそのまま保持する。PS1 reportのraw SHA256は
`0bc38fd52a6f9de0658e085c016f8e8214e28960355b25a754da659bbab10d1c`。
PS1 reportに記録済みの293配信資産のhashを書き換えて、再測定したように扱わない。

UI側のcache更新は、元のreportと2つの元資産のraw SHAが一致している時点で作成した
[独立receipt](ps1_chip_levels_ui_receipt_01.json)で扱う。
`playground.js`のgenerated Mixer importと`index.html`の起動importについて、
既知の1箇所の`?v=`値だけを許可する。receipt自身のobject SHA、元reportのraw／object
SHA、元資産のraw SHAと、version値のみを除いたhashを照合する。
コード、module path、追加query、import重複、その他のbyte変更は拒否する。
残りのDSP／transport／WASMと測定scriptは従来どおりraw SHAの一致が必要。

生成されるMixer defaults／presets自身はhash対象から除き、循環依存を避ける。
WonderSwanも独立した完全reportから導出し、旧測定やPS1のgainを再計算しない。

## 適用後のBrowser確認

[適用後の検証JSON](wonderswan_chip_levels_verify_01.json)は生成された係数を使い、
同じ全48 WonderSwan＋8 YM2612条件を新規に実行して成功した。
112 captures／6,200,320 framesで独立pilotは連続し、Stop後はexact zero、
global clock診断異常は0だった。基準測定に対する倍率適用の最大相対誤差は
振幅約`6.50e-8`、RMS約`0.000605531`（0.061%未満）。
旧153行のreportとPS1 reportは、元のraw SHA256のまま保持している。
このBrowser検証も物理出力をmuteしており、人の実聴ではない。

## 再実行と残りの確認

```sh
node scripts/check_wonderswan_calibration_offline.mjs --out /private/tmp/wonderswan-levels-offline.json
node scripts/calibrate_wonderswan_levels.cjs --out /private/tmp/wonderswan-levels-raw.json
node scripts/generate_playground_mixer_defaults.mjs --report=docs/issues/playground_chip_levels_01.json --check
node scripts/generate_soundchip_mixer_presets.mjs --check
node scripts/calibrate_wonderswan_levels.cjs --verify --baseline docs/issues/wonderswan_chip_levels_01.json --out /private/tmp/wonderswan-levels-verify.json
```

両generatorは`--wonderswan-report=<report.json>`で拡張reportを明示できる。
`--no-wonderswan`では従来の未測定unity fallbackを生成できる。

itch web CIへWonderSwan基準波形・厳密なreport検証・UI cache receiptの試験と、
生成済み係数による全条件のBrowser再測定を追加した。現時点では今回のremote CIを
起動していない。両generatorの`--check`は生成後に成功した。
関連Node試験は**296件成功、failure／skip 0**。初回は295／296で、旧fixtureを使う
CLI試験1件に`--no-wonderswan`が不足していたため追加し、全296件を再実行した。
製品の倍率や音声処理の修正ではない。ログは`/private/tmp/wonderswan-mixer-unit-final.log`。

installed npmの実tarball／型も成功。**1,004 files／1,097 asset refs／28 WASM engines／
385 declarations**、NodeNext／Bundler／Browser型、主音源の実PCMと保存値の絶対置換を
確認した。初回のnpm packはsandbox内でキャッシュ書き込みがEPERMとなり、権限付きの
再実行で成功した。cache所有権の変更は行っていない。ログは
`/private/tmp/wonderswan-mixer-package-final.log`。npm versionは0.2.32のまま、未公開。

Playground download／Run ZIPを新規作成し、両方のCRCが成功。
Run ZIPは**37,403,523 bytes／931 files／directory entry 0**で、SHA256は
`f8a961be4e04a0ca85a6c992b044482cfa0c8af56d1ce9dcf2c3c0cb76b3e302`。
この[実Run ZIPのBrowser記録](wonderswan_chip_levels_zip_01.json)も
Chromium／WebKit × Main／Workerの4条件成功。public UI経由で起動、VFS／Shell、
実PCM、Stop／Rerunを確認した。Workerはitch.io相当の深いURLから実行し、
リポジトリ資産へのfallbackを使わない。今回も物理出力はミュートで、実聴の結果ではない。

未測定のSystem fallbackはPOKEYだけとなる。今回の変更は未commit／未push／未公開。
