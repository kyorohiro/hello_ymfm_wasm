# SCSP音量校正・操作安定性 — 2026-10-30

SCSPのSystem Mixer初期値を、primary／追加instanceとも **0.128825** にした。
npmのopt-in calibrated Mixer policyにもSCSPを追加した。
音源core／presetの音量、raw PCM、他音源の既存gain、保存されたMixer設定は変更していない。

## 測定

[単位出力測定](scsp_chip_levels_01.json)と[生成policy適用後の再測定](scsp_chip_levels_verify_01.json)。
各reportは48 SCSP＋8 YM2612 anchorの全matrix。

- Chromium／WebKit、Main／Worker、host 44.1／48 kHz、primary／extra、220／440／880 Hz。
- 自作256-sample signed PCM16 Sine、full-range ±32767、slot0のみ。
  TL0、DISDL7、center、AR31、decayなし。DSP／FM／LFOは使わない。
- Mixer unityで`audio.masterInputNode`を観測し、既存host resamplerを含めて測る。
  物理出力は常時gain0。独立24-bit pilot PCMでcaptureのsample順序を確認する。
- canonicalはChromium／48kHz／Main／440Hz。primary／extraとも振幅0.9999476373195648。
  旧153件の共通target 0.12881777435541153を変えず、target / amplitudeを小数6桁に丸めた。
- 適用後の期待値に対する最大差はpeak約0.0054%、AC RMS約0.055%。
  全held／Stop captureのpilotは連続、Stop後は厳密に0。
  再測定でcurrentFrame診断1件を隠さず保存した。pilotのsample順序・frame計数は通っている。

これはdigital source unitsの整合で、主観音量、実機アナログ出力、polyphonyのclipやhardware精度の保証ではない。
初期Sineの音量／TLなどの音色設定はそのまま。明示／保存されたMixer値も絶対値として扱う。

## 安定性と配布

[実ブラウザ結果](scsp_stability_browser_01.json)：Chromium／WebKit × Main／Worker全4経路成功。

- Prepare／32-slot Keyboard／Hold、blur release、EG編集後のfocus復帰。
- PCM8 Apply／描画、Copy voiceとコピーコードのRun、初期例／PCM例、独立instance。
- Mixer UI Muteと50%音量、FX gain20%、Master25%を実PCM比で確認。
- AudioContext suspend後のRunで復帰し、同じ出力レベルに戻ることを確認。
- Stop後のsilenceと、Files／editorの幅1440／686pxでの分離を維持。

Workerのsetterは受付と実適用が異なるため、ready markerと予約lookaheadの両方を待って測る。
追加instance検証時は前のprimary soloを解除し、検証条件を持ち越さない。
processorerror、OSのdevice interruptionや全障害からのruntime再生成は今回の範囲外。

関連Node **99 tests**、Playground全modeの型、Mixer generatorの`--check`が成功。
npm package buildは342 modules／393 declarations。
実tarballの一時consumerへのinstall、SCSP calibrated fallback・保存値の絶対性、既存PCM、
module exports／browser import／assets／NodeNext・Bundler型の検証が成功した。
配布tarballは2,045,867 bytes／1,045 files。npm publishは実施していない。
旧measurement reportは改変していない。
[cache監査](scsp_calibration_ui_revision_01.json)はentryとMixer importの2 tokenだけをexact hashで許可し、
同じ場所の別変更やDSP変更は許可しない。生成policyの2ファイルは既存どおりhash cycleを避けて測定から除外する。

Native SDK pin／C++／生成WASMは変更なし。commit／publishは行っていない。
既存release ZIPは未再生成。次はPCMファイル入力と編集sampleのbounded再利用／解放。

## 再実行

```sh
node scripts/calibrate_scsp_levels.cjs --out /private/tmp/scsp-new-levels.json
node scripts/generate_playground_mixer_defaults.mjs --report docs/issues/playground_chip_levels_01.json --check
node scripts/generate_soundchip_mixer_presets.mjs --check
node scripts/calibrate_scsp_levels.cjs --verify --baseline docs/issues/scsp_chip_levels_01.json --out /private/tmp/scsp-new-verify.json
node --test scripts/scsp_mixer_calibration.test.mjs scripts/scsp_calibration_ui_revision.test.mjs
node scripts/check_playground_scsp_browser.cjs --out /private/tmp/scsp-stability.json
```

単位測定は`volume:1`を明示する。`--verify`は生成済み初期値を利用する。
過去reportは上書きせず、新しい測定先を指定する。
