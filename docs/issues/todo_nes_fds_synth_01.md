# Tetorica 2A03 Synth

2026-11-04開始。FM2612／DMG／SPU Synthと同じ操作の流れで、NES APUとFDSの音作りを触って理解し、プリセット・JavaScriptとして持ち帰れる独立したブラウザーSynthを作る。

現在の製品名は **Tetorica 2A03 Synth**（`tetorica-2a03-synth`）、正本は`docs/synth-2a03/`。以下のNES名・旧ZIP名は当時の実装・検証記録として残す。

## リリース記録

- 2026-11-04：ユーザーより **Tetorica 2A03 Synthをリリース済み** と報告。
- 2026-11-04：ユーザーより **VGM／VGZ音色読込版も動作確認・リリース済み** と報告。
- 下記の「公開は未実行」などは各作業・検証時点の履歴で、現在の公開状態を示さない。VGM音色読込と、今回追加したDMC／DPCM読込は下記を参照。音声からのDPCM変換、VGM DMC抽出、Tauri版は後続TODOとして残す。

## DMC／DPCMサンプル読込（2026-11-04 完了・追加分は未公開）

VGM音色読込版のリリース後の次の作業。既にエンコードされたDPCMサンプルを読み込み、既存のNES DMC回路で鍵盤から試す。音声ファイルのDPCM変換、VGMからのDMC抽出、曲再生は後続とする。

- [x] 既存DMC APIと実WASMのlength／rate／loop／level／停止挙動を確認し、共有DSPを変えずに接続する。
- [x] DMCを5番目のSound sourceとして追加し、同じサンプルを1chで再triggerする。鍵盤の音階とPitchではrateを変えない。
- [x] 1..4081 bytesのDPCM読込、hardware長へのpaddingの説明、rate 0..15／loop／initial level 0..127を既存stepper・button UIへ追加する。
- [x] 旧プリセットを読み込める形で、サンプルbytesを含む保存・再読込・JavaScriptコピーを追加する。
- [x] 不正・過大ファイルや古い非同期読込から現在の音色を守る。サンプル変更・停止・置換後の古い離鍵・one-shot終了を検証する。
- [x] 自作DPCMと実WASM、Chromium／WebKit、独立ZIPで発音・rate／loop・Focus・export・停止を確認する。
- [x] ガイド、英日AI README、日英ホーム、検証結果と次のTODOを更新する。

実装：`preset.js`へversion 2と`dmc:{data,rate,loop,level}`を追加し、旧version 1は厳密に検証してversion 2へ移行する。元の最大4081 bytesを保存し、実行時だけ`0xaa`で16×n+1 bytesへpaddingする。version 2保存物は旧リリースでは読めない。Copy JavaScriptは`await nes.dmc.loadSample(...)`→`nes.dmc.play(...)`を生成する。

`instrument.js`は既存の同期DirectTransportとmemory／register APIを使用し、Workletの命令順序と共有DSP／runtime／WASMを保つ。DMCはCH5（index 4）1chで、音階やPitchはrateを変えない。Rate／Loopは即時、Initial levelは次のtriggerに反映する。one-shotが終わっても保持キーの所有権を残し、新しいtrigger・離鍵・停止で更新する。残りbytes 0だけを見て最終byteを切らない。off/on時の途中byte継続は共有coreの挙動を保ち、全core resetで隠さない。離鍵・Stop all soundではソフト側の停止方針としてDAC levelも0にする。

UI：Source→DMCに`Load DPCM…`、`Demo sample`、`Cancel load`、既存形式のstepperとLoop checkboxを追加。自作257-byte demoはソフトで生成したデータと表示する。読み込みではAudioContextを作らない。空DMC draftは読込案内を出して鍵盤を無効にする。bit rate（約4.18–33.14 kbit/s）とpadding込みの概算時間を表示し、通常のPCM sample rateとは区別する。古い非同期読込は新しいファイル・Demo・source変更・その他の編集で無効になる。不正／空／過大／通常の音声ファイルやキャンセル時は現在の音色を保つ。

検証：`npm run test:2a03-synth`は**49件成功、失敗0**（既存40件＋preset 2件＋DMC実WASM 7件）。44.1／48 kHzで発音、1-byte／4081-byte境界、32→33-byte padding、独立したサンプルbytes、rateによる長さ変化、loop、終了／再trigger、古い離鍵、DAC停止を確認した。最終ソース版と独立ZIPは双方**Chromium／WebKitで成功**。既存VGM／FDSに加え、無音の読込・Focus・競合／キャンセル／Demoによる無効化・サンプル交換・v2保存／コード・v1移行も確認した。390 pxでoverflow 0、ページエラー／欠落asset／外部requestは0、物理音声出力はmute。記録：[ソース版](2a03_synth_dmc_browser_01.json)、[ZIP版](2a03_synth_dmc_zip_browser_01.json)。DMCのモバイル画面も確認済み。

配布候補：`sh scripts/package_itch_2a03_synth.sh dmc-20261104`で`release/tetorica_2a03_synth_dmc-20261104_itch.zip`を作成（35 files、3 bundles、1,136,707 bytes、SHA-256 `c576d4f15830aa3de258f36205179d420750fe3143f51cc75b8783d490ee7f8a`）。browser receiptの40 inputsは作業ファイルと一致し、元WASM pair／Native対応ソース11 inputs／権利通知を保持する。共有runtimeの変更やnpm更新は不要。ガイド・英日AI README・日英ホームも更新した。

次は手元の実DPCMで実聴確認。音声からのDPCM変換とVGMからのDMC抽出は未実装。今回追加分のcommit／push／公開は未実行。ローカルURLは`http://localhost:8008/synth-2a03/index.html`。

## VGM／VGZ音色読込（2026-11-04 完了・リリース済み）

ユーザーの希望でDPCM単体読込より先に進める。DMG版と同じ「ファイル読込→音色選択→鍵盤試奏→編集・保存・JavaScript」の流れを2A03へ追加する。

- [x] 既存parserを再利用し、Pulse／Triangle／Noise／FDSの記録された初期設定を既存プリセットへ変換する。
- [x] FDSのWave RAM・変調table・音量／depth／rate／biasを扱い、未知のRAMを記録済みとして補わず、近似値は明示する。
- [x] 現在のSynthで再現できないEnvelopeや時間変化、DMC、非標準clock等は明示し、近似値を使う場合は音色ごとに説明する。
- [x] DMGと同じ音色一覧・音源filter・page・cancelを接続し、読み込みだけでは演奏・現在の音色を変更しない。
- [x] 不正／未対応ファイル、キャンセル、古い非同期読込から現在の楽器とlibraryを守る。
- [x] 自作VGM／VGZ fixture、実WASM、Chromium／WebKit、配布ZIPで検証する。
- [x] README・CI依存パス・検証結果・残作業を記録する。

`vgm_import.js`は既存のVGM parser／raw command walkerを再利用し、VGM／展開後VGZを各64 MiBまで解析する。PulseはDuty／音量／Envelope／Sweep、Noiseはperiod／mode／音量、FDSは記録された64点Wave RAMと32命令modulation、6-bit depth／rate／signed biasを既存プリセットへ変換する。DMCと曲再生は追加していない。

読み込みだけではAudioContextを作らず、楽器と保持中の音を変えない。一覧を選ぶと編集画面へ適用し、鍵盤・保存・JavaScriptコピーへ進める。24件単位のページと音源filter、キャンセルを用意した。選択音色の近似説明は常時表示し、ファイル全体の注意事項は`File notes`へ折りたたむ。表示のmatchesは同じ設定の捕捉回数で、曲中のノート数とは区別する。

FDSの不完全なWave RAMや、有効だが不完全な変調tableは音色として採用しない。無効な変調に完全な記録がない場合は、中立tableを使うことを説明する。Noise EnvelopeやFDSの時間変化するEnvelopeは静的な近似を明記し、変調phase／counterは試奏時に再開する。Envelope停止中のgain 0、後から開くvolume／frequency gate、動作後の変調table書込位置も検証した。

検証：`npm run test:2a03-synth`は**40件成功、失敗0**（既存25件＋抽出15件）。自作fixtureから抽出した5音色を実WASMで発音し、VGZ、他chip blockの透過、不正データ、上限、abortも確認した。最終ソース版・独立ZIPは双方**Chromium／WebKitで成功**し、filter／ページ送り／近似説明／保存／keyboard focus、失敗・キャンセル後の保持を確認した。390 pxでoverflow 0、ページエラー／欠落asset／外部requestは0。物理音声出力はmuteして測定した。記録：[ソース版](2a03_synth_vgm_import_browser_01.json)、[ZIP版](2a03_synth_vgm_import_zip_browser_01.json)。最終ZIPのモバイル画面も確認済み。

最終配布候補：`sh scripts/package_itch_2a03_synth.sh vgm-import-20261104-r2`で作成した`release/tetorica_2a03_synth_vgm-import-20261104-r2_itch.zip`（35 files、3 bundles、1,129,116 bytes、SHA-256 `dfdca555721702dc5a1daefb85347ad3ead527f1114c26432505ac5a566e11d1`）。browser receiptの40 inputsは作業ファイルと一致し、元WASM pair／対応ソース11 inputs／権利通知を保持する。先の`vgm-import-20261104` ZIPはFDS Envelope停止条件の最終修正前なので、このr2を使用する。

共有DSP／runtime／WASM／プリセット形式は変更していない。英日AI README・日英ホーム・Synthガイド・CIのparser依存パスも更新した。実ゲームデータとの実聴比較は次の手動確認。今回追加分のcommit／push／公開は未実行。ローカルURLは`http://localhost:8008/synth-2a03/index.html`。

## 2A03への命名・アイコン（2026-11-04 完了）

- ユーザー指定の製品名：`Tetorica 2A03 Synth`。NES APU + FDSをサブタイトルとして残す。
- [x] 正本を`docs/synth-2a03/`へ移し、旧`/synth-nes/`の入口を保つ。
- [x] 既存シリーズに揃えたグレー・赤のアイコンをimagegenで生成し、プロジェクト内へ保存する。
- [x] 表示名、favicon、日英ホーム、英日AI README、配布ZIPとコマンドを2A03へ揃える。
- [x] 既存NES API／WASMとプリセット形式を保ち、unit・Chromium／WebKit・独立ZIPで検証する。

内蔵`image_gen`でアイコンを生成した。原本は`docs/tetorica_2a03_synth.png`（1254×1254）、Web用はlossless変換した`docs/tetorica_2a03_synth.webp`。元の生成結果も残している。使用した最終promptは[tetorica_2a03_icon_prompt_20261104.txt](tetorica_2a03_icon_prompt_20261104.txt)。グレーの筐体、深い赤の2A03、矩形波・三角波・変調波、`NES APU + FDS`の表示に揃えた。

`npm run test:2a03-synth`は25件成功。ソース版と独立ZIPは双方Chromium／WebKitで成功し、製品名、1254px正方形アイコンの読込、WebPのbytes一致、favicon／Apple icon、旧URLのquery／hashを保った移動、発音・描画・Focus・保存を確認した。390 pxでoverflow 0、画面も確認済み。記録：[ソース版](2a03_synth_branding_browser_01.json)、[ZIP版](2a03_synth_branding_zip_browser_01.json)。

正規コマンドは`sh scripts/package_itch_2a03_synth.sh VERSION`、`npm run test:2a03-synth`、`npm run test:2a03-synth:browser`。旧NESコマンドは互換aliasとして残す。新ZIPは`release/tetorica_2a03_synth_branding-20261104_itch.zip`（35 files、3 bundles）。元WASM pair／対応ソース／Apache-2.0・MIT通知を保持し、browser receiptの35 inputsも作業ファイルと一致した。プリセットの`tetorica-nes-fds-voice`形式とaudio processor identifierは変更していない。CIは`.github/workflows/2a03-synth.yml`。

新しいローカルURLは`http://localhost:8008/synth-2a03/index.html`。今回のcommit／push／公開は未実行。

## 初版の範囲

- 初版実装時の仮の製品名は`Tetorica NES + FDS Synth`、旧配置は`docs/synth-nes/`。現在の製品名・配置は上記の2A03を参照する。
- 1台のNTSC NES APU＋FDSを使用する。Pulseは2chのラウンドロビン、Triangle／Noise／FDSは各1ch。鍵盤は選択した音源を全域で演奏し、最も古いノートを置き換える。古い離鍵で置換後の音を止めない。
- PulseのDuty／音量／Envelope／Sweep、Triangle、Noiseのperiod／mode／音量、FDSの64点6-bit波形／音量／変調table・rate・depth・biasを編集できるようにする。
- FDSの波形と変調をUIから試し、波形の再生周波数にどう作用するかを説明する。Yamaha式のOP構成・algorithmとしては扱わない。
- UIは既存Synthと同じMaster 0–380%、実出力モニター、2箇所のPitch、Octave、共通鍵盤、フォーカスを奪わない選択ボタン・数値ステッパーに揃える。
- 既存Native／WASM／Synth APIを再利用する。共有DSP・既存Synthを変更しない。音源の初期化と権利表記・対応ソースは配布ZIPでも自己完結させる。
- DMC／DPCMとVGM音色library読込は後続段階とし、初版はPulse／Triangle／Noise／FDSの独立Synthを完成させる。曲再生・自動伴奏・シーケンサーは対象に含めない。

## 作業

- [x] TODO、音源別の発音方式と初版の範囲を記録する。
- [x] 厳密なプリセット形式、再利用コード生成、音源別allocatorと所有権・Pitchを実装する。
- [x] 既存WASMを使うAudioWorkletと遅延初期化、Master、失敗後の再接続を用意する。
- [x] 既存Synthに揃えた画面と、Pulse／Triangle／Noise／FDS編集、波形・変調table描画を実装する。
- [x] 鍵盤、モニター、保存／読込、JavaScriptコピー、Playground／APIへの導線を接続する。
- [x] 実WASMで各音源・Envelope／Sweep／FDS変調・発音所有権・停止・Pitchとプリセット検証を行う。
- [x] Chromium／WebKitでソース版と独立ZIPを検証し、狭い画面・Focus・音声失敗を確認する。
- [x] 配布コマンド、CI、日英ホーム／READMEの入口と検証記録を整備する。

## 初版の実装・検証結果（2026-11-04）

- 初版の配置は`docs/synth-nes/`（現在の正本は`docs/synth-2a03/`）。`preset.js`／`instrument.js`／`audio.js`／`processor.js`／`editor.js`／`synth.js`に分け、DMGと共通の鍵盤・受動的モニターとSPUの基礎CSSを再利用した。この時点では仮の製品名で、専用アイコンは未決定だった。
- PulseはSweepを有効にしても2chを使う。Triangle／Noise／FDSは1ch。置換した古いキーの離鍵は現在の所有者を止めない。Noiseは音階非追従で両Pitch wheelを無効にする。
- FDSのWave／Modulationは1つのcanvasで編集対象を切り替える。Waveは64点・0..63、Modulationは32命令・`0,+1,+2,+4,Reset,−4,−2,−1`。波形はfreehand、変調は命令brushで描画し、releaseで適用する。shape／table presetも即反映。中断したstrokeは破棄する。
- FDSは初期modulation Offだが、非ゼロのtable・rate・depthを設定済みなのでOnにするだけで変化する。rate／depth／bias／volumeは保持中にも変更でき、tableは不用意に書き直さない。table／wave変更は保持ノートを停止する。
- PulseのEnvelope／Sweep編集は次回triggerで反映。Pitchでは不要なtimer上位byte書込を避けるが、境界を越えた場合は共有coreのEnvelope／length counterへの副作用を再現する。Triangleの許容範囲も、実coreが無音になるperiod 8未満を避ける。
- `npm run test:nes-synth`は**25件成功、失敗0**（engine 23件＋package 2件）。44.1／48 kHzの全音源、FDS modulationによる実PCM周期変化、所有権、プリセット原子性、初期化失敗／再接続、URL／Node globalsなしの実Workletを確認した。
- ソース版・ZIP版とも**Chromium／WebKitで成功**。4音源の実出力、Pulse RR、2つのPitch・spring、Focus、Master mute／380%、canvas適用、保存・読込・不正データ、再接続を確認した。FDS modulation Onで正規化した出力spectrum分布が変わることも測定した。390 pxでoverflow 0。ZIPの最終画面では変調brushを4列×2段に揃え、ラベルとcanvasの軸も確認した。検証中の物理出力はmute。
- 記録：[ソース版](nes_fds_synth_browser_01.json)、[ZIP版](nes_fds_synth_zip_browser_01.json)。画像は`/private/tmp/nes-fds-synth-source-images`と`/private/tmp/nes-fds-synth-zip-images`。
- `sh scripts/package_itch_nes_synth.sh preview-20261104`で`release/tetorica_nes_synth_preview-20261104_itch.zip`を作成（34 files、3 bundles）。元のNES WASM pair、Nativeの対応ソース11 inputs、Apache-2.0／MIT通知、browser inputs archiveを同梱。browser receiptの34 inputsは作業ファイルと一致した。既存ZIPの上書きは拒否する。
- `.github/workflows/nes-synth.yml`を追加し、unit→ZIP→実browser検証を接続した。日英ホーム、英日README、英語AI READMEにも入口を追加。共有DSP／runtime／WASMは変更していない。
- ローカル確認URLは`http://localhost:8008/synth-nes/index.html`。今回の確認では`python3 -m http.server 8008 --bind 127.0.0.1 --directory docs`を起動し、タイトルが返ることを確認した。サーバー停止時は同じコマンドで再開できる。
- commit／push／npm更新／itch.io公開／リモートActionsは未実行。次は手元での実聴と、必要に応じて専用名・アイコンを決める段階。

## 後続

- [x] DMC：既エンコードDPCMのファイル読込、rate／loop／level、鍵盤からのtrigger（上記2026-11-04の追加作業）。
- [ ] 手元の実DPCMファイルで実聴し、Rate／Loop／Initial level、離鍵と再triggerを確認する。
- [ ] 音声ファイルからDPCMへの変換。既存APIにPCM encoderはないため、別途仕様・検証を用意する。
- [ ] VGM／VGZのDMCサンプル抽出。CPU RAM blockと再生address／length／rate／loop／initial levelを追い、現在のDMCプリセットへ取り込む。
- [x] VGM／VGZのNES／FDS音色library抽出と、初期設定からの試奏。既存の音符抽出と音色抽出を区別する（上記2026-11-04の追加作業）。
- [ ] 実ゲームVGM／VGZの音色を選び、原曲と聴き比べる。静的な初期設定読込と時間変化の違いを確認する。
- [ ] FDS／Triangle／Noiseの追加Envelope／length counter編集を段階的に検討する。
- [ ] 2A03の製品名・アイコンを使って、Tauri版と配布を整備する。

## 再開時

まずこのTODOと`git status`を確認する。実装途中のファイルを上書きしない。commit／push／公開はユーザーの指示に従う。
