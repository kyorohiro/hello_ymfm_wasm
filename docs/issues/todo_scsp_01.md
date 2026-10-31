# Sega Saturn SCSP対応 — 2026-10-30

2026-10-31：追加開発はいったん区切る。[再開用TODO](todo_scsp_resume_20261031.md)を入口にする。先にGitHub Actionsを確認・修正し、他機能のリリース準備へ進む。

目的：PS1 SPUと同様に、共通Native／WASMコアからPlayground・Synth・Nativeへ広げる。
READMEの「音源技術を読み解き、学び、再構成できる形で残す」目標に沿い、自作データと動く解説を併設する。

## 1. 独立コアと最初の発音（初期範囲完了）

- [x] MAMEのBSD-3-Clause SCSP／DSPを固定revisionで取得し、原本・hash・ライセンスを保存する。
- [x] 作業用SDK `w/tetorica-soundchip-native` でMAME frameworkから独立させる。
  固定配布snapshot `third_party/tetorica-soundchip-native` は直接改変せず、検証後に通常のSDK導入手順で更新する。
- [x] C ABIでinstance生成／破棄、reset、レジスター読み書き、512 KiB RAM、44.1 kHz stereo renderを提供する。
  offset・byte order・部分書き込み・RAM境界・未対応機能を明記。render中に確保やファイルI/Oをしない。
- [x] Native CMake target／fixtureと、Emscripten recipe／WASM smoke testを追加する。
- [x] 外部ファイル不要の自作Sineを発音。Native／WASM PCM一致、分割render一致、instance独立、入力不正を確認する。
  一致は移植の再現性の検証で、実機忠実度の保証ではない。
- [x] SDK catalog／source inventory／正規WASMビルドselectorへ登録する。
- [x] SCSP用の配布archive監査・CIを追加し、consumerへ固定snapshotとして導入する。
  隔離ZIPのNative／WASM再ビルド・PCM比較成功。CI設定は追加済み、remote CI／公開は未実施。
  [導入・検証記録](scsp_sdk_import_01.md)。

最初の区切りは「自作SineをNative／WASMで同じ結果として生成できること」。
音声デバイス・Playground UI・SSF再生はその後。MAME上流のDSP／EG精度の限界も引き継ぐ。

## 2. 共通音色API

- [x] `Scsp`低レベルwrapperを追加。実WASMでPCM・RAM・masked writes・reset／disposeを検証する。
  [APIと自作Sine例](../scsp.md)。音声device／resamplingは含めない。
- [x] `ScspSynth`高レベルAPI・型定義を追加。音名・ライブ音程／mix・次回keyOn用の音色編集を分離する。
- [x] PCM8／PCM16、基準音程、32物理slots、key操作、音量・pan、forward loop、AR／D1R／D2R／DL／RRを扱う。
  reverse／ping-pong loopはraw coreのみ。forward loop長を超えるpitch stepは移植コアの制約として拒否する。
- [x] 自作Sine／Triangle／打楽器で音程・forward loop境界・EG・32音加算・clipを実WASMで検証する。
- [x] host-rate resampling（44.1／48／96 kHz）を検証し、PlaygroundのAudioWorkletへ接続する。
- [x] RAM使用量・サンプル所有権・reset時の扱いを定義する。
  append-only bank、PCMコピー、補間guard、alignment、所有descriptorを採用。個別置換／解放は未提供。

## 3. Playground

- [x] `useSoundChip('scsp')`／追加instanceとSaturn Modeを追加。Main／Workerが同じAudioWorklet coreを使用する。
- [x] 初期コード・PCM16 stereo例を用意。Prepare audioだけで32 slotsをKeyboard／Holdで試奏できる。
- [x] 32-slotの設定／RAM Inspector、Hold／Release／Keyboardを接続する。表示gateは発音要求であり、実EG活動meterではない。
- [x] PCM／EG編集とCopy voice JavaScriptを接続する。
  単一canvasの描画、自作4波形、共有PCM選択、PCM8/16・root/source rate・forward loop、
  次回keyOn用EG、live mix、適用済みPCMを含むJS出力。描画中はRAMを書かず、Apply時に安全な編集pageを再利用する。
- [x] SCSPの音量校正。primary／extraの48経路とFM基準8経路を測定し、生成gainを同じ全経路で再検証する。
  System Mixer／npm opt-in policyは両経路0.128826（PCM対応後の再測定）。旧153件の基準・保存値・raw出力は維持する。
- [x] PCMファイル入力と、編集用sampleのboundedな再利用を追加する。
  64 MiBまでのWAV／browser codec、区間・rate・root指定、mono化、最大65,535点。
  共有／held／releaseの保護、予約中Apply拒否、Main／Worker音色delta同期、idle page再利用、bank clear時の解放を検証。
- [x] Native音声経路（段階4）のprimary／extra・画面へ接続する。
- [ ] 編集poolの個別page返却／compactionは後続。通常loadPCMは引き続きappend-only。
- [x] Stop・予約／owner取消・manual lease・bank／instance所有権・追加instance・再起動をNode／実ブラウザで確認する。
- [x] Main／Worker × Chromium／WebKitで、編集後のPC Keyboard、blur release、Mixer UI mute／volume、
  FX gain、Master、AudioContext suspend→Run復帰、Stopを検証する。
- [ ] processorerror／device interruption等の障害注入によるruntime再生成は追加検証の対象。

## 4. Native音声経路

- [x] Tauriへ同じ固定SDKを正規importし、callback所有のRust `Core`とC ABI・固定44.1kHz→host resamplingを実装する。
  [土台の実装・検証](native_scsp_core_01.md)。実Browser WASMとの96 cases／5,589,524 stereo frames完全一致。
  この層だけではNative modeを公開しない。SDK更新を含むTauri側は別Git管理。
- [x] Tauriのprimary／extra SCSP、C ABI呼び出し、Native callbackとresamplingへ接続する。
- [x] 時刻付き命令、適用確認、RAM upload、手動試奏の所有権、Stop・取消・session再生成を実装する。
  [実装・検証・制約](native_scsp_transport_01.md)。Main／Worker・Inspector／Keyboard／PCM編集を接続。
- [x] 同じ入力のWeb／Native core比較、callbackの分割render・時刻付き命令・所有者取消をoffline検証する。
- [ ] 実audio deviceでの試聴、長時間運転・callback負荷／deadline、device interruptionからの復旧を確認する。

## 5. SCSP固有機能とSynth

DSP・UI整理は[作業TODO](scsp_dsp_01.md)、FM Depth／接続図／自由配線／Feedback／予約削減は[後続TODO](scsp_fm_followup_01.md)。

- [x] ハードウェアLFOのcore／JavaScript／型／Main・Worker・Native／Playground・Synth接続。
  [実装・検証・配布](scsp_lfo_01.md)。
- [ ] slot間変調／sound stackを段階的に公開・検証する。[作業TODO・初期段階完了](scsp_fm_01.md)。
  guarded PCM・live API／型／Main・Worker・Native・Playground UI／2-slot例は完了。専用Synthの2-op FMペア割当・operator込みpresetも[完了](scsp_synth_fm_01.md)。4／6-opと固定接続は[専用Synth後続](scsp_synth_multiop_01.md)。任意graph／feedbackは後続。
- [ ] DSPプログラム・係数・routingを段階的に公開・検証する。
  共通コアへの移植時に既存処理を可能な限り保持し、未検証機能を対応済みとは表示しない。
- [x] 専用Browser Synth：鍵盤、PCM読み込み／単一canvas編集、EG、loop、pan、preset保存・再読込。
  実装順と受入条件は [専用Synth TODO](scsp_synth_01.md)。まずBrowser版の基本PCM Synthを作る。
- [x] FMで複数slotsを使う音色を、単純な32音polyphonyと区別して管理する。
  専用Synthはsource 6 slots＋PCM26／2-op13／4-op6／6-op4 voices。離鍵／steal／Stop・presetをgroup単位で管理。
- [ ] 「PCM loop」「EG」「波形RAMを使うFM」の短い説明・操作UI・動くJS・音を組にする。
- [ ] 校正・Native／WASM配布・ソース／license同梱・展開ZIP検証を行う。

## 6. ゲーム由来データ（後続）

- [ ] 任意のVGMを初期実装の必須入力にしない。SCSPのVGM命令／RAM blockは、コア完成後にAnalyzer対応を検討する。
- [ ] SSF／MiniSSF／SSFLibのbounded展開・依存解決を検討。PSF共通container処理と機種別RAM imageを分離する。
- [ ] Sega系音色形式を調査し、明示的な根拠のあるサンプル・基準音程・EGを取り込む。
  静的候補を正しい元音色の復元と混同せず、非対応・曖昧な対応付けを診断する。
- [ ] SSF曲再生は別段階：68000、timer／IRQ、同期実行が必要。SCSP単体対応と分ける。

## 調査資料

- [MAME SCSP](https://github.com/mamedev/mame/blob/master/src/devices/sound/scsp.cpp)、[headerと精度注記](https://github.com/mamedev/mame/blob/master/src/devices/sound/scsp.h)、[DSP](https://github.com/mamedev/mame/blob/master/src/devices/sound/scspdsp.cpp)
- [PSF／SSF仕様](https://gist.github.com/SaxxonPike/11618bd321a45a70c01febae43ff564e)
- [VGMPlayのSCSP命令処理](https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/VGMPlay.c#L5333)
- [VGMTrans対応形式](https://github.com/vgmtrans/vgmtrans#supported-formats)
- 既存構成：[PS1 SPU](../ps1_spu.md)、[固定SDKビルド](../building_ym2612_wasm.md)

## 作業記録

2026-10-30：ユーザー了承でTODO化。段階1の初期コアを実装し、Native／WASMの自作Sine 8,192 stereo framesがbit一致。
Native CTest・ASan／UBSan、SDK出典検証、既存配布unit 101件＋SCSP catalog 4件成功。
[実装・再開手順](scsp_core_01.md)／[入力hash・測定JSON](scsp_core_01.json)。
次はSCSPの配布検証・固定SDK導入、その後共通JS APIとPlaygroundへ進む。
実装は別Git管理の`w/tetorica-soundchip-native`内。親repoのcommitだけでは保存されない。
公開・commit・consumer SDK pin更新はまだ行っていない。

2026-10-30後続：固定SDK導入とraw JS APIまで完了。全33 builds／65 outputsの検証成功、
既存63生成ファイルはbyte一致、29コアのPCM／API比較40,474件一致。
Node 135＋consumer Python 143＋SDK release unit 107 tests成功。[詳細](scsp_sdk_import_01.md)。
次は共通Synth API（PCM読み込み・基準音程・EG・32 slots・RAM管理）からPlaygroundへ。
公開・commitは実施していない。今回のSDK pinは未公開local candidateとして明示済み。

2026-10-30後続：`ScspSynth`とraw／Synthの型定義を追加。実WASMのraw 5＋Synth 9＝14 tests、
strict TypeScriptの正常例／不正利用診断が成功。[API・制約・実行例](../scsp.md)。
発音／離鍵・32 slots・PCM8/16・RAM満杯／bank所有権・停止／reset・波形／EG／live pitchを確認。
Native SDK／固定snapshot／生成WASMに変更なし。次はhost resamplingとPlayground接続。
Playground／Synth UI／Tauri Native／SSFはまだ未対応。公開・commitは今回実施していない。

2026-10-30後続：PlaygroundのSaturn SCSP Mode／Main・Worker AudioWorklet／32-slot表示・Hold・Keyboard、
PCM16 upload例、独立instance、Stopを接続。[今回の作業・検証](scsp_playground_01.md)。
関連253＋Mixer生成37＋ZIP準備10＝300 Node tests、strict型検証成功。
実Run ZIPのChromium／WebKit × Main／Worker全4経路成功。物理出力は全てミュート。
既存PS1／WonderSwan／POKEYは新規reportで再測定し、source freshnessと配布生成を確認。
Run ZIPは964 entries。SDK／生成WASMは変更なし。未commit／未公開。
次はPCM／EG編集・Copy voice JS。Native音声／専用Synth／SSFは後続。

2026-10-30後続：SCSPのPCM／EG編集UI・Copy voice JSを追加。
[操作・制約・検証](scsp_editor_01.md)。関連Node 93 tests・Playground型・npm package build成功。
Chromium／WebKit × Main／Workerで描画・PCM8 Apply・EG・コピーコード再実行・Stopを確認。
旧校正reportは変更せず、正確なUI／SCSP cache URL差分を別監査で固定した。
SDK／WASM／音声renderの変更なし。未commit／未公開、既存release ZIPは未再生成。

2026-10-30後続：SCSPの実測音量校正と操作安定性を確認。
[測定・再実行・制約](scsp_calibration_01.md)。48 SCSP＋8 FM基準の校正と適用後再測定が成功。
関連Node 99 tests、全Playground mode型、実ブラウザ4経路のfocus／復旧／Mixer／FX確認成功。
SDK／C++／WASM／raw rendererは変更なし。未commit／未公開。既存release ZIPは未再生成。

2026-10-30後続：PCMファイル入力・安全な編集RAM pool・編集slotのMain／Worker同期を追加。
[操作・制約・検証](scsp_pcm_files_01.md)／[測定・配布hash](scsp_pcm_files_01.json)。
関連Node 106 tests・全mode型・実npm installed consumer検査成功。
PS1／WonderSwan／POKEY／SCSPを新reportで再測定し、SCSP生成policyも全経路で再検証。
実Run ZIPのChromium／WebKit × Main／Workerで20 MiB超WAV・M4A・RAM再利用・既存操作成功。
965 entriesの専用dev ZIPを作成。旧releaseは保持。commit／publishは未実施。
次はNative音声経路。一般free／compaction、専用Synth／SSFは後続。
