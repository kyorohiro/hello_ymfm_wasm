# SPU Synth：preset JSONをCodeで表示（2026-11-12）

- [x] presetsのJSONを共通Codeエディターで表示・編集し、Files内の独立textareaをなくす。
- [x] JSONをJavaScriptとして実行しない。Run／Applyを無効化し、文字列編集の保存と明示選択時の音色読み込みを維持する。
- [x] Save soundは発音や表示モードを勝手に切り替えず、保存したJSONをCode欄で開ける状態にする。
- [x] 保存・復元、JSへ戻る操作、rename/delete、Monaco／fallback、既存音色読み込みを検証する。
- [x] 説明・キャッシュ・配布ZIP・検証記録を更新する。commit／push／公開はしない。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain 0へ遮断し、Chromiumはmuteを併用する。

Node 295件、headless Chromium／WebKitのCode・Monaco・PSF Capture・音色保存／復元検証を完了。Monacoではfocus直後のJSON選択も各3回、エラー・未処理Promise拒否なし。最終ZIPは `release/tetorica_spu_synth_preset-json-code-20261112_itch.zip`。commit／push／公開はしていない。

検証記録：[spu_preset_json_code_editor_verification_01.json](./spu_preset_json_code_editor_verification_01.json)（検証stageと最終差分も記録）。
