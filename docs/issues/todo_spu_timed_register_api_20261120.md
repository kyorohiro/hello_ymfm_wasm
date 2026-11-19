# SPU timed register API

## Scope

SPUを完了させてからDMGへ進む。既存のPerformance Queueを利用し、
`build()` / `schedule()` / `clearSchedule()` / `compile()` / `captureState()`を追加する。
即時APIは維持する。予約はAudioWorkletのサンプル時計で実行する。

- [x] 既存サンプルのnote/key On/Off、Pitch/Frequency/Note、Preset/ADSR、共有Reverbを記録・予約。
- [x] 部分更新は適用時の状態から解決。同時刻の順番・KON/KOFFの再書き込みを保持。
- [x] current/reset/再利用snapshotで非破壊compile。client状態が不完全なら明示的に拒否。
- [x] RAMを含めないresolver snapshot。インスタンス識別とサンプル資源の取り扱いを明記。
- [x] Playground Main/WorkerとSPU SynthのCodeへ接続。
- [x] Run/Apply/Stop、名前付き置換、キャンセル、失敗時の原子性。
- [x] SynthのnoteOffクリック対策とraw keyOffを区別して維持。
- [x] 型・補完・初期Files内のexample。
- [x] 44.1/48kHz、compile/実行一致、手動更新、snapshot不変、拒否/Stopのローカル検証。

## Boundaries

PCM/RAM転送、波形編集、host audioは予約対象外。Noise/PMONは既存の公開高レベルAPIに
ないため本体のレジスタAPI設計と分離して追跡する。Nativeには今回タイマー代替を実装しない。
compileはチップのレジスタ操作の仮想実行であり、Synth固有のクリック保護・PMON補助音・
ホスト出力ゲイン等の履歴ではない。snapshotは発振器やRAMを復元するセーブステートではない。

参照: [共通契約](todo_synth_timed_register_api_20261119.md)、
[SPU横展開](todo_spu_synth_fm2612_alignment_20261119.md)。

## Implemented behavior / limits

- `setPreset` / `setChannel` / `setEnvelope` / `setReverb` / `setPitch` /
  `setFrequency` / `setNote` / `keyOn` / `keyOff` / `noteOn` / `noteOff` /
  `allNotesOff`を記録できる。referenceSampleRate既定44100、絶対オフセット。
- サンプルID・調律・voice設定・512個の16bitレジスタを取得するが、RAMデータや
  decoder位相は取得しない。reset基準は割り当てサンプルなしのPs1Synth初期状態。
- snapshotは同じインスタンス内で過去状態からの比較にも使える。予約はsnapshotを
  復元せず、適用時点のサンプル・パラメーターを利用する。resetは予約を解除する。
- clientは完全な適用済みシャドウがないため明示拒否。Nativeはbuild/reset compileのみ、
  schedule/current captureはAudioWorkletが必要と明示する。
- 新規CassetteのFilesに`examples/timed-phrase.js`を用意。既存Cassetteの編集を
  上書きしてexampleを挿入しない。旧プロジェクトではNew Cassetteか手動ファイル追加を使う。

## Validation

- `npm run test:spu-synth`、`npm run test:spu-timed`。
- `node scripts/check_spu_timed_browser.cjs`: Chromium/WebKit、起動前から物理出力をミュート。
  SynthのRun/Apply/不正Apply/Stop、Main/Workerの同一コア・snapshot・予約を確認。
  Workerは既存の0.5秒lookaheadとperformance sessionを使用。
- 44.1/48kHz実SPUコア、mixed offsets、同時刻再KON、compile trace一致、手動部分更新、
  snapshot再利用、名前付きキャンセル、stage/commit、Stop、Nativeの明示拒否を検証。

## Distribution follow-up

- [x] SPU単体の読みやすい配布ZIPを生成・ソース照合。
- [x] 共有トランスポート変更後のPS1/WonderSwan/SCSP/POKEY校正を再計測し、
  同じ基準音量でPlayground/npmの配布チェックを通す。校正チェックの迂回はしない。
- [ ] Noise/PMONの公開操作・raw 16bitレジスタAPIは別設計（今回の既存API対象外）。
- [ ] 人による実聴と任意の実PSF併用確認。

完了した測定・配布記録: [verification](verification_spu_timed_register_api_20261120.md)。
Compileの`register`はSPUベース`0x1f801c00`からのバイトオフセット、`value`は16bit値。
