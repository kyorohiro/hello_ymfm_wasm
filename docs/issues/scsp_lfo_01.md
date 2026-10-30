# SCSP LFO — TODO（2026-10-30）

順序：コア検証 → JavaScript／型 → Main／Worker／Native → UI。

- [x] 低速codeの位相停止とLFORE無視を実WASMで再現する。
- [x] 開発SDK側で位相精度・LFO resetを修正し、原本を保持する。
- [x] 正規source archive／import経由で親・Tauriの固定SDKを更新し、SCSP WASMとsource receiptsを再生成する。
- [x] rate 32段階、pitch／amplitudeの4波形・8段階depth、reset／resume、depth 0の従来PCM一致を検証する。
- [x] setLfo／preset.lfo・型・state clone・loop境界の保護を追加する。
- [x] Main／Worker／Nativeの命令、手動lease、部分更新、取消・Stopを接続する。
- [x] Native／WASMの同入力・分割render一致を検証する。
- [x] PlaygroundとSynthで「SCSP hardware LFO」として操作できるようにし、presetへ保存する。
- [x] browser・型・package・校正source freshnessと配布物を更新する。

根拠：Sega SCSP User's Manual §4.2.6（LFO）。
https://docs.exodusemulator.com/Archives/SSDDV25/segahtml/hard/scsp/hon/p04_26_j.htm
公開npm 0.2.35と既存ZIPは保持する。npmの再公開は今回の範囲に含めない。

## 完了 — 2026-10-31

[集約report・source／配布hash](scsp_lfo_01.json)。

実WASMで旧coreのcode 0（公称0.17 Hz）が、attack後の8秒間動かないことを再現した。
原因は16-bit位相と整数stepによる低速codeの切り捨て。開発SDKでgain tableとは独立した
32-bit周回位相へ変更し、LFOREのphase zero／hold／resumeも実装した。
原本MAMEは保持し、変更をREADME／CHANGELOG／source inventoryへ記録。
正規source archiveとimporterで親・Tauriの476-file固定snapshotを更新した。
SDKは0.1.7の未公開candidateで、archive hashを新たに固定している。

`setLfo(slot, patch)` は指定fieldだけをlive更新し、発音を再開始しない。
`setPreset(slot, {lfo})` は次回keyOn用。frequency codeは0..31、pitch／amplitude waveは
0 saw／1 square／2 triangle／3 noise、depthは各0..7（0=Off）、resetはboolean。
両LFOはslotごとに速度を共有する。`reset:true` は両位相をzeroで保持し、falseで再開。
公称Hz／cents／dBのtableもexportした。

pending presetと実発音のLFO／frequency参照を分け、部分更新が予約された別fieldを潰さないようにした。
loop境界は最大PLFO変位を含めて事前検証。Native callbackでもOn／live pitch／LFO編集を
変更前に検査する。release後のPCM参照はStopまで保護し、無音推測で解放しない。

Playgroundと専用Synthに「SCSP hardware LFO — live」を追加。
Synthではheld keyboard voicesにも適用し、PCM込みpresetへ保存する。
旧version 1 presetはLFO Offとして読める。Copy voice JavaScriptもLFO設定を含む。
PCM描画・変換などソフト機能と区別した。

### 検証

- Node **1,192成功**（重複する個別runは加算しない）。LFO全32速度、全波形、reset、
  depth 0の従来PCM、分割render、loop境界、Main／Worker／Native client・手動lease・presetを含む。
- Native SCSP **13 Rust tests成功**、Tauri debug build成功。
  [実Native Core対WASM](scsp_lfo_native_parity_01.json)は **132 cases／9,988,376 stereo frames差分0**。
  hot intervalのRust alloc/dealloc・C++ new/deleteは0。直接のC malloc/freeは計数対象外。
- SDK consumer Python **143成功**、SDK release unit **107成功**。
  [固定SDK集約検証](scsp_lfo_sdk_validation_01.json)は **33 builds／65 outputs／40,474既存chip比較一致**。
  SCSP以外の生成JS／WASM **63 filesがbyte一致**。
  SDK pin変更に伴うPS1 receiptは正規recipeで実際に再ビルドして採用し、出力が同一と確認した。
  途中のsource変更中の検証はsnapshot guardで拒否され、固定後の最終runだけを採用している。
- PS1／WonderSwan／POKEY／SCSPの校正を新reportで実施し、SCSPのpolicy適用後も48経路＋8基準で再検証。
  旧report・旧153基準は維持。生成・freshness unit **42成功**。
- 実npm tarballの隔離install・396宣言、NodeNext／Bundler正負型・Node ambientなしbrowser型が成功。
  開発buildの互換性検証であり、公開済み0.2.35は更新していない。
- [実Playground Run ZIP](scsp_lfo_playground_zip_browser_01.json)：Chromium／WebKit × Main／Worker成功。
  LFO、PCM8／描画／20 MiB超WAV、Copy voice、PC Keyboard、focus、Mixer／FX／復旧／Stopを確認。
  Mixer倍率測定のfixtureではLFOをOffに固定し、周期変動とgain検証を混同しない。
- [実Synth ZIP](scsp_lfo_synth_zip_browser_01.json)：両browserでlive LFO／preset／WAV／focus／Stop、
  単一canvas・390px幅のoverflow 0を確認。
- [Tauriへ取り込んだ実frontend](scsp_lfo_native_browser_01.json)：両browser × Main／Worker成功。
  RPCだけmock。Native audio deviceは開いていない。
  対応する[Native source bundle](scsp_lfo_native_sources_01.json) **2,169 files**と24 snapshotsも検証済み。

### 配布物と再開

- `release/tetorica_scsp_synth_lfo-dev-20261031_itch.zip`（36 files）
- `release/hello_ymfm_wasm_scsp-lfo-dev-20261031_itch_playground_for_run.zip`（967 files、directory entryなし）
- `release/hello_ymfm_wasm_scsp-lfo-dev-20261031_itch_playground.zip`（完全source版）

完全source版をTauriへ正規import済み（1,119 frontend files）。SDKとUIは同時に更新する。
人の試聴・実機精度・実audio deviceのdeadline／interruptionは未検証。
公開済みnpm 0.2.35・旧ZIPは保持し、npm／SDK公開、commit／pushはしていない。
**親repo、`w/tetorica-soundchip-native`、`w/tetorica-fm2612-playground-tauri` は別Gitで、3箇所に変更がある。**
