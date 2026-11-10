# FM2612 / Genesis Synth：PSG基本演奏（2026-11-10）

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
