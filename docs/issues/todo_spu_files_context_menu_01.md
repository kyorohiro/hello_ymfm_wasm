# SPU Synth：Keyboardを保つFiles選択と右クリック操作（2026-11-12）

- [x] FilesでJS／JSONを選んでもKeyboardからCodeへ自動切替しない。Code表示中は選択ファイルを同じeditorへ反映する。音色JSONの明示選択による読み込みは維持する。
- [x] Filesの右クリックにDuplicate／Rename／Delete／New instrument／New JavaScript file／New folderを追加する。右クリックだけで音色を読み込まず、Codeや演奏を開始しない。
- [x] 複製・作成時は既存ファイルとフォルダーを保護し、保存／復元・実行中JS・フォルダー配下・容量制限を維持する。
- [x] Escape／外側クリック／スクロール等でメニューを閉じ、画面端と狭い幅でも操作できるようにする。
- [x] Nodeと無音headless Chromium／WebKitで検証し、説明・キャッシュ・検証記録を更新する。commit／push／公開はしない。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain 0へ遮断し、Chromiumはmuteを併用する。

Node 306件と無音headless Chromium／WebKitのFiles・Code・Monaco検証を完了。メニュー中の音楽キー・Escape、命名dialogのEscapeで試奏／全体Stopが発生せず、既存演奏を保つことも確認。

最終ZIP：`release/tetorica_spu_synth_files-menu-20261112_itch.zip`。検証stageと最終差分は [spu_files_context_menu_verification_01.json](./spu_files_context_menu_verification_01.json) に記録。commit／push／公開はしていない。
