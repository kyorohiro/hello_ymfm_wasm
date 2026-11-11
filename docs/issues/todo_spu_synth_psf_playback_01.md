# SPU Synth：PSF曲の再生（2026-11-11）

PSF／MiniPSFを読み込み、SID／FM2612と同様に元の曲を試聴できるようにする。既存のVAB抽出・音色編集・Codeを維持する。PSFはレジスタ記録ではなくPS1実行プログラムを含むため、現在のSPU単体とは別にCPU／ドライバー実行が必要。

- [x] PSF1再生エンジンのソース・ライセンス・WASMビルドと既存コードの接続点を調査する。
- [x] ローカルのPSF／MiniPSF／PSFLib依存関係を再生用に渡す。外部URLやBIOS・ゲームデータの自動取得はしない。
- [x] 分離した曲再生エンジンを組み込み、Play／Pause／Resume／Stopと状態表示を追加する。既存Master／monitorを共有し、読み込みや選択だけでは発音しない。
- [x] 曲と鍵盤／Codeの所有権、読み込み失敗・キャンセル、停止・ページ終了時の後始末を整える。編集音色を保持する。
- [x] 自作PSF fixtureで実際のドライバー実行とPCM生成を確認し、Node／WASM・無音headlessでtransport／既存importの回帰を検証する。
- [x] README・再ビルド手順・ライセンスと可読ソース付き配布を更新する。commit／push／tag／公開は行わない。

曲のLive CH表示・音色Capture・seek／cacheは再生基盤の動作確認後に検討する。VAB単体は音色バンクなので曲としては再生しない。PSF2は今回の対象外。

実音は出さない。通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain0へ遮断し、Chromiumはmuteを併用する。

## 完了記録

- PSF／VABタブのentry選択の下へPlay song／Pause→Resume／Stop songを追加。曲は独立したPlay! HLE CPU／SPUで実行し、既存の編集用SPUと音色を保持する。BIOS画像・共有メモリは不要。
- Pauseは先読みPCMを保持して途中から再開する。同期JIT／PCM生成で時間が進んでも、未再生bufferを飛ばしたり重ねたりしない。Stop待機中の素早い離鍵でもNote OffがOnを追い越さないようにした。
- Node／WASM／共有PSF parser／配布検証140件成功。自作MIPSのADPCM転送・発音、MiniPSFの命令差分による音程変更、異なるrender分割でのPCM完全一致、独立インスタンスを数値確認。
- 最終ZIP上でChromium／WebKitの新PSF再生各7項目、既存Code／Files／Live各7項目、従来SPU full回帰が成功。音声出力はgain0で遮断し、実聴していない。
- ZIP：`release/tetorica_spu_synth_psf-playback-20261111-final_itch.zip`（314 files、6,757,112 bytes、SHA-256 `21418d08dd2227dae907172738e093c6bcab6b40bb02a162b2e52c91f1e1c3f9`）。可読JS／CSS、Play!／Framework／CodeGenのBSD-2-Clauseライセンスとソース・来歴・ビルド手順を同梱。配布ソースキットだけの再ビルドでJS／WASMが配布版とバイト単位で一致。元SPUの固定Native SDKは変更なし。
- 詳細：[検証記録](spu_synth_psf_playback_verification_01.json)。commit／push／tag／公開なし。

## Previewの制限と続き

再生エンジンは既存SynthのSPUとは別のPlay!実装。基本ADPCM／ADSR／reverbは再生するが、曲側のNoise・PMON・実機main／reverb出力音量レジスターを再現しない。HLE BIOSにも対応範囲があるため、実機との厳密な比較用とはしない。UIの「?」・READMEにも明記。

- [ ] Preview側SPUを既存のMAME由来SPUへ接続し、Noise／PMON／出力音量などの再現範囲を揃える方式を検討する。
- [ ] 曲のCH Live表示・Captureを検討する。まずは再生を試してから決める。
- [ ] 実ゲームPSFの互換性・実聴・長時間動作を確認する。今回の自動検証では未実施。
