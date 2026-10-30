# Sega Saturn SCSP対応 — 2026-10-30

目的：PS1 SPUと同様に、共通Native／WASMコアからPlayground・Synth・Nativeへ広げる。
READMEの「音源技術を読み解き、学び、再構成できる形で残す」目標に沿い、自作データと動く解説を併設する。

## 1. 独立コアと最初の発音（着手）

- [x] MAMEのBSD-3-Clause SCSP／DSPを固定revisionで取得し、原本・hash・ライセンスを保存する。
- [x] 作業用SDK `w/tetorica-soundchip-native` でMAME frameworkから独立させる。
  固定配布snapshot `third_party/tetorica-soundchip-native` は直接改変せず、検証後に通常のSDK導入手順で更新する。
- [x] C ABIでinstance生成／破棄、reset、レジスター読み書き、512 KiB RAM、44.1 kHz stereo renderを提供する。
  offset・byte order・部分書き込み・RAM境界・未対応機能を明記。render中に確保やファイルI/Oをしない。
- [x] Native CMake target／fixtureと、Emscripten recipe／WASM smoke testを追加する。
- [x] 外部ファイル不要の自作Sineを発音。Native／WASM PCM一致、分割render一致、instance独立、入力不正を確認する。
  一致は移植の再現性の検証で、実機忠実度の保証ではない。
- [x] SDK catalog／source inventory／正規WASMビルドselectorへ登録する。
- [ ] SCSP用の配布archive監査・CIを追加し、consumerへ固定snapshotとして導入する。
  既存のWASM配布監査はSCSPをまだ許可しない。検証を追加してから対応範囲を広げる。

最初の区切りは「自作SineをNative／WASMで同じ結果として生成できること」。
音声デバイス・Playground UI・SSF再生はその後。MAME上流のDSP／EG精度の限界も引き継ぐ。

## 2. 共通音色API

- [ ] `Scsp`低レベルwrapperと`ScspSynth`相当の高レベルAPI・型定義を作る。
- [ ] PCM8／PCM16、基準音程、32物理slots、key操作、音量・pan、loop、AR／D1R／D2R／DL／RRを扱う。
- [ ] 自作Sine／Triangle／打楽器で音程・loop境界・EG・32音加算・clip・resamplingを検証する。
- [ ] RAM使用量・サンプル所有権・置換／reset時の扱いを定義する。

## 3. Playground

- [ ] `useSoundChip('scsp')`とModeを追加。Main／Workerが同じAudioWorklet coreを使用する。
- [ ] 初期コードと例を用意し、Prepare audioだけでもKeyboard演奏できるようにする。
- [ ] 32-slot Inspector、適用済み状態、Hold／Release／Keyboard、PCM／EG編集、Copy voice JavaScriptを接続する。
- [ ] Stop・予約取消・dispose・再起動・focus・複数instance・mixer／FXを検証する。

## 4. Native音声経路

- [ ] Tauriのprimary／extra SCSP、C ABI呼び出し、Native callbackとresamplingへ接続する。
- [ ] 時刻付き命令、適用確認、RAM upload、手動試奏の所有権、Stop・取消・復旧を実装する。
- [ ] 同じ入力のWeb／Native比較とcallback負荷・長時間動作を検証する。

## 5. SCSP固有機能とSynth

- [ ] ハードウェアLFO、slot間変調／ring buffer、DSPプログラム・係数・routingを段階的に公開・検証する。
  共通コアへの移植時に既存処理を可能な限り保持し、未検証機能を対応済みとは表示しない。
- [ ] 専用Synth：鍵盤、PCM読み込み／波形編集、EG、loop、pan、preset保存・再読込。
- [ ] FMで複数slotsを使う音色を、単純な32音polyphonyと区別して管理する。
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
