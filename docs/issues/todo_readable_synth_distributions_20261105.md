# 改造しやすいSynth配布物とTauri版（2026-11-05 実装・検証完了／push準備中）

ユーザー要望：Tauriのdist/synth-dmg/synth.jsなどがminifyされ、Tetoricaの「読んで調べて再構築する」Goalに反する。Tauri版にもなるべく改造しやすい形を含める。

確認：DMG／2A03／SPU／SCSPの親packagerがminify:trueでbundleしていた。元JSはsources/*-browser-inputs.zip内に保存していたが、通常のファイルとして直接読んで編集できない。DMG TauriはZIPをそのまま取り込むため圧縮された状態が持ち込まれた。FM2612 Synthの配布は元のmodule分割を保っている。

- [x] 元のJS／CSS module分割・コメント・識別子を実行ファイルにも保ち、同梱したファイルを直接編集して試せる配布へ変更する。生成WASM／factoryは対応元C/C++と一緒に保持する。
- [x] DMG／2A03／SPU／SCSPのpackager・receipt・source archive・単体検証を揃える。実行時のimportとworker／WASM pathを維持し、欠落依存を防ぐ。
- [x] DMG／SPUの新ZIPをTauriへ正式importし、distとrelease.lockを一緒に更新する。FM2612も含め、元の配布hashを壊さずにローカル編集を明示して開発・buildできる手順を用意する。
- [x] READMEに編集入口、JS／音源API／C++の場所、反映手順、生成コードとの違いを記載する。
- [x] package／import／desktop adapter／実browser音声と変更反映を確認し、再開記録を残す。tag／公開／pushは行わない。

この作業開始時の親変更は、ユーザーのWeb版リリース報告を記録したdocs/issues/todo_nes_fds_synth_01.mdだけ。Tauri DMG checkoutはclean。既存のreleaseとlockを直接beautifyして偽の一致を作らず、親packagerから新しい配布物を作成して取り込む。

## 実装・検証結果

- `copy_readable_modules.mjs`はesbuildを依存調査にだけ使う。実行されるJS／CSSは元のbytesをそのままコピーし、moduleごとのpath／元path／SHA-256／importsをreceiptに記録する。元source ZIPも保持する。SCSP Labは元の`playground/scsp_dsp_lab.js`のpathで動く。
- README en／ja／AIにTetoricaの配布方針を追記。4 SynthのguideとREADME_RELEASEも更新した。生成WASM／loaderは親のSDK正本から対応ソースとともにコピーし、今回の処理で再生成・beautifyはしない。
- DMG／SPU Tauriへ新ZIPを正式import。DMGの`synth.js`は元の315 lines／17,121 bytes、SPUは566 lines／33,663 bytes。Tauri dist内のeditor／audio／instrument／音源APIも普通のfilesとして読める。元のmoduleコメント／importsを保持する。
- FM2612／SPU／DMGの`record:edits`は変更hashを別の`local-changes.json`へ記録し、元のrelease.lockとreceiptを保持する。編集→record:edits→dev／buildを各READMEに記載した。
- 親unitはDMG **32**、2A03 **213**、SPU **70**、SCSP **20**、合計**335件成功**。Tauri unitはDMG Python17＋JS42、SPU Python14＋JS42、FM Python14＋JS34で成功。DMG／SPUは新import後にも再実行し成功。
- DMG Tauriの実desktop adapter＋WASM／capture WorkletはChromium／WebKitで成功（child `docs/desktop_browser_20261104.json`）。2A03とSCSPの独立ZIP、SPUのimport済みdistも両browserで成功。SCSP DSP Labも独立pageで読込・発音・停止を確認。物理音声出力はmuteし、実聴は行っていない。
- 記録：[2A03](2a03_synth_readable_zip_browser_01.json)、[SCSP＋Lab](scsp_synth_readable_zip_browser_01.json)、[SPU](spu_synth_readable_zip_browser_01.json)。DMG／SPUのmacOS debug `.app`を`npm run build -- --debug --bundles app`で作成できた。
- SPU Tauriへは現行親配布を取り込んだため、旧distに対して既存のSDK source commit `51e3f76`→`95cf71a`（いずれも0.1.7と記録）と対応WASM・C++も更新される。今回新たにDSPを編集したものではない。新しい対応ソース・build receipt・native attributionを一式同梱し、実音源のfull browser suiteで確認した。

配布ZIP（全て`release/tetorica_CHIP_synth_readable-20261105_itch.zip`）：

| CHIP | 実行module数 | 全files | bytes | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| dmg | 20 | 47 | 1,245,473 | `0ec2bd98d4fd00f98c6d740df585cd5fa4145cb2a7f90abcd326b0bbca2876ea` |
| 2a03 | 40 | 72 | 1,293,445 | `6858e1c26278bf25de665908631ac8efd68abdff27697a7803b3fa3d2d860548` |
| spu | 32 | 74 | 5,593,856 | `83e48a72d1d968ec1e75bd6ce017da9d62f8491988e7302b2ae9919776c19f49` |
| scsp | 20 | 54 | 1,226,769 | `02aa91c338059ec7fa5c04c4e31b8be80c09e05c8d03d76a8bf25efc41455698` |

ユーザーよりGitHubへのcommit／pushも依頼済み。SSH公開鍵認証が通らなかった親・DMG・FMはHTTPSでfetchし、全4 repositoriesのHEADとorigin/mainが一致することを確認した。pushにはログイン済みGitHub CLIのcredential helperを使う。tag／GitHub Release／itch.io差替えはこの作業では行わない。

最終の変更反映検証：一時copyのDMG `dist/synth-dmg/synth.js`だけを編集し、追加buildなしでChromium／WebKitの見出しが変更されることを確認。AudioContextは0、errors／missing assets／external requestsも0。未記録時はcheckが変更を検出し、record:editsで1 fileだけ記録するとcheckが成功。元のrelease.lockと実checkoutのdistは変更なし。[記録](dmg_synth_editable_source_01.json)。
