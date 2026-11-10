# FM2612 Synth：音源タブ横の共通Mixer（2026-11-10）

ユーザー方針：VGMを読み込んだ時だけ出るMixを、音源タブ横の標準Mixerへ移す。最終指定はYM2612／PSG／RF5C164／32X PWMの直後にMixerタブを置き、VGMがなくても音源別Volumeと20CHのOn／Offを操作できる構成。

- [x] 現在のVGM Mixと各Synth／Code／録音／LooperのSystem補正経路を確認し、4音源共通の音量stateを定義する。100%はsource gain 1、初期値／Resetは既存のSystem補正を維持し、補正とMasterを重複させない。
- [x] Mixerボタンを音源タブの横へ移し、常時利用可能にする。4音源のVolumeを常に表示し、VGMのCH Mute・Seek cache・Highlightなど既存操作も同じ場所で利用できるようにする。小画面とCode拡大でも操作しやすい配置にする。
- [x] 同じMixerの音量をKeyboard／Code／VGMへ反映する。新しい曲の読み込みや音源切替でも共通VolumeとCH On／Offを保持する。
- [x] 意味あるNodeテストと、全speaker接続を事前gain 0へ迂回するheadless Chromium／WebKitで実音声配列とUI・保存／再開・既存機能を確認する。
- [x] ガイド／再開記録・cache key・配布ZIPを更新する。実聴・commit／push／公開はしない。

## 実装記録

### 追加修正：PWM横の位置とCH On／Off

ユーザー指摘：Mixerがタブ列から離れて分かりにくく、CH単位のOn／Offが見えなくなっている。

- [x] Mixerを32X PWMのすぐ右隣の実際のタブにする。タブ名はYM2612／PSG／RF5C164／32X PWM／Mixer。
- [x] VGMの有無に関係なくYM2612 6CH／PSG 4CH／PCM 8CH／PWM L・RのOn／Offを表示し、鍵盤・Code・VGMで共用する。CH情報の読み込み待ちで隠さない。
- [x] ノート、ADSR、FIFO／sample位置、Live表示・音色ファイルを変更せずにCH出力を切り替えられるようにする。共通Volume／Masterと重複させない。
- [x] 無音の実出力検証と既存機能の回帰を確認し、ガイド／配布ZIP／再開記録を更新する。

### 追加修正の完了・検証記録

- Mixerを5番目のtabpanelとしてインライン表示する。選択しても編集中のchip／音色・Code実行を維持し、拡大CodeのMixerボタンもこのタブを開く。画面幅1240／390で確認。
- 全20CHのOn／OffをVGMなしでも表示。明示したOn／OffとVGM内のchip有無を分離し、Keyboard／Code／VGMへ共用する。曲変更・解除でもVolumeとOn／Offを保持し、ResetはSystem値＋全CH On。
- FMはSynth専用worklet entryで共有processorへ出力pan maskを追加。PSGは既存のnative channel mask、PCMはSynth専用transportでauthored panを保持し、PWMは独立L／R gainで出力だけを切り替える。発音・ADSR・sample位置・FIFOは進み続け、Onへ戻すと保持中の音が戻る。初回のPause試奏用FMノードも既存Offを継承する。
- レンダリング済みのLoop layerは混合済み音声なので、音源別Volumeを使う。CH On／Offの対象はlive Keyboard／Code／VGM。ガイドと英日READMEへ記載。
- Synth／共通runtimeのNodeテスト603件成功、失敗・skipなし。ログ：`/private/tmp/fm2612-mixer-tab-tests-final-20261110.log`。実WASMを含むFM両backend、PSG／PCMのphase・authored register保持、PWM L／R、UI state・Preview／seekの回帰を含む。
- 共有workletへ追加した`export `のみを過去の測定全文SHAへ復元して校正を継続。以前のCode用Monaco表示／import分割も厳密な既知SHAへ固定して扱い、測定値は変更しない。校正guard関連368件成功、両generator `--check`・Playground artifact profile成功。詳細：[校正履歴TODO](todo_fm2612_synth_calibration_freshness_01.md)。
- 最終stage：`release/itch_synth_mixer-tab-final-20261110`。`check_synth_code_browser.cjs --checks=mixer`、同通常モード、`check_synth_pcm_browser.cjs`はいずれもChromium／WebKit成功。全20 Onの初期状態、CH Off→Onで保持中の実音声が復帰、拡大Codeからのタブ選択、4音源Volume／Master、初回Pause試奏のOff継承、Files／Cassette・Code／FX・PCM編集を確認。receipt：`/private/tmp/fm2612-mixer-tab-final-browser-20261110.json`、`/private/tmp/fm2612-mixer-tab-code-regression-20261110.json`、`/private/tmp/fm2612-mixer-tab-pcm-regression-20261110.json`。
- VGM 20CH分離・4音源Gain・Copy／部分OP／特殊CH3／DACの全体回帰はChromium成功。receipt：`/private/tmp/fm2612-mixer-tab-vgm-20261110.json`。この全体回帰は初回Pause試奏の修正前stageで実施し、その修正は最終stageでChromium／WebKitの専用caseにより確認。
- すべてアプリ起動前に全speaker接続をgain 0へ迂回したheadless検証。実聴はしていない。通常コマンド`sh scripts/package_itch_synth.sh`でZIPを更新し、最終stageとZIPの全281ファイルの内容一致、最終browserが配信された全assetのbytes／SHA-256一致を確認。
- 配布物：`release/hello_ymfm_wasm_dev_itch_synth.zip`（1,056,138 bytes）。SHA-256：`a1a504dfe9f106e8eb0737a8ba0bbc15c14e48835b706f9198286bc9eecca510`。commit／push／公開は未実施。

### 初回実装の記録（下記のpopover・VGM専用Mute仕様は追加修正で置き換え）

- 音源タブ横の`#synthSongMixButton`を常時表示のMixerに変更。単一のpopoverを上部のSynth editor外へ移し、Code拡大中は`#synthCodeMixerButton`からも開く。4音源のVolumeはVGMなしでも表示する。VGMのCH Mute／Live highlight／Seek cacheは読み込んだ曲のCHがある時に表示し、MuteはVGM専用と明記する。
- `createSynthSongMix()`をKeyboard／Code／VGM共通のsession stateにした。Previewへ同じobjectを注入し、購読で音量・Mute・Resetを再生／seek cacheへ反映する。新規VGM／解除ではCHとMuteを取り替え、Volumeは保持する。新しい永続化形式は追加せず、Master同様session内の設定として扱う。
- 100%はabsolute source gain 1、初期値／Resetは既存System値（YM2612:0.775938、PSG:0.35、PCM:0.280286、PWM:0.128818）。範囲0〜3.8、100%を超えると橙色。従来FM単体のunity出力もSystem値へ揃えた。
- FMは編集用／Looper／Pause試奏それぞれに独立gainを置き、内部mixerはunityのままとした。録音tapをFM source gainより前へ置くので、録音bufferへMixerの音量を焼き込まない。PSG／PCM各endpoint（編集・試奏・Event Rec・Looper）の`setSourceVolume()`とCode PWMの`setPwmSourceVolume()`を接続した。Masterは独立して一度だけ適用する。
- VGM rendererもPWMのVolumeへ対応。FIFO・timer位相・再生位置・元の音色register／Live表示を変更せず、出力のみ調節する。MuteはVGMにだけ適用し、共通Volumeの変更は演奏中のnote／再生を止めない。
- Codeガイドと英日README、module cache keyを更新した。

## 検証・配布記録

- `node --test --test-concurrency=1 docs/synth/*.test.mjs scripts/playground_code_runtime.test.mjs`：473成功、失敗／skipなし。Mixerモデル／Preview／UI／rendererのfocused suiteも58成功（上記との重複あり）。PWMの実WASMで0／50／100／200／380%とstereo muteを変えてもFIFO／timer位相／続きが一致することを確認した。
- `sh scripts/package_itch_synth.sh common-mixer-final-20261110`で最終stageを作成。`scripts/check_synth_code_browser.cjs --checks=mixer`はChromium／WebKit成功。VGMなしの4つのSystem初期値、幅1240／390、Code拡大中の同じpopover、4音源の実出力0／50／100／380%、Masterとの独立性、曲変更時のVolume保持、VGM CH MuteがKeyboardへ影響しないこと、Resetを確認。
- 同checkerの通常モードもChromium／WebKit成功。Code／4音源／FX／Apply／停止／拡大／Files／Cassetteを回帰確認。
- `scripts/check_synth_pcm_browser.cjs`もChromium／WebKit成功。従来PCM鍵盤・離鍵・WAV／RAM／Loop・保存・音源切替を確認。
- `scripts/check_synth_song_mix_browser.cjs`はChromium成功。既存VGMの20CH／outputsのMute、4音源の独立音量、System値の精度、Master、Pause／Resume、元VGM／Live／Filesの維持、Copy、部分OP／特殊CH3／DACの回帰を確認。
- いずれも引数は`--root=release/itch_synth_common-mixer-final-20261110 --entry=/index.html`。詳細receiptは`/private/tmp/fm2612-common-mixer-browser-final-20261110.json`、`/private/tmp/fm2612-common-mixer-{code,pcm,vgm}-regression-20261110.json`。Nodeログ：`/private/tmp/fm2612-common-mixer-tests-20261110.log`。すべてのspeaker接続をアプリ起動前にgain 0へ迂回し、実聴はしていない。
- 通常の`sh scripts/package_itch_synth.sh`も実行し、検証用ZIPと全277ファイル内容が一致。各browserへ配信した全assetのSHA-256も通常ZIPへ照合した。`release/hello_ymfm_wasm_dev_itch_synth.zip`は1,051,474 bytes、SHA-256：`d8c73fb714df83f9b02b765d6879a924371ff450ea0937ab25744628822eae3a`。
- `git diff --check`成功。commit／push／公開は未実施。実際の聴感と使い心地は人による確認待ち。
