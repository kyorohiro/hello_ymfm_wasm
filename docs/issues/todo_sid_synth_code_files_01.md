# SID Synth：Code／Files（2026-11-11）

依頼：FM2612 Synthの「原曲・Live・音作り・Code・保存」の構成をSIDへ広げる。まず既存のSID編集音源を共有するCode入力と、そのコードを残せるFilesを接続する。

- [x] SIDの既存Keyboard／CH選択・共有Filter／6581・8580／原曲preview／desktop出力の所有権を確認し、実装境界を決める。
- [x] 共通Code runtimeをhostごとの対応chip指定に対応させる。FM2612側の既定4chipと既存動作は維持する。SIDは `const sid = await useSoundChip("sid")` から物理CH1〜3を操作し、`liveLoop`／`context`／`livePrepare`／`tween`／`liveFx`等の共通機能を利用する。
- [x] 同じSID coreへCode用の明示CH APIを接続し、上段の音色・Filter・Master・model変更を共有する。Keyboard allocatorのnote IDとは分け、Stop・mode切替・原曲再生・失敗・pagehideで古い命令や遅い起動が復活しないようにする。Stopにはsoftware出力fadeを使い、編集presetを復元する。
- [x] Keyboard／Code tabとRun／Apply／Stop、エディター・説明・型・ログを既存デザインへ接続する。Applyはcontextを保ち、Runは新規session。保存・reload・importだけでコードを自動実行しない。
- [x] Filesにindex.js・local module/dataとSID preset／channel setupを保存できる導線を用意し、projectのexport/import・復元と既存preset保存を両立する。対応範囲とsoftware機能を説明する。
- [x] 原曲SIDの再生・Pause／Live・CH選択・既存keyboard・Desktop出力との回帰と、実WASM・型・headless Chromium／WebKitの無音検証を行う。全destinationをアプリ読込前にgain 0へ通し、通常browser・実聴・OS音量変更はしない。
- [x] 依存module／cache・Synth ZIP・改造用sourceを更新し、TODOと検証記録を残す。commit／push／npm公開／itch.io uploadは行わない。

録音／LooperのSID対応は、このCode／Filesの所有権が安定した後の段階に分ける。現在のSID曲再生・Liveは既に実装済みで、今回作り直さない。

## 実装と境界（完了）

- Keyboard／Codeを切り替え、共有Code editor／schedulerをSID host設定で使う。`useSoundChip("sid")`のみ許可し、標準の物理CH APIを非同期RPCで既存のSidSynthへ渡す。別のSIDやAudioContextは作らない。
- Runは新規session、Applyはcontext・named loop／FXを保持。Stopは8msのsoftware output fade後にCode client・FXを退役させ、最新の編集用3CH設定へ戻す。旧Run／loopの遅い命令とNote Offは新しい演奏を消さない。
- 上段の音色／Filter／Masterは同じchipへ反映。model／接続／読み込みでCodeを停止する。Keyboard用のallocation／Legato／ratio／PitchはCodeの明示CH操作と区別する。
- FilesはSID専用のIndexedDB／journal。index.js、local module／data、SID preset／3CH setupをproject ZIPへ保存。再読込／importはUIとsourceのみ復元し、コードは自動実行しない。未完成JSONも編集ファイルとして保持し、適用時だけ検証する。
- 音楽SIDのpreview／Liveは既存の別C64 engineを維持し、Codeとの排他を接続。Codeを入力するだけで音源は起動しない。録音／Looperは後続TODO。
- 配布候補: `release/tetorica_sid_synth_sid-code-monaco-20261111_itch.zip`、stage `release/itch_sid_synth_sid-code-monaco-20261111-MBULzY`。329 files、可読JS／CSSとFX WASM／C source kitを収録。
- Node統合255件成功。旧校正375件と両generator／artifact check成功。校正値と既存測定receiptは変更しない。Monaco completionはpresetだけのmoduleをimportし、完全一致する1 importだけを認証するcompatibility layerを追加した。
- Chromium／WebKit双方でCode／Files／FX／Stop／モデル切替／Keyboard復帰／ZIP／reload／song排他／pagehide／390pxを成功。共有部品を使う既存FM Codeのheadless停止回帰も両engine成功。全speaker接続は事前gain0、実聴なし。

前回の配布候補（Monaco表示修正前）: `/Users/kyorohiro/development8/wfm/hello_ymfm/release/tetorica_sid_synth_sid-code-20261111-final_itch.zip`（329 files／329 entries）、SHA256 `9222da45b36a1d471c3144817fc753ae800bfc2854e0bcb3dd06d3826a574e6b`。旧候補からFilesのlist余白だけを調整した最終版を再検証済み。ZIPとstageの全ファイル、実際に配信したSID 84 assets、FM 165 assets、同梱source ZIPの全元ファイルを照合済み。恒久記録: [sid_synth_code_files_verification_01.json](sid_synth_code_files_verification_01.json)。

## Monacoの表示修正（2026-11-11）

ユーザー報告: Codeに「Monaco editor is active」と表示されるが、エディター領域が消える。前回のbrowser検証はCDNを遮断したtextarea fallbackが対象だった。

- [x] SIDのhostに残る`hidden`と、共通Monacoの`data-ready`による表示契約を揃える。未読込時はtextareaを表示する。
- [x] 実Monacoを読み込むheadless Chromium／WebKitで、表示寸法・描画・編集・型／補完・Keyboard切替・拡大／復元を無音で確認する。
- [x] fallbackと配布ZIPを確認し、修正後の検証記録を残す。

実Monacoを使う検証を `scripts/check_sid_synth_code_monaco_browser.cjs` に追加。Chromium／WebKit双方で320pxの編集領域と実際のソース描画、Keyboard切替、1240／390pxの拡大・復元、JS workerの型検証、SID限定補完、実装ソース表示が成功。CDN遮断時の簡易エディターも成功。実Monaco検証はRunせず音声接続0、演奏回帰は全destinationをgain0として実聴なし。ZIP検証2件、配信asset・同梱source・全329 entriesも照合済み。

修正後の配布物: `release/tetorica_sid_synth_sid-code-monaco-20261111_itch.zip`、SHA256 `2f34165ad70ad247bf3f3cdff8fc4dd13c2145783943879fedbb7eaccd1f19fd`。前回の候補を置き換える。恒久記録: [sid_synth_code_monaco_verification_01.json](sid_synth_code_monaco_verification_01.json)。公開／commit／pushはしていない。
