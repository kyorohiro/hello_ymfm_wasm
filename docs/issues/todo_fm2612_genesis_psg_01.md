# FM2612 / Genesis Synth：PSG基本演奏（2026-11-10）

## 完了：VGM再生中のPSGタブ選択

ユーザー報告：VGM Play中にPSGを選ぶとSynthへ戻ってしまう。

確認済みの希望：FMと同様、VGM曲中のPSG各CHをLive表示する。

- [x] PSGタブとVGMの再生／CH選択が連動する条件を確認し、期待するPSGのLive表示／編集の区別を整理する。
- [x] PSGの書込み状態を聴こえる位置で追跡するdecoder／timelineを追加し、Tone周期・減衰・Noise設定とPause／Seek／cacheを接続する。
- [x] PSGタブではTone 1〜3／Noiseを選択して既存UIでLive／Frozen表示し、Pause中にそのCHを試奏・Copyする。Software EnvelopeはOffとし、元の編集音色は変更しない。
- [x] タブ選択だけで曲のCHをSynthへ戻したり、直後の再生更新で別タブへ戻したりしない。編集中の音色と保存先を保つ。
- [x] Play／Pause／Stop／Live切替、PSGとYM2612の往復、保存状態と鍵盤入力の回帰を確認し、cache keyと再開記録を更新する。

原因：PSGタブを編集専用として実装しており、view切替とdocument切替で`selectTarget('synth')`を呼び、再生状態通知ではPSGをYM2612へ戻していた。referenceの観測chipと編集documentの所有権を分離した。再生中のタブはreference chipを切り替え、明示的なSynth選択は編集に戻るための選択として保持する。

実装：app専用PSG decoder／audible timelineでraw latch／3 tone periods／4 attenuation／最後の非消音値／noise modeを追跡する。未使用CHを勝手に鳴らさず、period 0／1の定常出力やwhite noiseに架空の音程を付けない。Previewは従来`liveState`（YM）を維持し、`psgLiveState`を別に追加。可聴frameに合わせ、先読み・Pause／Seek／checkpoint cache／EOF／Stop／disposeへ接続した。FMとPSGでCH選択を記憶し、Live Off時は両音源を同じ位置で凍結する。

UI／試奏：PSGではTone 1〜3／Noiseを選び、既存Source／Attenuation／Noise type／clockをreadonly表示する。変更のhighlightは既存のOn／Off設定を共有。Software EnvelopeはOffで表示し、VGMが行う音量writeをこのSynthのADSRと混同しない。Pause時は独立adapterで選択した物理CHをmono試奏し、減衰15なら最後の非消音値を使う。Copyは新しいversion 2 PSG presetを作成し、元のFM／PSG音色・元VGM・編集中のSoftware Envelope設定は保持する。非標準clockの固定Noise、未使用CH、定常toneなど試奏できない設定は理由を表示し、Copyも無効にする。共有SDK／DSP／WASM／校正値は変更していない。

検証：`node --test --test-concurrency=1 docs/synth/*.test.mjs`で246件成功。新規17件はPSG decoder／timeline 5、native Preview 2、Pause voice／Copy 6、実controls 4。source／最終配布版のChromium・WebKitで、再生中のPSG選択→`psg:0`、Tone／Noise readonly表示、CH記憶、Live Off／Seek位置の更新、Pause Tone／Noiseの実PCM、元のEnvelope On音色の復元、Copyと元ファイルのbyte不変、Stop後の編集、390／1240pxを確認した。最終stageでは既存FMのLive／Pause試奏／Seek／cache／取消も両browserで成功。speaker edgeは物理muteした自動計測で、人の実聴とは区別する。

記録：`/private/tmp/fm2612-psg-live-node-20261110.log`、`/private/tmp/fm2612-psg-live-source-20261110.json`（107 assets）、`/private/tmp/fm2612-psg-live-package-browser-20261110.json`、`/private/tmp/fm2612-psg-live-fm-seek-20261110.json`（104 assets）。source／stageのserved asset hashは最終ファイルと一致。entry／新しいLive helperのcache keyは`psg-live-1`。

確認用ZIP：`release/hello_ymfm_wasm_psg-live-check-20261110_itch_synth.zip`（231 files、867,246 bytes、SHA-256 `1a406500817b3da42f6f94959ffcc98fbf5d33c8d0e1903c8fd1148cd494930f`）。全fileがstageとbyte一致し、300 local references検査成功。receipt：`/private/tmp/fm2612-psg-live-package-20261110.json`。README英語／日本語とpackaging更新済み。未commit／未push／未公開。

## 完了：PSG Software Envelope

ユーザー指示：PSGへSoftware Envelopeを追加し、ソフトウェア機能だと画面から分かるようにする。

- [x] 初期値OffのAttack／Decay／Sustain／Releaseを追加し、Tone／Noiseへ適用する。実機にADSRがないこととソフトウェアによる音量制御であることを明記する。
- [x] 共通のコンパクトなドラッグ数値UIを使い、鍵盤focus・hardware Attenuationの表示と役割を維持する。
- [x] AudioWorklet内で時間を進め、実機4bit減衰registerを制御する。Main threadのtimer／描画更新に依存せず、独立した各音のrelease・再発音／voice steal・stop／音源切替／disposeを扱う。DSP／WASM／校正値とFM経路は変更しない。
- [x] PSG JSONへ保存する。既存version 1音色はEnvelope Offとして読み込める互換性を保ち、Sync／Revert／Cassette／復旧と不正入力拒否を検証する。
- [x] 実WASMのADSR時間変化、Envelope Off時の従来音一致、Tone／Noise、Release中の再発音と全消音を自動確認する。Chromium／WebKitで操作・実音・保存復旧・狭幅表示とFM回帰を確認する。
- [x] README／cache key／配布ZIP／再開用記録を更新する。commit／push／公開は行わない。

実装：常時見える`Software Envelope`見出しと`Software control · not a hardware PSG envelope`の説明を追加し、On時だけADSR controlsを展開する。既存FMの数値factoryは変更せず再利用。Attack／Decay／Releaseは0〜5000ms、Sustainは0〜100%。初期値はOff／10ms／180ms／70%／180ms。ADSR編集は次の発音から、On／Off切替はheld notesとrelease tailsを停止する。Attenuationは基準となるhardware値のままで、Envelope中とRelease中にも即時反映する。

音声：Synth専用Workletとpure envelope helperを追加した。約1msのsample-clock単位で線形ADSR levelを実機2dB刻みの減衰値へ変換し、PSG registerへ書く。音量の外付けGainNodeでADSRを作らない。各Note OnのADSRをsnapshotし、独立したRelease・再発音・voice steal・source／tab変更・disposeで旧Envelopeを残さない。音量writeがPSG内部latchを変えるため、継続するfrequency high byteの送信先registerを保持して復元する。Envelope Offは従来のraw writeとPCMを保ち、共有PSG API／Worklet／DSP／WASM／校正値は変更しない。

保存：canonical PSG JSONはversion 2として完全な`envelope`設定を含む。version 1の4設定はOffへ移行して読み込み、元bytesとcheckpointは明示的な編集まで保持する。legacy IndexedDBの直接snapshotにもnormalizerを通し、以前のOn状態を継承しない。JSON／Sync／Revert／Cassette／即時journal復旧、入れ子の不正値・未知fieldの原子的拒否を確認した。

検証：`node --test --test-concurrency=1 docs/synth/*.test.mjs`で229件成功。実WASMでOff PCMの完全一致、Tone／Noise ADSR、127／128等render分割のPCM一致、独立Releaseと全消音、private Workletのlatch復元・reset／disposeを確認。source／配布版のChromium・WebKitでSoftware表記・初期Off・ADSRの実mouse drag／±・focus状態の鍵盤・実音のAttack→Decay→Sustain→Release・独立tone・Noise Release・Off時の尾音停止・v1読込→v2保存・JSON／Cassette／Reload／Sync／Revert・不正Envelopeの不変性・390／1240px表示を確認した。speaker edgeは物理muteした自動計測で、人の実聴とは区別する。

記録：`/private/tmp/fm2612-psg-envelope-node-20261110.log`、`/private/tmp/fm2612-psg-envelope-source-20261110.json`（105 assets）、`/private/tmp/fm2612-psg-envelope-package-browser-20261110.json`（103 assets）。各receiptの全asset hashが最終ファイルに一致。entry／private dependencyのcache keyは`psg-envelope-1`。

FM回帰：最終stageのChromium／WebKitでVGM seek／bounded cache／Live／paused audition／取消・source切替も成功。receipt：`/private/tmp/fm2612-psg-envelope-seek-20261110.json`。

確認用ZIP：`release/hello_ymfm_wasm_psg-envelope-check-20261110_itch_synth.zip`（229 files、860,858 bytes、SHA-256 `f3318c5ae5918be0c4a8efdf7199d45af5d979d1c26af5ad39d9fed43969695b`）。全fileがstageとbyte一致、294 local references検査成功。receipt：`/private/tmp/fm2612-psg-envelope-package-20261110.json`。README英語／日本語とpackaging更新済み。未commit／未push／未公開。

## 完了：PSG音色のFiles／Cassette保存

ユーザー指示：PSG音色の保存・読み込みを進め、Files／Cassetteへ保存して開くとPSGタブへ切り替える。

- [x] 読みやすいversion付き`.psg.json`形式でSource／Attenuation／Noise type／Noise clockを保存・検証する。未知の形式や不正値で現在の音・ファイルを壊さない。
- [x] Filesの選択・新規作成・Sync／Revert・Duplicate／Rename／Delete／UndoとPSGを接続し、開くと対応する音源タブへ切り替える。FMとPSGの編集中の音・保存先を混同しない。
- [x] 元のTFI／VGIとsidecarの互換性を維持し、PSG単体のimport／exportと混在Cassetteの往復へ対応する。
- [x] IndexedDBの再開と即時recoveryへPSGを含める。タブ切替・保存待ち・読込失敗・古い非同期処理で他音色を上書きしない。
- [x] Nodeでschema／project／recoveryを検証し、Chromium／WebKitで保存・再読込・混在Files／Cassette・実音・FM回帰・狭幅表示を確認する。
- [x] README・cache key・配布ZIP・検証記録を更新する。既存のユーザーstaged変更を保持し、commit／push／公開・Tauri更新はしない。

作業開始時、直前のAttenuation変更4ファイルはユーザーによりstaged済み。indexを変更せず、作業を重ねる。

実装：version 1／kind `tetorica-sega-psg`／settings（source・attenuation・noiseType・noiseRate）の完全なJSONを単一text fileへ保存する。PSGにはFM用sidecarを作らない。追加・読み込み・snapshot／Cassette復元・checkpointも厳密に検証し、未知のversion／不足field／不正値を原子的に拒否する。Files controllerはFM／PSG別に音色・保存先・baselineを持ち、旧音色のjournalをIndexedDBへ確定してから切り替える。新規・Sync／Revert・複製／名前変更／削除／Undo、単体import／export、混在Cassette、即時journal復旧へ接続した。読み込みエラーは両chipで見える共通位置へ移した。

UI：共通のファイル名・Sync／RevertをPSGでも表示。PSGにはFMと同じcompact preset行だけを追加し、独立したSaveボタンは増やしていない。ファイルを選ぶと対応chipへ切替、FM／PSGタブ往復はそれぞれの編集音色と保存先を保持する。VGMのLive表示はdocument所有権を変更せず、終了後にPSG編集へ戻る。演奏イベントは保存操作にせず、GUIで音色設定を変えた時だけ編集する。最初のブラウザ検証で「ファイル選択直後のReloadで旧選択へ戻る」ケースを検出し、selectFile／selectPresetが保存完了を待ってからbusyを解除するよう修正、即Reloadの回帰テストを追加した。

検証：`node --test --test-concurrency=1 docs/synth/*.test.mjs`で210件成功（従来193件＋PSG codec／project／recovery 11件＋Files controller 6件）。ブラウザ並列実行中の別runでは既存32X PWMの初期buffer数assertionが一度失敗したため、上記の直列runで全件を確認した。source／最終stageのChromium・WebKitでPSG新規・Sync／Revert、独立FM／PSG context、JSON入出力と不正入力の不変性、compound suffixのCRUD／Undo、即Reload recovery、混在Cassetteと元FM／opaque bytes保持、実PCM出力と演奏だけではdirtyにしないこと、preset select後のfocus解除、390／1240px表示を確認した。減衰の実pointer drag・保持音−4dB・capture解除も両browserで成功。最終stageでVGM seek／cache／Live／paused audition／キャンセルの回帰確認も両browser成功。すべてspeaker edgeを物理muteした自動計測で、人の実聴とは区別する。

記録：`/private/tmp/fm2612-psg-storage-node-20261110.log`、`/private/tmp/fm2612-psg-storage-source-20261110.json`（105 assets）、`/private/tmp/fm2612-psg-storage-package-browser-20261110.json`（103 assets）、`/private/tmp/fm2612-psg-storage-seek-20261110.json`。source／配布版の保存検証receiptにある全asset hashは最終ファイルに一致。cache keyは`psg-presets-1`。共有controls factory／DSP／WASM／校正値は変更していない。

確認用ZIP：`release/hello_ymfm_wasm_psg-storage-check-20261110_itch_synth.zip`（227 files、855,115 bytes、SHA-256 `6dd0dcdfaf3c004c641173d24832614e6fc5aa57c5c318f3ad9a06d0541100d5`）。全fileがstageとbyte一致。receipt：`/private/tmp/fm2612-psg-storage-package-20261110.json`。README英語／日本語とpackagingにPSG保存を反映済み。元のstaged差分を保持し、新規差分は未stage／未commit／未push／未公開。

## 完了：AttenuationのFM共通ドラッグ操作

ユーザー指示：FMの数値コントロールと同様に、Attenuationを押したまま左右へ動かして変更したい。

- [x] 既存`createParamControl`をPSG減衰にも使い、中央の数値ドラッグと±操作を共通化する。共有factory自体は変更しない。
- [x] 0〜15の範囲、保持中の即時反映、音名キーの入力、既存のコンパクトな表示を維持する。
- [x] Chromium／WebKitで実pointer操作と保持音の変化を確認し、配布ZIPの参照と表示も確認する。cache keyと検証記録を更新する。commit／push／公開はしない。

実装：PSG独自のoutput表示を、変更していないFM共通`createParamControl`へ置き換えた。数値中央は160pxで全範囲の水平ドラッグ、±とwheelは共通factoryに任せ、PSG側で重複加算しない。valueを作り直さず`updateVisual()`で同期し、保持音更新中のpointer captureを保つ。touch-action・lost captureの見た目・Space／Enterと音名キーをPSG側で扱う。配布ZIPは284 referencesの検査を含め生成成功。source／配布版のChromium／WebKit確認も成功。

検証：実mouseで80px→8／160px→15、逆方向→0、上下限clamp・±各1回・pointerup／cancel／capture loss後の解除を確認した。保持音を6→8へdragして実PCMが約−4dBとなり、pitch registerやkey所有権が変わらないこと、数値へfocusした状態での音名キーも確認。390／1240pxの表示と音源往復時の値保持も確認した。原factory・DSP・WASM・校正値は変更していない。

記録：`/private/tmp/fm2612-psg-drag-source-20261110.json`と`/private/tmp/fm2612-psg-drag-package-browser-20261110.json`。全served asset hashが最終source／stageに一致。出力端を物理muteした自動計測で、人の実聴とは区別する。

確認用ZIP：`release/hello_ymfm_wasm_psg-drag-check-20261110_itch_synth.zip`（226 files、851,028 bytes、SHA-256 `af9eee119128e5d1089cba6e2fc37d47d61e654ef62e101280ff17ca8ca95b31`）。全fileがstageとbyte一致。receipt：`/private/tmp/fm2612-psg-drag-package-20261110.json`。entryとPSG controls importのcache keyは`psg-attenuation-drag-1`。未commit／未push／未公開。

ユーザー指示：試作したPSGタブにTone／Noise・音量・Noise clockを入れ、演奏できるよう進める。

## 今回：完了

- [x] PSGタブへTone／Noise・実機Attenuation 0–15・White／Periodic・Noise clockの3固定段階／Tone3連動を追加する。selectを使わず、既存と同じボタン操作にする。
- [x] Toneは物理CH1–3のラウンドロビン、Noiseは物理CH4の単音にする。Tone3連動NoiseはCH3の周期を使い、CH3自体は無音にする。鍵盤・Octave・Pitchを既存UIへ接続する。
- [x] 既存のstandalone PSG Worklet／APIを遅延初期化する。独立branchを共通final busへ接続し、共通PSG補正とMasterを一度だけ適用する。既存FMの音・gain・保存値を変えない。
- [x] Source／音源タブ切替・blur・出力変更・pagehideで保持音を止め、初期化中の切替や離鍵後に遅れて発音しないようにする。Attenuation／Noise設定は保持音へリアルタイム反映する。
- [x] PSGのWaveform／Spectrumを表示し、Mod wheelなどFM専用操作は区別する。今回のPSG設定はsession用と表示し、FMのTFI／VGI SyncやFM専用Looper／Event Recへ誤保存・誤録音しない。
- [x] VGM模範演奏を維持する。PSGタブでは鍵盤対象をSynthへ揃え、VGMのFM CHを選んだ時はYM2612画面へ戻す。seek中の鍵盤禁止を維持する。
- [x] pure／実WASMで周期・16段階音量・両Noise・Tone3 clock・消音を確認し、Chromium／WebKitで鍵盤・保持音変更・Master／Pitch・切替・FM回帰・390px表示を確認する。
- [x] 配布ZIPのmodule closure／実browser、cache key、READMEと記録を更新する。commit／push／公開・Tauri更新はしない。

## 後続候補（今回の基本演奏とは分ける）

- [ ] PSG音色のFiles／Cassette保存・復元。
- [ ] VGMからのPSG音色選択・Live表示・取り込み。
- [ ] Software Envelope／Software Pitch Envelope（ソフト側のレジスター制御であることを明示）。
- [ ] PSGのLooper／Event Rec対応。

実装は新しいPSG voice／controls helperと既存Synthへの接続に分ける。共有SDK・DSP・WASMや共通音量校正reportは変更しない。

## 実装・再開記録

- 新しいpure voice `synth_psg.js`は既存`SegaPSGSynth` APIへ音程／減衰／noise writeを送る。8 tests成功。実WASMで矩形波周期・octave／Pitch・保持音の4dB変化・固定clockと鍵盤の独立性・Tone3 periodic noiseのoctave比・Note Off／全消音を確認した。
- `synth_psg_audio.js`は既存standalone PSG Workletを初回PSG演奏時だけ作り、校正PSG gain×MasterのGainNodeからfinalOutputBusへ接続する。6 lifecycle tests成功。無効化・準備中断・旧routeの遅延完了・runtime error・再試行・disposeを確認した。FMのMegaDriveSynthへPSGを有効化すると従来FM trimが変わるため、その経路は変更していない。
- PSGのsettingsはTone／Noise・attenuation 6既定・white・clock/1024既定。ToneはCH0–2のラウンドロビン、NoiseはCH3単音。共通入力のvoice ownershipを切替時にクリアして、盗まれた旧keyの離鍵が新noteを止めないようにする。
- PSGタブはWaveform／Spectrumと簡潔な実機controlsを表示。実機説明は?へ置き、session設定であることを表示した。FM file heading／Sync・FM export・Mod wheel／FM recordingを区別し、PSG操作ではFM presetや録音commandを書き換えない。FilesからFMを編集する際はYM2612を選ぶ案内を出す。
- PSG選択はVGMの鍵盤targetをSynthへ揃え、VGMのFM CH選択はYM2612タブへ戻る。VGMのtransport・Mix・Masterは維持し、seek中の入力禁止も維持する。PSGの鍵盤ではFM用BLOCK／FNUM表示を隠す。
- `node --test docs/synth/*.test.mjs`：193件成功。`sh scripts/package_itch_synth.sh genesis-psg-check-20261110`：283 local referencesを含め成功。stage：`release/itch_synth_genesis-psg-check-20261110`。最終source／配布版の実音声とFM回帰も確認した。

- 最終sourceと配布stageのChromium／WebKit（4ケース）で、3音ラウンドロビン・4音目のstealと古い離鍵、1CH Noiseの所有権、White／Periodic、固定clockの音程／Pitch独立性、Tone3の16-step periodic noiseとoctave比、押しっぱなしのattenuation 6→8（約−4dB）／15消音、Master 0／100／200%の1回適用を実PCMと送信registerから確認した。
- Source／chip tab／blurでの消音、PSG WASM読み込み遅延中にYMへ戻った場合の遅延発音防止、FM patch／recording操作の復帰、PCM／PWMの工事中表示、selectに依存しないfocus中の音名キー入力も確認した。
- VGM再生中／Pause中のPSGとFM CHの切り替えを追加確認した。PSGはSynth targetを選び、FM CHの選択はYM2612タブへ戻り、VGMの再生状態と位置は継続する。既存の前後seek／cache／Pause試奏／Copy／取消checkerも両browserで成功した。
- 1240／390pxの画像を確認。PSG canvasにはResizeObserverで表示幅を反映し、狭幅でも軸文字を変形させない。毎frameのlayout測定や新しい描画timerは追加していない。音声出力は物理muteした自動計測であり、人による実聴とは区別する。
- 最終receipt：`/private/tmp/fm2612-psg-source-browser-20261110.json`、`/private/tmp/fm2612-psg-package-browser-20261110.json`、`/private/tmp/fm2612-psg-fm-seek-regression-20261110.json`、`/private/tmp/fm2612-psg-vgm-target-browser-20261110.json`。全served asset hashが最終source／stageと一致。
- 最終ZIP：`release/hello_ymfm_wasm_genesis-psg-check-20261110_itch_synth.zip`（226 files、850,806 bytes、SHA-256 `6e6840bc3b7f748ad323fa807d5153bb708755b889e0d0e00490626066aa5f58`）。全fileがstageとbyte一致。receipt：`/private/tmp/fm2612-psg-package-20261110.json`。
- entry／新helper／song target helperのcache keyを`genesis-psg-1`へ更新。README英語／日本語と、193件のFM／PSG Node testsをitch-web CIへ追加した。`git diff --check`成功。共有SDK／DSP／WASM／校正値は変更せず、npm公開・commit／push・itch公開・Tauri更新もしていない。
