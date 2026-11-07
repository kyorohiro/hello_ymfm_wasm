# SID 8580 core selection: isolated prototype

調査日: 2026-11-07。目的は、8580専用モデルをNative／WASMで比較する小さな検証入口を選ぶこと。
既存の6581コア、SID Synth、PSID／RSID Playerを置き換える採用決定ではない。

今回の試作には **sidera 1.1.1の依存なしライブラリ部分**を選ぶ。MITのソース範囲を小さく固定でき、
8580用のvoice offset／filter分岐と、内部の1 chip cycle処理を持つため。
ただし、**write-only registerの浮遊バス／latch／decayが未実装であり、Playerへの採用は保留**する。
「8580で音が出る」「NativeとWASMが一致する」だけでは、SIDを読む実曲の正しさは証明できない。

## 候補と判断

| 候補／固定版 | ライセンスの実際の依存範囲 | API／精度上の制約 | 今回の位置づけ |
| --- | --- | --- | --- |
| MAME現行 `d87b05623fbefaa41359318d33123158efbe4e4f` | device wrapperはBSD-3-Clauseだが、音源本体はGPLのreSIDfp | 6581／8580、read／write／PCM／resamplingはある。MAMEのdevice／streamへの依存もある | permissiveな本番コア候補にはしない |
| MAME旧実装 `9056e4a8b59bc619ab0a445c236854feec02e9dd` | engine部分はBSD-3-Clauseだが、同梱の6581／8580波形表がGPL-2.0+ | sample単位の近似、共有global状態、8580専用filterではない | permissiveな単体化候補にはしない |
| perfect6581 `357ca30b73bebdef24b21b9a428fa92ac4bac2d2` | simulation wrapperはMITだが、必須netlistはCC BY-NC-SA 3.0 | half-cycle／bus操作を持つdigital simulation。analog filter／最終PCMはない | 非商用条件を含むため配布コアにはしない |
| sidera 1.1.1 `15041709d26c2bc36667ba27f729332c9f523696` | default libraryはMIT、外部crate依存なし。optional playerは別範囲 | public `clock()`は1出力sample。内部cycle処理はあるが、readはOSC3／ENV3だけ | **隔離したNative／WASM試作** |
| libresidfp 1.2.3＋libsidplayfp 3.1.2 | GPL-2.0-or-later。既存の外部検証toolとして分離済み | モデル別filter／read／cycle clockがある。参照エミュレーターであり実機そのものではない | 別processの8580参照候補 |

この表は確認した固定版のソースと必要ファイルに基づく。repository全体のLICENSE表示だけで、
波形表、netlist、optional依存まで同一ライセンスと判断しない。

## MAME: 現行と旧実装を分ける

現行の[`mos6581.cpp`](https://github.com/mamedev/mame/blob/d87b05623fbefaa41359318d33123158efbe4e4f/src/devices/sound/mos6581.cpp)
はBSD-3-Clauseだが、`residfp/residfp.h`をincludeし、実際の音源として`reSIDfp::residfp`を生成する。
`setChipModel(CSG8580)`、filter、sampling、read／writeを転送しており、wrapperだけでは音が出ない。
必要な[`3rdparty/residfp/COPYING`](https://github.com/mamedev/mame/blob/d87b05623fbefaa41359318d33123158efbe4e4f/3rdparty/residfp/COPYING)
も確認した。したがってBSD wrapperの抽出を、permissiveな8580コアの入手とは扱えない。

切り替えは2026-10-04の
[`8aeb28649e1be785a13cd06aa11ef033dfccac17`](https://github.com/mamedev/mame/commit/8aeb28649e1be785a13cd06aa11ef033dfccac17)
（reSIDfp 1.2.3への置換）。その直前の固定版で調べた旧engineの依存範囲は、
`sid.cpp/.h`、`sidvoice.cpp/.h`、`sidenvel.cpp/.h`、`side6581.h`、`sidw6581.h`、`sidw8580.h`。
最初の7ファイルだけを見るとBSDだが、
[`sidw6581.h`](https://github.com/mamedev/mame/blob/9056e4a8b59bc619ab0a445c236854feec02e9dd/src/devices/sound/sidw6581.h)
と[`sidw8580.h`](https://github.com/mamedev/mame/blob/9056e4a8b59bc619ab0a445c236854feec02e9dd/src/devices/sound/sidw8580.h)
にはGPL-2.0+の明示がある。**旧実装も必要な波形表まで含めるとBSDだけでは閉じない。**

旧[`sid.cpp`](https://github.com/mamedev/mame/blob/9056e4a8b59bc619ab0a445c236854feec02e9dd/src/devices/sound/sid.cpp)
の`fill_buffer(sound_stream&)`は1出力sampleずつ進む。OSC3／ENV3は最後にsample処理で更新した値を返す構造で、
CPUから1 PHI2ごとに呼べるread／write APIへの薄い変換だけでは足りない。
`filterTableInit()`にモデル分岐はなく、8580選択による主な差はcombined waveform表である。
filter／waveform／envelopeのglobal状態は複数instanceのmodel／sample rate混在にも注意が必要で、
`PCMfreq`は`uint16_t`のため96 kHz対応にも変更が要る。
MAMEの`device_t`／`running_machine`／`sound_stream`依存を除去しても、これらの制約は残る。
軽量さや正確さの性能測定は今回行っていない。

## perfect6581: 必須netlistの条件とdigital-onlyの範囲

固定版の[`LICENSE`](https://github.com/libsidplayfp/perfect6581/blob/357ca30b73bebdef24b21b9a428fa92ac4bac2d2/LICENSE)、
`perfect6581.c/.h`、`netlist_sim.c/.h`はMITのsimulation側を確認できる。
一方、必須の
[`netlist_6581.h`](https://github.com/libsidplayfp/perfect6581/blob/357ca30b73bebdef24b21b9a428fa92ac4bac2d2/netlist_6581.h)
は **CC BY-NC-SA 3.0 Unported** を明示している。repositoryのMIT表示をnetlistまで一般化しない。
このファイルは名前に反して`MOS8580`の条件分岐と有効なdefineも持つため、
「6581しか記述がない」とも判断しない。

[`README`](https://github.com/libsidplayfp/perfect6581/blob/357ca30b73bebdef24b21b9a428fa92ac4bac2d2/README)
自身がdigital部分のみと説明する。
[`perfect6581.h`](https://github.com/libsidplayfp/perfect6581/blob/357ca30b73bebdef24b21b9a428fa92ac4bac2d2/perfect6581.h)
には`step`、`setCs`／`setRw`、address／data bus、OSC観測があるが、analog filter／mixed PCM出力はない。
回路単位のdigital比較の参考にはなるが、非商用netlistの条件と音声段の欠落により、
Tetoricaの再利用可能な8580音源としてそのまま採用できない。transistor simulationの実時間性能も未測定。

## sidera 1.1.1: 固定する原本とライブラリ範囲

- 原本: [crates.io 1.1.1](https://crates.io/crates/sidera/1.1.1)／
  [固定archive](https://static.crates.io/crates/sidera/sidera-1.1.1.crate)。
- archive SHA-256: `b043512b891bdb03ad21b0205723dabb88ada23e3043c21f6a7f88b26defba35`。
- `.cargo_vcs_info.json`のrevision: `15041709d26c2bc36667ba27f729332c9f523696`。
  [固定repository tree](https://codeberg.org/sbechet/sidera/src/commit/15041709d26c2bc36667ba27f729332c9f523696)。
- [`LICENSE`](https://codeberg.org/sbechet/sidera/src/commit/15041709d26c2bc36667ba27f729332c9f523696/LICENSE):
  MIT、Copyright 2026 Sébastien Béchet。原本・license・改変diffを保持する。

default libraryのソースは`src/{lib,high,registers,envelope,extfilt,filter,noise,oscillator,sid,voice}.rs`で閉じ、
`no_std`／外部crate依存なし。`Cargo.toml`のdefault featuresは空で、`player`は
`mos6502`、`clap`、`cpal`、`hound`をoptionalに追加する。
今回の`rustc`直接ビルドではこれらを使わない。
**MIT確認の対象はこの原本ライブラリ範囲であり、optional playerの全依存のライセンス監査済みという意味ではない。**

upstreamは独立実装で、reSID 0.16は外部のblack-box oracleとしてだけ使用したと説明している。
今回確認したdefault sourceにはreSID本体／GPL波形表のincludeはないが、
その説明を独立した由来証明や、実機一致の認定に置き換えない。
combined waveformはalgorithmicな近似、cutoffはbreakpoint近似であることもupstream自身が明示している。

[`src/sid.rs`](https://codeberg.org/sbechet/sidera/src/commit/15041709d26c2bc36667ba27f729332c9f523696/src/sid.rs)
のpublic `clock()`は、`chip_clock/sample_rate`回のchip cycleを進めて**1出力sample**を返すAPI。
CPUの途中のread／writeを挟める1 PHI2 APIではない。
内部`cycle_once()`と`output_sample()`を薄く公開する、明示した最小patchで隔離prototypeを作る。
cycle clockと音声の取り出しを分け、既存sampling／filter式を勝手に変更しない。
patch前後のsource hash、diff、Native／WASMのbuild inputsを記録する。

`ChipModel::Mos8580`はvoice DC offsetとfilter curveを切り替えるため、単なる6581へのラベル付けではない。
ただし`read_register()`はOSC3／ENV3以外を0で返す。
POT、write-only bus latch、保持／decay、readによるbus状態の変化は実装していない。
**これを8580の正しいバス動作とみなしてPSID／RSIDを通すことは、現時点では採用不可。**
試作のread結果・制約として公開し、Playerの8580対応完了とは表示しない。

## 外部GPL参照と採用前の検証

既存の[外部SID参照tool](../../third_party/sid-reference/README.md)は次を固定している。

| Component | Revision | 原本archive SHA-256 |
| --- | --- | --- |
| [libsidplayfp 3.1.2](https://github.com/libsidplayfp/libsidplayfp/tree/b1e8f1deedf41d343123319237c0d008d72cbea7) | `b1e8f1deedf41d343123319237c0d008d72cbea7` | `6d16c20e523ac4d3e385531dafe247a830b59bcb4eb73a557f15cf4e7ae6da84` |
| [libresidfp 1.2.3](https://github.com/libsidplayfp/libresidfp/tree/32c8525418a643eaed8dfafa3d7039e250050cfa) | `32c8525418a643eaed8dfafa3d7039e250050cfa` | `e9b53a984ca708c3e8d9139eb6aad6141f73ffc22d70a020f7966803f4e2f76d` |

両者GPL-2.0-or-later。既存toolはlookup table初期化だけを直列化した
`libresidfp 1.2.3+serial-table-init`と明示され、DSP／gain／resampler式は変更していない。
既存strict PAL6581 CLIを拡張したとは扱わず、8580比較が必要なら別の検証入口を作る。
GPLの参照binary／ソースは検証用の別processに保ち、permissive runtime／WASM／source-copy配布へ混ぜない。

採用判断には、少なくとも次を別々の結果として残す。

1. 自作fixtureのcycleごとのwrite **とread**、OSC3／ENV3、ADSR、SYNC／RING／TEST、noise、
   8580のfilter mode／cutoff／resonance／routing／volume。
2. Native／WASMのPCM・readback一致、異なるrender chunk、8〜96 kHz、複数instanceの独立性、実測性能。
3. GPL参照との条件を固定した差分。参照側のclock／resampler／遅延／gain差を隠さず記録する。
4. read-dependentな自作6502プログラムでは、各候補の実readを**その候補自身のCPU分岐へ返す**closed-loop検証。
   既存writes-only traceの再生だけでは、bus latchや読み出しを使う実曲の正しさは証明しない。
5. 実曲を試す場合は元ファイルのSHAと選択subtune／model／clock、成功・未対応理由だけを記録し、
   音楽データやROMを配布物へ追加しない。人の実聴とAIの数値検証も区別する。

試作が動いても、未実装bus挙動、音質差、performanceが残れば本番統合は別の判断になる。
既存6581経路と校正値を維持したまま、まず8580モデルを比較できる材料を作る。

## 隔離prototypeの測定で分かったこと

[検証結果](sid8580_probe_verification_01.json)では、自作14fixture × 3 sample rates × 2 modelsの
84ケースでNative／WASMのPCM・readbackとchunk分割結果が一致した。
外部libresidfpとの28ケースは合否判定を伴わない診断であり、本番採用や実機一致の結果ではない。
特に次を残す。

- **バスの欠落は実測でも再現した。** `write-only-bus`のcandidateは両modelとも`[0,0,0]`。
  referenceは6581で`[165,165,0]`、8580で`[165,165,165]`。
  これは音量差ではなく、CPUの分岐やmodel検出を変え得るread動作の差である。
- **初期条件が揃っていない。** pinned libresidfpの
  [`WaveformGenerator.h`](https://github.com/libsidplayfp/libresidfp/blob/32c8525418a643eaed8dfafa3d7039e250050cfa/src/WaveformGenerator.h)
  はaccumulator初期値`0x555555`、
  [`EnvelopeGenerator.h`](https://github.com/libsidplayfp/libresidfp/blob/32c8525418a643eaed8dfafa3d7039e250050cfa/src/EnvelopeGenerator.h)
  はenvelope初期値`0xAA`を持ち、reset時にもそれぞれ保持する。
  candidateは両方0から開始するため、`phase-envelope`冒頭のOSC／ENVはreferenceの`85／170`に対し`0／0`。
  TEST後に十分clockしたfixtureではreadが一致するが、他voiceの初期envelopeや出力段の過渡はなお比較に混ざる。
  初期値・read pipeline・実際の発振／ADSR動作の差を分けて検証する必要がある。
- **8580選択は存在するが、専用modelの近似は残る。** candidateのresonanceは両model共通の
  `Q = 0.707 + res/15`（最大約1.707）。referenceの
  [`Filter8580.h`](https://github.com/libsidplayfp/libresidfp/blob/32c8525418a643eaed8dfafa3d7039e250050cfa/src/Filter8580.h)
  は8580回路由来のresonanceを別に記述し、最大Qを約2.6と推定している。
  このsource上の差はcutoff表の切り替えだけでは解消しない。referenceの推定自体を実機の唯一の値とは扱わない。
- **外部RCと音量の比較条件も異なる。** candidateのhigh-passは約16 Hz、referenceの既定値は
  10 kΩ／10 µFで約1.6 Hz。referenceはmodel別の出力scaleも持つ。
  8580 `saw`のraw RMSはcandidate約0.0964／reference約0.1606だが、meanを除いたAC RMSは
  約0.0964／0.0853である。raw RMS比をそのまま音量補償係数や音質評価へ使わない。
- **sampling開始位相も異なる。** candidateは位相0から整数比でsampleを取り出す。
  referenceのDECIMATEは初回tickでsampleを出し、周期を1/1024 cycle単位へ量子化するため、
  今回の48 kHz比較ではreferenceが各ケース1 frame多かった。
  同じindexのcommon prefix比較は補正せず記録しており、その誤差をすべてSID内部の誤差と解釈しない。
- **実行速度は単体コアの値。** Apple M2／Nodeのbounded batch測定では約70倍以上の実時間速度だった。
  C64 CPU、AudioWorklet、ブラウザーの全経路を含む性能保証ではない。
  Playerへ統合するなら1 PHI2ごとのJS↔WASM往復を避ける構成と、read-dependent CPUのclosed-loop検証を別途要する。

この段階で確認できたのは、限定したprototypeの移植一致と、外部参照との差を観測できること。
write-only bus、初期条件、8580固有の近似、実曲・実聴は引き続き採用前の課題である。
