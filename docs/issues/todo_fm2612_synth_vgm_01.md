# FM2612 Synth：importしたVGMの保存（2026-11-09）

## 完了: Synth／CH選択とPause中の鍵盤試奏

ユーザー指示：Synth／CH1〜CH6を選択し、Pause中は選んだCHの停止位置の音色を鍵盤で弾けるようにする。

- [x] 選択欄をSynth／CH1〜CH6とし、Synthでは元の編集音色、CHではそのCHの表示と試奏対象を一致させる。
- [x] Liveは自動追従のOn／Offとする。Offでは最後の観測状態を保持し、Pause中のCH変更は同じ停止位置から取得する。
- [x] Pause中の試奏は独立した鍵盤音源を使い、曲のengine／再開位置と編集音色／Filesを変えない。対象変更・Resume／Stopで試奏音を止める。
- [x] CH3特殊周波数・partial key mask・CH6 DACを適切に扱い、試奏できない場合は理由を表示する。
- [x] 実WASMとChromium／WebKitで選択、Pause試奏、Live Off、Resume、音色／保存不変、通常Synthの鍵盤を検証する。
- [x] 配布ZIPの必要assetと実動作を確認し、README／検証記録を更新する。公開・commit／pushはしない。

### Pause試奏の実装と検証

- Synthを選ぶと元の編集音色を表示・演奏する。CH選択中の演奏操作はPause中だけ有効。Stop／曲末尾では元のSynth鍵盤へ戻り、状態文にも表示する。既定はCH1／Live Onを維持する。
- Live Offは全CHの観測状態を同じ時点で固定する。Pauseするとその停止位置の全CHを取得し直し、CHを切り替えて試奏できる。Synthを選んでも元音色を観測値で上書きしない。
- 試奏用の3つ目のMegaDriveSynthを必要時だけ初期化し、独立したbusからfinalOutputBusへ接続する。曲用engine・元の鍵盤用chip・Looper／Event録音の音源を変更しない。Masterを1回適用し、対象変更・Resume／Stopでbusをmuteしてrelease tailも止める。初期化中の対象変更は世代番号で無効化し、Pagehideでcloseする。
- `synth_song_voice.js`が停止位置のpresetを選択した実CHへ適用し、そのCHを単音で鳴らす。ADSRは鍵盤で新しく発音する。離鍵後も最後の非zero KON maskを使い、部分OPの発音を保つ。CH3 specialはOP4を鍵盤の基準とし、全OPの周波数比を保って移調・Pitch bendする。
- CH6がDAC／PCMの場合、CH3がCSM timer発音の場合、CH3 specialでOP4の基準周波数がない場合は、試奏不可の理由を表示する。通常のFM presetと誤認させない。
- `node --test docs/synth/*.test.mjs`：104件成功。新規の試奏helper検証と、音声resume待ちの間にモード変更した際の遅延Note On防止を含む。実WASMでも離鍵済みCH6のpartial maskで発音・離鍵を確認した。
- sourceのLive checkerはChromium／WebKitで成功。選択CH4のMULTI 2による実PCM周波数、KONの実CH／mask、CH3の4周波数、Pause位置の不変、Live固定、Synth復帰、VFS hashの不変を確認。記録：`/private/tmp/fm2612-paused-live-browser.json`。
- `sh scripts/package_itch_synth.sh vgm-audition-check-20261109`：成功。245個のlocal module／asset参照を確認。新しいhelperとstate helperは可読sourceとbyte一致し、ZIP全entryもstageと一致する。
- 配布stage内のLive checkerはChromium／WebKitで成功。試奏のMaster 0／100／200／380%は実測で0／1／2／3.8倍となり、二重適用なし。記録：`/private/tmp/fm2612-paused-live-package.json`（84 assetのhashが最終stageと一致）。
- 既存の演奏checkerは編集モードの検証にSynthを選択するよう更新。FM／PSG／DAC・RF／PWM・混在、Cave／Virtua Fighter実曲を含む全10ケースが配布stageの両browserで成功。記録：`/private/tmp/fm2612-paused-playback-package.json`（88 assetのhashが最終stageと一致）。音声の物理出力はmuteした計測で、実聴ではない。
- 1240／390pxの画面を確認した。最終ZIP：`release/hello_ymfm_wasm_vgm-audition-check-20261109_itch_synth.zip`（237 entries、806,060 bytes、SHA-256 `5b14c59c36e9c9a533003658a8dde41bad7a60d8449e6273d2fed92e01b30160`）。receipt：`/private/tmp/fm2612-paused-package.json`。
- README英語／日本語と変更moduleのcache keyを更新。未公開・未commit・未push。

ユーザー指示：importしたVGMをFilesの`vgm/`フォルダー配下へ置く。

- [x] VGM／VGZの元バイトを`/vgm/<filename>`へ保存する。VGZは圧縮された元データを保持する。
- [x] 抽出音色は従来の保存先へ置き、同名import・不正データ・キャンセルで既存ファイルを失わない。
- [x] 有効なVGMで抽出音色が0件でも元データを保持し、Filesと保存結果に反映する。
- [x] IndexedDB復元、Cassette export／importで元バイトを維持することを確認する。
- [x] 既存import／projectの検証と、実browserのFiles表示・再読み込みを確認する。

元データの保存は完了。続くユーザー指示で、下記の模範演奏プレイヤーを追加する。
TFI／VGI・S98の既存読み込みを維持する。元VGMを持たない過去のCassetteは、再importすると元ファイルを追加できる。
公開packageの更新・itch／Tauriの再配布はこの作業では行わない。

## 実装と検証

- 元ファイルと抽出音色は1回のfilesystem commitで追加する。`paths`は音色だけを返し、新しい`sourcePaths`が元VGM／VGZの保存先を返す。
- `/vgm/song.vgm`、`song-2.vgm`のように同名を回避する。`/vgm`が既存ファイルなら、上書きせずそのimportを失敗として扱う。
- VGMの判定は解析結果を使い、拡張子がTFIになっているVGMも`.vgm`へ正規化する。S98は従来の音色抽出のみ。
- 元データだけ追加する場合もUndo・Files表示・IndexedDB保存に反映し、現在の音色を切り替えない。
- `node --test docs/synth/*.test.mjs`：82件成功。新規8件で圧縮headerまで含む元バイト、重複名、音色0件、不正入力、キャンセル、保存先衝突、folder drop、S98の既存挙動を検証。
- Chromium／WebKitの実UIでVGM＋VGZ import、重複名、PSGのみのVGM、不正ファイル、元VGMの選択、IndexedDBからのreload復元、ダウンロードしたCassetteの別contextへの再importが成功。元バイトは全往復で一致。音声は初期化・再生していない。
- ローカルbrowser検証記録：`/private/tmp/fm2612-vgm-storage-browser.json`。Filesのスクリーンショットも確認した。
- ブラウザの古いmodule cacheと混在しないよう、変更したimport経路のcache keyを更新した。

旧Cassetteとの互換性を保ち、既存の容量制限は変更していない。今回の変更は未commit・未push。

## 追加: Preset形式のVGM選択と模範演奏

ユーザー指示：`vgm/`にファイルがある場合はPreset風UIで曲を選び、再生できるようにする。配置はFormat infoの位置。

- [x] Format infoの位置にVGM選択・Play／Pause／Resume・Stop・状態表示を置く。元ファイルがない場合は既存のFormat infoを表示する。Volは右側へ維持する。
- [x] `/vgm/`配下のVGM／VGZ一覧をFilesと同期し、追加・削除・移動・Cassette切り替え・Undoへ追従する。選択だけでは再生しない。
- [x] 曲用の独立音源で元の演奏を再生し、音色editor・鍵盤・Looperの音源状態を維持する。Master・デスクトップ音声出力へ接続する。
- [x] Pause／Resume、Stop／再生し直し、初期化中のStop、曲変更、終了・エラー時のcleanupを実装する。
- [x] 対応外VGMは誤った部分再生を避け、曲名と理由を表示する。VGZは再生時に復号し、保存元バイトを変えない。
- [x] 既存機能と実WASM出力をNode／Chromium／WebKitで検証し、狭い画面・Files表示時の配置も確認する。
- [x] itch向け配布に必要な新しい可読モジュール・WASM・source／licenseを含め、package内でも再生を確認する。

公開packageの更新・itchへのupload・Tauri repoの再配布・commit／pushは実行しない。

### 模範演奏の実装結果

- `synth_song_controls.js`がFilesのmetadataから一覧を作る。元ファイルが変更された時だけバイトをコピーし、ノブ操作では再コピーしない。選択欄操作後はfocusを外し、鍵盤入力へ戻れる。
- `synth_song_preview.js`が独立したGenesisAudioEngine／VgmPlayerを所有する。元VGMのYM2612／PSGクロックを使用し、native-rate AudioBufferを既存AudioContext／finalOutputBusへつなぐ。Masterは専用GainNodeで1回だけ適用し、Looper録音の経路へ入れない。
- 現在の再生範囲はYM2612＋Sega PSG＋DAC＋RF5C164（Mega CD PCM）＋PWM（32X）。その他のchip、dual／variant chip、未対応command（Game Gear stereoを含む）は理由を表示する。再生は曲末尾で終了し、Loop／Seek UIは追加していない。
- Pauseは現在のbuffer内位置と未消費PCMを保持する。Resumeは同じengineから継続し、Stopは予約済みsourceとengineを解放する。元ファイル削除・変更、Cassette交換、Undo、ページ移動とdesktop出力切り替えでも停止する。
- 約200msだけ先読みし25ms間隔で補充する。backgroundのtimer制限で補充が遅れると無音区間が出る可能性はあり、未再生の演奏データを飛ばして帳尻を合わせる実装にはしていない。
- 継続的な進行表示で同じstatus文言をaria-liveへ繰り返し書き込まない。

### 最終検証

- `node --test docs/synth/*.test.mjs`：89件成功。7件の新しいbackend testでPause位置、EOFのdrain、初期化中のStop、遅れて完成したengineの破棄、元VGZ保持、対応外commandを確認。
- `node scripts/check_synth_song_preview_browser.cjs`：Chromium／WebKitで成功。実FMの440→220Hz、PSG VGZの330Hz、PCM bank DACの220Hz、実際のPause無音／位置保持／Resume、Stopからの再生し直し、Master 0／50／100／200／380%、編集音色保持、Files選択・削除、Cassette交換、初期化中キャンセルを検証。speakerへの物理出力はmuteし、人の実聴は行っていない。
- UIは1240／390px、Files表示On／Off、Envelope／Waveform／Spectrumで確認し、desktopとmobileのスクリーンショットも目視した。
- 生のcore出力にはDC offsetがあるため、周波数検証は測定windowの平均を引いて行う。最初のzero crossing試験だけを修正し、音源やgainは変更していない。
- source検証記録：`/private/tmp/fm2612-synth-song-preview-browser.json`。
- `sh scripts/package_itch_synth.sh vgm-preview-check-20261109`：成功。`node --experimental-vm-modules scripts/check_synth_package.mjs release/itch_synth_vgm-preview-check-20261109`で241個のlocal module／asset参照が成功。
- 同じbrowser checkerを`--root=release/itch_synth_vgm-preview-check-20261109 --entry=/index.html`で実行し、両browserの全ケースが成功。配布物以外への参照なし。記録：`/private/tmp/fm2612-synth-song-preview-package-browser.json`。
- 最終ZIP：`release/hello_ymfm_wasm_vgm-preview-check-20261109_itch_synth.zip`（235 entries／797,495 bytes、SHA-256 `f59f31ca6755f1b3fd2d1ec15a86ed3084f90ee44fb45c0a94a77f87e45534af`）。可読JSはURL移設以外に変換していない。既存WASM・対応source kit・licenseを同梱。
- README英語／日本語のFM2612 Synth案内へ保存と模範演奏の入口を追記した。未公開・未commit・未push。

## 追加: Mega CD／32Xの模範演奏

ユーザー報告：`06 - Cave (Exploration).vgz`が`Unsupported chip: rf5c164`で停止した。Sega PSG・Mega CD・32Xを含む演奏に対応する。

- [x] 既存Sega PSG対応を維持し、Mega CDのRF5C164 PCMと32XのPWMを独立した曲用engineへ追加する。
- [x] VGM headerのclock、register write、RF5C164 RAM／data block、対応するstream commandを実装済みcore／parserへ接続する。対応外は理由を表示する。
- [x] 実ファイルがworkspaceにあればheader／commandを照合し、元データを変更せず再現を確認する。
- [x] RF5C164／PWM単独と混在の実音声、Pause／Resume／Stop、旧FM／PSG／DAC、Masterと音色保持を検証する。
- [x] 必要なWASM・可読JS・対応source／licenseを配布へ含め、itch用ZIPだけでも両browserで確認する。
- [x] READMEとこの記録へ対応範囲・検証結果を反映する。公開・commit／pushは行わない。

Mega CDのCD-DAはVGM外の音声素材を必要とする場合があるため、RF5C164のVGM再生と混同しない。

### Mega CD／32Xの結果

- 必要な場合だけRF5C164またはPWMの実WASM chipを追加する。途中で失敗した場合は、作成済みYM2612／PSG／RF／PWMをすべて解放する。
- RF5C164は`0xb1` register、`0xc2` memory、`0xc1` RAM block、bank2＋`0x68`の転送に対応。PWMは`0xb2`とstream `0x11`に対応し、Analyzerと同じMAME FIFO／timer・duty出力・gain 1を使用する。
- clockが欠けた追加音源、2個目のRF chip／bank、dual／variant flag、対応外のRAM／stream targetは再生前に拒否する。RF5C164のDAC stream `0x10`は共通parser未対応のため許可していない。通常のRAM blockとregisterによるRF再生は対応する。
- `node --test docs/synth/*.test.mjs`：93件成功。backendは11件で、実RF／PWM WASMによる音声生成とPause／Resume／Stopも含む。
- Chromium／WebKitで各5ケース（既存機能、準備中キャンセル、追加chip／混在、実Mega CD曲、実32X曲）が成功。実FM／PSG／DAC、RF、PWM単独と4音源の混合周波数成分、Master、音色保持、Files連携を確認。物理音声はmuteし、人の実聴は行っていない。
- 報告曲：`ww/Popful Mail (Mega CD)/06 - Cave (Exploration).vgz`。YM2612 7,670,453Hz／PSG 3,579,545Hz／RF5C164 12,500,000Hz。RF RAM block 4件、RF register 383件。両browserで再生・Pause／Resume／Stop・元バイト保持・編集音色保持が成功。
- 32X実曲：`ww/Virtua_Fighter_(Sega_32X)/02 Opening.vgz`。PWM 23,011,360Hz、直接PWM書き込み359,648件。両browserで同じ検証が成功。実曲の音声データはreleaseへ追加していない。
- 元データ監査：`/private/tmp/fm2612-cave-reference-audit.json`、`/private/tmp/fm2612-32x-reference-audit.json`。UI／音声記録：`/private/tmp/fm2612-megacd-32x-browser.json`。
- `sh scripts/package_itch_synth.sh vgm-megacd-32x-check-20261109`：成功。既存profileにRF／PWMのWASM・source／licenseが既に揃っており、243参照の検証が成功した。
- 配布stageだけでも上記の全ケースが両browserで成功。記録：`/private/tmp/fm2612-megacd-32x-package-browser.json`。可読JSはURL移設以外に変更せず、RF／PWMの生成済みloader／WASMはdocs元とbyte一致。
- 最終ZIP：`release/hello_ymfm_wasm_vgm-megacd-32x-check-20261109_itch_synth.zip`（235 entries／798,190 bytes、SHA-256 `b7f1a1f9d01e6350aa6913aa572f4a1ff08d21b566dc4d4dbfc761dfdc15ead3`）。記録：`/private/tmp/fm2612-megacd-32x-package.json`。
- README英語／日本語の対応音源とbrowser cache keyも更新。未公開・未commit・未push。

## 追加: 今のFM2612 UIで模範演奏のLive状態を表示

ユーザー指示：再生中の実際の状態を既存FM2612 UIで見たい。LiveはcheckboxでOnの時だけ表示し、既定Onとする。

- [x] VGM欄にLive（既定On）とCH1〜CH6の選択を追加する。別のparameter UIは作らず既存operator／共通設定へ反映する。
- [x] 独立した曲用engineのYM2612書き込み状態を追跡し、先読み位置ではなく実際に聴こえる位置へ合わせて表示する。
- [x] Liveでは表示を読み取り専用とし、編集音色・鍵盤用音源・Files・Undo／Syncを自動で上書きしない。Off／Stopで編集表示へ戻し、Pause中は表示も固定する。
- [x] algorithm／feedback／operator／LFO／AMS／PMS／pan、Gate／音程、CH3 special／DACを正しい対応範囲で表示する。書き込みshadowと実機のreadback／内部EGを混同しない。
- [x] Nodeと実browserで時間合わせ、CH切り替え、Live Off復帰、Pause／Resume、音色保存の不変、鍵盤focus、既存演奏を検証する。
- [x] 配布に必要な可読モジュールを含め、ZIPの中だけでも検証してREADME／TODOへ記録する。

公開・commit／pushは行わない。

### Live実装の範囲

- `synth_song_state.js`が曲用YM2612の書き込みだけを観測する。native生成frameでイベントを記録し、実際に消費された音声frameまで適用する。VgmPlayer内のprefetchも追跡し、過去イベントを破棄してpending memoryを抑える。
- 6chのimmutable snapshotを生成し、logical OP1／2／3／4（register offset +0／+8／+4／+12）、全operator設定、LFO、DAC、pan、key mask、BLOCK／FNUM、CH3特殊周波数へ対応する。高位周波数latchと低位writeのcommitも区別する。
- 音程はBLOCK／FNUMから求める基準音程であり、MULTI／LFO／FMを含む聴感上のpitch検出ではない。Gateは書き込まれたKON状態。CSM／DACは別の表示として扱う。任意registerの実機readbackや内部EGレベルを読んだことにはしない。
- `synth.js`は表示用overlayから既存controlの`updateVisual()`だけを呼び、`applyPresetData()`や編集stateを使ってLive値を適用しない。Live中の編集control／Sync／Revert／音色exportは読み取り専用とし、Off／Stopで元の表示と編集基準値へ戻す。
- Envelopeは同じoperator guideを使うが、Live中は鍵盤用engineのcyan RMSを非表示にする。内部EGの追跡と混同しない。OP選択は可能で、数値・curveの編集はできない。
- Waveform／SpectrumのanalyserをfinalOutputBusへ接続し、模範演奏を含む実際の出力を表示する。スピーカーやLooper録音への接続を増やさない。
- YM2612を含まないPSG／RF／PWMのみの曲ではFMの架空stateを表示せず、理由を出して編集UIを維持する。

### Live最終検証

- `node --test docs/synth/*.test.mjs`：99件成功。追加6件でoperator／global decode、6ch、周波数latch、CH3順序、先読みと聴こえる位置の分離、Pause／Stop／YMなしの状態を検証した。
- 最初のbuffer生成はcooperative budgetでyieldする場合があるため、旧backend testの即時生成assertを、上限1秒で実際のrefillを待つ検証へ修正した。生成が必要というassert自体は維持し、音源・gainの変更は行っていない。
- `node scripts/check_synth_song_live_browser.cjs`：Chromium／WebKitで成功。2秒の音程・ALGO／TL変更に対して、1.8〜1.96秒は古い値、2.08秒以降は新しい値になることを、実PCMと消費frameで確認。CH変更、Pause固定、Resume、Live Off／Stop復帰、全VFS fileのSHA不変、CH3／DAC、鍵盤focus、Waveform／Spectrumの実信号も確認した。
- 1240／390pxでスクリーンショットを確認。Liveは既定On。物理出力をmuteして計測し、実聴の確認とは区別する。
- source記録：`/private/tmp/fm2612-synth-song-live-browser.json`。
- 配布作成：`sh scripts/package_itch_synth.sh vgm-live-check-20261109`。新しい可読helperを含み、244参照の検証に成功。
- 同じLive checkerを`--root=release/itch_synth_vgm-live-check-20261109 --entry=/index.html`で実行し、両browserで成功。記録：`/private/tmp/fm2612-synth-song-live-package-browser.json`（83個のassetをhash確認）。
- 旧演奏checkerはLive Offでの編集保持を検証し、Live Onは専用checkerで検証するよう区別した。配布内で旧FM／PSG／DAC・RF／PWM・混在、Cave／Virtua Fighter実曲の全10ケースも成功。記録：`/private/tmp/fm2612-synth-live-playback-regression.json`（87個のassetをhash確認）。
- 最終ZIP：`release/hello_ymfm_wasm_vgm-live-check-20261109_itch_synth.zip`（236 entries／802,674 bytes、SHA-256 `2b8983be6bd1d8c241af022d34084f9496fc741d8485a3edb2bbdde12cd20345`）。可読helperはURL移設以外に変更せず、両browser検証で読んだ全assetのhashが最終stageと一致する。
- README英語／日本語にLiveの使い方を反映した。未公開・未commit・未push。
