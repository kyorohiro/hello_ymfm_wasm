# SCSP Synth — 2-operator FM / grouped voices（2026-10-31）

- [x] 専用Synth内の音色モデル：Carrier／Modulator、PCM／2-op FM切替、ratio／depth。
- [x] 同じcanvasでoperatorを切替え、各PCM／EG／LFO／mixを編集する。
- [x] source 2 slotsを予約し、PCM 30 voices／FM 15 voicesをgroup単位で割当・steal・離鍵・Stopする。
- [x] held／releaseのPCM保護、古いnoteOff、blur、モード変更、読込失敗を検証する。
- [x] Pitch／ratio／depth／mix／LFOのlive変更を、専用Synthの同一voice ownerへ適用する。
- [x] PCM込みversion 2 preset。version 1はPCMとして読み込み、不正presetは現音色を変えない。
- [x] 実WASM／Node、両browser、展開ZIPを検証し、手順と引継ぎを更新する。

範囲：まず2-operator（Modulator→Carrier）。任意graph／feedbackは後続。
割当とguard PCM配置・presetはソフト側、slot変調とEG／LFOはSCSP core側。
共有Playground／Nativeコアは前段の検証済み実装を維持し、専用Synthのcontroller／processorでまとめる。
公開済みnpmと既存ZIPは変更しない。自動公開・commit／pushはしない。


## 完了・操作

1. 専用SynthでStart audio → Voice modeを **2-operator FM** にする。
2. 鍵盤を弾き、**FM depth**／**Modulator ratio**／Pitchを動かす。
3. **A · Carrier / B · Modulator** で同じcanvasの編集対象を切り替える。各operatorのPCM／EG／LFO／mixは独立。
4. Applyしてから切替・保存する。Save presetは両方の適用済みPCMを含むversion 2を出力する。

ModulatorはDirect level 0固定で、TLが変調量に効く。carrierはFM mode中はfull forward loop（start 0）。
FMに使うguardは専用controllerが配置し、ユーザーへraw X/Y offsetは要求しない。
編集元slotのgateは鍵盤の状態ではないため、専用Synthではその表示を非表示にした。
Copy JavaScriptは選択operator単体と明記し、音色全体の保存とは分けた。

`instrument.js` がcoreを所有し、source slots 0/1を予約。PCMは残り30 slots、FMは15組の隣接pair。
FMでは先のslotがmodulator、次がcarrierで、固定coreのzero-delayに合わせたoffset63を使用。
離鍵とstealはpair全体へ適用し、release中のgroupを優先して再利用する。stale IDのnoteOffは無効。
PCM変更後もheld/releaseは旧sampleを参照し、Stop後は全playback preset参照も外してeditor pageを再利用する。
RAM満杯・不正設定は事前検証し、現演奏を変えない。mode切替は検証成功後にStopする。

専用`processor.js`が同一worklet message内でgroup操作を実行する。
Pitch／ratio／depth／mix／LFOを直接同じ所有groupへ更新するため、従来のheld Pitch commandが
manual leaseで無視される経路も解消した。既存Playground／Nativeの制御・runtime・coreは変更していない。
AudioWorkletにないstructuredCloneへの依存を除き、初期化、閉じたAudioContextの再接続も確認。

version 2は両PCM／各EG・LFO・mix／mode・ratio・depth・transposeを保存。
全体をvalidation用bankで確認してからStop・bank clear・loadする。不正ファイルは演奏を止めない。
version 1はPCM＋標準modulatorに変換する。ファイル上限4 MiB、PCM各2..65,535点。

## 検証と配布

[集約report／source・配布hash](scsp_synth_fm_01.json)。

- Node **11成功**：実WASMの2-op発音、live Pitch／ratio／depth／mix／LFO、15FM／30PCMのgroup steal、
  古いnoteOff、held／infinite release PCM保護、RAM満杯のatomic拒否とStop後再利用、
  preset往復のPCM完全一致・不正input・v1互換、専用processorの44.1/48/96kHz分割render一致・Stop silence、配布ZIP決定性／source hash。
- 最終ZIPを展開し、Chromium／WebKitでFM和音、単一canvasでのoperator編集、old PCM保護、
  live Pitch／ratio／depth、preset v2／v1、不正presetでも演奏継続、mode切替・blur・Stop、
  WAV、focus、AudioContext close→Start再接続、390px幅overflow0が成功。物理出力はmute。
- 既存共有校正のsource freshnessと両policy generator --checkが成功。
  `web/`／`docs/js/`／`docs/generated/`／`docs/playground/`、SDK／C++／WASMに差分なし。
  今回は専用Synthの変更なので全音源の再校正はしていない。
- 最終ZIP：`release/tetorica_scsp_synth_fm2-dev-20261031-checked_itch.zip`（36 files）。
  原factory／WASM、固定SDK source／licenseと新controller／processor等のbrowser入力sourceをhash付きで同梱。

人の試聴と実機精度比較は未実施。固定coreのlatency／clipping／低MDL域の差は引き続き残る。
今回は専用Browser Synth。任意algorithm／feedback／DSP／専用Synth Nativeは後続。
npm／itch公開、commit／pushはしていない。公開npm0.2.36と旧配布ZIPは保持。
