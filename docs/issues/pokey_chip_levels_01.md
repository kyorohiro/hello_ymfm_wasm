# POKEY: Mixer基準音量の測定

2026-10-29。POKEYの単音squareを測定し、PlaygroundのSystem built-inとnpmの
任意の`SOUNDCHIP_MIXER_PRESETS.calibrated`へ反映する。Atari 8-bitの主音源、
Genesis等への追加音源、Dual POKEYの1台目・2台目を独立した4経路として扱う。

Offline検証とBrowserの全条件基準測定が完了し、完全reportから下記の係数を生成した。
POKEYは **`1.0 → 約0.41303`**。Playgroundとnpm用profileへ反映済み。
生成した係数による全条件のBrowser再検証と、実Run ZIPのBrowser確認も完了した。
公開は別作業とする。

## Square同士のAC RMSを基準にする

POKEYには任意のsine波形を書き込む機能がない。今回の基準はdistortion 5の
pure squareであり、sineとして扱わない。周波数220／440／880 Hz、hardware
volume 15、volume-onlyを無効にして保持する。high clockと16bit joined pair 0を
使い、物理CH1（0始まり）だけ発音させ、CH0は無音のtimer helperとする。

| 項目 | 値 |
| --- | --- |
| Atari 8-bit primary／追加音源のclock | `1,789,790 Hz` |
| Atari Arcade (Dual POKEY)のclock | `1,789,773 Hz` |
| raw DAC step | `744 / 32768` |
| full-volume raw範囲 | `0..0.340576171875` |
| nominal centered amplitude | `0.1702880859375` |
| codec headroom | `1` |

raw coreの正のDCを含むPCMと、speaker出力を区別する。測定点には既存の
speaker専用10 Hz DC blockerが含まれる。raw coreのDC、headroom、squareとsineの
RMS比、filter特性を追加のgainとして補正しない。DSPやSynth内部の倍率も変更しない。

目標は、現在のGenesis Sega PSGの440 Hz squareをsource unityで新規収録し、
**そのAC RMS × 既存のSystem値`0.35`**とする。Sega PSG自身の係数は変更しない。
各POKEY経路のcanonical収録はChromium／Main／48,000 Hz／440 Hz。
この目標を各経路自身のAC RMSで割り、小数6桁に丸める。個別gainをclampしない。

```text
targetAcRms = liveSegaPsgUnityAcRms × 0.35
pokeyGain   = round6(targetAcRms / pokeyUnityAcRms)
```

完全reportのSega PSG unity AC RMSは`0.19981240874842915`、
目標AC RMSは**`0.06993434306195019`**。POKEYの各canonical収録と係数は次のとおり。

| 経路 | SystemのMixer ID | unity AC RMS | 以前 | 今回の係数 |
| --- | --- | ---: | ---: | ---: |
| Atari 8-bit primary | `pokey` | `0.1693189989885538` | `1.0` | **`0.413033`** |
| 独立した追加音源 | 追加したID | `0.1693189989885538` | `1.0` | **`0.413033`** |
| Atari Arcade 1台目 | `pokey` | `0.16931921178441664` | `1.0` | **`0.413033`** |
| Atari Arcade 2台目 | `pokey:2` | `0.1693187778203704` | `1.0` | **`0.413034`** |

旧値に対して約59%小さくする設定。1台目と2台目の末尾の差はそれぞれの独立収録と
6桁丸めによるもので、2台目へ別の音色・DSP補正を加えたものではない。

元の153行のsine測定と共通のhalf peak-to-peak目標値
**`0.12881777435541153`**はそのまま保持する。この旧目標をPOKEY squareのpeakへ
直接流用せず、今回の`targetAcRms`と別の単位として記録する。
PS1、WonderSwan、他音源のgainを再計算しない。

## Browser測定経路

[完全Browser測定JSON](pokey_chip_levels_01.json)はChromium／WebKit ×
44,100／48,000 Hz × Main／Worker ×
primary／extra／dual-first／dual-second × 220／440／880 Hzの**96経路**。
同じBrowser／rate／executionごとに、Genesis YM2612 unityの8基準経路と
現在のSega PSG unityの8基準経路も収録し、すべて成功した。

Dualは2つの独立したchip handleであり、Mixer IDは`pokey`と`pokey:2`。
2台それぞれを測定して個別の係数を設定する。2台構成だからという理由で係数を
半分にしたり、2台の合計音量から1台あたりの係数を導いたりしない。
別途8条件で2台を異なる周波数に設定し、左右splitとcenter sumを検証する。
各sourceの個別出力から予測したAC RMSと比較し、二重適用や合算時の隠れた
normalizationがないことを確認する。

収録点はsource Mixer後、FX／master／listening前。単音の基準収録ではvolume 1、
pan 0、unmuted、solo。実際のAudioContext sample rateと左右PCMのpeak／AC RMS／
DC／推定周波数を記録し、前半・後半のRMSも比較する。
Workerの予約とDC blockerの過渡を待つため、発音後1秒以上のwarmupに続いて
約1秒を収録する。Stop後のexact zero、Browser例外、実行コード・runtime・WASM・
測定scriptのSHA256も検査する。物理出力はzero gateでmuteする。

別inputの独立24bit pilotは、収録inputの全sampleの順序と連続性を確認する。
音源内部の全frameや物理deviceのdeadlineを証明するものではない。
global clockの不整合は別診断として保持し、pilotが連続する収録をclock診断だけで
除外したり、失敗を隠すために収録を捨てたりしない。

基準測定の集計は**128発音captures＋120 Stop captures、合計248 captures／
14,023,680 frames**。全pilotは連続し、すべてのStopがexact zeroだった。
clock診断異常は2件をそのまま保持する（いずれもChromiumのStop収録）。
POKEYの前半・後半AC RMS差は最大約0.01104%、Dualのsplit／sum予測RMSとの差は
最大約0.03254%。293配信資産と5つの測定script／原reportの出典を記録した。
原reportのraw SHA256は
`5920ffb3ceb407b7db68cfdbf70bb1632fc6d2af54e9b66f35d92184fc4dee4b`。

初回の全条件試行はWorker経路でSega PSGのSystem値を確認する際に停止した。
Workerの`mixer.get()`は非同期であるため、測定用の確認コードへ`await`を追加してから
完全測定を新たに実行した。音源のDSPやMixer係数の修正ではない。
失敗ログは`/private/tmp/pokey-calibration-failed-worker-psg.log`に保持する。

## Offlineの独立確認

[offline比較JSON](pokey_chip_levels_offline_01.json)を生成する
`scripts/check_pokey_calibration_offline.mjs`は、公開の非同期`PokeySynth` APIを
awaitして実行し、実配布WASMと既存Playground speaker Workletを動かす。
必須試験は、固定SDKのraw coreを独立compileし、別のC++実装で10 Hz DC blockerの
漸化式`coefficient = exp(-2*pi*10/outputRate)`を計算して比較する。
この独立oracle自体をTauriの接続コードと同一視しない。
AudioContextや物理audio deviceは作成しない。

4経路 × 3周波数 × 2sample ratesの**24条件**が成功した。
Worklet speakerの**1,105,200 frames**を確認し、dualの独立性試験も含めた
**5,397,360個のfloat sample比較で最大差0**だった。
別chipの停止・reset・disposeで残るchipのPCMやregister stateが変化しないことも
44,100／48,000 Hzで確認した。
この結果はBrowser transport、実時間性能、物理driverや実聴の検証ではない。

今回のローカル試験では追加で、実際のTauri speaker bridgeも固定SDKに対して
compileした。`actualNativeBridge.performed: true`、別の**5,397,360 samplesで最大差0**を
記録し、使用した`w/.../native_genesis_pokey.cpp`／`.h`のraw SHA256も保持する。
これは上記の必須試験と区別する。実bridgeのソースが存在しないclean checkoutの
CIではこの任意試験を`performed: false`と記録し、必須のSDK・独立oracle・
配布WASM・実Worklet比較だけで再実行できる。別repoのcheckoutや取得は不要。

## 適用後のBrowser確認

[適用後の完全検証JSON](pokey_chip_levels_verify_01.json)は、生成済み係数を使って
全96 POKEY＋8 YM2612＋8 Sega PSG＋8 Dualケースを新規実行し、すべて成功した。
**248 captures／14,023,680 frames**で全pilotが連続し、全Stopがexact zero。
この適用後検証のclock診断異常は0だった。基準測定に残した2件は削除していない。

| 基準測定に対する適用結果 | 最大相対誤差 |
| --- | ---: |
| POKEY peak | 約`0.0084566%` |
| POKEY AC RMS | 約`0.0066542%` |
| Dual split／sumの予測AC RMS | 約`0.033344%` |

適用後検証でも物理出力はmuteしている。独立pilotの保証範囲は基準測定と同じで、
音源内部の全frame、物理deviceのdeadline、人による実聴を証明するものではない。

## 適用と保存値

完全測定に基づき、SystemのPOKEY単体・Dual 2台・追加音源とnpmの任意の
`calibrated` presetへ反映した。npmの対象は24から**25種類**となった。
Mixerを指定しないgeneric defaults、raw `generateStereo()`、chip／Synth内部の出力、
初期コードのhardware volumeは変更しない。初期コードへ`mixer.set()`を追加しない。

`current.json`、default preset、明示した共通値やID別の値は、factory係数を置き換える
絶対値として保持する。保存済みの値を自動移行しない。比較する場合はMixerで
**System**を選ぶ。Systemへの復帰を繰り返しても倍率を再度掛けない。

固定した単音squareのデジタルAC RMSを合わせる調整であり、聴感音量、Noise、
4CHの同時発音、実機のアナログ回路、曲全体のnormalizationを揃える処理ではない。
2台以上の同時発音では従来どおりhost側のheadroomが必要になる。
人による実聴やノイズ全般の解消を確認したという意味でもない。
npm公開・itch.io公開・tag・commit・pushは別作業とする。

## 原測定の出典とUI cache

旧153行、PS1、WonderSwanの原測定JSONを編集しない。新しいPOKEYの完全reportを
独立した拡張として検証し、source hashが古ければ生成物を書き込む前に停止する。
生成されるMixer defaults／presetsだけはhash対象から除外し、循環を避ける。

既存測定時点のUI import cache値を更新するため、元のraw sourceと一致した時点で
作成した[PS1 receipt](ps1_chip_levels_ui_receipt_01.json)と
[WonderSwan receipt](wonderswan_chip_levels_ui_receipt_01.json)を使う。
許可するのは`playground.js`のgenerated Mixer importと`index.html`の起動import、
それぞれ既知の1箇所の`?v=`値だけ。receiptのobject SHA、原reportのraw／object SHA、
原資産のraw SHAとversion値以外の全byteを照合する。
コード、path、追加query、importの重複、DSP／transport／WASMの変更は許可しない。
今回の2つのUI cache値は`pokey-mixer-calibration-1`。

最終的にPOKEYのraw reportの全script／source hashが現ソースと一致することを再確認した。
旧153行、PS1、WonderSwanの原reportのraw SHA256も不変。
Git HEADとの実際の28 mode factory map比較で、POKEY以外の全設定が変化していないことを
確認した。今回でSystemの未測定kindはなくなったが、各測定で宣言した単音・波形・
clock等の条件が全音色・全機械へ拡張されたという意味ではない。

## 再実行

```sh
node scripts/check_pokey_calibration_offline.mjs --out /private/tmp/pokey-levels-offline.json
node scripts/calibrate_pokey_levels.cjs --out /private/tmp/pokey-levels-raw.json
node scripts/generate_playground_mixer_defaults.mjs --report=docs/issues/playground_chip_levels_01.json --check
node scripts/generate_soundchip_mixer_presets.mjs --check
node scripts/calibrate_pokey_levels.cjs --verify --baseline docs/issues/pokey_chip_levels_01.json --out /private/tmp/pokey-levels-verify.json
```

両generatorの`--pokey-report=<report.json>`で拡張を指定できる。
`--no-pokey`はPOKEY拡張を省き、Playgroundの未測定unity fallbackを維持する。
PS1／WonderSwanの各指定・除外は独立している。

## 生成物と配布候補の確認

関連Node試験は**456件成功、failure／skip 0**。
厳密な完全report検証、4経路の個別gain、他音源の値の不変、保存値の絶対置換、
Systemの繰り返し適用、変更された出典を生成前に拒否することを確認した。
ログは`/private/tmp/pokey-mixer-unit.log`。

実tarballを独立installしたnpm検証も成功。
**1,004 files／1,097 asset refs／28 WASM engines／385 declarations**を確認した。
declarationsの内訳は`.d.ts`が379、`.d.mts`が6。
NodeNext／Bundlerの型と、Nodeのambient typesを持たないBrowserの型も成功した。
tarballは**1,952,175 bytes compressed／7,406,886 bytes unpacked**。
ログは`/private/tmp/pokey-mixer-package-approved.log`。
初回はsandbox内のnpm cache書き込みがEPERMとなり、検証済みstageを再buildしない
`--skip-build`の権限付き再実行で成功した。cacheの所有権は変更していない。
packageのversion変更やnpm公開は行っていない。

新規に作成したPlayground Run ZIPのCRCと全source照合が成功した。
**931 files／37,403,840 bytes**、SHA256は
`e9cad9c3cffa0255a9372bc3674832fd6157d7a1d795cc896d080ce8691b22af`。
この[実Run ZIPのBrowser記録](pokey_chip_levels_zip_01.json)はChromium／WebKit ×
Main／Worker × POKEY単体／Dualの**8条件すべて成功**。
実Worker、VFS／Shell、再生PCM、正確なMixer値、Stop／Rerun、Systemへの復帰を確認した。
unityに対する既定gain適用の最大相対誤差は約**0.008594%**、System復帰は
約**0.009498%**だった。物理出力はmuteしており、人による実聴の結果ではない。
このZIP checkerの収録には独立pilotがなく、上記の基準測定・全条件再測定の
pilot連続性証明をZIPの収録へ流用しない。

両generatorの`--check`とGitHub Actions設定の`actionlint`も成功した。
今回のremote CIは起動していない。npm／itch.ioへの公開、version変更、tag、commit、
pushは行っていない。
