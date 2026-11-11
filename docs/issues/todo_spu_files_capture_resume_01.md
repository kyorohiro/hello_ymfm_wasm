# SPU Synth：Files整理とCapture後のResume（2026-11-12）

- [x] FM2612と同じ構成を参考に、Filesの見出し・作成ボタン・ファイル操作・ツリーを整理する。重複したProject表示と大きすぎる選択行を解消する。
- [x] Capture to Synth成功後もPSFのPause位置・選択CHを保持し、Resumeできるようにする。Live表示をOffへ切り替えて、取り込んだ音色を編集・試奏できるようにする。
- [x] Capture失敗・中断では元のPSFと音色を保持する。通常の音色読み込み・Stop・Code開始の既存動作を維持する。
- [x] Nodeと物理出力gain 0のheadless Chromium／WebKitで、Files操作・Capture・Pause試奏・Resumeを確認する。
- [x] 説明と配布用ファイルを更新し、検証結果を記録する。commit／push／公開はしない。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前にdestinationをgain 0へ遮断し、Chromiumはmuteを併用する。

完了：関連Node 232件成功、Files／Project 18件を最終変更後に再確認。最終配布stageでCapture・Pause試奏・Files／Codeの3系統がChromium／WebKitとも成功。ADPCM／Noiseの両方でCapture後のPause位置・選択CH・同一frozen frame、Live Off鍵盤試奏、Resumeによる元曲の継続を確認した。失敗・中断、通常import／Code、共有reverb、既存checkpointの回帰も成功。物理出力gain 0で、実聴なし。

Filesは見出し／作成・保存ボタン、一覧、ファイル操作の順へ整理し、重複Project表示を非表示化。両browserで行高約28.6px、影なし、Project表示1つ、操作は一覧の下、1240／390pxで横overflowなしを確認した。

検証記録：[spu_files_capture_resume_verification_01.json](spu_files_capture_resume_verification_01.json)。配布ZIP：`release/tetorica_spu_synth_files-capture-resume-20261112_itch.zip`（335 files、SHA-256 `cbb63c20dcd586ad18f60abff6012e9c3a9545f76e5f53fbac73b0f6ce1168c9`）。JavaScript／CSSは編集可能な原本とbyte一致し、全ZIPエントリー・CRCを確認した。Native／WASMは変更していない。commit／push／公開は行っていない。

後続：[PSF表示／Synthの明示とADPCM表示](todo_spu_psf_view_adpcm_preview_01.md)で、Capture後のLive自動Offを明示的なSynth選択へ置き換えた。新しい動作ではLiveと元曲のCH活動を保持する。上記検証は当時の配布ZIPについての記録。
