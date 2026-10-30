# 次スレッドへの引き継ぎ — 2026-10-29

このファイルがスレッド終了時点の入口。まず本書を読み、詳細が必要な箇所だけ
[savePoint.md](savePoint.md) と個別の作業記録を参照する。
savePointの下位の「未commit／未公開／次は…」は当時の履歴であり、現在の残作業とは限らない。

## SCSP PCM／EG編集 — 2026-10-30

ユーザーのレイアウト修正確認後、PCM／EG編集とCopy voice JavaScriptを実装。
[作業記録](scsp_editor_01.md)／[操作手順](../scsp.md)。単一canvasの描画、4波形、
共有PCM選択、PCM8/16・root/source rate・loop、EG、live mix、適用済みPCM付きJS出力。
描画はUI draftのみ。Apply時に新規allocationし、共有／発音中sampleは上書きしない。
毎ApplyのRAM消費は表示・説明済み。個別解放／再利用、PCMファイル入力は後続。
関連Node 93 tests・Playground型・npm package build成功。
Chromium／WebKit × Main／Worker全4経路で描画・Apply・EG・コピーコード再実行・Stopを検証。
物理出力はミュートしたPCM検証。SCSP自体の音量校正／Native／専用Synth／SSFは未実施。
旧校正reportは改変せず、別途固定hashでUIとSCSP専用URLの差分を監査。
未commit／未公開。既存release ZIPは未再生成。SDK／WASMは変更なし。

## SCSPタブのレイアウト修正 — 2026-10-30

ユーザー確認でSCSPの音は出たが、タブ表示がFilesを圧迫していた。
Workbenchのprimary panel移動／floating Keyboard対象にSCSPを追加し、右側のCodeと同じhostへ配置。
cache tokenも更新。unit 32＋校正／UI監査27成功。
Chromium／WebKit × Main／Worker、幅1440／686pxでFilesとの非重複と発音を確認。
[修正記録・監査](scsp_layout_01.md)。校正reportは変更せず、正確なUI-only変更の前後hashで受理。
未commit／未公開。以前のdev ZIPは未再生成。

## SCSP Playground初期接続 — 2026-10-30

Saturn (SCSP) Mode、Main／Worker AudioWorklet、32-slot Inspector／Hold／Keyboardを追加。
初期コード・自作PCM16 stereo例、primary借用／独立instance、Stopを実装。
[今回の範囲・再実行・制約](scsp_playground_01.md)／[操作手順](../scsp.md)。
関連253＋校正生成37＋ZIP準備10＝300 Node testsと型検証成功。
実Run ZIPのChromium／WebKit × Main／Worker全4経路成功。物理出力をミュートしたPCM検証で、試聴ではない。
既存PS1／WonderSwan／POKEYの新規校正reportとgenerator参照を更新。過去reportのhashは改変していない。
Run ZIPは964 entries。SCSP source／licenseも同梱。npm package build／installed検証成功。
専用`release/*scsp-dev-20261030*`を生成したが、公開・commitは未実施。SDK／生成WASMは変更なし。
次はPCM／EG編集・Copy voice JavaScript。Tauri Native／専用Synth／SSFは後続。
SCSPのMixerは未校正の等倍。WebKitのlayout observer通知はbrowser JSONに別記。
以下の「Playground未対応」は過去時点の記録。

## SCSP共通Synth API — 2026-10-30

`web/scspsynth.js`に`ScspSynth`を追加。signed PCM8/16、明示的な基準音程、32物理slots、
forward loop、named EG、音名、live pitch／mixを扱う。raw／Synthの`.d.ts`も追加。
実WASM 14 tests＋strict TypeScript確認成功。[API・制約・例](../scsp.md)／[TODO](todo_scsp_01.md)。
RAMは512 KiB append-only、所有descriptor、clear resetで失効。個別置換／解放なし。
音色編集は次keyOn用、pitch／mixは明示live。Stopは無限releaseも停止しbank／音色を保持する。
短いloop長を超えるpitch stepは現コアの単一wrap制約により拒否する。
次はhost-rate resampling検証とPlayground Main／Worker AudioWorklet・Mode接続。
Playground UI／専用Synth／Tauri Native／SSFは未対応。SDK・生成WASMは今回変更なし。
今回の変更は未commit／未公開。下の作業時点の状態は履歴。

## SCSP固定SDK導入・低レベルJS API — 2026-10-30

[SCSP TODO](todo_scsp_01.md)の段階1とraw `Scsp` wrapperを完了。[導入・検証](scsp_sdk_import_01.md)。
SCSP配布ZIPの隔離Native／WASM再ビルドとPCM比較、33 builds／65 outputsのaggregate検証成功。
既存63生成ファイルはbyte一致、29コアのPCM／API比較40,474件一致。Node 135／Python 143／SDK unit 107成功。
固定snapshotを正規importerで導入。SDK 0.1.7の未公開local candidateとしてbase commit・差分・hashを明示。
`web/scsp.js`と`docs/generated/scsp_wasm.*`、[自作Sine例](../scsp.md)を追加。
次は`ScspSynth`のPCM／音程／EG／32 slots／RAM管理、続いてPlayground接続。
Playground・専用Synth・Tauri Native callback・SSFはまだ未対応。公開／commit／remote CIは未実施。
SDKと親repoの双方に未commitの変更がある。下記の「consumer pin未更新」は過去時点の記録。

## 次の開発：SCSP初期共通コア — 2026-10-30

ユーザー了承でSega Saturn SCSP対応を開始。[段階別TODO](todo_scsp_01.md)。
作業用SDK `w/tetorica-soundchip-native` にMAME由来の独立C++コア・C ABI・CMake／WASM recipeを追加。
自作SineのNative／WASM PCMがbit一致。Native CTest・ASan／UBSan・SDK catalog／出典検証成功。
[実装・検証・再開手順](scsp_core_01.md)。次は配布監査／固定SDK導入からJS API・Playgroundへ。
FM／LFO／DSPの動作検証、Synth、Nativeアプリ接続、SSF対応は未実施。
SDKは別Git管理で未commit。親repoだけをcommitしてもSDK変更は保存されない。
現在の配布snapshot／公開版／SDK pinは変更せず、公開・commitは行っていない。

## PSFの既知誤候補を除外：2026-10-30

想定VB内の別VAB／構造の整ったSEQヘッダーを検知し、曖昧な候補を除外する共通処理を追加。
Playground・Synthの両UIとCLIに理由を表示。128 tests、両UIの6ブラウザ経路成功。
同一入力111 entriesを再検査し、候補ありentryはWild Arms 3→1／Crash 6→0／Clock Tower 20→20。
残る候補の忠実度は未確認。分離VH／VB対応は後続に残してPSはいったん区切れる。
[実装・検証](spu_psf_body_guard_01.md)。ソース変更のみで、今回の配布ZIP作成・公開は未実施。

## 追加2作品のPSF調査：2026-10-30

Wild Arms 66 entries／Crash Bandicoot 25 entriesを全走査し、処理エラー0。
現行抽出器の採用候補はそれぞれ3／6 entries。代表候補のPlayground・Synth計12ブラウザ経路成功。
ただし想定VB領域に別VABヘッダー／SEQ識別子があり、正しい元音色の復元成功とは扱わない。
調査時点ではVH／VB対応付けと誤候補の除外を優先とした。既知パターンの除外は上記で完了。[調査記録](spu_psf_multi_title_01.md)。
製品コード・配布ZIPは変更せず、ゲーム由来データは一時領域のみ。人の耳での試聴は未実施。

## 公開報告：2026-10-30 Playgroundリリース済み

ユーザーから「Playgroundをreleaseしました」と報告あり。Playgroundの公開を完了として扱う。
報告時のローカルHEADは`617af9bb`（commit subject `v0.95.2`）。公開URL・実際のアップロードZIP／hash・
公開画面上の版番号・devlog投稿の有無は未記録。ローカルcommit名だけで公開版番号を断定しない。
[再開TODO](todo_spu_resume_20261030.md)を更新済み。以下の「未公開」は各検証作業時点の履歴。
ユーザーの実聴・別作品での互換性確認は、公開完了とは別に残す。

## 後続整理：release削除後も残るSPUデモ

ユーザーがreleaseを削除して再buildする相談をしたため、合成VAB／PSFデモを
`docs/playground/samples/spu-import/` へ保存。package時にfixtureから再生成し、ZIPへ全10 filesを同梱する。
[操作・検証](spu_import_demo_assets_01.md)。新ブラウザ用ZIPは941 files、前回版のruntime 550 filesとbyte一致。
releaseの削除は実行していない。削除すると過去版ZIPも失うため、必要な公開版は別途退避する。
PlaygroundのbuildだけでStandalone Synth ZIPは再生成されない。

## 自動作業：2026-10-30 Playgroundの校正gate解消とZIP検証

ユーザーが試聴できない間に、PS1／WonderSwan／POKEYを現在のソースで全経路再測定。
新reportへ切り替え、旧記録・guardを保持したままfreshnessチェックを通した。PS1 gainは不変。
校正関連385 tests、PS1の生成設定適用後の全経路再測定、展開したRun ZIPのVAB／PSF／SPU編集の計12経路成功。
[記録・測定・配布ZIP](playground_spu_vab_release_01.md)。ブラウザ用は931 filesでitch上限内。
[再開TODO](todo_spu_resume_20261030.md)の4を更新済み。校正gateは未解決として再調査しなくてよい。
人の耳での試聴、別作品の検証、公開URLの確認は後続。新ZIPの公開・npm公開・git操作は行っていない。

## 次回の入口：仕事中断後の再開TODO

まず [SPU Synth 再開時のTODO](todo_spu_resume_20261030.md) を読む。
確認開始時HEADは`ef99ec18`（`v0.1.0`）。既存配布ZIPは末尾`v0.1.0.zip`／`v0.1.0_for.zip`へ整理され、
両方とも前回の最終検証ZIPと同じSHA-256。公開ページ・devlogの実施状況は未確認なので、最初に確認する。
以前のversion末尾なしZIP名を現在の配布物として探さない。

ユーザーが仕事中で確認できない間の独立作業として、全entryの静的互換性検証CLI
`scripts/inspect_psf_banks.mjs` と7 testsを追加。共通パーサー9 testsと合わせ16件成功。
既存Clock Towerセット20 entriesを再走査し、overlay・bank情報・対応Tone数が前回記録と全件一致。
[CLI操作](../../scripts/inspect_psf_banks.md)／[再検証JSON](spu_psf_compatibility_clock_tower_02.json)。
追加作品の確認完了とは数えない。製品UI・音源・配布ZIP・校正gain／既存reportは変更していない。
この再開メモ作成時はPlayground freshness gateで従来のエラーを再現。その後、上記の自動作業で解消した。
公開・投稿・git操作は行っていない。

## 公開準備：2026-10-30 PSF / VAB専用タブとdevlog

ユーザーがPSF読み込みの動作確認後、Audioから独立した **PSF / VAB** タブへ移動。
5タブのnavigation・音の保持・390px表示を維持。Morph確認応答とUI描画の間でチェックが戻る競合も修正。
76 Node tests、最終展開ZIPのChromium・WebKit全回帰成功。公開用 `release/tetorica_spu_synth_dev_itch.zip` を作成。
[公開準備・検証記録](spu_synth_bank_tab_release_01.md)、[英語devlog原稿](devlog_spu_psf_vab.md)。
ZIPの包装labelは既定devで、新しい公開versionは採番していない。itch.ioへのアップロード・投稿は未実施。
複数作品での対応確認や未対応形式は後続TODO。Playgroundの校正freshness gateも別TODOのまま。

## 後続機能：2026-10-30 SPU SynthでもPSF音色インポート

PlaygroundのPSF1／MiniPSF静的抽出をStandalone Synthへ接続（後続でPSF / VAB専用タブへ移動）。
Open PSF set／folder → entry → Extract VAB banks → bank／Tone → Load selected Toneで鍵盤演奏・preset保存。
非対応Toneを無効化し、最初の対応Toneを自動選択。ファイル読み込み・抽出途中のreset／新規loadで旧処理を取り消す。
67 Standalone tests＋9共通PSF tests成功。ソース版は全Synth回帰、新規展開ZIPはVAB／PSFをChromium・WebKitで確認。
実Clock Towerセットでも対応Toneの発音を確認。PSF2・曲再生・分離VH／VB・独自／runtime形式は未対応。
[操作・検証・試用ZIP](spu_synth_psf_import_01.md)。未公開。npm・DSP／WASM変更、git操作なし。
Playground公開前の校正freshness gateは別TODOのまま。

## 後続機能：2026-10-30 PlaygroundでPSFからVAB抽出

PSF1／MiniPSF＋PSFLibの複数ファイル・フォルダー選択、CRC／zlib検証、RAM重ね合わせと連続VAB検出を追加。
SPUタブのOpen PSF set／Open PSF folder → PSF entry → Extract VAB banks → bank／Tone選択 → Load Tone。
Clock Tower - The First Fearの20 entriesでVABを検出し、対応Toneの実SPU PCMをChromium・WebKit × Main・Workerの4経路で確認。
80関連testsと67Standalone tests成功。全Tone復元・曲再生・分離VH／VB・独自形式は対象外。
[作業記録・合成デモ](playground_spu_psf_01.md) を参照。配布前の校正freshness gateは前回から未対応。公開やgit操作は行っていない。

## 後続UI：2026-10-30 PlaygroundでのVAB試奏

SPUタブのSelected ADPCM voiceにVAB／VH＋VBの読み込みとTone選択を追加。選択Voiceだけへ適用して既存Hold／Sustain／Keyboardで試奏する。
ソース版Chromium・WebKit × Main・Workerで成功。Native primary／additionalの実RAM・PCMもNode検証。
[操作・検証・ローカル試用URL](playground_spu_vab_01.md) を参照。PSF抽出は未着手。
配布ZIP作成は音量校正のsource freshnessチェックで停止しており、公開前に校正証拠の更新が必要。測定report・gainの書き換えや公開は行っていない。

## 後続機能：2026-10-30 VAB音色インポート

標準Sony VAB v6／v7とVH＋VBをAudioタブから読み込み、単一Toneを選んで演奏・preset保存する初版を追加。
元ADPCM、ADSR、ループと基準音程・fine tuneを使用。鍵域分割、重ね音、PSF抽出は後続。
67 testsと、ソース版／新規展開ZIPのChromium・WebKit計4経路で成功。実ゲームのバンクは未検証。
[実装・検証・試用ZIP](spu_synth_vab_import_01.md) と [残TODO](todo_spu_synth_import_01.md) を参照。
未公開。npm、Web deploy、git commit／pushは行っていない。

## npm公開：2026-10-30 tetorica-fm2612 0.2.34

ユーザー指示でSine修正と累積SPU更新をnpmへ公開。`latest`も0.2.34。
公開tarballは検証済みartifactとバイト一致。詳細は [公開・検証記録](npm_ps1_cyclic_release_01.md)。
SDK 0.1.7はsourceを同梱した未公開ローカル候補のまま。Webサイトdeployやgit commit／pushは行っていない。

## 後続修正：2026-10-30 Sineの周期先頭の段差

PlaygroundのSine画像から、ADPCM先頭パケットのpredictor 0固定による粗い階段を確認。
周期専用の予測圧縮を追加し、初回とloopのno-wrapと誤差を比較して従来より良い候補だけ採用する。
Playgroundとstandaloneの初期Sine／PCM／Morph／PMONに反映。112サンプル・64バイトを維持。
[実装・比較波形・検証・試用ZIP](spu_cyclic_sine_01.md) を参照。npm版は上記0.2.34に公開済み。Web／Synth ZIPの追加公開は行っていない。
ユーザーが修正版を試して「治った!!」と報告し、異音の解消を実聴で確認済み。
前回のheadroom精度修正とは別に、元からあったSine波形自体の歪みを改善した。

## 後続機能：2026-10-30 長い音声のSoftware audio

ユーザーの20MB級音声を使いたいという指示で、SPU RAMを超える録音をホストPCMで演奏する機能を追加。
入力32 MiB／30分まで。SPUのピッチ・ADSR・PMON・Reverbを使い、Software audioと表示。
読み込み結果をLoad audioの直下にも表示し、version 2プリセットで録音ごと保存できる。
[実装・検証・試用ZIP](spu_synth_long_audio_01.md) を参照。この後続機能は未公開。

## 公開状況の更新：2026-10-30

ユーザーよりSine単音の精度修正版も「リリース済み」と報告。**公開済み**として扱う。
公開先・バージョン番号・公開物のhashは未指定。下記の試用ZIPと公開物の同一性は未確認。
公開待ちへ戻さない。以下の未公開・未commit記載は各作業時点の履歴。

## 後続修正：2026-10-30 Sine単音の精度維持

前回のvoice音量1/4方式で単音に量子化誤差が増えたため、ソフト側の広い加算器へ置き換えた。
voice音量は元の値を維持。旧WASMとのSine単音比較122条件で差0、和音の飽和対策も維持。
[今回の変更・最終検証・試用ZIP](spu_synth_precision_01.md) を参照。ユーザー報告により公開済み。
SDK原本・固定snapshot・WASMを更新したが、任意機能はstandalone Synthだけで有効化。
以下のvoice音量1/4方式は過去の記録であり、現在の実装ではない。

## 後続修正：2026-10-30 Sine和音の内部飽和（旧方式）

ユーザー報告のSineドミソの異音は、PMON Offでも起きるSPU内部の加算飽和と再現確認。
standaloneの物理voice音量を1/4にし、後段で4倍補償。単音の音量と保存presetの音量値を維持した。
[原因・測定・修正・試用ZIP](spu_synth_headroom_01.md) を参照。未commit・未公開。
Masterを下げるだけでは直らない。SDK／WASM／校正policyは変更していない。

## 後続UI：2026-10-29 Morphを2か所で操作

ユーザー指定で、PCM内のMorphつまみを残し、Pitch右隣にも縦型Morphを追加。
2つは双方向同期し、上側は全タブで操作できる。離しても値を保持する。
[作業記録・検証・試用ZIP](spu_synth_dual_morph_01.md) を参照。この後続UIは未公開。
下の公開済み報告は、この変更より前の版についての報告。

## 追加機能の範囲：2026-10-29

ユーザー判断でMorph用LFOと外部入力Reverbは現在不要。追加予定から除外した。
手動Morphまでで今回の機能追加は完了。過去の候補記載から実装を再開しない。

## 公開状況の更新：2026-10-29

ユーザーより、単一canvasのSoftware morph版を「releaseした」と報告。**公開済み**として扱う。
下記の「未公開」は各作業時点の履歴。公開待ちへ戻したり、追加の公開操作を自動で始めたりしない。
公開先・バージョン番号・公開物のhashは今回の報告では未指定。こちらで公開確認・追加公開は行っていない。

## 後続更新：2026-10-29 Software morph

PCMタブへA／B波形の手動Morphを追加。ソフト側の機能とUIに明記。
最終UIはA／B／Resultを1つのcanvasに重ね、同じcanvasでA／Bを切り替えて自由描画・数値編集する。
3枚プレビュー＋別エディターには戻さない。
[操作・検証・配布物](spu_synth_morph_01.md) を参照。ユーザー報告により公開済み。

## 後続更新：2026-10-29 PMON波形選択／Noise

PMONの4波形選択とPCMタブのSPU Noiseを追加。
[作業記録と試用ZIP](spu_synth_wave_noise_01.md)、[機能TODO](todo_spu_synth_features_01.md) を参照。未commit・未公開。

## 後続更新：2026-10-29 SPU Synth PMON

FXタブへPitch Modulationを追加し、12組のsource／carrier割当と保存・復元を実装した。
結果・試用ZIP・検証は [spu_synth_pmon_01.md](spu_synth_pmon_01.md) を参照。未commit・未公開。

## 後続更新：2026-10-29 ガウシアン補間

ユーザーの実装指示により、PS1 SPUの既定4点ガウシアン補間を実装し、SDK正規import・WASM・Tauriへ反映した。
現在の結果と検証・配布物は [ps1_gaussian_01.md](ps1_gaussian_01.md) を参照。
以下の「未実装」「実装指示は未受領」は、この後続作業前の履歴。公開済みSynth ZIPは上書きしていない。

## 現在の終了地点

- **Tetorica SPU Synthはユーザーがリリース済みと報告した。** Xでのboostも1,000円分実施済み。
  公開待ちへ戻さず、追加の公開・広告操作を自動で始めない。
- 本体HEADは `9750b5b7`（`spu synth 0.0.1`）。最新の4タブ版までcommit済み。
  この引き継ぎを書き始める直前の本体working treeはcleanだった。
- このスレッドの直近の必須実装に、把握している未完了作業はない。
  その後、ユーザー指摘で**ガウシアン補間の未対応**を確認した。次の具体的な候補として下記に追記。
  新しい実装は次スレッドのユーザー指示に従う。
- 今回追加した本書・リリースinventory・savePoint追記は未commit。こちらからcommit／pushはしない。

## SPU Synthの現在の仕様と入口

- 製品名：**Tetorica SPU Synth**。説明：**PlayStation 1 SPU synthesizer / emulator**。
- アプリ：[`docs/synth-spu/index.html`](../synth-spu/index.html)。
  トップページ [`docs/index.html`](../index.html) にアイコン付きカードあり。
- アプリ内アイコンは `docs/synth-spu/icon.png`。ユーザー提供1254px PNGを無変換で使用。
  トップページのカードはユーザー指定の `docs/tetorica_spu_synth.webp`。
  シルバー／濃い表示部／赤・黄・青の意匠に合わせた。
- 上段：**Envelope／Waveform／Spectrum＋縦Pitch**。
  Envelopeは実出力RMSの履歴表示。編集するADSR図を上段へ戻さない。
- 下段：**PCM／ADSR／FX／Audio** の4タブ。初期表示はPCM。
  PCMは112-sample周期波形、ADSRは数値とドラッグ図、FXはSPU reverb、Audioはファイル取込・root note・loop。
  音色名とpreset load/save/resetは共通操作。
- **全24声で1つの音色を共有し、Keyboardはround robin。** 空き声を巡回、満杯時だけ最古を置換。
  Voice studio・physical voice selector・Selected ADPCM voiceはユーザー指定で削除済み。
- Guitar／Bass／Ukulele、PCキー／pointer、和音、Sustain、±2半音Pitch、preset保存復元が動く。
  古い離鍵が置換後の音を止めない。Pitchは保持音とrelease tailsへ適用し、再発音しない。
- タブ切り替えは音を止めたり音色を再設定したりしない。左右キー／Home／Endでも操作できる。
- Audioはブラウザーでdecode→mono→準備WorkerでADPCM変換。短周期PCMと録音ファイルの双方を扱う。
  standaloneにマイク録音・長い音声のcrop editor・MIDI・Native出力を追加する依頼は未受領。
  共通Sample Editor等の既存Playground機能と混同しない。

主な実装：

- `docs/synth-spu/synth.js`：UI／Keyboard／ファイル操作。
- `spu_synth_panel.js`：既存Playground panelを共通音色・4タブへ接続するadapter。
- `spu_synth_audio.js`／`spu_synth_worklet.js`：既存SPU WASMとAudioWorklet、RPC。
- `spu_synth_voices.js`：audio owner側の24声割当。
- `spu_synth_visualizer.js`：Master後のpassive analyser、最大30fps、無音・非表示時停止、tail復帰。
- `spu_synth_instrument.js`／`spu_synth_prepare_worker.js`：preset検証と音声準備。

最新の詳しい記録は [spu_synth_tabs_01.md](spu_synth_tabs_01.md)。

## 最後に追加された未対応事項：SPUガウシアン補間

- ユーザーが「ガウシアン補間が入っていないのでは」と指摘。**現状は2点線形補間で、ガウシアン補間は未実装**と確認した。
- 対象はSDK原本 `vendor/mame-ps1-spu/spu.cpp` の各voiceの補間。
  Synth／Playground／Nativeは同じコアを使うため共通の課題。UIの未使用スイッチや係数表は存在しない。
- ホスト向け44.1kHz→デバイスrate変換は別のresamplerであり、各voiceの補間と区別する。
- 今回は確認とTODO記載のみ。実装開始・既定変更・再公開の指示はまだ受けていない。
  次の作業候補として [todo_ps1_gaussian_01.md](todo_ps1_gaussian_01.md) を読む。
  原本SDK→正規import→WASM／Tauriへの展開と、補間仕様・境界・回帰・音量測定の確認を記録している。

## 配布物と検証の扱い

配布スクリプトは **`scripts/package_itch_spu_synth.sh`**。
`script/patch_...` は作っていない。既存の `scripts/package_itch_*.sh` と同じ命名を使う。

```sh
sh scripts/package_itch_spu_synth.sh dev
# versionを指定する場合はdevの代わりに指定する
```

- root `index.html` で起動する45ファイルのZIPを生成。3entryをbundle＋minifyし、icon／WASM／source／licenseを同梱。
  npm別名は `npm run pack:spu-synth -- VERSION`。READMEの`v0.1.0`はコマンド例で、公開版番号の根拠ではない。
- ユーザーのローカル配布物は次の2つ。終了時点で**両方とも同じbyte列**だった。
  - `release/tetorica_spu_synth_dev_itch_v0.0.1.zip`
  - `release/tetorica_spu_synth_dev_itch_for_run_v0.0.1.zip`
- 各 **45files／5,459,208bytes**、SHA256
  `42695498009fe2179d36161a89ba9d8434598826093c17290d1ede54fd79f7f7`。
  ZIPのCRCは正常、root indexあり。内部の包装versionは`dev`、ファイル名とcommit subjectは`v0.0.1`。
  公開URLと、どちらのファイルを実際にuploadしたかは会話に記録されていない。
- 最終自動試験：Node **37成功**、実ZIPのChromium／WebKit両方成功。
  タブ切り替えでRPCゼロ・音色／所有権／PCM維持、ADSR drag、全既存演奏・保存・復元・Stop・recoverを確認。
  各37captures／385,024frames、pilot／clock連続、診断0。1440／390pxの表示も確認。
  物理出力はmute、AIによる実聴や実機精度の証明ではない。
- 上記の現存ZIPについて、過去の最終Browser reportに記録された**配信runtime 8ファイルが全byte一致**することを
  引き継ぎ時に照合した。新しいブラウザー試験や公開サイトの確認をした、という意味ではない。
  [今回のinventory](thread_handoff_20261029_release_inventory.json)。
- 古い`v0.1.0`／`editor-tabs-dev`等のファイル名や`/private/tmp`の展開先は履歴。
  現在存在するとは限らない。過去のJSON／hashを書き換えて現行版の試験結果に見せない。

必要な改修をした時の確認コマンド：

```sh
npm run test:spu-synth
node scripts/check_spu_synth_browser.cjs
```

実配布の確認はZIPを新規展開し、checkerの `--root DIR --entry /index.html` を使う。
サーバー8877や`/private/tmp`の過去の試験環境が稼働・残存していると仮定しない。
新しいraw reportは別名で保存する。

## 他のリポジトリと、以前からの持ち越し

| Repository | 終了時点のローカル状態 |
| --- | --- |
| 本体（このrepo） | `9750b5b7`、引き継ぎ記載前はclean |
| `w/tetorica-soundchip-native` | `544364743702671fac40eed4fe7ef44f4769c07f`、clean |
| `w/tetorica-fm2612-playground-tauri` | `6ac2f78d204c5055de0dc1f6576d05979e0397b2`、150 modified＋1 untracked |

Tauriの未commitは、このSPU Synth standaloneを作る前からのPS1・frontend・SDK取り込み等。
`dist/playground_ps1_envelope.js`もuntracked。不要ファイルと判断して消したり、まとめてrestoreしたりしない。
再開時は各repoの`git status --short`を再確認する。

### 実際に持ち越しているもの

1. **SDK 0.1.7候補の正式化と配布先の整理。** SDKのCHANGELOGは`unreleased`、ローカルtagは0.1.6まで。
   本体とTauriは同じ0.1.7 `localCandidate` をpin済みで、最新のPS1 live／保留ADSR修正は取り込み済み。
   455files、archive SHA256
   `0c09e92c3147a83fe3e694c2a48af169415b4e7e3c0b0cb3000ffb91c250f7b4`、9 changedPaths。
   正式SDK tag／配布、consumerのcommit／remote CI、新しいnpm版の公開反映は、別途ユーザーと進める作業。
   今回の「SPU Synthをreleaseした」は、SDK／npmも公開済みになった、という意味ではない。
   [ps1_deferred_release_01.md](ps1_deferred_release_01.md) とSDK pinを参照。
   ネットワークによる現在の公開状態の再確認は、この引き継ぎではしていない。
2. **Tauri GUI・物理音声での確認。** offline／Native自動試験は過去に完了。
   16台・64 MiBの重い混在構成や実機でのdropout・聴音評価は未確認。
3. **必要時の性能再監査。** OS再起動で消えたSafari／WebViewノイズの根本原因は断定していない。
   [aaa_daily01_report.md](aaa_daily01_report.md) のP1（HuC indexed copy／LiveFX finite validation）は実装済み。
   非OPNの内部PCM再利用などP2/P3は候補段階。再現・profilingを見てから選び、音の式を推測だけで変えない。
4. **汎用の低レベルJS Native adapter／パッケージ分離。** 将来の別作業。
   既存Playgroundの`createSoundChip()`が未完成という意味ではない。

### 未完了として再実装しないもの

- 初期22種類のNative追加生成、既存27 WASM targetのSDK移行は完了。
  [todo_createSoundChip01.md](todo_createSoundChip01.md) の古い未チェックだけで未実装と判断しない。
- CD-ROM²のHuC6280／MSM5205／CD-DA対応は完了。
  古いTODOの未公開記述は後続のSDK／npm公開記録で更新されている。
- SDK 0.1.6／npm `tetorica-fm2612` 0.2.33は過去の公開完了記録がある。0.1.7候補と区別する。
- SPCのWebKit初期化中close問題は後続で修正済み：
  [spc_webkit_close_01.md](spc_webkit_close_01.md)。
- CUE/BIN・物理CD・BIOS／CPUエミュレーション等は、今回の実装漏れではなく対象外だった。

## 作業方針を引き継ぐ

- standalone SynthとPlaygroundの共有panelを分ける。standalone用UI都合で共有音源の挙動を変えない。
- viewと音声生成の更新を分離し、表示のための常時RPC pollingや音声callback内のencode／UI処理を増やさない。
- SDK原本から正規export/importする。固定SDK snapshotを直接編集しない。
- 今回は引き継ぎ文書だけを追加。実装、配布ZIP、SDK、Tauri、広告の変更はしていない。
