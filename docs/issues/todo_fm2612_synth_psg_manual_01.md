# FM2612 Synth：PSGのVGM再生と手動操作（2026-11-13）

YM2612で実装した「VGMまたはCodeの自動演奏と、人のつまみ・鍵盤の共存」をSega PSGへ広げる。TODOを先に記録し、既存のコンパクトなUI・音量補正・再生バッファを維持する。

- [x] 同じ実再生PSGへ、Tone 1〜3／Noiseの設定と鍵盤を書き込む。曲・他CH・他チップを止めず、後続VGM命令を優先できるようにする。
- [x] PSG固有のラッチ／データ方式を扱い、手動操作がVGMの後続データバイトの対象を変えない。最新の周期・Noise種別／クロックなど未編集の値を古いLive表示で巻き戻さない。
- [x] VGMが同じCHへ再度書き込んだ場合、古いKey Up／Pitch復帰で新しい音を消さない。NoiseがTone 3をクロックとして使う際は、その依存関係を保ち、Tone 3の音量を勝手にミュートしない。
- [x] 再生中の選択CHに表示・設定・鍵盤を揃える。Live Offでも手動の変更項目を表示し、作者音色を変更しない。物理CHのTone／Noiseの種類は固定なので、曲CHの選択から切り替える。
- [x] Synth側の作者設定・プリセット読み込みも自動演奏を止めず反映する。VGM／Codeは排他、Pause中の独立試奏・Copy・Seek／Cache・Mixer・録音制約を維持する。VGMへの手動操作はまずハードウェア設定を対象とし、作者用Software Envelopeと区別する。
- [x] 実WASMのPCM・ラッチ継続・所有権・Tone 3連動・Seek復元をNodeで確認し、gain0のChromium／WebKitでUI・Code併用・他チップの回帰を確認する。可読ZIP・CI・使い方・検証記録を更新する。

実音出力、commit／push／公開は行わない。RF5C164／PWMへの再生中直接編集は次の対象として残す。元のVGMは書き換えず、Seekでは元の曲を再構成する。

完了：`synth_song_psg_interaction.js` を実再生PSGへ接続し、選択CHにはPeriodも表示した。作者プリセットの読み込みは未使用のミュートCHを鳴らさず、次の鍵盤用レベルを保持する。Tone 3の後続書き込みはNoiseのPitch所有権のみを奪い、Noiseのキー離しは有効なままにする。CodeのNoise部分更新でも、未編集のクロック・種別・明示した音量を保持する。

Node575件成功。旧版との実WASM比較196,608サンプルは完全一致し、4音源の補正値と2048フレーム生成を維持。Chromium／WebKitでPSG操作9項目、FM・Seek・Code鍵盤・4音源混合の回帰検証が成功。最終B候補では、PSGのみの曲からFM音色を読み込む場合と逆方向も、曲を止めず作者Synth表示へ移ることを確認した。Browserでの先読み観測は約54〜56ms、Seek後のNode計測は約87〜88ms（出力機器の遅延を除く）。

最終候補：`release/hello_ymfm_wasm_fm-psg-manual-20261113b_itch_synth.zip`。全290ファイルのstage／ZIP一致とCRCを確認。A／Bは作者音色読み込み時の表示選択を修正した `synth.js` のみが異なり、既存機能はA、拡張したPSG検証は最終Bで確認した。使い方は [CODE.md](../synth/CODE.md)、検証記録は [verification_fm2612_synth_psg_manual_20261113.json](verification_fm2612_synth_psg_manual_20261113.json)。詳細は `build/verification/fm-psg-manual-20261113/`。

残る人の確認：実聴、長時間、高負荷での操作。後続実装候補はRF5C164 PCMへの横展開。
