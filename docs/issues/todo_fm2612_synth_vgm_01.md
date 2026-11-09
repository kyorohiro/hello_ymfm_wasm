# FM2612 Synth：importしたVGMの保存（2026-11-09）

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
