# PSF CaptureのRepeat／非連続loop制限の調査と修正（2026-11-12）

- [x] ユーザーが以前見たRepeat address／16-byte alignment／discontiguous loopsエラーの条件を、Capture・通常sample形式・native core／実機資料から切り分ける。
- [x] 既存ローカルPSFを無音・同一frameのregister＋RAMで調べ、該当例があればentry／時点／CH／Start・Repeat・ENDのmetadataだけを記録する。
- [x] 元ADPCM bytes、END／Repeat／Loop Start、予測履歴、動的register更新を壊さない対応方式と必要範囲を整理する。単純な連結やflagsの書換えで同じ音になると決めつけない。
- [x] 調査結果・残る不確実性・次に実装する場合の方針をユーザーへ説明する。調査段階ではCapture形式／DSP／WASM／UIの動作を変更せず、方式検討を先に行った。

音声デバイス・通常browser／native app・OS音量は使わない。ゲームのPCM／ADPCM／RAM本体を記録・配布しない。commit／push／公開は行わない。

調査完了: [検証記録](psf_capture_loop_layout_investigation_01.json)。40曲先頭2秒のactive ADPCM2,201観測で453回拒否、376種類の失敗はすべて範囲外Repeat＋有効な内部Loop Start。Alatos CH2は同一Start／END／markerのまま1.80秒で失敗、1.81秒でRepeatがmarkerへ変化して成功。自作の実SPUでも、新規Key Onで内部markerを使う4096framesのPCMが通常Synthとbit一致。marker無しの外部loopを0へ置換すると不一致。これは修正前の調査記録として保持する。

実装（ユーザーの「すすめて!!」で着手）:

- [x] 新しく鍵盤で弾くCaptureとして、唯一の内部Loop Startを優先し、raw Repeatは取得時metadataとして保持する。元ADPCMと既存JSON形式を変えない。
- [x] 真のmarker無し外部Repeatと、内部marker到達前のraw Repeatを診断表示で区別する。現在の継続再生状態・将来のdriver操作まで復元したとは表示しない。
- [x] 既存loop／one-shot／Noise／PMON拒否の回帰、実WASMの新規Key On一致、Pause試奏／Captureと保存・復元を検証する。
- [x] readableな配布ZIP・cache更新を確認し、検証記録と残る外部loop制限を更新する。npm公開・WASM再ビルド・commit／pushは行わない。

実装・検証完了: [修正後の記録](psf_capture_loop_layout_verification_01.json)。SPU回帰322件、固定WASM数値6ケース、Chromium／WebKit計28項目が成功。40曲の同じ2,201観測でCapture失敗453件→0件。raw Repeatは診断metadataに残し、`loopSource`と`resolvedLoopAddress`を追加した。保存するv1プリセットのschemaと元ADPCMは維持。readable ZIPも生成・bytes一致確認済み。

再実行: `npm run test:psf-capture-loop`。新規Key Onの一致と、継続再生の外部Repeat上書きとの差を自作データのみで無音検証する。SPUのGitHub Actionsにも追加済み（remote実行は未実施）。

残る別範囲: 内部markerのない真の外部Repeatは、引き続き明示的に未対応。複数領域の再配置・decoder履歴・実行中のregister上書きまで扱う設計が必要で、この修正では連結・flags書換え・仮の先頭loopへの置換は行わない。実PSF検証は40曲先頭2秒であり、全曲全区間の保証ではない。
