# SPU Synth：左上のImport／Exportメニュー（2026-11-11）

ユーザー指定：FM2612 Synthと同じハンバーガーメニューを左上へ設置し、Import／Exportの入口をまとめる。PSF／VABの読み込みをCode最大化中にも見つけられるようにする。

- [x] FM2612の既存menu部品を利用し、SPUの既存読み込み／保存機能へ接続する。
- [x] Audio、PSF／VAB／VH+VB、preset、projectの入出力をメニューから利用でき、選択後は関連タブへ移動するようにする。
- [x] pointer後の演奏focus、Escape／外側click／読み込みcancel、Code最大化とFiles、狭い幅の表示を確認する。
- [x] docs／cache／必要な無音headless検証・配布ZIPを更新する。commit／push／公開なし。

既存PSF／VAB tab・loader自体は残っていた。Code最大化時にeditor全体が隠れることが見つけにくさの一因。音声出力や通常browser／native app／OS音量操作は行わない。

## 読み込み後の音色選択の確認

- [ ] ユーザー報告「importしても音色を選べない」を、入力形式・表示状態と合わせて再現する。
- [ ] 通常表示／Code実行中／最大化後のBank／Tone選択と反映を確認し、必要な修正を行う。
- [ ] 実際のメニューから音色選択・適用までの無音回帰、docs／配布物・検証記録を更新する。

## 完了記録

- 左上の操作列先頭へFM2612と同じ円形SVGハンバーガーと共通`setupSynthMenu`を配置。ImportはVAB／VH+VB、PSF set／folder、Audio、SPU JSON、project ZIP、project files。ExportはSPU JSON、project ZIP、選択file。既存button ID／input／loaderを移動して接続し、Filesは編集・Save soundを保持する。
- PSF／VAB／Audioのメニュー操作でCode最大化を解除して対応tabへ移動する。view復帰だけではCodeを止めない。File／projectのImportではFilesを表示する。ExportやEscape／外側clickの閉じ動作も共通menuを利用。
- NodeのSPU／packaging102件、最終Files／packaging9件成功。
- 最終ZIPの無音headless Chromium／WebKitで、Menu各7項目、Code／Files／Live各7項目、実Monaco各5項目と従来SPU full回帰が成功。VABの実chooser・Tone一覧、project ZIP往復、Code最大化復帰、1240／780／390px配置を確認。音声を開始しないMenu確認ではAudioContext／出力接続／音声commandは0。
- directoryのnative cancel自体は検証済みとはしていない。Chromiumは所有する空folder、WebKitはREADMEのみのfolderを選択して音色保持を確認。通常file pickerは空選択を検証。
- 旧回帰はメニュー移動に合わせてexportを実menuから操作するよう更新。ポインター保持中の和音に余分なmenu clickを注入しないよう、menuを開く検証を初期navigationへ分離した。和音・note lease・フォーカスの元assertionは維持。
- ZIP：`release/tetorica_spu_synth_spu-menu-20261111_itch.zip`（140 files、6,057,137 bytes、SHA-256 `0c143efe822564e54892350467b28cb16456ea8d2776279b1f8d3e5313bbff6b`）。ソース107入力はrepoと一致し、minify／bundleなし。
- 詳細：[検証記録](spu_synth_menu_verification_01.json)。commit／push／公開なし。
