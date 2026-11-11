# SPU Synth：Pause中の音色編集と元CH比較（2026-11-12）

- [x] Synth表示でのPCM・ADSR・Reverb・Morph・Noise／PMON編集で、元PSFのPause位置・CH状態を保持する。
- [x] 編集したSynthと元のPSF CHを往復して試奏し、編集内容を失わずResumeで元曲を継続できるようにする。
- [x] 発音中の編集、波形／Noise／PMON切替、試奏checkpoint復元とResume／Stopの競合を確認する。曲再生中の編集、別音色読み込み、Code開始、明示Stopの既存動作は維持する。
- [x] 操作説明・表示を更新し、Nodeと物理出力gain 0のheadless Chromium／WebKitで確認する。
- [x] 配布ZIPと検証記録を更新する。commit／push／公開はしない。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain 0へ遮断し、Chromiumはmuteを併用する。

完了：関連Node 240件成功。最終ZIPでLive／Pause試奏／Capture／Code・Filesの4系統がChromium／WebKitとも成功。PCM shape・実描画、押鍵中ADSR（再発音・lease resetなし）、Reverb、Morph、Noise／PMONで元PSFの位置・CH・frozen frame／活動・buffer数を保持した。元CHへ戻って試奏し、Synthへ戻った時の最新編集checkpointとResume後の編集保持も確認済み。

遅延preview退役中にADSR編集→Resumeを行い、未送信の変更が中止され、元音色を変更せず期待Abortエラーも表示されないことを確認した。再生中編集、通常import、Code、明示Stopの回帰も成功。Morph performance 2箇所はpaused Synthで操作可能。Native／WASM変更なし、物理出力gain 0・実聴なし。

検証記録：[spu_psf_paused_edit_verification_01.json](spu_psf_paused_edit_verification_01.json)。配布ZIP：`release/tetorica_spu_synth_psf-paused-edit-20261112_itch.zip`（336 files、SHA-256 `16f2388d54de1f63913624d988024fdec65c5df707b109ada505d9fbf8c41666`）。原本JSをbyte一致で含み、全ZIPエントリーとCRCを確認した。commit／push／公開なし。
