# SCSP slot modulation / sound stack — 2026-10-31

目的：既存PCM／LFOを保ち、実装済みcoreのsound stack経由の波形アドレス変調を段階的に公開する。
DSPのdelay用RAM ring bufferとは別機能。

## 今回の区切り

- [x] 固定coreのMDL／MDXSL／MDYSL・STWINH・slot処理順・TL／direct sendの関係を実WASMで検証。
- [x] 変調先PCMの前後を周期波形で保護し、他sampleを読む設定を高レベルAPIで拒否。
- [x] 次回keyOn用presetとlive部分更新を分離し、state・型・Main／Worker／Nativeに接続。
- [x] Playgroundのslot editorでhardware機能として操作し、自作2-slot例を用意。
- [x] Node・実browser・Native境界の検証、配布source freshnessを確認。

## 後続（別の受入条件）

- [x] 専用Synthの複数slot音色・予約／解放・polyphony管理とPCM込み複数operator preset。
  2-op FMとして[完了・操作／検証](scsp_synth_fm_01.md)。下記はこの前段を完了した時点の記録。
  現行の単一slot presetを、modulatorを含む音色保存と混同しない。
- [ ] 自己feedback／複数段algorithmの操作UI・実機精度検証。slot write latency／address clipping／低MDL域のmanualとの差をSDK側で調査する。
- [ ] DSPプログラム／係数／routing。

根拠：Sega SCSP User's Manual §4.2 FM Voice Mixing、pp.56–71。
https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf
固定MAME由来coreはSCSP_FM_DELAY=0で、manualのslot write latencyとは異なる。
またaddress clippingの完全な実機再現は未検証。core挙動を実機精度保証とは表示しない。
固定SDK snapshotは直接編集しない。npm 0.2.36と既存release ZIPは保持し、自動公開しない。

## 実装記録

`ScspSynth` に `preset.modulation`／live `setModulation` とcopyされたstateを追加。
MDL 0..15、X/Yのraw stack offset 0..63、STWINH。depth 0はwordを0にして確実にOff。
次回presetと実発音の設定を分離し、TL更新はSTWINHを保持するmasked writeへ変更した。
Nativeのdepth変更は投影時のX/Yを含めてwordをcommitするため、予約中の別X/Y編集は同patchへ明示する。

`loadPCM(...,{modulationDepth})` はfull forward loopだけを受け付け、最大signed displacementに
対応する周期コピーを前後に配置する。MDL15では片側16,384点。source descriptorにallocationAddressを記録。
編集poolも同じ領域を使い、held／release／他slot参照を保護する。padding不足は発音・live変更前に拒否。
Native callbackも境界を再検査し、release中も変調で読まれるguardへのRAM uploadを拒否する。

Playgroundに「SCSP hardware slot modulation — live」とsoftware PCM guard設定、2-slotの自作例を追加。
専用Synthは今回のFM panelを非表示とし、単一slot presetでlinked FMを復元したようには見せない。

手動試奏の保護でSCSP setLfoがslot命令として分類されていなかった点も修正。
それに伴い専用Synthのheld mix／LFO伝播を、正しいaudition ownerを使うInspector経由へ変更した。
両browserでLFO／preset／blur／Stop／mobile表示の退行がないことを確認。

固定SDK／C++／WASMは変更なし。親とTauriのSDK 476 filesを正規importerでoffline検証済み。
SDKのslot-write delay=0、address clipping、低MDL域のmanualとの差を記録し、実機精度は保証しない。
既存catalogのSCSP folder／mode数と、Mega-CDの専用compact例に対する古いtest期待値も更新した。

## 後続の確認メモ

専用Synthの既存Pitch操作も、held slotへの通常commandとmanual leaseの関係を確認する。
今回追加する複数operator音色管理では、pitch／mix／LFO／変調の全操作を同じvoice ownerへ送る。


## 初期段階完了・検証

[最終report／source・配布hash](scsp_fm_01.json)。

- 関連Node **1,200成功**、Native SCSP Rust **14成功**、Native debug build成功。
- 実Native Core／WASM **152 cases・10,317,080 stereo frames完全一致**。分割render・register・RAM・counterを比較し、hot intervalのRust alloc/dealloc・C++ new/deleteは0。直接C malloc/freeは対象外。
- 校正・source freshness **42成功**、例catalog **34成功**、performance processor **26成功**。これらは別runであり、重複する個別runは合算しない。
- 全Playground modeの型、隔離npm install・実WASM・NodeNext／Bundler・Node ambientなしbrowser型成功。開発package 1,051 files。公開npm 0.2.36のtarballは変更なし。
- 新規PS1／WonderSwan各48＋FM基準8、POKEY96＋FM8＋PSG8＋dual8、SCSP48＋FM8を実測。SCSPの最終policyも48＋8で検証。各pilot PCMは連続。既定gainはprimary0.128825／extra0.128826。古いgainでの先行verifyは最終reportとして採用せず、新しいbaseline由来gainで再測定した最終runのみを保存。
- 実Run ZIPのChromium／WebKit × Main／Worker全4経路でFM live編集・X/Y・STWINH・PCM8 guarded Apply・Copy code・focus・Stop成功。同じZIPで従来の20 MiB超WAV／鍵盤／Mixer／FX／suspend→Run復帰も全4経路成功。
- 専用Synth ZIPは両browserで従来PCM／LFO／preset／held PCM保護／blur／Stop・390px幅overflow0を確認。SynthのFM複数slot操作は未公開。
- Tauriへ正規importした実frontend 1,120 filesでも両browser × Main／Workerのprimary／extra・FM UI成功（RPCのみmock）。対応Native source ZIP 2,170 files／24 offline snapshotsを全hash検証。

配布物：

- `release/hello_ymfm_wasm_scsp-fm-dev-20261031_itch_playground_for_run.zip`
- `release/hello_ymfm_wasm_scsp-fm-dev-20261031_itch_playground.zip`（完全source版、Tauriへ導入済み）
- `release/tetorica_scsp_synth_fm-api-dev-20261031_itch.zip`（既存Synthのowner経由LFO更新を含む。FM panelは非表示）

人の試聴・実機精度・実audio deviceのdeadline／interruptionは未検証。
今回npm／itch／SDK公開、git commit／pushは行っていない。
親repoと `w/tetorica-fm2612-playground-tauri` は別Git。Tauriの既存LFO／SDK導入差分も残っているので、親だけのcommitではNativeの変更は保存されない。
