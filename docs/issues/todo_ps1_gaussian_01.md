# PS1 SPU: Gaussian interpolation

Date: 2026-10-29
Status: 未実装を確認。今回は調査・引き継ぎのみで、音源コードの変更はしていない。

## 確認した現状

ユーザーから、SPUのガウシアン補間が入っていないのではないか、との指摘があった。
確認したところ、現在はMAME由来コアの**2点線形補間**を保持している。

- 原本：`w/tetorica-soundchip-native/vendor/mame-ps1-spu/spu.cpp`。
  `generate_voice()`内の2084／2108／2152／2175行付近で、隣接する2サンプルに対し
  `s0 + (((s1 - s0) * dptr) >> 12)` を計算し、その後にenvelope等を適用する。
- 同ディレクトリの `spu_tables.cpp` にガウシアン係数表はない。無効化された既存実装も見つからなかった。
- 固定SDKとTauriも同じコアを使う。SPU Synth／PlaygroundのWASMにも共通する制限。
- C API／JS API／UIに補間方式の切り替えはない。
- 制限は原本の `vendor/mame-ps1-spu/README.md` と本体の
  [`docs/ps1_spu.md`](../ps1_spu.md) にも線形補間として記載されている。

実機については、[PSX-SPXのSPU仕様](https://psx-spx.consoledev.net/soundprocessingunitspu/)
の「4-Point Gaussian Interpolation」に、直近4サンプルとpitch counterの位相から出力を計算する方式が記載されている。
一般的なGaussian関数による近似だけで同じになるとは扱わず、係数・位相・整数演算を確認する。

## 作業する場合の範囲

1. SDK原本の各voiceのpitch補間に実装する。ADPCM decode後、ADSR／mixより前の処理。
   `upstream/`の原本は保持し、local changesと係数の出典・利用条件を記録する。
2. 既定を置換するか、Linear互換モードを残すか、C／JS APIやUIで選べるようにするかは未決定。
   ユーザーは今回、未対応への気づきを伝えている段階。まだ実装開始・既定変更の指示は受けていない。
3. SDKの正規export/importから固定snapshot・WASM・Tauriへ展開し、
   SPU Synth／Playground／npm側の同じコアへ反映する。固定snapshotを手編集しない。
4. 音の計算が変わるため、PS1音量測定・Mixer基準・配布source/provenanceへの影響も確認する。
   過去の測定JSONやhashを付け替えて新実装の測定結果に見せない。

**ホスト出力のresamplerは別処理。** `web/ps1_resampler.js`等はmix済み44.1kHzをデバイスrateへ変換する。
ここだけを変更してもSPU各voiceのガウシアン補間にはならない。

## 必要な検証

- 独立した仕様ベースの係数／位相／丸め／clipの期待値。NativeとWASMの一致だけを実機精度の証明にしない。
- Note On／Reset時の履歴、ADPCM packet／loop境界、END、zero／fractional／maximum pitch、分割render。
- 通常PCM、noise、pitch modulation等の適用位置を確認し、対象外の経路へ誤適用しない。
- Native／WASM一致、既存ADSR／PCM編集／Keyboard／Stop等の回帰確認。
- 現行 `web/ps1_spu.test.mjs` には整数pitchでの原PCM一致と端数の線形補間を期待する試験がある。
  既定変更時は補間方式ごとの試験に整理し、期待値だけを新出力に置換しない。
- 新しいBrowser／Native測定と、ユーザーによる音の比較。

## 引き継ぎ

リリース済みSPU Synthの未対応機能として
[スレッド引き継ぎ](thread_handoff_20261029.md) にも追記した。
今回の調査では実装・SDK・WASM・Native・公開済みZIPの変更、再リリースはしていない。
