# SCSP FM後続・自由配線の設計TODO — 2026-10-31

DSPとUI整理を先行する。完了済み2／4／6-op・Chain／Pairs／Branchは維持する。

- [ ] operator別FM Depth（各slotのMDL）。共通つまみは全段変更として残す。
- [ ] 旧presetの共通Depthを各operatorへ移行し、発音中／release中の変更と保存を検証。
- [x] 接続図のA〜Fボタンで編集対象を選択。波形描画は単一canvasを維持（DSP UI整理で実装）。
- [ ] 自由配線の音色モデルを設計：operator別のInput X／Y、Depth、Output、ratio。接続presetはテンプレートとして扱う。
- [ ] UI案：接続図と選択operatorのInput X／Y選択を併用。線をドラッグする操作は補助にし、キーボード／タッチでも設定可能にする。
- [ ] 保存上のoperator IDと物理slot割当を分離し、非循環graphをtopological orderで配置する。
- [ ] 実機のsound stack世代／slot処理順と、固定core zero-delayの差を調べる。単純なslot番号指定と混同しない。
- [ ] Feedback／循環graphは履歴サンプルの扱いを検証してから解放。自己feedbackと他operator間loopを区別する。
- [ ] modulatorsを複数出力へ分岐するfan-out、2入力の平均化、独立OutputとDSP Sendを表現する。
- [ ] 無効接続・loop PCM不足・RAM不足を変更前に拒否し、現在の演奏を維持する。
- [ ] preset schema更新、旧v1〜v4互換、group割当／離鍵／steal／PCM保護を検証する。
- [ ] 編集元6スロット予約をhost側モデルへ移す案を調査し、同時発音数を増やす。現在はPCM26／FM2 13／FM4 6／FM6 4。
- [ ] 音色プリセット（ベル／金属音／ベース／鍵盤）は別途追加する。

現時点の方向：Voice設定 → 接続図 → 選択operator詳細（ratio／Depth／Input X・Y／Output）→ PCM／EG／LFO。
DSPは音色全体の共有セクションに置き、operatorのFM帰還とDelayのFeedbackを区別する。
全32 slotsを自由配線する汎用patch editorまで最初から広げず、まず1音色内のA〜Fで検証する。
