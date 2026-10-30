# SCSP PCM／EG編集 — 2026-10-30

PlaygroundのSaturn (SCSP)にPCM／EG編集とCopy voice JavaScriptを追加した。

- Slotごとに既存PCMを選択、Sine／Triangle／Saw／Squareを生成、単一canvasで描画する。
- PCM8／PCM16、root frequency、source sample rate、forward loop startを編集する。
- 描画はUI draftだけで、Applyで新しいPCMを追加し、そのslotの次回keyOnに割り当てる。
  共有sample、発音中のsample、他slotは上書きしない。検証失敗時はRAM／presetを変えない。
- EGのAR／D1R／D2R／DL／RR／KRSは次回keyOn、TL／direct level／panはlive。
  register codeとソフト側編集の区別を画面に明記。
- Copy voice JavaScriptは適用済みPCMのcopyと同時点の設定を取得し、bank IDなしで再生成する。
  Clipboard不可時も生成コードを選択できる。
- スロット切替／sample変更で未適用draftを破棄。非同期readの遅延結果は世代で拒否する。
  UI操作後はfocusを外し、Holdのblur／非表示／dispose releaseを維持する。

## 制約と次の作業

RAMは既存のappend-only bank。Applyのたびに新規allocationし、個別解放はしない。
画面にRAM使用量と消費方法を表示。反復描画の各pointer eventではallocationしない。
boundedな編集sample再利用／解放、PCMファイル入力は後続。JSでloadPCMしたsampleは選択・編集可能。
SCSPの音量校正、復旧／focus／Mixer／FXの網羅、Native音声、専用Synth、SSFは後続。

## 検証

- raw／Synth／Worklet、Workbench、Mixer生成・source監査：Node 93 tests成功。
- Playground全modeの型検証成功。
- npm package build：342 modules、393 declarations成功。公開はしていない。
- [実ブラウザ結果](scsp_editor_browser_01.json)：Chromium／WebKit × Main／Worker全4経路成功。
  PCM8 Apply、描画、EG、Copy、コピーコードのRun、Hold／Keyboard、既存例、独立instance、Stop。
  物理出力はミュート。有限PCM／発音／停止を測定したもので、人間による試聴ではない。
- 旧PS1／WonderSwan／POKEY校正reportは改変していない。
  [UI差分の固定hash](scsp_editor_ui_revision_01.json)と`mixer_calibration_sources.mjs`の独立pinで、
  editor UI本体と正確なSCSP cache URL変更のみを許可。panel以外はcache tokenだけの変更と検証する。
  測定対象renderer／gainは変更していない。SCSP自体は未校正のまま。

既存release ZIPは未再生成。Native SDK pin／C++／生成WASMの変更、commit／publishは実施していない。
