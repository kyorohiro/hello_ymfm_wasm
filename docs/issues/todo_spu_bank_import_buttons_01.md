# SPU Synth：PSF / VABタブの読み込みボタン（2026-11-12）

- [x] PSF / VABタブ内にVAB / VH + VB、PSF set、PSF folderの読み込みボタンを追加する。
- [x] Menuと同じfile input・既存読み込み処理を使用し、キャンセル時は現在の音色・Bank・PSF選択を保持する。
- [x] 説明とキャッシュを更新し、無音headless Chromium／WebKitで各ボタンからfile chooserが開くこと、VAB／PSFの読み込みを確認する。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain 0へ遮断し、Chromiumはmuteを併用する。commit／push／公開はしない。

headless Chromium／WebKitで3種のタブ内ボタンとMenuの読み込みを確認。VAB／PSFセット／PSFフォルダーを自作fixtureで読み込み、390pxで横はみ出しなし。AudioContextは一度も作成せず無音。配布ZIPのCRCと全stageファイル一致も確認。

検証記録：[spu_bank_import_buttons_verification_01.json](./spu_bank_import_buttons_verification_01.json)。
