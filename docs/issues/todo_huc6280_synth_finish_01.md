# HuC6280 Synth: finish the current product before expanding to another Synth

開始: 2026-11-13。ユーザーの方針は、S-DSPへの横展開より先にPC Engineの
HuC6280 Synthを仕上げること。FM2612／SPU／DMGと同じく、音を鳴らすだけでなく
「元の演奏を見る → 選択CHを試す → 編集・保存 → Codeで利用する」までを揃える。

## 現状

- [x] Wave／Noise／固定CH2→CH1のHardware LFO／ソフト供給DDA PCM。
- [x] 波形描画、Software Envelope、Pitch、音声入力、プリセット保存・読込。
- [x] VGM／VGZからWave／Noise／LFOペア／対応PCMの音色抽出。
- [x] 同一チップのKeyboard／Code、Files／Cassette、補完・実装表示・Software FX。
      [実装記録](todo_huc6280_synth_code_01.md)と
      [検証記録](verification_huc6280_synth_code_20261113.json)。
- [x] Tauri版の既存リポジトリは作成済み。
      `w/tetorica-huc6280-synth-tauri`はWeb 0.0.8を取り込み済み。
      今回のCode版を取り込んだ状態ではない。

## 残作業の順番

- [x] **VGMの模範演奏**: Filesの`vgm/`に元のVGM／VGZを保持し、曲一覧、
      Play／Pause／Resume／Stopを、既存モニターの上へ追加する。
      既存の音色抽出と区別し、読込だけで音やCodeを開始しない。
      VGM AnalyzerのHuC6280再生基盤とDMG／FM2612の操作を調べて再利用する。
      最初は単一HuC6280の対応範囲を明示し、別チップの音を黙って省略しない。
- [x] **同じUIでCHを見る**: 通常／Code／VGMで共通の
      `Synth · edit and play / CH1–CH6`選択を用意し、表示・設定・鍵盤の対象を揃える。
      CH表示は既存のWave／Noise／LFO／DDA操作を使い、自動更新をOn／Offできる。
      表示対象の変更だけで別CHの設定を統一しない。
- [x] **Pause中の試奏と取り込み**: 選択CHの音で鍵盤を試奏し、編集用Synthや
      Filesのプリセットへ取り込める。元曲のPause位置とResumeを保つ。
      Noise、LFOペア、DDAで再現できる設定・できない状態を区別する。
- [x] **CH別On／Off**: VGMのCH1–CH6を出力だけ切り替える。既存PCMと内部状態を保ち、
      Pause／Resume・Stop／Play・曲切替でも選択を保持。共有LFOを止めない。
      [実装TODO](todo_huc6280_synth_channel_mixer_01.md)。
- [x] **Seek**: 気になる位置へ戻り、再生／Pause・CH別On／Off・表示CHを保持する。
      Auto update Offでも目的位置を一度表示する。取消・失敗時は元の位置を保つ。
      [実装TODO](todo_huc6280_synth_seek_01.md)。
- [x] **再構築キャッシュ**: native／parser／未消費PCM／Liveの正確な状態を保持し、
      近い保存点から再開する。初期On、最大64点／8MiB、Off／消去に対応。
      実WASMのNode計測で2分先の初回約3.9–5.3秒、同じ位置への再移動約0.8–1.5ms。
      [実装TODO](todo_huc6280_synth_seek_cache_01.md)。
- [x] **自動演奏＋手動操作**: VGMまたはCodeを動かしたまま同じCHを編集・発音できる。
      VGMとCodeの同時実行は行わず、手動操作だけがそれぞれに加わる。
      後の自動writeを優先し、古い離鍵・Pitch解除が新しい発音を消さない。
      Codeとの共存は[実装TODO](todo_huc6280_synth_code_manual_01.md)で対応。
      VGM再生中の操作も[実装TODO](todo_huc6280_synth_vgm_manual_01.md)で対応済み。
- [x] **UI整理と配布確認**: Menu／Files／音色抽出／曲選択の入口、狭い画面、
      キーボードFocus、説明の折りたたみを確認する。読めるソースの独立ZIPで
      実WASM／Worklet、Chromium／WebKitを無音検証し、README・CIを揃える。
- [x] **CD-ROM²の入口**: HuC6280／MSM5205／CD-DA／MixerタブとCode用音源を追加し、
      HuC6280＋MSM5205のVGMを再生する。専用編集UIは工事中と明示する。
      [詳細TODO](todo_huc6280_synth_cdrom2_01.md)。配布ZIP・Chromium／WebKitの検証を完了。
- [ ] Web版のまとまりを確認後、Tauriへ固定ZIPを取り込み、既存のMenu／Pin／
      保存・出力経路を確認する。公開・tag・pushは別のユーザー指示で行う。

各段階で、このTODOと検証記録を更新する。VGM再生の具体的なチップ所有・
観測・時刻管理は実装前に詰め、仕様が異なるDMGのコードをそのまま複製しない。
共有WASM／音量補正を変更する必要がある場合は、その理由と影響を記録する。

## 今回の完成条件に含めない拡張候補

CD-ROM² ADPCM／CD-DAは、2026-11-14にタブ・Code API・VGM再生までを上記の工程へ追加した。
専用の音作りUI、実CD-ROM読込、可変間隔DDAの音色抽出、圧縮bankの音色抽出、
Software morphは引き続き別の機能追加として扱う。既存のSoftware FXはCodeで利用可能。

物理出力を鳴らさずに検証する。実聴・長時間試奏・実ゲーム比較は未実行なら
未実行と記録し、AIの配列計測で聴感確認を代替したとは書かない。

## 模範演奏の実装記録（2026-11-13）

最初の工程を実装・無音検証済み。[詳細TODO](todo_huc6280_synth_vgm_playback_01.md)、
[検証記録](verification_huc6280_synth_vgm_playback_20261113.json)。
次は同じUIでのCH Live表示。Pause中の鍵盤は現時点では編集中の音色を鳴らし、
選択CHの試奏／Capture・CH別On／Off・Seek・VGMへの直接操作は未実装。
Tauriへの固定ZIP取り込みと公開も未実行。

## 共通CH選択・VGM Live表示（2026-11-13）

実装・無音検証済み。[詳細TODO](todo_huc6280_synth_live_channels_01.md)、
[検証記録](verification_huc6280_synth_live_channels_20261113.json)。
通常CHは個別編集・鍵盤・Stop後の保持に対応。VGM CHは読み取り専用で、聞こえた位置を表示する。
次はPause中の選択CH試奏とCapture。現状ではPause中の鍵盤はSynth選択時の編集用音色のみ。

## Pause中のCH試奏・Captureと配置整理（2026-11-14）

[詳細TODO](todo_huc6280_synth_paused_capture_01.md)。既知Wave／Noise／CH1 LFOペアを
同じMasterへつないだ専用voiceで試奏し、Capture後も曲のPause位置を保つ。
取り込んだ音はSynthで編集し、Filesへ保存する。VGMのDDA値からPCMは推測しない。
Import VGMはMenuへ、Sounds from VGMとChannel／Auto updateはモニター上へ移動。
Wave／PCMの音量違いをまとめる機能を維持。CH別On／Off、Seek、VGMへの直接操作、
最終的なTauri反映は残作業。検証記録は今回の詳細TODOから参照する。

## CH別On／Off・共通操作のコンテナ整理（2026-11-14）

[詳細TODO](todo_huc6280_synth_channel_mixer_01.md)。VGM出力の6CH On／Offを追加し、
記録レジスタ・発振器・Noise・DDA・LFO・Live／Captureは維持する。
通常Synth／Code／Pause試奏とは独立。既存PCMを保ち、新しい出力設定はその先から反映する。
Channel／Auto update／CaptureはVGM・Play／Stopと同じコンテナにまとめ、
Sounds from VGMより上へ移した。音量違いをまとめる機能は維持。
次はSeekと再構築キャッシュ。VGMへの直接操作・最終Tauri反映は後続。

## Seek・再構築の計測（2026-11-14）

[詳細TODO](todo_huc6280_synth_seek_01.md)。ドラッグ確定時に別の音源を無音で目的位置まで
再構築し、成功した時だけ参照演奏を置き換える。再生／Pause、CH別On／Off、表示対象CH、
編集用音色を保ち、Auto update Offでも目的位置の全CHを一度反映する。
元のrunと未消費PCMは成功まで保持し、取消・失敗では元の位置へ戻す。
Escape／Cancel、連続Seek、Stop／Code Run／曲・project切替で古い処理を破棄する。
長い移動は数秒かかる。cacheは実測と正確な状態保存方式の検討を別の残作業にした。

## 正確なSeekキャッシュ（2026-11-14）

[詳細TODO](todo_huc6280_synth_seek_cache_01.md)。HuC6280の正式な512-byte状態形式と、
parser／stream／未消費PCM／Live観測を一緒に保存する方式を追加。
Cacheは初期On、約5秒おきと指定位置で収集し、最大64点／8MiBのpayloadに制限する。
Stop／Code Runでは保持し、曲・project・CH別出力の変更で破棄する。
Off／消去は位置・編集用音色・Pause試奏を変えず、非対応backendは先頭からの再構築へ戻る。
実WASMの音声一致と取消・所有権の検証を行い、SDKもHuC変更に絞った未公開候補として取り込む。
[検証記録](verification_huc6280_synth_seek_cache_20261114.json)。Node417件、
Chromium／WebKitの8スイート・16実行・170項目が成功した。
次はVGM／Codeを止めずに手動で同じCHへ操作する工程。Tauriへの取り込み・公開は別工程。

## Code表示中の手動演奏と発音の後始末（2026-11-14）

[詳細TODO](todo_huc6280_synth_code_manual_01.md)。既存のCode継続・CH編集経路を確認し、
Code表示中も編集欄の外では鍵盤で演奏できるようにした。文字入力・select・dialogは保護する。
遅延したPitch操作は元のengine／session／epochだけへ送り、再Runや別出力へ渡さない。
Octave／CH変更／blurでは手動Release tailも解放し、Code所有の発音は保つ。
DDA供給が終わっても混在するWave／NoiseのSoftware Envelopeは同じ16-frame刻みで進める。
[検証記録](verification_huc6280_synth_code_manual_20261114.json)。Node413件、
同じ独立ZIPのChromium／WebKit全9スイート・18実行・182項目が成功した。
共有WASM・SDK・npm APIは変更しない。次はVGM側のLive編集・鍵盤入力と、Seek／cacheの関係を詰める。

## VGM再生と同じCHへの手動操作（2026-11-14）

[詳細TODO](todo_huc6280_synth_vgm_manual_01.md)、
[検証記録](verification_huc6280_synth_vgm_manual_20261114.json)。
再生中の曲CHを同じnative coreで編集・発音し、後のVGM命令と古い離鍵／Pitchを項目別に扱う。
聞こえた時刻の表示・先読みPCM・Pause試奏／Captureを保ち、Seekはcleanな原曲状態へ戻す。
Synth側は自分の音色・Software Envelope・DDAをVGMと同時に使える。
Node437件と独立ZIPのChromium／WebKit全10スイート・20実行・194項目が成功した。
この時点のWeb側の完成条件は一通り無音検証済み。Tauri取り込み・人の実聴／実ゲーム比較・公開は未実行。

## CD-ROM²の入口を追加（2026-11-14）

[詳細TODO](todo_huc6280_synth_cdrom2_01.md)。HuC6280／MSM5205／CD-DA／Mixerの
タブを用意し、既存の音作りはHuC6280に保持する。MSM5205／CD-DAは専用編集UIを
工事中と表示し、先にCodeの既存APIで利用する。Mixerは共有補正の絶対値で
HuC6280 44%、MSM5205／CD-DA 100%を初期値にする。
VGM 1.72のHuC6280＋MSM5205／MSM5205単独を扱い、CD-DAは別トラックと明示する。
MSM5205を含む場合は両音源を一緒に保存する形式がないため、Seekは先頭から再構築する。
既存の単一HuC6280の正確なcacheを保つ。実装統合後のNode494件が成功した。
[検証記録](verification_huc6280_synth_cdrom2_20261114.json)。Node501件＋保護検証6件、実配布ZIPで11 suite／22 run／208項目が成功。Tauri・公開・人の実聴は未実行。
