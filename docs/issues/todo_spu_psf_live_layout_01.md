# SPU Synth：PSF Live操作の配置（2026-11-11）

- [x] CH／Live／Reference key／Captureの共通バーを、PSF曲一覧の下・Envelope／Waveform／Spectrumの上へ移動する。
- [x] 既存のID・操作を保持し、デスクトップ／狭い幅で配置を確認する。

通常browserや音声出力は使わず、必要な確認はgain 0をアプリ起動前に設定したheadlessで行う。commit／push／公開は行わない。

確認済み：既存PSF Live checkerがChromium／WebKitとも成功。1240px／390pxで横はみ出しなし。WebKitのPause／Resume連続操作30往復も成功。画像で曲一覧→Live操作→Monitorの順を確認した。記録：`/private/tmp/spu-psf-live-layout-browser.json`。
