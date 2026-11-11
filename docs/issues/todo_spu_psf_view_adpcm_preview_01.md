# SPU Synth：PSF表示／Synthの明示と取り込みADPCM表示（2026-11-12）

- [x] PSF CH表示と編集用Synthを明示して選択できるようにする。Capture後はSynthを選択し、元曲のPause位置とCH状態を保持する。
- [x] PSF CHを選ぶとそのCHの表示・Pause試奏へ戻り、Synthでは取り込んだ一音色を編集・試奏することをUIへ明記する。CH活動表示と元曲の音色は保つ。
- [x] Capture／VAB Tone／presetから読み込んだADPCMを、編集用PCMと区別したread-only波形として表示する。元データ・発音・保存内容は変更しない。
- [x] Nodeと物理出力gain 0のheadless Chromium／WebKitで、表示切り替え・Capture・Tone・保存再読込・Pause試奏・Resumeを確認する。
- [x] 説明・キャッシュ・配布ZIP・検証記録を更新する。commit／push／公開はしない。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain 0へ遮断し、Chromiumはmuteを併用する。

完了：関連Node 240件成功（preview helper 5件、実WASM audio 50件を含む）。最終a ZIPでCapture／Live／Pause試奏／Code・Filesの4系統がChromium／WebKitとも成功。Capture後はSynthを明示選択し、Live On・24CHのfrozen活動・Pause位置を保持。同じnative CH番号からPSF表示／試奏へ戻れること、Resumeと保存の正常動作を確認した。

通常Load selected Tone、Capture、preset再読込の先頭ADPCM previewを実canvasへ表示し、dragで原音色を書き換えないことを確認。preview→Code未割当→作者bank復元では実pixelの青線が消去／再表示され、shape選択後は編集PCMへ戻って描画できた。音・保存・RAM・native frameの不変も確認済み。通常browser／native appは操作せず、物理出力gain 0・実聴なし。

検証記録：[spu_psf_view_adpcm_preview_verification_01.json](spu_psf_view_adpcm_preview_verification_01.json)。配布ZIP：`release/tetorica_spu_synth_psf-view-preview-20261112-a_itch.zip`（336 files、SHA-256 `df91f0f9c059be93891d62ef05106fc866bb770970a164e7869c369eb1c37131`）。原本JSをbyte一致で含み、全ZIPエントリーとCRCを確認した。Native／WASM変更なし。commit／push／公開なし。

後続：[Pause中の音色編集](todo_spu_psf_paused_edit_01.md)で、Synth表示中の通常PCM／ADSR／FX編集でもPauseを保持するようにした。別音色読み込み・Code開始・再生中編集などの停止条件は維持する。上記検証は当時の配布ZIPについての記録。
