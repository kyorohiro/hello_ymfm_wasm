# FM2612／SPU Synth Master 200% — 2026-10-31

ユーザー指定で両SynthのMaster slider上限を200%に揃え、100%以下は青、100%超はオレンジにした。
FM2612のUI上限は従来380%から200%へ変更。共有runtimeのAPI上限は変更していない。
SPUはUIとaudio hostの受付範囲を0〜2に広げ、既存の滑らかなgain rampへ適用する。
既定音量（FM100%／SPU70%）・校正gain・音源処理・Playgroundは変更していない。

## 検証

- `node --test docs/synth/*.test.mjs docs/synth-spu/*.test.mjs scripts/package_itch_spu_synth.test.mjs`：144件成功。
- `node scripts/check_synth_master_ui_browser.cjs docs/issues/synth_master200_browser_20261031.json`：
  Chromium／WebKit × FM2612／SPUの4経路成功。[測定report](synth_master200_browser_20261031.json)。
  100／101／200%の色と表示、200%上限、50%へ戻した色、0%の無音を確認。
  初期化前の200%設定もエラーなく適用。減衰しないSineで発音し、最終出力をanalyserで測定した。
- 200%／100%のRMS比：Chromium FM2.0001／SPU2.0010、WebKit FM2.0011／SPU1.9982。
  測定時の物理出力はmute。実聴は行っていない。
- PC／スマホ幅のMaster screenshotを生成し、Chromiumスマホ幅の両Synthでオレンジ表示を目視確認。

公開・npm更新・配布ZIPの再作成は行っていない。
