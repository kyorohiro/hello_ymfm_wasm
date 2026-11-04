# Tetorica DMG Synth

2026-11-04 初版実装・ローカル検証完了。FM2612／SPU Synthをベースに、Game Boyの音作りを触って理解し、プリセットとJavaScriptとして持ち帰れる独立したブラウザーSynthを作る。

現在の製品名は **Tetorica DMG Synth**（`tetorica-dmg-synth`）、正本は`docs/synth-dmg/`。以下の初版・旧ZIP名は当時の検証記録として残す。

## itch.io 初回リリース（2026-11-04）

- [x] ユーザーが **v0.0.1** をitch.ioへ公開したと報告。
- 製品ページ：[Tetorica DMG Synth](https://kyorohiro.itch.io/tetorica-dmg-synth)。
- 公開devlog：[v0.0.1 First release — Game Boy 4-channel sound synth](https://kyorohiro.itch.io/tetorica-dmg-synth/devlog/1751766/v001-first-release-game-boy-4-channel-sound-synth)。
- 初版の公開は完了。下記の「未公開」「公開は未実行」は各検証時点の履歴で、現在の公開状態を示さない。後続候補は「後続」を参照する。

## 初版の方針

- ユーザー指定でラウンドロビン方式を採用する。鍵盤を音域で分割せず、選択したPulse／Wave／Noiseの音色を全鍵盤から演奏する。
- 初版は1台のAPUを使用する。PulseはCH1／CH2の2音、WaveはCH3の1音、NoiseはCH4の1音。同種の空きチャンネルを優先し、満杯なら最も古い発音を置き換える。置き換え前のキーの離鍵は、新しい発音を止めない。
- ハードウェアSweepはCH1専用。Sweepを有効にしたPulseは1音に限定し、UIにも容量を表示する。Noiseの鍵盤は発音／停止用で、音階には追従しない。クロックとLFSR幅で質感を変える。
- Game Boy本来のDuty／Envelope／Sweep／Wave RAM／Noiseを扱う。鍵盤割り当て、Pitch wheel、プリセット、波形描画はソフト側の操作支援として説明する。APUの複数台化による多声音化は後続候補。
- 元の共有runtimeとWASMは再利用し、FM2612／SPUの音声処理や配布物を変更しない。

## 作業

- [x] TODOと発音方式、共有runtimeとの境界を記録する。
- [x] 検証可能なプリセット形式、音源別allocator、発音所有権、Pitch、停止処理を実装する。
- [x] AudioWorkletと遅延初期化、失敗時の再接続、Master 0–380%を接続する。
- [x] 共通の外観、Pulse／Wave／Noise編集、単一波形canvas、コンパクトな鍵盤、Octave、Pitch、実出力モニターを実装する。
- [x] プリセット保存／読込、波形の即反映、JavaScriptコピー、Playground／APIへの導線を追加する。
- [x] 実WASMによる所有権・発音・プリセット検証と、Chromium／WebKitでUI／音声／focus／狭い画面を確認する。
- [x] 独立したitch.io ZIP生成と配布物の検証を用意する。
- [x] 日英ホームとREADMEに、確認済みのGame Boy Synthへの入口を追加する。

## 検証結果

- 入口は`docs/synth-gameboy/index.html`。既存の共有Game Boy API／WASM、鍵盤レイアウト、受動的な出力モニターを再利用した。共有runtime・DSP・WASMは変更していない。
- `npm run test:gameboy-synth`は**22件成功、失敗0**。実WASMで44.1／48 kHz、Pulseの割当と盗用後の離鍵、Wave／Noiseの所有権、Noiseの音階非追従、ライブPitch、プリセットの原子性、初期Sweepを有効にした場合の実PCMの音程下降を確認した。Worklet環境からURL／Node globalsを除いた検証も成功した。
- ソース版と独立ZIPの両方で、**Chromium／WebKitが成功**。初期化中の音源変更／Master 0、初期化前に離したキー、2音／1音の割当、波形のrelease時反映、ノイズのライブ変更、保存・読込、不正プリセット、Focus、ウィンドウblur、音声エラーからの再接続を検証した。物理スピーカー出力はテスト中muteしている。
- 390 px幅で横方向のoverflowは0。スクリーンショットを確認し、モニターとWave canvasのbacking sizeを実表示に合わせ、軸ラベルの縮小を防いだ。表示中のコピー用コードも現在の音色へ追従する。
- 初期化中の編集、Master変更、旧キーの発音予約、非同期ファイル選択、BFCache復帰を監査し、古い処理が新しい状態を上書きしないようにした。
- `sh scripts/package_itch_gameboy_synth.sh preview-20261104`で、29 filesの`release/tetorica_gameboy_synth_preview-20261104_itch.zip`を作成した。公開JS／CSSはbundle、元のWASMペア、BSD通知、固定SDKの認証済み対応ソース12 inputs、browserの入力アーカイブとhash receiptを同梱する。生成済みZIPの上書きは拒否する。
- `.github/workflows/gameboy-synth.yml`に、同じunit／ZIP／実ブラウザー検証を追加した。リモートActions、commit／push、公開は未実行。
- 記録：[ソース版](gameboy_synth_browser_01.json)、[ZIP版](gameboy_synth_zip_browser_01.json)。一時ログは`/private/tmp/gameboy-synth-tests-20261104.log`、`/private/tmp/gameboy-synth-final-browser-20261104.log`、`/private/tmp/gameboy-synth-final-zip-browser-20261104.log`。

## 後続

- [ ] VGM Analyzerから抽出したPulse／Noise設定・Wave JSONを直接読み込む導線。
- [ ] Audioから32サンプルWaveへの変換UI。既存Sample Editorの実装を再利用する。
- [ ] 原曲の音色と演奏中の変化を比較する検証。SaGa2「Save the world」をユーザーの手元の資料で試す。
- [ ] GBS曲再生は独立した検討事項とし、今回のAPU Synthに含めない。

## VGM／VGZからの音色読込（2026-11-04 完了）

- [x] 既存VGM parserとGame Boy音色抽出処理を再利用し、Pulse／Wave／NoiseをDMG Synthのプリセットへ変換する。
- [x] VGM／VGZの読込、音色の一覧・選択・即反映を追加し、選択後もキーボードで試奏できるようにする。
- [x] 読込中・エラー・未対応データを表示し、失敗やキャンセルで現在の音色を保持する。
- [x] 初期設定の抽出であること、曲中の自動変化や曲再生を再現する機能ではないことを説明する。
- [x] 自作VGM fixtureで変換・境界条件・実WASM発音、Chromium／WebKit、独立ZIPを検証する。

`vgm_import.js`は既存parserとAnalyzerのGame Boy collectorsを再利用する。発音開始時のPulse／Noise設定と、CH3 trigger時の完全なWave RAM・levelをプリセットへ変換し、panも反映する。同じ音色はまとめ、使用回数と最初の時刻を表示する。CH1 Sweepは有効／無効を復元し、CH2では無効にする。曲中の変化、元のnote pitch、length counter、Master volumeは持ち込まない。

`vgm_library.js`は読込と選択を分ける。読込だけでは発音・現在の楽器を変えず、明示的な音色選択で適用する。音源別filter、24件ごとのpage、cancel、closeに対応。非同期の古い読込結果は破棄し、失敗・cancel・closeで現在の楽器を保つ。入力／展開後64 MiB、4百万commands、4,096音色の上限を設定し、dual-chipは未対応と表示する。共有parser未対応のcommand（例：0x64 wait override）も明示的にエラーにする。

`npm run test:dmg-synth`は**31件成功、失敗0**（抽出9件を含む）。自作fixtureの4チャンネル変換、pan・Sweep・Wave nibbles、dedup、不完全設定、他chip/data blockの境界、VGZ展開上限、abort、実WASMによる全音源発音を確認した。ソース版・ZIP版とも**Chromium／WebKitで成功**し、4音色の選択と試奏、30音色のpage、filter、失敗時の発音維持、遅れたfile readのcancel、390 pxのoverflow 0を確認した。画面も確認済み。

記録：[ソース版](dmg_synth_vgm_import_browser_01.json)、[ZIP版](dmg_synth_vgm_import_zip_browser_01.json)。新ZIPは`release/tetorica_dmg_synth_vgm-import-20261104_itch.zip`（30 files）。browser対応ソース30 inputsのreceiptも作業ファイルと一致。共有runtime／WASM／プリセット形式は変更していない。今回のcommit／push／itch.io公開は未実行。実ゲーム由来のVGMを使う試聴は手元のファイルでの確認として残す。

## Pitchの配置をFM2612／SPUへ統一（2026-11-04 完了）

- [x] モニター右側と鍵盤左側の2箇所へPitch wheelを配置する。
- [x] 両方の値・表示・中央復帰を同期し、Noise選択時は両方を無効にする。
- [x] 実ブラウザーで双方向の同期・発音中の変更・Focus・狭い画面を確認し、独立ZIPも検証する。

22件のunit／配布テストが成功し、ソース版・ZIP版ともChromium／WebKitで成功した。実WASMで発音中の双方向のPitch同期、再triggerなしの所有権維持、離した時とpointer cancel時の中央復帰、両wheelのFocus中の演奏、Noiseで両方が無効になることを確認した。390 px幅でもモニター右・鍵盤左の配置を保ち、overflowは0。スクリーンショットも確認した。

記録：[ソース版](dmg_synth_pitch_wheels_browser_01.json)、[ZIP版](dmg_synth_pitch_wheels_zip_browser_01.json)。新ZIPは`release/tetorica_dmg_synth_pitch-wheels-20261104_itch.zip`。音源処理とプリセット形式は変更していない。

## 選択UIと演奏キーの干渉解消（2026-11-04 完了）

- [x] Source、Duty、Envelope方向、Sweep方向、Wave level、Noise幅のselectを選択ボタンへ変更する。
- [x] マウスで選んだ直後も演奏キーを使え、Tab／矢印からの選択も維持する。
- [x] 保持したPulseのDuty変更、選択後の発音・離鍵、Sweep無効時、狭い画面を実ブラウザーで確認する。

エディター内の7個のnative selectを、選択状態が見えるradioボタンのグループへ変更した。クリックで文字入力のFocusを残さず、Tabは選択中の項目へ入り、矢印・Home／Endで選べる。ボタンにFocusがあっても通常の演奏キーは発音に使える。

22件のunit／配布テストが成功し、ソース版・ZIP版ともChromium／WebKitで成功した。実WASMで、2音保持中のDuty変更が所有権を保持して再triggerを送らないこと、選択直後とradioボタンFocus中の発音・離鍵、Sweep無効時、390 pxでoverflow 0を確認した。viewport変更後の画面取得はcanvasのResizeObserver反映を待ち、グラフの軸も読める状態で検証した。

記録：[ソース版](dmg_synth_choice_buttons_browser_01.json)、[ZIP版](dmg_synth_choice_buttons_zip_browser_01.json)。新ZIPは`release/tetorica_dmg_synth_choices-20261104_itch.zip`。音源処理とプリセット形式は変更していない。作業開始時のステージ済み変更は維持し、今回の変更は追加でstage／commit／pushしていない。

## DMG Synthへの命名・アイコン反映（2026-11-04 完了）

- ユーザー指定の製品名：`Tetorica DMG Synth`、識別名：`tetorica-dmg-synth`。
- ユーザー指定のアイコン：`docs/tetorica_dmg_synth.webp`。
- [x] 正本を`docs/synth-dmg/`へ配置し、旧`/synth-gameboy/`の入口も新URLへ案内する。
- [x] 表示名、favicon／タッチアイコン、日英ホーム、英日AI README、配布ZIPとコマンドをDMGへ統一する。Game Boyを表す音源API名と既存プリセット形式は互換性を保つ。
- [x] 認証済みの対応ソース・アイコンをZIPに同梱し、unit／Chromium／WebKitでソースとZIPを検証する。

`npm run test:dmg-synth`は22件成功。ソース版と独立ZIPの双方がChromium／WebKitで成功し、製品名、指定WebPの表示、ローカルfavicon／タッチアイコン、旧URLのquery／fragmentを保持した移動、発音・数値ステッパーを確認した。指定画像の原本とZIP内のbytes一致も配布テストで確認した。

正規コマンドは`sh scripts/package_itch_dmg_synth.sh VERSION`、`npm run test:dmg-synth`、`npm run test:dmg-synth:browser`。旧コマンドは転送aliasとして維持する。新ZIPは`release/tetorica_dmg_synth_preview-20261104_itch.zip`（30 files）、CIは`.github/workflows/dmg-synth.yml`。記録：[ソース版](dmg_synth_branding_browser_01.json)、[ZIP版](dmg_synth_branding_zip_browser_01.json)。commit／push／公開は未実行。

## 数値UIの演奏向け変更（2026-11-04 完了）

- [x] Pulse／Noise音量、Envelope pace、Sweep pace／shift、Noise divisor／shiftをYM2612風の「− 値 ＋」へ変更する。
- [x] マウス操作で演奏用のFocusを奪わず、Tab・矢印・Home／Endからも調整できるようにする。範囲端とSweep無効時は操作を無効にする。
- [x] 実ブラウザーで、ノートを保持したまま値を変更し、離鍵・次の発音が正しく動くことを確認する。

中央の値の横ドラッグにも対応した。プリセットの形式と音声処理は変更していない。22件のunit／配布テストが成功し、ソース版・ZIP版ともChromium／WebKitで成功した。実WASMで、保持中のNoiseを再triggerせずにclockを変更できること、クリック／ドラッグ後の離鍵と次の発音、範囲端、Sweepの無効化、キーボードからの矢印操作、390 px幅のoverflow 0を確認した。

記録：[ソース版](gameboy_synth_steppers_browser_01.json)、[ZIP版](gameboy_synth_steppers_zip_browser_01.json)。更新ZIPは`release/tetorica_gameboy_synth_steppers-20261104_itch.zip`。以前のZIPは保持した。commit／push／公開は未実行。

## 実装の接続仕様

- 配置：`docs/synth-dmg/`。`preset.js`／`instrument.js`はDOMなし、`processor.js`で実APUを所有、`audio.js`はWeb Audioの寿命、`editor.js`は編集画面、`synth.js`は鍵盤・保存・全体の接続を担当する。
- プリセット：`{format:'tetorica-gameboy-voice',version:1,name,source,pulse:{duty,volume,envelope:{direction,period},sweep:{enabled,direction,period,shift}},wave:{samples:[32個の0..15整数],level},noise:{volume,envelope:{direction,period},divisor,shift,width},pan:{left,right}}`。余分な項目・不正な数値は、現在の音を変更する前に拒否する。
- `preset.js`：`createDefaultPreset()`、`readPreset(value)`、`waveShape(name)`、`presetToCode(value)`。
- `instrument.js`：`GameboyInstrument(core)`、`read()`→`{preset,voices:[{id,midi,channel}],capacity,pitch}`、`setPreset(value)`、`loadPreset(value)`、`noteOn(id,midi)`→`{channel,stolenId}`、`noteOff(id)`、`setPitch(semitones)`、`stop()`、`generateStereo(frames)`、`dispose()`。
- `audio.js`：`createAudio({volume,onError})`→`{context,outputNode,command(method,args),read(),setVolume(value),resume(),dispose()}`。`outputNode`はMaster適用後、モニターは受動分岐にする。
- `editor.js`：`createEditor({root,onChange,onError})`→`{update(preset),dispose()}`。編集時は妥当な完全プリセットを`onChange`へ渡し、canvasの描画はpointer releaseで反映する。
- UI共通ID：`startAudio,stopAudio,audioStatus,masterVolume,masterVolumeValue,voiceCapacity,voiceEditor,outputCanvas,keyboard,octaveDown,octaveUp,octaveValue,pitchBend,pitchValue,instrumentName,savePreset,loadPreset,presetFileInput,resetPreset,copyCode,codeOutput`。音源の選択はeditor内の`source`、canvasは`waveCanvas`。
