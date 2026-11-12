# DMG Synth：Menu／Filesへ読み込みを整理（2026-11-13）

SPU Synthに揃え、左上のハンバーガーメニューにImport／Exportを置く。VGM／VGZはメニューから取り込み、元データは`/vgm`、抽出音色は`/presets/<曲名>/`のJSONに保存する。音色を適用する操作はFilesの選択へ統一し、importだけでは演奏／音色変更／Code実行を行わない。

- [x] SPUと同じメニュー構成・開閉・Escape／外側クリック・フォーカス復帰を用意。VGM／JSON／project import、preset／project／選択file exportとCopy JavaScript／Resetをまとめる。Tauriの既存menuと連携できるID／イベントも確認する。
- [x] `Sounds from VGM`の常設panelを整理し、VGM静的抽出をFilesへの保存へつなぐ。元VGMの保存と音色抽出の成否を区別し、0音色・容量超過・取消時も元音色を守る。
- [x] 複数の抽出音色を衝突しない曲別folderへ一括保存。全体の容量を事前検証し、既存ファイル・編集中のコード／音色・Codeモードを保持する。JSONの読み込みもFiles経由とし、選択時だけ適用する。
- [x] 既存keyboard／Code／VGM playback・seek・Live・試奏／Capture・プリセット／project復元を保つ。
- [x] Node、実WASMと無音headless Chromium／WebKitで、Menu→import→Files選択→演奏／export／再import、誤データ・容量・取消、390pxを検証。通常browser／native app／OS音量を操作せず、実聴しない。
- [x] README／CI／可読配布ZIP／検証記録を更新。commit／push／公開は行わない。

CH別On／Offの追加はこの整理の後に検討する。共有chip API／WASMやVGM抽出アルゴリズムは今回の対象外。

完了：Node 163件、無音Chromium／WebKitのMenu全7項目・既存keyboard／Code／VGM playback／seek／試奏・Capture回帰が通過。TauriはMenu再利用・旧frontend fallbackと既存desktop CI checkerの新旧UI互換をmock IPC＋実WASM／Workletで確認（native app／OS出力は未使用）。

- [検証記録](dmg_synth_menu_files_import_verification_01.json)
- ログ／画像：`build/verification/dmg-menu-files-20261113/`
- Web配布候補：`release/tetorica_dmg_synth_dmg-menu-files-20261113_itch.zip`
- 変更先は親リポジトリと`w/tetorica-dmg-synth-tauri`の2箇所。Tauriのdist／release.lock.jsonは未更新、native build／commit／push／公開は未実施。
