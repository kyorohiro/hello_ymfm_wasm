# SCSP DSP Delayの初期効果量修正 — 2026-10-31

Enableだけでは変化が聞き取りにくいとの報告。経路は動いていたが、初期Send 5／Return 5と
DSP入力の1/4係数が重なり、Sine離鍵後のwet peakがdryの約1%になっていた。
従来のbrowser検証はSend／Returnを7へ変更したwet-onlyの存在確認に偏っていた。

入力係数を4095/4096に修正し、初期Send 7／Return 6へ変更した。
実WASMの短音で最初のechoがdryの45〜55%になる回帰テストを追加。
browserも初期状態でEnableのみを操作し、短音離鍵後のdestination信号が十分な音量になることを確認する。
Sineの持続音は主に音量が変わる。短く弾いて離すと反復を確認しやすい旨をUIに追記した。
既存presetの明示されたSend／Return値は維持する。小さいままなら7／6へ調整する。

Node **20件成功**。Chromium／WebKitの最終出力で初期Enable-onlyと既存DSP／FM／preset検証が成功。
[集約記録](scsp_dsp_level_fix_01.json)／[browser report](scsp_dsp_level_fix_browser_01.json)。
修正ZIP：`release/tetorica_scsp_synth_dsp-delay-level-fix-20261031_itch.zip`
（1,196,583 bytes、SHA256 `7899ed2ec38934f07a626f73d2ba8951e5cd9a6b0ffe1537abcddfe9989544bf`）。
ZIP内のauthenticated source inputsは現sourceと全一致。旧ZIPは保持。SDK／WASM／共有runtime／npmは変更せず。
公開・commit／pushはしていない。人の試聴は未実施。
