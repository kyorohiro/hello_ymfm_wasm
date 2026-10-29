# PS1 SPU: 4点ガウシアン補間 — 2026-10-29

SDK原本の既定のvoice補間を、MAME由来の2点線形補間からPS1の4点ガウシアン補間へ置換した。公開操作・commit・pushは行っていない。

## 実装

- 原本は `w/tetorica-soundchip-native/vendor/mame-ps1-spu/spu.cpp`。
  `upstream/` は変更していない。
- [PSX-SPX / no$psx](https://psx-spx.consoledev.net/soundprocessingunitspu/#4-point-gaussian-interpolation)
  の512個の数値係数と計算式を使用。別エミュレーターの実装コードはコピーしていない。
  係数は再正規化せず、出典とadaptationの利用条件をvendor READMEへ記録。
- 位相はpitch counterのbit4..11。現在のdecoded sampleと直前3サンプルを、
  oldest→newの順に係数 `[255-i,511-i,256+i,i]` と乗算。
  各積を個別に符号付き15bit算術右シフト相当で切り下げ、その和を16bit範囲へclipする。
  負数の丸めを明示し、C++の負数右シフトの実装依存をこの式に持ち込まない。
- ADPCM decode後、ADSR／voice gain／OUTX／stereo mixより前に適用。
  Noiseは補間を通さず、FMはpost-envelopeのGaussian OUTXでpitchを変調する。
- KON／Resetは履歴をゼロにする。packet、repeat、loop cache切り替えでも履歴を保持。
  高pitchでcache境界を越えて飛ばすサンプルは、次segmentで正しいloop先を解決してから履歴へ消費する。
  pitch zeroは位相と履歴を保持し、先読みしない。
- Linear互換モードや追加API／UIスイッチは設けていない。C ABIは変更なし。
  44.1kHz→デバイスrateのmix後resamplerは別処理のまま。

## SDK・consumer・配布

正規のSDK source archiveを作成し、本体とTauriのimporterで同じ未公開0.1.7候補を取り込んだ。
base commitは `544364743702671fac40eed4fe7ef44f4769c07f`。
455 files、archive SHA256は
`e9cc58cf4f5c93fb4e83d96ff950cdb15718eba6c4354514f211a3a659605306`。
各pinの `localCandidate.changedPaths` に原本差分を記録している。

本体WASM、docsのソース配布、npm build、TauriのNative snapshot／フロントWASM／ソース配布へ反映。
Tauriの既存の150 modified＋1 untrackedをrestoreしたり、release.lockを再生成したりしていない。
TauriのGUIと物理音声は未確認。

試用用ZIPは `release/tetorica_spu_synth_gaussian-dev_itch.zip`。
45 files、5,462,105 bytes、SHA256
`8e24f13a476d68d0a7405a8a3641fe0828556a261ad8baa07f06222c9402ad9b`。
以前の公開済みv0.0.1 ZIPは上書きしていない。

## 検証

- `web/ps1_spu.test.mjs` の独立係数fixture／仕様oracleで、全256位相、負数の丸め、
  zero／fractional／maximum pitch、1 packet loop、非zero repeat、分割render、
  Noiseのバイパス、FM出力、KON／Reset履歴を確認。
  従来の整数pitch原PCM一致／線形補間期待値を、仕様式を使う試験へ変更。
- SDK自身のNative fixtureにも、独立したphase 0／128／255の係数行を追加。
  不連続な28sampleループ、飛ばすサンプルの履歴、再KONを確認。CTest成功。
- Native／WASM bit一致、SPU関連Node **116 tests成功**。
  Mixer生成関連 **34 tests成功**、PS1 calibration関連 **121 tests成功**。Tauri `cargo test --offline ps1` **19 tests成功**。
- Native fixtureのAddressSanitizer／UBSan成功。
- docs配布ソースだけからのWASM再buildがJS／WASMともbyte一致。
- [Synth Chromium／WebKit](ps1_gaussian_synth_browser_02.json) 成功。
  Keyboard／24声round robin／ADSR／4tabs／PCM／Audio import／preset／Stop／recoverを確認。
- [新規展開ZIPのChromium／WebKit検証](ps1_gaussian_zip_browser_02.json) も成功。
- npmのpack→ローカルinstall、全28 WASM engine、15 renderer、PS1実PCM、型定義検証成功。
- [Native／WASM音量測定](ps1_gaussian_calibration_offline_01.json)：12経路成功、最大差0。
- [starter測定](ps1_gaussian_starter_levels_01.json)：factoryとeditor SineがPCM一致、
  旧quiet factory比11.8832倍（44.1kHz）／11.8845倍（48kHz）。
  Gaussianの既知の約2source sample遅延を明示したquality比較で、
  starter RMS error 0.0123781、旧coarse 0.0267266。遅延未補正のerrorも別項目で保持。
  定数波でも係数和がphaseで変わるため、ADSR試験はPCMの完全一定ではなくenvelope registerの維持を検査。
- SDK0.1.6のraw PCM履歴と旧測定JSONは不変。旧linear PCMとのhash一致を現行Gaussianの条件にせず、
  新しい仕様oracleとrawの決定性で確認する。

## Mixerの影響

[新unit calibration](ps1_gaussian_chip_levels_01.json) はChromium／WebKit、Main／Worker、
44.1／48kHz、primary／extra、220／440／880HzのPS1 **48 captures**とYM2612 **8 anchors**を測定。
基準音源のnormalized amplitudeは旧0.999886649→0.996032953。
shared target amplitude `0.12881777435541153` は維持し、PS1の生成gainだけを
`0.128832`→`0.129331`（約+0.387%）へ更新した。
他音源のgain、ユーザーの保存済み設定、standalone SynthのMaster値は変更しない。
新しい測定JSONを既定生成・npm buildの入力へ変更した。
[新policyでの再検証](ps1_gaussian_chip_levels_verify_01.json) も48 PS1＋8 anchor全経路成功。
unit測定・policy検証ともpilot連続、clock診断0。

これらはデジタル出力の自動検証。AIによる実聴や実機との一致を証明するものではなく、
ADSR・reverb等の既存近似は残っている。ユーザーによる聴き比べとリリース判断は別途。
