# FM2612 Synth：importしたVGMの保存（2026-11-09）

## 完了: 模範演奏のシークバーとメモリ内Seek cache（2026-11-10）

ユーザー指示：seekbarを追加し、一旦Web版をreleaseする。VGM Analyzerのようなcacheも使えるか確認する。

- [x] 既存のVGM欄へコンパクトなシークバーと現在位置／全長を追加する。ドラッグ中は移動先の時刻を表示し、指を離した時に移動する。focus中も演奏用の文字キーを維持する。
- [x] 再生中は移動後も再生し、Pause中はPauseを維持する。停止状態からの移動も扱い、移動先でCHの観察・試奏・Copyができる。先読み音を止め、実際に聴こえる位置とLive表示を合わせる。
- [x] VGM Analyzerの既存seek処理／VgmPlayer checkpoint APIを再利用する。RAM上限32MiB・最大120件・約5秒間隔を基準とし、未cache区間は無音で進めながらUIへ制御を返す。
- [x] chipだけでなく、Liveのregister shadow／latch／KON・output mixerのsource pan／PCM bank選択も復元する。FM・PSG・DAC・Mega CD PCM・32X PWMでcold／cached seekの音と状態を照合する。
- [x] cacheは既定OnでMix内からOffにできるようにする。未対応engineは通常seekへ戻す。同曲でcacheを再利用し、曲変更・必要なMix設定変更で無効化する。元VGM・Cassette・音色へcacheを保存しない。
- [x] Stop／新しいseek／曲変更／pagehideで処理を取り消し、古い処理の遅延再生を防ぐ。移動中は録音・Looper・試奏を適切に停止／制限し、Mixの共通補正とMasterを維持する。
- [x] 実WASM・Node・Chromium／WebKitで前後移動・端点・連続操作・Pause／Resume・cache hit／Off／上限・Live／Copy・既存Mix／録音の回帰を確認する。
- [x] README／TODO・cache keyを更新し、配布ZIPだけで確認してWebリリース用ZIPを用意する。commit／push／itch.io公開はこの作業では行わない。

### 実装と検証

- 既存VGM欄へ現在／全長と小さなシークバーを追加。input中は時刻だけをpreviewし、release／changeで移動する。矢印は1秒、Shift／Pageは10秒、Home／Endは曲頭／正確な曲末。focus中の文字キーは演奏に使える。常設パネルは追加しない。
- `synth_song_seek_controls.js`がUIとcache設定を担当し、既存`vgm_analyzer/seek_playback.js`／`VgmPlayer`を再利用する。cacheは既定On・約5秒間隔・32MiB／最大120件。MixのSeek cacheでOffにするとcheckpointを即解放し、通常seekへ戻す。localStorageへ保存するのはOn／Offの好みだけで、checkpointやPCMをVGM／音色／Cassetteへ書かない。
- 同曲のStop／再開・曲末後もnative engineとcacheを保持し、再利用する。曲変更・clear・dispose・audio bus変更では旧engineを解放する。Mute／音源Volume変更はcacheを無効化し、Masterは外側GainNodeなのでcacheを維持する。未対応engineはsnapshot無しの通常seekへ戻す。
- native chip stateに加え、Live decoderのregister・frequency latch・確定FNUM・KON／回数、先読みtimeline、output mixerの元pan・PCM bank／channel shadowを復元する。Mixerのユーザー設定を巻き戻さず、native復元時に余計なregister writeをしない。
- 実WASM検証で、ymfmの通常resetがglobal EG counter位相を残すことを発見した。Synthの模範演奏engine内だけで同一instanceのpower-on YM stateを保持し、cold seek時に復元する。共有core／SDK／WASMは変えない。cache Off時もcold resetの基準としてこの小さな固定stateを使う。
- shared seekの正確なイベント境界では、移動先の時刻0／同フレームのwriteを次の未送信PCM chunkへ適用し、そのchunkをResumeまで保持する。表示だけ次へ進めたり、1sample bufferを挟んだりせず、Liveと実際の出力を同じ位置へ揃える。
- generation／AbortControllerと直列workでStop・最新seek・曲変更・pagehideを取り消す。seek中はLooper／Event Rec／手動演奏を止め、CH選択・Copyを制限する。再生中のseekは再生を続け、Pause／停止からは無音のPauseへ移る。停止位置でも選択CHを試奏・Copyできる。
- `node --test docs/synth/*.test.mjs`：179件成功。FM／PSG／DAC／RF5C164／MAME PWMのcold／cached／再生中seekについて、続く4096サンプルを独立した連続再生とbyte照合した。時刻0・音色変更境界・曲末、dangling latch／bank、cache hit／Off／上限／Mix無効化、Stop保持、取消・遅延AudioContext／engine初期化も検証した。Liveのローカルrevision番号だけを除き、source設定・frame・KON回数は一致する。
- 新しい`check_synth_song_seek_browser.cjs`が配布stageのChromium／WebKitで成功。再生前の全長、input preview／commit、前後seek、実PCMとLive／発音OPの一致、実cache hit（復元frame 270336）、Offの0件／0bytes、再On、Pause／Resume／端点、seek focus中の試奏、移動先Copy、元VFS不変、Stop／曲変更の即時取消、Off設定のreloadを確認した。cacheは両browserとも2件・1,272,980 bytesで上限内。fixtureは自己作成し、音程同士の倍音が重ならない330／733／1171Hzで独立した実WASM照合も行った。閾値を緩めていない。
- 既存`check_synth_song_mix_browser.cjs`も最終stageのChromium／WebKitで成功。共通補正・source Volume・全CH Mute・Master・focus・Pause／Stop保持・Live／保存不変・Copy／CH3特殊を再確認した。`check_synth_captured_recording_browser.cjs`もChromium／WebKitで成功し、部分OP／CH3特殊のLooper・Event Rec・実音声・書出／再読込・VGM再生との排他を確認した。
- 1240／390pxの配置とWebKit描画を画像で確認。receiptは`/private/tmp/fm2612-song-seek-browser.json`（96 assets）、`/private/tmp/fm2612-song-seek-mix-browser.json`（100 assets）、`/private/tmp/fm2612-song-seek-recording-browser.json`（96 assets）。全asset hashが最終stageと一致。音声は出力端で物理muteした自動計測で、人の実聴とは区別する。
- `sh scripts/package_itch_synth.sh song-seek-check-20261110`と266個のlocal module／asset参照チェックが成功。README英語／日本語とcache keyを更新し、新helperとshared seekを配布へ含めた。最終ZIP：`release/hello_ymfm_wasm_song-seek-check-20261110_itch_synth.zip`（249 entries／221 files、837,555 bytes、SHA-256 `d0b0bedc3b7a37df78a038421d9d97d05436566758b5c39da29a8a859829da4a`）。全fileがstageとbyte一致し、shared seekもsourceと一致。receipt：`/private/tmp/fm2612-song-seek-package.json`。公開・commit／push・Tauri更新はしていない。

## 完了: FM2612 SynthのMixを共通補正・source倍率へ統一（2026-11-10）

ユーザー指示：FM2612 Synthだけ他のTetoricaアプリと異なるVolume基準を、Playground／VGM Analyzerに揃える。

- [x] 共通の`SOUNDCHIP_MIXER_PRESETS.calibrated`を参照し、YM2612・Sega PSG・Mega CD PCMの初期値／Reset値を取得する。数値をSynthへ重複定義しない。
- [x] 100%をraw音源出力の1倍とし、Genesis engineの従来のYM 0.9／PSG 0.35を描画境界で相殺する。共通SDK・core・WASMは変更しない。
- [x] 32X PWMの既存L／R Mute UIを維持し、固定の再生基準も共通補正へ揃える。Masterは既定100%のまま独立させる。
- [x] 補正値の精度を保持する。sliderへ整数%を設定して初期値を丸めない。常時表示は読みやすい約77.6%／35%／28%にし、正確な値も確認できるようにする。矢印キーは実用的な1%刻みを維持する。
- [x] Mute・0〜380%・色・focus・同曲停止／再開での保持・別曲での初期化・Reset・Live／元file不変を維持する。
- [x] Node／実WASMで共通補正の一致と100%のsource倍率、二重補正がないこと、Mute・0%からの演奏継続を検証する。
- [x] 配布ZIPをChromium／WebKitで検証し、README／TODO／cache keyと検証記録を更新する。公開・commit／pushはしない。

### 実装と検証

- `synth_song_mix_defaults.js`が共通のgenerated presetからYM2612／Sega PSG／RF5C164／PWMを取得する。modelの初期値・Reset・変更判定と出力adapterが同じ値を参照する。SDK側の数値や生成スクリプトは変更しない。
- Volumeはsourceの絶対倍率。Genesis engine内の従来の0.9／0.35をadapterで相殺し、Masterは既存の独立した全体GainNodeのまま。PWMの固定補正も共通tableを参照する。
- UIは4桁の小数%を保持できるsliderにし、内部の六桁gainを丸めずに保持する。表示だけ1桁へ丸め、title／aria-valuetextに正確な%とgainを示す。矢印は1%、Shift／Pageは10%、Home／Endは0／380%で操作できる。往復時の浮動小数誤差はUI入力境界で揃える。
- `node --test docs/synth/*.test.mjs`：168件成功。独立した同一native Genesis＋MAME PWM engineにSynth adapterとVGM Analyzerの`installPlaybackMixer`をそれぞれ適用し、同じ演奏write・共有初期値・50／100／200%・独立した音源gainのPCMを直接比較した。Analyzerの5ms rampを越えた同じnative位相で、Float32丸め幅の範囲で一致した。raw source単独合算との比較と0／380%・Mute・0%中のchip進行も検証した。
- 現在の共有gainはYM2612 `0.775938`／Sega PSG `0.35`／RF5C164 `0.280286`／PWM `0.128818`。常時表示は77.6%／35%／28%、PWMは既存Muteのみ。モデル値は表示桁数へ丸めない。
- 配布stageの`check_synth_song_mix_browser.cjs`がChromium／WebKitで成功。Synth helperとは独立に共通presetをimportして初期値を照合し、初期状態のReset無効と変更markerなしを確認。1%の矢印往復・Page／Home／Endから正確な補正値へ戻した時にも、浮動小数誤差による余計な変更状態を残さない。正確なslider値・title／aria-valuetext、1桁の読める表示、色・fillも確認した。
- 実PCMで3音源の補正初期値→source 100%→初期値を測定し、共有倍率が一度だけ適用されることを確認。PWMも自作VGMのduty波形から求めたraw基本波振幅に共有補正を掛けた値と一致した。既存の全20系統Mute・0／50／100／200／380%・複数音源の独立性・Master・DAC・focus中の鍵盤入力・位置継続・Pause／Stop保持・Reset／別曲での共通補正復帰・Live／VFS byte不変・Copy／特殊CH3の検証も成功。
- 1240／390pxの配置とWebKitの色を確認。新しい常設UIは追加していない。記録：`/private/tmp/fm2612-mix-source-browser.json`（98 assets）。全asset hashが最終stageと一致。音声出力を物理muteした自動計測であり、人の実聴とは区別する。
- 配布に新helperと共通presetファイルを追加し、URL移設を行う。`sh scripts/package_itch_synth.sh mix-source-check-20261110`と264個のlocal module／asset参照チェックが成功。最終ZIP：`release/hello_ymfm_wasm_mix-source-check-20261110_itch_synth.zip`（247 entries／219 files、829,989 bytes、SHA-256 `a8d54086192ee031a1739fc87b22d140fcce9ffd2e3a254a093766bfe0ee2123`）。全fileがstageと一致し、共通presetはsourceとbyte一致。receipt：`/private/tmp/fm2612-mix-source-package.json`。README英語／日本語・cache keyを更新。共通SDK／core／WASM／npm package自体は変更せず、公開・commit／pushはしていない。

## 完了: MixのMute表記と音源別Volume

ユーザー指示：MをMuteへ変更し、S／Soloを外す。YM2612・Sega PSG・Mega CD PCMそれぞれの音量を調節できるようにする。

- [x] 各CHの操作はMuteだけにする。既存のMix popup内に音源ごとのVolumeを置き、常時表示のUIは増やさない。
- [x] Volumeは既定100%、既存Masterと同じ0〜380%にする。100%超をオレンジで示す。32X PWMは既存のL／R Muteを維持する。
- [x] Volumeは模範演奏の各音源の出力へ作用し、Masterとは独立させる。音色・source VGM・Live表示・発音・再生位置・chip内部処理を変えない。
- [x] 再生／Pause／Resume、同じ曲のStop後は設定を保持し、曲変更では初期化する。ResetでMute解除とVolume 100%へ戻す。Soloの状態・操作経路を外す。
- [x] 実WASMで0／50／100／200／380%、複数音源の独立性、Muteとの併用、復帰後の波形継続とdefault 100%の一致を検証する。
- [x] 配布ZIPのChromium／WebKitで実PCM・keyboard focus・Live／保存不変と1240／390pxの配置を確認し、README／検証記録を更新する。公開・commit／pushはしない。

### 実装と検証

- SoloのUI・state・操作APIを外し、各CHをMute表記にした。YM2612／Sega PSG／Mega CD PCMの見出しの下へ既定100%・0〜380%のsliderを追加。100%超はオレンジ。32X PWMは既存のL／R Muteのみ。
- 各chipの所有するstereo出力copyを合算前にscaleし、chip register／TL／発音／sample位置は変えない。既定1倍ではscale自体を省略し、PCMのbyte一致を維持する。0%でもcoreを進め、Disposeで元の生成経路を戻す。
- `node --test docs/synth/*.test.mjs`：166件成功。実WASMの0／50／100／200／380%、3音源の独立性、Master／PWMとの合算、0%から戻した波形継続、Muteとの併用、Reset／Disposeを検証。previewは先読みPCMを捨てず、Pause中のVolume変更でも位置・Live・元fileを変えない。
- 音量sliderは状態変更中も同じDOMを保持する。各Mix snapshotが同じならUI更新を省略し、Volumeだけの変更ではpopup位置のlayout計測をしない。focus中も文字キーでSynthを演奏でき、矢印／Home／Endはslider、Space／Enterはbutton操作へ渡す。
- 同曲のStop／Play・Pause／ResumeではMuteとVolumeを保持する。別曲ではMute解除・100%へ戻し、存在しない音源のsliderを除く。ResetもMute解除・100%へ戻す。Mixerはsession用で、音色・元VGM・Cassetteへ設定を書き込まない。
- 配布stageの`check_synth_song_mix_browser.cjs`がChromium／WebKitで成功。FM 6ch／PSG 4ch／PCM 8ch／PWM左右の全20系統でMute・解除後の実音声継続を確認し、S／SoloのUIがなく全buttonがMute表記であることを確認した。
- 各groupを単独／複数音源同時で0／50／100／200／380%にし、実PCMの倍率と他音源・PWMの不変を確認。Master 50%は各groupの値を維持したまま全体だけを0.5倍にする。YM2612 VolumeはCH6のDAC音声にも適用される。検証用PWMの大きな左出力が別音源のFFT測定へ漏れないよう、3音源は右側、PWM Lは左側で測り、倍率の判定閾値は変更していない。
- 同checkerでPause中の音量変更による位置固定、focus中のrangeからの鍵盤入力と実KON、Pause／Resume・同曲Stop／Playの保持、Reset、別曲での初期化、Liveの元register表示と全VFS byteの不変を確認した。既存Copy／部分OP／CH3特殊・編集保存の検証も成功。
- 1240／390pxでpopupが画面内へ収まり、開閉でeditorの位置・高さが変わらないことを確認。YM2612／Sega PSG／Mega CD PCMのVolumeは各見出し直下、Muteは2列、PWMは既存左右のMuteのみ。狭幅ではpopup内をscrollできる。音源のUIや音色editorへ新しい常設行は追加しない。
- 記録：`/private/tmp/fm2612-mix-volume-browser.json`（96 assets）。全asset hashは最終stageと一致。物理音声出力はmuteした自動計測で、人の実聴とは区別する。
- `sh scripts/package_itch_synth.sh mix-volume-check-20261109`と261個のlocal module／asset参照チェックが成功。最終ZIP：`release/hello_ymfm_wasm_mix-volume-check-20261109_itch_synth.zip`（245 entries／217 files、827,463 bytes、SHA-256 `b5b85a812608612cef404623a1601dc37b474886e69529196098ae36cb6254c0`）。全fileがstageと一致。receipt：`/private/tmp/fm2612-mix-volume-package.json`。README英語／日本語・cache keyを更新した。共通SDK／core／WASM／npm packageの変更はない。未公開・未commit・未push。

- WebKitの標準rangeがaccent-colorを描かないことを画面確認で検出し、3つのgroup sliderに共通のcustom track／thumbを使うようにした。最終stageで同じ全checkerをChromium／WebKitとも再実行し、青／オレンジのresolved gradient・fill位置・各音量・入力・状態保持が成功した。YM2612 150%のオレンジ／PSG 80%の青を1240／390pxでも確認。Masterの既存描画には変更しない。

## 完了: 通常音色を含むOP1〜OP4の発音On／Off

ユーザー指示：コピー音色に限らず、通常の音色でも発音するOPを指定できるようにする。既定は全OP On。

- [x] 既存OP行の番号を小さな発音切り替えにし、行・パネルを増やさない。Live中は元のOP gate状態を読み取り専用で表示する。
- [x] 通常・import・コピー音色のいずれもOP1〜4を選べるようにし、全Offも扱う。発音のKey On／Offであり、TLやalgorithmは変更しない。OffではRRに沿ってreleaseする。
- [x] 押しっぱなしで変更した場合、保持中のvoiceへOP maskだけを反映し、変えていないOPのADSRやpitchを再開始しない。
- [x] preset／sidecar・Sync／Revert・Cassette・復旧で指定を保持し、旧データは従来どおり全OP Onにする。
- [x] Looper／Event Recでも全Off・途中のOP切り替えを保持する。通常／部分OPはround robin、CH3特殊は固定単音を維持する。
- [x] 実WASMとNode／Chromium／WebKitで発音OP、全Off、途中切替、保存、録音往復、Liveの読み取り専用、狭幅配置を確認する。
- [x] 配布ZIPで動作を確認し、READMEとTODOを更新する。公開・commit／pushはしない。

### 実装と検証

- 通常音色のOP番号を小さなKey On／Offボタンにし、既存の行・列を維持した。Liveでは現在のmask（全Offも含む）を読み取り専用で表示する。共有controlsの既定は従来の番号表示とし、Playgroundは変更しない。
- `node --test docs/synth/*.test.mjs docs/playground/playground_operator_tab.test.mjs`：171件成功。実WASMで変更していないOPのEG／PCMがbyte一致し、全Off・途中切替のEvent Rec／Looperイベント再生もbyte一致。TFI／VGI sidecar・Sync／Revert・Cassette・復旧を確認した。
- OP選択の情報は既存version 1の任意`capturedVoice`へ保持し、旧データは全OP On。通常音色の読み直しでglobal DACが変わらないようにし、Copy成功時だけFM試奏用にDACをOffへ戻す。
- 検証用の複数carrier `[3,5,7,2]` では、OffのOPのEGが0でも既存coreのDAC非線形処理から別帯域へ小さな成分が出ることを実WASMで確認した。診断波形を`[1,2,4,8]`へ変更し、停止する低いcarrierと混合成分を分離した。exact A2（BLOCK 2／FNUM 1083）で各maskの16 FFT窓を検証し、Off帯域最大5.57e-6、On帯域最小0.00469。音源実装・音量・判定閾値は変更していない。
- 配布stageの`check_synth_operator_gates_browser.cjs`がChromium／WebKitで成功。通常VGIの全OP Onとround robin、保持中の15→14→12→8→0→8、全Offで押した鍵盤の再有効化を確認した。各操作のwriteは0x28の1回だけで、途中の全Offや周波数writeを挟まない。TL／algorithm／ADSRは変更しない。実PCMの停止bandと有効bandを測定し、全Offでは検出値が0になった。
- 同checkerで全Offの自動保存・Reload・Cassette、Sync／Revert、独立したsession DACの保持、旧presetの全OP Onを確認した。Looperの実録音音声に全OP／無音／OP4だけの各区間があり、Event RecのJSON往復は各gate変更を保持し、再生も各maskを出力する。不正16のimportは直前のtakeを保持する。Liveは現在の8→0を読み取り専用で表示し、離鍵中のCopyは直前の8を取り込む。recording用app commandを追加し、共通SDK／runtime／core／WASM／npm packageは変更していない。
- 同じstageで`check_synth_captured_recording_browser.cjs`も両browserで成功。既存の部分OP／特殊CH3の実音声、固定単音とround robin、CH3の4周波数比、Looper／Event Recの記録・再生・元設定への復帰、VGM Play／Resumeでの録音排他と初期化待ちの取り消しを確認した。既存checkerの「0は不正」というケースは、全Offの有効化に合わせて16へ更新した。
- 1240pxではOPボタン32×22px・既存行24px、390pxでは28×22px・既存行22px。新しい行・列は追加しない。Onは色付き枠、Offは薄い点線で表示し、hoverの説明にKey On／OffとRRによるReleaseを記載。pointer操作で演奏keyboardのfocusを奪わず、Space／Enterによるbutton操作が録音shortcutへ届かない。狭幅でOP2／OP3をOffにした画面も確認した。
- 記録：`/private/tmp/fm2612-op-gates-browser.json`（92 assets）、`/private/tmp/fm2612-op-gates-captured-regression.json`（92 assets）。両receiptの全asset hashは最終stageと一致。物理音声出力はmuteした計測であり、人の実聴とは区別する。
- `sh scripts/package_itch_synth.sh op-gates-check-20261109`と261個のlocal module／asset参照チェックが成功。最終ZIP：`release/hello_ymfm_wasm_op-gates-check-20261109_itch_synth.zip`（245 entries／217 files、825,846 bytes、SHA-256 `37c459aa4cc77314537d843a074ffbbc96c4f82ee57b26afa0481e25293ef7d4`）。全fileがstageと一致。receipt：`/private/tmp/fm2612-op-gates-package.json`。README英語／日本語とcache keyを更新。未公開・未commit・未push。

## 完了: コピー音色のLooper／Event Rec対応

ユーザー指示：partial KON／CH3特殊モードのコピー音色を録音・再生へ対応する。CH3特殊時はCH3固定・単音。VGMのPlay中はLooper／録音をOffにする。

- [x] 鍵盤・Looper・Event Recで同じ発音OP maskとCH3の4周波数比を使う。通常FM／partial KONのみはラウンドロビン、CH3特殊はCH3固定・単音にする。
- [x] Looperの録音patch／イベント再生へコピー音色情報を引き継ぎ、録音したPCMとイベントのどちらでも同じ音になることを確認する。既存の通常音色／loopを維持する。
- [x] Event Recの保存・読み込み・再生でpartial KON、CH3 mode／4周波数、移調を保持し、再生を止めた時は編集音色へ戻す。
- [x] VGMのLoading／Play／Resume開始時にLooper・録音・録音再生を停止し、Play中は操作を無効にする。Pause／Stop後は自動再開せず、ユーザー操作で使えるようにする。
- [x] 録音開始・音声初期化中のVGM開始、停止・取り消し・編集音色変更、通常音色への復帰と保存データ不変を確認する。
- [x] 実WASMとNode／Chromium／WebKitで通常／partial／特殊CH3の録音と実再生音、VGMとの排他を検証する。
- [x] 配布ZIPだけの動作、READMEとTODOの記録を更新する。公開・commit／pushはしない。

### 録音対応の実装と検証

- `synth_performance.js`のadapterを鍵盤・Looper・Event Recの共通経路にした。通常FMとpartial KONは6chを使い、CH3特殊時は手動MODEもコピー音色もCH3固定・単音とする。4周波数の比率をOP4基準で移調し、発音OP maskを保持する。MODE切替で古い鍵盤状態を解除し、OP4基準0は変更前に検証する。
- `synth_looper.js`は既存Looperのapp用拡張。unit.patchだけでなくnote単位でもvoice情報を保持し、event fallbackはCH3を他のCHへ割り当てない。特殊unitが使うCH3を通常event unitの割当から除き、古いunitのNote Offで新しいunitのCH3を消さない。PCM layerは従来どおり独立した録音音声を再生する。
- 録音開始待ち・capture確定待ちのstopは同期的にtimer／再生を止め、非同期完了を待ってから終了する。完成したtakeは残すが、その後に古いcallbackから録音や音が再開しない。物理全CHのcleanupは現在の特殊voiceに再マップせず、0〜5へ直接Note Offする。
- `synth_recording.js`が既存Event Recを拡張し、内部のNote Off・4周波数writeを二重録音せず、発音とPitch更新を明示的なperformance commandにする。通常録音／旧fileは`megasynth-recording-v1`のまま。特殊performanceを含むfileは`tetorica-fm2612-synth-recording-v1`を名乗り、古いplayerが全OP音と誤認して再生することを避ける。FM operatorを現在の編集値で試すIgnore Op設定と、発音mask／CH3のperformance情報を区別する。
- 新旧fileのcommand時刻・値域・初期状態を音の出ないtransportで検証してからimport／playする。不正fileは現在の再生・編集音色を維持する。再生停止時は鍵盤状態を解除してchipをresetし、元の編集設定を戻す。Event再生中はCH3 monitorが再生側の周波数を編集基準へ取り込まない。
- VGMのLoading／Play／Resumeでは、録音操作の世代を更新して待機中の開始を無効化する。Looper・Event Rec・その再生を止め、録音busとrelease tailを止めてからVGMを開始する。Resumeはtrusted click内でAudioContextをresumeし、hostの停止完了を待って同じ曲の続きへ戻る。Pause／Stopでは録音を自動再開しない。Pause中のCH観察／試奏は独立経路とし、録音にはSynthを選ぶ。
- ページ移動とTauriの出力切替も同じ停止処理へ接続した。出力切替開始で待機中の操作を無効にし、切替終了時はkeyboard／録音UIを更新する。今回の実行検証はbrowser版であり、Nativeアプリの実機操作は行っていない。
- 常時表示のUIは追加せず、既存Looper／Event Recの開始制限を解除した。VGM再生中は開始／録音／録音再生ボタンを無効にする。元VGM、編集中音色、Copy／Mix／Liveの保存・表示機能へ録音状態を書き込まない。共有runtime・SDK・WASM・npm packageは変更していない。
- `node --test docs/synth/*.test.mjs`：149件成功。Event Recの新規8件は実WASMで部分OP／CH3の発音・Pitch更新・離鍵まで録音元とimport再生の左右PCMがbyte一致。Looperの新規10件はevent再生の実PCM、CH割当・古いNote Off・PCM layer・Undo・非同期中断を確認。追加のResume testでcontext resume要求がhost待ちより先に行われ、待ち中の位置／buffer固定とStop時の遅延再開防止を確認した。
- 自作browser testの発音検出直後はFFT窓にattack前の無音が残るため、live基準音量を200ms待って測るようにした。再生との差の許容範囲は変更せず、音源やgainを検証値へ合わせていない。
- 配布チェックで新しい録音moduleの`../js/`参照変換漏れを検出し、包装時のURL移設対象へ追加した。`sh scripts/package_itch_synth.sh captured-record-final-20261109`と261個のlocal module／asset参照チェックが成功した。新規3moduleはURL移設だけを行い、可読sourceを維持する。
- 最終stageの`check_synth_captured_recording_browser.cjs`はChromium／WebKitで成功。通常／部分OP／CH3特殊の実PCM、単音・round robin、Looper録音音声の継続、Event RecのJSON往復・不正JSON保持・停止時の編集設定復帰、VGM Play／Resumeの排他、WASM初期化待ちのLooper開始との競合を確認した。記録：`/private/tmp/fm2612-captured-record-final-browser.json`（92 assets）。1240／390pxの画面も確認した。
- 同じ最終stageで既存のMix／Copy checkerも両browserで成功。全20系統のSolo／Mute・復帰、複数Solo、DAC／PWM左右、Copyと元file全byte保持、CH3設定編集・保存を確認。以前の「コピー音色は録音不可」というtestは、新しい録音対応を確認するassertへ更新した。記録：`/private/tmp/fm2612-captured-record-final-mix.json`（96 assets）。両記録の全asset hashは最終stageと一致。物理音声出力はmuteし、人の実聴とは区別する。
- 最終ZIP：`release/hello_ymfm_wasm_captured-record-final-20261109_itch_synth.zip`（245 entries／217 files、824,283 bytes、SHA-256 `01e282afb8deee678064e144d63275ceada01fa10ac78dcf171a320254cb1f2c`）。全fileがstageと一致。receipt：`/private/tmp/fm2612-captured-record-final-package.json`。README英語／日本語、cache key、配布moduleを更新。未公開・未commit・未push。

## 完了: Liveの変更ハイライト（既定On・切替可能）

ユーザー指示：Liveで変わった値を短くハイライトする。負荷が心配なのでOn／Offを用意し、既定Onにする。

- [x] 既存の数値表示に短い淡い強調を加える。常時表示のUIは増やさず、既存Mix内へLive highlightのOn／Offを置く。
- [x] 初期値はOn。Offの設定は端末内へ保持し、音色・Cassette・元VGMへ保存しない。Off時は差分比較・アニメーション処理を止める。
- [x] 既存のLive表示更新で差分を調べる。新しい常駐timer／rAFやレイアウト計測を追加せず、DOM参照を再利用する。
- [x] 初回表示・CH／曲の変更・Pause／Live Off／Synth復帰では強調を消して基準を取り直す。変化のない項目と通常の編集操作は発光させない。
- [x] On／Off・再有効化・頻繁な変更・Pause・CH切替・設定保持、実音声／保存データ不変を検証する。
- [x] 配布ZIPとChromium／WebKitで動作と狭幅レイアウトを確認し、検証記録を更新する。公開・commit／pushはしない。

### ハイライトの実装と検証

- 常時表示のUIは増やさず、既存のMix popup内へ`Live highlight` checkboxを置いた。既定Onで、On／OffをlocalStorageの`tetorica-fm2612-synth-live-highlight`へ保持する。Mix Resetや音色保存とは独立し、操作後はblurして演奏用keyboardへ戻れる。
- `synth_live_highlight.js`は初期化時に60個の既存数値nodeへの参照とscalar readerを受け取る。既存Live callback内で、選択CHの共通／operator設定・LFO／DAC・CH3 specialの変更だけを比較する。同じregister revisionではreaderも呼ばない。Off時はview参照・比較・DOM更新より前にreturnする。
- 変更した`.param-value`へ`is-live-changed`を付け、CSSの420ms animationで背景色と文字色を淡く戻す。同じ項目が発光中に何度変化してもanimationを再開せず、終了eventでclassを外す。timer・rAF・Web Animations API・layout計測・filter・shadowは追加しない。reduced motionではdurationを1msにし、終了eventによるcleanupを維持する。
- 初回／CH切替／Pause／Live Off／Synth復帰／Stopは発光を消し、次の表示を基準にする。再有効化も現在値から取り直す。cooperativeなVGM初期化でframe 0の途中設定が複数届く場合も、初期化を編集と誤認して光らせず、最初の聴こえる状態を基準にする。
- 既存`createParamControl.updateVisual()`も、表示文字列が同じなら`textContent`を書き直さないようにした。編集の基準値・boolean状態の更新は維持する。
- `node --test docs/synth/*.test.mjs`：130件成功。新規7件で差分だけの発光、Off時のreader／DOM呼び出し0、同revisionの省略、連続変更の合流、モード切替、初期化frame 0、終了／破棄を検証した。
- `sh scripts/package_itch_synth.sh live-highlight-check-20261109`と252個のlocal module／asset参照チェックが成功。新しいhelperは可読sourceとbyte一致し、ZIPの全fileもstageと一致する。
- 配布stageの`check_synth_live_highlight_browser.cjs`がChromium／WebKitで成功。1.5秒のALGO／FB／LFO／OP4 TL・AR／CH3 MODE・FNUM変更を消費frameに合わせて強調し、先読みの時点では光らないことを確認した。48回の連続TL変更は両browserとも3回のclass追加・CSS animationにまとまり、Off中の発光・新しいpolling interval・音程だけが変わる区間の数値text書き換えは0件だった。
- On／Off保持、再有効化、Pause／CH／曲変更・Live Off／Synth／Stopの解除、全VFS file byte保持、実音声の継続・進行位置の整合性を確認。1240／390pxでMixを開いてもeditorを押し下げず、両browserの画面を確認した。記録：`/private/tmp/fm2612-live-highlight-package-browser.json`（89 assets）。
- 同じ最終stageで旧Live／Pause試奏checkerも両browserで成功。Master 0〜380%、実CHの発音・部分KON mask、CH3比率、Liveの時間合わせ、元音色保持を確認した。記録：`/private/tmp/fm2612-live-highlight-regression.json`（89 assets）。両記録の全asset hashは最終stageと一致。物理出力はmuteした計測で、人の実聴ではない。
- 最終ZIP：`release/hello_ymfm_wasm_live-highlight-check-20261109_itch_synth.zip`（242 entries／214 files、816,871 bytes、SHA-256 `7e4bc3ce75350759ac1130ebad39403d268cfc7ce8db08db0991c9a386d378fd`）。receipt：`/private/tmp/fm2612-live-highlight-package.json`。README英語／日本語とcache keyを更新。未公開・未commit・未push。

## 完了: 模範演奏のCH別Solo／MuteとCopy to Synth

ユーザー指示：どのCHを再生するか選び、YM2612だけでなくPSG・32X PWM・Mega CD PCMも対象にする。

- [x] 既存core／mixerのmute方式を確認し、発音や再生位置・Live観測を変えずに出力だけを切り替える。
- [x] YM2612 CH1〜CH6（CH6のDACを含む）、PSG Tone 1〜3／Noise、RF5C164 PCM 1〜8、32X PWM L／Rを選べるようにする。PWM L／Rはステレオ出力であり独立した音色voiceとは表示しない。
- [x] コンパクトに開閉できる再生CH欄へMute／Soloと全解除を追加する。表示・試奏CHの選択とは独立させ、該当音源を持つ曲だけに表示する。
- [x] 選択したFM CHの停止位置の音色を「Copy to Synth」で新しい編集音色へ取り込み、元の編集中音色とFilesを上書きしない。コピー後はSynthへ切り替え、編集・保存へつなげる。DAC／CSMなどの対応範囲を明示する。
- [x] 再生中・Pause中の変更、先読みPCMの扱い、Resume／Stop／曲変更での選択保持・初期化を定義し、編集音色・鍵盤・Filesへ影響させない。
- [x] 実WASMの個別／混合出力、Soloの組み合わせ、Mute解除後の演奏継続、位置とLive状態の整合性をNode／Chromium／WebKitで検証する。
- [x] 配布ZIPだけで動作を確認し、README／TODOへ検証記録を残す。公開・commit／pushはしない。

### Mix／Copyの実装と検証

- 常時表示の追加は小さなMix／Copyボタンだけ。Mixは画面上に重なる非modal popupとし、音色editorの位置・高さを動かさない。開いた中へ該当音源のM（Mute）／S（Solo）を2列で表示し、狭い画面ではpopup内だけをscrollできる。
- Mixは曲の音声だけへ作用し、Live／Pauseの観察・鍵盤試奏のCH選択とは独立する。複数Soloは全音源にまたがって合成し、明示したMuteがSoloに優先する。Resetで全解除。同じ曲のStop／再生で選択を保持し、曲変更・workspace交換では解除する。選択肢はPlay時にheaderを検証した後で表示する。
- `synth_song_output_mix.js`が元のYM2612 B4／RF5C164 panとbank選択を保持して出力をmaskする。ymfmはpan無効時もOP1 feedback・phase・EGを進め、RFもpanに関係なくsample addressを進めることをsourceで確認した。KON／TL／DAC sample／PCM addressを抑える方式は使わない。全YM mute時はcore由来のDCも出力から除く。PSGは既存のnative mute、PWMは生成後のL／R出力maskを使う。SDK・core・WASM・npm packageの変更はない。
- 元のVGM writeだけをLive timelineへ通し、Mix操作の出力用writeを観察値やCopyへ混ぜない。先読みPCMは捨てずに流し、通常約200〜260msで反映する。VgmPlayerのprefetch factorを1にし、位置を飛ばすqueue flushは行わない。Pause中に変更した場合もResume後の先読み分から順に切り替わる。
- CopyはPause中のFM CHに限り、`/presets/<曲名>-CHn.vgi`と`.synth.json`を新規作成する。同名の音色／sidecar／folder／orphan checkpointを避ける。元の編集音色をflushして保持し、Undo・復旧journal・IndexedDBへつなぐ。曲はPauseのまま、成功した時にSynthへ切り替える。
- 任意の`capturedVoice` sidecarへpartial KON maskとCH3 specialの4周波数を保存する。既存version 1 sidecarと互換。鍵盤は元の発音OPとCH3の周波数比を保つ。コピーしたCH3のMODE／周波数編集も自動保存し、試奏による移調で編集基準値を上書きしない。OP4基準周波数0は鍵盤移調できないため、コピーとその編集時に検証する。DAC／CSMはFM音色と偽ってコピーせず理由を表示する。
- この段階ではpartial KON／CH3比率を持つコピー音色を鍵盤での編集・試奏・保存に限り、Looper／Event Recの開始を制限していた。上記の録音対応でこの制限を解除した。
- `node --test docs/synth/*.test.mjs`：123件成功。output helper 7件は実WASMのFM feedback／CSM／DAC・RF addressとbank・PSG noise／PWM FIFOの継続波形も照合。Copyの7件は変更前の入力検証、元音色不変、保存先衝突、Cassette／Sync／Revert／復旧を確認した。
- 旧Pause testの前提を、最初のpumpで必ずbufferが揃う即時assertから、上限1秒で実際のPCMを待つ方式へ修正。途中bufferの識別も実際のframe長を使い、同じbufferと正確な再開offsetのassertを維持した。
- 新しいbrowser checkerの自作fixtureでは、FMの11bit FNUMを越える音程をBLOCKで正規化し、RFの高いsample stepが単独end markerを飛び越えないようFFのguard領域を置いた。音源の実装やgainを変えて検証値へ合わせていない。
- `sh scripts/package_itch_synth.sh vgm-mix-copy-check-20261109`と251個のlocal module／asset参照チェックが成功。新しい4helperは可読sourceとbyte一致し、ZIP全fileもstageと一致する。
- 配布stageの`check_synth_song_mix_browser.cjs`がChromium／WebKitで成功。各20系統の実PCM Solo／Mute／復帰、複数Solo、PWM左右、DAC、時間の継続、Pause、Copyと元file全byte保持、partial KON、CH3編集／MODE切り替えの保存・試奏を確認した。1240／390pxでMixを開いてもeditorの位置・高さは不変で、両browserの画面を確認済み。記録：`/private/tmp/fm2612-mix-copy-package-browser.json`（92 assets）。
- 配布stageで旧演奏checkerの全10ケース（Cave／Virtua Fighter実曲を含む）と旧Live／Pause試奏checkerの両browserも成功。記録：`/private/tmp/fm2612-mix-copy-playback-package.json`（92 assets）、`/private/tmp/fm2612-mix-copy-live-package.json`（88 assets）。いずれも最終stageのhashと一致。音声の物理出力はmuteしており、人の実聴とは区別する。
- 最終ZIP：`release/hello_ymfm_wasm_vgm-mix-copy-check-20261109_itch_synth.zip`（241 entries／213 files、814,475 bytes、SHA-256 `723d82270f09a39f9f8d8b41984e7707a2ece45e957a1a5c843707b34ff527c9`）。receipt：`/private/tmp/fm2612-mix-copy-package.json`。README英語／日本語・cache keyも更新。未公開・未commit・未push。

### 関連する次候補

- [x] Live中に変更されたparameterを短くハイライトする（上記の既定On・切替可能な機能として完了）。
- [x] コピーしたpartial KON／CH3特殊音色のLooper／Event Rec対応。上記の録音対応で完了し、開始制限を解除した。
- [x] コピーした発音OP maskをUIから編集する入口。上記の通常音色を含むOP1〜OP4の発音On／Offとして完了。

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
