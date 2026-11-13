# FM2612 Synth：RF5C164 PCMの自動演奏と手動操作（2026-11-13）

FM／PSGに続き、VGMまたはCodeの自動演奏と手動操作の共存をRF5C164 PCMへ広げる。今回は音量・Pan・再生速度と鍵盤を対象にする。サンプルRAMの読み込み・描画・ループ範囲の編集は作者Synth側と区別する。

- [x] 同じ実再生PCMのCH1〜8へ、音量・左右Pan・再生速度を書き込む。曲・他CH・他チップを止めず、後続VGM命令による上書きを保つ。
- [x] 最新のpacked Pan／16-bit Stepを扱い、VGMのCH選択・RAMバンク・Global Enableを手動操作で変えない。RAM転送・ストリーミング・部分レジスター書き込みの継続を保つ。
- [x] 選択CHの既存サンプル・開始／Loop設定を使って鍵盤を鳴らす。記録中の再生速度をC4の基準として移調し、古いKey Up／Pitch復帰が後続VGM命令を壊さないようにする。Global Disable・Step 0・未準備RAMなどは理由を示す。
- [x] 再生中の選択CHに表示・設定・鍵盤を揃える。Live Offでも手動の変更項目を表示し、作者音色・元VGM・元RAMは書き換えない。サンプル読み込み・描画・範囲編集は作者Synthで扱う。
- [x] Synth側の作者パラメーター変更も自動演奏を止めず反映し、サンプル読み込みでは作者Synth表示へ移る。VGM／Code排他、Pause独立試奏・Copy・Seek／Cache・Mixer・録音制約を維持する。
- [x] 実WASMで音量・Pan・Step・鍵盤所有権・CH／RAMバンク復元・Seekを確認し、gain0のChromium／WebKitでUIとFM／PSG／Code／4音源混合の回帰を確認する。音量補正・2048フレーム生成を維持し、可読ZIP・CI・使い方・検証記録を更新する。

実音出力、commit／push／公開は行わない。手動変更後のSeekは元VGMを再構成する。PWMの専用Synth UIは引き続き工事中とし、現在のVGM／Code再生を保つ。

実装：`synth_song_pcm_interaction.js` は元サンプルを使い、CH／RAMバンクの両ラッチと8bit key maskを保つ。参照Stepを別に記録して再発音の累積移調を防ぎ、表示用metadataのみをコピーして64 KiB RAMの参照を共有する。曲CHの鍵盤はhardware Key Off。作者Synth／Pause試奏は既存の4ms software releaseを使う。

PCMのSynthは作者用バンクと鍵盤を使い、選択した曲CHのみ同じ実再生RAMへ介入する。作者の読み込み・描画を曲の共有RAMへ転送しない。Codeの部分更新も揃え、Codeだけで発音する場合と、手で弾いたキーへCodeがパラメーターを書き込む場合の両方で、未編集のPan／Step／Loop／独自RAMを保つ。

Node599件成功。旧版との実WASM比較196,608サンプルは完全一致。補正値・2048フレーム生成は維持し、Seek後の先読み計測は約87〜88ms（機器の出力遅延を除く）。最終候補B：`release/hello_ymfm_wasm_fm-pcm-manual-20261113b_itch_synth.zip`。全291ファイルのstage／ZIP一致とCRCを確認済み。

最終B候補のChromium／WebKitでPCMの全9項目が成功。既存PCM Live、FM手動操作、PSG手動操作、Seek、3音源のCode＋鍵盤、4音源混合再生の回帰検証も両ブラウザで成功した。曲が進むため、操作禁止確認では全エンジンの総書き込み数ではなく、禁止された対象CHへの書き込みがないことを調べた。実音・長時間／高負荷の確認は人の確認項目として残す。

使い方は [CODE.md](../synth/CODE.md)、検証記録は [verification_fm2612_synth_pcm_manual_20261113.json](verification_fm2612_synth_pcm_manual_20261113.json)。詳細ログは `build/verification/fm-pcm-manual-20261113/`。PWM専用UIの前に、ここまでのFM／PSG／PCMを試してリリースする区切りにできる。
