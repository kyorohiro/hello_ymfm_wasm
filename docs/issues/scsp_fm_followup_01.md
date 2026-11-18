# SCSP FM後続・自由配線の設計TODO — 2026-10-31

DSPとUI整理を先行する。完了済み2／4／6-op・Chain／Pairs／Branchは維持する。

2026-11-18: [Custom 2OPの初期版](todo_scsp_fm_custom_2op_20261118.md)で、
A/Bの非循環接続、独立Direct Output、OP IDと物理スロットの分離、v5保存を実装。
同日、[Custom 4/6OP・Input X/Y](todo_scsp_fm_custom_multiop_20261118.md)まで拡張。
さらに[OP別Depth](todo_scsp_fm_operator_depth_20261118.md)を追加。
非循環2/4/6OPの音色モデルは揃った。
同日、[Custom2の単一OP自己feedback](todo_scsp_fm_self_feedback_20261118.md)を追加。
X32/Y0の2世代平均を固定coreで検証し、Code・UI・v8保存へ反映。
続けて[Custom4/6の単一Self](todo_scsp_fm_multi_self_feedback_20261118.md)へ拡張し、
他OPの2入力合流／分岐、残存Selfを保つリサイズ、v9保存に対応。
一般的な循環graphと実機pipeline全体の一致は後続。

- [x] operator別FM Depth（各slotのMDL）。共通つまみは全段変更として残す。
- [x] 旧presetの共通Depthを各operatorへ移行し、発音中／release中の変更と保存を検証。個別値はv7、共通値は従来形式を維持。
- [x] 接続図のA〜Fボタンで編集対象を選択。波形描画は単一canvasを維持（DSP UI整理で実装）。
- [x] 非循環の音色モデルを設計：operator別のInput X／Y、Depth、Output、ratio。接続presetはテンプレートとして扱う。
- [x] 接続図と選択operatorのInput X／Y選択を併用。2/4/6OPでキーボード／タッチから設定できる。線のドラッグは未追加。
- [x] 保存上のoperator IDと物理slot割当を分離し、非循環graphをtopological orderで配置する。
- [x] 実機資料のsound stack世代／slot処理順と、固定core zero-delayの差を調査。実機の6slot tickと6音声sampleを区別し、固定coreの自己X32/Y0は前1／2native sample平均と実測。実機全体の同一性は保証しない。
- [x] Custom2の単一OP自己feedbackを、2世代履歴・新規発音／再発音／steal・live Depth・所有権を検証して解放。新規Auto／Code発音だけ自己slotの2セルを初期化するソフトウェア動作を明記。
- [x] Custom4/6でも1つのOPにSelfを設定。Selfは自身だけを入力にして2tapを専有し、他OPでは2入力を維持。Code・型・UI・v9保存、旧2OP Selfのv8互換を検証。
- [ ] 他operator間loopと複数自己feedback。現在は変更前に拒否し、一般循環graphへは広げない。
- [x] modulatorsを複数出力へ分岐するfan-out、2入力の平均化、独立OutputとDSP Sendを表現する。
- [x] 非循環2/4/6OPの無効接続・loop PCM不足・RAM不足を変更前に拒否し、現在の演奏を維持する。
- [x] Custom2はv5、Custom4/6はv6として保存。旧v1〜v4互換、group割当／離鍵／steal／PCM保護を検証する。
- [ ] 編集元6スロット予約をhost側モデルへ移す案を調査し、同時発音数を増やす。現在はPCM26／FM2 13／FM4 6／FM6 4。
- [ ] 音色プリセット（ベル／金属音／ベース／鍵盤）は別途追加する。

現時点の方向：Voice設定 → 接続図 → 選択operator詳細（ratio／Depth／Input X・Y／Output）→ PCM／EG／LFO。
DSPは音色全体の共有セクションに置き、operatorのFM帰還とDelayのFeedbackを区別する。
全32 slotsを自由配線する汎用patch editorまで最初から広げず、まず1音色内のA〜Fで検証する。
