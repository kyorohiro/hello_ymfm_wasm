# FM2612 Synth：Genesis音源タブの表示試作（2026-11-10）


現在のPSGタブは[PSG基本演奏](todo_fm2612_genesis_psg_01.md)へ進んでおり、下記は工事中表示の試作段階の記録です。PCM／PWMは工事中表示を維持します。

ユーザー指示：Envelope／Waveform／Spectrumの上にYM2612／PSG／PCM／PWMタブを置き、YM2612以外は工事中の表示へ切り替える。

- [x] 既存の配色とコンパクトな配置に合わせた4音源のタブを追加する。初期選択はYM2612。
- [x] YM2612のvisualizerと音色編集DOMを保持したまま表示を切り替える。PSG／PCM／PWMはUnder constructionのplaceholderを表示する。
- [x] Files・VGM再生／Mix・Master・鍵盤・録音の共通部分を維持し、実際の音源切り替えや未実装音源の発音処理は追加しない。placeholderにも試作表示であることを示す。
- [x] tablist／tabpanel・選択状態・矢印／Home／End・Space／Enterを扱い、演奏用の文字キーを吸わないようにする。
- [x] Chromium／WebKitで往復時の音色・OP mask・visual mode・keyboard入力と390pxの配置を確認する。配布packageの参照検査とcache keyも確認する。
- [x] 完了記録を残す。commit／push／公開・Tauri更新はこの作業では行わない。

入力の「PWA」は、直前までのGenesis／32X音源の話に合わせ、音源名のPWMとして表示する。

## 実装と検証

- `index.html`と`synth.js`に表示試作を追加済み。既存FMのvisualizer／音色編集を1つのtabpanelに包み、共通のFiles／VGM／Master／録音／鍵盤はその外側に置く。placeholderには実際の音源がYM2612のままであることを表示する。
- DOMを作り直さずhiddenで切り替え、音色・OP gate・visual modeを保持する。タブはroving tabindexとaria-selectedを使い、矢印／Home／Endをタブ内で扱う。Space／Enterを演奏ショートカットへ流さず、音名の文字キーは通す。タブ内にfocusがある時のpointer選択も、新しい選択へfocusを揃える。
- `node --test docs/synth/*.test.mjs`：179件成功。`package_itch_synth.sh chip-tabs-check-20261110`：266 local referencesの確認を含め成功。221 filesのZIP全fileがstageとbyte一致。receipt：`/private/tmp/fm2612-chip-tabs-package.json`。
- source／配布stageの両方をChromium／WebKitで確認し、4ケースすべて成功。4タブのaria-selected／tabpanel／roving tabindex、3種のmonitor modeと音色・OP gate・wheel値の往復保持、矢印／Home／EndとSpace／Enterの分離、tab focus中の音名キーによる実KON／PCM、保持音を切り替えた後の離鍵を検証した。FMタブへfocus後にPSGをpointer選択してArrowRightでPCMへ進むケースも成功し、fret／string／Event Recは不変。音声は出力端で物理muteした計測で、人の実聴とは区別する。
- 1240／390pxのスクリーンショットを確認し、4タブが1行で収まること、既存FM画面と工事中画面、共通鍵盤の配置を確認した。receipt：`/private/tmp/fm2612-chip-tabs-source-browser.json`（97 assets）と`/private/tmp/fm2612-chip-tabs-package-browser.json`（95 assets）。全asset hashが最終source／stageと一致する。
- 確認用ZIP：`release/hello_ymfm_wasm_chip-tabs-check-20261110_itch_synth.zip`（221 files、838,571 bytes、SHA-256 `cc678dbd9a1b5bd2515e7a95085cdd4e80febc6afaf5144caa1d5ff103e88a14`）。新規runtime moduleは追加せず、HTMLと既存entry scriptだけを変更した。entry cache keyは`synth-chip-tabs-1`。
- `git diff --check`成功。commit／push／公開・Tauri更新はしていない。
