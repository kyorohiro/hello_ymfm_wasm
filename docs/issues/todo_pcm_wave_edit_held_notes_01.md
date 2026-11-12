# PCM波形編集時の発音停止（2026-11-12）

- [x] 発生するSynthと編集操作を特定する。ユーザー回答は「PC EngineとFM2612」。HuC6280の32点Wave編集とFM2612 SynthのPCM Drawに絞る。
- [x] 波形更新でNote Off／voice停止／bank再構築を起こす箇所と、その理由・既存仕様を確認する。
- [x] 対象を絞り、押下中ノートの音程・所有者・位置・envelopeを保持する更新が可能か判断する。RAM・ADPCM再encode・loop境界など、単純な再発音と区別する。
- [x] 必要な修正と意味のある数値回帰を行い、後続Key Upで確実に停止できることを無音で検証する。対象外Synthへの一括変更は行わない。
- [x] 仕様・残る制限・再開手順と検証記録を更新する。

通常browser／native app・音声デバイス・OS音量は操作しない。commit／push／公開は行わない。

調査結果:

- FM2612 PCM: Draw確定→`applyPcmEditPreset()`→`setPreset()`で全8CH停止・held消去。既存の描画TODO／CODE.mdにも適用時停止の説明あり。RF5C164 RAM転送そのものにKey Offはない。同じ長さの描画編集を音色交換から分離すれば、同一slotで位置・heldを保持する経路を作れる。Code独自RAM所有権とEvent Rec／Looperイベントの意味も合わせて確認する必要がある。
- SPU: imported／captured ADPCMのfull-sample編集は`applyInstrumentSampleEdit()`が`stopInstrument()`後にprivate sampleへ差し替える。112点cycle／Morphは既にretriggerなしの別経路がある。長いADPCMではprivate slotへの最初の移動とdecoder予測・先読みを考慮し、単にStop呼出しを消さない。
- S-DSP: Wave／BRRのbank差分でSynth再構築・全voice停止・Echo履歴reset。128点waveは固定72B BRRだが、保持更新用のpublicAPIはなくslot整合とdecoder履歴を確認する必要がある。
- HuC6280: 32点Wave変更は現在held停止。既存wave upload自体も一旦channelをdisableしてwave indexを戻すため、所有者／software envelope保持とoscillator phase保持は別問題。DDA PCMとは経路が異なる。

実装範囲（ユーザー回答で着手）:

- FM2612: 長さ・sampleRate・Root・Loopなどを変えないDrawだけをサンプル差し替えから分離し、現在のendpoint／RAM／保持音と発音位置を維持する。Code、Event Rec、Looperにも同じ編集の意味を伝える。別音色の読込は従来の切替処理を使う。
- PC Engine: 32点Waveだけの変更は保持音・software envelopeの進行・鍵盤所有者を維持し、既存hardware wave upload後に必要なchannelの出力を復帰する。wave index／発振位相のresetは明記する。出力のGate再有効化と、論理Note On／envelopeのやり直しを区別する。LFO波形・後続Key Up・失敗時も検証する。
- SPU／S-DSP、共有runtime・npm・WASMへの変更は今回の対象外。

後続対応: [SPU／S-DSPの保持音継続](todo_spu_sdsp_wave_edit_held_notes_01.md)で、SPU full-sample ADPCMとS-DSPの描画Waveへも展開済み。上記はFM2612／HuC6280対応時点の範囲を残したもの。

配布確認で既存のFM Synth ZIPに共通Code runtimeのVAB helper依存が不足することが判明したため、純粋JSの`ps1_vab`とその3依存moduleを同梱リストへ追加する。SPU DSP／WASMを追加・起動する変更ではない。既存の配布module graph検証で解消を確認する。

完了: [検証記録](pcm_wave_edit_held_notes_verification_01.json)。FM2612 Node522件、HuC6280 Node128件、両SynthのChromium／WebKit全チェック成功。元のKey UpによるRelease、FMの遅延RAM ACK後の非再発音、HuCのMain／LFO波形・shape編集と既存Noise／DDAも確認済み。実聴・音声出力は行っていない。

FMは描画専用`editSample`で同じendpointを保持し、Event Rec／Looperにも同じ意味で記録する。Codeが独自RAMを使う場合は描画を事前拒否し、Stop完了後に編集できる。HuCはwave upload対象の位相resetが残る一方、鍵盤の所有者とSoftware envelope時刻は維持する。別音色読込・FM builtin変更・routing切替は従来の停止処理を維持。

配布: `sh scripts/package_itch_synth.sh pcm-held-20261112`（315 files）と`sh scripts/package_itch_huc6280_synth.sh pcm-held-20261112a`（51 files）成功。HuCのroot entry書換えはcache queryを保持するよう修正。変更module27件について、HuCは元bytes一致、FMは既存の配布用URL prefix書換えだけで一致を確認。通常のpackagingコマンドで今回の修正が入る。commit／push／npm公開／itch公開はしていない。
