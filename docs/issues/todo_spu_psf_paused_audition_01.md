# SPU Synth：PSF Pause中の選択CHを鍵盤試奏（2026-11-11）

報告：Pause中に鍵盤を押すとPSF Stopが呼ばれ、CH／Live／Capture欄まで消える。ユーザー確認済みの希望は「Pause中に選択したPSF CHの音色で試奏」。曲と凍結Live表示・元の編集音色を保持し、Resumeできるようにする。

- [x] 鍵盤・離鍵・blur／pitch reset・Resume等のStop経路と、一時試奏の所有権を整理する。
- [x] 同時点CaptureのADPCMとReference keyを再利用し、一時的な鍵盤音色として既存SPUで鳴らす。元の編集bank／設定をcheckpointして確実に復帰する。PSFのCPU／RAMには書き込まない。
- [x] Pause／Live On時は選択CHを試奏し、CH／Reference切り替えで試奏を更新。key-upが準備を追い越す場合、連打／和音／sustain、古いnoteOffを安全に処理する。
- [x] Resume／Stop／Live Off／曲変更／Code Run／編集／Capture／pagehideでは試奏を解放する。Resumeは同じ曲位置へ戻り、編集音色も保持する。通常の演奏中Keyboard Stop挙動は維持する。
- [x] 無音Node／Chromium／WebKitで「鍵盤を押してもPause CH欄が残る」「選択CH bytes／Reference PITCHで音が出る」「復帰／取消／保存に副作用がない」を検証する。
- [x] Codeを一度使用した後のCaptureで、既にKeyboard表示なのに再度mode変更して出力gateが閉じる経路を修正し、実際のPCM出力で確認する。
- [x] README／配布ZIP／検証記録を更新する。commit／push／tag／公開は行わない。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain0へ遮断し、Chromiumはmute併用。最初は既存Captureと同じ通常ADPCMを対象とし、Noise／PMON carrierは理由を表示する。

方針：既存getPs1Client()の一時bank/checkpointを借り、同時点Captureデータを通常ADPCMとして試奏する。別SPU／AudioContext／出力接続は作らない。元のRAM・sample IDs・host PCM・ADSR・FXはcheckpointから復帰する。Code clientに読み取り専用ownsOutput()を追加し、古い試奏のfade／cleanupが新しいCode演奏や編集へ影響しないようにする。試奏はCodeの実行状態として表示せず、PSF LiveはPause時点のまま保持する。

完了：関連Node 444件、校正145件、専用Pause試奏＋既存再生／Live／Capture／Code／通常Synthの6系統をChromium／WebKitで検証。すべてgain 0で、実聴なし。配布ソースからのPSF player再ビルドはJS／WASMともbyte一致し、固定SDK 0.1.7の476ファイルも保持した。

検証記録：[spu_psf_paused_audition_verification_01.json](spu_psf_paused_audition_verification_01.json)。配布ZIP：`release/tetorica_spu_synth_psf-paused-audition-20261111-c_itch.zip`。既にKeyboard表示のCaptureで余分にCode Stopを呼び、音が消える経路も修正済み。
